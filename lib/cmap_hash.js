// 작업273-3: 개념 지도의 "의미 해시"(semantic_hash). 서버에서만 계산하는 단일 모듈이다(클라이언트는 계산하지 않고 서버가 준 값을 비교만 한다).
// 의미 = 노드(개념 id 정렬 목록) + 간선(from, to, relation_type, label 정렬 목록). 좌표(x, y)는 의미가 아니므로 포함하지 않는다.
// 같은 의미면 입력 순서와 상관없이 같은 해시, 노드 집합·간선 수·종류·방향·문구 중 하나라도 바뀌면 다른 해시.
'use strict';
const crypto = require('crypto');

// edges: [{ from_concept_id, to_concept_id, relation_type, label }], nodeIds: [concept_id]
function canonicalize(nodeIds, edges) {
  const nodes = [...nodeIds].map(Number).sort((a, b) => a - b);
  const es = edges.map(e => [Number(e.from_concept_id), Number(e.to_concept_id), e.relation_type === undefined || e.relation_type === null ? null : String(e.relation_type), String(e.label)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] === b[2] ? 0 : String(a[2]) < String(b[2]) ? -1 : 1) || (a[3] === b[3] ? 0 : a[3] < b[3] ? -1 : 1));
  return JSON.stringify({ v: 1, nodes, edges: es });
}

function computeSemanticHash(nodeIds, edges) {
  return crypto.createHash('sha256').update(canonicalize(nodeIds, edges), 'utf8').digest('hex');
}

// 저장 상태: saved_at 이 없으면 'unsaved'(저장 안 됨), 저장한 적이 있는데 저장된 해시가 없거나(개념 삭제로 초기화) 현재 해시와 다르면 'changed'(저장 후 변경됨), 같으면 'saved'
function saveStatus(map, currentHash) {
  if (!map.saved_at) return 'unsaved';
  return map.semantic_hash && map.semantic_hash === currentHash ? 'saved' : 'changed';
}

module.exports = { canonicalize, computeSemanticHash, saveStatus };
