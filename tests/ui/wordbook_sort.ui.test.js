// 작업259-1: 사전 단어장 기본 정렬은 최신순(영어·한국어·일본어·중국어 모두), 사이드바 정렬 항목은 최신순이 위·ABC순이 아래.
// 정렬 상태는 저장하지 않는 변수 하나(wordbookSortOrder)라 옛 저장값 문제는 없다. 단어장을 열 때·언어를 바꿀 때 최신순으로 돌아간다.
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
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

// 추가 시각이 ABC순(가나다순)과 뚜렷이 다르게, savedAt 없는 항목(맨 뒤, 서로는 기존 순서)도 하나씩 둔다
const SEED = {
  en: [['banana', 3000], ['apple', 1000], ['cherry', 2000], ['zed', undefined], ['aaa', undefined]],
  ko: [['나무', 3000], ['가방', 1000], ['다리', 2000]],
  ja: [['さくら', 3000], ['あめ', 1000], ['ねこ', 2000]],
  zh: [['你好', 3000], ['爱', 1000], ['谢谢', 2000]],
};
const RECENT = { en: ['banana', 'cherry', 'apple', 'zed', 'aaa'], ko: ['나무', '다리', '가방'], ja: ['さくら', 'ねこ', 'あめ'], zh: ['你好', '谢谢', '爱'] };

async function openWordbook(width) {
  srv.reset();
  const page = await browser.newPage({ width, height: 844, token: jwt() });
  await page.goto(srv.url + '/english_dictionary.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
  const rows = Object.entries(SEED).flatMap(([lang, ws]) => ws.map(([word, t]) => ({ word, lang, ...(t === undefined ? {} : { savedAt: t }) })));
  await page.eval(`wordbook = ${JSON.stringify(rows)}; showPage('wordbook')`);
  await sleep(150);
  return page;
}
const words = page => page.eval("[...document.querySelectorAll('.word-chip-text')].map(e => e.textContent)");
// 정렬 버튼을 실제로 누른다(전체 테스트처럼 느린 환경에서 고정 요소가 버튼을 가리는 경우가 있어 요소의 click()을 쓴다)
const pick = (page, sort) => page.eval(`document.querySelector('[data-sort="${sort}"]').click()`);
const sortBar = page => page.eval("[...document.querySelectorAll('.wb-sort-btn')].map(b => b.dataset.sort + (b.classList.contains('active') ? '*' : ''))");

for (const w of [390, 1280]) {
  test(`단어장 ${w}px: 정렬 항목은 최신순이 위·ABC순이 아래, 처음엔 최신순이 선택됨(화면 위치도 위→아래)`, { skip: SKIP }, async () => {
    const page = await openWordbook(w);
    assert.deepEqual(await sortBar(page), ['recent*', 'abc']);
    const ys = await page.eval("[...document.querySelectorAll('.wb-sort-btn')].map(b => b.getBoundingClientRect().top)");
    assert.ok(ys[0] < ys[1], '최신순 버튼이 ABC순 버튼보다 위 ' + ys);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test(`단어장 ${w}px: 4개 언어 모두 처음 열면 최신순(없는 항목은 맨 뒤·기존 순서), ABC순→다시 최신순, 언어를 바꾸면 최신순으로 돌아감`, { skip: SKIP }, async () => {
    const page = await openWordbook(w);
    for (const lang of ['en', 'ko', 'ja', 'zh']) {
      await page.eval(`switchWordbookTab(${JSON.stringify(lang)})`);
      assert.deepEqual(await words(page), RECENT[lang], lang + ': 기본 최신순');
      assert.deepEqual(await sortBar(page), ['recent*', 'abc'], lang + ': 선택 표시가 최신순');
    }
    await page.eval("switchWordbookTab('en')");
    await pick(page, 'abc');
    assert.deepEqual(await words(page), ['aaa', 'apple', 'banana', 'cherry', 'zed'], 'ABC순');
    assert.deepEqual(await sortBar(page), ['recent', 'abc*']);
    await pick(page, 'recent');
    assert.deepEqual(await words(page), RECENT.en, '다시 최신순');
    await pick(page, 'abc');
    await page.eval("switchWordbookTab('ko')");
    assert.deepEqual(await words(page), RECENT.ko, '언어를 바꾸면 최신순');
    await pick(page, 'abc');
    await page.eval("showPage('search'); showPage('wordbook')");
    assert.deepEqual(await words(page), RECENT.ko, '단어장을 다시 열면 최신순');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
