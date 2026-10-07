// 작업205: 개념학습 돌아보기 퀴즈 API(AI 없음) - 문제 생성 규칙·서버 채점·정답 비노출·기록·삭제 연쇄.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockDb } = require('./helpers/mock_db');
const { startApp } = require('./helpers/app');
// 실제 lib/db는 모의 로더가 켜지기 전에 한 번만 불러 둔다(startApp이 lib/db를 모의로 바꾸므로)
const realDb = require('../lib/db');

async function setup() {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const t = await startApp(['routes/concept_study.js'], { db });
  return { db, call: t.call, close: t.close };
}
const S = '/api/concepts/studies';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 학습 하나와 개념들을 만든다. spec: { term, def, state, status }
async function seedStudy(call, specs, user) {
  const opt = user ? { user } : undefined;
  const study = (await call('POST', S, { topic: '퀴즈용' }, opt)).body;
  const items = {};
  for (const sp of specs) {
    const it = (await call('POST', `${S}/${study.id}/items`, { term: sp.term }, opt)).body;
    const patch = {};
    if (sp.def !== undefined) patch.definition = sp.def;
    if (sp.state) patch.review_state = sp.state;
    if (sp.status) patch.status = sp.status;
    if (Object.keys(patch).length) await call('PATCH', `/api/concepts/items/${it.id}`, patch, opt);
    items[sp.term] = { ...it, def: sp.def };
    await sleep(3);   // updated_at 순서가 갈리도록
  }
  return { study, items };
}
const SIX = [
  { term: '가', def: '가의 설명', state: 'confused' },
  { term: '나', def: '나의 설명', state: 'confused' },
  { term: '다', def: '다의 설명', state: 'new' },
  { term: '라', def: '라의 설명', state: 'new' },
  { term: '마', def: '마의 설명', state: 'understood' },
  { term: '바', def: '바의 설명', state: 'understood' },
];
// 문제가 겨냥한 개념의 용어
const targetTerm = (q, items) => {
  const all = Object.values(items);
  return q.kind === 'A' ? all.find(i => i.def === q.prompt).term : q.prompt;
};
// 정답 보기의 위치(테스트가 아는 값으로 계산 - 서버 응답에는 정답 정보가 없다)
const correctIndex = (q, items) => {
  const term = targetTerm(q, items);
  return q.options.indexOf(q.kind === 'A' ? term : items[term].def);
};

test('401·다른 사용자의 학습 404·잘못된 id', async () => {
  const { call, close } = await setup();
  const { study } = await seedStudy(call, SIX);
  assert.equal((await call('GET', `${S}/${study.id}/review`, undefined, { user: null })).status, 401);
  assert.equal((await call('POST', `${S}/${study.id}/review/answer`, { token: 'x', choice: 0 }, { user: null })).status, 401);
  assert.equal((await call('GET', `${S}/${study.id}/review`, undefined, { user: 8 })).status, 404);
  assert.equal((await call('GET', `${S}/abc/review`)).status, 404);
  assert.equal((await call('POST', `${S}/${study.id}/review/answer`, { token: 'x', choice: 0 }, { user: 8 })).status, 400, '남의 학습에 토큰이 없으면 잘못된 문제');
  await close();
});

test('개념이 4개 미만이면 문제를 만들지 않고 안내 (설명 없는·보류·제외 개념은 세지 않음)', async () => {
  const { call, close } = await setup();
  const { study } = await seedStudy(call, [
    { term: '가', def: '가의 설명' }, { term: '나', def: '나의 설명' }, { term: '다', def: '다의 설명' },
    { term: '라' },                                     // 설명 없음
    { term: '마', def: '마의 설명', status: 'held' },   // 보류
    { term: '바', def: '바의 설명', status: 'excluded' }, // 제외
  ]);
  const r = await call('GET', `${S}/${study.id}/review`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.questions, []);
  assert.equal(r.body.eligible, 3);
  assert.equal(r.body.min, 4);
  assert.match(r.body.message, /4개 이상/);
  // 4번째 개념에 설명을 넣으면 만들어진다
  const four = Object.values((await call('GET', `${S}/${study.id}`)).body.items).find(i => i.term === '라');
  await call('PATCH', `/api/concepts/items/${four.id}`, { definition: '라의 설명' });
  const ok = await call('GET', `${S}/${study.id}/review`);
  assert.equal(ok.body.eligible, 4);
  assert.ok(ok.body.questions.length >= 1);
  await close();
});

test('문제 규칙: 4지선다·서로 다른 보기·활성 개념만·정답 정보 비노출·유형 A/B 번갈아', async () => {
  const { call, close } = await setup();
  const { study, items } = await seedStudy(call, [
    ...SIX,
    { term: '사' },                                      // 설명 없음 → 보기에도 나오지 않음
    { term: '아', def: '아의 설명', status: 'held' },
    { term: '자', def: '자의 설명', status: 'excluded' },
  ]);
  const r = await call('GET', `${S}/${study.id}/review?count=10`);
  assert.equal(r.status, 200);
  assert.equal(r.body.eligible, 6);
  assert.equal(r.body.questions.length, 6, '출제 가능한 개념 수만큼(최대 10)');
  const allowedTerms = new Set(['가', '나', '다', '라', '마', '바']);
  const allowedDefs = new Set(SIX.map(s => s.def));
  r.body.questions.forEach((q, i) => {
    assert.deepEqual(Object.keys(q).sort(), ['ai_source', 'kind', 'options', 'prompt', 'token'], '정답·개념 id 필드 없음');
    assert.equal(q.kind, i % 2 === 0 ? 'A' : 'B');
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4, '보기가 서로 다름');
    for (const o of q.options) assert.ok(q.kind === 'A' ? allowedTerms.has(o) : allowedDefs.has(o), '보류·제외·설명 없는 개념은 보기에 없음: ' + o);
    assert.ok(correctIndex(q, items) >= 0, '정답 보기가 4개 안에 있음');
  });
  // 정답이 응답 어디에도 평문으로 드러나지 않는다: 토큰은 불투명(개념 id·정답 위치를 읽을 수 없음)
  const text = JSON.stringify(r.body);
  assert.ok(!/correct|answer|item_id|"i":/.test(text.replace(/"ai_source"/g, '')), '정답 관련 필드 없음');
  assert.ok(!r.body.questions.some(q => /^[\d.,]+$/.test(q.token) || Buffer.from(q.token, 'base64url').toString('utf8').includes('"i"')), '토큰이 평문 JSON이 아님');
  // 개수: 기본 5, 상한 10, 잘못된 값은 기본
  assert.equal((await call('GET', `${S}/${study.id}/review`)).body.questions.length, 5);
  assert.equal((await call('GET', `${S}/${study.id}/review?count=2`)).body.questions.length, 2);
  assert.equal((await call('GET', `${S}/${study.id}/review?count=abc`)).body.questions.length, 5);
  assert.equal((await call('GET', `${S}/${study.id}/review?count=99`)).body.questions.length, 6);
  await close();
});

test('출제 우선순위: 헷갈림 → 새것 → 이해함(오래된 순)', async () => {
  const { call, close } = await setup();
  const { study, items } = await seedStudy(call, SIX);
  // 이해함 중 "마"가 먼저(더 오래 손대지 않음), "바"가 나중
  const r = await call('GET', `${S}/${study.id}/review?count=10`);
  assert.deepEqual(r.body.questions.map(q => targetTerm(q, items)), ['가', '나', '다', '라', '마', '바']);
  // "마"를 다시 이해함으로 눌러 최근으로 만들면 "바"가 먼저 나온다
  await sleep(5);
  await call('PATCH', `/api/concepts/items/${items['마'].id}`, { review_state: 'new' });
  await sleep(5);
  await call('PATCH', `/api/concepts/items/${items['마'].id}`, { review_state: 'understood' });
  const r2 = await call('GET', `${S}/${study.id}/review?count=10`);
  assert.deepEqual(r2.body.questions.map(q => targetTerm(q, items)), ['가', '나', '다', '라', '바', '마']);
  await close();
});

test('정답은 서버에서 판정: 정답·오답 응답, 기록 저장, 이해 상태는 바뀌지 않음', async () => {
  const { db, call, close } = await setup();
  const { study, items } = await seedStudy(call, SIX);
  const qs = (await call('GET', `${S}/${study.id}/review?count=4`)).body.questions;
  const q0 = qs[0], q1 = qs[1];
  const right = correctIndex(q0, items);
  let a = await call('POST', `${S}/${study.id}/review/answer`, { token: q0.token, choice: right });
  assert.equal(a.status, 200);
  assert.equal(a.body.correct, true);
  assert.equal(a.body.correct_index, right);
  assert.equal(a.body.item.term, targetTerm(q0, items));
  assert.equal(a.body.item.definition, items[a.body.item.term].def);
  const wrongPick = (correctIndex(q1, items) + 1) % 4;
  a = await call('POST', `${S}/${study.id}/review/answer`, { token: q1.token, choice: wrongPick });
  assert.equal(a.body.correct, false);
  assert.equal(a.body.correct_index, correctIndex(q1, items), '오답이면 정답 위치를 알려 줌');
  // 기록
  const rows = db.tables.concept_quiz_attempts;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(x => [x.user_id, x.study_id, x.kind, x.correct]), [[7, study.id, q0.kind, true], [7, study.id, q1.kind, false]]);
  assert.equal(rows[0].item_id, items[targetTerm(q0, items)].id);
  // 정오로 review_state를 바꾸지 않는다
  const after = (await call('GET', `${S}/${study.id}`)).body.items;
  for (const it of after) assert.equal(it.review_state, SIX.find(s => s.term === it.term).state, it.term);
  await close();
});

test('채점 검증: 선택 범위·변조·만료·다른 사용자·다른 학습·삭제된 개념', async () => {
  const { db, call, close } = await setup();
  const { study, items } = await seedStudy(call, SIX);
  const other = await seedStudy(call, SIX, 7);   // 같은 사용자의 다른 학습
  const q = (await call('GET', `${S}/${study.id}/review?count=1`)).body.questions[0];
  const answer = (token, choice, id = study.id, opt) => call('POST', `${S}/${id}/review/answer`, { token, choice }, opt);
  for (const bad of [4, -1, 1.5, '1', null, undefined]) assert.equal((await answer(q.token, bad)).status, 400, 'choice ' + bad);
  assert.equal((await answer('', 0)).status, 400);
  assert.equal((await answer('abc', 0)).status, 400);
  assert.equal((await answer(q.token.slice(0, -2) + (q.token.endsWith('AA') ? 'BB' : 'AA'), 0)).status, 400, '변조된 토큰');
  assert.equal((await answer(q.token, 0, other.study.id)).status, 400, '다른 학습에는 쓸 수 없음');
  assert.equal((await answer(q.token, 0, study.id, { user: 8 })).status, 400, '다른 사용자는 쓸 수 없음');
  assert.equal(db.tables.concept_quiz_attempts.length, 0, '거부된 요청은 기록하지 않음');
  // 만료
  const realNow = Date.now;
  Date.now = () => realNow() + 3 * 60 * 60 * 1000;
  try { assert.equal((await answer(q.token, 0)).status, 400, '2시간이 지난 문제'); } finally { Date.now = realNow; }
  // 개념이 삭제된 뒤
  await call('DELETE', `/api/concepts/items/${items[targetTerm(q, items)].id}`);
  assert.equal((await answer(q.token, 0)).status, 404);
  assert.equal(db.tables.concept_quiz_attempts.length, 0);
  await close();
});

test('삭제하면 기록도 함께 삭제: 개념 삭제·학습 삭제', async () => {
  const { db, call, close } = await setup();
  const a = await seedStudy(call, SIX);
  const b = await seedStudy(call, SIX);
  for (const st of [a, b]) {
    const qs = (await call('GET', `${S}/${st.study.id}/review?count=3`)).body.questions;
    for (const q of qs) await call('POST', `${S}/${st.study.id}/review/answer`, { token: q.token, choice: correctIndex(q, st.items) });
  }
  assert.equal(db.tables.concept_quiz_attempts.length, 6);
  const victim = Object.values(a.items).find(i => db.tables.concept_quiz_attempts.some(x => x.item_id === i.id));
  const n = db.tables.concept_quiz_attempts.filter(x => x.item_id === victim.id).length;
  await call('DELETE', `/api/concepts/items/${victim.id}`);
  assert.equal(db.tables.concept_quiz_attempts.length, 6 - n, '개념 삭제 → 그 개념의 기록 삭제');
  await call('DELETE', `${S}/${b.study.id}`);
  assert.ok(db.tables.concept_quiz_attempts.every(x => x.study_id === a.study.id), '학습 삭제 → 그 학습의 기록 삭제');
  await close();
});

test('중복 설명이 있으면 같은 문구 보기를 만들지 않음(유형 B는 다른 유형으로 대체)', async () => {
  const { call, close } = await setup();
  const { study, items } = await seedStudy(call, [
    { term: '가', def: '같은 설명' }, { term: '나', def: '같은 설명' }, { term: '다', def: '같은 설명' }, { term: '라', def: '라의 설명' },
  ]);
  const r = await call('GET', `${S}/${study.id}/review?count=10`);
  for (const q of r.body.questions) {
    assert.equal(new Set(q.options).size, 4);
    assert.equal(q.kind, 'A', '설명이 같은 개념끼리는 설명 보기를 만들 수 없어 용어 보기로');
  }
  assert.equal(r.body.questions.length, 4);
  await close();
});

test('initDB: concept_quiz_attempts 테이블·인덱스 DDL(학습·개념·사용자 삭제 시 함께 삭제)', async () => {
  const db = createMockDb();
  db.addUser(7);
  const origConnect = realDb.pool.connect; realDb.pool.connect = async () => db.client;
  const origLog = console.log; console.log = () => {};
  try { await realDb.initDB(); } finally { realDb.pool.connect = origConnect; console.log = origLog; }
  const ddl = db.queries.map(q => q.sql).join(' ; ');
  const body = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS concept_quiz_attempts'), ddl.indexOf('idx_concept_quiz_attempts_study_id'));
  assert.ok(body.length > 50, '테이블 DDL이 실행됨');
  assert.equal((body.match(/ON DELETE CASCADE/g) || []).length, 3, 'user·study·item 모두 ON DELETE CASCADE');
  assert.match(body, /kind\s+TEXT NOT NULL CHECK \(kind IN \('A','B'\)\)/);
  assert.match(body, /correct\s+BOOLEAN NOT NULL/);
  assert.match(ddl, /CREATE INDEX IF NOT EXISTS idx_concept_quiz_attempts_study_id ON concept_quiz_attempts\(study_id\)/);
  assert.ok(ddl.indexOf('CREATE TABLE IF NOT EXISTS concept_items') < ddl.indexOf('CREATE TABLE IF NOT EXISTS concept_quiz_attempts'), '참조 대상 테이블을 먼저 만듦');
});
