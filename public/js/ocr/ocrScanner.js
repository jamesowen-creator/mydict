import { captureLiveFrame } from './liveFrameCapture.js';
import { createLiveOcrSession } from './liveOcrSession.js';
import { deriveLiveOcrCandidates, preloadEnglishWordSet } from './extractEnglishCandidates.js';
import { deriveLiveJapaneseCandidates, preloadJapaneseTokenizer } from './extractJapaneseCandidates.js';
import { projectOverlayRect } from './liveOverlayGeometry.js';
import { createCandidateStabilityTracker } from './ocrCandidateStability.js';

// 작업118: 앱 전역에서 쓰는 언어 코드(en/ja - searchWord 등과 통일)를
// Tesseract 언어 코드로 변환
const TESSERACT_LANG = { en: 'eng', ja: 'jpn' };

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
  const langTabBtns = root.querySelectorAll('[data-ocr-lang]');
  const guide = { left: .11, top: .38, width: .78, height: .28 };
  const state = {
    stream: null, session: null, timer: null, busy: false,
    cameraOpen: false, paused: false,
    history: [], cursor: -1,
    lang: 'en' // 작업118: 기본값 영어
  };
  // 작업112: 같은 단어가 연속 프레임 동안 재인식돼야만 후보로 승인
  const stability = createCandidateStabilityTracker();

  function showError(message) { errorEl.textContent = message || ''; }

  function updateLangTabs() {
    langTabBtns.forEach(b => b.classList.toggle('active', b.dataset.ocrLang === state.lang));
  }

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
      // 작업107: 선택한 단어 하나만이 아니라, 같은 프레임에서 인식된 후보
      // 전체 목록과 그 안에서의 인덱스도 함께 넘겨서(호출부가 순차 탐색
      // 큐를 구성할 수 있도록) - 기존 onSelect(word) 호출자와도 호환되게
      // 뒤에 추가 인자로만 붙인다.
      // 작업118: 어떤 언어로 인식된 후보인지도 같이 넘겨서(searchWord에
      // 'en'을 하드코딩하지 않고) 검색이 올바른 언어로 실행되게 함.
      b.onclick = () => onSelect?.(words[i].text, i, words.map(w => w.text), state.lang);
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
      // 작업118: 활성 언어에 맞는 후보 추출 함수로 분기
      const rawWords = state.lang === 'ja'
        ? await deriveLiveJapaneseCandidates(data, imageSize)
        : await deriveLiveOcrCandidates(data, imageSize);
      // 작업112: 매 프레임(빈 프레임 포함) 넣어야 스트릭이 정확히 유지/리셋됨
      const words = stability.filter(rawWords);
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
    // 작업118/121: 활성 언어에 필요한 사전 리소스를 카메라 권한 프롬프트와
    // 병렬로 미리 불러오기 시작 - 영어는 274k 단어 목록, 일본어는 형태소
    // 분석 사전(17.8MB). 이미 로딩됐거나 로딩 중이면 캐시된 프로미스를
    // 그대로 재사용(재다운로드 없음).
    if (state.lang === 'en') void preloadEnglishWordSet();
    if (state.lang === 'ja') void preloadJapaneseTokenizer(); // kick off in parallel with the camera prompt below
    try {
      // 작업115: 720p -> 1080p. 작업114 실측 결과, 매우 작은/빽빽한 인쇄
      // 텍스트에서 720p는 실패하는 경우가 많았고 1080p로만 올려도 대부분
      // 회복됐음(반면 4K는 그 이상 추가 이득이 적어 채택 안 함). ideal은
      // 강제 아님 - 카메라가 1080p를 지원 못 하면 브라우저가 에러 없이
      // 가장 가까운 해상도로 자동 폴백하므로 구형 기기 호환성 리스크 없음.
      // 가이드 박스 크롭(liveFrameCapture.js)과 오버레이 투영
      // (liveOverlayGeometry.js) 모두 video.videoWidth/videoHeight를 실시간
      // 조회해 비율로 계산하므로 이 값만 바꾸면 나머지는 자동으로 맞춰짐.
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
      state.session = await createLiveOcrSession(TESSERACT_LANG[state.lang]);
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
    stability.reset();
    list.innerHTML = '';
    overlay.innerHTML = '';
    updateChrome();
  }

  // 작업118: 언어 탭 전환. 이전 언어의 후보/안정성 스트릭은 새 언어와
  // 무관하므로 그대로 초기화한다. 카메라가 이미 열려있으면 워커를 새로
  // 만들지 않고 worker.reinitialize()만 호출(liveOcrSession.js) - 최초
  // 사용하는 언어만 다운로드가 발생한다.
  // 작업121: 일본어는 형태소 분석 사전(17.8MB)까지 같이 준비해야 해서
  // 영어 전환보다 오래 걸릴 수 있음 - 카메라가 아직 안 열려있어도(탭만
  // 누른 시점) 미리 받아두도록 명시적으로 기다리면서 "일본어 사전
  // 준비 중..."을 보여준다(다운로드 자체는 Promise 캐싱 덕분에 여기서
  // 시작해두면 이후 촬영 시작 시 다시 기다릴 필요가 없어짐).
  async function setLanguage(lang) {
    if (lang === state.lang || !(lang in TESSERACT_LANG)) return;
    state.lang = lang;
    stability.reset();
    state.history = [];
    state.cursor = -1;
    list.innerHTML = '';
    overlay.innerHTML = '';
    updateChrome();
    updateLangTabs();
    if (lang === 'en') void preloadEnglishWordSet();

    const tasks = [];
    if (state.session) tasks.push(state.session.setLanguage(TESSERACT_LANG[lang]));
    if (lang === 'ja') tasks.push(preloadJapaneseTokenizer());
    if (!tasks.length) return;

    state.busy = true;
    showError(lang === 'ja' ? '일본어 사전 준비 중...' : '언어 준비 중...');
    try {
      await Promise.all(tasks);
      showError('');
    } catch (e) {
      showError('언어 전환에 실패했습니다. 다시 시도해주세요.');
    } finally {
      state.busy = false;
    }
  }

  langTabBtns.forEach(b => { b.onclick = () => setLanguage(b.dataset.ocrLang); });

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
  updateLangTabs();
  return { stop: stopCamera };
}
