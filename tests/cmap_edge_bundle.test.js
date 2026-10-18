// 작업304-1: 같은 부모·같은 종류의 방향 있는 연결을 "곡선 다발"로 그리는 규칙(edgeRoute.js 의 routeAll, 순수 함수).
//   (302-1·303-1 의 직각 가지·막대·BAR_STEP 규칙은 폐기되어 이 파일이 새 규칙을 검증한다.) 실행: node --test tests/cmap_edge_bundle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/js/cmap/edgeRoute');

const W = R.W, H = R.H;
const E = (key, from, to, type, label) => ({ key, from, to, type, label: label === undefined ? type : label });
// 부모 1(위) 와 한 줄 아래 자식 2·3·4(부모 아래~자식 위 106px)
const N = [{ id: 1, x: 200, y: 0 }, { id: 2, x: 20, y: 150 }, { id: 3, x: 200, y: 150 }, { id: 4, x: 380, y: 150 }];
const SAME = [E(1, 1, 2, '종류'), E(2, 1, 3, '종류'), E(3, 1, 4, '종류')];
const nums = d => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
const isBundled = r => r.group !== null && /^M[-\d.]+,[-\d.]+ C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+$/.test(r.d) && r.fallback === false;
const bez = d => { const p = nums(d); return { p0: { x: p[0], y: p[1] }, p1: { x: p[2], y: p[3] }, p2: { x: p[4], y: p[5] }, p3: { x: p[6], y: p[7] } }; };
const at = (b, t) => { const u = 1 - t, a = u * u * u, c = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t; return { x: a * b.p0.x + c * b.p1.x + d * b.p2.x + e * b.p3.x, y: a * b.p0.y + c * b.p1.y + d * b.p2.y + e * b.p3.y }; };

test('다발: 같은 부모+종류 자식 3개는 한 다발 — 부모 아래 면의 서로 다른 가까운 점(STRAND_GAP 6px)에서 나란히 출발, 자식 x 순서대로, 곡선 한 개(M C)', () => {
  const out = R.routeAll(N, SAME);
  assert.ok([...out.values()].every(isBundled));
  assert.equal(new Set([...out.values()].map(r => r.group)).size, 1);
  const xs = [1, 2, 3].map(k => nums(out.get(k).d)[0]);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], '자식 x 순서대로 왼쪽부터: ' + xs);
  assert.equal(xs[1] - xs[0], R.STRAND_GAP); assert.equal(xs[2] - xs[1], R.STRAND_GAP);
  assert.equal((xs[0] + xs[2]) / 2, 266, '다발은 부모 아래 면 가운데(자리 중심)');
  for (const r of out.values()) { assert.equal(nums(r.d)[1], H, '부모 아래 가장자리에서 출발'); assert.deepEqual(r.sides, ['b', 't']); assert.equal(r.fallback, false); assert.equal(r.hits, 0); }
  assert.equal(R.STRAND_GAP, 6); assert.equal(R.BUNDLE_GAP, 16); assert.equal(R.MIN_STRAND_GAP, 3);
});

test('곡선 끝 접선이 아래 방향: 시작·끝 제어점이 같은 x 의 아래쪽(M C 한 개), 제어점 간격 = max(20, 0.5 × 세로 거리)', () => {
  const out = R.routeAll(N, SAME);
  for (const r of out.values()) {
    const b = bez(r.d);
    assert.equal(b.p1.x, b.p0.x); assert.ok(b.p1.y > b.p0.y, '시작 접선은 아래');
    assert.equal(b.p2.x, b.p3.x); assert.ok(b.p2.y < b.p3.y, '끝 접선도 아래(화살촉이 아래를 향함)');
    const c = Math.max(20, 0.5 * (b.p3.y - b.p0.y));
    assert.equal(Math.round((b.p1.y - b.p0.y) * 10) / 10, c); assert.equal(Math.round((b.p3.y - b.p2.y) * 10) / 10, c);
    assert.equal(b.p3.y, 150, '자식 위 가장자리에서 끝남');
  }
});

test('종류별 다발: 한 부모의 종류가 다르면 다발이 따로(group 다름), 자식 x 순서대로 왼쪽부터, 이웃한 종류가 다를 때만 BUNDLE_GAP(16px)', () => {
  const out = R.routeAll(N, [E(1, 1, 2, '종류'), E(2, 1, 3, '종류'), E(3, 1, 4, '일부')]);   // 종류 {2,3}(평균 x 110), 일부 {4}(x 380)
  assert.notEqual(out.get(1).group, out.get(3).group); assert.equal(out.get(1).group, out.get(2).group);
  const x = k => nums(out.get(k).d)[0];
  assert.equal(x(2) - x(1), R.STRAND_GAP); assert.equal(x(3) - x(2), R.BUNDLE_GAP, '다발 사이 간격');
  assert.ok([...out.values()].every(isBundled));
  // 305-1: 출발 순서는 자식 x 순서(다발 평균이 아님): 종류를 오른쪽 자식에, 일부를 왼쪽 자식에 주면 일부 다발이 왼쪽
  const sw = R.routeAll(N, [E(1, 1, 4, '종류'), E(2, 1, 3, '종류'), E(3, 1, 2, '일부')]);
  assert.ok(nums(sw.get(3).d)[0] < nums(sw.get(2).d)[0] && nums(sw.get(2).d)[0] < nums(sw.get(1).d)[0], '자식 x 순서로 놓임');
  // 같은 종류·다른 문구도 한 다발, 부모가 다르면 별도 다발
  const lab = R.routeAll(N, [E(1, 1, 2, '종류', '먼저'), E(2, 1, 3, '종류', '나중')]);
  assert.equal(lab.get(1).group, lab.get(2).group);
  const par = R.routeAll(N, [E(1, 1, 3, '종류'), E(2, 2, 3, '종류')]);
  assert.notEqual(par.get(1).group, par.get(2).group);
});

test('부모 폭 초과: STRAND_GAP 을 MIN_STRAND_GAP(3px)까지 줄이고, 그래도 넘치면 면 균등 분할로 되돌린다', () => {
  const kids = n => Array.from({ length: n }, (_, i) => ({ id: 10 + i, x: i * 150, y: 200 }));
  const edges = n => Array.from({ length: n }, (_, i) => E(i + 1, 1, 10 + i, '종류'));
  const parent = { id: 1, x: 2000, y: 0 };
  const avail = W - 24;
  // 20개: 19 간격 × 6 = 114 > 108 → 간격 108/19 ≈ 5.68(3 이상)로 줄어듦
  const o20 = R.routeAll([parent, ...kids(20)], edges(20));
  const x20 = [...o20.keys()].sort((a, b) => a - b).map(k => nums(o20.get(k).d)[0]);
  const gaps = x20.slice(1).map((v, i) => v - x20[i]);
  assert.ok(gaps.every(g => g >= R.MIN_STRAND_GAP - 0.2 && g < R.STRAND_GAP), '줄어든 간격: ' + gaps.slice(0, 3));
  assert.ok(x20[0] >= parent.x + 12 - 0.2 && x20[19] <= parent.x + W - 12 + 0.2, '부모 아래 면 안');
  // 40개: 39 간격 × 3 = 117 > 108 → 면 균등 분할(간격 = 108 / 41)
  const o40 = R.routeAll([parent, ...kids(40)], edges(40));
  const x40 = [...o40.keys()].sort((a, b) => a - b).map(k => nums(o40.get(k).d)[0]);
  const g40 = x40.slice(1).map((v, i) => v - x40[i]);
  assert.ok(g40.every(g => Math.abs(g - avail / 41) < 0.2), '균등 분할 간격: ' + g40.slice(0, 3));
  assert.ok([...o40.values()].every(r => r.group !== null && r.fallback === false), '균등 분할이어도 곡선 다발(폴백 아님)');
});

test('다발 안에서 선이 서로 교차하지 않는다(자식 x 순서 = 출발 x 순서)', () => {
  const nodes = [{ id: 1, x: 300, y: 0 }, ...[0, 1, 2, 3, 4].map(i => ({ id: 2 + i, x: i * 170, y: 160 + (i % 2) * 8 }))];
  const edges = [0, 1, 2, 3, 4].map(i => E(i + 1, 1, 2 + i, '종류'));
  const out = R.routeAll(nodes, edges), pts = k => Array.from({ length: 41 }, (_, i) => at(bez(out.get(k).d), i / 40));
  for (let a = 1; a <= 5; a++) for (let b = a + 1; b <= 5; b++) {
    const pa = pts(a), pb = pts(b);
    const dir = pa[0].x < pb[0].x ? 1 : -1;   // 출발이 왼쪽인 선은 끝까지 왼쪽(또는 같은 x)에 있어야 교차하지 않는다
    for (let i = 0; i < pa.length; i++) assert.ok(dir * (pa[i].x - pb[i].x) <= 1e-6, `선 ${a} 과 ${b} 가 교차: t=${i / 40}`);
  }
});

test('hitD: 곡선의 t=0.6 부터 끝까지의 부분 곡선(시작 부근 다발 구간은 클릭 영역 없음), 연결마다 하나', () => {
  const out = R.routeAll(N, SAME);
  assert.equal(R.HIT_FROM, 0.6);
  for (const r of out.values()) {
    const full = bez(r.d), h = bez(r.hitD), q = at(full, 0.6);
    assert.ok(Math.abs(h.p0.x - q.x) < 0.2 && Math.abs(h.p0.y - q.y) < 0.2, '시작은 원 곡선의 t=0.6 지점');
    assert.deepEqual(h.p3, full.p3, '끝은 자식 위');
    for (const t of [0.25, 0.5, 0.75]) { const a = at(h, t), b = at(full, 0.6 + 0.4 * t); assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.6, '부분 곡선이 원 곡선 위에 있음(t=' + t + ')'); }
    assert.ok(h.p0.y > full.p0.y + 40, '다발 구간(위쪽)은 포함하지 않음');
  }
});

test('라벨: 문구가 모두 같으면 다발에 한 번(bundle, key 가 가장 앞선 선만 noLabel false, 가운데 선의 t 0.15~0.45), 다르면 각 선 끝에 자기 문구(end, noLabel 모두 false)', () => {
  const same = R.routeAll(N, SAME);
  assert.deepEqual([...same.values()].map(r => [r.labelMode, r.noLabel]), [['bundle', false], ['bundle', true], ['bundle', true]]);
  const mid = bez(same.get(2).d), r1 = same.get(1);
  assert.ok(r1.t >= 0.15 && r1.t <= 0.45, 't 범위: ' + r1.t);
  const q = at(mid, r1.t); assert.ok(Math.abs(q.x - r1.mx) < 0.2 && Math.abs(q.y - r1.my) < 0.2, '라벨은 가운데 선 위');
  const diff = R.routeAll(N, [E(1, 1, 2, '종류', '가'), E(2, 1, 3, '종류', '나'), E(3, 1, 4, '종류', '다')]);
  for (const [k, r] of diff) {
    assert.equal(r.labelMode, 'end'); assert.equal(r.noLabel, false);
    assert.ok(r.t >= 0.8 && r.t <= 0.9, 't 범위: ' + r.t);
    const p = at(bez(r.d), r.t); assert.ok(Math.abs(p.x - r.mx) < 0.2 && Math.abs(p.y - r.my) < 0.2, '자기 선 위: ' + k);
    assert.ok(r.my > 100 && r.my < 150, '자식 위 쪽');
  }
});

test('라벨이 다발 중간에서 노드와 겹치면 선 끝 방식으로 되돌린다(문구가 같아도 end)', () => {
  const nodes = [{ id: 1, x: 200, y: 0 }, { id: 2, x: 200, y: 150 }, { id: 9, x: 300, y: 50 }];   // 곡선(x≈266)은 비켜 가지만 긴 라벨 상자가 걸치는 노드
  const out = R.routeAll(nodes, [E(1, 1, 2, '종류', '여섯 글자 문구')]);
  const r = out.get(1);
  assert.equal(r.labelMode, 'end', '다발 중간 자리가 모두 겹쳐 선 끝으로'); assert.equal(r.noLabel, false); assert.equal(r.fallback, false);
  const roomy = R.routeAll([nodes[0], nodes[1]], [E(1, 1, 2, '종류', '여섯 글자 문구')]).get(1);
  assert.equal(roomy.labelMode, 'bundle', '여유가 있으면 다발 중간');
});

test('선 단위 폴백과 반복 재배정: 다른 노드를 지나는 선만 기존 곡선(fallback true), 나머지 다발은 남고 자리가 다시 계산된다', () => {
  const nodes = [...N, { id: 9, x: 380, y: 60 }];   // 자식 4 로 가는 선의 끝 구간을 가로막는 노드
  const out = R.routeAll(nodes, [E(1, 1, 2, '종류'), E(2, 1, 4, '종류')]);
  const a = out.get(1), b = out.get(2);
  assert.equal(b.fallback, true); assert.equal(b.group, null); assert.match(b.d, /C/); assert.equal(b.hitD, null);
  assert.equal(a.fallback, false); assert.notEqual(a.group, null);
  assert.equal(nums(a.d)[0], 266, '폴백 선을 뺀 뒤 다발 하나만 남아 부모 면 가운데로 다시 배정됨(처음엔 263)');
  const before = R.routeAll(N, [E(1, 1, 2, '종류'), E(2, 1, 4, '종류')]);
  assert.equal(nums(before.get(1).d)[0], 263, '막는 노드가 없으면 두 선이 나란히(263, 269)');
  assert.equal([...out.values()].filter(r => r.fallback).length, 1, '폴백 개수를 셀 수 있다');
});

test('폴백(ㄱ): 자식이 부모보다 위이거나 MIN_GAP 미만이면 그 선만 기존 곡선, 정확히 MIN_GAP 이면 다발', () => {
  const edges = [E(1, 1, 2, '종류'), E(2, 1, 3, '종류')];
  const up = R.routeAll([N[0], N[1], { id: 3, x: 200, y: -150 }], edges);
  assert.equal(up.get(1).fallback, false); assert.equal(up.get(2).fallback, true); assert.match(up.get(2).d, /C/);
  const near = R.routeAll([N[0], N[1], { id: 3, x: 200, y: H + R.MIN_GAP - 1 }], edges);
  assert.equal(near.get(2).fallback, true, 'MIN_GAP 미만');
  const edge = R.routeAll([N[0], { id: 2, x: 20, y: H + R.MIN_GAP }, { id: 3, x: 200, y: H + R.MIN_GAP }], edges);
  assert.ok([...edge.values()].every(isBundled), 'MIN_GAP 경계는 다발');
  assert.equal(R.MIN_GAP, 32);
});

test('방향 없는 유형(대립 등)과 type 필드가 없는 예전 호출은 다발이 아니고, 종류가 없는(null) 연결은 한 개짜리 다발로 같은 정렬에 참여한다(305-1)', () => {
  for (const type of ['구별', '유사', '대립', '연관', undefined]) {
    const out = R.routeAll(N, [E(1, 1, 2, type, '문구'), E(2, 1, 3, type, '문구')]);
    assert.ok([...out.values()].every(r => r.group === null && /C/.test(r.d) && r.fallback === false && r.hitD === null && r.noLabel === false), String(type));
  }
  for (const type of R.BUNDLE_TYPES) assert.ok([...R.routeAll(N, [E(1, 1, 2, type), E(2, 1, 3, type)]).values()].every(isBundled), type);
  assert.deepEqual(R.BUNDLE_TYPES, ['종류', '일부']);   // 308-1: 방향 있는 유형은 종류·일부뿐
  // 종류 없음(null): 방향 있는 연결(화살촉)이므로 같은 정렬에 참여하고, 종류가 같은(둘 다 null) 이웃끼리는 한 다발
  const nul = R.routeAll(N, [E(1, 1, 2, null, '문구'), E(2, 1, 3, null, '문구')]);
  assert.ok([...nul.values()].every(isBundled)); assert.equal(nul.get(1).group, nul.get(2).group);
  const mix = R.routeAll(N, [E(1, 1, 2, null, 'ㄱ'), E(2, 1, 3, '종류', 'ㄴ'), E(3, 1, 4, null, 'ㄷ')]);   // 자식 x 순서: null, 선행, null → 다발 3개
  assert.equal(new Set([...mix.values()].map(r => r.group)).size, 3);
  assert.ok(nums(mix.get(1).d)[0] < nums(mix.get(2).d)[0] && nums(mix.get(2).d)[0] < nums(mix.get(3).d)[0]);
});

test('자식 1개도 다발(선 하나짜리)이고, 같은 x 에 놓이면 곧게 내려오는 곡선(M C)이다', () => {
  const r = R.routeAll([{ id: 1, x: 200, y: 0 }, { id: 2, x: 200, y: 150 }], [E(1, 1, 2, '종류')]).get(1);
  assert.ok(isBundled(r)); assert.equal(r.d, 'M266,44 C266,97 266,97 266,150');
  assert.equal(r.labelMode, 'bundle');
});

test('결정성: 노드·연결 입력 순서를 바꿔도 연결마다 결과가 같고 여러 번 불러도 같다. NaN 없음', () => {
  const edges = [...SAME, E(4, 2, 3, '일부'), E(5, 1, 3, '일부')];
  const a = R.routeAll(N, edges), b = R.routeAll(N.slice().reverse(), edges.slice().reverse()), c = R.routeAll(N, edges);
  for (const k of a.keys()) for (const f of ['d', 'hitD', 'group', 'noLabel', 'labelMode', 'fallback', 'mx', 'my']) { assert.deepEqual(b.get(k)[f], a.get(k)[f], k + ' ' + f); assert.deepEqual(c.get(k)[f], a.get(k)[f]); }
  for (const r of a.values()) assert.ok(!/NaN|Infinity/.test(r.d + (r.hitD || '')));
});

test('부모 아래 면: 다발은 덩어리 1개로 세어 같은 면의 다른 연결(방향 없음 등)과 서로 다른 자리를 쓴다', () => {
  const nodes = [...N, { id: 5, x: 560, y: 150 }];
  const out = R.routeAll(nodes, [...SAME, E(4, 1, 5, '대립', '닮음')]);
  const strands = [1, 2, 3].map(k => nums(out.get(k).d)[0]);
  const other = nums(out.get(4).d)[0];
  assert.ok(!strands.includes(other), '겹치지 않음');
  assert.ok(other > 200 && other < 200 + W);
});

// ── 305-1: 부모 아래 출발 순서 = 자식 접속점 x 순서(교차 없음), 다발 = 그 순서에서 종류가 같은 연속 구간 ──
// 사용자 캡처 위치(저장된 위치): 주식 289, 회사채 493, 국공채(일부) 697, 조건환매부채권 901 — 종류가 일부를 사이에 두고 갈라져 있다
const CAP = [{ id: 1, x: 595, y: 0 }, { id: 3, x: 289, y: 96 }, { id: 4, x: 493, y: 96 }, { id: 5, x: 697, y: 96 }, { id: 6, x: 901, y: 96 }];
const CAP_E = [E(1, 1, 3, '종류'), E(2, 1, 4, '종류'), E(3, 1, 5, '일부'), E(4, 1, 6, '종류')];
const startX = (out, k) => nums(out.get(k).d)[0], endX = (out, k) => nums(out.get(k).d)[6];
const crossings = out => { let n = 0; const ks = [...out.keys()]; for (const a of ks) for (const b of ks) if (a < b && (startX(out, a) - startX(out, b)) * (endX(out, a) - endX(out, b)) < 0) n++; return n; };
const sampleCross = out => {   // 곡선을 촘촘히 샘플링해 실제로 서로 가로지르는지(왼쪽/오른쪽 순서가 뒤집히는 t 가 있는지) 확인
  const ks = [...out.keys()], P = k => Array.from({ length: 61 }, (_, i) => at(bez(out.get(k).d), i / 60));
  let n = 0; for (const a of ks) for (const b of ks) if (a < b) { const pa = P(a), pb = P(b), d0 = Math.sign(pa[0].x - pb[0].x) || 1; if (pa.some((p, i) => d0 * (p.x - pb[i].x) < -1e-6)) n++; }
  return n;
};

test('305-1 ①② 종류가 좌우로 끼는 저장 위치: 출발 x 순서 = 자식 x 순서(교차 없음), 다발이 3개(종류-일부-종류)로 나뉘고 라벨이 각각 한 번', () => {
  const out = R.routeAll(CAP, CAP_E);
  assert.equal(crossings(out), 0, '출발 순서와 도착 순서가 같아 교차 쌍이 없다');
  assert.equal(sampleCross(out), 0, '곡선 샘플에서도 교차 없음');
  const order = [1, 2, 3, 4];
  assert.ok(order.slice(1).every((k, i) => startX(out, k) > startX(out, order[i])), '왼쪽 자식은 왼쪽 자리: ' + order.map(k => startX(out, k)));
  const groups = [1, 2, 3, 4].map(k => out.get(k).group);
  assert.equal(groups[0], groups[1]); assert.notEqual(groups[1], groups[2]); assert.notEqual(groups[2], groups[3]); assert.notEqual(groups[0], groups[3], '같은 종류라도 연속이 끊기면 다른 다발');
  assert.equal(new Set(groups).size, 3);
  const labeled = [...out.values()].filter(r => !r.noLabel);
  assert.equal(labeled.length, 3, '다발마다 라벨 한 번(나뉜 다발도 각각 하나씩)');
  assert.deepEqual([...out.values()].map(r => r.labelMode), ['bundle', 'bundle', 'bundle', 'bundle']);
  assert.ok([...out.values()].every(r => r.fallback === false && /^M[-\d.]+,[-\d.]+ C/.test(r.d)));
});

test('305-1 회귀: 종류 3개를 한 다발로 먼저 놓던 옛 출발 순서(주식·회사채·조건환매·국공채)는 도착 순서와 어긋나 교차했고, 지금은 자식 순서와 일치한다', () => {
  const now = R.routeAll(CAP, CAP_E);
  const oldOrder = [1, 2, 4, 3];   // 304-1: 다발(평균 x 순) 단위 → 종류 3개 다음 일부
  assert.equal(oldOrder.slice(1).some((k, i) => endX(now, k) < endX(now, oldOrder[i])), true, '옛 순서에서는 도착 x 가 거꾸로인 이웃이 있어 교차');
  const seq = [...now.keys()].sort((a, b) => startX(now, a) - startX(now, b));
  assert.deepEqual(seq, [1, 2, 3, 4], '지금은 자식 순서와 일치');
});

test('305-1 ③ 같은 종류가 연속이면 다발 하나로 유지된다(자식 x 순서에서 끼는 종류가 없을 때)', () => {
  const out = R.routeAll(CAP, [E(1, 1, 3, '종류'), E(2, 1, 4, '종류'), E(3, 1, 6, '종류'), E(4, 1, 5, '일부')]);   // 순서: 종류, 종류, 일부(697), 종류(901)
  assert.equal(out.get(1).group, out.get(2).group);
  const none = R.routeAll(CAP, [E(1, 1, 3, '종류'), E(2, 1, 4, '종류'), E(3, 1, 5, '종류'), E(4, 1, 6, '종류')]);
  assert.equal(new Set([...none.values()].map(r => r.group)).size, 1, '모두 같은 종류면 한 다발');
  assert.deepEqual([...none.values()].map(r => r.noLabel), [false, true, true, true]);
  const grouped = R.routeAll(CAP, [E(1, 1, 3, '일부'), E(2, 1, 4, '종류'), E(3, 1, 5, '종류'), E(4, 1, 6, '종류')]);   // 일부, 종류 3개 연속
  assert.equal(new Set([...grouped.values()].map(r => r.group)).size, 2);
  assert.equal(crossings(grouped), 0);
});

test('305-1 ④ 이웃한 두 선의 종류가 같으면 STRAND_GAP, 다를 때만 BUNDLE_GAP', () => {
  const out = R.routeAll(CAP, CAP_E);
  const gaps = [1, 2, 3].map(k => startX(out, k + 1) - startX(out, k));
  assert.deepEqual(gaps, [R.STRAND_GAP, R.BUNDLE_GAP, R.BUNDLE_GAP], '종류-종류 6, 종류-일부 16, 일부-종류 16');
  const flat = R.routeAll(CAP, [E(1, 1, 3, '종류'), E(2, 1, 4, '종류'), E(3, 1, 5, '종류'), E(4, 1, 6, '종류')]);
  assert.ok([1, 2, 3].every(k => startX(flat, k + 1) - startX(flat, k) === R.STRAND_GAP));
});

test('305-1 ⑤ 폭 초과: 이웃 종류가 계속 바뀌어 108px 를 넘으면 균등 분할(곡선 다발 유지), 연속 구간이 길면 STRAND_GAP 만 줄인다(최소 3px)', () => {
  const parent = { id: 1, x: 3000, y: 0 }, kids = n => Array.from({ length: n }, (_, i) => ({ id: 10 + i, x: i * 150, y: 200 }));
  const alt = n => Array.from({ length: n }, (_, i) => E(i + 1, 1, 10 + i, i % 2 ? '일부' : '종류'));   // 종류가 계속 바뀜: 이웃 간격이 모두 BUNDLE_GAP
  const avail = W - 24;
  const o7 = R.routeAll([parent, ...kids(7)], alt(7)), x7 = [...o7.keys()].sort((a, b) => a - b).map(k => startX(o7, k));   // 6 × 16 = 96 ≤ 108 → 그대로
  assert.ok(x7.slice(1).every((v, i) => Math.abs(v - x7[i] - R.BUNDLE_GAP) < 0.01), '그대로: ' + x7.slice(1).map((v, i) => v - x7[i]));
  const o9 = R.routeAll([parent, ...kids(9)], alt(9)), x9 = [...o9.keys()].sort((a, b) => a - b).map(k => startX(o9, k));   // 8 × 16 = 128 > 108, 다발이 모두 1개짜리라 줄일 간격이 없음 → 균등 분할
  assert.ok(x9.slice(1).every((v, i) => Math.abs(v - x9[i] - avail / 10) < 0.01), '균등 분할: ' + x9.slice(1).map((v, i) => v - x9[i]));
  assert.ok([...o9.values()].every(r => r.group !== null && r.fallback === false));
  const two = Array.from({ length: 20 }, (_, i) => E(i + 1, 1, 10 + i, i < 10 ? '종류' : '일부'));
  const o20 = R.routeAll([parent, ...kids(20)], two), x20 = [...o20.keys()].sort((a, b) => a - b).map(k => startX(o20, k)), g = x20.slice(1).map((v, i) => v - x20[i]);
  assert.ok(g.every((v, i) => (i === 9 ? Math.abs(v - R.BUNDLE_GAP) < 0.01 : v >= R.MIN_STRAND_GAP - 0.01 && v < R.STRAND_GAP)), '줄어든 간격과 다발 사이: ' + g.map(v => Math.round(v * 10) / 10));
});

test('305-1 ⑥ 결정성: 노드·연결 입력 순서를 무작위로 섞어도(30회) 연결마다 결과가 같다', () => {
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const shuffle = a => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  const edges = [...CAP_E, E(5, 3, 4, '일부'), E(6, 1, 3, '일부', '다른')];
  const base = R.routeAll(CAP, edges);
  for (let n = 0; n < 30; n++) {
    const out = R.routeAll(shuffle(CAP), shuffle(edges));
    for (const k of base.keys()) for (const f of ['d', 'hitD', 'group', 'noLabel', 'labelMode', 'fallback', 'mx', 'my']) assert.deepEqual(out.get(k)[f], base.get(k)[f], `${n}회 ${k} ${f}`);
  }
});

test('305-1 ⑦ 폴백 선을 뺀 뒤에도 남은 선은 자식 x 순서를 유지하고 다시 배정된다(교차 없음)', () => {
  const nodes = [...CAP, { id: 9, x: 820, y: 52 }];   // 맨 오른쪽 자식(901)으로 가는 선의 곡선만 막는 노드 → 그 선(key 4)만 폴백
  const out = R.routeAll(nodes, CAP_E), before = R.routeAll(CAP, CAP_E);
  assert.deepEqual([...out].filter(([, r]) => r.fallback).map(([k]) => k), [4], '폴백은 그 선 하나');
  assert.match(out.get(4).d, /C/); assert.equal(out.get(4).group, null);
  const rest = [1, 2, 3];
  assert.ok(rest.every(k => out.get(k).fallback === false && out.get(k).group !== null));
  assert.ok(startX(out, 1) < startX(out, 2) && startX(out, 2) < startX(out, 3), '남은 선도 자식 x 순서');
  assert.equal(startX(out, 2) - startX(out, 1), R.STRAND_GAP); assert.equal(startX(out, 3) - startX(out, 2), R.BUNDLE_GAP, '종류 | 일부 사이 BUNDLE_GAP');
  assert.equal(out.get(1).group, out.get(2).group); assert.notEqual(out.get(2).group, out.get(3).group);
  assert.notEqual(startX(out, 1), startX(before, 1), '선이 하나 빠져 덩어리 폭이 줄어 출발 자리가 다시 계산됨');
  assert.equal(crossings(new Map(rest.map(k => [k, out.get(k)]))), 0);
});
