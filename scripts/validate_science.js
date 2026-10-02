#!/usr/bin/env node
/**
 * validate_science.js — public/science_db.json 구조/길이/참조 검증 (작업153)
 *
 * science_db.json은 digest_db.json과 달리 저작물(문학 작품)이 아니라 확립된 과학
 * 지식을 다루므로 authors/rights 관련 규칙은 없음. 대신 각 concept이 출처
 * (sources)를 직접 갖고, 그중 최소 1개는 "1차"급이어야 한다.
 *
 * 규칙
 *   1. 최상위 키: version, last_updated, concepts(array)
 *   2. concepts.length === EXPECTED_TOTAL, 분야별 개수는 EXPECTED_FIELD_COUNTS와 일치
 *   3. 각 concept 필수 필드: id, title, field, level, one_line, summary,
 *      key_points, example, related, sources (misconception은 선택)
 *   4. field 값은 화이트리스트(물리/화학/생물/지구과학) 내에 있어야 함
 *   5. id/title은 전체에서 중복되지 않아야 함
 *   6. 길이 검사: one_line 20~40자, summary 350~550자, key_points는 정확히 3개
 *      각 20~80자, example 40~150자, misconception이 있으면 40~150자
 *   7. related[].id는 concepts 안에 실제로 존재하는 id여야 함(자기 자신 금지)
 *   8. sources는 최소 2개, tier는 "1차"/"보조" 화이트리스트 내, 최소 1개는 "1차"
 *   9. 모든 필수 문자열 필드는 trim() 후 길이 0이 아니어야 함(undefined/빈 문자열 금지)
 *   10. sources 중 tier가 "1차"이면서 note가 "직접열람"으로 시작하는 항목이 1개 이상
 *       있어야 함(작업154) - "부분확인"/"미열람" 출처만으로는 사실 주장을 뒷받침할 수 없음
 *   11. summary/key_points/misconception에 금지 일반화 표현이 없어야 함(작업154) -
 *       근거 범위를 벗어난 과장된 단정("널리 퍼져", "많은 사람", "대부분의 학생",
 *       "가장 흔한")을 막기 위함
 *   12. tier가 "1차"인 source는 note가 반드시 "직접열람"으로 시작해야 함(작업157) -
 *       "부분확인"인 1차 출처는 금지, 그런 출처는 tier를 "보조"로 낮출 것
 *   13. 어떤 source든 note가 "미열람"으로 시작하면 금지(작업157) - 열람 실패한
 *       출처는 애초에 sources 배열에 올리지 않음
 *
 * 사용법
 *   node scripts/validate_science.js          # 검증만, 위반 있으면 exit 1
 *   node scripts/validate_science.js <파일>   # 다른 파일 검사(규칙 테스트용 사본 등)
 */
const fs = require('fs');
const path = require('path');

const SCI_PATH = process.argv.slice(2).find(a => !a.startsWith('--')) ||
  path.join(__dirname, '..', 'public', 'science_db.json');

// 분야별 기대 개수(작업157: 물리/화학/생물/지구과학 각 4개, 총 16개로 확장)
const EXPECTED_FIELD_COUNTS = { '물리': 4, '화학': 4, '생물': 4, '지구과학': 4 };
const EXPECTED_TOTAL = Object.values(EXPECTED_FIELD_COUNTS).reduce((a, b) => a + b, 0);
const FIELD_WHITELIST = Object.keys(EXPECTED_FIELD_COUNTS);
const TIER_WHITELIST = ['1차', '보조'];
// 작업154: 근거 범위를 벗어난 일반화 표현 금지
const BANNED_PHRASES = ['널리 퍼져', '많은 사람', '대부분의 학생', '가장 흔한'];

const LENGTH_RULES = {
  one_line: [20, 40],
  summary: [350, 550],
  example: [40, 150],
  misconception: [40, 150],
};

const nonEmptyStr = v => typeof v === 'string' && v.trim().length > 0;
const lenOk = (v, [lo, hi]) => typeof v === 'string' && v.length >= lo && v.length <= hi;

const raw = fs.readFileSync(SCI_PATH, 'utf8');
const db = JSON.parse(raw);
const errors = [];

if (!nonEmptyStr(db.version)) errors.push('최상위 version 필드가 없음');
if (!nonEmptyStr(db.last_updated)) errors.push('최상위 last_updated 필드가 없음');
if (!Array.isArray(db.concepts)) {
  errors.push('최상위 concepts가 배열이 아님');
}

const concepts = Array.isArray(db.concepts) ? db.concepts : [];
const seenIds = new Set();
const seenTitles = new Set();
const allIds = new Set(concepts.map(c => c && c.id).filter(Boolean));

for (const c of concepts) {
  const label = c && c.id ? `${c.id} 「${c.title}」` : '(id 없는 concept)';

  for (const field of ['id', 'title', 'field', 'level', 'one_line', 'summary']) {
    if (!nonEmptyStr(c[field])) errors.push(`${label}: ${field} 필드가 없거나 빈 문자열`);
  }
  if (!Array.isArray(c.key_points)) errors.push(`${label}: key_points가 배열이 아님`);
  if (!nonEmptyStr(c.example)) errors.push(`${label}: example 필드가 없거나 빈 문자열`);
  if (!Array.isArray(c.related)) errors.push(`${label}: related가 배열이 아님`);
  if (!Array.isArray(c.sources)) errors.push(`${label}: sources가 배열이 아님`);

  if (nonEmptyStr(c.id)) {
    if (seenIds.has(c.id)) errors.push(`${label}: id 중복`);
    seenIds.add(c.id);
  }
  if (nonEmptyStr(c.title)) {
    if (seenTitles.has(c.title)) errors.push(`${label}: title 중복`);
    seenTitles.add(c.title);
  }

  if (nonEmptyStr(c.field) && !FIELD_WHITELIST.includes(c.field)) {
    errors.push(`${label}: field "${c.field}"는 화이트리스트(${FIELD_WHITELIST.join('/')})에 없음`);
  }

  for (const [key, range] of Object.entries(LENGTH_RULES)) {
    if (key === 'misconception') continue; // 선택 필드, 아래에서 별도 처리
    if (nonEmptyStr(c[key]) && !lenOk(c[key], range)) {
      errors.push(`${label}: ${key} 길이(${c[key].length}자)가 ${range[0]}~${range[1]}자 범위를 벗어남`);
    }
  }

  if (Array.isArray(c.key_points)) {
    if (c.key_points.length !== 3) {
      errors.push(`${label}: key_points는 정확히 3개여야 함(현재 ${c.key_points.length}개)`);
    }
    c.key_points.forEach((kp, i) => {
      if (!nonEmptyStr(kp)) {
        errors.push(`${label}: key_points[${i}]가 없거나 빈 문자열`);
      } else if (!lenOk(kp, [20, 80])) {
        errors.push(`${label}: key_points[${i}] 길이(${kp.length}자)가 20~80자 범위를 벗어남`);
      }
    });
  }

  // misconception은 선택 필드 - 있으면(undefined가 아니면) 길이 검사, 빈 문자열은 금지
  if (Object.prototype.hasOwnProperty.call(c, 'misconception')) {
    if (!nonEmptyStr(c.misconception)) {
      errors.push(`${label}: misconception 필드가 존재하지만 빈 문자열(사용 안 할 경우 필드 자체를 생략할 것)`);
    } else if (!lenOk(c.misconception, LENGTH_RULES.misconception)) {
      errors.push(`${label}: misconception 길이(${c.misconception.length}자)가 40~150자 범위를 벗어남`);
    }
  }

  if (Array.isArray(c.related)) {
    c.related.forEach((r, i) => {
      if (!r || !nonEmptyStr(r.id)) {
        errors.push(`${label}: related[${i}].id가 없음`);
        return;
      }
      if (r.id === c.id) errors.push(`${label}: related[${i}]가 자기 자신(${c.id})을 참조함`);
      if (!allIds.has(r.id)) errors.push(`${label}: related[${i}].id "${r.id}"가 concepts 안에 존재하지 않음`);
      if (!nonEmptyStr(r.relation)) {
        errors.push(`${label}: related[${i}].relation이 없거나 빈 문자열`);
      } else if (r.relation.length < 20 || r.relation.length > 50) {
        errors.push(`${label}: related[${i}].relation 길이(${r.relation.length}자)가 20~50자 범위를 벗어남`);
      }
    });
  }

  if (Array.isArray(c.sources)) {
    if (c.sources.length < 2) {
      errors.push(`${label}: sources는 최소 2개 필요(현재 ${c.sources.length}개)`);
    }
    let primaryCount = 0;
    let directPrimaryCount = 0;
    c.sources.forEach((s, i) => {
      for (const field of ['name', 'publisher', 'url', 'tier']) {
        if (!nonEmptyStr(s && s[field])) errors.push(`${label}: sources[${i}].${field}가 없거나 빈 문자열`);
      }
      if (s && !TIER_WHITELIST.includes(s.tier)) {
        errors.push(`${label}: sources[${i}].tier "${s.tier}"는 화이트리스트(${TIER_WHITELIST.join('/')})에 없음`);
      }
      if (s && s.tier === '1차') primaryCount++;
      if (s && s.tier === '1차' && nonEmptyStr(s.note) && s.note.startsWith('직접열람')) directPrimaryCount++;
      // 작업157 규칙 12: tier가 "1차"인 source는 note가 반드시 "직접열람"으로 시작해야 함
      // (부분확인 1차 출처 금지 - 그런 출처는 tier를 "보조"로 낮출 것)
      if (s && s.tier === '1차' && nonEmptyStr(s.note) && !s.note.startsWith('직접열람')) {
        errors.push(`${label}: sources[${i}]("${s.name}")는 tier가 "1차"이지만 note가 "직접열람"으로 시작하지 않음("${s.note.slice(0, 20)}...") - tier를 "보조"로 낮추거나 note를 수정할 것`);
      }
      // 작업157 규칙 13: 어떤 source든 note가 "미열람"으로 시작하면 금지
      if (s && nonEmptyStr(s.note) && s.note.startsWith('미열람')) {
        errors.push(`${label}: sources[${i}]("${s.name}")의 note가 "미열람"으로 시작함 - 열람 실패한 출처는 sources 배열에 올리지 않음`);
      }
    });
    if (primaryCount < 1) errors.push(`${label}: sources 중 1차급 출처가 1개 이상 있어야 함`);
    if (directPrimaryCount < 1) {
      errors.push(`${label}: sources 중 "1차"이면서 note가 "직접열람"으로 시작하는 출처가 1개 이상 있어야 함(부분확인/미열람 출처만으로는 사실 주장을 뒷받침할 수 없음)`);
    }
  }

  // 작업154: 근거 범위를 벗어난 일반화 표현 금지
  const textFieldsToCheck = { summary: c.summary, misconception: c.misconception };
  if (Array.isArray(c.key_points)) {
    c.key_points.forEach((kp, i) => { textFieldsToCheck[`key_points[${i}]`] = kp; });
  }
  for (const [fieldName, text] of Object.entries(textFieldsToCheck)) {
    if (typeof text !== 'string') continue;
    for (const phrase of BANNED_PHRASES) {
      if (text.includes(phrase)) {
        errors.push(`${label}: ${fieldName}에 금지 표현 "${phrase}"가 포함되어 있음`);
      }
    }
  }
}

if (concepts.length !== EXPECTED_TOTAL) {
  errors.push(`전체 concept 수(${concepts.length}) ≠ 기대값(${EXPECTED_TOTAL})`);
}
for (const [field, expectedCount] of Object.entries(EXPECTED_FIELD_COUNTS)) {
  const actual = concepts.filter(c => c.field === field).length;
  if (actual !== expectedCount) {
    errors.push(`분야 "${field}" concept 수(${actual}) ≠ 기대값(${expectedCount})`);
  }
}

const misconceptionCount = concepts.filter(c => Object.prototype.hasOwnProperty.call(c, 'misconception')).length;
console.log(`concept ${concepts.length}개 · 분야별 ${JSON.stringify(EXPECTED_FIELD_COUNTS)} · misconception 포함 ${misconceptionCount}개`);

if (errors.length) {
  console.error(`\n검증 실패 ${errors.length}건:`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('검증 통과');
