const jwt = require('jsonwebtoken');
const { pool } = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET || 'mydict-jwt-secret';
// Lowercased so admin checks aren't sensitive to how Google happens to case the
// email in its OAuth profile, or how ADMIN_EMAILS was typed in Railway Variables.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

// Does NOT trust req.user.role from the JWT payload: that role is fixed at login
// time and can go stale for up to 7 days (the token's expiry) if ADMIN_EMAILS
// changes or the DB role is updated afterward - /api/me re-derives the current
// role on every call (and even auto-upgrades the DB row), but has no way to
// reach back into a token the client already has. So this always re-checks
// against the current ADMIN_EMAILS list and, when a DB is configured, the
// user's current DB role - the same two sources /api/me itself trusts.
async function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    const emailIsAdmin = ADMIN_EMAILS.includes((req.user.email || '').toLowerCase());
    if (emailIsAdmin) return next();
    if (!process.env.DATABASE_URL) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
      }
      return next();
    }
    try {
      const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
      if (rows[0]?.role !== 'admin') {
        return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
      }
      next();
    } catch (err) {
      console.error('requireAdmin DB error:', err.message);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
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
