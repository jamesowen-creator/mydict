// 작업402: Speak Loop 녹음(내 소리) — 원음과 번갈아 듣기 전용. 녹음은 이 기기 메모리(Blob URL)에만 있고 서버·저장소로 보내지 않는다(fetch·XHR·sendBeacon·localStorage·IndexedDB 사용 없음).
// 개념 지도의 micRecorder.js 는 서버 전송용이라 읽기만 하고 공유하지 않는다. 클래식 스크립트(window.SLRec).
(function (root) {
  'use strict';
  const MAX_SEC = 30;
  const MIMES = ['audio/webm;codecs=opus', 'audio/mp4'];   // 그 밖에는 브라우저 기본 형식
  const UNAVAILABLE = '마이크를 사용할 수 없습니다. 브라우저 설정에서 마이크 권한을 확인하세요.';

  const M = { state: 'idle', key: null, stream: null, rec: null, chunks: [], t0: 0, tick: null, max: null, abort: false, mime: '' };
  const clips = new Map();     // 클립 키 → Blob URL (키마다 마지막 1개)
  const subs = new Set();

  const supported = () => !!(root.isSecureContext !== false && root.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && root.MediaRecorder);
  function pickMime() {
    if (!root.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (const m of MIMES) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  function emit(ev) { subs.forEach(f => { try { f(ev); } catch (e) { /* 화면이 사라진 구독은 무시 */ } }); }
  function subscribe(f) { subs.add(f); return () => subs.delete(f); }
  function releaseStream() {
    if (M.stream) { try { M.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* 무시 */ } }   // 마이크 사용 표시를 끈다
    M.stream = null;
  }
  function clearTimers() { clearInterval(M.tick); clearTimeout(M.max); M.tick = null; M.max = null; }

  async function start(key) {
    if (M.state !== 'idle') return false;
    if (!supported()) { emit({ type: 'error', text: UNAVAILABLE }); return false; }
    M.state = 'starting'; M.abort = false; M.key = key; emit({ type: 'state' });
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }   // 권한 요청은 처음 [녹음]을 누를 때만
    catch (e) { M.state = 'idle'; M.key = null; emit({ type: 'error', text: UNAVAILABLE }); return false; }
    if (M.abort) { stream.getTracks().forEach(t => t.stop()); M.state = 'idle'; M.key = null; emit({ type: 'state' }); return false; }
    const mime = pickMime();
    let rec;
    try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch (e) { stream.getTracks().forEach(t => t.stop()); M.state = 'idle'; M.key = null; emit({ type: 'error', text: UNAVAILABLE }); return false; }
    Object.assign(M, { stream, rec, chunks: [], mime: rec.mimeType || mime || '', t0: Date.now(), state: 'recording' });
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) M.chunks.push(ev.data); };
    rec.onstop = () => finish();
    rec.onerror = () => stop();
    rec.start();
    M.tick = setInterval(() => emit({ type: 'tick', sec: (Date.now() - M.t0) / 1000 }), 250);
    M.max = setTimeout(stop, MAX_SEC * 1000);   // 최대 30초에서 자동 정지
    emit({ type: 'state' });
    return true;
  }
  // 정지: 그때까지 녹음분은 보관한다. 권한 창이 떠 있는 중이면 곧 닫는다
  function stop() {
    if (M.state === 'starting') { M.abort = true; return; }
    if (M.state !== 'recording') return;
    clearTimers();
    M.state = 'stopping'; emit({ type: 'state' });
    try { M.rec.stop(); } catch (e) { finish(); }
  }
  function finish() {
    clearTimers();
    const key = M.key, chunks = M.chunks, type = (chunks[0] && chunks[0].type) || M.mime || 'audio/webm';
    releaseStream();
    Object.assign(M, { state: 'idle', key: null, rec: null, chunks: [] });
    if (chunks.length) {
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      if (clips.has(key)) URL.revokeObjectURL(clips.get(key));   // 같은 키 재녹음은 이전 것을 버린다
      clips.set(key, url);
    }
    emit({ type: 'state' });
  }
  function releaseAll() {
    stop();
    clips.forEach(u => URL.revokeObjectURL(u)); clips.clear();
  }
  const get = key => clips.get(key) || null;
  const recording = () => (M.state === 'recording' || M.state === 'starting' ? M.key : null);

  const clock = sec => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

  // 녹음 영역: [녹음/정지] [내 소리] [원음] [번갈아 듣기]. SL = app.js 가 내보낸 도구, key = 클립 키(원음도 같은 키)
  function panel(SL, key) {
    const { P, el, btn } = SL;
    const box = el('div', 'rec');
    const row = el('div', 'rec-row');
    const msg = el('p', 'msg', ''); msg.setAttribute('role', 'status');
    const say = t => { msg.textContent = t || ''; };
    const rb = btn('녹음', 'btn', onRecord); rb.dataset.act = 'record';
    const mine = btn('내 소리', 'btn text', onMine); mine.dataset.act = 'mine';
    const orig = P.has(key) ? btn('원음', 'btn text', onOrig) : el('span', 'noaudio', '원음: ' + SL.NO_AUDIO);
    orig.dataset && (orig.dataset.act = 'orig');
    const alt = btn('번갈아 듣기', 'btn text', onAlt); alt.dataset.act = 'alt';
    [rb, mine, orig, alt].forEach(n => row.appendChild(n));
    box.appendChild(row); box.appendChild(msg);
    box.appendChild(el('p', 'rec-note', '녹음은 이 기기에서만 재생되며 저장되거나 전송되지 않습니다.'));

    let playing = null, tok = 0;   // playing: 'mine' | 'orig' | 'alt'
    const mark = (btnEl, on) => { if (btnEl && btnEl.classList) btnEl.classList.toggle('playing', on); };
    const clearMarks = () => { [mine, orig, alt].forEach(b => mark(b, false)); playing = null; };
    function paintRec(sec) {
      const rk = recording();
      const mineRec = rk === key;
      rb.textContent = M.state === 'recording' && mineRec ? '정지 ' + clock(sec || 0) : '녹음';
      rb.classList.toggle('playing', mineRec);
      rb.setAttribute('aria-pressed', String(mineRec));
    }
    paintRec(M.state === 'recording' ? (Date.now() - M.t0) / 1000 : 0);
    const unsub = subscribe(ev => {
      if (!box.isConnected) { unsub(); return; }
      if (ev.type === 'error') say(ev.text);
      else if (ev.type === 'tick') paintRec(ev.sec);
      else { paintRec((Date.now() - M.t0) / 1000); if (M.key !== key && M.state === 'idle') say(''); }
    });

    async function onRecord() {
      if (recording() === key) { stop(); return; }
      SL.stopAll();                    // 재생 중인 음성·쌓아가기를 멈추고 다른 녹음도 정지
      clearMarks(); say('');
      await start(key);
    }
    async function playMine(g) { return P.playUrl(get(key), 1, g); }   // 내 소리는 항상 원래 속도
    function run(kind, fn) {
      if (playing === kind) { SL.stopAll(); clearMarks(); return; }   // 다시 누르면 즉시 중지
      stop();
      const g = SL.begin(); SL.setBusy(true);
      clearMarks(); playing = kind; say('');
      const mine_ = ++tok;
      return Promise.resolve(fn(g)).then(() => { if (P.alive(g)) SL.setBusy(false); if (tok === mine_) clearMarks(); });
    }
    function onMine() {
      if (!get(key)) { say('먼저 녹음하세요'); return; }
      return run('mine', async g => { mark(mine, true); await playMine(g); });
    }
    function onOrig() { return run('orig', async g => { mark(orig, true); await P.play(key, g); }); }
    function onAlt() {
      if (!get(key)) { say('먼저 녹음하세요'); return; }
      if (!P.has(key)) { say(SL.NO_AUDIO); return; }
      return run('alt', async g => {
        mark(alt, true); mark(orig, true);
        if (!(await P.play(key, g))) return;
        mark(orig, false); mark(mine, true);
        if (!(await P.wait(0.5, g))) return;
        await playMine(g);
      });
    }
    return box;
  }

  root.SLRec = { MAX_SEC, MIMES, UNAVAILABLE, supported, start, stop, get, recording, releaseAll, subscribe, panel, _state: M };
  root.addEventListener && root.addEventListener('pagehide', releaseAll);
})(typeof self !== 'undefined' ? self : this);
