// 작업290-1: 개념 지도 연결선 경로(public/js/cmap/edgeRoute.js) 단위 테스트 — 브라우저 없음. 실행: node --test tests/cmap_edge_route.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/js/cmap/edgeRoute.js');

const W = R.W, H = R.H;
const node = (id, x, y) => ({ id, x, y });
const edge = (key, from, to, label = '') => ({ key, from, to, label });
const nums = d => d.match(/-?\d+(\.\d+)?/g).map(Number);          // M x,y C x,y x,y x,y → 8개 수
const ends = d => { const n = nums(d); return { p0: { x: n[0], y: n[1] }, c1: { x: n[2], y: n[3] }, c2: { x: n[4], y: n[5] }, p3: { x: n[6], y: n[7] } }; };
const rect = n => ({ x0: n.x, x1: n.x + W, y0: n.y, y1: n.y + H });
const overlap = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

test('접속면: 같은 열이면 위쪽 노드의 아래 면 → 아래쪽 노드의 위 면(오른쪽으로 크게 도는 선이 없다), 반대로 놓이면 반대', () => {
  const a = node(1, 0, 0), b = node(2, 0, 200);
  let r = R.routeAll([a, b], [edge('e', 1, 2)]).get('e');
  assert.deepEqual(r.sides, ['b', 't']);
  let p = ends(r.d);
  assert.equal(p.p0.y, H, 'A 의 아래 면'); assert.equal(p.p3.y, 200, 'B 의 위 면');
  assert.ok(p.p0.x >= 0 && p.p0.x <= W && p.p3.x >= 0 && p.p3.x <= W);
  assert.ok(p.c1.y > p.p0.y && p.c2.y < p.p3.y, '시작 접선은 아래로 나가고 끝 접선은 위에서 들어온다');
  r = R.routeAll([a, b], [edge('e', 2, 1)]).get('e');
  assert.deepEqual(r.sides, ['t', 'b'], '위로 향하는 선은 아래쪽 노드의 위 면에서 나가 위쪽 노드의 아래 면으로');
  // 조금 어긋난 같은 열(옛 규칙은 정확히 같은 x 만 같은 열로 봐 S자로 가로질렀다)
  for (const dx of [1, 5, 30, 66]) assert.deepEqual(R.routeAll([a, node(2, dx, 200)], [edge('e', 1, 2)]).get('e').sides, ['b', 't'], 'dx=' + dx);
  assert.deepEqual(R.routeAll([a, node(2, -40, 200)], [edge('e', 1, 2)]).get('e').sides, ['b', 't']);
});

test('접속면: 가로로 놓이면 옆 면끼리(오른쪽 → 왼쪽 / 왼쪽 → 오른쪽), 세로로 거의 같은 높이여도 옆 면', () => {
  let r = R.routeAll([node(1, 0, 0), node(2, 300, 0)], [edge('e', 1, 2)]).get('e');
  assert.deepEqual(r.sides, ['r', 'l']);
  const p = ends(r.d); assert.equal(p.p0.x, W); assert.equal(p.p3.x, 300);
  assert.ok(p.c1.x > p.p0.x && p.c2.x < p.p3.x);
  assert.deepEqual(R.routeAll([node(1, 300, 0), node(2, 0, 0)], [edge('e', 1, 2)]).get('e').sides, ['l', 'r']);
  assert.deepEqual(R.routeAll([node(1, 0, 0), node(2, 300, 30)], [edge('e', 1, 2)]).get('e').sides, ['r', 'l'], '세로 간격이 노드 높이(44) 미만이면 옆 면');
});

test('접속면: 대각선은 격자 칸 수로 비교 — 가로 1칸·세로 1칸(192, 64)은 옆 면, 세로가 우세하면 위/아래 면, 가로가 우세하면 옆 면', () => {
  const sides = (dx, dy) => R.routeAll([node(1, 0, 0), node(2, dx, dy)], [edge('e', 1, 2)]).get('e').sides.join('');
  assert.equal(sides(192, 64), 'rl', '격자 이웃 대각선');
  assert.equal(sides(130, 200), 'bt', '세로 성분 우세');
  assert.equal(sides(400, 50), 'rl', '가로 성분 우세');
  assert.equal(sides(-192, 64), 'lr'); assert.equal(sides(-130, -200), 'tb'); assert.equal(sides(150, 90), 'bt', '세로 1.4칸 > 가로 0.8칸');
  assert.deepEqual(R.preferredSides({ x: 0, y: 0 }, { x: 0, y: 100 }), ['b', 't']);
});

test('같은 면에 연결이 여럿이면 접속점이 서로 다르고 면 안에 있으며 상대 노드 위치 순서대로 놓인다', () => {
  const a = node(1, 200, 0);
  const kids = [node(2, 0, 200), node(3, 200, 200), node(4, 400, 200), node(5, 600, 200)];
  const r = R.routeAll([a, ...kids], kids.map(k => edge('e' + k.id, 1, k.id)));
  const xs = kids.map(k => ends(r.get('e' + k.id).d).p0.x);
  assert.equal(new Set(xs).size, 4, '접속점이 모두 다름');
  assert.ok(xs.every(x => x > a.x && x < a.x + W), '면(아래 면) 안: ' + xs);
  assert.deepEqual(xs, xs.slice().sort((p, q) => p - q), '왼쪽 상대 노드일수록 왼쪽 접속점(교차 감소)');
  const gaps = xs.slice(1).map((x, i) => x - xs[i]); assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.6, '균등 분할: ' + gaps);
  // 연결이 하나면 면의 가운데
  const one = R.routeAll([a, kids[1]], [edge('e', 1, 3)]).get('e');
  assert.equal(ends(one.d).p0.x, a.x + W / 2);
  // 옆 면에서도: 세 개가 세로로 나뉜다
  const c = node(10, 0, 0), rights = [node(11, 600, -120), node(12, 600, 0), node(13, 600, 120)];
  const r2 = R.routeAll([c, ...rights], rights.map(k => edge('e' + k.id, 10, k.id)));
  const ys = rights.map(k => ends(r2.get('e' + k.id).d).p0.y);
  assert.equal(new Set(ys).size, 3); assert.ok(ys.every(y => y > 0 && y < H)); assert.deepEqual(ys, ys.slice().sort((p, q) => p - q));
  // 들어오는 쪽도 같은 규칙(여러 노드에서 한 노드의 위 면으로)
  const t = node(20, 200, 300), srcs = [node(21, 0, 0), node(22, 400, 0)];
  const r3 = R.routeAll([t, ...srcs], srcs.map(s => edge('e' + s.id, s.id, 20)));
  const inx = srcs.map(s => ends(r3.get('e' + s.id).d).p3.x);
  assert.notEqual(inx[0], inx[1]); assert.ok(inx.every(x => x > t.x && x < t.x + W)); assert.ok(inx[0] < inx[1]);
});

test('결정성: 노드·연결의 입력 순서를 바꿔도 연결마다 결과가 같고, 여러 번 불러도 같다. NaN·Infinity 없음(겹친 노드·좌표 NaN·빈 라벨 포함)', () => {
  const nodes = [node(1, 0, 0), node(2, 0, 120), node(3, 220, 60), node(4, 220, 200), node(5, 440, 0), node(6, 440, 140)];
  const edges = [edge('a', 1, 2, '일부'), edge('b', 1, 3, '종류'), edge('c', 1, 4, '사용'), edge('d', 3, 5, '조건'), edge('e', 3, 6, ''), edge('f', 4, 6, '선행'), edge('g', 2, 4, '유사')];
  const base = R.routeAll(nodes, edges), again = R.routeAll(nodes, edges);
  for (const [k, v] of base) assert.deepEqual(again.get(k), v);
  const shuffled = R.routeAll(nodes.slice().reverse(), edges.slice().reverse());
  for (const [k, v] of base) assert.deepEqual(shuffled.get(k), v, k);
  assert.equal(base.size, 7);
  const bad = R.routeAll([node(1, 0, 0), node(2, 0, 0), { id: 3, x: NaN, y: Infinity }], [edge('x', 1, 2, ''), edge('y', 1, 3, 'abc'), edge('z', 2, 3, '가나다')]);
  for (const v of bad.values()) { assert.ok(!/NaN|Infinity/.test(v.d), v.d); assert.ok(Number.isFinite(v.mx) && Number.isFinite(v.my)); }
  assert.equal(R.routeAll([], []).size, 0); assert.equal(R.routeAll([node(1, 0, 0)], [edge('e', 1, 9)]).size, 0, '없는 노드의 연결은 건너뜀');
});

test('제3 노드를 가로지르면 접속면 후보 중 가로지름이 가장 적은 것을 고른다(기본 후보가 막히면 다른 면으로 돌아간다)', () => {
  const a = node(1, 0, 0), b = node(2, 0, 300), blocker = node(3, 0, 150);
  const r = R.routeAll([a, b, blocker], [edge('e', 1, 2)]).get('e');
  assert.ok(r.candidateHits[0] > 0, '기본(아래 → 위)은 가운데 노드를 지남');
  assert.equal(r.hits, 0, '선택된 경로는 노드를 지나지 않음');
  assert.notDeepEqual(r.sides, ['b', 't']);
  assert.equal(r.candidateHits[0] > 0 && Math.min(...r.candidateHits), 0);
  // 막히지 않으면 기본 후보 유지
  assert.deepEqual(R.routeAll([a, b], [edge('e', 1, 2)]).get('e').sides, ['b', 't']);
  // 모든 후보가 막힌 경우에도 가장 적은 후보를 고른다(예외 없음)
  const wall = [node(1, 200, 100), node(2, 200, 400), node(3, 200, 250), node(4, 20, 250), node(5, 380, 250), node(6, 20, 150), node(7, 380, 350), node(8, 20, 350), node(9, 380, 150)];
  const rr = R.routeAll(wall, [edge('w', 1, 2)]).get('w');
  assert.ok(rr.hits <= Math.min(...rr.candidateHits) + 1, `선택 ${rr.hits} / 후보 ${rr.candidateHits}`);
  assert.ok(Number.isFinite(rr.mx));
});

test('라벨: 두 라벨이나 노드와 겹치지 않는 자리를 곡선 위(t 0.3~0.7)에서 찾는다 — 겹칠 수밖에 없으면 가장 덜 겹치는 자리(최선 노력)', () => {
  // 같은 노드에서 같은 열의 두 대상으로 가는 두 선의 가운데가 가까워 라벨이 겹치기 쉬운 배치
  const nodes = [node(1, 0, 0), node(2, 260, 0), node(3, 260, 60)];
  const r = R.routeAll(nodes, [edge('a', 1, 2, '일부 항목'), edge('b', 1, 3, '종류 항목')]);
  const A = r.get('a'), B = r.get('b');
  assert.ok(A.t >= 0.3 && A.t <= 0.7 && B.t >= 0.3 && B.t <= 0.7);
  assert.ok(!overlap(A.labelBox, B.labelBox), '두 라벨 상자가 겹치지 않음');
  for (const n of nodes) { assert.ok(!overlap(A.labelBox, rect(n)) && !overlap(B.labelBox, rect(n)), '노드와 겹치지 않음 ' + n.id); }
  assert.equal(A.labelCost + B.labelCost, 0);
  // 라벨 상자는 곡선 위의 점 (mx, my) 기준: 글자는 (mx, my - 4) 에 가운데 맞춤
  assert.ok(A.labelBox.x0 < A.mx && A.labelBox.x1 > A.mx && A.labelBox.y1 > A.my - 4 - 1);
  // 불가능한 경우: 가까운 노드 사이에 라벨이 긴 연결이 몰림 → 예외 없이 t 후보 중 비용이 가장 낮은 자리, 그리고 기본(0.5)보다 나쁘지 않음
  const dense = [node(1, 0, 0), node(2, 150, 0), node(3, 0, 60), node(4, 150, 60)];
  const es = [edge('a', 1, 2, '열두글자짜리긴라벨입니다'), edge('b', 3, 4, '열두글자짜리긴라벨입니다'), edge('c', 1, 4, '열두글자짜리긴라벨입니다'), edge('d', 2, 3, '열두글자짜리긴라벨입니다')];
  const rd = R.routeAll(dense, es);
  for (const v of rd.values()) { assert.ok(Number.isFinite(v.labelCost) && v.labelCost >= 0 && v.t >= 0.3 && v.t <= 0.7); }
  assert.ok(R.labelWidth('열두글자짜리긴라벨입니다') > R.labelWidth('abc'), '한글은 더 넓게 본다');
});

test('경로 문자열 형식: M x,y C x,y x,y x,y 한 개(3차 베지어)이고 시작·끝이 노드 면 위에 있다', () => {
  const nodes = [node(1, 10, 20), node(2, 400, 220)];
  const r = R.routeAll(nodes, [edge('e', 1, 2, 'x')]).get('e');
  assert.match(r.d, /^M-?\d+(\.\d)?,-?\d+(\.\d)? C-?\d+(\.\d)?,-?\d+(\.\d)? -?\d+(\.\d)?,-?\d+(\.\d)? -?\d+(\.\d)?,-?\d+(\.\d)?$/);
  const p = ends(r.d);
  const onFace = (pt, n) => (Math.abs(pt.x - n.x) < 0.11 || Math.abs(pt.x - (n.x + W)) < 0.11 || Math.abs(pt.y - n.y) < 0.11 || Math.abs(pt.y - (n.y + H)) < 0.11) && pt.x >= n.x - 0.11 && pt.x <= n.x + W + 0.11 && pt.y >= n.y - 0.11 && pt.y <= n.y + H + 0.11;
  assert.ok(onFace(p.p0, nodes[0]) && onFace(p.p3, nodes[1]));
});
