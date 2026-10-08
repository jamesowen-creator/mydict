// 작업219: 언어 사전의 상단 헤더·하단 내비가 태블릿 이상 폭에서 가운데에 오는지(문학 나침반과 같은 방식), 폰 폭에서는 이전과 같은지.
// 원인: 사전은 body에 max-width/margin auto가 없고 nav가 left:0;right:0 라서 헤더(body 첫 자식)와 내비가 화면 전체 폭으로 퍼졌음(본문 main만 가운데).
// 이 파일의 원칙(작업216-3의 교훈): 테스트 쪽에서 transition·animation을 끄고(NO_MOTION) 레이아웃이 안정된 뒤(settle) 잰다.
// 스크롤바 폭 차이로 x가 1~15px 달라지지 않게 스크롤바를 숨기고(Emulation.setScrollbarsHidden) 잰다.
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;   // 사전은 만료·형식 검사를 한다
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });
const NO_MOTION = `(() => { const s = document.createElement('style'); s.id = 'test-no-motion'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()`;
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'";
const SCREENS = {
  dict: { file: '/english_dictionary.html', ready: "!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", token: true, bar: 'nav', tab: '.nav-tab' },
  lit: { file: '/literature_compass.html', ready: DB_READY + " && !!document.querySelector('.metis-app-header-logo')", bar: '.tab-bar', tab: '.tab-btn' },
};

async function settle(page) {
  await page.waitFor("document.fonts.status === 'loaded'", 5000);
  let last = '', same = 0;
  for (let i = 0; i < 100 && same < 4; i++) {
    const now = await page.eval("[...document.querySelectorAll('.metis-app-header, .metis-app-header-logo, nav, .tab-bar, .nav-tab, .tab-btn, main')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.left * 10) + ':' + Math.round(r.right * 10); }).join('|')");
    same = now === last ? same + 1 : 0; last = now;
    await sleep(50);
  }
  assert.ok(same >= 4, '레이아웃이 안정되지 않음');
}
const MEASURE = sc => `(() => {
  const R = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { x0: Math.round(r.left * 10) / 10, x1: Math.round(r.right * 10) / 10 }; };
  const q = s => [...document.querySelectorAll(s)].find(e => e.getClientRects().length);
  const tabs = [...document.querySelectorAll(${JSON.stringify(sc.tab)})].filter(e => e.getClientRects().length).map(R);
  return { vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth,
    header: R(q('.metis-app-header')), logo: R(q('.metis-app-header-logo')), bar: R(q(${JSON.stringify(sc.bar)})), tabs, main: R(q('main, #view-home .content')) };
})()`;
async function measure(key, width) {
  const sc = SCREENS[key];
  srv.reset(); srv.state.me = me();
  const page = await browser.newPage({ width, height: 900, token: sc.token ? jwt() : 'test-token' });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.goto(srv.url + sc.file);
  await page.waitFor(sc.ready, 12000);
  await page.eval(NO_MOTION);
  await settle(page);
  await sleep(300);
  const m = await page.eval(MEASURE(sc));
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], key + ' ' + width + ': 스크립트 오류');
  await page.close();
  return m;
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

for (const w of [768, 820, 1024, 1280]) {
  test(`219 사전 ${w}px: 헤더·하단 내비가 가운데(좌우 여백 차이 ≤ 1px), 문학 나침반과 같은 x 범위·같은 최대 폭, 내비 항목이 서로 겹치지 않음`, { skip: SKIP }, async () => {
    const d = await measure('dict', w), l = await measure('lit', w);
    const centered = (name, r, vw) => assert.ok(near(r.x0, vw - r.x1), `${name}: 왼쪽 여백 ${r.x0} vs 오른쪽 여백 ${vw - r.x1}`);
    centered('사전 헤더', d.header, d.vw); centered('사전 하단 내비', d.bar, d.vw); centered('사전 본문', d.main, d.vw);
    // 기준 화면과 같은 x 범위(최대 폭 --content-max = 680px)
    for (const k of ['header', 'bar']) {
      assert.ok(near(d[k].x0, l[k].x0) && near(d[k].x1, l[k].x1), `${k}: 사전 ${d[k].x0}~${d[k].x1} vs 문학 ${l[k].x0}~${l[k].x1}`);
      assert.ok(near(d[k].x1 - d[k].x0, 680), `${k}: 최대 폭 680px (${d[k].x1 - d[k].x0})`);
    }
    // 사전 안에서도 헤더·내비·본문이 같은 열에 있음
    assert.ok(near(d.header.x0, d.bar.x0) && near(d.header.x1, d.bar.x1), '헤더와 하단 내비의 가로 범위가 같음');
    assert.ok(near(d.main.x0, d.header.x0) && near(d.main.x1, d.header.x1), '본문과 헤더의 가로 범위가 같음');
    // 안쪽 콘텐츠(로고·내비 첫 항목)가 열의 안쪽 16px 에서 시작
    assert.ok(near(d.logo.x0, d.header.x0 + 16), `로고 x ${d.logo.x0} (헤더 시작 ${d.header.x0} + 16)`);
    assert.ok(near(d.tabs[0].x0, d.bar.x0 + 16), `첫 탭 x ${d.tabs[0].x0} (내비 시작 ${d.bar.x0} + 16)`);
    // 내비 항목이 서로 겹치지 않음
    for (let i = 1; i < d.tabs.length; i++) assert.ok(d.tabs[i - 1].x1 <= d.tabs[i].x0 + 0.5, `탭 ${i} 와 ${i + 1} 이 겹침`);
    assert.equal(d.tabs.length, 5, '탭 개수는 그대로 5개');
    assert.ok(d.scrollW <= d.vw + 1, '가로 스크롤 없음');
  });
}

// 폰 폭: 수정 전과 같은 값(수정 전 측정: 작업219 1단계). 320px에서는 사전 콘텐츠 최소 폭 때문에 고정 내비가 387px로 그려지는 기존 동작이 그대로임.
test('219 사전 320px·390px: 수정 전과 같은 위치(헤더·본문 전체 폭, 로고 16px, 첫 탭 16px), 가로 스크롤 없음(320px는 기존 동작 그대로), 내비 항목이 겹치지 않음', { skip: SKIP }, async () => {
  const d390 = await measure('dict', 390);
  assert.deepEqual(d390.header, { x0: 0, x1: 390 }); assert.deepEqual(d390.bar, { x0: 0, x1: 390 }); assert.deepEqual(d390.main, { x0: 0, x1: 390 });
  assert.equal(d390.logo.x0, 16); assert.equal(d390.tabs[0].x0, 16);
  assert.ok(d390.scrollW <= d390.vw + 1, '390px: 가로 스크롤 없음');
  for (let i = 1; i < d390.tabs.length; i++) assert.ok(d390.tabs[i - 1].x1 <= d390.tabs[i].x0 + 0.5, `390px 탭 ${i} 와 ${i + 1} 이 겹침`);
  const d320 = await measure('dict', 320);
  assert.deepEqual(d320.header, { x0: 0, x1: 320 }); assert.deepEqual(d320.main, { x0: 0, x1: 320 });
  assert.equal(d320.bar.x0, 0); assert.equal(d320.logo.x0, 16); assert.equal(d320.tabs[0].x0, 16);
  assert.equal(d320.tabs.length, 5);
  // 320px는 수정 전부터 검색 버튼(#search-btn)이 화면 오른쪽 밖(321~387px)으로 나가 문서 폭이 387px이다(작업219 1단계 측정, 이 작업의 범위 밖이라 그대로 둠). 수정 때문에 더 넓어지지 않았는지만 확인(스크롤바를 숨기면 365px로 잡히기도 해서 상한만 비교)
  assert.ok(d320.scrollW <= 387, `320px: 문서 폭이 수정 전 값(387px)보다 넓어지지 않음 (${d320.scrollW})`);
  for (let i = 1; i < d320.tabs.length; i++) assert.ok(d320.tabs[i - 1].x1 <= d320.tabs[i].x0 + 0.5, `320px 탭 ${i} 와 ${i + 1} 이 겹침`);
});
