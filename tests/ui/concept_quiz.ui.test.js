// 작업205: 개념학습 "돌아보기 퀴즈" 화면 흐름(헤드리스 Chrome, 모의 API). AI 호출 없음.
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const FIVE = [
  { term: '가', set: { review_state: 'understood' } },
  { term: '나', set: { review_state: 'confused' } },
  { term: '다', set: { review_state: 'new' } },
  { term: '라', set: { review_state: 'confused' } },
  { term: '마', set: { review_state: 'understood' } },
];
async function openStudy(items, width = 390) {
  srv.reset();
  srv.seed({ topic: '퀴즈용', items });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  return page;
}
// 모의 서버의 규칙: 설명은 "X의 정의입니다."
const termFromDef = d => d.replace('의 정의입니다.', '');
async function currentQuestion(page) {
  return page.eval(`(() => { const q = document.querySelector('[data-t=quiz-question]'); return { kind: q.dataset.kind, prompt: document.querySelector('[data-t=quiz-prompt]').textContent, options: [...document.querySelectorAll('[data-t=quiz-opt]')].map(b => b.lastElementChild.textContent.trim()) }; })()`);
}
const rightIndex = q => q.options.indexOf(q.kind === 'A' ? termFromDef(q.prompt) : q.prompt + '의 정의입니다.');
const aiCalls = () => srv.state.log.filter(l => /\/explore$|\/respond$|\/suggestions\/refresh$/.test(l.url));

test('퀴즈 흐름: 헷갈림 먼저 출제, 즉시 정오·설명 표시, 틀리면 헷갈림 표시 제안(자동 변경 없음), 결과·개념 보기', { skip: SKIP }, async () => {
  const page = await openStudy(FIVE);
  await page.click('#quiz-open');
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  assert.equal(await page.text('[data-t="quiz-progress"]'), '문제 1 / 5');
  assert.equal(await page.visible('#detail'), false, '퀴즈 중에는 상세가 가려짐');
  assert.equal(await page.visible('.bottom-bar'), false, '퀴즈 중에는 하단 입력창이 가려짐');
  assert.equal(await page.text('[data-t="quiz-ai"]'), 'AI 설명 · 확인 필요');
  let q = await currentQuestion(page);
  assert.equal(q.kind, 'A');
  assert.equal(termFromDef(q.prompt), '나', '헷갈림 개념부터');
  assert.equal(q.options.length, 4);
  // 일부러 틀린다
  const wrongIdx = (rightIndex(q) + 1) % 4;
  await page.click(`[data-t="quiz-opt"][data-i="${wrongIdx}"]`);
  await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')");
  assert.match(await page.text('[data-t="quiz-feedback"]'), /틀렸어요/);
  assert.match(await page.text('[data-t="quiz-explain"]'), /나의 정의입니다/);
  assert.equal(await page.eval(`document.querySelector('[data-t=quiz-opt][data-i="${rightIndex(q)}"]').classList.contains('right')`), true);
  assert.equal(await page.eval(`document.querySelector('[data-t=quiz-opt][data-i="${wrongIdx}"]').classList.contains('wrong')`), true);
  assert.equal(await page.eval("[...document.querySelectorAll('[data-t=quiz-opt]')].every(b => b.disabled)"), true, '답한 뒤에는 보기 잠금');
  // 틀렸다고 이해 상태가 저절로 바뀌지 않는다. 버튼을 눌러야 헷갈림으로 표시
  assert.equal(srv.state.items.find(i => i.term === '나').review_state, 'confused');
  assert.equal(await page.exists('[data-t="quiz-confuse"]'), false, '이미 헷갈림이면 표시 제안 대신 안내');
  assert.match(await page.text('[data-t="quiz-marked"]'), /헷갈림으로 표시됨/);
  await page.click('[data-t="quiz-next"]');
  // 2번째: 유형 B, 정답
  q = await currentQuestion(page);
  assert.equal(q.kind, 'B');
  assert.equal(q.prompt, '라');
  await page.click(`[data-t="quiz-opt"][data-i="${rightIndex(q)}"]`);
  await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')");
  assert.match(await page.text('[data-t="quiz-feedback"]'), /정답입니다/);
  assert.equal(await page.exists('[data-t="quiz-confuse"]'), false, '맞히면 표시 제안 없음');
  await page.click('[data-t="quiz-next"]');
  // 3번째(새것 "다")를 틀리고 헷갈림으로 표시
  q = await currentQuestion(page);
  assert.equal(termFromDef(q.kind === 'A' ? q.prompt : q.prompt + '의 정의입니다.'), '다');
  await page.click(`[data-t="quiz-opt"][data-i="${(rightIndex(q) + 2) % 4}"]`);
  await page.waitFor("!!document.querySelector('[data-t=quiz-confuse]')");
  await page.click('[data-t="quiz-confuse"]');
  await page.waitFor("!!document.querySelector('[data-t=quiz-marked]')");
  const patch = srv.state.log.filter(l => /\/api\/concepts\/items\/\d+$/.test(l.url) && l.method === 'PATCH').pop();
  assert.equal(patch.body.review_state, 'confused');
  assert.equal(srv.state.items.find(i => i.term === '다').review_state, 'confused');
  await page.click('[data-t="quiz-next"]');
  // 4·5번째는 정답으로 마무리
  for (let n = 0; n < 2; n++) {
    q = await currentQuestion(page);
    await page.click(`[data-t="quiz-opt"][data-i="${rightIndex(q)}"]`);
    await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')");
    await page.click('[data-t="quiz-next"]');
  }
  await page.waitFor("!!document.querySelector('[data-t=quiz-score]')");
  assert.equal(await page.text('[data-t="quiz-score"]'), '5문제 중 3개 맞혔어요');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('[data-t=quiz-wrong] .lrow-term')].map(e => e.textContent)"), ['나', '다']);
  // 정오 결과로 바뀐 이해 상태는 사용자가 누른 "다"뿐
  assert.deepEqual(srv.state.items.map(i => i.term + ':' + i.review_state), ['가:understood', '나:confused', '다:confused', '라:confused', '마:understood']);
  assert.equal(srv.state.quizAnswers.length, 5);
  assert.equal(aiCalls().length, 0, '퀴즈 중 AI 호출 없음');
  // 틀린 개념 보기 → 상세로
  await page.click('[data-t="quiz-wrong"][data-id="' + srv.state.items.find(i => i.term === '나').id + '"] [data-t="quiz-view-item"]');
  await page.waitFor("document.querySelector('[data-t=term]') && document.querySelector('[data-t=term]').textContent === '나'");
  assert.equal(await page.visible('#quiz-box'), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('개념이 4개 미만(설명 있는 활성 개념 기준): 안내만 보이고 돌아가기', { skip: SKIP }, async () => {
  const page = await openStudy([{ term: '가' }, { term: '나' }, { term: '다' }, { term: '라', filled: false }, { term: '마', set: { status: 'held' } }]);
  await page.click('#quiz-open');
  await page.waitFor("!!document.querySelector('[data-t=quiz-empty]')");
  assert.match(await page.text('[data-t="quiz-empty"]'), /4개 이상/);
  assert.equal(await page.exists('[data-t="quiz-question"]'), false);
  await page.click('[data-t="quiz-exit"]');
  assert.equal(await page.visible('#detail'), true);
  assert.equal(await page.visible('#quiz-box'), false);
  await page.close();
});

test('그만하기·뒤로가기: 퀴즈만 닫히고 학습 화면은 그대로(해시 유지)', { skip: SKIP }, async () => {
  const page = await openStudy(FIVE);
  await page.click('#quiz-open');
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  await page.click('[data-t="quiz-exit"]');
  assert.equal(await page.visible('#detail'), true);
  await page.click('#quiz-open');
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  await page.click('#back-btn');
  assert.equal(await page.visible('#quiz-box'), false);
  assert.match(await page.eval('location.hash'), /^#s=\d+$/, '학습 화면에 남음');
  assert.equal(aiCalls().length, 0);
  await page.close();
});

for (const w of [390, 768, 1024]) {
  test(`퀴즈 ${w}px: 가로 스크롤 없음, 보기·버튼 44px 이상`, { skip: SKIP }, async () => {
    const long = '아주 긴 설명 '.repeat(40);
    const page = await openStudy(FIVE.map((f, i) => (i === 0 ? { ...f, set: { ...f.set, definition: long } } : f)), w);
    await page.click('#quiz-open');
    await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
    let q = await currentQuestion(page);
    await page.click(`[data-t="quiz-opt"][data-i="${(rightIndex(q) + 1) % 4}"]`);
    await page.waitFor("!!document.querySelector('[data-t=quiz-feedback]')");
    assert.equal(await page.hasHorizontalScroll(), false);
    const small = await page.eval(`[...document.querySelectorAll('#quiz-box button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || (r.width < 43.5 && !b.classList.contains('text'))); }).map(b => b.dataset.t)`);
    assert.deepEqual(small, [], '44px 미만 요소');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
