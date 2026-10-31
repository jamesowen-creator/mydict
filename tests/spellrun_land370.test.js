// 작업370: 가로 캐릭터 위치·판정선·이웃 풍선 시간 간격(순수 로직). 세로 값은 그대로.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');

const C = L.CONFIG;
const NORMAL = L.airSeconds(C) + L.AIR_GAP_MARGIN;

test('370-1) 가로 값: RUNNER_X 149, GRAB_DX 36.75(풍선 반폭 21.75 + 그림 앞쪽 끝 15), 몸 중심(기준 x + faceDx×1.3)이 화면 폭의 약 16%. 세로는 72·0·간격 하한 없음', () => {
  const land = L.layoutFor('land', 800, 400), port = L.layoutFor('port', 360, 640);
  assert.equal(land.RUNNER_X, 149); assert.equal(land.GRAB_DX, 36.75); assert.equal(land.AIR_GAP, true);
  assert.equal(L.LAND_GRAB_DX, 21.75 + 15);
  assert.equal(port.RUNNER_X, 72); assert.equal(port.GRAB_DX, 0); assert.equal(port.AIR_GAP, false);
  assert.equal(L.LAYOUT.RUNNER_X, 72); assert.equal(L.LAYOUT.GRAB_DX, 0);
  for (const k of ['girl', 'boy']) {
    const cx = land.RUNNER_X + L.CHARS[k].faceDx * 1.3;
    assert.ok(Math.abs(cx / 800 - 0.16) < 0.01, `${k} 몸 중심 ${cx} = ${(cx / 800 * 100).toFixed(1)}%`);
  }
});

test('370-3) 공중 시간: 높이 22 초과 구간 = airWindow(GRAB_H).len, pace 옵션을 그대로 따름. 높은 칸은 2단 점프 공중 시간과 비교해 큰 쪽 + 0.08', () => {
  assert.ok(Math.abs(L.airSeconds(C) - L.airWindow(C, C.GRAB_H).len) < 1e-12);
  const g = L.airGapSeconds(C);
  assert.ok(Math.abs(g.normal - (L.airSeconds(C) + 0.08)) < 1e-12);
  assert.ok(g.high >= g.normal && Math.abs(g.high - (Math.max(L.airSeconds(C), L.doubleAirSeconds(C)) + 0.08)) < 1e-12);
  assert.ok(L.doubleAirSeconds(C) > L.airSeconds(C), '2단 점프가 공중에 더 오래 뜬다');
  const slow = L.buildConfig({ pace: 1 }), fast = L.buildConfig({ pace: 1.3 });
  assert.ok(L.airSeconds(slow) > L.airSeconds(fast), 'pace 가 낮으면 점프가 길다(하드코딩 아님)');
  assert.ok(Math.abs(L.airSeconds(fast) - fast.JUMP_TIME * Math.sqrt(1 - fast.GRAB_H / fast.JUMP_PEAK)) < 1e-9);
});

const widths = n => Array.from({ length: n }, () => 43.5);

test('370-3) 최저~최고 속도에서 남은 풍선과 다음 묶음, 묶음 안 이웃 간격이 항상 공중 시간 + 0.08초 이상(가로). 세로(airGap 없음)는 이전 식 그대로', () => {
  const ag = L.airGapSeconds(C);
  for (let v = C.SPEED_MIN; v <= C.SPEED_MAX + 1e-9; v += (C.SPEED_MAX - C.SPEED_MIN) / 12) {
    for (const high of [false, true]) {
      for (const leftHigh of [false, true]) {
        const need = v * ((high || leftHigh) ? ag.high : ag.normal);
        const base = { tileScale: 0.75, xc: 149, runnerX: 149, v, widths: widths(3), item: false, obstacle: null, firstHigh: high, viewW: 800, leftover: { x: 800 + 100, w: 43.5, high: leftHigh } };
        for (const kind of ['pack', 'word', 'recover']) {
          const r = L.streamPlace(C, kind, Object.assign({ airGap: ag }, base)).group;
          assert.ok(r.tiles[0].x - base.leftover.x >= need - 1e-6, `${kind} v=${v.toFixed(0)} high=${high}/${leftHigh}: 남은 풍선과 ${(r.tiles[0].x - base.leftover.x).toFixed(1)}px < ${need.toFixed(1)}px`);
          for (let i = 1; i < r.tiles.length; i++) assert.ok((r.tiles[i].x - r.tiles[i - 1].x) / v >= (high ? ag.high : ag.normal) - 1e-9, `묶음 안 간격 ${((r.tiles[i].x - r.tiles[i - 1].x) / v).toFixed(3)}초`);
        }
      }
    }
  }
  // 세로(airGap 없음): 간격 = v × gapSec, 남은 타일 최소 = 이전 식
  const v = C.SPEED_MAX, g0 = L.streamPlace(C, 'pack', { tileScale: 1, xc: 72, runnerX: 72, v, widths: widths(3), item: false, obstacle: null, firstHigh: false, viewW: 360, leftover: { x: 400, w: 58 } }).group;
  assert.ok(Math.abs((g0.tiles[1].x - g0.tiles[0].x) - v * L.gapSec(v, C)) < 1e-9);
  assert.ok(g0.tiles[0].x - 400 >= L.streamMinGap(58, 58, 0, 1) - 1e-6);
});

test('370-3) 최고 속도의 새 최소 간격(참고): 이전 67.5px 은 0.185초, 새 값은 ≥ 공중 시간 + 0.08초', () => {
  const v = C.SPEED_MAX;
  assert.ok(67.5 / v < L.airSeconds(C), '이전 값은 공중 시간보다 짧았다');
  assert.ok(NORMAL * v > 67.5);
});
