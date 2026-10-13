// 작업273-3: 개념 지도 배치 최적화(계산만, AI 호출 없음, DOM 없음). 노드 위치만 계산하고 노드 집합·간선은 읽기만 하며 바꾸지 않는다(의미 불변).
//   const r = CmapLayout.optimizeLayout(nodes, edges, { bounds })
//     nodes: [{ id, x, y }] (x, y = 지금 화면에 보이는 위치, 노드 사각형의 왼쪽 위), edges: [{ from, to }] (노드 id 쌍, 방향·문구는 배치에 쓰지 않음)
//     bounds: { w, h } 노드를 놓을 영역(노드 왼쪽 위 좌표의 범위는 [0, w - NODE_W] × [0, h - NODE_H]). 생략하면 노드 수에 맞는 영역(suggestBounds)
//     반환: { positions: Map(id → {x, y}), metrics: { crossingsBefore, crossingsAfter, lengthBefore, lengthAfter, changed, expanded }, bounds }
// 목표: 노드 겹침 없음, 간선 교차 수 감소, 연결된 노드 가까이, 영역 안. 같은 입력이면 항상 같은 결과(난수 없음).
// 방법: 서로 다른 후보 배치(원래 배치를 보정한 것·층 배치·힘 기반·BFS 순서의 격자·BFS 순서의 원)를 모두 만들어 겹침을 없애고 영역 안으로 넣은 뒤,
//   교차 수 → 연결선 길이 순으로 가장 좋은 것을 고른다. 원래 배치가 이미 유효(겹침 없음·영역 안)하면, 고른 후보가 원래보다 좋지 않을 때 원래 배치를 그대로 돌려준다
//   (그래서 유효한 배치에서는 교차 수가 절대 늘지 않는다). 원래 배치가 겹치거나 영역 밖이면 보정이 우선이라 교차 수 비증가는 보장하지 않는다.
// 클래식 스크립트(window.CmapLayout)이면서 Node 테스트에서는 require 로 불러올 수 있다.
(function (root) {
  'use strict';
  const NODE_W = 132, NODE_H = 44;           // mapCore.js 의 MAPD 와 같은 값
  const GAP = 12;                            // 겹침을 없앨 때 두는 노드 사이 여백
  const CELL_W = NODE_W + 72, CELL_H = NODE_H + 52;   // 격자 한 칸(연결 문구가 들어갈 여유)
  const r1 = v => Math.round(v * 10) / 10;

  function suggestBounds(n, aspect) {
    const a = aspect > 0 ? aspect : 0.6;     // 가로/세로 비율 힌트(모바일 세로 화면은 작은 값)
    const cells = Math.max(4, Math.ceil(n * 2.5));
    const cols = Math.max(2, Math.ceil(Math.sqrt(cells * a * CELL_H / CELL_W)));
    const rows = Math.max(2, Math.ceil(cells / cols));
    return { w: cols * CELL_W, h: rows * CELL_H };
  }
  const capacity = b => Math.max(1, Math.floor((b.w - NODE_W) / CELL_W) + 1) * Math.max(1, Math.floor((b.h - NODE_H) / CELL_H) + 1);

  // ── 평가 ──
  const cx = p => p.x + NODE_W / 2, cy = p => p.y + NODE_H / 2;
  function orient(ax, ay, bx, by, px, py) { const v = (bx - ax) * (py - ay) - (by - ay) * (px - ax); return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0; }
  function crossings(pos, edges) {
    let n = 0;
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i], pa = pos.get(a), pb = pos.get(b);
      for (let j = i + 1; j < edges.length; j++) {
        const [c, d] = edges[j];
        if (a === c || a === d || b === c || b === d) continue;       // 끝점을 공유하는 간선은 교차로 세지 않음
        const pc = pos.get(c), pd = pos.get(d);
        const o1 = orient(cx(pa), cy(pa), cx(pb), cy(pb), cx(pc), cy(pc)), o2 = orient(cx(pa), cy(pa), cx(pb), cy(pb), cx(pd), cy(pd));
        const o3 = orient(cx(pc), cy(pc), cx(pd), cy(pd), cx(pa), cy(pa)), o4 = orient(cx(pc), cy(pc), cx(pd), cy(pd), cx(pb), cy(pb));
        if (o1 * o2 < 0 && o3 * o4 < 0) n++;
      }
    }
    return n;
  }
  function totalLength(pos, edges) { let s = 0; for (const [a, b] of edges) s += Math.hypot(cx(pos.get(a)) - cx(pos.get(b)), cy(pos.get(a)) - cy(pos.get(b))); return s; }
  function hasOverlap(pos, ids, margin) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = pos.get(ids[i]), b = pos.get(ids[j]);
      if (Math.abs(a.x - b.x) < NODE_W + margin && Math.abs(a.y - b.y) < NODE_H + margin) return true;
    }
    return false;
  }
  const isInside = (pos, ids, b) => ids.every(id => { const p = pos.get(id); return p.x >= -1e-9 && p.y >= -1e-9 && p.x <= b.w - NODE_W + 1e-9 && p.y <= b.h - NODE_H + 1e-9; });
  const clone = pos => new Map([...pos].map(([id, p]) => [id, { x: p.x, y: p.y }]));

  // ── 보정: 영역 안으로 넣고 겹침 없애기(결정적) ──
  const clampPos = (p, b) => { p.x = Math.max(0, Math.min(b.w - NODE_W, p.x)); p.y = Math.max(0, Math.min(b.h - NODE_H, p.y)); };
  function gridCells(b) {
    const cols = Math.max(1, Math.floor((b.w - NODE_W) / CELL_W) + 1), rows = Math.max(1, Math.floor((b.h - NODE_H) / CELL_H) + 1);
    return { cols, rows };
  }
  function snakeGrid(order, b) {            // order 순서대로 격자 칸에 놓는다(한 줄 지나면 방향을 바꿔 이웃이 가까이 놓이게)
    const { cols } = gridCells(b), pos = new Map();
    order.forEach((id, i) => {
      const row = Math.floor(i / cols); let col = i % cols; if (row % 2 === 1) col = cols - 1 - col;
      pos.set(id, { x: col * CELL_W, y: row * CELL_H });
    });
    return pos;
  }
  function resolve(pos0, ids, b) {
    const pos = clone(pos0);
    const order = [...ids];
    for (const id of order) clampPos(pos.get(id), b);
    for (let iter = 0; iter < 400; iter++) {
      let moved = false;
      for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
        const a = pos.get(order[i]), c = pos.get(order[j]);
        const dx = c.x - a.x, dy = c.y - a.y;
        const ox = NODE_W + GAP - Math.abs(dx), oy = NODE_H + GAP - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * (ox / 2 + 0.05); a.x -= s; c.x += s; }
          else { const s = (dy >= 0 ? 1 : -1) * (oy / 2 + 0.05); a.y -= s; c.y += s; }
        }
      }
      for (const id of order) clampPos(pos.get(id), b);
      if (!moved) break;
    }
    if (hasOverlap(pos, order, 0) || !isInside(pos, order, b)) {   // 끝내 겹치면 현재 위치 순서(위→아래, 왼→오른)대로 격자 칸에 놓는다(칸 수는 호출 전에 충분하게 보장)
      const sorted = order.slice().sort((p, q) => pos.get(p).y - pos.get(q).y || pos.get(p).x - pos.get(q).x || p - q);
      return snakeGrid(sorted, b);
    }
    return pos;
  }

  // ── 그래프 도구 ──
  function adjacency(ids, edges) {
    const adj = new Map(ids.map(id => [id, []]));
    for (const [a, b] of edges) { adj.get(a).push(b); adj.get(b).push(a); }
    for (const l of adj.values()) l.sort((x, y) => x - y);
    return adj;
  }
  // 연결 요소(각 요소는 BFS 순서, 시작은 연결이 가장 많은 노드·같으면 id 가 작은 노드), 요소는 크기 큰 순
  function components(ids, adj) {
    const seen = new Set(), comps = [];
    const byDeg = ids.slice().sort((a, b) => adj.get(b).length - adj.get(a).length || a - b);
    for (const s of byDeg) {
      if (seen.has(s)) continue;
      const levels = [[s]]; seen.add(s);
      for (let f = levels[0]; f.length;) {
        const next = [];
        for (const u of f) for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); next.push(v); }
        if (next.length) levels.push(next);
        f = next;
      }
      comps.push(levels);
    }
    return comps.sort((a, b) => b.flat().length - a.flat().length);
  }
  const bfsOrder = comps => comps.flatMap(levels => levels.flat());

  // ── 후보 배치 ──
  function layered(ids, adj, b) {
    const comps = components(ids, adj), pos = new Map();
    let offY = 0;
    for (const levels of comps) {
      const order = levels.map(l => l.slice());
      const lvOf = new Map(); order.forEach((l, li) => l.forEach(id => lvOf.set(id, li)));
      const idx = new Map(); order.forEach(l => l.forEach((id, i) => idx.set(id, i)));
      for (let pass = 0; pass < 8; pass++) {                       // 이웃 열의 평균 위치(barycenter)로 열 안 순서를 정렬(mapCore.js 와 같은 아이디어)
        const down = pass % 2 === 0, seq = down ? order.map((_, i) => i).slice(1) : order.map((_, i) => i).slice(0, -1).reverse();
        for (const li of seq) {
          const t = down ? li - 1 : li + 1;
          const key = new Map(order[li].map(id => { const nb = adj.get(id).filter(m => lvOf.get(m) === t).map(m => idx.get(m)); return [id, nb.length ? nb.reduce((p, q) => p + q, 0) / nb.length : idx.get(id)]; }));
          order[li].sort((p, q) => key.get(p) - key.get(q) || p - q);
          order[li].forEach((id, i) => idx.set(id, i));
        }
      }
      let rows = 0;
      order.forEach((l, li) => { l.forEach((id, ri) => pos.set(id, { x: li * CELL_W, y: offY + ri * CELL_H })); rows = Math.max(rows, l.length); });
      offY += rows * CELL_H + CELL_H / 2;
    }
    const xs = [...pos.values()], maxX = Math.max(0, ...xs.map(p => p.x)), maxY = Math.max(0, ...xs.map(p => p.y));
    const sx = maxX > b.w - NODE_W ? (b.w - NODE_W) / maxX : 1, sy = maxY > b.h - NODE_H ? (b.h - NODE_H) / maxY : 1;
    for (const p of pos.values()) { p.x *= sx; p.y *= sy; }
    return pos;
  }
  function circle(order, b) {
    const pos = new Map(), n = order.length, rx = Math.max(0, (b.w - NODE_W) / 2), ry = Math.max(0, (b.h - NODE_H) / 2);
    order.forEach((id, i) => { const t = (2 * Math.PI * i) / Math.max(1, n); pos.set(id, { x: rx + rx * Math.cos(t), y: ry + ry * Math.sin(t) }); });
    return pos;
  }
  function force(ids, edges, b, init) {           // Fruchterman–Reingold(결정적: 난수 없이 고정 횟수)
    const pos = clone(init), n = ids.length;
    if (n < 2) return pos;
    const k = Math.max(90, 0.6 * Math.sqrt((b.w * b.h) / n));
    ids.forEach((id, i) => { const p = pos.get(id); p.x += (i % 3) * 0.01; p.y += (i % 5) * 0.01; });   // 같은 자리 노드를 가르는 결정적 미세 이동
    const ITER = 250;
    for (let it = 0; it < ITER; it++) {
      const temp = (Math.max(b.w, b.h) / 8) * (1 - it / ITER) + 0.5;
      const disp = new Map(ids.map(id => [id, { x: 0, y: 0 }]));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = pos.get(ids[i]), c = pos.get(ids[j]);
        let dx = a.x - c.x, dy = a.y - c.y, d = Math.hypot(dx, dy) || 0.01;
        const f = (k * k) / d;
        dx /= d; dy /= d;
        disp.get(ids[i]).x += dx * f; disp.get(ids[i]).y += dy * f; disp.get(ids[j]).x -= dx * f; disp.get(ids[j]).y -= dy * f;
      }
      for (const [u, v] of edges) {
        const a = pos.get(u), c = pos.get(v);
        let dx = a.x - c.x, dy = a.y - c.y; const d = Math.hypot(dx, dy) || 0.01;
        const f = (d * d) / k; dx /= d; dy /= d;
        disp.get(u).x -= dx * f; disp.get(u).y -= dy * f; disp.get(v).x += dx * f; disp.get(v).y += dy * f;
      }
      for (const id of ids) {
        const p = pos.get(id), dd = disp.get(id), len = Math.hypot(dd.x, dd.y) || 0.01, s = Math.min(len, temp) / len;
        p.x += dd.x * s; p.y += dd.y * s; clampPos(p, b);
      }
    }
    return pos;
  }

  function optimizeLayout(nodes, edgesIn, opts) {
    const ids = nodes.map(n => n.id).sort((a, b) => a - b);
    const idSet = new Set(ids);
    const seenPair = new Set(), edges = [];
    for (const e of edgesIn || []) {                               // 배치에 쓰는 간선: 양 끝이 노드이고 자기 자신이 아닌 것, 방향 무관 중복 제거
      if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
      const key = Math.min(e.from, e.to) + ':' + Math.max(e.from, e.to);
      if (seenPair.has(key)) continue;
      seenPair.add(key); edges.push([e.from, e.to]);
    }
    let bounds = (opts && opts.bounds && opts.bounds.w > 0 && opts.bounds.h > 0) ? { w: opts.bounds.w, h: opts.bounds.h } : suggestBounds(ids.length);
    let expanded = false;
    if (capacity(bounds) < ids.length) { const s = suggestBounds(ids.length); bounds = { w: Math.max(bounds.w, s.w), h: Math.max(bounds.h, s.h) }; expanded = true; }
    const orig = new Map(nodes.map(n => [n.id, { x: Number.isFinite(n.x) ? n.x : 0, y: Number.isFinite(n.y) ? n.y : 0 }]));
    const origCross = crossings(orig, edges), origLen = totalLength(orig, edges);
    const origValid = !hasOverlap(orig, ids, 0) && isInside(orig, ids, bounds);
    if (ids.length === 0) return { positions: new Map(), metrics: { crossingsBefore: 0, crossingsAfter: 0, lengthBefore: 0, lengthAfter: 0, changed: false, expanded }, bounds };

    const adj = adjacency(ids, edges), comps = components(ids, adj), order = bfsOrder(comps);
    const raw = [
      resolve(orig, ids, bounds),
      layered(ids, adj, bounds),
      force(ids, edges, bounds, circle(order, bounds)),
      snakeGrid(order, bounds),
      circle(order, bounds),
    ];
    let best = null;
    raw.forEach((p, i) => {
      const pos = resolve(p, ids, bounds);
      for (const q of pos.values()) { q.x = r1(q.x); q.y = r1(q.y); }
      const fixed = hasOverlap(pos, ids, 0) || !isInside(pos, ids, bounds) ? resolve(pos, ids, bounds) : pos;   // 반올림으로 생긴 틈 보정
      const c = crossings(fixed, edges), l = totalLength(fixed, edges);
      if (!best || c < best.c || (c === best.c && l < best.l - 1e-6)) best = { pos: fixed, c, l, i };
    });
    // 원래 배치가 유효하면 더 좋아질 때만 바꾼다(교차 수 비증가 보장)
    if (origValid && (best.c > origCross || (best.c === origCross && best.l >= origLen - 1e-6))) {
      return { positions: clone(orig), metrics: { crossingsBefore: origCross, crossingsAfter: origCross, lengthBefore: origLen, lengthAfter: origLen, changed: false, expanded }, bounds };
    }
    return { positions: best.pos, metrics: { crossingsBefore: origCross, crossingsAfter: best.c, lengthBefore: origLen, lengthAfter: best.l, changed: true, expanded }, bounds };
  }

  const api = { NODE_W, NODE_H, GAP, CELL_W, CELL_H, suggestBounds, optimizeLayout, crossings, totalLength, hasOverlap, isInside };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CmapLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
