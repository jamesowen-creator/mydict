// 스펠링 런: 화면과 분리된 순수 로직(규칙·수치·칸 나누기·후보 만들기·점수·속도·하트·라운드 구성).
// 시제품(spelling-run-prototype.html)의 CONFIG와 LOGIC 블록을 그대로 옮겼고, 보스 단어 고르기만 선택 단어 기준으로 바꿨다(planRound).
// 브라우저에서는 전역 SpellRunLogic, node 에서는 require('../public/js/spellrun/logic.js') 로 쓴다.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpellRunLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// 달리기 속도 배율. 1.0이면 이전 속도. 속도(px/초)는 곱하고, 후보 간격과 점프 시간은 나눠서 전체가 같은 비율로 빨라진다.
const DEFAULT_PACE = 1.3;
// 작업318-5: CONFIG 는 buildConfig 로 한 번에 만든다(pace 가 속도·간격·점프 시간에 같은 비율로 반영된다). 주소 옵션은 configure()로 CONFIG 를 제자리에서 바꾼다.
function buildConfig(v) {
  v = v || {};
  const PACE = v.pace || DEFAULT_PACE;
  const P = x => Math.round(x * PACE * 100) / 100;
  const T = x => Math.round(x / PACE * 1000) / 1000;
  const cfg = {
  CANDIDATES: 3,          // 한 칸당 후보 글자 수 (정답 1 + 오답)
  WORDS_PER_ROUND: 10,    // 한 판 단어 수
  HP: 5,                  // 체력
  CHUNK_PROB: 0.2,        // 음절 하나가 통째로 조각 칸이 될 확률 (음절이 CHUNK_MIN~CHUNK_MAX 글자일 때만)
  CHUNK_MIN: 2, CHUNK_MAX: 4,
  CHUNK_LONG_FROM: 5,     // 알파벳이 이 개수를 넘는 긴 단어부터 조각 확률을 높인다
  CHUNK_PROB_PER_LETTER: 0.08, // 넘은 글자 1개당 늘어나는 조각 확률
  MAX_SLOTS: 6,           // 한 단어의 최대 칸 수. 넘으면 음절 조각을 더 만들어 줄인다 (음절 정보가 있을 때)
  SYLLABLE_FALLBACK: 'heuristic', // 단어에 syl(음절 정보)이 없을 때: 'heuristic' = 규칙으로 음절 추정(사전과 경계가 다를 수 있으나 철자는 그대로), 'none' = 조각 칸 없음(글자 하나씩)
  // 속도: 맞히면 빨라지고, 틀리거나 놓치면 줄어든다. 빠를수록 후보 사이 간격이 짧아지고 점수 배율이 올라간다.
  SPEED_MIN: P(130),      // 시작 속도이자 최저 속도 (논리 px/초)
  SPEED_MAX: P(280),
  SPEED_UP_HIT: P(3),     // 글자 하나를 맞힐 때 늘어나는 속도
  SPEED_UP_CHUNK: P(5),   // 조각을 맞힐 때 늘어나는 속도
  SPEED_DROP_FAIL: P(30), // 오답이나 놓침 한 번에 줄어드는 속도
  SPEED_ACCEL: P(120),    // 속도가 목표 속도로 바뀌는 빠르기 (px/초²)
  COMBO_RAMP_START: 2,    // 작업320: 이 콤보부터 목표 속도가 서서히 오른다
  COMBO_MAX_SPEED: 5,     // 이 콤보 이상이면 최고 속도로 달린다(주소 옵션 maxcombo). 시작 콤보부터 이 콤보까지 선형으로 오른다
  SPEED_SCORE_BONUS: 1.0, // 최고 속도일 때 점수 배율 가산 (1.0이면 최대 x2)
  GAP_SEC_SLOW: T(1.15),  // 최저 속도에서 후보 사이 시간 간격(초)
  GAP_SEC_FAST: T(0.72),  // 최고 속도에서 후보 사이 시간 간격(초). 점프 체공 시간보다 충분히 길어야 한다
  LEAD_SEC_SLOW: T(1.6),  // 최저 속도에서 새 묶음의 첫 후보가 캐릭터에 닿기까지 시간(초)
  LEAD_SEC_FAST: T(1.0),
  PACK_DELAY: T(0.3),     // 묶음이 끝난 뒤 다음 묶음까지 대기(초)
  HEART_EVERY: 3,         // 이 개수의 단어마다 하트 1개 (보스 단어 제외)
  HEART_HEAL: 1,          // 하트를 먹으면 회복하는 체력
  WORD_START_DELAY: 2.2,  // 새 단어가 시작된 뒤 첫 묶음이 나오기까지 대기(초). 뜻을 읽을 시간
  JUMP_PEAK: 118,         // 점프 최고 높이(px)
  JUMP_TIME: T(0.6),      // 점프 체공 시간(초)
  GRAB_H: 22,             // 이 높이보다 위에 있으면 "점프 중"으로 판정(px)
  JUMP_BUFFER: 0.12,      // 착지 직전 입력 선입력 허용(초)
  BASE: 100,              // 글자 하나 기본 점수
  CHUNK_BONUS: 60,        // 조각 보너스 (글자 수 x 이 값)
  COMBO_STEP: 0.1,        // 콤보 1당 배율 증가
  COMBO_CAP: 10,          // 배율이 오르는 콤보 상한
  WORD_BONUS: 200,        // 단어 완성 보너스
  PERFECT_BONUS: 100,     // 실수 없이 완성 추가 보너스
  POP_SEC: 1.6,           // 단어 완성 연출 시간(초)
  HINT_SEC: 0.9,          // 오답 시 정답 강조 시간(초)
  POP_SEC_FINAL: 3.2,     // 마지막 단어 완성 연출 시간(초). 발음 두 번이 끝날 때까지 기다린다
  FINAL_REPEAT_SEC: 1.6,  // 마지막 단어의 두 번째(느린) 발음까지 대기(초)
  FINAL_SLOW_RATE: 0.6,   // 두 번째 발음 속도
  // 보스 단어: 한 판의 마지막에 나오는 긴 단어 (복습 판에는 나오지 않는다)
  BOSS_ENABLED: true,
  BOSS_POSITIONS: [5, 10], // 작업320: 한 판에서 보스가 되는 단어 순서(1부터). 그 위치에 단어가 있을 때만(5개 미만이면 보스 없음). 글자 수 조건은 없다
  BOSS_CANDIDATES: 4,     // 보스 칸의 후보 수
  BOSS_CHUNK_PROB: 0.35,  // 보스 칸이 조각이 될 확률
  BOSS_MAX_SLOTS: 7,      // 보스 단어의 최대 칸 수
  BOSS_SPEED_BONUS: P(20), // 보스 시작 시 목표 속도 가산
  BOSS_HEAL: 1,           // 보스 시작 전 체력 회복
  BOSS_MULT: 2,           // 보스 글자 점수 배율
  BOSS_BONUS: 1000,       // 보스 격파 보너스
  BOSS_INTRO_SEC: 1.8,    // 보스 등장 연출 시간(초)
  // 작업318-4: 2단 점프. 작업320: 기본 켜짐(?dj=0 일 때만 꺼진다). 꺼져 있으면 높은 칸이 나오지 않고 점프 규칙도 예전 그대로다.
  DJ_ENABLED: true,
  SECOND_JUMP_MIN: 0.08,  // 첫 점프 직후 이 시간(초)이 지나기 전의 두 번째 입력은 무시한다(중복 이벤트 방지)
  HIGH_SLOT_PROB: 0.2,    // 첫 칸을 뺀 칸이 높은 칸이 될 확률
  HIGH_MAX: 2,            // 한 단어의 높은 칸 최대 개수
  HIGH_GRAB_H: 160,       // 높은 칸은 이 높이 이상일 때만 "공중"으로 본다(px). JUMP_PEAK(118)보다 높아 한 번 점프로는 닿지 않는다
  HIGH_BONUS: 100,        // 높은 칸 획득 가산점(속도·콤보 배율 이전에 더한다)
  // 작업323: 새 단어 시작 연출(큰 뜻 → 축소 이동 → 글자 칸 등장). 연출 전체는 항상 새 단어 대기 시간(WORD_START_DELAY + 첫 단어 FIRST_WORD_EXTRA) 이내다.
  INTRO_ENABLED: true,    // 주소 옵션 intro=0 이면 연출 없이 작업322 방식
  INTRO_HOLD: 1.3,        // 큰 뜻을 그대로 보여 주는 시간(초). 글자 칸은 숨김. 첫 단어는 FIRST_WORD_EXTRA, 보스는 BOSS_INTRO_EXTRA 만큼 더 길다
  INTRO_SHRINK: 0.5,      // 축소·이동 시간(초). 이 안에서 글자 칸이 왼쪽부터 하나씩 나타난다
  FIRST_WORD_EXTRA: 0.4,  // 첫 단어의 추가 대기(초). 기존 값 그대로
  BOSS_INTRO_EXTRA: 0.4,  // 보스 단어의 큰 뜻 유지 추가 시간(초). 일반 단어는 불변
  INTRO_SLOT_STEP: 0.04,  // 글자 칸 하나가 나타나는 간격(초)
  INTRO_SLOT_MAX: 0.4,    // 모든 칸이 나타나는 데 걸리는 최대 시간(초)
  INTRO_SCALE: 1.3,       // 큰 뜻 카드의 최대 확대 배율(한 줄이 폭을 넘지 않는 범위에서)
  // 작업326: 장애물(바닥 상자·구덩이). 묶음 사이 간격에 놓고 1단 점프로 넘는다. 크기·판정 수치는 모두 여기 한 곳이다(논리 px / 초).
  OBST_ENABLED: true,     // 주소 옵션 obs=0 이면 장애물 없음(작업325까지와 같다)
  OBSTACLE_PROB: 0.5,     // 단어마다 장애물이 나올 확률(주소 옵션 obsprob)
  OBST_H: 28,             // 상자 높이. 점프 높이가 계속 이 값을 넘어야 통과
  OBST_W: 28,             // 상자 폭 (빠른 pace 에서는 여유 창을 지키려고 아래에서 줄인다)
  PIT_W: 36,              // 구덩이 폭
  PIT_CLEAR_H: 2,         // 구덩이 위를 지날 때 이 높이를 넘어 떠 있으면 통과
  OBST_FOOT: 6,           // 러너 발 폭의 반(장애물과 겹침 판정에 쓰는 가로 범위)
  OBST_SLOW_FACTOR: 0.6,  // 맞았을 때 현재 속도에 곱하는 배율
  OBST_INVULN_SEC: 0.8,   // 맞은 직후 이 시간 동안은 장애물에 다시 맞지 않는다
  OBST_MIN_WINDOW: 0.15,  // 장애물을 틀린 글자 없이 넘는 점프 시작 시각 구간(여유 창)의 최소 길이(초)
  OBST_NEXT_MARGIN: 0.1   // 장애물 점프 뒤 다음 묶음 첫 글자를 위한 점프를 준비할 최소 여유(초)
  };
  if (v.hp) cfg.HP = v.hp;
  if (v.startdelay) cfg.WORD_START_DELAY = v.startdelay;
  if (v.popsec) { cfg.POP_SEC = v.popsec; cfg.POP_SEC_FINAL = Math.round(v.popsec * 2 * 100) / 100; cfg.FINAL_REPEAT_SEC = v.popsec; }
  if (v.highprob !== undefined) cfg.HIGH_SLOT_PROB = v.highprob;
  if (v.heartevery) cfg.HEART_EVERY = v.heartevery;
  if (v.dj !== undefined) cfg.DJ_ENABLED = !!v.dj;
  if (v.maxcombo) cfg.COMBO_MAX_SPEED = v.maxcombo;
  if (v.intro !== undefined) cfg.INTRO_ENABLED = !!v.intro;
  if (v.introhold) cfg.INTRO_HOLD = v.introhold;
  if (v.obs !== undefined) cfg.OBST_ENABLED = !!v.obs;
  if (v.obsprob !== undefined) cfg.OBSTACLE_PROB = v.obsprob;
  // 빠른 pace 에서는 같은 px 폭이 더 짧은 시간에 지나가 점프 창도 같은 비율로 짧아지므로, 최저 속도에서도 여유 창이 남도록 폭을 줄인다(기본 pace 1.3 에서는 줄지 않는다)
  const fitW = (base, H) => Math.max(8, Math.min(base, Math.floor(cfg.SPEED_MIN * (airWindow(cfg, H).len - cfg.OBST_MIN_WINDOW - 0.01) - 2 * cfg.OBST_FOOT)));
  cfg.OBST_W = fitW(cfg.OBST_W, cfg.OBST_H);
  cfg.PIT_W = fitW(cfg.PIT_W, cfg.PIT_CLEAR_H);
  return cfg;
}
const CONFIG = buildConfig();

// 작업318-5: 주소 옵션(?pace=1.1&hp=7&startdelay=2.6&popsec=2&highprob=0.3&heartevery=3&dj=1). 허용 범위를 벗어나거나 숫자가 아니면 무시(기본값).
const OPTION_RULES = {
  pace: { min: 0.7, max: 1.8, def: DEFAULT_PACE }, hp: { min: 1, max: 10, int: true, def: 5 }, startdelay: { min: 0.5, max: 6, def: 2.2 },
  popsec: { min: 0.5, max: 5, def: 1.6 }, highprob: { min: 0, max: 1, def: 0.2 }, heartevery: { min: 1, max: 10, int: true, def: 3 }, dj: { min: 0, max: 1, int: true, def: 1 }, maxcombo: { min: 3, max: 12, int: true, def: 5 },
  intro: { min: 0, max: 1, int: true, def: 1 }, ttsdebug: { min: 0, max: 1, int: true, def: 0 }, introhold: { min: 0.5, max: 3, def: 1.3 },
  obs: { min: 0, max: 1, int: true, def: 1 }, obsprob: { min: 0, max: 1, def: 0.5 }
};
// 반환 { values: 유효한 값(기본값과 같아도 포함), applied: 기본값과 다른 옵션 이름 }
function parseOptions(search) {
  const values = {}, applied = [];
  let sp;
  try { sp = new URLSearchParams(String(search || '')); } catch (e) { return { values: values, applied: applied }; }
  Object.keys(OPTION_RULES).forEach(function (k) {
    const raw = sp.get(k), rule = OPTION_RULES[k];
    if (raw === null || !/^\s*-?\d+(\.\d+)?\s*$/.test(raw)) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < rule.min || n > rule.max || (rule.int && !Number.isInteger(n))) return;
    values[k] = n;
    if (n !== rule.def) applied.push(k);
  });
  return { values: values, applied: applied };
}
// 작업319: 저장값(localStorage 'spellrun_opts' 의 JSON 문자열)과 주소 옵션을 합친다. 주소가 항목 단위로 우선한다.
// 저장값도 같은 범위 규칙을 다시 거친다(범위 밖 값·모르는 항목은 버림). ?reset=1 이면 저장값을 지우고 기본값으로 시작한다.
// 반환 { values, applied, save: 저장할 값(주소에 유효한 옵션이 있을 때만, 아니면 null), reset }
const OPTION_KEY = 'spellrun_opts';
function storedOptions(raw) {
  let o;
  try { o = JSON.parse(raw); } catch (e) { return {}; }
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  Object.keys(OPTION_RULES).forEach(function (k) {
    const rule = OPTION_RULES[k], n = o[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < rule.min || n > rule.max || (rule.int && !Number.isInteger(n))) return;
    out[k] = n;
  });
  return out;
}
function resolveOptions(search, storedRaw) {
  let reset = false;
  try { reset = new URLSearchParams(String(search || '')).get('reset') === '1'; } catch (e) { reset = false; }
  if (reset) return { values: {}, applied: [], save: null, reset: true };
  const url = parseOptions(search).values;
  const values = Object.assign({}, storedOptions(storedRaw), url);
  const applied = Object.keys(values).filter(function (k) { return values[k] !== OPTION_RULES[k].def; });
  return { values: values, applied: applied, save: Object.keys(url).length ? values : null, reset: false };
}
function configure(values) { return Object.assign(CONFIG, buildConfig(values)); }

// 화면 배치(논리 px, 360x640 기준). 글자 칸 줄 아래 끝은 높은 칸(2단 점프) 타일 위쪽보다 위에 있어야 한다.
const LAYOUT = { W: 360, H: 640, GROUND: 520, TILE_Y: 412, HIGH_TILE_Y: 305, TILE_H: 58, WORD_AVAIL_W: 332,
  HUD_SHIFT: 24,        // 작업322: 대표 뜻·보조 줄·글자 칸 줄을 위쪽 HUD 줄에서 이만큼(논리 px) 아래로 내린다(한 곳에서 조정)
  INTRO_CENTER_Y: 250,  // 작업323: 큰 뜻 카드의 가운데 높이(논리 px). 위쪽 HUD 줄 아래, 땅 위의 빈 공간
  CONTENT_BOTTOM_Y: 266 // 글자 칸 줄 아래 끝의 한계: 높은 칸 타일 윗변(HIGH_TILE_Y - TILE_H/2 = 276)보다 위(여유 포함)
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const CONFUSABLE = (() => {
  const groups = ['bd','pq','mn','cs','ie','ao','uv','gj','ck','tf','ou','ae','il'];
  const m = {};
  for (const p of groups) {
    (m[p[0]] = m[p[0]] || []).push(p[1]);
    (m[p[1]] = m[p[1]] || []).push(p[0]);
  }
  return m;
})();

function isAlpha(ch) { return /^[a-z]$/i.test(ch); }

function shuffle(arr, rng) {
  rng = rng || Math.random;
  const r = arr.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = r[i]; r[i] = r[j]; r[j] = tmp;
  }
  return r;
}

const SYL_SEP = '·';
const VOWELS = 'aeiou';

// 음절 정보가 없을 때 쓰는 추정 규칙. 사전 기준과 다를 수 있다 (SYLLABLE_FALLBACK 'heuristic'일 때만 사용).
function heuristicCuts(chars) {
  const cuts = new Set();
  let i = 0;
  while (i < chars.length) {
    if (!isAlpha(chars[i])) { i++; continue; }
    let j = i;
    while (j < chars.length && isAlpha(chars[j])) j++;
    const run = chars.slice(i, j);
    const isV = k => {
      const c = run[k];
      if (VOWELS.includes(c)) return !(c === 'u' && k > 0 && run[k - 1] === 'q');
      return c === 'y' && k > 0;
    };
    const groups = [];
    for (let k = 0; k < run.length;) {
      if (isV(k)) { let e = k; while (e + 1 < run.length && isV(e + 1)) e++; groups.push([k, e]); k = e + 1; }
      else k++;
    }
    if (groups.length > 1) {
      const g = groups[groups.length - 1], n = run.length;
      const silentE = g[0] === g[1] && g[1] === n - 1 && run[n - 1] === 'e' && n > 1 && !isV(n - 2) && !(run[n - 2] === 'l' && n > 2 && !isV(n - 3));
      if (silentE) groups.pop();
    }
    const digraphs = ['ch', 'sh', 'th', 'ph', 'wh', 'ck', 'ng', 'gh'];
    for (let g = 0; g + 1 < groups.length; g++) {
      const from = groups[g][1] + 1, to = groups[g + 1][0]; // 사이의 자음 구간 [from,to)
      const len = to - from;
      let cut;
      if (len === 0) cut = to;
      else if (len === 1) cut = from;
      else {
        const pair = run.slice(from, from + 2).join('');
        cut = digraphs.includes(pair) ? (len === 2 ? from : from + 2) : from + 1;
      }
      cuts.add(i + cut);
    }
    i = j;
  }
  return cuts;
}

// 단어를 음절 목록으로 나눈다. syl은 "ap·ple"처럼 ·로 경계를 표시한 철자(선택).
// known=false이면 음절 경계를 모른다는 뜻이고, 이때는 조각 칸을 만들지 않는다.
function getSyllables(word, syl, cfg) {
  cfg = cfg || CONFIG;
  const chars = Array.from(word.toLowerCase());
  let cuts = null;
  if (typeof syl === 'string' && syl) {
    const set = new Set(); const plain = []; let idx = 0;
    for (const ch of Array.from(syl.toLowerCase())) {
      if (ch === SYL_SEP) set.add(idx); else { plain.push(ch); idx++; }
    }
    if (plain.join('') === chars.join('')) cuts = set;
  }
  if (!cuts && cfg.SYLLABLE_FALLBACK === 'heuristic') cuts = heuristicCuts(chars);
  const result = [];
  let i = 0;
  while (i < chars.length) {
    if (!isAlpha(chars[i])) { i++; continue; }
    let j = i;
    while (j < chars.length && isAlpha(chars[j])) j++;
    let st = i;
    for (let k = i + 1; k < j; k++) {
      if (cuts && cuts.has(k)) { result.push({ start: st, len: k - st }); st = k; }
    }
    result.push({ start: st, len: j - st });
    i = j;
  }
  return { syllables: result, known: !!cuts };
}

// 긴 단어일수록 조각 확률을 높인다.
function chunkProbFor(letters, cfg) {
  cfg = cfg || CONFIG;
  return Math.min(1, cfg.CHUNK_PROB + cfg.CHUNK_PROB_PER_LETTER * Math.max(0, letters - cfg.CHUNK_LONG_FROM));
}

// 단어를 칸(slot)으로 나눈다. 알파벳이 아닌 문자는 처음부터 채워진 칸(fixed)이다.
// 조각 칸(2글자 이상)은 음절 하나 전체일 때만 만든다. 음절 안을 쪼개거나 음절 둘을 합치지 않는다.
// 칸 수가 MAX_SLOTS를 넘으면, 가장 많이 줄어드는 음절부터 조각으로 바꿔 칸 수를 줄인다.
function planSlots(word, rng, cfg, syl) {
  rng = rng || Math.random; cfg = cfg || CONFIG;
  const chars = Array.from(word.toLowerCase());
  const cells = chars.map(ch => ({ ch: ch, fixed: !isAlpha(ch) }));
  const letterCount = chars.filter(isAlpha).length;
  const info = getSyllables(word, syl, cfg);
  const sylls = info.syllables;
  const eligible = sylls.map(sy => info.known && letterCount >= 3 && sy.len >= cfg.CHUNK_MIN && sy.len <= cfg.CHUNK_MAX);
  const prob = chunkProbFor(letterCount, cfg);
  const chosen = sylls.map((sy, i) => eligible[i] && rng() < prob);
  const slotCount = () => sylls.reduce((a, sy, i) => a + (chosen[i] ? 1 : sy.len), 0);
  while (slotCount() > cfg.MAX_SLOTS) {
    let best = -1; const ties = [];
    sylls.forEach((sy, i) => {
      if (!eligible[i] || chosen[i]) return;
      if (sy.len > best) { best = sy.len; ties.length = 0; }
      if (sy.len === best) ties.push(i);
    });
    if (!ties.length) break;
    chosen[ties[Math.floor(rng() * ties.length)]] = true;
  }
  const slots = [];
  sylls.forEach((sy, i) => {
    if (chosen[i]) {
      slots.push({ start: sy.start, len: sy.len, text: chars.slice(sy.start, sy.start + sy.len).join(''), chunk: true, filled: false });
    } else {
      for (let k = 0; k < sy.len; k++) {
        slots.push({ start: sy.start + k, len: 1, text: chars[sy.start + k], chunk: false, filled: false });
      }
    }
  });
  return { cells: cells, slots: slots };
}

function mutateChunk(text, rng) {
  const chars = text.split('');
  const mode = Math.floor(rng() * 3);
  if (mode === 0) {
    const i = Math.floor(rng() * (chars.length - 1));
    if (chars[i] === chars[i + 1]) return null;
    const tmp = chars[i]; chars[i] = chars[i + 1]; chars[i + 1] = tmp;
  } else {
    const i = Math.floor(rng() * chars.length);
    const c = chars[i];
    let pool;
    if (mode === 1) pool = CONFUSABLE[c] || [];
    else pool = ALPHABET.split('').filter(x => x !== c && (VOWELS.includes(x) === VOWELS.includes(c)));
    if (!pool.length) pool = ALPHABET.split('').filter(x => x !== c);
    chars[i] = pool[Math.floor(rng() * pool.length)];
  }
  return chars.join('');
}

// 후보 묶음: 정답 1개 + 오답. 오답은 헷갈리는 글자 → 같은 단어의 다른 글자 → 임의 알파벳 순서로 채운다.
function makeCandidates(correct, word, rng, cfg) {
  rng = rng || Math.random; cfg = cfg || CONFIG;
  const need = Math.max(1, cfg.CANDIDATES - 1);
  const seen = new Set([correct]);
  const wrongs = [];
  const add = t => { if (t && !seen.has(t) && wrongs.length < need) { seen.add(t); wrongs.push(t); } };
  if (correct.length === 1) {
    shuffle(CONFUSABLE[correct] || [], rng).forEach(add);
    shuffle(Array.from(new Set(word.toLowerCase().split('').filter(isAlpha))), rng).forEach(add);
    shuffle(ALPHABET.split(''), rng).forEach(add);
  } else {
    for (let k = 0; k < 200 && wrongs.length < need; k++) add(mutateChunk(correct, rng));
    for (let i = 0; i < correct.length && wrongs.length < need; i++) {
      for (const L of ALPHABET) add(correct.slice(0, i) + L + correct.slice(i + 1));
    }
  }
  const list = [{ text: correct, correct: true }].concat(wrongs.map(t => ({ text: t, correct: false })));
  return shuffle(list, rng);
}

function comboMult(combo, cfg) {
  cfg = cfg || CONFIG;
  return 1 + Math.min(combo, cfg.COMBO_CAP) * cfg.COMBO_STEP;
}
function slotPoints(len, combo, cfg, bonus) {
  cfg = cfg || CONFIG;
  const base = cfg.BASE * len + (len > 1 ? cfg.CHUNK_BONUS * len : 0) + (bonus || 0);   // 작업318: 높은 칸 가산점도 콤보·속도 배율 이전에 더한다
  return Math.round(base * comboMult(combo, cfg));
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
// 속도 단계 0(최저)~1(최고)
function speedLevel(speed, cfg) {
  cfg = cfg || CONFIG;
  return clamp01((speed - cfg.SPEED_MIN) / (cfg.SPEED_MAX - cfg.SPEED_MIN));
}
function speedMult(speed, cfg) { cfg = cfg || CONFIG; return 1 + cfg.SPEED_SCORE_BONUS * speedLevel(speed, cfg); }
function gapSec(speed, cfg) { cfg = cfg || CONFIG; return cfg.GAP_SEC_SLOW + (cfg.GAP_SEC_FAST - cfg.GAP_SEC_SLOW) * speedLevel(speed, cfg); }
function leadSec(speed, cfg) { cfg = cfg || CONFIG; return cfg.LEAD_SEC_SLOW + (cfg.LEAD_SEC_FAST - cfg.LEAD_SEC_SLOW) * speedLevel(speed, cfg); }
function speedAfterHit(target, isChunk, cfg) {
  cfg = cfg || CONFIG;
  return Math.min(cfg.SPEED_MAX, target + (isChunk ? cfg.SPEED_UP_CHUNK : cfg.SPEED_UP_HIT));
}
function speedAfterFail(target, cfg) { cfg = cfg || CONFIG; return Math.max(cfg.SPEED_MIN, target - cfg.SPEED_DROP_FAIL); }
// 콤보가 COMBO_MAX_SPEED 이상이면 최고 속도, 아니면 기본 속도(맞히면 오르고 틀리면 줄어드는 값)
// 작업320: 콤보 RAMP_START 부터 MAX_SPEED 콤보까지 (기본 2~5) 목표 속도가 선형으로 오른다(콤보 2=25%, 3=50%, 4=75%, 5 이상=100%).
// 목표 속도 = max(기본 누적 속도, 램프 속도). 콤보 1 이하는 램프 영향 없음. 틀리면 콤보 0 이라 기본 누적 속도로 내려간다.
function targetSpeed(base, combo, cfg) {
  cfg = cfg || CONFIG;
  if (combo < cfg.COMBO_RAMP_START) return base;
  const span = cfg.COMBO_MAX_SPEED - cfg.COMBO_RAMP_START + 1;
  const f = Math.min(1, (combo - cfg.COMBO_RAMP_START + 1) / span);
  return Math.max(base, cfg.SPEED_MIN + f * (cfg.SPEED_MAX - cfg.SPEED_MIN));
}
// 하트가 나올 단어 번호: HEART_EVERY개씩 묶은 그룹마다 하나. 남는 단어(그룹을 못 채운 것)에는 나오지 않는다.
function planHearts(regularCount, rng, cfg) {
  rng = rng || Math.random; cfg = cfg || CONFIG;
  const set = new Set(); const e = cfg.HEART_EVERY;
  for (let g = 0; (g + 1) * e <= regularCount; g++) set.add(g * e + Math.floor(rng() * e));
  return set;
}
// 하트가 나올 칸 번호: 단어의 중간쯤. 첫 칸은 피한다(칸이 하나면 0).
function pickHeartSlot(nSlots, rng) {
  rng = rng || Math.random;
  return nSlots <= 1 ? 0 : 1 + Math.floor(rng() * (nSlots - 1));
}
function jumpHeight(t, cfg) {
  cfg = cfg || CONFIG;
  if (t < 0 || t > cfg.JUMP_TIME) return 0;
  const u = t / cfg.JUMP_TIME;
  return 4 * cfg.JUMP_PEAK * u * (1 - u);
}
// 작업318-4: 2단 점프. 공중에서 한 번 더 누르면 그 높이에서 첫 점프와 같은 초속도(4*PEAK/TIME)로 다시 솟는다(중력도 같다) → 최대 높이는 누른 높이 + JUMP_PEAK.
function jumpV0(cfg) { cfg = cfg || CONFIG; return 4 * cfg.JUMP_PEAK / cfg.JUMP_TIME; }
function jumpG(cfg) { cfg = cfg || CONFIG; return 8 * cfg.JUMP_PEAK / (cfg.JUMP_TIME * cfg.JUMP_TIME); }
// t1: 첫 점프 시작 후 시간, t2: 2단 점프 시작 후 시간(-1이면 아직), h2: 2단 점프를 누른 순간의 높이
function airHeight(t1, t2, h2, cfg) {
  cfg = cfg || CONFIG;
  if (t2 < 0) return jumpHeight(t1, cfg);
  return Math.max(0, h2 + jumpV0(cfg) * t2 - 0.5 * jumpG(cfg) * t2 * t2);
}
function secondJumpLandTime(h2, cfg) {
  cfg = cfg || CONFIG;
  const v = jumpV0(cfg), g = jumpG(cfg);
  return (v + Math.sqrt(v * v + 2 * g * h2)) / g;
}
// 한 단어의 높은 칸 번호 집합. 꺼져 있으면 비어 있다. 첫 칸 제외, 최대 HIGH_MAX개, 칸이 하나뿐이면 없음(모든 칸이 높은 경우는 없다). 조각 칸 여부와 무관.
function planHighSlots(nSlots, rng, cfg) {
  rng = rng || Math.random; cfg = cfg || CONFIG;
  const out = new Set();
  if (!cfg.DJ_ENABLED || nSlots < 2) return out;
  const idx = shuffle(Array.from({ length: nSlots - 1 }, function (_, i) { return i + 1; }), rng);
  for (const i of idx) {
    if (out.size >= cfg.HIGH_MAX) break;
    if (rng() < cfg.HIGH_SLOT_PROB) out.add(i);
  }
  return out;
}

// ---- 작업326: 장애물(바닥 상자·구덩이) ----
// 1단 점프의 높이가 H 를 넘는 구간 [a, b] (점프 시작 후 초). 점프 높이는 jumpHeight 와 같은 포물선이라 길이는 JUMP_TIME * sqrt(1 - H / PEAK).
function airWindow(cfg, H) {
  cfg = cfg || CONFIG;
  const len = H >= cfg.JUMP_PEAK ? 0 : cfg.JUMP_TIME * Math.sqrt(1 - H / cfg.JUMP_PEAK);
  return { a: (cfg.JUMP_TIME - len) / 2, b: (cfg.JUMP_TIME + len) / 2, len: len };
}
// 종류별 폭과 "통과하려면 넘어야 하는 높이"
function obstacleSpec(cfg, kind) {
  cfg = cfg || CONFIG;
  return kind === 'pit' ? { kind: 'pit', w: cfg.PIT_W, clearH: cfg.PIT_CLEAR_H } : { kind: 'box', w: cfg.OBST_W, clearH: cfg.OBST_H };
}
// 러너(가로 범위 RUNNER_X ± OBST_FOOT)와 장애물 [x, x+w] 가 겹치는지
function obstacleOverlaps(x, w, runnerX, cfg) {
  cfg = cfg || CONFIG;
  return x < runnerX + cfg.OBST_FOOT && x + w > runnerX - cfg.OBST_FOOT;
}
// 겹쳐 있는 동안 공중 높이 h 가 계속 clearH 를 넘어야 통과한다. 한 번이라도 같거나 낮으면 맞은 것(상자는 걸림, 구덩이는 빠짐)
function obstacleHit(kind, h, cfg) { return h <= obstacleSpec(cfg, kind).clearH; }
// 장애물 앞뒤 간격(px, 러너 위치 기준). 최악 속도(SPEED_MAX)로 계산한다: 시간이 아니라 px 로 정한다.
// 타임라인(묶음이 나오는 순간 = 0): 앞 묶음의 정답 글자를 먹은 때 T0 = -PACK_DELAY. 러너는 그 점프의 착지(T0 + gb)까지 공중에 있을 수 있다.
// 장애물 점프 시작 s 는 ① 착지 뒤 ② 겹치는 구간 전체가 높이 H 초과 구간에 들어오게 ③ 점프 중(높이 GRAB_H 초과)에 다음 묶음 글자가 지나가지 않고 ④ 착지 뒤 다음 점프를 준비할 여유가 남게 잡아야 한다.
// s 의 가능한 구간 [l, u] 의 길이(여유 창)가 모든 속도에서 OBST_MIN_WINDOW 이상이 되도록(계산 오차 대비 0.01초 더) Do(장애물 앞쪽 끝까지 거리)와 D1(다음 묶음 첫 글자까지 거리)을 정한다.
function obstacleLayout(cfg, kind) {
  cfg = cfg || CONFIG;
  const sp = obstacleSpec(cfg, kind), win = airWindow(cfg, sp.clearH), grab = airWindow(cfg, cfg.GRAB_H);
  const v = cfg.SPEED_MAX, MIN = cfg.OBST_MIN_WINDOW + 0.01, M = cfg.OBST_NEXT_MARGIN, F = cfg.OBST_FOOT, PD = cfg.PACK_DELAY, J = cfg.JUMP_TIME;
  const doMin = Math.max(F, F + v * (MIN + win.a + grab.b - PD));
  const postMin = Math.max(F, F + v * (MIN + grab.a + J + M - win.b));
  const d1Req = v * (MIN + grab.a + J + M + grab.b - PD);
  const D1 = Math.max(doMin + sp.w + postMin, d1Req);
  const extra = D1 - (doMin + sp.w + postMin);
  const Do = doMin + extra / 2;
  return { kind: sp.kind, w: sp.w, clearH: sp.clearH, Do: Do, post: D1 - Do - sp.w, D1: D1 };
}
// 일정한 속도 v 에서 장애물을 틀린 글자를 먹지 않고 넘는 점프 시작 시각의 구간(초). width 가 여유 창이다(음수면 불가능).
function obstacleWindow(cfg, layout, v) {
  cfg = cfg || CONFIG;
  const win = airWindow(cfg, layout.clearH), grab = airWindow(cfg, cfg.GRAB_H), F = cfg.OBST_FOOT;
  const A = (layout.Do - F) / v, B = (layout.Do + layout.w + F) / v, P1 = layout.D1 / v;
  const lo = Math.max(B - win.b, -cfg.PACK_DELAY + grab.b), hi = Math.min(A - win.a, P1 - (grab.a + cfg.JUMP_TIME + cfg.OBST_NEXT_MARGIN));
  return { lo: lo, hi: hi, width: hi - lo };
}
// 장애물 때문에 첫 글자가 나오기까지 늘어나는 시간(초): 기본 리드 거리(v * leadSec)보다 D1 이 클 때만 늘어난다
function obstacleAddedSec(cfg, kind, v) {
  cfg = cfg || CONFIG;
  return Math.max(0, obstacleLayout(cfg, kind).D1 - v * leadSec(v, cfg)) / v;
}
// 한 단어의 장애물 계획 { slot: 장애물 뒤에 오는 묶음 번호(1~칸 수-1), kind } 또는 null.
// 후보 자리는 묶음 사이 간격(첫 묶음 앞·마지막 묶음 뒤 제외). 보스 단어, 높은 칸 묶음(highSet)·하트 묶음에서 1묶음 이내인 자리는 제외한다.
// heartSlot: 이 단어에 하트가 계획돼 있으면 하트가 나올 수 있는 가장 앞 칸 번호(그 칸 이후 어디든 나올 수 있다), 없으면 null.
// 꺼져 있거나 보스면 난수를 쓰지 않는다. 난수 호출 순서: 확률 → 자리 → 종류
function planObstacle(nSlots, highSet, heartSlot, boss, rng, cfg) {
  rng = rng || Math.random; cfg = cfg || CONFIG;
  if (!cfg.OBST_ENABLED || boss || nSlots < 2) return null;
  if (!(rng() < cfg.OBSTACLE_PROB)) return null;
  const near = (g, j) => Math.min(Math.abs(g - 1 - j), Math.abs(g - j)) <= 1;   // 간격 g 는 묶음 g-1 과 g 사이
  const cand = [];
  for (let g = 1; g < nSlots; g++) {
    let ok = true;
    if (highSet) highSet.forEach(function (j) { if (near(g, j)) ok = false; });
    if (heartSlot !== null && heartSlot !== undefined && g >= heartSlot - 1) ok = false;
    if (ok) cand.push(g);
  }
  if (!cand.length) return null;
  const slot = cand[Math.floor(rng() * cand.length)];
  return { slot: slot, kind: rng() < 0.5 ? 'box' : 'pit' };
}
// 맞았을 때의 효과(순수): 체력 -1, 현재 속도 x OBST_SLOW_FACTOR, 기본 누적 속도에서 SPEED_DROP_FAIL 만큼 뺀 뒤 목표 속도 다시 계산. 콤보·점수는 그대로
function afterObstacleHit(s, cfg) {
  cfg = cfg || CONFIG;
  const speedBase = speedAfterFail(s.speedBase, cfg);
  return { hp: s.hp - 1, speed: s.speed * cfg.OBST_SLOW_FACTOR, speedBase: speedBase, speedTarget: targetSpeed(speedBase, s.combo, cfg), combo: s.combo };
}

// ---- 작업321: 펭귄 스프라이트 ----
// 시트(spellrun_penguin_sheet.png 1728x288)는 288x288 칸 6개: 0~3 달리기, 4 점프 상승, 5 점프 하강. 모두 오른쪽을 본다.
// 칸 안에서 발바닥은 아래에서 8px 위, 얼굴 중심은 폭의 55% 지점이다. size 는 화면(논리 px)에서 그리는 한 칸의 한 변(높이 기준 크기 — 한 곳에서 조정).
const PENGUIN = { URL: '/img/spellrun/spellrun_penguin_sheet.png', SHEET_W: 1728, SHEET_H: 288, CELL: 288, FRAMES: 6, size: 92, faceX: 0.55, footPad: 8 / 288, faceDx: -10, bodyY: 0.58,
  RUN_FRAMES: 4, JUMP_UP: 4, JUMP_DOWN: 5, IDLE: 1, JOY: 4, RUN_LEN: 0.11, RUN_LEN_MIN: 0.06, RUN_LEN_MAX: 0.14 };
// 달리기 한 프레임의 길이(초): 기본 0.11초를 속도에 반비례해 줄이고(빠를수록 빨리 바뀜) 0.06~0.14초로 제한한다. 기준 속도는 최저 속도(SPEED_MIN)
function runFrameLength(speed, cfg) {
  cfg = cfg || CONFIG;
  const len = PENGUIN.RUN_LEN * cfg.SPEED_MIN / Math.max(1, speed);
  return Math.max(PENGUIN.RUN_LEN_MIN, Math.min(PENGUIN.RUN_LEN_MAX, len));
}
// 달리기 위상(0~4 미만). 프레임 번호 = floor(위상). 속도가 바뀌어도 위상이 이어져 번호가 튀지 않는다
function advanceRunPhase(phase, dt, speed, cfg) {
  const p = (phase + dt / runFrameLength(speed, cfg)) % PENGUIN.RUN_FRAMES;
  return p < 0 ? p + PENGUIN.RUN_FRAMES : p;
}
// 그릴 프레임 번호(0부터). o: { state, cleared, air, rising, runPhase }
function penguinFrame(o) {
  if (o.state === 'idle' || o.state === 'intro' || o.state === 'ending') return PENGUIN.IDLE;   // 대기·보스 배너·게임 오버 연출(기존 회전 유지)은 서 있는 자세
  if (o.state === 'over') return o.cleared ? PENGUIN.JOY : PENGUIN.IDLE;                       // 결과 화면: 완주는 기쁨(5번), 아니면 서 있는 자세
  if (o.air) return o.rising ? PENGUIN.JUMP_UP : PENGUIN.JUMP_DOWN;
  return Math.floor(o.runPhase || 0) % PENGUIN.RUN_FRAMES;
}
// 2단 점프 회전(도): 두 번째 점프가 시작되면 체공 시간(land)에 맞춰 0 → 360 으로 단조 증가, 착지(또는 점프 아님)하면 정확히 0
function spinAngle(j2, land) {
  if (j2 < 0 || !(land > 0) || j2 >= land) return 0;
  return 360 * j2 / land;
}
// 정점 부근의 반짝임 세기(0~1): 2단 점프 정점(초속도/중력 = JUMP_TIME/2) 앞뒤 0.12초
function sparkleAlpha(j2, cfg) {
  cfg = cfg || CONFIG;
  if (j2 < 0) return 0;
  return Math.max(0, 1 - Math.abs(j2 - jumpV0(cfg) / jumpG(cfg)) / 0.12);
}

// ---- 작업325: 발음 출처 문구(점검 옵션 ttsdebug) ----
// o: { engine: 'server'|'builtin'|'none', cache: 'HIT'|'MISS'|'', status: 서버 응답 코드, reason: 'timeout'|'play'|'' }
function ttsSourceLabel(o) {
  o = o || {};
  if (o.engine === 'server') return '서버 음성' + (o.cache === 'HIT' ? '(캐시 있음)' : o.cache === 'MISS' ? '(새로 생성)' : '');
  if (o.engine === 'none') return '재생 안 됨';
  const why = o.status === 401 ? '로그인 필요(401)' : o.status === 403 ? '권한 없음(403)' : o.status === 503 ? '서버 키 없음(503)'
    : o.reason === 'timeout' ? '시간 초과' : o.reason === 'play' ? '재생 거부' : '서버 오류';
  return '내장 음성: ' + why;
}

// ---- 작업323: 새 단어 시작 연출 ----
// 타임라인: 큰 뜻 유지(hold) → 축소·이동(shrink). 전체(hold+shrink)는 새 단어 대기 시간(delay) 이하로 맞춘다(옵션이 커도 hold 를 줄인다).
// o: { first: 첫 단어, boss: 보스 단어 }
function introTimeline(cfg, o) {
  cfg = cfg || CONFIG; o = o || {};
  const delay = cfg.WORD_START_DELAY + (o.first ? cfg.FIRST_WORD_EXTRA : 0);
  const shrink = Math.min(cfg.INTRO_SHRINK, delay);
  const want = cfg.INTRO_HOLD + (o.first ? cfg.FIRST_WORD_EXTRA : 0) + (o.boss ? cfg.BOSS_INTRO_EXTRA : 0);
  const hold = Math.max(0, Math.min(want, delay - shrink));
  return { delay: delay, hold: hold, shrink: shrink, total: hold + shrink };
}
// 경과 시간(게임 시간) t → { phase: 'hold'|'shrink'|'done', p: 축소 진행률 0~1, e: 부드러운 감속(easeOutCubic) 진행률, visible: 보이는 칸 수(0~nKids) }
function introState(t, tl, nKids, cfg) {
  cfg = cfg || CONFIG;
  if (t >= tl.total) return { phase: 'done', p: 1, e: 1, visible: nKids };
  if (t <= tl.hold) return { phase: 'hold', p: 0, e: 0, visible: 0 };
  const p = Math.max(0, Math.min(1, (t - tl.hold) / tl.shrink));
  const step = Math.min(cfg.INTRO_SLOT_STEP, cfg.INTRO_SLOT_MAX / Math.max(1, nKids));
  return { phase: 'shrink', p: p, e: 1 - Math.pow(1 - p, 3), visible: Math.min(nKids, Math.floor((t - tl.hold) / step) + 1) };
}

// ---- 작업318-1: 글자 칸 줄 폭 배분 ----
// items: 칸 목록 [{ n: 글자 수, chunk: 조각 칸 여부 }] 과 고정 글자 { fixed: true }. 실제 CSS 와 같은 식으로 줄 전체 폭을 센다.
function wordWidth(items, cw, cellGap, slotGap, chunkPad) {
  let w = 0;
  for (const it of items) {
    if (it.fixed) w += 0.6 * cw;
    else w += it.n * cw + (it.n - 1) * cellGap + (it.chunk ? 2 * chunkPad + 6 : 0);   // +6: 점선 테두리가 바깥으로 나오는 만큼
  }
  return w + Math.max(0, items.length - 1) * slotGap;
}
// 사용 가능한 폭 안에 들어가는 칸 크기(cw)와 글자 크기(fs)·간격을 고른다. 글자 크기를 먼저 줄이고(하한 cwMin), 하한에서도 넘치면 간격부터 줄이고, 그래도 넘치면 하한 아래로 줄인다.
function fitWord(items, availW, opt) {
  opt = Object.assign({ cwMax: 34, cwMin: 16, cellGap: 3, slotGap: 5, chunkPad: 4, minCellGap: 1, minSlotGap: 2 }, opt || {});
  const done = function (cw, cg, sg) { return { cw: cw, fs: Math.round(cw * 0.95 * 10) / 10, cellGap: cg, slotGap: sg, chunkPad: opt.chunkPad, width: wordWidth(items, cw, cg, sg, opt.chunkPad) }; };
  for (let cw = opt.cwMax; cw >= opt.cwMin; cw--) if (wordWidth(items, cw, opt.cellGap, opt.slotGap, opt.chunkPad) <= availW) return done(cw, opt.cellGap, opt.slotGap);
  if (wordWidth(items, opt.cwMin, opt.minCellGap, opt.minSlotGap, opt.chunkPad) <= availW) {
    for (let cg = opt.cellGap; cg >= opt.minCellGap; cg--) for (let sg = opt.slotGap; sg >= opt.minSlotGap; sg--) {
      if (wordWidth(items, opt.cwMin, cg, sg, opt.chunkPad) <= availW) return done(opt.cwMin, cg, sg);
    }
  }
  let cw = opt.cwMin;
  while (cw > 4 && wordWidth(items, cw, opt.minCellGap, opt.minSlotGap, opt.chunkPad) > availW) cw -= 0.5;
  return done(cw, opt.minCellGap, opt.minSlotGap);
}

// ---- 작업318-2/3: 힌트 만들기와 정답 가리기 ----
const MASK = '＿＿';
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// 정답 단어와 그 활용형(접미 변화). 불규칙 활용(ran 등)은 만들지 못한다.
function wordForms(word) {
  const w = String(word).toLowerCase();
  const set = new Set([w]);
  ['s', 'es', 'ed', 'd', 'ing', 'ings', 'ly', 'er', 'ers', 'est', 'ness', 'y'].forEach(function (x) { set.add(w + x); });
  if (/[^aeiou]y$/.test(w)) ['ies', 'ied', 'ier', 'iers', 'iest', 'ily', 'iness'].forEach(function (x) { set.add(w.slice(0, -1) + x); });
  if (/e$/.test(w)) { ['ing', 'ings', 'y', 'er', 'ers', 'ish'].forEach(function (x) { set.add(w.slice(0, -1) + x); }); set.add(w + 'r'); set.add(w + 'rs'); set.add(w + 'st'); }
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) { const c = w[w.length - 1]; ['ing', 'ings', 'ed', 'er', 'ers', 'est', 'y'].forEach(function (x) { set.add(w + c + x); }); }
  return Array.from(set).sort(function (a, b) { return b.length - a.length; });
}
function wordRegex(word) {
  const alt = wordForms(word).map(function (f) { return escRe(f).replace(/'/g, "['’]"); }).join('|');
  return new RegExp('(?<![A-Za-z])(?:' + alt + ')(?![A-Za-z])', 'gi');
}
function maskText(text, word, token) {
  return typeof text === 'string' ? text.replace(wordRegex(word), token || MASK) : '';
}
function findWordRanges(text, word) {
  const out = [], re = wordRegex(word), s = String(text || '');
  let m;
  while ((m = re.exec(s))) { out.push([m.index, m.index + m[0].length]); if (m[0].length === 0) re.lastIndex++; }
  return out;
}
const txt = function (v) { return typeof v === 'string' ? v.trim() : ''; };
// 쉼표로 나열된 짧은 한글 키워드는 항목 단위로만 줄인다(max 글자 안에 드는 앞쪽 항목까지). 항목 하나가 길어도 중간을 자르지 않는다.
function keywords(s, max) {
  s = txt(s);
  if (Array.from(s).length <= max) return s;
  const items = s.split(/\s*[,，;；、]\s*/).filter(Boolean);
  let out = '';
  for (const it of items) {
    const next = out ? out + ', ' + it : it;
    if (out && Array.from(next).length > max) break;
    out = next;
  }
  return out || s;
}
// 쉼표 단위 키워드로 나눈다
function splitKeywords(s) { return txt(s).split(/\s*[,，;；、]\s*/).filter(Boolean); }
// row: 단어장 행 { data, example_sentence }, word: 소문자 단어, main: 대표 뜻.
// 반환 { hint: { meaning, subs }(정답이 가려진 값. subs 는 다른 뜻 키워드 배열, 최대 6개), pop: { pron, meaning, example, ranges }(가리지 않은 값 + 강조 위치) }
// 작업322: 상세 힌트 박스(품사·품사별 다른 뜻·쓰임 설명)를 없애고 보조 한 줄(다른 뜻 키워드)만 남겼다.
// 보조 줄: meanings[].definition(없으면 core_meaning)의 쉼표 키워드에서 대표 뜻에 이미 있는 것과 중복을 빼고 앞에서 최대 6개.
function buildHint(row, word, main) {
  const d = row && row.data && typeof row.data === 'object' ? row.data : {};
  const meanings = Array.isArray(d.meanings) ? d.meanings.filter(function (m) { return m && typeof m === 'object'; }) : [];
  const have = new Set(splitKeywords(main));
  const subs = [];
  for (const m of meanings) {
    for (const k of splitKeywords(txt(m.definition) || txt(m.core_meaning))) {
      if (have.has(k)) continue;
      have.add(k); subs.push(k);
    }
  }
  const cands = [txt(row && row.example_sentence)]
    .concat(meanings.map(function (m) { return txt(m.example); }))
    .concat((Array.isArray(d.usages) ? d.usages : []).map(function (u) { return u && typeof u === 'object' ? txt(u.example) : ''; }))
    .filter(Boolean).map(function (e) { return Array.from(e).length > 140 ? Array.from(e).slice(0, 140).join('') : e; });
  const found = cands.find(function (e) { return findWordRanges(e, word).length > 0; });
  const popExample = found || cands[0] || '';
  const mk = function (t) { return maskText(t, word); };
  return {
    hint: { meaning: mk(main), subs: subs.slice(0, 6).map(mk) },
    pop: { pron: txt(d.pronunciation), meaning: main, example: popExample, ranges: popExample ? findWordRanges(popExample, word) : [] }
  };
}

// 후보가 캐릭터 위치를 지나는 순간의 판정
function judge(isCorrect, airborne) {
  if (airborne) return isCorrect ? 'hit' : 'wrong';
  return isCorrect ? 'miss' : 'pass';
}
function buildRound(words, missed, cfg, rng, reviewOnly) {
  cfg = cfg || CONFIG; rng = rng || Math.random;
  const isMissed = w => missed.has(w.word);
  let list;
  if (reviewOnly) list = shuffle(words.filter(isMissed), rng);
  else list = shuffle(words.filter(isMissed), rng).concat(shuffle(words.filter(w => !isMissed(w)), rng));
  return list.slice(0, cfg.WORDS_PER_ROUND);
}
function letterCount(word) { return Array.from(word).filter(isAlpha).length; }
function bossConfig(cfg) {
  cfg = cfg || CONFIG;
  return Object.assign({}, cfg, { CANDIDATES: cfg.BOSS_CANDIDATES, CHUNK_PROB: cfg.BOSS_CHUNK_PROB, MAX_SLOTS: cfg.BOSS_MAX_SLOTS });
}

function letterCount(word) { return Array.from(word).filter(isAlpha).length; }

// 한 판의 모양: 단어 수 n(최대 WORDS_PER_ROUND)과 보스 위치(0부터). 복습 판에는 보스가 없다. 선택 단어가 5개 미만이면 보스 없음, 5~9개면 5번째만, 10개 이상이면 5·10번째.
function roundShape(count, cfg, reviewOnly) {
  cfg = cfg || CONFIG;
  const n = Math.min(cfg.WORDS_PER_ROUND, count);
  const bossIdx = (reviewOnly || !cfg.BOSS_ENABLED) ? [] : cfg.BOSS_POSITIONS.filter(function (p) { return p <= n; }).map(function (p) { return p - 1; });
  return { total: n, bossIdx: bossIdx, bosses: bossIdx.length, regular: n - bossIdx.length };
}
// 한 판 구성: 보스 자리에는 선택 단어 중 긴 단어부터(길이가 같으면 무작위) 배정하고, 나머지 자리는 직전 판에서 틀린 단어가 먼저다.
// 반환 { list: 출제 순서의 단어 목록, bossIdx: 보스 위치, regular: 보스가 아닌 단어 수 }
function planRound(words, missed, cfg, rng, reviewOnly) {
  cfg = cfg || CONFIG; rng = rng || Math.random;
  const shape = roundShape(reviewOnly ? Math.min(words.filter(function (w) { return missed.has(w.word); }).length, cfg.WORDS_PER_ROUND) : words.length, cfg, reviewOnly);
  if (!shape.bosses) { const list = buildRound(words, missed, cfg, rng, reviewOnly); return { list: list, bossIdx: [], regular: list.length }; }
  const order = shuffle(words, rng).sort(function (x, y) { return letterCount(y.word) - letterCount(x.word); });   // 정렬은 안정 정렬이라 같은 길이는 섞인 순서 그대로(무작위)
  const bosses = order.slice(0, shape.bosses);
  const rest = buildRound(words.filter(function (w) { return bosses.indexOf(w) < 0; }), missed, cfg, rng, false).slice(0, shape.regular);
  const list = []; let ri = 0;
  for (let i = 0; i < shape.total; i++) { const k = shape.bossIdx.indexOf(i); list.push(k >= 0 ? bosses[k] : rest[ri++]); }
  return { list: list, bossIdx: shape.bossIdx, regular: shape.regular };
}

return {
  CONFIG: CONFIG, ALPHABET: ALPHABET, CONFUSABLE: CONFUSABLE, isAlpha: isAlpha, shuffle: shuffle, heuristicCuts: heuristicCuts, getSyllables: getSyllables,
  chunkProbFor: chunkProbFor, planSlots: planSlots, mutateChunk: mutateChunk, makeCandidates: makeCandidates, comboMult: comboMult, slotPoints: slotPoints,
  speedLevel: speedLevel, speedMult: speedMult, gapSec: gapSec, leadSec: leadSec, speedAfterHit: speedAfterHit, speedAfterFail: speedAfterFail,
  targetSpeed: targetSpeed, planHearts: planHearts, pickHeartSlot: pickHeartSlot, jumpHeight: jumpHeight, judge: judge, buildRound: buildRound,
  letterCount: letterCount, planRound: planRound, roundShape: roundShape, bossConfig: bossConfig,
  ttsSourceLabel: ttsSourceLabel, PENGUIN: PENGUIN, runFrameLength: runFrameLength, advanceRunPhase: advanceRunPhase, penguinFrame: penguinFrame, spinAngle: spinAngle, sparkleAlpha: sparkleAlpha, introTimeline: introTimeline, introState: introState, buildConfig: buildConfig, parseOptions: parseOptions, resolveOptions: resolveOptions, storedOptions: storedOptions, OPTION_KEY: OPTION_KEY, configure: configure, OPTION_RULES: OPTION_RULES, LAYOUT: LAYOUT,
  jumpV0: jumpV0, jumpG: jumpG, airHeight: airHeight, secondJumpLandTime: secondJumpLandTime, planHighSlots: planHighSlots,
  airWindow: airWindow, obstacleSpec: obstacleSpec, obstacleOverlaps: obstacleOverlaps, obstacleHit: obstacleHit, obstacleLayout: obstacleLayout, obstacleWindow: obstacleWindow, obstacleAddedSec: obstacleAddedSec, planObstacle: planObstacle, afterObstacleHit: afterObstacleHit,
  wordWidth: wordWidth, fitWord: fitWord, MASK: MASK, wordForms: wordForms, maskText: maskText, findWordRanges: findWordRanges, buildHint: buildHint, keywords: keywords, splitKeywords: splitKeywords
};
});
