// 작업278-1: 복습 탭의 "말로 설명하기" — 버튼·대상 개수·0개 비활성, 개념 이름만 제시, 녹음(가짜 MediaRecorder) → 전사 확인 없이 바로 평가, 결과에 원문 없음·요약 있음, 직접 입력, 마이크 오류·429·422 문구,
// 충분일 때만 [표시 해제](자동 해제 없음), 다음 개념·마치기, 최근 부족 목록(표시·숨김·갱신), 탭을 떠나면 녹음 버림, 44px·가로 스크롤 없음. 마이크·MediaRecorder 는 페이지에서 가짜로 대체하고 OpenAI(fetch)·AI(SDK)는 모의한다.
// 서버는 실제 routes/concept_map.js + 가짜 DB 이며 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_answer.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { tabIn } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

const SECRET = '푸른 사과나무 토론회 계획서를 어제 밤에 고쳤습니다';
const EV = { verdict: '부분적', summary: '힘이 운동을 바꾼다고 설명했습니다.', strengths: ['핵심 정의를 말했어요'], gaps: ['예시가 빠졌어요'], supplement: '공을 차면 공이 움직입니다.' };
const EXPL = { definition: '물체의 운동 상태를 바꾸는 원인입니다.', example: '공을 차면 공이 움직입니다.' };
const FAKE_MIC = `(() => {
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ onended: null, stop() {} }] });
  window.MediaRecorder = class {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; }
    static isTypeSupported() { return true; }
    start() { this.state = 'recording'; setTimeout(() => this.ondataavailable && this.ondataavailable({ data: new Blob([new Uint8Array(3000)], { type: 'audio/webm;codecs=opus' }) }), 10); }
    stop() { this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 10); }
  };
})()`;
const ENV_KEYS = ['OPENAI_API_KEY', 'CMAP_STT_DAILY_CAP', 'CMAP_ANSWER_DAILY_CAP'];

async function open(t, { cap = {} } = {}) {
  const saved = {}; for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.CMAP_STT_DAILY_CAP; delete process.env.CMAP_ANSWER_DAILY_CAP;
  if (cap.stt !== undefined) process.env.CMAP_STT_DAILY_CAP = String(cap.stt);
  const realFetch = global.fetch;
  const openai = { calls: [], reply: { status: 200, body: { text: SECRET } } };
  global.fetch = async (url, init) => {
    if (!String(url).includes('api.openai.com')) return realFetch(url, init);
    openai.calls.push({ url: String(url), init });
    return { ok: openai.reply.status >= 200 && openai.reply.status < 300, status: openai.reply.status, json: async () => openai.reply.body };
  };
  const srv = await startCmapServer();
  srv.anthropic.handler = () => JSON.stringify(EV);
  t.after(async () => { global.fetch = realFetch; for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } await srv.close(); });
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page, openai };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
// 개념: 힘(설명), 가속도(설명), 질량(설명 없음). marks 로 지정한 개념을 지도를 열기 전에 서버에 표시해 둔다
async function world(page, { marks = [] } = {}) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const mk = async body => (await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, body)).concept.id;
  const ids = { force: await mk({ term: '힘', explanation: EXPL, explanation_source: 'ai' }), acc: await mk({ term: '가속도', explanation: { definition: '속도가 변하는 정도입니다.' }, explanation_source: 'ai' }), mass: await mk({ term: '질량' }) };
  await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`);
  for (const k of marks) await seed(page, 'PUT', `/api/cmap/concepts/${ids[k]}/mark`, { marked: true });
  await page.eval('refresh()'); await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor("document.querySelectorAll('#concept-list > *').length >= 3", 6000, '개념 목록');
  await page.eval(FAKE_MIC);
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('map-view').hidden", 6000, '지도 화면');
  return { sci, ids };
}
const reviewTab = async page => { await page.click('#nav-quiz'); await page.waitFor("!!document.getElementById('answer-start') && document.getElementById('answer-count').textContent.length > 0", 6000, '복습 탭'); };
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const serverMarks = srv => srv.db.marks.map(m => m.concept_id).sort((a, b) => a - b);
async function speak(page) {                                           // 마이크 → 녹음 → 끝내기
  await page.click('#answer-mic');
  await page.waitFor("document.getElementById('answer-mic').getAttribute('aria-pressed') === 'true'", 3000, '녹음 중');
  await sleep(60);
  await page.click('#answer-mic');
}
const resultShown = page => page.waitFor("!!document.getElementById('answer-verdict') || !!document.getElementById('answer-msg')", 6000, '결과 또는 안내');
const pageText = page => page.eval("document.getElementById('map-view').innerText");

test('버튼: 표시 없음 → 대상 0개·비활성·안내, 설명 없는 표시 개념만 → 다른 안내, 설명 있는 표시 개념 → 개수·활성(44px). 표시한 개념 퀴즈 버튼은 그대로', { skip: SKIP }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await reviewTab(page);
  assert.equal(await text(page, '#answer-count'), '대상 0개');
  assert.equal(await page.eval("document.getElementById('answer-start').disabled"), true);
  assert.equal(await text(page, '#answer-hint'), '지도에서 모르는 개념을 눌러 표시해 보세요');
  assert.equal(await page.eval("!!document.getElementById('answer-recent-label')"), false, '최근 부족 목록은 0개이면 숨김');
  assert.equal(await page.eval("!!document.getElementById('quiz-start-marked') && !!(document.getElementById('quiz-start') || document.getElementById('quiz-go-make'))"), true);
  // 설명 없는 개념만 표시
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids.mass}/mark`, { marked: true });
  await page.click('#nav-map'); await page.waitFor("!document.getElementById('map-view').hidden", 6000);
  await reviewTab(page);
  assert.equal(await text(page, '#answer-count'), '대상 0개');
  assert.match(await text(page, '#answer-hint'), /설명이 있는 표시 개념이 없어요/);
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids.force}/mark`, { marked: true });
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.click('#nav-map'); await page.waitFor("!document.getElementById('map-view').hidden", 6000);
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 1개'", 4000);
  assert.equal(await page.eval("document.getElementById('answer-start').disabled"), false);
  assert.ok(await page.eval("document.getElementById('answer-start').getBoundingClientRect().height") >= 44);
  assert.equal(await page.hasHorizontalScroll(), false);
});

test('녹음 → 바로 평가: 개념 이름만 제시(질문 문장 없음), 전사 확인 단계 없음, 결과에 요약·판정·잘한 점·부족한 점·보완이 있고 전사 원문은 화면 어디에도 없다', { skip: SKIP }, async t => {
  const { srv, page, openai } = await open(t);
  const w = await world(page, { marks: ['force', 'acc'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 2개'", 4000);
  await page.click('#answer-start');
  await page.waitFor("!!document.getElementById('answer-mic')", 4000, '진행 화면');
  assert.equal(await page.eval("document.getElementById('review-panel').hidden"), true, '진행 중에는 복습 목록이 숨겨짐');
  assert.equal(await text(page, '#answer-progress'), '1 / 2');
  assert.equal(await text(page, '#answer-term'), '힘');
  assert.equal(await page.count('#answer-panel textarea'), 0, '녹음 화면에는 입력칸 없음');
  assert.ok(!/\?|질문|설명하세요/.test(await text(page, '#answer-term')), '질문 문장 없음');
  assert.ok(await page.eval("document.getElementById('answer-mic').getBoundingClientRect().width") >= 44);
  await page.click('#answer-mic');
  await page.waitFor("document.getElementById('answer-mic').getAttribute('aria-pressed') === 'true' && /0:0\\d \\/ 1:00/.test(document.getElementById('answer-clock').textContent)", 3000, '녹음 중 시계');
  await sleep(80);
  await page.click('#answer-mic');
  await resultShown(page);
  assert.equal(await text(page, '#answer-verdict'), '부분적');
  assert.equal(await text(page, '#answer-summary'), EV.summary);
  assert.equal(await text(page, '#answer-strengths li'), EV.strengths[0]); assert.equal(await text(page, '#answer-gaps li'), EV.gaps[0]); assert.equal(await text(page, '#answer-supplement'), EV.supplement);
  assert.ok(await page.eval("[...document.querySelectorAll('#answer-panel .sec-label')].some(e => e.textContent === 'AI 평가 · 확인 필요')"));
  assert.ok(await page.eval("!!document.querySelector('#answer-verdict svg')"), '판정은 아이콘 + 글자');
  assert.ok(!(await pageText(page)).includes(SECRET), '전사 원문은 화면에 없음');
  assert.equal(await page.count('#answer-panel textarea'), 0, '전사 확인 단계(입력칸) 없음');
  assert.equal(openai.calls.length, 1); assert.equal(srv.anthropic.calls.length, 1);
  assert.equal(srv.db.answers.length, 1); assert.equal(srv.db.answers[0].concept_id, w.ids.force); assert.equal(srv.db.answers[0].input_mode, 'voice');
  assert.deepEqual(serverMarks(srv), [w.ids.force, w.ids.acc].sort((a, b) => a - b), '자동 해제 없음');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#answer-panel .narr-actions button')].map(b => b.textContent)"), ['다시 말해 보기', '닫기', '다음 개념'], '부분적이면 표시 해제 버튼 없음');
  assert.equal(await page.eval("[...document.querySelectorAll('#answer-panel button')].every(b => b.getBoundingClientRect().height >= 44)"), true);
  assert.equal(await page.hasHorizontalScroll(), false);
});

test('다음 개념 → 마지막은 마치기 → 복습으로 돌아오고, 최근 부족 목록(읽기 형태, 다시 출제 버튼 없음)이 나타난다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  await world(page, { marks: ['force', 'acc'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 2개'", 4000);
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-mic')", 4000);
  await speak(page); await resultShown(page);
  await page.click('#answer-next');
  await page.waitFor("document.getElementById('answer-progress').textContent === '2 / 2' && !!document.getElementById('answer-mic')", 4000, '두 번째 개념');
  assert.equal(await text(page, '#answer-term'), '가속도');
  await speak(page); await resultShown(page);
  assert.equal(await text(page, '#answer-next'), '마치기');
  await page.click('#answer-next');
  await page.waitFor("document.getElementById('answer-panel').hidden && !document.getElementById('review-panel').hidden && !!document.getElementById('answer-recent')", 6000, '퀴즈 화면으로 복귀 + 최근 부족 목록');
  assert.equal(await page.eval("!!document.querySelector('#review-panel #answer-recent')"), false, '280-1: 최근 부족 목록은 퀴즈 탭이 아니라 오답노트 탭에 있다');
  await page.click('#nav-wrong'); await page.waitFor("!document.getElementById('wrong-view').hidden", 4000, '오답노트 탭');
  assert.equal(await text(page, '#answer-recent-label'), '최근 부족하다고 평가된 개념 2개');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#answer-recent > li')].map(li => [li.querySelector('.ar-term').textContent, li.querySelector('.ar-verdict').textContent, li.querySelector('.ar-gaps li').textContent, li.querySelector('.ar-sup').textContent])"),
    [['가속도', '부분적', EV.gaps[0], EV.supplement], ['힘', '부분적', EV.gaps[0], EV.supplement]], '최근 순');
  assert.equal(await page.count('#answer-recent button'), 0, '목록에서 다시 출제하는 버튼은 없음');
  assert.equal(srv.db.answers.length, 2);
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#answer-recent')).listStyleType"), 'none');
});

test('직접 입력: 빈 입력은 서버 호출 없이 안내, 입력하면 평가되고 입력 원문은 결과·화면에 없으며, 입력칸은 자동 높이(스크롤 없음)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, { marks: ['force'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 1개'", 4000);
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-to-text')", 4000);
  await page.click('#answer-to-text');
  await page.waitFor("!!document.getElementById('answer-text')", 3000, '입력칸');
  await page.click('#answer-submit');
  await page.waitFor("!!document.getElementById('answer-msg')", 3000);
  assert.equal(await text(page, '#answer-msg'), '설명을 입력해 주세요.');
  assert.equal(srv.anthropic.calls.length, 0);
  const typed = '내가 직접 입력한 보라색 호랑이 선언문입니다. '.repeat(12);
  await page.type('#answer-text', typed);
  const st = await page.eval("(() => { const t = document.getElementById('answer-text'), cs = getComputedStyle(t); return { sh: t.scrollHeight, ch: t.clientHeight, ov: cs.overflowY, resize: cs.resize }; })()");
  assert.ok(Math.abs(st.sh - st.ch) <= 1 && st.ov === 'hidden' && st.resize === 'none', JSON.stringify(st));
  await page.click('#answer-submit'); await resultShown(page);
  assert.equal(await text(page, '#answer-summary'), EV.summary);
  assert.ok(!(await pageText(page)).includes('보라색 호랑이'), '입력 원문은 결과 화면에 없음');
  assert.equal(srv.db.answers[0].input_mode, 'text'); assert.ok(!JSON.stringify(srv.db.answers).includes('보라색 호랑이'));
  assert.ok(srv.anthropic.calls[0].messages[0].content.includes('보라색 호랑이'), '모델 입력에는 들어감');
  assert.equal(w.ids.force, srv.db.answers[0].concept_id);
  await page.click('#answer-retry');
  await page.waitFor("!!document.getElementById('answer-mic')", 3000);
  assert.equal(await page.count('#answer-panel textarea'), 0, '다시 말해 보기는 처음 화면으로');
});

test('마이크 오류: 권한 거부·미지원 문구만 보이고 직접 입력은 계속 쓸 수 있다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page, { marks: ['force'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 1개'", 4000);
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-mic')", 4000);
  await page.eval("navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }");
  await page.click('#answer-mic');
  await page.waitFor("!!document.getElementById('answer-msg')", 3000);
  assert.match(await text(page, '#answer-msg'), /마이크 사용이 허용되지 않았습니다/);
  assert.equal(await page.eval("document.getElementById('answer-mic').getAttribute('aria-pressed')"), 'false');
  await page.eval("delete window.MediaRecorder; navigator.mediaDevices.getUserMedia = undefined; 0");
  await page.click('#answer-mic');
  await page.waitFor("/지원하지 않습니다/.test((document.getElementById('answer-msg') || {}).textContent || '')", 3000);
  assert.equal(await page.eval("document.getElementById('answer-to-text').disabled"), false);
  await page.click('#answer-to-text'); await page.waitFor("!!document.getElementById('answer-text')", 3000);
});

test('서버 안내: 인식된 말이 없으면(422) 문구 + 다시 시도, 전사 한도 초과(429)는 서버 문구, 평가 실패(502)는 안내 — 결과·저장 없음', { skip: SKIP }, async t => {
  const { srv, page, openai } = await open(t, { cap: { stt: 1 } });
  await world(page, { marks: ['force'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 1개'", 4000);
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-mic')", 4000);
  openai.reply = { status: 200, body: { text: '  ' } };
  await speak(page); await resultShown(page);
  assert.match(await text(page, '#answer-msg'), /음성이 인식되지 않았어요/);
  assert.equal(await page.eval("!!document.getElementById('answer-mic')"), true, '다시 말할 수 있음');
  assert.equal(srv.anthropic.calls.length, 0); assert.equal(srv.db.answers.length, 0);
  await speak(page);                                                              // 한도 1회를 이미 썼으므로 429
  await page.waitFor("/하루 1회/.test((document.getElementById('answer-msg') || {}).textContent || '')", 6000, '429 안내');
  assert.match(await text(page, '#answer-msg'), /하루 1회까지 음성으로 설명할 수 있습니다/);
  assert.equal(openai.calls.length, 1);
  await page.click('#answer-to-text'); await page.waitFor("!!document.getElementById('answer-text')", 3000);
  srv.anthropic.handler = () => 'JSON 아님';
  await page.type('#answer-text', '설명입니다'); await page.click('#answer-submit');
  await page.waitFor("/평가를 만들지|문제가 있었습니다/.test((document.getElementById('answer-msg') || {}).textContent || '')", 6000, '평가 실패 안내');
  assert.match(await text(page, '#answer-msg'), /평가를 만들지 못했습니다|문제가 있었습니다/);
  assert.equal(await page.eval("!!document.getElementById('answer-verdict')"), false); assert.equal(srv.db.answers.length, 0);
  assert.equal(await page.eval("!!document.getElementById('answer-submit')"), true, '입력은 그대로 두고 다시 시도할 수 있음');
});

test('[표시 해제]는 판정이 충분일 때만 보이고 사용자가 눌러야 해제된다(자동 해제 없음), 충분이면 최근 부족 목록에서 빠진다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, { marks: ['force'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 1개'", 4000);
  // 부족 → 목록에 나타남, 표시 해제 버튼 없음
  srv.anthropic.handler = () => JSON.stringify({ ...EV, verdict: '부족', gaps: ['핵심이 빠졌어요'] });
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-mic')", 4000);
  await speak(page); await resultShown(page);
  assert.equal(await text(page, '#answer-verdict'), '부족'); assert.equal(await page.eval("!!document.getElementById('answer-unmark')"), false);
  await page.click('#answer-close');
  await page.waitFor("!!document.getElementById('answer-recent')", 5000);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#answer-recent .ar-term')].map(e => e.textContent)"), ['힘']);
  // 충분 → 표시 해제 버튼, 눌러야 해제
  srv.anthropic.handler = () => JSON.stringify({ ...EV, verdict: '충분', gaps: [] });
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-mic')", 4000);
  await speak(page); await resultShown(page);
  assert.equal(await text(page, '#answer-verdict'), '충분');
  assert.equal(await page.eval("!!document.getElementById('answer-gaps')"), false, '부족한 점이 없으면 구역 없음');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#answer-panel .narr-actions button')].map(b => b.textContent)"), ['다시 말해 보기', '표시 해제', '닫기', '마치기']);
  await sleep(300);
  assert.deepEqual(serverMarks(srv), [w.ids.force], '충분이어도 자동으로 해제되지 않음');
  await page.click('#answer-unmark');
  await page.waitFor("document.getElementById('answer-unmark').textContent === '해제됨'", 4000, '해제됨');
  assert.deepEqual(serverMarks(srv), [], '직접 누르면 해제');
  await page.click('#answer-next');
  await page.waitFor("!document.getElementById('review-panel').hidden && document.getElementById('answer-panel').hidden", 5000);
  await page.waitFor("!document.getElementById('answer-recent-label')", 5000, '충분이 되어 목록에서 빠짐');
  assert.equal(await text(page, '#answer-count'), '대상 0개', '표시를 풀어 대상도 줄어듦');
});

test('다른 탭으로 가면 녹음을 버리고(업로드 없음) 진행 화면이 닫힌다', { skip: SKIP }, async t => {
  const { srv, page, openai } = await open(t);
  await world(page, { marks: ['force'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 1개'", 4000);
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-mic')", 4000);
  await page.click('#answer-mic');
  await page.waitFor("document.getElementById('answer-mic').getAttribute('aria-pressed') === 'true'", 3000);
  await page.click('#nav-map');                                         // 280-1: 녹음 중 탭 전환은 이탈 확인을 먼저 띄운다
  await page.waitFor("document.getElementById('confirm-dlg').open", 3000, '이탈 확인');
  assert.match(await page.text('#confirm-text'), /녹음 중/);
  assert.equal(await page.eval("document.getElementById('answer-panel').hidden"), false, '확인 전에는 그대로');
  await page.click('#confirm-ok');
  await page.waitFor("!document.getElementById('mapmk-view').hidden", 6000, '지도 만들기 화면');
  await sleep(300);
  assert.equal(await page.eval("document.getElementById('answer-panel').hidden"), true);
  assert.equal(openai.calls.length, 0, '버린 녹음은 서버로 가지 않음'); assert.equal(srv.db.answers.length, 0);
  await page.click('#nav-quiz'); await page.waitFor("!!document.getElementById('answer-start')", 4000);
  assert.equal(await page.eval("document.getElementById('review-panel').hidden"), false);
});

test('디자인: 진행·결과 화면에 박스·내부 스크롤·이모지가 없고 글자 크기가 허용 단계다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  await world(page, { marks: ['force'] });
  await reviewTab(page);
  await page.waitFor("document.getElementById('answer-count').textContent === '대상 1개'", 4000);
  await page.click('#answer-start'); await page.waitFor("!!document.getElementById('answer-mic')", 4000);
  await speak(page); await resultShown(page);
  const audit = await page.eval(`(() => {
    const out = { scroll: [], sizes: new Set(), boxes: [] };
    for (const e of document.querySelectorAll('#answer-panel, #answer-panel *, #answer-recent, #answer-recent *')) {
      const cs = getComputedStyle(e);
      if (['auto', 'scroll'].includes(cs.overflowY)) out.scroll.push(e.tagName);
      if (e.children.length === 0 || e.tagName === 'P') out.sizes.add(cs.fontSize);
      if (e.id === 'answer-panel' && (parseFloat(cs.borderTopWidth) > 0 || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none')) out.boxes.push('panel');
    }
    return { scroll: out.scroll, sizes: [...out.sizes], boxes: out.boxes, text: document.getElementById('answer-panel').innerText };
  })()`);
  assert.deepEqual(audit.scroll, []); assert.deepEqual(audit.boxes, []);
  const allowed = new Set(['11px', '12px', '13px', '14px', '15px', '16px', '18px', '22px', '32px', '48px']);
  assert.ok(audit.sizes.every(s => allowed.has(s)), '허용 글자 크기: ' + audit.sizes);
  assert.ok(!/\p{Extended_Pictographic}/u.test(audit.text), '이모지 없음');
  assert.equal(await page.hasHorizontalScroll(), false);
});
