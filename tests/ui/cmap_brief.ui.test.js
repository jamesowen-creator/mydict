// 작업291-1: 편집 시트 개념 선택 시 간략 설명(brief) 표시. 서버는 실제 routes/concept_map.js + 가짜 DB.
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

for (const [w, h] of [[390, 844], [320, 640]]) {
  test(`편집 시트(${w}px): 첫 탭 설명·선택, 표시 불변, 교체·닫힘 조건, 버튼·탭 가림 없음, 설명 없는 개념`, { skip: SKIP, timeout: 90000 }, async t => {
    const { page } = await open(t, w, h);
    const wd = await world(page);
    const before = await marks(page);
    assert.equal(await briefShown(page), false);
    await tapNode(page, wd.ids[0]);
    await page.waitFor("!document.getElementById('map-brief').hidden", 3000, '설명');
    assert.match(await page.text('#map-brief'), /a개념[\s\S]*가 개념의 정의 한 줄입니다/);
    assert.equal(await page.eval(`document.querySelector('[data-node="${wd.ids[0]}"]').classList.contains('sel')`), true, '선택 상태');
    assert.match(await page.text('#map-hint'), /a개념.*골랐어요/);
    assert.equal(await marks(page), before, '표시 불변');
    assert.equal(await page.eval("getComputedStyle(document.getElementById('map-brief')).pointerEvents"), 'none', '탭을 가로채지 않음');
    assert.equal(await page.eval("parseFloat(getComputedStyle(document.querySelector('#map-brief .b-text')).fontSize) >= 13"), true);
    // 버튼이 설명에 가려지지 않음(설명이 버튼 위쪽) + 버튼은 눌림
    const r = await page.eval("(() => { const b = document.getElementById('map-brief').getBoundingClientRect(), k = document.getElementById('map-bulk-btn').getBoundingClientRect(), hn = document.getElementById('map-hint').getBoundingClientRect(); return { bBottom: b.bottom, kTop: k.top, kBottom: k.bottom, hTop: hn.top, bTop: b.top, w: b.width, vw: innerWidth }; })()");
    assert.ok(r.bBottom <= r.kTop + 1 && r.kBottom <= r.hTop + 1, '설명·버튼·안내 줄이 겹치지 않음');
    assert.ok(r.w <= r.vw);
    const hit = await page.eval("(() => { const k = document.getElementById('map-bulk-btn').getBoundingClientRect(); const e = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2); return e && e.id; })()");
    assert.equal(hit, 'map-bulk-btn');
    // 다른 노드 선택 = 둘째 탭이므로 연결 대화상자가 열리고 설명은 닫힘
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
    await page.eval("(() => { const s = document.getElementById('map-svg'); const r = s.getBoundingClientRect(); const x = r.left + 4, y = r.top + 40; for (const t of ['pointerdown', 'pointerup']) s.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true })); })()");
    await sleep(150);
    assert.equal(await briefShown(page), false, '빈 곳 탭 닫힘');
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
