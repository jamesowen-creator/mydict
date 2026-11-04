// 작업395: Speak Loop 원문 음성 생성(관리자 전용). 기존 /api/tts(routes/tts.js, tts-1-hd 고정)와 코드·캐시를 공유하지 않는다.
// - 글은 서버 콘텐츠(lib/speakloop_content.js)에서만 가져온다. 사용자가 보낸 글자는 여기로 들어오지 않는다.
// - 환경변수는 모두 코드 기본값이 있다: SPEAKLOOP_TTS_MODEL(gpt-4o-mini-tts), SPEAKLOOP_TTS_VOICE(alloy), SPEAKLOOP_TTS_INSTRUCTIONS,
//   SPEAKLOOP_GEN_MAX_PER_RUN(40), SPEAKLOOP_TTS_COST_PER_1K_CHARS(선택, 없으면 임시 0.030 = 추정). OpenAI 키는 기존 tts.js 와 같은 OPENAI_API_KEY.
// - 로그에는 개수·상태코드만 남긴다(글·오디오·키 값은 남기지 않는다).
'use strict';
const crypto = require('crypto');

const USAGE_EVENT = 'speakloop_tts';
const TTS_URL = 'https://api.openai.com/v1/audio/speech';
const TIMEOUT_MS = 30000;
const INSTRUCTIONS_MODEL = 'gpt-4o-mini-tts';   // instructions 를 지원하는 모델(tts-1 계열은 미지원이라 요청에서 뺀다)
const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_INSTRUCTIONS = 'Speak in natural, casual American English, like a native speaker in everyday conversation. Use natural linking, reductions, and intonation.';
const CHUNK_NOTE = 'This is a fragment from the middle of a longer sentence. Do not sound finished; keep a slight continuing tone unless the text ends with a period or a question mark.';
const DEFAULT_COST_PER_1K = 0.030;   // 임시 단가(추정). SPEAKLOOP_TTS_COST_PER_1K_CHARS 로 바꾼다
// 작업397: 관리자 음성 시험(미리듣기)에서 고를 수 있는 모델·음성. voice 목록은 기억에 따른 추정이다(OpenAI 가 거부하면 오류 문구를 그대로 보여 준다)
const ALLOWED_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];
const ALLOWED_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
const PREVIEW_LIMIT = 20;
const PREVIEW_WINDOW_MS = 10 * 60 * 1000;

const envText = (name, def) => { const v = process.env[name]; return typeof v === 'string' && v.trim() ? v.trim() : def; };
function maxPerRun() {
  const n = parseInt(process.env.SPEAKLOOP_GEN_MAX_PER_RUN, 10);
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 40;
}
function costPer1k() {
  const n = parseFloat(process.env.SPEAKLOOP_TTS_COST_PER_1K_CHARS);
  return Number.isFinite(n) && n >= 0 ? { value: n, estimated: false } : { value: DEFAULT_COST_PER_1K, estimated: true };
}
function settings() {
  return { model: envText('SPEAKLOOP_TTS_MODEL', DEFAULT_MODEL), voice: envText('SPEAKLOOP_TTS_VOICE', DEFAULT_VOICE), baseInstructions: envText('SPEAKLOOP_TTS_INSTRUCTIONS', DEFAULT_INSTRUCTIONS) };
}
// 클립에 쓰는 최종 instructions. instructions 를 지원하지 않는 모델이면 null(요청에도 넣지 않는다)
function instructionsFor(kind, st) {
  if (st.model !== INSTRUCTIONS_MODEL) return null;
  return kind === 'chunk' ? st.baseInstructions + ' ' + CHUNK_NOTE : st.baseInstructions;
}
// 글·모델·음성·최종 instructions 가 하나라도 바뀌면 달라지는 해시(오래됨 판정)
function contentHash(clip, st) {
  const ins = instructionsFor(clip.kind, st) || '';
  return crypto.createHash('sha256').update(clip.text + '\n' + st.model + '\n' + st.voice + '\n' + ins, 'utf8').digest('hex');
}

// OpenAI 오류 문구에서 키 조각(sk-…)을 가리고 200자로 자른다(관리자 화면에 그대로 보여 주기 위함)
function redact(msg) {
  return typeof msg === 'string' ? msg.replace(/sk-[\w*.-]+/g, 'sk-…').slice(0, 200) : '';
}
// 클립 키 → 콘텐츠 항목 id(이디엄 id 또는 독백 id). 키의 첫 마침표 앞부분이다
const clipId = key => String(key).split('.')[0];

// OpenAI 한 번 호출. 성공 Buffer, 실패는 { status, reason } 객체를 던진다(재시도 없음)
async function synthesize(clip, st) {
  const body = { model: st.model, input: clip.text, voice: st.voice, response_format: 'mp3' };
  const ins = instructionsFor(clip.kind, st);
  if (ins) body.instructions = ins;
  let res;
  try {
    res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw { status: 0, reason: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'network' };
  }
  if (!res.ok) {
    let detail = '';
    try { const j = JSON.parse(await res.text()); detail = redact(j && j.error && j.error.message); } catch (e) { /* 본문이 JSON 이 아니면 상태코드만 */ }
    throw { status: res.status, reason: 'openai_' + res.status, detail };
  }
  try { return Buffer.from(await res.arrayBuffer()); } catch (err) { throw { status: 0, reason: 'network' }; }
}

// 현황. 저장된 행은 audio 열을 읽지 않고 (clip_key, kind, content_hash, bytes)만 본다
async function currentState(pool, clips, st) {
  const { rows } = await pool.query('SELECT clip_key, kind, content_hash, bytes FROM speakloop_audio');
  const stored = new Map(rows.map(r => [r.clip_key, r]));
  const per = { idiom: [], sentence: [], chunk: [] };
  const items = clips.map(c => {
    const row = stored.get(c.key);
    const hash = contentHash(c, st);
    const state = !row ? 'missing' : row.content_hash === hash ? 'ok' : 'stale';
    return { clip: c, hash, state };
  });
  for (const it of items) per[it.clip.kind].push(it);
  return { items, per, stored };
}

function summarize(state, st) {
  const price = costPer1k();
  const count = list => { const o = { total: list.length, have: 0, stale: 0, missing: 0 }; for (const it of list) { if (it.state === 'ok') o.have++; else if (it.state === 'stale') o.stale++; else o.missing++; } return o; };
  const todo = state.items.filter(it => it.state !== 'ok');
  const chars = todo.reduce((a, it) => a + it.clip.text.length, 0);
  const all = count(state.items);
  let bytes = 0;
  for (const r of state.stored.values()) bytes += Number(r.bytes) || 0;
  const batch = todo.slice(0, maxPerRun());
  const batchChars = batch.reduce((a, it) => a + it.clip.text.length, 0);
  return {
    total: all.total, have: all.have, stale: all.stale, missing: all.missing, bytes,
    chars_to_generate: chars,
    est_cost_usd: +(chars / 1000 * price.value).toFixed(4),   // 추정
    cost_estimated: price.estimated, cost_per_1k: price.value, model: st.model, voice: st.voice,
    max_per_run: maxPerRun(),
    batch: { count: batch.length, chars: batchChars, est_cost_usd: +(batchChars / 1000 * price.value).toFixed(4) },   // 다음 한 번 실행분(추정)
    by_kind: { idiom: count(state.per.idiom), sentence: count(state.per.sentence), chunk: count(state.per.chunk) },
  };
}

// 한 항목(prefix)의 클립 목록과 상태(있음/없음/오래됨). audio 열은 읽지 않는다
const STATE_LABEL = { ok: '있음', missing: '없음', stale: '오래됨' };
function listFor(state, prefix, st) {
  const price = costPer1k();
  const items = state.items.filter(it => clipId(it.clip.key) === prefix);
  const todo = items.filter(it => it.state !== 'ok');
  const batch = todo.slice(0, maxPerRun());
  const sum = list => list.reduce((a, it) => a + it.clip.text.length, 0);
  return {
    prefix, model: st.model, voice: st.voice, cost_per_1k: price.value, cost_estimated: price.estimated,
    clips: items.map(it => ({ key: it.clip.key, kind: it.clip.kind, text: it.clip.text, state: STATE_LABEL[it.state] })),
    todo: { count: todo.length, batch_count: batch.length, batch_chars: sum(batch), est_cost_usd: +(sum(batch) / 1000 * price.value).toFixed(4) },
  };
}

// 미리듣기 보호: 서버 메모리 기준 관리자 1명당 10분에 최대 20회(인스턴스 1개 전제). 허용되면 기록한다
const previewLog = new Map();
function previewAllowed(userId, now = Date.now()) {
  const recent = (previewLog.get(userId) || []).filter(t => now - t < PREVIEW_WINDOW_MS);
  if (recent.length >= PREVIEW_LIMIT) { previewLog.set(userId, recent); return false; }
  recent.push(now); previewLog.set(userId, recent);
  return true;
}

let running = false;   // 서버 메모리 잠금(인스턴스 1개 전제)
const isRunning = () => running;

// 부족·오래된 클립을 순서대로 하나씩 만든다. 오류가 나면 즉시 멈춘다. { generated, remaining, stopped_reason }
async function generate({ pool, trackUsage, userId, clips, max, kind, prefix }) {
  const st = settings();
  const cap = Math.min(max || maxPerRun(), maxPerRun());
  const state = await currentState(pool, clips, st);
  const todo = state.items.filter(it => it.state !== 'ok' && (!kind || it.clip.kind === kind) && (!prefix || clipId(it.clip.key) === prefix));
  let generated = 0, stopped = null;
  for (const it of todo.slice(0, cap)) {
    let audio;
    try { audio = await synthesize(it.clip, st); } catch (e) { stopped = e && e.reason ? e.reason : 'error'; console.error('speakloop tts stopped:', stopped); break; }
    try {
      await pool.query(
        `INSERT INTO speakloop_audio (clip_key, kind, text, content_hash, model, voice, audio, bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (clip_key) DO UPDATE SET kind = EXCLUDED.kind, text = EXCLUDED.text, content_hash = EXCLUDED.content_hash,
           model = EXCLUDED.model, voice = EXCLUDED.voice, audio = EXCLUDED.audio, bytes = EXCLUDED.bytes, created_at = now()`,
        [it.clip.key, it.clip.kind, it.clip.text, it.hash, st.model, st.voice, audio, audio.length]
      );
    } catch (err) { stopped = 'db_error'; console.error('speakloop tts save error:', err && err.code); break; }
    trackUsage(userId, USAGE_EVENT, st.model, 0, 0, it.clip.text.length);
    generated++;
  }
  console.log('speakloop tts run: generated ' + generated + ', remaining ' + (todo.length - generated) + (stopped ? ', stopped ' + stopped : ''));
  return { generated, remaining: todo.length - generated, stopped_reason: stopped };
}

async function runLocked(fn) {
  if (running) return { busy: true };
  running = true;
  try { return { value: await fn() }; } finally { running = false; }
}

module.exports = { USAGE_EVENT, TIMEOUT_MS, INSTRUCTIONS_MODEL, DEFAULT_MODEL, DEFAULT_VOICE, DEFAULT_INSTRUCTIONS, CHUNK_NOTE, DEFAULT_COST_PER_1K,
  ALLOWED_MODELS, ALLOWED_VOICES, PREVIEW_LIMIT, PREVIEW_WINDOW_MS, STATE_LABEL, clipId, redact, listFor, previewAllowed,
  maxPerRun, costPer1k, settings, instructionsFor, contentHash, synthesize, currentState, summarize, generate, runLocked, isRunning };
