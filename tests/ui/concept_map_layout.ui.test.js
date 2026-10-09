// 작업227-17: 지도 열 안 정렬(이웃 평균 위치) — 같은 입력이면 같은 배치, 겹침 없음, 간선 교차 감소, 연결 없는 개념 배치 유지, 계산 시간.
// (헤드리스 Chrome, 모의 API, 시드 고정 모의 그래프. 실행: node --test tests/ui/concept_map_layout.ui.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { openMap } = require('./helpers/map');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// 시드 고정 모의 그래프: 개념 i 는 앞선 개념 하나와 이어지고(허브 쪽으로 치우침), 추가로 n*0.7 개의 가로지르는 연결. 마지막 `singles` 개는 연결 없음
function graph(n, seed, singles = 0) {
  const r = rng(seed), links = [], seen = new Set();
  const add = (a, b) => { const k = Math.min(a, b) + ':' + Math.max(a, b); if (a !== b && !seen.has(k)) { seen.add(k); links.push([a, b, { relation_type: '사용', label: null, detail: '이유' }]); } };
  const m = n - singles;
  for (let i = 1; i < m; i++) add(Math.floor(r() * r() * i), i);
  for (let k = 0; k < Math.floor(m * 0.7); k++) add(Math.floor(r() * m), Math.floor(r() * m));
  return { items: Array.from({ length: n }, (_, i) => ({ term: '개념' + i })), links };
}
async function open(g, { width = 390, height = 844 } = {}) {
  srv.reset();
  srv.seed({ topic: '정렬', items: g.items.map(i => ({ term: i.term, set: { suggestions: [] } })), links: g.links, path: [0] });
  const page = await browser.newPage({ width, height });
  await page.goto(srv.url + '/concept_study.html#s=' + srv.state.studies[0].id);
  await page.waitFor("!document.getElementById('view-study').hidden && !!document.querySelector('[data-t=term]')");
  await openMap(page);
  return page;
}
// 페이지 안에서: 실제 학습 데이터로 layoutMap 을 부르고 간선 교차(베지어 곡선 표본 선분 교차, 끝점을 공유하는 쌍 제외)를 센다
const CROSS = `(sweeps) => {
  const prev = MAP_LAYOUT_SWEEPS; MAP_LAYOUT_SWEEPS = sweeps;
  try {
    const { active, links } = mapParts();
    const nodes = active.map(i => i.id).sort((a, b) => a - b), edges = links.map(l => [l.from_item_id, l.to_item_id]);
    const { pos } = layoutMap(nodes, edges);
    const curves = edges.map(([a, b]) => {
      const n = edgeGeom(pos.get(a), pos.get(b)).d.match(/-?\\d+(\\.\\d+)?/g).map(Number);
      const pts = [];
      if (n.length >= 8) { const [x0, y0, x1, y1, x2, y2, x3, y3] = n; for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]); } }
      return { a, b, pts };
    });
    const ccw = (p, q, r) => (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0]);
    const segX = (p, q, r, s) => ccw(p, r, s) !== ccw(q, r, s) && ccw(p, q, r) !== ccw(p, q, s);
    let cross = 0;
    for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) {
      const A = curves[i], B = curves[j];
      if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
      let hit = false;
      for (let x = 0; x < A.pts.length - 1 && !hit; x++) for (let y = 0; y < B.pts.length - 1 && !hit; y++) if (segX(A.pts[x], A.pts[x + 1], B.pts[y], B.pts[y + 1])) hit = true;
      if (hit) cross++;
    }
    return { cross, pos: [...pos.entries()] };
  } finally { MAP_LAYOUT_SWEEPS = prev; }
}`;
const run = (page, sweeps) => page.eval(`(${CROSS})(${sweeps})`);

test('같은 입력이면 같은 배치(두 번 계산·다시 열기 모두 좌표 동일)', { skip: SKIP }, async () => {
  const g = graph(20, 227);
  const page = await open(g);
  const a = await run(page, 6), b = await run(page, 6);
  assert.deepEqual(a.pos, b.pos);
  const DOM = "JSON.stringify([...document.querySelectorAll('[data-t=node]')].map(n => [n.dataset.id, n.getAttribute('transform')]))";
  const d1 = await page.eval(DOM);
  await page.close();
  const page2 = await open(g);
  assert.equal(await page2.eval(DOM), d1, '다시 열어도 같은 좌표');
  await page2.close();
});

test('화면의 노드 위치가 layoutMap 결과와 같고(정렬이 실제 화면에 적용됨), 노드 칸이 겹치지 않음', { skip: SKIP }, async () => {
  for (const [n, seed] of [[20, 227], [40, 228]]) {
    const page = await open(graph(n, seed));
    const r = await run(page, 6);
    const dom = await page.eval("[...document.querySelectorAll('[data-t=node]')].map(g => { const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform')); return [Number(g.dataset.id), +m[1], +m[2]]; })");
    const want = new Map(r.pos.map(([id, p]) => [id, [p.x, p.y]]));
    for (const [id, x, y] of dom) assert.deepEqual([x, y], want.get(id), '노드 ' + id);
    let overlaps = 0;
    for (let i = 0; i < dom.length; i++) for (let j = i + 1; j < dom.length; j++) if (Math.abs(dom[i][1] - dom[j][1]) < 132 && Math.abs(dom[i][2] - dom[j][2]) < 44) overlaps++;
    assert.equal(overlaps, 0, 'N=' + n + ' 겹침 0');
    await page.close();
  }
});

test('간선 교차 수가 정렬 전보다 줄어듦(N=20·40, 시드 고정)', { skip: SKIP }, async t => {
  const rows = [];
  for (const [n, seed] of [[20, 227], [40, 228], [20, 7], [40, 8]]) {
    const page = await open(graph(n, seed));
    const before = (await run(page, 0)).cross, after = (await run(page, 6)).cross;
    rows.push(`N=${n} seed=${seed}: ${before} → ${after}`);
    assert.ok(after < before, `N=${n} seed=${seed}: 교차 ${before} → ${after}`);
    await page.close();
  }
  t.diagnostic('간선 교차 전 → 후: ' + rows.join(' / '));
});

test('연결 없는 개념은 기존처럼 아래 격자(3열)에 두고 연결된 개념과 겹치지 않음', { skip: SKIP }, async () => {
  const page = await open(graph(20, 227, 5));
  for (const sweeps of [0, 6]) {
    const r = await run(page, sweeps);
    const connected = new Set(srv.state.links.flatMap(l => [l.from_item_id, l.to_item_id]));
    const pos = new Map(r.pos.map(([id, p]) => [id, p]));
    const singles = [...pos.keys()].filter(id => !connected.has(id));
    assert.equal(singles.length, 5);
    const maxConn = Math.max(...[...connected].map(id => pos.get(id).y));
    for (const id of singles) assert.ok(pos.get(id).y > maxConn, '연결 없는 개념은 연결된 개념들 아래 ' + sweeps);
    assert.ok(singles.every(id => pos.get(id).x % 192 === 0 && pos.get(id).x <= 2 * 192), '3열 격자');
  }
  await page.close();
});

test('초점·이웃 보기·경로 강조는 정렬과 무관하게 그대로 동작(선택한 노드와 이웃만 진함)', { skip: SKIP }, async () => {
  const g = graph(20, 227);
  const page = await open(g);
  const links = srv.state.links, sel = Number(await page.eval("document.querySelector('[data-t=node].sel').dataset.id"));
  const nb = new Set([sel]);
  for (const l of links) { if (l.from_item_id === sel) nb.add(l.to_item_id); if (l.to_item_id === sel) nb.add(l.from_item_id); }
  const st = await page.eval("[...document.querySelectorAll('[data-t=node]')].map(n => [Number(n.dataset.id), n.classList.contains('dim')])");
  for (const [id, dim] of st) assert.equal(dim, !nb.has(id), '노드 ' + id);
  assert.equal(await page.eval("document.querySelectorAll('[data-t=edge][data-hl=\"1\"]').length"), links.filter(l => l.from_item_id === sel || l.to_item_id === sel).length);
  await page.close();
});

test('계산 시간: 60개·100개 개념에서 layoutMap 평균 시간', { skip: SKIP }, async t => {
  const page = await open(graph(8, 1));
  const ms = await page.eval(`(() => {
    const make = n => { let a = 99; const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
      const nodes = Array.from({ length: n }, (_, i) => i + 1), edges = [], seen = new Set();
      const add = (p, q) => { const k = Math.min(p, q) + ':' + Math.max(p, q); if (p !== q && !seen.has(k)) { seen.add(k); edges.push([p, q]); } };
      for (let i = 2; i <= n; i++) add(1 + Math.floor(r() * r() * (i - 1)), i);
      for (let k = 0; k < n * 0.7; k++) add(1 + Math.floor(r() * n), 1 + Math.floor(r() * n));
      return { nodes, edges }; };
    const time = n => { const { nodes, edges } = make(n); layoutMap(nodes, edges); const t0 = performance.now(); for (let i = 0; i < 20; i++) layoutMap(nodes, edges); return (performance.now() - t0) / 20; };
    return { n60: time(60), n100: time(100) };
  })()`);
  t.diagnostic('layoutMap 평균: 60개 ' + ms.n60.toFixed(2) + 'ms, 100개 ' + ms.n100.toFixed(2) + 'ms');
  assert.ok(ms.n60 <= 20, '60개 ' + ms.n60);
  assert.ok(ms.n100 <= 50, '100개 ' + ms.n100);
  await page.close();
});
