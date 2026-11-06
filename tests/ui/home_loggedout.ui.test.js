// 작업406: 홈 휠 — 로그인 전에는 9개 모두 표시, 항목을 누르면 이동 대신 /auth/google 시작. 로그인 후 구성은 그대로. 390/1280px 가로 스크롤 없음.
// 실행: node --test tests/ui/home_loggedout.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const userToken = () => `${b64({ alg: 'none' })}.${b64({ id: 7, role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const BASE6 = ['언어 사전', '문학 나침반', '한입 독서', '과학', '음성 학습', '작가 노트'];
const ALL9 = ['언어 사전', '문장 학습', '문학 나침반', '한입 독서', '과학', '음성 학습', '작가 노트', '개념 지도', 'Speak Loop'];

async function openHome(me, { token = userToken(), width = 390 } = {}) {
  srv.reset();
  if (me) srv.state.me = { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', ...me };
  const page = await browser.newPage({ width, height: 844, token });
  await page.goto(srv.url + '/');
  await page.waitFor("document.querySelectorAll('[role=option]').length >= 6", 8000);
  await sleep(600);
  return page;
}
const key = async (page, k, code, vk) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const selected = page => page.eval("(document.querySelector('[role=option][aria-selected=true]') || { getAttribute: () => '' }).getAttribute('aria-label').split(' — ')[0]");
async function cycle(page) {
  await page.eval("document.querySelector('[role=listbox]').focus()");
  const out = [await selected(page)];
  for (let i = 0; i < 12; i++) {
    await key(page, 'ArrowDown', 'ArrowDown', 40);
    await sleep(450);
    const cur = await selected(page);
    if (cur === out[0]) break;
    out.push(cur);
  }
  return out;
}

test('406-1. 로그인 전: 9개 항목이 로그인 후 목록과 같은 순서로 보이고, 390·1280px 가로 스크롤이 없다', { skip: SKIP }, async () => {
  for (const width of [390, 1280]) {
    const page = await openHome(null, { token: null, width });
    assert.deepEqual(await cycle(page), ALL9, 'width ' + width);
    assert.equal(await page.hasHorizontalScroll(), false, 'width ' + width);
    assert.ok(await page.eval("document.body.innerText.includes('Google로 로그인')"), '기존 로그인 버튼 유지');
    await page.close();
  }
});

test('406-2. 로그인 전: 가운데 항목을 누르면 화면 이동 대신 /auth/google 로 간다', { skip: SKIP }, async () => {
  const page = await openHome(null, { token: null });
  await page.click('[role=option][aria-selected=true]');
  await page.waitFor("location.pathname === '/auth/google'", 8000, '/auth/google 시작');
  await page.close();
});

test('406-3. 로그인 후 구성 불변: 일반 사용자 6개, 권한 사용자·관리자는 권한 항목 포함', { skip: SKIP }, async () => {
  let page = await openHome({});
  assert.deepEqual(await cycle(page), BASE6);
  await page.close();
  page = await openHome({ perm_jgrammar: true, perm_concept_map: true, perm_speakloop: true });
  assert.deepEqual(await cycle(page), ALL9);
  await page.close();
  page = await openHome({ role: 'admin' });
  assert.deepEqual(await cycle(page), ['언어 사전', '문장 학습', ...BASE6.slice(1), 'Speak Loop']);
  await page.close();
});

test('406-4. 로그인 후 항목을 누르면 기존처럼 해당 화면으로 이동한다(로그인 시작 아님)', { skip: SKIP }, async () => {
  const page = await openHome({});
  await page.click('[role=option][aria-selected=true]');
  await page.waitFor("location.pathname === '/english_dictionary.html'", 8000, '화면 이동');
  await page.close();
});
