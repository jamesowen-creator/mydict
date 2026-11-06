const jwt = require('jsonwebtoken');
const { pool } = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET || 'mydict-jwt-secret';
// Lowercased so admin checks aren't sensitive to how Google happens to case the
// email in its OAuth profile, or how ADMIN_EMAILS was typed in Railway Variables.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// 작업404: 토큰 서명만 믿지 않고 매 요청마다 DB에서 승인·차단 상태를 다시 확인한다(캐시 없음 — 승인 취소·차단이 즉시 반영).
// 통과: 행이 있고 차단이 아니며, (role 이 admin 이거나 ADMIN_EMAILS 에 포함되거나 is_approved 가 true).
// 거절: 행 없음 401 auth_invalid / 차단 403 blocked / 미승인 403 approval_pending / DB 없음·조회 오류 503 auth_unavailable(fail-closed).
function reject(res, status, code, error) {
  console.warn('[auth] ' + status + ' ' + code);   // 로그에는 상태코드와 code만 남긴다
  return res.status(status).json({ error, code });
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
  if (!process.env.DATABASE_URL) return reject(res, 503, 'auth_unavailable', '인증 상태를 확인할 수 없습니다.');
  let row;
  try {
    const { rows } = await pool.query('SELECT is_approved, is_blocked, role FROM users WHERE id = $1', [req.user.id]);
    row = rows[0];
  } catch (err) {
    return reject(res, 503, 'auth_unavailable', '인증 상태를 확인할 수 없습니다.');
  }
  if (!row) return reject(res, 401, 'auth_invalid', '유효하지 않은 토큰입니다.');
  if (row.is_blocked === true) return reject(res, 403, 'blocked', '차단된 계정입니다.');
  const isAdmin = row.role === 'admin' || ADMIN_EMAILS.includes((req.user.email || '').toLowerCase());
  if (!isAdmin && row.is_approved !== true) return reject(res, 403, 'approval_pending', '관리자 승인 대기 중입니다.');
  req.authRow = row;
  next();
}

// Does NOT trust req.user.role from the JWT payload: that role is fixed at login
// time and can go stale for up to 7 days. requireAuth already re-read the current DB row
// (role included), so this checks ADMIN_EMAILS and that fresh DB role - the same two sources /api/me trusts.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const emailIsAdmin = ADMIN_EMAILS.includes((req.user.email || '').toLowerCase());
    if (emailIsAdmin || req.authRow?.role === 'admin') return next();
    res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  });
}

function extractOptionalUser(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try { return jwt.verify(auth.slice(7), JWT_SECRET); } catch { return null; }
}

async function checkPermission(userId, perm) {
  if (!process.env.DATABASE_URL || !userId) return true;
  try {
    const { rows } = await pool.query(
      `SELECT is_blocked, ${perm} FROM users WHERE id = $1`, [userId]
    );
    if (!rows.length) return true;
    if (rows[0].is_blocked) return false;
    return rows[0][perm] !== false;
  } catch { return true; }
}

module.exports = { JWT_SECRET, ADMIN_EMAILS, requireAuth, requireAdmin, extractOptionalUser, checkPermission };
