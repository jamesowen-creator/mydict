// 작업390: runlen 주소 옵션(달리기 걸음 주기 배율). 순수 로직. 기본 1.0 은 이전과 완전히 같고, 0.4~1.5 로 맞추며 숫자가 아니면 무시한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');

const cfgWith = q => L.buildConfig(L.parseOptions(q).values);
const girl = L.CHARS.girl, penguin = L.CHARS.penguin;

test('390-1) 옵션 파싱: 정상값·경계값은 그대로, 범위 밖은 가까운 값(0.4~1.5), 숫자가 아니면 무시', () => {
  for (const [q, want] of [['1', 1], ['0.5', 0.5], ['0.4', 0.4], ['1.5', 1.5], ['0.65', 0.65], ['9', 1.5], ['0', 0.4], ['-3', 0.4], ['1.6', 1.5], ['  0.8 ', 0.8]]) {
    assert.equal(L.parseOptions('?runlen=' + encodeURIComponent(q)).values.runlen, want, q);
  }
  for (const q of ['abc', '', 'NaN', 'Infinity', '1e1', '1,5', '0x10']) assert.equal(L.parseOptions('?runlen=' + encodeURIComponent(q)).values.runlen, undefined, q);
  assert.equal(L.OPTION_RULES.runlen.def, 1);
});

test('390-2) 기본값이면 applied 에 안 나오고 다른 값이면 나온다. reset=1 은 저장값을 지운다. 저장값은 주소 값이 없을 때 쓰인다', () => {
  assert.deepEqual(L.parseOptions('?runlen=1').applied, []);
  assert.deepEqual(L.parseOptions('?runlen=0.8').applied, ['runlen']);
  assert.equal(L.resolveOptions('', '{"runlen":0.65}').values.runlen, 0.65);
  assert.deepEqual(L.resolveOptions('', '{"runlen":0.65}').applied, ['runlen']);
  assert.deepEqual(L.resolveOptions('?reset=1', '{"runlen":0.65}').values, {});
  assert.deepEqual(L.resolveOptions('?runlen=0.8', '').save, { runlen: 0.8 });
});

test('390-3) runlen 1.0(또는 없음)이면 프레임 길이·위상이 이전과 완전히 같다', () => {
  const base = L.buildConfig({}), one = cfgWith('?runlen=1');
  assert.equal(base.RUN_LEN_SCALE, 1); assert.equal(one.RUN_LEN_SCALE, 1);
  for (const P of [penguin, girl, L.CHARS.boy]) for (let v = 20; v <= 500; v += 7) {
    const old = Math.max(P.RUN_LEN_MIN, Math.min(P.RUN_LEN_MAX, P.RUN_LEN * base.SPEED_MIN / Math.max(1, v)));   // 390 이전 식
    assert.equal(L.runFrameLength(v, base, P), old, P.key + ' ' + v);
    assert.equal(L.runFrameLength(v, one, P), old);
  }
  assert.equal(L.runFrameLength(169), L.runFrameLength(169, undefined, undefined));   // 인자가 없어도 동작
  assert.equal(L.advanceRunPhase(1.3, 1 / 60, 220, base, girl), L.advanceRunPhase(1.3, 1 / 60, 220, one, girl));
});

test('390-4) runlen 0.5: 프레임 길이와 한 바퀴 땅 거리가 절반(하한·상한도 같이 절반이라 모든 속도에서)', () => {
  const base = L.buildConfig({}), half = cfgWith('?runlen=0.5');
  for (const P of [penguin, girl, L.CHARS.boy]) for (const v of [101, 169, 267, 364]) {
    const a = L.runFrameLength(v, base, P), b = L.runFrameLength(v, half, P);
    assert.ok(Math.abs(b - a / 2) < 1e-12, P.key + ' ' + v + ' ' + a + ' ' + b);
    assert.ok(Math.abs(b * P.RUN_FRAMES * v - a * P.RUN_FRAMES * v / 2) < 1e-9, '한 바퀴 땅 거리');
  }
  // 하한: 364 에서 0.03(사람)·0.06(펭귄)의 절반으로 걸린다
  assert.ok(Math.abs(L.runFrameLength(364, half, girl) - 0.015) < 1e-12);
  assert.ok(Math.abs(L.runFrameLength(364, half, penguin) - 0.03) < 1e-12);
});

test('390-5) 위상은 속도가 바뀌어도 이어지고 0~RUN_FRAMES 안에 있다(runlen 0.4 / 1.5)', () => {
  for (const q of ['?runlen=0.4', '?runlen=1.5']) {
    const c = cfgWith(q); let ph = 0;
    for (let i = 0; i < 600; i++) { const p2 = L.advanceRunPhase(ph, 1 / 60, 101 + (i % 264), c, girl); assert.ok(p2 >= 0 && p2 < girl.RUN_FRAMES); ph = p2; }
  }
});
