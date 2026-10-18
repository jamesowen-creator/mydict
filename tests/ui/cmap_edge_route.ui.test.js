// 작업290-1: 연결선 접속면 선택·겹침 완화가 실제 화면에서 동작하는지 — 같은 열은 위/아래 면, 한 노드의 여러 선은 접속점이 나뉨, 라벨이 서로 겹치지 않음,
// 화살촉·대립 점선·방향 없음·클릭 영역 유지. 서버는 실제 routes/concept_map.js + 가짜 DB. 실행: node --test "tests/ui/cmap_edge_route.ui.test.js"
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
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
// 좌표(이름순 개념)를 지정해 지도를 만들고 시트를 연다
async function world(page, positions, edges) {
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (let i = 0; i < positions.length; i++) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term: '개념' + i })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: positions[i][0], y: positions[i][1] }); }
  for (const [a, b, type, label] of edges) await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[a], to_concept_id: ids[b], relation_type: type, label });
  await page.eval('refresh()'); await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000); await sleep(250);
  await page.click('#map-fit');
  return { ids, map };
}
const pathPts = d => d.match(/-?\d+(\.\d+)?/g).map(Number);

test('같은 열의 두 노드는 위/아래 면으로 이어진다(오른쪽으로 도는 선이 없고, 조금 어긋난 열도 같다) — 화살촉·클릭 영역 유지', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page, [[100, 20], [100, 220], [108, 400]], [[0, 1, '선행', null], [1, 2, '조건', '전제']]);
  const rows = await page.eval(`[...document.querySelectorAll('#map-svg .m-edge')].map(g => ({ d: g.querySelector('.m-edge-line').getAttribute('d'), marker: g.querySelector('.m-edge-line').getAttribute('marker-end'), hit: !!g.querySelector('.m-edge-hit') }))`);
  assert.equal(rows.length, 2);
  const nodeY = await page.eval(`Object.fromEntries(window.CmapMap._state().nodes.map(n => [n.id, [n.x, n.y]]))`);
  const [p0, p1] = rows.map(r => pathPts(r.d));
  assert.equal(p0[1], nodeY[w.ids[0]][1] + 44, '첫 선은 위 노드의 아래 면에서 시작'); assert.equal(p0[p0.length - 1], nodeY[w.ids[1]][1], '아래 노드의 위 면으로 끝(303-1: 직각 가지 — 마지막 점이 자식 위 가장자리)');
  assert.equal(p1[1], nodeY[w.ids[1]][1] + 44); assert.equal(p1[p1.length - 1], nodeY[w.ids[2]][1], 'x 가 8 어긋나도 위/아래 면');
  for (const p of [p0, p1]) { const xs = p.filter((_, i) => i % 2 === 0); assert.ok(Math.max(...xs) - Math.min(...xs) < 60, '옆으로 크게 돌지 않음: ' + xs); }
  assert.ok(rows.every(r => r.marker === 'url(#m-arrow)' && r.hit), '화살촉과 클릭 영역');
  // 선 위 클릭(가운데 점)으로 연결 고치기 대화상자가 열린다
  const pt = await page.eval(`(() => { const svg = document.getElementById('map-svg'), path = document.querySelector('.m-edge .m-edge-hit'); const q = path.getPointAtLength(path.getTotalLength() / 2); const sp = svg.createSVGPoint(); sp.x = q.x; sp.y = q.y; const m = sp.matrixTransform(path.getScreenCTM()); return { x: m.x, y: m.y }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.waitFor("document.getElementById('edge-dlg').open", 3000, '연결 고치기');
  noErrors(page);
});

test('한 노드에서 나가는 선 여러 개는 접속점이 나뉘고(경로 시작점이 모두 다름, 면 안), 라벨 글자끼리 겹치지 않으며, 대립은 굵은 실선·적색·양쪽 화살촉, 종류·방향 없음은 화살촉 없음', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const pos = [[150, 20], [0, 220], [150, 220], [300, 220], [150, 420]];
  const w = await world(page, pos, [[0, 1, '일부', '일부'], [0, 2, '종류', '종류'], [0, 3, '대립', '반대'], [0, 4, '유사', null]]);
  const rows = await page.eval(`[...document.querySelectorAll('#map-svg .m-edge')].map(g => ({ d: g.querySelector('.m-edge-line').getAttribute('d'), marker: g.querySelector('.m-edge-line').getAttribute('marker-end'), opp: g.classList.contains('m-edge-opp'), dash: getComputedStyle(g.querySelector('.m-edge-line')).strokeDasharray }))`);
  assert.equal(rows.length, 4);
  const starts = rows.map(r => pathPts(r.d).slice(0, 2));
  assert.equal(new Set(starts.map(s => s.join(','))).size, 4, '시작점이 모두 다름: ' + JSON.stringify(starts));
  const a = { x: pos[0][0], y: pos[0][1] };
  // 시작점 중 아래 면(y = 노드 아래)에 있는 것은 면 안에 있다
  for (const [x, y] of starts) if (Math.abs(y - (a.y + 44)) < 0.2) assert.ok(x > a.x && x < a.x + 132, `면 안: ${x}`);
  const boxes = await page.eval(`[...document.querySelectorAll('#map-svg .m-edge-label')].filter(t => t.textContent).map(t => { const b = t.getBBox(); return { x0: b.x, x1: b.x + b.width, y0: b.y, y1: b.y + b.height, text: t.textContent }; })`);
  assert.equal(boxes.length, 4);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const o = Math.min(boxes[i].x1, boxes[j].x1) > Math.max(boxes[i].x0, boxes[j].x0) && Math.min(boxes[i].y1, boxes[j].y1) > Math.max(boxes[i].y0, boxes[j].y0);
    assert.ok(!o, `라벨 겹침 없음: ${boxes[i].text} / ${boxes[j].text}`);
  }
  const opp = rows.filter(r => r.opp), sym = rows.filter(r => r.marker === null);
  // 307-1: 대립 = 굵은 실선 + 양쪽 화살촉(대립용 marker), 종류·옛 유사 = 화살촉 없음, 일부 = 끝 화살촉
  assert.equal(opp.length, 1); assert.equal(opp[0].dash, 'none', '점선 폐지'); assert.equal(opp[0].marker, 'url(#m-arrow-opp)', '대립은 끝 화살촉(대립용 marker)');
  assert.equal(sym.length, 2, '종류·유사 = 화살촉 없음 2개'); assert.equal(rows.filter(r => r.marker === 'url(#m-arrow)').length, 1, '일부만 일반 화살촉');
  assert.equal(await page.eval("[...document.querySelectorAll('#map-svg .m-edge-label')].map(t => t.textContent).sort().join(',')"), ['반대', '유사', '일부', '종류'].sort().join(','), '문구가 없으면 유형 이름');
  noErrors(page);
});

test('가로로 멀리 놓인 노드는 오른쪽 → 왼쪽 면으로 이어지고, 배치 최적화 미리보기에서도 선이 계속 그려지며 좌표는 적용 전까지 저장되지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, [[100, 20], [500, 40], [100, 300]], [[0, 1, '사용', '쓴다'], [0, 2, '일부', '일부']]);
  const before = JSON.stringify(srv.db.nodes.map(n => [n.concept_id, n.x, n.y]));
  const d = await page.eval("[...document.querySelectorAll('.m-edge-line')].map(l => l.getAttribute('d'))");
  const horiz = pathPts(d[0]);
  assert.equal(horiz[0], 100 + 132, '가로로 멀어지면 오른쪽 면에서 시작'); assert.equal(horiz[6], 500, '왼쪽 면으로 끝');
  assert.equal(pathPts(d[1])[1], 20 + 44, '아래 노드와는 아래 면');
  await clickMore(page, '#map-opt');
  await page.waitFor("!document.getElementById('map-opt-bar').hidden || /이미 정리/.test(document.getElementById('map-msg').textContent)", 4000);
  const after = await page.eval("[...document.querySelectorAll('.m-edge-line')].map(l => l.getAttribute('d'))");
  assert.equal(after.length, 2); assert.ok(after.every(x => !/NaN|undefined/.test(x) && /^M/.test(x)));
  assert.equal(JSON.stringify(srv.db.nodes.map(n => [n.concept_id, n.x, n.y])), before, '미리보기는 저장하지 않음');
  assert.ok(w.ids.length === 3);
  noErrors(page);
});
