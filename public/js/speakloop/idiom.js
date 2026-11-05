// 작업401: Speak Loop 이디엄 세션 — 세션 안내, 복습/신규(받아쓰기→소리·뉘앙스→예문 쉐도잉)/인출, 표현 목록. 녹음·마이크는 쓰지 않는다(작업402).
// app.js 가 만든 window.SL(재생기·화면 도구)과 SLCore(순수 함수)를 쓴다. 세션 진행 상태는 저장하지 않고, 서버에는 평가만 남긴다.
(function () {
  'use strict';
  const SL = window.SL, Core = window.SLCore;
  const { S, P, el, btn, tabGroup, setStatus, setNow, stopAll, playOne, buildupKeys, soundBlockOf, authHeaders, NO_AUDIO } = SL;
  const $ = id => document.getElementById(id);
  const STATUS_TEXT = { new: '안 배움', learned: '학습', hard: '막힘' };
  const COUNTDOWN = 5;
  const state = { timer: null, sess: null, cat: '전체', warn: '' };

  const idioms = () => S.content.idioms;
  const byId = id => idioms().find(i => i.id === id);
  const sayKey = i => i.id + '.say';
  const exKey = i => i.id + '.ex';
  const chunkKey = (i, j) => i.id + '.ex.c' + j;
  const allKeys = i => [sayKey(i), exKey(i)].concat(i.example.chunks.map((c, j) => chunkKey(i, j)));
  const host = () => $('view');

  function clearTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }
  function leave() { clearTimer(); state.sess = null; }
  function go(render) { clearTimer(); stopAll(); if (state.warn) setStatus(state.warn, true); host().textContent = ''; render(host()); window.scrollTo(0, 0); }
  function preload(i) { if (S.indexOk) P.preload(allKeys(i)); }
  const plan = () => Core.sessionPlan(idioms().map(i => i.id), S.progress);
  const playBtn = (key, label, cls) => P.has(key) ? btn(label, cls || 'btn text', () => playOne(key)) : el('span', 'noaudio', label + ': ' + NO_AUDIO);

  // 재생 속도 선택(다시 그리지 않고 선택 표시만 바꾼다 — 입력 중인 글이 지워지지 않게)
  function rateGroup() {
    const g = tabGroup(SL.RATES.map(r => r[0]), SL.RATES.findIndex(r => r[1] === P.rate), k => {
      P.rate = SL.RATES[k][1]; S.rate = P.rate;
      g.querySelectorAll('.tab').forEach((b, n) => b.setAttribute('aria-pressed', String(n === k)));
    }, '재생 속도');
    return g;
  }

  // 평가 기록. 실패해도 진행은 계속한다(글자로만 알림)
  async function record(id, rating, noteEl) {
    try {
      const res = await fetch('/api/speakloop/progress', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()), body: JSON.stringify({ item_id: id, rating }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || !d.ok) throw new Error('save');
      S.progress[id] = d.item;
      state.warn = '';
      return true;
    } catch (e) {
      state.warn = '기록하지 못했습니다. 진행은 계속할 수 있습니다.';   // 다음 화면에서도 보이도록 남겨 둔다
      setStatus(state.warn, true);
      if (noteEl) noteEl.textContent = state.warn;
      return false;
    }
  }

  // ── 첫 화면 ──
  function home() {
    state.sess = null; state.warn = '';
    go(h => {
      const p = plan();
      h.appendChild(el('h2', 'mono-title', '이디엄 세션'));
      const stats = el('div', 'stats');
      [['복습 대상', p.review.length], ['오늘 신규', p.fresh.length], ['이미 배운 표현', p.learned]].forEach(([k, v]) => {
        const row = el('p', 'stat'); row.appendChild(el('span', 'stat-k', k)); row.appendChild(el('strong', 'stat-v', v + '개')); stats.appendChild(row);
      });
      h.appendChild(stats);
      const tools = el('div', 'toolbar');
      if (p.review.length || p.fresh.length) tools.appendChild(btn('세션 시작', 'btn', () => startSession(false)));
      else {
        h.appendChild(el('p', 'msg', '모든 표현을 한 번씩 배웠습니다'));
        if (p.practice.length) tools.appendChild(btn('인출 연습만 하기', 'btn', () => startSession(true)));
      }
      tools.appendChild(btn('표현 목록', 'btn text', list));
      h.appendChild(tools);
    });
  }

  // ── 세션 ──
  function startSession(practiceOnly) {
    const p = plan(), stages = [];
    if (practiceOnly) { if (!p.practice.length) return; stages.push({ name: '인출', ids: p.practice }); }
    else {
      if (p.review.length) stages.push({ name: '복습', ids: p.review });
      if (p.fresh.length) stages.push({ name: '신규', ids: p.fresh });
      if (p.retrieval.length) stages.push({ name: '인출', ids: p.retrieval });   // 작업402: 인출은 이번 세션의 신규만(복습은 1단계에서 한 번 평가)
    }
    state.sess = { stages, si: 0, qi: 0, sub: 'A', learned: 0, good: 0, hard: 0 };
    render();
  }
  function stepsRow(cur) {
    const row = el('p', 'steps'); row.setAttribute('aria-label', '세션 단계');
    ['1 복습', '2 신규', '3 인출'].forEach(t => {
      const s = el('span', 'step', t);
      if (t.slice(2) === cur) s.setAttribute('aria-current', 'step');
      row.appendChild(s);
      if (t !== '3 인출') row.appendChild(el('span', 'step-arrow', '→'));
    });
    return row;
  }
  function advance() {   // 현재 이디엄을 마쳤을 때
    const s = state.sess;
    s.qi++; s.sub = 'A';
    if (s.qi >= s.stages[s.si].ids.length) { s.si++; s.qi = 0; }
    render();
  }
  function render() {
    const s = state.sess;
    if (!s) return home();
    if (s.si >= s.stages.length) return summary();
    const stage = s.stages[s.si], idiom = byId(stage.ids[s.qi]);
    go(h => {
      h.appendChild(toolbar(btn('세션 끝내기', 'btn text', home)));   // 작업402: 서버에 남은 평가는 유지, 확인 단계 없음
      h.appendChild(stepsRow(stage.name));
      h.appendChild(rateGroup());
      const label = stage.name + ' ' + (s.qi + 1) + '/' + stage.ids.length;
      h.appendChild(el('p', 'progress', label));
      preload(idiom);
      if (stage.name === '신규') {
        h.appendChild(el('h3', 'sub-title', { A: 'A 받아쓰기', B: 'B 소리·뉘앙스', C: 'C 예문 쉐도잉' }[s.sub]));
        if (s.sub === 'A') dictation(h, idiom, () => { s.sub = 'B'; render(); });
        else if (s.sub === 'B') { soundNuance(h, idiom); h.appendChild(toolbar(btn('다음', 'btn', () => { s.sub = 'C'; render(); }))); }
        else example(h, idiom, true);
      } else retrieval(h, idiom, s);
    });
  }
  const toolbar = (...kids) => { const t = el('div', 'toolbar'); kids.forEach(k => t.appendChild(k)); return t; };

  function dictation(h, idiom, onNext) {
    h.appendChild(el('p', 'note-lead', '표현을 듣고 입력하세요.'));
    h.appendChild(toolbar(playBtn(sayKey(idiom), '듣기', 'btn')));
    const wrap = el('div', 'field');
    const label = el('label', 'field-label', '들은 표현'); label.htmlFor = 'dict-in';
    const input = el('input'); input.type = 'text'; input.id = 'dict-in'; input.lang = 'en';
    input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'none'); input.setAttribute('autocorrect', 'off'); input.spellcheck = false;
    const msg = el('p', 'msg', ''); msg.id = 'dict-msg'; msg.setAttribute('role', 'status');
    wrap.appendChild(label); wrap.appendChild(input); wrap.appendChild(msg);
    h.appendChild(wrap);
    const result = el('div', 'result'); result.id = 'dict-result';
    const check = btn('확인', 'btn', () => {
      if (!input.value.trim()) { msg.textContent = '들은 표현을 입력하세요'; input.focus(); return; }
      msg.textContent = '';
      const d = Core.diffAnswer(idiom.idiom, input.value);
      result.textContent = '';
      const ans = el('p', 'answer'); ans.appendChild(document.createTextNode('정답: '));
      d.tokens.forEach((t, n) => { if (n) ans.appendChild(document.createTextNode(' ')); ans.appendChild(el('span', t.missed ? 'miss' : 'hit', t.text)); });
      result.appendChild(ans);
      result.appendChild(el('p', 'mean', idiom.mean));
      result.appendChild(el('p', 'verdict', d.allCorrect ? '모두 맞았어요.' : '밑줄 친 단어를 놓쳤어요.'));
      result.appendChild(toolbar(btn('다음', 'btn', onNext)));
      check.disabled = true; input.readOnly = true;
    });
    h.appendChild(toolbar(check));
    h.appendChild(result);
  }

  function soundNuance(h, idiom) {
    h.appendChild(el('p', 'idiom-head', idiom.idiom));
    h.appendChild(el('p', 'mean', idiom.mean));
    h.appendChild(toolbar(playBtn(sayKey(idiom), '듣기', 'btn text')));
    [['발음 근사', idiom.sound], ['소리 변화 이유', idiom.note], ['뉘앙스·쓰임새', idiom.nuance], ['쓰이는 상황', idiom.situ]].forEach(([k, v]) => {
      h.appendChild(el('h3', 'sub-title', k)); h.appendChild(el('p', 'body-text', v));
    });
  }

  // C: 예문 쉐도잉. canFinish 이면 [이 표현 완료]로 기록하고 다음 이디엄으로
  function example(h, idiom, canFinish) {
    const ex = idiom.example;
    h.appendChild(el('p', 'idiom-head', idiom.idiom));
    h.appendChild(el('p', 'mean', ex.ko));
    h.appendChild(soundBlockOf(ex.chunks, j => chunkKey(idiom, j)));
    h.appendChild(el('p', 'legend', '점 = 강세 음절, / = 끊어 읽기(숨 쉬는 곳), - = 음절, ‿ = 이어서 소리 남, ( ) = 거의 안 들림'));
    h.appendChild(SLRec.panel(SL, exKey(idiom)));   // 작업402: 인출 카드에는 붙이지 않는다
    const tools = el('div', 'toolbar');
    tools.appendChild(playBtn(exKey(idiom), '문장 재생', 'btn text'));
    const keys = ex.chunks.map((c, j) => chunkKey(idiom, j));
    tools.appendChild(keys.every(P.has) && P.has(exKey(idiom)) ? btn('쌓아가기', 'btn', () => buildupKeys(keys, exKey(idiom))) : el('span', 'noaudio', '쌓아가기: ' + NO_AUDIO));
    let n = 0;
    const counter = btn('통째로 말했어요 (0)', 'btn text', () => { n++; counter.textContent = '통째로 말했어요 (' + n + ')'; });
    counter.id = 'say-counter';
    tools.appendChild(counter);
    h.appendChild(tools);
    h.appendChild(el('p', 'note', '발음 표기·강세는 참고용입니다(검수 전)'));
    if (!canFinish) return;
    const note = el('p', 'msg', ''); note.setAttribute('role', 'status');
    const done = btn('이 표현 완료', 'btn', async () => {
      if (done.disabled) return;
      done.disabled = true;
      await record(idiom.id, 'some', note);
      state.sess.learned++;
      advance();
    });
    h.appendChild(toolbar(done));
    h.appendChild(note);
  }

  // 인출(복습·3단계 공통): 한국어 상황 + 예문 한국어 → 카운트다운 → 정답 공개 → 자가 평가
  function retrieval(h, idiom, s) {
    h.appendChild(el('h3', 'sub-title', '영어로 말해 보세요'));
    h.appendChild(el('p', 'speak-ko', idiom.situ));
    h.appendChild(el('p', 'mean', idiom.example.ko));
    const area = el('div', 'retrieval');
    h.appendChild(area);
    let left = COUNTDOWN, revealed = false;
    const reveal = auto => {
      if (revealed) return;
      revealed = true; clearTimer();
      area.textContent = '';
      area.appendChild(el('p', 'idiom-head', idiom.idiom));
      area.appendChild(el('p', 'speak-en', idiom.example.en));
      area.appendChild(toolbar(playBtn(exKey(idiom), '예문 듣기', 'btn text')));
      const note = el('p', 'msg', ''); note.setAttribute('role', 'status');
      const row = el('div', 'toolbar');
      const mk = (label, rating) => {
        const b = btn(label, 'btn', async () => {
          if (b.disabled) return;
          row.querySelectorAll('button').forEach(x => { x.disabled = true; });   // 한 번 누르면 비활성
          await record(idiom.id, rating, note);
          if (s.stages[s.si].name === '인출') s[rating]++;
          advance();
        });
        b.dataset.rating = rating;
        return b;
      };
      row.appendChild(mk('바로 말함', 'good')); row.appendChild(mk('막힘', 'hard'));
      area.appendChild(row); area.appendChild(note);
      if (P.has(exKey(idiom))) playOne(exKey(idiom));   // 타이머로 열린 경우 브라우저가 막을 수 있어 [예문 듣기]도 둔다
    };
    const count = el('p', 'countdown', String(left)); count.id = 'countdown';
    count.setAttribute('aria-label', '남은 시간(초)');
    area.appendChild(count);
    area.appendChild(toolbar(btn('정답 보기', 'btn text', () => reveal(false))));
    state.timer = setInterval(() => {
      left--;
      count.textContent = String(Math.max(left, 0));
      if (left <= 0) reveal(true);
    }, 1000);
  }

  function summary() {
    const s = state.sess;
    go(h => {
      h.appendChild(stepsRow('인출'));
      h.appendChild(el('h2', 'mono-title', '세션을 마쳤어요'));
      h.appendChild(el('p', 'body-text', '신규 ' + s.learned + '개 학습'));
      h.appendChild(el('p', 'body-text', '인출 바로 말함 ' + s.good + ' / 막힘 ' + s.hard));
      h.appendChild(toolbar(btn('처음으로', 'btn', home)));
    });
  }

  // ── 표현 목록 ──
  function list() {
    go(h => {
      h.appendChild(btn('세션 안내로', 'btn text back', home));
      h.appendChild(el('h2', 'mono-title', '표현 목록'));
      const cats = ['전체', '일상', '비즈니스'];
      h.appendChild(tabGroup(cats, cats.indexOf(state.cat), k => { state.cat = cats[k]; list(); }, '카테고리'));
      const box = el('div', 'list');
      idioms().filter(i => state.cat === '전체' || i.cat === state.cat).forEach(i => {
        const b = el('button', 'item'); b.type = 'button';
        b.appendChild(el('span', 'item-title', i.idiom));
        b.appendChild(el('span', 'item-situ', i.mean));
        b.appendChild(el('span', 'item-meta', STATUS_TEXT[Core.idiomStatus(S.progress[i.id])]));
        b.addEventListener('click', () => detail(i));
        box.appendChild(b);
      });
      h.appendChild(box);
    });
  }
  function detail(i) {
    go(h => {
      h.appendChild(btn('목록으로', 'btn text back', list));
      h.appendChild(rateGroup());
      preload(i);
      soundNuance(h, i);
      h.appendChild(el('h3', 'sub-title', '예문'));
      example(h, i, false);
    });
  }

  SL.idiom = { show: home, leave };
})();
