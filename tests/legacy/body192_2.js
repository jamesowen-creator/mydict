// 작업192-2: 실제 server.js의 전역 미들웨어(express.json)를 그대로 올려, 큰 JSON 본문이 통과/거절되는지 확인한다.
// DB·dotenv·인증은 모의로 대체(운영 DB·키 접근 없음). 사용법: node body192_2.js [server 파일 경로]
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const root = require('path').resolve(__dirname, '..', '..').replace(/\\/g, '/') + '/';   // 저장소 루트(이 파일 기준)
process.chdir(require('path').resolve(__dirname, '..', '..'));   // 저장소 루트(이 파일 기준)
process.env.DATABASE_URL = 'x';
const serverFile = process.argv[2] || root + 'server.js';
const PORT = 38000 + Math.floor(Math.random() * 1500);
process.env.PORT = String(PORT);
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

const notes = [{ id: 1, user_id: 7, title: 't', transcript: '원문', summary: '', summary_source_hash: null, subject: null, subject_detail: null }];
const seen = { patchBytes: 0 };
function handle(sql, p) {
  if (/FROM api_usage/.test(sql)) return { rows: [{ n: 0 }] };
  if (/SELECT summary, transcript FROM voice_notes WHERE id/.test(sql)) return { rows: notes.filter(n => n.id === p[0]).map(n => ({ summary: n.summary, transcript: n.transcript })) };
  if (/^\s*UPDATE voice_notes SET/.test(sql)) {
    const n = notes.find(x => x.id === p[0]); const sets = [...sql.split('RETURNING')[0].matchAll(/(\w+) = \$(\d+)/g)];
    for (const [, k, i] of sets) n[k] = p[Number(i) - 1];
    return { rows: [{ id: n.id, title: n.title, transcript: n.transcript, summary: n.summary, subject: n.subject, subject_detail: n.subject_detail }] };
  }
  return { rows: [] };
}
const passthrough = (req, res, next) => next();
const authStub = new Proxy({
  requireAuth: (req, res, next) => { req.user = { id: 7 }; next(); },
  checkPermission: async () => true,
}, { get: (t, k) => (k in t ? t[k] : passthrough) });
const dbStub = { pool: { query: async (s, p) => handle(s, p), connect: async () => ({ query: async (s, p) => handle(s, p), release() {} }) }, trackUsage: () => {}, initDB: async () => {}, createApiReadyGate: () => (req, res, next) => next() };   // 작업212: server.js가 쓰는 새 내보내기 모의(요청을 그대로 통과)
const stubs = { [path.resolve(root, 'lib/db.js')]: dbStub, [path.resolve(root, 'middleware/auth.js')]: authStub };
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'dotenv') return { config() {} };
  try { const r = Module._resolveFilename(req, parent); if (stubs[r]) return stubs[r]; } catch (e) {}
  return origLoad.call(this, req, parent, ...rest);
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
(async () => {
  require(path.resolve(serverFile));
  await new Promise(r => setTimeout(r, 800));
  const base = 'http://127.0.0.1:' + PORT;
  const send = async (method, url, bodyStr, ct = 'application/json') => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': ct }, body: bodyStr });
    const type = r.headers.get('content-type') || ''; const text = await r.text();
    return { status: r.status, type, text };
  };
  const hangul = n => '가'.repeat(n);
  const body120k = JSON.stringify({ title: 't', transcript: hangul(30000), summary: hangul(5000) });   // 원문 30,000자 + 요약 5,000자 ≈ 105KB
  const bytes120 = Buffer.byteLength(body120k);
  console.log('payload bytes (30,000 + 5,000 hangul):', bytes120);
  let r = await send('PATCH', '/api/voice-notes/1', body120k);
  const label = process.argv[2] ? 'OLD server file' : 'server.js';
  console.log(label, '→ 30,000+5,000 hangul PATCH status:', r.status);
  if (!process.argv[2]) {
    ok('~105KB (max transcript + summary) PATCH passes', r.status === 200, [r.status, r.text.slice(0, 120)]);
    ok('stored via DB layer (transcript length, summary hash set)', notes[0].transcript.length === 30000 && notes[0].summary_source_hash === sha(hangul(30000)));
    const pad = hangul(30000) + '가'.repeat(0);
    const body120real = JSON.stringify({ title: 't', transcript: pad, summary: hangul(5000), extra: 'x'.repeat(20000) });   // 약 125KB(알 수 없는 필드는 무시됨)
    r = await send('PATCH', '/api/voice-notes/1', body120real);
    ok('~125KB JSON body passes the parser', r.status === 200 && Buffer.byteLength(body120real) > 120000, [r.status, Buffer.byteLength(body120real)]);
    const justUnder = JSON.stringify({ title: 't', transcript: 'a', summary: '', pad: 'x'.repeat(1024 * 1024 - 200) });
    r = await send('PATCH', '/api/voice-notes/1', justUnder);
    ok('just under 1MB passes the parser (' + Buffer.byteLength(justUnder) + ' bytes)', r.status === 200, [r.status, r.text.slice(0, 100)]);
    const over = JSON.stringify({ title: 't', transcript: 'a', pad: 'x'.repeat(1024 * 1024 + 10) });
    r = await send('PATCH', '/api/voice-notes/1', over);
    ok('over 1MB → 413', r.status === 413, [r.status, r.type, r.text.slice(0, 160)]);
    console.log('413 response: content-type =', JSON.stringify(r.type), '| body starts =', JSON.stringify(r.text.slice(0, 90)));
    const over2 = JSON.stringify({ transcript: 'a'.repeat(1024 * 1024 + 10) });
    r = await send('POST', '/api/voice-notes', over2);
    ok('POST over 1MB → 413 too', r.status === 413);
    // 서버의 글자 수 검증은 그대로(30,000자 한도)
    r = await send('PATCH', '/api/voice-notes/1', JSON.stringify({ transcript: hangul(30001) }));
    ok('char limit still enforced (30,001 → 400)', r.status === 400 && /30000/.test(r.text), [r.status, r.text.slice(0, 100)]);
    // 녹음 파일 경로(express.raw, audio/*)는 JSON 한도와 무관: JSON 파서가 audio/* 본문을 건드리지 않는다
    r = await send('POST', '/api/voice-notes/transcribe', Buffer.alloc(2 * 1024 * 1024, 1), 'audio/webm');
    ok('audio upload path not affected by JSON limit (2MB audio is not 413)', r.status !== 413, [r.status, r.text.slice(0, 100)]);
    r = await send('POST', '/api/voice-notes/transcribe', Buffer.alloc(13 * 1024 * 1024, 1), 'audio/webm');
    ok('audio over its own 12MB limit still 413 with JSON body', r.status === 413 && r.type.includes('json'), [r.status, r.type, r.text.slice(0, 100)]);
    // 기존 JSON 요청은 그대로
    r = await send('PATCH', '/api/voice-notes/1', JSON.stringify({ title: '제목만' })); ok('small JSON unchanged', r.status === 200);
  } else {
    ok('baseline: old default limit rejects the same ~105KB body with 413', r.status === 413, [r.status]);
    console.log('413 (old) content-type =', JSON.stringify(r.type), '| body starts =', JSON.stringify(r.text.slice(0, 90)));
  }
  console.log('pass', pass, 'fail', fail);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
