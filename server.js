require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const { Pool } = require('pg');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mydict-jwt-secret';

// ─── PostgreSQL ───────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      google_id  VARCHAR(255) UNIQUE NOT NULL,
      email      VARCHAR(255),
      name       VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wordbook (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      word       VARCHAR(255) NOT NULL,
      lang       VARCHAR(50)  DEFAULT 'en',
      data       JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tts_cache (
      id         SERIAL PRIMARY KEY,
      text_key   VARCHAR(500) NOT NULL,
      lang       VARCHAR(10)  DEFAULT 'en',
      audio      BYTEA        NOT NULL,
      created_at TIMESTAMP    DEFAULT NOW(),
      UNIQUE(text_key, lang)
    )
  `);
}

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
  res.sendFile(path.join(__dirname, 'public', 'english_dictionary.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── Google OAuth ─────────────────────────────────────────────────────────────

const googleOAuthEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleOAuthEnabled) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (google_id, email, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (google_id) DO UPDATE
           SET email = EXCLUDED.email, name = EXCLUDED.name
         RETURNING *`,
        [profile.id, profile.emails?.[0]?.value, profile.displayName]
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

app.get('/auth/google', (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.status(503).json({ error: 'OAuth 설정이 필요합니다.' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.status(503).json({ error: 'OAuth 설정이 필요합니다.' });
  }
  passport.authenticate('google', { failureRedirect: '/?login=failed' })(req, res, next);
}, (req, res) => {
    const token = jwt.sign(
      { id: req.user.id, email: req.user.email, name: req.user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.redirect(`/?token=${token}`);
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// ─── JWT middleware ───────────────────────────────────────────────────────────

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

// ─── Existing endpoints ───────────────────────────────────────────────────────

app.get('/api/files', (req, res) => {
  const fs = require('fs');
  const files = fs.readdirSync(path.join(__dirname, 'public'));
  res.json({ files });
});

app.get('/api/debug', (req, res) => {
  const ak = process.env.ANTHROPIC_API_KEY;
  const pw = process.env.APP_PASSWORD;
  const gcid = process.env.GOOGLE_CLIENT_ID;
  const gcs = process.env.GOOGLE_CLIENT_SECRET;
  res.json({
    hasAnthropicKey: !!ak,
    anthropicKeyLength: ak ? ak.length : 0,
    hasAppPassword: !!pw,
    hasGoogleClientId: !!gcid,
    googleClientIdLength: gcid ? gcid.length : 0,
    hasGoogleClientSecret: !!gcs,
    googleOAuthEnabled: !!(gcid && gcs),
    matchingEnvKeys: Object.keys(process.env).filter(k =>
      k.includes('ANTHROPIC') || k.includes('APP') || k.includes('PASSWORD') || k.includes('GOOGLE') || k.includes('JWT') || k.includes('SESSION')
    ),
    railwayKeys: Object.keys(process.env).filter(k => k.startsWith('RAILWAY')),
    port: process.env.PORT,
  });
});

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (!process.env.APP_PASSWORD) return res.json({ ok: true });
  res.json({ ok: password === process.env.APP_PASSWORD });
});

const SYSTEM_PROMPT = `You are an English dictionary assistant. When given an English word or phrase, provide a clear and structured dictionary entry in Korean-friendly format.

Respond in the following JSON format:
{
  "word": "the word or phrase",
  "pronunciation": "IPA pronunciation",
  "partOfSpeech": "noun/verb/adjective/etc.",
  "definitions": [
    {
      "meaning": "definition in Korean",
      "example": "Example sentence in English",
      "exampleTranslation": "Korean translation of the example"
    }
  ],
  "synonyms": ["synonym1", "synonym2"],
  "antonyms": ["antonym1", "antonym2"],
  "origin": "Brief etymology in Korean (optional)"
}

Always respond with valid JSON only, no additional text. Provide 2-4 definitions when applicable. If the input is not a valid English word or phrase, return {"error": "유효하지 않은 단어입니다"}.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: '검색어를 입력해주세요.' });
  }
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: query.trim() }],
      system: SYSTEM_PROMPT,
    });
    if (!message.content?.length) {
      return res.status(500).json({ error: '응답이 없습니다.' });
    }
    const raw = message.content[0].type === 'text' ? (message.content[0].text ?? '') : '';
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    res.json(JSON.parse(text));
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: '응답 파싱 오류가 발생했습니다.' });
    } else {
      console.error('API error:', err.message);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  }
});

app.post('/api/ai', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '프롬프트를 입력해주세요.' });
  }
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt.trim() }],
    });
    if (!message.content?.length) {
      return res.status(500).json({ error: '응답이 없습니다.' });
    }
    const text = message.content[0].type === 'text' ? (message.content[0].text ?? '') : '';
    res.json({ result: text });
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ─── Wordbook endpoints ───────────────────────────────────────────────────────

app.get('/api/wordbook', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM wordbook WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/wordbook', requireAuth, async (req, res) => {
  const { word, lang = 'en', data } = req.body;
  if (!word) return res.status(400).json({ error: '단어를 입력해주세요.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO wordbook (user_id, word, lang, data) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, word, lang, data ? JSON.stringify(data) : null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/wordbook/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM wordbook WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ─── TTS ─────────────────────────────────────────────────────────────────────

// 음성/모델 업그레이드 시 캐시 초기화용
app.delete('/api/tts/cache', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ ok: true, deleted: 0 });
  try {
    const { rowCount } = await pool.query('DELETE FROM tts_cache');
    console.log(`TTS cache cleared: ${rowCount} rows deleted`);
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tts', async (req, res) => {
  const { text, lang = 'en' } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

  const textKey = text.trim().slice(0, 500);

  // DB 캐시 확인
  if (process.env.DATABASE_URL) {
    try {
      const { rows } = await pool.query(
        'SELECT audio FROM tts_cache WHERE text_key = $1 AND lang = $2',
        [textKey, lang]
      );
      if (rows.length > 0) {
        res.set('Content-Type', 'audio/mpeg');
        res.set('X-TTS-Cache', 'HIT');
        return res.send(rows[0].audio);
      }
    } catch (e) {
      console.error('TTS cache read error:', e.message);
    }
  }

  // OpenAI TTS 생성
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'TTS 기능을 사용할 수 없습니다.' });
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: textKey,
        voice: lang === 'en' ? 'onyx' : 'nova',
        response_format: 'mp3',
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(errText);
    }

    const audioBuffer = Buffer.from(await openaiRes.arrayBuffer());

    // DB 캐시 저장 (비동기, 에러 무시)
    if (process.env.DATABASE_URL) {
      pool.query(
        `INSERT INTO tts_cache (text_key, lang, audio)
         VALUES ($1, $2, $3)
         ON CONFLICT (text_key, lang) DO NOTHING`,
        [textKey, lang, audioBuffer]
      ).catch(e => console.error('TTS cache write error:', e.message));
    }

    res.set('Content-Type', 'audio/mpeg');
    res.set('X-TTS-Cache', 'MISS');
    res.send(audioBuffer);
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: 'TTS 생성 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`사전 서버 실행 중: http://localhost:${PORT}`);
});
