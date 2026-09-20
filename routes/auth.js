const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const { pool } = require('../lib/db');
const { JWT_SECRET, ADMIN_EMAILS, requireAuth } = require('../middleware/auth');

const router = express.Router();

// 작업9-b: 작업8 이전에는 '/'가 english_dictionary.html 그 자체였어서 콜백이
// 항상 '/'로 보내도 사용자가 있던 화면 그대로였음. 작업8에서 '/'가 홈 휠로
// 바뀐 뒤에도 콜백은 여전히 '/'만 바라보고 있어서, 사전 페이지에서 로그인한
// 사람이 검색 화면이 아니라 홈으로 튕겨나가는 회귀가 생겼음. OAuth의 state
// 파라미터로 로그인을 시작한 페이지 경로를 왕복시켜 원래 페이지로 되돌려줌.
// 내부 상대 경로만 허용해 state를 통한 오픈 리다이렉트를 막음.
function safeNextPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) {
    return '/';
  }
  return raw;
}

// 작업9-c 임시 디버그용: 특정 계정만 승인 후에도 pending 루프에 걸리는
// 원인을 실 배포 로그로 확인하기 위한 마스킹 헬퍼. 원인 확인 끝나면
// 이 함수와 호출부의 console.log를 함께 제거할 것.
function maskEmail(email) {
  if (!email) return email;
  return email.length <= 4 ? '*'.repeat(email.length) : '*'.repeat(email.length - 4) + email.slice(-4);
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

const googleOAuthEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleOAuthEnabled) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const isAdminEmail = ADMIN_EMAILS.includes((email || '').toLowerCase());
      const role = isAdminEmail ? 'admin' : null;
      const displayName = (profile.displayName || '').normalize('NFC');
      const { rows } = await pool.query(
        `INSERT INTO users (google_id, email, name, role, is_approved)
         VALUES ($1, $2, $3, COALESCE($4, 'user'), $5)
         ON CONFLICT (google_id) DO UPDATE
           SET email = EXCLUDED.email,
               name  = EXCLUDED.name,
               role  = CASE WHEN $4 IS NOT NULL THEN $4 ELSE users.role END
         RETURNING *`,
        [profile.id, email, displayName, role, isAdminEmail]
      );
      done(null, rows[0]);
    } catch (err) {
      done(err);
    }
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      done(null, rows[0] || null);
    } catch (err) {
      done(err);
    }
  });
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

router.get('/auth/google', (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.status(503).json({ error: 'OAuth 설정이 필요합니다.' });
  }
  const state = safeNextPath(req.query.next);
  passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
});

router.get('/auth/google/callback', (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.status(503).json({ error: 'OAuth 설정이 필요합니다.' });
  }
  passport.authenticate('google', { failureRedirect: '/?login=failed' })(req, res, next);
}, (req, res) => {
    const target = safeNextPath(req.query.state);
    const sep = target.includes('?') ? '&' : '?';
    // 작업9-c 임시 디버그 로그 - 원인 확인 끝나면 제거할 것
    console.log('[auth-debug]', maskEmail(req.user.email), '| is_approved:', req.user.is_approved, '(type:', typeof req.user.is_approved, ')');
    if (req.user.is_approved === false) {
      return res.redirect(`${target}${sep}approval=pending`);
    }
    const token = jwt.sign(
      { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role || 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.redirect(`${target}${sep}token=${token}`);
  }
);

router.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// ─── /api/me ─────────────────────────────────────────────────────────────────

router.get('/api/me', requireAuth, async (req, res) => {
  const emailIsAdmin = ADMIN_EMAILS.includes((req.user.email || '').toLowerCase());
  if (!process.env.DATABASE_URL) {
    return res.json({
      id: req.user.id, email: req.user.email, name: req.user.name,
      role: emailIsAdmin ? 'admin' : (req.user.role || 'user'), is_blocked: false,
      can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true,
      perm_literature_compass: true, perm_digest_reading: true,
    });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, is_blocked,
              can_search, can_wordbook, can_quiz, can_tts, can_podcast,
              perm_literature_compass, perm_digest_reading
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const user = rows[0];
    // Auto-upgrade to admin if email is in ADMIN_EMAILS but DB hasn't been updated yet
    if (emailIsAdmin && user.role !== 'admin') {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', req.user.id]);
      user.role = 'admin';
    }
    res.json(user);
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
