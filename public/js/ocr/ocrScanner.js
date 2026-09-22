import { captureLiveFrame } from './liveFrameCapture.js';
import { createLiveEnglishOcrSession } from './liveEnglishOcrSession.js';
import { deriveLiveOcrCandidates, preloadEnglishWordSet } from './extractEnglishCandidates.js';
import { projectOverlayRect } from './liveOverlayGeometry.js';

// 작업7: 원 크기(56px)는 그대로 두고 아이콘만 22px -> 28px로 키워서
// 원 안에 더 꽉 차 보이게 함
const PLAY_ICON = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84L20.3 12.84a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M7 5a2 2 0 0 1 2 2v10a2 2 0 1 1-4 0V7a2 2 0 0 1 2-2Zm10 0a2 2 0 0 1 2 2v10a2 2 0 1 1-4 0V7a2 2 0 0 1 2-2Z"/></svg>';

function describeCameraError(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return '카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 허용한 뒤 다시 시도해주세요.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '사용할 수 있는 카메라를 찾지 못했습니다.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '카메라를 열 수 없습니다. 다른 앱이 카메라를 사용 중인지 확인해주세요.';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return '이 기기에서 요청한 카메라 화질을 사용할 수 없습니다.';
  if (name === 'SecurityError') return '보안 정책으로 카메라를 사용할 수 없습니다. HTTPS 환경에서 다시 시도해주세요.';
  return '라이브 카메라를 시작하지 못했습니다. 다시 시도해주세요.';
}

export function createOcrScanner(root, { onSelect } = {}) {
  const video = root.querySelector('[data-ocr-video]');
  const canvas = root.querySelector('[data-ocr-canvas]');
  const overlay = root.querySelector('[data-ocr-overlay]');
  const list = root.querySelector('[data-ocr-candidates]');
  const errorEl = root.querySelector('[data-ocr-error]');
  const captureBtn = root.querySelector('[data-ocr-capture]');
  const prevBtn = root.querySelector('[data-ocr-prev]');
  const nextBtn = root.querySelector('[data-ocr-next]');
  const torchBtn = root.querySelector('[data-ocr-torch]');
  const guideEl = root.querySelector('[data-ocr-guide]');
  const laserEl = root.querySelector('[data-ocr-laser]');
  const guide = { left: .11, top: .38, width: .78, height: .28 };
  const state = {
    stream: null, session: null, timer: null, busy: false,
    cameraOpen: false, paused: false,
    history: [], cursor: -1
  };

  function showError(message) { errorEl.textContent = message || ''; }

  function updateChrome() {
    guideEl.classList.toggle('camera-open', state.cameraOpen);
    laserEl.classList.toggle('is-paused', state.paused);
    captureBtn.innerHTML = state.cameraOpen ? (state.paused ? PLAY_ICON : PAUSE_ICON) : PLAY_ICON;
    captureBtn.setAttribute('aria-label', state.cameraOpen ? (state.paused ? '재개' : '일시정지') : '시작');
    prevBtn.disabled = state.cursor <= 0;
    nextBtn.disabled = state.cursor >= state.history.length - 1;
  }

  function render(words = []) {
    list.innerHTML = words.map(w => `<button type="button" class="ocr-candidate"><span>${w.text}</span></button>`).join('');
    list.querySelectorAll('button').forEach((b, i) => {
      b.onclick = () => onSelect?.(words[i].text);
    });
    overlay.innerHTML = words.map(w => {
      const r = projectOverlayRect(w.bbox, video, overlay, guide);
      return r ? `<span class="ocr-box" style="left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px"></span>` : '';
    }).join('');
  }

  function renderHistory() {
    render(state.history[state.cursor] || []);
    updateChrome();
  }

  function recordHistory(words) {
    if (!words.length) return;
    const latest = state.history[state.history.length - 1];
    if (latest && latest.length === words.length && latest.every((w, i) => w.text === words[i].text)) return;
    state.history = [...state.history, words].slice(-10);
    state.cursor = state.history.length - 1;
  }

  async function scan() {
    if (state.busy || state.paused || !state.session) return;
    state.busy = true;
    try {
      const blob = await captureLiveFrame(video, canvas, guide);
      const imageSize = { width: canvas.width, height: canvas.height };
      const data = await state.session.recognize(blob);
      const words = await deriveLiveOcrCandidates(data, imageSize);
      if (words.length) {
        recordHistory(words);
        render(words);
        showError('');
        updateChrome();
      }
    } catch (e) {
      showError('텍스트 인식 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      state.busy = false;
    }
  }

  async function start() {
    showError('');
    void preloadEnglishWordSet(); // kick off in parallel with the camera prompt below
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (e) {
      showError(describeCameraError(e));
      return;
    }
    try {
      video.srcObject = state.stream;
      await video.play();
      const track = state.stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() || {};
      if (caps.torch) {
        torchBtn.hidden = false;
        torchBtn.onclick = () => {
          const on = torchBtn.dataset.on === '1';
          track.applyConstraints({ advanced: [{ torch: !on }] });
          torchBtn.dataset.on = on ? '0' : '1';
          torchBtn.classList.toggle('active', !on);
        };
      }
      state.session = await createLiveEnglishOcrSession();
    } catch (e) {
      showError(e.message || '라이브 OCR 엔진을 준비하지 못했습니다. 다시 시도해주세요.');
      stopCamera();
      return;
    }
    state.cameraOpen = true;
    state.paused = false;
    state.timer = setInterval(scan, 2000);
    updateChrome();
    scan();
  }

  function stopCamera() {
    clearInterval(state.timer);
    state.timer = null;
    state.stream?.getTracks().forEach(t => t.stop());
    state.stream = null;
    video.srcObject = null;
    state.session?.terminate();
    state.session = null;
    state.cameraOpen = false;
    state.paused = false;
    state.history = [];
    state.cursor = -1;
    list.innerHTML = '';
    overlay.innerHTML = '';
    updateChrome();
  }

  captureBtn.onclick = () => {
    if (!state.cameraOpen) { void start(); return; }
    state.paused = !state.paused;
    if (!state.paused) scan();
    updateChrome();
  };

  prevBtn.onclick = () => { if (state.cursor > 0) { state.cursor--; renderHistory(); } };
  nextBtn.onclick = () => { if (state.cursor < state.history.length - 1) { state.cursor++; renderHistory(); } };

  root.querySelector('[data-ocr-close]').onclick = stopCamera;

  updateChrome();
  return { stop: stopCamera };
}
