// 작업334: /api/tts 서버 안전 강화 시험 — 잘못된 입력·예외로 서버가 멈추지 않고, 캐시 삭제는 관리자 전용이다. 정상 요청의 동작(응답·헤더·500자 자르기·비로그인 허용·can_tts 검사)은 그대로다.
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
  const db = { cache: new Map(), users: new Map(), usage: [], queries: [], failCache: false, failUsage: false };
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
  return { db, t, post: (body, user = null) => raw('POST', '/api/tts', body, user), del: (user = null) => raw('DELETE', '/api/tts/cache', undefined, user) };
}
// 응답 헤더·바이트까지 보려고 직접 요청
async function postRaw(a, body) {
  const r = await realFetch(a.t.base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  assert.deepEqual(a.db.usage, [{ userId: undefined, eventType: 'tts', model: 'tts-1-hd', chars: 11 }], '캐시 미스만 사용량(글자 수) 기록');
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

test('can_tts·차단 검사와 비로그인 허용은 그대로: 비로그인 200, can_tts 없음 403, 차단 403, 권한 있음 200, 관리자 200', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.post({ text: 'anon' }, null)).status, 200, '비로그인 호출 허용');
  assert.equal((await a.post({ text: 'ok' }, 7)).status, 200);
  const no = await a.post({ text: 'x' }, 8); assert.equal(no.status, 403); assert.deepEqual(no.body, { error: 'TTS 권한이 없습니다.' });
  assert.equal((await a.post({ text: 'x2' }, 5)).status, 403, '차단된 사용자');
  assert.equal((await a.post({ text: 'adm' }, 9)).status, 200);
  assert.equal((await a.post({ text: 'x', lang: 'fr' }, 8)).status, 400, '입력 검증이 권한 검사보다 먼저(기존 순서)');
  assert.equal(openai.calls.length, 3);
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
