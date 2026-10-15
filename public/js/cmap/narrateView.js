// 작업273-4: 개념 지도 화면의 "해설" 탭 — AI 해설(이야기체 본문 + 한 줄 요약 + 기억용 + 개념 제안).
// 클래식 스크립트(window.CmapNarr). concept_map.html 의 인라인 전역($, h, api, okStatus, errText, refresh, selectTopic)과 window.CmapMap(mapView.js)의 공개 함수를 호출 시점에 사용한다.
// - 클라이언트는 지도 id 만 서버에 보낸다(입력은 서버가 DB 에서 만듦). 저장 상태·stale 판단은 서버가 준 해시를 비교만 한다(해시는 계산하지 않음).
// - 40초 안에 응답이 없으면 요청을 끊고 오류 카드(+ [다시 시도]). 자동 재시도 없음. 하루 한도(429)는 안내만.
// - 단락의 [지도에서 보기]를 누르면 지도 시트가 열리고 그 단락의 개념이 강조된다(274-4). 제안은 어떤 경우에도 개념·연결을 자동으로 추가하지 않는다
//   ([찾아보기] = 개념 검색 입력칸에 용어만 채움, 이미 저장된 개념 = 개념 선택 패널을 열어 안내).
(function () {
  'use strict';
  const NARR_TIMEOUT_MS = 40000;
  const timeoutMs = () => (Number.isFinite(window.__CMAP_AI_TIMEOUT_MS) && window.__CMAP_AI_TIMEOUT_MS > 0 ? window.__CMAP_AI_TIMEOUT_MS : NARR_TIMEOUT_MS);
  const N = { mapId: null, data: null, loading: false, error: null, para: null, loaded: false, seq: 0, ctrl: null };

  const status = () => window.CmapMap.status();
  const isSaved = () => { const s = status(); return !!s && s.save_status === 'saved'; };
  const isStale = () => !!(N.data && N.data.narration && status() && N.data.narration.source_hash !== status().current_hash);
  const termOf = id => { const c = N.data && N.data.concepts && N.data.concepts.find(x => x.id === id); return c ? c.term : '?'; };

  function reset() {
    N.seq++; if (N.ctrl) N.ctrl.abort();
    N.ctrl = null; N.data = null; N.loading = false; N.error = null; N.para = null; N.loaded = false; N.mapId = null;
    window.CmapMap.highlight([]);
  }

  async function load() {
    const id = window.CmapMap.mapId();
    if (!id) return;
    N.mapId = id;
    const seq = ++N.seq;
    const r = await api('GET', '/api/cmap/maps/' + id + '/narration');
    if (seq !== N.seq) return;
    if (okStatus(r)) { N.data = r.body; N.error = null; } else N.error = { message: errText(r, '해설을 불러오지 못했습니다.'), retry: false };
    N.loaded = true;
    render();
  }

  async function generate() {
    if (N.loading || !N.mapId) return;
    const seq = ++N.seq;
    const ctrl = N.ctrl = new AbortController();
    let timedOut = false;
    const tm = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs());
    N.loading = true; N.error = null; render();
    const r = await api('POST', '/api/cmap/maps/' + N.mapId + '/narrate', undefined, ctrl.signal);
    clearTimeout(tm);
    if (seq !== N.seq) return;                       // 화면을 떠났거나 다시 열었으면 늦게 온 응답은 버린다
    N.loading = false; N.ctrl = null;
    if (r.aborted) N.error = { message: timedOut ? 'AI 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.' : '요청이 취소됐어요.', retry: true };
    else if (okStatus(r)) { N.data = r.body; N.para = null; window.CmapMap.highlight([]); }
    else N.error = { message: errText(r, '해설을 만들지 못했습니다. 잠시 후 다시 시도해주세요.'), retry: r.status !== 429 && r.status !== 409 };
    render();
  }

  // 274-4: 단락의 [지도에서 보기] → 지도 시트(읽기 전용)가 열리고 그 단락의 개념이 강조된다
  function showPara(i) {
    const p = N.data && N.data.narration && N.data.narration.content.story[i];
    if (!p) return;
    N.para = i;
    window.CmapMap.showOnMap(p.concept_ids);
    render();
  }

  // 제안: [찾아보기] → 개념 검색 입력칸에 용어만 채우고 이동(자동 검색·저장 없음)
  async function searchSuggestion(s) {
    const topicId = (s.topic_id !== undefined ? s.topic_id : null) || window.CmapMap.topicOfConcept(s.near_concept_id) || window.CmapMap.rootId();
    await refresh();
    await window.CmapNav.openTopic(topicId);        // 280-1: 지도를 닫고 그 주제 안 화면으로(뒤로 가면 해설로 돌아옴)
    const input = $('explain-term');
    input.value = s.term;
    $('concepts-msg').textContent = '';
    input.scrollIntoView && input.scrollIntoView({ block: 'center' });
    input.focus();
  }
  // 이미 저장된 개념 → 지도 탭에서 개념 선택 패널을 열어 해당 개념으로 안내(체크는 사용자가 직접)
  function guideAdd(s) {
    window.CmapMap.setMode('map');
    window.CmapMap.openPick();
    const el = s.concept_id ? document.getElementById('pick-' + s.concept_id) : null;
    if (el) { el.scrollIntoView && el.scrollIntoView({ block: 'center' }); el.focus(); }
  }

  function render() {
    const box = $('narr-panel');
    if (!box) return;
    box.textContent = '';
    const nar = N.data && N.data.narration;
    const saved = isSaved();
    const actions = [];

    if (!N.loaded) { box.append(h('p', { class: 'hint', text: '해설을 불러오는 중…' })); return; }

    if (N.loading) {
      box.append(h('p', { class: 'narr-loading', id: 'narr-loading', role: 'status', text: 'AI가 해설을 만들고 있어요… (최대 40초)' }));
    }
    if (N.error) {
      box.append(h('div', { class: 'narr-error', id: 'narr-error', role: 'alert' },
        h('p', { text: N.error.message }),
        N.error.retry ? h('button', { class: 'btn', type: 'button', id: 'narr-retry', onclick: generate, text: '다시 시도' }) : null));
    }

    if (!nar) {
      if (!N.loading) {
        box.append(h('p', { class: 'hint', id: 'narr-empty', text: saved ? '지도 속 개념과 연결을 이야기처럼 이어 주는 해설을 만들 수 있어요.' : '해설은 저장된 지도에서만 만들 수 있어요. 지도 탭에서 [저장]을 눌러 주세요.' }));
        actions.push(h('button', { class: 'btn', type: 'button', id: 'narr-make', disabled: !saved || N.loading, onclick: generate, text: '해설 만들기' }));
      }
    } else {
      const c = nar.content;
      if (isStale()) {
        box.append(h('div', { class: 'narr-stale', id: 'narr-stale', role: 'status' },
          h('p', { text: '지도가 바뀌었습니다. 아래 해설은 이전 지도를 기준으로 만든 것입니다.' }),
          h('p', { class: 'hint', text: saved ? '' : '지도를 저장하면 해설을 다시 만들 수 있어요.' })));
      }
      box.append(h('p', { class: 'sec-label', text: 'AI 설명 · 확인 필요' }));
      box.append(h('p', { class: 'narr-summary', id: 'narr-summary', text: c.summary }));
      c.story.forEach((p, i) => {
        box.append(h('div', { class: 'narr-para' + (N.para === i ? ' sel' : ''), 'data-para': i },
          h('span', { class: 'narr-text', text: p.text }),
          h('span', { class: 'narr-cap', text: '다루는 개념: ' + p.concept_ids.map(termOf).join(' · ') }),
          h('div', { class: 'narr-para-row' }, h('button', { class: 'btn text', type: 'button', 'data-act': 'show-map', onclick: () => showPara(i), text: '지도에서 보기' }))));
      });
      if (c.mnemonic && c.mnemonic.length) {
        box.append(h('p', { class: 'sec-label narr-sec', text: '기억용' }));
        box.append(h('ul', { class: 'narr-mnemonic', id: 'narr-mnemonic' }, c.mnemonic.map(m => h('li', { text: m }))));
      }
      box.append(h('p', { class: 'sec-label narr-sec', text: 'AI가 제안하는 개념' }));
      if (!c.suggestions || !c.suggestions.length) box.append(h('p', { class: 'hint', text: '제안할 개념이 없어요.' }));
      else {
        box.append(h('ul', { class: 'narr-sugs', id: 'narr-sugs' }, c.suggestions.map((s, i) => h('li', { class: 'narr-sug', 'data-sug': i },
          h('p', { class: 'narr-sug-term', text: s.term }),
          h('p', { class: 'narr-sug-reason', text: s.reason }),
          h('p', { class: 'narr-cap', text: '가까운 개념: ' + termOf(s.near_concept_id) }),
          s.saved
            ? h('div', { class: 'narr-sug-row' }, h('span', { class: 'narr-cap', text: '이미 저장된 개념이에요.' }), h('button', { class: 'btn text', type: 'button', 'data-act': 'guide', onclick: () => guideAdd(s), text: '지도에 추가하러 가기' }))
            : h('div', { class: 'narr-sug-row' }, h('button', { class: 'btn text', type: 'button', 'data-act': 'search', onclick: () => searchSuggestion(s), text: '찾아보기' }))))));
      }
      if (!N.loading) actions.push(h('button', { class: isStale() ? 'btn' : 'btn text', type: 'button', id: 'narr-make', disabled: !saved, onclick: generate, text: '다시 만들기' }));
    }
    if (actions.length) box.append(h('div', { class: 'narr-actions' }, actions));
    if (N.data && N.data.daily) box.append(h('p', { class: 'hint narr-daily', id: 'narr-daily', text: '오늘 해설 ' + N.data.daily.used + '/' + N.data.daily.cap + '건 사용' }));
  }

  // 화면 연결: 탭, 지도 열기·닫기, 저장 상태 변화
  function init() {
    const M = window.CmapMap;
    $('tab-map').addEventListener('click', () => M.setMode('map'));
    $('tab-narr').addEventListener('click', () => M.setMode('narr'));
    M.on('mode', mode => { if (mode === 'narr') { render(); load(); } else { window.CmapMap.highlight([]); N.para = null; } });
    M.on('open', reset);
    M.on('close', reset);
    M.on('status', () => { if (N.loaded && $('map-view') && !$('map-view').hidden) render(); });
  }
  window.CmapNarr = { init, _state: () => ({ loading: N.loading, error: N.error, para: N.para, stale: isStale() }) };
  // 인라인 스크립트의 전역($, h, api)과 화면 요소가 준비된 뒤에 연결한다
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
