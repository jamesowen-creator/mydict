const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth, ADMIN_EMAILS } = require('../middleware/auth');
const J = require('../lib/jgrammar');

const router = express.Router();

// 작업JG-2: 권한은 users.perm_jgrammar 가 명시적으로 true 인 계정만 통과(fail-closed: DB 없음·조회 실패·행 없음·차단 계정은 거부). 관리자는 항상 허용한다.
// 이 검사는 캐시 조회·AI 호출·한도 계산보다 앞이라, 거부되면 그 어느 것도 일어나지 않는다. 개념 지도와 코드를 공유하지 않는다.
const DENIED = { ok: false, error: '일본어 문법 사용 권한이 없습니다.' };
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

router.post('/api/jgrammar/explain', requireAuth, requireJgrammarPerm, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await J.explain(req.user.id, body.sentence);
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error('jgrammar error:', err && err.message);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
