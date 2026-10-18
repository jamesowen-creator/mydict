// 작업273-2: 개념 지도 화면의 "지도" 보기 — 지도에 쓸 개념 선택, 노드 드래그 배치, 노드 A 탭 → B 탭 연결, 연결 수정·삭제.
// 클래식 스크립트(window.CmapMap). concept_map.html 의 인라인 스크립트가 먼저 정의한 전역($, h, api, okStatus, errText, openDlg, closeDlg, openConfirm, S, byId, ...)과
// 공용 /js/map/mapCore.js 의 읽기 전용 도구(sv, clipText; 선 경로는 290-1부터 /js/cmap/edgeRoute.js), /js/cmap/mapGeometry.js·pairPicker.js 를 호출 시점에 사용한다(공용 코드는 수정하지 않음).
// 280-1: 화면 전환(주제 목록 / 주제 안 / 퀴즈 / 지도 만들기 / 오답노트)은 concept_map.html 의 Nav 가 맡는다. open·close 는 데이터와 모드만 다룬다.
  // 274-4: 지도는 페이지 안의 작은 캔버스가 아니라 <dialog id="map-sheet"> 안에 크게 그린다(모바일 = 전체 화면 시트, 768px 이상 = 큰 팝업). 열고 닫기·맞춤·확대/축소는 개념학습의 지도 팝업 방식을 따랐다.
// 모든 연결은 사용자가 직접 만든다(AI 제안 없음). 제스처: 노드 위 드래그 = 노드 이동(끝나면 위치 저장), 빈 곳 드래그 = 화면 이동, 두 손가락 = 확대·축소, 노드 탭 = 연결용 선택.
(function () {
  'use strict';
  const G = window.CmapGeometry, PP = window.CmapPairPicker, MS = window.CmapMarkState, ER = window.CmapEdgeRoute;
  const TAP_PX = 6;   // 이 거리(px) 안에서 손을 떼면 탭, 넘으면 드래그
  const READ_FLOOR = 12 / 13;          // 열 때 노드 글자가 화면에서 12px 이상이 되는 배율(개념학습의 MAP_READ_PX / MAP_FONT_UNITS 와 같음)
  const ZMIN = 0.05, ZMAX = 3;         // 확대·축소 한도(개념학습의 MAP_MIN_SCALE / MAP_MAX_SCALE 와 같음)
  const zclamp = s => Math.max(ZMIN, Math.min(ZMAX, s));
  const TYPE_HINT = {
    '': '관계 종류는 선택 사항이에요. 문구만 써도 됩니다.',
    '사용': '앞 개념이 뒤 개념을 쓰거나, 뒤 개념에 기대는 관계예요.',
    '일부': '앞 개념이 뒤 개념의 일부예요.',
    '종류': '앞 개념이 뒤 개념의 한 종류예요.',
    '일으킴': '앞 개념이 뒤 개념을 일으켜요. 어떻게 일으키는지(작동 방식)를 문구에 적어 주세요. 예: 마찰이 열을 일으킴',
    '구별': '헷갈리기 쉬운 두 개념이에요. 방향이 없어요.',
    '선행': 'A 다음에 B가 와요 (순서·단계)',
    '조건': 'A가 B의 전제·조건이에요',
    '유사': 'A와 B는 비슷해요 (방향 없음)',
    '대립': 'A와 B는 반대되거나 맞서요 (방향 없음)',
    '연관': 'A와 B는 관련 있어요 (방향 없음)',
  };
  // 286-1: 방향 없음 유형은 서버가 내려주는 목록(symmetric_types)을 따른다(열기 전 기본값은 4개)
  const SYM_DEFAULT = ['구별', '유사', '대립', '연관'];
  const isSym = t => (M.symTypes || SYM_DEFAULT).includes(t);
  const TYPE_LABEL = { '사용': '사용(의존)' };
  // 연결 대화상자·퀴즈 대화상자의 유형 select 를 서버 목록으로 채운다(한 곳에서 관리). 방향 없음 유형에는 "(방향 없음)"을 붙이고 묶음으로 나눈다
  function fillTypeSelects(types, sym) {
    for (const id of ['edge-type', 'quiz-type', 'bulk-type']) {
      const sel = $(id), keep = sel.value;
      sel.textContent = '';
      sel.append(h('option', { value: '', text: '선택 안 함' }));
      const g1 = h('optgroup', { label: '방향 있음' }), g2 = h('optgroup', { label: '방향 없음' });
      for (const t of types) (sym.includes(t) ? g2 : g1).append(h('option', { value: t, text: sym.includes(t) ? t + '(방향 없음)' : (TYPE_LABEL[t] || t) }));
      sel.append(g1, g2);
      sel.value = keep;
    }
  }

  const M = {
    rootId: null, map: null, nodes: new Map(), edges: [], concepts: new Map(), topics: [], types: [],
    temp: new Map(), view: { tx: 0, ty: 0, scale: 1 }, ptrs: new Map(), gest: null, pinch: null, selected: null, picker: null, svg: null, busy: false,
    sheet: { open: false, scrollY: 0, ignorePop: false }, needFit: false,
    marks: new Set(), serverMarks: new Set(), popup: null,   // 275-4: 모르는 개념 표시(화면 상태 / 서버가 확인해 준 상태), 팝업이 열린 개념 id
    mode: 'map', quiz: null, hl: new Set(), status: null, preview: null, undo: null,   // 작업273-3: 저장 상태 { current_hash, save_status }, 최적화 미리보기 { pos, metrics }, 되돌리기 { pos }
  };
  const listeners = { open: [], close: [], status: [], mode: [], quizpair: [], sheet: [], sheetclose: [] };   // 작업273-4: 해설 탭(narrateView.js)이 구독
  const emit = (ev, arg) => { for (const fn of listeners[ev]) { try { fn(arg); } catch (e) { console.error(e); } } };
  const isRo = () => M.mode === 'narr' || M.mode === 'review';        // 읽기 전용 시트: 개념을 누르면 간략 설명 팝업 + 모르는 개념 표시(편집 시트·퀴즈에서는 동작하지 않음)
  const locked = () => !!M.preview || M.mode !== 'map';              // 미리보기·해설 탭에서는 노드·연결을 건드릴 수 없고 화면 이동·확대만 된다
  let ED = null;   // 연결 대화상자 상태 { mode, edge, from, to, flips }

  const termOf = id => (M.concepts.get(id) ? M.concepts.get(id).term : '?');
  const typeLabel = t => (t ? t : '종류 없음');

  // ── 위치 ──
  const isPlaced = n => n && n.x !== null && n.x !== undefined && n.y !== null && n.y !== undefined;
  function posOf(id) {
    if (M.mode === 'quiz' && M.quiz && M.quiz.pos.has(id)) return M.quiz.pos.get(id);
    if (M.preview && M.preview.pos.has(id)) return M.preview.pos.get(id);
    const n = M.nodes.get(id);
    if (isPlaced(n)) return { x: n.x, y: n.y };
    return M.temp.get(id) || { x: 0, y: 0 };
  }
  function recomputeTemp() {
    const unplaced = [...M.nodes.keys()].filter(id => !isPlaced(M.nodes.get(id))).sort((a, b) => a - b);
    const placed = [...M.nodes.values()].filter(isPlaced).map(n => ({ x: n.x, y: n.y }));
    M.temp = G.tempGrid(unplaced, placed);
  }

  // ── 그리기 ──
  function render() {
    if (M.mode === 'quiz' && M.quiz) return renderQuiz();
    const svg = M.svg;
    svg.textContent = '';
    const defs = sv('defs', {}, sv('marker', { id: 'm-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, sv('path', { d: 'M0,0 L10,5 L0,10 z', class: 'm-arrow-path' })));
    const edgeLayer = sv('g', { class: 'm-edges' }), nodeLayer = sv('g', { class: 'm-nodes' });
    // 290-1: 선 경로는 개념 지도 전용 edgeRoute.js 가 한꺼번에 계산한다(접속면 선택·접속점 나누기·가로지름 회피·라벨 위치). 공용 mapCore.js 의 edgeGeom 은 쓰지 않는다
    const lblOf = e => clipText(e.display_label || e.label || '', 12);   // 286-1: 문구가 없으면 유형 이름(서버가 채운 display_label)
    const routes = ER.routeAll([...M.nodes.keys()].map(id => ({ id, x: posOf(id).x, y: posOf(id).y })), M.edges.map(e => ({ key: e.id, from: e.from_concept_id, to: e.to_concept_id, label: lblOf(e), type: e.relation_type })));   // 302-1: type 은 줄기 묶음 판정용
    for (const e of M.edges) {
      const a = M.nodes.get(e.from_concept_id), b = M.nodes.get(e.to_concept_id);
      if (!a || !b) continue;
      const geo = routes.get(e.id);
      const sym = isSym(e.relation_type);
      const lbl = lblOf(e);
      edgeLayer.append(sv('g', { class: 'm-edge' + (e.relation_type === '대립' ? ' m-edge-opp' : ''), 'data-edge': e.id, 'data-t': 'edge', role: 'button', tabindex: 0, 'aria-label': `${termOf(e.from_concept_id)}${sym ? '와 ' : ' → '}${termOf(e.to_concept_id)}: ${e.display_label || e.label} (${typeLabel(e.relation_type)}), 눌러서 고치기` },
        sv('path', { d: geo.hitD || geo.d, class: 'm-edge-hit' }),   // 302-1: 줄기에 묶인 연결은 갈래 구간만 눌린다(줄기 구간은 반응 없음)
        sv('path', { d: geo.d, class: 'm-edge-line', 'marker-end': sym ? null : 'url(#m-arrow)' }),
        sv('text', { x: geo.mx, y: geo.my - 4, class: 'm-edge-label', 'text-anchor': 'middle' }, geo.noLabel ? '' : lbl)));   // 줄기의 라벨은 묶음에서 한 번만
    }
    for (const id of M.nodes.keys()) {
      const p = posOf(id), n = M.nodes.get(id);
      const marked = isRo() && M.marks.has(id);
      nodeLayer.append(sv('g', { class: 'm-node' + (M.selected === id ? ' sel' : '') + (isPlaced(n) ? '' : ' temp') + (M.preview ? ' preview' : '') + (M.hl.size ? (M.hl.has(id) ? ' hl' : ' dim') : '') + (marked ? ' marked' : ''), 'data-node': id, 'data-t': 'node', transform: `translate(${p.x},${p.y})`, role: 'button', tabindex: 0, 'aria-label': termOf(id) + (M.selected === id ? ' (선택됨)' : '') + (marked ? ' (모르는 개념으로 표시됨)' : '') },
        sv('rect', { width: G.NODE_W, height: G.NODE_H, rx: 10 }),
        sv('text', { x: G.NODE_W / 2, y: G.NODE_H / 2 + 5, 'text-anchor': 'middle', class: 'm-node-text' }, clipText(termOf(id), 9)),
        marked ? sv('g', { class: 'm-mark' }, sv('circle', { cx: G.NODE_W - 4, cy: 4, r: 10 }), sv('text', { x: G.NODE_W - 4, y: 9, 'text-anchor': 'middle' }, '?')) : null));
    }
    svg.append(defs, edgeLayer, nodeLayer);
    applyView();
    renderHint();
    renderPdfBtn();
    $('map-count').textContent = '지도에 ' + M.nodes.size + '개 · 연결 ' + M.edges.length + '개';
    updateMeta();
  }
  // 페이지 본문의 한 줄 상태(개념 수 · 연결 수 · 저장 상태)
  function updateMeta() {
    const el = $('map-meta');
    if (!el) return;
    const st = M.status ? M.status.save_status : 'unsaved';
    // 283-2: 지도에 올라간 개념이 있을 때만 한 줄 상태("저장됨 · 개념 N개 · 연결 M개")를 보인다
    el.textContent = M.nodes.size ? (st === 'saved' ? '저장됨' : st === 'changed' ? '저장 후 변경됨' : '저장 안 됨') + ' · 개념 ' + M.nodes.size + '개 · 연결 ' + M.edges.length + '개' : '';
  }
  function applyView() {
    const r = M.svg.getBoundingClientRect();
    const cw = r.width || 1, ch = r.height || 1;
    M.svg.setAttribute('viewBox', `${M.view.tx} ${M.view.ty} ${cw / M.view.scale} ${ch / M.view.scale}`);
    placePopup();
  }

  // ── 간략 설명 팝업과 모르는 개념 표시(작업275-4) ──
  // 상태 전이는 markState.js(순수 함수)에 있다. 여기서는 화면 반영·서버 저장만 한다. 팝업은 이미 불러온 데이터(brief)만 쓰며 서버를 부르지 않는다.
  function renderPopup() {
    const el = $('map-popup');
    if (!M.sheet.open || M.popup === null || !isRo()) { el.hidden = true; return; }
    const c = M.concepts.get(M.popup);
    el.textContent = '';
    el.append(h('div', { class: 'p-term', text: c ? c.term : '?' }), h('div', { class: 'p-text', text: c && c.brief ? c.brief : '설명이 아직 없습니다' }), h('div', { class: 'p-note', text: '모르는 개념으로 표시했어요.' }));
    el.hidden = false;
    placePopup();
  }
  // 개념 근처(아래, 자리가 없으면 위)에 두고 캔버스 밖으로 나가지 않게 보정한다
  function placePopup() {
    const el = $('map-popup');
    if (!el || el.hidden || M.popup === null || !M.svg) return;
    const nd = M.svg.querySelector('[data-node="' + M.popup + '"] rect');
    if (!nd) return;
    const cv = $('map-canvas').getBoundingClientRect(), r = nd.getBoundingClientRect();
    const w = Math.max(120, Math.min(280, cv.width - 16));
    el.style.width = w + 'px';
    const ph = el.offsetHeight;
    let left = r.left + r.width / 2 - cv.left - w / 2;
    left = Math.max(8, Math.min(cv.width - w - 8, left));
    let top = r.bottom - cv.top + 8;
    if (top + ph > cv.height - 8) top = r.top - cv.top - ph - 8;
    top = Math.max(8, Math.min(cv.height - ph - 8, top));
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  function hidePopup() { M.popup = null; const el = $('map-popup'); if (el) el.hidden = true; }
  function closePopupOnly() {
    if (M.popup === null) return;
    const r = MS.closePopup({ marked: M.marks, popupId: M.popup });
    M.marks = r.marked; hidePopup();
  }
  function markClick(id) {
    const r = MS.clickConcept({ marked: M.marks, popupId: M.popup }, id);
    M.marks = r.marked; M.popup = r.popupId;
    render(); renderPopup();
    if (r.change) pushMark(r.change.id);
  }
  // 낙관적 갱신: 이미 화면에 반영했고, 서버에는 개념별로 한 번에 하나씩 보낸다(연타는 마지막 상태만 유효). 실패하면 서버가 확인해 준 상태로 되돌리고 안내한다
  const markInflight = new Set();
  async function pushMark(id) {
    if (markInflight.has(id)) return;
    markInflight.add(id);
    try {
      let sent;
      do {
        sent = M.marks.has(id);
        const r = await api('PUT', '/api/cmap/concepts/' + id + '/mark', { marked: sent });
        if (!okStatus(r)) {
          if (M.serverMarks.has(id)) M.marks.add(id); else M.marks.delete(id);
          if (M.popup === id) hidePopup();
          mapMsg('표시를 저장하지 못했어요. 원래대로 돌려놨어요.');
          render();
          return;
        }
        if (sent) M.serverMarks.add(id); else M.serverMarks.delete(id);
      } while (M.marks.has(id) !== sent);
    } finally { markInflight.delete(id); }
  }
  // 시트가 닫혀 있으면 크기를 알 수 없으므로 다음에 열 때 맞춘다(needFit). opts.open = 시트를 열 때: 전체가 들어오게 맞추되 글자가 너무 작아지면(READ_FLOOR 미만) 줄이지 않고 왼쪽 위부터 보여 준다(개념학습과 같음)
  function fit(opts) {
    if (!M.sheet.open) { M.needFit = true; return; }
    const r = M.svg.getBoundingClientRect();
    const pts = (M.mode === 'quiz' && M.quiz ? M.quiz.nodes.map(n => n.id) : [...M.nodes.keys()]).map(posOf);
    let v = { scale: 1, tx: 0, ty: 0 };
    if (pts.length && r.width > 0 && r.height > 0) {                  // 전체가 들어오는 배율(최대 1, 하한은 확대·축소와 같은 0.05). 개념학습의 [화면 맞춤]처럼 아주 큰 지도도 전체가 보인다
      const x0 = Math.min(...pts.map(p => p.x)) - 24, y0 = Math.min(...pts.map(p => p.y)) - 24;
      const x1 = Math.max(...pts.map(p => p.x + G.NODE_W)) + 24, y1 = Math.max(...pts.map(p => p.y + G.NODE_H)) + 24;
      const scale = zclamp(Math.min(1, r.width / (x1 - x0), r.height / (y1 - y0)));
      v = { scale, tx: (x0 + x1) / 2 - r.width / scale / 2, ty: (y0 + y1) / 2 - r.height / scale / 2 };
      if (opts && opts.open && scale < READ_FLOOR) v = { scale: READ_FLOOR, tx: x0 - 8 / READ_FLOOR, ty: y0 };
    }
    M.view = v;
    M.needFit = false;
    applyView();
  }
  // 새 노드가 지금 보이는 영역 밖에 놓이면 전체가 보이도록 맞춘다(보이는 노드는 사용자가 정한 확대·이동을 그대로 둔다)
  function ensureVisible(id) {
    const r = M.svg.getBoundingClientRect(), p = posOf(id);
    const x0 = M.view.tx, y0 = M.view.ty, x1 = x0 + r.width / M.view.scale, y1 = y0 + r.height / M.view.scale;
    if (p.x < x0 || p.y < y0 || p.x + G.NODE_W > x1 || p.y + G.NODE_H > y1) fit();
  }
  // 291-1: 편집 시트에서 첫 노드를 고르면 개념 이름 + 정의 한 줄(brief)을 안내 줄 위에 보인다. 이미 불러온 지도 응답의 brief 만 쓰고 표시(marks)는 건드리지 않는다
  const BRIEF_LINES = 2;
  function hideBrief() { M.briefId = null; const b = $('map-brief'); if (b) { b.hidden = true; b.textContent = ''; } }
  function renderBrief() {
    const el = $('map-brief');
    if (!el) return;
    if (!(M.sheet.open && M.mode === 'map' && !M.preview && M.selected !== null && M.briefId === M.selected)) { hideBrief(); return; }
    const c = M.concepts.get(M.selected);
    el.textContent = '';
    el.append(h('span', { class: 'b-term', text: termOf(M.selected) }), h('span', { class: 'b-text', text: c && c.brief ? c.brief : '설명이 아직 없습니다' }));
    el.style.setProperty('--brief-lines', BRIEF_LINES);
    el.hidden = false;
  }
  function renderHint() {
    renderBrief();
    const el = $('map-hint');
    if (M.preview || M.mode !== 'map') $('map-bulk-row').hidden = true;
    if (M.preview) { el.textContent = '미리보기예요. 마음에 들면 [적용], 아니면 [취소]를 눌러 주세요. 노드와 연결은 그대로이고 자리만 바뀌어요.'; return; }
    // 287-1: 편집 시트에서 노드 하나를 골라 두 번째를 기다리는 동안 [여러 개에 한 번에 연결]을 보인다(읽기 전용·퀴즈·미리보기에서는 보이지 않음)
    $('map-bulk-row').hidden = !(M.mode === 'map' && !M.preview && M.selected !== null && M.nodes.size >= 2);
    if (M.selected !== null) $('map-note').textContent = '';
    if (M.mode !== 'map') { el.textContent = ''; return; }
    if (!M.nodes.size) { el.textContent = '[개념 선택]에서 지도에 쓸 개념을 골라 보세요.'; return; }
    el.textContent = M.selected !== null
      ? '‘' + termOf(M.selected) + '’을(를) 골랐어요. 이어 줄 개념을 눌러 주세요. 같은 개념을 다시 누르면 취소돼요.'
      : '노드를 끌어 옮기고, 두 노드를 차례로 눌러 연결해요. 연결선을 누르면 고칠 수 있어요.';
  }
  // ── PDF 저장(작업292-1): 화면의 지도 그림만 A4 한 쪽 PDF 로. 지도 데이터·저장 상태는 바꾸지 않는다 ──
  let pdfBusy = false;
  function renderPdfBtn() {
    const b = $('map-pdf');
    if (!b) return;
    b.disabled = pdfBusy || !M.nodes.size;
    $('map-pdf-label').textContent = pdfBusy ? '만드는 중…' : 'PDF 저장';
    b.title = M.nodes.size ? '' : '지도에 개념을 올리면 저장할 수 있어요';
  }
  // 293-1: PDF 제목용 주제 경로(최상위 → 지금 보고 있는 주제). 지도 응답의 주제 목록(parent_id)으로 거슬러 올라가며, 최상위가 이 지도의 주제와 맞지 않으면 최상위 이름만 쓴다
  function topicNames() {
    const byTopic = new Map((M.topics || []).map(t => [t.id, t]));
    const root = byTopic.get(M.rootId), rootName = (root && root.title) || (M.map && M.map.title) || '지도';
    const cur = window.CmapNav && window.CmapNav.currentTopicId ? window.CmapNav.currentTopicId() : null;
    const chain = [];
    for (let t = byTopic.get(cur), n = 0; t && n < 20; t = t.parent_id === null || t.parent_id === undefined ? null : byTopic.get(t.parent_id), n++) chain.unshift(t);
    return chain.length && chain[0].id === M.rootId ? chain.map(t => t.title) : [rootName];
  }
  async function pdfSave() {
    if (pdfBusy || M.mode !== 'map' || !M.nodes.size || !window.CmapPdf) return;
    pdfBusy = true; renderPdfBtn(); mapMsg('');
    try {
      const names = topicNames();
      const now = new Date(), cvs = getComputedStyle($('map-canvas')), body = getComputedStyle(document.body);
      const r = await window.CmapPdf.make({ svg: M.svg, pts: [...M.nodes.keys()].map(posOf), nodeW: G.NODE_W, nodeH: G.NODE_H, names, date: window.CmapPdf.dateText(now, '-'), dateObj: now, background: cvs.backgroundColor, ink: body.color, fontFamily: body.fontFamily });
      await window.CmapPdf.deliver(r.blob, r.fileName);
    } catch (e) { mapMsg('PDF를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
    pdfBusy = false; renderPdfBtn();
  }
  const mapMsg = t => { $('map-msg').textContent = t || ''; if (!t) $('map-note').textContent = ''; };
  const mapNote = t => { $('map-note').textContent = t || ''; };
  const pageNote = t => { const el = $('map-page-note'); if (el) el.textContent = t || ''; };

  // ── 열기·닫기 ──
  async function open(rootId) {
    const r = await api('GET', '/api/cmap/topics/' + rootId + '/map');
    if (!okStatus(r)) { $('map-load-msg').textContent = errText(r, '지도를 불러오지 못했습니다.'); return false; }
    const b = r.body;
    M.rootId = rootId; M.map = b.map; M.types = b.relation_types || []; M.symTypes = b.symmetric_types || SYM_DEFAULT;
    fillTypeSelects(M.types, M.symTypes);
    M.concepts = new Map(b.concepts.map(c => [c.id, c]));
    M.topics = b.topics;
    M.nodes = new Map(b.nodes.map(n => [n.concept_id, { x: n.x, y: n.y }]));
    M.edges = b.edges;
    M.selected = null; M.briefId = null; M.gest = null; M.pinch = null; M.ptrs.clear();
    M.status = { current_hash: b.current_hash, save_status: b.save_status }; M.preview = null; M.undo = null; M.hl = new Set(); M.quiz = null;
    if (!M.picker) {
      M.picker = PP.create({
        onFirst: id => { M.selected = id; M.briefId = id; render(); },
        onCancel: () => { M.selected = null; render(); },
        onPair: (a, bb) => { M.selected = null; render(); if (M.mode === 'quiz') emit('quizpair', { a, b: bb }); else onPair(a, bb); },
      });
    } else M.picker.reset();
    M.marks = new Set(b.marked_concept_ids || []); M.serverMarks = new Set(M.marks); hidePopup();
    M.svg = $('map-svg');
    $('map-sheet-title').textContent = '지도 · ' + b.map.title;
    pageNote('');
    $('map-pick-panel').hidden = true;
    $('map-pick-toggle').setAttribute('aria-expanded', 'false');
    mapMsg('');
    recomputeTemp();
    bindSvgOnce();
    fit();
    render();
    renderPickPanel();
    renderSave(); renderOptUi();
    setMode('map', true);
    emit('open');
    return true;
  }
  function close() {
    if (M.sheet.open) closeSheetUi(false);
    M.preview = null; M.undo = null; M.hl = new Set(); M.quiz = null; setMode('map', true);
    emit('close');       // 화면을 떠나면 되돌리기는 사라진다
    if (M.picker) M.picker.reset();
    M.gest = null; M.pinch = null; M.ptrs.clear();
  }

  // ── 개념 선택 패널 ──
  function renderPickPanel() {
    const box = $('map-pick-list');
    box.textContent = '';
    const kids = pid => M.topics.filter(t => (t.parent_id === undefined ? null : t.parent_id) === pid).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const byConceptTopic = new Map();
    for (const c of M.concepts.values()) { if (!byConceptTopic.has(c.topic_id)) byConceptTopic.set(c.topic_id, []); byConceptTopic.get(c.topic_id).push(c); }
    let any = false;
    const walk = (pid, path) => {
      for (const t of kids(pid)) {
        const p = path.concat(t.title), list = byConceptTopic.get(t.id) || [];
        if (list.length) {
          any = true;
          box.append(h('p', { class: 'sec-label pick-topic', text: p.join(' › ') }));
          for (const c of list) {
            const cb = h('input', { type: 'checkbox', 'data-t': 'pick', 'data-id': c.id, id: 'pick-' + c.id });
            cb.checked = M.nodes.has(c.id);
            cb.addEventListener('change', () => togglePick(c.id, cb));
            box.append(h('label', { class: 'pick-row', for: 'pick-' + c.id }, cb, h('span', { class: 'pick-term', text: c.term }), c.english ? h('span', { class: 'pick-en', text: c.english }) : null));
          }
        }
        walk(t.id, p);
      }
    };
    walk(null, []);
    if (!any) box.append(h('p', { class: 'hint', text: '이 주제에는 아직 개념이 없어요. 주제·개념 화면에서 개념을 먼저 저장해 주세요.' }));
  }
  async function togglePick(cid, cb) {
    const want = cb.checked;
    cb.checked = !want;                       // 서버 결과를 받은 뒤에 화면을 바꾼다(취소·실패하면 그대로)
    await pickNode(cid, want);
  }
  // 283-2: 개념 하나를 지도에 올리거나(want=true) 내린다. 시트 안 [개념 선택]과 [만들기] 첫 화면의 [이 개념으로 지도 만들기]가 같은 이 함수를 쓴다.
  // 내릴 때 연결이 있으면 확인 창이 뜨고, 창이 닫히면(빼기·취소) 이 함수도 끝난다.
  async function pickNode(cid, want) {
    mapMsg('');
    if (want) {
      const r = await api('POST', '/api/cmap/maps/' + M.map.id + '/nodes', { concept_id: cid });
      if (!okStatus(r)) { mapMsg(errText(r)); return; }
      M.nodes.set(cid, { x: r.body.node.x, y: r.body.node.y });
      setStatus(r.body.status, true);
      recomputeTemp(); ensureVisible(cid); render(); renderPickPanel();
      return;
    }
    // 빼기: 연결이 있으면 서버가 409 + 개수를 알려 주고, 확인창 뒤에 confirm=1 로 지운다
    const probe = await api('DELETE', '/api/cmap/maps/' + M.map.id + '/nodes/' + cid);
    if (okStatus(probe)) { setStatus(probe.body.status, true); applyRemoval(cid); return; }
    if (probe.status === 409 && probe.body && probe.body.needs_confirm) {
      const n = (probe.body.counts && probe.body.counts.edges) || 0;
      openConfirm({
        heading: '지도에서 빼기',
        text: '‘' + termOf(cid) + '’ 개념을 지도에서 빼면 이 개념과 이어진 연결 ' + n + '개도 함께 지워집니다.\n개념 자체는 삭제되지 않아요.',
        okText: '빼기',
        action: async () => {
          const r = await api('DELETE', '/api/cmap/maps/' + M.map.id + '/nodes/' + cid + '?confirm=1');
          if (!okStatus(r)) return { failed: errText(r) };
          setStatus(r.body.status, true);
          applyRemoval(cid);
          return {};
        },
      });
      await new Promise(res => $('confirm-dlg').addEventListener('close', res, { once: true }));
      return;
    }
    mapMsg(errText(probe));
  }
  // 283-2: 선택한 개념 집합(ids)에 맞게 지도의 노드를 맞춘다(없는 것은 올리고, 선택에서 빠진 것은 내림). 하나라도 실패하거나 확인 창에서 취소하면 false
  async function applySelection(ids) {
    const want = new Set(ids);
    for (const id of ids) {
      if (M.nodes.has(id)) continue;
      await pickNode(id, true);
      if (!M.nodes.has(id)) return false;
    }
    for (const id of [...M.nodes.keys()]) {
      if (want.has(id)) continue;
      await pickNode(id, false);
      if (M.nodes.has(id)) return false;
    }
    return true;
  }
  function applyRemoval(cid) {
    M.nodes.delete(cid);
    M.edges = M.edges.filter(e => e.from_concept_id !== cid && e.to_concept_id !== cid);
    if (M.selected === cid && M.picker) M.picker.reset();
    recomputeTemp(); render(); renderPickPanel();
  }

  // ── 연결 만들기·고치기 ──
  function onPair(a, b) {
    const same = M.edges.find(e => (e.from_concept_id === a && e.to_concept_id === b) || (e.from_concept_id === b && e.to_concept_id === a));
    if (same) { mapMsg('이미 이어진 두 개념이에요. 기존 연결을 고쳐 보세요.'); openEdgeDialog('edit', { edge: same, from: same.from_concept_id, to: same.to_concept_id }); return; }
    mapMsg('');
    openEdgeDialog('create', { from: a, to: b });
  }
  function openEdgeDialog(mode, d) {
    hideBrief();
    ED = { mode, edge: d.edge || null, from: d.from, to: d.to, flips: 0 };
    $('edge-heading').textContent = mode === 'create' ? '연결 만들기' : '연결 고치기';
    $('edge-label').value = d.edge && d.edge.label ? d.edge.label : '';
    $('edge-type').value = d.edge && d.edge.relation_type ? d.edge.relation_type : '';
    $('edge-msg').textContent = '';
    $('edge-delete').hidden = mode !== 'edit';
    refreshEdgeDialog();
    openDlg($('edge-dlg'));
    $('edge-label').focus();
  }
  function refreshEdgeDialog() {
    const type = $('edge-type').value, sym = isSym(type);
    $('edge-pair').textContent = termOf(ED.from) + (sym ? ' ↔ ' : ' → ') + termOf(ED.to);
    $('edge-flip').disabled = sym;                       // 방향 없음 유형은 방향을 바꿀 수 없다
    $('edge-type-hint').textContent = TYPE_HINT[type] || TYPE_HINT[''];
    // 문구는 선택: 비우면 유형 이름이 선 위에 표시된다(유형을 고르면 그 이름으로 안내)
    $('edge-label-hint').textContent = type ? '비우면 ‘' + type + '’처럼 유형 이름이 표시돼요' : '비우면 유형 이름이 표시돼요. 유형을 고르거나 문구를 입력해 주세요';
  }
  function setupEdgeDialog() {
    $('edge-type').addEventListener('change', refreshEdgeDialog);
    $('edge-flip').addEventListener('click', () => { [ED.from, ED.to] = [ED.to, ED.from]; ED.flips++; refreshEdgeDialog(); });
    $('edge-cancel').addEventListener('click', () => closeDlg($('edge-dlg')));
    $('edge-delete').addEventListener('click', () => {
      const e = ED.edge;
      closeDlg($('edge-dlg'));
      openConfirm({
        heading: '연결 삭제', text: '‘' + termOf(e.from_concept_id) + '’ 와(과) ‘' + termOf(e.to_concept_id) + '’ 사이의 연결(' + (e.display_label || e.label || '') + ')을 삭제합니다.', okText: '삭제',
        action: async () => {
          const r = await api('DELETE', '/api/cmap/edges/' + e.id);
          if (!okStatus(r) && r.status !== 404) return { failed: errText(r) };
          if (okStatus(r)) setStatus(r.body.status, true);
          M.edges = M.edges.filter(x => x.id !== e.id);
          render();
          return {};
        },
      });
    });
    $('edge-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const label = $('edge-label').value.trim();
      const type = $('edge-type').value || null;
      if (!label && !type) { $('edge-msg').textContent = '유형을 고르거나 문구를 입력해 주세요.'; return; }   // 286-1: 문구는 선택이지만 둘 다 없는 연결은 만들 수 없다
      setBusy($('edge-ok'), true);
      let r;
      if (ED.mode === 'create') r = await api('POST', '/api/cmap/maps/' + M.map.id + '/edges', { from_concept_id: ED.from, to_concept_id: ED.to, label: label || null, relation_type: type });
      else { const body = { label: label || null, relation_type: type }; if (ED.flips % 2 === 1) body.reverse = true; r = await api('PATCH', '/api/cmap/edges/' + ED.edge.id, body); }
      setBusy($('edge-ok'), false);
      if (!okStatus(r)) { $('edge-msg').textContent = errText(r); return; }
      setStatus(r.body.status, true);
      if (ED.mode === 'create') M.edges.push(r.body.edge); else M.edges = M.edges.map(x => (x.id === r.body.edge.id ? r.body.edge : x));
      closeDlg($('edge-dlg'));
      render();
    });
  }

  // ── 1:n 한 번에 연결(작업287-1): 시작 개념 하나 + 대상 여러 개 + 유형·문구 한 번 → 서버 일괄 API 가 선 n개를 만든다 ──
  let BK = null;   // { from, linked: Set, sel: Set, busy }
  function openBulk() {
    if (M.selected === null || M.mode !== 'map' || M.preview || BK) return;
    hideBrief();
    const from = M.selected;
    const linked = new Set(M.edges.filter(e => e.from_concept_id === from || e.to_concept_id === from).map(e => (e.from_concept_id === from ? e.to_concept_id : e.from_concept_id)));
    BK = { from, linked, sel: new Set(), busy: false };
    $('bulk-from').textContent = termOf(from);
    const list = $('bulk-list');
    list.textContent = '';
    for (const id of [...M.nodes.keys()].filter(x => x !== from).sort((a, b) => termOf(a).localeCompare(termOf(b), 'ko'))) {
      const off = linked.has(id);
      const cb = h('input', { type: 'checkbox', id: 'bulk-pick-' + id, 'data-t': 'bulk-pick', 'data-id': id });
      cb.disabled = off;
      cb.addEventListener('change', () => { if (cb.checked) BK.sel.add(id); else BK.sel.delete(id); refreshBulk(); });
      list.append(h('label', { class: 'pick-row' + (off ? ' off' : ''), for: 'bulk-pick-' + id }, cb, h('span', { class: 'pick-term', text: termOf(id) }), off ? h('span', { class: 'pick-en', 'data-t': 'bulk-linked', text: '이미 연결됨' }) : null));
    }
    $('bulk-type').value = ''; $('bulk-label').value = ''; $('bulk-msg').textContent = '';
    refreshBulk();
    openDlg($('bulk-dlg'));
    $('bulk-type').focus();
  }
  function refreshBulk() {
    if (!BK) return;
    const n = BK.sel.size, type = $('bulk-type').value, label = $('bulk-label').value.trim();
    $('bulk-count').textContent = n + '개 선택';
    $('bulk-all').disabled = BK.busy;
    $('bulk-type-hint').textContent = TYPE_HINT[type] || TYPE_HINT[''];
    $('bulk-label-hint').textContent = type ? '비우면 ‘' + type + '’처럼 유형 이름이 표시돼요' : '비우면 유형 이름이 표시돼요. 유형을 고르거나 문구를 입력해 주세요';
    $('bulk-dir').textContent = isSym(type) ? '방향 없이 연결돼요' : '‘' + termOf(BK.from) + '’ → 선택한 개념들 방향으로 만들어져요';
    const needMore = n === 0 ? '연결할 개념을 하나 이상 골라 주세요' : (!type && !label) ? '유형을 고르거나 문구를 입력해 주세요' : '';
    $('bulk-hint').textContent = needMore;
    $('bulk-ok').disabled = BK.busy || !!needMore;
    $('bulk-ok').textContent = BK.busy ? '만드는 중…' : n ? '연결 ' + n + '개 만들기' : '연결 만들기';
    for (const cb of $('bulk-list').querySelectorAll('input')) if (!BK.linked.has(Number(cb.dataset.id))) cb.disabled = BK.busy;
  }
  function setupBulkDialog() {
    $('map-bulk-btn').addEventListener('click', openBulk);
    $('bulk-type').addEventListener('change', refreshBulk);
    $('bulk-label').addEventListener('input', refreshBulk);
    $('bulk-all').addEventListener('click', () => {
      if (!BK) return;
      for (const cb of $('bulk-list').querySelectorAll('input:not(:disabled)')) { cb.checked = true; BK.sel.add(Number(cb.dataset.id)); }
      refreshBulk();
    });
    $('bulk-cancel').addEventListener('click', () => closeDlg($('bulk-dlg')));
    $('bulk-dlg').addEventListener('close', () => { if (!BK || !BK.busy) BK = null; });
    $('bulk-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      if (!BK || BK.busy || $('bulk-ok').disabled) return;
      const type = $('bulk-type').value || null, label = $('bulk-label').value.trim();
      BK.busy = true; $('bulk-msg').textContent = ''; refreshBulk();
      const r = await api('POST', '/api/cmap/maps/' + M.map.id + '/edges/bulk', { from: BK.from, to_ids: [...BK.sel], relation_type: type, label: label || null });
      if (!BK) return;
      BK.busy = false;
      if (!okStatus(r)) { $('bulk-msg').textContent = errText(r, '연결을 만들지 못했어요.'); refreshBulk(); return; }   // 실패하면 입력 내용을 그대로 둔다
      for (const e of r.body.edges) M.edges.push(e);
      setStatus(r.body.status, true);
      const made = r.body.edges.length, skipped = r.body.skipped.length;
      BK = null;
      closeDlg($('bulk-dlg'));
      if (M.picker) M.picker.reset();
      M.selected = null;
      render();
      mapNote((made ? '연결 ' + made + '개를 만들었어요' : '새로 만든 연결이 없어요') + (skipped ? (made ? '. ' : ' · ') + skipped + '개는 이미 연결돼 있어 건너뛰었어요' : ''));
    });
  }

  // ── 저장 상태 · 배치 최적화(작업273-3) ──
  // 저장 상태는 서버가 계산한 값(save_status)만 표시한다. 클라이언트는 해시를 계산하지 않는다.
  function setStatus(st, semantic) {
    if (st) M.status = { current_hash: st.current_hash, save_status: st.save_status };
    if (semantic) { M.undo = null; renderOptUi(); }     // 노드·연결이 바뀌면 이전 배치로 되돌릴 수 없다
    renderSave();
    emit('status');
  }
  const fmtTime = iso => { const d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function renderSave() {
    const el = $('map-save-state'), st = M.status ? M.status.save_status : 'unsaved';
    el.classList.toggle('changed', st === 'changed');
    el.dataset.state = st;
    el.textContent = st === 'saved' ? '저장됨' + (M.map && M.map.saved_at ? ' · ' + fmtTime(M.map.saved_at) : '') : st === 'changed' ? '저장 후 변경됨' : '저장 안 됨';
    $('map-save').disabled = st === 'saved' || !!M.preview;
    updateMeta();
  }
  function renderOptUi() {
    $('map-opt-bar').hidden = !M.preview;
    $('map-undo').hidden = !M.undo || !!M.preview;
    $('map-opt').disabled = !!M.preview;
    if (M.preview) $('map-opt-info').textContent = (M.preview.metrics.layout === 'hierarchy' ? '위→아래 계층 · ' : '') + '연결선 교차 ' + M.preview.metrics.crossingsBefore + '개 → ' + M.preview.metrics.crossingsAfter + '개';
  }
  // 285-1: 저장은 이 함수 하나만 쓴다(시트 [저장], 만들기 화면 [지도 저장], 해설·퀴즈의 "저장하고 …"). 결과 { ok, error }. 저장 중 중복 호출은 거부한다
  async function save() {
    if (M.busy) return { ok: false, error: '저장하는 중이에요.' };
    if (!M.map) return { ok: false, error: '지도를 아직 읽지 못했어요.' };
    M.busy = true; mapMsg('');
    const r = await api('POST', '/api/cmap/maps/' + M.map.id + '/save');
    M.busy = false;
    if (!okStatus(r)) { const error = errText(r, '저장하지 못했어요.'); mapMsg(error); return { ok: false, error }; }
    M.map = r.body.map; setStatus(r.body.status, false);
    return { ok: true };
  }
  // 285-1: 시트 툴바의 [더보기] 목록(배치 최적화·되돌리기·확대·축소)
  function moreOpen() { return !$('map-more').hidden; }
  function setMore(on) {
    $('map-more').hidden = !on;
    $('map-more-toggle').setAttribute('aria-expanded', String(on));
    if (on) { const first = $('map-more').querySelector('button:not([hidden])'); if (first && getComputedStyle(first).display !== 'none') { try { first.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } } }
  }
  function optimize() {
    if (M.busy || M.preview) return;
    mapMsg('');
    if (M.nodes.size < 2) { mapMsg('노드가 2개 이상일 때 배치를 최적화할 수 있어요.'); return; }
    const L = window.CmapLayout, rect = M.svg.getBoundingClientRect();
    const ids = [...M.nodes.keys()].sort((a, b) => a - b);
    const nodes = ids.map(id => ({ id, x: posOf(id).x, y: posOf(id).y }));
    const res = L.optimizeLayout(nodes, M.edges.map(e => ({ from: e.from_concept_id, to: e.to_concept_id, type: e.relation_type || null, sym: isSym(e.relation_type) })), { bounds: L.suggestBounds(ids.length, rect.width / (rect.height || 1)) });
    if (!res.metrics.changed) { mapMsg('지금 배치가 이미 정리돼 있어요. 바꿀 것이 없어요.'); return; }
    if (M.picker) M.picker.reset();
    M.selected = null;
    M.preview = { pos: res.positions, before: new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }])), metrics: res.metrics };
    fit(); render(); renderSave(); renderOptUi();
  }
  function cancelPreview() {
    if (!M.preview) return;
    M.preview = null; fit(); render(); renderSave(); renderOptUi();
  }
  // 위치 일괄 저장(서버가 노드 집합·의미 해시를 검증). 성공하면 서버가 돌려준 위치를 화면에 반영한다.
  async function putPositions(posMap) {
    const positions = [...posMap].map(([id, p]) => ({ concept_id: id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
    const r = await api('PUT', '/api/cmap/maps/' + M.map.id + '/positions', { positions, base_hash: M.status.current_hash });
    if (okStatus(r)) { for (const p of r.body.positions) M.nodes.set(p.concept_id, { x: p.x, y: p.y }); setStatus(r.body.status, false); }
    return r;
  }
  async function applyPreview() {
    if (!M.preview || M.busy) return;
    M.busy = true; mapMsg('');
    const pv = M.preview, r = await putPositions(pv.pos);
    M.busy = false;
    M.preview = null;
    if (okStatus(r)) { M.undo = { pos: pv.before }; }
    else mapMsg(r.body && r.body.stale ? '그 사이 지도가 바뀌어 적용하지 않았어요. 지도를 다시 열어 주세요.' : errText(r, '배치를 적용하지 못했어요. 원래 배치 그대로예요.'));
    recomputeTemp(); fit(); render(); renderSave(); renderOptUi();
  }
  async function undoOptimize() {
    if (!M.undo || M.busy) return;
    M.busy = true; mapMsg('');
    const r = await putPositions(M.undo.pos);
    M.busy = false;
    if (okStatus(r)) M.undo = null; else mapMsg(r.body && r.body.stale ? '그 사이 지도가 바뀌어 되돌리지 않았어요.' : errText(r, '되돌리지 못했어요.'));
    recomputeTemp(); fit(); render(); renderSave(); renderOptUi();
  }

  // ── 연결 퀴즈 화면(작업273-5): 서버가 준 노드를 흩어 놓고 사용자가 이은 답을 그린다(정답 간선은 이 화면에 없다) ──
  function scatter(nodes) {
    const ids = nodes.map(n => n.id).sort((a, b) => a - b);
    let s = 7919 + ids.length * 31;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const pos = new Map();
    ids.forEach((id, i) => pos.set(id, { x: (i % 2) * (G.NODE_W + 60) + Math.floor(rnd() * 24), y: Math.floor(i / 2) * (G.NODE_H + 50) + Math.floor(rnd() * 16) }));
    return pos;
  }
  function renderQuiz() {
    const svg = M.svg, q = M.quiz;
    svg.textContent = '';
    const defs = sv('defs', {}, sv('marker', { id: 'm-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, sv('path', { d: 'M0,0 L10,5 L0,10 z', class: 'm-arrow-path' })));
    const edgeLayer = sv('g', { class: 'm-edges' }), nodeLayer = sv('g', { class: 'm-nodes' });
    const qRoutes = ER.routeAll(q.nodes.map(n => ({ id: n.id, x: posOf(n.id).x, y: posOf(n.id).y })), q.answers.map(a => ({ key: a.from + '-' + a.to, from: a.from, to: a.to, label: a.type ? a.type : '', type: a.type || null })));
    for (const a of q.answers) {
      const geo = qRoutes.get(a.from + '-' + a.to);
      edgeLayer.append(sv('g', { class: 'm-edge' + (a.type === '대립' ? ' m-edge-opp' : ''), 'data-answer': a.from + '-' + a.to },
        sv('path', { d: geo.d, class: 'm-edge-line', 'marker-end': isSym(a.type) ? null : 'url(#m-arrow)' }),
        sv('text', { x: geo.mx, y: geo.my - 4, class: 'm-edge-label', 'text-anchor': 'middle' }, geo.noLabel ? '' : (a.type ? a.type : ''))));
    }
    for (const n of q.nodes) {
      const p = posOf(n.id);
      // 275-5: 표시한 개념 퀴즈에서는 표시한 개념에 물음표 배지·표시 색을 둔다(색만으로 구분하지 않음). 전체 퀴즈의 노드에는 표시 정보가 없다
      nodeLayer.append(sv('g', { class: 'm-node' + (M.selected === n.id ? ' sel' : '') + (n.marked ? ' marked' : ''), 'data-node': n.id, 'data-t': 'node', transform: `translate(${p.x},${p.y})`, role: 'button', tabindex: 0, 'aria-label': n.term + (M.selected === n.id ? ' (선택됨)' : '') + (n.marked ? ' (표시한 개념)' : '') },
        sv('rect', { width: G.NODE_W, height: G.NODE_H, rx: 10 }),
        sv('text', { x: G.NODE_W / 2, y: G.NODE_H / 2 + 5, 'text-anchor': 'middle', class: 'm-node-text' }, clipText(n.term, 9)),
        n.marked ? sv('g', { class: 'm-mark' }, sv('circle', { cx: G.NODE_W - 4, cy: 4, r: 10 }), sv('text', { x: G.NODE_W - 4, y: 9, 'text-anchor': 'middle' }, '?')) : null));
    }
    svg.append(defs, edgeLayer, nodeLayer);
    applyView();
  }

  // ── 탭(지도 | 해설 | 복습)과 강조(작업273-4) ──
  function setMode(mode, silent) {
    if (M.mode === mode && !silent) return;
    if (mode !== 'map' && M.preview) cancelPreview();
    M.mode = mode;
    hidePopup();
    if (M.picker) M.picker.reset();
    M.selected = null; M.gest = null; M.pinch = null; M.ptrs.clear();
    const cl = $('map-view').classList;
    cl.toggle('side-mode', mode !== 'map');
    for (const m of ['narr', 'review', 'quiz']) cl.toggle(m + '-mode', mode === m);
    sheetLayout();
    for (const [id, m] of [['tab-map', 'map'], ['tab-narr', 'narr']]) { $(id).setAttribute('aria-selected', String(mode === m)); $(id).classList.toggle('sel', mode === m); }
    if (!silent) { if (M.svg) { render(); requestAnimationFrame(() => { fit(); render(); }); } emit('mode', mode); }
  }
  // 강조할 개념 목록. 시트가 열려 있으면 그 개념들이 보이도록 맞추고, 닫혀 있으면 다음에 열 때 맞춘다
  function fitHighlight() {
    if (!M.sheet.open || !M.nodes.size) return;
    if (M.hl.size) { const r = M.svg.getBoundingClientRect(); M.view = G.fitView([...M.hl].map(posOf), r.width, r.height); M.needFit = false; applyView(); } else fit();
  }
  function highlight(ids) {
    M.hl = new Set((ids || []).filter(id => M.nodes.has(id)));
    if (M.sheet.open) { fitHighlight(); render(); } else M.needFit = true;
  }

  // ── 지도 시트(작업274-4) ──
  // 열기: 배경 스크롤 잠금 + showModal + 브라우저 기록 한 칸(뒤로 가기로 닫기). 닫기: [닫기] · ESC · 뒤로 가기. 닫으면 선택·제스처·미리보기 상태를 정리하고 원래 스크롤 위치로 돌린다.
  function sheetLayout() {
    const d = $('map-sheet');
    d.classList.toggle('ro', M.mode === 'narr' || M.mode === 'review');   // 해설·복습에서 여는 시트는 읽기 전용(편집 도구 숨김)
    d.classList.toggle('quiz-mode', M.mode === 'quiz');
  }
  function openSheet() {
    if (M.sheet.open) return;
    if (!M.svg) { pageNote('지도를 아직 읽지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }   // 283-2: 조용히 넘기지 않고 안내한다
    M.sheet.open = true; M.sheet.scrollY = window.scrollY;
    document.documentElement.classList.add('map-open');
    sheetLayout();
    const d = $('map-sheet');
    try { if (!d.open) d.showModal(); } catch (e) { d.setAttribute('open', ''); }
    try { history.pushState({ metisCmapSheet: true }, ''); } catch (e) { /* 무시 */ }
    mapMsg('');
    fit({ open: true });
    if (M.hl.size) fitHighlight();
    render();
    emit('sheet', true);
  }
  function closeSheetUi(restore) {
    if (!M.sheet.open) return;
    M.sheet.open = false;
    hidePopup(); hideBrief();
    if (M.picker) M.picker.reset();
    M.selected = null; M.gest = null; M.pinch = null; M.ptrs.clear();
    $('map-pick-panel').hidden = true; $('map-pick-toggle').setAttribute('aria-expanded', 'false');
    for (const id of ['edge-dlg', 'quiz-dlg', 'bulk-dlg']) { const dl = $(id); if (dl && dl.open) closeDlg(dl); }
    setMore(false);
    const note = M.preview ? '배치 최적화 미리보기를 취소했어요. 노드와 연결은 그대로예요.' : '';
    if (M.preview) cancelPreview();
    const d = $('map-sheet');
    try { if (d.open) d.close(); } catch (e) { d.removeAttribute('open'); }
    document.documentElement.classList.remove('map-open');
    if (restore) window.scrollTo(0, M.sheet.scrollY);
    pageNote(note);
    const opener = $('map-open'); if (opener && M.mode === 'map') { try { opener.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    M.needFit = true;
    emit('sheetclose', { mode: M.mode });
  }
  function closeSheet() {
    if (!M.sheet.open) return;
    closeSheetUi(true);
    if (history.state && history.state.metisCmapSheet) { M.sheet.ignorePop = true; history.back(); }   // 우리가 쌓은 기록 한 칸을 되돌린다
  }
  function zoomBy(f) {
    if (!M.sheet.open) return;
    const r = M.svg.getBoundingClientRect();
    const cx = M.view.tx + r.width / M.view.scale / 2, cy = M.view.ty + r.height / M.view.scale / 2;
    M.view.scale = zclamp(M.view.scale * f);
    M.view.tx = cx - r.width / M.view.scale / 2; M.view.ty = cy - r.height / M.view.scale / 2;
    applyView();
  }

  // ── 제스처 ──
  let bound = false;
  function bindSvgOnce() {
    if (bound) return;
    bound = true;
    const svg = M.svg;
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onCancel);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      if (isRo()) { const rn = ev.target.closest && ev.target.closest('[data-node]'); if (rn) { ev.preventDefault(); markClick(Number(rn.dataset.node)); } return; }
      if (locked() && M.mode !== 'quiz') return;
      const nd = ev.target.closest && ev.target.closest('[data-node]'), ed = ev.target.closest && ev.target.closest('[data-edge]');
      if (nd) { ev.preventDefault(); M.picker.tap(Number(nd.dataset.node)); }
      else if (ed) { ev.preventDefault(); const e = M.edges.find(x => x.id === Number(ed.dataset.edge)); if (e) openEdgeDialog('edit', { edge: e, from: e.from_concept_id, to: e.to_concept_id }); }
    });
    $('map-sheet').addEventListener('pointerdown', ev => { if (M.popup !== null && !$('map-popup').contains(ev.target) && !M.svg.contains(ev.target)) closePopupOnly(); });   // 팝업·지도 밖(툴바 등)을 누르면 팝업만 닫는다
    $('map-fit').addEventListener('click', () => { fit(); });
    $('map-pdf').addEventListener('click', pdfSave);
    $('map-zoom-in').addEventListener('click', () => zoomBy(1.25));
    $('map-zoom-out').addEventListener('click', () => zoomBy(0.8));
    $('map-sheet-close').addEventListener('click', closeSheet);
    $('map-sheet').addEventListener('cancel', ev => { ev.preventDefault(); if (moreOpen()) { setMore(false); $('map-more-toggle').focus(); return; } closeSheet(); });   // ESC: 열린 [더보기]가 있으면 그것만 닫는다
    $('map-more-toggle').addEventListener('click', () => setMore(!moreOpen()));
    $('map-more').addEventListener('click', ev => { if (ev.target.closest('button')) setMore(false); });          // 항목을 누르면 목록이 닫힌다
    $('map-sheet').addEventListener('pointerdown', ev => { if (moreOpen() && !$('map-more').contains(ev.target) && !$('map-more-toggle').contains(ev.target)) setMore(false); });   // 바깥을 누르면 닫힌다
    window.addEventListener('popstate', () => {
      if (M.sheet.ignorePop) { M.sheet.ignorePop = false; return; }
      if (M.sheet.open) closeSheetUi(true);
    });
    if (window.ResizeObserver) {                                                              // 화면 회전·창 크기 변경: 너비가 바뀌면 다시 맞춘다
      let lastW = 0;
      new ResizeObserver(es => {
        const w = es[0].contentRect.width;
        if (!M.sheet.open || !w) { lastW = 0; return; }
        if (lastW && Math.abs(w - lastW) > 1) { fit({ open: true }); render(); }
        else applyView();                                                                  // 높이만 바뀐 경우(선택 패널 열기·닫기, 퀴즈 패널): 보이는 영역 비율을 다시 맞춰 노드가 튀지 않게 한다
        lastW = w;
      }).observe($('map-canvas'));
    }
    $('map-save').addEventListener('click', save);
    $('map-opt').addEventListener('click', optimize);
    $('map-opt-apply').addEventListener('click', applyPreview);
    $('map-opt-cancel').addEventListener('click', cancelPreview);
    $('map-undo').addEventListener('click', undoOptimize);
    setupEdgeDialog();
    setupBulkDialog();
  }
  const worldPerPx = () => 1 / M.view.scale;

  function onDown(ev) {
    M.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { M.svg.setPointerCapture(ev.pointerId); } catch (e) { /* 무시 */ }
    if (M.ptrs.size === 2) { startPinch(); return; }
    if (M.ptrs.size > 2) return;
    const t = ev.target.closest ? ev.target : null;
    const nd = (!locked() || M.mode === 'quiz') && t && t.closest('[data-node]'), ed = !locked() && t && t.closest('[data-edge]');   // 미리보기 중에는 노드·연결을 건드릴 수 없고 화면 이동·확대만 된다
    if (nd) {
      const id = Number(nd.dataset.node), n = M.nodes.get(id);
      M.gest = { kind: 'node', id, x: ev.clientX, y: ev.clientY, orig: { x: n.x, y: n.y }, start: posOf(id), moved: false, pid: ev.pointerId, noDrag: M.mode === 'quiz' };   // 퀴즈에서는 노드를 옮기지 않고 탭만 받는다
    } else if (ed) {
      M.gest = { kind: 'edge', id: Number(ed.dataset.edge), x: ev.clientX, y: ev.clientY, moved: false, pid: ev.pointerId };
    } else {
      const rn = isRo() && !M.preview && t && t.closest('[data-node]');   // 읽기 전용 시트: 노드 위에서 시작해도 드래그는 화면 이동(pan)이고, 거의 안 움직이고 떼면 클릭으로 처리한다
      M.gest = { kind: 'pan', x: ev.clientX, y: ev.clientY, tx: M.view.tx, ty: M.view.ty, moved: false, pid: ev.pointerId, tapNode: rn ? Number(rn.dataset.node) : null };
    }
  }
  function onMove(ev) {
    if (!M.ptrs.has(ev.pointerId)) return;
    M.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (M.pinch && M.ptrs.size >= 2) { updatePinch(); return; }
    const g = M.gest;
    if (!g || ev.pointerId !== g.pid) return;
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < TAP_PX) return;
    g.moved = true;
    if (g.kind === 'node') {
      if (g.noDrag) return;
      const n = M.nodes.get(g.id);
      n.x = g.start.x + dx * worldPerPx(); n.y = g.start.y + dy * worldPerPx();
      render();
    } else if (g.kind === 'pan') {
      M.view.tx = g.tx - dx * worldPerPx(); M.view.ty = g.ty - dy * worldPerPx();
      applyView();
    }
  }
  async function onUp(ev) {
    const had = M.ptrs.delete(ev.pointerId);
    if (!had) return;
    if (M.pinch) {                                     // 핀치가 끝나고 한 손가락이 남으면 그 손가락으로 이어서 화면 이동(튀지 않게 기준을 다시 잡음)
      if (M.ptrs.size < 2) M.pinch = null;
      if (M.ptrs.size === 1) { const [pid, q] = [...M.ptrs.entries()][0]; M.gest = { kind: 'pan', x: q.x, y: q.y, tx: M.view.tx, ty: M.view.ty, moved: true, pid }; }
      else M.gest = null;
      return;
    }
    const g = M.gest;
    M.gest = null;
    if (!g || ev.pointerId !== g.pid) return;
    if (g.kind === 'node') {
      if (!g.moved) { M.picker.tap(g.id); return; }
      if (g.noDrag) return;
      const n = M.nodes.get(g.id);
      const x = Math.round(n.x * 10) / 10, y = Math.round(n.y * 10) / 10;
      const r = await api('PATCH', '/api/cmap/maps/' + M.map.id + '/nodes/' + g.id, { x, y });
      if (okStatus(r)) { n.x = r.body.node.x; n.y = r.body.node.y; render(); }
      else { n.x = g.orig.x; n.y = g.orig.y; render(); mapMsg(errText(r, '위치를 저장하지 못했어요. 원래 자리로 돌려놨어요.')); }
    } else if (g.kind === 'edge') {
      if (g.moved) return;
      const e = M.edges.find(x => x.id === g.id);
      if (e) openEdgeDialog('edit', { edge: e, from: e.from_concept_id, to: e.to_concept_id });
    } else if (g.kind === 'pan') {
      if (!g.moved) {                                  // 빈 곳을 가볍게 누르면 선택 취소(읽기 전용 시트에서는 개념 클릭 또는 팝업 닫기)
        if (g.tapNode !== null && g.tapNode !== undefined) markClick(g.tapNode); else if (isRo()) closePopupOnly();
        M.picker.reset();
      }
    }
  }
  function onCancel(ev) {
    M.ptrs.delete(ev.pointerId);
    const g = M.gest;
    if (g && g.kind === 'node' && g.moved) { const n = M.nodes.get(g.id); if (n) { n.x = g.orig.x; n.y = g.orig.y; } render(); }   // 취소된 드래그는 저장하지 않고 되돌림
    M.gest = null;
    if (M.ptrs.size < 2) M.pinch = null;
  }
  function startPinch() {
    const g = M.gest;
    if (g && g.kind === 'node' && g.moved) { const n = M.nodes.get(g.id); if (n) { n.x = g.orig.x; n.y = g.orig.y; } render(); }   // 두 번째 손가락이 닿으면 진행 중이던 노드 이동은 취소(저장하지 않음)
    M.gest = null;
    const [p1, p2] = [...M.ptrs.values()];
    const rect = M.svg.getBoundingClientRect();
    const mx = (p1.x + p2.x) / 2 - rect.left, my = (p1.y + p2.y) / 2 - rect.top;
    M.pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, scale: M.view.scale, wx: M.view.tx + mx / M.view.scale, wy: M.view.ty + my / M.view.scale };
  }
  function updatePinch() {
    const [p1, p2] = [...M.ptrs.values()];
    const rect = M.svg.getBoundingClientRect();
    const mx = (p1.x + p2.x) / 2 - rect.left, my = (p1.y + p2.y) / 2 - rect.top;
    M.view.scale = zclamp(M.pinch.scale * (Math.hypot(p1.x - p2.x, p1.y - p2.y) / M.pinch.dist));
    M.view.tx = M.pinch.wx - mx / M.view.scale; M.view.ty = M.pinch.wy - my / M.view.scale;
    applyView();
  }
  function onWheel(ev) {
    ev.preventDefault();
    const rect = M.svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const wx = M.view.tx + mx / M.view.scale, wy = M.view.ty + my / M.view.scale;
    M.view.scale = zclamp(M.view.scale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15));
    M.view.tx = wx - mx / M.view.scale; M.view.ty = wy - my / M.view.scale;
    applyView();
  }

  window.CmapMap = {
    open, close, setMode, highlight, openSheet, closeSheet, applySelection, save,
    isBusy() { return M.busy; },
    isSymmetric: t => isSym(t),
    // 283-2: [만들기] 첫 화면용 읽기 전용 정보(저장된 개념·주제 목록, 지도에 올라간 개념, 연결 수, 저장 상태)
    info() { return { concepts: [...M.concepts.values()], topics: M.topics.slice(), nodeIds: [...M.nodes.keys()], edgeCount: M.edges.length, status: M.status ? { ...M.status } : null, rootId: M.rootId, loaded: !!M.svg }; },
    isSheetOpen() { return M.sheet.open; },
    // 해설·복습에서 "지도에서 보기": 그 개념들을 강조하고 시트를 연다(이미 열려 있으면 강조만 바꾼다)
    showOnMap(ids) { highlight(ids); openSheet(); },
    on(ev, fn) { if (listeners[ev]) listeners[ev].push(fn); },
    status() { return M.status ? { ...M.status } : null; },
    mapId() { return M.map ? M.map.id : null; },
    rootId() { return M.rootId; },
    topicOfConcept(id) { const c = M.concepts.get(id); return c ? c.topic_id : null; },
    // 연결 퀴즈(작업273-5): begin 으로 화면을 퀴즈 모드로 바꾸고, setAnswers 로 사용자가 이은 연결을 그리며, end 로 끝낸다(모드는 호출한 쪽이 정함)
    quizBegin(nodes) { M.quiz = { nodes: nodes.map(n => ({ id: n.id, term: n.term, marked: n.marked === true })), pos: scatter(nodes), answers: [] }; M.selected = null; if (M.picker) M.picker.reset(); setMode('quiz'); if (M.sheet.open) { fit({ open: true }); render(); } else openSheet(); },
    quizSetAnswers(list) { if (M.quiz) { M.quiz.answers = list.map(a => ({ from: a.from, to: a.to, type: a.type || null })); render(); } },
    quizEnd() { M.quiz = null; M.selected = null; if (M.picker) M.picker.reset(); },
    edgeCount() { return M.edges.length; },
    openPick() { openSheet(); $('map-pick-panel').hidden = false; $('map-pick-toggle').setAttribute('aria-expanded', 'true'); applyView(); },
    // 테스트용 확인: 배치 최적화 미리보기 상태
    _preview() { return M.preview ? { pos: [...M.preview.pos].map(([id, p]) => ({ id, ...p })), metrics: M.preview.metrics } : null; },
    togglePanel() { const p = $('map-pick-panel'); p.hidden = !p.hidden; $('map-pick-toggle').setAttribute('aria-expanded', String(!p.hidden)); if (M.sheet.open) applyView(); },
    // 테스트 확인용(읽기 전용 사본)
    // 275-5: 퀴즈 결과에서 사용자가 직접 누르는 [표시 해제](자동 해제 없음). 성공하면 화면 상태도 맞춘다
    async unmarkConcept(id) {
      const r = await api('PUT', '/api/cmap/concepts/' + id + '/mark', { marked: false });
      if (!okStatus(r)) return false;
      M.marks.delete(id); M.serverMarks.delete(id);
      return true;
    },
    // 오답노트: 모르는 개념으로 표시한 개념(이 지도의 주제 트리 안)
    markedConcepts() { return [...M.marks].map(id => M.concepts.get(id)).filter(Boolean).map(c => ({ id: c.id, term: c.term })).sort((a, b) => a.term.localeCompare(b.term, 'ko')); },
    _marks() { return { marked: [...M.marks].sort((a, b) => a - b), server: [...M.serverMarks].sort((a, b) => a - b), popup: M.popup }; },
    _highlight() { return [...M.hl].sort((a, b) => a - b); },
    _state() { return { mode: M.mode, nodes: [...M.nodes].map(([id, n]) => ({ id, x: n.x, y: n.y })), edges: M.edges.map(e => ({ ...e })), view: { ...M.view }, selected: M.selected, mapId: M.map && M.map.id }; },
  };
})();
