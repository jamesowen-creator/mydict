// 작업278-1: 개념 지도 퀴즈 탭의 "말로 설명하기"(280-1: 최근 부족 목록은 오답노트 탭) — 표시한 개념 중 저장된 설명이 있는 개념의 이름만 보여 주고, 사용자가 음성(또는 직접 입력)으로 설명하면 서버가 전사 → AI(Haiku) 평가를 한다.
// 클래식 스크립트(window.CmapAnswer). concept_map.html 의 인라인 전역($, h, api, okStatus, errText, getToken, autoGrow/growAll)과 window.CmapMap(mapView.js)·window.CmapMic(micRecorder.js)을 호출 시점에 사용한다.
// - 질문 문장 없음: 개념 이름만 제시. 전사 확인 단계 없음: 녹음을 끝내면 바로 서버로 보내 평가한다.
// - 녹음 원문(전사)·입력 원문은 화면에 보여 주지 않고 저장하지 않는다. 서버가 돌려주는 값은 AI 가 정리한 요약(summary)·판정·피드백뿐이다. 오디오는 서버 전송 직후 버린다.
// - [표시 해제]는 판정이 '충분'일 때만 보이고, 사용자가 직접 눌러야 해제된다(자동 해제 없음). 최근 부족 목록은 읽기 형태로 보여 주기만 하며 다시 출제하는 버튼은 없다.
(function () {
  'use strict';
  const A = { targets: null, recent: null, run: null, seq: 0, mic: null };   // run: { list, i, view: 'ready'|'text'|'working'|'result', result, msg, recording, sec }
  const VERDICT_ICON = {
    '충분': '<polyline points="5 12 10 17 19 7"/>',
    '부분적': '<line x1="6" y1="12" x2="18" y2="12"/>',
    '부족': '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  };
  const VERDICT_CLASS = { '충분': 'v-ok', '부분적': 'v-part', '부족': 'v-low' };
  const icon = (paths, cls) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls || 'ic'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = paths; return s; };   // 상수 문자열만 사용
  const MIC_PATH = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/>';
  const STOP_PATH = '<rect x="6" y="6" width="12" height="12"/>';
  const mapId = () => window.CmapMap.mapId();
  const inReview = () => window.CmapMap._state().mode === 'review';

  // ── 데이터: 말로 설명하기 대상(서버 계산), 최근 부족 목록 ──
  async function refresh() {
    const id = mapId();
    if (!id) return;
    const seq = ++A.seq;
    const [t, r] = await Promise.all([api('GET', '/api/cmap/maps/' + id + '/answer-targets'), api('GET', '/api/cmap/answers/recent')]);
    if (seq !== A.seq) return;
    A.targets = okStatus(t) ? t.body : null;
    A.recent = okStatus(r) ? r.body.items : [];
    renderRecent();
    if (!A.run) renderEntry();
  }

  // ── 퀴즈 탭 안의 진입 영역(reviewView 가 #answer-entry 를 만들어 두고 호출) ──
  function renderEntry() {
    const box = $('answer-entry');
    if (!box) return;
    box.textContent = '';
    const t = A.targets, n = t ? t.targets.length : 0;
    box.append(h('div', { class: 'narr-actions', style: 'justify-content:flex-start;margin-top:0;align-items:center' },
      h('button', { class: 'btn', type: 'button', id: 'answer-start', disabled: !t || n === 0, onclick: startRun, text: '말로 설명하기' }),
      h('span', { class: 'hint', id: 'answer-count', style: 'margin-top:0', text: t ? '대상 ' + n + '개' : '' })));
    if (t && n === 0) box.append(h('p', { class: 'hint', id: 'answer-hint', text: t.marked_count === 0 ? '지도에서 모르는 개념을 눌러 표시해 보세요' : '설명이 있는 표시 개념이 없어요. 개념에 설명을 저장해 주세요.' }));
  }
  // ── 오답노트 탭 안의 최근 부족 목록(280-1: 퀴즈 탭 진입 영역에서 옮김. 읽기 형태로 보여 주기만 한다) ──
  function renderRecent() {
    const box = $('wrong-recent');
    if (!box) return;
    box.textContent = '';
    const has = !!(A.recent && A.recent.length);
    if ($('wrong-recent-empty')) $('wrong-recent-empty').hidden = has || A.recent === null;
    if (!has) return;
    box.append(h('p', { class: 'sec-label', id: 'answer-recent-label', text: '최근 부족하다고 평가된 개념 ' + A.recent.length + '개' }));
    box.append(h('ul', { class: 'answer-recent', id: 'answer-recent' }, A.recent.map(it => h('li', { 'data-id': it.concept_id },
      h('p', { class: 'ar-head' }, h('span', { class: 'ar-term', text: it.term }), h('span', { class: 'ar-verdict ' + VERDICT_CLASS[it.verdict], text: it.verdict })),
      it.gaps && it.gaps.length ? h('ul', { class: 'ar-gaps' }, it.gaps.map(g => h('li', { text: g }))) : null,
      it.supplement ? h('p', { class: 'ar-sup', text: it.supplement }) : null))));
  }
  // 대상은 개념 단위(표시·설명)라 지도 저장 여부와 무관하다

  // ── 진행 ──
  function showPanel(on) {
    $('answer-panel').hidden = !on;
    $('review-panel').hidden = on;
  }
  function ensureMic() {
    if (A.mic) return A.mic;
    A.mic = window.CmapMic.create({
      onState: s => { if (A.run) { A.run.recording = s === 'recording'; if (s !== 'recording') A.run.sec = 0; if (A.run.view !== 'working') renderRun(); } },
      onTick: (sec, max) => { if (!A.run) return; A.run.sec = sec; const el = $('answer-clock'); if (el) el.textContent = window.CmapMic.clock(sec) + ' / ' + window.CmapMic.clock(max); },
      onError: text => { if (A.run) { A.run.msg = { kind: 'error', text }; renderRun(); } },
      onAudio: (blob, seconds) => sendVoice(blob, seconds),
    });
    return A.mic;
  }
  async function startRun() {
    const id = mapId();
    if (!id) return;
    const r = await api('GET', '/api/cmap/maps/' + id + '/answer-targets');
    if (!okStatus(r) || !r.body.targets.length) { A.targets = okStatus(r) ? r.body : A.targets; renderEntry(); return; }
    A.run = { list: r.body.targets, i: 0, view: 'ready', result: null, msg: null, recording: false, sec: 0, busy: false };
    showPanel(true);
    renderRun();
  }
  function endRun() {
    if (A.mic) A.mic.cancel();
    A.run = null;
    showPanel(false);
    refresh();                                              // 결과가 쌓였으므로 최근 부족 목록·대상 개수를 갱신
  }
  // 280-1: 탭을 옮길 때 잃는 것이 있으면 안내 문구(녹음 중·평가 중), 없으면 null / 퀴즈 화면을 떠나면 진행을 끝낸다
  function busyText() {
    if (!A.run) return null;
    if (A.run.recording) return '녹음 중입니다. 이동하면 녹음이 취소됩니다.';
    if (A.run.view === 'working') return '평가 중입니다. 이동하면 결과를 받지 못할 수 있어요.';
    return null;
  }
  function stop() { if (A.run) endRun(); }
  const cur = () => A.run.list[A.run.i];
  function setView(v) { A.run.view = v; A.run.msg = null; A.run.result = v === 'result' ? A.run.result : null; renderRun(); }

  function resultOk(r) { return r.status === 201 && r.body && r.body.ok !== false; }
  function failText(r) {
    if (r.body && r.body.no_explanation) return '이 개념에는 저장된 설명이 없어 평가할 수 없어요.';
    return window.CmapMic.httpText(r);
  }
  async function sendVoice(blob, seconds) {
    const run = A.run;
    if (!run) return;
    run.view = 'working'; run.msg = null; renderRun();
    let r;
    try {
      const resp = await fetch('/api/cmap/concepts/' + cur().id + '/answer/voice', { method: 'POST', headers: { Authorization: 'Bearer ' + (getToken() || ''), 'Content-Type': blob.type, 'X-Audio-Seconds': String(seconds) }, body: blob });
      let body = null; try { body = await resp.json(); } catch (e) { /* 본문 없음 */ }
      r = { status: resp.status, body };
    } catch (e) { r = { status: 0, body: { error: '네트워크에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }; }
    finish(run, r);
  }
  async function sendText() {
    const run = A.run, ta = $('answer-text');
    if (!run || !ta) return;
    const text = ta.value.trim();
    if (!text) { run.msg = { kind: 'error', text: '설명을 입력해 주세요.' }; renderRun(); return; }
    run.view = 'working'; run.msg = null; renderRun();
    const r = await api('POST', '/api/cmap/concepts/' + cur().id + '/answer/text', { text });
    finish(run, r);
  }
  function finish(run, r) {
    if (A.run !== run) return;                              // 그만뒀거나 화면을 떠났으면 결과를 버린다
    if (resultOk(r)) { run.result = r.body; run.view = 'result'; run.msg = null; }
    else { run.view = run.lastView || 'ready'; run.msg = { kind: 'error', text: r.status === 422 || r.status === 429 || r.status === 400 ? ((r.body && r.body.error) || failText(r)) : failText(r) }; }
    renderRun();
  }

  async function unmark() {
    const run = A.run, btn = $('answer-unmark');
    if (!run || !btn) return;
    btn.disabled = true;
    const ok = await window.CmapMap.unmarkConcept(cur().id);
    if (A.run !== run) return;
    run.unmarked = ok ? true : false;
    run.msg = ok ? null : { kind: 'error', text: '표시를 해제하지 못했어요. 다시 시도해 주세요.' };
    renderRun();
  }
  function next() {
    if (A.run.i + 1 >= A.run.list.length) { endRun(); return; }
    A.run.i++; A.run.view = 'ready'; A.run.result = null; A.run.msg = null; A.run.unmarked = false;
    renderRun();
  }
  function again() { A.run.view = 'ready'; A.run.result = null; A.run.msg = null; A.run.unmarked = false; renderRun(); }

  function renderRun() {
    const run = A.run, box = $('answer-panel');
    if (!run) return;
    box.textContent = '';
    const c = cur(), n = run.list.length;
    box.append(h('p', { class: 'sec-label', text: '말로 설명하기' }));
    box.append(h('p', { class: 'hint', id: 'answer-progress', text: (run.i + 1) + ' / ' + n }));
    box.append(h('p', { class: 'answer-term', id: 'answer-term', text: c.term }));
    if (run.view === 'result') { renderResult(box, run); return; }
    if (run.view === 'working') { box.append(h('p', { class: 'narr-loading', id: 'answer-working', role: 'status', text: '평가 중…' })); return; }
    box.append(h('p', { class: 'hint', text: '이 개념을 자기 말로 설명해 보세요.' }));
    if (run.msg) box.append(h('p', { class: 'msg', id: 'answer-msg', role: 'alert', text: run.msg.text }));
    if (run.view === 'text') {
      const ta = h('textarea', { id: 'answer-text', maxlength: 1000, 'aria-label': c.term + ' 설명', placeholder: '이 개념을 설명해 보세요' });
      box.append(h('div', { class: 'field' }, ta));
      box.append(h('div', { class: 'narr-actions' },
        h('button', { class: 'btn text', type: 'button', id: 'answer-to-voice', onclick: () => { run.lastView = 'ready'; setView('ready'); }, text: '녹음으로 답하기' }),
        h('button', { class: 'btn text', type: 'button', id: 'answer-quit', onclick: endRun, text: '그만두기' }),
        h('button', { class: 'btn', type: 'button', id: 'answer-submit', onclick: () => { run.lastView = 'text'; sendText(); }, text: '평가 받기' })));
      growAll(box); ta.focus();
      return;
    }
    // ready: 마이크
    const rec = run.recording;
    const mic = h('button', { class: 'mic-btn', type: 'button', id: 'answer-mic', 'aria-pressed': String(rec), 'aria-label': rec ? '녹음 끝내기' : '녹음 시작', onclick: () => { run.lastView = 'ready'; ensureMic().toggle(); } });
    mic.append(icon(rec ? STOP_PATH : MIC_PATH, 'ic mic-ic'));
    box.append(h('div', { class: 'answer-mic-row' }, mic,
      h('span', { class: 'hint', id: 'answer-clock', role: 'status', style: 'margin-top:0', text: rec ? window.CmapMic.clock(run.sec) + ' / ' + window.CmapMic.clock(window.CmapMic.MAX_SEC) : '버튼을 눌러 말하고, 다 말하면 다시 눌러 끝내세요.' })));
    box.append(h('div', { class: 'narr-actions' },
      h('button', { class: 'btn text', type: 'button', id: 'answer-to-text', disabled: rec, onclick: () => { run.lastView = 'text'; setView('text'); }, text: '직접 입력으로 답하기' }),
      h('button', { class: 'btn text', type: 'button', id: 'answer-quit', onclick: endRun, text: '그만두기' })));
  }

  function renderResult(box, run) {
    const r = run.result, last = run.i + 1 >= run.list.length;
    box.append(h('p', { class: 'sec-label narr-sec', text: 'AI 평가 · 확인 필요' }));
    box.append(h('p', { class: 'answer-verdict ' + VERDICT_CLASS[r.verdict], id: 'answer-verdict' }, icon(VERDICT_ICON[r.verdict], 'ic'), h('span', { text: r.verdict })));
    box.append(h('p', { class: 'sec-label narr-sec', text: '내가 말한 내용(요약)' }));
    box.append(h('p', { class: 'answer-text', id: 'answer-summary', text: r.summary }));
    if (r.strengths && r.strengths.length) {
      box.append(h('p', { class: 'sec-label narr-sec', text: '잘 말한 점' }));
      box.append(h('ul', { class: 'narr-mnemonic', id: 'answer-strengths' }, r.strengths.map(x => h('li', { text: x }))));
    }
    if (r.gaps && r.gaps.length) {
      box.append(h('p', { class: 'sec-label narr-sec', text: '부족한 점' }));
      box.append(h('ul', { class: 'narr-mnemonic', id: 'answer-gaps' }, r.gaps.map(x => h('li', { text: x }))));
    }
    if (r.supplement) {
      box.append(h('p', { class: 'sec-label narr-sec', text: '보완' }));
      box.append(h('p', { class: 'answer-text', id: 'answer-supplement', text: r.supplement }));
    }
    if (run.msg) box.append(h('p', { class: 'msg', id: 'answer-msg', role: 'alert', text: run.msg.text }));
    box.append(h('div', { class: 'narr-actions' },
      h('button', { class: 'btn text', type: 'button', id: 'answer-retry', onclick: again, text: '다시 말해 보기' }),
      r.verdict === '충분' ? h('button', { class: 'btn text', type: 'button', id: 'answer-unmark', disabled: !!run.unmarked, onclick: unmark, text: run.unmarked ? '해제됨' : '표시 해제' }) : null,
      h('button', { class: 'btn text', type: 'button', id: 'answer-close', onclick: endRun, text: '닫기' }),
      h('button', { class: 'btn', type: 'button', id: 'answer-next', onclick: next, text: last ? '마치기' : '다음 개념' })));
  }

  function init() {
    const M = window.CmapMap;
    M.on('mode', mode => { if (mode === 'review') refresh(); else if (A.run) endRun(); });   // 다른 탭으로 가면 녹음을 버리고 진행을 끝낸다
    M.on('open', () => { A.targets = null; A.recent = null; A.run = null; renderRecent(); if ($('answer-panel')) { $('answer-panel').hidden = true; } });
    M.on('close', () => { if (A.mic) A.mic.cancel(); A.run = null; });
    M.on('sheetclose', () => { if (M._state().mode === 'review' && !A.run) refresh(); });
    window.addEventListener('hashchange', () => { if (A.mic) A.mic.cancel(); });
    window.addEventListener('pagehide', () => { if (A.mic) A.mic.cancel(); });
  }
  window.CmapAnswer = { init, renderEntry, renderRecent, refresh, busyText, stop, _state: () => ({ run: A.run ? { i: A.run.i, view: A.run.view, n: A.run.list.length } : null, targets: A.targets && A.targets.targets.length, recent: A.recent && A.recent.length }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
