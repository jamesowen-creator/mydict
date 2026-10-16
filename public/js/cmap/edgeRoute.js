// 작업290-1: 개념 지도 연결선 경로 계산(순수 함수, DOM 없음, 난수 없음 — 같은 입력이면 같은 결과). 개념 지도 전용이며 공용 mapCore.js 의 edgeGeom 은 쓰지 않는다.
//   const routes = CmapEdgeRoute.routeAll(nodes, edges)
//     nodes: [{ id, x, y }] 노드 사각형의 왼쪽 위(세계 좌표), 크기는 132 × 44(mapGeometry.js·mapCore.js 의 MAPD 와 같은 값)
//     edges: [{ key, from, to, label }]  label = 선 위에 쓸 글자(이미 12자로 자른 것, 없으면 '')
//     반환: Map(key → { d, mx, my, sides, p0, p3, hits, candidateHits, labelBox, t })
//       d = path 의 d, (mx, my) = 라벨을 둘 곡선 위의 점(글자는 mapView 가 (mx, my - 4) 에 가운데 맞춤으로 쓴다), sides = [시작 면, 끝 면] ('t' 위 · 'b' 아래 · 'l' 왼쪽 · 'r' 오른쪽)
//       화살촉은 SVG marker(orient=auto)라 곡선 끝 접선 방향을 따른다: 끝 접선은 끝 면의 바깥에서 노드 쪽으로 들어온다.
// 규칙(요약):
//  1) 접속면: 같은 열(가로 어긋남 ≤ COLUMN_TOL)이거나 세로 간격이 노드 높이 이상이면서 세로 성분이 우세하면 위쪽 노드의 아래 면 → 아래쪽 노드의 위 면, 그 밖에는 오른쪽 → 왼쪽(또는 반대).
//  2) 제3의 노드를 가로지르면 접속면 후보 6가지(기본 · 다른 축의 기본 · 섞은 2가지 · 같은 쪽 면으로 바깥을 돌아가는 2가지) 중 가로지름이 가장 적은 것(동점은 앞선 후보).
//  3) 같은 노드의 같은 면에 연결이 여럿이면 접속점을 면을 따라 균등하게 나눈다(상대 노드의 위치 순으로 정렬해 교차를 줄임).
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

    // 2) 접속점 나누기: 같은 노드의 같은 면에 모인 연결을 상대 노드의 위치 순(위/아래 면은 가로, 옆 면은 세로)으로 늘어놓고 면을 균등 분할
    const groups = new Map();
    const add = (nodeId, side, e, otherId, end) => {   // end: 0 = 이 연결의 시작(from) 쪽 접속점, 1 = 끝(to) 쪽
      const k = nodeId + '|' + side;
      if (!groups.has(k)) groups.set(k, { side, list: [] });
      groups.get(k).list.push({ key: e.key, end, other: byId.get(otherId) });
    };
    for (const e of edges) { const s = pick.get(e.key).sides; add(e.from, s[0], e, e.to, 0); add(e.to, s[1], e, e.from, 1); }
    const frac = new Map();   // key → [시작 접속점 비율, 끝 접속점 비율]
    for (const e of edges) frac.set(e.key, [0.5, 0.5]);
    for (const g of groups.values()) {
      const vertical = g.side === 't' || g.side === 'b';
      g.list.sort((a, b) => cmp(vertical ? a.other.x : a.other.y, vertical ? b.other.x : b.other.y) || cmp(vertical ? a.other.y : a.other.x, vertical ? b.other.y : b.other.x) || cmp(a.key, b.key) || cmp(a.end, b.end));
      g.list.forEach((it, i) => { frac.get(it.key)[it.end] = (i + 1) / (g.list.length + 1); });
    }

    // 3) 경로와 라벨 위치
    const placed = [];   // 이미 놓은 라벨 상자
    for (const e of edges) {
      const pa = byId.get(e.from), pb = byId.get(e.to), { sides, candidateHits } = pick.get(e.key), f = frac.get(e.key);
      const b = bezier(portPoint(pa, sides[0], f[0]), sides[0], portPoint(pb, sides[1], f[1]), sides[1]);
      const w = labelWidth(e.label);
      let best = null;
      for (const t of T_LIST) {
        const q = at(b, t), box = e.label ? { x0: q.x - w / 2, x1: q.x + w / 2, y0: q.y - 4 - 12, y1: q.y - 4 + 3 } : { x0: q.x, x1: q.x, y0: q.y, y1: q.y };
        let cost = 0;
        if (e.label) {
          for (const n of nodes) cost += overlapArea(box, { x0: n.x - INFLATE, x1: n.x + W + INFLATE, y0: n.y - INFLATE, y1: n.y + H + INFLATE });
          for (const o of placed) cost += overlapArea(box, o);
        }
        if (!best || cost < best.cost) best = { t, q, box, cost };
        if (cost === 0) break;
      }
      placed.push(best.box);
      out.set(e.key, { d: pathD(b), mx: r1(best.q.x), my: r1(best.q.y), sides, p0: b.p0, p3: b.p3, hits: hitCount(b, nodes, e.from, e.to), candidateHits, labelBox: best.box, labelCost: best.cost, t: best.t });
    }
    return out;
  }

  const api = { W, H, COLUMN_TOL, MIN_VERT, ROW_UNIT, COL_UNIT, preferredSides, routeAll, labelWidth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CmapEdgeRoute = api;
})(typeof window !== 'undefined' ? window : globalThis);
