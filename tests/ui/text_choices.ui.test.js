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
const currentQuestion = page => page.eval(`(() => { const q = document.querySelector('[data-t=quiz-question]'); return { kind: q.dataset.kind, prompt: document.querySelector('[data-t=quiz-prompt]').textContent, options: [...document.querySelectorAll('[data-t=quiz-opt]')].map(b => b.textContent.replace(/^[○✕]/, '')) }; })()`);
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
