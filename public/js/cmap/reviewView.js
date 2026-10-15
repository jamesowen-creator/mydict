// 작업273-5: 개념 지도 화면의 "연결 퀴즈"(AI 없음). 280-1: 퀴즈 탭(시작 카드 3개)과 오답노트(모르는 개념 표시 목록)의 화면 그리기도 맡는다.
// 클래식 스크립트(window.CmapReview). concept_map.html 의 인라인 전역($, h, api, okStatus, errText, openDlg, closeDlg)과 window.CmapMap(mapView.js)의 공개 함수를 호출 시점에 사용한다.
// - 퀴즈: 시작하면 서버가 노드 목록만 준다(정답 간선 없음). 화면이 노드를 흩어 놓고, 사용자는 두 노드를 차례로 눌러(CmapPairPicker) 이은 뒤 종류를 고른다. 제출하면 서버가 저장된 지도로 채점한다.
//   점수 3종(연결 찾기·관계 종류·방향)은 따로 보여 주고, 지도에 없는 연결은 "지도에 없는 연결"로 따로 표시하며 감점하지 않는다.
(function () {
  'use strict';
  const Rv = { saving: false, loaded: false, msg: '', quiz: null, minfo: null, fallback: false };   // minfo = 표시한 개념 퀴즈 안내 정보(서버 계산)

  const status = () => window.CmapMap.status();
  const isSaved = () => { const s = status(); return !!s && s.save_status === 'saved'; };
  const quizTerm = id => { const n = Rv.quiz && Rv.quiz.nodes.find(x => x.id === id); return n ? n.term : '?'; };
  const pct = s => (s.total === 0 ? '해당 없음' : s.hit + '/' + s.total + ' (' + Math.round(s.ratio * 100) + '%)');

  function reset() { Rv.saving = false; Rv.loaded = false; Rv.msg = ''; Rv.quiz = null; Rv.minfo = null; Rv.fallback = false; window.CmapMap.quizEnd(); window.CmapMap.highlight([]); }

  // 280-1: 퀴즈 탭은 시작 카드 3개(연결 퀴즈 · 표시 개념 퀴즈 · 말로 설명하기)만 보여 준다. 해설 읽기는 지도 만들기 탭의 [해설]에 있다.
  function load() {
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
    if (Rv.loaded) renderReview();
  }

  // ── 퀴즈 탭 ──
  function renderReview() {
    renderWrong();
    const box = $('review-panel');
    box.textContent = '';
    if (!Rv.loaded) { box.append(h('p', { class: 'hint', text: '불러오는 중…' })); return; }
    const saved = isSaved(), edges = window.CmapMap.edgeCount(), nodes = window.CmapMap.info().nodeIds.length;
    // 1) 연결 퀴즈 — 285-1: 저장되지 않았으면 [지도 저장하고 퀴즈 시작](저장 → 성공하면 시작), 지도가 비었거나 연결이 없으면 [지도 만들기로 가기]
    const needMake = nodes === 0 || edges === 0;
    box.append(h('section', { class: 'qcard', id: 'qcard-all' },
      h('p', { class: 'sec-label', text: '연결 퀴즈' }),
      h('p', { class: 'hint', id: 'quiz-start-note', text: nodes === 0 ? '먼저 지도를 만들어 주세요. 지도에 개념을 올리고 연결을 이으면 퀴즈를 풀 수 있어요.' : edges === 0 ? '연결이 있는 지도에서만 퀴즈를 풀 수 있어요. 지도 만들기에서 연결을 이어 보세요.' : !saved ? '지도가 아직 저장되지 않았어요. 저장하고 이어서 퀴즈를 시작할 수 있어요.' : '지도의 노드만 보여 줍니다. 두 노드를 차례로 눌러 연결을 떠올려 보세요.' }),
      h('div', { class: 'narr-actions', style: 'justify-content:flex-start' }, needMake
        ? h('button', { class: 'btn', type: 'button', id: 'quiz-go-make', onclick: () => window.CmapNav.goMake(), text: '지도 만들기로 가기' })
        : h('button', { class: 'btn', type: 'button', id: 'quiz-start', disabled: Rv.saving, onclick: startQuiz, text: Rv.saving ? '저장하는 중…' : saved ? '연결 퀴즈 시작' : '지도 저장하고 퀴즈 시작' }))));
    // 2) 표시 개념 퀴즈
    const mi = Rv.minfo, nMarked = mi ? mi.marked.length : 0;
    const mcard = h('section', { class: 'qcard', id: 'qcard-marked' },
      h('p', { class: 'sec-label', text: '표시 개념 퀴즈' }),
      h('div', { class: 'narr-actions', style: 'justify-content:flex-start;margin-top:4px;align-items:center' },
        h('button', { class: 'btn', type: 'button', id: 'quiz-start-marked', disabled: !mi || nMarked === 0 || Rv.saving, onclick: () => startQuiz('marked'), text: Rv.saving ? '저장하는 중…' : saved ? '표시한 개념 퀴즈' : '지도 저장하고 표시 개념 퀴즈 시작' }),
        h('span', { class: 'hint', id: 'quiz-marked-count', style: 'margin-top:0', text: mi ? '표시한 개념 ' + nMarked + '개' : '' })));
    if (mi && nMarked === 0) mcard.append(h('p', { class: 'hint', id: 'quiz-marked-hint', text: '지도에서 모르는 개념을 눌러 표시해 보세요' }));
    if (mi && mi.isolated.length) mcard.append(h('p', { class: 'hint', id: 'quiz-marked-isolated', text: '연결이 없어 출제할 수 없음: ' + mi.isolated.map(x => x.term).join(', ') }));
    if (Rv.msg) mcard.append(h('p', { class: 'msg', id: 'review-msg', role: 'alert', text: Rv.msg }));
    if (Rv.fallback) mcard.append(h('div', { class: 'narr-actions', style: 'justify-content:flex-start;margin-top:0' }, h('button', { class: 'btn text', type: 'button', id: 'quiz-start-all-fallback', onclick: () => startQuiz('all'), text: '전체 퀴즈로 풀기' })));
    box.append(mcard);
    // 3) 말로 설명하기 (answerView.js 가 #answer-entry 를 채운다)
    box.append(h('section', { class: 'qcard', id: 'qcard-answer' }, h('p', { class: 'sec-label', text: '말로 설명하기' }), h('div', { id: 'answer-entry' })));
    if (window.CmapAnswer) window.CmapAnswer.renderEntry();
    if (!saved && status() && status().save_status === 'changed') box.append(h('p', { class: 'hint', text: '지도가 저장한 뒤에 바뀌었어요. 위 지도는 지금 상태입니다.' }));
  }

  // ── 오답노트 탭: 모르는 개념으로 표시한 개념 목록(말로 설명하기 최근 부족 목록은 answerView.js 가 #wrong-recent 에 그린다) ──
  function renderWrong() {
    const ul = $('wrong-marked');
    if (!ul) return;
    const list = window.CmapMap.mapId() ? window.CmapMap.markedConcepts() : [];
    ul.textContent = '';
    for (const c of list) ul.append(h('li', { 'data-id': c.id, text: c.term }));
    $('wrong-marked-label').textContent = '모르는 개념 표시 ' + list.length + '개';
    $('wrong-marked-empty').hidden = list.length > 0;
  }

  // ── 퀴즈 ──
  async function startQuiz(mode) {
    const id = window.CmapMap.mapId();
    if (!id) return;
    mode = mode === 'marked' ? 'marked' : 'all';
    Rv.msg = ''; Rv.fallback = false;
    if (!isSaved()) {                                               // 285-1: 저장하고 이어서 시작. 저장이 실패하면 퀴즈를 부르지 않는다
      if (Rv.saving) return;
      Rv.saving = true; renderReview();
      const sv = await window.CmapMap.save();
      Rv.saving = false;
      if (!sv.ok) { Rv.msg = '지도를 저장하지 못했어요. ' + (sv.error || ''); renderReview(); return; }
      renderReview();
    }
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
      if (mode === 'review') load();
      else if (mode !== 'quiz') { if (Rv.quiz) { Rv.quiz = null; M.quizEnd(); } }
    });
    M.on('quizpair', onQuizPair);
    M.on('sheetclose', () => {                                    // 시트를 닫으면(닫기·ESC·뒤로 가기) 진행 중이던 퀴즈는 끝난다
      if (Rv.quiz) { Rv.quiz = null; pending = null; M.quizEnd(); M.setMode('review'); }
      if (M._state().mode === 'review') loadInfo();                  // 시트에서 표시를 바꿨을 수 있으므로 표시한 개념 수·오답노트 목록을 다시 가져온다
    });
    M.on('open', reset); M.on('close', reset);
    M.on('status', () => { if (Rv.loaded && M._state().mode === 'review') renderReview(); });
  }
  // 280-1: 풀던 퀴즈가 있으면(한 개라도 이었고 결과 전) 탭을 옮길 때 확인한다
  const quizActive = () => !!Rv.quiz && !Rv.quiz.result && Rv.quiz.answers.length > 0;
  window.CmapReview = { init, renderWrong, quizActive, _state: () => ({ quiz: Rv.quiz ? { answers: Rv.quiz.answers.length, result: !!Rv.quiz.result } : null }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
