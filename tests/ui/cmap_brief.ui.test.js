// 작업291-1 → 451: 편집 시트 개념 선택 시 간략 설명(brief)을 개념 옆 팝업으로 표시. 서버는 실제 routes/concept_map.js + 가짜 DB.
// 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_brief.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { tabIn } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t, width = 390, height = 844) {
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
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const tapNode = (page, id) => page.click(`[data-node="${id}"] rect`);
const setSel = (page, sel, v) => page.eval(`(() => { const s = document.getElementById(${JSON.stringify(sel)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`);

// a(정의 있음) b(설명 없음) c d
async function world(page) {
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const defs = [{ term: 'a개념', explanation: { definition: '가 개념의 정의 한 줄입니다.' }, explanation_source: 'manual' }, { term: 'b개념' }, { term: 'c개념' }, { term: 'd개념' }];
  const ids = [];
  for (const d of defs) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, d)).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  const at = [[130, 20], [20, 150], [250, 150], [130, 280]];
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: at[i][0], y: at[i][1] }); }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open && document.querySelectorAll('[data-node]').length === 4", 6000); await sleep(250);
  await page.click('#map-fit');
  return { top, ids, map };
}
const briefShown = page => page.eval("(() => { const e = document.getElementById('map-brief'); return !e.hidden && e.offsetParent !== null; })()");
const marks = page => page.eval('JSON.stringify(window.CmapMap._marks())');
const selected = page => page.eval('window.CmapMap._state().selected');
// 451: 팝업·선택 노드·캔버스 사각형(화면 좌표)
const geom = page => page.eval("(() => { const r = e => { const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; }; const sel = document.querySelector('.m-node.sel rect'); const ob = document.querySelector('.map-overlay-bottom'); return { pop: r(document.getElementById('map-brief')), node: sel ? r(sel) : null, cv: r(document.getElementById('map-canvas')), ob: r(ob), vw: innerWidth }; })()");
const emptyTap = page => page.eval("(() => { const s = document.getElementById('map-svg'); const r = s.getBoundingClientRect(); const x = r.left + 4, y = r.top + 40; for (const t of ['pointerdown', 'pointerup']) s.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true })); })()");
const inside = g => g.pop.l >= g.cv.l - 0.5 && g.pop.r <= g.cv.r + 0.5 && g.pop.t >= g.cv.t - 0.5 && g.pop.b <= g.cv.b + 0.5;

for (const [w, h] of [[390, 844], [320, 640], [1280, 900]]) {
  test(`편집 시트(${w}px): 첫 탭 → 개념 옆 팝업(캔버스 안), 표시 불변, 하단 줄 유지, 교체·닫힘 조건, 설명 없는 개념`, { skip: SKIP, timeout: 90000 }, async t => {
    const { page } = await open(t, w, h);
    const wd = await world(page);
    const before = await marks(page);
    assert.equal(await briefShown(page), false);
    await tapNode(page, wd.ids[0]);
    await page.waitFor("!document.getElementById('map-brief').hidden", 3000, '설명 팝업');
    assert.match(await page.text('#map-brief'), /a개념[\s\S]*가 개념의 정의 한 줄입니다/);
    assert.equal(await page.eval("document.getElementById('map-brief').parentElement.id"), 'map-canvas', '하단 오버레이 밖(캔버스 안)');
    assert.equal(await page.eval("document.querySelector('.map-overlay-bottom #map-brief')"), null, '하단 오버레이에는 설명이 없다');
    assert.equal(await page.eval(`document.querySelector('[data-node="${wd.ids[0]}"]').classList.contains('sel')`), true, '선택 상태');
    assert.match(await page.text('#map-hint'), /a개념.*골랐어요/);
    assert.equal(await marks(page), before, '표시 불변');
    // 모양: 275-4 팝업과 같은 클래스·토큰, 이름 14px 굵게, 설명 13px 5줄, role=note, aria-live 아님
    const st = await page.eval("(() => { const e = document.getElementById('map-brief'), a = getComputedStyle(e), t = getComputedStyle(e.querySelector('.p-term')), x = getComputedStyle(e.querySelector('.p-text')), o = getComputedStyle(document.getElementById('map-popup')); return { cls: e.classList.contains('map-popup'), role: e.getAttribute('role'), live: e.getAttribute('aria-live'), tf: t.fontSize, tw: t.fontWeight, xf: x.fontSize, clamp: x.webkitLineClamp, bg: a.backgroundColor === o.backgroundColor, bd: a.borderColor === o.borderColor, br: a.borderRadius === o.borderRadius, pe: a.pointerEvents }; })()");
    assert.deepEqual(st, { cls: true, role: 'note', live: null, tf: '14px', tw: '700', xf: '13px', clamp: '5', bg: true, bd: true, br: true, pe: 'auto' });
    const g = await geom(page);
    assert.ok(g.pop.h >= 44, '터치 높이 44px 이상 ' + g.pop.h);
    assert.ok(g.pop.w <= Math.min(280, g.cv.w * 0.8) + 1, '최대 너비 ' + g.pop.w);
    // 노드 옆: 세로로 노드와 겹치지 않고 바로 붙어 있다(아래, 자리가 없으면 위)
    assert.ok(g.pop.b <= g.node.t + 0.5 || g.pop.t >= g.node.b - 0.5, '노드를 가리지 않음');
    assert.ok(Math.min(Math.abs(g.pop.t - g.node.b), Math.abs(g.node.t - g.pop.b)) <= 12, '노드 바로 옆 ' + JSON.stringify({ p: g.pop, n: g.node }));
    assert.ok(inside(g), '캔버스 안');
    assert.ok(g.pop.b <= g.ob.t + 0.5, '하단 줄 위');
    // 하단 줄: 버튼·안내 줄 그대로, 겹치지 않고 눌림
    const r = await page.eval("(() => { const k = document.getElementById('map-bulk-btn').getBoundingClientRect(), hn = document.getElementById('map-hint').getBoundingClientRect(); return { kBottom: k.bottom, hTop: hn.top, hh: hn.height }; })()");
    assert.ok(r.kBottom <= r.hTop + 1 && r.hh > 0, '버튼·안내 줄 겹치지 않음');
    const hit = await page.eval("(() => { const k = document.getElementById('map-bulk-btn').getBoundingClientRect(); const e = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2); return e && e.id; })()");
    assert.equal(hit, 'map-bulk-btn');
    // 다른 노드 선택 = 둘째 탭이므로 연결 대화상자가 열리고 팝업은 닫힘
    await tapNode(page, wd.ids[2]);
    await page.waitFor("document.getElementById('edge-dlg').open", 3000);
    assert.equal(await briefShown(page), false, '연결 대화상자 열림 → 닫힘');
    await page.click('#edge-cancel');
    // 설명 없는 개념
    await tapNode(page, wd.ids[1]);
    await page.waitFor("!document.getElementById('map-brief').hidden", 3000);
    assert.match(await page.text('#map-brief'), /b개념[\s\S]*설명이 아직 없습니다/);
    // 같은 노드 재탭 = 취소
    await tapNode(page, wd.ids[1]);
    assert.equal(await briefShown(page), false, '재탭 닫힘');
    // 빈 곳 탭
    await tapNode(page, wd.ids[0]); await page.waitFor("!document.getElementById('map-brief').hidden", 3000);
    await emptyTap(page);
    await sleep(150);
    assert.equal(await briefShown(page), false, '빈 곳 탭 닫힘');
    assert.equal(await selected(page), null, '빈 곳 탭 = 선택 취소');
    // 일괄 연결 대화상자
    await tapNode(page, wd.ids[0]); await page.waitFor("!document.getElementById('map-bulk-row').hidden", 3000);
    await page.click('#map-bulk-btn'); await page.waitFor("document.getElementById('bulk-dlg').open", 3000);
    assert.equal(await briefShown(page), false, '일괄 대화상자 → 닫힘');
    await page.click('#bulk-cancel');
    // 시트 닫기 후 다시 열면 없음
    await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
    assert.equal(await page.eval("document.getElementById('map-brief').hidden"), true);
    assert.equal(await marks(page), before, '표시 불변(끝)');
    noErrors(page);
  });
}

test('451: 팝업을 누르면 팝업만 닫힘(선택 유지·다시 안 뜸), 다른 개념을 고르면 새 팝업', { skip: SKIP, timeout: 90000 }, async t => {
  const { page } = await open(t);
  const wd = await world(page);
  await tapNode(page, wd.ids[0]);
  await page.waitFor("!document.getElementById('map-brief').hidden", 3000);
  await page.click('#map-brief');
  await sleep(150);
  assert.equal(await briefShown(page), false, '팝업 탭 → 닫힘');
  assert.equal(await selected(page), wd.ids[0], '개념 선택 유지');
  assert.match(await page.text('#map-hint'), /a개념.*골랐어요/, '연결용 안내 유지');
  assert.equal(await page.eval("document.getElementById('map-bulk-row').hidden"), false, '일괄 연결 버튼 유지');
  assert.equal(await page.eval("document.getElementById('edge-dlg').open"), false, '팝업 탭이 연결을 만들지 않음');
  await page.click('#map-fit'); await sleep(150);   // 다시 그리기가 일어나도 같은 선택에서는 다시 뜨지 않음
  assert.equal(await briefShown(page), false, '같은 선택에서는 다시 뜨지 않음');
  // 선택 취소 뒤 다른 개념(c)을 고르면 그 개념의 팝업이 새로 뜬다
  await tapNode(page, wd.ids[0]); await sleep(100);
  assert.equal(await selected(page), null);
  await tapNode(page, wd.ids[2]);
  await page.waitFor("!document.getElementById('map-brief').hidden", 3000);
  assert.match(await page.text('#map-brief'), /c개념/);
  // 팝업을 닫은 뒤 둘째 개념을 누르면 연결 대화상자(기존 동작)
  await page.click('#map-brief');
  await tapNode(page, wd.ids[3]);
  await page.waitFor("document.getElementById('edge-dlg').open", 3000);
  assert.equal(await briefShown(page), false);
  noErrors(page);
});

test('451: 팝업 밖 탭은 지도로 전달, 끌기·확대에서 팝업만 닫힘(선택 유지)', { skip: SKIP, timeout: 90000 }, async t => {
  const { page } = await open(t);
  const wd = await world(page);
  // 밖 탭 전달: 팝업이 떠 있는 동안 팝업에 가려지지 않은 다른 노드를 누르면 지도가 받아 연결 대화상자가 열린다
  await tapNode(page, wd.ids[0]);
  await page.waitFor("!document.getElementById('map-brief').hidden", 3000);
  const free = await page.eval(`(() => { const ids = ${JSON.stringify(wd.ids)}; const p = document.getElementById('map-brief').getBoundingClientRect(); return ids.slice(1).find(id => { const q = document.querySelector('[data-node="' + id + '"] rect').getBoundingClientRect(); return q.right < p.left || q.left > p.right || q.bottom < p.top || q.top > p.bottom; }) || null; })()`);
  assert.ok(free, '팝업에 가려지지 않은 다른 노드가 있음');
  await tapNode(page, free);
  await page.waitFor("document.getElementById('edge-dlg').open", 3000, '팝업 밖 노드 탭이 지도로 전달됨');
  await page.click('#edge-cancel');
  // 끌기: 팝업 닫힘 + 선택 유지
  await tapNode(page, wd.ids[0]);
  await page.waitFor("!document.getElementById('map-brief').hidden", 3000);
  await page.drag('#map-svg', 40, 30);
  await sleep(150);
  assert.equal(await briefShown(page), false, '끌기 → 팝업 닫힘');
  assert.equal(await selected(page), wd.ids[0], '선택 유지');
  // 확대 단추도 같다(선택 취소 후 다시 선택해 팝업을 띄운다)
  await tapNode(page, wd.ids[0]); await sleep(80);
  await tapNode(page, wd.ids[0]);
  await page.waitFor("!document.getElementById('map-brief').hidden", 3000);
  await page.eval("(() => { const s = document.getElementById('map-svg'), r = s.getBoundingClientRect(); s.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: r.left + 100, clientY: r.top + 100, bubbles: true, cancelable: true })); })()");
  await sleep(100);
  assert.equal(await briefShown(page), false, '확대(휠) → 닫힘');
  assert.equal(await selected(page), wd.ids[0]);
  noErrors(page);
});

// 개념이 지도 가장자리에 있어도 팝업이 캔버스 밖으로 잘리지 않는다: 화면을 끌어 노드를 캔버스 네 가장자리에 닿게 한 뒤 확인
for (const [w, h] of [[390, 800], [1280, 900]]) {
  test(`451: 가장자리 개념(${w}x${h})의 팝업이 캔버스 안에 있다`, { skip: SKIP, timeout: 90000 }, async t => {
    const { page } = await open(t, w, h);
    const wd = await world(page);
    for (const [i, where] of [[0, 'top'], [1, 'left'], [2, 'right'], [3, 'bottom']]) {
      await page.click('#map-fit'); await sleep(80);
      const d = await page.eval(`(() => { const s = document.getElementById('map-svg'), q = document.querySelector('[data-node="${wd.ids[i]}"] rect').getBoundingClientRect(), c = s.getBoundingClientRect(); const where = ${JSON.stringify(where)}; return { dx: where === 'left' ? c.left + 2 - q.left : where === 'right' ? c.right - 2 - q.right : 0, dy: where === 'top' ? c.top + 2 - q.top : where === 'bottom' ? c.bottom - 2 - q.bottom : 0 }; })()`);
      await page.drag('#map-svg', d.dx, d.dy); await sleep(120);
      await tapNode(page, wd.ids[i]);
      await page.waitFor("!document.getElementById('map-brief').hidden", 3000, where + ' 팝업');
      const g = await geom(page);
      assert.ok(inside(g), where + ' 가장자리에서 잘리지 않음 ' + JSON.stringify({ p: g.pop, c: g.cv }));
      assert.ok(g.pop.b <= g.ob.t + 0.5, where + ' 하단 줄 위');
      await tapNode(page, wd.ids[i]); await sleep(80);   // 선택 취소
    }
    noErrors(page);
  });
}

test('읽기 전용 시트: 편집용 설명은 나오지 않고 기존 팝업·표시가 그대로', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const wd = await world(page);
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  await tabIn(page, 'narr'); await page.waitFor("!document.getElementById('narr-panel').hidden", 4000);
  await page.click('#narr-open-map'); await page.waitFor("document.getElementById('map-sheet').open && document.getElementById('map-sheet').classList.contains('ro')", 6000);
  await tapNode(page, wd.ids[0]);
  await page.waitFor("!document.getElementById('map-popup').hidden", 3000, '기존 팝업');
  assert.match(await page.text('#map-popup'), /가 개념의 정의/);
  assert.equal(await briefShown(page), false, '편집용 설명 없음');
  assert.deepEqual(JSON.parse(await marks(page)).marked, [wd.ids[0]], '기존 표시 동작');
  noErrors(page);
});
