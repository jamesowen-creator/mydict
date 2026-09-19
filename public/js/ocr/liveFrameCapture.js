export function captureLiveFrame(video, canvas, guide) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) throw new Error('카메라 프레임을 준비하지 못했습니다.');
  const x = Math.max(0, Math.round(guide.left * vw));
  const y = Math.max(0, Math.round(guide.top * vh));
  const w = Math.min(vw - x, Math.round(guide.width * vw));
  const h = Math.min(vh - y, Math.round(guide.height * vh));
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, x, y, w, h, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('프레임 변환에 실패했습니다.')), 'image/jpeg', 0.88));
}
