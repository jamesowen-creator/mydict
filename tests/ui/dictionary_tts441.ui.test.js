// 작업441·442: 사전 발음 방식 옵션(기본 기기 음성, tts=server|device|reset)과 빈 음성·재생 실패 시 기기 음성 대체. 하니스는 dictionary_tts.ui.test.js 와 같다.
// (원래 설명) 작업335: 사전의 발음 버튼(playTTS)·미리 받기(prefetchTTS)가 로그인 헤더를 보내고, 서버 발음을 쓸 수 없으면 기기 내장 음성(speechSynthesis)으로 읽는다.
// 자체 임시 서버(정적 파일 + 모의 /api/tts·/api/me, AI·DB·운영 서버·실제 OpenAI 와 무관). speechSynthesis·오디오 재생·8초 시간 제한은 페이지 안에서 모의한다.
// 확인: 토큰 있음→Authorization 헤더 / 토큰 없음→서버 요청 0건 + 기기 음성 / 401·403·429→기기 음성 + 이번 방문 서버 요청 중단 / 시간 초과·500→그 호출만 대체, 다음 호출은 서버 재시도 /
//       안내 토스트 방문당 1번 / prefetch 의 토큰 없음·서버 꺼짐 시 요청 0건 / 서버 성공 경로 불변 / 기기 음성이 없으면 기존 오류 토스트 / 팟캐스트 코드 불변
// 실행: node --test tests/ui/dictionary_tts.ui.test.js   (Chrome이 없으면 건너뜀)
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
const WAV = (() => { const n = 800, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();

let srv, base, browser;
const state = { reqs: [], plan: [], gateOff: false };   // plan: 호출마다 앞에서 하나씩 꺼내 쓴다 { status, delay, body }. 비면 200 오디오
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (state.gateOff && u === '/js/common/authGate.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('/* 작업405: 이 시험은 게이트 없이 화면 자체 동작을 본다(게이트는 auth_gate.ui.test.js) */'); }
    if (u.startsWith('/api/')) {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', () => {
        if (u === '/api/tts') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          state.reqs.push({ auth: req.headers.authorization || null, type: req.headers['content-type'], body });
          const p = state.plan.shift() || { status: 200 };
          const send = () => { if (p.status === 200) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(p.empty ? Buffer.alloc(0) : WAV); } else json(p.status, p.body || { error: '모의 오류 ' + p.status }); };
          return p.delay ? setTimeout(send, p.delay) : send();
        }
        if (u === '/api/me') return json(200, { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true });
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

// 페이지 안 모의: 기기 음성(speak 기록, 곧 끝남)·오디오 재생(곧 끝남)·8초 제한을 0.15초로 줄임. speech=false 면 기기 음성 자체가 없다
const MOCKS = speech => `(() => {
  window.__spoken = [];
  ${speech ? `window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speaking: false, cancel() {}, getVoices: () => [], speak(u) { window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); setTimeout(() => { if (u.onend) u.onend(); }, 40); } } });`
    : `Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); window.SpeechSynthesisUtterance = undefined;`}
  HTMLMediaElement.prototype.play = function () { window.__played = (window.__played || 0) + 1; setTimeout(() => { if (this.onended) this.onended(); }, 40); return Promise.resolve(); };
  const st = window.setTimeout; window.setTimeout = function (f, ms, ...a) { return st.call(window, f, ms === 8000 ? 150 : ms, ...a); };
})();`;

async function open({ token = true, speech = true, query = '', pre = '' } = {}) {
  state.reqs.length = 0; state.plan.length = 0;
  state.gateOff = !token;   // 작업405: 토큰 없는 상태의 화면 동작을 보는 시험은 게이트 없이 연다(게이트는 auth_gate.ui.test.js)
  const page = await browser.newPage({ width: 390, height: 844, token: 'x' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCKS(speech) });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: token ? `try { localStorage.setItem('mydict_token', ${JSON.stringify(TOKEN)}); } catch (e) {}` : "try { localStorage.removeItem('mydict_token'); } catch (e) {}" });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('metis_tts_mode'); } catch (e) {}" });   // 앞 시험이 저장한 값이 남지 않게(같은 브라우저 저장소)
  if (pre) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: pre });
  await page.goto(base + '/english_dictionary.html' + query);
  await page.waitFor("typeof playTTS === 'function' && typeof prefetchTTS === 'function' && !!document.querySelector('.metis-app-header-logo')", 12000);
  // 토스트 호출 기록(화면 모양은 그대로, 기존 showToast 를 감싸 기록만 한다)
  await page.eval("window.__toasts = []; (() => { const o = showToast; showToast = function (m) { window.__toasts.push(m); return o(m); }; })()");
  // 발음 버튼 하나를 화면에 붙인다(사전이 만드는 버튼과 같은 구조)
  await page.eval(`(() => { const b = document.createElement('button'); b.className = 'tts-btn'; b.id = 'tb'; b.innerHTML = '<span class="tts-icon">x</span><span class="tts-label">발음</span>'; b.dataset.lang = 'en'; document.body.appendChild(b); })()`);
  return page;
}
const play = (page, text, lang = 'en') => page.eval(`playTTS(${JSON.stringify(text)}, ${JSON.stringify(lang)}, document.getElementById('tb'))`);
// playTTS·prefetchTTS 는 page.eval 이 끝날 때까지(응답·대체 재생 시작) 기다린 뒤, 버튼이 "재생 중"에서 돌아오기를(오디오·기기 음성 모의가 끝나기를) 조건으로 기다린다. 고정 시간 대기는 쓰지 않아 부하에도 흔들리지 않는다
const settle = async (page) => { await sleep(10); await page.waitFor("!document.getElementById('tb') || !document.getElementById('tb').classList.contains('playing')", 6000); };
const info = page => page.eval("({ spoken: window.__spoken, toasts: window.__toasts, played: window.__played || 0, icon: document.querySelector('#tb .tts-icon').textContent, playing: document.getElementById('tb').classList.contains('playing') })");


test('442 기본(저장값 없음): 단어 발음 버튼·미리 받기는 /api/tts 요청 0건, 기기 음성(0.85), 안내 토스트·표시 줄 없음', { skip: SKIP }, async () => {
  const page = await open();
  assert.equal(await page.eval("document.getElementById('tts-mode-note').hidden"), true, '기본에서는 표시 없음');
  await play(page, 'snobbish'); await settle(page);
  await page.eval("prefetchTTS('apple', 'en')");
  assert.equal(state.reqs.length, 0, '서버 요청 없음');
  const i = await info(page);
  assert.deepEqual(i.spoken, [{ text: 'snobbish', lang: 'en-US', rate: 0.85 }]); assert.deepEqual(i.toasts, [], '기본 방식이라 대체 안내 토스트 없음'); assert.equal(i.playing, false);
  for (const [text, lang, want] of [['사과', 'ko', 'ko-KR'], ['りんご', 'ja', 'ja-JP'], ['苹果', 'zh', 'zh-CN']]) { await play(page, text, lang); await settle(page); const sp = (await info(page)).spoken; assert.deepEqual(sp[sp.length - 1], { text, lang: want, rate: 0.85 }); }
  assert.equal(state.reqs.length, 0);
  await page.close();
});

test('442 기기에 음성 기능이 없으면 서버 음성으로 이어진다(기본이어도 단어가 무음이 되지 않는다)', { skip: SKIP }, async () => {
  const page = await open({ speech: false });
  await play(page, 'apple'); await settle(page);
  assert.equal(state.reqs.length, 1); assert.equal((await info(page)).played, 1);
  await page.close();
});

test('442 ?tts=server: 단어도 서버 음성(표시 한 줄 "서버 음성", 저장되어 주소 없이도 유지), 표시를 누르면 기본으로 돌아가고, ?tts=reset 은 저장값을 지운다', { skip: SKIP }, async () => {
  let page = await open({ query: '?tts=server' });
  assert.equal(await page.eval("document.getElementById('tts-mode-note').hidden"), false);
  assert.match(await page.eval("document.getElementById('tts-mode-note').textContent"), /서버 음성/);
  assert.ok(await page.eval("parseFloat(getComputedStyle(document.getElementById('tts-mode-note')).fontSize) >= 11"), '글자 11px 이상');
  await play(page, 'apple'); await settle(page);
  assert.equal(state.reqs.length, 1, '서버 요청'); assert.deepEqual((await info(page)).spoken, []);
  assert.equal(await page.eval("localStorage.getItem('metis_tts_mode')"), 'server');
  await page.close();
  page = await open({ pre: "try { localStorage.setItem('metis_tts_mode', 'server'); } catch (e) {}" });   // 주소 없이 저장값만
  await play(page, 'banana'); await settle(page);
  assert.equal(state.reqs.length, 1, '저장값만으로 서버 방식');
  await page.eval("document.getElementById('tts-mode-note').click()");
  assert.equal(await page.eval("document.getElementById('tts-mode-note').hidden"), true); assert.equal(await page.eval("localStorage.getItem('metis_tts_mode')"), null);
  await play(page, 'cherry'); await settle(page);
  assert.equal(state.reqs.length, 1, '해제하면 기본(기기 음성)'); assert.equal((await info(page)).spoken.length, 1);
  await page.close();
  page = await open({ pre: "try { localStorage.setItem('metis_tts_mode', 'server'); } catch (e) {}", query: '?tts=reset' });
  assert.equal(await page.eval("localStorage.getItem('metis_tts_mode')"), null);
  assert.equal(await page.eval("document.getElementById('tts-mode-note').hidden"), true);
  await play(page, 'apple'); await settle(page);
  assert.equal(state.reqs.length, 0, 'reset 뒤에는 기본(기기 음성)');
  await page.close();
});

test('442 저장소가 막혀 있어도 예외 없이 동작한다(?tts=server 는 이번 방문에 적용, 해제도 예외 없음)', { skip: SKIP }, async () => {
  const block = "(() => { const g = Storage.prototype.getItem, st = Storage.prototype.setItem, rm = Storage.prototype.removeItem; Storage.prototype.getItem = function (k) { if (k === 'metis_tts_mode') throw new Error('blocked'); return g.apply(this, arguments); }; Storage.prototype.setItem = function (k) { if (k === 'metis_tts_mode') throw new Error('blocked'); return st.apply(this, arguments); }; Storage.prototype.removeItem = function (k) { if (k === 'metis_tts_mode') throw new Error('blocked'); return rm.apply(this, arguments); }; })();";
  const page = await open({ pre: block, query: '?tts=server' });
  await play(page, 'snobbish'); await settle(page);
  assert.equal(state.reqs.length, 1);
  await page.eval("document.getElementById('tts-mode-note').click()");
  assert.deepEqual(page.errors.filter(e => /blocked/.test(e)), []);
  await page.close();
});

test('442 팟캐스트(문장·예문 포함 긴 텍스트)는 옵션과 상관없이 서버 음성을 쓴다 — 기본(기기 음성)에서도 /api/tts 요청이 간다', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval(`(() => { podcastPlaying = true; podcastSegments = [{ text: 'This is an example sentence.', lang: 'en' }]; podcastSegIdx = 0; _podcastPlayNextSeg(); return 1; })()`);
  await page.waitFor("window.__played >= 1", 5000);
  assert.equal(state.reqs.length, 1, '문장은 서버 요청'); assert.equal(state.reqs[0].body.text, 'This is an example sentence.');
  assert.deepEqual((await info(page)).spoken, []);
  await page.close();
});

test('441 빈 음성(0바이트 응답)은 무음으로 끝나지 않고 기기 음성으로 대신하며, 미리 받기는 빈 음성을 담지 않는다(서버 방식)', { skip: SKIP }, async () => {
  const page = await open({ query: '?tts=server' });
  state.plan.push({ status: 200, empty: true });
  await play(page, 'spring'); await settle(page);
  assert.equal(state.reqs.length, 1);
  let i = await info(page);
  assert.deepEqual(i.spoken, [{ text: 'spring', lang: 'en-US', rate: 0.85 }], '기기 음성으로 대체'); assert.equal(i.played, 0); assert.equal(i.playing, false);
  state.plan.push({ status: 200, empty: true });
  await page.eval("prefetchTTS('summer', 'en')");
  await page.waitFor("true", 1000);
  assert.equal(await page.eval("!!ttsMemCache['summer:en']"), false, '빈 음성은 메모리 캐시에 넣지 않는다');
  await page.close();
});

test('441 재생 거부(play 거부)·길이 0 오디오는 기기 음성으로 대신하고, 그 사이 정지·다른 재생이 시작됐으면 대신 읽지 않는다', { skip: SKIP }, async () => {
  let page = await open({ query: '?tts=server' });
  await page.eval("HTMLMediaElement.prototype.play = function () { return Promise.reject(Object.assign(new Error('거부'), { name: 'NotAllowedError' })); }");
  await play(page, 'apple'); await settle(page);
  assert.equal((await info(page)).spoken.length, 1, '재생 거부 → 기기 음성');
  await page.close();

  page = await open({ query: '?tts=server' });
  await page.eval("HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); }; Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 0; } }); 1");
  await play(page, 'apple');
  await page.eval("ttsCurrentAudio.dispatchEvent(new Event('loadedmetadata'))");
  await settle(page);
  let i = await info(page);
  assert.deepEqual(i.spoken, [{ text: 'apple', lang: 'en-US', rate: 0.85 }], '길이 0 → 기기 음성'); assert.equal(i.playing, false);
  await page.close();

  page = await open({ query: '?tts=server' });
  await page.eval("HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); }; Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 0; } }); 1");
  await play(page, 'apple');
  await page.eval("(() => { window.__old = ttsCurrentAudio; ttsCurrentAudio = null; })()");   // 정지·다른 재생이 시작된 상태를 흉내
  await page.eval("window.__old.dispatchEvent(new Event('loadedmetadata'))");
  assert.equal((await info(page)).spoken.length, 0, '이미 정지된 재생은 대신 읽지 않는다');
  await page.close();
});
