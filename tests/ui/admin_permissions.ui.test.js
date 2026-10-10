// 작업243-2: 관리자 화면 — 사용자 현황 삭제, 헤더·본문 680px 가운데, 권한 열이 랜딩페이지 과목 기준(언어 사전 = 기능 권한 5개 묶음, 혼합 상태).
// 헤드리스 Chrome, 모의 API(tests/ui/helpers/mock_server.js). 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const adminToken = () => `${b64({ alg: 'none' })}.${b64({ id: 7, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const DICT = ['can_search', 'can_wordbook', 'can_quiz', 'can_tts', 'can_podcast'];
const userRow = (id, name, extra = {}) => ({
  id, email: `u${id}@example.com`, name, role: 'user', is_blocked: false, is_approved: true, can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true, perm_voice_study: true, perm_concept_study: true,
  created_at: '2026-01-01', wordbook_count: 0, search_count: 0, tts_count: 0, ...extra,
});
async function openAdmin(users, { width = 1280, height = 800 } = {}) {
  srv.reset();
  srv.state.me = { id: 7, email: 'u7@example.com', name: '관리자', role: 'admin' };
  srv.state.adminUsers = users;
  const page = await browser.newPage({ width, height, token: adminToken() });
  await page.goto(srv.url + '/admin');
  await page.waitFor(`document.querySelectorAll('#user-tbody tr').length === ${users.length}`, 8000);
  return page;
}
const patches = id => srv.state.log.filter(l => l.method === 'PATCH' && l.url === '/api/admin/users/' + id);
const cellSel = (id, col) => `#row-${id} > td:nth-child(${col}) input`;
const COL = { dictionary: 5, literature: 6, digest: 7, science: 8, voice: 9, concept: 10 };   // 사용자 · 역할 · 승인 · 차단 · 그다음 과목 열
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);

test('사용자 현황 섹션과 #stats-grid 가 없고, API 비용 추정·사용자 관리 섹션은 있다', { skip: SKIP }, async () => {
  const page = await openAdmin([userRow(7, '관리자', { role: 'admin' }), userRow(8, '학생')]);
  assert.equal(await page.eval("!!document.getElementById('stats-grid') || !!document.getElementById('stats-updated')"), false);
  const titles = await page.eval("[...document.querySelectorAll('.section-title')].map(e => e.textContent.trim())");
  assert.deepEqual(titles, ['API 비용 추정', '사용자 관리']);
  assert.equal(await page.eval("document.querySelectorAll('#cost-grid .cost-card').length"), 2, '비용 카드(전체 누적·이번달)가 그려짐');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

for (const width of [1280, 390]) {
  test(`폭 ${width}px: 헤더·본문이 680px 이하로 가운데에 놓이고, 페이지는 가로로 스크롤되지 않으며 표만 스크롤된다`, { skip: SKIP }, async () => {
    const page = await openAdmin([userRow(7, '관리자', { role: 'admin' }), userRow(8, '학생')], { width });
    const m = await page.eval(`(() => {
      const r = e => { const b = document.querySelector(e).getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
      const wrap = document.querySelector('.table-wrap');
      return { vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, header: r('header'), main: r('main'), wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth,
        headerMinH: document.querySelector('header').getBoundingClientRect().height, headerPadL: getComputedStyle(document.querySelector('header')).paddingLeft };
    })()`);
    const maxW = Math.min(680, width);
    assert.ok(m.header.width <= 680.5 && m.main.width <= 680.5, `폭 ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.header.width - maxW) <= 1 && Math.abs(m.main.width - maxW) <= 1, '680px(또는 화면 폭)을 채움');
    const margin = (width - maxW) / 2;
    assert.ok(Math.abs(m.header.left - margin) <= 1 && Math.abs(m.main.left - margin) <= 1, `가운데: 좌측 여백 ${m.header.left}`);
    assert.ok(Math.abs((width - m.header.right) - margin) <= 1, '오른쪽 여백도 같음');
    assert.ok(m.sw <= m.vw, `페이지 가로 스크롤 없음: scrollWidth ${m.sw} / ${m.vw}`);
    assert.ok(m.wrapScroll > m.wrapClient, `표는 .table-wrap 안에서 가로 스크롤: ${m.wrapScroll} > ${m.wrapClient}`);
    assert.ok(m.headerMinH >= 64.5, `헤더 높이 65px 이상: ${m.headerMinH}`);
    assert.equal(m.headerPadL, '16px', '헤더 좌우 여백 16px');
    console.log(`[측정] 폭 ${width}: 헤더 폭 ${m.header.width}px 좌 ${m.header.left} 우 ${width - m.header.right}, 본문 폭 ${m.main.width}px, 헤더 높이 ${m.headerMinH}px, 표 스크롤 ${m.wrapScroll}/${m.wrapClient}`);
    await page.close();
  });
}

test('표 머리글 순서: 사용자·역할·승인·차단·과목 6열·사용 횟수 3열·저장', { skip: SKIP }, async () => {
  const page = await openAdmin([userRow(7, '관리자', { role: 'admin' }), userRow(8, '학생')]);
  const heads = await page.eval("[...document.querySelectorAll('thead th')].map(t => t.innerText.trim())");
  assert.deepEqual(heads, ['사용자', '역할', '승인', '차단', '언어 사전', '문학 나침반', '한입 독서', '과학', '음성 학습', '개념학습', '검색 횟수', 'TTS 횟수', '단어장', '저장']);
  assert.equal(await page.eval("document.querySelectorAll('#row-8 > td').length"), heads.length, '열 수가 머리글과 같음');
  await page.close();
});

test('언어 사전 토글: 5개 모두 켜짐=켜짐, 모두 꺼짐=꺼짐, 섞임=혼합(aria-checked=mixed), 누르면 켜짐↔꺼짐·혼합→켜짐', { skip: SKIP }, async () => {
  const allOff = Object.fromEntries(DICT.map(f => [f, false]));
  const page = await openAdmin([userRow(7, '관리자', { role: 'admin' }), userRow(8, '켜짐'), userRow(9, '꺼짐', allOff), userRow(10, '혼합', { can_quiz: false, can_podcast: false })]);
  const st = id => page.eval(`(() => { const i = document.querySelector(${JSON.stringify(cellSel(id, COL.dictionary))}); return { checked: i.checked, mixed: i.indeterminate, aria: i.getAttribute('aria-checked'), data: i.getAttribute('data-mixed') }; })()`);
  assert.deepEqual(await st(8), { checked: true, mixed: false, aria: 'true', data: null });
  assert.deepEqual(await st(9), { checked: false, mixed: false, aria: 'false', data: null });
  assert.deepEqual(await st(10), { checked: false, mixed: true, aria: 'mixed', data: '1' });
  const bg = await page.eval(`getComputedStyle(document.querySelector(${JSON.stringify(cellSel(10, COL.dictionary))}).nextElementSibling).backgroundColor`);
  assert.notEqual(bg, await page.eval(`getComputedStyle(document.querySelector(${JSON.stringify(cellSel(9, COL.dictionary))}).nextElementSibling).backgroundColor`), '혼합은 꺼짐과 다른 색');
  await click(page, cellSel(8, COL.dictionary)); assert.deepEqual(await st(8), { checked: false, mixed: false, aria: 'false', data: null }, '켜짐 → 꺼짐');
  await click(page, cellSel(9, COL.dictionary)); assert.deepEqual(await st(9), { checked: true, mixed: false, aria: 'true', data: null }, '꺼짐 → 켜짐');
  await click(page, cellSel(10, COL.dictionary)); assert.deepEqual(await st(10), { checked: true, mixed: false, aria: 'true', data: null }, '혼합 → 켜짐');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('언어 사전 토글을 저장하면 PATCH 가 can_search·can_wordbook·can_quiz·can_tts·can_podcast 5개 키를 함께 보낸다', { skip: SKIP }, async () => {
  const page = await openAdmin([userRow(7, '관리자', { role: 'admin' }), userRow(8, '혼합', { can_quiz: false })]);
  await click(page, cellSel(8, COL.dictionary));   // 혼합 → 켜짐
  await page.click('#save-8');
  await page.waitFor("document.getElementById('toast').innerText.includes('저장되었습니다')");
  const p1 = patches(8).pop();
  assert.deepEqual(Object.keys(p1.body).sort(), DICT.slice().sort());
  assert.ok(DICT.every(f => p1.body[f] === true));
  assert.ok(DICT.every(f => srv.state.adminUsers[1][f] === true));
  await click(page, cellSel(8, COL.dictionary));   // 켜짐 → 꺼짐
  await page.click('#save-8');
  const deadline = Date.now() + 5000;
  while (patches(8).length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  const p2 = patches(8).pop();
  assert.deepEqual(Object.keys(p2.body).sort(), DICT.slice().sort());
  assert.ok(DICT.every(f => p2.body[f] === false));
  await page.close();
});

test('문학·한입·과학·음성·개념 토글은 각각 컬럼 하나만 보낸다', { skip: SKIP }, async () => {
  const page = await openAdmin([userRow(7, '관리자', { role: 'admin' }), userRow(8, '학생')]);
  const cases = [['literature', 'perm_literature_compass'], ['digest', 'perm_digest_reading'], ['science', 'perm_science_reading'], ['voice', 'perm_voice_study'], ['concept', 'perm_concept_study']];
  let n = 0;
  for (const [col, field] of cases) {
    await click(page, cellSel(8, COL[col]));
    await page.click('#save-8');
    n++;
    const deadline = Date.now() + 5000;
    while (patches(8).length < n && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(patches(8).pop().body, { [field]: false }, col);
    assert.equal(srv.state.adminUsers[1][field], false);
    await page.waitFor("document.getElementById('save-8').textContent === '저장'", 4000);
  }
  assert.ok(DICT.every(f => srv.state.adminUsers[1][f] === true), '언어 사전 5개 권한은 바뀌지 않음');
  await page.close();
});
