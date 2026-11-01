// 작업S-1: 문장 학습 — 결과 화면에서 뒤로(앱 뒤로 버튼·폰 뒤로 동작)가 홈이 아니라 직전 화면(입력·문장 선택·저장 목록)으로 돌아가고, 첫 화면에서 뒤로는 홈으로 가는지(헤드리스 Chrome 390px).
// 자체 임시 서버(정적 파일 + 모의 API, AI·DB·운영 서버와 무관). "홈"은 기록 바로 앞 칸의 정적 파일(/metis-logo-2.png)로 대신한다.
// 확인: 선택 경로 3가지(직접 입력·사진 인식 문장 고르기·저장 목록) × 언어(일본어·영어·중국어), 폰 뒤로(history.back)와 앱 뒤로 버튼, 새 문장을 다시 분석해도 한 번에 닫힘, 언어를 바꿔 결과가 사라진 뒤 뒤로는 바로 홈
// 실행: node --test tests/ui/jgrammar_back_s1.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const HOME = '/metis-logo-2.png';

const S = { ja: '私は毎朝コーヒーを飲みます。', en: 'She has lived in Seoul since 2020.', zh: '我每天去学校。', en2: 'He runs.', enOcr: 'Hello there.' };
const mk = t => ({ translation: t, grammar: [{ name: '문법', meaning: '뜻', form: '형태', contrast: '차이', level: 'A1', jlpt: 'N5' }] });
const RESULT = { [S.ja]: mk('일본어 번역'), [S.en]: mk('영어 번역'), [S.zh]: mk('중국어 번역'), [S.en2]: mk('영어 번역2'), [S.enOcr]: mk('영어 인식 번역') };
const SAVED = { ja: [S.ja], en: [S.en], 'zh-Hans': [S.zh], 'zh-Hant': [] };

let srv, base, browser;
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
        if (u === '/api/me') return json(200, { id: 1, email: 'u@x', name: '테스터', role: 'user', perm_jgrammar: true });
        if (u === '/api/jgrammar/saved' && req.method === 'GET') {
          const items = (SAVED[url.searchParams.get('lang') || 'ja'] || []).map((s, i) => ({ id: i + 1, sentence: s, result: RESULT[s], created_at: '2026-10-01T00:00:00Z', last_used_at: '2026-10-19T00:00:00Z' }));
          return json(200, { ok: true, items });
        }
        if (u === '/api/jgrammar/explain') { const b = JSON.parse(body || '{}'); const r = RESULT[b.sentence]; return r ? json(200, { ok: true, cached: false, result: r }) : json(422, { ok: false, error: '모의 서버: 준비되지 않은 문장' }); }
        if (u === '/api/jgrammar/ocr') return json(200, { ok: true, sentences: [S.enOcr, S.en2] });
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

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
async function open(lang) {
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', '1'); localStorage.setItem('jgrammar_lang', ${JSON.stringify(lang)}); } } catch (e) {}` });
  await page.goto(base + HOME);               // 홈 대신 기록 바로 앞 칸
  await page.goto(base + '/jgrammar.html');
  await page.waitFor("!document.getElementById('main').hidden", 8000);
  await page.waitFor("document.querySelectorAll('.saved-item').length > 0 || !!document.querySelector('.saved-empty')", 5000);
  return page;
}
const resultShown = page => page.eval("!document.getElementById('result').hidden && !!document.querySelector('#result .translation')");
async function phoneBack(page) { await page.eval('history.back()'); }
async function waitResult(page, translation) {
  await page.waitFor(`!document.getElementById('result').hidden && !!document.querySelector('#result .translation') && document.querySelector('#result .translation').textContent === ${JSON.stringify(translation)}`, 5000);
}
async function waitHome(page) { await page.waitFor(`location.pathname === ${JSON.stringify(HOME)}`, 5000); }
async function waitClosed(page) {
  await page.waitFor("document.getElementById('result').hidden", 3000);
  assert.equal(await page.eval('location.pathname'), '/jgrammar.html', '문장 학습에 머문다(홈으로 가지 않는다)');
}

// 선택 경로 3가지(직접 입력·사진 인식 문장 고르기·저장 목록)
const PATHS = {
  async typed(page, sentence, tr) { await page.setValue('#sentence', sentence); await page.click('#go'); await waitResult(page, tr); return sentence; },
  async photo(page, sentence, tr) {
    await page.eval(`(() => { const dt = new DataTransfer(), b = atob(${JSON.stringify(PNG_1X1)}), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); dt.items.add(new File([a], 'p.png', { type: 'image/png' })); const f = document.getElementById('file-gallery'); f.files = dt.files; f.dispatchEvent(new Event('change')); })()`);
    await page.waitFor("!document.getElementById('picks').hidden && document.querySelectorAll('#picks .pick').length === 2", 5000);
    await page.click('#picks .pick');   // 첫 후보(Hello there.)
    await page.waitFor(`document.getElementById('sentence').value === ${JSON.stringify(sentence)}`, 3000);
    await page.click('#go'); await waitResult(page, tr); return sentence;
  },
  async saved(page, sentence, tr) { await page.click('.saved-item .pick'); await waitResult(page, tr); return sentence; },
};
const CASES = [
  ['ja', 'typed', S.ja, '일본어 번역'], ['ja', 'saved', S.ja, '일본어 번역'],
  ['en', 'typed', S.en, '영어 번역'], ['en', 'photo', S.enOcr, '영어 인식 번역'], ['en', 'saved', S.en, '영어 번역'],
  ['zh-Hans', 'typed', S.zh, '중국어 번역'], ['zh-Hans', 'saved', S.zh, '중국어 번역'],
];
for (const [lang, how, sentence, tr] of CASES) {
  test(`S-1) ${lang} / ${how}: 결과 → 폰 뒤로 → 직전 화면(입력 유지) → 뒤로 → 홈`, { skip: SKIP }, async () => {
    const page = await open(lang);
    const filled = await PATHS[how](page, sentence, tr);
    assert.equal(await resultShown(page), true);
    await phoneBack(page);
    await waitClosed(page);
    assert.equal(await page.eval("document.getElementById('sentence').value"), filled, '입력 내용 유지');
    assert.equal(await page.eval("document.querySelector('[data-lang][aria-pressed=true]').dataset.lang"), lang, '언어 유지');
    assert.equal(await page.eval("!document.getElementById('main').hidden"), true);
    await phoneBack(page);
    await waitHome(page);
    await page.close();
  });
}

test('S-1) 앱 안 뒤로 버튼도 같은 경로: 결과 → 버튼 → 직전 화면, 다시 버튼 → 홈 링크("/"). 결과를 본 적이 없으면 처음부터 홈 링크', { skip: SKIP }, async () => {
  let page = await open('ja');
  await page.setValue('#sentence', S.ja); await page.click('#go'); await waitResult(page, '일본어 번역');
  await page.click('.screen-bar-back');
  await waitClosed(page);
  assert.equal(await page.eval("document.getElementById('sentence').value"), S.ja);
  await page.click('.screen-bar-back');   // 결과가 없으니 링크 그대로(홈 "/")
  await page.waitFor("location.pathname === '/'", 5000);
  await page.close();
  page = await open('ja');   // 결과를 본 적이 없으면 처음부터 링크 그대로
  await page.click('.screen-bar-back');
  await page.waitFor("location.pathname === '/'", 5000);
  await page.close();
});

test('S-1) 새 문장을 다시 분석해도 결과 기록은 한 칸: 뒤로 한 번에 닫히고 두 번째가 홈', { skip: SKIP }, async () => {
  const page = await open('en');
  await page.setValue('#sentence', S.en); await page.click('#go'); await waitResult(page, '영어 번역');
  await page.setValue('#sentence', S.en2); await page.click('#go'); await waitResult(page, '영어 번역2');
  await page.click('.saved-item .pick'); await waitResult(page, '영어 번역');   // 저장 목록에서 다른 결과 열기
  await phoneBack(page); await waitClosed(page);
  await phoneBack(page); await waitHome(page);
  await page.close();
});

test('S-1) 결과가 다른 동작(언어 변경)으로 이미 닫혔으면 뒤로는 바로 홈(기록이 남아 두 번 눌러야 하지 않는다)', { skip: SKIP }, async () => {
  let page = await open('ja');
  await page.setValue('#sentence', S.ja); await page.click('#go'); await waitResult(page, '일본어 번역');
  await page.click('.lang-switch [data-lang=en]');   // 언어를 바꾸면 결과가 사라진다
  await page.waitFor("document.getElementById('result').hidden", 3000);
  await phoneBack(page);
  await waitHome(page);
  await page.close();
  page = await open('ja');
  await page.setValue('#sentence', S.ja); await page.click('#go'); await waitResult(page, '일본어 번역');
  await page.click('.lang-switch [data-lang=en]');
  await page.waitFor("document.getElementById('result').hidden", 3000);
  await page.click('.screen-bar-back');   // 앱 버튼도 같음
  await waitHome(page);
  await page.close();
});
