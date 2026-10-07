// 작업199: 문학 나침반·한입 독서·과학의 공용 제목 줄(.screen-bar)과 하단 탭(헤드리스 Chrome, 모의 API, 390/768/1024px).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const WORK0 = 'DB.works ? DB.works[0].id : DB[0].id';
const VIEWS = {
  literature_compass: [
    { name: '홈', js: '', bar: true },
    { name: '사조 설명', js: 'showBriefing(DB.eras[0].movements[0].id)', bar: true, back: true },
  ],
  digest_reading: [
    { name: '목록', js: '', bar: false },
    { name: '작품 상세', js: `showDigest(${WORK0})`, bar: true, back: true, conquest: true },
  ],
  science_reading: [
    { name: '과목 선택', js: '', bar: false },
    { name: '과목 캐러셀', js: 'openField(FIELD_ORDER[0])', bar: true, back: true },
    { name: '개념 상세', js: 'showScience(DB.concepts[0].id)', bar: true, back: true, conquest: true },
  ],
};
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });

for (const [file, views] of Object.entries(VIEWS)) {
  for (const w of [390, 768, 1024]) {
    test(`${file} ${w}px: 제목 줄 1개·뒤로가기 44px·하단 탭이 마지막 내용을 가리지 않음·가로 스크롤 없음·오류 없음`, { skip: SKIP }, async () => {
      srv.reset();
      srv.state.me = me();
      const page = await browser.newPage({ width: w, height: 844 });
      await page.goto(srv.url + '/' + file + '.html');
      await page.waitFor("typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'", 10000);
      for (const v of views) {
        const label = file + ' / ' + v.name + ' / ' + w + 'px';
        if (v.js) await page.eval(v.js);
        await new Promise(r => setTimeout(r, 500));
        const bars = await page.count('.view.active .screen-bar');
        assert.equal(bars, v.bar ? 1 : 0, label + ': 제목 줄 개수');
        assert.equal(await page.count('.top-bar, .subject-bar, .back-btn'), 0, label + ': 옛 복사본 클래스 없음');
        if (v.bar) {
          const title = await page.eval("(() => { const t = document.querySelector('.view.active .screen-bar-title'); return t ? getComputedStyle(t).fontSize : null; })()");
          if (title) assert.equal(title, '17px', label + ': 제목 17px');
        }
        if (v.back) {
          const r = await page.eval("(() => { const b = document.querySelector('.view.active .screen-bar-back'); const r = b.getBoundingClientRect(); return [r.width, r.height]; })()");
          assert.ok(r[0] >= 44 && r[1] >= 44, label + ': 뒤로가기 44px 이상 ' + r);
        }
        // 끝까지 내렸을 때: 제목 줄은 공용 헤더(65px) 바로 아래에 붙고, 마지막 내용은 하단 탭·정복 바 위에 있다
        await page.eval('window.scrollTo(0, 1e6)');
        await new Promise(r => setTimeout(r, 200));
        if (v.bar) {
          const top = await page.eval("Math.round(document.querySelector('.view.active .screen-bar').getBoundingClientRect().top)");
          const scrolled = await page.eval('window.scrollY > 0');
          if (scrolled) assert.equal(top, 65, label + ': 스크롤 시 제목 줄이 헤더 바로 아래에 붙음');
        }
        const m = await page.eval(`(() => {
          const view = document.querySelector('.view.active');
          let el = view.querySelector('.content') || view;
          while (el.lastElementChild && el.lastElementChild.getBoundingClientRect().height > 0 && getComputedStyle(el.lastElementChild).position !== 'fixed') el = el.lastElementChild;
          const tab = document.querySelector('.tab-bar').getBoundingClientRect();
          const cq = document.querySelector('.conquest-bar');
          const cqr = cq && getComputedStyle(cq).display !== 'none' && view.contains(cq) ? cq.getBoundingClientRect() : null;
          return { lastBottom: el.getBoundingClientRect().bottom, tabTop: tab.top, tabW: Math.round(tab.width), cqTop: cqr ? cqr.top : null, bodyW: Math.round(document.body.getBoundingClientRect().width) };
        })()`);
        assert.ok(m.lastBottom <= m.tabTop + 1, label + ': 마지막 내용이 하단 탭에 가림 ' + JSON.stringify(m));
        if (v.conquest) assert.ok(m.cqTop !== null && m.lastBottom <= m.cqTop + 1, label + ': 마지막 내용이 정복 바에 가림 ' + JSON.stringify(m));
        assert.ok(m.tabW <= 680, label + ': 하단 탭 최대 폭 680px ' + m.tabW);
        assert.equal(m.tabW, m.bodyW, label + ': 하단 탭 폭이 본문 폭과 같음');
        assert.equal(await page.hasHorizontalScroll(), false, label + ': 가로 스크롤 없음');
        await page.eval('window.scrollTo(0, 0)');
      }
      assert.deepEqual(page.errors, [], file + ': 스크립트 오류');
      await page.close();
    });
  }
}
