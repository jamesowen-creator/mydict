// 작업398: 구(chunk) 클립 기본 instructions 교체 · SPEAKLOOP_TTS_CHUNK_INSTRUCTIONS · 미리듣기 instructions 직접 입력. 가짜 DB·가짜 fetch만 쓴다.
// 실행: node --test tests/speakloop_chunk398.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp } = require('./helpers/app');
const { createSlDb, installOpenAiFetch, mp3 } = require('./helpers/speakloop_db');

const ENV_KEYS = ['OPENAI_API_KEY', 'SPEAKLOOP_TTS_MODEL', 'SPEAKLOOP_TTS_VOICE', 'SPEAKLOOP_TTS_INSTRUCTIONS', 'SPEAKLOOP_TTS_CHUNK_INSTRUCTIONS', 'SPEAKLOOP_GEN_MAX_PER_RUN', 'SPEAKLOOP_TTS_COST_PER_1K_CHARS'];
const NEW_TEXT = 'This is a short phrase from the middle of a longer sentence. Say it at the same natural, brisk conversational pace as a full sentence, not slowly or deliberately. Do not pause or drag. Keep the intonation open, as if more words follow, unless the text ends with a period or a question mark.';
const OLD_TEXT = 'This is a fragment from the middle of a longer sentence. Do not sound finished; keep a slight continuing tone unless the text ends with a period or a question mark.';

async function setup(t) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; if (k !== 'OPENAI_API_KEY') delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  const db = createSlDb();
  const app = await startApp(['routes/speakloop.js'], { db });
  const ai = installOpenAiFetch((b, n) => mp3(n));
  t.after(() => { ai.restore(); for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } return app.close(); });
  const preview = async (body, user = 4) => {
    const token = jwt.sign({ id: user, email: 'u' + user + '@example.com' }, process.env.JWT_SECRET || 'mydict-jwt-secret');
    const r = await fetch(app.base + '/api/admin/speakloop/audio/preview', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString()); } catch (e) { /* mp3 본문 */ }
    return { status: r.status, buf, json };
  };
  return { db, app, ai, preview, gen: body => app.call('POST', '/api/admin/speakloop/audio/generate', body, { user: 4 }), list: p => app.call('GET', '/api/admin/speakloop/audio/list?prefix=' + p, undefined, { user: 4 }) };
}
const TTS = () => require('../lib/speakloop_tts');

// ───── 구 클립 기본 문구 ─────
test('상수: 새 구 문구가 정확히 들어 있다', () => {
  assert.equal(TTS().CHUNK_INSTRUCTION, NEW_TEXT);
});

test('생성: 구 클립 요청 본문에 새 문구가 들어가고, 문장·이디엄 클립에는 구용 문구가 붙지 않는다', async t => {
  const { gen, ai } = await setup(t);
  await gen({ max: 1, kind: 'idiom' });
  await gen({ max: 1, kind: 'sentence' });
  await gen({ max: 1, kind: 'chunk' });
  const [idiom, sentence, chunk] = ai.calls.map(c => c.body);
  assert.equal(chunk.instructions, TTS().DEFAULT_INSTRUCTIONS + ' ' + NEW_TEXT);
  assert.ok(!chunk.instructions.includes('fragment'), '옛 문구는 없다');
  for (const b of [idiom, sentence]) {
    assert.equal(b.instructions, TTS().DEFAULT_INSTRUCTIONS);
    assert.ok(!b.instructions.includes('short phrase'));
  }
});

test('환경변수 SPEAKLOOP_TTS_CHUNK_INSTRUCTIONS 가 있으면 그 값을 쓰고, 없으면 상수를 쓴다(구 클립에만)', async t => {
  const { gen, ai, preview } = await setup(t);
  process.env.SPEAKLOOP_TTS_CHUNK_INSTRUCTIONS = 'Say this phrase quickly.';
  await gen({ max: 1, kind: 'chunk' });
  await preview({ key: 'hang-out.ex' });
  assert.equal(ai.calls[0].body.instructions, TTS().DEFAULT_INSTRUCTIONS + ' Say this phrase quickly.');
  assert.equal(ai.calls[1].body.instructions, TTS().DEFAULT_INSTRUCTIONS, '문장 클립에는 붙지 않는다');
  process.env.SPEAKLOOP_TTS_CHUNK_INSTRUCTIONS = '   ';
  await preview({ key: 'hang-out.ex.c0' });
  assert.equal(ai.calls[2].body.instructions, TTS().DEFAULT_INSTRUCTIONS + ' ' + NEW_TEXT, '공백뿐이면 상수');
});

test('content_hash: 새 문구는 이전 문구와 해시가 다르고(구 클립만), 환경변수를 바꿔도 달라진다', () => {
  const { contentHash, settings, INSTRUCTIONS_MODEL } = TTS();
  const st = settings();
  const chunk = { key: 'hang-out.ex.c0', kind: 'chunk', text: 'We used to' }, sentence = { key: 'hang-out.ex', kind: 'sentence', text: 'We used to hang out every weekend.' };
  const crypto = require('node:crypto');
  const oldHash = crypto.createHash('sha256').update(chunk.text + '\n' + st.model + '\n' + st.voice + '\n' + st.baseInstructions + ' ' + OLD_TEXT, 'utf8').digest('hex');
  assert.equal(st.model, INSTRUCTIONS_MODEL);
  assert.notEqual(contentHash(chunk, st), oldHash, '이전 구 문구로 만든 저장본은 오래됨으로 잡힌다');
  const sentenceOld = crypto.createHash('sha256').update(sentence.text + '\n' + st.model + '\n' + st.voice + '\n' + st.baseInstructions, 'utf8').digest('hex');
  assert.equal(contentHash(sentence, st), sentenceOld, '문장 클립 해시는 그대로');
  assert.notEqual(contentHash(chunk, { ...st, chunkInstruction: 'Say it fast.' }), contentHash(chunk, st));
});

test('이전 구 문구로 저장된 구 클립은 "오래됨", 문장 클립은 "있음"으로 잡힌다', async t => {
  const { db, list } = await setup(t);
  const crypto = require('node:crypto');
  const st = TTS().settings();
  const h = (text, ins) => crypto.createHash('sha256').update(text + '\n' + st.model + '\n' + st.voice + '\n' + ins, 'utf8').digest('hex');
  const put = (key, kind, text, hash) => db.audio.set(key, { kind, text, content_hash: hash, model: st.model, voice: st.voice, audio: Buffer.from('a'), bytes: 1 });
  put('hang-out.ex', 'sentence', 'We used to hang out every weekend.', h('We used to hang out every weekend.', st.baseInstructions));
  put('hang-out.ex.c0', 'chunk', 'We used to', h('We used to', st.baseInstructions + ' ' + OLD_TEXT));
  const r = await list('hang-out');
  const state = k => r.body.clips.find(c => c.key === k).state;
  assert.equal(state('hang-out.ex'), '있음');
  assert.equal(state('hang-out.ex.c0'), '오래됨');
});

test('목록 응답이 현재 구 클립 기본 문구를 돌려준다(화면 placeholder 용)', async t => {
  const { list } = await setup(t);
  const r = await list('hang-out');
  assert.equal(r.body.default_instructions.chunk, TTS().DEFAULT_INSTRUCTIONS + ' ' + NEW_TEXT);
  assert.equal(r.body.default_instructions.sentence, TTS().DEFAULT_INSTRUCTIONS);
});

// ───── 미리듣기 instructions 직접 입력 ─────
test('preview instructions: 지정하면 요청 본문에 그대로 들어가고(기존 규칙을 덧붙이지 않음), 구 클립에도 마찬가지다', async t => {
  const { preview, ai } = await setup(t);
  const mine = 'Speak briskly. Short phrases should not drag.';
  assert.equal((await preview({ key: 'hang-out.ex.c0', instructions: mine })).status, 200);
  assert.equal(ai.calls[0].body.instructions, mine);
  assert.equal((await preview({ key: 'hang-out.ex', instructions: '  ' + mine + '  ' })).status, 200);
  assert.equal(ai.calls[1].body.instructions, mine, '앞뒤 공백만 정리');
  assert.equal(ai.calls[1].body.input, 'We used to hang out every weekend.', '읽을 글은 서버 콘텐츠에서만');
});

test('preview instructions: 빈 문자열이면 서버 기본값, 600자는 통과하고 601자와 문자열이 아닌 값은 400(OpenAI 호출 없음)', async t => {
  const { preview, ai } = await setup(t);
  assert.equal((await preview({ key: 'hang-out.ex.c0', instructions: '' })).status, 200);
  assert.equal(ai.calls[0].body.instructions, TTS().DEFAULT_INSTRUCTIONS + ' ' + NEW_TEXT);
  assert.equal((await preview({ key: 'hang-out.say', instructions: 'a'.repeat(600) })).status, 200);
  const n = ai.calls.length;
  for (const instructions of ['a'.repeat(601), 123, ['x'], {}, null]) assert.equal((await preview({ key: 'hang-out.say', instructions })).status, 400, JSON.stringify(instructions).slice(0, 20));
  assert.equal(ai.calls.length, n);
});

test('preview instructions: gpt-4o-mini-tts 가 아니면 무시된다(tts-1 요청에 instructions 없음)', async t => {
  const { preview, ai } = await setup(t);
  assert.equal((await preview({ key: 'hang-out.say', model: 'tts-1', instructions: 'Speak briskly.' })).status, 200);
  assert.ok(!('instructions' in ai.calls[0].body));
  process.env.SPEAKLOOP_TTS_MODEL = 'tts-1-hd';
  assert.equal((await preview({ key: 'hang-out.say', instructions: 'Speak briskly.' })).status, 200);
  assert.ok(!('instructions' in ai.calls[1].body));
});

test('preview instructions: DB 에 쓰지 않고, 로그에는 문구가 아닌 길이만 남는다', async t => {
  const { preview, db } = await setup(t);
  const lines = [];
  const origLog = console.log, origErr = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  t.after(() => { console.log = origLog; console.error = origErr; });
  const secret = 'ZEBRA-SECRET-PHRASE speak quickly';
  assert.equal((await preview({ key: 'hang-out.say', instructions: secret })).status, 200);
  assert.equal(db.audio.size, 0);
  assert.deepEqual(db.queries.filter(q => /speakloop_audio|INSERT|UPDATE/.test(q)), []);
  assert.ok(lines.some(l => l.endsWith('instructions length: ' + Array.from(secret).length)), '길이는 남는다: ' + JSON.stringify(lines));
  assert.ok(!lines.some(l => l.includes('ZEBRA') || l.includes('speak quickly')), '문구는 로그에 없다');
});

test('화면: instructions 직접 입력 칸 · 600자 안내 · placeholder · 미리듣기에 적용이 admin.html 에 있다', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.match(html, /instructions 직접 입력\(선택\)/);
  assert.match(html, /id="slt-ins"[^>]*maxlength="600"/);
  assert.match(html, /최대 600자/);
  assert.match(html, /sltEl\('slt-ins'\)\.placeholder = /);
  assert.match(html, /body\.instructions = ins/);
  assert.ok(!/confirm\(/.test(html.slice(html.indexOf('음성 시험 (작업397)'))), 'confirm() 미사용');
});
