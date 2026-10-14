// 작업275-5: "표시한 개념" 퀴즈 서버 규칙 — 출제 범위(표시 개념의 연결만 + 이웃 노드)는 서버가 DB 의 표시로 계산하고 클라이언트가 보낸 범위는 쓰지 않는다. 정답 연결은 start 응답에 없다.
// 채점은 기존 규칙(연결·유형·방향 따로, '구별' 방향 무시, 범위 밖 연결은 추가 연결로 표시·감점 없음)이고, 기존 전체 퀴즈 결과는 그대로다(회귀).
// AI 없음. 가짜 DB 는 실제 PG 제약을 흉내 낸 것이다(한계). 서버는 t.after 로 종료한다. 실행: node --test tests/concept_map_quiz_marked.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCmapDb } = require('./helpers/cmap_db');
const { startApp } = require('./helpers/app');
const Q = require('../lib/cmap_quiz');

async function setup() {
  const db = createCmapDb();
  db.addUser(1, { perm_concept_map: true });
  db.addUser(2, { perm_concept_map: true });
  db.addUser(3, { perm_concept_map: false });
  const t = await startApp(['routes/concept_map.js'], { db });
  const call = (method, url, body, user = 1) => t.call(method, url, body, { user });
  // 개념 a b c d e f 와 지도 밖 개념 x. 연결: a→b(일으킴) b→c(사용) c→d(구별) d→e(일부) a→c(종류). f 는 연결 없음(고립)
  const world = async (user = 1) => {
    const sci = (await call('POST', '/api/cmap/topics', { title: '과학' }, user)).body.topic;
    const ids = {};
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'x']) ids[k] = (await call('POST', `/api/cmap/topics/${sci.id}/concepts`, { term: k + '개념' }, user)).body.concept.id;
    const map = (await call('GET', `/api/cmap/topics/${sci.id}/map`, undefined, user)).body.map;
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) await call('POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: ids[k] }, user);
    const edge = (f, to, label, relation_type) => call('POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[f], to_concept_id: ids[to], label, relation_type }, user);
    await edge('a', 'b', '가나', '일으킴'); await edge('b', 'c', '나다', '사용'); await edge('c', 'd', '다라', '구별'); await edge('d', 'e', '라마', '일부'); await edge('a', 'c', '가다', '종류');
    await call('POST', `/api/cmap/maps/${map.id}/save`, undefined, user);
    const mark = (ks, u = user) => Promise.all(ks.map(k => call('PUT', `/api/cmap/concepts/${ids[k]}/mark`, { marked: true }, u)));
    const start = (body = { mode: 'marked' }, u = user) => call('POST', `/api/cmap/maps/${map.id}/quiz/start`, body, u);
    const submit = (b, u = user) => call('POST', `/api/cmap/maps/${map.id}/quiz/submit`, b, u);
    const info = (u = user) => call('GET', `/api/cmap/maps/${map.id}/quiz/marked-info`, undefined, u);
    const A = (f, to, type = null) => ({ from_concept_id: ids[f], to_concept_id: ids[to], relation_type: type });
    return { sci, ids, map, mark, start, submit, info, A };
  };
  return { db, t, call, world };
}
const fail = (r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.ok, false); };
const idsOf = (w, ks) => ks.map(k => w.ids[k]).sort((a, b) => a - b);

test('출제 범위: 표시 개념(b)의 연결(a→b, b→c)만, 제시 노드 = b + 이웃(a, c), 표시 개념에만 marked 표식, 정답 연결·문구·종류는 start 응답에 없다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(['b']);
  const r = await w.start();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mode, 'marked');
  assert.deepEqual(r.body.nodes.map(n => n.id).sort((a, b) => a - b), idsOf(w, ['a', 'b', 'c']));
  assert.deepEqual(r.body.nodes.filter(n => n.marked).map(n => n.id), [w.ids.b]);
  assert.ok(r.body.nodes.every(n => Object.keys(n).sort().join() === 'english,id,marked,term'));
  assert.match(r.body.scope_key, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.body.isolated, []);
  const text = JSON.stringify(r.body);
  assert.ok(!/가나|나다|다라|라마|가다|일으킴|사용|구별|종류|일부|edges|label|relation|from_concept|to_concept/.test(text), '정답 정보 없음');
  assert.ok(!r.body.nodes.some(n => [w.ids.d, w.ids.e, w.ids.f].includes(n.id)), '범위 밖 개념은 제시하지 않음');
});

test('표시가 없으면 400(no_marks), 연결이 없는 표시 개념은 isolated 로 알리고 출제에서 제외, 출제 연결이 2개 미만이면 400(too_few) + 안내 정보', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  let r = await w.start(); fail(r, 400); assert.equal(r.body.no_marks, true);
  assert.deepEqual((await w.info()).body, { ok: true, marked: [], isolated: [], scope_edges: 0, ready: false });
  await w.mark(['f']);                                                         // 고립 개념만 표시
  r = await w.start(); fail(r, 400); assert.equal(r.body.too_few, true); assert.equal(r.body.scope_edges, 0);
  assert.deepEqual(r.body.isolated.map(x => x.id), [w.ids.f]);
  await w.mark(['e']);                                                         // e: d→e 한 개뿐
  r = await w.start(); fail(r, 400); assert.equal(r.body.too_few, true); assert.equal(r.body.scope_edges, 1);
  const info = (await w.info()).body;
  assert.deepEqual(info.marked.map(x => x.id).sort((a, b) => a - b), idsOf(w, ['e', 'f']));
  assert.deepEqual(info.isolated.map(x => x.id), [w.ids.f]); assert.equal(info.scope_edges, 1); assert.equal(info.ready, false);
  await w.mark(['b']);                                                         // 출제 가능(연결 3개), f 는 여전히 고립
  r = await w.start(); assert.equal(r.status, 200);
  assert.deepEqual(r.body.isolated.map(x => x.id), [w.ids.f], '연결 없는 표시 개념은 시작 응답에도 알림');
  assert.ok(!r.body.nodes.some(n => n.id === w.ids.f), '고립 개념은 제시하지 않음');
  assert.equal((await w.info()).body.ready, true);
});

test('지도에 없는 개념의 표시·다른 사용자의 표시는 범위에 들어가지 않는다(사용자별 격리)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w1 = await s.world(1);
  const w2 = await s.world(2);
  await w1.mark(['x']);                                                        // 지도의 노드가 아닌 개념
  fail(await w1.start(), 400);
  await w2.mark(['b', 'c']);                                                   // 다른 사용자의 표시
  fail(await w1.start(), 400);
  assert.deepEqual((await w1.info()).body.marked, [], '다른 사용자 표시는 보이지 않음');
  assert.equal((await w2.start(undefined, 2)).status, 200);
  await w1.mark(['b']);
  const r1 = await w1.start();
  assert.deepEqual(r1.body.nodes.map(n => n.id).sort((a, b) => a - b), idsOf(w1, ['a', 'b', 'c']));
  const r2 = await w2.start({ mode: 'marked' }, 2);
  assert.deepEqual(r2.body.nodes.map(n => n.id).sort((a, b) => a - b), idsOf(w2, ['a', 'b', 'c', 'd']), '각자 자기 표시 기준(c 는 구별로 d 와 이어짐)');
  assert.ok(r2.body.nodes.every(n => !w1.ids || ![w1.ids.a, w1.ids.b].includes(n.id)), '다른 사용자 개념이 섞이지 않음');
});

test('클라이언트가 보낸 범위·표시·노드 목록은 무시하고 서버 계산만 쓴다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(['b']);
  const plain = (await w.start()).body;
  const forged = (await w.start({ mode: 'marked', marked: [w.ids.d, w.ids.e], marked_concept_ids: [w.ids.f], nodes: [w.ids.f], edges: [1, 2, 3], scope_edges: [1], concept_ids: [w.ids.e] })).body;
  assert.deepEqual(forged, plain);
  // 제출도 서버 범위로 검증: 범위 밖 노드(d)를 답에 쓰면 거부
  const bad = await w.submit({ mode: 'marked', source_hash: plain.source_hash, scope_key: plain.scope_key, marked: [w.ids.d], answers: [w.A('c', 'd', '구별')] });
  fail(bad, 400);
  assert.equal(s.db.attempts.length, 0);
});

test('채점(표시 범위): 범위 안 연결만 정답 기준 — 연결·유형·방향 점수, 범위 밖 연결(a→c)은 추가 연결로 표시되고 점수에 영향 없음, 모두 맞힌 표시 개념(mastered)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(['b']);
  const st = (await w.start()).body;
  const base = { mode: 'marked', source_hash: st.source_hash, scope_key: st.scope_key };
  const good = [w.A('a', 'b', '일으킴'), w.A('b', 'c', '사용')];
  const r1 = await w.submit({ ...base, answers: good });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.deepEqual(r1.body.scores.pair, { hit: 2, total: 2, ratio: 1 });
  assert.deepEqual(r1.body.scores.type, { hit: 2, total: 2, ratio: 1 });
  assert.deepEqual(r1.body.scores.direction, { hit: 2, total: 2, ratio: 1 });
  assert.deepEqual(r1.body.extras, []); assert.equal(r1.body.mode, 'marked');
  assert.deepEqual(r1.body.mastered.map(m => m.id), [w.ids.b]);
  assert.equal(r1.body.mastered[0].term, 'b개념');
  const r2 = await w.submit({ ...base, answers: [...good, w.A('a', 'c', '종류')] });      // a→c 는 지도의 연결이지만 표시 개념과 무관 → 범위 밖
  assert.deepEqual(r2.body.scores, r1.body.scores, '추가 연결은 감점 없음');
  assert.equal(r2.body.extras.length, 1); assert.deepEqual([r2.body.extras[0].from_term, r2.body.extras[0].to_term], ['a개념', 'c개념']);
  assert.equal(r2.body.missed.length, 0);
  assert.equal(s.db.attempts.length, 2);
  const row = s.db.attempts[0];
  assert.deepEqual([row.user_id, row.map_id, row.source_hash, row.pair_score, row.type_score, row.direction_score], [1, w.map.id, st.source_hash, 1, 1, 1], '기존 열만으로 같은 방식 저장');
  // 틀린 답: 방향 반대 + 종류 틀림 + 하나 못 찾음
  const r3 = await w.submit({ ...base, answers: [w.A('b', 'a', '사용')] });
  assert.deepEqual(r3.body.scores.pair, { hit: 1, total: 2, ratio: 0.5 });
  assert.deepEqual(r3.body.scores.type, { hit: 0, total: 2, ratio: 0 });
  assert.deepEqual(r3.body.scores.direction, { hit: 0, total: 2, ratio: 0 });
  assert.equal(r3.body.wrong.length, 1); assert.equal(r3.body.missed.length, 1);
  assert.deepEqual(r3.body.mastered, [], '틀리면 모두 맞힌 개념이 아님');
});

test("채점('구별' 방향 무시)·mastered 는 이어진 출제 연결을 모두 맞힌 표시 개념만", async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(['b', 'c']);                                                    // 범위: a→b, b→c, c→d(구별), a→c
  const st = (await w.start()).body;
  assert.deepEqual(st.nodes.map(n => n.id).sort((a, b) => a - b), idsOf(w, ['a', 'b', 'c', 'd']));
  const base = { mode: 'marked', source_hash: st.source_hash, scope_key: st.scope_key };
  const r = await s.call('POST', `/api/cmap/maps/${w.map.id}/quiz/submit`, { ...base, answers: [w.A('a', 'b', '일으킴'), w.A('b', 'c', '사용'), w.A('d', 'c', '구별'), w.A('a', 'c', '일으킴')] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.scores.pair, { hit: 4, total: 4, ratio: 1 });
  assert.deepEqual(r.body.scores.type, { hit: 3, total: 4, ratio: 0.75 }, 'a→c 종류를 일으킴으로 답해 틀림');
  assert.deepEqual(r.body.scores.direction, { hit: 3, total: 3, ratio: 1 }, "구별(c-d)은 방향 분모에서 제외·반대로 그려도 정답");
  assert.deepEqual(r.body.mastered.map(m => m.id), [w.ids.b], 'b 만 모두 맞힘(c 는 a→c 유형 오답)');
});

test('시작 뒤 표시가 바뀌었거나 scope_key 가 없거나 지도가 바뀌면 채점하지 않는다(409), mode 값이 잘못되면 400', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(['b']);
  const st = (await w.start()).body;
  const ans = [w.A('a', 'b', '일으킴')];
  fail(await w.submit({ mode: 'marked', source_hash: st.source_hash, answers: ans }), 409);
  fail(await w.submit({ mode: 'marked', source_hash: st.source_hash, scope_key: 'f'.repeat(64), answers: ans }), 409);
  await w.mark(['c']);                                                         // 시작 뒤 표시가 늘어남 → 범위가 달라짐
  const changed = await w.submit({ mode: 'marked', source_hash: st.source_hash, scope_key: st.scope_key, answers: ans });
  fail(changed, 409); assert.equal(changed.body.scope_changed, true);
  fail(await w.start({ mode: 'bogus' }), 400);
  fail(await w.submit({ mode: 'bogus', source_hash: st.source_hash, answers: [] }), 400);
  assert.equal(s.db.attempts.length, 0);
  // 지도가 바뀌면 기존 규칙대로 stale / needs_save
  const st2 = (await w.start()).body;
  await s.call('POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.ids.e, to_concept_id: w.ids.f, label: '새 연결' });
  const r = await w.submit({ mode: 'marked', source_hash: st2.source_hash, scope_key: st2.scope_key, answers: [] }); fail(r, 409); assert.equal(r.body.stale, true);
  const r2 = await w.start(); fail(r2, 409); assert.equal(r2.body.needs_save, true);
});

test('회귀: 기존 전체 퀴즈(mode 없음·all)의 start/submit 응답과 채점 결과는 그대로다 — 표시가 있어도 영향 없음', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(['b']);                                                         // 표시가 있어도 전체 퀴즈는 변하지 않는다
  for (const body of [undefined, {}, { mode: 'all' }]) {
    const r = await s.call('POST', `/api/cmap/maps/${w.map.id}/quiz/start`, body);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['nodes', 'ok', 'source_hash'], '키 그대로');
    assert.deepEqual(r.body.nodes.map(n => n.id).sort((a, b) => a - b), idsOf(w, ['a', 'b', 'c', 'd', 'e', 'f']));
    assert.ok(r.body.nodes.every(n => Object.keys(n).sort().join() === 'english,id,term'), '표시 정보 없음');
  }
  const st = (await s.call('POST', `/api/cmap/maps/${w.map.id}/quiz/start`, {})).body;
  const answers = [w.A('b', 'a', '일으킴'), w.A('b', 'c', '사용'), w.A('d', 'c', '구별'), w.A('a', 'e', '일부')];
  const r = await w.submit({ source_hash: st.source_hash, answers });
  assert.equal(r.status, 201);
  assert.ok(!('mode' in r.body) && !('mastered' in r.body), '전체 퀴즈 응답에는 표시 퀴즈 필드가 없음');
  // 모듈의 채점 함수와 같은 결과(기존 규칙)
  const edges = s.db.edges.filter(e => e.map_id === w.map.id);
  const expected = Q.grade(edges, answers.map(a => ({ ...a })));
  assert.deepEqual(r.body.scores, expected.scores);
  assert.equal(r.body.correct.length, expected.correct.length); assert.equal(r.body.wrong.length, expected.wrong.length);
  assert.equal(r.body.missed.length, expected.missed.length); assert.equal(r.body.extras.length, expected.extras.length);
  assert.equal(r.body.scores.pair.total, 5, '전체 연결 5개 기준');
});

test('권한·소유: 비인증 401, 권한 없음 403, 타인 지도 404 — 정보·시작·제출 모두', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const w = await s.world();
  await w.mark(['b']);
  const st = (await w.start()).body;
  const calls = [['GET', `/api/cmap/maps/${w.map.id}/quiz/marked-info`, undefined], ['POST', `/api/cmap/maps/${w.map.id}/quiz/start`, { mode: 'marked' }], ['POST', `/api/cmap/maps/${w.map.id}/quiz/submit`, { mode: 'marked', source_hash: st.source_hash, scope_key: st.scope_key, answers: [] }]];
  const before = s.db.snapshot();
  for (const [m, u, b] of calls) {
    assert.equal((await s.t.call(m, u, b, { user: null })).status, 401);
    assert.equal((await s.call(m, u, b, 3)).status, 403);
    assert.equal((await s.call(m, u, b, 2)).status, 404);
  }
  assert.equal((await s.call('GET', '/api/cmap/maps/abc/quiz/marked-info')).status, 404);
  assert.equal(s.db.snapshot(), before);
});

test('모듈 단위: scopeFor — 표시 개념의 연결·이웃·고립 개념·지도 밖 표시 제외, key 는 범위가 같으면 같고 다르면 다르다', () => {
  const E = (id, f, t) => ({ id, from_concept_id: f, to_concept_id: t });
  const edges = [E(1, 1, 2), E(2, 2, 3), E(3, 3, 4)];
  const sc = Q.scopeFor(edges, [1, 2, 3, 4, 5], [2, 5, 99]);
  assert.deepEqual(sc.marked, [2, 5]); assert.deepEqual(sc.isolated, [5]);
  assert.deepEqual(sc.edges.map(e => e.id), [1, 2]); assert.deepEqual(sc.nodeIds, [1, 2, 3]);
  assert.equal(Q.scopeFor(edges, [1, 2, 3, 4, 5], [2]).key, sc.key, '고립 표시만 달라도 출제 범위가 같으면 같은 key');
  assert.notEqual(Q.scopeFor(edges, [1, 2, 3, 4, 5], [3]).key, sc.key);
  assert.deepEqual(Q.scopeFor(edges, [1, 2], []).edges, []);
  assert.deepEqual(Q.masteredOf(sc.edges, [E(0, 1, 2), E(0, 2, 3)].map(e => ({ from_concept_id: e.from_concept_id, to_concept_id: e.to_concept_id })), [2]), [2]);
  assert.deepEqual(Q.masteredOf(sc.edges, [{ from_concept_id: 1, to_concept_id: 2 }], [2]), []);
});
