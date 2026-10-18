#!/usr/bin/env node
/**
 * validate_artist_notes.js — public/artist_notes_db.json 구조 검증 (작업131)
 *
 * 규칙
 *   1. 최상위: version, last_updated(YYYY-MM-DD), artists[] 필수, artist id 중복 금지
 *   2. 작가 필수 필드: id, name, field, birth_year, death_year, nationality, one_line, who, life,
 *      movement{name,text}, featured_works[2~3], other_works[], reputation{contemporary,posthumous}, summary, connected_artists[]
 *   3. field는 "음악" 또는 "미술"
 *   4. 고인만 수록: death_year는 정수이고 birth_year보다 커야 하며, 생존 작가용 필드(alive 등)는 없어야 함
 *   5. checked·sources는 비어 있으면 "미검증"으로 허용(작업132). 값이 있을 때만 형식 검사
 *   5a. (작업134) name=통용명, full_name=풀네임 필수(같아도 됨). movement.tags는 비어 있지 않은 문자열 배열.
 *       connected_artists는 0~3명, id는 null 또는 수록 작가 id. id가 있으면 상대 작가의 movement.tags와 하나 이상 겹쳐야 함(아니면 오류).
 *       수록 작가끼리 연결이 양방향이 아니면 경고(오류 아님). 카드 본문의 문단 구분("\n")은 글자 수에 넣지 않음
 *   5b. other_works: title·year 필수, note는 40자 이하(선택). connected_artists: name·reason 필수, reason 40자 이하, id는 null 또는 문자열
 *   6. 카드 한 장의 본문은 400자 이하 (who, life, movement.text, 대표작 1건=description+interpretation,
 *      reputation=contemporary+posthumous, summary)
 *   7. 작품·가사 원문용 필드(full_text, lyrics, text_original 등)가 있으면 오류
 *   8. (작업 AN-2) 최상위 quiz[]: id 중복 금지, type은 mcq|ox, artist_id는 실제 작가, verified_on은 날짜.
 *      mcq = question·options(4개, 정규화 후 서로 다른 실제 작가 name)·answer(보기 중 정확히 1개, artist_id 작가의 name).
 *      ox = statement·answer(boolean)·explanation 필수, claim_tag가 있으면 answer가 그 작가 movement.tags 포함 여부와 일치.
 *      basis[](artist_id, path, equals|includes)는 현재 JSON에서 풀리고 값이 일치해야 함(정답과 데이터의 어긋남을 잡음).
 *      글자 수 상한: 문항·진술 60자, 보기 20자, 해설 120자. 원문·미디어 금지 필드는 문항에도 적용
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
const REQUIRED_STR = ['id', 'name', 'full_name', 'field', 'nationality', 'one_line', 'who', 'life', 'summary'];
const SHORT_MAX = 40;
let unverified = 0;

const errors = [];
const warnings = [];
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
  if (!a.movement || !Array.isArray(a.movement.tags) || a.movement.tags.length === 0 || !a.movement.tags.every(isStr)) err('movement.tags는 비어 있지 않은 문자열 배열이어야 함');
  if (!a.reputation || !isStr(a.reputation.contemporary) || !isStr(a.reputation.posthumous)) err('reputation{contemporary,posthumous} 없음');
  const hasChecked = a.checked != null && a.checked !== '';
  const hasSources = Array.isArray(a.sources) && a.sources.length > 0;
  if (!hasChecked || !hasSources) unverified++;
  if (hasChecked && !isDate(a.checked)) err('checked가 YYYY-MM-DD 형식의 실제 날짜가 아님');
  if (a.sources != null && (!Array.isArray(a.sources) || !a.sources.every(u => /^https?:\/\/\S+$/.test(u)))) err('sources는 http(s) URL 배열이어야 함');

  if (!Array.isArray(a.other_works)) err('other_works는 배열이어야 함');
  else a.other_works.forEach((w, i) => {
    if (!isStr(w.title)) err(`other_works[${i}].title 없음`);
    if (!isStr(w.year)) err(`other_works[${i}].year 없음`);
    if (w.note != null && (!isStr(w.note) || len(w.note) > SHORT_MAX)) err(`other_works[${i}].note는 ${SHORT_MAX}자 이하 문자열`);
    for (const k of FORBIDDEN_KEYS) if (k in w) err(`other_works[${i}] 금지 필드 "${k}"`);
  });
  if (!Array.isArray(a.connected_artists)) err('connected_artists는 배열이어야 함');
  else if (a.connected_artists.length > 3) err('connected_artists는 0~3명이어야 함');
  if (Array.isArray(a.connected_artists)) a.connected_artists.forEach((c, i) => {
    if (!isStr(c.name)) err(`connected_artists[${i}].name 없음`);
    if (!isStr(c.reason) || len(c.reason) > SHORT_MAX) err(`connected_artists[${i}].reason은 ${SHORT_MAX}자 이하 문자열`);
    if (!('id' in c) || !(c.id === null || typeof c.id === 'string')) err(`connected_artists[${i}].id는 null 또는 문자열`);
    else if (c.id !== null) {
      const other = (db.artists || []).find(x => x.id === c.id);
      if (!other) err(`connected_artists[${i}].id "${c.id}"는 수록 작가가 아님`);
      else {
        const mine = (a.movement && a.movement.tags) || [], theirs = (other.movement && other.movement.tags) || [];
        if (!mine.some(t => theirs.includes(t))) err(`connected_artists[${i}] ${other.name}: movement.tags가 겹치지 않음(같은 사조만 연결)`);
        if (!(other.connected_artists || []).some(x => x && x.id === a.id)) warnings.push(`${a.name} → ${other.name} 연결이 양방향이 아님`);
      }
    }
  });

  if (!Array.isArray(a.featured_works) || a.featured_works.length < 2 || a.featured_works.length > 3) err('featured_works는 2~3개여야 함');
  else a.featured_works.forEach((w, i) => {
    for (const k of ['title', 'year', 'description', 'interpretation']) if (!isStr(w[k])) err(`featured_works[${i}].${k} 없음`);
    for (const k of FORBIDDEN_KEYS) if (k in w) err(`featured_works[${i}] 금지 필드 "${k}"`);
  });

  const card = (name, text) => { const n = len(String(text).replace(/\n/g, '')); if (n > CARD_MAX) err(`${name} ${n}자 - 카드 본문은 ${CARD_MAX}자 이하`); };
  card('who', a.who || '');
  card('life', a.life || '');
  card('movement.text', (a.movement && a.movement.text) || '');
  (a.featured_works || []).forEach((w, i) => card(`featured_works[${i}](description+interpretation)`, (w.description || '') + (w.interpretation || '')));
  card('reputation(contemporary+posthumous)', ((a.reputation && a.reputation.contemporary) || '') + ((a.reputation && a.reputation.posthumous) || ''));
  card('summary', a.summary || '');
}

// ── 퀴즈 (작업 AN-2) ──
// 문항은 JSON의 최상위 quiz[]에 따로 쓰고, 모든 문항이 basis[](근거 참조)로 현재 데이터와 대조된다.
const QUIZ_LIMIT = { question: 60, statement: 60, option: 20, explanation: 120 };
const norm = s => String(s).normalize('NFC').replace(/\s+/g, '');
function resolvePath(obj, p) {
  let cur = obj;
  for (const t of String(p).match(/[^.[\]]+/g) || []) {
    if (cur == null) return undefined;
    cur = cur[/^\d+$/.test(t) ? Number(t) : t];
  }
  return cur;
}
const quizStat = { mcq: 0, ox: 0, o: 0, x: 0, byArtist: {} };
const quiz = db.quiz;
if (!Array.isArray(quiz)) errors.push('최상위 quiz[]가 없거나 배열이 아님');
else {
  const byId = new Map((db.artists || []).map(a => [a.id, a]));
  const quizIds = new Set();
  quiz.forEach((q, i) => {
    const label = `quiz[${i}] ${q && q.id || '(id 없음)'}`;
    const err = m => errors.push(`${label}: ${m}`);
    if (!q || typeof q !== 'object') { err('객체가 아님'); return; }
    if (!isStr(q.id)) err('id 없음'); else { if (quizIds.has(q.id)) err('id 중복'); quizIds.add(q.id); }
    if (q.type !== 'mcq' && q.type !== 'ox') err(`type은 mcq 또는 ox여야 함 (현재 "${q.type}")`);
    for (const k of FORBIDDEN_KEYS) if (k in q) err(`금지 필드 "${k}"`);
    const owner = byId.get(q.artist_id);
    if (!owner) err(`artist_id "${q.artist_id}"가 실제 작가 id가 아님`);
    if (!isDate(q.verified_on)) err('verified_on이 YYYY-MM-DD 형식의 실제 날짜가 아님');
    if (q.type === 'mcq') {
      if (!isStr(q.question)) err('question 없음'); else if (len(q.question) > QUIZ_LIMIT.question) err(`question ${len(q.question)}자 - ${QUIZ_LIMIT.question}자 이하`);
      if (!Array.isArray(q.options) || q.options.length !== 4) err('options는 4개여야 함');
      else {
        if (!q.options.every(isStr)) err('options에 빈 값이 있음');
        else {
          if (new Set(q.options.map(norm)).size !== 4) err('options가 정규화한 뒤 서로 같은 값을 포함');
          const names = new Set((db.artists || []).map(a => a.name));
          q.options.forEach(o => { if (!names.has(o)) err(`보기 "${o}"가 실제 작가 name이 아님`); if (len(o) > QUIZ_LIMIT.option) err(`보기 "${o}" ${len(o)}자 - ${QUIZ_LIMIT.option}자 이하`); });
          if (q.options.filter(o => o === q.answer).length !== 1) err('answer가 options 중 정확히 1개와 같아야 함');
        }
      }
      if (owner && q.answer !== owner.name) err(`answer "${q.answer}"가 artist_id 작가의 name("${owner.name}")과 다름`);
      if ('statement' in q || 'explanation' in q) err('mcq에 ox 전용 필드(statement/explanation)가 있음');
      quizStat.mcq++;
    } else if (q.type === 'ox') {
      if (!isStr(q.statement)) err('statement 없음'); else if (len(q.statement) > QUIZ_LIMIT.statement) err(`statement ${len(q.statement)}자 - ${QUIZ_LIMIT.statement}자 이하`);
      if (typeof q.answer !== 'boolean') err('answer는 boolean이어야 함'); else { if (q.answer) quizStat.o++; else quizStat.x++; }
      if (!isStr(q.explanation)) err('explanation 없음'); else if (len(q.explanation) > QUIZ_LIMIT.explanation) err(`explanation ${len(q.explanation)}자 - ${QUIZ_LIMIT.explanation}자 이하`);
      if ('claim_tag' in q) {
        if (!isStr(q.claim_tag)) err('claim_tag가 빈 값');
        else if (owner && typeof q.answer === 'boolean') {
          const has = ((owner.movement && owner.movement.tags) || []).includes(q.claim_tag);
          if (q.answer !== has) err(`claim_tag "${q.claim_tag}"는 ${owner.name}의 movement.tags에 ${has ? '있으므로 answer=true' : '없으므로 answer=false'}여야 함`);
        }
      }
      if ('options' in q || 'question' in q) err('ox에 mcq 전용 필드(options/question)가 있음');
      quizStat.ox++;
    }
    if (!Array.isArray(q.basis) || q.basis.length === 0) err('basis[](근거 참조)가 없음');
    else q.basis.forEach((b, j) => {
      const bl = `basis[${j}]`;
      const a = b && byId.get(b.artist_id);
      if (!a) { err(`${bl}: artist_id "${b && b.artist_id}"가 실제 작가 id가 아님`); return; }
      if (!isStr(b.path)) { err(`${bl}: path 없음`); return; }
      const hasEq = 'equals' in b, hasInc = 'includes' in b;
      if (hasEq === hasInc) { err(`${bl}: equals와 includes 중 하나만 있어야 함`); return; }
      const v = resolvePath(a, b.path);
      if (v === undefined) { err(`${bl}: path "${b.path}"가 ${a.name} 데이터에서 풀리지 않음`); return; }
      if (hasEq) { if (v !== b.equals) err(`${bl}: ${a.name}.${b.path} = ${JSON.stringify(v)} ≠ equals ${JSON.stringify(b.equals)}`); }
      else if (Array.isArray(v)) { if (!v.includes(b.includes)) err(`${bl}: ${a.name}.${b.path}에 ${JSON.stringify(b.includes)} 없음`); }
      else if (typeof v === 'string') { if (!v.includes(b.includes)) err(`${bl}: ${a.name}.${b.path}에 문구 ${JSON.stringify(b.includes)}가 들어 있지 않음`); }
      else err(`${bl}: ${a.name}.${b.path}가 includes를 쓸 수 없는 값(문자열·배열 아님)`);
    });
    if (owner) quizStat.byArtist[owner.name] = (quizStat.byArtist[owner.name] || 0) + 1;
  });
}

warnings.forEach(w => console.warn('경고: ' + w));
if (errors.length) {
  console.error(`artist_notes 검증 실패 (${errors.length}건)`);
  errors.forEach(e => console.error(' - ' + e));
  process.exit(1);
}
console.log(`artist_notes 검증 통과: 작가 ${db.artists.length}명 (${FIELDS.map(f => f + ' ' + db.artists.filter(a => a.field === f).length).join(', ')}), 미검증 작가 ${unverified}명`);
console.log(`퀴즈 문항 ${quizStat.mcq + quizStat.ox}개 (4지선다 ${quizStat.mcq}, OX ${quizStat.ox}: O ${quizStat.o} / X ${quizStat.x}), 작가별 ${Object.entries(quizStat.byArtist).map(([n, c]) => n + ' ' + c).join(', ')}`);
