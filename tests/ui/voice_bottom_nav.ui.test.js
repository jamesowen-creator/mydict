// 작업224-2: 음성 학습 하단 내비(탭 5개: 녹음 / 자료 / 퀴즈 / 오답 / 지도)와 퀴즈 탭. 헤드리스 Chrome + 모의 API(비용 API 호출 없음).
// 원칙(작업216-3): 테스트 쪽에서 transition·animation을 끄고(NO_MOTION) 레이아웃이 안정된 뒤(settle) 잰다. 스크롤바는 숨기고 잰다.
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

const LONG = '광합성은 엽록체에서 빛에너지를 이용해 포도당을 만드는 과정이다. '.repeat(6);
const note = (id, title, subject) => ({ id, title, summary: '요약 ' + title, transcript: LONG, subject, created_at: '2026-01-0' + id + 'T00:00:00Z' });
const QUESTIONS = [
  { question: '엽록체에서 일어나는 일은?', choices: ['호흡', '증산', '광합성', '발효'], answer_index: 2, explanation: '설명', quote: '근거' },
  { question: '두 번째 문제', choices: ['가', '나', '다', '라'], answer_index: 0, explanation: '설명', quote: '근거' },
];
function seed(extraNotes = 0) {
  srv.reset(); srv.state.me = me();
  const notes = [note(1, '광합성', '과학'), note(2, '조선 후기', '국어'), note(3, '이차함수', '수학')];
  for (let i = 0; i < extraNotes; i++) notes.push(note(10 + i, '자료 ' + i, '과학'));
  srv.state.voiceNotes = notes;
  srv.state.voiceQuizzes = { 1: QUESTIONS };
  srv.state.voiceQuizSummary = [
    { note_id: 1, title: '광합성', subject: '과학', has_quiz: true, attempts: 3, last_score: 7, last_total: 10, last_at: '2026-01-05T00:00:00Z' },
    { note_id: 2, title: '조선 후기', subject: '국어', has_quiz: false, attempts: 0, last_score: null, last_total: null, last_at: null },
    { note_id: 3, title: '이차함수', subject: '수학', has_quiz: true, attempts: 0, last_score: null, last_total: null, last_at: null },
  ];
  srv.state.voiceQuizzes[3] = QUESTIONS;
  srv.state.voiceWrong = [1, 2].map(i => ({ note_id: 1, title: '광합성', subject: '과학', question: '문제' + i, choices: ['가', '나', '다', '라'], answer_index: 0, chosen: 1, quote: '', created_at: '2026-01-05T00:00:00Z' }));
}
async function open(width = 390, { extra = 0, height = 844 } = {}) {
  seed(extra);
  const page = await browser.newPage({ width, height });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.goto(srv.url + '/voice_study.html');
  await page.waitFor(`document.getElementById('list-count').textContent === '${3 + extra}건'`, 8000);
  await page.eval(NO_MOTION);
  await settle(page);
  // 네이티브 confirm 은 호출 기록을 남기고 answers 큐에서 답을 꺼낸다(기본 true)
  await page.eval("window.__confirms = []; window.__answers = []; window.confirm = m => { window.__confirms.push(m); return window.__answers.length ? window.__answers.shift() : true; };");
  return page;
}
const view = page => page.eval("currentView");
const current = page => page.eval("[...document.querySelectorAll('#bottom-nav .bottom-nav-tab')].filter(b => b.getAttribute('aria-current') === 'page').map(b => b.textContent)");
async function tap(page, tab) { await page.click(`#bottom-nav [data-tab="${tab}"]`); await sleep(250); await settle(page); }
const VQ = "quizData = " + JSON.stringify(QUESTIONS) + "; quizState = { i: 0, score: 0, answers: [], answered: false, saved: true }; showView('quiz'); $('quiz-result').style.display = 'none'; $('quiz-run').style.display = ''; renderQuizQuestion();";
const posts = () => srv.state.log.filter(l => l.method === 'POST');

test('하단 내비: 탭 5개(녹음/자료/퀴즈/오답/지도), nav 라벨, button, 높이 ≥ 44px, 첫 화면(목록)에서 "자료"가 현재 탭(aria-current)', { skip: SKIP }, async () => {
  const page = await open();
  assert.equal(await page.eval("document.getElementById('bottom-nav').tagName"), 'NAV');
  assert.equal(await page.eval("document.getElementById('bottom-nav').getAttribute('aria-label')"), '음성 학습 메뉴');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#bottom-nav .bottom-nav-tab')].map(b => [b.tagName, b.textContent, b.type])"),
    [['BUTTON', '녹음', 'button'], ['BUTTON', '자료', 'button'], ['BUTTON', '퀴즈', 'button'], ['BUTTON', '오답', 'button'], ['BUTTON', '지도', 'button']]);
  assert.ok((await page.eval("[...document.querySelectorAll('#bottom-nav .bottom-nav-tab')].every(b => b.getBoundingClientRect().height >= 43.5)")), '탭 높이 ≥ 44px');
  assert.deepEqual(await current(page), ['자료']);
  assert.equal(await page.eval("getComputedStyle(document.getElementById('bottom-nav')).position"), 'fixed');
  assert.equal(await page.eval("getComputedStyle(document.getElementById('bottom-nav')).zIndex"), '100');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('탭 이동과 활성 표시: 녹음→새 녹음, 자료→목록, 퀴즈→퀴즈 탭, 오답→오답 노트. 하위 화면(상세·이어서 녹음·합치기·질문·퀴즈 풀이)의 활성 탭', { skip: SKIP }, async () => {
  const page = await open();
  await tap(page, 'record'); assert.equal(await view(page), 'record'); assert.deepEqual(await current(page), ['녹음']);
  await tap(page, 'quiz'); assert.equal(await view(page), 'qlist'); assert.deepEqual(await current(page), ['퀴즈']);
  await tap(page, 'wrong'); assert.equal(await view(page), 'wrong'); assert.deepEqual(await current(page), ['오답']);
  await tap(page, 'notes'); assert.equal(await view(page), 'list'); assert.deepEqual(await current(page), ['자료']);
  // 자료 상세(목록에서 연 것) → 자료
  await page.click('.note-item'); await page.waitFor("currentView === 'edit'"); await settle(page);
  assert.deepEqual(await current(page), ['자료'], '상세');
  // 이어서 녹음·질문하기·합치기 → 자료
  await page.eval("startAppend()"); await sleep(200); assert.equal(await view(page), 'record'); assert.deepEqual(await current(page), ['자료'], '이어서 녹음');
  await page.eval("showView('edit'); resetRecording()");
  await page.eval("showView('chat')"); assert.deepEqual(await current(page), ['자료'], '질문하기');
  await page.eval("showView('merge')"); assert.deepEqual(await current(page), ['자료'], '합치기');
  // 퀴즈 풀이 → 퀴즈
  await page.eval(VQ); assert.deepEqual(await current(page), ['퀴즈'], '퀴즈 풀이');
  // 퀴즈 탭에서 들어간 상세 → 퀴즈 (저장된 퀴즈가 없는 자료 2번은 상세에 머묾)
  await page.eval("quizState = { i: 0, score: 0, answers: [], answered: false, saved: true }; editDirty = false; showView('list')");
  await tap(page, 'quiz');
  await page.click('.note-item[data-note-id="2"]'); await page.waitFor("currentView === 'edit'"); await settle(page);
  assert.deepEqual(await current(page), ['퀴즈'], '퀴즈 탭에서 들어간 상세');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('지도 탭: 화면 전환·확인창 없이 과목 선택 팝업만 열고, 활성 표시는 바뀌지 않음(녹음 화면에서도)', { skip: SKIP }, async () => {
  const page = await open();
  await page.click('#bottom-nav [data-tab="map"]'); await sleep(200);
  assert.equal(await page.eval("document.getElementById('vm-subject').open"), true, '과목 선택 팝업');
  assert.equal(await view(page), 'list'); assert.deepEqual(await current(page), ['자료']);
  await page.eval("document.getElementById('vm-subject').close()");
  await tap(page, 'record');
  await page.eval("pending = { blob: 1 }");   // 변환하지 않은 녹음이 있어도 지도 탭은 확인 없이 팝업만 연다
  await page.click('#bottom-nav [data-tab="map"]'); await sleep(200);
  assert.equal(await page.eval("document.getElementById('vm-subject').open"), true);
  assert.equal(await view(page), 'record'); assert.deepEqual(await current(page), ['녹음']);
  assert.deepEqual(await page.eval("window.__confirms"), [], '확인창 없음');
  assert.equal(await page.eval("[...document.querySelectorAll('#bottom-nav [aria-current]')].some(b => b.dataset.tab === 'map')"), false, '지도 탭은 활성 표시 없음');
  await page.eval("pending = null; document.getElementById('vm-subject').close()");
  await page.close();
});

test('활성 탭 다시 누르기: 첫 화면이면 맨 위로 + 새로고침, 하위 화면이면 첫 화면으로, 녹음 중 "녹음" 탭은 무동작', { skip: SKIP }, async () => {
  const page = await open(390, { extra: 12 });
  await page.eval("window.scrollTo(0, 400)"); await sleep(100);
  assert.ok(await page.eval("window.scrollY") > 100, '스크롤됨');
  const before = srv.state.log.filter(l => l.url === '/api/voice-notes' && l.method === 'GET').length;
  await tap(page, 'notes');
  assert.equal(await page.eval("window.scrollY"), 0, '맨 위로');
  assert.equal(srv.state.log.filter(l => l.url === '/api/voice-notes' && l.method === 'GET').length, before + 1, '목록 새로고침');
  // 하위 화면(상세)에서 "자료" 재클릭 → 목록
  await page.click('.note-item'); await page.waitFor("currentView === 'edit'");
  await tap(page, 'notes'); assert.equal(await view(page), 'list');
  // 퀴즈 탭 안의 상세 → "퀴즈" 재클릭 → 퀴즈 탭 첫 화면
  await tap(page, 'quiz');
  await page.click('.note-item[data-note-id="2"]'); await page.waitFor("currentView === 'edit'");
  await tap(page, 'quiz'); assert.equal(await view(page), 'qlist');
  // 녹음 중에는 "녹음" 재클릭이 무동작(확인창도 없음)
  await tap(page, 'record');
  await page.eval("recState = 'recording'");
  await page.eval("window.__confirms.length = 0");
  await tap(page, 'record');
  assert.equal(await view(page), 'record'); assert.equal(await page.eval("recState"), 'recording'); assert.deepEqual(await page.eval("window.__confirms"), []);
  await page.eval("recState = 'idle'");
  await page.close();
});

test('이탈 확인(leaveConfirmed): 녹음 중·변환 안 한 녹음·저장 안 한 편집에서 탭을 누르면 확인, 거절하면 그 화면 유지 / 승인하면 이동하고 상태 초기화', { skip: SKIP }, async () => {
  const page = await open();
  await tap(page, 'record');
  await page.eval("recState = 'recording'");
  await page.eval("window.__answers = [false]");
  await tap(page, 'notes');
  assert.equal(await view(page), 'record', '거절하면 유지');
  assert.match((await page.eval("window.__confirms"))[0], /녹음 중입니다/);
  await tap(page, 'notes');   // 기본 답 true → 이동
  assert.equal(await view(page), 'list'); assert.equal(await page.eval("recState"), 'idle', '녹음 상태 초기화(resetRecording)');
  // 변환하지 않은 녹음
  await tap(page, 'record');
  await page.eval("pending = { blob: 1 }; window.__confirms.length = 0; window.__answers = [false]");
  await tap(page, 'quiz');
  assert.equal(await view(page), 'record'); assert.match((await page.eval("window.__confirms"))[0], /변환하지 않은 녹음/);
  await page.eval("pending = null");
  await tap(page, 'notes');
  // 저장하지 않은 편집
  await page.click('.note-item'); await page.waitFor("currentView === 'edit'");
  await page.eval("editDirty = true; window.__confirms.length = 0; window.__answers = [false]");
  await tap(page, 'wrong');
  assert.equal(await view(page), 'edit'); assert.match((await page.eval("window.__confirms"))[0], /저장하지 않은 내용/);
  await tap(page, 'wrong');   // 승인
  assert.equal(await view(page), 'wrong'); assert.equal(await page.eval("editDirty"), false);
  await page.close();
});

test('퀴즈 풀이 중(한 문제라도 답한 뒤, 결과 전) 탭을 누르면 "퀴즈를 그만할까요?" 확인: 취소하면 퀴즈 유지, 확인하면 이동. 답하기 전에는 확인 없음', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval(VQ);
  await tap(page, 'notes');   // 아직 답하지 않음 → 확인 없이 이동
  assert.equal(await view(page), 'list');
  await page.eval(VQ);
  await page.click('.mcq-option', { index: 0 }); await sleep(200);
  await page.click('#bottom-nav [data-tab="wrong"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]')");
  assert.match(await page.text('[data-t="dialog-msg"]'), /퀴즈를 그만할까요\? 지금까지의 답은 저장되지 않습니다/);
  await page.click('[data-t="dialog-cancel"]'); await sleep(250);
  assert.equal(await view(page), 'quiz', '취소하면 퀴즈 유지');
  assert.equal(await page.eval("quizState.answers.length"), 1, '답은 그대로');
  await page.click('#bottom-nav [data-tab="wrong"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-ok]')");
  await page.click('[data-t="dialog-ok"]'); await sleep(300);
  assert.equal(await view(page), 'wrong', '확인하면 이동');
  assert.equal(posts().filter(l => /quiz\/attempts/.test(l.url)).length, 0, '그만두면 시도가 저장되지 않음');
  await page.close();
});

test('뒤로가기(popstate)는 기존 그대로: 퀴즈 풀이 중에는 확인 없이 자료 상세로, 퀴즈 탭에서 들어간 상세에서는 퀴즈 탭으로, 퀴즈 탭에서는 목록으로', { skip: SKIP }, async () => {
  const page = await open();
  await tap(page, 'quiz');
  await page.click('.note-item[data-note-id="1"]');          // 저장된 퀴즈가 있는 자료 → 바로 퀴즈 풀이
  await page.waitFor("currentView === 'quiz'", 6000); await settle(page);
  await page.click('.mcq-option', { index: 0 }); await sleep(150);
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await view(page), 'edit', '퀴즈 → 상세(확인 창 없음)');
  assert.equal(await page.exists('[data-t=dialog-msg]'), false);
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await view(page), 'qlist', '퀴즈 탭에서 들어간 상세 → 퀴즈 탭');
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await view(page), 'list', '퀴즈 탭 → 목록');
  await page.close();
});

test('퀴즈 탭: 열기만 해서는 POST 요청 0(AI·저장 없음), 자료 행 "최근 7/10 · 3회 · 오답 2" / "퀴즈 없음" / "아직 풀지 않음", 과목 필터', { skip: SKIP }, async () => {
  const page = await open();
  srv.state.log.length = 0;
  await tap(page, 'quiz');
  await page.waitFor("document.querySelectorAll('#qlist-list .note-item').length === 3");
  assert.equal(posts().length, 0, '퀴즈 탭을 여는 동안 POST 0');
  assert.deepEqual(srv.state.log.map(l => l.method + ' ' + l.url).sort(), ['GET /api/voice-notes/quiz-summary', 'GET /api/voice-notes/wrong-answers']);
  const lines = await page.eval("[...document.querySelectorAll('#qlist-list .note-item')].map(r => r.querySelector('.note-title').textContent + '|' + r.querySelector('[data-t=qlist-line]').textContent)");
  assert.deepEqual(lines, ['광합성|최근 7/10 · 3회 · 오답 2', '조선 후기|퀴즈 없음', '이차함수|아직 풀지 않음']);
  // 217 방식의 텍스트 행: 박스 없음, 아래 구분선
  const row = await page.eval("(() => { const cs = getComputedStyle(document.querySelector('#qlist-list .note-item')); return [cs.backgroundColor, cs.borderTopWidth, cs.borderBottomWidth, cs.borderRadius, cs.boxShadow]; })()");
  assert.deepEqual(row.slice(2), ['1px', '0px', 'none']); assert.equal(row[1], '0px');
  // 과목 필터
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#qlist-filter .kw-chip')].map(c => c.textContent)"), ['전체', '국어', '수학', '과학']);
  await page.click('#qlist-filter .kw-chip[data-subject="과학"]'); await sleep(100);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#qlist-list .note-title')].map(t => t.textContent)"), ['광합성']);
  assert.equal(await page.eval("document.querySelector('#qlist-filter .kw-chip.on').getAttribute('aria-pressed')"), 'true');
  assert.equal(posts().length, 0, '필터도 요청 없음');
  await page.close();
});

test('퀴즈 탭 행 누르기: 저장된 유효 퀴즈가 있으면 바로 퀴즈 풀이, 없으면 상세에 머묾(퀴즈 만들기는 사용자가 직접) — 어느 경우에도 AI 호출 0', { skip: SKIP }, async () => {
  const page = await open();
  await tap(page, 'quiz');
  await page.waitFor("document.querySelectorAll('#qlist-list .note-item').length === 3");
  srv.state.log.length = 0;
  await page.click('.note-item[data-note-id="2"]');   // 저장된 퀴즈 없음
  await page.waitFor("currentView === 'edit'"); await sleep(500); await settle(page);
  assert.equal(await view(page), 'edit', '퀴즈가 없으면 상세에 머묾');
  assert.deepEqual(await current(page), ['퀴즈']);
  assert.equal(await page.visible('#quiz-make'), true, '"퀴즈 만들기" 버튼은 사용자가 직접 누름');
  await page.eval("history.back()"); await sleep(300);
  assert.equal(await view(page), 'qlist');
  await page.click('.note-item[data-note-id="1"]');   // 저장된 퀴즈 있음
  await page.waitFor("currentView === 'quiz'", 6000); await settle(page);
  assert.equal(await page.text('#quiz-progress'), '1 / 2');
  assert.deepEqual(await current(page), ['퀴즈']);
  assert.equal(posts().length, 0, 'POST 0: 퀴즈 만들기(AI)·요약·질문·변환 모두 호출되지 않음');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('대화 입력 바(.chat-input-bar)는 하단 내비 위에 붙고 겹치지 않음. 목록·퀴즈 탭의 마지막 항목은 내비에 가려지지 않음', { skip: SKIP }, async () => {
  const page = await open(390, { extra: 12 });
  // 본문이 내비에 가려지지 않음: 목록 맨 아래로 스크롤했을 때 마지막 항목의 아래가 내비 위쪽보다 위
  await page.eval("window.scrollTo(0, document.documentElement.scrollHeight)"); await sleep(150);
  const gap = await page.eval("(() => { const items = document.querySelectorAll('#note-list .note-item'); const last = items[items.length - 1].getBoundingClientRect(); return document.getElementById('bottom-nav').getBoundingClientRect().top - last.bottom; })()");
  assert.ok(gap >= -0.5, '목록 마지막 항목이 내비에 가려짐: 간격 ' + gap);
  await page.eval("window.scrollTo(0, 0)");
  // 대화 입력 바: 화면이 길어서 바가 붙는(sticky) 상태에서 내비 위쪽보다 위
  await page.eval("showView('chat'); document.getElementById('view-chat').style.minHeight = '2600px'; window.scrollTo(0, 0)"); await sleep(200); await settle(page);
  const m = await page.eval("(() => { const b = document.getElementById('chat-input-bar'); const r = b.getBoundingClientRect(), n = document.getElementById('bottom-nav').getBoundingClientRect(); return { bottom: r.bottom, navTop: n.top, display: getComputedStyle(b).display, stick: getComputedStyle(b).bottom }; })()");
  assert.notEqual(m.display, 'none');
  assert.ok(m.bottom <= m.navTop + 0.5, `입력 바 아래 ${m.bottom} > 내비 위 ${m.navTop}`);
  assert.equal(m.stick, '78px', '입력 바는 내비 높이만큼 위에 붙음(bottom)');
  await page.close();
});

for (const w of [320, 390, 768, 1024]) {
  test(`하단 내비 ${w}px: 탭 5개 균등 폭·라벨 잘림 없음·가운데 열(최대 680px)·가로 스크롤 없음`, { skip: SKIP }, async () => {
    const page = await open(w);
    const m = await page.eval(`(() => {
      const n = document.getElementById('bottom-nav'), nr = n.getBoundingClientRect();
      const tabs = [...n.querySelectorAll('.bottom-nav-tab')].map(t => { const r = t.getBoundingClientRect(); return { x0: r.left, x1: r.right, w: r.width, h: r.height, fits: t.scrollWidth <= t.clientWidth, font: getComputedStyle(t).fontSize, weight: getComputedStyle(t).fontWeight }; });
      return { vw: document.documentElement.clientWidth, nx0: nr.left, nx1: nr.right, tabs };
    })()`);
    assert.equal(m.tabs.length, 5);
    const col = Math.min(680, m.vw), c0 = (m.vw - col) / 2;
    assert.ok(Math.abs(m.nx0 - c0) <= 1 && Math.abs(m.nx1 - (c0 + col)) <= 1, `내비 ${m.nx0}~${m.nx1} (열 ${c0}~${c0 + col})`);
    const w0 = m.tabs[0].w;
    for (const t of m.tabs) { assert.ok(Math.abs(t.w - w0) <= 1, '탭 폭 균등: ' + m.tabs.map(x => x.w.toFixed(1)).join(',')); assert.ok(t.fits, '라벨 잘림 없음'); assert.ok(t.h >= 43.5); assert.equal(t.font, w <= 460 ? '13px' : '15px'); assert.equal(t.weight, '500'); }
    assert.ok(m.tabs[0].x0 >= m.nx0 - 0.5 && m.tabs[4].x1 <= m.nx1 + 0.5, '탭이 내비 안');
    for (let i = 1; i < 5; i++) assert.ok(m.tabs[i].x0 >= m.tabs[i - 1].x1 - 0.5, '탭이 서로 겹치지 않음');
    assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음');
    await page.close();
  });
}

// 사전의 하단 내비와 같은 사양인지: 같은 폭에서 재서 비교(색은 화면별 팔레트라 제외, 활성 글자색은 둘 다 #b8442e)
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const NAV_SPEC = (navSel, tabSel, activeSel) => `(() => {
  const n = document.querySelector(${JSON.stringify(navSel)}), nr = n.getBoundingClientRect(), cs = getComputedStyle(n);
  const tabs = [...n.querySelectorAll(${JSON.stringify(tabSel)})], t0 = tabs[0], tcs = getComputedStyle(t0);
  const a = n.querySelector(${JSON.stringify(activeSel)}), acs = getComputedStyle(a);
  return { vw: document.documentElement.clientWidth, x0: nr.left, x1: nr.right, h: nr.height, borderTop: cs.borderTopWidth, shadow: cs.boxShadow, padB: cs.paddingBottom, padL: cs.paddingLeft, z: cs.zIndex, pos: cs.position,
    count: tabs.length, tabW: t0.getBoundingClientRect().width, tabH: t0.getBoundingClientRect().height, font: tcs.fontSize, weight: tcs.fontWeight, padT: tcs.paddingTop, label: tcs.color === acs.color,
    tabTopBorder: tcs.borderTopWidth, activeTopBorder: acs.borderTopWidth, activeColor: acs.color, activeBorderColor: acs.borderTopColor, gap: getComputedStyle(t0.parentElement).columnGap };
})()`;
for (const w of [390, 1024]) {
  test(`음성 하단 내비 = 사전 하단 내비 사양 (${w}px): 높이·윗선·그림자·탭 수·탭 폭·라벨 크기/굵기·활성 선 3px·가운데 열·z-index 일치, 활성 글자색 둘 다 #b8442e`, { skip: SKIP }, async () => {
    const v = await open(w);
    const vm = await v.eval(NAV_SPEC('#bottom-nav', '.bottom-nav-tab', '.bottom-nav-tab.active'));
    await v.close();
    srv.reset(); srv.state.me = me();
    const d = await browser.newPage({ width: w, height: 844, token: jwt() });
    await d.send('Emulation.setScrollbarsHidden', { hidden: true });
    await d.goto(srv.url + '/english_dictionary.html');
    await d.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
    await d.eval(NO_MOTION); await settle(d);
    const dm = await d.eval(NAV_SPEC('nav', '.nav-tab', '.nav-tab.active'));
    await d.close();
    const same = (k, tol = 0.6) => typeof vm[k] === 'number' ? assert.ok(Math.abs(vm[k] - dm[k]) <= tol, `${k}: 음성 ${vm[k]} vs 사전 ${dm[k]}`) : assert.equal(vm[k], dm[k], `${k}: 음성 ${vm[k]} vs 사전 ${dm[k]}`);
    for (const k of ['vw', 'x0', 'x1', 'h', 'borderTop', 'shadow', 'padB', 'padL', 'z', 'pos', 'count', 'tabW', 'font', 'weight', 'padT', 'tabTopBorder', 'activeTopBorder', 'gap']) same(k);
    // 탭 높이: 사전은 ≤460px 에서 라벨 아래에 숫자 배지 줄(14px)을 예약해 56px, 음성은 배지가 없어 44px(둘 다 ≥ 44px). 넓은 화면에서는 같아야 함
    if (w > 460) same('tabH'); else assert.ok(vm.tabH >= 43.5 && dm.tabH >= 43.5);
    assert.equal(vm.count, 5); assert.equal(vm.font, w <= 460 ? '13px' : '15px'); assert.equal(vm.activeTopBorder, '3px'); assert.equal(vm.borderTop, '1px');
    assert.equal(vm.activeColor, 'rgb(184, 68, 46)', '음성 활성 글자색'); assert.equal(dm.activeColor, 'rgb(184, 68, 46)', '사전 활성 글자색');
    assert.equal(vm.activeBorderColor, 'rgb(226, 88, 59)'); assert.equal(dm.activeBorderColor, 'rgb(226, 88, 59)', '활성 위쪽 선은 코랄 그대로');
  });
}
