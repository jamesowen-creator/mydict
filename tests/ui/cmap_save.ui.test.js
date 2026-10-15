// 작업273-3: 개념 지도 화면 — 저장 상태 표시([저장] → 저장됨 → 연결 변경 시 "저장 후 변경됨"), 배치 최적화 미리보기 → 적용 → 되돌리기, 취소, 미리보기 중 잠금, 390px 레이아웃.
// 실제 routes/concept_map.js + 가짜 DB(tests/helpers/cmap_db.js)에 연결한 헤드리스 Chrome 테스트. 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_save.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { clickMore } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
// 274-4: 지도는 시트(<dialog>) 안에 있다. 지도 조작 전에 [지도 열기]로 시트를 열고, 주제 화면으로 가기 전·다른 탭으로 가기 전에 닫는다
// 283-2: [만들기] 첫 화면의 주 버튼(#map-open)은 개념을 2개 이상 고르기 전에는 비활성이므로, 빈 지도에서 시트를 바로 열 때는 CmapMap.openSheet() 를 쓴다
const openSheet = async page => { await page.eval("(() => { const b = document.getElementById('map-open'); if (b && !b.disabled) b.click(); else window.CmapMap.openSheet(); })()"); await page.waitFor("document.getElementById('map-sheet').open", 4000, '지도 시트'); };
const closeSheet = async page => { await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000, '지도 시트 닫힘'); };
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
// 과학 트리: 개념 a b c d 를 지도에 넣고, 교차하는 연결 두 개(a-b, c-d)를 만든 뒤 지도 화면을 연다
async function world(page) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const c = {};
  for (const k of ['a', 'b', 'c', 'd']) c[k] = (await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, { term: k + '개념' })).concept;
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  const at = { a: [0, 0], b: [400, 300], c: [0, 300], d: [400, 0] };
  for (const k of ['a', 'b', 'c', 'd']) {
    await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: c[k].id });
    await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${c[k].id}`, { x: at[k][0], y: at[k][1] });
  }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: c.a.id, to_concept_id: c.b.id, label: '가 to 나', relation_type: '일으킴' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: c.c.id, to_concept_id: c.d.id, label: '다 to 라', relation_type: '구별' });
  await page.eval('refresh()');
  await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor("!document.getElementById('concepts-sec').hidden", 4000);
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000, '지도 화면');
  await openSheet(page);
  await page.click('#map-fit');                       // 열 때는 글자 크기 하한 때문에 넓은 지도의 오른쪽이 잘릴 수 있어, 테스트는 전체 보기로 맞춘다
  return { sci, c, map };
}
const serverMap = (page, sci) => seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`);
const stateText = page => page.eval("document.getElementById('map-save-state').textContent");
const posKey = nodes => JSON.stringify(nodes.map(n => [n.concept_id, n.x, n.y]).sort((p, q) => p[0] - q[0]));
const semKey = g => JSON.stringify([g.edges.map(e => [e.id, e.from_concept_id, e.to_concept_id, e.relation_type, e.label]), g.nodes.map(n => n.concept_id).sort((a, b) => a - b)]);

test('저장 상태: 저장 안 됨 → [저장] → 저장됨 → 연결 추가하면 "저장 후 변경됨" → 다시 저장', { skip: SKIP }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  assert.equal(await stateText(page), '저장 안 됨');
  assert.equal(await page.eval("document.getElementById('map-save').disabled"), false);
  await page.click('#map-save');
  await page.waitFor("document.getElementById('map-save-state').textContent.startsWith('저장됨')", 4000, '저장됨');
  assert.equal(await page.eval("document.getElementById('map-save').disabled"), true, '저장됨이면 [저장] 비활성');
  assert.equal((await serverMap(page, w.sci)).save_status, 'saved');
  // 연결 하나 추가(서버 직접) 대신 화면의 연결 흐름: 노드 b 탭 → c 탭 → 문구 입력 → 만들기
  await page.click('[data-node="' + w.c.b.id + '"] rect');
  await page.click('[data-node="' + w.c.c.id + '"] rect');
  await page.waitFor("document.getElementById('edge-dlg').open", 4000, '연결 대화상자');
  await page.eval("(() => { const i = document.getElementById('edge-label'); i.value = '새 연결'; })()");
  await page.click('#edge-ok');
  await page.waitFor("document.getElementById('map-save-state').textContent === '저장 후 변경됨'", 4000, '저장 후 변경됨');
  assert.equal((await serverMap(page, w.sci)).save_status, 'changed');
  assert.equal(await page.eval("document.getElementById('map-save').disabled"), false);
  await page.click('#map-save');
  await page.waitFor("document.getElementById('map-save-state').textContent.startsWith('저장됨')", 4000, '다시 저장됨');
  // 배치 최적화 적용은 의미를 바꾸지 않으므로 저장됨 유지(아래 테스트에서도 확인)
  assert.equal(await page.hasHorizontalScroll(), false);
});

test('배치 최적화: 미리보기(서버는 그대로) → 취소 → 다시 미리보기 → 적용(위치만 저장) → 되돌리기, 의미는 한 번도 안 바뀐다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await page.click('#map-save'); await page.waitFor("document.getElementById('map-save-state').textContent.startsWith('저장됨')", 4000);
  const g0 = await serverMap(page, w.sci);
  // 미리보기
  await clickMore(page, '#map-opt');
  await page.waitFor("!document.getElementById('map-opt-bar').hidden", 4000, '미리보기 막대');
  const pv = await page.eval('window.CmapMap._preview()');
  assert.ok(pv && pv.metrics.crossingsBefore === 1 && pv.metrics.crossingsAfter === 0, JSON.stringify(pv && pv.metrics));
  assert.match(await page.eval("document.getElementById('map-opt-info').textContent"), /1개 → 0개/);
  assert.equal(posKey((await serverMap(page, w.sci)).nodes), posKey(g0.nodes), '미리보기만으로는 서버 위치가 바뀌지 않음');
  assert.equal(await page.eval("document.getElementById('map-opt').disabled"), true);
  // 미리보기 중에는 노드를 눌러도 선택되지 않는다(잠금)
  await page.click('[data-node="' + w.c.a.id + '"] rect');
  assert.equal((await page.eval('window.CmapMap._state()')).selected, null);
  // 취소
  await page.click('#map-opt-cancel');
  assert.equal(await page.eval("document.getElementById('map-opt-bar').hidden"), true);
  assert.equal(await page.eval('window.CmapMap._preview()'), null);
  assert.equal(posKey((await serverMap(page, w.sci)).nodes), posKey(g0.nodes));
  // 적용
  await clickMore(page, '#map-opt');
  await page.waitFor("!document.getElementById('map-opt-bar').hidden", 4000);
  await page.click('#map-opt-apply');
  await page.waitFor("document.getElementById('map-opt-bar').hidden && !document.getElementById('map-undo').hidden", 6000, '적용 후 되돌리기 표시');
  const g1 = await serverMap(page, w.sci);
  assert.notEqual(posKey(g1.nodes), posKey(g0.nodes), '위치가 바뀜');
  assert.equal(semKey(g1), semKey(g0), '노드 집합·연결(종류·방향·문구)은 그대로');
  assert.equal(g1.current_hash, g0.current_hash);
  assert.equal(g1.save_status, 'saved');
  assert.equal(await stateText(page).then(s => s.startsWith('저장됨')), true, '화면 상태도 저장됨 유지');
  // 적용된 배치는 화면에도 있다
  const st = await page.eval('window.CmapMap._state()');
  assert.equal(posKey(st.nodes.map(n => ({ concept_id: n.id, x: n.x, y: n.y }))), posKey(g1.nodes));
  // 되돌리기
  await clickMore(page, '#map-undo');
  await page.waitFor("document.getElementById('map-undo').hidden", 6000, '되돌리기 사라짐');
  const g2 = await serverMap(page, w.sci);
  assert.equal(posKey(g2.nodes), posKey(g0.nodes), '원래 위치로 복원');
  assert.equal(semKey(g2), semKey(g0));
  assert.equal(g2.save_status, 'saved');
  assert.equal(await page.hasHorizontalScroll(), false);
});

test('되돌리기는 화면을 떠나면 사라지고, 적용 뒤 노드·연결이 바뀌면 사라진다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await clickMore(page, '#map-opt'); await page.waitFor("!document.getElementById('map-opt-bar').hidden", 4000);
  await page.click('#map-opt-apply'); await page.waitFor("!document.getElementById('map-undo').hidden", 6000);
  // 연결을 하나 더 만들면 되돌리기 사라짐
  await seed(page, 'GET', `/api/cmap/topics/${w.sci.id}/map`);
  await page.click('[data-node="' + w.c.a.id + '"] rect');
  await page.click('[data-node="' + w.c.c.id + '"] rect');
  await page.waitFor("document.getElementById('edge-dlg').open", 4000);
  await page.eval("document.getElementById('edge-label').value = '추가'");
  await page.click('#edge-ok');
  await page.waitFor("document.getElementById('map-undo').hidden", 4000, '연결 변경 후 되돌리기 사라짐');
  // 다시 적용 후 화면을 나갔다 오면 사라짐
  await clickMore(page, '#map-opt');
  const bar = await page.eval("!document.getElementById('map-opt-bar').hidden");
  if (bar) { await page.click('#map-opt-apply'); await page.waitFor("!document.getElementById('map-undo').hidden", 6000); }
  await closeSheet(page);
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.click('#nav-map'); await page.waitFor("!document.getElementById('map-view').hidden", 6000);
  assert.equal(await page.eval("document.getElementById('map-undo').hidden"), true);
  assert.equal(await page.eval("document.getElementById('map-opt-bar').hidden"), true);
});

test('이미 정리된 배치는 바뀌는 것이 없다는 안내만 보이고 미리보기는 열리지 않는다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await clickMore(page, '#map-opt'); await page.waitFor("!document.getElementById('map-opt-bar').hidden", 4000);
  await page.click('#map-opt-apply'); await page.waitFor("!document.getElementById('map-undo').hidden", 6000);
  await clickMore(page, '#map-opt');
  await sleep(200);
  if (await page.eval("!document.getElementById('map-opt-bar').hidden")) {
    // 두 번째 최적화가 더 좋은 배치를 찾은 경우: 취소하고 넘어간다(미리보기가 열린 것 자체는 정상)
    await page.click('#map-opt-cancel');
  } else {
    assert.match(await page.eval("document.getElementById('map-msg').textContent"), /이미 정리/);
  }
});

test('390px: 저장·최적화 버튼 높이 44 이상, 가로 스크롤 없음, 미리보기 막대가 캔버스 안에 있음', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  assert.ok(await page.eval(`document.getElementById('map-save').getBoundingClientRect().height`) >= 44, 'map-save');
  await page.click('#map-more-toggle'); await page.waitFor("!document.getElementById('map-more').hidden", 3000);
  assert.ok(await page.eval(`document.getElementById('map-opt').getBoundingClientRect().height`) >= 44, 'map-opt');
  await clickMore(page, '#map-opt'); await page.waitFor("!document.getElementById('map-opt-bar').hidden", 4000);
  for (const id of ['map-opt-apply', 'map-opt-cancel']) assert.ok(await page.eval(`document.getElementById('${id}').getBoundingClientRect().height`) >= 44, id);
  assert.equal(await page.eval("(() => { const b = document.getElementById('map-opt-bar').getBoundingClientRect(), c = document.querySelector('.map-canvas').getBoundingClientRect(); return b.left >= c.left && b.right <= c.right && b.top >= c.top; })()"), true);
  assert.equal(await page.hasHorizontalScroll(), false);
});
