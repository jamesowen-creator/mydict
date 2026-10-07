// 작업194-1: 개념학습 DB·권한·이전·기본 API (AI 없음). 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockDb } = require('./helpers/mock_db');
const { startApp } = require('./helpers/app');
// 실제 lib/db는 모의 로더가 켜지기 전에 한 번만 불러 둔다(startApp이 lib/db를 모의로 바꾸므로)
const realDb = require('../lib/db');
const { migrateVoiceConcepts, migrateVoiceConceptsV2 } = realDb;

async function setup() {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const t = await startApp(['routes/concept_study.js'], { db });
  return { db, t, call: t.call, close: t.close };
}

const S = '/api/concepts/studies';

test('401: 토큰 없이 모든 경로', async () => {
  const { call, close } = await setup();
  for (const [m, u, b] of [['GET', S], ['POST', S, { topic: 'a' }], ['GET', S + '/1'], ['PATCH', S + '/1', { topic: 'a' }], ['DELETE', S + '/1'],
    ['POST', S + '/1/items', { term: 'a' }], ['PATCH', '/api/concepts/items/1', { note: 'a' }], ['DELETE', '/api/concepts/items/1'],
    ['POST', S + '/1/links', {}], ['DELETE', '/api/concepts/links/1']]) {
    const r = await call(m, u, b, { user: null });
    assert.equal(r.status, 401, m + ' ' + u);
  }
  await close();
});

test('403: perm_concept_study 꺼짐·차단 사용자', async () => {
  const { db, call, close } = await setup();
  db.addUser(9, { perm_concept_study: false });
  db.addUser(10, { is_blocked: true });
  for (const u of [9, 10]) {
    for (const [m, url, b] of [['GET', S], ['POST', S, { topic: 'a' }], ['GET', S + '/1'], ['POST', S + '/1/items', { term: 'a' }], ['DELETE', '/api/concepts/links/1']]) {
      assert.equal((await call(m, url, b, { user: u })).status, 403, `${u} ${m} ${url}`);
    }
  }
  assert.equal((await call('GET', S, undefined, { user: 7 })).status, 200);
  await close();
});

test('라우트 순서: 고정 경로가 :id에 잡히지 않고 숫자가 아닌 id는 404', async () => {
  const { call, close } = await setup();
  const r = await call('GET', S);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.equal((await call('GET', S + '/abc')).status, 404);
  assert.equal((await call('GET', S + '/0')).status, 404);
  assert.equal((await call('GET', S + '/99999999999')).status, 404);
  await close();
});

test('분야: 생성·검증·사용자당 20개 상한·목록·수정·삭제', async () => {
  const { db, call, close } = await setup();
  let r = await call('POST', S, { topic: '  광합성 정리  ' });
  assert.equal(r.status, 201);
  assert.equal(r.body.topic, '광합성 정리');
  assert.equal(r.body.item_count, 0);
  assert.ok(!('user_id' in r.body));
  const id = r.body.id;
  for (const bad of [{}, { topic: '' }, { topic: '   ' }, { topic: 5 }, { topic: 'a'.repeat(81) }]) {
    assert.equal((await call('POST', S, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('POST', S, { topic: 'a'.repeat(80) })).status, 201);
  for (let i = 0; i < 18; i++) assert.equal((await call('POST', S, { topic: '분야' + i })).status, 201);
  r = await call('POST', S, { topic: '21번째' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /20/);
  assert.equal((await call('POST', S, { topic: '다른 사용자' }, { user: 8 })).status, 201);
  r = await call('GET', S);
  assert.equal(r.body.length, 20);
  assert.ok(r.body.every(x => !('user_id' in x)));
  r = await call('PATCH', `${S}/${id}`, { topic: '새 이름' });
  assert.equal(r.status, 200); assert.equal(r.body.topic, '새 이름');
  assert.equal((await call('PATCH', `${S}/${id}`, {})).status, 400);
  assert.equal((await call('PATCH', `${S}/${id}`, { topic: '' })).status, 400);
  assert.equal((await call('PATCH', `${S}/${id}`, { selected_item_id: 'x1' })).status, 400);
  r = await call('DELETE', `${S}/${id}`);
  assert.equal(r.status, 200);
  assert.equal((await call('DELETE', `${S}/${id}`)).status, 404);
  assert.equal(db.tables.concept_studies.some(s => s.id === id), false);
  await close();
});

test('소유자 분리: 남의 학습·개념·연결은 404', async () => {
  const { call, close } = await setup();
  const study = (await call('POST', S, { topic: 'A' })).body;
  const a = (await call('POST', `${S}/${study.id}/items`, { term: '가' })).body;
  const b = (await call('POST', `${S}/${study.id}/items`, { term: '나' })).body;
  const link = (await call('POST', `${S}/${study.id}/links`, { from_item_id: a.id, to_item_id: b.id })).body;
  const other = { user: 8 };
  for (const [m, u, body] of [
    ['GET', `${S}/${study.id}`], ['PATCH', `${S}/${study.id}`, { topic: 'x' }], ['DELETE', `${S}/${study.id}`],
    ['POST', `${S}/${study.id}/items`, { term: '다' }], ['PATCH', `/api/concepts/items/${a.id}`, { note: 'x' }], ['DELETE', `/api/concepts/items/${a.id}`],
    ['POST', `${S}/${study.id}/links`, { from_item_id: a.id, to_item_id: b.id }], ['DELETE', `/api/concepts/links/${link.id}`]]) {
    assert.equal((await call(m, u, body, other)).status, 404, m + ' ' + u);
  }
  // 소유자에게는 그대로 남아 있다
  const got = await call('GET', `${S}/${study.id}`);
  assert.equal(got.body.items.length, 2);
  assert.equal(got.body.links.length, 1);
  // 내 학습에 남의 개념으로 연결하기도 막힌다
  const mine = (await call('POST', S, { topic: 'B' }, other)).body;
  assert.equal((await call('POST', `${S}/${mine.id}/links`, { from_item_id: a.id, to_item_id: b.id }, other)).status, 404);
  await close();
});

test('개념 추가: 검증·중복 409(공백·대소문자 무시)·학습당 60개 상한', async () => {
  const { db, call, close } = await setup();
  const sid = (await call('POST', S, { topic: 'A' })).body.id;
  const other = (await call('POST', S, { topic: 'B' })).body.id;
  let r = await call('POST', `${S}/${sid}/items`, { term: '  Photo Synthesis ', origin: '직접 시작' });
  assert.equal(r.status, 201);
  assert.equal(r.body.term, 'Photo Synthesis');
  assert.equal(r.body.origin, '직접 시작');
  assert.equal(r.body.status, 'active'); assert.equal(r.body.review_state, 'new'); assert.equal(r.body.content_source, 'none');
  assert.ok(!('user_id' in r.body));
  assert.equal(db.tables.concept_items[0].term_key, 'photosynthesis');
  assert.equal((await call('POST', `${S}/${sid}/items`, { term: 'photosynthesis' })).status, 409);
  assert.equal((await call('POST', `${S}/${sid}/items`, { term: 'PHOTO  synthesis' })).status, 409);
  assert.equal((await call('POST', `${S}/${other}/items`, { term: 'photosynthesis' })).status, 201, '다른 학습에서는 같은 용어 가능');
  assert.equal((await call('POST', `${S}/${sid}/items`, { term: '기본 출처' })).body.origin, '직접 입력');
  for (const bad of [{}, { term: '' }, { term: '  ' }, { term: 5 }, { term: 'a'.repeat(81) }, { term: 'ok', origin: 5 }, { term: 'ok', origin: 'x'.repeat(31) }]) {
    assert.equal((await call('POST', `${S}/${sid}/items`, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('POST', `${S}/${sid}/items`, { term: 'a'.repeat(80) })).status, 201);
  assert.equal((await call('POST', `${S}/99999/items`, { term: 'x' })).status, 404);
  // 활성·보류·제외 모두 60개에 포함
  const n = db.tables.concept_items.filter(i => i.study_id === sid).length;
  for (let i = n; i < 60; i++) {
    const rr = await call('POST', `${S}/${sid}/items`, { term: '채움' + i });
    assert.equal(rr.status, 201);
    if (i % 3 === 0) await call('PATCH', `/api/concepts/items/${rr.body.id}`, { status: 'held' });
    if (i % 3 === 1) await call('PATCH', `/api/concepts/items/${rr.body.id}`, { status: 'excluded' });
  }
  r = await call('POST', `${S}/${sid}/items`, { term: '61번째' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /60/);
  await close();
});

test('개념 수정: 필드 검증·본문 수정 시 content_source user·중복 409', async () => {
  const { call, close } = await setup();
  const sid = (await call('POST', S, { topic: 'A' })).body.id;
  const a = (await call('POST', `${S}/${sid}/items`, { term: '가' })).body;
  const b = (await call('POST', `${S}/${sid}/items`, { term: '나' })).body;
  const url = id => `/api/concepts/items/${id}`;
  let r = await call('PATCH', url(a.id), { note: '메모', status: 'held', review_state: 'confused', group_label: ' 그룹1 ' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.note, r.body.status, r.body.review_state, r.body.group_label, r.body.content_source], ['메모', 'held', 'confused', '그룹1', 'none']);
  for (const f of ['definition', 'example', 'simple_text', 'deeper_text']) {
    r = await call('PATCH', url(a.id), { [f]: '내용' });
    assert.equal(r.status, 200, f);
    assert.equal(r.body[f], '내용');
    assert.equal(r.body.content_source, 'user', f);
  }
  r = await call('PATCH', url(a.id), { definition: '' });
  assert.equal(r.body.definition, null);
  r = await call('PATCH', url(b.id), { term: ' 다 ' });
  assert.equal(r.status, 200); assert.equal(r.body.term, '다');
  assert.equal((await call('PATCH', url(b.id), { term: '가' })).status, 409);
  assert.equal((await call('PATCH', url(a.id), { term: ' 가 ' })).status, 200, '자기 자신과 같은 용어는 허용');
  for (const bad of [{}, { term: '' }, { term: 'a'.repeat(81) }, { group_label: 'g'.repeat(31) }, { definition: 'x'.repeat(2001) }, { example: 'x'.repeat(1001) },
    { simple_text: 5 }, { status: 'gone' }, { review_state: 'known' }, { note: 'n'.repeat(2001) }, { note: 5 }]) {
    assert.equal((await call('PATCH', url(a.id), bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('PATCH', url(99999), { note: 'x' })).status, 404);
  assert.equal((await call('PATCH', url('abc'), { note: 'x' })).status, 404);
  await close();
});

test('연결: 방향 무관 중복 409·자기 연결·다른 학습 개념·검증·삭제', async () => {
  const { call, close } = await setup();
  const s1 = (await call('POST', S, { topic: 'A' })).body.id;
  const s2 = (await call('POST', S, { topic: 'B' })).body.id;
  const a = (await call('POST', `${S}/${s1}/items`, { term: '가' })).body;
  const b = (await call('POST', `${S}/${s1}/items`, { term: '나' })).body;
  const c = (await call('POST', `${S}/${s1}/items`, { term: '다' })).body;
  const x = (await call('POST', `${S}/${s2}/items`, { term: '엑스' })).body;
  const post = body => call('POST', `${S}/${s1}/links`, body);
  let r = await post({ from_item_id: a.id, to_item_id: b.id, relation_type: '원인→결과', label: '때문에', detail: '설명' });
  assert.equal(r.status, 201);
  assert.equal(r.body.source, 'user'); assert.equal(r.body.relation_type, '원인→결과');
  assert.ok(!('user_id' in r.body));
  assert.equal((await post({ from_item_id: a.id, to_item_id: b.id })).status, 409);
  assert.equal((await post({ from_item_id: b.id, to_item_id: a.id })).status, 409, '반대 방향도 중복');
  assert.equal((await post({ from_item_id: a.id, to_item_id: c.id })).body.relation_type, '기타 관련');
  assert.equal((await post({ from_item_id: a.id, to_item_id: a.id })).status, 400);
  assert.equal((await post({ from_item_id: a.id, to_item_id: x.id })).status, 404, '다른 학습의 개념');
  assert.equal((await post({ from_item_id: a.id, to_item_id: 99999 })).status, 404);
  for (const bad of [{}, { from_item_id: a.id }, { from_item_id: 'a', to_item_id: 'b' }, { from_item_id: String(a.id), to_item_id: String(c.id) },
    { from_item_id: b.id, to_item_id: c.id, relation_type: '없음' }, { from_item_id: b.id, to_item_id: c.id, label: 'x'.repeat(41) },
    { from_item_id: b.id, to_item_id: c.id, detail: 'x'.repeat(301) }]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  }
  for (const type of ['포함', '순서', '대비', '비슷함', '기타 관련']) {
    const d = (await call('POST', `${S}/${s1}/items`, { term: 'n' + type })).body;
    assert.equal((await post({ from_item_id: b.id, to_item_id: d.id, relation_type: type })).status, 201, type);
  }
  const lid = (await call('GET', `${S}/${s1}`)).body.links[0].id;
  assert.equal((await call('DELETE', `/api/concepts/links/${lid}`)).status, 200);
  assert.equal((await call('DELETE', `/api/concepts/links/${lid}`)).status, 404);
  assert.equal((await post({ from_item_id: b.id, to_item_id: a.id })).status, 201, '삭제 뒤에는 다시 만들 수 있음');
  await close();
});

test('상세: 제안은 이미 있는 개념·보류·제외 용어를 걸러서 내려줌 + selected_item_id', async () => {
  const { db, call, close } = await setup();
  const sid = (await call('POST', S, { topic: 'A' })).body.id;
  const a = (await call('POST', `${S}/${sid}/items`, { term: '기준' })).body;
  const act = (await call('POST', `${S}/${sid}/items`, { term: '활성 개념' })).body;
  const held = (await call('POST', `${S}/${sid}/items`, { term: '보류 개념' })).body;
  const excl = (await call('POST', `${S}/${sid}/items`, { term: '제외 개념' })).body;
  await call('PATCH', `/api/concepts/items/${held.id}`, { status: 'held' });
  await call('PATCH', `/api/concepts/items/${excl.id}`, { status: 'excluded' });
  db.tables.concept_items.find(i => i.id === a.id).suggestions = [
    { term: '활성  개념' }, { term: '보류 개념' }, { term: '제외 개념' }, { term: '새 개념', reason: '이유' }, { term: 'NEW2' }];
  const r = await call('GET', `${S}/${sid}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.find(i => i.id === a.id).suggestions.map(s => s.term), ['새 개념', 'NEW2']);
  assert.deepEqual(r.body.items.find(i => i.id === act.id).suggestions, []);
  assert.ok(r.body.items.every(i => !('user_id' in i)));
  // selected_item_id
  let p = await call('PATCH', `${S}/${sid}`, { selected_item_id: a.id });
  assert.equal(p.status, 200); assert.equal(p.body.selected_item_id, a.id);
  const sid2 = (await call('POST', S, { topic: 'B' })).body.id;
  assert.equal((await call('PATCH', `${S}/${sid2}`, { selected_item_id: a.id })).status, 404, '다른 학습의 개념은 선택 불가');
  p = await call('PATCH', `${S}/${sid}`, { selected_item_id: null });
  assert.equal(p.body.selected_item_id, null);
  await close();
});

test('삭제 연쇄: 개념 삭제 시 연결·선택 정리, 학습 삭제 시 개념·연결 삭제', async () => {
  const { db, call, close } = await setup();
  const sid = (await call('POST', S, { topic: 'A' })).body.id;
  const a = (await call('POST', `${S}/${sid}/items`, { term: '가' })).body;
  const b = (await call('POST', `${S}/${sid}/items`, { term: '나' })).body;
  const c = (await call('POST', `${S}/${sid}/items`, { term: '다' })).body;
  await call('POST', `${S}/${sid}/links`, { from_item_id: a.id, to_item_id: b.id });
  await call('POST', `${S}/${sid}/links`, { from_item_id: c.id, to_item_id: a.id });
  await call('POST', `${S}/${sid}/links`, { from_item_id: b.id, to_item_id: c.id });
  await call('PATCH', `${S}/${sid}`, { selected_item_id: a.id });
  assert.equal((await call('DELETE', `/api/concepts/items/${a.id}`)).status, 200);
  assert.equal(db.tables.concept_links.length, 1, 'a가 들어간 연결 2개 삭제');
  assert.equal(db.tables.concept_studies[0].selected_item_id, null);
  assert.equal((await call('DELETE', `/api/concepts/items/${a.id}`)).status, 404);
  assert.equal((await call('DELETE', `${S}/${sid}`)).status, 200);
  assert.equal(db.tables.concept_items.length, 0);
  assert.equal(db.tables.concept_links.length, 0);
  await close();
});

// ─── 이전(voice_concepts → 개념학습) ────────────────────────────────────────────

function vc(db, o) {
  const id = db.seq.voice_concepts++;
  db.tables.voice_concepts.push({ id, user_id: 7, term: 't' + id, explanation: '', subject: '과학', subject_detail: null, topic: '주제', subtopic: null,
    last_rating: null, rated_at: null, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date(), ...o });
  return id;
}

test('이전: (과목·세부 과목, 대주제) 묶음마다 학습 1개, 설명·평가 변환', async () => {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const a = vc(db, { term: '광합성', explanation: '빛으로 포도당을 만든다', subject: '과학', subject_detail: '생물', topic: '식물', subtopic: '에너지', last_rating: 'known' });
  const b = vc(db, { term: '엽록체', explanation: '', subject: '과학', subject_detail: '생물', topic: '식물', subtopic: null, last_rating: 'confused' });
  const c = vc(db, { term: '뉴턴', explanation: '힘', subject: '과학', subject_detail: '물리', topic: '식물' });   // 세부 과목이 다르면 다른 묶음
  const d = vc(db, { term: '함수', subject: '수학', subject_detail: null, topic: '식물' });
  const e = vc(db, { term: '타인', user_id: 8, subject: '과학', subject_detail: '생물', topic: '식물', explanation: '남의 것' });
  const before = JSON.stringify(db.tables.voice_concepts);
  const r = await migrateVoiceConcepts(db.client);
  assert.deepEqual([r.studies, r.items], [4, 5]);
  assert.equal(JSON.stringify(db.tables.voice_concepts), before, '원본 불변');
  const topics = db.tables.concept_studies.map(s => `${s.user_id}:${s.topic}`).sort();
  assert.deepEqual(topics, ['7:과학·물리 / 식물', '7:과학·생물 / 식물', '7:수학 / 식물', '8:과학·생물 / 식물'].sort());
  const item = id => db.tables.concept_items.find(i => i.legacy_voice_concept_id === id);
  assert.deepEqual([item(a).term, item(a).definition, item(a).content_source, item(a).group_label, item(a).review_state, item(a).origin], ['광합성', '빛으로 포도당을 만든다', 'user', '에너지', 'understood', '이전됨']);
  assert.deepEqual([item(b).definition, item(b).content_source, item(b).group_label, item(b).review_state], [null, 'none', null, 'confused']);
  assert.equal(item(d).review_state, 'new');
  assert.equal(item(a).study_id, item(b).study_id);
  assert.notEqual(item(a).study_id, item(c).study_id);
  assert.equal(item(e).user_id, 8);
  assert.equal(db.tables.concept_studies.find(s => s.id === item(e).study_id).user_id, 8);
  assert.equal(item(a).term_key, '광합성');
});

test('이전: 반복 실행 안전·원본 id 중복 방지·완료 표시', async () => {
  const db = createMockDb();
  db.addUser(7);
  vc(db, { term: 'a' }); vc(db, { term: 'b' });
  await migrateVoiceConcepts(db.client);
  assert.equal(db.tables.concept_items.length, 2);
  const again = await migrateVoiceConcepts(db.client);
  assert.equal(again.skipped, true);
  vc(db, { term: 'c' });
  await migrateVoiceConcepts(db.client);
  assert.equal(db.tables.concept_items.length, 2, '완료 표시가 있으면 다시 하지 않음');
  assert.equal(db.tables.concept_studies.length, 1);
  // 완료 표시가 없어도 원본 id가 이미 있는 행은 건너뛴다
  db.tables.concept_migrations = [];
  const r = await migrateVoiceConcepts(db.client);
  assert.equal(r.items, 1);
  assert.equal(db.tables.concept_items.filter(i => i.legacy_voice_concept_id !== null).length, 3);
  assert.equal(new Set(db.tables.concept_items.map(i => i.legacy_voice_concept_id)).size, 3);
});

test('이전: 사용자 삭제 후 재시작해도 되살아나지 않음', async () => {
  const db = createMockDb();
  db.addUser(7);
  vc(db, { term: 'a' }); vc(db, { term: 'b' });
  await migrateVoiceConcepts(db.client);
  db.tables.concept_items.splice(0, 1);
  await migrateVoiceConcepts(db.client);
  assert.equal(db.tables.concept_items.length, 1);
});

test('이전: 20개·60개 상한은 적용하지 않고, 같은 학습 안 중복 용어·긴 값은 안전하게 처리', async () => {
  const db = createMockDb();
  db.addUser(7);
  for (let i = 0; i < 70; i++) vc(db, { term: '개념' + i, topic: '큰주제' });                 // 한 묶음에 70개
  for (let i = 0; i < 25; i++) vc(db, { term: 'x', topic: '주제' + i });                      // 25개 묶음
  vc(db, { term: '중복', topic: '큰주제', subtopic: '가' }); vc(db, { term: ' 중 복 ', topic: '큰주제', subtopic: '나' });
  vc(db, { term: '긴', topic: 't'.repeat(100), subtopic: 's'.repeat(50) });
  const r = await migrateVoiceConcepts(db.client);
  assert.equal(r.studies, 27);
  assert.equal(r.skippedDup, 1);
  assert.equal(db.tables.concept_items.filter(i => i.study_id === db.tables.concept_studies[0].id).length, 72 - 1);
  const long = db.tables.concept_studies.find(s => s.topic.startsWith('과학 / tttt'));
  assert.equal(Array.from(long.topic).length, 80);
  assert.equal(db.tables.concept_items.find(i => i.study_id === long.id).group_label.length, 30);
});

test('이전: 오류가 나면 롤백하고 던지지 않으며, initDB는 계속 진행(서버 시작 지속)', async () => {
  const db = createMockDb();
  db.addUser(7);
  vc(db, { term: 'a' });
  db.failOn = /INSERT INTO concept_items/;
  const origErr = console.error; const logs = []; console.error = (...a) => logs.push(a.join(' '));
  let r;
  try { r = await migrateVoiceConcepts(db.client); } finally { console.error = origErr; }
  assert.equal(r.error, true);
  assert.equal(db.tables.concept_studies.length, 0, '롤백');
  assert.equal(db.tables.concept_migrations.length, 0, '완료 표시 없음 → 다음 시작에 다시 시도');
  assert.ok(logs.some(l => /concept migration failed/.test(l)));
  // initDB 전체: 이전이 실패해도 resolve
  const real = realDb;
  const origConnect = real.pool.connect;
  real.pool.connect = async () => db.client;
  const origLog = console.log; console.log = () => {}; console.error = () => {};
  try { await real.initDB(); } finally { real.pool.connect = origConnect; console.log = origLog; console.error = origErr; }
  db.failOn = null;
  await migrateVoiceConcepts(db.client);
  assert.equal(db.tables.concept_items.length, 1, '실패 뒤 다시 시도하면 이전됨');
});

test('initDB: 새 테이블·고유 인덱스·권한 컬럼 DDL과 이전 호출 순서', async () => {
  const db = createMockDb();
  db.addUser(7);
  vc(db, { term: 'a' });
  const real = realDb;
  const origConnect = real.pool.connect; real.pool.connect = async () => db.client;
  const origLog = console.log; console.log = () => {};
  try { await real.initDB(); } finally { real.pool.connect = origConnect; console.log = origLog; }
  const ddl = db.queries.map(q => q.sql).join('\n');
  for (const re of [/CREATE TABLE IF NOT EXISTS concept_studies/, /CREATE TABLE IF NOT EXISTS concept_items/, /CREATE TABLE IF NOT EXISTS concept_links/,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_items_study_term ON concept_items\(study_id, term_key\)/,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_items_legacy ON concept_items\(legacy_voice_concept_id\)/,
    /ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_concept_study BOOLEAN NOT NULL DEFAULT true/,
    /ON DELETE CASCADE/, /status IN \('active','held','excluded'\)/, /relation_type IN \('포함','원인→결과','순서','대비','비슷함','기타 관련'\)/]) {
    assert.match(ddl, re);
  }
  assert.ok(ddl.indexOf('CREATE TABLE IF NOT EXISTS concept_items') < ddl.indexOf('FROM voice_concepts'), '테이블을 만든 뒤 이전');
  assert.equal(db.tables.concept_items.length, 1);
});

// ─── 작업196-3: 194 이후 재이전(v2) ────────────────────────────────────────────────

const V1_DONE = new Date('2026-02-01T00:00:00Z');
const AFTER_V1 = new Date('2026-03-01T00:00:00Z');
async function runV1(db) {
  const r = await migrateVoiceConcepts(db.client);
  db.tables.concept_migrations.find(m => m.name === 'voice_concepts_v1').done_at = V1_DONE;   // 시각을 고정해 "이후"를 정한다
  return r;
}
async function runV2Quiet(db) {
  const origLog = console.log; console.log = () => {};
  try { return await migrateVoiceConceptsV2(db.client); } finally { console.log = origLog; }
}

test('v2: v1 이전 뒤 추가된 행만 이전하고 건수를 로그로 남김', async () => {
  const db = createMockDb();
  db.addUser(7);
  const old1 = vc(db, { term: 'a', explanation: '설명' }); vc(db, { term: 'b' });
  await runV1(db);
  const itemsBefore = JSON.stringify(db.tables.concept_items);
  const n1 = vc(db, { term: 'c', topic: '새주제', created_at: AFTER_V1, last_rating: 'known' });
  const n2 = vc(db, { term: 'd', topic: '새주제', created_at: AFTER_V1 });
  const before = JSON.stringify(db.tables.voice_concepts);
  const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  let r; try { r = await migrateVoiceConceptsV2(db.client); } finally { console.log = origLog; }
  assert.deepEqual([r.studies, r.items], [1, 2]);
  assert.equal(db.tables.concept_items.length, 4);
  assert.equal(JSON.stringify(db.tables.concept_items.slice(0, 2)), itemsBefore, 'v1 항목은 그대로');
  assert.ok(db.tables.concept_items.find(i => i.legacy_voice_concept_id === old1));
  assert.equal(db.tables.concept_items.find(i => i.legacy_voice_concept_id === n1).review_state, 'understood');
  assert.ok(db.tables.concept_items.find(i => i.legacy_voice_concept_id === n2));
  assert.equal(JSON.stringify(db.tables.voice_concepts), before, '원본 불변');
  assert.ok(db.tables.concept_migrations.some(m => m.name === 'voice_concepts_v2'));
  assert.ok(logs.some(l => /concept migration v2/.test(l) && /학습 1개, 개념 2개/.test(l)), '건수 로그: ' + logs.join('|'));
});

test('v2: 재실행하면 추가 0건 (표시가 있을 때, 표시를 지워도)', async () => {
  const db = createMockDb();
  db.addUser(7);
  vc(db, { term: 'a' });
  await runV1(db);
  vc(db, { term: 'c', created_at: AFTER_V1 });
  await runV2Quiet(db);
  const again = await runV2Quiet(db);
  assert.equal(again.skipped, true);
  assert.equal(db.tables.concept_items.length, 2);
  db.tables.concept_migrations = db.tables.concept_migrations.filter(m => m.name !== 'voice_concepts_v2');   // 표시가 없어도 중복은 생기지 않음
  const third = await runV2Quiet(db);
  assert.equal(third.items, 0);
  assert.equal(db.tables.concept_items.length, 2);
  assert.equal(new Set(db.tables.concept_items.map(i => i.legacy_voice_concept_id)).size, 2);
});

test('v2: v1 이후 사용자가 지운 개념은 되살아나지 않음', async () => {
  const db = createMockDb();
  db.addUser(7);
  vc(db, { term: 'a' }); vc(db, { term: 'b' });
  await runV1(db);
  db.tables.concept_items.splice(0, 1);                       // 사용자가 v1 이전 항목 하나를 삭제
  vc(db, { term: 'c', created_at: AFTER_V1 });
  await runV2Quiet(db);
  assert.deepEqual(db.tables.concept_items.map(i => i.term).sort(), ['b', 'c']);
});

test('v2: v1 완료 표시가 없으면 아무것도 하지 않고 v2 표시도 남기지 않음', async () => {
  const db = createMockDb();
  db.addUser(7);
  vc(db, { term: 'a', created_at: AFTER_V1 });
  const r = await runV2Quiet(db);
  assert.equal(r.skipped, true);
  assert.equal(db.tables.concept_items.length, 0);
  assert.equal(db.tables.concept_studies.length, 0);
  assert.equal(db.tables.concept_migrations.length, 0);
});
