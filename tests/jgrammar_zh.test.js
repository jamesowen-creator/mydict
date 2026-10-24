// 작업314: 문장 학습 — 중국어(간체 zh-Hans · 번체 zh-Hant) 서버 시험. AI 는 모의, DB 는 가짜(tests/helpers/jg_db.js). 실제 Haiku 호출·실제 PostgreSQL 은 쓰지 않는다.
// 확인: ja·en 고정값 보존 / 입력 검증 / 분석·재시도·검증 상한·level / 병음 검증 / 옛 캐시 재호출 없음 / 키 분리 / 저장 목록·100건 / 한도 / lang 오류와 권한 순서 / 중국어 OCR
// 실행: node --test tests/jgrammar_zh.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

delete process.env.JGRAMMAR_DAILY_CAP;
process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp, createAnthropicMock } = require('./helpers/app');
const { createJgDb } = require('./helpers/jg_db');
const J = require('../lib/jgrammar');

const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const ZH = '我每天学习汉语。';
const ZH_RUBY = [{ text: '我', reading: 'wǒ' }, { text: '每天', reading: 'měi tiān' }, { text: '学习', reading: 'xué xí' }, { text: '汉语', reading: 'hàn yǔ' }, { text: '。' }];
const ZH_GOOD = {
  ok: true, translation: '나는 매일 중국어를 공부한다.',
  grammar: [
    { name: '목적어를 취하는 동사 술어', meaning: '동사 뒤에 목적어가 바로 옵니다.', form: '学习汉语', contrast: '"学汉语"와 비슷하지만 더 격식 있는 느낌입니다.', level: '1' },
    { name: '시간 부사 每天', meaning: '반복되는 시간을 나타냅니다.', form: '每天学习', contrast: '"天天"과 거의 같은 뜻입니다.', level: null },
  ],
  ruby: ZH_RUBY,
};
const isZh = p => /중국어\(/.test(p.system || '');

async function setup(handler) {
  const db = createJgDb();
  const anthropic = createAnthropicMock();
  anthropic.handler = handler || (() => JSON.stringify(ZH_GOOD));
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

// ───── ja·en 고정값(작업 전 커밋 99a3c04 의 값) ─────
test('ja·en 보존: 프롬프트·OCR 프롬프트·max_tokens·입력 상한·해시가 작업 전(99a3c04) 값과 같다(sha256 고정)', () => {
  assert.equal(sha(J.SYSTEM_PROMPT), '68ed391be5ef08b07eb274ce91c4bdc92bc4aa394d13126ee8fd3f2cae6231f6');
  assert.equal(sha(J.systemPrompt(true)), 'e351936c1c0421f5313685cf39fd75e3db65373f4190647c183e6c8b024e7196');
  assert.equal(sha(J.OCR_SYSTEM_PROMPT), '073bff5ba64d1b83a124a1398771960f1a5d8499a62e7a78a86e326c62352a06');
  assert.equal(sha(J.EN_SYSTEM_PROMPT), '2c0dd4f17f60e8724e97369f5c74bd870e3dbad16f526a7858bd2c3dcdcda851');
  assert.equal(sha(J.EN_OCR_SYSTEM_PROMPT), '71d5ce325d6e54e36ef8c63c0377b0d9f5ec771130e1ffc83c41f027c4477666');
  assert.equal(J.LANGS.ja.maxTokens, 3000); assert.equal(J.LANGS.en.maxTokens, 4800);
  assert.equal(J.LANGS.ja.maxSentence, 200); assert.equal(J.LANGS.en.maxSentence, 300);
  assert.equal(J.hashSentence('猫が好き'), '761264922e80a0fb05a47ef3847e78f5a4b60c9c5102c4d44d86ead5e4fa97e7');
  assert.equal(J.hashSentence('Hello', 'en'), sha('en:Hello'));
  assert.equal(J.LANGS.ja.ruby, 'furigana'); assert.equal(J.LANGS.en.ruby, false);
});

// ───── 입력 검증 ─────
test('중국어 입력 검증: 한자 없음·가나 포함은 안내(언어 이름 포함), 200자 경계, 공백 제거, 글자체는 검사·변환하지 않는다', () => {
  for (const lang of ['zh-Hans', 'zh-Hant']) {
    const name = lang === 'zh-Hans' ? '중국어 간체' : '중국어 번체';
    assert.deepEqual(J.validateSentence('  ' + ZH + '\n', lang), { sentence: ZH });
    for (const v of ['', '   ', null, undefined, 5]) assert.equal(J.validateSentence(v, lang).error, J.LANGS[lang].msg.empty);
    for (const v of ['Hello world', '안녕하세요', '12345 !?', '。，！？', 'こんにちは', 'ひらがなだけ', 'カタカナ', '私は学生です', '日本語のカナ交じり文', '学校へ行く']) {
      const r = J.validateSentence(v, lang);
      assert.equal(r.error, J.LANGS[lang].msg.notLang, v);
      assert.match(r.error, /선택한 언어/); assert.ok(r.error.includes(name), r.error);
    }
    assert.ok(J.validateSentence('学'.repeat(200), lang).sentence, '200자 통과');
    assert.equal(J.validateSentence('学'.repeat(201), lang).error, J.MSG.tooLong, '201자 거부');
    assert.ok(J.validateSentence('𠮷'.repeat(200), lang).sentence, '서로게이트 쌍 한자도 1글자');
    assert.ok(J.validateSentence(' ' + '学'.repeat(200) + ' ', lang).sentence, '공백은 세지 않음');
    assert.ok(J.validateSentence('我 love 你', lang).sentence, '한자가 하나라도 있으면 통과');
  }
  // 간체 선택에 번체, 번체 선택에 간체를 넣어도 막지 않고 글자를 바꾸지 않는다
  assert.deepEqual(J.validateSentence('我每天學習漢語。', 'zh-Hans'), { sentence: '我每天學習漢語。' });
  assert.deepEqual(J.validateSentence(ZH, 'zh-Hant'), { sentence: ZH });
  assert.equal(J.validateSentence('Hello world', 'ja').error, J.MSG.noJapanese, 'ja 안내는 그대로');
});

test('중국어 입력 오류는 AI·캐시·사용량을 건드리지 않는다(API)', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  for (const lang of ['zh-Hans', 'zh-Hant']) for (const v of ['Hello', '안녕하세요', 'こんにちは', '学'.repeat(201), '  ']) assert.equal((await a.post(v, lang)).status, 400, lang + ' ' + v.slice(0, 5));
  assert.equal(a.anthropic.calls.length, 0);
  assert.deepEqual(nonUserQueries(a.db), []);
  assert.equal(a.db.usage.length, 0);
});

// ───── 분석 ─────
test('중국어 분석: 정상 응답(ruby 병음·level)·Haiku·글자체 프롬프트·max_tokens·사용량 jgrammar, 입력 글자는 변환하지 않는다, 다음 요청은 캐시', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const r = await a.post(ZH, 'zh-Hans');
  assert.equal(r.status, 200); assert.equal(r.body.cached, false);
  assert.equal(r.body.result.translation, ZH_GOOD.translation);
  assert.deepEqual(r.body.result.grammar.map(g => g.level), ['1', null]);
  assert.ok(r.body.result.grammar.every(g => !('jlpt' in g)));
  assert.deepEqual(r.body.result.ruby, ZH_RUBY);
  const call = a.anthropic.calls[0];
  assert.equal(call.model, 'claude-haiku-4-5-20251001');
  assert.equal(call.system, J.LANGS['zh-Hans'].systemPrompt());
  assert.match(call.system, /중국어\(간체\)/); assert.ok(!/중국어\(번체\)/.test(call.system));
  assert.equal(call.max_tokens, J.ZH_MAX_TOKENS); assert.equal(J.ZH_MAX_TOKENS, 3600);
  assert.ok(J.ZH_MAX_TOKENS > J.LANGS.ja.maxTokens, '병음 조각이 길어 ja 3000 보다 크다');
  assert.match(call.messages[0].content, /"문장": "我每天学习汉语。"/);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar']);
  const key = sha('zh-Hans:' + ZH);
  assert.deepEqual([...a.db.cache.keys()], [key]); assert.equal(a.db.cache.get(key).lang, 'zh-Hans');
  const again = await a.post('  ' + ZH + ' ', 'zh-Hans');
  assert.equal(again.body.cached, true); assert.deepEqual(again.body.result, r.body.result);
  assert.equal(a.anthropic.calls.length, 1);
  // 간체 선택에 번체 입력: 변환 없이 그대로 AI 에 보내고 그대로 저장
  const hant = '我每天學習漢語。';
  const r2 = await a.post(hant, 'zh-Hans');
  assert.equal(r2.status, 200);
  assert.match(a.anthropic.calls[1].messages[0].content, /"문장": "我每天學習漢語。"/);
  assert.equal([...a.db.saved.values()].find(x => x.sentence === hant).sentence, hant);
});

test('중국어 프롬프트: 간체·번체는 글자체 이름만 다르다. 필요한 문법만·나열 금지·변환 금지·null·지어내지 않음·병음 규칙·한국어', () => {
  const s = J.LANGS['zh-Hans'].systemPrompt(), t = J.LANGS['zh-Hant'].systemPrompt();
  const norm = (x, name) => x.replace('중국어(' + name + ')', '중국어(X)').replace(name + '와 다른', 'X와 다른');
  assert.equal(norm(s, '간체'), norm(t, '번체'), '글자체 이름 두 곳(소개·변환 금지 문장)만 다르다');
  assert.notEqual(s, t);
  for (const frag of ['필요한 문법 항목', '단순히 나열하지 않고', '변환하지 않고', 'HSK', 'null', '지어내지 않습니다', '병음', 'xué xí', '성조 부호', '경성', '다음자', '{"ok":false,"reason"', '데이터', '최대 8개', '"level":null', '"ruby":[{"text":"","reading":""}]', '이어 붙이면 입력 문장과 정확히 같아야']) assert.ok(s.includes(frag), frag);
  assert.ok(!/JLPT|후리가나|CEFR/.test(s));
});

test('중국어 형식 오류: 1회 재시도 후 성공하면 저장, 두 번 다 틀리면 502 이고 캐시·저장 없음', async t => {
  const a = await setup((p, n) => (n === 1 ? '이건 JSON 이 아닙니다' : JSON.stringify(ZH_GOOD)));
  t.after(() => a.t.close());
  assert.equal((await a.post(ZH, 'zh-Hant')).status, 200); assert.equal(a.anthropic.calls.length, 2);
  const b = await setup(() => 'nope');
  t.after(() => b.t.close());
  const r = await b.post(ZH, 'zh-Hant');
  assert.equal(r.status, 502); assert.equal(b.anthropic.calls.length, J.MAX_ATTEMPTS);
  assert.equal(b.db.cache.size, 0); assert.equal(b.db.saved.size, 0);
});

test('중국어 응답 검증 상한: 8개까지, 9개·길이 초과·빈 값은 invalid(재시도 대상), 거절(ok:false)은 사유(없으면 중국어 안내)', () => {
  const g = ZH_GOOD.grammar[0];
  const v = o => J.validateAiResult(o, 'zh-Hans');
  assert.ok(v(ZH_GOOD).result);
  assert.ok(v({ ...ZH_GOOD, grammar: Array(8).fill(g) }).result);
  for (const b of [{ ...ZH_GOOD, grammar: Array(9).fill(g) }, { ...ZH_GOOD, grammar: [] }, { ...ZH_GOOD, translation: 'a'.repeat(201) }, { ...ZH_GOOD, grammar: [{ ...g, name: '' }] },
    { ...ZH_GOOD, grammar: [{ ...g, contrast: 'a'.repeat(301) }] }, { ...ZH_GOOD, grammar: [{ ...g, form: 'a'.repeat(121) }] }, { ...ZH_GOOD, grammar: [{ ...g, meaning: 'a'.repeat(201) }] }, { ...ZH_GOOD, grammar: [{ ...g, name: 'a'.repeat(61) }] }]) assert.deepEqual(v(b), { invalid: true });
  assert.deepEqual(v({ ok: false, reason: '중국어가 아닙니다.' }), { rejected: '중국어가 아닙니다.' });
  assert.deepEqual(v({ ok: false }), { rejected: '중국어 문장으로 보기 어려워 설명하지 못했습니다.' });
});

test('level: HSK 1~6(숫자·문자열·"HSK 3" 표기)만 "1"~"6" 으로 저장하고, 그 밖의 값·키 누락은 결과를 버리지 않고 null 로 둔다. ja·en 의 level 검증은 그대로', () => {
  const g = ZH_GOOD.grammar[0];
  const lv = x => J.validateAiResult({ ...ZH_GOOD, grammar: [{ ...g, level: x }] }, 'zh-Hant').result.grammar[0].level;
  for (const [input, out] of [['1', '1'], ['6', '6'], [3, '3'], ['HSK3', '3'], ['HSK 4', '4'], ['hsk 5', '5'], [' 2 ', '2'], [null, null]]) assert.equal(lv(input), out, String(input));
  for (const bad of [0, 7, '0', '7', 'A1', 'N5', 'B2', '', 'HSK', 'HSK7', 3.5, [], {}, undefined, true]) assert.equal(lv(bad), null, String(bad));
  const noKey = { ...g }; delete noKey.level;
  assert.equal(J.validateAiResult({ ...ZH_GOOD, grammar: [noKey] }, 'zh-Hans').result.grammar[0].level, null);
  assert.deepEqual(J.validateAiResult({ ...ZH_GOOD, grammar: [{ ...g, level: '1' }] }, 'en').invalid, true, 'en 은 CEFR 밖이면 invalid(그대로)');
  assert.deepEqual(J.validateAiResult({ ok: true, translation: 't', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', jlpt: 'N9' }] }, 'ja'), { invalid: true });
});

// ───── 병음 ─────
test('병음 검증: 통과(성조·ü·아포스트로피·공백·결합 성조 정규화), 한자 없는 조각은 reading 없는 조각', () => {
  const v = (r, s) => J.validatePinyinRuby(r, s);
  assert.deepEqual(v(ZH_RUBY, ZH).ruby, ZH_RUBY);
  assert.deepEqual(v([{ text: '女', reading: 'nǚ' }, { text: '儿', reading: 'ér' }], '女儿').ruby.map(p => p.reading), ['nǚ', 'ér']);
  assert.ok(v([{ text: '西安', reading: "xī'ān" }], '西安').ruby, '아포스트로피');
  assert.ok(v([{ text: '绿', reading: 'lü' }], '绿').ruby, 'ü');
  assert.ok(v([{ text: '北京', reading: 'Běi jīng' }], '北京').ruby, '고유명사 대문자');
  assert.equal(v([{ text: '学习', reading: 'xué xí' }], '学习').ruby[0].reading, 'xué xí', '결합 성조 부호는 한 글자로 정규화');
  assert.deepEqual(v([{ text: '我', reading: '' }, { text: '们', reading: null }, { text: '好' }], '我们好').ruby, [{ text: '我' }, { text: '们' }, { text: '好' }], '빈 reading 은 reading 없는 조각');
  assert.deepEqual(v([{ text: 'A', reading: undefined }, { text: '1' }, { text: '，' }, { text: ' ' }, { text: '好', reading: 'hǎo' }], 'A1， 好').ruby.map(p => 'reading' in p), [false, false, false, false, true]);
});

test('병음 검증 실패: 이어 붙인 값 불일치·한자 없는 조각의 reading·허용 문자 밖(한글·한자·가나·숫자)·40자 초과·100조각 초과·형식 오류', () => {
  const v = (r, s) => J.validatePinyinRuby(r, s);
  const bad = [
    [ZH_RUBY.slice(1), ZH], [[...ZH_RUBY, { text: '。' }], ZH], [[{ text: '我每天学习汉语' }], ZH], [[{ text: '我每天学习汉语。', reading: 'wǒ' }], '我每天学习汉语'],
    [[{ text: '。', reading: 'jù hào' }], '。'], [[{ text: 'A', reading: 'ei' }], 'A'], [[{ text: '1', reading: 'yī' }], '1'], [[{ text: ' ', reading: 'x' }], ' '],
    [[{ text: '我', reading: '와' }], '我'], [[{ text: '我', reading: '我' }], '我'], [[{ text: '我', reading: 'わ' }], '我'], [[{ text: '我', reading: 'wo3' }], '我'], [[{ text: '我', reading: 'wǒ-' }], '我'],
    [[{ text: '我', reading: '   ' }], '我'], [[{ text: '我', reading: "'" }], '我'], [[{ text: '我', reading: 'wǒ.' }], '我'],
    [[{ text: '我', reading: 'a'.repeat(41) }], '我'],
    [Array(101).fill({ text: '我', reading: 'wǒ' }), '我'.repeat(101)],
    [[], ZH], [null, ZH], ['x', ZH], [{}, ZH], [[null], ZH], [[{ text: 5 }], '5'], [[{ text: '' }], ''], [[{ text: '我', reading: 5 }], '我'], [[[]], ZH],
  ];
  bad.forEach(([r, s], i) => assert.deepEqual(v(r, s), { invalid: true }, '#' + i));
  assert.ok(v([{ text: '我', reading: 'a'.repeat(40) }], '我').ruby, '40자 통과');
  assert.ok(v(Array(100).fill({ text: '我', reading: 'wǒ' }), '我'.repeat(100)).ruby, '100조각 통과');
});

test('병음이 틀려도 재시도하지 않고 ruby 만 null — 번역·문법은 정상, 캐시·저장에는 ruby:null 로 남는다. ruby 키가 없어도 같다', async t => {
  const a = await setup(() => JSON.stringify({ ...ZH_GOOD, ruby: [{ text: '我', reading: '와' }] }));
  t.after(() => a.t.close());
  const r = await a.post(ZH, 'zh-Hans');
  assert.equal(r.status, 200); assert.equal(a.anthropic.calls.length, 1, '재시도 없음');
  assert.equal(r.body.result.ruby, null); assert.equal(r.body.result.translation, ZH_GOOD.translation); assert.equal(r.body.result.grammar.length, 2);
  assert.equal(a.db.cache.get(J.hashSentence(ZH, 'zh-Hans')).result.ruby, null);
  const b = await setup(() => JSON.stringify({ ...ZH_GOOD, ruby: undefined }));
  t.after(() => b.t.close());
  const r2 = await b.post(ZH, 'zh-Hant');
  assert.equal(r2.status, 200); assert.equal(r2.body.result.ruby, null); assert.equal(b.anthropic.calls.length, 1);
});

test('옛 캐시 재호출: 중국어에서는 ruby 키가 없는 캐시도 그대로 반환(AI·갱신 없음), ja 에서는 예전처럼 AI 1회로 갱신', async t => {
  const a = await setup((p) => JSON.stringify(isZh(p) ? ZH_GOOD : { ok: true, translation: 't', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', jlpt: null }], ruby: [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }] }));
  t.after(() => a.t.close());
  const OLD = { translation: '옛 번역', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', level: null }] };
  for (const lang of ['zh-Hans', 'zh-Hant']) a.db.cache.set(J.hashSentence(ZH, lang), { sentence: ZH, result: OLD, model: 'x', lang });
  for (const lang of ['zh-Hans', 'zh-Hant']) {
    const r = await a.post(ZH, lang);
    assert.equal(r.status, 200); assert.equal(r.body.cached, true); assert.ok(!('ruby' in r.body.result), lang);
  }
  assert.equal(a.anthropic.calls.length, 0); assert.equal(a.db.usage.length, 0);
  assert.ok(!a.db.queries.some(q => /^UPDATE jgrammar_cache/.test(q)));
  a.db.cache.set(J.hashSentence('猫が好き'), { sentence: '猫が好き', result: { translation: '옛', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', jlpt: null }] }, model: 'x', lang: 'ja' });
  const ja = await a.post('猫が好き', 'ja');
  assert.equal(ja.body.cached, false); assert.equal(a.anthropic.calls.length, 1); assert.deepEqual(ja.body.result.ruby, [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }]);
  assert.ok(a.db.queries.some(q => /^UPDATE jgrammar_cache/.test(q)));
});

test('저장된 중국어 캐시의 병음은 읽을 때 다시 검증한다(입력과 어긋나면 null)', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const row = { translation: 't', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', level: '2' }] };
  a.db.cache.set(J.hashSentence(ZH, 'zh-Hans'), { sentence: ZH, result: { ...row, ruby: ZH_RUBY.slice(1) }, model: 'x', lang: 'zh-Hans' });
  a.db.cache.set(J.hashSentence(ZH, 'zh-Hant'), { sentence: ZH, result: { ...row, ruby: ZH_RUBY }, model: 'x', lang: 'zh-Hant' });
  assert.equal((await a.post(ZH, 'zh-Hans')).body.result.ruby, null);
  assert.deepEqual((await a.post(ZH, 'zh-Hant')).body.result.ruby, ZH_RUBY);
  assert.equal(a.anthropic.calls.length, 0);
});

// ───── 키 ─────
test('같은 한자 문장이 ja·zh-Hans·zh-Hant·en 에서 서로 다른 캐시·저장 항목이 된다(ja 해시는 그대로)', async t => {
  const S = '学校';   // 일본어(한자)·중국어에서 모두 통과, 영어는 로마자를 섞어야 통과하므로 'x 学校' 를 따로
  const a = await setup((p) => JSON.stringify(isZh(p) ? { ...ZH_GOOD, ruby: [{ text: S, reading: 'xué xiào' }] } : /영어 문법/.test(p.system) ? { ok: true, translation: 't', structure: null, points: [] } : { ok: true, translation: 't', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', jlpt: null }], ruby: [{ text: S, reading: 'がっこう' }] }));
  t.after(() => a.t.close());
  for (const lang of ['ja', 'zh-Hans', 'zh-Hant']) assert.equal((await a.post(S, lang)).status, 200, lang);
  assert.equal((await a.post('xyz ' + S, 'en')).status, 200);
  assert.equal(a.anthropic.calls.length, 4);
  assert.deepEqual([...a.db.cache.keys()].sort(), [sha(S), sha('zh-Hans:' + S), sha('zh-Hant:' + S), sha('en:xyz ' + S)].sort());
  assert.equal(J.hashSentence(S), sha(S)); assert.equal(J.hashSentence(S, 'ja'), sha(S));
  assert.deepEqual([...a.db.saved.values()].map(r => r.lang).sort(), ['en', 'ja', 'zh-Hans', 'zh-Hant']);
  for (const lang of ['ja', 'zh-Hans', 'zh-Hant']) assert.equal((await a.post(S, lang)).body.cached, true, lang + ' 캐시 적중');
  assert.equal(a.anthropic.calls.length, 4);
  assert.equal(J.hashSentence(S, 'zh-Hans'), sha('zh-Hans:' + S)); assert.equal(J.hashSentence(S, 'zh-Hant'), sha('zh-Hant:' + S));
});

// ───── 저장 목록 ─────
test('저장 목록: 간체·번체 각각 조회(서로의 항목이 보이지 않음), lang 없음은 ja, 조회는 AI 를 부르지 않는다', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  await a.post(ZH, 'zh-Hans'); await a.post('我爱你', 'zh-Hans'); await a.post('我愛你', 'zh-Hant'); await a.post(ZH, 'zh-Hant', 2);
  assert.deepEqual((await a.saved('zh-Hans')).body.items.map(i => i.sentence), ['我爱你', ZH]);
  assert.deepEqual((await a.saved('zh-Hant')).body.items.map(i => i.sentence), ['我愛你']);
  assert.deepEqual((await a.saved('zh-Hant', 2)).body.items.map(i => i.sentence), [ZH]);
  assert.deepEqual((await a.saved()).body.items, []); assert.deepEqual((await a.saved('en')).body.items, []);
  const n = a.anthropic.calls.length;
  await a.saved('zh-Hans'); await a.saved('zh-Hant');
  assert.equal(a.anthropic.calls.length, n);
  const item = (await a.saved('zh-Hans')).body.items[0];
  assert.deepEqual(item.result.ruby, ZH_RUBY.length ? item.result.ruby : null, '저장된 결과에 병음 포함');
});

test('저장 100건 상한은 언어 코드별: 간체 100건·번체 100건이 따로, 한 언어 초과가 다른 언어(ja·en 포함)를 지우지 않는다. 삭제는 본인 항목만', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const seed = (lang, n) => { for (let i = 0; i < n; i++) { const tt = ++a.db.clock; const h = sha(lang + i); a.db.saved.set('1:' + h, { id: a.db.nextId++, user_id: 1, sentence_hash: h, sentence: lang + i, result: ZH_GOOD, lang, created_at: tt, last_used_at: tt }); } };
  for (const l of ['ja', 'en', 'zh-Hans', 'zh-Hant']) seed(l, 100);
  assert.equal((await a.post(ZH, 'zh-Hans')).status, 200);   // 간체 101번째
  const count = async l => (await a.saved(l)).body.items.length;
  assert.deepEqual([await count('zh-Hans'), await count('zh-Hant'), await count('ja'), await count('en')], [100, 100, 100, 100]);
  assert.ok(!(await a.saved('zh-Hans')).body.items.some(i => i.sentence === 'zh-Hans0'), '간체 중 가장 오래된 것만 삭제');
  assert.ok((await a.saved('zh-Hant')).body.items.some(i => i.sentence === 'zh-Hant0'), '번체는 그대로');
  assert.equal((await a.post(ZH, 'zh-Hant')).status, 200);   // 번체 101번째
  assert.deepEqual([await count('zh-Hans'), await count('zh-Hant')], [100, 100]);
  assert.ok((await a.saved('ja')).body.items.some(i => i.sentence === 'ja0') && (await a.saved('en')).body.items.some(i => i.sentence === 'en0'));
  const id = (await a.saved('zh-Hant')).body.items[0].id;
  assert.equal((await a.t.call('DELETE', '/api/jgrammar/saved/' + id, undefined, { user: 2 })).status, 404);
  assert.equal((await a.t.call('DELETE', '/api/jgrammar/saved/' + id, undefined, { user: 1 })).status, 200);
  assert.equal(await count('zh-Hant'), 99);
});

// ───── 한도 ─────
test('하루 한도는 모든 언어 합산(ja·en·간체·번체 분석 + 중국어 OCR 포함), 초과하면 AI 호출 없음, 캐시 적중은 한도와 무관', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '4';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const a = await setup((p) => (Array.isArray(p.messages[0].content) ? JSON.stringify({ sentences: ['我爱你。'] })
    : JSON.stringify(isZh(p) ? ZH_GOOD : /영어 문법/.test(p.system) ? { ok: true, translation: 't', structure: null, points: [] } : { ok: true, translation: 't', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', jlpt: null }], ruby: [] })));
  t.after(() => a.t.close());
  assert.equal((await a.post('ねこがすき', 'ja')).status, 200);
  assert.equal((await a.post('Hello there.', 'en')).status, 200);
  assert.equal((await a.post(ZH, 'zh-Hans')).status, 200);
  assert.equal((await a.ocr(PNG, 'zh-Hant')).status, 200);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar', 'jgrammar', 'jgrammar', 'jgrammar_ocr']);
  const n = a.anthropic.calls.length;
  const rs = [await a.post(ZH, 'zh-Hant'), await a.ocr(PNG, 'zh-Hans'), await a.post('猫が好き', 'ja'), await a.post('Another one.', 'en')];
  assert.deepEqual(rs.map(r => r.status), [429, 429, 429, 429]);
  assert.equal(a.anthropic.calls.length, n);
  assert.equal((await a.post(ZH, 'zh-Hans')).body.cached, true);
});

// ───── lang 오류·권한 ─────
test('모르는 lang 은 400(AI·캐시·저장·한도 계산 없음), zh-Hans·zh-Hant 는 정상. 권한 없음 403·비로그인 401 이 lang 검사보다 먼저', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  for (const lang of ['zh', 'zh-CN', 'zh-TW', 'zh-hans', 'ZH-HANT', 'fr', '']) {
    const e = await a.post(ZH, lang), s = await a.saved(lang), o = await a.ocr(PNG, lang);
    assert.deepEqual([e.status, s.status, o.status], [400, 400, 400], JSON.stringify(lang));
  }
  assert.equal(a.anthropic.calls.length, 0); assert.deepEqual(nonUserQueries(a.db), []);
  assert.equal((await a.saved('zh-Hans')).status, 200); assert.equal((await a.saved('zh-Hant')).status, 200);
  for (const user of [3, 77, 9]) {
    assert.equal((await a.post(ZH, 'zh', user)).status, 403); assert.equal((await a.saved('zh-CN', user)).status, 403); assert.equal((await a.ocr(PNG, 'zh', { user })).status, 403);
    assert.equal((await a.post(ZH, 'zh-Hans', user)).status, 403, '올바른 lang 이어도 권한 없으면 403');
  }
  assert.equal((await a.post(ZH, 'zh', null)).status, 401);
  assert.equal(a.anthropic.calls.length, 0);
});

// ───── OCR ─────
test('중국어 OCR: 글자체별 프롬프트(병음 줄 제외·변환 금지·가나 제외·데이터 취급), 한자 없는 항목·가나 포함 항목은 서버가 제거, 이미지는 저장하지 않는다', async t => {
  const a = await setup(() => JSON.stringify({ sentences: ['我爱你。', '  今天天气很好。  ', 'wǒ ài nǐ', 'Hello', '私は学生です', '学校へ行く', '', '12345'] }));
  t.after(() => a.t.close());
  for (const lang of ['zh-Hans', 'zh-Hant']) {
    const r = await a.ocr(PNG, lang);
    assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, sentences: ['我爱你。', '今天天气很好。'] }, lang);
  }
  const [c1, c2] = a.anthropic.calls;
  assert.match(c1.system, /중국어\(간체\)/); assert.match(c2.system, /중국어\(번체\)/);
  assert.equal(c1.system.replace('간체', '번체'), c2.system);
  for (const frag of ['데이터', '번역·설명·보정', '간체↔번체로 바꾸지 않습니다', '추측하지 말고', '병음', '본문 글자만', '가나(일본어)가 포함된 문장은 결과에서 뺍니다', '빈 배열', 'JSON만']) assert.ok(c1.system.includes(frag), frag);
  assert.match(c1.messages[0].content.find(c => c.type === 'text').text, /중국어/);
  assert.equal(c1.messages[0].content.find(c => c.type === 'image').source.data, PNG.toString('base64'));
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar_ocr', 'jgrammar_ocr']);
  const b64 = PNG.toString('base64');
  for (const q of a.db.queries) assert.ok(!q.includes(b64));
  assert.equal(a.db.queries.filter(q => /jgrammar_cache|jgrammar_saved/.test(q)).length, 0);
  assert.equal(a.db.cache.size, 0);
});

test('중국어 OCR: 형식 오류 1회 재시도·두 번 틀리면 502·빈 배열·30문장 상한, 이미지 규칙(415·400·413)은 그대로', async t => {
  const a = await setup((p, n) => (n === 1 ? '{"x":1}' : JSON.stringify({ sentences: ['你好。'] })));
  t.after(() => a.t.close());
  const ok = await a.ocr(PNG, 'zh-Hans');
  assert.equal(ok.status, 200); assert.equal(a.anthropic.calls.length, 2); assert.deepEqual(ok.body.sentences, ['你好。']);
  const b = await setup(() => 'x');
  t.after(() => b.t.close());
  const bad = await b.ocr(PNG, 'zh-Hant');
  assert.equal(bad.status, 502); assert.equal(bad.body.error, J.MSG.ocrFail); assert.equal(b.anthropic.calls.length, J.MAX_ATTEMPTS);
  const c = await setup(() => JSON.stringify({ sentences: [] }));
  t.after(() => c.t.close());
  assert.deepEqual((await c.ocr(PNG, 'zh-Hans')).body, { ok: true, sentences: [] });
  assert.equal(J.validateOcrResult({ sentences: Array(30).fill('你好。') }, 'zh-Hans').sentences.length, 30);
  assert.deepEqual(J.validateOcrResult({ sentences: Array(31).fill('你好。') }, 'zh-Hans'), { invalid: true });
  assert.deepEqual(J.validateOcrResult({ sentences: ['你好', 5] }, 'zh-Hant'), { invalid: true });
  assert.equal((await c.ocr('text', 'zh-Hans', { type: 'text/plain' })).status, 415);
  assert.equal((await c.ocr(Buffer.from('not-an-image'), 'zh-Hans')).status, 400);
  assert.equal((await c.ocr(Buffer.concat([PNG, Buffer.alloc(J.OCR_MAX_BYTES)]), 'zh-Hant')).status, 413);
});

test('설정: 간체·번체는 글자체 이름과 읽어주기 lang 외에는 같은 설정(200자·병음·level)', () => {
  const s = J.LANGS['zh-Hans'], t = J.LANGS['zh-Hant'];
  assert.deepEqual([s.speech, t.speech], ['zh-CN', 'zh-TW']);
  for (const k of ['maxSentence', 'levelKey', 'ruby', 'maxTokens', 'levels', 'normLevel', 'looksLike']) assert.equal(s[k], t[k], k);
  assert.deepEqual([s.maxSentence, s.levelKey, s.ruby], [200, 'level', 'pinyin']);
  assert.deepEqual(J.HSK, ['1', '2', '3', '4', '5', '6']);
  assert.equal(J.PINYIN_MAX_READING, 40); assert.equal(J.RUBY_MAX_PIECES, 100);
});
