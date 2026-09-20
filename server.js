require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const passport = require('passport');
const session = require('express-session');

const { initDB } = require('./lib/db');

const app = express();
// Railway (and most PaaS) terminate TLS at an edge proxy and forward plain HTTP
// internally. Without this, req.protocol always reports 'http', so passport's
// auto-built OAuth callback URL becomes http://... and mismatches the https://...
// redirect URI registered in Google Cloud Console (redirect_uri_mismatch).
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

if (process.env.DATABASE_URL) {
  initDB().catch(err => console.error('DB init error:', err.message));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'mydict-session-secret',
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

// ─── Static files ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'home', 'index.html'));
});
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.json') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ─── Routers ──────────────────────────────────────────────────────────────────

app.use(require('./routes/auth'));
app.use(require('./routes/dictionary'));
app.use(require('./routes/wordbook'));
app.use(require('./routes/tts'));
app.use(require('./routes/admin'));
app.use('/api/metacong', require('./routes/metacong'));

app.listen(PORT, () => {
  console.log(`사전 서버 실행 중: http://localhost:${PORT}`);
});
