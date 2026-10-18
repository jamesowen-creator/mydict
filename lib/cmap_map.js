// 작업273-2: 개념 지도 — 지도(노드·간선) 규칙의 순수 함수. DB 접근 없음. routes/concept_map.js 와 tests/concept_map_graph.test.js 가 쓴다.
// 관계 종류는 개념 지도 자체 상수다(275-1: 개념학습 모듈을 불러오지 않고 같은 값을 복사). DB cmap_edges 의 CHECK 와 같은 값·순서를 유지한다.
'use strict';
const T = require('./cmap_topics');

// 308-1: 관계 유형은 종류·일부·대립 3종뿐이다(DB 37번 단계가 저장된 옛 유형을 이 3종으로 바꿈). 종류 = 화살촉 없음, 일부 = 화살촉 있음, 대립 = 쌍방향(방향 없음).
const RELATION_TYPES = ['종류', '일부', '대립'];   // 값·순서 고정(테스트가 고정값으로 확인). DB CHECK 와 같은 값
const DEFAULT_RELATION_TYPE = '종류';              // 유형을 보내지 않은 새 연결(문구만 보내던 옛 클라이언트)의 기본값
const SYMMETRIC_TYPES = ['대립'];                  // 대칭(방향 없음): id 가 작은 쪽을 from 으로 둔다. 퀴즈는 방향을 채점하지 않는다
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

// 관계 종류. undefined → { value: undefined }(생략), null → { value: null }, 3종 중 하나 → { value } (null 을 허용할지는 호출한 쪽이 정한다)
function readRelationType(v) {
  if (v === undefined) return { value: undefined };
  if (v === null) return { value: null };
  if (typeof v !== 'string' || !RELATION_TYPES.includes(v)) return { error: `관계 종류는 ${RELATION_TYPES.join(', ')} 중 하나여야 합니다.` };
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

// 대칭 종류(308-1부터 대립뿐)는 id 가 작은 쪽이 from. 그 밖에는 사용자가 정한(저장된) 방향 그대로
function normalizeDirection(from, to, type) {
  return isSymmetric(type) && from > to ? { from: to, to: from } : { from, to };
}

// 308-1: 옛 유형 → 3종 변환 규칙(DB 37번 단계 SQL 과 같은 규칙: 테스트가 SQL 을 모의 실행해 이 함수와 맞춰 본다).
//   옛 7종 → 종류. 유형이 없던(null) 연결은 문구(앞뒤 공백 제거)가 정확히 '일부'·'대립'이면 그 유형, 그 밖은 종류. 이미 3종이면 그대로. legacy = 원래 유형('없음' = 유형이 없었음, null = 바뀌지 않음)
const LEGACY_ONLY_TYPES = ['사용', '일으킴', '선행', '조건', '구별', '유사', '연관'];
function convertLegacyEdgeType(relationType, label) {
  if (relationType === null || relationType === undefined) {
    const l = typeof label === 'string' ? label.replace(/^ +| +$/g, '') : '';   // SQL btrim 과 같게 공백(스페이스)만 지운다
    return { type: l === '일부' ? '일부' : l === '대립' ? '대립' : '종류', legacy: '없음' };
  }
  if (LEGACY_ONLY_TYPES.includes(relationType)) return { type: '종류', legacy: relationType };
  return { type: relationType, legacy: null };
}

// 같은 쌍(방향 무관)이 이미 있는가
function pairExists(edges, a, b, exceptId) {
  return edges.find(e => e.id !== exceptId && ((e.from_concept_id === a && e.to_concept_id === b) || (e.from_concept_id === b && e.to_concept_id === a))) || null;
}

module.exports = { RELATION_TYPES, DEFAULT_RELATION_TYPE, convertLegacyEdgeType, SYMMETRIC_TYPES, isSymmetric, readOptionalLabel, displayLabel, withDisplay, LABEL_MAX, MAP_TITLE_MAX, POS_LIMIT, readLabel, readRelationType, readPosition, normalizeDirection, pairExists };
