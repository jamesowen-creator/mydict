// 작업302-1·303-1: 같은 부모·같은 종류·같은 문구의 연결을 한 줄기 직각 가지로 묶는 규칙(edgeRoute.js 의 routeAll, 순수 함수).
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
    assert.ok(p.length === 4 || p.includes(barY), '막대 높이 = (44 + 150) / 2 = 97 (줄기와 같은 x 의 갈래는 곧은 세로선이라 꺾임 없음)');
    assert.equal(p[p.length - 1], child.y, '자식 위 가장자리에서 끝남');
    assert.ok(p[p.length - 1] > p[p.length - 3], '마지막 구간이 아래 방향');
    assert.equal(p[p.length - 2], p[p.length - 4], '마지막 구간은 세로');
    assert.ok(child.x < p[p.length - 2] && p[p.length - 2] < child.x + W, '갈래는 자식 위 면 안');
    assert.ok(!/NaN|Infinity/.test(r.d));
  }
  assert.equal(starts.size, 1, '묶음은 부모 면의 접속점 한 자리');
  const mid = pts(out.get(2).d);   // 가운데 자식은 줄기와 같은 x → 가로 구간이 없어 곧은 세로선(M L 두 점)
  assert.equal(mid.length, 4, 'M L 두 점');
});

test('303-1 묶음 키 = 부모 + 종류: 문구가 달라도 같은 종류면 한 묶음, 종류가 다르면 별도 줄기, 부모가 다르면 별도(수렴은 부모 쪽 묶음만)', () => {
  const label = R.routeAll(N, [E(1, 1, 2, '선행', '먼저'), E(2, 1, 3, '선행', '나중'), E(3, 1, 4, '선행', '먼저')]);
  assert.equal(new Set([...label.values()].map(r => r.group)).size, 1, '문구가 달라도 같은 종류면 한 묶음');
  assert.ok([...label.values()].every(isBundled));
  const type = R.routeAll(N, [E(1, 1, 2, '선행'), E(2, 1, 3, '조건'), E(3, 1, 4, '조건')]);
  assert.notEqual(type.get(1).group, type.get(2).group, '종류가 다르면 합치지 않음');
  assert.equal(type.get(2).group, type.get(3).group);
  assert.ok([...type.values()].every(isBundled), '종류별로 각자 직각 가지');
  const parent = R.routeAll(N, [E(1, 1, 3, '선행'), E(2, 2, 3, '선행')]);
  assert.equal(new Set([...parent.values()].map(r => r.group)).size, 2, '부모가 다르면 별도 묶음');
});

test('자식 1개도 직각 가지: 줄기 x 와 갈래 x 가 같으면 곧은 세로선(M L), 엇갈리면 줄기-막대-갈래(M L L L), 곡선 아님', () => {
  const straight = R.routeAll([{ id: 1, x: 200, y: 0 }, { id: 2, x: 200, y: 150 }], [E(1, 1, 2, '선행')]).get(1);
  assert.equal(straight.group, '1|선행'); assert.equal(straight.fallback, false); assert.equal(straight.noLabel, false);
  assert.equal(straight.d, 'M266,44 L266,150', '곧은 세로선(길이 0 구간 생략)');
  assert.equal(straight.hitD, 'M266,97 L266,150');
  const offset = R.routeAll([{ id: 1, x: 200, y: 0 }, { id: 2, x: 20, y: 150 }], [E(1, 1, 2, '선행')]).get(1);
  assert.equal(offset.d, 'M266,44 L266,97 L86,97 L86,150', '엇갈리면 막대가 꺾임');
  assert.ok(!/C/.test(offset.d) && pts(offset.d)[pts(offset.d).length - 1] > pts(offset.d)[pts(offset.d).length - 3], '마지막 구간 아래 방향');
});

test('종류별 줄기: 한 부모의 두 묶음은 부모 아래 면의 다른 접속점을 쓰고 막대 높이가 계단식(자식 위와 부모 아래 사이를 (n+1)등분, 평균 x 작은 묶음이 위)이다', () => {
  const edges = [E(1, 1, 2, '종류'), E(2, 1, 3, '종류'), E(3, 1, 4, '일부')];   // 종류 {2,3}(평균 x 110), 일부 {4}(x 380)
  const out = R.routeAll(N, edges);
  const g1 = out.get(1), g3 = out.get(3);
  assert.notEqual(g1.group, g3.group);
  assert.notEqual(pts(g1.d)[0], pts(g3.d)[0], '부모 면 접속점이 다름');
  assert.ok(pts(g1.d)[0] < pts(g3.d)[0], '평균 x 가 작은 묶음의 접속점이 왼쪽');
  const barOf = r => pts(r.d)[3];
  const gap = (150 - H) / 3, r1 = v => Math.round(v * 10) / 10;
  assert.equal(barOf(g1), r1(H + gap), '첫 막대 = 부모 아래 + 간격'); assert.equal(barOf(g3), r1(H + 2 * gap), '둘째 막대는 더 아래');
  assert.ok(barOf(g3) - barOf(g1) >= R.BAR_STEP && barOf(g1) - H >= R.BAR_STEP);
  assert.ok([...out.values()].every(r => r.fallback === false));
  // 막대가 같은 높이에서 겹치지 않는다(묶음 3개도 서로 다른 높이)
  const three = R.routeAll(N, [E(1, 1, 2, '종류'), E(2, 1, 3, '일부'), E(3, 1, 4, '사용')]);
  assert.equal(new Set([...three.values()].map(barOf)).size, 3);
});

test('BAR_STEP 부족: 막대 사이 간격이 8px 미만이 되면 뒤쪽(평균 x 큰) 묶음부터 곡선으로 돌아가고 fallback 으로 셀 수 있다', () => {
  const nodes = [{ id: 1, x: 200, y: 0 }, { id: 2, x: 20, y: H + R.MIN_GAP }, { id: 3, x: 200, y: H + R.MIN_GAP }, { id: 4, x: 380, y: H + R.MIN_GAP }, { id: 5, x: 560, y: H + R.MIN_GAP }];
  // 위 여백 = 32: 묶음 3개면 32/4 = 8 → 가능, 4개면 32/5 = 6.4 → 불가(마지막 묶음이 곡선)
  const three = R.routeAll(nodes, [E(1, 1, 2, '종류'), E(2, 1, 3, '일부'), E(3, 1, 4, '사용')]);
  assert.ok([...three.values()].every(r => r.group && !r.fallback), '3개: 간격 8 로 가능');
  const four = R.routeAll(nodes, [E(1, 1, 2, '종류'), E(2, 1, 3, '일부'), E(3, 1, 4, '사용'), E(4, 1, 5, '조건')]);
  const fb = [...four.entries()].filter(([, r]) => r.fallback).map(([k]) => k);
  assert.deepEqual(fb, [4], '평균 x 가 가장 큰 묶음(조건)만 곡선');
  assert.match(four.get(4).d, /C/); assert.equal(four.get(4).group, null);
  assert.ok([1, 2, 3].every(k => four.get(k).group && !four.get(k).fallback));
  assert.ok([...four.values()].filter(r => r.group).map(r => pts(r.d)[3]).every((y, i, a) => a.indexOf(y) === i), '남은 막대는 서로 다른 높이');
});

test('라벨: 묶음 안 문구가 모두 같으면 줄기에 한 번(trunk), 다르면 갈래마다 자기 문구를 갈래 x 의 막대~자식 위 사이에 단다(branch, noLabel 모두 false)', () => {
  const same = R.routeAll(N, SAME);
  assert.deepEqual([...same.values()].map(r => [r.labelMode, r.noLabel]), [['trunk', false], ['trunk', true], ['trunk', true]]);
  const diff = R.routeAll(N, [E(1, 1, 2, '선행', '가'), E(2, 1, 3, '선행', '나'), E(3, 1, 4, '선행', '다')]);
  for (const [k, r] of diff) {
    assert.equal(r.labelMode, 'branch'); assert.equal(r.noLabel, false);
    const child = N.find(n => n.id === k + 1), bx = pts(r.d)[pts(r.d).length - 2];
    assert.equal(r.mx, bx, '라벨은 자기 갈래 x'); assert.ok(r.my > (H + 150) / 2 && r.my < child.y, '막대와 자식 위 사이: ' + r.my);
  }
});

test('줄기가 짧아 라벨이 들어갈 곳이 없으면 갈래마다 다는 방식으로 되돌린다(문구가 같아도 branch), 노드 쪽 갈래에도 겹치지 않는 자리를 찾는다', () => {
  // 부모 아래~자식 위 여백 = MIN_GAP(32): 단일 묶음의 줄기 세로 구간은 16px 라 라벨(15px)이 부모 가장자리에 걸친다
  const tight = [{ id: 1, x: 200, y: 0 }, { id: 2, x: 20, y: H + R.MIN_GAP }, { id: 3, x: 380, y: H + R.MIN_GAP }];
  const r = R.routeAll(tight, [E(1, 1, 2, '선행', '아주 긴 라벨 문구예요'), E(2, 1, 3, '선행', '아주 긴 라벨 문구예요')]);
  assert.ok([...r.values()].every(x => x.group && x.labelMode === 'branch' && x.noLabel === false), JSON.stringify([...r.values()].map(x => x.labelMode)));
  const roomy = R.routeAll(N, SAME);
  assert.equal(roomy.get(1).labelMode, 'trunk', '여유가 있으면 줄기에 한 번');
});

test('폴백은 연결 단위(묶음 단위): 한 묶음이 곡선이어도 다른 묶음은 줄기로 남고, 방향 없는 연결은 fallback 이 아니라 원래 곡선이다', () => {
  const nodes = [...N, { id: 5, x: 600, y: 0 }, { id: 6, x: 520, y: 150 }, { id: 7, x: 680, y: 150 }, { id: 8, x: 40, y: 20 }];
  const out = R.routeAll(nodes, [...SAME, E(4, 5, 6, '조건'), E(5, 5, 7, '조건'), E(6, 2, 3, '일부'), E(7, 3, 4, '유사')]);
  assert.ok(isBundled(out.get(4)) && isBundled(out.get(5)));
  assert.notEqual(out.get(4).group, out.get(1).group);
  assert.equal(out.get(6).group, null); assert.match(out.get(6).d, /C/); assert.equal(out.get(6).fallback, true, '자식이 부모와 같은 줄(옆): ㄱ 조건 위반 = 폴백');
  assert.equal(out.get(7).group, null); assert.equal(out.get(7).fallback, false, '방향 없는 연결은 대상이 아님');
  const count = [...out.values()].filter(r => r.fallback).length;
  assert.equal(count, 1, '폴백 개수를 셀 수 있다');
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
