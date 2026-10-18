// 작업286-1: 관계 유형 10개(방향 있음 6 + 방향 없음 4) · 연결 문구 선택화 · display_label · 의미 해시 · 퀴즈 채점 · 해설 입력.
// 가짜 DB(tests/helpers/cmap_db.js)는 새 규칙(10개 유형, label NULL 허용, 유형·문구 둘 다 없으면 거부)을 흉내 낸 것이다(한계: 실제 PostgreSQL 제약 교체는 db_init 테스트의 SQL 확인으로만 검증).
// 실행: node --test tests/concept_map_types.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCmapDb, legacyEdgeCall } = require('./helpers/cmap_db');
const { startApp } = require('./helpers/app');
const M = require('../lib/cmap_map');
const Q = require('../lib/cmap_quiz');
const H = require('../lib/cmap_hash');

const DIRECTED = ['사용', '일부', '종류', '일으킴', '선행', '조건'];
const SYMMETRIC = ['구별', '유사', '대립', '연관'];

async function setup() {
  const db = createCmapDb();
  db.addUser(1, { perm_concept_map: true }); db.addUser(2, { perm_concept_map: true });
  const t = await startApp(['routes/concept_map.js'], { db });
  const call = legacyEdgeCall(db, (method, url, body, user = 1) => t.call(method, url, body, { user }));   // 307-1: 옛 유형 연결은 "이미 저장된" 상태로 직접 넣는다
  const top = (await call('POST', '/api/cmap/topics', { title: '과학' })).body.topic;
  const ids = [];
  for (const term of ['a', 'b', 'c', 'd']) ids.push((await call('POST', `/api/cmap/topics/${top.id}/concepts`, { term })).body.concept.id);
  const map = (await call('GET', `/api/cmap/topics/${top.id}/map`)).body.map;
  for (const id of ids) await call('POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id });
  const edge = (from, to, extra = {}) => call('POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: from, to_concept_id: to, ...extra });
  return { db, t, call, top, ids, map, edge };
}

test('유형 목록(307-1): 새로 고를 3종(종류·일부·대립)과 읽기·표시·퀴즈용 전체 10종(방향 있음 6 + 방향 없음 4)을 나누고, 대칭 목록·판정은 옛 연결 호환으로 4종 그대로', () => {
  assert.deepEqual(M.SELECTABLE_RELATION_TYPES, ['종류', '일부', '대립'], '새로 고를 수 있는 3종, 이 순서');
  assert.deepEqual(M.ALL_RELATION_TYPES, [...DIRECTED, ...SYMMETRIC]);
  assert.deepEqual(M.RELATION_TYPES, M.ALL_RELATION_TYPES, '예전 이름은 전체 목록');
  assert.deepEqual(M.SYMMETRIC_TYPES, SYMMETRIC);
  for (const t of ['사용', '일부', '종류', '일으킴', '구별']) assert.ok(M.ALL_RELATION_TYPES.includes(t), '기존 5개 호환: ' + t);
  assert.deepEqual(M.ALL_RELATION_TYPES.filter(M.isSymmetric), SYMMETRIC);
  assert.equal(M.isSymmetric(null), false); assert.equal(M.isSymmetric('선행'), false);
  assert.deepEqual(M.normalizeDirection(9, 2, '대립'), { from: 2, to: 9 }); assert.deepEqual(M.normalizeDirection(9, 2, '조건'), { from: 9, to: 2 });
  // 검증 함수: 기본은 3종, 전체 목록을 넘기면 옛 7종도 통과(퀴즈 답·옛 연결 수정), 오류 문구는 항상 3종 기준
  assert.deepEqual(M.readRelationType('일부'), { value: '일부' });
  assert.match(M.readRelationType('사용').error, /종류, 일부, 대립/);
  assert.deepEqual(M.readRelationType('사용', M.ALL_RELATION_TYPES), { value: '사용' });
  assert.match(M.readRelationType('없는', M.ALL_RELATION_TYPES).error, /종류, 일부, 대립/);
  assert.deepEqual(M.readRelationType(null), { value: null }); assert.deepEqual(M.readRelationType(undefined), { value: undefined });
});

test('연결 만들기(307-1): 새 연결은 종류·일부·대립 3종만 허용하고 옛 7종·그 밖은 400, 대립은 작은 id 가 from 으로 정규화되고 종류·일부는 누른 순서 그대로, 지도 응답에 유형 목록 3종·전체 10종·대칭 4종', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c, d] = s.ids;
  const g = (await s.call('GET', `/api/cmap/topics/${s.top.id}/map`)).body;
  assert.deepEqual(g.relation_types, ['종류', '일부', '대립'], '새로 고를 3종'); assert.deepEqual(g.all_relation_types, M.ALL_RELATION_TYPES, '전체 10종'); assert.deepEqual(g.symmetric_types, SYMMETRIC);
  for (const type of ['종류', '일부', '대립']) {
    const r = await s.edge(d, c, { relation_type: type, label: '문구' });
    assert.equal(r.status, 201, type + ' ' + JSON.stringify(r.body));
    const e = r.body.edge;
    if (type === '대립') assert.deepEqual([e.from_concept_id, e.to_concept_id], [c, d], type + ': 작은 id 가 from');
    else assert.deepEqual([e.from_concept_id, e.to_concept_id], [d, c], type + ': 누른 순서 그대로');
    assert.equal((await s.call('DELETE', `/api/cmap/edges/${e.id}`)).status, 200);
  }
  const before = s.db.snapshot();
  // 옛 7종은 새로 만들 수 없다(legacyEdgeCall 은 테스트 시드용이라 여기서는 서버를 직접 부른다)
  for (const type of ['사용', '일으킴', '선행', '조건', '구별', '유사', '연관']) {
    const r = await s.t.call('POST', `/api/cmap/maps/${s.map.id}/edges`, { from_concept_id: d, to_concept_id: c, relation_type: type, label: 'x' }, { user: 1 });
    assert.equal(r.status, 400, type); assert.match(r.body.error, /종류, 일부, 대립/);
  }
  for (const bad of ['없는', '', '종류 ', 5]) assert.equal((await s.edge(d, c, { relation_type: bad, label: 'x' })).status, 400, JSON.stringify(bad));
  assert.equal(s.db.snapshot(), before);
  assert.equal((await s.edge(d, c, { label: '유형 없이 문구만' })).status, 201, '유형 없이 문구만도 그대로 가능');
  assert.ok(b && a);
});

test('옛 유형 연결 수정(307-1): 이미 저장된 옛 유형은 그대로 두고 문구·방향을 고칠 수 있고, 다른 옛 유형으로 바꾸기는 400, 3종으로 바꾸기는 허용', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c] = s.ids;
  const e = (await s.edge(b, a, { relation_type: '사용', label: '쓴다' })).body.edge;            // 이미 저장된 옛 유형(시드)
  const patch = body => s.call('PATCH', `/api/cmap/edges/${e.id}`, body);
  let r = await patch({ relation_type: '사용', label: '고쳐 씀' });                              // 같은 값을 그대로 보냄 + 문구 수정
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.edge.relation_type, '사용'); assert.equal(r.body.edge.label, '고쳐 씀');
  r = await patch({ label: '문구만' }); assert.equal(r.status, 200); assert.equal(r.body.edge.relation_type, '사용');
  r = await patch({ reverse: true }); assert.equal(r.status, 200); assert.deepEqual([r.body.edge.from_concept_id, r.body.edge.to_concept_id], [a, b], '방향 바꾸기');
  for (const other of ['선행', '구별', '일으킴']) { r = await patch({ relation_type: other }); assert.equal(r.status, 400, '다른 옛 유형으로 바꾸기: ' + other); assert.match(r.body.error, /종류, 일부, 대립/); }
  assert.equal(s.db.edges.find(x => x.id === e.id).relation_type, '사용', '거부되면 그대로');
  r = await patch({ relation_type: '없는' }); assert.equal(r.status, 400);
  r = await patch({ relation_type: '종류' }); assert.equal(r.status, 200); assert.equal(r.body.edge.relation_type, '종류', '3종으로 바꾸기');
  r = await patch({ relation_type: '사용' }); assert.equal(r.status, 400, '3종으로 바꾼 뒤에는 옛 유형으로 되돌릴 수 없음(저장된 값이 아님)');
  // 옛 유형(대칭)도 같은 값이면 허용되고 방향 바꾸기는 기존 규칙대로 거부
  const f = (await s.edge(a, c, { relation_type: '구별', label: '차이' })).body.edge;
  r = await s.call('PATCH', `/api/cmap/edges/${f.id}`, { relation_type: '구별', label: '차이 2' }); assert.equal(r.status, 200);
  r = await s.call('PATCH', `/api/cmap/edges/${f.id}`, { reverse: true }); assert.equal(r.status, 400);
});

test('방향 없음 4개: reverse 는 400(방향이 없어 바꿀 수 없음), 방향 있음 6개는 reverse 가능', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c, d] = s.ids;
  for (const [i, type] of SYMMETRIC.entries()) {
    const e = (await s.edge(s.ids[i], s.ids[(i + 1) % 4], { relation_type: type, label: type + ' 문구' })).body.edge;
    const r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { reverse: true });
    assert.equal(r.status, 400, type); assert.match(r.body.error, new RegExp(type + '.*방향이 없어'));
    await s.call('DELETE', `/api/cmap/edges/${e.id}`);
  }
  for (const type of DIRECTED) {
    const e = (await s.edge(b, a, { relation_type: type, label: 'x' })).body.edge;
    const r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { reverse: true });
    assert.equal(r.status, 200, type); assert.deepEqual([r.body.edge.from_concept_id, r.body.edge.to_concept_id], [a, b]);
    await s.call('DELETE', `/api/cmap/edges/${e.id}`);
  }
  assert.ok(c && d);
});

test('문구 선택화: 생략·빈 문자열·공백만은 NULL 로 저장되고, 유형도 문구도 없으면 400, display_label = 문구 ?? 유형 이름(지도 조회·만들기·수정 응답 모두)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c, d] = s.ids;
  const r1 = await s.edge(a, b, { relation_type: '선행' });                                  // 문구 생략
  assert.equal(r1.status, 201); assert.equal(r1.body.edge.label, null); assert.equal(r1.body.edge.display_label, '선행');
  assert.equal(s.db.edges[0].label, null, 'DB 에는 NULL');
  const r2 = await s.edge(b, c, { relation_type: '유사', label: '' });                        // 빈 문자열
  assert.equal(r2.body.edge.label, null); assert.equal(r2.body.edge.display_label, '유사');
  const r3 = await s.edge(c, d, { relation_type: '조건', label: '   ' });                    // 공백만
  assert.equal(r3.body.edge.label, null); assert.equal(r3.body.edge.display_label, '조건');
  const r4 = await s.edge(a, c, { relation_type: '사용', label: ' 쓴다 ' });                  // 값이 있으면 다듬어 저장, 표시는 문구
  assert.equal(r4.body.edge.label, '쓴다'); assert.equal(r4.body.edge.display_label, '쓴다');
  // 유형도 문구도 없으면 400 (생략·null·빈 문자열 조합)
  const before = s.db.snapshot();
  for (const body of [{}, { label: '' }, { label: null }, { relation_type: null, label: '  ' }]) {
    const r = await s.edge(a, d, body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.body.error, /유형을 고르거나 문구를 입력/);
  }
  assert.equal(s.db.snapshot(), before);
  assert.equal((await s.edge(a, d, { relation_type: '종류', label: '가'.repeat(41) })).status, 400, '값이 있으면 40자 제한은 그대로');
  assert.equal((await s.edge(a, d, { label: 5 })).status, 400);
  // 지도 조회
  const g = (await s.call('GET', `/api/cmap/topics/${s.top.id}/map`)).body;
  assert.deepEqual(g.edges.map(e => [e.label, e.display_label]), [[null, '선행'], [null, '유사'], [null, '조건'], ['쓴다', '쓴다']]);
  // 수정: 문구 지우기(NULL), 유형을 지워 문구만 남기기, 둘 다 지우기 400, 문구를 채우기
  const e1 = r4.body.edge;
  let r = await s.call('PATCH', `/api/cmap/edges/${e1.id}`, { label: '' });
  assert.equal(r.status, 200); assert.equal(r.body.edge.label, null); assert.equal(r.body.edge.display_label, '사용');
  r = await s.call('PATCH', `/api/cmap/edges/${e1.id}`, { relation_type: null });
  assert.equal(r.status, 400, '문구도 유형도 없어짐');
  assert.equal(s.db.edges.find(e => e.id === e1.id).relation_type, '사용', '거부되면 그대로');
  r = await s.call('PATCH', `/api/cmap/edges/${e1.id}`, { label: '다시 씀', relation_type: null });
  assert.equal(r.status, 200); assert.equal(r.body.edge.relation_type, null); assert.equal(r.body.edge.display_label, '다시 씀');
  r = await s.call('PATCH', `/api/cmap/edges/${r1.body.edge.id}`, { label: '선행 설명' });
  assert.equal(r.body.edge.display_label, '선행 설명');
});

test('PATCH 로 유형이 바뀔 때의 방향: 대립으로 바뀌면 작은 id 가 from 으로 정규화, 종류·일부로 바뀌면 현재 저장된 방향을 유지(되돌려 놓지 않음)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b] = s.ids;
  const e = (await s.edge(b, a, { relation_type: '종류', label: 'x' })).body.edge;           // 큰 id → 작은 id (방향 있음이라 그대로 저장)
  assert.deepEqual([e.from_concept_id, e.to_concept_id], [b, a]);
  let r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { relation_type: '대립' });
  assert.deepEqual([r.body.edge.from_concept_id, r.body.edge.to_concept_id], [a, b], '대립(방향 없음)으로 → 정규화');
  r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { relation_type: '일부' });
  assert.deepEqual([r.body.edge.from_concept_id, r.body.edge.to_concept_id], [a, b], '방향 있음으로 → 저장된 방향 유지');
  r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { relation_type: '대립', reverse: true });
  assert.equal(r.status, 400, '방향 없음으로 바꾸면서 reverse 는 거부');
  r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { relation_type: '종류', reverse: true });
  assert.deepEqual([r.body.edge.from_concept_id, r.body.edge.to_concept_id], [b, a], '방향 있음 + reverse');
});

test('같은 쌍은 방향·유형과 상관없이 한 번만(409) — 방향 없음 유형 포함, 유일 인덱스 흉내 유지', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b] = s.ids;
  assert.equal((await s.edge(a, b, { relation_type: '연관' })).status, 201);
  for (const type of ['종류', '대립']) assert.equal((await s.edge(b, a, { relation_type: type })).status, 409, type);
});

test('의미 해시: 기존 문구가 있는 연결의 정규화 문자열은 이전과 같고(저장된 해시 호환), 문구 NULL 은 명시되며, 문구를 비우거나 채우거나 유형이 바뀌면 해시가 달라져 "저장 후 변경됨"이 된다', async t => {
  const old = H.canonicalize([1, 2], [{ from_concept_id: 1, to_concept_id: 2, relation_type: '사용', label: '쓴다' }]);
  assert.equal(old, JSON.stringify({ v: 1, nodes: [1, 2], edges: [[1, 2, '사용', '쓴다']] }), '문구가 있으면 옛 형식 그대로');
  assert.equal(H.canonicalize([1, 2], [{ from_concept_id: 1, to_concept_id: 2, relation_type: '선행', label: null }]), JSON.stringify({ v: 1, nodes: [1, 2], edges: [[1, 2, '선행', null]] }));
  const h = (type, label) => H.computeSemanticHash([1, 2], [{ from_concept_id: 1, to_concept_id: 2, relation_type: type, label }]);
  assert.notEqual(h('선행', null), h('선행', '선행'), 'NULL 과 같은 글자의 문구는 다른 의미');
  assert.notEqual(h('선행', null), h('조건', null));
  assert.equal(h('선행', null), h('선행', null));
  // 서버 흐름: 저장 → 문구만 비워도 changed
  const s = await setup(); t.after(() => s.t.close());
  const [a, b] = s.ids;
  const e = (await s.edge(a, b, { relation_type: '사용', label: '쓴다' })).body.edge;
  assert.equal((await s.call('POST', `/api/cmap/maps/${s.map.id}/save`)).body.status.save_status, 'saved');
  const r = await s.call('PATCH', `/api/cmap/edges/${e.id}`, { label: '' });
  assert.equal(r.body.status.save_status, 'changed', '문구를 비우면 저장 후 변경됨');
  assert.equal((await s.call('POST', `/api/cmap/maps/${s.map.id}/save`)).body.status.save_status, 'saved');
  assert.equal((await s.call('PATCH', `/api/cmap/edges/${e.id}`, { label: '다시' })).body.status.save_status, 'changed', '채워도 변경됨');
});

test('퀴즈 채점: 방향 없음 4개는 방향 분모에서 빠지고(정규화된 연결은 어느 방향으로 이어도 방향 점수에 영향 없음), 방향 있음 6개는 방향을 채점하며, 기대 연결의 문구는 display_label', () => {
  const edges = [
    { from_concept_id: 1, to_concept_id: 2, relation_type: '선행', label: null },
    { from_concept_id: 1, to_concept_id: 3, relation_type: '조건', label: '전제' },
    { from_concept_id: 1, to_concept_id: 4, relation_type: '유사', label: null },
    { from_concept_id: 2, to_concept_id: 3, relation_type: '대립', label: '반대' },
    { from_concept_id: 2, to_concept_id: 4, relation_type: '연관', label: null },
    { from_concept_id: 3, to_concept_id: 4, relation_type: '구별', label: null },
  ];
  // 방향 있음 2개는 반대로, 방향 없음 4개는 모두 반대 방향(큰 id → 작은 id)으로 이음
  const answers = [
    { from_concept_id: 2, to_concept_id: 1, relation_type: '선행' }, { from_concept_id: 3, to_concept_id: 1, relation_type: '조건' },
    { from_concept_id: 4, to_concept_id: 1, relation_type: '유사' }, { from_concept_id: 3, to_concept_id: 2, relation_type: '대립' },
    { from_concept_id: 4, to_concept_id: 2, relation_type: '연관' }, { from_concept_id: 4, to_concept_id: 3, relation_type: '구별' },
  ];
  const g = Q.grade(edges, answers);
  assert.deepEqual(g.scores.direction, { hit: 0, total: 2, ratio: 0 }, '분모는 방향 있음 2개뿐');
  assert.deepEqual(g.scores.pair, { hit: 6, total: 6, ratio: 1 }); assert.deepEqual(g.scores.type, { hit: 6, total: 6, ratio: 1 });
  assert.equal(g.wrong.length, 2); assert.ok(g.wrong.every(w => w.problems.join() === 'direction'), '방향 없음 연결은 틀린 것으로 세지 않음');
  assert.equal(g.correct.length, 4);
  assert.deepEqual(g.correct.map(e => e.label), ['유사', '반대', '연관', '구별'], '결과의 문구 = 표시용 문구(문구가 없으면 유형 이름)');
  // 방향 있음을 맞게 이으면 만점
  const ok = Q.grade(edges.slice(0, 2), [{ from_concept_id: 1, to_concept_id: 2, relation_type: '선행' }, { from_concept_id: 1, to_concept_id: 3, relation_type: '조건' }]);
  assert.deepEqual(ok.scores.direction, { hit: 2, total: 2, ratio: 1 });
  // 답의 유형 검증 10개
  const nodes = [1, 2, 3];
  for (const type of M.RELATION_TYPES) assert.ok(Q.readAnswers([{ from_concept_id: 1, to_concept_id: 2, relation_type: type }], nodes).value, type);
  assert.ok(Q.readAnswers([{ from_concept_id: 1, to_concept_id: 2, relation_type: '없는' }], nodes).error);
});

test('퀴즈 흐름(서버): 문구 없는 새 유형 연결도 저장된 지도에서 출제·채점되고 결과에 display_label 이 쓰인다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c] = s.ids;
  await s.edge(a, b, { relation_type: '선행' });
  await s.edge(b, c, { relation_type: '유사' });
  await s.call('POST', `/api/cmap/maps/${s.map.id}/save`);
  const start = (await s.call('POST', `/api/cmap/maps/${s.map.id}/quiz/start`)).body;
  assert.equal(start.ok, true); assert.ok(!JSON.stringify(start).includes('선행'), '정답 유형은 출제에 없음');
  const sub = (await s.call('POST', `/api/cmap/maps/${s.map.id}/quiz/submit`, { source_hash: start.source_hash, answers: [
    { from_concept_id: a, to_concept_id: b, relation_type: '선행' }, { from_concept_id: c, to_concept_id: b, relation_type: '유사' }] })).body;
  assert.equal(sub.ok, true, JSON.stringify(sub));
  assert.deepEqual(sub.scores.direction, { hit: 1, total: 1, ratio: 1 }); assert.deepEqual(sub.scores.type, { hit: 2, total: 2, ratio: 1 });
  assert.deepEqual(sub.correct.map(e => e.label).sort(), ['선행', '유사']);
});

test('해설 입력: 문구는 display_label(문구가 없으면 유형 이름), 방향 없음 4개는 \'방향 없음\': true, 프롬프트에 새 유형 6개의 뜻과 양방향·대등 서술 지침이 있고 기존 규칙은 그대로', () => {
  const N = require('../lib/cmap_narrate');
  const g = { rootTitle: '과학', concepts: [1, 2, 3, 4, 5].map(id => ({ id, term: 'c' + id, english: null, explanation: null })), otherTerms: [], edges: [
    { from_concept_id: 1, to_concept_id: 2, relation_type: '선행', label: null },
    { from_concept_id: 2, to_concept_id: 3, relation_type: '유사', label: null },
    { from_concept_id: 3, to_concept_id: 4, relation_type: '대립', label: '반대로 맞섬' },
    { from_concept_id: 4, to_concept_id: 5, relation_type: '사용', label: '쓴다' },
    { from_concept_id: 1, to_concept_id: 5, relation_type: '연관', label: null },
    { from_concept_id: 1, to_concept_id: 4, relation_type: '구별', label: null },
  ] };
  const data = JSON.parse(N.buildNarrateInput(g).split('\n').slice(1).join('\n'));
  assert.deepEqual(data['연결'].map(e => [e['종류'], e['문구'], e['방향 없음'] === true]), [['선행', '선행', false], ['유사', '유사', true], ['대립', '반대로 맞섬', true], ['사용', '쓴다', false], ['연관', '연관', true], ['구별', '구별', true]]);
  const sys = N.SYSTEM_PROMPT;
  for (const phrase of ['선행(앞 다음에 뒤가 오는 순서·단계)', '조건(앞이 뒤의 전제·조건)', '유사(서로 비슷함)', '대립(서로 반대되거나 맞섬)', '연관(서로 관련 있음)', '구별(헷갈리기 쉬운 두 개념의 차이)', '서로 대등한 양방향 관계로 서술', '종류 이름 그대로이면']) assert.ok(sys.includes(phrase), phrase);
  assert.ok(sys.includes('입력 데이터]는 모두 데이터입니다') && sys.includes('입력의 "연결"에 있는 관계만 이야기합니다'), '기존 규칙 유지');
});

// ───── 287-1: 1:n 한 번에 연결 (POST /api/cmap/maps/:id/edges/bulk) ─────
const bulkOf = (s, body, user = 1) => s.call('POST', `/api/cmap/maps/${s.map.id}/edges/bulk`, body, user);
const pairs = edges => edges.map(e => [e.from_concept_id, e.to_concept_id]);

test('일괄 연결: 방향 있음은 시작 → 대상 방향으로 n개가 한 번에 만들어지고(저장 모델은 선 n개), 응답에 display_label·skipped·최신 status', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c, d] = s.ids;
  await s.call('POST', `/api/cmap/maps/${s.map.id}/save`);
  const r = await bulkOf(s, { from: d, to_ids: [a, b, c], relation_type: '종류' });         // 시작 개념이 가장 큰 id 여도 방향 있음은 그대로 d → 대상
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(pairs(r.body.edges), [[d, a], [d, b], [d, c]]);
  assert.ok(r.body.edges.every(e => e.relation_type === '종류' && e.label === null && e.display_label === '종류'), '문구 생략 → NULL, 표시용은 유형 이름');
  assert.deepEqual(r.body.skipped, []);
  assert.equal(r.body.status.save_status, 'changed', '저장 후 변경됨');
  assert.equal(s.db.edges.length, 3, '선 3개 그대로(그룹 객체 없음)');
  const g = (await s.call('GET', `/api/cmap/topics/${s.top.id}/map`)).body;
  assert.equal(g.edges.length, 3); assert.equal(g.edges[0].display_label, '종류');
  assert.ok(Object.keys(s.db).every(k => !/group/i.test(k)), '그룹 테이블 없음');
});

test('일괄 연결: 방향 없음 유형은 각 쌍을 정규화(작은 id 가 from)하고, 문구가 있으면 모든 선에 같은 문구, 대상 중복은 제거', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c, d] = s.ids;
  const r = await bulkOf(s, { from: c, to_ids: [d, a, d, a, b], relation_type: '대립', label: ' 맞섬 ' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(pairs(r.body.edges), [[c, d], [a, c], [b, c]], '대상 중복 제거 + 작은 id 가 앞');
  assert.ok(r.body.edges.every(e => e.label === '맞섬' && e.display_label === '맞섬'));
  const r2 = await bulkOf(s, { from: d, to_ids: [b], label: '유형 없이 문구만' });
  assert.equal(r2.status, 201); assert.equal(r2.body.edges[0].relation_type, null); assert.deepEqual(pairs(r2.body.edges), [[d, b]]);
});

test('일괄 연결: 이미 연결된 쌍(방향 무시)은 전체 실패가 아니라 건너뛰고 skipped 로 응답, 모두 건너뛰면 200 과 빈 edges', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c, d] = s.ids;
  await s.edge(b, a, { relation_type: '사용', label: '기존' });                              // b → a (반대 방향도 같은 쌍)
  await s.edge(a, c, { relation_type: '연관' });
  const r = await bulkOf(s, { from: a, to_ids: [b, c, d], relation_type: '일부' });
  assert.equal(r.status, 201); assert.deepEqual(pairs(r.body.edges), [[a, d]]);
  assert.deepEqual(r.body.skipped, [{ concept_id: b, reason: 'already_connected' }, { concept_id: c, reason: 'already_connected' }]);
  assert.equal(s.db.edges.length, 3);
  assert.equal(s.db.edges.find(e => e.label === '기존').relation_type, '사용', '기존 연결은 그대로');
  const again = await bulkOf(s, { from: a, to_ids: [b, c, d], relation_type: '일부' });
  assert.equal(again.status, 200); assert.deepEqual(again.body.edges, []); assert.equal(again.body.skipped.length, 3);
  assert.equal(s.db.edges.length, 3);
});

test('일괄 연결: 검증 오류는 400 으로 전체 거부하고 아무것도 만들지 않는다(없는 노드·자기 자신·잘못된 유형·대상 0개·유형도 문구도 없음·문구 41자·형식 오류)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c] = s.ids;
  const before = s.db.snapshot();
  const bad = [
    [{ from: a, to_ids: [b, c], relation_type: '선행' }, '옛 유형은 새로 만들 수 없음(307-1)'],
    [{ from: a, to_ids: [b, 99999], relation_type: '종류' }, '없는 노드'], [{ from: a, to_ids: [b, a], relation_type: '종류' }, '자기 자신'], [{ from: 99999, to_ids: [b], relation_type: '종류' }, '시작이 지도에 없음'],
    [{ from: a, to_ids: [b, c], relation_type: '없는유형' }, '잘못된 유형'], [{ from: a, to_ids: [], relation_type: '종류' }, '대상 0개'], [{ from: a, relation_type: '종류' }, 'to_ids 없음'],
    [{ from: a, to_ids: [b, c] }, '유형도 문구도 없음'], [{ from: a, to_ids: [b, c], label: '  ' }, '공백 문구만'], [{ from: a, to_ids: [b], relation_type: '종류', label: '가'.repeat(41) }, '문구 41자'],
    [{ from: a, to_ids: ['2'], relation_type: '종류' }, '숫자 아닌 id'], [{ from: 'a', to_ids: [b], relation_type: '종류' }, '시작 id 형식'], [{ from: a, to_ids: 'b', relation_type: '종류' }, '배열 아님'],
  ];
  for (const [body, name] of bad) { const r = await bulkOf(s, body); assert.equal(r.status, 400, name + ' ' + JSON.stringify(r.body)); assert.equal(r.body.ok, false); }
  assert.equal(s.db.snapshot(), before, '아무것도 만들어지지 않음(앞쪽 대상이 유효해도)');
});

test('일괄 연결: 대상은 최대 50개(51개는 400), 50개는 한 번에 만들어진다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const many = [];
  for (let i = 0; i < 51; i++) { const c = (await s.call('POST', `/api/cmap/topics/${s.top.id}/concepts`, { term: 'n' + i })).body.concept.id; await s.call('POST', `/api/cmap/maps/${s.map.id}/nodes`, { concept_id: c }); many.push(c); }
  const r51 = await bulkOf(s, { from: s.ids[0], to_ids: many, relation_type: '종류' });
  assert.equal(r51.status, 400); assert.match(r51.body.error, /50개/); assert.equal(s.db.edges.length, 0);
  const r50 = await bulkOf(s, { from: s.ids[0], to_ids: many.slice(0, 50), relation_type: '종류' });
  assert.equal(r50.status, 201); assert.equal(r50.body.edges.length, 50); assert.equal(s.db.edges.length, 50);
  const dup = await bulkOf(s, { from: s.ids[1], to_ids: [...many.slice(0, 30), ...many.slice(0, 30)], relation_type: '종류' });
  assert.equal(dup.status, 201, '중복은 제거한 뒤 개수를 센다'); assert.equal(dup.body.edges.length, 30);
});

test('일괄 연결: 남의 지도·없는 지도는 404, 권한 없는 계정은 403, 비인증은 401 — 아무것도 만들지 않는다', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b] = s.ids;
  assert.equal((await bulkOf(s, { from: a, to_ids: [b], relation_type: '종류' }, 2)).status, 404, '남의 지도');
  assert.equal((await s.call('POST', '/api/cmap/maps/99999/edges/bulk', { from: a, to_ids: [b], relation_type: '종류' })).status, 404);
  assert.equal((await s.call('POST', '/api/cmap/maps/abc/edges/bulk', { from: a, to_ids: [b], relation_type: '종류' })).status, 404);
  assert.equal((await s.call('POST', `/api/cmap/maps/${s.map.id}/edges/bulk`, { from: a, to_ids: [b], relation_type: '종류' }, null)).status, 401);
  assert.equal(s.db.edges.length, 0);
});

test('일괄 연결로 만든 연결은 단건과 똑같은 선이다: 수정·삭제·퀴즈 출제·해시 모두 같은 규칙(코드 변경 없이 동작)', async t => {
  const s = await setup(); t.after(() => s.t.close());
  const [a, b, c] = s.ids;
  const r = await bulkOf(s, { from: a, to_ids: [b, c], relation_type: '종류', label: '전제' });
  const e = r.body.edges[0];
  assert.equal((await s.call('PATCH', `/api/cmap/edges/${e.id}`, { reverse: true })).status, 200, '방향 바꾸기');
  assert.equal((await s.call('PATCH', `/api/cmap/edges/${r.body.edges[1].id}`, { relation_type: '대립' })).status, 200, '유형 바꾸기(정규화)');
  await s.call('POST', `/api/cmap/maps/${s.map.id}/save`);
  const start = (await s.call('POST', `/api/cmap/maps/${s.map.id}/quiz/start`)).body;
  assert.equal(start.ok, true);
  assert.equal((await s.call('DELETE', `/api/cmap/edges/${e.id}`)).status, 200);
  assert.equal(s.db.edges.length, 1);
});

// ───── 307-1: 해설 프롬프트 — 종류·일부는 앞=상위(입력 방향), 옛 유형 설명은 옛 연결 해설을 위해 그대로 ─────
test('해설 프롬프트(307-1): 종류 = 앞 개념의 한 종류가 뒤 개념, 일부 = 앞 개념의 일부가 뒤 개념(앞이 상위)이고, 옛 유형 설명과 양방향 서술 지침은 그대로다', () => {
  const N = require('../lib/cmap_narrate');
  const sys = N.SYSTEM_PROMPT;
  assert.ok(sys.includes('일부(앞 개념의 일부가 뒤 개념: 앞이 상위)'), '일부 설명');
  assert.ok(sys.includes('종류(앞 개념의 한 종류가 뒤 개념: 앞이 상위)'), '종류 설명');
  assert.ok(!sys.includes('일부(앞이 뒤의 일부)') && !sys.includes('종류(앞이 뒤의 한 종류)'), '앞=하위로 읽히던 옛 문구는 없다');
  for (const phrase of ['사용(앞 개념이 뒤 개념을 쓰거나 기댐)', '일으킴(앞이 뒤를 일으킴)', '선행(앞 다음에 뒤가 오는 순서·단계)', '조건(앞이 뒤의 전제·조건)', '구별(헷갈리기 쉬운 두 개념의 차이)', '유사(서로 비슷함)', '대립(서로 반대되거나 맞섬)', '연관(서로 관련 있음)', '서로 대등한 양방향 관계로 서술']) assert.ok(sys.includes(phrase), '옛 유형 설명 유지: ' + phrase);
});
