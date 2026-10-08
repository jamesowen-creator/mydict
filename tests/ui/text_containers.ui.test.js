// 작업217-4: 카드·컨테이너·메시지의 텍스트화(테두리·둥근 모서리·그림자·그라데이션·색 바탕 없음, 흰 바탕과 구분선만).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { TRANSPARENT, GREEN, RED, TEXT2, CORAL_DARK, NO_MOTION, DB_READY, me, settle, step, MEASURE, assertNoBox, assertFlatPanel, done } = require('./helpers/text_ui');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

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
  srv.seedVoiceMap({ nodes: [{ id: 1, title: '광합성' }, { id: 2, title: '엽록체' }, { id: 3, title: '세포 호흡' }, { id: 4, title: '혼자 있는 자료', has_summary: false }], links: [], built_at: '2026-01-02T03:04:00Z' });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/voice_study.html');
  await page.waitFor("document.getElementById('list-count').textContent === '4건'", 8000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}
// 같은 클래스의 요소를 현재 화면에 잠깐 만들어 CSS(computed style)를 잰다 — 실제로 그 요소가 나오는 상태를 만들기 번거로운 것들
const INJECT = (html) => `(() => { const h = document.createElement('div'); h.id = 'probe-host'; h.innerHTML = ${JSON.stringify(html)}; (document.querySelector('.view.active') || document.body).appendChild(h); })()`;

// ───────────────────────── voice_study ─────────────────────────
test('217-4 voice 자료 목록 행(.note-item): 테두리·둥근 모서리·그림자 없이 흰 바탕+아래 구분선만(마지막 행 제외), 눌림·선택 모드 체크 유지', { skip: SKIP }, async () => {
  const page = await openVoice();
  const n = await page.count('.note-item');
  assert.equal(n, 4);
  for (let i = 0; i < n; i++) {
    const m = await page.eval(MEASURE('.note-item', null, i));
    assertFlatPanel(m, `목록 행 ${i + 1}`, { bottomLine: true }); assert.equal(m.bw[2], i === n - 1 ? '0px' : '1px', `행 ${i + 1} 구분선`); assert.equal(m.cursor, 'pointer'); assert.ok(m.h >= 43.5);
  }
  // 선택 모드: 체크 표시(checkbox)는 그대로
  await page.eval("document.getElementById('sel-toggle').style.display = ''");
  await page.click('#sel-toggle');
  await page.waitFor("document.querySelectorAll('.note-item.sel-item input[type=checkbox]').length === 4", 4000);
  await settle(page);
  const sel = await page.eval(MEASURE('.note-item.sel-item', null, 0)); assertFlatPanel(sel, '선택 모드 행', { bottomLine: true });
  // 눌림: 선택 모드가 아닐 때 행을 누르면 상세가 열린다(기존 동작)
  await page.eval("document.getElementById('sel-toggle').click()");
  await settle(page);
  await page.click('.note-item', { index: 1 });
  await page.waitFor("currentView === 'edit'", 5000);
  await done(page);
});

test('217-4 voice 녹음 영역(.rec-box)·퀴즈 카드(.quiz-card): 테두리·둥근 모서리·그림자 없이 흰 바탕 면만', { skip: SKIP }, async () => {
  const page = await openVoice();
  await step(page, "showView('record')");
  assertFlatPanel(await page.eval(MEASURE('.rec-box')), '.rec-box');
  await step(page, "quizData = [{ question: 'Q', choices: ['가', '나', '다', '라'], answer_index: 2, explanation: 'e', quote: 'q' }]; quizState = { i: 0, score: 0, answers: [], answered: false, saved: true }; showView('quiz'); renderQuizQuestion();");
  assertFlatPanel(await page.eval(MEASURE('.quiz-card')), '.quiz-card');
  await done(page);
});

test('217-4 voice 연상 그림 카드(.img-card)·합본 행(.merge-row, .merge-no)·기록 행(.hist-row)·노드 목록(.vm-pick): 박스 없음, 구분선만, 번호는 일반 숫자, 고른 항목은 색 바탕 없이 굵게+밑줄', { skip: SKIP }, async () => {
  const page = await openVoice();
  await step(page, INJECT(`<div class="img-card"><div class="img-card-head"><span class="img-card-title">제목</span></div></div>
    <div class="merge-row"><span class="merge-no">1</span><div class="merge-text"><div class="merge-title">자료</div></div></div><div class="merge-row"><span class="merge-no">2</span><div class="merge-text"><div class="merge-title">자료2</div></div></div>
    <div class="hist-row"><span>3 / 5</span><span>오늘</span></div>
    <div class="vm-pick"><button type="button" class="vm-pick-item" aria-pressed="true">고른 항목</button><button type="button" class="vm-pick-item" aria-pressed="false">안 고른 항목</button></div>`));
  assertFlatPanel(await page.eval(MEASURE('.img-card')), '.img-card', { bottomLine: true });
  assertFlatPanel(await page.eval(MEASURE('.merge-row')), '.merge-row', { bottomLine: true });
  assertFlatPanel(await page.eval(MEASURE('.hist-row')), '.hist-row', { bottomLine: true });
  const no = await page.eval(MEASURE('.merge-no')); assert.equal(no.bg, TRANSPARENT); assert.equal(no.radius, '0px'); assert.equal(no.color, CORAL_DARK); assert.ok(no.ratio >= 4.5, '번호 대비 ' + no.ratio.toFixed(2));
  const pick = await page.eval(MEASURE('.vm-pick')); assert.deepEqual(pick.bw, ['0px', '0px', '0px', '0px'], '목록 틀 테두리 없음'); assert.equal(pick.radius, '0px');
  const on = await page.eval(MEASURE('.vm-pick-item[aria-pressed=true]')), off = await page.eval(MEASURE('.vm-pick-item[aria-pressed=false]'));
  assert.equal(on.bg, 'rgb(255, 255, 255)', '색 바탕 없음(흰색)'); assert.equal(on.color, CORAL_DARK); assert.equal(on.weight, '700'); assert.equal(on.underline, true); assert.ok(on.ratio >= 4.5);
  assert.equal(off.weight, '400'); assert.equal(off.underline, false); assert.ok(off.h >= 43.5, '행 높이 44px 이상');
  await done(page);
});

test('217-4 voice·concept 메시지(.msg, .notice): 색 바탕·테두리·둥근 모서리 없이 앞의 기호(✕ ! i)+글자색, 대비 4.5:1', { skip: SKIP }, async () => {
  let page = await openVoice();
  await step(page, INJECT(`<div class="msg error">오류 문구</div><div class="msg warn">경고 문구</div><div class="msg info">안내 문구</div><div class="msg notice">공지 문구</div><div class="msg">중립 문구</div>`));
  const exp = [['error', '"✕"', RED], ['warn', '"!"', 'rgb(26, 26, 26)'], ['info', '"i"', CORAL_DARK], ['notice', '"i"', CORAL_DARK]];
  for (const [cls, mark, color] of exp) {
    const m = await page.eval(MEASURE(`#probe-host .msg.${cls}`, '::before'));
    assertNoBox(m, `voice .msg.${cls}`); assert.equal(m.mark, mark, cls + ' 기호'); assert.equal(m.color, color, cls + ' 글자색'); assert.ok(m.ratio >= 4.5 && m.markRatio >= 4.5, `${cls} 대비 ${m.ratio.toFixed(2)}`);
    assert.equal(m.markWeight, '800');
  }
  assert.equal((await page.eval(MEASURE('#probe-host .msg:not(.error):not(.warn):not(.info):not(.notice)', '::before'))).mark, 'none', '중립 메시지에는 기호 없음');
  // 실제 메시지 하나: 퀴즈 해설(.msg.quiz-feedback.error)
  await step(page, "quizData = [{ question: 'Q', choices: ['가', '나', '다', '라'], answer_index: 2, explanation: '해설', quote: '근거' }]; quizState = { i: 0, score: 0, answers: [], answered: false, saved: true }; showView('quiz'); renderQuizQuestion(); answerQuiz(0);");
  const fb = await page.eval(MEASURE('#quiz-feedback', '::before')); assertNoBox(fb, '.quiz-feedback'); assert.equal(fb.mark, '"✕"'); assert.equal(fb.color, RED); assert.ok(fb.ratio >= 4.5);
  await done(page);

  // concept: 오류(✕), 안내(i)
  srv.reset(); srv.state.me = me();
  srv.seed({ topic: '메시지', items: [{ term: '가' }, { term: '나' }] });
  page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.eval(NO_MOTION);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  await settle(page);
  await step(page, "document.getElementById('ask-msg').textContent = '오류 문구'; document.getElementById('ask-voice').textContent = '안내 문구';");
  const er = await page.eval(MEASURE('#ask-msg', '::before')), inf = await page.eval(MEASURE('#ask-voice', '::before'));
  assertNoBox(er, 'concept .msg.error'); assertNoBox(inf, 'concept .msg.info');
  assert.equal(er.mark, '"✕"'); assert.equal(er.color, RED); assert.ok(er.ratio >= 4.5, '오류 대비 ' + er.ratio.toFixed(2));
  assert.equal(inf.mark, '"i"'); assert.equal(inf.color, CORAL_DARK); assert.ok(inf.ratio >= 4.5, '안내 대비 ' + inf.ratio.toFixed(2));
  await done(page);
});
