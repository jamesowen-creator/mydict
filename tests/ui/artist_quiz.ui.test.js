// 작업 AN-2: 작가 노트 퀴즈 탭. 헤드리스 Chrome + 모의 서버(비용 API 호출 없음).
// 확인: 정복 0명 안내, 정복 후 출제 범위·문항 수(최대 8), 4지선다·OX 채점 표시(글자 ○ 정답 / × 오답), 결과·다시 풀기,
//       풀이 중 탭 이동 확인, 저장하지 않음(새로고침하면 사라짐), history, 문항 데이터가 없을 때 "준비 중".
// 상태 주입 방식은 기존 UI 테스트와 같다(정복은 localStorage의 artist_notes_conquest_<id>를 직접 설정).
// 실행: node --test tests/ui/artist_quiz.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { me, NO_MOTION, settle, GREEN, RED } = require('./helpers/text_ui');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none' && !!document.querySelector('.metis-app-header-logo')";
const IDS = ['artist_001', 'artist_002', 'artist_003', 'artist_004', 'artist_005', 'artist_006'];

async function open(width = 390) {
  srv.reset(); srv.state.me = me();
  const page = await browser.newPage({ width, height: 844 });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.goto(srv.url + '/artist_notes.html');
  await page.waitFor(DB_READY, 12000);
  await page.eval(NO_MOTION);
  await page.eval("Object.keys(localStorage).filter(k => /^artist_notes_/.test(k)).forEach(k => localStorage.removeItem(k)); updateTabQuizState();");
  await settle(page);
  return page;
}
const conquer = (page, ids) => page.eval(`${JSON.stringify(ids)}.forEach(id => localStorage.setItem('artist_notes_conquest_' + id, 'true')); updateTabQuizState();`);
const activeView = page => page.eval("document.querySelector('.view.active').id");
async function tap(page, tab) { await page.click(`#bottom-nav [data-tab="${tab}"]`); await sleep(300); await settle(page); }
const counter = page => page.text('.quiz-question-counter');
const current = page => page.eval('quizState.questions[quizState.currentIdx]');
const clean = page => page.errors.filter(e => !/Failed to load resource/.test(e));

// 한 문항을 푼다. pick = 'right' | 'wrong' | 'first'
async function answerOne(page, pick = 'first') {
  const q = await current(page);
  if (q.type === 'mcq') {
    assert.equal(await page.count('.mcq-option'), 4, '보기 4개');
    const texts = await page.eval("[...document.querySelectorAll('.mcq-option')].map(b => b.dataset.opt)");
    let idx = 0;
    if (pick === 'right') idx = texts.indexOf(q.answer);
    if (pick === 'wrong') idx = texts.findIndex(t => t !== q.answer);
    await page.click('.mcq-option', { index: idx });
    await page.waitFor("!!document.querySelector('.mcq-option.correct, .mcq-option.wrong')");
  } else {
    const ans = pick === 'right' ? q.answer : pick === 'wrong' ? !q.answer : true;
    await page.click(ans ? '#ox-o' : '#ox-x');
    await page.waitFor("document.getElementById('ox-fb').classList.contains('show')");
  }
  await page.click('#quiz-next');
  await sleep(150); await settle(page);
}
async function runAll(page, pick) {
  const total = await page.eval('quizState.questions.length');
  for (let i = 0; i < total; i++) await answerOne(page, pick);
  await page.waitFor("document.querySelector('.view.active').id === 'view-result'");
  return total;
}

test('퀴즈 탭: 정복 0명이어도 눌리고(aria-disabled, 흐림 아님) 안내만 띄우며 시작하지 않는다, 정복하면 aria-disabled가 풀린다', { skip: SKIP }, async () => {
  const page = await open();
  assert.equal(await page.eval("document.getElementById('nav-quiz').getAttribute('aria-disabled')"), 'true');
  assert.equal(await page.eval("getComputedStyle(document.getElementById('nav-quiz')).opacity"), '1');
  await page.click('#bottom-nav [data-tab="quiz"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
  assert.match(await page.text('[data-t="dialog-msg"]'), /먼저 작가를 읽어보세요! 작가 상세에서 정복하기를 누르면 퀴즈에 나와요\./);
  await page.click('[data-t="dialog-ok"]'); await sleep(250);
  assert.equal(await activeView(page), 'view-list', '화면 그대로');
  await conquer(page, ['artist_001']);
  assert.equal(await page.eval("document.getElementById('nav-quiz').getAttribute('aria-disabled')"), 'false');
  assert.deepEqual(clean(page), []);
  await page.close();
});

test('출제 범위와 문항 수: 정복 1명 = 그 작가 문항만 6개(4지선다 2 + OX 4), 정복 6명 = 8개(4 + 4), 4지선다 보기 순서는 섞여도 정답 1개', { skip: SKIP }, async () => {
  const page = await open();
  await conquer(page, ['artist_001']);
  await tap(page, 'quiz');
  assert.equal(await activeView(page), 'view-quiz');
  assert.match(await counter(page), /^1 \/ 6$/);
  const stat1 = await page.eval(`(() => {
    const qs = quizState.questions;
    const own = qs.every(q => DB.quiz.some(d => (d.question || d.statement) === (q.question || q.statement) && d.artist_id === 'artist_001'));
    return { mcq: qs.filter(q => q.type === 'mcq').length, ox: qs.filter(q => q.type === 'ox').length, own, noBasis: qs.every(q => !('basis' in q) && !('verified_on' in q)) };
  })()`);
  assert.deepEqual(stat1, { mcq: 2, ox: 4, own: true, noBasis: true });
  await page.close();

  const p2 = await open();
  await conquer(p2, IDS);
  await tap(p2, 'quiz');
  assert.match(await counter(p2), /^1 \/ 8$/);
  const stat6 = await p2.eval(`(() => { const qs = quizState.questions; return { mcq: qs.filter(q => q.type === 'mcq').length, ox: qs.filter(q => q.type === 'ox').length,
    optsOk: qs.filter(q => q.type === 'mcq').every(q => q.options.length === 4 && new Set(q.options).size === 4 && q.options.filter(o => o === q.answer).length === 1) }; })()`);
  assert.deepEqual(stat6, { mcq: 4, ox: 4, optsOk: true });
  assert.ok(await p2.eval("document.body.innerText.indexOf('basis') < 0"), '근거 참조는 화면에 나오지 않음');
  assert.deepEqual(clean(p2), []);
  await p2.close();
});

test('풀이·채점: 4지선다는 정오를 글자로 표시(오답 × 빨강 + 정답 ○ 초록), OX는 정오 한 줄과 해설, 결과 화면 점수·틀린 문항·다시 풀기', { skip: SKIP }, async () => {
  const page = await open();
  await conquer(page, IDS);
  await tap(page, 'quiz');
  let seenMcqWrong = false, seenOxWrong = false;
  const total = await page.eval('quizState.questions.length');
  for (let i = 0; i < total; i++) {
    const q = await current(page);
    if (q.type === 'mcq') {
      assert.equal(await page.text('.quiz-round-label'), '작품 맞추기 퀴즈');
      const texts = await page.eval("[...document.querySelectorAll('.mcq-option')].map(b => b.dataset.opt)");
      await page.click('.mcq-option', { index: texts.findIndex(t => t !== q.answer) });
      await page.waitFor("!!document.querySelector('.mcq-option.wrong')");
      const m = await page.eval(`(() => { const w = document.querySelector('.mcq-option.wrong'), c = document.querySelector('.mcq-option.correct-hint');
        return { wrongMark: getComputedStyle(w, '::before').content, wrongColor: getComputedStyle(w.querySelector('.mcq-text')).color,
                 rightMark: getComputedStyle(c, '::before').content, rightColor: getComputedStyle(c.querySelector('.mcq-text')).color, rightText: c.dataset.opt }; })()`);
      assert.equal(m.wrongMark, '"×"'); assert.equal(m.wrongColor, RED);
      assert.equal(m.rightMark, '"○"'); assert.equal(m.rightColor, GREEN); assert.equal(m.rightText, q.answer);
      seenMcqWrong = true;
    } else {
      assert.equal(await page.text('.quiz-round-label'), 'OX 퀴즈');
      await page.click(q.answer ? '#ox-x' : '#ox-o');   // 일부러 오답
      await page.waitFor("document.getElementById('ox-fb').classList.contains('wrong-fb')");
      const o = await page.eval(`(() => { const fb = document.getElementById('ox-fb'); const picked = document.querySelector('.ox-btn.wrong'), right = document.querySelector('.ox-btn.correct');
        return { line: fb.querySelector('.fb-line').textContent, text: fb.textContent, wrongLabel: getComputedStyle(picked, '::after').content, rightLabel: getComputedStyle(right, '::after').content,
                 disabled: document.getElementById('ox-o').disabled && document.getElementById('ox-x').disabled }; })()`);
      assert.equal(o.line, '오답.'); assert.ok(o.text.length > 6, '해설 문장'); assert.equal(o.wrongLabel, '"× 오답"'); assert.equal(o.rightLabel, '"○ 정답"'); assert.ok(o.disabled);
      seenOxWrong = true;
    }
    assert.ok(await page.visible('#quiz-next'));
    await page.click('#quiz-next'); await sleep(150); await settle(page);
  }
  assert.ok(seenMcqWrong && seenOxWrong, '4지선다·OX가 모두 나옴');
  assert.equal(await activeView(page), 'view-result');
  assert.equal(await page.eval("document.querySelector('#bottom-nav .bottom-nav-tab.active').dataset.tab"), 'quiz', '결과 화면에서도 퀴즈 탭이 활성');
  assert.equal(await page.eval("document.querySelector('.result-score').textContent.replace(/\\s+/g, '')"), '0/8');
  assert.equal(await page.count('.result-wrong-item'), 8, '전부 틀리면 틀린 문항 8개');
  assert.match(await page.text('.result-msg'), /다시 도전해봐요/);
  await page.click('#result-again'); await sleep(200); await settle(page);
  assert.equal(await activeView(page), 'view-quiz');
  assert.match(await counter(page), /^1 \/ 8$/);
  assert.deepEqual(clean(page), []);
  await page.close();
});

test('만점이면 "완벽해요!"이고 틀린 문항 목록이 없다, 목록으로는 목록 화면', { skip: SKIP }, async () => {
  const page = await open();
  await conquer(page, ['artist_002', 'artist_005']);
  await tap(page, 'quiz');
  await runAll(page, 'right');
  assert.equal(await page.eval("document.querySelector('.result-score').textContent.replace(/\\s+/g, '')").then(s => s.split('/')[0] === s.split('/')[1]), true);
  assert.match(await page.text('.result-msg'), /완벽해요!/);
  assert.equal(await page.count('.result-wrong-item'), 0);
  await page.click('#result-list'); await sleep(300); await settle(page);
  assert.equal(await activeView(page), 'view-list');
  await page.close();
});

test('풀이 중 탭 이동: 한 문제라도 답했으면 "퀴즈를 그만할까요?" 확인(취소=유지 / 확인=이동), 답하기 전에는 확인 없이 이동', { skip: SKIP }, async () => {
  const page = await open();
  await conquer(page, IDS);
  await tap(page, 'quiz');
  await tap(page, 'conq');   // 아직 답하지 않음: 확인 없이 이동
  assert.equal(await activeView(page), 'view-conq');
  await tap(page, 'quiz');
  const q = await current(page);
  if (q.type === 'mcq') await page.click('.mcq-option', { index: 0 }); else await page.click('#ox-o');
  await sleep(300);
  await page.click('#bottom-nav [data-tab="conq"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
  assert.match(await page.text('[data-t="dialog-msg"]'), /퀴즈를 그만할까요\? 지금까지의 답은 저장되지 않습니다/);
  await page.click('[data-t="dialog-cancel"]'); await sleep(250);
  assert.equal(await activeView(page), 'view-quiz', '취소하면 유지');
  await page.click('#bottom-nav [data-tab="home"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-ok]')");
  await page.click('[data-t="dialog-ok"]'); await sleep(300);
  assert.equal(await activeView(page), 'view-list', '확인하면 이동');
  assert.deepEqual(clean(page), []);
  await page.close();
});

test('저장하지 않음·history: 풀이 후 localStorage에 퀴즈 키가 없고 새로고침하면 목록, 정복 탭에서 시작한 퀴즈의 결과에서 뒤로 가기는 정복 탭', { skip: SKIP }, async () => {
  const page = await open();
  await conquer(page, IDS);
  await tap(page, 'conq');
  await tap(page, 'quiz');
  const keysBefore = await page.eval("Object.keys(localStorage).filter(k => /^artist_notes_/.test(k)).sort()");
  await runAll(page, 'first');
  const keysAfter = await page.eval("Object.keys(localStorage).filter(k => /^artist_notes_/.test(k)).sort()");
  assert.deepEqual(keysAfter, keysBefore, '퀴즈 점수·틀린 문항을 저장하지 않음');
  assert.ok(keysAfter.every(k => /^artist_notes_(conquest_|field_filter)/.test(k)));
  assert.equal(await page.eval("history.state && history.state.view"), 'result');
  await page.eval('history.back()'); await sleep(400); await settle(page);
  assert.equal(await activeView(page), 'view-conq', '결과 칸이 풀이 칸을 교체해 한 칸이라 뒤로 가기 = 직전(정복 탭)');
  await page.eval('location.reload()');
  await page.waitFor(DB_READY, 12000); await sleep(300);
  assert.equal(await page.eval('quizState.questions.length'), 0, '새로고침하면 퀴즈 상태 없음');
  assert.notEqual(await activeView(page), 'view-quiz');
  await page.close();
});

test('문항 데이터(quiz)가 비어 있으면 퀴즈 탭은 "준비 중" 화면', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval('DB.quiz = []');
  await tap(page, 'quiz');
  assert.equal(await activeView(page), 'view-quiz');
  assert.match(await page.text('#quiz-body'), /퀴즈는 준비 중이에요/);
  await page.close();
});

for (const w of [390, 820]) {
  test(`레이아웃 ${w}px: 퀴즈 풀이·결과에 가로 스크롤이 없고, 퀴즈 카드·보기·결과 점수에 박스가 없다`, { skip: SKIP }, async () => {
    const page = await open(w);
    await conquer(page, IDS);
    await tap(page, 'quiz');
    assert.equal(await page.hasHorizontalScroll(), false, '풀이');
    const box = await page.eval(`(() => { const c = getComputedStyle(document.querySelector('.quiz-card')); return { b: c.borderTopWidth, r: c.borderTopLeftRadius, s: c.boxShadow }; })()`);
    assert.deepEqual(box, { b: '0px', r: '0px', s: 'none' });
    const q = await current(page);
    if (q.type === 'mcq') {
      const h = await page.eval("Math.min(...[...document.querySelectorAll('.mcq-option')].map(b => b.getBoundingClientRect().height))");
      assert.ok(h >= 43.5, '보기 높이 ' + h);
    }
    await runAll(page, 'first');
    assert.equal(await page.hasHorizontalScroll(), false, '결과');
    assert.deepEqual(clean(page), []);
    await page.close();
  });
}
