// 작업318: 문장 학습 — 영어 "의미 단위(units) + 전체 흐름(flow)" 서버 시험(형식 3). AI 는 모의, DB 는 가짜(tests/helpers/jg_db.js). 실제 Haiku 호출·실제 PostgreSQL 은 쓰지 않는다.
// 확인: units 검증(통과·실패 사유 코드) / 실패해도 번역 정상·재시도 없음·로그는 사유 코드만 / flow 형식 오류 / translation 오류 재시도 / 형식 1·2·3 판별 /
//       옛 형식(units 키 없음) 재호출·갱신·한도 / 재호출 실패 / null 형식 3 재호출 없음 / ja·zh 불변 / 저장 목록 갱신 / 403 순서 / revert 안전성(작업317 코드가 형식 3 을 읽을 때)
// 형식 2(작업317)의 structure 검증은 저장본을 읽을 때 계속 쓰므로 그 시험은 남겼다. 실행: node --test tests/jgrammar_units.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.JGRAMMAR_DAILY_CAP;
process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp, createAnthropicMock } = require('./helpers/app');
const { createJgDb } = require('./helpers/jg_db');
const J = require('../lib/jgrammar');

const S = 'She has lived in Seoul since 2020.';
const RAIL = 'Railway is stable and operational, and not currently under attack.';
const n = (kind, text, note = '설명', extra = {}) => ({ kind, role: '', text, note, ...extra });
const STRUCT = [
  n('주어 (subject)', 'She', '주인공', { role: '주어' }),
  n('동사구 (verb phrase)', 'has lived in Seoul since 2020.', '현재완료', { role: '서술', children: [
    n('동사구 (verb phrase)', 'has lived'), n('전치사구 (prepositional phrase)', 'in Seoul', '장소', { children: [n('명사구 (noun phrase)', 'Seoul')] }), n('전치사구 (prepositional phrase)', 'since 2020'),
  ] }),
];
const P = { name: '현재완료(계속)', meaning: '과거부터 지금까지 이어지는 상태', form: 'has lived', contrast: '단순 과거와 다름', level: 'B1' };
const GOOD = { ok: true, translation: '그녀는 2020년부터 서울에 살고 있다.', structure: STRUCT, points: [P] };
const OLD = { translation: '옛 번역', grammar: [{ name: '현재완료', meaning: '의미', form: 'has lived', contrast: '차이', level: 'B1' }] };   // structure 키 없는 옛 형식
const JA_OLD = { translation: '옛 번역', grammar: [{ name: 'が', meaning: '의미', form: '猫が好き', contrast: '차이', jlpt: 'N5' }] };
const ZH_OLD = { translation: '옛 번역', grammar: [{ name: '每天', meaning: '의미', form: '每天', contrast: '차이', level: '1' }] };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const v = (parsed, sentence = S) => J.validateAiResult(parsed, 'en', sentence);
const vs = (structure, sentence = S) => J.validateStructure(structure, sentence);
const isEn = p => /영어 문장을 해석/.test(p.system || '');

async function setup(handler) {
  const db = createJgDb();
  const anthropic = createAnthropicMock();
  anthropic.handler = handler || (() => JSON.stringify(G3));   // 작업318: 기본 모의 응답은 형식 3
  const t = await startApp(['routes/jgrammar.js'], { db, anthropic });
  const post = (sentence, lang = 'en', user = 1) => t.call('POST', '/api/jgrammar/explain', { sentence, lang }, { user });
  const saved = (lang = 'en', user = 1) => t.call('GET', '/api/jgrammar/saved?lang=' + lang, undefined, { user });
  return { db, anthropic, t, post, saved };
}
const seedCache = (a, sentence, lang, result) => a.db.cache.set(J.hashSentence(sentence, lang), { sentence, result, model: 'x', lang });
const seedSaved = (a, sentence, lang, result, user = 1) => {
  const h = J.hashSentence(sentence, lang), tt = ++a.db.clock;
  a.db.saved.set(user + ':' + h, { id: a.db.nextId++, user_id: user, sentence_hash: h, sentence, result, lang, created_at: tt, last_used_at: tt });
};
const cached = (a, sentence, lang = 'en') => a.db.cache.get(J.hashSentence(sentence, lang)).result;
const savedRow = (a, sentence, lang = 'en', user = 1) => a.db.saved.get(user + ':' + J.hashSentence(sentence, lang));

// ───── structure 검증 ─────
test('structure 통과: 중첩(깊이 3)·role 비어도 됨·공백 차이 무시, 노드는 kind·role·text·note·children 으로 다듬어진다', () => {
  const r = vs(STRUCT);
  assert.ok(r.structure);
  assert.deepEqual(r.structure[1].children[1].children, [{ kind: '명사구 (noun phrase)', role: '', text: 'Seoul', note: '설명' }]);
  assert.equal(r.structure[0].role, '주어');
  assert.ok(!hasOwn(r.structure[0], 'children'), '자식이 없으면 children 키 없음');
  // 최상위 text 이어 붙임은 공백을 모두 지우고 비교한다(공백 차이는 통과)
  assert.ok(vs([n('a', ' She has  lived ', 'x'), n('b', 'in Seoul\nsince 2020 .', 'x')]).structure);
  assert.ok(vs([n('a', 'She has lived in Seoul since 2020.')]).structure, '한 덩어리');
  // 부모 안 공백 차이도 무시, 자식은 부모 전체를 덮지 않아도 되고 일부만 있어도 된다
  assert.ok(vs([n('a', 'She has lived in Seoul since 2020.', 'x', { children: [n('b', 'has   lived'), n('c', 'since\n2020')] })]).structure);
  // 알 수 없는 필드·null children/role 은 무시
  const odd = vs([{ kind: 'k', role: null, text: S, note: 'n', children: null, extra: 1 }]);
  assert.deepEqual(odd.structure, [{ kind: 'k', role: '', text: S, note: 'n' }]);
});

test('structure 통과: 등위 구조에서 생략된 단어(예: "Railway is stable and operational, and not currently under attack.")는 text 에 만들어 넣지 않고 note 에서 설명', () => {
  const ok = vs([
    n('주절 (main clause)', 'Railway is stable and operational,', '철도가 안정적이고 가동 중이라는 절', { role: '주절', children: [n('형용사구 (adjective phrase)', 'stable and operational', 'is 의 보어 두 개가 and 로 이어짐', { role: '보어' })] }),
    n('등위절 (coordinated clause)', 'and not currently under attack.', '앞 절의 주어와 be동사(is)가 생략됨: (Railway is) not currently under attack', { role: '연결' }),
  ], RAIL);
  assert.ok(ok.structure);
  // 생략된 is 를 text 에 새로 넣으면 입력과 달라져 거부
  assert.deepEqual(vs([n('a', 'Railway is stable and operational,'), n('b', 'and (it is) not currently under attack.')], RAIL), { invalid: true });
  assert.deepEqual(vs([n('a', 'Railway is stable and operational,'), n('b', 'and is not currently under attack.')], RAIL), { invalid: true });
});

test('structure 실패: 최상위 이어 붙임 불일치·구두점 누락·순서 바뀜·자식 text 가 부모에 없음·자식 순서 어긋남·겹침', () => {
  const bad = [
    [n('a', 'She has lived in Seoul since 2021.')],                          // 글자 다름
    [n('a', 'She has lived in Seoul since 2020')],                           // 구두점 누락
    [n('a', 'She'), n('b', 'has lived in Seoul since')],                     // 뒷부분 누락
    [n('b', 'has lived in Seoul since 2020.'), n('a', 'She')],               // 순서 바뀜
    [n('a', S), n('b', S)],                                                  // 중복
    [n('a', S, 'x', { children: [n('b', 'in Tokyo')] })],                    // 자식이 부모에 없음
    [n('a', S, 'x', { children: [n('b', 'since 2020'), n('c', 'in Seoul')] })], // 자식 순서 어긋남
    [n('a', S, 'x', { children: [n('b', 'has lived in'), n('c', 'in Seoul')] })], // 겹침
    [n('a', S, 'x', { children: [n('b', 'She'), n('c', 'She')] })],          // 같은 조각을 두 번(부모에 한 번뿐)
    [n('a', S, 'x', { children: [n('b', 'Seoul', 'x', { children: [n('c', 'Seoul since')] })] })],   // 손자가 자식 text 밖
  ];
  for (const b of bad) assert.deepEqual(vs(b), { invalid: true }, JSON.stringify(b).slice(0, 80));
});

test('structure 상한: 깊이 3 통과·4 실패, 노드 30 통과·31 실패, 최상위 10 통과·11 실패, kind 40·note 120·role 20 경계, 빈 값·빈 배열·형식 오류', () => {
  const chain = d => { let c = null; for (let i = d; i >= 1; i--) c = n('k' + i, S, 'x', c ? { children: [c] } : {}); return [c]; };
  assert.ok(vs(chain(3)).structure); assert.deepEqual(vs(chain(4)), { invalid: true });
  const words = k => Array.from({ length: k }, (_, i) => 'w' + i);
  const flat = k => { const ws = words(k); return { sentence: ws.join(' '), nodes: ws.map(w => n('k', w)) }; };
  const wide = flat(10); assert.ok(vs(wide.nodes, wide.sentence).structure); const wide11 = flat(11); assert.deepEqual(vs(wide11.nodes, wide11.sentence), { invalid: true }, '최상위 11개');
  // 전체 노드 30개: 최상위 10 + 자식 20("ab cd" → "ab", "cd"). 31번째는 첫 자식 "ab" 아래 손자 "a"
  const pair = withGrand => ({ ...n('k', 'ab cd'), children: [{ ...n('c', 'ab'), ...(withGrand ? { children: [n('g', 'a')] } : {}) }, n('c', 'cd')] });
  const sentence30 = Array(10).fill('ab cd').join(' ');
  assert.ok(vs(Array.from({ length: 10 }, () => pair(false)), sentence30).structure, '10 + 20 = 30개 통과');
  assert.deepEqual(vs(Array.from({ length: 10 }, (_, i) => pair(i === 0)), sentence30), { invalid: true }, '31개째에서 실패');
  assert.ok(vs(Array.from({ length: 9 }, (_, i) => pair(i === 0)), Array(9).fill('ab cd').join(' ')).structure, '28 + 손자 1 = 28개 통과');
  const ok = (o, sentence = S) => vs([{ ...n('k', sentence), ...o }], sentence);
  assert.ok(ok({ kind: 'a'.repeat(40) }).structure); assert.deepEqual(ok({ kind: 'a'.repeat(41) }), { invalid: true });
  assert.ok(ok({ note: 'a'.repeat(120) }).structure); assert.deepEqual(ok({ note: 'a'.repeat(121) }), { invalid: true });
  assert.ok(ok({ role: 'a'.repeat(20) }).structure); assert.deepEqual(ok({ role: 'a'.repeat(21) }), { invalid: true });
  assert.ok(ok({ role: '' }).structure); assert.ok(ok({ role: undefined }).structure);
  for (const o of [{ kind: '' }, { kind: '  ' }, { kind: 5 }, { kind: undefined }, { note: '' }, { note: undefined }, { text: '' }, { text: '   ' }, { text: 5 }, { role: 5 }, { children: 'x' }, { children: {} }]) assert.deepEqual(ok(o), { invalid: true }, JSON.stringify(o));
  for (const b of [[], null, undefined, 'x', {}, [null], ['x'], [[]]]) assert.deepEqual(vs(b), { invalid: true }, JSON.stringify(b));
});


// ═════════ 작업318: 영어 새 형식(형식 3: 의미 단위 units + 전체 흐름 flow) ═════════
const SD = 'The October 21st incident is resolved, however, you may have seen API key revocations from OpenAI or see further API key revocations from other API providers.';
const unit = (text, extra = {}) => ({ text, meaning: '뜻 ' + text.length, role: '역할 설명', reason: '', ...extra });
const U_S = [unit('She has lived', { reason: '현재완료: 과거부터 지금까지' }), unit('in Seoul'), unit('since 2020.', { reason: 'since 는 시작 시점' })];
const U_SD = [unit('The October 21st incident is resolved,'), unit('however,'), unit('you may have seen API key revocations from OpenAI'), unit('or'), unit('see further API key revocations from other API providers.')];
const FLOW = '사건 해결 → 그러나 → 키 해지를 봤을 수 있음';
const G3 = { ok: true, translation: '그녀는 2020년부터 서울에 살고 있다.', units: U_S, flow: FLOW };
const old1 = OLD;   // 형식 1(문법 항목 목록)
const old2 = { translation: '옛 번역2', structure: STRUCT, points: [P], grammar: [] };   // 형식 2(작업317)
const stored3 = { translation: G3.translation, units: U_S, flow: FLOW, structure: null, points: [], grammar: [] };
const v3 = (parsed, sentence = S) => J.validateEnResult(parsed, sentence);
const withLogs = async fn => { const logs = [], orig = console.error; console.error = (...x) => logs.push(x.join(' ')); try { return { out: await fn(), logs }; } finally { console.error = orig; } };

test('318 units 통과: 구두점이 앞 단위에 붙은 긴 문장(however 가 별도 단위), 공백 차이, reason 빈 문자열, 호환용 키 포함', () => {
  const r = v3({ ok: true, translation: '번역', units: U_SD, flow: FLOW }, SD);
  assert.ok(r.result && !r.unitsFail); assert.equal(r.result.units.length, 5); assert.equal(r.result.units[1].text, 'however,'); assert.equal(r.result.units[3].reason, '');
  assert.deepEqual(Object.keys(r.result).sort(), ['flow', 'grammar', 'points', 'structure', 'translation', 'units']);
  assert.equal(r.result.structure, null); assert.deepEqual(r.result.points, []); assert.deepEqual(r.result.grammar, []);
  // 공백 차이(앞뒤·중간·줄바꿈)는 통과, 필드는 다듬어진다
  const sp = v3({ ok: true, translation: 't', units: [unit(' She  has lived '), unit('in\nSeoul since 2020 .', { reason: '  r  ' })], flow: FLOW });
  assert.ok(sp.result && sp.result.units[1].reason === 'r');
  // 한 덩어리, 15개 경계
  assert.ok(v3({ ok: true, translation: 't', units: [unit(S)], flow: null }).result.units.length === 1);
  const words15 = Array.from({ length: 15 }, (_, i) => 'w' + i), s15 = words15.join(' ');
  assert.equal(v3({ ok: true, translation: 't', units: words15.map((w, i) => unit(i < 14 ? w + ' ' : w)) }, s15).result.units.length, 15);
});

test('318 units 실패 사유 코드: 이어 붙임 불일치(단어 누락·순서·구두점)·빈 값·길이 상한(경계)·16개·타입 오류·빈 배열·키 없음 → units null, 번역은 정상', () => {
  const code = (units, sentence = S) => v3({ ok: true, translation: 't', units, flow: FLOW }, sentence);
  const bad = (units, expected, sentence) => { const r = code(units, sentence); assert.ok(r.result, '번역은 정상'); assert.equal(r.result.translation, 't'); assert.equal(r.result.units, null); assert.equal(r.result.flow, null); assert.equal(r.unitsFail, expected, JSON.stringify(units).slice(0, 60)); };
  bad([unit('She lived'), unit('in Seoul'), unit('since 2020.')], 'concat_mismatch');            // 단어 누락
  bad([unit('in Seoul'), unit('She has lived'), unit('since 2020.')], 'concat_mismatch');         // 순서 바뀜
  bad([unit('She has lived'), unit('in Seoul'), unit('since 2020')], 'concat_mismatch');          // 구두점 누락
  bad([unit('She has lived'), unit('in Seoul'), unit('since 2020.'), unit('extra')], 'concat_mismatch');
  bad([unit(''), unit(S)], 'empty_text'); bad([unit('   '), unit(S)], 'empty_text');
  bad([unit(S, { meaning: '' })], 'empty_meaning'); bad([unit(S, { meaning: '  ' })], 'empty_meaning'); bad([unit(S, { role: '' })], 'empty_role');
  bad([unit(S, { meaning: 'a'.repeat(121) })], 'too_long'); bad([unit(S, { role: 'a'.repeat(81) })], 'too_long'); bad([unit(S, { reason: 'a'.repeat(151) })], 'too_long');
  for (const ok of [{ meaning: 'a'.repeat(120) }, { role: 'a'.repeat(80) }, { reason: 'a'.repeat(150) }, { reason: '' }]) assert.ok(code([unit(S, ok)]).result.units, JSON.stringify(Object.keys(ok)) + ' 경계 통과');
  const words16 = Array.from({ length: 16 }, (_, i) => 'w' + i), s16 = words16.join(' ');
  bad(words16.map((w, i) => unit(i < 15 ? w + ' ' : w)), 'too_many_units', s16);
  for (const [name, x] of [['text 숫자', [{ ...unit(S), text: 5 }]], ['meaning null', [{ ...unit(S), meaning: null }]], ['role 객체', [{ ...unit(S), role: {} }]], ['reason 없음', [{ text: S, meaning: 'm', role: 'r' }]], ['reason null', [{ ...unit(S), reason: null }]], ['단위가 객체 아님', ['x']], ['단위 null', [null]], ['단위 배열', [[]]]]) bad(x, 'bad_type');
  bad([], 'empty_list'); bad('x', 'bad_type'); bad({}, 'bad_type'); bad(null, 'bad_type'); bad(7, 'bad_type');
  const noKey = v3({ ok: true, translation: 't' }); assert.equal(noKey.result.units, null); assert.equal(noKey.unitsFail, 'missing_key'); assert.ok(Object.prototype.hasOwnProperty.call(noKey.result, 'units'), '새 결과는 항상 units 키를 가진다');
});

test('318 flow: 형식이 틀리면 flow 만 null 이고 units 는 유지(길이 201·숫자·빈 값·개행·null·키 없음), 200자·화살표 문장은 통과', () => {
  for (const f of ['a'.repeat(201), 5, '', '   ', 'a\nb', 'a\r\nb', null, undefined, {}, []]) { const r = v3({ ...G3, flow: f }); assert.equal(r.result.flow, null, String(f).slice(0, 10)); assert.equal(r.result.units.length, 3); assert.ok(!r.unitsFail); }
  const noKey = { ...G3 }; delete noKey.flow; assert.equal(v3(noKey).result.flow, null); assert.equal(v3(noKey).result.units.length, 3);
  assert.equal(v3({ ...G3, flow: 'a'.repeat(200) }).result.flow.length, 200); assert.equal(v3({ ...G3, flow: ' A → B → C ' }).result.flow, 'A → B → C');
  assert.equal(v3({ ...G3, units: [], flow: FLOW }).result.flow, null, 'units 가 실패하면 flow 도 null');
});

test('318 translation 형식 오류만 재시도 대상: 거절(ok:false)은 사유, 번역 오류는 invalid. units 때문에는 재시도하지 않는다', async t => {
  assert.deepEqual(v3({ ...G3, translation: '' }), { invalid: true }); assert.deepEqual(v3({ ...G3, translation: 'a'.repeat(201) }), { invalid: true }); assert.deepEqual(v3({ ...G3, translation: 5 }), { invalid: true });
  assert.deepEqual(v3({ ok: true, units: U_S }), { invalid: true }); assert.deepEqual(v3(null), { invalid: true }); assert.deepEqual(v3([]), { invalid: true });
  assert.equal(v3({ ok: false, reason: '영어가 아님' }).rejected, '영어가 아님'); assert.equal(v3({ ok: false }).rejected, J.EN_MSG.notSentence);
  // 번역 오류: 1회 재시도 후 실패 안내, 캐시·저장 없음
  const a = await setup(() => JSON.stringify({ ...G3, translation: '' }));
  t.after(() => a.t.close());
  const { out: r } = await withLogs(() => a.post(S));
  assert.equal(r.status, 502); assert.equal(r.body.error, J.MSG.aiFail); assert.equal(a.anthropic.calls.length, 2, '재시도 1회'); assert.equal(a.db.cache.size, 0); assert.equal(a.db.saved.size, 0);
  // 첫 응답이 번역 오류, 두 번째가 정상이면 성공
  let n1 = 0; const b = await setup(() => JSON.stringify(++n1 === 1 ? { ...G3, translation: '' } : G3));
  t.after(() => b.t.close());
  const r2 = await b.post(S); assert.equal(r2.status, 200); assert.equal(b.anthropic.calls.length, 2); assert.equal(r2.body.result.units.length, 3);
});

test('318 units 실패 응답은 번역이 정상이고 재시도 없이 AI 1회로 끝나며 units·flow null 로 캐시·저장된다. 로그에는 사유 코드만 남고 문장·응답 내용은 없다', async t => {
  const a = await setup(() => JSON.stringify({ ...G3, units: [unit('SECRET wrong text')], flow: 'SECRET flow' }));
  t.after(() => a.t.close());
  const { out: r, logs } = await withLogs(() => a.post(S));
  assert.equal(r.status, 200); assert.equal(a.anthropic.calls.length, 1, '재시도 없음');
  assert.equal(r.body.result.translation, G3.translation); assert.equal(r.body.result.units, null); assert.equal(r.body.result.flow, null);
  assert.ok(hasOwn(cached(a, S), 'units') && cached(a, S).units === null); assert.equal(savedRow(a, S).result.units, null);
  assert.ok(logs.some(l => /jgrammar units fail: reason=concat_mismatch/.test(l)), '사유 코드 로그: ' + logs.join('|'));
  for (const l of logs) { for (const secret of ['SECRET', 'Seoul', 'lived', G3.translation, 'user']) assert.ok(!l.includes(secret), '로그에 내용 없음: ' + secret); }
  const again = await a.post(S); assert.equal(again.body.cached, true); assert.equal(a.anthropic.calls.length, 1, 'units null 은 이미 새 형식이라 재호출 없음');
  // units 키 없음 → missing_key
  const b = await setup(() => JSON.stringify({ ok: true, translation: '번역' }));
  t.after(() => b.t.close());
  const { out: r2, logs: l2 } = await withLogs(() => b.post(S));
  assert.equal(r2.body.result.units, null); assert.ok(l2.some(l => /reason=missing_key/.test(l))); assert.equal(b.anthropic.calls.length, 1);
  // ja·zh 의 로그·결과는 영어 규칙과 무관
  const c = await setup(() => JSON.stringify({ ok: true, ...JA_OLD, ruby: [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }] }));
  t.after(() => c.t.close());
  const { logs: l3 } = await withLogs(() => c.post('猫が好き', 'ja'));
  assert.ok(!l3.some(l => /units/.test(l)));
});

test('318 정상 흐름: 새 결과는 형식 3(units·flow + 호환 키)이고 영어 프롬프트·max_tokens 3600 으로 호출한다. 해시·ja 3000·zh 3600·OCR 프롬프트는 그대로', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const r = await a.post(S);
  assert.equal(r.status, 200); assert.equal(r.body.cached, false); assert.deepEqual(r.body.result, stored3);
  assert.equal(a.anthropic.calls[0].system, J.EN_SYSTEM_PROMPT); assert.equal(a.anthropic.calls[0].max_tokens, 3600); assert.equal(J.EN_MAX_TOKENS, 3600);
  assert.deepEqual(cached(a, S), stored3); assert.deepEqual(savedRow(a, S).result, stored3); assert.equal(a.db.saved.size, 1); assert.equal(savedRow(a, S).lang, 'en');
  const again = await a.post(S); assert.equal(again.body.cached, true); assert.equal(a.anthropic.calls.length, 1);
  assert.equal(J.LANGS.ja.maxTokens, 3000); assert.equal(J.LANGS['zh-Hans'].maxTokens, 3600); assert.equal(J.LANGS['zh-Hant'].maxTokens, 3600);
  assert.equal(J.hashSentence(S, 'en'), require('node:crypto').createHash('sha256').update('en:' + S, 'utf8').digest('hex'));
  assert.equal(J.EN_STRUCT.kind, 40);
  for (const frag of ['의미 단위', 'units', 'role', 'reason', 'flow', '이어 붙이면', '구두점은 앞 단위', '연결어', '생략된 단어', 'reason 에서 설명', '문법 용어를 나열하거나', '어휘 설명', '화살표', '지어내지 않습니다', '"ok":false', '15개 이하']) assert.ok(J.EN_SYSTEM_PROMPT.includes(frag), '프롬프트에 포함: ' + frag);
  for (const gone of ['points', 'CEFR', 'structure', 'children']) assert.ok(!J.EN_SYSTEM_PROMPT.includes(gone), '프롬프트에서 사라짐: ' + gone);
});

test('318 형식 판별: units 키부터(형식 3) → structure 키(형식 2) → 둘 다 없으면 형식 1. 형식 3 은 형식 2 로 오인되지 않고, 깨진 형식 3 행은 없는 것으로 본다', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  // 형식 3: structure: null 호환 키가 있어도 units 키가 먼저 → 재호출 없이 그대로
  seedCache(a, S, 'en', stored3);
  let r = await a.post(S); assert.equal(r.body.cached, true); assert.equal(a.anthropic.calls.length, 0); assert.deepEqual(r.body.result, stored3);
  // units: null 인 형식 3 도 새 형식
  const T = 'Cats sleep.'; seedCache(a, T, 'en', enNull('고양이는 잔다.'));
  r = await a.post(T); assert.equal(r.body.cached, true); assert.equal(r.body.result.units, null); assert.equal(a.anthropic.calls.length, 0);
  // 형식 2 읽기는 317 검증 그대로(structure 배열 유지), 호출 시 갱신 대상
  const U = 'He runs fast.'; seedCache(a, U, 'en', { translation: '그는 빨리 달린다', structure: null, points: [], grammar: [] });
  r = await a.post(U); assert.equal(a.anthropic.calls.length, 1, 'units 키가 없으면 형식 2 라도 갱신 대상');
  // 깨진 형식 3(units 가 문장과 안 맞음) → 읽기 실패 → 캐시 미스 → 새로 만든다
  const B = 'Birds fly.'; seedCache(a, B, 'en', { translation: 't', units: [unit('Wrong')], flow: null, structure: null, points: [], grammar: [] });
  const calls0 = a.anthropic.calls.length; r = await a.post(B);
  assert.equal(r.body.cached, false); assert.equal(a.anthropic.calls.length, calls0 + 1);
  // 판별 함수 수준: units 있으면 형식 3 검증만 쓴다(structure 배열이 같이 있어도 3 으로 본다)
  assert.ok(J.validateEnStored(stored3, S)); assert.equal(J.validateEnStored({ ...stored3, units: [unit('x')] }, S), null); assert.equal(J.validateEnStored({ ...stored3, flow: 'a'.repeat(201) }, S), null);
  assert.equal(J.validateEnStored({ translation: 't', units: null, flow: null }, S).units, null); assert.equal(J.validateEnStored({ translation: '', units: null }, S), null);
});
function enNull(translation) { return { translation, units: null, flow: null, structure: null, points: [], grammar: [] }; }

test('318 옛 형식(1·2) 영어 캐시 → AI 1회 재호출로 형식 3 으로 갱신(cached:false), 하루 한도·사용량(jgrammar)에 포함, 본인 저장 목록도 갱신, 이후 재호출 없음', async t => {
  for (const [name, oldRes] of [['형식 1', old1], ['형식 2', old2]]) {
    const a = await setup();
    t.after(() => a.t.close());
    seedCache(a, S, 'en', oldRes); seedSaved(a, S, 'en', oldRes);
    const r = await a.post(S);
    assert.equal(r.status, 200, name); assert.equal(r.body.cached, false, name); assert.equal(a.anthropic.calls.length, 1, name);
    assert.equal(a.anthropic.calls[0].system, J.EN_SYSTEM_PROMPT); assert.equal(a.anthropic.calls[0].max_tokens, 3600);
    assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar'], name); assert.deepEqual(r.body.result, stored3);
    assert.deepEqual(cached(a, S), stored3, name + ': 캐시가 형식 3'); assert.deepEqual(savedRow(a, S).result, stored3, name + ': 저장 목록도 갱신');
    const again = await a.post(S); assert.equal(again.body.cached, true); assert.equal(a.anthropic.calls.length, 1, name + ': 갱신 뒤 재호출 없음');
  }
});

test('318 옛 형식 갱신 호출은 하루 한도에 포함된다: 한도에 닿아 있으면 호출하지 않고 옛 결과 그대로(429 아님), 한도 직전이면 호출', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '1';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const a = await setup();
  t.after(() => a.t.close());
  seedCache(a, S, 'en', old2);
  a.db.usage.push({ user_id: 1, event_type: 'jgrammar' });
  const r = await a.post(S);
  assert.equal(r.status, 200); assert.equal(r.body.cached, true); assert.deepEqual(r.body.result, old2); assert.equal(a.anthropic.calls.length, 0); assert.deepEqual(cached(a, S), old2);
  a.db.usage.length = 0;
  const r2 = await a.post(S);
  assert.equal(r2.body.cached, false); assert.equal(a.anthropic.calls.length, 1); assert.equal(a.db.usage.length, 1);
});

test('318 옛 형식 재호출이 실패하면(키 없음·API 오류·JSON 깨짐·번역 오류·거절·units 키 없음) 옛 결과 그대로, 캐시·저장 불변, 재시도 없음', async t => {
  const noUnits = { ...G3 }; delete noUnits.units;
  const cases = [
    ['API 오류', () => { throw new Error('boom'); }], ['JSON 깨짐', () => 'not json'], ['번역 없음', () => JSON.stringify({ ...G3, translation: '' })],
    ['거절', () => JSON.stringify({ ok: false, reason: '영어가 아님' })], ['units 키 없음', () => JSON.stringify(noUnits)],
  ];
  for (const oldRes of [old1, old2]) for (const [name, handler] of cases) {
    const a = await setup(handler);
    t.after(() => a.t.close());
    seedCache(a, S, 'en', oldRes); seedSaved(a, S, 'en', oldRes);
    const { out: r } = await withLogs(() => a.post(S));
    assert.equal(r.status, 200, name); assert.equal(r.body.cached, true, name); assert.deepEqual(r.body.result, oldRes, name);
    assert.equal(a.anthropic.calls.length, 1, name + ': 재시도 없음'); assert.deepEqual(cached(a, S), oldRes, name + ': 캐시 불변'); assert.deepEqual(savedRow(a, S).result, oldRes, name + ': 저장 불변');
    assert.ok(!a.db.queries.some(q => /^UPDATE jgrammar_cache/.test(q)), name);
  }
  const prev = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    const a = await setup();
    t.after(() => a.t.close());
    seedCache(a, S, 'en', old1);
    const r = await a.post(S);
    assert.equal(r.status, 200); assert.deepEqual(r.body.result, old1); assert.equal(a.anthropic.calls.length, 0, '키 없음');
  } finally { process.env.ANTHROPIC_API_KEY = prev; }
});

test('318 갱신 응답의 units 가 키는 있으나 검증에 실패하면 units null 의 새 형식으로 갱신(번역만, 재호출 없음). 이미 형식 3(units null 포함)이면 재호출하지 않는다', async t => {
  const b = await setup(() => JSON.stringify({ ...G3, units: [unit('wrong')] }));
  t.after(() => b.t.close());
  seedCache(b, S, 'en', old1);
  const { out: r2 } = await withLogs(() => b.post(S));
  assert.equal(r2.body.cached, false); assert.equal(r2.body.result.units, null); assert.equal(r2.body.result.translation, G3.translation);
  assert.equal(cached(b, S).units, null);
  assert.equal((await b.post(S)).body.cached, true); assert.equal(b.anthropic.calls.length, 1, 'null 로 갱신된 뒤에는 재호출 없음');
  const a = await setup();
  t.after(() => a.t.close());
  seedCache(a, S, 'en', enNull('t'));
  const r = await a.post(S); assert.equal(r.body.cached, true); assert.equal(a.anthropic.calls.length, 0);
});

test('318 ja·zh 옛 캐시 동작은 그대로: 영어 갱신 조건과 섞이지 않는다(zh 옛 캐시 재호출 없음, ja 한자 옛 캐시는 후리가나로만 재호출)', async t => {
  const ZH = '我每天学习汉语。', JA = '猫が好き', JA_KANA = 'ねこがすき';
  const a = await setup(p => JSON.stringify({ ok: true, ...JA_OLD, ruby: [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }] }));
  t.after(() => a.t.close());
  seedCache(a, ZH, 'zh-Hans', ZH_OLD); seedCache(a, JA_KANA, 'ja', JA_OLD); seedCache(a, JA, 'ja', JA_OLD);
  const z = await a.post(ZH, 'zh-Hans');
  assert.equal(z.body.cached, true); assert.deepEqual(z.body.result.grammar, ZH_OLD.grammar); assert.equal(a.anthropic.calls.length, 0, 'zh 옛 캐시는 재호출하지 않는다');
  assert.ok(!hasOwn(z.body.result, 'units') && !hasOwn(z.body.result, 'ruby'));
  const k = await a.post(JA_KANA, 'ja');
  assert.equal(k.body.cached, true); assert.equal(a.anthropic.calls.length, 0, '한자 없는 ja 옛 캐시는 재호출하지 않는다'); assert.ok(!hasOwn(k.body.result, 'units'));
  const j = await a.post(JA, 'ja');
  assert.equal(j.body.cached, false); assert.equal(a.anthropic.calls.length, 1, 'ja 한자 옛 캐시는 1회 재호출');
  assert.equal(a.anthropic.calls[0].system, J.systemPrompt(true)); assert.equal(a.anthropic.calls[0].max_tokens, 3000);
  assert.ok(hasOwn(j.body.result, 'ruby') && !hasOwn(j.body.result, 'units') && !hasOwn(j.body.result, 'structure') && !hasOwn(j.body.result, 'points'));
  // ja 저장 항목은 ruby 규칙으로만 갱신된다(units 규칙과 섞이지 않는다)
  const b = await setup(() => JSON.stringify({ ok: true, ...JA_OLD, ruby: [{ text: 'ねこがすき' }] }));
  t.after(() => b.t.close());
  seedSaved(b, JA_KANA, 'ja', JA_OLD); seedCache(b, JA_KANA, 'ja', { ...JA_OLD, ruby: [] });
  await b.post(JA_KANA, 'ja');
  assert.ok(hasOwn(savedRow(b, JA_KANA, 'ja').result, 'ruby'), 'ja 저장 갱신은 ruby 규칙 그대로');
  // 영어 응답(units 키)이 와도 ja 결과에는 units 가 들어가지 않는다
  const c = await setup(() => JSON.stringify({ ok: true, ...JA_OLD, units: U_S, ruby: [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }] }));
  t.after(() => c.t.close());
  const rc = await c.post('猫が好き', 'ja'); assert.ok(!hasOwn(rc.body.result, 'units'));
});

test('318 저장 목록: units 키 없는 영어 항목(형식 1·2)이 새 결과로 갱신되고 units 가 있는 항목은 갱신되지 않는다. 다른 사용자·다른 언어 항목은 그대로, 열기는 AI 를 부르지 않는다', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  // (1) 저장 옛(1·2) + 캐시 이미 형식 3(다른 사용자가 갱신) → 캐시 적중으로 본인 저장 항목이 새 결과로
  seedCache(a, S, 'en', stored3); seedSaved(a, S, 'en', old1); seedSaved(a, S, 'en', old1, 2);
  let r = await a.post(S);
  assert.equal(r.body.cached, true); assert.equal(a.anthropic.calls.length, 0);
  assert.deepEqual(savedRow(a, S).result, stored3, '본인의 형식 1 항목 갱신'); assert.deepEqual(savedRow(a, S, 'en', 2).result, old1, '다른 사용자 항목은 그대로');
  const S2 = 'Dogs bark loudly.'; seedCache(a, S2, 'en', stored3 && { ...stored3, units: [unit('Dogs bark loudly.')], flow: null }); seedSaved(a, S2, 'en', old2);
  await a.post(S2); assert.ok(Array.isArray(savedRow(a, S2).result.units), '형식 2 항목도 갱신');
  // (2) units 가 있는 항목(null 포함)은 같은 문장을 다시 써도 바뀌지 않는다
  const T = 'Cats sleep.', kept = enNull('보존');
  seedCache(a, T, 'en', { ...stored3, units: [unit('Cats sleep.')], flow: null, translation: '캐시' }); seedSaved(a, T, 'en', kept);
  await a.post(T); assert.deepEqual(savedRow(a, T).result, kept, 'units 가 있는 저장 항목은 갱신하지 않는다');
  const T2 = 'Fish swim.', keptArr = { ...stored3, translation: '보존2', units: [unit('Fish swim.')], flow: null };
  seedCache(a, T2, 'en', enNull('캐시2')); seedSaved(a, T2, 'en', keptArr); await a.post(T2); assert.deepEqual(savedRow(a, T2).result, keptArr);
  // (3) 저장 목록 열기는 AI 를 부르지 않고 옛 형식은 그대로 돌려준다
  seedSaved(a, 'He runs.', 'en', old2);
  const before = a.anthropic.calls.length, list = (await a.saved('en')).body.items;
  assert.equal(a.anthropic.calls.length, before); assert.deepEqual(list.find(i => i.sentence === 'He runs.').result, old2); assert.deepEqual(list.find(i => i.sentence === S).result, stored3);
  // (4) 다른 언어의 같은 문장 항목은 건드리지 않는다
  seedSaved(a, S, 'ja', JA_OLD); await a.post(S); assert.deepEqual(savedRow(a, S, 'ja').result, JA_OLD);
});

test('318 저장 SQL: 영어 갱신 조건은 units 키(없음 → 있음)이고 ja 의 ruby 조건과 따로 걸려 있으며 structure 조건은 없다', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'jgrammar.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /result = CASE WHEN \(NOT \(jgrammar_saved\.result \? 'ruby'\) AND \(EXCLUDED\.result \? 'ruby'\)\)\s+OR \(NOT \(jgrammar_saved\.result \? 'units'\) AND \(EXCLUDED\.result \? 'units'\)\) THEN EXCLUDED\.result ELSE jgrammar_saved\.result END/);
  assert.ok(!/\? 'structure'\)/.test(src.slice(src.indexOf('async function saveForUser'), src.indexOf('async function listSaved'))), 'structure 조건은 없다');
});

test('권한 없음 403·비로그인 401 은 기존 순서 그대로(옛 형식 캐시가 있어도 AI·캐시·저장 쿼리가 일어나지 않음), 입력 검증도 그대로', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  seedCache(a, S, 'en', old1);
  const before = a.db.queries.length;
  assert.equal((await a.post(S, 'en', 3)).status, 403);
  assert.equal((await a.post(S, 'fr', 3)).status, 403, 'lang 검사보다 권한이 먼저');
  assert.equal((await a.post(S, 'en', null)).status, 401);
  assert.equal(a.anthropic.calls.length, 0);
  assert.ok(a.db.queries.slice(before).every(q => /FROM users/.test(q)), '권한 확인 외 쿼리 없음');
  assert.deepEqual(cached(a, S), old1);
  assert.equal((await a.post('안녕하세요', 'en')).status, 400); assert.equal((await a.post('a'.repeat(301), 'en')).status, 400); assert.equal((await a.post('', 'en')).status, 400);
});

test('revert 안전성(작업317 코드가 형식 3 을 읽을 때): 호환 키(structure: null, points: [], grammar: [])가 있어 317 코드의 읽기 규칙으로 통과하고 예외·빈 화면·반복 AI 호출이 없다. 호환 키가 없는 형식 3 은 그렇지 않다는 것도 고정', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  await a.post(S);
  const stored = cached(a, S);
  // 작업317 서버 readCache 규칙(옛 코드를 그대로 옮김): structure 키가 있으면 validateEnResult(317) → ok·translation·points 배열이면 통과(structure 가 틀려도 null 로 통과)
  const server317Accepts = o => !!o && Object.prototype.hasOwnProperty.call(o, 'structure') && typeof o.translation === 'string' && o.translation.trim() !== '' && Array.isArray(o.points);
  assert.equal(server317Accepts(stored), true, '캐시 적중으로 쓰이고 AI 를 다시 부르지 않는다');
  const noCompat = { translation: stored.translation, units: stored.units, flow: stored.flow };
  assert.equal(server317Accepts(noCompat), false, '호환 키가 없으면 317 서버는 캐시 미스로 보고 매번 AI 를 다시 부른다(그래서 호환 키가 필요)');
  // 작업317 서버 갱신 조건: structure 키가 없을 때만 재호출 → 형식 3 은 재호출 대상이 아니다
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'structure'), true);
  // 작업317 화면: validResult(translation 문자열 + grammar 배열 또는 isNewEn) / isNewEn(structure 키 + points 배열) → 열림. 렌더: structure null·points 빈 배열 → 원문·번역만 표시(예외 없음)
  const client317Opens = o => !!o && typeof o.translation === 'string' && (Array.isArray(o.grammar) || (Object.prototype.hasOwnProperty.call(o, 'structure') && Array.isArray(o.points)));
  assert.equal(client317Opens(savedRow(a, S).result), true, '저장 항목 열기가 조용히 무시되지 않는다'); assert.equal(client317Opens(noCompat), false);
  const render317Items = o => (Object.prototype.hasOwnProperty.call(o, 'structure') && Array.isArray(o.points) ? o.points : o.grammar);
  assert.deepEqual(render317Items(stored), [], '문법 항목 0개, 구조 없음 → 번역만 표시');
  assert.ok(!(Array.isArray(stored.structure) && stored.structure.length), '구조 섹션·구조 끄기 링크 없음');
  // 317 저장 UPSERT 조건: structure 키가 있으면 갱신 안 함(이미 structure 키가 있는 항목은 유지)
  assert.ok(hasOwn(savedRow(a, S).result, 'units'));
});
