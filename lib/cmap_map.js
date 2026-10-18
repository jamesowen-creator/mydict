// 작업273-2: 개념 지도 — 지도(노드·간선) 규칙의 순수 함수. DB 접근 없음. routes/concept_map.js 와 tests/concept_map_graph.test.js 가 쓴다.
// 관계 종류는 개념 지도 자체 상수다(275-1: 개념학습 모듈을 불러오지 않고 같은 값을 복사). DB cmap_edges 의 CHECK 와 같은 값·순서를 유지한다.
'use strict';
const T = require('./cmap_topics');

// 286-1: 관계 종류 10개 — 방향 있음 6개(사용·일부·종류·일으킴·선행·조건) + 방향 없음 4개(구별·유사·대립·연관). 기존 5개 값과 이미 저장된 지도는 그대로 유효하다.
// 307-1: 새 연결에서 고를 수 있는 관계 유형 3종(이 순서)과, 이미 저장된 옛 연결을 읽고 표시하고 퀴즈로 채점하기 위한 전체 10종을 나눈다. DB 제약은 전체 10종 그대로(DB 변환은 2단계).
const SELECTABLE_RELATION_TYPES = ['종류', '일부', '대립'];
const ALL_RELATION_TYPES = ['사용', '일부', '종류', '일으킴', '선행', '조건', '구별', '유사', '대립', '연관'];   // 값·순서 고정(테스트가 고정값으로 확인). DB CHECK 와 같은 값
const RELATION_TYPES = ALL_RELATION_TYPES;   // 예전 이름(전체 목록). 새 입력 검증에는 쓰지 않는다
const SYMMETRIC_TYPES = ['구별', '유사', '대립', '연관'];   // 대칭(방향 없음): id 가 작은 쪽을 from 으로 둔다. 퀴즈는 방향을 채점하지 않고, 화면은 화살촉 없는 선으로 그린다
const isSymmetric = t => SYMMETRIC_TYPES.includes(t);
const LABEL_MAX = 40;
const MAP_TITLE_MAX = 80;
const POS_LIMIT = 10000;                          // 노드 좌표(x, y)의 절댓값 상한(유한한 숫자 범위)

// 관계 문구(필수, 1~40자, 한 줄). { value } | { error }
function readLabel(v) { return T.readName(v, LABEL_MAX, '관계 문구'); }
// 286-1: 관계 문구는 선택. undefined → { value: undefined }(변경 없음), null·빈 문자열·공백만 → { value: null }, 값이 있으면 1~40자 검증
function readOptionalLabel(v) {
  if (v === undefined) return { value: undefined };
  if (v === null || (typeof v === 'string' && v.trim() === '')) return { value: null };
  return readLabel(v);
}
// 286-1: 화면·퀴즈 결과·해설 입력이 같이 쓰는 표시용 문구 = 문구 ?? 유형 이름(둘 다 없으면 null)
function displayLabel(e) { return e.label !== null && e.label !== undefined && String(e.label).trim() !== '' ? e.label : (e.relation_type || null); }
function withDisplay(e) { return Object.assign({}, e, { display_label: displayLabel(e) }); }

// 관계 종류(선택). undefined → { value: undefined }(변경 없음), null → { value: null }, 허용 목록 중 하나 → { value }
// allowed: 기본은 새로 고를 수 있는 3종. 퀴즈 답 검증과 옛 연결 수정 검증은 ALL_RELATION_TYPES 를 넘긴다(오류 문구는 항상 새로 고를 3종 기준)
function readRelationType(v, allowed = SELECTABLE_RELATION_TYPES) {
  if (v === undefined) return { value: undefined };
  if (v === null) return { value: null };
  if (typeof v !== 'string' || !allowed.includes(v)) return { error: `관계 종류는 ${SELECTABLE_RELATION_TYPES.join(', ')} 중 하나이거나 비워 두어야 합니다.` };
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

// 대칭 종류(구별·유사·대립·연관)는 id 가 작은 쪽이 from. 그 밖에는 사용자가 정한(저장된) 방향 그대로
function normalizeDirection(from, to, type) {
  return isSymmetric(type) && from > to ? { from: to, to: from } : { from, to };
}

// 같은 쌍(방향 무관)이 이미 있는가
function pairExists(edges, a, b, exceptId) {
  return edges.find(e => e.id !== exceptId && ((e.from_concept_id === a && e.to_concept_id === b) || (e.from_concept_id === b && e.to_concept_id === a))) || null;
}

module.exports = { SELECTABLE_RELATION_TYPES, ALL_RELATION_TYPES, RELATION_TYPES, SYMMETRIC_TYPES, isSymmetric, readOptionalLabel, displayLabel, withDisplay, LABEL_MAX, MAP_TITLE_MAX, POS_LIMIT, readLabel, readRelationType, readPosition, normalizeDirection, pairExists };
