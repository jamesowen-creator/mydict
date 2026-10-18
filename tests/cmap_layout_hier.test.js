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

test('295-1: 일부·종류도 화살표 시작이 위 줄(294-1의 "뒤가 위" 규칙 폐기)', () => {
  for (const type of ['일부', '종류']) {
    const r = run(3, [E(1, 2, type), E(2, 3, type)]);
    assert.ok(y(r, 1) < y(r, 2) && y(r, 2) < y(r, 3), type);
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

test('폭을 넘는 층(8개 초과)은 여러 줄로 감기고, 같은 층 줄 간격은 층 사이 간격보다 좁다', () => {
  const n = 11, edges = ids(10).map(i => E(1, i + 1, '일으킴'));    // 1 아래에 10개
  const r = run(n, edges, { w: 440, h: 700 });
  assert.ok(!L.hasOverlap(r.positions, ids(n), 0) && L.isInside(r.positions, ids(n), r.bounds));
  const kids = ids(10).map(i => i + 1), ys = [...new Set(kids.map(i => y(r, i)))].sort((p, q) => p - q);
  assert.strictEqual(ys.length, 2, '두 줄로 감김');
  for (const i of kids) assert.ok(y(r, i) > y(r, 1));
  assert.strictEqual(ys[1] - ys[0], L.CELL_H, '감긴 줄은 붙여서');
  assert.ok(ys[0] - y(r, 1) > L.CELL_H, '층 사이는 더 벌어짐');
});

test('8개 이하의 같은 층은 영역 폭을 넓혀 한 줄에 나란히', () => {
  const r = run(7, ids(6).map(i => E(1, i + 1, '일으킴')), { w: 440, h: 700 });
  assert.strictEqual(new Set(ids(6).map(i => y(r, i + 1))).size, 1);
  assert.strictEqual(r.metrics.expanded, true);
  assert.ok(L.isInside(r.positions, ids(7), r.bounds));
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

// ── 295-1: 기준 사례(증권 구조) ──
const SEC = { 증권: 1, 유가증권: 2, 주식: 3, 회사채: 4, 국공채: 5, 조건환매부채권: 6, IPO: 7, 연결없음: 8 };
const SEC_EDGES = [E(1, 2, '종류'), E(2, 3, '종류'), E(2, 4, '종류'), E(2, 5, '일부'), E(2, 6, '종류'), E(3, 7, '일부')];
const cxOf = (r, id) => x(r, id) + L.NODE_W / 2, cyOf = (r, id) => y(r, id) + L.NODE_H / 2;
function segHitsRect(r, a, b, c) {      // 선분(a-b 중심)이 노드 c 의 사각형을 지나는가
  const [x0, y0, x1, y1] = [cxOf(r, a), cyOf(r, a), cxOf(r, b), cyOf(r, b)], rx = x(r, c), ry = y(r, c);
  for (let k = 0; k <= 200; k++) { const t = k / 200, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t; if (px > rx && px < rx + L.NODE_W && py > ry && py < ry + L.NODE_H) return true; }
  return false;
}
const noThrough = (r, edges, n) => edges.every(e => ids(n).filter(c => c !== e.from && c !== e.to).every(c => !segHitsRect(r, e.from, e.to, c)));

test('기준 사례: 줄·가운데 정렬·교차 0·선이 제3 노드를 가로지르지 않음·연결 없는 개념은 마지막 줄', () => {
  const r = run(8, SEC_EDGES, { w: 400, h: 600 });
  const S = SEC, ys = n => y(r, S[n]);
  assert.ok(ys('증권') < ys('유가증권') && ys('유가증권') < ys('주식') && ys('주식') < ys('IPO'));
  for (const n of ['회사채', '국공채', '조건환매부채권']) assert.strictEqual(ys(n), ys('주식'), n);
  const lines = [ys('증권'), ys('유가증권'), ys('주식'), ys('IPO')];
  assert.deepStrictEqual(lines.map((v, i) => v - lines[0] === i * L.CELL_H), [true, true, true, true], '줄 간격 균일 ' + lines);
  const kidX = [3, 4, 5, 6].map(i => cxOf(r, i)), mid = (Math.min(...kidX) + Math.max(...kidX)) / 2;
  // 304-1: 종류 묶음({주식, 회사채, 조건환매부채권} | {국공채}) 사이에 GROUP_GAP(16px)이 들어가 간격이 고르지 않으므로 부모는 자식 평균 위치(등위 회귀 목표)에 놓인다 — 정확한 가운데에서 GROUP_GAP/2 이내
  assert.ok(Math.abs(cxOf(r, S['유가증권']) - mid) < L.GROUP_GAP / 2 + 1, '유가 증권은 셋째 줄 개념들의 가운데(종류 묶음 간격만큼 허용)');
  assert.ok(Math.abs(cxOf(r, S['주식']) - cxOf(r, S['IPO'])) < 1, '주식 바로 위에 IPO');
  assert.ok(Math.abs(cxOf(r, S['증권']) - cxOf(r, S['유가증권'])) < 1);
  assert.strictEqual(L.crossings(r.positions, SEC_EDGES.map(e => [e.from, e.to])), 0);
  assert.strictEqual(r.metrics.crossingsAfter, 0);
  assert.ok(noThrough(r, SEC_EDGES, 8), '선이 제3 노드를 지나지 않음');
  assert.ok(ys('연결없음') > ys('IPO'), '연결 없는 개념은 마지막 줄');
  const gaps = [3, 4, 5, 6].map(i => x(r, i)).sort((p, q) => p - q).map((v, i, a) => i ? v - a[i - 1] : null).slice(1);
  // 304-1: 간격은 칸 폭(CELL_W)이고, 서로 다른 종류 묶음 사이 하나만 GROUP_GAP 만큼 더 넓다. 같은 종류 자식(주식·회사채·조건환매부채권)은 서로 이웃하다
  const sorted = [3, 4, 5, 6].map(i => ({ i, x: x(r, i) })).sort((p, q) => p.x - q.x);
  const extra = sorted.slice(1).map((v, k) => v.x - sorted[k].x - L.CELL_W);
  assert.ok(extra.every(g => Math.abs(g) < 0.5 || Math.abs(g - L.GROUP_GAP) < 0.5), '간격 = CELL_W 또는 CELL_W + GROUP_GAP: ' + extra);
  const kindOrder = sorted.map(v => v.i), pos5 = kindOrder.indexOf(5);
  assert.ok(pos5 === 0 || pos5 === 3, '일부(국공채)는 종류 3개의 한쪽 끝에 붙는다(종류 3개가 연속): ' + kindOrder);
});

test('기준 사례: 어떤 입력 순서·id 배정이어도 줄과 교차 0 유지', () => {
  const perm = [5, 3, 8, 1, 7, 2, 6, 4];                     // id 를 섞어 이름 → id 대응을 바꾼다
  const edges = SEC_EDGES.map(e => E(perm[e.from - 1], perm[e.to - 1], e.type));
  const r = run(8, edges.slice().reverse(), { w: 400, h: 600 });
  const Y = n => y(r, perm[SEC[n] - 1]);
  assert.ok(Y('증권') < Y('유가증권') && Y('유가증권') < Y('주식') && Y('주식') < Y('IPO'));
  assert.strictEqual(new Set(['주식', '회사채', '국공채', '조건환매부채권'].map(Y)).size, 1);
  assert.strictEqual(L.crossings(r.positions, edges.map(e => [e.from, e.to])), 0);
  assert.ok(noThrough(r, edges, 8));
});

test('트리: 서브트리끼리 겹치지 않아 교차 0, 부모는 자식 가운데 위', () => {
  const edges = [E(1, 2, '일으킴'), E(1, 3, '일으킴'), E(2, 4, '일으킴'), E(2, 5, '일으킴'), E(2, 6, '일으킴'), E(3, 7, '일으킴'), E(3, 8, '일으킴'), E(6, 9, '일으킴')];
  const r = run(9, edges, { w: 400, h: 600 });
  assert.strictEqual(L.crossings(r.positions, edges.map(e => [e.from, e.to])), 0);
  assert.ok(noThrough(r, edges, 9));
  const kids = [4, 5, 6].map(i => cxOf(r, i));
  assert.ok(Math.abs(cxOf(r, 2) - (Math.min(...kids) + Math.max(...kids)) / 2) < 1);
  assert.deepStrictEqual([...new Set(ids(9).map(i => y(r, i)))].length, 4);
});

test('같은 깊이는 같은 y, 깊이 차는 줄 차와 일치', () => {
  const edges = [E(1, 2, '사용'), E(1, 3, '일부'), E(2, 4, '종류'), E(3, 4, '조건'), E(4, 5, '선행'), E(1, 5, '연관')];
  const r = run(6, edges, { w: 400, h: 600 });
  assert.strictEqual(y(r, 2), y(r, 3));
  assert.strictEqual(y(r, 4) - y(r, 2), L.CELL_H);
  assert.strictEqual(y(r, 5) - y(r, 4), L.CELL_H);
  assert.strictEqual(y(r, 2) - y(r, 1), L.CELL_H);
  assert.ok(y(r, 6) > y(r, 5), '연결 없는 개념은 마지막 줄');
});

test('부모가 둘인 DAG: 선 교차가 없는 배치를 찾고, 단순 id 순서 배치보다 교차가 같거나 적다', () => {
  const edges = [E(1, 5, '사용'), E(1, 6, '사용'), E(2, 6, '사용'), E(2, 7, '사용'), E(3, 7, '사용'), E(3, 8, '사용'), E(4, 8, '사용'), E(4, 5, '사용')];
  const r = run(8, edges, { w: 400, h: 600 });
  const plain = new Map(ids(8).map(i => [i, { x: ((i - 1) % 4) * L.CELL_W, y: i <= 4 ? 0 : L.CELL_H }]));
  const pairsE = edges.map(e => [e.from, e.to]);
  assert.ok(L.crossings(r.positions, pairsE) <= L.crossings(plain, pairsE));
  assert.strictEqual(r.metrics.layout, 'hierarchy');
  // 교차가 꼭 생기는 구조에서도 같은 입력은 같은 결과
  const again = run(8, edges.slice().reverse(), { w: 400, h: 600 });
  assert.deepStrictEqual([...again.positions], [...r.positions]);
});

// ── 304-1: 같은 층에서 같은 부모(부모 1명인 노드)·같은 종류의 자식을 연속 배치하고 종류 묶음 사이에 GROUP_GAP ──
const rowOrder = (r, list) => list.slice().sort((p, q) => x(r, p) - x(r, q)).map(i => i);

test('304-1 배치: 같은 부모의 같은 종류 자식이 연속해서 놓이고, 종류가 다른 이웃 사이에만 GROUP_GAP(16px)이 더해진다', () => {
  const kind = { 2: '종류', 3: '일부', 4: '종류', 5: '일부', 6: '종류' };
  const edges = [2, 3, 4, 5, 6].map(i => E(1, i, kind[i]));
  const r = run(6, edges, { w: 1200, h: 700 });
  const order = rowOrder(r, [2, 3, 4, 5, 6]);
  const changes = order.slice(1).filter((id, i) => kind[id] !== kind[order[i]]).length;
  assert.strictEqual(changes, 1, '종류가 한 번만 바뀐다(같은 종류가 연속): ' + order.map(i => kind[i]));
  const gaps = order.slice(1).map((id, i) => x(r, id) - x(r, order[i]) - L.CELL_W);
  assert.deepStrictEqual(gaps.map(g => Math.round(g * 10) / 10).sort((a, b) => a - b), [0, 0, 0, L.GROUP_GAP], '간격은 CELL_W, 종류가 바뀌는 곳만 CELL_W + GROUP_GAP: ' + gaps);
  assert.strictEqual(L.GROUP_GAP, 16);
  assert.ok(!L.hasOverlap(r.positions, ids(6), 0));
  assert.deepStrictEqual([...run(6, edges.slice().reverse(), { w: 1200, h: 700 }).positions], [...r.positions], '결정성');
});

test('304-1 배치: 부모가 가진 종류가 하나뿐이거나 종류 정보가 없으면 기존 결과와 같다', () => {
  const kidsOf = type => [2, 3, 4, 5].map(i => E(1, i, type)).concat([E(2, 6, type), E(4, 7, type)]);
  const one = run(7, kidsOf('종류'), { w: 1200, h: 700 }), none = run(7, kidsOf(undefined), { w: 1200, h: 700 }), nul = run(7, kidsOf(null), { w: 1200, h: 700 });
  assert.deepStrictEqual([...one.positions], [...none.positions], '종류 하나 = 종류 정보 없음');
  assert.deepStrictEqual([...nul.positions], [...none.positions]);
  // 종류가 바뀌어도 한 부모에 종류가 하나뿐인 부모끼리는 간격이 균등(GROUP_GAP 없음)
  const row = rowOrder(one, [2, 3, 4, 5]);
  assert.ok(row.slice(1).every((id, i) => Math.abs(x(one, id) - x(one, row[i]) - L.CELL_W) < 0.5));
});

test('304-1 배치: 부모가 여럿인 노드(수렴)는 묶음에서 제외되고 그 이웃 사이에는 추가 간격이 없다', () => {
  // 노드 4 는 부모 1(종류)과 부모 5(사용) 둘을 가진다. 부모 1 의 다른 자식: 2(종류), 3(일부)
  const edges = [E(1, 2, '종류'), E(1, 3, '일부'), E(1, 4, '종류'), E(5, 4, '사용')];
  const r = run(5, edges, { w: 1200, h: 700 });
  const sameRow = [2, 3, 4].filter(i => y(r, i) === y(r, 4));
  const order = rowOrder(r, sameRow), pos = order.indexOf(4);
  for (const nb of [order[pos - 1], order[pos + 1]].filter(Boolean)) assert.ok(Math.abs(Math.abs(x(r, nb) - x(r, 4)) - L.CELL_W) < 0.5, `수렴 노드 이웃 ${nb} 와 간격 = CELL_W`);
  assert.deepStrictEqual([...run(5, edges.slice().reverse(), { w: 1200, h: 700 }).positions], [...r.positions]);
});

test('304-1 배치: 층 감김(한 층 9개 이상)과 공존 — 같은 종류는 연속, 겹침 없음, 영역 안, 결정성', () => {
  const kind = i => (i % 2 ? '종류' : '일부');
  const edges = Array.from({ length: 10 }, (_, k) => E(1, 2 + k, kind(2 + k)));
  const r = run(11, edges, { w: 800, h: 700 });
  assert.strictEqual(r.metrics.layout, 'hierarchy');
  const kids = Array.from({ length: 10 }, (_, k) => 2 + k);
  const order = kids.slice().sort((p, q) => y(r, p) - y(r, q) || x(r, p) - x(r, q));
  const changes = order.slice(1).filter((id, i) => kind(id) !== kind(order[i])).length;
  assert.strictEqual(changes, 1, '감긴 줄에서도 종류가 한 번만 바뀐다: ' + order.map(kind));
  assert.ok(!L.hasOverlap(r.positions, ids(11), 0)); assert.ok(L.isInside(r.positions, ids(11), r.bounds));
  assert.deepStrictEqual([...run(11, edges.slice().reverse(), { w: 800, h: 700 }).positions], [...r.positions]);
});

test('304-1 배치: 기준 사례(증권 구조)는 종류 3개가 연속이고 국공채(일부)가 한쪽 끝에 붙는다', () => {
  const r = run(8, SEC_EDGES, { w: 400, h: 600 });
  const order = rowOrder(r, [3, 4, 5, 6]);   // 3 주식, 4 회사채, 5 국공채(일부), 6 조건환매부채권
  assert.ok(order[0] === 5 || order[3] === 5, '국공채는 끝: ' + order);
  assert.strictEqual(L.crossings(r.positions, SEC_EDGES.map(e => [e.from, e.to])), 0);
});
