// 지도 공용 코드(순수 함수): 개념 학습·음성 학습 지도가 함께 쓴다. 수정 시 두 화면 테스트(concept_map*, voice_map)를 확인한다. 작업237-2: concept_study.html 에서 그대로 옮김.
// 클래식 스크립트(모듈 아님): 아래 선언은 전역이다. MAP_LAYOUT_SWEEPS 는 테스트가 전역에서 직접 바꾼다.
'use strict';
// 배치: 연결로 이어진 개념끼리 한 덩어리(BFS 단계 = 열, 단계 안 순서 = 행)로 묶어 위에서 아래로 쌓고,
// 연결이 없는 개념(이전된 개념 등)은 아래쪽 격자에 따로 둔다. 모든 노드가 서로 다른 칸을 쓰므로 겹치지 않는다.
const MAPD = { W: 132, H: 44, COLW: 192, ROWH: 64, GAP: 48, COLS: 3 };
const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
function clipText(t, n) { const a = Array.from(t); return a.length > n ? a.slice(0, n - 1).join('') + '…' : t; }

// 작업227-17: 열(BFS 단계) 안의 순서를 바꿔 선 교차를 줄인다. 이웃(바로 옆 열)의 평균 행 위치(barycenter) 순으로 정렬하고,
// 왼쪽→오른쪽, 오른쪽→왼쪽을 번갈아 MAP_LAYOUT_SWEEPS 번 되풀이한다. 같은 입력이면 항상 같은 결과(동점은 입력 순서 = 개념 id 오름차순).
// 열에 넣는 개념(열 번호)은 그대로라 배치 칸·겹침 없음은 변하지 않는다. 0 이면 예전 배치(BFS 발견 순서)다.
let MAP_LAYOUT_SWEEPS = 6;
function sortLevels(levels, adj, order) {
  if (!MAP_LAYOUT_SWEEPS || levels.length < 2) return;
  const lvOf = new Map(), idx = new Map();
  levels.forEach((lv, li) => lv.forEach((n, i) => { lvOf.set(n, li); idx.set(n, i); }));
  const bary = (n, towards) => {
    const v = adj.get(n).filter(m => lvOf.get(m) === towards).map(m => idx.get(m));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : idx.get(n);   // 옆 열에 이웃이 없으면 지금 자리 유지
  };
  const li = levels.map((_, i) => i);
  for (let pass = 0; pass < MAP_LAYOUT_SWEEPS; pass++) {
    const down = pass % 2 === 0;
    for (const l of down ? li.slice(1) : li.slice(0, -1).reverse()) {
      const t = down ? l - 1 : l + 1;
      const key = new Map(levels[l].map(n => [n, bary(n, t)]));
      levels[l].sort((a, b) => key.get(a) - key.get(b) || order.get(a) - order.get(b));
      levels[l].forEach((n, i) => idx.set(n, i));
    }
  }
}

function layoutMap(nodes, edges) {
  const adj = new Map(nodes.map(n => [n, []]));
  const order = new Map(nodes.map((n, i) => [n, i]));
  for (const [a, b] of edges) { adj.get(a).push(b); adj.get(b).push(a); }
  const seen = new Set(), pos = new Map(), singles = [];
  let y0 = 0;
  for (const root of nodes) {
    if (seen.has(root)) continue;
    seen.add(root);
    if (!adj.get(root).length) { singles.push(root); continue; }
    const levels = [];
    let frontier = [root];
    while (frontier.length) {
      levels.push(frontier);
      const next = [];
      for (const n of frontier) {
        for (const m of adj.get(n).slice().sort((a, b) => order.get(a) - order.get(b))) if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
      frontier = next;
    }
    sortLevels(levels, adj, order);
    let rows = 0;
    levels.forEach((lv, li) => { lv.forEach((n, ri) => pos.set(n, { x: li * MAPD.COLW, y: y0 + ri * MAPD.ROWH })); rows = Math.max(rows, lv.length); });
    y0 += rows * MAPD.ROWH + MAPD.GAP;
  }
  let labelY = null;
  if (singles.length) {
    labelY = y0 + 12;
    const gy = y0 + 28;
    singles.forEach((n, i) => pos.set(n, { x: (i % MAPD.COLS) * MAPD.COLW, y: gy + Math.floor(i / MAPD.COLS) * MAPD.ROWH }));
  }
  return { pos, labelY };
}

function edgeGeom(pa, pb) {
  const { W, H } = MAPD;
  const y1 = pa.y + H / 2, y2 = pb.y + H / 2;
  if (pa.x === pb.x) {                      // 같은 열: 오른쪽으로 둥글게
    const x = pa.x + W;
    return { d: `M${x},${y1} C${x + 44},${y1} ${x + 44},${y2} ${x},${y2}`, mx: x + 33, my: (y1 + y2) / 2 };
  }
  const right = pb.x > pa.x;
  const x1 = right ? pa.x + W : pa.x, x2 = right ? pb.x : pb.x + W;
  const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
  return { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}
