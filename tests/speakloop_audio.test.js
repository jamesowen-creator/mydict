// 작업395: Speak Loop 원문 음성 — 관리자 현황·생성 API, 사용자 재생 API. 가짜 DB·가짜 OpenAI(fetch)만 쓰며 실제 호출은 없다.
// 실행: node --test tests/speakloop_audio.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp } = require('./helpers/app');
const { createSlDb, installOpenAiFetch, mp3, fail } = require('./helpers/speakloop_db');

const ENV_KEYS = ['OPENAI_API_KEY', 'SPEAKLOOP_TTS_MODEL', 'SPEAKLOOP_TTS_VOICE', 'SPEAKLOOP_TTS_INSTRUCTIONS', 'SPEAKLOOP_GEN_MAX_PER_RUN', 'SPEAKLOOP_TTS_COST_PER_1K_CHARS'];
async function setup(t, handler = (b, n) => mp3(n)) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; if (k !== 'OPENAI_API_KEY') delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  const db = createSlDb();
  const app = await startApp(['routes/speakloop.js'], { db });
  const ai = installOpenAiFetch(handler);
  t.after(() => {
    ai.restore();
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    return app.close();
  });
  const admin = (method, p, body, user = 4) => app.call(method, p, body, { user });
  return { db, app, ai, status: user => admin('GET', '/api/admin/speakloop/audio/status', undefined, user), gen: (body, user) => admin('POST', '/api/admin/speakloop/audio/generate', body, user) };
}
// 시험 서버에 헤더까지 보내는 원본 요청(재생 API 용)
async function rawGet(app, p, user, headers = {}) {
  const token = jwt.sign({ id: user, email: 'u' + user + '@example.com' }, process.env.JWT_SECRET || 'mydict-jwt-secret');
  const r = await fetch(app.base + p, { headers: { Authorization: 'Bearer ' + token, ...headers } });
  return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
}

// ───── 관리자 현황 ─────
test('status: 아무것도 없으면 전체 318 · 부족 318 · 생성할 글자 8,323 · 추정 비용(임시 단가 0.030) · OpenAI 호출 없음, audio 열은 읽지 않음', async t => {
  const { status, db, ai } = await setup(t);
  const r = await status();
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.total, r.body.have, r.body.missing, r.body.stale], [318, 0, 318, 0]);
  assert.equal(r.body.chars_to_generate, 8323);
  assert.equal(r.body.est_cost_usd, +(8323 / 1000 * 0.03).toFixed(4));
  assert.equal(r.body.cost_estimated, true);
  assert.equal(r.body.model, 'gpt-4o-mini-tts');
  assert.equal(r.body.voice, 'alloy');
  assert.deepEqual(Object.fromEntries(Object.entries(r.body.by_kind).map(([k, v]) => [k, v.total])), { idiom: 20, sentence: 70, chunk: 228 });
  assert.equal(r.body.bytes, 0);
  assert.equal(ai.calls.length, 0);
  assert.deepEqual(db.queries.filter(q => /speakloop_audio/.test(q)), ['SELECT clip_key, kind, content_hash, bytes FROM speakloop_audio'], 'audio 열을 읽는 문장이 없다');
});

test('단가 환경변수가 있으면 추정이 아닌 그 단가로 계산한다', async t => {
  const { status } = await setup(t);
  process.env.SPEAKLOOP_TTS_COST_PER_1K_CHARS = '0.015';
  const r = await status();
  assert.equal(r.body.cost_estimated, false);
  assert.equal(r.body.est_cost_usd, +(8323 / 1000 * 0.015).toFixed(4));
});

test('관리자만: 권한 있는 일반 사용자(perm_speakloop true)와 권한 없는 사용자는 403 이고 OpenAI 를 부르지 않는다', async t => {
  const { status, gen, ai } = await setup(t);
  for (const u of [1, 3, 77]) {
    assert.equal((await status(u)).status, 403, 'status ' + u);
    assert.equal((await gen({ max: 1 }, u)).status, 403, 'generate ' + u);
  }
  assert.equal(ai.calls.length, 0);
  assert.equal((await status(5)).status, 200, '이메일 관리자');
});

// ───── 생성 ─────
test('generate: max 만큼만 만들고 행·사용량(speakloop_tts, 글자 수)이 기록되며 요청 형식이 맞다', async t => {
  const { gen, db, ai } = await setup(t);
  const r = await gen({ max: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, generated: 3, remaining: 315, stopped_reason: null });
  assert.equal(ai.calls.length, 3);
  assert.deepEqual([...db.audio.keys()], ['hang-out.say', 'hang-out.ex', 'hang-out.ex.c0']);
  assert.deepEqual(db.usage.map(u => [u.user_id, u.event_type, u.model, u.char_count]), [[4, 'speakloop_tts', 'gpt-4o-mini-tts', 8], [4, 'speakloop_tts', 'gpt-4o-mini-tts', 34], [4, 'speakloop_tts', 'gpt-4o-mini-tts', 10]]);
  const c = ai.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(c.headers.Authorization, 'Bearer sk-test-fake');
  assert.deepEqual([c.body.model, c.body.voice, c.body.response_format, c.body.input], ['gpt-4o-mini-tts', 'alloy', 'mp3', 'hang out']);
  const row = db.audio.get('hang-out.ex');
  assert.equal(row.bytes, row.audio.length);
  assert.equal(row.kind, 'sentence');
});

test('generate: max 는 SPEAKLOOP_GEN_MAX_PER_RUN(기본 40)을 넘지 못하고, 생략하면 그 상한만큼 만든다', async t => {
  const { gen, ai } = await setup(t);
  const a = await gen({ max: 1000 });
  assert.equal(a.body.generated, 40);
  assert.equal(ai.calls.length, 40);
  process.env.SPEAKLOOP_GEN_MAX_PER_RUN = '5';
  const b = await gen({});
  assert.equal(b.body.generated, 5);
  assert.equal(b.body.remaining, 318 - 40 - 5);
});

test('generate: 입력 검증(max 는 1 이상 정수, kind 는 idiom/sentence/chunk) · 키가 없으면 503', async t => {
  const { gen, ai } = await setup(t);
  for (const max of [0, -1, 1.5, '3', null]) assert.equal((await gen({ max })).status, 400, String(max));
  assert.equal((await gen({ kind: 'word' })).status, 400);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await gen({ max: 1 })).status, 503);
  assert.equal(ai.calls.length, 0);
});

test('generate: 두 번째 실행은 0개(멱등) — kind 필터와 함께 이디엄 20개를 다 만든 뒤 다시 해도 호출이 늘지 않는다', async t => {
  const { gen, ai, status } = await setup(t);
  const a = await gen({ max: 40, kind: 'idiom' });
  assert.equal(a.body.generated, 20);
  assert.equal(a.body.remaining, 0);
  const n = ai.calls.length;
  const b = await gen({ max: 40, kind: 'idiom' });
  assert.deepEqual(b.body, { ok: true, generated: 0, remaining: 0, stopped_reason: null });
  assert.equal(ai.calls.length, n);
  const s = await status();
  assert.equal(s.body.by_kind.idiom.have, 20);
  assert.equal(s.body.by_kind.sentence.have, 0);
  assert.ok(s.body.bytes > 0);
});

test('모델·음성·instructions 가 바뀌면 "오래됨"으로 잡히고 다시 생성 대상이 된다', async t => {
  const { gen, status, ai } = await setup(t);
  await gen({ max: 2 });
  assert.deepEqual([(await status()).body.have, (await status()).body.stale], [2, 0]);
  for (const [name, value] of [['SPEAKLOOP_TTS_VOICE', 'nova'], ['SPEAKLOOP_TTS_INSTRUCTIONS', 'Speak slowly.'], ['SPEAKLOOP_TTS_MODEL', 'tts-1']]) {
    const before = process.env[name];
    process.env[name] = value;
    const s = await status();
    assert.equal(s.body.stale, 2, name + ' → 오래됨');
    assert.equal(s.body.have, 0);
    assert.equal(s.body.missing, 316);
    if (before === undefined) delete process.env[name]; else process.env[name] = before;
    assert.equal((await status()).body.have, 2, '원래대로 돌리면 다시 최신');
  }
  // 오래된 것은 다시 만들어 최신이 된다(같은 키를 덮어씀)
  process.env.SPEAKLOOP_TTS_VOICE = 'nova';
  const n = ai.calls.length;
  const r = await gen({ max: 2 });
  assert.equal(r.body.generated, 2);
  assert.equal(ai.calls.length, n + 2);
  assert.equal((await status()).body.have, 2);
});

test('instructions: 구(chunk)에만 조각 문장이 덧붙고, tts-1 계열 모델이면 instructions 가 요청에서 빠진다', async t => {
  const { gen, ai } = await setup(t);
  const { CHUNK_NOTE, DEFAULT_INSTRUCTIONS } = require('../lib/speakloop_tts');
  await gen({ max: 1, kind: 'idiom' });
  await gen({ max: 1, kind: 'sentence' });
  await gen({ max: 1, kind: 'chunk' });
  const [idiom, sentence, chunk] = ai.calls.map(c => c.body);
  assert.equal(idiom.instructions, DEFAULT_INSTRUCTIONS);
  assert.equal(sentence.instructions, DEFAULT_INSTRUCTIONS);
  assert.equal(chunk.instructions, DEFAULT_INSTRUCTIONS + ' ' + CHUNK_NOTE);
  assert.equal(chunk.input, 'We used to');
  assert.ok(!idiom.instructions.includes('fragment') && !sentence.instructions.includes('fragment'));
  process.env.SPEAKLOOP_TTS_MODEL = 'tts-1';
  await gen({ max: 1, kind: 'chunk' });
  const legacy = ai.calls[ai.calls.length - 1].body;
  assert.equal(legacy.model, 'tts-1');
  assert.ok(!('instructions' in legacy));
});

test('오류(401·403·429·500)·네트워크·타임아웃이면 즉시 멈추고 지금까지 만든 개수와 이유를 돌려준다(재시도 없음)', async t => {
  for (const [label, handler, reason] of [
    ['401', (b, n) => n < 3 ? mp3(n) : fail(401), 'openai_401'],
    ['403', (b, n) => n < 3 ? mp3(n) : fail(403), 'openai_403'],
    ['429', (b, n) => n < 3 ? mp3(n) : fail(429), 'openai_429'],
    ['500', (b, n) => n < 3 ? mp3(n) : fail(500), 'openai_500'],
    ['network', (b, n) => { if (n < 3) return mp3(n); throw new TypeError('fetch failed'); }, 'network'],
    ['timeout', (b, n) => { if (n < 3) return mp3(n); throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, 'timeout'],
  ]) {
    await t.test(label, async sub => {
      const { gen, ai, db } = await setup(sub, handler);
      const origError = console.error; console.error = () => {};
      sub.after(() => { console.error = origError; });
      const r = await gen({ max: 10 });
      assert.deepEqual(r.body, { ok: true, generated: 2, remaining: 316, stopped_reason: reason });
      assert.equal(ai.calls.length, 3, '실패한 호출 뒤로는 부르지 않는다');
      assert.equal(db.audio.size, 2);
      assert.equal(db.usage.length, 2, '실패한 호출은 사용량에 기록하지 않는다');
    });
  }
});

test('동시에 두 번 실행하면 두 번째는 409, 첫 번째는 끝까지 진행한다', async t => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { gen, ai } = await setup(t, async (b, n) => { await gate; return mp3(n); });
  const first = gen({ max: 2 });
  for (let i = 0; i < 200 && ai.calls.length < 1; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(ai.calls.length, 1, '첫 실행이 OpenAI 호출 중');
  const second = await gen({ max: 2 });
  assert.equal(second.status, 409);
  assert.equal(ai.calls.length, 1);
  release();
  const done = await first;
  assert.equal(done.status, 200);
  assert.equal(done.body.generated, 2);
  assert.equal((await gen({ max: 1 })).status, 200, '끝난 뒤에는 다시 실행할 수 있다');
});

// ───── 사용자 재생 ─────
test('재생: 권한이 없으면 403, 콘텐츠에 없는 키는 404(DB 조회 없음), 저장 없으면 404 — OpenAI 는 부르지 않는다', async t => {
  const { app, db, ai } = await setup(t);
  assert.equal((await rawGet(app, '/api/speakloop/audio/hang-out.say', 3)).status, 403);
  for (const key of ['nope', 'hang-out.ex.c9', 'hang-out', 'm-delay.l5', '..%2Fserver.js', 'hang-out.say.']) {
    assert.equal((await rawGet(app, '/api/speakloop/audio/' + key, 1)).status, 404, key);
  }
  assert.deepEqual(db.queries.filter(q => /speakloop_audio/.test(q)), [], '키 검사에서 걸러져 음성 테이블을 건드리지 않는다');
  assert.equal((await rawGet(app, '/api/speakloop/audio/hang-out.say', 1)).status, 404, '저장 없음');
  assert.equal(ai.calls.length, 0);
});

test('재생: 저장된 키는 audio/mpeg 본문 + ETag(content_hash) + private 캐시, If-None-Match 가 맞으면 304(본문 조회 없음)', async t => {
  const { app, db, ai } = await setup(t);
  db.audio.set('hang-out.say', { kind: 'idiom', text: 'hang out', content_hash: 'abc123', model: 'm', voice: 'v', audio: Buffer.from('ID3-audio'), bytes: 9 });
  const r = await rawGet(app, '/api/speakloop/audio/hang-out.say', 1);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.equal(r.headers.get('etag'), '"abc123"');
  assert.equal(r.headers.get('cache-control'), 'private, max-age=86400');
  assert.equal(r.buf.toString(), 'ID3-audio');
  const bodyQueries = () => db.queries.filter(q => /^SELECT audio FROM/.test(q)).length;
  const before = bodyQueries();
  const c = await rawGet(app, '/api/speakloop/audio/hang-out.say', 1, { 'If-None-Match': '"abc123"' });
  assert.equal(c.status, 304);
  assert.equal(c.buf.length, 0);
  assert.equal(bodyQueries(), before, '304 에서는 오디오 열을 읽지 않는다');
  assert.equal((await rawGet(app, '/api/speakloop/audio/hang-out.say', 1, { 'If-None-Match': '"old"' })).status, 200);
  assert.equal(ai.calls.length, 0);
});

test('audio-index: 저장된 클립의 {키: content_hash} 만, 콘텐츠에 없는 키는 빼고, audio 열은 읽지 않는다', async t => {
  const { app, db } = await setup(t);
  db.audio.set('hang-out.say', { kind: 'idiom', text: 'x', content_hash: 'h1', model: 'm', voice: 'v', audio: Buffer.from('a'), bytes: 1 });
  db.audio.set('zzz.say', { kind: 'idiom', text: 'x', content_hash: 'h2', model: 'm', voice: 'v', audio: Buffer.from('a'), bytes: 1 });
  const r = await app.call('GET', '/api/speakloop/audio-index', undefined, { user: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, index: { 'hang-out.say': 'h1' } });
  assert.ok(db.queries.includes('SELECT clip_key, content_hash FROM speakloop_audio'));
  assert.ok(!db.queries.some(q => /^SELECT audio/.test(q)));
});

test('calcCost: speakloop_tts 이벤트가 비용으로 계산된다(글자 수/1000 × 단가)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.match(src, /r\.event_type === 'speakloop_tts'/);
  assert.match(src, /Number\(r\.char_count\) \/ 1000\) \* \(Number\.isFinite\(per1k\)/);
});
