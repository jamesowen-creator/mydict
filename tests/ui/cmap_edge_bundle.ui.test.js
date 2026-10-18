// 작업304-1: 같은 부모·같은 종류 연결의 곡선 다발이 실제 화면에서 동작하는지 — 편집 시트(나란히 출발·종류별 자리·라벨), 클릭(갈라진 뒤 쪽만), 퀴즈, PDF용 SVG.
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
const isCurve = d => /^M[-\d.]+,[-\d.]+ C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+$/.test(d);

async function build(t, { title, terms, at, edges }) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title })).topic;
  const ids = [];
  for (const term of terms) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: at[i][0], y: at[i][1] }); }
  const made = [];
  for (const [a, b, type, label] of edges) made.push((await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[a], to_concept_id: ids[b], relation_type: type, label })).edge);
  await page.eval('refresh()'); await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor(`document.getElementById('map-sheet').open && document.querySelectorAll('#map-svg .m-edge').length === ${edges.length}`, 6000); await sleep(250);
  await page.click('#map-fit');
  return { page, ids, edges: made };
}
// 부모 a 가 위, 자식 b·c·d 가 아래(같은 줄). 연결: a→b·c·d 모두 '일부'+문구 '열'(한 다발), a→e '종류'(별도 다발, 화살촉 없음), b→c 대립(굵은 쌍방향)
const world = t => build(t, {
  title: '과학', terms: ['a개념', 'b개념', 'c개념', 'd개념', 'e개념'], at: [[200, 20], [20, 200], [200, 200], [380, 200], [560, 200]],
  edges: [[0, 1, '일부', '열'], [0, 2, '일부', '열'], [0, 3, '일부', '열'], [0, 4, '종류', '쓴다'], [1, 2, '대립', '닮음']],
});
const rows = page => page.eval(`[...document.querySelectorAll('#map-svg .m-edge')].map(g => ({ id: Number(g.dataset.edge), t: g.dataset.t, role: g.getAttribute('role'), tab: g.getAttribute('tabindex'), aria: g.getAttribute('aria-label'),
  d: g.querySelector('.m-edge-line').getAttribute('d'), hit: g.querySelector('.m-edge-hit').getAttribute('d'), marker: g.querySelector('.m-edge-line').getAttribute('marker-end'), label: g.querySelector('.m-edge-label').textContent, n: g.children.length,
  w: getComputedStyle(g.querySelector('.m-edge-line')).strokeWidth }))`);
const screenPt = (page, sel, nth, len) => page.eval(`(() => { const svg = document.getElementById('map-svg'), path = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; const q = path.getPointAtLength(${len}); const p = svg.createSVGPoint(); p.x = q.x; p.y = q.y; const s = p.matrixTransform(path.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
const click = async (page, pt) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
};

test('편집 시트: 같은 부모·종류 3개는 곡선 다발(M C, 시작이 STRAND_GAP 간격으로 나란히, 끝 접선 아래, 화살촉), 종류가 다른 연결은 다른 다발(BUNDLE_GAP), 방향 없음은 지금 방식', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, edges } = await world(t);
  const r = await rows(page);
  assert.equal(r.length, 5);
  const by = new Map(r.map(x => [x.id, x]));
  const bundle = edges.slice(0, 3).map(e => by.get(e.id)), usage = by.get(edges[3].id), sym = by.get(edges[4].id);
  for (const b of bundle) {
    assert.ok(isCurve(b.d), '곡선 한 개(M C): ' + b.d);
    const p = pts(b.d);
    assert.equal(p[1], 64, '부모(y=20) 아래 가장자리에서 출발'); assert.equal(p[0], p[2], '시작 접선은 아래'); assert.equal(p[4], p[6], '끝 접선도 아래(화살촉이 아래를 향함)'); assert.ok(p[5] < p[7]);
    assert.equal(b.marker, 'url(#m-arrow)', '화살촉은 각 선 끝'); assert.equal(b.w, '1.2px');
    assert.equal(b.t, 'edge'); assert.equal(b.role, 'button'); assert.equal(b.tab, '0'); assert.match(b.aria, /눌러서 고치기/); assert.equal(b.n, 3, '연결마다 g 안에 hit·line·label 3개 유지');
    assert.ok(isCurve(b.hit) && b.hit !== b.d, '클릭 영역은 t≥0.6 부분 곡선: ' + b.hit);
    assert.ok(pts(b.hit)[1] > 120, '클릭 영역은 다발 구간(위쪽)을 포함하지 않음');
  }
  const sx = bundle.map(b => pts(b.d)[0]);
  assert.equal(sx[1] - sx[0], 6); assert.equal(sx[2] - sx[1], 6);
  assert.equal(bundle.filter(b => b.label === '열').length, 1, '문구가 같으면 다발에 라벨 한 번'); assert.equal(bundle.filter(b => b.label === '').length, 2);
  assert.ok(isCurve(usage.d) && usage.label === '쓴다' && usage.marker === null, '종류가 다른 연결은 별도 다발(자식 1개도 다발), 종류는 화살촉 없음');
  assert.equal(pts(usage.d)[0] - sx[2], 16, '종류가 다른 다발과의 간격 BUNDLE_GAP');
  assert.ok(isCurve(sym.d) && sym.marker === 'url(#m-arrow-opp)' && sym.label === '닮음', '대립은 다발이 아닌 곡선, 대립용 화살촉');
  noErrors(page);
});

test('클릭: 갈라진 뒤(t≥0.6) 쪽을 누르면 그 연결의 고치기 시트가 열리고, 시작 부근 다발 구간은 반응이 없다', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, edges } = await world(t);
  const r = await rows(page);
  const idx = r.findIndex(x => x.id === edges[0].id);
  const startPt = await screenPt(page, '#map-svg .m-edge-line', idx, 8);   // 경로 길이 8 = 부모 아래 다발 구간
  await click(page, startPt); await sleep(300);
  assert.equal(await page.eval("document.getElementById('edge-dlg').open"), false, '다발 구간은 반응 없음');
  const hitLen = await page.eval(`document.querySelectorAll('#map-svg .m-edge-hit')[${idx}].getTotalLength()`);
  const branchPt = await screenPt(page, '#map-svg .m-edge-hit', idx, hitLen * 0.6);
  await click(page, branchPt);
  await page.waitFor("document.getElementById('edge-dlg').open", 3000, '연결 고치기');
  assert.match(await page.eval("document.getElementById('edge-dlg').innerText"), /b개념/, '눌린 선의 연결(a→b)이 열림');
  noErrors(page);
});

test('퀴즈 모드도 같은 규칙(같은 부모 + 같은 종류 이름)으로 다발이 되고 화면의 선은 routeAll 결과와 같다, data-answer 유지', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, ids } = await world(t);
  await page.eval("window.CmapMap.setMode('map'); 0");
  const nodes = ids.map((id, i) => ({ id, term: '개념' + i }));
  await page.eval(`window.CmapMap.quizBegin(${JSON.stringify(nodes)}); window.CmapMap.setMode('quiz'); 0`);
  await page.waitFor("!!document.querySelector('#map-svg .m-node')", 4000, '퀴즈 지도');
  const pos = await page.eval(`[...document.querySelectorAll('#map-svg .m-node')].map(g => { const m = g.getAttribute('transform').match(/-?[\\d.]+/g).map(Number); return { id: Number(g.dataset.node), x: m[0], y: m[1] }; })`);
  // 퀴즈 노드는 결정적으로 흩어진다: 다발이 성립하는 부모+자식 2개를 같은 방식으로 찾는다
  const pick = await page.eval(`(() => { const pos = ${JSON.stringify(pos)}; for (const p of pos) { const low = pos.filter(n => n.y >= p.y + 44 + CmapEdgeRoute.MIN_GAP && n.id !== p.id);
    for (let i = 0; i < low.length; i++) for (let j = i + 1; j < low.length; j++) { const ans = [low[i], low[j]].map(k => ({ from: p.id, to: k.id, type: '일부' }));
      const r = CmapEdgeRoute.routeAll(pos, ans.map(a => ({ key: a.from + '-' + a.to, from: a.from, to: a.to, label: '일부', type: '일부' })));
      if ([...r.values()].every(v => v.group)) return ans; } } return null; })()`);
  assert.ok(pick, '이 흩어짐에서 다발이 성립하는 부모가 있어야 테스트가 의미 있음');
  const show = async answers => {
    await page.eval(`window.CmapMap.quizSetAnswers(${JSON.stringify(answers)}); 0`);
    await page.waitFor(`document.querySelectorAll('#map-svg [data-answer]').length === ${answers.length}`, 4000, '퀴즈 답 선');
    return page.eval(`[...document.querySelectorAll('#map-svg [data-answer]')].map(g => ({ a: g.dataset.answer, d: g.querySelector('.m-edge-line').getAttribute('d'), marker: g.querySelector('.m-edge-line').getAttribute('marker-end'), label: g.querySelector('.m-edge-label').textContent, hit: !!g.querySelector('.m-edge-hit') }))`);
  };
  const expect = answers => page.eval(`(() => { const pos = ${JSON.stringify(pos)}; const r = CmapEdgeRoute.routeAll(pos, ${JSON.stringify(answers)}.map(a => ({ key: a.from + '-' + a.to, from: a.from, to: a.to, label: a.type || '', type: a.type || null }))); return [...r].map(([k, v]) => [k, v.d, v.group, v.noLabel]); })()`);
  const q = await show(pick), e1 = await expect(pick);
  assert.deepEqual(q.map(x => x.a).sort(), pick.map(a => a.from + '-' + a.to).sort(), 'data-answer 유지');
  for (const [k, d, g] of e1) { assert.equal(q.find(x => x.a === k).d, d, '퀴즈 화면의 선은 routeAll 결과와 같다: ' + k); assert.ok(g, '다발'); }
  for (const x of q) { assert.ok(isCurve(x.d)); assert.equal(x.marker, 'url(#m-arrow)'); assert.equal(x.hit, false, '퀴즈에는 클릭 영역 없음(기존)'); }
  assert.equal(q.filter(x => x.label === '일부').length, 1, '다발 라벨은 한 번'); assert.equal(q.filter(x => x.label === '').length, 1);
  // 종류가 다르면 다른 다발(라벨은 각자)
  const mixed = [{ ...pick[0] }, { ...pick[1], type: '종류' }];
  const q2 = await show(mixed), e2 = await expect(mixed);
  for (const [k, d] of e2) assert.equal(q2.find(x => x.a === k).d, d, '종류가 다른 경우도 routeAll 결과와 같다: ' + k);
  assert.notEqual(e2[0][2], e2[1][2], '종류가 다르면 다른 다발(group)');
  assert.equal(q2.filter(x => x.label !== '').length, 2, '라벨은 각자 하나씩');
  await page.eval("window.CmapMap.quizEnd(); window.CmapMap.setMode('map'); 0");
  noErrors(page);
});

test('PDF: 만든 SVG 에 다발 곡선(한 개의 M C)·선 굵기·화살촉 값이 인라인으로 들어가고 클릭 영역은 없다', { skip: SKIP, timeout: 90000 }, async t => {
  const { page } = await world(t);
  await page.eval(`(() => { window.__svg = ''; window.CmapPdf.deliverImpl = async () => 'stub'; const o = XMLSerializer.prototype.serializeToString; XMLSerializer.prototype.serializeToString = function (n) { const s = o.call(this, n); if (n && n.querySelector && n.querySelector('.m-edge-line')) window.__svg = s; return s; }; })()`);
  await page.eval("document.getElementById('map-pdf').click()");
  await page.waitFor("window.__svg.length > 0", 20000, 'PDF 용 SVG');
  await page.waitFor("!document.getElementById('map-pdf').disabled", 20000);
  const doc = await page.eval(`(() => { const d = new DOMParser().parseFromString(window.__svg, 'image/svg+xml');
    return { lines: [...d.querySelectorAll('.m-edge-line')].map(el => ({ d: el.getAttribute('d'), style: el.getAttribute('style') || '', marker: el.getAttribute('marker-end') })), labels: [...d.querySelectorAll('.m-edge-label')].map(el => el.textContent), hit: d.querySelectorAll('.m-edge-hit').length, mk: [d.querySelector('marker#m-arrow') && d.querySelector('marker#m-arrow').getAttribute('markerWidth')] }; })()`);
  assert.equal(doc.lines.length, 5);
  assert.ok(doc.lines.every(l => isCurve(l.d)), '모든 선이 M C 한 개');
  assert.equal(doc.lines.filter(l => /stroke-width:\s*2\.2(px)?(;|$)/.test(l.style)).length, 1, '대립만 2.2'); assert.equal(doc.lines.filter(l => /stroke-width:\s*1\.2(px)?(;|$)/.test(l.style)).length, 4);
  assert.equal(doc.lines.filter(l => l.marker === 'url(#m-arrow)').length, 3, '일부 3개에 일반 화살촉(종류는 없음, 대립은 대립용 화살촉)');
  assert.equal(doc.lines.filter(l => l.marker === 'url(#m-arrow-opp)').length, 1, '대립 1개');
  assert.equal(doc.labels.filter(x => x === '열').length, 1, '다발 라벨 한 번');
  assert.equal(doc.hit, 0); assert.deepEqual(doc.mk, ['7']);
  noErrors(page);
});

// 사용자 캡처 구조(증권 → 유가 증권, 유가 증권 아래 종류 3개 + 일부 1개, 주식 아래 일부 1개). 종류 3개의 문구가 서로 다르다
const world2 = t => build(t, {
  title: '증권', terms: ['증권', '유가 증권', '주식', '회사채', '조건환매', '국공채', 'IPO'], at: [[306, 0], [306, 96], [0, 192], [204, 192], [408, 192], [612, 192], [0, 288]],
  edges: [[0, 1, '종류', '증권의 종류'], [1, 2, '종류', '종류'], [1, 3, '종류', '채권 종류'], [1, 4, '종류', '종류'], [1, 5, '일부', '일부'], [2, 6, '일부', '일부']],
});

test('304-1 종류별 다발: 종류 3개(문구가 서로 다름)는 나란히 출발해 각 선 끝에 자기 문구, 일부는 BUNDLE_GAP 만큼 떨어진 다른 다발, 직각·폴백 곡선 없이 모두 M C', { skip: SKIP, timeout: 90000 }, async t => {
  const { page, edges } = await world2(t);
  const r = await rows(page), by = new Map(r.map(x => [x.id, x]));
  assert.ok(r.every(x => isCurve(x.d)), '모두 한 개의 M C');
  const kinds = [1, 2, 3].map(i => by.get(edges[i].id)), part = by.get(edges[4].id), single = by.get(edges[0].id);
  assert.deepEqual(kinds.map(x => x.label), ['종류', '채권 종류', '종류'], '문구가 다르면 각 선 끝에 자기 문구');
  const sx = kinds.map(k => pts(k.d)[0]);
  assert.ok(sx[0] < sx[1] && sx[1] < sx[2] && sx[1] - sx[0] === 6 && sx[2] - sx[1] === 6, '종류 3개는 6px 간격으로 나란히: ' + sx);
  assert.equal(pts(part.d)[0] - sx[2], 16, '일부 다발은 BUNDLE_GAP 만큼 떨어짐');
  assert.ok(isCurve(single.d) && single.label === '증권의 종류', '자식 1개도 다발(곧게 내려오는 곡선)');
  // 갈라진 뒤 쪽이 짧아도 클릭 영역(28px 화면 고정)이 있고, 누르면 그 연결의 시트가 열린다
  const idx = r.findIndex(x => x.id === edges[2].id);
  const len = await page.eval(`document.querySelectorAll('#map-svg .m-edge-hit')[${idx}].getTotalLength()`);
  assert.ok(len > 0);
  assert.equal(await page.eval(`getComputedStyle(document.querySelectorAll('#map-svg .m-edge-hit')[${idx}]).strokeWidth`), '28px');
  await click(page, await screenPt(page, '#map-svg .m-edge-hit', idx, len / 2));
  await page.waitFor("document.getElementById('edge-dlg').open", 3000, '연결 고치기');
  assert.match(await page.eval("document.getElementById('edge-dlg').innerText"), /회사채/);
  noErrors(page);
});

// 305-1: 종류가 좌우로 끼어 있는 저장 위치(주식 289, 회사채 493, 국공채 697, 조건환매부채권 901 — 주식·회사채·조건환매 = 종류, 국공채 = 일부)
const world3 = t => build(t, {
  title: '증권3', terms: ['유가 증권', '주식', '회사채', '국공채', '조건환매'], at: [[595, 0], [289, 96], [493, 96], [697, 96], [901, 96]],
  edges: [[0, 1, '종류', '종류'], [0, 2, '종류', '종류'], [0, 3, '일부', '일부'], [0, 4, '종류', '종류']],
});

test('305-1 저장 위치(종류가 끼어 있음): 부모 아래 출발 순서 = 자식 좌우 순서(교차 없음), 다발 3개의 라벨이 각각 한 번, 종류 사이 BUNDLE_GAP, PDF용 SVG 에서도 같은 M C 경로', { skip: SKIP, timeout: 90000 }, async t => {
  const { page } = await world3(t);
  const r = await rows(page);
  assert.equal(r.length, 4);
  assert.ok(r.every(x => isCurve(x.d)), '모두 M C 한 개');
  const sx = r.map(x => pts(x.d)[0]), ex = r.map(x => pts(x.d)[6]);
  // DOM 순서 = 연결 생성 순서 = 자식 x 순서(주식, 회사채, 국공채, 조건환매부채권)
  assert.ok(ex[0] < ex[1] && ex[1] < ex[2] && ex[2] < ex[3], '도착 x 순서: ' + ex);
  assert.ok(sx[0] < sx[1] && sx[1] < sx[2] && sx[2] < sx[3], '출발 x 순서가 도착 순서와 같음(교차 없음): ' + sx);
  assert.deepEqual([sx[1] - sx[0], sx[2] - sx[1], sx[3] - sx[2]], [6, 16, 16], '같은 종류 6px, 종류가 바뀌는 곳 16px');
  assert.deepEqual(r.map(x => x.label), ['종류', '', '일부', '종류'].map((l, i) => (i === 1 ? '' : l)), '다발마다 라벨 한 번(종류 다발은 첫 선만, 나뉜 두 번째 종류 다발도 하나)');
  // 곡선 샘플링으로도 서로 가로지르지 않는다
  const samples = await page.eval(`[...document.querySelectorAll('#map-svg .m-edge-line')].map(p => Array.from({ length: 41 }, (_, i) => p.getPointAtLength(p.getTotalLength() * i / 40).x))`);
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(samples[a].every((x, i) => x - samples[b][i] < 1.5), `선 ${a} 와 ${b} 가 교차`);
  // PDF 용 SVG 의 경로가 화면의 경로와 같다
  await page.eval(`(() => { window.__svg = ''; window.CmapPdf.deliverImpl = async () => 'stub'; const o = XMLSerializer.prototype.serializeToString; XMLSerializer.prototype.serializeToString = function (n) { const s = o.call(this, n); if (n && n.querySelector && n.querySelector('.m-edge-line')) window.__svg = s; return s; }; })()`);
  await page.eval("document.getElementById('map-pdf').click()");
  await page.waitFor("window.__svg.length > 0", 20000, 'PDF 용 SVG');
  await page.waitFor("!document.getElementById('map-pdf').disabled", 20000);
  const pdf = await page.eval(`[...new DOMParser().parseFromString(window.__svg, 'image/svg+xml').querySelectorAll('.m-edge-line')].map(el => el.getAttribute('d'))`);
  assert.deepEqual(pdf, r.map(x => x.d), 'PDF 경로 = 화면 경로(M C 한 개)');
  noErrors(page);
});
