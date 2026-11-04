// 작업395: Speak Loop(영어 말하기) 서버 기반 — 권한·콘텐츠·원문 음성.
// - 사용자 경로는 OpenAI 를 부르지 않는다. 음성은 관리자가 만들어 DB(speakloop_audio)에 저장해 둔 것을 재생만 한다.
// - 권한: users.perm_speakloop 이 명시적으로 true 인 계정만 통과(fail-closed). 관리자는 항상 허용. 개념 지도 권한·can_tts 와 섞지 않는다.
'use strict';
const express = require('express');
const { pool, trackUsage } = require('../lib/db');
const { requireAuth, requireAdmin, ADMIN_EMAILS } = require('../middleware/auth');
const C = require('../lib/speakloop_content');
const TTS = require('../lib/speakloop_tts');

const router = express.Router();

const DENIED = { ok: false, error: 'Speak Loop 사용 권한이 없습니다.' };
async function requireSpeakloopPerm(req, res, next) {
  if (ADMIN_EMAILS.includes((req.user.email || '').toLowerCase())) return next();
  if (!process.env.DATABASE_URL) return res.status(403).json(DENIED);
  try {
    const { rows } = await pool.query('SELECT role, is_blocked, perm_speakloop FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (u && u.role === 'admin') return next();
    if (!u || u.is_blocked || u.perm_speakloop !== true) return res.status(403).json(DENIED);
    next();
  } catch (err) {
    console.error('speakloop permission error:', err.message);
    res.status(403).json(DENIED);
  }
}
const guard = [requireAuth, requireSpeakloopPerm];

const CONTENT_ERROR = { ok: false, error: '콘텐츠를 불러오지 못했습니다.' };
const needDb = (req, res, next) => process.env.DATABASE_URL ? next() : res.status(503).json({ ok: false, error: '데이터베이스를 사용할 수 없습니다.' });

// ───── 사용자: 콘텐츠·재생 ─────
router.get('/api/speakloop/content', guard, (req, res) => {
  try { res.json(C.getContent()); } catch (e) { res.status(500).json(CONTENT_ERROR); }   // 콘텐츠가 불량이면 열지 않는다(fail-closed)
});

router.get('/api/speakloop/audio-index', guard, needDb, async (req, res) => {
  try {
    const keys = new Set(C.listClips().map(c => c.key));
    const { rows } = await pool.query('SELECT clip_key, content_hash FROM speakloop_audio');   // audio 열은 읽지 않는다
    const index = {};
    for (const r of rows) if (keys.has(r.clip_key)) index[r.clip_key] = r.content_hash;
    res.json({ ok: true, index });
  } catch (err) {
    console.error('speakloop audio-index error:', err && err.message);
    res.status(500).json({ ok: false, error: '음성 목록을 불러오지 못했습니다.' });
  }
});

const etagOf = hash => '"' + hash + '"';
const matches = (header, hash) => String(header || '').split(',').some(t => t.trim().replace(/^W\//, '') === etagOf(hash));

router.get('/api/speakloop/audio/:clipKey', guard, needDb, async (req, res) => {
  try {
    if (!C.hasClipKey(req.params.clipKey)) return res.status(404).json({ ok: false, error: '없는 음성입니다.' });   // 콘텐츠에서 계산한 키만 허용
    const head = await pool.query('SELECT content_hash FROM speakloop_audio WHERE clip_key = $1', [req.params.clipKey]);
    if (!head.rows.length) return res.status(404).json({ ok: false, error: '아직 만들어지지 않은 음성입니다.' });
    const hash = head.rows[0].content_hash;
    res.set('ETag', etagOf(hash));
    res.set('Cache-Control', 'private, max-age=86400');
    if (matches(req.headers['if-none-match'], hash)) return res.status(304).end();
    const { rows } = await pool.query('SELECT audio FROM speakloop_audio WHERE clip_key = $1', [req.params.clipKey]);
    if (!rows.length) return res.status(404).json({ ok: false, error: '아직 만들어지지 않은 음성입니다.' });
    res.set('Content-Type', 'audio/mpeg');
    res.send(rows[0].audio);
  } catch (err) {
    console.error('speakloop audio error:', err && err.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: '음성을 불러오지 못했습니다.' });
  }
});

// ───── 관리자: 음성 현황·생성 (권한 컬럼과 무관, 관리자만) ─────
router.get('/api/admin/speakloop/audio/status', requireAdmin, needDb, async (req, res) => {
  try {
    const st = TTS.settings();
    const state = await TTS.currentState(pool, C.listClips(), st);
    res.json({ ok: true, ...TTS.summarize(state, st) });
  } catch (err) {
    console.error('speakloop status error:', err && err.message);
    res.status(500).json({ ok: false, error: '현황을 불러오지 못했습니다.' });
  }
});

router.post('/api/admin/speakloop/audio/generate', requireAdmin, needDb, async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  let max;
  if (body.max !== undefined) {
    if (!Number.isInteger(body.max) || body.max < 1) return res.status(400).json({ ok: false, error: 'max 는 1 이상의 정수여야 합니다.' });
    max = body.max;
  }
  if (body.kind !== undefined && !C.KINDS.includes(body.kind)) return res.status(400).json({ ok: false, error: 'kind 는 idiom, sentence, chunk 중 하나여야 합니다.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ ok: false, error: '음성 생성 기능을 사용할 수 없습니다.' });
  try {
    const clips = C.listClips();
    const r = await TTS.runLocked(() => TTS.generate({ pool, trackUsage, userId: req.user.id, clips, max, kind: body.kind }));
    if (r.busy) return res.status(409).json({ ok: false, error: '이미 생성 중입니다. 끝난 뒤 다시 시도해 주세요.' });
    res.json({ ok: true, ...r.value });
  } catch (err) {
    console.error('speakloop generate error:', err && err.message);
    res.status(500).json({ ok: false, error: '음성 생성에 실패했습니다.' });
  }
});

module.exports = router;
