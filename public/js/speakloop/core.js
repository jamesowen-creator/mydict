// 작업399: Speak Loop 순수 함수(화면·DOM 없음). 브라우저에서는 window.SLCore, 노드 시험에서는 require 로 쓴다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.SLCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var CHUNK_GAP = 0.1;      // 쌓아가기: 구 사이 간격(초)
  var REST_FACTOR = 1.2;    // 따라 말하는 쉬는 시간 = 방금 들은 길이 × 1.2
  var MAX_BLANKS = 6;       // 가린 단어당 밑줄 최대 개수
  var STAGES = ['전체 보기', '표현 구 가림', '1·3·5구 가림', '2·4구 가림', '첫 구만 보임', '한국어만'];

  // 구 끝 문장부호 → 억양 화살표. "." ↘, "?" ↗, 그 밖(쉼표 등) 없음
  function arrowOf(text) {
    var m = /([.?,!;:])["')\]]*\s*$/.exec(String(text || ''));
    if (!m) return '';
    return m[1] === '.' ? '↘' : m[1] === '?' ? '↗' : '';
  }

  // 단어 하나: 첫 글자만 두고 나머지는 밑줄(최대 6개). 끝의 문장부호는 그대로 둔다
  function maskWord(word) {
    var m = /^(.*?)([.,?!;:"')\]]*)$/.exec(word), core = m[1], tail = m[2];
    if (!core) return word;
    var chars = Array.from(core);
    return chars[0] + '_'.repeat(Math.min(chars.length - 1, MAX_BLANKS)) + tail;
  }
  function maskChunk(en) { return String(en).split(/\s+/).filter(Boolean).map(maskWord).join(' '); }

  // 외우기 단계(0~5)별로 가려지는 구. chunks 와 같은 길이의 true/false 배열(true = 가림)
  function hiddenFlags(stage, chunks) {
    return chunks.map(function (c, i) {
      switch (stage) {
        case 0: return false;
        case 1: return !!c.k;
        case 2: return i % 2 === 0;        // 1·3·5구(0부터 세면 0·2·4)
        case 3: return i % 2 === 1;        // 2·4구
        case 4: return i !== 0;            // 첫 구만 보임
        case 5: return true;               // 한국어만
        default: return false;
      }
    });
  }

  // 쌓아가기 계획. durations = 구별 실제 재생 시간(초, 재생 속도 반영). 단계: {type:'chunks', from:0, to:i}(구 0..i-1 이어서), {type:'rest', seconds}, {type:'sentence'}
  function buildupPlan(durations) {
    var steps = [], total = 0;
    for (var i = 1; i <= durations.length; i++) {
      total += durations[i - 1] + (i > 1 ? CHUNK_GAP : 0);
      steps.push({ type: 'chunks', from: 0, to: i, gap: CHUNK_GAP });
      steps.push({ type: 'rest', seconds: round(total * REST_FACTOR) });
    }
    steps.pop();   // 마지막 구 묶음은 문장 전체이므로 따로 쉬지 않고 바로 문장 전체 음성 1회
    steps.push({ type: 'sentence' });
    return steps;
  }

  // 문장 전체 반복 쉐도잉 계획: (문장 재생 → 1.2배 쉬는 시간) × times
  function shadowPlan(sentenceSeconds, times) {
    var steps = [];
    for (var i = 1; i <= (times || 3); i++) { steps.push({ type: 'sentence', round: i }); steps.push({ type: 'rest', seconds: round(sentenceSeconds * REST_FACTOR), round: i }); }
    return steps;
  }
  function round(x) { return Math.round(x * 1000) / 1000; }

  var RATING_TEXT = { good: '막힘없음', some: '몇 군데 막힘', hard: '많이 막힘' };

  return { CHUNK_GAP: CHUNK_GAP, REST_FACTOR: REST_FACTOR, MAX_BLANKS: MAX_BLANKS, STAGES: STAGES, RATING_TEXT: RATING_TEXT,
    arrowOf: arrowOf, maskWord: maskWord, maskChunk: maskChunk, hiddenFlags: hiddenFlags, buildupPlan: buildupPlan, shadowPlan: shadowPlan };
});
