// 작업411: 단어장 "IT" 구분. 자체 임시 서버(정적 파일 + 가짜 /api/me·/api/wordbook·/api/ai). 실제 AI·DB·운영 서버와 무관.
// 확인: [IT] 버튼(위치·44px·이모지 없음·가로 스크롤 없음) / 목록(단어+한 줄 핵심, ja·zh·is_it=false·it 없음 제외, 같은 단어 영·한 둘 다) / 빈 상태 문구 /
//       IT 구분에서 항목 클릭=IT 설명 바로 표시(AI 0회), 영어 구분에서 클릭=기존 동작 / 삭제 모드=IT 설명만 삭제(단어는 영어 구분에 남음, 행 DELETE 없음) /
//       게임 풀·퀴즈 풀·다른 구분 불변
// 실행: node --test tests/ui/wordbook_it411.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { dialogAnswer } = require('./helpers/dialog');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const IT = l => ({ is_it: true, one_line: l, situations: ['장면 하나', '장면 둘'], origin: { text: '유래', sure: true }, compare: null });
const data = (word, lang, extra = {}) => ({ word, lang, short_meaning: '뜻', meanings: [{ pos: 'noun', definition: '뜻' }], entries: [{ english: 'thread', pos: ['noun'], meaning: '실' }], nuance: '뉘앙스', derivatives: [], ...extra });
const row = (id, word, lang, extra, t = id) => ({ id, word, lang, data: data(word, lang, extra), created_at: new Date(2026, 0, 1, 0, t).toISOString(), source: 'manual' });
const ROWS = () => [
  row(1, 'cache', 'en', { it: IT('자주 쓰는 데이터를 가까이 두는 곳') }), row(2, 'thread', 'en', { it: { is_it: false } }), row(3, 'apple', 'en'),
  row(4, '스레드', 'ko', { it: IT('프로그램 안의 작업 줄기') }), row(5, 'lock', 'en', { it: IT('영어 락 한 줄') }), row(6, 'lock', 'ko', { it: IT('한국어 락 한 줄') }),
  row(7, 'キャッシュ', 'ja', { it: IT('일본어 행') }), row(8, '缓存', 'zh', { it: IT('중국어 행') }), row(9, 'banana', 'en'), row(10, 'cherry', 'en'),
];

let srv, base, browser;
const state = { ai: [], deletes: [], rows: [] };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = []; req.on('data', d => chunks.push(d));
      req.on('end', () => {
        if (u === '/api/me') return json(200, { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true });
        if (u === '/api/wordbook' && req.method === 'GET') return json(200, state.rows);
        if (u === '/api/ai') { state.ai.push(1); return json(200, { result: '{}' }); }
        let m;
        if ((m = /^\/api\/wordbook\/(\d+)(\/it)?$/.exec(u)) && req.method === 'DELETE') { state.deletes.push({ id: Number(m[1]), it: !!m[2] }); return json(200, { ok: true }); }
        json(200, req.method === 'GET' ? [] : {});
      });
      return;
    }
    const f = path.join(PUB, u);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });

async function open({ width = 390, rows = ROWS(), tab = 'it' } = {}) {
  state.ai.length = 0; state.deletes.length = 0; state.rows = rows;
  const page = await browser.newPage({ width, height: 800, token: 'x' });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 768 });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('mydict_token', ${JSON.stringify(TOKEN)}); } catch (e) {}` });
  await page.goto(base + '/english_dictionary.html');
  await page.waitFor("typeof wbTabRows === 'function' && !!document.querySelector('.metis-app-header-logo')", 12000);
  await page.waitFor(`wordbook.length === ${rows.length}`, 6000);
  await page.eval("(() => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()");
  await page.eval(`showPage('wordbook'); switchWordbookTab('${tab}')`);
  return page;
}
const chips = page => page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].map(c => ({ word: c.querySelector('.word-chip-text').textContent, line: (c.querySelector('.similar-core') || {}).textContent || null }))");

for (const width of [320, 390, 1280]) {
  test(`A ${width}px: [IT] 버튼은 중국어 다음, 44px 이상, 이모지 없음, 가로 스크롤 없음(IT 구분 목록 포함)`, { skip: SKIP }, async () => {
    const page = await open({ width });
    const m = await page.eval(`(() => { const ids = [...document.querySelectorAll('.wb-side-group')[0].querySelectorAll('.wb-side-btn')].map(b => b.id); const b = document.getElementById('wb-tab-it'); const r = b.getBoundingClientRect();
      const side = document.querySelector('.wb-side').getBoundingClientRect();
      return { ids, h: r.height, w: r.width, text: b.textContent.trim(), active: b.className, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, sideH: side.height, vh: innerHeight }; })()`);
    assert.deepEqual(m.ids, ['wb-tab-en', 'wb-tab-ko', 'wb-tab-ja', 'wb-tab-zh', 'wb-tab-it']);
    assert.ok(m.h >= 44, '높이 ' + m.h); assert.equal(m.text, 'IT'); assert.ok(!/\p{Extended_Pictographic}/u.test(m.text)); assert.match(m.active, /active-it/);
    assert.ok(m.sw <= m.vw, '가로 스크롤 없음 ' + m.sw + '/' + m.vw);
    console.log(`[411 측정] ${width}px: 사이드 높이 ${Math.round(m.sideH)}px / 화면 높이 ${m.vh}px, IT 버튼 ${Math.round(m.w)}x${Math.round(m.h)}`);
    // 칩 터치 높이
    const hs = await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].map(c => c.getBoundingClientRect().height)");
    assert.ok(hs.length > 0 && hs.every(h => h >= 44), '칩 높이 ' + hs);
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  });
}

test('B IT 구분 목록: 영어·한국어 행 중 is_it=true 만(같은 단어 lock 은 영·한 둘 다), 단어 + 한 줄 핵심, ja·zh·is_it=false·it 없음 제외. 정렬 ABC 도 동작', { skip: SKIP }, async () => {
  const page = await open();
  const c = await chips(page);
  assert.deepEqual(c.map(x => x.word).sort(), ['cache', 'lock', 'lock', '스레드'].sort());
  assert.equal(c.find(x => x.word === 'cache').line, '자주 쓰는 데이터를 가까이 두는 곳'); assert.ok(c.every(x => x.line));
  assert.ok(c.filter(x => x.word === 'lock').map(x => x.line).sort().join() === ['영어 락 한 줄', '한국어 락 한 줄'].sort().join());
  assert.equal(await page.eval("currentWordbookTab"), 'it');
  await page.eval("setWordbookSort('abc')");
  assert.equal((await chips(page)).length, 4);
  assert.equal(await page.eval("document.querySelectorAll('#wordbook-list .alpha-header').length > 0"), true);
  // 다른 구분은 그대로(칩에 한 줄 핵심 없음, IT 단어도 영어·한국어 구분에 남음)
  await page.eval("switchWordbookTab('en')"); const en = await chips(page);
  assert.deepEqual(en.map(x => x.word).sort(), ['apple', 'banana', 'cache', 'cherry', 'lock', 'thread']); assert.ok(en.every(x => x.line === null));
  await page.eval("switchWordbookTab('ko')"); assert.deepEqual((await chips(page)).map(x => x.word).sort(), ['lock', '스레드'].sort());
  await page.eval("switchWordbookTab('ja')"); assert.deepEqual((await chips(page)).map(x => x.word), ['キャッシュ']);
  await page.close();
});

test('B 빈 상태: IT 설명이 저장된 단어가 없으면 안내 문구', { skip: SKIP }, async () => {
  const page = await open({ rows: [row(3, 'apple', 'en'), row(2, 'thread', 'en', { it: { is_it: false } })] });
  const t = await page.eval("document.getElementById('wordbook-list').innerText");
  assert.equal(t.replace(/\s+/g, ' ').trim(), 'IT 용어로 저장된 단어가 없습니다. 검색 결과에서 [IT 용어]를 눌러 보세요.');
  await page.close();
});

test('C IT 구분에서 항목을 누르면 검색 결과 화면에서 저장된 IT 설명이 바로 펼쳐진다(AI 0회). 영어 구분에서 누르면 기존 동작(설명은 버튼을 눌러야)', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].find(c => c.querySelector('.word-chip-text').textContent === 'cache').click()");
  await page.waitFor("document.getElementById('page-search').classList.contains('active') && document.getElementById('extra-trans-result').innerText.includes('자주 쓰는 데이터를 가까이 두는 곳')", 6000);
  assert.equal(state.ai.length, 0);
  assert.ok((await page.eval("document.getElementById('extra-trans-result').innerText")).includes('용도'));
  await page.eval("showPage('wordbook'); switchWordbookTab('en')");
  await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].find(c => c.querySelector('.word-chip-text').textContent === 'cache').click()");
  await page.waitFor("document.getElementById('page-search').classList.contains('active') && !!document.querySelector('#search-result .extra-trans-btn.it')", 6000);
  await sleep(200);
  assert.equal((await page.eval("document.getElementById('extra-trans-result').innerText")).trim(), '', '다른 구분에서 연 경우는 설명이 자동으로 펼쳐지지 않는다');
  assert.equal(state.ai.length, 0);
  await page.close();
});

test('C 한국어 행도 IT 구분에서 눌러 저장된 설명을 바로 본다', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].find(c => c.querySelector('.word-chip-text').textContent === '스레드').click()");
  await page.waitFor("document.getElementById('extra-trans-result') && document.getElementById('extra-trans-result').innerText.includes('프로그램 안의 작업 줄기')", 6000);
  assert.equal(state.ai.length, 0);
  await page.close();
});

test('D 삭제 모드: IT 구분에서 같은 단어(lock 영·한)를 각각 선택해 지워도 IT 설명만 지워진다(행 삭제 없음, 단어는 영어·한국어 구분에 남음). 문구 확인', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("setWordbookMode('delete')");
  await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].filter(c => c.querySelector('.word-chip-text').textContent === 'lock').forEach(c => c.click())");
  // 같은 단어(lock)의 영어·한국어 칩을 모두 눌러도 서로의 선택을 지우지 않는다(키가 단어|행의 언어)
  assert.equal(await page.eval("document.querySelectorAll('#wordbook-list .word-chip.selected').length"), 2);
  assert.match(await page.eval("document.getElementById('wb-selected-action-btn').textContent"), /\(2개\)/);
  await page.eval("void confirmDeleteSelectedWords()");
  const msg = await dialogAnswer(page, true);
  assert.equal(msg, 'IT 설명을 삭제할까요? 단어는 영어·한국어 단어장에 남습니다.');
  await page.waitFor('true'); await sleep(300);
  assert.deepEqual(state.deletes.slice().sort((a, b) => a.id - b.id), [{ id: 5, it: true }, { id: 6, it: true }]);
  assert.ok(state.deletes.every(d => d.it), '행 DELETE 없음');
  assert.deepEqual((await chips(page)).map(x => x.word).sort(), ['cache', '스레드'].sort());
  await page.eval("switchWordbookTab('en')"); assert.ok((await chips(page)).some(x => x.word === 'lock'), '영어 단어장에 lock 남음');
  await page.eval("switchWordbookTab('ko')"); assert.ok((await chips(page)).some(x => x.word === 'lock'), '한국어 단어장에 lock 남음');
  await page.close();
});

test('D 취소하면 아무것도 지우지 않고, 칩의 ×는 IT 구분에서 IT 설명만 지운다(단어 행은 유지)', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("setWordbookMode('delete')");
  await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].find(c => c.querySelector('.word-chip-text').textContent === 'cache').click()");
  await page.eval("void confirmDeleteSelectedWords()");
  assert.equal(await dialogAnswer(page, false), 'IT 설명을 삭제할까요? 단어는 영어 단어장에 남습니다.');
  await sleep(150); assert.equal(state.deletes.length, 0); assert.equal((await chips(page)).length, 4);
  await page.eval("setWordbookMode('none')");
  await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].find(c => c.querySelector('.word-chip-text').textContent === '스레드').querySelector('.word-chip-del').click()");
  assert.equal(await dialogAnswer(page, true), 'IT 설명을 삭제할까요? 단어는 한국어 단어장에 남습니다.');
  await sleep(300); assert.deepEqual(state.deletes, [{ id: 4, it: true }]);
  assert.equal(await page.eval("wordbook.some(w => w.id === 4 && w.word === '스레드')"), true);
  await page.close();
});

test('E 변경 없음: IT 단어도 게임 풀·퀴즈 풀·영어 구분에 영어 단어로 그대로 있고, 영어 구분의 삭제 모드는 기존대로 행을 지운다', { skip: SKIP }, async () => {
  const page = await open({ tab: 'en' });
  assert.equal(await page.eval("gamePools().el.some(w => w.word === 'cache')"), true, '게임 풀에 cache 포함');
  assert.equal(await page.eval("wordbook.filter(w => (w.lang || 'en') === 'en').some(w => w.word === 'cache')"), true, '퀴즈 풀(영어 단어)에 cache 포함');
  assert.equal(await page.eval("document.getElementById('wordbook-count').textContent"), '10', '총 개수 배지는 전체 단어 수 그대로');
  await page.eval("setWordbookMode('delete')");
  await page.eval("[...document.querySelectorAll('#wordbook-list .word-chip')].find(c => c.querySelector('.word-chip-text').textContent === 'apple').click()");
  await page.eval("void confirmDeleteSelectedWords()");
  assert.equal(await dialogAnswer(page, true), '선택한 1개 단어를 삭제하시겠습니까?');
  await sleep(300); assert.deepEqual(state.deletes, [{ id: 3, it: false }], '행 삭제(기존 경로)');
  await page.close();
});
