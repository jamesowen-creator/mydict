// 작업275-4: "모르는 개념" 표시와 간략 설명 팝업의 상태 전이(순수 함수, DOM·서버 없음). 읽기 전용 지도 시트에서 개념을 클릭할 때의 규칙이 이 한 곳에만 있다.
//   state = { marked: 표시된 개념 id 배열(또는 Set), popupId: 팝업이 열린 개념 id | null }
//   clickConcept(state, id) → { marked: Set, popupId, change: { id, marked } | null }   (change = 서버에 알릴 표시 변경, 없으면 null)
//   closePopup(state)       → 같은 모양(팝업만 닫음, 표시는 그대로)
// 규칙:
//   · 팝업이 열려 있고 같은 개념을 다시 클릭 → 팝업만 닫힘(표시 유지)
//   · 팝업이 열려 있는데 다른 개념을 클릭 → 열린 팝업은 닫고, 그 클릭은 새 개념에 대해 아래 규칙을 적용한다
//   · 팝업 없음 + 표시 없음 → 팝업이 열리고 표시됨
//   · 팝업 없음 + 표시됨 → 표시 해제(팝업 없음)
// 클래식 스크립트(window.CmapMarkState)이면서 Node 테스트에서는 require 로 불러올 수 있다.
(function (root) {
  'use strict';
  const toSet = m => new Set(m instanceof Set ? [...m] : (m || []));

  function clickConcept(state, id) {
    const marked = toSet(state.marked);
    let popupId = state.popupId === undefined ? null : state.popupId;
    if (popupId !== null && popupId === id) return { marked, popupId: null, change: null };   // 같은 개념 재클릭 → 팝업만 닫힘
    popupId = null;                                                                            // 다른 개념을 눌렀으면 열려 있던 팝업은 먼저 닫는다
    if (!marked.has(id)) { marked.add(id); return { marked, popupId: id, change: { id, marked: true } }; }
    marked.delete(id);
    return { marked, popupId: null, change: { id, marked: false } };
  }

  function closePopup(state) { return { marked: toSet(state.marked), popupId: null, change: null }; }

  const api = { clickConcept, closePopup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CmapMarkState = api;
})(typeof window !== 'undefined' ? window : globalThis);
