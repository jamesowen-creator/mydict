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

// ───────── 작업321: 펭귄 스프라이트 프레임 선택 ─────────
test('321-2. 달리기 프레임 길이: 기본 0.11초를 속도에 반비례해 줄이고 0.06~0.14초로 제한, 위상은 0→1→2→3 순환하며 속도가 바뀌어도 튀지 않는다', () => {
  const C = CONFIG, P = L.PENGUIN;
  assert.equal(L.runFrameLength(C.SPEED_MIN), 0.11, '최저 속도 기본 길이');
  assert.equal(L.runFrameLength(C.SPEED_MAX), P.RUN_LEN_MIN, '최고 속도는 하한 0.06');
  assert.equal(L.runFrameLength(1), P.RUN_LEN_MAX, '아주 느리면 상한 0.14');
  assert.equal(P.RUN_LEN_MIN, 0.06); assert.equal(P.RUN_LEN_MAX, 0.14); assert.equal(P.RUN_LEN, 0.11);
  let prev = Infinity;
  for (let v = 20; v <= 500; v += 5) { const len = L.runFrameLength(v); assert.ok(len >= 0.06 && len <= 0.14 && len <= prev + 1e-12, '속도가 오를수록 짧아진다 ' + v); prev = len; }
  assert.ok(Math.abs(L.runFrameLength(C.SPEED_MIN * 1.5) - 0.11 / 1.5) < 1e-9, '반비례(상·하한 안에서)');
  // 위상: 한 프레임 길이만큼 흐르면 번호가 하나 올라가고 4개를 돌면 처음으로
  let ph = 0, seen = [];
  for (let i = 0; i < 12; i++) { ph = L.advanceRunPhase(ph, L.runFrameLength(C.SPEED_MIN) + 1e-9, C.SPEED_MIN); seen.push(Math.floor(ph)); }
  assert.deepEqual(seen, [1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0], '1→2→3→4→1 순환(0부터 번호)');
  // 속도가 바뀌어도 한 프레임(1/60초)에 위상이 한 칸 넘게 뛰지 않는다
  for (const v of [C.SPEED_MIN, 250, C.SPEED_MAX]) { const p2 = L.advanceRunPhase(1.3, 1 / 60, v); assert.ok(p2 - 1.3 > 0 && p2 - 1.3 < 0.5, '연속: ' + v); }
  assert.ok(L.advanceRunPhase(3.99, 0.05, C.SPEED_MAX) < 4 && L.advanceRunPhase(3.99, 0.05, C.SPEED_MAX) >= 0);
});

test('321-2. 프레임 선택: 달리기 0~3, 점프 상승 5번째(4)·하강 6번째(5), 대기·보스 배너·게임 오버 연출은 2번째(1), 완주 결과는 5번째(4)', () => {
  const f = o => L.penguinFrame(Object.assign({ state: 'run', cleared: false, air: false, rising: true, runPhase: 0 }, o));
  for (const [ph, idx] of [[0, 0], [0.99, 0], [1, 1], [2.5, 2], [3.999, 3], [4, 0], [5.2, 1]]) assert.equal(f({ runPhase: ph }), idx, 'phase ' + ph);
  assert.equal(f({ air: true, rising: true, runPhase: 2 }), 4, '상승'); assert.equal(f({ air: true, rising: false, runPhase: 2 }), 5, '하강');
  for (const st of ['idle', 'intro', 'ending']) assert.equal(f({ state: st, air: true }), 1, st + ' = 2번 프레임');
  assert.equal(f({ state: 'over', cleared: true }), 4, '완주 결과는 5번'); assert.equal(f({ state: 'over', cleared: false }), 1);
  for (const st of ['run', 'pop']) assert.equal(f({ state: st, runPhase: 2.2 }), 2, st + ' 중에도 달린다');
  // 점프 중 위상이 멈추면(게임이 공중에서 위상을 올리지 않음) 착지 뒤 같은 번호에서 이어진다
  assert.equal(f({ runPhase: 2.2 }), f({ air: false, runPhase: 2.2 }));
  assert.ok(L.PENGUIN.size >= 70 && L.PENGUIN.size <= 110 && L.PENGUIN.SHEET_W === 1728 && L.PENGUIN.SHEET_H === 288 && L.PENGUIN.CELL * L.PENGUIN.FRAMES === 1728);
});

test('321-2. 2단 점프 회전: 두 번째 점프 동안 0→360° 단조 증가, 착지(또는 점프 아님)하면 정확히 0°, 정점 부근에서 반짝임이 가장 세다', () => {
  const C = CONFIG;
  for (const h2 of [0, 60, 118, 118 + 40]) {
    const land = L.secondJumpLandTime(h2); let prev = -1;
    assert.equal(L.spinAngle(0, land), 0, '시작은 0°');
    for (let t = 0; t < land; t += 0.002) { const a = L.spinAngle(t, land); assert.ok(a >= prev && a >= 0 && a < 360, 'monotone ' + t); prev = a; }
    assert.ok(L.spinAngle(land - 1e-6, land) > 359.9, '착지 직전 ≈ 360°');
    assert.equal(L.spinAngle(land, land), 0, '착지하면 정확히 0'); assert.equal(L.spinAngle(land + 0.3, land), 0);
    assert.ok(Math.abs(L.spinAngle(land / 2, land) - 180) < 1e-9, '체공 시간에 비례');
  }
  assert.equal(L.spinAngle(-1, 0.5), 0, '2단 점프 아님'); assert.equal(L.spinAngle(0.1, 0), 0);
  const apex = L.jumpV0() / L.jumpG();
  assert.ok(Math.abs(apex - C.JUMP_TIME / 2) < 1e-9);
  assert.equal(L.sparkleAlpha(apex), 1); assert.equal(L.sparkleAlpha(-1), 0); assert.equal(L.sparkleAlpha(apex + 0.2), 0); assert.equal(L.sparkleAlpha(0.001) < 0.1, true);
  assert.ok(L.sparkleAlpha(apex - 0.06) > 0.4 && L.sparkleAlpha(apex - 0.06) < 0.6);
});

// ───────── 작업325: 발음 출처 문구 · ttsdebug 옵션 ─────────
test('325-2. 발음 출처 문구: 서버(HIT/MISS/헤더 없음)와 내장 음성의 사유(401·403·503·시간 초과·재생 거부·서버 오류)', () => {
  const t = L.ttsSourceLabel;
  assert.equal(t({ engine: 'server', cache: 'HIT' }), '서버 음성(캐시 있음)');
  assert.equal(t({ engine: 'server', cache: 'MISS' }), '서버 음성(새로 생성)');
  assert.equal(t({ engine: 'server', cache: '' }), '서버 음성'); assert.equal(t({ engine: 'server' }), '서버 음성', '헤더가 없으면 서버 음성만');
  assert.equal(t({ engine: 'builtin', status: 401 }), '내장 음성: 로그인 필요(401)');
  assert.equal(t({ engine: 'builtin', status: 403 }), '내장 음성: 권한 없음(403)');
  assert.equal(t({ engine: 'builtin', status: 503 }), '내장 음성: 서버 키 없음(503)');
  assert.equal(t({ engine: 'builtin', reason: 'timeout' }), '내장 음성: 시간 초과');
  assert.equal(t({ engine: 'builtin', reason: 'play' }), '내장 음성: 재생 거부');
  assert.equal(t({ engine: 'builtin', status: 500 }), '내장 음성: 서버 오류'); assert.equal(t({ engine: 'builtin' }), '내장 음성: 서버 오류');
  assert.equal(t({ engine: 'none' }), '재생 안 됨');
  assert.equal(t({ engine: 'builtin', status: 403, reason: 'timeout' }), '내장 음성: 권한 없음(403)', '상태 코드가 우선');
  assert.equal(t(), '내장 음성: 서버 오류');
});

test('325-2. ttsdebug 옵션: 0|1(기본 0), 범위 밖은 무시, 저장 방식 동일, 기본값과 같으면 표시 없음', () => {
  const po = q => L.parseOptions(q);
  assert.deepEqual(po('?ttsdebug=1').values, { ttsdebug: 1 }); assert.deepEqual(po('?ttsdebug=1').applied, ['ttsdebug']);
  assert.deepEqual(po('?ttsdebug=0').applied, [], '기본값과 같으면 표시 없음');
  for (const bad of ['ttsdebug=2', 'ttsdebug=-1', 'ttsdebug=x', 'ttsdebug=', 'ttsdebug=0.5']) assert.deepEqual(po('?' + bad).values, {}, bad);
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ ttsdebug: 1 })).values, { ttsdebug: 1 }); assert.deepEqual(L.resolveOptions('?ttsdebug=0', JSON.stringify({ ttsdebug: 1 })).values, { ttsdebug: 0 });
  const d = L.buildConfig({ ttsdebug: 1 }), e = L.buildConfig(); for (const k of Object.keys(e)) assert.deepEqual(d[k], e[k], 'CONFIG 에는 영향 없음: ' + k);
});

// ───────── 작업326: 장애물(바닥 상자·구덩이) ─────────
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const OBST_KINDS = ['box', 'pit'];

test('326-1. 배치: 후보 자리는 묶음 사이 간격뿐(첫 묶음 앞·마지막 묶음 뒤 제외), 단어당 최대 1개, 보스·높은 칸·하트에서 1묶음 이내는 제외, 확률은 난수로 정한다', () => {
  const C = L.buildConfig({ obsprob: 1 });
  // 기준 구현(규칙을 글자 그대로 옮긴 것): 간격 g 는 묶음 g-1 과 g 사이. 높은 칸 j 와 1묶음 이내 = 간격 양옆 묶음 중 하나가 j 에서 1 이하.
  const expected = (n, highs, heartSlot) => {
    const out = [];
    for (let g = 1; g < n; g++) {
      let ok = true;
      for (const j of highs) if (Math.abs(g - 1 - j) <= 1 || Math.abs(g - j) <= 1) ok = false;
      if (heartSlot !== null) for (let k = heartSlot; k < n; k++) if (Math.abs(g - 1 - k) <= 1 || Math.abs(g - k) <= 1) ok = false;   // 하트는 heartSlot 이후 어느 묶음 앞에도 나올 수 있다
      if (ok) out.push(g);
    }
    return out;
  };
  const rnd = mulberry(326);
  let placed = 0; const kinds = { box: 0, pit: 0 };
  for (let i = 0; i < 4000; i++) {
    const n = 1 + Math.floor(rnd() * 8);
    const highs = new Set(); for (let j = 1; j < n; j++) if (rnd() < 0.25) highs.add(j);
    const heartSlot = rnd() < 0.4 ? (n <= 1 ? 0 : 1 + Math.floor(rnd() * (n - 1))) : null;
    const boss = rnd() < 0.1;
    const r = L.planObstacle(n, highs, heartSlot, boss, mulberry(i + 1), C);
    const cand = expected(n, highs, heartSlot);
    if (boss || n < 2 || !cand.length) { assert.equal(r, null, `n=${n} boss=${boss} 후보 ${cand}`); continue; }
    assert.ok(r, '확률 1 이면 후보가 있을 때 항상 배치'); placed++; kinds[r.kind]++;
    assert.ok(cand.includes(r.slot), `자리 ${r.slot} 는 후보 ${cand} 안`);
    assert.ok(r.slot >= 1 && r.slot <= n - 1, '첫 묶음 앞(0)·마지막 묶음 뒤(n) 제외');
    assert.ok(OBST_KINDS.includes(r.kind));
    assert.equal(typeof r.slot, 'number', '한 단어에 장애물 하나');
  }
  assert.ok(placed > 500 && kinds.box > 100 && kinds.pit > 100, `두 종류가 모두 나온다: ${JSON.stringify(kinds)}`);
  // 구체 사례
  assert.equal(L.planObstacle(4, new Set(), null, false, () => 0, C).slot, 1, '난수 0 → 첫 후보');
  assert.equal(L.planObstacle(4, new Set(), null, false, () => 0.999, C).slot, 3, '난수 끝 → 마지막 후보(마지막 묶음 앞 간격 n-1)');
  assert.equal(L.planObstacle(1, new Set(), null, false, () => 0, C), null, '칸이 하나면 간격이 없다');
  assert.equal(L.planObstacle(5, new Set(), null, true, () => 0, C), null, '보스 단어는 없음');
  assert.equal(L.planObstacle(5, new Set([2]), null, false, () => 0, C), null, '높은 칸이 가운데(2)에 있으면 간격 1~4 모두 1묶음 이내');
  assert.equal(L.planObstacle(7, new Set([1]), null, false, () => 0, C).slot, 4, '높은 칸 1 → 간격 0~3 제외, 4~6 후보');
  assert.equal(L.planObstacle(4, new Set(), 1, false, () => 0, C), null, '하트가 1번 칸부터 나올 수 있으면 간격 모두 1묶음 이내');
  assert.equal(L.planObstacle(6, new Set(), 4, false, () => 0.999, C).slot, 2, '하트 4번 칸 이후 → 간격 3 이상 제외, 1·2 만 후보');
  // 확률: 기본 0.5, 0, 1 / 꺼짐
  const hit = (cfg, N) => { let c = 0; const r = mulberry(7); for (let i = 0; i < N; i++) if (L.planObstacle(5, new Set(), null, false, r, cfg)) c++; return c / N; };
  const d = hit(L.buildConfig(), 6000); assert.ok(d > 0.46 && d < 0.54, '기본 확률 약 0.5: ' + d);
  assert.equal(hit(L.buildConfig({ obsprob: 0 }), 500), 0); assert.equal(hit(L.buildConfig({ obsprob: 1 }), 500), 1);
  assert.equal(L.buildConfig().OBSTACLE_PROB, 0.5); assert.equal(L.buildConfig().OBST_ENABLED, true);
  let calls = 0; const counter = () => { calls++; return 0; };
  assert.equal(L.planObstacle(5, new Set(), null, false, counter, L.buildConfig({ obs: 0 })), null); assert.equal(calls, 0, 'obs=0 이면 난수를 쓰지 않는다(이전과 같은 난수 흐름)');
  L.planObstacle(5, new Set(), null, true, counter, C); assert.equal(calls, 0, '보스도 난수를 쓰지 않는다');
  // 같은 난수열이면 같은 배치
  assert.deepEqual(L.planObstacle(6, new Set([4]), null, false, mulberry(5), C), L.planObstacle(6, new Set([4]), null, false, mulberry(5), C));
});

test('326-0. 안전 간격 수식: 속도 기본(SPEED_MIN)~SPEED_MAX 전 구간에서 여유 창이 OBST_MIN_WINDOW 이상이고, 거리는 SPEED_MAX 기준 px 이다', () => {
  const C = CONFIG;
  assert.equal(C.OBST_MIN_WINDOW, 0.15);
  const grab = L.airWindow(C, C.GRAB_H);
  assert.ok(Math.abs(grab.len - 0.4167) < 0.001 && Math.abs(grab.a - 0.02264) < 0.0001, '글자 획득(높이 22 초과) 구간 ≈ 0.0226~0.4394초');
  for (const kind of OBST_KINDS) {
    const lay = L.obstacleLayout(C, kind), sp = L.obstacleSpec(C, kind), win = L.airWindow(C, sp.clearH);
    assert.equal(lay.w, sp.w);
    // 식 확인: 최악 속도 px 로 계획한 값이 공식과 같다
    const v = C.SPEED_MAX, MIN = C.OBST_MIN_WINDOW + 0.01, M = C.OBST_NEXT_MARGIN, F = C.OBST_FOOT, PD = C.PACK_DELAY, J = C.JUMP_TIME;
    assert.ok(lay.D1 >= v * (MIN + grab.a + J + M + grab.b - PD) - 1e-9, kind + ': D1 ≥ SPEED_MAX × (여유 + 체공 + 준비 − 팩 대기)');
    assert.ok(lay.Do >= F + v * (MIN + win.a + grab.b - PD) - 1e-9, kind + ': 앞 거리');
    assert.ok(lay.post >= F + v * (MIN + grab.a + J + M - win.b) - 1e-9, kind + ': 뒤 거리');
    assert.ok(Math.abs(lay.Do + lay.w + lay.post - lay.D1) < 1e-9);
    // 모든 속도에서 여유 창
    let minW = Infinity;
    for (let s = C.SPEED_MIN; s <= C.SPEED_MAX; s += 0.5) minW = Math.min(minW, L.obstacleWindow(C, lay, s).width);
    assert.ok(minW >= C.OBST_MIN_WINDOW, `${kind}: 속도 ${C.SPEED_MIN}~${C.SPEED_MAX} 의 최소 여유 창 ${minW.toFixed(4)} ≥ ${C.OBST_MIN_WINDOW}`);
    // 장애물 자체의 통과 가능 시간: 최저 속도에서 (폭+2×발폭)/속도 가 높이 창보다 OBST_MIN_WINDOW 이상 짧다
    assert.ok(win.len - (sp.w + 2 * F) / C.SPEED_MIN >= C.OBST_MIN_WINDOW, kind + ' 통과 창');
  }
  // 속도 옵션(pace)이 달라도 같은 보장(폭이 줄어든다)
  for (const pace of [0.7, 0.9, 1.0, 1.3, 1.5, 1.8]) {
    const c = L.buildConfig({ pace: pace });
    for (const kind of OBST_KINDS) {
      const lay = L.obstacleLayout(c, kind);
      for (let s = c.SPEED_MIN; s <= c.SPEED_MAX; s += 1) assert.ok(L.obstacleWindow(c, lay, s).width >= c.OBST_MIN_WINDOW, `pace ${pace} ${kind} v=${s}`);
    }
  }
  assert.equal(L.buildConfig({ pace: 1.3 }).OBST_W, 28, '기본 pace 에서는 폭이 줄지 않는다'); assert.ok(L.buildConfig({ pace: 1.8 }).OBST_W < 28);
  // 늘어난 시간(보고용): 기본 리드보다 D1 이 큰 만큼
  const slow = L.obstacleAddedSec(C, 'box', C.SPEED_MIN), fast = L.obstacleAddedSec(C, 'box', C.SPEED_MAX);
  assert.ok(slow > fast && fast > 0 && slow < 1.0, `기본 속도 +${slow.toFixed(3)}초, 최고 속도 +${fast.toFixed(3)}초`);
  let sum = 0, n = 0; for (let s = C.SPEED_MIN; s <= C.SPEED_MAX; s++) { sum += L.obstacleAddedSec(C, 'pit', s); n++; } assert.ok(sum / n < 0.5, '평균 ' + (sum / n).toFixed(3));
});

test('326-2. 통과 판정: 겹치는 동안 공중 높이(airHeight)가 계속 OBST_H 를 넘어야 통과, 구덩이는 떠 있기만 하면 통과', () => {
  const C = CONFIG, RX = 72, F = C.OBST_FOOT;
  assert.equal(L.obstacleOverlaps(RX + F - 0.1, 28, RX), true); assert.equal(L.obstacleOverlaps(RX + F, 28, RX), false, '앞 끝이 발 앞에 닿기 전');
  assert.equal(L.obstacleOverlaps(RX - F - 28 + 0.1, 28, RX), true); assert.equal(L.obstacleOverlaps(RX - F - 28, 28, RX), false, '뒤 끝이 발 뒤를 지난 뒤');
  assert.equal(L.obstacleHit('box', C.OBST_H, C), true, '높이가 정확히 OBST_H 면 걸림'); assert.equal(L.obstacleHit('box', C.OBST_H + 0.01, C), false);
  assert.equal(L.obstacleHit('box', 0, C), true); assert.equal(L.obstacleHit('pit', 0, C), true, '땅에 닿아 있으면 빠짐');
  assert.equal(L.obstacleHit('pit', C.OBST_H, C), false); assert.equal(L.obstacleHit('pit', C.PIT_CLEAR_H + 0.01, C), false);
  // 일정 속도로 지나가며 1ms 단위로 판정: 점프 시작 s 를 훑어 통과하는 구간이 airWindow 이론값과 같다
  for (const kind of OBST_KINDS) {
    const sp = L.obstacleSpec(C, kind), win = L.airWindow(C, sp.clearH);
    for (const v of [C.SPEED_MIN, C.SPEED_MAX]) {
      const A = 1.0, dur = (sp.w + 2 * F) / v, ok = [];
      for (let s = A - 0.6; s <= A + 0.6; s += 0.001) {
        let hit = false;
        for (let t = A; t <= A + dur; t += 0.001) if (L.obstacleHit(kind, L.airHeight(t - s, -1, 0, C), C)) { hit = true; break; }
        if (!hit) ok.push(s);
      }
      assert.ok(ok.length > 0, kind + ' 통과 가능');
      const width = ok[ok.length - 1] - ok[0], theory = win.len - dur;
      assert.ok(Math.abs(width - theory) < 0.004, `${kind} v=${v}: 통과 구간 ${width.toFixed(4)} ≈ 이론 ${theory.toFixed(4)}`);
      assert.ok(width >= C.OBST_MIN_WINDOW, `${kind} v=${v} 통과 구간 ≥ 0.15`);
    }
  }
});

test('326-2. 맞았을 때 효과: 체력 -1, 속도 즉시 0.6배·기본 속도 -SPEED_DROP_FAIL, 콤보 불변, 이후 기존 가속도로 목표 속도까지 회복', () => {
  const C = CONFIG;
  assert.equal(C.OBST_SLOW_FACTOR, 0.6); assert.equal(C.OBST_INVULN_SEC, 0.8);
  const s0 = { hp: 5, speed: 300, speedBase: 250, combo: 4 };
  const r = L.afterObstacleHit(s0, C);
  assert.equal(r.hp, 4); assert.ok(Math.abs(r.speed - 180) < 1e-9, '300 × 0.6'); assert.equal(r.speedBase, 250 - C.SPEED_DROP_FAIL);
  assert.equal(r.combo, 4, '콤보 불변'); assert.equal(r.speedTarget, L.targetSpeed(250 - C.SPEED_DROP_FAIL, 4, C), '목표 속도는 새 기본 속도와 콤보로 다시 계산');
  assert.deepEqual(s0, { hp: 5, speed: 300, speedBase: 250, combo: 4 }, '입력을 바꾸지 않는다');
  assert.equal(L.afterObstacleHit({ hp: 1, speed: 200, speedBase: C.SPEED_MIN, combo: 0 }, C).speedBase, C.SPEED_MIN, '기본 속도는 SPEED_MIN 아래로 내려가지 않는다');
  // 회복: 가속도(SPEED_ACCEL)로 목표 속도에 닿는다. 단조 증가이고 한 걸음에 SPEED_ACCEL×dt 를 넘지 않는다
  let v = r.speed; const dt = 1 / 60; let t = 0, prev = v;
  while (v < r.speedTarget - 1e-9 && t < 5) { const dv = r.speedTarget - v, m = C.SPEED_ACCEL * dt; v += Math.abs(dv) <= m ? dv : Math.sign(dv) * m; assert.ok(v >= prev && v - prev <= m + 1e-9); prev = v; t += dt; }
  assert.ok(v >= r.speedTarget - 1e-9 && t < 2, '목표 속도로 회복 ' + t.toFixed(2) + '초');
});

test('326-3. 옵션 obs(0|1, 기본 1)·obsprob(0~1, 기본 0.5): 범위 밖은 무시, 저장 방식 동일, 기본값과 같으면 "조정값 사용 중" 없음', () => {
  const po = q => L.parseOptions(q);
  assert.deepEqual(po('?obs=0').values, { obs: 0 }); assert.deepEqual(po('?obs=0').applied, ['obs']);
  assert.deepEqual(po('?obs=1').applied, [], '기본값과 같으면 표시 없음'); assert.deepEqual(po('?obsprob=0.5').applied, []);
  assert.deepEqual(po('?obsprob=0.8&obs=1').values, { obs: 1, obsprob: 0.8 }); assert.deepEqual(po('?obsprob=0.8').applied, ['obsprob']);
  assert.deepEqual(po('?obsprob=0').values, { obsprob: 0 }); assert.deepEqual(po('?obsprob=1').values, { obsprob: 1 });
  for (const bad of ['obs=2', 'obs=-1', 'obs=0.5', 'obs=x', 'obs=', 'obsprob=1.1', 'obsprob=-0.1', 'obsprob=x', 'obsprob=']) assert.deepEqual(po('?' + bad).values, {}, bad);
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ obs: 0, obsprob: 0.2 })).values, { obs: 0, obsprob: 0.2 }, '저장값 사용');
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ obs: 3, obsprob: 7 })).values, {}, '저장값도 범위 규칙');
  assert.deepEqual(L.resolveOptions('?obs=1', JSON.stringify({ obs: 0 })).values, { obs: 1 }, '주소가 우선'); assert.deepEqual(L.resolveOptions('?obs=1', JSON.stringify({ obs: 0 })).applied, []);
  assert.deepEqual(L.resolveOptions('?obs=0').save, { obs: 0 }, '주소에 유효한 옵션이 있으면 저장');
  const d = L.buildConfig({ obs: 0 }), e = L.buildConfig(); assert.equal(d.OBST_ENABLED, false);
  for (const k of Object.keys(e)) if (k !== 'OBST_ENABLED') assert.deepEqual(d[k], e[k], 'obs=0 은 다른 값에 영향 없음: ' + k);
  const p = L.buildConfig({ obsprob: 0.2 }); assert.equal(p.OBSTACLE_PROB, 0.2);
  for (const k of Object.keys(e)) if (k !== 'OBSTACLE_PROB') assert.deepEqual(p[k], e[k], k);
});

// 핵심: "틀린 타일을 먹지 않고 장애물을 통과하는 점프 타이밍이 항상 존재한다". 1ms 단위로 점프 시작 시각을 훑어, 실제 점프 곡선(airHeight)으로 판정한다.
test('326-4. [핵심] 난수 조건 600개: 어떤 장애물·속도·앞뒤 점프 위상·정답 위치에서도 틀린 타일을 먹지 않고 넘는 점프 타이밍이 있고, 그 여유 창이 0.15초 이상이다', () => {
  const rnd = mulberry(20260326);
  let tested = 0, minWidth = Infinity, worst = null; const byKind = { box: 0, pit: 0 }, bySpeed = { min: 0, max: 0 };
  for (let i = 0; i < 600; i++) {
    const pace = [1.3, 1.3, 1.3, 0.7, 1.0, 1.8, 0.7 + rnd() * 1.1][Math.floor(rnd() * 7)];
    const C = L.buildConfig({ pace: pace }), kind = OBST_KINDS[Math.floor(rnd() * 2)];
    const speedName = rnd() < 0.5 ? 'min' : 'max', v = speedName === 'min' ? C.SPEED_MIN : C.SPEED_MAX;
    const lay = L.obstacleLayout(C, kind), F = C.OBST_FOOT, J = C.JUMP_TIME;
    const grab = L.airWindow(C, C.GRAB_H);
    // 앞 묶음의 정답 글자를 먹은 점프 위상(점프 시작 후 τ): 글자 획득이 성립하는 범위 안에서 무작위(양 끝 포함)
    const tau = [grab.a, grab.b, grab.a + rnd() * (grab.b - grab.a)][Math.floor(rnd() * 3)];
    const T0 = -C.PACK_DELAY, landPrev = T0 + (J - tau);
    // 다음 묶음: 세 후보, 정답 위치 무작위. 후보 간 시간 간격 = 간격 px / 속도 (같은 속도로 지난다고 본다)
    const gapT = L.gapSec(v, C), P1 = lay.D1 / v, tiles = [0, 1, 2].map(k => P1 + k * gapT), correct = Math.floor(rnd() * 3);
    const A = (lay.Do - F) / v, B = (lay.Do + lay.w + F) / v;   // 겹치는 시간 구간
    const hAt = (s, t) => L.airHeight(t - s, -1, 0, C);
    const wrongOK = s => tiles.every((tt, k) => k === correct || hAt(s, tt) <= C.GRAB_H);   // 틀린 타일은 공중이면 먹는다
    const clears = s => { for (let t = A; t <= B + 1e-9; t += 0.001) if (L.obstacleHit(kind, hAt(s, t), C)) return false; return true; };
    // 이어서 정답 글자를 먹는 점프가 가능한지(착지 뒤 시작 → 정답 때 공중, 틀린 타일은 땅)
    const followUp = s => { for (let sg = s + J; sg <= tiles[correct]; sg += 0.002) if (hAt(sg, tiles[correct]) > C.GRAB_H && tiles.every((tt, k) => k === correct || hAt(sg, tt) <= C.GRAB_H)) return true; return false; };
    let run = 0, best = 0;
    for (let s = landPrev; s <= A + 0.2; s += 0.001) {   // 점프는 앞 점프 착지 뒤에만 시작할 수 있다
      if (clears(s) && wrongOK(s) && followUp(s)) { run += 0.001; best = Math.max(best, run); } else run = 0;
    }
    tested++; byKind[kind]++; bySpeed[speedName]++;
    if (best < minWidth) { minWidth = best; worst = { pace, kind, speedName, tau }; }
    assert.ok(best >= C.OBST_MIN_WINDOW - 0.003, `조건 ${i}: pace ${pace.toFixed(2)} ${kind} 속도 ${speedName} 점프 위상 ${tau.toFixed(3)} → 안전 점프 구간 ${best.toFixed(3)}초`);
    assert.ok(best >= L.obstacleWindow(C, lay, v).width - 0.012, `조건 ${i}: 해석식(${L.obstacleWindow(C, lay, v).width.toFixed(3)})보다 좁지 않다`);
  }
  assert.equal(tested, 600); assert.ok(byKind.box > 200 && byKind.pit > 200 && bySpeed.min > 200 && bySpeed.max > 200, JSON.stringify([byKind, bySpeed]));
  assert.ok(minWidth >= 0.147, '최소 여유 창 ' + minWidth.toFixed(4) + ' ' + JSON.stringify(worst));
});

test('326-4. 음성 대조: 간격을 늘리지 않고 기본 리드 거리에 장애물을 끼우면 여유 창이 0.15초 미만이 된다(시험이 실제로 잡아낸다)', () => {
  const C = CONFIG, v = C.SPEED_MAX;
  const lay = L.obstacleLayout(C, 'box');
  const lead = v * L.leadSec(v, C);
  const short = Object.assign({}, lay, { D1: lead, Do: 100, post: lead - 100 - lay.w });
  assert.ok(L.obstacleWindow(C, short, v).width < C.OBST_MIN_WINDOW, '늘리지 않으면 ' + L.obstacleWindow(C, short, v).width.toFixed(3));
  assert.ok(L.obstacleWindow(C, lay, v).width >= C.OBST_MIN_WINDOW);
});

// ───────── 작업327: 장애물 그림·예고 표시 ─────────
test('327-2. 판정 수치 불변: OBST_W 28·OBST_H 28·PIT_W 36·PIT_CLEAR_H 2·발 폭 6, 326의 간격(앞·뒤·D1)과 여유 창 그대로', () => {
  const C = CONFIG;
  assert.equal(C.OBST_W, 28); assert.equal(C.OBST_H, 28); assert.equal(C.PIT_W, 36); assert.equal(C.PIT_CLEAR_H, 2); assert.equal(C.OBST_FOOT, 6);
  assert.equal(C.OBST_SLOW_FACTOR, 0.6); assert.equal(C.OBST_INVULN_SEC, 0.8); assert.equal(C.OBST_MIN_WINDOW, 0.15); assert.equal(C.OBST_NEXT_MARGIN, 0.1);
  const box = L.obstacleLayout(C, 'box'), pit = L.obstacleLayout(C, 'pit');
  assert.ok(Math.abs(box.D1 - 346.9) < 0.1 && Math.abs(box.Do - 175.0) < 0.1 && Math.abs(box.post - 143.8) < 0.1, JSON.stringify(box));
  assert.ok(Math.abs(pit.D1 - 346.9) < 0.1 && Math.abs(pit.Do - 171.0) < 0.1 && Math.abs(pit.post - 139.8) < 0.1, JSON.stringify(pit));
  for (const lay of [box, pit]) for (let s = C.SPEED_MIN; s <= C.SPEED_MAX; s++) assert.ok(L.obstacleWindow(C, lay, s).width >= 0.16 - 1e-9);
  assert.equal(L.buildConfig({ pace: 1.8 }).OBST_W, 18, 'pace 축소 규칙 그대로');
});

test('327-2. 그림 종류 선택: 4종이 모두 나올 수 있고, 같은 입력은 같은 결과이며, 난수를 쓰지 않는다(장애물 배치 난수 소비 불변)', () => {
  const N = L.OBSTACLE_ART.OBJECTS.length; assert.equal(N, 4);
  assert.deepEqual(L.OBSTACLE_ART.OBJECTS.map(o => o.name), ['rocks', 'log', 'cone', 'bush']);
  const seen = new Set(), counts = [0, 0, 0, 0];
  for (const w of ['apple', 'book', 'environment', 'water', 'happy', 'window', 'music', 'friend']) for (let slot = 1; slot < 6; slot++) for (let seq = 0; seq < 10; seq++) {
    const a = L.obstacleArtIndex(w, slot, seq); assert.ok(Number.isInteger(a) && a >= 0 && a < N); assert.equal(L.obstacleArtIndex(w, slot, seq), a, '같은 입력 → 같은 결과'); seen.add(a); counts[a]++;
  }
  assert.equal(seen.size, 4, '4종 모두'); assert.ok(counts.every(c => c > 20), '고르게 나온다: ' + counts);
  const orig = Math.random; Math.random = () => { throw new Error('난수 사용 금지'); };
  try { L.obstacleArtIndex('apple', 2, 3); } finally { Math.random = orig; }
  // 배치 난수 소비 순서: 확률 → 자리 → 종류(상자/구덩이), 정확히 3번. 327 에서 달라지지 않았다
  const C = L.buildConfig({ obsprob: 1 }), seq = [0.1, 0.0, 0.9]; let i = 0, calls = 0;
  const rec = () => { calls++; return seq[i++]; };
  const r = L.planObstacle(5, new Set(), null, false, rec, C);
  assert.equal(calls, 3); assert.deepEqual(r, { slot: 1, kind: 'pit' });
  calls = 0; i = 0; assert.equal(L.planObstacle(5, new Set(), null, false, () => { calls++; return 0.99; }, L.buildConfig()), null); assert.equal(calls, 1, '확률에서 탈락하면 1번만');
});

test('327-2. 그림 크기 규칙: 물체의 긴 변 = OBST_W × 1.4(pace 로 줄면 같은 비율), 바닥은 땅 선, 가로 중앙은 판정 중심', () => {
  const C = CONFIG, A = L.OBSTACLE_ART;
  assert.equal(C.ART_LONG_K, 1.4);
  for (let idx = 0; idx < 4; idx++) {
    const o = A.OBJECTS[idx], r = L.obstacleArtRect(C, idx, 100, 520);
    assert.ok(Math.abs(Math.max(o.w, o.h) * r.k - 28 * 1.4) < 1e-9, o.name + ' 긴 변 39.2px'); assert.ok(Math.abs(r.side - 39.2) < 1e-9);
    assert.ok(Math.abs(r.dy + A.FOOT_Y * r.k - 520) < 1e-9, '물체 바닥이 땅 선'); assert.ok(Math.abs(r.dx + 128 * r.k - 100) < 1e-9, '가로 중앙'); assert.equal(r.sx, idx * 256);
    assert.ok(r.dw === 256 * r.k && r.dh === 256 * r.k);
    for (const pace of [0.7, 1.3, 1.8]) {
      const c = L.buildConfig({ pace: pace }), rr = L.obstacleArtRect(c, idx, 100, 520);
      assert.ok(Math.abs(Math.max(o.w, o.h) * rr.k - c.OBST_W * 1.4) < 1e-9, `pace ${pace} ${o.name}`);
      assert.ok(Math.abs(rr.k / r.k - c.OBST_W / 28) < 1e-9, 'OBST_W 에 비례');
    }
  }
  // 크기감: 돌무더기·통나무·덤불은 높이가 판정 높이(28) 안팎, 콘은 더 높다
  const hOf = idx => L.obstacleArtRect(C, idx, 0, 0).k * A.OBJECTS[idx].h;
  assert.ok(hOf(0) > 22 && hOf(0) < 32 && hOf(1) > 22 && hOf(1) < 32 && hOf(3) > 22 && hOf(3) < 32, [hOf(0), hOf(1), hOf(3)].join());
  assert.ok(hOf(2) > C.OBST_H, '콘은 판정보다 높다: ' + hOf(2));
  assert.equal(C.PIT_ART_K, 1.25);
});

test('327-4. 예고 표시 구간: 거리 ≥ SPEED_MAX × WARN_SEC(0.6초), 기본·pace 달라도', () => {
  assert.equal(CONFIG.WARN_SEC, 0.6);
  for (const pace of [0.7, 1.0, 1.3, 1.8]) {
    const c = L.buildConfig({ pace: pace });
    for (const kind of ['box', 'pit']) assert.ok(L.obstacleWarnDistance(c, kind) >= c.SPEED_MAX * c.WARN_SEC, `pace ${pace} ${kind}: ${L.obstacleWarnDistance(c, kind).toFixed(1)} ≥ ${(c.SPEED_MAX * c.WARN_SEC).toFixed(1)}`);
  }
  assert.ok(L.obstacleWarnDistance(CONFIG, 'box') / CONFIG.SPEED_MAX >= 0.6, '최고 속도에서 ' + (L.obstacleWarnDistance(CONFIG, 'box') / CONFIG.SPEED_MAX).toFixed(3) + '초');
});

// ───────── 작업328: 하트 규칙 변경 · 가속 아이템 ─────────
test('328-1. 하트: 체력이 가득이 아니면 +1(점수 0), 가득이면 체력 그대로 + 점수 보너스(기본 100, 옵션 hpfullbonus)', () => {
  const C = CONFIG;
  assert.equal(C.HP_FULL_BONUS, 100);
  assert.deepEqual(L.heartEffect(3, C), { hp: 4, score: 0, full: false });
  assert.deepEqual(L.heartEffect(C.HP - 1, C), { hp: C.HP, score: 0, full: false }, '체력 4 → 5 는 체력 +1');
  assert.deepEqual(L.heartEffect(C.HP, C), { hp: C.HP, score: 100, full: true }, '가득이면 체력 불변 + 100점');
  assert.equal(L.heartEffect(1, C).hp, 2);
  const c250 = L.buildConfig({ hpfullbonus: 250 }); assert.equal(L.heartEffect(c250.HP, c250).score, 250); assert.equal(L.heartEffect(2, c250).score, 0);
  const c0 = L.buildConfig({ hpfullbonus: 0 }); assert.equal(L.heartEffect(c0.HP, c0).score, 0);
  const c7 = L.buildConfig({ hp: 7 }); assert.deepEqual(L.heartEffect(7, c7), { hp: 7, score: 100, full: true }); assert.equal(L.heartEffect(6, c7).hp, 7);
  assert.equal(L.buildConfig().HEART_EVERY, 3, '나오는 빈도 규칙(heartevery)은 그대로');
});

test('328-0/2. 난수 호출 순서 불변: planHearts 는 그룹마다 1번, pickHeartSlot 은 칸이 둘 이상이면 1번, planObstacle 은 확률→자리→종류 순(327)', () => {
  let calls = 0; const rec = () => { calls++; return 0.5; };
  L.planHearts(9, rec, CONFIG); assert.equal(calls, 3, '9단어 / 3 = 3그룹');
  calls = 0; L.pickHeartSlot(5, rec); assert.equal(calls, 1); calls = 0; L.pickHeartSlot(1, rec); assert.equal(calls, 0);
  calls = 0; L.planObstacle(5, new Set(), null, false, rec, L.buildConfig({ obsprob: 1 })); assert.equal(calls, 3);
  // 가속 아이템 계획은 난수를 쓰지 않는다
  const orig = Math.random; Math.random = () => { throw new Error('난수 사용 금지'); };
  try { for (let i = 0; i < 50; i++) L.planSpeedItem({ roundSeq: 1, regularIdx: i, boss: false, review: false, hasHeart: false, hasObst: false, nSlots: 5 }, CONFIG); } finally { Math.random = orig; }
  assert.equal(CONFIG.OBST_W, 28); assert.equal(CONFIG.OBST_H, 28); assert.equal(CONFIG.PIT_W, 36);
});

test('328-2. 가속 아이템 계획: 난수 없음·같은 입력 같은 결과, 일반 단어 약 4개에 1번, 보스·복습·하트·장애물 단어에는 없고, 묶음은 첫 묶음 이후', () => {
  const C = CONFIG, base = { boss: false, review: false, hasHeart: false, hasObst: false, nSlots: 5 };
  assert.equal(C.SPEED_ITEM_ENABLED, true); assert.equal(C.SPEED_EVERY, 4); assert.equal(C.BOOST_SEC, 5);
  let n = 0, hit = 0; const slots = new Set();
  for (let round = 1; round <= 40; round++) for (let i = 0; i < 8; i++) {   // 판당 일반 단어 8개(그룹 4 → 완전한 그룹 2개)
    const o = Object.assign({ roundSeq: round, regularIdx: i }, base), r = L.planSpeedItem(o, C);
    assert.deepEqual(L.planSpeedItem(o, C), r, '같은 입력 → 같은 결과'); n++;
    if (r !== null) { hit++; slots.add(r); assert.ok(r >= 1 && r <= 4, '첫 묶음 이후: ' + r); }
  }
  assert.equal(hit, 80, '완전한 그룹마다 정확히 1개: ' + hit + '/' + n); assert.ok(slots.size >= 3, '묶음 자리가 다양하다: ' + [...slots]);
  for (let round = 1; round <= 40; round++) { let k = 0; for (let i = 0; i < 4; i++) if (L.planSpeedItem(Object.assign({ roundSeq: round, regularIdx: i }, base), C) !== null) k++; assert.equal(k, 1, '그룹 안에 정확히 1개'); }
  // 제외 조건
  const every1 = L.buildConfig({ speedevery: 1 });
  const any = Object.assign({ roundSeq: 3, regularIdx: 0 }, base); assert.notEqual(L.planSpeedItem(any, every1), null, 'speedevery=1 이면 매 단어');
  for (const ex of [{ boss: true }, { review: true }, { hasHeart: true }, { hasObst: true }, { nSlots: 1 }]) assert.equal(L.planSpeedItem(Object.assign({}, any, ex), every1), null, JSON.stringify(ex));
  assert.equal(L.planSpeedItem(any, L.buildConfig({ speedevery: 1, speeditem: 0 })), null, 'speeditem=0 이면 없음');
  // 판 순번이 달라지면 자리가 달라질 수 있다(고정 패턴이 아님)
  const pat = r => [0, 1, 2, 3].map(i => L.planSpeedItem(Object.assign({ roundSeq: r, regularIdx: i }, base), C) !== null ? 1 : 0).join('');
  assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(pat)).size >= 3, '판마다 그룹 안 위치가 다르다');
});

test('328-2. 가속 속도: 목표 속도는 SPEED_MAX 를 넘지 않고, 어떤 입력에서도 실제 속도가 SPEED_MAX 이하이며, 끝나면 원래 목표로 돌아온다', () => {
  const C = CONFIG;
  assert.equal(C.BOOST_FACTOR, 1.3); assert.equal(C.BOOST_SCORE_MULT, 1.5);
  assert.equal(L.boostTarget(200, false, C), 200, '가속이 아니면 그대로');
  assert.ok(Math.abs(L.boostTarget(200, true, C) - 260) < 1e-9);
  assert.equal(L.boostTarget(C.SPEED_MAX, true, C), C.SPEED_MAX, '이미 최고 속도면 그대로');
  for (let t = 0; t <= C.SPEED_MAX * 3; t += 3.7) assert.ok(L.boostTarget(t, true, C) <= C.SPEED_MAX || t > C.SPEED_MAX, 't=' + t);
  for (let t = C.SPEED_MIN; t <= C.SPEED_MAX; t += 1) assert.ok(L.boostTarget(t, true, C) <= C.SPEED_MAX && L.boostTarget(t, true, C) >= t, 't=' + t);
  // 시뮬레이션: 목표 속도가 변하는 모든 경우(가속 시작·종료·콤보 램프·실패)에서 속도가 SPEED_MAX 를 넘지 않는다
  const rnd = mulberry(328); let worst = 0;
  for (let run = 0; run < 300; run++) {
    let speed = C.SPEED_MIN + rnd() * (C.SPEED_MAX - C.SPEED_MIN), base = C.SPEED_MIN + rnd() * (C.SPEED_MAX - C.SPEED_MIN), combo = Math.floor(rnd() * 8), boost = 0;
    for (let step = 0; step < 60 * 20; step++) {
      if (rnd() < 0.01) { base = L.speedAfterHit(base, rnd() < 0.3, C); combo++; }
      if (rnd() < 0.004) { base = L.speedAfterFail(base, C); combo = 0; }
      if (rnd() < 0.008) boost = C.BOOST_SEC;
      if (rnd() < 0.003) { speed = L.afterObstacleHit({ hp: 5, speed: speed, speedBase: base, combo: combo }, C).speed; base = L.afterObstacleHit({ hp: 5, speed: speed, speedBase: base, combo: combo }, C).speedBase; boost = 0; }
      const target = L.boostTarget(L.targetSpeed(base, combo, C), boost > 0, C), dt = 1 / 60;
      boost = Math.max(0, boost - dt);
      const dv = target - speed, m = C.SPEED_ACCEL * dt; speed += Math.abs(dv) <= m ? dv : Math.sign(dv) * m;
      worst = Math.max(worst, speed); assert.ok(speed <= C.SPEED_MAX + 1e-9, `run ${run}: 속도 ${speed} > ${C.SPEED_MAX}`);
    }
  }
  assert.ok(worst > C.SPEED_MAX - 5, '시험이 최고 속도 근처까지 갔다: ' + worst.toFixed(1));
  // 효과 종료 후 원래 속도로 복귀(기본 속도 누적은 그대로)
  let speed = 200; const base = 200, T = L.targetSpeed(base, 0, C); let boost = C.BOOST_SEC, t = 0;
  while (t < 20) { const target = L.boostTarget(T, boost > 0, C); boost = Math.max(0, boost - 1 / 60); const dv = target - speed, m = C.SPEED_ACCEL / 60; speed += Math.abs(dv) <= m ? dv : Math.sign(dv) * m; t += 1 / 60; if (t < 3) assert.ok(speed >= 200 - 1e-9); }
  assert.ok(Math.abs(speed - 200) < 1e-6, '끝나면 원래 속도: ' + speed);
  // 가속 중에도 후보 사이 시간 간격이 점프 체공(글자 획득 구간)보다 길다: 간격 px 는 가속 전 목표 속도로 정해진다
  const grab = L.airWindow(C, C.GRAB_H).len;
  for (let v = C.SPEED_MIN; v <= C.SPEED_MAX; v += 1) { const gapPx = v * L.gapSec(v, C), vb = Math.min(C.SPEED_MAX, v * C.BOOST_FACTOR); assert.ok(gapPx / vb > grab, `v=${v}: 가속 중 간격 ${(gapPx / vb).toFixed(3)}초 > ${grab.toFixed(3)}`); }
});

test('328-2. 가속 점수: 가속 중 완성한 단어의 완성 점수만 x1.5, 장애물 안전 간격(여유 창)은 가속과 무관하게 SPEED_MIN~SPEED_MAX 전 구간에서 그대로', () => {
  const C = CONFIG;
  assert.equal(L.boostWordBonus(300, true, C), 450); assert.equal(L.boostWordBonus(300, false, C), 300); assert.equal(L.boostWordBonus(1500, true, C), 2250); assert.equal(L.boostWordBonus(201, true, C), 302);
  for (const kind of OBST_KINDS) { const lay = L.obstacleLayout(C, kind); for (let s = C.SPEED_MIN; s <= C.SPEED_MAX; s++) assert.ok(L.obstacleWindow(C, lay, s).width >= C.OBST_MIN_WINDOW); }
});

test('328-3. 옵션 hpfullbonus(0~1000 정수, 기본 100)·speeditem(0|1, 기본 1)·speedevery(1~10 정수, 기본 4)·boostsec(1~10, 기본 5): 범위 밖 무시, 저장 방식 동일, 기본값이면 표시 없음', () => {
  const po = q => L.parseOptions(q);
  assert.deepEqual(po('?hpfullbonus=250').values, { hpfullbonus: 250 }); assert.deepEqual(po('?hpfullbonus=250').applied, ['hpfullbonus']); assert.deepEqual(po('?hpfullbonus=100').applied, []);
  assert.deepEqual(po('?hpfullbonus=0').values, { hpfullbonus: 0 }); assert.deepEqual(po('?hpfullbonus=1000').values, { hpfullbonus: 1000 });
  assert.deepEqual(po('?speeditem=0').applied, ['speeditem']); assert.deepEqual(po('?speeditem=1').applied, []);
  assert.deepEqual(po('?speedevery=2').values, { speedevery: 2 }); assert.deepEqual(po('?speedevery=4').applied, []); assert.deepEqual(po('?boostsec=3').applied, ['boostsec']); assert.deepEqual(po('?boostsec=5').applied, []); assert.deepEqual(po('?boostsec=2.5').values, { boostsec: 2.5 });
  for (const bad of ['hpfullbonus=1001', 'hpfullbonus=-1', 'hpfullbonus=1.5', 'hpfullbonus=x', 'speeditem=2', 'speeditem=0.5', 'speedevery=0', 'speedevery=11', 'speedevery=2.5', 'boostsec=0', 'boostsec=0.5', 'boostsec=11', 'boostsec=x']) assert.deepEqual(po('?' + bad).values, {}, bad);
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ hpfullbonus: 300, speeditem: 0, speedevery: 2, boostsec: 3 })).values, { hpfullbonus: 300, speeditem: 0, speedevery: 2, boostsec: 3 }, '저장값 사용');
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ hpfullbonus: 5000, speedevery: 99 })).values, {}, '저장값도 범위 규칙');
  const c = L.buildConfig({ hpfullbonus: 300, speeditem: 0, speedevery: 2, boostsec: 3 });
  assert.equal(c.HP_FULL_BONUS, 300); assert.equal(c.SPEED_ITEM_ENABLED, false); assert.equal(c.SPEED_EVERY, 2); assert.equal(c.BOOST_SEC, 3);
  const e = L.buildConfig(); assert.equal(e.HP_FULL_BONUS, 100); assert.equal(e.SPEED_ITEM_ENABLED, true); assert.equal(e.SPEED_EVERY, 4); assert.equal(e.BOOST_SEC, 5);
});

test('328-1. 하트 단어에서 장애물이 줄어드는 정도(측정): 하트 제외 규칙은 328 이전부터 계획 단계에서 정적으로 적용되어 있어 체력 조건 제거로 장애물 비율이 달라지지 않는다', () => {
  const C = L.buildConfig({ obsprob: 0.5 }), rnd = mulberry(3281);
  const N = 6000; let withHeart = 0, noHeart = 0, heartWords = 0, obstOnHeart = 0;
  for (let i = 0; i < N; i++) {
    const n = 2 + Math.floor(rnd() * 5), highs = L.planHighSlots(n, rnd, C), isHeart = rnd() < 1 / 3, hs = isHeart ? L.pickHeartSlot(n, rnd) : null;
    const a = L.planObstacle(n, highs, hs, false, mulberry(i + 7), C), b = L.planObstacle(n, highs, null, false, mulberry(i + 7), C);
    if (a) withHeart++; if (b) noHeart++; if (isHeart) { heartWords++; if (a) obstOnHeart++; }
  }
  const r1 = withHeart / N, r0 = noHeart / N;
  console.log(`장애물 비율: 하트 규칙 포함 ${(r1 * 100).toFixed(1)}% / 하트 없다고 가정 ${(r0 * 100).toFixed(1)}% (하트 단어 ${heartWords}개 중 장애물 ${obstOnHeart}개)`);
  assert.ok(r1 < r0 && r1 > 0.2, '하트 제외로 줄지만 충분히 남는다');
  // 328 이전: 같은 정적 규칙(체력과 무관)이었으므로 같은 결과 — planObstacle 은 그대로
  assert.deepEqual(L.planObstacle(6, new Set(), 4, false, () => 0.999, L.buildConfig({ obsprob: 1 })), { slot: 2, kind: 'pit' });
});

// ───────── 작업329: 구조 아이템(힌트·천사) ─────────
test('329-1. 구조 아이템 조건: 체력 기준 경계(1 이상, HP x itemhp 이하), 난수 없음, 번갈아, 하트·장애물·보스·복습 단어에는 없고 가속 아이템과 겹치지 않는다', () => {
  const C = CONFIG, base = { roundSeq: 2, hp: 2, boss: false, review: false, hasHeart: false, hasObst: false, nSlots: 5, rescueCount: 0 };
  assert.equal(C.RESCUE_ENABLED, true); assert.equal(C.ITEM_HP, 0.4); assert.equal(C.RESCUE_EVERY, 3);
  // 경계: HP 5 x 0.4 = 2 → 체력 2 는 나오고 3 은 아니다, 0 은 아니다
  assert.equal(L.rescueLow(1, C), true); assert.equal(L.rescueLow(2, C), true); assert.equal(L.rescueLow(3, C), false); assert.equal(L.rescueLow(5, C), false); assert.equal(L.rescueLow(0, C), false, '체력 0 은 아니다');
  const c10 = L.buildConfig({ hp: 10 }); assert.equal(L.rescueLow(4, c10), true); assert.equal(L.rescueLow(5, c10), false);
  assert.equal(L.rescueLow(1, L.buildConfig({ itemhp: 0 })), false, 'itemhp=0 이면 나오지 않는다'); assert.equal(L.rescueLow(5, L.buildConfig({ itemhp: 1 })), true); assert.equal(L.rescueLow(1, L.buildConfig({ itemhp: 0.2 })), true); assert.equal(L.rescueLow(2, L.buildConfig({ itemhp: 0.2 })), false);
  const every1 = L.buildConfig({ rescueevery: 1 });
  const ok = Object.assign({ regularIdx: 0 }, base);
  assert.ok(L.planRescue(ok, every1), 'rescueevery=1 이면 매 단어(조건 충족 시)');
  assert.equal(L.planRescue(Object.assign({}, ok, { hp: 3 }), every1), null, '기준 초과');
  assert.equal(L.planRescue(Object.assign({}, ok, { hp: 0 }), every1), null);
  for (const ex of [{ boss: true }, { review: true }, { hasHeart: true }, { hasObst: true }, { nSlots: 1 }]) assert.equal(L.planRescue(Object.assign({}, ok, ex), every1), null, JSON.stringify(ex));
  assert.equal(L.planRescue(ok, L.buildConfig({ rescueevery: 1, rescue: 0 })), null, 'rescue=0');
  // 번갈아 + 묶음은 첫 묶음 이후
  const kinds = [0, 1, 2, 3, 4, 5].map(i => L.planRescue(Object.assign({}, ok, { rescueCount: i }), every1).kind); assert.deepEqual(kinds, ['hint', 'angel', 'hint', 'angel', 'hint', 'angel']);
  for (let i = 0; i < 60; i++) { const r = L.planRescue(Object.assign({}, ok, { regularIdx: i, roundSeq: i % 7 }), every1); assert.ok(r.slot >= 1 && r.slot <= 4); }
  // 빈도: 약 3단어에 1번, 같은 입력 같은 결과, 난수 없음
  let n = 0, hit = 0; const orig = Math.random; Math.random = () => { throw new Error('난수 사용 금지'); };
  try { for (let round = 1; round <= 60; round++) for (let i = 0; i < 9; i++) { const o = Object.assign({}, base, { roundSeq: round, regularIdx: i }), r = L.planRescue(o, C); assert.deepEqual(L.planRescue(o, C), r); n++; if (r) hit++; } } finally { Math.random = orig; }
  assert.ok(hit / n > 0.25 && hit / n < 0.42, '약 1/3: ' + (hit / n).toFixed(3));
  // 우선순위: 구조가 정해진 단어에는 가속 아이템이 없다(호출하는 쪽이 hasHeart 로 넘긴다) — 가속 계획이 hasHeart=true 면 null
  assert.equal(L.planSpeedItem({ roundSeq: 1, regularIdx: 0, boss: false, review: false, hasHeart: true, hasObst: false, nSlots: 5 }, L.buildConfig({ speedevery: 1 })), null);
  // 기존 난수 호출 횟수 불변, 장애물 규칙 불변
  let calls = 0; const rec = () => { calls++; return 0.5; };
  L.planHearts(9, rec, C); assert.equal(calls, 3); calls = 0; L.pickHeartSlot(5, rec); assert.equal(calls, 1); calls = 0; L.planObstacle(5, new Set(), null, false, rec, L.buildConfig({ obsprob: 1 })); assert.equal(calls, 3);
  assert.equal(C.OBST_W, 28); assert.equal(C.OBST_H, 28); assert.equal(C.PIT_W, 36);
  for (const kind of OBST_KINDS) { const lay = L.obstacleLayout(C, kind); for (let s = C.SPEED_MIN; s <= C.SPEED_MAX; s++) assert.ok(L.obstacleWindow(C, lay, s).width >= C.OBST_MIN_WINDOW); }
});

test('329-5. 옵션 itemhp(0~1, 기본 0.4)·rescueevery(1~10 정수, 기본 3)·rescue(0|1, 기본 1): 범위 밖 무시, 저장 방식 동일, 기본값이면 표시 없음', () => {
  const po = q => L.parseOptions(q);
  assert.deepEqual(po('?itemhp=0.6').values, { itemhp: 0.6 }); assert.deepEqual(po('?itemhp=0.6').applied, ['itemhp']); assert.deepEqual(po('?itemhp=0.4').applied, []); assert.deepEqual(po('?itemhp=0').values, { itemhp: 0 }); assert.deepEqual(po('?itemhp=1').values, { itemhp: 1 });
  assert.deepEqual(po('?rescueevery=2').applied, ['rescueevery']); assert.deepEqual(po('?rescueevery=3').applied, []); assert.deepEqual(po('?rescue=0').applied, ['rescue']); assert.deepEqual(po('?rescue=1').applied, []);
  for (const bad of ['itemhp=1.1', 'itemhp=-0.1', 'itemhp=x', 'rescueevery=0', 'rescueevery=11', 'rescueevery=2.5', 'rescue=2', 'rescue=0.5', 'rescue=']) assert.deepEqual(po('?' + bad).values, {}, bad);
  assert.deepEqual(L.resolveOptions('', JSON.stringify({ itemhp: 0.7, rescueevery: 5, rescue: 0 })).values, { itemhp: 0.7, rescueevery: 5, rescue: 0 }); assert.deepEqual(L.resolveOptions('', JSON.stringify({ itemhp: 9, rescueevery: 99 })).values, {});
  const c = L.buildConfig({ itemhp: 0.7, rescueevery: 5, rescue: 0 }); assert.equal(c.ITEM_HP, 0.7); assert.equal(c.RESCUE_EVERY, 5); assert.equal(c.RESCUE_ENABLED, false);
  const e = L.buildConfig(); for (const k of Object.keys(e)) if (!['ITEM_HP', 'RESCUE_EVERY', 'RESCUE_ENABLED'].includes(k)) assert.deepEqual(L.buildConfig({ rescue: 0 })[k], e[k], k);
});

// ───────── 작업332: 생존 모드 ─────────
const SURV_POOLS = n => Array.from({ length: n }, (_, i) => ({ word: ['apple', 'book', 'environment', 'water', 'happy', 'window', 'music', 'friend', 'tomorrow', 'cat', 'beautiful', 'dog'][i % 12] + (i >= 12 ? i : ''), meaning: 'm' + i }));

test('332-2/3. 단어 공급: 구간(5개)마다 일반 4개 + 마지막 보스(구간에서 가장 긴 단어), 5의 배수 순번만 보스, 한 구간 안에 같은 단어 없음, 직전 단어와 연속 같은 단어 없음, 단어가 고르게 돈다', () => {
  for (const size of [5, 6, 7, 8, 12, 25]) {
    const pool = SURV_POOLS(size), sup = L.makeSurvSupply(pool, CONFIG, mulberry(332 + size)), seq = [];
    for (let s = 0; s < 120; s++) {
      const seg = sup.nextSegment(); assert.equal(seg.length, 5);
      assert.deepEqual(seg.map(w => !!w.boss), [false, false, false, false, true], '마지막만 보스');
      assert.equal(new Set(seg.map(w => w.word)).size, 5, `풀 ${size}: 한 구간에 같은 단어 없음`);
      const longest = Math.max(...seg.map(w => L.letterCount(w.word))); assert.equal(L.letterCount(seg[4].word), longest, '보스는 구간에서 가장 긴 단어');
      seq.push(...seg);
    }
    for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i].word, seq[i - 1].word, `풀 ${size}: ${i} 번째에서 연속 같은 단어`);
    seq.forEach((w, i) => assert.equal(!!w.boss, (i + 1) % 5 === 0, '순번 ' + (i + 1)));
    const cnt = {}; seq.forEach(w => { cnt[w.word] = (cnt[w.word] || 0) + 1; });
    if (size <= 12) { const vals = Object.values(cnt); assert.equal(vals.length, size, '모든 단어가 나온다'); }
  }
  // 같은 길이 보스는 난수 없이 해시로: 같은 구간이면 같은 선택
  const tie = [{ word: 'aaaa' }, { word: 'bbbb' }, { word: 'cccc' }, { word: 'dddd' }, { word: 'eeee' }];
  assert.equal(L.survPickBoss(tie, 3), L.survPickBoss(tie, 3)); assert.ok(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => L.survPickBoss(tie, i))).size >= 2, '구간에 따라 달라진다');
  // 섞기에만 rng 를 쓰고 Math.random 은 쓰지 않는다
  const orig = Math.random; Math.random = () => { throw new Error('Math.random 금지'); };
  try { const sup = L.makeSurvSupply(SURV_POOLS(7), CONFIG, mulberry(5)); for (let i = 0; i < 30; i++) sup.nextSegment(); } finally { Math.random = orig; }
});

test('332-4. 하트: 난수 없이 단어 순번·판 순번 해시로 정하고, 간격이 순번이 늘수록 늘어나며(상한), 그룹마다 정확히 하나, survheart=0 이면 늘지 않는다. 기본 모드의 난수 호출은 그대로', () => {
  const C = CONFIG;
  assert.equal(C.SURV_HEART_START_ADJ, 1); assert.equal(C.SURV_HEART_STEP_EVERY, 15); assert.equal(C.SURV_HEART_STEP, 3); assert.equal(C.SURV_HEART_MAX_EVERY, 8);
  assert.deepEqual([0, 14, 15, 29, 30, 44, 200].map(i => L.survHeartEvery(i, C)), [2, 2, 5, 5, 8, 8, 8], '2 → 5 → 8(상한)');
  assert.equal(L.survHeartEvery(0, L.buildConfig({ heartevery: 5 })), 4, 'heartevery 가 시작 간격을 따른다(-1)'); assert.equal(L.survHeartEvery(100, L.buildConfig({ survheart: 0 })), 2);
  const orig = Math.random; Math.random = () => { throw new Error('Math.random 금지'); };
  try {
    for (const seq of [1, 2, 3, 7]) {
      const hearts = []; for (let i = 0; i < 90; i++) if (L.survHeartWord(i, seq, C)) hearts.push(i);
      // 그룹마다 하나: 그룹 경계 0,2,4,... 로 나눠 확인
      let start = 0, g = 0; while (start < 80) { const size = L.survHeartEvery(start, C), inGroup = hearts.filter(h => h >= start && h < start + size); assert.equal(inGroup.length, 1, `seq ${seq} 그룹 ${g}(${start}~${start + size - 1})`); start += size; g++; }
      const gaps = hearts.map((h, i) => [h, i ? h - hearts[i - 1] : h + 1]), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
      const eg = gaps.filter(g => g[0] < 15).map(g => g[1]), lg = gaps.filter(g => g[0] >= 45).map(g => g[1]); assert.ok(mean(eg) <= 3 && mean(lg) >= 5, `간격이 늘어난다: 처음 ${mean(eg).toFixed(1)}, 45번째 이후 ${mean(lg).toFixed(1)}`);
      assert.deepEqual(hearts, Array.from({ length: 90 }, (_, i) => i).filter(i => L.survHeartWord(i, seq, C)), '같은 입력 → 같은 결과');
    }
  } finally { Math.random = orig; }
  const early = [...Array(15).keys()].filter(i => L.survHeartWord(i, 1, C)).length, late = [...Array(45).keys()].map(i => i + 45).filter(i => L.survHeartWord(i, 1, C)).length;
  assert.ok(early >= 6 && late <= 6, `하트 밀도: 처음 15단어 ${early}개, 45~89단어 ${late}개`);
  assert.equal(L.survHeartSlot(1, 1, 3), 0); for (let n = 2; n < 8; n++) for (let i = 0; i < 20; i++) { const s = L.survHeartSlot(n, 2, i); assert.ok(s >= 1 && s < n); }
  // 기본 모드의 하트 난수 호출은 그대로
  let calls = 0; const rec = () => { calls++; return 0.5; }; L.planHearts(9, rec, C); assert.equal(calls, 3); calls = 0; L.pickHeartSlot(5, rec); assert.equal(calls, 1);
});

test('332-4. 난이도 곡선: 단어 순번에 따라 장애물·높은 칸 확률이 오르고(상한), 원본 설정은 바뀌지 않으며, 안전 간격(여유 창)은 확률이 올라도 그대로이고 난수 호출 순서도 그대로다', () => {
  const C = CONFIG;
  assert.equal(C.SURV_RAMP_EVERY, 10); assert.equal(C.SURV_RAMP, 0.05); assert.equal(C.SURV_OBST_MAX, 0.9); assert.equal(C.SURV_HIGH_MAX, 0.5);
  const o = n => L.survRampCfg(C, n).OBSTACLE_PROB, h = n => L.survRampCfg(C, n).HIGH_SLOT_PROB;
  assert.equal(o(1), 0.5); assert.equal(o(10), 0.5); assert.ok(Math.abs(o(11) - 0.55) < 1e-9); assert.ok(Math.abs(o(21) - 0.6) < 1e-9); assert.equal(o(1000), 0.9, '상한');
  assert.equal(h(1), 0.2); assert.ok(Math.abs(h(11) - 0.25) < 1e-9); assert.equal(h(1000), 0.5);
  for (let n = 2; n < 300; n++) { assert.ok(o(n) >= o(n - 1) && h(n) >= h(n - 1)); }
  assert.equal(C.OBSTACLE_PROB, 0.5); assert.equal(C.HIGH_SLOT_PROB, 0.2, '원본은 그대로');
  assert.equal(L.survRampCfg(L.buildConfig({ survramp: 0 }), 500).OBSTACLE_PROB, 0.5, 'survramp=0 이면 오르지 않는다'); assert.equal(L.survRampCfg(L.buildConfig({ obsprob: 0.2 }), 1).OBSTACLE_PROB, 0.2, 'obsprob 가 바탕');
  for (const n of [1, 11, 51, 301]) { const c = L.survRampCfg(C, n);
    for (const kind of OBST_KINDS) { const lay = L.obstacleLayout(c, kind); for (let s = c.SPEED_MIN; s <= c.SPEED_MAX; s++) assert.ok(L.obstacleWindow(c, lay, s).width >= c.OBST_MIN_WINDOW, `n=${n} ${kind} v=${s}`); }
    assert.equal(c.OBST_W, 28); assert.equal(c.OBST_H, 28); assert.equal(c.PIT_W, 36);
    let calls = 0; L.planObstacle(5, new Set(), null, false, () => { calls++; return 0; }, c); assert.equal(calls, 3, '확률→자리→종류'); }
});

test('332-1/7. 최소 단어 수·상태 읽기: SURV_MIN_WORDS 5, 옵션 survheart(0~5, 기본 3)·survramp(0~0.2, 기본 0.05)는 조정값, 모드는 조정값이 아니다. runState 는 한 곳에서 현재 상태를 돌려 준다', () => {
  assert.equal(CONFIG.SURV_MIN_WORDS, 5);
  const po = q => L.parseOptions(q);
  assert.deepEqual(po('?survheart=2').applied, ['survheart']); assert.deepEqual(po('?survheart=3').applied, []); assert.deepEqual(po('?survramp=0.1').applied, ['survramp']); assert.deepEqual(po('?survramp=0.05').applied, []);
  for (const bad of ['survheart=6', 'survheart=-1', 'survheart=1.5', 'survramp=0.3', 'survramp=-0.1', 'survramp=x']) assert.deepEqual(po('?' + bad).values, {}, bad);
  assert.deepEqual(po('?survival=1').values, {}, 'survival 은 옵션 규칙(조정값)에 없다'); assert.deepEqual(po('?survival=1').applied, []);
  assert.deepEqual(L.resolveOptions('?survival=1', JSON.stringify({ survival: 1 })).values, {}); assert.equal(L.resolveOptions('?survival=1').save, null, '모드는 spellrun_opts 에 저장되지 않는다');
  const c = L.buildConfig({ survheart: 1, survramp: 0.1 }); assert.equal(c.SURV_HEART_STEP, 1); assert.equal(c.SURV_RAMP, 0.1);
  const r = L.runState({ score: 1200, hp: 3, combo: 4, wi: 6, state: 'run', startTime: 10, time: 75.5, survival: true }, CONFIG);
  assert.deepEqual(r, { score: 1200, hp: 3, maxHp: 5, combo: 4, wordNo: 7, alive: true, elapsed: 65.5, survival: true });
  assert.equal(L.runState({ score: 0, hp: 0, combo: 0, wi: 0, state: 'ending', startTime: 0, time: 5, survival: false }, CONFIG).alive, false); assert.equal(L.runState({ score: 0, hp: 2, combo: 0, wi: 0, state: 'over', startTime: 0, time: 5, survival: false }, CONFIG).alive, false);
});

// 332-5: 균형 시뮬레이션. 331 과 같은 방식(칸당 실수율 e, 장애물 한 번에 맞을 확률 2.5 x e, 단어당 12초)이며 실제 logic.js 의 하트·곡선·장애물·높은 칸 계획을 쓴다.
function survSim(e, N, seed) {
  const R = mulberry(seed), cfg = L.buildConfig(), f = Math.min(0.5, 2.5 * e); let total = 0, words = 0;
  for (let run = 1; run <= N; run++) {
    let hp = cfg.HP, reg = 0, n = 0;
    while (hp > 0 && n < 2000) {
      n++; const boss = n % cfg.SURV_BOSS_EVERY === 0, c = L.survRampCfg(cfg, n), slots = boss ? 5 + Math.floor(R() * 3) : 3 + Math.floor(R() * 4), highs = L.planHighSlots(slots, R, c);
      const heart = !boss && L.survHeartWord(reg, run, cfg), ob = L.planObstacle(slots, highs, heart ? L.survHeartSlot(slots, run, reg) : null, boss, R, c);
      if (boss && hp < cfg.HP && n <= cfg.SURV_BOSS_HEAL_UNTIL) hp = Math.min(cfg.HP, hp + cfg.SURV_BOSS_HEAL);
      for (let s = 0; s < slots && hp > 0; s++) { const pe = highs.has(s) ? Math.min(0.6, e * 1.5) : e; while (hp > 0 && R() < pe) hp--; }
      if (hp > 0 && ob && R() < f) hp--;
      if (hp > 0 && heart && R() < 0.9 && hp < cfg.HP) hp++;
      if (!boss) reg++;
    }
    total += (n - 0.5) * 12; words += n;
  }
  return { sec: total / N, words: words / N };
}
test('332-5. 균형 시뮬레이션(가정치): 보통 실력(칸당 실수 10%) 평균 3분 30초~4분, 능숙(6%) 8분 이하, 매우 잘함(4%) 12분 이하', () => {
  const a = survSim(0.10, 6000, 1), b = survSim(0.06, 6000, 2), c = survSim(0.04, 6000, 3);
  console.log(`생존 시뮬레이션: 10% ${Math.round(a.sec)}초(${a.words.toFixed(1)}단어), 6% ${Math.round(b.sec)}초(${b.words.toFixed(1)}단어), 4% ${Math.round(c.sec)}초(${c.words.toFixed(1)}단어)`);
  assert.ok(a.sec >= 210 && a.sec <= 240, '보통 ' + a.sec); assert.ok(b.sec <= 480, '능숙 ' + b.sec); assert.ok(c.sec <= 720, '매우 잘함 ' + c.sec);
  assert.ok(a.sec < b.sec && b.sec < c.sec, '잘할수록 오래 간다');
});
