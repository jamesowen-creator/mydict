// 작업JG-1: 일본어 문법 해설 — 입력 검증 · 캐시 조회/저장 · AI 응답(JSON) 검증 · 재시도 · 권한. AI(@anthropic-ai/sdk)는 모의이며 실제 호출은 하지 않는다(응답 품질 판단은 이번 범위 밖).
// 가짜 DB 는 이 기능이 쓰는 SQL 네 가지(users 차단 조회 / jgrammar_cache 조회·저장 / api_usage 오늘 건수)만 흉내 낸다.
// 실행: node --test tests/jgrammar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.JGRAMMAR_DAILY_CAP;
const { startApp, createAnthropicMock } = require('./helpers/app');
const J = require('../lib/jgrammar');   // 순수 함수만 쓴다(모듈 로드 시 실제 DB 연결은 만들어지지 않음)

const GOOD = {
  ok: true,
  translation: '私は毎日学校に行きます。 → 나는 매일 학교에 갑니다.',
  grammar: [
    { name: '助詞「に」(방향·도착점)', meaning: '이동의 도착점을 나타냅니다.', form: '学校に行きます', contrast: '「へ」는 방향에 초점이 있고 「に」는 도착점에 초점이 있습니다.', jlpt: 'N5' },
    { name: '〜ます형', meaning: '정중한 말투의 현재·미래 표현입니다.', form: '行きます', contrast: '보통체 「行く」보다 정중합니다.', jlpt: null },
  ],
};

function createJgDb({ blocked = [], failCacheRead = false } = {}) {
  const db = { cache: new Map(), usage: [], blocked: new Set(blocked), queries: [] };
  db.pool = {
    query: async (sql, params = []) => {
      db.queries.push(sql.replace(/\s+/g, ' ').trim());
      if (/FROM users/.test(sql)) return { rows: [{ is_blocked: db.blocked.has(params[0]) }] };
      if (/FROM jgrammar_cache/.test(sql)) {
        if (failCacheRead) throw new Error('cache read down');
        return db.cache.has(params[0]) ? { rows: [{ result: db.cache.get(params[0]).result }] } : { rows: [] };
      }
      if (/INSERT INTO jgrammar_cache/.test(sql)) {
        if (!db.cache.has(params[0])) db.cache.set(params[0], { sentence: params[1], result: JSON.parse(params[2]), model: params[3] });
        return { rows: [] };
      }
      if (/FROM api_usage/.test(sql)) return { rows: [{ n: db.usage.filter(u => u.user_id === params[0] && u.event_type === params[1]).length }] };
      throw new Error('지원하지 않는 SQL: ' + sql);
    },
  };
  db.trackUsage = (user_id, event_type, model, input_tokens, output_tokens) => db.usage.push({ user_id, event_type, model, input_tokens, output_tokens });
  return db;
}

async function setup(opts) {
  const db = createJgDb(opts);
  const anthropic = createAnthropicMock();
  anthropic.handler = () => JSON.stringify(GOOD);
  const t = await startApp(['routes/jgrammar.js'], { db, anthropic });
  const post = (sentence, user = 1) => t.call('POST', '/api/jgrammar/explain', { sentence }, { user });
  return { db, anthropic, t, post };
}

// ───── 입력 검증(순수 함수) ─────
test('입력 검증: 앞뒤 공백은 제거하고, 비어 있으면 거부', () => {
  assert.deepEqual(J.validateSentence('  学校に行く \n'), { sentence: '学校に行く' });
  for (const v of ['', '   ', '\n\t', null, undefined, 123, {}]) assert.equal(J.validateSentence(v).error, J.MSG.empty);
});

test('입력 검증: 200자는 통과, 201자는 거부(글자 수는 코드 포인트 기준)', () => {
  assert.ok(J.validateSentence('あ'.repeat(200)).sentence);
  assert.equal(J.validateSentence('あ'.repeat(201)).error, J.MSG.tooLong);
  assert.ok(J.validateSentence('𠮷'.repeat(200)).sentence, '서로게이트 쌍 한자도 1글자');
  assert.equal(J.validateSentence(' ' + 'あ'.repeat(200) + ' ').sentence.length, 200, '공백은 세지 않음');
});

test('입력 검증: 히라가나·가타카나·한자가 하나도 없으면 거부, 하나라도 있으면 통과', () => {
  for (const v of ['Hello world', '안녕하세요', '12345 !?', '。、！？']) assert.equal(J.validateSentence(v).error, J.MSG.noJapanese, v);
  for (const v of ['hello あ', 'abc カ', 'abc 学', 'ー'.length ? 'テスト' : '']) assert.ok(J.validateSentence(v).sentence, v);
});

test('정규화·해시: 앞뒤 공백만 달라도 같은 키, 내용이 다르면 다른 키', () => {
  assert.equal(J.hashSentence(J.normalizeSentence(' 猫が好き ')), J.hashSentence(J.normalizeSentence('猫が好き')));
  assert.notEqual(J.hashSentence('猫が好き'), J.hashSentence('犬が好き'));
  assert.match(J.hashSentence('猫'), /^[0-9a-f]{64}$/);
});

// ───── AI 응답 JSON 검증(순수 함수) ─────
test('응답 검증: 올바른 형식은 통과하고 값은 다듬어(trim) 반환, jlpt null 허용', () => {
  const v = J.validateAiResult(GOOD);
  assert.equal(v.result.translation, GOOD.translation);
  assert.equal(v.result.grammar.length, 2);
  assert.equal(v.result.grammar[0].jlpt, 'N5');
  assert.equal(v.result.grammar[1].jlpt, null);
});

test('응답 검증: 형식이 틀리면 invalid(번역 없음·항목 0개·9개·필드 누락·빈 문자열·너무 긺·jlpt 값 오류·배열 아님)', () => {
  const g = GOOD.grammar[0];
  const bad = [
    null, [], 'text', { ok: true }, { ...GOOD, ok: undefined },
    { ...GOOD, translation: '' }, { ...GOOD, translation: 5 }, { ...GOOD, translation: 'あ'.repeat(201) },
    { ...GOOD, grammar: [] }, { ...GOOD, grammar: 'x' }, { ...GOOD, grammar: Array(9).fill(g) }, { ...GOOD, grammar: [null] },
    { ...GOOD, grammar: [{ ...g, name: '' }] }, { ...GOOD, grammar: [{ ...g, meaning: undefined }] }, { ...GOOD, grammar: [{ ...g, form: '   ' }] },
    { ...GOOD, grammar: [{ ...g, contrast: 'あ'.repeat(301) }] },
    { ...GOOD, grammar: [{ ...g, jlpt: 'N6' }] }, { ...GOOD, grammar: [{ ...g, jlpt: 3 }] }, { ...GOOD, grammar: [{ ...g, jlpt: undefined }] }, { ...GOOD, grammar: [{ ...g, jlpt: '' }] },
  ];
  for (const b of bad) assert.deepEqual(J.validateAiResult(b), { invalid: true }, JSON.stringify(b));
});

test('응답 검증: ok:false 는 거절(사유 그대로, 비었거나 너무 길면 기본 문구)', () => {
  assert.deepEqual(J.validateAiResult({ ok: false, reason: '일본어 문장이 아닙니다.' }), { rejected: '일본어 문장이 아닙니다.' });
  assert.deepEqual(J.validateAiResult({ ok: false }), { rejected: J.MSG.notSentence });
  assert.deepEqual(J.validateAiResult({ ok: false, reason: 'あ'.repeat(101) }), { rejected: J.MSG.notSentence });
});

test('JSON 파싱: 코드 블록은 벗기고, 깨진 JSON·객체가 아닌 값은 예외', () => {
  assert.deepEqual(J.parseModelJson('```json\n{"ok":false}\n```'), { ok: false });
  assert.deepEqual(J.parseModelJson(' {"ok":false} '), { ok: false });
  for (const v of ['', 'not json', '[1]', '"x"', 'null', '{"ok":']) assert.throws(() => J.parseModelJson(v), v);
});

// ───── 라우트: 인증·권한·입력 ─────
test('로그인 없으면 401, 차단된 계정은 403, 일반 계정은 통과', async t => {
  const { post, anthropic, t: app } = await setup({ blocked: [9] });
  t.after(() => app.close());
  assert.equal((await post('猫が好き', null)).status, 401);
  assert.equal((await post('猫が好き', 9)).status, 403);
  assert.equal(anthropic.calls.length, 0);
  assert.equal((await post('猫が好き', 1)).status, 200);
});

test('입력 오류(빈 값·201자·일본어 없음)는 400 이고 AI 를 부르지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  for (const s of ['', '   ', 'あ'.repeat(201), 'English only', '한국어만']) {
    const r = await post(s);
    assert.equal(r.status, 400, s);
    assert.equal(r.body.ok, false);
  }
  assert.equal((await app.call('POST', '/api/jgrammar/explain', {}, { user: 1 })).status, 400, 'sentence 없음');
  assert.equal(anthropic.calls.length, 0);
  assert.equal(db.cache.size, 0);
});

// ───── 라우트: 정상·캐시 ─────
test('정상: 번역과 문법 항목을 돌려주고 저장하며, 입력은 JSON 데이터로 보내고 모델은 Haiku 로 고정', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  const r = await post('  私は毎日学校に行きます。 ');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true); assert.equal(r.body.cached, false);
  assert.equal(r.body.result.translation, GOOD.translation);
  assert.equal(r.body.result.grammar.length, 2);
  assert.equal(anthropic.calls.length, 1);
  assert.equal(anthropic.calls[0].model, 'claude-haiku-4-5-20251001');
  const content = anthropic.calls[0].messages[0].content;
  assert.deepEqual(JSON.parse(content.slice(content.indexOf('\n') + 1)), { '문장': '私は毎日学校に行きます。' }, '공백을 뺀 문장이 JSON 데이터로 들어감');
  assert.equal(db.cache.size, 1);
  assert.equal([...db.cache.values()][0].sentence, '私は毎日学校に行きます。');
  assert.equal(db.usage.length, 1);
  assert.equal(db.usage[0].event_type, 'jgrammar');
});

test('캐시: 같은 문장(앞뒤 공백만 다름)·다른 사용자는 AI 를 다시 부르지 않고 저장본을 돌려준다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  await post('猫が好き');
  const again = await post('  猫が好き\n', 2);
  assert.equal(again.status, 200);
  assert.equal(again.body.cached, true);
  assert.deepEqual(again.body.result.grammar, J.validateAiResult(GOOD).result.grammar);
  assert.equal(anthropic.calls.length, 1, 'AI 는 한 번만');
  assert.equal(db.usage.length, 1);
  await post('犬が好き');
  assert.equal(anthropic.calls.length, 2, '다른 문장은 새로 호출');
  assert.equal(db.cache.size, 2);
});

test('캐시: 저장본이 깨져 있으면(검증 실패) 없는 것으로 보고 다시 만들어 저장한다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  db.cache.set(J.hashSentence('猫が好き'), { sentence: '猫が好き', result: { translation: '', grammar: [] }, model: 'x' });
  const r = await post('猫が好き');
  assert.equal(r.status, 200); assert.equal(r.body.cached, false);
  assert.equal(anthropic.calls.length, 1);
});

test('캐시 읽기가 실패해도 AI 로 계속 처리한다', async t => {
  const { post, anthropic, t: app } = await setup({ failCacheRead: true });
  t.after(() => app.close());
  assert.equal((await post('猫が好き')).status, 200);
  assert.equal(anthropic.calls.length, 1);
});

// ───── 라우트: 형식 오류·재시도·실패 ─────
test('형식 오류 후 재시도에서 성공하면 정상 응답(AI 2회 호출, 저장 1건)', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = (p, n) => (n === 1 ? '이건 JSON 이 아닙니다' : JSON.stringify(GOOD));
  const r = await post('猫が好き');
  assert.equal(r.status, 200); assert.equal(r.body.cached, false);
  assert.equal(anthropic.calls.length, 2);
  assert.equal(db.cache.size, 1);
  assert.equal(db.usage.length, 2, '호출이 끝난 두 번 모두 사용량 기록');
});

test('형식 오류가 두 번 이어지면 재시도는 1회만 하고 실패 안내, 저장하지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = (p, n) => (n === 1 ? '{"ok":true,"translation":"x","grammar":[]}' : '{깨진');
  const r = await post('猫が好き');
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { ok: false, error: J.MSG.aiFail });
  assert.equal(anthropic.calls.length, J.MAX_ATTEMPTS);
  assert.equal(anthropic.calls.length, 2);
  assert.equal(db.cache.size, 0);
});

test('API 오류는 다시 부르지 않고 실패 안내, 저장하지 않는다. 실패 뒤 같은 문장을 다시 보내면 새로 시도한다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = () => { throw new Error('down'); };
  const r = await post('猫が好き');
  assert.equal(r.status, 502); assert.equal(r.body.error, J.MSG.aiFail);
  assert.equal(anthropic.calls.length, 1);
  assert.equal(db.cache.size, 0);
  anthropic.handler = () => JSON.stringify(GOOD);
  assert.equal((await post('猫が好き')).status, 200);
});

test('AI 가 일본어 문장이 아니라고 응답하면(ok:false) 그 사유만 돌려주고 저장하지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = () => JSON.stringify({ ok: false, reason: '문장이 성립하지 않습니다.' });
  const r = await post('漢字漢字');
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { ok: false, rejected: true, error: '문장이 성립하지 않습니다.' });
  assert.equal(anthropic.calls.length, 1, '거절은 형식 오류가 아니므로 재시도 없음');
  assert.equal(db.cache.size, 0);
});

test('코드 블록으로 감싼 JSON 응답도 받는다', async t => {
  const { post, anthropic, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = () => '```json\n' + JSON.stringify(GOOD) + '\n```';
  assert.equal((await post('猫が好き')).status, 200);
});

// ───── 하루 한도 ─────
test('하루 한도: AI 호출 건수만 세어 한도에 닿으면 429, 캐시 적중은 한도와 무관하게 응답', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '2';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const { post, anthropic, t: app } = await setup();
  t.after(() => app.close());
  assert.equal((await post('猫が好き')).status, 200);
  assert.equal((await post('犬が好き')).status, 200);
  const over = await post('鳥が好き');
  assert.equal(over.status, 429); assert.equal(over.body.error, J.MSG.cap);
  assert.equal(anthropic.calls.length, 2);
  assert.equal((await post('猫が好き')).body.cached, true, '저장된 문장은 한도 뒤에도 열림');
  assert.equal((await post('猫が好き', 2)).status, 200, '다른 사용자는 자기 한도');
});
