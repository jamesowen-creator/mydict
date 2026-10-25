// 스펠링 런: 캔버스·HUD·입력·소리·발음·데이터 불러오기. 순수 로직은 logic.js(SpellRunLogic)에 있다.
// 시제품(spelling-run-prototype.html)의 화면 코드를 옮긴 것이고, 단어 목록은 단어장(/api/wordbook)에서 받은 영어 단어로 채운다.
// 발음은 서버 TTS(/api/tts, Authorization 헤더 포함)를 먼저 쓰고, 실패하면 브라우저 내장 음성(speechSynthesis)으로 대신한다.
(function () {
'use strict';

const L = window.SpellRunLogic;
// 작업319: 옵션은 기기(localStorage)에 저장해 사전에서 시작해도 이어진다. 주소 값이 저장값보다 우선, ?reset=1 이면 삭제. 저장소를 못 쓰면 이번 방문에만 적용
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const OPT = L.resolveOptions(location.search, lsGet(L.OPTION_KEY));
try { if (OPT.reset) localStorage.removeItem(L.OPTION_KEY); else if (OPT.save) localStorage.setItem(L.OPTION_KEY, JSON.stringify(OPT.save)); } catch (e) { /* 저장 실패는 무시 */ }

L.configure(OPT.values);                       // CONFIG 를 한 번에 다시 만든다(pace 는 속도·간격·점프 시간에 같은 비율로 반영)
const CONFIG = L.CONFIG;
const { PENGUIN, advanceRunPhase, penguinFrame, spinAngle, sparkleAlpha, introTimeline, introState, planSlots, makeCandidates, slotPoints, speedMult, gapSec, leadSec, speedAfterHit, speedAfterFail, targetSpeed, planHearts, pickHeartSlot, airHeight, secondJumpLandTime, planHighSlots, fitWord, buildHint, judge, bossConfig, planRound, letterCount, LAYOUT } = L;

const W = LAYOUT.W, H = LAYOUT.H, GROUND = LAYOUT.GROUND, RUNNER_X = 72, TILE_Y = LAYOUT.TILE_Y, TILE_H = LAYOUT.TILE_H, HIGH_Y = LAYOUT.HIGH_TILE_Y;
const INK = '#1d2b53', CORAL = '#ff6b5a', GOLD = '#ffb700', GOOD = '#1fae68', BAD = '#e8454f';
const TILE_COLORS = ['#ffd25e', '#ff9fb2', '#7ed9c3', '#a8c0ff'];
const FL = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';   // 앱의 기존 글꼴 스택(tokens.css --font-sans). 시제품의 Fredoka는 쓰지 않는다
const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

const IDS_KEY = 'spellrun_ids';       // 사전 단어장이 넣어 준 선택 단어 id 배열(sessionStorage)
const TTS_TIMEOUT_MS = 8000;          // 서버 발음 응답을 기다리는 최대 시간. 넘으면 내장 음성으로 대신한다
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const $ = id => document.getElementById(id);
const box = $('box'), stage = $('stage'), cv = $('cv'), ctx = cv.getContext('2d');
const els = {
  hud: $('hud'), hearts: $('hearts'), score: $('score'), combo: $('combo'), progress: $('progress'),
  sub: $('sub'), hintbox: $('hintbox'), popPron: $('popPron'), popEx: $('popEx'), tune: $('tune'), djRule: $('djRule'),
  meaning: $('meaning'), speedTag: $('speedTag'), word: $('word'), pop: $('pop'), popTag: $('popTag'), popWord: $('popWord'), popMean: $('popMean'), popNote: $('popNote'),
  start: $('start'), startBtn: $('startBtn'), startInfo: $('startInfo'), startExcluded: $('startExcluded'), speechNote: $('speechNote'),
  result: $('result'), resTitle: $('resTitle'), resScore: $('resScore'), resDone: $('resDone'), resCombo: $('resCombo'),
  resChips: $('resChips'), revBtn: $('revBtn'), againBtn: $('againBtn'), live: $('live'),
  bossBanner: $('bossBanner'), bossSub: $('bossSub')
};
const sndBtns = [$('snd'), $('sndStart')];
const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---------- 작업321: 펭귄 스프라이트 시트(미리 불러오기). 로딩 전·실패 시에는 기존 도형 캐릭터로 그린다(게임 시작을 막지 않는다) ----------
const sheet = new Image();
let sheetOK = false;
sheet.onload = () => { sheetOK = sheet.naturalWidth === PENGUIN.SHEET_W && sheet.naturalHeight === PENGUIN.SHEET_H; };
sheet.onerror = () => { sheetOK = false; };
try { sheet.src = PENGUIN.URL; } catch (e) { sheetOK = false; }
const penguinReady = () => sheetOK && sheet.complete;

let VALID_WORDS = [];                  // [{ id, word(소문자), meaning }] 단어장에서 고른 영어 단어
const missedSet = new Set();           // 틀린 단어(소문자). 서버에 저장하지 않고 이 페이지 메모리에만 둔다

// ---------- 크기 맞춤 ----------
let S = 1;
function resize() {
  const availW = stage.clientWidth - 16;
  if (availW <= 0) return;   // 아직 보이지 않는 상태
  const top = stage.getBoundingClientRect().top + window.scrollY;
  const availH = Math.max(window.innerHeight - top - 32, 480);
  const scale = Math.max(0.5, Math.min(availW / W, availH / H, 1.5));
  box.style.width = Math.round(W * scale) + 'px';
  box.style.height = Math.round(H * scale) + 'px';
  box.style.setProperty('--u', scale + 'px');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * scale * dpr);
  cv.height = Math.round(H * scale * dpr);
  S = cv.width / W;
  fitAll();   // 폭이 바뀌면(리사이즈·회전) 글자 맞춤을 다시 계산한다
}
window.addEventListener('resize', resize);
try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (typeof fitAll === 'function') fitAll(); }); } catch (e) { /* 글꼴 이벤트가 없으면 무시 */ }   // 웹 글꼴이 늦게 로드돼 폭이 바뀌면 글자 맞춤을 다시 계산한다

// ---------- 작업318-1: 폭을 재서 맞추는 글자 크기 ----------
// 단계로 줄이지 않고 실제 폭을 재서 한 줄(또는 허용 줄 수)에 들어올 때까지 0.5px 씩 줄인다. 크기는 논리 px(×--u)라 화면 배율과 무관하게 같은 결과가 나온다.
function lineHeightPx(el) { const cs = getComputedStyle(el); return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25; }
function fitsIn(el, lines) { return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= lineHeightPx(el) * lines + 2; }
function fitFont(el, max, min, linesFor) {
  if (!el || !el.clientWidth) return max;
  el.style.overflowWrap = '';
  for (let px = max; px >= min; px -= 0.5) {
    el.style.fontSize = 'calc(' + px + ' * var(--u))';
    if (fitsIn(el, linesFor(px))) return px;
  }
  el.style.overflowWrap = 'anywhere';   // 하한에서도 넘치는 공백 없는 아주 긴 글자만 마지막 수단으로 끊는다
  return min;
}
box.style.setProperty('--hs', LAYOUT.HUD_SHIFT);   // 대표 뜻·보조 줄·글자 칸 줄을 HUD 줄에서 내리는 거리(논리 px)
const unitPx = () => parseFloat(box.style.getPropertyValue('--u')) || 1;
// 상단 한글 힌트: 대표 뜻(.meaning, 큰 글자)과 그 아래 보조 한 줄(.sub, 다른 뜻 키워드). 정답은 logic.js 가 이미 ＿＿ 로 가렸다.
// 보조 줄은 글자를 줄이고(하한 10px) 그래도 안 되면 두 줄까지, 그다음은 "…" 없이 키워드 단위로 뒤에서부터 뺀다. 키워드가 없으면 줄 자체가 없다.
function fitSub(items) {
  els.sub.hidden = !items.length;
  if (!items.length) return;
  const limit = LAYOUT.CONTENT_BOTTOM_Y;
  const bottom = () => (els.word.getBoundingClientRect().bottom - box.getBoundingClientRect().top) / unitPx();
  for (let n = items.length; n > 0; n--) {
    els.sub.textContent = items.slice(0, n).join(' · ');
    fitFont(els.sub, 12, 10, px => (px > 10.5 ? 1 : 2));
    if (fitsIn(els.sub, 2) && bottom() <= limit) return;
  }
  els.sub.hidden = true; els.sub.textContent = '';
}
function fitHud() {
  if (els.hud.hidden || !G.plan) return;
  fitFont(els.meaning, 28, 14, px => (px > 22 ? 1 : 2));   // 한 줄을 먼저 시도하고, 22 이하부터 두 줄까지 허용
  const h = (G.words[G.wi] && G.words[G.wi].hint) || {};
  fitSub(h.subs || []);
}
function fitPop() {
  if (els.pop.hidden) return;
  fitFont(els.popWord, 44, 16, () => 1);   // 완성한 단어는 반드시 한 줄
  fitFont(els.popMean, 22, 12, px => (px > 16 ? 1 : 2));
  if (!els.popEx.hidden) fitFont(els.popEx, 13, 9, () => 3);
}
function fitResult() {
  if (els.result.hidden) return;
  fitFont(els.resTitle, 36, 16, () => 1);
  fitFont(els.resScore, 56, 20, () => 1);
}
function fitAll() {
  if (G.plan && !els.hud.hidden) { layoutWord(); if (G.iActive) els.hintbox.style.transform = ''; fitHud(); if (G.iActive) { measureIntro(); applyIntro(); } }
  fitPop(); fitResult();
}

// ---------- 소리 ----------
const SND = { on: true, ac: null };
function audioCtx() {
  if (!SND.ac) { try { SND.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  return SND.ac;
}
function tone(f, d, type, v, delay) {
  if (!SND.on) return;
  const a = audioCtx(); if (!a) return;
  try {
    if (a.state === 'suspended') a.resume();
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v || 0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + d + 0.02);
  } catch (e) {}
}
const sfx = {
  jump: () => tone(520, 0.08, 'triangle', 0.05),
  jump2: () => tone(780, 0.09, 'triangle', 0.05),
  good: c => { const k = Math.min(c, 10) * 30; tone(660 + k, 0.1, 'sine', 0.08); tone(880 + k, 0.12, 'sine', 0.07, 0.07); },
  bad: () => tone(170, 0.22, 'sawtooth', 0.05),
  word: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.08, i * 0.09)),
  over: () => [392, 330, 262].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.15)),
  heart: () => [660, 880, 1320].forEach((f, i) => tone(f, 0.12, 'sine', 0.08, i * 0.07)),
  boss: () => [196, 196, 262, 330].forEach((f, i) => tone(f, 0.2, 'sawtooth', 0.05, i * 0.16))
};

// ---------- 발음: 서버 TTS 우선, 실패 시 브라우저 내장 음성 ----------
const hasSpeech = () => ('speechSynthesis' in window) && typeof window.SpeechSynthesisUtterance !== 'undefined';
let voice = null;
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /^en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  } catch (e) {}
}
if (hasSpeech()) { pickVoice(); try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {} }
let lastUtt = null; // 참조를 유지해야 일부 브라우저에서 발음이 중간에 끊기지 않는다
// onResult(ok, reason): 재생이 시작되면 ok=true, 오류나 시간 초과면 ok=false (한 번만 호출)
function speakBuiltin(text, rate, queue, onResult) {
  let done = false;
  const report = (ok, why) => { if (!done && onResult) { done = true; onResult(ok, why); } };
  if (!hasSpeech()) { report(false, '지원 안 됨'); return; }
  if (!SND.on) { report(false, '소리 끔'); return; }
  try {
    if (!queue && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = rate || 0.85;
    if (voice) u.voice = voice;
    let started = false;
    u.onstart = () => { started = true; report(true); };
    u.onerror = e => { if (!started) report(false, (e && e.error) || '오류'); };
    lastUtt = u;
    speechSynthesis.speak(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
    if (onResult) setTimeout(() => { if (!started) report(false, '응답 없음'); }, 2000);
  } catch (e) { report(false, '예외'); }
}

// 서버 발음 오디오는 하나의 <audio> 요소로 재생한다(iOS는 사용자 탭에서 한 번 재생한 요소만 이후 자동 재생을 허용한다).
const player = new Audio();
const audioCache = new Map();   // 단어 → 오디오 주소(Promise). 실패한 단어도 그대로 두어 같은 단어를 다시 요청하지 않는다
let serverTtsOff = false;       // 401·403·503을 받으면 이번 방문에서는 서버 발음을 더 부르지 않는다
function authHeaders() {
  let t = null; try { t = localStorage.getItem('mydict_token'); } catch (e) {}
  return t ? { Authorization: 'Bearer ' + t } : {};
}
function getServerAudio(word) {
  if (audioCache.has(word)) return audioCache.get(word);
  if (serverTtsOff) return Promise.reject(new Error('서버 발음 사용 안 함'));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS);
  const p = fetch('/api/tts', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify({ text: word, lang: 'en' }),
    signal: ctrl.signal
  }).then(res => {
    if (!res.ok) { if (res.status === 401 || res.status === 403 || res.status === 503) serverTtsOff = true; throw new Error('TTS ' + res.status); }
    return res.blob();
  }).then(blob => {
    if (!blob.size) throw new Error('빈 오디오');
    return URL.createObjectURL(blob);
  }).finally(() => clearTimeout(timer));
  p.catch(() => {});
  audioCache.set(word, p);
  return p;
}
function playUrl(url, rate, queue) {
  return new Promise((resolve, reject) => {
    const go = () => {
      try {
        player.defaultPlaybackRate = rate;
        player.src = url;
        player.playbackRate = rate;
        player.preservesPitch = true; player.webkitPreservesPitch = true; player.mozPreservesPitch = true;   // 느리게 재생해도 음높이 유지
      } catch (e) {}
      const pr = player.play();
      if (pr && pr.then) pr.then(resolve, reject); else resolve();
    };
    if (queue && !player.paused && !player.ended) {
      let fired = false;
      const once = () => { if (!fired) { fired = true; go(); } };
      player.addEventListener('ended', once, { once: true });
      player.addEventListener('pause', once, { once: true });
    } else go();
  });
}
// 단어 하나 발음. slow=true이면 0.6배속(같은 오디오를 다시 재생하므로 서버 호출이 늘지 않는다).
function pronounce(word, opts, onResult) {
  opts = opts || {};
  const slow = !!opts.slow, rate = slow ? CONFIG.FINAL_SLOW_RATE : 1;
  const report = (ok, why) => { if (onResult) onResult(ok, why); };
  if (!SND.on) { report(false, '소리 끔'); return; }
  const fallback = () => speakBuiltin(word, slow ? CONFIG.FINAL_SLOW_RATE : undefined, !!opts.queue, report);
  if (serverTtsOff && !audioCache.has(word)) { fallback(); return; }
  getServerAudio(word).then(url => playUrl(url, rate, !!opts.queue)).then(() => report(true), err => {
    if (err && err.name === 'AbortError') { report(true); return; }   // 다음 소리가 바로 이어 받아 재생이 끊긴 것(실패 아님). 내장 음성으로 겹쳐 읽지 않는다
    API.lastTtsError = String((err && err.message) || err); fallback();
  });   // 서버 발음 실패 이유는 테스트 훅에 남긴다
}
// 시작·재도전 버튼을 누른 순간 호출: 소리 재생 권한(자동 재생 제한)을 미리 확보한다
function primeAudio() {
  audioCtx();
  try { player.src = SILENT_WAV; const pr = player.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {}
  if (hasSpeech()) {
    try { const u = new SpeechSynthesisUtterance('a'); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
  }
}
function stopVoices() {
  try { player.pause(); } catch (e) {}
  if (hasSpeech()) { try { speechSynthesis.cancel(); } catch (e) {} }
}
function syncSndButtons() {
  sndBtns.forEach(b => { b.textContent = SND.on ? '소리 켬' : '소리 끔'; b.setAttribute('aria-pressed', String(SND.on)); });
}
sndBtns.forEach(b => b.addEventListener('click', () => {
  SND.on = !SND.on;
  if (!SND.on) stopVoices();
  syncSndButtons();
}));
syncSndButtons();

// ---------- 게임 상태 ----------
const G = {
  state: 'idle', words: [], wi: 0, plan: null, si: 0, mist: [],
  hp: 0, score: 0, combo: 0, maxCombo: 0, wordsDone: 0,
  speed: 60, speedTarget: 60, speedBase: 60, shownMult: 0, heartWords: new Set(), heartPending: false, heartSlot: 0, lastPts: 0, lastSpeedMult: 1, dist: 0, time: 0,
  tiles: [], parts: [], floats: [],
  packActive: false, packId: 0, spawnT: 0,
  runPhase: 0, prevH: 0, rising: true, cleared: false, spriteDraws: 0, spriteFrame: -1, spriteAngle: 0,
  iActive: false, iClock: 0, iTl: null, iGeo: null, iKids: 0, iShown: 0,
  jumpT: -1, j2: -1, j2h: 0, j2Land: 0, jumpBuf: 0, land: 0, hurt: 0, eat: 0, shake: 0, popT: 0, endT: 0,
  hintTimer: 0,
  regular: 0, bossMode: false, introT: 0, repeatT: 0, repeatWord: '', review: false
};
let slotEls = [];

// ---------- HUD ----------
function renderHearts() {
  els.hearts.innerHTML = Array.from({ length: CONFIG.HP }, (_, i) =>
    '<svg class="' + (i < G.hp ? '' : 'off') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + HEART + '"/></svg>').join('');
  els.hearts.setAttribute('aria-label', '체력 ' + G.hp + ' / ' + CONFIG.HP);
}
function renderScore() {
  els.score.textContent = G.score.toLocaleString('en-US');
  if (G.combo >= 2) { els.combo.hidden = false; els.combo.textContent = '콤보 ' + G.combo; }
  else els.combo.hidden = true;
}
function renderProgress() {
  const w = G.words[G.wi];
  els.progress.textContent = (w && w.boss) ? '보스 단어'
    : '단어 ' + (G.words.slice(0, G.wi + 1).filter(x => !x.boss).length) + ' / ' + G.regular + (G.review ? ' · 복습' : '');   // 보스 단어는 세지 않는다
  box.classList.toggle('boss', !!(w && w.boss));
}
// 글자 칸 줄 폭 배분(작업318-1): 칸 수와 칸별 글자 수(조각 칸은 폭이 큼)로 사용 가능한 폭을 나눈다. 계산은 logic.js(fitWord)
function wordItems() {
  const plan = G.plan, items = [], n = plan.cells.length;
  const slotAt = new Map(plan.slots.map((s, i) => [s.start, i]));
  for (let i = 0; i < n;) {
    if (slotAt.has(i)) { const sl = plan.slots[slotAt.get(i)]; items.push({ n: sl.len, chunk: sl.chunk }); i += sl.len; }
    else { items.push({ fixed: true }); i++; }
  }
  return items;
}
function layoutWord() {
  const fit = fitWord(wordItems(), LAYOUT.WORD_AVAIL_W);
  els.word.style.setProperty('--cw', fit.cw);
  els.word.style.setProperty('--fs', fit.fs);
  els.word.style.setProperty('--cg', fit.cellGap);
  els.word.style.setProperty('--sg', fit.slotGap);
  return fit;
}
function renderWord() {
  const plan = G.plan;
  const n = plan.cells.length;
  layoutWord();
  els.word.innerHTML = '';
  const w0 = G.words[G.wi];
  els.meaning.textContent = (w0.hint && w0.hint.meaning) || w0.meaning;   // 정답 단어(활용형 포함)는 ＿＿ 로 가려진 뜻
  els.meaning.classList.remove('enter');
  if (!(CONFIG.INTRO_ENABLED && !reduce)) { void els.meaning.offsetWidth; els.meaning.classList.add('enter'); }   // 작업323: 새 단어 연출이 켜져 있으면 연출이 이 등장 효과를 대신한다
  slotEls = [];
  const slotAt = new Map(plan.slots.map((s, i) => [s.start, i]));
  let i = 0;
  while (i < n) {
    if (slotAt.has(i)) {
      const s = plan.slots[slotAt.get(i)];
      const el = document.createElement('span');
      el.className = 'slot' + (s.chunk ? ' chunk' : '') + (s.high ? ' high' : '');
      if (s.chunk) el.dataset.mult = '×' + s.len;
      for (let k = 0; k < s.len; k++) {
        const c = document.createElement('span'); c.className = 'cell'; el.appendChild(c);
      }
      els.word.appendChild(el); slotEls.push(el);
      i += s.len;
    } else {
      const c = document.createElement('span');
      c.className = 'cell fixed'; c.textContent = plan.cells[i].ch;
      els.word.appendChild(c); i++;
    }
  }
  setCur();
  fitHud();
}
function setCur() {
  slotEls.forEach((el, i) => el.classList.toggle('cur', i === G.si && G.state !== 'pop'));
}
function fillSlotUI(si) {
  const slot = G.plan.slots[si], el = slotEls[si];
  slot.filled = true;
  if (!el) return;
  el.querySelectorAll('.cell').forEach((c, k) => {
    c.textContent = slot.text[k]; c.classList.remove('hint'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
  });
  el.classList.add('done'); el.classList.remove('cur');
}
function flashHint(si) {
  const slot = G.plan.slots[si], el = slotEls[si];
  if (!el) return;
  clearTimeout(G.hintTimer);
  const cells = Array.from(el.querySelectorAll('.cell'));
  cells.forEach((c, k) => { c.textContent = slot.text[k]; c.classList.add('hint'); });
  el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad');
  G.hintTimer = setTimeout(() => {
    if (slot.filled) return;
    cells.forEach(c => { c.textContent = ''; c.classList.remove('hint'); });
  }, CONFIG.HINT_SEC * 1000);
}

// ---------- 효과 ----------
function burst(x, y, color, n) {
  if (reduce) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
    G.parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.7, max: 0.7, color: color, r: 2 + Math.random() * 3 });
  }
}
function floatText(x, y, text, color, size) {
  G.floats.push({ x: x, y: y, life: 1.1, text: text, color: color || INK, size: size || 20 });
}
function updateFx(dt) {
  for (const p of G.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.life -= dt; }
  G.parts = G.parts.filter(p => p.life > 0);
  for (const f of G.floats) { f.y -= 42 * dt; f.life -= dt; }
  G.floats = G.floats.filter(f => f.life > 0);
}

// ---------- 라운드 진행 ----------
// 한 판은 최대 10단어. 5번째·10번째(그 위치에 단어가 있을 때만) 단어가 보스이고 긴 단어부터 배정된다(planRound). 복습 판에는 보스가 없다.
function startRound(reviewOnly) {
  const plan = planRound(VALID_WORDS, missedSet, CONFIG, Math.random, !!reviewOnly);
  const pool = plan.list.map((w, i) => Object.assign({ word: w.word, meaning: w.meaning, hint: w.hint, pop: w.pop }, plan.bossIdx.indexOf(i) >= 0 ? { boss: true } : {}));
  if (!pool.length) return;
  const regular = plan.regular;
  primeAudio();
  els.bossBanner.hidden = true;
  Object.assign(G, {
    regular: regular, bossMode: false, introT: 0, repeatT: 0, repeatWord: '',
    state: 'run', words: pool, wi: 0, mist: pool.map(() => 0),
    hp: CONFIG.HP, score: 0, combo: 0, maxCombo: 0, wordsDone: 0,
    speed: CONFIG.SPEED_MIN, speedTarget: CONFIG.SPEED_MIN, speedBase: CONFIG.SPEED_MIN, shownMult: 0, heartWords: planHearts(regular), tiles: [], parts: [], floats: [],
    packActive: false, jumpT: -1, j2: -1, j2h: 0, jumpBuf: 0, land: 0, hurt: 0, eat: 0, shake: 0, popT: 0, endT: 0,
    review: !!reviewOnly
  });
  els.start.hidden = true; els.result.hidden = true; els.pop.hidden = true; els.hud.hidden = false;
  renderHearts(); renderScore();
  loadWord(0);
}
function loadWord(i) {
  const boss = !!G.words[i].boss;
  G.wi = i; G.plan = planSlots(G.words[i].word, Math.random, boss ? bossConfig() : CONFIG, G.words[i].syl); G.si = 0;
  G.bossMode = boss;   // 중간에 오는 보스 뒤에는 일반 배경으로 돌아간다
  G.heartPending = !boss && G.heartWords.has(G.words.slice(0, i).filter(x => !x.boss).length);   // 하트 계획은 보스가 아닌 단어의 순번 기준
  G.heartSlot = pickHeartSlot(G.plan.slots.length);
  const highs = planHighSlots(G.plan.slots.length);   // 작업318-4: 2단 점프가 꺼져 있으면 빈 집합
  G.plan.slots.forEach((sl, k) => { sl.high = highs.has(k); });
  G.packActive = false; G.spawnT = CONFIG.WORD_START_DELAY + (i === 0 ? CONFIG.FIRST_WORD_EXTRA : 0);
  renderWord(); renderProgress();
  startIntro(i, boss);
}
// ---------- 작업323: 새 단어 시작 연출 ----------
// 큰 뜻(= 상단 힌트 묶음 #hintbox 를 확대해 화면 가운데에 둔 모양)을 보여 주다가, 하나의 요소를 transform(이동+크기)으로 상단 힌트 위치(작업322 최종 모양)로 옮기며
// 글자 칸을 왼쪽부터 하나씩 나타낸다. 시간은 게임 시간(step 의 dt)이라 탭이 가려지면 함께 멈춘다. 끝나면 transform 을 지워 322 레이아웃 그대로 남는다.
function clearIntro() {
  G.iActive = false;
  els.hintbox.style.transform = ''; els.hintbox.classList.remove('intro');
  Array.from(els.word.children).forEach(k => { k.style.visibility = ''; });
}
function measureIntro() {
  els.hintbox.style.transform = '';
  const u = unitPx(), bx = box.getBoundingClientRect(), r = els.hintbox.getBoundingClientRect();
  const cy = ((r.top + r.bottom) / 2 - bx.top) / u;
  let wmax = 0;
  [els.meaning, els.sub].forEach(el => { if (el.hidden || !el.textContent) return; const rg = document.createRange(); rg.selectNodeContents(el); wmax = Math.max(wmax, rg.getBoundingClientRect().width / u); });
  G.iGeo = { dy: LAYOUT.INTRO_CENTER_Y - cy, k: wmax ? Math.max(1, Math.min(CONFIG.INTRO_SCALE, (LAYOUT.WORD_AVAIL_W - 8) / wmax)) : CONFIG.INTRO_SCALE };
}
function applyIntro() {
  const st = introState(G.iClock, G.iTl, G.iKids, CONFIG);
  if (st.phase === 'done') { clearIntro(); return; }
  const u = unitPx(), k = G.iGeo.k + (1 - G.iGeo.k) * st.e, dy = G.iGeo.dy * (1 - st.e);
  els.hintbox.classList.add('intro');
  els.hintbox.style.transform = 'translateY(' + (dy * u).toFixed(2) + 'px) scale(' + k.toFixed(4) + ')';
  const kids = els.word.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].style.visibility = i < st.visible ? '' : 'hidden';   // 자리는 유지하고 숨긴다(위치가 흔들리지 않게)
    if (i < st.visible && i >= G.iShown) kids[i].classList.add('iv');
  }
  G.iShown = Math.max(G.iShown, st.visible);
}
function startIntro(i, boss) {
  clearIntro();
  if (!CONFIG.INTRO_ENABLED || reduce) return;
  const tl = introTimeline(CONFIG, { first: i === 0, boss: !!boss });
  if (tl.total <= 0) return;
  Object.assign(G, { iTl: tl, iClock: 0, iActive: true, iKids: els.word.children.length, iShown: 0 });
  measureIntro(); applyIntro();
}
function spawnPack() {
  const slot = G.plan.slots[G.si];
  const cands = makeCandidates(slot.text, G.words[G.wi].word, Math.random, G.words[G.wi].boss ? bossConfig() : CONFIG);
  const v = G.speedTarget;
  const gap = v * gapSec(v);
  let x0 = RUNNER_X + v * leadSec(v);
  G.packId++; G.packActive = true;
  // 하트: 체력이 줄었고 하트가 나올 칸이면, 묶음 앞에 한 칸 간격을 두고 둔다(점프해야 먹는다)
  if (G.heartPending && G.si >= G.heartSlot && G.hp < CONFIG.HP && !slot.high) {   // 높은 칸 묶음 앞에는 하트를 두지 않는다(점프 시점이 겹치지 않게)
    G.heartPending = false;
    G.tiles.push({ id: -G.packId, kind: 'heart', x: x0, w: 46, text: '', correct: false, chunk: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '' });
    x0 += gap;
  }
  cands.forEach((c, i) => {
    G.tiles.push({
      id: G.packId, x: x0 + i * gap, w: slot.chunk ? 20 + slot.text.length * 26 : 58,
      text: c.text, correct: c.correct, chunk: slot.chunk, high: !!slot.high, state: 'live', t: 0, age: 0,
      checked: false, ok: false, color: TILE_COLORS[(i + G.si) % TILE_COLORS.length]
    });
  });
}
function endPack(hint) {
  for (const t of G.tiles) {
    if (t.id !== G.packId || t.state !== 'live') continue;
    if (hint && t.correct && t.x > RUNNER_X) { t.state = 'hint'; t.t = 0; }
    else { t.state = 'fade'; t.t = 0; }
  }
  G.packActive = false; G.spawnT = CONFIG.PACK_DELAY;
}
function curH() { return airHeight(G.jumpT, G.j2, G.j2h); }
function resolve(t) {
  const hh = curH();
  const air = hh > CONFIG.GRAB_H;
  if (t.kind === 'heart') { if (air) onHeart(t); return; }
  // 높은 칸은 HIGH_GRAB_H 이상일 때만 "공중"으로 본다(한 번 점프로는 닿지 않는다). 일반 칸 판정은 그대로
  const r = judge(t.correct, t.high ? hh >= CONFIG.HIGH_GRAB_H : air);
  if (r === 'pass') return;
  if (r === 'hit') onHit(t);
  else onFail(t, r);
}
function onHeart(t) {
  t.state = 'taken'; t.t = 0; t.ok = true;
  G.hp = Math.min(CONFIG.HP, G.hp + CONFIG.HEART_HEAL);
  sfx.heart();
  burst(RUNNER_X + 8, TILE_Y, '#ff4d5e', 14);
  floatText(RUNNER_X + 70, GROUND - 235, '체력 +' + CONFIG.HEART_HEAL, GOOD, 22);
  renderHearts();
}
function onHit(t) {
  t.state = 'taken'; t.t = 0; t.ok = true;
  endPack(false);
  const slot = G.plan.slots[G.si];
  G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
  const sm = speedMult(G.speed);
  const pts = Math.round(slotPoints(slot.text.length, G.combo, CONFIG, t.high ? CONFIG.HIGH_BONUS : 0) * sm * (G.words[G.wi].boss ? CONFIG.BOSS_MULT : 1));
  G.lastPts = pts; G.lastSpeedMult = sm;
  G.speedBase = speedAfterHit(G.speedBase, slot.chunk);
  G.speedTarget = targetSpeed(G.speedBase, G.combo);
  G.score += pts; G.eat = 0.3;
  sfx.good(G.combo);
  burst(RUNNER_X + 8, TILE_Y, GOLD, slot.chunk ? 18 : 9);
  floatText(RUNNER_X + 34, GROUND - 150, '+' + pts, slot.chunk ? '#e07b00' : INK, slot.chunk ? 26 : 20);
  if (slot.chunk) floatText(RUNNER_X + 34, GROUND - 178, '조각 보너스', '#a86a00', 15);
  if (t.high) floatText(RUNNER_X + 70, GROUND - 225, '2단 점프 +' + CONFIG.HIGH_BONUS, '#a86a00', 17);
  if (G.combo % 5 === 0) floatText(RUNNER_X + 80, GROUND - 120, '콤보 ' + G.combo + '!', BAD, 24);
  fillSlotUI(G.si);
  G.si++;
  renderScore();
  if (G.si >= G.plan.slots.length) completeWord();
  else { setCur(); G.spawnT = CONFIG.PACK_DELAY; }
}
function onFail(t, kind) {
  if (kind === 'wrong') { t.state = 'taken'; t.t = 0; t.ok = false; }
  else { t.state = 'fade'; t.t = 0; }
  endPack(true);
  G.hp--; G.combo = 0; G.mist[G.wi]++;
  G.speedBase = speedAfterFail(G.speedBase);
  G.speedTarget = targetSpeed(G.speedBase, G.combo);
  G.hurt = 0.5; G.shake = 0.3;
  sfx.bad();
  floatText(RUNNER_X + 30, GROUND - 150, kind === 'wrong' ? '오답!' : '놓쳤어요', BAD, 22);
  flashHint(G.si);
  renderHearts(); renderScore();
  if (G.hp <= 0) { G.state = 'ending'; G.endT = 0.9; sfx.over(); }
}
function completeWord() {
  const w = G.words[G.wi];
  G.wordsDone++;
  const perfect = G.mist[G.wi] === 0;
  const isBoss = !!w.boss;
  const isFinal = G.wi + 1 >= G.words.length;
  const bonus = CONFIG.WORD_BONUS + (perfect ? CONFIG.PERFECT_BONUS : 0) + (isBoss ? CONFIG.BOSS_BONUS : 0);
  G.score += bonus;
  floatText(RUNNER_X + 40, GROUND - 200, '+' + bonus, '#e07b00', 28);
  burst(RUNNER_X + 20, GROUND - 120, GOLD, isBoss ? 60 : 30);
  els.popNote.textContent = '';
  sfx.word();
  pronounce(w.word, {}, ok => { if (!ok) els.popNote.textContent = '발음이 재생되지 않았습니다'; });
  // 마지막 단어는 발음을 한 번 더, 천천히 들려준다 (게임 시간 기준으로 예약)
  if (isFinal) { G.repeatT = CONFIG.FINAL_REPEAT_SEC; G.repeatWord = w.word; }
  els.popTag.textContent = isBoss ? '보스 격파!' : (perfect ? '한 번에 성공!' : '');
  const pop = w.pop || {};
  els.popWord.textContent = '';
  Array.from(w.word).forEach((ch, i) => { const sp = document.createElement('span'); sp.className = 'pl'; sp.style.setProperty('--i', i); sp.textContent = ch; els.popWord.appendChild(sp); });
  els.popPron.textContent = pop.pron || ''; els.popPron.hidden = !pop.pron;     // 발음기호(있을 때만)
  els.popMean.textContent = w.meaning;
  renderPopExample(pop);
  els.pop.hidden = false;
  els.pop.classList.remove('go');
  fitPop();
  setLetterFly();
  void els.pop.offsetWidth; els.pop.classList.add('go');
  els.live.textContent = (isBoss ? '보스 격파 ' : '') + w.word + ' ' + w.meaning;
  G.state = 'pop'; G.popT = isFinal ? CONFIG.POP_SEC_FINAL : CONFIG.POP_SEC;
  setCur(); renderScore();
}
// 예문: 정답 단어와 활용형은 강조(여기서는 가리지 않는다). 단어를 찾지 못하면 강조 없이 그대로 보인다
function renderPopExample(pop) {
  els.popEx.textContent = '';
  const text = pop.example || '';
  els.popEx.hidden = !text;
  if (!text) return;
  let pos = 0;
  (pop.ranges || []).forEach(rg => {
    if (rg[0] > pos) els.popEx.appendChild(document.createTextNode(text.slice(pos, rg[0])));
    const b = document.createElement('b'); b.textContent = text.slice(rg[0], rg[1]); els.popEx.appendChild(b);
    pos = rg[1];
  });
  if (pos < text.length) els.popEx.appendChild(document.createTextNode(text.slice(pos)));
}
// 글자가 글자 칸에서 날아와 순서대로 튀어 오른다: 각 글자의 시작 위치(칸 중심)와 도착 위치의 차이를 CSS 변수로 준다
function setLetterFly() {
  const cells = els.word.querySelectorAll('.cell');
  els.popWord.querySelectorAll('.pl').forEach((sp, i) => {
    const c = cells[i];
    if (!c) return;
    const a = c.getBoundingClientRect(), b = sp.getBoundingClientRect();
    sp.style.setProperty('--fx', Math.round((a.left + a.width / 2) - (b.left + b.width / 2)) + 'px');
    sp.style.setProperty('--fy', Math.round((a.top + a.height / 2) - (b.top + b.height / 2)) + 'px');
  });
}
function afterPop() {
  els.pop.hidden = true;
  if (G.wi + 1 >= G.words.length) { finish(true); return; }
  const next = G.words[G.wi + 1];
  if (next.boss) {
    G.state = 'intro'; G.introT = CONFIG.BOSS_INTRO_SEC; G.bossMode = true;
    G.speedBase = Math.min(CONFIG.SPEED_MAX, G.speedBase + CONFIG.BOSS_SPEED_BONUS);
    G.speedTarget = targetSpeed(G.speedBase, G.combo);
    const healed = G.hp < CONFIG.HP && CONFIG.BOSS_HEAL > 0;
    G.hp = Math.min(CONFIG.HP, G.hp + CONFIG.BOSS_HEAL);
    renderHearts();
    els.bossSub.textContent = healed ? '긴 단어에 도전! 체력 +' + CONFIG.BOSS_HEAL : '긴 단어에 도전!';
    els.bossBanner.hidden = false;
    els.bossBanner.classList.remove('go'); void els.bossBanner.offsetWidth; els.bossBanner.classList.add('go');
    els.live.textContent = '보스 단어 등장';
    sfx.boss();
  } else { G.state = 'run'; loadWord(G.wi + 1); }
}
function finish(cleared) {
  G.state = 'over'; G.bossMode = false; G.cleared = !!cleared; clearIntro();
  box.classList.remove('boss');
  els.pop.hidden = true; els.hud.hidden = true; els.bossBanner.hidden = true;
  els.resChips.textContent = '';
  G.words.forEach((w, i) => {
    let cls;
    if (i < G.wordsDone) {
      if (G.mist[i] === 0) { cls = 'clean'; missedSet.delete(w.word); }
      else { cls = 'slip'; missedSet.add(w.word); }
    } else if (i === G.wordsDone && !cleared) { cls = 'fail'; missedSet.add(w.word); }
    else cls = '';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip ' + cls + (w.boss ? ' boss' : ''); b.dataset.word = w.word;
    if (w.boss) { const em = document.createElement('em'); em.textContent = 'BOSS'; b.appendChild(em); }
    b.appendChild(document.createTextNode(w.word));
    const mean = document.createElement('i'); mean.textContent = w.meaning; b.appendChild(mean);
    els.resChips.appendChild(b);
  });
  const hasBoss = G.words.some(w => w.boss);
  els.resTitle.textContent = cleared ? (hasBoss ? '보스 격파!' : G.words.length + '단어 완주') : '게임 오버';
  els.resScore.textContent = G.score.toLocaleString('en-US');
  els.resDone.textContent = G.wordsDone + ' / ' + G.words.length;
  els.resCombo.textContent = G.maxCombo;
  const n = VALID_WORDS.filter(w => missedSet.has(w.word)).length;
  els.revBtn.textContent = n ? '틀린 단어만 다시 도전 (' + n + ')' : '틀린 단어 없음';
  els.revBtn.disabled = n === 0;
  els.result.hidden = false;
  fitResult();
  els.live.textContent = cleared ? '완주했습니다' : '게임 오버';
}

// ---------- 입력 ----------
function startJump() { G.jumpT = 0; G.j2 = -1; G.j2h = 0; G.jumpBuf = 0; sfx.jump(); }
// 작업318-4: 공중에서 한 번 더 누르면 2단 점프(공중에서 1회만). 점프 버퍼는 2단 점프를 쓴 뒤의 착지 직전 입력에만 쓴다. 2단 점프가 꺼져 있으면 예전 그대로
function startSecondJump() {
  G.j2h = curH(); G.j2 = 0; G.j2Land = secondJumpLandTime(G.j2h); G.jumpBuf = 0;
  sfx.jump2(); burst(RUNNER_X, GROUND - 27 - G.j2h + 24, '#ffffff', 8);
}
function jump() {
  if (G.state !== 'run' && G.state !== 'pop' && G.state !== 'intro') return;
  if (G.jumpT < 0) startJump();
  else if (CONFIG.DJ_ENABLED && G.j2 < 0) { if (G.jumpT >= CONFIG.SECOND_JUMP_MIN) startSecondJump(); }   // 첫 점프 직후의 너무 빠른 입력(중복 이벤트)은 무시
  else G.jumpBuf = CONFIG.JUMP_BUFFER;
}
box.addEventListener('pointerdown', e => {
  if (e.target.closest && e.target.closest('button')) return;
  e.preventDefault();
  jump();
});
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    if (G.state === 'run' || G.state === 'pop' || G.state === 'intro') { e.preventDefault(); if (!e.repeat) jump(); }   // 키를 누르고 있어서 생기는 반복 입력은 점프로 세지 않는다
  }
});
els.startBtn.addEventListener('click', () => startRound(false));
els.againBtn.addEventListener('click', () => startRound(false));
els.revBtn.addEventListener('click', () => startRound(true));
$('ttsTest').addEventListener('click', () => {
  const st = $('ttsStatus');
  st.textContent = '재생 중...';
  primeAudio();
  pronounce('hello', {}, (ok, why) => {
    st.textContent = ok ? '재생이 시작되었습니다. 소리가 들리지 않으면 기기 음량과 무음 모드를 확인하세요.'
                        : '재생되지 않았습니다 (' + why + '). 이 환경에서는 단어 발음이 나오지 않을 수 있습니다.';
  });
});
els.resChips.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.chip');
  if (b && b.dataset.word) pronounce(b.dataset.word);
});

// ---------- 업데이트 ----------
function step(dt) {
  G.time += dt;
  if (G.repeatT > 0) {
    G.repeatT -= dt;
    if (G.repeatT <= 0) { pronounce(G.repeatWord, { slow: true, queue: true }); G.repeatWord = ''; }
  }
  if (G.state === 'idle' || G.state === 'over') { G.dist += 60 * dt; updateFx(dt); return; }
  const dv = G.speedTarget - G.speed, maxDv = CONFIG.SPEED_ACCEL * dt;
  G.speed += Math.abs(dv) <= maxDv ? dv : Math.sign(dv) * maxDv;
  const shown = Math.round(speedMult(G.speed) * 10) / 10;
  if (shown !== G.shownMult) { G.shownMult = shown; els.speedTag.textContent = '속도 ×' + shown.toFixed(1); }
  G.dist += G.speed * dt;

  if (G.jumpT >= 0) {
    G.jumpT += dt;
    if (G.j2 >= 0) G.j2 += dt;
    if (G.j2 >= 0 ? G.j2 >= G.j2Land : G.jumpT >= CONFIG.JUMP_TIME) {
      G.jumpT = -1; G.j2 = -1; G.land = 0.12;
      if (G.jumpBuf > 0) startJump();
    }
  }
  if (G.jumpBuf > 0) G.jumpBuf -= dt;
  { const nh = curH(); if (nh !== G.prevH) G.rising = nh > G.prevH; G.prevH = nh; if (nh <= 1) G.runPhase = advanceRunPhase(G.runPhase, dt, G.speed); }   // 작업321: 게임 시간 기준(일시정지 중 정지)
  G.hurt = Math.max(0, G.hurt - dt);
  G.eat = Math.max(0, G.eat - dt);
  G.shake = Math.max(0, G.shake - dt);
  G.land = Math.max(0, G.land - dt);

  for (const t of G.tiles) {
    t.age += dt; t.x -= G.speed * dt;
    if (t.state !== 'live') t.t += dt;
    if (t.state === 'hint' && t.t > CONFIG.HINT_SEC) { t.state = 'fade'; t.t = 0; }
  }

  if (G.state === 'run') {
    if (G.iActive) { G.iClock += dt; applyIntro(); }   // 연출 시간은 게임 시간
    for (const t of G.tiles) {
      if (t.state === 'live' && !t.checked && t.x <= RUNNER_X) {
        t.checked = true;
        resolve(t);
        if (G.state !== 'run') break;
      }
    }
    if (G.state === 'run' && !G.packActive) {
      G.spawnT -= dt;
      if (G.spawnT <= 0) { if (G.iActive) clearIntro(); spawnPack(); }   // 안전장치: 연출은 항상 첫 타일 등장 전에 끝난다
    }
  } else if (G.state === 'pop') {
    G.popT -= dt;
    if (G.popT <= 0) afterPop();
  } else if (G.state === 'intro') {
    G.introT -= dt;
    if (G.introT <= 0) { els.bossBanner.hidden = true; G.state = 'run'; loadWord(G.wi + 1); }
  } else if (G.state === 'ending') {
    G.endT -= dt;
    if (G.endT <= 0) finish(false);
  }

  G.tiles = G.tiles.filter(t => t.x > -140 && !((t.state === 'fade' && t.t > 0.35) || (t.state === 'taken' && t.t > 0.4)));
  updateFx(dt);
}

// ---------- 그리기 ----------
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
const CLOUDS = [[40, 215, 1], [210, 250, 0.8], [330, 200, 1.1], [120, 300, 0.7]];
function drawHills(color, amp, base, speedF, wl) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W + 12; x += 12) {
    const p = x + G.dist * speedF;
    const y = base - amp * (0.5 + 0.5 * Math.sin(p / wl)) - amp * 0.4 * Math.sin(p / (wl * 0.43) + 1.3);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W + 12, H); ctx.closePath(); ctx.fill();
}
function drawScene() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  if (G.bossMode) { g.addColorStop(0, '#2b3a7a'); g.addColorStop(0.6, '#e98a6b'); g.addColorStop(1, '#ffd08a'); }
  else { g.addColorStop(0, '#8fd3f4'); g.addColorStop(1, '#eaf6f0'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = G.bossMode ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.85)';
  for (const c of CLOUDS) {
    const x = ((c[0] - G.dist * 0.12) % (W + 140) + (W + 140)) % (W + 140) - 70, y = c[1], s = c[2];
    ctx.beginPath();
    ctx.ellipse(x, y, 34 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 20 * s, y + 4 * s, 22 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 22 * s, y + 5 * s, 24 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawHills(G.bossMode ? '#7a6f9b' : '#bde7cf', 46, GROUND - 40, 0.22, 70);
  drawHills(G.bossMode ? '#5a5483' : '#8fd1b0', 36, GROUND - 6, 0.45, 52);
  ctx.fillStyle = INK; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = '#3a4c8f'; ctx.fillRect(0, GROUND, W, 8);
  ctx.fillStyle = '#f7e9b7';
  const off = (G.dist % 64);
  for (let x = -off; x < W; x += 64) ctx.fillRect(x, GROUND + 46, 34, 5);
  ctx.fillStyle = 'rgba(247,233,183,.35)';
  const off2 = (G.dist * 1.4 % 90);
  for (let x = -off2; x < W; x += 90) ctx.fillRect(x, GROUND + 92, 20, 4);
}
function drawHeartItem(t) {
  let a = 1, sc = 1;
  if (t.state === 'fade') { a = 1 - t.t / 0.3; sc = 1 - 0.2 * Math.min(1, t.t / 0.3); }
  else if (t.state === 'taken') { a = 1 - t.t / 0.35; sc = 1 + 0.7 * Math.min(1, t.t / 0.35); }
  if (a <= 0) return;
  const bob = t.state === 'live' ? Math.sin(G.time * 5 + t.x * 0.02) * 4 : 0;
  if (t.state === 'live') {
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(t.x, GROUND + 10, 20, 6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a, t.age / 0.2));
  ctx.translate(t.x, TILE_Y + bob); ctx.scale(sc * (1 + 0.06 * Math.sin(G.time * 8)), sc * (1 + 0.06 * Math.sin(G.time * 8)));
  ctx.shadowColor = '#ff4d5e'; ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.bezierCurveTo(-40, -6, -22, -34, 0, -15);
  ctx.bezierCurveTo(22, -34, 40, -6, 0, 20);
  ctx.closePath();
  ctx.fillStyle = '#ff4d5e'; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.beginPath(); ctx.ellipse(-11, -9, 5, 3, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawTile(t) {
  if (t.kind === 'heart') { drawHeartItem(t); return; }
  const h = TILE_H;
  let a = 1, sc = 1;
  if (t.state === 'fade') { a = 1 - t.t / 0.3; sc = 1 - 0.2 * Math.min(1, t.t / 0.3); }
  else if (t.state === 'taken') { a = 1 - t.t / 0.35; sc = 1 + 0.5 * Math.min(1, t.t / 0.35); }
  if (a <= 0) return;
  const bob = t.state === 'live' ? Math.sin(G.time * 4 + t.x * 0.02) * 3 : 0;
  const ty = t.high ? HIGH_Y : TILE_Y;
  if (t.state === 'live' || t.state === 'hint') {
    ctx.fillStyle = t.high ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(t.x, GROUND + 10, t.w * 0.38, 6, 0, 0, Math.PI * 2); ctx.fill();
  }
  const w = t.w;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a, t.age / 0.2));
  ctx.translate(t.x, ty + bob); ctx.scale(sc, sc);
  if (t.state === 'hint') { ctx.shadowColor = GOOD; ctx.shadowBlur = 20; }
  if (t.high) {   // 2단 점프 칸 표시: 위쪽 삼각형(도형)
    ctx.fillStyle = GOLD; ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, -h / 2 - 17); ctx.lineTo(-9, -h / 2 - 4); ctx.lineTo(9, -h / 2 - 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = INK; rr(-w / 2, -h / 2 + 5, w, h, 14); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = t.color; rr(-w / 2, -h / 2, w, h, 14); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.4)'; rr(-w / 2 + 6, -h / 2 + 5, w - 12, 9, 4); ctx.fill();
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = t.chunk ? (t.text.length === 2 ? 34 : t.text.length === 3 ? 30 : 26) : 38;
  ctx.font = '700 ' + fs + 'px ' + FL;
  ctx.fillText(t.text, 0, 3);
  if (t.chunk) {
    ctx.fillStyle = GOLD; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    const cx = w / 2 - 4, cy = -h / 2 + 3;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 4.5 : 10, ang = -Math.PI / 2 + i * Math.PI / 5;
      const px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (t.state === 'hint') {
    ctx.strokeStyle = GOOD; ctx.lineWidth = 5; rr(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 16); ctx.stroke();
  }
  if (t.state === 'taken' && !t.ok) { ctx.fillStyle = 'rgba(232,69,79,.45)'; rr(-w / 2, -h / 2, w, h, 14); ctx.fill(); }
  ctx.restore();
}
function drawRunnerShape(h) {   // 기존 도형 캐릭터(스프라이트를 못 불렀을 때의 대체 그림)
  const air = h > 1;
  const cx = RUNNER_X, cy = GROUND - 27 - h;
  const sx = (G.shake > 0 && !reduce) ? (Math.random() - 0.5) * 6 : 0;
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(cx, GROUND + 10, 22 * (1 - h / 260), 6 * (1 - h / 320), 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx + sx, cy);
  let scx = 1, scy = 1;
  if (air) { scx = 0.94; scy = 1.08; } else if (G.land > 0) { scx = 1.1; scy = 0.9; }
  if (G.state === 'ending') ctx.rotate(0.25);
  ctx.scale(scx, scy);
  if (G.hurt > 0 && Math.floor(G.time * 20) % 2 === 0) ctx.globalAlpha = 0.55;
  // legs
  ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.lineCap = 'round';
  const ph = G.dist * 0.12;
  for (const side of [-1, 1]) {
    const lx = side * 8;
    let ex = lx, ey = 28;
    if (air) { ex = lx + side * 5; ey = 22; }
    else { const s = Math.sin(ph + (side > 0 ? Math.PI : 0)); ex = lx + s * 7; ey = 28 - Math.max(0, s) * 5; }
    ctx.beginPath(); ctx.moveTo(lx, 16); ctx.lineTo(ex, ey); ctx.stroke();
  }
  // sprout
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(0, -23); ctx.lineTo(0, -32); ctx.stroke();
  ctx.fillStyle = '#5bc47e'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(-7, -34, 8, 4.5, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(7, -36, 8, 4.5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // body
  ctx.fillStyle = CORAL; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.ellipse(0, 0, 22, 25, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd9c9';
  ctx.beginPath(); ctx.ellipse(0, 8, 13, 13, 0, 0, Math.PI * 2); ctx.fill();
  // face
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 3;
  if (G.hurt > 0 || G.state === 'ending') {
    for (const side of [-1, 1]) {
      const ex = side * 8;
      ctx.beginPath(); ctx.moveTo(ex - 3.5, -9); ctx.lineTo(ex + 3.5, -3); ctx.moveTo(ex + 3.5, -9); ctx.lineTo(ex - 3.5, -3); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 8, 5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  } else {
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.arc(side * 8, -6, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(side * 8 + 1.4, -7.4, 1.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = INK;
    }
    ctx.fillStyle = 'rgba(255,107,90,.0)';
    if (G.eat > 0) { ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(0, 6, 6, 5, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 3, 5, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); }
  }
  ctx.restore();
}
// 펭귄 스프라이트: 발바닥이 땅 선(GROUND)에 닿고 점프 중에는 airHeight 를 따라 오른다. 판정·충돌 위치는 그대로(그림만 교체). 피격 깜빡임·흔들림·게임 오버 기울임은 기존 효과를 그대로 쓴다.
function drawStar(x, y, r, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#fff6b0'; ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.35 : r, ang = -Math.PI / 2 + i * Math.PI / 4; const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}
function drawRunner() {
  const h = curH();
  if (!penguinReady()) { drawRunnerShape(h); return; }
  const P = PENGUIN, sz = P.size, sx = (G.shake > 0 && !reduce) ? (Math.random() - 0.5) * 6 : 0;
  const idx = penguinFrame({ state: G.state, cleared: G.cleared, air: h > 1, rising: G.rising, runPhase: G.runPhase });
  const angle = spinAngle(G.j2, G.j2Land) + (G.state === 'ending' ? 0.25 * 180 / Math.PI : 0);
  G.spriteDraws++; G.spriteFrame = idx; G.spriteAngle = angle;
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(RUNNER_X, GROUND + 10, 22 * (1 - h / 260), 6 * (1 - h / 320), 0, 0, Math.PI * 2); ctx.fill();
  const faceX = RUNNER_X + P.faceDx, footY = GROUND - h;
  const left = faceX - P.faceX * sz + sx, top = footY + P.footPad * sz - sz;
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  let scx = 1, scy = 1;
  if (h > 1) { scx = 0.97; scy = 1.04; } else if (G.land > 0) { scx = 1.08; scy = 0.92; }
  ctx.translate(faceX + sx, footY); ctx.scale(scx, scy); ctx.translate(-(faceX + sx), -footY);   // 늘이기·찌그러짐은 발바닥 기준
  if (angle) { const bx = left + 0.5 * sz, by = top + P.bodyY * sz; ctx.translate(bx, by); ctx.rotate(angle * Math.PI / 180); ctx.translate(-bx, -by); }   // 2단 점프 회전: 몸 중앙 기준
  if (G.hurt > 0 && Math.floor(G.time * 20) % 2 === 0) ctx.globalAlpha = 0.55;
  ctx.drawImage(sheet, idx * P.CELL, 0, P.CELL, P.CELL, left, top, sz, sz);
  ctx.restore();
  const sp = sparkleAlpha(G.j2);   // 2단 점프 정점 부근의 작은 반짝임
  if (sp > 0) {
    const bx = left + 0.5 * sz, by = top + P.bodyY * sz, t = G.time * 6;
    for (let i = 0; i < 4; i++) { const a = t + i * Math.PI / 2; drawStar(bx + Math.cos(a) * sz * 0.5, by + Math.sin(a) * sz * 0.42, 4 + 3 * sp, sp); }
  }
}
function drawFx() {
  for (const p of G.parts) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of G.floats) {
    ctx.globalAlpha = Math.min(1, f.life * 1.6);
    ctx.font = '700 ' + f.size + 'px ' + FL;
    ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}
function draw() {
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (G.shake > 0 && !reduce) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
  drawScene();
  for (const t of G.tiles) drawTile(t);
  drawRunner();
  drawFx();
  ctx.restore();
  if (G.hurt > 0) {
    ctx.fillStyle = 'rgba(232,69,79,' + (0.22 * G.hurt / 0.5) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------- 단어장 데이터 ----------
const WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;   // 공백 없는 한 단어(알파벳·아포스트로피·하이픈)
function meaningOf(data) {
  const d = data && typeof data === 'object' ? data : null;
  if (!d) return '';
  const sm = typeof d.short_meaning === 'string' ? d.short_meaning.trim() : '';
  if (sm) return L.keywords(sm, 40);   // 쉼표 나열은 항목 단위로만 줄인다(문장 중간을 자르지 않는다)
  const m0 = Array.isArray(d.meanings) && d.meanings[0] ? d.meanings[0].definition : '';
  return typeof m0 === 'string' ? L.keywords(m0, 40) : '';
}
// 선택한 id의 행만 골라 출제 단어로 만든다. 영어가 아니거나 구절·특수문자거나 한 글자거나 뜻이 없으면 제외 개수에 센다. 소문자 기준 중복은 조용히 하나만 남긴다.
function pickWords(rows, ids) {
  const want = new Set(ids), seen = new Set(), words = [];
  let excluded = 0;
  for (const r of rows) {
    if (!r || !want.has(Number(r.id))) continue;
    const word = String(r.word == null ? '' : r.word).trim();
    const meaning = meaningOf(r.data);
    if (r.lang !== 'en' || word.length < 2 || !WORD_RE.test(word) || !meaning) { excluded++; continue; }
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hp = buildHint(r, key, meaning);   // 단어장에 저장된 값만 쓴다(AI 호출 없음). 힌트의 모든 문자열에서 정답 단어와 활용형은 ＿＿ 로 가린다
    words.push({ id: r.id, word: key, meaning: meaning, hint: hp.hint, pop: hp.pop });
  }
  return { words: words, excluded: excluded };
}
function readIds() {
  try {
    const arr = JSON.parse(sessionStorage.getItem(IDS_KEY) || 'null');
    if (!Array.isArray(arr)) return null;
    const ids = arr.map(Number).filter(Number.isFinite);
    return ids.length ? ids : null;
  } catch (e) { return null; }
}

// ---------- 시작 전 확인(로그인·권한·선택 단어) ----------
const MIN_WORDS = 3;
function showGate(msg, linkText, href) {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gateMsg').textContent = msg;
  const a = $('gateLink');
  a.hidden = !linkText;
  if (linkText) { a.textContent = linkText; a.href = href; }
}
function hasToken() { try { return !!localStorage.getItem('mydict_token'); } catch (e) { return false; } }
function showGame(words, excluded) {
  VALID_WORDS = words;
  $('gate').hidden = true;
  $('app').hidden = false;
  resize();
  const shape = L.roundShape(words.length);
  els.startInfo.textContent = '이번 판 ' + shape.regular + '단어' + (shape.bosses ? ' + 보스 ' + shape.bosses + '단어' : '') + ' · 체력 ' + CONFIG.HP;
  els.startExcluded.hidden = excluded === 0;
  els.startExcluded.textContent = excluded + '개 제외(구절·특수문자)';
  els.speechNote.hidden = hasSpeech();
  els.djRule.hidden = !CONFIG.DJ_ENABLED;
  els.tune.hidden = !OPT.applied.length;
  els.tune.title = OPT.applied.length ? OPT.applied.join(', ') + ' (누르면 저장값을 지우고 기본값으로)' : '';
  els.tune.addEventListener('click', () => {   // 저장값을 지우고 옵션 없이 다시 연다
    try { localStorage.removeItem(L.OPTION_KEY); } catch (e) { /* 무시 */ }
    location.replace(location.pathname + '?reset=1');
  });
  els.startBtn.disabled = false;
  requestAnimationFrame(frame);
}
async function boot() {
  const LOGIN = ['로그인하기', '/auth/google?next=/spelling_run.html'];
  if (!hasToken()) { showGate('로그인이 필요합니다.', LOGIN[0], LOGIN[1]); return; }
  let me = null;
  try {
    const r = await fetch('/api/me', { headers: authHeaders() });
    if (r.status === 401) { showGate('로그인이 만료되었습니다. 다시 로그인해 주세요.', LOGIN[0], LOGIN[1]); return; }
    if (!r.ok) throw new Error('me ' + r.status);
    me = await r.json();
  } catch (e) { showGate('권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
  // 권한은 fail-closed: 단어장 권한이 명시적으로 true일 때만 연다(서버도 /api/wordbook에서 다시 검사한다)
  if (!me || me.is_blocked || me.can_wordbook !== true) { showGate('단어장 사용 권한이 없어 게임을 시작할 수 없습니다. 관리자에게 문의해 주세요.'); return; }
  const ids = readIds();
  if (!ids) { showGate('단어장에서 단어를 골라 게임을 시작해 주세요.', '단어장으로', '/english_dictionary.html#wordbook'); return; }
  let rows;
  try {
    const r = await fetch('/api/wordbook', { headers: authHeaders() });
    if (r.status === 403) { showGate('단어장 사용 권한이 없어 게임을 시작할 수 없습니다. 관리자에게 문의해 주세요.'); return; }
    if (!r.ok) throw new Error('wordbook ' + r.status);
    rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('wordbook 형식');
  } catch (e) { showGate('단어장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', '단어장으로', '/english_dictionary.html#wordbook'); return; }
  const picked = pickWords(rows, ids);
  if (picked.words.length < MIN_WORDS) {
    showGate('출제할 수 있는 영어 단어가 ' + picked.words.length + '개입니다. ' + MIN_WORDS + '개 이상 필요합니다.' + (picked.excluded ? ' (' + picked.excluded + '개 제외: 구절·특수문자·뜻 없음 등)' : ''), '단어장으로', '/english_dictionary.html#wordbook');
    return;
  }
  showGame(picked.words, picked.excluded);
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (!API.manual) step(dt);   // 테스트는 manual=true로 두고 step()을 직접 부른다
  draw();
  requestAnimationFrame(frame);
}

// 테스트 훅(시제품과 같은 이름). manual=true이면 화면 갱신 루프가 step()을 부르지 않는다.
const API = { CONFIG: CONFIG, G: G, step: step, draw: draw, jump: jump, startRound: startRound, missedSet: missedSet, RUNNER_X: RUNNER_X, manual: false, lastTtsError: null, pronounce: pronounce, pickWords: pickWords, penguin: () => ({ ready: penguinReady(), draws: G.spriteDraws, frame: G.spriteFrame, angle: G.spriteAngle, phase: G.runPhase }), curH: curH, OPT: OPT, fitAll: fitAll, HIGH_Y: HIGH_Y, TILE_Y: TILE_Y };
window.SpellRun = API;
boot();
})();
