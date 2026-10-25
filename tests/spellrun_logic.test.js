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
ok(targetSpeed(C.SPEED_MIN, 0) === C.SPEED_MIN && targetSpeed(C.SPEED_MIN, 1) === C.SPEED_MIN && targetSpeed(C.SPEED_MIN, C.COMBO_MAX_SPEED) === C.SPEED_MAX && targetSpeed(C.SPEED_MIN, 12) === C.SPEED_MAX && targetSpeed(200, 0) === 200, 'targetSpeed combo rule');   // 작업320: 콤보 4 는 더 이상 기본 속도가 아니라 램프 75% (아래 320 시험)
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

test('8. 보스(작업320): 5번째·10번째 단어, 5개 미만이면 없음, 5~9개면 5번째만, 긴 단어부터 배정, 복습 판에는 없음, 중복 없음', () => {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  ok(letterCount('ice-cream') === 8 && letterCount("o'clock") === 6, 'letterCount');
  ok(CONFIG.BOSS_MIN_LETTERS === undefined && JSON.stringify(CONFIG.BOSS_POSITIONS) === '[5,10]', '글자 수 조건 제거, 위치 5·10');
  for (let n = 0; n < 300; n++) {
    const r = planRound(WORDS, new Set());
    ok(r.list.length === CONFIG.WORDS_PER_ROUND && new Set(r.list.map(w => w.word)).size === 10, 'size/unique');
    ok(JSON.stringify(r.bossIdx) === '[4,9]' && r.regular === 8, 'boss at 5th/10th');
    const longest = WORDS.map(w => letterCount(w.word)).sort((x, y) => y - x);
    ok(letterCount(r.list[4].word) === longest[0] && letterCount(r.list[9].word) === longest[1], 'longest words get boss slots: ' + r.list[4].word + ',' + r.list[9].word);
  }
  const take = k => WORDS.slice(0, k);
  for (const [k, idx] of [[0, []], [1, []], [4, []], [5, [4]], [9, [4]], [10, [4, 9]], [11, [4, 9]]]) {
    const r = planRound(take(k), new Set());
    ok(JSON.stringify(r.bossIdx) === JSON.stringify(idx) && r.list.length === Math.min(10, k) && r.regular === r.list.length - idx.length, 'shape of ' + k);
    const sh = L.roundShape(k);
    ok(sh.total === r.list.length && sh.bosses === idx.length && sh.regular === r.regular, 'roundShape ' + k);
  }
  // 같은 길이는 무작위로 배정된다
  const same = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff'].map(w => ({ word: w }));
  const seen = new Set(); for (let n = 0; n < 200; n++) seen.add(planRound(same, new Set()).list[4].word);
  ok(seen.size > 3, 'ties random');
  // 틀린 단어는 보스가 아닌 자리에서 먼저 나온다
  for (let n = 0; n < 100; n++) {
    const r = planRound(WORDS, new Set(['apple', 'book']));
    const regs = r.list.filter((_, i) => !r.bossIdx.includes(i));
    ok(regs[0] && regs[1] && ['apple', 'book'].includes(regs[0].word) && ['apple', 'book'].includes(regs[1].word) || r.list.some((w, i) => r.bossIdx.includes(i) && ['apple', 'book'].includes(w.word)), 'missed first among regular');
  }
  // 복습 판에는 보스가 없고 틀린 단어만 나온다
  const missed = new Set(['apple', 'environment', 'window', 'music', 'friend', 'school']);
  const rv = planRound(WORDS, missed, CONFIG, Math.random, true);
  ok(rv.bossIdx.length === 0 && rv.list.length === 6 && rv.list.every(w => missed.has(w.word)) && rv.regular === 6, 'review: no boss, only missed');
  // 하트 계획은 보스를 제외한 단어 수(regular) 기준
  ok(planHearts(planRound(WORDS, new Set()).regular).size === 2, 'hearts over 8 regular = 2');
  const bc = bossConfig();
  ok(bc.CANDIDATES === 4 && bc.CHUNK_PROB === 0.35 && CONFIG.CANDIDATES === 3 && CONFIG.CHUNK_PROB === 0.2, 'bossConfig does not mutate CONFIG');
  ok(bc.MAX_SLOTS === CONFIG.BOSS_MAX_SLOTS && CONFIG.MAX_SLOTS === 6, 'bossConfig slots');
  ok(CONFIG.BOSS_MULT === 2 && CONFIG.BOSS_BONUS === 1000 && CONFIG.BOSS_SPEED_BONUS === Math.round(20 * 1.3 * 100) / 100 && CONFIG.BOSS_HEAL === 1, '보스 효과 수치 그대로');
  for (let n = 0; n < 500; n++) for (const w of WORDS) for (const s of planSlots(w.word, Math.random, bc, w.syl).slots) {
    const c = makeCandidates(s.text, w.word, Math.random, bc);
    ok(c.length === 4 && c.filter(x => x.correct).length === 1 && new Set(c.map(x => x.text)).size === 4, 'boss candidates');
  }
  assert.deepEqual(fails.slice(0, 8), [], '실패 ' + fails.length + '건');
});

// ───────── 작업318: 폭 배분 · 힌트 · 2단 점프 · 주소 옵션 ─────────
const seq = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('318-1. 글자 칸 줄 폭 배분: 칸 수 1~7, 조각 칸·고정 글자 포함, 어떤 입력에서도 합계가 사용 가능 폭 이하이고 글자 크기 하한 이상 → 간격 순으로 줄어든다', () => {
  const avail = L.LAYOUT.WORD_AVAIL_W;
  const rng = seq(7);
  const mk = (slots, chunkProb) => Array.from({ length: slots }, () => (rng() < chunkProb ? { n: 2 + Math.floor(rng() * 3), chunk: true } : { n: 1, chunk: false }));
  let shrunk = 0;
  for (let slots = 1; slots <= 7; slots++) for (const chunkProb of [0, 0.5, 1]) for (let k = 0; k < 40; k++) {
    const items = mk(slots, chunkProb);
    if (rng() < 0.2) items.splice(Math.floor(rng() * items.length), 0, { fixed: true });
    const f = L.fitWord(items, avail);
    assert.ok(f.width <= avail + 1e-9, `폭 초과 ${f.width} > ${avail}: ${JSON.stringify(items)}`);
    assert.equal(f.width, L.wordWidth(items, f.cw, f.cellGap, f.slotGap, f.chunkPad));
    assert.ok(f.cw <= 34 && f.fs > 0);
    if (f.cw >= 16) assert.ok(f.cellGap >= 1 && f.slotGap >= 2);
    if (f.cw < 34) shrunk++;
    if (f.cw === 16 && (f.cellGap < 3 || f.slotGap < 5)) assert.ok(L.wordWidth(items, 16, 3, 5, 4) > avail, '간격은 하한 글자 크기에서도 넘칠 때만 줄인다');
    if (f.cw > 16) assert.equal(f.cellGap, 3, '글자 크기를 줄이는 동안은 간격 유지');
  }
  assert.ok(shrunk > 0);
  assert.equal(L.fitWord([{ n: 1 }, { n: 1 }, { n: 1 }, { n: 1 }, { n: 1 }], avail).cw, 34, '짧은 단어는 최대 크기');
  // 보스 단어(최대 7칸)와 4글자 조각 칸 = 실제 최악: 13글자 7칸 / 조각 4글자 칸 4개
  const boss = [{ n: 4, chunk: true }, { n: 1 }, { n: 1 }, { n: 4, chunk: true }, { n: 1 }, { n: 1 }, { n: 4, chunk: true }];
  const fb = L.fitWord(boss, avail);
  assert.ok(fb.width <= avail && fb.cw >= 16, `보스 최악 ${JSON.stringify(fb)}`);
  // 폭 320~768 (resize() 와 같은 배율 식): 줄 전체 폭(px) 이 상자 안쪽 폭 이하
  for (const css of [320, 360, 390, 768, 1024]) {
    const scale = Math.max(0.5, Math.min((css - 16) / 360, 1.5));
    assert.ok(fb.width * scale <= (360 - 28) * scale + 1e-6, 'css ' + css);
  }
  // 7칸이 전부 4글자 조각 칸이면 하한 아래로 내려가더라도 반드시 들어간다(비현실적 입력의 마지막 수단)
  const all = L.fitWord(Array(7).fill({ n: 4, chunk: true }), avail);
  assert.ok(all.width <= avail && all.cw < 16);
});

test('322-2. 정답 가리기: 활용형(-s -es -ed -ing -ly -er -est, e 탈락, y→i, 자음 중복)·대소문자·아포스트로피, 다른 단어 안의 철자는 가리지 않는다', () => {
  const cases = [['happy', 'Happily, the happier one was happiest.'], ['make', 'Making it, she maked and makes makers.'], ['stop', 'It stopped, stopping the stopper.'], ['watch', 'He watches it.'], ['quick', 'Quickly now, quicker, quickest.'], ['study', 'She studies and studied.']];
  for (const [w, text] of cases) {
    assert.ok(L.maskText(text, w).includes('＿＿'), w);
    for (const form of L.wordForms(w)) assert.ok(!L.maskText(`x ${form} y`, w).includes(form), `${w}: ${form}`);
  }
  assert.equal(L.maskText('Running, RUN and Runs', 'run'), '＿＿, ＿＿ and ＿＿');
  assert.equal(L.maskText('The runway and a rerun', 'run'), 'The runway and a rerun');
  assert.equal(L.maskText("It is 5 o'clock now", "o'clock"), 'It is 5 ＿＿ now');
  assert.equal(L.maskText("It is 5 o’clock now", "o'clock"), 'It is 5 ＿＿ now');
  assert.equal(L.maskText('이 run을 보라', 'run'), '이 ＿＿을 보라', '한글 조사가 붙어도');
  assert.equal(L.maskText('He ran home.', 'run'), 'He ran home.', '한계: 불규칙 활용은 가리지 못한다');
});

test('322-2. 보조 줄 구성: 대표 뜻의 키워드는 빼고 중복 제거, 앞에서 최대 6개, 품사·쓰임 설명·예문은 넣지 않으며 정답은 가려진다. 상세 박스 필드는 더 이상 만들지 않는다', () => {
  const row = { example_sentence: 'She runs every morning.', data: { pronunciation: '/rʌn/', short_meaning: '달리다, 뛰다', meanings: [
    { pos: 'verb', definition: '달리다, 뛰다, 질주하다', usage_note: '아침 운동처럼 run 하는 상황에서 쓴다.', example: 'He ran home.' },
    { pos: 'verb', definition: '운영하다, 관리하다, 경영하다' }, { pos: 'noun', definition: '달리기, 질주하다, 연속' }, { definition: '흐르다, run 하다' }, { definition: '출마하다，작동하다' }, { definition: '이어지다' }] } };
  const h = L.buildHint(row, 'run', '달리다, 뛰다');
  assert.deepEqual(Object.keys(h.hint).sort(), ['meaning', 'subs'], '품사·다른 뜻 줄·쓰임 설명·예문 필드 없음');
  assert.equal(h.hint.meaning, '달리다, 뛰다');
  assert.deepEqual(h.hint.subs, ['질주하다', '운영하다', '관리하다', '경영하다', '달리기', '연속'], '대표 뜻 키워드 제외, 중복(질주하다) 한 번, 최대 6개');
  const all = JSON.stringify(h.hint);
  assert.ok(!all.includes('동사') && !all.includes('명사') && !all.includes('아침 운동') && !all.includes('…') && !all.includes('She runs'));
  // 정답 가리기 유지: 보조 줄 키워드와 대표 뜻의 정답 철자(활용형 포함)
  const m = L.buildHint({ data: { meanings: [{ definition: 'run 하다, 달리다' }, { definition: 'running 중인, 운영하다' }] } }, 'run', 'runs 와 달리다');
  assert.equal(m.hint.meaning, '＿＿ 와 달리다'); assert.ok(m.hint.subs.every(k => !/run/i.test(k)), JSON.stringify(m.hint.subs));
  // 완성 팝업 데이터(IPA·뜻·예문·강조 위치)는 그대로
  assert.deepEqual(h.pop, { pron: '/rʌn/', meaning: '달리다, 뛰다', example: 'She runs every morning.', ranges: [[4, 8]] });
  // 비는 경우: meanings 없음·정의 없음·전부 대표 뜻과 같음 → 빈 배열(줄 없음)
  for (const row2 of [null, undefined, {}, { data: null }, { data: { meanings: 'x' } }, { data: { meanings: [null, 5, { definition: 7 }] } }, { data: { meanings: [{ definition: '사과' }] } }]) {
    assert.deepEqual(L.buildHint(row2, 'apple', '사과').hint.subs, [], JSON.stringify(row2));
  }
  // core_meaning 만 있는 옛 데이터, 7개 이상이어도 6개
  assert.deepEqual(L.buildHint({ data: { meanings: [{ core_meaning: '가, 나' }] } }, 'x1', '다').hint.subs, ['가', '나']);
  assert.equal(L.buildHint({ data: { meanings: [{ definition: 'a1,a2,a3,a4,a5,a6,a7,a8' }] } }, 'zz', '대표').hint.subs.length, 6);
  // 예문 후보 선택(완성 팝업용): 단어가 들어 있는 예문을 우선, 없으면 첫 예문 그대로(강조 없음), 옛 스키마 usages
  const missing = L.buildHint({ example_sentence: 'He ran fast.', data: { meanings: [{ definition: '달리다' }] } }, 'run', '달리다');
  assert.equal(missing.pop.example, 'He ran fast.'); assert.deepEqual(missing.pop.ranges, []);
  const alt = L.buildHint({ example_sentence: 'Nothing here.', data: { meanings: [{ definition: '길', example: 'Take the road.' }], usages: [{ example: 'A road trip.' }] } }, 'road', '길');
  assert.equal(alt.pop.example, 'Take the road.'); assert.deepEqual(alt.pop.ranges, [[9, 13]]);
  assert.equal(L.buildHint({ data: { usages: [{ example: 'A road trip.' }, null, 'x'] } }, 'road', '길').pop.example, 'A road trip.');
  for (const row3 of [null, { data: { meanings: [null, 5, { pos: 5, definition: 7, example: {} }] } }, { data: { meanings: [], usages: 'x' }, example_sentence: 5 }]) assert.doesNotThrow(() => L.buildHint(row3, 'road', '길'));
  // 어떤 필드에서도 정답(활용형 포함)이 남지 않는다
  for (const w of ['book', 'happy', 'make', 'stop', 'environment', 'water', 'friend']) {
    const text = `${w} ${w}s ${w}es ${w}ed ${w}ing ${w}ly ${w}er ${w}est ${w.toUpperCase()}`;
    const hh = L.buildHint({ data: { meanings: [{ definition: text }, { definition: text + ', ' + text + '2' }] } }, w, text).hint;
    const joined = [hh.meaning, ...hh.subs].join(' ').toLowerCase();
    for (const f of [w, ...L.wordForms(w)]) assert.ok(!joined.includes(f.toLowerCase()) || f.length < 3, `${w}: '${f}' 가 남음`);
  }
  assert.equal(L.POS_KO, undefined); assert.equal(L.firstSentence, undefined, '상세 박스용 도구 제거');
  assert.equal(L.LAYOUT.HINT_BOTTOM_Y, undefined); assert.equal(L.LAYOUT.HINT_BOTTOM_Y_DJ, undefined);
  assert.ok(L.LAYOUT.HUD_SHIFT >= 20 && L.LAYOUT.HUD_SHIFT <= 30, '내리는 거리 20~30');
  assert.ok(L.LAYOUT.CONTENT_BOTTOM_Y < L.LAYOUT.HIGH_TILE_Y - L.LAYOUT.TILE_H / 2, '내용 아래 끝 한계는 높은 칸 타일 윗변(276)보다 위');
});

test('318-4. 높은 칸 계획: 꺼져 있으면 없음, 첫 칸 제외·최대 2개·전부 높은 칸 없음·확률 반영, 조각 칸과 무관', () => {
  const on = CONFIG;   // 작업320: 기본 켜짐
  for (let n = 0; n <= 8; n++) assert.equal(L.planHighSlots(n, Math.random, { ...CONFIG, DJ_ENABLED: false }).size, 0, 'dj 꺼짐(?dj=0)');
  assert.equal(L.planHighSlots(1, () => 0, on).size, 0, '칸이 하나뿐이면 없음');
  let total = 0, trials = 0; const hist = {};
  for (let n = 2; n <= 7; n++) for (let k = 0; k < 3000; k++) {
    const s = L.planHighSlots(n, Math.random, on);
    assert.ok(s.size <= on.HIGH_MAX && s.size < n, '최대 2개, 전부 높은 칸 없음');
    assert.ok(!s.has(0), '첫 칸 제외');
    for (const i of s) assert.ok(Number.isInteger(i) && i >= 1 && i < n);
    hist[s.size] = (hist[s.size] || 0) + 1; total += s.size; trials += n - 1;
  }
  assert.ok(hist[0] > 0 && hist[1] > 0 && hist[2] > 0, '0·1·2개 모두 나온다 ' + JSON.stringify(hist));
  assert.ok(total / trials > 0.12 && total / trials < 0.24, '칸당 비율이 HIGH_SLOT_PROB(0.2) 부근(상한 2개 때문에 약간 낮음): ' + (total / trials).toFixed(3));
  assert.equal(L.planHighSlots(5, () => 0.99, on).size, 0, '확률 0 쪽 난수');
  assert.equal(L.planHighSlots(7, () => 0, on).size, 2, '항상 뽑혀도 2개까지');
  assert.equal(L.planHighSlots(7, () => 0.5, { ...on, HIGH_SLOT_PROB: 0 }).size, 0);
  // 같은 입력 난수열이면 같은 결과(조각 칸 여부 정보를 받지 않는다)
  assert.deepEqual([...L.planHighSlots(6, seq(3), on)], [...L.planHighSlots(6, seq(3), on)]);
  assert.equal(L.planHighSlots.length >= 1, true);
});

test('318-4. 2단 점프 물리: 한 번 점프로는 높은 칸에 닿지 않고, 최고 속도에서 2단 점프가 높이 이상에 머무는 시간은 간격(GAP_SEC_FAST)보다 0.12초 넘게 짧아 인접한 두 타일을 덮지 못한다', () => {
  const C = CONFIG, dt = 0.0005;
  // 첫 점프 최고 높이 = JUMP_PEAK < HIGH_GRAB_H
  let maxSingle = 0; for (let t = 0; t <= C.JUMP_TIME; t += dt) maxSingle = Math.max(maxSingle, L.airHeight(t, -1, 0));
  assert.ok(Math.abs(maxSingle - C.JUMP_PEAK) < 0.5 && maxSingle < C.HIGH_GRAB_H, `단일 점프 최고 ${maxSingle}`);
  assert.ok(C.HIGH_GRAB_H > C.JUMP_PEAK && C.HIGH_GRAB_H > C.GRAB_H);
  // 2단 점프를 누르는 시점 s(첫 점프 시작 후) 전부에 대해: 높이 이상 머무는 시간, 최고 높이, 착지까지 시간
  let worstAbove = 0, bestPeak = 0, worstPress = 0, longestAir = 0;
  const grid = [];
  for (let s = 0; s <= C.JUMP_TIME; s += 0.005) {
    const h2 = L.airHeight(s, -1, 0), land = L.secondJumpLandTime(h2);
    let above = 0, peak = 0, first = null, last = null;
    for (let t2 = 0; t2 <= land; t2 += dt) {
      const h = L.airHeight(s + t2, t2, h2);
      peak = Math.max(peak, h);
      if (h >= C.HIGH_GRAB_H) { above += dt; if (first === null) first = t2; last = t2; }
    }
    assert.ok(L.airHeight(s + land, land, h2) <= 1e-6, '착지한다');
    if (above > worstAbove) { worstAbove = above; worstPress = s; }
    bestPeak = Math.max(bestPeak, peak); longestAir = Math.max(longestAir, s + land);
    if (first !== null) assert.ok(Math.abs((last - first) - above) < 2 * dt, '높이 이상 구간은 한 덩어리');
    grid.push([s, above]);
  }
  const margin = C.GAP_SEC_FAST - worstAbove;
  console.log(`2단 점프 물리(PACE 1.3): 첫 점프 체공 ${C.JUMP_TIME}s, 최고 ${bestPeak.toFixed(1)}px, 높이 ${C.HIGH_GRAB_H}px 이상 최대 ${worstAbove.toFixed(3)}s(첫 점프 ${worstPress.toFixed(3)}s에 누름), 간격 ${C.GAP_SEC_FAST}s, 여유 ${margin.toFixed(3)}s, 총 체공 최대 ${longestAir.toFixed(3)}s`);
  assert.ok(Math.abs(bestPeak - 2 * C.JUMP_PEAK) < 1, '최고는 누른 높이 + JUMP_PEAK = 2*PEAK');
  assert.ok(worstAbove < C.GAP_SEC_FAST - 0.12, `2단 점프가 높이 이상에 머무는 시간 ${worstAbove} 가 간격 ${C.GAP_SEC_FAST} 보다 0.12초 넘게 짧아야 한다`);
  assert.ok(Math.abs(worstPress - C.JUMP_TIME / 2) < 0.02, '꼭대기에서 누를 때가 가장 오래 머문다');
  // 최고 속도 간격만이 아니라 느린 간격에서도, 그리고 pace 허용 범위 전체에서 같은 비율이 유지된다
  for (const pace of [0.7, 1, 1.3, 1.8]) {
    const c = L.buildConfig({ pace });
    const h2 = c.JUMP_PEAK, above = 2 * Math.sqrt(2 * (2 * c.JUMP_PEAK - c.HIGH_GRAB_H) / L.jumpG(c));
    assert.ok(above / c.GAP_SEC_FAST < 0.7, `pace ${pace}: 비율 ${(above / c.GAP_SEC_FAST).toFixed(3)}`);
    assert.ok(c.GAP_SEC_FAST - above >= 0.119, `pace ${pace}: 여유 ${(c.GAP_SEC_FAST - above).toFixed(3)}`);
    assert.ok(h2 < c.HIGH_GRAB_H);
  }
  // 2단 점프는 공중에서 1회만(상태 모델): 누른 높이 h2 로 갱신되고 같은 초속도
  assert.ok(Math.abs(L.jumpV0() * C.JUMP_TIME / 2 - 2 * C.JUMP_PEAK) < 1e-9, 'v0*T/2 = 2*PEAK');
});

test('318-4. 판정과 가산점: 높은 칸은 HIGH_GRAB_H 이상에서만 공중, 가산점은 속도·콤보 배율 이전에 더해지고 일반 칸 점수는 그대로', () => {
  const C = CONFIG;
  const isAir = (h, high) => (high ? h >= C.HIGH_GRAB_H : h > C.GRAB_H);
  assert.equal(L.judge(true, isAir(C.JUMP_PEAK, true)), 'miss', '한 번 점프로는 높은 정답 칸을 놓친다');
  assert.equal(L.judge(false, isAir(C.JUMP_PEAK, true)), 'pass', '높은 오답 칸은 그 높이에 있지 않으면 통과');
  assert.equal(L.judge(true, isAir(C.HIGH_GRAB_H, true)), 'hit');
  assert.equal(L.judge(false, isAir(C.HIGH_GRAB_H + 20, true)), 'wrong');
  assert.equal(L.judge(true, isAir(C.JUMP_PEAK, false)), 'hit', '일반 칸 판정은 변경 없음');
  assert.equal(L.judge(true, isAir(C.GRAB_H, false)), 'miss');
  // 점수: (기본 + 가산점) × 콤보 배율 × 속도 배율
  for (const combo of [0, 1, 3, 10, 14]) for (const len of [1, 2, 4]) {
    const base = C.BASE * len + (len > 1 ? C.CHUNK_BONUS * len : 0);
    assert.equal(slotPoints(len, combo, C, C.HIGH_BONUS), Math.round((base + C.HIGH_BONUS) * comboMult(combo)));
    assert.equal(slotPoints(len, combo, C), Math.round(base * comboMult(combo)), '가산점 없는 기존 값');
    assert.equal(slotPoints(len, combo), slotPoints(len, combo, C, 0));
    const sm = speedMult(C.SPEED_MAX);
    assert.equal(Math.round(slotPoints(len, combo, C, C.HIGH_BONUS) * sm), Math.round(Math.round((base + C.HIGH_BONUS) * comboMult(combo)) * sm));
    assert.ok(slotPoints(len, combo, C, C.HIGH_BONUS) > slotPoints(len, combo, C) + C.HIGH_BONUS - 1, '배율을 거치므로 +100 이상');
  }
  assert.equal(C.HIGH_BONUS, 100); assert.equal(C.HIGH_SLOT_PROB, 0.2); assert.equal(C.HIGH_MAX, 2); assert.equal(C.DJ_ENABLED, true, '기본 켜짐(작업320)');
});

test('318-5. 주소 옵션: 허용 항목·범위, 범위 밖·숫자 아님은 무시, 기본값과 같으면 적용으로 세지 않는다, pace 는 CONFIG 를 한 번에 바꾼다', () => {
  const po = s => L.parseOptions(s);
  assert.deepEqual(po('?pace=1.1&hp=7&startdelay=2.6&popsec=2&highprob=0.3&heartevery=4&dj=1').values, { pace: 1.1, hp: 7, startdelay: 2.6, popsec: 2, highprob: 0.3, heartevery: 4, dj: 1 });
  assert.deepEqual(po('?pace=1.1&hp=7').applied, ['pace', 'hp']);
  assert.deepEqual(po('').values, {}); assert.deepEqual(po(undefined).applied, []); assert.deepEqual(po('?foo=1&bar=2').values, {}, '모르는 항목 무시');
  for (const bad of ['pace=0.1', 'pace=9', 'pace=abc', 'pace=', 'pace=NaN', 'pace=Infinity', 'pace=1e1', 'hp=0', 'hp=11', 'hp=2.5', 'hp=-1', 'startdelay=7', 'startdelay=0', 'popsec=0.1', 'popsec=6', 'highprob=1.1', 'highprob=-0.1', 'heartevery=0', 'heartevery=11', 'dj=2', 'dj=-1', 'dj=yes', 'hp=5;6', 'hp=0x5']) {
    assert.deepEqual(po('?' + bad).values, {}, '무시: ' + bad);
  }
  assert.deepEqual(po('?pace=9&hp=6').values, { hp: 6 }, '유효한 것만 적용');
  assert.deepEqual(po('?pace=1.3&hp=5&dj=1&highprob=0.2&heartevery=3&startdelay=2.2&popsec=1.6&maxcombo=5').applied, [], '기본값과 같으면 조정으로 세지 않는다(dj 기본은 작업320부터 1)');
  assert.deepEqual(po('?dj=0').applied, ['dj'], 'dj=0 은 기본값과 달라 표시 대상');
  assert.deepEqual(po('?highprob=0').values, { highprob: 0 }, '확률 0 도 유효');
  assert.equal(po('?hp=5&hp=7').values.hp, 5, '첫 값');
  // 기본 CONFIG 는 옵션 없이 이전과 같다
  const d = L.buildConfig();
  for (const k of Object.keys(CONFIG)) assert.deepEqual(d[k], CONFIG[k], k);
  assert.equal(d.HP, 5); assert.equal(d.WORD_START_DELAY, 2.2); assert.equal(d.POP_SEC, 1.6); assert.equal(d.POP_SEC_FINAL, 3.2); assert.equal(d.FINAL_REPEAT_SEC, 1.6); assert.equal(d.HEART_EVERY, 3);
  // 옵션 적용
  const o = L.buildConfig({ hp: 7, startdelay: 2.6, popsec: 2, highprob: 0.3, heartevery: 4, dj: 1 });
  assert.deepEqual([o.HP, o.WORD_START_DELAY, o.POP_SEC, o.POP_SEC_FINAL, o.FINAL_REPEAT_SEC, o.HIGH_SLOT_PROB, o.HEART_EVERY, o.DJ_ENABLED], [7, 2.6, 2, 4, 2, 0.3, 4, true]);
  assert.equal(o.SPEED_MIN, CONFIG.SPEED_MIN, 'pace 가 없으면 속도 그대로');
  // pace: 속도(px/초)는 곱하고 간격·점프 시간은 나눈다(같은 비율)
  const a = L.buildConfig({ pace: 1.3 }), b = L.buildConfig({ pace: 1.04 });
  assert.ok(Math.abs(b.SPEED_MAX / a.SPEED_MAX - 1.04 / 1.3) < 0.01 && Math.abs(b.JUMP_TIME / a.JUMP_TIME - 1.3 / 1.04) < 0.01 && Math.abs(b.GAP_SEC_FAST / a.GAP_SEC_FAST - 1.3 / 1.04) < 0.01);
  assert.equal(b.JUMP_PEAK, a.JUMP_PEAK, '점프 높이는 pace 와 무관');
  // configure 는 제자리에서 바꾼다(다른 함수의 기본 cfg 가 같은 객체를 본다) — 원래대로 되돌린다
  const before = JSON.stringify(CONFIG);
  try { L.configure({ hp: 9, dj: 1 }); assert.equal(CONFIG.HP, 9); assert.equal(CONFIG.DJ_ENABLED, true); assert.equal(L.planHighSlots(7, () => 0).size, 2); }
  finally { L.configure({}); }
  assert.equal(JSON.stringify(CONFIG), before);
});

test('318-2. 시작 대기: WORD_START_DELAY 1.6 → 2.2, 첫 단어 추가 0.4초와 팝업 시간(1.6·3.2)은 그대로', () => {
  assert.equal(CONFIG.WORD_START_DELAY, 2.2); assert.equal(CONFIG.POP_SEC, 1.6); assert.equal(CONFIG.POP_SEC_FINAL, 3.2); assert.equal(CONFIG.FINAL_REPEAT_SEC, 1.6);
  assert.equal(CONFIG.GAP_SEC_FAST, 0.554); assert.equal(CONFIG.JUMP_BUFFER, 0.12);
});

// ───────── 작업319: 주소 옵션 저장(localStorage 'spellrun_opts') ─────────
test('319-1. 옵션 병합: 주소 값이 저장값보다 항목 단위로 우선, 저장값은 허용 항목·범위만, 범위 밖 값은 저장하지 않는다', () => {
  const ro = (s, st) => L.resolveOptions(s, st);
  assert.equal(L.OPTION_KEY, 'spellrun_opts');
  let r = ro('?dj=1&hp=7', null);
  assert.deepEqual(r.values, { dj: 1, hp: 7 }); assert.deepEqual(r.save, { dj: 1, hp: 7 }); assert.equal(r.reset, false);
  // 옵션 없이 열면 저장값 적용(다시 저장하지는 않는다)
  r = ro('', JSON.stringify({ dj: 1, hp: 7 }));
  assert.deepEqual(r.values, { dj: 1, hp: 7 }); assert.equal(r.save, null); assert.deepEqual(r.applied, ['hp'], 'dj=1 은 기본값(켜짐)이라 표시 대상 아님');
  // 주소가 우선하고 그 항목만 덮어쓴다(나머지 저장값은 유지) → 합친 값을 저장
  r = ro('?hp=9&pace=1.1', JSON.stringify({ dj: 1, hp: 7, popsec: 2 }));
  assert.deepEqual(r.values, { dj: 1, hp: 9, popsec: 2, pace: 1.1 }); assert.deepEqual(r.save, r.values);
  // 범위 밖·숫자 아님은 저장하지 않는다(주소의 유효한 항목만 저장). 유효한 주소 옵션이 없으면 저장 동작 없음
  r = ro('?hp=99&pace=abc&dj=1', JSON.stringify({ hp: 6 }));
  assert.deepEqual(r.save, { hp: 6, dj: 1 }); assert.equal(r.values.hp, 6);
  assert.equal(ro('?hp=99&pace=abc', JSON.stringify({ hp: 6 })).save, null);
  assert.equal(ro('?foo=1', null).save, null);
  // 저장값도 같은 규칙을 다시 거친다: 범위 밖·모르는 항목·문자열 숫자·깨진 JSON·배열은 버린다
  assert.deepEqual(ro('', JSON.stringify({ hp: 99, pace: '1.1', dj: 1, evil: 1, popsec: 0.1, highprob: 0 })).values, { dj: 1, highprob: 0 });
  for (const bad of ['{', 'null', '[1]', '"x"', '5', '', undefined, null]) assert.deepEqual(ro('', bad).values, {}, String(bad));
  // reset=1: 저장값 삭제, 기본값으로 시작(다른 주소 옵션도 무시)
  r = ro('?reset=1&dj=1', JSON.stringify({ dj: 1 }));
  assert.deepEqual(r, { values: {}, applied: [], save: null, reset: true });
  assert.equal(ro('?reset=0', JSON.stringify({ dj: 1 })).reset, false);
  // 기본값과 같은 값만 있으면 적용 표시(applied)가 비어 있다
  r = ro('?pace=1.3&hp=5&dj=1', JSON.stringify({ heartevery: 3, startdelay: 2.2 }));
  assert.deepEqual(r.applied, []); assert.ok(Object.keys(r.values).length === 5);
  assert.deepEqual(ro('', JSON.stringify({ dj: 0 })).applied, ['dj'], '저장된 dj=0 은 꺼짐이라 표시 대상');
  assert.deepEqual(ro('', JSON.stringify({ dj: 1 })).applied, [], '저장된 dj=1 은 기본값');
});

// ───────── 작업320: 속도 램프 · maxcombo · dj 기본 켜짐 · 힌트 구성 ─────────
test('320-4. 속도 램프: 콤보 2부터 25%·50%·75%·100%(콤보 5), 단조 증가·상한, 기본 누적 속도와 max, 실패(콤보 0)면 기본 속도로 내려간다', () => {
  const C = CONFIG, span = C.SPEED_MAX - C.SPEED_MIN;
  assert.equal(C.COMBO_RAMP_START, 2); assert.equal(C.COMBO_MAX_SPEED, 5);
  for (const c of [0, 1]) assert.equal(targetSpeed(C.SPEED_MIN, c), C.SPEED_MIN, '콤보 ' + c + ' 은 램프 영향 없음');
  [[2, 0.25], [3, 0.5], [4, 0.75], [5, 1], [6, 1], [12, 1]].forEach(([c, f]) => assert.ok(Math.abs(targetSpeed(C.SPEED_MIN, c) - (C.SPEED_MIN + span * f)) < 1e-9, '콤보 ' + c));
  let prev = -1; for (let c = 0; c <= 12; c++) { const v = targetSpeed(C.SPEED_MIN, c); assert.ok(v >= prev && v <= C.SPEED_MAX); prev = v; }
  assert.ok(targetSpeed(C.SPEED_MIN, 2) > C.SPEED_MIN && targetSpeed(C.SPEED_MIN, 1) === C.SPEED_MIN, '콤보 2 에서 시작');
  // 기본 누적 속도가 램프보다 높으면 그 값 유지(max)
  const high = C.SPEED_MIN + span * 0.9;
  assert.equal(targetSpeed(high, 2), high); assert.equal(targetSpeed(high, 3), high); assert.equal(targetSpeed(high, 5), C.SPEED_MAX);
  // 실패: 콤보 0 → 기본 누적 속도(감속된 값)로 하락, 램프 해제
  let base = C.SPEED_MIN, combo = 0;
  for (let i = 0; i < 6; i++) { combo++; base = speedAfterHit(base, false); }
  const peak = targetSpeed(base, combo); assert.equal(peak, C.SPEED_MAX);
  base = speedAfterFail(base); combo = 0;
  assert.equal(targetSpeed(base, combo), base); assert.ok(base < peak, '실패 감속');
  // 점수 배율은 실제 속도 기준이라 변경 없음
  assert.equal(speedMult(C.SPEED_MAX), 2); assert.equal(speedMult(C.SPEED_MIN), 1);
  // maxcombo 옵션
  for (const m of [3, 4, 8, 12]) {
    const c = L.buildConfig({ maxcombo: m });
    assert.equal(c.COMBO_MAX_SPEED, m);
    assert.equal(targetSpeed(c.SPEED_MIN, 1, c), c.SPEED_MIN);
    assert.equal(targetSpeed(c.SPEED_MIN, m, c), c.SPEED_MAX); assert.ok(targetSpeed(c.SPEED_MIN, m - 1, c) < c.SPEED_MAX);
    assert.ok(Math.abs(targetSpeed(c.SPEED_MIN, 2, c) - (c.SPEED_MIN + (c.SPEED_MAX - c.SPEED_MIN) / (m - 1))) < 1e-9, '콤보 2 = 1/(m-1)');
  }
  const po = q => L.parseOptions(q);
  assert.deepEqual(po('?maxcombo=8').values, { maxcombo: 8 }); assert.deepEqual(po('?maxcombo=8').applied, ['maxcombo']);
  assert.deepEqual(po('?maxcombo=5').applied, [], '기본값과 같으면 표시 없음');
  for (const bad of ['maxcombo=2', 'maxcombo=13', 'maxcombo=4.5', 'maxcombo=x', 'maxcombo=']) assert.deepEqual(po('?' + bad).values, {}, bad);
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ maxcombo: 7 })).values, { maxcombo: 7 }, '저장 방식 동일');
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ maxcombo: 99 })).values, {});
});

test('320-2. 2단 점프 기본 켜짐: dj 없음=켜짐(표시 없음), dj=0=꺼짐(표시), 저장값 dj 처리, 첫 점프 직후의 너무 빠른 입력 기준값', () => {
  assert.equal(CONFIG.DJ_ENABLED, true); assert.equal(L.buildConfig().DJ_ENABLED, true); assert.equal(L.buildConfig({}).DJ_ENABLED, true);
  assert.equal(L.buildConfig({ dj: 0 }).DJ_ENABLED, false); assert.equal(L.buildConfig({ dj: 1 }).DJ_ENABLED, true);
  assert.equal(L.planHighSlots(6, () => 0).size, 2, '옵션 없이도 높은 칸을 계획');
  assert.equal(L.planHighSlots(6, () => 0, L.buildConfig({ dj: 0 })).size, 0);
  assert.deepEqual(L.resolveOptions('', null), { values: {}, applied: [], save: null, reset: false });
  assert.deepEqual(L.resolveOptions('?dj=0', null).applied, ['dj']);
  assert.deepEqual(L.resolveOptions('?dj=1', JSON.stringify({ dj: 0 })).values, { dj: 1 }, '주소가 저장값(꺼짐)을 덮어쓴다');
  assert.equal(L.resolveOptions('', JSON.stringify({ dj: 0 })).values.dj, 0);
  assert.ok(CONFIG.SECOND_JUMP_MIN > 0 && CONFIG.SECOND_JUMP_MIN < 0.2 && CONFIG.SECOND_JUMP_MIN < CONFIG.JUMP_TIME / 2);
  // 기본 상태에서 여러 단어를 계획하면 높은 칸이 나온다(확률 0.2, 첫 칸 제외): 25단어 중 1개 이상
  let withHigh = 0; for (let i = 0; i < 25; i++) if (L.planHighSlots(L.planSlots('beautiful', Math.random, CONFIG).slots.length).size > 0) withHigh++;
  assert.ok(withHigh >= 1, '25단어 중 높은 칸이 있는 단어 ' + withHigh);
});

test('322-2. 키워드 줄이기: "…" 없이 키워드 단위로만, 쉼표가 없으면 자르지 않는다', () => {
  assert.equal(L.keywords('달리다, 뛰다, 운영하다, 관리하다, 흐르다, 출마하다, 작동하다', 20), '달리다, 뛰다, 운영하다, 관리하다');
  assert.equal(L.keywords('가나다라마바사아자차카타파하', 5), '가나다라마바사아자차카타파하');
  assert.equal(L.keywords('가나다, 라마바, 사아자', 8), '가나다, 라마바');
  assert.ok(!L.keywords('가'.repeat(30) + ', ' + '나'.repeat(30), 10).includes('…'));
  assert.deepEqual(L.splitKeywords(' 가，나; 다 , 라 '), ['가', '나', '다', '라']);
});

// ───────── 작업323: 새 단어 시작 연출 ─────────
test('323-1. 연출 타임라인: 일반 1.3+0.5, 첫 단어 +0.4, 보스 +0.4 가 모두 새 단어 대기 시간 이하이고, 옵션이 커도 항상 대기 시간 이하다', () => {
  const C = CONFIG;
  assert.deepEqual([C.INTRO_ENABLED, C.INTRO_HOLD, C.INTRO_SHRINK, C.FIRST_WORD_EXTRA, C.BOSS_INTRO_EXTRA, C.INTRO_SLOT_STEP, C.INTRO_SLOT_MAX], [true, 1.3, 0.5, 0.4, 0.4, 0.04, 0.4]);
  const n = L.introTimeline(C, {}), f = L.introTimeline(C, { first: true }), b = L.introTimeline(C, { boss: true });
  assert.deepEqual([n.hold, n.shrink, n.total, n.delay], [1.3, 0.5, 1.8, 2.2], '일반 단어는 대기 시간을 늘리지 않는다');
  assert.ok(Math.abs(f.hold - 1.7) < 1e-9 && f.total <= f.delay && f.delay === 2.6, '첫 단어: 추가 0.4초 안에서 더 길게');
  assert.ok(Math.abs(b.hold - 1.7) < 1e-9 && b.total <= b.delay + 1e-9 && b.delay === 2.2, '보스: 큰 뜻 유지 +0.4, 그래도 대기 시간 이내');
  assert.ok(b.hold > n.hold && n.hold === L.introTimeline(C, {}).hold, '보스에만 더한다');
  for (const hold of [0.5, 1, 1.3, 2, 3]) for (const delay of [0.5, 1, 2.2, 3, 6]) for (const o of [{}, { first: true }, { boss: true }]) {
    const c = L.buildConfig({ introhold: hold, startdelay: delay }), t = L.introTimeline(c, o);
    assert.ok(t.total <= t.delay + 1e-9 && t.hold >= 0 && t.shrink > 0, JSON.stringify([hold, delay, o, t]));
    assert.ok(t.total <= c.WORD_START_DELAY + (o.first ? c.FIRST_WORD_EXTRA : 0) + 1e-9, '첫 타일 등장(대기 시간) 전에 끝난다');
  }
});

test('323-1. 연출 단계: 경과 시간에 따라 진행률·보이는 칸 수가 단조 증가하고 끝에 최종값(진행률 1, 모든 칸 보임)에 도달하며, 칸은 왼쪽부터 0.4초 안에 모두 나타난다', () => {
  for (const n of [1, 2, 5, 7, 12]) for (const o of [{}, { first: true }, { boss: true }]) {
    const tl = L.introTimeline(CONFIG, o);
    let prev = { p: 0, e: 0, visible: 0 }, firstAll = null, firstVisible = null;
    for (let t = 0; t <= tl.total + 0.2; t += 0.005) {
      const s = L.introState(t, tl, n);
      assert.ok(s.p >= prev.p && s.e >= prev.e && s.visible >= prev.visible, '단조 증가 ' + t);
      assert.ok(s.p >= 0 && s.p <= 1 && s.e >= 0 && s.e <= 1 && s.visible >= 0 && s.visible <= n);
      if (t <= tl.hold) assert.deepEqual([s.phase, s.p, s.visible], ['hold', 0, 0], '유지 구간에는 글자 칸이 보이지 않는다');
      if (firstVisible === null && s.visible > 0) firstVisible = t;
      if (firstAll === null && s.visible === n) firstAll = t;
      prev = s;
    }
    assert.deepEqual([prev.phase, prev.p, prev.e, prev.visible], ['done', 1, 1, n], '끝에 최종값');
    assert.ok(firstVisible >= tl.hold && firstVisible <= tl.hold + 0.01, '축소가 시작될 때 첫 칸');
    assert.ok(firstAll - tl.hold <= CONFIG.INTRO_SLOT_MAX + 0.01 && firstAll <= tl.total, `모든 칸이 0.4초 이내·연출 안에: n=${n} ${firstAll - tl.hold}`);
  }
  // 칸당 약 0.04초
  const tl = L.introTimeline(CONFIG, {});
  assert.equal(L.introState(tl.hold + 0.001, tl, 7).visible, 1); assert.equal(L.introState(tl.hold + 0.045, tl, 7).visible, 2); assert.equal(L.introState(tl.hold + 0.3, tl, 7).visible, 7);
  // 감속: 초반 진행이 빠르고 끝에서 느려진다
  const early = L.introState(tl.hold + tl.shrink * 0.25, tl, 5).e - L.introState(tl.hold, tl, 5).e, late = L.introState(tl.hold + tl.shrink * 0.999, tl, 5).e - L.introState(tl.hold + tl.shrink * 0.749, tl, 5).e;
  assert.ok(early > late * 3, 'easeOut');
});

test('323-4. 연출 옵션: intro(0|1, 기본 1)·introhold(0.5~3.0, 기본 1.3) 범위·저장·표시 규칙', () => {
  const po = q => L.parseOptions(q);
  assert.deepEqual(po('?intro=0&introhold=2').values, { intro: 0, introhold: 2 }); assert.deepEqual(po('?intro=0&introhold=2').applied, ['intro', 'introhold']);
  assert.deepEqual(po('?intro=1&introhold=1.3').applied, [], '기본값과 같으면 표시 없음');
  for (const bad of ['intro=2', 'intro=-1', 'intro=x', 'intro=0.5', 'introhold=0.4', 'introhold=3.1', 'introhold=x', 'introhold=']) assert.deepEqual(po('?' + bad).values, {}, bad);
  assert.deepEqual(po('?introhold=0.5').values, { introhold: 0.5 }); assert.deepEqual(po('?introhold=3').values, { introhold: 3 });
  assert.equal(L.buildConfig({ intro: 0 }).INTRO_ENABLED, false); assert.equal(L.buildConfig({ intro: 1 }).INTRO_ENABLED, true); assert.equal(L.buildConfig().INTRO_ENABLED, true);
  assert.equal(L.buildConfig({ introhold: 2.5 }).INTRO_HOLD, 2.5);
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ intro: 0, introhold: 2 })).values, { intro: 0, introhold: 2 }, '저장 방식 동일');
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ introhold: 9, intro: 5 })).values, {});
  assert.deepEqual(L.resolveOptions('?intro=1', JSON.stringify({ intro: 0 })).values, { intro: 1 }, '주소가 저장값을 덮어쓴다');
  const d = L.buildConfig(); for (const k of Object.keys(CONFIG)) assert.deepEqual(d[k], CONFIG[k], k);
});
