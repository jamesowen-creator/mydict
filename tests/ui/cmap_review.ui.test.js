// 작업273-5: 개념 지도 화면의 연결 퀴즈(정답 간선 비노출, 탭-탭 입력, 점수 3종·틀린/놓친/지도에 없는 연결 표시, 지도가 바뀌면 채점 거부), 390px 레이아웃.
// 280-1: 예전 "복습" 탭은 하단 내비의 [퀴즈] 탭(시작 카드 3개)이 됨. 복습 탭에서 읽던 해설은 [지도 만들기] 탭의 [해설]에서 읽는다(cmap_narrate).
// 서버는 실제 routes/concept_map.js + 가짜 DB 이며 AI 는 모의(해설 만들기용만, 퀴즈는 AI 없음). 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_review.ui.test.js"   (Chrome이 없으면 건너뜀)
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
async function world(page) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const c = {};
  for (const [k, term] of [['force', '힘'], ['acc', '가속도'], ['mass', '질량'], ['iso', '에너지']]) c[k] = (await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, { term })).concept.id;
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  const at = { force: [150, 20], acc: [20, 140], mass: [280, 140], iso: [150, 260] };
  for (const k of Object.keys(at)) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: c[k] }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${c[k]}`, { x: at[k][0], y: at[k][1] }); }
  const e1 = (await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: c.force, to_concept_id: c.acc, label: '힘이 가속도를 만든다', relation_type: '종류' })).edge;
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: c.mass, to_concept_id: c.force, label: '질량이 클수록 힘이 필요', relation_type: '일부' });
  await page.eval('refresh()'); await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor("!document.getElementById('concepts-sec').hidden", 4000);
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000, '지도 화면');
  return { sci, c, map, e1 };
}
const good = w => ({
  summary: '힘이 가속도를 일으키고, 질량이 그 정도를 정합니다.',
  story: [{ text: '먼저 힘은 운동을 바꾸는 원인입니다. 그래서 가속도가 생기고, 질량이 클수록 더 큰 힘이 필요합니다.', concept_ids: [w.c.force, w.c.acc, w.c.mass] }, { text: '한편 에너지는 따로 있습니다.', concept_ids: [w.c.iso] }],
  mnemonic: ['힘은 가속도를 만들고 질량은 브레이크'],
  suggestions: [{ term: '운동량', reason: '힘과 이어지는 양입니다', near_concept_id: w.c.mass }],
});
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const saveMap = async page => { await tabIn(page, 'map'); await openSheet(page); await page.click('#map-save'); await page.waitFor("document.getElementById('map-save-state').textContent.startsWith('저장됨')", 4000, '저장됨'); await closeSheet(page); };
const reviewTab = async page => { await page.click('#nav-quiz'); await page.waitFor("!document.getElementById('quiz-view').hidden && document.getElementById('map-view').classList.contains('review-mode') && !!document.getElementById('quiz-start')", 4000, '퀴즈 탭'); };
async function makeNarration(page, srv, w) {
  srv.anthropic.handler = () => JSON.stringify(good(w));
  await tabIn(page, 'narr'); await page.waitFor("!!document.getElementById('narr-make')", 4000);
  await page.click('#narr-make'); await page.waitFor("!!document.getElementById('narr-summary')", 6000);
}
async function pairTap(page, a, b, type) {
  await page.click(`[data-node="${a}"] rect`); await page.click(`[data-node="${b}"] rect`);
  await page.waitFor("document.getElementById('quiz-dlg').open", 3000, '퀴즈 연결 대화상자');
  if (type) await page.eval(`document.getElementById('quiz-type').value = ${JSON.stringify(type)}`);
  await page.click('#quiz-add');
  await page.waitFor("!document.getElementById('quiz-dlg').open", 3000);
}

test('퀴즈 탭: 저장 안 된 지도는 [지도 저장하고 퀴즈 시작] + 안내, 카드 3개(연결 퀴즈·표시 개념 퀴즈·말로 설명하기)', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await reviewTab(page);
  assert.equal(await page.eval("document.getElementById('quiz-start').disabled"), false);
  assert.equal(await text(page, '#quiz-start'), '지도 저장하고 퀴즈 시작');
  assert.match(await text(page, '#quiz-start-note'), /저장하고 이어서 퀴즈를 시작할 수 있어요/);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#review-panel .qcard > .sec-label')].map(e => e.textContent)"), ['연결 퀴즈', '표시 개념 퀴즈', '말로 설명하기']);
  await saveMap(page); await reviewTab(page);
  assert.equal(await page.eval("document.getElementById('quiz-start').disabled"), false);
  assert.equal(await text(page, '#quiz-start'), '연결 퀴즈 시작');
  assert.equal(await page.eval("!!document.getElementById('review-no-narr') || !!document.getElementById('review-summary')"), false, '해설 본문은 퀴즈 탭에 없음(지도 만들기 탭의 해설에 있음)');
});

test('해설을 만든 뒤에도 퀴즈 탭에는 시작 카드만 있고, 해설 읽기·단락의 [지도에서 보기](읽기 전용 시트, 강조)는 해설 탭에서 된다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await saveMap(page); await makeNarration(page, srv, w);
  await reviewTab(page);
  assert.equal(await page.eval("document.querySelectorAll('#review-panel .narr-para').length"), 0, '퀴즈 탭에는 해설 단락이 없음');
  assert.equal(await page.eval("document.querySelectorAll('#review-panel .qcard').length"), 3);
  const before = srv.anthropic.calls.length;
  await tabIn(page, 'narr');
  await page.waitFor("!!document.getElementById('narr-summary')", 6000, '해설 표시');
  assert.equal(await text(page, '#narr-summary'), good(w).summary);
  await page.click('#narr-panel [data-para="1"] [data-act=show-map]');
  await page.waitFor("document.getElementById('map-sheet').open", 4000, '읽기 전용 시트');
  assert.deepEqual(await page.eval('window.CmapMap._highlight()'), [w.c.iso]);
  assert.equal(await page.eval("document.getElementById('map-sheet').classList.contains('ro')"), true);
  assert.equal(srv.anthropic.calls.length, before, '읽기만으로는 AI 를 부르지 않음');
  assert.equal((await page.eval('window.CmapMap._state()')).selected, null);
});

test('퀴즈 흐름: 정답 간선·문구가 화면에 없고, 탭-탭으로 연결을 추가·삭제, 제출하면 세 점수와 틀린·놓친·지도에 없는 연결을 따로 보여 준다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await saveMap(page); await reviewTab(page);
  await page.click('#quiz-start');
  await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode') && document.querySelectorAll('[data-node]').length === 4", 6000, '퀴즈 화면');
  assert.equal(await page.eval("document.querySelectorAll('.m-edge').length"), 0, '정답 연결선은 그리지 않음');
  const body = await page.eval("document.getElementById('map-sheet').innerText + document.getElementById('map-view').innerText");
  assert.ok(!/만든다|클수록|일으킴|사용/.test(body), '정답 문구·종류가 화면에 없음');
  // 노드는 서버 위치가 아니라 흩어 놓은 위치(지도의 저장 위치와 다름)
  // 1) 가속도 → 힘 (쌍은 맞지만 방향 반대, 종류 일으킴)
  await pairTap(page, w.c.acc, w.c.force, '종류');
  assert.equal(await page.eval("document.querySelectorAll('#quiz-answers li').length"), 1);
  assert.match(await text(page, '#quiz-answers li'), /가속도 → 힘 · 종류/);
  assert.equal(await page.eval("document.querySelectorAll('.m-edge').length"), 1);
  // 같은 쌍을 반대로 다시 이으면 거부
  await page.click(`[data-node="${w.c.force}"] rect`); await page.click(`[data-node="${w.c.acc}"] rect`);
  await page.waitFor("!!document.getElementById('quiz-error')", 3000, '중복 안내');
  assert.equal(await page.eval("document.getElementById('quiz-dlg').open"), false);
  // 2) 힘 → 에너지(지도에 없는 연결), 3) 삭제 연습: 질량 → 에너지 추가 후 삭제
  await pairTap(page, w.c.force, w.c.iso, '일부');
  await pairTap(page, w.c.mass, w.c.iso, null);
  assert.equal(await page.eval("document.querySelectorAll('#quiz-answers li').length"), 3);
  await page.click('#quiz-answers [data-del="2"]');
  assert.equal(await page.eval("document.querySelectorAll('#quiz-answers li').length"), 2);
  assert.equal(srv.db.attempts.length, 0);
  await page.click('#quiz-submit');
  await page.waitFor("!!document.getElementById('quiz-result')", 6000, '결과');
  assert.equal(await text(page, '#res-pair b'), '1/2 (50%)');
  assert.equal(await text(page, '#res-type b'), '1/2 (50%)');
  assert.equal(await text(page, '#res-direction b'), '0/2 (0%)');
  assert.match(await text(page, '#res-wrong'), /정답: 힘 → 가속도 · 종류[\s\S]*내 답: 가속도 → 힘 · 종류[\s\S]*방향이 반대예요/);
  assert.match(await text(page, '#res-missed'), /질량 → 힘 · 일부 · 질량이 클수록 힘이 필요/);
  assert.match(await text(page, '#res-extras'), /힘 → 에너지 · 일부/);
  assert.match(await page.eval("document.getElementById('quiz-panel').innerText"), /지도에 없는 연결[\s\S]*틀린 것으로 세지 않아요/);
  assert.equal(srv.db.attempts.length, 1);
  assert.deepEqual([srv.db.attempts[0].pair_score, srv.db.attempts[0].type_score, srv.db.attempts[0].direction_score], [0.5, 0.5, 0]);
  // 다시 풀기 → 새 퀴즈(답 없음), 그만두고 복습으로
  await page.click('#quiz-again');
  await page.waitFor("!!document.getElementById('quiz-answers') && document.querySelectorAll('#quiz-answers li').length === 0", 6000, '새 퀴즈');
  await page.click('#quiz-quit');
  await page.waitFor("document.getElementById('map-view').classList.contains('review-mode') && !document.getElementById('map-view').classList.contains('quiz-mode')", 3000);
  assert.equal(await page.eval("document.querySelectorAll('.m-node').length"), 4, '지도 보기로 돌아옴');
  assert.equal(await page.eval("document.querySelectorAll('.m-edge').length"), 2, '복습 화면의 지도에는 연결이 보임');
});

test('퀴즈 도중 지도가 바뀌면 채점하지 않고 안내 + [다시 시작](시도 기록 없음)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await saveMap(page); await reviewTab(page);
  await page.click('#quiz-start');
  await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode')", 6000);
  await pairTap(page, w.c.force, w.c.acc, '종류');
  await seed(page, 'PATCH', `/api/cmap/edges/${w.e1.id}`, { label: '문구를 바꿈' });
  await page.click('#quiz-submit');
  await page.waitFor("!!document.getElementById('quiz-error') && !!document.getElementById('quiz-restart')", 6000, '지도가 바뀜 안내');
  assert.match(await text(page, '#quiz-error'), /지도가 바뀌어 채점하지 않았어요/);
  assert.equal(await page.eval("!!document.getElementById('quiz-result')"), false);
  assert.equal(srv.db.attempts.length, 0);
});

test('퀴즈 중 시트를 닫으면(닫기) 퀴즈가 끝나고 복습으로 돌아온다 — 정답 연결은 시트 밖에서 다시 보임', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await saveMap(page); await reviewTab(page);
  await page.click('#quiz-start');
  await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode') && document.getElementById('map-sheet').open", 6000);
  await page.click('#map-sheet-close');
  await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.eval("document.getElementById('map-view').classList.contains('quiz-mode')"), false);
  assert.equal(await page.eval("document.getElementById('map-view').classList.contains('review-mode')"), true);
  assert.equal(await page.eval("document.querySelectorAll('.m-edge').length"), 2, '실제 지도의 연결이 다시 보임');
  assert.equal((await page.eval('window.CmapReview._state()')).quiz, null);
});

test('390px: 하단 내비·퀴즈 버튼 44px 이상, 가로 스크롤 없음, 결과 점수 3칸이 한 줄에 들어간다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  assert.ok(await page.eval("document.getElementById('nav-quiz').getBoundingClientRect().height") >= 44);
  await saveMap(page); await reviewTab(page);
  assert.ok(await page.eval("document.getElementById('quiz-start').getBoundingClientRect().height") >= 44);
  await page.click('#quiz-start'); await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode')", 6000);
  await pairTap(page, w.c.force, w.c.acc, '종류');
  for (const sel of ['#quiz-submit', '#quiz-quit', '#quiz-answers [data-del]']) assert.ok(await page.eval(`document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().height`) >= 44, sel);
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.click('#quiz-submit'); await page.waitFor("!!document.getElementById('quiz-result')", 6000);
  assert.equal(await page.eval("(() => { const r = [...document.querySelectorAll('.quiz-score')].map(e => e.getBoundingClientRect()); return r.length === 3 && r.every(x => x.top === r[0].top && x.right <= window.innerWidth); })()"), true);
  assert.equal(await page.hasHorizontalScroll(), false);
});
