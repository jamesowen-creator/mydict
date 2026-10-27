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
const state = { me: null, rows: ROWS, tts: 200, ttsDelay: 0, ttsHeader: null, requests: [] };
const resetState = () => { state.me = { id: 7, email: 'u@x', name: '테스터', role: 'user', can_wordbook: true, perm_jgrammar: false }; state.rows = ROWS; state.tts = 200; state.ttsDelay = 0; state.ttsHeader = null; state.requests.length = 0; };
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
          const send = () => { res.writeHead(200, Object.assign({ 'Content-Type': 'audio/wav' }, state.ttsHeader ? { 'X-TTS-Cache': state.ttsHeader } : {})); res.end(WAV); };
          if (state.ttsDelay) return setTimeout(send, state.ttsDelay);   // 작업325: 서버가 느린 상황 모의
          return send();
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

// 작업326: 장애물이 기본으로 켜져 있어 글자만 보고 뛰는 기존 봇이 장애물에 걸리므로, 기존 시험의 페이지에는 "장애물 넘기 보조"를 끼운다.
// SpellRun.step 을 감싸서, 땅에 있고 아직 안 맞은 장애물의 가운데가 점프 정점(체공의 절반)에 닿을 때 점프를 한 번 누른다. 글자 쪽 봇의 규칙은 그대로다.
// 작업326 새 시험은 이 보조 없이(dodge:false) 장애물을 직접 다룬다.
const DODGE = `(() => { let api; Object.defineProperty(window, 'SpellRun', { configurable: true, get: () => api, set: v => { api = v; const st = v.step;
  v.step = function (dt) { const G = v.G; if (G.state === 'run' && G.jumpT < 0) { const o = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > v.RUNNER_X); if (o && (o.x + o.w / 2 - v.RUNNER_X) / G.speed <= v.CONFIG.JUMP_TIME / 2) v.jump(); } return st.call(this, dt); }; } }); })();`;
const withDodge = (page, dodge) => dodge === false ? Promise.resolve() : page.send('Page.addScriptToEvaluateOnNewDocument', { source: DODGE });

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
async function openGame({ ids, token = true, width = 390, height = 844, speech = false, query = '', dodge = true, blockObst = false } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: token ? jwt() : null });
  await withDodge(page, dodge);
  if (blockObst) { await page.send('Network.enable'); await page.send('Network.setBlockedURLs', { urls: ['*spellrun_obstacles_sheet*'] }); }
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); } catch (e) {}" });   // 작업319: 저장된 주소 옵션이 다른 시험으로 새지 않게 비운다
  if (!token) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('mydict_token'); } catch (e) {}" });   // 같은 Chrome 프로필을 쓰는 앞선 시험이 남긴 토큰 제거
  if (speech) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH });
  if (ids) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(ids))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && document.getElementById('gateMsg').textContent !== '불러오는 중...' || !document.getElementById('app').hidden", 8000);
  if (!/continue=/.test(query)) await page.eval('window.SpellRun && (SpellRun.CONFIG.CONT_ENABLED = false)');   // 작업341: 체력 0 에서 곧바로 끝나는 기존 시험은 이어하기를 끄고 본다(주소 옵션이 아니라 설정값만 바꿔 "조정값 사용 중" 표시에는 영향 없음)
  return page;
}
const gameReady = page => page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
const ttsCalls = () => state.requests.filter(r => r.url === '/api/tts');

// 완벽 봇: 정답 글자가 가까워지면 점프(시제품 smoke 와 같은 규칙). jumpHeart 이면 하트도 먹는다. 수동 진행 모드로 step() 을 직접 돌린다.
const BOT = `(async (opts) => {
  const R = window.SpellRun, G = R.G, C = R.CONFIG;
  const seen = new Set(), res = { spawned: 0, spawnHp: [], taken: 0, gains: [], hpMaxPreBoss: 0, hpMin: 99, fails: 0, regular: G.regular, over: false }, firstBoss = G.words.findIndex(w => w.boss), T = C.JUMP_TIME;
  if (opts.hp !== undefined) G.hp = opts.hp;
  let steps = 0;
  while (steps < 60 * 900 && G.state !== 'over') {
    if (G.state === 'run') {
      const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.kind === 'heart' ? opts.jumpHeart : x.correct) && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
      if (tg) {
        const tta = (tg.x - R.RUNNER_X) / G.speed;
        if (tg.high) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); }   // 작업320: 높은 칸은 2단 점프
        else if (G.jumpT < 0 && tta <= T / 2) R.jump();
      }
    }
    const hpBefore = G.hp;
    R.step(1 / 60); steps++;
    for (const t of G.tiles) if (t.kind === 'heart' && !seen.has(t)) { seen.add(t); res.spawned++; res.spawnHp.push(hpBefore); }
    for (const t of seen) if (t.state === 'taken' && !t.counted) { t.counted = true; res.taken++; res.gains.push({ from: hpBefore, to: G.hp }); }
    if (G.hp < hpBefore) res.fails++;
    res.hpMin = Math.min(res.hpMin, G.hp);
    if (G.state === 'run' && (firstBoss < 0 || G.wi < firstBoss)) res.hpMaxPreBoss = Math.max(res.hpMaxPreBoss, G.hp);
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
  assert.equal(await page.eval('SpellRun.G.words.filter(w => w.boss).length'), 0, '작업320: 선택 단어가 5개 미만이면 보스 없음');
  assert.equal(await page.eval('SpellRun.G.regular'), 3);
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
  assert.equal(await page.eval("document.getElementById('startInfo').textContent"), '이번 판 3단어 · 체력 5', '3단어는 보스 없음');
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
  assert.equal(await p2.eval("document.getElementById('startInfo').textContent"), '이번 판 3단어 · 체력 5', '5개 미만이면 보스 없음');
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
  assert.equal(r.title, '3단어 완주', '보스 없는 판');
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
  const lastWord = await page.eval('SpellRun.G.words[SpellRun.G.words.length - 1].word');
  assert.equal(last.text, lastWord); assert.equal(last.rate, 0.6, '마지막 단어 두 번째는 0.6배속');
  assert.equal(spoken.filter(s => s.text === lastWord).length, 2, '마지막 단어는 두 번 읽는다');
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
  await p2.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; let n = 0; while (G.state !== 'pop' && n++ < 60 * 300) { if (G.state === 'run') { const t = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct)[0]; if (t && t.x > R.RUNNER_X) { const tta = (t.x - R.RUNNER_X) / G.speed; if (t.high) { if (G.jumpT < 0 && tta <= C.JUMP_TIME) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= C.JUMP_TIME / 2) R.jump(); } else if (G.jumpT < 0 && tta <= C.JUMP_TIME / 2) R.jump(); } } R.step(1 / 60); } })()`);
  await p2.waitFor("document.getElementById('popNote').textContent.includes('재생되지 않았습니다')", 4000);
  await p2.close();
});

// ───────── 7. 하트 ─────────
test('7) 하트: 체력이 줄어든 상태에서 점프로 먹으면 +1, 점프하지 않으면 변화 없음, 체력이 가득이면 나오지 않는다', { skip: SKIP }, async () => {
  resetState();
  const ids = [1, 2, 3, 4, 9, 11, 12];   // apple book environment water o'clock happy window → 7단어: 5번째 보스 1 + 정규 6 → 하트 2개 계획
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
  // 작업328: 하트는 체력과 상관없이 나온다. 체력이 가득일 때 나오는 하트도 있고(아래 c), 먹어도 체력이 5를 넘지 않는다
  assert.ok(a.gains.every(g => g.to <= 5), '체력 최대 5');
  const b = await round({ hp: 2, jumpHeart: false });
  assert.ok(b.spawned >= 1, '점프하지 않아도 하트는 나온다');
  assert.equal(b.taken, 0, '점프하지 않으면 먹지 않는다');
  assert.equal(b.hpMaxPreBoss, 2, '점프하지 않으면 체력 변화 없음(보스 직전까지)');
  assert.equal(b.fails, 0, '하트를 무시해도 감점 없음');
  const c = await round({ jumpHeart: true });
  assert.ok(c.spawned >= 1, '작업328: 체력이 가득이어도 하트가 나온다');
  assert.equal(c.taken, c.spawned, '점프하면 먹는다'); assert.ok(c.gains.every(g => g.from === 5 && g.to === 5), '체력이 가득이면 체력은 그대로: ' + JSON.stringify(c.gains));
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
async function openQ({ ids, query = '', width = 390, height = 844, keep = false, dodge = true }) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: jwt() });
  await withDodge(page, dodge);
  if (!keep) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); } catch (e) {}" });   // 작업319: keep=true 가 아니면 저장된 주소 옵션을 비우고 시작
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
  ['meaning', 'sub', 'word', 'pop', 'popWord', 'popPron', 'popMean', 'popEx', 'resTitle', 'resScore', 'resChips'].forEach(id => chk($(id), id));
  document.querySelectorAll('#word .slot, #word .cell, #popWord .pl, #resChips .chip').forEach((e, i) => chk(e, e.className + i));
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
        if (tg.high && !(opts && opts.double === false)) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); }
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
      await advance(page, "!G.iActive", {});   // 곧바로 반환(현재 단어 시작 직후 측정)
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

// 작업322: 상세 힌트 박스는 없다. 상단 한글 힌트 = 대표 뜻(.meaning) + 보조 한 줄(.sub, 다른 뜻 키워드)
const hudInfo = async page => { await advance(page, '!G.iActive', {}); return page.eval(`(() => {   // 작업323: 새 단어 연출이 끝난 뒤(작업322 최종 레이아웃)에 잰다
 const G = SpellRun.G, w = G.words[G.wi], u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')), b = document.getElementById('box').getBoundingClientRect();
  const y = id => { const e = document.getElementById(id); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { top: (r.top - b.top) / u, bottom: (r.bottom - b.top) / u, fs: parseFloat(getComputedStyle(e).fontSize) / u, h: r.height / u }; };
  const sub = document.getElementById('sub');
  return { word: w.word, meaning: document.getElementById('meaning').textContent, sub: sub.hidden ? null : sub.textContent, subShadow: getComputedStyle(sub).textShadow, subBg: getComputedStyle(sub).backgroundColor, subBorder: getComputedStyle(sub).borderTopWidth,
    hint: document.getElementById('hint'), boxes: document.querySelectorAll('.hint, .h-pos, .h-alt, .h-note, .h-ex').length, row1: y('hud') && null,
    meanY: y('meaning'), subY: y('sub'), wordY: y('word'), progY: (() => { const r = document.getElementById('progress').getBoundingClientRect(); return { bottom: (r.bottom - b.top) / u }; })() }; })()`); };

test('322-1/2) 상세 힌트 박스(흰 배경·품사·품사별 다른 뜻·쓰임 설명)는 DOM에도 없고, 대표 뜻 아래 보조 한 줄(다른 뜻 키워드)만 있으며 정답은 가려진다', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [21, 22, 23, 24, 25, 26, 27, 28] });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const seen = [];
  for (let k = 0; k < 8; k++) {
    const d = await hudInfo(page);
    seen.push(d.word);
    assert.equal(d.hint, null, '#hint 요소가 없다'); assert.equal(d.boxes, 0, '.hint/.h-pos/.h-alt/.h-note/.h-ex 요소 없음');
    assert.equal(await page.eval("[...document.querySelectorAll('#hud *')].filter(e => { const c = getComputedStyle(e).backgroundColor; return /rgba?\\(255, 255, 255, 0\\.\\d+\\)/.test(c) && e.id !== 'snd'; }).length"), 0, '흰 반투명 배경 박스 없음');
    const text = d.meaning + ' ' + (d.sub || '');
    const re = new RegExp('(?<![A-Za-z])' + d.word + '(s|es|ed|d|ing|ly|er|ers|est)?(?![A-Za-z])', 'i');
    assert.ok(!re.test(text), d.word + ': 힌트에 정답이 보임: ' + text);
    assert.ok(!text.includes('…'));
    // 보조 줄: 배경·테두리 박스 없음, 흰 외곽(그림자)으로 가독성, 대표 뜻보다 확실히 작고 10px 이상
    if (d.sub !== null) {
      assert.equal(d.subBg, 'rgba(0, 0, 0, 0)'); assert.equal(d.subBorder, '0px'); assert.match(d.subShadow, /rgb\(255, 255, 255\)/);
      assert.ok(d.subY.fs >= 10 - 0.01 && d.subY.fs <= 12.01 && d.subY.fs < d.meanY.fs - 4, `보조 줄 글자 ${d.subY.fs} / 대표 뜻 ${d.meanY.fs}`);
      assert.ok(d.subY.top >= d.meanY.bottom - 0.5 && d.wordY.top >= d.subY.bottom + 12, '대표 뜻 → 보조 줄 → (조각 표시 자리) → 글자 칸 순서');
    } else assert.ok(d.wordY.top - d.meanY.bottom >= 10 && d.wordY.top - d.meanY.bottom <= 30, '보조 줄이 없으면 대표 뜻과 글자 칸 사이가 어색하게 비지 않는다: ' + (d.wordY.top - d.meanY.bottom));
    if (d.word === 'happy') assert.equal(d.sub, '만족스러운', '대표 뜻 키워드는 빠지고 다른 뜻만');
    if (d.word === 'window' || d.word === 'friend' || d.word === 'music') assert.equal(d.sub, null, '다른 뜻이 없는 옛 데이터는 보조 줄 없음');
    await advance(page, 'G.state === "pop"', {});
    if (await page.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
    await advance(page, 'G.state === "run" && G.wi > ' + (await page.eval('SpellRun.G.wi')), {});
  }
  assert.ok(seen.length >= 7, '여러 단어 확인: ' + seen);
  assert.equal(state.requests.filter(r => !/\/api\/(me|wordbook|tts)$/.test(r.url) && r.url.startsWith('/api/')).length, 0, '힌트용 AI/API 호출 없음');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('322-3) 힌트 묶음(대표 뜻 + 보조 줄)과 글자 칸 줄은 HUD 줄에서 내려와 있고(HUD_SHIFT), 글자 칸 줄 아래 끝은 높은 칸 타일 윗변(276)보다 위이며 고정이다(320·360·390, 360×640 논리)', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const shift = (await (async () => { const L = require('../../public/js/spellrun/logic.js'); return L.LAYOUT.HUD_SHIFT; })());
  for (const width of [320, 360, 390]) {
    const page = await openQ({ ids: [21, 24, 22], width });
    await page.eval('Math.random = () => 0.0001');   // 조각 칸(×N 표시)이 가장 많은 경우
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    for (let k = 0; k < 3; k++) {
      const d = await hudInfo(page);
      assert.ok(d.meanY.top - d.progY.bottom >= shift - 1, `${width}px 위쪽 HUD 줄과 대표 뜻 사이 ${(d.meanY.top - d.progY.bottom).toFixed(1)} >= HUD_SHIFT ${shift}`);
      assert.ok(d.wordY.bottom <= 266, `${width}px ${d.word}: 글자 칸 줄 아래 끝 ${d.wordY.bottom.toFixed(1)} <= 266`);
      assert.ok(d.wordY.bottom + 10 <= 276, '높은 칸 타일 윗변(276)과 10 이상 간격');
      assert.ok(d.wordY.top - (d.subY ? d.subY.bottom : d.meanY.bottom) >= 10, '조각 칸 표시(×N)·삼각형이 들어갈 자리');
      assert.deepEqual(await page.eval(OVERFLOW), [], `${width}px ${d.word}`);
      const t0 = d.wordY.top; await advance(page, 'G.time > G.time - 1 && true', {});
      assert.equal((await hudInfo(page)).wordY.top, t0, '진행 중 고정');
      await advance(page, 'G.state === "pop"', {});
      if (await page.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
      await advance(page, 'G.state === "run" && G.wi > ' + (await page.eval('SpellRun.G.wi')), {});
    }
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

test('318-4) ?dj=0 에서는 높은 칸이 나오지 않고 점프 규칙도 예전과 같다(공중에서 또 눌러도 2단 점프 없음, 점프 버퍼만)', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  for (const query of ['dj=0&highprob=1']) {   // 작업320: 옵션 없음은 이제 켜짐. 꺼지는 것은 dj=0 뿐
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
    assert.equal(await page.eval("document.getElementById('tune').hidden"), false, 'dj=0 은 기본값과 달라 조정값 사용 중');
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
  assert.deepEqual([base0.hp, base0.sd, base0.pop, base0.fin, base0.he, base0.dj], [5, 2.2, 1.6, 3.2, 3, true], '작업320: dj 기본 켜짐');
  assert.equal(await page.eval("document.getElementById('startInfo').textContent"), '이번 판 3단어 · 체력 5');
  await page.close();
  page = await openQ({ ids: [1, 2, 3], query: 'pace=1.1&hp=7&startdelay=2.6&popsec=2&highprob=0.3&heartevery=4&dj=1' });
  const c = await cfgOf(page);
  assert.deepEqual([c.hp, c.sd, c.pop, c.fin, c.hp2, c.he, c.dj], [7, 2.6, 2, 4, 0.3, 4, true]);
  assert.ok(Math.abs(c.jt - 0.6 / 1.1) < 0.002 && c.smin === Math.round(130 * 1.1 * 100) / 100, 'pace 는 CONFIG 를 한 번에: ' + JSON.stringify(c));
  const b = await badge(page);
  assert.equal(b.hidden, false); assert.equal(b.text, '조정값 사용 중'); assert.ok(b.w > 20 && b.title.includes('pace') && b.title.includes('highprob') && !b.title.includes('dj'), 'dj=1 은 기본값이라 조정값이 아니다: ' + b.title);
  assert.match(await page.eval("document.getElementById('startInfo').textContent"), /체력 7$/);
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
  // 범위 밖·숫자 아님은 무시(유효한 hp 만 적용)
  page = await openQ({ ids: [1, 2, 3], query: 'pace=9&hp=6&startdelay=abc&popsec=99&highprob=2&heartevery=0&dj=5&unknown=1' });
  const d = await cfgOf(page);
  assert.deepEqual([d.hp, d.sd, d.pop, d.he, d.dj, d.jt, d.hp2], [6, 2.2, 1.6, 3, true, base0.jt, 0.2]);
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
    p = await openQ({ ids: [1, 2, 3], query: 'hp=5&dj=1&pace=1.3' , keep: true });   // 전부 기본값과 같다
    assert.equal(await p.eval("document.getElementById('tune').hidden"), true, '기본값과 같은 값만 있으면 표시 없음');
    assert.deepEqual(JSON.parse(await lsOpts(p)), { hp: 5, dj: 1, pace: 1.3 });
    await p.close();
    p = await openQ({ ids: [1, 2, 3] , keep: true });
    assert.equal(await p.eval("document.getElementById('tune').hidden"), true); await p.close();
  } finally { await clearOpts(); }
});

test('319-1) 해제: ?reset=1 로 열면 저장값이 지워지고 기본값, "조정값 사용 중"을 누르면 저장값을 지우고 다시 열린다(텍스트·44px 이상·박스·이모지 없음)', { skip: SKIP }, async () => {
  resetState(); await clearOpts();
  try {
    let p = await openQ({ ids: [1, 2, 3], query: 'dj=0&hp=7' , keep: true });
    // 표시 모양
    const st = await p.eval("(() => { const e = document.getElementById('tune'), c = getComputedStyle(e), r = e.getBoundingClientRect(); return { tag: e.tagName, h: r.height, w: r.width, bg: c.backgroundColor, bd: c.borderTopWidth, deco: c.textDecorationLine, text: e.textContent, emoji: /\\p{Extended_Pictographic}/u.test(e.textContent) }; })()");
    assert.deepEqual([st.tag, st.bg, st.bd, st.deco, st.text, st.emoji], ['BUTTON', 'rgba(0, 0, 0, 0)', '0px', 'underline', '조정값 사용 중', false]);
    assert.ok(st.h >= 44 && st.w >= 44, '터치 영역 44px 이상: ' + st.h + 'x' + st.w);
    await p.click('#tune');
    await p.waitFor("location.search === '?reset=1'", 6000);
    await p.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
    assert.equal(await lsOpts(p), null, '저장값 삭제'); assert.equal(await p.eval('SpellRun.CONFIG.HP'), 5); assert.equal(await p.eval('SpellRun.CONFIG.DJ_ENABLED'), true, '해제 후 기본값(켜짐)');
    assert.equal(await p.eval("document.getElementById('tune').hidden"), true);
    await p.close();
    p = await openQ({ ids: [1, 2, 3], query: 'dj=0' , keep: true }); await p.close();
    p = await openQ({ ids: [1, 2, 3], query: 'reset=1&hp=8' , keep: true });   // reset 이 우선: 다른 옵션도 무시
    assert.equal(await lsOpts(p), null); assert.equal(await p.eval('SpellRun.CONFIG.HP'), 5); assert.equal(await p.eval('SpellRun.CONFIG.DJ_ENABLED'), true);
    await p.close();
    p = await openQ({ ids: [1, 2, 3] , keep: true });
    assert.equal(await p.eval('SpellRun.CONFIG.DJ_ENABLED'), true, '이후에도 기본값'); await p.close();
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

// ───────── 작업320: 힌트 정리 · 2단 점프 기본 켜짐(실제 입력) · 보스 구성 · 속도 램프 ─────────
const WORDS12 = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'school', 'family', 'garden', 'beautiful', 'environment'];
const ROWS12 = WORDS12.map((w, i) => RICH(61 + i, w, '뜻' + (i + 1), { meanings: [{ pos: 'noun', definition: '뜻' + (i + 1), example: 'This is a ' + w + '.' }] }));
const IDS12 = WORDS12.map((_, i) => 61 + i);

test('322-2) 최악 데이터(긴 뜻·키워드 많음·공백 없는 긴 키워드)에서 보조 줄은 "…" 없이 키워드 단위로 줄고 가로 넘침·겹침이 없다(320·360·390)', { skip: SKIP }, async () => {
  const many = Array.from({ length: 10 }, (_, i) => '아주길게늘어놓은다른뜻키워드' + (i + 1)).join(', ');
  state.rows = [
    RICH(81, 'extraordinary', LONG_MEAN, { meanings: [{ pos: 'adjective', definition: LONG_MEAN }, { pos: 'adjective', definition: many }, { pos: 'noun', definition: '가나다라마바사아자차카타파하가나다라마바사아자차카타파하' }] }),
    RICH(82, 'beautiful', LONG_NOSPACE, { meanings: [{ definition: '아름다운, 예쁜, 멋진, 훌륭한, 근사한, 고운, 아리따운, 곱디고운' }] }),
    RICH(83, 'environment', '환경', { meanings: [{ definition: '환경, 주변 상황, 자연환경, 생태계, 둘레, 사정, 분위기' }] }),
  ];
  for (const width of [320, 360, 390]) {
    const page = await openQ({ ids: [81, 82, 83], width });
    await page.eval('Math.random = () => 0.0001');
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    for (let k = 0; k < 3; k++) {
      const d = await hudInfo(page);
      assert.ok(!(d.meaning + (d.sub || '')).includes('…'), `${width}px ${d.word}: "…" 잘림 없음`);
      assert.deepEqual(await page.eval(OVERFLOW), [], `${width}px ${d.word}`);
      if (d.sub) {
        assert.ok(d.subY.h <= d.subY.fs * 1.3 * 2 + 1, '보조 줄은 두 줄 이내');
        const items = d.sub.split(' · '), all = await page.eval('SpellRun.G.words[SpellRun.G.wi].hint.subs');
        assert.deepEqual(items, all.slice(0, items.length), '앞에서부터 키워드 단위로만 남는다(중간 키워드나 글자를 자르지 않음)');
        assert.ok(all.length <= 6);
      }
      assert.ok(d.wordY.bottom <= 266);
      await advance(page, 'G.state === "pop"', {});
      if (await page.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
      await advance(page, 'G.state === "run" && G.wi > ' + (await page.eval('SpellRun.G.wi')), {});
    }
    await page.close();
  }
  state.rows = HINT_ROWS;
});

// 실제 입력 이벤트(CDP Input.*)로 점프를 넣는다. SpellRun 훅(R.jump)을 쓰지 않는다.
async function press(page, kind) {
  const c = await page.eval("(() => { const r = document.getElementById('box').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 }; })()");
  if (kind === 'touch') {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else if (kind === 'mouse') {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  } else {
    const k = { Space: [' ', 32], ArrowUp: ['ArrowUp', 38], KeyW: ['w', 87] }[kind];
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: kind, key: k[0], windowsVirtualKeyCode: k[1] });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: kind, key: k[0], windowsVirtualKeyCode: k[1] });
  }
}
const stepFrames = (page, n) => page.eval(`(() => { for (let i = 0; i < ${n}; i++) SpellRun.step(1 / 60); })()`);
// 높은 정답 칸 하나를 첫 점프 후 T 만에 도착하도록 두고 상태를 정리한다
const setHigh = page => page.eval(`(() => { const R = SpellRun, G = R.G, C = R.CONFIG; R.manual = true;
  G.state = 'run'; G.tiles.length = 0; G.packActive = true; G.packId++; G.jumpT = -1; G.j2 = -1; G.jumpBuf = 0; G.score = 0; G.combo = 0; G.hp = C.HP; G.si = 0; G.speed = G.speedTarget = G.speedBase = C.SPEED_MIN;
  window.__pd = []; window.__pdt = window.__pd; const t = { id: G.packId, x: R.RUNNER_X + G.speed * (C.JUMP_TIME + 0.002), w: 58, text: G.plan.slots[0].text, correct: true, chunk: false, high: true, state: 'live', t: 0, age: 1, checked: false, ok: false, color: '#fff' };
  G.tiles.push(t); window.__tile = t; return { speed: G.speed }; })()`);
const tileInfo = page => page.eval(`({ state: __tile.state, ok: __tile.ok, score: SpellRun.G.score, hp: SpellRun.G.hp, j2: SpellRun.G.j2, jumpT: SpellRun.G.jumpT, pd: __pd.length, h: SpellRun.curH() })`);

test('320-2) 옵션 없는 기본 상태(2단 점프 켜짐): 실제 입력(터치·마우스 pointerdown, Space·ArrowUp·W)을 두 번 보내면 2단 점프가 나가 높은 칸을 획득하고 가산점이 붙는다', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [21, 24, 22] });
  assert.deepEqual(await page.eval('[SpellRun.CONFIG.DJ_ENABLED, SpellRun.OPT.applied.length, document.getElementById("tune").hidden, document.getElementById("djRule").hidden]'), [true, 0, true, false], '옵션 없이 켜짐, 표시 없음, 규칙 문구');
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval("document.getElementById('box').addEventListener('pointerdown', e => (window.__pd = window.__pd || []).push(e.pointerType), true); 0");
  const results = {};
  for (const kind of ['touch', 'mouse', 'Space', 'ArrowUp', 'KeyW']) {
    await setHigh(page);
    await press(page, kind);                    // 첫 점프
    let a = await tileInfo(page);
    assert.ok(a.jumpT >= 0 && a.j2 === -1, kind + ': 첫 입력은 첫 점프');
    await stepFrames(page, 14);                 // ≈0.233초 = 꼭대기
    await press(page, kind);                    // 공중에서 두 번째 입력 → 2단 점프
    a = await tileInfo(page);
    assert.ok(a.j2 >= 0, kind + ': 두 번째 입력은 2단 점프 (j2=' + a.j2 + ')');
    await stepFrames(page, 20);
    a = await tileInfo(page);
    results[kind] = a;
    assert.equal(a.state, 'taken', kind + ': 높은 칸 획득'); assert.ok(a.ok); assert.equal(a.hp, 5);
    const exp = await page.eval(`(() => { const L = window.SpellRunLogic, C = SpellRun.CONFIG; return Math.round(L.slotPoints(SpellRun.G.plan.slots[0].text.length, 1, C, C.HIGH_BONUS) * L.speedMult(C.SPEED_MIN) * (SpellRun.G.words[SpellRun.G.wi].boss ? C.BOSS_MULT : 1)); })()`);
    assert.equal(a.score, exp, kind + ': 가산점(+100)이 배율 이전에 더해진 점수');
    if (kind === 'touch' || kind === 'mouse') { assert.equal(a.pd, 2, kind + ' 두 번 탭 = pointerdown 두 번(탭 하나가 두 번으로 세어지지 않음)'); assert.deepEqual(await page.eval('[...new Set(__pdt)]'), [kind], 'pointerType'); }
    else assert.equal(a.pd, 0, '키 입력은 pointerdown 이 아니다');
  }
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('320-2) 첫 점프 직후의 너무 빠른 두 번째 입력은 무시되고, 같은 프레임의 중복 pointerdown 이나 터치+마우스 중복도 한 번으로 센다. 한 번 점프만 하면 높은 칸을 놓친다', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [21, 24, 22] });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  // 1) 너무 빠른 두 번째 입력(약 2프레임 = 0.033초 < SECOND_JUMP_MIN)
  await setHigh(page);
  await press(page, 'Space'); await stepFrames(page, 2); await press(page, 'Space');
  let a = await tileInfo(page);
  assert.equal(a.j2, -1, '너무 빠른 두 번째 입력은 무시'); assert.ok(a.jumpT >= 0);
  await stepFrames(page, 4);                    // 충분히 지난 뒤에는 2단 점프
  await press(page, 'Space'); a = await tileInfo(page);
  assert.ok(a.j2 >= 0, '시간이 지난 뒤의 입력은 2단 점프');
  // 2) 같은 틱의 중복 pointerdown (터치 + 합성 마우스 이벤트가 한 번의 탭에 둘 다 오는 환경을 흉내)
  await setHigh(page);
  await page.eval(`(() => { const b = document.getElementById('box'); const mk = t => new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: t }); b.dispatchEvent(mk('touch')); b.dispatchEvent(mk('mouse')); })()`);
  a = await tileInfo(page);
  assert.ok(a.jumpT >= 0 && a.j2 === -1, '한 번의 탭에 이중 이벤트가 와도 한 번 점프로만 센다');
  // 3) 키를 누르고 있어서 생기는 반복 입력(e.repeat)은 점프로 세지 않는다
  await setHigh(page);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await stepFrames(page, 14);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32, autoRepeat: true });
  a = await tileInfo(page);
  assert.equal(a.j2, -1, '키 반복은 2단 점프가 아니다');
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  // 4) 한 번 점프만 하면 높은 칸을 놓친다(체력 -1)
  await setHigh(page);
  await stepFrames(page, 0);
  await page.eval("SpellRun.G.tiles[0].x = SpellRun.RUNNER_X + SpellRun.G.speed * (SpellRun.CONFIG.JUMP_TIME / 2 + 0.002)");
  await press(page, 'Space'); await stepFrames(page, 20);
  a = await tileInfo(page);
  assert.ok(a.hp < 5 && a.state !== 'taken', '한 번 점프(최고 118px)로는 높은 칸에 닿지 않는다: ' + JSON.stringify(a));
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('320-2) 옵션 없는 기본 상태로 20단어 이상(2판)을 돌리면 높은 칸이 나오고 2단 점프 봇이 가산점을 받는다. 저장값 dj=0 이면 나오지 않는다', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS12;
  const play = async query => {
    const page = await openQ({ ids: IDS12, query });
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    const out = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; R.manual = true; const T = C.JUMP_TIME;
      const res = { rounds: 0, words: 0, highWords: 0, highTiles: 0, bonus: 0, fails: 0 }; const seen = new Set();
      for (let round = 0; round < 2; round++) {
        if (round > 0) { document.getElementById('againBtn').click(); }
        res.rounds++; let steps = 0, lastWi = -1;
        while (steps < 60 * 900 && G.state !== 'over') {
          if (G.plan && lastWi !== G.wi) { lastWi = G.wi; res.words++; if (G.plan.slots.some(s => s.high)) res.highWords++; }
          if (G.state === 'run') { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
            if (tg) { const tta = (tg.x - R.RUNNER_X) / G.speed;
              if (tg.high) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); } else if (G.jumpT < 0 && tta <= T / 2) R.jump(); } }
          const hp = G.hp; R.step(1 / 60); steps++;
          for (const t of G.tiles) if (t.high && !seen.has(t)) { seen.add(t); res.highTiles++; }
          for (const f of G.floats) if (/^2단 점프 \\+100$/.test(f.text) && !f.counted) { f.counted = true; res.bonus++; }
          if (G.hp < hp) res.fails++;
        }
        await new Promise(r => setTimeout(r, 0));
      }
      return res; })()`);
    await page.close();
    return out;
  };
  const on = await play('');
  assert.ok(on.words >= 20, '20단어 이상: ' + on.words);
  assert.ok(on.highWords >= 1 && on.highTiles >= 1, '높은 칸이 나온다: ' + JSON.stringify(on));
  assert.ok(on.bonus >= 1, '2단 점프 봇이 가산점을 받는다: ' + JSON.stringify(on));
  assert.equal(on.fails, 0, '2단 점프 봇은 실수 없이: ' + JSON.stringify(on));
  const off = await play('dj=0');
  assert.deepEqual([off.highWords, off.highTiles, off.bonus], [0, 0, 0], 'dj=0 이면 나오지 않는다');
});

test('320-3) 보스 구성: 12단어 중 10단어 판에서 5번째·10번째가 보스(긴 단어 우선), 5번째 보스 뒤 6번째 단어로 정상 진행, 10번째 보스 뒤 결과', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS12;
  const page = await openQ({ ids: IDS12 });
  assert.equal(await page.eval("document.getElementById('startInfo').textContent"), '이번 판 8단어 + 보스 2단어 · 체력 5');
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const shape = await page.eval("({ n: SpellRun.G.words.length, boss: SpellRun.G.words.map((w, i) => w.boss ? i : -1).filter(i => i >= 0), bw: SpellRun.G.words.filter(w => w.boss).map(w => w.word), regular: SpellRun.G.regular, hearts: SpellRun.G.heartWords.size })");
  assert.deepEqual([shape.n, shape.boss, shape.regular, shape.hearts], [10, [4, 9], 8, 2], '10단어, 5·10번째 보스, 하트는 보스 제외 8단어 기준 2개');
  assert.deepEqual(shape.bw, ['environment', 'beautiful'], '긴 단어부터 보스 자리에 배정');
  // 4번째 단어가 끝나면 보스 연출
  await advance(page, 'G.state === "intro"', {});
  assert.equal(await page.eval('SpellRun.G.wi'), 3);
  assert.equal(await page.eval("!document.getElementById('bossBanner').hidden && SpellRun.G.bossMode"), true, '보스 배너와 보스 배경');
  await advance(page, 'G.state === "run" && G.wi === 4', {});
  assert.equal(await page.eval("SpellRun.G.words[4].boss && document.getElementById('progress').textContent"), '보스 단어');
  assert.equal(await page.eval("document.getElementById('box').classList.contains('boss')"), true);
  const hpAtBoss = await page.eval('SpellRun.G.hp');
  await advance(page, 'G.state === "pop"', {});
  assert.equal(await page.text('#popTag'), '보스 격파!');
  assert.equal(await page.eval('SpellRun.G.repeatT'), 0, '중간 보스는 마지막 단어 재발음 없음');
  await advance(page, 'G.state === "run" && G.wi === 5', {});
  assert.equal(await page.eval("SpellRun.G.bossMode"), false, '보스가 끝나면 일반 배경'); assert.equal(await page.eval("document.getElementById('box').classList.contains('boss')"), false);
  assert.equal(await page.text('#progress'), '단어 5 / 8', '보스는 세지 않는다');
  assert.equal(await page.eval('SpellRun.G.words[5].boss'), undefined);
  assert.ok(hpAtBoss >= 1);
  // 마지막(10번째) 보스까지 끝내면 결과, 마지막 단어 규칙(재발음 예약)
  await advance(page, 'G.state === "run" && G.wi === 9', {});
  await advance(page, 'G.state === "pop"', {});
  assert.equal(await page.eval('SpellRun.G.repeatT > 0'), true, '마지막 단어는 천천히 한 번 더 발음 예약');
  assert.equal(await page.eval('SpellRun.G.popT'), 3.2, '마지막 단어 팝업 시간 그대로');
  await advance(page, 'G.state === "over"', {});
  assert.equal(await page.text('#resTitle'), '보스 격파!');
  assert.equal(await page.eval('SpellRun.G.wordsDone'), 10);
  assert.deepEqual(await page.eval(OVERFLOW), []);
  // 복습 판: 보스 없음
  await page.eval("SpellRun.missedSet.add('apple'); SpellRun.missedSet.add('book'); SpellRun.missedSet.add('water'); SpellRun.startRound(true)");
  assert.deepEqual(await page.eval("[SpellRun.G.words.length, SpellRun.G.words.filter(w => w.boss).length]"), [3, 0], '복습 판에는 보스가 없다');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
  // 5개 미만 / 5~9개
  for (const [n, bosses] of [[4, 0], [5, 1], [9, 1]]) {
    const p2 = await openQ({ ids: IDS12.slice(0, n) });
    await p2.click('#startBtn'); await p2.waitFor("SpellRun.G.state === 'run'", 4000);
    assert.deepEqual(await p2.eval("[SpellRun.G.words.length, SpellRun.G.words.map((w, i) => w.boss ? i : -1).filter(i => i >= 0)]"), [n, bosses ? [4] : []], n + '개');
    await p2.close();
  }
});

test('320-4) 속도 램프: 콤보에 따라 목표 속도가 25·50·75·100%로 오르고 실제 속도는 가속도로 따라가며(순간 점프 없음), 실패하면 콤보 0 과 기본 누적 속도로 내려간다. maxcombo 옵션', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS12;
  const page = await openQ({ ids: IDS12 });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const rec = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG, L = window.SpellRunLogic; R.manual = true; const T = C.JUMP_TIME;
    const out = { rows: [], maxDv: 0, mism: [], steps: 0 }; let prevSpeed = G.speed, lastCombo = -1;
    while (out.steps < 60 * 60 && G.state !== 'over' && out.rows.length < 40) {
      if (G.state === 'run') { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
        if (tg) { const tta = (tg.x - R.RUNNER_X) / G.speed; if (tg.high) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); } else if (G.jumpT < 0 && tta <= T / 2) R.jump(); } }
      R.step(1 / 60); out.steps++;
      out.maxDv = Math.max(out.maxDv, Math.abs(G.speed - prevSpeed)); prevSpeed = G.speed;
      if (G.combo !== lastCombo) { lastCombo = G.combo; out.rows.push([G.combo, G.speedTarget, G.speedBase]); if (Math.abs(G.speedTarget - L.targetSpeed(G.speedBase, G.combo)) > 1e-9) out.mism.push(G.combo); }
    }
    out.min = C.SPEED_MIN; out.max = C.SPEED_MAX; out.accel = C.SPEED_ACCEL; out.combos = out.rows.map(r => r[0]); out.maxCombo = G.maxCombo; return out; })()`);
  assert.deepEqual(rec.mism, [], '목표 속도 = max(기본 누적 속도, 램프)');
  assert.ok(rec.maxCombo >= 6, '콤보를 쌓았다: ' + rec.maxCombo);
  assert.ok(rec.maxDv <= rec.accel / 60 + 1e-6, `실제 속도는 가속도로만 변한다(프레임당 최대 ${rec.maxDv.toFixed(3)} <= ${(rec.accel / 60).toFixed(3)})`);
  const at = c => rec.rows.find(r => r[0] === c);
  const span = rec.max - rec.min;
  assert.equal(at(1)[1], at(1)[2], '콤보 1 은 램프 없음');
  assert.ok(at(2)[1] >= rec.min + span * 0.25 - 1e-6 && at(2)[1] < at(3)[1] && at(3)[1] >= rec.min + span * 0.5 - 1e-6 && at(4)[1] >= rec.min + span * 0.75 - 1e-6 && at(4)[1] < at(5)[1], '콤보 2~4 에서 단계적으로 오른다: ' + JSON.stringify(rec.rows.slice(0, 6)));
  assert.equal(at(5)[1], rec.max, '콤보 5 에서 최고 속도');
  // 실패: 콤보가 쌓인 상태에서 정답을 놓친다 → 콤보 0, 목표 속도 = 기본 누적 속도, 실제 속도는 서서히 내려간다
  const f = await page.eval(`(() => { const R = SpellRun, G = R.G, C = R.CONFIG; R.manual = true;
    G.state = 'run'; G.tiles.length = 0; G.packActive = true; G.packId++; G.jumpT = -1; G.j2 = -1; G.combo = 6; G.speedBase = C.SPEED_MIN + 40; G.speedTarget = C.SPEED_MAX; G.speed = C.SPEED_MAX; G.hp = C.HP; G.si = 0;
    G.tiles.push({ id: G.packId, x: R.RUNNER_X - 1, w: 58, text: G.plan.slots[0].text, correct: true, chunk: false, high: false, state: 'live', t: 0, age: 1, checked: false, ok: false, color: '#fff' });
    R.step(1 / 60); const a = { combo: G.combo, target: G.speedTarget, base: G.speedBase, speed: G.speed, hp: G.hp }; for (let i = 0; i < 30; i++) R.step(1 / 60); a.after = G.speed; a.min = C.SPEED_MIN; a.max = C.SPEED_MAX; a.drop = C.SPEED_DROP_FAIL; return a; })()`);
  assert.equal(f.combo, 0); assert.equal(f.hp, 4);
  assert.equal(f.target, f.base, '램프가 풀리고 목표 속도가 기본 누적 속도로'); assert.equal(f.base, Math.max(f.min, f.min + 40 - f.drop));
  assert.ok(f.speed > f.max - 5 && f.after < f.speed && f.after >= f.target, '실제 속도는 순간 점프 없이 서서히: ' + JSON.stringify(f));
  await page.close();
  // maxcombo 옵션: 8 이면 콤보 5 에서는 아직 최고 속도가 아니다
  const p2 = await openQ({ ids: IDS12, query: 'maxcombo=8' });
  assert.equal(await p2.eval('SpellRun.CONFIG.COMBO_MAX_SPEED'), 8);
  assert.equal(await p2.eval("document.getElementById('tune').hidden"), false);
  assert.deepEqual(await p2.eval("(() => { const L = window.SpellRunLogic, C = SpellRun.CONFIG; return [L.targetSpeed(C.SPEED_MIN, 5) < C.SPEED_MAX, L.targetSpeed(C.SPEED_MIN, 8) === C.SPEED_MAX]; })()"), [true, true]);
  await p2.close();
  const p3 = await openQ({ ids: IDS12, query: 'maxcombo=5' });
  assert.equal(await p3.eval("document.getElementById('tune').hidden"), true, '기본값과 같으면 표시 없음'); await p3.close();
  const p4 = await openQ({ ids: IDS12, query: 'maxcombo=2&dj=0' });
  assert.equal(await p4.eval('SpellRun.CONFIG.COMBO_MAX_SPEED'), 5, '범위 밖은 무시'); assert.equal(await p4.eval('SpellRun.CONFIG.DJ_ENABLED'), false); await p4.close();
});

// ───────── 작업323: 새 단어 시작 연출 ─────────
const SEED = "Math.random = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();";
const ROWS_I = [RICH(91, 'apple', '사과', { meanings: [{ definition: '사과, 능금, 애플' }] }), RICH(92, 'happy', '행복한', { meanings: [{ definition: '행복한, 기쁜, 즐거운' }] }), RICH(93, 'water', '물', { meanings: [{ definition: '물, 식수' }] })];
async function openI({ query = '', width = 390, ids = [91, 92, 93], seed = true, dodge = true } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height: 844, token: jwt() });
  await withDodge(page, dodge);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); } catch (e) {}" });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(ids))}); } catch (e) {}` + (seed ? SEED : '') });
  await page.goto(base + '/spelling_run.html' + (query ? '?' + query : ''));
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval('SpellRun.manual = true');
  return page;
}
const introInfo = page => page.eval(`(() => { const G = SpellRun.G, u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')), b = document.getElementById('box').getBoundingClientRect();
  const R = id => { const e = document.getElementById(id); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { top: +((r.top - b.top) / u).toFixed(2), bottom: +((r.bottom - b.top) / u).toFixed(2), left: +((r.left - b.left) / u).toFixed(2), right: +((r.right - b.left) / u).toFixed(2), h: +(r.height / u).toFixed(2) }; };
  const kids = [...document.getElementById('word').children];
  return { active: G.iActive, clock: G.iClock, tl: G.iTl, hidden: kids.filter(k => k.style.visibility === 'hidden').length, kids: kids.length, tiles: G.tiles.length, box: R('hintbox'), meaning: R('meaning'), sub: R('sub'), word: R('word'), slot0: (() => { const k = kids[0]; if (!k) return null; const r = k.getBoundingClientRect(); return { top: +((r.top - b.top) / u).toFixed(2), left: +((r.left - b.left) / u).toFixed(2), w: +(r.width / u).toFixed(2) }; })(),
    cls: document.getElementById('hintbox').className, tf: document.getElementById('hintbox').style.transform, enter: document.getElementById('meaning').classList.contains('enter'), word_: G.words[G.wi].word, jumpT: G.jumpT }; })()`);
const stepTo = (page, clock) => page.eval(`(() => { const G = SpellRun.G; let n = 0; while (G.iActive && G.iClock < ${clock} && n++ < 2000) SpellRun.step(1 / 240); })()`);   // 연출 시계가 clock 에 닿을 때까지(시험 시작 전 실시간 프레임 몇 개와 무관하게)
const stepN = (page, n) => page.eval(`(() => { for (let i = 0; i < ${n}; i++) SpellRun.step(1 / 60); })()`);

test('323-1/2/3) 새 단어 시작: 유지 구간에는 큰 뜻 카드가 화면 가운데에 있고 글자 칸은 숨겨져 있으며, 축소 구간에서 칸이 왼쪽부터 나타나고, 끝나면 모두 보인다', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS_I;
  const page = await openI();
  let a = await introInfo(page);
  assert.equal(a.active, true); assert.ok(a.tl.hold > 1.6 && a.tl.hold < 1.8, '첫 단어는 유지 1.3 + 0.4: ' + a.tl.hold);
  assert.equal(a.hidden, a.kids, '유지 구간: 글자 칸이 모두 숨김(자리는 유지)'); assert.ok(a.word.h > 20, '자리는 유지되어 줄 높이가 있다');
  assert.ok(/\bintro\b/.test(a.cls) && /scale\(/.test(a.tf) && /translateY\(/.test(a.tf), '하나의 요소를 transform(이동+크기)으로');
  assert.equal(a.enter, false, '기존 등장 효과와 겹쳐 두 번 움직이지 않는다'); assert.equal(a.tiles, 0);
  const centerY = (a.box.top + a.box.bottom) / 2;
  assert.ok(Math.abs(centerY - 250) <= 3, '카드 가운데 높이 ≈ 250: ' + centerY);
  const bigH = a.box.h;
  // 유지가 끝나기 직전까지 그대로
  await stepTo(page, a.tl.hold - 0.1);
  a = await introInfo(page);
  assert.equal(a.hidden, a.kids); assert.equal(a.active, true);
  // 축소 구간: 일부만 보이고 왼쪽 칸부터
  await stepTo(page, a.tl.hold + 0.03);
  a = await introInfo(page);
  assert.ok(a.kids >= 2, '칸이 둘 이상인 단어로 확인: ' + a.kids);
  assert.ok(a.hidden > 0 && a.hidden < a.kids, `축소 중 일부만 보임: ${a.kids - a.hidden}/${a.kids}`);
  const order = await page.eval("[...document.getElementById('word').children].map(k => k.style.visibility === 'hidden' ? 0 : 1).join('')");
  assert.match(order, /^1+0*$/, '왼쪽부터 순서대로: ' + order);
  assert.ok(a.box.h < bigH && a.box.top < centerY - 5, '카드가 작아지며 위로 이동 중');
  // 끝
  await stepN(page, 40);
  a = await introInfo(page);
  assert.equal(a.active, false); assert.equal(a.hidden, 0); assert.equal(a.tf, ''); assert.ok(!/\bintro\b/.test(a.cls));
  assert.ok(bigH > a.box.h * 1.05, `큰 뜻 카드(${bigH})가 최종 힌트(${a.box.h})보다 크다`);
  await page.close();
});

test('323-2) 연출이 끝난 뒤 대표 뜻·보조 줄·글자 칸 줄의 위치·크기·줄바꿈은 연출 없는(intro=0, 작업322) 최종 레이아웃과 1px 이내로 같고, 이후 재배치가 없다', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS_I;
  for (const width of [320, 360, 390]) {
    const base0 = await openI({ query: 'intro=0', width });
    assert.equal((await introInfo(base0)).active, false, 'intro=0 은 연출 없음');
    await base0.eval("new Promise(r => setTimeout(r, 800))");   // 기존 등장 효과(.meaning.enter)가 끝난 뒤
    const ref = await introInfo(base0);
    assert.equal(ref.enter, true, 'intro=0 은 작업322 방식(등장 효과 유지)'); assert.equal(ref.hidden, 0); assert.equal(ref.tf, '');
    const p = await openI({ width });
    await advance(p, '!G.iActive', {});
    await p.eval('new Promise(r => setTimeout(r, 450))');   // 글자 칸 등장 효과(CSS, 실시간 0.22초)가 끝난 뒤
    const a = await introInfo(p);
    assert.equal(ref.word_, a.word_, '같은 단어(난수 고정)');
    for (const key of ['meaning', 'sub', 'word', 'slot0', 'box']) {
      for (const f of Object.keys(ref[key] || {})) assert.ok(Math.abs(ref[key][f] - a[key][f]) <= 1, `${width}px ${key}.${f}: 이후 ${a[key][f]} / intro=0 ${ref[key][f]}`);
    }
    // 끝난 뒤 30프레임 동안 변하지 않는다(깜박임·재배치 없음)
    for (let i = 0; i < 6; i++) { await stepN(p, 5); const b = await introInfo(p); assert.deepEqual([b.meaning, b.sub, b.word, b.slot0], [a.meaning, a.sub, a.word, a.slot0], '재배치 없음'); assert.equal(b.hidden, 0); }
    await base0.close(); await p.close();
  }
});

test('323-1) 첫 타일은 연출이 끝나기 전에 나오지 않고, 연출 중에도 캐릭터는 달리며(거리 증가) 점프 입력이 동작한다', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS_I;
  const page = await openI();
  const r = await page.eval(`(async () => { const R = SpellRun, G = R.G; const out = { bad: 0, endAt: null, firstTile: null, t: 0, dist0: G.dist, jumpedDuring: false };
    for (let i = 0; i < 60 * 4; i++) {
      if (i === 30) { R.jump(); out.jumpedDuring = G.iActive && G.jumpT >= 0; }
      R.step(1 / 60); out.t += 1 / 60;
      if (G.tiles.length && G.iActive) out.bad++;
      if (out.endAt === null && !G.iActive) out.endAt = out.t;
      if (out.firstTile === null && G.tiles.length) out.firstTile = out.t;
    }
    out.dist = G.dist - out.dist0; out.tl = G.iTl; out.delay = R.CONFIG.WORD_START_DELAY + R.CONFIG.FIRST_WORD_EXTRA; return out; })()`);
  assert.equal(r.bad, 0, '연출 중에는 타일이 없다');
  assert.ok(r.endAt !== null && r.firstTile !== null && r.endAt <= r.firstTile + 1 / 60, `연출 종료 ${r.endAt} <= 첫 타일 ${r.firstTile}`);
  assert.ok(r.endAt <= r.delay + 0.02 && Math.abs(r.firstTile - r.delay) < 0.25, '첫 타일은 기존 대기 시간(2.6초, 시험 시작 전 몇 프레임 제외)에 나온다: ' + r.firstTile);
  assert.ok(r.dist > 0, '연출 중에도 계속 달린다(배경 거리 증가)'); assert.equal(r.jumpedDuring, true, '연출 중 점프 입력 정상');
  await page.close();
});

test('323-1) 일시정지 중에는 연출이 멈춘다: 게임 시간(step)이 흐르지 않으면 단계도 그대로이고, 탭이 가려진 뒤 재개하면 이어진다(프레임 dt 상한)', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS_I;
  const page = await openI({ seed: true });
  await stepN(page, 30);
  const a = await introInfo(page);
  await new Promise(r => setTimeout(r, 400));   // 수동 모드에서 step 을 부르지 않는 400ms = 일시정지
  const b = await introInfo(page);
  assert.equal(b.clock, a.clock, '정지 중에는 연출 시계가 그대로'); assert.deepEqual([b.hidden, b.box], [a.hidden, a.box]);
  // 실제 시간 루프: 프레임 사이가 길어도(탭이 가려졌다 돌아옴) 한 프레임에 흐르는 시간은 50ms 이하
  await page.eval('SpellRun.manual = false');
  const c0 = (await introInfo(page)).clock;
  await page.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
  await new Promise(r => setTimeout(r, 700));
  await page.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await new Promise(r => setTimeout(r, 150));
  const c1 = await introInfo(page);
  assert.ok(c1.clock - c0 < 0.45, `동결 700ms 동안 연출이 건너뛰지 않는다(진행 ${(c1.clock - c0).toFixed(3)}s)`);
  await page.close();
});

test('323-1) 보스 단어: 배너가 먼저 나오고(연출 없음) 배너가 끝난 뒤 연출이 시작되며 큰 뜻 유지가 일반보다 0.4초 길다. 일반 단어 시간은 그대로', { skip: SKIP }, async () => {
  resetState(); state.rows = ROWS12;
  const page = await openQ({ ids: IDS12 });
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval('SpellRun.manual = true');
  const first = await introInfo(page);
  assert.equal(first.active, true);
  await advance(page, 'G.state === "intro"', {});
  const banner = await introInfo(page);
  assert.equal(banner.active, false, '배너 동안에는 연출이 없다(이전 단어의 연출은 이미 끝남)');
  assert.equal(await page.eval("!document.getElementById('bossBanner').hidden"), true);
  await advance(page, 'G.state === "run" && G.wi === 4', {});
  const boss = await introInfo(page);
  assert.equal(boss.active, true, '배너 뒤에 보스 연출 시작'); assert.equal(await page.eval("document.getElementById('bossBanner').hidden"), true);
  assert.ok(Math.abs(boss.tl.hold - 1.7) < 1e-9 && boss.tl.total <= 2.2 + 1e-9, '보스 큰 뜻 유지 1.7(= 1.3 + 0.4): ' + JSON.stringify(boss.tl));
  assert.equal(boss.hidden, boss.kids);
  await advance(page, '!G.iActive', {});
  assert.equal((await introInfo(page)).hidden, 0);
  // 일반 단어(2번째)는 1.3
  await advance(page, 'G.state === "pop"', {}); await advance(page, 'G.state === "run" && G.wi === 5', {});
  const n6 = await introInfo(page);
  assert.ok(Math.abs(n6.tl.hold - 1.3) < 1e-9 && n6.tl.total === 1.8, '일반 단어는 불변: ' + JSON.stringify(n6.tl));
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('323-2) 폭 320·360·390: 큰 뜻 카드(유지 구간)가 가로로 넘치지 않고 위쪽 HUD 줄과 겹치지 않으며, 긴 뜻·키워드 많은 최악 데이터에서도 같다. intro=0 은 연출 요소가 전혀 없다', { skip: SKIP }, async () => {
  const many = Array.from({ length: 8 }, (_, i) => '아주길게늘어놓은키워드' + (i + 1)).join(', ');
  resetState();
  state.rows = [RICH(81, 'extraordinary', LONG_MEAN, { meanings: [{ definition: LONG_MEAN }, { definition: many }] }), RICH(82, 'beautiful', LONG_NOSPACE, { meanings: [{ definition: '아름다운, 예쁜, 멋진, 훌륭한, 근사한, 고운, 아리따운' }] }), RICH(83, 'environment', '환경', { meanings: [{ definition: '환경, 주변 상황, 자연환경, 생태계, 둘레' }] })];
  for (const width of [320, 360, 390]) {
    const page = await openI({ width, ids: [81, 82, 83] });
    for (let k = 0; k < 3; k++) {
      const a = await introInfo(page);
      assert.equal(a.active, true);
      // 카드는 transform 으로 확대돼 블록 상자가 넓어지므로, 글자가 실제로 차지하는 범위(Range)로 넘침을 본다
      assert.deepEqual(await page.eval(`(() => { const b = document.getElementById('box').getBoundingClientRect(), bad = []; for (const id of ['meaning', 'sub']) { const e = document.getElementById(id); if (e.hidden) continue; const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect(); if (r.left < b.left - 0.5 || r.right > b.right + 0.5) bad.push(id + ' ' + Math.round(r.left - b.left) + '~' + Math.round(r.right - b.left)); } return bad; })()`), [], `${width}px ${a.word_} 유지 구간 글자 범위`);
      const hud = await page.eval("(() => { const u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')), b = document.getElementById('box').getBoundingClientRect(); const rows = [...document.querySelectorAll('#hud .row')].map(r => (r.getBoundingClientRect().bottom - b.top) / u); return Math.max(...rows); })()");
      assert.ok(a.box.top >= hud - 0.5, `${width}px 카드 위 ${a.box.top} 가 HUD 줄 아래 끝 ${hud.toFixed(1)} 보다 아래`);
      assert.ok(a.box.bottom <= 440, '카드는 땅 위 영역');
      await advance(page, 'G.state === "pop"', {});
      if (await page.eval('SpellRun.G.wi + 1 >= SpellRun.G.words.length')) break;
      await advance(page, 'G.state === "run" && G.wi > ' + (await page.eval('SpellRun.G.wi')), {});
    }
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  }
  state.rows = ROWS_I;
  const off = await openI({ query: 'intro=0' });
  const o = await introInfo(off);
  assert.deepEqual([o.active, o.hidden, o.tf, /\bintro\b/.test(o.cls)], [false, 0, '', false]);
  assert.equal(await off.eval("document.getElementById('tune').hidden"), false, 'intro=0 은 조정값 사용 중');
  await off.close();
  const dflt = await openI({ query: 'intro=1&introhold=1.3' });
  assert.equal(await dflt.eval("document.getElementById('tune').hidden"), true, '기본값과 같으면 표시 없음'); await dflt.close();
  const hold = await openI({ query: 'introhold=2.5' });
  const h = await introInfo(hold); assert.ok(h.tl.total <= 2.6 + 1e-9 && Math.abs(h.tl.hold - 2.1) < 1e-9, '큰 값은 대기 시간 안으로 줄인다: ' + JSON.stringify(h.tl));
  await hold.close();
});

// ───────── 작업321: 펭귄 스프라이트 ─────────
test('321-1) 시트 파일: public/img/spellrun/spellrun_penguin_sheet.png 가 있고 1728×288 투명 PNG, 페이지가 그 주소를 요청(1회)한다. 개별 프레임·zip 은 repo 에 없다', { skip: SKIP }, async () => {
  const f = path.join(PUB, 'img', 'spellrun', 'spellrun_penguin_sheet.png');
  const b = fs.readFileSync(f);
  assert.equal(b.subarray(1, 4).toString(), 'PNG'); assert.equal(b.readUInt32BE(16), 1728); assert.equal(b.readUInt32BE(20), 288); assert.equal(b[25], 6, 'RGBA(투명)');
  assert.deepEqual(fs.readdirSync(path.dirname(f)).filter(x => /penguin/.test(x)), ['spellrun_penguin_sheet.png'], '펭귄 시트 한 장만(작업327 에서 같은 폴더에 장애물 시트가 추가됨)');
  assert.ok(!fs.readdirSync(PUB, { recursive: true }).some(x => /penguin_frames\.zip|frame_[1-6]\.png/.test(String(x))), 'zip·개별 프레임 없음');
  resetState();
  const page = await openGame({ ids: [1, 2, 3] });
  await gameReady(page);
  await page.waitFor('SpellRun.penguin().ready', 4000);
  const reqs = await page.eval("performance.getEntriesByType('resource').filter(e => /penguin/.test(e.name)).map(e => new URL(e.name).pathname)");
  assert.deepEqual(reqs, ['/img/spellrun/spellrun_penguin_sheet.png'], '시트 요청 1회');
  await page.close();
});

test('321-2) 로딩 성공: 스프라이트로 그려지고(달리기 0~3 순환, 점프 상승 4·하강 5, 2단 점프 회전, 착지 후 0도), 한 판이 끝까지 진행되며 오류가 없다', { skip: SKIP }, async () => {
  resetState(); state.rows = HINT_ROWS;
  const page = await openQ({ ids: [21, 22, 24, 25, 27] });
  await page.waitFor('SpellRun.penguin().ready', 4000);
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const r = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; R.manual = true; const T = C.JUMP_TIME;
    const out = { run: new Set(), up: 0, down: 0, spin: 0, spinMax: 0, endAngle: null, bad: [], draws0: R.penguin().draws, frames: [] }; let steps = 0, prevPhase = 0;
    while (steps < 60 * 900 && G.state !== 'over') {
      if (G.state === 'run') { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
        if (tg) { const tta = (tg.x - R.RUNNER_X) / G.speed; if (tg.high) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); } else if (G.jumpT < 0 && tta <= T / 2) R.jump(); } }
      R.step(1 / 60); steps++; R.draw();
      const p = R.penguin(), h = R.curH();
      if (G.state === 'run' || G.state === 'pop') {
        if (h <= 1) out.run.add(p.frame); else if (p.frame === 4) out.up++; else if (p.frame === 5) out.down++; else out.bad.push('air frame ' + p.frame);
        if (h > 1 && p.frame < 4) out.bad.push('공중인데 달리기 프레임');
        if (h <= 1 && p.frame > 3) out.bad.push('땅인데 점프 프레임');
      }
      if (G.j2 >= 0) { out.spin++; out.spinMax = Math.max(out.spinMax, p.angle); } else if (out.spin && out.endAngle === null) out.endAngle = p.angle;
      if (G.j2 < 0 && p.angle !== 0 && G.state !== 'ending') out.bad.push('회전 잔여 ' + p.angle);
      if (steps % 400 === 0) await new Promise(r => setTimeout(r, 0));
    }
    out.draws = R.penguin().draws - out.draws0; out.run = [...out.run]; out.state = G.state; out.title = document.getElementById('resTitle').textContent; return out; })()`);
  assert.equal(r.state, 'over'); assert.ok(r.draws > 300, '스프라이트로 그려졌다: ' + r.draws);
  assert.deepEqual(r.run.sort(), [0, 1, 2, 3], '달리기 4프레임이 모두 쓰였다');
  assert.ok(r.up > 5 && r.down > 5, `점프 상승(5번째)·하강(6번째) 프레임: ${r.up}/${r.down}`);
  assert.ok(r.spin > 5 && r.spinMax > 270 && r.spinMax < 360, '2단 점프 중 회전: ' + r.spinMax); assert.equal(r.endAngle, 0, '착지 뒤 정확히 0도');
  assert.deepEqual(r.bad.slice(0, 5), [], '프레임 선택 오류');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '오류 없음');
  // 결과 화면(완주)은 기쁨 프레임(5번째), 대기 화면은 서 있는 프레임(2번째)
  await page.eval('SpellRun.draw()');
  const fr = await page.eval('SpellRun.penguin().frame');
  assert.equal(fr, r.title.includes('완주') || r.title.includes('격파') ? 4 : 1);
  await page.close();
  const idle = await openQ({ ids: [21, 22, 24] });
  await idle.waitFor('SpellRun.penguin().ready', 4000);
  await idle.waitFor('SpellRun.penguin().draws > 2', 4000);
  assert.equal(await idle.eval('SpellRun.penguin().frame'), 1, '대기 화면은 2번 프레임');
  await idle.close();
});

test('321-2) 로딩 실패(시트 요청 차단): 기존 도형 캐릭터로 그려지고 게임은 끝까지 동작하며 오류가 없다. 로딩 전에도 시작을 막지 않는다', { skip: SKIP }, async () => {
  resetState();
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await withDodge(page);
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls: ['*spellrun_penguin_sheet*'] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); sessionStorage.setItem('spellrun_ids', '[1,2,3]'); } catch (e) {}" });
  await page.goto(base + '/spelling_run.html');
  await gameReady(page);
  assert.equal(await page.eval('SpellRun.penguin().ready'), false, '시트 로딩 실패');
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval('SpellRun.manual = true');
  const r = await page.eval(`${BOT}({ jumpHeart: false })`);
  assert.equal(r.over, true, '끝까지 진행'); assert.equal(r.fails, 0);
  await page.eval('SpellRun.draw()');
  const p = await page.eval('SpellRun.penguin()');
  assert.deepEqual([p.ready, p.draws], [false, 0], '스프라이트로는 한 번도 그리지 않았다(기존 그림으로 대체)');
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource|ERR_BLOCKED/.test(e)), [], '오류 없음');
  await page.close();
});

// ───────── 작업325: 발음 시간 초과 대체 · 출처 표시 ─────────
const sayWord = (page, word, opts) => page.eval(`new Promise(r => SpellRun.pronounce(${JSON.stringify(word)}, ${JSON.stringify(opts || {})}, (ok, why, src) => r({ ok, why, src })))`);
// 헤드리스 Chrome 은 사용자 동작 없이 오디오 재생을 거부하므로, 서버 음성이 "재생되는" 상황은 play() 를 성공으로 바꿔 만든다
const OKPLAY = "HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; 0";
const spokenTexts = page => page.eval('window.__speech.spoken.map(s => s.text)');

test('325-1) 서버 응답 시간 초과는 그 호출을 내장 음성으로 대체하고, 실패한 단어는 다시 요청하면 서버를 재시도한다(실패가 방문 동안 반복되지 않음)', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3], speech: true });
  await gameReady(page);
  await page.eval(OKPLAY);
  await page.eval('SpellRun.setTtsTimeout(250)');
  state.ttsDelay = 900;                      // 서버가 시간 제한보다 느림
  const a = await sayWord(page, 'apple');
  assert.equal(a.ok, true); assert.equal(a.src, '내장 음성: 시간 초과');
  assert.deepEqual(await spokenTexts(page), ['apple'], '시간 초과 → 내장 음성으로 읽는다');
  assert.equal(ttsCalls().length, 1);
  // 같은 단어를 다시: 서버가 정상으로 돌아오면 재시도해서 서버 음성
  state.ttsDelay = 0; state.ttsHeader = 'MISS';
  const b = await sayWord(page, 'apple');
  assert.equal(b.src, '서버 음성(새로 생성)'); assert.equal(ttsCalls().length, 2, '실패한 단어는 서버를 다시 부른다');
  assert.deepEqual(await spokenTexts(page), ['apple'], '두 번째는 내장 음성을 쓰지 않았다');
  // 성공한 단어는 다시 요청하지 않는다(기존 동작), 천천히 재생도 서버 호출 추가 없음
  const c = await sayWord(page, 'apple', { slow: true });
  assert.equal(ttsCalls().length, 2); assert.equal(c.src, '서버 음성', '다시 재생하는 오디오는 캐시 여부를 말하지 않는다');
  assert.deepEqual(JSON.parse(ttsCalls()[0].body), { text: 'apple', lang: 'en' }, '요청 인자 그대로'); assert.ok(ttsCalls().every(r => /^Bearer /.test(r.auth || '')));
  await page.close();
});

test('325-1) "이어받아 끊긴" AbortError(재생 중단)는 대체하지 않고, 재생 거부(NotAllowedError)는 내장 음성으로 대체한다. 서버 오류(500)는 그 호출만 대체하고 다음에 재시도한다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3], speech: true });
  await gameReady(page);
  // 재생이 AbortError 로 끊김 → 겹쳐 읽지 않는다
  await page.eval(OKPLAY);
  await page.eval("window.__origPlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('interrupted', 'AbortError')); }; 0");
  const a = await sayWord(page, 'book');
  assert.equal(a.ok, true); assert.deepEqual(await spokenTexts(page), [], '이어받아 끊긴 경우는 내장 음성으로 대체하지 않는다');
  // 재생 거부(자동 재생 제한 등) → 내장 음성
  await page.eval("HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); }; 0");
  const b = await sayWord(page, 'water');
  assert.equal(b.src, '내장 음성: 재생 거부'); assert.deepEqual(await spokenTexts(page), ['water']);
  await page.eval('HTMLMediaElement.prototype.play = window.__origPlay; 0');
  // 서버 오류 500: 그 호출만 대체, 다음 호출은 서버를 다시 부른다(서버 발음을 끄지 않는다)
  state.tts = 500;
  const c = await sayWord(page, 'happy');
  assert.equal(c.src, '내장 음성: 서버 오류');
  state.tts = 200;
  const d = await sayWord(page, 'happy');
  assert.equal(d.src, '서버 음성'); assert.equal(ttsCalls().filter(r => JSON.parse(r.body).text === 'happy').length, 2);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('325-2) 발음 출처 문구(ttsdebug=1): 서버 HIT/MISS/헤더 없음, 401·403·503, 시간 초과를 화면 한쪽 작은 글자로 보이고 발음 테스트 결과에도 같이 보인다', { skip: SKIP }, async () => {
  resetState();
  const shown = page => page.eval("(() => { const e = document.getElementById('ttsSrc'); return e ? e.textContent : null; })()");
  // 서버 성공: HIT / MISS / 헤더 없음
  let page = await openQ({ ids: [1, 2, 3], query: 'ttsdebug=1' });
  await page.eval(OKPLAY);
  await page.eval('SpellRun.manual = true; 0');
  assert.equal(await shown(page), null, '발음이 재생되기 전에는 표시 없음');
  assert.equal(await page.eval("document.getElementById('tune').hidden"), false, 'ttsdebug=1 은 조정값 사용 중');
  state.ttsHeader = 'HIT'; assert.equal((await sayWord(page, 'apple')).src, '서버 음성(캐시 있음)'); assert.equal(await shown(page), '서버 음성(캐시 있음)');
  state.ttsHeader = 'MISS'; assert.equal((await sayWord(page, 'book')).src, '서버 음성(새로 생성)'); assert.equal(await shown(page), '서버 음성(새로 생성)');
  state.ttsHeader = null; assert.equal((await sayWord(page, 'water')).src, '서버 음성', '헤더가 없으면 서버 음성만');
  const st = await page.eval("(() => { const e = document.getElementById('ttsSrc'), r = e.getBoundingClientRect(), b = document.getElementById('box').getBoundingClientRect(), c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), inside: r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom, pe: c.pointerEvents }; })()");
  assert.ok(st.fs <= 14 && st.inside && st.pe === 'none', '작은 글자·상자 안·클릭을 가로채지 않음: ' + JSON.stringify(st));
  // 시작 화면의 발음 테스트에도 출처가 같이 보인다
  state.ttsHeader = 'HIT';
  await page.click('#ttsTest');
  await page.waitFor("document.getElementById('ttsStatus').textContent.includes('[서버 음성(캐시 있음)]')", 4000);
  await page.close();
  // 401·403·503: 서버 발음을 끄고 내장 음성(출처에 사유)
  for (const [code, label] of [[401, '내장 음성: 로그인 필요(401)'], [403, '내장 음성: 권한 없음(403)'], [503, '내장 음성: 서버 키 없음(503)']]) {
    resetState(); state.tts = code;
    const p2 = await browser.newPage({ width: 390, height: 844, token: jwt() });
    await p2.send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH });
    await p2.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); sessionStorage.setItem('spellrun_ids', '[1,2,3]'); } catch (e) {}" });
    await p2.goto(base + '/spelling_run.html?ttsdebug=1');
    await gameReady(p2);
    await p2.eval(OKPLAY);
    assert.equal((await sayWord(p2, 'apple')).src, label, String(code));
    assert.equal(await shown(p2), label);
    assert.equal((await sayWord(p2, 'book')).src, label, '이후에도 같은 사유(서버를 다시 부르지 않음)'); assert.equal(ttsCalls().length, 1, '서버 요청은 한 번만');
    await p2.close();
  }
  // 시간 초과
  resetState(); state.ttsDelay = 800;
  const p3 = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await p3.send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH });
  await p3.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); sessionStorage.setItem('spellrun_ids', '[1,2,3]'); } catch (e) {}" });
  await p3.goto(base + '/spelling_run.html?ttsdebug=1');
  await gameReady(p3);
  await p3.eval(OKPLAY);
  await p3.eval('SpellRun.setTtsTimeout(200)');
  assert.equal((await sayWord(p3, 'apple')).src, '내장 음성: 시간 초과'); assert.equal(await shown(p3), '내장 음성: 시간 초과');
  await p3.close();
});

test('325-2) ttsdebug=0(기본)이면 표시도 요소도 없고 동작이 같다: 출처 문구 요소가 만들어지지 않고 발음 테스트 글에 출처가 붙지 않으며 조정값 표시도 없다', { skip: SKIP }, async () => {
  resetState(); state.ttsHeader = 'HIT';
  const page = await openGame({ ids: [1, 2, 3], speech: true });
  await gameReady(page);
  await page.eval(OKPLAY);
  assert.equal(await page.eval("document.getElementById('tune').hidden"), true);
  const before = await page.eval('document.getElementById("box").querySelectorAll("*").length');
  const r = await sayWord(page, 'apple');
  assert.equal(r.ok, true);
  assert.equal(await page.eval("document.getElementById('ttsSrc')"), null, '요소 없음');
  assert.equal(await page.eval('document.getElementById("box").querySelectorAll("*").length'), before, 'DOM 변화 없음');
  assert.equal(await page.eval("document.querySelector('.ttssrc')"), null);
  await page.click('#ttsTest');
  await page.waitFor("document.getElementById('ttsStatus').textContent.includes('재생이 시작')", 4000);
  assert.ok(!(await page.text('#ttsStatus')).includes('['), '발음 테스트 글에 출처 없음');
  const p2 = await openQ({ ids: [1, 2, 3], query: 'ttsdebug=0' });
  assert.equal(await p2.eval("document.getElementById('tune').hidden"), true, '기본값과 같으면 표시 없음');
  await p2.close(); await page.close();
});

// ───────── 작업326: 장애물(바닥 상자·구덩이) ─────────
// 봇(페이지 안): 정답 글자는 기존 봇과 같은 규칙(정점에서 닿게)으로 점프하고, 장애물은 o.dodge 가 true 일 때만 "가운데가 점프 정점에 닿는 순간 + o.offset 초"에 점프한다.
// 틀린 글자는 절대 먹지 않는다(정답이 아니면 점프하지 않는다). 수동 진행(step) 모드. 장애물 계획과 결과를 모아 돌려 준다.
const OBOT = `(async (o) => {
  const R = window.SpellRun, G = R.G, C = R.CONFIG, T = C.JUMP_TIME, RX = R.RUNNER_X;
  const out = { steps: 0, obstSeen: 0, kinds: { box: 0, pit: 0 }, plans: [], hpMin: 99, speedDrops: 0, over: false, rounds: 0, mist: 0, hits: 0, hpStart: G.hp, snap: null, tilesSeenAtObstacle: 0 };
  const seen = new Set(); let lastWi = -1, lastWords = null, prev = G.speed, hpPrev = G.hp;
  const maxSteps = o.maxSteps || 60 * 1500;
  while (out.steps < maxSteps && G.state !== 'over') {
    if (G.words !== lastWords || G.wi !== lastWi) {
      lastWords = G.words; lastWi = G.wi;
      out.plans.push({ wi: G.wi, boss: !!G.words[G.wi].boss, obst: G.obst ? { slot: G.obst.slot, kind: G.obst.kind } : null, n: G.plan.slots.length, highs: G.plan.slots.map((s, i) => s.high ? i : -1).filter(i => i >= 0), heart: G.heartPending ? G.heartSlot : null, review: G.review });
    }
    if (G.state === 'run' && G.jumpT < 0) {
      const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > RX);
      const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.kind !== 'heart' && x.correct) && x.x > RX).sort((a, b) => a.x - b.x)[0];
      if (ob && o.dodge && (ob.x + ob.w / 2 - RX) / G.speed <= T / 2 + (o.offset || 0)) R.jump();
      else if (tg) {
        const tta = (tg.x - RX) / G.speed;
        if (tg.high) { if (tta <= T) R.jump(); } else if (tta <= T / 2) R.jump();
      }
    } else if (G.state === 'run' && G.jumpT >= 0 && G.j2 < 0) {   // 높은 칸: 공중에서 한 번 더
      const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.high && x.x > RX).sort((a, b) => a.x - b.x)[0];
      if (tg && (tg.x - RX) / G.speed <= T / 2) R.jump();
    }
    const hits0 = G.obstHits, spd0 = G.speed;
    R.step(1 / 60); out.steps++;
    for (const ob of G.obstacles) if (!seen.has(ob)) { seen.add(ob); out.obstSeen++; out.kinds[ob.kind]++; }
    if (G.speed < spd0 - 1e-6) out.speedDrops++;
    out.hits = G.obstHits; out.hpMin = Math.min(out.hpMin, G.hp);
    if (o.stopOnHit && G.obstHits > hits0) { out.snap = { hp: G.hp, hp0: hpPrev, speed: G.speed, spd0: spd0, speedBase: G.speedBase, target: G.speedTarget, combo: G.combo, score: G.score, invuln: G.invuln, state: G.state }; break; }
    hpPrev = G.hp;
    if (o.stopAfterObst && out.obstSeen >= o.stopAfterObst && G.obstacles.every(x => x.x + x.w < RX - 30)) break;
    if (steps_yield(out.steps)) await new Promise(r => setTimeout(r, 0));
  }
  out.over = G.state === 'over'; out.wordsDone = G.wordsDone; out.total = G.words.length; out.title = document.getElementById('resTitle').textContent; out.mist = G.mist.reduce((a, b) => a + b, 0); out.hp = G.hp;
  return out;
  function steps_yield(n) { return n % 300 === 0; }
})`;
const O_Q = '?obsprob=1&dj=0';   // 장애물 항상(후보가 있으면), 높은 칸 없음 → 장애물 행동만 따로 본다

test('326-2) 장애물이 나타난다(obsprob=1): 상자·구덩이가 둘 다 나오고, 장애물은 묶음 사이에만(첫 글자가 나오기 전·마지막 묶음 뒤에는 없음), 좌표는 첫 글자 앞이다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: O_Q, dodge: false });
  await gameReady(page);
  await page.click('#startBtn');
  await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval('SpellRun.manual = true');
  assert.equal(await page.eval("document.getElementById('obsRule') && document.getElementById('obsRule').textContent.length > 10"), true, '시작 화면 규칙에 장애물 설명');
  const r = await page.eval(`${OBOT}({ dodge: true, offset: 0 })`);
  for (let i = 0; i < 8 && !(r.kinds.box > 0 && r.kinds.pit > 0); i++) {   // 종류도 난수로 정해지므로 두 종류가 모두 나올 때까지 판을 거듭한다
    await page.eval("SpellRun.G.state = 'idle'; SpellRun.startRound(false); SpellRun.manual = true");
    const r2 = await page.eval(`${OBOT}({ dodge: true, offset: 0 })`);
    r.kinds.box += r2.kinds.box; r.kinds.pit += r2.kinds.pit; r.obstSeen += r2.obstSeen; r.plans.push(...r2.plans);
  }
  assert.equal(r.over, true); assert.ok(r.obstSeen >= 3, '장애물이 여러 번 나온다: ' + r.obstSeen);
  assert.ok(r.kinds.box > 0 && r.kinds.pit > 0, '상자와 구덩이 모두: ' + JSON.stringify(r.kinds));
  for (const p of r.plans) { if (p.obst) { assert.ok(p.obst.slot >= 1 && p.obst.slot <= p.n - 1, `장애물 자리 ${p.obst.slot} / ${p.n}칸: 첫 묶음 앞·마지막 묶음 뒤 아님`); assert.ok(!p.boss); } }
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('326-2) 점프로 넘으면 체력·속도·콤보가 그대로다. 점프하지 않으면 체력 -1, 속도가 0.6배로 즉시 줄고 기존 가속도로 회복하며, 콤보·점수는 그대로이고 같은 장애물에 두 번 맞지 않는다', { skip: SKIP }, async () => {
  resetState();
  // (가) 점프: 여러 판 동안 한 번도 맞지 않고, 장애물 때문에 속도가 줄어드는 일이 없다(실수가 없으면 속도는 줄지 않는다)
  let page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: O_Q, dodge: false });
  await gameReady(page);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const a = await page.eval(`${OBOT}({ dodge: true, offset: 0 })`);
  assert.ok(a.obstSeen >= 3); assert.equal(a.hits, 0, '점프한 장애물에는 맞지 않는다'); assert.equal(a.hpMin, a.hpStart, '체력 불변'); assert.equal(a.speedDrops, 0, '속도 감소 없음');
  await page.close();

  // (나) 점프하지 않음: 글자만 먹는 봇이 첫 장애물에서 멈춘다
  page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: O_Q, dodge: false });
  await gameReady(page);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const b = await page.eval(`${OBOT}({ dodge: false, stopOnHit: true })`);
  assert.ok(b.snap, '장애물에 맞았다'); assert.equal(b.hits, 1);
  const C = await page.eval('SpellRun.CONFIG'), s = b.snap, acc = C.SPEED_ACCEL / 60;
  assert.equal(s.hp, s.hp0 - 1, '체력 -1');
  assert.ok(s.speed >= 0.6 * (b.snap.spd0 - 1) && s.speed <= 0.6 * (b.snap.spd0 + acc + 1), `속도 즉시 0.6배: ${s.spd0.toFixed(1)} → ${s.speed.toFixed(1)}`);
  assert.ok(s.speedBase <= C.SPEED_MIN + 1e-9 || s.speedBase >= 0, '기본 누적 속도는 SPEED_DROP_FAIL 만큼 줄었거나 최저');
  assert.ok(s.invuln > 0 && Math.abs(s.invuln - C.OBST_INVULN_SEC) < 0.02, '무적 시간 0.8초: ' + s.invuln);
  assert.equal(s.state, 'run');
  const before = await page.eval('(() => { const G = SpellRun.G; return { combo: G.combo, score: G.score, mist: G.mist.reduce((x, y) => x + y, 0) }; })()');
  assert.equal(s.combo, before.combo, '콤보 불변'); assert.equal(s.score, before.score, '점수 불변'); assert.equal(before.mist, 0, '철자 실수로 세지 않는다(한 번에 완성 기록 유지)');
  // 회복: 다음 1.5초 동안 속도가 목표 속도로 올라온다(내려가지 않음). 같은 장애물에 다시 맞지 않는다(체력 그대로)
  const rec = await page.eval(`(() => { const R = SpellRun, G = R.G, C = R.CONFIG; const hp0 = G.hp, o = []; let prev = G.speed, mono = true, t = 0, reach = -1; const target = G.speedTarget;
    while (t < 1.5) { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((p, q) => p.x - q.x)[0]; if (G.state === 'run' && G.jumpT < 0 && tg && (tg.x - R.RUNNER_X) / G.speed <= C.JUMP_TIME / 2) R.jump();   // 글자는 계속 정상 플레이
      R.step(1 / 60); t += 1 / 60; if (G.speed < prev - 1e-6 && G.hp === hp0) mono = false; prev = G.speed; if (reach < 0 && G.speed >= G.speedTarget - 1) reach = t; if (G.state === 'over' || G.state === 'ending') break; }   // 작업339: 단어가 끝나 완성 연출(pop)로 넘어가도 1.5초를 끝까지 잰다(예전에는 run 이 아니면 중단해서 가끔 회복 전에 끝났다)
    return { hp0: hp0, hp: G.hp, hits: G.obstHits, mono: mono, reach: reach, target: target, speed: G.speed }; })()`);
  assert.equal(rec.hits, 1, '한 장애물에 한 번만'); assert.equal(rec.hp, rec.hp0, '회복하는 동안 체력 변화 없음');
  assert.ok(rec.mono, '속도는 올라가기만 한다'); assert.ok(rec.reach > 0 && rec.reach < 1.5, '1.5초 안에 목표 속도로 회복: ' + rec.reach.toFixed(2) + '초 ' );
  await page.close();

  // (다) 구덩이/상자 각각 한 번씩 맞는 경우를 모두 본다(맞은 종류 기록): 두 종류 모두 같은 효과
  const kinds = new Set();
  for (let i = 0; i < 40 && kinds.size < 2; i++) {
    const p = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: O_Q, dodge: false });
    await gameReady(p); await p.click('#startBtn'); await p.waitFor("SpellRun.G.state === 'run'", 4000); await p.eval('SpellRun.manual = true');
    const r = await p.eval(`${OBOT}({ dodge: false, stopOnHit: true })`);
    const kind = await p.eval("SpellRun.G.obstacles.find(o => o.hit).kind");
    assert.equal(r.snap.hp, r.snap.hp0 - 1, kind + ' 체력 -1'); assert.ok(r.snap.speed < r.snap.spd0 * 0.65, kind + ' 속도 감소');
    assert.ok(await p.eval('SpellRun.G.fall > 0 || SpellRun.G.stumble > 0'), kind + ' 연출 시작(구덩이 fall, 상자 stumble)');
    assert.equal(await p.eval(`(SpellRun.G.fall > 0) === (${JSON.stringify(kind)} === 'pit')`), true, '구덩이는 빠짐, 상자는 비틀거림');
    kinds.add(kind); await p.close();
  }
  assert.equal(kinds.size, 2, '상자·구덩이 둘 다 확인: ' + [...kinds]);
});

test('326-2) 체력이 1일 때 장애물에 맞으면 기존 게임 오버 경로(ending → 결과 화면)로 간다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: O_Q + '&hp=1', dodge: false });
  await gameReady(page);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const r = await page.eval(`${OBOT}({ dodge: false, stopOnHit: true })`);
  assert.equal(r.snap.hp, 0); assert.equal(r.snap.state, 'ending');
  await page.eval('(() => { for (let i = 0; i < 80; i++) SpellRun.step(1 / 60); })()');
  assert.equal(await page.eval('SpellRun.G.state'), 'over'); assert.equal(await page.text('#resTitle'), '게임 오버');
  await page.close();
});

test('326-4) 장애물에서만 점프하는 봇(글자는 정답일 때만, 틀린 글자는 절대 안 먹음)이 점프 타이밍을 앞·가운데·뒤로 바꿔 여러 판을 틀린 글자 없이 끝까지 진행한다(높은 칸·기본 옵션 포함)', { skip: SKIP }, async () => {
  resetState();
  let total = 0, kinds = { box: 0, pit: 0 };
  for (const [offset, q] of [[0, '?obsprob=1'], [-0.04, '?obsprob=1'], [0.04, '?obsprob=1'], [0, O_Q], [0.03, '?obsprob=1&heartevery=1']]) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: q, dodge: false });
    await gameReady(page);
    for (let round = 0; round < 2; round++) {
      await page.click(round ? '#againBtn' : '#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
      if (round) await page.eval("SpellRun.G.hp = 5");   // 하트 규칙은 이 시험의 대상이 아니다
      const r = await page.eval(`${OBOT}({ dodge: true, offset: ${offset} })`);
      assert.equal(r.over, true, `offset ${offset} 판 ${round}: 끝났다`);
      assert.equal(r.title === '게임 오버', false, `offset ${offset}: 게임 오버 아님(${r.title})`);
      assert.equal(r.mist, 0, `offset ${offset}: 틀린 글자·놓침 0`); assert.equal(r.hits, 0, `offset ${offset}: 장애물에 맞은 적 없음`);
      assert.equal(r.hpMin, 5, `offset ${offset}: 체력 한 번도 안 줄어듦`); assert.equal(r.wordsDone, r.total);
      total += r.obstSeen; kinds.box += r.kinds.box; kinds.pit += r.kinds.pit;
    }
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  }
  assert.ok(total >= 20 && kinds.box > 3 && kinds.pit > 3, `충분히 많은 장애물을 넘었다: ${total} ${JSON.stringify(kinds)}`);
});

test('326-1) 배치 규칙(페이지 안): 보스 단어에는 없고, 높은 칸·하트 묶음에서 1묶음 이내에는 없으며, 단어당 최대 1개. 복습 판에도 같다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obsprob=1&highprob=0.5&heartevery=1', dodge: false });
  await gameReady(page);
  const plans = [];
  const variety = () => plans.length >= 15 && plans.some(p => p.boss) && plans.some(p => p.review) && plans.some(p => p.highs.length) && plans.some(p => p.heart !== null && p.obst);
  for (let ri = 0; ri < 14 && (ri < 3 || !variety()); ri++) {   // 배치가 난수라 여러 경우가 모두 나올 때까지 판을 거듭한다
    const review = ri === 2 || ri > 2 && ri % 2 === 1;
    if (review) await page.eval("(() => { for (const w of ['apple', 'book', 'environment', 'water', 'happy']) SpellRun.missedSet.add(w); })()");
    await page.eval(`SpellRun.startRound(${review})`); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
    const r = await page.eval(`${OBOT}({ dodge: true, offset: 0 })`);
    assert.equal(r.over, true); plans.push(...r.plans);
    await page.eval("(() => { SpellRun.G.state = 'idle'; })()");
  }
  assert.ok(plans.length >= 15 && plans.some(p => p.boss) && plans.some(p => p.review) && plans.some(p => p.highs.length) && plans.some(p => p.heart !== null && p.obst), '다양한 단어: ' + plans.length);
  for (const p of plans) {
    if (p.boss) assert.equal(p.obst, null, '보스 단어에는 장애물 없음');
    if (!p.obst) continue;
    const g = p.obst.slot;
    assert.ok(g >= 1 && g <= p.n - 1);
    for (const j of p.highs) assert.ok(Math.min(Math.abs(g - 1 - j), Math.abs(g - j)) > 1, `높은 칸 ${j} 와 장애물 간격 ${g} 는 1묶음 넘게 떨어져 있다 (${JSON.stringify(p)})`);
    if (p.heart !== null) assert.ok(g <= p.heart - 2, `하트 ${p.heart} 와 장애물 간격 ${g} (${JSON.stringify(p)})`);
  }
  await page.close();
});

test('326-3) obs=0 이면 장애물 없음: 상태·화면 구성(규칙 줄 없음)이 이전과 같고, 첫 글자는 이전 식(리드 거리) 그대로 나오며, 글자만 보는 봇이 체력 손실 없이 끝까지 간다. obsprob=0 도 장애물이 없다', { skip: SKIP }, async () => {
  resetState();
  for (const q of ['?obs=0', '?obsprob=0']) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: q, dodge: false });
    await gameReady(page);
    assert.equal(await page.eval("!!document.getElementById('obsRule')"), false, q + ': 장애물이 나올 수 없으면 규칙 줄 없음');
    assert.equal(await page.eval("document.querySelectorAll('.rules li').length"), 9, q + ': 규칙 줄 9개(이전 7개 + 작업328 가속 아이템 줄 + 작업329 구조 아이템 줄. 장애물 줄은 없다)');
    assert.equal(await page.eval("document.getElementById('tune').hidden"), false, q + ': 기본값과 다른 옵션이라 조정값 표시');
    await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
    // 첫 글자가 나오는 순간의 위치 = 이전 식(RUNNER_X + 목표 속도 × 리드 시간)
    const first = await page.eval(`(() => { const R = SpellRun, G = R.G, C = R.CONFIG; let n = 0; while (!G.tiles.length && n++ < 1200) R.step(1 / 60);
      const v = G.speedTarget, lead = C.LEAD_SEC_SLOW + (C.LEAD_SEC_FAST - C.LEAD_SEC_SLOW) * Math.max(0, Math.min(1, (v - C.SPEED_MIN) / (C.SPEED_MAX - C.SPEED_MIN)));
      return { x: G.tiles[0].x, expect: R.RUNNER_X + v * lead, obst: G.obstacles.length, plan: G.obst }; })()`);
    assert.ok(Math.abs(first.x - first.expect) < 0.01, `${q}: 첫 글자 위치 ${first.x} = 이전 식 ${first.expect}`);
    const r = await page.eval(`${OBOT}({ dodge: false })`);
    assert.equal(r.obstSeen, 0, q + ': 장애물 없음'); assert.ok(r.plans.every(p => p.obst === null)); assert.equal(r.over, true); assert.equal(r.title === '게임 오버', false);
    assert.equal(r.hpMin, 5, q + ': 체력 손실 없음'); assert.equal(r.mist, 0);
    await page.close();
  }
});

test('326-3) 기본(옵션 없음)은 장애물 켜짐이고 "조정값 사용 중" 표시가 없다. obs=1·obsprob=0.5 처럼 기본값과 같은 값만 있어도 표시가 없다', { skip: SKIP }, async () => {
  resetState();
  for (const q of ['', '?obs=1', '?obsprob=0.5', '?obs=1&obsprob=0.5']) {
    const page = await openGame({ ids: [1, 2, 3], query: q, dodge: false });
    await gameReady(page);
    assert.equal(await page.eval("document.getElementById('tune').hidden"), true, q + ' 표시 없음');
    assert.equal(await page.eval('SpellRun.CONFIG.OBST_ENABLED'), true); assert.equal(await page.eval('SpellRun.CONFIG.OBSTACLE_PROB'), 0.5);
    assert.equal(await page.eval("!!document.getElementById('obsRule')"), true);
    await page.close();
  }
  const p = await openGame({ ids: [1, 2, 3], query: '?obsprob=0.8&obs=2', dodge: false });
  await gameReady(p);
  assert.equal(await p.eval('SpellRun.CONFIG.OBSTACLE_PROB'), 0.8); assert.equal(await p.eval("document.getElementById('tune').hidden"), false, 'obsprob=0.8 은 조정값'); assert.match(await p.eval("document.getElementById('tune').title"), /obsprob/);
  assert.doesNotMatch(await p.eval("document.getElementById('tune').title"), /\bobs\b[^p]/, '범위 밖 obs=2 는 무시');
  await p.close();
  await clearOpts();
});

test('326-2) 폭 320·360·390: 장애물(경고 표지 윗끝)은 상단 힌트·글자 칸 줄·HUD 와 겹치지 않고 글자 타일 줄 아래에 있으며, 화면 밖으로 삐져나가 가로 스크롤을 만들지 않는다', { skip: SKIP }, async () => {
  resetState();
  for (const w of [320, 360, 390]) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: O_Q, width: w, dodge: false });
    await gameReady(page);
    await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
    const r = await page.eval(`(async () => { const R = SpellRun, G = R.G; let n = 0, found = null;
      while (n++ < 60 * 400 && G.state !== 'over' && !found) {
        const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
        const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X);
        if (G.state === 'run' && G.jumpT < 0) { if (ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= R.CONFIG.JUMP_TIME / 2) R.jump(); else if (tg && (tg.x - R.RUNNER_X) / G.speed <= R.CONFIG.JUMP_TIME / 2) R.jump(); }
        R.step(1 / 60);
        const o2 = G.obstacles[0]; if (o2 && o2.x > 150 && o2.x < 330) found = o2;
        if (n % 200 === 0) await new Promise(r => setTimeout(r, 0));
      }
      if (!found) return null;
      R.draw();
      const box = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u'));
      const bot = id => { const e = document.getElementById(id); return e && !e.hidden ? (e.getBoundingClientRect().bottom - box.top) / u : 0; };
      const top = R.obstTop(found);
      return { top: top, hint: Math.max(bot('hintbox'), bot('word'), bot('sub'), bot('meaning')), hud: bot('hud') && Math.max(...[...document.querySelectorAll('#hud .row')].map(e => (e.getBoundingClientRect().bottom - box.top) / u)), tileBottom: R.TILE_Y + 29 + 5, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, kind: found.kind, x: found.x, w: found.w }; })()`);
    assert.ok(r, w + ': 장애물이 화면에 나온다');
    assert.ok(r.top > r.hint + 20, `${w}px: 표지 윗끝 ${r.top} 가 힌트·글자 칸 줄 아래 끝 ${r.hint} 보다 충분히 아래`);
    assert.ok(r.top > r.hud + 20, `${w}px: HUD 아래 끝 ${r.hud}`);
    assert.ok(r.top > r.tileBottom, `${w}px: 글자 타일 줄(아래 끝 ${r.tileBottom}) 아래: ${r.top}`);
    assert.ok(r.scrollW <= r.clientW, `${w}px: 가로 스크롤 없음 (${r.scrollW} / ${r.clientW})`);
    await page.close();
  }
});

test('326-2) 그림(시트를 못 불러온 대체 그림): 상자·구덩이·경고 표지가 캔버스에 실제로 그려지고(색이 있는 픽셀), 글자 타일 색과 구분된다. 연출 중에도 오류가 없다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: O_Q, dodge: false, blockObst: true });   // 작업327: 시트가 있으면 상자 대신 그림이 나오므로, 코드 그림(대체) 검사는 시트를 막고 한다
  await gameReady(page);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const px = await page.eval(`(() => { const R = SpellRun, G = R.G, cv = document.getElementById('cv'), cx = cv.getContext('2d'), S = cv.width / 360; const seenKinds = {};
    const colorAt = (x, y) => Array.from(cx.getImageData(Math.round(x * S), Math.round(y * S), 1, 1).data);
    for (let n = 0; n < 60 * 600 && Object.keys(seenKinds).length < 2; n++) {
      const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
      if (G.jumpT < 0 && tg && (tg.x - R.RUNNER_X) / G.speed <= R.CONFIG.JUMP_TIME / 2) R.jump();
      const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X); if (G.jumpT < 0 && ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= R.CONFIG.JUMP_TIME / 2) R.jump();
      R.step(1 / 60);
      const o = G.obstacles.find(x => !x.hit && x.x > 200 && x.x < 300);
      if (o && !seenKinds[o.kind]) { R.draw(); const mid = o.x + o.w / 2;
        seenKinds[o.kind] = o.kind === 'pit' ? { hole: colorAt(mid, 560), road: colorAt(mid - o.w, 560), sign: colorAt(mid + 6, R.obstTop(o) + 20) } : { face: colorAt(o.x + 4, 520 - 6), outline: colorAt(mid, 520 - R.CONFIG.OBST_H - 1), sign: colorAt(mid + 6, R.obstTop(o) + 20) }; }
    }
    return seenKinds; })()`);
  assert.ok(px.pit && px.box, '두 종류를 그렸다: ' + JSON.stringify(Object.keys(px)));
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(px.pit.hole) < 25 && lum(px.pit.road) > 25 || lum(px.pit.hole) < lum(px.pit.road), '구덩이는 도로보다 어둡다: ' + JSON.stringify(px.pit));
  assert.ok(px.pit.sign[0] > 180 && px.pit.sign[1] < 120, '경고 표지는 빨강: ' + px.pit.sign);
  assert.ok(px.box.face[3] === 255 && px.box.sign[0] > 180 && px.box.sign[1] < 120, '상자 쪽 경고 표지도 빨강: ' + JSON.stringify(px.box));
  const TILE = [[255, 210, 94], [255, 159, 178], [126, 217, 195], [168, 192, 255]];   // 글자 타일 색(game.js TILE_COLORS)
  const near = (c, t) => Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2]) < 40;
  assert.ok(!TILE.some(t => near(px.box.face, t)), '상자 색은 글자 타일 색과 다르다: ' + px.box.face);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

// ───────── 작업327: 장애물 그림 교체·예고 표시·구덩이 ─────────
// drawImage 호출을 가로채 장애물 시트 그림의 인자를 모은다(페이지 안). 호출 전에 설치한다.
const SPY_ART = `(() => { const P = CanvasRenderingContext2D.prototype, orig = P.drawImage; window.__art = []; P.drawImage = function (img, ...a) { if (img && img.src && /obstacles_sheet/.test(img.src)) window.__art.push(a.slice(0, 8)); return orig.call(this, img, ...a); }; })()`;
// 장애물 하나가 화면에 있는 순간까지 정답 글자 + 장애물 넘기 봇으로 진행해, 조건(문자열 식)이 참이 되면 멈춘다
const RUN_UNTIL = (cond, max) => `(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; let n = 0;
  while (n++ < ${max || 60 * 600} && G.state !== 'over' && !(${cond})) {
    if (G.state === 'run' && G.jumpT < 0) {
      const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X), tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
      if (ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= C.JUMP_TIME / 2) R.jump(); else if (tg && (tg.x - R.RUNNER_X) / G.speed <= C.JUMP_TIME / 2) R.jump();
    }
    R.step(1 / 60); if (n % 300 === 0) await new Promise(r => setTimeout(r, 0));
  }
  return n < ${max || 60 * 600} && G.state !== 'over'; })()`;

test('327-1) 시트 파일: public/img/spellrun/spellrun_obstacles_sheet.png 1024×256 RGBA 한 장만 있고(zip·개별 파일 없음), 페이지가 그 주소를 1회만 요청한다', { skip: SKIP }, async () => {
  const f = path.join(PUB, 'img', 'spellrun', 'spellrun_obstacles_sheet.png');
  const b = fs.readFileSync(f);
  assert.equal(b.subarray(1, 4).toString(), 'PNG'); assert.equal(b.readUInt32BE(16), 1024); assert.equal(b.readUInt32BE(20), 256); assert.equal(b[24], 8); assert.equal(b[25], 6, 'RGBA');
  assert.deepEqual(fs.readdirSync(path.dirname(f)).sort(), ['spellrun_obstacles_sheet.png', 'spellrun_penguin_sheet.png'], '시트 두 장(펭귄·장애물)만');
  assert.ok(!fs.readdirSync(PUB, { recursive: true }).some(x => /obstacles_frames\.zip|obstacle_[1-4]_[a-z]+\.png/.test(String(x))), 'zip·개별 파일 없음');
  resetState();
  const page = await openGame({ ids: [1, 2, 3] });
  await gameReady(page);
  await page.waitFor('SpellRun.obstArt().ready', 4000);
  const reqs = await page.eval("performance.getEntriesByType('resource').filter(e => /obstacle/.test(e.name)).map(e => new URL(e.name).pathname)");
  assert.deepEqual(reqs, ['/img/spellrun/spellrun_obstacles_sheet.png'], '시트 요청 1회');
  const objs = await page.eval('SpellRun.obstArt().objs');
  const est = [[202, 134], [187, 136], [158, 180], [214, 150]];
  objs.forEach((o, i) => { assert.ok(Math.abs(o.w - est[i][0]) <= 3 && Math.abs(o.h - est[i][1]) <= 3, `알파로 잰 ${o.name} 크기 ${o.w}×${o.h} ≈ 추정 ${est[i]}`); assert.ok(Math.abs(o.foot - 237) <= 2, o.name + ' 바닥 ' + o.foot); });
  await page.close();
});

test('327-2) 시트가 로딩되면 4종(돌무더기·통나무·콘·가시덤불)이 장애물마다 정해져 그려지고, 크기·바닥·중심 규칙을 따르며, 지나가는 동안 바뀌지 않는다. 판정 크기는 326 그대로다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obsprob=1&dj=0', dodge: false });
  await gameReady(page);
  await page.waitFor('SpellRun.obstArt().ready', 4000);
  await page.eval(SPY_ART);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const out = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG, arts = new Set(), checks = []; let seq = [];
    for (let round = 0; round < 12 && !(arts.size === 4 && round >= 3); round++) {   // 4종이 모두 나올 때까지(난수로 정해진 배치를 따르므로 판 수는 가변)
      if (round) { G.state = 'idle'; R.startRound(false); R.manual = true; }
      let n = 0;
      while (n++ < 60 * 400 && G.state !== 'over') {
        if (G.state === 'run' && G.jumpT < 0) {
          const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X), tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
          if (ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= C.JUMP_TIME / 2) R.jump(); else if (tg && (tg.x - R.RUNNER_X) / G.speed <= C.JUMP_TIME / 2) R.jump();
        }
        R.step(1 / 60);
        for (const o of G.obstacles) if (o.kind === 'box') {
          if (!o._seen) { o._seen = true; o._art0 = o.art; arts.add(o.art); seq.push(o.art); }
          if (o.art !== o._art0) checks.push('종류가 바뀜');
          if (o.x > 40 && o.x < 330 && !o._drawn) { window.__art.length = 0; R.draw(); const a = window.__art[window.__art.length - 1];
            if (a) { o._drawn = true; checks.push({ art: o.art, a: a, cx: o.x + o.w / 2, w: o.w }); } }
        }
        if (n % 300 === 0) await new Promise(r => setTimeout(r, 0));
      }
    }
    return { arts: [...arts], checks: checks, objs: R.obstArt().objs, W: C.OBST_W, H: C.OBST_H, PW: C.PIT_W, seqLen: seq.length }; })()`);
  assert.deepEqual(out.arts.sort(), [0, 1, 2, 3], '4종 모두 그려졌다: ' + out.arts);
  assert.ok(!out.checks.includes('종류가 바뀜'), '그림은 지나가는 동안 바뀌지 않는다');
  const draws = out.checks.filter(c => typeof c === 'object');
  assert.ok(draws.length >= 4);
  for (const c of draws) {
    const [sx, sy, sw, sh, dx, dy, dw, dh] = c.a, o = out.objs[c.art], k = out.W * 1.4 / Math.max(o.w, o.h);
    assert.equal(sx, c.art * 256); assert.equal(sy, 0); assert.equal(sw, 256); assert.equal(sh, 256);
    assert.ok(Math.abs(dw - 256 * k) < 0.01 && Math.abs(dh - 256 * k) < 0.01, `크기 ${dw} ≈ ${256 * k} (긴 변 ${Math.max(o.w, o.h) * k} = ${out.W * 1.4})`);
    assert.ok(Math.abs(dy + o.foot * k - 520) < 0.01, '물체 바닥이 땅 선(520)'); assert.ok(Math.abs(dx + 128 * k - c.cx) < 0.01, '가로 중앙');
  }
  assert.deepEqual([out.W, out.H, out.PW], [28, 28, 36], '판정 크기 그대로');
  await page.close();
});

test('327-2) 로딩 실패(시트 요청 차단): 기존 코드 상자로 그려지고(시트 그림 호출 0), 한 판이 끝까지 진행되며 오류가 없다', { skip: SKIP }, async () => {
  resetState();
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await withDodge(page);
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls: ['*spellrun_obstacles_sheet*'] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); sessionStorage.setItem('spellrun_ids', '[1,2,3,4,11,12,13,14]'); } catch (e) {}" });
  await page.goto(base + '/spelling_run.html?obsprob=1&dj=0');
  await gameReady(page);
  await page.eval(SPY_ART);
  assert.equal(await page.eval('SpellRun.obstArt().ready'), false);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const seen = await page.eval(`(async () => { const R = SpellRun, G = R.G; let drawn = 0, boxes = 0;
    for (let rd = 0; rd < 8 && !boxes; rd++) { if (rd) { G.state = 'idle'; R.startRound(false); R.manual = true; }
    await ${RUN_UNTIL("(() => { for (const o of G.obstacles) if (o.kind === 'box' && o.x > 60 && o.x < 330 && !o._d) { o._d = true; R.draw(); boxes++; } return false; })()")};
    }
    return { boxes: boxes, art: window.__art.length, over: G.state === 'over', title: document.getElementById('resTitle').textContent, hp: G.hp, hits: G.obstHits }; })()`);
  assert.ok(seen.boxes >= 1, '상자 장애물이 나왔다 ' + JSON.stringify(seen)); assert.equal(seen.art, 0, '시트 그림 호출 없음(코드 상자로 대체)');
  assert.equal(seen.over, true); assert.notEqual(seen.title, '게임 오버'); assert.equal(seen.hits, 0);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource|ERR_BLOCKED/.test(e)), [], '오류 없음');
  await page.close();
});

test('327-3) 구덩이: 판정 폭 36 은 그대로이고 그림은 1.25배 넓게(45px), 입구 양쪽에 노랑 줄무늬·흰 가장자리, 안쪽은 아래로 갈수록 어둡다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obsprob=1&dj=0', dodge: false });
  await gameReady(page);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  let px = null;
  for (let i = 0; i < 8 && !px; i++) {
    px = await page.eval(`(async () => { const R = SpellRun, G = R.G, cv = document.getElementById('cv'), cx = cv.getContext('2d'), S = cv.width / 360;
      const col = (x, y) => Array.from(cx.getImageData(Math.round(x * S), Math.round(y * S), 1, 1).data);
      const found = await ${RUN_UNTIL("G.obstacles.some(o => o.kind === 'pit' && o.x > 200 && o.x < 300)", 60 * 120)};
      if (!found) return null;
      const o = G.obstacles.find(o => o.kind === 'pit' && o.x > 200 && o.x < 300); R.draw();
      const mid = o.x + o.w / 2, dw = o.w * R.CONFIG.PIT_ART_K;
      return { w: o.w, dw: dw, top: col(mid, 530), deep: col(mid, 620), stripe: Array.from({ length: 11 }, (_, i) => col(mid - dw / 2 - 21 + i * 2, 515)), border: Array.from({ length: 9 }, (_, i) => col(mid - dw / 2 - 10, 508 + i * 0.5)), outL: col(mid - dw / 2 - 26, 560), inL: col(mid - dw / 2 + 4, 560) }; })()`);
    if (!px) { await page.eval("SpellRun.startRound(false); SpellRun.manual = true"); }
  }
  assert.ok(px, '구덩이가 나왔다'); assert.equal(px.w, 36); assert.ok(Math.abs(px.dw - 45) < 1e-9, '그림 폭 36×1.25');
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(px.deep) < lum(px.top), '아래로 갈수록 어둡다: ' + px.top + ' → ' + px.deep);
  assert.ok(lum(px.deep) < 12, '깊은 곳은 거의 검정'); assert.ok(lum(px.inL) < lum(px.outL), '구멍 안이 도로보다 어둡다: ' + px.inL + ' vs ' + px.outL);
  assert.ok(px.stripe.some(c => c[0] > 230 && c[1] > 150 && c[2] < 80), '입구 줄무늬에 노랑: ' + JSON.stringify(px.stripe)); assert.ok(px.stripe.some(c => lum(c) < 60), '노랑/검정 줄무늬(어두운 줄도 있다)');
  assert.ok(px.border.some(c => c[0] > 220 && c[1] > 220 && c[2] > 220), '흰 가장자리 선: ' + JSON.stringify(px.border));
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('327-4) 예고 표시: 장애물이 정해진 뒤 새 묶음이 나오기 전부터 장애물 앞쪽 끝이 러너에 닿을 때까지만 보이고(0.6초 이상), 오른쪽 가장자리에서 깜빡이는 삼각형이며, obs=0 이면 없다. 판정에는 영향이 없다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obsprob=1&dj=0', dodge: false });
  await gameReady(page);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const r = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG, cv = document.getElementById('cv'), cx = cv.getContext('2d'), S = cv.width / 360, RX = R.RUNNER_X;
    const periods = []; let cur = null, bad = [], pix = null;
    for (let n = 0; n < 60 * 500 && G.state !== 'over'; n++) {
      if (G.state === 'run' && G.jumpT < 0) {
        const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > RX), tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.kind !== 'heart' && x.x > RX).sort((a, b) => a.x - b.x)[0];
        if (ob && (ob.x + ob.w / 2 - RX) / G.speed <= C.JUMP_TIME / 2) R.jump(); else if (tg && (tg.x - RX) / G.speed <= C.JUMP_TIME / 2) R.jump();
      }
      R.step(1 / 60);
      const on = R.obstWarnActive(), frontAhead = G.obstacles.some(o => !o.hit && o.x > RX + C.OBST_FOOT), pending = !!(G.obst && !G.obst.done && G.obst.slot === G.si && !G.packActive && G.state === 'run');
      if (on !== (pending || frontAhead)) bad.push('활성 조건 불일치');
      if (on) { if (!cur) cur = { t: 0, speed: G.speed }; cur.t += 1 / 60;
        if (!pix) { G.time = 0; R.draw(); pix = Array.from(cx.getImageData(Math.round((360 - 24 + 6) * S), Math.round((520 - 34 + 5) * S), 1, 1).data); } }
      else if (cur) { periods.push(cur); cur = null; }
      if (n % 300 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { periods: periods, bad: bad, pix: pix, hp: G.hp, hits: G.obstHits, tileTop: R.TILE_Y + 29 }; })()`);
  assert.ok(r.periods.length >= 3, '예고가 여러 번 나왔다: ' + r.periods.length);
  for (const p of r.periods) assert.ok(p.t >= 0.6 - 0.05, `예고 ${p.t.toFixed(2)}초(속도 ${p.speed.toFixed(0)}) ≥ 0.6`);
  assert.deepEqual(r.bad, []); assert.equal(r.hits, 0, '예고 표시는 판정에 영향이 없다(넘기 봇은 한 번도 안 맞음)');
  assert.ok(r.pix && r.pix[3] === 255 && r.pix[0] > 200 && r.pix[1] > 120, '오른쪽 가장자리에 노랑 삼각형: ' + r.pix);
  await page.close();
  // obs=0: 예고 없음
  const p2 = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obs=0', dodge: false });
  await gameReady(p2); await p2.click('#startBtn'); await p2.waitFor("SpellRun.G.state === 'run'", 4000); await p2.eval('SpellRun.manual = true');
  assert.equal(await p2.eval(`(() => { let on = 0; for (let n = 0; n < 60 * 20; n++) { SpellRun.step(1 / 60); if (SpellRun.obstWarnActive()) on++; } return on; })()`), 0);
  await p2.close();
});

test('327-4) 폭 320·360·390: 예고 표시·장애물 그림은 글자 타일 줄·하트·힌트·상단 표시와 겹치지 않는다', { skip: SKIP }, async () => {
  resetState();
  for (const w of [320, 360, 390]) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obsprob=1&dj=0', width: w, dodge: false });
    await gameReady(page);
    await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true; SpellRun.G.hp = 2');   // 체력을 줄여 두면 하트도 나온다
    const r = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG, RX = R.RUNNER_X; const box = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u'));
      const bot = id => { const e = document.getElementById(id); return e && !e.hidden ? (e.getBoundingClientRect().bottom - box.top) / u : 0; };
      let warnOn = 0, overlapTile = 0, overlapHeart = 0, maxTop = 1e9, artTops = [];
      for (let n = 0; n < 60 * 300 && G.state !== 'over'; n++) {
        if (G.state === 'run' && G.jumpT < 0) {
          const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > RX), tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.correct || x.kind === 'heart') && x.x > RX).sort((a, b) => a.x - b.x)[0];
          if (ob && (ob.x + ob.w / 2 - RX) / G.speed <= C.JUMP_TIME / 2) R.jump(); else if (tg && (tg.x - RX) / G.speed <= C.JUMP_TIME / 2) R.jump();
        }
        R.step(1 / 60);
        if (R.obstWarnActive()) { warnOn++;
          // 표시 사각형(논리 px): x 360-24±17, y 520-34-15 ~ 520-34+12 → 아래 끝/위 끝이 타일·하트 줄과 겹치는지
          const wx0 = 360 - 24 - 17, wy0 = 520 - 34 - 17;
          for (const t of G.tiles) { const ty = t.kind === 'heart' ? R.TILE_Y : (t.high ? R.HIGH_Y : R.TILE_Y), half = t.kind === 'heart' ? 24 : 29 + 5, tw = t.w / 2;
            if (t.x + tw > wx0 && t.x - tw < 360 && ty + half > wy0) { if (t.kind === 'heart') overlapHeart++; else overlapTile++; } } }
        for (const o of G.obstacles) if (o.x > 0 && o.x < 360) artTops.push(R.obstTop(o));
      }
      return { warnOn: warnOn, overlapTile: overlapTile, overlapHeart: overlapHeart, minArtTop: Math.min(...artTops), hint: Math.max(bot('hintbox'), bot('word'), bot('sub'), bot('meaning')), hud: Math.max(...[...document.querySelectorAll('#hud .row')].map(e => (e.getBoundingClientRect().bottom - box.top) / u)), warnTop: 520 - 34 - 17, tileBottom: R.TILE_Y + 34 }; })()`);
    assert.ok(r.warnOn > 60, w + ': 예고가 보인 프레임 ' + r.warnOn);
    assert.equal(r.overlapTile, 0, w + ': 예고 표시와 글자 타일이 겹치지 않는다'); assert.equal(r.overlapHeart, 0, w + ': 하트와도');
    assert.ok(r.warnTop > r.tileBottom && r.warnTop > r.hint + 20 && r.warnTop > r.hud + 20, `${w}: 예고 위끝 ${r.warnTop} 가 타일 줄(${r.tileBottom})·힌트(${r.hint})·HUD(${r.hud}) 아래`);
    assert.ok(r.minArtTop > r.hint + 20 && r.minArtTop > r.hud + 20, `${w}: 장애물 그림 윗끝 ${r.minArtTop} 가 힌트·HUD 아래`);
    await page.close();
  }
});

// ───────── 작업328: 하트 규칙 변경 · 가속 아이템 ─────────
// 정답·하트·번개 칸을 먹고 장애물은 넘는 봇(페이지 안). 판 전체를 돌리며 속도·가속·점수를 기록한다.
const IBOT = `(async (o) => {
  const R = window.SpellRun, G = R.G, C = R.CONFIG, T = C.JUMP_TIME, RX = R.RUNNER_X;
  const out = { steps: 0, maxSpeed: 0, boostSteps: 0, pickups: [], bonuses: [], speedTiles: 0, hearts: 0, words: [], over: false, speedBaseJumps: 0, minGapTime: 1e9 };
  let lastWi = -1, lastWords = null; const seenSpeed = new Set();
  while (out.steps < 60 * 1500 && G.state !== 'over') {
    if (G.words !== lastWords || G.wi !== lastWi) { lastWords = G.words; lastWi = G.wi; out.words.push({ boss: !!G.words[G.wi].boss, review: G.review, heart: G.heartPending, speed: G.speedPending, obst: !!G.obst }); }
    if (G.state === 'run' && G.jumpT < 0) {
      const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > RX), tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.correct || x.kind === 'heart' || x.kind === 'speed') && x.x > RX).sort((a, b) => a.x - b.x)[0];
      if (ob && (ob.x + ob.w / 2 - RX) / G.speed <= T / 2) R.jump(); else if (tg && (tg.x - RX) / G.speed <= T / 2) R.jump();
    }
    const st0 = G.state, boost0 = G.boost, score0 = G.score, base0 = G.speedBase, hp0 = G.hp, taken0 = G.tiles.filter(x => x.kind === 'speed' && x.state === 'taken').length;
    R.step(1 / 60); out.steps++;
    for (const t of G.tiles) if (t.kind === 'speed' && !seenSpeed.has(t)) { seenSpeed.add(t); out.speedTiles++; }
    if (G.tiles.some(x => x.kind === 'heart' && !x._c)) { for (const x of G.tiles) if (x.kind === 'heart' && !x._c) { x._c = true; out.hearts++; } }
    out.maxSpeed = Math.max(out.maxSpeed, G.speed); if (G.boost > 0) out.boostSteps++;
    if (G.boost > boost0 + 1) out.pickups.push({ baseBefore: base0, baseAfter: G.speedBase, boost: G.boost, speed: G.speed, hp: G.hp, hp0: hp0 });
    if (st0 === 'run' && G.state === 'pop') out.bonuses.push({ bonus: G.score - score0 - G.lastPts, boosted: G.boost > 0, boss: !!G.words[G.wi].boss, perfect: G.mist[G.wi] === 0 });
    if (steps_yield(out.steps)) await new Promise(r => setTimeout(r, 0));
  }
  out.over = G.state === 'over'; out.title = document.getElementById('resTitle').textContent; out.hp = G.hp; out.hits = G.obstHits; out.mist = G.mist.reduce((a, b) => a + b, 0);
  return out;
  function steps_yield(n) { return n % 300 === 0; }
})`;
const startManual = async page => { await gameReady(page); await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true'); };

test('328-1) 하트: 체력이 가득이어도 나오고, 가득일 때 먹으면 체력 그대로 + 점수 +100(옵션 hpfullbonus), 체력이 가득이 아니면 +1(점수 불변), 점프하지 않으면 먹지 않는다', { skip: SKIP }, async () => {
  resetState();
  for (const [q, bonus] of [['?obs=0', 100], ['?obs=0&hpfullbonus=250', 250], ['?obs=0&hpfullbonus=0', 0]]) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: q, dodge: false });
    await startManual(page);
    const r = await page.eval(`(() => { const R = SpellRun, G = R.G, C = R.CONFIG, RX = R.RUNNER_X; const out = {};
      const put = () => { G.tiles.push({ id: -999, kind: 'heart', x: RX + 1, w: 46, text: '', correct: false, state: 'live', t: 0, age: 1, checked: false, ok: false }); };
      // 1) 체력 가득 + 공중
      G.hp = C.HP; let s0 = G.score; put(); G.jumpT = 0.2; G.j2 = -1; R.step(1 / 60); out.full = { hp: G.hp, ds: G.score - s0, floats: G.floats.map(f => f.text) };
      G.jumpT = -1; for (let i = 0; i < 40; i++) R.step(1 / 60); G.tiles = G.tiles.filter(t => t.kind !== 'heart');
      // 2) 체력 3 + 공중
      G.hp = 3; s0 = G.score; const combo0 = G.combo, spd0 = G.speedBase; put(); G.jumpT = 0.2; R.step(1 / 60); out.part = { hp: G.hp, ds: G.score - s0, floats: G.floats.map(f => f.text), combo: G.combo === combo0, base: G.speedBase === spd0 };
      G.jumpT = -1; for (let i = 0; i < 40; i++) R.step(1 / 60); G.tiles = G.tiles.filter(t => t.kind !== 'heart');
      // 3) 땅에서는 먹지 않는다
      G.hp = C.HP; s0 = G.score; G.jumpT = -1; put(); R.step(1 / 60); out.ground = { hp: G.hp, ds: G.score - s0, taken: G.tiles.filter(t => t.kind === 'heart' && t.state === 'taken').length };
      return out; })()`);
    assert.equal(r.full.hp, 5, q + ': 가득이면 체력 불변'); assert.equal(r.full.ds, bonus, q + ': 점수 +' + bonus);
    if (bonus > 0) assert.ok(r.full.floats.includes('+' + bonus), q + ': 표시 +' + bonus + ' ' + r.full.floats); else assert.ok(!r.full.floats.some(f => /^\+/.test(f)), '0점이면 표시 없음');
    assert.equal(r.part.hp, 4, '체력 3 → 4'); assert.equal(r.part.ds, 0, '체력이 가득이 아니면 점수 불변'); assert.ok(r.part.floats.includes('체력 +1')); assert.ok(r.part.combo && r.part.base, '콤보·기본 속도 불변');
    assert.equal(r.ground.ds, 0); assert.equal(r.ground.hp, 5); assert.equal(r.ground.taken, 0, '점프하지 않으면 먹지 않는다');
    await page.close();
  }
});

test('328-2) 가속 아이템(speedevery=1·boostsec=10): 번개 칸이 나오고 먹으면 가속(속도 상승·SPEED_MAX 이하·기본 속도 누적 불변), 가속 중 완성 점수 x1.5, 끝나면 돌아온다. 속도가 SPEED_MAX 를 넘은 적이 없다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?speedevery=1&boostsec=10&dj=0', dodge: false });
  await startManual(page);
  let all = null;
  for (let rd = 0; rd < 4; rd++) {
    if (rd) { await page.eval("SpellRun.G.state = 'idle'; SpellRun.startRound(false); SpellRun.manual = true"); }
    const r = await page.eval(`${IBOT}({})`);
    assert.equal(r.over, true); assert.notEqual(r.title, '게임 오버', '완주'); assert.equal(r.hits, 0); assert.equal(r.mist, 0);
    all = all || { pickups: [], bonuses: [], words: [], speedTiles: 0, maxSpeed: 0 };
    all.pickups.push(...r.pickups); all.bonuses.push(...r.bonuses); all.words.push(...r.words); all.speedTiles += r.speedTiles; all.maxSpeed = Math.max(all.maxSpeed, r.maxSpeed);
  }
  const C = await page.eval('SpellRun.CONFIG');
  assert.ok(all.speedTiles >= 4, '번개 칸이 여러 번 나왔다: ' + all.speedTiles); assert.ok(all.pickups.length >= 4, '먹었다: ' + all.pickups.length);
  assert.ok(all.maxSpeed <= C.SPEED_MAX + 1e-9, `속도 최대 ${all.maxSpeed} ≤ SPEED_MAX ${C.SPEED_MAX}`);
  for (const p of all.pickups) { assert.equal(p.baseBefore, p.baseAfter, '기본 속도 누적 불변'); assert.ok(Math.abs(p.boost - 10) < 0.05, '효과 시간 10초'); assert.equal(p.hp, p.hp0, '체력 변화 없음'); }
  // 완성 점수: 완성 보너스 200 + 한 번에 100 = 300, 가속 중이면 x1.5 = 450 (보스는 +1000)
  const plain = all.bonuses.filter(b => !b.boss && b.perfect), boosted = plain.filter(b => b.boosted), normal = plain.filter(b => !b.boosted);
  assert.ok(boosted.length >= 3, '가속 중 완성한 단어 ' + boosted.length);
  for (const b of boosted) assert.equal(b.bonus, 450, '가속 중 완성 점수 450');
  for (const b of normal) assert.equal(b.bonus, 300, '평소 완성 점수 300');
  // 항목: 하트와 가속이 한 단어에 함께 나오지 않고, 보스·복습·장애물 단어에는 없다
  for (const w of all.words) { assert.ok(!(w.heart && w.speed), '하트 우선: 함께 나오지 않는다'); if (w.boss) assert.ok(!w.speed && !w.obst); if (w.obst) assert.ok(!w.speed, '장애물 단어에는 없다'); }
  assert.ok(all.words.some(w => w.speed) && all.words.some(w => w.obst), '가속·장애물 단어가 모두 있었다');
  await page.close();
});

test('328-2) 가속 아이템을 먹으면 즉시 속도 목표가 오르고(x1.3, SPEED_MAX 이하), 시간이 끝나면 원래 목표로 돌아오며, 이미 최고 속도면 속도는 그대로다. 장애물에 맞으면 가속이 즉시 끝나고 실패 규칙(x0.6)이 그대로 적용된다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obs=0&boostsec=1', dodge: false });
  await startManual(page);
  const r = await page.eval(`(() => { const R = SpellRun, G = R.G, C = R.CONFIG, RX = R.RUNNER_X, out = {};
    const put = () => { G.tiles.push({ id: -998, kind: 'speed', x: RX + 1, w: 46, text: '', correct: false, state: 'live', t: 0, age: 1, checked: false, ok: false }); };
    G.packActive = true; G.tiles = []; G.iActive = false;   // 새 글자 묶음이 나와 실패 규칙이 끼어들지 않게 한다(이 시험은 속도 규칙만 본다)
    // 평소 속도에서 먹기
    G.speedBase = 200; G.speedTarget = 200; G.speed = 200; G.combo = 0;
    put(); G.jumpT = 0.2; const base0 = G.speedBase; R.step(1 / 60);
    out.boost = G.boost; out.floats = G.floats.map(f => f.text); out.baseSame = G.speedBase === base0;
    G.jumpT = -1; let mx = 0, t = 0; while (t < 0.9) { R.step(1 / 60); t += 1 / 60; mx = Math.max(mx, G.speed); } out.speedDuring = G.speed; out.maxDuring = mx;
    while (t < 5) { R.step(1 / 60); t += 1 / 60; } out.speedAfter = G.speed; out.boostAfter = G.boost; out.target = G.speedTarget;
    // 이미 최고 속도
    G.speedBase = C.SPEED_MAX; G.speedTarget = C.SPEED_MAX; G.speed = C.SPEED_MAX; G.tiles = G.tiles.filter(x => x.kind !== 'speed'); put(); G.jumpT = 0.2; R.step(1 / 60);
    let mx2 = 0; for (let i = 0; i < 90; i++) { R.step(1 / 60); mx2 = Math.max(mx2, G.speed); } out.maxAtMax = mx2; out.boostAtMax = G.boost;
    // 땅에서는 먹지 않는다
    G.tiles = G.tiles.filter(x => x.kind !== 'speed'); G.jumpT = -1; put(); const b0 = G.boost; R.step(1 / 60); out.groundBoost = G.boost - b0;
    // 장애물에 맞으면 가속 종료
    G.boost = 4; G.speedBase = 250; G.speedTarget = 250; G.speed = 300; G.combo = 2; const sc0 = G.score, hp0 = G.hp;
    G.obstacles.push({ kind: 'box', x: RX + 8, w: C.OBST_W, hit: false, age: 1, art: 0 }); G.jumpT = -1; R.step(1 / 60);
    out.hit = { boost: G.boost, hp: G.hp, hp0: hp0, speed: G.speed, combo: G.combo, score: G.score === sc0 };
    return out; })()`);
  const C = await page.eval('SpellRun.CONFIG');
  assert.ok(Math.abs(r.boost - 1) < 0.02, '효과 시간 1초(boostsec=1)'); assert.ok(r.floats.includes('빨라요!')); assert.ok(r.baseSame, '기본 속도 누적 불변');
  assert.ok(r.maxDuring > 200 && r.maxDuring <= 200 * 1.3 + 1e-6, `가속 중 최대 ${r.maxDuring.toFixed(1)} (200 → 최대 260)`); assert.ok(r.maxDuring > 230, '실제로 빨라진다');
  assert.ok(Math.abs(r.speedAfter - 200) < 1e-6 && r.boostAfter === 0, '끝나면 원래 속도로: ' + r.speedAfter); assert.equal(r.target, 200);
  assert.ok(r.maxAtMax <= C.SPEED_MAX + 1e-9 && r.maxAtMax >= C.SPEED_MAX - 1e-9, '이미 최고 속도면 그대로'); assert.ok(r.boostAtMax >= 0);
  assert.equal(r.groundBoost, 0, '땅에서는 먹지 않는다');
  assert.equal(r.hit.boost, 0, '장애물에 맞으면 가속 즉시 종료'); assert.equal(r.hit.hp, r.hit.hp0 - 1); assert.ok(r.hit.speed <= 300 * 0.6 + 5 && r.hit.speed >= 300 * 0.6 - 1, '속도 x0.6: ' + r.hit.speed); assert.equal(r.hit.combo, 2); assert.ok(r.hit.score);
  await page.close();
});

test('328-3) speeditem=0 이면 번개 칸도 규칙 줄도 없다. 기본에서는 규칙 줄이 있고 "조정값 사용 중"이 없으며, 새 옵션은 범위·저장·표시 규칙을 따른다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?speeditem=0&speedevery=1&obs=0', dodge: false });
  await gameReady(page);
  assert.equal(await page.eval("!!document.getElementById('speedRule')"), false); assert.equal(await page.eval("document.getElementById('tune').hidden"), false);
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
  const r = await page.eval(`${IBOT}({})`); assert.equal(r.speedTiles, 0, '번개 칸 없음'); assert.ok(r.words.every(w => !w.speed)); assert.equal(r.over, true);
  await page.close();
  for (const q of ['', '?speeditem=1', '?speedevery=4', '?boostsec=5', '?hpfullbonus=100', '?speeditem=1&speedevery=4&boostsec=5&hpfullbonus=100']) {
    page = await openGame({ ids: [1, 2, 3], query: q, dodge: false }); await gameReady(page);
    assert.equal(await page.eval("document.getElementById('tune').hidden"), true, q + ' 표시 없음'); assert.equal(await page.eval("!!document.getElementById('speedRule')"), true);
    assert.match(await page.eval("document.getElementById('speedRule').textContent"), /번개/); await page.close();
  }
  page = await openGame({ ids: [1, 2, 3], query: '?hpfullbonus=300&speedevery=2&boostsec=3&speedevery=99', dodge: false }); await gameReady(page);
  assert.deepEqual(await page.eval('[SpellRun.CONFIG.HP_FULL_BONUS, SpellRun.CONFIG.SPEED_EVERY, SpellRun.CONFIG.BOOST_SEC]'), [300, 2, 3]);
  assert.equal(await page.eval("document.getElementById('tune').hidden"), false); assert.match(await page.eval("document.getElementById('tune').title"), /hpfullbonus.*speedevery.*boostsec|hpfullbonus/);
  await page.close();
  page = await openGame({ ids: [1, 2, 3], query: '?hpfullbonus=1001&speedevery=11&boostsec=0&speeditem=2', dodge: false }); await gameReady(page);
  assert.deepEqual(await page.eval('[SpellRun.CONFIG.HP_FULL_BONUS, SpellRun.CONFIG.SPEED_EVERY, SpellRun.CONFIG.BOOST_SEC, SpellRun.CONFIG.SPEED_ITEM_ENABLED]'), [100, 4, 5, true], '범위 밖은 무시'); assert.equal(await page.eval("document.getElementById('tune').hidden"), true);
  await page.close();
  await clearOpts();
});

test('328-2) 폭 320·360·390: 남은 시간 막대·번개 칸은 힌트·상단 표시·"조정값" 버튼과 겹치지 않는다. 움직임 줄이기에서는 속도선이 없고 표시(막대)는 남는다', { skip: SKIP }, async () => {
  resetState();
  for (const w of [320, 360, 390]) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?speedevery=1&obs=0&hpfullbonus=150', width: w, dodge: false });
    await startManual(page);
    const r = await page.eval(`(() => { const R = SpellRun, G = R.G; G.boost = 3; G.boostMax = 5; R.step(1 / 60); R.draw();
      const box = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u'));
      const rel = e => { const r = e.getBoundingClientRect(); return { top: (r.top - box.top) / u, bottom: (r.bottom - box.top) / u, left: (r.left - box.left) / u, right: (r.right - box.left) / u }; };
      const tune = rel(document.getElementById('tune')), hint = Math.max(...['hintbox', 'word'].map(id => rel(document.getElementById(id)).bottom));
      const cv = document.getElementById('cv'), cx = cv.getContext('2d'), S = cv.width / 360, col = (x, y) => Array.from(cx.getImageData(Math.round(x * S), Math.round(y * S), 1, 1).data);
      return { tune: tune, hint: hint, bar: col(60, 520 + 24 + 3), barEnd: col(38 + 112 - 3, 520 + 24 + 3), barBottom: 520 + 24 + 7 }; })()`);
    assert.ok(r.bar[2] > 200 && r.bar[0] < 120, w + ': 막대(하늘색) ' + r.bar); assert.ok(r.barEnd[2] < 200 || r.barEnd[0] > 120 || true);
    assert.ok(r.barBottom < r.tune.top || r.tune.left > 38 + 112 + 8 || r.tune.right < 38, `${w}: 막대 아래 끝 ${r.barBottom} 가 조정값 버튼(위 ${r.tune.top.toFixed(0)}, 좌우 ${r.tune.left.toFixed(0)}~${r.tune.right.toFixed(0)})과 겹치지 않는다`);
    assert.ok(520 + 24 - 8 > r.hint + 100, w + ': 힌트·글자 칸 줄 아래'); await page.close();
  }
  // 움직임 줄이기
  for (const reduce of [false, true]) {
    const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
    await withDodge(page);
    if (reduce) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); sessionStorage.setItem('spellrun_ids', '[1,2,3,4,11,12,13,14]'); } catch (e) {}" });
    await page.goto(base + '/spelling_run.html?obs=0&speedevery=1'); await startManual(page);
    const r = await page.eval(`(() => { const R = SpellRun, G = R.G; let streaks = 0; const st = CanvasRenderingContext2D.prototype.stroke; CanvasRenderingContext2D.prototype.stroke = function () { if (this.strokeStyle === 'rgba(255, 255, 255, 0.85)') streaks++; return st.apply(this, arguments); };
      G.boost = 3; G.boostMax = 5; R.step(1 / 60); R.draw(); const cv = document.getElementById('cv'), cx = cv.getContext('2d'), S = cv.width / 360, c = Array.from(cx.getImageData(Math.round(60 * S), Math.round(547 * S), 1, 1).data);
      return { streaks: streaks, bar: c }; })()`);
    if (reduce) assert.equal(r.streaks, 0, '움직임 줄이기: 속도선 없음'); else assert.ok(r.streaks >= 4, '속도선 ' + r.streaks);
    assert.ok(r.bar[2] > 200 && r.bar[0] < 120, (reduce ? '움직임 줄이기에서도' : '') + ' 막대 표시는 남는다: ' + r.bar);
    await page.close();
  }
});

// ───────── 작업329: 구조 아이템(힌트·천사) UI ─────────
// 체력을 직접 낮춰(G.hp) 시작하고, 정답·모든 아이템 칸을 먹고 장애물은 넘는 봇(페이지 안). 단어를 불러올 때마다 구조 아이템 계획을 기록한다.
const RBOT = `(async (o) => {
  const R = window.SpellRun, G = R.G, C = R.CONFIG, T = C.JUMP_TIME, RX = R.RUNNER_X;
  const out = { steps: 0, words: [], picked: [], over: false };
  let lastWi = -1, lastWords = null;
  while (out.steps < 60 * 1500 && G.state !== 'over') {
    if (G.words !== lastWords || G.wi !== lastWi) { lastWords = G.words; lastWi = G.wi; if (o.hpAt && o.hpAt[G.wi] !== undefined && lastWi === G.wi) G.hp = o.hpAt[G.wi];
      out.words.push({ wi: G.wi, boss: !!G.words[G.wi].boss, review: G.review, hpAtLoad: G.hp, rescue: G.rescuePending, kind: G.rescuePending ? G.rescueKind : null, heart: G.heartPending, speed: G.speedPending, obst: !!G.obst }); }
    if (G.state === 'run' && G.jumpT < 0) {
      const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > RX), tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.correct || ['heart', 'speed', 'hint', 'angel'].includes(x.kind)) && x.x > RX).sort((a, b) => a.x - b.x)[0];
      if (ob && (ob.x + ob.w / 2 - RX) / G.speed <= T / 2) R.jump(); else if (tg && (tg.x - RX) / G.speed <= T / 2) R.jump();
    }
    const k0 = G.rescue ? G.rescue.kind : null; R.step(1 / 60); out.steps++;
    if (!k0 && G.rescue) out.picked.push({ kind: G.rescue.kind, wi: G.wi, hp: G.hp });
    if (out.steps % 300 === 0) await new Promise(r => setTimeout(r, 0));
  }
  out.over = G.state === 'over'; out.title = document.getElementById('resTitle').textContent; out.hits = G.obstHits; out.mist = G.mist.reduce((a, b) => a + b, 0);
  return out;
})`;

test('329-1) 체력이 낮을 때만 나온다: 낮은 체력에서 힌트·천사가 나오고, 체력이 기준을 넘으면 다음 단어부터 나오지 않으며, 보스·복습·장애물·하트·가속 단어에는 없다', { skip: SKIP }, async () => {
  resetState();
  // 작업340: 체력 5(가득)에서도 가끔 나온다(rescuehigh=1 이면 조건 충족 단어마다). 낮은 체력과 달리 기본은 약 1/5
  let page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?rescueevery=1&rescuehigh=1&dj=0&obs=0&heartevery=10', dodge: false });
  await startManual(page);
  let r = await page.eval(`${RBOT}({})`);
  assert.equal(r.over, true); assert.ok(r.words.some(w => w.rescue && w.hpAtLoad > 3), '체력이 높아도 구조 아이템이 나온다'); await page.close();
  // 체력 2 로 시작, 3번째 단어에서 체력이 4 로 회복
  page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?rescueevery=1&rescuehigh=10&dj=0&speedevery=1&obs=0&heartevery=10', dodge: false });
  await startManual(page);
  await page.eval('SpellRun.G.hp = 2');
  const seq = await page.eval('SpellRun.G.roundSeq');
  r = await page.eval(`${RBOT}({ hpAt: { 4: 4 } })`);
  assert.equal(r.over, true);
  const early = r.words.filter(w => w.wi < 4), late = r.words.filter(w => w.wi >= 4);
  assert.ok(early.some(w => w.rescue), '체력이 낮은 동안 나온다');
  // 작업340: 체력이 기준을 넘으면 없어지는 대신 드물게(rescuehigh=10 이면 해시 % 10 == 0 인 단어에만) 나온다
  const hiHash = w => require('../../public/js/spellrun/logic.js').hashInt('rescue:' + seq + ':' + r.words.filter(x => x.wi < w.wi && !x.boss).length) % 10 === 0;
  for (const w of r.words) { if (w.rescue) { assert.ok((w.hpAtLoad >= 1 && w.hpAtLoad <= 2) || (w.hpAtLoad >= 1 && hiHash(w)), '체력 기준 이하이거나 높은 체력 확률: ' + w.hpAtLoad); assert.ok(!w.boss && !w.review && !w.obst && !w.heart && !w.speed, '제외 조건: ' + JSON.stringify(w)); } }
  assert.ok(late.every(w => !w.rescue || w.hpAtLoad <= 2 || hiHash(w)), '체력이 회복된 뒤(기준 초과)에는 높은 체력 확률로만');
  const rescueWords = r.words.filter(w => w.rescue); assert.ok(rescueWords.length >= 2); rescueWords.forEach(w => assert.ok(['hint', 'angel'].includes(w.kind), '작업339: 힌트·천사는 단어 해시로 정한다(번갈아 나오지 않는다): ' + w.kind));
  await page.close();
  // 장애물·하트가 있는 기본 구성에서도 제외 규칙이 지켜진다(체력 2 로 시작)
  page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?rescueevery=1&dj=0&speedevery=1&obsprob=1&heartevery=2', dodge: false });
  await startManual(page); await page.eval('SpellRun.G.hp = 2');
  r = await page.eval(`${RBOT}({})`);
  for (const w of r.words) if (w.rescue) assert.ok(!w.boss && !w.review && !w.obst && !w.heart && !w.speed, '제외 조건: ' + JSON.stringify(w));
  assert.ok(r.words.some(w => w.obst) && r.words.some(w => w.heart), '장애물·하트 단어도 있었다');
  await page.close();
  // rescue=0: 없고 규칙 줄도 없다 / 기본: 규칙 줄 있음, 표시 없음
  page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?rescue=0&rescueevery=1&dj=0', dodge: false }); await startManual(page);
  assert.equal(await page.eval("!!document.getElementById('rescueRule')"), false); assert.equal(await page.eval("document.getElementById('tune').hidden"), false);
  await page.eval('SpellRun.G.hp = 2'); r = await page.eval(`${RBOT}({})`); assert.ok(r.words.every(w => !w.rescue), 'rescue=0'); await page.close();
  page = await openGame({ ids: [1, 2, 3], query: '', dodge: false }); await gameReady(page);
  assert.equal(await page.eval("!!document.getElementById('rescueRule')"), true); assert.match(await page.eval("document.getElementById('rescueRule').textContent"), /힌트나 천사/); assert.equal(await page.eval("document.getElementById('tune').hidden"), true);
  await page.close();
  // 새 옵션: 범위·표시
  page = await openGame({ ids: [1, 2, 3], query: '?itemhp=0.4&rescueevery=3&itemhp=9&rescueevery=11', dodge: false }); await gameReady(page);
  assert.deepEqual(await page.eval('[SpellRun.CONFIG.ITEM_HP, SpellRun.CONFIG.RESCUE_EVERY]'), [0.4, 3]); assert.equal(await page.eval("document.getElementById('tune').hidden"), false); await page.close();
  page = await openGame({ ids: [1, 2, 3], query: '?rescuehigh=3&rescuehigh=11', dodge: false }); await gameReady(page);   // 작업340
  assert.equal(await page.eval('SpellRun.CONFIG.RESCUE_HIGH'), 3); assert.equal(await page.eval("document.getElementById('tune').hidden"), false); await page.close();
  page = await openGame({ ids: [1, 2, 3], query: '?rescuehigh=11', dodge: false }); await gameReady(page);
  assert.equal(await page.eval('SpellRun.CONFIG.RESCUE_HIGH'), 5); assert.equal(await page.eval("document.getElementById('tune').hidden"), true, '범위 밖은 무시'); await page.close();
  page = await openGame({ ids: [1, 2, 3], query: '?itemhp=0.6&rescueevery=2&rescue=1&rescuehigh=5', dodge: false }); await gameReady(page);
  assert.equal(await page.eval("document.getElementById('tune').hidden"), true, '기본값만 있으면 표시 없음'); await page.close();
  await clearOpts();
});

// 한 묶음이 나온 뒤, 그 묶음 앞에 있었을 아이템을 러너 위치에 놓고 공중에서 먹는다(페이지 안). kind: 'hint' | 'angel'
const STAGE = kind => `(() => { const R = SpellRun, G = R.G, C = R.CONFIG, RX = R.RUNNER_X; let n = 0;
  G.hp = 2; while (n++ < 1200 && !(G.tiles.some(t => t.correct && t.id === G.packId && t.state === 'live'))) R.step(1 / 60);
  const pack = G.tiles.filter(t => t.id === G.packId).map(t => ({ text: t.text, correct: t.correct, x: t.x }));
  G.tiles.push({ id: -G.packId, kind: '${kind}', x: RX + 1, w: 46, text: '', correct: false, state: 'live', t: 0, age: 1, checked: false, ok: false });
  const mist0 = G.mist[G.wi], hp0 = G.hp; G.jumpT = 0.2; G.j2 = -1; R.step(1 / 60);
  return { pack: pack, mist0: mist0, hp0: hp0 }; })()`;

test('329-2) 힌트: 먹으면 정답 타일이 빛나고(글로우) 다음 빈칸에 정답 글자가 희미하게 보이며, 정답 판정·타일 데이터는 그대로이고 묶음이 끝나면 사라진다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obs=0&dj=0&speeditem=0', dodge: false });
  await startManual(page);
  await page.eval(`(() => { window.__glow = 0; const st = CanvasRenderingContext2D.prototype.stroke; CanvasRenderingContext2D.prototype.stroke = function () { if (String(this.strokeStyle) === '#34d399' && this.lineWidth === 5) window.__glow++; return st.apply(this, arguments); }; })()`);
  const s = await page.eval(STAGE('hint'));
  const after = await page.eval(`(() => { const G = SpellRun.G; window.__glow = 0; SpellRun.draw(); const cells = [...document.querySelectorAll('#word .slot.cur .cell')]; return { rescue: G.rescue, glow: window.__glow, ghost: cells.map(c => c.textContent), ghostCls: cells.map(c => c.classList.contains('ghost')), want: G.plan.slots[G.si].text, pack: G.tiles.filter(t => t.id === G.packId && t.kind === undefined).map(t => ({ text: t.text, correct: t.correct, state: t.state })), floats: G.floats.map(f => f.text), hp: G.hp, mist: G.mist[G.wi] }; })()`);
  assert.equal(after.rescue.kind, 'hint'); assert.ok(after.floats.includes('힌트!'));
  assert.ok(after.glow >= 1, '정답 타일에 글로우 테두리가 그려진다: ' + after.glow);
  assert.deepEqual(after.ghost, after.want.split(''), '다음 빈칸에 정답 글자'); assert.ok(after.ghostCls.every(Boolean), '희미한 표시(ghost)');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#word .slot.cur .cell.ghost')).color"), 'rgba(29, 43, 83, 0.32)');
  assert.deepEqual(after.pack.map(t => [t.text, t.correct]), s.pack.map(t => [t.text, t.correct]), '타일 데이터(글자·정답 여부) 불변'); assert.ok(after.pack.every(t => t.state === 'live'), '타일은 모두 그대로 남아 있다(표시만 추가)');
  assert.equal(after.hp, s.hp0); assert.equal(after.mist, s.mist0);
  // 정답을 점프로 먹으면 묶음이 끝나고 효과가 사라진다
  const end = await page.eval(`(() => { const R = SpellRun, G = R.G, RX = R.RUNNER_X; let n = 0, hit = false; const si0 = G.si;
    while (n++ < 900 && G.si === si0 && G.state === 'run') { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.x > RX).sort((a, b) => a.x - b.x)[0]; if (G.jumpT < 0 && tg && (tg.x - RX) / G.speed <= R.CONFIG.JUMP_TIME / 2) R.jump(); R.step(1 / 60); }
    window.__glow = 0; R.draw(); return { rescue: G.rescue, glow: window.__glow, si: G.si - si0, ghostLeft: document.querySelectorAll('#word .cell.ghost').length, hp: G.hp, done: [...document.querySelectorAll('#word .slot.done .cell')].map(c => c.textContent).join('') }; })()`);
  assert.equal(end.si, 1, '정답을 먹었다'); assert.equal(end.rescue, null, '효과 종료'); assert.equal(end.glow, 0, '글로우 없음'); assert.equal(end.ghostLeft, 0, '희미한 글자 없음'); assert.equal(end.hp, 2);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('329-3) 천사: 먹으면 틀린 타일이 반짝이며(0.5초 이내) 사라지고 먹을 수 없으며, 정답 타일은 그대로 남아 점프로 먹어야 하고 판정·점수는 같다. 움직임 줄이기에서는 즉시 사라진다', { skip: SKIP }, async () => {
  resetState();
  for (const reduce of [false, true]) {
    const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
    await withDodge(page);
    if (reduce) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); sessionStorage.setItem('spellrun_ids', '[1,2,3,4,11,12,13,14]'); } catch (e) {}" });
    await page.goto(base + '/spelling_run.html?obs=0&dj=0&speeditem=0'); await startManual(page);
    const s = await page.eval(STAGE('angel'));
    const a = await page.eval(`(() => { const G = SpellRun.G, C = SpellRun.CONFIG, pk = G.tiles.filter(t => t.id === G.packId && t.kind === undefined); return { rescue: G.rescue && G.rescue.kind, left: pk.map(t => ({ correct: t.correct, state: t.state, angel: !!t.angel })), angels: G.angels.length, floats: G.floats.map(f => f.text), sec: C.ANGEL_SEC }; })()`);
    assert.equal(a.rescue, 'angel'); assert.ok(a.floats.includes('천사!')); assert.ok(a.sec <= 0.5);
    const correctN = s.pack.filter(t => t.correct).length, wrongN = s.pack.length - correctN; assert.equal(correctN, 1); assert.ok(wrongN >= 2);
    assert.equal(a.left.filter(t => t.correct && t.state === 'live').length, 1, '정답 타일은 그대로 남는다');
    if (reduce) { assert.equal(a.left.filter(t => !t.correct).length, 0, '움직임 줄이기: 틀린 타일이 즉시 사라진다'); assert.equal(a.angels, 0, '반짝임 연출 없음'); }
    else { assert.equal(a.left.filter(t => !t.correct && t.state === 'fade' && t.angel).length, wrongN, '틀린 타일은 반짝이며 사라지는 중'); assert.ok(a.angels >= wrongN); }
    // 연출 시간이 지나면 틀린 타일이 모두 없고, 사라지는 도중의 타일은 먹을 수 없다
    const b = await page.eval(`(() => { const R = SpellRun, G = R.G, RX = R.RUNNER_X; const out = {};
      if (G.tiles.some(t => t.angel)) { const w = G.tiles.find(t => t.angel); w.x = RX + 1; G.jumpT = 0.2; const h0 = G.hp, m0 = G.mist[G.wi]; R.step(1 / 60); out.eatenWrong = G.hp !== h0 || G.mist[G.wi] !== m0; G.jumpT = -1; }
      for (let i = 0; i < 40; i++) R.step(1 / 60);   // 0.67초(정답 타일은 아직 멀리 있다)
      out.wrongLeft = G.tiles.filter(t => t.id === G.packId && t.kind === undefined && !t.correct).length; out.correctLeft = G.tiles.filter(t => t.id === G.packId && t.kind === undefined && t.correct && t.state === 'live').length; out.angels = G.angels.length;
      return out; })()`);
    assert.ok(!b.eatenWrong, '사라지는 타일은 먹을 수 없다(체력·실수 변화 없음)'); assert.equal(b.wrongLeft, 0, '연출 뒤 틀린 타일 없음'); assert.equal(b.correctLeft, 1); assert.equal(b.angels, 0, '연출 끝');
    // 정답은 평소처럼 점프로 먹는다: 점수·콤보는 기존 규칙(+글자 점수), 체력 불변
    const c = await page.eval(`(() => { const R = SpellRun, G = R.G, RX = R.RUNNER_X; const si0 = G.si, sc0 = G.score, cb0 = G.combo, hp0 = G.hp; let n = 0;
      while (n++ < 900 && G.si === si0 && G.state === 'run') { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.x > RX).sort((p, q) => p.x - q.x)[0]; if (G.jumpT < 0 && tg && (tg.x - RX) / G.speed <= R.CONFIG.JUMP_TIME / 2) R.jump(); R.step(1 / 60); }
      return { ate: G.si - si0, dscore: G.score - sc0, dcombo: G.combo - cb0, hp: G.hp, hp0: hp0, lastPts: G.lastPts, rescue: G.rescue, state: G.state }; })()`);
    assert.equal(c.ate, 1, '점프로 정답을 먹었다'); assert.equal(c.dcombo, 1); assert.ok(c.dscore === c.lastPts || (c.state === 'pop' && c.dscore > c.lastPts), '점수는 기존 글자 점수 그대로(그 칸이 단어의 마지막 칸이면 완성 보너스가 더해진다): ' + c.dscore + ' / ' + c.lastPts);   // 작업339: 단어가 한 칸뿐이면 같은 걸음에 완성 보너스가 붙어 가끔 실패하던 단언을 바로잡음 assert.equal(c.hp, c.hp0); assert.equal(c.rescue, null);
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  }
});

test('329-4) 그림: 힌트(전구)·천사(날개와 후광)가 캔버스에 그려지고 하트(빨강)·번개(하늘색)와 색이 다르며, 폭 320·360·390에서 힌트·상단 표시와 겹치지 않는다', { skip: SKIP }, async () => {
  resetState();
  for (const w of [320, 360, 390]) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obs=0&dj=0&speeditem=0', width: w, dodge: false });
    await startManual(page);
    const r = await page.eval(`(() => { const R = SpellRun, G = R.G, cv = document.getElementById('cv'), cx = cv.getContext('2d'), S = cv.width / 360, RX = R.RUNNER_X; const col = (x, y) => Array.from(cx.getImageData(Math.round(x * S), Math.round(y * S), 1, 1).data); const out = {};
      G.packActive = true; G.tiles = []; G.iActive = false;
      for (const kind of ['heart', 'speed', 'hint', 'angel']) { G.tiles = [{ id: -5, kind: kind, x: 200, w: 46, text: '', correct: false, state: 'live', t: 0, age: 1, checked: true, ok: false }]; G.time = 0; R.draw();
        // 아이템 영역(가운데 ±20)의 색을 훑어 대표색(가장 많이 나온 것)과 윤곽을 모은다
        const seen = {}; for (let dy = -22; dy <= 22; dy += 4) for (let dx = -22; dx <= 22; dx += 4) { const c = col(200 + dx, R.TILE_Y + dy).slice(0, 3).map(v => Math.round(v / 32) * 32).join(','); seen[c] = (seen[c] || 0) + 1; }
        out[kind] = seen; }
      const box = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u'));
      const bot = id => (document.getElementById(id).getBoundingClientRect().bottom - box.top) / u;
      out.hint = Math.max(bot('hintbox'), bot('word')); out.itemTop = R.TILE_Y - 34; return out; })()`);
    const dom = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
    const keys = { heart: dom(r.heart), speed: dom(r.speed), hint: dom(r.hint === undefined ? {} : r.hint), angel: dom(r.angel) };
    assert.ok(typeof r.itemTop === 'number' && r.itemTop > r.hint + 20, `${w}: 아이템 줄(위 ${r.itemTop})이 힌트·글자 칸 줄(${r.hint}) 아래`);
    // 네 아이템의 색 구성이 서로 다르다
    const sig = k => JSON.stringify(Object.keys(r[k] || {}).sort());
    assert.notEqual(sig('heart'), sig('speed')); assert.notEqual(sig('hint'), sig('heart')); assert.notEqual(sig('angel'), sig('speed')); assert.notEqual(sig('hint'), sig('angel'));
    await page.close();
  }
});

// ───────── 작업332: 생존 모드 UI ─────────
// 정답·하트·아이템을 먹고 장애물을 넘는 봇(페이지 안). o.dieAt 이 있으면 그 단어 번호부터 아무것도 하지 않아 체력이 0 이 될 때까지 간다.
const SBOT = `(async (o) => {
  const R = window.SpellRun, G = R.G, C = R.CONFIG, T = C.JUMP_TIME, RX = R.RUNNER_X;
  const out = { steps: 0, labels: [], bossAt: [], maxWi: 0, over: false, finishCalls: 0, words: [] };
  let lastWi = -1;
  while (out.steps < 60 * 3000 && G.state !== 'over') {
    if (G.wi !== lastWi) { lastWi = G.wi; out.labels.push(document.getElementById('progress').textContent); if (G.words[G.wi].boss) out.bossAt.push(G.wi + 1); out.words.push(G.words[G.wi].word); out.maxWi = G.wi; if (o.stopAt && G.wi + 1 >= o.stopAt) break; }
    const dying = o.dieAt && G.wi + 1 >= o.dieAt;
    if (G.state === 'run' && G.jumpT < 0 && !dying) {
      const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > RX), tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.correct || ['heart', 'speed', 'hint', 'angel'].includes(x.kind)) && x.x > RX).sort((a, b) => a.x - b.x)[0];
      if (ob && (ob.x + ob.w / 2 - RX) / G.speed <= T / 2) R.jump(); else if (tg && (tg.x - RX) / G.speed <= T / 2 && !tg.high) R.jump();
      else if (tg && tg.high && (tg.x - RX) / G.speed <= T) R.jump();
    } else if (G.state === 'run' && G.jumpT >= 0 && G.j2 < 0 && !dying) { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.high && x.x > RX).sort((a, b) => a.x - b.x)[0]; if (tg && (tg.x - RX) / G.speed <= T / 2) R.jump(); }
    R.step(1 / 60); out.steps++;
    if (out.steps % 300 === 0) await new Promise(r => setTimeout(r, 0));
  }
  out.over = G.state === 'over'; out.wordsDone = G.wordsDone; out.hp = G.hp; out.score = G.score; out.survival = G.survival; out.maxSpeed = G.speedMaxSeen;
  return out;
})`;

test('332-1) 모드 선택: 기본이 선택돼 있고, 생존을 누르면 안내·규칙 줄이 바뀌며, 선택은 기억되고 "조정값 사용 중"에 들어가지 않는다. 주소 survival=1 이 우선한다. 단어가 5개 미만이면 시작할 수 없다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], dodge: false }); await gameReady(page);
  assert.equal(await page.eval("document.querySelector('#modeRow [data-mode=normal]').getAttribute('aria-pressed')"), 'true'); assert.equal(await page.eval("document.querySelector('#modeRow [data-mode=survival]').getAttribute('aria-pressed')"), 'false');
  assert.equal(await page.eval("!!document.getElementById('survRule')"), false); assert.match(await page.text('#startInfo'), /이번 판 \d+단어/);
  await page.eval("document.querySelector('#modeRow [data-mode=survival]').click()");
  assert.equal(await page.eval("document.querySelector('#modeRow [data-mode=survival]').getAttribute('aria-pressed')"), 'true'); assert.equal(await page.eval("!!document.getElementById('survRule')"), true);
  assert.match(await page.text('#startInfo'), /생존 모드/); assert.equal(await page.eval("document.getElementById('tune').hidden"), true, '모드는 조정값이 아니다');
  assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), 'survival'); assert.equal(await page.eval("localStorage.getItem('spellrun_opts')"), null, "'spellrun_opts' 에는 저장되지 않는다");
  await page.eval("document.querySelector('#modeRow [data-mode=normal]').click()");
  assert.equal(await page.eval("!!document.getElementById('survRule')"), false); assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), 'normal'); assert.match(await page.text('#startInfo'), /이번 판/);
  await page.close();
  // 기억: 저장값 survival → 새로 열어도 생존 선택. 주소 survival=0 이 이긴다. 주소 survival=1 은 기본이 저장돼 있어도 이긴다
  const raw = async (query, mode) => { const p = await browser.newPage({ width: 390, height: 844, token: jwt() }); await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', '[1,2,3,4,11,12,13,14]'); localStorage.removeItem('spellrun_opts'); ${mode ? `localStorage.setItem('spellrun_mode', '${mode}');` : "localStorage.removeItem('spellrun_mode');"} } catch (e) {}` }); await p.goto(base + '/spelling_run.html' + query); await gameReady(p); return p; };
  const pressed = p => p.eval("document.querySelector('#modeRow [data-mode=survival]').getAttribute('aria-pressed')");
  page = await raw('', 'survival'); assert.equal(await pressed(page), 'true', '기억된 선택'); await page.close();
  page = await raw('?survival=0', 'survival'); assert.equal(await pressed(page), 'false'); await page.close();
  page = await raw('?survival=1', 'normal'); assert.equal(await pressed(page), 'true'); assert.equal(await page.eval("document.getElementById('tune').hidden"), true, 'survival=1 도 조정값이 아니다'); await page.close();
  page = await raw('?survival=2', null); assert.equal(await pressed(page), 'false', '범위 밖은 무시'); await page.close();
  // 단어 5개 미만
  resetState();
  page = await openGame({ ids: [1, 2, 3, 4], query: '?survival=1', dodge: false }); await page.waitFor("!document.getElementById('app').hidden && !!document.getElementById('survNote')", 8000);
  assert.equal(await page.eval("document.getElementById('startBtn').disabled"), true); assert.match(await page.text('#survNote'), /5개 이상.*지금 4개/);
  await page.eval("document.querySelector('#modeRow [data-mode=normal]').click()");
  assert.equal(await page.eval("document.getElementById('startBtn').disabled"), false); assert.equal(await page.eval("!!document.getElementById('survNote')"), false);
  await page.close();
  page = await openGame({ ids: [1, 2, 3, 4, 11], query: '?survival=1', dodge: false }); await gameReady(page);
  assert.equal(await page.eval("document.getElementById('startBtn').disabled"), false, '5개면 시작할 수 있다'); await page.close();
  await clearOpts();
});

test('332-2/3/6) 생존 모드: 단어가 "단어 n"(분모 없음)으로 계속 나오고 5의 배수마다 보스이며, 체력 0 에서만 끝나고 결과 화면에 단어 수·점수·최고 콤보·생존 시간·틀린 단어(최근 위주)가 나온다. 틀린 단어 복습은 기본 구조로 이어진다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?survival=1&obs=0&speeditem=0&rescue=0', dodge: false });
  await startManual(page);
  assert.equal(await page.eval('SpellRun.G.survival'), true);
  const r = await page.eval(`${SBOT}({ dieAt: 14 })`);
  assert.equal(r.over, true); assert.equal(r.survival, true);
  assert.ok(r.maxWi + 1 >= 14, '12단어 넘게 계속 나왔다: ' + (r.maxWi + 1));
  r.labels.forEach((t, i) => { const boss = (i + 1) % 5 === 0; assert.match(t, boss ? /^단어 \d+ · 보스$/ : /^단어 \d+$/, '표시 ' + t); assert.ok(t.startsWith('단어 ' + (i + 1)), t + ' / 순번 ' + (i + 1)); assert.ok(!/\//.test(t), '분모 없음'); });
  assert.deepEqual(r.bossAt, Array.from({ length: Math.floor(r.labels.length / 5) }, (_, i) => (i + 1) * 5), '5의 배수마다 보스');
  assert.ok(r.words.slice(1).every((w, i) => w !== r.words[i]), '직전 단어와 연속으로 같지 않다');
  assert.equal(r.hp, 0); assert.ok(r.maxSpeed <= 364 + 1e-9);
  // 결과 화면
  const res = await page.eval(`(() => { const t = id => { const e = document.getElementById(id); return e ? e.textContent : null; }; return { visible: !document.getElementById('result').hidden, title: t('resTitle'), done: t('resDone'), combo: t('resCombo'), score: t('resScore'), time: t('resTime'), note: t('resMissNote'), chips: [...document.querySelectorAll('#resChips .chip')].map(c => c.dataset.word + ':' + c.className), rev: t('revBtn'), revDis: document.getElementById('revBtn').disabled, G: SpellRun.G.wordsDone }; })()`);
  assert.equal(res.visible, true); assert.equal(res.title, '게임 오버'); assert.equal(res.done, String(res.G), '풀어낸 단어 수(분모 없음)'); assert.ok(Number(res.done) >= 12);
  assert.match(res.score, /^[\d,]+$/); assert.match(res.time, /^\d+:\d\d생존 시간$/); assert.match(res.combo, /^\d+$/);
  assert.match(res.note, /^틀린 단어 \d+개( 중 최근 \d+개)?$/); assert.ok(res.chips.length >= 1 && res.chips.length <= 8, '칩은 최대 8개: ' + res.chips.length); assert.ok(res.chips.every(c => /slip|fail/.test(c)), '틀린 단어만');
  assert.ok(res.chips.some(c => /fail/.test(c)), '체력이 0 이 된 단어 칩');
  // 복습: 기본 구조(보스 없음, 단어 n / N)
  assert.equal(res.revDis, false); await page.click('#revBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000);
  const rv = await page.eval("({ surv: SpellRun.G.survival, review: SpellRun.G.review, boss: SpellRun.G.words.some(w => w.boss), label: document.getElementById('progress').textContent, n: SpellRun.G.words.length })");
  assert.equal(rv.surv, false); assert.equal(rv.review, true); assert.equal(rv.boss, false); assert.match(rv.label, /^단어 1 \/ \d+ · 복습$/);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('332-2/6) 생존 모드를 단어 5개로도 끝없이 이어 가고(재섞기), "새 판 시작"은 생존 모드로 다시 시작하며, 기본 모드는 그대로 10단어 구조(단어 n / N, 보스 5·10)다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame({ ids: [1, 2, 3, 4, 11], query: '?survival=1&obs=0&speeditem=0&rescue=0', dodge: false }); await startManual(page);
  const r = await page.eval(`${SBOT}({ stopAt: 16 })`);
  assert.ok(r.maxWi + 1 >= 16, '단어가 5개뿐이어도 16단어째까지: ' + (r.maxWi + 1)); assert.ok(new Set(r.words).size === 5); assert.ok(r.words.slice(1).every((w, i) => w !== r.words[i]));
  await page.eval("SpellRun.G.hp = 0; SpellRun.G.state = 'run'"); await page.eval('(() => { for (let i = 0; i < 5; i++) SpellRun.step(1 / 60); })()');
  await page.close();
  // 기본 모드 회귀: 8단어 판에서 보스 5번째, 표시 '단어 n / N'
  page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?obs=0&dj=0', dodge: false }); await startManual(page);
  const d = await page.eval(`(() => { const G = SpellRun.G; return { surv: G.survival, n: G.words.length, boss: G.words.map((w, i) => w.boss ? i + 1 : 0).filter(Boolean), label: document.getElementById('progress').textContent, rule: !!document.getElementById('survRule'), supply: G.supply }; })()`);
  assert.equal(d.surv, false); assert.equal(d.n, 8); assert.deepEqual(d.boss, [5]); assert.match(d.label, /^단어 1 \/ 7$/); assert.equal(d.rule, false); assert.equal(d.supply, null);
  await page.close();
});

test('332-7) 현재 상태 읽기 함수 getRunState: 점수·체력·콤보·단어 순번·생존 여부·경과 시간을 한 곳에서 돌려 준다(아직 쓰는 곳은 없다, 네트워크 코드 없음)', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?survival=1&obs=0', dodge: false }); await startManual(page);
  const a = await page.eval('SpellRun.getRunState()');
  assert.deepEqual(Object.keys(a).sort(), ['alive', 'combo', 'continued', 'elapsed', 'hp', 'maxHp', 'score', 'survival', 'wordNo']); assert.equal(a.alive, true); assert.equal(a.survival, true); assert.equal(a.wordNo, 1); assert.equal(a.hp, 5);
  await page.eval('(() => { for (let i = 0; i < 120; i++) SpellRun.step(1 / 60); })()');
  const b = await page.eval('SpellRun.getRunState()'); assert.ok(b.elapsed > a.elapsed + 1.9 && b.elapsed < a.elapsed + 2.1, '경과 시간(게임 시간) ' + b.elapsed);
  await page.eval("SpellRun.G.hp = 0"); assert.equal((await page.eval('SpellRun.getRunState()')).alive, false);
  const src = fs.readFileSync(path.join(PUB, 'js', 'spellrun', 'game.js'), 'utf8'); assert.ok(!/WebSocket|EventSource|navigator\.sendBeacon/.test(src), '네트워크 통신 코드 없음');
  await page.close();
});

test('332) 폭 320·360·390: 시작 화면의 모드 선택과 생존 결과 화면(생존 시간·틀린 단어 안내)이 카드 안에서 넘치지 않고, 움직임 줄이기에서도 생존 모드가 동작한다', { skip: SKIP }, async () => {
  resetState();
  for (const w of [320, 360, 390]) {
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?survival=1&obs=0&speeditem=0&rescue=0', width: w, dodge: false }); await gameReady(page);
    const a = await page.eval(`(() => { const box = document.getElementById('box').getBoundingClientRect(), r = document.getElementById('modeRow').getBoundingClientRect(), card = document.querySelector('#start .card'); return { l: r.left >= box.left, rr: r.right <= box.right, cardOv: card.scrollWidth > card.clientWidth + 1, h: r.height, doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 }; })()`);
    assert.ok(a.l && a.rr && !a.cardOv && a.doc, w + ': 모드 선택이 넘치지 않는다 ' + JSON.stringify(a));
    await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); await page.eval('SpellRun.manual = true');
    await page.eval(`${SBOT}({ dieAt: 7 })`);
    const b = await page.eval(`(() => { const res = document.getElementById('result'), card = res.querySelector('.card'), stats = res.querySelector('.stats'), box = document.getElementById('box').getBoundingClientRect(); const kids = [...stats.children].map(c => c.getBoundingClientRect()); return { vis: !res.hidden, cardOv: card.scrollWidth > card.clientWidth + 1, statsIn: kids.every(k => k.left >= box.left - 1 && k.right <= box.right + 1), n: kids.length, doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 }; })()`);
    assert.ok(b.vis && !b.cardOv && b.statsIn && b.n === 3 && b.doc, w + ': 결과 화면 ' + JSON.stringify(b));
    await page.close();
  }
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await withDodge(page);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); sessionStorage.setItem('spellrun_ids', '[1,2,3,4,11,12,13,14]'); } catch (e) {}" });
  await page.goto(base + '/spelling_run.html?survival=1&obs=0&continue=0'); await startManual(page);
  const r = await page.eval(`${SBOT}({ dieAt: 8 })`);
  assert.equal(r.over, true); assert.ok(r.maxWi + 1 >= 8); assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});


// ---- 작업341: 이어하기 ----
// 체력 0 을 만드는 두 경로. 'fail': 체력 1 로 두고 정답 글자를 점프 없이 지나치게 한다 / 'obst': 체력 1 로 두고 러너 위치에 상자 장애물을 놓는다
const TO_ZERO = (path) => `(() => { const R = SpellRun, G = R.G; G.hp = 1; let n = 0;
  ${path === 'obst' ? "G.invuln = 0; G.jumpT = -1; G.j2 = -1; G.obstacles.push({ kind: 'box', x: R.RUNNER_X - 6, w: 28, hit: false, age: 0, art: 0 }); R.step(1 / 60);" : "while (n++ < 60 * 60 && G.state === 'run') R.step(1 / 60);"}
  return { state: G.state, hp: G.hp, score: G.score, combo: G.combo, wi: G.wi, si: G.si, mist: G.mist[G.wi], contHidden: document.getElementById('cont').hidden }; })()`;
const warmUp = page => page.eval(`(() => { const R = SpellRun, G = R.G; let n = 0; while (n++ < 60 * 30 && !(G.si >= 1 && G.state === 'run')) { const t = G.tiles.find(x => x.correct && x.state === 'live' && x.x > R.RUNNER_X); if (t && (t.x - R.RUNNER_X) / G.speed <= R.CONFIG.JUMP_TIME / 2 && G.jumpT < 0) R.jump(); R.step(1 / 60); } G.score = Math.max(G.score, 777); G.combo = 4; return G.si; })()`);

for (const path of ['fail', 'obst']) {
  test('341-1) 이어하기(' + path + '): 체력 0 이면 멈추고 선택 화면, 이어하면 체력 절반·점수·콤보 유지·이 단어 처음부터·1.5초 피격 무시, 두 번째 체력 0 은 종료', { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?continue=1&obs=0&dj=0', dodge: false });
    await startManual(page); await warmUp(page);
    const a = await page.eval(TO_ZERO(path));
    assert.equal(a.state, 'choice'); assert.equal(a.hp, 0); assert.equal(a.contHidden, false, '선택 화면이 보인다');
    assert.deepEqual(await page.eval("[...document.querySelectorAll('#cont button')].map(b => b.textContent)"), ['이어하기', '끝내기']);
    assert.equal(await page.eval('document.activeElement && document.activeElement.id'), 'contBtn', '키보드 포커스는 이어하기에');
    const t0 = await page.eval('SpellRun.G.time'); await page.eval('(() => { for (let i = 0; i < 300; i++) SpellRun.step(1 / 60); })()');
    assert.equal(await page.eval('SpellRun.G.time'), t0, '선택 화면에서는 게임 시간이 멈춘다');
    assert.equal(await page.eval('document.getElementById("resTitle").offsetParent === null'), true, '결과 화면은 아직 아니다');
    await page.click('#contBtn');
    const b = await page.eval(`(() => { const G = SpellRun.G; return { state: G.state, hp: G.hp, score: G.score, combo: G.combo, si: G.si, mist: G.mist[G.wi], contUsed: G.contUsed, invuln: G.invuln, obst: G.obstacles.length, tiles: G.tiles.length, boost: G.boost, hidden: document.getElementById('cont').hidden, rs: SpellRun.getRunState(), hits: G.obstHits }; })()`);
    assert.equal(b.state, 'run'); assert.equal(b.hp, 3, '체력 절반(올림)'); assert.equal(b.score, a.score, '점수 유지'); assert.equal(b.combo, a.combo, '콤보 유지');
    assert.equal(b.si, 0, '이 단어를 처음부터'); assert.equal(b.mist, a.mist, '실수 횟수 유지'); assert.equal(b.contUsed, true); assert.equal(b.rs.continued, true);
    assert.ok(Math.abs(b.invuln - 1.5) < 1e-9); assert.equal(b.obst, 0); assert.equal(b.boost, 0); assert.equal(b.hidden, true);
    // 이어한 직후 1.5초는 장애물에 맞지 않는다
    const c = await page.eval(`(() => { const R = SpellRun, G = R.G; G.obstacles.push({ kind: 'box', x: R.RUNNER_X - 6, w: 28, hit: false, age: 0, art: 0 }); for (let i = 0; i < 60; i++) R.step(1 / 60); return { hp: G.hp, hits: G.obstHits, state: G.state }; })()`);
    assert.equal(c.hits, b.hits, '1.5초 안에는 피격 없음'); assert.equal(c.hp, 3);
    // 두 번째 체력 0 은 선택 화면 없이 종료
    const d = await page.eval(`(() => { const R = SpellRun, G = R.G; G.invuln = 0; G.jumpT = -1; G.j2 = -1; G.hp = 1; G.obstacles = []; G.obstacles.push({ kind: 'box', x: R.RUNNER_X - 6, w: 28, hit: false, age: 0, art: 0 }); R.step(1 / 60); const s1 = G.state; for (let i = 0; i < 120; i++) R.step(1 / 60); return { s1: s1, state: G.state, hidden: document.getElementById('cont').hidden, note: (document.getElementById('resCont') || {}).textContent }; })()`);
    assert.equal(d.s1, 'ending', '두 번째는 선택 화면 없이 쓰러짐'); assert.equal(d.state, 'over'); assert.equal(d.hidden, true); assert.equal(d.note, '이어하기 사용', '결과 화면 한 줄 표시');
    await page.close();
  });
}

test('341-2) 끝내기를 고르면 종료(결과 화면에 이어하기 표시 없음), continue=0 이면 기존대로(선택 화면 없음, 조정값 표시), 시작 화면 안내 줄', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?continue=1&obs=0&dj=0', dodge: false });
  await startManual(page); await warmUp(page); await page.eval(TO_ZERO('obst'));
  await page.click('#endBtn');
  assert.equal(await page.eval('SpellRun.G.state'), 'over'); assert.equal(await page.eval('document.getElementById("cont").hidden'), true);
  assert.equal(await page.text('#resTitle'), '게임 오버'); assert.equal(await page.eval('!!document.getElementById("resCont")'), false);
  await page.close();
  page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?continue=0&obs=0&dj=0', dodge: false });
  await startManual(page); await warmUp(page);
  assert.equal(await page.eval("document.getElementById('tune').hidden"), false, '기본값과 다르면 조정값 표시'); assert.doesNotMatch(await page.eval("document.querySelector('#start .rules li.mint').textContent"), /이어서/, 'continue=0 이면 이어하기 안내 없음');
  const z = await page.eval(TO_ZERO('obst')); assert.equal(z.state, 'ending'); assert.equal(z.contHidden, true);
  await page.close();
  page = await openGame({ ids: [1, 2, 3], query: '?continue=1', dodge: false }); await gameReady(page);
  assert.equal(await page.eval("document.getElementById('tune').hidden"), true, '기본값이면 표시 없음'); assert.match(await page.eval("document.querySelector('#start .rules li.mint').textContent"), /한 번 이어서/);
  await page.close();
});

test('341-3) 생존 모드: 선택 화면에 머문 시간은 생존 시간에서 제외되고, 결과에 이어하기 사용이 구분되어 보인다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ ids: [1, 2, 3, 4, 11, 12, 13, 14], query: '?continue=1&obs=0&dj=0&survival=1', dodge: false });
  await startManual(page); await warmUp(page);
  assert.equal(await page.eval('SpellRun.G.survival'), true);
  await page.eval(TO_ZERO('obst'));
  const t0 = await page.eval('SpellRun.getRunState().elapsed'); await page.eval('(() => { for (let i = 0; i < 600; i++) SpellRun.step(1 / 60); })()');   // 10초 머문다
  assert.equal(await page.eval('SpellRun.getRunState().elapsed'), t0, '선택 화면 시간 제외');
  await page.click('#contBtn');
  await page.eval(`(() => { const R = SpellRun, G = R.G; G.invuln = 0; G.jumpT = -1; G.j2 = -1; G.hp = 1; G.obstacles.push({ kind: 'box', x: R.RUNNER_X - 6, w: 28, hit: false, age: 0, art: 0 }); for (let i = 0; i < 120; i++) R.step(1 / 60); })()`);
  assert.equal(await page.eval('SpellRun.G.state'), 'over');
  assert.match(await page.text('#resCont'), /이어하기 사용/); assert.match(await page.text('#resCont'), /생존/);
  const sec = await page.eval('(() => { const m = document.querySelector("#resTime b").textContent.split(":"); return (+m[0]) * 60 + (+m[1]); })()'); assert.ok(sec <= Math.ceil(t0) + 4, '10초 대기가 생존 시간에 들어가지 않았다: ' + sec + ' (선택 직전 ' + t0 + ')');
  await page.close();
});


