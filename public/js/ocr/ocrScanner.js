import { captureLiveFrame } from './liveFrameCapture.js';
import { createLiveEnglishOcrSession } from './liveEnglishOcrSession.js';
import { deriveLiveOcrCandidates, preloadEnglishWordSet, normalizeToken } from './extractEnglishCandidates.js';
import { projectOverlayRect, projectCropBox, computeGuideCrop, guideToVideoCrop } from './liveOverlayGeometry.js';
import { filterTouchWords, pickTouchWord } from './touchWordPick.js';
import { MAX_PICKS, addPick, movePick, removePick, hasPick } from './pickList.js';
import { createCandidateStabilityTracker } from './ocrCandidateStability.js';

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

// 작업272-3: 터치 모드에서 담은 단어 목록. createOcrScanner 가 열 때마다 새로 만들어져도 목록은 유지한다(메모리만, 새로고침하면 사라짐)
let sharedPicks = [];

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
  // 작업272-2: 터치 모드(상단 [자동 | 터치])
  const modeBtns = [...root.querySelectorAll('[data-ocr-mode]')];
  const touchBar = root.querySelector('[data-ocr-touch-bar]');
  const touchMsg = root.querySelector('[data-ocr-touch-msg]');
  const retakeBtn = root.querySelector('[data-ocr-touch-retake]');
  const picksEl = root.querySelector('[data-ocr-picks]');
  const pickCountEl = root.querySelector('[data-ocr-pick-count]');
  const picksEmptyEl = root.querySelector('[data-ocr-picks-empty]');
  const pickGoBtn = root.querySelector('[data-ocr-pick-go]');
  const touch = { words: null, busy: false, seq: 0 };   // words: 스냅샷에서 인식한 단어(화면 좌표 rect 포함). seq: 낡은 인식 결과를 버리는 번호
  const state = {
    stream: null, session: null, timer: null, busy: false,
    cameraOpen: false, paused: false,
    history: [], cursor: -1,
    // 작업272-1: 세대 번호(취소 토큰). start()/stopCamera() 마다 바뀌어, 그 사이에 끝난 비동기 작업(카메라 열기·엔진 준비·인식)이
    // 이미 종료된 세션의 상태를 건드리지 못하게 한다. starting: 시작 중 중복 시작 방지
    gen: 0, starting: false,
    mode: 'auto'
  };
  // 작업112: 같은 단어가 연속 프레임 동안 재인식돼야만 후보로 승인
  const stability = createCandidateStabilityTracker();

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
      // 작업107: 선택한 단어 하나만이 아니라, 같은 프레임에서 인식된 후보
      // 전체 목록과 그 안에서의 인덱스도 함께 넘겨서(호출부가 순차 탐색
      // 큐를 구성할 수 있도록) - 기존 onSelect(word) 호출자와도 호환되게
      // 뒤에 추가 인자로만 붙인다.
      b.onclick = () => onSelect?.(words[i].text, i, words.map(w => w.text));
    });
    overlay.innerHTML = words.map(w => {
      // 작업266: 인식한 프레임의 크롭 변환(w.crop)으로 투영(크롭과 같은 규칙). 크롭 정보가 없으면 기존 비율 방식
      const r = w.crop ? projectCropBox(w.bbox, w.crop) : projectOverlayRect(w.bbox, video, overlay, guide);
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
    const gen = state.gen, session = state.session;   // 작업272-1: 이 스캔이 속한 세션. 도중에 종료·재시작되면 gen 이 달라져 결과를 버린다
    const stale = () => gen !== state.gen || state.mode !== 'auto';   // 작업272-2: 터치 모드로 바뀐 뒤 끝난 자동 스캔 결과도 버린다
    state.busy = true;
    try {
      // 작업266: 스캔마다 눈에 보이는 가이드(.ocr-guide)의 화면 사각형을 읽어 영상 좌표로 바꾼 크롭을 쓴다(회전·창 크기 변경 반영)
      const crop = computeGuideCrop(video, guideEl);
      const blob = await captureLiveFrame(video, canvas, guide, crop);
      if (stale()) return;
      const imageSize = { width: canvas.width, height: canvas.height };
      const data = await session.recognize(blob);
      if (stale()) return;
      const rawWords = await deriveLiveOcrCandidates(data, imageSize);
      if (stale()) return;
      // 작업112: 매 프레임(빈 프레임 포함) 넣어야 스트릭이 정확히 유지/리셋됨
      const words = stability.filter(rawWords).map(w => ({ ...w, crop }));
      if (words.length) {
        recordHistory(words);
        render(words);
        showError('');
        updateChrome();
      }
    } catch (e) {
      if (!stale()) showError('텍스트 인식 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      if (gen === state.gen) state.busy = false;
    }
  }

  async function start() {
    if (state.starting || state.cameraOpen) return;   // 작업272-1: 시작 중·열린 상태에서 다시 눌러도 카메라를 또 열지 않는다
    const gen = ++state.gen;
    state.starting = true;
    const mine = { stream: null, session: null };
    const cancelled = () => gen !== state.gen;
    // 취소된 시작이 자기가 연 자원만 정리한다(그 사이 새로 시작한 쪽의 상태는 건드리지 않는다)
    const abandon = () => {
      if (mine.stream) mine.stream.getTracks().forEach(t => t.stop());
      if (mine.session) Promise.resolve(mine.session.terminate()).catch(() => {});
    };
    showError('');
    void preloadEnglishWordSet(); // kick off in parallel with the camera prompt below
    try {
      try {
        // 작업115: 720p -> 1080p. 작업114 실측 결과, 매우 작은/빽빽한 인쇄
        // 텍스트에서 720p는 실패하는 경우가 많았고 1080p로만 올려도 대부분
        // 회복됐음(반면 4K는 그 이상 추가 이득이 적어 채택 안 함). ideal은
        // 강제 아님 - 카메라가 1080p를 지원 못 하면 브라우저가 에러 없이
        // 가장 가까운 해상도로 자동 폴백하므로 구형 기기 호환성 리스크 없음.
        // 가이드 박스 크롭(liveFrameCapture.js)과 오버레이 투영
        // (liveOverlayGeometry.js) 모두 video.videoWidth/videoHeight를 실시간
        // 조회해 비율로 계산하므로 이 값만 바꾸면 나머지는 자동으로 맞춰짐.
        mine.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
      } catch (e) {
        if (!cancelled()) showError(describeCameraError(e));
        return;
      }
      if (cancelled()) { abandon(); return; }
      state.stream = mine.stream;
      try {
        video.srcObject = mine.stream;
        await video.play();
        if (cancelled()) { abandon(); return; }
        const track = mine.stream.getVideoTracks()[0];
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
        mine.session = await createLiveEnglishOcrSession();
      } catch (e) {
        if (cancelled()) { abandon(); return; }
        showError(e.message || '라이브 OCR 엔진을 준비하지 못했습니다. 다시 시도해주세요.');
        stopCamera();
        return;
      }
      if (cancelled()) { abandon(); return; }   // 엔진 준비 중에 종료됨: 만든 세션을 바로 정리하고 스캔을 시작하지 않는다
      state.session = mine.session;
      state.cameraOpen = true;
      state.paused = state.mode === 'touch';   // 터치 모드로 시작하면 자동 스캔은 멈춘 채 둔다
      state.timer = setInterval(scan, 2000);
      updateChrome();
      showTouchHint();
      scan();
    } finally {
      if (!cancelled()) state.starting = false;
    }
  }

  function stopCamera() {
    state.gen++;            // 작업272-1: 진행 중인 시작·인식은 이제 취소된 것으로 본다
    state.starting = false;
    state.busy = false;
    clearInterval(state.timer);
    state.timer = null;
    state.stream?.getTracks().forEach(t => t.stop());
    state.stream = null;
    video.srcObject = null;
    const session = state.session;
    state.session = null;
    // terminate 는 오류를 삼키는 Promise 를 돌려준다. 기다리지 않아도 다음 세션 생성이 그 끝을 기다린다(liveEnglishOcrSession.js)
    if (session) Promise.resolve(session.terminate()).catch(() => {});
    state.cameraOpen = false;
    state.paused = false;
    state.history = [];
    state.cursor = -1;
    stability.reset();
    resetTouch();
    list.innerHTML = '';
    overlay.innerHTML = '';
    showTouchHint();
    updateChrome();
  }

  // ── 작업272-2: 터치 모드 ──
  function setTouchMsg(msg, { retake = false } = {}) {
    if (!touchBar) return;
    touchMsg.textContent = msg || '';
    retakeBtn.hidden = !retake;
    touchBar.hidden = !msg;
  }
  function showTouchHint() {
    if (state.mode !== 'touch') { setTouchMsg(''); return; }
    if (touch.words && touch.words.length) { setTouchMsg('다른 단어를 더 눌러 담거나, 다시 찍을 수 있어요.', { retake: true }); return; }
    setTouchMsg(state.cameraOpen ? '화면의 단어를 눌러 담으세요.' : '카메라를 준비하는 중이에요.');
  }
  // 잠깐 보이는 안내(담음·이미 담김·가득 참 등). 2.5초 뒤 일반 안내로 돌아간다(그 사이 새 안내가 있으면 건드리지 않음)
  let flashSeq = 0;
  function flashTouchMsg(text, opts) {
    setTouchMsg(text, opts);
    const my = ++flashSeq;
    setTimeout(() => { if (my === flashSeq && state.mode === 'touch') showTouchHint(); }, 2500);
  }
  function resetTouch() { touch.seq++; touch.busy = false; touch.words = null; }
  function resumeVideo() { try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 무시 */ } }

  function setMode(mode) {
    if (mode === state.mode || (mode !== 'auto' && mode !== 'touch')) return;
    state.mode = mode;
    root.dataset.mode = mode;
    modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ocrMode === mode)));
    resetTouch();
    list.innerHTML = '';
    overlay.innerHTML = '';
    stability.reset();
    if (mode === 'touch') {
      state.paused = state.cameraOpen;                       // 자동 스캔 정지(진행 중인 스캔 결과는 stale()로 버려짐)
      if (!state.cameraOpen && !state.starting) void start();   // 카메라가 아직 안 켜졌으면 모드를 고르는 동작으로 시작
    } else if (state.cameraOpen) {
      resumeVideo();                                         // 스냅샷으로 멈춘 영상을 다시 재생하고 자동 스캔 재개
      state.paused = false;
      scan();
    }
    showTouchHint();
    updateChrome();
  }

  // 스냅샷 한 장을 인식해 단어 박스를 모두 그리고, 터치한 곳의 단어를 고른다.
  // 영상은 pause 해서 화면과 인식 대상이 같은 장면이 되게 한다. 인식 영역 = 화면에 보이는 영역 전체(.ocr-preview 안의 video 사각형)
  async function onOverlayTap(ev) {
    if (state.mode !== 'touch') return;
    if (!state.cameraOpen || !state.session) {              // 카메라·엔진 준비 전: 인식하지 않고 안내만
      if (!state.starting) void start();
      setTouchMsg('카메라를 준비하는 중이에요.');
      return;
    }
    if (touch.busy) return;
    const oRect = overlay.getBoundingClientRect();
    const point = { x: ev.clientX - oRect.left, y: ev.clientY - oRect.top };
    if (touch.words) { finishPick(point); return; }           // 이미 인식한 장면: 다시 인식하지 않고 박스에서 고른다
    if (state.busy) { setTouchMsg('잠시만 기다린 뒤 다시 눌러 주세요.'); return; }   // 막 멈춘 자동 스캔이 끝나기 전(공용 canvas 보호)
    const gen = state.gen, session = state.session, seq = ++touch.seq;
    const stale = () => gen !== state.gen || seq !== touch.seq || state.mode !== 'touch';
    touch.busy = true;
    try { video.pause(); } catch (e) { /* 무시 */ }
    setTouchMsg('인식 중…');
    let timer = null;
    try {
      const view = video.getBoundingClientRect();
      const crop = guideToVideoCrop(video.videoWidth, video.videoHeight, view, view);   // 보이는 영역 전체를 영상 좌표로
      if (!crop) throw new Error('no-frame');
      const blob = await captureLiveFrame(video, canvas, guide, crop);
      if (stale()) return;
      const limit = Number(window.__OCR_TOUCH_TIMEOUT_MS) > 0 ? Number(window.__OCR_TOUCH_TIMEOUT_MS) : 20000;   // 테스트만 덮어쓴다
      const timedOut = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), limit); });
      const data = await Promise.race([session.recognize(blob), timedOut]);
      if (stale()) return;
      const words = filterTouchWords(data && data.words, normalizeToken).map(w => ({ ...w, rect: projectCropBox(w.bbox, crop) }));
      touch.words = words;
      drawTouchBoxes();
      if (!words.length) { setTouchMsg('인식된 단어가 없어요.', { retake: true }); return; }
      finishPick(point);
    } catch (e) {
      if (stale()) return;
      touch.seq++;                                           // 늦게 끝나는 옛 인식 결과는 버린다
      overlay.innerHTML = '';
      touch.words = null;
      setTouchMsg(e && e.message === 'timeout' ? '인식이 오래 걸려 중단했어요. 다시 찍거나 종료해 주세요.' : '인식 중 오류가 났어요. 다시 찍어 주세요.', { retake: true });
    } finally {
      if (timer) clearTimeout(timer);
      if (gen === state.gen && seq === touch.seq) touch.busy = false;
    }
  }

  function drawTouchBoxes() {
    const words = touch.words || [];
    overlay.innerHTML = words.map(w => `<span class="ocr-box${hasPick(sharedPicks, w.text) ? ' picked' : ''}" style="left:${w.rect.left}px;top:${w.rect.top}px;width:${w.rect.width}px;height:${w.rect.height}px"></span>`).join('');
  }

  // 작업272-3: 터치한 단어는 바로 검색하지 않고 목록에 담는다. 같은 장면에서 이어서 더 담을 수 있다(영상은 멈춘 채, 다시 찍기로 새 장면)
  function finishPick(point) {
    const picked = pickTouchWord(touch.words, point);
    if (!picked) { flashTouchMsg('단어를 찾지 못했어요.', { retake: true }); return; }
    const text = picked.word.text;
    const r = addPick(sharedPicks, text);
    if (r.status === 'added') {
      sharedPicks = r.list;
      flashTouchMsg('‘' + text + '’ 담았어요.', { retake: true });
    } else if (r.status === 'duplicate') {
      flashTouchMsg('‘' + text + '’ 은(는) 이미 담겨 있어요.', { retake: true });
    } else if (r.status === 'full') {
      flashTouchMsg('한 번에 ' + MAX_PICKS + '개까지만 담을 수 있어요. 목록에서 지우고 담아 주세요.', { retake: true });
    }
    renderPicks();
    drawTouchBoxes();
  }

  const ARROW_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>';
  const ARROW_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  const CLOSE_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  function renderPicks() {
    if (!picksEl) return;
    picksEl.textContent = '';
    sharedPicks.forEach((w, i) => {
      const li = document.createElement('li');
      li.className = 'ocr-pick';
      li.dataset.word = w;
      const n = document.createElement('span'); n.className = 'ocr-pick-n'; n.textContent = String(i + 1);
      const t = document.createElement('span'); t.className = 'ocr-pick-w'; t.textContent = w;
      const mk = (cls, label, svg, disabled, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ocr-pick-btn ' + cls; b.setAttribute('aria-label', w + ' ' + label); b.innerHTML = svg; b.disabled = disabled;
        b.onclick = fn;
        return b;
      };
      li.append(n, t,
        mk('up', '위로', ARROW_UP, i === 0, () => { sharedPicks = movePick(sharedPicks, i, -1); renderPicks(); }),
        mk('down', '아래로', ARROW_DOWN, i === sharedPicks.length - 1, () => { sharedPicks = movePick(sharedPicks, i, 1); renderPicks(); }),
        mk('del', '삭제', CLOSE_X, false, () => { sharedPicks = removePick(sharedPicks, i); renderPicks(); drawTouchBoxes(); }));
      picksEl.append(li);
    });
    pickCountEl.textContent = sharedPicks.length + ' / ' + MAX_PICKS;
    picksEmptyEl.hidden = sharedPicks.length > 0;
    pickGoBtn.disabled = sharedPicks.length === 0;
  }
  if (pickGoBtn) {
    // [검색 시작]: 첫 단어를 검색하고 목록 전체를 순차 검색 큐(n/N, 다음)로 넘긴다. 목록은 비우지 않는다
    pickGoBtn.onclick = () => { if (sharedPicks.length) onSelect?.(sharedPicks[0], 0, sharedPicks.slice()); };
  }

  modeBtns.forEach(b => { b.onclick = () => setMode(b.dataset.ocrMode); });
  overlay.onclick = onOverlayTap;
  if (retakeBtn) {
    retakeBtn.onclick = () => {                              // 멈춘 장면을 버리고 영상을 다시 재생한다
      resetTouch();
      overlay.innerHTML = '';
      resumeVideo();
      showTouchHint();
    };
  }
  root.dataset.mode = 'auto';
  modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ocrMode === 'auto')));
  renderPicks();

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
