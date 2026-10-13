// 작업272-3: OCR 터치 모드 선택 목록의 순수 함수(pickList.js) — 추가·중복(대소문자 무시)·상한 20·위아래 이동 경계·삭제. 브라우저 없음.
// 실행: node --test tests/ocr_picklist.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ocr', 'pickList.js')).toString('base64'));

test('추가: 담긴 순서대로, 앞뒤 공백 제거, 빈 단어는 거부, 원본 배열은 바뀌지 않음', async () => {
  const { addPick } = await load();
  const base = ['apple'];
  let r = addPick(base, '  Banana ');
  assert.deepEqual(r, { list: ['apple', 'Banana'], status: 'added' });
  assert.deepEqual(base, ['apple'], '원본 불변');
  for (const w of ['', '   ', null, undefined]) assert.equal(addPick(base, w).status, 'invalid');
  assert.equal(addPick(base, '').list, base);
});

test('중복: 대소문자를 무시하고 이미 담긴 단어는 추가하지 않는다', async () => {
  const { addPick, hasPick } = await load();
  const l = ['Apple', 'banana'];
  for (const w of ['apple', 'APPLE', ' Apple ', 'Banana']) {
    const r = addPick(l, w);
    assert.equal(r.status, 'duplicate', w); assert.equal(r.list, l);
  }
  assert.equal(hasPick(l, 'aPPle'), true); assert.equal(hasPick(l, 'cherry'), false); assert.equal(hasPick(l, ''), false); assert.equal(hasPick([], 'x'), false);
});

test('상한 20: 20개까지 담기고 21번째는 full, 중복은 가득 찬 상태에서도 duplicate', async () => {
  const { addPick, MAX_PICKS } = await load();
  assert.equal(MAX_PICKS, 20);
  let list = [];
  for (let i = 0; i < 20; i++) { const r = addPick(list, 'word' + i); assert.equal(r.status, 'added', '#' + i); list = r.list; }
  assert.equal(list.length, 20);
  const r = addPick(list, 'extra');
  assert.equal(r.status, 'full'); assert.equal(r.list, list); assert.equal(r.list.length, 20);
  assert.equal(addPick(list, 'WORD3').status, 'duplicate');
  assert.equal(addPick(list, 'extra', 21).status, 'added', '상한 인자');
});

test('위/아래 이동: 경계에서는 그대로, 한 칸씩 자리를 바꾸고, 원본은 바뀌지 않음', async () => {
  const { movePick } = await load();
  const l = ['a', 'b', 'c'];
  assert.deepEqual(movePick(l, 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(movePick(l, 1, 1), ['a', 'c', 'b']);
  assert.equal(movePick(l, 0, -1), l, '맨 위에서 위로 = 그대로');
  assert.equal(movePick(l, 2, 1), l, '맨 아래에서 아래로 = 그대로');
  assert.deepEqual(movePick(l, 0, 2), ['c', 'b', 'a'], '여러 칸');
  for (const [i, d] of [[3, -1], [-1, 1], [1, 0], [0.5, 1], [1, 0.5], [NaN, 1]]) assert.equal(movePick(l, i, d), l, `잘못된 인자 ${i},${d}`);
  assert.deepEqual(l, ['a', 'b', 'c']);
  assert.deepEqual(movePick(['x'], 0, 1), ['x']);
  assert.deepEqual(movePick([], 0, 1), []);
});

test('삭제: 그 항목만 지우고 순서 유지, 범위 밖·잘못된 인덱스는 그대로', async () => {
  const { removePick } = await load();
  const l = ['a', 'b', 'c'];
  assert.deepEqual(removePick(l, 0), ['b', 'c']);
  assert.deepEqual(removePick(l, 1), ['a', 'c']);
  assert.deepEqual(removePick(l, 2), ['a', 'b']);
  for (const i of [3, -1, 1.5, NaN, undefined]) assert.equal(removePick(l, i), l);
  assert.deepEqual(removePick(['x'], 0), []);
  assert.deepEqual(l, ['a', 'b', 'c']);
});
