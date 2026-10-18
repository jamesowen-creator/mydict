// 작업302-1: 같은 부모·같은 종류·같은 문구 연결의 한 줄기 직각 가지가 실제 화면에서 동작하는지 — 편집 시트, 클릭(갈래만), 퀴즈, PDF용 SVG.
// 서버는 실제 routes/concept_map.js + 가짜 DB. 실행: node --test "tests/ui/cmap_edge_bundle.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const pts = d => d.match(/-?\d+(\.\d+)?/g).map(Number);

// 부모 a 가 위, 자식 b·c·d 가 아래(같은 줄). 연결: a→b·c·d 모두 '일으킴'+문구 '열'(한 줄기), a→e '사용'(별도 곡선), b→c 유사(방향 없음)
async function world(t) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (const term of ['a개념', 'b개념', 'c개념', 'd개념', 'e개념']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  const at = [[200, 20], [20, 200], [200, 200], [380, 200], [560, 200]];
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: at[i][0], y: at[i][1] }); }
  const edges = [];
  for (const j of [1, 2, 3]) edges.push((await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[j], relation_type: '일으킴', label: '열' })).edge);
  edges.push((await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[4], relation_type: '사용', label: '쓴다' })).edge);
  edges.push((await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[1], to_concept_id: ids[2], relation_type: '유사', label: '닮음' })).edge);
  await page.eval('refresh()'); await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open && document.querySelectorAll('#map-svg .m-edge').length === 5", 6000); await sleep(250);
  await page.click('#map-fit');
  return { page, ids, edges };
}
const rows = page => page.eval(`[...document.querySelectorAll('#map-svg .m-edge')].map(g => ({ id: Number(g.dataset.edge), t: g.dataset.t, role: g.getAttribute('role'), tab: g.getAttribute('tabindex'), aria: g.getAttribute('aria-label'),
  d: g.querySelector('.m-edge-line').getAttribute('d'), hit: g.querySelector('.m-edge-hit').getAttribute('d'), marker: g.querySelector('.m-edge-line').getAttribute('marker-end'), label: g.querySelector('.m-edge-label').textContent, n: g.children.length,
  join: getComputedStyle(g.querySelector('.m-edge-line')).strokeLinejoin, w: getComputedStyle(g.querySelector('.m-edge-line')).strokeWidth }))`);
const screenPt = (page, sel, nth, len) => page.eval(`(() => { const svg = document.getElementById('map-svg'), path = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; const q = path.getPointAtLength(${len}); const p = svg.createSVGPoint(); p.x = q.x; p.y = q.y; const s = p.matrixTransform(path.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
const click = async (page, pt) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
};

test('편집 시트: 같은 부모·종류·문구 3개는 직각 가지 한 줄기(라벨 1개, 곡선 없음, 마지막 구간 아래, 화살촉), 종류·문구가 다른 선과 방향 없음은 지금 방식', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, edges } = await world(t);
  const r = await rows(page);
  assert.equal(r.length, 5);
  const by = new Map(r.map(x => [x.id, x]));
  const bundle = edges.slice(0, 3).map(e => by.get(e.id)), usage = by.get(edges[3].id), sym = by.get(edges[4].id);
  for (const b of bundle) {
    assert.ok(!b.d.includes('C') && b.d.split('L').length >= 3, '직각 가지: ' + b.d);
    const p = pts(b.d); assert.ok(p[p.length - 1] > p[p.length - 3] && p[p.length - 2] === p[p.length - 4], '마지막 구간은 아래 방향 세로');
    assert.equal(b.marker, 'url(#m-arrow)', '화살촉은 각 갈래 끝');
    assert.equal(b.join, 'round', '둥근 모서리(stroke-linejoin)'); assert.equal(b.w, '1.2px');
    assert.equal(b.t, 'edge'); assert.equal(b.role, 'button'); assert.equal(b.tab, '0'); assert.match(b.aria, /눌러서 고치기/); assert.equal(b.n, 3, '연결마다 g 안에 hit·line·label 3개를 유지(요소 수 불변)');
    assert.ok(b.hit && b.hit !== b.d && !b.hit.includes('C'), '클릭 영역은 갈래만: ' + b.hit);
    assert.equal(pts(b.hit).length, 4);
  }
  assert.equal(new Set(bundle.map(b => pts(b.d).slice(0, 2).join(','))).size, 1, '줄기 시작점 한 자리');
  assert.equal(bundle.filter(b => b.label === '열').length, 1, '줄기 라벨은 한 번');
  assert.equal(bundle.filter(b => b.label === '').length, 2);
  assert.ok(usage.d.includes('C') && usage.label === '쓴다' && usage.hit === usage.d, '종류·문구가 다른 선은 곡선 그대로, 클릭 영역도 전체 경로');
  assert.ok(sym.d.includes('C') && sym.marker === null && sym.label === '닮음', '방향 없음은 지금 방식');
  noErrors(page);
});

test('클릭: 갈래를 누르면 그 연결의 고치기 시트가 열리고, 줄기 구간은 반응이 없다', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, edges } = await world(t);
  const r = await rows(page);
  const first = r.find(x => x.id === edges[0].id);   // 왼쪽 자식으로 가는 갈래
  const trunkPt = await screenPt(page, '#map-svg .m-edge-line', r.findIndex(x => x.id === edges[0].id), 8);   // 경로 길이 8 지점 = 부모 아래 줄기 구간
  await click(page, trunkPt); await sleep(300);
  assert.equal(await page.eval("document.getElementById('edge-dlg').open"), false, '줄기 구간은 반응 없음');
  const hitLen = await page.eval(`document.querySelectorAll('#map-svg .m-edge-hit')[${r.findIndex(x => x.id === first.id)}].getTotalLength()`);
  const branchPt = await screenPt(page, '#map-svg .m-edge-hit', r.findIndex(x => x.id === first.id), hitLen * 0.6);
  await click(page, branchPt);
  await page.waitFor("document.getElementById('edge-dlg').open", 3000, '연결 고치기');
  assert.match(await page.eval("document.getElementById('edge-dlg').innerText"), /b개념/, '눌린 갈래의 연결(a→b)이 열림');
  noErrors(page);
});

test('퀴즈 모드도 같은 규칙(같은 부모 + 같은 종류 이름 + 자식 2개 이상)으로 묶이고 data-answer 는 그대로', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, ids } = await world(t);
  await page.eval("window.CmapMap.setMode('map'); 0");
  const nodes = ids.map((id, i) => ({ id, term: '개념' + i }));
  await page.eval(`window.CmapMap.quizBegin(${JSON.stringify(nodes)}); window.CmapMap.setMode('quiz'); 0`);
  await page.waitFor("!!document.querySelector('#map-svg .m-node')", 4000, '퀴즈 지도');
  // 퀴즈 노드는 결정적으로 흩어진다: 지금 화면 위치로 부모 후보를 찾아, 묶음이 성립하는 부모+자식 2개를 같은 방식으로 고른다
  const pos = await page.eval(`[...document.querySelectorAll('#map-svg .m-node')].map(g => { const m = g.getAttribute('transform').match(/-?[\\d.]+/g).map(Number); return { id: Number(g.dataset.node), x: m[0], y: m[1] }; })`);
  const pick = await page.eval(`(() => { const pos = ${JSON.stringify(pos)}; for (const p of pos) { const low = pos.filter(n => n.y >= p.y + 44 + CmapEdgeRoute.MIN_GAP && n.id !== p.id);
    for (let i = 0; i < low.length; i++) for (let j = i + 1; j < low.length; j++) { const kids = [low[i], low[j]];
      const ans = kids.map(k => ({ from: p.id, to: k.id, type: '선행' })); const r = CmapEdgeRoute.routeAll(pos, ans.map(a => ({ key: a.from + '-' + a.to, from: a.from, to: a.to, label: '선행', type: '선행' })));
      if ([...r.values()].every(v => v.group)) return ans; } } return null; })()`);
  assert.ok(pick, '이 흩어짐에서 묶음이 성립하는 부모가 있어야 테스트가 의미 있음');
  await page.eval(`window.CmapMap.quizSetAnswers(${JSON.stringify(pick)}); 0`);
  await page.waitFor("document.querySelectorAll('#map-svg [data-answer]').length === 2", 4000, '퀴즈 답 선');
  const q = await page.eval(`[...document.querySelectorAll('#map-svg [data-answer]')].map(g => ({ a: g.dataset.answer, d: g.querySelector('.m-edge-line').getAttribute('d'), marker: g.querySelector('.m-edge-line').getAttribute('marker-end'), label: g.querySelector('.m-edge-label').textContent, hit: !!g.querySelector('.m-edge-hit') }))`);
  assert.deepEqual(q.map(x => x.a).sort(), pick.map(a => a.from + '-' + a.to).sort(), 'data-answer 유지');
  for (const x of q) { assert.ok(!x.d.includes('C') && x.d.split('L').length >= 3, '퀴즈에서도 직각 가지: ' + x.d); assert.equal(x.marker, 'url(#m-arrow)'); assert.equal(x.hit, false, '퀴즈에는 클릭 영역 없음(기존)'); }
  assert.equal(q.filter(x => x.label === '선행').length, 1, '줄기 라벨은 한 번'); assert.equal(q.filter(x => x.label === '').length, 1);
  // 종류가 다르면 묶이지 않는다
  await page.eval(`window.CmapMap.quizSetAnswers(${JSON.stringify([{ ...pick[0] }, { ...pick[1], type: '조건' }])}); 0`);
  await page.waitFor("document.querySelectorAll('#map-svg [data-answer]').length === 2", 4000);
  const q2 = await page.eval(`[...document.querySelectorAll('#map-svg [data-answer] .m-edge-line')].map(p => p.getAttribute('d'))`);
  assert.ok(q2.every(d => d.includes('C')), '종류가 다르면 곡선');
  await page.eval("window.CmapMap.quizEnd(); window.CmapMap.setMode('map'); 0");
  noErrors(page);
});

test('PDF: 만든 SVG 에 줄기 경로(M L L, 곡선 없음)와 stroke-linejoin round·화살촉 값이 인라인으로 들어가고 클릭 영역은 없다', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, edges } = await world(t);
  await page.eval(`(() => { window.__svg = ''; window.CmapPdf.deliverImpl = async () => 'stub'; const o = XMLSerializer.prototype.serializeToString; XMLSerializer.prototype.serializeToString = function (n) { const s = o.call(this, n); if (n && n.querySelector && n.querySelector('.m-edge-line')) window.__svg = s; return s; }; })()`);
  await page.eval("document.getElementById('map-pdf').click()");
  await page.waitFor("window.__svg.length > 0", 20000, 'PDF 용 SVG');
  await page.waitFor("!document.getElementById('map-pdf').disabled", 20000);
  const doc = await page.eval(`(() => { const d = new DOMParser().parseFromString(window.__svg, 'image/svg+xml');
    return { lines: [...d.querySelectorAll('.m-edge-line')].map(el => ({ d: el.getAttribute('d'), style: el.getAttribute('style') || '', marker: el.getAttribute('marker-end') })), labels: [...d.querySelectorAll('.m-edge-label')].map(el => el.textContent), hit: d.querySelectorAll('.m-edge-hit').length, mk: !!d.querySelector('marker#m-arrow') }; })()`);
  assert.equal(doc.lines.length, 5);
  const bundled = doc.lines.filter(l => !l.d.includes('C') && l.d.split('L').length >= 3);
  assert.equal(bundled.length, 3, '줄기 경로 3개가 PDF 에 들어감');
  for (const l of bundled) { assert.match(l.style, /stroke-linejoin:\s*round/); assert.match(l.style, /stroke-width:\s*1\.2(px)?(;|$)/); assert.equal(l.marker, 'url(#m-arrow)'); }
  assert.equal(doc.labels.filter(x => x === '열').length, 1, '줄기 라벨 한 번');
  assert.equal(doc.hit, 0); assert.ok(doc.mk);
  void edges;
  noErrors(page);
});
