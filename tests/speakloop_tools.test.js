// 작업397: Speak Loop 음성 시험 도구(관리자 전용) — 항목별 목록, 항목별 부족분 생성(prefix), 미리듣기. 가짜 DB·가짜 OpenAI(fetch)만 쓴다.
// 실행: node --test tests/speakloop_tools.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp } = require('./helpers/app');
const { createSlDb, installOpenAiFetch, mp3 } = require('./helpers/speakloop_db');

const ENV_KEYS = ['OPENAI_API_KEY', 'SPEAKLOOP_TTS_MODEL', 'SPEAKLOOP_TTS_VOICE', 'SPEAKLOOP_TTS_INSTRUCTIONS', 'SPEAKLOOP_GEN_MAX_PER_RUN', 'SPEAKLOOP_TTS_COST_PER_1K_CHARS'];
async function setup(t, handler = (b, n) => mp3(n)) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; if (k !== 'OPENAI_API_KEY') delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  const db = createSlDb();
  db.users.set(5, { role: 'user', is_approved: true, is_blocked: false, perm_speakloop: false });   // 작업404: 이메일 관리자(u5)도 이제 users 행이 있어야 한다
  const app = await startApp(['routes/speakloop.js'], { db });
  const ai = installOpenAiFetch(handler);
  t.after(() => {
    ai.restore();
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    return app.close();
  });
  const J = (method, p, body, user = 4) => app.call(method, p, body, { user });
  return {
    db, app, ai,
    list: (prefix, user) => J('GET', '/api/admin/speakloop/audio/list' + (prefix === undefined ? '' : '?prefix=' + encodeURIComponent(prefix)), undefined, user),
    gen: (body, user) => J('POST', '/api/admin/speakloop/audio/generate', body, user),
    // 미리듣기는 본문이 mp3 라 JSON 이 아니므로 원본 응답을 읽는다
    preview: async (body, user = 4) => {
      const token = jwt.sign({ id: user, email: 'u' + user + '@example.com' }, process.env.JWT_SECRET || 'mydict-jwt-secret');
      const r = await fetch(app.base + '/api/admin/speakloop/audio/preview', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const buf = Buffer.from(await r.arrayBuffer());
      let json = null; try { json = JSON.parse(buf.toString()); } catch (e) { /* mp3 본문 */ }
      return { status: r.status, type: r.headers.get('content-type'), buf, json };
    },
  };
}
const hashOf = clip => require('../lib/speakloop_tts').contentHash(clip, require('../lib/speakloop_tts').settings());
const clipOf = key => require('../lib/speakloop_content').listClips().find(c => c.key === key);

// ───── list ─────
test('list: 잘못된 prefix 는 400(없음·모르는 id·부분 일치·클립 키·빈 값)', async t => {
  const { list, db } = await setup(t);
  for (const p of [undefined, '', 'nope', 'hang', 'hang-out.say', 'm-', 'M-DELAY']) assert.equal((await list(p)).status, 400, String(p));
  assert.deepEqual(db.queries.filter(q => /speakloop_audio/.test(q)), []);
});

test('list: 비관리자(권한 있는 일반 사용자 포함)는 403', async t => {
  const { list } = await setup(t);
  for (const u of [1, 3, 77]) assert.equal((await list('hang-out', u)).status, 403, String(u));
  assert.equal((await list('hang-out', 5)).status, 200, '이메일 관리자');
});

test('list: 상태 3종(있음·없음·오래됨)을 계산하고 그 항목의 클립만 돌려주며 audio 열은 읽지 않는다', async t => {
  const { list, db, ai } = await setup(t);
  const put = (key, hash) => db.audio.set(key, { kind: clipOf(key).kind, text: clipOf(key).text, content_hash: hash, model: 'm', voice: 'v', audio: Buffer.from('a'), bytes: 1 });
  put('hang-out.say', hashOf(clipOf('hang-out.say')));   // 최신
  put('hang-out.ex', 'old-hash');                        // 설정이 달라진 오래된 것
  put('touch-base.say', hashOf(clipOf('touch-base.say'))); // 다른 항목
  const r = await list('hang-out');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.clips.map(c => [c.key, c.kind, c.state]), [
    ['hang-out.say', 'idiom', '있음'], ['hang-out.ex', 'sentence', '오래됨'],
    ['hang-out.ex.c0', 'chunk', '없음'], ['hang-out.ex.c1', 'chunk', '없음'], ['hang-out.ex.c2', 'chunk', '없음']]);
  assert.equal(r.body.clips[0].text, 'hang out');
  assert.deepEqual([r.body.todo.count, r.body.todo.batch_count], [4, 4]);
  assert.equal(r.body.todo.batch_chars, 34 + 10 + 8 + 14);
  assert.equal(r.body.model, 'gpt-4o-mini-tts');
  assert.deepEqual(db.queries.filter(q => /speakloop_audio/.test(q)), ['SELECT clip_key, kind, content_hash, bytes FROM speakloop_audio'], 'audio 열을 읽지 않는다');
  assert.equal(ai.calls.length, 0, 'OpenAI 호출 없음');
  const m = await list('m-delay');
  assert.equal(m.body.clips.length, 5 + (3 + 4 + 4 + 3 + 4), '독백 항목도 열린다: 문장 5 + 구 18');
  assert.ok(m.body.clips.every(c => c.key.startsWith('m-delay.l')));
});

// ───── generate prefix ─────
test('generate prefix: 그 항목의 부족·오래된 클립만 만들고, 다른 항목은 건드리지 않는다', async t => {
  const { gen, db, ai } = await setup(t);
  const r = await gen({ prefix: 'hang-out' });
  assert.deepEqual(r.body, { ok: true, generated: 5, remaining: 0, stopped_reason: null });
  assert.deepEqual([...db.audio.keys()], ['hang-out.say', 'hang-out.ex', 'hang-out.ex.c0', 'hang-out.ex.c1', 'hang-out.ex.c2']);
  assert.equal(ai.calls.length, 5);
  const again = await gen({ prefix: 'hang-out' });
  assert.deepEqual(again.body, { ok: true, generated: 0, remaining: 0, stopped_reason: null }, '멱등');
  assert.equal(ai.calls.length, 5);
  db.audio.get('hang-out.ex').content_hash = 'old';   // 오래된 것만 다시 만든다
  const stale = await gen({ prefix: 'hang-out' });
  assert.equal(stale.body.generated, 1);
  assert.equal(ai.calls.length, 6);
});

test('generate prefix: 상한(SPEAKLOOP_GEN_MAX_PER_RUN)과 max·kind 인자가 그대로 동작하고, 모르는 prefix 는 400', async t => {
  const { gen, db, ai } = await setup(t);
  process.env.SPEAKLOOP_GEN_MAX_PER_RUN = '3';
  const a = await gen({ prefix: 'm-delay' });
  assert.equal(a.body.generated, 3);
  assert.ok(a.body.remaining > 0);
  assert.ok([...db.audio.keys()].every(k => k.startsWith('m-delay.')));
  const b = await gen({ prefix: 'hang-out', kind: 'chunk', max: 2 });
  assert.equal(b.body.generated, 2);
  assert.deepEqual([...db.audio.keys()].slice(-2), ['hang-out.ex.c0', 'hang-out.ex.c1']);
  const before = ai.calls.length;
  for (const prefix of ['nope', 'hang', '', 7]) assert.equal((await gen({ prefix })).status, 400, String(prefix));
  assert.equal((await gen({ prefix: 'hang-out', max: 0 })).status, 400, '기존 max 검증 유지');
  assert.equal(ai.calls.length, before);
  const noPrefix = await gen({ max: 1 });   // prefix 없이: 기존 동작(전체 대상)
  assert.equal(noPrefix.body.generated, 1);
});

// ───── preview ─────
test('preview: 비관리자는 403, 모르는 키·키 없음은 404이며 OpenAI 를 부르지 않는다', async t => {
  const { preview, ai } = await setup(t);
  for (const u of [1, 3, 77]) assert.equal((await preview({ key: 'hang-out.say' }, u)).status, 403, String(u));
  for (const body of [{ key: 'nope' }, { key: 'hang-out.ex.c9' }, {}, { key: 7 }, { key: ['hang-out.say'] }]) assert.equal((await preview(body)).status, 404, JSON.stringify(body));
  assert.equal(ai.calls.length, 0);
});

test('preview: 모델·음성이 허용 목록 밖이면 400', async t => {
  const { preview, ai } = await setup(t);
  for (const body of [{ model: 'gpt-5-tts' }, { model: '' }, { model: 3 }, { voice: 'robot' }, { voice: '' }, { voice: 'ALLOY' }]) {
    assert.equal((await preview({ key: 'hang-out.say', ...body })).status, 400, JSON.stringify(body));
  }
  assert.equal(ai.calls.length, 0);
});

test('preview: mp3 를 돌려주고 DB 에는 쓰지 않으며 사용량 이벤트(글자 수)를 기록한다', async t => {
  const { preview, db, ai } = await setup(t);
  const r = await preview({ key: 'hang-out.ex' });
  assert.equal(r.status, 200);
  assert.equal(r.type, 'audio/mpeg');
  assert.equal(r.buf.toString(), 'MP3-1');
  assert.equal(db.audio.size, 0);
  assert.deepEqual(db.queries.filter(q => /speakloop_audio/.test(q)), [], 'speakloop_audio 를 읽지도 쓰지도 않는다');
  assert.deepEqual(db.usage, [{ user_id: 4, event_type: 'speakloop_tts', model: 'gpt-4o-mini-tts', input_tokens: 0, output_tokens: 0, char_count: 34 }]);
  const b = ai.calls[0].body;
  assert.deepEqual([b.model, b.voice, b.response_format, b.input], ['gpt-4o-mini-tts', 'alloy', 'mp3', 'We used to hang out every weekend.']);
});

test('preview: model·voice 를 고르면 그대로 쓰고, tts-1 이면 instructions 가 빠진다', async t => {
  const { preview, ai } = await setup(t);
  await preview({ key: 'hang-out.say', model: 'tts-1', voice: 'nova' });
  const legacy = ai.calls[0].body;
  assert.deepEqual([legacy.model, legacy.voice], ['tts-1', 'nova']);
  assert.ok(!('instructions' in legacy));
  await preview({ key: 'hang-out.say', model: 'gpt-4o-mini-tts', voice: 'coral' });
  assert.ok(typeof ai.calls[1].body.instructions === 'string' && ai.calls[1].body.voice === 'coral');
});

test('preview: 구(chunk)에만 조각 문장이 덧붙는다', async t => {
  const { preview, ai } = await setup(t);
  const { CHUNK_INSTRUCTION } = require('../lib/speakloop_tts');
  await preview({ key: 'hang-out.say' });
  await preview({ key: 'hang-out.ex' });
  await preview({ key: 'hang-out.ex.c0' });
  const [idiom, sentence, chunk] = ai.calls.map(c => c.body);
  assert.ok(!idiom.instructions.includes(CHUNK_INSTRUCTION) && !sentence.instructions.includes(CHUNK_INSTRUCTION));
  assert.ok(chunk.instructions.endsWith(CHUNK_INSTRUCTION));
  assert.equal(chunk.input, 'We used to');
});

test('preview: 사용자가 보낸 읽을 글(text·input·prompt 등)은 요청 본문에 들어가지 않는다 — 글은 서버 콘텐츠에서만(instructions 직접 입력은 작업398 에서 허용)', async t => {
  const { preview, ai } = await setup(t);
  await preview({ key: 'hang-out.say', text: 'EVIL-TEXT', input: 'EVIL-INPUT', prompt: 'EVIL-PROMPT' });
  assert.equal(ai.calls[0].body.input, 'hang out');
  assert.ok(!JSON.stringify(ai.calls[0].body).includes('EVIL'));
});

test('preview: 관리자 1명당 10분에 20회까지, 21번째는 429(OpenAI 호출 없음). 다른 관리자는 따로 센다', async t => {
  const { preview, ai } = await setup(t);
  for (let i = 0; i < 20; i++) assert.equal((await preview({ key: 'hang-out.say' })).status, 200, 'call ' + (i + 1));
  const over = await preview({ key: 'hang-out.say' });
  assert.equal(over.status, 429);
  assert.equal(ai.calls.length, 20);
  assert.equal((await preview({ key: 'hang-out.say' }, 5)).status, 200, '다른 관리자');
  const { previewAllowed, PREVIEW_WINDOW_MS } = require('../lib/speakloop_tts');
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) assert.equal(previewAllowed(900, t0), true);
  assert.equal(previewAllowed(900, t0 + 1000), false);
  assert.equal(previewAllowed(900, t0 + PREVIEW_WINDOW_MS + 1), true, '10분이 지나면 다시 가능');
});

test('preview: OpenAI 오류는 상태코드와 문구(키 조각은 가림)를 화면에 보이도록 돌려주고, 타임아웃은 504, 키가 없으면 503', async t => {
  let mode = 'reject';
  const { preview, ai } = await setup(t, () => {
    if (mode === 'reject') return new Response(JSON.stringify({ error: { message: "Invalid value: 'ash'. Incorrect API key provided: sk-abcdef123456." } }), { status: 400 });
    throw Object.assign(new Error('t'), { name: 'TimeoutError' });
  });
  const origError = console.error; console.error = () => {};
  t.after(() => { console.error = origError; });
  const a = await preview({ key: 'hang-out.say', voice: 'ash' });
  assert.equal(a.status, 502);
  assert.match(a.json.error, /OpenAI 오류\(400\)/);
  assert.match(a.json.error, /Invalid value: 'ash'/);
  assert.ok(!a.json.error.includes('abcdef123456'), '키 조각은 가려진다');
  mode = 'timeout';
  assert.equal((await preview({ key: 'hang-out.say' })).status, 504);
  assert.equal(ai.calls.length, 2, '재시도 없음');
  delete process.env.OPENAI_API_KEY;
  assert.equal((await preview({ key: 'hang-out.say' })).status, 503);
  assert.equal(ai.calls.length, 2);
});

test('화면: 상시 비용 문구 · 목록 표 · 두 번 누름 생성 · Blob 해제 · 한 번에 하나만 재생이 admin.html 에 있다', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.match(html, /미리듣기 1회마다 OpenAI 호출 비용이 발생합니다/);
  assert.match(html, /id="slt-tbody"/);
  assert.match(html, /URL\.revokeObjectURL/);
  assert.match(html, /function sltStop/);
  assert.match(html, /\[생성 실행\]을 한 번 더 누르세요/);
  assert.ok(!/confirm\(/.test(html.slice(html.indexOf('음성 시험 (작업397)'))), 'confirm() 미사용');
});
