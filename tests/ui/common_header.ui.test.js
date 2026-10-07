// 작업198: 공용 헤더(사전 모양)가 6개 화면에서 같게 한 번만 그려지는지(헤드리스 Chrome, 모의 API, 390px).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const PAGES = ['english_dictionary', 'literature_compass', 'digest_reading', 'science_reading', 'voice_study', 'concept_study'];
const me = role => ({ id: 7, email: 'u7@example.com', name: '테스터', role, perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });

for (const name of PAGES) {
  test(`공용 헤더 390px ${name}: 하나만, 로고 '/', 이름·로그아웃 보임, 가로 스크롤 없음, 높이 65px`, { skip: SKIP }, async () => {
    srv.reset();
    srv.state.me = me('user');
    const page = await browser.newPage({ width: 390, height: 844 });
    await page.goto(srv.url + '/' + name + '.html');
    await page.waitFor("!!document.querySelector('.metis-app-header .metis-app-header-name')", 8000);
    assert.equal(await page.count('.metis-app-header'), 1, '헤더 한 개');
    assert.equal(await page.eval("document.querySelector('.metis-app-header-logo').getAttribute('href')"), '/');
    assert.equal(await page.count('.metis-app-header-name'), 1, '이름 한 번만');
    assert.equal(await page.count('.metis-app-header-btn'), 1, '버튼은 로그아웃뿐');
    assert.equal(await page.visible('.metis-app-header-subtext .metis-app-header-name'), true, '이름은 로고 아래');
    assert.match(await page.text('.metis-app-header-name'), /테스터 님/);
    assert.equal(await page.visible('.metis-app-header-right .metis-app-header-btn.logout'), true, '우측 로그아웃');
    assert.equal(await page.eval("document.querySelector('.metis-app-header-btn.logout').getBoundingClientRect().height"), 44);
    assert.equal(await page.eval("Math.round(document.querySelector('.metis-app-header').getBoundingClientRect().height)"), 65, '헤더 높이');
    assert.equal(await page.eval("getComputedStyle(document.querySelector('.metis-app-header')).minHeight"), '65px', '로그인 확인 전에도 같은 높이(자리 확보)');
    assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음');
    assert.equal(await page.count('.dict-exp-header, .dict-exp-header-left'), 0, '사전 전용 옛 클래스 없음');
    await page.close();
  });
}

test('공용 헤더: 관리자는 로고 아래 "관리자 · 이름 님", renderAuthWidget를 다시 불러도 DOM이 한 번만 바뀜', { skip: SKIP }, async () => {
  srv.reset();
  srv.state.me = me('admin');
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/literature_compass.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-subtext .metis-app-header-name')", 8000);
  assert.match(await page.text('.metis-app-header-subtext'), /^관리자 · 테스터 님$/);
  assert.equal(await page.eval("document.querySelector('.metis-app-header-subtext a').getAttribute('href')"), '/admin');
  // 같은 컨테이너에 두 번 더 그리게 해도(비동기 겹침 포함) 결과는 한 번 그린 것과 같다
  await page.eval("(() => { const r = document.querySelector('.metis-app-header-right'); MetisAppHeader.renderAuthWidget(r); MetisAppHeader.renderAuthWidget(r); })()");
  await page.waitFor("document.querySelectorAll('.metis-app-header-name').length === 1", 4000);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(await page.count('.metis-app-header-name'), 1);
  assert.equal(await page.count('.metis-app-header-subtext a'), 1);
  assert.equal(await page.count('.metis-app-header-btn.logout'), 1);
  assert.match(await page.text('.metis-app-header-subtext'), /^관리자 · 테스터 님$/);
  await page.close();
});

test('공용 헤더: 로그인 전에는 로그인 버튼만 있고 로고 아래 글줄은 숨겨짐', { skip: SKIP }, async () => {
  srv.reset();
  srv.state.authed = false;
  const page = await browser.newPage({ width: 390, height: 844, token: null });
  await page.goto(srv.url + '/literature_compass.html');
  await page.waitFor("!!document.querySelector('.metis-app-header .metis-app-header-btn.primary')", 8000);
  assert.equal(await page.count('.metis-app-header-btn'), 1);
  assert.equal(await page.visible('.metis-app-header-subtext'), false, '빈 글줄은 숨김');
  assert.equal(await page.eval("Math.round(document.querySelector('.metis-app-header').getBoundingClientRect().height)"), 65, '로그인 전에도 높이 65px');
  assert.equal(await page.count('.metis-app-header-name'), 0);
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
});
