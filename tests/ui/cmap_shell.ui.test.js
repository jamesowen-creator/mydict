// 작업270-1: 개념 지도 틀. (1) /concept_map.html 접근 거부·표시(fail-closed) (2) 홈 휠: 권한자에게만 "개념 지도", 그 밖은 기존 6개 그대로 (3) 관리자 "개념 지도" 열.
// 실행: node --test "tests/ui/cmap_shell.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const userToken = (role = 'user') => `${b64({ alg: 'none' })}.${b64({ id: 7, role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const BASE6 = ['언어 사전', '문학 나침반', '한입 독서', '과학', '음성 학습', '작가 노트'];   // 작업N: 현재 기본 휠(개념학습 삭제, 작가 노트 포함). 개념 지도는 그 뒤에 붙는다
const labels = page => page.eval("[...document.querySelectorAll('[role=option]')].map(o => o.getAttribute('aria-label').split(' — ')[0])");

async function openMap(me, { token = userToken() } = {}) {
  srv.reset();
  if (me === 'fail') srv.state.authed = false; else srv.state.me = { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', ...me };
  const page = await browser.newPage({ width: 390, height: 844, token });
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("document.getElementById('loading').hidden", 6000);
  return page;
}
const visible = (page, id) => page.eval(`!document.getElementById('${id}').hidden`);

test('개념 지도 화면: 권한 없음·값 없음·조회 실패·토큰 없음은 접근 거부', { skip: SKIP }, async () => {
  for (const [name, me, opts] of [['false', { perm_concept_map: false }, {}], ['값 없음', {}, {}], ['조회 실패(401)', 'fail', {}], ['토큰 없음', { perm_concept_map: true }, { token: null }]]) {
    const page = await openMap(me, opts);
    assert.equal(await visible(page, 'access-denied'), true, name + ': 접근 거부 화면');
    assert.equal(await visible(page, 'app'), false, name + ': 본문 숨김');
    assert.match(await page.text('#access-denied'), /이용 권한이 없습니다/);
    await page.close();
  }
});

test('개념 지도 화면: 권한 있으면 제목과 본문 표시, 390px에서 가로 스크롤 없고 상단 잘림 없음', { skip: SKIP }, async () => {
  const page = await openMap({ perm_concept_map: true });
  assert.equal(await visible(page, 'app'), true);
  assert.equal(await visible(page, 'access-denied'), false);
  assert.equal(await page.text('.screen-bar-title'), '개념 지도');
  assert.equal(await page.hasHorizontalScroll(), false);
  // 작업271-2: 2a 단계에서 "개발 중" 안내 문구는 주제·개념 화면으로 바뀜(이 파일의 모의 서버에는 /api/cmap 이 없어 목록 조회는 실패하고, 화면은 오류 문구만 보여 줌)
  const r = await page.eval(`(() => { const hdr = document.querySelector('.metis-app-header').getBoundingClientRect(), bar = document.querySelector('.screen-bar').getBoundingClientRect(), sec = document.getElementById('landing-view').getBoundingClientRect();
    return { hdrBottom: hdr.bottom, barTop: bar.top, barBottom: bar.bottom, secTop: sec.top, secRight: sec.right, vw: innerWidth }; })()`);
  assert.ok(r.barTop >= r.hdrBottom - 1, '제목 줄이 공용 헤더 아래');
  assert.ok(r.secTop >= r.barBottom, '본문이 제목 줄에 가려지지 않음');
  assert.ok(r.secRight <= r.vw, '본문이 화면 안');
  // 뒤로 가기 → 홈
  await page.click('#back-btn');
  await page.waitFor("location.pathname === '/'", 6000);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

async function openHome(me, token) {
  srv.reset();
  if (me) srv.state.me = { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', ...me };
  const page = await browser.newPage({ width: 390, height: 844, token });
  await page.goto(srv.url + '/');
  await page.waitFor("document.querySelectorAll('[role=option]').length >= 6", 8000);
  await sleep(500);   // /api/me 응답 반영(권한자는 휠이 다시 만들어짐)
  return page;
}

test('홈 휠: 권한 없는 계정·권한 false·값 없음·로그인 전은 기본 6개와 순서·개수가 같다', { skip: SKIP }, async () => {
  for (const [name, me, token] of [['로그인 전', null, null], ['값 없음', {}, userToken()], ['false', { perm_concept_map: false }, userToken()], ['문자열 "true"', { perm_concept_map: 'true' }, userToken()]]) {
    const page = await openHome(me, token);
    assert.deepEqual(await labels(page), BASE6, name);
    assert.equal(await page.count('[role=option]'), 6, name + ': 항목 수');
    await page.close();
  }
});

test('홈 휠: 권한자(perm_concept_map=true)에게만 "개념 지도"가 맨 끝(작가 노트 다음)에 보이고, 돌려서 누르면 /concept_map.html', { skip: SKIP }, async () => {
  const page = await openHome({ perm_concept_map: true }, userToken());
  assert.deepEqual(await labels(page), [...BASE6, '개념 지도']);
  assert.match(await page.eval("document.querySelectorAll('[role=option]')[6].getAttribute('aria-label')"), /개발 중/);
  await page.eval("document.querySelector('[role=listbox]').focus()");
  for (let i = 0; i < 6; i++) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await sleep(60);
  }
  await page.waitFor("document.querySelector('[role=option][aria-selected=true]').getAttribute('aria-label').startsWith('개념 지도')", 4000);
  await page.click('[role=option][aria-selected=true]');
  await page.waitFor("location.pathname === '/concept_map.html'", 6000);
  await page.close();
});

test('관리자: "개념 지도" 열이 "음성 학습"(작업CL-1: 개념학습 삭제) 다음에 있고, 값이 없으면 꺼짐(옛 열과 반대), 켜고 저장하면 perm_concept_map만 전송', { skip: SKIP }, async () => {
  srv.reset();
  const row = (id, name, extra = {}) => ({ id, email: `u${id}@example.com`, name, role: 'user', is_blocked: false, is_approved: true, can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true,
    perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true, perm_voice_study: true, perm_concept_study: true, created_at: '2026-01-01', wordbook_count: 0, search_count: 0, tts_count: 0, ...extra });
  srv.state.me = { id: 7, email: 'u7@example.com', name: '관리자', role: 'admin' };
  srv.state.adminUsers = [row(7, '관리자', { role: 'admin', perm_concept_map: true }), row(8, '학생')];
  const page = await browser.newPage({ width: 1024, height: 800, token: userToken('admin') });
  await page.goto(srv.url + '/admin');
  await page.waitFor("document.querySelectorAll('#user-tbody tr').length === 2", 8000);
  const heads = await page.eval("[...document.querySelectorAll('thead th')].map(t => t.innerText.trim())");
  const i = heads.indexOf('음성 학습');
  assert.equal(heads[i + 1], '개념 지도');
  assert.equal(await page.eval("document.querySelectorAll('thead th').length"), await page.eval("document.querySelectorAll('#row-8 > td').length"), '열 수가 머리글과 같음');
  const cell = id => `#row-${id} > td:nth-child(${i + 2}) input`;
  assert.equal(await page.eval(`document.querySelector(${JSON.stringify(cell(7))}).checked`), true, '켜진 계정');
  assert.equal(await page.eval(`document.querySelector(${JSON.stringify(cell(8))}).checked`), false, '값 없는 계정은 꺼짐');
  await page.eval(`document.querySelector(${JSON.stringify(cell(8))}).click()`);
  await page.click('#save-8');
  await page.waitFor("document.getElementById('toast').innerText.includes('저장되었습니다')");
  const patch = srv.state.log.filter(l => l.method === 'PATCH' && l.url === '/api/admin/users/8').pop();
  assert.deepEqual(patch.body, { perm_concept_map: true });
  assert.equal(srv.state.adminUsers[1].perm_concept_study, true, '옛 권한은 그대로');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});
