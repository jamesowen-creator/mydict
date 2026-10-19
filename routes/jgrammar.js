const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const J = require('../lib/jgrammar');

const router = express.Router();

// 작업JG-1: 일본어 문법 해설. 접근 권한은 기존 일반 메뉴와 같은 방식(로그인 필요 + 차단 계정 거부, 메뉴별 perm 컬럼 없음, 조회 실패 시 허용=기존 checkPermission 과 같은 fail-open).
async function notBlocked(req, res, next) {
  if (process.env.DATABASE_URL) {
    try {
      const { rows } = await pool.query('SELECT is_blocked FROM users WHERE id = $1', [req.user.id]);
      if (rows[0] && rows[0].is_blocked) return res.status(403).json({ ok: false, error: '이용 권한이 없습니다.' });
    } catch (err) { console.error('jgrammar permission error:', err.message); }
  }
  next();
}

router.post('/api/jgrammar/explain', requireAuth, notBlocked, async (req, res) => {
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
