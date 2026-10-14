// 작업275-5: 복습 탭의 [표시한 개념 퀴즈] — 버튼·표시 개수·0개 비활성, 연결 부족 안내와 [전체 퀴즈로 풀기], 퀴즈 진행(표시한 개념에 배지, 정답 연결 비노출)과 결과(추가 연결, 모두 맞힌 개념의 [표시 해제]는 직접 눌러야 함),
// 범위가 바뀌면 채점 거부, 기존 전체 퀴즈는 그대로. 서버는 실제 routes/concept_map.js + 가짜 DB, AI 없음. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_quiz_marked.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

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
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
// 개념 a~f. 연결: a→b(일으킴) b→c(사용) c→d(구별) d→e(일부) a→c(종류). f 는 연결 없음. 표시(marks)는 지도를 열기 전에 서버에 넣는다
async function world(page, { marks = [] } = {}) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = {};
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) ids[k] = (await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, { term: k + '개념' })).concept.id;
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  const at = { a: [20, 20], b: [200, 20], c: [20, 120], d: [200, 120], e: [20, 220], f: [200, 220] };
  for (const k of Object.keys(ids)) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: ids[k] }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${ids[k]}`, { x: at[k][0], y: at[k][1] }); }
  const edge = (f, to, label, relation_type) => seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[f], to_concept_id: ids[to], label, relation_type });
  await edge('a', 'b', '가나', '일으킴'); await edge('b', 'c', '나다', '사용'); await edge('c', 'd', '다라', '구별'); await edge('d', 'e', '라마', '일부'); await edge('a', 'c', '가다', '종류');
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  for (const k of marks) await seed(page, 'PUT', `/api/cmap/concepts/${ids[k]}/mark`, { marked: true });
  await gotoMap(page, sci.id);
  return { sci, ids, map };
}
async function gotoMap(page, sciId) {
  await page.eval('refresh()'); await page.eval(`selectTopic(${sciId}); 0`);
  await page.waitFor("document.querySelectorAll('#concept-list > *').length >= 6", 6000, '개념 목록');
  await page.click('#act-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 6", 6000, '지도 화면');
}
const reviewTab = async page => { await page.click('#tab-review'); await page.waitFor("!!document.getElementById('quiz-start-marked') && !!document.getElementById('quiz-marked-count') && document.getElementById('quiz-marked-count').textContent.length > 0", 6000, '복습 탭'); };
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const serverMarks = srv => srv.db.marks.map(m => m.concept_id).sort((a, b) => a - b);
async function pairTap(page, a, b, type) {
  await page.click(`[data-node="${a}"] rect`); await page.click(`[data-node="${b}"] rect`);
  await page.waitFor("document.getElementById('quiz-dlg').open", 3000, '퀴즈 연결 대화상자');
  if (type) await page.eval(`document.getElementById('quiz-type').value = ${JSON.stringify(type)}`);
  await page.click('#quiz-add');
  await page.waitFor("!document.getElementById('quiz-dlg').open", 3000);
}
const sheetQuiz = page => page.waitFor("document.getElementById('map-sheet').open && document.getElementById('map-sheet').classList.contains('quiz-mode') && document.querySelectorAll('[data-node]').length > 0", 6000, '퀴즈 시트');
const nodeIds = page => page.eval("[...document.querySelectorAll('[data-node]')].map(e => Number(e.dataset.node)).sort((a, b) => a - b)");

test('버튼: 표시가 없으면 0개 표시·비활성 + 안내, 표시가 있으면 개수·활성, 연결 없는 표시 개념은 목록으로 알린다. 기존 전체 퀴즈 버튼은 그대로', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page);
  await reviewTab(page);
  assert.equal(await text(page, '#quiz-marked-count'), '표시한 개념 0개');
  assert.equal(await page.eval("document.getElementById('quiz-start-marked').disabled"), true);
  assert.equal(await text(page, '#quiz-marked-hint'), '지도에서 모르는 개념을 눌러 표시해 보세요');
  assert.equal(await page.eval("document.getElementById('quiz-start').disabled"), false, '기존 전체 퀴즈는 그대로 사용 가능');
  assert.equal(await text(page, '#quiz-start'), '연결 퀴즈 시작');
  assert.ok(await page.eval("document.getElementById('quiz-start-marked').getBoundingClientRect().height") >= 44);
  // 표시가 있는 지도: 새로 열어서 확인(b: 출제 가능, f: 연결 없음)
  await page.click('#map-back'); await page.waitFor("!document.getElementById('main-view').hidden", 4000);
  const sci = await page.eval('S.selectedId');
  const ids = await page.eval("(() => { const o = {}; for (const c of S.concepts) o[c.term] = c.id; return o; })()");
  await seed(page, 'PUT', `/api/cmap/concepts/${ids['b개념']}/mark`, { marked: true });
  await seed(page, 'PUT', `/api/cmap/concepts/${ids['f개념']}/mark`, { marked: true });
  await gotoMap(page, sci);
  await reviewTab(page);
  await page.waitFor("document.getElementById('quiz-marked-count').textContent === '표시한 개념 2개'", 4000);
  assert.equal(await page.eval("document.getElementById('quiz-start-marked').disabled"), false);
  assert.equal(await page.eval("!!document.getElementById('quiz-marked-hint')"), false);
  assert.equal(await text(page, '#quiz-marked-isolated'), '연결이 없어 출제할 수 없음: f개념');
  assert.equal(await page.hasHorizontalScroll(), false);
});

test('연결 부족: 출제 연결이 2개 미만이면 시작하지 않고 안내 + [전체 퀴즈로 풀기], 그 버튼으로 기존 전체 퀴즈가 시작된다(표시 배지 없음)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, { marks: ['e'] });                                  // e: d→e 한 개뿐
  await reviewTab(page);
  await page.click('#quiz-start-marked');
  await page.waitFor("!!document.getElementById('quiz-start-all-fallback')", 4000, '전체 퀴즈 선택지');
  assert.match(await text(page, '#review-msg'), /연결이 부족해 퀴즈를 만들 수 없습니다/);
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), false, '시작하지 않음');
  assert.equal(srv.db.attempts.length, 0);
  await page.click('#quiz-start-all-fallback');
  await sheetQuiz(page);
  assert.deepEqual(await nodeIds(page), Object.values(w.ids).sort((a, b) => a - b), '전체 노드');
  assert.equal(await page.eval("document.querySelectorAll('.m-node.marked, .m-mark').length"), 0, '전체 퀴즈에는 표시 배지가 없음');
  assert.deepEqual(serverMarks(srv), [w.ids.e]);
});

test('표시한 개념 퀴즈: 표시 개념 + 이웃만 제시하고 표시한 개념에 배지, 정답 연결은 안 보임 → 범위 밖 연결은 추가 연결 → 모두 맞힌 개념의 [표시 해제]는 직접 눌러야 하고 눌러야만 해제된다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, { marks: ['b'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('quiz-marked-count').textContent === '표시한 개념 1개'", 4000);
  await page.click('#quiz-start-marked');
  await sheetQuiz(page);
  assert.deepEqual(await nodeIds(page), [w.ids.a, w.ids.b, w.ids.c].sort((x, y) => x - y), '표시 개념 b + 이웃 a, c');
  assert.equal(await page.eval("document.querySelectorAll('.m-node.marked').length"), 1);
  assert.equal(await page.eval(`!!document.querySelector('[data-node="${w.ids.b}"].marked .m-mark')`), true, '표시한 개념에 배지');
  assert.equal(await page.eval("document.querySelectorAll('.m-edge').length"), 0, '정답 연결선 없음');
  const body = await page.eval("document.getElementById('map-sheet').innerText");
  assert.ok(!/가나|나다|가다|일으킴|사용|종류/.test(body.replace(/관계 종류|종류 없음|선택 안 함/g, '')), '정답 문구·종류가 화면에 없음');
  assert.match(await text(page, '#quiz-hint'), /물음표 배지/);
  assert.equal(await text(page, '#quiz-panel .sec-label'), '표시한 개념 퀴즈');
  await pairTap(page, w.ids.a, w.ids.b, '일으킴');
  await pairTap(page, w.ids.b, w.ids.c, '사용');
  await pairTap(page, w.ids.a, w.ids.c, '종류');                                    // 범위 밖(표시 개념과 무관한 연결)
  await page.click('#quiz-submit'); await page.waitFor("!!document.getElementById('quiz-result')", 6000, '결과');
  assert.equal(await text(page, '#res-pair b'), '2/2 (100%)'); assert.equal(await text(page, '#res-type b'), '2/2 (100%)'); assert.equal(await text(page, '#res-direction b'), '2/2 (100%)');
  assert.match(await text(page, '#res-extras'), /a개념 → c개념/, '범위 밖 연결은 추가 연결');
  assert.equal(await text(page, '#res-missed').then(x => x.length), 0, '못 찾은 연결 없음(목록 없음)');
  assert.equal(await page.eval("[...document.querySelectorAll('#res-mastered li')].map(l => l.querySelector('span').textContent).join()"), 'b개념');
  assert.equal(await page.eval("document.querySelector('#res-mastered [data-act=unmark]').getBoundingClientRect().height") >= 44, true);
  await sleep(300);
  assert.deepEqual(serverMarks(srv), [w.ids.b], '퀴즈가 끝나도 자동으로 해제되지 않음');
  assert.equal(srv.db.attempts.length, 1);
  await page.click('#res-mastered [data-act=unmark]');
  await page.waitFor("document.querySelector('#res-mastered [data-act=unmark]').textContent === '해제됨'", 4000, '해제됨');
  assert.deepEqual(serverMarks(srv), [], '직접 누르면 해제');
  // 복습으로 돌아가면 개수가 갱신된다
  await page.click('#quiz-back'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  await page.waitFor("document.getElementById('quiz-marked-count').textContent === '표시한 개념 0개' && document.getElementById('quiz-start-marked').disabled", 4000, '개수 갱신');
});

test('일부만 맞히면 모두 맞힌 개념이 없다고 안내하고 해제 버튼이 없으며, 퀴즈 중에는 지도 클릭으로 표시·팝업이 바뀌지 않는다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, { marks: ['b'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('quiz-marked-count').textContent === '표시한 개념 1개'", 4000);
  await page.click('#quiz-start-marked'); await sheetQuiz(page);
  await page.click(`[data-node="${w.ids.b}"] rect`); await page.click(`[data-node="${w.ids.b}"] rect`);   // 같은 개념 두 번(퀴즈 선택 취소) — 표시·팝업 변화 없음
  assert.equal(await page.eval("document.getElementById('map-popup').hidden"), true);
  assert.deepEqual(serverMarks(srv), [w.ids.b]);
  await pairTap(page, w.ids.a, w.ids.b, '일으킴');                                  // b→c 는 안 이음
  await page.click('#quiz-submit'); await page.waitFor("!!document.getElementById('quiz-result')", 6000);
  assert.equal(await text(page, '#res-pair b'), '1/2 (50%)');
  assert.equal(await page.eval("!!document.getElementById('res-mastered-empty') && document.querySelectorAll('#res-mastered [data-act=unmark]').length === 0"), true, '해제 제안 없음');
  assert.match(await text(page, '#res-missed'), /b개념 → c개념/);
  assert.deepEqual(serverMarks(srv), [w.ids.b], '표시 유지');
});

test('시작 뒤 표시가 바뀌면 채점하지 않고 안내 + [다시 시작](기록 없음)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, { marks: ['b'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('quiz-marked-count').textContent === '표시한 개념 1개'", 4000);
  await page.click('#quiz-start-marked'); await sheetQuiz(page);
  await pairTap(page, w.ids.a, w.ids.b, '일으킴');
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids.c}/mark`, { marked: true });          // 다른 기기에서 표시가 늘어남
  await page.click('#quiz-submit');
  await page.waitFor("!!document.getElementById('quiz-error') && !!document.getElementById('quiz-restart')", 6000, '범위가 바뀜 안내');
  assert.match(await text(page, '#quiz-error'), /표시한 개념이 바뀌어 채점하지 않았어요/);
  assert.equal(srv.db.attempts.length, 0);
  await page.click('#quiz-restart');
  await page.waitFor("document.querySelectorAll('.m-node.marked').length === 2", 6000, '새 범위로 다시 시작');
  assert.deepEqual(await nodeIds(page), [w.ids.a, w.ids.b, w.ids.c, w.ids.d].sort((x, y) => x - y), 'b, c 와 이웃 a, d');
});

test('기존 전체 퀴즈: 표시가 있어도 전체 노드·배지 없음·채점 결과가 그대로(범위 전체)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, { marks: ['b'] });
  await reviewTab(page);
  await page.click('#quiz-start'); await sheetQuiz(page);
  assert.deepEqual(await nodeIds(page), Object.values(w.ids).sort((a, b) => a - b));
  assert.equal(await page.eval("document.querySelectorAll('.m-node.marked, .m-mark').length"), 0);
  assert.equal(await text(page, '#quiz-panel .sec-label'), '연결 퀴즈');
  await pairTap(page, w.ids.a, w.ids.b, '일으킴');
  await page.click('#quiz-submit'); await page.waitFor("!!document.getElementById('quiz-result')", 6000);
  assert.equal(await text(page, '#res-pair b'), '1/5 (20%)', '전체 연결 5개 기준');
  assert.equal(await page.eval("!!document.getElementById('res-mastered') || !!document.getElementById('res-mastered-empty')"), false, '전체 퀴즈에는 표시 해제 제안이 없음');
  assert.deepEqual(serverMarks(srv), [w.ids.b]);
});
