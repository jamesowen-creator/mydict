// 작업358: 그림 정리 결과 시험(브라우저 없음). scripts/spellrun_art_build.py 가 만든 결과 파일과 scripts/spellrun_art_report.json 의 수치를 확인한다.
// 확인: 파일 크기 합계(약 1.5MB 이하)·PNG 헤더 크기·코드 상수와 일치, 투명 잔여 0, 캐릭터 발끝 기준선 차이 2px 이하·잘린 동작 없음, 배경 이음새 색 차이,
//       (원본 폴더가 있으면) 스크립트를 다시 돌려 같은 결과가 나오는지
// 실행: node --test tests/spellrun_art.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const L = require('../public/js/spellrun/logic.js');

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'public', 'img', 'spellrun');
const REPORT = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'spellrun_art_report.json'), 'utf8'));
const png = f => { const b = fs.readFileSync(path.join(IMG, f)); assert.equal(b.slice(1, 4).toString(), 'PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }; };
const KEYS = ['day_far', 'day_mid', 'clouds', 'boss_sky', 'boss_far', 'boss_near', 'obstacles', 'items', 'girl', 'boy', 'balloons'];

test('결과 파일: 모두 있고 크기·PNG 헤더가 보고와 같으며 합계는 1.5MB 이하', () => {
  let total = 0;
  for (const k of KEYS) {
    const r = REPORT[k], p = png(r.file);
    assert.deepEqual([p.w, p.h], r.size, k + ' 그림 크기'); assert.equal(p.bytes, r.bytes, k + ' 파일 크기');
    total += p.bytes;
  }
  assert.equal(total, REPORT._total.bytes);
  assert.ok(total <= 1.5 * 1024 * 1024, '합계 ' + (total / 1024).toFixed(0) + 'KB');
  assert.ok(total + png('spellrun_penguin_sheet.png').bytes <= 1.5 * 1024 * 1024, '펭귄 시트를 더해도 1.5MB 이하');
});

test('투명 잔여(불투명도 1~8) 0, 잘린 동작 없음, 발끝 기준선 y 280(14칸 모두), 몸 높이 250 이하, 여학생·남학생 시트는 14칸 한 줄(작업364)', () => {
  for (const k of KEYS) assert.equal(REPORT[k].low_alpha_pixels, 0, k + ' 투명 잔여');
  for (const k of ['girl', 'boy']) {
    const r = REPORT[k];
    assert.deepEqual(r.size, [4032, 288]); assert.equal(r.cell, 288);
    assert.ok(r.foot_spread <= 2, k + ' 발끝 차이 ' + r.foot_spread); assert.deepEqual(r.clipped_frames, [], k + ' 잘린 동작');
    assert.equal(r.foot_y.length, 14); assert.ok(r.foot_y.every(y => y === 280), '발끝 y 280 = 칸 아래에서 8px(펭귄과 같다)');
    assert.ok(Math.max(...r.frame_heights) <= 250, '몸 높이 최대 250 이하: ' + Math.max(...r.frame_heights));
    assert.ok(r.sheet14.after.widths.every(w => w <= 288), '가로 폭이 칸(288)을 넘지 않는다');
  }
  const P = L.CHARS.penguin;
  assert.deepEqual([P.SHEET_W, P.SHEET_H, P.CELL, P.RUN_FRAMES], [1728, 288, 288, 4], '펭귄 시트는 그대로');
  for (const k of ['girl', 'boy']) { const C = L.CHARS[k]; assert.deepEqual([C.SHEET_W, C.SHEET_H, C.CELL, C.size, C.FRAMES, C.RUN_FRAMES, C.JUMP_UP, C.JUMP_DOWN], [4032, 288, 288, 92, 14, 8, 8, 9]); assert.deepEqual(C.EXPR, REPORT[k].sheet14.map.expr); assert.deepEqual(REPORT[k].sheet14.map.run, [0, 1, 2, 3, 4, 5, 6, 7]); }
});

test('배경 이음새: 마지막 열과 첫 열의 색 차이가 이미지 안쪽 이웃 열 차이의 평균에 견줘 작고 윤곽 불일치 행이 없다', () => {
  for (const k of ['day_far', 'day_mid', 'boss_far', 'boss_near', 'boss_sky']) {
    const s = REPORT[k].seam;
    assert.ok(s.seam <= Math.max(2, s.inner_mean * 1.5), `${k} 이음새 ${s.seam} (안쪽 평균 ${s.inner_mean})`);
    assert.ok(s.alpha_row_mismatch <= 2, `${k} 이음새에서 윤곽이 어긋난 행 ${s.alpha_row_mismatch}`);
  }
});

test('코드 상수(logic.js)가 결과 파일과 같다: 배경 층·구름 좌표·아이템 시트·장애물 시트', () => {
  const B = L.BG_ART, map = { dayFar: 'day_far', dayMid: 'day_mid', bossFar: 'boss_far', bossNear: 'boss_near' };
  for (const [key, rk] of Object.entries(map)) { const sp = B.LAYERS[key], r = REPORT[rk]; assert.equal(sp.URL, '/img/spellrun/' + r.file); assert.deepEqual([sp.W, sp.H], r.size); assert.equal(r.logical[0], B.TILE_W); }
  assert.deepEqual([B.SKY.W, B.SKY.H], REPORT.boss_sky.size); assert.equal(B.SKY.URL, '/img/spellrun/' + REPORT.boss_sky.file);
  assert.deepEqual([B.CLOUDS.W, B.CLOUDS.H], REPORT.clouds.size); assert.deepEqual(B.CLOUDS.ITEMS, REPORT.clouds.items); assert.equal(B.CLOUDS.ITEMS.length, 5);
  const I = L.ITEM_ART, ri = REPORT.items;
  assert.deepEqual([I.SHEET_W, I.SHEET_H, I.CELL], [ri.size[0], ri.size[1], ri.cell]); assert.deepEqual(I.ORDER, ['heart', 'speed', 'hint', 'angel']); assert.deepEqual(ri.objects.map(o => o.name), I.ORDER);
  assert.equal(Math.max(...ri.objects.map(o => Math.max(o.w, o.h))), I.MAX_SIDE, '네 아이템의 큰 변이 같다(겉보기 크기)');
  assert.ok(ri.objects.every(o => Math.max(o.w, o.h) === I.MAX_SIDE), '모두 같은 큰 변');
  const O = L.OBSTACLE_ART, ro = REPORT.obstacles;
  assert.deepEqual([O.SHEET_W, O.SHEET_H, O.CELL, O.BORDER, O.FOOT_Y], [ro.size[0], ro.size[1], ro.cell, ro.border, ro.foot_y]);
  assert.deepEqual(O.OBJECTS, ro.objects.map(o => ({ name: o.name, w: o.w, h: o.h })));
  assert.ok(ro.objects.every(o => Math.abs(o.foot - O.FOOT_Y) <= 1), '바닥선 맞춤(237)');
});

test('스크립트를 다시 돌리면 같은 결과가 나온다(원본 그림 폴더가 있을 때만)', { skip: fs.existsSync(path.join(ROOT, 'reference', 'spellrun-art')) ? false : '원본 폴더(reference/spellrun-art, git 무시)가 없어 건너뜀' }, () => {
  const py = ['python', 'py'].find(c => spawnSync(c, ['-c', 'import PIL, numpy'], { stdio: 'ignore' }).status === 0);
  if (!py) return;   // Python·Pillow·numpy 가 없으면 건너뜀
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'srart-'));
  const rep = path.join(tmp, 'report.json');
  const r = spawnSync(py, [path.join(ROOT, 'scripts', 'spellrun_art_build.py'), path.join(ROOT, 'reference', 'spellrun-art'), tmp, rep], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  for (const k of KEYS) assert.equal(sha(path.join(tmp, REPORT[k].file)), sha(path.join(IMG, REPORT[k].file)), k + ' 결과가 같다');
  assert.deepEqual(JSON.parse(fs.readFileSync(rep, 'utf8')), REPORT);
});

// ---- 작업364: 여학생·남학생 달리기 8동작 + 표정 4종(14칸 시트) ----
const RUN_KEYS = ['girl', 'boy'];
// 358 의 점프 상승·하강 2칸(RGBA 바이트의 sha256, git 65086d3 의 시트에서 잰 값). 한 픽셀이라도 다르면 달라진다
const JUMP_358 = { girl: 'c23818f3197fb6dafe54b15e637a2da9dbbbe707608b46f03e94d7b89087d978', boy: 'daff89fd8680651ba74d0cb256aab6a6eefe13ea3b52eb4a41755280868f5399' };
const pyOf = () => ['python', 'py'].find(c => spawnSync(c, ['-c', 'import PIL, numpy'], { stdio: 'ignore' }).status === 0);
const pyMeasure = code => {
  const py = pyOf(); if (!py) return null;
  const r = spawnSync(py, ['-B', '-I', '-c', 'import sys,json,importlib.util,numpy as np\nfrom PIL import Image\nsys.dont_write_bytecode=True\nsp=importlib.util.spec_from_file_location("b",sys.argv[1]);b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)\n' + code, path.join(ROOT, 'scripts', 'spellrun_art_build.py'), IMG], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
};

test('달리기 8동작: 이웃 칸(0-1 … 6-7, 7-0) 다리 모양이 모두 0.25 이상으로 다르다 — 모두 같은 자세로 돌아가는 것을 막는다', () => {
  for (const k of RUN_KEYS) {
    const d = REPORT[k].sheet14.after.leg_diff;
    assert.equal(Object.keys(d).length, 8);
    for (const [pair, v] of Object.entries(d)) assert.ok(v >= 0.25, `${k} 다리 차이 ${pair} = ${v}`);
  }
});

test('달리기 8동작·표정: 한 배율, 머리 크기 한도, 얼굴 가로 위치 한도(6px), 표정 칸 위치, 점프 2칸은 358 과 한 픽셀도 같다(sha256)', () => {
  for (const k of RUN_KEYS) {
    const r = REPORT[k].sheet14, a = r.after;
    const run = a.head.slice(0, 8), target = r.head_target;
    for (const h of run) assert.ok(Math.abs(h / target - 1) <= 0.12, `${k} 머리 크기 ${h} (기준 ${target})`);
    assert.ok(Math.max(...run) / Math.min(...run) <= 1.12, k + ' 달리기 8칸끼리 머리 크기');
    const fx = a.face_x.slice(0, 8); assert.ok(Math.max(...fx) - Math.min(...fx) <= 6, k + ' 달리기 얼굴 가로 ' + fx);
    near(fx.reduce((x, y) => x + y) / 8, r.face_anchor_x, 1.5, k + ' 얼굴 가로 중심이 기존(359) 시트 값');
    const ex = a.head.slice(10, 14); for (const h of ex) assert.ok(Math.abs(h / target - 1) <= 0.12, `${k} 표정 머리 크기 ${h}`);
    assert.ok(Math.abs(a.face_x[10] - r.face_anchor_x) <= 2, k + ' 기본 표정 얼굴 가로');
    const hx = a.hair_x.slice(10, 14); assert.ok(Math.max(...hx) - Math.min(...hx) <= 3, k + ' 표정 4칸의 머리카락 가로 위치 ' + hx);
    assert.ok(r.expr.scale > 0 && Math.abs(r.expr.scale_vs_run - 1) < 0.15, k + ' 표정 배율이 달리기와 크게 다르지 않다(머리 크기를 맞춤): ' + r.expr.scale_vs_run);
    assert.equal(r.jump_sha256, JUMP_358[k], k + ' 점프 2칸이 358 과 다르다');
    assert.deepEqual(r.compose.cells_from_old, [4, 7]); assert.ok(r.compose.outline_diff_fix_vs_old.every(d => d <= 0.02), '보정본·이전 외곽 차이 약 2% 이내(가로로 어긋난 칸은 맞춘 뒤): ' + r.compose.outline_diff_fix_vs_old);
  }
});

test('시트 수치가 결과 파일과 같다(보고만 믿지 않고 PNG 에서 다시 잼, Python 이 있을 때): 14칸 측정, 점프 2칸 sha256, 표정 4칸은 얼굴만 다르다', () => {
  const m = pyMeasure('import hashlib\nout={}\nfor k in ["girl","boy"]:\n    a=np.array(Image.open(sys.argv[2]+"/spellrun_"+k+"_sheet.png").convert("RGBA"))\n    c=[a[:,i*288:(i+1)*288] for i in range(14)]\n    ex=[x[...,3]>40 for x in c[10:14]]\n    top=lambda m:m[:150]; bot=lambda m:m[150:]\n    d=[((ex[0]^e).sum(), (top(ex[0])^top(e)).sum(), (bot(ex[0])^bot(e)).sum()) for e in ex[1:]]\n    px=[(np.abs(c[10][...,:3].astype(int)-x[...,:3].astype(int)).sum(2)>60)&(c[10][...,3]>200)&(x[...,3]>200) for x in c[11:14]]\n    out[k]={"m":b.sheet14_measure(a),"sha":b.jump_sha(a),"silh":[int(x[1]+x[2]) for x in d],"botdiff":[int(x[2]) for x in d],"facepx":[int(p[:150].sum()) for p in px],"bodypx":[int(p[150:].sum()) for p in px]}\nprint(json.dumps(out))');
  if (!m) return;
  for (const k of RUN_KEYS) {
    assert.deepEqual(m[k].m, REPORT[k].sheet14.after, k + ' 다시 잰 수치'); assert.equal(m[k].sha, JUMP_358[k]);
    assert.ok(m[k].botdiff.every(v => v <= 800), k + " 표정 칸의 몸 윤곽(아래쪽)은 거의 같다(크기 맞춤 반올림으로 몇백 픽셀 차이): " + m[k].botdiff);
    assert.ok(m[k].facepx.every(v => v >= 150), k + ' 표정마다 얼굴(위쪽 색)이 다르다: ' + m[k].facepx);
  }
});

function near(a, b, e, msg) { assert.ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`); }

// ---- 작업361: 풍선 6색 시트 ----
test('풍선 시트: 6칸 모두 몸통 가운데가 칸 가운데(±1 그림 px)에 맞고 폭이 같으며, 원본은 균일 격자에서 좌우로 치우쳐 있었다', () => {
  const r = REPORT.balloons;
  assert.deepEqual(r.size, [r.cell[0] * 6, r.cell[1]]); assert.equal(r.balloons.length, 6);
  for (const b of r.balloons) {
    assert.ok(Math.abs(b.center_x - r.cell[0] / 2) <= 1, `${b.name} 가운데 x ${b.center_x}`);
    assert.equal(b.center_y, r.anchor_y, b.name + ' 가운데 y');
    assert.ok(b.body_h > b.body_w, b.name + ' 몸통은 세로로 긴 타원');
    assert.ok(b.body_w >= 87 && b.body_w <= 104, `${b.name} 몸통 폭 ${b.body_w}(그림 px) = 논리 ${b.body_w / 2}: 타일 폭 43.5 이상 52 이하`);
    assert.ok(Math.abs(b.knot_x - b.center_x) <= 3, b.name + ' 매듭이 몸통 아래 가운데');
  }
  assert.ok(Math.max(...r.balloons.map(b => b.body_w)) - Math.min(...r.balloons.map(b => b.body_w)) <= 2, '여섯 풍선 몸통 폭이 같다');
  // 원본: 1열은 오른쪽(+), 3열은 왼쪽(-)으로 약 30px 치우쳐 있었다(측정값)
  const o = r.source_center_offset_x;
  assert.ok(o[0] > 25 && o[3] > 25 && o[2] < -25 && o[5] < -25 && Math.abs(o[1]) < 5 && Math.abs(o[4]) < 5, JSON.stringify(o));
});
test('풍선 시트: 가장자리 색 번짐이 크게 줄고(원본 기준), 투명 잔여 0, 코드 상수(logic.js BALLOON_ART)와 같다', () => {
  const r = REPORT.balloons, B = L.BALLOON_ART;
  assert.ok(r.bleed.before > 1000 && r.bleed.after <= r.bleed.before * 0.05, JSON.stringify(r.bleed));
  assert.equal(r.low_alpha_pixels, 0);
  assert.equal(B.URL, '/img/spellrun/' + r.file); assert.deepEqual([B.SHEET_W, B.SHEET_H], r.size); assert.deepEqual([B.CELL_W, B.CELL_H], r.cell);
  assert.equal(B.ANCHOR_Y, r.anchor_y); assert.equal(B.BODY_W * B.PX, r.balloons[0].body_w); assert.equal(B.BODY_H * B.PX, r.balloons[0].body_h);
  assert.equal(B.KNOT_DY * B.PX, r.balloons[0].knot_y - r.anchor_y); assert.equal(B.BOTTOM_DY * B.PX, r.balloons[0].bottom - r.anchor_y);
  assert.deepEqual(B.NAMES, r.names); assert.ok(B.BODY_W >= 43.5 && B.BODY_W <= 52);
});
