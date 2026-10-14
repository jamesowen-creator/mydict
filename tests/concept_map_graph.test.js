// 작업273-2: 개념 지도 3단계 서버 규칙 — 지도 조회(없으면 생성)·노드 선택·위치 저장·간선(양 끝 노드·중복/역방향·구별 대칭·문구 필수·종류 5종)·
// 노드 빼기(간선 확인)·개념 삭제 시 정리와 hash 초기화·가지 이동 제한·최상위 삭제의 지도 수. 가짜 DB(tests/helpers/cmap_db.js)는 실제 PG 제약을 흉내 낸 것이다(한계).
// 서버는 t.after 로 종료한다. 실행: node --test tests/concept_map_graph.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCmapDb } = require('./helpers/cmap_db');
const { startApp } = require('./helpers/app');
const M = require('../lib/cmap_map');
// 275-1: 개념학습 모듈을 불러오지 않는다. 관계 5종은 개념 지도 기준 고정값(값·순서)
const PREDICATES = ['사용', '일부', '종류', '일으킴', '구별'];

async function setup() {
  const db = createCmapDb();
  db.addUser(1, { perm_concept_map: true });
  db.addUser(2, { perm_concept_map: true });
  db.addUser(3, { perm_concept_map: false });
  const t = await startApp(['routes/concept_map.js'], { db });
  const call = (method, url, body, user = 1) => t.call(method, url, body, { user });
  const topic = async (title, parent_id, user = 1) => (await call('POST', '/api/cmap/topics', parent_id === undefined ? { title } : { title, parent_id }, user)).body.topic;
  const concept = async (topicId, term, user = 1) => (await call('POST', `/api/cmap/topics/${topicId}/concepts`, { term }, user)).body.concept;
  // 최상위 과학 > 물리, 개념 a b c (과학) d (물리), 다른 트리 e
  const world = async () => {
    const sci = await topic('과학'); const phys = await topic('물리', sci.id); const other = await topic('수학');
    const a = await concept(sci.id, 'a'), b = await concept(sci.id, 'b'), c = await concept(sci.id, 'c'), d = await concept(phys.id, 'd'), e = await concept(other.id, 'e');
    const g = (await call('GET', `/api/cmap/topics/${sci.id}/map`)).body;
    return { sci, phys, other, a, b, c, d, e, map: g.map, g };
  };
  const addNode = (mapId, cid, user = 1) => call('POST', `/api/cmap/maps/${mapId}/nodes`, { concept_id: cid }, user);
  const addEdge = (mapId, from, to, extra = {}, user = 1) => call('POST', `/api/cmap/maps/${mapId}/edges`, { from_concept_id: from, to_concept_id: to, label: '때문에', ...extra }, user);
  return { db, t, call, topic, concept, world, addNode, addEdge };
}
const fail = (r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.ok, false); };

test('관계 종류 5종은 개념 지도 상수와 고정값이 같다(값·순서)', () => {
  assert.deepEqual(M.RELATION_TYPES, PREDICATES);
  assert.deepEqual(M.RELATION_TYPES, ['사용', '일부', '종류', '일으킴', '구별']);
});

test('권한·소유: 비인증 401, 권한 없음 403, 타인 지도·노드·간선은 404 이고 데이터는 그대로', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await s.addNode(w.map.id, w.a.id); await s.addNode(w.map.id, w.b.id);
  const edge = (await s.addEdge(w.map.id, w.a.id, w.b.id)).body.edge;
  const calls = [['GET', `/api/cmap/topics/${w.sci.id}/map`], ['POST', `/api/cmap/maps/${w.map.id}/nodes`, { concept_id: w.c.id }], ['DELETE', `/api/cmap/maps/${w.map.id}/nodes/${w.a.id}?confirm=1`],
    ['PATCH', `/api/cmap/maps/${w.map.id}/nodes/${w.a.id}`, { x: 1, y: 1 }], ['POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.a.id, to_concept_id: w.c.id, label: 'x' }],
    ['PATCH', `/api/cmap/edges/${edge.id}`, { label: '탈취' }], ['DELETE', `/api/cmap/edges/${edge.id}`]];
  for (const [m, u, b] of calls) {
    assert.equal((await s.t.call(m, u, b, { user: null })).status, 401, '비인증 ' + m + ' ' + u);
    assert.equal((await s.call(m, u, b, 3)).status, 403, '권한 없음 ' + m + ' ' + u);
  }
  const before = s.db.snapshot();
  for (const [m, u, b] of calls) { const r = await s.call(m, u, b, 2); assert.equal(r.status, 404, `타인 ${m} ${u}: ${JSON.stringify(r.body)}`); assert.equal(r.body.ok, false); }
  assert.equal(s.db.snapshot(), before, '타인 요청은 데이터를 바꾸지 않음');
});

test('지도 조회: 최상위 주제만, 없으면 한 번 만들고 다시 조회해도 같은 지도, 트리 안의 개념·주제를 돌려준다(다른 트리 개념은 제외)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  assert.equal(w.map.root_topic_id, w.sci.id); assert.equal(w.map.title, '과학'); assert.equal(w.map.semantic_hash, null);
  assert.deepEqual(w.g.nodes, []); assert.deepEqual(w.g.edges, []);
  assert.deepEqual(w.g.concepts.map(c => c.term).sort(), ['a', 'b', 'c', 'd'], '다른 트리(수학)의 e 는 없음');
  assert.deepEqual(w.g.topics.map(x => x.title).sort(), ['과학', '물리']);
  assert.deepEqual(w.g.relation_types, PREDICATES);
  const again = (await s.call('GET', `/api/cmap/topics/${w.sci.id}/map`)).body;
  assert.equal(again.map.id, w.map.id); assert.equal(s.db.maps.length, 1, '같은 지도');
  fail(await s.call('GET', `/api/cmap/topics/${w.phys.id}/map`), 400);   // 하위 주제
  assert.equal((await s.call('GET', '/api/cmap/topics/99999/map')).status, 404);
  assert.equal((await s.call('GET', `/api/cmap/topics/${w.sci.id}/map`, undefined, 2)).status, 404, '타인 주제');
});

test('노드: 트리 안의 개념만(하위 주제 포함), 트리 밖·없는 개념은 거부, 두 번 선택해도 한 번(existing)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  let r = await s.addNode(w.map.id, w.a.id);
  assert.equal(r.status, 201); assert.deepEqual(r.body.node, { concept_id: w.a.id, x: null, y: null }); assert.equal(r.body.existing, false);
  assert.equal((await s.addNode(w.map.id, w.d.id)).status, 201, '하위 주제의 개념도 같은 트리');
  r = await s.addNode(w.map.id, w.a.id);
  assert.equal(r.status, 200); assert.equal(r.body.existing, true); assert.equal(s.db.nodes.length, 2);
  fail(await s.addNode(w.map.id, w.e.id), 400);          // 다른 최상위 주제의 개념
  fail(await s.addNode(w.map.id, 99999), 400);
  const other = await s.concept((await s.topic('내 다른 트리2')).id, 'z');
  fail(await s.addNode(w.map.id, other.id), 400);
  for (const body of [{}, { concept_id: 'x' }, { concept_id: 1.5 }, { concept_id: '1' }, { concept_id: 0 }]) fail(await s.call('POST', `/api/cmap/maps/${w.map.id}/nodes`, body), 400);
  assert.equal((await s.call('POST', '/api/cmap/maps/99999/nodes', { concept_id: w.a.id })).status, 404);
  // 타인의 개념은 내 지도에 못 넣는다
  const theirs = await s.concept((await s.topic('남의 주제', undefined, 2)).id, 'zz', 2);
  fail(await s.addNode(w.map.id, theirs.id), 400);
});

test('노드 위치 저장: 유한한 숫자 범위(±10000)만, 지도에 없는 노드는 404, 미배치(null)에서 첫 저장', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await s.addNode(w.map.id, w.a.id);
  const url = `/api/cmap/maps/${w.map.id}/nodes/${w.a.id}`;
  let r = await s.call('PATCH', url, { x: 120.5, y: -33 });
  assert.equal(r.status, 200); assert.deepEqual(r.body.node, { concept_id: w.a.id, x: 120.5, y: -33 });
  assert.equal((await s.call('PATCH', url, { x: 10000, y: -10000 })).status, 200, '경계값 허용');
  for (const b of [{}, { x: 1 }, { y: 1 }, { x: '1', y: 2 }, { x: null, y: 1 }, { x: 10001, y: 0 }, { x: 0, y: -10001 }, { x: Infinity, y: 0 }, { x: NaN, y: 0 }, { x: 1e308, y: 0 }]) fail(await s.call('PATCH', url, b), 400);
  assert.equal((await s.call('PATCH', `/api/cmap/maps/${w.map.id}/nodes/${w.b.id}`, { x: 1, y: 1 })).status, 404, '지도에 없는 개념');
  assert.equal((await s.call('GET', `/api/cmap/topics/${w.sci.id}/map`)).body.nodes[0].x, 10000);
});

test('간선 생성: 양 끝이 지도 노드여야 하고, 문구 필수(≤40)·종류 선택(5종)·자기 자신 불가, 같은 쌍은 방향과 상관없이 한 번만(409)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await s.addNode(w.map.id, w.a.id); await s.addNode(w.map.id, w.b.id); await s.addNode(w.map.id, w.d.id);
  let r = await s.addEdge(w.map.id, w.a.id, w.b.id);
  assert.equal(r.status, 201); assert.equal(r.body.edge.from_concept_id, w.a.id); assert.equal(r.body.edge.to_concept_id, w.b.id); assert.equal(r.body.edge.relation_type, null); assert.equal(r.body.edge.label, '때문에');
  fail(await s.addEdge(w.map.id, w.a.id, w.b.id), 409);                    // 같은 방향
  fail(await s.addEdge(w.map.id, w.b.id, w.a.id), 409);                    // 반대 방향도 같은 쌍
  fail(await s.addEdge(w.map.id, w.b.id, w.a.id, { relation_type: '구별' }), 409);
  fail(await s.addEdge(w.map.id, w.a.id, w.c.id), 400);                    // c 는 노드가 아님
  fail(await s.addEdge(w.map.id, w.a.id, w.e.id), 400);                    // 다른 트리
  fail(await s.addEdge(w.map.id, w.a.id, w.a.id), 400);                    // 자기 자신
  for (const label of [undefined, '', '   ', 5, null, '가'.repeat(41), '두\n줄']) fail(await s.call('POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.a.id, to_concept_id: w.d.id, label }), 400);
  for (const relation_type of ['없는종류', 5, '', '포함', '원인→결과']) fail(await s.addEdge(w.map.id, w.a.id, w.d.id, { relation_type }), 400);   // 옛 6종의 코드도 5종 밖
  for (const body of [{ from_concept_id: 'a', to_concept_id: w.d.id, label: 'x' }, { to_concept_id: w.d.id, label: 'x' }, { from_concept_id: w.a.id, label: 'x' }]) fail(await s.call('POST', `/api/cmap/maps/${w.map.id}/edges`, body), 400);
  assert.equal((await s.addEdge(w.map.id, w.a.id, w.d.id, { label: '가'.repeat(40), relation_type: '일부' })).status, 201, '40자·일부 허용');
  assert.equal(s.db.edges.length, 2);
  // 5종 모두 저장 가능
  const x = await s.concept(w.sci.id, 'x1'); const y = await s.concept(w.sci.id, 'y1');
  await s.addNode(w.map.id, x.id); await s.addNode(w.map.id, y.id);
  for (let i = 0; i < PREDICATES.length; i++) {
    const p = await s.concept(w.sci.id, 'p' + i); await s.addNode(w.map.id, p.id);
    const e = await s.addEdge(w.map.id, x.id, p.id, { relation_type: PREDICATES[i] });
    assert.equal(e.status, 201, PREDICATES[i]); assert.equal(e.body.edge.relation_type, PREDICATES[i]);
  }
});

test("구별(대칭): id 가 작은 쪽이 from 으로 저장되고(입력 방향과 무관), 방향 바꾸기는 거부", async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await s.addNode(w.map.id, w.a.id); await s.addNode(w.map.id, w.b.id); await s.addNode(w.map.id, w.c.id);
  const small = Math.min(w.a.id, w.b.id), big = Math.max(w.a.id, w.b.id);
  const e = (await s.addEdge(w.map.id, big, small, { relation_type: '구별' })).body.edge;
  assert.equal(e.from_concept_id, small); assert.equal(e.to_concept_id, big, '입력 방향(큰 id → 작은 id)과 상관없이 작은 쪽이 from');
  fail(await s.call('PATCH', `/api/cmap/edges/${e.id}`, { reverse: true }), 400);
  // 다른 종류의 간선을 구별로 바꾸면 방향이 정규화되고, 구별에서 다른 종류로 바꾸면 방향 바꾸기가 가능
  const f = (await s.addEdge(w.map.id, w.c.id, w.a.id, { relation_type: '사용' })).body.edge;     // c → a (c 가 가장 큰 id)
  assert.equal(f.from_concept_id, w.c.id);
  let r = await s.call('PATCH', `/api/cmap/edges/${f.id}`, { relation_type: '구별' });
  assert.equal(r.status, 200); assert.equal(r.body.edge.from_concept_id, w.a.id); assert.equal(r.body.edge.to_concept_id, w.c.id);
  r = await s.call('PATCH', `/api/cmap/edges/${f.id}`, { relation_type: '사용', reverse: true });
  assert.equal(r.status, 200); assert.equal(r.body.edge.from_concept_id, w.c.id, '종류를 바꾸면서 방향 바꾸기');
});

test('간선 수정·삭제: 문구·종류·방향 바꾸기(reverse), 종류 지우기(null), 변경 없음·잘못된 값 400, 삭제는 간선만', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await s.addNode(w.map.id, w.a.id); await s.addNode(w.map.id, w.b.id);
  const e = (await s.addEdge(w.map.id, w.a.id, w.b.id, { relation_type: '일으킴', label: '마찰이 열을 일으킴' })).body.edge;
  let r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { label: '  새 문구  ' });
  assert.equal(r.body.edge.label, '새 문구'); assert.equal(r.body.edge.relation_type, '일으킴'); assert.equal(r.body.edge.from_concept_id, w.a.id);
  r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { reverse: true });
  assert.equal(r.body.edge.from_concept_id, w.b.id); assert.equal(r.body.edge.to_concept_id, w.a.id); assert.equal(r.body.edge.label, '새 문구');
  r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { relation_type: null });
  assert.equal(r.body.edge.relation_type, null);
  r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { relation_type: '종류', reverse: true, label: '종류다' });
  assert.deepEqual([r.body.edge.from_concept_id, r.body.edge.to_concept_id, r.body.edge.relation_type, r.body.edge.label], [w.a.id, w.b.id, '종류', '종류다']);
  const before = s.db.snapshot();
  for (const b of [{}, { label: '' }, { label: '가'.repeat(41) }, { relation_type: '없는' }, { reverse: 'yes' }, { label: 5 }]) fail(await s.call('PATCH', `/api/cmap/edges/${e.id}`, b), 400);
  assert.equal(s.db.snapshot(), before);
  assert.equal((await s.call('PATCH', '/api/cmap/edges/99999', { label: 'x' })).status, 404);
  assert.equal((await s.call('PATCH', '/api/cmap/edges/abc', { label: 'x' })).status, 404);
  assert.equal((await s.call('DELETE', `/api/cmap/edges/${e.id}`)).status, 200);
  assert.equal((await s.call('DELETE', `/api/cmap/edges/${e.id}`)).status, 404);
  assert.equal(s.db.nodes.length, 2, '간선만 삭제되고 노드는 그대로');
});

test('노드 빼기: 간선이 있으면 confirm=1 필요(409 + 간선 수), 확인하면 그 간선도 함께 삭제, 간선 없는 노드는 바로', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  for (const c of [w.a, w.b, w.c]) await s.addNode(w.map.id, c.id);
  await s.addEdge(w.map.id, w.a.id, w.b.id); await s.addEdge(w.map.id, w.c.id, w.a.id, { label: '또' }); await s.addEdge(w.map.id, w.b.id, w.c.id, { label: '또2' });
  const before = s.db.snapshot();
  const r = await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${w.a.id}`);
  assert.equal(r.status, 409); assert.equal(r.body.needs_confirm, true); assert.deepEqual(r.body.counts, { edges: 2 });
  assert.equal(s.db.snapshot(), before, '확인 없이는 아무것도 지워지지 않음');
  for (const q of ['?confirm=0', '?confirm=true', '?confirm=']) assert.equal((await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${w.a.id}${q}`)).status, 409, q);
  const ok = await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${w.a.id}?confirm=1`);
  assert.equal(ok.status, 200); assert.equal(ok.body.removed_edges, 2);
  assert.deepEqual(s.db.nodes.map(n => n.concept_id).sort(), [w.b.id, w.c.id].sort());
  assert.equal(s.db.edges.length, 1, 'a 와 이어진 간선 2개만 삭제'); assert.equal(s.db.edges[0].label, '또2');
  // 간선이 없는 노드는 확인 없이
  const d = await s.concept(w.sci.id, 'dd'); await s.addNode(w.map.id, d.id);
  assert.equal((await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${d.id}`)).status, 200);
  assert.equal((await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${d.id}`)).status, 404, '이미 뺀 노드');
});

test('개념 삭제: 지도에서 쓰이면 노드·연결된 간선이 함께 사라지고 그 지도의 semantic_hash 가 NULL 로 돌아간다(다른 지도는 그대로)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  for (const c of [w.a, w.b, w.c]) await s.addNode(w.map.id, c.id);
  await s.addEdge(w.map.id, w.a.id, w.b.id); await s.addEdge(w.map.id, w.b.id, w.c.id, { label: '또' });
  s.db.maps[0].semantic_hash = 'hash-saved'; s.db.maps[0].saved_at = new Date();       // 273-3 이 저장할 값(여기서는 직접 넣음)
  const map2 = (await s.call('GET', `/api/cmap/topics/${w.other.id}/map`)).body.map;
  s.db.maps.find(m => m.id === map2.id).semantic_hash = 'hash-other';
  const r = await s.call('DELETE', `/api/cmap/concepts/${w.b.id}`);
  assert.equal(r.status, 200); assert.equal(r.body.removed_from_maps, 1); assert.equal(r.body.removed_edges, 2);
  assert.deepEqual(s.db.nodes.map(n => n.concept_id).sort(), [w.a.id, w.c.id].sort());
  assert.equal(s.db.edges.length, 0, 'b 와 이어진 간선 2개 모두 삭제');
  assert.equal(s.db.maps.find(m => m.id === w.map.id).semantic_hash, null, '해시 초기화');
  assert.equal(s.db.maps.find(m => m.id === map2.id).semantic_hash, 'hash-other', '다른 지도는 그대로');
  assert.equal(s.db.concepts.some(c => c.id === w.b.id), false);
  // 지도에서 쓰이지 않는 개념 삭제는 해시를 건드리지 않는다
  s.db.maps.find(m => m.id === w.map.id).semantic_hash = 'again';
  assert.equal((await s.call('DELETE', `/api/cmap/concepts/${w.d.id}`)).status, 200);
  assert.equal(s.db.maps.find(m => m.id === w.map.id).semantic_hash, 'again');
  assert.equal((await s.call('DELETE', `/api/cmap/concepts/${w.b.id}`)).status, 404);
});

test('가지 이동 제한: 지도에 쓰이는 개념이 든 가지는 다른 최상위 주제로 옮길 수 없다(409 + 안내), 같은 트리 안 이동·지도에 안 쓰는 가지는 가능', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const deep = await s.topic('역학', w.phys.id); const dc = await s.concept(deep.id, 'dc');
  await s.addNode(w.map.id, w.d.id); await s.addNode(w.map.id, dc.id);
  // 같은 트리 안에서는 이동 가능(루트 불변)
  assert.equal((await s.call('POST', `/api/cmap/topics/${deep.id}/move`, { parent_id: w.sci.id })).status, 200);
  assert.equal((await s.call('POST', `/api/cmap/topics/${deep.id}/move`, { parent_id: w.phys.id })).status, 200);
  const before = s.db.snapshot();
  // 지도에 쓰이는 가지를 다른 최상위(수학) 아래로 → 409
  let r = await s.call('POST', `/api/cmap/topics/${w.phys.id}/move`, { parent_id: w.other.id });
  assert.equal(r.status, 409); assert.equal(r.body.ok, false); assert.equal(r.body.in_maps, 2); assert.match(r.body.error, /지도에서 먼저 빼/);
  // 최상위로 독립시키는 것도 루트가 바뀌므로 거부
  r = await s.call('POST', `/api/cmap/topics/${deep.id}/move`, { parent_id: null });
  assert.equal(r.status, 409);
  // 지도의 뿌리(과학) 자체를 다른 주제 아래로
  r = await s.call('POST', `/api/cmap/topics/${w.sci.id}/move`, { parent_id: w.other.id });
  assert.equal(r.status, 409);
  assert.equal(s.db.snapshot(), before, '거부된 이동은 아무것도 바꾸지 않음');
  // 지도에서 빼면 옮길 수 있다
  await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${w.d.id}`); await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${dc.id}`);
  assert.equal((await s.call('POST', `/api/cmap/topics/${w.phys.id}/move`, { parent_id: w.other.id })).status, 200);
  // 빈 지도가 있는 최상위 주제를 다른 주제 아래로 옮기면 그 (빈) 지도는 지워진다
  const emptyMap = (await s.call('GET', `/api/cmap/topics/${w.other.id}/map`)).body.map;
  assert.ok(s.db.maps.some(m => m.id === emptyMap.id));
  assert.equal((await s.call('POST', `/api/cmap/topics/${w.other.id}/move`, { parent_id: w.sci.id })).status, 200);
  assert.equal(s.db.maps.some(m => m.id === emptyMap.id), false, '뿌리가 더 이상 최상위가 아니므로 빈 지도 삭제');
});

test('최상위 주제 삭제: 확인창 개수에 지도 수가 들어가고, 삭제하면 지도(노드·간선 포함)도 함께 사라진다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  for (const c of [w.a, w.b]) await s.addNode(w.map.id, c.id);
  await s.addEdge(w.map.id, w.a.id, w.b.id);
  let r = await s.call('DELETE', `/api/cmap/topics/${w.sci.id}`);
  assert.equal(r.status, 409); assert.deepEqual(r.body.counts, { topics: 1, concepts: 4, maps: 1 });
  assert.equal(s.db.maps.length, 1);
  r = await s.call('DELETE', `/api/cmap/topics/${w.sci.id}?confirm=1`);
  assert.equal(r.status, 200); assert.deepEqual(r.body.deleted_counts, { topics: 1, concepts: 4, maps: 1 });
  assert.equal(s.db.maps.length, 0); assert.equal(s.db.nodes.length, 0); assert.equal(s.db.edges.length, 0);
  assert.equal(s.db.topics.some(x => x.title === '수학'), true, '다른 트리는 그대로');
});

test('트랜잭션: 노드 빼기·개념 삭제 도중 오류가 나면 전부 되돌려진다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  for (const c of [w.a, w.b]) await s.addNode(w.map.id, c.id);
  await s.addEdge(w.map.id, w.a.id, w.b.id);
  const before = s.db.snapshot();
  s.db.failOn = /^DELETE FROM cmap_map_nodes/;
  assert.equal((await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${w.a.id}?confirm=1`)).status, 500);
  assert.equal(s.db.snapshot(), before, '간선도 지워지지 않고 원상 복구');
  assert.equal((await s.call('DELETE', `/api/cmap/concepts/${w.a.id}`)).status, 500);
  assert.equal(s.db.snapshot(), before);
  s.db.failOn = null;
});
