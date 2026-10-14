// 작업273-5: 개념 지도 화면의 "복습" 탭(저장된 지도 + 최신 AI 해설을 읽기 전용으로 다시 보기)과 "연결 퀴즈"(AI 없음).
// 클래식 스크립트(window.CmapReview). concept_map.html 의 인라인 전역($, h, api, okStatus, errText, openDlg, closeDlg)과 window.CmapMap(mapView.js)의 공개 함수를 호출 시점에 사용한다.
// - 복습: 해설은 273-4 의 구조(summary / story / mnemonic / suggestions)를 그대로 보여 주기만 한다(만들기·찾아보기 버튼 없음). 단락을 누르면 지도에서 개념이 강조된다.
// - 퀴즈: 시작하면 서버가 노드 목록만 준다(정답 간선 없음). 화면이 노드를 흩어 놓고, 사용자는 두 노드를 차례로 눌러(CmapPairPicker) 이은 뒤 종류를 고른다. 제출하면 서버가 저장된 지도로 채점한다.
//   점수 3종(연결 찾기·관계 종류·방향)은 따로 보여 주고, 지도에 없는 연결은 "지도에 없는 연결"로 따로 표시하며 감점하지 않는다.
(function () {
  'use strict';
  const Rv = { data: null, loaded: false, seq: 0, msg: '', quiz: null, minfo: null, fallback: false };   // minfo = 표시한 개념 퀴즈 안내 정보(서버 계산)

  const status = () => window.CmapMap.status();
  const isSaved = () => { const s = status(); return !!s && s.save_status === 'saved'; };
  const nar = () => (Rv.data && Rv.data.narration) || null;
  const isStale = () => !!(nar() && status() && nar().source_hash !== status().current_hash);
  const termOf = id => { const c = Rv.data && Rv.data.concepts && Rv.data.concepts.find(x => x.id === id); return c ? c.term : '?'; };
  const quizTerm = id => { const n = Rv.quiz && Rv.quiz.nodes.find(x => x.id === id); return n ? n.term : '?'; };
  const pct = s => (s.total === 0 ? '해당 없음' : s.hit + '/' + s.total + ' (' + Math.round(s.ratio * 100) + '%)');

  function reset() { Rv.seq++; Rv.data = null; Rv.loaded = false; Rv.msg = ''; Rv.quiz = null; Rv.minfo = null; Rv.fallback = false; window.CmapMap.quizEnd(); window.CmapMap.highlight([]); }

  async function load() {
    const id = window.CmapMap.mapId();
    if (!id) return;
    const seq = ++Rv.seq;
    const r = await api('GET', '/api/cmap/maps/' + id + '/narration');
    if (seq !== Rv.seq) return;
    if (okStatus(r)) Rv.data = r.body; else Rv.msg = errText(r, '해설을 불러오지 못했습니다.');
    Rv.loaded = true;
    renderReview();
    loadInfo();
  }
  // 275-5: 표시한 개념 수·연결 없는 표시 개념·출제 가능 여부(서버가 DB 의 표시와 지도로 계산)
  async function loadInfo() {
    const id = window.CmapMap.mapId();
    if (!id) return;
    const r = await api('GET', '/api/cmap/maps/' + id + '/quiz/marked-info');
    if (id !== window.CmapMap.mapId()) return;
    Rv.minfo = okStatus(r) ? r.body : null;
    if (Rv.loaded && window.CmapMap._state().mode === 'review') renderReview();
  }

  // ── 복습 ──
  let para = null;
  function showPara(i) {                                  // 274-4: [지도에서 보기] → 읽기 전용 시트가 열리고 그 단락의 개념이 강조된다
    const p = nar() && nar().content.story[i];
    if (!p) return;
    para = i;
    window.CmapMap.showOnMap(p.concept_ids);
    renderReview();
  }
  function renderReview() {
    const box = $('review-panel');
    box.textContent = '';
    if (!Rv.loaded) { box.append(h('p', { class: 'hint', text: '불러오는 중…' })); return; }
    const saved = isSaved(), edges = window.CmapMap.edgeCount();
    // 퀴즈 시작
    const canQuiz = saved && edges > 0;
    box.append(h('div', { class: 'narr-actions', style: 'justify-content:flex-start;margin-top:0' },
      h('button', { class: 'btn text', type: 'button', id: 'review-open-map', onclick: () => window.CmapMap.showOnMap([]), text: '지도 열기' }),
      h('button', { class: 'btn', type: 'button', id: 'quiz-start', disabled: !canQuiz, onclick: startQuiz, text: '연결 퀴즈 시작' })));
    const mi = Rv.minfo, nMarked = mi ? mi.marked.length : 0;
    box.append(h('div', { class: 'narr-actions', style: 'justify-content:flex-start;margin-top:0;align-items:center' },
      h('button', { class: 'btn text', type: 'button', id: 'quiz-start-marked', disabled: !saved || !mi || nMarked === 0, onclick: () => startQuiz('marked'), text: '표시한 개념 퀴즈' }),
      h('span', { class: 'hint', id: 'quiz-marked-count', style: 'margin-top:0', text: mi ? '표시한 개념 ' + nMarked + '개' : '' })));
    if (mi && nMarked === 0) box.append(h('p', { class: 'hint', id: 'quiz-marked-hint', text: '지도에서 모르는 개념을 눌러 표시해 보세요' }));
    if (mi && mi.isolated.length) box.append(h('p', { class: 'hint', id: 'quiz-marked-isolated', text: '연결이 없어 출제할 수 없음: ' + mi.isolated.map(x => x.term).join(', ') }));
    box.append(h('p', { class: 'hint', id: 'quiz-start-note', text: !saved ? '저장된 지도에서만 퀴즈를 풀 수 있어요. 지도 탭에서 [저장]을 눌러 주세요.' : edges === 0 ? '연결이 있는 지도에서만 퀴즈를 풀 수 있어요.' : '지도의 노드만 보여 줍니다. 두 노드를 차례로 눌러 연결을 떠올려 보세요.' }));
    if (Rv.msg) box.append(h('p', { class: 'msg', id: 'review-msg', role: 'alert', text: Rv.msg }));
    if (Rv.fallback) box.append(h('div', { class: 'narr-actions', style: 'justify-content:flex-start;margin-top:0' }, h('button', { class: 'btn text', type: 'button', id: 'quiz-start-all-fallback', onclick: () => startQuiz('all'), text: '전체 퀴즈로 풀기' })));
    if (saved === false && status() && status().save_status === 'changed') box.append(h('p', { class: 'hint', text: '지도가 저장한 뒤에 바뀌었어요. 위 지도는 지금 상태입니다.' }));
    // 최신 해설(읽기 전용)
    if (!nar()) { box.append(h('p', { class: 'hint', id: 'review-no-narr', text: '아직 만든 해설이 없어요. 해설 탭에서 만들 수 있어요.' })); return; }
    const c = nar().content;
    if (isStale()) box.append(h('div', { class: 'narr-stale', id: 'review-stale', role: 'status' }, h('p', { text: '지도가 바뀌었습니다. 아래 해설은 이전 지도를 기준으로 만든 것입니다.' })));
    box.append(h('p', { class: 'sec-label', text: 'AI 설명 · 확인 필요' }));
    box.append(h('p', { class: 'narr-summary', id: 'review-summary', text: c.summary }));
    c.story.forEach((p, i) => {
      box.append(h('div', { class: 'narr-para' + (para === i ? ' sel' : ''), 'data-para': i },
        h('span', { class: 'narr-text', text: p.text }),
        h('span', { class: 'narr-cap', text: '다루는 개념: ' + p.concept_ids.map(termOf).join(' · ') }),
        h('div', { class: 'narr-para-row' }, h('button', { class: 'btn text', type: 'button', 'data-act': 'show-map', onclick: () => showPara(i), text: '지도에서 보기' }))));
    });
    if (c.mnemonic && c.mnemonic.length) {
      box.append(h('p', { class: 'sec-label narr-sec', text: '기억용' }));
      box.append(h('ul', { class: 'narr-mnemonic', id: 'review-mnemonic' }, c.mnemonic.map(m => h('li', { text: m }))));
    }
    box.append(h('p', { class: 'sec-label narr-sec', text: 'AI가 제안하는 개념' }));
    if (!c.suggestions || !c.suggestions.length) box.append(h('p', { class: 'hint', text: '제안할 개념이 없어요.' }));
    else box.append(h('ul', { class: 'narr-sugs', id: 'review-sugs' }, c.suggestions.map(s => h('li', { class: 'narr-sug' },
      h('p', { class: 'narr-sug-term', text: s.term }), h('p', { class: 'narr-sug-reason', text: s.reason }),
      h('p', { class: 'narr-cap', text: '가까운 개념: ' + termOf(s.near_concept_id) + (s.saved ? ' · 이미 저장된 개념' : '') })))));
  }

  // ── 퀴즈 ──
  async function startQuiz(mode) {
    const id = window.CmapMap.mapId();
    if (!id) return;
    mode = mode === 'marked' ? 'marked' : 'all';
    Rv.msg = ''; Rv.fallback = false;
    const r = await api('POST', '/api/cmap/maps/' + id + '/quiz/start', mode === 'marked' ? { mode: 'marked' } : undefined);   // 전체 퀴즈는 기존 요청 그대로(본문 없음)
    if (!okStatus(r)) {
      Rv.msg = errText(r, '퀴즈를 시작하지 못했어요.');
      if (r.body && r.body.too_few) {                                        // 표시한 개념에 이어진 연결이 부족: 안내하고 전체 퀴즈를 권한다
        Rv.fallback = true;
        if (r.body.isolated && r.body.isolated.length) Rv.msg += ' 연결이 없어 출제할 수 없음: ' + r.body.isolated.map(x => x.term).join(', ');
      }
      renderReview(); loadInfo(); return;
    }
    Rv.quiz = { mode, scope_key: r.body.scope_key || null, source_hash: r.body.source_hash, nodes: r.body.nodes, answers: [], result: null, error: '', submitting: false, stale: false };
    para = null;
    window.CmapMap.highlight([]);
    window.CmapMap.quizBegin(r.body.nodes);
    window.CmapMap.quizSetAnswers([]);
    renderQuiz();
  }
  function syncAnswers() { window.CmapMap.quizSetAnswers(Rv.quiz.answers.map(a => ({ from: a.from, to: a.to, type: a.type }))); }
  let pending = null;
  function onQuizPair({ a, b }) {
    if (!Rv.quiz || Rv.quiz.result) return;
    const same = Rv.quiz.answers.find(x => (x.from === a && x.to === b) || (x.from === b && x.to === a));
    if (same) { Rv.quiz.error = '이미 이은 두 개념이에요. 아래 목록에서 삭제한 뒤 다시 이어 보세요.'; renderQuiz(); return; }
    Rv.quiz.error = '';
    pending = { a, b };
    $('quiz-pair').textContent = quizTerm(a) + ' → ' + quizTerm(b);
    $('quiz-type').value = '';
    renderQuiz();
    openDlg($('quiz-dlg'));
  }
  function removeAnswer(i) { Rv.quiz.answers.splice(i, 1); Rv.quiz.error = ''; syncAnswers(); renderQuiz(); }
  function quitQuiz(toMode, keepSheet) {
    Rv.quiz = null; pending = null;
    window.CmapMap.quizEnd();
    window.CmapMap.setMode(toMode || 'review');
    if (!keepSheet) window.CmapMap.closeSheet();                  // 퀴즈가 끝나면 시트를 닫는다([다시 풀기]는 시트를 그대로 둔 채 새 퀴즈)
  }
  async function submitQuiz() {
    const q = Rv.quiz, id = window.CmapMap.mapId();
    if (!q || q.submitting || q.result || !id) return;
    q.submitting = true; q.error = ''; renderQuiz();
    const body = { source_hash: q.source_hash, answers: q.answers.map(a => ({ from_concept_id: a.from, to_concept_id: a.to, relation_type: a.type })) };
    if (q.mode === 'marked') { body.mode = 'marked'; body.scope_key = q.scope_key; }
    const r = await api('POST', '/api/cmap/maps/' + id + '/quiz/submit', body);
    if (Rv.quiz !== q) return;
    q.submitting = false;
    if (okStatus(r)) q.result = r.body;
    else if (r.status === 409 && r.body && r.body.stale) q.stale = true, q.error = r.body.scope_changed ? '퀴즈를 푸는 동안 표시한 개념이 바뀌어 채점하지 않았어요. 다시 시작해 주세요.' : '퀴즈를 푸는 동안 지도가 바뀌어 채점하지 않았어요. 다시 시작해 주세요.';
    else q.error = errText(r, '채점하지 못했어요. 잠시 후 다시 시도해 주세요.');
    renderQuiz();
  }
  const line = (e, withLabel) => quizOrConcept(e.from_term, e.from_concept_id) + (e.relation_type === '구별' ? ' ↔ ' : ' → ') + quizOrConcept(e.to_term, e.to_concept_id) + (e.relation_type ? ' · ' + e.relation_type : '') + (withLabel && e.label ? ' · ' + e.label : '');
  const quizOrConcept = (term, id) => term || quizTerm(id);

  function renderQuiz() {
    const box = $('quiz-panel'), q = Rv.quiz;
    box.textContent = '';
    if (!q) return;
    if (q.result) { renderResult(box, q.result); return; }
    box.append(h('p', { class: 'sec-label', text: q.mode === 'marked' ? '표시한 개념 퀴즈' : '연결 퀴즈' }));
    box.append(h('p', { class: 'hint', id: 'quiz-hint', text: q.mode === 'marked' ? '물음표 배지가 붙은 개념이 모르는 개념으로 표시한 개념이에요. 그 개념과 이어진 연결을 두 개념을 차례로 눌러 추가해 보세요. 방향은 누른 순서(앞 → 뒤)예요.' : '두 개념을 차례로 눌러 서로 이어져 있다고 생각하는 연결을 추가해 보세요. 방향은 누른 순서(앞 → 뒤)예요.' }));
    if (q.error) box.append(h('p', { class: 'msg', id: 'quiz-error', role: 'alert', text: q.error }));
    box.append(h('p', { class: 'sec-label narr-sec', text: '내가 이은 연결 ' + q.answers.length + '개' }));
    box.append(h('ul', { class: 'quiz-answers', id: 'quiz-answers' }, q.answers.map((a, i) => h('li', { 'data-i': i },
      h('span', { text: quizTerm(a.from) + (a.type === '구별' ? ' ↔ ' : ' → ') + quizTerm(a.to) + (a.type ? ' · ' + a.type : ' · 종류 없음') }),
      h('button', { class: 'btn text', type: 'button', 'data-del': i, onclick: () => removeAnswer(i), text: '삭제' })))));
    box.append(h('div', { class: 'narr-actions' },
      h('button', { class: 'btn text', type: 'button', id: 'quiz-quit', onclick: () => quitQuiz('review'), text: '그만두기' }),
      q.stale ? h('button', { class: 'btn', type: 'button', id: 'quiz-restart', onclick: () => { const m = q.mode; quitQuiz('review', true); startQuiz(m); }, text: '다시 시작' })
        : h('button', { class: 'btn', type: 'button', id: 'quiz-submit', disabled: q.submitting || !q.answers.length, onclick: submitQuiz, text: q.submitting ? '채점 중…' : '제출' })));
  }
  function section(title, id, items, build, empty) {
    const out = [h('p', { class: 'sec-label narr-sec', text: title + ' ' + items.length + '개' })];
    out.push(items.length ? h('ul', { class: 'quiz-list', id }, items.map(build)) : h('p', { class: 'hint', text: empty }));
    return out;
  }
  function renderResult(box, r) {
    box.append(h('p', { class: 'sec-label', text: '결과' }));
    box.append(h('div', { class: 'quiz-scores', id: 'quiz-result' },
      h('div', { class: 'quiz-score', id: 'res-pair' }, h('b', { text: pct(r.scores.pair) }), h('span', { text: '연결 찾기' })),
      h('div', { class: 'quiz-score', id: 'res-type' }, h('b', { text: pct(r.scores.type) }), h('span', { text: '관계 종류' })),
      h('div', { class: 'quiz-score', id: 'res-direction' }, h('b', { text: pct(r.scores.direction) }), h('span', { text: '방향' }))));
    box.append(h('p', { class: 'hint', text: '세 점수는 따로 계산해요. 구별(방향 없음) 연결은 방향 점수에서 빠져요.' }));
    const why = { type: '관계 종류가 달라요', direction: '방향이 반대예요' };
    for (const part of [
      section('맞힌 연결', 'res-correct', r.correct, e => h('li', { text: line(e, true) }), '아직 없어요.'),
      section('이어졌지만 틀린 연결', 'res-wrong', r.wrong, w => h('li', { },
        '정답: ' + line(w.expected, true), h('span', { class: 'sub', text: '내 답: ' + line(w.answer, false) + ' — ' + w.problems.map(p => why[p]).join(', ') })), '없어요.'),
      section('못 찾은 연결', 'res-missed', r.missed, e => h('li', { text: line(e, true) }), '없어요.'),
      section('지도에 없는 연결', 'res-extras', r.extras, e => h('li', { text: line(e, false) }), '없어요.'),
    ]) for (const el of part) box.append(el);
    box.append(h('p', { class: 'hint', text: r.mode === 'marked' ? '표시한 개념과 이어진 연결만 채점해요. 그 밖의 연결은 추가 연결로만 보여 주고 틀린 것으로 세지 않아요.' : '지도에 없는 연결은 틀린 것으로 세지 않아요. 지도에 더할 만한 연결인지 생각해 보세요.' }));
    if (r.mode === 'marked') renderMastered(box, r.mastered || []);
    const again = Rv.quiz ? Rv.quiz.mode : 'all';
    box.append(h('div', { class: 'narr-actions' },
      h('button', { class: 'btn text', type: 'button', id: 'quiz-back', onclick: () => quitQuiz('review'), text: '복습으로 돌아가기' }),
      h('button', { class: 'btn', type: 'button', id: 'quiz-again', onclick: () => { quitQuiz('review', true); startQuiz(again); }, text: '다시 풀기' })));
  }

  // 표시한 개념 중 이어진 출제 연결을 모두 맞힌 개념: [표시 해제]는 사용자가 직접 누른다(제안만, 자동 해제 없음)
  function renderMastered(box, list) {
    box.append(h('p', { class: 'sec-label narr-sec', text: '모두 맞힌 표시 개념 ' + list.length + '개' }));
    if (!list.length) { box.append(h('p', { class: 'hint', id: 'res-mastered-empty', text: '아직 없어요.' })); return; }
    box.append(h('p', { class: 'hint', text: '이어진 연결을 모두 맞혔어요. 표시를 풀지는 직접 정해요(자동으로 해제되지 않아요).' }));
    box.append(h('ul', { class: 'quiz-answers', id: 'res-mastered' }, list.map(m => {
      const btn = h('button', { class: 'btn text', type: 'button', 'data-act': 'unmark', 'data-id': m.id, text: '표시 해제' });
      const li = h('li', { 'data-id': m.id }, h('span', { text: m.term }), btn);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const ok = await window.CmapMap.unmarkConcept(m.id);
        if (ok) { btn.textContent = '해제됨'; loadInfo(); } else { btn.disabled = false; btn.textContent = '다시 시도'; }
      });
      return li;
    })));
  }

  function init() {
    const M = window.CmapMap;
    $('tab-review').addEventListener('click', () => M.setMode('review'));
    $('quiz-cancel').addEventListener('click', () => { pending = null; closeDlg($('quiz-dlg')); });
    $('quiz-form').addEventListener('submit', ev => {
      ev.preventDefault();
      if (!pending || !Rv.quiz) { closeDlg($('quiz-dlg')); return; }
      Rv.quiz.answers.push({ from: pending.a, to: pending.b, type: $('quiz-type').value || null });
      pending = null;
      closeDlg($('quiz-dlg'));
      syncAnswers(); renderQuiz();
    });
    M.on('mode', mode => {
      if (mode === 'review') { renderReview(); load(); }
      else if (mode !== 'quiz') { if (Rv.quiz) { Rv.quiz = null; M.quizEnd(); } para = null; }
    });
    M.on('quizpair', onQuizPair);
    M.on('sheetclose', () => {                                    // 시트를 닫으면(닫기·ESC·뒤로 가기) 진행 중이던 퀴즈는 끝난다
      if (Rv.quiz) { Rv.quiz = null; pending = null; M.quizEnd(); M.setMode('review'); }
      if (M._state().mode === 'review') loadInfo();                  // 시트에서 표시를 바꿨을 수 있으므로 표시한 개념 수를 다시 가져온다
    });
    M.on('open', reset); M.on('close', reset);
    M.on('status', () => { if (Rv.loaded && $('map-view') && !$('map-view').hidden && M._state().mode === 'review') renderReview(); });
  }
  window.CmapReview = { init, _state: () => ({ quiz: Rv.quiz ? { answers: Rv.quiz.answers.length, result: !!Rv.quiz.result } : null }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
