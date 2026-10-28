// 작업352: 서버 시작 전 비밀값 검사, 전역 오류 처리기, 같은 사이트만 허용하는 CORS 설정.
// 비밀값은 이름만 다루고 값은 어디에도 출력하지 않는다.

// 운영 환경(DATABASE_URL 이 있을 때)에서 비어 있으면 안 되는 비밀값 이름. DATABASE_URL 이 없는 로컬·시험 환경은 기본값을 허용한다.
const REQUIRED_SECRETS = ['JWT_SECRET', 'SESSION_SECRET'];
function missingSecrets(env) {
  const e = env || process.env;
  if (!(e.DATABASE_URL || '').trim()) return [];
  return REQUIRED_SECRETS.filter(n => !(e[n] || '').trim());
}

// 라우터 등록 뒤에 둔다. 잘못된 JSON 은 400, 너무 큰 본문은 413, 그 밖은 500. 내부 메시지·스택은 응답에 싣지 않고 로그에는 오류 이름·메시지만 남긴다.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: '요청이 너무 큽니다.' });
  console.error('요청 처리 오류:', ((err && err.name) || 'Error') + ' ' + ((err && err.message) || ''));
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
}

// 같은 사이트(Origin 의 호스트가 요청 Host 와 같음) 요청에만 CORS 허용 헤더를 준다. Origin 이 없는 요청(서버 대 서버, 주소창 이동)은 CORS 와 무관하다.
function corsOptions(req, cb) {
  let same = false;
  const origin = req.headers.origin;
  if (origin) { try { same = new URL(origin).host === req.headers.host; } catch (e) { same = false; } }
  cb(null, { origin: same });
}

module.exports = { REQUIRED_SECRETS, missingSecrets, errorHandler, corsOptions };
