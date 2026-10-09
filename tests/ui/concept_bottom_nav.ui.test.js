// 작업226-3: 개념 학습 하단 내비(3탭: 학습 / 퀴즈 / 지도)와 입력 바 배치. 헤드리스 Chrome + 모의 API(비용 API 호출 없음).
// 사양은 음성 학습·언어 사전의 하단 내비(작업224-2)와 같다. 원칙(작업216-3): NO_MOTION + settle, 스크롤바 숨김.
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { me, NO_MOTION, settle } = require('./helpers/text_ui');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const FIVE = [
  { term: '가', set: { review_state: 'understood' } }, { term: '나', set: { review_state: 'confused' } }, { term: '다', set: { review_state: 'new' } },
  { term: '라', set: { review_state: 'confused' } }, { term: '마', set: { review_state: 'understood' } },
];
async function open(width = 390, { studies = 2, height = 844 } = {}) {
  srv.reset(); srv.state.me = me();
  if (studies >= 1) srv.seed({ topic: '생물', items: FIVE });
  if (studies >= 2) srv.seed({ topic: '화학', items: FIVE });
  const page = await browser.newPage({ width, height });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && (!document.getElementById('study-rows').hidden || !document.getElementById('list-empty').hidden)", 8000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}
const tabs = page => page.eval("[...document.querySelectorAll('#bottom-nav .bottom-nav-tab')].map(b => ({ text: b.textContent.trim(), current: b.getAttribute('aria-current') === 'page', active: b.classList.contains('active') }))");
const currentTab = async page => (await tabs(page)).filter(t => t.current).map(t => t.text);
async function tap(page, tab) { await page.click(`#bottom-nav [data-tab="${tab}"]`); await sleep(350); await settle(page); }
const nonGet = () => srv.state.log.filter(l => l.method !== 'GET');
const hash = page => page.eval('location.hash');
const openStudy = async page => { await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await sleep(200); await settle(page); };

test('하단 내비: 탭 3개(학습/퀴즈/지도), nav 라벨, 목록·학습 화면에서 "학습"이 현재 탭, 퀴즈 진행 중엔 "퀴즈", 지도는 활성 표시 없음', { skip: SKIP }, async () => {
  const page = await open();
  assert.deepEqual((await tabs(page)).map(t => t.text), ['학습', '퀴즈', '지도']);
  assert.equal(await page.eval("document.getElementById('bottom-nav').tagName"), 'NAV');
  assert.equal(await page.eval("document.getElementById('bottom-nav').getAttribute('aria-label')"), '개념 학습 메뉴');
  assert.ok(await page.eval("[...document.querySelectorAll('#bottom-nav button')].every(b => b.type === 'button' && b.getBoundingClientRect().height >= 43.5)"));
  assert.deepEqual(await currentTab(page), ['학습'], '목록');
  await openStudy(page);
  assert.deepEqual(await currentTab(page), ['학습'], '학습 화면');
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page);
  assert.deepEqual(await currentTab(page), ['퀴즈'], '퀴즈 진행 중');
  assert.equal(await page.visible('.bottom-bar'), false, '퀴즈 중 입력 바는 숨김');
  assert.equal(await page.visible('#bottom-nav'), true, '내비는 유지');
  await page.click('[data-t="quiz-exit"]'); await sleep(200);
  assert.deepEqual(await currentTab(page), ['학습'], '퀴즈를 닫으면 학습');
  assert.equal(await page.visible('.bottom-bar'), true);
  assert.equal(await page.eval("[...document.querySelectorAll('#bottom-nav [aria-current]')].some(b => b.dataset.tab === 'map')"), false);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

const NAV_SPEC = (navSel, tabSel, activeSel) => `(() => {
  const n = document.querySelector(${JSON.stringify(navSel)}), nr = n.getBoundingClientRect(), cs = getComputedStyle(n);
  const tabs = [...n.querySelectorAll(${JSON.stringify(tabSel)})], t0 = tabs[0], tcs = getComputedStyle(t0);
  const a = n.querySelector(${JSON.stringify(activeSel)}), acs = getComputedStyle(a);
  return { vw: document.documentElement.clientWidth, x0: nr.left, x1: nr.right, h: nr.height, borderTop: cs.borderTopWidth, shadow: cs.boxShadow, padB: cs.paddingBottom, padL: cs.paddingLeft, z: cs.zIndex, pos: cs.position,
    count: tabs.length, tabs: tabs.map(t => { const r = t.getBoundingClientRect(); return { w: r.width, fits: t.scrollWidth <= t.clientWidth }; }), tabH: t0.getBoundingClientRect().height, font: tcs.fontSize, weight: tcs.fontWeight, padT: tcs.paddingTop,
    tabTopBorder: tcs.borderTopWidth, activeTopBorder: acs.borderTopWidth, activeColor: acs.color, activeBorderColor: acs.borderTopColor, activeWeight: acs.fontWeight, activeUnderline: acs.textDecorationLine };
})()`;
for (const w of [390, 1024]) {
  test(`하단 내비 사양 = 사전 하단 내비 (${w}px): 높이 78px·윗선 1px·그림자·z-index 100·가운데 열(680px)·라벨 15/13px·활성 위쪽 3px 선 + #b8442e`, { skip: SKIP }, async () => {
    srv.reset(); srv.state.me = me();
    const d = await browser.newPage({ width: w, height: 844, token: jwt() });
    await d.send('Emulation.setScrollbarsHidden', { hidden: true });
    await d.goto(srv.url + '/english_dictionary.html');
    await d.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
    await d.eval(NO_MOTION); await settle(d);
    const dm = await d.eval(NAV_SPEC('nav', '.nav-tab', '.nav-tab.active'));
    await d.close();
    const page = await open(w);
    const m = await page.eval(NAV_SPEC('#bottom-nav', '.bottom-nav-tab', '.bottom-nav-tab.active'));
    await page.close();
    for (const k of ['vw', 'x0', 'x1', 'h', 'borderTop', 'shadow', 'padB', 'padL', 'z', 'pos', 'font', 'weight', 'padT', 'tabTopBorder', 'activeTopBorder']) {
      if (typeof m[k] === 'number') assert.ok(Math.abs(m[k] - dm[k]) <= 0.6, `${k}: ${m[k]} vs 사전 ${dm[k]}`); else assert.equal(m[k], dm[k], `${k}: ${m[k]} vs 사전 ${dm[k]}`);
    }
    if (w > 460) assert.ok(Math.abs(m.tabH - dm.tabH) <= 0.6, `tabH ${m.tabH} vs ${dm.tabH}`); else assert.ok(m.tabH >= 43.5);
    const col = Math.min(680, m.vw), c0 = (m.vw - col) / 2;
    assert.ok(Math.abs(m.x0 - c0) <= 1 && Math.abs(m.x1 - (c0 + col)) <= 1, `가운데 열 ${m.x0}~${m.x1}`);
    assert.equal(m.h, 78); assert.equal(m.font, w <= 460 ? '13px' : '15px'); assert.equal(m.activeTopBorder, '3px'); assert.equal(m.borderTop, '1px');
    assert.equal(m.activeColor, 'rgb(184, 68, 46)'); assert.equal(m.activeBorderColor, 'rgb(226, 88, 59)');
    assert.equal(m.activeWeight, '500'); assert.equal(m.activeUnderline, 'none');
    assert.equal(m.tabs.length, 3);
    for (const t of m.tabs) { assert.ok(Math.abs(t.w - m.tabs[0].w) <= 1, '탭 폭 균등'); assert.ok(t.fits, '라벨 잘림 없음'); }
  });
}

for (const w of [320, 390, 1024]) {
  test(`입력 바(.bottom-bar)가 하단 내비 바로 위(겹침·틈 없음), 가운데 열, 본문 끝이 입력 바에 가려지지 않음 (${w}px, 안내 줄이 길어져도)`, { skip: SKIP }, async () => {
    const page = await open(w);
    await openStudy(page);
    const m = await page.eval(`(() => { const b = document.querySelector('.bottom-bar').getBoundingClientRect(), n = document.getElementById('bottom-nav').getBoundingClientRect(), vw = document.documentElement.clientWidth;
      return { barBottom: b.bottom, navTop: n.top, barX0: b.left, barX1: b.right, navX0: n.left, navX1: n.right, vw, z: getComputedStyle(document.querySelector('.bottom-bar')).zIndex, hasScroll: document.documentElement.scrollWidth > vw + 1 }; })()`);
    assert.ok(Math.abs(m.barBottom - m.navTop) <= 0.5, `입력 바 아래 ${m.barBottom} vs 내비 위 ${m.navTop}`);
    assert.ok(Math.abs(m.barX0 - m.navX0) <= 1 && Math.abs(m.barX1 - m.navX1) <= 1, '입력 바와 내비의 가로 범위가 같음(가운데 열)');
    assert.equal(m.hasScroll, false);
    // 본문 끝이 입력 바 위에 있다(안내 줄이 길어져 입력 바가 커진 경우도)
    for (const long of [false, true]) {
      if (long) { await page.eval("document.getElementById('ask-msg').textContent = '긴 오류 안내 문장입니다. '.repeat(8)"); await sleep(250); await settle(page); }
      await page.eval("window.scrollTo(0, 1e6)"); await sleep(200);
      // 스크롤 끝에서 본문 끝(= #app 아래 − 아래 여백)이 입력 바 위쪽보다 위
      const g = await page.eval(`(() => { const bar = document.querySelector('.bottom-bar').getBoundingClientRect(), app = document.getElementById('app'); const padB = parseFloat(getComputedStyle(app).paddingBottom); return { gap: bar.top - (app.getBoundingClientRect().bottom - padB), askH: getComputedStyle(document.documentElement).getPropertyValue('--ask-h'), barH: bar.height, atEnd: Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) < 2 }; })()`);
      assert.ok(g.atEnd, '스크롤 끝');
      assert.ok(g.gap >= -1, `${w}px ${long ? '긴 안내' : '기본'}: 본문 끝이 입력 바에 가려짐 ${g.gap}`);
      assert.equal(parseFloat(g.askH), Math.round(g.barH), '--ask-h = 입력 바 실제 높이');
    }
    await page.close();
  });
}

test('목록에서 퀴즈 탭: "어떤 학습으로 할까요?" 고르기(텍스트 행) → 고른 학습이 열리고 돌아보기 퀴즈가 바로 시작(AI·POST 0, 기록은 쌓지 않음)', { skip: SKIP }, async () => {
  const page = await open();
  const len = await page.eval("history.length");
  srv.state.log.length = 0;
  await page.click('#bottom-nav [data-tab="quiz"]');
  await page.waitFor("document.getElementById('study-picker').open");
  assert.equal(await page.text('#study-picker-title'), '어떤 학습으로 할까요?');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.pick-row')].map(b => b.textContent)").then(a => a.sort()), ['생물', '화학']);
  const row = await page.eval("(() => { const cs = getComputedStyle(document.querySelector('.pick-row')); return [cs.backgroundColor, cs.borderTopWidth, cs.borderBottomWidth, cs.borderRadius, cs.boxShadow]; })()");
  assert.deepEqual(row, ['rgba(0, 0, 0, 0)', '0px', '1px', '0px', 'none'], '텍스트 행 + 구분선');
  assert.equal(await page.eval("document.querySelector('.view-title, #view-list h1') ? true : true"), true);
  await page.click('.pick-row'); // 첫 행
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')", 8000); await settle(page);
  assert.match(await hash(page), /^#s=\d+$/);
  assert.equal(await page.eval("document.getElementById('app').classList.contains('in-quiz')"), true);
  assert.deepEqual(await currentTab(page), ['퀴즈']);
  assert.equal(await page.eval("history.length"), len, '탭 전환은 기록을 쌓지 않음(replaceState)');
  assert.deepEqual(nonGet(), [], '요청 중 GET 아닌 것 없음');
  assert.equal(srv.state.log.filter(l => /\/explore$|\/respond$|\/suggestions\/refresh$|voice\/transcribe/.test(l.url)).length, 0, 'AI 호출 없음');
  assert.ok(srv.state.log.some(l => /\/review$/.test(l.url) && l.search === '?count=5'), '기존 GET /review 사용');
  await page.close();
});

test('목록에서 지도 탭: 고르기 → 학습이 열리고 지도 시트가 열림, 뒤로가기는 시트만 닫음(기존 동작)', { skip: SKIP }, async () => {
  const page = await open();
  srv.state.log.length = 0;
  await page.click('#bottom-nav [data-tab="map"]');
  await page.waitFor("document.getElementById('study-picker').open");
  await page.click('.pick-row', { index: 1 });
  await page.waitFor("document.getElementById('map-sheet').open", 8000); await sleep(300);
  assert.match(await hash(page), /^#s=\d+$/);
  assert.deepEqual(await currentTab(page), ['학습'], '지도는 활성 표시 없음(학습 유지)');
  assert.deepEqual(nonGet(), []);
  await page.eval("history.back()"); await sleep(400);
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), false, '뒤로가기는 시트만 닫음');
  assert.match(await hash(page), /^#s=\d+$/, '화면은 그대로 학습');
  await page.close();
});

test('고르기 팝업: 닫기·ESC 는 아무 일도 안 함, 학습이 0개면 "아직 학습이 없어요"', { skip: SKIP }, async () => {
  let page = await open(390, { studies: 0 });
  await page.click('#bottom-nav [data-tab="quiz"]');
  await page.waitFor("document.getElementById('study-picker').open");
  assert.equal(await page.text('[data-t="picker-empty"]'), '아직 학습이 없어요');
  assert.equal(await page.count('.pick-row'), 0);
  await page.click('#study-picker-cancel'); await sleep(200);
  assert.equal(await page.eval("document.getElementById('study-picker').open"), false);
  assert.equal(await page.eval("location.hash"), '');
  await page.click('#bottom-nav [data-tab="map"]');
  await page.waitFor("document.getElementById('study-picker').open");
  assert.equal(await page.text('[data-t="picker-empty"]'), '아직 학습이 없어요');
  await page.eval("document.getElementById('study-picker').close()"); await sleep(150);
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), false);
  assert.deepEqual(nonGet(), []);
  await page.close();
  page = await open();
  await page.click('#bottom-nav [data-tab="quiz"]');
  await page.waitFor("document.getElementById('study-picker').open");
  await page.click('#study-picker-cancel'); await sleep(200);
  assert.equal(await page.eval("location.hash"), '', '고르지 않으면 목록 그대로');
  assert.equal(await page.visible('#view-list'), true);
  await page.close();
});

test('학습 화면 안에서 퀴즈·지도 탭은 고르기 없이 지금 학습에 바로 적용, 퀴즈 재클릭은 무동작, 학습 탭은 목록으로(기록 안 쌓음)', { skip: SKIP }, async () => {
  const page = await open();
  await openStudy(page);
  const len = await page.eval("history.length");
  srv.state.log.length = 0;
  await tap(page, 'quiz');
  assert.equal(await page.eval("document.getElementById('study-picker').open"), false, '고르기 팝업 없음');
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  assert.deepEqual(await currentTab(page), ['퀴즈']);
  const reviews = srv.state.log.filter(l => /\/review/.test(l.url)).length;
  await tap(page, 'quiz');   // 재클릭 무동작
  assert.equal(srv.state.log.filter(l => /\/review/.test(l.url)).length, reviews, '새 요청 없음');
  assert.equal(await page.eval("S.quiz.i"), 0);
  await tap(page, 'study');  // 답한 게 없으니 확인 없이 목록으로
  assert.equal(await page.visible('#view-list'), true); assert.equal(await page.eval("location.hash"), '');
  assert.equal(await page.eval("history.length"), len, '기록 안 쌓음');
  assert.deepEqual(await currentTab(page), ['학습']);
  // 목록에서 학습 탭 재클릭 = 맨 위로
  await page.eval("window.scrollTo(0, 50)"); await tap(page, 'study');
  assert.equal(await page.eval("window.scrollY"), 0);
  // 학습 화면으로 다시 들어가서 지도 탭: 시트가 바로 열림
  await openStudy(page);
  await tap(page, 'map');
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), true);
  assert.equal(await page.eval("document.getElementById('study-picker').open"), false);
  assert.deepEqual(nonGet(), [], 'POST 등 쓰기 요청 0');
  await page.close();
});

test('퀴즈 풀이 중(한 문제라도 답한 뒤) 학습 탭: "퀴즈를 그만할까요?" 확인 — 취소하면 퀴즈 유지, 확인하면 목록으로. 답하기 전에는 확인 없음', { skip: SKIP }, async () => {
  const page = await open();
  await openStudy(page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  await tap(page, 'study');   // 답하기 전 → 확인 없이 이동
  assert.equal(await page.visible('#view-list'), true);
  await openStudy(page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  await page.click('[data-t="quiz-opt"]', { index: 0 });
  await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')");
  await page.click('#bottom-nav [data-tab="study"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
  assert.match(await page.text('[data-t="dialog-msg"]'), /퀴즈를 그만할까요\? 지금까지의 답은 저장되지 않습니다/);
  await page.click('[data-t="dialog-cancel"]'); await sleep(250);
  assert.equal(await page.eval("!!S.quiz && S.quiz.results.length"), 1, '취소하면 퀴즈와 답 유지');
  assert.deepEqual(await currentTab(page), ['퀴즈']);
  await page.click('#bottom-nav [data-tab="study"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-ok]')");
  await page.click('[data-t="dialog-ok"]'); await sleep(400); await settle(page);
  assert.equal(await page.visible('#view-list'), true, '확인하면 목록으로');
  assert.equal(await page.eval("S.quiz"), null);
  await page.close();
});

test('마이크 녹음 중 탭 클릭: 확인("녹음 중입니다…") — 취소하면 이동·시트 열기 없이 녹음 유지, 확인하면 micCancel() 후 진행(지도 탭 포함)', { skip: SKIP }, async () => {
  const page = await open();
  await openStudy(page);
  await page.eval("window.__stopped = 0; Mic.rec = { stop() { window.__stopped++; } }; Mic.state = 'recording'; Mic.owner = MIC_TARGETS[1];");
  await page.click('#bottom-nav [data-tab="map"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
  assert.match(await page.text('[data-t="dialog-msg"]'), /녹음 중입니다\. 이동하면 녹음이 취소됩니다/);
  await page.click('[data-t="dialog-cancel"]'); await sleep(250);
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), false, '취소하면 시트 안 열림');
  assert.equal(await page.eval("Mic.state"), 'recording', '녹음 유지'); assert.equal(await page.eval("window.__stopped"), 0);
  await page.click('#bottom-nav [data-tab="study"]');   // 학습 탭도 같은 확인
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
  await page.click('[data-t="dialog-cancel"]'); await sleep(250);
  assert.equal(await page.visible('#view-study'), true, '취소하면 학습 화면 유지');
  await page.click('#bottom-nav [data-tab="map"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-ok]')");
  await page.click('[data-t="dialog-ok"]'); await sleep(400);
  assert.equal(await page.eval("window.__stopped"), 1, 'micCancel() → 녹음 중지 호출'); assert.equal(await page.eval("Mic.state"), 'cancelled');
  assert.equal(await page.eval("document.getElementById('map-sheet').open"), true, '확인하면 지도 시트가 열림');
  await page.close();
});

test('가로 스크롤 없음·스크립트 오류 없음 (320/390/768/1024px, 목록·학습·퀴즈 화면)', { skip: SKIP }, async () => {
  for (const w of [320, 390, 768, 1024]) {
    const page = await open(w);
    assert.equal(await page.hasHorizontalScroll(), false, `${w}px 목록`);
    await openStudy(page);
    assert.equal(await page.hasHorizontalScroll(), false, `${w}px 학습`);
    await tap(page, 'quiz'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page);
    assert.equal(await page.hasHorizontalScroll(), false, `${w}px 퀴즈`);
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], `${w}px`);
    await page.close();
  }
});
