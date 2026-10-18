// 작업290-1: 개념 지도 연결선 경로 계산(순수 함수, DOM 없음, 난수 없음 — 같은 입력이면 같은 결과). 개념 지도 전용이며 공용 mapCore.js 의 edgeGeom 은 쓰지 않는다.
//   const routes = CmapEdgeRoute.routeAll(nodes, edges)
//     nodes: [{ id, x, y }] 노드 사각형의 왼쪽 위(세계 좌표), 크기는 132 × 44(mapGeometry.js·mapCore.js 의 MAPD 와 같은 값)
//     edges: [{ key, from, to, label, type? }]  label = 선 위에 쓸 글자(이미 12자로 자른 것, 없으면 ''), type = 관계 종류(302-1: 줄기 묶음 판정에만 쓴다, 없으면 묶지 않음)
//     반환: Map(key → { d, mx, my, sides, p0, p3, hits, candidateHits, labelBox, t })
//       302-1 추가: fallback(303-1: 직각 가지 대상 종류인데 곡선으로 돌린 연결) · labelMode('bundle' 다발 중간에 한 번 | 'end' 선 끝마다 | null) · group(묶음 id 또는 null) · hitD(묶인 연결의 갈래 구간만의 경로, 클릭 영역용) · noLabel(true 면 라벨을 그리지 않음: 묶음에서 key 가 가장 앞선 연결만 false)
//       d = path 의 d, (mx, my) = 라벨을 둘 곡선 위의 점(글자는 mapView 가 (mx, my - 4) 에 가운데 맞춤으로 쓴다), sides = [시작 면, 끝 면] ('t' 위 · 'b' 아래 · 'l' 왼쪽 · 'r' 오른쪽)
//       화살촉은 SVG marker(orient=auto)라 곡선 끝 접선 방향을 따른다: 끝 접선은 끝 면의 바깥에서 노드 쪽으로 들어온다.
// 규칙(요약):
//  1) 접속면: 같은 열(가로 어긋남 ≤ COLUMN_TOL)이거나 세로 간격이 노드 높이 이상이면서 세로 성분이 우세하면 위쪽 노드의 아래 면 → 아래쪽 노드의 위 면, 그 밖에는 오른쪽 → 왼쪽(또는 반대).
//  2) 제3의 노드를 가로지르면 접속면 후보 6가지(기본 · 다른 축의 기본 · 섞은 2가지 · 같은 쪽 면으로 바깥을 돌아가는 2가지) 중 가로지름이 가장 적은 것(동점은 앞선 후보).
//  3) 같은 노드의 같은 면에 연결이 여럿이면 접속점을 면을 따라 균등하게 나눈다(상대 노드의 위치 순으로 정렬해 교차를 줄임).
//  3b) 304-1·305-1: 같은 부모의 방향 있는 연결은 곡선 다발(부모 아래 면에서 자식 접속점 x 순으로 출발하고, 그 순서에서 종류가 같은 연속 구간이 한 다발). 선 단위 폴백은 기존 곡선(M 줄기 L 막대 L 갈래 L 자식 위)로 그린다. 자식이 부모보다 MIN_GAP 이상 아래에 있고 선이 다른 노드를 지나지 않을 때만, 아니면 묶음 전체를 곡선으로
//  4) 라벨은 곡선 위 t = 0.5 를 먼저 보고, 노드나 이미 놓인 라벨과 겹치면 0.3~0.7 사이에서 옮긴다(최선 노력, 완전 보장 아님).
// 클래식 스크립트(window.CmapEdgeRoute)이면서 Node 테스트에서는 require 로 불러올 수 있다.
(function (root) {
  'use strict';
  const W = 132, H = 44;
  // 접속면 규칙의 경계 수치. 노드는 가로로 넓은 상자(132 × 44)이고 지도의 배치 격자는 192 × 64 칸이라, 가로·세로 간격을 칸 수로 바꿔 비교한다.
  const COLUMN_TOL = W / 2;            // 두 노드 중심의 가로 어긋남이 노드 너비의 절반 이하이면 "같은 열"(조금 어긋나게 손으로 옮긴 경우도 위/아래 면 — 옆 면으로 돌아 들어가는 S자를 막는다)
  const MIN_VERT = H;                  // 세로 간격이 노드 높이 미만이면(사실상 같은 줄) 옆 면. 위/아래 면이 되려면 서로 위아래로 떨어져 있어야 한다
  const ROW_UNIT = 64, COL_UNIT = 192; // 격자 한 칸(세로 64, 가로 192). 대각선(가로 1칸·세로 1칸)은 칸 수가 같아 옆 면으로 기운다
  const PORT_MARGIN = { t: 12, b: 12, l: 8, r: 8 };   // 면 양 끝의 둥근 모서리(rx 10)를 피하는 여백
  const CTRL_K = 0.45, CTRL_MIN = 30, CTRL_MAX = 100;  // 곡선 제어점 거리 = 두 접속점 거리 × 0.45, 하한·상한
  const SAMPLES = 24, INFLATE = 2;
  const T_LIST = [0.5, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7];   // 라벨 위치 후보(곡선 위 비율), 앞선 것부터 결정적으로 시도
  const NORMAL = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
  const LABEL_H = 15;                  // 12px 글자 한 줄(기준선 위 12, 아래 3)

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const finite = v => (Number.isFinite(v) ? v : 0);
  const center = p => ({ x: p.x + W / 2, y: p.y + H / 2 });

  // 두 노드 중심만으로 정하는 접속면 [시작 면, 끝 면]
  function preferredSides(ca, cb) {
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    const sameCol = Math.abs(dx) <= COLUMN_TOL;
    const vertical = sameCol || (Math.abs(dy) >= MIN_VERT && Math.abs(dy) / ROW_UNIT > Math.abs(dx) / COL_UNIT);
    if (vertical) return dy >= 0 ? ['b', 't'] : ['t', 'b'];
    return dx >= 0 ? ['r', 'l'] : ['l', 'r'];
  }
  const horizontalPair = (ca, cb) => (cb.x - ca.x >= 0 ? ['r', 'l'] : ['l', 'r']);
  const verticalPair = (ca, cb) => (cb.y - ca.y >= 0 ? ['b', 't'] : ['t', 'b']);

  function portPoint(p, side, frac) {
    const m = PORT_MARGIN[side];
    if (side === 't') return { x: p.x + m + (W - 2 * m) * frac, y: p.y };
    if (side === 'b') return { x: p.x + m + (W - 2 * m) * frac, y: p.y + H };
    if (side === 'l') return { x: p.x, y: p.y + m + (H - 2 * m) * frac };
    return { x: p.x + W, y: p.y + m + (H - 2 * m) * frac };
  }
  function bezier(p0, s0, p3, s1) {
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const c = clamp(dist * CTRL_K, CTRL_MIN, CTRL_MAX);
    const n0 = NORMAL[s0], n1 = NORMAL[s1];
    return { p0, p1: { x: p0.x + n0[0] * c, y: p0.y + n0[1] * c }, p2: { x: p3.x + n1[0] * c, y: p3.y + n1[1] * c }, p3 };
  }
  const at = (b, t) => {
    const u = 1 - t, a = u * u * u, bb = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * b.p0.x + bb * b.p1.x + c * b.p2.x + d * b.p3.x, y: a * b.p0.y + bb * b.p1.y + c * b.p2.y + d * b.p3.y };
  };
  const r1 = v => Math.round(v * 10) / 10;
  const pathD = b => `M${r1(b.p0.x)},${r1(b.p0.y)} C${r1(b.p1.x)},${r1(b.p1.y)} ${r1(b.p2.x)},${r1(b.p2.y)} ${r1(b.p3.x)},${r1(b.p3.y)}`;

  // 곡선이 제3의 노드 사각형을 지나는 정도(서로 다른 노드 수) + 자기 양 끝 노드 안으로 되돌아 들어가는 정도
  function hitCount(b, nodes, fromId, toId) {
    const hit = new Set();
    for (let i = 1; i < SAMPLES; i++) {
      const t = i / SAMPLES, q = at(b, t);
      for (const n of nodes) {
        const own = n.id === fromId || n.id === toId;
        const g = own ? -1 : INFLATE;
        if (own && (t < 0.1 || t > 0.9)) continue;   // 양 끝 가까이는 접속면 위라서 제외
        if (q.x > n.x - g && q.x < n.x + W + g && q.y > n.y - g && q.y < n.y + H + g) hit.add(n.id);
      }
    }
    return hit.size;
  }

  const labelWidth = text => { let w = 6; for (const ch of Array.from(text || '')) w += ch.charCodeAt(0) > 0x2e7f ? 12 : 7; return w; };
  const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

  // 304-1: 방향 있는 6종은 "곡선 다발"로 그린다. 같은 부모(from)·같은 종류의 선들이 부모 아래 면의 서로 다른 가까운 점(STRAND_GAP 간격)에서
  //   나란히 출발해 한 다발처럼 달리다가 자식 쪽에서 부드럽게 갈라진다(3차 베지어 한 개, 시작·끝 접선 모두 아래). 종류가 다른 다발 사이는 BUNDLE_GAP.
  //   선 단위 폴백: 자식이 부모 아래보다 MIN_GAP 이상 아래가 아니거나(ㄱ) 곡선이 다른 노드를 지나면(ㄴ) 그 선만 기존 곡선 규칙으로 그린다.
  const BUNDLE_TYPES = ['종류', '일부'];   // 308-1: 방향 있는 유형은 종류·일부뿐(옛 사용·일으킴·선행·조건은 DB 37번 단계가 종류로 바꿈)
  const directedType = t => BUNDLE_TYPES.includes(t) || t === null;   // 305-1: 종류가 없는(null) 연결도 한 개짜리 다발로 같은 정렬에 참여한다(type 필드가 없는 예전 호출은 대상 아님)
  const MIN_GAP = 32;                  // 자식 위 가장자리가 부모 아래 가장자리보다 이만큼 이상 아래여야 다발로 그린다
  const STRAND_GAP = 6, MIN_STRAND_GAP = 3, BUNDLE_GAP = 16;   // 한 다발 안 선 간격(부모 폭이 모자라면 MIN_STRAND_GAP 까지 줄임)과 다발 사이 간격
  const FACE_MARGIN = PORT_MARGIN.b;   // 부모 아래 면에서 둥근 모서리를 피하는 여백(다발이 쓸 수 있는 폭 = W - 2 × FACE_MARGIN)
  const T_BUNDLE = [0.3, 0.25, 0.35, 0.2, 0.4, 0.15, 0.45];   // 다발 라벨: 가운데 선의 이 구간에서 자리를 찾는다
  const T_END = [0.85, 0.8, 0.9];                              // 선 끝 라벨(자식 위 쪽)
  const HIT_FROM = 0.6;                                        // 클릭 영역: 곡선의 t = 0.6 부터 끝까지(시작 부근 다발 구간은 반응 없음)
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  function tailOf(b, t) {              // de Casteljau 분할: t 부터 끝까지의 부분 곡선
    const a = lerp(b.p0, b.p1, t), m = lerp(b.p1, b.p2, t), c = lerp(b.p2, b.p3, t), d = lerp(a, m, t), e = lerp(m, c, t), f = lerp(d, e, t);
    return { p0: f, p1: e, p2: c, p3: b.p3 };
  }
  const downCurve = (p0, p3) => { const c = Math.max(20, 0.5 * (p3.y - p0.y)); return { p0, p1: { x: p0.x, y: p0.y + c }, p2: { x: p3.x, y: p3.y - c }, p3 }; };
  const cmpK = (a, b) => (typeof a === typeof b ? cmp(a, b) : (typeof a === 'number' ? -1 : 1));

  function routeAll(nodesIn, edgesIn) {
    const nodes = (nodesIn || []).map(n => ({ id: n.id, x: finite(n.x), y: finite(n.y) }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const edges = (edgesIn || []).filter(e => byId.has(e.from) && byId.has(e.to)).slice().sort((a, b) => cmp(a.key, b.key));
    const out = new Map();
    if (!edges.length) return out;

    // 1) 접속면 선택: 후보 4가지를 중앙 접속점으로 평가해 가로지름이 가장 적은 것
    const pick = new Map();
    for (const e of edges) {
      const pa = byId.get(e.from), pb = byId.get(e.to), ca = center(pa), cb = center(pb);
      const pref = preferredSides(ca, cb);
      const alt = (pref[0] === 'b' || pref[0] === 't') ? horizontalPair(ca, cb) : verticalPair(ca, cb);
      const vert = pref[0] === 'b' || pref[0] === 't';
      const bulge = vert ? [['r', 'r'], ['l', 'l']] : [['t', 't'], ['b', 'b']];   // 같은 쪽 면 두 개를 잇는 바깥으로 부푼 곡선(사이에 노드가 막고 있을 때 돌아가는 길)
      const cands = [pref, alt, [pref[0], alt[1]], [alt[0], pref[1]], ...bulge];
      const uniq = []; for (const c of cands) if (!uniq.some(u => u[0] === c[0] && u[1] === c[1])) uniq.push(c);
      const hits = uniq.map(c => hitCount(bezier(portPoint(pa, c[0], 0.5), c[0], portPoint(pb, c[1], 0.5), c[1]), nodes, e.from, e.to));
      let best = 0; for (let i = 1; i < uniq.length; i++) if (hits[i] < hits[best]) best = i;
      pick.set(e.key, { sides: uniq[best], candidateHits: hits });
    }

    // 1.5) 다발 후보 선: 방향 있는 6종이고 자식이 부모 아래 가장자리보다 MIN_GAP 이상 아래에 있는 선(ㄱ). 못 지키는 선은 처음부터 폴백
    const active = new Set();
    for (const e of edges) {
      if (!directedType(e.type) || e.from === e.to) continue;
      if (byId.get(e.to).y >= byId.get(e.from).y + H + MIN_GAP) active.add(e.key);
    }

    // 2) 접속점 나누기(기존 규칙) + 다발의 부모 쪽 자리. 한 부모의 다발 전체가 부모 아래 면에서 "덩어리 1개"로 센다(덩어리 안 선 위치는 아래에서 따로 정함)
    const bundleOf = new Map(), blocks = new Map();
    function assignPorts() {
      blocks.clear();
      for (const e of edges) {
        if (!active.has(e.key)) continue;
        if (!blocks.has(e.from)) blocks.set(e.from, { from: e.from, lines: [], bundles: [] });
        blocks.get(e.from).lines.push(e);
      }
      for (const bl of blocks.values()) {
        const kids = bl.lines.map(e => byId.get(e.to));
        bl.center = { x: kids.reduce((s, k) => s + k.x, 0) / kids.length, y: kids.reduce((s, k) => s + k.y, 0) / kids.length };
        bl.key = 'blk:' + bl.from;
      }
      const groups = new Map();
      const add = (nodeId, side, key, other, end) => {   // end: 0 = 이 연결의 시작(from) 쪽 접속점, 1 = 끝(to) 쪽
        const k = nodeId + '|' + side;
        if (!groups.has(k)) groups.set(k, { side, list: [] });
        groups.get(k).list.push({ key, end, other });
      };
      for (const e of edges) {
        if (active.has(e.key)) { add(e.to, 't', e.key, byId.get(e.from), 1); continue; }
        const s = pick.get(e.key).sides; add(e.from, s[0], e.key, byId.get(e.to), 0); add(e.to, s[1], e.key, byId.get(e.from), 1);
      }
      for (const bl of blocks.values()) add(bl.from, 'b', bl.key, bl.center, 0);
      const fr = new Map();   // key → [시작 접속점 비율, 끝 접속점 비율]
      for (const e of edges) fr.set(e.key, [0.5, 0.5]);
      for (const bl of blocks.values()) fr.set(bl.key, [0.5, 0.5]);
      for (const g of groups.values()) {
        const vertical = g.side === 't' || g.side === 'b';
        g.list.sort((a, b) => cmp(vertical ? a.other.x : a.other.y, vertical ? b.other.x : b.other.y) || cmp(vertical ? a.other.y : a.other.x, vertical ? b.other.y : b.other.x) || cmpK(a.key, b.key) || cmp(a.end, b.end));
        g.list.forEach((it, i) => { fr.get(it.key)[it.end] = (i + 1) / (g.list.length + 1); });
      }
      return fr;
    }
    // 305-1: 한 부모의 선을 모두 자식 위 접속점 x 순(같으면 key 순)으로 정렬한다 — 이 순서가 부모 아래 면의 출발 순서라 같은 부모의 선끼리 꼬이지 않는다.
    //   다발 = 이 순서에서 종류가 같은 선이 연속한 구간(같은 종류라도 연속이 끊기면 다른 다발). 자식 위 접속점은 부모·다발과 무관하게 정해지므로 먼저 계산한 frac 을 쓴다
    function buildBundles(fr) {
      bundleOf.clear();
      for (const bl of blocks.values()) {
        const endX = e => portPoint(byId.get(e.to), 't', fr.get(e.key)[1]).x;
        bl.lines.sort((p, q) => cmp(endX(p), endX(q)) || cmpK(p.key, q.key));
        bl.bundles = [];
        let cur = null;
        for (const e of bl.lines) {
          if (!cur || cur.type !== e.type) { cur = { id: bl.from + '|' + e.type + '|' + bl.bundles.length, from: bl.from, type: e.type, lines: [] }; bl.bundles.push(cur); }
          cur.lines.push(e); bundleOf.set(e.key, cur);
        }
        for (const bu of bl.bundles) bu.firstKey = bu.lines.reduce((m, e) => (cmpK(e.key, m) < 0 ? e.key : m), bu.lines[0].key);   // 라벨을 맡는 선 = key 가 가장 앞선 선
      }
    }
    // 부모 아래 면의 선 시작 x: 덩어리(다발들)를 덩어리 자리 중심으로 놓고 이웃한 두 선이 같은 종류면 STRAND_GAP, 다르면 BUNDLE_GAP. 폭이 넘치면 STRAND_GAP 을 MIN_STRAND_GAP 까지 줄이고, 그래도 넘치면 면 균등 분할로 되돌린다
    function placeStarts(fr) {
      const startX = new Map(), uniform = new Set();
      for (const bl of blocks.values()) {
        const p = byId.get(bl.from), avail = W - 2 * FACE_MARGIN, nb = bl.bundles.length, N = bl.bundles.reduce((s, b) => s + b.lines.length, 0);
        const widthOf = s => (N - nb) * s + (nb - 1) * BUNDLE_GAP;
        let s = STRAND_GAP;
        if (widthOf(s) > avail && N - nb > 0) s = Math.max(MIN_STRAND_GAP, (avail - (nb - 1) * BUNDLE_GAP) / (N - nb));
        if (widthOf(s) > avail + 1e-9) {                              // 면 균등 분할(기존 규칙)로 되돌림: 덩어리 안 모든 선을 순서대로 같은 간격으로
          let k = 0; for (const b of bl.bundles) for (const e of b.lines) { startX.set(e.key, p.x + FACE_MARGIN + avail * (++k) / (N + 1)); uniform.add(e.key); }
          continue;
        }
        const T = widthOf(s), cx = portPoint(p, 'b', fr.get(bl.key)[0]).x;
        let x = Math.max(p.x + FACE_MARGIN, Math.min(p.x + W - FACE_MARGIN - T, cx - T / 2));
        bl.bundles.forEach((b, bi) => { if (bi) x += BUNDLE_GAP; b.lines.forEach((e, li) => { if (li) x += s; startX.set(e.key, x); }); });
      }
      return { startX, uniform };
    }
    // 선 단위 폴백 반복: 모든 다발 선의 곡선을 만들어 ㄴ(다른 노드를 지나지 않음)을 못 지키는 선을 빼고, 자리 배정을 다시 계산한다
    let frac, starts, curves;
    for (;;) {
      frac = assignPorts();
      buildBundles(frac);
      starts = placeStarts(frac);
      curves = new Map();
      const bad = [];
      for (const e of edges) {
        if (!active.has(e.key)) continue;
        const p = byId.get(e.from), c = byId.get(e.to);
        const b = downCurve({ x: starts.startX.get(e.key), y: p.y + H }, portPoint(c, 't', frac.get(e.key)[1]));
        curves.set(e.key, b);
        if (hitCount(b, nodes, e.from, e.to) > 0) bad.push(e.key);
      }
      if (!bad.length) break;
      for (const k of bad) active.delete(k);              // 못 지키는 선만 기존 곡선(선 단위 폴백)
    }

    // 3) 경로와 라벨 위치
    const placed = [];   // 이미 놓은 라벨 상자
    const labelBoxAt = (q, w, has) => (has ? { x0: q.x - w / 2, x1: q.x + w / 2, y0: q.y - 4 - 12, y1: q.y - 4 + 3 } : { x0: q.x, x1: q.x, y0: q.y, y1: q.y });
    const labelCost = (box, has) => {
      let cost = 0;
      if (!has) return cost;
      for (const n of nodes) cost += overlapArea(box, { x0: n.x - INFLATE, x1: n.x + W + INFLATE, y0: n.y - INFLATE, y1: n.y + H + INFLATE });
      for (const o of placed) cost += overlapArea(box, o);
      return cost;
    };
    const bestAlong = (b, ts, w, has) => {
      let best = null;
      for (const t of ts) {
        const q = at(b, t), box = labelBoxAt(q, w, has), cost = labelCost(box, has);
        if (!best || cost < best.cost) best = { t, q, box, cost };
        if (cost === 0) break;
      }
      return best;
    };
    for (const e of edges) {
      const pa = byId.get(e.from), pb = byId.get(e.to), { sides, candidateHits } = pick.get(e.key), f = frac.get(e.key);
      const bd = bundleOf.get(e.key);
      if (bd && active.has(e.key)) {
        const b = curves.get(e.key), w = labelWidth(e.label), has = !!e.label;
        if (bd.mode === undefined) {                         // 라벨 방식은 다발의 첫 연결(key 가장 앞선 선)에서 한 번 정한다
          bd.mode = 'end';
          if (bd.lines.every(x => (x.label || '') === (bd.lines[0].label || ''))) {   // 문구가 모두 같으면 다발 중간(가운데 선의 t 0.15~0.45)에 한 번, 겹치면 선 끝 방식으로 되돌린다
            const mid = bd.lines[Math.floor((bd.lines.length - 1) / 2)], best = bestAlong(curves.get(mid.key), T_BUNDLE, labelWidth(mid.label), !!mid.label);
            if (best.cost === 0) { bd.mode = 'bundle'; bd.label = best; placed.push(best.box); }
          }
        }
        const common = { d: pathD(b), hitD: pathD(tailOf(b, HIT_FROM)), group: bd.id, sides: ['b', 't'], p0: b.p0, p3: b.p3, hits: 0, candidateHits, fallback: false, labelMode: bd.mode };
        if (bd.mode === 'bundle') {
          const first = e.key === bd.firstKey;
          out.set(e.key, { ...common, noLabel: !first, mx: r1(bd.label.q.x), my: r1(bd.label.q.y), labelBox: first ? bd.label.box : { x0: bd.label.q.x, x1: bd.label.q.x, y0: bd.label.q.y, y1: bd.label.q.y }, labelCost: bd.label.cost, t: bd.label.t });
        } else {                                               // 선 끝: 각 선 자신의 문구를 자기 선의 자식 위 쪽(t 0.8~0.9)에 단다
          const best = bestAlong(b, T_END, w, has);
          placed.push(best.box);
          out.set(e.key, { ...common, noLabel: false, mx: r1(best.q.x), my: r1(best.q.y), labelBox: best.box, labelCost: best.cost, t: best.t });
        }
        continue;
      }
      const b = bezier(portPoint(pa, sides[0], f[0]), sides[0], portPoint(pb, sides[1], f[1]), sides[1]);
      const w = labelWidth(e.label);
      let best = null;
      for (const t of T_LIST) {
        const q = at(b, t), box = labelBoxAt(q, w, !!e.label), cost = labelCost(box, !!e.label);
        if (!best || cost < best.cost) best = { t, q, box, cost };
        if (cost === 0) break;
      }
      placed.push(best.box);
      out.set(e.key, { d: pathD(b), mx: r1(best.q.x), my: r1(best.q.y), sides, p0: b.p0, p3: b.p3, hits: hitCount(b, nodes, e.from, e.to), candidateHits, labelBox: best.box, labelCost: best.cost, t: best.t, group: null, hitD: null, noLabel: false, fallback: directedType(e.type) && e.from !== e.to, labelMode: null });
    }
    return out;
  }

  const api = { W, H, COLUMN_TOL, MIN_VERT, ROW_UNIT, COL_UNIT, MIN_GAP, STRAND_GAP, MIN_STRAND_GAP, BUNDLE_GAP, HIT_FROM, BUNDLE_TYPES, preferredSides, routeAll, labelWidth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CmapEdgeRoute = api;
})(typeof window !== 'undefined' ? window : globalThis);
