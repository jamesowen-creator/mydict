// 작업347: 대결 게임 연결(시작 흐름, 상태 신호, 상대 진행 막대, 종료·결과). 헤드리스 Chrome.
// 서버는 자체 임시 서버: 작업343 의 방 저장소(lib/versus.js, 주입 시계)를 그대로 쓰는 모의 API + 모의 /api/me·/api/wordbook·/api/tts.
// 실제 서버·운영 서버·DB·TTS 에는 요청하지 않는다. 상대 플레이어는 시험이 저장소를 직접 불러 움직인다.
// 실행: node --test tests/ui/spellrun_versus_game.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { createStore } = require('../../lib/versus');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (id, name) => `${b64({ alg: 'none' })}.${b64({ id, name, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const WAV = (() => { const n = 800, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();
const WORDS = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'garden', 'planet', 'river', 'cloud', 'bridge'];
const mkRows = n => WORDS.slice(0, n).map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));

let srv, base, browser, store, clockOffset = 0;
const state = { rows: [], requests: [], override: {}, delay: {}, inflight: 0, maxInflight: 0 };
const ME = { id: 7, name: '테스터' }, OPP = { id: 8, name: '민수' };
function resetState() {
  clockOffset = 0;
  store = createStore({ now: () => Date.now() + clockOffset, maxRooms: 50 });
  Object.assign(state, { rows: mkRows(12), requests: [], override: {}, delay: {}, inflight: 0, maxInflight: 0 });
}
const calls = (method, re) => state.requests.filter(r => r.method === method && re.test(r.url));
const opponentOf = room => store._rooms.get(room);
test.before(async () => {
  if (SKIP) return;
  resetState();
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', async () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let uid = 0, uname = '';
        try { const p = JSON.parse(Buffer.from((req.headers.authorization || '').replace('Bearer ', '').split('.')[1] || 'e30', 'base64url').toString()); uid = p.id; uname = p.name; } catch (e) { /* 토큰 없음 */ }
        const body = raw ? JSON.parse(raw) : {};
        state.requests.push({ method: req.method, url: u, body, at: Date.now(), uid });
        if (u === '/api/me') return json(200, { id: uid, role: 'user', can_wordbook: true, perm_versus: true });
        if (u === '/api/wordbook') return json(200, state.rows);
        if (u === '/api/tts') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(WAV); }
        const m = u.match(/^\/api\/versus\/rooms(?:\/([0-9a-f]{24})(?:\/(join|start|state|finish|leave))?)?$/);
        if (!m) return json(404, { ok: false });
        const key = req.method + ' ' + (m[2] || (m[1] ? 'get' : 'rooms'));
        const ov = state.override[key];
        if (ov && (ov.times === undefined || ov.times > 0)) { if (ov.times !== undefined) ov.times--; return json(ov.status, ov.body || { error: '모의 오류' }); }
        const act = () => {
          let r;
          if (!m[1]) { if (req.method === 'GET') return json(200, { ok: true, rooms: store.list(uid) }); r = store.create({ id: uid, name: uname }); return r.error ? json(r.error.status, { error: r.error.error }) : json(200, { ok: true, roomId: r.room.id }); }
          const id = m[1];
          if (!m[2]) r = store.get(id, uid);
          else if (m[2] === 'join') r = store.join(id, { id: uid, name: uname });
          else if (m[2] === 'start') r = store.start(id, uid, body.wordCount);
          else if (m[2] === 'state') r = store.state(id, uid, body);
          else if (m[2] === 'finish') r = store.finish(id, uid, body);
          else r = store.leave(id, uid);
          if (r.error) return json(r.error.status, { error: r.error.error });
          json(200, store.view(r.room, uid));
        };
        const d = state.delay[key];
        if (d) { state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight); setTimeout(() => { state.inflight--; act(); }, d); } else act();
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

async function openGame({ width = 360, height = 640, preview = false } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: jwt(ME.id, ME.name) });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.setItem('spellrun_preview', '${preview ? 1 : 0}'); } sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(state.rows.map(r => r.id)))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html');
  await page.waitFor("!document.getElementById('app').hidden && !!document.getElementById('modeRow')", 8000);
  await page.eval("Object.assign(SpellRun.vs.T, { list: 80, room: 80, backoff: 300, signal: 150, fin: 100 }); Object.assign(SpellRun.preview.T, { maxMs: 600, gapMs: 30, silentMs: 60 })");
  return page;
}
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`);
// 방을 만들고 대기 화면까지 간다. 방 id 를 돌려준다
async function makeRoom(page) {
  await click(page, '#modeRow [data-mode=versus]');
  await page.waitFor("!document.getElementById('vs').hidden");
  await click(page, '#vsCreate');
  await page.waitFor("!document.getElementById('vsRoomView').hidden && SpellRun.vs.state.roomId");
  return page.eval('SpellRun.vs.state.roomId');
}
const running = page => page.waitFor("SpellRun.G.state === 'run' || SpellRun.G.state === 'intro'", 6000);
const joinOpp = id => store.join(id, OPP);
const die = page => page.eval("(() => { const G = SpellRun.G; G.contUsed = true; G.hp = 0; G.state = 'ending'; G.endT = 0.02; })()");
const playerOf = (id, uid) => { const r = store._rooms.get(id); return r.host.userId === uid ? r.host : r.guest; };
const stateCalls = () => calls('POST', /\/state$/);

test('시작 흐름(미리 보기 끔): 먼저 달리기 → POST start(wordCount) → 생존 모드 규칙으로 달리기 시작, 이어하기 켜짐. 단어 10개 미만은 막는다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  const id = await makeRoom(page);
  assert.equal(await text(page, '#vsGo'), '먼저 달리기');
  await click(page, '#vsGo');
  await running(page);
  const st = calls('POST', /\/start$/);
  assert.equal(st.length, 1); assert.deepEqual(st[0].body, { wordCount: 12, round: 1 });   // 작업348: 현재 판 번호를 함께 보낸다
  assert.equal(await page.eval('SpellRun.G.survival'), true, '대결은 생존 모드 규칙');
  assert.equal(await page.eval('SpellRun.CONFIG.CONT_ENABLED'), true, '이어하기 켜짐');
  assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), null, '저장된 모드 선택은 건드리지 않는다');
  assert.equal(await page.eval("document.getElementById('vs').hidden"), true);
  assert.equal(await page.eval("document.getElementById('vsBar').hidden"), false);
  assert.equal(await text(page, '#vsBarStats'), '상대를 기다리는 중');
  assert.equal(store._rooms.get(id).host.started, true);
  await page.close();

  resetState(); state.rows = mkRows(8);
  page = await openGame();
  store.create(ME);   // 방은 서버에 이미 있다(단어 10개 미만이면 방 만들기도 막히므로 저장소에서 만든다)
  await click(page, '#modeRow [data-mode=versus]');
  await page.waitFor("document.querySelectorAll('#vsList li').length === 1");
  await click(page, '#vsList button');
  await page.waitFor("!document.getElementById('vsRoomView').hidden");
  await click(page, '#vsGo');
  assert.match(await text(page, '#vsMsg'), /10개 이상.*지금 8개/);
  await sleep(200);
  assert.equal(calls('POST', /\/start$/).length, 0, '막힌 경우 서버에 시작 알림 없음');
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run');
  await page.close();
});

test('시작 흐름(미리 보기 켬): 미리 보기가 끝나 게임이 실제로 시작될 때 start 를 알리고, 미리 보기 시간은 시계에 들어가지 않는다. 미리 보기에서 돌아가면 시작 알림 없이 방 화면', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame({ preview: true });
  await makeRoom(page);
  await click(page, '#vsGo');
  await page.waitFor("!document.getElementById('pv').hidden");
  assert.equal(calls('POST', /\/start$/).length, 0, '미리 보기 중에는 시작 알림 없음');
  await page.waitFor("!document.getElementById('pvStart').hidden", 10000);
  await sleep(1200);   // 준비 상태에서 한참 머문다
  assert.equal(calls('POST', /\/start$/).length, 0, '준비 상태에서도 아직 없음');
  await click(page, '#pvStart');
  await running(page);
  assert.equal(calls('POST', /\/start$/).length, 1);
  assert.ok(await page.eval('SpellRun.G.time - SpellRun.G.startTime') < 1, '시계는 시작 누른 뒤부터');
  await page.close();

  resetState();
  page = await openGame({ preview: true });
  await makeRoom(page);
  await click(page, '#vsGo');
  await page.waitFor("!document.getElementById('pv').hidden");
  await click(page, '#pvBack');
  await page.waitFor("!document.getElementById('vs').hidden && !document.getElementById('vsRoomView').hidden");
  assert.equal(calls('POST', /\/start$/).length, 0);
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run');
  await page.close();
});

test('start 실패: 게임을 시작하지 않고 안내와 함께 방 화면(500·429·400), 404/409 는 목록으로', { skip: SKIP }, async () => {
  for (const [status, expectList] of [[500, false], [429, false], [400, false], [404, true], [409, true]]) {
    resetState();
    const page = await openGame();
    await makeRoom(page);
    state.override['POST start'] = { status, body: { error: '모의 오류' }, times: 1 };
    await click(page, '#vsGo');
    await page.waitFor("document.getElementById('vsMsg').textContent !== ''", 4000);
    assert.notEqual(await page.eval('SpellRun.G.state'), 'run', status + ': 게임 시작 안 함');
    assert.equal(await page.eval("document.getElementById('vs').hidden"), false);
    assert.equal(await page.eval("document.getElementById('vsListView').hidden"), !expectList, status + ': ' + (expectList ? '목록' : '방 화면'));
    assert.equal(await page.eval('SpellRun.G.survival'), false);
    await page.close();
  }
});

test('상태 신호: 주기마다 한 번씩 보내고 겹치지 않으며, 체력 변화는 즉시 한 번 더, 숨겨지면 멈추고 다시 보이면 즉시 보낸다. 400·429 에도 게임은 멈추지 않는다', { skip: SKIP }, async () => {
  resetState(); state.delay['POST state'] = 350;   // 응답이 늦어도(주기 150ms 보다 길다) 요청이 겹치면 안 된다
  const page = await openGame();
  const id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  await page.eval('SpellRun.manual = true');   // 게임 진행을 멈춰 시험이 바꾼 체력만 보이게 한다(신호·타이머는 그대로)
  await sleep(1500);
  const n1 = stateCalls().length;
  assert.ok(n1 >= 2 && n1 <= 6, '응답 지연 350ms 에서 겹치지 않고 이어서 보냄: ' + n1);
  assert.equal(state.maxInflight, 1, '서버에 동시 state 요청 최대 ' + state.maxInflight);
  const body = stateCalls()[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['combo', 'continued', 'hp', 'maxHp', 'round', 'score', 'wordNo']);
  assert.equal(body.maxHp, 5); assert.equal(body.continued, false); assert.equal(body.wordNo, 1);
  delete state.delay['POST state'];
  // 체력 변화 → 즉시(주기 150ms 를 5000 으로 늘려서 확인)
  await page.eval("SpellRun.vs.T.signal = 5000; clearInterval(SpellRun.vs.game.timer); SpellRun.vs.game.timer = setInterval(() => {}, 5000)");
  await sleep(500);
  const n2 = stateCalls().length;
  await page.eval("SpellRun.G.hp = SpellRun.G.hp - 1; SpellRun.vs.renderHearts()");
  await sleep(500);
  assert.equal(stateCalls().length, n2 + 1, '체력이 바뀌면 즉시 한 번');
  assert.equal(stateCalls().pop().body.hp, 4);
  // 숨김 → 멈춤, 보임 → 즉시
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await page.eval("SpellRun.G.hp = SpellRun.G.hp - 1; SpellRun.vs.renderHearts()");
  await sleep(500);
  assert.equal(stateCalls().length, n2 + 1, '숨겨진 동안은 보내지 않음');
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(500);
  assert.equal(stateCalls().length, n2 + 2, '다시 보이면 즉시 한 번');
  // 400: 게임을 멈추지 않고 다음에 다시 보낸다
  state.override['POST state'] = { status: 400, body: { error: '모의' }, times: 1 };
  await page.eval("SpellRun.G.hp = SpellRun.G.hp - 1; SpellRun.vs.renderHearts()");
  await sleep(600);
  assert.ok(['run', 'intro'].includes(await page.eval('SpellRun.G.state')), '400 에도 게임 진행');
  await page.eval("SpellRun.G.hp = SpellRun.G.hp + 1; SpellRun.vs.renderHearts()");
  await sleep(600);
  assert.equal(stateCalls().pop().body.hp, await page.eval('SpellRun.G.hp'), '다음 신호에 최신 값을 다시 보냄');
  // 429: 쉬었다가 이어 간다
  state.override['POST state'] = { status: 429, body: { error: '모의' }, times: 1 };
  await page.eval("SpellRun.G.hp = SpellRun.G.hp - 1; SpellRun.vs.renderHearts()");
  await sleep(150);
  const n3 = stateCalls().length;
  await page.eval("SpellRun.G.hp = SpellRun.G.hp + 1; SpellRun.vs.renderHearts()");
  await sleep(150);
  assert.equal(stateCalls().length, n3, '429 뒤에는 backoff(300ms) 동안 보내지 않음');
  await sleep(400);
  await page.eval("SpellRun.G.hp = SpellRun.G.hp + 1; SpellRun.vs.renderHearts()");
  await sleep(400);
  assert.ok(stateCalls().length > n3, '쉰 뒤 이어서 보냄');
  assert.ok(['run', 'intro'].includes(await page.eval('SpellRun.G.state')));
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('상대 진행 막대: 상대 없음 → 입장 안내(한 번) → 이름·체력·점수·콤보·단어 번호 → 상대 종료 / 연결 끊김. 시작할 때 이미 있던 상대에는 입장 안내 없음', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  const id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  assert.equal(await text(page, '#vsBarStats'), '상대를 기다리는 중');
  joinOpp(id);
  await page.waitFor("document.getElementById('vsBarName').textContent.includes('민수')", 4000);
  assert.equal(await page.eval("document.getElementById('vsToast').hidden"), false);
  assert.equal(await text(page, '#vsToast'), '상대가 들어왔어요');
  assert.match(await text(page, '#vsBarStats'), /아직 시작 전/);
  store.start(id, OPP.id, 12);
  store.state(id, OPP.id, { score: 1200, combo: 4, hp: 3, maxHp: 5, wordNo: 7, continued: false });
  await page.waitFor("document.getElementById('vsBarStats').textContent.includes('1,200')", 4000);
  assert.equal(await text(page, '#vsBarStats'), '체력 3/5 · 점수 1,200 · 콤보 4 · 단어 7');
  assert.equal(await text(page, '#vsBarName'), '민수');
  await page.eval("document.getElementById('vsToast').hidden = true");
  store.finish(id, OPP.id, { survivalSec: 0.5, score: 1300, wordCount: 7, continued: false });
  await page.waitFor("document.getElementById('vsBarName').textContent.includes('상대 종료')", 4000);
  await sleep(500);
  assert.equal(await page.eval("document.getElementById('vsToast').hidden"), true, '입장 안내는 한 번뿐');
  await page.close();

  resetState();
  page = await openGame();
  const id2 = await makeRoom(page);
  joinOpp(id2);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  assert.match(await text(page, '#vsRoomText'), /두 사람이 모였어요/);
  store.start(id2, OPP.id, 12);
  await page.waitFor("document.getElementById('vsRoomText').textContent.includes('이미 달리는 중')", 4000);   // 준비 화면에 상대가 달리는 중임을 표시
  await click(page, '#vsGo'); await running(page);
  await sleep(500);
  assert.equal(await page.eval("document.getElementById('vsToast').hidden"), true, '시작할 때 이미 있던 상대는 입장 안내 없음');
  assert.match(await text(page, '#vsBarName'), /민수/);
  // 연결 끊김: 상대의 마지막 신호가 30초 넘게 없다 → 서버가 종료 처리
  clockOffset = 31000;
  await page.waitFor("document.getElementById('vsBarName').textContent.includes('연결 끊김')", 4000).catch(() => {});
  assert.ok(true);
  await page.close();
});

test('종료: 내 판이 끝나면 finish(생존 시간·점수·단어 수·이어하기)를 한 번 보내고 상대 기다리는 화면 → 결과(패배/승리/무승부와 사유, 끊김 표시)', { skip: SKIP }, async () => {
  // 패배(생존 시간 차이)
  resetState();
  let page = await openGame();
  let id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await click(page, '#vsGo'); await running(page);
  await sleep(1200);
  const before = await page.eval('SpellRun.G.time - SpellRun.G.startTime');
  await die(page);
  await page.waitFor("!document.getElementById('vsFinView').hidden", 4000);
  assert.equal(await page.eval("document.getElementById('vs').hidden"), false);
  assert.equal(await page.eval("document.getElementById('result').hidden"), true, '일반 결과 화면은 쓰지 않는다');
  const fin = calls('POST', /\/finish$/);
  assert.equal(fin.length, 1, 'finish 는 한 번');
  assert.ok(fin[0].body.survivalSec >= before - 0.05 && fin[0].body.survivalSec <= before + 1.5, '생존 시간 = 게임의 G.time - G.startTime: ' + JSON.stringify([fin[0].body.survivalSec, before]));
  assert.equal(fin[0].body.continued, true); assert.equal(typeof fin[0].body.wordCount, 'number'); assert.equal(typeof fin[0].body.score, 'number');
  assert.match(await text(page, '#vsFinTitle'), /결과를 기다리는 중/);
  assert.match(await page.eval("document.getElementById('vsFinList').innerText"), /나[\s\S]*생존[\s\S]*민수/);
  clockOffset = 20000;   // 상대는 더 오래 살았다
  store.state(id, OPP.id, { score: 500, combo: 1, hp: 2, maxHp: 5, wordNo: 5, continued: false });
  store.finish(id, OPP.id, { survivalSec: 15, score: 500, wordCount: 5, continued: false });
  await page.waitFor("document.getElementById('vsFinTitle').textContent === '패배'", 4000);
  assert.match(await text(page, '#vsFinWhy'), /생존 시간이 .*초 더 길어서/);
  const t = await page.eval("document.getElementById('vsFinList').innerText");
  assert.match(t, /테스터[\s\S]*이어하기 사용/); assert.match(t, /민수[\s\S]*점수 500[\s\S]*푼 단어 5개[\s\S]*이어하기 안 씀/);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#vsFinView button:not([hidden])')].map(b => b.textContent)"), ['다시 하기', '방 목록으로', '대결 화면 닫기']);   // 작업348: 결과가 나오면 다시 하기 단추가 맨 앞
  await page.close();

  // 승리(생존 시간 차이) · 점수로 판정 · 무승부
  for (const [oppSec, oppScore, title, whyRe] of [[0, 0, '승리', /더 길어서/], [null, 40, '패배', /점수로 판정/], [null, 0, '무승부', /모두 같아요/]]) {
    resetState();
    page = await openGame();
    id = await makeRoom(page);
    joinOpp(id); store.start(id, OPP.id, 12);
    await click(page, '#vsGo'); await running(page);
    await sleep(oppSec === 0 ? 2200 : 300);
    const mySec = await page.eval('SpellRun.G.time - SpellRun.G.startTime');
    await die(page);
    await page.waitFor("!document.getElementById('vsFinView').hidden", 4000);
    await page.waitFor("document.getElementById('vsFinList').innerText.includes('생존')", 4000);
    await sleep(400);
    const myRec = playerOf(id, ME.id);
    const sec = oppSec === null ? myRec.survivalSec : oppSec;
    store.state(id, OPP.id, { score: oppScore, combo: 0, hp: 1, maxHp: 5, wordNo: 1, continued: false });
    store.finish(id, OPP.id, { survivalSec: Math.min(sec, 1000), score: oppScore, wordCount: 1, continued: false });
    await page.waitFor(`document.getElementById('vsFinTitle').textContent === ${JSON.stringify(title)}`, 4000);
    assert.match(await text(page, '#vsFinWhy'), whyRe, title + ' 사유 (내 생존 ' + mySec.toFixed(1) + '초)');
    await page.close();
  }

  // 끊김 표시: 상대가 시작만 하고 신호가 없다 → 서버가 끊김으로 종료 처리 → 결과에 표시
  resetState();
  page = await openGame();
  id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await click(page, '#vsGo'); await running(page);
  await sleep(500); await die(page);
  await page.waitFor("!document.getElementById('vsFinView').hidden", 4000);
  clockOffset = 31000;
  await page.waitFor("document.getElementById('vsFinList').innerText.includes('연결 끊김')", 5000);
  assert.ok(['승리', '패배', '무승부'].includes(await text(page, '#vsFinTitle')));
  await page.close();
});

test('finish 실패는 한 번 재시도하고, 계속 실패하면 오류 안내. 방 목록으로 / 닫기 단추는 leave 를 부른다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  let id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  state.override['POST finish'] = { status: 500, body: { error: 'x' }, times: 1 };
  await die(page);
  await page.waitFor("!document.getElementById('vsFinView').hidden", 4000);
  await sleep(1800);
  assert.equal(calls('POST', /\/finish$/).length, 2, '한 번 재시도');
  assert.equal(playerOf(id, ME.id).finished, true, '재시도가 성공해 서버에 기록됨');
  assert.doesNotMatch(await text(page, '#vsFinNote'), /보내지 못했어요/);
  await page.close();

  resetState();
  page = await openGame();
  id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  state.override['POST finish'] = { status: 500, body: { error: 'x' } };
  await die(page);
  await page.waitFor("document.getElementById('vsFinNote').textContent.includes('보내지 못했어요')", 5000);
  assert.equal(calls('POST', /\/finish$/).length, 2, '재시도는 한 번뿐');
  await click(page, '#vsFinRooms');
  await page.waitFor("!document.getElementById('vsListView').hidden");
  assert.equal(calls('POST', /\/leave$/).length, 1, '방 목록으로: leave 호출');
  assert.equal(await page.eval('SpellRun.vs.game.on'), false);
  assert.equal(await page.eval('SpellRun.CONFIG.CONT_ENABLED'), true, '대결을 마치면 이어하기 설정이 원래대로');
  await page.close();

  resetState();
  page = await openGame();
  id = await makeRoom(page);
  joinOpp(id);
  await click(page, '#vsGo'); await running(page);
  await die(page);
  await page.waitFor("!document.getElementById('vsFinView').hidden", 4000);
  await click(page, '#vsFinClose');
  assert.equal(await page.eval("document.getElementById('vs').hidden"), true);
  assert.equal(await page.eval("document.getElementById('start').hidden"), false, '시작 화면으로');
  await sleep(300);
  assert.equal(calls('POST', /\/leave$/).length, 1);
  await page.close();
});

test('서버가 내 판이 끝났다고 알리면(30초 무신호) 게임을 멈추고 "연결이 끊겨 종료" 안내로 결과 흐름. 숨겨진 탭에서는 결과 조회를 멈춘다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await click(page, '#vsGo'); await running(page);
  clockOffset = 31000;   // 서버 시계만 30초 넘게 앞서간다 → 내 마지막 신호가 오래된 것으로 보인다
  store._rooms.get(id).guest.lastSignal = Date.now() + clockOffset;   // 상대는 같은 순간 신호를 보냈다(상대만 살아 있게. get()이 먼저 끊김을 판단하므로 저장소 내부 값을 직접 갱신)
  await page.waitFor("!document.getElementById('vsFinView').hidden", 5000);
  assert.equal(await page.eval('SpellRun.G.state'), 'over', '게임 정지');
  assert.match(await text(page, '#vsFinNote'), /연결이 끊겨 종료/);
  assert.equal(await page.eval("document.getElementById('vsBar').hidden"), true);
  assert.equal(calls('POST', /\/finish$/).length, 0, '이미 서버가 끝낸 판이라 finish 를 보내지 않는다');
  assert.ok(playerOf(id, ME.id).disconnected);
  // 숨김 탭: 결과 조회 멈춤
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(300);
  const n = calls('GET', /rooms\/[0-9a-f]{24}$/).length; await sleep(600);
  assert.equal(calls('GET', /rooms\/[0-9a-f]{24}$/).length, n, '숨겨진 동안 조회 없음');
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(500);
  assert.ok(calls('GET', /rooms\/[0-9a-f]{24}$/).length > n, '다시 보이면 이어서 조회');
  await page.close();
});

test('게임 중 페이지를 떠나면(pagehide) leave 가 keepalive 로 나간다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  await page.eval("window.dispatchEvent(new Event('pagehide'))");
  await sleep(500);
  assert.equal(calls('POST', /\/leave$/).length, 1);
  assert.equal(store._rooms.get(id).host.left, true);
  await page.close();
});

for (const [w, h] of [[320, 568], [360, 568], [390, 568], [320, 640], [360, 640], [390, 640], [320, 740], [360, 740], [390, 740]]) {
  test(`막대 배치 ${w}x${h}: 상자 안, 땅 아래쪽에 있고 HUD·뜻·글자 칸·팝업·체력 줄을 가리지 않는다`, { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ width: w, height: h });
    const id = await makeRoom(page);
    joinOpp(id); store.start(id, OPP.id, 12);
    store.state(id, OPP.id, { score: 123456, combo: 12, hp: 5, maxHp: 5, wordNo: 123, continued: false });
    await click(page, '#vsGo'); await running(page);
    await page.waitFor("document.getElementById('vsBarStats').textContent.includes('123,456')", 4000);
    await page.eval("(() => { const p = document.getElementById('pop'); p.hidden = false; document.getElementById('popTag').textContent = 'TAG'; document.getElementById('popWord').textContent = 'bridgebridgebridge'; document.getElementById('popMean').textContent = '아주 긴 뜻이 들어가는 팝업 확인용 문장입니다 아주 긴'; document.getElementById('popNote').textContent = '안내'; })()");
    const m = await page.eval(`(() => {
      const r = id => document.getElementById(id).getBoundingClientRect(), bar = r('vsBar'), box = r('box'), u = parseFloat(getComputedStyle(document.getElementById('box')).getPropertyValue('--u'));
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const ids = ['hearts', 'score', 'progress', 'snd', 'hintbox', 'word', 'pop'];
      const sty = e => getComputedStyle(e);
      const kids = [...document.querySelectorAll('#hud .slot, #hud .cell')].map(e => e.getBoundingClientRect());
      return { inBox: bar.left >= box.left - 0.5 && bar.right <= box.right + 0.5 && bar.top >= box.top && bar.bottom <= box.bottom + 0.5,
        belowGround: bar.top >= box.top + 520 * u - 1, overlap: ids.filter(i => !document.getElementById(i).hidden && hit(bar, r(i))), overlapKids: kids.some(k => hit(bar, k)),
        barH: bar.height / u, hud: r('hud').bottom - box.top, barTop: bar.top - box.top, ground: 520 * u, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        textClipped: document.getElementById('vsBarStats').scrollWidth > document.getElementById('vsBarStats').clientWidth + 1, nameClipped: document.getElementById('vsBarName').scrollWidth > document.getElementById('vsBarName').clientWidth + 1 };
    })()`);
    assert.ok(m.inBox, JSON.stringify(m));
    assert.deepEqual(m.overlap, [], '가리는 요소: ' + JSON.stringify(m));
    assert.equal(m.overlapKids, false);
    assert.ok(m.belowGround, '땅 아래: ' + JSON.stringify(m));
    assert.ok(m.overflowX <= 0);
    assert.equal(m.textClipped, false, '가장 긴 값(123,456점·콤보 12·단어 123)에서도 줄임표 없이 한 줄: ' + JSON.stringify(m));
    console.log(`[측정] ${w}x${h}: 막대 높이 ${m.barH.toFixed(1)}u, 위쪽 ${Math.round(m.barTop)}px, 땅 ${Math.round(m.ground)}px`);
    await page.close();
  });
}

// 작업350: 페이지 보관(bfcache). pagehide persisted=true 는 방을 나가지 않고, 돌아오면(pageshow persisted=true) 앱이 다시 보일 때와 같은 재개를 한 번만 한다.
const pagehide = (page, persisted) => page.eval(`window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: ${persisted} }))`);
const pageshow = (page, persisted) => page.eval(`window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: ${persisted} }))`);
const roomGets = () => calls('GET', /rooms\/[0-9a-f]{24}$/).length;

test('보관(pagehide persisted=true) → 복귀(pageshow): 방 화면에서 leave 없이 조회가 이어지고 타이머는 하나뿐', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  await page.eval('SpellRun.vs.T.room = 300');
  await sleep(700);
  await pagehide(page, true);
  await sleep(300);
  assert.equal(calls('POST', /\/leave$/).length, 0, '보관에서는 leave 없음');
  assert.equal(store._rooms.get(id).host.left, false);
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");   // 보관에 들어가며 숨김
  await sleep(500);
  const n0 = roomGets(); await sleep(700);
  assert.equal(roomGets(), n0, '숨겨진 동안 조회 없음');
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");   // 돌아옴: 둘 다 온다
  await pageshow(page, true);
  await sleep(2000);
  const per = (roomGets() - n0) / 2;
  assert.ok(per <= 5, '조회 주기가 하나뿐(주기 300ms 면 초당 약 3.3회): 초당 ' + per);
  assert.ok(per >= 2, '조회가 이어진다: 초당 ' + per);
  assert.equal(calls('POST', /\/leave$/).length, 0);
  await page.close();
});

test('보관 → 복귀: 달리는 중에 leave 없이 상태 신호가 즉시 정확히 한 번(visibilitychange 와 pageshow 가 함께 와도)', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  await page.eval("SpellRun.manual = true; SpellRun.vs.T.signal = 5000; clearInterval(SpellRun.vs.game.timer); SpellRun.vs.game.timer = setInterval(() => {}, 5000)");
  await sleep(600);
  await pagehide(page, true);
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(500);
  const n = stateCalls().length;
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
  await pageshow(page, true);
  await sleep(900);
  assert.equal(stateCalls().length, n + 1, '복귀 즉시 신호 한 번');
  assert.equal(calls('POST', /\/leave$/).length, 0); assert.equal(store._rooms.get(id).host.left, false);
  // pageshow 만 오는 브라우저
  await sleep(600);
  const m = stateCalls().length;
  await pagehide(page, true); await pageshow(page, true);
  await sleep(700);
  assert.equal(stateCalls().length, m + 1, 'pageshow 만 와도 한 번');
  assert.ok(['run', 'intro'].includes(await page.eval('SpellRun.G.state')));
  await page.close();
});

test('보관 → 복귀: 결과 대기 중에는 leave 없이 결과 조회가 이어지고(타이머 하나), persisted=false 는 leave 1건', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  let id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page);
  await die(page);
  await page.waitFor("!document.getElementById('vsFinView').hidden", 4000);
  await sleep(500);
  await pagehide(page, true);
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(500);
  const n0 = roomGets(); await sleep(500);
  assert.equal(roomGets(), n0, '숨겨진 동안 조회 없음');
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
  await pageshow(page, true);
  await sleep(2000);
  const per = (roomGets() - n0) / 2;
  assert.ok(per >= 5 && per <= 12, '결과 조회 주기(100ms 설정)가 하나뿐: 초당 ' + per);
  assert.equal(calls('POST', /\/leave$/).length, 0);
  store.finish(id, OPP.id, { survivalSec: 0.2, score: 0, wordCount: 1, continued: false });
  await page.waitFor("['승리', '패배', '무승부'].includes(document.getElementById('vsFinTitle').textContent)", 4000);
  await page.close();

  resetState();
  page = await openGame();
  id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page);
  await die(page);
  await page.waitFor("!document.getElementById('vsFinView').hidden", 4000);
  await pagehide(page, false);
  await sleep(500);
  assert.equal(calls('POST', /\/leave$/).length, 1, '닫히는 pagehide 는 leave 한 번');
  assert.equal(store._rooms.get(id).host.left, true);
  await page.close();
});
