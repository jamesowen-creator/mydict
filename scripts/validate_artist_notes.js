#!/usr/bin/env node
/**
 * validate_artist_notes.js — public/artist_notes_db.json 구조 검증 (작업131)
 *
 * 규칙
 *   1. 최상위: version, last_updated(YYYY-MM-DD), artists[] 필수, artist id 중복 금지
 *   2. 작가 필수 필드: id, name, field, birth_year, death_year, nationality, one_line, who, life,
 *      movement{name,text}, works[2~3], reputation{contemporary,posthumous}, summary, see_also[], checked, sources[]
 *   3. field는 "음악" 또는 "미술"
 *   4. 고인만 수록: death_year는 정수이고 birth_year보다 커야 하며, 생존 작가용 필드(alive 등)는 없어야 함
 *   5. checked는 YYYY-MM-DD 형식의 실제 날짜, sources는 http(s) URL 1개 이상
 *   6. 카드 한 장의 본문은 400자 이하 (who, life, movement.text, 대표작 1건=description+interpretation,
 *      reputation=contemporary+posthumous, summary)
 *   7. 작품·가사 원문용 필드(full_text, lyrics, text_original 등)가 있으면 오류
 *
 * 한입 독서의 저작권 사망연도 검증과 장르별 편수 상수는 쓰지 않음(데이터가 서로 독립).
 *
 * 사용법
 *   node scripts/validate_artist_notes.js            # 실제 데이터 검사, 위반 시 exit 1
 *   node scripts/validate_artist_notes.js <파일>     # 다른 파일 검사
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = process.argv.slice(2).find(a => !a.startsWith('--')) ||
  path.join(__dirname, '..', 'public', 'artist_notes_db.json');
const FIELDS = ['음악', '미술'];
const CARD_MAX = 400;
const FORBIDDEN_KEYS = ['full_text', 'lyrics', 'lyric', 'text_original', 'original_text', 'score', 'alive', 'image', 'images', 'audio'];
const REQUIRED_STR = ['id', 'name', 'field', 'nationality', 'one_line', 'who', 'life', 'summary', 'checked'];

const errors = [];
const isStr = v => typeof v === 'string' && v.trim() !== '';
const isInt = v => Number.isInteger(v);
function isDate(s) {
  if (!isStr(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const len = s => [...String(s)].length;

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
if (!isStr(db.version)) errors.push('최상위 version 없음');
if (!isDate(db.last_updated)) errors.push('최상위 last_updated가 YYYY-MM-DD 형식이 아님');
if (!Array.isArray(db.artists) || db.artists.length === 0) errors.push('최상위 artists[]가 비어 있거나 배열이 아님');

const seen = new Set();
for (const a of db.artists || []) {
  const label = `${a.id || '(id 없음)'} ${a.name || ''}`.trim();
  const err = m => errors.push(`${label}: ${m}`);

  for (const k of REQUIRED_STR) if (!isStr(a[k])) err(`${k} 없음`);
  if (isStr(a.id)) { if (seen.has(a.id)) err('id 중복'); seen.add(a.id); }
  if (isStr(a.field) && !FIELDS.includes(a.field)) err(`field는 ${FIELDS.join('/')} 중 하나여야 함 (현재 "${a.field}")`);

  if (!isInt(a.birth_year)) err('birth_year가 정수가 아님');
  if (!isInt(a.death_year)) err('death_year 없음 - 고인만 수록 (생존 작가는 넣지 않음)');
  else if (isInt(a.birth_year) && a.death_year <= a.birth_year) err('death_year가 birth_year보다 커야 함');

  for (const k of FORBIDDEN_KEYS) if (k in a) err(`금지 필드 "${k}" (가사·원문·이미지·음원은 싣지 않음)`);

  if (!a.movement || !isStr(a.movement.name) || !isStr(a.movement.text)) err('movement{name,text} 없음');
  if (!a.reputation || !isStr(a.reputation.contemporary) || !isStr(a.reputation.posthumous)) err('reputation{contemporary,posthumous} 없음');
  if (!Array.isArray(a.see_also) || !a.see_also.every(isStr)) err('see_also는 문자열 배열이어야 함');
  if (!isDate(a.checked)) err('checked가 YYYY-MM-DD 형식의 실제 날짜가 아님');
  if (!Array.isArray(a.sources) || a.sources.length < 1 || !a.sources.every(s => /^https?:\/\/\S+$/.test(s))) err('sources는 http(s) URL 1개 이상이어야 함');

  if (!Array.isArray(a.works) || a.works.length < 2 || a.works.length > 3) err('works는 2~3개여야 함');
  else a.works.forEach((w, i) => {
    for (const k of ['title', 'year', 'description', 'interpretation']) if (!isStr(w[k])) err(`works[${i}].${k} 없음`);
    for (const k of FORBIDDEN_KEYS) if (k in w) err(`works[${i}] 금지 필드 "${k}"`);
  });

  const card = (name, text) => { const n = len(text); if (n > CARD_MAX) err(`${name} ${n}자 - 카드 본문은 ${CARD_MAX}자 이하`); };
  card('who', a.who || '');
  card('life', a.life || '');
  card('movement.text', (a.movement && a.movement.text) || '');
  (a.works || []).forEach((w, i) => card(`works[${i}](description+interpretation)`, (w.description || '') + (w.interpretation || '')));
  card('reputation(contemporary+posthumous)', ((a.reputation && a.reputation.contemporary) || '') + ((a.reputation && a.reputation.posthumous) || ''));
  card('summary', a.summary || '');
}

if (errors.length) {
  console.error(`artist_notes 검증 실패 (${errors.length}건)`);
  errors.forEach(e => console.error(' - ' + e));
  process.exit(1);
}
console.log(`artist_notes 검증 통과: 작가 ${db.artists.length}명 (${FIELDS.map(f => f + ' ' + db.artists.filter(a => a.field === f).length).join(', ')})`);
