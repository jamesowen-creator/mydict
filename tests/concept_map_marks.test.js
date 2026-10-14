// 작업275-4: "모르는 개념" 표시 서버 규칙 — 설정·해제 멱등, 사용자별 격리, 권한, 개념 삭제 시 표시 삭제, 지도 조회 응답의 표시 목록과 한 줄 설명(brief).
// 가짜 DB(tests/helpers/cmap_db.js)는 실제 PG 제약을 흉내 낸 것이다(한계). 서버는 t.after 로 종료한다. 실행: node --test tests/concept_map_marks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCmapDb } = require('./helpers/cmap_db');
const { startApp } = require('./helpers/app');

async function setup() {
  const db = createCmapDb();
  db.addUser(1, { perm_concept_map: true });
  db.addUser(2, { perm_concept_map: true });
  db.addUser(3, { perm_concept_map: false });
  const t = await startApp(['routes/concept_map.js'], { db });
  const call = (method, url, body, user = 1) => t.call(method, url, body, { user });
  const world = async (user = 1) => {
    const sci = (await call('POST', '/api/cmap/topics', { title: '과학' }, user)).body.topic;
    const mk = async (body) => (await call('POST', `/api/cmap/topics/${sci.id}/concepts`, body, user)).body.concept;
    const a = await mk({ term: '힘', explanation: { definition: '물체의 운동 상태를 바꾸는 원인입니다.', example: '공을 찹니다.' }, explanation_source: 'ai' });
    const b = await mk({ term: '질량' });                                                                                      // 설명 없음
    const c = await mk({ term: '마찰', explanation: { definition: '옛 정의', in_context: '옛 맥락', example: '옛 예', confusion: '옛 헷갈림' }, explanation_source: 'ai' });
    const d = await mk({ term: '긴설명', explanation: { definition: '가'.repeat(300) }, explanation_source: 'manual' });
    const get = async (u = user) => (await call('GET', `/api/cmap/topics/${sci.id}/map`, undefined, u)).body;
    return { sci, a, b, c, d, get, mark: (id, marked, u = user) => call('PUT', `/api/cmap/concepts/${id}/mark`, { marked }, u) };
  };
  return { db, t, call, world };
}
const fail = (r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.ok, false); };

test('표시 설정·해제는 멱등: 두 번 설정해도 한 행, 해제도 두 번 해도 성공, 응답은 최종 상태', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  assert.deepEqual((await w.get()).marked_concept_ids, []);
  let r = await w.mark(w.a.id, true);
  assert.equal(r.status, 200); assert.deepEqual([r.body.concept_id, r.body.marked], [w.a.id, true]);
  r = await w.mark(w.a.id, true); assert.equal(r.status, 200); assert.equal(r.body.marked, true);
  assert.equal(s.db.marks.length, 1);
  assert.deepEqual((await w.get()).marked_concept_ids, [w.a.id]);
  await w.mark(w.b.id, true);
  assert.deepEqual((await w.get()).marked_concept_ids, [w.a.id, w.b.id].sort((x, y) => x - y));
  r = await w.mark(w.a.id, false); assert.equal(r.status, 200); assert.equal(r.body.marked, false);
  r = await w.mark(w.a.id, false); assert.equal(r.status, 200, '이미 해제된 것을 다시 해제해도 성공');
  assert.deepEqual((await w.get()).marked_concept_ids, [w.b.id]);
  assert.equal(s.db.marks.length, 1);
  assert.ok(s.db.marks[0].marked_at);
});

test('입력 검증: marked 는 불리언만, 형식이 틀린 id·없는 개념은 거부하고 아무것도 저장하지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const before = s.db.snapshot();
  for (const body of [{}, { marked: 'true' }, { marked: 1 }, { marked: null }]) fail(await s.call('PUT', `/api/cmap/concepts/${w.a.id}/mark`, body), 400);
  assert.equal((await s.call('PUT', '/api/cmap/concepts/abc/mark', { marked: true })).status, 404);
  assert.equal((await s.call('PUT', '/api/cmap/concepts/99999/mark', { marked: true })).status, 404);
  assert.equal(s.db.snapshot(), before);
});

test('사용자별 격리: 다른 사용자의 개념은 표시할 수 없고(404), 같은 개념 id 의 표시는 사용자마다 따로다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w1 = await s.world(1);
  const w2 = await s.world(2);
  const before = s.db.snapshot();
  fail(await w1.mark(w2.a.id, true), 404);                              // 1번 사용자가 2번 사용자의 개념을 표시
  fail(await w2.mark(w1.a.id, true, 2), 404);
  assert.equal(s.db.snapshot(), before, '거부된 요청은 아무것도 바꾸지 않음');
  await w1.mark(w1.a.id, true);
  assert.deepEqual((await w1.get()).marked_concept_ids, [w1.a.id]);
  assert.deepEqual((await w2.get(2)).marked_concept_ids, [], '다른 사용자의 표시는 보이지 않음');
  await w2.mark(w2.b.id, true, 2);
  assert.deepEqual((await w1.get()).marked_concept_ids, [w1.a.id]);
  assert.deepEqual((await w2.get(2)).marked_concept_ids, [w2.b.id]);
  assert.equal(s.db.marks.length, 2);
  // 직접 삽입된 다른 사용자의 표시가 응답에 섞이지 않는다(조회는 user_id 로 거름)
  s.db.marks.push({ user_id: 2, concept_id: w1.c.id, marked_at: new Date() });
  assert.deepEqual((await w1.get()).marked_concept_ids, [w1.a.id]);
});

test('권한·인증: 비인증 401, 권한(perm_concept_map) 없음 403 — 표시는 바뀌지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const url = `/api/cmap/concepts/${w.a.id}/mark`;
  assert.equal((await s.t.call('PUT', url, { marked: true }, { user: null })).status, 401);
  assert.equal((await s.call('PUT', url, { marked: true }, 3)).status, 403);
  assert.equal(s.db.marks.length, 0);
});

test('개념을 지우면 그 개념의 표시도 함께 지워진다(다른 개념의 표시는 그대로)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(w.a.id, true); await w.mark(w.b.id, true);
  const del = await s.call('DELETE', `/api/cmap/concepts/${w.a.id}`);
  assert.ok([200, 409].includes(del.status), JSON.stringify(del.body));
  if (del.status === 409) assert.equal((await s.call('DELETE', `/api/cmap/concepts/${w.a.id}?confirm=1`)).status, 200);
  assert.deepEqual(s.db.marks.map(m => m.concept_id), [w.b.id]);
  assert.deepEqual((await w.get()).marked_concept_ids, [w.b.id]);
});

test('최상위 주제를 지우면 그 안 개념의 표시도 지워진다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(w.a.id, true);
  assert.equal((await s.call('DELETE', `/api/cmap/topics/${w.sci.id}?confirm=1`)).status, 200);
  assert.equal(s.db.marks.length, 0);
});

test('지도 조회 응답: 한 줄 설명(brief) = 정의 → 없으면 첫 항목 → 없으면 null, 140자 초과는 줄임표, 설명 전체는 보내지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const g = await w.get();
  const by = Object.fromEntries(g.concepts.map(c => [c.term, c]));
  assert.equal(by['힘'].brief, '물체의 운동 상태를 바꾸는 원인입니다.');
  assert.equal(by['질량'].brief, null, '설명이 없으면 null');
  assert.equal(by['마찰'].brief, '옛 정의', '옛 4항목 형태도 정의를 읽는다');
  assert.equal(by['긴설명'].brief, '가'.repeat(140) + '…');
  assert.ok(g.concepts.every(c => !('explanation' in c)), '설명 전체는 응답에 없음');
  // 정의가 없고 다른 항목만 있는 옛 데이터: 읽을 수 있는 첫 항목
  s.db.concepts.find(c => c.id === w.b.id).explanation = { example: '정의 없는 예' };
  assert.equal((await w.get()).concepts.find(c => c.id === w.b.id).brief, '정의 없는 예');
});

test('표시는 지도와 무관한 개념 단위: 지도에 없는 개념도 표시·조회되고 지도 의미 해시·저장 상태는 바뀌지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const g0 = await w.get();
  await w.mark(w.d.id, true);
  const g1 = await w.get();
  assert.deepEqual(g1.marked_concept_ids, [w.d.id]);
  assert.equal(g1.current_hash, g0.current_hash); assert.equal(g1.save_status, g0.save_status);
});
