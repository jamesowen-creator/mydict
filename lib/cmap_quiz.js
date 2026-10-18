// 작업273-5: 개념 지도 연결 퀴즈 — 채점(순수 함수, AI·DB 없음). 정답은 저장된 지도의 간선이다.
// 점수는 세 가지를 따로 낸다(합치지 않음):
//  - 쌍 맞힘(pair): 지도의 연결 중 사용자가 두 개념을 이은 것의 비율(방향 무관). 못 찾은 연결은 틀린 것으로 센다.
//  - 종류(type): 종류가 있는 연결(분모) 중 사용자가 같은 종류를 고른 것. 못 찾은 연결·종류 없이 고른 것은 틀린 것.
//  - 방향(direction): 방향이 있는 연결(= 종류가 방향 없음 4개(구별·유사·대립·연관)가 아닌 연결, 분모) 중 방향이 같은 것. 방향 없음 유형(대칭)은 방향을 보지 않는다.
// 지도에 없는 연결을 이은 것은 "지도에 없는 연결"로 따로 보여 주고 점수에서 감점하지 않는다.
'use strict';
const crypto = require('crypto');
const M = require('./cmap_map');

const MAX_ANSWERS = 200;

// answers: [{from_concept_id, to_concept_id, relation_type}] 의 형태·노드 검증. 성공 { value }, 실패 { error }
function readAnswers(raw, nodeIds) {
  if (!Array.isArray(raw) || raw.length > MAX_ANSWERS) return { error: `answers 는 ${MAX_ANSWERS}개 이하의 배열이어야 합니다.` };
  const nodes = new Set(nodeIds), seen = new Set(), value = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return { error: '답 항목 형식이 올바르지 않습니다.' };
    const from = a.from_concept_id, to = a.to_concept_id;
    if (!Number.isInteger(from) || !Number.isInteger(to)) return { error: '답 항목의 개념 id 가 올바르지 않습니다.' };
    if (from === to) return { error: '같은 개념끼리는 이을 수 없습니다.' };
    if (!nodes.has(from) || !nodes.has(to)) return { error: '지도에 없는 개념이 답에 들어 있습니다.' };
    const key = Math.min(from, to) + ':' + Math.max(from, to);
    if (seen.has(key)) return { error: '같은 두 개념을 두 번 이을 수 없습니다.' };
    seen.add(key);
    const t = M.readRelationType(a.relation_type, M.ALL_RELATION_TYPES);   // 307-1: 저장된 옛 연결을 맞힐 수 있도록 퀴즈 답은 전체 10종 허용
    if (t.error) return { error: t.error };
    value.push({ from_concept_id: from, to_concept_id: to, relation_type: t.value === undefined ? null : t.value });
  }
  return { value };
}

const ratio = (n, d) => (d === 0 ? null : n / d);

// edges: 저장된 지도의 간선 [{from_concept_id, to_concept_id, relation_type, label}], answers: readAnswers 를 통과한 값
function grade(edges, answers) {
  const byPair = new Map(edges.map(e => [Math.min(e.from_concept_id, e.to_concept_id) + ':' + Math.max(e.from_concept_id, e.to_concept_id), e]));
  const answered = new Map();
  const extras = [];
  for (const a of answers) {
    const key = Math.min(a.from_concept_id, a.to_concept_id) + ':' + Math.max(a.from_concept_id, a.to_concept_id);
    if (byPair.has(key)) answered.set(key, a); else extras.push({ from_concept_id: a.from_concept_id, to_concept_id: a.to_concept_id, relation_type: a.relation_type });
  }
  const correct = [], wrong = [], missed = [];
  let pairHit = 0, typeTotal = 0, typeHit = 0, dirTotal = 0, dirHit = 0;
  for (const e of edges) {
    const key = Math.min(e.from_concept_id, e.to_concept_id) + ':' + Math.max(e.from_concept_id, e.to_concept_id);
    const a = answered.get(key);
    const typed = e.relation_type !== null && e.relation_type !== undefined;
    const directed = !M.isSymmetric(e.relation_type);   // 286-1: 방향 없음 4개는 방향을 채점하지 않는다
    if (typed) typeTotal++;
    if (directed) dirTotal++;
    const expected = { from_concept_id: e.from_concept_id, to_concept_id: e.to_concept_id, relation_type: e.relation_type || null, label: M.displayLabel(e) };
    if (!a) { missed.push(expected); continue; }
    pairHit++;
    const problems = [];
    if (typed) { if (a.relation_type === e.relation_type) typeHit++; else problems.push('type'); }
    if (directed) { if (a.from_concept_id === e.from_concept_id) dirHit++; else problems.push('direction'); }
    if (problems.length) wrong.push({ expected, answer: a, problems }); else correct.push(expected);
  }
  const scores = {
    pair: { hit: pairHit, total: edges.length, ratio: ratio(pairHit, edges.length) },
    type: { hit: typeHit, total: typeTotal, ratio: ratio(typeHit, typeTotal) },
    direction: { hit: dirHit, total: dirTotal, ratio: ratio(dirHit, dirTotal) },
  };
  return { scores, correct, wrong, missed, extras };
}

// 작업275-5: "표시한 개념" 퀴즈의 출제 범위(서버가 DB 의 표시로 계산한다 — 클라이언트가 보낸 범위는 쓰지 않는다).
//  - marked: 이 지도의 노드 중 표시된 개념(표시 중 지도에 없는 개념은 제외)
//  - isolated: 표시됐지만 지도에서 이어진 연결이 없어 출제할 수 없는 개념
//  - edges: 한쪽이라도 표시 개념인 연결(채점 기준)
//  - nodeIds: 퀴즈에 제시하는 노드 = 연결이 있는 표시 개념 + 그 연결의 반대쪽 개념
//  - key: 범위의 식별값(시작 때 받은 범위와 제출 때의 범위가 같은지 확인용, 정답 정보는 아님)
function scopeFor(edges, nodeIds, markedIds) {
  const inMap = new Set(nodeIds);
  const marked = [...new Set(markedIds)].filter(id => inMap.has(id)).sort((a, b) => a - b);
  const markedSet = new Set(marked);
  const scopeEdges = edges.filter(e => markedSet.has(e.from_concept_id) || markedSet.has(e.to_concept_id));
  const present = new Set();
  for (const e of scopeEdges) { present.add(e.from_concept_id); present.add(e.to_concept_id); }
  const isolated = marked.filter(id => !present.has(id));
  const key = crypto.createHash('sha256').update(JSON.stringify({ m: marked.filter(id => present.has(id)), e: scopeEdges.map(e => e.id).sort((a, b) => a - b) }), 'utf8').digest('hex');
  return { marked, markedSet, isolated, edges: scopeEdges, nodeIds: [...present].sort((a, b) => a - b), key };
}

// 표시 개념 중, 그 개념에 이어진 출제 연결을 모두 맞힌(연결·종류·방향 모두 정답) 개념 id. 제안용이며 자동으로 해제하지 않는다
function masteredOf(scopeEdges, correct, markedIds) {
  const ok = new Set(correct.map(e => e.from_concept_id + ':' + e.to_concept_id));
  const out = [];
  for (const id of [...markedIds].sort((a, b) => a - b)) {
    const mine = scopeEdges.filter(e => e.from_concept_id === id || e.to_concept_id === id);
    if (mine.length && mine.every(e => ok.has(e.from_concept_id + ':' + e.to_concept_id))) out.push(id);
  }
  return out;
}

module.exports = { MAX_ANSWERS, readAnswers, grade, scopeFor, masteredOf };
