// 작업280-1: 개념 지도 화면 구조 — 랜딩(주제 추가 + 최신순 목록) → 주제 안 화면 → 하단 내비 4탭(주제/퀴즈/지도 만들기/오답노트), 주제 미선택 안내, 키보드와 내비, 뒤로 가기.
// 서버는 실제 routes/concept_map.js + 가짜 DB. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_nav.ui.test.js"   (Chrome이 없으면 건너뜀)
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
  const page = await browser.newPage({ width, height, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const view = page => page.eval("S.view");
const hidden = (page, id) => page.eval(`document.getElementById('${id}').hidden`);
const listTitles = page => page.eval("[...document.querySelectorAll('#topic-list [data-t=node] .t-title')].map(e => e.textContent)");
const activeTab = page => page.eval("[...document.querySelectorAll('#cmap-nav [data-tab]')].filter(b => b.classList.contains('active')).map(b => b.dataset.tab)");
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);

test('랜딩: 위에 [주제 추가], 아래에 주제 목록이 최신순(나중에 만든 것이 위)이고, 항목을 누르면 그 주제 안으로 들어간다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  assert.equal(await view(page), 'landing');
  assert.equal(await page.text('.screen-bar-title'), '개념 지도');
  assert.equal(await hidden(page, 'topic-view'), true);
  for (const name of ['가', '나', '다']) await seed(page, 'POST', '/api/cmap/topics', { title: name });
  const b = (await seed(page, 'POST', '/api/cmap/topics', { title: '하위', parent_id: 1 })).topic;
  await page.eval('refresh()');
  assert.deepEqual(await listTitles(page), ['가 › 하위', '다', '나', '가'], '최신순, 하위 주제는 경로로 표시');
  // [주제 추가]가 목록보다 위
  assert.ok(await page.eval("document.getElementById('add-root-btn').getBoundingClientRect().bottom <= document.getElementById('topic-list').getBoundingClientRect().top"));
  assert.ok(await page.eval("[...document.querySelectorAll('#topic-list .t-node')].every(e => e.getBoundingClientRect().height >= 44)"), '목록 줄 44px 이상');
  await page.click(`#topic-list [data-id="${b.id}"]`);
  await page.waitFor("!document.getElementById('topic-view').hidden", 4000, '주제 안');
  assert.equal(await view(page), 'topic');
  assert.equal(await page.text('#path-line'), '가 › 하위', '현재 주제 경로 한 줄');
  assert.equal(await hidden(page, 'landing-view'), true);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('주제 추가 흐름: 상위 → 하위를 [하위 주제 추가]로 이어 입력 → [완료]하면 가장 마지막(최하위) 주제 안으로 들어간다, 깊이 5단계·같은 이름 규칙 유지', { skip: SKIP, timeout: 60000 }, async t => {
  const { page, srv } = await open(t);
  await page.click('#add-root-btn');
  await page.waitFor("document.getElementById('add-dlg').open", 3000);
  assert.equal(await page.eval("document.getElementById('add-cancel').hidden"), false);
  await page.type('#add-input', '금융');
  await page.click('#add-sub');                                              // 상위 주제를 만들고 하위 입력으로
  await page.waitFor("!document.getElementById('add-chain').hidden", 4000);
  assert.match(await page.text('#add-label'), /‘금융’ 아래에 만들 하위 주제/);
  await page.click('#add-sub');                                              // 빈 하위 이름
  assert.match(await page.text('#add-msg'), /하위 주제 이름을 입력/);
  await page.type('#add-input', '단기자금');
  await page.click('#add-sub');
  await page.waitFor("document.getElementById('add-label').textContent.includes('‘단기자금’')", 4000);
  assert.equal(await page.text('#add-chain'), '만든 주제: 금융 › 단기자금');
  assert.equal(srv.db.topics.length, 2);
  await page.click('#add-done');                                             // 입력칸이 비어 있으면 그대로 끝
  await page.waitFor("!document.getElementById('add-dlg').open && !document.getElementById('topic-view').hidden", 4000);
  assert.equal(await page.text('#path-line'), '금융 › 단기자금', '최하위 주제 안에 머묾');
  assert.equal(await page.eval("byId(S.selectedId).title"), '단기자금');
  assert.equal(srv.db.topics.length, 2);
  // 하위 주제는 선택: 상위만 입력하고 [완료] → 그 주제 안
  await page.click('#nav-topic');
  await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.click('#add-root-btn'); await page.waitFor("document.getElementById('add-dlg').open", 3000);
  await page.type('#add-input', '과학'); await page.click('#add-done');
  await page.waitFor("!document.getElementById('topic-view').hidden && document.getElementById('path-line').textContent === '과학'", 4000);
  // 같은 부모 아래 같은 이름은 대화상자 안에 오류
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.click('#add-root-btn'); await page.waitFor("document.getElementById('add-dlg').open", 3000);
  await page.type('#add-input', '과학'); await page.click('#add-sub');
  await page.waitFor("document.getElementById('add-msg').textContent.length > 0", 4000);
  assert.match(await page.text('#add-msg'), /이미 있습니다/);
  assert.equal(await page.eval("document.getElementById('add-dlg').open"), true);
  // 5단계 제한: 4개를 더 이어 5단계까지 만들면 [하위 주제 추가]가 꺼진다
  await page.type('#add-input', '과학2'); await page.click('#add-sub');
  await page.waitFor("document.getElementById('add-chain').textContent === '만든 주제: 과학2'", 4000);
  for (const n of ['b', 'c', 'd', 'e']) {
    if (await page.eval("document.getElementById('add-hint').textContent.includes('최대 5단계')")) break;
    await page.type('#add-input', n); await page.click('#add-sub');
    await page.waitFor(`document.getElementById('add-chain').textContent.endsWith(' › ${n}')`, 4000);
  }
  await page.waitFor("document.getElementById('add-sub').disabled && document.getElementById('add-hint').textContent.includes('최대 5단계')", 4000, '5단계에서 비활성');
  assert.match(await page.text('#add-hint'), /최대 5단계/);
  await page.click('#add-done');
  await page.waitFor("!document.getElementById('topic-view').hidden", 4000);
  assert.equal(await page.eval("byId(S.selectedId).depth"), 5);
  noErrors(page);
});

test('하단 내비 4탭: 주제/퀴즈/지도 만들기/오답노트가 랜딩·주제 안에서 보이고, 탭마다 화면이 바뀌며 활성 표시(위 3px 선)와 규격을 지킨다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, { term: '힘' });
  await page.eval('refresh()');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#cmap-nav [data-tab]')].map(b => b.textContent)"), ['주제', '퀴즈', '지도 만들기', '오답노트']);
  assert.deepEqual(await activeTab(page), ['topic'], '랜딩에서는 주제 탭');
  const nav = await page.eval(`(() => { const n = document.getElementById('cmap-nav'), cs = getComputedStyle(n), r = n.getBoundingClientRect(); const tab = document.getElementById('nav-topic'); const tc = getComputedStyle(tab);
    return { pos: cs.position, h: r.height, bottom: r.bottom, vh: innerHeight, z: cs.zIndex, bt: cs.borderTopWidth, fs: tc.fontSize, tabH: tab.getBoundingClientRect().height, activeBt: tc.borderTopWidth, hasIcon: !!n.querySelector('svg, img'), bodyPad: parseFloat(getComputedStyle(document.body).paddingBottom) }; })()`);
  assert.equal(nav.pos, 'fixed'); assert.ok(nav.h >= 78, '내비 높이 78px 이상'); assert.equal(nav.bottom, nav.vh); assert.equal(nav.z, '100'); assert.equal(nav.bt, '1px');
  assert.equal(nav.fs, '13px', '460px 이하 라벨 13px'); assert.equal(nav.activeBt, '3px'); assert.ok(nav.tabH >= 44); assert.equal(nav.hasIcon, false);
  assert.ok(nav.bodyPad >= 78 + 16, '본문 하단 여백이 내비 높이 이상');
  // 주제 안
  await page.eval(`Nav.enterTopic(${sci.id}).then(() => 0)`);
  await page.waitFor("!document.getElementById('topic-view').hidden", 4000);
  assert.equal(await page.eval("getComputedStyle(document.getElementById('cmap-nav')).display"), 'flex', '주제 안에서도 내비가 보임');
  assert.deepEqual(await activeTab(page), ['topic']);
  // 퀴즈: 카드 3개
  await page.click('#nav-quiz');
  await page.waitFor("!document.getElementById('quiz-view').hidden && document.querySelectorAll('#review-panel .qcard').length === 3", 6000, '퀴즈 탭');
  assert.deepEqual(await activeTab(page), ['quiz']);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#review-panel .qcard > .sec-label')].map(e => e.textContent)"), ['연결 퀴즈', '표시 개념 퀴즈', '말로 설명하기']);
  assert.equal(await page.text('#path-line'), '과학');
  // 지도 만들기: [만들기 / 해설]
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('mapmk-view').hidden && document.getElementById('quiz-view').hidden", 6000, '지도 만들기 탭');
  assert.deepEqual(await activeTab(page), ['map']);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.map-tab')].map(b => b.textContent)"), ['만들기', '해설']);
  assert.equal(await hidden(page, 'map-page'), false); assert.equal(await page.visible('#narr-panel'), false);
  await page.click('#tab-narr');
  await page.waitFor("document.getElementById('map-view').classList.contains('narr-mode') && !!document.getElementById('narr-make')", 4000);
  assert.equal(await page.visible('#narr-open-map'), true, '해설에서 읽기 전용 지도를 연다');
  // 오답노트: 모르는 개념 표시 목록 + 말로 설명하기 최근 부족 목록(틀)
  await page.click('#nav-wrong');
  await page.waitFor("!document.getElementById('wrong-view').hidden && document.getElementById('mapmk-view').hidden", 6000, '오답노트 탭');
  assert.deepEqual(await activeTab(page), ['wrong']);
  assert.equal(await page.eval("!document.getElementById('wrong-marked-empty').hidden"), true, '표시한 개념이 없으면 안내');
  assert.equal(await page.eval("!!document.getElementById('wrong-marked') && !!document.getElementById('wrong-recent')"), true);
  // 주제 탭 → 랜딩
  await page.click('#nav-topic');
  await page.waitFor("!document.getElementById('landing-view').hidden && document.getElementById('map-view').hidden", 4000);
  assert.deepEqual(await activeTab(page), ['topic']);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('주제를 고르지 않고 퀴즈·지도 만들기·오답노트를 누르면 "주제를 먼저 선택해 주세요"와 [주제 목록으로]만 보인다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page, srv } = await open(t);
  await seed(page, 'POST', '/api/cmap/topics', { title: '과학' });
  await page.eval('refresh()');
  for (const tab of ['quiz', 'map', 'wrong']) {
    await page.click('#nav-' + tab);
    await page.waitFor("!document.getElementById('nosel-view').hidden", 4000, tab + ' 안내');
    assert.match(await page.text('#nosel-view'), /주제를 먼저 선택해 주세요/);
    assert.equal(await page.text('#nosel-go'), '주제 목록으로');
    assert.equal(await hidden(page, 'map-view'), true, tab + ': 본문 없음');
    assert.equal(await hidden(page, 'landing-view'), true);
    assert.deepEqual(await activeTab(page), [tab]);
  }
  assert.equal(srv.db.maps.length, 0, '지도를 만들거나 조회하지 않음');
  await page.click('#nosel-go');
  await page.waitFor("!document.getElementById('landing-view').hidden && document.getElementById('nosel-view').hidden", 4000);
  assert.deepEqual(await activeTab(page), ['topic']);
  noErrors(page);
});

test('키보드: 입력칸에 포커스가 있는 동안 하단 내비를 숨기고, 포커스가 빠지면 다시 보인다(글자 입력칸이 아닌 요소는 숨기지 않음)', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${sci.id}).then(() => 0)`);
  await page.waitFor("!document.getElementById('concepts-sec').hidden", 4000);
  const navShown = () => page.eval("getComputedStyle(document.getElementById('cmap-nav')).display !== 'none'");
  assert.equal(await navShown(), true);
  await page.click('#explain-term');
  await page.waitFor("document.body.classList.contains('kb-open')", 2000);
  assert.equal(await navShown(), false, '입력 포커스 중에는 숨김');
  await page.eval("document.getElementById('explain-term').blur(); 0");
  await page.waitFor("!document.body.classList.contains('kb-open')", 2000);
  assert.equal(await navShown(), true, '포커스가 빠지면 복귀');
  // 체크박스 등 글자를 입력하지 않는 요소는 숨기지 않는다
  assert.equal(await page.eval("(() => { const c = document.createElement('input'); c.type = 'checkbox'; document.body.append(c); c.focus(); checkKeyboard(); const k = document.body.classList.contains('kb-open'); c.remove(); checkKeyboard(); return k; })()"), false);
  noErrors(page);
});

test('뒤로 가기: 주제 안에서 뒤로 가면 랜딩, 랜딩에서 뒤로 가면 홈(앱 안에서는 이탈하지 않음), 탭 전환은 기록을 쌓지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  await page.eval('refresh()');
  const len0 = await page.eval('history.length');
  await page.click(`#topic-list [data-id="${sci.id}"]`);
  await page.waitFor("!document.getElementById('topic-view').hidden", 4000);
  assert.equal(await page.eval('history.length'), len0 + 1, '주제 안 진입은 기록 한 칸');
  // 탭 전환은 replaceState: 기록이 늘지 않는다
  for (const tab of ['quiz', 'map', 'wrong']) {
    await page.click('#nav-' + tab);
    await page.waitFor(`S.view === '${tab}'`, 4000);
    assert.equal(await page.eval('history.length'), len0 + 1, tab + ': 기록 증가 없음');
  }
  // 뒤로 가기(브라우저) → 랜딩, 앱을 벗어나지 않음
  await page.eval('history.back(); 0');
  await page.waitFor("S.view === 'landing' && !document.getElementById('landing-view').hidden", 4000, '랜딩 복귀');
  assert.equal(await page.eval('location.pathname'), '/concept_map.html');
  assert.equal(await hidden(page, 'map-view'), true);
  // 화면의 뒤로 버튼: 주제 안 → 랜딩, 랜딩 → 홈
  await page.click(`#topic-list [data-id="${sci.id}"]`);
  await page.waitFor("S.view === 'topic'", 4000);
  await page.click('#back-btn');
  await page.waitFor("S.view === 'landing'", 4000, '화면 뒤로 버튼 → 랜딩');
  await page.click('#back-btn');
  await page.waitFor("location.pathname === '/'", 6000, '랜딩에서 뒤로 → 홈');
  noErrors(page);
});

test('주제 탭: 주제 안·탭 이동 뒤 [주제]를 누르면 랜딩으로 돌아가고(기록도 정리), 그 뒤 뒤로 가기로 앱을 벗어나지 않고 한 번에 홈으로 간다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  await page.eval('refresh()');
  const len0 = await page.eval('history.length');
  await page.click(`#topic-list [data-id="${sci.id}"]`);
  await page.waitFor("S.view === 'topic'", 4000);
  await page.click('#nav-map');
  await page.waitFor("S.view === 'map' && !document.getElementById('mapmk-view').hidden", 6000);
  await page.click('#nav-topic');
  await page.waitFor("S.view === 'landing' && !document.getElementById('landing-view').hidden", 4000);
  assert.equal(await page.eval('history.state.metisCmapView + ":" + history.state.d'), 'landing:0');
  assert.equal(await hidden(page, 'map-view'), true, '주제 쪽으로 오면 지도를 닫는다');
  // 주제를 고르지 않은 채 퀴즈 탭 → 안내, [주제] 탭 → 랜딩(기록 칸 그대로)
  await page.eval('S.selectedId = null; 0');
  await page.click('#nav-quiz'); await page.waitFor("!document.getElementById('nosel-view').hidden", 4000);
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  assert.equal(await page.eval('history.length') <= len0 + 1, true);
  noErrors(page);
});
