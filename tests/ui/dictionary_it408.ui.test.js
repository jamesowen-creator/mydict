// 작업408: 사전 결과(영어·한국어)의 "IT 용어" 버튼. 자체 임시 서버(정적 파일 + 가짜 /api/me·/api/wordbook·/api/ai). 실제 AI·DB·운영 서버와 무관.
// 확인: 세 버튼 한 줄·같은 폭·44px 이상·가로 스크롤 없음·이모지 없음·radius 10px / 클릭 1회 = AI 1회 + 저장(PATCH) 1회, 표시 순서 /
//       재클릭 0회 / 저장된 설명 0회 / 진행 중 연타 1회 / 429·형식 오류·is_it=false·sure=false·저장 실패 표시 / 한국어는 대응 영어 표현을 프롬프트에 담음
// 실행: node --test tests/ui/dictionary_it408.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const GOOD = { is_it: true, one_line: '자주 쓰는 데이터를 가까이 두는 저장소', situations: ['웹사이트가 느릴 때 같은 그림을 매번 새로 받지 않도록 둔다', '개발자가 화면을 빨리 열려고 쓴다'], origin: { text: '프랑스어로 숨긴다는 말에서 왔다는 설명이 흔하다', sure: true }, compare: { term: 'buffer', diff: '버퍼는 잠깐 쌓아 두는 곳' } };
let srv, base, browser;
const state = { ai: [], patches: [], aiPlan: [], patchStatus: 200, rows: [] };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        if (u === '/api/me') return json(200, { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true });
        if (u === '/api/wordbook' && req.method === 'GET') return json(200, state.rows);
        let m;
        if ((m = /^\/api\/wordbook\/(\d+)\/it$/.exec(u)) && req.method === 'PATCH') { state.patches.push({ id: Number(m[1]), auth: req.headers.authorization, body }); return json(state.patchStatus, state.patchStatus === 200 ? { ok: true } : { error: '실패' }); }
        if (u === '/api/ai') {
          state.ai.push({ auth: req.headers.authorization, prompt: body && body.prompt });
          const p = state.aiPlan.shift() || { text: JSON.stringify(GOOD) };
          const send = () => (p.status ? json(p.status, p.body || { error: '모의 오류' }) : json(200, { result: p.text }));
          return p.delay ? setTimeout(send, p.delay) : send();
        }
        json(200, req.method === 'GET' ? [] : {});
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

const EN = { word: 'cache', lang: 'en', short_meaning: '캐시', pronunciation: '/kæʃ/', meanings: [{ pos: 'noun', definition: '캐시, 은닉처' }], derivatives: [] };
const KO = { word: '스레드', lang: 'ko', short_meaning: '실', nuance: '실', entries: [{ english: 'thread', pos: ['noun'], meaning: '실' }, { english: 'strand', pos: ['noun'], meaning: '가닥' }], derivatives: [] };
const row = (id, data) => ({ id, word: data.word, lang: data.lang, data, created_at: new Date().toISOString(), source: 'manual' });

async function open({ width = 390, rows = [], kind = 'en' } = {}) {
  state.ai.length = 0; state.patches.length = 0; state.aiPlan.length = 0; state.patchStatus = 200; state.rows = rows;
  const page = await browser.newPage({ width, height: 900, token: 'x' });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('mydict_token', ${JSON.stringify(TOKEN)}); } catch (e) {}` });
  await page.goto(base + '/english_dictionary.html');
  await page.waitFor("typeof loadITTerm === 'function' && typeof wordbook !== 'undefined' && !!document.querySelector('.metis-app-header-logo')", 12000);
  await page.waitFor('window.__wbReady !== false', 3000).catch(() => {});
  await sleep(300);   // /api/wordbook 응답이 wordbook 에 반영되길 기다림
  await page.eval(kind === 'en' ? `renderResultEN(${JSON.stringify(EN)}, true)` : `renderResultKO(${JSON.stringify(KO)}, true)`);
  await page.eval("(() => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()");
  return page;
}
const click = page => page.eval("document.querySelector('.extra-trans-btn.it').click()");
const resultText = page => page.eval("document.getElementById('extra-trans-result').innerText");
const waitDone = page => page.waitFor("!document.querySelector('#extra-trans-result .loading') && document.getElementById('extra-trans-result').innerText.trim().length > 0", 6000);

for (const kind of ['en', 'ko']) for (const width of [320, 390, 1280]) {
  test(`A ${kind} ${width}px: 일본어·중국어·IT 용어 버튼이 한 줄·같은 폭·높이 44px 이상, 가로 스크롤 없음, 이모지 없음, radius 10px, 글자 한 줄(일본어·중국어·IT 용어)`, { skip: SKIP }, async () => {
    const page = await open({ width, kind });
    const m = await page.eval(`(() => { const b = [...document.querySelectorAll('.extra-trans-btns .extra-trans-btn')].map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), top: Math.round(r.top), w: r.width, h: r.height, rad: getComputedStyle(e).borderRadius, sw: e.scrollWidth, cw: e.clientWidth, lines: (() => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map(q => Math.round(q.top))).size; })(), fs: getComputedStyle(e).fontSize }; });
      const box = document.querySelector('.extra-trans-btns').getBoundingClientRect();
      return { b, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, x0: box.left, x1: box.right, last: [...document.querySelectorAll('.extra-trans-btns .extra-trans-btn')].pop().getBoundingClientRect().right }; })()`);
    assert.deepEqual(m.b.map(x => x.t), ['일본어', '중국어', 'IT 용어']);
    assert.equal(new Set(m.b.map(x => x.top)).size, 1, '한 줄');
    assert.ok(Math.max(...m.b.map(x => x.w)) - Math.min(...m.b.map(x => x.w)) <= 1, '같은 폭 ' + m.b.map(x => x.w));
    for (const x of m.b) { assert.ok(x.h >= 44, '높이 ' + x.h); assert.equal(x.rad, '10px'); assert.equal(x.lines, 1, '글자 한 줄: ' + x.t); assert.ok(x.sw <= x.cw + 1, '글자가 버튼 밖으로 넘치지 않음: ' + x.t); assert.ok(!/\p{Extended_Pictographic}/u.test(x.t)); assert.equal(x.fs, '13px'); }
    assert.ok(m.sw <= m.vw, '가로 스크롤 없음 ' + m.sw + '/' + m.vw); assert.ok(m.last <= m.x1 + 1);
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  });
}

test('B 영어: 클릭 1회 = AI 1회(단어 포함·로그인 헤더) + 저장 1회, 표시 순서·내용, 이모지·박스 없음, 재클릭은 AI 0회', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(11, EN)] });
  await click(page); await waitDone(page);
  assert.equal(state.ai.length, 1); assert.match(state.ai[0].prompt, /"cache"/); assert.equal(state.ai[0].auth, 'Bearer ' + TOKEN);
  assert.equal(state.patches.length, 1); assert.equal(state.patches[0].id, 11); assert.deepEqual(state.patches[0].body, { it: GOOD }); assert.equal(state.patches[0].auth, 'Bearer ' + TOKEN);
  const t = await resultText(page);
  const order = [GOOD.one_line, '용도', GOOD.situations[0], GOOD.situations[1], '유래', GOOD.origin.text, '관련어', 'buffer'].map(s => t.indexOf(s));
  assert.ok(order.every(i => i >= 0), '모두 표시 ' + order); assert.deepEqual(order, order.slice().sort((a, b) => a - b), '순서');
  assert.ok(!/\p{Extended_Pictographic}/u.test(t)); assert.ok(!/저장하지 못했습니다/.test(t)); for (const old of ['이럴 때 씁니다', '왜 이렇게 부를까', '헷갈리는 용어', '예문', 'Clear the cache']) assert.ok(!t.includes(old), '없어야 함: ' + old);
  const css = await page.eval(`(() => { const l = document.querySelector('#extra-trans-result .result-section-title'), b = document.querySelector('#extra-trans-result .meaning-nuance'); const cl = getComputedStyle(l), cb = getComputedStyle(b); return { fs: cl.fontSize, fw: cl.fontWeight, ls: cl.letterSpacing, color: cl.color, bfs: cb.fontSize, bg: cb.backgroundColor, shadow: cb.boxShadow, rad: cb.borderRadius }; })()`);
  assert.equal(css.fs, '12px'); assert.equal(css.fw, '700'); assert.equal(css.ls, '0.48px'); assert.equal(css.color, 'rgb(184, 68, 46)'); assert.equal(css.bfs, '13px'); assert.equal(css.bg, 'rgba(0, 0, 0, 0)'); assert.equal(css.shadow, 'none'); assert.equal(css.rad, '0px');
  await click(page); await sleep(200);
  assert.equal(state.ai.length, 1, '재클릭 AI 0회'); assert.equal(state.patches.length, 1);
  assert.ok((await resultText(page)).includes(GOOD.one_line));
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('B 저장된 it 가 있는 단어는 클릭해도 AI·저장 0회로 바로 표시', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(12, { ...EN, it: GOOD })] });
  await click(page); await sleep(300);
  assert.equal(state.ai.length, 0); assert.equal(state.patches.length, 0); assert.ok((await resultText(page)).includes(GOOD.one_line));
  await page.close();
});

test('B 진행 중 연타는 AI 1회, 끝나면 버튼이 다시 눌린다', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(11, EN)] });
  state.aiPlan.push({ text: JSON.stringify(GOOD), delay: 400 });
  await page.eval("(() => { const b = document.querySelector('.extra-trans-btn.it'); b.click(); b.click(); b.click(); loadITTerm(b); })()");
  await sleep(100);
  assert.ok(await page.eval("document.querySelector('.extra-trans-btn.it').disabled"), '진행 중 비활성');
  await waitDone(page);
  assert.equal(state.ai.length, 1); assert.equal(state.patches.length, 1);
  assert.equal(await page.eval("document.querySelector('.extra-trans-btn.it').disabled"), false);
  await page.close();
});

test('B 오류: 429 는 서버 한국어 안내 그대로(저장 없음), 형식 오류·잘린 응답은 "IT 설명을 가져오지 못했습니다. 다시 시도해 주세요."(저장 없음), 다시 누르면 새로 1회 호출', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(11, EN)] });
  state.aiPlan.push({ status: 429, body: { error: '하루 200번까지 AI 검색을 쓸 수 있어요. 내일 다시 이용해주세요.' } });
  await click(page); await waitDone(page);
  assert.match(await resultText(page), /하루 200번까지 AI 검색을 쓸 수 있어요/); assert.equal(state.patches.length, 0);
  state.aiPlan.push({ text: JSON.stringify({ ...GOOD, situations: ['하나뿐'] }) });
  await click(page); await waitDone(page);
  assert.equal(await resultText(page), 'IT 설명을 가져오지 못했습니다. 다시 시도해 주세요.'); assert.equal(state.patches.length, 0);
  state.aiPlan.push({ text: '{"is_it": tr' });
  await click(page); await waitDone(page);
  assert.equal(await resultText(page), 'IT 설명을 가져오지 못했습니다. 다시 시도해 주세요.');
  assert.equal(state.ai.length, 3, '실패 후 재클릭은 새 호출'); assert.equal(await page.eval("document.querySelector('.extra-trans-btn.it').disabled"), false);
  await click(page); await waitDone(page);   // 기본 응답(정상)
  assert.equal(state.ai.length, 4); assert.equal(state.patches.length, 1); assert.ok((await resultText(page)).includes(GOOD.one_line));
  await page.close();
});

test('B is_it=false: 안내 문구를 보이고 저장한다(재클릭 AI 0회). sure=false: 고정 문구를 보조색으로', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(11, EN)] });
  state.aiPlan.push({ text: JSON.stringify({ is_it: false, one_line: '', situations: [], origin: null, compare: null, example: null }) });
  await click(page); await waitDone(page);
  assert.equal(await resultText(page), 'IT 분야에서 쓰이는 용례가 없는 단어입니다.'); assert.equal(state.patches.length, 1); assert.equal(state.patches[0].body.it.is_it, false);
  await click(page); await sleep(150); assert.equal(state.ai.length, 1);
  await page.close();
  const p2 = await open({ rows: [row(11, EN)] });
  state.aiPlan.push({ text: JSON.stringify({ ...GOOD, origin: { text: '아마 이런 이야기일 것이다', sure: false } }) });
  await click(p2); await waitDone(p2);
  const o = await p2.eval(`(() => { const e = [...document.querySelectorAll('#extra-trans-result .result-section')].find(s => s.textContent.includes('유래')).querySelector('.meaning-nuance'); return { text: e.textContent, color: getComputedStyle(e).color, normal: getComputedStyle(document.querySelector('#extra-trans-result .meaning-core')).color }; })()`);
  assert.equal(o.text, '정확한 유래는 확인이 필요합니다.'); assert.notEqual(o.color, o.normal, '보조색');
  assert.equal(state.patches[0].body.it.origin.text, '정확한 유래는 확인이 필요합니다.');
  await p2.close();
});

test('B 저장(PATCH)이 실패해도 화면 표시는 유지하고 글자로 알린다. 단어장에 없는 단어도 같다', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(11, EN)] });
  state.patchStatus = 500;
  await click(page); await waitDone(page);
  let t = await resultText(page); assert.ok(t.includes(GOOD.one_line)); assert.ok(t.includes('저장하지 못했습니다. 이번에만 표시됩니다.')); assert.equal(state.patches.length, 1);
  await page.close();
  const p2 = await open({ rows: [] });   // 단어장에 없음
  await click(p2); await waitDone(p2);
  t = await resultText(p2); assert.ok(t.includes(GOOD.one_line)); assert.ok(t.includes('저장하지 못했습니다')); assert.equal(state.patches.length, 0); assert.equal(state.ai.length, 1);
  await p2.close();
});

test('B 한국어 결과: 프롬프트에 한국어 단어와 대응 영어 표현(thread, strand)이 들어가고 저장은 ko 행에 한다. 저장된 설명은 0회', { skip: SKIP }, async () => {
  const page = await open({ kind: 'ko', rows: [row(21, KO)] });
  await click(page); await waitDone(page);
  assert.equal(state.ai.length, 1); assert.match(state.ai[0].prompt, /"스레드"/); assert.match(state.ai[0].prompt, /thread, strand/);
  assert.equal(state.patches.length, 1); assert.equal(state.patches[0].id, 21);
  await click(page); await sleep(150); assert.equal(state.ai.length, 1);
  await page.close();
  const p2 = await open({ kind: 'ko', rows: [row(22, { ...KO, it: GOOD })] });
  await click(p2); await sleep(250); assert.equal(state.ai.length, 0); assert.ok((await resultText(p2)).includes(GOOD.one_line));
  await p2.close();
});

test('C 예전에 저장된 data.it.example 은 표시하지 않고 AI 도 부르지 않는다', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(31, { ...EN, it: { ...GOOD, example: { en: 'Clear the cache.', ko: '캐시를 지우세요.' } } })] });
  await click(page); await sleep(300);
  const t = await resultText(page);
  assert.equal(state.ai.length, 0); assert.ok(t.includes(GOOD.one_line)); assert.ok(!t.includes('Clear the cache') && !t.includes('예문'));
  await page.close();
});

test('C IT 결과의 글자 크기·간격·구분선이 위쪽 단어 결과와 같은 값(계산 스타일 비교)', { skip: SKIP }, async () => {
  const data = { ...EN, meanings: [{ pos: 'noun', definition: '캐시', usage_note: '설명', example: 'a b', translation: '가' }, { pos: 'verb', definition: '저장하다' }], similar: [{ word: 'buffer', core_meaning: '버퍼', diff: '다름' }], collocations: [] };
  const page = await open({ rows: [row(11, data)] });
  await page.eval('renderResultEN(' + JSON.stringify(data) + ', true)');
  await click(page); await waitDone(page);
  const m = await page.eval(`(() => { const g = (sel, props) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return props.map(p => c[p]).join('|'); };
    const T = '#search-result > .result-card > ';
    const P = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'marginBottom', 'fontFamily'];
    const cmp = (top, it, props) => ({ top: g(top, props), it: g(it, props) });
    return {
      title: cmp(T + '.result-section .result-section-title', '#extra-trans-result .result-section-title', P),
      secgap: cmp(T + '.result-section', '#extra-trans-result .result-section', ['marginBottom', 'borderBottomWidth', 'borderTopWidth', 'paddingTop']),
      body: cmp(T + '.result-section .meaning-nuance', '#extra-trans-result .meaning-nuance', ['fontSize', 'lineHeight', 'color']),
      item: cmp(T + '.result-section .meaning-set', '#extra-trans-result .meaning-set', ['paddingBottom', 'marginBottom', 'borderBottomWidth', 'borderBottomColor']),
      lead: cmp(T + '.result-section .meaning-core', '#extra-trans-result .meaning-core', ['fontSize', 'fontWeight', 'color']),
      sim: cmp(T + '.result-section .similar-item', '#extra-trans-result .similar-item', ['paddingTop', 'paddingBottom', 'gap', 'display', 'borderBottomWidth']),
      simw: cmp(T + '.result-section .similar-word', '#extra-trans-result .similar-word', ['fontSize', 'fontWeight', 'fontFamily', 'minWidth']),
      simd: cmp(T + '.result-section .similar-diff', '#extra-trans-result .similar-diff', ['fontSize', 'color', 'lineHeight']) }; })()`);
  for (const [k, v] of Object.entries(m)) { assert.ok(v.top && v.it, k + ' 요소 없음'); assert.equal(v.it, v.top, k + ': 위쪽 ' + v.top + ' / IT ' + v.it); }
  await page.close();
});
