// 작업274-4: 개념 지도의 지도 시트(<dialog> 전체 화면 시트 / 768px 이상 큰 팝업) — 열기·닫기(버튼·ESC·뒤로 가기), 크기, 열 때 자동 맞춤(글자 크기 하한)과 [전체 보기], 확대·축소 버튼·한계,
// 연결선 클릭 영역 28px, 한 줄 툴바(44px·SVG 아이콘·이모지 없음), 안내·오류 문구가 캔버스 위 겹침(캔버스 크기 불변), 미리보기 중 닫기 = 취소 + 안내, 선택 상태 정리, 읽기 전용 시트.
// 시트 안 편집(드래그 저장·탭-탭 연결·개념 선택·저장·최적화)은 cmap_map / cmap_save 테스트가 같은 시트에서 확인한다.
// 서버는 실제 routes/concept_map.js + 가짜 DB, AI 는 모의. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_sheet.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t, { width = 390, height = 844 } = {}) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width, height, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
// 교차하는 연결 두 개(a-b, c-d)가 있는 4노드 지도. wide: 노드 하나를 아주 멀리 둔다
async function world(page, { wide = false } = {}) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (const term of ['가', '나', '다', '라']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  const at = wide ? [[0, 0], [60, 100], [2000, 0], [2000, 100]] : [[20, 20], [200, 130], [20, 130], [200, 20]];
  for (let i = 0; i < 4; i++) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: ids[i] }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${ids[i]}`, { x: at[i][0], y: at[i][1] }); }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[1], label: '만든다', relation_type: '일으킴' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[2], to_concept_id: ids[3], label: '헷갈림', relation_type: '구별' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  await page.eval('refresh()'); await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor("document.querySelectorAll('#concept-list > *').length >= 4", 6000, '개념 목록');
  await page.click('#act-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000, '지도 화면');
  return { sci, ids, map };
}
const openSheet = async page => { await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 4000, '지도 시트'); };
const isOpen = page => page.eval("document.getElementById('map-sheet').open");
const closed = page => page.waitFor("!document.getElementById('map-sheet').open", 4000, '지도 시트 닫힘');
const view = page => page.eval('window.CmapMap._state().view');
const canvasRect = page => page.eval("(() => { const r = document.getElementById('map-svg').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()");
const nodeRect = (page, id) => page.eval(`(() => { const r = document.querySelector('[data-node="${id}"] rect').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
const insideCanvas = (c, n) => n.l >= c.l - 1 && n.t >= c.t - 1 && n.r <= c.r + 1 && n.b <= c.b + 1;
const key = (page, k, code) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: code === 'Escape' ? 27 : 0 }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: code === 'Escape' ? 27 : 0 }));

test('열기·닫기: [지도 열기] → 시트, [닫기]·ESC·브라우저 뒤로 가기로 닫히고 포커스가 [지도 열기]로 돌아온다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  assert.equal(await isOpen(page), false);
  assert.equal(await page.eval('history.length') >= 1, true);
  // 버튼
  await openSheet(page);
  assert.equal(await page.eval("document.documentElement.classList.contains('map-open')"), true, '배경 스크롤 잠금');
  assert.equal(await page.eval("history.state && history.state.metisCmapSheet === true"), true, '뒤로 가기용 기록 한 칸');
  await page.click('#map-sheet-close'); await closed(page);
  assert.equal(await page.eval("document.documentElement.classList.contains('map-open')"), false);
  assert.equal(await page.eval("!(history.state && history.state.metisCmapSheet)"), true, '쌓은 기록을 되돌림');
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'map-open', '포커스가 열기 버튼으로');
  // ESC
  await openSheet(page);
  await key(page, 'Escape', 'Escape');
  await closed(page);
  // 뒤로 가기
  await openSheet(page);
  await page.eval('history.back(); 0');
  await closed(page);
  assert.equal(await page.eval("document.documentElement.classList.contains('map-open')"), false);
  assert.equal(await page.eval("document.getElementById('map-view').hidden"), false, '뒤로 가기는 시트만 닫고 지도 화면에 머문다');
  // 다시 열어도 정상(기록이 꼬이지 않음)
  await openSheet(page);
  assert.equal(await isOpen(page), true);
  await page.click('#map-sheet-close'); await closed(page);
});

test('크기: 390px = 화면 전체(모서리·테두리 없음), 768px 이상 = 큰 팝업(가운데, 최대 1200px, 테두리·카드 모서리)', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await openSheet(page);
  const m = await page.eval("(() => { const r = document.getElementById('map-sheet').getBoundingClientRect(), cs = getComputedStyle(document.getElementById('map-sheet')); return { l: r.left, t: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth }; })()");
  assert.deepEqual([m.l, m.t, m.w, m.h], [0, 0, m.vw, m.vh], JSON.stringify(m));
  assert.equal(m.radius, '0px'); assert.equal(m.border, '0px');
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.click('#map-sheet-close'); await closed(page);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  await openSheet(page);
  const w = await page.eval("(() => { const r = document.getElementById('map-sheet').getBoundingClientRect(), cs = getComputedStyle(document.getElementById('map-sheet')); return { l: r.left, t: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopWidth }; })()");
  assert.equal(Math.round(w.w), Math.min(1200, w.vw - 48)); assert.equal(Math.round(w.h), w.vh - 48);
  assert.equal(Math.round(w.l), Math.round((w.vw - w.w) / 2)); assert.equal(Math.round(w.t), 24);
  assert.ok(w.radius > 0 && w.border === '1px', JSON.stringify(w));
  assert.equal(await page.hasHorizontalScroll(), false);
  // 큰 화면에서 캔버스가 커지고 노드가 모두 보인다
  const c = await canvasRect(page);
  assert.ok(c.w > 900 && c.h > 400, JSON.stringify(c));
});

test('열 때 자동 맞춤: 작은 지도는 노드가 모두 캔버스 안, 넓은 지도는 글자 크기 하한(12/13)으로 열고 [전체 보기]로 전체를 맞춘다', { skip: SKIP }, async t => {
  const { page, srv } = await open(t);
  const w = await world(page);
  await openSheet(page);
  const c = await canvasRect(page);
  for (const id of w.ids) assert.ok(insideCanvas(c, await nodeRect(page, id)), '작은 지도: 노드 ' + id + ' 가 캔버스 안');
  assert.ok((await view(page)).scale >= 12 / 13 - 0.01 || (await view(page)).scale <= 1);
  await page.click('#map-sheet-close'); await closed(page);
  // 넓은 지도
  const t2 = await open(t);
  const w2 = await world(t2.page, { wide: true });
  await openSheet(t2.page);
  const v = await view(t2.page);
  assert.ok(Math.abs(v.scale - 12 / 13) < 0.001, '하한 배율로 열림: ' + v.scale);
  const c2 = await canvasRect(t2.page);
  assert.ok(insideCanvas(c2, await nodeRect(t2.page, w2.ids[0])), '왼쪽 위(첫 노드)부터 보임');
  assert.equal(insideCanvas(c2, await nodeRect(t2.page, w2.ids[2])), false, '멀리 있는 노드는 열었을 때 화면 밖(끌어서 보거나 전체 보기)');
  await t2.page.click('#map-fit');
  const v2 = await view(t2.page);
  assert.ok(v2.scale < 12 / 13, '전체 보기는 하한 없이 전체를 맞춤: ' + v2.scale);
  for (const id of w2.ids) assert.ok(insideCanvas(await canvasRect(t2.page), await nodeRect(t2.page, id)), '전체 보기 뒤 노드 ' + id + ' 가 캔버스 안');
  assert.ok(srv);
});

test('확대·축소 버튼: ×1.25 / ×0.8(캔버스 가운데 기준), 한도 3 ~ 0.05, 휠도 같은 한도', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await openSheet(page);
  const s0 = (await view(page)).scale;
  const centerOf = async () => { const v = await view(page), c = await canvasRect(page); return { x: v.tx + c.w / v.scale / 2, y: v.ty + c.h / v.scale / 2 }; };
  const c0 = await centerOf();
  await page.click('#map-zoom-in');
  const s1 = (await view(page)).scale;
  assert.ok(Math.abs(s1 - Math.min(3, s0 * 1.25)) < 0.001, `확대 ${s0} → ${s1}`);
  const c1 = await centerOf();
  assert.ok(Math.abs(c1.x - c0.x) < 0.5 && Math.abs(c1.y - c0.y) < 0.5, '가운데가 제자리');
  await page.click('#map-zoom-out');
  assert.ok(Math.abs((await view(page)).scale - s1 * 0.8) < 0.001);
  for (let i = 0; i < 20; i++) await page.click('#map-zoom-in');
  assert.ok(Math.abs((await view(page)).scale - 3) < 0.001, '확대 한도 3');
  for (let i = 0; i < 40; i++) await page.click('#map-zoom-out');
  assert.ok(Math.abs((await view(page)).scale - 0.05) < 0.001, '축소 한도 0.05');
  await page.click('#map-fit');
  assert.ok((await view(page)).scale > 0.05);
});

test('연결선 클릭 영역은 화면 28px 고정(non-scaling-stroke)이고 연결선을 누르면 시트 안에서 연결 수정 창이 열린다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await openSheet(page);
  const hit = await page.eval("(() => { const cs = getComputedStyle(document.querySelector('.m-edge-hit')); return { w: cs.strokeWidth, v: cs.vectorEffect, p: cs.pointerEvents }; })()");
  assert.deepEqual(hit, { w: '28px', v: 'non-scaling-stroke', p: 'stroke' });
  await page.click('#map-zoom-out');                                                   // 축소해도 클릭 영역이 화면 크기로 유지됨
  const p = await page.eval(`(() => { const svg = document.getElementById('map-svg'), path = document.querySelector('.m-edge .m-edge-hit'); const pt = path.getPointAtLength(path.getTotalLength() / 2); const sp = svg.createSVGPoint(); sp.x = pt.x; sp.y = pt.y; const m = sp.matrixTransform(path.getScreenCTM()); return { x: m.x, y: m.y }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y + 10, button: 'left', clickCount: 1 });   // 선에서 10px 떨어진 곳도 눌림
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y + 10, button: 'left', clickCount: 1 });
  await page.waitFor("document.getElementById('edge-dlg').open", 3000, '연결 수정 창');
  assert.equal(await page.eval("document.getElementById('edge-heading').textContent"), '연결 고치기');
  await page.click('#edge-cancel');
  assert.equal(await isOpen(page), true, '연결 창을 닫아도 시트는 열려 있음');
});

test('툴바: 한 줄·각 44px 이상·SVG 아이콘·이모지 없음, 해설·복습에서 여는 시트는 편집 도구가 없는 읽기 전용', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await openSheet(page);
  const tb = await page.eval("[...document.querySelectorAll('.sheet-tools .tool')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { id: b.id, t: Math.round(r.top), w: r.width, h: r.height, svg: !!b.querySelector('svg'), txt: b.textContent.trim() }; })");
  assert.deepEqual(tb.map(b => b.id), ['map-pick-toggle', 'map-save', 'map-opt', 'map-fit', 'map-zoom-in', 'map-zoom-out'].filter(id => id !== 'map-save' || true));
  assert.equal(new Set(tb.map(b => b.t)).size, 1, '한 줄: ' + JSON.stringify(tb.map(b => b.t)));
  assert.ok(tb.every(b => b.w >= 44 && b.h >= 44 && b.svg), JSON.stringify(tb));
  assert.ok(!/\p{Extended_Pictographic}/u.test(tb.map(b => b.txt).join('')), '이모지 없음');
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.click('#map-sheet-close'); await closed(page);
  // 복습 탭의 [지도 열기] = 읽기 전용
  await page.click('#tab-review'); await page.waitFor("!!document.getElementById('review-open-map')", 4000);
  await page.click('#review-open-map'); await page.waitFor("document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.eval("document.getElementById('map-sheet').classList.contains('ro')"), true);
  const vis = await page.eval("[...document.querySelectorAll('.sheet-tools .tool')].filter(b => b.offsetParent !== null).map(b => b.id)");
  assert.deepEqual(vis, ['map-fit', 'map-zoom-in', 'map-zoom-out']);
  await page.click('#map-sheet-close'); await closed(page);
});

test('안내·오류 문구는 캔버스 위 겹침: 문구가 나타나도 캔버스 크기는 그대로이고 문구는 캔버스 안에 있다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await openSheet(page);
  const before = await canvasRect(page);
  const hint = await page.eval("(() => { const h = document.getElementById('map-hint').getBoundingClientRect(), c = document.getElementById('map-canvas').getBoundingClientRect(); return { inside: h.top >= c.top && h.bottom <= c.bottom + 1, text: document.getElementById('map-hint').textContent }; })()");
  assert.ok(hint.inside && hint.text.length > 0, JSON.stringify(hint));
  srv.db.failOn = /^UPDATE cmap_map_nodes/;                                           // 노드 이동 저장 실패 → 오류 문구
  const r = await nodeRect(page, w.ids[0]);
  const x = (r.l + r.r) / 2, y = (r.t + r.b) / 2;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 8 * i, y: y + 5 * i, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 48, y: y + 30, button: 'left', clickCount: 1 });
  await page.waitFor("document.getElementById('map-msg').textContent.length > 0", 4000, '오류 문구');
  const after = await canvasRect(page);
  assert.deepEqual([after.w, after.h], [before.w, before.h], '캔버스 크기 불변');
  const msg = await page.eval("(() => { const m = document.getElementById('map-msg').getBoundingClientRect(), c = document.getElementById('map-canvas').getBoundingClientRect(); return m.top >= c.top && m.bottom <= c.bottom + 1 && m.left >= c.left - 1 && m.right <= c.right + 1; })()");
  assert.equal(msg, true, '오류 문구가 캔버스 안(겹침)');
  srv.db.failOn = null;
});

test('시트를 닫을 때: 연결용 선택은 초기화되고, 배치 최적화 미리보기는 취소되며 안내가 남는다(서버 위치는 그대로)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await openSheet(page);
  // 연결용 선택 → 닫기 → 선택 해제
  await page.click(`[data-node="${w.ids[0]}"] rect`);
  assert.equal((await page.eval('window.CmapMap._state()')).selected, w.ids[0]);
  await page.click('#map-sheet-close'); await closed(page);
  assert.equal((await page.eval('window.CmapMap._state()')).selected, null);
  // 미리보기 → 닫기 → 취소 + 안내
  await openSheet(page);
  const posBefore = JSON.stringify(srv.db.nodes.map(n => [n.concept_id, n.x, n.y]));
  await page.click('#map-opt');
  await page.waitFor("!document.getElementById('map-opt-bar').hidden", 4000, '미리보기');
  assert.ok(await page.eval('window.CmapMap._preview()'));
  await page.click('#map-sheet-close'); await closed(page);
  assert.equal(await page.eval('window.CmapMap._preview()'), null, '미리보기는 취소됨');
  assert.match(await page.eval("document.getElementById('map-page-note').textContent"), /미리보기를 취소했어요/);
  assert.equal(JSON.stringify(srv.db.nodes.map(n => [n.concept_id, n.x, n.y])), posBefore, '서버 위치는 그대로');
  await openSheet(page);
  assert.equal(await page.eval("document.getElementById('map-opt-bar').hidden"), true, '다시 열어도 미리보기는 없음');
  assert.equal(await page.eval("document.getElementById('map-opt').disabled"), false);
  // 안내는 시트를 다시 열고 닫아도 남아 있지 않다(다음 닫기 때 새로 정해짐)
  await page.click('#map-sheet-close'); await closed(page);
  assert.equal(await page.eval("document.getElementById('map-page-note').textContent"), '');
});

test('열었다 닫은 뒤 페이지 상태: 한 줄 상태(개념·연결·저장 상태)가 갱신되고 시트 밖 조작이 정상이다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  assert.equal(await page.eval("document.getElementById('map-meta').textContent"), '개념 4개 · 연결 2개 · 저장됨');
  await openSheet(page);
  await page.click('#map-pick-toggle');
  await page.waitFor("document.querySelectorAll('#map-pick-list .pick-row').length === 4", 4000);
  await page.click('#pick-' + (await page.eval("window.CmapMap._state().nodes[0].id")));                 // 노드 하나를 지도에서 뺌(연결이 있으면 확인창)
  await page.waitFor("document.getElementById('confirm-dlg').open", 4000, '확인창');
  await page.click('#confirm-ok');
  await page.waitFor("!document.getElementById('confirm-dlg').open", 4000);
  await page.click('#map-sheet-close'); await closed(page);
  const meta = await page.eval("document.getElementById('map-meta').textContent");
  assert.match(meta, /^개념 3개 · 연결 [01]개 · 저장 후 변경됨$/);
  await page.click('#tab-narr'); await page.waitFor("document.getElementById('map-view').classList.contains('narr-mode')", 4000);
  assert.equal(await page.hasHorizontalScroll(), false);
});
