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

test('투명 잔여(불투명도 1~8) 0, 잘린 동작 없음, 발끝 기준선 차이 2px 이하, 캐릭터 시트는 펭귄과 같은 형식', () => {
  for (const k of KEYS) assert.equal(REPORT[k].low_alpha_pixels, 0, k + ' 투명 잔여');
  for (const k of ['girl', 'boy']) {
    const r = REPORT[k];
    assert.deepEqual(r.size, [1728, 288]); assert.equal(r.cell, 288);
    assert.ok(r.foot_spread <= 2, k + ' 발끝 차이 ' + r.foot_spread); assert.deepEqual(r.clipped_frames, [], k + ' 잘린 동작');
    assert.equal(r.foot_y.length, 6); assert.ok(r.foot_y.every(y => y === 280), '발끝 y 280 = 칸 아래에서 8px(펭귄과 같다)');
    assert.ok(Math.max(...r.frame_heights) <= 249 + 1, '가장 큰 동작이 펭귄의 가장 큰 동작 높이 이하: ' + Math.max(...r.frame_heights));
  }
  assert.deepEqual([L.CHARS.girl.SHEET_W, L.CHARS.girl.SHEET_H, L.CHARS.girl.CELL, L.CHARS.girl.size], [1728, 288, 288, 92]);
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

// ---- 작업359: 여학생·남학생 달리기 4동작 교체(다리가 고정돼 보이던 문제) ----
// 358 의 달리기 4동작은 모두 같은 도약 자세라 다리가 고정된 채 미끄러져 보였다. 벌림 → 듦 → 벌림 → 듦 이 되도록 새 그림으로 바꿨다. 이 시험은 같은 문제가 다시 생기지 않게 막는다.
const RUN_KEYS = ['girl', 'boy'];

test('달리기 4동작: 다리 모양이 이웃 동작끼리 크게 다르다(0↔1, 1↔2, 2↔3, 3↔0 모두 0.6 이상) — 모두 같은 자세로 돌아가는 것을 막는다', () => {
  for (const k of RUN_KEYS) {
    const d = REPORT[k].run.after.leg_diff;
    for (const pair of ['0-1', '1-2', '2-3', '3-0']) assert.ok(d[pair] >= 0.6, `${k} 다리 차이 ${pair} = ${d[pair]}`);
    assert.ok(d['0-2'] < d['0-1'] && d['1-3'] < d['1-2'], k + ' 같은 종류(0·2, 1·3)끼리는 이웃보다 비슷하다');
  }
});

test('달리기 4동작: 발끝 기준선 280(차이 2px 이하)·몸 크기(머리 크기) 점프와 비슷·얼굴 가로 차이 6px 이하', () => {
  for (const k of RUN_KEYS) {
    const r = REPORT[k].run, a = r.after;
    assert.ok(Math.max(...a.foot_y) - Math.min(...a.foot_y) <= 2, k + ' 발끝 차이'); assert.ok(a.foot_y.every(y => y === 280), k + ' 발끝 280');
    assert.ok(Math.max(...a.face_x) - Math.min(...a.face_x) <= 6, k + ' 얼굴 가로 ' + a.face_x);
    const jump = a.head[5];   // 점프 하강(점프 상승은 올린 팔이 머리카락을 가려 크기를 못 잼)
    for (let i = 0; i < 4; i++) assert.ok(a.head[i] / jump >= 0.88 && a.head[i] / jump <= 1.12, `${k} ${i}번 칸 머리 크기 ${a.head[i]} (점프 ${jump})`);
    assert.ok(Math.max(...a.head.slice(0, 4)) / Math.min(...a.head.slice(0, 4)) <= 1.1, k + ' 달리기 4동작끼리 머리 크기');
    assert.ok(Math.max(...a.heights) <= 250, k + ' 달리기 동작 높이가 펭귄의 가장 큰 동작 이하');
  }
});

test('달리기 4동작 수치가 결과 파일과 같다(보고만 믿지 않고 PNG 에서 다시 잼, Python 이 있을 때)', () => {
  const py = ['python', 'py'].find(c => spawnSync(c, ['-c', 'import PIL, numpy'], { stdio: 'ignore' }).status === 0);
  if (!py) return;
  const code = 'import sys,json,importlib.util,numpy as np\nfrom PIL import Image\n' +
    'sp=importlib.util.spec_from_file_location("b",sys.argv[1]);b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)\n' +
    'print(json.dumps({k:b.run_measure(np.array(Image.open(sys.argv[2]+"/spellrun_"+k+"_sheet.png").convert("RGBA"))) for k in ["girl","boy"]}))';
  const r = spawnSync(py, ['-I', '-c', code, path.join(ROOT, 'scripts', 'spellrun_art_build.py'), IMG], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  for (const k of RUN_KEYS) assert.deepEqual(m[k], REPORT[k].run.after, k + ' 다시 잰 수치');
});

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
