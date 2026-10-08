// 작업209-2: AI 연결 확대(기존 개념과 최대 3개) + 이유 + 연결 수정 API(PATCH). 실행: node --test "tests/**/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockDb } = require('./helpers/mock_db');
const { startApp, createAnthropicMock } = require('./helpers/app');

const S = '/api/concepts/studies';

async function setup() {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const anthropic = createAnthropicMock();
  const t = await startApp(['routes/concept_study.js'], { db, anthropic });
  const study = (await t.call('POST', S, { topic: '생물 · 세포' })).body;
  const add = async term => (await t.call('POST', `${S}/${study.id}/items`, { term, origin: '직접 시작' })).body;
  return { db, anthropic, t, call: t.call, close: t.close, sid: study.id, add };
}

const lk = (to, extra = {}) => ({ to_item_id: to, direction: 'from_new', relation_type: '원인→결과', label: '필요함', reason: '빛이 있어야 일어난다', ...extra });
function good(links, extra = {}) {
  return JSON.stringify({
    term: '광합성', english: '', group_label: '에너지', definition: '식물이 빛으로 양분을 만드는 과정', example: '', simple_text: '', deeper_text: '',
    relation: { relation_type: '원인→결과', label: '필요함', detail: '현재 개념과의 이유' }, links, suggestions: [], ...extra,
  });
}
const dataIn = call => JSON.parse(call.messages[0].content.split('\n').slice(1).join('\n'));

test('AI 연결: 현재 개념 외 기존 개념과도 연결(source ai, 이유는 detail), 프롬프트에는 id·용어·잘린 설명만', async () => {
  const { db, anthropic, call, close, sid, add } = await setup();
  const cur = await add('세포'), b = await add('엽록체'), c = await add('미토콘드리아');
  await call('PATCH', `/api/concepts/items/${b.id}`, { definition: '가'.repeat(100) });
  anthropic.handler = () => good([lk(b.id, { relation_type: '포함', direction: 'to_new', label: '들어 있음', reason: '엽록체 안에서 일어난다' }), lk(c.id, { relation_type: '대비', reason: '에너지를 만드는 방식이 다르다' })]);
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.links.length, 2);
  const [l1, l2] = r.body.links;
  assert.deepEqual([l1.source, l1.from_item_id, l1.to_item_id, l1.relation_type, l1.detail, l1.user_edited], ['ai', b.id, r.body.item.id, '포함', '엽록체 안에서 일어난다', false], 'to_new면 기존 개념 → 새 개념');
  assert.deepEqual([l2.from_item_id, l2.to_item_id], [r.body.item.id, c.id], 'from_new면 새 개념 → 기존 개념');
  assert.equal(db.tables.concept_links.length, 3, '현재 개념과의 relation 연결 1 + 추가 2');
  assert.equal(anthropic.calls.length, 1, 'AI 호출은 늘리지 않음');
  const cand = dataIn(anthropic.calls[0])['연결 후보'];
  assert.deepEqual(cand.map(x => x.id), [b.id, c.id], '새 개념·현재 개념은 후보에서 제외');
  assert.deepEqual(Object.keys(cand[0]).sort(), ['id', 'summary', 'term']);
  assert.equal(Array.from(cand[0].summary).length, 40, '설명은 잘라서');
  await close();
});

test('AI 연결 검증: 없는/다른 학습의 id·잘못된 관계·이유 없음/300자 초과는 그 연결만 생략하고 개념은 유지', async () => {
  const { db, anthropic, call, close, sid, add } = await setup();
  const cur = await add('세포'), b = await add('엽록체'), c = await add('핵');
  const other = (await call('POST', S, { topic: '다른 학습' })).body;
  const foreign = (await call('POST', `${S}/${other.id}/items`, { term: '남의 개념' })).body;
  anthropic.handler = () => good([
    lk(99999), lk(foreign.id), lk('x'), lk(b.id, { relation_type: '없는관계' }),
    lk(b.id, { reason: '' }), lk(b.id, { reason: '   ' }), lk(b.id, { reason: 'r'.repeat(301) }), lk(b.id, { reason: 5 }), null, 'bad',
    lk(c.id, { reason: 'r'.repeat(300), label: 'l'.repeat(41) }),          // 이유 300자는 통과, 문구 초과는 비움
  ]);
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.ai_error, undefined);
  assert.equal(r.body.item.content_source, 'ai');
  assert.equal(r.body.links.length, 1);
  assert.equal(r.body.links[0].to_item_id, c.id); assert.equal(r.body.links[0].label, null); assert.equal(r.body.links[0].detail.length, 300);
  assert.equal(db.tables.concept_links.filter(l => l.source === 'ai').length, 2, 'relation 1 + 유효한 1');
  await close();
});

test('AI 연결: 같은 쌍 중복은 만들지 않고, 3개 초과는 절단', async () => {
  const { db, anthropic, call, close, sid, add } = await setup();
  const cur = await add('세포'), a = await add('A'), b = await add('B'), c = await add('C'), d = await add('D');
  anthropic.handler = () => good([lk(a.id), lk(a.id, { relation_type: '대비' }), lk(b.id), lk(c.id), lk(d.id)]);
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.deepEqual(r.body.links.map(l => l.to_item_id), [a.id, b.id, c.id], '같은 쌍 중복 제거 뒤 최대 3개');
  assert.equal(db.tables.concept_links.length, 4);
  await close();
});

test('AI 연결: 이미 직접 이어진 쌍은 건너뜀(기존 연결 데이터는 건드리지 않음)', async () => {
  const { db, anthropic, call, close, sid, add } = await setup();
  const cur = await add('세포'), a = await add('A');
  const e = await add('E');
  anthropic.handler = () => good([lk(a.id), lk(e.id)]);
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  const newId = r.body.item.id;
  // 같은 새 개념을 다시 채우는 경로는 없으므로, 새 개념 ↔ A 연결을 미리 만들어 둔 상태를 흉내 낸다
  const before = db.tables.concept_links.length;
  const dup = await call('POST', `${S}/${sid}/links`, { from_item_id: a.id, to_item_id: newId });
  assert.equal(dup.status, 409, 'AI가 만든 쌍과 같은 쌍은 중복');
  assert.equal(db.tables.concept_links.length, before);
  await close();
});

test('AI 연결: 보류 개념은 후보가 아니고, 학습당 60개 상한 안에서 활성 개념은 모두 후보(최대 60개)', async () => {
  const { db, anthropic, call, close, sid, add } = await setup();
  const held = await add('보류됨');
  await call('PATCH', `/api/concepts/items/${held.id}`, { status: 'held' });
  const ids = [];
  for (let i = 0; i < 58; i++) ids.push((await add('개념' + i)).id);   // 보류 1 + 활성 58 = 59개, 새 개념이 60번째
  anthropic.handler = () => good([lk(held.id), lk(ids[0])]);
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성' });
  assert.equal(r.status, 200);
  const cand = dataIn(anthropic.calls[0])['연결 후보'];
  assert.equal(cand.length, 58);
  assert.ok(!cand.some(x => x.id === held.id));
  assert.deepEqual(r.body.links.map(l => l.to_item_id), [ids[0]], '보류 개념으로의 연결은 만들지 않음');
  assert.equal(db.tables.concept_links.length, 1);
  await close();
});

test('AI 연결: AI 오류·깨진 links에도 개념은 유지', async () => {
  const { db, anthropic, call, close, sid, add } = await setup();
  const cur = await add('세포');
  anthropic.handler = () => { throw new Error('boom'); };
  let r = await call('POST', `${S}/${sid}/explore`, { text: '삼투', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.ok(r.body.ai_error); assert.deepEqual(r.body.links, []); assert.equal(r.body.link, null);
  assert.ok(db.tables.concept_items.some(i => i.term === '삼투'), 'AI가 실패해도 개념은 남음');
  anthropic.handler = () => '{"term":"호흡","definition":"숨 쉬기","links":"깨짐"}';
  r = await call('POST', `${S}/${sid}/explore`, { text: '호흡', from_item_id: cur.id });
  assert.equal(r.status, 200); assert.deepEqual(r.body.links, []); assert.equal(r.body.item.definition, '숨 쉬기');
  await close();
});

test('AI 연결: 추가 연결 저장이 실패해도 개념과 현재 개념 연결은 유지', async () => {
  const { db, anthropic, call, close, sid, add } = await setup();
  const cur = await add('세포'), b = await add('엽록체');
  anthropic.handler = () => good([lk(b.id)]);
  let n = 0;
  const origQuery = db.pool.query;
  db.pool.query = async (sql, params) => {
    if (/^\s*INSERT INTO concept_links/.test(sql) && ++n === 2) throw new Error('주입된 오류');
    return origQuery.call(db.pool, sql, params);
  };
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.content_source, 'ai');
  assert.ok(r.body.link); assert.deepEqual(r.body.links, []);
  await close();
});

async function twoLinked() {
  const ctx = await setup();
  const a = await ctx.add('세포'), b = await ctx.add('엽록체');
  const link = (await ctx.call('POST', `${S}/${ctx.sid}/links`, { from_item_id: a.id, to_item_id: b.id, relation_type: '포함', label: '들어 있음', detail: '처음 이유' })).body;
  return { ...ctx, a, b, link };
}

test('PATCH 연결: 관계·문구·이유 수정, user_edited=true, source 유지, 조회에도 포함', async () => {
  const { call, close, link, sid } = await twoLinked();
  assert.equal(link.user_edited, false);
  const r = await call('PATCH', `/api/concepts/links/${link.id}`, { relation_type: '대비', label: '다름', detail: '새 이유' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.relation_type, r.body.label, r.body.detail, r.body.user_edited, r.body.source], ['대비', '다름', '새 이유', true, 'user']);
  const got = (await call('GET', `${S}/${sid}`)).body.links[0];
  assert.equal(got.user_edited, true);
  const r2 = await call('PATCH', `/api/concepts/links/${link.id}`, { label: '', detail: null });
  assert.deepEqual([r2.body.label, r2.body.detail, r2.body.relation_type], [null, null, '대비'], '빈 값은 비움, 보내지 않은 필드는 유지');
  await close();
});

test('PATCH 연결: AI 연결을 고쳐도 source는 ai 그대로', async () => {
  const { db, call, close, link } = await twoLinked();
  db.tables.concept_links.find(l => l.id === link.id).source = 'ai';
  const r = await call('PATCH', `/api/concepts/links/${link.id}`, { detail: '내가 고친 이유' });
  assert.deepEqual([r.body.source, r.body.user_edited], ['ai', true]);
  await close();
});

test('PATCH 연결: 방향 바꾸기(swap)는 from/to만 교환하고 쌍은 그대로, 다른 수정과 함께 가능', async () => {
  const { db, call, close, link, a, b, sid } = await twoLinked();
  let r = await call('PATCH', `/api/concepts/links/${link.id}`, { swap: true });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.from_item_id, r.body.to_item_id, r.body.user_edited], [b.id, a.id, true]);
  r = await call('PATCH', `/api/concepts/links/${link.id}`, { swap: true, relation_type: '순서' });
  assert.deepEqual([r.body.from_item_id, r.body.to_item_id, r.body.relation_type], [a.id, b.id, '순서']);
  assert.equal(db.tables.concept_links.length, 1, '링크 수 불변');
  const dup = await call('POST', `${S}/${sid}/links`, { from_item_id: b.id, to_item_id: a.id });
  assert.equal(dup.status, 409, '같은 쌍 중복 불가 규칙 유지');
  await close();
});

test('PATCH 연결: 검증 실패 400, 없는 id·잘못된 id·다른 사용자 404, 실패 시 변경 없음', async () => {
  const { db, call, close, link } = await twoLinked();
  const before = JSON.stringify(db.tables.concept_links);
  const bad = [{}, { relation_type: '없는관계' }, { relation_type: 5 }, { label: 'l'.repeat(41) }, { label: 5 }, { detail: 'd'.repeat(301) }, { detail: {} }, { swap: 'yes' }, { swap: false }, [], 'text'];
  for (const body of bad) {
    const r = await call('PATCH', `/api/concepts/links/${link.id}`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(JSON.stringify(db.tables.concept_links), before, '400이면 아무것도 바뀌지 않음');
  assert.equal((await call('PATCH', '/api/concepts/links/999999', { label: 'x' })).status, 404);
  assert.equal((await call('PATCH', '/api/concepts/links/abc', { label: 'x' })).status, 404);
  assert.equal((await call('PATCH', `/api/concepts/links/${link.id}`, { label: 'x' }, { user: 8 })).status, 404, '다른 사용자 연결은 404');
  assert.equal((await call('PATCH', `/api/concepts/links/${link.id}`, { label: 'x' }, { user: null })).status, 401);
  assert.equal(db.tables.concept_links[0].label, '들어 있음');
  const ok = await call('PATCH', `/api/concepts/links/${link.id}`, { detail: 'd'.repeat(300) });
  assert.equal(ok.status, 200, '이유 300자는 통과');
  await close();
});

test('initDB: concept_links.user_edited 컬럼 추가(ADD COLUMN IF NOT EXISTS, 기본 false)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'db.js'), 'utf8');
  assert.match(src, /ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS user_edited BOOLEAN NOT NULL DEFAULT false/);
});
