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
  const fb = await page.eval(MEASURE('#quiz-feedback', '::before')); assertNoBox(fb, '.quiz-feedback'); assert.equal(fb.mark, '"✕"'); assert.equal(fb.markColor, RED); assert.equal(fb.color, 'rgb(26, 26, 26)', '작업221: 해설·근거는 주 글자색(옛 기대: 전체 빨강)'); assert.ok(fb.ratio >= 4.5 && fb.markRatio >= 4.5);
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

// ───────────────────────── 읽기 3화면 ─────────────────────────
const PICK = `(() => { const ms = DB.eras.flatMap(e => e.movements); return (ms.find(x => x.works && x.works.length >= 2) || ms[0]).id; })()`;

test('217-4 literature 컨테이너: .era-card(구분선만), .section-box, .quiz-card, .related-item(구분선 행)은 테두리·둥근 모서리·그림자 없이 흰 바탕 면만. 뒤집기 카드는 그대로', { skip: SKIP }, async () => {
  const page = await openReading('literature_compass');
  const n = await page.count('.era-card');
  assert.ok(n >= 1);   // 모의 데이터의 시대 수는 1개 이상
  for (let i = 0; i < n; i++) assertFlatPanel(await page.eval(MEASURE('.era-card', null, i)), `.era-card ${i + 1}`, { bottomLine: true });
  assert.equal((await page.eval(MEASURE('.era-card', null, 0))).bw[2], '1px', '시대 사이는 아래 구분선');
  await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK))});`);
  assertFlatPanel(await page.eval(MEASURE('.section-box')), '.section-box');
  await step(page, 'showCards();');
  // 카드 앞면은 뒤집기 단서라서 그대로(유지 예외): 테두리·둥근 모서리 유지
  const front = await page.eval(MEASURE('.flip-card-front')); assert.equal(front.radius, '20px'); assert.equal(front.bw[0], '1px');
  await step(page, INJECT_REL);
  const rel = await page.eval(MEASURE('#probe-host .related-item'));
  assertNoBox(rel, '.related-item', { bottomLine: true }); assert.equal(rel.bw[2], '1px');
  await step(page, "quizData = { rounds: [{ type: 'mcq', questions: [{ question: 'Q', options: ['가', '나', '다', '라'], answer: '다' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 1 }; showView('view-quiz'); renderQuizRound();");
  assertFlatPanel(await page.eval(MEASURE('.quiz-card')), 'literature .quiz-card');
  await done(page);
});
const INJECT_REL = `(() => { const h = document.createElement('div'); h.id = 'probe-host'; h.innerHTML = '<div class="related-list"><div class="related-item"><div class="related-item-info"><div class="related-title">작품</div></div></div><div class="related-item"><div class="related-item-info"><div class="related-title">작품2</div></div></div></div>'; document.querySelector('.view.active').appendChild(h); })()`;

test('217-4 science 과목 선택: 박스·틴트 없는 텍스트 행(구분선, 오른쪽 "›", 높이 44px 이상), 분야색은 분야 이름 글자색, 준비 중 행은 점선 박스 없음, 누르면 캐러셀로 이동', { skip: SKIP }, async () => {
  const page = await openReading('science_reading');
  const n = await page.count('.subject-card');
  assert.ok(n >= 3);
  const inks = { '물리': 'rgb(163, 62, 56)', '화학': 'rgb(44, 115, 115)', '생물': 'rgb(53, 112, 72)', '지구과학': 'rgb(66, 84, 160)' };
  let enabled = 0;
  for (let i = 0; i < n; i++) {
    const m = await page.eval(MEASURE('.subject-card', null, i)), mark = await page.eval(MEASURE('.subject-card', '::after', i)), name = await page.eval(MEASURE('.subject-card .subject-name', null, i));
    assertNoBox(m, `과목 행 ${i + 1}(${name.text})`, { bottomLine: true }); assert.equal(m.bw[2], '1px'); assert.ok(m.h >= 43.5, `높이 ${m.h}`);
    const disabled = m.cls.includes('disabled');
    if (!disabled) {
      enabled++; assert.equal(m.cursor, 'pointer'); assert.equal(mark.mark, '"›"', '오른쪽 ›'); assert.ok(name.ratio >= 4.5, `${name.text} 이름 대비 ${name.ratio.toFixed(2)}`);
      if (inks[name.text]) assert.equal(name.color, inks[name.text], name.text + ': 분야색은 글자색(--field-ink)');
    } else assert.equal(mark.mark, '""', '준비 중에는 › 없음');
  }
  assert.ok(enabled >= 1);
  const firstEnabled = await page.eval("[...document.querySelectorAll('.subject-card')].findIndex(c => !c.classList.contains('disabled'))");
  await page.click('.subject-card', { index: firstEnabled });
  await page.waitFor("document.getElementById('view-list').classList.contains('active')", 6000);
  await done(page);
});

test('217-4 science·digest 캐러셀 카드(.carousel-card): 테두리·둥근 모서리·그림자·그라데이션 없이 평면 흰 배경, 눌러서 상세로 이동, 상세의 머리·구역도 박스 없음', { skip: SKIP }, async () => {
  for (const [file, setup, detail, hdr, sec, view] of [['science_reading', 'openField(FIELD_ORDER[0])', 'showScience(DB.concepts[0].id)', '.science-work-header', '.science-section', 'view-science'],
    ['digest_reading', null, 'showDigest(DB.works[0].id)', '.digest-work-header', '.digest-section', 'view-digest']]) {
    const page = await openReading(file);
    if (setup) await step(page, setup);
    await page.waitFor("!!document.querySelector('.carousel-card.is-center')", 6000);
    await settle(page);
    const c = await page.eval(MEASURE('.carousel-card.is-center'));
    assertFlatPanel(c, file + ' .carousel-card'); assert.equal(c.cursor, 'pointer');
    assert.equal(c.bg, 'rgb(255, 255, 255)', '평면 흰 배경');
    await page.click('.carousel-card.is-center');
    await page.waitFor(`document.getElementById('${view}').classList.contains('active')`, 6000);
    await settle(page);
    assertFlatPanel(await page.eval(MEASURE(hdr)), file + ' ' + hdr);
    assertFlatPanel(await page.eval(MEASURE(sec)), file + ' ' + sec);
    // 퀴즈 카드
    await step(page, file === 'science_reading' ? "quizState = { questions: [{ type: 'mcq', question: 'Q', options: ['가', '나', '다', '라'], answer: '다', roundLabel: 'r' }], currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();"
      : "quizState = { questions: [{ type: 'mcq', question: 'Q', options: ['가', '나', '다', '라'], answer: '다', roundLabel: 'r' }], currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();");
    assertFlatPanel(await page.eval(MEASURE('.quiz-card')), file + ' .quiz-card');
    await done(page);
  }
});
