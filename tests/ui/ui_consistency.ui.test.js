// 작업220~222: 화면 사이 UI 통일감(주 버튼·텍스트 버튼·섹션 제목·중립 글자색·퀴즈 틀·결과·하단 탭·사전 5탭·대비·글자 시작 x).
// 6개 화면(음성 학습, 개념 학습, 문학 나침반, 과학 읽기, 한입 독서, 언어 사전)을 헤드리스 Chrome(390px, 모의 서버)에서 실제로 그려 계산된 스타일로 확인한다.
// 이 파일의 원칙(작업216-3의 교훈): 테스트 쪽에서 transition·animation을 끄고(NO_MOTION) 레이아웃이 안정된 뒤(settle) 잰다.
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { NO_MOTION, DB_READY, me, settle, step, MEASURE, done } = require('./helpers/text_ui');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
// 글자색(주 / 보조): 회색 계열 = #1a1a1a / #6b7280, 푸른 계열 = #1a1f3c / #4a5070
const GRAY = { main: 'rgb(26, 26, 26)', sub: 'rgb(107, 114, 128)' }, BLUE = { main: 'rgb(26, 31, 60)', sub: 'rgb(74, 80, 112)' };
const CORAL_DARK = 'rgb(184, 68, 46)';

async function openVoice(width = 390) {
  srv.reset(); srv.state.me = me();
  srv.seedVoiceMap({ nodes: [{ id: 1, title: '광합성' }, { id: 2, title: '엽록체' }, { id: 3, title: '세포 호흡' }, { id: 4, title: '혼자 있는 자료', has_summary: false }], links: [], built_at: '2026-01-02T03:04:00Z' });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/voice_study.html');
  await page.waitFor("document.getElementById('list-count').textContent === '4건'", 8000);
  await page.eval(NO_MOTION); await settle(page);
  return page;
}
async function openConcept(width = 390) {
  srv.reset(); srv.state.me = me();
  srv.seed({ topic: '통일감', items: [{ term: '가', set: { review_state: 'new' } }, { term: '나', set: { review_state: 'confused' } }, { term: '다', set: { review_state: 'new' } }, { term: '라', set: { review_state: 'understood' } }, { term: '마', set: { review_state: 'new' } }] });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.eval(NO_MOTION); await settle(page);
  return page;
}
async function openReading(file, width = 390) {
  srv.reset(); srv.state.me = me();
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/' + file + '.html');
  await page.waitFor(DB_READY, 10000);
  await page.eval(NO_MOTION); await settle(page);
  return page;
}
const WORDS = "Array.from({ length: 12 }, (_, i) => ({ id: i + 1, word: 'word' + String.fromCharCode(97 + i), lang: 'en', short_meaning: '뜻' + (i + 1), nuance: '뉘앙스', meanings: [{ pos: 'noun', definition: '뜻' + (i + 1) }], similar: [{ word: 'sim' + i, core_meaning: '비슷', diff: '차이' }], savedAt: 1700000000000 + i }))";
async function openDict(width = 390) {
  srv.reset(); srv.state.me = me();
  const page = await browser.newPage({ width, height: 844, token: jwt() });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 });
  await page.goto(srv.url + '/english_dictionary.html');
  await page.waitFor("!!document.getElementById('search-input') && !!document.querySelector('.metis-app-header-logo')", 12000);
  await page.eval(NO_MOTION); await sleep(500); await settle(page);
  return page;
}

// 한 화면에서 보이는 글자의 "중립색"(채도가 낮은 색, 흰색 제외) 목록 — 공용 헤더·제목 줄·대화상자(공유 파일)는 뺀다
const NEUTRALS = `(() => { const out = {}; for (const e of document.body.querySelectorAll('*')) {
  if (!e.getClientRects().length || e.closest('.metis-app-header, .screen-bar, dialog') || /^(SCRIPT|STYLE|SVG|PATH|OPTION)$/i.test(e.tagName)) continue;
  const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(); if (!t) continue;
  const m = (getComputedStyle(e).color.match(/[\\d.]+/g) || []).map(Number); if (m.length > 3 && m[3] < 1) continue;
  const [r, g, b] = m; if (r === 255 && g === 255 && b === 255) continue;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) out['#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')] = (out['#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')] || 0) + 1; }
  return out; })()`;
const addTo = async (acc, page) => { const o = await page.eval(NEUTRALS); for (const k of Object.keys(o)) acc.add(k); };

const MCQ_Q = "[{ type: 'mcq', question: '다음 중 올바른 설명은?', options: ['첫째 보기', '둘째 보기', '셋째 보기', '넷째 보기'], answer: '셋째 보기', roundLabel: '4지선다' }, { type: 'mcq', question: '두 번째 문제', options: ['가', '나', '다', '라'], answer: '가', roundLabel: '4지선다' }]";
const OX_Q = "[{ type: 'ox', statement: '참인 문장', answer: true, explanation: '정답! 해설입니다.', roundLabel: 'OX' }, { type: 'ox', statement: '거짓인 문장', answer: false, explanation: '아닙니다. 해설입니다.', roundLabel: 'OX' }]";
const RESULT_Q = "quizState = { questions: [{}, {}, {}, {}], currentIdx: 0, score: 2, wrong: [{ q: '틀린 문항 하나', a: '정답 하나' }, { q: '틀린 문항 둘', a: '정답 둘' }], answered: false }; showResult();";
const LIT_MCQ = "quizData = { rounds: [{ type: 'mcq', questions: [{ question: '다음 중 올바른 설명은?', options: ['첫째 보기', '둘째 보기', '셋째 보기', '넷째 보기'], answer: '셋째 보기' }, { question: '두 번째', options: ['가', '나', '다', '라'], answer: '가' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 2 }; showView('view-quiz'); renderQuizRound();";
const LIT_OX = "quizData = { rounds: [{ type: 'ox', questions: [{ statement: '참인 문장', answer: true, explanation: '해설입니다.' }, { statement: '거짓인 문장', answer: false, explanation: '해설입니다.' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 2 }; showView('view-quiz'); renderQuizRound();";
const LIT_RESULT = "quizData = { rounds: [], currentRound: 0, currentQ: 0, score: 2, totalQ: 4, wrong: [{ q: '틀린 문항 하나', a: '정답 하나' }, { q: '틀린 문항 둘', a: '정답 둘' }] }; showResult();";
const VOICE_QUIZ = "quizData = [{ question: '엽록체에서 일어나는 일은?', choices: ['호흡', '증산', '광합성', '발효'], answer_index: 2, explanation: '엽록체에서 광합성이 일어난다.', quote: '엽록체에서 일어난다' }, { question: '두 번째 문제', choices: ['가', '나', '다', '라'], answer_index: 0, explanation: '설명', quote: '근거' }]; quizState = { i: 0, score: 0, answers: [], answered: false, saved: true }; showView('quiz'); $('quiz-result').style.display = 'none'; $('quiz-run').style.display = ''; renderQuizQuestion();";
const READ_QUIZ = (items) => `quizState = { questions: ${items}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`;
const DICT_QUIZ = `wordbook = ${WORDS}; selectedQuizType = 'en2ko'; isWrongQuiz = false; currentQuizPool = null; showPage('quiz'); startQuiz();`;

const m = (page, sel, pseudo = null, idx = 0) => page.eval(MEASURE(sel, pseudo, idx));
const taps = (x, y) => Math.max(x, y);

// ───────────────────────── (a) 주 버튼 ─────────────────────────
function assertPrimary(b, label) {
  assert.ok(b, label + ': 요소 없음');
  assert.ok(Math.max(b.h, b.minH) >= 43.5, `${label}: 높이 44px 이상 (h ${b.h}, min ${b.minH})`);
  assert.equal(b.size, 15, label + ': 글자 15px'); assert.equal(b.weight, '600', label + ': 굵기 600');
  assert.equal(b.padL, 20, label + ': 왼쪽 padding 20px'); assert.equal(b.padR, 20, label + ': 오른쪽 padding 20px');
  assert.equal(b.radius, '10px', label + ': radius var(--btn-radius) 10px');
}
test('220 (a) 주 버튼: 음성·개념·문학·과학·한입의 코랄 채움 버튼은 높이 ≥44, 15px/600, 좌우 padding 20px', { skip: SKIP }, async () => {
  let page = await openVoice();
  assertPrimary(await m(page, '#new-rec-btn'), '음성 #new-rec-btn');
  await step(page, 'openDetail(2)'); await page.waitFor("currentView === 'edit'"); await settle(page);
  assertPrimary(await m(page, '#sum-make'), '음성 #sum-make(.btn.small)');
  await step(page, VOICE_QUIZ); await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong, .mcq-option.correct')");
  assertPrimary(await m(page, '#quiz-next'), '음성 #quiz-next');
  await done(page);
  page = await openConcept();
  assertPrimary(await m(page, '#start-open'), '개념 #start-open');
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page);
  await page.click('[data-t="quiz-opt"][data-i="0"]'); await page.waitFor("!!document.querySelector('[data-t=quiz-next]')");
  assertPrimary(await m(page, '[data-t=quiz-next]'), '개념 퀴즈 다음');
  await done(page);
  page = await openReading('literature_compass');
  const id = await page.eval("(() => { const ms = DB.eras.flatMap(e => e.movements); return (ms.find(x => x.works && x.works.length >= 2) || ms[0]).id; })()");
  await step(page, `showBriefing(${JSON.stringify(id)})`);
  assertPrimary(await m(page, '.briefing-cta'), '문학 .briefing-cta');
  await step(page, 'showCards()');
  assertPrimary(await m(page, '.quiz-start-btn'), '문학 .quiz-start-btn(숨김 상태의 계산 값)');
  await step(page, LIT_MCQ); await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.quiz-next-btn.visible')");
  assertPrimary(await m(page, '.quiz-next-btn.visible'), '문학 .quiz-next-btn');
  await step(page, LIT_RESULT);
  assertPrimary(await m(page, '.result-btn-primary'), '문학 .result-btn-primary');
  await done(page);
  for (const file of ['science_reading', 'digest_reading']) {
    page = await openReading(file);
    await step(page, READ_QUIZ(MCQ_Q)); await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.quiz-next-btn.visible')");
    assertPrimary(await m(page, '.quiz-next-btn.visible'), file + ' .quiz-next-btn');
    await step(page, RESULT_Q);
    assertPrimary(await m(page, '.result-btn-primary'), file + ' .result-btn-primary');
    await done(page);
  }
});

// ───────────────────────── (b) 텍스트 버튼 ─────────────────────────
function assertTextBtn(b, label, color) {
  assert.ok(b, label + ': 요소 없음');
  assert.equal(b.size, 15, label + ': 글자 15px'); assert.equal(b.weight, '600', label + ': 굵기 600');
  assert.equal(b.color, color, label + ': 보조색'); assert.equal(b.padL, 8, label + ': 왼쪽 padding 8px'); assert.equal(b.padR, 8, label + ': 오른쪽 padding 8px');
  assert.ok(b.h >= 43.5 && b.w >= 43.5, `${label}: 44×44px 이상 (${b.w}x${b.h})`);
  assert.equal(b.underline, true, label + ': 밑줄'); assert.ok(b.ratio >= 4.5, `${label}: 대비 ${b.ratio.toFixed(2)}`);
  assert.equal(b.bg, 'rgba(0, 0, 0, 0)', label + ': 배경 투명'); assert.deepEqual(b.bw, ['0px', '0px', '0px', '0px'], label + ': 테두리 없음');
}
test('220 (b) 텍스트 버튼: 15px/600, 보조색, padding 0 8px, 최소 44×44px, 밑줄, 대비 4.5:1 (음성·개념·문학·과학·한입)', { skip: SKIP }, async () => {
  let page = await openVoice();
  assertTextBtn(await m(page, '#wrong-btn'), '음성 #wrong-btn', GRAY.sub);
  await step(page, 'openDetail(2)'); await page.waitFor("currentView === 'edit'"); await settle(page);
  assertTextBtn(await m(page, '#edit-cancel'), '음성 #edit-cancel', GRAY.sub);
  await done(page);
  page = await openConcept();
  await page.click('#start-open'); await settle(page);
  assertTextBtn(await m(page, '#start-cancel'), '개념 #start-cancel', BLUE.sub);
  await page.click('#start-cancel'); await page.waitFor("!!document.querySelector('[data-t=open-study]')"); await settle(page);
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page);
  assertTextBtn(await m(page, '[data-t=quiz-exit]'), '개념 [그만하기]', BLUE.sub);
  await done(page);
  page = await openReading('literature_compass');
  await step(page, LIT_RESULT);
  assertTextBtn(await m(page, '.result-btn-secondary'), '문학 .result-btn-secondary', GRAY.sub);
  await done(page);
  for (const file of ['science_reading', 'digest_reading']) {
    page = await openReading(file); await step(page, RESULT_Q);
    assertTextBtn(await m(page, '.result-btn-secondary'), file + ' .result-btn-secondary', GRAY.sub);
    await done(page);
  }
});

// ───────────────────────── (c) 섹션 제목 ─────────────────────────
function assertSection(s, label, { line = true } = {}) {
  assert.ok(s, label + ': 요소 없음');
  assert.equal(s.size, 12, label + ': 12px'); assert.equal(s.weight, '700', label + ': 700'); assert.equal(s.color, CORAL_DARK, label + ': --primary-dark #b8442e');
  assert.ok(s.ratio >= 4.5, `${label}: 대비 ${s.ratio.toFixed(2)}`);
  if (line) assert.equal(s.bw[2], '2px', label + ': 아래 2px 선');
}
test('220 (c) 섹션 제목: 12px/700/#b8442e + 아래 2px 코랄 선 (음성·개념·문학·과학·한입), 사전은 글자색만', { skip: SKIP }, async () => {
  let page = await openVoice();
  assertSection(await m(page, '.list-head h2'), '음성 .list-head h2');
  await step(page, 'openDetail(2)'); await page.waitFor("currentView === 'edit'"); await settle(page);
  assertSection(await m(page, '.field-label'), '음성 .field-label');
  await done(page);
  page = await openConcept();
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page);
  assertSection(await m(page, '.sec > .label'), '개념 .sec > .label');
  await done(page);
  page = await openReading('literature_compass');
  const id = await page.eval("(() => { const ms = DB.eras.flatMap(e => e.movements); return (ms.find(x => x.works && x.works.length >= 2) || ms[0]).id; })()");
  await step(page, `showBriefing(${JSON.stringify(id)})`);
  assertSection(await m(page, '.section-label'), '문학 .section-label');
  await step(page, 'showCards(); flipCard();');
  assertSection(await m(page, '.back-section-title'), '문학 .back-section-title');
  await step(page, LIT_RESULT);
  assertSection(await m(page, '.result-section-label'), '문학 .result-section-label');
  await done(page);
  page = await openReading('science_reading');
  await step(page, 'showScience(DB.concepts[0].id)');
  assertSection(await m(page, '.science-section-label'), '과학 .science-section-label');
  await step(page, RESULT_Q);
  assertSection(await m(page, '.result-section-label'), '과학 .result-section-label');
  await done(page);
  page = await openReading('digest_reading');
  await step(page, 'showDigest(DB.works[0].id)');
  assertSection(await m(page, '.digest-section-label'), '한입 .digest-section-label');
  await step(page, RESULT_Q);
  assertSection(await m(page, '.result-section-label'), '한입 .result-section-label');
  await done(page);
  page = await openDict();
  await step(page, `wordbook = ${WORDS}; showPage('wordbook')`);
  assertSection(await m(page, '.alpha-header'), '사전 .alpha-header', { line: false });
  assert.equal((await m(page, '.alpha-header')).bw[2], '2px', '사전 섹션 제목의 아래 2px 선은 그대로');
  await done(page);
});

// ───────────────────────── (d) 중립 글자색 ≤ 3 ─────────────────────────
test('220 (d) 한 화면 안의 중립 글자색(채도 낮은 색, 흰색·공용 헤더·제목 줄·대화상자 제외)이 3종 이하', { skip: SKIP }, async () => {
  const check = (name, set, allowed) => { assert.ok(set.size <= 3, `${name}: 중립 글자색 ${set.size}종 [${[...set]}]`); for (const c of set) assert.ok(allowed.includes(c), `${name}: 허용 밖의 중립색 ${c}`); };
  let acc = new Set(), page = await openVoice(); await addTo(acc, page);
  await step(page, "showView('record')"); await addTo(acc, page);
  await step(page, 'openDetail(2)'); await page.waitFor("currentView === 'edit'"); await settle(page); await addTo(acc, page);
  await step(page, VOICE_QUIZ); await addTo(acc, page);
  await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong, .mcq-option.correct')"); await addTo(acc, page);
  await step(page, "chatMessages = [{ role: 'user', content: '질문' }, { role: 'bot', content: '답', grounded: false, quotes: ['근거'] }]; showView('chat'); renderChat();"); await addTo(acc, page);
  await done(page); check('음성', acc, ['#1a1a1a', '#6b7280']);
  acc = new Set(); page = await openConcept(); await addTo(acc, page);
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page); await addTo(acc, page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page); await addTo(acc, page);
  await page.click('[data-t="quiz-opt"][data-i="0"]'); await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')"); await addTo(acc, page);
  await done(page); check('개념', acc, ['#1a1f3c', '#4a5070']);
  acc = new Set(); page = await openReading('literature_compass'); await addTo(acc, page);
  const id = await page.eval("(() => { const ms = DB.eras.flatMap(e => e.movements); return (ms.find(x => x.works && x.works.length >= 2) || ms[0]).id; })()");
  await step(page, `showBriefing(${JSON.stringify(id)})`); await addTo(acc, page);
  await step(page, 'showCards()'); await addTo(acc, page);
  await step(page, 'flipCard()'); await addTo(acc, page);
  await step(page, LIT_MCQ); await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong')"); await addTo(acc, page);
  await step(page, LIT_OX); await page.click('#ox-x'); await page.waitFor("document.getElementById('ox-x').classList.contains('wrong')"); await addTo(acc, page);
  await step(page, LIT_RESULT); await addTo(acc, page);
  await done(page); check('문학', acc, ['#1a1a1a', '#6b7280']);
  for (const [name, file, go] of [['과학', 'science_reading', 'showScience(DB.concepts[0].id)'], ['한입', 'digest_reading', 'showDigest(DB.works[0].id)']]) {
    acc = new Set(); page = await openReading(file); await addTo(acc, page);
    await step(page, go); await addTo(acc, page);
    await step(page, READ_QUIZ(MCQ_Q)); await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong')"); await addTo(acc, page);
    await step(page, READ_QUIZ(OX_Q)); await page.click('#ox-x'); await page.waitFor("document.getElementById('ox-x').classList.contains('wrong')"); await addTo(acc, page);
    await step(page, RESULT_Q); await addTo(acc, page);
    await done(page); check(name, acc, ['#1a1a1a', '#6b7280']);
  }
});

// ───────────────────────── (e)(f)(g)(h) 퀴즈 틀 ─────────────────────────
function assertOption(o, num, label, main) {
  assert.ok(o && num, label + ': 요소 없음');
  assert.equal(o.size, 15, label + ': 보기 글자 15px'); assert.equal(o.weight, '400', label + ': 굵기 400'); assert.equal(o.color, main, label + ': 주 글자색');
  assert.equal(num.w, 20, label + ': 번호 폭 20px 고정'); assert.ok(num.ratio >= 4.5, label + ': 번호 대비');
}
function assertQuestion(q, label, main) { assert.ok(q, label + ': 요소 없음'); assert.equal(q.size, 17, label + ': 질문 17px'); assert.equal(q.weight, '700', label + ': 700'); assert.equal(q.color, main, label + ': 주 글자색'); }
function assertFullWidth(b, label) { assert.ok(b.w >= b.parentInnerW - 1, `${label}: 다음 버튼 전체 폭 (${b.w} vs 부모 ${b.parentInnerW})`); }
test('221 (e)(f)(g) 퀴즈 풀이: 보기 15px/400 + 번호(폭 20) + 구분선, 질문 17px/700, 다음 버튼 전체 폭 (음성·개념·문학·과학·한입·사전)', { skip: SKIP }, async () => {
  let page = await openVoice(); await step(page, VOICE_QUIZ);
  assertOption(await m(page, '.mcq-text'), await m(page, '.mcq-num'), '음성 보기', GRAY.main); assert.equal((await m(page, '.mcq-option')).bw[2], '1px', '음성 보기 구분선');
  assertQuestion(await m(page, '.quiz-question'), '음성 질문', GRAY.main);
  await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong, .mcq-option.correct')");
  assertFullWidth(await m(page, '#quiz-next'), '음성');
  assert.ok((await m(page, '#quiz-progress-bar')) && (await m(page, '.quiz-progress-bar-wrap')), '음성 진행 막대');
  await done(page);
  page = await openConcept();
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page);
  assertOption(await m(page, '.qz-opt > span:last-child'), await m(page, '.qz-num'), '개념 보기', BLUE.main); assert.equal((await m(page, '.qz-opt')).bw[2], '1px', '개념 보기 구분선');
  assertQuestion(await m(page, '[data-t=quiz-prompt]'), '개념 질문', BLUE.main);
  assert.ok(await m(page, '.quiz-progress-bar'), '개념 진행 막대'); assert.ok(await page.eval("/문제 1 \\/ /.test(document.querySelector('[data-t=quiz-progress]').textContent)"), '개념 "문제 n / N" 글자');
  await page.click('[data-t="quiz-opt"][data-i="0"]'); await page.waitFor("!!document.querySelector('[data-t=quiz-next]')");
  assertFullWidth(await m(page, '[data-t=quiz-next]'), '개념');
  await done(page);
  page = await openReading('literature_compass'); await step(page, LIT_MCQ);
  assertOption(await m(page, '.mcq-text'), await m(page, '.mcq-num'), '문학 보기', GRAY.main); assertQuestion(await m(page, '.mcq-question'), '문학 질문', GRAY.main);
  await step(page, LIT_OX); assertQuestion(await m(page, '.ox-question'), '문학 OX 질문', GRAY.main);
  await step(page, LIT_MCQ); await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.quiz-next-btn.visible')");
  assertFullWidth(await m(page, '.quiz-next-btn.visible'), '문학'); assert.ok(await m(page, '.quiz-progress-bar'), '문학 진행 막대');
  await done(page);
  for (const file of ['science_reading', 'digest_reading']) {
    page = await openReading(file); await step(page, READ_QUIZ(MCQ_Q));
    assertOption(await m(page, '.mcq-text'), await m(page, '.mcq-num'), file + ' 보기', GRAY.main); assertQuestion(await m(page, '.quiz-question'), file + ' 질문', GRAY.main);
    await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.quiz-next-btn.visible')");
    assertFullWidth(await m(page, '.quiz-next-btn.visible'), file); assert.ok(await m(page, '.quiz-progress-bar'), file + ' 진행 막대');
    await done(page);
  }
  page = await openDict(); await step(page, DICT_QUIZ);
  assertOption(await m(page, '.quiz-option'), await m(page, '.quiz-option .mcq-num'), '사전 보기', BLUE.main); assert.equal((await m(page, '.quiz-option')).bw[2], '1px', '사전 보기 구분선');
  assertQuestion(await m(page, '.quiz-question'), '사전 질문', BLUE.main);
  assert.ok(await m(page, '.progress-fill'), '사전 진행 막대'); assert.ok(await page.eval("/\\d+ \\/ \\d+/.test(document.querySelector('.progress-text').textContent)"), '사전 "n / N" 글자');
  await page.click('.quiz-option', { index: 0 }); await page.waitFor("document.getElementById('quiz-next').style.display === 'block'");
  assertFullWidth(await m(page, '#quiz-next'), '사전');
  // 정오 기호: 사전 보기에 ○ 또는 ✕ 가 붙음(색만으로 구분하지 않음)
  assert.ok(await page.eval("[...document.querySelectorAll('.quiz-option.correct, .quiz-option.wrong')].every(o => getComputedStyle(o, '::before').content !== 'none' && getComputedStyle(o, '::before').content !== '\"\"')"), '사전 정오 기호');
  await done(page);
});

test('221 (d)(h) 해설 색: 정오 한 줄만 초록/빨강+기호, 해설·근거는 주 글자색 (음성·개념·OX)', { skip: SKIP }, async () => {
  let page = await openVoice(); await step(page, VOICE_QUIZ);
  await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong')");
  assert.equal((await m(page, '#quiz-feedback .fb-line')).color, 'rgb(180, 35, 24)', '음성 정오 줄 빨강'); assert.equal((await m(page, '#quiz-feedback .fb-sub')).color, GRAY.main, '음성 해설은 주 글자색');
  assert.equal((await m(page, '#quiz-feedback', '::before')).mark, '"✕"');
  await done(page);
  page = await openReading('literature_compass'); await step(page, LIT_OX); await page.click('#ox-x'); await page.waitFor("document.getElementById('ox-x').classList.contains('wrong')");
  assert.equal((await m(page, '#ox-feedback .fb-line')).color, 'rgb(180, 35, 24)', '문학 OX 정오 줄'); assert.equal((await m(page, '#ox-feedback')).color, GRAY.main, '문학 OX 해설은 주 글자색');
  await done(page);
});

test('221 (h) 결과 화면: 큰 점수 42px/700/#b8442e(사전은 글꼴 유지), 점수 아래 간격 28px, 이모지 없음 (음성·개념·문학·과학·한입·사전)', { skip: SKIP }, async () => {
  const EMOJI = /\p{Extended_Pictographic}/u;
  const check = (s, label) => { assert.equal(s.size, 42, label + ': 점수 42px'); assert.equal(s.weight, '700', label + ': 700'); assert.equal(s.color, CORAL_DARK, label + ': --primary-dark'); };
  let page = await openVoice(); await step(page, VOICE_QUIZ);
  await step(page, "quizState.answers = [{ q: 0, chosen: 0 }]; $('quiz-run').style.display = 'none'; $('quiz-score-num').textContent = '1'; $('quiz-score-total').textContent = '2'; $('quiz-result').style.display = ''; renderQuizWrong();");
  check(await m(page, '#quiz-score-num'), '음성'); assert.equal(await page.count('#quiz-wrong .result-wrong-item'), 1, '음성 결과에 틀린 문항 목록'); assert.ok(!EMOJI.test(await page.text('#quiz-result')), '음성 이모지 없음');
  assert.equal((await page.eval("getComputedStyle(document.querySelector('.result-score-wrap')).marginBottom")), '28px', '음성 점수 아래 간격 28px');
  await done(page);
  page = await openConcept();
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page);
  await step(page, 'S.quiz.i = S.quiz.questions.length; S.quiz.results = [{ item: S.items[0], correct: true }, { item: S.items[1], correct: false }]; renderQuiz();');
  check(await m(page, '[data-t=quiz-score-big]'), '개념'); assert.equal(await page.text('[data-t=quiz-score]'), '5문제 중 1개 맞혔어요'); assert.ok(!EMOJI.test(await page.text('#quiz-box')), '개념 이모지 없음');
  assert.equal((await page.eval("getComputedStyle(document.querySelector('.result-score-wrap')).marginBottom")), '28px', '개념 점수 아래 간격 28px');
  assert.equal(await page.count('[data-t=quiz-wrong]'), 1, '개념 틀린 개념 목록(기존 정보 유지)');
  await done(page);
  page = await openReading('literature_compass'); await step(page, LIT_RESULT);
  check(await m(page, '.result-score'), '문학'); assert.ok(!EMOJI.test(await page.text('#view-result')), '문학 이모지 없음'); assert.equal(await page.count('.result-emoji'), 0);
  assert.equal((await page.eval("getComputedStyle(document.querySelector('.result-score-wrap')).marginBottom")), '28px', '문학 점수 아래 간격 28px');
  await done(page);
  for (const file of ['science_reading', 'digest_reading']) {
    page = await openReading(file); await step(page, RESULT_Q);
    check(await m(page, '.result-score'), file); assert.ok(!EMOJI.test(await page.text('#view-result')), file + ' 이모지 없음'); assert.equal(await page.count('.result-emoji'), 0);
    assert.equal((await page.eval("getComputedStyle(document.querySelector('.result-score-wrap')).marginBottom")), '28px', file + ' 점수 아래 간격 28px');
    await done(page);
  }
  page = await openDict();
  await step(page, `wordbook = ${WORDS}; quizState = { type: 'en2ko', questions: wordbook.slice(0, 10), current: 9, correct: 7, wrongWords: [wordbook[0], wordbook[1]] }; renderQuizResult();`);
  const sc = await m(page, '.result-score'); assert.equal(sc.size, 42, '사전 점수 42px'); assert.equal(sc.weight, '700'); assert.equal(sc.color, CORAL_DARK); assert.ok(/Sora/.test(sc.family), '사전 점수 글꼴은 기존(Sora) 유지');
  assert.ok(!EMOJI.test(await page.text('.quiz-result-card')), '사전 이모지 없음');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.result-score-label')).marginBottom"), '28px', '사전 점수 아래 간격 28px');
  assert.equal((await m(page, '.quiz-result-card')).bw[0], '0px', '사전 결과 카드 박스 없음');
  await done(page);
});

// ───────────────────────── (i) 하단 탭 ─────────────────────────
test('222 (i) 하단 내비(작업226-2 갱신): 문학 홈/퀴즈/사전, 과학·한입 홈/정복/퀴즈, 퀴즈 풀이 중 "퀴즈" 탭이 활성', { skip: SKIP }, async () => {
  const tabs = p => p.eval("[...document.querySelectorAll('.bottom-nav .bottom-nav-tab')].map(b => ({ text: b.textContent.trim(), active: b.classList.contains('active') }))");
  let page = await openReading('literature_compass');
  assert.deepEqual((await tabs(page)).map(t => t.text), ['홈', '퀴즈', '사전']);
  await step(page, LIT_MCQ);
  assert.deepEqual(await tabs(page), [{ text: '홈', active: false }, { text: '퀴즈', active: true }, { text: '사전', active: false }], '문학 퀴즈 중 퀴즈 탭 활성');
  await step(page, LIT_RESULT);
  assert.equal((await tabs(page))[1].active, true, '문학 결과 화면에서도 퀴즈 탭 활성');
  await done(page);
  for (const file of ['science_reading', 'digest_reading']) {
    page = await openReading(file);
    assert.deepEqual((await tabs(page)).map(t => t.text), ['홈', '정복', '퀴즈'], file);
    await step(page, READ_QUIZ(MCQ_Q));
    assert.deepEqual(await tabs(page), [{ text: '홈', active: false }, { text: '정복', active: false }, { text: '퀴즈', active: true }], file + ' 퀴즈 중 퀴즈 탭 활성');
    await done(page);
  }
});

// ───────────────────────── (j) 사전 5탭 ─────────────────────────
test('222 (j) 사전 5번째 탭 "오답노트"가 잘리지 않음: 320 / 390 / 768px에서 마지막 탭이 내비 안, 라벨 scrollWidth ≤ clientWidth', { skip: SKIP }, async () => {
  for (const w of [320, 390, 768]) {
    const page = await openDict(w);
    const r = await page.eval(`(() => { const nav = document.querySelector('nav').getBoundingClientRect(); const tabs = [...document.querySelectorAll('.nav-tab')]; const last = tabs[tabs.length - 1].getBoundingClientRect();
      return { navRight: nav.right, lastRight: last.right, count: tabs.length, labels: tabs.map(t => { const l = t.querySelector('.nav-tab-label'); return [l.textContent, l.scrollWidth <= l.clientWidth]; }), lastText: tabs[tabs.length - 1].textContent.trim() }; })()`);
    assert.equal(r.count, 5); assert.ok(r.lastRight <= r.navRight - 16 + 0.5, `${w}px: 마지막 탭 오른쪽 ${r.lastRight} ≤ 내비 안쪽 ${r.navRight - 16}`);
    for (const [t, ok] of r.labels) assert.ok(ok, `${w}px: 라벨 "${t}" 잘림`);
    assert.match(r.lastText, /^오답노트/, '5번째 라벨 전체가 보임');
    await done(page);
  }
});

// ───────────────────────── (k) 대비 ─────────────────────────
// 각 화면의 "보조색·약한 색" 글자가 모두 4.5:1 이상: 회색 계열 #6b7280, 푸른 계열 #4a5070(사전의 약한 색도 같은 값으로 올림)
const SUB_CONTRAST = colors => `(() => { const out = []; const num = c => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([R, G, B]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
  const eff = e => { for (let a = e; a; a = a.parentElement) { const n = num(getComputedStyle(a).backgroundColor); if (n.length >= 3 && (n.length < 4 || n[3] > 0.99)) return n; } return [255, 255, 255]; };
  for (const e of document.body.querySelectorAll('*')) { if (!e.getClientRects().length || e.closest('.metis-app-header, dialog') || e.disabled) continue;
    const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(); if (!t) continue;
    const c = getComputedStyle(e).color; if (!${JSON.stringify(colors)}.includes(c)) continue;
    const l1 = lum(num(c)), l2 = lum(eff(e)); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 4.5) out.push((e.id ? '#' + e.id : '') + '.' + String(e.className).trim().replace(/\\s+/g, '.') + ' ' + ratio.toFixed(2) + ' "' + t.slice(0, 10) + '"'); }
  return out; })()`;
test('220 (k) 글자 대비: 보조·약한 색 글자가 모두 4.5:1 이상(과학 .source-note, 사전 --text3 포함), 문장 속 링크는 밑줄 + #b8442e', { skip: SKIP }, async () => {
  let page = await openReading('science_reading');
  await step(page, "showScience(DB.concepts.find(c => c.sources && c.sources.length).id)");
  const note = await m(page, '.source-note'); assert.equal(note.color, GRAY.sub, '#9ca3af 대신 보조색'); assert.ok(note.ratio >= 4.5, 'source-note 대비 ' + note.ratio.toFixed(2));
  const link = await m(page, '.source-name a'); assert.equal(link.color, CORAL_DARK); assert.equal(link.underline, true); assert.ok(link.ratio >= 4.5);
  assert.deepEqual(await page.eval(SUB_CONTRAST([GRAY.sub])), [], '과학 상세의 보조색 글자');
  await done(page);
  page = await openReading('digest_reading'); await step(page, 'showDigest(DB.works[0].id)');
  assert.deepEqual(await page.eval(SUB_CONTRAST([GRAY.sub])), [], '한입 상세의 보조색 글자'); await done(page);
  page = await openReading('literature_compass');
  assert.deepEqual(await page.eval(SUB_CONTRAST([GRAY.sub])), [], '문학 홈의 보조색 글자'); await done(page);
  page = await openVoice(); assert.deepEqual(await page.eval(SUB_CONTRAST([GRAY.sub])), [], '음성 목록의 보조색 글자'); await done(page);
  page = await openConcept(); assert.deepEqual(await page.eval(SUB_CONTRAST([BLUE.sub])), [], '개념 목록의 보조색 글자'); await done(page);
  page = await openDict();
  assert.deepEqual(await page.eval(SUB_CONTRAST([BLUE.sub])), [], '사전 홈의 보조·약한 색 글자');
  await step(page, DICT_QUIZ); assert.deepEqual(await page.eval(SUB_CONTRAST([BLUE.sub])), [], '사전 퀴즈의 보조·약한 색 글자');
  assert.equal(await page.eval("getComputedStyle(document.documentElement).getPropertyValue('--text3').trim().toLowerCase()"), '#4a5070', '사전 --text3(약한 글자색)을 4.5:1 이상인 값으로');
  await done(page);
});

// ───────────────────────── (l) 본문 시작 x ─────────────────────────
test('222 (l) 글자 시작 x: 카드 테두리가 없어진 뒤에도 본문이 제목과 같은 16px에서 시작(음성·개념·문학·과학·한입, 390px)', { skip: SKIP }, async () => {
  const left = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return Math.round((r.left + parseFloat(getComputedStyle(e).paddingLeft)) * 10) / 10; })()`);
  const at16 = async (page, sel, label) => assert.equal(await left(page, sel), 16, `${label}(${sel}) 글자 시작 x`);
  let page = await openVoice();
  await at16(page, '.note-title', '음성 목록 행');
  await step(page, VOICE_QUIZ); await at16(page, '.quiz-question', '음성 퀴즈 질문'); await at16(page, '.mcq-option', '음성 보기 행');
  await done(page);
  page = await openConcept();
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page);
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page);
  await at16(page, '.qz-prompt', '개념 퀴즈 질문');
  await done(page);
  page = await openReading('literature_compass');
  await at16(page, '.era-name', '문학 시대 영역');
  const id = await page.eval("(() => { const ms = DB.eras.flatMap(e => e.movements); return (ms.find(x => x.works && x.works.length >= 2) || ms[0]).id; })()");
  await step(page, `showBriefing(${JSON.stringify(id)})`); await at16(page, '.section-box', '문학 설명 영역');
  await step(page, LIT_MCQ); await at16(page, '.mcq-question', '문학 퀴즈 질문');
  await done(page);
  page = await openReading('science_reading'); await step(page, 'showScience(DB.concepts[0].id)');
  await at16(page, '.science-work-title', '과학 상세 머리'); await at16(page, '.science-section-label', '과학 구역');
  await done(page);
  page = await openReading('digest_reading'); await step(page, 'showDigest(DB.works[0].id)');
  await at16(page, '.digest-work-title', '한입 상세 머리'); await at16(page, '.digest-section-label', '한입 구역');
  await done(page);
});

// ───────────────────────── 상세 화면 상단 바 제목(220-4) ─────────────────────────
test('220 (4) 과학·한입 상세 화면 상단 바 제목 = 개념/작품 이름, 한 줄 말줄임', { skip: SKIP }, async () => {
  let page = await openReading('science_reading'); await step(page, 'showScience(DB.concepts[0].id)');
  const t = await page.eval("(() => { const e = document.getElementById('science-bar-title'); const cs = getComputedStyle(e); return { text: e.textContent, expect: DB.concepts[0].title, nowrap: cs.whiteSpace, ell: cs.textOverflow, oneLine: e.getBoundingClientRect().height < 30 }; })()");
  assert.equal(t.text, t.expect); assert.equal(t.nowrap, 'nowrap'); assert.equal(t.ell, 'ellipsis'); assert.ok(t.oneLine);
  await step(page, "document.getElementById('science-bar-title').textContent = '아주 긴 개념 이름 '.repeat(8)");
  assert.ok(await page.eval("(() => { const e = document.getElementById('science-bar-title'); return e.scrollWidth > e.clientWidth && e.getBoundingClientRect().height < 30; })()"), '긴 제목은 한 줄에서 말줄임');
  await done(page);
  page = await openReading('digest_reading'); await step(page, 'showDigest(DB.works[0].id)');
  assert.equal(await page.text('#digest-bar-title'), await page.eval("'「' + DB.works[0].title + '」'"));
  await done(page);
});
