// 작업200: 음성 학습·개념학습의 공용 제목 줄(.screen-bar), 코랄 주제색, 개념학습의 사전 스타일(반경)과 다크모드 제거
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

  test(`개념학습 ${w}px: 학습 화면 제목 줄 하나·뒤로가기·보기 전환 44px, 사전 스타일(버튼·입력창 10px, 카드 16px), 다크모드 없음`, { skip: SKIP }, async () => {
    srv.reset();
    srv.seed({ topic: '생물 · 세포', items: [{ term: '세포' }, { term: '광합성' }], links: [[0, 1]], path: [0, 1] });
    const page = await browser.newPage({ width: w, height: 844 });
    await page.goto(srv.url + '/concept_study.html');
    await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
    await page.click('[data-t="open-study"]');
    await page.waitFor("!!document.querySelector('[data-t=term]')");
    assert.equal(await page.count('.screen-bar'), 1);
    assert.equal(await page.count('.study-bar, .study-title'), 0, '옛 클래스 없음');
    assert.equal(await page.text('.screen-bar-title'), '생물 · 세포');
    for (const sel of ['#back-btn', '#seg-map', '#seg-list']) {
      const r = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.width, r.height]; })()`);
      assert.ok(r[0] >= 44 && r[1] >= 44, sel + ' 44px ' + r);
    }
    // 스크롤해도 공용 헤더(65px) 바로 아래
    await page.eval('window.scrollTo(0, 1e6)');
    await sleep(200);
    if (await page.eval('window.scrollY > 0')) assert.equal(await page.eval("Math.round(document.querySelector('.screen-bar').getBoundingClientRect().top)"), 65);
    // 사전 스타일: 버튼·입력창 10px, 카드(지도 상자·대화상자) 16px
    assert.equal(await css(page, "document.getElementById('ask-submit')", 'borderRadius'), '10px', '주 버튼 반경');
    assert.equal(await css(page, "document.getElementById('ask-input')", 'borderRadius'), '10px', '입력창 반경');
    assert.equal(await css(page, "document.querySelector('.map-box') || document.getElementById('edge-dialog')", 'borderRadius'), '16px', '카드 반경');
    assert.equal(await css(page, "document.getElementById('ask-submit')", 'backgroundColor'), 'rgb(184, 68, 46)');
    // 다크모드 없음: 어두운 화면 설정으로 바꿔도 배경은 사전의 밝은 배경 그대로
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(200);
    assert.equal(await css(page, 'document.body', 'backgroundColor'), 'rgb(245, 247, 255)', '다크모드에서도 밝은 배경');
    assert.equal(fs.readFileSync(path.resolve(__dirname, '..', '..', 'public', 'concept_study.html'), 'utf8').includes('prefers-color-scheme'), false, '다크모드 블록 없음');
    assert.equal(await page.hasHorizontalScroll(), false);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
