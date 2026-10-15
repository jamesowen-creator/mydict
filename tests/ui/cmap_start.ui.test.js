// 작업283-2: 하단 내비 [지도 만들기] → [만들기] 첫 화면("이 주제의 저장된 개념 체크 목록 + [이 개념으로 지도 만들기]")과 처음부터 끝까지 이어지는 흐름,
// 한 모듈의 오류가 내비를 막지 않는지, 빠른 연속 탭의 모드 불일치. 서버는 실제 routes/concept_map.js + 가짜 DB, AI 는 모의. 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_start.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t, width = 390, height = 844) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  let n = 0;
  srv.anthropic.handler = () => { n++; return JSON.stringify({ english: 'e' + n, definition: '정의 ' + n + '입니다.', example: '예시 ' + n + '입니다.' }); };
  const page = await browser.newPage({ width, height, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const startState = page => page.eval(`(() => { const b = document.getElementById('map-open'); return { label: b ? b.textContent : null, disabled: b ? b.disabled : null, count: (document.getElementById('start-count') || {}).textContent || null, hint: (document.getElementById('start-hint') || {}).textContent || null, meta: document.getElementById('map-meta').textContent, checked: [...document.querySelectorAll('#start-list input')].filter(i => i.checked).length, total: document.querySelectorAll('#start-list input').length }; })()`);
const toMapTab = async page => { await page.click('#nav-map'); await page.waitFor("!document.getElementById('mapmk-view').hidden && !!document.getElementById('map-start').children.length", 6000, '지도 만들기 첫 화면'); };

test('처음부터 끝까지(390px): 주제 추가 → 하위 주제 추가 → 개념 3개 검색 → [지도 만들기] → 2개 체크 → [이 개념으로 지도 만들기] → 지도 시트가 열리고 선택한 개념이 노드로 올라가 있다', { skip: SKIP, timeout: 90000 }, async t => {
  const { srv, page } = await open(t);
  await page.click('#add-root-btn'); await page.waitFor("document.getElementById('add-dlg').open", 3000);
  await page.type('#add-input', '금융'); await page.click('#add-sub');
  await page.waitFor("!document.getElementById('add-chain').hidden", 4000);
  await page.type('#add-input', '단기자금'); await page.click('#add-done');
  await page.waitFor("!document.getElementById('topic-view').hidden && document.getElementById('path-line').textContent === '금융 › 단기자금'", 4000, '최하위 주제 안');
  for (const term of ['콜금리', 'CP', 'RP']) {
    await page.type('#explain-term', term); await page.click('#explain-go');
    await page.waitFor(`[...document.querySelectorAll('#concept-list .c-term')].some(e => e.textContent === ${JSON.stringify(term)})`, 6000, term);
  }
  assert.equal(srv.db.concepts.length, 3);
  await toMapTab(page);
  // 첫 화면: 안내 문구 + 체크 목록(경로 표시) + 안 눌린 상태
  assert.match(await page.text('#map-scope'), /‘금융’ 주제 전체의 지도예요/);
  assert.equal(await page.text('#start-list .pick-topic'), '금융 › 단기자금');
  let st = await startState(page);
  assert.deepEqual([st.label, st.disabled, st.count, st.total, st.checked, st.meta], ['이 개념으로 지도 만들기', true, '0개 선택', 3, 0, ''], '아무것도 고르기 전: 비활성, 지도 상태 줄 없음');
  assert.equal(st.hint, '개념을 2개 이상 선택해 주세요');
  assert.ok(await page.eval("[...document.querySelectorAll('#start-list .pick-row')].every(r => r.getBoundingClientRect().height >= 44)"), '체크 줄 터치 44px 이상');
  assert.ok(await page.eval("document.getElementById('map-open').getBoundingClientRect().height >= 44"));
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), false, '탭만 눌러서는 시트가 열리지 않음');
  // 1개: 여전히 비활성
  await page.click('#start-list .pick-row:nth-of-type(1)');
  st = await startState(page);
  assert.deepEqual([st.disabled, st.count, st.hint], [true, '1개 선택', '개념을 2개 이상 선택해 주세요']);
  // 2개: 활성
  await page.click('#start-list .pick-row:nth-of-type(2)');
  st = await startState(page);
  assert.deepEqual([st.disabled, st.count, st.hint], [false, '2개 선택', null]);
  const picked = await page.eval("[...document.querySelectorAll('#start-list input')].filter(i => i.checked).map(i => Number(i.dataset.id))");
  await page.click('#map-open');
  await page.waitFor("document.getElementById('map-sheet').open", 6000, '지도 시트');
  await page.waitFor(`document.querySelectorAll('[data-node]').length === 2`, 4000, '노드 2개');
  assert.deepEqual((await page.eval('window.CmapMap._state()')).nodes.map(n => n.id).sort((a, b) => a - b), picked.sort((a, b) => a - b), '선택한 개념이 노드로 올라가 있음');
  assert.equal(srv.db.nodes.length, 2);
  assert.equal(await page.eval("document.getElementById('map-sheet').classList.contains('ro')"), false, '편집 시트');
  // 시트 안 [개념 선택]도 같은 상태(체크 2개)
  await page.click('#map-pick-toggle');
  assert.equal(await page.eval("[...document.querySelectorAll('#map-pick-list input')].filter(i => i.checked).length"), 2);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('이미 지도가 있으면: 상태 한 줄 "저장됨 · 개념 N개 · 연결 M개", 올라간 개념이 체크된 채 시작, 주 버튼 [지도 열기]. 체크를 바꾸면 [선택한 개념으로 지도 열기], 연결 있는 노드를 내리면 기존 확인 창', { skip: SKIP, timeout: 90000 }, async t => {
  const { srv, page } = await open(t);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (const term of ['힘', '가속도', '질량', '에너지']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  for (const id of ids.slice(0, 3)) await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[1], label: '만든다' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await toMapTab(page);
  let st = await startState(page);
  assert.deepEqual([st.label, st.disabled, st.count, st.checked, st.total, st.meta], ['지도 열기', false, '3개 선택', 3, 4, '저장됨 · 개념 3개 · 연결 1개']);
  // 4번째를 더 체크 → 라벨이 바뀜(저장 상태는 시트를 열어 바뀐 뒤에 달라짐)
  await page.click(`#start-pick-${ids[3]}`);
  st = await startState(page);
  assert.deepEqual([st.label, st.disabled, st.count], ['선택한 개념으로 지도 열기', false, '4개 선택']);
  await page.click(`#start-pick-${ids[3]}`);                                    // 되돌리면 다시 [지도 열기]
  assert.equal((await startState(page)).label, '지도 열기');
  // 연결 있는 노드(힘)를 빼고 열기 → 기존 확인 창이 뜨고, 취소하면 지도 그대로·시트 안 열림
  await page.click(`#start-pick-${ids[0]}`);
  assert.equal((await startState(page)).label, '선택한 개념으로 지도 열기');
  await page.click('#map-open');
  await page.waitFor("document.getElementById('confirm-dlg').open", 4000, '기존 확인 창');
  assert.match(await page.text('#confirm-text'), /이어진 연결 1개도 함께 지워집니다/);
  await page.click('#confirm-cancel');
  await page.waitFor("!document.getElementById('confirm-dlg').open", 3000);
  await sleep(300);
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), false, '취소하면 시트를 열지 않음');
  assert.equal(srv.db.nodes.length, 3, '취소하면 지도 그대로'); assert.equal(srv.db.edges.length, 1);
  assert.match(await page.text('#start-note'), /올리지 못했어요/);
  st = await startState(page);
  assert.deepEqual([st.label, st.count, st.checked], ['지도 열기', '3개 선택', 3], '취소하면 선택이 지도의 현재 상태로 돌아감');
  // 이번에는 다시 빼고 확인 → 노드·연결 정리, 시트 열림
  await page.click(`#start-pick-${ids[0]}`);
  await page.click('#map-open');
  await page.waitFor("document.getElementById('confirm-dlg').open", 4000);
  await page.click('#confirm-ok');
  await page.waitFor("document.getElementById('map-sheet').open", 6000, '시트');
  assert.equal(srv.db.nodes.length, 2); assert.equal(srv.db.edges.length, 0);
  assert.ok(['changed', 'unsaved'].includes((await page.eval('window.CmapMap.status()')).save_status), '저장 후 변경됨 표시');
  // 시트를 닫으면 첫 화면이 현재 지도로 갱신되고 포커스가 주 버튼으로 돌아온다
  await page.click('#map-sheet-close');
  await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  st = await startState(page);
  assert.deepEqual([st.label, st.count, st.checked], ['지도 열기', '2개 선택', 2]);
  assert.match(st.meta, /^저장 후 변경됨 · 개념 2개 · 연결 0개$/);
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'map-open');
  noErrors(page);
});

test('저장된 개념이 0개면 "저장된 개념이 없어요. 먼저 개념을 추가해 주세요"와 [주제로 가기](주제 안 화면으로 이동)만 보인다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '비어 있음' })).topic;
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await toMapTab(page);
  assert.equal(await page.text('#start-empty'), '저장된 개념이 없어요. 먼저 개념을 추가해 주세요');
  assert.equal(await page.count('#start-list'), 0); assert.equal(await page.count('#map-open'), 0, '지도 열기 단독 버튼 없음');
  assert.equal(await page.text('#map-meta'), '', '"개념 0개 · 연결 0개 · 저장 안 됨" 첫 상태는 없어짐');
  assert.ok(await page.eval("document.getElementById('map-go-topic').getBoundingClientRect().height >= 44"));
  await page.click('#map-go-topic');
  await page.waitFor("S.view === 'topic' && !document.getElementById('topic-view').hidden", 4000, '주제 안 화면');
  assert.equal(await page.text('#path-line'), '비어 있음');
  assert.equal(await page.eval("document.getElementById('explain-form').hidden"), false, '입력 바가 보임');
  noErrors(page);
});

test('한 모듈의 오류가 내비를 막지 않는다: 퀴즈 화면의 이탈 확인 함수가 예외를 던져도 다른 탭이 열리고 오류는 console.error 로 남는다(옛 JS + 새 HTML 상황 대비)', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term: '힘' });
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.eval(`window.__errs = []; const orig = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(' ')); }; window.CmapAnswer.busyText = undefined; window.CmapReview.quizActive = () => { throw new Error('boom'); }; 0`);
  await page.click('#nav-quiz');
  await page.waitFor("S.view === 'quiz' && !document.getElementById('quiz-view').hidden", 6000, '퀴즈 탭이 열림');
  await page.click('#nav-map');
  await page.waitFor("S.view === 'map' && !document.getElementById('mapmk-view').hidden", 6000, '지도 만들기 탭이 열림');
  await page.click('#nav-topic');
  await page.waitFor("S.view === 'landing'", 4000);
  assert.ok((await page.eval('window.__errs')).length >= 1, '오류는 console.error 로 남음');
});

test('빠른 연속 탭: [지도 만들기] 직후 [퀴즈]를 곧바로 눌러도 지도 읽기가 끝난 뒤 모드가 퀴즈(review)로 맞춰진다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term: '힘' });
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.eval("Nav.goTab('map'); Nav.goTab('quiz'); 0");
  await page.waitFor("S.view === 'quiz' && !document.getElementById('map-view').hidden", 6000, '퀴즈 화면');
  await sleep(300);
  assert.equal(await page.eval('window.CmapMap._state().mode'), 'review');
  assert.equal(await page.count('#review-panel .qcard'), 3);
  // 지도 만들기 → 지도 만들기 연속도 정상(첫 화면이 그려짐)
  await page.eval("Nav.goTab('map'); Nav.goTab('map'); 0");
  await page.waitFor("!document.getElementById('mapmk-view').hidden && !!document.getElementById('start-list')", 6000);
  noErrors(page);
});

test('지도 읽기에 실패하면 안내와 [다시 시도]가 보이고 누르면 다시 읽는다(조용히 무시하지 않음)', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term: '힘' });
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.eval("window.__realFetch = window.fetch; window.fetch = (u, o) => (String(u).includes('/map') && !String(u).includes('/maps/') ? Promise.reject(new TypeError('offline')) : window.__realFetch(u, o)); 0");
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('map-view').hidden && !document.getElementById('map-retry-row').hidden", 6000, '다시 시도 표시');
  assert.ok((await page.text('#map-load-msg')).length > 0, '실패 안내');
  assert.equal(await page.eval("document.getElementById('mapmk-view').hidden"), true);
  await page.eval('window.fetch = window.__realFetch; 0');
  await page.click('#map-retry');
  await page.waitFor("!document.getElementById('mapmk-view').hidden && !!document.getElementById('start-list')", 6000, '다시 읽음');
  assert.equal(await page.eval("document.getElementById('map-retry-row').hidden"), true);
  assert.equal(await page.eval("document.getElementById('map-load-msg').textContent"), '');
  noErrors(page);
});
