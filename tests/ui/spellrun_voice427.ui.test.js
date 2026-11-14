// 작업427: 스펠링 런 발음 — 판 단어 미리 받기, 마지막 단어 반복 정리, 늦은 소리 차단. 헤드리스 Chrome.
// 자체 임시 서버에 모의 /api/me·/api/wordbook·/api/tts(지연·상태 조절) 만 둔다 — 실제 서버·OpenAI·운영 DB 와 무관.
// game.js 는 서버가 내려줄 때 completeWord 를 시험용으로 노출하는 한 줄만 덧붙인다(저장소 파일은 그대로).
// 실행: node --test tests/ui/spellrun_voice427.ui.test.js   (Chrome이 없으면 건너뜀)
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
const WAV = (() => { const n = 8000, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();   // 1.0초
const WORDS = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'garden', 'planet', 'river', 'cloud', 'bridge'];
const rows = WORDS.map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));

let srv, base, browser;
const T = { delay: 0, status: 200, failFirst: false, seen: new Set(), reqs: [], inflight: 0, maxInflight: 0 };
const reset = (o = {}) => Object.assign(T, { delay: 0, status: 200, failFirst: false, seen: new Set(), reqs: [], inflight: 0, maxInflight: 0 }, o);
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const ch = []; req.on('data', d => ch.push(d));
      req.on('end', () => {
        if (u === '/api/me') return json(200, { id: 7, role: 'user', can_wordbook: true, perm_versus: false });
        if (u === '/api/wordbook') return json(200, rows);
        if (u === '/api/tts') {
          let text = ''; try { text = JSON.parse(Buffer.concat(ch).toString()).text; } catch (e) { /* 무시 */ }
          T.reqs.push(text); T.inflight++; T.maxInflight = Math.max(T.maxInflight, T.inflight);
          const first = !T.seen.has(text); T.seen.add(text);
          return setTimeout(() => {
            T.inflight--;
            if (T.status !== 200 || (T.failFirst && first)) return json(T.status !== 200 ? T.status : 500, { error: '모의 오류' });
            res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(WAV);
          }, T.delay);
        }
        json(404, { ok: false });
      });
      return;
    }
    const f = path.join(PUB, u);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(f);
    if (u === '/js/spellrun/game.js') body = Buffer.from(body.toString('utf8').replace('window.SpellRun = API;', 'API.complete = completeWord; window.SpellRun = API;'));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(body);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });

// 실제 <audio> 재생 사건과 기기 음성 호출을 시각과 함께 기록한다
const LOG = `(() => { window.__ev = []; const t0 = performance.now(); const L = (k, x) => window.__ev.push({ t: Math.round(performance.now() - t0), k, x: x || '' }); window.__L = L;
  const P = HTMLMediaElement.prototype, ex = P.play;
  P.play = function () { if (!String(this.src).startsWith('data:')) { L('play', 'rate=' + this.playbackRate); if (!this.__l) { this.__l = 1; for (const e of ['playing', 'ended', 'pause']) this.addEventListener(e, () => { if (!String(this.src).startsWith('data:')) L(e, 'rate=' + this.playbackRate + (e === 'ended' && window.SpellRun ? ' popT=' + SpellRun.G.popT.toFixed(2) + ' dur=' + this.duration + ' repeatT=' + SpellRun.G.repeatT + ' st=' + SpellRun.G.state : '')); }); } } return ex.apply(this, arguments); };
  let seen = false; setInterval(() => { const r = document.getElementById('result'); if (r && !r.hidden && !seen) { seen = true; L('result'); } }, 20);
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], speaking: false, pending: false, paused: false, cancel: () => { L('cancel'); }, resume: () => {}, speak: u => { L('builtin', u.text + ' rate=' + u.rate); setTimeout(() => u.onstart && u.onstart(), 0); setTimeout(() => u.onend && u.onend(), 30); } } });
})();`;
async function openGame() {
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('spellrun_preview', '0'); localStorage.setItem('spellrun_mode', 'normal'); sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(rows.map(r => r.id)))}); } catch (e) {}` });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: LOG });
  await page.goto(base + '/spelling_run.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 });   // 자동 재생 허용(사용자 누름)
  await page.eval('SpellRun.manual = true');
  return page;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const events = page => page.eval('window.__ev');
// 게임 시계를 실제 시간에 맞춰 돌린다
const clock = page => setInterval(() => page.eval('SpellRun.step(0.1)').catch(() => {}), 100);

test('427 미리 받기: 판이 시작되면 그 판 단어 수만큼 요청하고(중복 없음, 앞 순서부터), 동시 요청은 3개 이하이며 게임은 기다리지 않는다', { skip: SKIP }, async () => {
  reset({ delay: 200 });
  const page = await openGame();
  const t0 = Date.now();
  await page.eval('SpellRun.startRound(false)');
  assert.ok(Date.now() - t0 < 500, '시작은 요청을 기다리지 않는다');
  assert.equal(await page.eval("SpellRun.G.state"), 'run');
  const words = await page.eval('SpellRun.G.words.map(w => w.word)');
  await wait(300);
  assert.ok(T.reqs.length < words.length, '한꺼번에 다 보내지 않고 나눠 보낸다(백그라운드)');
  await wait(2800);
  assert.deepEqual(T.reqs, words, '단어 수와 같고 중복 없이 앞 순서부터');
  assert.ok(T.maxInflight <= 3 && T.maxInflight >= 1, '동시 요청 ' + T.maxInflight);
  assert.equal(await page.eval('SpellRun.G.state'), 'run');
  await page.close();
});

test('427 미리 받기 + 재생: 이미 받은 단어는 다시 요청하지 않고 재생하며, 미리 보기가 받은 단어와도 중복되지 않는다', { skip: SKIP }, async () => {
  reset();
  const page = await openGame();
  await page.eval('SpellRun.startRound(false)');
  await wait(1500);
  const n = T.reqs.length;
  await page.eval('SpellRun.G.state = "run"; SpellRun.G.wi = 0; SpellRun.complete();');
  await wait(300);
  assert.equal(T.reqs.length, n, '재생 때 새 요청 없음');
  assert.ok((await events(page)).some(e => e.k === 'play'), '미리 받은 소리가 재생된다');
  await page.close();
});

test('427 미리 받기 실패: 실패한 단어는 재생 때 다시 요청된다(재시도 폭주 없음)', { skip: SKIP }, async () => {
  reset({ failFirst: true });
  const page = await openGame();
  await page.eval('SpellRun.startRound(false)');
  const words = await page.eval('SpellRun.G.words.map(w => w.word)');
  await wait(2500);
  assert.deepEqual(T.reqs, words, '실패해도 미리 받기는 단어당 1번씩만');
  await page.eval('SpellRun.G.state = "run"; SpellRun.G.wi = 0; SpellRun.complete();');
  await wait(800);
  assert.equal(T.reqs.filter(t => t === words[0]).length, 2, '재생 때 다시 시도(2번째 요청은 성공)');
  assert.ok((await events(page)).some(e => e.k === 'play'), '재시도 뒤 재생된다');
  await page.close();
});

for (const status of [401, 403, 429, 503]) {
  test(`427 미리 받기 ${status}: 더 요청하지 않고 조용히 끝나며 게임은 계속된다(재시도 폭주 없음)`, { skip: SKIP }, async () => {
    reset({ status, delay: 100 });
    const page = await openGame();
    await page.eval('SpellRun.startRound(false)');
    await wait(1500);
    const n = T.reqs.length, total = await page.eval('SpellRun.G.words.length');
    assert.ok(n >= 1 && n <= 3, `요청 ${n}개(한도·권한 오류에서 멈춤, 전체 ${total}개)`);
    await wait(1200);
    assert.equal(T.reqs.length, n, '시간이 지나도 늘지 않는다');
    assert.equal(await page.eval('SpellRun.G.state'), 'run');
    await page.close();
  });
}

// 마지막 단어 완성 → 시계를 돌려 결과 화면까지. delay = 서버 응답 지연
async function finalWord(delay) {
  reset({ delay });
  const page = await openGame();
  await page.eval('SpellRun.startRound(false)');
  if (delay) await page.eval('1');   // 미리 받기는 시작했지만 응답 전에 완성하는 최악의 경우
  const tm = clock(page);
  await page.eval('(() => { const G = SpellRun.G; G.state = "run"; G.wi = G.words.length - 1; G.mist[G.wi] = 0; SpellRun.complete(); window.__L("complete"); })()');
  await wait(delay >= 9000 ? 12000 : 7500);
  clearInterval(tm);
  const ev = await events(page);
  await page.close();
  return ev;
}
for (const delay of [0, 1000, 3000, 9000]) {
  test(`427 마지막 단어 응답 지연 ${delay}ms: 결과 화면 뒤로 재생되는 발음이 없고 기기 음성은 한 번 이하`, { skip: SKIP, timeout: 60000 }, async () => {
    const ev = await finalWord(delay);
    const res = ev.find(e => e.k === 'result');
    assert.ok(res, '결과 화면이 떴다');
    const after = ev.filter(e => e.t > res.t + 30 && (e.k === 'play' || e.k === 'playing' || e.k === 'builtin'));
    assert.deepEqual(after, [], '결과 화면 뒤 재생 0개: ' + JSON.stringify(ev));
    assert.ok(ev.filter(e => e.k === 'builtin' && !/^a /.test(e.x)).length <= 1, '기기 음성 대체는 최대 한 번');
    const playing = ev.filter(e => e.k === 'playing' && e.t > res.t + 30);
    assert.equal(playing.length, 0);
  });
}

test('427 마지막 단어 반복: 팝업 안에 끝날 때만 시작한다(1.0초 소리는 첫 발음이 끝나는 대로 시작해 결과 화면 전에 끝난다)', { skip: SKIP, timeout: 30000 }, async () => {
  const ev = await finalWord(0);
  const res = ev.find(e => e.k === 'result');
  const slow = ev.filter(e => e.k === 'play' && e.x === 'rate=0.6'), end = ev.filter(e => e.k === 'ended' && e.x.startsWith('rate=0.6'));
  assert.equal(slow.length, 1, '느린 반복은 한 번: ' + JSON.stringify(ev));
  assert.equal(end.length, 1, JSON.stringify(ev)); assert.ok(end[0].t <= res.t, '느린 반복이 결과 화면 전에 끝남');
  assert.ok(ev.filter(e => e.k === 'play' && e.x === 'rate=1').length === 1, '일반 속도 한 번');
});

test('427 마지막 단어 반복: 응답이 늦어 시간이 부족하면(1초 지연) 느린 반복을 시작하지 않는다', { skip: SKIP, timeout: 30000 }, async () => {
  const ev = await finalWord(1000);
  assert.equal(ev.filter(e => e.k === 'play' && e.x === 'rate=0.6').length, 0, '느린 반복 없음: ' + JSON.stringify(ev));
  assert.equal(ev.filter(e => e.k === 'play' && e.x === 'rate=1').length, 1);
});

test('427 판이 바뀐 뒤 도착한 응답은 재생하지 않는다(기기 음성으로도 대신하지 않는다)', { skip: SKIP, timeout: 30000 }, async () => {
  reset({ delay: 1500 });
  const page = await openGame();
  await page.eval('SpellRun.startRound(false)');
  await page.eval('SpellRun.G.state = "run"; SpellRun.G.wi = 0; SpellRun.complete(); window.__L("complete")');
  await wait(200);
  await page.eval('SpellRun.startRound(false)');   // 새 판: 라운드 토큰이 바뀐다
  await wait(2500);
  const ev = await events(page);
  assert.equal(ev.filter(e => e.k === 'play' || e.k === 'builtin' && !/^a /.test(e.x)).length, 0, '이전 판의 늦은 응답은 소리 없음: ' + JSON.stringify(ev));
  await page.close();
});

test('427 시간 초과(8초) 뒤 도착: 이미 결과 화면이면 기기 음성도 내지 않는다. 시간 초과 값은 8초 그대로', { skip: SKIP, timeout: 60000 }, async () => {
  assert.equal(await (async () => { const p = await openGame(); const v = await p.eval('SpellRun.CONFIG.FINAL_REPEAT_SEC + "|" + SpellRun.CONFIG.POP_SEC_FINAL + "|" + SpellRun.CONFIG.FINAL_SLOW_RATE'); await p.close(); return v; })(), '1.6|3.2|0.6', '반복 관련 값은 그대로');
  const ev = await finalWord(9000);
  const res = ev.find(e => e.k === 'result');
  assert.ok(res);
  assert.equal(ev.filter(e => e.t > res.t && (e.k === 'builtin' || e.k === 'play')).length, 0, '결과 화면 뒤 소리 없음');
});

test('427 결과 마무리 소리와 겹치지 않는다: finish 시점에 재생 중인 발음은 멈춘다(느린 반복 도중 판 끝내기)', { skip: SKIP, timeout: 30000 }, async () => {
  reset({ delay: 0 });
  const page = await openGame();
  await page.eval('SpellRun.startRound(false)');
  await wait(800);
  const tm = clock(page);
  await page.eval('(() => { const G = SpellRun.G; G.state = "run"; G.wi = 0; SpellRun.complete(); })()');
  await wait(900);
  await page.eval('(() => { const G = SpellRun.G; G.state = "ending"; G.endT = 0; })()');   // 끝내기: 곧바로 결과 화면
  await wait(1500);
  clearInterval(tm);
  const ev = await events(page);
  const res = ev.find(e => e.k === 'result');
  assert.ok(res);
  assert.equal(ev.filter(e => e.k === 'playing' && e.t > res.t + 30).length, 0, '결과 화면 뒤 재생 중인 소리 없음');
  await page.close();
});
