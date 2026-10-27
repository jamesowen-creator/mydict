// 작업345: 스펠링 런 시작 전 단어 미리 보기(자동 순차 재생). 헤드리스 Chrome 360×640(일부 390).
// 자체 임시 서버에 모의 /api/me·/api/wordbook·/api/tts 만 둔다 — 실제 서버·운영 서버·실제 TTS 와 무관.
// 실행: node --test tests/ui/spellrun_preview.ui.test.js   (Chrome이 없으면 건너뜀)
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
const WAV = (() => { const n = 800, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();

const WORDS = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'garden', 'planet', 'river', 'cloud', 'bridge'];
const mkRows = n => WORDS.slice(0, n).map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));
const SPEECH = `(() => {
  const S = window.__speech = { spoken: [] };
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [], speaking: false, pending: false, paused: false, cancel: () => {}, resume: () => {},
    speak: u => { if (u.volume !== 0) S.spoken.push(u.text); setTimeout(() => { if (u.onstart) u.onstart(); }, 0); setTimeout(() => { if (u.onend) u.onend(); }, 30); },
  } });
})();`;

let srv, base, browser;
const state = { rows: [], requests: [], tts: 200, ttsDelay: 0, inflight: 0, maxInflight: 0 };
const resetState = () => Object.assign(state, { rows: mkRows(12), requests: [], tts: 200, ttsDelay: 0, inflight: 0, maxInflight: 0 });
const ttsCalls = () => state.requests.filter(r => r.url === '/api/tts');
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
        state.requests.push({ method: req.method, url: u, body, at: Date.now() });
        if (u === '/api/me') return json(200, { id: 7, role: 'user', can_wordbook: true, perm_versus: false });
        if (u === '/api/wordbook' && req.method === 'GET') return json(200, state.rows);
        if (u === '/api/tts' && req.method === 'POST') {
          if (state.tts !== 200) return json(state.tts, { error: '모의 TTS 오류' });
          state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight);
          const send = () => { state.inflight--; res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(WAV); };
          return state.ttsDelay ? setTimeout(send, state.ttsDelay) : send();
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

// 게임 페이지를 연다. 저장소는 비우고(미리 보기 켜짐이 기본), 시간 설정은 시험이 짧게 바꿔 쓴다. 장애물은 막아 두고 이어하기는 끈다(미리 보기와 무관한 요소를 줄인다)
async function openGame({ query = '', width = 360, height = 640, speech = true, storage = '' } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.removeItem('spellrun_preview'); ${storage} } sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(state.rows.map(r => r.id)))}); } catch (e) {}` });
  if (speech) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  return page;
}
const fast = (page, t = {}) => page.eval(`Object.assign(SpellRun.preview.T, ${JSON.stringify(Object.assign({ maxMs: 1500, gapMs: 40, silentMs: 80 }, t))})`);
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const waitFor = (page, cond, ms = 6000) => page.waitFor(cond, ms);
const pvShown = page => page.eval('SpellRun.preview.state.wordsShown.slice()');
const ready = page => waitFor(page, "!document.getElementById('pvStart').hidden");
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);

test('켜짐(기본): 시작 → 미리 보기가 이번 판 순서대로 나오고 발음을 한 번씩 부르며, 끝나면 자동 시작 없이 시작 단추에서 멈춘다. 시작하면 같은 순서로 판이 열린다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame(); await fast(page);
  assert.equal(await page.eval('SpellRun.preview.isOn()'), true);
  assert.equal(await page.eval("document.querySelector('#modeRow button[data-mode=\"preview\"]').textContent"), '미리 보기 켬');
  await click(page, '#startBtn');
  await waitFor(page, "!document.getElementById('pv').hidden");
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run', '미리 보기 동안 판은 시작되지 않음');
  assert.equal(await page.eval("document.getElementById('start').hidden"), true);
  await waitFor(page, "document.getElementById('pvProg').textContent === '1/10'");
  const first = await page.eval("({ w: document.getElementById('pvWord').textContent, m: document.getElementById('pvMean').textContent })");
  assert.equal(first.m, first.w + ' 뜻', '단어와 대표 뜻이 함께 나옴');
  await ready(page);
  const shown = await pvShown(page);
  assert.equal(shown.length, 10, '10단어');
  assert.equal(new Set(shown).size, 10);
  assert.equal(ttsCalls().length, 10, '발음 호출은 단어당 한 번');
  assert.deepEqual(ttsCalls().map(r => JSON.parse(r.body).text), shown, '발음도 보여 준 순서');
  await sleep(400);
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run', '마지막에 자동으로 시작하지 않음');
  assert.match(await page.eval("document.getElementById('pvProg').textContent"), /10개/);
  await click(page, '#pvStart');
  await waitFor(page, "SpellRun.G.state === 'run' || SpellRun.G.state === 'intro'");
  assert.deepEqual(await page.eval('SpellRun.G.words.slice(0, 10).map(w => w.word)'), shown, '미리 본 순서 = 실제 출제 순서');
  assert.equal(await page.eval("document.getElementById('pv').hidden"), true);
  noErrors(page);
  await page.close();
});

test('끄기: 스위치로 끄면 저장(spellrun_preview)되고 시작이 바로 판을 연다. 주소 preview=0|1 이 저장값보다 우선하며 조정값 사용 중에는 나오지 않는다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  await click(page, '#modeRow button[data-mode="preview"]');
  assert.equal(await page.eval("localStorage.getItem('spellrun_preview')"), '0');
  assert.equal(await page.eval("document.querySelector('#modeRow button[data-mode=\"preview\"]').textContent"), '미리 보기 끔');
  assert.equal(await page.eval("document.querySelector('#modeRow button[data-mode=\"preview\"]').getAttribute('aria-pressed')"), 'false');
  await click(page, '#startBtn');
  await waitFor(page, "SpellRun.G.state === 'run' || SpellRun.G.state === 'intro'");
  assert.equal(await page.eval("document.getElementById('pv').hidden"), true, '끄면 미리 보기 화면 없음');
  assert.equal(ttsCalls().length <= 1, true, '미리 보기용 발음 호출 없음(게임의 첫 단어 연출 발음만)');
  await page.close();

  page = await openGame({ storage: "localStorage.setItem('spellrun_preview', '0');" });   // 저장값 꺼짐
  assert.equal(await page.eval('SpellRun.preview.isOn()'), false, '저장값을 따른다');
  await page.goto(base + '/spelling_run.html?preview=1');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  assert.equal(await page.eval('SpellRun.preview.isOn()'), true, '주소 preview=1 이 저장값보다 우선');
  assert.equal(await page.eval("localStorage.getItem('spellrun_preview')"), '0', '주소 값은 저장하지 않는다');
  assert.equal(await page.eval("document.getElementById('tune').hidden"), true, '조정값 사용 중에 나오지 않음');
  assert.equal(await page.eval("localStorage.getItem('spellrun_opts')"), null);
  await page.close();

  page = await openGame({ query: '?preview=0' });
  assert.equal(await page.eval('SpellRun.preview.isOn()'), false);
  assert.equal(await page.eval("document.getElementById('tune').hidden"), true);
  await page.close();
});

test('상한: 단어가 10개를 넘으면 처음 10개만(생존 모드 포함). 건너뛰기는 바로 준비 상태, 탭하면 다음 단어, 일시정지/계속', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame({ query: '?survival=1' }); await fast(page);
  await click(page, '#startBtn');
  await ready(page);
  const shown = await pvShown(page);
  assert.ok(shown.length <= 10 && shown.length >= 5, '생존 모드도 최대 10: ' + shown.length);
  await click(page, '#pvStart');
  await waitFor(page, "SpellRun.G.state === 'run' || SpellRun.G.state === 'intro'");
  assert.deepEqual(await page.eval('SpellRun.G.words.slice(0, ' + shown.length + ').map(w => w.word)'), shown, '생존 모드도 실제 출제 순서');
  await page.close();

  page = await openGame(); await fast(page, { maxMs: 5000, gapMs: 3000 });   // 천천히 흘러가게 해 두고 조작한다
  await page.eval("SpellRun.preview.run(" + JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ word: 'w' + i, meaning: 'm' + i }))) + ", () => {}, () => {})");
  assert.equal(await page.eval('SpellRun.preview.state.words.length'), 10, '15개를 넘겨도 10개');
  assert.equal(await page.eval("document.getElementById('pvProg').textContent"), '1/10');
  await click(page, '#pvArea');
  assert.equal(await page.eval("document.getElementById('pvProg').textContent"), '2/10', '탭하면 다음 단어');
  assert.equal(await page.eval("document.getElementById('pvWord').textContent"), 'w1');
  await click(page, '#pvPause');
  assert.equal(await page.eval("document.getElementById('pvPause').textContent"), '계속');
  const n = ttsCalls().length; await sleep(500);
  assert.equal(await page.eval("document.getElementById('pvProg').textContent"), '2/10');
  assert.equal(ttsCalls().length, n, '일시정지 중에는 발음 호출도 없음');
  await click(page, '#pvPause');
  assert.equal(await page.eval("document.getElementById('pvPause').textContent"), '일시정지');
  await click(page, '#pvSkip');
  assert.equal(await page.eval("document.getElementById('pvStart').hidden"), false, '건너뛰기는 바로 시작 준비');
  assert.equal(await page.eval("document.getElementById('pvCtl').hidden"), true);
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'pvStart');
  await page.close();
});

test('미리 보기 시간은 생존 시간·시계에 들어가지 않는다(시작을 누른 순간부터 센다)', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame(); await fast(page, { maxMs: 3000, gapMs: 150 });
  await click(page, '#startBtn');
  await ready(page);
  await sleep(1500);   // 준비 상태에서 한참 머문다
  await click(page, '#pvStart');
  await waitFor(page, "SpellRun.G.state === 'run' || SpellRun.G.state === 'intro'");
  const t = await page.eval('SpellRun.G.time - SpellRun.G.startTime');
  assert.ok(t < 0.6, '시작 직후 경과 시간이 미리 보기 시간을 포함하지 않음: ' + t);
  await page.close();
});

test('다음 단어 발음은 현재 단어 요청이 끝난 뒤 하나만 미리 받는다(서버에 동시에 둘 이상 나가지 않는다)', { skip: SKIP }, async () => {
  resetState(); state.ttsDelay = 120;
  const page = await openGame(); await fast(page, { maxMs: 3000, gapMs: 1500 });
  await click(page, '#startBtn');
  await waitFor(page, "document.getElementById('pvProg').textContent === '1/10'");
  await waitFor(page, "SpellRun.preview.state.idx === 0", 2000);
  const deadline = Date.now() + 3000;
  while (ttsCalls().length < 2 && Date.now() < deadline) await sleep(30);
  assert.equal(ttsCalls().length, 2, '첫 단어가 놀 때 다음 단어 하나를 미리 받음');
  assert.equal(await page.eval('SpellRun.preview.state.idx'), 0, '아직 첫 단어에 머무는 중');
  await sleep(300);
  assert.equal(ttsCalls().length, 2, '그 뒤로는 더 받지 않음');
  assert.equal(state.maxInflight, 1, '서버 동시 요청 최대 ' + state.maxInflight);
  assert.ok(await page.eval('SpellRun.preview.state.maxPrefetch') <= 1);
  await page.close();
});

for (const status of [429, 503, 401, 403]) {
  test(`서버 발음 ${status}: 게임과 같은 방식으로 기기 음성으로 대신 읽고, 같은 종류의 안내는 연달아 다시 쓰지 않는다`, { skip: SKIP }, async () => {
    resetState(); state.tts = status;
    const page = await openGame(); await fast(page);
    await page.eval("window.__mut = 0; new MutationObserver(l => { window.__mut += l.length; }).observe(document.getElementById('pvNote'), { childList: true, characterData: true, subtree: true })");
    await click(page, '#startBtn');
    await ready(page);
    const spoken = await page.eval('window.__speech.spoken.slice()');
    assert.deepEqual(spoken, await pvShown(page), '기기 음성이 보여 준 순서대로 읽음');
    assert.match(await page.eval("document.getElementById('pvNote').textContent"), /기기 음성/);
    assert.equal(await page.eval('window.__mut'), 1, '안내는 한 번만 씀(변경 1회)');
    if (status === 429) assert.ok(ttsCalls().length >= 10 && ttsCalls().length <= 12, '429 는 게임처럼 단어마다 시도하되 미리 받기는 한 번 실패하면 그만둠: ' + ttsCalls().length);
    else assert.equal(ttsCalls().length, 1, `${status} 는 이번 방문에서 서버 발음을 더 부르지 않음`);
    noErrors(page);
    await page.close();
  });
}

test('소리를 끄면 읽지 않고 정해진 시간만 보여 준다. 재생이 끝나지 않아도 한 단어 최대 시간이 지나면 넘어간다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame(); await fast(page, { silentMs: 60 });
  await click(page, '#sndStart');   // 소리 끔
  await click(page, '#startBtn');
  await ready(page);
  assert.equal(ttsCalls().length, 0, '소리를 끄면 발음 호출 없음');
  assert.equal((await pvShown(page)).length, 10);
  await page.close();

  page = await openGame({ speech: false }); await fast(page, { maxMs: 250, gapMs: 40 });
  await page.eval("Object.defineProperty(window.SpellRun, 'x', { value: 1 })");
  state.tts = 500;   // 서버 실패 + 기기 음성 없음 → 곧바로 끝난 것으로 보고 다음으로
  await click(page, '#startBtn');
  const t0 = Date.now();
  await ready(page);
  assert.ok(Date.now() - t0 < 10 * 400 + 2000, '단어당 상한을 넘기지 않음: ' + (Date.now() - t0));
  await page.close();
});

test('탭이 숨겨지면 진행을 멈추고, 다시 보이면 이어 간다. 돌아가기는 재생을 멈추고 시작 화면으로 돌아간다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame(); await fast(page, { maxMs: 3000, gapMs: 100 });
  await click(page, '#startBtn');
  await waitFor(page, "document.getElementById('pvProg').textContent === '1/10'");
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(200);
  const idx = await page.eval('SpellRun.preview.state.idx'), n = state.requests.length;
  await sleep(700);
  assert.equal(await page.eval('SpellRun.preview.state.idx'), idx, '숨겨진 동안 단어가 넘어가지 않음');
  assert.equal(state.requests.length, n, '숨겨진 동안 요청 없음');
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
  await waitFor(page, `SpellRun.preview.state.idx > ${idx}`, 4000);
  await click(page, '#pvBack');
  assert.equal(await page.eval("document.getElementById('pv').hidden"), true);
  assert.equal(await page.eval("document.getElementById('start').hidden"), false);
  assert.equal(await page.eval('SpellRun.preview.state.active'), false);
  await sleep(300);
  const m = state.requests.length; await sleep(500);
  assert.equal(state.requests.length, m, '돌아간 뒤에는 요청 없음');
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run');
  await page.close();
});

test('360×640: 모드 줄에 미리 보기 스위치가 들어가도 시작 카드 스크롤 높이가 늘지 않고 시작 버튼 클릭이 막히지 않는다. 미리 보기 화면도 스크롤 없이 핵심이 보인다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const g = await page.eval(`(() => {
    const box = document.getElementById('box').getBoundingClientRect(), card = document.querySelector('#start .card'), b = document.getElementById('startBtn'), r = b.getBoundingClientRect();
    const row = document.getElementById('modeRow').getBoundingClientRect(), cr = card.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { scroll: card.scrollHeight - card.clientHeight, btnInBox: r.top >= box.top && r.bottom <= box.bottom, hitOk: hit === b || b.contains(hit), rowW: row.width, rowH: row.height, btnH: document.querySelector('#modeRow button').getBoundingClientRect().height, rowScroll: document.getElementById('modeRow').scrollWidth - document.getElementById('modeRow').clientWidth, rowInCard: row.right <= cr.right + 0.5 && row.left >= cr.left - 0.5, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`);
  console.log('[측정] 360×640 시작 카드: ' + JSON.stringify(g));
  assert.ok(g.rowH <= g.btnH + 2, '모드 줄이 한 줄(스위치가 줄을 늘리지 않음): ' + JSON.stringify(g));
  assert.ok(g.hitOk, '시작 버튼이 가려지지 않고 눌림: ' + JSON.stringify(g));
  assert.ok(g.rowScroll <= 0 && g.rowInCard, '모드 줄이 카드 폭 안에 들어감: ' + JSON.stringify(g));
  assert.ok(g.docX <= 0);
  await fast(page, { maxMs: 4000, gapMs: 4000 });
  await page.click('#startBtn');
  await waitFor(page, "!document.getElementById('pv').hidden");
  const p = await page.eval(`(() => {
    const box = document.getElementById('box').getBoundingClientRect(), card = document.querySelector('#pv .card');
    const inBox = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5; };
    return { scroll: card.scrollHeight - card.clientHeight, area: inBox('pvArea'), pause: inBox('pvPause'), skip: inBox('pvSkip'), back: inBox('pvBack'), h: document.getElementById('pvPause').getBoundingClientRect().height };
  })()`);
  console.log('[측정] 360×640 미리 보기: ' + JSON.stringify(p));
  assert.ok(p.area && p.pause && p.skip && p.back, JSON.stringify(p));
  assert.ok(p.scroll <= 1, '카드 스크롤 없음: ' + JSON.stringify(p));
  assert.ok(p.h >= 44, '터치 크기');
  noErrors(page);
  await page.close();
});
