// 작업374: 사전 하단 nav "게임" 탭과 게임 랜딩(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 /api/me·/api/wordbook). 외부 API·운영 서버와 무관.
// 확인: 6탭 순서·활성·폭(320/360/390), 4개 출처 행과 단어 수, 10/20 칩 저장, 선택 → 단어장 선택 모드, 오답/최근/랜덤 시작 시 spellrun_ids·이동 주소,
//       랜덤 가중치(난수를 바꿔 넣어 결정적으로 2배 확률 검증), 3개 미만 비활성과 문구, 뒤로가기·#game 복원, 숨긴 "선택 게임" 버튼
// 실행: node --test tests/ui/dictionary_game374.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

// 영어 12개(출제 가능: id 1~12, 번호가 클수록 최근 저장) + 출제 불가 5개(구절·한국어·뜻 없음·대소문자 중복·한 글자)
const T0 = Date.UTC(2026, 9, 1);
const row = (id, word, lang, meaning, minutes) => ({ id, word, lang, created_at: new Date(T0 + minutes * 60000).toISOString(), source: 'manual',
  data: Object.assign({ word, lang }, meaning === null ? {} : { short_meaning: meaning, meanings: [{ pos: 'noun', definition: meaning, nuance: '', example: '' }] }) });
const EN = ['apple', 'book', 'cat', 'dog', 'egg', 'fish', 'gate', 'hat', 'ink', 'jar', 'kite', 'lamp'];
let ROWS = [];
const buildRows = () => {
  ROWS = EN.map((w, i) => row(i + 1, w, 'en', w + ' 뜻', 100 + i));
  ROWS.push(row(13, 'give up', 'en', '포기하다', 50), row(14, '사과', 'ko', 'apple', 51), row(15, 'nomeaning', 'en', null, 52), row(16, 'Apple', 'en', '사과', 40), row(17, 'a', 'en', '하나', 53));
};
let srv, base, browser, forbidden = false;
test.before(async () => {
  if (SKIP) return;
  buildRows();
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      req.on('data', () => {}); req.on('end', () => {
        if (u === '/api/me') return json(200, { id: 7, email: 'u@x', name: '테스터', role: 'user', can_wordbook: !forbidden, can_search: true, can_quiz: true });
        if (u === '/api/wordbook' && req.method === 'GET') return forbidden ? json(403, { error: '단어장 권한이 없습니다.' }) : json(200, ROWS);
        json(503, { ok: false });
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

const READY = "!!document.querySelector('nav') && typeof wordbook !== 'undefined' && wordbook.length > 5";
// opts.wrong: localStorage 'mydict_wrong' 에 넣을 단어 배열, opts.keep: 저장 초기화를 하지 않음
async function open(width = 390, hash = '', opts = {}) {
  const page = await browser.newPage({ width, height: 844, token: jwt() });
  const wrong = JSON.stringify((opts.wrong || []).map(w => ({ word: w })));
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.setItem('mydict_wrong', ${JSON.stringify(wrong)}); ${opts.keep ? '' : "localStorage.removeItem('spellrun_landing_count');"} sessionStorage.removeItem('spellrun_ids'); } } catch (e) {}` });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 });
  await page.goto(base + '/english_dictionary.html' + hash);
  await page.waitFor(READY, 12000);
  return page;
}
const noErr = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const rowsOf = page => page.eval("[...document.querySelectorAll('#game-sources .game-src')].map(b => ({ key: b.dataset.src, name: b.querySelector('.game-src-name').textContent, n: b.querySelector('.game-src-n').textContent, off: b.getAttribute('aria-disabled'), why: (b.querySelector('.game-src-why') || {}).textContent || '' }))");

test('374-1) 하단 nav 6탭: 검색 / 단어장 / 게임 / 퀴즈 / 복습 / 오답노트, 게임 탭이 열리면 3번째 탭만 활성', { skip: SKIP }, async () => {
  const page = await open();
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.nav-tab-label')].map(e => e.textContent)"), ['검색', '단어장', '게임', '퀴즈', '복습', '오답노트']);
  const act = () => page.eval("[...document.querySelectorAll('.nav-tab')].map((t, i) => t.classList.contains('active') ? i : -1).filter(i => i >= 0)");
  assert.deepEqual(await act(), [0], '처음은 검색');
  for (const [name, idx] of [['wordbook', 1], ['game', 2], ['quiz', 3], ['metacog', 4], ['wrong', 5], ['search', 0]]) {
    await page.eval(`showPage(${JSON.stringify(name)})`);
    assert.deepEqual(await act(), [idx], name + ' 탭 활성 위치');
    assert.equal(await page.eval(`document.getElementById('page-${name}').classList.contains('active')`), true);
  }
  await page.eval("document.querySelectorAll('.nav-tab')[2].click()");
  assert.equal(await page.eval("document.getElementById('page-game').classList.contains('active')"), true, '게임 탭 클릭으로 열림');
  // 복습 화면은 모의 서버에 API 가 없어 스스로 오류를 낸다(이 시험과 무관)
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource|\[metacog\] init error/.test(e)), []);
  await page.close();
});

for (const w of [320, 360, 390]) {
  test(`374-1) ${w}px: 6탭 모두 라벨이 줄바꿈·잘림 없이 보이고 가로로 넘치지 않는다`, { skip: SKIP }, async () => {
    const page = await open(w);
    const r = await page.eval(`(() => { const box = document.querySelector('.nav-tabs'); const nav = document.querySelector('nav').getBoundingClientRect();
      return { overflow: box.scrollWidth > box.clientWidth + 1, tabs: [...document.querySelectorAll('.nav-tab')].map(t => { const l = t.querySelector('.nav-tab-label'), tr = t.getBoundingClientRect(), lr = l.getBoundingClientRect();
        return { t: l.textContent, fits: l.scrollWidth <= l.clientWidth, oneLine: lr.height < 24, inside: tr.right <= nav.right - 16 + 0.5 && tr.left >= nav.left + 16 - 0.5, tabW: tr.width, labelW: lr.width }; }) }; })()`);
    assert.equal(r.overflow, false, '가로 스크롤 없음');
    assert.equal(r.tabs.length, 6);
    for (const t of r.tabs) { assert.ok(t.fits && t.oneLine && t.inside, `${w}px "${t.t}" 잘림/줄바꿈 (탭 ${t.tabW}, 글 ${t.labelW})`); assert.ok(t.labelW <= t.tabW + 0.5, `${w}px "${t.t}" 글이 탭보다 넓다`); }
    noErr(page); await page.close();
  });
}

test('374-2) 게임 랜딩: 설명·10/20 칩(기본 10)·출처 4개 행(이름·설명·사용 가능한 단어 수), 출제 불가 단어(구절·한국어·뜻 없음·중복·한 글자)는 세지 않음', { skip: SKIP }, async () => {
  const page = await open(390, '', { wrong: ['apple', 'zebra', 'Book', 'kite'] });
  await page.eval("showPage('game')");
  assert.match(await page.text('.game-intro'), /철자 게임/);
  assert.equal(await page.eval("document.getElementById('game-count-10').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.eval("document.getElementById('game-count-20').getAttribute('aria-pressed')"), 'false');
  const rows = await rowsOf(page);
  assert.deepEqual(rows.map(r => [r.key, r.name, r.n, r.off]), [['select', '선택', '12개', 'false'], ['random', '랜덤', '12개', 'false'], ['wrong', '오답', '3개', 'false'], ['recent', '최근', '12개', 'false']],
    '오답 노트의 zebra(단어장에 없음)는 빠지고 대소문자 다른 Book 은 book 으로 센다');
  assert.equal(await page.eval("[...document.querySelectorAll('.game-src-desc')].map(e => e.textContent).join('|')"), '단어장에서 직접 고르기|단어장 영어 단어 중 무작위 (최근 저장·오답 단어는 2배 확률)|오답 노트의 단어|최근 저장한 단어');
  assert.equal(await page.eval("getComputedStyle(document.getElementById('wb-mode-spell-btn')).display"), 'none', '단어장 옆 "선택 게임" 버튼은 숨김');
  assert.equal(await page.eval("document.getElementById('wb-mode-spell-btn').hidden"), true);
  noErr(page); await page.close();
});

test('374-2) 10/20 칩: 누르면 선택이 바뀌고 localStorage 에 저장되며 다시 열어도 유지된다. 저장이 막혀도 동작한다', { skip: SKIP }, async () => {
  let page = await open();
  await page.eval("showPage('game')");
  await page.click('#game-count-20');
  assert.equal(await page.eval("document.getElementById('game-count-20').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.eval("document.getElementById('game-count-10').getAttribute('aria-pressed')"), 'false');
  assert.equal(await page.eval("localStorage.getItem('spellrun_landing_count')"), '20');
  await page.goto(base + '/english_dictionary.html#game');
  await page.waitFor(READY, 12000);
  assert.equal(await page.eval("document.getElementById('game-count-20').getAttribute('aria-pressed')"), 'true', '다시 열어도 20');
  assert.equal(await page.eval('gameCount'), 20);
  await page.close();
  page = await open(390, '', { keep: true });
  await page.eval("Storage.prototype.setItem = function () { throw new Error('막힘'); }");
  await page.eval("showPage('game')");
  await page.click('#game-count-10');
  await page.click('#game-count-20');
  assert.equal(await page.eval("document.getElementById('game-count-20').getAttribute('aria-pressed')"), 'true', '저장이 막혀도 선택은 바뀐다');
  assert.equal(await page.eval('gameCount'), 20);
  noErr(page); await page.close();
});

test('374-2) 선택: 단어장 화면으로 가서 기존 선택 모드가 켜지고 "게임 시작 (0개)", 3개 고르면 시작', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("showPage('game')");
  await page.click('.game-src[data-src="select"]');
  assert.equal(await page.eval("document.getElementById('page-wordbook').classList.contains('active')"), true);
  assert.equal(await page.eval('wordbookMode'), 'spell');
  assert.equal(await page.eval("document.getElementById('wb-selected-action-btn').textContent"), '게임 시작 (0개)');
  await page.eval("showPage('game')"); await page.click('.game-src[data-src="select"]');
  assert.equal(await page.eval('wordbookMode'), 'spell', '다시 눌러도 선택 모드가 꺼지지 않는다');
  noErr(page); await page.close();
});

const idsAfterStart = async (page, key) => {
  await page.click(`.game-src[data-src="${key}"]`);
  await page.waitFor("location.pathname === '/spelling_run.html'", 10000);
  return { ids: JSON.parse(await page.eval("sessionStorage.getItem('spellrun_ids')")), href: await page.eval('location.pathname + location.search') };
};

test('374-2) 최근: 저장 시각이 가장 최근인 영어 단어를 선택 개수(10)만큼, 20 이면 출제 가능한 12개 모두. 이동 주소는 /spelling_run.html', { skip: SKIP }, async () => {
  let page = await open();
  await page.eval("showPage('game')");
  const a = await idsAfterStart(page, 'recent');
  assert.deepEqual(a.ids, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3], '최근 10개(출제 불가 id 13~17 제외)');
  assert.equal(a.href, '/spelling_run.html');
  await page.close();
  page = await open();
  await page.eval("showPage('game')"); await page.click('#game-count-20');
  const b = await idsAfterStart(page, 'recent');
  assert.deepEqual(b.ids.slice().sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  await page.close();
});

test('374-2) 오답: 오답 노트 단어 중 단어장에 있는 것만. 선택 개수 이하면 전부, 넘으면 무작위로 그 개수만큼(중복 없음)', { skip: SKIP }, async () => {
  let page = await open(390, '', { wrong: ['apple', 'zebra', 'Book', 'kite'] });
  await page.eval("showPage('game')");
  const a = await idsAfterStart(page, 'wrong');
  assert.deepEqual(a.ids.slice().sort((x, y) => x - y), [1, 2, 11], 'zebra(단어장에 없음)는 제외');
  await page.close();
  page = await open(390, '', { wrong: EN });
  await page.eval("showPage('game')");
  const b = await idsAfterStart(page, 'wrong');
  assert.equal(b.ids.length, 10); assert.equal(new Set(b.ids).size, 10);
  assert.ok(b.ids.every(i => i >= 1 && i <= 12));
  await page.close();
});

test('374-2) 랜덤: 단어장 영어 단어에서 중복 없이 선택 개수만큼 뽑아 시작한다', { skip: SKIP }, async () => {
  const page = await open(390, '', { wrong: ['apple'] });
  await page.eval("showPage('game')");
  const a = await idsAfterStart(page, 'random');
  assert.equal(a.ids.length, 10); assert.equal(new Set(a.ids).size, 10);
  assert.ok(a.ids.every(i => i >= 1 && i <= 12), '출제 불가 단어(13~17)는 섞이지 않는다');
  await page.close();
});

test('374-2) 랜덤 가중치: 난수를 바꿔 넣어 결정적으로 — 최근 저장·오답 단어는 2배 확률, 둘 다여도 2배(곱하지 않음), 한 번에 중복 없음', { skip: SKIP }, async () => {
  const page = await open(390, '', { wrong: ['lamp', 'apple'] });   // lamp = 가장 최근(최근이면서 오답), apple = 가장 오래됨(오답만)
  const r = await page.eval(`(() => {
    let s = 20260101; gameRandom = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const { el, wrongEl } = gamePools(); const N = 60000, cnt = new Map();
    for (let i = 0; i < N; i++) { const w = gameWeighted(el, wrongEl, 1)[0]; cnt.set(w.id, (cnt.get(w.id) || 0) + 1); }
    const id = n => el.find(w => w.word === n).id;
    // n=1 이면 "최근" 은 가장 최근 1개(lamp)뿐: 가중치 lamp 2 · apple 2(오답) · 나머지 10개 1 → 합 14
    const full = gameWeighted(el, wrongEl, 10).map(w => w.id);
    return { N, lamp: cnt.get(id('lamp')), apple: cnt.get(id('apple')), cold: [...cnt.entries()].filter(([k]) => k !== id('lamp') && k !== id('apple')).map(([, v]) => v), full, eligible: el.length };
  })()`);
  const cold = r.cold.reduce((a, b) => a + b, 0) / r.cold.length;
  assert.equal(r.cold.length, 10);
  assert.ok(Math.abs(r.lamp / r.N - 2 / 14) < 0.01, `최근+오답 lamp ${(r.lamp / r.N).toFixed(4)} ≈ 2/14(곱하지 않음. 4배면 0.25)`);
  assert.ok(Math.abs(r.apple / r.N - 2 / 14) < 0.01, `오답 apple ${(r.apple / r.N).toFixed(4)} ≈ 2/14`);
  assert.ok(Math.abs(r.lamp / cold - 2) < 0.15 && Math.abs(r.apple / cold - 2) < 0.15, `보통 단어 대비 2배 (${(r.lamp / cold).toFixed(2)}, ${(r.apple / cold).toFixed(2)})`);
  assert.equal(r.full.length, 10); assert.equal(new Set(r.full).size, 10, '한 번 뽑을 때 중복 없음');
  noErr(page); await page.close();
});

test('374-2) 출제 가능 단어가 3개 미만이면 행이 비활성(aria-disabled)이고 이유 문구가 보이며 눌러도 이동하지 않는다. 오답 0개 문구', { skip: SKIP }, async () => {
  const page = await open(390, '', { wrong: [] });
  await page.eval("showPage('game')");
  let rows = await rowsOf(page);
  assert.equal(rows.find(r => r.key === 'wrong').off, 'true'); assert.equal(rows.find(r => r.key === 'wrong').why, '오답 노트가 비어 있어요'); assert.equal(rows.find(r => r.key === 'wrong').n, '0개');
  assert.equal(rows.find(r => r.key === 'recent').off, 'false');
  await page.click('.game-src[data-src="wrong"]');
  assert.equal(await page.eval('location.pathname'), '/english_dictionary.html', '비활성 행은 이동하지 않는다');
  assert.match(await page.text('#toast'), /오답 노트가 비어 있어요/);
  // 오답 노트에 있지만 단어장에 출제 가능한 것이 2개뿐
  await page.eval("wrongNote = [{ word: 'apple' }, { word: 'book' }, { word: 'zebra' }]; renderGamePage()");
  rows = await rowsOf(page);
  assert.match(rows.find(r => r.key === 'wrong').why, /3개 이상 필요해요 \(지금 2개\)/);
  // 단어장 영어 단어 2개뿐
  await page.eval("wordbook = wordbook.filter(w => w.id <= 2); renderGamePage()");
  rows = await rowsOf(page);
  for (const k of ['select', 'random', 'recent']) { const r = rows.find(x => x.key === k); assert.equal(r.off, 'true', k); assert.equal(r.why, '단어장에 영어 단어가 3개 이상 필요해요 (지금 2개)', k); }
  await page.click('.game-src[data-src="select"]');
  assert.equal(await page.eval("document.getElementById('page-game').classList.contains('active')"), true, '선택도 3개 미만이면 단어장으로 가지 않는다');
  assert.equal(await page.eval('wordbookMode'), 'none');
  noErr(page); await page.close();
});

test('374-2) 단어장 권한이 없으면(403) 모든 행이 비활성이고 권한 안내 문구', { skip: SKIP }, async () => {
  forbidden = true;
  try {
    const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
    await page.goto(base + '/english_dictionary.html');
    await page.waitFor("!!document.querySelector('nav')", 12000);
    await page.waitFor('wordbookForbidden === true', 8000);
    await page.eval("showPage('game')");
    const rows = await rowsOf(page);
    assert.equal(rows.length, 4);
    for (const r of rows) { assert.equal(r.off, 'true', r.key); assert.match(r.why, /단어장 사용 권한이 없어요/, r.key); }
    await page.close();
  } finally { forbidden = false; }
});

test('374-1) 뒤로가기·주소 해시: #game 으로 열면 게임 탭, 탭을 옮긴 뒤 뒤로가기하면 게임 view 로 돌아오고 탭 활성도 맞다', { skip: SKIP }, async () => {
  let page = await open(390, '#game');
  assert.equal(await page.eval("document.getElementById('page-game').classList.contains('active')"), true, '#game 복원');
  assert.equal(await page.eval("document.querySelectorAll('.nav-tab')[2].classList.contains('active')"), true);
  assert.equal(await page.eval("location.hash"), '', '복원 뒤 해시는 지운다(#wordbook 과 같은 방식)');
  assert.equal(await page.eval('history.state && history.state.page'), 'game');
  await page.close();
  page = await open();
  await page.eval("showPage('game')"); await page.eval("showPage('quiz')");
  await page.eval('history.back()');
  await page.waitFor("document.getElementById('page-game').classList.contains('active')", 5000);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.nav-tab')].map((t, i) => t.classList.contains('active') ? i : -1).filter(i => i >= 0)"), [2]);
  noErr(page); await page.close();
});
