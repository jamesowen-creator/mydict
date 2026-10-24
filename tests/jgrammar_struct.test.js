// 작업317: 문장 학습 — 영어 "문장 구조(structure) + 알아둘 문법(points)" 서버 시험. AI 는 모의, DB 는 가짜(tests/helpers/jg_db.js). 실제 Haiku 호출·실제 PostgreSQL 은 쓰지 않는다.
// 확인: structure 검증(통과·실패 사례) / 실패해도 번역·points 정상·재시도 없음 / points 수준 걸러내기·3개 상한·형식 오류 재시도 /
//       옛 형식 영어 캐시 재호출·갱신·한도 / 재호출 실패 / null·빈 구조 캐시 재호출 없음 / ja·zh 옛 캐시 동작 불변 / 저장 목록 갱신 / 403 순서 / revert 안전성
// 실행: node --test tests/jgrammar_struct.test.js
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
const isEn = p => /영어 문법/.test(p.system || '');

async function setup(handler) {
  const db = createJgDb();
  const anthropic = createAnthropicMock();
  anthropic.handler = handler || (() => JSON.stringify(GOOD));
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

test('structure 가 틀리면 결과 전체가 아니라 structure 만 null: 번역·points 는 정상, 재시도 없음(JG-7 의 ruby 와 같은 방식). 키가 없어도 같다', () => {
  for (const bad of [[], [n('a', 'nope')], 'x', undefined]) {
    const r = v({ ...GOOD, structure: bad });
    assert.ok(r.result, String(bad)); assert.equal(r.result.structure, null);
    assert.equal(r.result.translation, GOOD.translation); assert.deepEqual(r.result.points, [P]);
  }
  const noKey = { ...GOOD }; delete noKey.structure;
  assert.equal(v(noKey).result.structure, null); assert.ok(hasOwn(v(noKey).result, 'structure'), '새 결과는 항상 structure 키를 가진다');
  assert.deepEqual(v(GOOD).result.grammar, []);
});

test('structure 실패 응답은 재시도 없이 AI 1회로 끝나고 structure null 로 캐시·저장된다', async t => {
  const a = await setup(() => JSON.stringify({ ...GOOD, structure: [n('a', 'wrong text')] }));
  t.after(() => a.t.close());
  const r = await a.post(S);
  assert.equal(r.status, 200); assert.equal(a.anthropic.calls.length, 1);
  assert.equal(r.body.result.structure, null); assert.equal(r.body.result.translation, GOOD.translation); assert.deepEqual(r.body.result.points, [P]);
  assert.equal(cached(a, S).structure, null); assert.ok(hasOwn(cached(a, S), 'structure'));
  assert.equal(savedRow(a, S).result.structure, null);
  const again = await a.post(S);   // structure null 캐시는 옛 형식이 아니므로 다시 부르지 않는다
  assert.equal(again.body.cached, true); assert.equal(a.anthropic.calls.length, 1);
});

// ───── points ─────
test('points: B1~C2 만 유지, A1·A2·null·그 밖의 값(JLPT·소문자·빈 값·키 없음)은 제거, 4개 이상이면 앞의 3개, 0개 정상', () => {
  const p = (name, level) => ({ ...P, name, level });
  const kept = v({ ...GOOD, points: [p('a', 'A1'), p('b', 'B1'), p('c', null), p('d', 'B2'), p('e', 'A2'), p('f', 'N5'), p('g', 'b1'), p('h', ''), p('i', 'C1'), p('j', 'C2')] }).result.points;
  assert.deepEqual(kept.map(x => x.name), ['b', 'd', 'i'], 'B1 B2 C1 → 앞의 3개');
  assert.deepEqual(v({ ...GOOD, points: ['B1', 'B2', 'C1', 'C2'].map((l, i) => p('p' + i, l)) }).result.points.map(x => x.name), ['p0', 'p1', 'p2']);
  assert.deepEqual(v({ ...GOOD, points: [p('a', 'A1'), p('b', null)] }).result.points, [], '전부 제거돼도 정상');
  assert.deepEqual(v({ ...GOOD, points: [] }).result.points, []);
  const noLevel = { ...P }; delete noLevel.level;
  assert.deepEqual(v({ ...GOOD, points: [noLevel] }).result.points, [], 'level 키가 없으면 제거(형식 오류 아님)');
  assert.deepEqual(Object.keys(kept[0]), ['name', 'meaning', 'form', 'contrast', 'level']);
  assert.ok(!hasOwn(kept[0], 'jlpt'));
  // 수준 때문에 걸러진 항목은 길이 검사를 통과해야 한다(형식 오류는 형식 오류)
  assert.deepEqual(v({ ...GOOD, points: [{ ...p('a', 'A1'), name: '' }] }), { invalid: true });
  assert.deepEqual(v({ ...GOOD, points: [{ ...p('a', 'A1'), contrast: 'x'.repeat(301) }] }), { invalid: true });
});

test('points 형식 오류(필드 누락·길이 초과·배열 아님)는 invalid → 1회 재시도, 그래도 틀리면 502 이고 캐시·저장 없음. 수준 제거는 재시도를 일으키지 않는다', async t => {
  const badPoints = { ...GOOD, points: [{ ...P, form: undefined }] };
  const a = await setup((p, k) => JSON.stringify(k === 1 ? badPoints : GOOD));
  t.after(() => a.t.close());
  const ok = await a.post(S);
  assert.equal(ok.status, 200); assert.equal(a.anthropic.calls.length, 2);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar', 'jgrammar']);
  const b = await setup(() => JSON.stringify({ ...GOOD, points: 'x' }));
  t.after(() => b.t.close());
  const r = await b.post(S);
  assert.equal(r.status, 502); assert.equal(r.body.error, J.MSG.aiFail); assert.equal(b.anthropic.calls.length, J.MAX_ATTEMPTS);
  assert.equal(b.db.cache.size, 0); assert.equal(b.db.saved.size, 0);
  const c = await setup(() => JSON.stringify({ ...GOOD, translation: '' }));
  t.after(() => c.t.close());
  assert.equal((await c.post(S)).status, 502); assert.equal(c.anthropic.calls.length, 2);
  const d = await setup(() => JSON.stringify({ ...GOOD, points: [{ ...P, level: 'A1' }, { ...P, level: null }] }));
  t.after(() => d.t.close());
  const rd = await d.post(S);
  assert.equal(rd.status, 200); assert.equal(d.anthropic.calls.length, 1, '수준 때문에 제거해도 재시도 없음'); assert.deepEqual(rd.body.result.points, []);
});

test('영어 프롬프트가 구조·points 규칙을 담고 max_tokens 는 4800 으로 호출한다. ja 3000·zh 3600 은 그대로', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  await a.post(S);
  assert.equal(a.anthropic.calls[0].system, J.EN_SYSTEM_PROMPT); assert.equal(a.anthropic.calls[0].max_tokens, 4800);
  assert.equal(J.LANGS.ja.maxTokens, 3000); assert.equal(J.LANGS.ja.maxTokens, J.MAX_TOKENS); assert.equal(J.LANGS['zh-Hans'].maxTokens, 3600); assert.equal(J.LANGS['zh-Hant'].maxTokens, 3600);
  assert.equal(J.hashSentence(S, 'en'), require('node:crypto').createHash('sha256').update('en:' + S, 'utf8').digest('hex'));
  assert.equal(J.EN_STRUCT.kind, 40); assert.equal(J.EN_STRUCT.note, 120); assert.equal(J.EN_STRUCT.role, 20);
});

// ───── 옛 형식 영어 캐시 ─────
test('옛 형식 영어 캐시 → AI 1회 재호출로 캐시를 새 형식으로 갱신(cached:false), 하루 한도·사용량(jgrammar)에 포함, 본인 저장 목록도 갱신', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  seedCache(a, S, 'en', OLD); seedSaved(a, S, 'en', OLD);
  const r = await a.post(S);
  assert.equal(r.status, 200); assert.equal(r.body.cached, false); assert.equal(a.anthropic.calls.length, 1);
  assert.equal(a.anthropic.calls[0].system, J.EN_SYSTEM_PROMPT); assert.equal(a.anthropic.calls[0].max_tokens, 4800);
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar']);
  assert.ok(Array.isArray(r.body.result.structure)); assert.deepEqual(r.body.result.points, [P]);
  assert.deepEqual(cached(a, S), r.body.result, '캐시가 새 형식');
  assert.deepEqual(savedRow(a, S).result, r.body.result, '저장 목록의 옛 형식 항목도 새 결과로 갱신');
  const again = await a.post(S);
  assert.equal(again.body.cached, true); assert.equal(a.anthropic.calls.length, 1, '갱신 뒤에는 재호출 없음');
});

test('옛 형식 갱신 호출은 하루 한도에 포함된다: 한도에 닿아 있으면 호출하지 않고 옛 결과 그대로(429 아님), 한도 직전이면 호출', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '1';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const a = await setup();
  t.after(() => a.t.close());
  seedCache(a, S, 'en', OLD);
  a.db.usage.push({ user_id: 1, event_type: 'jgrammar' });
  const r = await a.post(S);
  assert.equal(r.status, 200); assert.equal(r.body.cached, true); assert.deepEqual(r.body.result, OLD); assert.equal(a.anthropic.calls.length, 0);
  assert.deepEqual(cached(a, S), OLD);
  a.db.usage.length = 0;
  const r2 = await a.post(S);
  assert.equal(r2.body.cached, false); assert.equal(a.anthropic.calls.length, 1);
  assert.equal(a.db.usage.length, 1);
});

test('옛 형식 재호출이 실패하면(키 없음·API 오류·JSON 깨짐·형식 오류·거절·structure 키 없음) 옛 결과 그대로, 캐시 불변, 재시도 없음', async t => {
  const noKey = { ...GOOD }; delete noKey.structure;
  const cases = [
    ['API 오류', () => { throw new Error('boom'); }], ['JSON 깨짐', () => 'not json'], ['번역 없음', () => JSON.stringify({ ...GOOD, translation: '' })],
    ['points 형식 오류', () => JSON.stringify({ ...GOOD, points: [{ name: 'x' }] })], ['거절', () => JSON.stringify({ ok: false, reason: '영어가 아님' })],
    ['structure 키 없음', () => JSON.stringify(noKey)],
  ];
  for (const [name, handler] of cases) {
    const a = await setup(handler);
    t.after(() => a.t.close());
    seedCache(a, S, 'en', OLD); seedSaved(a, S, 'en', OLD);
    const r = await a.post(S);
    assert.equal(r.status, 200, name); assert.equal(r.body.cached, true, name); assert.deepEqual(r.body.result, OLD, name);
    assert.equal(a.anthropic.calls.length, 1, name + ': 재시도 없음');
    assert.deepEqual(cached(a, S), OLD, name + ': 캐시 불변'); assert.deepEqual(savedRow(a, S).result, OLD, name + ': 저장 불변');
    assert.ok(!a.db.queries.some(q => /^UPDATE jgrammar_cache/.test(q)), name);
  }
  const prev = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    const a = await setup();
    t.after(() => a.t.close());
    seedCache(a, S, 'en', OLD);
    const r = await a.post(S);
    assert.equal(r.status, 200); assert.deepEqual(r.body.result, OLD); assert.equal(a.anthropic.calls.length, 0, '키 없음');
  } finally { process.env.ANTHROPIC_API_KEY = prev; }
});

test('structure 가 null 이거나 검증 실패로 갱신된 결과는 다시 재호출하지 않는다. structure 가 틀려도 structure 키가 있으면 갱신으로 인정(null)', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  seedCache(a, S, 'en', { translation: 't', structure: null, points: [], grammar: [] });
  const r = await a.post(S);
  assert.equal(r.body.cached, true); assert.equal(a.anthropic.calls.length, 0);
  assert.equal(r.body.result.structure, null);
  const b = await setup(() => JSON.stringify({ ...GOOD, structure: [n('a', 'wrong')] }));
  t.after(() => b.t.close());
  seedCache(b, S, 'en', OLD);
  const r2 = await b.post(S);
  assert.equal(r2.body.cached, false); assert.equal(r2.body.result.structure, null); assert.deepEqual(r2.body.result.points, [P]);
  assert.equal((await b.post(S)).body.cached, true); assert.equal(b.anthropic.calls.length, 1, 'null 로 갱신된 뒤에는 재호출 없음');
});

test('ja·zh 옛 캐시 동작은 그대로: 영어 갱신 조건과 섞이지 않는다(zh 옛 캐시 재호출 없음, ja 한자 옛 캐시는 후리가나로만 재호출, 영어 형식 응답은 ja 갱신에 쓰이지 않음)', async t => {
  const ZH = '我每天学习汉语。', JA = '猫が好き', JA_KANA = 'ねこがすき';
  const a = await setup(p => JSON.stringify({ ok: true, ...JA_OLD, ruby: [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }] }));
  t.after(() => a.t.close());
  seedCache(a, ZH, 'zh-Hans', ZH_OLD); seedCache(a, JA_KANA, 'ja', JA_OLD); seedCache(a, JA, 'ja', JA_OLD);
  const z = await a.post(ZH, 'zh-Hans');
  assert.equal(z.body.cached, true); assert.deepEqual(z.body.result.grammar, ZH_OLD.grammar); assert.equal(a.anthropic.calls.length, 0, 'zh 옛 캐시는 재호출하지 않는다');
  assert.ok(!hasOwn(z.body.result, 'structure') && !hasOwn(z.body.result, 'ruby'));
  const k = await a.post(JA_KANA, 'ja');
  assert.equal(k.body.cached, true); assert.equal(a.anthropic.calls.length, 0, '한자 없는 ja 옛 캐시는 재호출하지 않는다');
  assert.ok(!hasOwn(k.body.result, 'structure'));
  const j = await a.post(JA, 'ja');
  assert.equal(j.body.cached, false); assert.equal(a.anthropic.calls.length, 1, 'ja 한자 옛 캐시는 1회 재호출');
  assert.equal(a.anthropic.calls[0].system, J.systemPrompt(true)); assert.equal(a.anthropic.calls[0].max_tokens, 3000);
  assert.ok(hasOwn(j.body.result, 'ruby') && !hasOwn(j.body.result, 'structure') && !hasOwn(j.body.result, 'points'));
  // ja·zh 저장 항목은 structure 키 유무로는 갱신되지 않는다(ruby 규칙만)
  const b = await setup(() => JSON.stringify({ ok: true, ...JA_OLD, ruby: [{ text: 'ねこがすき' }] }));
  t.after(() => b.t.close());
  seedSaved(b, JA_KANA, 'ja', JA_OLD); seedCache(b, JA_KANA, 'ja', { ...JA_OLD, ruby: [] });
  await b.post(JA_KANA, 'ja');
  assert.ok(hasOwn(savedRow(b, JA_KANA, 'ja').result, 'ruby'), 'ja 저장 갱신은 ruby 규칙 그대로');
});

// ───── 저장 목록 ─────
test('저장 목록: 옛 형식 영어 항목이 새 결과로 갱신되고 새 형식 항목은 갱신되지 않는다. 같은 문장이 다른 사용자·다른 언어 항목은 건드리지 않는다', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  // (1) 저장 옛 + 캐시 이미 새 형식(다른 사용자가 갱신) → 캐시 적중으로 저장 항목이 새 결과로 갱신
  const newer = { translation: GOOD.translation, structure: STRUCT, points: [P], grammar: [] };
  seedCache(a, S, 'en', newer); seedSaved(a, S, 'en', OLD); seedSaved(a, S, 'en', OLD, 2);
  const r = await a.post(S);
  assert.equal(r.body.cached, true); assert.equal(a.anthropic.calls.length, 0);
  assert.deepEqual(savedRow(a, S).result, newer, '본인의 옛 항목 갱신');
  assert.deepEqual(savedRow(a, S, 'en', 2).result, OLD, '다른 사용자 항목은 그대로');
  // (2) 새 형식 항목은 같은 문장을 다시 써도 바뀌지 않는다(structure null 이어도 새 형식)
  const T = 'Cats sleep.';
  const kept = { translation: '보존', structure: null, points: [], grammar: [] };
  seedCache(a, T, 'en', { translation: '캐시', structure: null, points: [], grammar: [] }); seedSaved(a, T, 'en', kept);
  await a.post(T);
  assert.deepEqual(savedRow(a, T).result, kept, '새 형식 저장 항목은 갱신하지 않는다(저장 시 결과는 바꾸지 않는다)');
  // (3) 저장 목록 열기는 AI 를 부르지 않고 옛 형식은 그대로(structure 키 없이) 돌려준다
  seedSaved(a, 'He runs.', 'en', OLD);
  const before = a.anthropic.calls.length;
  const list = (await a.saved('en')).body.items;
  assert.equal(a.anthropic.calls.length, before);
  assert.deepEqual(list.find(i => i.sentence === 'He runs.').result, OLD);
  assert.ok(!hasOwn(list.find(i => i.sentence === 'He runs.').result, 'structure'));
  assert.deepEqual(list.find(i => i.sentence === S).result, newer);
});

test('저장 목록 정상 흐름: 처음 분석한 새 형식 결과는 그대로 저장되고(structure·points·grammar:[]), 100건 상한·언어별 저장은 그대로', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const r = await a.post(S);
  assert.deepEqual(savedRow(a, S).result, r.body.result);
  assert.deepEqual(Object.keys(r.body.result).sort(), ['grammar', 'points', 'structure', 'translation']);
  assert.equal(savedRow(a, S).lang, 'en');
  assert.equal(a.db.saved.size, 1);
});

// ───── 권한 · 입력 · revert ─────
test('권한 없음 403·비로그인 401 은 기존 순서 그대로(옛 형식 캐시가 있어도 AI·캐시·저장 쿼리가 일어나지 않음), 입력 검증도 그대로', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  seedCache(a, S, 'en', OLD);
  const before = a.db.queries.length;
  assert.equal((await a.post(S, 'en', 3)).status, 403);
  assert.equal((await a.post(S, 'fr', 3)).status, 403, 'lang 검사보다 권한이 먼저');
  assert.equal((await a.post(S, 'en', null)).status, 401);
  assert.equal(a.anthropic.calls.length, 0);
  assert.ok(a.db.queries.slice(before).every(q => /FROM users/.test(q)), '권한 확인 외 쿼리 없음');
  assert.deepEqual(cached(a, S), OLD);
  assert.equal((await a.post('안녕하세요', 'en')).status, 400); assert.equal((await a.post('a'.repeat(301), 'en')).status, 400);
  assert.equal((await a.post('', 'en')).status, 400);
});

test('revert 안전성: 새 형식 영어 결과는 grammar: [] 를 포함해 작업317 이전 코드가 읽어도 예외·빈 화면이 생기지 않는다(옛 코드의 읽기 규칙을 그대로 옮겨 확인)', async t => {
  const a = await setup();
  t.after(() => a.t.close());
  const r = await a.post(S);
  const stored = cached(a, S);
  assert.deepEqual(stored.grammar, []); assert.equal(typeof stored.translation, 'string');
  // 옛 서버 readCache: validateAiResult 가 grammar 배열(1~8개)을 요구 → 새 형식은 "깨진 행"으로 보고 캐시 미스 → AI 재생성(예외 없음). writeCache 는 ON CONFLICT DO NOTHING 이라 새 형식 캐시는 남는다
  const oldServerAccepts = o => o && typeof o.translation === 'string' && Array.isArray(o.grammar) && o.grammar.length >= 1 && o.grammar.length <= 8;
  assert.equal(oldServerAccepts(stored), false);
  assert.equal(oldServerAccepts(OLD), true);
  // 옛 서버 saveForUser 의 UPSERT 는 ruby 키만 보므로 영어 새 형식 항목을 덮어쓰지 않는다. 옛 화면 validResult: translation 문자열 + grammar 배열 → 통과, 문법 항목 0개로 원문·번역만 표시
  const oldClientOpens = o => !!o && typeof o.translation === 'string' && Array.isArray(o.grammar);
  assert.equal(oldClientOpens(savedRow(a, S).result), true, '옛 화면에서 저장 항목 열기가 조용히 무시되지 않는다');
  const withoutGrammar = { ...r.body.result }; delete withoutGrammar.grammar;
  assert.equal(oldClientOpens(withoutGrammar), false, 'grammar 키가 없으면 옛 화면은 항목을 열지 못한다 — 그래서 빈 배열을 둔다');
  // 옛 서버가 새 형식 캐시를 만나면 AI 를 부르지만 결과는 저장 목록에 영향 없음: 새 코드 기준으로도 새 형식 저장 항목은 유지
  assert.ok(hasOwn(savedRow(a, S).result, 'structure'));
});
