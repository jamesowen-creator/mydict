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

const GOOD = {
  english: 'acceleration',
  definition: '속도가 시간에 따라 변하는 정도를 나타내는 양입니다.',
  in_context: '역학에서 힘이 물체의 운동을 어떻게 바꾸는지 설명할 때 쓰입니다.',
  example: '출발하는 버스가 점점 빨라질 때 가속도가 있습니다.',
  confusion: '속도와 달리 빨라지는 정도를 뜻합니다.',
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
  assert.equal(await page.eval("document.getElementById('explain-english').value"), 'acceleration');
  const vals = await page.eval("[...document.querySelectorAll('#explain-card [data-t=explain-field]')].map(t => [t.dataset.k, t.value])");
  assert.deepEqual(vals, [['definition', GOOD.definition], ['in_context', GOOD.in_context], ['example', GOOD.example], ['confusion', GOOD.confusion]]);
  assert.equal(await page.count('#concept-list [data-t=concept]'), 0, '저장 전에는 목록에 없음');
  assert.equal(srv.anthropic.calls.length, 1);
  await page.click('#explain-save');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 1", 4000);
  assert.equal(await page.eval("document.getElementById('explain-card').hidden"), true, '저장하면 카드가 닫힘');
  assert.equal(await page.eval("document.getElementById('explain-term').value"), '');
  assert.deepEqual(rows(srv), [{ term: '가속도', english: 'acceleration', source: 'ai', ex: { definition: GOOD.definition, in_context: GOOD.in_context, example: GOOD.example, confusion: GOOD.confusion } }]);
  assert.equal(await page.text('#concept-list [data-t=explanation-source]'), 'AI 설명 · 확인 필요');
  assert.equal(await page.eval("document.querySelector('#concept-list details').open"), true, '방금 저장한 개념은 설명이 펼쳐져 보임');
  assert.match(await page.text('#concept-list details dl'), /속도가 시간에 따라 변하는 정도/);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('저장 전에 문구를 고치면 source=manual 로 저장되고 목록에는 "직접 쓴 설명"', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '속도');
  await waitReady(page);
  await page.type('#explain-f-example', '내가 고친 예');
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
  await page.waitFor("document.getElementById('explain-f-definition') && document.getElementById('explain-f-definition').value === '두 번째 설명의 정의입니다.'", 6000);
  assert.equal(srv.anthropic.calls.length, 2);
  await page.type('#explain-f-definition', '   ');
  await page.click('#explain-save');
  assert.match(await page.text('#explain-msg'), /정의는 비워 둘 수 없습니다/);
  assert.equal(srv.db.concepts.length, 0, '정의가 비면 서버에 요청하지 않음');
  await page.click('[data-t=explain-cancel]');
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
  await page.click('[data-t=explain-cancel]');
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
  await page.click(editBtn());
  await page.waitFor("document.getElementById('concept-dlg').open", 3000);
  assert.equal(await page.eval("document.getElementById('concept-ex-definition').value"), GOOD.definition);
  await page.type('#concept-memo', '메모만 추가');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.equal(srv.db.concepts.find(c => c.id === ai.id).explanation_source, 'ai', '설명을 건드리지 않으면 AI 설명 표시 유지');
  // 설명 고치면 manual
  await page.click(editBtn());
  await page.waitFor("document.getElementById('concept-dlg').open", 3000);
  await page.type('#concept-ex-confusion', '내가 고친 문장');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.equal(srv.db.concepts.find(c => c.id === ai.id).explanation_source, 'manual');
  // 모두 비우면 설명 삭제
  await page.click(editBtn());
  await page.waitFor("document.getElementById('concept-dlg').open", 3000);
  for (const k of ['definition', 'in_context', 'example', 'confusion']) await page.type('#concept-ex-' + k, '');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  assert.equal(srv.db.concepts.find(c => c.id === ai.id).explanation, null);
  await page.waitFor(`!document.querySelector('#concept-list [data-id="${ai.id}"] details')`, 4000);
  noErrors(page);
});
