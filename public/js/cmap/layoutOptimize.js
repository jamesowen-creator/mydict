// 작업273-3: 개념 지도 배치 최적화(계산만, AI 호출 없음, DOM 없음). 노드 위치만 계산하고 노드 집합·간선은 읽기만 하며 바꾸지 않는다(의미 불변).
//   const r = CmapLayout.optimizeLayout(nodes, edges, { bounds })
//     nodes: [{ id, x, y }] (x, y = 지금 화면에 보이는 위치, 노드 사각형의 왼쪽 위), edges: [{ from, to, type?, sym? }] (노드 id 쌍, 문구는 배치에 쓰지 않음)
//       294-1: 연결에 sym(boolean: true = 방향 없음)을 주면 방향 정보를 쓴다. sym 이 false 인 연결 = 방향 있음(위→아래: 유형과 관계없이 from(화살표 시작)이 위, 295-1).
//       sym 을 주지 않으면(예전 호출) 방향 정보가 없는 것이라 계층 후보를 만들지 않고 아래 일반 후보 선택만 쓴다.
//     bounds: { w, h } 노드를 놓을 영역(노드 왼쪽 위 좌표의 범위는 [0, w - NODE_W] × [0, h - NODE_H]). 생략하면 노드 수에 맞는 영역(suggestBounds)
//     반환: { positions: Map(id → {x, y}), metrics: { crossingsBefore, crossingsAfter, lengthBefore, lengthAfter, changed, expanded, layout, reason }, bounds }
//       layout: 'hierarchy'(방향 있는 연결이 있어 계층 배치를 고름) | 'general'(기존 후보 선택). 계층 배치가 세로로 모자라면 bounds.h 를 늘리고 expanded 를 true 로 한다.
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
  const REASON_HIER = '방향 있는 연결이 있어 위→아래 계층으로 배치', REASON_GENERAL = '교차가 가장 적은 배치를 선택';
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
  // ── 계층 배치(294-1): 방향 있는 연결은 위→아래 층, 방향 없는 연결은 같은 층에서 이웃, 연결 없는 개념은 맨 아래 층 ──
  const WRAP_COLS = 8;                         // 295-1: 한 층이 이 개수를 넘으면 여러 줄로 감는다(그 안에서는 영역 폭을 넓혀 한 줄에 놓는다)
  const LEVEL_GAP = 24;                        // 층과 층 사이에 더 두는 간격(한 층이 여러 줄로 감길 때 같은 층임이 보이게)
  const byKeyId = key => (p, q) => key.get(p) - key.get(q) || p - q;

  function directionInfo(idSet, edgesIn) {      // 쌍마다 하나로 정리: 방향 있는 [위, 아래] 또는 방향 없는 쌍(입력 순서와 무관하게 같은 결과)
    const recs = new Map();
    for (const e of edgesIn || []) {
      if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
      const key = Math.min(e.from, e.to) + ':' + Math.max(e.from, e.to);
      if (!recs.has(key)) recs.set(key, { a: Math.min(e.from, e.to), b: Math.max(e.from, e.to), dirs: [] });
      if (typeof e.sym === 'boolean' && !e.sym) recs.get(key).dirs.push([e.from, e.to]);   // 295-1: 방향 있는 모든 유형(유형 없음 포함)은 화살표 시작이 위
    }
    const directed = [], undirected = [];
    for (const r of recs.values()) {
      if (r.dirs.length) directed.push(r.dirs.sort((p, q) => p[0] - q[0] || p[1] - q[1])[0]);
      else undirected.push([r.a, r.b]);
    }
    directed.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    undirected.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    return { directed, undirected };
  }

  function hierarchical(ids, info) {
    const { directed, undirected } = info;
    const outs = new Map(ids.map(id => [id, []])), ins = new Map(ids.map(id => [id, []]));
    for (const [t, u] of directed) { outs.get(t).push(u); ins.get(u).push(t); }
    for (const l of outs.values()) l.sort((x, y) => x - y);
    // 순환 끊기: 위쪽 연결이 없는 노드부터 id 순으로 깊이 우선 탐색하고, 탐색 중인 노드로 되돌아가는 연결을 뺀다(같은 입력이면 항상 같은 결과)
    const state = new Map(), cut = new Set();
    const dfs = u => {
      state.set(u, 1);
      for (const v of outs.get(u)) {
        if (state.get(v) === 1) cut.add(u + '>' + v);
        else if (!state.get(v)) dfs(v);
      }
      state.set(u, 2);
    };
    const roots = ids.filter(id => ins.get(id).length === 0).concat(ids.filter(id => ins.get(id).length > 0));
    for (const id of roots) if (!state.get(id)) dfs(id);
    const dag = directed.filter(([t, u]) => !cut.has(t + '>' + u));
    const par = new Map(ids.map(id => [id, []])), chi = new Map(ids.map(id => [id, []]));
    for (const [t, u] of dag) { chi.get(t).push(u); par.get(u).push(t); }
    // 층 = 위쪽 연결을 따라가는 가장 긴 경로(위상 순서로 계산)
    const level = new Map(), indeg = new Map(ids.map(id => [id, par.get(id).length]));
    const hasDir = new Set(directed.flat());
    const queue = ids.filter(id => hasDir.has(id) && indeg.get(id) === 0);
    queue.forEach(id => level.set(id, 0));
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const v of chi.get(u).slice().sort((x, y) => x - y)) {
        level.set(v, Math.max(level.get(v) || 0, level.get(u) + 1));
        indeg.set(v, indeg.get(v) - 1);
        if (indeg.get(v) === 0) queue.push(v);
      }
    }
    // 방향 없는 연결: 방향 있는 순서를 해치지 않는 범위에서 두 개념을 같은 층으로(위 개념을 내리거나 아래 개념을 올림)
    for (let pass = 0; pass < 3; pass++) {
      for (const [u, v] of undirected) {
        if (!hasDir.has(u) || !hasDir.has(v) || level.get(u) === level.get(v)) continue;
        const lo = level.get(u) < level.get(v) ? u : v, hi = lo === u ? v : u, ll = level.get(lo), hl = level.get(hi);
        if (chi.get(lo).every(c => level.get(c) > hl)) level.set(lo, hl);
        else if (par.get(hi).every(p => level.get(p) < ll)) level.set(hi, ll);
      }
    }
    // 방향 있는 연결이 없는 개념: 방향 없는 이웃과 같은 층, 이웃이 모두 그런 개념이면 맨 위 층
    const und = new Map(ids.map(id => [id, []]));
    for (const [u, v] of undirected) { und.get(u).push(v); und.get(v).push(u); }
    for (const l of und.values()) l.sort((x, y) => x - y);
    const linked = ids.filter(id => und.get(id).length || hasDir.has(id));
    for (let grew = true; grew;) {
      grew = false;
      for (const id of linked) {
        if (level.has(id)) continue;
        const nb = und.get(id).find(m => level.has(m));
        if (nb !== undefined) { level.set(id, level.get(nb)); grew = true; }
      }
    }
    for (const id of linked) if (!level.has(id)) level.set(id, 0);
    const levels = [...new Set(linked.map(id => level.get(id)))].sort((x, y) => x - y);   // 빈 층은 건너뛴다
    const rows = levels.map(lv => linked.filter(id => level.get(id) === lv));
    const linkedSet = new Set(linked), isolated = ids.filter(id => !linkedSet.has(id));
    // 층 안 순서: 처음에는 위쪽 연결을 따라 깊이 우선으로 훑은 순서(가지가 이어 붙어 트리는 꼬이지 않음),
    // 그 뒤 위·아래 이웃 평균(barycenter)으로 정렬을 반복하고 선 교차가 가장 적었던 순서를 채택한다. 같은 층의 방향 없는 이웃은 붙여 놓는다
    const lvIdx = new Map(); rows.forEach((l, i) => l.forEach(id => lvIdx.set(id, i)));
    const nbAll = new Map(ids.map(id => [id, []]));
    for (const [t, u] of directed) { nbAll.get(t).push(u); nbAll.get(u).push(t); }
    for (const [u, v] of undirected) { nbAll.get(u).push(v); nbAll.get(v).push(u); }
    const frac = new Map();
    rows.forEach(l => l.forEach((id, i) => frac.set(id, (i + 0.5) / l.length)));
    const rank = new Map();
    const visit = u => { rank.set(u, rank.size); for (const v of chi.get(u).slice().sort((x, y) => x - y)) if (!rank.has(v)) visit(v); };
    for (const id of linked) if (par.get(id).length === 0 && !rank.has(id)) visit(id);
    for (const id of linked) if (!rank.has(id)) visit(id);
    const orderRow = (li, keyOf) => {
      const arr = rows[li], key = keyOf(arr, li);
      const near = new Map(arr.map(id => [id, nbAll.get(id).filter(m => lvIdx.get(m) === li).sort(byKeyId(key))]));
      const seen = new Set(), clusters = [];
      for (const s0 of arr.slice().sort(byKeyId(key))) {
        if (seen.has(s0)) continue;
        const comp = [], stack = [s0]; seen.add(s0);
        while (stack.length) { const u = stack.pop(); comp.push(u); for (const m of near.get(u)) if (!seen.has(m)) { seen.add(m); stack.push(m); } }
        const start = comp.slice().sort((p, q) => near.get(p).length - near.get(q).length || key.get(p) - key.get(q) || p - q)[0];
        const ord = [], vis = new Set(), walk = u => { vis.add(u); ord.push(u); for (const m of near.get(u)) if (!vis.has(m)) walk(m); };
        walk(start);
        clusters.push({ ord, k: comp.reduce((a, m) => a + key.get(m), 0) / comp.length, id: Math.min(...comp) });
      }
      clusters.sort((p, q) => p.k - q.k || p.id - q.id);
      rows[li] = clusters.flatMap(c => c.ord);
      rows[li].forEach((id, i) => frac.set(id, (i + 0.5) / rows[li].length));
    };
    const baryKey = down => (arr, li) => new Map(arr.map(id => {
      const nb = nbAll.get(id).filter(m => (down ? lvIdx.get(m) < li : lvIdx.get(m) > li));
      return [id, nb.length ? nb.reduce((s0, m) => s0 + frac.get(m), 0) / nb.length : frac.get(id)];
    }));
    const edgePairs = directed.concat(undirected);
    const crossNow = () => {
      const p = new Map(); rows.forEach((l, li) => l.forEach((id, i) => p.set(id, { x: i * CELL_W, y: li * CELL_H })));
      return crossings(p, edgePairs);
    };
    rows.forEach((_, li) => orderRow(li, arr => new Map(arr.map(id => [id, rank.get(id)]))));
    let bestRows = rows.map(l => l.slice()), bestC = crossNow();
    for (let pass = 0; pass < 12 && bestC > 0; pass++) {
      const down = pass % 2 === 0, seq = rows.map((_, i) => i);
      for (const li of down ? seq : seq.reverse()) orderRow(li, baryKey(down));
      const c = crossNow();
      if (c < bestC) { bestC = c; bestRows = rows.map(l => l.slice()); }
    }
    bestRows.forEach((l, i) => { rows[i] = l; });
    // 가로 위치: 부모는 자식들의 가운데 위, 같은 줄은 균등한 간격(순서를 지키며 목표에 가장 가깝게 = 등위 회귀)
    const pav = t => {
      const bl = [];
      t.forEach((v, i) => {
        bl.push({ sum: v - i, n: 1 });
        while (bl.length > 1 && bl[bl.length - 2].sum / bl[bl.length - 2].n > bl[bl.length - 1].sum / bl[bl.length - 1].n) { const q = bl.pop(); bl[bl.length - 1].sum += q.sum; bl[bl.length - 1].n += q.n; }
      });
      const out = []; for (const q of bl) for (let k = 0; k < q.n; k++) out.push(q.sum / q.n + out.length);
      return out;
    };
    const wrapMode = rows.some(l => l.length > WRAP_COLS);
    const cx0 = new Map();            // 칸 단위 가로 위치(칸 폭 = CELL_W)
    rows.forEach(l => l.forEach((id, i) => cx0.set(id, i - (l.length - 1) / 2)));
    if (!wrapMode) {
      const settle = (li, from) => {
        const t = rows[li].map(id => { const nb = from(id); return nb.length ? nb.reduce((s0, m) => s0 + cx0.get(m), 0) / nb.length : cx0.get(id); });
        pav(t).forEach((v, i) => cx0.set(rows[li][i], v));
      };
      const up = () => { for (let li = rows.length - 2; li >= 0; li--) settle(li, id => chi.get(id)); };
      const dn = () => { for (let li = 1; li < rows.length; li++) settle(li, id => par.get(id)); };
      for (let it = 0; it < 6; it++) { up(); dn(); }
      up();
    }
    // 좌표: 층마다 같은 간격의 줄. 폭을 넘는 층은 고르게 여러 줄로 감고(층 사이에만 간격을 더 둠) 연결 없는 개념은 마지막 줄
    const cells = new Map(), allRows = rows.concat(isolated.length ? [isolated] : []);
    let y = 0, maxY = 0;
    allRows.forEach((l, li) => {
      const isIso = isolated.length && li === allRows.length - 1;
      const lines = Math.ceil(l.length / WRAP_COLS), per = Math.ceil(l.length / lines);
      for (let k = 0; k < lines; k++) {
        const part = l.slice(k * per, (k + 1) * per);
        part.forEach((id, i) => cells.set(id, { x: (!wrapMode && !isIso && lines === 1) ? cx0.get(id) : i - (part.length - 1) / 2, y }));
        maxY = y; y += CELL_H;
      }
      if (wrapMode) y += LEVEL_GAP;
    });
    if (isolated.length && !wrapMode) {                 // 연결 없는 줄은 위 층들의 가운데에 맞춘다
      const used = linked.map(id => cells.get(id).x), mid = used.length ? (Math.min(...used) + Math.max(...used)) / 2 : 0;
      for (const id of isolated) cells.get(id).x += mid;
    }
    const xs = [...cells.values()].map(c => c.x), minX = Math.min(...xs), pos = new Map();
    for (const [id, c] of cells) pos.set(id, { x: (c.x - minX) * CELL_W, y: c.y });
    return { pos, height: maxY + NODE_H, width: (Math.max(...xs) - minX) * CELL_W + NODE_W };
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
    const info = directionInfo(idSet, edgesIn), useHier = info.directed.length > 0;   // 294-1: 방향 있는 연결이 하나라도 있으면 계층 후보를 우선한다
    const hier = useHier && ids.length ? hierarchical(ids, info) : null;
    if (hier && (hier.height > bounds.h || hier.width > bounds.w)) { bounds = { w: Math.max(bounds.w, hier.width), h: Math.max(bounds.h, hier.height) }; expanded = true; }   // 층·같은 층 개념이 많아 모자라면 영역을 늘린다
    const orig = new Map(nodes.map(n => [n.id, { x: Number.isFinite(n.x) ? n.x : 0, y: Number.isFinite(n.y) ? n.y : 0 }]));
    const origCross = crossings(orig, edges), origLen = totalLength(orig, edges);
    const origValid = !hasOverlap(orig, ids, 0) && isInside(orig, ids, bounds);
    if (ids.length === 0) return { positions: new Map(), metrics: { crossingsBefore: 0, crossingsAfter: 0, lengthBefore: 0, lengthAfter: 0, changed: false, expanded }, bounds };

    if (hier) {                                                      // 계층 후보가 유효(겹침 없음·영역 안)하면 그것을 고른다
      const pos = hier.pos;
      for (const q of pos.values()) { q.x = r1(q.x); q.y = r1(q.y); }
      if (!hasOverlap(pos, ids, 0) && isInside(pos, ids, bounds)) {
        const c = crossings(pos, edges), l = totalLength(pos, edges);
        const changed = ids.some(id => Math.abs(pos.get(id).x - orig.get(id).x) > 0.05 || Math.abs(pos.get(id).y - orig.get(id).y) > 0.05);
        return { positions: changed ? pos : clone(orig), metrics: { crossingsBefore: origCross, crossingsAfter: changed ? c : origCross, lengthBefore: origLen, lengthAfter: changed ? r1(l) : origLen, changed, expanded, layout: 'hierarchy', reason: REASON_HIER }, bounds };
      }
    }
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
      return { positions: clone(orig), metrics: { crossingsBefore: origCross, crossingsAfter: origCross, lengthBefore: origLen, lengthAfter: origLen, changed: false, expanded, layout: 'general', reason: REASON_GENERAL }, bounds };
    }
    return { positions: best.pos, metrics: { crossingsBefore: origCross, crossingsAfter: best.c, lengthBefore: origLen, lengthAfter: best.l, changed: true, expanded, layout: 'general', reason: REASON_GENERAL }, bounds };
  }

  const api = { NODE_W, NODE_H, GAP, CELL_W, CELL_H, suggestBounds, optimizeLayout, crossings, totalLength, hasOverlap, isInside };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CmapLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
