// 작업209-4/5: 지도 팝업("지도 보기") - 열기·닫기(버튼·ESC·뒤로 가기), 배경 스크롤 잠금, 닫은 뒤 위치·선택 복원,
// 열릴 때 전체 자동 맞춤(글자 크기 하한 없음), 확대·축소 버튼과 한계, 끌기·핀치·휠, 연결선 두꺼운 클릭 영역과 연결 카드, 390/768/1024px.
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { openMap, closeMap } = require('./helpers/map');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

async function openStudy(setup, { width = 390, height = 844 } = {}) {
  srv.reset();
  setup(srv);
  const page = await browser.newPage({ width, height });
  await page.goto(srv.url + '/concept_study.html#s=' + srv.state.studies[0].id);
  await page.waitFor("!document.getElementById('view-study').hidden && !!document.querySelector('[data-t=term], #study-empty:not([hidden])')");
  return page;
}
async function done(page) { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); }
const calls = (re, method) => srv.state.log.filter(l => re.test(l.url) && (!method || l.method === method));

const five = s => s.seed({
  topic: '생물 · 세포',
  items: [{ term: '세포' }, { term: '광합성' }, { term: '엽록체' }, { term: '미토콘드리아' }, { term: '옛 개념', set: { origin: '이전됨' } }],
  links: [[0, 1, { relation_type: '포함', label: '구성함', detail: '세포는 광합성이 일어나는 장소를 포함한다.' }], [1, 2, { relation_type: '순서', label: '다음 단계', detail: '광합성은 엽록체에서 일어난다.' }], [0, 3, { relation_type: '대비', label: '짝', detail: '미토콘드리아와의 대비.' }]],
  path: [0, 1, 2],
});
const sixty = s => {
  const items = Array.from({ length: 60 }, (_, i) => ({ term: '개념' + i }));
  const links = [];
  for (let i = 1; i < 45; i++) links.push([Math.floor((i - 1) / 3), i]);
  s.seed({ items, links, path: [0, 1, 4, 13] });
};

const vb = page => page.eval("document.querySelector('[data-t=map-svg]').getAttribute('viewBox').split(' ').map(Number)");
const scaleOf = page => page.eval("(() => { const v = document.querySelector('[data-t=map-svg]').getAttribute('viewBox').split(' ').map(Number); return document.querySelector('[data-t=map-box]').clientWidth / v[2]; })()");
// 모든 노드(와 다음 제안)가 지도 상자 안에 있는가
const allInside = page => page.eval(`(() => { const b = document.querySelector('[data-t=map-box]').getBoundingClientRect(); return [...document.querySelectorAll('[data-t=node],[data-t=ghost]')].every(n => { const r = n.getBoundingClientRect(); return r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5; }); })()`);
const pressEsc = async page => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
};
const sheetOpen = page => page.eval("document.getElementById('map-sheet').open");
// 학습 화면이 스크롤되게 아래를 늘리고 일정한 위치로 내려 둔다
// ([지도 보기] 버튼을 누를 때 도우미가 버튼을 화면 가운데로 스크롤하므로, 미리 그 자리로 맞춰 두고 그때의 위치를 기준으로 삼는다)
async function scrollDown(page) {
  await page.eval(`(() => { const d = document.createElement('div'); d.style.height = '2500px'; document.body.append(d); document.querySelector('[data-t=map-open]').scrollIntoView({ block: 'center' }); })()`);
  await sleep(80);
  const got = await page.eval('window.scrollY');
  assert.ok(got > 0, '스크롤 위치를 만들 수 있어야 함');
  return got;
}

test('인라인 지도 대신 [지도 보기] 버튼: 개념·연결 개수가 보이고 누르기 전에는 지도가 없음', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  assert.equal(await page.exists('[data-t="map-svg"]'), false);
  assert.equal(await page.exists('[data-t="map-box"]'), false);
  assert.equal(await page.text('[data-t="map-open"]'), '지도 보기');
  assert.equal(await page.text('[data-t="map-meta"]'), '개념 5개 · 연결 3개');
  assert.equal(await sheetOpen(page), false);
  const h = await page.eval("document.querySelector('[data-t=map-open]').getBoundingClientRect().height");
  assert.ok(h >= 43.5, '버튼 높이 44px 이상');
  await done(page);
});

test('팝업 열기·닫기: 닫기 버튼, 닫으면 처음 화면 위치·선택·포커스 복원', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  const y = await scrollDown(page);
  const hash = await page.eval('location.hash');
  const selected = await page.text('[data-t="term"]');
  await openMap(page);
  assert.equal(await page.eval("document.documentElement.classList.contains('map-open')"), true);
  assert.equal(await page.text('#map-sheet-title'), '개념 지도');
  await closeMap(page);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.eval("document.documentElement.classList.contains('map-open')"), false);
  assert.equal(await page.eval('window.scrollY'), y, '화면 위치 복원');
  assert.equal(await page.text('[data-t="term"]'), selected, '선택 유지');
  assert.equal(await page.eval('location.hash'), hash, '주소(해시) 그대로');
  assert.equal(await page.eval("document.activeElement && document.activeElement.getAttribute('data-t')"), 'map-open', '포커스가 [지도 보기]로 돌아옴');
  assert.equal(await page.eval('history.state && history.state.metisMapSheet'), null, '우리가 쌓은 기록은 정리됨');
  assert.equal(await page.exists('[data-t="map-svg"]'), false, '닫으면 지도를 비움');
  // 다시 열어도 정상, 학습 화면의 뒤로 가기 버튼도 정상
  await openMap(page);
  await closeMap(page);
  await page.click('#back-btn');
  await page.waitFor("!document.getElementById('view-list').hidden");
  await done(page);
});

test('팝업 닫기: ESC', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  const y = await scrollDown(page);
  await openMap(page);
  await pressEsc(page);
  await page.waitFor("!document.getElementById('map-sheet').open");
  assert.equal(await page.eval('window.scrollY'), y);
  assert.equal(await page.eval('history.state && history.state.metisMapSheet'), null);
  assert.equal(await page.eval("document.documentElement.classList.contains('map-open')"), false);
  // 한 번 더 열어 ESC로 닫아도 같음(기록이 쌓이지 않음)
  await openMap(page);
  await pressEsc(page);
  await page.waitFor("!document.getElementById('map-sheet').open");
  await page.click('#back-btn');
  await page.waitFor("!document.getElementById('view-list').hidden");
  await done(page);
});

test('팝업 닫기: 브라우저 뒤로 가기는 팝업만 닫고 학습 화면에 남음', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  const y = await scrollDown(page);
  const hash = await page.eval('location.hash');
  await openMap(page);
  assert.equal(await page.eval('history.state && history.state.metisMapSheet'), true, '열 때 기록 한 칸');
  await page.eval('history.back()');
  await page.waitFor("!document.getElementById('map-sheet').open");
  assert.equal(await page.eval('location.hash'), hash, '같은 학습에 남아 있음');
  assert.equal(await page.eval("!document.getElementById('view-study').hidden"), true);
  assert.equal(await page.eval('window.scrollY'), y);
  assert.equal(await page.eval("document.documentElement.classList.contains('map-open')"), false);
  await done(page);
});

test('배경 스크롤 잠금: 팝업이 열린 동안 휠을 굴려도 뒤 화면이 움직이지 않음', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  const y = await scrollDown(page);
  await openMap(page);
  assert.equal(await page.eval('getComputedStyle(document.documentElement).overflow'), 'hidden');
  const r = await page.eval("(() => { const b = document.querySelector('#map-sheet-title').getBoundingClientRect(); return { x: b.left + 10, y: b.top + 10 }; })()");
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: 400 });
  await sleep(150);
  assert.equal(await page.eval('window.scrollY'), y, '배경 스크롤 안 움직임');
  await closeMap(page);
  assert.equal(await page.eval('getComputedStyle(document.documentElement).overflow'), 'visible');
  await done(page);
});

test('팝업 안에서 개념을 누르면 선택되고 팝업은 열린 채, 닫으면 화면 위치는 그대로 선택은 유지', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  const y = await scrollDown(page);
  const mito = srv.state.items[3];
  await openMap(page);
  await page.click(`[data-t="node"][data-id="${mito.id}"]`);
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '미토콘드리아'");
  assert.equal(await sheetOpen(page), true, '선택해도 팝업은 열려 있음');
  assert.equal(await page.eval("document.querySelector('.m-node.sel').dataset.id"), String(mito.id), '팝업 안에서 선택 표시가 바뀜');
  assert.deepEqual(calls(/studies\/\d+$/, 'PATCH').pop().body, { selected_item_id: mito.id });
  await closeMap(page);
  assert.equal(await page.eval('window.scrollY'), y, '화면 위치는 열기 전 그대로');
  assert.equal(await page.text('[data-t="term"]'), '미토콘드리아', '선택 유지');
  await done(page);
});

test('다음 제안(점선) 노드를 누르면 팝업을 닫고 다음 단계 영역으로 이동', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  await page.click('[data-t="ghost"]');
  await page.waitFor("!document.getElementById('map-sheet').open");
  assert.equal(await page.eval("(() => { const r = document.getElementById('nextstep').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })()"), true, '다음 단계가 화면에 보임');
  assert.equal(await page.eval('history.state && history.state.metisMapSheet'), null);
  await done(page);
});

test('자동 맞춤: 열릴 때 전체 지도가 화면 안에 들어오고 글자 크기 하한(0.75)을 적용하지 않음', { skip: SKIP }, async () => {
  let page = await openStudy(sixty);
  await openMap(page);
  assert.equal(await allInside(page), true, '60개 노드와 다음 제안이 모두 상자 안');
  const sc = await scaleOf(page);
  assert.ok(sc < 0.75, '하한 0.75보다 작게 줄어듦: ' + sc);
  assert.ok(sc >= 0.05, '지도 하한 이상');
  // 확대 후 화면 맞춤으로 복귀
  const v0 = await vb(page);
  await page.click('[data-t="zoom-in"]'); await page.click('[data-t="zoom-in"]');
  assert.ok((await scaleOf(page)) > sc);
  await page.click('[data-t="zoom-fit"]');
  const v1 = await vb(page);
  assert.ok(v1.every((n, i) => Math.abs(n - v0[i]) < 0.01), '화면 맞춤은 열릴 때의 보기로 복귀');
  await done(page);
  page = await openStudy(five);
  await openMap(page);
  assert.equal(await allInside(page), true);
  assert.ok((await scaleOf(page)) <= 1.5 + 1e-6, '작은 지도는 1.5배까지만 키움');
  await done(page);
});

test('확대·축소 버튼: 보이는 영역이 줄고 늘며, 확대 3배·축소 0.05배에서 멈춤', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  const s0 = await scaleOf(page);
  await page.click('[data-t="zoom-in"]');
  assert.ok(Math.abs((await scaleOf(page)) / s0 - 1.25) < 0.01);
  await page.click('[data-t="zoom-out"]'); await page.click('[data-t="zoom-out"]');
  assert.ok((await scaleOf(page)) < s0);
  for (let i = 0; i < 20; i++) await page.click('[data-t="zoom-in"]');
  assert.ok(Math.abs((await scaleOf(page)) - 3) < 0.001, '확대 한계 3배');
  for (let i = 0; i < 30; i++) await page.click('[data-t="zoom-out"]');
  assert.ok(Math.abs((await scaleOf(page)) - 0.05) < 0.001, '축소 한계 0.05배');
  await done(page);
});

test('전체 연결 보기를 바꿔도 확대·이동 상태를 유지, 선택 때문에 다시 맞추지 않음', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  await page.click('[data-t="zoom-in"]'); await page.click('[data-t="zoom-in"]');
  const v = await vb(page);
  await page.click('[data-t="map-full"]');
  assert.deepEqual(await vb(page), v, '토글해도 보기 유지');
  await page.click(`[data-t="node"][data-id="${srv.state.items[1].id}"]`);
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '광합성'");
  assert.deepEqual(await vb(page), v, '선택해도 보기 유지');
  await done(page);
});

test('끌어서 이동(마우스) / 두 손가락 핀치 확대·축소(터치 포인터)', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  const v0 = await vb(page);
  await page.drag('[data-t="map-box"]', 50, 30);
  const v1 = await vb(page);
  assert.ok(v1[0] < v0[0] && v1[1] < v0[1], '끌면 보기 영역이 반대로 이동');
  assert.equal(calls(/studies\/\d+$/, 'PATCH').length, 0, '끌기는 선택으로 처리되지 않음');
  // 핀치: 가운데 지점 아래의 그림은 제자리에 있고 배율만 변함
  const out = await page.eval(`(() => {
    const svg = document.querySelector('[data-t=map-svg]');
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fire = (type, id, x, y) => svg.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
    const vbOf = () => svg.getAttribute('viewBox').split(' ').map(Number);
    const before = vbOf();
    const worldAt = (v, x, y) => [v[0] + (x - r.left) / (r.width / v[2]), v[1] + (y - r.top) / (r.height / v[3])];
    const w0 = worldAt(before, cx, cy);
    fire('pointerdown', 1, cx - 40, cy); fire('pointerdown', 2, cx + 40, cy);
    for (let i = 1; i <= 5; i++) { fire('pointermove', 1, cx - 40 - i * 10, cy); fire('pointermove', 2, cx + 40 + i * 10, cy); }
    const zoomed = vbOf();
    const w1 = worldAt(zoomed, cx, cy);
    fire('pointerup', 1, cx - 90, cy); fire('pointerup', 2, cx + 90, cy);
    // 오므리기(축소)
    fire('pointerdown', 1, cx - 100, cy); fire('pointerdown', 2, cx + 100, cy);
    for (let i = 1; i <= 5; i++) { fire('pointermove', 1, cx - 100 + i * 16, cy); fire('pointermove', 2, cx + 100 - i * 16, cy); }
    const pinchedIn = vbOf();
    fire('pointerup', 1, cx - 20, cy); fire('pointerup', 2, cx + 20, cy);
    return { before, zoomed, pinchedIn, w0, w1 };
  })()`);
  assert.ok(out.zoomed[2] < out.before[2] * 0.7, '벌리면 확대(보이는 폭이 줄어듦)');
  assert.ok(Math.abs(out.w0[0] - out.w1[0]) < 0.5 && Math.abs(out.w0[1] - out.w1[1]) < 0.5, '두 손가락 가운데 아래의 지점이 제자리');
  assert.ok(out.pinchedIn[2] > out.zoomed[2] * 1.3, '오므리면 축소');
  assert.equal(calls(/studies\/\d+$/, 'PATCH').length, 0, '핀치는 선택으로 처리되지 않음');
  await done(page);
});

test('마우스 휠로 확대·축소(데스크톱), 팝업 밖 화면은 움직이지 않음', { skip: SKIP }, async () => {
  const page = await openStudy(five, { width: 1024, height: 800 });
  const y = await scrollDown(page);
  await openMap(page);
  const s0 = await scaleOf(page);
  const r = await page.eval("(() => { const b = document.querySelector('[data-t=map-box]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: -120 });
  await sleep(100);
  assert.ok((await scaleOf(page)) > s0, '위로 굴리면 확대');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: 240 });
  await sleep(100);
  assert.ok((await scaleOf(page)) < s0 * 1.2);
  assert.equal(await page.eval('window.scrollY'), y);
  await done(page);
});

test('연결선: 눈에 안 보이는 두꺼운 클릭 영역(화면 28px 고정)이 있고 선에서 떨어진 곳을 눌러도 연결 카드가 열림', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  for (let i = 0; i < 3; i++) await page.click('[data-t="zoom-out"]');   // 작게 줄인 상태에서도 누를 수 있어야 함
  const info = await page.eval(`(() => { const p = document.querySelector('[data-t=edge] path.hit'); const cs = getComputedStyle(p); return { w: cs.strokeWidth, stroke: cs.stroke, ve: cs.vectorEffect, line: getComputedStyle(document.querySelector('[data-t=edge][data-hl="0"] path.line')).strokeWidth }; })()`);
  assert.equal(info.w, '28px'); assert.equal(info.ve, 'non-scaling-stroke');
  assert.match(info.stroke, /rgba\(0, 0, 0, 0\)|transparent/, '눈에 보이지 않음');
  assert.equal(info.line, '1.5px', '보이는 선은 가늘다');
  // 연결선 한가운데에서 위쪽으로 9px 떨어진 곳(보이는 선에는 닿지 않음)을 실제 마우스로 누른다
  const pt = await page.eval(`(() => {
    const all = document.querySelectorAll('[data-t=edge]'); const e = all[all.length - 1];   // 맨 위에 그려진 선(다른 선의 클릭 영역에 가려지지 않음)
    const p = e.querySelector('path.hit'); const m = p.getPointAtLength(p.getTotalLength() / 2); const ctm = p.getScreenCTM();
    const x = ctm.a * m.x + ctm.e, y = ctm.d * m.y + ctm.f - 9;
    return { x, y, id: e.dataset.id, hit: document.elementFromPoint(x, y) === p };
  })()`);
  assert.equal(pt.hit, true, '선에서 9px 떨어진 곳도 연결선의 클릭 영역');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.waitFor("document.getElementById('edge-dialog').open");
  assert.match(await page.text('#edge-body'), /연결한 이유/);
  await page.close();
});

test('연결 카드는 팝업 위에 열리고 ESC는 카드부터 닫음(팝업·상태 유지)', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  await page.click('[data-t="map-full"]');
  const l = srv.state.links[1];
  await page.click(`[data-t="edge"][data-id="${l.id}"] path.hit`);
  await page.waitFor("document.getElementById('edge-dialog').open");
  assert.equal(await sheetOpen(page), true);
  assert.equal(await page.text('[data-t="rel-detail"]'), '광합성은 엽록체에서 일어난다.');
  assert.equal(await page.exists('[data-t="rel-source"]'), false, '작업210: 상태 배지 없음');
  // 카드가 지도 위(맨 앞)에 보이는가
  assert.equal(await page.eval("(() => { const r = document.getElementById('edge-body').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 5, r.top + 5); return !!e && document.getElementById('edge-dialog').contains(e); })()"), true);
  await pressEsc(page);
  await page.waitFor("!document.getElementById('edge-dialog').open");
  assert.equal(await sheetOpen(page), true, '카드만 닫힘');
  await pressEsc(page);
  await page.waitFor("!document.getElementById('map-sheet').open");
  await done(page);
});

test('회전(폭이 바뀜): 팝업이 열린 채 다시 전체에 맞춤', { skip: SKIP }, async () => {
  const page = await openStudy(sixty);
  await openMap(page);
  await page.click('[data-t="zoom-in"]');
  await page.resize(844, 390);
  await page.waitFor("(() => { const b = document.querySelector('[data-t=map-box]').getBoundingClientRect(); return b.width > 700; })()");
  await sleep(400);
  assert.equal(await allInside(page), true, '가로로 돌려도 전체가 상자 안');
  assert.equal(await sheetOpen(page), true);
  await page.close();
});

for (const [w, h, big] of [[390, 844, false], [768, 1024, true], [1024, 800, true]]) {
  test(`팝업 크기·터치 ${w}px: ${big ? '화면 대부분을 쓰는 큰 팝업' : '화면 전체'}, 닫기·도구 44px 이상, 가로 스크롤 없음`, { skip: SKIP }, async () => {
    const page = await openStudy(five, { width: w, height: h });
    await openMap(page);
    const r = await page.eval("(() => { const b = document.getElementById('map-sheet').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, iw: innerWidth, ih: innerHeight, radius: getComputedStyle(document.getElementById('map-sheet')).borderRadius }; })()");
    if (!big) {
      assert.ok(Math.abs(r.w - r.iw) < 1 && Math.abs(r.h - r.ih) < 1 && r.l < 1 && r.t < 1, '390px: 화면 전체 ' + JSON.stringify(r));
    } else {
      assert.ok(r.w / r.iw >= 0.9 && r.w < r.iw, '가로 90% 이상: ' + JSON.stringify(r));
      assert.ok(r.h / r.ih >= 0.9 && r.h < r.ih, '세로 90% 이상: ' + JSON.stringify(r));
      assert.ok(Math.abs((r.l + r.w / 2) - r.iw / 2) < 2 && Math.abs((r.t + r.h / 2) - r.ih / 2) < 2, '가운데');
      assert.equal(r.radius, '16px');
    }
    const box = await page.eval("(() => { const b = document.querySelector('[data-t=map-box]').getBoundingClientRect(); return { w: b.width, h: b.height }; })()");
    assert.ok(box.h > r.h * 0.6, '지도 상자가 팝업 높이의 대부분: ' + JSON.stringify([box, r.h]));
    const small = await page.eval(`[...document.querySelectorAll('#map-sheet button')].filter(b => { const x = b.getBoundingClientRect(); return x.height < 43.5 || x.width < 43.5; }).map(b => b.getAttribute('data-t') || b.id)`);
    assert.deepEqual(small, [], '44px 미만 요소');
    assert.equal(await allInside(page), true);
    assert.equal(await page.hasHorizontalScroll(), false);
    assert.equal(await page.eval("document.getElementById('map-sheet').scrollWidth <= document.getElementById('map-sheet').clientWidth + 1"), true);
    await closeMap(page);
    await done(page);
  });
}
