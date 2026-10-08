// 작업203: 개념학습 "연결" 섹션 - 직접 연결 추가·삭제·중복 오류·AI/직접 구분·지도 반영(헤드리스 Chrome, 모의 API).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { dialogAnswer } = require('./helpers/dialog');
const { openMap, closeMap } = require('./helpers/map');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const seed = s => s.seed({ topic: '생물 · 세포', items: [{ term: '세포' }, { term: '광합성' }, { term: '엽록체' }], links: [[0, 1]], path: [0, 1] });
async function openStudy(width = 390) {
  srv.reset();
  seed(srv);
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  return page;
}
const calls = (re, method) => srv.state.log.filter(l => re.test(l.url) && (!method || l.method === method));
async function pickOption(page, selectSel, text) {
  await page.eval(`(() => { const s = document.querySelector(${JSON.stringify(selectSel)}); const o = [...s.options].find(o => o.textContent === ${JSON.stringify(text)}); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

test('연결 목록: 현재 개념의 연결만 표시, AI 연결·직접 연결을 구분하는 문구는 없음', { skip: SKIP }, async () => {
  const page = await openStudy();
  assert.equal(await page.count('[data-t="link"]'), 1);
  assert.match(await page.text('[data-t="link"] .lk-pair'), /세포 → 광합성/);
  // 작업210: 출처 배지 제거(저장값 source는 그대로)
  assert.equal(await page.count('[data-t="link-source"]'), 0);
  await page.click('[data-t="link-open"]');
  await pickOption(page, '#link-to', '엽록체');
  await pickOption(page, '#link-type', '순서');
  await page.type('#link-label', '다음 단계');
  await page.click('[data-t="link-save"]');
  await page.waitFor("document.querySelectorAll('[data-t=link]').length === 2");
  const post = calls(/\/links$/, 'POST').pop();
  assert.equal(post.body.to_item_id, srv.state.items.find(i => i.term === '엽록체').id);
  assert.equal(post.body.from_item_id, srv.state.items.find(i => i.term === '광합성').id, '현재 개념에서 이어짐');
  assert.equal(post.body.relation_type, '순서');
  assert.equal(post.body.label, '다음 단계');
  assert.equal(await page.count('[data-t="link-source"]'), 0);
  assert.doesNotMatch(await page.text('#linksec'), /AI 판단|확인 필요|직접 연결|직접 수정/);
  assert.deepEqual(srv.state.links.map(l => l.source).sort(), ['ai', 'user'], '저장값 source는 그대로');
  // 지도에는 코드 변경 없이 새 연결이 그려진다
  await openMap(page);   // 작업209-4: 지도는 팝업
  assert.equal(await page.count('[data-t="edge"]'), 2, '지도의 연결선 2개');
  await closeMap(page);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('이미 연결된 쌍: 서버 오류 문구를 그대로 보여 주고 연결은 늘지 않음', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="link-open"]');
  await pickOption(page, '#link-to', '세포');   // 세포-광합성은 이미 연결(반대 방향)
  await page.click('[data-t="link-save"]');
  await page.waitFor("document.querySelector('[data-t=link-form] .msg').textContent.length > 0");
  assert.equal(await page.text('[data-t="link-form"] .msg'), '이미 연결되어 있습니다.');
  assert.equal(srv.state.links.length, 1);
  assert.equal(await page.visible('[data-t="link-form"]'), true, '폼은 열린 채 유지');
  await page.click('[data-t="link-cancel"]');
  assert.equal(await page.exists('[data-t="link-form"]'), false);
  assert.equal(await page.visible('[data-t="link-open"]'), true);
  await page.close();
});

test('관계 문구는 40자까지, 개념이 1개뿐이면 연결 추가 버튼 없음', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="link-open"]');
  assert.equal(await page.eval("document.getElementById('link-label').maxLength"), 40);
  assert.deepEqual(await page.eval("[...document.getElementById('link-type').options].map(o => o.value)"), ['포함', '원인→결과', '순서', '대비', '비슷함', '기타 관련']);
  await page.close();
  srv.reset();
  srv.seed({ topic: '하나뿐', items: [{ term: '혼자' }] });
  const p2 = await browser.newPage({ width: 390, height: 844 });
  await p2.goto(srv.url + '/concept_study.html');
  await p2.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await p2.click('[data-t="open-study"]');
  await p2.waitFor("!!document.querySelector('[data-t=term]')");
  assert.equal(await p2.exists('[data-t="link-open"]'), false);
  assert.equal(await p2.count('[data-t="link"]'), 0);
  assert.match(await p2.text('[data-t="no-links"]'), /연결이 아직 없습니다/);
  await p2.close();
});

test('연결 삭제: 취소하면 그대로, 확인하면 삭제되고 지도에서도 사라짐', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="link-delete"]');
  assert.equal(await dialogAnswer(page, false), '이 연결을 삭제할까요?');   // 작업207: 기본 confirm 대신 공용 대화상자
  await sleep(300);
  assert.equal(calls(/\/api\/concepts\/links\/\d+$/, 'DELETE').length, 0);
  assert.equal(await page.count('[data-t="link"]'), 1);
  await page.click('[data-t="link-delete"]');
  await dialogAnswer(page, true);
  await page.waitFor("document.querySelectorAll('[data-t=link]').length === 0");
  assert.equal(calls(/\/api\/concepts\/links\/\d+$/, 'DELETE').length, 1);
  assert.equal(srv.state.links.length, 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

for (const w of [390, 768, 1024]) {
  test(`연결 섹션 ${w}px: 가로 스크롤 없음, 버튼 44px 이상`, { skip: SKIP }, async () => {
    const page = await openStudy(w);
    await page.click('[data-t="link-open"]');
    await page.eval("document.getElementById('linksec').scrollIntoView()");
    assert.equal(await page.hasHorizontalScroll(), false);
    const small = await page.eval(`[...document.querySelectorAll('#linksec button, #linksec select, #linksec input')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || (r.width < 43.5 && !b.classList.contains('text'))); }).map(b => b.id || b.dataset.t)`);
    assert.deepEqual(small, [], '44px 미만 요소');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
