// 작업273-3: 개념 지도 의미 해시·저장 상태·위치 일괄 저장 서버 규칙. 가짜 DB(tests/helpers/cmap_db.js)는 실제 PG 제약을 흉내 낸 것이다(한계).
// 서버는 t.after 로 종료한다. 실행: node --test tests/concept_map_save.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCmapDb, legacyEdgeCall } = require('./helpers/cmap_db');
const { startApp } = require('./helpers/app');
const H = require('../lib/cmap_hash');

async function setup() {
  const db = createCmapDb();
  db.addUser(1, { perm_concept_map: true });
  db.addUser(2, { perm_concept_map: true });
  db.addUser(3, { perm_concept_map: false });
  const t = await startApp(['routes/concept_map.js'], { db });
  const call = legacyEdgeCall(db, (method, url, body, user = 1) => t.call(method, url, body, { user }));   // 307-1: 옛 유형 연결은 "이미 저장된" 상태로 직접 넣는다
  const world = async () => {
    const sci = (await call('POST', '/api/cmap/topics', { title: '과학' })).body.topic;
    const ids = {};
    for (const n of ['a', 'b', 'c']) ids[n] = (await call('POST', `/api/cmap/topics/${sci.id}/concepts`, { term: n })).body.concept.id;
    const other = (await call('POST', '/api/cmap/topics', { title: '수학' }, 2)).body.topic;
    ids.x = (await call('POST', `/api/cmap/topics/${other.id}/concepts`, { term: 'x' }, 2)).body.concept.id;
    const map = (await call('GET', `/api/cmap/topics/${sci.id}/map`)).body.map;
    for (const n of ['a', 'b', 'c']) await call('POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: ids[n] });
    const e1 = (await call('POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids.a, to_concept_id: ids.b, label: '때문에', relation_type: '일으킴' })).body.edge;
    const get = async () => (await call('GET', `/api/cmap/topics/${sci.id}/map`)).body;
    return { sci, ids, map, e1, get };
  };
  const pos = (w, over = {}) => ['a', 'b', 'c'].map((n, i) => ({ concept_id: w.ids[n], x: 10 + i * 100, y: 20 + i * 50, ...over[n] }));
  return { db, t, call, world, pos };
}
const fail = (r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.ok, false); };

test('해시: 입력 순서가 달라도 같고, 좌표는 포함하지 않으며, 노드·간선의 모든 의미 요소가 바뀌면 달라진다', () => {
  const edges = [{ from_concept_id: 1, to_concept_id: 2, relation_type: '일으킴', label: '가' }, { from_concept_id: 2, to_concept_id: 3, relation_type: null, label: '나' }];
  const base = H.computeSemanticHash([1, 2, 3], edges);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(H.computeSemanticHash([3, 1, 2], [edges[1], edges[0]]), base, '순서 무관');
  assert.equal(H.computeSemanticHash([1, 2, 3], edges.map(e => ({ ...e, x: 99, y: 7 }))), base, '여분 필드(좌표)는 무시');
  const variants = {
    '노드 추가': H.computeSemanticHash([1, 2, 3, 4], edges),
    '노드 제거': H.computeSemanticHash([1, 2], edges.slice(0, 1)),
    '간선 제거': H.computeSemanticHash([1, 2, 3], edges.slice(0, 1)),
    '문구': H.computeSemanticHash([1, 2, 3], [{ ...edges[0], label: '다' }, edges[1]]),
    '종류': H.computeSemanticHash([1, 2, 3], [{ ...edges[0], relation_type: '사용' }, edges[1]]),
    '종류 없음→있음': H.computeSemanticHash([1, 2, 3], [edges[0], { ...edges[1], relation_type: '사용' }]),
    '방향': H.computeSemanticHash([1, 2, 3], [{ ...edges[0], from_concept_id: 2, to_concept_id: 1 }, edges[1]]),
  };
  for (const [k, v] of Object.entries(variants)) assert.notEqual(v, base, k);
  assert.equal(new Set(Object.values(variants)).size, Object.keys(variants).length, '서로 다른 변경은 서로 다른 해시');
});

test('저장 상태: 처음 unsaved → [저장] saved → 의미 변경 changed → 다시 저장 saved, 위치만 바꾸면 saved 유지', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const g0 = await w.get();
  assert.equal(g0.save_status, 'unsaved'); assert.equal(g0.map.saved_at, null); assert.match(g0.current_hash, /^[0-9a-f]{64}$/);
  const saved = await s.call('POST', `/api/cmap/maps/${w.map.id}/save`);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.status.save_status, 'saved');
  assert.equal(saved.body.map.semantic_hash, g0.current_hash, '서버가 DB 상태로 계산');
  assert.ok(saved.body.map.saved_at);
  assert.equal((await w.get()).save_status, 'saved');
  // 위치만 바꿈(개별 이동) → 여전히 saved
  const mv = await s.call('PATCH', `/api/cmap/maps/${w.map.id}/nodes/${w.ids.a}`, { x: 500, y: 500 });
  assert.equal(mv.status, 200);
  assert.equal((await w.get()).save_status, 'saved', '위치만 바뀌면 저장 후 변경됨이 아님');
  // 연결 추가 → changed, 응답에도 상태가 들어 있다
  const add = await s.call('POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.ids.b, to_concept_id: w.ids.c, label: '다음' });
  assert.equal(add.body.status.save_status, 'changed');
  assert.equal((await w.get()).save_status, 'changed');
  // 문구 수정, 삭제, 되돌림
  const edgeId = add.body.edge.id;
  assert.equal((await s.call('DELETE', `/api/cmap/edges/${edgeId}`)).body.status.save_status, 'saved', '원래 의미로 돌아가면 saved');
  const p = await s.call('PATCH', `/api/cmap/edges/${w.e1.id}`, { label: '다른 문구' });
  assert.equal(p.body.status.save_status, 'changed');
  assert.equal((await s.call('POST', `/api/cmap/maps/${w.map.id}/save`)).body.status.save_status, 'saved');
  // 노드 빼기(연결 포함) → changed
  const rm = await s.call('DELETE', `/api/cmap/maps/${w.map.id}/nodes/${w.ids.c}`);
  assert.equal(rm.body.status.save_status, 'changed');
});

test('개념 삭제로 지도가 바뀌면 저장 기록이 있어도 changed (저장된 해시가 초기화되어도 saved 로 오인하지 않음)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await s.call('POST', `/api/cmap/maps/${w.map.id}/save`);
  const del = await s.call('DELETE', `/api/cmap/concepts/${w.ids.c}`);
  assert.ok([200, 409].includes(del.status), JSON.stringify(del.body));
  if (del.status === 409) await s.call('DELETE', `/api/cmap/concepts/${w.ids.c}?confirm=1`);
  const g = await w.get();
  assert.equal(g.save_status, 'changed');
  assert.ok(g.map.saved_at);
});

test('저장 API: 타인·권한 없음·비인증·없는 지도 거부, 클라이언트가 보낸 해시는 무시', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const url = `/api/cmap/maps/${w.map.id}/save`;
  assert.equal((await s.t.call('POST', url, {}, { user: null })).status, 401);
  assert.equal((await s.call('POST', url, {}, 3)).status, 403);
  const before = s.db.snapshot();
  assert.equal((await s.call('POST', url, {}, 2)).status, 404);
  assert.equal(s.db.snapshot(), before);
  assert.equal((await s.call('POST', '/api/cmap/maps/99999/save')).status, 404);
  const r = await s.call('POST', url, { semantic_hash: 'f'.repeat(64) });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.map.semantic_hash, 'f'.repeat(64));
  assert.equal(r.body.map.semantic_hash, (await w.get()).current_hash);
});

test('위치 일괄 저장: 위치만 바뀌고 해시·간선 수·종류·방향·문구는 그대로', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const g0 = await w.get();
  const r = await s.call('PUT', `/api/cmap/maps/${w.map.id}/positions`, { positions: s.pos(w), base_hash: g0.current_hash });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status.current_hash, g0.current_hash);
  const g1 = await w.get();
  assert.equal(g1.current_hash, g0.current_hash);
  assert.deepEqual(g1.edges, g0.edges, '간선은 완전히 그대로');
  const byId = new Map(g1.nodes.map(n => [n.concept_id, n]));
  assert.deepEqual([byId.get(w.ids.a).x, byId.get(w.ids.a).y], [10, 20]);
  assert.deepEqual([byId.get(w.ids.c).x, byId.get(w.ids.c).y], [210, 120]);
  assert.deepEqual(r.body.positions.map(p => p.concept_id).sort((a, b) => a - b), [w.ids.a, w.ids.b, w.ids.c].sort((a, b) => a - b));
});

test('위치 일괄 저장: 저장된 지도는 saved 를 유지(위치만 바뀜), base_hash 없이도 동작', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await s.call('POST', `/api/cmap/maps/${w.map.id}/save`);
  const r = await s.call('PUT', `/api/cmap/maps/${w.map.id}/positions`, { positions: s.pos(w) });
  assert.equal(r.status, 200);
  assert.equal(r.body.status.save_status, 'saved');
});

test('위치 일괄 저장: 노드 집합이 다르면 거부(모자람·넘침·없는 개념·타인 개념·중복) 하고 아무것도 바뀌지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const url = `/api/cmap/maps/${w.map.id}/positions`;
  const before = s.db.snapshot();
  const all = s.pos(w);
  fail(await s.call('PUT', url, { positions: all.slice(0, 2) }), 400);                                  // 빠짐
  fail(await s.call('PUT', url, { positions: [...all, { concept_id: w.ids.x, x: 1, y: 1 }] }), 400);    // 타인 개념 추가
  fail(await s.call('PUT', url, { positions: [...all.slice(0, 2), { concept_id: 99999, x: 1, y: 1 }] }), 400);   // 없는 개념
  fail(await s.call('PUT', url, { positions: [...all, { concept_id: 99999, x: 1, y: 1 }] }), 400);
  fail(await s.call('PUT', url, { positions: [all[0], all[0], all[1]] }), 400);                          // 중복
  fail(await s.call('PUT', url, { positions: [] }), 400);
  assert.equal(s.db.snapshot(), before);
});

test('위치 일괄 저장: 지도에 없는 같은 트리 개념도 거부(노드가 아님)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const d = (await s.call('POST', `/api/cmap/topics/${w.sci.id}/concepts`, { term: 'd' })).body.concept;
  const before = s.db.snapshot();
  fail(await s.call('PUT', `/api/cmap/maps/${w.map.id}/positions`, { positions: [...s.pos(w), { concept_id: d.id, x: 1, y: 1 }] }), 400);
  assert.equal(s.db.snapshot(), before);
});

test('위치 일괄 저장: 잘못된 좌표·형식 거부', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const url = `/api/cmap/maps/${w.map.id}/positions`;
  const before = s.db.snapshot();
  for (const bad of [{ x: 'a' }, { x: NaN }, { x: 1e9 }, { y: -1e9 }, { y: null }, { x: undefined }]) fail(await s.call('PUT', url, { positions: s.pos(w, { b: bad }) }), 400);
  fail(await s.call('PUT', url, { positions: s.pos(w).map(p => ({ ...p, concept_id: String(p.concept_id) })) }), 400);
  fail(await s.call('PUT', url, { positions: 'x' }), 400);
  fail(await s.call('PUT', url, {}), 400);
  fail(await s.call('PUT', url, { positions: Array.from({ length: 501 }, (_, i) => ({ concept_id: i + 1, x: 1, y: 1 })) }), 400);
  fail(await s.call('PUT', url, { positions: s.pos(w), base_hash: 5 }), 400);
  assert.equal(s.db.snapshot(), before);
});

test('위치 일괄 저장: base_hash 가 현재와 다르면(그 사이 지도가 바뀜) 409 stale 이고 위치는 그대로', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const old = (await w.get()).current_hash;
  await s.call('POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.ids.b, to_concept_id: w.ids.c, label: '그 사이에' });
  const before = s.db.snapshot();
  const r = await s.call('PUT', `/api/cmap/maps/${w.map.id}/positions`, { positions: s.pos(w), base_hash: old });
  fail(r, 409); assert.equal(r.body.stale, true);
  assert.equal(s.db.snapshot(), before);
});

test('위치 일괄 저장: 처리 중 의미 해시가 달라지면 409 semantic_changed 로 전체 취소(롤백)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const orig = s.db.client.query;
  t.after(() => { s.db.client.query = orig; });
  const before = s.db.snapshot();
  s.db.client.query = async function (sql, params) {                    // 위치 UPDATE 도중 간선 문구가 바뀌는 사고를 흉내 낸다
    const out = await orig.call(this, sql, params);
    if (/^\s*UPDATE cmap_map_nodes SET x/i.test(sql)) s.db.edges[0].label = '몰래 바뀜';
    return out;
  };
  const r = await s.call('PUT', `/api/cmap/maps/${w.map.id}/positions`, { positions: s.pos(w) });
  fail(r, 409); assert.equal(r.body.semantic_changed, true);
  s.db.client.query = orig;
  assert.equal(s.db.snapshot(), before, '노드 위치도 간선 문구도 원래대로');
});

test('위치 일괄 저장: 도중 DB 오류가 나면 일부만 저장되지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const orig = s.db.client.query;
  let n = 0;
  s.db.client.query = async function (sql, params) {
    if (/^\s*UPDATE cmap_map_nodes SET x/i.test(sql) && ++n === 2) throw new Error('boom');
    return orig.call(this, sql, params);
  };
  t.after(() => { s.db.client.query = orig; });
  const before = s.db.snapshot();
  const r = await s.call('PUT', `/api/cmap/maps/${w.map.id}/positions`, { positions: s.pos(w) });
  assert.ok(r.status >= 400, String(r.status));
  s.db.client.query = orig;
  assert.equal(s.db.snapshot(), before);
});

test('위치 일괄 저장: 권한·소유 검사', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const url = `/api/cmap/maps/${w.map.id}/positions`;
  assert.equal((await s.t.call('PUT', url, { positions: s.pos(w) }, { user: null })).status, 401);
  assert.equal((await s.call('PUT', url, { positions: s.pos(w) }, 3)).status, 403);
  const before = s.db.snapshot();
  assert.equal((await s.call('PUT', url, { positions: s.pos(w) }, 2)).status, 404);
  assert.equal((await s.call('PUT', '/api/cmap/maps/abc/positions', { positions: [] })).status, 404);
  assert.equal(s.db.snapshot(), before);
});
