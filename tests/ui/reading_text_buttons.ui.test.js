// 작업217-2: 읽기 3화면의 보조 결과 버튼(.result-btn-secondary), 이전·다음 화살표(.nav-btn, .carousel-nav-btn), 문학 홈 "어휘 사전" 링크는
// 박스·배경 없는 텍스트(밑줄 또는 화살표 글자), 터치 영역 44px 이상, 글자 대비 4.5:1 이상. 주요 채움 버튼은 그대로.
// 처음부터 ① transition·animation을 끄고 ② 클릭 전에 레이아웃이 안정될 때까지 기다린다(작업216-3의 교훈).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const PRIMARY_FILL = 'rgb(184, 68, 46)', PRIMARY_FILL_HOVER = 'rgb(156, 58, 39)';
const NO_MOTION = `(() => { const s = document.createElement('style'); s.id = 'test-no-motion'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()`;
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'";
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });

async function open(file, width = 390) {
  srv.reset(); srv.state.me = me();
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/' + file + '.html');
  await page.waitFor(DB_READY, 10000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}
async function settle(page) {
  await page.waitFor("document.fonts.status === 'loaded'", 5000);
  let last = '', same = 0;
  for (let i = 0; i < 100 && same < 4; i++) {
    const now = await page.eval("[...document.querySelectorAll('.view.active button, .view.active a, .view.active .carousel-nav-count')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top) + ':' + Math.round(r.left); }).join('|') + '|' + document.documentElement.scrollHeight");
    same = now === last ? same + 1 : 0; last = now;
    await sleep(50);
  }
  assert.ok(same >= 4, '화면 레이아웃이 안정되지 않음');
}
const step = async (page, js) => { await page.eval(js); await sleep(150); await settle(page); };
const MEASURE = sel => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  const num = c => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([R, G, B]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
  let bgEff = 'rgb(255, 255, 255)';
  for (let a = e; a; a = a.parentElement) { const b = getComputedStyle(a).backgroundColor; const n = num(b); if (n.length < 4 || n[3] > 0.99) { if (n.length >= 3) { bgEff = b; break; } } }
  const l1 = lum(num(cs.color)), l2 = lum(num(bgEff));
  return { text: e.textContent.trim(), w: r.width, h: r.height, bg: cs.backgroundColor, bw: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], radius: cs.borderTopLeftRadius,
    color: cs.color, bgEff, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), underline: cs.textDecorationLine.includes('underline'), cursor: cs.cursor, weight: cs.fontWeight,
    aria: e.getAttribute('aria-label'), size: parseFloat(cs.fontSize) };
})()`;
function assertNoBox(m, label) {
  assert.ok(m, label + ': 요소 없음');
  assert.equal(m.bg, TRANSPARENT, label + ': 배경 투명');
  assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px'], label + ': 테두리 없음');
  assert.equal(m.radius, '0px', label + ': 둥근 모서리 없음');
}
function assertTouch(m, label) { assert.ok(m.h >= 43.5 && m.w >= 43.5, `${label}: 터치 영역 44×44px 이상 (${m.w}x${m.h})`); }
function assertTextBtn(m, label) {
  // 텍스트 버튼은 배경·테두리가 없으면 박스가 아니다. 보이지 않는 radius는 216의 .btn.text와 같이 검사하지 않는다
  assert.ok(m, label + ': 요소 없음'); assert.equal(m.bg, TRANSPARENT, label + ': 배경 투명'); assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px'], label + ': 테두리 없음');
  assertTouch(m, label);
  assert.ok(m.ratio >= 4.5, `${label}: 글자 대비 4.5:1 이상 (${m.ratio.toFixed(2)}, ${m.color} on ${m.bgEff})`);
  assert.equal(m.underline, true, label + ': 밑줄'); assert.equal(m.cursor, 'pointer');
}
const done = async page => { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); };
const PICK = `(() => { const ms = DB.eras.flatMap(e => e.movements); return (ms.find(x => x.works && x.works.length >= 2) || ms[0]).id; })()`;

test('217-2 .result-btn-secondary (literature·science·digest): 박스·배경 없는 밑줄 텍스트, 44px, 대비 4.5:1, 호버는 글자만 진해짐, 주요 채움 버튼은 그대로', { skip: SKIP }, async () => {
  const setups = [
    ['literature_compass', "quizData = { rounds: [], currentRound: 0, currentQ: 0, score: 1, totalQ: 4, wrong: [{ q: '문항', a: '정답' }] }; showResult()"],
    ['science_reading', "quizState = { questions: [{}, {}, {}, {}], currentIdx: 0, score: 1, wrong: [{ q: '문항', a: '정답' }], answered: false }; showResult()"],
    ['digest_reading', "quizState = { questions: [{}, {}, {}, {}], currentIdx: 0, score: 1, wrong: [{ q: '문항', a: '정답' }], answered: false }; showResult()"],
  ];
  for (const [file, js] of setups) {
    const page = await open(file);
    await step(page, js);
    assert.equal(await page.count('.result-btn-secondary'), 1, file + ': 결과 화면이 그려짐');
    const m = await page.eval(MEASURE('.result-btn-secondary'));
    assertTextBtn(m, file + ' .result-btn-secondary');
    const primary = await page.eval(MEASURE('.result-btn-primary'));
    assert.ok(primary.bg === PRIMARY_FILL || primary.bg === PRIMARY_FILL_HOVER, file + ': 주요 채움 유지 ' + primary.bg);
    assert.equal(primary.radius, '10px');
    // 호버: 바탕이 채워지지 않고 글자만 진해진다
    const box = await page.eval("(() => { const r = document.querySelector('.result-btn-secondary').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await sleep(100);
    const h = await page.eval(MEASURE('.result-btn-secondary'));
    assert.equal(h.bg, TRANSPARENT, file + ': 호버에서도 배경 투명');
    assert.notEqual(h.color, m.color, file + ': 호버에서 글자색이 바뀜(호버가 실제로 적용됨)');
    assert.ok(h.ratio >= m.ratio, file + ': 호버 글자가 더 진함');
    await done(page);
  }
});

test('217-2 literature .nav-btn: 테두리·배경 없는 ‹ › 글자, 44×44px, 대비 4.5:1, aria-label 있음, 눌러서 카드가 넘어가고 끝에서는 비활성', { skip: SKIP }, async () => {
  const page = await open('literature_compass');
  await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK))}); showCards();`);
  const prev = await page.eval(MEASURE('#prev-btn')), next = await page.eval(MEASURE('#next-btn'));
  for (const [m, label, glyph] of [[prev, '#prev-btn', '‹'], [next, '#next-btn', '›']]) {
    assertNoBox(m, label); assertTouch(m, label);
    assert.ok(m.ratio >= 4.5, `${label}: 대비 ${m.ratio.toFixed(2)}`); assert.equal(m.text, glyph, label + ': 화살표 글자');
    assert.ok(m.aria && m.aria.length > 0, label + ': aria-label'); assert.equal(m.underline, false, label + ': 기호만 있는 버튼은 밑줄 없음(217-4)');
  }
  assert.equal(next.cursor, 'pointer'); assert.equal(prev.cursor, 'not-allowed', '비활성(첫 카드)에서는 not-allowed');
  assert.equal(await page.eval("document.getElementById('prev-btn').disabled"), true, '첫 카드에서 이전은 비활성');
  const before = await page.text('#cards-progress');
  await page.click('#next-btn');
  await page.waitFor(`document.getElementById('cards-progress').textContent !== ${JSON.stringify(before)}`, 4000);
  assert.equal(await page.eval("document.getElementById('prev-btn').disabled"), false, '두 번째 카드에서 이전 활성');
  await done(page);
});

test('217-2 science·digest .carousel-nav-btn: 테두리·배경 없는 ‹ › 글자, 34px → 44×44px, 대비 4.5:1, aria-label 유지, 눌러서 개념/작품이 넘어감', { skip: SKIP }, async () => {
  for (const [file, setup] of [['science_reading', 'openField(FIELD_ORDER[0])'], ['digest_reading', null]]) {
    const page = await open(file);
    if (setup) await step(page, setup);
    await page.waitFor("document.querySelectorAll('.carousel-nav-btn').length === 2 && !!document.querySelector('.carousel-nav-count').textContent", 6000);
    await settle(page);
    const prev = await page.eval(MEASURE('.carousel-nav-btn[data-dir="-1"]')), next = await page.eval(MEASURE('.carousel-nav-btn[data-dir="1"]'));
    for (const [m, label, glyph] of [[prev, file + ' 이전', '‹'], [next, file + ' 다음', '›']]) {
      assertNoBox(m, label); assertTouch(m, label);
      assert.ok(m.ratio >= 4.5, `${label}: 대비 ${m.ratio.toFixed(2)}`); assert.equal(m.text, glyph, label + ': 화살표 글자');
      assert.ok(m.aria && m.aria.length > 0, label + ': aria-label'); assert.equal(m.underline, false, label + ': 기호만 있는 버튼은 밑줄 없음(217-4)'); assert.equal(m.cursor, 'pointer');
    }
    const before = await page.text('.carousel-nav-count');
    await page.click('.carousel-nav-btn[data-dir="1"]');
    await page.waitFor(`document.querySelector('.carousel-nav-count').textContent !== ${JSON.stringify(before)}`, 4000);
    await settle(page);
    await done(page);
  }
});

test('217-2 literature 홈 "어휘 사전" 링크: 그라데이션 박스 없이 한 줄 밑줄 텍스트, 높이 44px, 대비 4.5:1, 목적지 "/english_dictionary.html"(작업226-2b: 옛 "/" = METIS 홈에서 사전 화면으로 정정), 눌러서 이동', { skip: SKIP }, async () => {
  const page = await open('literature_compass');
  const m = await page.eval(MEASURE('.dict-link'));
  assertTextBtn(m, '.dict-link');
  assert.equal(m.text, '어휘 사전 →'); assert.ok(m.aria && m.aria.startsWith('어휘 사전'), 'aria-label이 보이는 글자로 시작');
  assert.equal(await page.eval("document.querySelector('.dict-link').getAttribute('href')"), '/english_dictionary.html');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.dict-link')).backgroundImage"), 'none', '그라데이션 없음');
  assert.equal(await page.count('#home-content a[style*="gradient"]'), 0, '옛 배너(인라인 그라데이션)가 남아 있지 않음');
  assert.ok(m.h < 60, '한 줄 높이(옛 배너는 약 70px): ' + m.h);
  await page.click('.dict-link');
  await page.waitFor("location.pathname === '/english_dictionary.html'", 6000);
  assert.deepEqual(page.errors, []);
  await page.close();
});

for (const w of [320, 390, 768]) {
  test(`217-2 레이아웃 ${w}px: 화살표·어휘 사전 링크가 가로 넘침 없이 들어가고 서로 겹치지 않음`, { skip: SKIP }, async () => {
    let page = await open('literature_compass', w);
    assert.equal(await page.hasHorizontalScroll(), false, '홈');
    await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK))}); showCards();`);
    const navOverlap = await page.eval("(() => { const a = document.getElementById('prev-btn').getBoundingClientRect(), b = document.getElementById('next-btn').getBoundingClientRect(); return a.right > b.left; })()");
    assert.equal(navOverlap, false, '이전·다음 화살표가 겹치지 않음');
    await done(page);
    for (const file of ['science_reading', 'digest_reading']) {
      page = await open(file, w);
      if (file === 'science_reading') await step(page, 'openField(FIELD_ORDER[0])');
      await page.waitFor("document.querySelectorAll('.carousel-nav-btn').length === 2", 6000);
      await settle(page);
      const ov = await page.eval("(() => { const [a, c, b] = ['.carousel-nav-btn[data-dir=\"-1\"]', '.carousel-nav-count', '.carousel-nav-btn[data-dir=\"1\"]'].map(s => document.querySelector(s).getBoundingClientRect()); return a.right > c.left + 0.5 || c.right > b.left + 0.5; })()");
      assert.equal(ov, false, file + ': 화살표와 쪽수 표시가 겹치지 않음');
      await done(page);
    }
  });
}
