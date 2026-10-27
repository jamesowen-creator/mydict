// 작업334: /api/tts 서버 안전 강화 시험 — 잘못된 입력·예외로 서버가 멈추지 않고, 캐시 삭제는 관리자 전용이다. 정상 요청의 동작(응답·헤더·500자 자르기·can_tts 검사)은 그대로다.
// 작업337: /api/tts 는 로그인 필수(비로그인 401), 관리자는 can_tts 제외, 캐시 미스만 하루 사용량(30000자·150회) 제한(429), 확인 DB 오류는 503. 아래 337 시험.
// 모의 DB(tts_cache·users)와 모의 OpenAI(전역 fetch 가로채기)만 쓴다. 운영 서버·운영 DB·실제 OpenAI 와 무관.
// 실행: node --test tests/tts_safety.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_EMAILS = 'u9@example.com';   // 관리자 계정(requireAdmin 이 이메일로 확인)
process.env.OPENAI_API_KEY = 'test-openai-key';
const { startApp } = require('./helpers/app');

// 모의 DB: tts_cache·users 만 흉내 낸다
function createDb() {
  const db = { cache: new Map(), users: new Map(), usage: [], queries: [], failCache: false, failUsage: false, failUsageCheck: false };
  db.users.set(7, { is_blocked: false, can_tts: true, role: 'user' });
  db.users.set(8, { is_blocked: false, can_tts: false, role: 'user' });
  db.users.set(5, { is_blocked: true, can_tts: true, role: 'user' });
  db.users.set(9, { is_blocked: false, can_tts: true, role: 'admin' });
  db.pool = {
    query: async (sql, params = []) => {
      db.queries.push(sql);
      if (/^SELECT audio FROM tts_cache/.test(sql)) { const r = db.cache.get(params[1] + '|' + params[0]); return { rows: r ? [{ audio: r }] : [] }; }
      if (/^\s*INSERT INTO tts_cache/.test(sql)) { const k = params[1] + '|' + params[0]; if (!db.cache.has(k)) db.cache.set(k, params[2]); return { rowCount: 1, rows: [] }; }
      if (/^DELETE FROM tts_cache/.test(sql)) { if (db.failCache) throw new Error('boom: secret table detail'); const n = db.cache.size; db.cache.clear(); return { rowCount: n, rows: [] }; }
      if (/^SELECT is_blocked, can_tts FROM users/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ is_blocked: u.is_blocked, can_tts: u.can_tts }] : [] }; }
      if (/^SELECT role FROM users/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ role: u.role }] : [] }; }
      if (/FROM api_usage/.test(sql)) { if (db.failUsageCheck) throw new Error('usage check boom'); const mine = db.usage.filter(u => u.userId === params[0] && u.eventType === 'tts'); return { rows: [{ n: mine.length, chars: mine.reduce((a, u) => a + (u.chars || 0), 0) }] }; }
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 60));
    },
  };
  db.trackUsage = (userId, eventType, model, inTok, outTok, chars) => { if (db.failUsage) throw new Error('usage boom'); db.usage.push({ userId, eventType, model, chars }); };
  return db;
}

// 모의 OpenAI: 전역 fetch 중 OpenAI 주소만 가로챈다(시험 서버로 가는 요청은 그대로 통과)
const realFetch = globalThis.fetch;
const openai = { calls: [], fail: false };
const AUDIO = Buffer.from('FAKE-MP3-BYTES');
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.openai.com/')) {
    openai.calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
    if (openai.fail) return { ok: false, text: async () => 'upstream error: internal-secret-detail', arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, text: async () => '', arrayBuffer: async () => AUDIO.buffer.slice(AUDIO.byteOffset, AUDIO.byteOffset + AUDIO.length) };
  }
  return realFetch(url, opts);
};
test.after(() => { globalThis.fetch = realFetch; });

let rejections = 0;
const onRej = () => { rejections++; };
process.on('unhandledRejection', onRej);
test.after(() => process.off('unhandledRejection', onRej));

async function setup() {
  const db = createDb();
  openai.calls.length = 0; openai.fail = false; process.env.OPENAI_API_KEY = 'test-openai-key';
  const t = await startApp(['routes/tts.js'], { db });
  const raw = (method, url, body, user = null) => t.call(method, url, body, { user });
  return { db, t, post: (body, user = 7) => raw('POST', '/api/tts', body, user), del: (user = null) => raw('DELETE', '/api/tts/cache', undefined, user) };
}
// 응답 헤더·바이트까지 보려고 직접 요청
async function postRaw(a, body, user = 7) {
  const headers = { 'Content-Type': 'application/json' }; if (user !== null) headers.Authorization = 'Bearer ' + require('jsonwebtoken').sign({ id: user, email: 'u' + user + '@example.com' }, process.env.JWT_SECRET || 'mydict-jwt-secret');   // 작업337: 로그인 필수
  const r = await realFetch(a.t.base + '/api/tts', { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('x-tts-cache'), bytes: Buffer.from(await r.arrayBuffer()) };
}

test('text 가 문자열이 아니거나 비어 있으면 400 이고 예외 없이 서버가 계속 살아 있다(OpenAI·DB 를 부르지 않는다)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const before = rejections;
  for (const bad of [5, 0, null, {}, [], ['a'], true, { text: 'x' }, undefined, '', '   ', '\n\t ']) {
    const r = await a.post({ text: bad });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.deepEqual(r.body, { error: 'text is required' });
  }
  assert.equal((await a.post({})).status, 400, 'text 키 없음');
  assert.equal((await a.post(undefined)).status, 400, '본문 없음');
  assert.equal((await a.post([1, 2])).status, 400, '본문이 배열');
  assert.equal(openai.calls.length, 0); assert.ok(!a.db.queries.some(q => /tts_cache/.test(q)), '캐시 조회도 없음');
  assert.equal(rejections, before, '처리되지 않은 거부 없음');
  assert.equal((await a.post({ text: 'hello' })).status, 200, '그 뒤 정상 요청이 처리된다');
});

test('lang 허용 목록(en·ko·ja·zh): 통과, 없으면 en, 목록 밖·형식 오류는 400', async t => {
  const a = await setup(); t.after(() => a.t.close());
  for (const lang of ['en', 'ko', 'ja', 'zh']) { const r = await a.post({ text: 'w-' + lang, lang }); assert.equal(r.status, 200, lang); }
  assert.deepEqual(openai.calls.map(c => c.body.voice), ['onyx', 'nova', 'nova', 'nova'], '영어 onyx, 그 밖의 언어 nova');
  const n0 = openai.calls.length;
  const noLang = await a.post({ text: 'no-lang' }); assert.equal(noLang.status, 200); assert.equal(openai.calls[n0].body.voice, 'onyx', 'lang 없으면 기본 en');
  assert.ok([...a.db.cache.keys()].includes('en|no-lang'), '기본 lang 은 en 으로 캐시 키에 들어간다');
  const n1 = openai.calls.length;
  for (const bad of ['fr', 'EN', 'en ', '', 'zh-Hans', 'zh-CN', 'a'.repeat(50), null, 5, {}, [], true]) {
    const r = await a.post({ text: 'x', lang: bad }); assert.equal(r.status, 400, JSON.stringify(bad)); assert.deepEqual(r.body, { error: 'lang is not supported' });
  }
  assert.equal(openai.calls.length, n1, '목록 밖 lang 은 OpenAI 를 부르지 않는다');
});

test('정상 요청은 그대로: MISS 응답(audio/mpeg·X-TTS-Cache)·OpenAI 호출 내용·사용량 기록, 두 번째는 HIT 이고 OpenAI 를 다시 부르지 않는다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const m = await postRaw(a, { text: '  hello world  ', lang: 'en' });
  assert.equal(m.status, 200); assert.equal(m.type, 'audio/mpeg'); assert.equal(m.cache, 'MISS'); assert.deepEqual(m.bytes, AUDIO);
  assert.equal(openai.calls.length, 1); const c = openai.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/audio/speech'); assert.equal(c.headers.Authorization, 'Bearer test-openai-key');
  assert.deepEqual(c.body, { model: 'tts-1-hd', input: 'hello world', voice: 'onyx', response_format: 'mp3' });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(a.db.usage, [{ userId: 7, eventType: 'tts', model: 'tts-1-hd', chars: 11 }], '캐시 미스만 사용량(글자 수) 기록');
  assert.ok(a.db.cache.has('en|hello world'), '캐시에 저장(앞뒤 공백 제거)');
  const h = await postRaw(a, { text: 'hello world', lang: 'en' });
  assert.equal(h.status, 200); assert.equal(h.cache, 'HIT'); assert.equal(h.type, 'audio/mpeg'); assert.deepEqual(h.bytes, AUDIO); assert.equal(openai.calls.length, 1, '적중은 OpenAI 를 부르지 않는다'); assert.equal(a.db.usage.length, 1);
  const ko = await postRaw(a, { text: '안녕', lang: 'ko' }); assert.equal(ko.cache, 'MISS'); assert.equal(openai.calls[1].body.voice, 'nova');
  assert.equal((await postRaw(a, { text: 'hello world', lang: 'ko' })).cache, 'MISS', '캐시 키는 text+lang');
});

test('500자 초과 입력은 거부하지 않고 앞 500자로 자른다(OpenAI 입력·캐시 키 모두)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const long = 'a'.repeat(450) + 'b'.repeat(150);
  const r = await a.post({ text: long }); assert.equal(r.status, 200);
  assert.equal(openai.calls[0].body.input.length, 500); assert.equal(openai.calls[0].body.input, long.slice(0, 500));
  assert.ok(a.db.cache.has('en|' + long.slice(0, 500)));
  await new Promise(r2 => setImmediate(r2)); assert.equal(a.db.usage[0].chars, 500);
  const exact = await a.post({ text: 'c'.repeat(500) }); assert.equal(exact.status, 200); assert.equal(openai.calls[1].body.input.length, 500);
  const again = await postRaw(a, { text: long }); assert.equal(again.cache, 'HIT', '같은 긴 입력은 적중');
});

test('can_tts·차단 검사는 그대로: can_tts 없음 403, 차단 403, 권한 있음 200, 관리자 200 (작업337: 비로그인은 이제 401)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.post({ text: 'anon' }, null)).status, 401, '작업337: 비로그인 호출은 401(옛 단언: 200)');
  assert.equal((await a.post({ text: 'ok' }, 7)).status, 200);
  const no = await a.post({ text: 'x' }, 8); assert.equal(no.status, 403); assert.deepEqual(no.body, { error: 'TTS 권한이 없습니다.' });
  assert.equal((await a.post({ text: 'x2' }, 5)).status, 403, '차단된 사용자');
  assert.equal((await a.post({ text: 'adm' }, 9)).status, 200);
  assert.equal((await a.post({ text: 'x', lang: 'fr' }, 8)).status, 400, '입력 검증이 권한 검사보다 먼저(기존 순서)');
  assert.equal(openai.calls.length, 2);   // 작업337: 비로그인 호출이 빠져 3 → 2
});

test('예외 방지: OpenAI 오류·키 없음·사용량 기록 예외가 모두 일반 문구로 응답하고 서버는 살아 있다. 오류 본문에 내부 오류 문구가 없다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const before = rejections;
  const origErr = console.error; const logs = []; console.error = (...x) => logs.push(x.join(' '));
  try {
    openai.fail = true;
    const r = await a.post({ text: 'fail one' });
    assert.equal(r.status, 500); assert.deepEqual(r.body, { error: 'TTS 생성 실패' }); assert.ok(!JSON.stringify(r.body).includes('internal-secret-detail'));
    assert.ok(logs.some(l => /TTS error/.test(l) && /internal-secret-detail/.test(l)), '상세는 서버 로그에만');
    openai.fail = false;
    a.db.failUsage = true;   // 핸들러 안 예기치 못한 예외 → 500 으로 응답(프로세스는 유지)
    const r2 = await a.post({ text: 'usage throws' });
    assert.equal(r2.status, 500); assert.deepEqual(r2.body, { error: 'TTS 생성 실패' });
    a.db.failUsage = false;
    const prevKey = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    const r3 = await a.post({ text: 'no key' }); assert.equal(r3.status, 503); process.env.OPENAI_API_KEY = prevKey;
  } finally { console.error = origErr; }
  assert.equal(rejections, before); assert.equal((await a.post({ text: 'still alive' })).status, 200);
});

test('DELETE /api/tts/cache 는 관리자 전용: 비로그인 401, 일반 사용자 403, 관리자 200(삭제 개수), 오류 본문에 e.message 없음', async t => {
  const a = await setup(); t.after(() => a.t.close());
  await a.post({ text: 'one' }); await a.post({ text: 'two' }); assert.equal(a.db.cache.size, 2);
  const anon = await a.del(null); assert.equal(anon.status, 401); assert.equal(a.db.cache.size, 2, '삭제되지 않았다');
  const user = await a.del(7); assert.equal(user.status, 403); assert.equal(a.db.cache.size, 2);
  const blocked = await a.del(5); assert.equal(blocked.status, 403);
  const adm = await a.del(9); assert.equal(adm.status, 200); assert.deepEqual(adm.body, { ok: true, deleted: 2 }); assert.equal(a.db.cache.size, 0);
  a.db.failCache = true;
  const origErr = console.error; const logs = []; console.error = (...x) => logs.push(x.join(' '));
  let e;
  try { e = await a.del(9); } finally { console.error = origErr; }
  assert.equal(e.status, 500); assert.deepEqual(e.body, { error: '캐시 삭제에 실패했습니다.' }); assert.ok(!JSON.stringify(e.body).includes('boom') && !JSON.stringify(e.body).includes('secret'), 'e.message 비노출');
  assert.ok(logs.some(l => /boom/.test(l)), '상세는 서버 로그에만');
  // 관리자 판별은 admin.js 와 같은 requireAdmin: 이메일(ADMIN_EMAILS) 또는 DB role
  a.db.users.set(11, { is_blocked: false, can_tts: true, role: 'admin' }); a.db.failCache = false;
  assert.equal((await a.del(11)).status, 200, 'DB role 이 admin 이면 허용');
});

test('server.js 에는 처리되지 않은 거부를 로그만 남기고 종료하지 않는 전역 핸들러가 있다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf("process.on('unhandledRejection'"); assert.ok(i > 0);
  const body = src.slice(i, src.indexOf('});', i));
  assert.ok(/console\.error/.test(body) && !/process\.exit|throw /.test(body), '로그만 남기고 종료하지 않는다');
  // 라우트 파일이 그대로 쓰이는지: tts.js 는 requireAdmin 으로 캐시 삭제를 잠그고 허용 lang 목록을 가진다
  const tts = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tts.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(tts, /router\.delete\('\/api\/tts\/cache', requireAdmin,/); assert.match(tts, /TTS_LANGS = \['en', 'ko', 'ja', 'zh'\]/);
  assert.ok(!/res\.status\(500\)\.json\(\{ error: e\.message \}\)/.test(tts), 'e.message 를 응답에 싣지 않는다');
});

// ---- 작업337: 로그인 필수 + 권한 + 하루 사용량 제한 ----
test('337-1. 로그인 필수: 토큰 없음·잘못된 토큰 401(OpenAI·DB 를 부르지 않는다), 캐시에 있어도 토큰 없으면 401, 입력 검증보다 먼저', async t => {
  const a = await setup(); t.after(() => a.t.close());
  await a.post({ text: 'cached' }); const n = openai.calls.length;
  const none = await a.post({ text: 'cached' }, null); assert.equal(none.status, 401); assert.deepEqual(none.body, { error: '로그인이 필요합니다.' });
  const bad = await realFetch(a.t.base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-token' }, body: JSON.stringify({ text: 'cached' }) });
  assert.equal(bad.status, 401); assert.deepEqual(await bad.json(), { error: '유효하지 않은 토큰입니다.' });
  const raw = await realFetch(a.t.base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 5 }) });
  assert.equal(raw.status, 401, '토큰이 없으면 잘못된 입력도 401(인증이 맨 앞)');
  assert.equal(openai.calls.length, n); assert.equal((await postRaw(a, { text: 'cached' })).cache, 'HIT', '로그인하면 캐시 적중');
});

test('337-2. can_tts: false 는 403, 관리자(이메일·DB role)는 can_tts 검사에서 제외, 차단 사용자는 403', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.post({ text: 'x' }, 8)).status, 403);
  a.db.users.set(10, { is_blocked: false, can_tts: false, role: 'admin' });   // DB role 관리자인데 can_tts 가 false
  assert.equal((await a.post({ text: 'admin-db' }, 10)).status, 200, 'DB role admin 은 can_tts 검사 제외');
  a.db.users.set(9, { is_blocked: false, can_tts: false, role: 'user' });     // u9@example.com 은 ADMIN_EMAILS(이메일) 관리자
  assert.equal((await a.post({ text: 'admin-mail' }, 9)).status, 200, 'ADMIN_EMAILS 관리자는 can_tts 검사 제외');
  assert.equal((await a.post({ text: 'x' }, 5)).status, 403);
});

test('337-3. 하루 호출 횟수 제한(기본 150): 캐시 미스만 센다 — 150번째까지 통과하고 151번째 미스는 429(한국어 안내), 캐시 적중은 제한 뒤에도 통과, 사용자별', async t => {
  const a = await setup(); t.after(() => a.t.close());
  delete process.env.TTS_DAILY_CALLS_CAP; delete process.env.TTS_DAILY_CHARS_CAP;
  for (let i = 0; i < 150; i++) { const r = await a.post({ text: 'w' + i }); assert.equal(r.status, 200, 'call ' + i); }
  assert.equal(openai.calls.length, 150);
  const over = await a.post({ text: 'w-new' }); assert.equal(over.status, 429); assert.match(over.body.error, /오늘 서버 발음 사용량/); assert.equal(openai.calls.length, 150, '초과하면 OpenAI 를 부르지 않는다');
  const hit = await postRaw(a, { text: 'w0' }); assert.equal(hit.status, 200); assert.equal(hit.cache, 'HIT', '캐시 적중은 제한에 안 걸린다');
  assert.equal(a.db.usage.length, 150, '적중은 사용량에 안 들어간다');
  a.db.users.set(12, { is_blocked: false, can_tts: true, role: 'user' });
  assert.equal((await a.post({ text: 'w-other-user' }, 12)).status, 200, '사용량은 사용자별');
});

test('337-4. 하루 글자 수 제한(기본 30000): 합이 넘으면 429(넘기는 요청 포함), 정확히 채우는 요청은 통과, 관리자에게도 적용', async t => {
  const a = await setup(); t.after(() => a.t.close());
  delete process.env.TTS_DAILY_CALLS_CAP; delete process.env.TTS_DAILY_CHARS_CAP;
  a.db.usage.push({ userId: 7, eventType: 'tts', model: 'tts-1-hd', chars: 29990 });
  assert.equal((await a.post({ text: 'x'.repeat(11) })).status, 429, '29990 + 11 > 30000');
  assert.equal((await a.post({ text: 'y'.repeat(10) })).status, 200, '29990 + 10 = 30000 은 통과');
  assert.equal((await a.post({ text: 'z' })).status, 429, '이제 가득');
  a.db.usage.push({ userId: 9, eventType: 'tts', model: 'tts-1-hd', chars: 30000 });
  assert.equal((await a.post({ text: 'admin-limited' }, 9)).status, 429, '관리자에게도 제한(비용 보호)');
});

test('337-5. 환경변수로 덮어쓰기(TTS_DAILY_CALLS_CAP·TTS_DAILY_CHARS_CAP), 잘못된 값은 기본값, 없어도 기본값으로 동작', async t => {
  const a = await setup(); t.after(() => { a.t.close(); delete process.env.TTS_DAILY_CALLS_CAP; delete process.env.TTS_DAILY_CHARS_CAP; });
  process.env.TTS_DAILY_CALLS_CAP = '2';
  assert.equal((await a.post({ text: 'e1' })).status, 200); assert.equal((await a.post({ text: 'e2' })).status, 200); assert.equal((await a.post({ text: 'e3' })).status, 429, '횟수 2 로 덮어씀');
  process.env.TTS_DAILY_CALLS_CAP = 'abc'; assert.equal((await a.post({ text: 'e3' })).status, 200, '잘못된 값은 기본값 150');
  process.env.TTS_DAILY_CALLS_CAP = '0'; assert.equal((await a.post({ text: 'e4' })).status, 200, '0 은 범위 밖 → 기본값');
  delete process.env.TTS_DAILY_CALLS_CAP; process.env.TTS_DAILY_CHARS_CAP = '20';
  assert.equal((await a.post({ text: 'f'.repeat(30) })).status, 429, '글자 수 20 으로 덮어씀');
});

test('337-6. 제한 확인 중 DB 오류면 503(서버 음성을 쓰지 않는다, OpenAI 호출 없음). 캐시 적중은 영향 없음. 기존 DELETE 관리자 잠금 유지', async t => {
  const a = await setup(); t.after(() => a.t.close());
  await a.post({ text: 'warm' }); const n = openai.calls.length;
  a.db.failUsageCheck = true;
  const origErr = console.error; console.error = () => {};
  let r; try { r = await a.post({ text: 'cold' }); } finally { console.error = origErr; }
  assert.equal(r.status, 503); assert.ok(!JSON.stringify(r.body).includes('boom')); assert.equal(openai.calls.length, n);
  assert.equal((await postRaw(a, { text: 'warm' })).cache, 'HIT', '적중은 제한 확인을 하지 않는다');
  a.db.failUsageCheck = false;
  assert.equal((await a.del(null)).status, 401); assert.equal((await a.del(7)).status, 403); assert.equal((await a.del(9)).status, 200);
});
