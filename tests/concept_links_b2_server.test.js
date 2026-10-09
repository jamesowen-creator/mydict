// 작업227-10: 서버 연동 — CONCEPT_LINK_MODE=b2 에서 연결을 별도 호출(B2 방식)로 만든다. 기본(legacy)은 옛 동작 그대로.
// API 호출 없음(Anthropic 모의). 실행: node --test tests/concept_links_b2_server.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockDb } = require('./helpers/mock_db');
const { startApp, createAnthropicMock } = require('./helpers/app');
const b2 = require('../lib/concept_links_b2');

const S = '/api/concepts/studies';
const NEW_DEF = '식물이 빛에너지를 이용해 포도당을 만드는 과정이다.';
const CHL_DEF = '엽록체는 광합성이 일어나는 곳이다. 빛에너지를 화학에너지로 바꾼다.';
const NEW_ID = 3;   // setup 에서 개념 2개(세포, 엽록체)를 만든 뒤 explore 가 만드는 새 개념의 id

async function setup(mode) {
  const prev = process.env.CONCEPT_LINK_MODE;
  if (mode === undefined) delete process.env.CONCEPT_LINK_MODE; else process.env.CONCEPT_LINK_MODE = mode;
  const db = createMockDb();
  db.addUser(7);
  const anthropic = createAnthropicMock();
  const t = await startApp(['routes/concept_study.js'], { db, anthropic });
  const study = (await t.call('POST', S, { topic: '생물 · 세포' })).body;
  const add = async (term, definition) => {
    const it = (await t.call('POST', `${S}/${study.id}/items`, { term, origin: '직접 시작' })).body;
    if (definition) await t.call('PATCH', `/api/concepts/items/${it.id}`, { definition });
    return it;
  };
  return {
    db, anthropic, call: t.call, sid: study.id, add,
    close: async () => { await t.close(); if (prev === undefined) delete process.env.CONCEPT_LINK_MODE; else process.env.CONCEPT_LINK_MODE = prev; },
  };
}

const explainJson = (extra = {}) => JSON.stringify({
  term: '광합성', english: '', group_label: '에너지', definition: NEW_DEF, example: '', simple_text: '', deeper_text: '',
  relation: { relation_type: '원인→결과', label: '필요함', detail: '현재 개념과의 이유' }, links: [], suggestions: [], ...extra,
});
const b2Link = (s, o, extra = {}) => ({
  subject_id: s, predicate: '사용', object_id: o, reason: '광합성은 엽록체의 빛 흡수에 기대어 일어난다',
  evidence_subject: '빛에너지를 이용해 포도당을 만드는', evidence_object: '빛에너지를 화학에너지로 바꾼다', ...extra,
});
// 연결 호출(system 이 B2 프롬프트)에는 linksReply, 그 밖(설명 호출)에는 explainJson
function route(anthropic, linksReply) {
  anthropic.handler = (params, n) => (params.system === b2.SYSTEM_PROMPT ? (typeof linksReply === 'function' ? linksReply(params, n) : linksReply) : explainJson());
}
const events = db => db.tables.api_usage.map(r => r.event_type);

test('기본(환경변수 없음) = legacy: 호출 1회, 설명 호출 안의 links 사용, 사용량은 concept 만', async () => {
  const { db, anthropic, call, close, sid, add } = await setup(undefined);
  const cur = await add('세포'), chl = await add('엽록체', CHL_DEF);
  anthropic.handler = () => explainJson({ links: [{ to_item_id: chl.id, direction: 'from_new', relation_type: '포함', label: '', reason: '엽록체 안에서 일어난다' }] });
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(anthropic.calls.length, 1);
  assert.match(anthropic.calls[0].system, /"links":\[\{"to_item_id"/, 'legacy 프롬프트는 links 를 요청');
  assert.deepEqual(events(db), ['concept']);
  assert.equal(r.body.links.length, 1);
  assert.equal(r.body.links[0].relation_type, '포함');
  await close();
});

test('알 수 없는 값(B2, on, 빈 값, 공백 포함)은 legacy — 정확히 b2 만 켠다', async () => {
  for (const v of ['B2', 'on', '', 'b2 ']) {
    const { anthropic, call, close, sid, add } = await setup(v);
    const cur = await add('세포');
    anthropic.handler = () => explainJson();
    await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
    assert.equal(anthropic.calls.length, 1, `값 ${JSON.stringify(v)}`);
    await close();
  }
});

test('b2: 설명 호출(links 요청 없음) + 연결 호출(B2 프롬프트) 2회, 연결은 새 모양으로 저장, 사용량은 concept 1 + concept_link 1', async () => {
  const { db, anthropic, call, close, sid, add } = await setup('b2');
  const cur = await add('세포'), chl = await add('엽록체', CHL_DEF);
  route(anthropic, JSON.stringify({ links: [b2Link(NEW_ID, chl.id)] }));
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.ai_error, undefined);
  assert.equal(r.body.item.id, NEW_ID);
  assert.equal(anthropic.calls.length, 2);
  const [explain, link] = anthropic.calls;
  assert.doesNotMatch(explain.system, /"links"/, 'b2 설명 호출은 links 를 요청하지 않음');
  assert.doesNotMatch(explain.system, /연결 규칙/);
  assert.match(explain.system, /"suggestions"/);
  assert.equal(link.system, b2.SYSTEM_PROMPT);
  assert.equal(link.model, 'claude-haiku-4-5-20251001');
  const data = JSON.parse(link.messages[0].content.split('\n').slice(1).join('\n'));
  assert.equal(data['새 개념'].term, '광합성');
  assert.equal(data['새 개념'].description, NEW_DEF, '설명 필드는 definition 전체');
  assert.deepEqual(data['연결 후보'].map(c => [c.id, c.term]), [[chl.id, '엽록체']], '설명이 없는 현재 개념(세포)은 후보에서 빠짐');
  assert.equal(data['연결 후보'][0].description, CHL_DEF);
  assert.equal(r.body.links.length, 1);
  const l = r.body.links[0];
  assert.deepEqual([l.source, l.from_item_id, l.to_item_id, l.relation_type, l.label, l.user_edited], ['ai', NEW_ID, chl.id, '사용', null, false]);
  assert.deepEqual(events(db), ['concept', 'concept_link']);
  assert.equal(db.tables.concept_links.length, 2, '현재 개념과의 relation 연결 1 + b2 연결 1');
  await close();
});

test('b2: 일으킴은 이유+메커니즘이 detail 에 합쳐지고 300자를 넘으면 자른다', async () => {
  const { anthropic, call, close, sid, add } = await setup('b2');
  const cur = await add('세포'), chl = await add('엽록체', CHL_DEF);
  route(anthropic, JSON.stringify({ links: [{
    subject_id: chl.id, predicate: '일으킴', object_id: NEW_ID, reason: '가'.repeat(290), mechanism: '나'.repeat(100),
    evidence_subject: '빛에너지를 화학에너지로 바꾼다', evidence_object: '빛에너지를 이용해 포도당을 만드는',
  }] }));
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.body.links.length, 1);
  const l = r.body.links[0];
  assert.deepEqual([l.relation_type, l.from_item_id, l.to_item_id], ['일으킴', chl.id, NEW_ID]);
  assert.equal(Array.from(l.detail).length, 300);
  assert.ok(l.detail.startsWith('가'.repeat(290) + '\n메커니즘: '));
  await close();
});

test('b2: 연결 호출 실패·잘못된 JSON·검증 탈락이면 연결만 비고 개념은 정상(ai_error 없음)', async () => {
  const cases = [
    ['호출 오류', () => { throw new Error('boom'); }],
    ['JSON 아님', () => '연결 없음'],
    ['증거 불일치', () => JSON.stringify({ links: [b2Link(NEW_ID, 2, { evidence_subject: '설명에 없는 아주 긴 근거 구절입니다' })] })],
    ['옛 관계 종류', () => JSON.stringify({ links: [b2Link(NEW_ID, 2, { predicate: '포함' })] })],
  ];
  for (const [name, reply] of cases) {
    const { db, anthropic, call, close, sid, add } = await setup('b2');
    const cur = await add('세포');
    await add('엽록체', CHL_DEF);
    route(anthropic, reply);
    const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
    assert.equal(r.status, 200, name);
    assert.equal(r.body.ai_error, undefined, name);
    assert.equal(r.body.item.content_source, 'ai', name);
    assert.deepEqual(r.body.links, [], name);
    assert.equal(db.tables.concept_links.filter(l => l.source === 'ai').length, 1, name + ': relation 연결만 남음');
    await close();
  }
});

test('b2: 후보가 없으면(설명 있는 다른 활성 개념 없음) 연결 호출 자체를 하지 않음', async () => {
  const { db, anthropic, call, close, sid, add } = await setup('b2');
  const cur = await add('세포');
  route(anthropic, JSON.stringify({ links: [] }));
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(anthropic.calls.length, 1);
  assert.deepEqual(events(db), ['concept']);
  await close();
});

test('b2: 설명 호출이 실패(ai_error)하면 연결 호출도 하지 않음', async () => {
  const { anthropic, call, close, sid, add } = await setup('b2');
  const cur = await add('세포');
  await add('엽록체', CHL_DEF);
  anthropic.handler = () => '이건 JSON 이 아니다';
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.ok(r.body.ai_error);
  assert.equal(anthropic.calls.length, 1);
  await close();
});

test('b2: concept_link 가 하루 한도에 닿으면 연결만 건너뜀(설명은 concept 한도로 따로 셈)', async () => {
  const prevCap = process.env.CONCEPT_AI_DAILY_CAP;
  process.env.CONCEPT_AI_DAILY_CAP = '2';
  try {
    const { db, anthropic, call, close, sid, add } = await setup('b2');
    const cur = await add('세포'), chl = await add('엽록체', CHL_DEF);
    for (let i = 0; i < 2; i++) db.trackUsage(7, 'concept_link', 'm', 1, 1, 0);
    route(anthropic, JSON.stringify({ links: [b2Link(NEW_ID, chl.id)] }));
    const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
    assert.equal(r.status, 200, 'concept 한도(0/2)는 안 찼으므로 설명은 받음');
    assert.equal(anthropic.calls.length, 1, '연결 호출은 건너뜀');
    assert.deepEqual(r.body.links, []);
    await close();
  } finally { if (prevCap === undefined) delete process.env.CONCEPT_AI_DAILY_CAP; else process.env.CONCEPT_AI_DAILY_CAP = prevCap; }
});

test('b2: 설명 한도(concept)는 그대로 1건=1회이고 음성 link 이벤트·concept_link 는 세지 않음', async () => {
  const prevCap = process.env.CONCEPT_AI_DAILY_CAP;
  process.env.CONCEPT_AI_DAILY_CAP = '1';
  try {
    const { db, anthropic, call, close, sid, add } = await setup('b2');
    const cur = await add('세포');
    db.trackUsage(7, 'link', 'm', 1, 1, 0);
    db.trackUsage(7, 'concept_link', 'm', 1, 1, 0);
    route(anthropic, JSON.stringify({ links: [] }));
    assert.equal((await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id })).status, 200);
    assert.equal((await call('POST', `${S}/${sid}/explore`, { text: '리보솜', from_item_id: cur.id })).status, 429);
    await close();
  } finally { if (prevCap === undefined) delete process.env.CONCEPT_AI_DAILY_CAP; else process.env.CONCEPT_AI_DAILY_CAP = prevCap; }
});

test('수동 연결(POST/PATCH)은 11값을 받고 그 밖은 400 — 모드와 무관', async () => {
  for (const mode of [undefined, 'b2']) {
    const { call, close, sid, add } = await setup(mode);
    const items = [];
    for (let i = 0; i < 6; i++) items.push(await add('개념' + i));
    for (const [i, type] of b2.PREDICATES.entries()) {
      const r = await call('POST', `${S}/${sid}/links`, { from_item_id: items[0].id, to_item_id: items[i + 1].id, relation_type: type });
      assert.equal(r.status, 201, type);
      assert.equal(r.body.relation_type, type);
    }
    const base = await call('POST', `${S}/${sid}/links`, { from_item_id: items[1].id, to_item_id: items[2].id, relation_type: '포함' });
    const p = await call('PATCH', `/api/concepts/links/${base.body.id}`, { relation_type: '일으킴' });
    assert.equal(p.status, 200);
    assert.equal(p.body.relation_type, '일으킴');
    assert.equal((await call('PATCH', `/api/concepts/links/${base.body.id}`, { relation_type: '없는관계' })).status, 400);
    assert.equal((await call('POST', `${S}/${sid}/links`, { from_item_id: items[3].id, to_item_id: items[4].id, relation_type: '없는관계' })).status, 400);
    await close();
  }
});

test('legacy 관계·제안·연결은 새 5종을 받지 않는다(AI 가 낸 값은 기타 관련으로, 연결은 버림)', async () => {
  const { anthropic, call, close, sid, add } = await setup(undefined);
  const cur = await add('세포'), chl = await add('엽록체', CHL_DEF);
  anthropic.handler = () => explainJson({
    relation: { relation_type: '사용', label: '', detail: '' },
    links: [{ to_item_id: chl.id, direction: 'from_new', relation_type: '일으킴', label: '', reason: '이유가 있다' }],
    suggestions: [{ term: '리보솜', reason: '다음', relation_type: '종류', relation_label: '', load: '보통' }],
  });
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.body.link.relation_type, '기타 관련');
  assert.deepEqual(r.body.links, []);
  assert.equal(r.body.item.suggestions[0].relation_type, '기타 관련');
  await close();
});

// ───────────────────────── 작업227-22: 후보별 현재 연결 수, 조회 실패, 레거시 지문 ─────────────────────────
const crypto = require('node:crypto');
const dataIn = call => JSON.parse(call.messages[0].content.slice(call.messages[0].content.indexOf('{')));

test('b2: 후보 입력에 현재 연결 수(links) — 양끝이 모두 활성 개념인 연결만, 주어·목적어 모두 센다', { skip: false }, async () => {
  const { anthropic, call, close, sid, add } = await setup('b2');
  const cur = await add('세포');
  const chl = await add('엽록체', CHL_DEF), x = await add('핵', '핵은 세포의 유전 정보를 담고 있는 부분이다. 세포의 활동을 조절한다.'), y = await add('미토콘드리아', '미토콘드리아는 세포가 쓸 에너지를 만들어 내는 부분이다. 세포 안에 여러 개 있다.');
  const held = await add('보류 개념', '보류 중인 개념의 설명이다. 지도에는 나오지 않는다.');
  const L = (a, b) => call('POST', `${S}/${sid}/links`, { from_item_id: a.id, to_item_id: b.id, relation_type: '사용' });
  for (const [a, b] of [[chl, x], [y, chl], [x, y], [x, cur], [chl, held]]) assert.equal((await L(a, b)).status, 201);
  assert.equal((await call('PATCH', `/api/concepts/items/${held.id}`, { status: 'held' })).status, 200);
  const explainWith = JSON.stringify({ links: [] });
  route(anthropic, explainWith);
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(anthropic.calls.length, 2);
  const cands = dataIn(anthropic.calls[1])['연결 후보'];
  // 엽록체: 핵·미토콘드리아 (보류 개념과의 연결은 뺌) = 2, 핵: 엽록체·미토콘드리아·세포 = 3, 미토콘드리아: 엽록체·핵 = 2
  assert.deepEqual(cands.map(c => [c.term, c.links]), [['엽록체', 2], ['핵', 3], ['미토콘드리아', 2]]);
  assert.deepEqual(Object.keys(cands[0]), ['id', 'term', 'description', 'links']);
  assert.equal(anthropic.calls[1].system, b2.SYSTEM_PROMPT);
  await close();
});

test('b2: 연결 수 조회가 실패하면 연결 생성만 건너뜀(개념은 정상 저장, 연결 호출 없음, 오류 없음)', async () => {
  const { db, anthropic, call, close, sid, add } = await setup('b2');
  const cur = await add('세포'), chl = await add('엽록체', CHL_DEF);
  void chl;
  route(anthropic, JSON.stringify({ links: [b2Link(NEW_ID, chl.id)] }));
  db.failOn = /^SELECT from_item_id, to_item_id FROM concept_links WHERE study_id = \$1 AND user_id = \$2/;   // 연결 수 조회만 실패(linkExists 의 조회는 해당 없음)
  const r = await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.ai_error, undefined);
  assert.equal(r.body.item.content_source, 'ai');
  assert.deepEqual(r.body.links, []);
  assert.equal(anthropic.calls.length, 1, '설명 호출만');
  assert.deepEqual(events(db), ['concept']);
  await close();
});

test('legacy 호출 지문 그대로: 모델, temperature 0.3, max_tokens 1500, 시스템 프롬프트 해시 d21024a7de985f69', async () => {
  const { anthropic, call, close, sid, add } = await setup(undefined);
  const cur = await add('세포'), chl = await add('엽록체', CHL_DEF);
  anthropic.handler = () => explainJson({ links: [{ to_item_id: chl.id, direction: 'from_new', relation_type: '포함', label: '', reason: '엽록체 안에서 일어난다' }] });
  await call('POST', `${S}/${sid}/explore`, { text: '광합성', from_item_id: cur.id });
  assert.equal(anthropic.calls.length, 1);
  const p = anthropic.calls[0];
  assert.deepEqual([p.model, p.temperature, p.max_tokens], ['claude-haiku-4-5-20251001', 0.3, 1500]);
  assert.equal(crypto.createHash('sha256').update(p.system).digest('hex').slice(0, 16), 'd21024a7de985f69');
  assert.doesNotMatch(p.messages[0].content, /"links": \d/, 'legacy 입력에는 연결 수 필드가 없음');
  await close();
});
