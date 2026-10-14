// 작업275-4: "모르는 개념" 표시·팝업 상태 전이(순수 함수) — 클릭 표의 모든 경우.
// 실행: node --test tests/cmap_marks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const MS = require('../public/js/cmap/markState.js');

const st = (marked = [], popupId = null) => ({ marked, popupId });
const out = r => ({ marked: [...r.marked].sort((a, b) => a - b), popupId: r.popupId, change: r.change });

test('표시 없음 + 팝업 없음 → 클릭하면 팝업이 열리고 표시된다(서버에 표시 알림)', () => {
  assert.deepEqual(out(MS.clickConcept(st([]), 1)), { marked: [1], popupId: 1, change: { id: 1, marked: true } });
});

test('표시됨 + 팝업 열림 → 같은 개념 재클릭은 팝업만 닫힘(표시 유지, 서버 알림 없음)', () => {
  assert.deepEqual(out(MS.clickConcept(st([1], 1), 1)), { marked: [1], popupId: null, change: null });
});

test('표시됨 + 팝업 없음 → 클릭하면 표시 해제(팝업 없음, 서버에 해제 알림)', () => {
  assert.deepEqual(out(MS.clickConcept(st([1], null), 1)), { marked: [], popupId: null, change: { id: 1, marked: false } });
});

test('팝업 밖 클릭(closePopup): 팝업만 닫히고 표시는 그대로', () => {
  assert.deepEqual(out(MS.closePopup(st([1, 2], 1))), { marked: [1, 2], popupId: null, change: null });
  assert.deepEqual(out(MS.closePopup(st([], null))), { marked: [], popupId: null, change: null });
});

test('팝업이 열린 상태에서 다른 개념 클릭: 열린 팝업은 닫고 그 클릭은 새 개념에 규칙을 적용 — 표시 없으면 새 팝업 + 표시', () => {
  assert.deepEqual(out(MS.clickConcept(st([1], 1), 2)), { marked: [1, 2], popupId: 2, change: { id: 2, marked: true } });
});

test('팝업이 열린 상태에서 이미 표시된 다른 개념 클릭: 열린 팝업은 닫히고 그 개념은 표시 해제(팝업 없음)', () => {
  assert.deepEqual(out(MS.clickConcept(st([1, 2], 1), 2)), { marked: [1], popupId: null, change: { id: 2, marked: false } });
});

test('연속 클릭 시나리오: 표시 → 팝업 닫기 → 해제 → 다시 표시', () => {
  let s = st([]);
  const step = id => { const r = MS.clickConcept(s, id); s = { marked: r.marked, popupId: r.popupId }; return out(r); };
  assert.deepEqual(step(5), { marked: [5], popupId: 5, change: { id: 5, marked: true } });
  assert.deepEqual(step(5), { marked: [5], popupId: null, change: null });
  assert.deepEqual(step(5), { marked: [], popupId: null, change: { id: 5, marked: false } });
  assert.deepEqual(step(5), { marked: [5], popupId: 5, change: { id: 5, marked: true } });
});

test('입력 상태를 바꾸지 않는다(배열·Set 모두 받고 새 Set 을 돌려줌)', () => {
  const marked = [1, 2], s = { marked, popupId: null };
  const r = MS.clickConcept(s, 3);
  assert.deepEqual(marked, [1, 2]); assert.ok(r.marked instanceof Set); assert.deepEqual([...r.marked].sort(), [1, 2, 3]);
  const set = new Set([7]);
  MS.clickConcept({ marked: set, popupId: null }, 7);
  assert.deepEqual([...set], [7]);
  assert.deepEqual(out(MS.clickConcept({ marked: undefined, popupId: undefined }, 4)), { marked: [4], popupId: 4, change: { id: 4, marked: true } });
});
