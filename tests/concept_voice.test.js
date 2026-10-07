// 작업206: 개념학습 음성 입력(녹음 → 변환) 서버 - OpenAI 호출은 모의(실제 호출 없음). 권한·한도·429·빈 결과·실패·비용 기록.
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createMockDb } = require('./helpers/mock_db');
const { startApp } = require('./helpers/app');

const URL_PATH = '/api/concepts/voice/transcribe';
const secret = process.env.JWT_SECRET || 'mydict-jwt-secret';
const ENV_KEYS = ['OPENAI_API_KEY', 'VOICE_STT_MODEL', 'CONCEPT_VOICE_DAILY_CAP', 'CONCEPT_AI_DAILY_CAP'];

async function setup(opts = {}) {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  if (opts.key !== false) process.env.OPENAI_API_KEY = 'test-key';
  Object.assign(process.env, opts.env || {});
  const t = await startApp(['routes/concept_study.js'], { db });
  const realFetch = global.fetch;
  const openai = { calls: [], reply: { status: 200, body: { text: '광합성' } }, throwError: null };
  global.fetch = async (url, init) => {
    if (!String(url).includes('api.openai.com')) return realFetch(url, init);
    openai.calls.push({ url: String(url), init });
    if (openai.throwError) throw openai.throwError;
    return { ok: openai.reply.status >= 200 && openai.reply.status < 300, status: openai.reply.status, json: async () => openai.reply.body };
  };
  const post = (body, { user = 7, type = 'audio/webm;codecs=opus', seconds = '12' } = {}) => {
    const headers = { 'Content-Type': type, 'X-Audio-Seconds': seconds };
    if (user !== null) headers.Authorization = 'Bearer ' + jwt.sign({ id: user, email: 'u' + user + '@example.com' }, secret);
    return realFetch(t.base + URL_PATH, { method: 'POST', headers, body }).then(async r => { let j = null; try { j = await r.json(); } catch (e) { /* 본문 없음 */ } return { status: r.status, body: j }; });
  };
  const close = async () => {
    global.fetch = realFetch;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await t.close();
  };
  return { db, openai, post, call: t.call, close };
}
const AUDIO = Buffer.alloc(2048, 1);
const stt = db => db.tables.api_usage.filter(r => r.event_type === 'concept_stt');

test('성공: 변환 결과 반환·OpenAI 요청 형태·사용량(초) 기록·AI 호출 없음', async () => {
  const { db, openai, post, close } = await setup();
  const r = await post(AUDIO, { seconds: '12.4' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { text: '광합성' });
  assert.equal(openai.calls.length, 1);
  const c = openai.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(c.init.headers.Authorization, 'Bearer test-key');
  assert.equal(c.init.body.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(c.init.body.get('language'), 'ko');
  const file = c.init.body.get('file');
  assert.equal(file.size, AUDIO.length);
  assert.equal(file.name, 'audio.webm');
  assert.equal(stt(db).length, 1);
  assert.deepEqual([stt(db)[0].user_id, stt(db)[0].model, stt(db)[0].char_count, stt(db)[0].input_tokens, stt(db)[0].output_tokens], [7, 'gpt-4o-mini-transcribe', 12, 0, 0]);
  // 변환만으로는 학습·개념이 만들어지지 않고 AI('concept') 사용량도 없다
  assert.equal(db.tables.concept_studies.length, 0);
  assert.equal(db.tables.concept_items.length, 0);
  assert.equal(db.tables.api_usage.filter(x => x.event_type === 'concept').length, 0);
  await close();
});

test('모델 환경변수·형식별 확장자·초 상한(60초)', async () => {
  const { db, openai, post, close } = await setup({ env: { VOICE_STT_MODEL: 'whisper-1' } });
  await post(AUDIO, { type: 'audio/mp4', seconds: '9999' });
  assert.equal(openai.calls[0].init.body.get('model'), 'whisper-1');
  assert.equal(openai.calls[0].init.body.get('file').name, 'audio.m4a');
  assert.equal(stt(db)[0].char_count, 60, '60초 상한');
  await post(AUDIO, { seconds: 'abc' });
  assert.equal(stt(db)[1].char_count, 0, '잘못된 초는 0');
  await close();
});

test('401·403: 토큰 없음, perm_concept_study 꺼짐·차단 사용자는 OpenAI를 부르지 않음', async () => {
  const { db, openai, post, close } = await setup();
  db.addUser(9, { perm_concept_study: false });
  db.addUser(10, { is_blocked: true });
  assert.equal((await post(AUDIO, { user: null })).status, 401);
  assert.equal((await post(AUDIO, { user: 9 })).status, 403);
  assert.equal((await post(AUDIO, { user: 10 })).status, 403);
  assert.equal(openai.calls.length, 0);
  assert.equal(stt(db).length, 0);
  await close();
});

test('입력 검증: 형식 415, 빈 본문 400, 6MB 초과 413', async () => {
  const { openai, post, close } = await setup();
  assert.equal((await post(AUDIO, { type: 'text/plain' })).status, 415);
  assert.equal((await post(AUDIO, { type: 'audio/ogg' })).status, 415);
  assert.equal((await post(Buffer.alloc(0))).status, 400);
  assert.equal((await post(Buffer.alloc(7 * 1024 * 1024, 1))).status, 413);
  assert.equal(openai.calls.length, 0);
  await close();
});

test('한도: 기본 하루 20회 초과 시 429(OpenAI 호출 없음), 환경변수로 조정, AI 설명 한도와 별도', async () => {
  const { db, openai, post, close } = await setup({ env: { CONCEPT_VOICE_DAILY_CAP: '2', CONCEPT_AI_DAILY_CAP: '1' } });
  // AI 설명 한도(1)가 이미 찼어도 음성 입력은 별도 한도(2)로 동작한다
  db.trackUsage(7, 'concept', 'haiku', 10, 10, 0); db.trackUsage(7, 'concept', 'haiku', 10, 10, 0);
  assert.equal((await post(AUDIO)).status, 200);
  assert.equal((await post(AUDIO)).status, 200);
  const r = await post(AUDIO);
  assert.equal(r.status, 429);
  assert.match(r.body.error, /하루 2회까지/);
  assert.equal(openai.calls.length, 2);
  assert.equal(stt(db).length, 2);
  // 다른 사용자는 영향받지 않는다
  assert.equal((await post(AUDIO, { user: 8 })).status, 200);
  await close();
  // 음성 변환 기록은 AI 설명 한도에 세어지지 않는다(이벤트가 다르다)
  assert.ok(db.tables.api_usage.filter(x => x.event_type === 'concept_stt').length >= 3);
  assert.equal(db.tables.api_usage.filter(x => x.event_type === 'concept').length, 2);
});

test('한도 기본값 20: 20번째까지 허용, 21번째 429. 잘못된 환경변수는 기본값', async () => {
  const { db, post, close } = await setup({ env: { CONCEPT_VOICE_DAILY_CAP: 'abc' } });
  for (let i = 0; i < 19; i++) db.trackUsage(7, 'concept_stt', 'm', 0, 0, 5);
  assert.equal((await post(AUDIO)).status, 200, '20번째');
  assert.equal((await post(AUDIO)).status, 429, '21번째');
  await close();
});

test('빈 변환 결과: 200 {text:""}이고 비용이 생겼으므로 기록은 남김', async () => {
  const { db, openai, post, close } = await setup();
  openai.reply = { status: 200, body: { text: '   ' } };
  const r = await post(AUDIO);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { text: '' });
  assert.equal(stt(db).length, 1);
  openai.reply = { status: 200, body: {} };
  assert.deepEqual((await post(AUDIO)).body, { text: '' }, 'text 필드가 없어도 빈 문자열');
  await close();
});

test('실패 처리: OpenAI 오류 상태·네트워크 예외는 502, 사용량·학습 데이터는 남기지 않음, 로그에 본문 없음', async () => {
  const { db, openai, post, close } = await setup();
  const logs = []; const origErr = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    openai.reply = { status: 500, body: { error: { message: '비밀 본문' } } };
    let r = await post(AUDIO);
    assert.equal(r.status, 502);
    assert.match(r.body.error, /음성 변환에 실패했습니다/);
    openai.throwError = Object.assign(new Error('내부 메시지 sk-secret'), { name: 'TimeoutError' });
    r = await post(AUDIO);
    assert.equal(r.status, 502);
  } finally { console.error = origErr; }
  assert.equal(stt(db).length, 0);
  assert.ok(logs.some(l => /upstream status: 500/.test(l)) && logs.some(l => /stt error: TimeoutError/.test(l)));
  assert.ok(!logs.join('\n').includes('비밀 본문') && !logs.join('\n').includes('sk-secret') && !logs.join('\n').includes('test-key'), '로그에 응답 본문·키 없음');
  await close();
});

test('OPENAI_API_KEY가 없으면 503(OpenAI 호출 없음), 음성은 어디에도 저장하지 않음', async () => {
  const { db, openai, post, close } = await setup({ key: false });
  const r = await post(AUDIO);
  assert.equal(r.status, 503);
  assert.equal(openai.calls.length, 0);
  assert.equal(stt(db).length, 0);
  for (const t of Object.keys(db.tables)) if (t !== 'users') assert.equal(db.tables[t].length, 0, t + ' 비어 있음');
  await close();
});
