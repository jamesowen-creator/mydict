const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const { pool } = require('../lib/db');
const { JWT_SECRET, ADMIN_EMAILS, requireAuth } = require('../middleware/auth');

const router = express.Router();

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
      const role = ADMIN_EMAILS.includes((email || '').toLowerCase()) ? 'admin' : null;
      const displayName = (profile.displayName || '').normalize('NFC');
      const { rows } = await pool.query(
        `INSERT INTO users (google_id, email, name, role)
         VALUES ($1, $2, $3, COALESCE($4, 'user'))
         ON CONFLICT (google_id) DO UPDATE
           SET email = EXCLUDED.email,
               name  = EXCLUDED.name,
               role  = CASE WHEN $4 IS NOT NULL THEN $4 ELSE users.role END
         RETURNING *`,
        [profile.id, email, displayName, role]
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
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback', (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.status(503).json({ error: 'OAuth 설정이 필요합니다.' });
  }
  passport.authenticate('google', { failureRedirect: '/?login=failed' })(req, res, next);
}, (req, res) => {
    const token = jwt.sign(
      { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role || 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.redirect(`/?token=${token}`);
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
