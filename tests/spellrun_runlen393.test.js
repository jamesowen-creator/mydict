// 작업393: 달리기 걸음 주기 기본 배율 — 여학생·남학생 세로 0.65 / 가로 0.8, 펭귄 1.0. runlen 을 주면 모든 캐릭터·방향에 그 값.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');

const cfgWith = q => L.buildConfig(L.parseOptions(q).values);
const { girl, boy, penguin } = L.CHARS;
const near = (a, b) => Math.abs(a - b) < 1e-12;

test('393-1) 주소 없음: 여학생·남학생 세로 0.65, 가로 0.8, 펭귄은 세로·가로 모두 1.0', () => {
  const C = L.buildConfig({}), one = cfgWith('?runlen=1');
  for (const v of [101, 169, 267, 364]) {
    for (const P of [girl, boy]) {
      assert.ok(near(L.runFrameLength(v, C, P, false), L.runFrameLength(v, one, P) * 0.65), P.key + ' 세로 ' + v);
      assert.ok(near(L.runFrameLength(v, C, P, true), L.runFrameLength(v, one, P) * 0.8), P.key + ' 가로 ' + v);
    }
    assert.equal(L.runFrameLength(v, C, penguin, false), L.runFrameLength(v, one, penguin));
    assert.equal(L.runFrameLength(v, C, penguin, true), L.runFrameLength(v, one, penguin));
  }
  assert.equal(L.runFrameLength(169, C), L.runFrameLength(169, one), '캐릭터 인자가 없으면 펭귄');
});

test('393-2) runlen 을 주면 캐릭터·방향과 상관없이 지정값이 우선한다', () => {
  for (const r of [0.5, 0.65, 1, 1.3]) {
    const C = cfgWith('?runlen=' + r), one = cfgWith('?runlen=1');
    for (const P of [girl, boy, penguin]) for (const land of [false, true]) for (const v of [101, 169, 364])
      assert.ok(near(L.runFrameLength(v, C, P, land), L.runFrameLength(v, one, P) * r), P.key + ' ' + land + ' ' + v + ' ' + r);
  }
});

test('393-3) runlen=1.0 은 이전 식과 정확히 같다(방향·캐릭터 무관), 저장값도 지정으로 본다', () => {
  const one = cfgWith('?runlen=1');
  for (const P of [penguin, girl, boy]) for (const land of [false, true]) for (let v = 20; v <= 500; v += 7) {
    const old = Math.max(P.RUN_LEN_MIN, Math.min(P.RUN_LEN_MAX, P.RUN_LEN * one.SPEED_MIN / Math.max(1, v)));
    assert.equal(L.runFrameLength(v, one, P, land), old, P.key + ' ' + land + ' ' + v);
  }
  const saved = L.buildConfig(L.resolveOptions('', '{"runlen":0.9}').values);
  assert.equal(saved.RUN_LEN_SCALE, 0.9);
  assert.ok(near(L.runFrameLength(169, saved, girl, false), L.runFrameLength(169, one, girl) * 0.9));
});

test('393-4) 위상: land 인자가 advanceRunPhase 까지 전해진다', () => {
  const C = L.buildConfig({});
  const a = L.advanceRunPhase(0, 0.01, 169, C, girl, false), b = L.advanceRunPhase(0, 0.01, 169, C, girl, true);
  assert.ok(near(a, 0.01 / L.runFrameLength(169, C, girl, false)) && near(b, 0.01 / L.runFrameLength(169, C, girl, true)) && a > b);
});

test('393-3 값) 기본 배율의 프레임 길이(ms)와 한 바퀴 땅 거리(px) 출력', () => {
  const C = L.buildConfig({}); const rows = [];
  for (const P of [girl, boy, penguin]) for (const land of [false, true]) for (const v of [169, 364]) {
    const len = L.runFrameLength(v, C, P, land);
    rows.push(`${P.key} ${land ? '가로' : '세로'} v${v}: ${(len * 1000).toFixed(2)}ms 한바퀴 ${(len * P.RUN_FRAMES * v).toFixed(1)}px${len < 1 / 60 ? ' [<16.7ms]' : ''}`);
  }
  console.log(rows.join('\n'));
});
