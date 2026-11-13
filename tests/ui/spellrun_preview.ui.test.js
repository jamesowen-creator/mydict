// 작업345·414: 스펠링 런 시작 전 단어 미리 보기. 작업414에서 자동 순차 재생을 없애고 아이콘으로 직접 넘기는 방식(이전·다음·재생=시작·닫기·건너뛰기), 짧은 뜻 줄과 펼치기, 키보드, 미니멀 배치로 바뀌었다. 헤드리스 Chrome 여러 크기.
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
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const waitFor = (page, cond, ms = 6000) => page.waitFor(cond, ms);
const pvShown = page => page.eval('SpellRun.preview.state.wordsShown.slice()');
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const idxOf = page => page.eval('SpellRun.preview.state.idx');
const prog = page => page.eval("document.getElementById('pvProg').textContent");
const isLast = page => page.eval("document.getElementById('pvNext').getAttribute('aria-label') === '게임 시작'");
// 작업414: 한 단어 앞으로. 새 단어가 보일 때까지 기다린다
const next = async page => { const i = await idxOf(page); await click(page, '#pvNext'); await waitFor(page, `SpellRun.preview.state.idx === ${i + 1}`); };
// 마지막 단어까지 [다음]으로 넘긴다(자동 넘김이 없으므로 시험이 직접 넘긴다). 단어마다 발음 호출이 끝나길 기다리지는 않는다
const walkToLast = async page => { while (!(await isLast(page))) await next(page); };
// 시작 흐름: 시작 → 미리 보기 → 마지막까지 넘기고 재생 아이콘으로 게임 시작
const startGame = async page => { await click(page, '#startBtn'); await waitFor(page, "!document.getElementById('pv').hidden"); };
const playing = page => waitFor(page, "SpellRun.G.state === 'run' || SpellRun.G.state === 'intro'");
// 가짜 오디오 재생: 몇 번 재생을 시작했는지만 센다(소리·네트워크 없음)
const AUDIO = `(() => { window.__plays = 0; HTMLMediaElement.prototype.play = function () { window.__plays++; return Promise.resolve(); }; })();`;
// 데이터에 짧은 뜻·여러 뜻·usage_note 가 있는 단어장(모든 행 같은 모양): short_meaning 은 단어마다 다르게
const richRows = () => WORDS.slice(0, 12).map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(),
  data: { word: w, lang: 'en', short_meaning: w + ' 뜻', meanings: [{ pos: 'noun', definition: w + ' 뜻, 보조뜻', usage_note: '쓰임 설명입니다.' }, { pos: 'verb', definition: '동사뜻' }] } }));
// 짧은 뜻·상세를 직접 넘겨 미리 보기를 연다(판 시작 없이 화면만)
const openPv = async (page, list) => {
  await page.eval(`window.__ready = 0; window.__back = 0; SpellRun.preview.run(${JSON.stringify(list)}, () => { window.__ready++; }, () => { window.__back++; })`);
};
// 작업419: 뜻 표시는 품사별 번호 목록(groups). W 는 품사 없는 번호 목록, G 는 품사 그룹을 직접 지정
const W = (word, lines, detail, keys) => ({ word, meaning: lines[0], pv: { groups: [{ pos: '', lines }], detail: detail || [], keys: keys || [] } });
const G = (word, groups, detail, keys) => ({ word, meaning: groups[0].lines[0], pv: { groups, detail: detail || [], keys: keys || [] } });
const DETAIL_LONG = [{ def: '주위를 둘러싸고 있는 자연적·사회적 조건 전체를 뜻하는 말로 쓰이는 명사입니다', note: '사람이 살아가는 데 영향을 주는 주변의 모든 조건을 넓게 가리킬 때 자주 쓰고, 일터나 학교처럼 사회적 분위기를 말할 때도 쓰는 표현입니다. 글에서는 격식을 갖춘 느낌을 줍니다.' }, { def: '', note: '두 번째 뜻의 쓰임 설명도 이어서 길게 적혀 있는 경우를 가정한 문장입니다.' }];

test('켜짐(기본): 시작 → 미리 보기는 저절로 넘어가지 않고, 사용자가 [다음]으로 넘기며 단어마다 발음을 한 번씩 부른다. 마지막의 재생 아이콘을 누르면 같은 순서로 판이 열린다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  assert.equal(await page.eval('SpellRun.preview.isOn()'), true);
  assert.equal(await page.eval("document.querySelector('#optRow button[data-mode=\"preview\"]').textContent"), '미리 보기 켬');
  await startGame(page);
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run', '미리 보기 동안 판은 시작되지 않음');
  assert.equal(await page.eval("document.getElementById('start').hidden"), true);
  assert.equal(await prog(page), '1/10');
  const first = await page.eval("({ w: document.getElementById('pvWord').textContent, m: document.querySelector('#pvMean .pvt').textContent })");
  assert.equal(first.m, first.w + ' 뜻', '단어와 대표 뜻이 함께 나옴');
  await sleep(1500);   // 예전에는 이 사이에 저절로 넘어갔다
  assert.equal(await prog(page), '1/10', '자동 넘김 없음');
  assert.equal((await pvShown(page)).length, 1);
  assert.equal(await page.eval("document.getElementById('pvPrev').disabled"), true, '첫 단어에서는 이전이 없다');
  assert.equal(await page.eval("document.getElementById('pvNext').getAttribute('aria-label')"), '다음 단어');
  await walkToLast(page);
  assert.equal(await prog(page), '10/10');
  const shown = await pvShown(page);
  assert.equal(shown.length, 10, '10단어'); assert.equal(new Set(shown).size, 10);
  const deadline = Date.now() + 4000; while (ttsCalls().length < 10 && Date.now() < deadline) await sleep(30);
  assert.deepEqual(ttsCalls().map(r => JSON.parse(r.body).text), shown, '발음 호출은 단어당 한 번, 보여 준 순서');
  await sleep(400);
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run', '마지막에 자동으로 시작하지 않음');
  assert.equal(await page.eval("document.getElementById('pvIcPlay').hasAttribute('hidden')"), false, '마지막은 재생 아이콘');
  assert.equal(await page.eval("document.getElementById('pvIcNext').hasAttribute('hidden')"), true);
  await click(page, '#pvNext');
  await playing(page);
  assert.deepEqual(await page.eval('SpellRun.G.words.slice(0, 10).map(w => w.word)'), shown, '미리 본 순서 = 실제 출제 순서');
  assert.equal(await page.eval("document.getElementById('pv').hidden"), true);
  noErrors(page);
  await page.close();
});

test('끄기: 스위치로 끄면 저장(spellrun_preview)되고 시작이 바로 판을 연다. 주소 preview=0|1 이 저장값보다 우선하며 조정값 사용 중에는 나오지 않는다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  await click(page, '#optRow button[data-mode="preview"]');
  assert.equal(await page.eval("localStorage.getItem('spellrun_preview')"), '0');
  assert.equal(await page.eval("document.querySelector('#optRow button[data-mode=\"preview\"]').textContent"), '미리 보기 끔');
  assert.equal(await page.eval("document.querySelector('#optRow button[data-mode=\"preview\"]').getAttribute('aria-pressed')"), 'false');
  await click(page, '#startBtn');
  await playing(page);
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

test('상한·이동: 단어가 10개를 넘으면 처음 10개만(생존 모드 포함). 다음·이전 아이콘으로 오가고, 건너뛰기는 바로 시작한다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame({ query: '?survival=1' });
  await startGame(page); await walkToLast(page);
  const shown = await pvShown(page);
  assert.ok(shown.length <= 10 && shown.length >= 5, '생존 모드도 최대 10: ' + shown.length);
  await click(page, '#pvNext');
  await playing(page);
  assert.deepEqual(await page.eval('SpellRun.G.words.slice(0, ' + shown.length + ').map(w => w.word)'), shown, '생존 모드도 실제 출제 순서');
  await page.close();

  page = await openGame();
  await openPv(page, Array.from({ length: 15 }, (_, i) => ({ word: 'w' + i, meaning: 'm' + i })));   // pv 없이 {word, meaning} 만 와도 대표 뜻으로 보인다
  assert.equal(await page.eval('SpellRun.preview.state.words.length'), 10, '15개를 넘겨도 10개');
  assert.equal(await prog(page), '1/10');
  assert.equal(await page.eval("document.querySelector('#pvMean .pvt').textContent"), 'm0');   // 품사 없는 데이터: 번호 한 줄
  assert.equal(await page.eval("document.querySelectorAll('#pvMean .pvpos').length"), 0, '품사 줄 없음');
  await click(page, '#pvNext'); await waitFor(page, "document.getElementById('pvProg').textContent === '2/10'");
  assert.equal(await page.eval("document.getElementById('pvWord').textContent"), 'w1');
  assert.equal(await page.eval("document.getElementById('pvPrev').disabled"), false);
  await click(page, '#pvPrev'); await waitFor(page, "document.getElementById('pvProg').textContent === '1/10'");
  assert.equal(await page.eval("document.getElementById('pvWord').textContent"), 'w0', '이전으로 되돌아감');
  assert.equal(await page.eval("document.getElementById('pvPrev').disabled"), true);
  await click(page, '#pvPrev'); await sleep(100);
  assert.equal(await idxOf(page), 0, '첫 단어에서 이전을 눌러도 제자리');
  await click(page, '#pvSkip');
  assert.equal(await page.eval('window.__ready'), 1, '건너뛰기는 바로 시작(onReady 1번)');
  assert.equal(await page.eval("document.getElementById('pv').hidden"), true);
  await page.close();
});

test('미리 보기 시간은 생존 시간·시계에 들어가지 않는다(시작을 누른 순간부터 센다)', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await startGame(page); await walkToLast(page);
  await sleep(1500);   // 마지막 단어에서 한참 머문다
  await click(page, '#pvNext');
  await playing(page);
  const t = await page.eval('SpellRun.G.time - SpellRun.G.startTime');
  assert.ok(t < 0.6, '시작 직후 경과 시간이 미리 보기 시간을 포함하지 않음: ' + t);
  await page.close();
});

test('다음 단어 발음은 현재 단어 요청이 끝난 뒤 하나만 미리 받는다(서버에 동시에 둘 이상 나가지 않는다)', { skip: SKIP }, async () => {
  resetState(); state.ttsDelay = 120;
  const page = await openGame();
  await startGame(page);
  await waitFor(page, "document.getElementById('pvProg').textContent === '1/10'");
  const deadline = Date.now() + 3000;
  while (ttsCalls().length < 2 && Date.now() < deadline) await sleep(30);
  assert.equal(ttsCalls().length, 2, '첫 단어가 머무는 동안 다음 단어 하나를 미리 받음');
  assert.equal(await idxOf(page), 0, '아직 첫 단어에 머무는 중');
  await sleep(300);
  assert.equal(ttsCalls().length, 2, '그 뒤로는 더 받지 않음');
  assert.equal(state.maxInflight, 1, '서버 동시 요청 최대 ' + state.maxInflight);
  assert.ok(await page.eval('SpellRun.preview.state.maxPrefetch') <= 1);
  await page.close();
});

for (const status of [429, 503, 401, 403]) {
  test(`서버 발음 ${status}: 게임과 같은 방식으로 기기 음성으로 대신 읽고, 같은 종류의 안내는 연달아 다시 쓰지 않는다`, { skip: SKIP }, async () => {
    resetState(); state.tts = status;
    const page = await openGame();
    await page.eval("window.__mut = 0; new MutationObserver(l => { window.__mut += l.length; }).observe(document.getElementById('pvNote'), { childList: true, characterData: true, subtree: true })");
    await startGame(page);
    for (let i = 0; i < 10; i++) {
      await waitFor(page, `window.__speech.spoken.length === ${i + 1}`);   // 단어마다 기기 음성이 시작된 뒤에 넘긴다(바로 넘기면 이전 단어의 늦은 대체 음성은 일부러 읽지 않는다)
      if (i < 9) await next(page);
    }
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

test('소리를 끄면 읽지 않는다(발음 호출 0, 단어는 그대로 넘어감). 서버 실패+기기 음성 없음이어도 멈추지 않고 넘길 수 있다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  await click(page, '#sndStart');   // 소리 끔
  await startGame(page); await walkToLast(page);
  assert.equal(ttsCalls().length, 0, '소리를 끄면 발음 호출 없음');
  assert.equal((await pvShown(page)).length, 10);
  await page.close();

  page = await openGame({ speech: false });
  state.tts = 500;   // 서버 실패 + 기기 음성 없음
  await startGame(page); await walkToLast(page);
  assert.equal((await pvShown(page)).length, 10, '소리가 안 나도 넘길 수 있다');
  noErrors(page);
  await page.close();
});

test('탭이 숨겨지면 발음을 멈추고 요청도 없다. 다시 보이면 지금 단어를 한 번 다시 읽는다. 돌아가기는 시작 화면으로 돌아간다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await startGame(page); await next(page);
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(200);
  const idx = await idxOf(page), n = state.requests.length, shownN = (await pvShown(page)).length;
  await sleep(500);
  assert.equal(await idxOf(page), idx, '숨겨진 동안 단어가 그대로');
  assert.equal(state.requests.length, n, '숨겨진 동안 요청 없음');
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
  await waitFor(page, `SpellRun.preview.state.wordsShown.length === ${shownN + 1}`, 4000);
  assert.equal(await idxOf(page), idx, '같은 단어를 이어 간다');
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

// 작업351: 페이지 보관(bfcache). pagehide persisted=true 는 미리 보기를 끝내지 않고 숨겨짐처럼 멈추며, 돌아오면(pageshow persisted=true) 지금 단어를 한 번만 다시 읽는다.
const pagehide = (page, persisted) => page.eval(`window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: ${persisted} }))`);
const pageshow = (page, persisted) => page.eval(`window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: ${persisted} }))`);
const setHidden = (page, h) => page.eval(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${h} }); document.dispatchEvent(new Event('visibilitychange'));`);

test('보관(pagehide persisted=true) → 복귀(pageshow): 미리 보기가 끝나지 않고 멈췄다가 같은 단어를 한 번만 다시 읽고, 펼침은 접히며, 이전·다음·시작이 그대로 동작한다', { skip: SKIP }, async () => {
  for (const withVisibility of [true, false]) {   // 보관에 들어갈 때 visibilitychange 가 함께 오는 브라우저 / 오지 않는 브라우저
    resetState();
    const page = await openGame();
    await startGame(page); await next(page);
    assert.equal(await prog(page), '2/10');
    if (withVisibility) await setHidden(page, true);
    await pagehide(page, true);
    await sleep(200);
    assert.equal(await page.eval('SpellRun.preview.state.active'), true, '끝나지 않는다');
    assert.equal(await page.eval("document.getElementById('pv').hidden"), false);
    const idx = await idxOf(page), shownN = (await pvShown(page)).length, n = state.requests.length;
    await sleep(500);
    assert.equal(await idxOf(page), idx, '멈춘 동안 단어가 그대로');
    assert.equal(state.requests.length, n, '멈춘 동안 요청 없음');
    if (withVisibility) await setHidden(page, false);
    await pageshow(page, true);
    await waitFor(page, `SpellRun.preview.state.wordsShown.length === ${shownN + 1}`, 3000);
    const shown = await pvShown(page);
    assert.equal(shown[shownN], shown[shownN - 1], '같은 단어를 다시 읽는다');
    await sleep(300);
    assert.equal((await pvShown(page)).length, shownN + 1, '재개는 한 번만(visibilitychange 와 pageshow 가 함께 와도)');
    await click(page, '#pvPrev'); await waitFor(page, `SpellRun.preview.state.idx === ${idx - 1}`);   // 복귀 뒤에도 이전이 동작
    await walkToLast(page);
    await click(page, '#pvNext');
    await playing(page);   // onReady 가 그대로 동작
    noErrors(page);
    await page.close();
  }
  // 돌아가기(onBack)도 그대로
  resetState();
  const p2 = await openGame();
  await startGame(p2);
  await waitFor(p2, "document.getElementById('pvProg').textContent === '1/10'");
  await pagehide(p2, true); await pageshow(p2, true);
  await click(p2, '#pvBack');
  assert.equal(await p2.eval("document.getElementById('start').hidden"), false);
  assert.equal(await p2.eval('SpellRun.preview.state.active'), false);
  await p2.close();
});

test('실제로 닫히는 pagehide(persisted=false)는 미리 보기를 끝낸다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await startGame(page);
  await waitFor(page, "document.getElementById('pvProg').textContent === '1/10'");
  await pagehide(page, false);
  assert.equal(await page.eval('SpellRun.preview.state.active'), false, '닫히는 것이면 끝낸다');
  assert.equal(await page.eval("document.getElementById('pv').hidden"), true);
  await page.close();
});

// ───────── 작업414: 아이콘·뜻 펼치기·키보드·디자인 ─────────
test('414 아이콘: 이전·다음·닫기는 글자 없이 인라인 SVG(stroke) 아이콘이고 aria-label 이 있다. 마지막 단어에서 다음 자리는 재생 아이콘·"게임 시작". 글자 버튼은 [건너뛰기] 하나', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await openPv(page, [W('apple', ['사과']), W('book', ['책'])]);
  const g = () => page.eval(`(() => { const b = id => document.getElementById(id); const ic = id => { const e = b(id); return { label: e.getAttribute('aria-label'), text: e.textContent.trim(), svg: e.querySelectorAll('svg').length, stroke: getComputedStyle(e.querySelector('svg:not([hidden])') || e.querySelector('svg')).stroke, fill: getComputedStyle(e.querySelector('svg:not([hidden])') || e.querySelector('svg')).fill }; };
    return { back: ic('pvBack'), prev: ic('pvPrev'), next: ic('pvNext'), nextIcon: { arrow: !b('pvIcNext').hasAttribute('hidden'), play: !b('pvIcPlay').hasAttribute('hidden') }, skip: b('pvSkip').textContent.trim(), textButtons: [...document.querySelectorAll('#pv button')].filter(e => e.id !== 'pvMeanBtn' && e.textContent.trim()).map(e => e.id), prevDisabled: b('pvPrev').disabled }; })()`);
  let m = await g();
  assert.deepEqual([m.back.label, m.prev.label, m.next.label], ['돌아가기', '이전 단어', '다음 단어']);
  for (const k of ['back', 'prev', 'next']) { assert.equal(m[k].text, '', k + ' 은 글자 없음'); assert.ok(m[k].svg >= 1); assert.notEqual(m[k].stroke, 'none', k + ' 은 stroke 아이콘'); }
  assert.deepEqual(m.nextIcon, { arrow: true, play: false }); assert.equal(m.prevDisabled, true);
  assert.deepEqual(m.textButtons, ['pvSkip'], '글자 버튼은 [건너뛰기] 하나(뜻 영역 제외)');
  assert.equal(m.skip, '건너뛰기');
  await click(page, '#pvNext'); await waitFor(page, 'SpellRun.preview.state.idx === 1');
  m = await g();
  assert.equal(m.next.label, '게임 시작'); assert.deepEqual(m.nextIcon, { arrow: false, play: true }); assert.equal(m.prevDisabled, false);
  assert.equal(await page.eval("document.getElementById('pvNext').querySelector('svg:not([hidden])').id"), 'pvIcPlay');
  await click(page, '#pvPrev'); await waitFor(page, 'SpellRun.preview.state.idx === 0');
  assert.equal((await g()).next.label, '다음 단어', '되돌아가면 다시 화살표');
  await click(page, '#pvNext'); await waitFor(page, 'SpellRun.preview.state.idx === 1'); await click(page, '#pvNext');
  assert.equal(await page.eval('window.__ready'), 1, '재생 아이콘이 게임 시작(onReady)');
  await page.close();
});

test('414·419 뜻: 뜻이 여러 개면 번호 줄마다 모두 보인다(서로 다른 줄). 단어가 바뀌면 목록이 바뀐다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await openPv(page, [W('scrutinize', ['신중하게 검토하다', '자세히 살피다', '꼼꼼히 조사하다']), W('book', ['책'])]);
  const lines = () => page.eval("[...document.querySelectorAll('#pvMean .pvt')].map(e => e.textContent)");
  assert.deepEqual(await lines(), ['신중하게 검토하다', '자세히 살피다', '꼼꼼히 조사하다']);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#pvMean .pvn')].map(e => e.textContent)"), ['', '', ''], '작업422: 번호 글자 없음(불릿은 CSS 원)');
  const tops = await page.eval("[...document.querySelectorAll('#pvMean .pvt')].map(e => Math.round(e.getBoundingClientRect().top))");
  assert.equal(new Set(tops).size, 3, '줄바꿈으로 구분(서로 다른 줄)');
  await click(page, '#pvNext'); await waitFor(page, 'SpellRun.preview.state.idx === 1');
  assert.deepEqual(await lines(), ['책']);
  await page.close();
});

test('414 펼치기: 뜻 영역은 button, 눌러서 상세(정의·usage_note·보조 키워드 순)가 아래로 펼쳐지고 다시 누르면 접힌다. aria-expanded, "자세히"+화살표. 단어가 바뀌면 접힘. 상세가 없으면 펼치기 표시 없음', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await openPv(page, [W('apple', ['사과'], [{ def: '사과, 사과나무', note: '둥근 과일을 가리킵니다.' }], ['과일']), W('book', ['책'])]);
  const st = () => page.eval(`(() => ({ tag: document.getElementById('pvMeanBtn').tagName, exp: document.getElementById('pvMeanBtn').getAttribute('aria-expanded'), dis: document.getElementById('pvMeanBtn').disabled, more: !document.getElementById('pvMore').hidden && document.getElementById('pvMore').textContent.trim(), moreSvg: document.querySelectorAll('#pvMore svg').length, open: !document.getElementById('pvDetail').hidden, paras: [...document.querySelectorAll('#pvDetail p')].map(p => p.textContent), controls: document.getElementById('pvMeanBtn').getAttribute('aria-controls') }))()`);
  let s = await st();
  assert.deepEqual([s.tag, s.exp, s.dis, s.more, s.moreSvg, s.open, s.controls], ['BUTTON', 'false', false, '자세히', 1, false, 'pvDetail']);
  await click(page, '#pvMeanBtn');
  s = await st(); assert.equal(s.exp, 'true'); assert.equal(s.open, true);
  assert.deepEqual(s.paras, ['사과, 사과나무', '둥근 과일을 가리킵니다.', '과일'], '정의 → 쓰임 설명 → 보조 키워드');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#pvMore svg')).transform !== 'none'"), true, '펼치면 화살표가 돌아간다');
  await click(page, '#pvMeanBtn');
  s = await st(); assert.equal(s.exp, 'false'); assert.equal(s.open, false);
  await click(page, '#pvMeanBtn'); assert.equal((await st()).open, true);
  await click(page, '#pvNext'); await waitFor(page, 'SpellRun.preview.state.idx === 1');
  s = await st();
  assert.equal(s.open, false, '단어가 바뀌면 접힘'); assert.equal(s.dis, true, '상세가 없으면 누를 수 없다'); assert.equal(s.more, false, '"자세히" 표시 없음'); assert.equal(s.exp, null);
  await click(page, '#pvPrev'); await waitFor(page, 'SpellRun.preview.state.idx === 0');
  assert.equal((await st()).open, false, '돌아와도 접힌 채');
  noErrors(page); await page.close();
});

test('414 키보드: 버튼에 포커스가 있을 때 Space·Enter 는 한 번만 넘어가고, 포커스가 없을 때도 Space·Enter·→ 는 다음, ← 는 이전, Esc 는 돌아가기', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await openPv(page, Array.from({ length: 6 }, (_, i) => W('w' + i, ['뜻' + i])));
  const key = async (k, code, text) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text, windowsVirtualKeyCode: ({ ' ': 32, Enter: 13, ArrowRight: 39, ArrowLeft: 37, Escape: 27 })[k] }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: ({ ' ': 32, Enter: 13, ArrowRight: 39, ArrowLeft: 37, Escape: 27 })[k] }); await sleep(120); };
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'pvNext', '첫 포커스는 [다음]');
  await key(' ', 'Space', ' ');
  assert.equal(await idxOf(page), 1, '버튼 포커스에서 Space 는 한 번만(두 번 처리되지 않음)');
  await key('Enter', 'Enter', '\r');
  assert.equal(await idxOf(page), 2, '버튼 포커스에서 Enter 는 한 번만');
  await key('ArrowRight', 'ArrowRight'); assert.equal(await idxOf(page), 3);
  await key('ArrowLeft', 'ArrowLeft'); assert.equal(await idxOf(page), 2);
  await page.eval("document.activeElement.blur()");   // 포커스를 버튼 밖으로
  assert.equal(await page.eval("document.activeElement === document.body"), true);
  await key(' ', 'Space', ' '); assert.equal(await idxOf(page), 3, '포커스 없이 Space');
  await key('Enter', 'Enter', '\r'); assert.equal(await idxOf(page), 4, '포커스 없이 Enter');
  await key('ArrowRight', 'ArrowRight'); assert.equal(await idxOf(page), 5);
  await key('ArrowRight', 'ArrowRight');
  assert.equal(await page.eval('window.__ready'), 1, '마지막에서 →는 게임 시작');
  await openPv(page, [W('a', ['가']), W('b', ['나'])]);
  await key('ArrowLeft', 'ArrowLeft'); assert.equal(await idxOf(page), 0, '첫 단어에서 ←는 제자리');
  await key('Escape', 'Escape');
  assert.equal(await page.eval('window.__back'), 1, 'Esc 는 돌아가기'); assert.equal(await page.eval("document.getElementById('pv').hidden"), true);
  await key(' ', 'Space', ' '); await key('ArrowRight', 'ArrowRight');
  assert.equal(await page.eval('window.__ready'), 0, '미리 보기가 닫힌 뒤에는 키가 아무것도 하지 않는다(시작도 안 됨)');
  noErrors(page); await page.close();
});

test('414 연타: 빨리 여러 번 넘겨도 이전 단어의 늦은 발음이 겹쳐 재생되지 않는다(마지막 단어만 재생)', { skip: SKIP }, async () => {
  resetState(); state.ttsDelay = 150;
  const page = await browser.newPage({ width: 360, height: 640, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: AUDIO });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.removeItem('spellrun_preview'); } sessionStorage.setItem('spellrun_ids', JSON.stringify(${JSON.stringify(state.rows.map(r => r.id))})); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await startGame(page);
  await waitFor(page, "window.__plays === 1", 4000);   // 첫 단어 재생
  await page.eval("(() => { const b = document.getElementById('pvNext'); b.click(); b.click(); b.click(); b.click(); })()");
  await waitFor(page, 'SpellRun.preview.state.idx === 4');
  await sleep(1000);
  assert.equal(await page.eval('window.__plays'), 2, '첫 단어 + 마지막 단어만 재생(그 사이 단어의 늦은 응답은 버려짐): ' + await page.eval('window.__plays'));
  noErrors(page); await page.close();
});

test('414 새 호출 0: 미리 보기 중 서버로 나가는 요청은 발음(/api/tts)뿐이다(AI·단어장 저장 없음)', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await startGame(page); await walkToLast(page); await sleep(300);
  const mine = state.requests.filter(r => r.url !== '/api/tts');
  assert.deepEqual(mine.map(r => r.method + ' ' + r.url).sort(), ['GET /api/me', 'GET /api/wordbook'], '발음 외에는 화면을 열 때의 조회 2건뿐(AI·저장·수정 요청 없음)');
  await page.close();
});

test('414·419 데이터 연결: 단어장의 meanings[].pos·definition·usage_note 가 미리 보기에 쓰인다(품사별 번호 목록, 쓰임 설명, 중복 없는 상세)', { skip: SKIP }, async () => {
  resetState(); state.rows = richRows();
  const page = await openGame();
  await startGame(page);
  const w = await page.eval("document.getElementById('pvWord').textContent");
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#pvMean .pvpos')].map(e => e.textContent)"), ['명사', '동사'], '품사별로 묶임(pos 필드)');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#pvMean .pvt')].map(e => e.textContent)"), [w + ' 뜻, 보조뜻', '동사뜻'], '줄 = 그 뜻의 대응어');
  await click(page, '#pvMeanBtn');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#pvDetail p')].map(p => p.textContent)"), ['쓰임 설명입니다.'], '목록과 같은 정의·키워드는 상세에서 뺀다. usage_note 만 남음');
  await page.close();
});

// ───────── 배치(세로·가로) ─────────
const SIZES = [[360, 640], [390, 844], [800, 400], [640, 360], [844, 390]];
for (const [w, h] of SIZES) {
  test(`414 배치 ${w}x${h}: 카드가 넘치지 않고 가로 스크롤 없음, 버튼 44px 이상·겹침 0, 글자 11px 이상, 이모지 없음 (접힘·펼침·긴 상세·마지막 단어)`, { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ width: w, height: h, query: w > h ? '?mode=1' : '' });   // 가로 배치는 주소 mode=1(저장된 화면 모드)로 연다
    const M = () => page.eval(`(() => {
      const box = document.getElementById('box').getBoundingClientRect(), card = document.querySelector('#pv .card'), cr = card.getBoundingClientRect();
      const ids = ['pvBack', 'pvMeanBtn', 'pvPrev', 'pvNext', 'pvSkip'];
      const rs = ids.map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { id, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vis: getComputedStyle(e).visibility !== 'hidden' && r.width > 0 }; }).filter(x => x.vis);
      const inCard = rs.every(x => x.l >= cr.left - 0.5 && x.r <= cr.right + 0.5 && x.t >= cr.top - 0.5 && x.b <= cr.bottom + 0.5);
      let overlap = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) overlap++; }
      const texts = [...document.querySelectorAll('#pv *')].filter(e => e.children.length === 0 && e.textContent.trim() && e.getClientRects().length && !e.closest('.sr-only')).map(e => parseFloat(getComputedStyle(e).fontSize));
      const clip = [...document.querySelectorAll('#pv .pvw, #pv .pvt, #pv .pvd')].filter(e => e.getClientRects().length).some(e => e.scrollWidth > e.clientWidth + 1);
      return { overflow: Math.round(card.scrollHeight - card.clientHeight), inBox: cr.left >= box.left - 0.5 && cr.right <= box.right + 0.5 && cr.top >= box.top - 0.5 && cr.bottom <= box.bottom + 0.5, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth, cardX: card.scrollWidth - card.clientWidth,
        minBtn: Math.min(...rs.map(x => Math.min(x.w, x.h))), inCard, overlap, minFont: Math.min(...texts), clip, nextInCard: rs.some(x => x.id === 'pvNext'), text: document.getElementById('pv').innerText, land: document.getElementById('box').classList.contains('land') };
    })()`);
    const check = async (label) => {
      const m = await M();
      assert.ok(m.inBox, `${label}: 카드가 판 안 ${JSON.stringify(m)}`);
      assert.ok(m.overflow <= 1, `${label}: 카드 넘침 ${m.overflow}px`);
      assert.ok(m.docX <= 0 && m.cardX <= 0, `${label}: 가로 스크롤 없음`);
      assert.ok(m.inCard && m.nextInCard, `${label}: 모든 버튼이 카드 안에 보임`);
      assert.equal(m.overlap, 0, `${label}: 버튼 겹침`);
      assert.ok(m.minBtn >= 43.5, `${label}: 터치 영역 ${m.minBtn}px >= 44`);
      assert.ok(m.minFont >= 11 - 0.01, `${label}: 글자 ${m.minFont}px >= 11`);
      assert.ok(!m.clip, `${label}: 글자가 칸 밖으로 잘림`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(m.text), `${label}: 이모지 없음`);
      return m;
    };
    const words = [W('environment', ['환경', '주변 상황, 둘러싼 조건', '자연환경'], DETAIL_LONG, ['둘러싼', '조건', '생활환경']), W('incomprehensibilities', ['이해할 수 없음'], [])];
    await openPv(page, words);
    const a = await check('접힘'); assert.equal(a.land, w > h, '가로/세로 판정');
    await click(page, '#pvMeanBtn'); await check('펼침(긴 상세)');
    await click(page, '#pvNext'); await waitFor(page, 'SpellRun.preview.state.idx === 1'); await check('마지막 단어(긴 단어·재생 아이콘)');
    noErrors(page); await page.close();
  });
}

test('414 디자인: 카드 안에 박스·테두리·구분선·그림자가 없고(주 버튼의 코랄 번짐 제외), 카드 바깥 모양은 382 시작 카드와 같다. 글자 위계 단어 > 짧은 뜻 > 보조, 주 버튼은 코랄 채움 원형', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await openPv(page, [W('apple', ['사과', '애플'], [{ def: '사과, 애플', note: '쓰임' }], ['과일']), W('book', ['책'])]);
  await click(page, '#pvMeanBtn');
  const d = await page.eval(`(() => {
    const cs = e => getComputedStyle(e), card = document.querySelector('#pv .card'), cc = cs(card), start = cs(document.querySelector('#start .card'));
    const inner = [...card.querySelectorAll('*')].filter(e => e.getClientRects().length && !e.closest('svg') && e.tagName !== 'svg');
    const bad = inner.filter(e => { const c = cs(e); return parseFloat(c.borderTopWidth) + parseFloat(c.borderBottomWidth) + parseFloat(c.borderLeftWidth) + parseFloat(c.borderRightWidth) > 0 || (c.backgroundColor !== 'rgba(0, 0, 0, 0)' && !e.classList.contains('pvgo') && !e.classList.contains('pvn')) || (c.boxShadow !== 'none' && !e.classList.contains('pvgo')) || c.borderTopLeftRadius !== '0px' && !e.classList.contains('pvgo') && !e.classList.contains('pvx') && !e.classList.contains('pvic') && !e.classList.contains('pvn'); }).map(e => e.id || e.className);
    const px = sel => parseFloat(cs(document.querySelector(sel)).fontSize);
    const go = cs(document.getElementById('pvNext'));
    const pos = (a, b) => document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0;
    return { bad, card: { bw: cc.borderTopWidth, rad: cc.borderTopLeftRadius, shadow: cc.boxShadow, bg: cc.backgroundColor }, start: { bw: start.borderTopWidth, rad: start.borderTopLeftRadius, shadow: start.boxShadow, bg: start.backgroundColor },
      sizes: { prog: px('#pvProg'), word: px('#pvWord'), mean: px('.pvt'), more: px('#pvMore'), detail: px('.pvd'), note: px('#pvNote'), skip: px('#pvSkip') },
      go: { bg: go.backgroundColor, rad: go.borderTopLeftRadius, bw: go.borderTopWidth }, order: [pos('#pvProg', '#pvWord'), pos('#pvWord', '#pvMean'), pos('#pvMean', '#pvDetail'), pos('#pvDetail', '#pvNext'), pos('#pvNext', '#pvSkip')],
      ghost: ['pvBack', 'pvPrev'].map(id => { const c = cs(document.getElementById(id)); return [c.backgroundColor, c.borderTopWidth]; }), skipBorder: cs(document.getElementById('pvSkip')).borderTopWidth, vis: ['pvBack', 'pvPrev'].map(id => cs(document.getElementById(id)).visibility) };
  })()`);
  console.log('[414 측정] ' + JSON.stringify(d.sizes) + ' 카드 ' + JSON.stringify(d.card));
  assert.deepEqual(d.bad, [], '카드 안의 박스·테두리·배경·그림자: ' + d.bad);
  assert.equal(d.card.bw, d.start.bw, '카드 테두리 = 시작 카드(2px)'); assert.equal(d.card.bw, '2px'); assert.equal(d.card.rad, d.start.rad); assert.equal(d.card.rad, '22px'); assert.equal(d.card.shadow, d.start.shadow); assert.equal(d.card.bg, 'rgb(255, 255, 255)');
  assert.ok(d.sizes.word > d.sizes.mean && d.sizes.mean > d.sizes.detail && d.sizes.detail >= d.sizes.more - 0.01 && d.sizes.more >= d.sizes.note - 0.01, '글자 위계 단어 > 짧은 뜻 > 상세 >= 보조 ' + JSON.stringify(d.sizes));
  assert.deepEqual(d.go, { bg: 'rgb(255, 107, 90)', rad: '50%', bw: '0px' }, '주 버튼: 코랄 #ff6b5a 채움, 모서리 50%, 테두리 없음');
  assert.deepEqual(d.order, [1, 1, 1, 1, 1], '위→아래 순서: 진행 → 단어 → 뜻 → 상세 → 아이콘 → 건너뛰기');
  assert.deepEqual(d.ghost, [['rgba(0, 0, 0, 0)', '0px'], ['rgba(0, 0, 0, 0)', '0px']], '이전·닫기는 테두리 없는 아이콘'); assert.equal(d.skipBorder, '0px');
  await page.close();
});

// ───────── 작업419: 상세 겹침 수정 · 품사별 번호 목록 · 왼쪽 기준선 · 글자 위계 ─────────
const FEATURE_PV = G('feature', [{ pos: '명사', lines: ['특징, 특성', '얼굴 부위, 눈/코/입 등', '기획기사, 특집'] }, { pos: '동사', lines: ['주요 역할을 하다'] }],
  [{ def: '', note: '어떤 것의 눈에 띄는 부분을 가리킬 때 쓰는 말입니다. 신문이나 방송에서는 기획 기사를 뜻하기도 합니다. 길게 이어지는 설명 문장입니다. 길게 이어지는 설명 문장입니다.' }, { def: '', note: '두 번째 쓰임 설명도 이어서 길게 적혀 있는 경우를 가정한 문장입니다. 낮은 화면에서도 카드 안에서만 스크롤됩니다.' }, { def: '', note: '세 번째 쓰임 설명입니다. 상세가 길어도 뜻 목록과 겹치지 않아야 합니다. 상세가 길어도 뜻 목록과 겹치지 않아야 합니다.' }], ['두드러진 부분', '특집 기사']);
const LOW = [[960, 460, '?mode=1'], [640, 360, '?mode=1'], [844, 390, '?mode=1'], [390, 844, ''], [360, 640, '']];

for (const [w, h, q] of LOW) {
  test(`419 겹침 ${w}x${h}: 상세를 열어도 뜻 목록 아래로 이어 붙고(겹침 없음) 카드 안에서만 스크롤. [자세히]·넘김·X·건너뛰기가 보이고 눌린다`, { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ width: w, height: h, query: q });
    await openPv(page, [FEATURE_PV, W('b', ['책'])]);
    const closed = await page.eval(`(() => { const main = document.querySelector('.pvmain').getBoundingClientRect(), more = document.getElementById('pvMore').getBoundingClientRect(); return { moreVisible: more.top >= main.top - 0.5 && more.bottom <= main.bottom + 0.5, main: { t: main.top, b: main.bottom }, more: { t: more.top, b: more.bottom } }; })()`);
    assert.ok(closed.moreVisible, `접힘: [자세히]가 영역 안에 보임 ${JSON.stringify(closed)}`);
    await click(page, '#pvMeanBtn');
    const m = await page.eval(`(() => {
      const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
      const mean = r('pvMean'), btn = r('pvMeanBtn'), det = r('pvDetail'), word = r('pvWord'), main = document.querySelector('.pvmain'), mr = main.getBoundingClientRect(), cardEl = document.querySelector('#pv .card'), card = cardEl.getBoundingClientRect(), box = document.getElementById('box').getBoundingClientRect();
      const ctl = ['pvBack', 'pvNext', 'pvSkip'].map(id => { const e = document.getElementById(id), b = e.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2, hit = document.elementFromPoint(cx, cy); return { id, inCard: b.left >= card.left - 0.5 && b.right <= card.right + 0.5 && b.top >= card.top - 0.5 && b.bottom <= card.bottom + 0.5, hit: hit === e || e.contains(hit), overMain: b.left < mr.right - 0.5 && mr.left < b.right - 0.5 && b.top < mr.bottom - 0.5 && mr.top < b.bottom - 0.5 }; });
      const rows = [...document.querySelectorAll('#pvMean .pvt')].map(e => e.getBoundingClientRect());
      return { meanBottomVsDetailTop: det.t - btn.b, wordBottomVsMeanTop: mean.t - word.b, mainScroll: main.scrollHeight - main.clientHeight, cardOver: Math.round(cardEl.scrollHeight - cardEl.clientHeight), docX: document.documentElement.scrollWidth - document.documentElement.clientWidth, ctl, inBox: card.left >= box.left - 0.5 && card.right <= box.right + 0.5 && card.top >= box.top - 0.5 && card.bottom <= box.bottom + 0.5, rowsOverlap: rows.some((a, i) => rows.slice(i + 1).some(b => a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5)) };
    })()`);
    assert.ok(m.meanBottomVsDetailTop >= -0.5, `뜻 목록 영역의 하단 ≤ 상세 영역의 상단 (차이 ${m.meanBottomVsDetailTop}px)`);
    assert.ok(m.wordBottomVsMeanTop >= -0.5, '단어와 뜻 목록이 겹치지 않음');
    assert.equal(m.rowsOverlap, false, '뜻 줄끼리 겹침 없음');
    assert.ok(m.cardOver <= 1, '카드 자체는 넘치지 않음(스크롤은 안쪽 영역)'); assert.ok(m.docX <= 0, '가로 스크롤 없음'); assert.ok(m.inBox);
    for (const c of m.ctl) { assert.ok(c.inCard, c.id + ' 카드 안'); assert.ok(c.hit, c.id + ' 가려지지 않고 눌림'); assert.equal(c.overMain, false, c.id + ' 은 읽기 영역과 겹치지 않음'); }
    // 안쪽 영역을 끝까지 내려도 겹치지 않고, 마지막 상세 줄까지 닿는다
    await page.eval("(() => { const m = document.querySelector('.pvmain'); m.scrollTop = m.scrollHeight; })()");
    const end = await page.eval(`(() => { const m = document.querySelector('.pvmain').getBoundingClientRect(), ps = [...document.querySelectorAll('#pvDetail .pvd')], last = ps[ps.length - 1].getBoundingClientRect(); return { lastInside: last.bottom <= m.bottom + 1, n: ps.length }; })()`);
    assert.ok(end.lastInside, '끝까지 스크롤하면 마지막 상세 줄이 영역 안에 보임'); assert.equal(end.n, 4, '상세: 쓰임 설명 3 + 보조 키워드 1');
    noErrors(page); await page.close();
  });
}

for (const [w, h, q] of [[960, 460, '?mode=1'], [390, 844, ''], [844, 390, '?mode=1']]) {
  test(`419 정렬 ${w}x${h}: 단어·품사 줄·뜻 목록·[자세히]·상세가 같은 왼쪽 기준선(번호 열 제외 ±2px), 읽기 칼럼 폭 ≤ 560, 가로 스크롤 없음`, { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ width: w, height: h, query: q });
    await openPv(page, [FEATURE_PV, W('b', ['책'])]);
    await click(page, '#pvMeanBtn');
    const a = await page.eval(`(() => { const L = sel => [...document.querySelectorAll(sel)].map(e => Math.round(e.getBoundingClientRect().left * 10) / 10), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')), main = document.querySelector('.pvmain').getBoundingClientRect(), col = document.querySelector('.pvcol').getBoundingClientRect(), card = document.querySelector('#pv .card').getBoundingClientRect(), prog = document.getElementById('pvProg').getBoundingClientRect(), skip = document.getElementById('pvSkip').getBoundingClientRect();
      return { word: L('#pvWord'), pos: L('#pvMean .pvpos'), nums: L('#pvMean .pvn'), texts: L('#pvMean .pvt'), more: L('#pvMore'), detail: L('#pvDetail .pvd'), colW: col.width, mainW: document.querySelector('.pvmain').clientWidth, mainL: main.left, mainR: main.left + document.querySelector('.pvmain').clientWidth, u, colL: col.left, colR: col.right, cardL: card.left, cardR: card.right, progL: prog.left, skipL: skip.left, skipB: skip.bottom, cardB: card.bottom, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth, textAlign: getComputedStyle(document.querySelector('.pvcol')).textAlign }; })()`);
    const base = a.word[0], near = (x, y) => Math.abs(x - y) <= 2;
    for (const [k, arr] of [['품사', a.pos], ['번호', a.nums], ['[자세히]', a.more], ['상세', a.detail]]) for (const x of arr) assert.ok(near(x, base), `${k} 왼쪽 ${x} vs 기준선 ${base}`);
    assert.ok(a.texts.every(x => near(x, a.texts[0])), '뜻 글자는 같은 열(번호 열 오른쪽): ' + a.texts); assert.ok(a.texts[0] > base, '번호 열만큼 들여 시작');
    assert.ok(a.colW <= 560 * a.u + 1, `읽기 칼럼 폭 ${a.colW} ≤ 560u`); assert.equal(a.textAlign, 'left'); assert.ok(a.docX <= 0);
    assert.ok(Math.abs((a.colL - a.mainL) - (a.mainR - a.colR)) <= 2, '칼럼이 읽기 영역 가운데(세로 화면에서는 카드 가운데, 가로에서는 넘김 버튼을 뺀 왼쪽 영역 가운데)');
    if (h > w) assert.ok(Math.abs((a.colL - a.cardL) - (a.cardR - a.colR)) <= 2, '세로: 칼럼이 카드 가운데'); assert.ok(near(a.skipL, a.progL), `[건너뛰기]가 순번과 같은 왼쪽 가장자리 ${a.skipL} vs ${a.progL}`); assert.ok(a.cardB - a.skipB <= 24 * a.u + 12, '[건너뛰기]는 카드 아래쪽');
    if (w === 390) assert.ok(a.colW >= a.mainW - 18, '390px 에서는 칼럼이 읽기 영역 폭을 채운다(좌우 여백만, 스크롤바 여유 18px): ' + a.colW + ' / ' + a.mainW);
    noErrors(page); await page.close();
  });
}

test('419 품사별 번호 목록: feature 형태는 품사 줄 2개(명사·동사)와 품사별 불릿(번호 없음), 문구 일치. 품사 없는 데이터는 번호만. 짧은 뜻만 있는 옛 단어는 번호 한 줄. 긴 문장 정의도 깨지지 않는다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ width: 390, height: 844 });
  const LONG = '무언가를 매우 자세하고 신중하게 살펴보거나 검토하다 또한 철저히 조사하는 일을 가리키며 문서나 계약 조건 같은 것을 꼼꼼히 확인할 때에도 널리 쓰이는 표현';
  await openPv(page, [FEATURE_PV, W('scrutinize', ['신중하게 검토하다', '정밀 조사하다']), W('old', ['사과']), G('long', [{ pos: '동사', lines: [LONG] }])]);
  const dump = () => page.eval(`(() => ({ pos: [...document.querySelectorAll('#pvMean .pvpos')].map(e => e.textContent), groups: [...document.querySelectorAll('#pvMean .pvgrp')].map(g => [...g.querySelectorAll('.pvrow')].map(r => (r.querySelector('.pvn') ? '•' : '-') + ' ' + r.querySelector('.pvt').textContent)), clip: [...document.querySelectorAll('#pv .pvt, #pv .pvw')].some(e => e.scrollWidth > e.clientWidth + 1), docX: document.documentElement.scrollWidth - document.documentElement.clientWidth }))()`);
  let d = await dump();
  assert.deepEqual(d.pos, ['명사', '동사']);
  assert.deepEqual(d.groups, [['• 특징, 특성', '• 얼굴 부위, 눈/코/입 등', '• 기획기사, 특집'], ['• 주요 역할을 하다']], '품사별 번호는 각각 1부터');
  await next(page); d = await dump();
  assert.deepEqual(d.pos, [], '품사 없는 데이터에는 품사 줄이 없다'); assert.deepEqual(d.groups, [['• 신중하게 검토하다', '• 정밀 조사하다']]);
  await next(page); d = await dump(); assert.deepEqual(d.groups, [['• 사과']], '짧은 뜻만 있는 옛 단어는 번호 한 줄');
  await next(page); d = await dump();
  assert.deepEqual(d.pos, ['동사']); assert.deepEqual(d.groups, [['• ' + LONG]], '긴 문장은 그대로 줄바꿈'); assert.equal(d.clip, false, '글자가 칸 밖으로 잘리지 않음'); assert.ok(d.docX <= 0);
  const lines = await page.eval("Math.round(document.querySelector('#pvMean .pvt').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('#pvMean .pvt')).lineHeight))");
  assert.ok(lines >= 2, '긴 문장은 여러 줄로 감긴다: ' + lines);
  const hang = await page.eval("(() => { const n = document.querySelector('#pvMean .pvn').getBoundingClientRect(), t = document.querySelector('#pvMean .pvt').getBoundingClientRect(); return { numRight: n.right, textLeft: t.left }; })()");
  assert.ok(hang.textLeft >= hang.numRight - 0.5, '내어쓰기: 번호 열 오른쪽에서 뜻이 시작(줄이 감겨도 같은 열)');
  noErrors(page); await page.close();
});

test('419 상세 중복 없음: 목록에 보인 정의·키워드는 상세에 다시 나오지 않는다', { skip: SKIP }, async () => {
  resetState(); state.rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, word: WORDS[i], lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: WORDS[i], lang: 'en', short_meaning: '특징, 얼굴 부위', meanings: [{ pos: 'noun', definition: '특징, 특성, 두드러진 부분', usage_note: '눈에 띄는 부분입니다.' }, { pos: 'noun', definition: '얼굴 부위, 눈/코/입 등' }] } }));
  const page = await openGame();
  await startGame(page);
  await click(page, '#pvMeanBtn');
  const t = await page.eval("({ list: [...document.querySelectorAll('#pvMean .pvt')].map(e => e.textContent), detail: [...document.querySelectorAll('#pvDetail .pvd')].map(e => e.textContent) })");
  assert.deepEqual(t.list, ['특징, 특성, 두드러진 부분', '얼굴 부위, 눈/코/입 등']);
  assert.deepEqual(t.detail, ['눈에 띄는 부분입니다.'], '같은 정의·키워드 반복 없음(usage_note 만)');
  await page.close();
});

test('419 글자 위계: 단어가 가장 크고 굵고 진하다 > 뜻(500·연한 색) > 상세(400·더 작음), 품사 이름은 작은 보조 글자, 번호는 뜻보다 연하다. 구분선·박스 없음', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame({ width: 390, height: 844 });
  await openPv(page, [FEATURE_PV, W('b', ['책'])]);
  await click(page, '#pvMeanBtn');
  const s = await page.eval(`(() => { const c = sel => getComputedStyle(document.querySelector(sel)), lum = col => { const m = col.match(/[\\d.]+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const w = c('#pvWord'), t = c('#pvMean .pvt'), p = c('#pvMean .pvpos'), n = c('#pvMean .pvn'), d = c('#pvDetail .pvd'), more = c('#pvMore');
    const bad = [...document.querySelectorAll('#pv .pvcol *')].filter(e => e.getClientRects().length && !e.closest('svg') && e.tagName !== 'svg').filter(e => { const k = getComputedStyle(e); return parseFloat(k.borderTopWidth) + parseFloat(k.borderBottomWidth) + parseFloat(k.borderLeftWidth) + parseFloat(k.borderRightWidth) > 0 || k.boxShadow !== 'none' || (k.backgroundColor !== 'rgba(0, 0, 0, 0)' && !e.classList.contains('pvn')); }).map(e => String(e.className));   // 작업422: 불릿(.pvn) 제외
    return { word: { px: parseFloat(w.fontSize), wt: Number(w.fontWeight), col: w.color, lum: lum(w.color) }, mean: { px: parseFloat(t.fontSize), wt: Number(t.fontWeight), col: t.color, lum: lum(t.color) }, pos: { px: parseFloat(p.fontSize), col: p.color }, num: { op: parseFloat(n.opacity), col: n.color, px: parseFloat(n.fontSize) }, detail: { px: parseFloat(d.fontSize), wt: Number(d.fontWeight), col: d.color }, more: parseFloat(more.fontSize), bad }; })()`);
  console.log('[419 위계 측정] ' + JSON.stringify({ word: s.word, mean: s.mean, pos: s.pos, num: s.num, detail: s.detail }));
  assert.ok(s.word.px > s.mean.px && s.mean.px > s.detail.px, '크기 단어 > 뜻 > 상세'); assert.ok(s.word.wt >= 700, '단어 굵기 700 이상'); assert.equal(s.mean.wt, 500); assert.ok(s.detail.wt < s.mean.wt, '상세는 더 가늘게');
  assert.ok(s.mean.lum > s.word.lum, '뜻은 단어보다 연한 색'); assert.ok(s.pos.px >= 11 && s.pos.px <= 13 && s.pos.px < s.mean.px, '품사 이름은 작은 보조 글자 ' + s.pos.px); assert.equal(s.pos.col, s.mean.col, '품사는 보조 글자색');
  assert.ok(s.num.op < 1 && s.num.px <= s.mean.px, '번호는 뜻보다 연하게(투명도)'); assert.deepEqual(s.bad, [], '읽기 칼럼 안에 구분선·박스·그림자 없음: ' + s.bad);
  await page.close();
});

// ───────── 작업422: 뜻 목록 번호 → 불릿(CSS 로 그린 작은 원) ─────────
for (const [w, h] of [[390, 844], [960, 460]]) {
  test(`422 불릿 ${w}x${h}: 번호 글자 없음·불릿 수 = 뜻 수(품사 있음·없음·뜻 하나·옛 단어), 장식(aria-hidden), 지름 4~5px 원, 뜻보다 연한 색, 뜻 시작점 일정(줄바꿈 포함), 겹침·가로 스크롤 없음`, { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ width: w, height: h });
    const LONG = '무언가를 매우 자세하고 신중하게 살펴보거나 검토하다 또한 철저히 조사하는 일을 가리키며 문서나 계약 조건 같은 것을 꼼꼼히 확인할 때에도 널리 쓰이는 표현';
    await openPv(page, [FEATURE_PV, W('scrutinize', ['신중하게 검토하다', '정밀 조사하다']), W('old', ['사과']), G('long', [{ pos: '동사', lines: [LONG, '짧은 뜻'] }])]);
    const expectCounts = [4, 2, 1, 2];
    for (let i = 0; i < expectCounts.length; i++) {
      const m = await page.eval(`(() => { const rows = [...document.querySelectorAll('#pvMean .pvrow')], hid = [...document.querySelectorAll('#pvMean .pvn')].every(e => e.getAttribute('aria-hidden') === 'true'),
        text = document.getElementById('pvMean').textContent, bs = rows.map(r => { const b = r.querySelector('.pvn'), k = getComputedStyle(b), t = r.querySelector('.pvt'), tb = t.getBoundingClientRect(), bb = b.getBoundingClientRect(); return { w: bb.width, h: bb.height, rad: k.borderRadius, op: parseFloat(k.opacity), bg: k.backgroundColor, tl: Math.round(tb.left * 10) / 10, br: bb.right, bl: Math.round(bb.left * 10) / 10, bc: (bb.top + bb.bottom) / 2, tt: tb.top, tfs: parseFloat(getComputedStyle(t).lineHeight) }; });
        return { n: rows.length, hid, numText: /\d\./.test(text), bs, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth, tc: getComputedStyle(document.querySelector('#pvMean .pvt')).color }; })()`);
      assert.equal(m.n, expectCounts[i], `불릿 수 = 뜻 수 (${i})`); assert.ok(m.hid, '불릿은 장식(aria-hidden)'); assert.equal(m.numText, false, '번호 텍스트(1. 2.) 없음');
      for (const b of m.bs) {
        assert.ok(b.w >= 3.9 && b.w <= 5.1 && Math.abs(b.w - b.h) < 0.2, `지름 4~5px ${b.w}x${b.h}`); assert.equal(b.rad, '50%'); assert.ok(b.op < 1, '뜻보다 연함');
        assert.ok(b.br <= b.tl + 0.5, '불릿은 뜻 시작점 왼쪽'); assert.ok(Math.abs(b.bc - (b.tt + b.tfs / 2)) <= 4, `불릿이 뜻 첫 줄 가운데: ${b.bc} vs ${b.tt + b.tfs / 2}`);
      }
      assert.ok(m.bs.every(b => Math.abs(b.tl - m.bs[0].tl) <= 0.5) && m.bs.every(b => Math.abs(b.bl - m.bs[0].bl) <= 0.5), '불릿 열·뜻 시작점이 일정');
      assert.ok(m.docX <= 0, '가로 스크롤 없음');
      if (i < expectCounts.length - 1) await next(page);
    }
    const wrap = await page.eval("(() => { const t = document.querySelector('#pvMean .pvt'), h = t.getBoundingClientRect().height, lh = parseFloat(getComputedStyle(t).lineHeight); return { lines: Math.round(h / lh) }; })()");
    assert.ok(wrap.lines >= 2 || w > 390, '390 폭에서 긴 뜻은 여러 줄로 감긴다(시작점은 위에서 확인): ' + wrap.lines);
    noErrors(page); await page.close();
  });
}
