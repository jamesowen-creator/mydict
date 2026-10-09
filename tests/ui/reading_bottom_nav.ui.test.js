// 작업226-2: 문학 나침반(홈/퀴즈/사전)·과학 읽기·한입 독서(홈/정복/퀴즈)의 하단 내비. 헤드리스 Chrome + 모의 서버(비용 API 호출 없음).
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
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none' && !!document.querySelector('.metis-app-header-logo')";
const FILES = { lit: '/literature_compass.html', sci: '/science_reading.html', dig: '/digest_reading.html' };
const MCQ = "[{ type: 'mcq', question: '다음 중 올바른 설명은?', options: ['첫째 보기', '둘째 보기', '셋째 보기', '넷째 보기'], answer: '셋째 보기', roundLabel: '4지선다' }, { type: 'mcq', question: '두 번째 문제', options: ['가', '나', '다', '라'], answer: '가', roundLabel: '4지선다' }]";
const READ_QUIZ = `quizState = { questions: ${MCQ}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`;

async function open(key, width = 390, { height = 844 } = {}) {
  srv.reset(); srv.state.me = me();
  const page = await browser.newPage({ width, height });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.goto(srv.url + FILES[key]);
  await page.waitFor(DB_READY, 12000);
  await page.eval(NO_MOTION);
  // 같은 브라우저를 쓰는 앞선 테스트의 정복 기록이 남지 않게 지운다(정복 기록은 localStorage)
  await page.eval("Object.keys(localStorage).filter(k => /conquest_/.test(k)).forEach(k => localStorage.removeItem(k)); if (typeof updateTabQuizState === 'function') updateTabQuizState();");
  await settle(page);
  return page;
}
const tabs = page => page.eval("[...document.querySelectorAll('#bottom-nav .bottom-nav-tab')].map(b => ({ text: b.textContent.trim(), tab: b.dataset.tab || null, current: b.getAttribute('aria-current') === 'page', active: b.classList.contains('active') }))");
const currentTab = async page => (await tabs(page)).filter(t => t.current).map(t => t.text);
async function tap(page, tab) { await page.click(`#bottom-nav [data-tab="${tab}"]`); await sleep(300); await settle(page); }
const activeView = page => page.eval("document.querySelector('.view.active').id");

// ───────────────────────── 구조·사양 ─────────────────────────
for (const [key, labels] of [['lit', ['홈', '퀴즈', '사전']], ['sci', ['홈', '정복', '퀴즈']], ['dig', ['홈', '정복', '퀴즈']]]) {
  test(`${key}: 하단 내비 탭 ${labels.length}개(${labels.join('/')}), nav 라벨, 첫 화면에서 "홈"이 현재 탭, 옛 .tab-bar·.conquest-bar 없음`, { skip: SKIP }, async () => {
    const page = await open(key);
    assert.deepEqual((await tabs(page)).map(t => t.text), labels);
    assert.equal(await page.eval("document.getElementById('bottom-nav').tagName"), 'NAV');
    assert.match(await page.eval("document.getElementById('bottom-nav').getAttribute('aria-label')"), /메뉴$/);
    assert.deepEqual(await currentTab(page), ['홈']);
    assert.equal(await page.count('.tab-bar, .conquest-bar, .tab-btn'), 0, '옛 탭바·정복 바 없음');
    assert.ok(await page.eval("[...document.querySelectorAll('#bottom-nav .bottom-nav-tab')].every(b => b.getBoundingClientRect().height >= 43.5)"), '탭 높이 ≥ 44px');
    assert.equal(await page.eval("getComputedStyle(document.getElementById('bottom-nav')).zIndex"), '100');
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  });
}

const NAV_SPEC = (navSel, tabSel, activeSel) => `(() => {
  const n = document.querySelector(${JSON.stringify(navSel)}), nr = n.getBoundingClientRect(), cs = getComputedStyle(n);
  const tabs = [...n.querySelectorAll(${JSON.stringify(tabSel)})], t0 = tabs[0], tcs = getComputedStyle(t0);
  const a = n.querySelector(${JSON.stringify(activeSel)}), acs = getComputedStyle(a);
  return { vw: document.documentElement.clientWidth, x0: nr.left, x1: nr.right, h: nr.height, borderTop: cs.borderTopWidth, shadow: cs.boxShadow, padB: cs.paddingBottom, padL: cs.paddingLeft, z: cs.zIndex, pos: cs.position,
    count: tabs.length, tabs: tabs.map(t => { const r = t.getBoundingClientRect(); return { w: r.width, fits: t.scrollWidth <= t.clientWidth, x0: r.left, x1: r.right }; }), tabH: t0.getBoundingClientRect().height, font: tcs.fontSize, weight: tcs.fontWeight, padT: tcs.paddingTop,
    tabTopBorder: tcs.borderTopWidth, activeTopBorder: acs.borderTopWidth, activeColor: acs.color, activeBorderColor: acs.borderTopColor, activeWeight: acs.fontWeight, activeUnderline: acs.textDecorationLine, activeBorderStyle: acs.borderTopStyle };
})()`;
for (const w of [390, 1024]) {
  test(`하단 내비 사양 = 사전 하단 내비 (${w}px, 문학·과학·한입): 높이 78px·윗선 1px·그림자·z-index 100·가운데 열·라벨 15/13px·활성 위쪽 3px 선 + #b8442e(굵기·밑줄 변경 없음)`, { skip: SKIP }, async () => {
    srv.reset(); srv.state.me = me();
    const d = await browser.newPage({ width: w, height: 844, token: jwt() });
    await d.send('Emulation.setScrollbarsHidden', { hidden: true });
    await d.goto(srv.url + '/english_dictionary.html');
    await d.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
    await d.eval(NO_MOTION); await settle(d);
    const dm = await d.eval(NAV_SPEC('nav', '.nav-tab', '.nav-tab.active'));
    await d.close();
    for (const key of ['lit', 'sci', 'dig']) {
      const page = await open(key, w);
      const m = await page.eval(NAV_SPEC('#bottom-nav', '.bottom-nav-tab', '.bottom-nav-tab.active'));
      await page.close();
      const L = `${key} ${w}px`;
      for (const k of ['vw', 'x0', 'x1', 'h', 'borderTop', 'shadow', 'padB', 'padL', 'z', 'pos', 'font', 'weight', 'padT', 'tabTopBorder', 'activeTopBorder']) {
        if (typeof m[k] === 'number') assert.ok(Math.abs(m[k] - dm[k]) <= 0.6, `${L} ${k}: ${m[k]} vs 사전 ${dm[k]}`); else assert.equal(m[k], dm[k], `${L} ${k}: ${m[k]} vs 사전 ${dm[k]}`);
      }
      if (w > 460) assert.ok(Math.abs(m.tabH - dm.tabH) <= 0.6, `${L} tabH ${m.tabH} vs ${dm.tabH}`); else assert.ok(m.tabH >= 43.5);
      assert.equal(m.h, 78); assert.equal(m.font, w <= 460 ? '13px' : '15px'); assert.equal(m.activeTopBorder, '3px'); assert.equal(m.borderTop, '1px');
      assert.equal(m.activeColor, 'rgb(184, 68, 46)'); assert.equal(m.activeBorderColor, 'rgb(226, 88, 59)');
      assert.equal(m.activeWeight, '500', L + ' 활성이어도 굵기 그대로'); assert.equal(m.activeUnderline, 'none', L + ' 밑줄 없음');
      const w0 = m.tabs[0].w;
      for (const t of m.tabs) { assert.ok(Math.abs(t.w - w0) <= 1, L + ' 탭 폭 균등'); assert.ok(t.fits, L + ' 라벨 잘림 없음'); }
      assert.equal(m.tabs.length, key === 'lit' ? 3 : 3);
    }
  });
}
for (const w of [320, 768]) {
  test(`하단 내비 ${w}px(문학·과학·한입): 탭 균등 폭·가운데 열·가로 스크롤 없음·마지막 내용이 내비에 가려지지 않음`, { skip: SKIP }, async () => {
    for (const key of ['lit', 'sci', 'dig']) {
      const page = await open(key, w);
      const m = await page.eval(NAV_SPEC('#bottom-nav', '.bottom-nav-tab', '.bottom-nav-tab.active'));
      const col = Math.min(680, m.vw), c0 = (m.vw - col) / 2;
      assert.ok(Math.abs(m.x0 - c0) <= 1 && Math.abs(m.x1 - (c0 + col)) <= 1, `${key} ${w}px 내비 ${m.x0}~${m.x1}`);
      assert.equal(await page.hasHorizontalScroll(), false, `${key} ${w}px 가로 스크롤`);
      await page.eval("window.scrollTo(0, 1e6)"); await sleep(150);
      const gap = await page.eval("(() => { const v = document.querySelector('.view.active'); let e = v.querySelector('.content') || v; while (e.lastElementChild && e.lastElementChild.getBoundingClientRect().height > 0) e = e.lastElementChild; return document.getElementById('bottom-nav').getBoundingClientRect().top - e.getBoundingClientRect().bottom; })()");
      assert.ok(gap >= -1, `${key} ${w}px 마지막 내용이 내비에 가려짐: ${gap}`);
      await page.close();
    }
  });
}

// ───────────────────────── 문학 ─────────────────────────
test('문학: 활성 규칙(홈=홈·브리핑·카드 / 퀴즈=퀴즈 탭·풀이·결과), 사전 탭은 "/" 로 가는 링크이며 활성 표시 없음', { skip: SKIP }, async () => {
  const page = await open('lit');
  assert.equal(await page.eval("document.getElementById('nav-dict').getAttribute('href')"), '/');
  assert.equal(await page.eval("document.querySelector('.dict-link').getAttribute('href')"), '/', '기존 "어휘 사전" 링크와 같은 이동 대상');
  await page.eval("showBriefing(DB.eras[0].movements[0].id)"); await sleep(200);
  assert.deepEqual(await currentTab(page), ['홈'], '브리핑');
  await page.eval("showCards()"); assert.deepEqual(await currentTab(page), ['홈'], '카드');
  await tap(page, 'quiz'); assert.equal(await activeView(page), 'view-qlist'); assert.deepEqual(await currentTab(page), ['퀴즈'], '퀴즈 탭');
  await page.click('.qlist-row'); await sleep(300);
  assert.equal(await activeView(page), 'view-quiz'); assert.deepEqual(await currentTab(page), ['퀴즈'], '퀴즈 풀이');
  await page.eval("quizData.score = 0; showResult()");
  assert.deepEqual(await currentTab(page), ['퀴즈'], '결과');
  await tap(page, 'home'); assert.equal(await activeView(page), 'view-home'); assert.deepEqual(await currentTab(page), ['홈']);
  assert.equal(await page.eval("[...document.querySelectorAll('#bottom-nav [aria-current]')].some(b => b.id === 'nav-dict')"), false, '사전 탭은 활성 표시 없음');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('문학 퀴즈 탭: 사조 고르기 목록(시대별 묶음, 텍스트 행·박스 없음)에서 고르면 그 사조의 퀴즈가 시작되고 ‹ 는 퀴즈 탭으로, 요청은 정적 파일 GET 뿐(AI·저장 없음)', { skip: SKIP }, async () => {
  const page = await open('lit');
  srv.state.log.length = 0;
  await tap(page, 'quiz');
  const info = await page.eval("({ eras: document.querySelectorAll('.qlist-era').length, rows: document.querySelectorAll('.qlist-row').length, want: DB.eras.reduce((n, e) => n + e.movements.length, 0), wantEras: DB.eras.length })");
  assert.equal(info.eras, info.wantEras); assert.equal(info.rows, info.want);
  const row = await page.eval("(() => { const cs = getComputedStyle(document.querySelector('.qlist-row')); return [cs.backgroundColor, cs.borderTopWidth, cs.borderBottomWidth, cs.borderRadius, cs.boxShadow]; })()");
  assert.deepEqual(row, ['rgba(0, 0, 0, 0)', '0px', '1px', '0px', 'none'], '박스 없는 텍스트 행 + 아래 구분선');
  const name = await page.eval("document.querySelector('.qlist-row').textContent");
  await page.click('.qlist-row'); await sleep(300);
  assert.equal(await activeView(page), 'view-quiz');
  assert.ok((await page.eval("document.getElementById('quiz-title').textContent")).startsWith(name), '고른 사조의 퀴즈');
  await page.click('#view-quiz .screen-bar-back'); await sleep(300);
  assert.equal(await activeView(page), 'view-qlist', '‹ = 퀴즈 탭으로');
  assert.equal(srv.state.log.filter(l => l.method !== 'GET').length, 0, '요청 중 GET 아닌 것 없음');
  assert.equal(srv.state.log.filter(l => /^\/api\//.test(l.url) && !/\/api\/me$/.test(l.url)).length, 0, 'API 호출 없음');
  await page.close();
});

test('문학 뒤로가기(history): 홈→브리핑→카드→퀴즈에서 뒤로가기가 직전 화면으로, 결과는 퀴즈 칸을 교체, 홈에서 뒤로가기는 기존대로 페이지 이탈, 퀴즈 중 뒤로가기는 확인창 없이 ‹ 와 같게(카드로)', { skip: SKIP }, async () => {
  const page = await open('lit');
  assert.deepEqual(await page.eval("history.state"), { view: 'home' });
  await page.eval("showBriefing(DB.eras[0].movements[0].id)"); await sleep(150);
  await page.eval("showCards()"); await sleep(150);
  await page.eval("startQuiz()"); await sleep(150);
  assert.equal(await page.eval("history.state.view"), 'quiz'); assert.equal(await page.eval("history.length"), 5);
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await activeView(page), 'view-cards', '퀴즈 → 카드(‹ 와 같음, 확인창 없음)');
  assert.equal(await page.exists('[data-t=dialog-msg]'), false);
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await activeView(page), 'view-briefing', '카드 → 브리핑');
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await activeView(page), 'view-home', '브리핑 → 홈 복원');
  assert.equal(await page.eval("document.querySelectorAll('.era-card').length > 0"), true, '홈 내용이 다시 그려짐');
  // 결과 화면은 퀴즈 칸을 교체: 퀴즈 → 결과 뒤 뒤로가기 한 번 = 카드
  await page.eval("showBriefing(DB.eras[0].movements[0].id)"); await page.eval("showCards()"); await page.eval("startQuiz()"); await sleep(100);
  const len = await page.eval("history.length");
  await page.eval("quizData.totalQ = 2; showResult()"); await sleep(100);
  assert.equal(await page.eval("history.length"), len, '결과는 기록을 더 쌓지 않음');
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await activeView(page), 'view-cards');
  // 화면 안 ‹ 도 같은 동작
  await page.eval("document.querySelector('#view-cards .screen-bar-back').click()"); await sleep(300);
  assert.equal(await activeView(page), 'view-briefing');
  await page.eval("document.querySelector('#view-briefing .screen-bar-back').click()"); await sleep(300);
  assert.equal(await activeView(page), 'view-home');
  await page.close();
});

test('문학 퀴즈 풀이 중 탭 이동: 한 문제라도 답했으면 "퀴즈를 그만할까요?" 확인(취소=유지 / 확인=이동), 답하기 전에는 확인 없음', { skip: SKIP }, async () => {
  const page = await open('lit');
  await page.eval(`quizData = { rounds: [{ type: 'mcq', questions: [{ question: '문제 하나', options: ['가', '나', '다', '라'], answer: '다' }, { question: '문제 둘', options: ['A', 'B', 'C', 'D'], answer: 'A' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 2 }; showView('view-quiz'); renderQuizRound();`);
  await tap(page, 'home');   // 아직 답하지 않음 → 확인 없이 이동
  assert.equal(await activeView(page), 'view-home');
  await page.eval(`quizData = { rounds: [{ type: 'mcq', questions: [{ question: '문제 하나', options: ['가', '나', '다', '라'], answer: '다' }, { question: '문제 둘', options: ['A', 'B', 'C', 'D'], answer: 'A' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 2 }; showView('view-quiz'); renderQuizRound();`);
  await page.click('.mcq-option', { index: 0 }); await sleep(300);
  await page.click('#bottom-nav [data-tab="home"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
  assert.match(await page.text('[data-t="dialog-msg"]'), /퀴즈를 그만할까요\? 지금까지의 답은 저장되지 않습니다/);
  await page.click('[data-t="dialog-cancel"]'); await sleep(250);
  assert.equal(await activeView(page), 'view-quiz', '취소하면 유지');
  await page.click('#bottom-nav [data-tab="home"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-ok]')");
  await page.click('[data-t="dialog-ok"]'); await sleep(300);
  assert.equal(await activeView(page), 'view-home', '확인하면 이동');
  await page.close();
});

test('문학 활성 탭 다시 누르기: 홈 첫 화면 = 맨 위로(요청 없음), 브리핑에서 홈 탭 = 홈 첫 화면으로', { skip: SKIP }, async () => {
  const page = await open('lit', 390, { height: 500 });
  await page.eval("window.scrollTo(0, 300)"); await sleep(100);
  assert.ok(await page.eval("window.scrollY") > 100);
  await tap(page, 'home'); assert.equal(await page.eval("window.scrollY"), 0);
  await page.eval("showBriefing(DB.eras[0].movements[0].id)"); await sleep(150);
  await tap(page, 'home'); assert.equal(await activeView(page), 'view-home');
  await page.close();
});

// ───────────────────────── 과학·한입 공통: 정복 탭, 정복 토글, 퀴즈 탭 ─────────────────────────
const SPEC = {
  sci: { detail: 'showScience(DB.concepts[0].id)', first: 'DB.concepts[0].id', second: 'DB.concepts[3].id', baseView: 'view-subjects', title: 'DB.concepts[0].title', note: 'science_conquest_', rowAttr: 'data-concept-id' },
  dig: { detail: 'showDigest(DB.works[0].id)', first: 'DB.works[0].id', second: 'DB.works[3].id', baseView: 'view-list', title: '"「" + DB.works[0].title + "」"', note: 'digest_conquest_', rowAttr: 'data-work-id' },
};
for (const key of ['sci', 'dig']) {
  const S = SPEC[key];
  test(`${key}: 활성 규칙(홈=${key === 'sci' ? '과목 선택·목록·상세' : '목록·상세'} / 정복=정복 탭 / 퀴즈=풀이·결과)`, { skip: SKIP }, async () => {
    const page = await open(key);
    assert.deepEqual(await currentTab(page), ['홈']);
    await page.eval(S.detail); await sleep(200); assert.equal(await activeView(page), key === 'sci' ? 'view-science' : 'view-digest'); assert.deepEqual(await currentTab(page), ['홈'], '상세');
    await tap(page, 'conq'); assert.equal(await activeView(page), 'view-conq'); assert.deepEqual(await currentTab(page), ['정복']);
    await page.eval(READ_QUIZ); assert.deepEqual(await currentTab(page), ['퀴즈'], '퀴즈 풀이');
    await page.eval("quizState.score = 1; showResult()"); assert.deepEqual(await currentTab(page), ['퀴즈'], '결과');
    await tap(page, 'home'); assert.equal(await activeView(page), S.baseView); assert.deepEqual(await currentTab(page), ['홈']);
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  });

  test(`${key} 정복 토글: 상세 화면 제목 줄 오른쪽(.screen-bar-end), 하단 고정 바 없음, 라벨(정복하기 ↔ ✓ 정복함)·aria-pressed·localStorage 저장 그대로`, { skip: SKIP }, async () => {
    const page = await open(key);
    await page.eval(S.detail); await sleep(250); await settle(page);
    const m = await page.eval(`(() => { const b = document.getElementById('conquest-btn'), bar = document.querySelector('.view.active .screen-bar'), r = b.getBoundingClientRect(), br = bar.getBoundingClientRect(), t = bar.querySelector('.screen-bar-title').getBoundingClientRect();
      return { inBar: bar.contains(b), end: b.classList.contains('screen-bar-end'), right: br.right - r.right, top: r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5, afterTitle: r.left >= t.right - 0.5, h: r.height, pos: getComputedStyle(b).position, fixedCount: [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).position === 'fixed' && e.getClientRects().length && e.id !== 'loading' && e.id !== 'access-denied' && !e.closest('.metis-app-header')).map(e => e.id || e.className) }; })()`);
    assert.equal(m.inBar, true); assert.equal(m.end, true); assert.ok(m.right <= 16.5 && m.right >= 0, '제목 줄 오른쪽 끝: ' + m.right); assert.ok(m.top, '제목 줄 안'); assert.ok(m.afterTitle, '제목 오른쪽'); assert.ok(m.h >= 43.5);
    assert.deepEqual(m.fixedCount, ['bottom-nav'], '하단 고정 요소는 내비 하나뿐(정복 바 없음)');
    assert.equal(await page.text('#conquest-btn'), '정복하기'); assert.equal(await page.eval("document.getElementById('conquest-btn').getAttribute('aria-pressed')"), 'false');
    await page.click('#conquest-btn');
    await page.waitFor("document.getElementById('conquest-btn').classList.contains('conquered')");
    assert.equal(await page.text('#conquest-btn'), '✓ 정복함'); assert.equal(await page.eval("document.getElementById('conquest-btn').getAttribute('aria-pressed')"), 'true');
    assert.equal(await page.eval(`Object.keys(localStorage).filter(k => k.startsWith('${S.note}') && localStorage.getItem(k) === 'true').length`), 1, 'localStorage 저장');
    assert.equal(await page.eval("document.getElementById('nav-quiz').getAttribute('aria-disabled')"), 'false', '정복이 생기면 퀴즈 탭 활성');
    await page.click('#conquest-btn');
    await page.waitFor("!document.getElementById('conquest-btn').classList.contains('conquered')");
    assert.equal(await page.text('#conquest-btn'), '정복하기');
    assert.equal(await page.eval("document.getElementById('nav-quiz').getAttribute('aria-disabled')"), 'true');
    await page.close();
  });

  test(`${key} 정복 탭: 0개면 "아직 정복한 항목이 없어요", 정복하면 묶음별 텍스트 행(구분선)이 생기고 행을 누르면 상세로, ‹ / 뒤로가기는 정복 탭으로(history 복원)`, { skip: SKIP }, async () => {
    const page = await open(key);
    srv.state.log.length = 0;
    await tap(page, 'conq');
    assert.equal(await page.text('.conq-empty'), '아직 정복한 항목이 없어요');
    assert.equal(await page.count('.conq-row'), 0);
    assert.equal(await page.eval("history.state.view"), 'conq');
    await page.eval(`setConquered(${S.first}, true); setConquered(${S.second}, true); updateTabQuizState();`);
    await tap(page, 'home'); await tap(page, 'conq');
    assert.ok(await page.count('.conq-row') >= 2); assert.ok(await page.count('.conq-group') >= 1);
    const row = await page.eval("(() => { const cs = getComputedStyle(document.querySelector('.conq-row')); return [cs.backgroundColor, cs.borderTopWidth, cs.borderRadius, cs.boxShadow, cs.minHeight]; })()");
    assert.deepEqual(row, ['rgba(0, 0, 0, 0)', '0px', '0px', 'none', '44px'], '박스 없는 텍스트 행');
    const firstId = await page.eval(`document.querySelector('.conq-row').getAttribute('${S.rowAttr}')`);
    await page.click('.conq-row'); await sleep(300);
    assert.equal(await activeView(page), key === 'sci' ? 'view-science' : 'view-digest', '행을 누르면 상세');
    assert.equal(await page.eval("history.state.id"), firstId);
    await page.click('.view.active .screen-bar-back'); await sleep(300);
    assert.equal(await activeView(page), 'view-conq', '‹ = 정복 탭으로');
    await page.click('.conq-row'); await sleep(300);
    await page.eval("history.back()"); await sleep(300);
    assert.equal(await activeView(page), 'view-conq', '뒤로가기 = 정복 탭 복원');
    assert.equal(srv.state.log.filter(l => l.method !== 'GET').length, 0, '요청 중 GET 아닌 것 없음');
    await page.close();
  });

  test(`${key} 퀴즈 탭: 정복 0개여도 누를 수 있고 기존 안내(metisAlert) 유지 + aria-disabled(흐림 아님), 풀이 중 탭 이동은 "퀴즈를 그만할까요?" 확인`, { skip: SKIP }, async () => {
    const page = await open(key);
    assert.equal(await page.eval("document.getElementById('nav-quiz').getAttribute('aria-disabled')"), 'true');
    assert.equal(await page.eval("getComputedStyle(document.getElementById('nav-quiz')).opacity"), '1', '흐림(opacity) 대신 aria-disabled');
    assert.equal(await page.eval("getComputedStyle(document.getElementById('nav-quiz')).color"), 'rgb(107, 114, 128)', '보조색');
    await page.click('#bottom-nav [data-tab="quiz"]');
    await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
    assert.match(await page.text('[data-t="dialog-msg"]'), key === 'sci' ? /먼저 개념을 정복해 주세요/ : /먼저 작품을 읽어보세요/);
    await page.click('[data-t="dialog-ok"]'); await sleep(250);
    assert.equal(await activeView(page), S.baseView, '화면 그대로');
    // 풀이 중 탭 이동 확인
    await page.eval(READ_QUIZ);
    await page.click('.mcq-option', { index: 0 }); await sleep(300);
    await page.click('#bottom-nav [data-tab="conq"]');
    await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
    assert.match(await page.text('[data-t="dialog-msg"]'), /퀴즈를 그만할까요\? 지금까지의 답은 저장되지 않습니다/);
    await page.click('[data-t="dialog-cancel"]'); await sleep(250);
    assert.equal(await activeView(page), 'view-quiz', '취소하면 유지');
    await page.click('#bottom-nav [data-tab="conq"]');
    await page.waitFor("!!document.querySelector('[data-t=dialog-ok]')");
    await page.click('[data-t="dialog-ok"]'); await sleep(300);
    assert.equal(await activeView(page), 'view-conq', '확인하면 이동');
    await page.close();
  });
}

test('과학: 정복 탭 URL(?tab=conq)로 새로고침해도 정복 탭 복원, 첫 탭 라벨 "홈"', { skip: SKIP }, async () => {
  const page = await open('sci');
  await tap(page, 'conq');
  assert.match(await page.eval("location.search"), /tab=conq/);
  await page.goto(srv.url + '/science_reading.html?tab=conq'); await page.waitFor(DB_READY, 12000); await settle(page);
  assert.equal(await activeView(page), 'view-conq');
  assert.deepEqual(await currentTab(page), ['정복']);
  assert.equal((await tabs(page))[0].text, '홈');
  await page.close();
});
