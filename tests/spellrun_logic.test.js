// 스펠링 런 순수 로직 시험(public/js/spellrun/logic.js). 시제품의 prototype-test-logic.js 단언을 옮겼다(브라우저 없음).
// 시제품의 샘플 단어(음절 정보 포함)는 앱에 넣지 않고, 이 시험 안에만 둔다.
// 확인: 칸 나누기(조각은 정확히 한 음절 2~4글자, 철자 보존 fuzz), 후보, 점수, 속도(PACE 1.3·5콤보 최고 속도·실패 감속), 점프, 하트 계획(정규 10단어당 3개·3단어 묶음마다 1개), 판정, 라운드·보스 구성
// 실행: node --test tests/spellrun_logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');
const { CONFIG, planSlots, makeCandidates, comboMult, slotPoints, speedLevel, speedMult, gapSec, leadSec, speedAfterHit, speedAfterFail, targetSpeed, planHearts, pickHeartSlot, chunkProbFor, jumpHeight, judge, buildRound, isAlpha, planRound, bossConfig, letterCount, getSyllables, heuristicCuts } = L;

const WORDS = [
  { word: "apple", syl: "ap·ple", meaning: "사과" },
  { word: "book", syl: "book", meaning: "책" },
  { word: "school", syl: "school", meaning: "학교" },
  { word: "friend", syl: "friend", meaning: "친구" },
  { word: "window", syl: "win·dow", meaning: "창문" },
  { word: "music", syl: "mu·sic", meaning: "음악" },
  { word: "receive", syl: "re·ceive", meaning: "받다" },
  { word: "library", syl: "li·brar·y", meaning: "도서관" },
  { word: "because", syl: "be·cause", meaning: "왜냐하면" },
  { word: "tomorrow", syl: "to·mor·row", meaning: "내일" },
  { word: "ice-cream", syl: "ice-cream", meaning: "아이스크림" },
  { word: "beautiful", syl: "beau·ti·ful", meaning: "아름다운" },
  // 쉬움 (4~6글자)
  { word: "water", syl: "wa·ter", meaning: "물" },
  { word: "happy", syl: "hap·py", meaning: "행복한" },
  { word: "family", syl: "fam·i·ly", meaning: "가족" },
  { word: "answer", syl: "an·swer", meaning: "대답" },
  // 보통 (철자가 헷갈리는 단어)
  { word: "island", syl: "is·land", meaning: "섬" },
  { word: "enough", syl: "e·nough", meaning: "충분한" },
  { word: "weather", syl: "weath·er", meaning: "날씨" },
  { word: "believe", syl: "be·lieve", meaning: "믿다" },
  { word: "daughter", syl: "daugh·ter", meaning: "딸" },
  { word: "language", syl: "lan·guage", meaning: "언어" },
  { word: "exercise", syl: "ex·er·cise", meaning: "운동" },
  { word: "knowledge", syl: "knowl·edge", meaning: "지식" },
  { word: "business", syl: "busi·ness", meaning: "사업" },
  // 어려움 (긴 단어, 이중 자음, 특수 기호)
  { word: "different", syl: "dif·fer·ent", meaning: "다른" },
  { word: "difficult", syl: "dif·fi·cult", meaning: "어려운" },
  { word: "necessary", syl: "nec·es·sar·y", meaning: "필요한" },
  { word: "restaurant", syl: "res·tau·rant", meaning: "식당" },
  { word: "o'clock", syl: "o'clock", meaning: "~시 정각" },
  { word: "well-known", syl: "well-known", meaning: "유명한" },
  { word: "environment", syl: "en·vi·ron·ment", meaning: "환경" }
];

// 독립 기준: syl 문자열에서 음절 [시작, 길이]를 게임 코드와 따로 계산한다
const refSyl = w => {
  const out = []; let idx = 0, st = 0; const chars = [];
  for (const ch of Array.from(w.syl)) { if (ch === '·') { if (idx > st && /[a-z]/.test(chars[idx - 1] || '')) { out.push([st, idx - st]); st = idx; } } else { chars.push(ch); idx++; } }
  out.push([st, idx - st]);
  const res = [];
  for (const [s0, l0] of out) { let k = s0; while (k < s0 + l0) { if (!/[a-z]/.test(chars[k])) { k++; continue; } let e = k; while (e < s0 + l0 && /[a-z]/.test(chars[e])) e++; res.push([k, e - k]); k = e; } }
  return res;
};

test("0. 음절 데이터와 getSyllables가 독립 기준과 일치한다", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
for (const w of WORDS) {
  ok(w.syl && w.syl.replace(/·/g, '') === w.word, 'syl does not rebuild word: ' + w.word + ' / ' + w.syl);
  const total = refSyl(w).reduce((a, x) => a + x[1], 0);
  ok(total === letterCount(w.word), 'refSyl covers letters ' + w.word);
  const gs = getSyllables(w.word, w.syl, CONFIG);
  ok(gs.known && JSON.stringify(gs.syllables.map(x => [x.start, x.len])) === JSON.stringify(refSyl(w)), 'getSyllables mismatch ' + w.word);
}

  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("1. planSlots: 조각은 항상 음절 하나 전체, 철자 보존(fuzz 포함)", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
const baseCfg = Object.assign({}, CONFIG, { CHUNK_PROB_PER_LETTER: 0, MAX_SLOTS: 99 });
let chunkSlots = 0, eligible = 0, totalSlots = 0;
for (let n = 0; n < 3000; n++) {
  for (const w of WORDS) {
    const p = planSlots(w.word, Math.random, baseCfg, w.syl);
    const ref = refSyl(w);
    const refSet = new Set(ref.map(x => x[0] + ':' + x[1]));
    const covered = new Array(p.cells.length).fill(0);
    const letters = p.cells.filter(c => !c.fixed).length;
    for (const s of p.slots) {
      totalSlots++;
      ok(s.len === s.text.length, 'len mismatch ' + w.word);
      if (s.chunk) {
        chunkSlots++;
        ok(letters >= 3, 'chunk in short word ' + w.word);
        ok(s.len >= CONFIG.CHUNK_MIN && s.len <= CONFIG.CHUNK_MAX, 'chunk len range ' + w.word + ' ' + s.len);
        ok(refSet.has(s.start + ':' + s.len), 'CHUNK NOT A WHOLE SYLLABLE: ' + w.word + ' ' + s.text + ' @' + s.start);
      } else ok(s.len === 1, 'non-chunk must be one letter');
      for (let k = 0; k < s.len; k++) {
        ok(!p.cells[s.start + k].fixed, 'slot covers fixed cell ' + w.word);
        ok(p.cells[s.start + k].ch === s.text[k], 'text mismatch ' + w.word);
        covered[s.start + k]++;
      }
    }
    p.cells.forEach((c, i) => ok(c.fixed ? covered[i] === 0 : covered[i] === 1, 'coverage ' + w.word + ' idx ' + i));
    if (letters >= 3) eligible += ref.filter(x => x[1] >= CONFIG.CHUNK_MIN && x[1] <= CONFIG.CHUNK_MAX).length;
  }
}
console.log('chunk ratio per eligible syllable', (chunkSlots / eligible).toFixed(3), '(target 0.2)');
ok(Math.abs(chunkSlots / eligible - 0.2) < 0.02, 'chunk probability off');
// 5-letter syllable "knowl" (>4) and 1-letter syllables never chunk
for (let n = 0; n < 3000; n++) {
  const p = planSlots('knowledge', Math.random, CONFIG, 'knowl·edge');
  ok(p.slots.filter(s => s.chunk).every(s => s.text === 'edge'), 'knowl must not chunk');
  const q = planSlots('enough', Math.random, CONFIG, 'e·nough');
  ok(q.slots.filter(s => s.chunk).every(s => s.text === 'nough' ? false : true) , 'nough (5) must not chunk');
}
// 'e' (1 letter) never chunks; "enough" has no chunkable syllable
for (let n = 0; n < 500; n++) ok(planSlots('enough', Math.random, CONFIG, 'e·nough').slots.every(s => !s.chunk), 'enough should never chunk');
// no syl + fallback none -> no chunks at all
const ncfg = Object.assign({}, CONFIG, { SYLLABLE_FALLBACK: 'none' });
for (let n = 0; n < 2000; n++) ok(planSlots('restaurant', Math.random, ncfg).slots.every(s => !s.chunk), 'chunk without syllable data (none mode)');
// bad syl (does not rebuild word) is ignored (none mode: no chunks; default heuristic mode: falls back to heuristic cuts)
for (let n = 0; n < 500; n++) ok(planSlots('apple', Math.random, ncfg, 'ap·pl').slots.every(s => !s.chunk), 'bad syl used');
ok(CONFIG.SYLLABLE_FALLBACK === 'heuristic', 'default fallback is heuristic');
for (let n = 0; n < 500; n++) { const p = planSlots('apple', Math.random, CONFIG, 'ap·pl'); ok(p.slots.map(s => s.text).join('') === 'apple', 'bad syl broke spelling'); }
// short word never chunks
for (let n = 0; n < 500; n++) ok(planSlots('go', Math.random, CONFIG, 'go').slots.every(s => !s.chunk), 'go chunked');
// hyphen / apostrophe: chunk never across non-alpha
for (let n = 0; n < 3000; n++) for (const w of [['ice-cream','ice-cream'],["o'clock","o'clock"],['well-known','well-known']]) {
  const p = planSlots(w[0], Math.random, CONFIG, w[1]);
  ok(p.slots.every(s => !p.cells.slice(s.start, s.start + s.len).some(c => c.fixed)), 'chunk across non-alpha ' + w[0]);
}
// heuristic fallback: chunks must align with heuristic syllables, and report accuracy vs. hand data
const hcfg = Object.assign({}, CONFIG, { SYLLABLE_FALLBACK: 'heuristic' });
let exact = 0, cmp = [];
for (const w of WORDS) {
  const h = getSyllables(w.word, undefined, hcfg);
  const hs = JSON.stringify(h.syllables.map(x => [x.start, x.len]));
  const rs = JSON.stringify(refSyl(w));
  if (hs === rs) exact++; else cmp.push(w.word + ': ' + h.syllables.map(x => w.word.slice(x.start, x.start + x.len)).join('·') + '  (사전 ' + w.syl + ')');
  for (let n = 0; n < 200; n++) {
    const p = planSlots(w.word, Math.random, hcfg);
    const hset = new Set(h.syllables.map(x => x.start + ':' + x.len));
    ok(p.slots.filter(s => s.chunk).every(s => hset.has(s.start + ':' + s.len)), 'heuristic chunk not aligned ' + w.word);
  }
}
// 철자 보존: 어떤 모드에서도 칸들을 이어 붙이면(고정 문자 포함) 원래 단어와 정확히 같아야 한다
const rebuild = p => { let out = ''; let i = 0; const byStart = new Map(p.slots.map(s => [s.start, s])); while (i < p.cells.length) { if (byStart.has(i)) { out += byStart.get(i).text; i += byStart.get(i).len; } else { out += p.cells[i].ch; i++; } } return out; };
const alphaCh = 'abcdefghijklmnopqrstuvwxyz';
for (const w of WORDS) for (const cfg of [CONFIG, hcfg, ncfg]) for (let n = 0; n < 300; n++) ok(rebuild(planSlots(w.word, Math.random, cfg, n % 2 ? w.syl : undefined)) === w.word, 'spelling not preserved ' + w.word);
for (let n = 0; n < 20000; n++) {
  const len = 1 + Math.floor(Math.random() * 14); let word = '';
  for (let k = 0; k < len; k++) { const r = Math.random(); word += r < 0.06 ? '-' : r < 0.1 ? "'" : alphaCh[Math.floor(Math.random() * 26)]; }
  if (!/[a-z]/.test(word)) continue;
  const p = planSlots(word, Math.random, hcfg);
  ok(rebuild(p) === word, 'fuzz spelling not preserved ' + word);
  const gs = getSyllables(word, undefined, hcfg);
  ok(gs.syllables.reduce((a, x) => a + x.len, 0) === letterCount(word), 'fuzz syllables cover letters ' + word);
  ok(p.slots.every(s => !p.cells.slice(s.start, s.start + s.len).some(c => c.fixed)), 'fuzz chunk across non-alpha ' + word);
  const sset = new Set(gs.syllables.map(x => x.start + ':' + x.len));
  ok(p.slots.filter(s => s.chunk).every(s => sset.has(s.start + ':' + s.len)), 'fuzz chunk not a syllable ' + word);
}
console.log('heuristic exact matches: ' + exact + '/' + WORDS.length);
cmp.forEach(c => console.log('  diff ' + c));

  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("1b. 긴 단어일수록 조각이 많고 칸 수가 상한 이내", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
const minSlots = (w, cfg) => { const ref = refSyl(w); const letters = letterCount(w.word); return letters - ref.filter(x => x[1] >= cfg.CHUNK_MIN && x[1] <= cfg.CHUNK_MAX).reduce((a, x) => a + (x[1] - 1), 0); };
const bc0 = bossConfig();
const lenStats = [];
for (const w of WORDS) {
  const letters = letterCount(w.word);
  let total = 0, cap = 0; const N = 2000;
  const refSet = new Set(refSyl(w).map(x => x[0] + ':' + x[1]));
  for (let n = 0; n < N; n++) {
    const p = planSlots(w.word, Math.random, CONFIG, w.syl);
    total += p.slots.length;
    ok(p.slots.filter(s => s.chunk).every(s => refSet.has(s.start + ':' + s.len)), 'long-word chunk not a syllable ' + w.word);
    ok(p.slots.map(s => s.text).join('') === w.word.replace(/[^a-z]/g, ''), 'long-word spelling ' + w.word);
    const limit = Math.max(CONFIG.MAX_SLOTS, minSlots(w, CONFIG));
    if (p.slots.length > limit) cap++;
    const pb = planSlots(w.word, Math.random, bc0, w.syl);
    ok(pb.slots.length <= Math.max(bc0.MAX_SLOTS, minSlots(w, bc0)), 'boss slot cap ' + w.word);
  }
  ok(cap === 0, 'slot cap exceeded ' + w.word + ' ' + cap);
  lenStats.push([w.word, letters, total / N, minSlots(w, CONFIG)]);
}
{
  const avg = arr => arr.reduce((a, x) => a + x, 0) / arr.length;
  const short = lenStats.filter(x => x[1] <= 5), long = lenStats.filter(x => x[1] >= 9);
  const ratio = arr => avg(arr.map(x => x[2] / x[1]));
  console.log('slots per letter: short(<=5)', ratio(short).toFixed(2), ' long(>=9)', ratio(long).toFixed(2));
  ok(ratio(long) < ratio(short), 'long words should have fewer slots per letter');
  console.log('slot counts (letters -> avg slots):', lenStats.filter(x => x[1] >= 8).map(x => x[0] + ' ' + x[1] + '->' + x[2].toFixed(1)).join(', '));
  ok(chunkProbFor(5) === CONFIG.CHUNK_PROB && chunkProbFor(11) > chunkProbFor(7) && chunkProbFor(40) === 1, 'chunkProbFor');
}

  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("2. makeCandidates: 정답 1개, 오답은 같은 길이·고유", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
for (let n = 0; n < 1500; n++) {
  for (const w of WORDS) {
    const p = planSlots(w.word, Math.random, CONFIG, w.syl);
    for (const s of p.slots) {
      for (const N of [2, 3, 4, 5]) {
        const cfg = Object.assign({}, CONFIG, { CANDIDATES: N });
        const c = makeCandidates(s.text, w.word, Math.random, cfg);
        ok(c.length === N, 'cand count ' + N + ' ' + s.text);
        ok(c.filter(x => x.correct).length === 1, 'exactly one correct');
        ok(new Set(c.map(x => x.text)).size === N, 'unique texts');
        ok(c.every(x => x.text.length === s.text.length), 'same length');
        ok(c.every(x => /^[a-z]+$/.test(x.text)), 'lowercase letters');
        ok(c.find(x => x.correct).text === s.text, 'correct text');
      }
    }
  }
}
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("3. 점수 계산", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
ok(comboMult(0) === 1, 'mult 0');
ok(Math.abs(comboMult(10) - 2) < 1e-9 && Math.abs(comboMult(99) - 2) < 1e-9, 'mult cap');
ok(slotPoints(1, 1) === 110, 'points 1/1 = ' + slotPoints(1, 1));
ok(slotPoints(2, 1) === Math.round((200 + 120) * 1.1), 'points 2/1');
ok(slotPoints(3, 0) === 100 * 3 + 60 * 3, 'points 3/0');
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("4. 속도: PACE 1.3, 5콤보 최고 속도, 실패 시 감속", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
const C = CONFIG;
ok(speedLevel(C.SPEED_MIN) === 0 && speedLevel(C.SPEED_MAX) === 1 && speedLevel(0) === 0 && speedLevel(999) === 1, 'speedLevel clamp');
ok(speedMult(C.SPEED_MIN) === 1 && Math.abs(speedMult(C.SPEED_MAX) - (1 + C.SPEED_SCORE_BONUS)) < 1e-9, 'speedMult range');
let prevM = 0; for (let v = C.SPEED_MIN; v <= C.SPEED_MAX; v += 5) { const m = speedMult(v); ok(m >= prevM, 'speedMult monotonic'); prevM = m; }
ok(Math.abs(gapSec(C.SPEED_MIN) - C.GAP_SEC_SLOW) < 1e-9 && Math.abs(gapSec(C.SPEED_MAX) - C.GAP_SEC_FAST) < 1e-9, 'gapSec ends');
ok(Math.abs(leadSec(C.SPEED_MIN) - C.LEAD_SEC_SLOW) < 1e-9 && Math.abs(leadSec(C.SPEED_MAX) - C.LEAD_SEC_FAST) < 1e-9, 'leadSec ends');
let pg = 99; for (let v = C.SPEED_MIN; v <= C.SPEED_MAX; v += 5) { const g = gapSec(v); ok(g <= pg + 1e-9, 'gapSec decreasing'); pg = g; }
const near = (a, b) => Math.abs(a - b) < 1e-9;
ok(near(speedAfterHit(C.SPEED_MIN, false), C.SPEED_MIN + C.SPEED_UP_HIT) && near(speedAfterHit(C.SPEED_MIN, true), C.SPEED_MIN + C.SPEED_UP_CHUNK) && speedAfterHit(C.SPEED_MAX - 1, true) === C.SPEED_MAX, 'speedAfterHit');
// 속도 배율: 이전 값(130~280)의 1.3배
ok(Math.abs(C.SPEED_MIN - 130 * 1.3) < 0.01 && Math.abs(C.SPEED_MAX - 280 * 1.3) < 0.01, 'speed is 1.3x of previous');
// 간격(px)과 점프 거리는 그대로이고 시간만 짧아진다: 이전 px 간격과 같아야 한다
ok(Math.abs(C.GAP_SEC_FAST * C.SPEED_MAX - 0.72 * 280) < 1.5 && Math.abs(C.GAP_SEC_SLOW * C.SPEED_MIN - 1.15 * 130) < 1.5, 'gap px unchanged');
// 5콤보 이상이면 최고 속도
ok(targetSpeed(C.SPEED_MIN, 4) === C.SPEED_MIN && targetSpeed(C.SPEED_MIN, C.COMBO_MAX_SPEED) === C.SPEED_MAX && targetSpeed(C.SPEED_MIN, 12) === C.SPEED_MAX && targetSpeed(200, 0) === 200, 'targetSpeed combo rule');
ok(C.COMBO_MAX_SPEED === 5, 'combo threshold is 5');
ok(near(speedAfterFail(300), 300 - C.SPEED_DROP_FAIL) && speedAfterFail(C.SPEED_MIN + 1) === C.SPEED_MIN && speedAfterFail(C.SPEED_MIN) === C.SPEED_MIN, 'speedAfterFail floor');
// 반복: 맞히면 오르고 틀리면 내려가며 항상 범위 안
{ let v = C.SPEED_MIN; for (let i = 0; i < 2000; i++) { v = Math.random() < 0.8 ? speedAfterHit(v, Math.random() < 0.3) : speedAfterFail(v); ok(v >= C.SPEED_MIN && v <= C.SPEED_MAX, 'speed in range'); } }
// 빠른 속도에서 같은 칸을 맞히면 점수가 더 높다
ok(slotPoints(1, 3) * speedMult(C.SPEED_MAX) > slotPoints(1, 3) * speedMult(C.SPEED_MIN), 'faster scores more');
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("5. 점프 높이와 체공 시간", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
ok(Math.abs(jumpHeight(CONFIG.JUMP_TIME / 2) - CONFIG.JUMP_PEAK) < 1e-9, 'peak');
ok(jumpHeight(-1) === 0 && jumpHeight(0) === 0 && jumpHeight(CONFIG.JUMP_TIME + 0.1) === 0, 'ground');
const airTime = (() => { let a = 0; for (let t = 0; t < CONFIG.JUMP_TIME; t += 0.001) if (jumpHeight(t) > CONFIG.GRAB_H) a += 0.001; return a; })();
console.log('airborne time over GRAB_H:', airTime.toFixed(3), 's  (fastest pack gap', CONFIG.GAP_SEC_FAST, 's)');
ok(airTime < CONFIG.GAP_SEC_FAST - 0.12, 'one jump could cover two tiles at max speed');
ok(CONFIG.GAP_SEC_FAST * CONFIG.SPEED_MAX >= 20 + CONFIG.CHUNK_MAX * 26 && CONFIG.GAP_SEC_SLOW * CONFIG.SPEED_MIN >= 20 + CONFIG.CHUNK_MAX * 26 + 10, 'tiles overlap at some speed');
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("5b. 하트 계획: 정규 단어 10개당 3개, 3단어 묶음마다 1개", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
{
  for (let n = 0; n < 500; n++) {
    const h = planHearts(10);
    ok(h.size === 3, 'hearts per round of 10: ' + h.size);
    const arr = [...h].sort((a, b) => a - b);
    ok(arr[0] <= 2 && arr[1] >= 3 && arr[1] <= 5 && arr[2] >= 6 && arr[2] <= 8, 'one heart per group of 3: ' + arr);
    ok(![...h].some(i => i >= 9), 'no heart on trailing leftover word');
  }
  ok(planHearts(2).size === 0 && planHearts(3).size === 1 && planHearts(6).size === 2 && planHearts(0).size === 0, 'planHearts sizes');
  const seen = new Set(); for (let n = 0; n < 400; n++) planHearts(3).forEach(i => seen.add(i));
  ok(seen.size === 3, 'heart position varies within group');
  for (let n = 0; n < 300; n++) { for (const k of [1, 2, 3, 6, 7]) { const sl = pickHeartSlot(k); ok(sl >= 0 && sl < k, 'heart slot in range'); if (k > 1) ok(sl >= 1, 'heart slot not first'); } }
}
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("6. 판정", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
ok(judge(true, true) === 'hit' && judge(false, true) === 'wrong' && judge(true, false) === 'miss' && judge(false, false) === 'pass', 'judge');
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test("7. 라운드 구성: 틀린 단어 우선, 복습 판", () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
const missed = new Set(['apple', 'book']);
for (let n = 0; n < 200; n++) {
  const r = buildRound(WORDS, missed);
  ok(r.length === 10, 'round size');
  ok(new Set(r.map(w => w.word)).size === r.length, 'round unique');
  ok(missed.has(r[0].word) && missed.has(r[1].word), 'missed first');
  const rv = buildRound(WORDS, missed, CONFIG, Math.random, true);
  ok(rv.length === 2 && rv.every(w => missed.has(w.word)), 'review only');
}
ok(buildRound(WORDS, new Set(), CONFIG, Math.random, true).length === 0, 'review empty');
ok(buildRound(WORDS.slice(0, 3), new Set()).length === 3, 'short list');
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

test('8. 보스: 선택 단어 중 8글자 이상이 있을 때만 1개, 정규 단어와 겹치지 않는다(planRound)', () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  ok(letterCount('ice-cream') === 8 && letterCount("o'clock") === 6, 'letterCount');
  for (let n = 0; n < 500; n++) {
    const r = planRound(WORDS, new Set());
    ok(r.boss && letterCount(r.boss.word) >= CONFIG.BOSS_MIN_LETTERS, 'boss long enough');
    ok(!r.regular.some(w => w.word === r.boss.word), 'boss not in regular');
    ok(r.regular.length === CONFIG.WORDS_PER_ROUND && new Set(r.regular.map(w => w.word)).size === r.regular.length, 'regular size/unique');
  }
  // 선택이 적어도(10개 이하) 긴 단어가 있으면 보스가 되고, 나머지가 정규 단어
  const few = [WORDS.find(w => w.word === 'apple'), WORDS.find(w => w.word === 'book'), WORDS.find(w => w.word === 'environment')];
  for (let n = 0; n < 100; n++) { const r = planRound(few, new Set()); ok(r.boss && r.boss.word === 'environment' && r.regular.length === 2, 'few: boss environment, 2 regular'); }
  // 긴 단어가 하나도 없으면 보스 없음
  const shortOnly = WORDS.filter(w => letterCount(w.word) < CONFIG.BOSS_MIN_LETTERS).slice(0, 5);
  ok(planRound(shortOnly, new Set()).boss === null && planRound(shortOnly, new Set()).regular.length === 5, 'no boss without long word');
  // 복습 판에는 보스가 없고, 틀린 단어만 나온다
  const missed = new Set(['apple', 'environment']);
  const rv = planRound(WORDS, missed, CONFIG, Math.random, true);
  ok(rv.boss === null && rv.regular.length === 2 && rv.regular.every(w => missed.has(w.word)), 'review: no boss, only missed');
  // 틀린 단어가 정규 단어에서 먼저 나온다
  for (let n = 0; n < 200; n++) {
    const r = planRound(WORDS, new Set(['apple', 'book']));
    ok(r.regular[0] && r.regular[1] && ['apple', 'book'].includes(r.regular[0].word) && ['apple', 'book'].includes(r.regular[1].word), 'missed first in planRound');
  }
  const bc = bossConfig();
  ok(bc.CANDIDATES === 4 && bc.CHUNK_PROB === 0.35 && CONFIG.CANDIDATES === 3 && CONFIG.CHUNK_PROB === 0.2, 'bossConfig does not mutate CONFIG');
  ok(bc.MAX_SLOTS === CONFIG.BOSS_MAX_SLOTS && CONFIG.MAX_SLOTS === 6, 'bossConfig slots');
  for (let n = 0; n < 500; n++) for (const w of WORDS) for (const s of planSlots(w.word, Math.random, bc, w.syl).slots) {
    const c = makeCandidates(s.text, w.word, Math.random, bc);
    ok(c.length === 4 && c.filter(x => x.correct).length === 1 && new Set(c.map(x => x.text)).size === 4, 'boss candidates');
  }
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});
