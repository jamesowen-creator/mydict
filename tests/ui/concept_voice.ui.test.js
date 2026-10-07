// 작업206: 개념학습 음성 입력 화면 - 마이크 버튼 표시, 권한 거부·미지원 안내, 변환 결과 채우기(자동 추가 없음), 실패 문구.
// 마이크·MediaRecorder는 페이지 안에서 가짜로 대체하고 서버 변환도 모의한다(실제 마이크·OpenAI 사용 없음).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

async function openStudy(width = 390) {
  srv.reset();
  srv.seed({ topic: '생물 · 세포', items: [{ term: '세포' }, { term: '광합성' }] });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  return page;
}
// 가짜 마이크·녹음기: start 후 조각 하나를 만들고 stop하면 onstop을 부른다
const FAKE_MIC = `(() => {
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ onended: null, stop() {} }] });
  window.MediaRecorder = class {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; }
    static isTypeSupported() { return true; }
    start() { this.state = 'recording'; setTimeout(() => this.ondataavailable && this.ondataavailable({ data: new Blob([new Uint8Array(3000)], { type: 'audio/webm;codecs=opus' }) }), 10); }
    stop() { this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 10); }
  };
})()`;
const exploreCalls = () => srv.state.log.filter(l => /\/explore$/.test(l.url));

test('마이크 버튼: 시작 화면의 첫 개념 입력창 옆과 학습 화면 하단 입력창 옆에 보이고 44px', { skip: SKIP }, async () => {
  const page = await openStudy();
  for (const sel of ['#ask-mic']) {
    assert.equal(await page.visible(sel), true, sel);
    const r = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.width, r.height]; })()`);
    assert.ok(r[0] >= 44 && r[1] >= 44, sel + ' ' + r);
    assert.equal(await page.eval(`document.querySelector(${JSON.stringify(sel)}).getAttribute('aria-label')`), '음성으로 입력');
  }
  await page.click('#back-btn');
  await page.waitFor("!document.getElementById('view-list').hidden");
  await page.click('#start-open');
  assert.equal(await page.visible('#start-first-mic'), true);
  assert.equal(await page.eval("document.getElementById('start-first-mic').getBoundingClientRect().height >= 44"), true);
  await page.close();
});

test('마이크 권한 거부: 안내 문구만 보이고 글자 입력은 그대로 동작', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.eval("navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }");
  await page.click('#ask-mic');
  await page.waitFor("document.getElementById('ask-voice').textContent.length > 0");
  assert.match(await page.text('#ask-voice'), /마이크 사용이 허용되지 않았습니다/);
  assert.match(await page.text('#ask-voice'), /글로 입력/);
  assert.equal(await page.eval("document.getElementById('ask-mic').getAttribute('aria-pressed')"), 'false');
  assert.equal(await page.eval("document.getElementById('ask-submit').disabled"), false, '글자 입력은 막히지 않음');
  await page.type('#ask-input', '엽록체');
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '엽록체');
  assert.equal(srv.state.voiceCalls.length, 0, '서버 호출 없음');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('미지원 브라우저(MediaRecorder 없음): 안내 문구만', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.eval('delete window.MediaRecorder; window.MediaRecorder = undefined;');
  await page.click('#ask-mic');
  assert.match(await page.text('#ask-voice'), /음성 입력을 지원하지 않습니다/);
  assert.equal(srv.state.voiceCalls.length, 0);
  await page.close();
});

test('녹음 → 변환 → 입력창에 채움: 보내기는 잠기고, 자동으로 추가(AI 호출)되지 않으며, 사용자가 직접 보내면 그때 호출', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.eval(FAKE_MIC);
  await page.click('#ask-mic');
  await page.waitFor("document.getElementById('ask-mic').getAttribute('aria-pressed') === 'true'");
  assert.match(await page.text('#ask-voice'), /녹음 중/);
  assert.equal(await page.eval("document.getElementById('ask-submit').disabled"), true, '녹음 중에는 보내기 잠금');
  assert.equal(await page.eval("document.getElementById('ask-mic').getAttribute('aria-label')"), '녹음 끝내기');
  await sleep(120);
  await page.click('#ask-mic');
  await page.waitFor("document.getElementById('ask-input').value === '광합성'", 6000);
  assert.match(await page.text('#ask-voice'), /확인하고 고친 뒤 직접 추가/);
  assert.equal(await page.eval("document.getElementById('ask-submit').disabled"), false, '변환이 끝나면 다시 열림');
  assert.equal(await page.eval("document.getElementById('ask-mic').getAttribute('aria-pressed')"), 'false');
  assert.equal(srv.state.voiceCalls.length, 1);
  assert.match(srv.state.voiceCalls[0].type, /^audio\/webm/);
  assert.ok(Number(srv.state.voiceCalls[0].seconds) <= 60);
  assert.ok(srv.state.voiceCalls[0].bytes >= 3000);
  await sleep(300);
  assert.equal(exploreCalls().length, 0, '변환만으로는 AI를 호출하지 않음');
  assert.equal(srv.state.items.length, 2, '개념도 만들어지지 않음');
  // 사용자가 고쳐서 직접 보낸다
  await page.type('#ask-input', '광합성 작용');
  await page.click('#ask-submit');
  await page.waitFor('true');
  await sleep(500);
  assert.equal(exploreCalls().length, 1, '직접 보냈을 때만 AI 호출');
  assert.equal(exploreCalls()[0].body.text, '광합성 작용');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('시작 화면 첫 개념 입력창에도 같은 방식으로 채워짐', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('#back-btn');
  await page.waitFor("!document.getElementById('view-list').hidden");
  await page.click('#start-open');
  await page.eval(FAKE_MIC);
  srv.state.voicePlan = [{ status: 200, body: { text: '미토콘드리아' } }];
  await page.click('#start-first-mic');
  await sleep(120);
  await page.click('#start-first-mic');
  await page.waitFor("document.getElementById('start-first').value === '미토콘드리아'", 6000);
  assert.equal(exploreCalls().length, 0);
  await page.close();
});

test('변환 실패 문구: 빈 결과·429(서버 문구)·502·503. 입력창 내용은 그대로', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.eval(FAKE_MIC);
  await page.type('#ask-input', '이미 쓴 글');
  const attempt = async () => { await page.click('#ask-mic'); await sleep(100); await page.click('#ask-mic'); await page.waitFor("document.getElementById('ask-mic').getAttribute('aria-pressed') === 'false' && !document.getElementById('ask-voice').textContent.includes('바꾸는 중') && document.getElementById('ask-voice').textContent.length > 0", 6000); await sleep(100); return page.text('#ask-voice'); };
  srv.state.voicePlan = [{ status: 200, body: { text: '' } }];
  assert.match(await attempt(), /들리는 말을 찾지 못했습니다/);
  srv.state.voicePlan = [{ status: 429, body: { error: '하루 20회까지 음성으로 입력할 수 있습니다.' } }];
  assert.equal(await attempt(), '하루 20회까지 음성으로 입력할 수 있습니다.');
  srv.state.voicePlan = [{ status: 502, body: { error: 'x' } }];
  assert.match(await attempt(), /음성 변환 서비스에 문제가 있었습니다/);
  srv.state.voicePlan = [{ status: 503, body: { error: 'x' } }];
  assert.match(await attempt(), /지금은 이 기능을 사용할 수 없습니다/);
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '이미 쓴 글');
  assert.equal(await page.eval("document.getElementById('ask-submit').disabled"), false);
  assert.equal(exploreCalls().length, 0);
  await page.close();
});

test('긴 변환 결과는 입력 한도(80자)까지만 넣고 알려 줌', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.eval(FAKE_MIC);
  srv.state.voicePlan = [{ status: 200, body: { text: '가'.repeat(120) } }];
  await page.click('#ask-mic'); await sleep(100); await page.click('#ask-mic');
  await page.waitFor("document.getElementById('ask-input').value.length > 0", 6000);
  assert.equal(await page.eval("Array.from(document.getElementById('ask-input').value).length"), 80);
  assert.match(await page.text('#ask-voice'), /80자까지만/);
  await page.close();
});

for (const w of [390, 768, 1024]) {
  test(`음성 입력 ${w}px: 가로 스크롤 없음, 하단 입력줄에 마이크·보내기 모두 44px`, { skip: SKIP }, async () => {
    const page = await openStudy(w);
    await page.eval(FAKE_MIC);
    await page.click('#ask-mic');
    await page.waitFor("document.getElementById('ask-voice').textContent.includes('녹음 중')");
    assert.equal(await page.hasHorizontalScroll(), false);
    const r = await page.eval("[...document.querySelectorAll('.ask button')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; })");
    for (const [bw, bh] of r) assert.ok(bw >= 43.5 && bh >= 43.5, JSON.stringify(r));
    const input = await page.eval("(() => { const r = document.getElementById('ask-input').getBoundingClientRect(); return r.width; })()");
    assert.ok(input > 120, '입력창이 남은 폭을 쓴다 ' + input);
    await page.click('#ask-mic');   // 녹음을 끝내 정리
    await page.waitFor("document.getElementById('ask-input').value.length > 0", 6000);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
