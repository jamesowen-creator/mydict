// 스펠링 런(단어 게임) 화면 시험(헤드리스 Chrome 390px). 자체 임시 서버(정적 파일 + 모의 API: /api/me·/api/wordbook·/api/tts, AI·DB·운영 서버와 무관).
// 확인: ①사전 단어장에서 영어 3개 선택 → 게임 시작 → 선택한 단어만 출제 ②시작 버튼 실제 클릭(숨겨진 화면이 가로채지 않음) ③권한·토큰·선택 없음 안내
//       ④구절·다른 언어·뜻 없음 제외 표시와 중복 제거 ⑤완벽 봇 완주 + 발음 서버 호출(단어당 1회, Authorization 헤더) ⑥TTS 503 → 내장 음성 ⑦하트 ⑧뒤로가기 → 사전 단어장 열림
//       그리고 폰·태블릿 폭에서 가로 스크롤 없음
// 실행: node --test tests/ui/spellrun.ui.test.js   (Chrome이 없으면 건너뜀)
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
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
// 아주 짧은 무음 WAV(서버 TTS 응답 모의)
const WAV = (() => { const n = 800, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();

const en = (id, word, meaning, extra) => ({ id, word, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - id).toISOString(), data: meaning ? { word, lang: 'en', short_meaning: meaning, ...(extra || {}) } : { word, lang: 'en', ...(extra || {}) } });
const ROWS = [
  en(1, 'apple', '사과'), en(2, 'book', '책'), en(3, 'environment', '환경'), en(4, 'water', null, { meanings: [{ pos: 'noun', definition: '물' }] }),
  en(5, 'Apple', '사과(대문자)'), en(6, 'ice cream', '아이스크림'), en(7, 'nomean', null), en(8, 'a', '하나'), en(9, "o'clock", '~시 정각'),
  { id: 10, word: '나무', lang: 'ko', created_at: new Date(2026, 9, 1).toISOString(), data: { word: '나무', lang: 'ko', short_meaning: '나무' } },
  en(11, 'happy', '행복한'), en(12, 'window', '창문'), en(13, 'music', '음악'), en(14, 'friend', '친구'),
];

let srv, base, browser;
const state = { me: null, rows: ROWS, tts: 200, requests: [] };
const resetState = () => { state.me = { id: 7, email: 'u@x', name: '테스터', role: 'user', can_wordbook: true, perm_jgrammar: false }; state.rows = ROWS; state.tts = 200; state.requests.length = 0; };
test.before(async () => {
  if (SKIP) return;
  resetState();
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        state.requests.push({ method: req.method, url: u, auth: req.headers.authorization || null, body });
        if (u === '/api/me') return json(200, state.me);
        if (u === '/api/wordbook' && req.method === 'GET') return json(200, state.rows);
        if (u === '/api/tts' && req.method === 'POST') {
          if (state.tts !== 200) return json(state.tts, { error: '모의 TTS 오류' });
          res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(WAV);
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

// 내장 음성 모의: speak 하면 곧바로 onstart 를 불러 "재생 시작"으로 본다
const SPEECH = `(() => {
  const S = window.__speech = { spoken: [] };
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [], speaking: false, pending: false, paused: false, cancel: () => {}, resume: () => {},
    speak: u => { if (u.volume !== 0) S.spoken.push({ text: u.text, rate: u.rate }); setTimeout(() => { if (u.onstart) u.onstart(); }, 0); },
  } });
})();`;

// 게임 페이지를 직접 연다. ids 가 있으면 sessionStorage 에 넣고, token=false 면 로그인 토큰 없이 연다.
async function openGame({ ids, token = true, width = 390, height = 844, speech = false } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: token ? jwt() : null });
  if (!token) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('mydict_token'); } catch (e) {}" });   // 같은 Chrome 프로필을 쓰는 앞선 시험이 남긴 토큰 제거
  if (speech) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH });
  if (ids) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(ids))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && document.getElementById('gateMsg').textContent !== '불러오는 중...' || !document.getElementById('app').hidden", 8000);
  return page;
}
const gameReady = page => page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
const ttsCalls = () => state.requests.filter(r => r.url === '/api/tts');

// 완벽 봇: 정답 글자가 가까워지면 점프(시제품 smoke 와 같은 규칙). jumpHeart 이면 하트도 먹는다. 수동 진행 모드로 step() 을 직접 돌린다.
const BOT = `(async (opts) => {
  const R = window.SpellRun, G = R.G, C = R.CONFIG;
  const seen = new Set(), res = { spawned: 0, spawnHp: [], taken: 0, gains: [], hpMaxPreBoss: 0, hpMin: 99, fails: 0, regular: G.regular, over: false };
  if (opts.hp !== undefined) G.hp = opts.hp;
  let steps = 0;
  while (steps < 60 * 900 && G.state !== 'over') {
    if (G.state === 'run') {
      const near = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.kind === 'heart' ? opts.jumpHeart : x.correct) && (x.x - R.RUNNER_X) / G.speed <= C.JUMP_TIME / 2 && (x.x - R.RUNNER_X) > 0);
      if (near.length && G.jumpT < 0) R.jump();
    }
    const hpBefore = G.hp;
    R.step(1 / 60); steps++;
    for (const t of G.tiles) if (t.kind === 'heart' && !seen.has(t)) { seen.add(t); res.spawned++; res.spawnHp.push(hpBefore); }
    for (const t of seen) if (t.state === 'taken' && !t.counted) { t.counted = true; res.taken++; res.gains.push({ from: hpBefore, to: G.hp }); }
    if (G.hp < hpBefore) res.fails++;
    res.hpMin = Math.min(res.hpMin, G.hp);
    if (G.state === 'run' && G.wi < G.regular) res.hpMaxPreBoss = Math.max(res.hpMaxPreBoss, G.hp);
    if (steps % 300 === 0) await new Promise(r => setTimeout(r, 0));
  }
  res.over = G.state === 'over'; res.wordsDone = G.wordsDone; res.total = G.words.length; res.title = document.getElementById('resTitle').textContent;
  return res;
})`;

// ───────── 1. 사전 단어장 → 게임 ─────────
test('1) 사전 단어장에서 영어 3개를 골라 "게임 시작"을 누르면 게임 페이지가 열리고 선택한 단어만 출제된다', { skip: SKIP }, async () => {
  resetState();
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await page.goto(base + '/english_dictionary.html');
  await page.waitFor("!!document.querySelector('nav') && typeof wordbook !== 'undefined' && wordbook.length > 5", 12000);
  await page.eval("showPage('wordbook')");
  await page.waitFor("document.querySelectorAll('.word-chip-text').length > 5", 5000);
  // 영어 아닌 탭에서는 모드에 들어가지 않고 토스트로 안내
  await page.eval("switchWordbookTab('ko')");
  await page.click('#wb-mode-spell-btn');
  assert.equal(await page.eval('wordbookMode'), 'none', '한국어 탭에서는 선택 게임 모드에 들어가지 않는다');
  assert.match(await page.text('#toast'), /영어 단어장에서만/);
  await page.eval("switchWordbookTab('en')");
  // 이모지·인라인 style 없는 새 버튼
  assert.equal(await page.text('#wb-mode-spell-btn'), '선택 게임');
  await page.click('#wb-mode-spell-btn');
  assert.equal(await page.eval('wordbookMode'), 'spell');
  assert.equal(await page.eval("document.getElementById('wb-selected-action-btn').textContent"), '게임 시작 (0개)');
  // 마크업에는 style 속성이 없다(기존 updateSelectedBtn 이 실행 중에 투명도를 바꾸는 시작 버튼 하나만 예외)
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#wb-select-row [style]')].map(e => e.id)"), ['wb-selected-action-btn'], '선택 줄에 인라인 style 없음');
  const pickWord = async w => { const i = await page.eval(`[...document.querySelectorAll('.word-chip-text')].map(e => e.textContent).indexOf(${JSON.stringify(w)})`); assert.ok(i >= 0, w + ' 칩'); await page.click('.word-chip', { index: i }); };
  // 2개만 고르면 시작하지 않고 토스트
  await pickWord('apple'); await pickWord('book');
  assert.equal(await page.eval("document.getElementById('wb-selected-action-btn').textContent"), '게임 시작 (2개)');
  await page.click('#wb-selected-action-btn');
  assert.match(await page.text('#toast'), /3개 이상/);
  assert.equal(await page.eval('location.pathname'), '/english_dictionary.html', '2개로는 이동하지 않는다');
  await pickWord('environment');
  assert.equal(await page.eval("document.getElementById('wb-selected-action-btn').textContent"), '게임 시작 (3개)');
  await page.click('#wb-selected-action-btn');
  await page.waitFor("location.pathname === '/spelling_run.html'", 8000);
  assert.deepEqual(JSON.parse(await page.eval("sessionStorage.getItem('spellrun_ids')")).sort(), [1, 2, 3]);
  await gameReady(page);
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  assert.deepEqual(await page.eval('SpellRun.G.words.map(w => w.word).sort()'), ['apple', 'book', 'environment'], '선택한 단어만 출제');
  assert.equal(await page.eval('SpellRun.G.words.filter(w => w.boss).map(w => w.word)[0]'), 'environment', '8글자 이상 단어는 보스');
  assert.equal(await page.eval('SpellRun.G.regular'), 2);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '스크립트 오류');
  await page.close();
});

// ───────── 2. 시작 버튼 실제 클릭 ─────────
test('2) 시작 버튼은 좌표 기준 실제 클릭으로 눌리고, 숨겨진 결과·팝업·HUD 화면은 보이지 않거나 클릭을 가로채지 않는다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3] });
  await gameReady(page);
  for (const id of ['result', 'pop', 'bossBanner', 'hud']) assert.equal(await page.eval(`getComputedStyle(document.getElementById('${id}')).display`), 'none', id + ' 숨김');
  assert.equal(await page.eval("getComputedStyle(document.getElementById('gate')).display"), 'none');
  assert.equal(await page.eval("document.getElementById('startInfo').textContent"), '이번 판 2단어 + 보스 1단어 · 체력 5');
  const hit = await page.eval("(() => { const b = document.getElementById('startBtn').getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return t && t.id; })()");
  assert.equal(hit, 'startBtn', '시작 버튼 중심점에 다른 요소가 없다');
  await page.click('#startBtn');   // page.click 은 좌표 위 요소가 대상이 아니면 실패한다
  await page.waitFor("SpellRun.G.state === 'run' && document.getElementById('start').hidden && !document.getElementById('hud').hidden", 4000);
  // 한 판이 끝난 뒤의 결과 화면에서도 "새 판 시작"이 실제 클릭으로 눌린다
  await page.eval('SpellRun.manual = true');
  const r = await page.eval(`${BOT}({ jumpHeart: false })`);
  assert.equal(r.over, true);
  await page.waitFor("!document.getElementById('result').hidden", 3000);
  await page.click('#againBtn');
  await page.waitFor("SpellRun.G.state === 'run' && document.getElementById('result').hidden", 3000);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

// ───────── 3. 안내 화면 ─────────
test('3) 토큰 없음, can_wordbook=false, 선택 단어 없음(sessionStorage 없음)이면 안내만 보이고 게임은 시작하지 않는다', { skip: SKIP }, async () => {
  resetState();
  // 토큰 없음
  let page = await openGame({ ids: [1, 2, 3], token: false });
  assert.match(await page.text('#gateMsg'), /로그인이 필요/);
  assert.match(await page.eval("document.getElementById('gateLink').getAttribute('href')"), /^\/auth\/google\?next=\/spelling_run\.html/);
  assert.equal(await page.eval("document.getElementById('app').hidden"), true);
  assert.equal(state.requests.filter(r => r.url === '/api/wordbook').length, 0, '토큰 없이는 단어장을 부르지 않는다');
  await page.close();
  // 단어장 권한 없음
  state.me.can_wordbook = false;
  page = await openGame({ ids: [1, 2, 3] });
  assert.match(await page.text('#gateMsg'), /권한이 없어/);
  assert.equal(await page.eval("document.getElementById('app').hidden"), true);
  assert.equal(await page.eval("document.getElementById('startBtn').disabled"), true, '시작 버튼은 켜지지 않는다');
  assert.equal(state.requests.filter(r => r.url === '/api/wordbook').length, 0, '권한이 없으면 단어장을 부르지 않는다');
  await page.close();
  // 권한 값이 없어도(알 수 없음) 닫힌 채로 둔다(fail-closed)
  delete state.me.can_wordbook;
  page = await openGame({ ids: [1, 2, 3] });
  assert.match(await page.text('#gateMsg'), /권한이 없어/);
  await page.close();
  state.me.can_wordbook = true;
  // 선택 단어 없음(주소 직접 입력)
  page = await openGame({});
  assert.match(await page.text('#gateMsg'), /단어장에서 단어를 골라/);
  assert.equal(await page.eval("document.getElementById('gateLink').getAttribute('href')"), '/english_dictionary.html#wordbook');
  assert.equal(await page.eval("document.getElementById('app').hidden"), true);
  assert.equal(state.requests.filter(r => r.url === '/api/wordbook').length, 0, '선택 없이 전체 자동 시작하지 않는다');
  await page.close();
});

// ───────── 4. 제외 표시와 중복 제거 ─────────
test('4) 구절·한국어 단어·뜻 없는 단어는 제외 개수에 세고, 소문자 중복은 하나만 남기며, 뜻은 short_meaning → meanings[0].definition 순서다', { skip: SKIP }, async () => {
  resetState();
  // 1 apple, 5 Apple(중복), 6 phrase, 7 nomean, 8 a(한 글자), 9 o'clock, 10 ko, 4 water(meanings만), 2 book, 3 environment
  const page = await openGame({ ids: [1, 5, 6, 7, 8, 9, 10, 4, 2, 3] });
  await gameReady(page);
  assert.equal(await page.text('#startExcluded'), '4개 제외(구절·특수문자)', '구절·뜻 없음·한 글자·한국어 4개');
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const words = await page.eval('SpellRun.G.words.map(w => [w.word, w.meaning, !!w.boss])');
  assert.deepEqual(words.map(w => w[0]).sort(), ["apple", "book", "environment", "o'clock", "water"]);
  assert.equal(words.find(w => w[0] === 'water')[1], '물', '뜻이 없으면 meanings[0].definition');
  assert.equal(words.find(w => w[0] === 'apple')[1], '사과', '중복은 먼저 나온 행(소문자 기준)');
  await page.close();
  // 제외가 없으면 줄이 보이지 않는다
  const p2 = await openGame({ ids: [1, 2, 11] });
  await gameReady(p2);
  assert.equal(await p2.eval("document.getElementById('startExcluded').hidden"), true);
  assert.equal(await p2.eval("document.getElementById('startInfo').textContent"), '이번 판 3단어 · 체력 5', '8글자 이상이 없으면 보스 없음');
  await p2.close();
  // 남은 단어가 3개 미만이면 시작하지 않고 안내
  const p3 = await openGame({ ids: [1, 5, 6, 10, 2] });
  assert.match(await p3.text('#gateMsg'), /2개입니다.*3개 이상 필요/);
  assert.match(await p3.text('#gateMsg'), /2개 제외/);
  assert.equal(await p3.eval("document.getElementById('app').hidden"), true);
  await p3.close();
});

// ───────── 5. 완벽 봇 + 서버 TTS ─────────
test('5) 완벽 봇으로 한 판을 끝내면 /api/tts 는 단어당 1회만, Authorization 헤더와 함께 불리고 느린 재생·결과 칩 탭은 추가 호출이 없다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3], speech: true });
  await gameReady(page);
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval('SpellRun.manual = true');
  const r = await page.eval(`${BOT}({ jumpHeart: false })`);
  assert.equal(r.over, true, '끝까지 진행');
  assert.equal(r.wordsDone, 3); assert.equal(r.total, 3);
  assert.equal(r.title, '보스 격파!');
  assert.equal(r.fails, 0, '완벽 봇은 실패하지 않는다');
  await page.waitFor("!document.getElementById('result').hidden", 3000);
  await sleep(400);
  const calls = ttsCalls();
  assert.equal(calls.length, 3, '단어 3개 → 호출 3회: ' + calls.map(c => c.body).join(' '));
  assert.deepEqual(calls.map(c => JSON.parse(c.body).text).sort(), ['apple', 'book', 'environment']);
  assert.ok(calls.every(c => JSON.parse(c.body).lang === 'en'));
  assert.ok(calls.every(c => /^Bearer \S+/.test(c.auth || '')), 'Authorization 헤더 포함');
  assert.deepEqual(await page.eval("window.__speech.spoken.length ? [window.SpellRun.lastTtsError, ...window.__speech.spoken.map(s => s.text)] : []"), [], "서버 오디오가 재생됐으니 내장 음성으로 대신하지 않았다");
  // 결과 칩을 탭해도(같은 오디오 재사용) 서버 호출이 늘지 않는다
  await page.click('.chip', { index: 0 });
  await sleep(300);
  assert.equal(ttsCalls().length, 3, '칩 탭은 추가 호출 없음');
  // 틀린 단어가 없으니 다시 도전 버튼은 꺼져 있다
  assert.equal(await page.eval("document.getElementById('revBtn').disabled"), true);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

// ───────── 6. TTS 실패 → 내장 음성 ─────────
test('6) /api/tts 가 503 이면 브라우저 내장 음성으로 넘어가 단어를 읽고, 마지막 단어는 0.6배속으로 한 번 더 읽는다', { skip: SKIP }, async () => {
  resetState(); state.tts = 503;
  const page = await openGame({ ids: [1, 2, 3], speech: true });
  await gameReady(page);
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval('SpellRun.manual = true');
  const r = await page.eval(`${BOT}({ jumpHeart: false })`);
  assert.equal(r.over, true);
  await sleep(500);
  const spoken = await page.eval('window.__speech.spoken');
  assert.deepEqual([...new Set(spoken.map(s => s.text))].sort(), ['apple', 'book', 'environment'], '내장 음성으로 세 단어 모두 읽음');
  const last = spoken[spoken.length - 1];
  assert.equal(last.text, 'environment'); assert.equal(last.rate, 0.6, '마지막 단어 두 번째는 0.6배속');
  assert.equal(spoken.filter(s => s.text === 'environment').length, 2, '마지막 단어는 두 번 읽는다');
  assert.equal(ttsCalls().length, 1, '503을 받은 뒤에는 서버 발음을 더 부르지 않는다: ' + ttsCalls().length);
  assert.equal(await page.eval("document.getElementById('popNote').textContent"), '', '내장 음성이 시작됐으니 실패 안내는 없다');
  await page.close();
  // 내장 음성도 없으면 팝업에 안내 문구
  state.tts = 503;
  const p2 = await openGame({ ids: [1, 2, 3] });
  await gameReady(p2);
  await p2.eval("Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); 0");
  await p2.click('#startBtn');
  await p2.waitFor("SpellRun.G.state === 'run'", 4000);
  await p2.eval('SpellRun.manual = true');
  await p2.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; let n = 0; while (G.state !== 'pop' && n++ < 60 * 300) { if (G.state === 'run') { const t = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct)[0]; if (t && G.jumpT < 0 && (t.x - R.RUNNER_X) / G.speed <= C.JUMP_TIME / 2 && t.x > R.RUNNER_X) R.jump(); } R.step(1 / 60); } })()`);
  await p2.waitFor("document.getElementById('popNote').textContent.includes('재생되지 않았습니다')", 4000);
  await p2.close();
});

// ───────── 7. 하트 ─────────
test('7) 하트: 체력이 줄어든 상태에서 점프로 먹으면 +1, 점프하지 않으면 변화 없음, 체력이 가득이면 나오지 않는다', { skip: SKIP }, async () => {
  resetState();
  const ids = [1, 2, 3, 4, 9, 11, 12];   // apple book environment water o'clock happy window → 보스 1 + 정규 6 → 하트 2개 계획
  async function round(opts) {
    const page = await openGame({ ids });
    await gameReady(page);
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    await page.eval('SpellRun.manual = true');
    const res = await page.eval(`${BOT}(${JSON.stringify(opts)})`);
    await page.close();
    return res;
  }
  const a = await round({ hp: 2, jumpHeart: true });
  assert.equal(a.over, true);
  assert.equal(a.regular, 6);
  assert.ok(a.spawned >= 1 && a.spawned <= 2, '하트 1~2개: ' + a.spawned);
  assert.equal(a.taken, a.spawned, '점프한 하트는 모두 먹는다');
  assert.ok(a.gains.every(g => g.to === g.from + 1), '먹으면 +1: ' + JSON.stringify(a.gains));
  assert.ok(a.spawnHp.every(h => h < 5), '체력이 가득이면 나오지 않는다: ' + a.spawnHp);
  const b = await round({ hp: 2, jumpHeart: false });
  assert.ok(b.spawned >= 1, '점프하지 않아도 하트는 나온다');
  assert.equal(b.taken, 0, '점프하지 않으면 먹지 않는다');
  assert.equal(b.hpMaxPreBoss, 2, '점프하지 않으면 체력 변화 없음(보스 직전까지)');
  assert.equal(b.fails, 0, '하트를 무시해도 감점 없음');
  const c = await round({ jumpHeart: true });
  assert.equal(c.spawned, 0, '체력이 가득이면 하트가 나오지 않는다');
});

// ───────── 8. 뒤로가기 ─────────
test('8) 뒤로가기 링크는 /english_dictionary.html#wordbook 이고, 사전은 해시가 있으면 단어장을, 없으면 검색 탭을 연다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3] });
  assert.equal(await page.eval("document.querySelector('.screen-bar-back').getAttribute('href')"), '/english_dictionary.html#wordbook');
  await page.click('.screen-bar-back');
  await page.waitFor("location.pathname === '/english_dictionary.html'", 8000);
  await page.waitFor("document.getElementById('page-wordbook') && document.getElementById('page-wordbook').classList.contains('active')", 8000);
  assert.equal(await page.eval("document.getElementById('page-search').classList.contains('active')"), false);
  assert.equal(await page.eval("document.querySelectorAll('.nav-tab')[1].classList.contains('active')"), true, '하단 탭도 단어장');
  assert.equal(await page.eval('history.state && history.state.page'), 'wordbook');
  assert.equal(await page.eval('location.hash'), '', '주소의 해시는 지워진다');
  await page.close();
  // 해시가 없으면 기존처럼 검색 탭
  const p2 = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await p2.goto(base + '/english_dictionary.html');
  await p2.waitFor("document.getElementById('page-search').classList.contains('active') && typeof wordbook !== 'undefined' && wordbook.length > 0", 12000);
  assert.equal(await p2.eval("document.getElementById('page-wordbook').classList.contains('active')"), false);
  assert.equal(await p2.eval('history.state && history.state.page'), 'search');
  await p2.close();
});

// ───────── 9. 화면 폭 ─────────
for (const w of [320, 390, 768, 1024]) {
  test(`9) ${w}px: 게임 화면에 가로 스크롤이 없고 무대가 본문 열 안에 가운데 놓인다`, { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ ids: [1, 2, 3], width: w, height: 900 });
    await gameReady(page);
    const m = await page.eval(`(() => { const r = e => { const b = document.getElementById(e).getBoundingClientRect(); return { x0: b.left, x1: b.right, h: b.height }; };
      return { sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, box: r('box'), stage: r('stage'), main: (() => { const b = document.querySelector('main').getBoundingClientRect(); return { x0: b.left, x1: b.right }; })() }; })()`);
    assert.ok(m.sw <= m.vw, `가로 스크롤: ${m.sw} > ${m.vw}`);
    assert.ok(m.box.x0 >= m.main.x0 - 0.5 && m.box.x1 <= m.main.x1 + 0.5, `무대가 본문 열 안: ${m.box.x0}~${m.box.x1} (열 ${m.main.x0}~${m.main.x1})`);
    assert.ok(Math.abs((m.box.x0 - m.stage.x0) - (m.stage.x1 - m.box.x1)) <= 1, '무대 좌우 가운데');
    assert.ok(Math.abs(m.box.h / (m.box.x1 - m.box.x0) - 640 / 360) < 0.02, '9:16 비율 유지');
    await page.close();
  });
}
