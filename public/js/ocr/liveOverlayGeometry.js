export function projectOverlayRect(box, video, layer, guide = { left: 0, top: 0, width: 1, height: 1 }) {
  if (!box || !video.videoWidth || !video.videoHeight) return null;
  const cropW = guide.width * video.videoWidth, cropH = guide.height * video.videoHeight;
  return { left: (guide.left * video.videoWidth + box.x0) / video.videoWidth * layer.clientWidth, top: (guide.top * video.videoHeight + box.y0) / video.videoHeight * layer.clientHeight, width: (box.x1 - box.x0) / video.videoWidth * layer.clientWidth, height: (box.y1 - box.y0) / video.videoHeight * layer.clientHeight };
}

// 작업266: 눈에 보이는 가이드(.ocr-guide) 화면 사각형 = 실제로 인식하는 영역.
// 영상은 .ocr-preview 안에서 object-fit: cover 로 그려지므로(비율이 다르면 양쪽이 잘림)
// scale = max(표시폭/영상폭, 표시높이/영상높이), 가운데 정렬 오프셋 ox·oy 로 영상 좌표 <-> 화면 좌표를 바꾼다.
// 크롭(captureLiveFrame)과 인식 박스 오버레이(projectCropBox)가 같은 변환(crop.s·ox·oy)을 쓴다.
// 화면 사각형은 { left, top, width, height }(getBoundingClientRect). 읽을 수 없으면 null -> 호출부가 기존 비율 계산으로 폴백.
export const MAX_CROP_WIDTH = 1498;   // 인식에 넘기는 이미지 폭 상한(기존 가이드 크롭의 1080p 폭과 같은 수준)

export function guideToVideoCrop(videoWidth, videoHeight, view, guide, maxWidth = MAX_CROP_WIDTH) {
  if (!(videoWidth > 0 && videoHeight > 0) || !view || !guide || !(view.width > 0 && view.height > 0) || !(guide.width > 0 && guide.height > 0)) return null;
  const s = Math.max(view.width / videoWidth, view.height / videoHeight);
  const ox = (view.width - videoWidth * s) / 2, oy = (view.height - videoHeight * s) / 2;
  const x0 = Math.max(0, (guide.left - view.left - ox) / s), y0 = Math.max(0, (guide.top - view.top - oy) / s);
  const x1 = Math.min(videoWidth, (guide.left + guide.width - view.left - ox) / s), y1 = Math.min(videoHeight, (guide.top + guide.height - view.top - oy) / s);
  const x = Math.round(x0), y = Math.round(y0), w = Math.round(x1) - x, h = Math.round(y1) - y;
  if (!(w >= 8 && h >= 8)) return null;   // 가이드가 영상 밖이거나 너무 작음
  const k = w > maxWidth ? maxWidth / w : 1;
  return { x, y, w, h, outW: Math.max(1, Math.round(w * k)), outH: Math.max(1, Math.round(h * k)), s, ox, oy };
}

// video 요소와 가이드 요소의 현재 화면 사각형을 읽어 크롭을 계산한다(스캔마다 호출하므로 회전·창 크기 변경이 자동 반영됨)
export function computeGuideCrop(video, guideEl, maxWidth = MAX_CROP_WIDTH) {
  if (!video || !guideEl || !video.videoWidth || !video.videoHeight) return null;
  return guideToVideoCrop(video.videoWidth, video.videoHeight, video.getBoundingClientRect(), guideEl.getBoundingClientRect(), maxWidth);
}

// 크롭 이미지 안의 인식 박스(bbox, 크롭 이미지 픽셀) -> .ocr-overlay 안의 화면 좌표(overlay 는 영상 요소와 같은 사각형)
export function projectCropBox(box, crop) {
  if (!box || !crop) return null;
  const k = crop.w / crop.outW;
  return { left: (crop.x + box.x0 * k) * crop.s + crop.ox, top: (crop.y + box.y0 * k) * crop.s + crop.oy, width: (box.x1 - box.x0) * k * crop.s, height: (box.y1 - box.y0) * k * crop.s };
}
