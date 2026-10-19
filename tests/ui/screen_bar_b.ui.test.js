// 작업200: 음성 학습의 공용 제목 줄(.screen-bar), 코랄 주제색 (작업CL-1: 개념학습 시험은 화면 삭제와 함께 제거)
// (헤드리스 Chrome, 모의 API, 390/768/1024px). 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const css = (page, expr, prop) => page.eval(`(() => { const e = ${expr}; return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null; })()`);

for (const w of [390, 768, 1024]) {
  test(`음성 학습 ${w}px: 목록엔 제목 줄 없음·하위 화면엔 하나, 개인정보 안내와 겹치지 않고 공용 헤더 아래에 붙음, 코랄 주제색`, { skip: SKIP }, async () => {
    srv.reset();
    srv.state.me.perm_voice_study = true;
    srv.state.voiceNotes = [];
    const page = await browser.newPage({ width: w, height: 844 });
    await page.goto(srv.url + '/voice_study.html');
    await page.waitFor("document.getElementById('list-count').textContent === '0건'", 8000);
    assert.equal(await page.visible('.screen-bar'), false, '목록 화면에는 제목 줄 없음');
    assert.equal(await page.visible('.notice-wrap'), true, '개인정보 안내 표시');
    assert.equal(await page.count('.top-bar, .back-btn, .bar-title'), 0, '옛 복사본 클래스 없음');
    await page.click('#new-rec-btn');
    await page.waitFor("document.getElementById('page-title').textContent === '새로 녹음'", 4000);
    assert.equal(await page.count('.screen-bar'), 1);
    assert.equal(await page.visible('.screen-bar'), true);
    assert.equal(await page.text('.screen-bar-title'), '새로 녹음');
    const back = await page.eval("(() => { const r = document.getElementById('back-btn').getBoundingClientRect(); return [r.width, r.height]; })()");
    assert.ok(back[0] >= 44 && back[1] >= 44, '뒤로가기 44px ' + back);
    const g = await page.eval(`(() => { const b = document.querySelector('.screen-bar').getBoundingClientRect(), n = document.querySelector('.notice-wrap').getBoundingClientRect(), z = document.querySelector('.sticky-zone').getBoundingClientRect(); return { barBottom: b.bottom, noticeTop: n.top, zoneTop: z.top }; })()`);
    assert.ok(g.barBottom <= g.noticeTop + 1, '제목 줄과 안내가 겹치지 않음 ' + JSON.stringify(g));
    await page.eval('document.getElementById("app").style.minHeight = "3000px"; window.scrollTo(0, 800)');
    await sleep(200);
    assert.equal(await page.eval("Math.round(document.querySelector('.sticky-zone').getBoundingClientRect().top)"), 65, '스크롤해도 공용 헤더 바로 아래에 붙음');
    assert.equal(await css(page, "document.querySelector('.btn')", 'backgroundColor'), 'rgb(184, 68, 46)', '주 버튼은 진한 코랄(--btn-primary-bg)');
    assert.equal(await page.eval("getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase()"), '#e2583b');
    assert.equal(await page.eval("getComputedStyle(document.documentElement).getPropertyValue('--success-dark').trim().toLowerCase()"), '#085041', '의미색(정답)은 초록 유지: --success-dark(ok-ink)');
    assert.equal(await page.hasHorizontalScroll(), false);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
