// 작업272-2: OCR 터치 모드의 순수 함수(DOM·카메라 없음). 인식 결과 단어 정리/필터와 "터치한 곳의 단어 고르기".
// 좌표 변환은 새로 만들지 않는다: 호출부(ocrScanner.js)가 liveOverlayGeometry.js 의 guideToVideoCrop(보이는 영역 전체)·projectCropBox 로
// 단어 박스를 화면(.ocr-overlay 기준) 좌표 rect 로 바꿔 넘기면, 여기서 터치 점과 비교한다.
// 이 파일은 import 가 없어 Node 테스트(tests/ocr_touch.test.js)가 파일 내용을 data: URL 로 불러올 수 있다.

export const TOUCH_MIN_CONFIDENCE = 30;   // 터치 모드는 단어 목록·불용어 필터를 쓰지 않고 신뢰도 하한만 낮게 둔다
export const TOUCH_PAD = 8;               // 터치 점이 박스 가장자리에서 이 안쪽 거리(px)면 "박스 안"으로 본다
export const TOUCH_REACH = 28;            // 박스 밖이어도 가장자리까지 이 거리(px) 이내의 가장 가까운 단어를 고른다

// Tesseract words[] → 표시 대상 [{ text, confidence, bbox }]. normalize 는 extractEnglishCandidates.js 의 normalizeToken
// 조건: 정리한 글자에 알파벳이 2글자 이상, 공백 없음, 신뢰도 minConfidence 이상, bbox 가 유한하고 면적이 있음
export function filterTouchWords(rawWords, normalize, minConfidence = TOUCH_MIN_CONFIDENCE) {
  const out = [];
  for (const w of Array.isArray(rawWords) ? rawWords : []) {
    if (!w) continue;
    const text = normalize(String(w.text == null ? '' : w.text));
    if (!text || /\s/.test(text) || (text.match(/[a-z]/gi) || []).length < 2) continue;
    const confidence = Number(w.confidence);
    if (!Number.isFinite(confidence) || confidence < minConfidence) continue;
    const b = w.bbox;
    if (!b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) || !(b.x1 > b.x0) || !(b.y1 > b.y0)) continue;
    out.push({ text, confidence, bbox: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } });
  }
  return out;
}

// 점 p 에서 rect 가장자리까지의 거리(안이면 0)
function edgeDistance(r, p) {
  const dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width));
  const dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height));
  return Math.hypot(dx, dy);
}
function centerDistance(r, p) { return Math.hypot(r.left + r.width / 2 - p.x, r.top + r.height / 2 - p.y); }
function insideExpanded(r, p, pad) {
  return p.x >= r.left - pad && p.x <= r.left + r.width + pad && p.y >= r.top - pad && p.y <= r.top + r.height + pad;
}

// words: [{ text, rect: { left, top, width, height } }], point: { x, y } (같은 좌표계). 규칙 3:
//  1) 박스(여백 pad 확장) 안이면 그 단어. 여럿이면 면적이 작은 쪽, 같으면 중심이 가까운 쪽, 그래도 같으면 앞의 것
//  2) 아니면 가장자리까지 reach 이내에서 가장 가까운 단어(같으면 중심이 가까운 쪽)
//  3) 없으면 null. 반환: { word, kind: 'inside' | 'near' }
export function pickTouchWord(words, point, { pad = TOUCH_PAD, reach = TOUCH_REACH } = {}) {
  if (!Array.isArray(words) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const usable = words.map((word, index) => ({ word, index })).filter(({ word }) => word && word.rect && word.rect.width > 0 && word.rect.height > 0);
  const inside = usable.filter(({ word }) => insideExpanded(word.rect, point, pad));
  if (inside.length) {
    inside.sort((a, b) => (a.word.rect.width * a.word.rect.height) - (b.word.rect.width * b.word.rect.height)
      || centerDistance(a.word.rect, point) - centerDistance(b.word.rect, point) || a.index - b.index);
    return { word: inside[0].word, kind: 'inside' };
  }
  const near = usable.map(u => ({ ...u, d: edgeDistance(u.word.rect, point) })).filter(u => u.d <= reach);
  if (!near.length) return null;
  near.sort((a, b) => a.d - b.d || centerDistance(a.word.rect, point) - centerDistance(b.word.rect, point) || a.index - b.index);
  return { word: near[0].word, kind: 'near' };
}
