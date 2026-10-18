// 작업273-5: 개념 지도 연결 퀴즈 — 채점(순수: 쌍 맞힘·종류·방향 따로, '구별'은 방향 무시, 지도에 없는 연결은 감점 없음)과 서버 규칙(저장된 지도에서만 시작, 시작 응답에 정답 간선 없음,
// 시작 뒤 지도가 바뀌면 채점 거부, 시도 기록, 권한·소유). AI 없음. 가짜 DB 는 실제 PG 제약을 흉내 낸 것이다(한계). 서버는 t.after 로 종료한다.
// 실행: node --test tests/concept_map_quiz.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCmapDb, legacyEdgeCall } = require('./helpers/cmap_db');
const { startApp } = require('./helpers/app');
const Q = require('../lib/cmap_quiz');

const E = (from, to, type, label = '문구') => ({ from_concept_id: from, to_concept_id: to, relation_type: type, label });
const A = (from, to, type = null) => ({ from_concept_id: from, to_concept_id: to, relation_type: type });

test('채점: 모두 맞히면 세 점수 모두 1', () => {
  const edges = [E(1, 2, '일으킴'), E(2, 3, '사용'), E(3, 4, '구별')];
  const r = Q.grade(edges, [A(1, 2, '일으킴'), A(2, 3, '사용'), A(3, 4, '구별')]);
  assert.deepEqual(r.scores.pair, { hit: 3, total: 3, ratio: 1 });
  assert.deepEqual(r.scores.type, { hit: 3, total: 3, ratio: 1 });
  assert.deepEqual(r.scores.direction, { hit: 2, total: 2, ratio: 1 }, '구별은 방향 분모에서 제외');
  assert.equal(r.correct.length, 3); assert.equal(r.wrong.length, 0); assert.equal(r.missed.length, 0); assert.equal(r.extras.length, 0);
});

test('채점: 세 점수는 따로 — 쌍만 맞고 종류·방향이 틀리면 쌍 1, 종류 0, 방향 0', () => {
  const r = Q.grade([E(1, 2, '일으킴')], [A(2, 1, '사용')]);
  assert.equal(r.scores.pair.ratio, 1); assert.equal(r.scores.type.ratio, 0); assert.equal(r.scores.direction.ratio, 0);
  assert.deepEqual(r.wrong[0].problems, ['type', 'direction']);
  assert.equal(r.wrong[0].expected.label, '문구'); assert.equal(r.wrong[0].answer.from_concept_id, 2);
});

test('채점: 종류만 틀림 / 방향만 틀림', () => {
  let r = Q.grade([E(1, 2, '일으킴')], [A(1, 2, '사용')]);
  assert.equal(r.scores.type.ratio, 0); assert.equal(r.scores.direction.ratio, 1); assert.deepEqual(r.wrong[0].problems, ['type']);
  r = Q.grade([E(1, 2, '일으킴')], [A(2, 1, '일으킴')]);
  assert.equal(r.scores.type.ratio, 1); assert.equal(r.scores.direction.ratio, 0); assert.deepEqual(r.wrong[0].problems, ['direction']);
});

test("'구별'(대칭)은 방향이 반대여도 맞다, 종류는 여전히 본다", () => {
  const edges = [E(1, 2, '구별')];
  let r = Q.grade(edges, [A(2, 1, '구별')]);
  assert.equal(r.scores.pair.ratio, 1); assert.equal(r.scores.type.ratio, 1); assert.equal(r.scores.direction.ratio, null, '방향 분모 0 → 점수 없음(null)');
  assert.equal(r.correct.length, 1); assert.equal(r.wrong.length, 0);
  r = Q.grade(edges, [A(1, 2, '사용')]);
  assert.equal(r.scores.type.ratio, 0); assert.deepEqual(r.wrong[0].problems, ['type']);
});

test('채점: 종류 없는 연결은 종류 분모에서 제외, 사용자가 종류를 골라도 감점 없음, 방향은 본다', () => {
  const r = Q.grade([E(1, 2, null), E(3, 4, '사용')], [A(1, 2, '일부'), A(4, 3, '사용')]);
  assert.deepEqual(r.scores.type, { hit: 1, total: 1, ratio: 1 });
  assert.deepEqual(r.scores.direction, { hit: 1, total: 2, ratio: 0.5 });
  assert.equal(r.correct.length, 1); assert.deepEqual(r.wrong.map(w => w.problems), [['direction']]);
});

test('채점: 못 찾은 연결은 세 점수 모두에서 틀린 것으로 세고 missed 에 정답을 보여 준다', () => {
  const edges = [E(1, 2, '일으킴', '가'), E(2, 3, '사용', '나'), E(3, 4, '구별', '다'), E(4, 5, null, '라')];
  const r = Q.grade(edges, [A(1, 2, '일으킴')]);
  assert.deepEqual(r.scores.pair, { hit: 1, total: 4, ratio: 0.25 });
  assert.deepEqual(r.scores.type, { hit: 1, total: 3, ratio: 1 / 3 });
  assert.deepEqual(r.scores.direction, { hit: 1, total: 3, ratio: 1 / 3 });
  assert.deepEqual(r.missed.map(m => m.label), ['나', '다', '라']);
});

test('채점: 지도에 없는 연결은 extras 로 따로 보여 주고 점수에는 영향이 없다(감점 없음)', () => {
  const edges = [E(1, 2, '사용')];
  const base = Q.grade(edges, [A(1, 2, '사용')]);
  const withExtra = Q.grade(edges, [A(1, 2, '사용'), A(1, 3, '일부'), A(3, 2, null)]);
  assert.deepEqual(withExtra.scores, base.scores);
  assert.deepEqual(withExtra.extras.map(e => [e.from_concept_id, e.to_concept_id, e.relation_type]), [[1, 3, '일부'], [3, 2, null]]);
  assert.equal(withExtra.wrong.length, 0); assert.equal(withExtra.missed.length, 0);
});

test('채점: 답이 하나도 없으면 전부 missed, 연결이 없는 입력은 분모 0 → null', () => {
  const r = Q.grade([E(1, 2, '사용'), E(2, 3, '구별')], []);
  assert.equal(r.scores.pair.ratio, 0); assert.equal(r.missed.length, 2);
  assert.equal(Q.grade([], []).scores.pair.ratio, null);
});

test('답 읽기: 정수 id·지도 노드·자기 연결 금지·같은 쌍 중복 금지(방향 무관)·종류 5종 또는 null·개수 상한', () => {
  const nodes = [1, 2, 3];
  assert.deepEqual(Q.readAnswers([{ from_concept_id: 1, to_concept_id: 2 }], nodes).value, [A(1, 2, null)], '종류 생략 = null');
  assert.ok(Q.readAnswers([A(1, 2, '사용')], nodes).value);
  for (const bad of [[A(1, 1)], [A(1, 9)], [A(1, 2), A(2, 1)], [A(1, 2, '이상한')], [{ from_concept_id: '1', to_concept_id: 2 }], [null], ['x'], [A(1.5, 2)], 'x', {}])
    assert.ok(Q.readAnswers(bad, nodes).error, JSON.stringify(bad));
  assert.ok(Q.readAnswers(Array.from({ length: 201 }, (_, i) => A(1, 2)), nodes).error);
  assert.deepEqual(Q.readAnswers([], nodes).value, []);
});

// ── 서버 ──
async function setup() {
  const db = createCmapDb();
  db.addUser(1, { perm_concept_map: true });
  db.addUser(2, { perm_concept_map: true });
  db.addUser(3, { perm_concept_map: false });
  const t = await startApp(['routes/concept_map.js'], { db });
  const call = legacyEdgeCall(db, (method, url, body, user = 1) => t.call(method, url, body, { user }));   // 307-1: 옛 유형 연결은 "이미 저장된" 상태로 직접 넣는다
  const world = async ({ save = true } = {}) => {
    const sci = (await call('POST', '/api/cmap/topics', { title: '과학' })).body.topic;
    const ids = {};
    for (const [k, term] of [['a', '힘'], ['b', '가속도'], ['c', '질량'], ['d', '에너지'], ['e', '속도']]) ids[k] = (await call('POST', `/api/cmap/topics/${sci.id}/concepts`, { term })).body.concept.id;
    const map = (await call('GET', `/api/cmap/topics/${sci.id}/map`)).body.map;
    for (const k of ['a', 'b', 'c', 'd']) await call('POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: ids[k] });
    const e1 = (await call('POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids.a, to_concept_id: ids.b, label: '만든다', relation_type: '일으킴' })).body.edge;
    const e2 = (await call('POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids.c, to_concept_id: ids.a, label: '클수록', relation_type: '사용' })).body.edge;
    if (save) await call('POST', `/api/cmap/maps/${map.id}/save`);
    return { sci, ids, map, e1, e2, start: (user = 1) => call('POST', `/api/cmap/maps/${map.id}/quiz/start`, undefined, user), submit: (b, user = 1) => call('POST', `/api/cmap/maps/${map.id}/quiz/submit`, b, user) };
  };
  return { db, t, call, world };
}
const fail = (r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.ok, false); };

test('시작: 저장 안 된 지도·저장 뒤 바뀐 지도·연결 없는 지도는 거부', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world({ save: false });
  const r = await w.start(); fail(r, 409); assert.equal(r.body.needs_save, true);
  await s.call('POST', `/api/cmap/maps/${w.map.id}/save`);
  assert.equal((await w.start()).status, 200);
  await s.call('PATCH', `/api/cmap/edges/${w.e1.id}`, { label: '바뀜' });
  fail(await w.start(), 409);
  // 연결이 없는 지도
  const s2 = await setup(); t.after(() => s2.t.close());
  const sci = (await s2.call('POST', '/api/cmap/topics', { title: '수학' })).body.topic;
  const c = (await s2.call('POST', `/api/cmap/topics/${sci.id}/concepts`, { term: '수' })).body.concept;
  const map = (await s2.call('GET', `/api/cmap/topics/${sci.id}/map`)).body.map;
  await s2.call('POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: c.id });
  await s2.call('POST', `/api/cmap/maps/${map.id}/save`);
  fail(await s2.call('POST', `/api/cmap/maps/${map.id}/quiz/start`), 400);
});

test('시작 응답: 노드 목록(id·용어·영문)과 시작 해시만 — 간선·문구·종류·좌표·정답은 들어 있지 않다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const r = await w.start();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['nodes', 'ok', 'source_hash']);
  assert.deepEqual(r.body.nodes.map(n => n.term).sort(), ['가속도', '에너지', '질량', '힘']);
  assert.ok(r.body.nodes.every(n => Object.keys(n).sort().join() === 'english,id,term'));
  assert.ok(!r.body.nodes.some(n => n.id === w.ids.e), '지도에 없는 개념은 제외');
  const text = JSON.stringify(r.body);
  assert.ok(!/만든다|클수록|일으킴|사용|edges|label|relation|from_concept|to_concept/.test(text), '정답 정보 없음');
  assert.equal(r.body.source_hash, (await s.call('GET', `/api/cmap/topics/${w.sci.id}/map`)).body.current_hash);
});

test('제출: 서버가 저장된 지도의 간선으로 채점하고 시도를 기록한다(점수 3종 따로, 틀린 것·놓친 것·지도에 없는 연결 포함)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const { source_hash } = (await w.start()).body;
  const answers = [
    { from_concept_id: w.ids.b, to_concept_id: w.ids.a, relation_type: '일으킴' },   // 쌍 맞음, 방향 반대
    { from_concept_id: w.ids.a, to_concept_id: w.ids.d, relation_type: '일부' },       // 지도에 없는 연결
  ];
  const r = await w.submit({ source_hash, answers });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.scores.pair, { hit: 1, total: 2, ratio: 0.5 });
  assert.deepEqual(r.body.scores.type, { hit: 1, total: 2, ratio: 0.5 });
  assert.deepEqual(r.body.scores.direction, { hit: 0, total: 2, ratio: 0 });
  assert.equal(r.body.wrong.length, 1); assert.deepEqual(r.body.wrong[0].problems, ['direction']);
  assert.equal(r.body.wrong[0].expected.label, '만든다'); assert.equal(r.body.wrong[0].expected.from_term, '힘'); assert.equal(r.body.wrong[0].answer.from_term, '가속도');
  assert.equal(r.body.missed.length, 1); assert.equal(r.body.missed[0].label, '클수록'); assert.equal(r.body.missed[0].from_term, '질량');
  assert.equal(r.body.extras.length, 1); assert.equal(r.body.extras[0].to_term, '에너지');
  assert.equal(s.db.attempts.length, 1);
  const row = s.db.attempts[0];
  assert.deepEqual([row.user_id, row.map_id, row.source_hash, row.pair_score, row.type_score, row.direction_score], [1, w.map.id, source_hash, 0.5, 0.5, 0]);
  assert.equal(r.body.attempt_id, row.id);
});

test('제출: 구별은 방향이 반대여도 맞고, 종류 없이 이은 답은 종류 오답', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world({ save: false });
  const e3 = await s.call('POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.ids.c, to_concept_id: w.ids.d, label: '헷갈림', relation_type: '구별' });
  assert.equal(e3.status, 201);
  await s.call('POST', `/api/cmap/maps/${w.map.id}/save`);
  const { source_hash } = (await w.start()).body;
  const r = await w.submit({ source_hash, answers: [
    { from_concept_id: w.ids.d, to_concept_id: w.ids.c, relation_type: '구별' },
    { from_concept_id: w.ids.a, to_concept_id: w.ids.b },
    { from_concept_id: w.ids.c, to_concept_id: w.ids.a, relation_type: '사용' }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.scores.pair, { hit: 3, total: 3, ratio: 1 });
  assert.deepEqual(r.body.scores.type, { hit: 2, total: 3, ratio: 2 / 3 });
  assert.deepEqual(r.body.scores.direction, { hit: 2, total: 2, ratio: 1 });
  assert.equal(r.body.correct.length, 2); assert.deepEqual(r.body.wrong.map(x => x.problems), [['type']]);
});

test('제출: 시작 뒤 지도가 바뀌면(저장 전·저장 후 모두) 채점하지 않고 409 stale, 시도 기록 없음', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const { source_hash } = (await w.start()).body;
  const body = { source_hash, answers: [{ from_concept_id: w.ids.a, to_concept_id: w.ids.b }] };
  await s.call('PATCH', `/api/cmap/edges/${w.e1.id}`, { label: '다른 문구' });
  let r = await w.submit(body); fail(r, 409); assert.equal(r.body.stale, true, '저장 전에 바뀌어도 시작 시점과 다르면 stale');
  await s.call('POST', `/api/cmap/maps/${w.map.id}/save`);           // 다시 저장해도 시작 때 해시와 다르면 거부
  r = await w.submit(body); fail(r, 409); assert.equal(r.body.stale, true);
  assert.equal(s.db.attempts.length, 0);
  const again = (await w.start()).body;                                // 다시 시작하면 새 해시로 채점 가능
  assert.equal((await w.submit({ source_hash: again.source_hash, answers: [] })).status, 201);
});

test('제출: 위치만 바뀐 지도는 같은 의미라 채점된다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const { source_hash } = (await w.start()).body;
  await s.call('PATCH', `/api/cmap/maps/${w.map.id}/nodes/${w.ids.a}`, { x: 9, y: 9 });
  assert.equal((await w.submit({ source_hash, answers: [] })).status, 201);
});

test('제출: 잘못된 입력(해시 형식·답 형식·지도 밖 개념·중복·종류)은 400 이고 기록하지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const { source_hash } = (await w.start()).body;
  const ok = { from_concept_id: w.ids.a, to_concept_id: w.ids.b };
  const cases = [{}, { source_hash: 5, answers: [] }, { source_hash: 'abc', answers: [] }, { source_hash }, { source_hash, answers: 'x' },
    { source_hash, answers: [{ ...ok, to_concept_id: w.ids.a }] }, { source_hash, answers: [{ ...ok, to_concept_id: w.ids.e }] }, { source_hash, answers: [ok, { from_concept_id: w.ids.b, to_concept_id: w.ids.a }] },
    { source_hash, answers: [{ ...ok, relation_type: '이상한' }] }];
  for (const c of cases) fail(await w.submit(c), 400);
  assert.equal(s.db.attempts.length, 0);
});

test('권한·소유: 비인증 401, 권한 없음 403, 타인 지도 404(기록·변화 없음), 잘못된 id 404', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const { source_hash } = (await w.start()).body;
  const urls = [[`/api/cmap/maps/${w.map.id}/quiz/start`, undefined], [`/api/cmap/maps/${w.map.id}/quiz/submit`, { source_hash, answers: [] }]];
  const before = s.db.snapshot();
  for (const [u, b] of urls) {
    assert.equal((await s.t.call('POST', u, b, { user: null })).status, 401);
    assert.equal((await s.call('POST', u, b, 3)).status, 403);
    assert.equal((await s.call('POST', u, b, 2)).status, 404);
  }
  assert.equal((await s.call('POST', '/api/cmap/maps/abc/quiz/start')).status, 404);
  assert.equal((await s.call('POST', '/api/cmap/maps/99999/quiz/submit', { source_hash, answers: [] })).status, 404);
  assert.equal(s.db.snapshot(), before);
});

test('지도를 지우면 시도 기록도 지워진다(CASCADE)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  const { source_hash } = (await w.start()).body;
  await w.submit({ source_hash, answers: [] });
  assert.equal(s.db.attempts.length, 1);
  assert.equal((await s.call('DELETE', `/api/cmap/topics/${w.sci.id}?confirm=1`)).status, 200);
  assert.equal(s.db.attempts.length, 0);
});
