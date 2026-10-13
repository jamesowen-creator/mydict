// 작업272-4: 순차 검색 보강 — 가장 최근 요청의 결과만 화면에 반영(느린 응답이 먼저/나중에 와도), 낡은 요청은 화면·버튼·재시도 상태를 건드리지 않고
// 단어장 자동 저장은 기존대로(같은 단어 중복 저장만 막음). 40초 시간 초과·[다시 시도]·2차 시간 초과(1차 저장)와의 조합, 일반 검색 입력 무영향.
// /api/ai 와 /api/wordbook 은 페이지 안에서 모의한다(실제 AI 호출 없음). 응답 시간은 단어별로 정한다. 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/ocr_nav_search.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const SETUP = `(() => {
  // delay[word]: 1차 응답 지연(ms), hang1[word]: 1차 무응답, hang2[word]: 2차 무응답, delay2[word]: 2차 지연
  window.__cfg = { delay: {}, delay2: {}, hang1: {}, hang2: {} };
  window.__log = { ai: [], posts: [] };
  const rf = window.fetch.bind(window);
  const wait = (ms, sig) => new Promise((res, rej) => {
    const tm = setTimeout(res, ms);
    if (sig) sig.addEventListener('abort', () => { clearTimeout(tm); rej(new DOMException('aborted', 'AbortError')); });
  });
  window.fetch = async (u, o) => {
    const url = String(u);
    if (url.startsWith('/api/ai')) {
      const prompt = JSON.parse(o.body).prompt;
      const sig = o && o.signal;
      const step2 = prompt.includes('STEP 2');
      const mEn = prompt.match(/For the English word or phrase: "([^"]+)"/), mKo = prompt.match(/For the Korean word or phrase: "([^"]+)"/);
      const m2 = prompt.match(/Word: "([^"]+)"/);
      const word = (mEn || mKo || m2 || [])[1] || 'x';
      window.__log.ai.push([word, step2 ? 2 : 1]);
      const c = window.__cfg;
      if (step2 ? c.hang2[word] : c.hang1[word]) return new Promise((_, rej) => { if (sig) sig.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
      await wait((step2 ? c.delay2[word] : c.delay[word]) || 0, sig);
      let res;
      if (mKo) res = { word, headline: 'h', etymology: '', tone: '', derivatives: [], nuance: '뜻풀이', pos: ['noun'], entries: [] };
      else if (step2) res = { meanings: [{ usage_note: 'u', example: 'e', translation: 't' }], similar: [], collocations: [] };
      else res = { word, search_query: word, pronunciation: '/x/', short_gloss: '뜻', meanings: [{ pos: 'noun', domain: '일반', definition: '뜻-' + word }], derivatives: [] };
      return new Response(JSON.stringify({ result: JSON.stringify(res) }), { status: 200 });
    }
    if (url.startsWith('/api/wordbook')) {
      if (o && o.method === 'POST') {
        const body = JSON.parse(o.body); window.__log.posts.push(body.word);
        await new Promise(r => setTimeout(r, 30));
        return new Response(JSON.stringify({ id: window.__log.posts.length }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }
    return rf(u, o);
  };
})()`;

async function open(t) {
  srv.reset();
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  t.after(() => page.close());
  await page.goto(srv.url + '/english_dictionary.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
  await sleep(300);
  await page.eval("(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()");
  await page.eval(SETUP);
  return page;
}
const cfg = (page, c) => page.eval(`(() => { const x = ${JSON.stringify(c)}; for (const k of Object.keys(x)) Object.assign(window.__cfg[k], x[k]); })(); 0`);
const log = page => page.eval('JSON.parse(JSON.stringify(window.__log))');
const shown = page => page.eval("(() => { const w = document.querySelector('#search-result .result-word'); return w ? w.textContent : null; })()");
const state = page => page.eval(`(() => { const rs = document.getElementById('search-result'); return { shown: (rs.querySelector('.result-word') || {}).textContent || null, spinner: !!rs.querySelector('.spinner'),
  skel: !!rs.querySelector('.skel-block'), btn: document.getElementById('search-btn').disabled, timeoutCard: !!document.getElementById('search-retry-btn'), detailRetry: !!document.getElementById('detail-retry-btn'),
  err: rs.innerText.includes('오류가 발생'), counter: document.getElementById('ocr-nav').hidden ? null : document.getElementById('ocr-nav-counter').textContent, input: document.getElementById('search-input').value,
  pending: typeof _pendingDetail === 'undefined' ? 'n/a' : (_pendingDetail === null ? null : 'set') }; })()`);
const WORDS = ['alpha', 'bravo', 'charlie', 'delta'];
// 첫 단어를 OCR 로 검색한 상태(큐 1/4)를 만든다
async function startQueue(page, words = WORDS) {
  await page.eval(`searchWord(${JSON.stringify(words[0])}, 'en', 'ocr'); setOcrQueue(${JSON.stringify(words)}, 0); 0`);
  await page.waitFor(`document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === ${JSON.stringify(words[0])} && !document.getElementById('search-btn').disabled`, 8000, '첫 단어 결과');
}
const errs = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource|dict-2stage|aborted/.test(e)), [], '콘솔 오류 없음');

test('연속 [다음] 3회: 마지막 요청(delta)이 가장 빨리 끝나고 낡은 요청이 나중에 끝나도 화면은 delta, 버튼 정상, 낡은 단어도 저장은 1번씩', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await startQueue(page);
  await cfg(page, { delay: { bravo: 1500, charlie: 1000, delta: 200 } });
  await page.eval('ocrNavGo(1); ocrNavGo(1); ocrNavGo(1); 0');
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'delta'", 4000, 'delta 표시');
  await sleep(2200);                                                     // 느린 낡은 응답(charlie 1.0s, bravo 1.5s)이 모두 끝난 뒤
  const s = await state(page);
  assert.equal(s.shown, 'delta', '낡은 응답이 화면을 덮어쓰지 않음'); assert.equal(s.counter, '4 / 4'); assert.equal(s.input, 'delta');
  assert.equal(s.btn, false); assert.equal(s.spinner, false);
  const L = await log(page);
  assert.deepEqual([...L.posts].sort(), ['alpha', 'bravo', 'charlie', 'delta'], '낡은 요청의 자동 저장도 기존대로(단어마다 1번)');
  errs(page);
});

test('연속 [다음] 3회: 낡은 응답이 먼저 와도(bravo 200ms, charlie 600ms, delta 1200ms) 최근 요청이 올 때까지 이전 단어를 보여 주지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await startQueue(page);
  await cfg(page, { delay: { bravo: 200, charlie: 600, delta: 1200 } });
  await page.eval('ocrNavGo(1); ocrNavGo(1); ocrNavGo(1); 0');
  await sleep(900);                                                      // bravo·charlie 는 이미 응답했지만 낡은 요청
  let s = await state(page);
  assert.equal(s.shown, null, '낡은 단어(bravo/charlie)를 보여 주지 않음'); assert.equal(s.spinner, true, '최근 요청이 끝날 때까지 로딩'); assert.equal(s.btn, true);
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'delta' && !document.getElementById('search-btn').disabled", 5000, 'delta 표시·검색 완료');
  s = await state(page);
  assert.equal(s.btn, false); assert.equal(s.counter, '4 / 4');
  assert.deepEqual([...(await log(page)).posts].sort(), ['alpha', 'bravo', 'charlie', 'delta']);
  errs(page);
});

test('실제 클릭으로 [다음]을 빠르게 눌러도 마지막 요청만 반영', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await startQueue(page);
  await cfg(page, { delay: { bravo: 900, charlie: 500, delta: 100 } });
  await page.click('#ocr-nav-next'); await page.click('#ocr-nav-next'); await page.click('#ocr-nav-next');
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'delta'", 5000);
  await sleep(1200);
  assert.equal(await shown(page), 'delta');
  assert.equal((await state(page)).btn, false);
  errs(page);
});

test('시간 초과 조합: 낡은 요청의 시간 초과 카드는 최근 결과를 덮어쓰지 않고, 최근 요청이 시간 초과면 [다시 시도]로 정상 표시', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await page.eval('window.__AI_TIMEOUT_MS = 700; 0');
  await startQueue(page);
  await cfg(page, { hang1: { bravo: true }, delay: { charlie: 100 } });
  await page.eval('ocrNavGo(1); 0');                                      // bravo: 무응답 → 곧 낡은 요청이 된다
  await sleep(150);
  await page.eval('ocrNavGo(1); 0');                                      // charlie: 빠름
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'charlie'", 3000);
  await sleep(1200);                                                     // bravo 의 시간 초과가 지난 뒤
  let s = await state(page);
  assert.equal(s.shown, 'charlie', '낡은 요청의 시간 초과 카드가 덮어쓰지 않음'); assert.equal(s.timeoutCard, false); assert.equal(s.btn, false);
  // 이제 bravo 로 되돌아가서(최근 요청) 시간 초과 → 카드 + 다시 시도
  await page.eval('ocrNavGo(-1); 0');
  await page.waitFor("!!document.getElementById('search-retry-btn')", 4000, '시간 초과 카드');
  s = await state(page);
  assert.equal(s.btn, false); assert.equal(s.spinner, false);
  await cfg(page, { hang1: { bravo: false }, delay: { bravo: 50 } });
  await page.click('#search-retry-btn');
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'bravo'", 4000);
  assert.equal((await state(page)).counter, '2 / 4', '재시도해도 n/N 큐 유지');
  assert.equal((await log(page)).posts.filter(w => w === 'bravo').length, 1, 'bravo 는 한 번만 저장');
  errs(page);
});

test('2차 시간 초과 조합: 낡은 요청의 2차 시간 초과는 재시도 대기·안내를 만들지 않지만 1차 저장은 기존대로, 최근 요청의 2차 시간 초과는 안내·재시도 정상', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await page.eval('window.__AI_TIMEOUT_MS = 700; 0');
  await startQueue(page);
  await cfg(page, { hang2: { bravo: true }, delay: { charlie: 100 } });
  await page.eval('ocrNavGo(1); 0');                                      // bravo: 1차 즉시, 2차 무응답
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'bravo'", 3000, 'bravo 1차 표시');
  await page.eval('ocrNavGo(1); 0');                                      // 2차를 기다리는 사이 charlie 로 이동 → bravo 는 낡은 요청
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'charlie'", 3000);
  await sleep(1300);                                                     // bravo 2차 시간 초과 이후
  let s = await state(page);
  assert.equal(s.shown, 'charlie'); assert.equal(s.detailRetry, false, '낡은 요청이 다시 시도 안내를 만들지 않음'); assert.equal(s.pending, null, '재시도 대기 상태도 없음');
  assert.equal((await log(page)).posts.filter(w => w === 'bravo').length, 1, '낡은 요청의 1차 저장은 기존대로 한 번');
  // 최근 요청의 2차 시간 초과
  await cfg(page, { hang2: { delta: true } });
  await page.eval('ocrNavGo(1); 0');
  await page.waitFor("!!document.getElementById('detail-retry-btn')", 4000, '2차 안내');
  s = await state(page);
  assert.equal(s.shown, 'delta'); assert.equal(s.pending, 'set');
  assert.equal((await log(page)).posts.filter(w => w === 'delta').length, 1, '1차 저장(B방식)');
  await cfg(page, { hang2: { delta: false } });
  await page.click('#detail-retry-btn');
  await page.waitFor("!document.getElementById('detail-retry-btn') && !document.querySelector('#search-result .skel-block')", 4000);
  assert.equal((await log(page)).posts.filter(w => w === 'delta').length, 1, '재시도 성공 뒤에도 재저장 없음');
  errs(page);
});

test('캐시(단어장) 적중으로 끝나는 검색 뒤에도 검색 버튼이 잠긴 채 남지 않는다(앞선 느린 요청이 낡은 요청이 되어도)', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await page.eval("wordbook.push({ id: 99, word: 'cachedword', lang: 'en', meanings: [{ pos: 'noun', definition: '뜻' }], derivatives: [], similar: [], collocations: [], short_gloss: '뜻', pronunciation: '/c/', savedAt: Date.now(), source: 'manual' }); 0");
  await startQueue(page, ['alpha', 'slowword', 'cachedword']);
  await cfg(page, { delay: { slowword: 1200 } });
  await page.eval('ocrNavGo(1); 0');                                      // slowword: 느림, 버튼 잠김
  await sleep(150);
  assert.equal((await state(page)).btn, true);
  await page.eval('ocrNavGo(1); 0');                                      // cachedword: 즉시 표시
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'cachedword'", 2000);
  assert.equal((await state(page)).btn, false, '캐시 적중 경로가 버튼을 되돌림');
  await sleep(1500);                                                     // slowword 는 낡은 요청으로 끝남
  const s = await state(page);
  assert.equal(s.shown, 'cachedword'); assert.equal(s.btn, false);
  assert.ok((await log(page)).posts.includes('slowword'), '낡은 요청도 저장은 기존대로');
  errs(page);
});

test('같은 단어를 두 요청이 동시에 끝내도 저장은 한 번(다음→이전을 빠르게)', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await startQueue(page, ['alpha', 'bravo']);
  await cfg(page, { delay: { bravo: 800 } });
  await page.eval('ocrNavGo(1); 0');                                      // bravo 요청 1
  await sleep(100);
  await page.eval('ocrNavGo(-1); ocrNavGo(1); 0');                        // alpha(캐시) → 다시 bravo 요청 2(요청 1 이 아직 진행 중)
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'bravo'", 4000);
  await sleep(1200);
  assert.equal((await log(page)).posts.filter(w => w === 'bravo').length, 1, 'bravo 저장 1번');
  assert.equal(await page.eval("wordbook.filter(w => w.word === 'bravo').length"), 1);
  errs(page);
});

test('한국어 검색의 낡은 요청도 최근 영어 결과를 덮어쓰지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await cfg(page, { delay: { '사과': 1000, apple: 100 } });
  await page.eval("document.getElementById('search-input').value = '사과'; doSearch(); 0");
  await sleep(150);
  await page.eval("document.getElementById('search-input').value = 'apple'; doSearch(); 0");
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'apple'", 4000);
  await sleep(1400);                                                     // 한국어 요청이 낡은 요청으로 끝난 뒤
  const s = await state(page);
  assert.equal(s.shown, 'apple'); assert.equal(s.btn, false);
  assert.ok((await log(page)).posts.includes('사과'), '낡은 한국어 요청의 저장도 기존대로');
  errs(page);
});

test('일반 검색 입력(칩 큐 없음) 무영향: Enter 로 연속 검색해도 정상, n/N 없음, 같은 요청을 두 번 눌러도 마지막만', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await open(t);
  await cfg(page, { delay: { apple: 200, pear: 100 } });
  await page.eval("document.getElementById('search-input').value = 'apple'; doSearch(); 0");
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'apple' && !document.getElementById('search-btn').disabled", 4000, 'apple 검색 완료');
  let s = await state(page);
  assert.equal(s.counter, null, '큐 없음'); assert.equal(s.btn, false);
  // 연속 입력: 같은 단어를 빠르게 두 번 + 다른 단어
  await page.eval("document.getElementById('search-input').value = 'pear'; doSearch(); doSearch(); 0");
  await page.waitFor("document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'pear' && !document.getElementById('search-btn').disabled", 4000, 'pear 검색 완료');
  await sleep(300);
  s = await state(page);
  assert.equal(s.shown, 'pear'); assert.equal(s.btn, false); assert.equal(s.counter, null);
  assert.equal((await log(page)).posts.filter(w => w === 'pear').length, 1, '같은 단어 두 번 요청해도 저장은 한 번');
  errs(page);
});
