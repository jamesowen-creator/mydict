// 작업294-1·295-1: 개념 지도 화면 — 증권 계층 구조 지도(화살표 시작이 위)에서 [배치 최적화] → 미리보기(계층 표시·교차 수) → [적용] 후 위→아래 확인 → [되돌리기]로 복원, 연결 없는 개념은 마지막 줄.
// 실제 routes/concept_map.js + 가짜 DB(tests/helpers/cmap_db.js)에 연결한 헤드리스 Chrome 테스트. 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_layout_hier.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { clickMore } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const posKey = nodes => JSON.stringify(nodes.map(n => [n.concept_id, n.x, n.y]).sort((p, q) => p[0] - q[0]));

test('계층 지도: 배치 최적화 미리보기 → 적용하면 위→아래, 연결 없는 개념은 마지막 줄 → 되돌리기로 복원', { skip: SKIP }, async t => {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);

  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const names = ['증권', '유가증권', '주식', '회사채', '국공채', '조건환매부채권', 'IPO', '메모'];
  const c = {};
  for (const k of names) c[k] = (await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, { term: k })).concept;
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  // 일부러 거꾸로·뒤섞인 위치(아래 개념이 위, 연결 없는 개념이 가운데)
  const at = { 증권: [0, 900], 유가증권: [220, 700], 주식: [440, 0], 회사채: [0, 0], 국공채: [220, 300], 조건환매부채권: [440, 500], IPO: [0, 500], 메모: [220, 0] };
  for (const k of names) {
    await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: c[k].id });
    await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${c[k].id}`, { x: at[k][0], y: at[k][1] });
  }
  const link = (f, to, type) => seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: c[f].id, to_concept_id: c[to].id, label: f + type + to, relation_type: type });
  await link('증권', '유가증권', '종류');
  await link('유가증권', '주식', '종류');
  await link('유가증권', '회사채', '종류');
  await link('유가증권', '국공채', '일부');
  await link('유가증권', '조건환매부채권', '종류');
  await link('주식', 'IPO', '일부');
  await page.eval('refresh()');
  await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor("!document.getElementById('concepts-sec').hidden", 4000);
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 8", 6000, '지도 화면');
  await page.eval("(() => { const b = document.getElementById('map-open'); if (b && !b.disabled) b.click(); else window.CmapMap.openSheet(); })()");
  await page.waitFor("document.getElementById('map-sheet').open", 4000, '지도 시트');
  await page.click('#map-fit');
  await page.click('#map-save'); await page.waitFor("document.getElementById('map-save-state').textContent.startsWith('저장됨')", 4000);
  const g0 = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`));

  // 미리보기: 계층 표시와 교차 수, 서버 위치는 그대로
  await clickMore(page, '#map-opt');
  await page.waitFor("!document.getElementById('map-opt-bar').hidden", 4000, '미리보기 막대');
  const info = await page.eval("document.getElementById('map-opt-info').textContent");
  assert.match(info, /위→아래 계층/);
  assert.match(info, /교차 \d+개 → 0개/);
  const pv = await page.eval('window.CmapMap._preview()');
  assert.equal(pv.metrics.layout, 'hierarchy');
  assert.equal(posKey((await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).nodes), posKey(g0.nodes), '미리보기만으로는 서버 위치가 바뀌지 않음');

  // 적용
  await page.click('#map-opt-apply');
  await page.waitFor("document.getElementById('map-opt-bar').hidden && !document.getElementById('map-undo').hidden", 6000, '적용 후 되돌리기 표시');
  const g1 = await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`);
  const nd = k => g1.nodes.find(n => n.concept_id === c[k].id), y = k => nd(k).y, mx = k => nd(k).x + 66;
  assert.ok(y('증권') < y('유가증권') && y('유가증권') < y('주식') && y('주식') < y('IPO'), '화살표 시작이 위(일부·종류 포함)');
  for (const k of ['회사채', '국공채', '조건환매부채권']) assert.equal(y(k), y('주식'), k + ' 같은 줄');
  const rowsY = [y('증권'), y('유가증권'), y('주식'), y('IPO')];
  assert.deepEqual(rowsY.map((v, i) => v - rowsY[0] === i * (rowsY[1] - rowsY[0])), [true, true, true, true], '줄 간격 균일');
  const kx = ['주식', '회사채', '국공채', '조건환매부채권'].map(mx);
  assert.ok(Math.abs(mx('유가증권') - (Math.min(...kx) + Math.max(...kx)) / 2) < 1, '유가 증권은 하위 개념들의 가운데');
  assert.ok(Math.abs(mx('주식') - mx('IPO')) < 1, '주식 바로 위에 IPO');
  assert.ok(y('메모') > y('IPO'), '연결 없는 개념은 마지막 줄');
  assert.equal(g1.save_status, 'saved', '위치만 바뀌어 저장됨 유지');
  assert.equal(g1.current_hash, g0.current_hash);

  // 되돌리기
  await clickMore(page, '#map-undo');
  await page.waitFor("document.getElementById('map-undo').hidden", 6000, '되돌리기 사라짐');
  assert.equal(posKey((await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).nodes), posKey(g0.nodes), '원래 위치로 복원');
  assert.equal(await page.hasHorizontalScroll(), false);
});
