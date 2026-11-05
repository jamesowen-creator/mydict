// 작업399: 홈 휠의 Speak Loop 항목 — perm_speakloop === true 또는 관리자일 때만 맨 끝에 보인다(헤드리스 Chrome, 모의 API).
// 실행: node --test tests/ui/speakloop_home.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const userToken = () => `${b64({ alg: 'none' })}.${b64({ id: 7, role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const BASE6 = ['언어 사전', '문학 나침반', '한입 독서', '과학', '음성 학습', '작가 노트'];

async function openHome(me, { token = userToken() } = {}) {
  srv.reset();
  if (me) srv.state.me = { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', ...me };
  const page = await browser.newPage({ width: 390, height: 844, token });
  await page.goto(srv.url + '/');
  await page.waitFor("document.querySelectorAll('[role=option]').length >= 6", 8000);
  await sleep(600);   // /api/me 응답 반영(권한자는 휠이 다시 만들어짐)
  return page;
}
const key = async (page, k, code, vk) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const selected = page => page.eval("(document.querySelector('[role=option][aria-selected=true]') || { getAttribute: () => '' }).getAttribute('aria-label').split(' — ')[0]");
// 한 칸씩 내리며 한 바퀴 돌아 항목 이름을 순서대로 모은다
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

test('홈 휠: 권한 없음·값 없음·false·문자열 "true"·로그인 전에는 Speak Loop 가 없다', { skip: SKIP }, async () => {
  for (const [name, me, token] of [['로그인 전', null, null], ['값 없음', {}, userToken()], ['false', { perm_speakloop: false }, userToken()], ['문자열 "true"', { perm_speakloop: 'true' }, userToken()]]) {
    const page = await openHome(me, { token });
    assert.deepEqual(await cycle(page), BASE6, name);
    await page.close();
  }
});

test('홈 휠: perm_speakloop=true 는 맨 끝에 Speak Loop, 관리자(role=admin)도 보인다', { skip: SKIP }, async () => {
  let page = await openHome({ perm_speakloop: true });
  assert.deepEqual(await cycle(page), [...BASE6, 'Speak Loop']);
  await page.close();
  page = await openHome({ role: 'admin' });   // 관리자는 문장 학습(언어 사전 다음)도 함께 보인다
  assert.deepEqual(await cycle(page), ['언어 사전', '문장 학습', ...BASE6.slice(1), 'Speak Loop']);
  await page.close();
});

test('홈 휠: 다른 권한과 함께여도 Speak Loop 는 맨 끝, 항목을 고르면 /speakloop.html 로 이동한다', { skip: SKIP }, async () => {
  const page = await openHome({ perm_speakloop: true, perm_concept_map: true });
  assert.deepEqual(await cycle(page), [...BASE6, '개념 지도', 'Speak Loop']);
  await page.close();
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'home-wheel', 'src', 'HomeWheelApp.jsx'), 'utf8');
  assert.match(src, /user\.perm_speakloop === true \|\| user\.role === 'admin'/);
  assert.match(src, /id: 'speakloop', name: 'Speak Loop'[^}]*url: '\/speakloop\.html'/);
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'home', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'home', 'assets', /assets\/([^"]+\.js)/.exec(html)[1]), 'utf8');
  assert.ok(js.includes('/speakloop.html'), '커밋된 빌드 산출물에 항목이 들어 있다');
});
