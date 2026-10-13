// 작업273-2: 개념 지도 화면의 "지도" 보기 — 지도에 쓸 개념 선택, 노드 드래그 배치, 노드 A 탭 → B 탭 연결, 연결 수정·삭제.
// 클래식 스크립트(window.CmapMap). concept_map.html 의 인라인 스크립트가 먼저 정의한 전역($, h, api, okStatus, errText, openDlg, closeDlg, openConfirm, S, byId, ...)과
// 공용 /js/map/mapCore.js 의 읽기 전용 도구(sv, clipText, edgeGeom), /js/cmap/mapGeometry.js·pairPicker.js 를 호출 시점에 사용한다(공용 코드는 수정하지 않음).
// 모든 연결은 사용자가 직접 만든다(AI 제안 없음). 제스처: 노드 위 드래그 = 노드 이동(끝나면 위치 저장), 빈 곳 드래그 = 화면 이동, 두 손가락 = 확대·축소, 노드 탭 = 연결용 선택.
(function () {
  'use strict';
  const G = window.CmapGeometry, PP = window.CmapPairPicker;
  const TAP_PX = 6;   // 이 거리(px) 안에서 손을 떼면 탭, 넘으면 드래그
  const TYPE_HINT = {
    '': '관계 종류는 선택 사항이에요. 문구만 써도 됩니다.',
    '사용': '앞 개념이 뒤 개념을 쓰거나, 뒤 개념에 기대는 관계예요.',
    '일부': '앞 개념이 뒤 개념의 일부예요.',
    '종류': '앞 개념이 뒤 개념의 한 종류예요.',
    '일으킴': '앞 개념이 뒤 개념을 일으켜요. 어떻게 일으키는지(작동 방식)를 문구에 적어 주세요. 예: 마찰이 열을 일으킴',
    '구별': '헷갈리기 쉬운 두 개념이에요. 방향이 없어요.',
  };

  const M = {
    rootId: null, map: null, nodes: new Map(), edges: [], concepts: new Map(), topics: [], types: [],
    temp: new Map(), view: { tx: 0, ty: 0, scale: 1 }, ptrs: new Map(), gest: null, pinch: null, selected: null, picker: null, svg: null, busy: false,
  };
  let ED = null;   // 연결 대화상자 상태 { mode, edge, from, to, flips }

  const termOf = id => (M.concepts.get(id) ? M.concepts.get(id).term : '?');
  const typeLabel = t => (t ? t : '종류 없음');

  // ── 위치 ──
  const isPlaced = n => n && n.x !== null && n.x !== undefined && n.y !== null && n.y !== undefined;
  function posOf(id) {
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
    const svg = M.svg;
    svg.textContent = '';
    const defs = sv('defs', {}, sv('marker', { id: 'm-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '8', markerHeight: '8', orient: 'auto-start-reverse' }, sv('path', { d: 'M0,0 L10,5 L0,10 z', class: 'm-arrow-path' })));
    const edgeLayer = sv('g', { class: 'm-edges' }), nodeLayer = sv('g', { class: 'm-nodes' });
    for (const e of M.edges) {
      const a = M.nodes.get(e.from_concept_id), b = M.nodes.get(e.to_concept_id);
      if (!a || !b) continue;
      const geo = edgeGeom(posOf(e.from_concept_id), posOf(e.to_concept_id));
      const sym = e.relation_type === '구별';
      const lbl = clipText(e.label, 12);
      edgeLayer.append(sv('g', { class: 'm-edge', 'data-edge': e.id, 'data-t': 'edge', role: 'button', tabindex: 0, 'aria-label': `${termOf(e.from_concept_id)}${sym ? '와 ' : ' → '}${termOf(e.to_concept_id)}: ${e.label} (${typeLabel(e.relation_type)}), 눌러서 고치기` },
        sv('path', { d: geo.d, class: 'm-edge-hit' }),
        sv('path', { d: geo.d, class: 'm-edge-line', 'marker-end': sym ? null : 'url(#m-arrow)' }),
        sv('text', { x: geo.mx, y: geo.my - 4, class: 'm-edge-label', 'text-anchor': 'middle' }, lbl)));
    }
    for (const id of M.nodes.keys()) {
      const p = posOf(id), n = M.nodes.get(id);
      nodeLayer.append(sv('g', { class: 'm-node' + (M.selected === id ? ' sel' : '') + (isPlaced(n) ? '' : ' temp'), 'data-node': id, 'data-t': 'node', transform: `translate(${p.x},${p.y})`, role: 'button', tabindex: 0, 'aria-label': termOf(id) + (M.selected === id ? ' (선택됨)' : '') },
        sv('rect', { width: G.NODE_W, height: G.NODE_H, rx: 10 }),
        sv('text', { x: G.NODE_W / 2, y: G.NODE_H / 2 + 5, 'text-anchor': 'middle', class: 'm-node-text' }, clipText(termOf(id), 9))));
    }
    svg.append(defs, edgeLayer, nodeLayer);
    applyView();
    renderHint();
    $('map-count').textContent = '지도에 ' + M.nodes.size + '개 · 연결 ' + M.edges.length + '개';
  }
  function applyView() {
    const r = M.svg.getBoundingClientRect();
    const cw = r.width || 1, ch = r.height || 1;
    M.svg.setAttribute('viewBox', `${M.view.tx} ${M.view.ty} ${cw / M.view.scale} ${ch / M.view.scale}`);
  }
  function fit() {
    const r = M.svg.getBoundingClientRect();
    M.view = G.fitView([...M.nodes.keys()].map(posOf), r.width, r.height);
    applyView();
  }
  // 새 노드가 지금 보이는 영역 밖에 놓이면 전체가 보이도록 맞춘다(보이는 노드는 사용자가 정한 확대·이동을 그대로 둔다)
  function ensureVisible(id) {
    const r = M.svg.getBoundingClientRect(), p = posOf(id);
    const x0 = M.view.tx, y0 = M.view.ty, x1 = x0 + r.width / M.view.scale, y1 = y0 + r.height / M.view.scale;
    if (p.x < x0 || p.y < y0 || p.x + G.NODE_W > x1 || p.y + G.NODE_H > y1) fit();
  }
  function renderHint() {
    const el = $('map-hint');
    if (!M.nodes.size) { el.textContent = '아래 [개념 선택]에서 지도에 쓸 개념을 골라 보세요.'; return; }
    el.textContent = M.selected !== null
      ? '‘' + termOf(M.selected) + '’을(를) 골랐어요. 이어 줄 개념을 눌러 주세요. 같은 개념을 다시 누르면 취소돼요.'
      : '노드를 끌어 옮기고, 두 노드를 차례로 눌러 연결해요. 연결선을 누르면 고칠 수 있어요.';
  }
  const mapMsg = t => { $('map-msg').textContent = t || ''; };

  // ── 열기·닫기 ──
  async function open(rootId) {
    const r = await api('GET', '/api/cmap/topics/' + rootId + '/map');
    if (!okStatus(r)) { $('topics-msg').textContent = errText(r, '지도를 불러오지 못했습니다.'); return; }
    const b = r.body;
    M.rootId = rootId; M.map = b.map; M.types = b.relation_types || [];
    M.concepts = new Map(b.concepts.map(c => [c.id, c]));
    M.topics = b.topics;
    M.nodes = new Map(b.nodes.map(n => [n.concept_id, { x: n.x, y: n.y }]));
    M.edges = b.edges;
    M.selected = null; M.gest = null; M.pinch = null; M.ptrs.clear();
    if (!M.picker) {
      M.picker = PP.create({
        onFirst: id => { M.selected = id; render(); },
        onCancel: () => { M.selected = null; render(); },
        onPair: (a, bb) => { M.selected = null; render(); onPair(a, bb); },
      });
    } else M.picker.reset();
    M.svg = $('map-svg');
    $('main-view').hidden = true;
    $('map-view').hidden = false;
    $('map-title').textContent = '지도 · ' + b.map.title;
    $('map-pick-panel').hidden = true;
    $('map-pick-toggle').setAttribute('aria-expanded', 'false');
    mapMsg('');
    recomputeTemp();
    bindSvgOnce();
    fit();
    render();
    renderPickPanel();
  }
  function close() {
    if (M.picker) M.picker.reset();
    M.gest = null; M.pinch = null; M.ptrs.clear();
    $('map-view').hidden = true;
    $('main-view').hidden = false;
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
    mapMsg('');
    if (want) {
      const r = await api('POST', '/api/cmap/maps/' + M.map.id + '/nodes', { concept_id: cid });
      if (!okStatus(r)) { mapMsg(errText(r)); return; }
      M.nodes.set(cid, { x: r.body.node.x, y: r.body.node.y });
      recomputeTemp(); ensureVisible(cid); render(); renderPickPanel();
      return;
    }
    // 빼기: 연결이 있으면 서버가 409 + 개수를 알려 주고, 확인창 뒤에 confirm=1 로 지운다
    const probe = await api('DELETE', '/api/cmap/maps/' + M.map.id + '/nodes/' + cid);
    if (okStatus(probe)) { applyRemoval(cid); return; }
    if (probe.status === 409 && probe.body && probe.body.needs_confirm) {
      const n = (probe.body.counts && probe.body.counts.edges) || 0;
      openConfirm({
        heading: '지도에서 빼기',
        text: '‘' + termOf(cid) + '’ 개념을 지도에서 빼면 이 개념과 이어진 연결 ' + n + '개도 함께 지워집니다.\n개념 자체는 삭제되지 않아요.',
        okText: '빼기',
        action: async () => {
          const r = await api('DELETE', '/api/cmap/maps/' + M.map.id + '/nodes/' + cid + '?confirm=1');
          if (!okStatus(r)) return { failed: errText(r) };
          applyRemoval(cid);
          return {};
        },
      });
      return;
    }
    mapMsg(errText(probe));
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
    ED = { mode, edge: d.edge || null, from: d.from, to: d.to, flips: 0 };
    $('edge-heading').textContent = mode === 'create' ? '연결 만들기' : '연결 고치기';
    $('edge-label').value = d.edge ? d.edge.label : '';
    $('edge-type').value = d.edge && d.edge.relation_type ? d.edge.relation_type : '';
    $('edge-msg').textContent = '';
    $('edge-delete').hidden = mode !== 'edit';
    refreshEdgeDialog();
    openDlg($('edge-dlg'));
    $('edge-label').focus();
  }
  function refreshEdgeDialog() {
    const sym = $('edge-type').value === '구별';
    $('edge-pair').textContent = termOf(ED.from) + (sym ? ' ↔ ' : ' → ') + termOf(ED.to);
    $('edge-flip').disabled = sym;
    $('edge-type-hint').textContent = TYPE_HINT[$('edge-type').value] || TYPE_HINT[''];
  }
  function setupEdgeDialog() {
    $('edge-type').addEventListener('change', refreshEdgeDialog);
    $('edge-flip').addEventListener('click', () => { [ED.from, ED.to] = [ED.to, ED.from]; ED.flips++; refreshEdgeDialog(); });
    $('edge-cancel').addEventListener('click', () => closeDlg($('edge-dlg')));
    $('edge-delete').addEventListener('click', () => {
      const e = ED.edge;
      closeDlg($('edge-dlg'));
      openConfirm({
        heading: '연결 삭제', text: '‘' + termOf(e.from_concept_id) + '’ 와(과) ‘' + termOf(e.to_concept_id) + '’ 사이의 연결(' + e.label + ')을 삭제합니다.', okText: '삭제',
        action: async () => {
          const r = await api('DELETE', '/api/cmap/edges/' + e.id);
          if (!okStatus(r) && r.status !== 404) return { failed: errText(r) };
          M.edges = M.edges.filter(x => x.id !== e.id);
          render();
          return {};
        },
      });
    });
    $('edge-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const label = $('edge-label').value.trim();
      if (!label) { $('edge-msg').textContent = '관계 문구를 입력해 주세요.'; return; }
      const type = $('edge-type').value || null;
      setBusy($('edge-ok'), true);
      let r;
      if (ED.mode === 'create') r = await api('POST', '/api/cmap/maps/' + M.map.id + '/edges', { from_concept_id: ED.from, to_concept_id: ED.to, label, relation_type: type });
      else { const body = { label, relation_type: type }; if (ED.flips % 2 === 1) body.reverse = true; r = await api('PATCH', '/api/cmap/edges/' + ED.edge.id, body); }
      setBusy($('edge-ok'), false);
      if (!okStatus(r)) { $('edge-msg').textContent = errText(r); return; }
      if (ED.mode === 'create') M.edges.push(r.body.edge); else M.edges = M.edges.map(x => (x.id === r.body.edge.id ? r.body.edge : x));
      closeDlg($('edge-dlg'));
      render();
    });
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
      const nd = ev.target.closest && ev.target.closest('[data-node]'), ed = ev.target.closest && ev.target.closest('[data-edge]');
      if (nd) { ev.preventDefault(); M.picker.tap(Number(nd.dataset.node)); }
      else if (ed) { ev.preventDefault(); const e = M.edges.find(x => x.id === Number(ed.dataset.edge)); if (e) openEdgeDialog('edit', { edge: e, from: e.from_concept_id, to: e.to_concept_id }); }
    });
    $('map-fit').addEventListener('click', () => { fit(); });
    setupEdgeDialog();
  }
  const worldPerPx = () => 1 / M.view.scale;

  function onDown(ev) {
    M.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { M.svg.setPointerCapture(ev.pointerId); } catch (e) { /* 무시 */ }
    if (M.ptrs.size === 2) { startPinch(); return; }
    if (M.ptrs.size > 2) return;
    const t = ev.target.closest ? ev.target : null;
    const nd = t && t.closest('[data-node]'), ed = t && t.closest('[data-edge]');
    if (nd) {
      const id = Number(nd.dataset.node), n = M.nodes.get(id);
      M.gest = { kind: 'node', id, x: ev.clientX, y: ev.clientY, orig: { x: n.x, y: n.y }, start: posOf(id), moved: false, pid: ev.pointerId };
    } else if (ed) {
      M.gest = { kind: 'edge', id: Number(ed.dataset.edge), x: ev.clientX, y: ev.clientY, moved: false, pid: ev.pointerId };
    } else {
      M.gest = { kind: 'pan', x: ev.clientX, y: ev.clientY, tx: M.view.tx, ty: M.view.ty, moved: false, pid: ev.pointerId };
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
      if (!g.moved) M.picker.reset();                  // 빈 곳을 가볍게 누르면 선택 취소
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
    M.view.scale = G.clampScale(M.pinch.scale * (Math.hypot(p1.x - p2.x, p1.y - p2.y) / M.pinch.dist));
    M.view.tx = M.pinch.wx - mx / M.view.scale; M.view.ty = M.pinch.wy - my / M.view.scale;
    applyView();
  }
  function onWheel(ev) {
    ev.preventDefault();
    const rect = M.svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const wx = M.view.tx + mx / M.view.scale, wy = M.view.ty + my / M.view.scale;
    M.view.scale = G.clampScale(M.view.scale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15));
    M.view.tx = wx - mx / M.view.scale; M.view.ty = wy - my / M.view.scale;
    applyView();
  }

  window.CmapMap = {
    open, close,
    togglePanel() { const p = $('map-pick-panel'); p.hidden = !p.hidden; $('map-pick-toggle').setAttribute('aria-expanded', String(!p.hidden)); },
    // 테스트 확인용(읽기 전용 사본)
    _state() { return { nodes: [...M.nodes].map(([id, n]) => ({ id, x: n.x, y: n.y })), edges: M.edges.map(e => ({ ...e })), view: { ...M.view }, selected: M.selected, mapId: M.map && M.map.id }; },
  };
})();
