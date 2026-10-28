require('dotenv').config();
// 작업352: 운영 환경(DATABASE_URL 있음)에서 비밀값이 비어 있으면 시작하지 않는다(변수 이름만 로그, 값은 출력하지 않음)
const { missingSecrets, errorHandler, corsOptions } = require('./lib/http_safety');
{
  const missing = missingSecrets(process.env);
  if (missing.length) { console.error('필수 환경변수가 비어 있어 서버를 시작하지 않습니다: ' + missing.join(', ')); process.exit(1); }
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const passport = require('passport');
const session = require('express-session');

const { initDB, createApiReadyGate } = require('./lib/db');

// 작업334: 처리되지 않은 Promise 거부 하나가 서버 전체를 종료시키지 않게 로그만 남긴다(종료하지 않는다). 내용은 오류 이름·메시지만 남긴다.
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', (reason && (reason.name || '')) + ' ' + (reason && reason.message ? reason.message : String(reason)));
});

const app = express();
// Railway (and most PaaS) terminate TLS at an edge proxy and forward plain HTTP
// internally. Without this, req.protocol always reports 'http', so passport's
// auto-built OAuth callback URL becomes http://... and mismatches the https://...
// redirect URI registered in Google Cloud Console (redirect_uri_mismatch).
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// 작업211: initDB가 끝났는지(성공이든 실패든) 알 수 있는 Promise. /api 요청은 이 Promise를 최대 15초 기다린 뒤 처리한다
let dbReady = null;
if (process.env.DATABASE_URL) {
  dbReady = initDB().catch(err => console.error('DB init error:', err.message));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors(corsOptions));   // 작업352: 같은 사이트 요청만 허용
app.use(express.json({ limit: '1mb' }));
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

// 정적 파일과 "/"(헬스체크)는 기다리지 않고, /api/*만 DB 준비를 기다린다(서버 시작 직후 컬럼이 아직 없는 순간의 500 방지)
app.use('/api', createApiReadyGate(dbReady));

app.use(require('./routes/auth'));
app.use(require('./routes/dictionary'));
app.use(require('./routes/wordbook'));
app.use(require('./routes/tts'));
app.use(require('./routes/admin'));
app.use(require('./routes/voice_study'));
app.use(require('./routes/concept_map'));   // 작업270-1: 새 메뉴 개념 지도
app.use(require('./routes/jgrammar'));      // 작업JG-1: 일본어 문법 해설
app.use(require('./routes/versus'));        // 작업343: 2인 대결(방은 서버 메모리, 인스턴스 1개 전제)

app.use(errorHandler);   // 작업352: 라우터 등록 뒤. 잘못된 JSON 400, 그 밖의 처리되지 않은 오류 500(내부 내용 없음)

app.listen(PORT, () => {
  console.log(`사전 서버 실행 중: http://localhost:${PORT}`);
});
