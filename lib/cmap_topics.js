// 작업271-1: 개념 지도 주제 트리의 순수 규칙(DB 접근 없음). routes/concept_map.js 가 쓰고, tests/concept_map_tree.test.js 가 직접 시험한다.
'use strict';

const MAX_DEPTH = 5;          // 최상위 = 1
const TITLE_MAX = 80;
const TERM_MAX = 80;
const ENGLISH_MAX = 120;
const MEMO_MAX = 2000;

const charLen = s => Array.from(s).length;
// 같은 이름 판정 키. DB 의 UNIQUE (… lower(title)) 와 같은 규칙(공백은 건드리지 않고 소문자만)
const nameKey = s => String(s).toLowerCase();

// 한 줄 이름(주제·개념). 성공이면 { value }, 실패면 { error }
function readName(v, max, label) {
  if (typeof v !== 'string') return { error: `${label}을(를) 입력해 주세요.` };
  const t = v.trim();
  if (!t) return { error: `${label}을(를) 입력해 주세요.` };
  if (/[\r\n\t]/.test(t)) return { error: `${label}에는 줄바꿈을 넣을 수 없습니다.` };
  if (charLen(t) > max) return { error: `${label}은(는) ${max}자 이하여야 합니다.` };
  return { value: t };
}

// 선택 입력(영문 표기·메모). undefined/null/빈 문자열은 null. multiline 이면 줄바꿈 허용
function readOptional(v, max, label, { multiline = false } = {}) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'string') return { error: `${label} 형식이 올바르지 않습니다.` };
  const t = v.trim();
  if (!t) return { value: null };
  if (!multiline && /[\r\n\t]/.test(t)) return { error: `${label}에는 줄바꿈을 넣을 수 없습니다.` };
  if (charLen(t) > max) return { error: `${label}은(는) ${max}자 이하여야 합니다.` };
  return { value: t };
}

// 평면 목록 [{ id, parent_id, root_id, title, sort_order }] → 조회용 색인
function buildIndex(topics) {
  const byId = new Map(topics.map(t => [t.id, t]));
  const children = new Map();
  for (const t of topics) {
    const key = t.parent_id === null || t.parent_id === undefined ? null : t.parent_id;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(t);
  }
  return { byId, children };
}

// 최상위 = 1. 부모 사슬을 따라 올라간 단계 수(순환이 있어도 멈추도록 상한을 둔다)
function depthOf(idx, id) {
  let d = 0, cur = idx.byId.get(id);
  while (cur && d <= MAX_DEPTH + 50) {
    d++;
    cur = cur.parent_id === null || cur.parent_id === undefined ? null : idx.byId.get(cur.parent_id);
  }
  return d;
}

// id 의 모든 후손(자기 자신 제외), 깊이 우선
function descendants(idx, id) {
  const out = [];
  const stack = [...(idx.children.get(id) || [])];
  while (stack.length) {
    const t = stack.pop();
    out.push(t);
    for (const c of idx.children.get(t.id) || []) stack.push(c);
  }
  return out;
}

// id 를 뿌리로 하는 가지의 높이(자기만 있으면 1)
function subtreeHeight(idx, id) {
  let h = 1;
  const walk = (cur, level) => {
    h = Math.max(h, level);
    for (const c of idx.children.get(cur) || []) walk(c.id, level + 1);
  };
  walk(id, 1);
  return h;
}

// candidateId 가 id 자신이거나 id 의 후손인가
function isSelfOrDescendant(idx, id, candidateId) {
  if (candidateId === id) return true;
  return descendants(idx, id).some(t => t.id === candidateId);
}

// 부모(parentId, null=최상위) 아래 자식 이름 목록 중 key 와 같은 것(excludeId 제외)
function findSibling(idx, parentId, title, excludeId) {
  const key = nameKey(title);
  return (idx.children.get(parentId === undefined ? null : parentId) || []).find(t => t.id !== excludeId && nameKey(t.title) === key) || null;
}

// 다음 sort_order(형제 중 가장 큰 값 + 1)
function nextSortOrder(idx, parentId) {
  const sibs = idx.children.get(parentId === undefined ? null : parentId) || [];
  return sibs.reduce((m, t) => Math.max(m, Number(t.sort_order) || 0), 0) + 1;
}

// 이동 후 root_id: 최상위가 되면 null, 아니면 새 부모의 루트(부모가 최상위면 부모 id)
function rootIdForParent(idx, parentId) {
  if (parentId === null || parentId === undefined) return null;
  const p = idx.byId.get(parentId);
  return p.root_id === null || p.root_id === undefined ? p.id : p.root_id;
}

module.exports = {
  MAX_DEPTH, TITLE_MAX, TERM_MAX, ENGLISH_MAX, MEMO_MAX,
  charLen, nameKey, readName, readOptional,
  buildIndex, depthOf, descendants, subtreeHeight, isSelfOrDescendant, findSibling, nextSortOrder, rootIdForParent,
};
