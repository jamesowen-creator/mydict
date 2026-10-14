// 작업273-1: 개념 지도 화면 — 개념 검색 → AI 설명 카드(읽고 고치고 저장) / 다시 설명 / 취소 / 이미 있는 개념 / 오류·시간 초과·한도 / 저장된 설명 보기·수정.
// AI 는 모의(실제 호출 없음): srv.anthropic.handler. 서버는 실제 routes/concept_map.js + 가짜 DB(tests/helpers/cmap_db.js)이며 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_explain.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

// 274-2: AI 응답·새 저장 형태 = 개념학습과 같은 4항목(정의·예시·쉬운 설명·더 깊게 설명). OLD 는 273-1 에서 저장한 옛 4항목 형태(호환 확인용)
const GOOD = {
  english: 'acceleration',
  definition: '속도가 시간에 따라 변하는 정도를 나타내는 양입니다.',
  example: '출발하는 버스가 점점 빨라질 때 가속도가 있습니다.',
  simple_text: '얼마나 빨리 빨라지는지를 나타내요.',
  deeper_text: '속도의 시간에 대한 변화율이며 방향도 가집니다.',
};
const OLD = {
  definition: '옛 정의입니다.',
  in_context: '옛 맥락입니다.',
  example: '옛 예입니다.',
  confusion: '옛 헷갈림입니다.',
};

async function open(t, { cap } = {}) {
  if (cap === undefined) delete process.env.CMAP_EXPLAIN_DAILY_CAP; else process.env.CMAP_EXPLAIN_DAILY_CAP = String(cap);
  const srv = await startCmapServer();
  t.after(() => srv.close());
  srv.anthropic.handler = () => JSON.stringify(GOOD);
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
// 274-2: 대화상자가 닫힌 뒤 목록이 다시 그려지는 중에 누르면 클릭이 유실되므로(요소 교체), 대화상자가 열릴 때까지 다시 누른다
async function clickUntilDialogOpen(page, sel) {
  for (let i = 0; i < 4; i++) {
    try { await page.click(sel); } catch (e) { await sleep(150); continue; }
    try { await page.waitFor("document.getElementById('concept-dlg').open", 1500); return; } catch (e) { /* 다시 시도 */ }
  }
  await page.waitFor("document.getElementById('concept-dlg').open", 3000, '개념 대화상자');
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
async function withTopic(page, title = '물리') {
  const t = (await seed(page, 'POST', '/api/cmap/topics', { title })).topic;
  await page.eval('refresh()');
  await page.eval(`selectTopic(${t.id}); 0`);
  await page.waitFor("!document.getElementById('concepts-sec').hidden", 4000);
  return t;
}
const search = async (page, term) => { await page.type('#explain-term', term); await page.click('#explain-go'); };
const waitReady = page => page.waitFor("!!document.querySelector('#explain-card [data-t=explain-save]')", 6000, '설명 카드');
const cardState = page => page.eval("(() => { const c = document.getElementById('explain-card'); return { hidden: c.hidden, loading: !!c.querySelector('[data-t=explain-loading]'), error: (c.querySelector('[data-t=explain-error]') || {}).textContent || null, retry: !!c.querySelector('[data-t=explain-retry]'), existing: !!c.querySelector('[data-t=explain-existing]'), ready: !!c.querySelector('[data-t=explain-save]') }; })()");
const rows = srv => srv.db.concepts.map(c => ({ term: c.term, english: c.english, source: c.explanation_source, ex: c.explanation }));
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);

test('설명 흐름: 검색 → 카드(4항목·영문·"AI 설명 · 확인 필요") → 그대로 저장하면 source=ai, 목록에서 설명 보기', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '가속도');
  await waitReady(page);
  assert.equal(await page.text('#explain-card [data-t=explain-label]'), 'AI 설명 · 확인 필요');
  assert.equal(await page.text('#explain-card .e-term'), '가속도');
  assert.equal(await page.text('#explain-card [data-t=explain-english-text]'), 'acceleration');
  // 275-3: 읽기 형태(저장된 설명 보기와 같은 렌더러) — 항목 이름 + 본문, 입력칸 없음
  const secs = await page.eval("[...document.querySelectorAll('#explain-card .e-sec')].map(e => [e.dataset.f, e.querySelector('.sec-label').textContent, e.querySelector('p').textContent])");
  assert.deepEqual(secs, [['definition', '정의', GOOD.definition], ['example', '예시', GOOD.example], ['simple_text', '쉬운 설명', GOOD.simple_text], ['deeper_text', '더 깊게 설명', GOOD.deeper_text]]);
  assert.equal(await page.count('#explain-card textarea'), 0, '처음에는 입력칸이 없음');
  assert.equal(await page.count('#concept-list [data-t=concept]'), 0, '저장 전에는 목록에 없음');
  assert.equal(srv.anthropic.calls.length, 1);
  await page.click('#explain-save');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 1", 4000);
  assert.equal(await page.eval("document.getElementById('explain-card').hidden"), true, '저장하면 카드가 닫힘');
  assert.equal(await page.eval("document.getElementById('explain-term').value"), '');
  assert.deepEqual(rows(srv), [{ term: '가속도', english: 'acceleration', source: 'ai', ex: { definition: GOOD.definition, example: GOOD.example, simple_text: GOOD.simple_text, deeper_text: GOOD.deeper_text } }]);
  assert.equal(await page.text('#concept-list [data-t=explanation-source]'), 'AI 설명 · 확인 필요');
  assert.equal(await page.eval("document.querySelector('#concept-list details').open"), true, '방금 저장한 개념은 설명이 펼쳐져 보임');
  assert.match(await page.text('#concept-list details .e-secs'), /속도가 시간에 따라 변하는 정도/);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('저장 전에 문구를 고치면 source=manual 로 저장되고 목록에는 "직접 쓴 설명"', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '속도');
  await waitReady(page);
  await page.click('#explain-edit');
  await page.type('#explain-f-example', '내가 고친 예');
  await page.click('#explain-done');
  assert.equal(await page.count('#explain-card textarea'), 0, '완료하면 읽기 형태로 돌아옴');
  assert.equal(await page.text('#explain-card .e-sec[data-f=example] p'), '내가 고친 예', '고친 값이 반영됨');
  await page.click('#explain-save');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 1", 4000);
  assert.equal(rows(srv)[0].source, 'manual'); assert.equal(rows(srv)[0].ex.example, '내가 고친 예');
  assert.equal(await page.text('#concept-list [data-t=explanation-source]'), '직접 쓴 설명');
  noErrors(page);
});

test('[다시 설명]은 AI 를 다시 부르고(호출 2회), [취소]는 아무것도 저장하지 않으며, 정의를 비우면 저장되지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '가속도');
  await waitReady(page);
  srv.anthropic.handler = () => JSON.stringify({ ...GOOD, definition: '두 번째 설명의 정의입니다.' });
  await page.click('[data-t=explain-again]');
  await page.waitFor("(document.querySelector('#explain-card .e-sec[data-f=definition] p') || {}).textContent === '두 번째 설명의 정의입니다.'", 6000);
  assert.equal(srv.anthropic.calls.length, 2);
  await page.click('#explain-edit');
  await page.type('#explain-f-definition', '   ');
  await page.click('#explain-done');
  assert.match(await page.text('#explain-msg'), /정의는 비워 둘 수 없습니다/);
  assert.equal(srv.db.concepts.length, 0, '정의가 비면 서버에 요청하지 않음');
  await page.click('[data-t=explain-cancel]');
  assert.equal(await page.count('#explain-card textarea'), 0, '취소하면 읽기 형태로 돌아옴');
  assert.equal(await page.text('#explain-card .e-sec[data-f=definition] p'), '두 번째 설명의 정의입니다.', '취소하면 수정 전 값');
  await page.click('[data-t=explain-close]');
  assert.equal((await cardState(page)).hidden, true);
  assert.equal(srv.db.concepts.length, 0, '취소하면 저장되지 않음');
  noErrors(page);
});

test('이미 있는 개념: AI 를 부르지 않고 기존 개념을 강조해 보여 준다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: 'Force', explanation: GOOD, explanation_source: 'ai' });
  await page.eval('refresh()');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 1", 4000);
  await search(page, ' force ');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-existing]')", 4000, '기존 개념 안내');
  assert.equal(srv.anthropic.calls.length, 0, 'AI 호출 없음');
  assert.equal(await page.eval("document.querySelector('#concept-list [data-t=concept]').classList.contains('hl')"), true, '기존 개념 강조');
  assert.equal(await page.eval("document.querySelector('#concept-list details').open"), true);
  await page.click('[data-t=explain-close]');
  assert.equal((await cardState(page)).hidden, true);
  assert.equal(await page.eval("document.querySelector('#concept-list [data-t=concept]').classList.contains('hl')"), false);
  noErrors(page);
});

test('AI 실패: 오류 카드 + [다시 시도], 자동 재시도 없음(호출 1회), 누르면 정상 설명. 검증 실패(형식 오류)도 같은 카드', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  srv.anthropic.handler = () => { throw new Error('upstream down'); };
  await search(page, '가속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]')", 6000, '오류 카드');
  assert.match(await page.text('[data-t=explain-error]'), /설명을 가져오지 못했습니다/);
  assert.equal((await cardState(page)).retry, true);
  await sleep(900);
  assert.equal(srv.anthropic.calls.length, 1, '자동 재시도 없음');
  // 검증 실패(정의 없음)
  srv.anthropic.handler = () => JSON.stringify({ in_context: '맥락만' });
  await page.click('[data-t=explain-retry]');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]') && !document.querySelector('#explain-card [data-t=explain-loading]')", 6000, '검증 실패 오류 카드');
  assert.equal(srv.anthropic.calls.length, 2);
  assert.equal(srv.db.concepts.length, 0, '실패한 설명은 저장되지 않음');
  srv.anthropic.handler = () => JSON.stringify(GOOD);
  await page.click('[data-t=explain-retry]');
  await waitReady(page);
  assert.equal(srv.anthropic.calls.length, 3);
  noErrors(page);
});

test('40초 제한(테스트에서는 window.__CMAP_AI_TIMEOUT_MS 로 짧게): 시간 초과 시 오류 카드 + 다시 시도, 늦게 온 응답은 무시', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await page.eval('window.__CMAP_AI_TIMEOUT_MS = 500; 0');
  srv.anthropic.handler = async () => { await sleep(1500); return JSON.stringify(GOOD); };
  await search(page, '가속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]')", 4000, '시간 초과 카드');
  assert.match(await page.text('[data-t=explain-error]'), /늦어지고/);
  assert.equal((await cardState(page)).retry, true);
  await sleep(1400);                                                     // 서버 응답이 뒤늦게 끝난 뒤에도 카드는 오류 상태 그대로
  assert.equal((await cardState(page)).ready, false);
  assert.equal(srv.db.concepts.length, 0);
  srv.anthropic.handler = () => JSON.stringify(GOOD);
  await page.click('[data-t=explain-retry]');
  await waitReady(page);
  noErrors(page);
});

test('하루 한도: 한도를 넘으면 429 안내만(다시 시도 버튼 없음)', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t, { cap: 1 });
  await withTopic(page);
  await search(page, '가속도');
  await waitReady(page);
  await page.click('[data-t=explain-close]');
  await search(page, '속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]')", 6000);
  assert.match(await page.text('[data-t=explain-error]'), /하루 1건/);
  assert.equal((await cardState(page)).retry, false, '한도 초과는 다시 시도 버튼이 없다');
  assert.equal(srv.anthropic.calls.length, 1);
  noErrors(page);
});

test('설명을 기다리는 중 다른 주제를 고르면 카드가 닫히고 늦은 응답은 화면에 나오지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page, '물리');
  const other = (await seed(page, 'POST', '/api/cmap/topics', { title: '화학' })).topic;
  await page.eval('refresh()');
  srv.anthropic.handler = async () => { await sleep(800); return JSON.stringify(GOOD); };
  const first = await page.eval("S.topics.find(t => t.title === '물리').id");
  await page.eval(`selectTopic(${first}); 0`);
  await search(page, '가속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-loading]')", 3000);
  await page.eval(`selectTopic(${other.id}); 0`);
  assert.equal((await cardState(page)).hidden, true, '주제를 바꾸면 카드가 닫힘');
  await sleep(1200);
  assert.equal((await cardState(page)).hidden, true, '늦은 응답이 다른 주제 화면에 나오지 않음');
  assert.equal(srv.db.concepts.length, 0);
  noErrors(page);
});

test('저장 때 같은 이름이 이미 생겼으면 카드 안에 오류를 보이고 카드를 열어 둔다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  await search(page, '가속도');
  await waitReady(page);
  await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '가속도' });   // 다른 곳에서 먼저 만들어짐
  await page.click('#explain-save');
  await page.waitFor("document.getElementById('explain-msg').textContent.length > 0", 4000);
  assert.match(await page.text('#explain-msg'), /이미 있습니다/);
  assert.equal((await cardState(page)).ready, true);
  assert.equal(srv.db.concepts.length, 1);
  noErrors(page);
});

test('개념 대화상자의 설명 입력·수정: 직접 쓴 설명은 manual, AI 설명은 그대로 두면 ai 유지·고치면 manual, 모두 비우면 설명이 지워진다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  // 직접 입력
  await page.click('#add-concept-btn');
  await page.waitFor("document.getElementById('concept-dlg').open", 3000);
  await page.type('#concept-term', '질량');
  await page.type('#concept-ex-example', '정의 없이 예만');
  await page.click('#concept-ok');
  assert.match(await page.text('#concept-msg'), /정의를 먼저 입력/);
  await page.type('#concept-ex-definition', '물체가 가진 물질의 양');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.equal(rows(srv)[0].source, 'manual'); assert.equal(rows(srv)[0].ex.definition, '물체가 가진 물질의 양');
  // AI 설명 개념: 메모만 고치면 ai 유지
  const ai = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '가속도', explanation: GOOD, explanation_source: 'ai' })).concept;
  await page.eval('refresh()');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 2", 4000);
  const editBtn = term => `#concept-list [data-t=concept][data-id="${ai.id}"] [data-t=concept-edit]`;
  await clickUntilDialogOpen(page, editBtn());
  assert.equal(await page.eval("document.getElementById('concept-ex-definition').value"), GOOD.definition);
  await page.type('#concept-memo', '메모만 추가');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.equal(srv.db.concepts.find(c => c.id === ai.id).explanation_source, 'ai', '설명을 건드리지 않으면 AI 설명 표시 유지');
  await page.waitFor(`(document.querySelector('#concept-list [data-id="${ai.id}"] .c-memo') || {}).textContent === '메모만 추가'`, 4000, '목록 갱신(메모)');
  // 설명 고치면 manual
  await clickUntilDialogOpen(page, editBtn());
  await page.type('#concept-ex-deeper_text', '내가 고친 문장');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.equal(srv.db.concepts.find(c => c.id === ai.id).explanation_source, 'manual');
  await page.waitFor(`(document.querySelector('#concept-list [data-id="${ai.id}"] [data-t=explanation-source]') || {}).textContent === '직접 쓴 설명'`, 4000, '목록 갱신(출처)');
  // 모두 비우면 설명 삭제
  await clickUntilDialogOpen(page, editBtn());
  for (const k of ['definition', 'example', 'simple_text', 'deeper_text']) await page.type('#concept-ex-' + k, '');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.equal(srv.db.concepts.find(c => c.id === ai.id).explanation, null);
  await page.waitFor(`!document.querySelector('#concept-list [data-id="${ai.id}"] details')`, 4000);
  noErrors(page);
});

test('설명 표시(274-2): 개념학습과 같은 항목·순서(정의·예시·쉬운 설명·더 깊게 설명), 예시는 인용 스타일, 옛 4항목 형태는 읽을 수 있는 항목만 표시되고 고쳐도 사라지지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  const nw = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '신형', explanation: { definition: GOOD.definition, deeper_text: GOOD.deeper_text }, explanation_source: 'ai' })).concept;
  const full = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '전체', explanation: GOOD, explanation_source: 'ai' })).concept;
  const old = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '구형', explanation: OLD, explanation_source: 'ai' })).concept;
  await page.eval('refresh()');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 3", 4000);
  const view = id => page.eval(`[...document.querySelectorAll('#concept-list [data-id="${id}"] .e-sec')].map(e => [e.dataset.f, e.querySelector('.sec-label').textContent, e.classList.contains('quote'), e.querySelector('p').textContent])`);
  assert.deepEqual(await view(full.id), [['definition', '정의', false, GOOD.definition], ['example', '예시', true, GOOD.example], ['simple_text', '쉬운 설명', false, GOOD.simple_text], ['deeper_text', '더 깊게 설명', false, GOOD.deeper_text]]);
  assert.deepEqual((await view(nw.id)).map(x => x[0]), ['definition', 'deeper_text'], '비어 있는 항목은 표시하지 않음');
  assert.deepEqual(await view(old.id), [['definition', '정의', false, OLD.definition], ['example', '예시', true, OLD.example], ['in_context', '이 주제에서의 의미', false, OLD.in_context], ['confusion', '헷갈리기 쉬운 점', false, OLD.confusion]], '옛 형태: 읽을 수 있는 항목만, 옛 항목은 뒤에');
  // 대화상자: 옛 항목 입력칸은 값이 있는 개념에서만 보이고, 메모만 고쳐도 설명(옛 항목 포함)은 그대로 남는다
  await clickUntilDialogOpen(page, `#concept-list [data-t=concept][data-id="${old.id}"] [data-t=concept-edit]`);
  assert.equal(await page.eval("document.getElementById('concept-legacy-in_context').hidden || document.getElementById('concept-legacy-confusion').hidden"), false);
  assert.equal(await page.eval("document.getElementById('concept-ex-in_context').value"), OLD.in_context);
  await page.type('#concept-memo', '메모');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.deepEqual(srv.db.concepts.find(c => c.id === old.id).explanation, OLD, '옛 형태 설명은 그대로');
  assert.equal(srv.db.concepts.find(c => c.id === old.id).explanation_source, 'ai');
  await page.waitFor(`(document.querySelector('#concept-list [data-id="${old.id}"] .c-memo') || {}).textContent === '메모'`, 4000);
  await clickUntilDialogOpen(page, `#concept-list [data-t=concept][data-id="${nw.id}"] [data-t=concept-edit]`);
  assert.equal(await page.eval("document.getElementById('concept-legacy-in_context').hidden && document.getElementById('concept-legacy-confusion').hidden"), true, '새 형태 개념에는 옛 항목 입력칸이 없음');
});

test('설명 카드(275-3): 처음에는 입력칸이 0개, [수정]이면 입력칸 4개(영문 포함)가 카드 안에 나타나고 [취소]하면 다시 0개, [완료] 뒤 [저장]하면 고친 값이 manual 로 저장·표시된다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '가속도');
  await waitReady(page);
  const inputs = () => page.eval("document.querySelectorAll('#explain-card textarea, #explain-card input').length");
  assert.equal(await inputs(), 0, '① 처음에는 textarea·input 이 없음');
  assert.equal(await page.eval("document.querySelectorAll('textarea').length === document.querySelectorAll('#concept-dlg textarea').length"), true, '화면의 textarea 는 대화상자 것뿐');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#explain-card .btn-row button')].map(b => b.textContent)"), ['닫기', '다시 설명', '수정', '저장'], '읽기 형태의 버튼(텍스트 버튼)');
  assert.equal(await page.eval("[...document.querySelectorAll('#explain-card .btn-row button')].every(b => getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)' && b.getBoundingClientRect().height >= 44)"), true, '텍스트 버튼·44px 이상');
  // ② 수정 → 입력칸 4개 + 영문
  await page.click('#explain-edit');
  assert.equal(await page.count('#explain-card textarea'), 4);
  assert.equal(await page.eval("document.getElementById('explain-english').value"), 'acceleration');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#explain-card [data-t=explain-field]')].map(t => [t.dataset.k, t.value])"), [['definition', GOOD.definition], ['example', GOOD.example], ['simple_text', GOOD.simple_text], ['deeper_text', GOOD.deeper_text]]);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#explain-card .btn-row button')].map(b => b.textContent)"), ['취소', '완료']);
  await page.type('#explain-f-simple_text', '취소할 수정');
  await page.click('[data-t=explain-cancel]');
  assert.equal(await inputs(), 0, '② 취소하면 다시 0개');
  assert.equal(await page.text('#explain-card .e-sec[data-f=simple_text] p'), GOOD.simple_text, '취소하면 수정 전 값');
  // ③ 수정 → 완료 → 저장
  await page.click('#explain-edit');
  await page.type('#explain-f-deeper_text', '저장할 수정 문장');
  await page.type('#explain-english', 'inertia');
  await page.click('#explain-done');
  assert.equal(await inputs(), 0, '③ 완료하면 읽기 형태로 복귀');
  assert.equal(await page.text('#explain-card .e-sec[data-f=deeper_text] p'), '저장할 수정 문장');
  assert.equal(await page.text('#explain-card [data-t=explain-english-text]'), 'inertia');
  assert.equal(srv.db.concepts.length, 0, '완료만으로는 저장되지 않음');
  await page.click('#explain-save');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 1", 4000);
  assert.equal(rows(srv)[0].source, 'manual'); assert.equal(rows(srv)[0].english, 'inertia'); assert.equal(rows(srv)[0].ex.deeper_text, '저장할 수정 문장');
  assert.equal(await page.text('#concept-list details .e-sec[data-f=deeper_text] p'), '저장할 수정 문장', '목록의 설명 보기에도 반영');
  assert.equal(await page.eval("document.getElementById('explain-card').hidden"), true);
  noErrors(page);
});
