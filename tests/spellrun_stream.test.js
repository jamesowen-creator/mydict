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

// 작업361: 풍선 색·위상·움직임·늘리기·올림 상수(순수 로직, 난수 없음)
test('작업361 풍선: 색은 (후보 번호 + 칸 번호) % 6 으로 위치마다 일정(난수 없음), 위상은 타일 번호로만 정해지고 서로 어긋난다', () => {
  const B = L.BALLOON_ART;
  assert.equal(B.COUNT, 6); assert.equal(B.NAMES.length, 6); assert.equal(B.COLORS.length, 6);
  for (let si = 0; si < 12; si++) for (let i = 0; i < 5; i++) { assert.equal(L.balloonColor(i, si), (i + si) % 6); assert.equal(L.balloonColor(i, si), L.balloonColor(i, si), '같은 입력 같은 색'); }
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => L.balloonColor(i, 0)), [0, 1, 2, 3, 4, 5], '6색을 한 바퀴');
  assert.equal(L.balloonPhase(7), L.balloonPhase(7));
  const ph = Array.from({ length: 24 }, (_, n) => L.balloonPhase(n));
  assert.ok(ph.every(p => p >= 0 && p < Math.PI * 2) && new Set(ph.map(p => p.toFixed(6))).size === 24, '타일마다 위상이 다르다');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', 'spellrun', 'logic.js'), 'utf8');
  const blk = src.slice(src.indexOf('// ---- 작업361: 풍선'), src.indexOf('// ---- 작업323: 새 단어 시작 연출'));
  assert.ok(!/Math\.random/.test(blk.replace(/Math\.random 없음|난수 없음/g, '')), '풍선 로직에 Math.random 이 없다');
});
test('작업361 풍선 움직임: 위아래 ±3 논리 px·주기 1.6초, 기울기 ±4도, 같은 시간·위상이면 같은 값, 시간이 멈추면 값도 멈춘다', () => {
  const B = L.BALLOON_ART;
  assert.equal(B.BOB, 3); assert.equal(B.BOB_SEC, 1.6); assert.equal(B.SWAY_DEG, 4);
  let maxDy = 0, maxAng = 0;
  for (let t = 0; t < 8; t += 0.01) { const m = L.balloonMotion(t, 1.1); maxDy = Math.max(maxDy, Math.abs(m.dy)); maxAng = Math.max(maxAng, Math.abs(m.ang)); }
  assert.ok(maxDy <= 3 + 1e-9 && maxDy > 2.99 && maxAng <= 4 + 1e-9 && maxAng > 3.99, `${maxDy} ${maxAng}`);
  assert.ok(Math.abs(L.balloonMotion(0.3, 0.5).dy - L.balloonMotion(0.3 + 1.6, 0.5).dy) < 1e-9, '위아래 주기 1.6초');
  assert.deepEqual(L.balloonMotion(2.5, 0.9), L.balloonMotion(2.5, 0.9));
  assert.notDeepEqual(L.balloonMotion(2.5, L.balloonPhase(1)), L.balloonMotion(2.5, L.balloonPhase(2)), '풍선마다 어긋남');
});
test('작업361 풍선 늘리기·올림: 글자 폭이 몸통의 80%를 넘으면 늘리되 1.4배까지, 넘으면 null(기존 타일 모양). 올림은 가로만(TILE_LIFT)', () => {
  const B = L.BALLOON_ART, fit = B.BODY_W * B.TEXT_FIT;
  assert.equal(L.balloonStretch(fit * 0.5), 1); assert.equal(L.balloonStretch(fit), 1);
  assert.ok(Math.abs(L.balloonStretch(fit * 1.2) - 1.2) < 1e-9); assert.ok(L.balloonStretch(fit * 1.4) <= 1.4 + 1e-9); assert.equal(L.balloonStretch(fit * 1.41), null);
  assert.equal(L.LAYOUT_LAND.TILE_LIFT, 22); assert.ok(L.LAYOUT_LAND.TILE_LIFT <= 25); assert.equal(L.LAYOUT_LAND.BALLOON, true);
  assert.equal(L.LAYOUT.TILE_LIFT, 0); assert.equal(L.LAYOUT.BALLOON, false); assert.equal(L.layoutFor('port', 360, 640).TILE_LIFT, 0); assert.equal(L.layoutFor('land', 800, 400).TILE_LIFT, 22);
  assert.equal(C.GRAB_H, 22); assert.equal(C.HIGH_GRAB_H, 160, '먹는 판정 상수는 그대로');
});

// 작업362: 틀린 풍선 위로 올라가기(순수 로직)
test('작업362 올라가기: 풍선마다 가속이 ±10% 안에서 타일 번호로만 정해지고(난수 없음) 나가는 시간은 약 0.9초, 처음엔 느리고 갈수록 빨라진다', () => {
  const B = L.BALLOON_ART;
  assert.equal(B.RISE_SEC, 0.9); assert.equal(B.RISE_VAR, 0.1);
  const fs = Array.from({ length: 40 }, (_, n) => L.balloonRise(280, n));
  assert.ok(fs.every(r => r.f >= 0.9 - 1e-9 && r.f <= 1.1 + 1e-9), '가속 차이 ±10%');
  assert.ok(new Set(fs.map(r => r.f.toFixed(6))).size > 30, '풍선마다 다르다');
  assert.ok(fs.every(r => r.sec >= 0.85 && r.sec <= 0.96), '나가는 시간 ' + Math.min(...fs.map(r => r.sec)).toFixed(3) + '~' + Math.max(...fs.map(r => r.sec)).toFixed(3));
  assert.deepEqual(L.balloonRise(280, 7), L.balloonRise(280, 7), '같은 입력 같은 값');
  const r = L.balloonRise(280, 3);
  assert.ok(Math.abs(L.balloonRiseY(r.sec, r.a) - 280) < 1e-6, '나가는 시간에 정확히 거리만큼');
  assert.equal(L.balloonRiseY(0, r.a), 0);
  assert.ok(L.balloonRiseY(0.1, r.a) < L.balloonRiseY(r.sec, r.a) - L.balloonRiseY(r.sec - 0.1, r.a), '처음 0.1초 < 마지막 0.1초');
});

// 작업363: 캐릭터 동작 효과(순수 로직, 가로만, 난수 없음)
test('작업363 효과 값: 점프 시작 0.1초 1.12/0.92, 정점 1.0, 착지 0.85/1.12 → 1.0, 출렁임 ±1.5, 그림자는 높을수록 작고 연함, 먼지 상한 24', () => {
  const F = L.CHAR_FX, apex = C.JUMP_TIME / 2;
  const a = L.charSquash(0.1, apex, 0); assert.ok(Math.abs(a.sy - 1.12) < 1e-9 && Math.abs(a.sx - 0.92) < 1e-9);
  const z = L.charSquash(0, apex, 0); assert.equal(z.sy, 1); assert.equal(z.sx, 1);
  const p = L.charSquash(apex, apex, 0); assert.ok(Math.abs(p.sy - 1) < 1e-9 && Math.abs(p.sx - 1) < 1e-9, '정점 1.0');
  const mid = L.charSquash(0.05, apex, 0); assert.ok(Math.abs(mid.sy - 1.06) < 1e-9);
  const l = L.charSquash(-1, apex, F.SQUASH_SEC); assert.ok(Math.abs(l.sy - 0.85) < 1e-9 && Math.abs(l.sx - 1.12) < 1e-9, '착지');
  assert.deepEqual(L.charSquash(-1, apex, 0), { sx: 1, sy: 1 });
  let mx = 0; for (let ph = 0; ph < 4; ph += 0.01) mx = Math.max(mx, Math.abs(L.runBob(ph))); assert.ok(mx <= 1.5 + 1e-9 && mx > 1.49);
  assert.ok(Math.abs(L.runBob(0)) < 1e-9 && Math.abs(L.runBob(1)) < 1e-9 && Math.abs(L.runBob(0.5) - 1.5) < 1e-9 && Math.abs(L.runBob(1.5) + 1.5) < 1e-9);
  const s0 = L.charShadow(0), s1 = L.charShadow(118), s2 = L.charShadow(236);
  assert.equal(s0.k, 1); assert.ok(s1.k < s0.k && s2.k < s1.k && s1.a < s0.a && s2.a < s1.a, '높을수록 작고 연하다'); assert.ok(L.charShadow(999).k >= F.SHADOW_MIN - 1e-9);
  assert.equal(F.DUST_MAX, 24); assert.equal(F.DUST_LAND.length, 3); assert.equal(F.DUST_RUN_SEC, 0.2);
  assert.ok([...F.DUST_LAND, ...F.DUST_RUN].every(d => d.vx < 0), '먼지는 모두 뒤쪽(왼쪽)으로');
});
test('작업363 반응 상태·맞는/틀린 글자 값: 길이 happy 0.4·hurt 0.5·surprise 0.3, 우선순위, 폴짝 6, 별 4개 0.4초, 틀린 글자 3번 흔들림 ±3·기울어짐 -6도 0.3초', () => {
  const F = L.CHAR_FX;
  assert.deepEqual(F.REACT, { happy: 0.4, hurt: 0.5, surprise: 0.3 });
  let cur = L.reactNext(null, 'hurt', 10); assert.deepEqual(cur, { kind: 'hurt', t0: 10, dur: 0.5 });
  assert.equal(L.reactKind(cur, 10.49), 'hurt'); assert.equal(L.reactKind(cur, 10.5), '');
  assert.equal(L.reactNext(cur, 'happy', 10.2), cur, '진행 중인 hurt 는 happy 가 덮지 않는다');
  assert.equal(L.reactNext(cur, 'surprise', 10.2), cur);
  assert.equal(L.reactNext(cur, 'happy', 10.6).kind, 'happy', '끝난 뒤에는 새 반응');
  const h = L.reactNext(L.reactNext(null, 'happy', 1), 'surprise', 1.1); assert.equal(h.kind, 'surprise', '높은 우선순위가 덮는다');
  assert.equal(F.RIGHT_HOP, 6); assert.ok(Math.abs(L.rightHop(0.5) - 6) < 1e-9 && L.rightHop(0) < 1e-9 && L.rightHop(1) < 1e-9); assert.equal(F.STAR_N, 4); assert.equal(F.STAR_SEC, 0.4);
  const w0 = L.wrongFx(0); assert.equal(w0.ang, -6); assert.ok(Math.abs(L.wrongFx(1).ang) < 1e-9); assert.ok(Math.abs(L.wrongFx(1).dx) < 1e-9);
  assert.equal(F.WRONG_SEC, 0.3); assert.equal(F.WRONG_CYCLES, 3); assert.equal(F.WRONG_SHAKE, 3);
  assert.deepEqual(L.wrongFx(0.2), L.wrongFx(0.2), '난수 없음'); assert.deepEqual(L.starFx(1, 0.3), L.starFx(1, 0.3));
  assert.equal(L.LAYOUT_LAND.FX, true); assert.equal(L.LAYOUT.FX, false); assert.equal(L.layoutFor('port', 360, 640).FX, false);
});

// 작업364: 여학생·남학생 달리기 8동작·표정 프레임(순수 로직)
test('작업364 프레임 길이: 8동작 캐릭터는 한 바퀴 시간이 펭귄(4칸 x 0.11)과 같다(길이 4/8, 제한값 0.03~0.07), 위상은 8 에서 돌아가고 속도가 바뀌어도 이어진다', () => {
  const P = L.CHARS.penguin, G8 = L.CHARS.girl, B8 = L.CHARS.boy;
  assert.equal(P.RUN_LEN, 0.11); assert.equal(P.RUN_FRAMES, 4);
  for (const C8 of [G8, B8]) { assert.equal(C8.RUN_FRAMES, 8); assert.equal(C8.RUN_LEN, 0.055); assert.equal(C8.RUN_LEN_MIN, 0.03); assert.equal(C8.RUN_LEN_MAX, 0.07); }
  for (const v of [C.SPEED_MIN, 80, 100, 130, C.SPEED_MAX, 400]) {
    const lp = L.runFrameLength(v, C, P) * P.RUN_FRAMES, lg = L.runFrameLength(v, C, G8) * G8.RUN_FRAMES, lb = L.runFrameLength(v, C, B8) * B8.RUN_FRAMES;
    assert.ok(Math.abs(lp - lg) < 1e-9 && Math.abs(lp - lb) < 1e-9, `속도 ${v}: 한 바퀴 ${lp} / ${lg} / ${lb}`);
  }
  assert.equal(L.runFrameLength(C.SPEED_MIN, C), 0.11, '기본(펭귄)은 그대로');
  assert.ok(Math.abs(L.runFrameLength(C.SPEED_MIN, C, G8) - 0.055) < 1e-12);
  let ph = 0, seen = new Set(); for (let i = 0; i < 400; i++) { const nxt = L.advanceRunPhase(ph, 0.01, C.SPEED_MIN + (i % 50), C, G8); assert.ok(nxt >= 0 && nxt < 8); assert.ok(((nxt - ph + 8) % 8) < 1, '한 걸음에 한 칸을 넘지 않는다(위상 이어짐)'); seen.add(Math.floor(nxt)); ph = nxt; }
  assert.equal(seen.size, 8, '8칸 모두 나온다');
  assert.equal(L.advanceRunPhase(7.99, 0.02, C.SPEED_MIN, C, G8) < 1, true, '8 에서 0 으로 돌아간다');
  assert.ok(Math.abs(L.advanceRunPhase(0, 0.01, C.SPEED_MIN, C) - 0.01 / 0.11) < 1e-12, 'P 를 안 주면 펭귄 4칸 그대로');
});
test('작업364 프레임 선택: 표정 프레임은 표정이 있는 캐릭터가 땅 위에서 반응이 있을 때만(점프 중·반응 없음·펭귄·대기·결과 화면은 기존 그대로)', () => {
  const G8 = L.CHARS.girl, P = L.CHARS.penguin;
  const f = o => L.penguinFrame(Object.assign({ state: 'run', cleared: false, air: false, rising: true, runPhase: 2.5, P: G8 }, o));
  assert.equal(f({}), 2, '반응 없음: 달리기 칸'); assert.equal(f({ runPhase: 7.9 }), 7); assert.equal(f({ runPhase: 8 }), 0);
  assert.equal(f({ react: 'happy' }), 11); assert.equal(f({ react: 'hurt' }), 12); assert.equal(f({ react: 'surprise' }), 13); assert.equal(f({ react: '' }), 2);
  assert.equal(f({ air: true, rising: true, react: 'happy' }), 8, '점프 중에는 표정 안 씀(상승)'); assert.equal(f({ air: true, rising: false, react: 'hurt' }), 9, '하강');
  assert.equal(f({ state: 'idle', react: 'happy' }), 1, '대기'); assert.equal(f({ state: 'over', cleared: true }), 8); assert.equal(f({ state: 'over', cleared: false }), 1);
  assert.equal(L.penguinFrame({ state: 'run', air: false, runPhase: 2.5, P: P, react: 'happy' }), 2, '펭귄은 표정 칸이 없어 달리기 그대로');
  assert.equal(L.penguinFrame({ state: 'run', air: false, runPhase: 2.5, react: 'happy' }), 2, 'P 를 안 주면 펭귄');
  assert.deepEqual(L.CHARS.boy.EXPR, { base: 10, happy: 11, hurt: 12, surprise: 13 }); assert.equal(P.EXPR, undefined);
});

// 작업365: 소리(순수 계산) — 콤보→음계, 속도→박자, 곡 데이터, 덕킹, 일시정지·재개 위치, 고정 잡음, 효과음 계획
test('작업365 콤보→음계: 5음계(도레미솔라) 0~10 → 반음 0,2,4,7,9,12,14,16,19,21,24(2옥타브 안), 같은 입력 같은 값, 10 넘는 콤보는 10', () => {
  const semis = Array.from({ length: 11 }, (_, i) => L.comboNote(i).semi);
  assert.deepEqual(semis, [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);
  assert.ok(Math.abs(L.comboNote(0).freq - 261.6256) < 1e-3); assert.ok(Math.abs(L.comboNote(10).freq / L.comboNote(0).freq - 4) < 1e-9, '2옥타브 = 4배');
  assert.deepEqual(L.comboNote(25), L.comboNote(10)); assert.deepEqual(L.comboNote(-3), L.comboNote(0)); assert.deepEqual(L.comboNote(4), L.comboNote(4));
  for (let i = 1; i <= 10; i++) assert.ok(L.comboNote(i).freq > L.comboNote(i - 1).freq, '콤보가 쌓일수록 음이 올라간다');
});
test('작업365 속도→박자: 계수 1.00~1.12(최대 +12%), 마디마다 최대 0.02씩만 따라간다(튀지 않음), 칸 길이는 60/(BPM x 계수)/2', () => {
  assert.equal(L.tempoCoef(C.SPEED_MIN), 1); assert.ok(Math.abs(L.tempoCoef(C.SPEED_MAX) - 1.12) < 1e-12); assert.equal(L.tempoCoef(C.SPEED_MIN - 50), 1); assert.ok(L.tempoCoef(C.SPEED_MAX + 500) <= 1.12 + 1e-12);
  let prev = 0; for (let v = C.SPEED_MIN; v <= C.SPEED_MAX; v += 5) { const k = L.tempoCoef(v); assert.ok(k >= prev - 1e-12 && k >= 1 && k <= 1.12 + 1e-12); prev = k; }
  let cur = 1; const steps = []; for (let i = 0; i < 10; i++) { const n = L.tempoStep(cur, 1.12); steps.push(Math.abs(n - cur)); cur = n; }
  assert.ok(steps.every(d => d <= 0.02 + 1e-12), '마디마다 변화 폭 ' + steps); assert.equal(cur, 1.12); assert.equal(L.tempoStep(1.05, 1.06), 1.06); assert.ok(Math.abs(L.tempoStep(1.1, 1.0) - 1.08) < 1e-12);
  assert.ok(Math.abs(L.slotSec(120, 1) - 0.25) < 1e-12); assert.ok(Math.abs(L.slotSec(140, 1) - 60 / 140 / 2) < 1e-12); assert.ok(Math.abs(L.slotSec(120, 1.12) - 0.25 / 1.12) < 1e-12);
});
test('작업365 곡 데이터: 낮 곡 120BPM(A·B 각 8마디), 보스 곡 140BPM(8마디), 마디마다 8칸, 음 범위, 베이스·잡음 박자, 보스 베이스는 8분음표, A와 B가 다르다', () => {
  assert.equal(L.SONGS.day.bpm, 120); assert.equal(L.SONGS.boss.bpm, 140); assert.deepEqual(L.SONGS.day.order, ['A', 'B']);
  for (const [name, sg] of Object.entries(L.SONGS)) for (const [sec, d] of Object.entries(sg.sections)) {
    assert.equal(d.mel.length, 8, `${name}${sec} 8마디`); assert.equal(d.chords.length, 8);
    for (const bar of d.mel) assert.equal(bar.split(' ').length, 8, '한 마디 = 8분음표 8칸: ' + bar);
    const ev = L.songEvents(name, sec);
    assert.ok(ev.every(e => e.slot >= 0 && e.slot + e.len <= 64 && e.len >= 1), '음이 구간(64칸) 안에 들어간다');
    const mel = ev.filter(e => e.voice === 'mel'), bass = ev.filter(e => e.voice === 'bass'), hat = ev.filter(e => e.voice === 'hat');
    assert.ok(mel.length >= 24 && mel.every(e => e.midi >= 60 && e.midi <= 90), '멜로디 음 범위');
    assert.ok(bass.length >= 16 && bass.every(e => e.midi >= 36 && e.midi <= 60), '베이스 낮은 음');
    assert.ok(hat.length >= 32 && hat.every(e => e.vol <= 0.04), '잡음 박자는 아주 작게');
    assert.ok(mel.every(e => e.vol <= 0.12) && bass.every(e => e.vol <= 0.14));
    for (let b = 0; b < 8; b++) assert.ok(mel.some(e => Math.floor(e.slot / 8) === b), '모든 마디에 멜로디가 있다');
  }
  assert.equal(L.songEvents('boss', 'A').filter(e => e.voice === 'bass').length, 64, '보스 베이스는 8분음표(마디당 8개)');
  assert.ok(L.songEvents('day', 'A').filter(e => e.voice === 'bass').length === 16);
  assert.notDeepEqual(L.songEvents('day', 'A').map(e => e.midi), L.songEvents('day', 'B').map(e => e.midi), 'A 와 B 는 다르다');
  assert.deepEqual(L.songEvents('day', 'A'), L.songEvents('day', 'A'), '같은 입력 같은 결과');
  assert.equal(L.noteMidi('c5'), 72); assert.equal(L.noteMidi('a4'), 69); assert.equal(L.noteMidi('x9'), null); assert.ok(Math.abs(L.midiFreq(69) - 440) < 1e-9);
});
test('작업365 덕킹·재개 위치·음량 이어가기·고정 잡음: 발음 때 35%(0.15초), 끝난 뒤 0.2초 뒤 0.3초에 복귀, 시작하지 않은 첫 칸에서 이어가기, 잡음은 시드가 같으면 같다', () => {
  const S = L.SOUND, st = { start: 10, end: null, from: 1, endLevel: null };
  assert.equal(L.duckLevel(5, null), 1); assert.equal(L.duckLevel(10, st), 1);
  assert.ok(Math.abs(L.duckLevel(10.075, st) - (1 + (S.DUCK - 1) / 2)) < 1e-9); assert.ok(Math.abs(L.duckLevel(10.15, st) - S.DUCK) < 1e-9); assert.equal(L.duckLevel(12, st), S.DUCK, '발음 중에는 계속 35%');
  const en = { start: 10, end: 11, from: 1, endLevel: S.DUCK };
  assert.equal(L.duckLevel(11.1, en), S.DUCK, '끝난 뒤 0.2초는 그대로'); assert.equal(L.duckLevel(11.2, en), S.DUCK);
  assert.ok(Math.abs(L.duckLevel(11.35, en) - (S.DUCK + (1 - S.DUCK) / 2)) < 1e-9, '복귀 중간'); assert.equal(L.duckLevel(11.5, en), 1); assert.equal(L.duckLevel(20, en), 1);
  assert.deepEqual([S.DUCK, S.DUCK_IN, S.DUCK_HOLD, S.DUCK_OUT], [0.35, 0.15, 0.2, 0.3]);
  const pend = [{ pos: 5, t: 1.0 }, { pos: 6, t: 1.25 }, { pos: 7, t: 1.5 }];
  assert.equal(L.resumePos(pend, 1.1, 99), 6, '아직 시작하지 않은 첫 칸'); assert.equal(L.resumePos(pend, 0.5, 99), 5); assert.equal(L.resumePos(pend, 2, 42), 42, '다 지났으면 fallback'); assert.equal(L.resumePos([], 1, 3), 3);
  assert.equal(L.rampValue({ from: 0, to: 1, t0: 10, dur: 0.5 }, 10.25), 0.5); assert.equal(L.rampValue({ from: 0, to: 1, t0: 10, dur: 0.5 }, 9), 0); assert.equal(L.rampValue({ from: 0, to: 1, t0: 10, dur: 0.5 }, 11), 1); assert.equal(L.rampValue({ from: 0.3, to: 0.9, t0: 1, dur: 0 }, 1), 0.9);
  const a = L.noiseSamples(2000), b = L.noiseSamples(2000), c = L.noiseSamples(2000, 7);
  assert.deepEqual(Array.from(a), Array.from(b)); assert.notDeepEqual(Array.from(a), Array.from(c)); assert.ok(a.every(x => x >= -1 && x <= 1 && !Number.isNaN(x)));
  const mean = a.reduce((x, y) => x + y, 0) / a.length; assert.ok(Math.abs(mean) < 0.1 && Math.max(...a) > 0.9 && Math.min(...a) < -0.9, '잡음답게 고르게 퍼진다');
});
test('작업365 효과음 계획: 모든 종류가 있고 날카로운 톱니파·네모파가 없으며, 올라가는 소리 약 0.9초(400→1200Hz 삼각파·떨림), 팡파르 약 0.6초, 상수가 한 곳에 있다', () => {
  const names = ['jump', 'jump2', 'land', 'pop', 'rise', 'bad', 'speed', 'hint', 'angel', 'heart', 'hit', 'over', 'boss', 'word', 'tick', 'win', 'fail'];
  for (const n of names) {
    const p = L.sfxPlan(n, 3); assert.ok(p.length >= 1, n);
    for (const v of p) { assert.ok(!v.type || ['sine', 'triangle'].includes(v.type), `${n} 파형 ${v.type}`); assert.ok(v.dur > 0 && v.vol > 0 && v.vol <= 0.4 && (v.noise || v.f0 > 20), n); assert.ok(!Number.isNaN(v.vol + v.dur + (v.t0 || 0))); }
  }
  const r = L.sfxPlan('rise')[0]; assert.equal(r.type, 'triangle'); assert.equal(r.f0, 400); assert.equal(r.f1, 1200); assert.ok(r.dur >= 0.85 && r.dur <= 0.95); assert.ok(r.wob && r.wob.cents > 0);
  assert.equal(L.sfxPlan('rise').length, 1, '올라가는 소리는 한 번 = 소리 하나');
  const end = n => Math.max(...L.sfxPlan(n, 0).map(v => (v.t0 || 0) + v.dur)); assert.ok(end('word') >= 0.55 && end('word') <= 0.7, '팡파르 길이 ' + end('word')); assert.ok(end('win') >= 2.5 && end('win') <= 3.2, '완주 마무리 약 3초');
  assert.equal(L.sfxPlan('angel').length, 6, '천사 6음'); assert.ok(L.sfxPlan('word').filter(v => (v.t0 || 0) >= 0.35).length >= 3, '도미솔 화음');
  assert.equal(L.sfxPlan('bad')[0].f0, 300); assert.equal(L.sfxPlan('bad')[0].f1, 160); assert.deepEqual([L.sfxPlan('jump')[0].f0, L.sfxPlan('jump')[0].f1], [400, 700]);
  assert.ok(L.sfxPlan('jump2')[0].f0 > L.sfxPlan('jump')[0].f0, '2단 점프는 더 높다');
  const S = L.SOUND; assert.equal(S.MAX_NODES, 24); assert.equal(S.MUSIC_VS_SFX, 0.4); assert.ok(S.MASTER <= 0.9); assert.ok(S.VOL && Object.keys(S.VOL).length >= names.length);
  assert.equal(S.LOOKAHEAD, 0.12); assert.equal(S.TICK_MS, 25); assert.equal(S.IDLE_LEVEL, 0.5); assert.equal(S.FADE_IN, 0.5); assert.equal(S.BOSS_FADE, 0.4);
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', 'spellrun', 'logic.js'), 'utf8');
  const blk = src.slice(src.indexOf('// ---- 작업365'), src.indexOf('// ---- 작업323: 새 단어 시작 연출'));
  assert.ok(!/Math\.random/.test(blk.replace(/난수 아님|Math\.random 없음/g, '')), '소리 로직에 Math.random 이 없다');
  assert.ok(!/sawtooth|'square'/.test(blk.replace(/톱니파·네모파/g, '')), '날카로운 파형을 쓰지 않는다');
});
