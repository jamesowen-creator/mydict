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
  OBST_NEXT_MARGIN: 0.1,  // 장애물 점프 뒤 다음 묶음 첫 글자를 위한 점프를 준비할 최소 여유(초)
  // 작업327: 그림·예고 표시(판정과 배치에는 영향 없음)
  ART_LONG_K: 2.0,        // 작업358: 1.4 → 2.0 (새 그림은 가로로 긴 모양이라 높이가 판정 높이(28)와 비슷해지게). 바닥 장애물 그림의 긴 변 = OBST_W x 이 값(흰 테두리 제외). pace 로 OBST_W 가 줄면 같은 비율로 줄어든다
  PIT_ART_K: 1.25,        // 구덩이 그림 폭 = PIT_W x 이 값(판정 폭은 PIT_W 그대로)
  // 작업328: 하트 규칙(체력과 무관)·가속 아이템
  HP_FULL_BONUS: 100,     // 체력이 가득일 때 하트를 먹으면 체력 대신 받는 점수(주소 옵션 hpfullbonus)
  SPEED_ITEM_ENABLED: true, // 주소 옵션 speeditem=0 이면 가속 아이템 없음
  SPEED_EVERY: 4,         // 약 이 개수의 일반 단어마다 가속 아이템 1개(주소 옵션 speedevery). 난수 없이 판 순번·단어 순번의 해시로 정한다
  BOOST_SEC: 5,           // 가속 효과 시간(초, 주소 옵션 boostsec)
  BOOST_FACTOR: 1.3,      // 가속 중 목표 속도 배율(SPEED_MAX 를 넘지 않는다)
  BOOST_SCORE_MULT: 1.5,  // 가속 중 완성한 단어의 완성 점수 배율
  // 작업329: 구조 아이템(힌트·천사). 체력이 낮을 때만 나온다. 난수 없이 판 순번·단어 순번 해시로 정한다
  RESCUE_ENABLED: true,   // 주소 옵션 rescue=0 이면 힌트·천사 없음
  ITEM_HP: 0.6,           // 현재 체력 <= HP x 이 값(그리고 1 이상)일 때만 나온다(주소 옵션 itemhp). 작업339: 0.4 → 0.6(기본 체력 5면 3 이하)
  // 작업341: 이어하기(판당 1회). 체력이 0이 되면 이어하기/끝내기를 고른다. 이어하면 체력은 절반(올림)
  CONT_ENABLED: true,     // 주소 옵션 continue=0 이면 이어하기 없음
  CONT_INVULN_SEC: 1.5,   // 이어한 직후 이 시간 동안은 장애물에 맞지 않는다(바로 다시 죽는 것 방지)
  RESCUE_HIGH: 5,         // 작업340: 체력이 기준보다 높을 때는 약 이 개수의 단어마다 1개(주소 옵션 rescuehigh). 낮을 때는 아래 RESCUE_EVERY
  RESCUE_EVERY: 2,        // 체력이 낮은 동안 약 이 개수의 단어마다 1개(주소 옵션 rescueevery). 작업339: 3 → 2. 힌트·천사는 단어 해시로 정한다(번갈아 나오지 않는다)
  ANGEL_SEC: 0.5,         // 천사가 틀린 타일을 지우는 연출 시간(초)
  // 작업332: 생존 모드(체력 0까지 계속). 기본 모드에는 영향이 없다. 하트·보스·난이도는 난수 없이 단어 순번·판 순번 해시로 정한다
  SURV_CHIPS: 8,          // 생존 모드 결과 화면에 칩으로 보이는 틀린 단어 수(최근 것 위주, 전체 개수는 숫자로)
  SURV_MIN_WORDS: 5,      // 생존 모드는 단어장에 이만큼 이상 있어야 시작할 수 있다
  SURV_BOSS_EVERY: 5,     // 이 순번의 배수마다 보스(한 구간 = 이 개수의 단어, 구간의 가장 긴 단어가 보스)
  SURV_HEART_START_ADJ: 1, // 하트 시작 간격 = heartevery - 이 값(기본 3 - 1 = 2단어마다). 시뮬레이션으로 정한 값
  SURV_HEART_STEP_EVERY: 15, // 이 개수의 단어가 지날 때마다 하트 간격이 늘어난다
  SURV_HEART_STEP: 3,     // 늘어나는 간격(주소 옵션 survheart. 0 이면 늘지 않는다)
  SURV_HEART_MAX_EVERY: 8, // 하트 간격 상한
  SURV_RAMP_EVERY: 10,    // 이 개수의 단어가 지날 때마다 장애물·높은 칸 확률이 오른다
  SURV_RAMP: 0.05,        // 오르는 크기(주소 옵션 survramp. 0 이면 오르지 않는다)
  SURV_OBST_MAX: 0.9,     // 장애물 확률 상한
  SURV_HIGH_MAX: 0.5,     // 높은 칸 확률 상한
  SURV_BOSS_HEAL: 1,      // 생존 모드에서 보스 시작 때 회복하는 체력(기본 모드 BOSS_HEAL 과 따로 둔다)
  SURV_BOSS_HEAL_UNTIL: 20, // 단어 순번이 이 값 이하인 보스에서만 회복한다(그 뒤에는 회복 없음: 잘하는 사람이 끝없이 가는 것을 막는다)
  STREAM_EDGE: false,     // 작업354: 타일 진입 방식. false = 'classic'(지금 세로 동작), true = 'edge'(오른쪽 화면 밖에서 흘러 들어온다). 주소 옵션 stream=edge
  WARN_SEC: T(0.78)       // 예고 표시가 보이는 최소 시간(최고 속도 기준, 거리로 계산). 기본 pace 1.3 에서 0.6초이고 pace 에 반비례(다른 시간 값과 같은 방식)
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
  if (v.hpfullbonus !== undefined) cfg.HP_FULL_BONUS = v.hpfullbonus;
  if (v.speeditem !== undefined) cfg.SPEED_ITEM_ENABLED = !!v.speeditem;
  if (v.speedevery) cfg.SPEED_EVERY = v.speedevery;
  if (v.survheart !== undefined) cfg.SURV_HEART_STEP = v.survheart;
  if (v.survramp !== undefined) cfg.SURV_RAMP = v.survramp;
  if (v.rescue !== undefined) cfg.RESCUE_ENABLED = !!v.rescue;
  if (v.itemhp !== undefined) cfg.ITEM_HP = v.itemhp;
  if (v.rescueevery) cfg.RESCUE_EVERY = v.rescueevery;
  if (v.rescuehigh) cfg.RESCUE_HIGH = v.rescuehigh;
  if (v.continue !== undefined) cfg.CONT_ENABLED = !!v.continue;
  if (v.boostsec) cfg.BOOST_SEC = v.boostsec;
  if (v.stream !== undefined) cfg.STREAM_EDGE = !!v.stream;
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
  obs: { min: 0, max: 1, int: true, def: 1 }, obsprob: { min: 0, max: 1, def: 0.5 },
  hpfullbonus: { min: 0, max: 1000, int: true, def: 100 }, speeditem: { min: 0, max: 1, int: true, def: 1 }, speedevery: { min: 1, max: 10, int: true, def: 4 }, boostsec: { min: 1, max: 10, def: 5 },
  survheart: { min: 0, max: 5, int: true, def: 3 }, survramp: { min: 0, max: 0.2, def: 0.05 },
  rescue: { min: 0, max: 1, int: true, def: 1 }, itemhp: { min: 0, max: 1, def: 0.6 }, rescueevery: { min: 1, max: 10, int: true, def: 2 }, rescuehigh: { min: 1, max: 10, int: true, def: 5 },
  continue: { min: 0, max: 1, int: true, def: 1 },
  stream: { min: 0, max: 1, int: true, def: 0 }   // 작업354: stream=edge(=1) / classic(=0)
};
// 반환 { values: 유효한 값(기본값과 같아도 포함), applied: 기본값과 다른 옵션 이름 }
function parseOptions(search) {
  const values = {}, applied = [];
  let sp;
  try { sp = new URLSearchParams(String(search || '')); } catch (e) { return { values: values, applied: applied }; }
  Object.keys(OPTION_RULES).forEach(function (k) {
    let raw = sp.get(k);
    const rule = OPTION_RULES[k];
    if (k === 'stream' && raw !== null) raw = raw.trim() === 'edge' ? '1' : raw.trim() === 'classic' ? '0' : raw;   // 작업354: 낱말로도 받는다
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
  TILE_LIFT: 0, BALLOON: false,   // 작업361: 가로에서만 철자 타일을 풍선 그림으로 그리고 그림만 TILE_LIFT 논리 px 위로 올린다(판정·배치는 그대로)
  TILE_SCALE: 1, CHAR_SCALE: 1,   // 작업360: 철자 타일·캐릭터 그림 배율(세로는 1 = 그대로. 가로 값은 LAYOUT_LAND). 판정 크기와 무관하게 그림·타일 폭만 바꾼다
  INTRO_CENTER_Y: 250,  // 작업323: 큰 뜻 카드의 가운데 높이(논리 px). 위쪽 HUD 줄 아래, 땅 위의 빈 공간
  CONTENT_BOTTOM_Y: 266 // 글자 칸 줄 아래 끝의 한계: 높은 칸 타일 윗변(HIGH_TILE_Y - TILE_H/2 = 276)보다 위(여유 포함)
};

// ---- 작업355: 꽉 찬 화면의 판 크기(세로 360 x 가변 높이, 가로 800x400) ----
// 세로: 논리 높이는 화면 비율에 맞게 늘리되 최소 640. 높이 640이면 LAYOUT 과 완전히 같다. 늘어난 높이(E)는 하늘 2/3(땅·타일이 그만큼 아래로)과 땅 아래 띠 1/3로 나눈다.
//   (뜻·글자 칸·HUD 는 위쪽에 그대로 있고, 땅·타일·점프·장애물의 상대 위치와 경기장 폭은 불변. 하늘이 넓어지면 위쪽 글자와 높은 칸 사이가 비어 보이는 대신 답답하지 않고, 땅 아래 띠는 대결 막대·나가기가 놓일 만큼만 늘린다)
// 가로: 800x400. 글자 영역은 높이 100 이하(CONTENT_BOTTOM_Y 100), 높은 칸 타일 윗변 112 보다 위. 땅 아래 띠 44.
// 작업356: 뜻(왼쪽)과 글자 칸(오른쪽)을 한 줄에 나란히 둔다(HUD 는 위 한 줄). 글자 칸 줄은 남는 폭(약 440)을 쓰고, 큰 뜻 연출은 위쪽(높은 칸 타일 윗변 112 보다 위)에서 한다. 팝업 글자 크기는 가로 전용 상한
const LAYOUT_LAND = { W: 800, H: 400, GROUND: 356, TILE_Y: 248, HIGH_TILE_Y: 141, TILE_H: 58, WORD_AVAIL_W: 440, HUD_SHIFT: 0, INTRO_CENTER_Y: 72, INTRO_W: 560, CONTENT_BOTTOM_Y: 100, TILE_SCALE: 0.75, CHAR_SCALE: 1.3, TILE_LIFT: 22, BALLOON: true, CW_MAX: 38, MEAN_MAX: 26, SUB_MAX: 12, POPW_MAX: 30, POPM_MAX: 16, POPE_MAX: 10, FIT_PAD: 5 };
const SCALE_MAX = 1.5, SCALE_MIN = 0.3;
// mode: 'port' | 'land', availW/availH: 안전 여백을 뺀 쓸 수 있는 화면 크기(CSS px). 반환: LAYOUT 과 같은 항목 + { scale, mode, extra }
function layoutFor(mode, availW, availH) {
  const aw = Math.max(1, availW), ah = Math.max(1, availH);
  if (mode === 'land') {
    const scale = Math.max(SCALE_MIN, Math.min(aw / LAYOUT_LAND.W, ah / LAYOUT_LAND.H, SCALE_MAX));
    return Object.assign({}, LAYOUT_LAND, { scale: scale, mode: 'land', extra: 0 });
  }
  const s0 = Math.min(aw / LAYOUT.W, SCALE_MAX);
  const H = Math.max(LAYOUT.H, Math.floor(ah / s0));
  const E = H - LAYOUT.H, Es = Math.round(E * 2 / 3);
  const scale = Math.max(SCALE_MIN, Math.min(s0, ah / H));
  return Object.assign({}, LAYOUT, { H: H, GROUND: LAYOUT.GROUND + Es, TILE_Y: LAYOUT.TILE_Y + Es, HIGH_TILE_Y: LAYOUT.HIGH_TILE_Y + Es, CW_MAX: 34, MEAN_MAX: 28, SUB_MAX: 12, scale: scale, mode: 'port', extra: E });
}

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

// ---- 작업328: 하트 규칙 변경 · 가속 아이템 ----
// 하트를 먹었을 때: 체력이 가득이 아니면 체력 +HEART_HEAL(점수 0), 가득이면 체력은 그대로 두고 점수 HP_FULL_BONUS. 체력 조건은 "나오는가"가 아니라 "먹었을 때 무엇을 주는가"에만 쓴다.
function heartEffect(hp, cfg) {
  cfg = cfg || CONFIG;
  if (hp < cfg.HP) return { hp: Math.min(cfg.HP, hp + cfg.HEART_HEAL), score: 0, full: false };
  return { hp: hp, score: cfg.HP_FULL_BONUS, full: true };
}
// 난수 없는 정수 해시(FNV-1a). 작업327 의 그림 종류 선택과 같은 접근
function hashInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
// 가속 아이템 계획: 이 단어에 나오면 아이템이 놓일 묶음 번호, 아니면 null. 난수를 쓰지 않는다.
// o: { roundSeq: 판 순번, regularIdx: 보스가 아닌 단어 중 순번(0부터), boss, review, hasHeart, hasObst, nSlots, groupTaken: 이 그룹의 번개가 이미 앞 단어에 붙었으면 그 그룹 번호, isHeartAt(j): 일반 단어 순번 j 가 하트 단어인가, regularCount: 일반 단어 총수(생존 모드는 생략) }
// 작업339: 그룹에서 고른 단어가 제외 대상이면 같은 그룹의 다음 후보로 옮긴다. 하트 단어는 판이 시작될 때(생존 모드는 해시로) 미리 알 수 있어 후보에서 빼고 해시로 시작 후보를 고르고, 장애물·구조 아이템·한 칸짜리 단어처럼 단어를 불러와야 아는 제외는 시작 후보부터 앞으로(되돌아가지 않고) 가며 첫 후보에 붙인다. 그룹당 최대 1개, 난수 없음.
// 일반 단어 SPEED_EVERY 개씩 묶은 그룹마다 하나(그룹 안의 자리는 판 순번·그룹 번호의 해시). 보스·복습 판·하트가 있는 단어·장애물이 있는 단어에는 없다. 묶음은 첫 묶음을 뺀 곳.
function planSpeedItem(o, cfg) {
  cfg = cfg || CONFIG;
  if (!cfg.SPEED_ITEM_ENABLED || o.boss || o.review || o.hasHeart || o.hasObst || o.nSlots < 2) return null;
  const e = cfg.SPEED_EVERY, g = Math.floor(o.regularIdx / e), base = g * e;
  if (o.groupTaken === g) return null;   // 이 그룹의 번개는 이미 앞 단어에 붙었다
  const last = Math.min(base + e - 1, (o.regularCount === undefined ? Infinity : o.regularCount) - 1);
  const cands = [];
  for (let j = base; j <= last; j++) if (!(o.isHeartAt && o.isHeartAt(j))) cands.push(j);
  if (!cands.length) return null;
  const start = cands[hashInt('speed:' + o.roundSeq + ':' + g) % cands.length];
  if (o.regularIdx < start) return null;
  return 1 + hashInt('speedslot:' + o.roundSeq + ':' + o.regularIdx) % (o.nSlots - 1);
}
// ---- 작업332: 생존 모드 ----
// 하트 간격: 단어 순번(보스를 뺀 일반 단어 순번, 0부터)이 늘수록 SURV_HEART_STEP 씩 늘어난다(상한 SURV_HEART_MAX_EVERY). 시작 간격은 heartevery.
function survHeartEvery(regularIdx, cfg) {
  cfg = cfg || CONFIG;
  return Math.min(cfg.SURV_HEART_MAX_EVERY, Math.max(1, cfg.HEART_EVERY - cfg.SURV_HEART_START_ADJ) + cfg.SURV_HEART_STEP * Math.floor(regularIdx / cfg.SURV_HEART_STEP_EVERY));
}
// 이 단어에 하트가 나오는가(난수 없음). 단어를 그룹으로 나누되 그룹 크기가 순번에 따라 커지고, 그룹마다 하나의 자리를 해시로 정한다.
function survHeartWord(regularIdx, roundSeq, cfg) {
  cfg = cfg || CONFIG;
  let start = 0, g = 0;
  for (;;) {
    const size = survHeartEvery(start, cfg);
    if (regularIdx < start + size) return regularIdx === start + hashInt('sh:' + roundSeq + ':' + g) % size;
    start += size; g++;
  }
}
function survHeartSlot(nSlots, roundSeq, regularIdx) { return nSlots <= 1 ? 0 : 1 + hashInt('shs:' + roundSeq + ':' + regularIdx) % (nSlots - 1); }
// 난이도 곡선: 단어 순번(1부터, 보스 포함)이 SURV_RAMP_EVERY 개 지날 때마다 장애물·높은 칸 확률이 SURV_RAMP 씩 오른다(상한 있음). 반환은 cfg 복사본이라 planObstacle/planHighSlots 에 그대로 넘긴다.
function survRampCfg(cfg, wordNo) {
  cfg = cfg || CONFIG;
  const lv = Math.floor((wordNo - 1) / cfg.SURV_RAMP_EVERY);
  return Object.assign({}, cfg, { OBSTACLE_PROB: Math.min(cfg.SURV_OBST_MAX, Math.max(cfg.OBSTACLE_PROB, cfg.OBSTACLE_PROB + cfg.SURV_RAMP * lv)), HIGH_SLOT_PROB: Math.min(cfg.SURV_HIGH_MAX, Math.max(cfg.HIGH_SLOT_PROB, cfg.HIGH_SLOT_PROB + cfg.SURV_RAMP * lv)) });
}
// 한 구간(SURV_BOSS_EVERY 개)의 보스: 가장 긴 단어, 같은 길이는 해시가 작은 쪽(난수 없음)
function survPickBoss(words, segIdx) {
  let best = -1, bl = -1, bh = 0;
  words.forEach(function (w, i) { const l = letterCount(w.word), h = hashInt('b' + segIdx + ':' + w.word); if (l > bl || (l === bl && h < bh)) { best = i; bl = l; bh = h; } });
  return best;
}
// 단어 공급: 단어장을 섞어 순서대로 내고 다 쓰면 다시 섞는다. 다시 섞은 첫 단어가 직전 단어와 같지 않고, 한 구간 안에 같은 단어가 겹치지 않는다(단어가 SURV_MIN_WORDS 이상일 때).
// nextSegment() 는 구간 하나(일반 단어 SURV_BOSS_EVERY-1 개 + 마지막에 보스)를 돌려준다. 섞기에만 rng 를 쓴다(기본 모드와 별개 경로).
function makeSurvSupply(pool, cfg, rng) {
  cfg = cfg || CONFIG; rng = rng || Math.random;
  let queue = [], last = null, segIdx = 0;
  function pull(exclude) {
    if (!queue.length) queue = shuffle(pool, rng);
    let i = queue.findIndex(function (w) { return !exclude.has(w.word); });
    if (i < 0) { queue = queue.concat(shuffle(pool, rng)); i = queue.findIndex(function (w) { return !exclude.has(w.word); }); }
    if (i < 0) i = 0;
    return queue.splice(i, 1)[0];
  }
  return {
    nextSegment: function () {
      const n = cfg.SURV_BOSS_EVERY, seg = [], used = new Set();
      for (let k = 0; k < n; k++) { const w = pull(k === 0 && last ? new Set([last]) : used); seg.push(w); used.add(w.word); }
      const b = survPickBoss(seg, segIdx), boss = seg.splice(b, 1)[0];
      if (last && seg[0].word === last) { const t = seg[0]; seg[0] = seg[1]; seg[1] = t; }   // 보스를 뺀 뒤 첫 단어가 직전 구간의 보스와 같으면 자리를 바꾼다
      segIdx++; last = boss.word;
      return seg.concat([boss]).map(function (w, i, a) { return Object.assign({}, w, i === a.length - 1 ? { boss: true } : {}); });
    }
  };
}
// 다른 곳(나중의 상대 띠 등)에서 읽는 현재 상태 한 곳: s 는 { score, hp, combo, wi, words, state, startTime, time, survival }
function runState(s, cfg) {
  cfg = cfg || CONFIG;
  return { score: s.score, hp: s.hp, maxHp: cfg.HP, combo: s.combo, wordNo: s.wi + 1, alive: s.hp > 0 && s.state !== 'over', elapsed: Math.max(0, s.time - s.startTime), survival: !!s.survival, continued: !!s.continued };
}

// 작업341: 이어한 뒤의 체력 = 최대 체력의 절반(올림). 최대 5 → 3, 2 → 1, 1 → 1
function contHp(maxHp) { return Math.max(1, Math.ceil(maxHp / 2)); }
// 작업329: 구조 아이템 계획. 난수 없이. 작업340: 체력이 기준 이하(1 이상)이면 약 1/RESCUE_EVERY, 그보다 높으면(가득 포함) 약 1/RESCUE_HIGH 로 가끔.
// o: { roundSeq, regularIdx, hp, boss, review, hasHeart, hasObst, nSlots }  (작업339: 힌트·천사는 단어 해시로 정한다)
// 반환 { slot: 아이템이 놓일 묶음 번호(첫 묶음 이후), kind: 'hint' | 'angel'(번갈아) } 또는 null. 우선순위: 하트 > 구조 > 가속(호출하는 쪽에서 구조가 정해지면 가속 계획에 hasHeart 를 넘긴다)
function rescueLow(hp, cfg) { cfg = cfg || CONFIG; return hp >= 1 && hp <= cfg.HP * cfg.ITEM_HP + 1e-9; }
// 해시의 하위 비트 섞기(FNV 의 마지막 비트는 글자 비트의 XOR 라서, 같은 모양의 다른 해시와 짝수 나머지로 비교하면 서로 완전히 연동된다: 계획 여부(% RESCUE_EVERY)와 종류가 같은 순번 글자로 만들어져 힌트만 나오는 문제가 있었다)
function mix32(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function planRescue(o, cfg) {
  cfg = cfg || CONFIG;
  if (!cfg.RESCUE_ENABLED || o.boss || o.review || o.hasHeart || o.hasObst || o.nSlots < 2 || !(o.hp >= 1)) return null;
  const every = rescueLow(o.hp, cfg) ? cfg.RESCUE_EVERY : cfg.RESCUE_HIGH;
  if (hashInt('rescue:' + o.roundSeq + ':' + o.regularIdx) % every !== 0) return null;
  return { slot: 1 + hashInt('rescueslot:' + o.roundSeq + ':' + o.regularIdx) % (o.nSlots - 1), kind: mix32(hashInt('rescuekind:' + o.roundSeq + ':' + o.regularIdx)) % 2 === 0 ? 'hint' : 'angel' };   // 작업339: 판 안의 순번이 아니라 단어 해시로 구분
}
// 가속 중의 목표 속도: 원래 목표 속도 x BOOST_FACTOR, 단 SPEED_MAX 를 넘지 않는다(장애물 안전 간격은 SPEED_MAX 기준이다)
function boostTarget(target, boosting, cfg) {
  cfg = cfg || CONFIG;
  return boosting ? Math.min(cfg.SPEED_MAX, target * cfg.BOOST_FACTOR) : target;
}
// 가속 중 완성한 단어의 완성 점수
function boostWordBonus(bonus, boosting, cfg) { cfg = cfg || CONFIG; return boosting ? Math.round(bonus * cfg.BOOST_SCORE_MULT) : bonus; }

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
// ---- 작업327: 바닥 장애물 그림(시트 spellrun_obstacles_sheet.png 1024x256, 256 칸 4개: 돌무더기·통나무·콘·가시덤불) ----
// 물체 크기(w,h)는 흰 테두리(BORDER) 제외 추정값이고, 화면에서는 시트의 알파로 실제 값을 재서 바꿔 쓴다. 물체 바닥은 칸 아래에서 FOOT_Y 지점이다.
// 작업358: 새 그림(이끼 돌무더기·버섯 통나무·별 상자·가시덤불). 흰 테두리 3px, 칸 256, 바닥 237. 크기는 scripts/spellrun_art_report.json 의 값(실행 중에도 알파로 다시 잰다)
const OBSTACLE_ART = { URL: '/img/spellrun/spellrun_obstacles_sheet.png', SHEET_W: 1024, SHEET_H: 256, CELL: 256, BORDER: 3, FOOT_Y: 237,
  OBJECTS: [{ name: 'rocks', w: 230, h: 100 }, { name: 'log', w: 237, h: 91 }, { name: 'crate', w: 205, h: 96 }, { name: 'bush', w: 234, h: 117 }] };
// 종류 고르기: 난수를 쓰지 않는다(장애물 배치 난수 흐름을 바꾸지 않기 위해). 단어·장애물이 놓이는 묶음 번호·이번 판의 장애물 순번으로 만든 해시(FNV-1a)를 4로 나눈 나머지
function obstacleArtIndex(word, slot, seq) {
  const str = String(word) + ':' + slot + ':' + seq;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % OBSTACLE_ART.OBJECTS.length;
}
// 그림 배율: 물체의 긴 변이 OBST_W x ART_LONG_K 가 되게 한다
function obstacleArtScale(cfg, obj) { cfg = cfg || CONFIG; return cfg.OBST_W * cfg.ART_LONG_K / Math.max(obj.w, obj.h); }
// 시트에서 idx 칸을 그릴 위치. cx: 판정 중심 x, groundY: 땅 선 y. obj: { w, h, foot(선택) }. top: 흰 테두리까지 포함한 그림 윗끝 y
function obstacleArtRect(cfg, idx, cx, groundY, obj) {
  cfg = cfg || CONFIG;
  const A = OBSTACLE_ART, o = obj || A.OBJECTS[idx], k = obstacleArtScale(cfg, o), foot = o.foot || A.FOOT_Y;
  return { sx: idx * A.CELL, sy: 0, sw: A.CELL, sh: A.CELL, dx: cx - A.CELL / 2 * k, dy: groundY - foot * k, dw: A.CELL * k, dh: A.CELL * k, k: k, top: groundY - (o.h + A.BORDER) * k, side: Math.max(o.w, o.h) * k };
}
// 예고 표시: 장애물이 정해진 순간(앞 묶음 정답을 먹은 뒤)부터 장애물 앞쪽 끝이 러너에 닿을 때까지 보인다. 최고 속도에서의 거리(px) = 묶음 대기 동안 간 거리 + 앞쪽 거리
function obstacleWarnDistance(cfg, kind) { cfg = cfg || CONFIG; return cfg.SPEED_MAX * cfg.PACK_DELAY + obstacleLayout(cfg, kind).Do - cfg.OBST_FOOT; }
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

// ---- 작업354: 타일 흐름(스트림) 'edge' 진입 방식 ----
// classic(세로, 지금 동작)은 이 함수들을 쓰지 않는다. edge 는 글자 묶음·아이템·장애물을 오른쪽 화면 밖에서 시작해 흘려보내고,
// 도착 시점은 classic 과 같게(앞 묶음 정답을 먹은 시점 기준) 계산한 뒤 화면 안에서 생기지 않도록·남은 타일과 겹치지 않도록 오른쪽으로 민다.
// 좌표는 모두 화면 논리 px 이고, R0 는 "그 묶음이 classic 이라면 생겼을 순간의 러너 위치"(가상 위치)다.
const STREAM = {
  MIN_GAP: 90,        // 남은 타일과 다음 묶음 첫 객체의 중심 사이 최소 거리(px). 타일 폭 + 여유
  PAD: 32,            // 두 타일 폭의 절반 합에 더하는 여유(px). 폭이 큰 조각 타일에서 MIN_GAP 이 모자라지 않게
  HALF_TILE: 29,      // 진입 거리에 쓰는 기본 타일 반폭(px). 실제로는 객체마다 반폭을 쓴다
  HALF_ITEM: 23,      // 하트·번개·구조 아이템 반폭
  LOOKAHEAD: 240      // 첫 객체가 진입 지점보다 이만큼 가까워지면 미리 줄에 넣는다(px). 시간(거리) 기준이라 타일 크기와 무관
};
// 진입 지점: 객체의 중심이 이 값 이상이면 화면 밖(오른쪽)에서 시작한다. viewW = 화면 논리 폭
function streamEntryX(viewW, half) { return viewW + (half === undefined ? STREAM.HALF_TILE : half); }
// minPx: 추가로 요구하는 거리. 다음 묶음의 첫 타일이 높은 칸이면 2단 점프를 위해 첫 점프가 일찍(약 0.46초 전) 시작되므로, 남은 타일이 그 점프 중에 지나가지 않도록 묶음 안 간격(gap)을 요구한다
// k: 타일 그림 배율(작업360, 가로 0.75). MIN_GAP·PAD 도 같은 비율로 줄여 줄어든 타일 사이 빈 틈이 그대로(k 기본 1 = 세로·이전과 같다)
function streamMinGap(wA, wB, minPx, k) { k = k || 1; return Math.max(STREAM.MIN_GAP * k, ((wA || 0) + (wB || 0)) / 2 + STREAM.PAD * k, minPx || 0); }
// 묶음 하나의 배치(classic 의 spawnPack 산식과 같다). o: { R0, v, widths: 타일 폭 목록, item: 앞에 아이템이 붙는가, obstacle: 'box'|'pit'|null, firstHigh: 첫 타일이 높은 칸인가 }
function layoutGroup(cfg, o) {
  cfg = cfg || CONFIG;
  const v = o.v, gap = v * gapSec(v, cfg);
  let x0 = o.R0 + v * leadSec(v, cfg), itemX = null, ob = null, lay = null;
  if (o.item) { itemX = x0; x0 += gap; }
  if (o.obstacle) {
    lay = obstacleLayout(cfg, o.obstacle);
    x0 = Math.max(x0, o.R0 + lay.D1);
    ob = { kind: lay.kind, x: x0 - lay.post - lay.w, w: lay.w };
  }
  return { firstHigh: !!o.firstHigh, itemX: itemX, obstacle: ob, lay: lay, tiles: o.widths.map(function (w, i) { return { x: x0 + i * gap, w: w }; }), x0: x0, gap: gap, R0: o.R0, v: v };
}
// 묶음의 가장 왼쪽 가장자리(아이템·장애물·첫 타일 중 가장 왼쪽)와 가장 왼쪽 객체의 중심·폭
function groupLeft(g) {
  let left = Infinity, cx = Infinity, w = 0;
  const take = function (l, c, ww) { if (l < left) left = l; if (c < cx) { cx = c; w = ww; } };
  if (g.itemX !== null) take(g.itemX - STREAM.HALF_ITEM, g.itemX, STREAM.HALF_ITEM * 2);
  if (g.obstacle) take(g.obstacle.x, g.obstacle.x + g.obstacle.w / 2, g.obstacle.w);
  if (g.tiles.length) take(g.tiles[0].x - g.tiles[0].w / 2, g.tiles[0].x, g.tiles[0].w);
  return { left: left, cx: cx, w: w };
}
function shiftGroup(g, dx) {
  return Object.assign({}, g, { itemX: g.itemX === null ? null : g.itemX + dx, obstacle: g.obstacle ? Object.assign({}, g.obstacle, { x: g.obstacle.x + dx }) : null, x0: g.x0 + dx,
    tiles: g.tiles.map(function (t) { return { x: t.x + dx, w: t.w }; }) });
}
// 오른쪽으로 밀어야 하는 거리(px, 0 이상): ① 모든 객체가 화면 밖(왼쪽 가장자리 >= viewW) ② 남은 타일(leftover: {x, w})과 최소 거리 ③ 장애물이 있으면 남은 타일이 장애물 점프 시작 전에 러너를 지나가도록
function streamShift(cfg, g, o) {
  cfg = cfg || CONFIG;
  const gl = groupLeft(g);
  let dx = Math.max(0, o.viewW - gl.left);
  if (o.leftover) {
    dx = Math.max(dx, o.leftover.x + streamMinGap(o.leftover.w, gl.w, g.firstHigh ? g.gap : 0, o.tileScale) - gl.cx);
    if (g.obstacle && g.lay) {   // 장애물 점프 시작 구간의 가장 이른 시각(lo, 묶음이 생긴 순간 기준)보다 남은 타일이 먼저 러너를 지나가야 한다
      const win = obstacleWindow(cfg, g.lay, g.v);
      dx = Math.max(dx, o.leftover.x + g.lay.D1 - g.v * win.lo - g.x0);
    }
  }
  return Math.max(0, dx);
}
// 묶음이 생긴 순간의 가상 러너 위치. kind: 'pack'(앞 묶음 정답을 먹은 뒤) | 'word'(앞 단어 마지막 정답 뒤 새 단어) | 'start'(판 시작·이어하기) | 'recover'(틀린 뒤 같은 칸 다시)
// o: { xc: 앞 묶음 정답 타일 위치, runnerX, v, bossNext, first }
function streamBaseR0(cfg, kind, o) {
  cfg = cfg || CONFIG;
  if (kind === 'pack') return o.xc + o.v * cfg.PACK_DELAY;
  if (kind === 'word') return o.xc + o.v * (cfg.POP_SEC + (o.bossNext ? cfg.BOSS_INTRO_SEC : 0) + cfg.WORD_START_DELAY);
  if (kind === 'start') return o.runnerX + o.v * (cfg.WORD_START_DELAY + (o.first ? cfg.FIRST_WORD_EXTRA : 0));
  return o.runnerX + o.v * cfg.PACK_DELAY;   // recover: classic 이 틀린 뒤 같은 칸을 다시 내는 시간과 같다
}
// 한 번에 배치: 배치 결과(g)와 classic 대비 늦춤(dx, px)을 돌려준다
function streamPlace(cfg, kind, o) {
  cfg = cfg || CONFIG;
  const g0 = layoutGroup(cfg, { R0: streamBaseR0(cfg, kind, o), v: o.v, widths: o.widths, item: o.item, obstacle: o.obstacle, firstHigh: o.firstHigh });
  const dx = streamShift(cfg, g0, { viewW: o.viewW, leftover: o.leftover, tileScale: o.tileScale });
  return { group: dx ? shiftGroup(g0, dx) : g0, dx: dx, group0: g0 };
}
// 글자 타일이 "지금 풀 칸"의 정답인가. cur: { wi, si }
function streamIsCorrect(t, cur) { return !!(t.correct && t.wi === cur.wi && t.si === cur.si); }
// 작업360: 지금 풀 칸이 아닌 타일을 흐리게 하던 streamDim 은 없앴다(모든 타일은 항상 같은 선명도)
// 화면 밖(왼쪽 가장자리가 viewW 이상)에 있고 아직 러너에 닿지 않은 살아 있는 타일
function streamOffscreen(t, viewW) { return t.state === 'live' && !t.checked && t.x - t.w / 2 >= viewW; }

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

// ---- 작업358: 그림(캐릭터 3종·배경·아이템). 크기·좌표는 scripts/spellrun_art_build.py 가 만든 scripts/spellrun_art_report.json 과 같다 ----
// 캐릭터: 펭귄과 같은 시트 형식(1728x288, 칸 288, 6동작: 달리기 4 · 점프 상승 · 점프 하강). 판정 크기는 같고(size 92) 그림만 다르다. 사람은 몸 가운데(faceX 0.5)를 러너 위치 약간 왼쪽(faceDx)에 둔다
const CHAR_KEYS = ['penguin', 'girl', 'boy'];
const CHARS = {
  penguin: Object.assign({ key: 'penguin', name: '펭귄' }, PENGUIN),
  girl: Object.assign({ key: 'girl', name: '여학생' }, PENGUIN, { URL: '/img/spellrun/spellrun_girl_sheet.png', faceX: 0.5, faceDx: -16, bodyY: 0.55 }),
  boy: Object.assign({ key: 'boy', name: '남학생' }, PENGUIN, { URL: '/img/spellrun/spellrun_boy_sheet.png', faceX: 0.5, faceDx: -16, bodyY: 0.55 })
};
// 주소 옵션 char(0 펭귄 | 1 여학생 | 2 남학생). 저장값(문자열 키)은 모르는 값이면 펭귄
function charFromOption(v) { return v === '1' ? 'girl' : v === '2' ? 'boy' : v === '0' ? 'penguin' : null; }
function charFromStored(v) { return CHAR_KEYS.indexOf(v) >= 0 ? v : 'penguin'; }
// 배경: 층마다 논리 폭 640(그림 폭 1280, 논리 1px = 그림 2px)을 가로로 이어 붙이고 땅 선에 바닥을 맞춘다. 속도는 지금 언덕과 같다(먼 0.22, 가까운 0.45)
const BG_ART = {
  PX: 2, TILE_W: 640, BLEND_SEC: 0.5,
  LAYERS: {
    dayFar: { URL: '/img/spellrun/bg_day_far.png', W: 1280, H: 329, SPEED: 0.22 },
    dayMid: { URL: '/img/spellrun/bg_day_mid.png', W: 1280, H: 213, SPEED: 0.45 },
    bossFar: { URL: '/img/spellrun/bg_boss_far.png', W: 1280, H: 221, SPEED: 0.22 },
    bossNear: { URL: '/img/spellrun/bg_boss_near.png', W: 1280, H: 334, SPEED: 0.45 }
  },
  SKY: { URL: '/img/spellrun/bg_boss_sky.png', W: 1024, H: 704, SPEED: 0.03 },
  CLOUDS: { URL: '/img/spellrun/clouds_sheet.png', W: 308, H: 614, SPEED: 0.12, ALPHA: 0.92,
    ITEMS: [{ sx: 4, sy: 4, sw: 196, sh: 126 }, { sx: 4, sy: 134, sw: 206, sh: 120 }, { sx: 4, sy: 258, sw: 300, sh: 181 }, { sx: 4, sy: 443, sw: 136, sh: 89 }, { sx: 4, sy: 536, sw: 109, sh: 74 }],
    X: [0.05, 0.26, 0.47, 0.69, 0.88], Y: [0.1, 0.7, 0.35, 0.9, 0.55], SCALE: [0.9, 0.8, 0.9, 0.7, 0.6] }
};
// 아이템(하트·번개·전구·천사) 한 줄 시트: 칸 112, 겉보기 큰 변 104. 논리 DRAW_MAX 54 로 그린다(판정 크기·효과·연출은 그대로)
const ITEM_ART = { URL: '/img/spellrun/items_sheet.png', SHEET_W: 448, SHEET_H: 112, CELL: 112, ORDER: ['heart', 'speed', 'hint', 'angel'], DRAW_MAX: 54, MAX_SIDE: 104 };

// ---- 작업361: 풍선(가로 철자 타일 그림) ----
// 시트: 풍선 6색 한 줄(분홍·파랑·노랑·초록·보라·주황), 칸 CELL_W x CELL_H(그림 px, 논리 1px = 그림 2px), 몸통 가운데가 칸 가운데 x 와 ANCHOR_Y 에 오게 맞춤. 숫자는 scripts/spellrun_art_report.json 과 같다
// 몸통 BODY_W x BODY_H(논리 px, 세로로 긴 타원). KNOT_DY = 몸통 가운데에서 매듭(몸통 아래 끝)까지, BOTTOM_DY = 끈 아래 끝까지. 끈은 판정에 넣지 않는다
const BALLOON_ART = { URL: '/img/spellrun/balloons_sheet.png', SHEET_W: 672, SHEET_H: 161, CELL_W: 112, CELL_H: 161, COUNT: 6, PX: 2, ANCHOR_Y: 58,
  BODY_W: 48.0, BODY_H: 52.0, KNOT_DY: 26.0, BOTTOM_DY: 49.0, MAX_STRETCH: 1.4, TEXT_DY: 4, TEXT_FIT: 0.8,
  NAMES: ['pink', 'blue', 'yellow', 'green', 'purple', 'orange'], COLORS: ['#ff8fb1', '#6ec1f7', '#ffd25e', '#8fe08a', '#b78cf5', '#ff9f77'],
  BOB: 3, BOB_SEC: 1.6, SWAY_DEG: 4, SWAY_SEC: 1.9, POP_N: 7, POP_SEC: 0.3 };
// 풍선 색 번호: 후보 번호(묶음 안 몇 번째)와 칸 번호를 더해 6색을 돌린다. 난수 없음(같은 위치는 항상 같은 색)
function balloonColor(i, si) { return (i + si) % BALLOON_ART.COUNT; }
// 풍선마다 어긋나는 위상(0~2π): 타일 번호 n 으로만 정한다(황금비 분수). 난수 없음
function balloonPhase(n) { return ((n * 0.6180339887) % 1) * Math.PI * 2; }
// 둥실 움직임(그리기에만 쓴다): 시간 time(초, 게임 시간), 위상 ph → { dy: 위아래(논리 px), ang: 매듭을 축으로 한 기울기(도) }
function balloonMotion(time, ph) {
  const A = BALLOON_ART;
  return { dy: Math.sin(time * Math.PI * 2 / A.BOB_SEC + ph) * A.BOB, ang: Math.sin(time * Math.PI * 2 / A.SWAY_SEC + ph * 1.3) * A.SWAY_DEG };
}
// 몸통을 가로로 늘리는 배율: 글자 폭 textW(논리 px)가 몸통 폭의 TEXT_FIT 안에 들어오게. MAX_STRETCH 를 넘어야 하면 null(풍선 대신 기존 타일 모양)
function balloonStretch(textW) {
  const A = BALLOON_ART, k = Math.max(1, textW / (A.BODY_W * A.TEXT_FIT));
  return k > A.MAX_STRETCH + 1e-9 ? null : k;
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
  ttsSourceLabel: ttsSourceLabel, PENGUIN: PENGUIN, runFrameLength: runFrameLength, advanceRunPhase: advanceRunPhase, penguinFrame: penguinFrame, spinAngle: spinAngle, sparkleAlpha: sparkleAlpha, introTimeline: introTimeline, introState: introState, buildConfig: buildConfig, parseOptions: parseOptions, resolveOptions: resolveOptions, storedOptions: storedOptions, OPTION_KEY: OPTION_KEY, configure: configure, OPTION_RULES: OPTION_RULES, LAYOUT: LAYOUT, LAYOUT_LAND: LAYOUT_LAND, layoutFor: layoutFor,
  jumpV0: jumpV0, jumpG: jumpG, airHeight: airHeight, secondJumpLandTime: secondJumpLandTime, planHighSlots: planHighSlots,
  survHeartEvery: survHeartEvery, survHeartWord: survHeartWord, survHeartSlot: survHeartSlot, survRampCfg: survRampCfg, survPickBoss: survPickBoss, makeSurvSupply: makeSurvSupply, runState: runState, planRescue: planRescue, contHp: contHp, rescueLow: rescueLow, heartEffect: heartEffect, hashInt: hashInt, planSpeedItem: planSpeedItem, boostTarget: boostTarget, boostWordBonus: boostWordBonus, OBSTACLE_ART: OBSTACLE_ART, CHARS: CHARS, CHAR_KEYS: CHAR_KEYS, BALLOON_ART: BALLOON_ART, balloonColor: balloonColor, balloonPhase: balloonPhase, balloonMotion: balloonMotion, balloonStretch: balloonStretch, charFromOption: charFromOption, charFromStored: charFromStored, BG_ART: BG_ART, ITEM_ART: ITEM_ART, obstacleArtIndex: obstacleArtIndex, obstacleArtScale: obstacleArtScale, obstacleArtRect: obstacleArtRect, obstacleWarnDistance: obstacleWarnDistance, airWindow: airWindow, obstacleSpec: obstacleSpec, obstacleOverlaps: obstacleOverlaps, obstacleHit: obstacleHit, obstacleLayout: obstacleLayout, obstacleWindow: obstacleWindow, obstacleAddedSec: obstacleAddedSec, planObstacle: planObstacle, afterObstacleHit: afterObstacleHit,
  STREAM: STREAM, streamEntryX: streamEntryX, streamMinGap: streamMinGap, layoutGroup: layoutGroup, groupLeft: groupLeft, shiftGroup: shiftGroup, streamShift: streamShift, streamBaseR0: streamBaseR0, streamPlace: streamPlace, streamIsCorrect: streamIsCorrect, streamOffscreen: streamOffscreen,
  wordWidth: wordWidth, fitWord: fitWord, MASK: MASK, wordForms: wordForms, maskText: maskText, findWordRanges: findWordRanges, buildHint: buildHint, keywords: keywords, splitKeywords: splitKeywords
};
});
