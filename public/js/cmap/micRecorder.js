// 작업278-1: 개념 지도 — 녹음(MediaRecorder). 개념학습 화면의 녹음 코드(음성 입력, 작업206)의 상태기계·형식 후보·오류 문구를 읽고 복사해 독립시킨 것이며 옛 파일은 불러오지도 바꾸지도 않는다.
// 클래식 스크립트(window.CmapMic). 녹음 결과(Blob)는 호출한 쪽(answerView.js)이 서버로 보내며, 이 모듈은 오디오를 저장하지 않는다(메모리에서 넘기고 버림). 화면을 떠나거나 닫으면 cancel 로 녹음을 버린다.
//   const mic = CmapMic.create({ onState(state), onTick(sec, max), onError(text), onAudio(blob, seconds) });   state: idle | recording | stopping | cancelled | transcribing(호출한 쪽이 busy 로 표시)
//   mic.toggle() 녹음 시작/끝내기, mic.cancel() 버림, mic.state()
(function () {
  'use strict';
  const MIC_MAX_SEC = 60;
  const MIC_MAX_BYTES = 6 * 1024 * 1024;
  const MIC_MIMES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (const m of MIC_MIMES) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  const clock = sec => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
  function errText(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return '마이크 사용이 허용되지 않았습니다. 브라우저(또는 기기) 설정에서 이 사이트의 마이크를 허용하면 음성으로 설명할 수 있어요. 글로 입력해도 됩니다.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return '사용할 수 있는 마이크를 찾지 못했습니다. 글로 입력해 주세요.';
    if (n === 'NotReadableError') return '마이크를 사용할 수 없습니다. 다른 앱이 마이크를 쓰고 있지 않은지 확인해 주세요.';
    return '마이크를 켜지 못했습니다. 잠시 후 다시 시도하거나 글로 입력해 주세요.';
  }
  // 서버 응답 상태 → 문구(개념학습 micHttpText 와 같은 방식). 429·422 등은 서버 문구를 그대로 쓴다
  function httpText(r) {
    if (r.status === 413) return '녹음 파일이 너무 큽니다. 더 짧게 말해 주세요.';
    if (r.status === 415) return '이 기기의 녹음 형식은 지원되지 않습니다. 글로 입력해 주세요.';
    if (r.status === 502) return '음성 변환 또는 평가 서비스에 문제가 있었습니다. 잠시 후 다시 시도하거나 글로 입력해 주세요.';
    return (r.body && r.body.error) || '음성을 처리하지 못했습니다. 글로 입력해 주세요.';
  }

  function create(h) {
    const M = { state: 'idle', rec: null, stream: null, chunks: [], t0: 0, timer: null, mime: '' };
    const setState = s => { M.state = s; if (h.onState) h.onState(s); };
    const release = () => { if (M.stream) { try { M.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* 무시 */ } } M.stream = null; };

    async function toggle() {
      if (M.state === 'recording') { stop(); return; }
      if (M.state !== 'idle') return;
      if (!supported()) { if (h.onError) h.onError('이 브라우저는 음성 입력을 지원하지 않습니다. 글로 입력해 주세요.'); return; }
      setState('stopping');                                  // 권한 창이 떠 있는 동안 중복 시작 방지
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { setState('idle'); if (h.onError) h.onError(errText(e)); return; }
      const mime = pickMime();
      let rec;
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(t => t.stop()); setState('idle'); if (h.onError) h.onError('이 기기에서는 녹음을 시작할 수 없습니다. 글로 입력해 주세요.'); return; }
      Object.assign(M, { stream, rec, chunks: [], mime: rec.mimeType || mime || '', t0: Date.now() });
      rec.ondataavailable = ev => { if (ev.data && ev.data.size) M.chunks.push(ev.data); };
      rec.onstop = () => stopped();
      rec.onerror = () => stop();
      stream.getAudioTracks().forEach(t => { t.onended = () => stop(); });
      rec.start(1000);
      setState('recording');
      M.timer = setInterval(() => {
        const sec = (Date.now() - M.t0) / 1000;
        if (h.onTick) h.onTick(sec, MIC_MAX_SEC);
        if (sec >= MIC_MAX_SEC) stop();                      // 60초에서 자동 종료
      }, 250);
      if (h.onTick) h.onTick(0, MIC_MAX_SEC);
    }
    function stop() {
      if (M.state !== 'recording') return;
      clearInterval(M.timer); M.timer = null;
      setState('stopping');
      try { M.rec.stop(); } catch (e) { stopped(); }
    }
    // 화면을 떠나거나 닫을 때: 녹음을 버린다(업로드하지 않음)
    function cancel() {
      if (M.state !== 'recording') return;
      clearInterval(M.timer); M.timer = null;
      setState('cancelled');
      try { M.rec.stop(); } catch (e) { stopped(); }
    }
    function stopped() {
      clearInterval(M.timer); M.timer = null;
      const seconds = Math.min(MIC_MAX_SEC, Math.round((Date.now() - M.t0) / 1000));
      const chunks = M.chunks;
      const mime = (chunks[0] && chunks[0].type) || M.mime || 'audio/webm';
      const cancelled = M.state === 'cancelled';
      release(); M.chunks = []; M.rec = null;
      if (cancelled) { setState('idle'); return; }
      if (!chunks.length) { setState('idle'); if (h.onError) h.onError('녹음된 소리가 없습니다. 다시 시도해 주세요.'); return; }
      const blob = new Blob(chunks, { type: mime });
      if (blob.size > MIC_MAX_BYTES) { setState('idle'); if (h.onError) h.onError('녹음 파일이 너무 큽니다. 더 짧게 말해 주세요.'); return; }
      setState('idle');
      if (h.onAudio) h.onAudio(blob, seconds);               // 호출한 쪽이 서버로 보낸다(오디오는 여기서 더 들고 있지 않음)
    }
    return { toggle, stop, cancel, state: () => M.state };
  }

  window.CmapMic = { create, clock, httpText, errText, MAX_SEC: MIC_MAX_SEC };
})();
