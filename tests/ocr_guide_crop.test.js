// 작업266-1: 눈에 보이는 가이드(.ocr-guide) 화면 사각형 -> 영상 원본 좌표 크롭 변환(object-fit: cover)과 인식 박스 투영의 순수 계산 테스트(브라우저 없음).
// public/js/ocr/liveOverlayGeometry.js 는 브라우저용 ESM 이라 파일 내용을 data: URL 로 불러온다.
// 실행: node --test tests/ocr_guide_crop.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ocr', 'liveOverlayGeometry.js')).toString('base64'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const VIDEOS = [[1080, 1920], [1920, 1080], [1280, 720], [720, 1280], [1080, 1080]];
const VIEWS = [{ left: 0, top: 76, width: 390, height: 768 }, { left: 0, top: 76, width: 1280, height: 724 }, { left: 10, top: 20, width: 800, height: 600 }, { left: 0, top: 0, width: 320, height: 568 }];
// 실제 CSS 처럼 보이는 영역 중앙에서 위로 약간 치우친 280x224 가이드
const guideOf = v => ({ left: v.left + (v.width - 280) / 2, top: v.top + (v.height - 224) / 2 - 30, width: 280, height: 224 });

test('가이드 사각형 -> 크롭 -> 다시 화면 좌표로 바꾸면 가이드와 같다(영상 비율 5종 × 화면 4종)', async () => {
  const g = await load();
  for (const [vw, vh] of VIDEOS) for (const view of VIEWS) {
    const guide = guideOf(view); const c = g.guideToVideoCrop(vw, vh, view, guide);
    const label = `영상 ${vw}x${vh} 화면 ${view.width}x${view.height}`;
    assert.ok(c, label + ': 크롭이 계산되어야 함');
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= vw && c.y + c.h <= vh, label + ': 영상 안');
    const sx0 = c.x * c.s + c.ox + view.left, sy0 = c.y * c.s + c.oy + view.top, sx1 = (c.x + c.w) * c.s + c.ox + view.left, sy1 = (c.y + c.h) * c.s + c.oy + view.top;
    near(sx0, guide.left, 1.5, label + ' 왼쪽'); near(sy0, guide.top, 1.5, label + ' 위'); near(sx1, guide.left + guide.width, 1.5, label + ' 오른쪽'); near(sy1, guide.top + guide.height, 1.5, label + ' 아래');
  }
});

test('인식 박스 투영: 크롭 이미지 전체를 감싸는 박스는 가이드 사각형과 같다(오버레이는 영상 요소와 같은 사각형)', async () => {
  const g = await load();
  for (const [vw, vh] of VIDEOS) for (const view of VIEWS) {
    const guide = guideOf(view); const c = g.guideToVideoCrop(vw, vh, view, guide);
    const b = g.projectCropBox({ x0: 0, y0: 0, x1: c.outW, y1: c.outH }, c);
    const label = `영상 ${vw}x${vh} 화면 ${view.width}x${view.height}`;
    near(b.left + view.left, guide.left, 1.5, label + ' 박스 왼쪽'); near(b.top + view.top, guide.top, 1.5, label + ' 박스 위');
    near(b.width, guide.width, 1.5, label + ' 박스 폭'); near(b.height, guide.height, 1.5, label + ' 박스 높이');
  }
});

test('폭 상한: 큰 가이드는 폭 1498px 이하로 줄여 넘기고 비율은 유지', async () => {
  const g = await load();
  const c = g.guideToVideoCrop(3840, 2160, { left: 0, top: 0, width: 800, height: 450 }, { left: 0, top: 0, width: 800, height: 450 });
  assert.equal(c.w, 3840); assert.equal(c.outW, 1498); near(c.outW / c.outH, c.w / c.h, 0.01, '비율');
  const small = g.guideToVideoCrop(1080, 1920, VIEWS[0], guideOf(VIEWS[0]));
  assert.equal(small.outW, small.w, '상한 이하이면 그대로');
});

test('읽을 수 없으면 null(호출부가 기존 비율 계산으로 폴백): 영상 크기 0, 화면·가이드 크기 0, 가이드가 영상 밖', async () => {
  const g = await load();
  const v = VIEWS[0]; const gd = guideOf(v);
  assert.equal(g.guideToVideoCrop(0, 0, v, gd), null);
  assert.equal(g.guideToVideoCrop(1080, 1920, { left: 0, top: 0, width: 0, height: 0 }, gd), null);
  assert.equal(g.guideToVideoCrop(1080, 1920, v, { left: 0, top: 0, width: 0, height: 0 }), null);
  assert.equal(g.guideToVideoCrop(1080, 1920, v, { left: 1000, top: 1000, width: 100, height: 100 }), null);
  assert.equal(g.computeGuideCrop({ videoWidth: 0, videoHeight: 0, getBoundingClientRect: () => v }, { getBoundingClientRect: () => gd }), null);
  assert.equal(g.computeGuideCrop(null, null), null);
  const c = g.computeGuideCrop({ videoWidth: 1080, videoHeight: 1920, getBoundingClientRect: () => v }, { getBoundingClientRect: () => gd });
  assert.ok(c && c.w > 0, 'computeGuideCrop 는 요소의 사각형을 읽어 계산');
});

test('화면 크기가 바뀌면(회전 등) 스캔마다 다시 계산되므로 같은 가이드라도 다른 크롭이 나온다', async () => {
  const g = await load();
  const a = g.guideToVideoCrop(1080, 1920, VIEWS[0], guideOf(VIEWS[0])), b = g.guideToVideoCrop(1920, 1080, { left: 0, top: 0, width: 844, height: 390 }, guideOf({ left: 0, top: 0, width: 844, height: 390 }));
  assert.notDeepEqual([a.x, a.y, a.w, a.h], [b.x, b.y, b.w, b.h]);
});
