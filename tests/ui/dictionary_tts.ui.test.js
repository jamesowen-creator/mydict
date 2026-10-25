// 작업335: 사전의 발음 버튼(playTTS)·미리 받기(prefetchTTS)가 로그인 헤더를 보내고, 서버 발음을 쓸 수 없으면 기기 내장 음성(speechSynthesis)으로 읽는다.
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
const state = { reqs: [], plan: [] };   // plan: 호출마다 앞에서 하나씩 꺼내 쓴다 { status, delay, body }. 비면 200 오디오
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', () => {
        if (u === '/api/tts') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          state.reqs.push({ auth: req.headers.authorization || null, type: req.headers['content-type'], body });
          const p = state.plan.shift() || { status: 200 };
          const send = () => { if (p.status === 200) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(WAV); } else json(p.status, p.body || { error: '모의 오류 ' + p.status }); };
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

async function open({ token = true, speech = true } = {}) {
  state.reqs.length = 0; state.plan.length = 0;
  const page = await browser.newPage({ width: 390, height: 844, token: 'x' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCKS(speech) });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: token ? `try { localStorage.setItem('mydict_token', ${JSON.stringify(TOKEN)}); } catch (e) {}` : "try { localStorage.removeItem('mydict_token'); } catch (e) {}" });
  await page.goto(base + '/english_dictionary.html');
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

test('토큰이 있으면 /api/tts 요청에 Authorization 헤더를 붙이고, 서버 성공 경로(재생·아이콘 복귀·토스트 없음·캐시 재사용)는 그대로다', { skip: SKIP }, async () => {
  const page = await open();
  await play(page, 'apple'); await settle(page);
  assert.equal(state.reqs.length, 1); assert.equal(state.reqs[0].auth, 'Bearer ' + TOKEN); assert.match(state.reqs[0].type, /application\/json/); assert.deepEqual(state.reqs[0].body, { text: 'apple', lang: 'en' });
  const i = await info(page);
  assert.equal(i.played, 1); assert.deepEqual(i.spoken, []); assert.deepEqual(i.toasts, []); assert.equal(i.playing, false); assert.notEqual(i.icon, 'x');
  await play(page, 'apple'); await settle(page);
  assert.equal(state.reqs.length, 1, '같은 단어는 메모리 캐시를 쓰고 서버를 다시 부르지 않는다'); assert.equal((await info(page)).played, 2);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('토큰이 없으면 서버 요청 없이 기기 음성으로 읽고(언어 매핑·속도 0.9), 안내 토스트는 방문당 한 번만 나온다', { skip: SKIP }, async () => {
  const page = await open({ token: false });
  for (const [text, lang, want] of [['apple', 'en', 'en-US'], ['사과', 'ko', 'ko-KR'], ['りんご', 'ja', 'ja-JP'], ['苹果', 'zh', 'zh-CN']]) { await play(page, text, lang); await settle(page, 120); const sp = (await info(page)).spoken; assert.deepEqual(sp[sp.length - 1], { text, lang: want, rate: 0.9 }); }
  assert.equal(state.reqs.length, 0, '서버 요청 0건');
  const i = await info(page);
  assert.equal(i.spoken.length, 4); assert.deepEqual(i.toasts, ['기기 음성으로 읽어요'], '안내는 한 번'); assert.equal(i.playing, false, '다 읽으면 버튼이 원래대로');
  await page.close();
});

test('401·403 은 기기 음성으로 대신하고 이번 방문 동안 서버 요청을 더 보내지 않는다(안내 한 번). 429 는 한도 안내 문구', { skip: SKIP }, async () => {
  for (const [status, notice] of [[401, '기기 음성으로 읽어요'], [403, '기기 음성으로 읽어요'], [429, '오늘 서버 발음 한도를 다 써서 기기 음성으로 읽어요']]) {
    const page = await open();
    state.plan.push({ status });
    await play(page, 'apple'); await settle(page, 150);
    assert.equal(state.reqs.length, 1, status + ': 첫 호출은 서버로'); assert.equal((await info(page)).spoken.length, 1, status + ': 기기 음성');
    await play(page, 'banana'); await settle(page, 150);
    assert.equal(state.reqs.length, 1, status + ': 이후에는 서버 요청 없음'); assert.equal((await info(page)).spoken.length, 2);
    const i = await info(page); assert.deepEqual(i.toasts, [notice], status + ': 안내 한 번 ' + JSON.stringify(i.toasts));
    await page.close();
  }
});

test('시간 초과(8초)·500·503·재생 실패는 그 호출만 기기 음성으로 대신하고 다음 호출은 서버를 다시 시도한다(안내는 한 번)', { skip: SKIP }, async () => {
  const page = await open();
  state.plan.push({ status: 200, delay: 1500 }, { status: 500 }, { status: 503 }, { status: 200 });
  await play(page, 'one'); await settle(page, 400);   // 시간 초과(모의: 8초 → 0.15초)
  assert.equal(state.reqs.length, 1); assert.equal((await info(page)).spoken.length, 1);
  await play(page, 'two'); await settle(page, 200);   // 500
  assert.equal(state.reqs.length, 2, '다음 호출은 서버를 다시 시도'); assert.equal((await info(page)).spoken.length, 2);
  await play(page, 'three'); await settle(page, 200);   // 503
  assert.equal(state.reqs.length, 3); assert.equal((await info(page)).spoken.length, 3);
  await play(page, 'four'); await settle(page, 250);   // 서버 성공
  assert.equal(state.reqs.length, 4); const i = await info(page);
  assert.equal(i.spoken.length, 3, '성공하면 기기 음성 없음'); assert.equal(i.played, 1); assert.deepEqual(i.toasts, ['기기 음성으로 읽어요'], '안내는 방문당 한 번');
  assert.equal(await page.eval('serverTtsOff'), false, '일시적 오류로는 서버 발음을 끄지 않는다');
  // 재생 실패(오디오 오류)도 그 호출만 대체
  await page.eval("HTMLMediaElement.prototype.play = function () { return Promise.reject(new Error('재생 거부')); }");
  await play(page, 'five'); await settle(page, 250);
  assert.equal((await info(page)).spoken.length, 4); assert.equal(await page.eval('serverTtsOff'), false);
  await page.close();
});

test('미리 받기(prefetchTTS): 토큰이 없으면 요청 0건, 토큰이 있으면 헤더를 붙이고, 401·403·429 를 받으면 이번 방문 동안 더 요청하지 않으며 조용하다(토스트 없음). 이후 발음 버튼은 기기 음성', { skip: SKIP }, async () => {
  let page = await open({ token: false });
  await page.eval("prefetchTTS('apple', 'en')"); await settle(page, 150);
  assert.equal(state.reqs.length, 0); assert.deepEqual((await info(page)).toasts, []);
  await page.close();
  page = await open();
  await page.eval("prefetchTTS('apple', 'en')"); await settle(page, 200);
  assert.equal(state.reqs.length, 1); assert.equal(state.reqs[0].auth, 'Bearer ' + TOKEN);
  await play(page, 'apple'); await settle(page, 200);
  assert.equal(state.reqs.length, 1, '미리 받은 오디오를 재생(추가 요청 없음)'); assert.equal((await info(page)).played, 1);
  state.plan.push({ status: 403 });
  await page.eval("prefetchTTS('pear', 'en')"); await settle(page, 200);
  assert.equal(state.reqs.length, 2); assert.deepEqual((await info(page)).toasts, [], '조용히 실패');
  await page.eval("prefetchTTS('plum', 'en')"); await settle(page, 150);
  assert.equal(state.reqs.length, 2, '서버 발음이 꺼져 있으면 요청하지 않는다');
  await play(page, 'pear'); await settle(page, 150);
  assert.equal(state.reqs.length, 2); const i = await info(page); assert.equal(i.spoken.length, 1); assert.deepEqual(i.toasts, ['기기 음성으로 읽어요']);
  // 서버 오류(500)는 조용히 무시하고 꺼지지 않는다
  const p2 = await open();
  state.plan.push({ status: 500 });
  await p2.eval("prefetchTTS('a1', 'en')"); await settle(p2, 150); await p2.eval("prefetchTTS('a2', 'en')"); await settle(p2, 150);
  assert.equal(state.reqs.length, 2, '500 은 방문 전체를 끄지 않는다'); assert.equal(await p2.eval('serverTtsOff'), false);
  await p2.close(); await page.close();
});

test('기기 음성이 없는 환경에서는 기존 오류 토스트(발음 재생 실패: …)를 보이고 아이콘이 원래대로 돌아온다. 토큰이 없으면 서버 요청도 없다', { skip: SKIP }, async () => {
  let page = await open({ token: false, speech: false });
  await play(page, 'apple'); await settle(page, 150);
  let i = await info(page);
  assert.equal(state.reqs.length, 0); assert.deepEqual(i.toasts, ['발음 재생 실패: 로그인이 필요합니다.']); assert.equal(i.playing, false); assert.notEqual(i.icon, 'x');
  await page.close();
  page = await open({ speech: false });
  state.plan.push({ status: 500, body: { error: 'TTS 생성 실패' } });
  await play(page, 'apple'); await settle(page, 200);
  i = await info(page);
  assert.deepEqual(i.toasts, ['발음 재생 실패: TTS 생성 실패'], '서버가 준 오류 문구가 그대로'); assert.equal(i.playing, false);
  state.plan.push({ status: 403, body: { error: 'TTS 권한이 없습니다.' } });
  await play(page, 'pear'); await settle(page, 200);
  assert.deepEqual((await info(page)).toasts, ['발음 재생 실패: TTS 생성 실패', '발음 재생 실패: TTS 권한이 없습니다.']);
  await page.close();
});

test('기기 음성으로 읽는 중 같은 버튼을 다시 누르면 멈추고, 다른 단어를 누르면 이어서 바뀐다. 팟캐스트 코드는 그대로 헤더를 보낸다', { skip: SKIP }, async () => {
  const page = await open({ token: false });
  await page.eval("window.speechSynthesis.speak = function (u) { window.__spoken.push({ text: u.text }); };");   // 끝나지 않는 음성
  await play(page, 'apple'); await sleep(150);
  assert.equal((await info(page)).playing, true, '읽는 동안 재생 중 표시'); assert.equal((await info(page)).spoken.length, 1);
  await play(page, 'apple'); await sleep(150);
  let i = await info(page); assert.equal(i.playing, false, '같은 버튼 재클릭으로 정지'); assert.equal(i.spoken.length, 1, '다시 읽지 않는다');
  await play(page, 'pear'); await sleep(150); assert.equal((await info(page)).spoken.length, 2);
  await page.close();
  const src = fs.readFileSync(path.join(PUB, 'english_dictionary.html'), 'utf8').replace(/\r\n/g, '\n');
  const pod = src.slice(src.indexOf('async function _podcastPlayNextSeg'), src.indexOf('function _podcastFinished'));
  assert.match(pod, /fetch\('\/api\/tts', \{\s+method: 'POST',\s+headers: \{ \.\.\.authHeaders\(\), 'Content-Type': 'application\/json' \}/, '팟캐스트는 이미 헤더를 보내고 그대로다');
  assert.match(pod, /if \(!res\.ok\) throw new Error\('TTS 실패'\)/); assert.ok(!/speechSynthesis|serverTtsOff/.test(pod), '팟캐스트 구간에는 이번 변경이 없다');
});
