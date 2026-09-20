require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const passport = require('passport');
const session = require('express-session');

const { initDB, trackUsage } = require('./lib/db');
const { ADMIN_EMAILS, extractOptionalUser, checkPermission } = require('./middleware/auth');

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

// ─── Legacy / debug endpoints ─────────────────────────────────────────────────
// Excluded from the METIS-3 작업3 cleanup scope per explicit instruction - not
// referenced by any frontend code, left in place untouched rather than moved.

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
    adminEmails: ADMIN_EMAILS,
    matchingEnvKeys: Object.keys(process.env).filter(k =>
      k.includes('ANTHROPIC') || k.includes('APP') || k.includes('PASSWORD') || k.includes('GOOGLE') || k.includes('JWT') || k.includes('SESSION') || k.includes('ADMIN')
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

const legacySearchClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: '검색어를 입력해주세요.' });
  }

  const user = extractOptionalUser(req);
  if (user) {
    const allowed = await checkPermission(user.id, 'can_search');
    if (!allowed) return res.status(403).json({ error: '검색 권한이 없습니다.' });
  }

  try {
    const message = await legacySearchClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: query.trim() }],
      system: SYSTEM_PROMPT,
    });
    if (!message.content?.length) {
      return res.status(500).json({ error: '응답이 없습니다.' });
    }
    const raw = message.content[0].type === 'text' ? (message.content[0].text ?? '') : '';
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    trackUsage(user?.id, 'search', 'claude-haiku-4-5', message.usage?.input_tokens, message.usage?.output_tokens, 0);
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
