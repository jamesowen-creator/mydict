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
const PACE = 1.3;
const P = x => Math.round(x * PACE * 100) / 100;
const T = x => Math.round(x / PACE * 1000) / 1000;
const CONFIG = {
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
  COMBO_MAX_SPEED: 5,     // 이 콤보 이상이면 최고 속도로 달린다
  SPEED_SCORE_BONUS: 1.0, // 최고 속도일 때 점수 배율 가산 (1.0이면 최대 x2)
  GAP_SEC_SLOW: T(1.15),  // 최저 속도에서 후보 사이 시간 간격(초)
  GAP_SEC_FAST: T(0.72),  // 최고 속도에서 후보 사이 시간 간격(초). 점프 체공 시간보다 충분히 길어야 한다
  LEAD_SEC_SLOW: T(1.6),  // 최저 속도에서 새 묶음의 첫 후보가 캐릭터에 닿기까지 시간(초)
  LEAD_SEC_FAST: T(1.0),
  PACK_DELAY: T(0.3),     // 묶음이 끝난 뒤 다음 묶음까지 대기(초)
  HEART_EVERY: 3,         // 이 개수의 단어마다 하트 1개 (보스 단어 제외)
  HEART_HEAL: 1,          // 하트를 먹으면 회복하는 체력
  WORD_START_DELAY: 1.6,  // 새 단어가 시작된 뒤 첫 묶음이 나오기까지 대기(초). 뜻을 읽을 시간
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
  BOSS_MIN_LETTERS: 8,    // 보스 단어 최소 알파벳 수
  BOSS_CANDIDATES: 4,     // 보스 칸의 후보 수
  BOSS_CHUNK_PROB: 0.35,  // 보스 칸이 조각이 될 확률
  BOSS_MAX_SLOTS: 7,      // 보스 단어의 최대 칸 수
  BOSS_SPEED_BONUS: P(20), // 보스 시작 시 목표 속도 가산
  BOSS_HEAL: 1,           // 보스 시작 전 체력 회복
  BOSS_MULT: 2,           // 보스 글자 점수 배율
  BOSS_BONUS: 1000,       // 보스 격파 보너스
  BOSS_INTRO_SEC: 1.8     // 보스 등장 연출 시간(초)
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
function slotPoints(len, combo, cfg) {
  cfg = cfg || CONFIG;
  const base = cfg.BASE * len + (len > 1 ? cfg.CHUNK_BONUS * len : 0);
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
function targetSpeed(base, combo, cfg) { cfg = cfg || CONFIG; return combo >= cfg.COMBO_MAX_SPEED ? cfg.SPEED_MAX : base; }
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

// 한 판 구성: 보스는 선택 단어 중 알파벳이 BOSS_MIN_LETTERS 이상인 단어가 있을 때만 1개(복습 판에는 없음).
// 보스로 뽑힌 단어는 정규 단어에서 빠진다. 정규 단어는 최대 WORDS_PER_ROUND개이고 직전 판에서 틀린 단어가 먼저다.
function planRound(words, missed, cfg, rng, reviewOnly) {
  cfg = cfg || CONFIG; rng = rng || Math.random;
  var boss = null, pool = words;
  if (!reviewOnly && cfg.BOSS_ENABLED) {
    var longs = words.filter(function (w) { return letterCount(w.word) >= cfg.BOSS_MIN_LETTERS; });
    if (longs.length) { boss = longs[Math.floor(rng() * longs.length)]; pool = words.filter(function (w) { return w !== boss; }); }
  }
  return { regular: buildRound(pool, missed, cfg, rng, reviewOnly), boss: boss };
}

return {
  CONFIG: CONFIG, ALPHABET: ALPHABET, CONFUSABLE: CONFUSABLE, isAlpha: isAlpha, shuffle: shuffle, heuristicCuts: heuristicCuts, getSyllables: getSyllables,
  chunkProbFor: chunkProbFor, planSlots: planSlots, mutateChunk: mutateChunk, makeCandidates: makeCandidates, comboMult: comboMult, slotPoints: slotPoints,
  speedLevel: speedLevel, speedMult: speedMult, gapSec: gapSec, leadSec: leadSec, speedAfterHit: speedAfterHit, speedAfterFail: speedAfterFail,
  targetSpeed: targetSpeed, planHearts: planHearts, pickHeartSlot: pickHeartSlot, jumpHeight: jumpHeight, judge: judge, buildRound: buildRound,
  letterCount: letterCount, planRound: planRound, bossConfig: bossConfig
};
});
