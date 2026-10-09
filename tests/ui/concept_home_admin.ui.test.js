// 작업195-4: 홈 휠 메뉴의 "개념학습" 항목과 관리자 화면의 "개념" 권한 열(헤드리스 Chrome, 모의 API).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const adminToken = () => `${b64({ alg: 'none' })}.${b64({ id: 7, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const userRow = (id, name, extra = {}) => ({
  id, email: `u${id}@example.com`, name, role: 'user', is_blocked: false, is_approved: true, can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true, perm_voice_study: true, perm_concept_study: true,
  created_at: '2026-01-01', wordbook_count: 0, search_count: 0, tts_count: 0, ...extra,
});

test('홈 메뉴: 개념학습 항목이 음성 학습 다음에 있고, 가운데로 돌려 누르면 /concept_study.html로 이동', { skip: SKIP }, async () => {
  srv.reset();
  const page = await browser.newPage({ width: 390, height: 844, token: null });
  await page.goto(srv.url + '/');
  await page.waitFor("document.querySelectorAll('[role=option]').length >= 6", 8000);
  const labels = await page.eval("[...document.querySelectorAll('[role=option]')].map(o => o.getAttribute('aria-label').split(' — ')[0])");
  assert.deepEqual(labels, ['언어 사전', '문학 나침반', '한입 독서', '과학', '음성 학습', '개념학습']);   // 작업227-13: MetaCong 항목 제거
  assert.match(await page.eval("document.querySelectorAll('[role=option]')[5].getAttribute('aria-label')"), /개념 하나에서 시작해 한 걸음씩 넓히기/);
  await page.eval("document.querySelector('[role=listbox]').focus()");
  for (let i = 0; i < 5; i++) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await sleep(60);
  }
  await page.waitFor("document.querySelector('[role=option][aria-selected=true]').getAttribute('aria-label').startsWith('개념학습')", 4000);
  await page.click('[role=option][aria-selected=true]');
  await page.waitFor("location.pathname === '/concept_study.html'", 6000);
  await page.close();
});

test('홈 메뉴 빌드 결과물: public/home 번들이 index.html과 맞고 새 항목을 포함', { skip: SKIP }, async () => {
  const home = path.resolve(__dirname, '..', '..', 'public', 'home');
  const html = fs.readFileSync(path.join(home, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\/home\/assets\/([\w.-]+)/g)].map(m => m[1]);
  assert.ok(refs.length >= 2, 'index.html이 번들을 가리킴');
  for (const f of refs) assert.ok(fs.existsSync(path.join(home, 'assets', f)), '번들 파일 존재: ' + f);
  assert.deepEqual(fs.readdirSync(path.join(home, 'assets')).sort(), refs.slice().sort(), '쓰지 않는 옛 번들이 남아 있지 않음');
  const js = fs.readFileSync(path.join(home, 'assets', refs.find(f => f.endsWith('.js'))), 'utf8');
  assert.ok(js.includes('/concept_study.html') && js.includes('개념학습'));
  assert.ok(!html.includes('\r'), 'index.html은 LF');
});

test('관리자: "개념" 열이 "음성" 다음에 있고 토글하면 perm_concept_study가 저장됨', { skip: SKIP }, async () => {
  srv.reset();
  srv.state.me = { id: 7, email: 'u7@example.com', name: '관리자', role: 'admin' };
  srv.state.adminUsers = [userRow(7, '관리자', { role: 'admin' }), userRow(8, '학생')];
  const page = await browser.newPage({ width: 1024, height: 800, token: adminToken() });
  await page.goto(srv.url + '/admin');
  await page.waitFor("document.querySelectorAll('#user-tbody tr').length === 2", 8000);
  const heads = await page.eval("[...document.querySelectorAll('thead th')].map(t => t.innerText.trim())");
  const i = heads.indexOf('음성');
  assert.equal(heads[i + 1], '개념');
  assert.equal(await page.eval("document.querySelectorAll('thead th').length"), await page.eval("document.querySelectorAll('#row-8 > td').length"), '열 수가 머리글과 같음');
  const cell = `#row-8 > td:nth-child(${i + 2}) input`;
  assert.equal(await page.eval(`document.querySelector(${JSON.stringify(cell)}).checked`), true);
  // 토글 → 저장
  await page.eval(`document.querySelector(${JSON.stringify(cell)}).click()`);
  await page.click('#save-8');
  await page.waitFor("document.getElementById('toast').innerText.includes('저장되었습니다')");
  const patch = srv.state.log.filter(l => l.method === 'PATCH' && l.url === '/api/admin/users/8').pop();
  assert.deepEqual(patch.body, { perm_concept_study: false });
  assert.equal(srv.state.adminUsers[1].perm_concept_study, false);
  // 값이 없는 응답은 켜짐으로 표시(다른 권한 열과 같은 규칙), 꺼진 사용자는 꺼짐으로 표시
  delete srv.state.adminUsers[0].perm_concept_study;
  await page.goto(srv.url + '/admin');
  await page.waitFor("document.querySelectorAll('#user-tbody tr').length === 2", 8000);
  assert.equal(await page.eval(`document.querySelector('#row-7 > td:nth-child(${i + 2}) input').checked`), true);
  assert.equal(await page.eval(`document.querySelector('#row-8 > td:nth-child(${i + 2}) input').checked`), false);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});
