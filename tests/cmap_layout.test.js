// 작업273-3: 배치 최적화 순수 모듈(public/js/cmap/layoutOptimize.js) 테스트. 난수 시드를 고정한 무작위 그래프로 결정성·겹침·교차·범위를 확인한다.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/js/cmap/layoutOptimize.js');

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function randomGraph(seed, n, m, bounds) {
  const r = prng(seed);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: i + 1, x: Math.floor(r() * (bounds.w - L.NODE_W)), y: Math.floor(r() * (bounds.h - L.NODE_H)) }));
  const edges = [], seen = new Set();
  while (edges.length < m) {
    const a = 1 + Math.floor(r() * n), b = 1 + Math.floor(r() * n);
    const k = Math.min(a, b) + ':' + Math.max(a, b);
    if (a === b || seen.has(k)) continue;
    seen.add(k); edges.push({ from: a, to: b });
  }
  return { nodes, edges };
}
const asPos = nodes => new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
const pairs = es => es.map(e => [e.from, e.to]);

test('같은 입력은 항상 같은 결과(결정적)', () => {
  const B = { w: 700, h: 600 }, g = randomGraph(7, 12, 16, B);
  const a = L.optimizeLayout(g.nodes, g.edges, { bounds: B }), b = L.optimizeLayout(g.nodes, g.edges, { bounds: B });
  assert.deepStrictEqual([...a.positions], [...b.positions]);
  assert.deepStrictEqual(a.metrics, b.metrics);
});

test('고정 시드 무작위 그래프: 겹침 없음 + 영역 안 + 노드 id 집합 그대로', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const n = 3 + (seed % 12), B = { w: 760, h: 640 }, g = randomGraph(seed, n, Math.min(n * (n - 1) / 2, n + (seed % 6)), B);
    const r = L.optimizeLayout(g.nodes, g.edges, { bounds: B });
    const ids = g.nodes.map(x => x.id);
    assert.deepStrictEqual([...r.positions.keys()].sort((p, q) => p - q), ids, `seed ${seed}: 노드 집합`);
    assert.ok(!L.hasOverlap(r.positions, ids, 0), `seed ${seed}: 겹침`);
    assert.ok(L.isInside(r.positions, ids, r.bounds), `seed ${seed}: 영역 밖`);
  }
});

test('원래 배치가 유효하면 교차 수가 늘지 않는다 (고정 시드 여러 그래프)', () => {
  let improved = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const n = 4 + (seed % 8), B = { w: 900, h: 800 };
    // 격자 칸에 무작위로 놓아 겹침 없는 유효한 시작 배치를 만든다
    const r0 = prng(seed * 31), cells = [];
    for (let cx = 0; cx < 4; cx++) for (let cy = 0; cy < 5; cy++) cells.push([cx * L.CELL_W, cy * L.CELL_H]);
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(r0() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    const nodes = Array.from({ length: n }, (_, i) => ({ id: i + 1, x: cells[i][0], y: cells[i][1] }));
    const g = randomGraph(seed + 100, n, Math.min(n * (n - 1) / 2, n + 2), B);
    const before = L.crossings(asPos(nodes), pairs(g.edges));
    const r = L.optimizeLayout(nodes, g.edges, { bounds: B });
    const after = L.crossings(r.positions, pairs(g.edges));
    assert.ok(after <= before, `seed ${seed}: ${before} → ${after}`);
    assert.strictEqual(r.metrics.crossingsAfter, after);
    assert.strictEqual(r.metrics.crossingsBefore, before);
    if (after < before) improved++;
  }
  assert.ok(improved > 0, '교차가 줄어든 경우가 한 번은 있어야 함');
});

test('모두 한 점에 겹친 노드도 겹침 없이 펼쳐진다', () => {
  const nodes = [1, 2, 3, 4, 5, 6].map(id => ({ id, x: 10, y: 10 }));
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 6 }];
  const r = L.optimizeLayout(nodes, edges, { bounds: { w: 600, h: 500 } });
  assert.ok(!L.hasOverlap(r.positions, nodes.map(n => n.id), 0));
  assert.ok(L.isInside(r.positions, nodes.map(n => n.id), r.bounds));
  assert.strictEqual(r.metrics.changed, true);
});

test('영역 밖에 있던 노드는 영역 안으로 들어온다', () => {
  const nodes = [{ id: 1, x: -500, y: 9000 }, { id: 2, x: 5000, y: -40 }, { id: 3, x: 100, y: 100 }];
  const r = L.optimizeLayout(nodes, [{ from: 1, to: 2 }], { bounds: { w: 500, h: 400 } });
  assert.ok(L.isInside(r.positions, [1, 2, 3], r.bounds));
  assert.ok(!L.hasOverlap(r.positions, [1, 2, 3], 0));
});

test('연결된 노드가 멀리 떨어진 배치는 연결선 길이가 줄어든다', () => {
  const nodes = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 600, y: 500 }, { id: 3, x: 0, y: 500 }, { id: 4, x: 600, y: 0 }];
  const edges = [{ from: 1, to: 2 }, { from: 3, to: 4 }];       // 서로 교차하는 두 간선
  const B = { w: 760, h: 600 };
  const before = L.crossings(asPos(nodes), pairs(edges));
  const r = L.optimizeLayout(nodes, edges, { bounds: B });
  assert.strictEqual(before, 1);
  assert.strictEqual(r.metrics.crossingsAfter, 0);
  assert.ok(r.metrics.lengthAfter < r.metrics.lengthBefore);
});

test('이미 좋은 배치는 그대로 둔다(changed=false)', () => {
  const nodes = [{ id: 1, x: 0, y: 0 }, { id: 2, x: L.NODE_W + L.GAP, y: 0 }];
  const r = L.optimizeLayout(nodes, [{ from: 1, to: 2 }], { bounds: { w: 600, h: 300 } });
  assert.strictEqual(r.metrics.changed, false);
  assert.deepStrictEqual(r.positions.get(1), { x: 0, y: 0 });
  assert.deepStrictEqual(r.positions.get(2), { x: L.NODE_W + L.GAP, y: 0 });
});

test('노드 0개·1개·간선 없음·잘못된 간선은 안전하게 처리', () => {
  assert.strictEqual(L.optimizeLayout([], [], {}).positions.size, 0);
  const one = L.optimizeLayout([{ id: 9, x: 5000, y: 5000 }], [{ from: 9, to: 9 }, { from: 9, to: 77 }], { bounds: { w: 400, h: 300 } });
  assert.ok(L.isInside(one.positions, [9], one.bounds));
  const none = L.optimizeLayout([{ id: 1, x: 0, y: 0 }, { id: 2, x: 0, y: 0 }], [], { bounds: { w: 400, h: 300 } });
  assert.ok(!L.hasOverlap(none.positions, [1, 2], 0));
});

test('영역이 노드 수에 비해 너무 작으면 영역을 넓혀 겹침 없이 놓는다', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, x: 0, y: 0 }));
  const r = L.optimizeLayout(nodes, [], { bounds: { w: 200, h: 100 } });
  assert.strictEqual(r.metrics.expanded, true);
  assert.ok(!L.hasOverlap(r.positions, nodes.map(n => n.id), 0));
  assert.ok(L.isInside(r.positions, nodes.map(n => n.id), r.bounds));
});

test('입력 배열은 바뀌지 않는다', () => {
  const g = randomGraph(3, 8, 9, { w: 700, h: 600 }), snap = JSON.stringify(g);
  L.optimizeLayout(g.nodes, g.edges, { bounds: { w: 700, h: 600 } });
  assert.strictEqual(JSON.stringify(g), snap);
});
