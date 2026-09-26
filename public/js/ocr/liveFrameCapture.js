// 작업110: 그레이스케일 + 대비 강화(+옵션으로 Otsu 이진화) 전처리.
// 합성 텍스트 이미지로 실측한 결과, 강한 이진화(0/255 이분화)는 기울어진
// 촬영을 흉내낸 조건에서 오히려 인식 신뢰도를 떨어뜨렸다(획이 가늘어지는
// 부분이 잘려나가는 것으로 추정) - 그래서 기본값은 이진화 없이 대비
// 강화까지만 적용한다. 자세한 수치는 작업110 진행 보고 참고.
//
// ImageData.data(Uint8ClampedArray)만 다루는 순수 함수라서 브라우저
// CanvasRenderingContext2D.getImageData()와 Node(canvas 패키지)의
// getImageData()에서 동일하게 동작 - 그래서 이 함수 자체를 Node 테스트
// 스크립트에서 그대로 재사용해 전/후 인식률을 비교할 수 있었다.
function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) ** 2;
    if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
  }
  return threshold;
}

export function preprocessImageData(imageData, { contrast = 40, binarize = false } = {}) {
  const { data } = imageData;
  const pixelCount = data.length / 4;
  const gray = new Uint8ClampedArray(pixelCount);
  // 표준 luma 가중치(ITU-R BT.601)로 그레이스케일 변환
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  // 대비 강화: contrast(-255~255)가 클수록 중간값(128) 기준으로 명암 차를 벌림
  const factor = contrast === 0 ? 1 : (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let p = 0; p < pixelCount; p++) {
    gray[p] = clampByte(Math.round(factor * (gray[p] - 128) + 128));
  }
  if (binarize) {
    const threshold = otsuThreshold(gray);
    for (let p = 0; p < pixelCount; p++) gray[p] = gray[p] >= threshold ? 255 : 0;
  }
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    data[i] = data[i + 1] = data[i + 2] = gray[p];
  }
  return imageData;
}

// 작업110 실측 기준 기본값: 대비 강화(40)만 적용, 이진화는 끔.
// 합성 텍스트 실험에서는 대비/저조도만 나쁜 경우 Tesseract(LSTM 엔진)가
// 이미 전처리 없이도 거의 완벽하게 인식해서(96%대로 동일) 이 조합이
// 그 조건들 자체를 극적으로 개선하진 못했지만, 기울어진 촬영을 흉내낸
// 조건에서는 유일하게 베이스라인보다 나았고(다른 모든 조건에서는 항상
// 베이스라인과 동일하거나 나음) 이진화 옵션은 오히려 매번 더 나쁘거나
// 같았다 - 그래서 "손해는 없고 이득 가능성만 있는" 가장 보수적인 조합으로
// 이걸 기본값으로 선택함. 테스트 스크립트/결과는 진행 보고에 남김.
const PREPROCESS_OPTIONS = { contrast: 40, binarize: false };

export function captureLiveFrame(video, canvas, guide) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) throw new Error('카메라 프레임을 준비하지 못했습니다.');
  const x = Math.max(0, Math.round(guide.left * vw));
  const y = Math.max(0, Math.round(guide.top * vh));
  const w = Math.min(vw - x, Math.round(guide.width * vw));
  const h = Math.min(vh - y, Math.round(guide.height * vh));
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  preprocessImageData(imageData, PREPROCESS_OPTIONS);
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('프레임 변환에 실패했습니다.')), 'image/jpeg', 0.88));
}
