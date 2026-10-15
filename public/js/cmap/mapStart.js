// 작업283-2: 하단 내비 [지도 만들기] 탭 → [만들기] 첫 화면. "이 주제의 저장된 개념 체크 목록 + 주 버튼([이 개념으로 지도 만들기] / [지도 열기] / [선택한 개념으로 지도 열기])".
// 클래식 스크립트(window.CmapStart). concept_map.html 의 인라인 전역($, h)과 window.CmapMap(mapView.js: info, applySelection, openSheet, on), window.CmapNav 를 호출 시점에 쓴다.
// 지도에 개념을 올리고 내리는 일은 mapView.js 의 pickNode(시트 안 [개념 선택]과 같은 함수)가 한다 — 여기서는 새 규칙을 만들지 않는다
// (연결이 있는 노드를 내릴 때의 확인 창, 저장 상태 표시 변경, 배치 처리 모두 시트 안 [개념 선택]과 같다).
(function () {
  'use strict';
  const St = { sel: new Set(), busy: false, note: '', saving: false };
  const M = () => window.CmapMap;

  const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  function syncFromMap() { St.sel = new Set(M().info().nodeIds); }

  // 285-1: 지도에 개념이 있을 때 상태 줄(#map-meta, mapView 가 갱신) 옆에 [지도 저장] — 저장 안 됨·저장 후 변경됨일 때만 활성. 저장은 mapView 의 save() 하나를 쓴다
  function syncSave() {
    const b = $('map-save-out');
    if (!b) return;
    const info = M().info(), st = info.status && info.status.save_status;
    b.hidden = !info.nodeIds.length;
    b.disabled = St.saving || !(st === 'unsaved' || st === 'changed');
    b.textContent = St.saving ? '저장하는 중…' : '지도 저장';
  }
  async function saveOut() {
    if (St.saving) return;
    St.saving = true; $('map-page-note').textContent = ''; syncSave();
    const r = await M().save();
    St.saving = false;
    $('map-page-note').textContent = r.ok ? '' : '지도를 저장하지 못했어요. ' + (r.error || '');
    syncSave();
  }

  function render() {
    const box = $('map-start');
    if (!box) return;
    syncSave();
    box.textContent = '';
    const info = M().info();
    if (!info.loaded) return;
    if (!info.concepts.length) {
      box.append(
        h('p', { class: 'hint', id: 'start-empty', text: '저장된 개념이 없어요. 먼저 개념을 추가해 주세요' }),
        h('div', { class: 'map-open-row' }, h('button', { class: 'btn', type: 'button', id: 'map-go-topic', text: '주제로 가기', onclick: () => window.CmapNav.openTopic(window.CmapNav.currentTopicId()) })));
      return;
    }
    const cur = new Set(info.nodeIds), hasMap = cur.size > 0, changed = !sameSet(St.sel, cur);
    box.append(h('div', { class: 'sec-head' }, h('p', { class: 'sec-label', text: '지도에 넣을 개념' }), h('span', { class: 'hint', id: 'start-count', style: 'margin-top:0', 'aria-live': 'polite', text: St.sel.size + '개 선택' })));
    // 주제 경로별로 묶어서(시트 안 [개념 선택]과 같은 순서) 체크 목록
    const kids = pid => info.topics.filter(t => (t.parent_id === undefined ? null : t.parent_id) === pid).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const byTopic = new Map();
    for (const c of info.concepts) { if (!byTopic.has(c.topic_id)) byTopic.set(c.topic_id, []); byTopic.get(c.topic_id).push(c); }
    const list = h('div', { id: 'start-list' });
    const walk = (pid, path) => {
      for (const t of kids(pid)) {
        const p = path.concat(t.title), items = byTopic.get(t.id) || [];
        if (items.length) {
          list.append(h('p', { class: 'sec-label pick-topic', text: p.join(' › ') }));
          for (const c of items) {
            const cb = h('input', { type: 'checkbox', id: 'start-pick-' + c.id, 'data-t': 'start-pick', 'data-id': c.id });
            cb.checked = St.sel.has(c.id);
            cb.disabled = St.busy;
            cb.addEventListener('change', () => { if (cb.checked) St.sel.add(c.id); else St.sel.delete(c.id); St.note = ''; render(); });
            list.append(h('label', { class: 'pick-row', for: 'start-pick-' + c.id }, cb, h('span', { class: 'pick-term', text: c.term }), c.english ? h('span', { class: 'pick-en', text: c.english }) : null));
          }
        }
        walk(t.id, p);
      }
    };
    walk(null, []);
    box.append(list);
    const tooFew = (!hasMap || changed) && St.sel.size < 2;
    const label = St.busy ? '여는 중…' : !hasMap ? '이 개념으로 지도 만들기' : changed ? '선택한 개념으로 지도 열기' : '지도 열기';
    if (tooFew) box.append(h('p', { class: 'hint', id: 'start-hint', text: '개념을 2개 이상 선택해 주세요' }));
    if (St.note) box.append(h('p', { class: 'msg', role: 'alert', id: 'start-note', text: St.note }));
    box.append(h('div', { class: 'map-open-row' }, h('button', { class: 'btn', type: 'button', id: 'map-open', disabled: tooFew || St.busy, text: label, onclick: go })));
  }

  async function go() {
    if (St.busy) return;
    St.busy = true; St.note = ''; render();
    let ok = false;
    try { ok = await M().applySelection([...St.sel]); } catch (e) { console.error(e); }
    St.busy = false;
    syncFromMap();
    if (ok) { render(); M().openSheet(); return; }
    St.note = '선택한 개념을 지도에 올리지 못했어요. 지도 화면에서 확인해 주세요.';
    render();
  }

  function init() {
    const m = M();
    if ($('map-save-out')) $('map-save-out').addEventListener('click', saveOut);
    m.on('open', () => { St.busy = false; St.note = ''; syncFromMap(); render(); });
    m.on('status', () => { if (!St.busy) render(); });
    m.on('sheetclose', () => {
      syncFromMap(); render();
      const b = $('map-open');                                    // 시트를 닫으면 포커스가 주 버튼으로 돌아온다(다시 그려진 새 버튼에)
      if (b && !b.disabled && m._state().mode === 'map') { try { b.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    });
    m.on('close', () => { $('map-start').textContent = ''; });
  }
  window.CmapStart = { init, render, _state: () => ({ sel: [...St.sel].sort((a, b) => a - b), busy: St.busy }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
