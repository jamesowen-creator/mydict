// 작업313: 문장 학습 — 언어 선택(일본어·영어) 화면 시험(헤드리스 Chrome 390px). 자체 임시 서버(정적 파일 + 모의 API, AI·DB·운영 서버와 무관). speechSynthesis 는 페이지 안에서 가짜로 대체한다.
// 확인: 제목·언어 선택 링크(박스 없음)·기본 일본어·선택 기억(localStorage 실패 포함)·언어 변경 시 초기화와 읽기 정지·영어 화면(후리가나 숨김·CEFR·안내문)·읽어주기 lang·
//       저장 목록 언어별 전환(열기는 AI 호출 없음)·입력 검증·사진 입력의 lang·가로 스크롤 없음
// 실행: node --test tests/ui/jgrammar_lang.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const JA = '私は毎朝コーヒーを飲みます。';
const EN = 'She has lived in Seoul since 2020.';
const RESULTS = {
  ja: { [JA]: { translation: '나는 매일 아침 커피를 마십니다', grammar: [{ name: '〜を', meaning: '목적격 조사', form: '飲みます', contrast: '「が」와 다름', jlpt: 'N5' }],
    ruby: [{ text: '私', reading: 'わたし' }, { text: 'は' }, { text: '毎朝', reading: 'まいあさ' }, { text: 'コーヒー' }, { text: 'を' }, { text: '飲', reading: 'の' }, { text: 'みます。' }] } },
  en: { [EN]: { translation: '그녀는 2020년부터 서울에 살고 있다', grammar: [
    { name: '현재완료(계속)', meaning: '과거부터 지금까지 이어지는 상태', form: 'has lived', contrast: '단순 과거와 다름', level: 'B1' },
    { name: '전치사 since', meaning: '시작 시점', form: 'since 2020', contrast: 'for 와 다름', level: null }] } },
};
const SAVED = {
  ja: [{ id: 1, sentence: JA, result: RESULTS.ja[JA], created_at: '2026-10-01T00:00:00Z', last_used_at: '2026-10-19T00:00:00Z' }],
  en: [{ id: 7, sentence: EN, result: RESULTS.en[EN], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-20T00:00:00Z' },
       { id: 8, sentence: 'He runs.', result: { translation: '그는 달린다', grammar: [{ name: '3인칭 단수', meaning: '-s', form: 'runs', contrast: '복수와 다름', level: 'A1' }] }, created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-18T00:00:00Z' }],
};
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let srv, base, browser;
const state = { requests: [] };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        state.requests.push({ method: req.method, url: u, query: url.search, body });
        if (u === '/api/me') return json(200, { id: 1, email: 'u@x', name: '테스터', role: 'user', perm_jgrammar: true });
        if (u === '/api/jgrammar/saved' && req.method === 'GET') return json(200, { ok: true, items: SAVED[url.searchParams.get('lang') || 'ja'] || [] });
        if (u === '/api/jgrammar/explain') {
          const b = JSON.parse(body || '{}');
          const r = (RESULTS[b.lang] || {})[b.sentence];
          return r ? json(200, { ok: true, cached: false, result: r }) : json(422, { ok: false, error: '모의 서버: 준비되지 않은 문장' });
        }
        if (u === '/api/jgrammar/ocr') return json(200, { ok: true, sentences: url.searchParams.get('lang') === 'en' ? ['Hello there.', 'Nice to meet you.'] : ['こんにちは。'] });
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

const MOCK = (voices) => `(() => {
  const S = window.__speech = { spoken: [], cancels: 0, voices: ${JSON.stringify(voices)}, current: null, listeners: {} };
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => S.voices.slice(),
    speak: u => { S.spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice ? u.voice.name : null }); S.current = u; },
    cancel: () => { S.cancels++; const u = S.current; S.current = null; if (u && u.onerror) u.onerror({ error: 'canceled' }); },
    addEventListener: (n, f) => { (S.listeners[n] = S.listeners[n] || []).push(f); },
    removeEventListener: () => {},
  } });
})();`;
const V = { jaJP: { name: 'Kyoko', lang: 'ja-JP' }, enGB: { name: 'Daniel', lang: 'en-GB' }, enUS: { name: 'Samantha', lang: 'en-US' }, zh: { name: 'Ting', lang: 'zh-CN' } };

async function open({ stored, voices = [V.jaJP, V.enGB, V.enUS], breakStorage = false, width = 390 } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height: 844 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK(voices) });
  if (breakStorage) {   // localStorage 읽기·쓰기가 예외를 던지는 환경(단, 로그인 토큰은 페이지가 쓰기 전에 심어 두므로 별도 처리)
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem, s = Storage.prototype.setItem; Storage.prototype.getItem = function (k) { if (k === 'jgrammar_lang' || k === 'jgrammar_furigana') throw new Error('blocked'); return g.call(this, k); }; Storage.prototype.setItem = function (k, v) { if (k === 'jgrammar_lang' || k === 'jgrammar_furigana') throw new Error('blocked'); return s.call(this, k, v); }; })();` });
  }
  if (stored) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('jgrammar_lang', ${JSON.stringify(stored)}); } catch (e) {}` });
  await page.goto(base + '/jgrammar.html');
  await page.waitFor("!document.getElementById('main').hidden", 8000);
  await page.waitFor("document.querySelectorAll('.saved-item').length > 0", 5000);
  return page;
}
const pressed = page => page.eval("[...document.querySelectorAll('.lang-switch [data-lang]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.lang)");
async function analyze(page, sentence, translation) {
  await page.setValue('#sentence', sentence);
  await page.click('#go');
  await page.waitFor(`!document.getElementById('result').hidden && !!document.querySelector('#result .translation') && document.querySelector('#result .translation').textContent === ${JSON.stringify(translation)}`, 5000);
}
const savedTexts = page => page.eval("[...document.querySelectorAll('.saved-item .pick')].map(b => b.firstChild.textContent)");
const spoken = page => page.eval('window.__speech.spoken');
const cancels = page => page.eval('window.__speech.cancels');
const aiRequests = () => state.requests.filter(r => /explain|ocr/.test(r.url));

test('이름·언어 선택: 제목과 화면 제목이 "문장 학습", "일본어 · 영어" 텍스트 링크(박스 없음), 기본은 일본어', { skip: SKIP }, async () => {
  const page = await open();
  assert.equal(await page.eval('document.title'), '문장 학습');
  assert.equal(await page.text('.screen-bar-title'), '문장 학습');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.lang-switch [data-lang]')].map(b => b.textContent + ':' + b.className)"), ['일본어:btn text', '영어:btn text'], '기존 .btn.text 링크 스타일');
  assert.match(await page.eval("document.querySelector('.lang-switch').textContent.replace(/\\s+/g, '')"), /^일본어·영어$/);
  assert.deepEqual(await pressed(page), ['ja'], '기본은 일본어');
  const st = await page.eval(`(() => { const [a, b] = [...document.querySelectorAll('.lang-switch .btn.text')].map(x => { const c = getComputedStyle(x); return { w: c.fontWeight, bg: c.backgroundColor, bd: c.borderTopWidth, dec: c.textDecorationLine, h: x.getBoundingClientRect().height, wd: x.getBoundingClientRect().width }; }); return { a, b }; })()`);
  assert.equal(st.a.bd, '0px'); assert.equal(st.b.bd, '0px'); assert.equal(st.a.bg, 'rgba(0, 0, 0, 0)', '박스(배경) 없음');
  assert.ok(Number(st.a.w) > Number(st.b.w), '선택된 항목이 더 진하다');
  assert.ok(st.a.h >= 44 && st.b.h >= 44 && st.a.wd >= 44 && st.b.wd >= 44, '터치 영역 44px 이상');
  const ja = await page.eval("({ lang: document.getElementById('sentence').lang, max: document.getElementById('sentence').maxLength, ph: document.getElementById('sentence').placeholder, count: document.getElementById('count').textContent })");
  assert.deepEqual(ja, { lang: 'ja', max: 200, ph: '例: 私は毎日学校に行きます。', count: '0 / 200' });
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
});

test('언어 선택 기억: 영어를 고르면 새로 열어도 영어(안내·placeholder·300자·저장 목록 lang=en), 저장소가 막혀 있으면 기본 일본어로 동작', { skip: SKIP }, async () => {
  let page = await open();
  await page.click('.lang-switch [data-lang=en]');
  assert.deepEqual(await pressed(page), ['en']);
  assert.equal(await page.eval("localStorage.getItem('jgrammar_lang')"), 'en');
  await page.close();
  page = await open();   // 같은 브라우저(저장소 유지)에서 다시 열기
  assert.deepEqual(await pressed(page), ['en'], '기억한 선택');
  const en = await page.eval("({ lang: document.getElementById('sentence').lang, max: document.getElementById('sentence').maxLength, ph: document.getElementById('sentence').placeholder, count: document.getElementById('count').textContent, aria: document.getElementById('sentence').getAttribute('aria-label'), lead: document.getElementById('lead').textContent })");
  assert.equal(en.lang, 'en'); assert.equal(en.max, 300); assert.equal(en.count, '0 / 300'); assert.equal(en.aria, '영어 문장');
  assert.match(en.ph, /^e\.g\. /); assert.match(en.lead, /^영어 문장을 입력하면/);
  assert.ok(state.requests.some(r => r.url === '/api/jgrammar/saved' && r.query === '?lang=en'), '저장 목록은 영어 것을 요청');
  assert.ok(!state.requests.some(r => r.url === '/api/jgrammar/saved' && r.query === '?lang=ja'));
  assert.deepEqual(await savedTexts(page), [EN, 'He runs.']);
  await page.eval("localStorage.setItem('jgrammar_lang', 'zh-Hans')");   // 알 수 없는 저장값은 무시
  await page.close();
  page = await open();
  assert.deepEqual(await pressed(page), ['ja'], '알 수 없는 저장값은 일본어');
  await page.eval("localStorage.removeItem('jgrammar_lang')");
  await page.close();
  page = await open({ breakStorage: true });
  assert.deepEqual(await pressed(page), ['ja']);
  await page.click('.lang-switch [data-lang=en]');   // 저장은 실패해도 화면은 바뀐다
  assert.deepEqual(await pressed(page), ['en']);
  assert.equal(await page.eval("document.getElementById('sentence').maxLength"), 300);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '예외 없음');
  await page.close();
});

test('언어를 바꾸면 입력창·결과·메시지를 비우고 읽는 중이면 정지하며, 저장 목록을 그 언어 것으로 다시 불러온다', { skip: SKIP }, async () => {
  const page = await open({ stored: 'ja' });
  await analyze(page, JA, RESULTS.ja[JA].translation);
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  const c0 = await cancels(page);
  for (let i = 0; i < 50 && state.requests.filter(r => r.url === '/api/jgrammar/saved').length < 2; i++) await sleep(100);   // 분석 뒤 목록 재요청이 끝난 다음에 기록을 비운다(부하가 큰 전체 실행에서 늦게 도착하는 경우 대비)
  await sleep(150);
  await page.eval("document.getElementById('msg').textContent = '이전 메시지'");
  state.requests.length = 0;
  await page.click('.lang-switch [data-lang=en]');
  assert.ok((await cancels(page)) > c0, '읽기 정지(speechSynthesis.cancel)');
  assert.equal(await page.eval("document.getElementById('result').hidden"), true);
  assert.equal(await page.eval("document.getElementById('result').textContent"), '');
  assert.equal(await page.eval("document.getElementById('sentence').value"), '');
  assert.equal(await page.eval("document.getElementById('count').textContent"), '0 / 300');
  assert.equal(await page.eval("document.getElementById('msg').textContent"), '');
  assert.equal(await page.eval("document.getElementById('picks').hidden"), true);
  await page.waitFor("document.querySelector('.saved-item .pick') && document.querySelector('.saved-item .pick').firstChild.textContent === " + JSON.stringify(EN), 4000);
  assert.deepEqual(await savedTexts(page), [EN, 'He runs.']);
  assert.deepEqual(state.requests.map(r => r.url + r.query), ['/api/jgrammar/saved?lang=en'], '언어 변경은 저장 목록만 다시 불러오고 AI 는 부르지 않는다');
  await page.click('.lang-switch [data-lang=ja]');
  await page.waitFor("document.querySelector('.saved-item .pick').firstChild.textContent === " + JSON.stringify(JA), 4000);
  assert.deepEqual(await savedTexts(page), [JA]);
  assert.equal(await page.eval("document.getElementById('sentence').maxLength"), 200);
  await page.close();
});

test('영어 분석 화면: lang=en 으로 요청, 원문은 후리가나 없이, 후리가나 줄·링크 없음, CEFR 표기(null 은 생략), 안내문 "AI가 생성한 설명이라 틀릴 수 있습니다"', { skip: SKIP }, async () => {
  const page = await open({ stored: 'en' });
  state.requests.length = 0;
  await analyze(page, EN, RESULTS.en[EN].translation);
  const ex = state.requests.find(r => r.url === '/api/jgrammar/explain');
  assert.deepEqual(JSON.parse(ex.body), { sentence: EN, lang: 'en' });
  assert.equal(await page.eval("document.querySelector('#result .source').textContent"), EN, '원문 표시');
  assert.equal(await page.eval("document.querySelector('#result .source').lang"), 'en');
  assert.equal(await page.count('#result rt'), 0); assert.equal(await page.count('#result ruby'), 0);
  assert.equal(await page.count('#result .furi-toggle'), 0, '후리가나 끄기/켜기 링크 없음');
  assert.ok(!/후리가나/.test(await page.eval("document.getElementById('result').textContent")));
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#result .g-head')].map(h => h.textContent)"), ['현재완료(계속)CEFR B1', '전치사 since'], 'null 레벨은 생략');
  assert.equal(await page.text('#result .disclaimer'), 'AI가 생성한 설명이라 틀릴 수 있습니다');
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
});

test('일본어 화면은 그대로: JLPT 표기·후리가나 줄·토글·기존 안내문', { skip: SKIP }, async () => {
  const page = await open({ stored: 'ja' });
  await analyze(page, JA, RESULTS.ja[JA].translation);
  assert.equal(await page.text('#result .g-level'), 'JLPT N5');
  assert.equal(await page.count('#result .source rt'), 3);
  assert.equal(await page.count('#result .furi-toggle'), 1);
  assert.equal(await page.eval("document.querySelector('#result .source').lang"), 'ja');
  assert.equal(await page.text('#result .disclaimer'), 'AI가 생성한 설명과 읽기라 틀릴 수 있습니다');
  await page.close();
});

test('읽어주기 lang: 영어는 en-US 음성을 우선 골라 원문 그대로(속도 1.0·0.7), 일본어는 ja-JP + ruby 치환 그대로. 음성이 없으면 언어 이름이 들어간 안내', { skip: SKIP }, async () => {
  let page = await open({ stored: 'en' });
  await analyze(page, EN, RESULTS.en[EN].translation);
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual((await spoken(page))[0], { text: EN, lang: 'en-US', rate: 1, voice: 'Samantha' });
  await page.click('#result [data-speak=slow]');
  await page.waitFor('window.__speech.spoken.length === 2', 3000);
  assert.deepEqual([(await spoken(page))[1].rate, (await spoken(page))[1].lang, (await spoken(page))[1].voice], [0.7, 'en-US', 'Samantha']);
  await page.close();
  page = await open({ stored: 'en', voices: [V.jaJP, V.enGB] });   // en-US 가 없으면 en 으로 시작하는 다른 음성
  await analyze(page, EN, RESULTS.en[EN].translation);
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual([(await spoken(page))[0].voice, (await spoken(page))[0].lang], ['Daniel', 'en-GB']);
  await page.close();
  page = await open({ stored: 'en', voices: [V.jaJP, V.zh] });
  await analyze(page, EN, RESULTS.en[EN].translation);
  assert.equal(await page.count('#result [data-speak]'), 0);
  assert.equal(await page.text('#result .speak-note'), '이 기기에서는 영어 음성을 지원하지 않습니다');
  await page.close();
  page = await open({ stored: 'ja' });
  await analyze(page, JA, RESULTS.ja[JA].translation);
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual((await spoken(page))[0], { text: 'わたしはまいあさコーヒーをのみます。', lang: 'ja-JP', rate: 1, voice: 'Kyoko' });
  await page.close();
  page = await open({ stored: 'ja', voices: [V.enUS] });
  await analyze(page, JA, RESULTS.ja[JA].translation);
  assert.equal(await page.text('#result .speak-note'), '이 기기에서는 일본어 음성을 지원하지 않습니다');
  await page.close();
});

test('입력 검증(영어): 로마자가 없거나 한글·가나가 더 많으면 서버를 부르지 않고 안내, 300자 경계, 일본어 안내는 그대로', { skip: SKIP }, async () => {
  const page = await open({ stored: 'en' });
  state.requests.length = 0;
  for (const bad of ['안녕하세요', '私は学生です', '12345']) {
    await page.setValue('#sentence', bad); await page.click('#go');
    assert.equal(await page.text('#msg'), '선택한 언어(영어)의 문장이 아닙니다. 영어 문장을 입력해 주세요.', bad);
  }
  await page.setValue('#sentence', '   '); await page.click('#go');
  assert.equal(await page.text('#msg'), '영어 문장을 입력해 주세요.');
  assert.equal(await page.eval("(() => { const t = document.getElementById('sentence'); t.value = 'a'.repeat(301); return t.value.length; })()"), 301, 'JS 로 넣은 301자');
  await page.click('#go');
  assert.equal(await page.text('#msg'), '문장은 300자까지 입력할 수 있습니다.');
  assert.deepEqual(aiRequests(), [], '서버(AI) 호출 없음');
  await page.click('.lang-switch [data-lang=ja]');
  await page.setValue('#sentence', 'Hello world'); await page.click('#go');
  assert.equal(await page.text('#msg'), '일본어 문장(히라가나·가타카나·한자)을 입력해 주세요.');
  assert.deepEqual(aiRequests(), []);
  await page.close();
});

test('저장 목록: 영어 항목을 열면 AI·서버 호출 없이 저장된 결과를 표시(CEFR), 삭제는 확인 후 현재 언어 목록을 다시 불러온다', { skip: SKIP }, async () => {
  const page = await open({ stored: 'en' });
  state.requests.length = 0;
  await page.click('.saved-item .pick');
  await page.waitFor(`document.querySelector('#result .translation') && document.querySelector('#result .translation').textContent === ${JSON.stringify(RESULTS.en[EN].translation)}`, 3000);
  assert.deepEqual(aiRequests(), [], '열기는 AI 를 부르지 않는다');
  assert.equal(await page.eval("document.getElementById('sentence').value"), EN);
  assert.equal(await page.count('#result .furi-toggle'), 0);
  assert.equal(await page.text('#result .g-level'), 'CEFR B1');
  await page.eval("window.metisConfirm = () => Promise.resolve(true)");
  state.requests.length = 0;
  await page.click('.saved-item .btn.text');
  await sleep(300);
  assert.ok(state.requests.some(r => r.method === 'DELETE' && r.url === '/api/jgrammar/saved/7'), '삭제 요청');
  assert.ok(state.requests.some(r => r.url === '/api/jgrammar/saved' && r.query === '?lang=en'));
  await page.close();
});

test('사진 입력: 선택한 언어를 서버로 보낸다(영어 ?lang=en, 일본어 ?lang=ja). 여러 문장이면 하나를 눌러 입력창에 채운다(분석 요청 없음)', { skip: SKIP }, async () => {
  const page = await open({ stored: 'en' });
  const shoot = `(() => { const b = Uint8Array.from(atob('${PNG_1X1}'), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([b], 'a.png', { type: 'image/png' })); const f = document.getElementById('file-gallery'); f.files = dt.files; f.dispatchEvent(new Event('change')); })()`;
  state.requests.length = 0;
  await page.eval(shoot);
  await page.waitFor("document.querySelectorAll('#picks .pick').length === 2", 6000);
  const ocr = state.requests.find(r => r.url === '/api/jgrammar/ocr');
  assert.equal(ocr.query, '?lang=en');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#picks .pick')].map(b => b.textContent)"), ['Hello there.', 'Nice to meet you.']);
  await page.click('#picks .pick');
  assert.equal(await page.eval("document.getElementById('sentence').value"), 'Hello there.');
  assert.equal(state.requests.filter(r => r.url === '/api/jgrammar/explain').length, 0, '인식 후 바로 분석하지 않는다');
  await page.click('.lang-switch [data-lang=ja]');
  state.requests.length = 0;
  await page.eval(shoot);
  await page.waitFor("document.getElementById('sentence').value === 'こんにちは。'", 6000);
  assert.equal(state.requests.find(r => r.url === '/api/jgrammar/ocr').query, '?lang=ja');
  await page.close();
});

test('390px: 영어 화면도 가로 스크롤이 없고, innerHTML 을 쓰지 않으며 HTML 문자열 원문은 글자 그대로 표시된다', { skip: SKIP }, async () => {
  const html = fs.readFileSync(path.join(PUB, 'jgrammar.html'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html.replace(/\/\/[^\n]*/g, '')));
  const page = await open({ stored: 'en' });
  const evil = 'Hi <img src=x onerror=window.__x=1>';
  RESULTS.en[evil] = { translation: 'x', grammar: [{ name: 'n', meaning: 'm', form: 'f', contrast: 'c', level: null }] };
  await page.setValue('#sentence', evil); await page.click('#go');
  await page.waitFor("!document.getElementById('result').hidden", 5000);
  assert.equal(await page.count('#result img'), 0);
  assert.equal(await page.eval('window.__x'), undefined);
  assert.equal(await page.eval("document.querySelector('#result .source').textContent"), evil);
  assert.equal(await page.hasHorizontalScroll(), false);
  delete RESULTS.en[evil];
  await page.close();
});
