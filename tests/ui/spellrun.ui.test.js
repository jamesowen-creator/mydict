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
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); } catch (e) {}" });   // 작업319: 저장된 주소 옵션이 다른 시험으로 새지 않게 비운다
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

// ───────── 작업318: 폰트 맞춤 · 힌트 · 완성 연출 · 2단 점프 · 주소 옵션 ─────────
const RICH = (id, word, short, extra) => ({ id, word, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - id).toISOString(), data: { word, lang: 'en', short_meaning: short, ...extra } });
const LONG_MEAN = '매우 비범하고 특별하여 평범한 수준을 크게 뛰어넘는다는 뜻의 형용사';        // 25자 이상, 공백 있음
const LONG_NOSPACE = '비범하고특별하여평범한수준을뛰어넘는형용사';                     // 공백 없는 22자(한 글자씩 끊기면 안 된다)
const HINT_ROWS = [
  RICH(21, 'extraordinary', LONG_MEAN, { pronunciation: '/ɪkˈstrɔːrdəneri/', meanings: [
    { pos: 'adjective', definition: LONG_MEAN, usage_note: '평범하지 않은 능력이나 사건을 크게 칭찬하거나 놀랄 때 쓰는 말이며 격식 있는 글과 말에서 모두 자주 쓰인다.', example: 'She is an extraordinary pianist with an extraordinarily long list of awards.' },
    { pos: 'adjective', definition: '보통과 아주 다른 이상한 것을 가리킬 때' }, { pos: 'adjective', definition: '임시로 소집된 특별한 회의를 말할 때' }, { pos: 'adjective', definition: '더 있는 뜻' }] }),
  RICH(22, 'beautiful', LONG_NOSPACE, { pronunciation: '/ˈbjuːtɪfl/', meanings: [{ pos: 'adjective', definition: '아름다운', usage_note: '짧은 설명', example: 'What a beautiful day, and a beautifully quiet one!' }] }),
  RICH(23, 'environment', '환경', { pronunciation: '/ɪnˈvaɪrənmənt/', meanings: [{ pos: 'noun', definition: '환경', example: 'We must protect the environment and the environments around us.' }] }),
  RICH(24, 'happy', '행복한', { meanings: [{ pos: 'adjective', definition: '행복한', usage_note: 'happy 는 기분이 좋을 때 쓴다.', example: 'She was happier than ever; the happiest day. Happily!' }, { pos: 'adjective', definition: '만족스러운' }] }),
  RICH(25, 'window', '창문', { meanings: [{ pos: 'noun', definition: '창문' }] }),                               // 예문·usage_note 없는 오래된 데이터
  RICH(26, 'friend', '친구', { example_sentence_hint: 1 }),                                                       // meanings 자체가 없는 옛 스키마
  { ...RICH(27, 'music', '음악', {}), example_sentence: 'Loud music filled the room; musicians love musical music.' },  // wordbook 의 example_sentence 열
  RICH(28, 'ran', '달렸다', { meanings: [{ pos: 'verb', definition: '달렸다', example: 'He ran fast.' }] }),
];
const WIDTHS = [320, 360, 390, 768, 1024];
const queryOf = q => (q ? '?' + q : '');
async function openQ({ ids, query = '', width = 390, height = 844, keep = false }) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: jwt() });
  if (!keep) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); } catch (e) {}" });   // 작업319: keep=true 가 아니면 저장된 주소 옵션을 비우고 시작
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(ids))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + queryOf(query));
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  return page;
}
// 페이지 안: 화면 밖으로 나간 요소·가로 넘침을 모두 찾는다(보이는 것만)
const OVERFLOW = `(() => {
  const box = document.getElementById('box').getBoundingClientRect(), bad = [];
  const chk = (el, name) => {
    if (!el || el.hidden || el.closest('[hidden]')) return;
    const r = el.getBoundingClientRect(); if (!r.width) return;
    if (r.left < box.left - 1 || r.right > box.right + 1) bad.push(name + ' 상자 밖 ' + Math.round(r.left - box.left) + '~' + Math.round(r.right - box.left));
    if (el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('clip')) bad.push(name + ' 가로 넘침 ' + el.scrollWidth + '>' + el.clientWidth);
  };
  const $ = id => document.getElementById(id);
  ['meaning', 'word', 'hint', 'pop', 'popWord', 'popPron', 'popMean', 'popEx', 'resTitle', 'resScore', 'resChips'].forEach(id => chk($(id), id));
  document.querySelectorAll('#word .slot, #word .cell, #hint > *, #popWord .pl, #resChips .chip').forEach((e, i) => chk(e, e.className + i));
  return bad;
})()`;
// 수동 진행: 조건이 될 때까지 완벽 봇(1회 점프)으로 step 을 돌린다
const ADVANCE = `(async (until, opts) => {
  const R = window.SpellRun, G = R.G, C = R.CONFIG; R.manual = true;
  let steps = 0;
  const T = C.JUMP_TIME;
  while (steps < 60 * 900 && G.state !== 'over' && !eval(until)) {
    if (G.state === 'run') {
      const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
      if (tg) {
        const tta = (tg.x - R.RUNNER_X) / G.speed;
        if (tg.high && opts && opts.double) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); }
        else if (G.jumpT < 0 && tta <= T / 2) R.jump();
      }
    }
    R.step(1 / 60); steps++;
    if (steps % 300 === 0) await new Promise(r => setTimeout(r, 0));
  }
  return { steps, state: G.state };
})`;
const advance = (page, until, opts) => page.eval(`${ADVANCE}(${JSON.stringify(until)}, ${JSON.stringify(opts || {})})`);

test('318-1) 최악 입력(13글자 단어·25자 넘는 뜻·보스 7칸·긴 조각 칸)에서 글자 칸 줄·뜻·힌트·완성 팝업·결과 화면 어디에도 가로 넘침이 없다(폭 320·360·390·768·1024)', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  for (const width of WIDTHS) {
    const page = await openQ({ ids: [21, 22, 23, 24, 25, 26, 27], width, height: width >= 768 ? 1000 : 844 });
    // 난수를 0 쪽으로 고정하면 조각 칸이 항상 선택된다(= 칸 수·폭이 가장 큰 경우)
    await page.eval('Math.random = () => 0.0001');
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run' && !document.getElementById('hud').hidden", 4000);
    const seen = [];
    for (let k = 0; k < 4; k++) {
      await advance(page, "G.state === 'run' && G.time > 0 && true", {});   // 곧바로 반환(현재 단어 시작 직후 측정)
      const bad0 = await page.eval(OVERFLOW);
      assert.deepEqual(bad0, [], `${width}px 단어 시작: ${JSON.stringify(bad0)}`);
      const info = await page.eval(`({ w: SpellRun.G.words[SpellRun.G.wi].word, slots: SpellRun.G.plan.slots.length, chunks: SpellRun.G.plan.slots.filter(s => s.chunk).map(s => s.len), mean: document.getElementById('meaning').getBoundingClientRect().height / parseFloat(document.getElementById('box').style.getPropertyValue('--u')), word: document.getElementById('word').scrollWidth <= document.getElementById('word').clientWidth + 1 })`);
      seen.push(info);
      assert.ok(info.word);
      await advance(page, "G.state === 'pop'", {});
      const badP = await page.eval(OVERFLOW);
      assert.deepEqual(badP, [], `${width}px 팝업: ${JSON.stringify(badP)}`);
      // 완성 팝업의 단어는 한 줄: 모든 글자의 윗변이 같다
      const tops = await page.eval("[...document.querySelectorAll('#popWord .pl')].map(e => e.offsetTop)");
      assert.ok(tops.length >= 2 && new Set(tops).size === 1, `${width}px 팝업 단어 한 줄: ${tops}`);
      if (await page.eval("SpellRun.G.wi + 1 >= SpellRun.G.words.length")) break;
      await advance(page, "G.state === 'run' && G.wi > " + (await page.eval('SpellRun.G.wi')), {});
    }
    assert.ok(seen.some(s => s.chunks.length > 0), '조각 칸이 있는 단어로 확인: ' + JSON.stringify(seen));
    assert.ok(seen.some(s => s.w.length >= 9), '긴 단어 포함');
    await advance(page, "G.state === 'over'", {});
    const badR = await page.eval(OVERFLOW);
    assert.deepEqual(badR, [], `${width}px 결과: ${JSON.stringify(badR)}`);
    assert.equal(await page.hasHorizontalScroll(), false, width + 'px 가로 스크롤');
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '스크립트 오류');
    await page.close();
  }
});

test('318-1) 한글 뜻은 단어 단위로 줄바꿈된다(한 글자씩 끊기지 않음): 공백 없는 긴 뜻은 글자를 줄여 맞추고, 공백 있는 뜻은 공백에서 줄바꿈', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  for (const width of [320, 390]) {
    const page = await openQ({ ids: [21, 22, 25], width });
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    for (let k = 0; k < 3; k++) {
      const m = await page.eval(`(() => { const e = document.getElementById('meaning'), cs = getComputedStyle(e); return { wb: cs.wordBreak, ow: cs.overflowWrap, text: e.textContent, fs: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), h: e.scrollHeight, over: e.scrollWidth > e.clientWidth + 1 }; })()`);
      assert.equal(m.wb, 'keep-all'); assert.equal(m.over, false);
      const lines = Math.round(m.h / m.lh);
      assert.ok(lines <= 2, `뜻 ${lines}줄: ${m.text}`);
      if (m.text.length > 20 && !/\s/.test(m.text)) { assert.equal(lines, 1, '공백 없는 긴 뜻은 한 글자씩 끊지 않고 글자 크기를 줄여 한 줄에'); assert.equal(m.ow, 'normal'); }
      assert.ok(m.fs >= 8, '글자 크기 하한');
      await advance(page, "G.state === 'pop'", {});
      if (await page.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
      await advance(page, 'G.state === "run" && G.wi > ' + (await page.eval('SpellRun.G.wi')), {});
    }
    await page.close();
  }
});

test('318-1) 리사이즈·회전 때 다시 계산된다: 폭을 320 으로 줄이면 넘침이 없고 글자 크기가 배율에 맞춰 다시 정해진다', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [21, 22, 23], width: 1024, height: 1000 });
  await page.eval('Math.random = () => 0.0001');
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  assert.deepEqual(await page.eval(OVERFLOW), []);
  for (const [w, h] of [[320, 568], [568, 320], [390, 844], [1024, 1000]]) {
    await page.resize(w, h);
    await page.eval("window.dispatchEvent(new Event('resize'))");
    await new Promise(r => setTimeout(r, 150));
    assert.deepEqual(await page.eval(OVERFLOW), [], `${w}x${h}`);
  }
  await page.close();
});

test('318-2) 힌트: 대표 뜻·품사·빈칸 예문·다른 뜻·쓰임 설명이 우선순위대로 보이고, 정답 단어(활용형·대소문자 포함)는 DOM 어디에도 그대로 나타나지 않는다', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [21, 22, 23, 24, 25, 26, 27, 28] });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const forms = await page.eval('(() => { const out = {}; SpellRun.G.words.forEach(w => { out.__ = 1; }); return 1; })()');
  const seenWords = [];
  for (let k = 0; k < 8; k++) {
    const d = await page.eval(`(() => { const G = SpellRun.G, w = G.words[G.wi]; const h = document.getElementById('hint');
      return { word: w.word, meaning: document.getElementById('meaning').textContent, hint: h.hidden ? '' : [...h.children].filter(c => !c.hidden).map(c => c.className + '|' + c.textContent), hintHidden: h.hidden, html: document.getElementById('hud').innerHTML }; })()`);
    seenWords.push(d.word);
    const text = d.meaning + ' ' + (Array.isArray(d.hint) ? d.hint.join(' ') : '');
    const re = new RegExp('(?<![A-Za-z])' + d.word + '(s|es|ed|d|ing|ly|er|ers|est)?(?![A-Za-z])', 'i');
    assert.ok(!re.test(text), `${d.word}: 힌트에 정답이 보임: ${text}`);
    assert.ok(!re.test(d.html.replace(/<[^>]+>/g, ' ')), `${d.word}: HUD DOM 에 정답이 보임`);
    const hl = Array.isArray(d.hint) ? d.hint : [];
    if (d.word === 'happy') {
      assert.deepEqual(d.hint.map(x => x.split('|')[0]).slice(0, 2), ['h-pos', 'h-ex']);
      assert.ok(d.hint[1].includes('＿＿'), '예문의 happier/happiest/Happily 는 가려진다: ' + d.hint[1]);
      assert.ok(d.hint[0].endsWith('형용사'));
    }
    if (d.word === 'music') assert.ok(hl.some(x => x.startsWith('h-ex|') && x.includes('＿＿')), 'example_sentence 열 사용');
    if (d.word === 'ran') assert.ok(hl.some(x => x.startsWith('h-ex|He ＿＿ fast')), '예문 속 정답 자체도 가려진다');
    if (d.word === 'window' || d.word === 'friend') assert.ok(!hl.some(x => x.startsWith('h-ex') || x.startsWith('h-note')), '예문·쓰임 설명이 없는 오래된 데이터는 있는 항목만');
    await advance(page, 'G.state === "pop"', {});
    if (await page.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
    await advance(page, 'G.state === "run" && G.wi > ' + (await page.eval('SpellRun.G.wi')), {});
  }
  assert.ok(seenWords.length >= 7, '여러 단어 확인: ' + seenWords);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '오래된 데이터에서도 오류 없음');
  assert.equal(state.requests.filter(r => !/\/api\/(me|wordbook|tts)$/.test(r.url) && r.url.startsWith('/api/')).length, 0, '힌트용 AI/API 호출 없음');
  await page.close();
});

test('318-2) 힌트는 단어가 진행되는 동안 고정(움직이지 않음)이고, 글자 칸 줄 아래·높은 칸 타일 위쪽보다 위에 있다(360×640 논리 크기·320px 폭)', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  for (const width of [320, 360]) {
    const page = await openQ({ ids: [21, 24, 27], query: 'dj=1&highprob=1', width });
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    const geo = () => page.eval(`(() => { const u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')), b = document.getElementById('box').getBoundingClientRect();
      const y = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: (r.top - b.top) / u, bottom: (r.bottom - b.top) / u }; };
      return { word: y('word'), hint: y('hint'), hintHidden: document.getElementById('hint').hidden, u }; })()`);
    const g1 = await geo();
    await advance(page, 'G.time > 3', {});
    const g2 = await geo();
    assert.deepEqual([g1.hint.top, g1.hint.bottom], [g2.hint.top, g2.hint.bottom], '진행 중 위치 고정');
    assert.ok(!g1.hintHidden);
    assert.ok(g1.hint.top >= g1.word.bottom - 0.5, '글자 칸 줄과 겹치지 않음: ' + JSON.stringify(g1));
    const highTop = await page.eval('(SpellRun.HIGH_Y - 29 - 3)');   // 높은 칸 타일 윗변(bob 3 포함, 논리 px)
    assert.ok(g1.hint.bottom <= highTop - 8, `힌트 아래 ${g1.hint.bottom.toFixed(1)} 가 높은 칸 타일 윗변 ${highTop} 보다 8 이상 위: ` + width);
    // 일반 타일 영역(TILE_Y-29)과도 겹치지 않음
    assert.ok(g1.hint.bottom < (await page.eval('SpellRun.TILE_Y - 29')));
    await page.close();
  }
});

test('318-3) 완성 팝업: 단어(한 줄)·발음기호(있을 때만)·대표 뜻·예문 순서, 예문에서 정답과 활용형은 강조(가리지 않음), 단어를 못 찾으면 강조 없이, 글자 날아오기 변수', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [24, 25, 28, 22, 27] });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const popFor = async () => {
    await advance(page, 'G.state === "pop"', {});
    return page.eval(`(() => { const p = document.getElementById('pop'), kids = [...p.children].filter(c => !c.hidden && c.textContent).map(c => c.id + '=' + c.textContent);
      return { word: SpellRun.G.words[SpellRun.G.wi].word, kids, marks: [...document.querySelectorAll('#popEx b')].map(b => b.textContent), ex: document.getElementById('popEx').textContent,
        letters: [...document.querySelectorAll('#popWord .pl')].map(e => [e.textContent, e.style.getPropertyValue('--i'), e.style.getPropertyValue('--fx') !== '' && e.style.getPropertyValue('--fy') !== '']), wordText: document.getElementById('popWord').textContent }; })()`);
  };
  const seen = {};
  for (let k = 0; k < 5; k++) {
    const d = await popFor(); seen[d.word] = d;
    assert.equal(d.wordText, d.word); assert.deepEqual(d.letters.map(l => l[0]).join(''), d.word);
    assert.ok(d.letters.every((l, i) => l[1] === String(i) && l[2]), '글자마다 순서(--i)와 날아올 위치(--fx/--fy)');
    const order = d.kids.map(x => x.split('=')[0]);
    assert.deepEqual(order, ['popTag', 'popWord', 'popPron', 'popMean', 'popEx'].filter(id => order.includes(id)).sort((a, b) => ['popTag', 'popWord', 'popPron', 'popMean', 'popEx'].indexOf(a) - ['popTag', 'popWord', 'popPron', 'popMean', 'popEx'].indexOf(b)), '표시 순서');
    if (await page.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
    await advance(page, 'G.state === "run" && G.wi > ' + (await page.eval('SpellRun.G.wi')), {});
  }
  const names = Object.keys(seen);
  const hp = seen.happy;
  if (hp) { assert.deepEqual(hp.marks, ['happier', 'happiest', 'Happily'], '활용형 강조(가리지 않음)'); assert.ok(hp.ex.includes('happier')); assert.ok(!hp.kids.some(x => x.startsWith('popPron')), '발음기호가 없으면 줄 없음'); }
  const bf = seen.beautiful; if (bf) { assert.ok(bf.kids.some(x => x.startsWith('popPron=/ˈbjuːtɪfl/')), '발음기호 표시'); assert.deepEqual(bf.marks, ['beautiful', 'beautifully']); }
  const wd = seen.window; if (wd) assert.ok(!wd.kids.some(x => x.startsWith('popEx')), '예문이 없으면 줄 없음');
  const rn = seen.ran; if (rn) assert.deepEqual(rn.marks, ['ran']);
  assert.ok(names.length >= 4, '여러 단어 확인: ' + names);
  // 단어를 찾지 못하는 예문은 강조 없이 표시
  await page.close();
  state.rows = [RICH(31, 'apple', '사과', { meanings: [{ pos: 'noun', definition: '사과', example: 'It was a fruit.' }] }), RICH(32, 'book', '책', { meanings: [{ definition: '책' }] }), RICH(33, 'house', '집', {})];
  const p2 = await openQ({ ids: [31, 32, 33] });
  await p2.click('#startBtn'); await p2.waitFor("SpellRun.G.state === 'run'", 4000);
  for (let k = 0; k < 3; k++) {
    await advance(p2, 'G.state === "pop"', {});
    const x = await p2.eval(`({ w: SpellRun.G.words[SpellRun.G.wi].word, ex: document.getElementById('popEx').textContent, hidden: document.getElementById('popEx').hidden, marks: document.querySelectorAll('#popEx b').length })`);
    if (x.w === 'apple') { assert.equal(x.ex, 'It was a fruit.'); assert.equal(x.marks, 0); }
    else assert.equal(x.hidden, true);
    if (await p2.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
    await advance(p2, 'G.state === "run" && G.wi > ' + (await p2.eval('SpellRun.G.wi')), {});
  }
  await p2.close();
});

test('318-2/3) 시간 값: 단어 시작 대기 2.2초(첫 단어 +0.4), 팝업 1.6초·마지막 단어 3.2초 그대로', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3] });
  await gameReady(page);
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const sp = await page.eval('SpellRun.G.spawnT');
  assert.ok(sp > 2.3 && sp <= 2.6, '첫 단어는 2.2 + 0.4 에서 시작해 시간이 흐르는 중: ' + sp);
  assert.deepEqual(await page.eval('[SpellRun.CONFIG.WORD_START_DELAY, SpellRun.CONFIG.POP_SEC, SpellRun.CONFIG.POP_SEC_FINAL]'), [2.2, 1.6, 3.2]);
  await page.close();
});

test('318-4) ?dj 없음·dj=0 에서는 높은 칸이 나오지 않고 점프 규칙도 예전과 같다(공중에서 또 눌러도 2단 점프 없음, 점프 버퍼만)', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  for (const query of ['', 'dj=0&highprob=1']) {
    const page = await openQ({ ids: [21, 22, 23, 24, 27], query });
    assert.equal(await page.eval('SpellRun.CONFIG.DJ_ENABLED'), false);
    assert.equal(await page.eval("document.getElementById('djRule').hidden"), true);
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    const r = await page.eval(`(async () => { const R = SpellRun, G = R.G; R.manual = true; let high = 0, slotsHigh = 0, steps = 0;
      while (steps < 60 * 400 && G.state !== 'over' && G.wi < 3) { if (G.plan) slotsHigh += G.plan.slots.filter(s => s.high).length; for (const t of G.tiles) if (t.high) high++;
        const tg = G.tiles.find(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart'); if (tg && G.jumpT < 0 && (tg.x - R.RUNNER_X) / G.speed <= R.CONFIG.JUMP_TIME / 2) R.jump(); R.step(1 / 60); steps++; }
      return { high, slotsHigh }; })()`);
    assert.deepEqual(r, { high: 0, slotsHigh: 0 });
    // 공중에서 다시 눌러도 점프 버퍼만(2단 점프 없음)
    const j = await page.eval(`(() => { const R = SpellRun, G = R.G; G.state = 'run'; G.jumpT = -1; R.jump(); R.step(0.1); R.jump(); return { j2: G.j2, buf: G.jumpBuf, h: R.curH() }; })()`);
    assert.equal(j.j2, -1); assert.ok(j.buf > 0 && j.h <= 118.01);
    assert.equal(await page.eval("document.getElementById('tune').hidden"), query === '', '옵션이 없으면 표시 없음 / dj=0·highprob=1 은 조정값 사용 중');
    await page.close();
  }
});

test('318-4) ?dj=1: 높은 칸이 나오고(첫 칸 제외·최대 2개·전부는 아님) 2단 점프 봇은 획득해 가산점(+100, 배율 이전)을 받고, 한 번 점프만 하는 봇은 놓친다', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const run = async double => {
    const page = await openQ({ ids: [21, 22, 23, 24, 27, 25], query: 'dj=1&highprob=1' });
    assert.equal(await page.eval('SpellRun.CONFIG.DJ_ENABLED'), true);
    assert.equal(await page.eval("document.getElementById('djRule').hidden"), false, '시작 화면 규칙 문구');
    assert.equal(await page.eval("document.getElementById('tune').hidden"), false);
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    const out = await page.eval(`(async (double) => { const R = SpellRun, G = R.G, C = R.CONFIG; R.manual = true; const T = C.JUMP_TIME;
      const res = { plans: [], highTiles: 0, taken: 0, missedHigh: 0, bonusFloats: 0, bonusPts: [], mixedPack: false, sameHeightPack: true, hp0: G.hp, hpMin: G.hp, steps: 0, hearts: 0 };
      const seenIds = new Set(), seenPlan = new Set(); let lastWi = -1;
      while (res.steps < 60 * 500 && G.state !== 'over' && G.wi < 4) {
        if (G.plan && lastWi !== G.wi) { lastWi = G.wi; res.plans.push(G.plan.slots.map(s => !!s.high)); }
        if (G.state === 'run') {
          const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
          if (tg) { const tta = (tg.x - R.RUNNER_X) / G.speed;
            if (tg.high && double) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); }
            else if (G.jumpT < 0 && tta <= T / 2) R.jump(); }
        }
        const scoreBefore = G.score, floatsBefore = G.floats.length;
        const tilesHigh = G.tiles.filter(t => t.high && t.state === 'live' && t.correct && !t.checked && t.x - R.RUNNER_X <= G.speed / 60 + 0.01 && t.x > R.RUNNER_X - 1);
        R.step(1 / 60); res.steps++;
        for (const t of G.tiles) { if (t.high && !seenIds.has(t)) { seenIds.add(t); res.highTiles++; } }
        for (const f of G.floats) if (/^2단 점프 \\+100$/.test(f.text) && !f.counted) { f.counted = true; res.bonusFloats++; }
        res.hpMin = Math.min(res.hpMin, G.hp);
        const packs = {}; for (const t of G.tiles) if (t.kind !== 'heart' && t.state === 'live') { (packs[t.id] = packs[t.id] || new Set()).add(!!t.high); } for (const k in packs) if (packs[k].size > 1) res.sameHeightPack = false;
      }
      res.taken = G.tiles.length; res.score = G.score; res.state = G.state; res.combo = G.maxCombo; return res; })(${double})`);
    const errs = page.errors.filter(e => !/Failed to load resource/.test(e));
    await page.close();
    return { out, errs };
  };
  const good = await run(true);
  assert.deepEqual(good.errs, []);
  assert.ok(good.out.highTiles > 0, '높은 칸 타일이 나온다');
  for (const plan of good.out.plans) {
    assert.equal(plan[0], false, '첫 칸은 높은 칸이 아니다');
    assert.ok(plan.filter(Boolean).length <= 2, '최대 2개');
    assert.ok(plan.length < 2 || !plan.every(Boolean), '모든 칸이 높은 칸은 아니다');
  }
  assert.ok(good.out.plans.some(p => p.some(Boolean)));
  assert.ok(good.out.sameHeightPack, '같은 묶음의 후보 타일은 모두 같은 높이');
  assert.ok(good.out.bonusFloats > 0, '"2단 점프 +100" 표시');
  assert.equal(good.out.hpMin, good.out.hp0, '2단 점프 봇은 실수 없이 통과: 체력 ' + good.out.hpMin);
  const bad = await run(false);
  assert.deepEqual(bad.errs, []);
  assert.equal(bad.out.bonusFloats, 0, '한 번 점프만 하는 봇은 높은 칸을 먹지 못한다');
  assert.ok(bad.out.hpMin < bad.out.hp0, '높은 정답 칸을 놓쳐 체력이 줄어든다');
});

test('318-4) 2단 점프 가산점과 판정(페이지 안): 높은 칸 획득 점수는 (기본+100)×콤보×속도 배율, 일반 칸은 그대로, 일반 칸에서 실수로 2단 점프가 나가면 기존 규칙대로 판정', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [21, 24, 27], query: 'dj=1' });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const r = await page.eval(`(() => { const R = SpellRun, G = R.G, C = R.CONFIG; R.manual = true; const L = window.SpellRunLogic; const out = {};
    const put = (high, correct, h) => { G.tiles.length = 0; G.state = 'run'; G.packActive = true; G.packId++;
      const t = { id: G.packId, x: R.RUNNER_X - 1, w: 58, text: G.plan.slots[G.si].text, correct, chunk: false, high, state: 'live', t: 0, age: 1, checked: false, ok: false, color: '#fff' };
      G.tiles.push(t); G.jumpT = h > 0 ? 0.2 : -1; G.j2 = -1; return t; };
    // 일반 칸을 2단 점프 높이(200px)에서 지나가면 공중이므로 hit
    G.si = 0; G.score = 0; G.combo = 0; G.speed = G.speedTarget = C.SPEED_MIN;
    let t = put(false, true, 1); G.j2 = 0.1; G.j2h = 118; G.j2Land = L.secondJumpLandTime(118); out.normalAirH = R.curH(); R.step(1 / 600);
    out.normalHit = t.state === 'taken' && t.ok; out.normalScore = G.score - 0;
    // 높은 칸: 높이 118(한 번 점프 꼭대기) → 놓침, 높이 200 → 획득
    G.si = 0; G.hp = C.HP; G.combo = 0; G.score = 0; t = put(true, true, 1); G.jumpT = C.JUMP_TIME / 2; G.j2 = -1; out.highH1 = R.curH(); R.step(1 / 600); out.highMissed = t.state === 'fade' || t.state === 'hint'; out.hpAfterMiss = G.hp;
    G.si = 0; G.combo = 0; G.score = 0; G.hp = C.HP; G.speed = G.speedTarget = C.SPEED_MIN; t = put(true, true, 1); G.jumpT = 0.2; G.j2 = 0.12; G.j2h = 118; G.j2Land = L.secondJumpLandTime(118); out.highH2 = R.curH();
    const sm = L.speedMult(G.speed); R.step(1 / 600); out.highHit = t.state === 'taken' && t.ok;
    const slot = G.plan.slots[0]; out.expected = Math.round(L.slotPoints(slot.text.length, 1, C, C.HIGH_BONUS) * sm * (G.words[G.wi].boss ? C.BOSS_MULT : 1)); out.score = G.score;
    // 높은 오답 칸: 높이 118 이면 통과, 200 이면 오답
    G.si = 0; G.hp = C.HP; t = put(true, false, 1); G.jumpT = C.JUMP_TIME / 2; G.j2 = -1; R.step(1 / 600); out.highWrongPass = t.state === 'live' && G.hp === C.HP;
    G.si = 0; t = put(true, false, 1); G.jumpT = 0.2; G.j2 = 0.12; G.j2h = 118; R.step(1 / 600); out.highWrongHit = G.hp === C.HP - 1;
    return out; })()`);
  assert.ok(r.normalAirH > 22 && r.normalHit, JSON.stringify(r));
  assert.ok(r.highH1 < 160 && r.highMissed && r.hpAfterMiss === 4, JSON.stringify(r));
  assert.ok(r.highH2 >= 160 && r.highHit, JSON.stringify(r));
  assert.equal(r.score, r.expected, '가산점은 배율 이전: ' + JSON.stringify(r));
  assert.ok(r.highWrongPass && r.highWrongHit, JSON.stringify(r));
  await page.close();
});

test('318-5) 주소 옵션: 허용 항목은 적용되고 "조정값 사용 중"이 보이며, 범위 밖·숫자 아님은 무시되고, 옵션이 없으면 표시도 없다', { skip: SKIP }, async () => {
  resetState();
  const cfgOf = page => page.eval('(() => { const C = SpellRun.CONFIG; return { hp: C.HP, sd: C.WORD_START_DELAY, pop: C.POP_SEC, fin: C.POP_SEC_FINAL, hp2: C.HIGH_SLOT_PROB, he: C.HEART_EVERY, dj: C.DJ_ENABLED, jt: C.JUMP_TIME, smin: C.SPEED_MIN }; })()');
  const badge = page => page.eval("(() => { const e = document.getElementById('tune'); const r = e.getBoundingClientRect(); return { hidden: e.hidden, text: e.textContent, w: r.width, title: e.title }; })()");
  let page = await openQ({ ids: [1, 2, 3] });
  const base0 = await cfgOf(page);
  assert.deepEqual(await badge(page), { hidden: true, text: '조정값 사용 중', w: 0, title: '' }, '옵션 없음: 표시 없음');
  assert.deepEqual([base0.hp, base0.sd, base0.pop, base0.fin, base0.he, base0.dj], [5, 2.2, 1.6, 3.2, 3, false]);
  assert.equal(await page.eval("document.getElementById('startInfo').textContent"), '이번 판 2단어 + 보스 1단어 · 체력 5');
  await page.close();
  page = await openQ({ ids: [1, 2, 3], query: 'pace=1.1&hp=7&startdelay=2.6&popsec=2&highprob=0.3&heartevery=4&dj=1' });
  const c = await cfgOf(page);
  assert.deepEqual([c.hp, c.sd, c.pop, c.fin, c.hp2, c.he, c.dj], [7, 2.6, 2, 4, 0.3, 4, true]);
  assert.ok(Math.abs(c.jt - 0.6 / 1.1) < 0.002 && c.smin === Math.round(130 * 1.1 * 100) / 100, 'pace 는 CONFIG 를 한 번에: ' + JSON.stringify(c));
  const b = await badge(page);
  assert.equal(b.hidden, false); assert.equal(b.text, '조정값 사용 중'); assert.ok(b.w > 20 && b.title.includes('pace') && b.title.includes('dj'));
  assert.match(await page.eval("document.getElementById('startInfo').textContent"), /체력 7$/);
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
  // 범위 밖·숫자 아님은 무시(유효한 hp 만 적용)
  page = await openQ({ ids: [1, 2, 3], query: 'pace=9&hp=6&startdelay=abc&popsec=99&highprob=2&heartevery=0&dj=5&unknown=1' });
  const d = await cfgOf(page);
  assert.deepEqual([d.hp, d.sd, d.pop, d.he, d.dj, d.jt, d.hp2], [6, 2.2, 1.6, 3, false, base0.jt, 0.2]);
  assert.deepEqual(await page.eval('SpellRun.OPT.applied'), ['hp']);
  assert.equal((await badge(page)).hidden, false);
  await page.close();
  page = await openQ({ ids: [1, 2, 3], query: 'pace=9&hp=abc&dj=x' });
  assert.equal((await badge(page)).hidden, true, '적용된 옵션이 없으면 표시도 없다');
  assert.deepEqual(await cfgOf(page), base0);
  await page.close();
});

// ───────── 작업319: 주소 옵션 저장 ─────────
const OPTS_KEY = 'spellrun_opts';
const lsOpts = page => page.eval("localStorage.getItem('spellrun_opts')");
const clearOpts = async () => { const p = await browser.newPage({ width: 390, height: 844, token: jwt() }); await p.goto(base + '/spelling_run.html?reset=1'); await p.eval("localStorage.removeItem('spellrun_opts')"); await p.close(); };

test('319-1) 옵션만으로 직접 열어(안내 화면) 저장 → 사전에서 "게임 시작"으로 들어가도 적용되고 "조정값 사용 중"이 보인다', { skip: SKIP }, async () => {
  resetState(); await clearOpts();
  try {
    let page = await browser.newPage({ width: 390, height: 844, token: jwt() });
    await page.goto(base + '/spelling_run.html?dj=1&hp=7&pace=9&popsec=abc');   // 선택 단어 없음 → 안내 화면. pace·popsec 은 범위 밖/숫자 아님
    await page.waitFor("document.getElementById('gateMsg').textContent !== '불러오는 중...'", 8000);
    assert.equal(await page.eval("document.getElementById('app').hidden"), true, '안내 화면');
    assert.deepEqual(JSON.parse(await lsOpts(page)), { dj: 1, hp: 7 }, '유효한 항목만 저장');
    await page.close();
    // 사전에서 선택 게임으로 시작
    resetState();
    page = await browser.newPage({ width: 390, height: 844, token: jwt() });
    await page.goto(base + '/english_dictionary.html');
    await page.waitFor("!!document.querySelector('nav') && typeof wordbook !== 'undefined' && wordbook.length > 5", 12000);
    await page.eval("showPage('wordbook')");
    await page.waitFor("document.querySelectorAll('.word-chip-text').length > 5", 5000);
    await page.eval("switchWordbookTab('en')");
    await page.click('#wb-mode-spell-btn');
    for (const w of ['apple', 'book', 'environment']) { const i = await page.eval(`[...document.querySelectorAll('.word-chip-text')].map(e => e.textContent).indexOf(${JSON.stringify(w)})`); await page.click('.word-chip', { index: i }); }
    await page.click('#wb-selected-action-btn');
    await page.waitFor("location.pathname === '/spelling_run.html'", 8000);
    assert.equal(await page.eval('location.search'), '', '사전에서 이동하면 주소 옵션은 없다');
    await gameReady(page);
    assert.deepEqual(await page.eval('[SpellRun.CONFIG.DJ_ENABLED, SpellRun.CONFIG.HP]'), [true, 7], '저장값 적용');
    assert.equal(await page.eval("document.getElementById('tune').hidden"), false);
    assert.equal(await page.text('#tune'), '조정값 사용 중');
    assert.match(await page.text('#startInfo'), /체력 7$/);
    await page.close();
  } finally { await clearOpts(); }
});

test('319-1) 주소 값이 저장값을 항목 단위로 덮어쓰고, 기본값과 같은 값만 있으면 표시가 없다', { skip: SKIP }, async () => {
  resetState(); await clearOpts();
  try {
    let p = await openQ({ ids: [1, 2, 3], query: 'dj=1&hp=7' , keep: true }); await p.close();
    p = await openQ({ ids: [1, 2, 3], query: 'hp=9' , keep: true });
    assert.deepEqual(await p.eval('[SpellRun.CONFIG.DJ_ENABLED, SpellRun.CONFIG.HP]'), [true, 9]);
    assert.deepEqual(JSON.parse(await lsOpts(p)), { dj: 1, hp: 9 });
    await p.close();
    p = await openQ({ ids: [1, 2, 3] , keep: true });   // 옵션 없음 → 저장값(hp 9)
    assert.equal(await p.eval('SpellRun.CONFIG.HP'), 9); await p.close();
    await clearOpts();
    p = await openQ({ ids: [1, 2, 3], query: 'hp=5&dj=0&pace=1.3' , keep: true });   // 전부 기본값과 같다
    assert.equal(await p.eval("document.getElementById('tune').hidden"), true, '기본값과 같은 값만 있으면 표시 없음');
    assert.deepEqual(JSON.parse(await lsOpts(p)), { hp: 5, dj: 0, pace: 1.3 });
    await p.close();
    p = await openQ({ ids: [1, 2, 3] , keep: true });
    assert.equal(await p.eval("document.getElementById('tune').hidden"), true); await p.close();
  } finally { await clearOpts(); }
});

test('319-1) 해제: ?reset=1 로 열면 저장값이 지워지고 기본값, "조정값 사용 중"을 누르면 저장값을 지우고 다시 열린다(텍스트·44px 이상·박스·이모지 없음)', { skip: SKIP }, async () => {
  resetState(); await clearOpts();
  try {
    let p = await openQ({ ids: [1, 2, 3], query: 'dj=1&hp=7' , keep: true });
    // 표시 모양
    const st = await p.eval("(() => { const e = document.getElementById('tune'), c = getComputedStyle(e), r = e.getBoundingClientRect(); return { tag: e.tagName, h: r.height, w: r.width, bg: c.backgroundColor, bd: c.borderTopWidth, deco: c.textDecorationLine, text: e.textContent, emoji: /\\p{Extended_Pictographic}/u.test(e.textContent) }; })()");
    assert.deepEqual([st.tag, st.bg, st.bd, st.deco, st.text, st.emoji], ['BUTTON', 'rgba(0, 0, 0, 0)', '0px', 'underline', '조정값 사용 중', false]);
    assert.ok(st.h >= 44 && st.w >= 44, '터치 영역 44px 이상: ' + st.h + 'x' + st.w);
    await p.click('#tune');
    await p.waitFor("location.search === '?reset=1'", 6000);
    await p.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
    assert.equal(await lsOpts(p), null, '저장값 삭제'); assert.equal(await p.eval('SpellRun.CONFIG.HP'), 5); assert.equal(await p.eval('SpellRun.CONFIG.DJ_ENABLED'), false);
    assert.equal(await p.eval("document.getElementById('tune').hidden"), true);
    await p.close();
    p = await openQ({ ids: [1, 2, 3], query: 'dj=1' , keep: true }); await p.close();
    p = await openQ({ ids: [1, 2, 3], query: 'reset=1&hp=8' , keep: true });   // reset 이 우선: 다른 옵션도 무시
    assert.equal(await lsOpts(p), null); assert.equal(await p.eval('SpellRun.CONFIG.HP'), 5); assert.equal(await p.eval('SpellRun.CONFIG.DJ_ENABLED'), false);
    await p.close();
    p = await openQ({ ids: [1, 2, 3] , keep: true });
    assert.equal(await p.eval('SpellRun.CONFIG.DJ_ENABLED'), false, '이후에도 기본값'); await p.close();
  } finally { await clearOpts(); }
});

test('319-1) localStorage 를 쓸 수 없으면(읽기·쓰기 예외) 예외 없이 이번 방문에만 적용된다', { skip: SKIP }, async () => {
  resetState(); await clearOpts();
  state.requests.length = 0;
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem, s = Storage.prototype.setItem, d = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (k) { if (k === 'spellrun_opts') throw new Error('blocked'); return g.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (k === 'spellrun_opts') throw new Error('blocked'); return s.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { if (k === 'spellrun_opts') throw new Error('blocked'); return d.call(this, k); };
    sessionStorage.setItem('spellrun_ids', '[1,2,3]'); })();` });
  await page.goto(base + '/spelling_run.html?dj=1&hp=7');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  assert.deepEqual(await page.eval('[SpellRun.CONFIG.DJ_ENABLED, SpellRun.CONFIG.HP]'), [true, 7], '이번 방문에는 적용');
  assert.equal(await page.eval("document.getElementById('tune').hidden"), false);
  await page.click('#tune');   // 지우기도 예외 없이 다시 열린다
  await page.waitFor("location.search === '?reset=1'", 6000);
  await page.waitFor("!document.getElementById('app').hidden", 8000);
  assert.equal(await page.eval('SpellRun.CONFIG.HP'), 5);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '예외 없음');
  await page.close();
});
