// 작업294-1: 배치 최적화 계층형(public/js/cmap/layoutOptimize.js) 테스트 — 방향 있는 연결은 위→아래, 방향 없는 연결은 같은 줄 이웃, 연결 없는 개념은 마지막 줄.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/js/cmap/layoutOptimize.js');

const SYM = ['구별', '유사', '대립', '연관'];
const E = (from, to, type) => ({ from, to, type, sym: SYM.includes(type) });
const nodesOf = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, x: 0, y: 0 }));
const run = (n, edges, bounds) => L.optimizeLayout(nodesOf(n), edges, { bounds: bounds || { w: 800, h: 700 } });
const y = (r, id) => r.positions.get(id).y, x = (r, id) => r.positions.get(id).x;
const ids = n => Array.from({ length: n }, (_, i) => i + 1);

test('방향 있는 연결: 화살표 시작 개념이 위 줄(사용·일으킴·선행·조건)', () => {
  for (const type of ['사용', '일으킴', '선행', '조건', null]) {
    const r = run(3, [E(1, 2, type), E(2, 3, type)]);
    assert.ok(y(r, 1) < y(r, 2) && y(r, 2) < y(r, 3), type + ' ' + JSON.stringify([...r.positions]));
    assert.strictEqual(r.metrics.layout, 'hierarchy');
  }
});

test('일부·종류: 화살표 끝(전체·상위 개념)이 위 줄', () => {
  for (const type of ['일부', '종류']) {
    const r = run(3, [E(1, 2, type), E(2, 3, type)]);   // 1이 2의 일부, 2가 3의 일부 → 3이 가장 위
    assert.ok(y(r, 3) < y(r, 2) && y(r, 2) < y(r, 1), type);
  }
});

test('층은 가장 긴 경로로 정한다(바로 아래가 아니라 더 아래 층)', () => {
  const r = run(3, [E(1, 2, '일으킴'), E(2, 3, '일으킴'), E(1, 3, '일으킴')]);
  assert.ok(y(r, 1) < y(r, 2) && y(r, 2) < y(r, 3));
});

test('순환 입력: 한 연결을 끊어 처리하고 결과는 입력 순서와 무관하게 같다', () => {
  const edges = [E(1, 2, '선행'), E(2, 3, '선행'), E(3, 1, '선행'), E(3, 4, '선행')];
  const a = run(4, edges), b = run(4, edges.slice().reverse()), c = run(4, edges);
  assert.deepStrictEqual([...a.positions], [...b.positions]);
  assert.deepStrictEqual([...a.positions], [...c.positions]);
  assert.ok(!L.hasOverlap(a.positions, ids(4), 0) && L.isInside(a.positions, ids(4), a.bounds));
  const ys = new Set(ids(4).map(i => y(a, i)));
  assert.strictEqual(ys.size, 4, '순환이 풀려 네 층으로 나뉨');
  assert.ok(y(a, 3) < y(a, 4));
  // 서로 반대 방향 두 연결(2-cycle)도 안전
  const two = run(2, [E(1, 2, '선행'), E(2, 1, '선행')]);
  assert.notStrictEqual(y(two, 1), y(two, 2));
});

test('방향 없는 연결: 두 개념이 같은 줄에서 이웃', () => {
  const r = run(5, [E(1, 2, '일으킴'), E(1, 3, '일으킴'), E(2, 3, '구별'), E(1, 4, '일으킴'), E(1, 5, '일으킴')]);
  assert.strictEqual(y(r, 2), y(r, 3));
  const row = [2, 3, 4, 5].filter(i => y(r, i) === y(r, 2)).sort((p, q) => x(r, p) - x(r, q));
  assert.strictEqual(Math.abs(row.indexOf(2) - row.indexOf(3)), 1, '이웃: ' + row);
});

test('방향 없는 연결이 방향 있는 순서와 충돌하면 방향 있는 순서가 우선', () => {
  const r = run(3, [E(1, 2, '일으킴'), E(2, 3, '일으킴'), E(1, 3, '연관')]);
  assert.ok(y(r, 1) < y(r, 2) && y(r, 2) < y(r, 3));
});

test('방향 없는 연결만 맺힌 개념은 이웃의 줄을 따른다', () => {
  const r = run(3, [E(1, 2, '일으킴'), E(2, 3, '유사')]);
  assert.strictEqual(y(r, 2), y(r, 3));
});

test('연결 없는 개념은 모든 층 아래 마지막 줄', () => {
  const r = run(6, [E(1, 2, '일으킴'), E(2, 3, '일으킴')]);   // 4, 5, 6 은 연결 없음
  const last = Math.max(y(r, 1), y(r, 2), y(r, 3));
  for (const i of [4, 5, 6]) assert.ok(y(r, i) > last, '노드 ' + i);
  assert.strictEqual(new Set([4, 5, 6].map(i => y(r, i))).size, 1);
});

test('방향 없는 연결만 있거나 연결이 없으면 기존 후보 선택을 그대로 쓴다', () => {
  const nodes = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 600, y: 500 }, { id: 3, x: 0, y: 500 }, { id: 4, x: 600, y: 0 }];
  const B = { w: 760, h: 600 };
  const withSym = L.optimizeLayout(nodes, [E(1, 2, '구별'), E(3, 4, '연관')], { bounds: B });
  const plain = L.optimizeLayout(nodes, [{ from: 1, to: 2 }, { from: 3, to: 4 }], { bounds: B });
  assert.strictEqual(withSym.metrics.layout, 'general');
  assert.deepStrictEqual([...withSym.positions], [...plain.positions]);
  assert.strictEqual(withSym.metrics.crossingsAfter, 0);
  const none = L.optimizeLayout(nodes, [], { bounds: B });
  assert.strictEqual(none.metrics.layout, 'general');
  // sym 정보가 없는 예전 호출은 계층을 쓰지 않는다
  assert.strictEqual(plain.metrics.layout, 'general');
});

test('겹침 없음·영역 안·노드 집합 그대로(여러 모양)', () => {
  const cases = [
    [1, []], [2, [E(1, 2, '일으킴')]],
    [8, [E(1, 2, '사용'), E(1, 3, '일부'), E(2, 4, '종류'), E(3, 4, '구별'), E(5, 6, '선행'), E(6, 7, '조건'), E(7, 5, '일으킴')]],
    [12, ids(11).map(i => E(i, i + 1, '선행'))],
  ];
  for (const [n, edges] of cases) {
    const r = run(n, edges, { w: 500, h: 400 });
    assert.deepStrictEqual([...r.positions.keys()].sort((p, q) => p - q), ids(n));
    assert.ok(!L.hasOverlap(r.positions, ids(n), 0), 'n=' + n);
    assert.ok(L.isInside(r.positions, ids(n), r.bounds), 'n=' + n);
  }
});

test('입력(연결·노드) 순서를 바꿔도 같은 결과', () => {
  const edges = [E(1, 2, '사용'), E(1, 3, '일부'), E(2, 4, '종류'), E(3, 4, '구별'), E(5, 6, '선행'), E(6, 1, '조건'), E(2, 3, '유사')];
  const nodes = nodesOf(7);
  const a = L.optimizeLayout(nodes, edges, { bounds: { w: 700, h: 600 } });
  const b = L.optimizeLayout(nodes.slice().reverse(), edges.slice().reverse(), { bounds: { w: 700, h: 600 } });
  assert.deepStrictEqual([...a.positions].sort((p, q) => p[0] - q[0]), [...b.positions].sort((p, q) => p[0] - q[0]));
  assert.deepStrictEqual(a.metrics, b.metrics);
});

test('폭을 넘는 층은 여러 줄로 감기고 같은 층 줄 사이가 층 사이보다 가깝다', () => {
  const n = 9, edges = ids(8).map(i => E(1, i + 1, '일으킴'));    // 1 아래에 8개
  const B = { w: 440, h: 700 };                                     // 한 줄에 2칸
  const r = run(n, edges, B);
  assert.ok(!L.hasOverlap(r.positions, ids(n), 0) && L.isInside(r.positions, ids(n), r.bounds));
  const ys = [...new Set([2, 3, 4, 5, 6, 7, 8, 9].map(i => y(r, i)))].sort((p, q) => p - q);
  assert.ok(ys.length > 1, '여러 줄로 감김');
  for (const i of [2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(y(r, i) > y(r, 1));
  assert.ok(ys[1] - ys[0] < y(r, 2) - y(r, 1) + 1 && ys[1] - ys[0] === L.CELL_H, '같은 층 줄 간격은 층 간격보다 좁다');
});

test('층이 많아 세로가 모자라면 영역 높이를 늘리고 영역 안에 놓는다', () => {
  const r = run(12, ids(11).map(i => E(i, i + 1, '선행')), { w: 500, h: 300 });
  assert.strictEqual(r.metrics.expanded, true);
  assert.ok(r.bounds.h >= 11 * L.CELL_H);
  assert.ok(L.isInside(r.positions, ids(12), r.bounds));
});

test('입력 배열은 바뀌지 않는다(연결 정보 포함)', () => {
  const nodes = nodesOf(4), edges = [E(1, 2, '사용'), E(2, 3, '구별')], snap = JSON.stringify([nodes, edges]);
  L.optimizeLayout(nodes, edges, { bounds: { w: 700, h: 600 } });
  assert.strictEqual(JSON.stringify([nodes, edges]), snap);
});
