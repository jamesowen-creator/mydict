#!/usr/bin/env node
/**
 * validate_digest.js — public/digest_db.json 저작권/전문(full_text) 검증 (작업91)
 *
 * 규칙
 *   1. 모든 작품의 author는 최상위 authors 맵에 사망 연도(death_year)가 있어야 함
 *   2. rights.author_death_year / rights.status는 authors 맵에서 계산한 값과 같아야 함
 *      - 1962년 이하 사망 → public_domain (2013-07-01 사후 70년 연장 전에
 *        옛 기준 사후 50년으로 이미 만료, 저작권법 부칙 법률 제10807호 제2조)
 *      - 1963년 이후 사망 → protected (사후 70년, 사망 다음 해부터 기산)
 *   3. full_text가 있는 작품은 반드시 public_domain이어야 함 - 보호 중인 작품의
 *      원문이 실수로 배포되는 것을 막는 안전장치
 *   4. full_text 모양: { stanzas: [[줄, ...], ...], source: "출전" } (사람이 원전에서
 *      입력한 것만. generate_literature_content.js 같은 AI 생성으로 채우지 않음)
 *
 * 사용법
 *   node scripts/validate_digest.js          # 검증만, 위반 있으면 exit 1
 *   node scripts/validate_digest.js --fix    # rights를 authors 맵 기준으로 다시 채운 뒤 검증
 *   node scripts/validate_digest.js <파일>   # 다른 파일 검사 (규칙 테스트용 사본 등)
 */
const fs = require('fs');
const path = require('path');

// 경로 인자를 주면 그 파일을 검사 (규칙 테스트용 사본 등), 없으면 실제 데이터
const DIG_PATH = process.argv.slice(2).find(a => !a.startsWith('--')) ||
  path.join(__dirname, '..', 'public', 'digest_db.json');
// 이 연도 이하에 사망한 작가의 저작물은 퍼블릭도메인 (위 규칙 2 참고)
const PD_LAST_DEATH_YEAR = 1962;

const fix = process.argv.includes('--fix');
const raw = fs.readFileSync(DIG_PATH, 'utf8');
const db = JSON.parse(raw);
const authors = db.authors || {};
const errors = [];

const statusFor = deathYear => (deathYear <= PD_LAST_DEATH_YEAR ? 'public_domain' : 'protected');

for (const w of db.works) {
  const label = `${w.id} 「${w.title}」(${w.author})`;
  const a = authors[w.author];
  if (!a || !Number.isInteger(a.death_year)) {
    errors.push(`${label}: authors 맵에 사망 연도(death_year)가 없음`);
    continue;
  }
  const expected = statusFor(a.death_year);

  if (fix) {
    w.rights = {
      status: expected,
      author_death_year: a.death_year,
      checked: (w.rights && w.rights.checked) || new Date().toISOString().slice(0, 10),
    };
  }

  const r = w.rights;
  if (!r) {
    errors.push(`${label}: rights 필드 없음 (--fix로 채울 수 있음)`);
    continue;
  }
  if (r.author_death_year !== a.death_year) {
    errors.push(`${label}: rights.author_death_year(${r.author_death_year}) ≠ authors 맵(${a.death_year})`);
  }
  if (r.status !== expected) {
    errors.push(`${label}: rights.status "${r.status}" ≠ 계산값 "${expected}" (사망 ${a.death_year})`);
  }

  if (w.full_text !== undefined) {
    if (expected !== 'public_domain') {
      errors.push(`${label}: 저작권 보호 중(사망 ${a.death_year}, ${a.death_year + 70}-12-31까지)인 작품에 full_text가 있음 - 원문 게재 불가`);
    }
    const ft = w.full_text;
    const shapeOk = ft && Array.isArray(ft.stanzas) && ft.stanzas.length > 0 &&
      ft.stanzas.every(s => Array.isArray(s) && s.length > 0 && s.every(l => typeof l === 'string'));
    if (!shapeOk) errors.push(`${label}: full_text.stanzas는 [[줄, ...], ...] 형태의 비어 있지 않은 배열이어야 함`);
    if (!ft || typeof ft.source !== 'string' || !ft.source.trim()) errors.push(`${label}: full_text.source(출전)가 없음`);
  }
}

if (fix && !errors.some(e => e.includes('authors 맵에'))) {
  // 원본 포맷 유지: 2칸 들여쓰기, 끝 줄바꿈 여부 그대로
  fs.writeFileSync(DIG_PATH, JSON.stringify(db, null, 2) + (raw.endsWith('\n') ? '\n' : ''), 'utf8');
  console.log('rights 필드를 authors 맵 기준으로 갱신함');
}

const count = s => db.works.filter(w => w.rights && w.rights.status === s).length;
const withText = db.works.filter(w => w.full_text !== undefined).length;
console.log(`작품 ${db.works.length}편 · public_domain ${count('public_domain')} · protected ${count('protected')} · full_text ${withText}편`);

if (errors.length) {
  console.error(`\n검증 실패 ${errors.length}건:`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('검증 통과');
