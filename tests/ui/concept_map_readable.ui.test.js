// 작업227-16: 지도 가독성 1차(안1) — 이웃 보기가 기본, 열릴 때 노드 글자 화면 12px 이상, 허브·간선 약화, 선 모양/종류 단어, 탭하면 문장 카드, 모르는 값 방어.
// (헤드리스 Chrome, 모의 API. 실행: node --test tests/ui/concept_map_readable.ui.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { openMap, closeMap } = require('./helpers/map');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const TERMS = ['네트워크', '프로토콜', '패킷', 'IP 주소', 'MAC 주소', '라우터', '스위치', 'DNS', 'TCP', 'UDP', 'HTTP', '포트', '서브넷', '게이트웨이', '대역폭', '지연 시간', '방화벽', 'NAT', 'DHCP', '계층 모델'];
const TYPES = ['사용', '일부', '종류', '일으킴', '구별', '사용'];
// 0번 개념이 허브(1~12와 연결). 나머지는 몇 개만 서로 연결. 종류는 새 5종을 돌려 쓴다
function net(n, extra = []) {
  const items = TERMS.slice(0, n).map(term => ({ term }));
  const links = [];
  const hubTo = n === 8 ? 5 : 12;
  for (let i = 1; i <= hubTo; i++) links.push([0, i, { relation_type: TYPES[i % TYPES.length], label: null, detail: i + '번 이유입니다.' }]);
  if (n === 8) links.push([6, 7, { relation_type: '사용', label: null, detail: '이유' }]);
  else for (const [a, b] of [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [6, 13], [1, 13], [2, 14]]) links.push([a, b, { relation_type: '사용', label: null, detail: '이유' }]);
  return { items, links: links.concat(extra) };
}
async function open(n, { width = 390, height = 844, sel = 1, extra = [], setup } = {}) {
  srv.reset();
  const d = net(n, extra);
  srv.seed({ topic: '네트워크', items: d.items.map(i => ({ term: i.term, set: { suggestions: [] } })), links: d.links, path: [sel] });   // 다음 제안 점선 노드는 빼서 순수 이웃 보기만 본다
  if (setup) setup(srv);
  const page = await browser.newPage({ width, height });
  await page.goto(srv.url + '/concept_study.html#s=' + srv.state.studies[0].id);
  await page.waitFor("!document.getElementById('view-study').hidden && !!document.querySelector('[data-t=term]')");
  await openMap(page);
  return page;
}
const tapNode = (page, id) => page.eval(`document.querySelector('[data-t=node][data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const idOf = term => srv.state.items.find(i => i.term === term).id;
const fontPx = page => page.eval(`(() => { const v = document.querySelector('[data-t=map-svg]').getAttribute('viewBox').split(' ').map(Number); const b = document.querySelector('[data-t=map-box]'); const scale = Math.min(b.clientWidth / v[2], b.clientHeight / v[3]); return parseFloat(getComputedStyle(document.querySelector('[data-t=node] text')).fontSize) * scale; })()`);
const op = (page, sel) => page.eval(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).opacity)`);

for (const [n, w, h] of [[8, 390, 844], [20, 390, 844], [8, 768, 1024], [20, 768, 1024]]) {
  test(`열릴 때 노드 글자가 화면 기준 12px 이상: N=${n}, ${w}px`, { skip: SKIP }, async () => {
    const page = await open(n, { width: w, height: h });
    const px = await fontPx(page);
    assert.ok(px >= 12 - 0.05, '노드 글자 화면 크기 ' + px);
    // 전체 맞춤보다 커서 20개는 한 화면에 다 안 들어오고, 초점 노드는 보인다
    assert.equal(await page.eval(`(() => { const b = document.querySelector('[data-t=map-box]').getBoundingClientRect(); const r = document.querySelector('[data-t=node].sel').getBoundingClientRect(); return r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom; })()`), true, '초점 노드가 화면 안');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}

test('이웃 보기가 기본: 선택 개념과 1단계 이웃만 진하고 나머지는 흐림, 전체 연결 보기를 누르면 모두 진해지고 다시 누르면 복귀', { skip: SKIP }, async () => {
  const page = await open(20, { sel: 1 });   // 선택 = 프로토콜(1): 이웃 = 네트워크(0), 패킷(2), 대역폭... (1~2, 1~13, 0~1)
  const nb = new Set([idOf('프로토콜'), idOf('네트워크'), idOf('패킷'), idOf('게이트웨이')].map(String));   // 0~1, 1~2, 1~13(게이트웨이 = 인덱스 13)
  const st = await page.eval("[...document.querySelectorAll('[data-t=node]')].map(n => [n.dataset.id, n.classList.contains('dim'), n.dataset.hl])");
  for (const [id, dim, hl] of st) {
    if (nb.has(id)) assert.deepEqual([dim, hl], [false, '1'], '이웃은 진하게 ' + id);
    else if (id !== String(idOf('프로토콜'))) assert.equal(dim, true, '이웃이 아니면 흐리게 ' + id);
  }
  assert.equal(await page.eval("document.querySelector('[data-t=node].sel').dataset.id"), String(idOf('프로토콜')));
  await page.click('[data-t=map-full]');
  assert.equal(await page.count('.m-node.dim'), 0);
  await page.click('[data-t=map-full]');
  assert.ok(await page.count('.m-node.dim') >= 10);
  await closeMap(page);
  await page.close();
});

test('초점 고르기: 선택한 개념이 지도에 없으면(보류) 경로의 마지막 활성 개념, 그것도 없으면 연결이 가장 많은 개념', { skip: SKIP }, async () => {
  // 선택 개념이 보류면 지도에 없다 → 경로 마지막 활성 개념(패킷 = 2)이 초점
  let page = await open(8, { sel: 1, setup: s => { s.state.items[1].status = 'held'; s.state.studies[0].path = [s.state.items[2].id, s.state.items[1].id]; } });
  const near = id => page.eval(`(() => { const e = document.querySelector('[data-t=node][data-id="${id}"]'); return e ? !e.classList.contains('dim') : null; })()`);
  assert.equal(await near(srv.state.items[2].id), true, '경로 마지막 활성 개념(패킷)이 진함');
  assert.equal(await page.count('[data-t=node][data-id="' + srv.state.items[1].id + '"]'), 0, '보류 개념은 지도에 없음');
  await page.close();
  // 선택도 경로도 없으면 연결이 가장 많은 개념(네트워크 = 0)이 초점
  page = await open(8, { sel: 1, setup: s => { s.state.items[1].status = 'held'; s.state.studies[0].path = []; s.state.studies[0].selected_item_id = s.state.items[1].id; } });
  assert.equal(await page.eval(`!document.querySelector('[data-t=node][data-id="${srv.state.items[0].id}"]').classList.contains('dim')`), true, '연결이 가장 많은 개념이 진함');
  assert.ok(await page.count('.m-node.dim') >= 1);
  await page.close();
});

test('허브 간선은 연하고, 허브를 선택하면 그 간선이 진해짐', { skip: SKIP }, async () => {
  const page = await open(20, { sel: 17 });   // 선택 = NAT(17): 허브(네트워크 = 0, 연결 12개)와 떨어져 있음
  const hubEdges = await page.eval("[...document.querySelectorAll('[data-t=edge][data-hub=\"1\"]')].map(e => [e.dataset.hl, parseFloat(getComputedStyle(e).opacity)])");
  assert.ok(hubEdges.length >= 8, '허브에 닿은 연한 선이 있음: ' + hubEdges.length);
  for (const [hl, o] of hubEdges) { assert.equal(hl, '0'); assert.ok(o <= 0.15, '허브 간선은 가장 연함 ' + o); }
  const normal = await page.eval("[...document.querySelectorAll('[data-t=edge][data-hub=\"0\"]:not([data-hl=\"1\"])')].map(e => parseFloat(getComputedStyle(e).opacity))");
  assert.ok(normal.length && Math.max(...normal) > Math.max(...hubEdges.map(x => x[1])), '허브 아닌 연한 선은 허브 간선보다 진함');
  await tapNode(page, idOf('네트워크'));
  await page.waitFor("document.querySelector('[data-t=node].sel').dataset.id === '" + idOf('네트워크') + "'");
  const after = await page.eval(`[...document.querySelectorAll('[data-t=edge]')].filter(e => e.dataset.hl === '1').length`);
  assert.ok(after >= 12, '허브를 고르면 그 선들이 진해짐: ' + after);
  assert.equal(await page.eval("[...document.querySelectorAll('[data-t=edge][data-hl=\"1\"]')].every(e => parseFloat(getComputedStyle(e).opacity) === 1)"), true);
  await page.close();
});

test('선 모양과 종류 단어: 일부·종류·구별은 점선 계열, 새 5종의 진한 선에는 화살표, 진한 선이 많으면 글자 없이 모양만', { skip: SKIP }, async () => {
  const page = await open(8, { sel: 0 });   // 허브 5개 선 + 1개 → 진한 선 5개(8개 이하라 글자 있음)
  const dash = await page.eval("[...document.querySelectorAll('[data-t=edge][data-hl=\"1\"]')].map(e => e.querySelector('path.line').getAttribute('stroke-dasharray') || '')");
  assert.ok(dash.includes('7 4') && dash.includes('2 4') && dash.includes('8 3 2 3') && dash.includes(''), '일부·종류·구별 점선, 사용·일으킴 실선: ' + JSON.stringify(dash));
  assert.equal(await page.eval("document.querySelectorAll('[data-t=edge][data-hl=\"1\"] path.line[marker-end]').length"), 5, '새 5종 진한 선에 화살표');
  const words = await page.eval("[...document.querySelectorAll('[data-t=edge] text')].map(t => t.textContent).sort()");
  assert.equal(words.length, 5, '진한 선 5개에 종류 단어 5개');
  assert.ok(words.every(x => ['사용', '일부', '종류', '일으킴', '구별'].includes(x)), '종류 단어만: ' + words);
  await page.close();
  const page2 = await open(20, { sel: 0 });   // 진한 선 12개(> 8) → 글자 없이 선 모양만
  assert.equal(await page2.count('[data-t=edge] text'), 0, '진한 선이 많으면 선 위 글자 없음');
  assert.equal(await page2.eval("document.querySelectorAll('[data-t=edge][data-hl=\"1\"]').length"), 12);
  await page2.close();
});

test('간선을 누르면 카드: 새 5종은 문장과 이유, 옛 6종은 기존 표시 그대로', { skip: SKIP }, async () => {
  const page = await open(8, { sel: 0, extra: [[6, 1, { relation_type: '포함', label: '구성함', detail: '옛 연결의 이유' }]] });
  const edgeFor = (a, b) => srv.state.links.find(l => l.from_item_id === idOf(a) && l.to_item_id === idOf(b));
  const tapEdge = async l => { await page.eval(`document.querySelector('[data-t=edge][data-id="${l.id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await page.waitFor("document.getElementById('edge-dialog').open"); };
  const l1 = edgeFor('네트워크', '프로토콜');   // 인덱스 1 → TYPES[1] = 일부
  await tapEdge(l1);
  assert.equal(await page.text('#edge-pair'), '네트워크는 프로토콜의 일부이다');
  assert.equal(await page.text('[data-t=rel-detail]'), '1번 이유입니다.');
  await page.click('#edge-close');
  const l3 = edgeFor('네트워크', 'IP 주소');   // 인덱스 3 → 일으킴
  await tapEdge(l3);
  assert.equal(await page.text('#edge-pair'), '네트워크는 IP 주소를 일으킨다');
  await page.click('#edge-close');
  const old = edgeFor('스위치', '프로토콜');
  await tapEdge(old);
  assert.equal(await page.text('#edge-pair'), '스위치 → 프로토콜', '옛 6종 카드는 화살표 표시 그대로');
  assert.equal(await page.text('[data-t=rel-type]'), '포함');
  assert.equal(await page.text('[data-t=rel-label]'), '구성함');
  await page.click('#edge-close');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('모르는 relation_type 값: 지도가 깨지지 않고 값을 그대로 표시, 카드도 열림', { skip: SKIP }, async () => {
  const page = await open(8, { sel: 0, extra: [[0, 7, { relation_type: '새로운종류', label: '낯선', detail: '모르는 값' }]] });
  const l = srv.state.links.find(x => x.relation_type === '새로운종류');
  assert.equal(await page.count(`[data-t=edge][data-id="${l.id}"]`), 1);
  assert.equal(await page.eval(`document.querySelector('[data-t=edge][data-id="${l.id}"] text').textContent`), '낯선');
  assert.equal(await page.eval(`document.querySelector('[data-t=edge][data-id="${l.id}"] path.line').hasAttribute('stroke-dasharray')`), false);
  await page.eval(`document.querySelector('[data-t=edge][data-id="${l.id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await page.waitFor("document.getElementById('edge-dialog').open");
  assert.equal(await page.text('[data-t=rel-type]'), '새로운종류');
  await page.click('#edge-close');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('직접 축소는 기존 범위: 열릴 때는 글자 12px 이상이지만 축소 버튼으로 더 줄일 수 있음, 화면 맞춤은 열릴 때의 보기로 복귀', { skip: SKIP }, async () => {
  const page = await open(20, { sel: 1 });
  const open0 = await fontPx(page);
  for (let i = 0; i < 3; i++) await page.click('[data-t=zoom-out]');
  assert.ok((await fontPx(page)) < 12, '사용자가 줄이면 12px 아래도 가능');
  await page.click('[data-t=zoom-fit]');
  assert.ok(Math.abs((await fontPx(page)) - open0) < 0.01, '화면 맞춤 = 열릴 때 보기');
  assert.ok(await op(page, '[data-t=node].sel') === 1);
  await page.close();
});
