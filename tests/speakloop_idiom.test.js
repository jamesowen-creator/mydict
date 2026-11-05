// 작업401: 이디엄 세션 순수 함수 — 받아쓰기 비교, 세션 구성, 상태.
// 실행: node --test tests/speakloop_idiom.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/speakloop/core.js');

test('받아쓰기 단어 정규화: 소문자, 문장부호 제거, 하이픈은 공백, ’‘ 는 아포스트로피, 가장자리 따옴표 제거', () => {
  assert.deepEqual(C.normWords('Hang-Out!'), ['hang', 'out']);
  assert.deepEqual(C.normWords('I’m  down.'), ["i'm", 'down']);
  assert.deepEqual(C.normWords("'quoted' words,"), ['quoted', 'words']);
  assert.deepEqual(C.normWords('up-in-the-air'), ['up', 'in', 'the', 'air']);
  assert.deepEqual(C.normWords('  ?! '), []);
});
test('받아쓰기 비교: 대소문자·문장부호·하이픈·아포스트로피는 같은 답으로 본다', () => {
  for (const input of ['hang out', 'Hang Out.', 'hang-out', '  HANG   OUT!! ']) assert.equal(C.diffAnswer('hang out', input).allCorrect, true, input);
  assert.equal(C.diffAnswer("I'm down", 'I’m down').allCorrect, true);
  assert.equal(C.diffAnswer('up-in-the-air', 'up in the air').allCorrect, true);
  assert.equal(C.diffAnswer('hang out', 'hang').allCorrect, false);
});
test('받아쓰기 비교: 놓친 단어는 정답의 표시 단위로 표시하고, LCS 로 맞춘다', () => {
  assert.deepEqual(C.diffAnswer('figure out', 'figure').tokens, [{ text: 'figure', missed: false }, { text: 'out', missed: true }]);
  const d = C.diffAnswer('get back to', 'get to');
  assert.deepEqual(d.tokens.map(t => t.missed), [false, true, false]);
  assert.equal(d.missedCount, 1);
  const e = C.diffAnswer('touch base', 'touch bass');
  assert.deepEqual(e.tokens.map(t => t.missed), [false, true]);
  assert.equal(e.extra, 1, '정답에 없는 입력 단어 수');
  assert.deepEqual(C.diffAnswer('no big deal', 'xyz').tokens.map(t => t.missed), [true, true, true]);
  assert.equal(C.diffAnswer('hang out', 'hang out please').allCorrect, false, '군더더기가 있으면 모두 맞은 것이 아니다');
  assert.equal(C.diffAnswer('up-in-the-air', 'up the air').tokens[0].missed, true, '하이픈 단위 안에서 놓치면 그 표시 단위가 표시된다');
});

const ids = Array.from({ length: 20 }, (_, i) => 'i' + i);
const rows = o => Object.fromEntries(Object.entries(o).map(([id, r]) => [id, { count: 1, last_rating: r }]));
test('세션 구성: 복습 = 마지막 평가 hard, 신규 = 기록 없음 중 콘텐츠 순서 최대 5, 인출 = 복습+신규(섞음)', () => {
  const p = C.sessionPlan(ids, rows({ i0: 'some', i1: 'hard', i2: 'good', i3: 'hard' }));
  assert.deepEqual(p.review, ['i1', 'i3']);
  assert.deepEqual(p.fresh, ['i4', 'i5', 'i6', 'i7', 'i8']);
  assert.equal(p.learned, 4);
  assert.deepEqual([...p.retrieval].sort(), [...p.review, ...p.fresh].sort());
  assert.equal(p.retrieval.length, 7);
});
test('세션 구성: 섞는 순서는 주어진 난수에 따르고 항목은 바뀌지 않는다. 기록이 count 0 이면 신규', () => {
  const a = C.sessionPlan(ids, {}, () => 0), b = C.sessionPlan(ids, {}, () => 0.999);
  assert.deepEqual([...a.retrieval].sort(), [...b.retrieval].sort());
  assert.notDeepEqual(a.retrieval, b.retrieval);
  assert.equal(C.sessionPlan(['x'], { x: { count: 0, last_rating: null } }).fresh.length, 1);
});
test('세션 구성: 모두 배웠으면 신규·복습 0, 인출 전용은 배운 것 중 최대 10개(중복 없음)', () => {
  const all = Object.fromEntries(ids.map(id => [id, 'good']));
  const p = C.sessionPlan(ids, rows(all));
  assert.deepEqual([p.review.length, p.fresh.length, p.learned], [0, 0, 20]);
  assert.equal(p.practice.length, 10);
  assert.equal(new Set(p.practice).size, 10);
  assert.ok(p.practice.every(id => ids.includes(id)));
  assert.equal(C.sessionPlan(ids.slice(0, 3), rows({ i0: 'good', i1: 'good', i2: 'some' })).practice.length, 3);
});
test('이디엄 상태: 기록 없음 = 안 배움, hard = 막힘, 그 밖 = 학습', () => {
  assert.equal(C.idiomStatus(undefined), 'new');
  assert.equal(C.idiomStatus({ count: 1, last_rating: 'some' }), 'learned');
  assert.equal(C.idiomStatus({ count: 3, last_rating: 'good' }), 'learned');
  assert.equal(C.idiomStatus({ count: 2, last_rating: 'hard' }), 'hard');
});
