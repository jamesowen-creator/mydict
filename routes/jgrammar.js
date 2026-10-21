const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth, ADMIN_EMAILS } = require('../middleware/auth');
const J = require('../lib/jgrammar');

const router = express.Router();

// 작업JG-2: 권한은 users.perm_jgrammar 가 명시적으로 true 인 계정만 통과(fail-closed: DB 없음·조회 실패·행 없음·차단 계정은 거부). 관리자는 항상 허용한다.
// 이 검사는 캐시 조회·AI 호출·한도 계산보다 앞이라, 거부되면 그 어느 것도 일어나지 않는다. 개념 지도와 코드를 공유하지 않는다.
const DENIED = { ok: false, error: '문장 학습 사용 권한이 없습니다.' };
async function requireJgrammarPerm(req, res, next) {
  if (ADMIN_EMAILS.includes((req.user.email || '').toLowerCase())) return next();
  if (!process.env.DATABASE_URL) return res.status(403).json(DENIED);
  try {
    const { rows } = await pool.query('SELECT role, is_blocked, perm_jgrammar FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (u && u.role === 'admin') return next();
    if (!u || u.is_blocked || u.perm_jgrammar !== true) return res.status(403).json(DENIED);
    next();
  } catch (err) {
    console.error('jgrammar permission error:', err.message);
    res.status(403).json(DENIED);
  }
}

// 작업313: lang(없으면 ja). 모르는 값·아직 지원하지 않는 값(zh-Hans·zh-Hant)은 400 — 권한 검사 바로 다음이라 AI·캐시·한도 계산이 일어나지 않는다.
// explain 은 본문(JSON), ocr 과 saved 는 쿼리(?lang=)로 받는다(ocr 본문은 이미지 바이너리).
function langFrom(source) {
  return (req, res, next) => {
    const r = J.resolveLang(source(req));
    if (r.error) return res.status(400).json({ ok: false, error: r.error });
    req.lang = r.lang;
    next();
  };
}
const queryLang = langFrom(req => req.query.lang);
const bodyLang = langFrom(req => (req.body && typeof req.body === 'object' ? req.body.lang : undefined));

// 작업JG-3: 사진 → 일본어 문장 인식. 원본 이미지 바이너리를 Content-Type(image/*)으로 받는다(개념학습 음성 변환과 같은 방식).
// 순서: 로그인 → 권한 → 형식(415) → 본문 읽기·용량(413) → 하루 한도 → AI. 권한이 없으면 본문을 읽지도 않는다. 이미지는 메모리에서만 쓰고 저장하지 않는다.
function imageBody(req, res, next) {
  express.raw({ type: 'image/*', limit: J.OCR_MAX_BYTES })(req, res, err => {
    if (!err) return next();
    const tooBig = err.status === 413 || err.type === 'entity.too.large';
    res.status(tooBig ? 413 : 400).json({ ok: false, error: tooBig ? J.MSG.imageTooLarge : J.MSG.imageEmpty });
  });
}
function baseType(req) { return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(); }
function requireImageType(req, res, next) {
  if (!J.OCR_TYPES[baseType(req)]) return res.status(415).json({ ok: false, error: J.MSG.badImageType });
  next();
}

router.post('/api/jgrammar/ocr', requireAuth, requireJgrammarPerm, queryLang, requireImageType, imageBody, async (req, res) => {
  try {
    const out = await J.ocr(req.user.id, req.body, baseType(req), req.lang);
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error('jgrammar ocr error:', err && err.message);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/api/jgrammar/explain', requireAuth, requireJgrammarPerm, bodyLang, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await J.explain(req.user.id, body.sentence, req.lang);
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error('jgrammar error:', err && err.message);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

// 작업JG-6: 사용자별 저장 목록. 권한 검사(JG-2)가 가장 앞이라 권한이 없으면 DB 조회·저장·삭제가 일어나지 않는다. 본인 항목만 다룬다.
router.get('/api/jgrammar/saved', requireAuth, requireJgrammarPerm, queryLang, async (req, res) => {
  try {
    res.json({ ok: true, items: await J.listSaved(req.user.id, req.lang) });
  } catch (err) {
    console.error('jgrammar saved list error:', (err && (err.code || err.name)) || 'unknown');
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

router.delete('/api/jgrammar/saved/:id', requireAuth, requireJgrammarPerm, async (req, res) => {
  const NOT_FOUND = { ok: false, error: '저장한 문장을 찾을 수 없습니다.' };
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) < 1 || Number(req.params.id) > 2147483647) return res.status(404).json(NOT_FOUND);
  try {
    if (!(await J.deleteSaved(req.user.id, Number(req.params.id)))) return res.status(404).json(NOT_FOUND);   // 없는 id 와 남의 id 를 같은 응답으로
    res.json({ ok: true });
  } catch (err) {
    console.error('jgrammar saved delete error:', (err && (err.code || err.name)) || 'unknown');
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
