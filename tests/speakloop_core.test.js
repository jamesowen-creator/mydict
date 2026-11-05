// 작업399: Speak Loop 화면 순수 함수 — 억양 화살표·가리기 6단계·밑줄 표시·쌓아가기/쉐도잉 계획.
// 실행: node --test tests/speakloop_core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/speakloop/core.js');

test('억양 화살표: "." ↘, "?" ↗, "," 와 문장부호 없음은 없음', () => {
  assert.equal(C.arrowOf('about two weeks.'), '↘');
  assert.equal(C.arrowOf('Is it ready?'), '↗');
  assert.equal(C.arrowOf('So,'), '');
  assert.equal(C.arrowOf('the launch got pushed back'), '');
  assert.equal(C.arrowOf('Really?  '), '↗');
});

const chunks = [{ en: 'The thing is,', k: 'x' }, { en: 'the client changed' }, { en: 'a few requirements' }, { en: 'late in the game.', k: 'y' }, { en: 'okay' }];
test('가리기 6단계: 어떤 구가 가려지는지', () => {
  const f = s => C.hiddenFlags(s, chunks);
  assert.deepEqual(f(0), [false, false, false, false, false], '전체 보기');
  assert.deepEqual(f(1), [true, false, false, true, false], '표현 구(k 있는 구)');
  assert.deepEqual(f(2), [true, false, true, false, true], '1·3·5구');
  assert.deepEqual(f(3), [false, true, false, true, false], '2·4구');
  assert.deepEqual(f(4), [false, true, true, true, true], '첫 구만 보임');
  assert.deepEqual(f(5), [true, true, true, true, true], '한국어만');
  assert.equal(C.STAGES.length, 6);
  assert.equal(C.hiddenFlags(2, chunks.slice(0, 3)).length, 3);
});

test('가린 구: 단어마다 첫 글자만 보이고 나머지는 밑줄(단어당 최대 6개), 끝 문장부호는 유지', () => {
  assert.equal(C.maskChunk('the client changed'), 't__ c_____ c______');
  assert.equal(C.maskChunk('a few requirements'), 'a f__ r______');   // requirements(12자)는 밑줄 6개까지만
  assert.equal(C.maskChunk('late in the game.'), 'l___ i_ t__ g___.');
  assert.equal(C.maskChunk('So,'), 'S_,');
  assert.equal(C.maskWord('extraordinarily'), 'e______');
  assert.equal(C.maskWord('I'), 'I');
  assert.equal(C.maskChunk('  two   words '), 't__ w____');
});

test('쌓아가기 계획: 구1, 구1+2, … 마다 (들은 총 길이 × 1.2) 쉬고, 마지막은 문장 전체 1회(그 뒤 쉬지 않음)', () => {
  const plan = C.buildupPlan([1, 2, 1.5]);   // 초
  assert.deepEqual(plan, [
    { type: 'chunks', from: 0, to: 1, gap: 0.1 }, { type: 'rest', seconds: 1.2 },
    { type: 'chunks', from: 0, to: 2, gap: 0.1 }, { type: 'rest', seconds: 3.72 },   // (1 + 0.1 + 2) × 1.2
    { type: 'chunks', from: 0, to: 3, gap: 0.1 },                                    // 마지막 구 묶음 뒤에는 쉬지 않고 곧바로 문장 전체
    { type: 'sentence' },
  ]);
});

test('쌓아가기 계획: 구 3·4·5개 모두 구 묶음 n개 + 쉬는 시간 n-1개 + 문장 1개, 마지막 묶음은 모든 구', () => {
  for (const n of [3, 4, 5]) {
    const plan = C.buildupPlan(Array.from({ length: n }, () => 1));
    assert.equal(plan.filter(s => s.type === 'chunks').length, n);
    assert.equal(plan.filter(s => s.type === 'rest').length, n - 1);
    assert.equal(plan.filter(s => s.type === 'sentence').length, 1);
    assert.deepEqual(plan.filter(s => s.type === 'chunks').map(s => s.to), Array.from({ length: n }, (_, i) => i + 1));
    assert.equal(plan[plan.length - 1].type, 'sentence');
    assert.equal(plan[plan.length - 2].type, 'chunks');
  }
});

test('쉐도잉 계획: (문장 재생 → 길이×1.2 쉬기) 3번, 횟수 번호 포함', () => {
  const plan = C.shadowPlan(2.5, 3);
  assert.deepEqual(plan.map(s => s.type), ['sentence', 'rest', 'sentence', 'rest', 'sentence', 'rest']);
  assert.deepEqual(plan.filter(s => s.type === 'rest').map(s => s.seconds), [3, 3, 3]);
  assert.deepEqual(plan.map(s => s.round), [1, 1, 2, 2, 3, 3]);
});
