// 작업352: 작은 보안 정리 — 비밀값 검사(시작 거부), 전역 오류 처리기, /auth/logout 제거, 같은 사이트만 허용하는 CORS.
// 실제 server.js 를 자식 프로세스로 띄운다(DATABASE_URL 없이는 pg 에 접속하지 않는다). 외부 API·운영 서버·DB 는 쓰지 않는다. .env 는 빈 임시 폴더를 작업 폴더로 써서 읽지 않는다.
// 실행: node --test tests/server_safety.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { spawn, spawnSync } = require('node:child_process');
const { missingSecrets, errorHandler, corsOptions } = require('../lib/http_safety');

const ROOT = path.resolve(__dirname, '..');
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-safety-'));
test.after(() => { try { fs.rmSync(CWD, { recursive: true, force: true }); } catch (e) { /* 무시 */ } });
const baseEnv = extra => Object.assign({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, extra);
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const FAKE_DB = 'postgres://user:pw-should-never-print@127.0.0.1:1/none';

test('352-1. 비밀값 검사: DATABASE_URL 이 있을 때만 JWT_SECRET·SESSION_SECRET 이 비어 있으면 이름을 알린다(공백만 있어도 비어 있음). 없으면 로컬로 보고 통과', () => {
  assert.deepEqual(missingSecrets({}), []);
  assert.deepEqual(missingSecrets({ JWT_SECRET: '' }), [], 'DATABASE_URL 없으면 로컬: 기본값 허용');
  assert.deepEqual(missingSecrets({ DATABASE_URL: FAKE_DB }), ['JWT_SECRET', 'SESSION_SECRET']);
  assert.deepEqual(missingSecrets({ DATABASE_URL: FAKE_DB, JWT_SECRET: 'a', SESSION_SECRET: '   ' }), ['SESSION_SECRET']);
  assert.deepEqual(missingSecrets({ DATABASE_URL: FAKE_DB, JWT_SECRET: 'a', SESSION_SECRET: 'b' }), []);
});

test('352-2. server.js: DATABASE_URL 있음 + 비밀값 없음 → 시작하지 않고(종료 코드 1) 로그에는 변수 이름만, 어떤 값도 나오지 않는다', () => {
  for (const [env, names, not] of [[{}, ['JWT_SECRET', 'SESSION_SECRET'], []], [{ JWT_SECRET: 'jwt-value-xyz' }, ['SESSION_SECRET'], ['JWT_SECRET']], [{ SESSION_SECRET: 'sess-value-xyz' }, ['JWT_SECRET'], ['SESSION_SECRET']]]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { cwd: CWD, env: baseEnv(Object.assign({ DATABASE_URL: FAKE_DB, PORT: '0' }, env)), encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 1, '시작 거부: ' + r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    for (const n of names) assert.ok(out.includes(n), n + ' 이름이 로그에 있다');
    for (const n of not) assert.ok(!out.includes(n), n + ' 은 설정돼 있으니 나오지 않는다');
    for (const v of ['pw-should-never-print', 'jwt-value-xyz', 'sess-value-xyz', 'mydict-jwt-secret', 'mydict-session-secret']) assert.ok(!out.includes(v), '값은 출력하지 않는다: ' + v);
    assert.ok(!out.includes('사전 서버 실행 중'));
  }
});

// 로컬(DATABASE_URL 없음)로 실제 server.js 를 띄운다
let child = null, port = 0, logs = '';
test.before(async () => {
  port = await freePort();
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: CWD, env: baseEnv({ PORT: String(port), JWT_SECRET: 'safety-test', SESSION_SECRET: 'safety-test' }), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.status === 200) return; } catch (e) { /* 아직 */ } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('서버가 뜨지 않았습니다: ' + logs);
});
test.after(async () => { if (child) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; } });
const req = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
  r.on('error', reject); if (body !== undefined) r.write(body); r.end();
});

test('352-3. 로컬(DATABASE_URL 없음)은 기본값으로 시작한다', async () => {
  assert.equal((await req('GET', '/')).status, 200);
  assert.ok(logs.includes('사전 서버 실행 중'));
});

test('352-4. 잘못된 JSON 요청은 400 과 짧은 JSON(내부 메시지·스택 없음), 정상 요청과 다른 경로는 영향 없음', async () => {
  const bad = await req('POST', '/api/wordbook', { headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400); assert.match(bad.headers['content-type'], /json/);
  assert.deepEqual(JSON.parse(bad.body), { error: '요청 형식이 올바르지 않습니다.' });
  assert.ok(!/SyntaxError|Unexpected|at .*\(|node_modules|body-parser/.test(bad.body), '내부 내용 없음: ' + bad.body);
  const ok = await req('POST', '/api/wordbook', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(ok.status, 401, '정상 JSON 은 예전처럼 인증 단계(401)로 간다');
  assert.equal((await req('GET', '/api/me')).status, 401);
});

test('352-5. 처리되지 않은 라우트 오류는 500 과 고정 JSON, 너무 큰 본문은 413, 이미 응답을 보낸 경우는 덮어쓰지 않고, 로그에는 오류 이름·메시지만', async () => {
  const lines = []; const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
  try {
    const app = express(); app.use(express.json({ limit: '10b' }));
    app.get('/boom', () => { throw new Error('secret db password=abc'); });
    app.get('/late', (req, res, next) => { res.write('x'); next(new Error('after send')); });
    app.post('/p', (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const r = await fetch(base + '/boom');
      assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: '서버 오류가 발생했습니다.' });
      assert.ok(lines.some(l => l.includes('Error secret db password=abc')) && !lines.some(l => /\n\s+at /.test(l)), '이름·메시지만 로그(스택 없음)');
      const big = await fetch(base + '/p', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(100) }) });
      assert.equal(big.status, 413); assert.deepEqual(await big.json(), { error: '요청이 너무 큽니다.' });
      const late = await fetch(base + '/late').catch(() => null);   // 이미 시작한 응답은 처리기가 덮어쓰지 않는다
      if (late) { const t = await late.text().catch(() => 'x'); assert.ok(!t.includes('서버 오류가 발생했습니다.')); }
    } finally { await new Promise(r => srv.close(r)); }
  } finally { console.error = orig; }
});

test('352-6. GET /auth/logout 은 없어졌다(404). 로그인 시작 경로 등 다른 경로는 그대로', async () => {
  assert.equal((await req('GET', '/auth/logout')).status, 404);
  assert.notEqual((await req('GET', '/auth/google')).status, 404, '다른 auth 경로는 영향 없음');
  assert.ok(!/auth\/logout/.test(fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8')));
});

test('352-7. CORS: 다른 Origin 에는 허용 헤더가 없고(사전 요청도), 같은 사이트와 Origin 없는 요청은 정상', async () => {
  const same = `http://127.0.0.1:${port}`;
  const evil = await req('GET', '/', { headers: { Origin: 'http://evil.example' } });
  assert.equal(evil.status, 200); assert.equal(evil.headers['access-control-allow-origin'], undefined, '다른 출처에는 허용 헤더 없음');
  const pre = await req('OPTIONS', '/api/me', { headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(pre.headers['access-control-allow-origin'], undefined); assert.equal(pre.headers['access-control-allow-headers'], undefined);
  const ok = await req('GET', '/', { headers: { Origin: same } });
  assert.equal(ok.status, 200); assert.equal(ok.headers['access-control-allow-origin'], same);
  const preSame = await req('OPTIONS', '/api/me', { headers: { Origin: same, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(preSame.headers['access-control-allow-origin'], same);
  const none = await req('GET', '/api/me');
  assert.equal(none.status, 401, 'Origin 없는 서버 대 서버 요청은 그대로 인증 단계로');
  const weird = await req('GET', '/', { headers: { Origin: 'not a url' } });
  assert.equal(weird.status, 200); assert.equal(weird.headers['access-control-allow-origin'], undefined);
});

test('352-8. corsOptions: Host 와 Origin 호스트가 같을 때만 허용', () => {
  const run = (origin, host) => { let o; corsOptions({ headers: { origin, host } }, (e, v) => { o = v.origin; }); return o; };
  assert.equal(run('https://app.example.com', 'app.example.com'), true);
  assert.equal(run('https://other.example.com', 'app.example.com'), false);
  assert.equal(run('https://app.example.com.evil.io', 'app.example.com'), false);
  assert.equal(run(undefined, 'app.example.com'), false);
});
