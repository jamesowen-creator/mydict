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
const KEYS = ['day_far', 'day_mid', 'clouds', 'boss_sky', 'boss_far', 'boss_near', 'obstacles', 'items', 'girl', 'boy'];

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
