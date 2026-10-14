// 작업273-2: 개념 지도 — 지도(노드·간선) 규칙의 순수 함수. DB 접근 없음. routes/concept_map.js 와 tests/concept_map_graph.test.js 가 쓴다.
// 관계 종류 5종은 개념 지도 자체 상수다(275-1: 개념학습 모듈을 불러오지 않고 같은 값을 복사). DB cmap_edges 의 CHECK 와 같은 값·순서를 유지한다.
'use strict';
const T = require('./cmap_topics');

const RELATION_TYPES = ['사용', '일부', '종류', '일으킴', '구별'];   // 값·순서 고정(테스트가 고정값으로 확인)
const SYMMETRIC_TYPE = '구별';                    // 대칭: 방향이 없어 id 가 작은 쪽을 from 으로 둔다(개념학습과 같은 규칙을 복사)
const LABEL_MAX = 40;
const MAP_TITLE_MAX = 80;
const POS_LIMIT = 10000;                          // 노드 좌표(x, y)의 절댓값 상한(유한한 숫자 범위)

// 관계 문구(필수, 1~40자, 한 줄). { value } | { error }
function readLabel(v) { return T.readName(v, LABEL_MAX, '관계 문구'); }

// 관계 종류(선택). undefined → { value: undefined }(변경 없음), null → { value: null }, 5종 중 하나 → { value }
function readRelationType(v) {
  if (v === undefined) return { value: undefined };
  if (v === null) return { value: null };
  if (typeof v !== 'string' || !RELATION_TYPES.includes(v)) return { error: `관계 종류는 ${RELATION_TYPES.join(', ')} 중 하나이거나 비워 두어야 합니다.` };
  return { value: v };
}

// 노드 좌표. 둘 다 유한한 숫자이고 |값| ≤ POS_LIMIT
function readPosition(x, y) {
  for (const v of [x, y]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: '좌표는 유한한 숫자여야 합니다.' };
    if (Math.abs(v) > POS_LIMIT) return { error: `좌표는 ±${POS_LIMIT} 범위 안이어야 합니다.` };
  }
  return { value: { x, y } };
}

// 대칭 종류(구별)는 id 가 작은 쪽이 from. 그 밖에는 사용자가 정한 방향 그대로
function normalizeDirection(from, to, type) {
  return type === SYMMETRIC_TYPE && from > to ? { from: to, to: from } : { from, to };
}

// 같은 쌍(방향 무관)이 이미 있는가
function pairExists(edges, a, b, exceptId) {
  return edges.find(e => e.id !== exceptId && ((e.from_concept_id === a && e.to_concept_id === b) || (e.from_concept_id === b && e.to_concept_id === a))) || null;
}

module.exports = { RELATION_TYPES, SYMMETRIC_TYPE, LABEL_MAX, MAP_TITLE_MAX, POS_LIMIT, readLabel, readRelationType, readPosition, normalizeDirection, pairExists };
