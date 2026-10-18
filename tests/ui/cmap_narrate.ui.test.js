// 작업273-4: 개념 지도 화면의 "해설" 탭 — 저장 안 된 지도 안내, 해설 만들기(이야기체 단락·요약·기억용·제안), 단락을 누르면 지도에서 개념 강조, 제안([찾아보기]·[지도에 추가하러 가기])은 자동 추가 없음,
// 지도가 바뀌면 이전 해설 + "지도가 바뀌었습니다" + [다시 만들기], 오류 카드(자동 재시도 없음)·40초 제한(테스트에서는 짧게)·하루 한도 안내, 390px 레이아웃.
// AI 는 모의(실제 호출 없음): srv.anthropic.handler. 서버는 실제 routes/concept_map.js + 가짜 DB 이며 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_narrate.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { tabIn } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
// 274-4: 지도는 시트(<dialog>) 안에 있다. 지도 조작 전에 [지도 열기]로 시트를 열고, 주제 화면으로 가기 전·다른 탭으로 가기 전에 닫는다
// 283-2: [만들기] 첫 화면의 주 버튼(#map-open)은 개념을 2개 이상 고르기 전에는 비활성이므로, 빈 지도에서 시트를 바로 열 때는 CmapMap.openSheet() 를 쓴다
const openSheet = async page => { await page.eval("(() => { const b = document.getElementById('map-open'); if (b && !b.disabled) b.click(); else window.CmapMap.openSheet(); })()"); await page.waitFor("document.getElementById('map-sheet').open", 4000, '지도 시트'); };
const closeSheet = async page => { await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000, '지도 시트 닫힘'); };
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
// 과학 > 물리. 지도: 힘·가속도·질량·에너지(고립), 연결 2개. 저장된 개념 중 지도에 없는 것: 속도(물리)
async function world(page) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const phys = (await seed(page, 'POST', '/api/cmap/topics', { title: '물리', parent_id: sci.id })).topic;
  const c = {};
  for (const [k, topic, term] of [['force', sci, '힘'], ['acc', sci, '가속도'], ['mass', sci, '질량'], ['iso', phys, '에너지'], ['vel', phys, '속도']]) c[k] = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term })).concept.id;
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  const at = { force: [150, 20], acc: [20, 140], mass: [280, 140], iso: [150, 260] };
  for (const k of Object.keys(at)) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: c[k] }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${c[k]}`, { x: at[k][0], y: at[k][1] }); }
  const e1 = (await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: c.force, to_concept_id: c.acc, label: '힘이 가속도를 만든다', relation_type: '종류' })).edge;
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: c.mass, to_concept_id: c.force, label: '질량이 클수록 힘이 필요', relation_type: '일부' });
  await page.eval('refresh()');
  await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor("!document.getElementById('concepts-sec').hidden", 4000);
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000, '지도 화면');
  return { sci, phys, c, map, e1 };
}
const good = (w, over = {}) => ({
  summary: '힘이 가속도를 일으키고, 질량이 그 정도를 정합니다.',
  story: [
    { text: '먼저 힘은 물체의 운동을 바꾸는 원인입니다. 그래서 힘이 가속도를 만듭니다. 이어서 질량이 클수록 힘이 더 필요합니다.', concept_ids: [w.c.force, w.c.acc, w.c.mass] },
    { text: '한편 에너지는 다른 개념과 이어지지 않은 채 따로 있습니다.', concept_ids: [w.c.iso] },
  ],
  mnemonic: ['힘은 가속도를 만들고 질량은 브레이크'],
  suggestions: [
    { term: '운동량', reason: '질량과 속도를 곱한 양이라 힘과 이어집니다', near_concept_id: w.c.mass },
    { term: '속도', reason: '가속도가 바꾸는 대상입니다', near_concept_id: w.c.acc },
  ],
  ...over,
});
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const saveMap = async page => { await tabIn(page, 'map'); await openSheet(page); await page.click('#map-save'); await page.waitFor("document.getElementById('map-save-state').textContent.startsWith('저장됨')", 4000, '저장됨'); await closeSheet(page); };
// 274-2: 해설 목록 조회(GET)가 끝난 표시(오늘 N/10건)까지 기다린 뒤 누른다. 조회가 끝나기 전에 누르면 늦게 온 응답과 엇갈린다
const narrTab = async page => { await tabIn(page, 'narr'); await page.waitFor("document.getElementById('map-view').classList.contains('narr-mode') && !!document.getElementById('narr-daily') && (!!document.getElementById('narr-make') || !!document.getElementById('narr-summary'))", 8000, '해설 탭'); };

test('저장 안 된 지도(285-1): 해설 탭에 [지도 저장하고 해설 만들기]가 보이고 안내 문구가 동작에 맞다(누르기 전에는 AI 호출 없음)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  await world(page);
  await narrTab(page);
  assert.equal(await page.eval("document.getElementById('narr-make').disabled"), false);
  assert.equal(await text(page, '#narr-make'), '지도 저장하고 해설 만들기');
  assert.match(await text(page, '#narr-empty'), /저장하고 이어서 해설을 만들 수 있어요/);
  assert.ok(!/지도 탭/.test(await text(page, '#narr-panel')), '옛 "지도 탭" 문구 없음');
  assert.equal(srv.anthropic.calls.length, 0);
});

test('해설 만들기: AI 설명 · 확인 필요 표시, 요약이 맨 위, 단락 → 기억용 → 제안 순서, 개념 이름이 단락에 표시된다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = () => JSON.stringify(good(w));
  await saveMap(page);
  await narrTab(page);
  assert.equal(await page.eval("document.getElementById('narr-make').disabled"), false);
  await page.click('#narr-make');
  await page.waitFor("!!document.getElementById('narr-summary')", 15000, '해설 표시');
  assert.equal(srv.anthropic.calls.length, 1);
  const order = await page.eval(`(() => { const p = document.getElementById('narr-panel'); const q = s => { const e = p.querySelector(s); return e ? [...p.querySelectorAll('*')].indexOf(e) : -1; }; return [q('.sec-label'), q('#narr-summary'), q('.narr-para'), q('#narr-mnemonic'), q('#narr-sugs')]; })()`);
  assert.ok(order.every(n => n >= 0) && order.every((n, i) => i === 0 || n > order[i - 1]), JSON.stringify(order));
  assert.equal((await text(page, '#narr-panel .sec-label')), 'AI 설명 · 확인 필요');
  assert.equal(await text(page, '#narr-summary'), good(w).summary);
  assert.equal(await page.eval("document.querySelectorAll('.narr-para').length"), 2);
  assert.match(await text(page, '.narr-para .narr-cap'), /힘 · 가속도 · 질량/);
  assert.match(await text(page, '#narr-mnemonic'), /브레이크/);
  assert.match(await text(page, '#narr-daily'), /1\/10건/);
  assert.equal(await page.hasHorizontalScroll(), false);
});

test('단락을 누르면 그 단락의 개념이 지도에서 강조되고, 다시 누르면 해제, 해설 탭에서는 노드를 눌러도 선택되지 않는다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = () => JSON.stringify(good(w));
  await saveMap(page); await narrTab(page);
  await page.click('#narr-make'); await page.waitFor("!!document.getElementById('narr-summary')", 15000);
  const hl = () => page.eval('window.CmapMap._highlight()');
  assert.deepEqual(await hl(), []);
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), false, '해설 탭에서는 지도 시트가 닫혀 있음(지도는 페이지에 없음)');
  await page.click('[data-para="0"] [data-act=show-map]');                       // 274-4: 단락의 [지도에서 보기] → 시트가 열리고 그 단락의 개념이 강조됨
  await page.waitFor("document.getElementById('map-sheet').open", 4000, '지도 시트');
  assert.deepEqual(await hl(), [w.c.force, w.c.acc, w.c.mass].sort((a, b) => a - b));
  assert.equal(await page.eval("document.querySelectorAll('.m-node.hl').length"), 3);
  assert.equal(await page.eval("document.querySelectorAll('.m-node.dim').length"), 1);
  assert.equal(await page.eval("document.getElementById('map-sheet').classList.contains('ro')"), true, '해설에서 여는 시트는 읽기 전용');
  assert.equal(await page.eval("['map-pick-toggle', 'map-save', 'map-opt'].every(id => document.getElementById(id).getBoundingClientRect().width === 0)"), true, '편집 도구는 숨겨짐');
  await sleep(300);   // 285-1: 읽기 전용 안내 줄이 생겨 시트 레이아웃이 자리 잡을 시간
  await page.click(`[data-node="${w.c.force}"] rect`);
  assert.equal((await page.eval('window.CmapMap._state()')).selected, null, '해설 탭에서는 연결용 선택이 되지 않음');
  await closeSheet(page);
  assert.equal(await page.eval("document.querySelector('[data-para=\"0\"]').classList.contains('sel')"), true, '선택한 단락 표시는 남음');
  await page.click('[data-para="1"] [data-act=show-map]');
  await page.waitFor("document.getElementById('map-sheet').open", 4000);
  assert.deepEqual(await hl(), [w.c.iso]);
  assert.equal(await page.eval("document.querySelectorAll('.m-node.hl').length"), 1);
  await closeSheet(page);
  // 지도 탭으로 돌아오면 강조가 사라지고 다시 선택할 수 있다
  await tabIn(page, 'map');
  assert.deepEqual(await hl(), []);
  await openSheet(page);
  assert.equal(await page.eval("document.querySelectorAll('.m-node.hl, .m-node.dim').length"), 0);
  await page.click(`[data-node="${w.c.force}"] rect`);
  assert.equal((await page.eval('window.CmapMap._state()')).selected, w.c.force);
});

test('제안: 자동으로 개념·연결을 추가하지 않는다. [찾아보기] = 검색칸에 용어만 채움, 저장된 개념 = 개념 선택 패널 안내', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = () => JSON.stringify(good(w));
  await saveMap(page); await narrTab(page);
  await page.click('#narr-make'); await page.waitFor("!!document.getElementById('narr-sugs')", 15000);
  assert.equal(await page.eval("document.querySelectorAll('.narr-sug').length"), 2);
  assert.match(await text(page, '[data-sug="0"]'), /운동량[\s\S]*질량과 속도를 곱한 양[\s\S]*가까운 개념: 질량/);
  assert.equal(await page.eval("document.querySelector('[data-sug=\"0\"] [data-act]').getAttribute('data-act')"), 'search');
  assert.equal(await page.eval("document.querySelector('[data-sug=\"1\"] [data-act]').getAttribute('data-act')"), 'guide', '속도는 이미 저장된 개념');
  assert.match(await text(page, '[data-sug="1"]'), /이미 저장된 개념/);
  const before = { nodes: srv.db.nodes.length, edges: srv.db.edges.length, concepts: srv.db.concepts.length, ai: srv.anthropic.calls.length };
  // 저장된 개념 → 지도 탭 + 개념 선택 패널 열림 + 체크는 그대로(사용자가 직접)
  await page.click('[data-sug="1"] [data-act]');
  await page.waitFor("document.getElementById('map-sheet').open && !document.getElementById('map-pick-panel').hidden", 3000, '시트 + 개념 선택 패널');
  assert.equal((await page.eval('window.CmapMap._state()')).mode, 'map');
  assert.equal(await page.eval(`document.getElementById('pick-${w.c.vel}').checked`), false);
  await closeSheet(page);
  // 찾아보기 → 주제·개념 화면의 검색칸에 용어만 채워짐
  await tabIn(page, 'narr'); await page.waitFor("!!document.getElementById('narr-sugs')", 4000);
  await page.click('[data-sug="0"] [data-act]');
  await page.waitFor("!document.getElementById('topic-view').hidden && document.getElementById('explain-term').value === '운동량'", 6000, '검색칸 채움');
  assert.deepEqual({ nodes: srv.db.nodes.length, edges: srv.db.edges.length, concepts: srv.db.concepts.length, ai: srv.anthropic.calls.length }, before, '개념·노드·연결·AI 호출 모두 그대로');
  assert.equal(await page.eval("document.getElementById('explain-card').hidden"), true, '자동 검색도 하지 않음');
});

test('지도가 바뀌면 이전 해설을 보여 주며 "지도가 바뀌었습니다"와 [다시 만들기], 저장하기 전에는 비활성, 저장 후 다시 만들면 안내가 사라진다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  let n = 0;
  srv.anthropic.handler = () => JSON.stringify(good(w, { summary: '요약 ' + (++n) }));
  await saveMap(page); await narrTab(page);
  await page.click('#narr-make'); await page.waitFor("!!document.getElementById('narr-summary')", 15000);
  assert.equal(await page.eval("!!document.getElementById('narr-stale')"), false);
  // 지도에서 연결 문구를 바꾼다(서버 직접) → 지도 화면을 다시 열면 해설은 이전 것 + 안내
  await seed(page, 'PATCH', `/api/cmap/edges/${w.e1.id}`, { label: '문구를 고침' });
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.click('#nav-map'); await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000);
  await narrTab(page);
  await page.waitFor("!!document.getElementById('narr-stale')", 4000, '지도가 바뀌었습니다');
  assert.match(await text(page, '#narr-stale'), /지도가 바뀌었습니다/);
  assert.equal(await text(page, '#narr-summary'), '요약 1', '이전 해설을 그대로 보여 줌');
  assert.equal(await page.eval("document.getElementById('narr-make').disabled"), false, '285-1: 저장하고 이어서 다시 만들 수 있음');
  assert.equal(await text(page, '#narr-make'), '지도 저장하고 다시 만들기');
  assert.match(await text(page, '#narr-stale'), /저장하고 이어서 해설을 다시 만들 수 있어요/);
  await tabIn(page, 'map'); await saveMap(page); await narrTab(page);
  assert.equal(await page.eval("document.getElementById('narr-make').disabled"), false);
  await page.click('#narr-make');
  await page.waitFor("document.getElementById('narr-summary') && document.getElementById('narr-summary').textContent === '요약 2' && !document.getElementById('narr-stale')", 15000, '새 해설');
  assert.equal(srv.anthropic.calls.length, 2);
});

test('오류 카드: AI 실패는 [다시 시도]만 있고 자동 재시도 없음, 다시 시도하면 성공', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = () => { throw new Error('upstream down'); };
  await saveMap(page); await narrTab(page);
  await page.click('#narr-make');
  await page.waitFor("!!document.getElementById('narr-error')", 15000, '오류 카드');
  assert.match(await text(page, '#narr-error'), /해설을 만들지 못했습니다/);
  await sleep(400);
  assert.equal(srv.anthropic.calls.length, 1, '자동 재시도 없음');
  srv.anthropic.handler = () => JSON.stringify(good(w));
  await page.click('#narr-retry');
  await page.waitFor("!!document.getElementById('narr-summary') && !document.getElementById('narr-error')", 15000, '다시 시도 성공');
  assert.equal(srv.anthropic.calls.length, 2);
});

test('40초 제한: 응답이 늦으면 요청을 끊고 오류 카드(+ 다시 시도)를 보인다(테스트는 0.4초로 단축)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = async () => { await sleep(1200); return JSON.stringify(good(w)); };
  await saveMap(page); await narrTab(page);
  await page.eval('window.__CMAP_AI_TIMEOUT_MS = 400; 0');
  await page.click('#narr-make');
  await page.waitFor("!!document.getElementById('narr-loading')", 3000, '만드는 중 표시');
  await page.waitFor("!!document.getElementById('narr-error')", 4000, '시간 초과 오류 카드');
  assert.match(await text(page, '#narr-error'), /늦어지고/);
  assert.equal(await page.eval("!!document.getElementById('narr-retry')"), true);
  await sleep(1200);   // 서버 쪽 모의 호출이 끝나도록 기다림(정리)
});

test('하루 한도(429): 안내만 보이고 [다시 시도] 버튼은 없다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = () => JSON.stringify(good(w));
  process.env.CMAP_NARRATE_DAILY_CAP = '1';
  t.after(() => { delete process.env.CMAP_NARRATE_DAILY_CAP; });
  await saveMap(page); await narrTab(page);
  await page.click('#narr-make'); await page.waitFor("!!document.getElementById('narr-summary')", 15000);
  await page.click('#narr-make');
  await page.waitFor("!!document.getElementById('narr-error')", 4000, '한도 안내');
  assert.match(await text(page, '#narr-error'), /하루 1건/);
  assert.equal(await page.eval("!!document.getElementById('narr-retry')"), false);
  assert.equal(srv.anthropic.calls.length, 1);
  assert.equal(await page.eval("!!document.getElementById('narr-summary')"), true, '이전 해설은 그대로 보임');
});

test('390px: 탭·[해설 만들기]·단락·제안 버튼 높이 44 이상, 가로 스크롤 없음, 해설 탭의 지도는 작게 보인다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  srv.anthropic.handler = () => JSON.stringify(good(w));
  for (const id of ['tab-map', 'tab-narr']) assert.ok(await page.eval(`document.getElementById('${id}').getBoundingClientRect().height`) >= 44, id);
  await saveMap(page); await narrTab(page);
  assert.ok(await page.eval("document.getElementById('narr-make').getBoundingClientRect().height") >= 44);
  await page.click('#narr-make'); await page.waitFor("!!document.getElementById('narr-sugs')", 15000);
  for (const sel of ['.narr-para', '[data-act]']) assert.ok(await page.eval(`Math.min(...[...document.querySelectorAll(${JSON.stringify('#narr-panel ' + sel)})].map(e => e.getBoundingClientRect().height))`) >= 44, sel);
  assert.equal(await page.eval("document.getElementById('map-canvas').offsetParent === null"), true, '지도 캔버스는 페이지에 없고(시트 안) 시트가 닫혀 있으면 보이지 않음');
  assert.equal(await page.hasHorizontalScroll(), false);
});
