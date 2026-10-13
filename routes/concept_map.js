const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 작업270-1: 새 메뉴 "개념 지도"(옛 개념학습과 별도). 이번 단계는 권한 확인과 상태 확인뿐이다.
// 옛 checkPermission 은 "명시적 false 일 때만 거부(fail-open)"라서 쓰지 않는다. 개발 중인 기능이므로
// users.perm_concept_map 이 명시적으로 true 인 계정만 통과시킨다(fail-closed): DB 없음·조회 실패·행 없음·차단 계정은 모두 거부.
async function requireCmapPerm(req, res, next) {
  if (!process.env.DATABASE_URL) return res.status(403).json({ error: '개념 지도 권한이 없습니다.' });
  try {
    const { rows } = await pool.query('SELECT is_blocked, perm_concept_map FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (!u || u.is_blocked || u.perm_concept_map !== true) return res.status(403).json({ error: '개념 지도 권한이 없습니다.' });
    next();
  } catch (err) {
    console.error('cmap permission error:', err.message);
    res.status(403).json({ error: '개념 지도 권한을 확인하지 못했습니다.' });
  }
}

const guard = [requireAuth, requireCmapPerm];

router.get('/api/cmap/status', guard, (req, res) => {
  res.json({ ok: true, perm: true, stage: 1 });
});

module.exports = router;
