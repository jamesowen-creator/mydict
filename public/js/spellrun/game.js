// 스펠링 런: 캔버스·HUD·입력·소리·발음·데이터 불러오기. 순수 로직은 logic.js(SpellRunLogic)에 있다.
// 시제품(spelling-run-prototype.html)의 화면 코드를 옮긴 것이고, 단어 목록은 단어장(/api/wordbook)에서 받은 영어 단어로 채운다.
// 발음은 서버 TTS(/api/tts, Authorization 헤더 포함)를 먼저 쓰고, 실패하면 브라우저 내장 음성(speechSynthesis)으로 대신한다.
(function () {
'use strict';

const L = window.SpellRunLogic;
// 작업319: 옵션은 기기(localStorage)에 저장해 사전에서 시작해도 이어진다. 주소 값이 저장값보다 우선, ?reset=1 이면 삭제. 저장소를 못 쓰면 이번 방문에만 적용
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const OPT = L.resolveOptions(location.search, lsGet(L.OPTION_KEY));
try { if (OPT.reset) { localStorage.removeItem(L.OPTION_KEY); localStorage.removeItem('spellrun_mode'); } else if (OPT.save) localStorage.setItem(L.OPTION_KEY, JSON.stringify(OPT.save)); } catch (e) { /* 저장 실패는 무시 */ }

// 작업332: 모드(기본 / 생존). 사용자의 선택이라 'spellrun_opts' 의 조정값과 따로 기억하고 "조정값 사용 중" 표시 대상이 아니다. 주소 survival=1|0 이 저장값보다 우선한다.
const MODE_KEY = 'spellrun_mode';
let survMode = lsGet(MODE_KEY) === 'survival';
try { const q = new URLSearchParams(location.search).get('survival'); if (q === '1') survMode = true; else if (q === '0') survMode = false; } catch (e) { /* 주소를 못 읽으면 저장값 */ }
// 작업345: 시작 전 단어 미리 보기. 기본 켜짐. 사용자의 선택이라 모드처럼 'spellrun_preview' 에 따로 저장하고 "조정값 사용 중" 표시 대상이 아니다. 주소 preview=1|0 이 저장값보다 우선한다(저장하지는 않는다).
const PREVIEW_KEY = 'spellrun_preview';
let previewOn = lsGet(PREVIEW_KEY) !== '0';
try { const q = new URLSearchParams(location.search).get('preview'); if (q === '1') previewOn = true; else if (q === '0') previewOn = false; } catch (e) { /* 주소를 못 읽으면 저장값 */ }
L.configure(OPT.values);                       // CONFIG 를 한 번에 다시 만든다(pace 는 속도·간격·점프 시간에 같은 비율로 반영)
const CONFIG = L.CONFIG;
// 작업355: 화면 모드(세로 'port' | 가로 'land'). 마지막 선택은 localStorage, 주소 옵션 mode(0|1)가 이긴다(조정값에 넣지 않고 저장하지도 않는다). 진입 방식 stream 은 직접 준 값이 있으면 그것이 우선, 없으면 가로=edge·세로=classic
const VIEW_KEY = 'spellrun_view';
let viewMode = lsGet(VIEW_KEY) === 'land' ? 'land' : 'port';
try { const q = new URLSearchParams(location.search).get('mode'); if (q === '1') viewMode = 'land'; else if (q === '0') viewMode = 'port'; } catch (e) { /* 주소를 못 읽으면 저장값 */ }
const streamPinned = OPT.values.stream !== undefined;
const syncStream = () => { if (!streamPinned) CONFIG.STREAM_EDGE = viewMode === 'land'; };
syncStream();
const { survHeartWord, survHeartSlot, survRampCfg, makeSurvSupply, runState, contHp, planRescue, heartEffect, planSpeedItem, boostTarget, boostWordBonus, OBSTACLE_ART, obstacleArtIndex, obstacleArtRect, obstacleLayout, obstacleOverlaps, obstacleHit, planObstacle, afterObstacleHit, PENGUIN, advanceRunPhase, penguinFrame, spinAngle, sparkleAlpha, introTimeline, introState, planSlots, makeCandidates, slotPoints, speedMult, gapSec, leadSec, speedAfterHit, speedAfterFail, targetSpeed, planHearts, pickHeartSlot, airHeight, secondJumpLandTime, planHighSlots, fitWord, buildHint, judge, bossConfig, planRound, letterCount, CHARS, BG_ART, ITEM_ART, BALLOON_ART, balloonColor, balloonPhase, balloonMotion, balloonStretch, balloonRise, balloonRiseY, CHAR_FX, charSquash, runBob, charShadow, wrongFx, rightHop, starFx, reactNext, reactKind } = L;
const LAYOUT = Object.assign({}, L.LAYOUT);   // 작업355: 화면 모드·크기에 따라 값이 바뀌는 사본(logic.js 의 LAYOUT 은 세로 640 기준값 그대로)

let W = LAYOUT.W, H = LAYOUT.H, GROUND = LAYOUT.GROUND, TILE_Y = LAYOUT.TILE_Y, TILE_H = LAYOUT.TILE_H, HIGH_Y = LAYOUT.HIGH_TILE_Y;   // 작업355: applyLayout 이 화면 모드·크기에 맞게 바꾼다
const RUNNER_X = 72;
const FALL_SEC = 0.55, STUMBLE_SEC = 0.5, FALL_DEPTH = 46;   // 작업326: 연출 시간(초)·구덩이에 빠지는 깊이(논리 px)
const INK = '#1d2b53', CORAL = '#ff6b5a', GOLD = '#ffb700', GOOD = '#1fae68', BAD = '#e8454f';
const TILE_COLORS = ['#ffd25e', '#ff9fb2', '#7ed9c3', '#a8c0ff'];
const FL = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';   // 앱의 기존 글꼴 스택(tokens.css --font-sans). 시제품의 Fredoka는 쓰지 않는다
const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

const IDS_KEY = 'spellrun_ids';       // 사전 단어장이 넣어 준 선택 단어 id 배열(sessionStorage)
const TTS_TIMEOUT_MS = 8000;          // 서버 발음 응답을 기다리는 최대 시간. 넘으면 그 호출을 내장 음성으로 대신한다(작업325)
let ttsTimeoutMs = TTS_TIMEOUT_MS;   // 시험용 훅(API.setTtsTimeout)으로만 바뀐다
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
  bossBanner: $('bossBanner'), bossSub: $('bossSub'), cont: $('cont'), contBtn: $('contBtn'), endBtn: $('endBtn')
};
const sndBtns = [$('snd'), $('sndStart')];
const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---------- 작업321: 펭귄 스프라이트 시트(미리 불러오기). 로딩 전·실패 시에는 기존 도형 캐릭터로 그린다(게임 시작을 막지 않는다) ----------
// 작업358: 캐릭터 3종(펭귄·여학생·남학생). 고른 캐릭터의 시트를 못 읽으면 펭귄, 펭귄도 못 읽으면 기존 도형 캐릭터로 그린다
const charSheets = {};
function loadChar(key) {
  if (charSheets[key] || !CHARS[key]) return;
  const P = CHARS[key], im = new Image(), st = { img: im, ok: false };
  im.onload = () => { st.ok = im.naturalWidth === P.SHEET_W && im.naturalHeight === P.SHEET_H; };
  im.onerror = () => { st.ok = false; };
  charSheets[key] = st;
  try { im.src = P.URL; } catch (e) { st.ok = false; }
}
const charReady = key => { const st = charSheets[key]; return !!st && st.ok && st.img.complete; };
let charKey = L.charFromStored(lsGet('spellrun_char'));
try { const q = L.charFromOption(new URLSearchParams(location.search).get('char')); if (q) charKey = q; } catch (e) { /* 주소를 못 읽으면 저장값 */ }
loadChar('penguin'); loadChar(charKey);
const activeChar = () => (charReady(charKey) ? charKey : (charReady('penguin') ? 'penguin' : null));
const penguinReady = () => activeChar() !== null;
// 작업327: 장애물 시트(시작할 때 미리 불러온다). 크기가 다르거나 실패하면 기존 코드 그림(상자)으로 그린다. 불러온 뒤 알파로 칸마다 물체의 실제 크기를 재서 쓴다(못 재면 logic.js 의 추정값)
const obstSheet = new Image();
let obstSheetOK = false, obstObjs = OBSTACLE_ART.OBJECTS.map(o => Object.assign({}, o));
obstSheet.onload = () => {
  obstSheetOK = obstSheet.naturalWidth === OBSTACLE_ART.SHEET_W && obstSheet.naturalHeight === OBSTACLE_ART.SHEET_H;
  if (!obstSheetOK) return;
  try {
    const c = document.createElement('canvas'); c.width = OBSTACLE_ART.SHEET_W; c.height = OBSTACLE_ART.SHEET_H;
    const cx = c.getContext('2d'); cx.drawImage(obstSheet, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data, CELL = OBSTACLE_ART.CELL, B = OBSTACLE_ART.BORDER, m = [];
    for (let k = 0; k < obstObjs.length; k++) {
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (d[(y * c.width + k * CELL + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) throw new Error('빈 칸');
      m.push({ name: obstObjs[k].name, w: x1 - x0 + 1 - 2 * B, h: y1 - y0 + 1 - 2 * B, foot: y1 + 1 - B });
    }
    if (m.every(o => o.w > 20 && o.h > 20)) obstObjs = m;
  } catch (e) { /* 재지 못하면 추정값 그대로 */ }
};
obstSheet.onerror = () => { obstSheetOK = false; };
try { obstSheet.src = OBSTACLE_ART.URL; } catch (e) { obstSheetOK = false; }
const obstArtReady = () => obstSheetOK && obstSheet.complete;

// ---------- 작업358: 배경·아이템 그림(미리 불러오기). 못 읽으면 각각 기존 그림(코드 그라데이션·언덕·타원 구름·도형 아이템)으로 그린다 ----------
const bgArt = {};
function loadBg(key, spec) {
  const im = new Image(), st = { img: im, ok: false, spec: spec, cv: null, cvKey: '' };
  im.onload = () => { st.ok = im.naturalWidth === spec.W && im.naturalHeight === spec.H; };
  im.onerror = () => { st.ok = false; };
  bgArt[key] = st;
  try { im.src = spec.URL; } catch (e) { st.ok = false; }
}
Object.keys(BG_ART.LAYERS).forEach(k => loadBg(k, BG_ART.LAYERS[k]));
loadBg('sky', BG_ART.SKY); loadBg('clouds', BG_ART.CLOUDS);
const bgOK = key => { const st = bgArt[key]; return !!st && st.ok && st.img.complete; };
const itemArt = new Image();
let itemArtOK = false;
itemArt.onload = () => { itemArtOK = itemArt.naturalWidth === ITEM_ART.SHEET_W && itemArt.naturalHeight === ITEM_ART.SHEET_H; };
itemArt.onerror = () => { itemArtOK = false; };
try { itemArt.src = ITEM_ART.URL; } catch (e) { itemArtOK = false; }
const itemArtReady = () => itemArtOK && itemArt.complete;
// 작업361: 가로 풍선 시트(못 읽으면 기존 타일 모양으로 그린다)
const balloonImg = new Image();
let balloonOK = false;
balloonImg.onload = () => { balloonOK = balloonImg.naturalWidth === BALLOON_ART.SHEET_W && balloonImg.naturalHeight === BALLOON_ART.SHEET_H; };
balloonImg.onerror = () => { balloonOK = false; };
try { balloonImg.src = BALLOON_ART.URL; } catch (e) { balloonOK = false; }
const balloonReady = () => balloonOK && balloonImg.complete;

let VALID_WORDS = [];                  // [{ id, word(소문자), meaning }] 단어장에서 고른 영어 단어
const missedSet = new Set();           // 틀린 단어(소문자). 서버에 저장하지 않고 이 페이지 메모리에만 둔다

// ---------- 크기 맞춤 ----------
// 작업355: 게임 판은 화면 전체(안전 여백 안)를 채운다. 세로는 폭 360 고정·높이 가변(최소 640), 가로는 800x400. 배율 = 판 전체 확대·축소(상한 1.5). 크기 계산은 logic.js layoutFor
let S = 1, curScale = 1;
const safeProbe = document.createElement('div');
safeProbe.setAttribute('aria-hidden', 'true');
safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
document.body.appendChild(safeProbe);
function safeInsets() { const cs = getComputedStyle(safeProbe), f = k => parseFloat(cs[k]) || 0; return { t: f('paddingTop'), r: f('paddingRight'), b: f('paddingBottom'), l: f('paddingLeft') }; }
function viewSize() { const vv = window.visualViewport; return { w: Math.round((vv && vv.width) || window.innerWidth), h: Math.round((vv && vv.height) || window.innerHeight) }; }
const deviceLandscape = () => window.innerWidth > window.innerHeight;
function applyLayout(lo) {
  Object.assign(LAYOUT, lo);
  W = LAYOUT.W; H = LAYOUT.H; GROUND = LAYOUT.GROUND; TILE_Y = LAYOUT.TILE_Y; TILE_H = LAYOUT.TILE_H; HIGH_Y = LAYOUT.HIGH_TILE_Y;
  box.style.setProperty('--hs', LAYOUT.HUD_SHIFT);
  box.classList.toggle('land', lo.mode === 'land');
  streamViewW = W;   // edge 진입 지점 = 판 폭 + 타일 반폭
}
function resize() {
  if ($('app').hidden) return;   // 아직 보이지 않는 상태
  const v = viewSize(), ins = safeInsets();
  const aw = v.w - ins.l - ins.r, ah = v.h - ins.t - ins.b;
  if (aw <= 0 || ah <= 0) return;
  const lo = L.layoutFor(viewMode, aw, ah), scale = lo.scale;
  applyLayout(lo);
  curScale = scale;
  box.style.width = Math.round(W * scale) + 'px';
  box.style.height = Math.round(H * scale) + 'px';
  box.style.setProperty('--u', scale + 'px');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * scale * dpr);
  cv.height = Math.round(H * scale * dpr);
  S = cv.width / W;
  if (typeof syncRot === 'function') syncRot();
  fitAll();   // 폭이 바뀌면(리사이즈·회전) 글자 맞춤을 다시 계산한다
}
window.addEventListener('resize', resize);
try { if (window.visualViewport) window.visualViewport.addEventListener('resize', resize); } catch (e) { /* 지원 안 함 */ }   // 작업355: Safari 주소창이 나타나고 사라질 때
try { window.addEventListener('orientationchange', () => setTimeout(resize, 120)); } catch (e) { /* 무시 */ }
try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (typeof fitAll === 'function') fitAll(); }); } catch (e) { /* 글꼴 이벤트가 없으면 무시 */ }   // 웹 글꼴이 늦게 로드돼 폭이 바뀌면 글자 맞춤을 다시 계산한다

// ---------- 작업318-1: 폭을 재서 맞추는 글자 크기 ----------
// 단계로 줄이지 않고 실제 폭을 재서 한 줄(또는 허용 줄 수)에 들어올 때까지 0.5px 씩 줄인다. 크기는 논리 px(×--u)라 화면 배율과 무관하게 같은 결과가 나온다.
function lineHeightPx(el) { const cs = getComputedStyle(el); return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25; }
function fitsIn(el, lines) { return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= lineHeightPx(el) * lines + (LAYOUT.FIT_PAD || 2); }   // 작업356: 가로는 한글 글자가 줄 높이를 조금 넘는 것을 더 허용해 뜻을 더 크게(세로는 이전과 같은 2)
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
  const bottom = () => (Math.max(els.word.getBoundingClientRect().bottom, els.hintbox.getBoundingClientRect().bottom) - box.getBoundingClientRect().top) / unitPx();   // 작업356: 가로는 뜻 묶음과 글자 칸이 나란해서 둘 중 더 아래 끝
  for (let n = items.length; n > 0; n--) {
    els.sub.textContent = items.slice(0, n).join(' · ');
    fitFont(els.sub, LAYOUT.SUB_MAX || 12, 10, px => (px > 10.5 ? 1 : 2));
    if (fitsIn(els.sub, 2) && bottom() <= limit) return;
  }
  els.sub.hidden = true; els.sub.textContent = '';
}
function fitHud() {
  if (els.hud.hidden || !G.plan) return;
  fitFont(els.meaning, LAYOUT.MEAN_MAX || 28, 14, px => (px > 22 ? 1 : 2));   // 한 줄을 먼저 시도하고, 22 이하부터 두 줄까지 허용
  const h = (G.words[G.wi] && G.words[G.wi].hint) || {};
  fitSub(h.subs || []);
}
function fitPop() {
  if (els.pop.hidden) return;
  fitFont(els.popWord, LAYOUT.POPW_MAX || 44, 16, () => 1);   // 완성한 단어는 반드시 한 줄
  fitFont(els.popMean, LAYOUT.POPM_MAX || 22, 12, px => (px > 16 ? 1 : 2));
  if (!els.popEx.hidden) fitFont(els.popEx, LAYOUT.POPE_MAX || 13, 9, () => 3);
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
const audioCache = new Map();   // 단어 → 오디오 주소(Promise). 작업325: 실패한 요청은 지워 다음 호출에서 다시 시도한다(실패가 방문 동안 반복되지 않게)
const audioMeta = new Map();    // 단어 → 서버 응답 헤더 X-TTS-Cache(HIT/MISS). 점검 옵션 ttsdebug 의 출처 문구용
let serverTtsOff = false;       // 401·403·503을 받으면 이번 방문에서는 서버 발음을 더 부르지 않는다
let serverTtsStatus = 0;        // 위 상태 코드(출처 문구용)
// 작업325: 점검 옵션 ttsdebug=1 일 때만 발음 출처를 화면 한쪽에 작게 보인다. 꺼져 있으면 DOM·표시·동작은 이전과 같다.
const ttsDebug = OPT.values.ttsdebug === 1;
let ttsSrcEl = null;
function showTtsSource(label) {
  API.lastTtsSource = label;
  if (!ttsDebug) return;
  if (!ttsSrcEl) { ttsSrcEl = document.createElement('div'); ttsSrcEl.className = 'ttssrc'; ttsSrcEl.id = 'ttsSrc'; box.appendChild(ttsSrcEl); }
  ttsSrcEl.textContent = label;
}
function authHeaders() {
  let t = null; try { t = localStorage.getItem('mydict_token'); } catch (e) {}
  return t ? { Authorization: 'Bearer ' + t } : {};
}
function getServerAudio(word) {
  if (audioCache.has(word)) return audioCache.get(word);
  if (serverTtsOff) { const e = new Error('서버 발음 사용 안 함'); e.status = serverTtsStatus; return Promise.reject(e); }
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ttsTimeoutMs);
  const p = fetch('/api/tts', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify({ text: word, lang: 'en' }),
    signal: ctrl.signal
  }).then(res => {
    if (!res.ok) { if (res.status === 401 || res.status === 403 || res.status === 503) { serverTtsOff = true; serverTtsStatus = res.status; } const e = new Error('TTS ' + res.status); e.status = res.status; throw e; }
    audioMeta.set(word, (res.headers && res.headers.get('X-TTS-Cache')) || '');
    return res.blob();
  }).then(blob => {
    if (!blob.size) throw new Error('빈 오디오');
    return URL.createObjectURL(blob);
  }).catch(err => {
    if (timedOut) { const e = new Error('TTS 시간 초과'); e.code = 'timeout'; throw e; }   // 서버 응답 시간 초과(8초). 재생이 끊긴 AbortError 와 구분한다
    throw err;
  }).finally(() => clearTimeout(timer));
  p.catch(() => { if (audioCache.get(word) === p) audioCache.delete(word); });   // 실패한 요청은 캐시에서 지운다
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
      // AbortError = 다음 소리가 바로 이어 받아 재생이 끊긴 것(대체하지 않음). 그 밖의 거부(자동 재생 제한 등)는 code 'play' 로 표시해 내장 음성으로 대체한다
      if (pr && pr.then) pr.then(resolve, e => reject(e && e.name === 'AbortError' ? e : Object.assign(new Error('재생 거부: ' + ((e && e.name) || '')), { code: 'play' })));
      else resolve();
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
// onResult(ok, why, source): source 는 발음 출처 문구(예: "서버 음성(캐시 있음)", "내장 음성: 권한 없음(403)")
function pronounce(word, opts, onResult) {
  opts = opts || {};
  const slow = !!opts.slow, rate = slow ? CONFIG.FINAL_SLOW_RATE : 1;
  const report = (ok, why, src) => { if (onResult) onResult(ok, why, src); };
  if (!SND.on) { report(false, '소리 끔'); return; }
  const fallback = info => speakBuiltin(word, slow ? CONFIG.FINAL_SLOW_RATE : undefined, !!opts.queue, (ok, why) => {
    const label = L.ttsSourceLabel(ok ? Object.assign({ engine: 'builtin' }, info) : { engine: 'none' });
    showTtsSource(label); report(ok, why, label);
  });
  if (serverTtsOff && !audioCache.has(word)) { fallback({ status: serverTtsStatus }); return; }
  const fresh = !audioCache.has(word);
  getServerAudio(word).then(url => playUrl(url, rate, !!opts.queue)).then(() => {
    const label = L.ttsSourceLabel({ engine: 'server', cache: fresh ? (audioMeta.get(word) || '') : '' });   // 다시 재생하는 오디오는 캐시 여부를 말하지 않는다
    showTtsSource(label); report(true, undefined, label);
  }, err => {
    if (err && err.name === 'AbortError') { report(true); return; }   // 다음 소리가 바로 이어 받아 재생이 끊긴 것(실패 아님). 내장 음성으로 겹쳐 읽지 않는다
    API.lastTtsError = String((err && err.message) || err);   // 서버 발음 실패 이유는 테스트 훅에 남긴다
    fallback({ status: err && err.status, reason: err && err.code });
  });
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
  const m = $('srMenuSnd'); if (m) { m.textContent = SND.on ? '소리 끄기' : '소리 켜기'; m.setAttribute('aria-pressed', String(SND.on)); }   // 작업360: 가로 메뉴 항목
}
function toggleSound() {
  SND.on = !SND.on;
  if (!SND.on) stopVoices();
  syncSndButtons();
}
sndBtns.forEach(b => b.addEventListener('click', toggleSound));
syncSndButtons();

// ---------- 게임 상태 ----------
const G = {
  state: 'idle', words: [], wi: 0, plan: null, si: 0, mist: [],
  hp: 0, score: 0, combo: 0, maxCombo: 0, wordsDone: 0,
  speed: 60, speedTarget: 60, speedBase: 60, shownMult: 0, heartWords: new Set(), heartPending: false, heartSlot: 0, survival: false, supply: null, startTime: 0, speedPending: false, speedSlot: 0, rescuePending: false, rescueSlot: 0, rescueKind: 'hint', speedGroupTaken: -1, groupTakenAtLoad: -1, contUsed: false, rescue: null, angels: [], boost: 0, roundSeq: 0, boostMax: 0, speedMaxSeen: 0, lastPts: 0, lastSpeedMult: 1, dist: 0, time: 0,
  tiles: [], parts: [], floats: [], react: null, fxRight: -9, fxWrong: -9, dust: [], dustT: 0, dustN: 0,   // 작업363: 반응 상태·맞는/틀린 글자 효과 시작 시각·먼지
  packActive: false, packId: 0, spawnT: 0, bossBlend: 0, ec: null,   // 작업354: ec = edge 흐름 기록(묶음 목록·미리 정한 단어 계획). classic 에서는 쓰지 않는다
  runPhase: 0, prevH: 0, rising: true, cleared: false, spriteDraws: 0, spriteFrame: -1, spriteAngle: 0,
  iActive: false, iClock: 0, iTl: null, iGeo: null, iKids: 0, iShown: 0,
  jumpT: -1, j2: -1, j2h: 0, j2Land: 0, jumpBuf: 0, land: 0, hurt: 0, eat: 0, shake: 0, popT: 0, endT: 0,
  hintTimer: 0,
  obstacles: [], obst: null, obstSeq: 0, invuln: 0, stumble: 0, fall: 0, obstHits: 0,   // 작업326: 화면의 장애물, 이 단어의 장애물 계획, 무적 시간, 걸려 비틀거림·구덩이에 빠짐 연출 시간, 이번 판에 맞은 횟수
  regular: 0, bossMode: false, introT: 0, repeatT: 0, repeatWord: '', review: false
};
let slotEls = [];

// ---------- HUD ----------
function renderHearts() {
  els.hearts.innerHTML = Array.from({ length: CONFIG.HP }, (_, i) =>
    '<svg class="' + (i < G.hp ? '' : 'off') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + HEART + '"/></svg>').join('');
  els.hearts.setAttribute('aria-label', '체력 ' + G.hp + ' / ' + CONFIG.HP);
  vsgNudge();   // 작업347: 대결 중이면 체력 변화·이어하기를 즉시 알린다
}
function renderScore() {
  els.score.textContent = G.score.toLocaleString('en-US');
  if (G.combo >= 2) { els.combo.hidden = false; els.combo.textContent = '콤보 ' + G.combo; }
  else els.combo.hidden = true;
}
function renderProgress() {
  const w = G.words[G.wi];
  if (G.survival) { els.progress.textContent = '단어 ' + (G.wi + 1) + (w && w.boss ? ' · 보스' : ''); box.classList.toggle('boss', !!(w && w.boss)); return; }   // 작업332: 분모 없음
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
  const fit = fitWord(wordItems(), LAYOUT.WORD_AVAIL_W, { cwMax: LAYOUT.CW_MAX || 34 });
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
  for (const p of G.dust) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }   // 작업363
  G.dust = G.dust.filter(p => p.life > 0);
  for (const g of G.angels) g.t += dt;
  G.angels = G.angels.filter(g => g.t < CONFIG.ANGEL_SEC);
}

// ---------- 라운드 진행 ----------
// 한 판은 최대 10단어. 5번째·10번째(그 위치에 단어가 있을 때만) 단어가 보스이고 긴 단어부터 배정된다(planRound). 복습 판에는 보스가 없다.
// 작업332: 생존 모드(체력 0까지 계속). 복습 판은 항상 기본 구조이고, 기본 모드의 코드 경로(난수 호출 순서)는 그대로다.
const mapWord = w => Object.assign({ word: w.word, meaning: w.meaning, hint: w.hint, pop: w.pop }, w.boss ? { boss: true } : {});
function survEnsure(i) {   // 단어 i 와 그 다음 단어까지 공급해 둔다(마지막 단어 연출·보스 예고가 "다음 단어가 있는가"를 본다)
  while (G.survival && G.words.length <= i + 1) { for (const w of G.supply.nextSegment()) { G.words.push(mapWord(w)); G.mist.push(0); } }
}
// 작업345: 이번 판 단어 순서를 먼저 정한다(난수 호출 순서는 이전과 같다). 미리 보기는 이 순서 그대로 보여 주고, 시작 때 같은 결과(prepared)를 넘겨 실제 순서와 어긋나지 않게 한다
function planPool(reviewOnly) {
  const surv = !reviewOnly && (survMode || VSG.on) && VALID_WORDS.length >= CONFIG.SURV_MIN_WORDS;   // 작업347: 대결 판(VSG.on)은 생존 모드 규칙
  const plan = surv ? null : planRound(VALID_WORDS, missedSet, CONFIG, Math.random, !!reviewOnly);
  const supply = surv ? makeSurvSupply(VALID_WORDS, CONFIG, Math.random) : null;
  const pool = surv ? supply.nextSegment().map(mapWord) : plan.list.map((w, i) => Object.assign({ word: w.word, meaning: w.meaning, hint: w.hint, pop: w.pop }, plan.bossIdx.indexOf(i) >= 0 ? { boss: true } : {}));
  return { surv: surv, supply: supply, pool: pool, regular: surv ? 0 : plan.regular };
}
function startRound(reviewOnly, prepared) {
  closeMenu();   // 작업360
  const P = prepared || planPool(reviewOnly);
  const surv = P.surv, supply = P.supply, pool = P.pool, regular = P.regular;
  if (!pool.length) return;
  primeAudio();
  els.bossBanner.hidden = true;
  Object.assign(G, {
    regular: regular, bossMode: false, introT: 0, repeatT: 0, repeatWord: '',
    state: 'run', words: pool, wi: 0, mist: pool.map(() => 0),
    hp: CONFIG.HP, score: 0, combo: 0, maxCombo: 0, wordsDone: 0,
    roundSeq: G.roundSeq + 1, boost: 0, speedPending: false, speedMaxSeen: 0, rescuePending: false, speedGroupTaken: -1, groupTakenAtLoad: -1, contUsed: false, rescue: null, angels: [],
    speed: CONFIG.SPEED_MIN, speedTarget: CONFIG.SPEED_MIN, speedBase: CONFIG.SPEED_MIN, shownMult: 0, heartWords: surv ? new Set() : planHearts(regular), tiles: [], parts: [], floats: [], react: null, fxRight: -9, fxWrong: -9, dust: [], dustT: 0, dustN: 0,
    bossBlend: 0, ec: { packs: [], wps: {} }, packActive: false, jumpT: -1, j2: -1, j2h: 0, jumpBuf: 0, land: 0, hurt: 0, eat: 0, shake: 0, popT: 0, endT: 0,
    obstacles: [], obst: null, obstSeq: 0, invuln: 0, stumble: 0, fall: 0, obstHits: 0,
    review: !!reviewOnly, survival: surv, supply: supply, startTime: G.time
  });
  els.start.hidden = true; els.result.hidden = true; els.pop.hidden = true; els.hud.hidden = false;
  renderHearts(); renderScore();
  loadWord(0);
}
// 작업354: loadWord 를 "계획(planWord, 상태를 바꾸지 않음)"과 "적용(applyWord)"으로 나눴다. classic 은 둘을 바로 이어 불러 이전과 같은 결과(난수 호출 순서 포함)다.
// edge 는 다음 단어를 앞 단어 마지막 묶음이 줄에 들어갈 때 미리 계획해 둔다. groupIn: 이 단어를 계획하기 직전의 번개 그룹 기록(speedGroupTaken)
function planWord(i, groupIn) {
  survEnsure(i);
  const boss = !!G.words[i].boss;
  const wp = { i: i, boss: boss };
  wp.plan = planSlots(G.words[i].word, Math.random, boss ? bossConfig() : CONFIG, G.words[i].syl);
  const survCfg = G.survival ? survRampCfg(CONFIG, i + 1) : CONFIG;   // 작업332: 생존 모드는 단어 순번에 따라 장애물·높은 칸 확률이 오른다(기본 모드는 CONFIG 그대로)
  const reg0 = G.words.slice(0, i).filter(x => !x.boss).length;
  wp.heartPending = G.survival ? (!boss && survHeartWord(reg0, G.roundSeq)) : (!boss && G.heartWords.has(reg0));   // 하트 계획은 보스가 아닌 단어의 순번 기준(생존 모드는 난수 없이 해시, 간격이 점점 늘어난다)
  wp.heartSlot = G.survival ? survHeartSlot(wp.plan.slots.length, G.roundSeq, reg0) : pickHeartSlot(wp.plan.slots.length);
  const highs = G.survival ? planHighSlots(wp.plan.slots.length, Math.random, survCfg) : planHighSlots(wp.plan.slots.length);   // 작업318-4: 2단 점프가 꺼져 있으면 빈 집합
  wp.plan.slots.forEach((sl, k) => { sl.high = highs.has(k); });
  const ob = G.survival ? planObstacle(wp.plan.slots.length, highs, wp.heartPending ? wp.heartSlot : null, boss, Math.random, survCfg) : planObstacle(wp.plan.slots.length, highs, wp.heartPending ? wp.heartSlot : null, boss);   // 작업326: 꺼져 있거나 보스면 null(난수를 쓰지 않는다)
  wp.obst = ob ? { slot: ob.slot, kind: ob.kind, done: false } : null;
  // 작업328: 가속 아이템(난수 없이 판 순번·단어 순번 해시로 결정. 하트 우선, 보스·복습·장애물 단어에는 없음)
  const regIdx = reg0;
  // 작업329: 구조 아이템(힌트·천사)은 체력이 낮을 때만. 우선순위 하트 > 구조 > 가속이라 구조가 정해지면 가속은 이 단어에 없다. 이 단어의 체력은 단어를 계획할 때 정한다(회복해서 기준을 넘으면 다음 단어부터 없다)
  const rs = planRescue({ roundSeq: G.roundSeq, regularIdx: regIdx, hp: G.hp, boss: boss, review: G.review, hasHeart: wp.heartPending, hasObst: !!wp.obst, nSlots: wp.plan.slots.length, });
  wp.rescuePending = !!rs; wp.rs = rs;
  wp.groupBefore = groupIn;   // 작업341: 이어하기로 이 단어를 다시 시작할 때 번개 계획을 같은 모양으로 되돌린다
  const sIdx = planSpeedItem({ roundSeq: G.roundSeq, regularIdx: regIdx, boss: boss, review: G.review, hasHeart: wp.heartPending || !!rs, hasObst: !!wp.obst, nSlots: wp.plan.slots.length,
    groupTaken: groupIn, isHeartAt: G.survival ? (j => survHeartWord(j, G.roundSeq)) : (j => G.heartWords.has(j)), regularCount: G.survival ? undefined : G.regular });   // 작업339: 제외 대상이면 같은 그룹의 다음 후보로
  wp.groupAfter = sIdx !== null ? Math.floor(regIdx / CONFIG.SPEED_EVERY) : groupIn;
  wp.speedPending = sIdx !== null; wp.speedSlot = sIdx === null ? 0 : sIdx;
  return wp;
}
function applyWord(wp) {
  const i = wp.i;
  G.wi = i; G.plan = wp.plan; G.si = 0;
  G.bossMode = wp.boss;   // 중간에 오는 보스 뒤에는 일반 배경으로 돌아간다
  G.heartPending = wp.heartPending; G.heartSlot = wp.heartSlot;
  G.obst = wp.obst;
  G.rescuePending = wp.rescuePending; if (wp.rs) { G.rescueSlot = wp.rs.slot; G.rescueKind = wp.rs.kind; }
  G.groupTakenAtLoad = wp.groupBefore; G.speedGroupTaken = wp.groupAfter;
  G.speedPending = wp.speedPending; G.speedSlot = wp.speedSlot;
  G.packActive = false; G.spawnT = CONFIG.WORD_START_DELAY + (i === 0 ? CONFIG.FIRST_WORD_EXTRA : 0);
  renderWord(); renderProgress();
  startIntro(i, wp.boss);
}
function loadWord(i) {
  if (edgeOn()) { edgeLoadWord(i); return; }
  applyWord(planWord(i, G.speedGroupTaken));
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
  const cy = ((r.top + r.bottom) / 2 - bx.top) / u, cx = ((r.left + r.right) / 2 - bx.left) / u;
  let wmax = 0;
  [els.meaning, els.sub].forEach(el => { if (el.hidden || !el.textContent) return; const rg = document.createRange(); rg.selectNodeContents(el); wmax = Math.max(wmax, rg.getBoundingClientRect().width / u); });
  G.iGeo = { dy: LAYOUT.INTRO_CENTER_Y - cy, dx: Math.abs(W / 2 - cx) > 0.5 ? W / 2 - cx : 0, k: wmax ? Math.max(1, Math.min(CONFIG.INTRO_SCALE, ((LAYOUT.INTRO_W || LAYOUT.WORD_AVAIL_W) - 8) / wmax)) : CONFIG.INTRO_SCALE };
}
function applyIntro() {
  const st = introState(G.iClock, G.iTl, G.iKids, CONFIG);
  if (st.phase === 'done') { clearIntro(); return; }
  const u = unitPx(), k = G.iGeo.k + (1 - G.iGeo.k) * st.e, dy = G.iGeo.dy * (1 - st.e);
  els.hintbox.classList.add('intro');
  els.hintbox.style.transform = G.iGeo.dx ? 'translate(' + (G.iGeo.dx * (1 - st.e) * u).toFixed(2) + 'px, ' + (dy * u).toFixed(2) + 'px) scale(' + k.toFixed(4) + ')' : 'translateY(' + (dy * u).toFixed(2) + 'px) scale(' + k.toFixed(4) + ')';
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
  let heartPlaced = false;
  G.packId++; G.packActive = true;
  // 하트: 체력이 줄었고 하트가 나올 칸이면, 묶음 앞에 한 칸 간격을 두고 둔다(점프해야 먹는다)
  if (G.heartPending && G.si >= G.heartSlot && !slot.high) {   // 작업328: 체력 조건 없음(가득이어도 나온다). 높은 칸 묶음 앞에는 두지 않는다(점프 시점이 겹치지 않게)
    G.heartPending = false; heartPlaced = true;
    G.tiles.push({ id: -G.packId, kind: 'heart', x: x0, w: 46, text: '', correct: false, chunk: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '' });
    x0 += gap;
  } else if (G.rescuePending && G.si >= G.rescueSlot && !slot.high) {   // 작업329: 힌트·천사도 하트와 같은 방식(묶음 앞 한 칸 간격)
    G.rescuePending = false;
    G.tiles.push({ id: -G.packId, kind: G.rescueKind, x: x0, w: 46, text: '', correct: false, chunk: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '' });
    x0 += gap;
  } else if (G.speedPending && G.si >= G.speedSlot && !slot.high) {   // 작업328: 가속 아이템도 하트와 같은 방식(묶음 앞 한 칸 간격)
    G.speedPending = false;
    G.tiles.push({ id: -G.packId, kind: 'speed', x: x0, w: 46, text: '', correct: false, chunk: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '' });
    x0 += gap;
  }
  // 작업326: 이 묶음 앞에 장애물이 계획돼 있으면(단어당 한 번, 첫 등장 때만) 첫 글자를 안전 간격(D1)까지 늘리고 그 사이에 둔다
  if (G.obst && !G.obst.done && G.obst.slot === G.si && !heartPlaced) {
    const lay = obstacleLayout(CONFIG, G.obst.kind);
    x0 = Math.max(x0, RUNNER_X + lay.D1);
    G.obstacles.push({ kind: lay.kind, x: x0 - lay.post - lay.w, w: lay.w, hit: false, age: 0, art: obstacleArtIndex(G.words[G.wi].word, G.obst.slot, G.obstSeq++) });   // 그림 종류: 난수 없이 단어·묶음 번호·순번으로 정한다(작업327)
    G.obst.done = true;
  }
  cands.forEach((c, i) => {
    G.tiles.push({
      id: G.packId, x: x0 + i * gap, w: (slot.chunk ? 20 + slot.text.length * 26 : 58) * tileScale(),
      text: c.text, correct: c.correct, chunk: slot.chunk, high: !!slot.high, state: 'live', t: 0, age: 0,
      checked: false, ok: false, color: TILE_COLORS[(i + G.si) % TILE_COLORS.length], n: G.packId * 8 + i, bi: balloonColor(i, G.si)
    });
  });
}
// ---------- 작업354: 타일 흐름(스트림) 'edge' ----------
// 주소 옵션 stream=edge 일 때만 켜진다(기본 꺼짐 = classic, 위 spawnPack/endPack 동작 그대로). 355 에서 가로 모드가 이 방식을 쓴다.
// 묶음·아이템·장애물을 오른쪽 화면 밖(streamViewW 보다 오른쪽)에서 시작해 흘려보낸다. 다음 묶음은 앞 묶음 정답을 먹은 시점 기준으로 classic 과 같은 도착 시점으로 계산하고(logic.js streamPlace),
// 화면 안에서 생기지 않도록·남은 타일과 겹치지 않도록 그만큼 늦춘다. 한 묶음의 정답 위치는 월드 좌표(x + G.dist)로 기록해 속도가 바뀌어도 어긋나지 않는다.
const edgeOn = () => !!CONFIG.STREAM_EDGE;
let streamViewW = W;   // 화면 논리 폭(진입 거리 = 이 값 + 타일 반폭). 355 에서 가로 모드가 키운다
const dimCur = () => ({ wi: G.wi, si: G.si });   // 지금 풀 칸(판정용. 작업360 전에는 흐림 계산에도 썼다)
const tileScale = () => LAYOUT.TILE_SCALE || 1;   // 작업360: 가로 0.75(철자 타일 그림·폭). 세로 1
const tileLift = t => (t && t.high) ? 0 : (LAYOUT.TILE_LIFT || 0);   // 작업361: 가로 일반 철자 타일 그림만 위로 올리는 논리 px(판정·배치는 그대로). 높은 칸은 위쪽 글자 카드에 닿아 올리지 않는다
const charScale = () => LAYOUT.CHAR_SCALE || 1;
const fxOn = () => !!LAYOUT.FX;   // 작업363: 가로 캐릭터 동작 효과(그리기·표시 상태만. 판정·점수·체력·타일 위치와 무관)
// 반응 상태(364 에서 표정 프레임을 연결할 자리): kind = 'happy' | 'hurt' | 'surprise' | '', 시작 시각(게임 시간)·길이는 CHAR_FX.REACT
function setReact(kind) { if (fxOn()) G.react = reactNext(G.react, kind, G.time); }
const reactNow = () => reactKind(G.react, G.time);
function spawnDust(kind) {
  const pat = kind === 'land' ? CHAR_FX.DUST_LAND : [CHAR_FX.DUST_RUN[G.dustN++ % CHAR_FX.DUST_RUN.length]], cs = charScale(), P = CHARS[charKey] || CHARS.penguin;
  for (const d of pat) {
    G.dust.push({ x: RUNNER_X + P.faceDx * cs + d.dx * cs, y: GROUND - 2, vx: d.vx * cs, vy: d.vy * cs, r: d.r * cs, life: CHAR_FX.DUST_SEC, max: CHAR_FX.DUST_SEC });
    if (G.dust.length > CHAR_FX.DUST_MAX) G.dust.shift();   // 먼지 총 24개 이하
  }
}   // 작업360: 가로 1.3(캐릭터 그림만. 판정 위치·크기는 그대로)
function edgeWPFor(i) {
  const ec = G.ec;
  if (ec.wps[i]) return ec.wps[i];
  survEnsure(i);
  const prev = ec.wps[i - 1];
  return (ec.wps[i] = planWord(i, prev ? prev.groupAfter : G.speedGroupTaken));
}
function edgeNextKey(key) {
  const wp = edgeWPFor(key.wi);
  if (key.si + 1 < wp.plan.slots.length) return { wi: key.wi, si: key.si + 1 };
  survEnsure(key.wi + 1);
  return key.wi + 1 >= G.words.length ? null : { wi: key.wi + 1, si: 0 };
}
function edgeRightmost() {
  let best = null;
  for (const t of G.tiles) if (t.x > RUNNER_X && (!best || t.x > best.x)) best = { x: t.x, w: t.w };
  return best;
}
// key 묶음(아이템·장애물 포함)을 줄에 넣는다. nearOnly 이면 첫 객체가 아직 진입 지점에서 멀면(LOOKAHEAD 보다) 넣지 않고 false.
function edgeCommit(key, kind, nearOnly) {
  const ec = G.ec, wp = edgeWPFor(key.wi), slot = wp.plan.slots[key.si], word = G.words[key.wi], v = G.speedTarget;
  const tail = ec.packs[ec.packs.length - 1];
  const heartOk = wp.heartPending && key.si >= wp.heartSlot && !slot.high;
  const resOk = !heartOk && wp.rescuePending && key.si >= wp.rescueSlot && !slot.high;
  const spdOk = !heartOk && !resOk && wp.speedPending && key.si >= wp.speedSlot && !slot.high;
  const item = heartOk ? 'heart' : resOk ? wp.rescueKind : spdOk ? 'speed' : null;
  const obKind = (wp.obst && !wp.obst.done && wp.obst.slot === key.si && !heartOk) ? wp.obst.kind : null;   // 하트가 놓이는 묶음에는 장애물을 두지 않는다(classic 과 같다)
  const ccfg = wp.boss ? bossConfig() : CONFIG, tw = (slot.chunk ? 20 + slot.text.length * 26 : 58) * tileScale();
  const r = L.streamPlace(CONFIG, kind, { tileScale: tileScale(), xc: tail ? tail.xcW - G.dist : RUNNER_X, runnerX: RUNNER_X, v: v, bossNext: !!wp.boss, first: key.wi === 0, viewW: streamViewW,
    widths: Array.from({ length: ccfg.CANDIDATES }, () => tw), item: !!item, obstacle: obKind, firstHigh: !!slot.high, leftover: edgeRightmost() });
  if (nearOnly && L.groupLeft(r.group).left > streamViewW + L.STREAM.LOOKAHEAD) return false;
  const g = r.group, pid = ++G.packId, rec = { key: key, kind: kind, dx: r.dx, correct: null, xcW: 0 };
  if (heartOk) wp.heartPending = false; else if (resOk) wp.rescuePending = false; else if (spdOk) wp.speedPending = false;
  if (item) G.tiles.push({ id: -pid, kind: item, x: g.itemX, w: 46, text: '', correct: false, chunk: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '', wi: key.wi, si: key.si, wp: wp, itemKind: item });
  if (obKind) {
    G.obstacles.push({ kind: g.obstacle.kind, x: g.obstacle.x, w: g.obstacle.w, hit: false, age: 0, art: obstacleArtIndex(word.word, wp.obst.slot, G.obstSeq++), wp: wp });
    wp.obst.done = true;
  }
  const cands = makeCandidates(slot.text, word.word, Math.random, ccfg);
  cands.forEach((c, i) => {
    const t = { id: pid, x: g.tiles[i].x, w: g.tiles[i].w, text: c.text, correct: c.correct, chunk: slot.chunk, high: !!slot.high, state: 'live', t: 0, age: 0,
      checked: false, ok: false, color: TILE_COLORS[(i + key.si) % TILE_COLORS.length], wi: key.wi, si: key.si, n: pid * 8 + i, bi: balloonColor(i, key.si) };   // 작업361: n·bi = 풍선 위상·색(난수 없음)
    G.tiles.push(t);
    if (c.correct) { rec.correct = t; rec.xcW = t.x + G.dist; }
  });
  ec.packs.push(rec);
  return true;
}
// 미리 줄에 넣는다: 마지막 묶음 다음 묶음(같은 단어의 다음 칸, 없으면 다음 단어)을 첫 객체가 진입 지점 가까이 올 때 넣는다. 다음 단어는 이때 계획된다(구조 아이템은 그 시점의 체력으로 판단)
function edgeFill() {
  const ec = G.ec;
  if (!ec || (G.state !== 'run' && G.state !== 'pop' && G.state !== 'intro')) return;
  for (let n = 0; n < 8; n++) {
    const tail = ec.packs[ec.packs.length - 1];
    if (!tail) { if (G.state === 'run' && G.si < G.plan.slots.length) edgeCommit({ wi: G.wi, si: G.si }, 'recover', false); return; }
    const nk = edgeNextKey(tail.key);
    if (!nk || !edgeCommit(nk, nk.wi === tail.key.wi ? 'pack' : 'word', true)) return;
  }
}
function edgeLoadWord(i) {
  const ec = G.ec;
  let wp = ec.wps[i];
  if (!wp) { const prev = ec.wps[i - 1]; wp = ec.wps[i] = planWord(i, prev ? prev.groupAfter : G.speedGroupTaken); }
  applyWord(wp);
  const tail = ec.packs[ec.packs.length - 1];
  if (!ec.packs.some(p => p.key.wi === i) && !(tail && tail.key.wi === i - 1)) edgeCommit({ wi: i, si: 0 }, 'start', false);   // 판 시작·이어하기만 첫 묶음을 지금 놓는다(이전 단어에서 이어지면 이미 미리 놓였거나 곧 놓인다)
}
// 틀렸을 때: 화면에 보이는 타일은 그대로 두고, 화면 밖 타일·장애물·아이템만 거둔 뒤 "지금 풀 칸"에 맞게 다시 줄을 세운다(맞는 글자가 화면에 없으면 앞쪽 화면 밖에 넣는다)
function edgeReplan() {
  const ec = G.ec;
  if (!ec) return;
  const cur = dimCur(), dead = new Set();
  G.tiles = G.tiles.filter(t => {
    if (!L.streamOffscreen(t, streamViewW)) return true;
    if (t.itemKind) { if (t.itemKind === 'heart') t.wp.heartPending = true; else if (t.itemKind === 'speed') t.wp.speedPending = true; else t.wp.rescuePending = true; }
    dead.add(t);
    return false;
  });
  G.obstacles = G.obstacles.filter(o => {
    if (o.hit || !o.wp || o.x < streamViewW) return true;
    o.wp.obst.done = false; G.obstSeq--;
    return false;
  });
  const kn = k => k.wi * 100000 + k.si;
  ec.packs = ec.packs.filter(p => kn(p.key) <= kn(cur) && !(p.correct && dead.has(p.correct)));
  const has = G.tiles.some(t => !t.kind && t.state === 'live' && !t.checked && L.streamIsCorrect(t, cur));
  if (!has && G.si < G.plan.slots.length) edgeCommit(cur, 'recover', false);
}
// 매 걸음: 달리는 중이 아닐 때 러너를 지나간 타일은 판정 없이 지나간 것으로 본다(나중에 달리는 중이 되어 한꺼번에 판정되지 않게). 그다음 줄을 채운다
function edgeStep() {
  if (G.state !== 'run') for (const t of G.tiles) if (!t.checked && t.x <= RUNNER_X) t.checked = true;
  edgeFill();
}
function endPack(hint) {
  for (const t of G.tiles) {
    if (t.id !== G.packId || t.state !== 'live') continue;
    if (hint && t.correct && t.x > RUNNER_X) { t.state = 'hint'; t.t = 0; }
    else { t.state = 'fade'; t.t = 0; }
  }
  G.packActive = false; G.spawnT = CONFIG.PACK_DELAY;
  clearRescue();
}
function curH() { return airHeight(G.jumpT, G.j2, G.j2h); }
function resolve(t) {
  const hh = curH();
  const air = hh > CONFIG.GRAB_H;
  if (t.kind === 'heart') { if (air) onHeart(t); return; }
  if (t.kind === 'speed') { if (air) onSpeedItem(t); return; }
  if (t.kind === 'hint' || t.kind === 'angel') { if (air) onRescueItem(t); return; }
  // 높은 칸은 HIGH_GRAB_H 이상일 때만 "공중"으로 본다(한 번 점프로는 닿지 않는다). 일반 칸 판정은 그대로
  const r = judge(t.wi !== undefined ? L.streamIsCorrect(t, dimCur()) : t.correct, t.high ? hh >= CONFIG.HIGH_GRAB_H : air);   // 작업354: edge 는 "지금 풀 칸"의 정답만 정답이다(다른 칸·다음 단어용 타일은 오답)
  if (r === 'pass') return;
  if (r === 'hit') onHit(t);
  else onFail(t, r);
}
function onHeart(t) {
  t.state = 'taken'; t.t = 0; t.ok = true;
  const r = heartEffect(G.hp);   // 작업328: 체력이 가득이면 체력은 그대로 두고 점수 보너스
  G.hp = r.hp; G.score += r.score;
  sfx.heart();
  burst(RUNNER_X + 8, TILE_Y, '#ff4d5e', 14);
  if (r.full) { if (r.score > 0) floatText(RUNNER_X + 70, GROUND - 235, '+' + r.score, '#e07b00', 22); }
  else floatText(RUNNER_X + 70, GROUND - 235, '체력 +' + CONFIG.HEART_HEAL, GOOD, 22);
  renderHearts(); renderScore();
}
// 작업329: 힌트·천사를 먹으면 그 아이템 뒤에 나오는 후보 묶음 한 번에만 효과가 있다(표시와 오답 타일 치우기만. 정답 판정·타일 위치·타이밍·난수는 그대로).
function onRescueItem(t) {
  t.state = 'taken'; t.t = 0; t.ok = true;
  const pack = -t.id, slot = G.plan.slots[G.si];
  G.rescue = { kind: t.kind, pack: pack };
  sfx.heart();
  if (t.kind === 'hint') {
    burst(RUNNER_X + 8, TILE_Y, '#34d399', 12); floatText(RUNNER_X + 70, GROUND - 235, '힌트!', '#0f8a5f', 22);
    const el = slotEls[G.si];
    if (el && slot && !slot.filled) el.querySelectorAll('.cell').forEach((c, k) => { c.textContent = slot.text[k]; c.classList.add('ghost'); });   // 다음 빈칸에 정답 글자를 희미하게
  } else {
    burst(RUNNER_X + 8, TILE_Y, '#c4b5fd', 12); floatText(RUNNER_X + 70, GROUND - 235, '천사!', '#6d4fd6', 22);
    for (const x of G.tiles) {
      if (x.id !== pack || x.state !== 'live' || x.correct) continue;   // 정답 타일은 그대로 두고 틀린 타일만 치운다
      if (edgeOn()) { if (L.streamOffscreen(x, streamViewW)) x.dead = true; continue; }   // 작업354: edge 는 화면 밖 타일만 치운다. 작업360: 보이는 타일은 흐리게도 바꾸지 않고 그대로 둔다
      if (reduce) x.dead = true; else { G.angels.push({ x: x.x, y: x.high ? HIGH_Y : TILE_Y, t: 0 }); x.state = 'fade'; x.t = 0; x.angel = true; }   // 움직임 줄이기에서는 반짝임 없이 바로 사라진다
    }
    if (reduce || edgeOn()) G.tiles = G.tiles.filter(x => !x.dead);
  }
}
function clearRescue() {   // 묶음이 끝나면 효과가 사라진다
  if (G.rescue && G.rescue.kind === 'hint') slotEls.forEach(el => el.querySelectorAll('.cell.ghost').forEach(c => { c.classList.remove('ghost'); if (!c.classList.contains('hint') && !el.classList.contains('done')) c.textContent = ''; }));
  G.rescue = null;
}
// 작업328: 가속 아이템을 먹으면 BOOST_SEC 초 동안 목표 속도가 x BOOST_FACTOR(SPEED_MAX 이하)가 되고 완성 점수에 배율이 붙는다. 기본 속도 누적(speedBase)은 건드리지 않는다.
function onSpeedItem(t) {
  t.state = 'taken'; t.t = 0; t.ok = true;
  G.boost = CONFIG.BOOST_SEC; G.boostMax = CONFIG.BOOST_SEC;
  sfx.heart();
  burst(RUNNER_X + 8, TILE_Y, '#38bdf8', 14);
  floatText(RUNNER_X + 70, GROUND - 235, '빨라요!', '#0b7fc0', 22);
}
function onHit(t) {
  t.state = 'taken'; t.t = 0; t.ok = true;
  if (balloonK(t) !== null) popBalloon(t);   // 작업361: 풍선은 바로 사라지고 색 조각이 퍼진다
  if (edgeOn()) clearRescue(); else endPack(false);   // 작업354: edge 는 같은 묶음의 남은 타일을 지우지 않는다
  const slot = G.plan.slots[G.si];
  G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
  const sm = speedMult(G.speed);
  const pts = Math.round(slotPoints(slot.text.length, G.combo, CONFIG, t.high ? CONFIG.HIGH_BONUS : 0) * sm * (G.words[G.wi].boss ? CONFIG.BOSS_MULT : 1));
  G.lastPts = pts; G.lastSpeedMult = sm;
  if (fxOn()) { setReact('happy'); G.fxRight = G.time; }   // 작업363: 맞는 글자 — 폴짝·별
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
// 작업341: 체력이 0이 된 순간. 이어하기를 아직 안 썼고 켜져 있으면 게임을 멈추고 선택 화면을 띄운다(생존 시간은 step 이 멈춰 있어서 흐르지 않는다). 아니면 예전처럼 쓰러지고 끝난다.
function onZeroHp() {
  sfx.over();
  if (CONFIG.CONT_ENABLED && !G.contUsed) {
    G.state = 'choice'; els.cont.hidden = false;
    els.live.textContent = '체력이 0이 됐어요. 이어하기 또는 끝내기';
    try { els.contBtn.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  } else { G.state = 'ending'; G.endT = 0.9; }
}
function doContinue() {
  if (G.state !== 'choice') return;
  G.contUsed = true; els.cont.hidden = true;
  G.hp = contHp(CONFIG.HP);
  clearRescue();
  Object.assign(G, { ec: { packs: [], wps: {} }, tiles: [], obstacles: [], boost: 0, rescuePending: false, packActive: false, jumpT: -1, j2: -1, j2h: 0, jumpBuf: 0, hurt: 0, shake: 0, stumble: 0, fall: 0, eat: 0,
    invuln: CONFIG.CONT_INVULN_SEC, speedGroupTaken: G.groupTakenAtLoad, state: 'run' });   // 점수·콤보·실수 횟수(mist)는 그대로
  renderHearts();
  els.live.textContent = '이어서 합니다';
  loadWord(G.wi);   // 이 단어를 처음부터(칸 초기화)
}
function doEnd() {
  if (G.state !== 'choice') return;
  els.cont.hidden = true; finish(false);
}
function onFail(t, kind) {
  if (edgeOn()) { if (kind === 'wrong') { t.wrong = true; riseTile(t); } }   // 작업360: 가로(edge)는 틀린·놓친 타일이 희미해지거나 사라지지 않고 같은 선명도로 지나간다(틀린 타일에는 붉은 색조만)
  else if (kind === 'wrong') { t.state = 'taken'; t.t = 0; t.ok = false; }
  else { t.state = 'fade'; t.t = 0; }
  if (edgeOn()) clearRescue(); else endPack(true);   // 작업354: edge 는 보이는 타일을 그대로 두고 아래에서 화면 밖 줄만 다시 정한다
  G.hp--; G.combo = 0; G.mist[G.wi]++;
  G.speedBase = speedAfterFail(G.speedBase);
  G.speedTarget = targetSpeed(G.speedBase, G.combo);
  G.hurt = 0.5; if (!fxOn()) G.shake = 0.3;   // 작업363: 가로는 캐릭터·화면의 무작위 흔들림 대신 아래 정해진 틀린 글자 효과 하나만 쓴다
  setReact('hurt'); if (kind === 'wrong' && fxOn()) G.fxWrong = G.time;
  sfx.bad();
  floatText(RUNNER_X + 30, GROUND - 150, kind === 'wrong' ? '오답!' : '놓쳤어요', BAD, 22);
  flashHint(G.si);
  if (edgeOn()) { edgeReplan(); if (kind === 'wrong' || kind === 'miss') riseUseless(); }   // 작업363: 정답을 놓쳤을 때도 쓸모없어진 풍선이 함께 올라간다(놓친 풍선 자신은 그대로 지나감)   // 작업362: 틀린 풍선과 쓸모없어진 풍선이 같은 순간에 올라간다(점수·콤보 계산은 그대로)
  renderHearts(); renderScore();
  if (G.hp <= 0) onZeroHp();
}
// 작업326: 장애물에 맞았다(상자에 걸림·구덩이에 빠짐). 체력 -1, 속도 즉시 감소(이후 가속도로 목표 속도까지 회복). 콤보·점수·실수 기록(mist)은 건드리지 않는다.
function onObstacleHit(ob) {
  ob.hit = true; G.obstHits++; G.boost = 0;   // 작업328: 장애물에 맞으면 가속 효과는 즉시 끝난다
  const r = afterObstacleHit({ hp: G.hp, speed: G.speed, speedBase: G.speedBase, combo: G.combo });
  G.hp = r.hp; G.speed = r.speed; G.speedBase = r.speedBase; G.speedTarget = r.speedTarget;
  G.invuln = CONFIG.OBST_INVULN_SEC;
  G.hurt = 0.5; G.shake = 0.3; setReact('hurt');   // 작업363: 하트가 줄면 hurt
  if (ob.kind === 'pit') G.fall = FALL_SEC; else G.stumble = STUMBLE_SEC;
  sfx.bad();
  burst(RUNNER_X, GROUND - 6, ob.kind === 'pit' ? '#8a93c4' : '#c8791f', 10);
  floatText(RUNNER_X + 30, GROUND - 150, ob.kind === 'pit' ? '구덩이!' : '걸렸어요', BAD, 22);
  renderHearts();
  if (G.hp <= 0) onZeroHp();
}
function completeWord() {
  const w = G.words[G.wi];
  G.wordsDone++;
  const perfect = G.mist[G.wi] === 0;
  const isBoss = !!w.boss;
  const isFinal = !G.survival && G.wi + 1 >= G.words.length;   // 생존 모드에는 마지막 단어가 없다
  const bonus = boostWordBonus(CONFIG.WORD_BONUS + (perfect ? CONFIG.PERFECT_BONUS : 0) + (isBoss ? CONFIG.BOSS_BONUS : 0), G.boost > 0);   // 작업328: 가속 중이면 완성 점수 배율
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
  survEnsure(G.wi + 1);
  if (G.wi + 1 >= G.words.length) { finish(true); return; }
  const next = G.words[G.wi + 1];
  if (next.boss) {
    G.state = 'intro'; G.introT = CONFIG.BOSS_INTRO_SEC; G.bossMode = true;
    G.speedBase = Math.min(CONFIG.SPEED_MAX, G.speedBase + CONFIG.BOSS_SPEED_BONUS);
    G.speedTarget = targetSpeed(G.speedBase, G.combo);
    const heal = G.survival ? (G.wi + 2 <= CONFIG.SURV_BOSS_HEAL_UNTIL ? CONFIG.SURV_BOSS_HEAL : 0) : CONFIG.BOSS_HEAL;   // 생존 모드: 초반 보스에서만 회복(시뮬레이션으로 정한 값)
    const healed = G.hp < CONFIG.HP && heal > 0;
    G.hp = Math.min(CONFIG.HP, G.hp + heal);
    renderHearts();
    els.bossSub.textContent = healed ? '긴 단어에 도전! 체력 +' + heal : '긴 단어에 도전!';
    els.bossBanner.hidden = false;
    els.bossBanner.classList.remove('go'); void els.bossBanner.offsetWidth; els.bossBanner.classList.add('go');
    els.live.textContent = '보스 단어 등장';
    sfx.boss();
  } else { G.state = 'run'; loadWord(G.wi + 1); }
}
function finish(cleared) {
  closeMenu();   // 작업360
  G.state = 'over'; G.bossMode = false; G.cleared = !!cleared; clearIntro(); els.cont.hidden = true;
  box.classList.remove('boss');
  els.pop.hidden = true; els.hud.hidden = true; els.bossBanner.hidden = true;
  if (VSG.on && VSG.running) { vsgOver(); return; }   // 작업347: 대결 판은 결과를 서버에 보내고 상대를 기다린다(일반 결과 화면을 쓰지 않는다)
  els.resChips.textContent = '';
  const surv = G.survival;
  const old = box.querySelectorAll('#resTime, #resMissNote, #resCont'); old.forEach(e => e.remove());   // 생존 모드 전용 요소는 매번 지우고 다시 만든다
  const shown = [];   // 생존 모드: 틀린 단어 칩(최근 SURV_CHIPS 개)
  G.words.forEach((w, i) => {
    if (surv && i > G.wordsDone) return;   // 아직 나오지 않은 미리 공급된 단어
    let cls;
    if (i < G.wordsDone) {
      if (G.mist[i] === 0) { cls = 'clean'; missedSet.delete(w.word); }
      else { cls = 'slip'; missedSet.add(w.word); }
    } else if (i === G.wordsDone && !cleared) { cls = 'fail'; missedSet.add(w.word); }
    else cls = '';
    if (surv && cls !== 'slip' && cls !== 'fail') return;   // 생존 모드는 틀린 단어만 칩으로 보인다
    if (surv) shown.push({ w: w, cls: cls }); else appendChip(w, cls);
  });
  if (surv) {
    const keep = shown.slice(-CONFIG.SURV_CHIPS);
    keep.forEach(x => appendChip(x.w, x.cls));
    const note = document.createElement('p'); note.className = 'note'; note.id = 'resMissNote';
    note.textContent = shown.length ? '틀린 단어 ' + shown.length + '개' + (shown.length > keep.length ? ' 중 최근 ' + keep.length + '개' : '') : '틀린 단어 없음';
    els.resChips.parentNode.insertBefore(note, els.resChips.nextSibling);
  }
  finishRest(cleared);
}
function appendChip(w, cls) {
  {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip ' + cls + (w.boss ? ' boss' : ''); b.dataset.word = w.word;
    if (w.boss) { const em = document.createElement('em'); em.textContent = 'BOSS'; b.appendChild(em); }
    b.appendChild(document.createTextNode(w.word));
    const mean = document.createElement('i'); mean.textContent = w.meaning; b.appendChild(mean);
    els.resChips.appendChild(b);
  }
}
function finishRest(cleared) {
  const surv = G.survival;
  const hasBoss = G.words.some(w => w.boss);
  els.resTitle.textContent = cleared ? (hasBoss ? '보스 격파!' : G.words.length + '단어 완주') : '게임 오버';
  els.resScore.textContent = G.score.toLocaleString('en-US');
  els.resDone.textContent = surv ? String(G.wordsDone) : G.wordsDone + ' / ' + G.words.length;
  els.resCombo.textContent = G.maxCombo;
  if (surv) {   // 생존 시간(게임 시간: 탭이 가려진 동안은 흐르지 않는다)
    const sec = Math.max(0, Math.round(G.time - G.startTime)), d = document.createElement('div');
    d.id = 'resTime'; const b = document.createElement('b'); b.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); d.appendChild(b); d.appendChild(document.createTextNode('생존 시간'));
    els.resDone.parentNode.parentNode.appendChild(d);
  }
  if (G.contUsed) {   // 작업341: 이어하기를 썼으면 결과에 한 줄(생존 모드는 기록에 이어한 구간이 들어 있다는 설명을 붙인다)
    const n = document.createElement('p'); n.className = 'note'; n.id = 'resCont';
    n.textContent = surv ? '이어하기 사용 (생존 시간과 단어 수에 이어한 구간 포함)' : '이어하기 사용';
    els.resChips.parentNode.insertBefore(n, els.resChips);
  }
  const n = VALID_WORDS.filter(w => missedSet.has(w.word)).length;
  els.revBtn.textContent = n ? '틀린 단어만 다시 도전 (' + n + ')' : '틀린 단어 없음';
  els.revBtn.disabled = n === 0;
  els.result.hidden = false;
  fitResult();
  els.live.textContent = cleared ? '완주했습니다' : '게임 오버';
}

// ---------- 입력 ----------
function startJump() {
  G.jumpT = 0; G.j2 = -1; G.j2h = 0; G.jumpBuf = 0; sfx.jump();
  const sl = G.plan && G.plan.slots[G.si]; if (sl && sl.high) setReact('surprise');   // 작업363: 높은 칸 타일을 향해 뛴다
}
// 작업318-4: 공중에서 한 번 더 누르면 2단 점프(공중에서 1회만). 점프 버퍼는 2단 점프를 쓴 뒤의 착지 직전 입력에만 쓴다. 2단 점프가 꺼져 있으면 예전 그대로
function startSecondJump() {
  G.j2h = curH(); G.j2 = 0; G.j2Land = secondJumpLandTime(G.j2h); G.jumpBuf = 0;
  setReact('surprise');   // 작업363
  sfx.jump2(); burst(RUNNER_X, GROUND - 27 - G.j2h + 24, '#ffffff', 8);
}
function jump() {
  if (VSG.quitOpen || menuPauses()) return;
  if (G.state !== 'run' && G.state !== 'pop' && G.state !== 'intro') return;
  if (G.jumpT < 0) startJump();
  else if (CONFIG.DJ_ENABLED && G.j2 < 0) { if (G.jumpT >= CONFIG.SECOND_JUMP_MIN) startSecondJump(); }   // 첫 점프 직후의 너무 빠른 입력(중복 이벤트)은 무시
  else G.jumpBuf = CONFIG.JUMP_BUFFER;
}
box.addEventListener('pointerdown', e => {
  if (e.target.closest && e.target.closest('button')) return;
  e.preventDefault();
  if (MENU.open) { closeMenu(); return; }   // 작업360: 메뉴가 열려 있을 때 바깥을 누르면 메뉴만 닫는다(그 누름은 점프로 세지 않는다)
  jump();
});
window.addEventListener('keydown', e => {
  if (MENU.open) { if (e.key === 'Escape') closeMenu(); if (e.target && e.target.closest && e.target.closest('#srMenu')) return; }   // 작업360: 메뉴 안의 키(스페이스·엔터로 항목 누르기)는 점프가 아니다
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    if (G.state === 'run' || G.state === 'pop' || G.state === 'intro') { e.preventDefault(); if (!e.repeat) jump(); }   // 키를 누르고 있어서 생기는 반복 입력은 점프로 세지 않는다
  }
});
els.startBtn.addEventListener('click', () => { tryFs(); beginRound(false); });
els.againBtn.addEventListener('click', () => { tryFs(); beginRound(false); });
els.revBtn.addEventListener('click', () => { tryFs(); beginRound(true); });
els.contBtn.addEventListener('click', doContinue);
els.endBtn.addEventListener('click', doEnd);
$('ttsTest').addEventListener('click', () => {
  const st = $('ttsStatus');
  st.textContent = '재생 중...';
  primeAudio();
  pronounce('hello', {}, (ok, why, src) => {
    st.textContent = (ok ? '재생이 시작되었습니다. 소리가 들리지 않으면 기기 음량과 무음 모드를 확인하세요.'
                        : '재생되지 않았습니다 (' + why + '). 이 환경에서는 단어 발음이 나오지 않을 수 있습니다.') + (ttsDebug && src ? ' [' + src + ']' : '');
  });
});
els.resChips.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.chip');
  if (b && b.dataset.word) pronounce(b.dataset.word);
});

// ---------- 업데이트 ----------
function step(dt) {
  if (G.state === 'choice' || VSG.quitOpen || menuPauses()) return;   // 작업360: 혼자 할 때 메뉴가 열려 있으면 게임 시간·타일·점수가 모두 멈춘다(대결은 멈추지 않는다). 작업341: 선택 화면에 머문 시간은 게임 시간(생존 시간)에 들어가지 않는다. 작업348: 대결 나가기 확인 대화상자가 열려 있는 동안도 같다
  G.time += dt;
  { const tgt = G.bossMode ? 1 : 0, d = tgt - G.bossBlend; G.bossBlend = (reduce || Math.abs(d) <= dt / BG_ART.BLEND_SEC) ? tgt : G.bossBlend + Math.sign(d) * dt / BG_ART.BLEND_SEC; }   // 작업358: 낮 ↔ 보스 배경 약 0.5초 겹쳐 바꿈(움직임 줄이기는 즉시)
  box.classList.toggle('bsky', G.bossBlend >= 0.5);   // 보스 하늘이 절반 이상 보이면 위쪽 글자를 흰색으로(stage_style.js)
  if (G.repeatT > 0) {
    G.repeatT -= dt;
    if (G.repeatT <= 0) { pronounce(G.repeatWord, { slow: true, queue: true }); G.repeatWord = ''; }
  }
  if (G.state === 'idle' || G.state === 'over') { G.dist += 60 * dt; updateFx(dt); return; }
  G.boost = Math.max(0, G.boost - dt);
  const dv = boostTarget(G.speedTarget, G.boost > 0) - G.speed, maxDv = CONFIG.SPEED_ACCEL * dt;   // 작업328: 가속 중에는 목표 속도가 올라가지만 SPEED_MAX 를 넘지 않는다
  G.speed += Math.abs(dv) <= maxDv ? dv : Math.sign(dv) * maxDv;
  if (G.speed > CONFIG.SPEED_MAX) G.speed = CONFIG.SPEED_MAX;   // 안전 장치: 장애물 안전 간격은 SPEED_MAX 기준
  if (G.speed > G.speedMaxSeen) G.speedMaxSeen = G.speed;
  const shown = Math.round(speedMult(G.speed) * 10) / 10;
  if (shown !== G.shownMult) { G.shownMult = shown; els.speedTag.textContent = '속도 ×' + shown.toFixed(1); }
  G.dist += G.speed * dt;

  if (G.jumpT >= 0) {
    G.jumpT += dt;
    if (G.j2 >= 0) G.j2 += dt;
    if (G.j2 >= 0 ? G.j2 >= G.j2Land : G.jumpT >= CONFIG.JUMP_TIME) {
      G.jumpT = -1; G.j2 = -1; G.land = 0.12;
      if (fxOn()) spawnDust('land');   // 작업363: 착지할 때 먼지 3개가 뒤로 퍼진다
      if (G.jumpBuf > 0) startJump();
    }
  }
  if (fxOn() && G.state === 'run' && G.jumpT < 0 && curH() <= 1) { G.dustT += dt; if (G.dustT >= CHAR_FX.DUST_RUN_SEC) { G.dustT -= CHAR_FX.DUST_RUN_SEC; spawnDust('run'); } }   // 달리는 동안 0.2초마다 아주 작은 먼지 1개
  if (G.jumpBuf > 0) G.jumpBuf -= dt;
  { const nh = curH(); if (nh !== G.prevH) G.rising = nh > G.prevH; G.prevH = nh; if (nh <= 1) G.runPhase = advanceRunPhase(G.runPhase, dt, G.speed); }   // 작업321: 게임 시간 기준(일시정지 중 정지)
  G.hurt = Math.max(0, G.hurt - dt);
  G.eat = Math.max(0, G.eat - dt);
  G.shake = Math.max(0, G.shake - dt);
  G.land = Math.max(0, G.land - dt);
  G.invuln = Math.max(0, G.invuln - dt); G.stumble = Math.max(0, G.stumble - dt); G.fall = Math.max(0, G.fall - dt);

  for (const t of G.tiles) {
    t.age += dt; t.x -= G.speed * dt;
    if (t.state !== 'live') t.t += dt;
    if (t.rise) t.rise.t += dt;   // 작업362: 올라가는 시간(게임 시간이라 메뉴로 멈추면 같이 멈춘다)
    if (t.state === 'hint' && t.t > CONFIG.HINT_SEC) { t.state = 'fade'; t.t = 0; }
  }

  for (const o of G.obstacles) { o.x -= G.speed * dt; o.age += dt; }
  if (G.state === 'run') {
    // 작업326: 러너와 겹치는 동안 공중 높이(airHeight)가 장애물을 넘지 못하면 맞는다. 한 장애물에는 한 번만, 맞은 직후에는 무적 시간
    for (const o of G.obstacles) {
      if (o.hit || G.invuln > 0 || !obstacleOverlaps(o.x, o.w, RUNNER_X)) continue;
      if (obstacleHit(o.kind, curH())) { onObstacleHit(o); if (G.state !== 'run') break; }
    }
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
    if (!edgeOn() && G.state === 'run' && !G.packActive) {
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

  if (edgeOn()) edgeStep();   // 작업354
  G.obstacles = G.obstacles.filter(o => o.x + o.w > -80);
  G.tiles = G.tiles.filter(t => t.x > -140 && !(t.rise && balloonRiseY(t.rise.t, t.rise.a) >= t.rise.dist) && !((t.state === 'fade' && t.t > (t.angel ? CONFIG.ANGEL_SEC + 0.05 : 0.35)) || (t.state === 'taken' && t.t > 0.4)));
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
// 작업358: 그림을 논리 크기에 맞게 한 번만 줄여 캔버스에 보관하고(크기가 바뀔 때만 다시), 매 프레임은 그 캔버스를 그대로 붙인다
function bgCanvas(st, dwLog, dhLog) {
  const w = Math.max(1, Math.round(dwLog * S)), h = Math.max(1, Math.round(dhLog * S)), key = w + 'x' + h;
  if (st.cvKey === key) return st.cv;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(st.img, 0, 0, w, h);
  st.cv = c; st.cvKey = key;
  return c;
}
function drawTiled(st, speed, dwLog, dhLog, bottomY) {   // 가로로 이어 붙이고 층마다 속도로 흐른다. 바닥이 bottomY 에 닿는다
  const cv = bgCanvas(st, dwLog, dhLog), off = ((G.dist * speed) % dwLog + dwLog) % dwLog;
  for (let x = -off; x < W; x += dwLog) ctx.drawImage(cv, Math.round(x * S) / S, bottomY - dhLog, dwLog + 1 / S, dhLog);
}
function drawLayerArt(key) {
  const st = bgArt[key], sp = st.spec;
  drawTiled(st, sp.SPEED, BG_ART.TILE_W, sp.H / BG_ART.PX, GROUND + 6);   // 바닥은 땅 띠 아래로 6px 겹쳐 틈이 없다
}
function drawCloudsArt() {
  const st = bgArt.clouds, sp = st.spec, P = BG_ART.PX, cv = bgCanvas(st, sp.W / P, sp.H / P), period = W + 140;
  const yTop = LAYOUT.CONTENT_BOTTOM_Y + 20, yBot = GROUND - 160;   // 위쪽 뜻·글자 칸 뒤(글자 영역 아래 끝 위)는 비워 둔다
  ctx.save(); ctx.globalAlpha = sp.ALPHA;
  sp.ITEMS.forEach((r, i) => {
    const sc = sp.SCALE[i], dw = r.sw / P * sc, dh = r.sh / P * sc;
    const x = ((sp.X[i] * period - G.dist * sp.SPEED) % period + period) % period - 70, y = yTop + sp.Y[i] * Math.max(0, yBot - yTop);
    ctx.drawImage(cv, r.sx / P * S, r.sy / P * S, r.sw / P * S, r.sh / P * S, x - dw / 2, y - dh / 2, dw, dh);
  });
  ctx.restore();
}
function drawDaySky() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#8fd3f4'); g.addColorStop(1, '#eaf6f0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (bgOK('clouds') && bgOK('dayFar') && bgOK('dayMid')) { drawCloudsArt(); drawLayerArt('dayFar'); drawLayerArt('dayMid'); return; }
  drawSceneOld(false);
}
function drawBossSky() {
  if (bgOK('sky') && bgOK('bossFar') && bgOK('bossNear')) {
    const st = bgArt.sky, dh = GROUND + 8, dw = dh * st.spec.W / st.spec.H;
    drawTiled(st, st.spec.SPEED, dw, dh, dh);
    drawLayerArt('bossFar'); drawLayerArt('bossNear');
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#2b3a7a'); g.addColorStop(0.6, '#e98a6b'); g.addColorStop(1, '#ffd08a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  drawSceneOld(true);
}
function drawSceneOld(boss) {   // 기존 그림(구름 타원 + 코드 언덕): 그림을 못 읽을 때의 대체
  ctx.fillStyle = boss ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.85)';
  for (const c of CLOUDS) {
    const x = ((c[0] - G.dist * 0.12) % (W + 140) + (W + 140)) % (W + 140) - 70, y = c[1] * GROUND / 520, s = c[2];
    ctx.beginPath();
    ctx.ellipse(x, y, 34 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 20 * s, y + 4 * s, 22 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 22 * s, y + 5 * s, 24 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawHills(boss ? '#7a6f9b' : '#bde7cf', 46, GROUND - 40, 0.22, 70);
  drawHills(boss ? '#5a5483' : '#8fd1b0', 36, GROUND - 6, 0.45, 52);
}
function drawScene() {
  const b = G.bossBlend;
  if (b < 0.999) drawDaySky();
  if (b > 0.001) { ctx.save(); ctx.globalAlpha = b; drawBossSky(); ctx.restore(); }
  ctx.fillStyle = INK; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = '#3a4c8f'; ctx.fillRect(0, GROUND, W, 8);
  ctx.fillStyle = '#f7e9b7';
  const off = (G.dist % 64);
  for (let x = -off; x < W; x += 64) ctx.fillRect(x, GROUND + 46, 34, 5);
  ctx.fillStyle = 'rgba(247,233,183,.35)';
  const off2 = (G.dist * 1.4 % 90);
  for (let x = -off2; x < W; x += 90) ctx.fillRect(x, GROUND + 92, 20, 4);
}
// ---------- 작업326: 장애물 그리기(캔버스 도형. 글자 타일과 다르게 각진 상자·어두운 구멍 + 빨간 경고 표지) ----------
// 바닥 장애물 그림 위치: 시트가 준비됐으면 시트 칸(물체 바닥을 땅 선에 맞춤), 아니면 null(기존 상자 그림)
const artRect = o => (obstArtReady() ? obstacleArtRect(CONFIG, o.art, o.x + o.w / 2, GROUND, obstObjs[o.art]) : null);
const pitDrawW = o => o.w * CONFIG.PIT_ART_K;
const signY = o => (o.kind === 'pit' ? GROUND - 40 : GROUND - CONFIG.OBST_H - 26);   // 코드 그림(구덩이·상자)의 경고 표지 가운데 높이
// 겹침 시험용: 장애물 그림(표지 포함)의 윗끝 y
const obstTop = o => { if (o.kind === 'pit') return signY(o) - 14; const r = artRect(o); return r ? r.top : signY(o) - 14; };
function line(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
// 경고 삼각형: 느낌표는 글꼴 없이 선과 점으로 그린다. fill/stroke 로 색을 정한다
function warnTriangle(cx, y, s, fill, stroke) {
  ctx.save();
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2.5 * s; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, y - 13 * s); ctx.lineTo(cx - 13 * s, y + 10 * s); ctx.lineTo(cx + 13 * s, y + 10 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 3 * s;
  line(cx, y - 5 * s, cx, y + 2.5 * s);
  ctx.beginPath(); ctx.arc(cx, y + 6.2 * s, 1.7 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawWarnSign(cx, y) { warnTriangle(cx, y, 1, BAD, INK); }
// 구덩이: 판정 폭(PIT_W)보다 넓게 그린다. 입구 양쪽에 노랑/검정 줄무늬·흙 테두리·작은 돌, 안쪽은 아래로 갈수록 어두운 그라데이션
function drawPit(o) {
  const cx = o.x + o.w / 2, dw = pitDrawW(o), x = cx - dw / 2, H2 = H - GROUND;
  ctx.save();
  const g = ctx.createLinearGradient(0, GROUND, 0, H);
  g.addColorStop(0, '#2a1d14'); g.addColorStop(0.25, '#0d0907'); g.addColorStop(1, '#000');
  ctx.fillStyle = g; ctx.fillRect(x, GROUND, dw, H2);
  const wall = ctx.createLinearGradient(x, 0, x + dw, 0);   // 양쪽 벽의 밝은 가장자리로 입체감
  wall.addColorStop(0, 'rgba(255,255,255,.12)'); wall.addColorStop(0.12, 'rgba(0,0,0,0)'); wall.addColorStop(0.88, 'rgba(0,0,0,0)'); wall.addColorStop(1, 'rgba(255,255,255,.12)');
  ctx.fillStyle = wall; ctx.fillRect(x, GROUND, dw, H2);
  for (const side of [-1, 1]) {   // 흙 테두리(위쪽 모서리가 울퉁불퉁)와 작은 돌
    const ex = side < 0 ? x : x + dw;
    ctx.fillStyle = '#7a5230';
    ctx.beginPath(); ctx.moveTo(ex, GROUND - 1); ctx.lineTo(ex + side * 7, GROUND - 1); ctx.lineTo(ex + side * 9, GROUND + 5); ctx.lineTo(ex + side * 5, GROUND + 14); ctx.lineTo(ex + side * 1, GROUND + 22); ctx.lineTo(ex, GROUND + 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d8d0bd'; ctx.beginPath(); ctx.arc(ex + side * 9, GROUND + 1, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(ex + side * 15, GROUND - 2, 2, 0, Math.PI * 2); ctx.fill();
  }
  for (const side of [-1, 1]) {   // 입구 위험 줄무늬(양쪽, 노랑/검정 대각선)와 흰 가장자리 선
    const bx = side < 0 ? x - 22 : x + dw, bw = 22, by = GROUND - 10;
    ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, 9); ctx.clip();
    ctx.fillStyle = GOLD; ctx.fillRect(bx, by, bw, 9);
    ctx.fillStyle = INK; for (let k = -12; k < bw + 12; k += 10) { ctx.beginPath(); ctx.moveTo(bx + k, by + 9); ctx.lineTo(bx + k + 5, by + 9); ctx.lineTo(bx + k + 14, by); ctx.lineTo(bx + k + 9, by); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.strokeRect(bx, by, bw, 9);
  }
  ctx.restore();
  drawWarnSign(cx, signY(o));
}
function drawBox(o) {   // 기존 코드 그림(시트를 못 불렀을 때의 대체)
  const x = o.x, w = o.w, h = CONFIG.OBST_H, y = GROUND - h;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x + w / 2, GROUND + 8, w * 0.6, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8791f'; rr(x, y, w, h, 3); ctx.fill();
  ctx.save(); rr(x, y, w, h, 3); ctx.clip();   // 위험 줄무늬(노랑·남색 대각선)
  ctx.fillStyle = GOLD;
  for (let k = -h; k < w + h; k += 14) { ctx.beginPath(); ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + 7, y + h); ctx.lineTo(x + k + 7 + h, y); ctx.lineTo(x + k + h, y); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = 'miter'; rr(x, y, w, h, 3); ctx.stroke();
  ctx.restore();
  drawWarnSign(x + w / 2, signY(o));
}
// 바닥 장애물: 시트 그림(4종 중 o.art), 시트가 없으면 위의 코드 상자. 그림은 지나가는 동안 바뀌지 않는다
function drawObstacleArt(o) {
  const r = artRect(o);
  if (!r) { drawBox(o); return; }
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, GROUND + 6, r.side * 0.5, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(obstSheet, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
  ctx.restore();
}
// 작업327: 예고 표시. 장애물이 정해진 순간(앞 묶음 정답을 먹은 뒤 새 묶음이 나오기 전)부터 장애물 앞쪽 끝이 러너에 닿을 때까지 화면 오른쪽 가장자리에서 깜빡인다. 그림만 바꾸고 판정·타이밍에는 영향이 없다
function obstWarnActive() {
  if (G.state !== 'run') return false;
  if (edgeOn()) return G.obstacles.some(o => !o.hit && o.x >= streamViewW);   // 작업354: edge 는 아직 화면 밖에서 다가오는 장애물이 있을 때만 예고 표시(보이면 표시가 필요 없다)
  if (G.obst && !G.obst.done && G.obst.slot === G.si && !G.packActive) return true;
  return G.obstacles.some(o => !o.hit && o.x > RUNNER_X + CONFIG.OBST_FOOT);
}
function drawObstWarn() {
  if (!obstWarnActive() || Math.floor(G.time * 6) % 2) return;
  warnTriangle(W - 24, GROUND - 34, 1.15, GOLD, BAD);
}
function drawRescueItem(t) {   // 작업329: 힌트 = 전구, 천사 = 날개와 후광. 선과 도형으로만(이모지 없음). 하트(빨강)·번개(하늘색)와 색·모양이 다르다
  let a = 1, sc = 1;
  if (t.state === 'fade') { a = 1 - t.t / 0.3; sc = 1 - 0.2 * Math.min(1, t.t / 0.3); }
  else if (t.state === 'taken') { a = 1 - t.t / 0.35; sc = 1 + 0.7 * Math.min(1, t.t / 0.35); }
  if (a <= 0) return;
  const bob = t.state === 'live' ? Math.sin(G.time * 5 + t.x * 0.02) * 4 : 0;
  if (t.state === 'live') { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(t.x, GROUND + 10, 20, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a, t.age / 0.2));
  ctx.translate(t.x, TILE_Y + bob); ctx.scale(sc, sc); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (t.kind === 'hint') {
    ctx.shadowColor = '#34d399'; ctx.shadowBlur = 16;
    if (drawItemArt(2)) { ctx.restore(); return; }
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(0, -4, 17, 0, Math.PI * 2); ctx.fill();   // 전구
    ctx.shadowBlur = 0; ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = '#9aa3c2'; rr(-8, 11, 16, 10, 3); ctx.fill(); ctx.stroke();   // 소켓
    ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(-3, -6); ctx.lineTo(0, -1); ctx.lineTo(3, -6); ctx.lineTo(5, 3); ctx.stroke();   // 필라멘트
    ctx.strokeStyle = '#34d399'; ctx.lineWidth = 3;   // 빛줄기
    for (let k = 0; k < 5; k++) { const ang = -Math.PI / 2 + (k - 2) * 0.62, r1 = 23, r2 = 30; ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r1, -4 + Math.sin(ang) * r1); ctx.lineTo(Math.cos(ang) * r2, -4 + Math.sin(ang) * r2); ctx.stroke(); }
  } else {
    ctx.shadowColor = '#c4b5fd'; ctx.shadowBlur = 16;
    if (drawItemArt(3)) { ctx.restore(); return; }
    ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
    for (const side of [-1, 1]) {   // 날개
      ctx.beginPath(); ctx.moveTo(side * 6, 2); ctx.bezierCurveTo(side * 30, -22, side * 36, 6, side * 22, 16); ctx.bezierCurveTo(side * 16, 10, side * 12, 14, side * 6, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffe3ec'; ctx.beginPath(); ctx.arc(0, 4, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();   // 얼굴
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.ellipse(0, -13, 9, 3.5, 0, 0, Math.PI * 2); ctx.stroke();   // 후광
  }
  ctx.restore();
}
function drawAngels() {   // 천사 연출: 지워지는 타일 자리에서 후광·반짝임이 ANGEL_SEC 동안 번진다(움직임 줄이기에서는 만들어지지 않는다)
  for (const g of G.angels) {
    const p = Math.min(1, g.t / CONFIG.ANGEL_SEC); if (p >= 1) continue;
    ctx.save(); ctx.globalAlpha = 1 - p; ctx.translate(g.x, g.y - 18 * p);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, -30, 14, 5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 4, -20); ctx.quadraticCurveTo(side * 26, -40, side * 24, -16); ctx.quadraticCurveTo(side * 12, -18, side * 4, -14); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore(); drawStar(g.x + Math.sin(g.t * 20) * 14, g.y + Math.cos(g.t * 17) * 12, 6, 1 - p);
  }
}
function drawSpeedItem(t) {   // 작업328: 번개 모양(하트와 구분되는 하늘색). 선과 도형으로만 그린다
  let a = 1, sc = 1;
  if (t.state === 'fade') { a = 1 - t.t / 0.3; sc = 1 - 0.2 * Math.min(1, t.t / 0.3); }
  else if (t.state === 'taken') { a = 1 - t.t / 0.35; sc = 1 + 0.7 * Math.min(1, t.t / 0.35); }
  if (a <= 0) return;
  const bob = t.state === 'live' ? Math.sin(G.time * 5 + t.x * 0.02) * 4 : 0;
  if (t.state === 'live') { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(t.x, GROUND + 10, 20, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a, t.age / 0.2));
  ctx.translate(t.x, TILE_Y + bob); ctx.scale(sc, sc);
  ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 16;
  if (drawItemArt(1)) { ctx.restore(); return; }
  ctx.fillStyle = '#1fa8ee'; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();   // 동그란 하늘색 바탕
  ctx.shadowBlur = 0; ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = '#fff6b0'; ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';   // 번개
  ctx.beginPath(); ctx.moveTo(5, -17); ctx.lineTo(-10, 3); ctx.lineTo(-1, 3); ctx.lineTo(-5, 17); ctx.lineTo(11, -4); ctx.lineTo(2, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
// 가속 효과 표시: 러너 뒤 속도선(움직임 줄이기에서는 생략)과 남은 시간 막대(도로 왼쪽 아래의 얇은 막대 + 작은 번개)
function drawBoost() {
  if (G.boost <= 0 || G.state === 'over' || G.state === 'idle') return;
  ctx.save();
  if (!reduce) {
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const ph = (G.time * 3 + k * 0.37) % 1, y = GROUND - 14 - ((k * 37) % 70), x1 = RUNNER_X - 34 - ph * 60;
      ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 - 26, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const bw = 112, bx = 38, by = GROUND + 24, p = Math.max(0, Math.min(1, G.boost / (G.boostMax || CONFIG.BOOST_SEC)));
  ctx.fillStyle = 'rgba(255,255,255,.25)'; rr(bx, by, bw, 7, 3.5); ctx.fill();
  ctx.fillStyle = '#38bdf8'; rr(bx, by, Math.max(7, bw * p), 7, 3.5); ctx.fill();
  ctx.fillStyle = '#fff6b0'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(26, by - 6); ctx.lineTo(19, by + 4); ctx.lineTo(23.5, by + 4); ctx.lineTo(21, by + 13); ctx.lineTo(30, by + 1); ctx.lineTo(25.5, by + 1); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawItemArt(i) {   // 작업358: 아이템 그림(칸 i). 중심이 원점이고 변환·투명도·번짐은 부르는 쪽이 이미 정했다. 그림을 못 읽으면 false
  if (!itemArtReady()) return false;
  const A = ITEM_ART, k = A.DRAW_MAX / A.MAX_SIDE, d = A.CELL * k;
  ctx.drawImage(itemArt, i * A.CELL, 0, A.CELL, A.CELL, -d / 2, -d / 2, d, d);
  return true;
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
  if (drawItemArt(0)) { ctx.restore(); return; }   // 작업358: 그림이 있으면 그림으로(없으면 아래 도형)
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
// ---------- 작업361: 풍선 타일 ----------
const balloonKCache = {};
function tileFontPx(t) { return (t.chunk ? (t.text.length === 2 ? 34 : t.text.length === 3 ? 30 : 26) : 38) * tileScale(); }
// 이 타일을 풍선으로 그릴 때 몸통을 늘리는 배율(1~1.4). 풍선으로 그리지 않으면(세로·그림 못 읽음·조각이 너무 넓음) null
function balloonK(t) {
  if (!LAYOUT.BALLOON || !balloonReady() || t.kind) return null;
  const key = t.text + '|' + tileFontPx(t);
  if (!(key in balloonKCache)) { ctx.save(); ctx.font = '700 ' + tileFontPx(t) + 'px ' + FL; balloonKCache[key] = balloonStretch(ctx.measureText(t.text).width); ctx.restore(); }
  return balloonKCache[key];
}
// 작업362: 틀린 풍선이 위로 올라가기 시작한다. 즉시 먹는 판정에서 빠지고(checked), 점수·콤보·체력에는 아무 영향이 없다(장식). 화면 위로 나가면 step 이 지운다
function riseTile(t) {
  if (t.rise || t.kind) return;
  const A = BALLOON_ART, ty = (t.high ? HIGH_Y : TILE_Y) - tileLift(t), below = balloonK(t) !== null ? A.BOTTOM_DY + A.BOB + 2 : TILE_H * tileScale() / 2 + 8;   // 풍선은 끈 끝, 기존 타일 모양(조각이 너무 넓을 때)은 타일 아래 끝까지
  const dist = ty + below, r = balloonRise(dist, t.n || 0);
  t.checked = true; t.rise = { t: 0, a: r.a, dist: dist };
}
// 틀린 철자를 먹고 다시 계획한 직후: 화면 안에 이미 나와 있는 풍선 중 "계획에서는 맞는 풍선이었지만 지금 풀 칸의 정답이 아니게 된" 것(뒤 칸·다음 단어용 정답 풍선)을 함께 올린다.
// 처음부터 오답 후보였던 풍선과 지금 풀 칸의 정답 풍선은 그대로 둔다
function riseUseless() {
  const cur = dimCur();
  for (const t of G.tiles) if (!t.kind && t.state === 'live' && !t.checked && t.correct && !L.streamIsCorrect(t, cur)) riseTile(t);
}
function popBalloon(t) {
  const A = BALLOON_ART, n = reduce ? Math.ceil(A.POP_N / 2) : A.POP_N, y = (t.high ? HIGH_Y : TILE_Y) - tileLift(t);
  for (let i = 0; i < n; i++) {   // 난수 없이 일정한 방향·속도로 퍼진다
    const ang = i / n * Math.PI * 2 + 0.4, sp = 110 + (i % 2) * 40;
    G.parts.push({ x: t.x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40, life: A.POP_SEC, max: A.POP_SEC, color: A.COLORS[t.bi || 0], r: 3.5 });
  }
}
function drawBalloon(t) {
  const k = balloonK(t);
  if (k === null) return false;
  if (t.state === 'taken') return true;   // 먹은 풍선은 바로 사라진다(색 조각은 onHit 이 이미 냈다). 틀린 풍선은 taken 이 되지 않고 그대로 지나간다
  const A = BALLOON_ART, ts = tileScale(), ty = (t.high ? HIGH_Y : TILE_Y) - tileLift(t) - (t.rise ? balloonRiseY(t.rise.t, t.rise.a) : 0);   // 작업362: 올라가는 풍선은 그만큼 위
  const m = balloonMotion(G.time, balloonPhase(t.n || 0));   // 그리기에만 쓰는 움직임. 게임 시간 기준(메뉴로 멈추면 같이 멈춘다). 올라가는 동안도 계속
  if (!t.rise) {
    ctx.fillStyle = t.high ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(t.x, GROUND + 10, t.w * 0.38, 6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.translate(t.x, ty + m.dy);
  if (t.high) {   // 2단 점프 칸 표시: 몸통 위쪽 삼각형
    const top = -A.BODY_H / 2;
    ctx.fillStyle = GOLD; ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, top - 10); ctx.lineTo(-6, top - 2); ctx.lineTo(6, top - 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.translate(0, A.KNOT_DY); ctx.rotate(m.ang * Math.PI / 180); ctx.translate(0, -A.KNOT_DY);   // 몸통은 매듭을 축으로 흔들리고 끈도 같이 따라 흔들린다
  const hintGlow = G.rescue && G.rescue.kind === 'hint' && t.id === G.rescue.pack && t.correct && t.state === 'live';
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (hintGlow) { ctx.shadowColor = '#34d399'; ctx.shadowBlur = 26 + 8 * Math.sin(G.time * 8); }
  ctx.scale(k, 1);
  ctx.drawImage(balloonImg, (t.bi || 0) * A.CELL_W, 0, A.CELL_W, A.CELL_H, -A.CELL_W / A.PX / 2, -A.ANCHOR_Y / A.PX, A.CELL_W / A.PX, A.CELL_H / A.PX);
  ctx.restore();
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 ' + tileFontPx(t) + 'px ' + FL;
  ctx.fillText(t.text, 0, A.TEXT_DY);   // 몸통 가운데에서 약간 아래(하이라이트를 피해)
  if (t.chunk) {
    ctx.fillStyle = GOLD; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    ctx.beginPath();
    const cx = A.BODY_W * k / 2 * 0.72, cy = -A.BODY_H / 2 * 0.62;
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 ? 4.5 : 10) * ts, ang = -Math.PI / 2 + i * Math.PI / 5;
      const px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  return true;
}
function drawTile(t) {
  if (t.kind === 'heart') { drawHeartItem(t); return; }
  if (t.kind === 'speed') { drawSpeedItem(t); return; }
  if (t.kind === 'hint' || t.kind === 'angel') { drawRescueItem(t); return; }
  if (drawBalloon(t)) return;   // 작업361: 가로는 풍선(조각이 너무 넓으면 아래 기존 타일 모양)
  const h = TILE_H;
  let a = 1, sc = 1;
  const solid = edgeOn();   // 작업360: 가로(edge)의 철자 타일은 항상 같은 선명도(들어올 때 서서히 나타나지도 않는다)
  if (t.state === 'fade') { const fd = t.angel ? CONFIG.ANGEL_SEC : 0.3; a = 1 - t.t / fd; sc = 1 - 0.2 * Math.min(1, t.t / fd); }
  else if (t.state === 'taken') { a = 1 - t.t / 0.35; sc = 1 + 0.5 * Math.min(1, t.t / 0.35); }
  if (a <= 0) return;
  const bob = t.state === 'live' ? Math.sin(G.time * 4 + t.x * 0.02) * 3 : 0;
  const ty = (t.high ? HIGH_Y : TILE_Y) - tileLift(t) - (t.rise ? balloonRiseY(t.rise.t, t.rise.a) : 0);
  if ((t.state === 'live' || t.state === 'hint') && !t.rise) {
    ctx.fillStyle = t.high ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(t.x, GROUND + 10, t.w * 0.38, 6, 0, 0, Math.PI * 2); ctx.fill();
  }
  const w = t.w / tileScale();
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a, solid ? 1 : t.age / 0.2));
  const ts = tileScale();   // 작업360: 그림은 ts 배(가로 0.75). t.w 는 이미 줄어든 폭이라 그릴 때는 원래 폭(w)으로 그리고 전체를 ts 배 한다
  ctx.translate(t.x, ty + bob); ctx.scale(sc * ts, sc * ts);
  const hintGlow = G.rescue && G.rescue.kind === 'hint' && t.id === G.rescue.pack && t.correct && t.state === 'live';   // 작업329: 힌트 아이템 효과 중 정답 타일 글로우
  if (t.state === 'hint') { ctx.shadowColor = GOOD; ctx.shadowBlur = 20; }
  else if (hintGlow) { ctx.shadowColor = '#34d399'; ctx.shadowBlur = 26 + 8 * Math.sin(G.time * 8); }
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
  if (hintGlow) { ctx.strokeStyle = '#34d399'; ctx.lineWidth = 5; rr(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 17); ctx.stroke(); }
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
  if ((G.state === 'ending' || G.state === 'choice')) ctx.rotate(0.25);
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
  if (G.hurt > 0 || (G.state === 'ending' || G.state === 'choice')) {
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
function drawDust() {   // 작업363: 발밑 먼지(서서히 사라진다. 캐릭터·풍선은 투명해지지 않는다)
  if (!G.dust.length) return;
  ctx.save(); ctx.fillStyle = '#e3d6b6';
  for (const p of G.dust) { ctx.globalAlpha = 0.65 * Math.max(0, p.life / p.max); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function drawStar(x, y, r, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#fff6b0'; ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.35 : r, ang = -Math.PI / 2 + i * Math.PI / 4; const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}
function drawRunner() {
  const h = curH();
  const ck = activeChar();
  if (!ck) { drawRunnerShape(h); return; }
  const cs = charScale();   // 작업360: 가로 1.3배(그림만. 러너 위치·점프 높이·판정은 그대로, 발끝은 땅에 그대로 닿는다)
  const fx = fxOn(), P = CHARS[ck], sz = P.size * cs, sx = (G.shake > 0 && !reduce && !fx) ? (Math.random() - 0.5) * 6 : 0;
  // 작업363: 가로 동작 효과(그리기만). 틀린 글자 흔들림·뒤로 밀림·기울어짐, 맞는 글자 폴짝, 달릴 때 출렁임, 점프·착지 늘었다 줄기
  let fdx = 0, fdy = 0, ftilt = 0, fsq = null;
  if (fx) {
    const uw = (G.time - G.fxWrong) / CHAR_FX.WRONG_SEC, ur = (G.time - G.fxRight) / CHAR_FX.RIGHT_HOP_SEC;
    if (uw >= 0 && uw < 1) { const w = wrongFx(uw); fdx = w.dx * cs; ftilt = w.ang; }
    if (ur >= 0 && ur < 1) fdy -= rightHop(ur) * cs;
    if (G.jumpT < 0 && h <= 1 && G.state === 'run') fdy += runBob(G.runPhase) * cs;
    fsq = charSquash(G.jumpT >= 0 ? (G.j2 >= 0 ? G.j2 : G.jumpT) : -1, CONFIG.JUMP_TIME / 2, G.land);
  }
  const idx = penguinFrame({ state: G.state, cleared: G.cleared, air: h > 1, rising: G.rising, runPhase: G.runPhase });
  const angle = spinAngle(G.j2, G.j2Land) + ((G.state === 'ending' || G.state === 'choice') ? 0.25 * 180 / Math.PI : 0);
  G.spriteDraws++; G.spriteFrame = idx; G.spriteAngle = angle;
  if (fx) { const sh = charShadow(h); ctx.fillStyle = 'rgba(0,0,0,' + sh.a + ')'; ctx.beginPath(); ctx.ellipse(RUNNER_X + fdx, GROUND + 10, 22 * cs * sh.k, 6 * cs * sh.k, 0, 0, Math.PI * 2); ctx.fill(); }   // 작업363: 높을수록 작고 연한 그림자(캐릭터 본체는 그대로)
  else {
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(RUNNER_X, GROUND + 10, 22 * cs * (1 - h / 260), 6 * cs * (1 - h / 320), 0, 0, Math.PI * 2); ctx.fill();
  }
  const faceX = RUNNER_X + P.faceDx * cs + fdx, footY = GROUND - h;
  const left = faceX - P.faceX * sz + sx, top = footY + P.footPad * sz - sz;
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  let scx = 1, scy = 1;
  if (fsq) { scx = fsq.sx; scy = fsq.sy; }
  else if (h > 1) { scx = 0.97; scy = 1.04; } else if (G.land > 0) { scx = 1.08; scy = 0.92; }
  ctx.translate(faceX + sx, footY + fdy); if (ftilt) ctx.rotate(ftilt * Math.PI / 180); ctx.scale(scx, scy); ctx.translate(-(faceX + sx), -footY);   // 늘이기·찌그러짐·기울어짐은 발바닥 기준
  if (angle) { const bx = left + 0.5 * sz, by = top + P.bodyY * sz; ctx.translate(bx, by); ctx.rotate(angle * Math.PI / 180); ctx.translate(-bx, -by); }   // 2단 점프 회전: 몸 중앙 기준
  if (G.hurt > 0 && !fx && Math.floor(G.time * 20) % 2 === 0) ctx.globalAlpha = 0.55;   // 작업363: 가로는 깜박이거나 투명해지지 않는다
  ctx.drawImage(charSheets[ck].img, idx * P.CELL, 0, P.CELL, P.CELL, left, top, sz, sz);
  ctx.restore();
  if (fx) {   // 작업363: 맞는 글자 별 4개(0.4초)
    const us = (G.time - G.fxRight) / CHAR_FX.STAR_SEC;
    if (us >= 0 && us < 1) { const bx = left + 0.5 * sz, by = top + P.bodyY * sz + fdy; for (let i = 0; i < CHAR_FX.STAR_N; i++) { const s = starFx(i, us); drawStar(bx + Math.cos(s.ang) * sz * s.rad, by + Math.sin(s.ang) * sz * s.rad * 0.85, 3.5 * cs, Math.max(0, s.a)); } }
  }
  const sp = sparkleAlpha(G.j2);   // 2단 점프 정점 부근의 작은 반짝임
  if (sp > 0) {
    const bx = left + 0.5 * sz, by = top + P.bodyY * sz, t = G.time * 6;
    for (let i = 0; i < 4; i++) { const a = t + i * Math.PI / 2; drawStar(bx + Math.cos(a) * sz * 0.5, by + Math.sin(a) * sz * 0.42, 4 + 3 * sp, sp); }
  }
}
// 작업326: 장애물에 맞은 연출. 상자는 발바닥 기준으로 짧게 비틀거리고, 구덩이는 땅 아래로 떨어졌다가 튀어 오른다(떨어진 부분은 구멍 모양 안에서만 보인다). 움직임 줄이기 설정이면 움직임 없이 기존 깜빡임만
function drawRunnerFx() {
  const h = curH();
  if (reduce || h > 1 || (G.stumble <= 0 && G.fall <= 0)) { drawRunner(); return; }
  ctx.save();
  if (G.fall > 0) {
    const p = 1 - G.fall / FALL_SEC, dy = FALL_DEPTH * Math.sin(Math.PI * p) * (p < 0.5 ? 1 : 0.9);
    ctx.fillStyle = '#05070f'; ctx.beginPath(); ctx.ellipse(RUNNER_X, GROUND + 4, 30 * Math.sin(Math.PI * p) + 6, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.rect(0, 0, W, GROUND); ctx.ellipse(RUNNER_X, GROUND + 4, 30, 40, 0, 0, Math.PI * 2); ctx.clip();
    ctx.translate(0, dy);
  } else {
    const p = 1 - G.stumble / STUMBLE_SEC, ang = -0.32 * Math.sin(Math.PI * p) * (1 - p * 0.3);
    ctx.translate(RUNNER_X, GROUND); ctx.rotate(ang); ctx.translate(-RUNNER_X, -GROUND);
  }
  drawRunner();
  ctx.restore();
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
  for (const o of G.obstacles) if (o.kind === 'pit') drawPit(o);
  for (const o of G.obstacles) if (o.kind === 'box') drawObstacleArt(o);
  for (const t of G.tiles) drawTile(t);
  drawDust();
  drawRunnerFx();
  drawObstWarn();
  drawBoost();
  drawAngels();
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
  document.body.classList.add('sr-full');   // 작업355: 헤더·화면 바를 숨기고 판이 화면 전체를 채운다
  setupViewUI();
  resize();
  const shape = L.roundShape(words.length);
  els.startInfo.textContent = '이번 판 ' + shape.regular + '단어' + (shape.bosses ? ' + 보스 ' + shape.bosses + '단어' : '') + ' · 체력 ' + CONFIG.HP;
  els.startExcluded.hidden = excluded === 0;
  els.startExcluded.textContent = excluded + '개 제외(구절·특수문자)';
  els.speechNote.hidden = hasSpeech();
  els.djRule.hidden = !CONFIG.DJ_ENABLED;
  if (CONFIG.RESCUE_ENABLED && !$('rescueRule')) {   // 작업329: rescue=0 이면 규칙 줄 없음
    const li = document.createElement('li'); li.id = 'rescueRule'; li.textContent = '힌트나 천사가 가끔 와요. 체력이 적으면 더 자주 와요.';
    $('rgItems').appendChild(li);
  }
  const mintRule = document.querySelector('#help .rules li.mint');   // 작업341: 안내 줄을 늘리지 않고(시작 카드가 이미 스크롤되는 높이라) 체력 규칙 줄에 이어하기 안내를 붙인다. continue=0 이면 원래 문구
  if (mintRule) mintRule.textContent = CONFIG.CONT_ENABLED ? '오답을 먹거나 놓치면 체력이 1 줄고 새 글자가 나와요. 체력이 0이 되면 한 번 이어서 할 수 있어요.' : mintRule.textContent;
  if (CONFIG.SPEED_ITEM_ENABLED && !$('speedRule')) {   // 작업328: 가속 아이템이 켜져 있을 때만 규칙 줄을 넣는다(speeditem=0 이면 화면 구성이 이전과 같다)
    const li = document.createElement('li'); li.id = 'speedRule'; li.textContent = '번개를 먹으면 잠시 빨라지고 점수가 올라요. 하트는 체력이 가득이면 점수로 바뀌어요.';
    $('rgItems').appendChild(li);
  }
  if (CONFIG.OBST_ENABLED && CONFIG.OBSTACLE_PROB > 0 && !$('obsRule')) {   // 작업326: 장애물이 나올 수 있을 때만 규칙 줄을 넣는다(obs=0·obsprob=0 이면 화면 구성이 이전과 같다)
    const li = document.createElement('li'); li.id = 'obsRule'; li.textContent = '길에 놓인 장애물과 구덩이는 점프로 넘으세요. 걸리면 체력이 1 줄고 속도가 느려집니다(콤보와 점수는 그대로).';
    $('rgObst').appendChild(li);
  }
  $('coreCont').textContent = CONFIG.CONT_ENABLED ? '체력이 0이 되면 한 번 이어서 할 수 있어요.' : '체력이 0이 되면 게임이 끝나요.';   // 작업346: continue=0 이면 뜻이 맞는 문구
  for (const grp of ['rgObst', 'rgItems']) { const ul = $(grp), on = Array.from(ul.children).some(li => !li.hidden); ul.hidden = !on; ul.previousElementSibling.hidden = !on; }   // 조건부 줄이 하나도 없는 묶음은 제목째 숨긴다
  els.tune.hidden = !OPT.applied.length;
  els.tune.title = OPT.applied.length ? OPT.applied.join(', ') + ' (누르면 저장값을 지우고 기본값으로)' : '';
  els.tune.addEventListener('click', () => {   // 저장값을 지우고 옵션 없이 다시 연다
    try { localStorage.removeItem(L.OPTION_KEY); } catch (e) { /* 무시 */ }
    location.replace(location.pathname + '?reset=1');
  });
  els.startBtn.disabled = false;
  setupModeUI(words.length);   // 작업332: 생존 모드인데 단어가 모자라면 시작 버튼을 다시 막는다
  setupVersusUI();
  setupVersusGameUI();
  setupPreviewUI();
  setupHelpUI();
  requestAnimationFrame(frame);
}
// ---------- 작업345: 시작 전 단어 미리 보기 ----------
// previewRun(words, onReady): words = [{ word, meaning }] 를 순서대로 하나씩 보여 주며 발음을 읽고, 끝나거나 건너뛰면 "시작" 단추가 있는 준비 상태에서 멈춘 뒤
// 사용자가 시작을 누르면 onReady() 를 부른다(돌아가기는 onBack). 게임 상태(G)를 건드리지 않아 대결에서도 그대로 쓸 수 있다.
const PV_MAX = 10;
const PV_T = { maxMs: 6000, gapMs: 800, silentMs: 2500 };   // 한 단어 최대 시간, 재생 뒤 쉬는 시간, 소리를 껐을 때 한 단어를 보여 주는 시간. 시험이 줄여 쓴다
const PV = { active: false, mode: '', words: [], idx: 0, token: 0, timers: [], userPaused: false, hiddenPaused: false, onReady: null, onBack: null, lastNote: '', prefetching: 0, maxPrefetch: 0, noPrefetch: false, wordsShown: [] };
function pvClear() { PV.timers.forEach(clearTimeout); PV.timers = []; }
function pvLater(fn, ms, tk) { PV.timers.push(setTimeout(() => { if (tk === PV.token && PV.active) fn(); }, ms)); }
// 같은 종류의 안내는 연달아 다시 띄우지 않는다
function pvNote(kind, text) { if (PV.lastNote === kind) return; PV.lastNote = kind; $('pvNote').textContent = text; }
const pvRunning = () => PV.active && PV.mode === 'show' && !PV.userPaused && !PV.hiddenPaused;
// 한 단어 발음. 게임과 같은 경로(서버 TTS → 기기 음성)를 쓰고, 끝났을 때 done() 을 한 번 부른다. 서버 발음이 안 되면 기기 음성으로 대신한다
function pvSpeak(word, tk, done) {
  let fin = false;
  const end = () => { if (!fin) { fin = true; if (tk === PV.token) done(); } };
  const builtin = status => {
    if (status === 429) pvNote('429', '서버 발음 한도에 걸려 기기 음성으로 읽어요.');
    else if (status === 401 || status === 403) pvNote('auth', '서버 발음을 쓸 수 없어 기기 음성으로 읽어요. 다시 로그인해 보세요.');
    else if (status) pvNote('tts', '서버 발음을 쓸 수 없어 기기 음성으로 읽어요.');
    speakBuiltin(word, undefined, false, ok => { if (!ok) end(); });
    if (lastUtt) { lastUtt.onend = end; const prev = lastUtt.onerror; lastUtt.onerror = e => { if (prev) prev(e); end(); }; }
  };
  if (serverTtsOff && !audioCache.has(word)) { builtin(serverTtsStatus); return; }
  getServerAudio(word).then(url => playUrl(url, 1, false)).then(() => {
    if (tk !== PV.token) return;
    const onEnd = () => { player.removeEventListener('ended', onEnd); player.removeEventListener('error', onEnd); end(); };
    player.addEventListener('ended', onEnd); player.addEventListener('error', onEnd);
    if (player.ended) onEnd();
  }, err => {
    if (err && err.name === 'AbortError') { end(); return; }
    builtin(err && err.status);
  });
}
// 현재 단어 발음을 받는 요청이 끝난 뒤에야 다음 단어 하나만 미리 받는다(요청이 동시에 둘 이상 나가지 않는다)
function pvPrefetch(i, tk) {
  const next = PV.words[i + 1];
  if (!next || !SND.on || serverTtsOff || PV.noPrefetch || audioCache.has(next.word)) return;
  const go = () => {
    if (tk !== PV.token || serverTtsOff || audioCache.has(next.word)) return;
    PV.prefetching++; PV.maxPrefetch = Math.max(PV.maxPrefetch, PV.prefetching);
    getServerAudio(next.word).catch(() => { PV.noPrefetch = true; }).then(() => { PV.prefetching--; });   // 한 번 실패하면(429 등) 미리 받기를 그만둔다: 한도에 걸린 서버를 더 두드리지 않는다
  };
  const cur = audioCache.get(PV.words[i].word);
  if (cur) cur.then(go, go); else go();
}
function pvRender() {
  const w = PV.words[PV.idx];
  $('pvProg').textContent = (PV.idx + 1) + '/' + PV.words.length;
  $('pvWord').textContent = w.word; $('pvMean').textContent = w.meaning;
  $('pvArea').disabled = false; $('pvArea').setAttribute('aria-label', '다음 단어로 (' + w.word + ' ' + w.meaning + ')');
  $('pvPause').textContent = PV.userPaused ? '계속' : '일시정지'; $('pvPause').setAttribute('aria-pressed', String(PV.userPaused));
  $('pvCtl').hidden = false; $('pvStart').hidden = true;
}
function pvShow(i) {
  pvClear(); stopVoices();
  const tk = ++PV.token;
  PV.mode = 'show'; PV.idx = i; PV.wordsShown.push(PV.words[i].word);
  pvRender();
  if (!pvRunning()) return;
  const w = PV.words[i];
  pvLater(() => pvAdvance(), PV_T.maxMs, tk);   // 재생이 끝나지 않아도 한 단어 최대 시간이 지나면 넘어간다
  if (!SND.on) { pvLater(() => pvAdvance(), PV_T.silentMs, tk); return; }
  pvSpeak(w.word, tk, () => pvLater(() => pvAdvance(), PV_T.gapMs, tk));
  pvPrefetch(i, tk);
}
function pvAdvance() {
  if (!PV.active || PV.mode !== 'show') return;
  if (PV.idx + 1 < PV.words.length) pvShow(PV.idx + 1); else pvReady();
}
function pvReady() {
  pvClear(); stopVoices(); PV.token++; PV.mode = 'ready'; PV.userPaused = false;
  $('pvProg').textContent = PV.words.length + '개를 훑어봤어요';
  $('pvWord').textContent = '준비됐나요?'; $('pvMean').textContent = '시작을 누르면 바로 달려요.';
  $('pvArea').disabled = true; $('pvArea').setAttribute('aria-label', '준비됐나요?');
  $('pvCtl').hidden = true; $('pvStart').hidden = false; $('pvStart').focus();
}
function pvPauseToggle() {
  if (!PV.active || PV.mode !== 'show') return;
  PV.userPaused = !PV.userPaused;
  if (PV.userPaused) { pvClear(); stopVoices(); PV.token++; pvRender(); } else pvShow(PV.idx);   // 계속하면 지금 단어를 처음부터 다시 읽는다
}
function pvStop() { PV.active = false; PV.mode = ''; pvClear(); PV.token++; stopVoices(); $('pv').hidden = true; }
function previewRun(words, onReady, onBack) {
  const list = (words || []).slice(0, PV_MAX);
  if (!list.length) { onReady(); return; }
  Object.assign(PV, { active: true, words: list, idx: 0, userPaused: false, hiddenPaused: document.hidden, onReady: onReady, onBack: onBack, lastNote: '', prefetching: 0, maxPrefetch: 0, noPrefetch: false, wordsShown: [] });
  $('pvNote').textContent = '';
  els.start.hidden = true; els.result.hidden = true; $('pv').hidden = false;
  pvShow(0);
}
function setupPreviewUI() {
  $('pvArea').addEventListener('click', () => { if (PV.active && PV.mode === 'show') pvAdvance(); });
  $('pvPause').addEventListener('click', pvPauseToggle);
  $('pvSkip').addEventListener('click', () => { if (PV.active && PV.mode === 'show') pvReady(); });
  $('pvStart').addEventListener('click', () => { tryFs(); const f = PV.onReady; pvStop(); if (f) f(); });
  $('pvBack').addEventListener('click', () => { const f = PV.onBack; pvStop(); if (f) f(); });
  $('pv').addEventListener('keydown', e => { if (e.key === 'Escape') $('pvBack').click(); });
  // 작업351: 숨겨질 때와 되돌아올 수 있는 보관(pagehide persisted=true)은 같은 "숨겨짐" 멈춤이고, 다시 보일 때와 보관에서 돌아올 때(pageshow persisted=true)는 같은 재개다.
  // 사용자가 직접 멈춘 상태(userPaused)는 돌아와도 멈춘 채로 둔다. 둘이 함께 와도 재개는 한 번만(hiddenPaused 와 직전 0.5초 기록).
  let pvResumedAt = 0;
  const pvHide = () => { if (PV.active && PV.mode === 'show' && !PV.hiddenPaused) { PV.hiddenPaused = true; pvClear(); stopVoices(); PV.token++; } };
  const pvResume = () => { if (PV.active && PV.mode === 'show' && PV.hiddenPaused) { PV.hiddenPaused = false; if (!PV.userPaused) pvShow(PV.idx); } };   // 지금 단어부터 이어 간다
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pvHide(); else { pvResumedAt = Date.now(); pvResume(); }
  });
  window.addEventListener('pagehide', e => { if (!PV.active) return; if (e.persisted) pvHide(); else pvStop(); });   // 실제로 닫힐 때만 끝낸다
  window.addEventListener('pageshow', e => { if (!e.persisted || document.hidden || Date.now() - pvResumedAt < 500) return; pvResumedAt = Date.now(); pvResume(); });
}
// 시작·새 판·틀린 단어 다시 도전: 미리 보기가 켜져 있으면 먼저 이번 판 단어 순서를 정해 보여 주고, 시작을 누르면 같은 순서로 판을 연다
function beginRound(reviewOnly) {
  if (!previewOn) { startRound(reviewOnly); return; }
  const P = planPool(reviewOnly);
  if (!P.pool.length) return;
  primeAudio();   // 이 클릭으로 소리 재생 권한을 확보한다(미리 보기의 자동 재생)
  const back = () => { els.start.hidden = false; };
  previewRun(P.pool.map(w => ({ word: w.word, meaning: w.meaning })), () => startRound(reviewOnly, P), back);
}
// ---------- 작업344: 대결 입구(방 목록·만들기·참가·대기·준비). 서버 API 는 작업343(/api/versus/rooms). 게임 연결은 다음 작업 ----------
const VS_MIN_WORDS = 10;   // 서버 start 가 10 미만을 400 으로 막는다
const VS_T = { list: 3000, room: 2000, backoff: 5000, signal: 1000, fin: 1000 };   // 목록·방 조회 간격(ms)과 429/503 뒤 쉬는 시간. 시험이 줄여 쓴다
const VS_DENIED = '대결 사용 권한이 없어요. 관리자에게 문의해 주세요.';
const VS = { open: false, view: '', roomId: null, timer: null, token: 0, busy: false, msgKind: '', pausedUntil: 0, polls: 0, round: 0 };   // round: 서버가 알려 준 현재 판 번호(작업348)
const VS_TXT = {   // 작업348: 예외 안내 문구
  hasRoom: '이미 만든 방이 있어요. 목록에서 내 방으로 들어가거나 취소해 주세요.',
  unavailable: '이미 끝났거나 가득 찬 방이에요.',
  gone: '방이 사라져 결과를 겨루지 못했어요.',
};
let canVersus = false, vsWords = 0, vsModeBtn = null;
const vsShow = name => { for (const id of ['vsListView', 'vsRoomView', 'vsDeniedView', 'vsFinView']) $(id).hidden = id !== name; };
// 같은 종류의 안내를 연달아 다시 띄우지 않는다(같은 문구가 이미 떠 있으면 건너뜀)
function vsToast(kind, text) {
  const el = $('vsMsg');
  if (VS.msgKind === kind && el.textContent === text) return;
  VS.msgKind = kind; el.textContent = text;
}
function vsClearToast(onlyTransient) {
  if (onlyTransient && !['net', '429', '503'].includes(VS.msgKind)) return;   // 사라진 방 같은 안내는 다음 조회 성공으로 지우지 않는다
  VS.msgKind = ''; $('vsMsg').textContent = '';
}
async function vsApi(method, path, body, keepalive) {
  try {
    const r = await fetch('/api/versus/rooms' + path, { method, keepalive: !!keepalive, headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()), body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { status: r.status, ok: r.ok, data };
  } catch (e) { return { status: 0, ok: false, data: null }; }
}
function vsStop() { if (VS.timer) { clearTimeout(VS.timer); VS.timer = null; } VS.token++; }
function vsSchedule(ms) {
  if (VS.timer) clearTimeout(VS.timer);
  VS.timer = setTimeout(() => { VS.timer = null; vsPoll(); }, Math.max(ms, VS.pausedUntil - Date.now()));
}
async function vsPoll() {
  if (!VS.open || VS.busy || VSG.on) return;   // 작업347: 대결 판이 진행 중이면 방 조회는 대결 흐름이 맡는다
  if (document.hidden) return;   // 탭이 숨겨지면 조회를 멈춘다(다시 보이면 visibilitychange 가 이어 준다)
  const tk = ++VS.token, view = VS.view, roomId = VS.roomId;
  VS.polls++;
  const res = await vsApi('GET', view === 'list' ? '' : '/' + roomId);
  if (tk !== VS.token || !VS.open) return;   // 그 사이 화면이 바뀌었거나 닫혔으면 옛 응답은 버린다
  if (!res.ok) { vsFail(res, view === 'list' ? 'list' : 'room'); return; }
  vsClearToast(true);
  if (view === 'list') { vsRenderList(res.data && res.data.rooms); vsSchedule(VS_T.list); return; }
  const d = res.data || {}, st = d.room && d.room.status;
  if (st === 'closed' || st === 'finished') { VS.roomId = null; vsToast('gone', '방이 닫혔어요.'); vsShowList(); return; }
  vsRenderRoom(d);
  vsSchedule(VS_T.room);
}
function vsFail(res, ctx) {
  const s = res.status, msg = res.data && res.data.error;
  if (s === 401) { vsStop(); vsToast('401', '로그인이 필요해요. 다시 로그인해 주세요.'); return; }
  if (s === 403 && (ctx !== 'room' || /권한/.test(msg || ''))) {   // 대결 권한이 없다: 메뉴를 숨기고 안내만 남긴다
    vsStop(); canVersus = false; VS.roomId = null;
    if (vsModeBtn) { vsModeBtn.remove(); vsModeBtn = null; }
    vsShow('vsDeniedView'); vsToast('403', VS_DENIED); $('vsDeniedClose').focus(); return;
  }
  if (s === 403 || s === 404 || s === 409) {   // 방이 사라졌거나 참가할 수 없다: 목록으로 돌아간다(목록은 새로 조회한다)
    const code = res.data && res.data.code;
    const text = ctx === 'create' ? (s === 409 ? VS_TXT.hasRoom : (msg || '방을 만들 수 없어요.'))
      : ctx === 'join' ? (s === 409 ? (code === 'has_room' ? VS_TXT.hasRoom : VS_TXT.unavailable) : '참가할 수 없는 방이에요. 가득 찼거나 닫혔을 수 있어요.')
      : (s === 404 && (ctx === 'room' || ctx === 'start')) ? VS_TXT.gone : '방이 없어졌어요. 목록으로 돌아갈게요.';
    VS.roomId = null; vsToast(String(s), text); vsShowList(); return;
  }
  if (s === 429) { VS.pausedUntil = Date.now() + VS_T.backoff; vsToast('429', '요청이 많아요. 잠시 후 다시 시도할게요.'); }
  else if (s === 503) { VS.pausedUntil = Date.now() + VS_T.backoff; vsToast('503', '지금은 대결을 쓸 수 없어요. 나중에 다시 해 주세요.'); }
  else if (s === 0) vsToast('net', '네트워크에 연결하지 못했어요. 잠시 후 다시 시도할게요.');
  else if (s === 400) vsToast('400', msg || '요청이 올바르지 않아요.');
  else vsToast('err', '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  vsSchedule(ctx === 'room' || ctx === 'start' ? VS_T.room : VS_T.list);   // 쉬었다가 이어 간다(만들기·참가가 실패했을 때는 목록 조회로 돌아간다)
}
function vsFmtElapsed(sec) { const s = Math.max(0, Math.floor(sec || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function vsRenderList(rooms) {
  const ul = $('vsList'); ul.textContent = '';
  const arr = Array.isArray(rooms) ? rooms : [];
  for (const r of arr) {
    const li = document.createElement('li'), box2 = document.createElement('span'), nm = document.createElement('span'), meta = document.createElement('span'), b = document.createElement('button');
    nm.className = 'vn'; nm.textContent = String(r.hostName || '플레이어') + (r.mine ? ' (내 방)' : '');
    meta.className = 'vm'; meta.textContent = ' 경과 ' + vsFmtElapsed(r.elapsedSec) + ' · ' + (r.hostRunning ? '달리는 중' : '대기 중');
    box2.style.minWidth = '0'; box2.appendChild(nm); box2.appendChild(document.createElement('br')); box2.appendChild(meta);
    b.type = 'button'; b.className = 'toggle vsbtn'; b.dataset.room = r.id; b.dataset.mine = r.mine ? '1' : '';
    b.textContent = r.mine ? '들어가기' : '참가';
    li.appendChild(box2); li.appendChild(b); ul.appendChild(li);
  }
  $('vsEmpty').hidden = arr.length > 0;
}
function vsRenderRoom(d) {
  if (d.round) VS.round = d.round;
  const me = d.me || {}, opp = d.opponent, full = d.room && d.room.status === 'full' && !!opp;
  const nextView = full ? 'ready' : 'wait';
  const first = VS.view !== nextView;
  VS.view = nextView;
  vsShow('vsRoomView');
  const ul = $('vsPlayers'); ul.textContent = '';
  const add = (label, name) => { const li = document.createElement('li'); const a = document.createElement('span'); a.className = 'vn'; a.textContent = name || '플레이어'; const m = document.createElement('span'); m.className = 'vm'; m.textContent = label; li.appendChild(a); li.appendChild(m); ul.appendChild(li); };
  if (full) {
    $('vsRoomText').textContent = opp.left ? '상대가 나갔어요.' : opp.running ? '상대가 이미 달리는 중이에요. 시작하면 바로 겨뤄요.' : '두 사람이 모였어요. 시작을 누르면 달려요.';
    add('나', me.name); add('상대', opp.name);
  } else {
    $('vsRoomText').textContent = '상대를 기다리는 중이에요.';
    add('방장', me.name);
  }
  $('vsGo').textContent = full ? '시작' : '먼저 달리기';
  $('vsLeave').textContent = full ? '나가기' : '취소';
  if (first) $('vsGo').focus();
}
function vsShowList() {
  VS.view = 'list'; VS.round = 0; vsShow('vsListView'); $('vsList').textContent = ''; $('vsEmpty').hidden = true;
  vsStop(); vsPoll();
  const b = $('vsCreate'); if (b && !b.disabled) b.focus();
}
function vsOpen() {
  if (!canVersus || VS.open) return;
  VS.open = true; VS.pausedUntil = 0; els.start.hidden = true; $('vs').hidden = false; vsClearToast(false);
  vsShowList();
}
// 내 방이 있으면 나간다. 실패해도 화면은 계속 동작한다
function vsLeaveCall(roomId, keepalive) { if (!roomId) return Promise.resolve(); return vsApi('POST', '/' + roomId + '/leave', {}, keepalive).catch(() => {}); }
function vsClose() {
  const rid = VS.roomId;
  vsgReset();
  vsStop(); VS.open = false; VS.roomId = null; VS.view = ''; VS.busy = false;
  $('vs').hidden = true; els.start.hidden = false; vsClearToast(false);
  vsLeaveCall(rid);
  if (vsModeBtn) vsModeBtn.focus(); else els.startBtn.focus();
}
async function vsLeaveToList() {
  const rid = VS.roomId;
  if (VS.busy) return;
  VS.busy = true; vsStop();
  if (rid) await vsLeaveCall(rid);
  VS.busy = false; VS.roomId = null;
  vsgReset();
  if (!VS.open) return;
  vsClearToast(false); vsShowList();
}
async function vsCreate() {
  if (VS.busy) return;
  if (vsWords < VS_MIN_WORDS) { vsToast('words', '대결은 단어가 ' + VS_MIN_WORDS + '개 이상 있어야 해요 (지금 ' + vsWords + '개)'); return; }
  VS.busy = true; vsStop();
  const res = await vsApi('POST', '', {});
  VS.busy = false;
  if (!VS.open) { if (res.ok && res.data && res.data.roomId) vsLeaveCall(res.data.roomId); return; }   // 기다리는 사이 닫았다면 방을 바로 닫는다
  if (!res.ok || !res.data || !res.data.roomId) { vsFail(res, 'create'); return; }
  vsClearToast(false); VS.roomId = res.data.roomId; VS.view = 'wait'; VS.round = 1;   // 새 방의 첫 판은 1
  $('vsRoomText').textContent = '상대를 기다리는 중이에요.'; $('vsPlayers').textContent = ''; $('vsGo').textContent = '먼저 달리기'; $('vsLeave').textContent = '취소';
  vsShow('vsRoomView'); $('vsGo').focus();
  vsPoll();
}
async function vsJoin(roomId, mine) {
  if (VS.busy) return;
  if (mine) { vsStop(); VS.roomId = roomId; VS.view = 'wait'; vsClearToast(false); vsPoll(); return; }
  if (vsWords < VS_MIN_WORDS) { vsToast('words', '대결은 단어가 ' + VS_MIN_WORDS + '개 이상 있어야 해요 (지금 ' + vsWords + '개)'); return; }
  VS.busy = true; vsStop();
  const res = await vsApi('POST', '/' + roomId + '/join', {});
  VS.busy = false;
  if (!VS.open) { if (res.ok) vsLeaveCall(roomId); return; }
  if (!res.ok) { vsFail(res, 'join'); return; }
  vsClearToast(false); VS.roomId = roomId; VS.view = 'ready';
  vsRenderRoom(res.data || {});
  vsSchedule(VS_T.room);
}
// ---------- 작업347: 대결 게임 연결(시작·상태 신호·상대 진행 막대·종료·결과). 작업348: 다시 하기·판 번호·예외 처리 ----------
// POST state 의 응답에 상대의 공개 상태가 들어 있으므로, 달리는 동안은 상태 신호가 곧 상대 조회다(요청 수를 늘리지 않는다).
// 판 번호(round)는 서버 view 에서 받아 start·state·finish 에 함께 보낸다. 서버가 불일치(409 round_mismatch)를 알리면 방 상태를 다시 조회해 최신 판으로 맞춘다.
const VSG = { on: false, running: false, ended: false, finActive: false, roomId: null, timer: null, finTimer: null, nudgeTimer: null, toastTimer: null, token: 0,
  inflight: false, pending: false, lost: false, lastSendAt: 0, lastHp: -1, sends: 0, maxInflight: 0, pausedUntil: 0, opp: null, oppKnown: false, contSaved: null, mine: null, finishCalls: 0,
  round: 0, quitOpen: false, roomGone: false, finBody: null, finBusy: false, rematchBusy: false, resultShown: false, resKey: '', rematchGone: false };
const vsgBody = () => { const b = { score: Math.max(0, Math.round(G.score)), combo: Math.max(0, Math.round(G.combo)), hp: Math.max(0, Math.min(CONFIG.HP, Math.round(G.hp))), maxHp: CONFIG.HP, wordNo: G.wi + 1, continued: !!G.contUsed }; if (VSG.round) b.round = VSG.round; return b; };
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };   // 같은 문구로 다시 쓰지 않는다(스크린리더가 같은 안내를 되풀이하지 않게)
function vsgToast(text) {
  const el = $('vsToast');
  if (!el.hidden && el.textContent === text) return;   // 같은 안내를 연달아 띄우지 않는다
  el.textContent = text; el.hidden = false;
  if (VSG.toastTimer) clearTimeout(VSG.toastTimer);
  VSG.toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
function vsgRenderBar() {
  const o = VSG.opp, off = VSG.running && !VSG.ended;
  $('vsBar').hidden = !off; $('vsQuitBtn').hidden = !off;
  if (VSG.roomGone) { setText($('vsBarName'), '방 연결 끊김'); setText($('vsBarStats'), '기록은 남지 않아요'); return; }
  if (!o) { setText($('vsBarName'), '상대'); setText($('vsBarStats'), '상대를 기다리는 중'); return; }
  setText($('vsBarName'), o.name + (o.disconnected ? ' · 연결 끊김' : o.left ? ' · 나감' : o.finished ? ' · 상대 종료' : ''));
  setText($('vsBarStats'), (o.running || o.finished) ? '체력 ' + o.hp + '/' + o.maxHp + ' · 점수 ' + o.score.toLocaleString('en-US') + ' · 콤보 ' + o.combo + ' · 단어 ' + o.wordNo : '아직 시작 전');
}
function vsgApplyView(v) {
  if (!v) return;
  VSG.opp = v.opponent || null;
  if (VSG.opp && !VSG.oppKnown) { VSG.oppKnown = true; vsgToast('상대가 들어왔어요'); }   // 내 달리기 도중 들어오면 한 번만
  vsgRenderBar();
  if (v.me && v.me.finished && !VSG.ended) vsgServerEnded(v);
}
// 상태 신호: 1초마다. 이전 요청이 끝나기 전에는 겹쳐 보내지 않고(nudge 는 끝난 뒤 한 번만), 숨겨진 동안은 보내지 않는다
async function vsgSend(nudge) {
  if (!VSG.running || VSG.ended || VSG.lost) return;
  if (document.hidden || Date.now() < VSG.pausedUntil) return;
  if (VSG.inflight) { if (nudge) VSG.pending = true; return; }
  const gap = 200 - (Date.now() - VSG.lastSendAt);
  if (nudge && gap > 0) { if (!VSG.nudgeTimer) VSG.nudgeTimer = setTimeout(() => { VSG.nudgeTimer = null; vsgSend(true); }, gap); return; }   // 즉시 보내기도 초당 5번을 넘지 않게
  VSG.inflight = true; VSG.pending = false; VSG.lastSendAt = Date.now(); VSG.sends++; VSG.maxInflight = Math.max(VSG.maxInflight, 1);
  VSG.lastHp = G.hp;
  const res = await vsApi('POST', '/' + VSG.roomId + '/state', vsgBody());
  VSG.inflight = false;
  if (!VSG.running || VSG.ended) return;
  if (res.ok) vsgApplyView(res.data); else await vsgSendFailed(res);
  if (VSG.pending && VSG.running && !VSG.ended) vsgSend(true);
}
// 서버가 다시 시작돼 방이 사라졌다(404): 게임은 멈추지 않고 끝까지 달린다. 신호만 멈추고 한 번만 알린다. 끝나면 겨루지 못했다는 안내와 내 기록을 보인다
function vsgRoomGone() {
  if (VSG.roomGone) return;
  VSG.roomGone = true; VSG.lost = true;
  if (VSG.timer) { clearInterval(VSG.timer); VSG.timer = null; }
  if (VSG.nudgeTimer) { clearTimeout(VSG.nudgeTimer); VSG.nudgeTimer = null; }
  if (VSG.running && !VSG.ended) { vsgToast('방 연결이 끊겨 기록은 남지 않아요'); vsgRenderBar(); }
}
async function vsgSendFailed(res) {
  const s = res.status;
  if (s === 429) { VSG.pausedUntil = Date.now() + VS_T.backoff; return; }
  if (s === 401) { VSG.lost = true; return; }
  if (s === 404) { vsgRoomGone(); return; }
  if (s === 403 || s === 409) {   // 내 판이 서버에서 끝났거나(30초 무신호 등) 판 번호가 다르다: 조회로 확인한다
    const g = await vsApi('GET', '/' + VSG.roomId);
    if (!VSG.running || VSG.ended) return;
    if (g.ok) {
      if (g.data && g.data.round > VSG.round) { vsgGoReady(g.data); return; }
      vsgApplyView(g.data); if (!VSG.ended) VSG.lost = true;   // 끝난 게 아니면 신호만 멈춘다
    } else if (g.status === 404) vsgRoomGone(); else VSG.lost = true;
  }
  // 400·서버 오류·네트워크 오류: 게임을 멈추지 않고 다음 주기에 최신 값을 다시 보낸다
}
function vsgNudge() { if (VSG.running && !VSG.ended && G.hp !== VSG.lastHp) vsgSend(true); }
function vsgStopTimers() {
  if (VSG.timer) { clearInterval(VSG.timer); VSG.timer = null; }
  if (VSG.nudgeTimer) { clearTimeout(VSG.nudgeTimer); VSG.nudgeTimer = null; }
  if (VSG.finTimer) { clearTimeout(VSG.finTimer); VSG.finTimer = null; }
  VSG.token++;
}
function vsgHideInGame() {   // 달리는 중에만 보이는 것(막대·나가기·확인 대화상자)을 감춘다
  $('vsBar').hidden = true; $('vsQuitBtn').hidden = true;
  if (VSG.quitOpen) { VSG.quitOpen = false; $('vsQuit').hidden = true; }
}
function vsgReset() {
  vsgStopTimers();
  if (VSG.contSaved !== null) { CONFIG.CONT_ENABLED = VSG.contSaved; VSG.contSaved = null; }
  Object.assign(VSG, { on: false, running: false, ended: false, finActive: false, roomId: null, inflight: false, pending: false, lost: false, opp: null, oppKnown: false, mine: null,
    round: 0, roomGone: false, finBody: null, finBusy: false, rematchBusy: false, resultShown: false, resKey: '', rematchGone: false });
  vsgHideInGame(); $('vsToast').hidden = true;
}
// 게임을 멈춘다(서버가 내 판을 끝냈을 때·나갈 때·새 판으로 갈 때)
function vsgHaltGame() {
  if (G.state !== 'over') { G.state = 'over'; G.bossMode = false; clearIntro(); els.cont.hidden = true; box.classList.remove('boss'); els.pop.hidden = true; els.hud.hidden = true; els.bossBanner.hidden = true; stopVoices(); }
}
function vsgBegin(P, roomId, view) {
  VSG.running = true; VSG.ended = false; VSG.roomId = roomId; VSG.lost = false; VSG.inflight = false; VSG.pending = false; VSG.lastHp = -1; VSG.sends = 0; VSG.pausedUntil = 0; VSG.finishCalls = 0;
  VSG.round = (view && view.round) || VS.round || 0; VSG.roomGone = false; VSG.finBody = null; VSG.finBusy = false; VSG.rematchBusy = false; VSG.resultShown = false; VSG.resKey = ''; VSG.rematchGone = false; VSG.quitOpen = false;
  VSG.opp = view && view.opponent || null; VSG.oppKnown = !!VSG.opp;   // 시작할 때 이미 상대가 있으면 입장 안내는 없다
  VSG.contSaved = CONFIG.CONT_ENABLED; CONFIG.CONT_ENABLED = true;   // 대결은 이어하기가 켜진 규칙으로 겨룬다(주소 옵션 continue=0 도 이번 판에는 적용하지 않는다)
  $('vs').hidden = true; els.start.hidden = true; $('vsQuit').hidden = true;
  startRound(false, P);
  vsgRenderBar();
  VSG.timer = setInterval(() => vsgSend(false), VS_T.signal);
  vsgSend(true);
}
function vsFmtSec(s) { const v = Math.max(0, Number(s) || 0), m = Math.floor(v / 60); return m + ':' + (v - m * 60).toFixed(1).padStart(4, '0'); }
function vsgLi(label, parts) {
  const li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('span');
  a.className = 'vn'; a.textContent = label; b.className = 'vm'; b.textContent = parts; li.appendChild(a); li.appendChild(b); return li;
}
function vsgSideText(side) {
  return '생존 ' + vsFmtSec(side.survivalSec) + ' · 점수 ' + side.score.toLocaleString('en-US') + ' · 푼 단어 ' + side.wordCount + '개 · 이어하기 ' + (side.continued ? '사용' : '안 씀') + (side.disconnected ? ' · 연결 끊김' : '');
}
// 결과 화면의 보조 단추(다시 하기·다시 보내기)와 문구를 처음 상태로 돌린다
function vsgFinChrome() {
  $('vsFinRematch').hidden = true; setText($('vsFinRematchNote'), ''); $('vsFinRetry').hidden = true; setText($('vsFinRooms'), '방 목록으로');
}
function vsgShowFin(v, note) {
  vsStop(); VS.view = 'fin'; VSG.finActive = true; VSG.resultShown = false; VSG.resKey = '';
  $('vs').hidden = false; els.start.hidden = true; vsShow('vsFinView');
  vsgFinChrome();
  setText($('vsFinTitle'), '결과를 기다리는 중이에요'); setText($('vsFinWhy'), ''); setText($('vsFinNote'), note || '');
  const ul = $('vsFinList'); ul.textContent = '';
  const m = VSG.mine;
  if (m) ul.appendChild(vsgLi('나', vsgSideText(m)));
  const o = VSG.opp;
  ul.appendChild(vsgLi(o ? o.name : '상대', !o ? '상대를 기다리는 중' : o.disconnected ? '연결 끊김' : o.finished ? '상대 종료' : (o.running ? '체력 ' + o.hp + '/' + o.maxHp + ' · 점수 ' + o.score.toLocaleString('en-US') + ' · 콤보 ' + o.combo + ' · 단어 ' + o.wordNo : '아직 시작 전')));
  if (!$('vsFinView').contains(document.activeElement)) $('vsFinRooms').focus();
}
// 다시 하기 영역: 서버 view 의 rematch 로 그린다(버튼은 누를 수 있을 때만 보인다)
function vsgRenderRematch(v) {
  const btn = $('vsFinRematch'), rm = v.rematch || {}, opp = v.opponent;
  let can = false, txt = '';
  if (VSG.rematchGone) txt = '방이 사라져 다시 하기를 할 수 없어요.';
  else if (!opp || opp.left) txt = '상대가 방을 나가서 다시 할 수 없어요.';
  else if (rm.available === false) txt = '상대의 연결이 끊겨 있어서 지금은 다시 할 수 없어요.';
  else if (rm.me) txt = '상대의 다시 하기를 기다리는 중이에요.';
  else { can = true; txt = rm.opponent ? '상대가 다시 하기를 원해요.' : ''; }
  const had = document.activeElement === btn;
  btn.hidden = !can; setText($('vsFinRematchNote'), txt);
  if (had && !can) $('vsFinRooms').focus();
}
function vsgShowResult(v) {
  const r = v.result, w = r.winner;
  VSG.resultShown = true;
  const notes = [];
  if (r.me.disconnected) notes.push('연결이 끊겨 종료됐어요.');
  if (r.leftMid && r.leftMid.opponent) notes.push('상대가 중간에 나갔어요.');
  const key = JSON.stringify([r, notes]);
  if (key !== VSG.resKey) {   // 내용이 바뀐 때만 다시 그린다(1초마다 조회해도 깜빡이지 않게)
    VSG.resKey = key;
    vsgFinChrome();
    setText($('vsFinTitle'), w === 'me' ? '승리' : w === 'opponent' ? '패배' : '무승부');
    setText($('vsFinWhy'), r.reason === 'survival' ? '생존 시간이 ' + r.diffSec.toFixed(1) + '초 더 길어서 판정됐어요.' : r.reason === 'score' ? '생존 시간이 1.5초 이내로 비슷해서 점수로 판정됐어요.' : '생존 시간과 점수가 모두 같아요.');
    setText($('vsFinNote'), notes.join(' '));
    const ul = $('vsFinList'); ul.textContent = '';
    ul.appendChild(vsgLi((r.me.name || '나') + ' (나)', vsgSideText(r.me)));
    ul.appendChild(vsgLi(r.opponent.name || '상대', vsgSideText(r.opponent)));
  }
  vsgRenderRematch(v);
}
// 방이 사라졌다(서버 재시작): 겨루지 못했다는 안내와 내 기록, 방 목록으로
function vsgShowGone() {
  vsgStopTimers(); VSG.finActive = false; VSG.resultShown = false; VSG.resKey = '';
  vsStop(); VS.view = 'fin';
  $('vs').hidden = false; els.start.hidden = true; vsShow('vsFinView'); vsgFinChrome();
  setText($('vsFinTitle'), '방이 사라져 결과를 겨루지 못했어요.'); setText($('vsFinWhy'), ''); setText($('vsFinNote'), '서버가 다시 시작됐을 수 있어요. 내 기록은 남지 않아요.');
  const ul = $('vsFinList'); ul.textContent = '';
  if (VSG.mine) ul.appendChild(vsgLi('나', vsgSideText(VSG.mine)));
  if (!$('vsFinView').contains(document.activeElement)) $('vsFinRooms').focus();
}
// 내 판이 끝났다: 결과를 서버에 보내고(실패하면 한 번 더) 상대를 기다린다. 끝내 실패하면 다시 보내기·그냥 나가기
async function vsgOver() {
  VSG.ended = true; vsgStopTimers(); vsgHideInGame();
  const sec = Math.round(Math.max(0, G.time - G.startTime) * 1000) / 1000;   // 게임이 쓰는 생존 시간(탭이 가려진 동안·선택 화면은 흐르지 않는다)
  const body = { survivalSec: sec, score: Math.max(0, Math.round(G.score)), wordCount: G.wordsDone, continued: !!G.contUsed };
  if (VSG.round) body.round = VSG.round;
  VSG.finBody = body;
  VSG.mine = { survivalSec: sec, score: body.score, wordCount: body.wordCount, continued: body.continued, disconnected: false };
  if (VSG.roomGone) { vsgShowGone(); return; }   // 방이 이미 사라졌다: 보낼 곳이 없다
  vsgShowFin(null, '결과를 보내는 중이에요.');
  await vsgSendFinish(true);
}
async function vsgSendFinish(withRetry) {
  const tk = VSG.token;
  let res = null;
  for (let i = 0; i < (withRetry ? 2 : 1); i++) {
    VSG.finishCalls++;
    res = await vsApi('POST', '/' + VSG.roomId + '/finish', VSG.finBody);
    if (tk !== VSG.token || !VSG.on) return;
    if (res.ok || [400, 401, 403, 404, 409].includes(res.status)) break;
    if (i + 1 < (withRetry ? 2 : 1)) { await new Promise(r => setTimeout(r, 800)); if (tk !== VSG.token || !VSG.on) return; }
  }
  if (res.status === 404) { vsgShowGone(); return; }
  if (!res.ok && res.status !== 409) {   // 끝내 실패: 같은 값을 다시 보내거나(멱등) 그냥 나갈 수 있다
    VSG.finActive = false; vsgFinChrome();
    setText($('vsFinNote'), '결과를 서버에 보내지 못했어요. 다시 보내거나 그냥 나갈 수 있어요.');
    $('vsFinRetry').hidden = false; $('vsFinRetry').disabled = false; setText($('vsFinRooms'), '그냥 나가기');
    $('vsFinRetry').focus();
    return;
  }
  VSG.finActive = true; vsgFinChrome(); setText($('vsFinNote'), '');
  if (res.ok) vsgFinApply(res.data);
  if (VSG.on && VSG.finActive) vsgFinPollSoon(0);
}
async function vsgRetryFinish() {
  if (VSG.finBusy || !VSG.finBody || !VSG.on) return;
  VSG.finBusy = true; $('vsFinRetry').disabled = true; setText($('vsFinNote'), '결과를 다시 보내는 중이에요.');
  await vsgSendFinish(false);
  VSG.finBusy = false;
}
// 서버가 내 판이 끝났다고 알렸다(30초 무신호 등): 게임을 멈추고 같은 흐름으로
function vsgServerEnded(v) {
  VSG.ended = true; vsgStopTimers(); vsgHideInGame(); vsgHaltGame();
  const me = v.me || {};
  VSG.mine = { survivalSec: me.survivalSec || 0, score: me.score || 0, wordCount: me.wordCount || 0, continued: !!me.continued, disconnected: !!me.disconnected };
  vsgShowFin(v, me.disconnected ? '연결이 끊겨 종료됐어요. 상대가 끝나면 결과가 나오고, 그때 다시 하기를 할 수 있어요.' : '서버에서 판이 끝난 것으로 처리됐어요.');
  if (v.result) vsgShowResult(v);
  vsgFinPollSoon(0);
}
// 새 판이 열렸다(서버 round 증가, 결과 없음): 게임 화면을 정리하고 준비 화면으로. 미리 보기·시작 흐름은 일반 대결과 같다
function vsgGoReady(v) {
  vsgHaltGame();
  vsgReset();
  VS.round = v.round; VS.view = ''; vsClearToast(false);
  $('vs').hidden = false; els.start.hidden = true;
  vsRenderRoom(v);
  vsSchedule(VS_T.room);
}
function vsgFinApply(v) {
  if (!v) return;
  if (v.round > VSG.round && !v.result) { vsgGoReady(v); return; }
  VSG.opp = v.opponent || null;
  if (v.me && v.me.finished) VSG.mine = { survivalSec: v.me.survivalSec || 0, score: v.me.score || 0, wordCount: v.me.wordCount || 0, continued: !!v.me.continued, disconnected: !!v.me.disconnected };
  if (v.result) { vsgShowResult(v); return; }
  if (VSG.finActive) { const n = $('vsFinNote').textContent; vsgShowFin(v, n); }
}
// 결과를 기다리는 동안과 결과가 나온 뒤(다시 하기 대기)에도 같은 주기(VS_T.fin)로 방을 조회한다
function vsgFinPollSoon(ms) {
  if (VSG.finTimer) clearTimeout(VSG.finTimer);
  const tk = VSG.token;
  VSG.finTimer = setTimeout(async () => {
    VSG.finTimer = null;
    if (tk !== VSG.token || !VSG.on || !VSG.finActive) return;
    if (document.hidden) return;   // 숨겨지면 멈춘다(다시 보이면 이어 간다)
    const res = await vsApi('GET', '/' + VSG.roomId);
    if (tk !== VSG.token || !VSG.on || !VSG.finActive) return;
    if (res.ok) {
      const v = res.data, st = v.room && v.room.status;
      if (!v.result && st === 'closed' && !v.opponent) { VSG.finActive = false; setText($('vsFinTitle'), '상대 없이 끝났어요'); setText($('vsFinNote'), '상대가 들어오지 않아 결과를 겨루지 못했어요.'); return; }
      vsgFinApply(v);
    } else if (res.status === 404) {
      if (VSG.resultShown) { VSG.rematchGone = true; $('vsFinRematch').hidden = true; setText($('vsFinRematchNote'), '방이 사라져 다시 하기를 할 수 없어요.'); VSG.finActive = false; return; }
      vsgShowGone(); return;
    } else if (res.status === 403) { VSG.finActive = false; setText($('vsFinNote'), '방에 접근할 수 없어요. 방 목록으로 돌아가 주세요.'); return; }
    else if (res.status === 429) VSG.pausedUntil = Date.now() + VS_T.backoff;
    if (VSG.on && VSG.finActive) vsgFinPollSoon(res.status === 429 ? VS_T.backoff : VS_T.fin);
  }, ms);
}
// 결과 화면의 "다시 하기": 내 의사를 서버에 알린다. 양쪽이 모두 눌렀으면 응답이 곧 새 판(round 증가)이다
async function vsgRematch() {
  if (VSG.rematchBusy || !VSG.on || !VSG.roomId) return;
  VSG.rematchBusy = true;
  const tk = VSG.token;
  const res = await vsApi('POST', '/' + VSG.roomId + '/rematch', {});
  VSG.rematchBusy = false;
  if (tk !== VSG.token || !VSG.on) return;
  if (res.ok) { vsgFinApply(res.data); return; }
  if (res.status === 404) { VSG.rematchGone = true; VSG.finActive = false; $('vsFinRematch').hidden = true; setText($('vsFinRematchNote'), '방이 사라져 다시 하기를 할 수 없어요.'); $('vsFinRooms').focus(); return; }
  if (res.status === 409) {   // 막혔거나(상대 나감·끊김) 그 사이 새 판이 열렸다: 조회로 맞춘 뒤 사유를 보인다
    const g = await vsApi('GET', '/' + VSG.roomId);
    if (tk !== VSG.token || !VSG.on) return;
    if (g.ok) { vsgFinApply(g.data); if (!VSG.on || !(g.data.result)) return; }
    const msg = res.data && res.data.error; if (msg) setText($('vsFinRematchNote'), msg);
    return;
  }
  if (res.status === 429) { VSG.pausedUntil = Date.now() + VS_T.backoff; setText($('vsFinRematchNote'), '요청이 많아요. 잠시 후 다시 눌러 주세요.'); return; }
  setText($('vsFinRematchNote'), res.status === 0 ? '네트워크에 연결하지 못했어요. 다시 눌러 주세요.' : '문제가 생겼어요. 잠시 후 다시 눌러 주세요.');
}
// 게임 중 나가기: 확인 대화상자가 열려 있는 동안 게임 시간은 멈춘다(step 이 쉰다. 이어하기 선택 화면과 같은 방식). 상태 신호는 계속 가서 연결은 유지된다
function vsgQuitOpen() {
  if (!VSG.running || VSG.ended || VSG.quitOpen) return;
  VSG.quitOpen = true; $('vsQuit').hidden = false;
  els.live.textContent = '나가기 확인';
  $('vsQuitStay').focus();
}
function vsgQuitClose(refocus) {
  if (!VSG.quitOpen) return;
  VSG.quitOpen = false; $('vsQuit').hidden = true;
  if (refocus && !$('vsQuitBtn').hidden) $('vsQuitBtn').focus();
}
async function vsgQuitConfirm() {
  if (!VSG.quitOpen) return;
  vsgQuitClose(false);
  VSG.ended = true; vsgStopTimers(); vsgHideInGame(); vsgHaltGame();   // 서버는 leave 로 지금 기록(경과 시간·마지막 점수)을 종료 기록으로 삼는다
  $('vs').hidden = false; els.start.hidden = true;
  await vsLeaveToList();
}
// 방 화면의 "시작" / "먼저 달리기": (미리 보기) → POST start → 게임. 서버 시작 알림은 미리 보기가 끝나고 실제로 시작하는 시점에 보낸다
async function vsGo() {
  tryFs();   // 작업355: 사용자 탭 안에서 전체 화면 시도(거부·미지원은 조용히)
  if (VS.busy || VSG.on || !VS.roomId) return;
  if (vsWords < VS_MIN_WORDS) { vsToast('words', '대결은 단어가 ' + VS_MIN_WORDS + '개 이상 있어야 해요 (지금 ' + vsWords + '개)'); return; }
  const roomId = VS.roomId;
  vsStop(); vsClearToast(false);
  VSG.on = true;   // 이번 판 단어 순서를 생존 모드 규칙으로 정한다(새 판도 매번 새로 정한다)
  const P = planPool(false);
  if (!P.pool.length) { VSG.on = false; vsPoll(); return; }
  const backToRoom = () => { VSG.on = false; $('vs').hidden = false; els.start.hidden = true; if (VS.open) vsPoll(); };
  const begin = async () => {
    VS.busy = true;
    const sb = { wordCount: vsWords }; if (VS.round) sb.round = VS.round;
    const res = await vsApi('POST', '/' + roomId + '/start', sb);
    VS.busy = false;
    if (!VS.open) { VSG.on = false; return; }
    if (!res.ok) {
      VSG.on = false; $('vs').hidden = false; els.start.hidden = true;
      if (res.status === 409 && res.data && res.data.code === 'round_mismatch') { vsToast('round', '방 상태가 바뀌어 새로 맞췄어요. 다시 시작해 주세요.'); vsPoll(); return; }   // 판 번호가 달랐다: 방을 다시 조회해 최신 판으로 맞춘다
      vsFail(res, 'start'); return;
    }
    vsgBegin(P, roomId, res.data);
  };
  $('vs').hidden = true; primeAudio();
  if (previewOn) previewRun(P.pool.map(w => ({ word: w.word, meaning: w.meaning })), begin, backToRoom);
  else begin();
}
// 작업350: 앱이 다시 보일 때(visibilitychange)와 페이지 보관에서 돌아올 때(pageshow persisted)의 재개는 같은 동작이다.
// 브라우저에 따라 둘이 함께 오거나 하나만 올 수 있어서, 같은 재개가 0.5초 안에 두 번 일어나지 않게 시각을 적어 둔다.
let vsResumedAt = 0;
function vsResumeGame() {
  if (VSG.running && !VSG.ended) vsgSend(true);   // 달리는 중이면 즉시 한 번
  else if (VSG.on && VSG.ended && VSG.finActive && !VSG.finTimer) vsgFinPollSoon(0);   // 결과 대기 중이면 결과 조회
}
function vsResumeRoom() {
  if (VS.open && !VS.timer && !VS.busy && VS.view && !VSG.on) vsPoll();   // 방 화면·목록이면 조회 재개
}
function setupVersusGameUI() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    vsResumedAt = Date.now();
    vsResumeGame();
  });
  window.addEventListener('pageshow', e => {
    if (!e.persisted || document.hidden) return;   // 보관에서 돌아온 경우만(처음 열림은 해당 없음)
    if (Date.now() - vsResumedAt < 500) return;   // 방금 visibilitychange 가 같은 재개를 했다
    vsResumedAt = Date.now();
    vsResumeGame(); vsResumeRoom();
  });
  $('vsQuitBtn').addEventListener('click', vsgQuitOpen);
  $('vsQuitStay').addEventListener('click', () => vsgQuitClose(true));
  $('vsQuitGo').addEventListener('click', vsgQuitConfirm);
  document.addEventListener('keydown', e => {   // 확인 대화상자: Esc 는 "계속 달리기", Tab 은 두 단추 사이만 돈다
    if (!VSG.quitOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); vsgQuitClose(true); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const f = [$('vsQuitStay'), $('vsQuitGo')], i = f.indexOf(document.activeElement);
      f[i < 0 ? 0 : (i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    }
  }, true);
  $('vsFinRematch').addEventListener('click', vsgRematch);
  $('vsFinRetry').addEventListener('click', vsgRetryFinish);
}
function setupVersusUI() {
  $('vsCreate').addEventListener('click', vsCreate);
  $('vsRefresh').addEventListener('click', () => { if (VS.view === 'list' && !VS.busy) { vsStop(); vsPoll(); } });
  $('vsClose').addEventListener('click', vsClose);
  $('vsDeniedClose').addEventListener('click', vsClose);
  $('vsLeave').addEventListener('click', vsLeaveToList);
  $('vsGo').addEventListener('click', vsGo);
  $('vsFinRooms').addEventListener('click', vsLeaveToList);
  $('vsFinClose').addEventListener('click', vsClose);
  $('vsList').addEventListener('click', e => { const b = e.target.closest && e.target.closest('button[data-room]'); if (b && !b.disabled) vsJoin(b.dataset.room, !!b.dataset.mine); });
  $('vs').addEventListener('keydown', e => { if (e.key === 'Escape') vsClose(); });
  document.addEventListener('visibilitychange', () => {
    if (!VS.open) return;
    if (document.hidden) { if (VS.timer) { clearTimeout(VS.timer); VS.timer = null; } VS.token++; }   // 숨겨진 동안 조회를 멈춘다
    else vsResumeRoom();
  });
  // 작업350: persisted 가 true 이면 되돌아올 수 있는 보관(bfcache)이라 방을 나가지 않는다. 끝내 안 돌아오면 서버의 30초 무신호 규칙이 처리한다
  window.addEventListener('pagehide', e => { if (e.persisted) return; if (VS.roomId) vsLeaveCall(VS.roomId, true); });
}
// 작업332: 시작 화면 모드 선택. 생존 모드는 단어가 SURV_MIN_WORDS 개 이상일 때만 시작할 수 있다.
function setupModeUI(nWords) {
  if ($('modeRow')) return;
  vsWords = nWords;
  const baseInfo = els.startInfo.textContent;
  const row = document.createElement('div'); row.className = 'trow'; row.id = 'modeRow';
  const mk = (label, val) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'toggle'; b.textContent = label; b.dataset.mode = val; row.appendChild(b); return b; };
  const bN = mk('기본', 'normal'), bS = mk('생존', 'survival');
  const bP = document.createElement('button'); bP.type = 'button'; bP.className = 'toggle vsbtn'; bP.dataset.mode = 'preview'; $('optRow').appendChild(bP);   // 작업345: 미리 보기 켜기/끄기(모드가 아니라 별도 스위치). 작업346: 모드 줄이 아니라 "게임 방법" 옆
  const syncPv = () => { bP.textContent = previewOn ? '미리 보기 켬' : '미리 보기 끔'; bP.setAttribute('aria-pressed', String(previewOn)); };
  syncPv();
  if (canVersus) vsModeBtn = mk('대결', 'versus');   // 작업344: 권한이 있을 때만. 모드가 아니라 방 목록을 여는 버튼이라 aria-pressed 도 저장도 하지 않는다
  $('startInfoCol').parentNode.insertBefore(row, $('startInfoCol'));   // 작업356: 설명 묶음(startInfoCol, 세로에서는 display:contents) 앞 = 이전과 같은 순서
  const apply = () => {
    bN.setAttribute('aria-pressed', String(!survMode)); bS.setAttribute('aria-pressed', String(survMode));
    const need = survMode && nWords < CONFIG.SURV_MIN_WORDS;
    els.startBtn.disabled = need;
    $('modeDesc').textContent = survMode ? '끝없이 이어져요. 얼마나 오래 버티는지 겨뤄요.' : '이번 판 단어 최대 10개를 달려요.';   // 작업346: 선택한 모드의 한 줄 설명(기본은 한 판 최대 10단어, 생존은 단어 5개 이상)
    els.startInfo.textContent = survMode ? '생존 모드 · 체력이 0이 될 때까지 · 5단어마다 보스 · 체력 ' + CONFIG.HP : baseInfo;
    let note = $('survNote'); if (note) note.remove();
    if (need) { note = document.createElement('p'); note.className = 'note'; note.id = 'survNote'; note.setAttribute('role', 'status'); note.textContent = '생존 모드는 단어가 ' + CONFIG.SURV_MIN_WORDS + '개 이상 있어야 시작할 수 있어요 (지금 ' + nWords + '개)'; $('modeDesc').parentNode.insertBefore(note, $('modeDesc').nextSibling); }
    let li = $('survRule');
    if (survMode && !li) { li = document.createElement('li'); li.id = 'survRule'; li.textContent = '생존 모드: 체력이 0이 될 때까지 단어가 계속 나오고, 5단어마다 보스예요. 하트는 갈수록 드물어지고 장애물은 점점 많아져요.'; els.djRule.parentNode.insertBefore(li, els.djRule); }
    else if (!survMode && li) li.remove();
  };
  row.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button'); if (!b) return;
    if (b.dataset.mode === 'versus') { vsOpen(); return; }
    survMode = b.dataset.mode === 'survival';
    try { localStorage.setItem(MODE_KEY, survMode ? 'survival' : 'normal'); } catch (err) { /* 저장 실패는 무시 */ }
    apply();
  });
  bP.addEventListener('click', () => { previewOn = !previewOn; try { localStorage.setItem(PREVIEW_KEY, previewOn ? '1' : '0'); } catch (err) { /* 저장 실패는 무시 */ } syncPv(); });
  apply();
}
// 작업346: "게임 방법" 화면(상세 규칙). 열고 닫아도 모드·미리 보기 설정은 바뀌지 않는다
function setupHelpUI() {
  const open = () => { els.start.hidden = true; $('help').hidden = false; $('helpBtn').setAttribute('aria-expanded', 'true'); $('helpBody').scrollTop = 0; $('helpClose').focus(); };
  const close = () => { $('help').hidden = true; els.start.hidden = false; $('helpBtn').setAttribute('aria-expanded', 'false'); $('helpBtn').focus(); };
  $('helpBtn').addEventListener('click', open);
  $('helpClose').addEventListener('click', close);
  $('help').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
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
  canVersus = me.role === 'admin' || me.perm_versus === true;   // 작업344: 서버가 관리자에게도 perm_versus 를 true 로 준다. 서버 대결 경로가 다시 검사한다
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

// ---------- 작업355: 꽉 찬 화면 · 화면 모드(세로/가로) · 닫기 · 전체 화면 ----------
// 전체 화면은 사용자 탭 안에서만 시도하고(시작·화면 모드 버튼), 거부·미지원(iPhone 포함)은 조용히 넘어간다. 해제돼도 다시 요청하지 않는다.
function tryFs() {
  try {
    const de = document.documentElement;
    if (!document.fullscreenElement && de && de.requestFullscreen) { const p = de.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); }
  } catch (e) { /* 지원 안 함·거부는 조용히 넘어간다 */ }
}
function exitFs() {
  try { if (document.fullscreenElement && document.exitFullscreen) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* 무시 */ }
}
let pendingView = null, srToastTimer = 0;
const viewBusy = () => (G.state !== 'idle' && G.state !== 'over') || VSG.running;
function srToast(text) {
  const el = $('srToast'); el.textContent = text; el.hidden = false;
  clearTimeout(srToastTimer); srToastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
function syncRot() {
  const el = $('rotBand'); if (!el) return;
  el.hidden = !(viewMode === 'land' && !deviceLandscape());   // 가로를 골랐는데 폰이 세로일 때만(게임은 멈추지 않는다)
}
function syncViewUI() {
  const want = pendingView || viewMode;
  const b = $('srView'); if (b) { b.textContent = want === 'land' ? '세로로' : '가로로'; b.setAttribute('aria-label', want === 'land' ? '세로 화면으로 바꾸기' : '가로 화면으로 바꾸기'); }
  document.querySelectorAll('#viewRow [data-view]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.view === want)));
  syncRot();
}
function applyViewMode(m) { pendingView = null; viewMode = m; if (m !== 'land') closeMenu(); syncStream(); resize(); syncViewUI(); }
function setViewMode(m) {
  if (m !== 'port' && m !== 'land') return;
  try { localStorage.setItem(VIEW_KEY, m); } catch (e) { /* 저장 실패는 무시 */ }   // 선택은 곧바로 기억하고, 적용만 판이 끝난 뒤로 미룰 수 있다
  if (m === viewMode) { pendingView = null; syncViewUI(); return; }
  if (viewBusy()) { pendingView = m; srToast(m === 'land' ? '판이 끝나면 가로로 바뀌어요' : '판이 끝나면 세로로 바뀌어요'); syncViewUI(); return; }
  applyViewMode(m);
}
function srClose() {
  if (VSG.on && VSG.running && !VSG.ended) { vsgQuitOpen(); return; }   // 대결 중이면 기존 나가기 확인을 거친다
  exitFs();
  location.href = '/english_dictionary.html#wordbook';   // 지금의 뒤로가기와 같은 곳
}
// 캐릭터 선택: 시작 화면에서만 바뀌고 마지막 선택을 기억한다(주소 옵션 char 는 저장하지 않는다)
function syncCharUI() { document.querySelectorAll('#charRow [data-char]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.char === charKey))); }
function setChar(k) {
  if (!CHARS[k]) return;
  charKey = k; loadChar(k);
  try { localStorage.setItem('spellrun_char', k); } catch (e) { /* 저장 실패는 무시 */ }
  syncCharUI();
}
// ---------- 작업360: 가로 [메뉴] 단추 ----------
// 가로에서는 닫기·화면 바꾸기·소리를 이 메뉴 하나로 합친다(세로는 예전 단추 그대로). 혼자 할 때는 메뉴가 열려 있는 동안 step 이 멈춘다(위 menuPauses).
// 대결에서는 멈추지 않는다. 열고 닫는 것은 게임 상태(G)를 건드리지 않아 시간·점수·타일 위치가 어긋나지 않는다(멈춘 시간은 게임 시간에 들어가지 않고, 다시 시작할 때 frame 이 dt 를 0.05초로 제한한다).
const MENU = { open: false };
const menuPauses = () => MENU.open && !VSG.on && G.state !== 'idle' && G.state !== 'over';
function openMenu() {
  if (viewMode !== 'land' || MENU.open) return;
  MENU.open = true; $('srMenu').hidden = false; $('srMenuBtn').setAttribute('aria-expanded', 'true');
  try { $('srMenuCont').focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
}
function closeMenu() {
  if (!MENU.open) return;
  MENU.open = false; $('srMenu').hidden = true; $('srMenuBtn').setAttribute('aria-expanded', 'false');
}
let viewUIReady = false;
function setupViewUI() {
  if (viewUIReady) return;
  viewUIReady = true;
  $('srClose').addEventListener('click', srClose);
  $('srMenuBtn').addEventListener('click', () => { if (MENU.open) closeMenu(); else openMenu(); });
  $('srMenuCont').addEventListener('click', closeMenu);
  $('srMenuSnd').addEventListener('click', toggleSound);
  $('srMenuView').addEventListener('click', () => { closeMenu(); tryFs(); setViewMode('port'); });
  $('srMenuClose').addEventListener('click', () => { closeMenu(); srClose(); });
  $('srView').addEventListener('click', () => { tryFs(); setViewMode((pendingView || viewMode) === 'land' ? 'port' : 'land'); });
  $('rotBtn').addEventListener('click', () => { tryFs(); setViewMode('port'); });
  $('charRow').addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && b.dataset.char) setChar(b.dataset.char); });
  syncCharUI();
  $('viewRow').addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && b.dataset.view) { tryFs(); setViewMode(b.dataset.view); } });
  syncViewUI();
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (pendingView && !viewBusy()) applyViewMode(pendingView);   // 작업355: 달리는 중에 고른 화면 모드는 판이 끝난 뒤 적용한다
  if (!API.manual) step(dt);   // 테스트는 manual=true로 두고 step()을 직접 부른다
  draw();
  requestAnimationFrame(frame);
}

// 테스트 훅(시제품과 같은 이름). manual=true이면 화면 갱신 루프가 step()을 부르지 않는다.
const API = { CONFIG: CONFIG, G: G, step: step, draw: draw, jump: jump, startRound: startRound, missedSet: missedSet, RUNNER_X: RUNNER_X, manual: false, lastTtsError: null, pronounce: pronounce, setTtsTimeout: ms => { ttsTimeoutMs = ms; }, lastTtsSource: null, pickWords: pickWords, penguin: () => ({ ready: penguinReady(), draws: G.spriteDraws, frame: G.spriteFrame, angle: G.spriteAngle, phase: G.runPhase }), curH: curH, OPT: OPT, fitAll: fitAll, get HIGH_Y() { return HIGH_Y; }, get TILE_Y() { return TILE_Y; }, getRunState: () => runState({ score: G.score, hp: G.hp, combo: G.combo, wi: G.wi, state: G.state, startTime: G.startTime, time: G.time, survival: G.survival, continued: G.contUsed }), obstTop: obstTop, obstArt: () => ({ ready: obstArtReady(), objs: obstObjs }), obstWarnActive: obstWarnActive };
API.art = { charKey: () => charKey, activeChar: activeChar, charReady: charReady, bgOK: bgOK, itemArtReady: itemArtReady, obstArtReady: () => obstArtReady(), blend: () => G.bossBlend, setChar: k => setChar(k) };   // 작업358: 시험용 훅
API.fx = { on: fxOn, setOn: v => { LAYOUT.FX = !!v; }, react: reactNow, setReact: setReact, state: () => G.react, dust: () => G.dust.length };   // 작업363: 시험용 훅
API.balloon = { rise: riseTile, ready: balloonReady, k: balloonK, lift: tileLift, setLift: v => { LAYOUT.TILE_LIFT = v; } };   // 작업361: 시험용 훅
API.menu = { open: () => MENU.open, pauses: menuPauses };   // 작업360: 시험용 훅
API.view = { mode: () => viewMode, pending: () => pendingView, set: setViewMode, scale: () => curScale, layout: () => ({ W: W, H: H, GROUND: GROUND, TILE_Y: TILE_Y, HIGH_Y: HIGH_Y }) };   // 작업355: 시험용 훅
API.edge = { on: edgeOn, setViewW: w => { streamViewW = w; }, viewW: () => streamViewW, fill: edgeFill };   // 작업354: 시험용 훅
API.preview = { T: PV_T, state: PV, run: previewRun, isOn: () => previewOn };   // 작업345: 시험용 훅
API.vs = { T: VS_T, state: VS, open: vsOpen, game: VSG, renderHearts: renderHearts };   // 작업344: 시험용 훅(조회 간격 단축·상태 확인)
window.SpellRun = API;
boot();
})();
