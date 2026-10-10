// 작업217-4: 자동 훑기 — 각 화면의 주요 상태를 그린 뒤, "박스"로 보이는 요소(computed style 기준: 테두리 2면 이상, 그림자, 그라데이션,
// 둥근 모서리+배경/테두리, 흰색·페이지 바탕색이 아닌 배경색)가 허용 목록 밖에 하나라도 있으면 실패한다.
// 클래스 이름이 아니라 계산된 스타일로 찾기 때문에, 이름을 모르는 새 요소(예: 작업216의 .keyword-tag 누락 같은 사고)도 잡힌다.
// 예외: 흰색 평면 면(테두리 1면 이하), 페이지 바탕색과 같은 면, 주 동작 코랄 채움 버튼, 입력 필드(input/textarea/select), 그리고 아래 허용 목록.
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { NO_MOTION, DB_READY, me, settle, step, SWEEP, done } = require('./helpers/text_ui');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

// ── 허용 목록: [선택자, 이유] — 박스가 남아 있지만 이번 작업에서 의도적으로 유지하는 것 ──
const ALLOW = [
  // 작업 지시의 "유지(예외)" 목록
  ['.rec-btn', '녹음 원 버튼: 화면의 유일한 주 동작이며 녹음/정지 상태를 색·모양으로 구분'],
  ['.rec-dot', '녹음 중 표시 점(10px 원형 표시기, 글자가 아닌 인디케이터)'],
  ['.tl-bar', '시대 막대: 위치·길이가 시기를 나타내는 시각 요소'],
  ['.movement-pill', '죽은 코드(renderPills가 호출되지 않음) — 삭제하지 않고 목록만 보고'],
  ['.bubble', '말풍선(.bubble.user/.bot): 화자 구분이 박스에 의존'],
  ['.flip-card, .flip-card-front, .flip-card-back', '문학 작품 카드: 카드 모양이 뒤집기 동작 단서'],
  ['dialog', '대화상자 계열(.vm-sheet, .vm-subject, .map-sheet 등): 모달 경계'],
  ['.vm-box, .vm-card, .map-box', '지도 영역(드래그 경계)과 지도 위 카드'],
  ['.tab-bar, .bottom-bar, .conquest-bar, .bottom-nav', '구조 막대(하단 탭·입력·정복 바, 작업224-2: 음성 학습 하단 내비 — 사전 하단 내비와 같은 윗선·그림자)'],
  ['.chat-input-bar', '입력창 줄(입력 필드 영역)'],
  // 진행 표시·스피너 등 구조·장식
  ['.spinner', '로딩 스피너'],
  ['.quiz-progress-bar-wrap, .quiz-progress-bar, .progress, .progress .bar', '진행 막대'],
  ['.dot, .dot-indicators', '카드 위치 표시 점(진행 표시)'],
  ['.metis-app-header, .screen-bar', '공용 상단 헤더(아래 선 1개, 사전과 공유하는 파일)'],
];
const ALLOW_SEL = ALLOW.map(a => a[0]);
const sweep = (page, label) => page.eval(SWEEP(ALLOW_SEL)).then(r => assert.deepEqual(r, [], `${label}: 허용 목록 밖의 박스 요소`));

async function openPage(file, { ready = DB_READY, setup, width = 390 } = {}) {
  srv.reset(); srv.state.me = me();
  if (setup) setup(srv);
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/' + file + '.html');
  await page.waitFor(ready, 10000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}

// ── 자체 검증: 훑기가 실제로 박스를 잡는다 ──
test('훑기 자체 검증: 알약·색 바탕·그림자·테두리 두 면 이상·그라데이션은 잡고, 흰 평면 면·페이지 바탕색·주 동작 채움 버튼·입력 필드·허용 목록은 통과', { skip: SKIP }, async () => {
  const page = await openPage('literature_compass');
  const probe = css => `(() => { const old = document.getElementById('probe'); if (old) old.remove(); const s = document.createElement('div'); s.id = 'probe'; s.textContent = '프로브'; s.style.cssText = ${JSON.stringify(css)}; (document.querySelector('.view.active') || document.body).appendChild(s); })()`;
  const bad = ['display:inline-block;padding:4px 10px;border-radius:20px;background:#fee', 'background:#fdf0ec', 'box-shadow:0 1px 4px rgba(0,0,0,.1)', 'border:1px solid #888;padding:4px',
    'border-left:3px solid #888;border-top:1px solid #888', 'background:linear-gradient(#fff,#eee)', 'display:inline-block;border:1px solid #888;border-radius:50%'];
  for (const css of bad) { await page.eval(probe(css)); assert.equal((await page.eval(SWEEP(ALLOW_SEL))).length, 1, '잡아야 함: ' + css); }
  const good = ['background:#fff;border-bottom:1px solid #ccc', 'background:#fff', 'border-left:2px solid #e2583b;padding-left:8px', 'background:rgb(245, 247, 255)'];
  for (const css of good) { await page.eval(probe(css)); assert.equal((await page.eval(SWEEP(ALLOW_SEL))).length, 0, '통과해야 함: ' + css); }
  await page.eval(probe('')); await page.eval("document.getElementById('probe').innerHTML = '<span class=\"tl-bar\" style=\"border:1px solid #888;border-radius:8px;background:#fee\">x</span>'");
  assert.equal((await page.eval(SWEEP(ALLOW_SEL))).length, 0, '허용 목록(.tl-bar)은 통과');
  await page.eval("document.getElementById('probe').innerHTML = '<button style=\"background:#b8442e;color:#fff;border-radius:10px;border:none\">주 동작</button><input style=\"border:1px solid #888;border-radius:10px\">'");
  assert.equal((await page.eval(SWEEP(ALLOW_SEL))).length, 0, '주 동작 채움 버튼·입력 필드는 통과');
  await page.close();
});

// ── voice_study ──
test('훑기 voice_study: 목록·선택 모드·녹음·상세·퀴즈(풀이·결과)·합본·대화', { skip: SKIP }, async () => {
  const page = await openPage('voice_study', { ready: "document.getElementById('list-count') && document.getElementById('list-count').textContent.length > 0", setup: s => s.seedVoiceMap({ nodes: [{ id: 1, title: '광합성' }, { id: 2, title: '엽록체' }, { id: 3, title: '세포 호흡' }, { id: 4, title: '혼자 있는 자료', has_summary: false }], links: [], built_at: '2026-01-02T03:04:00Z' }) });
  await page.waitFor("document.getElementById('list-count').textContent === '4건'", 8000);
  await sweep(page, '목록');
  await step(page, "document.getElementById('sel-toggle').style.display = ''; document.getElementById('sel-toggle').click();"); await sweep(page, '선택 모드');
  await step(page, "document.getElementById('sel-toggle').click(); showView('record');"); await sweep(page, '녹음');
  await step(page, "openDetail(2)"); await page.waitFor("currentView === 'edit'"); await settle(page); await sweep(page, '상세');
  await step(page, "quizData = [{ question: 'Q', choices: ['가', '나', '다', '라'], answer_index: 2, explanation: '해설', quote: '근거' }, { question: 'Q2', choices: ['가', '나', '다', '라'], answer_index: 0, explanation: '해설', quote: '근거' }]; quizState = { i: 0, score: 0, answers: [], answered: false, saved: true }; showView('quiz'); $('quiz-result').style.display = 'none'; $('quiz-run').style.display = ''; renderQuizQuestion();");
  await sweep(page, '퀴즈 풀이(채점 전)');
  await step(page, "answerQuiz(0)"); await sweep(page, '퀴즈 풀이(오답 채점 후)');
  await step(page, "$('quiz-run').style.display = 'none'; $('quiz-score-num').textContent = '1'; $('quiz-score-total').textContent = '2'; $('quiz-result-msg').textContent = '결과'; $('quiz-result').style.display = '';"); await sweep(page, '퀴즈 결과');
  await step(page, "mergeOrder = [1, 2, 3]; renderMerge(); showView('merge');"); await sweep(page, '합본');
  await step(page, "chatMessages = [{ role: 'user', content: '질문' }, { role: 'bot', content: '답', grounded: false, quotes: ['근거'] }]; showView('chat'); renderChat();"); await sweep(page, '대화');
  await done(page);
});

// ── concept_study ──
test('훑기 concept_study: 학습 목록·시작 폼·상세·퀴즈(풀이·채점 후)', { skip: SKIP }, async () => {
  srv.reset(); srv.state.me = me();
  srv.seed({ topic: '훑기용', items: [{ term: '가', set: { review_state: 'new' } }, { term: '나', set: { review_state: 'confused' } }, { term: '다', set: { review_state: 'new' } }, { term: '라', set: { review_state: 'understood' } }], links: [[0, 1], [1, 2]], path: [0, 1] });
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.eval(NO_MOTION); await settle(page);
  await sweep(page, '학습 목록');
  await page.click('#start-open'); await settle(page); await sweep(page, '시작 폼');
  await page.click('#start-cancel'); await page.waitFor("!!document.querySelector('[data-t=open-study]')"); await settle(page);
  await page.click('[data-t="open-study"]'); await page.waitFor("!!document.querySelector('[data-t=term]')"); await settle(page); await sweep(page, '상세');
  await page.click('#quiz-open'); await page.waitFor("!!document.querySelector('[data-t=quiz-question]')"); await settle(page); await sweep(page, '퀴즈 풀이');
  await page.click('[data-t="quiz-opt"][data-i="0"]'); await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')"); await settle(page); await sweep(page, '퀴즈 채점 후');
  await done(page);
});

// ── 읽기 3화면 ──
const MCQ = "[{ type: 'mcq', question: 'Q', options: ['가', '나', '다', '라'], answer: '다', explanation: '해설', roundLabel: 'r' }]";
const OX = "[{ type: 'ox', statement: '참인 문장', answer: true, explanation: '정답! 해설입니다.', roundLabel: 'r' }]";
test('훑기 literature_compass: 홈·사조 설명·카드 앞/뒤·퀴즈(짝 맞추기·OX·4지선다, 채점 후)·결과', { skip: SKIP }, async () => {
  const page = await openPage('literature_compass');
  await sweep(page, '홈');
  const id = await page.eval("(() => { const ms = DB.eras.flatMap(e => e.movements); return (ms.find(x => x.works && x.works.length >= 2) || ms[0]).id; })()");
  await step(page, `showBriefing(${JSON.stringify(id)})`); await sweep(page, '사조 설명');
  await step(page, 'showCards()'); await sweep(page, '카드 앞면');
  await step(page, 'flipCard()'); await sweep(page, '카드 뒷면');
  await step(page, "quizData = { rounds: [{ type: 'matching', pairs: [{ id: 'a', work: '작품일', author: '작가일' }, { id: 'b', work: '작품이', author: '작가이' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 2 }; showView('view-quiz'); renderQuizRound();");
  await sweep(page, '짝 맞추기');
  await page.click('#mw-a'); await sweep(page, '짝 맞추기(선택)');
  await page.click('#ma-a'); await page.waitFor("document.getElementById('ma-a').classList.contains('correct')"); await sweep(page, '짝 맞추기(맞음)');
  await step(page, "quizData = { rounds: [{ type: 'ox', questions: [{ statement: '참인 문장', answer: true, explanation: '해설' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 1 }; showView('view-quiz'); renderQuizRound();");
  await sweep(page, 'OX'); await page.click('#ox-x'); await page.waitFor("document.getElementById('ox-x').classList.contains('wrong')"); await sweep(page, 'OX(오답)');
  await step(page, "quizData = { rounds: [{ type: 'mcq', questions: [{ question: 'Q', options: ['가', '나', '다', '라'], answer: '다' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 1 }; showView('view-quiz'); renderQuizRound();");
  await sweep(page, '4지선다'); await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong')"); await sweep(page, '4지선다(오답)');
  await step(page, "quizData = { rounds: [], currentRound: 0, currentQ: 0, score: 1, totalQ: 4, wrong: [{ q: '첫 문항', a: '정답 하나' }, { q: '둘째 문항', a: '정답 둘' }] }; showResult()");
  await sweep(page, '결과');
  await done(page);
});

test('훑기 science_reading: 과목 선택·캐러셀·개념 상세(정복 전/후)·퀴즈(4지선다·OX, 채점 후)·결과', { skip: SKIP }, async () => {
  const page = await openPage('science_reading');
  await sweep(page, '과목 선택');
  await step(page, 'openField(FIELD_ORDER[0])'); await page.waitFor("!!document.querySelector('.carousel-card.is-center')"); await settle(page); await sweep(page, '캐러셀');
  await step(page, 'showScience(DB.concepts[0].id)'); await sweep(page, '개념 상세(정복 전)');
  await page.click('#conquest-btn'); await page.waitFor("document.getElementById('conquest-btn').classList.contains('conquered')"); await sweep(page, '개념 상세(정복 후)');
  await step(page, `quizState = { questions: ${MCQ}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`); await sweep(page, '4지선다');
  await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong')"); await sweep(page, '4지선다(오답)');
  await step(page, `quizState = { questions: ${OX}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`); await sweep(page, 'OX');
  await page.click('#ox-x'); await page.waitFor("document.getElementById('ox-x').classList.contains('wrong')"); await sweep(page, 'OX(오답)');
  await step(page, "quizState = { questions: [{}, {}, {}, {}], currentIdx: 0, score: 1, wrong: [{ q: '첫 문항', a: '정답 하나' }, { q: '둘째 문항', a: '정답 둘' }], answered: false }; showResult()"); await sweep(page, '결과');
  await done(page);
});

test('훑기 digest_reading: 목록(캐러셀)·작품 상세(정복 전/후)·퀴즈(4지선다·OX, 채점 후)·결과', { skip: SKIP }, async () => {
  const page = await openPage('digest_reading');
  await page.waitFor("!!document.querySelector('.carousel-card.is-center')", 6000); await settle(page);
  await sweep(page, '목록');
  await step(page, 'showDigest(DB.works[0].id)'); await sweep(page, '작품 상세(정복 전)');
  await page.click('#conquest-btn'); await page.waitFor("document.getElementById('conquest-btn').classList.contains('conquered')"); await sweep(page, '작품 상세(정복 후)');
  await step(page, `quizState = { questions: ${MCQ}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`); await sweep(page, '4지선다');
  await page.click('.mcq-option', { index: 0 }); await page.waitFor("!!document.querySelector('.mcq-option.wrong')"); await sweep(page, '4지선다(오답)');
  await step(page, `quizState = { questions: ${OX}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`); await sweep(page, 'OX');
  await page.click('#ox-x'); await page.waitFor("document.getElementById('ox-x').classList.contains('wrong')"); await sweep(page, 'OX(오답)');
  await step(page, "quizState = { questions: [{}, {}, {}, {}], currentIdx: 0, score: 1, wrong: [{ q: '첫 문항', a: '정답 하나' }, { q: '둘째 문항', a: '정답 둘' }], answered: false }; showResult()"); await sweep(page, '결과');
  await done(page);
});
