// 작업313: 문장 학습 — 언어 일반화(ja·en) 서버 시험. AI(@anthropic-ai/sdk)는 모의, DB 는 가짜(tests/helpers/jg_db.js)이며 실제 호출·실제 PostgreSQL 은 쓰지 않는다.
// 확인: 일본어 동작 보존(프롬프트·해시·상한·ruby·옛 캐시 재호출) / 영어 입력 검증·분석·재시도·검증 상한 / 캐시·저장 키 / 저장 목록 언어별 / 한도 합산 / lang 오류 400 과 권한 순서 / 영어 OCR / DB 단계 문장
// 실행: node --test tests/jgrammar_lang.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

delete process.env.JGRAMMAR_DAILY_CAP;
process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp, createAnthropicMock } = require('./helpers/app');
const { createJgDb } = require('./helpers/jg_db');
const J = require('../lib/jgrammar');   // 순수 함수만 쓴다

const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const JA_GOOD = {
  ok: true, translation: '나는 고양이를 좋아한다',
  grammar: [{ name: '助詞「が」', meaning: '대상을 나타냅니다.', form: '猫が好き', contrast: '「は」와 다릅니다.', jlpt: 'N5' }],
  ruby: [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }],
};
// 작업317: 영어 새 형식(structure + points). 옛 형식(문법 항목 목록)은 EN_OLD
const EN_STRUCT = [
  { kind: '주어 (subject)', role: '주어', text: 'She', note: '문장의 주인공을 나타냅니다.' },
  { kind: '동사구 (verb phrase)', role: '서술', text: 'has lived in Seoul since 2020.', note: '현재완료로 지금까지 이어지는 상태를 말합니다.', children: [
    { kind: '동사구 (verb phrase)', role: '서술', text: 'has lived', note: '현재완료 시제의 동사입니다.' },
    { kind: '전치사구 (prepositional phrase)', role: '수식어', text: 'in Seoul', note: '장소를 나타내며 lived 를 꾸밉니다.' },
    { kind: '전치사구 (prepositional phrase)', role: '수식어', text: 'since 2020', note: '시작 시점을 나타냅니다.' },
  ] },
];
const EN_POINT = { name: '현재완료(계속)', meaning: '과거에 시작해 지금까지 이어지는 상태를 나타냅니다.', form: 'has lived', contrast: '단순 과거 lived 는 지금은 끝난 일을 말합니다.', level: 'B1' };
const EN_GOOD = { ok: true, translation: '그녀는 2020년부터 서울에 살고 있다.', structure: EN_STRUCT, points: [EN_POINT] };
const EN_OLD = {   // 작업317 이전 형식(structure 키 없음)
  ok: true, translation: '그녀는 2020년부터 서울에 살고 있다.',
  grammar: [
    { name: '현재완료(계속)', meaning: '과거에 시작해 지금까지 이어지는 상태를 나타냅니다.', form: 'has lived', contrast: '단순 과거 lived 는 지금은 끝난 일을 말합니다.', level: 'B1' },
    { name: '전치사 since', meaning: '시작 시점을 나타냅니다.', form: 'since 2020', contrast: 'for 는 기간을 나타냅니다.', level: null },
  ],
};
const EN_SENTENCE = 'She has lived in Seoul since 2020.';
const BOTH_SENTENCE = 'Hello あいう';   // 로마자 5 ≥ 비로마자 3 → 영어로도, 가나가 있어 일본어로도 통과

async function setup(handler) {
  const db = createJgDb();
  const anthropic = createAnthropicMock();
  anthropic.handler = handler || (params => JSON.stringify(/영어 문법/.test(params.system) ? EN_GOOD : JA_GOOD));
  const t = await startApp(['routes/jgrammar.js'], { db, anthropic });
  const secret = process.env.JWT_SECRET || 'mydict-jwt-secret';
  const post = (sentence, lang, user = 1) => t.call('POST', '/api/jgrammar/explain', lang === undefined ? { sentence } : { sentence, lang }, { user });
  const saved = (lang, user = 1) => t.call('GET', '/api/jgrammar/saved' + (lang === undefined ? '' : '?lang=' + encodeURIComponent(lang)), undefined, { user });
  const ocr = async (body, lang, { type = 'image/png', user = 1 } = {}) => {
    const headers = { 'Content-Type': type };
    if (user !== null) headers.Authorization = 'Bearer ' + jwt.sign({ id: user, email: 'u' + user + '@example.com' }, secret);
    const r = await fetch(t.base + '/api/jgrammar/ocr' + (lang === undefined ? '' : '?lang=' + encodeURIComponent(lang)), { method: 'POST', headers, body });
    let json = null; try { json = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { status: r.status, body: json };
  };
  return { db, anthropic, t, post, saved, ocr };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('fake-png-body')]);
const nonUserQueries = db => db.queries.filter(q => !/FROM users/.test(q));

// ───── 일본어 동작 보존 ─────
test('일본어 보존: 프롬프트 3종·max_tokens 는 작업313 이전(HEAD 6c1798c) 값과 글자 하나까지 같다(sha256 고정)', () => {
  assert.equal(sha(J.SYSTEM_PROMPT), '68ed391be5ef08b07eb274ce91c4bdc92bc4aa394d13126ee8fd3f2cae6231f6');
  assert.equal(sha(J.systemPrompt(true)), 'e351936c1c0421f5313685cf39fd75e3db65373f4190647c183e6c8b024e7196');
  assert.equal(sha(J.OCR_SYSTEM_PROMPT), '073bff5ba64d1b83a124a1398771960f1a5d8499a62e7a78a86e326c62352a06');
  assert.equal(J.MAX_TOKENS, 3000);
  assert.equal(J.MAX_SENTENCE, 200);
  assert.equal(J.LANGS.ja.systemPrompt(false), J.SYSTEM_PROMPT);
  assert.equal(J.LANGS.ja.systemPrompt(true), J.systemPrompt(true));
  assert.equal(J.LANGS.ja.ocrPrompt, J.OCR_SYSTEM_PROMPT);
  assert.equal(J.LANGS.ja.maxTokens, 3000);
});

test('일본어 보존: 해시는 예전 그대로(문장만) — lang 없음·ja 모두 같고, 직접 계산한 sha256 과 같다', () => {
  assert.equal(J.hashSentence('猫が好き'), '761264922e80a0fb05a47ef3847e78f5a4b60c9c5102c4d44d86ead5e4fa97e7');
  assert.equal(J.hashSentence('猫が好き', 'ja'), J.hashSentence('猫が好き'));
  assert.equal(J.hashSentence('猫が好き'), sha('猫が好き'));
});

test('일본어 보존: lang 없음과 lang=ja 는 같은 키·같은 결과(두 번째는 캐시), ja 로 저장되고 AI 는 예전 설정(max_tokens 3000, ruby 프롬프트)으로 1번만 호출', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const r1 = await a.post('猫が好き');
  const r2 = await a.post('猫が好き', 'ja');
  assert.equal(r1.status, 200); assert.equal(r1.body.cached, false);
  assert.equal(r2.status, 200); assert.equal(r2.body.cached, true);
  assert.deepEqual(r2.body.result, r1.body.result);
  assert.deepEqual(r1.body.result.ruby, JA_GOOD.ruby);
  assert.equal(a.anthropic.calls.length, 1);
  assert.equal(a.anthropic.calls[0].max_tokens, 3000);
  assert.equal(a.anthropic.calls[0].system, J.systemPrompt(true));
  assert.deepEqual([...a.db.cache.keys()], [J.hashSentence('猫が好き')], '캐시 키는 예전 방식');
  assert.equal(a.db.cache.get(J.hashSentence('猫が好き')).lang, 'ja');
  const rows = [...a.db.saved.values()];
  assert.equal(rows.length, 1); assert.equal(rows[0].lang, 'ja'); assert.equal(rows[0].sentence_hash, J.hashSentence('猫が好き'));
  assert.deepEqual(r1.body.result.grammar[0].jlpt, 'N5');
});

test('일본어 보존: 한자 없는 문장은 ruby 없는 프롬프트(SYSTEM_PROMPT)와 ruby [] — 입력 검증 메시지·200자 경계도 그대로', async t => {
  const a = await setup(() => JSON.stringify({ ...JA_GOOD, ruby: undefined }));
  t.after(() => a.t.close());
  const r = await a.post('ねこがすき');
  assert.equal(r.status, 200); assert.deepEqual(r.body.result.ruby, []);
  assert.equal(a.anthropic.calls[0].system, J.SYSTEM_PROMPT);
  assert.equal((await a.post('あ'.repeat(201), 'ja')).body.error, J.MSG.tooLong);
  assert.equal((await a.post('Hello world')).body.error, J.MSG.noJapanese);
  assert.equal((await a.post('  ')).body.error, J.MSG.empty);
  assert.equal((await a.post('あ'.repeat(200), 'ja')).status, 200);
});

test('일본어 보존: 옛 형식 캐시(ruby 키 없음)+한자 문장은 ja 에서 AI 1회 재호출로 갱신(lang 없음·ja 모두)', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const OLD = { translation: '옛 번역', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', jlpt: null }] };
  a.db.cache.set(J.hashSentence('猫が好き'), { sentence: '猫が好き', result: OLD, model: 'x', lang: 'ja' });
  const r = await a.post('猫が好き', 'ja');
  assert.equal(r.status, 200); assert.equal(r.body.cached, false);
  assert.deepEqual(r.body.result.ruby, JA_GOOD.ruby);
  assert.equal(a.anthropic.calls.length, 1);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar']);
});

// ───── 영어 입력 검증 ─────
test('영어 입력 검증: 공백 제거, 300자 경계, 로마자 없음·비로마자가 더 많음은 안내(언어 이름 포함)', () => {
  assert.deepEqual(J.validateSentence('  Hello world.\n', 'en'), { sentence: 'Hello world.' });
  for (const v of ['', '   ', null, undefined, 5]) assert.equal(J.validateSentence(v, 'en').error, J.EN_MSG.empty, String(v));
  assert.ok(J.validateSentence('a'.repeat(300), 'en').sentence, '300자 통과');
  assert.equal(J.validateSentence('a'.repeat(301), 'en').error, J.EN_MSG.tooLong, '301자 거부');
  assert.ok(J.validateSentence(' ' + 'a'.repeat(300) + ' ', 'en').sentence, '공백은 세지 않음');
  assert.ok(J.validateSentence('a'.repeat(201), 'en').sentence, '201자도 영어에서는 통과(상한 300)');
  for (const v of ['12345 !?', '안녕하세요', 'こんにちは', '私は学生です', '你好吗', '안녕하세요 hi', 'こんにちは ok', '。、！？']) {
    const r = J.validateSentence(v, 'en');
    assert.equal(r.error, J.EN_MSG.notLang, v);
  }
  assert.match(J.EN_MSG.notLang, /선택한 언어/); assert.match(J.EN_MSG.notLang, /영어/);
  for (const v of ['Hello 안녕', 'ab 가나', "It's 3.5 o'clock", 'café au lait', 'Ünïcödé text']) assert.ok(J.validateSentence(v, 'en').sentence, v);
  assert.equal(J.validateSentence('Hello world', 'ja').error, J.MSG.noJapanese, '일본어 안내는 그대로(언어 이름 포함)');
});

test('영어 입력 오류는 AI·캐시·사용량을 건드리지 않는다(API)', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  for (const v of ['안녕하세요', '12345', 'a'.repeat(301), '   ']) assert.equal((await a.post(v, 'en')).status, 400, v.slice(0, 10));
  assert.equal(a.anthropic.calls.length, 0);
  assert.deepEqual(nonUserQueries(a.db), []);
  assert.equal(a.db.usage.length, 0);
});

// ───── 영어 분석 ─────
test('영어 분석: 정상 응답(ruby·jlpt 없음, structure·points, grammar 빈 배열)·Haiku·en 프롬프트·max_tokens·사용량 이벤트 jgrammar, 캐시 키에 언어 포함, 다음 요청은 캐시', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const r = await a.post(EN_SENTENCE, 'en');
  assert.equal(r.status, 200); assert.equal(r.body.cached, false);
  assert.equal(r.body.result.translation, EN_GOOD.translation);
  assert.deepEqual(r.body.result.points.map(g => g.level), ['B1']);
  assert.ok(Array.isArray(r.body.result.structure) && r.body.result.structure.length === 2);
  assert.deepEqual(r.body.result.grammar, [], '옛 코드가 새 형식 결과를 읽어도 깨지지 않게 grammar 는 빈 배열');
  assert.ok(!('ruby' in r.body.result), 'ruby 키 없음');
  const call = a.anthropic.calls[0];
  assert.equal(call.model, J.MODEL); assert.equal(call.model, 'claude-haiku-4-5-20251001');
  assert.equal(call.system, J.EN_SYSTEM_PROMPT);
  assert.equal(call.max_tokens, J.EN_MAX_TOKENS); assert.equal(J.EN_MAX_TOKENS, 4800);
  assert.ok(!/ruby/.test(call.system), '영어 프롬프트는 ruby 를 요청하지 않는다');
  assert.match(call.messages[0].content, new RegExp('"문장": "' + EN_SENTENCE.replace(/\./g, '\\.') + '"'));
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar']);
  const key = sha('en:' + EN_SENTENCE);
  assert.equal(J.hashSentence(EN_SENTENCE, 'en'), key);
  assert.notEqual(key, sha(EN_SENTENCE), 'en 해시에는 언어 코드가 들어간다');
  assert.deepEqual([...a.db.cache.keys()], [key]); assert.equal(a.db.cache.get(key).lang, 'en');
  const again = await a.post('  ' + EN_SENTENCE + ' ', 'en');
  assert.equal(again.body.cached, true); assert.deepEqual(again.body.result, r.body.result);
  assert.equal(a.anthropic.calls.length, 1);
});

test('영어 프롬프트 규칙: 문장 보정 금지·구조 규칙·A1·A2 제외·모르면 null·영어가 아니면 사유만, 설명은 한국어, 상한 숫자', () => {
  const p = J.EN_SYSTEM_PROMPT;
  for (const frag of ['영어 문법', 'structure', 'points', '이어 붙이면', '구두점', '생략된 단어', 'note 에서 설명', '더 쪼개지 말고', 'A1·A2 수준 문법은 넣지 않습니다', '단어 뜻풀이', '빈 배열', '"B1","B2","C1","C2"', 'null', '지어내지 않습니다',
    '바꾸거나 보정하지 않습니다', '{"ok":false,"reason"', '데이터', '한국어', '최상위 노드는 10개 이하', '3단계 이하', '30개 이하', '0~3개', '"children"']) assert.ok(p.includes(frag), frag);
  assert.ok(!/ruby|jlpt|JLPT|후리가나/.test(p), '일본어 전용 요소 없음');
  assert.ok(!p.includes('"grammar"'), '영어 프롬프트는 grammar(문법 항목 목록)를 요구하지 않는다');
});

test('영어 형식 오류: 1회 재시도 후 성공하면 저장, 두 번 다 틀리면 502 이고 캐시·저장 없음', async t => {
  const bad = '이건 JSON 이 아닙니다';
  const a = await setup((p, n) => (n === 1 ? bad : JSON.stringify(EN_GOOD)));
  t.after(() => a.t.close());
  const ok = await a.post(EN_SENTENCE, 'en');
  assert.equal(ok.status, 200); assert.equal(a.anthropic.calls.length, 2);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar', 'jgrammar']);
  const b = await setup(() => bad);
  t.after(() => b.t.close());
  const r = await b.post(EN_SENTENCE, 'en');
  assert.equal(r.status, 502); assert.equal(r.body.error, J.MSG.aiFail); assert.equal(b.anthropic.calls.length, J.MAX_ATTEMPTS);
  assert.equal(b.db.cache.size, 0); assert.equal(b.db.saved.size, 0);
});

test('영어 응답 검증: translation·points 형식 오류는 invalid, 수준 때문에 빼는 points 는 형식 오류가 아니다, 거절(ok:false)은 사유', () => {
  const g = EN_POINT;
  const v = (o) => J.validateAiResult(o, 'en', EN_SENTENCE);
  assert.ok(v(EN_GOOD).result);
  assert.deepEqual(v({ ...EN_GOOD, points: [] }).result.points, [], '0개 정상');
  const bad = [
    { ...EN_GOOD, translation: 'a'.repeat(201) }, { ...EN_GOOD, translation: '' }, { ok: true, structure: EN_STRUCT, points: [] },
    { ...EN_GOOD, points: undefined }, { ...EN_GOOD, points: 'x' }, { ...EN_GOOD, points: [null] },
    { ...EN_GOOD, points: [{ ...g, name: '' }] }, { ...EN_GOOD, points: [{ ...g, name: 'a'.repeat(61) }] }, { ...EN_GOOD, points: [{ ...g, meaning: 'a'.repeat(201) }] },
    { ...EN_GOOD, points: [{ ...g, form: 'a'.repeat(121) }] }, { ...EN_GOOD, points: [{ ...g, contrast: 'a'.repeat(301) }] }, { ...EN_GOOD, points: [{ ...g, contrast: undefined }] },
    { ...EN_GOOD, points: [g, { ...g, form: 5 }] },
  ];
  for (const b of bad) assert.deepEqual(v(b), { invalid: true });
  assert.deepEqual(J.validateAiResult({ ...JA_GOOD, grammar: [{ ...JA_GOOD.grammar[0], jlpt: 'B1' }] }, 'ja'), { invalid: true }, 'ja 는 여전히 JLPT 만');
  assert.deepEqual(v({ ok: false, reason: '영어 문장이 아닙니다.' }), { rejected: '영어 문장이 아닙니다.' });
  assert.deepEqual(v({ ok: false }), { rejected: J.EN_MSG.notSentence });
  assert.deepEqual(J.validateAiResult({ ok: false }, 'ja'), { rejected: J.MSG.notSentence });
});

test('영어 거절(ok:false)은 422 와 사유, 저장·캐시 없음', async t => {
  const a = await setup(() => JSON.stringify({ ok: false, reason: '문장이 성립하지 않습니다.' }));
  t.after(() => a.t.close());
  const r = await a.post('asdf qwer zxcv', 'en');
  assert.equal(r.status, 422); assert.equal(r.body.error, '문장이 성립하지 않습니다.');
  assert.equal(a.db.cache.size, 0); assert.equal(a.db.saved.size, 0);
});

test('영어에는 ruby 가 없다: 모델이 ruby 를 보내도 결과에 넣지 않고, 한자가 섞여도 새 형식 캐시 재호출이 일어나지 않는다', async t => {
  const a = await setup(() => JSON.stringify({ ...EN_GOOD, ruby: [{ text: 'x', reading: 'y' }] }));
  t.after(() => a.t.close());
  const r = await a.post(EN_SENTENCE, 'en');
  assert.ok(!('ruby' in r.body.result)); assert.ok(!('ruby' in a.db.cache.get(J.hashSentence(EN_SENTENCE, 'en')).result));
  assert.ok(!('ruby' in [...a.db.saved.values()][0].result));
  // 한자가 들어 있는 새 형식 영어 캐시(structure null) → 그대로 캐시 응답, AI 호출 없음
  const mixed = 'Hello 学校';
  a.db.cache.set(J.hashSentence(mixed, 'en'), { sentence: mixed, result: { translation: 't', structure: null, points: [], grammar: [] }, model: 'x', lang: 'en' });
  const calls = a.anthropic.calls.length;
  const c = await a.post(mixed, 'en');
  assert.equal(c.status, 200); assert.equal(c.body.cached, true); assert.ok(!('ruby' in c.body.result));
  assert.equal(a.anthropic.calls.length, calls, '재호출 없음');
  assert.equal(a.db.usage.length, 1);
  assert.ok(!a.db.queries.some(q => /^UPDATE jgrammar_cache/.test(q)), '캐시 갱신도 없음');
});

// ───── 키: 언어별 분리 ─────
test('같은 문장이 ja 와 en 에서 서로 다른 캐시·저장 항목이 된다(각각 AI 1번씩, 각 언어의 프롬프트)', async t => {
  const a = await setup(p => JSON.stringify(/영어 문법/.test(p.system) ? EN_GOOD : { ...JA_GOOD, ruby: [{ text: 'Hello あいう' }] }));
  t.after(() => a.t.close());
  const rj = await a.post(BOTH_SENTENCE, 'ja'), re = await a.post(BOTH_SENTENCE, 'en');
  assert.equal(rj.status, 200); assert.equal(re.status, 200);
  assert.equal(a.anthropic.calls.length, 2);
  assert.equal(a.anthropic.calls[0].system, J.SYSTEM_PROMPT); assert.equal(a.anthropic.calls[1].system, J.EN_SYSTEM_PROMPT);
  assert.equal(a.db.cache.size, 2);
  assert.deepEqual([...a.db.cache.keys()].sort(), [sha(BOTH_SENTENCE), sha('en:' + BOTH_SENTENCE)].sort());
  assert.equal(a.db.saved.size, 2);
  assert.deepEqual([...a.db.saved.values()].map(r => r.lang).sort(), ['en', 'ja']);
  assert.equal((await a.post(BOTH_SENTENCE, 'ja')).body.cached, true); assert.equal((await a.post(BOTH_SENTENCE, 'en')).body.cached, true);
  assert.equal(a.anthropic.calls.length, 2);
  assert.notDeepEqual((await a.post(BOTH_SENTENCE, 'ja')).body.result, (await a.post(BOTH_SENTENCE, 'en')).body.result);
});

// ───── 저장 목록 ─────
test('저장 목록: lang 별 본인 항목만 최신순(lang 없음=ja), 다른 사용자 항목은 보이지 않는다', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  await a.post('猫が好き', 'ja'); await a.post(EN_SENTENCE, 'en'); await a.post('She runs.', 'en'); await a.post('犬が好き'); await a.post('Other user.', 'en', 2);
  assert.deepEqual((await a.saved()).body.items.map(i => i.sentence), ['犬が好き', '猫が好き'], 'lang 없음은 ja');
  assert.deepEqual((await a.saved('ja')).body.items.map(i => i.sentence), ['犬が好き', '猫が好き']);
  assert.deepEqual((await a.saved('en')).body.items.map(i => i.sentence), ['She runs.', EN_SENTENCE]);
  assert.deepEqual((await a.saved('en', 2)).body.items.map(i => i.sentence), ['Other user.']);
  assert.deepEqual((await a.saved('en', 6)).body.items, []);
  const before = a.anthropic.calls.length;
  await a.saved('en'); await a.saved('ja');
  assert.equal(a.anthropic.calls.length, before, '목록 조회는 AI 를 부르지 않는다');
  assert.ok(a.db.queries.filter(q => /FROM jgrammar_saved/.test(q)).every(q => /user_id = \$1 AND lang = \$2/.test(q)));
});

test('저장 100건 상한은 언어별: 한 언어가 100건을 넘어도 다른 언어 항목은 지워지지 않는다', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const seed = (lang, n, prefix) => { for (let i = 0; i < n; i++) { const tt = ++a.db.clock; const h = sha(lang + prefix + i); a.db.saved.set('1:' + h, { id: a.db.nextId++, user_id: 1, sentence_hash: h, sentence: prefix + i, result: lang === 'en' ? EN_GOOD : JA_GOOD, lang, created_at: tt, last_used_at: tt }); } };
  seed('ja', 100, 'ja'); seed('en', 100, 'en');
  const r = await a.post(EN_SENTENCE, 'en');   // 영어 101번째
  assert.equal(r.status, 200);
  const en = (await a.saved('en')).body.items, ja = (await a.saved('ja')).body.items;
  assert.equal(en.length, 100); assert.equal(en[0].sentence, EN_SENTENCE); assert.ok(!en.some(i => i.sentence === 'en0'), '영어 중 가장 오래된 것만 삭제');
  assert.equal(ja.length, 100); assert.ok(ja.some(i => i.sentence === 'ja0'), '일본어는 그대로');
  await a.post('猫が好き', 'ja');   // 일본어 101번째
  assert.equal((await a.saved('ja')).body.items.length, 100); assert.ok(!(await a.saved('ja')).body.items.some(i => i.sentence === 'ja0'));
  assert.equal((await a.saved('en')).body.items.length, 100, '영어는 그대로');
});

test('저장 삭제는 본인 항목만(언어 무관), 남의 항목·없는 id 는 같은 404', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  await a.post(EN_SENTENCE, 'en');
  const id = (await a.saved('en')).body.items[0].id;
  assert.equal((await a.t.call('DELETE', '/api/jgrammar/saved/' + id, undefined, { user: 2 })).status, 404);
  assert.equal((await a.saved('en')).body.items.length, 1, '남의 삭제 시도는 영향 없음');
  assert.equal((await a.t.call('DELETE', '/api/jgrammar/saved/' + id, undefined, { user: 1 })).status, 200);
  assert.deepEqual((await a.saved('en')).body.items, []);
  assert.equal(a.db.cache.size, 1, '서버 캐시는 지우지 않는다');
});

// ───── 한도 ─────
test('하루 한도는 언어와 무관하게 합산(ja 분석 + en 분석 + en OCR), 영어 OCR 도 포함', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '3';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const a = await setup((p) => (Array.isArray(p.messages[0].content) ? JSON.stringify({ sentences: ['Hello there.'] }) : JSON.stringify(/영어 문법/.test(p.system) ? EN_GOOD : JA_GOOD)));
  t.after(() => a.t.close());
  assert.equal((await a.post('猫が好き', 'ja')).status, 200);
  assert.equal((await a.post(EN_SENTENCE, 'en')).status, 200);
  assert.equal((await a.ocr(PNG, 'en')).status, 200);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar', 'jgrammar', 'jgrammar_ocr']);
  const n = a.anthropic.calls.length;
  const r1 = await a.post('Another new sentence.', 'en'), r2 = await a.post('犬が好き', 'ja'), r3 = await a.ocr(PNG, 'en'), r4 = await a.ocr(PNG);
  assert.deepEqual([r1.status, r2.status, r3.status, r4.status], [429, 429, 429, 429]);
  assert.equal(a.anthropic.calls.length, n, '한도 초과 후 AI 호출 없음');
  assert.equal((await a.post(EN_SENTENCE, 'en')).body.cached, true, '캐시 적중은 한도와 무관');
});

// ───── lang 오류와 권한 순서 ─────
test('lang 이 모르는 값이면 400(zh-Hans·zh-Hant 는 작업314 에서 정상 언어가 됨) — explain·ocr·saved 모두 AI·캐시·저장·사용량·한도 계산이 없다', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  for (const lang of ['fr', 'EN', 'Ja', '', 'zh', 'ko', 'zh-hans', 'zh_Hans', 'zh-CN', 'zh-Hans ']) {
    const e = await a.post(EN_SENTENCE, lang), s = await a.saved(lang), o = await a.ocr(PNG, lang);
    assert.deepEqual([e.status, s.status, o.status], [400, 400, 400], JSON.stringify(lang));
    assert.equal(e.body.ok, false);
    assert.equal(e.body.error, J.MSG.unknownLang, lang);
  }
  assert.equal((await a.t.call('POST', '/api/jgrammar/explain', { sentence: EN_SENTENCE, lang: 5 }, { user: 1 })).status, 400);
  assert.equal((await a.t.call('POST', '/api/jgrammar/explain', { sentence: EN_SENTENCE, lang: ['en'] }, { user: 1 })).status, 400);
  assert.equal((await a.t.call('POST', '/api/jgrammar/explain', { sentence: EN_SENTENCE, lang: { a: 1 } }, { user: 1 })).status, 400);
  assert.equal(a.anthropic.calls.length, 0);
  assert.equal(a.db.usage.length, 0);
  assert.deepEqual(nonUserQueries(a.db), [], '캐시·저장·사용량(한도) 쿼리가 하나도 없다');
  assert.deepEqual(J.LANG_CODES, ['ja', 'en', 'zh-Hans', 'zh-Hant']);
});

test('권한 없음 403 과 비로그인 401 은 lang 검사보다 먼저(잘못된 lang 이어도 403/401)', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  for (const user of [3, 77, 9]) {
    assert.equal((await a.post(EN_SENTENCE, 'fr', user)).status, 403, 'explain ' + user);
    assert.equal((await a.saved('ko', user)).status, 403, 'saved ' + user);
    assert.equal((await a.ocr(PNG, 'fr', { user })).status, 403, 'ocr ' + user);
  }
  assert.equal((await a.post(EN_SENTENCE, 'fr', null)).status, 401);
  assert.equal((await a.saved('fr', null)).status, 401);
  assert.equal((await a.ocr(PNG, 'fr', { user: null })).status, 401);
  assert.equal((await a.post(EN_SENTENCE, 'en', 3)).status, 403, '올바른 lang 이어도 권한 없으면 403');
  assert.equal((await a.post(EN_SENTENCE, 'fr', 4)).status, 400, '관리자는 권한을 통과한 뒤 lang 에서 400');
  assert.equal(a.anthropic.calls.length, 0);
  assert.deepEqual(nonUserQueries(a.db), []);
});

// ───── 영어 OCR ─────
test('영어 OCR: 영어 OCR 프롬프트로 문장 배열을 돌려주고(영어 아닌 항목은 제외), 이미지는 저장하지 않으며, 이벤트는 jgrammar_ocr', async t => {
  const a = await setup(() => JSON.stringify({ sentences: ['Hello there.', '  Nice to meet you.  ', '안녕하세요', '私は学生です', '12345', ''] }));
  t.after(() => a.t.close());
  const r = await a.ocr(PNG, 'en');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, sentences: ['Hello there.', 'Nice to meet you.'] });
  const call = a.anthropic.calls[0];
  assert.equal(call.system, J.EN_OCR_SYSTEM_PROMPT); assert.equal(call.model, J.MODEL);
  assert.equal(call.messages[0].content.find(c => c.type === 'image').source.data, PNG.toString('base64'));
  assert.match(call.messages[0].content.find(c => c.type === 'text').text, /영어/);
  for (const frag of ['데이터', '번역·설명·보정', '추측하지 말고', '빈 배열', 'JSON만']) assert.ok(J.EN_OCR_SYSTEM_PROMPT.includes(frag), frag);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar_ocr']);
  const b64 = PNG.toString('base64');
  for (const q of a.db.queries) assert.ok(!q.includes(b64));
  assert.equal(a.db.queries.filter(q => /jgrammar_cache|jgrammar_saved/.test(q)).length, 0, '인식 결과·이미지는 캐시·저장하지 않는다');
});

test('영어 OCR: 형식 오류는 1회 재시도, 두 번 틀리면 502, 영어가 없으면 빈 배열, 30문장 초과는 형식 오류', async t => {
  const a = await setup((p, n) => (n === 1 ? '{"nope":1}' : JSON.stringify({ sentences: ['Hello.'] })));
  t.after(() => a.t.close());
  const ok = await a.ocr(PNG, 'en');
  assert.equal(ok.status, 200); assert.equal(a.anthropic.calls.length, 2); assert.deepEqual(ok.body.sentences, ['Hello.']);
  const b = await setup(() => 'not json');
  t.after(() => b.t.close());
  const bad = await b.ocr(PNG, 'en');
  assert.equal(bad.status, 502); assert.equal(bad.body.error, J.MSG.ocrFail); assert.equal(b.anthropic.calls.length, J.MAX_ATTEMPTS);
  const c = await setup(() => JSON.stringify({ sentences: [] }));
  t.after(() => c.t.close());
  const empty = await c.ocr(PNG, 'en');
  assert.equal(empty.status, 200); assert.deepEqual(empty.body, { ok: true, sentences: [] });
  assert.deepEqual(J.validateOcrResult({ sentences: Array(30).fill('Hi there.') }, 'en').sentences.length, 30);
  assert.deepEqual(J.validateOcrResult({ sentences: Array(31).fill('Hi there.') }, 'en'), { invalid: true });
  assert.deepEqual(J.validateOcrResult({ sentences: ['Hi', 5] }, 'en'), { invalid: true });
  assert.deepEqual(J.validateOcrResult({ sentences: ['こんにちは', 'Hello'] }, 'ja').sentences, ['こんにちは'], 'ja 는 가나·한자 기준 그대로');
});

test('OCR 이미지 규칙은 영어에서도 그대로(415·400·413, 5MB)이고 lang 없는 OCR 은 일본어 프롬프트', async t => {
  const a = await setup(() => JSON.stringify({ sentences: ['猫が好き'] }));
  t.after(() => a.t.close());
  assert.equal((await a.ocr('text', 'en', { type: 'text/plain' })).status, 415);
  assert.equal((await a.ocr(Buffer.from('not-an-image'), 'en')).status, 400);
  assert.equal((await a.ocr(Buffer.concat([PNG, Buffer.alloc(J.OCR_MAX_BYTES)]), 'en')).status, 413);
  assert.equal(a.anthropic.calls.length, 0);
  const r = await a.ocr(PNG);
  assert.equal(r.status, 200); assert.deepEqual(r.body.sentences, ['猫が好き']);
  assert.equal(a.anthropic.calls[0].system, J.OCR_SYSTEM_PROMPT);
  assert.equal(J.OCR_MAX_BYTES, 5 * 1024 * 1024);
});

// ───── DB 단계 ─────
test('DB 단계(SQL 문장): lang 열 추가는 ADD COLUMN IF NOT EXISTS … TEXT NOT NULL DEFAULT \'ja\' 두 문장뿐이고, 기존 PK·유일 제약·인덱스 문장은 그대로 — 실DB 미확인', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8').replace(/\r\n/g, '\n');
  const alters = [...src.matchAll(/ALTER TABLE (jgrammar_\w+)[^`]*/g)].map(m => m[0]);
  assert.deepEqual(alters, ["ALTER TABLE jgrammar_cache ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ja'", "ALTER TABLE jgrammar_saved ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ja'"]);
  for (const s of alters) assert.ok(!/DROP|CONSTRAINT|PRIMARY|UNIQUE|RENAME|TYPE/i.test(s), '기존 제약·열을 건드리지 않는다: ' + s);
  assert.match(src, /sentence_hash TEXT PRIMARY KEY,\n\s+sentence\s+TEXT NOT NULL,\n\s+result\s+JSONB NOT NULL,\n\s+model\s+TEXT NOT NULL,\n\s+created_at\s+TIMESTAMPTZ DEFAULT now\(\)\n\s+\)/, 'jgrammar_cache 정의 그대로');
  assert.match(src, /UNIQUE \(user_id, sentence_hash\)\n\s+\)/, 'jgrammar_saved 유일 제약 그대로');
  assert.match(src, /CREATE INDEX IF NOT EXISTS idx_jgrammar_saved_user_used ON jgrammar_saved\(user_id, last_used_at DESC\)/);
  assert.ok(src.indexOf("ALTER TABLE jgrammar_saved ADD COLUMN") > src.indexOf('CREATE TABLE IF NOT EXISTS jgrammar_saved'), '테이블을 만든 뒤에 열을 더한다(여러 번 실행해도 안전)');
});

test('소스: 서버가 쓰는 lang 만 받고(저장 SQL 에 lang 인자), ja 이외 해시에만 언어 접두어가 붙는다', () => {
  assert.equal(J.hashSentence('a b', 'zh-Hans'), sha('zh-Hans:a b'));
  assert.equal(J.hashSentence('a b', 'en'), sha('en:a b'));
  assert.equal(J.hashSentence('a b', 'ja'), sha('a b'));
  assert.deepEqual(J.resolveLang(undefined), { lang: 'ja' }); assert.deepEqual(J.resolveLang(null), { lang: 'ja' });
  assert.deepEqual(J.resolveLang('en'), { lang: 'en' }); assert.deepEqual(J.resolveLang('ja'), { lang: 'ja' });
  assert.equal(J.LANGS.en.speech, 'en-US'); assert.equal(J.LANGS.ja.speech, 'ja-JP');
  assert.equal(J.LANGS.en.maxSentence, 300); assert.equal(J.LANGS.ja.maxSentence, 200);
  assert.equal(J.LANGS['zh-Hans'].speech, 'zh-CN'); assert.equal(J.LANGS['zh-Hant'].speech, 'zh-TW');   // 작업314: 중국어를 켬
  assert.deepEqual(J.resolveLang('zh-Hans'), { lang: 'zh-Hans' }); assert.deepEqual(J.resolveLang('zh-Hant'), { lang: 'zh-Hant' });
});
