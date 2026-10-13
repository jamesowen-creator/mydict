// 작업271-1: 개념 지도 주제 트리·개념 API(routes/concept_map.js). 가짜 DB(tests/helpers/cmap_db.js)는 실제 PG 제약을 흉내 낸 것이다(한계).
// 실행: node --test tests/concept_map_crud.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCmapDb } = require('./helpers/cmap_db');
const { startApp } = require('./helpers/app');

async function setup() {
  const db = createCmapDb();
  db.addUser(1, { perm_concept_map: true });
  db.addUser(2, { perm_concept_map: true });
  db.addUser(3, { perm_concept_map: false });
  db.addUser(4, {});                                   // 열 값 없음 → 거부
  const t = await startApp(['routes/concept_map.js'], { db });
  const call = (method, url, body, user = 1) => t.call(method, url, body, { user });
  const topic = async (title, parent_id, user = 1) => {
    const r = await call('POST', '/api/cmap/topics', parent_id === undefined ? { title } : { title, parent_id }, user);
    assert.equal(r.status, 201, `주제 만들기 ${title}: ${JSON.stringify(r.body)}`);
    return r.body.topic;
  };
  const concept = async (topicId, term, extra = {}, user = 1) => {
    const r = await call('POST', `/api/cmap/topics/${topicId}/concepts`, { term, ...extra }, user);
    assert.equal(r.status, 201, `개념 만들기 ${term}: ${JSON.stringify(r.body)}`);
    return r.body.concept;
  };
  const list = async (user = 1) => (await call('GET', '/api/cmap/topics', undefined, user)).body.topics;
  return { db, t, call, topic, concept, list, close: () => t.close() };
}

test('권한: 비인증 401, 권한 false·값 없음 403(모든 엔드포인트), 거부된 요청은 데이터를 바꾸지 않음', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('물리');
  const c = await s.concept(a.id, '힘');
  const before = s.db.snapshot();
  const calls = [
    ['GET', '/api/cmap/topics'], ['POST', '/api/cmap/topics', { title: 'x' }], ['PATCH', `/api/cmap/topics/${a.id}`, { title: 'y' }],
    ['POST', `/api/cmap/topics/${a.id}/move`, { parent_id: null }], ['DELETE', `/api/cmap/topics/${a.id}?confirm=1`],
    ['GET', `/api/cmap/topics/${a.id}/concepts`], ['POST', `/api/cmap/topics/${a.id}/concepts`, { term: 'z' }],
    ['PATCH', `/api/cmap/concepts/${c.id}`, { term: 'w' }], ['DELETE', `/api/cmap/concepts/${c.id}`],
  ];
  for (const [m, u, b] of calls) {
    assert.equal((await s.t.call(m, u, b, { user: null })).status, 401, '비인증 ' + m + ' ' + u);
    for (const user of [3, 4]) {
      const r = await s.call(m, u, b, user);
      assert.equal(r.status, 403, `사용자 ${user} ${m} ${u}`);
      assert.equal(r.body.ok, false);
    }
  }
  assert.equal(s.db.snapshot(), before, '거부된 요청이 데이터를 바꾸지 않음');
});

test('타인 데이터 차단: 목록에 안 보이고, 수정·이동·삭제·하위 만들기·개념 접근은 모두 404이며 데이터는 그대로', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const mine = await s.topic('내 주제');
  const theirs = await s.topic('남의 주제', undefined, 2);
  const theirChild = await s.topic('남의 하위', theirs.id, 2);
  const theirConcept = await s.concept(theirs.id, '남의 개념', {}, 2);
  assert.deepEqual((await s.list(1)).map(t => t.title), ['내 주제']);
  assert.deepEqual((await s.list(2)).map(t => t.title).sort(), ['남의 주제', '남의 하위']);
  const before = s.db.snapshot();
  const attempts = [
    ['PATCH', `/api/cmap/topics/${theirs.id}`, { title: '탈취' }], ['POST', `/api/cmap/topics/${theirs.id}/move`, { parent_id: null }],
    ['POST', `/api/cmap/topics/${mine.id}/move`, { parent_id: theirs.id }], ['POST', '/api/cmap/topics', { title: '침입', parent_id: theirs.id }],
    ['DELETE', `/api/cmap/topics/${theirs.id}?confirm=1`], ['DELETE', `/api/cmap/topics/${theirChild.id}`],
    ['GET', `/api/cmap/topics/${theirs.id}/concepts`], ['POST', `/api/cmap/topics/${theirs.id}/concepts`, { term: '침입' }],
    ['PATCH', `/api/cmap/concepts/${theirConcept.id}`, { term: '탈취' }], ['DELETE', `/api/cmap/concepts/${theirConcept.id}`],
  ];
  for (const [m, u, b] of attempts) {
    const r = await s.call(m, u, b, 1);
    assert.equal(r.status, 404, `${m} ${u}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, false);
  }
  assert.equal(s.db.snapshot(), before, '타인 데이터는 바뀌지 않음');
});

test('생성: 최상위·하위의 root_id/깊이/개념 수, 응답 형식 {ok:true}, 목록은 depth·concept_count 포함', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('과학');
  assert.equal(a.root_id, null); assert.equal(a.parent_id, null); assert.equal(a.depth, 1);
  const b = await s.topic('물리', a.id);
  assert.equal(b.root_id, a.id); assert.equal(b.depth, 2);
  const c = await s.topic('역학', b.id);
  assert.equal(c.root_id, a.id, '루트는 항상 최상위 주제'); assert.equal(c.depth, 3);
  await s.concept(c.id, '힘'); await s.concept(c.id, '가속도');
  const r = await s.call('GET', '/api/cmap/topics');
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.max_depth, 5);
  const byTitle = Object.fromEntries(r.body.topics.map(t => [t.title, t]));
  assert.equal(byTitle['역학'].concept_count, 2); assert.equal(byTitle['과학'].concept_count, 0); assert.equal(byTitle['역학'].depth, 3);
});

test('입력 검증: 제목·parent_id 형식, 빈 값·공백·81자·줄바꿈·문자열 아님은 400 {ok:false,error}', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('과학');
  for (const body of [{}, { title: '' }, { title: '   ' }, { title: 5 }, { title: null }, { title: 'a'.repeat(81) }, { title: '두\n줄' },
    { title: 'ok', parent_id: 'x' }, { title: 'ok', parent_id: 1.5 }, { title: 'ok', parent_id: 0 }, { title: 'ok', parent_id: '1' }]) {
    const r = await s.call('POST', '/api/cmap/topics', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.ok, false); assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await s.call('POST', '/api/cmap/topics', { title: 'a'.repeat(80) })).status, 201, '80자는 허용');
  assert.equal((await s.call('POST', '/api/cmap/topics', { title: '😀'.repeat(80) })).status, 201, '글자 수는 코드포인트 기준');
  assert.equal((await s.call('POST', '/api/cmap/topics', { title: '😀'.repeat(81) })).status, 400);
  for (const id of ['abc', '0', '-1', '99999999999', '1.5']) assert.equal((await s.call('PATCH', `/api/cmap/topics/${id}`, { title: 'x' })).status, 404, '잘못된 id ' + id);
  assert.equal((await s.call('PATCH', `/api/cmap/topics/${a.id}`, {})).status, 400);
  assert.equal((await s.call('POST', `/api/cmap/topics/${a.id}/move`, {})).status, 400, 'parent_id 없는 이동');
  assert.equal((await s.call('POST', `/api/cmap/topics/${a.id}/move`, { parent_id: 'x' })).status, 400);
});

test('깊이: 5단계까지 허용, 6단계는 400', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  let parent;
  for (let d = 1; d <= 5; d++) parent = await s.topic('단계' + d, parent ? parent.id : undefined);
  assert.equal(parent.depth, 5);
  const r = await s.call('POST', '/api/cmap/topics', { title: '단계6', parent_id: parent.id });
  assert.equal(r.status, 400); assert.equal(r.body.ok, false); assert.match(r.body.error, /5단계/);
  assert.equal((await s.list()).length, 5);
});

test('이름 중복: 같은 부모 아래 대소문자 무시 409(최상위끼리도), 다른 부모 아래는 허용, 이름 변경도 같은 규칙', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('Physics');
  const r = await s.call('POST', '/api/cmap/topics', { title: 'physics' });
  assert.equal(r.status, 409); assert.equal(r.body.ok, false); assert.match(r.body.error, /이미 있습니다/);
  assert.equal((await s.call('POST', '/api/cmap/topics', { title: ' PHYSICS ' })).status, 409, '앞뒤 공백 제거 후 비교');
  const b = await s.topic('화학');
  await s.topic('개론', a.id);
  await s.topic('개론', b.id);                                   // 다른 부모 아래는 허용
  assert.equal((await s.call('POST', '/api/cmap/topics', { title: '개론', parent_id: a.id })).status, 409);
  assert.equal((await s.call('POST', '/api/cmap/topics', { title: 'Physics' }, 2)).status, 201, '다른 사용자와는 무관');
  // 이름 변경
  assert.equal((await s.call('PATCH', `/api/cmap/topics/${b.id}`, { title: 'PHYSICS' })).status, 409);
  const ok = await s.call('PATCH', `/api/cmap/topics/${a.id}`, { title: 'PHYSICS' });
  assert.equal(ok.status, 200, '자기 자신과는 대소문자만 바꿔도 됨'); assert.equal(ok.body.topic.title, 'PHYSICS');
  const ren = await s.call('PATCH', `/api/cmap/topics/${b.id}`, { title: '  화학 일반  ' });
  assert.equal(ren.body.topic.title, '화학 일반');
});

test('이동: 순환 거부(자기 자신·자기 하위), 가지 전체 깊이 검사, root_id 가지 전체 갱신, 최상위로 이동, 같은 위치는 변경 없음', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A'); const a1 = await s.topic('A1', a.id); const a2 = await s.topic('A2', a1.id);
  const b = await s.topic('B'); const b1 = await s.topic('B1', b.id);
  // 순환
  for (const target of [a.id, a1.id, a2.id]) {
    const r = await s.call('POST', `/api/cmap/topics/${a.id}/move`, { parent_id: target });
    assert.equal(r.status, 400, '순환 이동 거부 → ' + target); assert.equal(r.body.ok, false);
  }
  // 정상: A1(+A2) 을 B1 아래로 → root 가 B 로 바뀜
  let r = await s.call('POST', `/api/cmap/topics/${a1.id}/move`, { parent_id: b1.id });
  assert.equal(r.status, 200); assert.equal(r.body.moved, true);
  let topics = Object.fromEntries((await s.list()).map(t => [t.title, t]));
  assert.equal(topics.A1.parent_id, b1.id); assert.equal(topics.A1.root_id, b.id); assert.equal(topics.A2.root_id, b.id, '하위의 root_id 도 갱신');
  assert.equal(topics.A2.depth, 4); assert.equal(topics.A.root_id, null);
  // 최상위로 이동: root_id 는 NULL, 하위는 이 주제의 id
  r = await s.call('POST', `/api/cmap/topics/${a1.id}/move`, { parent_id: null });
  assert.equal(r.status, 200);
  topics = Object.fromEntries((await s.list()).map(t => [t.title, t]));
  assert.equal(topics.A1.parent_id, null); assert.equal(topics.A1.root_id, null); assert.equal(topics.A2.root_id, a1.id); assert.equal(topics.A2.depth, 2);
  // 같은 위치로 이동 = 변경 없음
  r = await s.call('POST', `/api/cmap/topics/${a2.id}/move`, { parent_id: a1.id });
  assert.equal(r.status, 200); assert.equal(r.body.moved, false);
});

test('이동 깊이: 이동하는 가지의 가장 깊은 하위까지 포함해 5단계를 넘으면 거부(전체 변경 없음)', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const x = await s.topic('X'); const x1 = await s.topic('X1', x.id); const x2 = await s.topic('X2', x1.id);   // 높이 3
  let p = await s.topic('P1'); p = await s.topic('P2', p.id); p = await s.topic('P3', p.id);                      // P3 깊이 3
  const before = s.db.snapshot();
  let r = await s.call('POST', `/api/cmap/topics/${x.id}/move`, { parent_id: p.id });                              // 3 + 3 = 6 > 5
  assert.equal(r.status, 400); assert.match(r.body.error, /5단계/);
  assert.equal(s.db.snapshot(), before);
  const p2 = (await s.list()).find(t => t.title === 'P2');
  r = await s.call('POST', `/api/cmap/topics/${x.id}/move`, { parent_id: p2.id });                                // 2 + 3 = 5 → 허용
  assert.equal(r.status, 200);
  assert.equal((await s.list()).find(t => t.title === 'X2').depth, 5);
});

test('이동 이름 중복: 옮길 위치에 같은 이름이 있으면 409, 아무것도 바뀌지 않음', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A'); const b = await s.topic('B');
  const ax = await s.topic('개론', a.id); await s.topic('개론', b.id); await s.topic('세부', ax.id);
  const before = s.db.snapshot();
  const r = await s.call('POST', `/api/cmap/topics/${ax.id}/move`, { parent_id: b.id });
  assert.equal(r.status, 409); assert.match(r.body.error, /개론/);
  assert.equal(s.db.snapshot(), before);
});

test('하위 주제 삭제: 하위 주제와 개념을 부모로 올린 뒤 삭제(root_id·깊이 유지), 개념 수 보존', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A'); const b = await s.topic('B', a.id); const c = await s.topic('C', b.id); const d = await s.topic('D', b.id);
  await s.concept(b.id, 'b1'); await s.concept(b.id, 'b2'); await s.concept(a.id, 'a1'); await s.concept(c.id, 'c1');
  const r = await s.call('DELETE', `/api/cmap/topics/${b.id}`);
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.moved, { topics: 2, concepts: 2 }); assert.equal(r.body.parent_id, a.id);
  const topics = Object.fromEntries((await s.list()).map(t => [t.title, t]));
  assert.equal(topics.B, undefined, '삭제됨');
  assert.equal(topics.C.parent_id, a.id); assert.equal(topics.D.parent_id, a.id); assert.equal(topics.C.root_id, a.id); assert.equal(topics.C.depth, 2);
  assert.equal(topics.A.concept_count, 3, '개념 b1, b2, a1 이 A 에 모임'); assert.equal(topics.C.concept_count, 1, '더 아래 개념은 그대로');
  assert.equal((await s.call('GET', `/api/cmap/topics/${a.id}/concepts`)).body.concepts.length, 3);
  assert.equal(s.db.concepts.length, 4, '개념은 하나도 지워지지 않음');
});

test('하위 주제 삭제 이름 겹침: 하위 주제·개념 이름이 부모 쪽과 겹치면 409와 겹치는 이름을 알려 주고 아무것도 바뀌지 않음(자동 개명 없음)', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A'); const b = await s.topic('B', a.id); const c = await s.topic('공통', b.id); await s.topic('공통', a.id);
  await s.concept(b.id, '속도'); await s.concept(a.id, '속도'); await s.concept(b.id, '가속도');
  const before = s.db.snapshot();
  const r = await s.call('DELETE', `/api/cmap/topics/${b.id}`);
  assert.equal(r.status, 409); assert.equal(r.body.ok, false);
  assert.deepEqual(r.body.conflicts, { topics: ['공통'], concepts: ['속도'] });
  assert.match(r.body.error, /'공통'/); assert.match(r.body.error, /'속도'/); assert.doesNotMatch(r.body.error, /가속도/);
  assert.equal(s.db.snapshot(), before, '이름이 자동으로 바뀌거나 일부만 옮겨지지 않음');
  // 겹치는 이름을 고치면 삭제됨 (대소문자만 다른 경우도 겹침으로 본다)
  await s.call('PATCH', `/api/cmap/topics/${c.id}`, { title: '공통 이론' });
  const conceptId = s.db.concepts.find(x => x.term === '속도' && x.topic_id === b.id).id;
  await s.call('PATCH', `/api/cmap/concepts/${conceptId}`, { term: '순간 속도' });
  assert.equal((await s.call('DELETE', `/api/cmap/topics/${b.id}`)).status, 200);
});

test('최상위 주제 삭제: confirm 없으면 409 + 항목 개수, confirm=1 이면 그 트리만 전부 삭제(다른 트리·다른 사용자 유지)', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A'); const a1 = await s.topic('A1', a.id); const a2 = await s.topic('A2', a1.id);
  await s.concept(a.id, 'x'); await s.concept(a2.id, 'y'); await s.concept(a2.id, 'z');
  const other = await s.topic('다른 트리'); await s.concept(other.id, 'keep');
  const theirs = await s.topic('A', undefined, 2); await s.concept(theirs.id, 'keep2', {}, 2);
  const before = s.db.snapshot();
  let r = await s.call('DELETE', `/api/cmap/topics/${a.id}`);
  assert.equal(r.status, 409); assert.equal(r.body.ok, false); assert.equal(r.body.needs_confirm, true);
  assert.deepEqual(r.body.counts, { topics: 2, concepts: 3 });
  assert.equal(s.db.snapshot(), before, '확인 없이는 아무것도 지워지지 않음');
  for (const q of ['?confirm=0', '?confirm=true', '?confirm=']) assert.equal((await s.call('DELETE', `/api/cmap/topics/${a.id}${q}`)).status, 409, q);
  r = await s.call('DELETE', `/api/cmap/topics/${a.id}?confirm=1`);
  assert.equal(r.status, 200); assert.deepEqual(r.body.deleted_counts, { topics: 2, concepts: 3 });
  assert.deepEqual((await s.list()).map(t => t.title), ['다른 트리']);
  assert.deepEqual(s.db.concepts.filter(c => c.user_id === 1).map(c => c.term), ['keep']);
  assert.equal(s.db.topics.filter(t => t.user_id === 2).length, 1, '다른 사용자 데이터 유지'); assert.equal(s.db.concepts.filter(c => c.user_id === 2).length, 1);
});

test('트랜잭션: 삭제·이동 도중 오류가 나면 전부 되돌려지고 500 {ok:false}', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A'); const b = await s.topic('B', a.id); await s.topic('C', b.id); await s.concept(b.id, 'k');
  const before = s.db.snapshot();
  s.db.failOn = /^DELETE FROM cmap_topics WHERE id = \$1/;
  let r = await s.call('DELETE', `/api/cmap/topics/${b.id}`);
  assert.equal(r.status, 500); assert.equal(r.body.ok, false);
  assert.equal(s.db.snapshot(), before, '하위 삭제 중간 실패 → 올려 둔 하위 주제·개념도 원상 복구');
  s.db.failOn = /^UPDATE cmap_topics SET root_id/;
  const x = await s.topic('X'); const y = await s.topic('Y', x.id); await s.topic('Z', y.id);
  const before2 = s.db.snapshot();
  r = await s.call('POST', `/api/cmap/topics/${y.id}/move`, { parent_id: null });
  assert.equal(r.status, 500);
  assert.equal(s.db.snapshot(), before2, '이동 중간 실패 → 원상 복구');
  s.db.failOn = null;
});

test('개념 CRUD: 생성(기본 manual)·목록 순서·수정(부분)·삭제, english/memo 지우기, 같은 주제 안 이름 중복(대소문자 무시) 409, 다른 주제는 허용', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A'); const b = await s.topic('B');
  const c1 = await s.concept(a.id, 'Force', { english: 'force', memo: '질량 × 가속도' });
  assert.equal(c1.content_source, 'manual'); assert.equal(c1.english, 'force'); assert.equal(c1.memo, '질량 × 가속도');
  const c2 = await s.concept(a.id, '운동량');
  assert.equal(c2.english, null); assert.equal(c2.memo, null);
  assert.equal((await s.call('POST', `/api/cmap/topics/${a.id}/concepts`, { term: 'FORCE' })).status, 409);
  assert.equal((await s.call('POST', `/api/cmap/topics/${b.id}/concepts`, { term: 'force' })).status, 201, '다른 주제는 허용');
  const list = (await s.call('GET', `/api/cmap/topics/${a.id}/concepts`)).body;
  assert.equal(list.ok, true); assert.equal(list.topic.title, 'A'); assert.deepEqual(list.concepts.map(c => c.term), ['Force', '운동량']);
  // 부분 수정
  let r = await s.call('PATCH', `/api/cmap/concepts/${c2.id}`, { memo: '질량 × 속도' });
  assert.equal(r.status, 200); assert.equal(r.body.concept.term, '운동량'); assert.equal(r.body.concept.memo, '질량 × 속도');
  r = await s.call('PATCH', `/api/cmap/concepts/${c1.id}`, { english: null, memo: '' });
  assert.equal(r.body.concept.english, null); assert.equal(r.body.concept.memo, null); assert.equal(r.body.concept.term, 'Force');
  assert.equal((await s.call('PATCH', `/api/cmap/concepts/${c2.id}`, { term: 'force' })).status, 409, '수정으로도 중복 불가');
  assert.equal((await s.call('PATCH', `/api/cmap/concepts/${c1.id}`, { term: 'FORCE' })).status, 200, '자기 자신과는 대소문자만 바꿔도 됨');
  assert.equal((await s.call('PATCH', `/api/cmap/concepts/${c1.id}`, {})).status, 400);
  assert.equal((await s.call('DELETE', `/api/cmap/concepts/${c1.id}`)).status, 200);
  assert.equal((await s.call('DELETE', `/api/cmap/concepts/${c1.id}`)).status, 404);
});

test('개념 입력 검증: 빈 이름·81자·영문 121자·메모 2001자·형식 오류는 400, 경계값은 허용', async t => {
  const s = await setup();
  t.after(() => s.close());   // 단언이 실패해도 서버를 닫는다
  const a = await s.topic('A');
  const url = `/api/cmap/topics/${a.id}/concepts`;
  for (const body of [{}, { term: '' }, { term: '  ' }, { term: 7 }, { term: 'a'.repeat(81) }, { term: '줄\n바꿈' },
    { term: 'ok', english: 'e'.repeat(121) }, { term: 'ok', english: 5 }, { term: 'ok', english: '두\n줄' }, { term: 'ok', memo: 'm'.repeat(2001) }, { term: 'ok', memo: {} }]) {
    const r = await s.call('POST', url, body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60)); assert.equal(r.body.ok, false);
  }
  const edge = await s.call('POST', url, { term: 'a'.repeat(80), english: 'e'.repeat(120), memo: '가\n나'.padEnd(2000, 'm') });
  assert.equal(edge.status, 201);
  assert.match(edge.body.concept.memo, /가\n나/, '메모는 줄바꿈 허용');
  assert.equal((await s.call('POST', '/api/cmap/topics/9999/concepts', { term: 'x' })).status, 404);
  assert.equal((await s.call('PATCH', '/api/cmap/concepts/abc', { term: 'x' })).status, 404);
});
