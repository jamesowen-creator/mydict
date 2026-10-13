// 작업272-2: OCR 터치 모드의 순수 함수(touchWordPick.js) — 단어 정리·필터, 터치 판정(규칙 3), 영상/화면 비율 조합에서 화면 좌표 ↔ 단어 박스.
// 브라우저용 ESM 이라 파일 내용을 data: URL 로 불러온다(touchWordPick.js·liveOverlayGeometry.js·extractEnglishCandidates.js 는 서로 import 가 없다).
// 실행: node --test tests/ocr_touch.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = f => import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ocr', f)).toString('base64'));
const bb = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const rect = (left, top, width, height) => ({ left, top, width, height });

test('필터: 알파벳 2글자 이상·신뢰도 30 이상·bbox 유효만 남기고, 단어 목록·불용어 필터는 쓰지 않는다', async () => {
  const { filterTouchWords } = await load('touchWordPick.js');
  const { normalizeToken } = await load('extractEnglishCandidates.js');
  const raw = [
    { text: 'Apple,', confidence: 90, bbox: bb(0, 0, 50, 20) },     // 정리 → apple
    { text: 'the', confidence: 80, bbox: bb(0, 0, 30, 20) },         // 불용어도 통과(터치 모드는 사용자가 고른 것)
    { text: 'zzqx', confidence: 31, bbox: bb(0, 0, 30, 20) },        // 사전에 없는 글자도 통과
    { text: 'well-known', confidence: 70, bbox: bb(0, 0, 90, 20) },
    { text: "don't", confidence: 70, bbox: bb(0, 0, 60, 20) },
    { text: 'a', confidence: 95, bbox: bb(0, 0, 10, 20) },            // 알파벳 1글자
    { text: '12', confidence: 95, bbox: bb(0, 0, 20, 20) },           // 알파벳 없음
    { text: 'x1', confidence: 95, bbox: bb(0, 0, 20, 20) },           // 알파벳 1글자
    { text: '--', confidence: 95, bbox: bb(0, 0, 20, 20) },
    { text: '', confidence: 95, bbox: bb(0, 0, 20, 20) },
    { text: 'low', confidence: 29, bbox: bb(0, 0, 30, 20) },          // 신뢰도 29 < 30
    { text: 'edge', confidence: 30, bbox: bb(0, 0, 30, 20) },         // 신뢰도 30 은 통과
    { text: 'nobox', confidence: 90 },
    { text: 'flat', confidence: 90, bbox: bb(5, 5, 5, 25) },          // 폭 0
    { text: 'nan', confidence: NaN, bbox: bb(0, 0, 30, 20) },
    { text: 'inf', confidence: 90, bbox: bb(0, 0, Infinity, 20) },
    null,
  ];
  const out = filterTouchWords(raw, normalizeToken);
  assert.deepEqual(out.map(w => w.text), ['apple', 'the', 'zzqx', 'well-known', "don't", 'edge']);
  assert.deepEqual(out[0].bbox, bb(0, 0, 50, 20));
  assert.deepEqual(filterTouchWords(undefined, normalizeToken), []);
  assert.deepEqual(filterTouchWords([{ text: 'ab', confidence: 40, bbox: bb(0, 0, 9, 9) }], normalizeToken, 50), [], '하한 인자');
});

test('터치 판정: 박스 안 / 여백 8px / 가장자리 28px 이내 가장 가까운 단어 / 없음', async () => {
  const { pickTouchWord } = await load('touchWordPick.js');
  const A = { text: 'a', rect: rect(100, 100, 80, 24) };
  const B = { text: 'b', rect: rect(100, 160, 80, 24) };
  const words = [A, B];
  let r = pickTouchWord(words, { x: 140, y: 112 });
  assert.equal(r.word.text, 'a'); assert.equal(r.kind, 'inside');
  assert.equal(pickTouchWord(words, { x: 100, y: 100 }).word.text, 'a', '모서리 점');
  r = pickTouchWord(words, { x: 100 - 8, y: 112 }); assert.equal(r.kind, 'inside', '여백 8px 은 안쪽으로 취급'); assert.equal(r.word.text, 'a');
  r = pickTouchWord(words, { x: 100 - 9, y: 112 }); assert.equal(r.kind, 'near', '8px 를 넘으면 가까운 단어 규칙'); assert.equal(r.word.text, 'a');
  assert.equal(pickTouchWord(words, { x: 180 + 28, y: 112 }).word.text, 'a', '가장자리까지 정확히 28px 는 선택');
  assert.equal(pickTouchWord(words, { x: 180 + 29, y: 112 }), null, '29px 는 없음');
  assert.equal(pickTouchWord(words, { x: 140, y: 100 - 28 }).word.text, 'a', '위쪽 28px 도 선택');
  assert.equal(pickTouchWord(words, { x: 140, y: 100 - 29 }), null, '위쪽 29px 는 없음');
  r = pickTouchWord(words, { x: 140, y: 140 }); assert.equal(r.word.text, 'a', '두 단어 사이: 가장자리 거리가 더 가까운 쪽(A 하단까지 16, B 상단까지 20)');
  r = pickTouchWord(words, { x: 140, y: 143 }); assert.equal(r.word.text, 'b', '더 가까운 쪽으로 바뀜(A 까지 19, B 까지 17)');
  assert.equal(pickTouchWord([], { x: 1, y: 1 }), null);
  assert.equal(pickTouchWord(null, { x: 1, y: 1 }), null);
  assert.equal(pickTouchWord(words, null), null);
  assert.equal(pickTouchWord(words, { x: NaN, y: 1 }), null);
  assert.equal(pickTouchWord([{ text: 'z', rect: rect(0, 0, 0, 10) }], { x: 0, y: 0 }), null, '면적 없는 박스는 무시');
});

test('터치 판정: 박스가 겹치면 면적이 작은 쪽, 같으면 중심이 가까운 쪽, 그래도 같으면 앞의 단어(중복 박스)', async () => {
  const { pickTouchWord } = await load('touchWordPick.js');
  const big = { text: 'big', rect: rect(100, 100, 200, 60) };
  const small = { text: 'small', rect: rect(150, 110, 60, 20) };
  assert.equal(pickTouchWord([big, small], { x: 170, y: 120 }).word.text, 'small', '둘 다 안: 작은 쪽');
  assert.equal(pickTouchWord([small, big], { x: 170, y: 120 }).word.text, 'small', '순서와 무관');
  assert.equal(pickTouchWord([big, small], { x: 280, y: 150 }).word.text, 'big', '작은 박스 밖(여백 밖)이면 큰 쪽');
  // 같은 면적(50×20), 100~150 / 140~190 으로 10px 겹침. 중심은 x=125 / x=165
  const l = { text: 'l', rect: rect(100, 100, 50, 20) }, r = { text: 'r', rect: rect(140, 100, 50, 20) };
  assert.equal(pickTouchWord([l, r], { x: 142, y: 110 }).word.text, 'l', '중심이 더 가까운 쪽(l 17 < r 23)');
  assert.equal(pickTouchWord([l, r], { x: 148, y: 110 }).word.text, 'r', '중심이 더 가까운 쪽(r 17 < l 23)');
  assert.equal(pickTouchWord([l, r], { x: 145, y: 110 }).word.text, 'l', '중심 거리까지 같으면 앞의 단어');
  assert.equal(pickTouchWord([r, l], { x: 145, y: 110 }).word.text, 'r', '앞의 단어 = 목록 순서');
  const d1 = { text: 'first', rect: rect(10, 10, 40, 16) }, d2 = { text: 'second', rect: rect(10, 10, 40, 16) };
  assert.equal(pickTouchWord([d1, d2], { x: 20, y: 15 }).word.text, 'first', '완전히 같은 중복 박스는 앞의 것');
});

// 영상 비율 5종 × 화면 4종: 화면에 보이는 영역 전체를 크롭으로 잡았을 때(guideToVideoCrop(view, view)) 인식 이미지 속 단어 박스가
// projectCropBox 로 화면 좌표에 놓이고, 그 중심을 터치하면 그 단어가 골라진다. 보이는 영역 밖은 크롭에 들어오지 않는다.
const VIDEOS = [[1080, 1920], [1920, 1080], [1280, 720], [720, 1280], [1080, 1080], [3840, 2160]];
const VIEWS = [{ left: 0, top: 76, width: 390, height: 768 }, { left: 0, top: 76, width: 1280, height: 724 }, { left: 10, top: 20, width: 800, height: 600 }, { left: 0, top: 0, width: 320, height: 568 }];

test('영상 비율 6종 × 화면 4종: 보이는 영역 전체 크롭 → 단어 박스 화면 투영 → 중심 터치로 선택', async () => {
  const { pickTouchWord } = await load('touchWordPick.js');
  const g = await load('liveOverlayGeometry.js');
  for (const [vw, vh] of VIDEOS) {
    for (const view of VIEWS) {
      const c = g.guideToVideoCrop(vw, vh, view, view);
      assert.ok(c, `크롭 있음 ${vw}x${vh} / ${view.width}x${view.height}`);
      // 화면 사각형 전체가 크롭에 들어온다(object-fit: cover 로 잘린 부분은 영상 쪽에서 빠짐)
      const toVideo = p => [(p.x - view.left - c.ox) / c.s, (p.y - view.top - c.oy) / c.s];
      for (const corner of [{ x: view.left, y: view.top }, { x: view.left + view.width, y: view.top + view.height }]) {
        const [vx, vy] = toVideo(corner);
        assert.ok(vx >= c.x - 1 && vx <= c.x + c.w + 1 && vy >= c.y - 1 && vy <= c.y + c.h + 1, `보이는 영역 모서리가 크롭 안: ${vx},${vy} / ${c.x},${c.y},${c.w},${c.h}`);
      }
      assert.ok(c.outW <= 1498, '폭 상한');
      // 크롭 이미지(outW×outH) 안의 단어 3개 → 화면(오버레이 기준) 좌표
      const mk = (text, fx, fy) => {
        const bbox = bb(Math.round(c.outW * fx), Math.round(c.outH * fy), Math.round(c.outW * fx) + Math.round(c.outW * 0.25), Math.round(c.outH * fy) + Math.round(c.outH * 0.04));
        return { text, bbox, rect: g.projectCropBox(bbox, c) };
      };
      const words = [mk('one', 0.1, 0.2), mk('two', 0.5, 0.5), mk('three', 0.2, 0.8)];
      for (const w of words) {
        assert.ok(w.rect.left >= -1 && w.rect.top >= -1 && w.rect.left + w.rect.width <= view.width + 1 && w.rect.top + w.rect.height <= view.height + 1, `박스가 오버레이(보이는 영역) 안: ${w.text}`);
        const center = { x: w.rect.left + w.rect.width / 2, y: w.rect.top + w.rect.height / 2 };
        assert.equal(pickTouchWord(words, center).word.text, w.text, `중심 터치 → ${w.text} (${vw}x${vh}, ${view.width}x${view.height})`);
        assert.equal(pickTouchWord([w], { x: center.x, y: center.y + w.rect.height / 2 + 100 }), null, '박스에서 100px 떨어진 곳은 아무 단어도 아님');
      }
    }
  }
});
