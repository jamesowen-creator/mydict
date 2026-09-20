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

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    next();
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
