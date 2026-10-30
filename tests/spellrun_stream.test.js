// 작업354: 타일 흐름(스트림) 순수 로직 시험(public/js/spellrun/logic.js). 브라우저 없음.
// 확인: 주소 옵션 stream, 묶음 배치가 classic 산식과 같음, edge 진입(모든 객체가 화면 밖에서 시작), 도착 시점이 classic 과 같음(늦춤이 없을 때),
//       남은 타일과 겹치지 않음(높은 칸 첫 타일은 묶음 안 간격), 장애물 점프 전에 남은 타일이 지나감, 틀린 뒤 맞는 글자가 들어오는 시간, 지금 풀 칸 판정·흐림
// 실행: node --test tests/spellrun_stream.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');
const { CONFIG: C, STREAM } = L;
const R = 72;   // 러너 위치
const SPEEDS = [C.SPEED_MIN, (C.SPEED_MIN + C.SPEED_MAX) / 2, C.SPEED_MAX];
const WIDTHS = [360, 640, 740, 800];
const tiles = (n, w) => Array.from({ length: n }, () => w);

test('stream 옵션: 기본 classic(꺼짐), stream=edge/classic/1/0 을 받고 범위 밖은 무시', () => {
  assert.equal(C.STREAM_EDGE, false);
  assert.deepEqual(L.parseOptions('?stream=edge'), { values: { stream: 1 }, applied: ['stream'] });
  assert.deepEqual(L.parseOptions('?stream=classic'), { values: { stream: 0 }, applied: [] });
  assert.deepEqual(L.parseOptions('?stream=1').values, { stream: 1 });
  assert.deepEqual(L.parseOptions('?stream=2').values, {}); assert.deepEqual(L.parseOptions('?stream=abc').values, {});
  assert.equal(L.buildConfig({ stream: 1 }).STREAM_EDGE, true); assert.equal(L.buildConfig({}).STREAM_EDGE, false);
  assert.deepEqual(L.resolveOptions('?stream=edge', null).save, { stream: 1 }, '저장된다');
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ stream: 1 })).applied, ['stream'], '저장값도 조정값으로 센다');
});

// classic 의 spawnPack 산식(작업352 코드)을 그대로 옮긴 기준: 러너 위치 R0 에서
function classicLayout(v, n, w, item, obstacle, R0) {
  const gap = v * L.gapSec(v); let x0 = R0 + v * L.leadSec(v); let itemX = null, ob = null;
  if (item) { itemX = x0; x0 += gap; }
  if (obstacle) { const lay = L.obstacleLayout(C, obstacle); x0 = Math.max(x0, R0 + lay.D1); ob = x0 - lay.post - lay.w; }
  return { itemX, ob, tiles: Array.from({ length: n }, (_, i) => x0 + i * gap) };
}
test('layoutGroup 은 classic 산식과 같다(아이템·장애물·후보 수 3/4, 여러 속도)', () => {
  for (const v of SPEEDS) for (const item of [false, true]) for (const obstacle of [null, 'box', 'pit']) for (const n of [3, 4]) {
    const g = L.layoutGroup(C, { R0: R, v, widths: tiles(n, 58), item, obstacle });
    const ref = classicLayout(v, n, 58, item, obstacle, R);
    assert.equal(g.itemX, ref.itemX); assert.equal(g.obstacle ? g.obstacle.x : null, ref.ob);
    assert.deepEqual(g.tiles.map(t => t.x), ref.tiles);
  }
});

test('edge 진입: 모든 객체(아이템·장애물·첫 타일)가 화면 밖에서 시작한다(폭 360·640·740·800, 속도 3종, 조각 타일 폭 124 포함)', () => {
  for (const viewW of WIDTHS) for (const v of SPEEDS) for (const item of [false, true]) for (const obstacle of [null, 'box', 'pit']) for (const w of [58, 124]) for (const kind of ['start', 'recover', 'pack', 'word']) {
    const r = L.streamPlace(C, kind, { xc: R + 100, runnerX: R, v, bossNext: false, first: kind === 'start', viewW, widths: tiles(3, w), item, obstacle, leftover: null });
    const gl = L.groupLeft(r.group);
    assert.ok(gl.left >= viewW - 1e-9, `${kind} W${viewW} v${Math.round(v)} item=${item} ob=${obstacle} w=${w}: 왼쪽 끝 ${gl.left.toFixed(1)} >= ${viewW}`);
    for (const t of r.group.tiles) assert.ok(t.x - t.w / 2 >= viewW - 1e-9);
    assert.ok(r.dx >= 0);
  }
});

test('도착 시점: 늦춤이 없으면 classic 과 같다(앞 묶음 정답 위치 기준 PACK_DELAY + 리드, 새 단어는 팝업 + 시작 대기 + 리드)', () => {
  for (const v of SPEEDS) {
    const xc = 2000;   // 정답 타일이 아주 멀리 있어 화면 안 생성·겹침 보정이 없다
    const p = L.streamPlace(C, 'pack', { xc, runnerX: R, v, viewW: 800, widths: tiles(3, 58), item: false, obstacle: null, leftover: null });
    assert.equal(p.dx, 0);
    assert.ok(Math.abs((p.group.tiles[0].x - xc) / v - (C.PACK_DELAY + L.leadSec(v))) < 1e-9, '묶음: 정답을 먹은 뒤 PACK_DELAY + 리드');
    for (const boss of [false, true]) {
      const w = L.streamPlace(C, 'word', { xc, runnerX: R, v, bossNext: boss, viewW: 800, widths: tiles(3, 58), item: false, obstacle: null, leftover: null });
      assert.equal(w.dx, 0);
      assert.ok(Math.abs((w.group.tiles[0].x - xc) / v - (C.POP_SEC + (boss ? C.BOSS_INTRO_SEC : 0) + C.WORD_START_DELAY + L.leadSec(v))) < 1e-9, '새 단어' + (boss ? '(보스)' : ''));
    }
    const s = L.streamPlace(C, 'start', { runnerX: R, v, first: true, viewW: 360, widths: tiles(3, 58), item: false, obstacle: null, leftover: null });
    assert.ok(Math.abs((s.group0.tiles[0].x - R) / v - (C.WORD_START_DELAY + C.FIRST_WORD_EXTRA + L.leadSec(v))) < 1e-9, '첫 단어 시작');
  }
});

// 앞 묶음(정답 위치 xc, 타일 3개: 정답이 첫째/둘째/셋째) 뒤에 다음 묶음을 놓았을 때의 늦춤(초)
function delaySec(v, correctIdx, opts) {
  opts = opts || {};
  const gap = v * L.gapSec(v), xc = 400;                // 정답 위치는 화면 안 어디든 같다(상대 거리만 쓴다)
  const leftover = { x: xc + (2 - correctIdx) * gap, w: 58 };
  const none = correctIdx === 2;
  const r = L.streamPlace(C, 'pack', { xc, runnerX: R, v, viewW: 0, widths: tiles(3, 58), item: false, obstacle: opts.obstacle || null, firstHigh: !!opts.high, leftover: none ? null : leftover });
  return { sec: r.dx / v, px: r.dx, r };
}
test('남은 타일과 겹치지 않는다: 다음 묶음 첫 객체가 남은 타일에서 최소 간격 이상(높은 칸 첫 타일은 묶음 안 간격 이상)', () => {
  for (const v of SPEEDS) for (const ci of [0, 1]) for (const high of [false, true]) {
    const gap = v * L.gapSec(v), xc = 400, lx = xc + (2 - ci) * gap;
    const r = L.streamPlace(C, 'pack', { xc, runnerX: R, v, viewW: 0, widths: tiles(3, 58), item: false, obstacle: null, firstHigh: high, leftover: { x: lx, w: 58 } });
    const d = r.group.tiles[0].x - lx;
    assert.ok(d >= L.streamMinGap(58, 58) - 1e-9, `간격 ${d.toFixed(1)} >= ${L.streamMinGap(58, 58)}`);
    if (high) assert.ok(d >= gap - 1e-9, '높은 칸 첫 타일: 묶음 안 간격 이상(점프가 일찍 시작되므로)');
  }
});
test('늦춤: 정답이 셋째면 없고, 첫째·둘째일 때만 생긴다(값은 시험에서 상한으로 고정)', () => {
  for (const v of SPEEDS) {
    assert.equal(delaySec(v, 2).px, 0, '정답이 마지막 타일이면 남은 타일이 없어 늦춤 없음');
    const d0 = delaySec(v, 0), d1 = delaySec(v, 1), d0h = delaySec(v, 0, { high: true });
    assert.ok(d0.sec >= d1.sec - 1e-9 && d1.sec >= 0);
    assert.ok(d0.sec <= 1.0, `정답 첫째 늦춤 ${d0.sec.toFixed(2)}s <= 1.0s (속도 ${Math.round(v)})`);
    assert.ok(d0h.sec <= 1.3, `높은 칸 첫 타일, 정답 첫째 ${d0h.sec.toFixed(2)}s <= 1.3s`);
  }
});

test('장애물이 있는 묶음: 남은 타일이 장애물 점프 시작 구간(lo)보다 먼저 러너를 지나간다', () => {
  for (const v of SPEEDS) for (const kind of ['box', 'pit']) for (const ci of [0, 1]) {
    const gap = v * L.gapSec(v), xc = 400, lx = xc + (2 - ci) * gap;
    const r = L.streamPlace(C, 'pack', { xc, runnerX: R, v, viewW: 0, widths: tiles(3, 58), item: false, obstacle: kind, leftover: { x: lx, w: 58 } });
    const g = r.group, P = g.x0 - g.lay.D1, lo = L.obstacleWindow(C, g.lay, v).lo;
    assert.ok((lx - P) / v <= lo + 1e-9, `남은 타일이 러너를 지나가는 시각 ${((lx - P) / v).toFixed(3)} <= lo ${lo.toFixed(3)}`);
    assert.ok(g.obstacle.x > lx, '장애물이 남은 타일보다 오른쪽');
    // 안전 간격(D1, Do, post)은 거리 기준 그대로: 장애물 앞뒤 거리와 여유 창이 classic 과 같다
    const lay = L.obstacleLayout(C, kind);
    assert.equal(g.x0 - g.obstacle.x - g.obstacle.w, lay.post); assert.ok(L.obstacleWindow(C, lay, v).width >= C.OBST_MIN_WINDOW - 1e-9);
  }
});

test('틀린 뒤 맞는 글자가 오른쪽 끝에서 들어오는 시간(recover): 폭이 넓을수록 길다. 최저·최고 속도, 폭 360·640·740·800', () => {
  const out = {};
  for (const viewW of WIDTHS) for (const v of [C.SPEED_MIN, C.SPEED_MAX]) {
    const r = L.streamPlace(C, 'recover', { runnerX: R, v, viewW, widths: tiles(3, 58), item: false, obstacle: null, leftover: null });
    const t = (r.group.tiles[0].x - R) / v;   // 틀린 순간부터 첫 타일이 러너에 닿기까지
    out[viewW + '@' + Math.round(v)] = +t.toFixed(2);
    assert.ok(r.group.tiles[0].x - 29 >= viewW - 1e-9);
    assert.ok(t >= C.PACK_DELAY + L.leadSec(v) - 1e-9, 'classic(틀린 뒤 같은 칸 다시)보다 빠르지 않다');
  }
  assert.ok(out['800@169'] > out['360@169'] && out['800@364'] > out['360@364']);
  assert.ok(Math.abs(out['800@169'] - (800 + 29 - R) / 169) < 0.01, '폭 800 최저 속도: 진입 거리 / 속도 = ' + out['800@169']);
});

test('지금 풀 칸 판정·화면 밖(흐림은 작업360에서 없앰)', () => {
  const cur = { wi: 2, si: 1 };
  assert.equal(L.streamIsCorrect({ correct: true, wi: 2, si: 1 }, cur), true);
  assert.equal(L.streamIsCorrect({ correct: true, wi: 2, si: 2 }, cur), false, '다음 칸용 정답');
  assert.equal(L.streamIsCorrect({ correct: true, wi: 3, si: 1 }, cur), false, '다음 단어용 정답');
  assert.equal(L.streamIsCorrect({ correct: false, wi: 2, si: 1 }, cur), false);
  assert.equal(L.streamDim, undefined, '작업360: 흐림 계산은 없앴다'); assert.equal(STREAM.DIM_ALPHA, undefined); assert.equal(STREAM.DIM_SCALE, undefined);
  assert.equal(L.streamOffscreen({ state: 'live', checked: false, x: 430, w: 58 }, 360), true);
  assert.equal(L.streamOffscreen({ state: 'live', checked: false, x: 380, w: 58 }, 360), false, '왼쪽 끝이 화면 안');
  assert.equal(L.streamOffscreen({ state: 'live', checked: true, x: 500, w: 58 }, 360), false);
});

test('logic.js 판단 함수는 classic 설정 값을 바꾸지 않는다(CONFIG 키 추가는 STREAM_EDGE 하나)', () => {
  const keys = Object.keys(L.buildConfig({})), base = keys.filter(k => k !== 'STREAM_EDGE');
  assert.equal(keys.length, base.length + 1);
});

// ───────── 작업355: 꽉 찬 화면 판 크기 ─────────
test('layoutFor 세로: 높이 640 이면 LAYOUT 과 완전히 같고, 높이를 늘리면 하늘 2/3·아래 띠 1/3, 땅 기준 상대 위치 불변, 배율 상한 1.5', () => {
  const base = L.layoutFor('port', 360, 640);
  for (const k of Object.keys(L.LAYOUT)) assert.equal(base[k], L.LAYOUT[k], k);
  assert.equal(base.scale, 1); assert.equal(base.extra, 0);
  for (const [aw, ah] of [[360, 700], [360, 780], [390, 750], [412, 900], [412, 915], [768, 1024], [360, 560]]) {
    const l = L.layoutFor('port', aw, ah);
    assert.equal(l.W, 360); assert.ok(l.H >= 640);
    assert.equal(l.GROUND - l.TILE_Y, L.LAYOUT.GROUND - L.LAYOUT.TILE_Y); assert.equal(l.GROUND - l.HIGH_TILE_Y, L.LAYOUT.GROUND - L.LAYOUT.HIGH_TILE_Y);
    const e = l.H - 640, es = Math.round(e * 2 / 3);
    assert.equal(l.GROUND, 520 + es); assert.equal(l.H - l.GROUND, 120 + (e - es));
    assert.equal(l.CONTENT_BOTTOM_Y, L.LAYOUT.CONTENT_BOTTOM_Y, '위쪽 글자 영역은 그대로'); assert.equal(l.HUD_SHIFT, 24);
    assert.ok(l.scale <= 1.5 + 1e-9 && l.scale > 0.3);
    assert.ok(l.W * l.scale <= aw + 1e-6 && l.H * l.scale <= ah + 1e-6, `${aw}x${ah}: 판이 화면 안`);
    if (e > 0) assert.ok(l.H * l.scale >= ah - 1.5 || l.scale >= 1.5 - 1e-9, '늘어난 경우 화면 높이를 채운다');
  }
});
test('layoutFor 가로: 800x400 고정, 글자 영역 100 이하가 높은 칸 타일 윗변(112)보다 위, 땅 아래 띠 44', () => {
  const l = L.layoutFor('land', 915, 412);
  assert.equal(l.W, 800); assert.equal(l.H, 400); assert.equal(l.GROUND, 356);
  assert.equal(l.GROUND - l.TILE_Y, 108); assert.equal(l.GROUND - l.HIGH_TILE_Y, 215);
  assert.ok(l.CONTENT_BOTTOM_Y <= 100 && l.CONTENT_BOTTOM_Y < l.HIGH_TILE_Y - l.TILE_H / 2, '글자 영역 아래 끝이 높은 칸 타일 윗변보다 위');
  assert.equal(l.H - l.GROUND, 44);
  assert.ok(Math.abs(l.scale - Math.min(915 / 800, 412 / 400)) < 1e-9);
  assert.equal(L.layoutFor('land', 2000, 1200).scale, 1.5, '상한 1.5');
});

// 작업360: 가로 타일 75%·캐릭터 1.3배. 판정(점프 높이·러너 위치·장애물)은 크기와 무관하다
test('작업360 가로 배율: 타일 0.75·캐릭터 1.3은 가로만, 세로는 1(그대로). 간격(MIN_GAP·PAD)은 같은 비율, LOOKAHEAD·판정 상수는 그대로', () => {
  assert.equal(L.LAYOUT_LAND.TILE_SCALE, 0.75); assert.equal(L.LAYOUT_LAND.CHAR_SCALE, 1.3);
  assert.equal(L.LAYOUT.TILE_SCALE, 1); assert.equal(L.LAYOUT.CHAR_SCALE, 1);
  assert.equal(L.layoutFor('port', 360, 640).TILE_SCALE, 1); assert.equal(L.layoutFor('land', 800, 400).TILE_SCALE, 0.75);
  assert.equal(L.streamMinGap(58, 58), 90, '세로(k 없음)는 이전과 같다');
  assert.equal(L.streamMinGap(43.5, 43.5, 0, 0.75), 67.5, '가로: 타일 43.5 + PAD 24 = MIN_GAP 67.5');
  assert.equal(L.streamMinGap(0.75 * 124, 0.75 * 124, 0, 0.75), 0.75 * 124 + 24, '조각 타일(폭 124)도 PAD 만 줄어든 폭 기준');
  assert.equal(STREAM.LOOKAHEAD, 240); assert.equal(C.GRAB_H, 22); assert.equal(C.HIGH_GRAB_H, 160); assert.equal(C.JUMP_PEAK, 118);
});
test('작업360 가로 배치: 타일 폭 75%로 줄어도 모든 객체가 화면 밖에서 시작하고 남은 타일과 간격이 이전과 같은 비율로 남는다', () => {
  for (const v of SPEEDS) for (const vw of WIDTHS) {
    const w = 58 * 0.75, k = 0.75;
    const g0 = L.layoutGroup(C, { R0: R + 300, v, widths: tiles(4, w), item: false, obstacle: null, firstHigh: false });
    const r = L.streamPlace(C, 'pack', { xc: R, runnerX: R, v, bossNext: false, first: false, viewW: vw, widths: tiles(4, w), item: false, obstacle: null, firstHigh: false, leftover: { x: vw + 20, w }, tileScale: k });
    const gl = L.groupLeft(r.group);
    assert.ok(gl.left >= vw - 1e-9, '화면 밖에서 시작');
    assert.ok(gl.cx - (vw + 20) >= L.streamMinGap(w, w, 0, k) - 1e-9, `남은 타일과 간격 ${(gl.cx - vw - 20).toFixed(1)}`);
    assert.ok(g0.tiles[0].w === w);
  }
});
