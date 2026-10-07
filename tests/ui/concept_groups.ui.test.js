// 작업204: 개념학습 목록 보기의 [목록 | 그룹] 전환, 그룹 접기·펼치기·요약, 상세 화면의 그룹 바꾸기(헤드리스 Chrome, 모의 API).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const calls = (re, method) => srv.state.log.filter(l => re.test(l.url) && (!method || l.method === method));
async function openList(items, width = 390) {
  srv.reset();
  srv.seed({ topic: '생물 · 세포', items });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  await page.click('#seg-list');
  await page.waitFor("!!document.querySelector('[data-t=list-mode]')");
  return page;
}
const groupsOf = page => page.eval("[...document.querySelectorAll('[data-t=group]')].map(g => g.dataset.group + '|' + g.querySelector('[data-t=group-sum]').textContent + '|' + g.querySelectorAll('[data-t=list-item]').length)");
const basic = [
  { term: '광합성', set: { group_label: '에너지', review_state: 'understood' } },
  { term: '엽록체', set: { group_label: '에너지', review_state: 'confused' } },
  { term: '세포벽', set: { group_label: '구조', review_state: 'new' } },
  { term: '세포', set: { group_label: null } },
  { term: '옛 개념', set: { group_label: null, review_state: 'understood' } },
];

test('그룹 보기: 그룹별 개수·이해 상태 요약, 그룹 없음 묶음은 맨 아래', { skip: SKIP }, async () => {
  const page = await openList(basic);
  assert.equal(await page.eval("document.querySelector('[data-t=list-mode-group]').getAttribute('aria-pressed')"), 'true', '기본은 그룹');
  assert.deepEqual(await groupsOf(page), ['구조|1개 · 이해 0 · 헷갈림 0 · 새것 1|1', '에너지|2개 · 이해 1 · 헷갈림 1 · 새것 0|2', '|2개 · 이해 1 · 헷갈림 0 · 새것 1|2']);
  assert.match(await page.text('[data-t="group"][data-group=""] .grp-name'), /그룹 없음/);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('접기·펼치기: 화면에서만 유지(서버 호출 없음), 다른 그룹은 그대로', { skip: SKIP }, async () => {
  const page = await openList(basic);
  const before = srv.state.log.length;
  await page.click('[data-t="group"][data-group="에너지"] [data-t="group-toggle"]');
  assert.equal(await page.eval("document.querySelector('[data-t=group][data-group=에너지] [data-t=group-toggle]').getAttribute('aria-expanded')"), 'false');
  assert.equal(await page.count('[data-t="group"][data-group="에너지"] [data-t="list-item"]'), 0, '접으면 개념이 숨겨짐');
  assert.equal(await page.count('[data-t="group"][data-group="구조"] [data-t="list-item"]'), 1);
  assert.match(await page.text('[data-t="group"][data-group="에너지"] [data-t="group-sum"]'), /2개 · 이해 1/, '접어도 요약은 보임');
  assert.equal(srv.state.log.length, before, '서버에 저장하지 않음');
  await page.click('[data-t="group"][data-group="에너지"] [data-t="group-toggle"]');
  assert.equal(await page.count('[data-t="group"][data-group="에너지"] [data-t="list-item"]'), 2);
  await page.close();
});

test('[목록 | 그룹] 전환: 목록은 묶음 없이 전체 개념', { skip: SKIP }, async () => {
  const page = await openList(basic);
  await page.click('[data-t="list-mode-flat"]');
  assert.equal(await page.count('[data-t="group"]'), 0);
  assert.equal(await page.count('[data-t="list-item"]'), 5);
  assert.equal(await page.eval("document.querySelector('[data-t=list-mode-flat]').getAttribute('aria-pressed')"), 'true');
  await page.click('[data-t="list-mode-group"]');
  assert.equal(await page.count('[data-t="group"]'), 3);
  await page.close();
});

test('그룹 없음만 있을 때: 한 묶음 "그룹 없음"', { skip: SKIP }, async () => {
  const page = await openList([{ term: '가', set: { group_label: null } }, { term: '나', set: { group_label: null } }]);
  assert.deepEqual(await groupsOf(page), ['|2개 · 이해 0 · 헷갈림 0 · 새것 2|2']);
  await page.close();
});

test('그룹 바꾸기: 상세에서 PATCH(group_label)로 옮기고, 비우면 그룹 없음, 31자는 거부', { skip: SKIP }, async () => {
  const page = await openList(basic);
  await page.click('[data-t="list-item"]');            // 첫 개념 선택(구조 그룹의 세포벽)
  await page.waitFor("document.querySelector('[data-t=term]').textContent === '세포벽'");
  await page.click('[data-t="group-edit"]');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#group-names option')].map(o => o.value)"), ['구조', '에너지']);
  await page.eval("document.getElementById('group-input').value = 'x'.repeat(31)");
  await page.click('[data-t="group-save"]');
  assert.equal(await page.text('[data-t="group-form"] .msg'), '그룹은 30자 이하여야 합니다.');
  assert.equal(calls(/\/api\/concepts\/items\/\d+$/, 'PATCH').length, 0, '서버 호출 전에 거부');
  await page.type('#group-input', '에너지');
  await page.click('[data-t="group-save"]');
  await page.waitFor("!document.querySelector('[data-t=group-form]')");
  assert.equal(calls(/\/api\/concepts\/items\/\d+$/, 'PATCH').pop().body.group_label, '에너지');
  assert.deepEqual(await groupsOf(page), ['에너지|3개 · 이해 1 · 헷갈림 1 · 새것 1|3', '|2개 · 이해 1 · 헷갈림 0 · 새것 1|2']);
  await page.click('[data-t="group-edit"]');
  await page.type('#group-input', '');
  await page.click('[data-t="group-save"]');
  await page.waitFor("!document.querySelector('[data-t=group-form]')");
  assert.equal(calls(/\/api\/concepts\/items\/\d+$/, 'PATCH').pop().body.group_label, '');
  assert.deepEqual(page.errors, []);
  await page.close();
});

for (const w of [390, 768, 1024]) {
  test(`한 그룹 60개 ${w}px: 접기·펼치기, 가로 스크롤 없음`, { skip: SKIP }, async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ term: '개념' + i, set: { group_label: '큰그룹' + 'ㅁ'.repeat(20), review_state: i % 3 === 0 ? 'understood' : i % 3 === 1 ? 'confused' : 'new' } }));
    const page = await openList(items, w);
    assert.equal(await page.count('[data-t="list-item"]'), 60);
    assert.match(await page.text('[data-t="group-sum"]'), /^60개 · 이해 20 · 헷갈림 20 · 새것 20$/);
    assert.equal(await page.hasHorizontalScroll(), false, '펼친 상태');
    await page.click('[data-t="group-toggle"]');
    assert.equal(await page.count('[data-t="list-item"]'), 0);
    assert.equal(await page.hasHorizontalScroll(), false, '접힌 상태');
    const h = await page.eval("document.querySelector('[data-t=group-toggle]').getBoundingClientRect().height");
    assert.ok(h >= 43.5, '그룹 머리줄 44px 이상 ' + h);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
