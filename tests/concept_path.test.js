// 작업195-1: 선택 경로(path) 저장과 /api/me의 perm_concept_study. 실행: node --test "tests/**/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockDb } = require('./helpers/mock_db');
const { startApp, createAnthropicMock } = require('./helpers/app');
const realDb = require('../lib/db');   // 모의 로더가 켜지기 전에 실제 lib/db를 한 번만 불러 둔다

const S = '/api/concepts/studies';

async function setup(files = ['routes/concept_study.js']) {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const anthropic = createAnthropicMock();
  const t = await startApp(files, { db, anthropic });
  const sid = files.includes('routes/concept_study.js') ? (await t.call('POST', S, { topic: '분야' })).body.id : null;
  return { db, anthropic, t, call: t.call, close: t.close, sid };
}
const mk = async (call, sid, term) => (await call('POST', `${S}/${sid}/items`, { term })).body.id;
const detail = async (call, sid) => (await call('GET', `${S}/${sid}`)).body.study;
const sel = (call, sid, id) => call('PATCH', `${S}/${sid}`, { selected_item_id: id });

test('path: 선택이 바뀔 때 끝에 붙고, 연속 같은 id는 중복 추가하지 않으며, null 선택은 경로를 바꾸지 않음', async () => {
  const { call, close, sid } = await setup();
  assert.deepEqual((await detail(call, sid)).path, []);
  const [a, b, c] = [await mk(call, sid, '가'), await mk(call, sid, '나'), await mk(call, sid, '다')];
  let r = await sel(call, sid, a);
  assert.equal(r.status, 200); assert.deepEqual(r.body.path, [a]);
  assert.deepEqual((await sel(call, sid, a)).body.path, [a], '연속 같은 id');
  assert.deepEqual((await sel(call, sid, b)).body.path, [a, b]);
  assert.deepEqual((await sel(call, sid, a)).body.path, [a, b, a], '떨어져 있으면 다시 추가');
  assert.deepEqual((await sel(call, sid, null)).body.path, [a, b, a]);
  assert.equal((await detail(call, sid)).selected_item_id, null);
  assert.deepEqual((await sel(call, sid, c)).body.path, [a, b, a, c]);
  assert.deepEqual((await detail(call, sid)).path, [a, b, a, c]);
  // 제목만 바꾸는 PATCH는 경로를 건드리지 않음
  assert.deepEqual((await call('PATCH', `${S}/${sid}`, { topic: '새 이름' })).body.path, [a, b, a, c]);
  // 다른 학습의 개념은 선택·경로에 못 들어감
  const other = (await call('POST', S, { topic: '다른' })).body.id;
  const x = await mk(call, other, '엑스');
  assert.equal((await sel(call, sid, x)).status, 404);
  assert.deepEqual((await detail(call, sid)).path, [a, b, a, c]);
  await close();
});

test('path: 최근 12개만 유지', async () => {
  const { call, close, sid } = await setup();
  const ids = [];
  for (let i = 0; i < 15; i++) ids.push(await mk(call, sid, '개념' + i));
  let last;
  for (const id of ids) last = (await sel(call, sid, id)).body.path;
  assert.equal(last.length, 12);
  assert.deepEqual(last, ids.slice(-12));
  assert.deepEqual((await detail(call, sid)).path, ids.slice(-12));
  await close();
});

test('path: 삭제된 개념 id는 응답에서 걸러냄(GET·PATCH 모두), 목록에는 path를 싣지 않음', async () => {
  const { db, call, close, sid } = await setup();
  const [a, b, c] = [await mk(call, sid, '가'), await mk(call, sid, '나'), await mk(call, sid, '다')];
  for (const id of [a, b, c]) await sel(call, sid, id);
  assert.equal((await call('DELETE', `/api/concepts/items/${b}`)).status, 200);
  assert.deepEqual((await detail(call, sid)).path, [a, c]);
  assert.deepEqual(db.tables.concept_studies[0].path, [a, b, c], '저장값은 그대로, 응답에서만 거름');
  assert.deepEqual((await sel(call, sid, a)).body.path, [a, c, a]);
  assert.ok(!('path' in (await call('GET', S)).body[0]));
  await close();
});

test('path: explore가 새 개념을 선택하고 경로에 붙임(AI 실패해도 선택)', async () => {
  const { anthropic, call, close, sid } = await setup();
  const good = term => JSON.stringify({ term, definition: '설명', suggestions: [] });
  anthropic.handler = () => good('첫째');
  const first = (await call('POST', `${S}/${sid}/explore`, { text: '첫째', via: 'start' })).body.item;
  let st = await detail(call, sid);
  assert.deepEqual([st.selected_item_id, st.path], [first.id, [first.id]]);
  anthropic.handler = () => good('둘째');
  const second = (await call('POST', `${S}/${sid}/explore`, { text: '둘째', via: 'input', from_item_id: first.id })).body.item;
  st = await detail(call, sid);
  assert.deepEqual([st.selected_item_id, st.path], [second.id, [first.id, second.id]]);
  const origErr = console.error; console.error = () => {};
  try {
    anthropic.handler = () => 'not json';
    const third = (await call('POST', `${S}/${sid}/explore`, { text: '셋째', via: 'input', from_item_id: second.id })).body;
    assert.ok(third.ai_error);
    st = await detail(call, sid);
    assert.deepEqual([st.selected_item_id, st.path], [third.item.id, [first.id, second.id, third.item.id]]);
    // 같은 이름으로 다시 받아도 경로에 연속 중복이 생기지 않음
    anthropic.handler = () => good('셋째');
    await call('POST', `${S}/${sid}/explore`, { text: '셋째', from_item_id: second.id });
  } finally { console.error = origErr; }
  st = await detail(call, sid);
  assert.deepEqual(st.path, [first.id, second.id, st.selected_item_id]);
  // 한도 초과(429)·검증 실패는 경로를 바꾸지 않음
  assert.equal((await call('POST', `${S}/${sid}/explore`, { text: '' })).status, 400);
  assert.equal((await detail(call, sid)).path.length, 3);
  await close();
});

test('/api/me: perm_concept_study를 다른 권한과 같은 방식으로 내림', async () => {
  const { db, call, close } = await setup(['routes/auth.js']);
  db.addUser(9, { perm_concept_study: false });
  let r = await call('GET', '/api/me', undefined, { user: 7 });
  assert.equal(r.status, 200);
  assert.equal(r.body.perm_concept_study, true);
  assert.ok('perm_voice_study' in r.body);
  r = await call('GET', '/api/me', undefined, { user: 9 });
  assert.equal(r.body.perm_concept_study, false);
  assert.equal((await call('GET', '/api/me', undefined, { user: null })).status, 401);
  assert.match(db.queries.find(q => /FROM users WHERE id/.test(q.sql) && /perm_voice_study/.test(q.sql)).sql, /perm_voice_study, perm_concept_study/);
  await close();
});

test('initDB: path 컬럼 추가 DDL', async () => {
  const db = createMockDb();
  const real = realDb;
  const origConnect = real.pool.connect; real.pool.connect = async () => db.client;
  const origLog = console.log; console.log = () => {};
  try { await real.initDB(); } finally { real.pool.connect = origConnect; console.log = origLog; }
  assert.ok(db.queries.some(q => /ALTER TABLE concept_studies ADD COLUMN IF NOT EXISTS path JSONB NOT NULL DEFAULT '\[\]'::jsonb/.test(q.sql)));
});

test('목록: 개념 수와 이해한 개념 수(understood_count)', async () => {
  const { call, close, sid } = await setup();
  const [a, b] = [await mk(call, sid, '가'), await mk(call, sid, '나')];
  await mk(call, sid, '다');
  await call('PATCH', `/api/concepts/items/${a}`, { review_state: 'understood' });
  await call('PATCH', `/api/concepts/items/${b}`, { review_state: 'confused' });
  const other = (await call('POST', S, { topic: '빈 분야' })).body;
  assert.equal(other.understood_count, 0);
  const rows = (await call('GET', S)).body;
  assert.deepEqual(rows.find(r => r.id === sid).item_count, 3);
  assert.deepEqual(rows.find(r => r.id === sid).understood_count, 1);
  assert.deepEqual([rows.find(r => r.id === other.id).item_count, rows.find(r => r.id === other.id).understood_count], [0, 0]);
  await close();
});
