// 작업399: Speak Loop 화면 — 독백 연습(목록·상세 4모드)과 진행 기록. 녹음·마이크는 쓰지 않는다(작업401).
(function () {
  'use strict';
  const Core = window.SLCore;
  const $ = id => document.getElementById(id);
  const MODES = ['듣고 이해', '문장 훈련', '외우기', '통째로 말하기'];
  const RATES = [['느리게', 0.8], ['원래 속도', 1]];
  const NO_AUDIO = '음성 없음';

  const token = () => { try { return localStorage.getItem('mydict_token'); } catch (e) { return null; } };
  const authHeaders = () => ({ Authorization: 'Bearer ' + (token() || '') });
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(label, cls, onClick, aria) {
    const b = el('button', cls || 'btn text', label); b.type = 'button';
    if (aria) b.setAttribute('aria-label', aria);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  // 선택 상태는 aria-pressed(굵기+밑줄은 CSS)
  function tabGroup(labels, current, onPick, label) {
    const g = el('div', 'tabs'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    labels.forEach((t, i) => {
      const b = btn(t, 'btn text tab', () => onPick(i));
      b.setAttribute('aria-pressed', String(i === current));
      g.appendChild(b);
    });
    return g;
  }
  function setStatus(text, isError) { const s = $('status'); s.textContent = text || ''; s.className = 'msg' + (isError ? ' error' : ''); }

  const S = {
    content: null, progress: {}, cat: '전체', mono: null, mode: 0, sent: 0, rate: 1,
    stage: 0, revealed: new Set(), say: 0, hints: 0, shown: false, done: new Set(), rated: false, saving: false, recorded: null, recordError: '',
    busy: false, indexOk: true,
  };
  const P = SLPlayer.create({ token });

  // ── 재생 도우미 ──
  function setNow(keys) {
    const set = new Set(keys);
    document.querySelectorAll('[data-key]').forEach(n => n.classList.toggle('now', set.has(n.dataset.key)));
  }
  function setBusy(b) { S.busy = b; $('stop').hidden = !b; if (!b) setNow([]); }
  function stopAll() { P.stop(); setBusy(false); setStatus(''); }
  const ck = (m, i, j) => m.id + '.l' + i + (j === undefined ? '' : '.c' + j);

  async function playOne(key) {
    if (!P.has(key)) return;
    const g = P.begin();
    setBusy(true); setNow([key]); setStatus('');
    const ok = await P.play(key, g);
    if (P.alive(g)) { setBusy(false); if (!ok) setStatus('음성을 재생하지 못했습니다.', true); }
  }
  // 단계 목록을 순서대로 실행한다. 새 재생·중지·화면 이동이면 즉시 끝난다
  async function runSteps(steps, getKeys) {
    const g = P.begin();
    setBusy(true);
    let ok = true;
    for (const st of steps) {
      if (!ok || !P.alive(g)) { ok = false; break; }
      if (st.type === 'rest') {
        setNow([]); setStatus((st.label ? st.label + ' · ' : '') + '따라 말해 보세요 (' + st.seconds.toFixed(1) + '초)');
        ok = await P.wait(st.seconds, g);
      } else {
        const keys = getKeys(st);
        setNow(keys); setStatus(st.label || '');
        ok = await (keys.length > 1 ? P.playSeq(keys, st.gap || 0, g) : P.play(keys[0], g));
      }
    }
    if (P.alive(g)) { setBusy(false); setStatus(ok ? '' : '음성을 재생하지 못했습니다.', !ok); }
  }
  function buildup(i) {
    const keys = S.mono.lines[i].chunks.map((c, j) => ck(S.mono, i, j));
    if (!keys.every(P.has)) return;
    const sentKey = ck(S.mono, i);
    setStatus('음성을 준비하는 중입니다…');
    P.preload(keys.concat([sentKey])).then(() => {
      if (!keys.every(P.ready) || !P.ready(sentKey)) { setStatus('음성을 불러오지 못했습니다.', true); return; }
      const plan = Core.buildupPlan(keys.map(P.seconds));
      runSteps(plan, st => st.type === 'sentence' ? [sentKey] : keys.slice(st.from, st.to));
    });
  }
  function shadow(i) {
    const key = ck(S.mono, i);
    if (!P.has(key)) return;
    setStatus('음성을 준비하는 중입니다…');
    P.preload([key]).then(() => {
      if (!P.ready(key)) { setStatus('음성을 불러오지 못했습니다.', true); return; }
      const plan = Core.shadowPlan(P.seconds(key), 3);
      plan.forEach(st => { st.label = st.round + '/3회'; });
      runSteps(plan, () => [key]);
    });
  }
  async function listenAll() {
    const keys = S.mono.lines.map((l, i) => ck(S.mono, i)).filter(P.has);
    if (!keys.length) return;
    const g = P.begin(); setBusy(true);
    let ok = true;
    for (let n = 0; n < keys.length && ok; n++) {
      if (n > 0) { setNow([]); ok = await P.wait(1.0, g); }
      if (ok) { setNow([keys[n]]); ok = await P.play(keys[n], g); }
    }
    if (P.alive(g)) setBusy(false);
  }

  // ── 화면 조각 ──
  function chunkEn(c) {
    const w = el('span', 'en-wrap');
    w.appendChild(el('span', 'en' + (c.k ? ' k' : ''), c.en));
    const a = Core.arrowOf(c.en);
    if (a) { const ar = el('span', 'arrow', a); ar.setAttribute('aria-hidden', 'true'); w.appendChild(ar); }
    return w;
  }
  // 구·문장 재생 버튼. 음성이 없으면 버튼 대신 "음성 없음" 글자
  function playCtl(key, label, aria) {
    if (!P.has(key)) return el('span', 'noaudio', NO_AUDIO);
    return btn(label || '재생', 'btn text', () => playOne(key), aria);
  }
  function chunkRow(m, i, j, extra) {
    const c = m.lines[i].chunks[j];
    const row = el('div', 'chunk'); row.dataset.key = ck(m, i, j);
    const txt = el('div', 'chunk-text');
    txt.appendChild(chunkEn(c));
    txt.appendChild(el('div', 'ko', c.ko));
    if (extra) extra(txt, c);
    row.appendChild(txt);
    row.appendChild(playCtl(ck(m, i, j), '재생', '구 재생: ' + c.en));
    return row;
  }
  function lineHead(m, i) {
    const head = el('div', 'line-head');
    head.appendChild(el('h3', 'line-no', '문장 ' + (i + 1)));
    head.appendChild(playCtl(ck(m, i), '문장 재생', '문장 ' + (i + 1) + ' 전체 재생'));
    return head;
  }
  const allSentences = m => m.lines.every((l, i) => P.has(ck(m, i)));

  function viewListen(host) {
    const m = S.mono;
    const top = el('div', 'toolbar');
    top.appendChild(allSentences(m) ? btn('전체 이어 듣기', 'btn', listenAll) : el('span', 'noaudio', '전체 이어 듣기: ' + NO_AUDIO));
    host.appendChild(top);
    m.lines.forEach((l, i) => {
      const sec = el('section', 'line'); sec.dataset.key = ck(m, i);
      sec.appendChild(lineHead(m, i));
      l.chunks.forEach((c, j) => sec.appendChild(chunkRow(m, i, j)));
      sec.appendChild(el('p', 'line-ko', l.ko));
      (l.idioms || []).forEach(p => { const d = el('p', 'idiom'); d.appendChild(el('strong', null, p[0])); d.appendChild(document.createTextNode(' — ' + p[1])); sec.appendChild(d); });
      host.appendChild(sec);
    });
  }

  // 작업400: 소리 표기 블록 — 구마다 위(영어+강세 점)·아래(소리 표기 p), 구 사이 "/", 끝에 억양 화살표. 구 전체가 재생 버튼
  function stressEn(c) {
    const wrap = el('span', 'en-line');
    Core.stressWords(c.en, c.st).forEach((w, n) => {
      if (n) wrap.appendChild(document.createTextNode(' '));
      const word = el('span', 'w');
      let at = 0;
      w.ranges.forEach(r => {
        if (r[0] > at) word.appendChild(document.createTextNode(w.text.slice(at, r[0])));
        const seg = el('span', 'stressed', w.text.slice(r[0], r[1]));
        const dot = el('span', 'dot'); dot.setAttribute('aria-hidden', 'true');
        seg.appendChild(dot);
        word.appendChild(seg);
        at = r[1];
      });
      if (at < w.text.length) word.appendChild(document.createTextNode(w.text.slice(at)));
      wrap.appendChild(word);
    });
    return wrap;
  }
  function soundBlock(m, i) {
    const l = m.lines[i], box = el('div', 'sound');
    l.chunks.forEach((c, j) => {
      if (j) { const sep = el('span', 'slash', '/'); sep.setAttribute('aria-hidden', 'true'); box.appendChild(sep); }
      const key = ck(m, i, j);
      const inner = [stressEn(c), el('span', 'pron', c.p)];
      if (!P.has(key)) {
        const cell = el('span', 'phrase off'); cell.dataset.key = key;
        inner.forEach(n => cell.appendChild(n));
        cell.appendChild(el('span', 'noaudio', NO_AUDIO));
        box.appendChild(cell);
        return;
      }
      const b = el('button', 'phrase'); b.type = 'button'; b.dataset.key = key; b.setAttribute('aria-label', '구 재생: ' + c.en);
      inner.forEach(n => b.appendChild(n));
      b.addEventListener('click', () => playOne(key));
      box.appendChild(b);
    });
    const a = Core.arrowOf(l.chunks[l.chunks.length - 1].en);
    if (a) { const ar = el('span', 'arrow end', a); ar.setAttribute('aria-hidden', 'true'); box.appendChild(ar); }
    return box;
  }

  function viewTrain(host) {
    const m = S.mono, i = S.sent, l = m.lines[i];
    const sec = el('section', 'line');
    sec.appendChild(el('p', 'line-ko', l.ko));
    sec.appendChild(soundBlock(m, i));
    sec.appendChild(el('p', 'legend', '점 = 강세 음절, / = 끊어 읽기(숨 쉬는 곳), - = 음절, ‿ = 이어서 소리 남, ( ) = 거의 안 들림'));
    l.chunks.forEach((c, j) => sec.appendChild(chunkRow(m, i, j)));
    const tools = el('div', 'toolbar');
    const allChunks = l.chunks.every((c, j) => P.has(ck(m, i, j))), hasSent = P.has(ck(m, i));
    tools.appendChild(hasSent ? btn('문장 재생', 'btn text', () => playOne(ck(m, i))) : el('span', 'noaudio', '문장 재생: ' + NO_AUDIO));
    tools.appendChild(allChunks && hasSent ? btn('쌓아가기', 'btn', () => buildup(i)) : el('span', 'noaudio', '쌓아가기: ' + NO_AUDIO));
    tools.appendChild(hasSent ? btn('문장 전체 3회 반복 쉐도잉', 'btn', () => shadow(i)) : el('span', 'noaudio', '쉐도잉: ' + NO_AUDIO));
    sec.appendChild(tools);
    sec.appendChild(el('p', 'note', '발음 표기·강세는 참고용입니다(검수 전)'));
    host.appendChild(sec);
  }

  function viewMemo(host) {
    const m = S.mono;
    host.appendChild(tabGroup(Core.STAGES, S.stage, k => { S.stage = k; S.revealed.clear(); stopAll(); renderDetail(); }, '가리기 단계'));
    const tools = el('div', 'toolbar');
    tools.appendChild(btn('전체 가리기 다시', 'btn text', () => { S.revealed.clear(); stopAll(); renderDetail(); }));
    if (allSentences(m)) tools.appendChild(btn('전체 이어 듣기', 'btn text', listenAll));
    host.appendChild(tools);
    m.lines.forEach((l, i) => {
      const sec = el('section', 'line'); sec.dataset.key = ck(m, i);
      sec.appendChild(lineHead(m, i));
      const flags = Core.hiddenFlags(S.stage, l.chunks);
      const words = el('p', 'memo');
      l.chunks.forEach((c, j) => {
        const key = ck(m, i, j);
        if (flags[j] && !S.revealed.has(key)) {
          const b = btn(Core.maskChunk(c.en), 'btn text masked', () => {
            S.revealed.add(key);
            const shown = chunkEn(c); shown.dataset.key = key;
            b.replaceWith(shown);
            if (P.has(key)) playOne(key); else shown.after(el('span', 'noaudio', NO_AUDIO));
          }, '가려진 구 공개');
          b.dataset.key = key;
          words.appendChild(b);
        } else { const s = chunkEn(c); s.dataset.key = key; words.appendChild(s); }
        words.appendChild(document.createTextNode(' '));
      });
      sec.appendChild(words);
      sec.appendChild(el('p', 'line-ko', l.ko));
      host.appendChild(sec);
    });
  }

  function hintText(l, n) { return l.chunks.slice(0, n).map(c => c.en.split(/\s+/).map(w => w.charAt(0)).join(' ')).join('  /  '); }

  function viewSpeak(host) {
    const m = S.mono, i = S.sent, l = m.lines[i];
    host.appendChild(tabGroup(['듣고 따라 말하기', '먼저 말하기'], S.say, k => { S.say = k; S.hints = 0; S.shown = false; stopAll(); renderDetail(); }, '말하기 방식'));
    const sec = el('section', 'line');
    sec.appendChild(el('p', 'speak-ko', l.ko));
    const tools = el('div', 'toolbar');
    if (S.say === 0) {
      tools.appendChild(P.has(ck(m, i)) ? btn('듣기', 'btn', () => playOne(ck(m, i))) : el('span', 'noaudio', NO_AUDIO));
      sec.appendChild(el('p', 'note', '듣고 나서 소리 내어 따라 말해 보세요. (녹음하지 않습니다)'));
    } else {
      const hint = el('p', 'hint');
      if (S.shown) l.chunks.forEach((c, j) => { if (j) hint.appendChild(document.createTextNode(' ')); hint.appendChild(chunkEn(c)); });
      else if (S.hints) hint.textContent = hintText(l, S.hints);
      sec.appendChild(hint);
      if (!S.shown) {
        const hb = btn('힌트', 'btn text', () => { S.hints = Math.min(l.chunks.length, S.hints + 1); renderDetail(); });
        hb.disabled = S.hints >= l.chunks.length;
        tools.appendChild(hb);
        tools.appendChild(btn('확인', 'btn', () => { S.shown = true; renderDetail(); if (P.has(ck(m, i))) playOne(ck(m, i)); }));
      } else tools.appendChild(P.has(ck(m, i)) ? btn('다시 듣기', 'btn text', () => playOne(ck(m, i))) : el('span', 'noaudio', NO_AUDIO));
    }
    const last = i === m.lines.length - 1;
    tools.appendChild(btn(last ? '마지막 문장 마침' : '다음 문장', 'btn text', () => {
      S.done.add(i); S.hints = 0; S.shown = false; stopAll();
      if (!last) S.sent = i + 1;
      renderDetail();
    }));
    sec.appendChild(tools);
    sec.appendChild(el('p', 'note', '끝낸 문장 ' + S.done.size + ' / ' + m.lines.length));
    host.appendChild(sec);
    if (S.done.size === m.lines.length) host.appendChild(ratingArea());
  }

  function ratingArea() {
    const sec = el('section', 'rating'); sec.setAttribute('aria-label', '자가 평가');
    sec.appendChild(el('h3', 'sub-title', '5문장을 모두 말했어요. 어땠나요?'));
    const row = el('div', 'toolbar');
    Object.keys(Core.RATING_TEXT).forEach(r => {
      const b = btn(Core.RATING_TEXT[r], 'btn', () => rate(r));
      b.dataset.rating = r;
      b.disabled = S.rated || S.saving;
      row.appendChild(b);
    });
    sec.appendChild(row);
    const msg = el('p', 'msg' + (S.recordError ? ' error' : ''), S.recorded ? '기록했습니다. 연습 ' + S.recorded + '회' : S.recordError);
    msg.setAttribute('role', 'status');
    sec.appendChild(msg);
    return sec;
  }
  async function rate(r) {
    if (S.rated || S.saving) return;     // 중복 기록 방지
    const mono = S.mono;
    S.saving = true; S.recordError = ''; renderDetail();
    try {
      const res = await fetch('/api/speakloop/progress', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()), body: JSON.stringify({ item_id: mono.id, rating: r }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || !d.ok) throw new Error('save');
      S.progress[mono.id] = d.item;
      if (S.mono === mono) { S.rated = true; S.recorded = d.item.count; }
    } catch (e) { S.recordError = '기록하지 못했습니다. 연습은 계속할 수 있습니다.'; }
    S.saving = false;
    if (S.mono === mono) renderDetail();
  }

  // ── 목록·상세 ──
  function renderList() {
    const host = $('view'); host.textContent = '';
    S.mono = null;
    const cats = ['전체', '일상', '비즈니스'];
    host.appendChild(tabGroup(cats, cats.indexOf(S.cat), k => { S.cat = cats[k]; renderList(); }, '카테고리'));
    const list = el('div', 'list');
    S.content.monologues.filter(m => S.cat === '전체' || m.cat === S.cat).forEach(m => {
      const b = el('button', 'item'); b.type = 'button';
      b.appendChild(el('span', 'item-title', m.title));
      b.appendChild(el('span', 'item-situ', m.situ));
      const p = S.progress[m.id];
      b.appendChild(el('span', 'item-meta', p && p.count ? '연습 ' + p.count + '회 · 최근 ' + (Core.RATING_TEXT[p.last_rating] || '-') : '아직 안 함'));
      b.addEventListener('click', () => openMono(m));
      list.appendChild(b);
    });
    host.appendChild(list);
  }
  function openMono(m) {
    Object.assign(S, { mono: m, mode: 0, sent: 0, stage: 0, say: 0, hints: 0, shown: false, done: new Set(), rated: false, saving: false, recorded: null, recordError: '' });
    S.revealed.clear();
    renderDetail();
    window.scrollTo(0, 0);
    const keys = [];
    m.lines.forEach((l, i) => { keys.push(ck(m, i)); l.chunks.forEach((c, j) => keys.push(ck(m, i, j))); });
    if (S.indexOk) {
      setStatus('음성을 준비하는 중입니다…');
      P.preload(keys).then(failed => { if (S.mono === m) setStatus(failed.length ? '일부 음성을 불러오지 못했습니다. 재생할 때 다시 시도합니다.' : '', !!failed.length); });
    }
  }
  function leaveMono() { stopAll(); P.clear(); renderList(); }

  function renderDetail() {
    const m = S.mono, host = $('view'); host.textContent = '';
    host.appendChild(btn('목록으로', 'btn text back', leaveMono));
    host.appendChild(el('h2', 'mono-title', m.title));
    host.appendChild(el('p', 'mono-situ', m.situ));
    host.appendChild(tabGroup(RATES.map(r => r[0]), RATES.findIndex(r => r[1] === S.rate), k => { S.rate = RATES[k][1]; P.rate = S.rate; renderDetail(); }, '재생 속도'));
    host.appendChild(tabGroup(MODES, S.mode, k => { if (k !== S.mode) { S.mode = k; stopAll(); renderDetail(); } }, '연습 방식'));
    if (S.mode === 1 || S.mode === 3) {
      const g = tabGroup(m.lines.map((l, k) => String(k + 1)), S.sent, k => { S.sent = k; S.hints = 0; S.shown = false; stopAll(); renderDetail(); }, '문장 번호');
      g.querySelectorAll('.tab').forEach((b, k) => b.setAttribute('aria-label', '문장 ' + (k + 1)));
      host.appendChild(g);
    }
    const body = el('div', 'body'); host.appendChild(body);
    [viewListen, viewTrain, viewMemo, viewSpeak][S.mode](body);
  }

  // ── 시작 ──
  function denied() { $('main').hidden = true; $('loading').hidden = true; $('denied').hidden = false; }
  async function boot() {
    if (!token()) return denied();
    try {
      const r = await fetch('/api/me', { headers: authHeaders() });
      if (!r.ok) return denied();
      const me = await r.json();
      if (!(me.perm_speakloop === true || me.role === 'admin')) return denied();
    } catch (e) { return denied(); }
    const [cRes, indexOk, pRes] = await Promise.all([
      fetch('/api/speakloop/content', { headers: authHeaders() }).catch(() => null),
      P.loadIndex().then(() => true, () => false),
      fetch('/api/speakloop/progress', { headers: authHeaders() }).catch(() => null),
    ]);
    if (cRes && cRes.status === 403) return denied();
    let content = null;
    try { content = cRes && cRes.ok ? await cRes.json() : null; } catch (e) { content = null; }
    $('loading').hidden = true;
    $('main').hidden = false;
    if (!content || !Array.isArray(content.monologues)) {
      $('view').appendChild(el('p', 'msg error', '콘텐츠를 불러오지 못했습니다.'));
      $('view').appendChild(btn('다시 시도', 'btn text', () => location.reload()));
      return;
    }
    S.content = content; S.indexOk = indexOk;
    const notes = [];
    if (!indexOk) notes.push('음성 목록을 불러오지 못했습니다. 글만 볼 수 있습니다.');
    try {
      const pd = pRes && pRes.ok ? await pRes.json() : null;
      if (pd && pd.ok) pd.items.forEach(it => { S.progress[it.item_id] = it; }); else notes.push('연습 기록을 불러오지 못했습니다.');
    } catch (e) { notes.push('연습 기록을 불러오지 못했습니다.'); }
    if (notes.length) setStatus(notes.join(' '), true);
    renderList();
  }
  $('stop').addEventListener('click', stopAll);
  window.addEventListener('pagehide', () => P.release());
  boot();
})();
