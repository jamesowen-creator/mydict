// 작업425: 스펠링 런 결과 화면 별(starsFor)·신기록(updateBest) 순수 함수 시험(브라우저 없음).
// 실행: node --test tests/spellrun_result425.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');
const { starsFor, updateBest, bestKey } = L;

test('425 starsFor: 완성 비율 0.5 미만 0개, 0.5 이상 1개, 모두 완성 2개', () => {
  assert.equal(starsFor({ done: 4, total: 10, firstTry: 4 }), 0, '0.4');
  assert.equal(starsFor({ done: 49, total: 100, firstTry: 49 }), 0, '0.49');
  assert.equal(starsFor({ done: 5, total: 10, firstTry: 0 }), 1, '0.5');
  assert.equal(starsFor({ done: 9, total: 10, firstTry: 9 }), 1, '0.9 는 아직 모두 완성이 아니다');
  assert.equal(starsFor({ done: 10, total: 10, firstTry: 0 }), 2, '1.0');
  assert.equal(starsFor({ done: 3, total: 5, firstTry: 3 }), 1);
});

test('425 starsFor: 모두 완성 + 한 번에 완성 80% 이상이면 3개(79%는 2개)', () => {
  assert.equal(starsFor({ done: 10, total: 10, firstTry: 8 }), 3, '80%');
  assert.equal(starsFor({ done: 10, total: 10, firstTry: 7 }), 2, '70%');
  assert.equal(starsFor({ done: 100, total: 100, firstTry: 80 }), 3, '80/100');
  assert.equal(starsFor({ done: 100, total: 100, firstTry: 79 }), 2, '79/100');
  assert.equal(starsFor({ done: 5, total: 5, firstTry: 4 }), 3, '4/5 = 80%');
  assert.equal(starsFor({ done: 5, total: 5, firstTry: 3 }), 2, '3/5 = 60%');
  assert.equal(starsFor({ done: 10, total: 10, firstTry: 10 }), 3);
  assert.equal(starsFor({ done: 6, total: 10, firstTry: 6 }), 1, '모두 완성이 아니면 한 번에 완성이 많아도 1개');
});

test('425 starsFor: 단어 0개·이상한 입력은 0개, 푼 수가 전체보다 커도 3개를 넘지 않는다', () => {
  assert.equal(starsFor({ done: 0, total: 0, firstTry: 0 }), 0);
  assert.equal(starsFor({ done: 3, total: 0, firstTry: 3 }), 0);
  assert.equal(starsFor({ done: 0, total: 10, firstTry: 0 }), 0);
  assert.equal(starsFor(), 0);
  assert.equal(starsFor({ done: NaN, total: 10, firstTry: 1 }), 0);
  assert.equal(starsFor({ done: 12, total: 10, firstTry: 10 }), 3);
});

test('425 updateBest: 첫 기록은 저장만(신기록 아님), 더 높으면 신기록, 동점·낮으면 그대로', () => {
  let r = updateBest({}, 'basic|p|10', 1200);
  assert.deepEqual([r.isNew, r.best, r.prev], [false, 1200, null]); assert.deepEqual(r.store, { 'basic|p|10': 1200 });
  r = updateBest(r.store, 'basic|p|10', 1500);
  assert.deepEqual([r.isNew, r.best, r.prev], [true, 1500, 1200]); assert.equal(r.store['basic|p|10'], 1500);
  r = updateBest(r.store, 'basic|p|10', 1500);
  assert.deepEqual([r.isNew, r.best, r.prev], [false, 1500, 1500], '동점');
  r = updateBest(r.store, 'basic|p|10', 900);
  assert.deepEqual([r.isNew, r.best], [false, 1500]); assert.equal(r.store['basic|p|10'], 1500, '낮은 점수는 기록을 낮추지 않는다');
});

test('425 updateBest: 키가 분리된다(화면·단어 수) 그리고 받은 store 를 바꾸지 않는다', () => {
  const s0 = { 'basic|p|10': 1000 };
  const r = updateBest(s0, 'basic|l|10', 400);
  assert.equal(r.prev, null, '가로 기록은 세로 기록과 별개'); assert.deepEqual(r.store, { 'basic|p|10': 1000, 'basic|l|10': 400 });
  assert.deepEqual(s0, { 'basic|p|10': 1000 }, '원본 불변');
  assert.equal(updateBest(s0, 'basic|p|7', 50).prev, null, '단어 수가 다르면 별개');
  assert.equal(bestKey('basic', 'land', 10), 'basic|l|10'); assert.equal(bestKey('basic', 'port', 7), 'basic|p|7');
});

test('425 updateBest: 깨진 저장값은 무시하고 새로 시작한다', () => {
  for (const bad of [null, undefined, 'x', 5, [], [1, 2], { 'basic|p|10': 'abc' }, { 'basic|p|10': NaN }, { 'basic|p|10': -5 }, { 'basic|p|10': null }]) {
    const r = updateBest(bad, 'basic|p|10', 700);
    assert.deepEqual([r.isNew, r.best, r.prev], [false, 700, null], JSON.stringify(bad));
    assert.equal(r.store['basic|p|10'], 700);
  }
  const keep = updateBest({ a: 3, 'basic|p|10': 'zzz' }, 'basic|p|10', 10);
  assert.equal(keep.store.a, 3, '멀쩡한 다른 키는 유지');
  const r = updateBest({}, 'k', NaN); assert.equal(r.isNew, false); assert.deepEqual(r.store, {}, '점수가 숫자가 아니면 저장하지 않는다');
});

test('425 updateBest: 예외를 던지지 않는다(이상한 store·점수)', () => {
  assert.doesNotThrow(() => updateBest(Object.create(null), 'k', 1));
  assert.doesNotThrow(() => updateBest({ get x() { return 1; } }, 'k', '12'));
  assert.equal(updateBest({}, 'k', '12').best, 12);
});
