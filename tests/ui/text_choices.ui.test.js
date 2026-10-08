// 작업217-3: 퀴즈 선택지·상태 버튼의 텍스트화(박스 없음). 상태는 색 하나로만 구분하지 않고 기호(○ ✕ ✓)와 굵기·밑줄을 함께 쓴다.
// 이 파일의 원칙(작업216-3의 교훈): ① 테스트 쪽에서 transition·animation을 끄고 ② 클릭 전에 레이아웃이 안정될 때까지 기다린다.
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
const GREEN = 'rgb(8, 80, 65)', RED = 'rgb(180, 35, 24)', TEXT2 = 'rgb(107, 114, 128)';   // --success-dark, --error-dark(=프로젝트 위험색 #B42318), --text2
const NO_MOTION = `(() => { const s = document.createElement('style'); s.id = 'test-no-motion'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()`;
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'";
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });

// 클릭 경합 방지: 글꼴 로드 + 보이는 버튼·행 위치가 50ms 간격으로 연속 4번 같을 때까지 기다린다
async function settle(page) {
  await page.waitFor("document.fonts.status === 'loaded'", 5000);
  let last = '', same = 0;
  for (let i = 0; i < 100 && same < 4; i++) {
    const now = await page.eval("[...document.querySelectorAll('button, a, .match-item, .mcq-option, .ox-btn')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top) + ':' + Math.round(r.left); }).join('|') + '|' + document.documentElement.scrollHeight");
    same = now === last ? same + 1 : 0; last = now;
    await sleep(50);
  }
  assert.ok(same >= 4, '화면 레이아웃이 안정되지 않음');
}
const step = async (page, js) => { await page.eval(js); await sleep(150); await settle(page); };
async function openReading(file, width = 390) {
  srv.reset(); srv.state.me = me();
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/' + file + '.html');
  await page.waitFor(DB_READY, 10000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}
async function openVoice(width = 390) {
  srv.reset(); srv.state.me = me();
  srv.seedVoiceMap({ nodes: [{ id: 1, title: '광합성' }], links: [], built_at: '2026-01-02T03:04:00Z' });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/voice_study.html');
  await page.waitFor("document.getElementById('list-count').textContent.length > 0", 8000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}

// 요소 하나(또는 의사 요소)의 모양·글자 대비를 잰다. 실제 바탕색은 조상에서 찾는다.
const MEASURE = (sel, pseudo = null, idx = 0) => `(() => {
  const e = document.querySelectorAll(${JSON.stringify(sel)})[${idx}];
  if (!e) return null;
  const cs = getComputedStyle(e), r = e.getBoundingClientRect(), ps = ${pseudo ? `getComputedStyle(e, ${JSON.stringify(pseudo)})` : 'null'};
  const num = c => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([R, G, B]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
  let bgEff = 'rgb(255, 255, 255)';
  for (let a = e; a; a = a.parentElement) { const b = getComputedStyle(a).backgroundColor; const n = num(b); if (n.length < 4 || n[3] > 0.99) { if (n.length >= 3) { bgEff = b; break; } } }
  const ratio = c => { const l1 = lum(num(c)), l2 = lum(num(bgEff)); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  return { text: e.textContent.trim(), cls: e.className, w: r.width, h: r.height, left: r.left, top: r.top, bg: cs.backgroundColor, bgImage: cs.backgroundImage, shadow: cs.boxShadow,
    bw: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], bb: cs.borderBottomStyle, radius: cs.borderTopLeftRadius, color: cs.color, bgEff, ratio: ratio(cs.color),
    underline: cs.textDecorationLine.includes('underline'), weight: cs.fontWeight, size: parseFloat(cs.fontSize), cursor: cs.cursor, pad: cs.padding,
    mark: ps ? ps.content : null, markColor: ps ? ps.color : null, markRatio: ps ? ratio(ps.color) : null, markWeight: ps ? ps.fontWeight : null };
})()`;
function assertNoBox(m, label, { bottomLine = false } = {}) {
  assert.ok(m, label + ': 요소 없음');
  assert.equal(m.bg, TRANSPARENT, label + ': 배경 투명'); assert.equal(m.bgImage, 'none', label + ': 그라데이션 없음');
  assert.equal(m.shadow, 'none', label + ': 그림자 없음'); assert.equal(m.radius, '0px', label + ': 둥근 모서리 없음');
  assert.deepEqual([m.bw[0], m.bw[1], m.bw[3]], ['0px', '0px', '0px'], label + ': 위·좌·우 테두리 없음');
  if (!bottomLine) assert.equal(m.bw[2], '0px', label + ': 아래 테두리도 없음');
}
const done = async page => { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); };

// ───────────────────────── 4지선다 (voice) ─────────────────────────
const VOICE_QUIZ = `(() => {
  quizData = [
    { question: '엽록체에서 일어나는 일은?', choices: ['호흡', '증산', '광합성', '발효'], answer_index: 2, explanation: '엽록체에서 광합성이 일어난다.', quote: '엽록체에서 일어난다' },
    { question: '두 번째 문제', choices: ['가', '나', '다', '라'], answer_index: 0, explanation: '설명', quote: '근거' } ];
  quizState = { i: 0, score: 0, answers: [], answered: false, saved: true };
  showView('quiz'); $('quiz-result').style.display = 'none'; $('quiz-run').style.display = ''; renderQuizQuestion();
})()`;
test('217-3 voice 4지선다: 박스 없는 번호+본문 행(아래 구분선만), 번호는 일반 글자, 줄바꿈되어도 번호 폭 고정·본문 들여쓰기, 터치 44px', { skip: SKIP }, async () => {
  const page = await openVoice();
  await step(page, VOICE_QUIZ);
  const n = await page.count('.mcq-option');
  assert.equal(n, 4);
  for (let i = 0; i < n; i++) {
    const o = await page.eval(MEASURE('.mcq-option', null, i)), num = await page.eval(MEASURE('.mcq-option .mcq-num', null, i));
    assertNoBox(o, `보기 ${i + 1}`, { bottomLine: true });
    assert.equal(o.bw[2], i === n - 1 ? '0px' : '1px', `보기 ${i + 1}: 아래 구분선은 마지막 보기만 없음`);
    assert.ok(o.h >= 43.5, `보기 ${i + 1}: 높이 44px 이상 (${o.h})`);
    assert.equal(num.bg, TRANSPARENT, '번호는 원형 채움 없음'); assert.equal(num.radius, '0px'); assert.equal(num.color, TEXT2, '번호 --text2'); assert.ok(num.ratio >= 4.5, '번호 대비 ' + num.ratio.toFixed(2));
    assert.equal(num.w, 20, '번호 폭 고정 20px');
  }
  // 아주 긴 보기: 두 줄 이상으로 줄바꿈돼도 본문 왼쪽 위치가 모든 보기에서 같다
  await step(page, "document.querySelectorAll('.mcq-text')[1].textContent = '아주 긴 보기 문장입니다. 이 문장은 한 줄에 들어가지 않아서 두 줄 이상으로 줄바꿈되어야 하고 그래도 한 보기로 읽혀야 합니다.'");
  const lefts = await page.eval("[...document.querySelectorAll('.mcq-text')].map(e => Math.round(e.getBoundingClientRect().left))");
  assert.equal(new Set(lefts).size, 1, '본문 시작 위치가 같음(들여쓰기): ' + lefts);
  const longH = (await page.eval(MEASURE('.mcq-option', null, 1))).h;
  assert.ok(longH > 70, '긴 보기는 여러 줄: ' + longH);
  await done(page);
});

test('217-3 voice 4지선다 채점: 오답을 고르면 고른 보기 ✕+빨강+굵게+밑줄, 정답 보기 ○+초록+굵게, 나머지는 기본. 정답을 고르면 ○+초록+굵게+밑줄. 모두 대비 4.5:1', { skip: SKIP }, async () => {
  const page = await openVoice();
  await step(page, VOICE_QUIZ);
  // 처음에는 기호 자리만 있고 기호는 없음
  assert.equal((await page.eval(MEASURE('.mcq-option', '::before', 0))).mark, '""');
  await page.click('.mcq-option', { index: 0 });   // 오답(정답은 3번)
  await page.waitFor("document.querySelector('.mcq-option.wrong')");
  await settle(page);
  const wrong = await page.eval(MEASURE('.mcq-option.wrong .mcq-text')), wrongMark = await page.eval(MEASURE('.mcq-option.wrong', '::before'));
  const hint = await page.eval(MEASURE('.mcq-option.correct-hint .mcq-text')), hintMark = await page.eval(MEASURE('.mcq-option.correct-hint', '::before'));
  const plain = await page.eval(MEASURE('.mcq-option', '::before', 1)), plainText = await page.eval(MEASURE('.mcq-option .mcq-text', null, 1));
  assert.equal(wrongMark.mark, '"✕"'); assert.equal(wrong.color, RED); assert.equal(wrong.weight, '700'); assert.equal(wrong.underline, true); assert.ok(wrong.ratio >= 4.5 && wrongMark.markRatio >= 4.5, '오답 대비');
  assert.equal(hintMark.mark, '"○"', '오답을 골라도 정답 보기에 ○가 보임'); assert.equal(hint.color, GREEN); assert.equal(hint.weight, '700'); assert.equal(hint.underline, false, '고르지 않은 정답은 밑줄 없음'); assert.ok(hint.ratio >= 4.5 && hintMark.markRatio >= 4.5, '정답 대비');
  assert.equal(plain.mark, '""'); assert.equal(plainText.underline, false);
  assert.equal(plainText.color, 'rgb(26, 26, 26)', '그 외 보기는 기본 글자색');
  // 상태가 색만이 아님: 기호 + 굵기 + (고른 것은) 밑줄
  for (const el of ['.mcq-option.wrong', '.mcq-option.correct-hint']) assert.ok(await page.eval(`getComputedStyle(document.querySelector('${el}'), '::before').content !== '""'`), el + ': 기호 있음');
  // 다음 문제에서 정답 선택
  await page.click('#quiz-next');
  await page.waitFor("document.getElementById('quiz-progress').textContent.startsWith('2 / ')");
  await settle(page);
  await page.click('.mcq-option', { index: 0 });
  await page.waitFor("document.querySelector('.mcq-option.correct')");
  const ok = await page.eval(MEASURE('.mcq-option.correct .mcq-text')), okMark = await page.eval(MEASURE('.mcq-option.correct', '::before'));
  assert.equal(okMark.mark, '"○"'); assert.equal(ok.color, GREEN); assert.equal(ok.weight, '700'); assert.equal(ok.underline, true); assert.ok(ok.ratio >= 4.5);
  assert.equal(await page.count('.mcq-option.wrong'), 0);
  await done(page);
});

test('217-3 voice 퀴즈 결과 점수: 박스·테두리·그림자 없이 큰 숫자 글자(아래 구분선만)', { skip: SKIP }, async () => {
  const page = await openVoice();
  await step(page, VOICE_QUIZ + "; $('quiz-run').style.display = 'none'; $('quiz-score-num').textContent = '3'; $('quiz-score-total').textContent = '5'; $('quiz-result-msg').textContent = '다시 풀어 보면 더 잘 기억돼요.'; $('quiz-result').style.display = '';");
  const m = await page.eval(MEASURE('.result-score-wrap'));
  assertNoBox(m, '.result-score-wrap', { bottomLine: true });
  assert.equal(m.bw[2], '1px', '아래 구분선');
  const big = await page.eval(MEASURE('#quiz-score-num'));
  assert.ok(big.size >= 40, '큰 숫자: ' + big.size); assert.ok(big.ratio >= 4.5, '점수 대비 ' + big.ratio.toFixed(2));
  await done(page);
});

// ───────────────────────── concept_study: 돌아보기 퀴즈 보기(.qz-opt), 문제 영역(.qz-q), 이해함 토글 ─────────────────────────
const CONCEPT_ITEMS = [
  { term: '가', set: { review_state: 'understood' } }, { term: '나', set: { review_state: 'confused' } },
  { term: '다', set: { review_state: 'new' } }, { term: '라', set: { review_state: 'confused' } }, { term: '마', set: { review_state: 'understood' } },
];
async function openConcept(items = CONCEPT_ITEMS, width = 390) {
  srv.reset(); srv.state.me = me();
  srv.seed({ topic: '퀴즈용', items });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.eval(NO_MOTION);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  await settle(page);
  return page;
}
const termFromDef = d => d.replace('의 정의입니다.', '');
// 작업221: 보기에 번호 span이 생겨서 글자 span(마지막 자식)만 읽는다
const currentQuestion = page => page.eval(`(() => { const q = document.querySelector('[data-t=quiz-question]'); return { kind: q.dataset.kind, prompt: document.querySelector('[data-t=quiz-prompt]').textContent, options: [...document.querySelectorAll('[data-t=quiz-opt]')].map(b => b.lastElementChild.textContent.trim()) }; })()`);
const rightIndex = q => q.options.indexOf(q.kind === 'A' ? termFromDef(q.prompt) : q.prompt + '의 정의입니다.');

test('217-3 concept 돌아보기 퀴즈 보기(.qz-opt)와 문제 영역(.qz-q): 박스 없는 행(구분선만), 오답 ✕+빨강+굵게+밑줄, 정답 ○+초록+굵게, 대비 4.5:1', { skip: SKIP }, async () => {
  const page = await openConcept();
  await page.click('#quiz-open');
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  await settle(page);
  const q0 = await page.eval(MEASURE('[data-t=quiz-question]'));
  assert.equal(q0.bw[0], '0px', '문제 영역 테두리 없음'); assert.equal(q0.radius, '0px', '문제 영역 둥근 모서리 없음'); assert.equal(q0.shadow, 'none');
  for (let i = 0; i < 4; i++) {
    const o = await page.eval(MEASURE('[data-t=quiz-opt]', null, i));
    assertNoBox(o, `보기 ${i + 1}`, { bottomLine: true }); assert.equal(o.bw[2], i === 3 ? '0px' : '1px', `보기 ${i + 1} 구분선`); assert.ok(o.h >= 43.5, '높이 ' + o.h);
    assert.equal((await page.eval(MEASURE('[data-t=quiz-opt] .qz-mark', null, i))).text, '', '답하기 전에는 기호 없음(자리만)');
  }
  const q = await currentQuestion(page);
  const right = rightIndex(q), mine = (right + 1) % 4;
  await page.click(`[data-t="quiz-opt"][data-i="${mine}"]`);
  await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')");
  await settle(page);
  const wrong = await page.eval(MEASURE('.qz-opt.wrong')), wrongMark = await page.eval(MEASURE('.qz-opt.wrong .qz-mark')), wrongText = await page.eval(MEASURE('.qz-opt.wrong > span:last-child'));
  const ok = await page.eval(MEASURE('.qz-opt.right')), okMark = await page.eval(MEASURE('.qz-opt.right .qz-mark')), okText = await page.eval(MEASURE('.qz-opt.right > span:last-child'));
  assertNoBox(wrong, '오답 보기', { bottomLine: true }); assertNoBox(ok, '정답 보기', { bottomLine: true });
  assert.equal(wrongMark.text, '✕'); assert.equal(wrong.color, RED); assert.equal(wrong.weight, '700'); assert.equal(wrongText.underline, true, '고른 보기는 밑줄'); assert.ok(wrong.ratio >= 4.5);
  assert.equal(okMark.text, '○', '오답을 골라도 정답 보기에 ○'); assert.equal(ok.color, GREEN); assert.equal(ok.weight, '700'); assert.equal(okText.underline, false, '고르지 않은 정답은 밑줄 없음'); assert.ok(ok.ratio >= 4.5);
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.qz-opt.wrong')).opacity"), '1', '답한 뒤(disabled)에도 흐려지지 않음');
  const fb = await page.eval(MEASURE('[data-t=quiz-feedback]')); assert.equal(fb.color, RED); assert.ok(fb.ratio >= 4.5, '오답 안내 대비');
  await page.click('[data-t="quiz-next"]');
  await settle(page);
  const q2 = await currentQuestion(page);
  await page.click(`[data-t="quiz-opt"][data-i="${rightIndex(q2)}"]`);
  await page.waitFor("!!document.querySelector('.qz-opt.right.mine')");
  const hit = await page.eval(MEASURE('.qz-opt.right > span:last-child')); assert.equal(hit.underline, true, '고른 정답은 밑줄');
  assert.equal((await page.eval(MEASURE('[data-t=quiz-feedback]'))).color, GREEN); assert.ok((await page.eval(MEASURE('[data-t=quiz-feedback]'))).ratio >= 4.5, '정답 안내 대비');
  assert.equal(await page.count('.qz-opt.wrong'), 0);
  await done(page);
});

test('217-3 concept 이해함 토글(data-t=understood): 박스 없음, 평소 현재 레이블(--text2), 켜짐은 "✓ "+코랄 계열 굵게, 44px, aria-pressed·동작 유지', { skip: SKIP }, async () => {
  const page = await openConcept([{ term: '가', set: { review_state: 'new' } }, { term: '나', set: { review_state: 'new' } }, { term: '다', set: { review_state: 'new' } }]);   // 첫 개념이 아직 "이해함"이 아닌 상태에서 시작
  const off = await page.eval(MEASURE('[data-t=understood]'));
  assertNoBox(off, '이해함(꺼짐)'); assert.ok(off.h >= 43.5 && off.w >= 43.5, `터치 영역 ${off.w}x${off.h}`);
  assert.equal(off.text, '이해함'); assert.equal(off.weight, '500'); assert.ok(off.ratio >= 4.5, '꺼짐 대비 ' + off.ratio.toFixed(2));
  assert.equal(await page.eval("document.querySelector('[data-t=understood]').getAttribute('aria-pressed')"), 'false');
  assert.equal(await pseudoContent(page, '[data-t=understood]'), 'none', '꺼짐에는 체크 기호 없음');
  await page.click('[data-t="understood"]');
  await page.waitFor("document.querySelector('[data-t=understood]').getAttribute('aria-pressed') === 'true'");
  await settle(page);
  const on = await page.eval(MEASURE('[data-t=understood]', '::before'));
  assertNoBox(on, '이해함(켜짐)'); assert.equal(on.markColor, 'rgb(184, 68, 46)', '--accent-text'); assert.equal(on.weight, '800'); assert.ok(on.ratio >= 4.5, '켜짐 대비 ' + on.ratio.toFixed(2));
  assert.equal(on.mark, '"✓ "', '앞에 ✓'); assert.equal(on.text, '이해함', '레이블은 그대로');
  assert.ok(on.h >= 43.5);
  assert.equal(srv.state.items[0].review_state, 'understood', '기존 동작: 서버에 이해함 저장');
  await page.click('[data-t="understood"]');
  await page.waitFor("document.querySelector('[data-t=understood]').getAttribute('aria-pressed') === 'false'");
  assert.notEqual(srv.state.items[0].review_state, 'understood', '다시 누르면 해제');
  await done(page);
});
const pseudoContent = (page, sel) => page.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}), '::before').content`);

// ───────────────────────── 읽기 3화면: 4지선다 · O/X · 짝 맞추기 · 정복 버튼 · 결과 ─────────────────────────
const MCQ_ITEMS = "[{ type: 'mcq', question: '문제 하나', options: ['가', '나', '다', '라'], answer: '다', explanation: '해설', roundLabel: '4지선다' }, { type: 'mcq', question: '문제 둘', options: ['A', 'B', 'C', 'D'], answer: 'A', explanation: '해설', roundLabel: '4지선다' }]";
const OX_ITEMS = "[{ type: 'ox', statement: '참인 문장', answer: true, explanation: '정답! 해설입니다.', roundLabel: 'OX' }, { type: 'ox', statement: '거짓인 문장', answer: false, explanation: '아닙니다. 해설입니다.', roundLabel: 'OX' }]";
const READING = [
  { file: 'literature_compass',
    mcq: `quizData = { rounds: [{ type: 'mcq', questions: [{ question: '문제 하나', options: ['가', '나', '다', '라'], answer: '다' }, { question: '문제 둘', options: ['A', 'B', 'C', 'D'], answer: 'A' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 2 }; showView('view-quiz'); renderQuizRound();`,
    ox: `quizData = { rounds: [{ type: 'ox', questions: [{ statement: '참인 문장', answer: true, explanation: '해설입니다.' }, { statement: '거짓인 문장', answer: false, explanation: '해설입니다.' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 2 }; showView('view-quiz'); renderQuizRound();`,
    fb: '#ox-feedback',
    result: "quizData = { rounds: [], currentRound: 0, currentQ: 0, score: 1, totalQ: 4, wrong: [{ q: '첫 문항', a: '정답 하나' }, { q: '둘째 문항', a: '정답 둘' }] }; showResult()" },
  { file: 'science_reading',
    mcq: `quizState = { questions: ${MCQ_ITEMS}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`,
    ox: `quizState = { questions: ${OX_ITEMS}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`,
    fb: '#ox-fb',
    result: "quizState = { questions: [{}, {}, {}, {}], currentIdx: 0, score: 1, wrong: [{ q: '첫 문항', a: '정답 하나' }, { q: '둘째 문항', a: '정답 둘' }], answered: false }; showResult()" },
  { file: 'digest_reading',
    mcq: `quizState = { questions: ${MCQ_ITEMS}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`,
    ox: `quizState = { questions: ${OX_ITEMS}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`,
    fb: '#ox-fb',
    result: "quizState = { questions: [{}, {}, {}, {}], currentIdx: 0, score: 1, wrong: [{ q: '첫 문항', a: '정답 하나' }, { q: '둘째 문항', a: '정답 둘' }], answered: false }; showResult()" },
];

test('217-3 읽기 3화면 4지선다: 박스 없는 번호+본문 행(구분선만), 채점 후 정답 ○+초록 굵게 / 내가 고른 오답 ✕+빨강 굵게 밑줄, 오답이어도 정답에 ○, 대비 4.5:1', { skip: SKIP }, async () => {
  for (const r of READING) {
    const page = await openReading(r.file);
    await step(page, r.mcq);
    assert.equal(await page.count('.mcq-option'), 4, r.file);
    for (let i = 0; i < 4; i++) {
      const o = await page.eval(MEASURE('.mcq-option', null, i)), num = await page.eval(MEASURE('.mcq-option .mcq-num', null, i));
      assertNoBox(o, `${r.file} 보기 ${i + 1}`, { bottomLine: true }); assert.equal(o.bw[2], i === 3 ? '0px' : '1px', r.file + ' 구분선'); assert.ok(o.h >= 43.5, r.file + ' 높이 ' + o.h);
      assert.equal(num.bg, TRANSPARENT, r.file + ' 번호 원형 채움 없음'); assert.equal(num.radius, '0px'); assert.equal(num.color, TEXT2); assert.ok(num.ratio >= 4.5); assert.equal(num.w, 20);
    }
    await step(page, "document.querySelectorAll('.mcq-text')[0].textContent = '아주 긴 보기 문장입니다. 이 문장은 한 줄에 들어가지 않아서 두 줄 이상으로 줄바꿈되어야 하고 그래도 한 보기로 읽혀야 합니다.'");
    assert.equal(new Set(await page.eval("[...document.querySelectorAll('.mcq-text')].map(e => Math.round(e.getBoundingClientRect().left))")).size, 1, r.file + ': 본문 들여쓰기 일정');
    await step(page, r.mcq);
    await page.click('.mcq-option', { index: 0 });          // 오답(정답은 "다")
    await page.waitFor("!!document.querySelector('.mcq-option.wrong')");
    await settle(page);
    const wt = await page.eval(MEASURE('.mcq-option.wrong .mcq-text')), wm = await page.eval(MEASURE('.mcq-option.wrong', '::before'));
    const ht = await page.eval(MEASURE('.mcq-option.correct-hint .mcq-text')), hm = await page.eval(MEASURE('.mcq-option.correct-hint', '::before'));
    assert.equal(wm.mark, '"✕"', r.file); assert.equal(wt.color, RED); assert.equal(wt.weight, '700'); assert.equal(wt.underline, true); assert.ok(wt.ratio >= 4.5 && wm.markRatio >= 4.5);
    assert.equal(hm.mark, '"○"', r.file + ': 오답이어도 정답 보기에 ○'); assert.equal(ht.color, GREEN); assert.equal(ht.weight, '700'); assert.equal(ht.underline, false); assert.ok(ht.ratio >= 4.5 && hm.markRatio >= 4.5);
    assert.equal((await page.eval(MEASURE('.mcq-option', '::before', 1))).mark, '""', r.file + ': 나머지는 기본');
    // 정답을 고르는 경우
    await step(page, r.mcq);
    await page.click('.mcq-option', { index: 2 });
    await page.waitFor("!!document.querySelector('.mcq-option.correct')");
    const ct = await page.eval(MEASURE('.mcq-option.correct .mcq-text')), cm = await page.eval(MEASURE('.mcq-option.correct', '::before'));
    assert.equal(cm.mark, '"○"'); assert.equal(ct.color, GREEN); assert.equal(ct.weight, '700'); assert.equal(ct.underline, true); assert.ok(ct.ratio >= 4.5);
    await done(page);
  }
});

test('217-3 읽기 3화면 O/X: 박스 없는 큰 글자 O X(32px 굵게, 좌우, 높이 80px 유지), 채점 후 "○ 정답"+초록 / "✕ 오답"+빨강, 고른 쪽 밑줄, 해설 줄은 색 바탕 없이 기호+글자색', { skip: SKIP }, async () => {
  for (const r of READING) {
    const page = await openReading(r.file);
    await step(page, r.ox);
    const o = await page.eval(MEASURE('#ox-o')), x = await page.eval(MEASURE('#ox-x'));
    for (const [m, label] of [[o, 'O'], [x, 'X']]) {
      assertNoBox(m, `${r.file} ${label}`); assert.equal(m.size, 32); assert.equal(m.weight, '700'); assert.ok(m.h >= 79.5 && m.w >= 43.5, `${label} 눌림 영역 ${m.w}x${m.h}`); assert.ok(m.ratio >= 4.5);
    }
    assert.ok(o.left < x.left, 'O는 왼쪽, X는 오른쪽');
    assert.equal(o.underline, false); assert.equal((await page.eval(MEASURE('#ox-o', '::after'))).mark, '""', '채점 전 라벨 없음');
    await page.click('#ox-x');                               // 첫 문제 정답은 O → 오답
    await page.waitFor("document.getElementById('ox-x').classList.contains('wrong')");
    await settle(page);
    const wx = await page.eval(MEASURE('#ox-x', '::after')), cx = await page.eval(MEASURE('#ox-o', '::after'));
    const xm = await page.eval(MEASURE('#ox-x')), om = await page.eval(MEASURE('#ox-o'));
    assert.equal(wx.mark, '"✕ 오답"', r.file); assert.equal(xm.color, RED); assert.equal(wx.markColor, RED); assert.equal(xm.underline, true, '고른 쪽 밑줄'); assert.ok(wx.markRatio >= 4.5);
    assert.equal(cx.mark, '"○ 정답"'); assert.equal(om.color, GREEN); assert.equal(cx.markColor, GREEN); assert.equal(om.underline, false, '고르지 않은 정답은 밑줄 없음'); assert.ok(cx.markRatio >= 4.5);
    assert.equal(await page.eval("document.getElementById('ox-x').disabled && document.getElementById('ox-o').disabled"), true);
    const fb = await page.eval(MEASURE(r.fb, '::before')); assert.equal(fb.bg, TRANSPARENT); assert.equal(fb.radius, '0px'); assert.equal(fb.color, RED); assert.equal(fb.mark, '"✕ "'); assert.ok(fb.ratio >= 4.5);
    // 정답을 고르는 경우(두 번째 문제의 정답은 X)
    await page.click('.quiz-next-btn.visible, #quiz-next');
    await page.waitFor("!document.getElementById('ox-x').disabled");
    await settle(page);
    await page.click('#ox-x');
    await page.waitFor("document.getElementById('ox-x').classList.contains('correct')");
    const ok = await page.eval(MEASURE('#ox-x')), okm = await page.eval(MEASURE('#ox-x', '::after')), fb2 = await page.eval(MEASURE(r.fb, '::before'));
    assert.equal(ok.color, GREEN); assert.equal(ok.underline, true); assert.equal(okm.mark, '"○ 정답"');
    assert.equal(fb2.color, GREEN); assert.equal(fb2.mark, '"○ "'); assert.ok(fb2.ratio >= 4.5);
    assert.equal(await page.count('.ox-btn.wrong'), 0);
    await done(page);
  }
});

test('217-3 literature 짝 맞추기(.match-item): 박스 없는 구분선 행, 고른 항목 --primary-dark+굵게+밑줄, 맞음 ○+초록, 틀림 ✕+빨강, 동작 유지', { skip: SKIP }, async () => {
  const page = await openReading('literature_compass');
  await step(page, "quizData = { rounds: [{ type: 'matching', pairs: [{ id: 'a', work: '작품일', author: '작가일' }, { id: 'b', work: '작품이', author: '작가이' }, { id: 'c', work: '작품삼', author: '작가삼' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 3 }; showView('view-quiz'); renderQuizRound();");
  assert.equal(await page.count('.match-item'), 6);
  for (let i = 0; i < 6; i++) {
    const m = await page.eval(MEASURE('.match-item', null, i));
    assertNoBox(m, `짝 맞추기 항목 ${i + 1}`, { bottomLine: true }); assert.ok(m.h >= 43.5, '높이 ' + m.h); assert.ok(m.ratio >= 4.5); assert.equal(m.cursor, 'pointer');
  }
  const lines = await page.eval("[...document.querySelectorAll('.match-col')].map(c => [...c.querySelectorAll('.match-item')].map(e => getComputedStyle(e).borderBottomWidth))");
  assert.deepEqual(lines, [['1px', '1px', '0px'], ['1px', '1px', '0px']], '열마다 마지막 항목만 아래 선 없음');
  // 작품 하나를 고름 → 선택됨
  await page.click('#mw-a');
  await page.waitFor("document.getElementById('mw-a').classList.contains('selected')");
  const sel = await page.eval(MEASURE('#mw-a'));
  assert.equal(sel.color, 'rgb(184, 68, 46)'); assert.equal(sel.weight, '700'); assert.equal(sel.underline, true); assert.ok(sel.ratio >= 4.5, '선택 대비 ' + sel.ratio.toFixed(2));
  // 다른 짝의 작가를 고름 → 틀림(✕+빨강)
  await page.click('#ma-b');
  await page.waitFor("document.getElementById('ma-b').classList.contains('wrong')");
  const wr = await page.eval(MEASURE('#ma-b')), wrm = await page.eval(MEASURE('#ma-b', '::before')), wrw = await page.eval(MEASURE('#mw-a', '::before'));
  assert.equal(wrm.mark, '"✕ "'); assert.equal(wr.color, RED); assert.equal(wr.weight, '700'); assert.ok(wr.ratio >= 4.5 && wrm.markRatio >= 4.5); assert.equal(wrw.mark, '"✕ "', '짝이 된 작품 쪽도 틀림 표시');
  await page.waitFor("!document.getElementById('ma-b').classList.contains('wrong')", 3000);   // 기존 동작: 0.8초 뒤 선택 해제
  // 이번에는 맞는 짝: 작품일 + 작가일 → 맞음(○+초록), 점수 +1
  await page.click('#mw-a');
  await page.click('#ma-a');
  await page.waitFor("document.getElementById('ma-a').classList.contains('correct')");
  const ok = await page.eval(MEASURE('#ma-a')), okm = await page.eval(MEASURE('#ma-a', '::before')), okw = await page.eval(MEASURE('#mw-a', '::before'));
  assert.equal(okm.mark, '"○ "'); assert.equal(okw.mark, '"○ "'); assert.equal(ok.color, GREEN); assert.equal(ok.weight, '700'); assert.ok(ok.ratio >= 4.5 && okm.markRatio >= 4.5);
  assert.equal(await page.eval('quizData.score'), 1, '기존 동작: 맞으면 점수 +1');
  assert.equal(await page.eval("document.getElementById('ma-a').classList.contains('correct') && document.getElementById('mw-a').classList.contains('correct')"), true);
  await done(page);
});

test('217-3 science·digest 정복 버튼(.conquest-btn): 박스 없음, 정복 전 "정복하기"(--text2) / 후 "✓ 정복함"(코랄 계열 굵게), 44px, 대비 4.5:1, aria-pressed·동작 유지', { skip: SKIP }, async () => {
  for (const [file, go] of [['science_reading', 'showScience(DB.concepts[0].id)'], ['digest_reading', 'showDigest(DB.works[0].id)']]) {
    const page = await openReading(file);
    await step(page, go);
    const off = await page.eval(MEASURE('#conquest-btn'));
    assertNoBox(off, file + ' 정복 전'); assert.equal(off.text, '정복하기'); assert.ok(off.h >= 43.5 && off.w >= 43.5, `${off.w}x${off.h}`); assert.equal(off.color, TEXT2); assert.ok(off.ratio >= 4.5, '정복 전 대비 ' + off.ratio.toFixed(2));
    assert.equal(off.weight, '500');
    assert.equal(await page.eval("document.getElementById('conquest-btn').getAttribute('aria-pressed')"), 'false');
    await page.click('#conquest-btn');
    await page.waitFor("document.getElementById('conquest-btn').classList.contains('conquered')");
    const on = await page.eval(MEASURE('#conquest-btn'));
    assertNoBox(on, file + ' 정복 후'); assert.equal(on.text, '✓ 정복함', '기호 ✓ + 글자'); assert.equal(on.color, 'rgb(184, 68, 46)'); assert.equal(on.weight, '700'); assert.ok(on.ratio >= 4.5, '정복 후 대비 ' + on.ratio.toFixed(2)); assert.ok(on.h >= 43.5);
    assert.equal(await page.eval("document.getElementById('conquest-btn').getAttribute('aria-pressed')"), 'true');
    assert.equal(await page.eval("Object.keys(localStorage).filter(k => /conquest_/.test(k) && localStorage.getItem(k) === 'true').length"), 1, '기존 동작: 정복 상태가 저장됨');
    await page.click('#conquest-btn');
    await page.waitFor("!document.getElementById('conquest-btn').classList.contains('conquered')");
    assert.equal(await page.eval("document.getElementById('conquest-btn').textContent"), '정복하기');
    assert.equal(await page.eval("document.getElementById('conquest-btn').getAttribute('aria-pressed')"), 'false');
    assert.equal(await page.eval("Object.keys(localStorage).filter(k => /conquest_/.test(k) && localStorage.getItem(k) === 'true').length"), 0, '다시 누르면 해제');
    // 정복 바(.conquest-bar)는 구조라서 유지: 위 선 + 흰 바탕
    const bar = await page.eval(MEASURE('.conquest-bar')); assert.equal(bar.bw[0], '1px'); assert.notEqual(bar.bg, TRANSPARENT);
    await done(page);
  }
});

test('217-3 퀴즈 결과 3화면: 점수는 박스 없는 큰 숫자(대비 4.5:1), 틀린 문항은 구분선 행, 정답 글자 초록', { skip: SKIP }, async () => {
  for (const r of READING) {
    const page = await openReading(r.file);
    await step(page, r.result);
    const w = await page.eval(MEASURE('.result-score-wrap'));
    assertNoBox(w, r.file + ' 점수 영역', { bottomLine: true }); assert.equal(w.bw[2], '1px');
    const sc = await page.eval(MEASURE('.result-score')); assert.ok(sc.size >= 40); assert.ok(sc.ratio >= 4.5, r.file + ' 점수 대비 ' + sc.ratio.toFixed(2)); assert.equal(sc.color, 'rgb(184, 68, 46)');
    assert.equal(await page.count('.result-wrong-item'), 2);
    for (let i = 0; i < 2; i++) {
      const m = await page.eval(MEASURE('.result-wrong-item', null, i));
      assertNoBox(m, `${r.file} 틀린 문항 ${i + 1}`, { bottomLine: true }); assert.equal(m.bw[2], i === 1 ? '0px' : '1px', '마지막 행만 아래 선 없음');
    }
    const a = await page.eval(MEASURE('.result-wrong-a')); assert.equal(a.color, GREEN); assert.ok(a.ratio >= 4.5);
    await done(page);
  }
});
