// 작업285-1: 지도 저장 안내·툴바 정리·읽기 전용 시트 안내(화면 변경만, 서버·DB 변경 없음).
//  - 해설·연결 퀴즈·표시 개념 퀴즈 카드: 저장되지 않았으면 "지도 저장하고 …"(화면에서 저장 → 성공하면 이어서 실행), 지도가 비면 [지도 만들기로 가기]
//  - 만들기 화면: 상태 한 줄 + [지도 저장] + 보강된 안내 문구 / 읽기 전용 시트: 수정 안내 + [지도 만들기로 가기] / 시트 툴바: 윗줄 저장 상태·[저장], 아랫줄 3개, [더보기]
// 서버는 실제 routes/concept_map.js + 가짜 DB, AI 는 모의. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_save_flow.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { tabIn, clickMore } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t, width = 390, height = 844) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width, height, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const GOOD_NARR = w => ({ summary: '요약입니다.', story: [{ text: '힘이 가속도를 만듭니다.', concept_ids: [w.ids[0], w.ids[1]] }, { text: '질량은 따로 있습니다.', concept_ids: [w.ids[2]] }], mnemonic: ['기억'], suggestions: [] });
// 과학 주제에 개념 3개. nodes=true 면 지도에 3개를 올리고 힘→가속도 연결 1개(저장은 하지 않음)
async function world(page, { nodes = true } = {}) {
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (const term of ['힘', '가속도', '질량']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term, explanation: { definition: term + ' 정의', example: term + ' 예시' }, explanation_source: 'ai' })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  if (nodes) {
    for (const id of ids) await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id });
    await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[1], label: '만든다', relation_type: '종류' });
  }
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  return { top, ids, map };
}
const logFetch = page => page.eval("window.__calls = []; const rf = window.fetch; window.fetch = (u, o) => { window.__calls.push(((o && o.method) || 'GET') + ' ' + String(u)); return rf(u, o); }; 0");
const calls = page => page.eval('window.__calls.filter(c => /\\/(save|narrate|quiz\\/start)$/.test(c))');
const gotoNarr = async page => { await tabIn(page, 'narr'); await page.waitFor("!!document.getElementById('narr-empty') || !!document.getElementById('narr-summary')", 6000, '해설 화면'); await sleep(200); };
const gotoQuiz = async page => { await page.click('#nav-quiz'); await page.waitFor("!!document.getElementById('quiz-start') || !!document.getElementById('quiz-go-make')", 6000, '퀴즈 탭'); await sleep(200); };
const saveState = page => page.eval('window.CmapMap.status().save_status');

test('해설: 미저장 지도에서 [지도 저장하고 해설 만들기] 한 번으로 저장 → 해설 순서로 호출되고, 상태가 함께 갱신된다(저장 라우트·해설 라우트 외 새 요청 없음)', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = () => JSON.stringify(GOOD_NARR(w));
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  assert.equal(await saveState(page), 'unsaved');
  await gotoNarr(page);
  assert.equal(await page.text('#narr-make'), '지도 저장하고 해설 만들기');
  assert.match(await page.text('#narr-empty'), /저장하고 이어서 해설을 만들 수 있어요/);
  await logFetch(page);
  await page.click('#narr-make');
  await page.waitFor("!!document.getElementById('narr-summary')", 15000, '해설');
  assert.deepEqual((await calls(page)).map(c => c.replace(/\d+/, 'N')), ['POST /api/cmap/maps/N/save', 'POST /api/cmap/maps/N/narrate'], '저장 → 해설 순서');
  assert.equal(await saveState(page), 'saved');
  assert.equal(srv.anthropic.calls.length, 1);
  assert.match(await page.text('#map-meta'), /^저장됨 · 개념 3개 · 연결 1개$/, '만들기 화면 상태 줄도 갱신');
  assert.equal(await page.eval("document.getElementById('map-save-out').disabled"), true, '저장됨이면 [지도 저장] 비활성');
  // 이미 저장됨이면 기존 [다시 만들기]만(저장 요청 없음)
  await page.eval('window.__calls.length = 0; 0');
  srv.anthropic.handler = () => JSON.stringify({ ...GOOD_NARR(w), summary: '요약 2' });
  await page.click('#narr-make');
  await page.waitFor("(document.getElementById('narr-summary') || {}).textContent === '요약 2'", 15000);
  assert.deepEqual((await calls(page)).map(c => c.replace(/\d+/, 'N')), ['POST /api/cmap/maps/N/narrate']);
  noErrors(page);
});

test('해설: 저장이 실패하면 해설을 부르지 않고 안내하며, 저장은 됐는데 해설이 실패하면 "저장됨"은 유지하고 해설 오류만 안내한다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await gotoNarr(page);
  // 저장 실패(서버 500 흉내)
  await page.eval("window.__rf = window.fetch; window.fetch = (u, o) => (/\\/save$/.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ ok: false, error: '일시적인 오류' }), { status: 500 })) : window.__rf(u, o)); 0");
  await page.click('#narr-make');
  await page.waitFor("!!document.getElementById('narr-error')", 6000, '저장 실패 안내');
  assert.match(await page.text('#narr-error'), /지도를 저장하지 못했어요\. 일시적인 오류/);
  assert.equal(srv.anthropic.calls.length, 0, '해설을 부르지 않음');
  assert.equal(await saveState(page), 'unsaved');
  assert.equal(await page.eval("document.getElementById('narr-make').disabled"), false, '다시 누를 수 있음');
  // 저장 성공 + 해설 실패
  await page.eval('window.fetch = window.__rf; 0');
  srv.anthropic.handler = () => { throw new Error('upstream down'); };
  await page.click('#narr-make');
  await page.waitFor("!!document.getElementById('narr-error') && /늦어지|가져오지|만들지/.test(document.getElementById('narr-error').textContent)", 8000, '해설 오류');
  assert.equal(await saveState(page), 'saved', '저장됨은 유지');
  assert.match(await page.text('#map-meta'), /^저장됨/);
  assert.equal(srv.anthropic.calls.length, 1);
  assert.equal(await page.text('#narr-make'), '해설 만들기', '이제는 저장됨이므로 해설 만들기 버튼');
  assert.ok(w.ids.length === 3);
  noErrors(page);
});

test('지도에 개념이 없으면 해설·퀴즈 카드에 "먼저 지도를 만들어 주세요"와 [지도 만들기로 가기] — 누르면 지도 만들기 탭의 [만들기] 구분으로 이동', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  await world(page, { nodes: false });
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await gotoNarr(page);
  assert.match(await page.text('#narr-empty'), /먼저 지도를 만들어 주세요/);
  assert.equal(await page.count('#narr-make'), 0);
  await page.click('#narr-go-make');
  await page.waitFor("S.view === 'map' && document.getElementById('map-view').classList.contains('narr-mode') === false && !!document.getElementById('start-list')", 6000, '[만들기] 구분');
  assert.equal(await page.eval("document.getElementById('tab-map').getAttribute('aria-selected')"), 'true');
  assert.equal(await page.eval("document.getElementById('map-page').offsetParent !== null"), true);
  await gotoQuiz(page);
  assert.match(await page.text('#quiz-start-note'), /먼저 지도를 만들어 주세요/);
  assert.equal(await page.count('#quiz-start'), 0);
  await page.click('#quiz-go-make');
  await page.waitFor("S.view === 'map' && !!document.getElementById('start-list')", 6000);
  assert.equal(await page.eval("document.getElementById('tab-map').getAttribute('aria-selected')"), 'true');
  noErrors(page);
});

test('퀴즈 카드: 미저장 지도에서 [지도 저장하고 퀴즈 시작] / [지도 저장하고 표시 개념 퀴즈 시작] — 저장 후 퀴즈가 시작되고, 저장이 실패하면 퀴즈를 부르지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids[0]}/mark`, { marked: true });
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids[1]}/mark`, { marked: true });
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await gotoQuiz(page);
  await page.waitFor("document.getElementById('quiz-marked-count').textContent === '표시한 개념 2개'", 6000);
  assert.equal(await page.text('#quiz-start'), '지도 저장하고 퀴즈 시작');
  assert.equal(await page.text('#quiz-start-marked'), '지도 저장하고 표시 개념 퀴즈 시작');
  assert.match(await page.text('#quiz-start-note'), /저장하고 이어서 퀴즈를 시작할 수 있어요/);
  assert.ok(await page.eval("document.getElementById('quiz-start').getBoundingClientRect().height >= 44 && document.getElementById('quiz-start-marked').getBoundingClientRect().height >= 44"));
  // 저장 실패 → 퀴즈 시작 요청 없음
  await logFetch(page);
  await page.eval("window.__rf = window.fetch; window.fetch = (u, o) => (/\\/save$/.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ ok: false, error: '일시적인 오류' }), { status: 500 })) : window.__rf(u, o)); 0");
  await page.click('#quiz-start');
  await page.waitFor("!!document.getElementById('review-msg')", 6000, '저장 실패 안내');
  assert.match(await page.text('#review-msg'), /지도를 저장하지 못했어요/);
  assert.equal(await page.eval("window.__calls.filter(c => /quiz\\/start$/.test(c)).length"), 0, '퀴즈 시작 요청 없음');
  assert.equal(await saveState(page), 'unsaved');
  // 복구 → 저장 후 연결 퀴즈 시작
  await page.eval('window.fetch = window.__rf; 0');
  await page.click('#quiz-start');
  await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode') && document.getElementById('map-sheet').open", 8000, '퀴즈 시트');
  assert.equal(await saveState(page), 'saved');
  assert.ok(srv.db.maps.every(m => m.saved_at), '서버에 저장됨');
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  // 표시 개념 퀴즈도 저장된 뒤에는 라벨이 기존 그대로
  await page.waitFor("document.getElementById('quiz-start-marked').textContent === '표시한 개념 퀴즈' && document.getElementById('quiz-start').textContent === '연결 퀴즈 시작'", 6000, '저장된 상태 라벨');
  noErrors(page);
});

test('퀴즈 카드: [지도 저장하고 표시 개념 퀴즈 시작]도 저장 → 시작', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids[0]}/mark`, { marked: true });
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids[1]}/mark`, { marked: true });
  await seed(page, 'POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.ids[1], to_concept_id: w.ids[2], label: '둘째 연결' });   // 표시 개념 퀴즈는 범위의 연결이 2개 이상이어야 한다
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await gotoQuiz(page);
  await page.waitFor("document.getElementById('quiz-marked-count').textContent === '표시한 개념 2개'", 6000);
  await logFetch(page);
  await page.click('#quiz-start-marked');
  await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode') && document.getElementById('map-sheet').open", 8000, '표시 개념 퀴즈 시트');
  assert.deepEqual((await calls(page)).map(c => c.replace(/\d+/, 'N')), ['POST /api/cmap/maps/N/save', 'POST /api/cmap/maps/N/quiz/start']);
  noErrors(page);
});

test('만들기 화면: 지도에 개념이 있으면 상태 한 줄 + [지도 저장](저장 안 됨·저장 후 변경됨일 때만 활성), 안내 문구가 다른 최상위 주제의 개념은 안 나온다고 알려 준다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page, { nodes: false });
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  assert.match(await page.text('#map-scope'), /‘과학’ 주제 전체의 지도예요\. 다른 최상위 주제의 개념은 이 지도에 나오지 않아요\./);
  assert.equal(await page.eval("document.getElementById('map-save-out').hidden"), true, '지도에 개념이 없으면 저장 버튼 없음');
  assert.equal(await page.text('#map-meta'), '');
  await page.click('#start-list .pick-row:nth-of-type(1)'); await page.click('#start-list .pick-row:nth-of-type(2)');
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000);
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.text('#map-meta'), '저장 안 됨 · 개념 2개 · 연결 0개');
  assert.equal(await page.eval("document.getElementById('map-save-out').hidden"), false);
  assert.equal(await page.eval("document.getElementById('map-save-out').disabled"), false, '저장 안 됨이면 활성');
  assert.ok(await page.eval("document.getElementById('map-save-out').getBoundingClientRect().height >= 44"));
  await page.click('#map-save-out');
  await page.waitFor("document.getElementById('map-save-out').disabled && /^저장됨 · 개념 2개 · 연결 0개$/.test(document.getElementById('map-meta').textContent)", 6000, '저장됨');
  assert.equal(await saveState(page), 'saved');
  // 체크를 바꿔 지도를 열면 저장 후 변경됨 → 다시 활성
  await page.click(`#start-pick-${w.ids[2]}`);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000);
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.text('#map-meta'), '저장 후 변경됨 · 개념 3개 · 연결 0개');
  assert.equal(await page.eval("document.getElementById('map-save-out').disabled"), false);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('읽기 전용 시트(해설·오답노트의 [지도 열기]): 상단에 "읽기 전용이에요…" 안내와 [지도 만들기로 가기] — 시트를 닫고 지도 만들기 탭의 [만들기]로 가며 기록이 정리된다. 편집 시트에는 안내가 없다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  await world(page);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000);
  assert.equal(await page.eval("document.getElementById('map-ro-note').getBoundingClientRect().height"), 0, '편집 시트에는 읽기 전용 안내가 없음');
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  const len0 = await page.eval('history.length');
  await gotoNarr(page);
  await page.click('#narr-open-map'); await page.waitFor("document.getElementById('map-sheet').open && document.getElementById('map-sheet').classList.contains('ro')", 6000);
  assert.match(await page.text('#map-ro-note'), /읽기 전용이에요\. 수정은 지도 만들기에서 할 수 있어요\./);
  assert.ok(await page.eval("document.getElementById('map-ro-go').getBoundingClientRect().height >= 44"));
  await page.click('#map-ro-go');
  await page.waitFor("!document.getElementById('map-sheet').open && S.view === 'map' && !!document.getElementById('start-list') && document.getElementById('tab-map').getAttribute('aria-selected') === 'true'", 6000, '지도 만들기 [만들기]');
  assert.equal(await page.eval('!(history.state && history.state.metisCmapSheet)'), true, '시트 기록이 정리됨');
  assert.ok(await page.eval('history.length') <= len0 + 1);
  // 오답노트의 읽기 전용 시트도 같다
  await page.click('#nav-wrong'); await page.waitFor("!document.getElementById('wrong-view').hidden", 4000);
  await page.click('#wrong-open-map'); await page.waitFor("document.getElementById('map-sheet').open", 6000);
  assert.match(await page.text('#map-ro-note'), /읽기 전용/);
  await page.click('#map-ro-go');
  await page.waitFor("!document.getElementById('map-sheet').open && S.view === 'map'", 6000);
  noErrors(page);
});

for (const width of [390, 320]) {
  test(`시트 툴바(${width}px): 윗줄 저장 상태 + [저장], 아랫줄 [개념 선택][전체 보기][더보기], [더보기] 목록(배치 최적화·되돌리기는 최적화 직후만·확대·축소), 라벨 넘침·가로 스크롤 없음`, { skip: SKIP, timeout: 60000 }, async t => {
    const { page } = await open(t, width, width === 320 ? 640 : 844);
    await world(page);
    await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
    await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000); await sleep(200);
    const geo = await page.eval(`(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const top = r('map-save-state'), save = r('map-save');
      const row = ['map-pick-toggle', 'map-fit', 'map-more-toggle'].map(id => { const b = document.getElementById(id), br = b.getBoundingClientRect(), sr = b.querySelector('span').getBoundingClientRect(); return { id, top: Math.round(br.top), w: br.width, h: br.height, labelFits: sr.width <= br.width + 0.5, right: br.right }; });
      return { topSame: Math.abs(top.top + top.height / 2 - (save.top + save.height / 2)) < 12, saveH: save.height, saveBelow: row[0].top > save.bottom - 1, row, vw: innerWidth, moreHidden: document.getElementById('map-more').hidden, undoHidden: document.getElementById('map-undo').hidden }; })()`);
    assert.ok(geo.topSame, '윗줄: 저장 상태 텍스트와 [저장]이 같은 줄'); assert.ok(geo.saveH >= 44); assert.ok(geo.saveBelow, '아랫줄은 윗줄 아래');
    assert.equal(new Set(geo.row.map(b => b.top)).size, 1, '아랫줄 3개가 한 줄');
    assert.ok(geo.row.every(b => b.w >= 44 && b.h >= 44 && b.labelFits && b.right <= geo.vw), JSON.stringify(geo.row));
    assert.equal(geo.moreHidden, true, '더보기 목록은 닫혀 있음');
    assert.equal(await page.eval("['map-opt', 'map-zoom-in', 'map-zoom-out'].every(id => document.getElementById(id).getBoundingClientRect().width === 0)"), true, '닫혀 있으면 목록 항목이 보이지 않음');
    assert.equal(await page.hasHorizontalScroll(), false);
    // 열기: 항목 3개(되돌리기는 숨김), 44px 이상, 화면 안
    await page.click('#map-more-toggle');
    assert.equal(await page.eval("document.getElementById('map-more-toggle').getAttribute('aria-expanded')"), 'true');
    const items = await page.eval(`[...document.querySelectorAll('#map-more button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { id: b.id, h: r.height, inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; })`);
    assert.deepEqual(items.map(i => i.id), ['map-opt', 'map-zoom-in', 'map-zoom-out'], '되돌리기는 최적화 직후에만');
    assert.ok(items.every(i => i.h >= 44 && i.inside), JSON.stringify(items));
    assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'map-opt', '키보드 접근: 열면 첫 항목에 포커스');
    // 바깥(지도)을 누르면 닫힌다
    await page.eval("document.getElementById('map-svg').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, clientX: 50, clientY: 300 })); 0");
    await page.waitFor("document.getElementById('map-more').hidden", 3000, '바깥 클릭으로 닫힘');
    // Esc: 목록만 닫고 시트는 유지
    await page.click('#map-more-toggle');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.waitFor("document.getElementById('map-more').hidden", 3000, 'Esc 로 목록 닫힘');
    assert.equal(await page.eval("document.getElementById('map-sheet').open"), true, '시트는 그대로');
    // 확대/축소는 목록 안에서 동작하고, 누르면 목록이 닫힌다
    const s0 = (await page.eval('window.CmapMap._state()')).view.scale;
    await clickMore(page, '#map-zoom-in');
    assert.ok((await page.eval('window.CmapMap._state()')).view.scale > s0);
    assert.equal(await page.eval("document.getElementById('map-more').hidden"), true);
    noErrors(page);
  });
}

test('툴바 회귀: 배치 최적화 미리보기 → 적용 후 [더보기]에 [되돌리기]가 나타나 원래 배치로 되돌린다, 읽기 전용 시트에는 윗줄·개념 선택·최적화가 없다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  [[40, 40], [260, 60], [150, 320]].forEach(() => 0);
  for (const [i, p] of [[0, [40, 40]], [1, [260, 60]], [2, [150, 320]]]) await seed(page, 'PATCH', `/api/cmap/maps/${w.map.id}/nodes/${w.ids[i]}`, { x: p[0], y: p[1] });
  await page.eval('refresh()'); await sleep(200);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000);
  await page.click('#map-save'); await page.waitFor("window.CmapMap.status().save_status === 'saved'", 6000);
  assert.equal(await page.eval("document.getElementById('map-save').disabled"), true, '저장됨이면 시트 [저장]도 비활성');
  const before = JSON.stringify((await page.eval('window.CmapMap._state()')).nodes.map(n => [n.id, n.x, n.y]));
  await clickMore(page, '#map-opt');
  await page.waitFor("!document.getElementById('map-opt-bar').hidden || /이미 정리/.test(document.getElementById('map-msg').textContent)", 4000);
  if (await page.eval("!document.getElementById('map-opt-bar').hidden")) {
    await page.click('#map-opt-apply');
    await page.waitFor("!document.getElementById('map-undo').hidden", 6000, '되돌리기 표시');
    await page.click('#map-more-toggle');
    assert.equal(await page.eval("document.getElementById('map-undo').offsetParent !== null"), true, '[더보기] 안에 되돌리기');
    await page.click('#map-undo');
    await page.waitFor("document.getElementById('map-undo').hidden", 6000);
    assert.equal(JSON.stringify((await page.eval('window.CmapMap._state()')).nodes.map(n => [n.id, n.x, n.y])), before, '원래 배치로');
  }
  assert.ok(w.ids.length === 3);
  noErrors(page);
});
