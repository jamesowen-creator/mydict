// 작업302-1: 같은 부모·같은 종류·같은 문구의 연결을 한 줄기 직각 가지로 묶는 규칙(edgeRoute.js 의 routeAll, 순수 함수).
// 실행: node --test tests/cmap_edge_bundle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/js/cmap/edgeRoute');

const W = R.W, H = R.H;
const E = (key, from, to, type, label) => ({ key, from, to, type, label: label === undefined ? type : label });
// 부모 1 이 위, 자식 2·3·4 가 한 줄 아래(세로 간격 150 → 부모 아래~자식 위 106px ≥ MIN_GAP)
const N = [{ id: 1, x: 200, y: 0 }, { id: 2, x: 20, y: 150 }, { id: 3, x: 200, y: 150 }, { id: 4, x: 380, y: 150 }];
const SAME = [E(1, 1, 2, '선행'), E(2, 1, 3, '선행'), E(3, 1, 4, '선행')];
const pts = d => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
const isBundled = r => r.group !== null && !/C/.test(r.d);

test('같은 부모+종류+문구 자식 3개 → 한 줄기: 모두 같은 group, 라벨은 key 가 가장 앞선 연결 1개만(noLabel), 갈래마다 hitD', () => {
  const out = R.routeAll(N, SAME);
  assert.equal(new Set([...out.values()].map(r => r.group)).size, 1);
  assert.ok([...out.values()].every(isBundled));
  assert.deepEqual([...out.values()].map(r => r.noLabel), [false, true, true]);
  for (const [k, r] of out) {
    assert.ok(r.hitD && /^M[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+$/.test(r.hitD), '갈래 구간만의 직선 한 개: ' + r.hitD);
    const [x0, y0, x1, y1] = pts(r.hitD);
    assert.equal(x0, x1, '갈래는 세로'); assert.ok(y1 > y0);
    assert.equal(y1, N.find(n => n.id === SAME[k - 1].to).y, '갈래는 자식 위 가장자리에서 끝남');
  }
});

test('줄기 모양: 부모 아래 면 한 자리에서 시작 → 막대(부모 아래와 가장 가까운 자식 위의 중간) → 갈래 → 자식 위, 마지막 구간은 아래 방향(화살촉이 아래를 향함)', () => {
  const out = R.routeAll(N, SAME);
  const starts = new Set();
  for (const [k, r] of out) {
    const p = pts(r.d), child = N.find(n => n.id === SAME[k - 1].to);
    starts.add(p[0] + ',' + p[1]);
    assert.equal(p[1], H, '줄기는 부모 아래 가장자리(y=44)에서 시작');
    assert.ok(p[0] > 200 && p[0] < 200 + W, '부모 아래 면 안');
    const barY = (H + 150) / 2;
    assert.ok(p.includes(barY), '막대 높이 = (44 + 150) / 2 = 97');
    assert.equal(p[p.length - 1], child.y, '자식 위 가장자리에서 끝남');
    assert.ok(p[p.length - 1] > p[p.length - 3], '마지막 구간이 아래 방향');
    assert.equal(p[p.length - 2], p[p.length - 4], '마지막 구간은 세로');
    assert.ok(child.x < p[p.length - 2] && p[p.length - 2] < child.x + W, '갈래는 자식 위 면 안');
    assert.ok(!/NaN|Infinity/.test(r.d));
  }
  assert.equal(starts.size, 1, '묶음은 부모 면의 접속점 한 자리');
  const mid = pts(out.get(2).d);   // 가운데 자식은 줄기와 같은 x → 가로 구간이 없어 길이 0 구간 생략
  assert.equal(mid.length, 6, 'M L L 세 점');
});

test('자식 1개이거나 종류·문구가 다르면 묶이지 않고 지금 방식(곡선 한 개, group null)이다', () => {
  const one = R.routeAll(N, [E(1, 1, 2, '선행')]).get(1);
  assert.equal(one.group, null); assert.match(one.d, /^M[-\d.]+,[-\d.]+ C/); assert.equal(one.noLabel, false); assert.equal(one.hitD, null);
  const type = R.routeAll(N, [E(1, 1, 2, '선행'), E(2, 1, 3, '조건')]);
  assert.ok([...type.values()].every(r => r.group === null && /C/.test(r.d)), '종류가 다르면 별도');
  const label = R.routeAll(N, [E(1, 1, 2, '선행', '먼저'), E(2, 1, 3, '선행', '나중'), E(3, 1, 4, '선행', '먼저')]);
  assert.equal(label.get(2).group, null, '문구가 다른 연결은 묶이지 않음');
  assert.equal(label.get(1).group, label.get(3).group); assert.notEqual(label.get(1).group, null, '같은 문구 둘은 묶임');
  const parent = R.routeAll(N, [E(1, 1, 3, '선행'), E(2, 2, 3, '선행')]);
  assert.ok([...parent.values()].every(r => r.group === null), '부모가 다르면 묶이지 않음(수렴은 이번에 하지 않음)');
});

test('방향 없는 4종(구별·유사·대립·연관)과 종류 없음은 묶이지 않는다', () => {
  for (const type of ['구별', '유사', '대립', '연관', null, undefined]) {
    const out = R.routeAll(N, [E(1, 1, 2, type, '문구'), E(2, 1, 3, type, '문구')]);
    assert.ok([...out.values()].every(r => r.group === null && /C/.test(r.d)), String(type));
  }
  for (const type of R.BUNDLE_TYPES) assert.ok([...R.routeAll(N, [E(1, 1, 2, type), E(2, 1, 3, type)]).values()].every(isBundled), type);
  assert.deepEqual(R.BUNDLE_TYPES, ['사용', '일부', '종류', '일으킴', '선행', '조건']);
});

test('폴백: 자식이 부모보다 위·MIN_GAP 미만이면 묶음 전체가 곡선, 줄기가 다른 노드를 지나도 묶음 전체가 곡선', () => {
  const allCurve = out => [...out.values()].every(r => r.group === null && /C/.test(r.d) && r.noLabel === false && r.hitD === null);
  // 자식 하나가 부모보다 위
  assert.ok(allCurve(R.routeAll([N[0], N[1], N[2], { id: 4, x: 380, y: -150 }], SAME)), '위쪽 자식');
  // MIN_GAP 미만: 자식 위 가장자리가 부모 아래(44)보다 MIN_GAP-1 만큼만 아래
  assert.ok(allCurve(R.routeAll([N[0], N[1], N[2], { id: 4, x: 380, y: H + R.MIN_GAP - 1 }], SAME)), 'MIN_GAP 미만');
  // 정확히 MIN_GAP 이면 묶인다(경계)
  assert.ok([...R.routeAll([N[0], { id: 2, x: 20, y: H + R.MIN_GAP }, { id: 3, x: 200, y: H + R.MIN_GAP }, { id: 4, x: 380, y: H + R.MIN_GAP }], SAME).values()].every(isBundled), 'MIN_GAP 경계는 묶임');
  // 줄기(부모 아래 중앙)가 막대 높이까지 지나는 자리에 다른 노드
  const blocker = { id: 9, x: 200, y: 60 };   // 줄기 x≈266, y 44~97 구간에 걸침
  assert.ok(allCurve(R.routeAll([...N, blocker], SAME)), '줄기가 다른 노드를 지남');
  // 갈래가 자식 말고 다른 노드를 지남: 가운데 자식(x=200)의 갈래 위를 막는 노드
  const blocker2 = { id: 9, x: 160, y: 98 };
  assert.ok(allCurve(R.routeAll([...N, blocker2], SAME)), '갈래가 다른 노드를 지남');
  // 막대가 다른 노드를 지남
  assert.ok(allCurve(R.routeAll([...N, { id: 9, x: 20, y: 70 }], SAME)), '막대가 다른 노드를 지남');
  // 묶음에 속한 자식끼리는 방해로 보지 않는다
  assert.ok([...R.routeAll(N, SAME).values()].every(isBundled));
});

test('폴백은 묶음 단위: 한 묶음이 곡선이어도 다른 묶음은 줄기로 남고, 묶이지 않은 연결은 지금 방식', () => {
  const nodes = [...N, { id: 5, x: 600, y: 0 }, { id: 6, x: 520, y: 150 }, { id: 7, x: 680, y: 150 }, { id: 8, x: 40, y: 20 }];
  const out = R.routeAll(nodes, [...SAME, E(4, 5, 6, '조건'), E(5, 5, 7, '조건'), E(6, 8, 2, '일부')]);
  assert.ok(isBundled(out.get(4)) && isBundled(out.get(5)));
  assert.notEqual(out.get(4).group, out.get(1).group);
  assert.equal(out.get(6).group, null); assert.match(out.get(6).d, /C/);
});

test('결정성: 노드·연결 입력 순서를 바꿔도 연결마다 결과가 같고 여러 번 불러도 같다', () => {
  const edges = [...SAME, E(4, 2, 3, '조건')];
  const a = R.routeAll(N, edges), b = R.routeAll(N.slice().reverse(), edges.slice().reverse()), c = R.routeAll(N, edges);
  for (const k of a.keys()) {
    for (const f of ['d', 'hitD', 'group', 'noLabel', 'mx', 'my']) { assert.deepEqual(b.get(k)[f], a.get(k)[f], k + ' ' + f); assert.deepEqual(c.get(k)[f], a.get(k)[f]); }
  }
});

test('부모 아래 면의 접속점: 묶음은 1자리로 세고, 묶이지 않은 다른 연결은 기존 균등 분할을 따라 서로 다른 자리를 쓴다', () => {
  const nodes = [...N, { id: 5, x: 560, y: 150 }];
  const out = R.routeAll(nodes, [...SAME, E(4, 1, 5, '사용', '쓴다')]);
  const trunkX = pts(out.get(1).d)[0], otherStart = pts(out.get(4).d)[0];
  assert.notEqual(trunkX, otherStart, '묶음 줄기와 다른 연결의 시작점이 겹치지 않음');
  const x = [trunkX, otherStart].sort((p, q) => p - q);
  assert.ok(x[0] > 200 && x[1] < 200 + W, '둘 다 부모 아래 면 안');
  assert.equal(out.get(4).sides[0], 'b');
});

test('라벨: 줄기에 한 번만, 줄기 세로 구간 중간을 먼저 시도하고 노드와 겹치지 않는 자리(막대 위 등)를 찾는다', () => {
  const out = R.routeAll(N, SAME);
  const r = out.get(1), p = pts(r.d);
  assert.equal(r.mx, p[0], '라벨은 줄기 위(세로 구간 중간)'); assert.equal(r.my, (H + 97) / 2);
  const box = r.labelBox;
  // 부모(0..44)와 막대 아래의 자식(150~)을 피한 자리여야 한다: 줄기 중간은 부모 아래 가장자리에 걸치므로 다른 자리를 찾는다
  assert.ok(box.y0 >= H - 2 - 0.0001 || r.labelCost === 0, '노드와 겹치지 않음: ' + JSON.stringify(box));
  assert.equal(out.get(2).labelBox.x1 - out.get(2).labelBox.x0, 0, '라벨 없는 갈래의 상자는 점');
});
