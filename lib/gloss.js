// 작업417: 영어 뜻 표현 원칙 검증(서버용). public/english_dictionary.html 의 GLOSS-START~END(작업416)와 같은 규칙이다.
// 두 곳이 어긋나지 않는지는 tests/gloss_backfill417.test.js 가 html 구간을 읽어 같은 입력 표로 대조한다.
'use strict';

const GLOSS_ITEM_MAX = 20;      // 항목 하나의 여유 상한(글자 수 기준은 아님)
const GLOSS_PER_MEANING = 3;    // 뜻 하나에 남기는 대응어 수
const GLOSS_SHORT_MAX = 3;      // 대표 뜻에 합치는 뜻 수

function splitDefinition(text) {
  if (typeof text !== 'string') return [];
  return text.split(/\s*[,;，、；]\s*/).map(x => x.trim()).filter(Boolean);
}
function glossItemOk(it) { return !!it && Array.from(it).length <= GLOSS_ITEM_MAX && !/[.!?。！？]/.test(it); }
// meanings → { ok, meanings }. 유효한 뜻만 남기고 definition 은 ", " 로 정리한다. 하나도 없으면 ok=false
function validateGloss(meanings) {
  if (!Array.isArray(meanings)) return { ok: false, meanings: [] };
  const out = [];
  meanings.forEach(m => {
    if (!m || typeof m !== 'object') return;
    const items = splitDefinition(m.definition).filter(glossItemOk).slice(0, GLOSS_PER_MEANING);
    if (!items.length) return;
    out.push(Object.assign({}, m, { definition: items.join(', ') }));
  });
  return { ok: out.length > 0, meanings: out };
}
function deriveShortMeaning(meanings) {
  const heads = [];
  (Array.isArray(meanings) ? meanings : []).forEach(m => {
    const first = m && typeof m.definition === 'string' ? splitDefinition(m.definition)[0] : '';
    if (first && heads.indexOf(first) < 0 && heads.length < GLOSS_SHORT_MAX) heads.push(first);
  });
  return heads.join(', ');
}
// 뜻 하나의 definition 문자열 → 정리된 문자열, 유효 항목이 없으면 null (일괄 변환의 뜻 단위 검증)
function cleanDefinition(text) {
  const items = splitDefinition(text).filter(glossItemOk).slice(0, GLOSS_PER_MEANING);
  return items.length ? items.join(', ') : null;
}

module.exports = { GLOSS_ITEM_MAX, GLOSS_PER_MEANING, GLOSS_SHORT_MAX, splitDefinition, glossItemOk, validateGloss, deriveShortMeaning, cleanDefinition };
