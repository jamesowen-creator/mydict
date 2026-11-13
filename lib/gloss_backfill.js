// 작업417: 저장된 영어 단어 뜻 일괄 변환(관리자 전용). 416 의 뜻 표현 원칙으로 meanings[].definition 을 덮어쓴다.
// - 변환 전 data 는 gloss_backup 에 보관하고, 행마다 낙관적 조건(data = 읽은 값)으로만 쓴다. 그 사이 사용자가 고친 행은 건너뛴다.
// - 표지 gloss_v=1 이 없는 행만 대상이라 중단·재실행이 안전하다(멱등).
// - 실제 AI 호출은 deps.callModel 로 바꿔 끼울 수 있다(시험은 가짜 함수 주입).
'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const G = require('./gloss');
const dbmod = require('./db');

const GLOSS_MODEL = 'claude-haiku-4-5-20251001';   // 개념 지도 CMAP_MODEL 과 같은 Haiku
const GLOSS_EVENT = 'gloss_backfill';
// 예상 비용 단가(달러/백만 토큰). routes/admin.js calcCost 의 Haiku 단가와 같다
const GLOSS_PRICE_IN = 1.00;
const GLOSS_PRICE_OUT = 5.00;
const BATCH_SIZE = 20;                 // 한 호출에 담는 단어 수
const MAX_BATCHES_PER_REQUEST = 5;     // 한 요청 처리 상한(100단어 안팎)
// 작업421: 한 요청의 시간 예산. 이 시간이 지나면 새 배치를 시작하지 않고 거기까지의 결과와 남은 수를 돌려준다.
// 근거: 배치 하나의 최악 시간 = AI 호출 최대 2회(재시도 포함) × AI_TIMEOUT_MS 60초 = 120초이므로, 예산 45초 + 120초 = 최대 약 165초.
// 프록시(Railway)의 요청 시간 한도는 코드·설정에서 확인되지 않아 보수적으로 짧게 잡았다(Node 기본 requestTimeout 300초 안).
const TIME_BUDGET_MS = 45000;
const MAX_TOKENS = 3000;
const AI_TIMEOUT_MS = 60000;
const SAMPLE_SIZE = 12;
const RESTORE_PER_REQUEST = 500;
const FAILED_WORDS_PER_RESPONSE = 100;

// ───── SQL: 대상 조건은 한 곳에서만 정의한다 ─────
const HAS_MEANINGS = `CASE WHEN jsonb_typeof(data->'meanings') = 'array' THEN jsonb_array_length(data->'meanings') ELSE 0 END >= 1`;
const IS_TARGET = `lang = 'en' AND data IS NOT NULL AND NOT (data ? 'gloss_v') AND ${HAS_MEANINGS}`;
const SQL = {
  targets: `SELECT id, user_id, word, data FROM wordbook WHERE ${IS_TARGET} AND id > $1 ORDER BY id LIMIT $2`,
  countTargets: `SELECT COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS users FROM wordbook WHERE ${IS_TARGET}`,
  countRemaining: `SELECT COUNT(*)::int AS n FROM wordbook WHERE ${IS_TARGET} AND id > $1`,
  countLegacy: `SELECT COUNT(*)::int AS n FROM wordbook WHERE lang = 'en' AND NOT (data IS NOT NULL AND data ? 'gloss_v') AND NOT (data IS NOT NULL AND ${HAS_MEANINGS})`,
  countDone: `SELECT COUNT(*)::int AS n FROM wordbook WHERE lang = 'en' AND data IS NOT NULL AND data ? 'gloss_v'`,
  sampleLong: `SELECT id, user_id, word, data FROM (SELECT id, user_id, word, data FROM wordbook WHERE ${IS_TARGET} ORDER BY (SELECT COALESCE(MAX(length(m->>'definition')), 0) FROM jsonb_array_elements(data->'meanings') m) DESC LIMIT 100) t ORDER BY random() LIMIT $1`,
  sampleRandom: `SELECT id, user_id, word, data FROM wordbook WHERE ${IS_TARGET} AND NOT (id = ANY($2::int[])) ORDER BY random() LIMIT $1`,
  // 작업420: 단어 지정 샘플 — 철자(대소문자 무시) 정확 일치, 같은 철자는 가장 앞 행 하나
  sampleWords: `SELECT DISTINCT ON (lower(word)) id, user_id, word, data FROM wordbook WHERE ${IS_TARGET} AND lower(word) = ANY($1::text[]) ORDER BY lower(word), id`,
  // 백업 기록과 교체를 한 문장으로: 조건이 맞아 교체된 행만 백업이 남는다
  apply: `WITH upd AS (UPDATE wordbook SET data = $3::jsonb WHERE id = $1 AND data = $2::jsonb RETURNING id) INSERT INTO gloss_backup (run_id, wordbook_id, before, after) SELECT $4, $1, $2::jsonb, $3::jsonb FROM upd`,
  backupRows: `SELECT id, wordbook_id, before, after FROM gloss_backup WHERE run_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`,
  backupRowsAll: `SELECT id, wordbook_id, before, after FROM gloss_backup WHERE id < $1 ORDER BY id DESC LIMIT $2`,
  restore: `UPDATE wordbook SET data = $3::jsonb WHERE id = $1 AND data = $2::jsonb`,
  backupDownload: `SELECT wordbook_id, before, after, created_at FROM gloss_backup WHERE run_id = $1 ORDER BY id`,
};

// ───── 프롬프트: 416 원칙 문구 그대로 + 변환용 덧붙임 ─────
const PRINCIPLE = "뜻 표현 원칙: 한국어 뜻은 문장이 아니라, 학습자가 바로 떠올릴 수 있는 직관적인 한국어 단어나 짧은 구로 쓴다. '~하는 것', '무언가를 ~' 같은 사전식 문장체, 마침표, 설명 덧붙이기를 쓰지 않는다. 뜻이 여럿이면 중요한 순서대로 모두 쓴다. meanings[].definition에는 그 뜻의 대응어를 2~3개 쉼표로 나열한다. 쓰임·뉘앙스·상황 설명은 2차 usage_note가 맡으므로 definition에 넣지 않는다. 예(형식 참고용, 해당 단어에만 해당): scrutinize → 신중하게 검토하다, 정밀 조사하다 / ambiguous → 애매한, 모호한 / run → (뜻1) 달리다, 뛰다 (뜻2) 운영하다, 경영하다 (뜻3) 흐르다.";
// 작업420: 고유명사·설명형 풀이 보완 규칙(english_dictionary.html 1차 프롬프트에도 같은 문구가 있다)
const NAME_RULE = "대응하는 한국어 단어가 없는 고유명사·브랜드·전문용어·신화·인물·지명은 '무엇인지'를 20자 이내의 짧은 명사구로 쓴다(마침표·서술어 문장 금지). 설명이 길면 핵심 명사만 남기고 세부는 쓰지 않는다(세부는 usage_note가 맡는다). 예(형식 참고용, 해당 단어에만 해당): Metis → 그리스 신화의 지혜의 여신, 캐나다의 혼혈 원주민 집단 / wordmark → 글자로만 만든 로고.";
const NO_DESCRIBE_RULE = "'~하는', '~인', '~것'으로 끝나는 설명형 풀이는 쓰지 말고 대응 단어로 쓴다(예: 성실하고 꼼꼼한, 열심인).";
// 재시도(통과 못 한 단어만 다시 호출)에 덧붙는 안내
const RETRY_NOTE = '재시도: 입력의 previous_failure에 직전 응답에서 검증에 실패한 항목(meaning 번호, text, reason)이 있다. 그 이유(20자 초과, 문장 부호 포함, 뜻 개수 불일치 등)를 고쳐 더 짧은 명사구로 다시 쓸 것. 뜻 개수와 순서는 입력과 같게 유지할 것.';
const SYSTEM_PROMPT = [
  'You are an English dictionary assistant for a Korean learner. You rewrite the Korean definitions of already-saved English words.',
  PRINCIPLE,
  NAME_RULE,
  NO_DESCRIBE_RULE,
  '- 각 단어의 뜻 개수와 순서를 바꾸지 말 것. definition만 새 표현으로 바꾸고, 품사(pos)별 의미 구분은 유지할 것.',
  '- 입력은 [{"id", "word", "meanings":[{"pos","definition"}]}] 형태의 JSON 배열이다. definition은 현재 저장된 표현이다.',
  '- 출력은 JSON만. 형식: [{"id": 입력 id 그대로, "meanings": [{"definition": "새 표현"}]}] — 입력과 같은 id 집합, 단어마다 입력과 같은 길이의 meanings.',
  'YOUR ENTIRE RESPONSE MUST BE A SINGLE VALID JSON ARRAY ONLY.',
].join('\n');

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isLongOld = s => typeof s === 'string' && (Array.from(s).length > G.GLOSS_ITEM_MAX || /[.!?。！？]/.test(s));

function toInput(row) {
  return { id: row.id, word: row.word, meanings: row.data.meanings.map(m => ({ pos: isObj(m) && typeof m.pos === 'string' ? m.pos : '', definition: isObj(m) && typeof m.definition === 'string' ? m.definition : '' })) };
}

// ───── 모델 호출 ─────
// 성공하면 응답 본문(text), 실패하면 throw. 사용량은 호출이 끝난 뒤 기록한다
async function defaultCallModel(userId, inputs, deps, opts) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: GLOSS_MODEL, max_tokens: MAX_TOKENS, temperature: 0, system: opts && opts.retry ? SYSTEM_PROMPT + '\n' + RETRY_NOTE : SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(inputs) }],
  }, { timeout: AI_TIMEOUT_MS });
  const u = message.usage || {};
  deps.trackUsage(userId, GLOSS_EVENT, GLOSS_MODEL, u.input_tokens, u.output_tokens, 0);
  const block = message.content && message.content[0];
  return block && block.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

function parseArray(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const tryParse = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : (isObj(v) && Array.isArray(v.words) ? v.words : null); } catch (e) { return null; } };
  const direct = tryParse(t);
  if (direct) return direct;
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  return a >= 0 && b > a ? tryParse(t.slice(a, b + 1)) : null;
}

// 실패 이유 라벨(화면·재시도 안내용)
const REASON = { long: '20자 초과', punct: '문장 부호 포함', count: '뜻 개수 불일치', parse: '응답 해석 실패', empty: '비어 있음', shape: '기존 뜻 구조 이상' };
const clip = t => { const a = Array.from(String(t)); return a.length > 60 ? a.slice(0, 60).join('') + '…' : a.join(''); };
// 판정 규칙은 lib/gloss.js 그대로(작업417과 같다). 실패하면 이유와 실패 항목(최대 3개, 60자까지)을 함께 돌려준다.
// 416 클라이언트 검증(무효 뜻을 지우고 남김)과 달리 여기서는 "뜻 개수 보존"이 필요해서, 무효 뜻이 하나라도 있으면 그 단어 전체를 실패로 본다.
function diagnoseWord(input, out) {
  if (!isObj(out)) return { reason: REASON.parse, items: [] };
  if (!Array.isArray(out.meanings) || out.meanings.length !== input.meanings.length) return { reason: REASON.count, items: [] };
  const defs = [], bad = [];
  out.meanings.forEach((m, i) => {
    const raw = isObj(m) && typeof m.definition === 'string' ? m.definition : '';
    const d = G.cleanDefinition(raw);
    if (d) { defs.push(d); return; }
    const items = G.splitDefinition(raw);
    if (!items.length) bad.push({ meaning: i + 1, text: '', reason: REASON.empty });
    else items.forEach(it => bad.push({ meaning: i + 1, text: clip(it), reason: Array.from(it).length > G.GLOSS_ITEM_MAX ? REASON.long : REASON.punct }));
  });
  return bad.length ? { reason: bad[0].reason, items: bad.slice(0, 3) } : { defs };
}
const checkWord = (input, out) => diagnoseWord(input, out).defs || null;

// 호출 1회 + 검증. 통과한 단어(id → 새 definition 배열), 통과 못 한 row 목록, 그 이유(id → { reason, items }).
// prev(id → 이유)가 있으면 재시도다: 입력에 previous_failure 를 붙이고 deps.callModel 에 { retry: true } 를 넘긴다
async function callAndCheck(userId, rows, deps, prev) {
  const ok = new Map(), reasons = new Map();
  let parsed = null;
  const inputs = rows.map(r => { const i = toInput(r); if (prev && prev.get(r.id)) i.previous_failure = prev.get(r.id); return i; });
  try { parsed = parseArray(await deps.callModel(userId, inputs, deps, prev ? { retry: true } : undefined)); } catch (e) { console.error('gloss ai error:', e && e.name, (e && e.status) || ''); }
  const byId = new Map();
  (parsed || []).forEach(o => { if (isObj(o) && o.id != null) byId.set(Number(o.id), o); });
  const failed = [];
  rows.forEach(r => {
    const d = diagnoseWord(toInput(r), byId.get(r.id));
    if (d.defs) ok.set(r.id, d.defs); else { failed.push(r); reasons.set(r.id, { reason: d.reason, items: d.items }); }
  });
  return { ok, failed, reasons };
}

// 호출 1회 + (통과 못 한 단어만, 실패 이유를 알려 주며) 재시도 1회. 뜻이 객체가 아니거나 definition 이 빈 구조는 모델에 보내지 않고 바로 실패로 본다
async function convertRows(userId, rows, deps) {
  const sendable = rows.filter(r => r.data.meanings.every(m => isObj(m) && typeof m.definition === 'string' && m.definition.trim()));
  const unsendable = rows.filter(r => !sendable.includes(r));
  const shape = new Map(unsendable.map(r => [r.id, { reason: REASON.shape, items: [] }]));
  if (!sendable.length) return { ok: new Map(), failed: unsendable, calls: 0, reasons: shape };
  const first = await callAndCheck(userId, sendable, deps);
  let calls = 1;
  const ok = first.ok;
  let failed = first.failed, reasons = first.reasons;
  if (failed.length) {
    const second = await callAndCheck(userId, failed, deps, first.reasons);
    calls++;
    second.ok.forEach((v, k) => ok.set(k, v));
    failed = second.failed; reasons = second.reasons;
  }
  shape.forEach((v, k) => reasons.set(k, v));
  return { ok, failed: failed.concat(unsendable), calls, reasons };
}

// ───── 새 data 만들기(순수) ─────
// 뜻 개수·순서·pos 와 그 밖 필드는 보존. definition 덮어쓰기, short_meaning 재생성, gloss_v=1, short_gloss 제거.
// 옛 definition 이 길어 정리 전 내용을 잃게 되고 그 뜻의 usage_note 가 비어 있으면 옛 내용을 usage_note 로 옮긴다(있으면 버림).
function buildAfter(before, defs) {
  const after = Object.assign({}, before);
  delete after.short_gloss;
  after.meanings = before.meanings.map((m, i) => {
    const nm = Object.assign({}, m, { definition: defs[i] });
    const empty = typeof m.usage_note !== 'string' || !m.usage_note.trim();
    if (isLongOld(m.definition) && empty) nm.usage_note = m.definition.trim();
    return nm;
  });
  after.short_meaning = G.deriveShortMeaning(after.meanings);
  after.gloss_v = 1;
  return after;
}

function newRunId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

let running = false;
async function runLocked(fn) {
  if (running) return { busy: true };
  running = true;
  try { return { value: await fn() }; } finally { running = false; }
}

// ───── 상태 ─────
function estimate(n) {
  const calls = Math.ceil(n / BATCH_SIZE);
  const inTok = calls * 300 + n * 90, outTok = n * 90;
  const cost = inTok / 1e6 * GLOSS_PRICE_IN + outTok / 1e6 * GLOSS_PRICE_OUT;
  return { est_calls: calls, est_input_tokens: inTok, est_output_tokens: outTok, est_cost_usd: +cost.toFixed(4), cost_estimated: true };
}
async function status(deps) {
  const t = (await deps.pool.query(SQL.countTargets)).rows[0] || {};
  const legacy = (await deps.pool.query(SQL.countLegacy)).rows[0] || {};
  const done = (await deps.pool.query(SQL.countDone)).rows[0] || {};
  const n = Number(t.n) || 0;
  return { targets: n, users: Number(t.users) || 0, legacy: Number(legacy.n) || 0, converted: Number(done.n) || 0, batch_size: BATCH_SIZE, model: GLOSS_MODEL, price_in: GLOSS_PRICE_IN, price_out: GLOSS_PRICE_OUT, ...estimate(n) };
}

// ───── 샘플(DB 에 쓰지 않는다) ─────
// words 가 있으면(최대 5개, 소문자) 무작위 12개 대신 그 철자의 대상 행만 변환한다. 대상이 아니거나 없는 철자는 "대상 없음"으로 표시한다
const SAMPLE_WORDS_MAX = 5;
async function sample(userId, deps, { words } = {}) {
  const wanted = Array.isArray(words) ? words.slice(0, SAMPLE_WORDS_MAX) : [];
  let rows;
  if (wanted.length) rows = (await deps.pool.query(SQL.sampleWords, [wanted])).rows;
  else {
    const longRows = (await deps.pool.query(SQL.sampleLong, [SAMPLE_SIZE / 2])).rows;
    const rest = (await deps.pool.query(SQL.sampleRandom, [SAMPLE_SIZE - longRows.length, longRows.map(r => r.id)])).rows;
    rows = longRows.concat(rest);
  }
  const r = rows.length ? await convertRows(userId, rows, deps) : { ok: new Map(), failed: [], calls: 0, reasons: new Map() };
  const toItem = row => {
    const defs = r.ok.get(row.id), why = r.reasons.get(row.id);
    const before = row.data.meanings.map(m => (isObj(m) && typeof m.definition === 'string' ? m.definition : ''));
    return { id: row.id, word: row.word, before, after: defs || [], short_meaning_after: defs ? G.deriveShortMeaning(defs.map(d => ({ definition: d }))) : '', ok: !!defs, reason: defs ? '' : (why ? why.reason : REASON.parse), fail_items: defs || !why ? [] : why.items };
  };
  let items;
  if (wanted.length) {
    const byWord = new Map(rows.map(row => [String(row.word).toLowerCase(), row]));
    items = wanted.map(w => byWord.has(w) ? toItem(byWord.get(w)) : { id: null, word: w, before: [], after: [], short_meaning_after: '', ok: false, reason: '대상 없음', fail_items: [] });
  } else items = rows.map(toItem);
  return { items, calls: r.calls };
}

// ───── 적용(한 요청 분량) ─────
// 실패 종류(화면 문구용): structure = 뜻 구조 이상으로 모델에 보내지 않음 / ai = AI 호출·응답 형식 오류(예외·한도·키·JSON 불량) / rule = 응답은 왔으나 규칙(20자·문장 부호·뜻 개수) 불통과
function failKind(why) { return !why ? 'rule' : why.reason === REASON.shape ? 'structure' : why.reason === REASON.parse ? 'ai' : 'rule'; }
async function run(userId, { cursor = 0, runId, budgetMs = TIME_BUDGET_MS } = {}, deps) {
  const rid = runId || newRunId();
  const now = deps.now || Date.now, t0 = now();
  const out = { run_id: rid, done: 0, failed: 0, skipped_changed: 0, failed_words: [], fail_kinds: { ai: 0, rule: 0, structure: 0 }, calls: 0, next_cursor: cursor, remaining: 0, finished: false, partial: false };
  for (let b = 0; b < MAX_BATCHES_PER_REQUEST; b++) {
    if (b > 0 && now() - t0 >= budgetMs) { out.partial = true; break; }   // 시간 예산을 넘기면 새 배치를 시작하지 않는다
    const rows = (await deps.pool.query(SQL.targets, [out.next_cursor, BATCH_SIZE])).rows;
    if (!rows.length) { out.finished = true; break; }
    const r = await convertRows(userId, rows, deps);
    out.calls += r.calls;
    for (const row of rows) {
      const defs = r.ok.get(row.id);
      if (!defs) continue;
      const after = buildAfter(row.data, defs);
      const w = await deps.pool.query(SQL.apply, [row.id, JSON.stringify(row.data), JSON.stringify(after), rid]);
      if (w.rowCount === 1) out.done++; else out.skipped_changed++;
    }
    r.failed.forEach(f => { out.failed++; out.fail_kinds[failKind(r.reasons.get(f.id))]++; if (out.failed_words.length < FAILED_WORDS_PER_RESPONSE) out.failed_words.push(f.word); });
    out.next_cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH_SIZE) { out.finished = true; break; }
  }
  out.remaining = Number(((await deps.pool.query(SQL.countRemaining, [out.next_cursor])).rows[0] || {}).n) || 0;
  if (out.remaining === 0) { out.finished = true; out.partial = false; }
  return out;
}

// ───── 되돌리기: 현재 data 가 변환 직후 값(after)과 같을 때만 복원 ─────
// cursor 는 gloss_backup.id 를 큰 쪽에서 작은 쪽으로 훑는 위치(처음은 생략)
async function restore({ runId, cursor }, deps) {
  const start = Number.isInteger(cursor) && cursor > 0 ? cursor : 2147483647;
  const rows = runId
    ? (await deps.pool.query(SQL.backupRows, [runId, start, RESTORE_PER_REQUEST])).rows
    : (await deps.pool.query(SQL.backupRowsAll, [start, RESTORE_PER_REQUEST])).rows;
  let restored = 0, skipped = 0;
  for (const b of rows) {
    const w = await deps.pool.query(SQL.restore, [b.wordbook_id, JSON.stringify(b.after), JSON.stringify(b.before)]);
    if (w.rowCount === 1) restored++; else skipped++;
  }
  const finished = rows.length < RESTORE_PER_REQUEST;
  return { restored, skipped, next_cursor: finished ? null : rows[rows.length - 1].id, finished };
}

async function backup(runId, deps) {
  return (await deps.pool.query(SQL.backupDownload, [runId])).rows.map(r => ({ wordbook_id: r.wordbook_id, before: r.before, after: r.after, created_at: r.created_at }));
}

function defaultDeps() {
  const deps = { pool: dbmod.pool, trackUsage: dbmod.trackUsage };
  deps.callModel = (userId, inputs, _d, opts) => defaultCallModel(userId, inputs, deps, opts);
  return deps;
}

module.exports = { GLOSS_MODEL, GLOSS_EVENT, GLOSS_PRICE_IN, GLOSS_PRICE_OUT, BATCH_SIZE, MAX_BATCHES_PER_REQUEST, TIME_BUDGET_MS, MAX_TOKENS, SAMPLE_SIZE, RESTORE_PER_REQUEST, SQL, SYSTEM_PROMPT,
  SAMPLE_WORDS_MAX, NAME_RULE, NO_DESCRIBE_RULE, RETRY_NOTE, REASON, diagnoseWord, estimate, status, sample, run, restore, backup, runLocked, buildAfter, convertRows, parseArray, checkWord, defaultDeps, newRunId };
