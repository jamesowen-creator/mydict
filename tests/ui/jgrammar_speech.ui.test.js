// 일본어 문법 해설 읽어주기(듣기) 화면 시험 — speechSynthesis 는 페이지 안에서 가짜로 대체한다(실제 소리·음성 없음). 자체 임시 서버(정적 파일 + 모의 API, AI·DB·운영 서버와 무관).
// 확인: 링크 표시·속도·언어·음성 선택·멈춤/교체·정지 조건·음성 없음 안내·speechSynthesis 없음·XSS·서버로 읽을 텍스트를 보내지 않음·390px 배치.
// 실행: node --test tests/ui/jgrammar_speech.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const GRAMMAR = [{ name: '〜を', meaning: '목적격 조사', form: '飲みます', contrast: '「が」와 다름', jlpt: 'N5' }];
const S1 = '私は毎朝コーヒーを飲みます。';
const RUBY1 = [{ text: '私', reading: 'わたし' }, { text: 'は' }, { text: '毎朝', reading: 'まいあさ' }, { text: 'コーヒー' }, { text: 'を' }, { text: '飲', reading: 'の' }, { text: 'みます。' }];
const S2 = '猫が好き';
const RUBY2 = [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }];
const RESULTS = {   // 문장 → 서버가 돌려주는 결과
  [S1]: { translation: '나는 매일 아침 커피를 마십니다', grammar: GRAMMAR, ruby: RUBY1 },
  [S2]: { translation: '고양이를 좋아한다', grammar: GRAMMAR, ruby: RUBY2 },
  '犬が好き': { translation: '개를 좋아한다', grammar: GRAMMAR, ruby: null },            // ruby 검증 실패(null) → 원문을 그대로 읽는다
  'ねこがすき。': { translation: '고양이를 좋아한다', grammar: GRAMMAR, ruby: [] },      // 한자 없음
  'あ<img src=x onerror=window.__x=1>': { translation: 'x', grammar: GRAMMAR, ruby: null },
};

let srv, base, browser;
const state = { requests: [], saved: [] };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        state.requests.push({ method: req.method, url: u, body });
        if (u === '/api/me') return json(200, { id: 1, email: 'u@x', name: '테스터', role: 'user', perm_jgrammar: true });
        if (u === '/api/jgrammar/saved' && req.method === 'GET') return json(200, { ok: true, items: state.saved });
        if (u === '/api/jgrammar/explain') {
          const sentence = JSON.parse(body || '{}').sentence;
          return RESULTS[sentence] ? json(200, { ok: true, cached: false, result: RESULTS[sentence] }) : json(422, { ok: false, error: '모의 서버: 준비되지 않은 문장' });
        }
        json(404, { ok: false });
      });
      return;
    }
    const f = path.join(PUB, u);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });

// 페이지가 열리기 전에 심는 가짜 speechSynthesis. voices: 처음 getVoices() 가 돌려줄 목록, supported=false 면 speechSynthesis 자체가 없다
const MOCK = (voices, supported = true) => `(() => {
  const S = window.__speech = { spoken: [], cancels: 0, voices: ${JSON.stringify(voices)}, current: null, listeners: {} };
  S.finish = () => { const u = S.current; S.current = null; if (u && u.onend) u.onend({}); };
  S.setVoices = v => { S.voices = v; (S.listeners.voiceschanged || []).forEach(f => f({})); };
  if (!${supported}) { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); delete window.SpeechSynthesisUtterance; return; }
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => S.voices.slice(),
    speak: u => { S.spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice ? u.voice.name : null }); S.current = u; },
    cancel: () => { S.cancels++; const u = S.current; S.current = null; if (u && u.onerror) u.onerror({ error: 'canceled' }); },
    addEventListener: (n, f) => { (S.listeners[n] = S.listeners[n] || []).push(f); },
    removeEventListener: () => {},
  } });
})();`;
const JA = { name: 'Kyoko', lang: 'ja-JP' }, EN = { name: 'Samantha', lang: 'en-US' };

async function open(voices, { supported = true, width = 390, height = 844 } = {}) {
  state.requests.length = 0; state.saved = [];
  const page = await browser.newPage({ width, height });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK(voices, supported) });
  await page.goto(base + '/jgrammar.html');
  await page.waitFor("!document.getElementById('main').hidden", 8000);
  await page.eval("localStorage.removeItem('jgrammar_furigana')");
  return page;
}
async function analyze(page, sentence) {
  await page.setValue('#sentence', sentence);
  await page.click('#go');
  // 후리가나(rt) 글자가 원문 textContent 에 섞이므로, 새 결과가 그려졌는지는 번역문으로 확인한다
  await page.waitFor(`!document.getElementById('result').hidden && !!document.querySelector('#result .translation') && document.querySelector('#result .translation').textContent === ${JSON.stringify(RESULTS[sentence].translation)}`, 5000);
}
const links = page => page.eval("[...document.querySelectorAll('#result .speak-area [data-speak]')].map(b => b.dataset.speak + ':' + b.textContent)");
const spoken = page => page.eval('window.__speech.spoken');
const cancels = page => page.eval('window.__speech.cancels');
const tap = (page, mode) => page.click(`#result [data-speak="${mode}"]`);

test('링크: 결과 상단에 "듣기"·"천천히"가 보이고, 결과만 보여 줄 뿐 자동으로 읽지 않는다', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, S1);
  assert.deepEqual(await links(page), ['normal:듣기', 'slow:천천히']);
  assert.equal(await page.eval("document.querySelectorAll('#result .speak-area .btn.text').length"), 2, '새 스타일 없이 .btn.text');
  assert.equal(await page.eval("document.querySelector('#result .result-tools').nextElementSibling.classList.contains('source')"), true, '원문 바로 위(근처)');
  await sleep(300);
  assert.deepEqual(await spoken(page), [], '자동 재생 없음');
  await page.close();
});

test('듣기: rate 1.0·lang ja-JP·일본어 음성 선택, ruby 가 유효하면 reading 으로 치환한 텍스트를 읽고 링크는 "멈춤"', { skip: SKIP }, async () => {
  const page = await open([EN, { name: 'KyokoLow', lang: 'ja' }, JA]);
  await analyze(page, S1);
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual(await spoken(page), [{ text: 'わたしはまいあさコーヒーをのみます。', lang: 'ja-JP', rate: 1, voice: 'Kyoko' }]);
  assert.deepEqual(await links(page), ['normal:멈춤', 'slow:천천히'], '읽는 링크만 멈춤');
  assert.equal(await page.eval("document.querySelector('[data-speak=normal]').getAttribute('aria-pressed')"), 'true');
  await page.eval('window.__speech.finish()');   // 끝까지 읽으면 원래대로
  await page.waitFor("document.querySelector('[data-speak=normal]').textContent === '듣기'", 2000);
  assert.deepEqual(await links(page), ['normal:듣기', 'slow:천천히']);
  await page.close();
});

test('천천히: rate 0.7. 읽는 중 같은 링크를 다시 누르면 중지(취소), 다시 안 읽음', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, S1);
  await tap(page, 'slow');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.equal((await spoken(page))[0].rate, 0.7);
  assert.deepEqual(await links(page), ['normal:듣기', 'slow:멈춤']);
  const c0 = await cancels(page);
  await tap(page, 'slow');
  await page.waitFor("document.querySelector('[data-speak=slow]').textContent === '천천히'", 2000);
  assert.ok((await cancels(page)) > c0, 'cancel 호출');
  await sleep(200);
  assert.equal((await spoken(page)).length, 1, '더 읽지 않음');
  await page.close();
});

test('읽는 중 다른 링크를 누르면 지금 읽는 것을 멈추고 새 속도로 읽는다', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, S1);
  await tap(page, 'slow');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  const c0 = await cancels(page);
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 2', 3000);
  assert.ok((await cancels(page)) > c0);
  const s = await spoken(page);
  assert.deepEqual([s[0].rate, s[1].rate], [0.7, 1]);
  assert.deepEqual(await links(page), ['normal:멈춤', 'slow:천천히'], '새로 읽는 링크가 멈춤');
  await page.close();
});

test('후리가나 끄기/켜기와 무관하게 읽을 텍스트는 같다', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, S1);
  await page.click('#result .furi-toggle');   // 끔
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#result .source rt')).display"), 'none');
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.equal((await spoken(page))[0].text, 'わたしはまいあさコーヒーをのみます。');
  await page.close();
});

test('ruby 가 null(검증 실패)이거나 한자 없는 문장이면 원문을 그대로 읽는다', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, '犬が好き');
  assert.equal(await page.count('#result .furi-toggle'), 0, 'ruby 없으면 후리가나 토글 없음');
  assert.deepEqual(await links(page), ['normal:듣기', 'slow:천천히'], '그래도 듣기 링크는 있다');
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.equal((await spoken(page))[0].text, '犬が好き');
  await analyze(page, 'ねこがすき。');
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 2', 3000);
  assert.equal((await spoken(page))[1].text, 'ねこがすき。');
  await page.close();
});

test('정지 조건: 새 문장 분석·저장 항목 열기·입력 채우기·페이지 이탈에서 읽던 것을 멈춘다', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, S1);
  // (1) 새 문장을 분석하면
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  let c = await cancels(page);
  await analyze(page, S2);
  assert.ok((await cancels(page)) > c, '새 분석에서 멈춤');
  assert.deepEqual(await links(page), ['normal:듣기', 'slow:천천히'], '새 결과는 읽는 중이 아님');
  assert.equal((await spoken(page)).length, 1, '새 결과를 자동으로 읽지 않음');
  // (2) 저장 목록에서 다른 항목을 열면
  state.saved = [{ id: 1, sentence: S1, result: RESULTS[S1], created_at: '2026-10-01T00:00:00Z', last_used_at: '2026-10-19T00:00:00Z' }];
  await page.eval("document.getElementById('go').click()");   // 분석 성공 뒤 저장 목록이 새로 불러와진다
  await page.waitFor("document.querySelectorAll('.saved-item').length === 1", 5000);
  await tap(page, 'slow');
  await page.waitFor('window.__speech.spoken.length === 2', 3000);
  c = await cancels(page);
  state.requests.length = 0;
  await page.click('.saved-item .pick');
  await page.waitFor(`document.querySelector('#result .translation').textContent === ${JSON.stringify(RESULTS[S1].translation)}`, 3000);
  assert.ok((await cancels(page)) > c, '저장 항목 열기에서 멈춤');
  assert.deepEqual(state.requests.filter(r => /explain|ocr/.test(r.url)), [], '저장 항목 열기는 AI·서버 호출 없음');
  assert.deepEqual(await links(page), ['normal:듣기', 'slow:천천히']);
  // (3) 입력창을 채워 결과가 지워질 때(사진 인식 후보 선택과 같은 fillInput 경로)
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 3', 3000);
  c = await cancels(page);
  await page.click('.saved-item .pick');   // 같은 항목을 다시 열면 fillInput → 다시 그림
  assert.ok((await cancels(page)) > c);
  // (4) 페이지 이탈(pagehide)
  await tap(page, 'slow');
  await page.waitFor('window.__speech.spoken.length === 4', 3000);
  c = await cancels(page);
  await page.eval("window.dispatchEvent(new Event('pagehide'))");
  assert.ok((await cancels(page)) > c, 'pagehide 에서 멈춤');
  await page.close();
});

test('일본어 음성이 없으면(목록은 있는데 ja 없음) 링크 대신 안내 문구를 보이고 읽지 않는다', { skip: SKIP }, async () => {
  const page = await open([EN, { name: 'Ting', lang: 'zh-CN' }]);
  await analyze(page, S1);
  assert.deepEqual(await links(page), [], '링크 없음');
  assert.equal(await page.text('#result .speak-area .speak-note'), '이 기기에서는 일본어 음성을 지원하지 않습니다');
  assert.equal(await page.visible('#result .speak-area .speak-note'), true);
  assert.equal((await spoken(page)).length, 0);
  await page.close();
});

test('음성 목록이 처음엔 비어 있다가 voiceschanged 로 채워지면: 일본어 음성이 있으면 링크, 없으면 안내로 바뀐다', { skip: SKIP }, async () => {
  const page = await open([]);
  await analyze(page, S1);
  assert.deepEqual(await links(page), ['normal:듣기', 'slow:천천히'], '목록을 모르는 동안은 링크를 둔다');
  await page.eval(`window.__speech.setVoices([${JSON.stringify(EN)}])`);
  await page.waitFor("!!document.querySelector('#result .speak-note')", 2000);
  assert.deepEqual(await links(page), []);
  await page.eval(`window.__speech.setVoices([${JSON.stringify(EN)}, ${JSON.stringify(JA)}])`);
  await page.waitFor("document.querySelectorAll('#result [data-speak]').length === 2", 2000);
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.equal((await spoken(page))[0].voice, 'Kyoko');
  await page.close();
});

test('목록이 비어 있는 채로 링크를 누르면 voiceschanged 를 기다렸다가(최대 1초) 일본어 음성으로 읽는다', { skip: SKIP }, async () => {
  const page = await open([]);
  await analyze(page, S1);
  await tap(page, 'normal');
  await sleep(200);
  assert.equal((await spoken(page)).length, 0, '아직 기다리는 중');
  await page.eval(`window.__speech.setVoices([${JSON.stringify(JA)}])`);
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.equal((await spoken(page))[0].voice, 'Kyoko');
  await page.close();
});

test('speechSynthesis 가 없는 브라우저: 듣기·천천히 링크가 없고(후리가나 토글은 그대로), 오류 없이 동작', { skip: SKIP }, async () => {
  const page = await open([], { supported: false });
  await analyze(page, S1);
  assert.equal(await page.count('#result [data-speak]'), 0);
  assert.equal(await page.count('#result .speak-note'), 0);
  assert.equal(await page.count('#result .furi-toggle'), 1, '후리가나 토글은 그대로');
  await analyze(page, '犬が好き');
  assert.equal(await page.count('#result .result-tools'), 0, '읽어주기도 후리가나도 없으면 도구 줄 자체가 없다');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('HTML 문자열이 들어간 원문은 요소가 되지 않고 글자 그대로 읽는 텍스트가 된다', { skip: SKIP }, async () => {
  const page = await open([JA]);
  const evil = 'あ<img src=x onerror=window.__x=1>';
  await page.setValue('#sentence', evil);
  await page.click('#go');
  await page.waitFor("!document.getElementById('result').hidden", 5000);
  assert.equal(await page.count('#result img'), 0);
  assert.equal(await page.eval('window.__x'), undefined);
  assert.equal(await page.eval("document.querySelector('#result .source').textContent"), evil);
  await tap(page, 'normal');
  await page.waitFor('window.__speech.spoken.length >= 1', 3000);
  assert.equal((await spoken(page)).map(s => s.text).join(''), evil, '글자 그대로 읽음(조각으로 나뉘어도 이어 붙이면 같음)');
  await page.close();
});

test('읽을 텍스트는 서버로 보내지 않는다: 읽는 동안 새 요청이 없고, 읽을 때 쓴 reading 문자열이 어떤 요청 본문에도 없다', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, S1);
  state.requests.length = 0;
  await tap(page, 'normal'); await page.waitFor('window.__speech.spoken.length === 1', 3000);
  await tap(page, 'slow'); await page.waitFor('window.__speech.spoken.length === 2', 3000);
  await tap(page, 'slow');
  await sleep(300);
  assert.deepEqual(state.requests, [], '듣기·천천히·멈춤은 서버 요청을 만들지 않는다');
  assert.ok(!state.requests.some(r => /わたし/.test(r.body)));
  await page.close();
});

test('390px 배치: 링크와 후리가나 토글이 한 줄(토글은 오른쪽 끝), 원문 줄 간격·높이가 어색하게 벌어지지 않고, 가로 스크롤 없음', { skip: SKIP }, async () => {
  const page = await open([JA]);
  await analyze(page, S1);
  const g = await page.eval(`(() => {
    const t = document.querySelector('#result .result-tools').getBoundingClientRect(), tg = document.querySelector('#result .furi-toggle').getBoundingClientRect();
    const a = document.querySelector('#result .speak-area').getBoundingClientRect(), s = document.querySelector('#result .source').getBoundingClientRect(), r = document.getElementById('result').getBoundingClientRect();
    return { toolsH: t.height, toolsTop: t.top, toggleRight: tg.right, resultRight: r.right, areaLeft: a.left, resultLeft: r.left, sourceTop: s.top, toolsBottom: t.bottom, sourceH: s.height };
  })()`);
  assert.ok(g.toolsH <= 48, '도구 줄 한 줄: ' + g.toolsH);
  assert.ok(Math.abs(g.toggleRight - g.resultRight) <= 1, '후리가나 토글은 오른쪽 끝');
  assert.ok(g.areaLeft - g.resultLeft <= 12, '듣기·천천히는 왼쪽');
  assert.ok(g.sourceTop - g.toolsBottom <= 1, '도구 줄 바로 아래에 원문(빈 간격 없음)');
  assert.ok(g.sourceH <= 80, '원문(후리가나 포함) 한 줄 높이: ' + g.sourceH);
  assert.equal(await page.hasHorizontalScroll(), false);
  // 링크 터치 영역
  for (const sel of ['[data-speak=normal]', '[data-speak=slow]']) {
    const r = await page.eval(`(() => { const r = document.querySelector('#result ${sel}').getBoundingClientRect(); return [r.width, r.height]; })()`);
    assert.ok(r[1] >= 44 && r[0] >= 44, sel + ' 44px 이상 ' + r);
  }
  await page.close();
});
