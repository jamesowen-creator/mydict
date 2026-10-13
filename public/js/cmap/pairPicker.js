// 작업273-2: "노드 A 탭 → 노드 B 탭" 짝 고르기 상태 기계(DOM 없음). 273-2 의 지도 연결 입력과 273-5 의 연결 퀴즈 입력이 함께 쓴다.
//   const picker = CmapPairPicker.create({ onFirst(id), onPair(a, b), onCancel(id) });
//   picker.tap(id)  → 처음 누르면 A 선택(onFirst), 같은 노드를 다시 누르면 취소(onCancel), 다른 노드를 누르면 짝 완성(onPair(a, b)) 후 처음 상태로
//   picker.reset()  → 선택 중이면 취소(onCancel), picker.first → 지금 고른 첫 노드 id(없으면 null)
// 클래식 스크립트(window.CmapPairPicker)이면서 Node 테스트에서는 require 로 불러올 수 있다.
(function (root) {
  'use strict';
  function create(handlers) {
    const h = handlers || {};
    let first = null;
    return {
      get first() { return first; },
      tap(id) {
        if (id === null || id === undefined) return { state: 'ignored' };
        if (first === null) { first = id; if (h.onFirst) h.onFirst(id); return { state: 'first', id }; }
        if (first === id) { first = null; if (h.onCancel) h.onCancel(id); return { state: 'cancel', id }; }
        const a = first;
        first = null;
        if (h.onPair) h.onPair(a, id);
        return { state: 'pair', from: a, to: id };
      },
      reset() {
        if (first === null) return false;
        const f = first;
        first = null;
        if (h.onCancel) h.onCancel(f);
        return true;
      },
    };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CmapPairPicker = api;
})(typeof window !== 'undefined' ? window : globalThis);
