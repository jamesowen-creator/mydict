// 작업273-2: 개념 지도 화면의 순수 계산(DOM 없음). 노드 좌표는 노드 사각형의 왼쪽 위 모서리(세계 좌표), 크기는 mapCore.js 의 MAPD 와 같은 값을 쓴다.
//   tempGrid(unplacedIds, placed, opts)  → 아직 배치하지 않은 노드의 임시 격자 위치(저장하지 않음, 첫 이동 때 저장)
//   fitView(points, cw, ch, opts)         → 모든 노드가 보이도록 화면 이동·배율
//   clampScale(s)
// 클래식 스크립트(window.CmapGeometry)이면서 Node 테스트에서는 require 로 불러올 수 있다.
(function (root) {
  'use strict';
  const NODE_W = 132, NODE_H = 44, COLW = 192, ROWH = 64;   // mapCore.js 의 MAPD 와 같은 값
  const SCALE_MIN = 0.3, SCALE_MAX = 2.5;

  const clampScale = s => Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));

  // placed: [{x, y}] 이미 배치된 노드들. 임시 격자는 배치된 노드들 아래쪽(없으면 원점)에서 cols 열로 시작한다. 순서는 ids 순서
  function tempGrid(unplacedIds, placed, opts) {
    const cols = (opts && opts.cols) || 3;
    const maxY = (placed || []).reduce((m, p) => Math.max(m, p.y), -Infinity);
    const baseY = Number.isFinite(maxY) ? maxY + NODE_H + 48 : 0;
    const pos = new Map();
    unplacedIds.forEach((id, i) => pos.set(id, { x: (i % cols) * COLW, y: baseY + Math.floor(i / cols) * ROWH }));
    return pos;
  }

  // points: [{x, y}] 노드 왼쪽 위 좌표. 화면(cw × ch)에 모두 들어오는 배율(최대 1)과 viewBox 원점(tx, ty)
  function fitView(points, cw, ch, opts) {
    const pad = (opts && opts.pad) || 24;
    if (!points.length || !(cw > 0) || !(ch > 0)) return { scale: 1, tx: 0, ty: 0 };
    const x0 = Math.min(...points.map(p => p.x)) - pad, y0 = Math.min(...points.map(p => p.y)) - pad;
    const x1 = Math.max(...points.map(p => p.x + NODE_W)) + pad, y1 = Math.max(...points.map(p => p.y + NODE_H)) + pad;
    const scale = clampScale(Math.min(1, cw / (x1 - x0), ch / (y1 - y0)));
    return { scale, tx: (x0 + x1) / 2 - cw / scale / 2, ty: (y0 + y1) / 2 - ch / scale / 2 };
  }

  const api = { NODE_W, NODE_H, COLW, ROWH, SCALE_MIN, SCALE_MAX, clampScale, tempGrid, fitView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CmapGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);
