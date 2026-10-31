// 작업372: grabdx 주소 옵션 파싱(순수 로직). 가로 풍선을 그리는 오른쪽 이동(px), 기본 10, 0~40 으로 맞춤(clamp), 숫자가 아니면 무시
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');

test('372-2) 정상값·경계값은 그대로, 범위 밖은 가까운 값(0~40)으로 맞춘다', () => {
  for (const [q, want] of [['36.75', 36.75], ['0', 0], ['40', 40], ['18', 18], ['12.5', 12.5], ['99', 40], ['-5', 0], ['40.1', 40], ['  7 ', 7]]) {
    assert.equal(L.parseOptions('?grabdx=' + encodeURIComponent(q)).values.grabdx, want, q);
  }
});

test('372-2) 숫자가 아니거나 비어 있으면 무시(기본 10 이 쓰인다)', () => {
  for (const q of ['abc', '', 'NaN', 'Infinity', '1e1', '1,5', '0x10']) {
    const r = L.parseOptions('?grabdx=' + encodeURIComponent(q));
    assert.equal(r.values.grabdx, undefined, q);
  }
  assert.equal(L.OPTION_RULES.grabdx.def, 10); assert.equal(L.LAND_GRAB_DX, 10);
});

test('372-2) 기본값이면 applied 에 안 나오고 다른 값이면 나온다("조정값 사용 중" 대상). 다른 옵션의 범위 밖 규칙(무시)은 그대로', () => {
  assert.deepEqual(L.parseOptions('?grabdx=10').applied, []);
  assert.deepEqual(L.parseOptions('?grabdx=0').applied, ['grabdx']);
  assert.deepEqual(L.parseOptions('?grabdx=99').applied, ['grabdx']);
  assert.equal(L.parseOptions('?hp=99').values.hp, undefined, 'hp 는 범위 밖이면 무시(맞춤 없음)');
  assert.equal(L.parseOptions('?pace=9').values.pace, undefined);
});

test('372-2) 저장값: 주소 없이 저장값을 쓰고(범위 밖은 맞춤, 숫자가 아니면 버림), 주소가 항목 단위로 이기며, reset=1 이면 지운다', () => {
  assert.equal(L.resolveOptions('', '{"grabdx":30}').values.grabdx, 30);
  assert.equal(L.resolveOptions('', '{"grabdx":55}').values.grabdx, 40);
  assert.equal(L.resolveOptions('', '{"grabdx":-9}').values.grabdx, 0);
  assert.equal(L.resolveOptions('', '{"grabdx":"7"}').values.grabdx, undefined);
  assert.equal(L.resolveOptions('?grabdx=3', '{"grabdx":30,"pace":1}').values.grabdx, 3);
  assert.deepEqual(L.resolveOptions('?grabdx=3', '{"pace":1}').save, { pace: 1, grabdx: 3 });
  const r = L.resolveOptions('?reset=1&grabdx=3', '{"grabdx":30}');
  assert.equal(r.reset, true); assert.deepEqual(r.values, {}); assert.equal(r.save, null);
});

test('372-1) 세로 값은 옵션과 무관: layoutFor 세로 GRAB_DX 0, 가로 기본 10', () => {
  assert.equal(L.layoutFor('port', 360, 640).GRAB_DX, 0);
  assert.equal(L.layoutFor('land', 800, 400).GRAB_DX, 10);
});
