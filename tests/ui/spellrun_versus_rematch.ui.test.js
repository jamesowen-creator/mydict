// 작업348: 대결 다시 하기·판 번호·예외 처리(끊김 복귀, 방 소실 404, 게임 중 나가기, finish 실패, 상대 중도 퇴장, 409 안내). 헤드리스 Chrome.
// 서버는 자체 임시 서버: 작업343 의 방 저장소(lib/versus.js, 주입 시계)를 그대로 쓰는 모의 API + 모의 /api/me·/api/wordbook·/api/tts.
// 실제 서버·운영 서버·DB·TTS 에는 요청하지 않는다. 상대 플레이어는 시험이 저장소를 직접 불러 움직인다. 서버 재시작은 저장소의 방을 모두 지워 흉내 낸다.
// 실행: node --test tests/ui/spellrun_versus_rematch.ui.test.js   (Chrome이 없으면 건너뜀)
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
const state = { rows: [], requests: [], override: {} };
const ME = { id: 7, name: '테스터' }, OPP = { id: 8, name: '민수' };
function resetState() {
  clockOffset = 0;
  store = createStore({ now: () => Date.now() + clockOffset, maxRooms: 50 });
  Object.assign(state, { rows: mkRows(12), requests: [], override: {} });
}
const calls = (method, re) => state.requests.filter(r => r.method === method && re.test(r.url));
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
        const raw = Buffer.concat(chunks).toString('utf8');
        let uid = 0, uname = '';
        try { const p = JSON.parse(Buffer.from((req.headers.authorization || '').replace('Bearer ', '').split('.')[1] || 'e30', 'base64url').toString()); uid = p.id; uname = p.name; } catch (e) { /* 토큰 없음 */ }
        const body = raw ? JSON.parse(raw) : {};
        state.requests.push({ method: req.method, url: u, body, at: Date.now(), uid });
        if (u === '/api/me') return json(200, { id: uid, role: 'user', can_wordbook: true, perm_versus: true });
        if (u === '/api/wordbook') return json(200, state.rows);
        if (u === '/api/tts') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(WAV); }
        const m = u.match(/^\/api\/versus\/rooms(?:\/([0-9a-f]{24})(?:\/(join|start|state|finish|leave|rematch))?)?$/);
        if (!m) return json(404, { ok: false });
        const key = req.method + ' ' + (m[2] || (m[1] ? 'get' : 'rooms'));
        const ov = state.override[key];
        if (ov && (ov.times === undefined || ov.times > 0)) { if (ov.times !== undefined) ov.times--; return json(ov.status, ov.body || { error: '모의 오류' }); }
        const errJson = e => json(e.status, e.code ? { error: e.error, code: e.code } : { error: e.error });
        let r;
        if (!m[1]) { if (req.method === 'GET') return json(200, { ok: true, rooms: store.list(uid) }); r = store.create({ id: uid, name: uname }); return r.error ? errJson(r.error) : json(200, { ok: true, roomId: r.room.id }); }
        const id = m[1];
        if (!m[2]) r = store.get(id, uid);
        else if (m[2] === 'join') r = store.join(id, { id: uid, name: uname });
        else if (m[2] === 'start') r = store.start(id, uid, body.wordCount, body.round);
        else if (m[2] === 'state') r = store.state(id, uid, body);
        else if (m[2] === 'finish') r = store.finish(id, uid, body);
        else if (m[2] === 'rematch') r = store.rematch(id, uid);
        else r = store.leave(id, uid);
        if (r.error) return errJson(r.error);
        json(200, store.view(r.room, uid));
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

async function openGame({ width = 360, height = 640 } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: jwt(ME.id, ME.name) });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.setItem('spellrun_preview', '0'); } sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(state.rows.map(r => r.id)))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html');
  await page.waitFor("!document.getElementById('app').hidden && !!document.getElementById('modeRow')", 8000);
  await page.eval("Object.assign(SpellRun.vs.T, { list: 80, room: 80, backoff: 300, signal: 150, fin: 100 }); Object.assign(SpellRun.preview.T, { maxMs: 600, gapMs: 30, silentMs: 60 })");
  return page;
}
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`);
const shown = (page, sel) => page.eval(`!document.querySelector(${JSON.stringify(sel)}).hidden`);
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
const finView = page => page.waitFor("!document.getElementById('vsFinView').hidden", 5000);
const resultShown = page => page.waitFor("['승리', '패배', '무승부'].includes(document.getElementById('vsFinTitle').textContent)", 5000);
// 방을 만들고 상대가 들어와 둘 다 달리고 끝나 결과가 나온 상태(상대는 0.5초, 나는 조금 더)까지 간다
async function toResult(page, { oppLeaves = false } = {}) {
  const id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page); await sleep(300);
  if (oppLeaves) { store.leave(id, OPP.id); await sleep(200); }
  await die(page); await finView(page);
  if (!oppLeaves) store.finish(id, OPP.id, { survivalSec: 0.5, score: 0, wordCount: 1, continued: false });
  await resultShown(page);
  return id;
}

test('다시 하기(내가 먼저): 단추 → POST rematch → "상대의 다시 하기를 기다리는 중" → 상대가 누르면 준비 화면(round 2, 결과 없음). 새 판의 start·state·finish 에 round 2 를 보낸다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await toResult(page);
  assert.equal(await shown(page, '#vsFinRematch'), true); assert.equal(await text(page, '#vsFinRematch'), '다시 하기');
  const wordsR1 = await page.eval('SpellRun.G.words.map(w => w.word).join()');
  assert.equal(await text(page, '#vsFinRematchNote'), '', '아무도 누르기 전에는 안내 없음');
  await click(page, '#vsFinRematch');
  await page.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('상대의 다시 하기를 기다리는 중')", 4000);
  assert.equal(calls('POST', /\/rematch$/).length, 1);
  assert.equal(await shown(page, '#vsFinRematch'), false, '눌렀으면 단추는 숨는다');
  assert.equal(await page.eval("document.activeElement && document.getElementById('vsFinView').contains(document.activeElement)"), true, '포커스는 결과 화면 안에 남는다');
  assert.equal(store._rooms.get(id).round, 1, '한쪽만 눌렀으니 새 판 아님');
  assert.equal(await text(page, '#vsFinTitle').then(t => ['승리', '패배', '무승부'].includes(t)), true, '결과는 그대로 보인다');
  await sleep(400);
  assert.equal(calls('POST', /\/rematch$/).length, 1, '기다리는 동안 다시 부르지 않는다');
  assert.ok(calls('GET', /rooms\/[0-9a-f]{24}$/).length >= 3, '결과 대기 중에도 조회가 이어진다');
  store.rematch(id, OPP.id);   // 상대가 누른다
  await page.waitFor("!document.getElementById('vsRoomView').hidden && SpellRun.vs.state.round === 2", 4000);
  assert.equal(await text(page, '#vsGo'), '시작'); assert.equal(await page.eval("document.getElementById('vsFinView').hidden"), true);
  assert.match(await text(page, '#vsRoomText'), /두 사람이 모였어요/);
  assert.equal(await page.eval('SpellRun.vs.game.on'), false); assert.equal(await page.eval('SpellRun.CONFIG.CONT_ENABLED'), true);
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'vsGo', '준비 화면에서 시작 단추에 포커스');
  assert.equal(store.view(store._rooms.get(id), ME.id).result, null);
  // 새 판: 각자 단어 순서를 다시 정하고 round 2 를 보낸다
  store.start(id, OPP.id, 12, 2);
  state.requests.length = 0;
  await click(page, '#vsGo'); await running(page);
  assert.deepEqual(calls('POST', /\/start$/)[0].body, { wordCount: 12, round: 2 });
  await sleep(500);
  assert.ok(stateCalls().length >= 1 && stateCalls().every(c => c.body.round === 2), 'state 에 round 2');
  await die(page); await finView(page);
  await sleep(300);
  const fin = calls('POST', /\/finish$/); assert.equal(fin.length, 1); assert.equal(fin[0].body.round, 2);
  const wordsR2 = await page.eval('SpellRun.G.words.map(w => w.word).join()');
  assert.notEqual(wordsR2, wordsR1, '새 판은 단어 순서를 다시 정한다(같을 확률은 거의 없다)');
  store.finish(id, OPP.id, { survivalSec: 0.3, score: 0, wordCount: 1, continued: false, round: 2 });
  await resultShown(page);
  assert.equal(await shown(page, '#vsFinRematch'), true, '둘째 판 결과에서도 다시 하기 가능');
  assert.equal(await page.eval('SpellRun.vs.state.round'), 2);
  await page.close();
});

test('다시 하기(상대가 먼저): "상대가 다시 하기를 원해요" → 누르면 응답이 곧 새 판. 동시에 눌러도 새 판은 한 번만 열린다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  let id = await toResult(page);
  store.rematch(id, OPP.id);
  await page.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('상대가 다시 하기를 원해요')", 4000);
  assert.equal(await shown(page, '#vsFinRematch'), true);
  await click(page, '#vsFinRematch');
  await page.waitFor("!document.getElementById('vsRoomView').hidden && SpellRun.vs.state.round === 2", 4000);
  assert.equal(store._rooms.get(id).round, 2);
  assert.deepEqual([playerOf(id, ME.id).rematch, playerOf(id, OPP.id).rematch], [false, false]);
  await page.close();

  resetState();
  page = await openGame();
  id = await toResult(page);
  await Promise.all([click(page, '#vsFinRematch'), Promise.resolve().then(() => store.rematch(id, OPP.id))]);   // 같은 순간
  await page.waitFor("!document.getElementById('vsRoomView').hidden && SpellRun.vs.state.round === 2", 4000);
  await sleep(400);
  assert.equal(store._rooms.get(id).round, 2, '새 판은 한 번만'); assert.equal(await page.eval('SpellRun.vs.state.round'), 2);
  await page.close();
});

test('다시 하기가 막히는 경우: 상대가 나감 / 상대 연결 끊김 / 방이 사라짐 은 단추를 숨기고 이유를 한 줄 보인다', { skip: SKIP }, async () => {
  // 상대가 결과를 보고 나감
  resetState();
  let page = await openGame();
  let id = await toResult(page);
  store.leave(id, OPP.id);
  await page.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('나가서 다시 할 수 없어요')", 4000);
  assert.equal(await shown(page, '#vsFinRematch'), false);
  assert.equal(calls('POST', /\/rematch$/).length, 0);
  assert.equal(await shown(page, '#vsFinRooms'), true, '방 목록으로는 계속 가능');
  assert.doesNotMatch(await text(page, '#vsFinNote'), /중간에 나갔어요/, '끝난 뒤 나간 것은 중도 퇴장이 아니다');
  await page.close();

  // 상대 연결 끊김(30초 넘게 신호 없음)
  resetState();
  page = await openGame();
  id = await toResult(page);
  clockOffset = 31000;   // 내 조회는 계속 신호가 되고, 상대는 신호가 없다
  await page.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('연결이 끊겨')", 4000);
  assert.equal(await shown(page, '#vsFinRematch'), false);
  await page.close();

  // 방이 사라짐(서버 재시작 또는 정리)
  resetState();
  page = await openGame();
  id = await toResult(page);
  store._rooms.clear();
  await page.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('방이 사라져')", 4000);
  assert.equal(await shown(page, '#vsFinRematch'), false);
  assert.equal(await shown(page, '#vsFinRooms'), true);
  assert.match(await text(page, '#vsFinTitle'), /승리|패배|무승부/, '이미 나온 결과는 그대로');
  await click(page, '#vsFinRooms');
  await page.waitFor("!document.getElementById('vsListView').hidden");
  await page.close();

  // 누르는 순간 막힘(409): 사유를 보인다
  resetState();
  page = await openGame();
  id = await toResult(page);
  state.override['POST rematch'] = { status: 409, body: { error: '상대의 연결이 끊겨 있어서 다시 할 수 없어요.', code: 'rematch_offline' }, times: 1 };
  await click(page, '#vsFinRematch');
  await page.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('연결이 끊겨')", 4000);
  await page.close();
});

test('판 번호 409: 상태 신호가 round_mismatch 를 받으면 방을 다시 조회해 새 판 준비 화면으로 맞춘다(게임·신호 정지). start 의 판 번호 불일치는 방 상태를 새로 맞추고 시작하지 않는다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  let id = await makeRoom(page);
  joinOpp(id);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page);
  await sleep(300);
  assert.equal(await page.eval('SpellRun.vs.game.round'), 1);
  // 서버만 다음 판으로 넘어갔다(내 클라이언트는 아직 1판)
  const room = store._rooms.get(id); room.round = 2;
  await page.waitFor("!document.getElementById('vsRoomView').hidden && SpellRun.vs.state.round === 2", 4000);
  assert.equal(await page.eval('SpellRun.G.state'), 'over', '이전 판 게임은 멈춘다');
  assert.equal(await page.eval("document.getElementById('vsBar').hidden && document.getElementById('vsQuitBtn').hidden"), true);
  const n = stateCalls().length; await sleep(500);
  assert.equal(stateCalls().length, n, '이전 판 신호는 더 보내지 않는다');
  assert.ok(calls('GET', /rooms\/[0-9a-f]{24}$/).length >= 1, '방 상태를 다시 조회했다');
  await page.close();

  // start 에서 불일치
  resetState();
  page = await openGame();
  id = await makeRoom(page);
  joinOpp(id);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작' && SpellRun.vs.state.round === 1");
  store._rooms.get(id).round = 3;
  await click(page, '#vsGo');
  await page.waitFor("SpellRun.vs.state.round === 3", 4000);
  assert.notEqual(await page.eval('SpellRun.G.state'), 'run');
  assert.match(await text(page, '#vsMsg'), /새로 맞췄어요/);
  assert.equal(await shown(page, '#vsRoomView'), true);
  assert.equal(playerOf(id, ME.id).started, false);
  await page.close();
});

test('끊김 복귀: 서버가 내 판을 끊김으로 종료하면 게임을 멈추고 "연결이 끊겨 종료됐어요"와 서버가 기록한 점수·푼 단어 수를 보인다. 결과가 나오면 끊김 표시와 함께 다시 하기를 안내한다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page);
  await page.eval("SpellRun.manual = true; (() => { const G = SpellRun.G; G.score = 400; G.wi = 4; G.hp = G.hp - 1; SpellRun.vs.renderHearts(); })()");
  for (let i = 0; i < 40 && !stateCalls().some(c => c.body.score === 400); i++) await sleep(50);
  assert.ok(stateCalls().some(c => c.body.score === 400 && c.body.wordNo === 5), '마지막 상태가 서버에 닿음');
  clockOffset = 31000; store._rooms.get(id).guest.lastSignal = Date.now() + clockOffset;   // 내 신호만 오래됐다
  await finView(page);
  assert.equal(await page.eval('SpellRun.G.state'), 'over', '게임 정지');
  assert.match(await text(page, '#vsFinNote'), /연결이 끊겨 종료됐어요/);
  const t = await page.eval("document.getElementById('vsFinList').innerText");
  assert.match(t, /점수 400/); assert.match(t, /푼 단어 4개/); assert.match(t, /연결 끊김/);
  assert.equal(await shown(page, '#vsFinRematch'), false, '결과가 나오기 전에는 다시 하기 없음');
  assert.equal(calls('POST', /\/finish$/).length, 0);
  store.finish(id, OPP.id, { survivalSec: 2, score: 0, wordCount: 1, continued: false });
  await resultShown(page);
  assert.match(await text(page, '#vsFinNote'), /연결이 끊겨 종료됐어요/);
  assert.match(await page.eval("document.getElementById('vsFinList').innerText"), /점수 400[\s\S]*연결 끊김/);
  assert.equal(await shown(page, '#vsFinRematch'), true, '방과 상대가 있으면 다시 하기 가능');
  await click(page, '#vsFinRematch');
  await page.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('기다리는 중')", 4000);
  assert.equal(playerOf(id, ME.id).rematch, true, '끊김으로 끝난 사람도 돌아와 다시 하기를 누를 수 있다');
  await page.close();
});

test('방 소실(404) 게임 중: 게임은 계속 달리고 상단 쪽 안내는 한 번만, 신호는 멈추며, 끝나면 "겨루지 못했어요"와 내 기록·방 목록으로. finish 는 보내지 않는다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  await sleep(300);
  store._rooms.clear();   // 서버 재시작
  await page.waitFor("SpellRun.vs.game.roomGone === true", 4000);
  assert.equal(await text(page, '#vsToast'), '방 연결이 끊겨 기록은 남지 않아요'); assert.equal(await shown(page, '#vsToast'), true);
  assert.ok(['run', 'intro'].includes(await page.eval('SpellRun.G.state')), '게임은 멈추지 않는다');
  assert.equal(await text(page, '#vsBarStats'), '기록은 남지 않아요');
  const n = stateCalls().length; await sleep(800);
  assert.equal(stateCalls().length, n, '방이 없으니 신호를 더 보내지 않는다');
  await sleep(3200);
  assert.equal(await shown(page, '#vsToast'), false, '안내는 잠깐만, 다시 뜨지 않는다');
  assert.ok(['run', 'intro'].includes(await page.eval('SpellRun.G.state')));
  await die(page); await finView(page);
  assert.equal(await text(page, '#vsFinTitle'), '방이 사라져 결과를 겨루지 못했어요.');
  const t = await page.eval("document.getElementById('vsFinList').innerText");
  assert.match(t, /생존 \d+:\d\d\.\d/); assert.match(t, /점수 \d+/); assert.match(t, /푼 단어 \d+개/);
  assert.equal(calls('POST', /\/finish$/).length, 0, '사라진 방에는 finish 를 보내지 않는다');
  assert.equal(await shown(page, '#vsFinRematch'), false);
  assert.equal(await shown(page, '#vsFinRooms'), true);
  await click(page, '#vsFinRooms');
  await page.waitFor("!document.getElementById('vsListView').hidden");
  assert.equal(await page.eval('SpellRun.vs.game.on'), false);
  await page.close();

  // 끝나는 순간에 처음 404 를 만나는 경우: finish 가 404
  resetState();
  const p2 = await openGame();
  await makeRoom(p2);
  await click(p2, '#vsGo'); await running(p2);
  await p2.eval("SpellRun.manual = true; clearInterval(SpellRun.vs.game.timer)");   // 신호를 멈춰 finish 가 첫 접촉이 되게
  await sleep(300);
  store._rooms.clear();
  await die(p2); await p2.eval("SpellRun.manual = false");
  await finView(p2);
  await p2.waitFor("document.getElementById('vsFinTitle').textContent === '방이 사라져 결과를 겨루지 못했어요.'", 5000);
  assert.equal(calls('POST', /\/finish$/).length, 1);
  await p2.close();
});

test('방 소실(404) 결과 대기 중과 방 화면: 같은 문구와 목록 복귀(결과 대기는 내 기록도 보임)', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  let id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page);
  await die(page); await finView(page);
  await sleep(300);
  assert.match(await text(page, '#vsFinTitle'), /결과를 기다리는 중/);
  store._rooms.clear();
  await page.waitFor("document.getElementById('vsFinTitle').textContent === '방이 사라져 결과를 겨루지 못했어요.'", 4000);
  assert.match(await page.eval("document.getElementById('vsFinList').innerText"), /점수/);
  assert.equal(await shown(page, '#vsFinRooms'), true);
  const n = calls('GET', /rooms\/[0-9a-f]{24}$/).length; await sleep(400);
  assert.equal(calls('GET', /rooms\/[0-9a-f]{24}$/).length, n, '조회를 멈춘다');
  await click(page, '#vsFinRooms');
  await page.waitFor("!document.getElementById('vsListView').hidden");
  await page.close();

  resetState();
  page = await openGame();
  await makeRoom(page);
  store._rooms.clear();
  await page.waitFor("!document.getElementById('vsListView').hidden", 4000);
  assert.equal(await text(page, '#vsMsg'), '방이 사라져 결과를 겨루지 못했어요.');
  assert.equal(await page.eval('SpellRun.vs.state.roomId'), null);
  await page.close();
});

test('게임 중 나가기: 단추 → 확인 대화상자(포커스 계속 달리기) → 시간 정지(신호는 계속) → 계속하면 재개, Esc 도 계속, 나가기면 leave 후 방 목록. 대화상자 위에서는 점프하지 않는다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  assert.equal(await shown(page, '#vsQuitBtn'), false, '게임 전에는 없다');
  await click(page, '#vsGo'); await running(page);
  await page.waitFor("!document.getElementById('vsQuitBtn').hidden");
  assert.equal(await text(page, '#vsQuitBtn'), '나가기');
  await sleep(300);
  await click(page, '#vsQuitBtn');
  assert.equal(await shown(page, '#vsQuit'), true);
  assert.equal(await text(page, '#vsQuitText'), '나가면 지금 기록으로 종료돼요. 나갈까요?');
  assert.equal(await page.eval('document.activeElement.id'), 'vsQuitStay', '실수로 나가지 않게 처음 포커스는 계속 달리기');
  const t0 = await page.eval('SpellRun.G.time - SpellRun.G.startTime');
  const sends = stateCalls().length;
  await sleep(800);
  const t1 = await page.eval('SpellRun.G.time - SpellRun.G.startTime');
  assert.ok(Math.abs(t1 - t0) < 0.02, '대화상자가 열린 동안 게임 시간은 멈춘다: ' + (t1 - t0));
  assert.ok(stateCalls().length > sends, '연결 유지를 위한 상태 신호는 계속 간다');
  await page.eval("document.getElementById('vsQuit').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
  assert.equal(await page.eval('SpellRun.G.jumpT'), -1, '대화상자 위의 탭은 점프가 아니다');
  // Tab 은 두 단추 사이만 돈다
  await page.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))");
  assert.equal(await page.eval('document.activeElement.id'), 'vsQuitGo');
  await page.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))");
  assert.equal(await page.eval('document.activeElement.id'), 'vsQuitStay');
  // 계속 달리기 → 시간 재개, 포커스는 나가기 단추로
  await click(page, '#vsQuitStay');
  assert.equal(await shown(page, '#vsQuit'), false); assert.equal(await page.eval('document.activeElement.id'), 'vsQuitBtn');
  await sleep(500);
  const t2 = await page.eval('SpellRun.G.time - SpellRun.G.startTime');
  assert.ok(t2 - t1 > 0.3, '재개 후 시간이 흐른다: ' + (t2 - t1));
  assert.equal(calls('POST', /\/leave$/).length, 0);
  // Esc = 계속 달리기
  await click(page, '#vsQuitBtn');
  await page.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
  assert.equal(await shown(page, '#vsQuit'), false); assert.equal(await shown(page, '#vs'), false, 'Esc 가 대결 화면 닫기로 번지지 않는다');
  assert.ok(['run', 'intro'].includes(await page.eval('SpellRun.G.state')));
  // 나가기
  await click(page, '#vsQuitBtn'); await click(page, '#vsQuitGo');
  await page.waitFor("!document.getElementById('vsListView').hidden", 4000);
  assert.equal(calls('POST', /\/leave$/).length, 1);
  assert.equal(calls('POST', /\/finish$/).length, 0);
  assert.equal(await page.eval('SpellRun.G.state'), 'over');
  assert.equal(await page.eval("document.getElementById('vsBar').hidden && document.getElementById('vsQuitBtn').hidden && document.getElementById('vsQuit').hidden"), true);
  assert.equal(await page.eval('SpellRun.vs.game.on'), false); assert.equal(await page.eval('SpellRun.CONFIG.CONT_ENABLED'), true);
  const me = playerOf(id, ME.id); assert.equal(me.left, true); assert.equal(me.finished, true, '지금 기록으로 종료'); assert.ok(me.survivalSec > 0.5);
  assert.equal(playerOf(id, OPP.id).left, false);
  await page.close();
});

test('이어하기 선택 화면이 떠 있는 동안 나가기 단추는 화면 아래로 가려져 눌리지 않고, 확인 대화상자가 열려도 마찬가지', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  await page.waitFor("!document.getElementById('vsQuitBtn').hidden");
  const probe = "(() => { const r = document.getElementById('vsQuitBtn').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && (e.id || e.closest('section').id); })()";
  assert.equal(await page.eval(probe), 'vsQuitBtn', '평소에는 눌린다');
  await page.eval("(() => { const G = SpellRun.G; G.hp = 0; G.state = 'run'; })()");
  await page.eval("document.getElementById('cont').hidden = false; SpellRun.G.state = 'choice'");
  assert.equal(await page.eval(probe), 'cont', '이어하기 선택 화면이 위를 덮는다');
  await page.close();
});

test('finish 실패: 재시도가 끝내 실패하면 "다시 보내기"와 "그냥 나가기". 다시 보내기는 같은 값(멱등)으로 성공하면 결과 대기로 이어진다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  let id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page);
  state.override['POST finish'] = { status: 500, body: { error: 'x' } };
  await die(page); await finView(page);
  await page.waitFor("document.getElementById('vsFinNote').textContent.includes('보내지 못했어요')", 5000);
  assert.equal(calls('POST', /\/finish$/).length, 2);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#vsFinView button:not([hidden])')].map(b => b.textContent)"), ['다시 보내기', '그냥 나가기', '대결 화면 닫기']);
  assert.equal(await page.eval('document.activeElement.id'), 'vsFinRetry');
  const body1 = calls('POST', /\/finish$/)[0].body;
  await click(page, '#vsFinRetry');   // 또 실패
  for (let i = 0; i < 40 && calls('POST', /\/finish$/).length < 3; i++) await sleep(50);
  await sleep(200);
  assert.equal(calls('POST', /\/finish$/).length, 3, '다시 보내기는 한 번 호출');
  assert.equal(await shown(page, '#vsFinRetry'), true, '또 실패하면 단추가 남는다'); assert.equal(await page.eval("document.getElementById('vsFinRetry').disabled"), false);
  assert.deepEqual(calls('POST', /\/finish$/)[2].body, body1, '같은 값을 보낸다');
  delete state.override['POST finish'];
  await click(page, '#vsFinRetry');
  await page.waitFor("document.getElementById('vsFinRetry').hidden && document.getElementById('vsFinRooms').textContent === '방 목록으로'", 4000);
  assert.equal(playerOf(id, ME.id).finished, true); assert.equal(calls('POST', /\/finish$/).length, 4);
  assert.match(await text(page, '#vsFinTitle'), /결과를 기다리는 중/);
  store.finish(id, OPP.id, { survivalSec: 0.2, score: 0, wordCount: 1, continued: false });
  await resultShown(page);
  await page.close();

  // 그냥 나가기
  resetState();
  page = await openGame();
  id = await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  state.override['POST finish'] = { status: 500, body: { error: 'x' } };
  await die(page);
  await page.waitFor("document.getElementById('vsFinNote').textContent.includes('보내지 못했어요')", 5000);
  await click(page, '#vsFinRooms');
  await page.waitFor("!document.getElementById('vsListView').hidden", 4000);
  assert.equal(calls('POST', /\/leave$/).length, 1);
  await page.close();
});

test('상대가 도중에 나가면 결과 화면에 "상대가 중간에 나갔어요"(판정은 서버 결과 그대로). 다시 하기는 막힌다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  const id = await makeRoom(page);
  joinOpp(id); store.start(id, OPP.id, 12);
  await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
  await click(page, '#vsGo'); await running(page);
  await sleep(300);
  store.leave(id, OPP.id);   // 상대가 달리다가 나간다
  await page.waitFor("document.getElementById('vsBarName').textContent.includes('나감')", 4000);
  await sleep(1800); await die(page); await finView(page);
  await resultShown(page);
  assert.match(await text(page, '#vsFinNote'), /상대가 중간에 나갔어요/);
  const server = store.view(store._rooms.get(id), ME.id).result;
  assert.equal(await text(page, '#vsFinTitle'), { me: '승리', opponent: '패배', draw: '무승부' }[server.winner], '판정은 서버 결과 그대로');
  assert.equal(server.leftMid.opponent, true);
  assert.match(await text(page, '#vsFinRematchNote'), /나가서 다시 할 수 없어요/); assert.equal(await shown(page, '#vsFinRematch'), false);
  await page.close();
});

test('409 안내: 이미 만든 방이 있을 때 / 끝났거나 가득 찬 방 참가. 같은 안내를 연달아 다시 쓰지 않고, 참가 실패 뒤 목록을 새로 조회한다', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame();
  await click(page, '#modeRow [data-mode=versus]');
  await page.waitFor("!document.getElementById('vs').hidden");
  state.override['POST rooms'] = { status: 409, body: { error: '이미 만든 방이나 참가 중인 방이 있습니다.', code: 'has_room' } };
  await page.eval("window.__mc = 0; new MutationObserver(m => { window.__mc += m.length; }).observe(document.getElementById('vsMsg'), { childList: true, characterData: true, subtree: true })");
  await click(page, '#vsCreate');
  await page.waitFor("document.getElementById('vsMsg').textContent.includes('이미 만든 방이 있어요')", 4000);
  assert.equal(await text(page, '#vsMsg'), '이미 만든 방이 있어요. 목록에서 내 방으로 들어가거나 취소해 주세요.');
  assert.equal(await shown(page, '#vsListView'), true);
  const mc = await page.eval('window.__mc');
  await sleep(300);
  await click(page, '#vsCreate');   // 같은 실패가 연달아 와도
  await sleep(500);
  assert.equal(await page.eval('window.__mc'), mc, '같은 안내는 다시 쓰이지 않는다(스크린리더가 되풀이하지 않는다)');
  await page.close();

  resetState();
  const other = store.create({ id: 99, name: '철수' }).room;
  page = await openGame();
  await click(page, '#modeRow [data-mode=versus]');
  await page.waitFor("document.querySelectorAll('#vsList li').length === 1");
  store.leave(other.id, 99);   // 목록을 보는 사이 방이 닫혔다
  const g0 = calls('GET', /\/api\/versus\/rooms$/).length;
  await click(page, '#vsList button');
  await page.waitFor("document.getElementById('vsMsg').textContent === '이미 끝났거나 가득 찬 방이에요.'", 4000);
  assert.equal(await shown(page, '#vsListView'), true);
  await page.waitFor("document.querySelectorAll('#vsList li').length === 0", 4000);
  assert.ok(calls('GET', /\/api\/versus\/rooms$/).length > g0, '목록을 새로 조회했다');
  assert.equal(await text(page, '#vsMsg'), '이미 끝났거나 가득 찬 방이에요.', '목록 조회가 성공해도 이 안내는 남는다');
  await page.close();
});

test('새 단추·대화상자: 움직임 줄이기에 걸리는 애니메이션·전환이 없고 이모지가 없다. 터치 영역 44px 이상', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame();
  await makeRoom(page);
  await click(page, '#vsGo'); await running(page);
  await page.waitFor("!document.getElementById('vsQuitBtn').hidden");
  const m = await page.eval(`(() => {
    const out = {};
    for (const id of ['vsQuitBtn', 'vsQuitStay', 'vsQuitGo', 'vsFinRematch', 'vsFinRetry']) {
      const e = document.getElementById(id), cs = getComputedStyle(e);
      const hid = []; for (let p = e; p && p.id !== 'box'; p = p.parentElement) if (p.hidden) { hid.push(p); p.hidden = false; }
      const r = e.getBoundingClientRect(); hid.forEach(p => { p.hidden = true; });
      out[id] = { w: Math.round(r.width), h: Math.round(r.height), anim: cs.animationName, trans: cs.transitionDuration };
    }
    return out;
  })()`);
  for (const [id, v] of Object.entries(m)) { assert.ok(v.w >= 44 && v.h >= 44, id + ' 터치 영역 ' + v.w + 'x' + v.h); assert.equal(v.anim, 'none', id); }
  const html = fs.readFileSync(path.join(PUB, 'spelling_run.html'), 'utf8') + fs.readFileSync(path.join(PUB, 'js', 'spellrun', 'game.js'), 'utf8');
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u, '이모지 없음');
  await page.close();
});

for (const [w, h] of [[320, 568], [360, 568], [390, 568], [320, 640], [360, 640], [390, 640], [320, 740], [360, 740], [390, 740]]) {
  test(`나가기 단추 배치 ${w}x${h}: 상자 안, 터치 44px 이상, 막대·HUD·뜻·글자 칸·팝업·안내와 겹치지 않고, 러너와 떨어져 있다`, { skip: SKIP }, async () => {
    resetState();
    const page = await openGame({ width: w, height: h });
    const id = await makeRoom(page);
    joinOpp(id); store.start(id, OPP.id, 12);
    store.state(id, OPP.id, { score: 123456, combo: 12, hp: 5, maxHp: 5, wordNo: 123, continued: false });
    await page.waitFor("document.getElementById('vsGo').textContent === '시작'");
    await click(page, '#vsGo'); await running(page);
    await page.waitFor("document.getElementById('vsBarStats').textContent.includes('123,456')", 4000);
    await page.eval("(() => { const p = document.getElementById('pop'); p.hidden = false; document.getElementById('popTag').textContent = 'TAG'; document.getElementById('popWord').textContent = 'bridgebridgebridge'; document.getElementById('popMean').textContent = '아주 긴 뜻이 들어가는 팝업 확인용 문장입니다 아주 긴'; document.getElementById('popNote').textContent = '안내'; const t = document.getElementById('vsToast'); t.textContent = '방 연결이 끊겨 기록은 남지 않아요'; t.hidden = false; })()");
    const m = await page.eval(`(() => {
      const r = id => document.getElementById(id).getBoundingClientRect(), q = r('vsQuitBtn'), box = r('box'), u = parseFloat(getComputedStyle(document.getElementById('box')).getPropertyValue('--u'));
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const ids = ['hearts', 'score', 'progress', 'snd', 'hintbox', 'word', 'pop', 'vsBar', 'vsToast'];
      const kids = [...document.querySelectorAll('#hud .slot, #hud .cell')].map(e => e.getBoundingClientRect());
      const bar = r('vsBar'), toast = r('vsToast');
      const cx = q.left + q.width / 2, cy = q.top + q.height / 2, top = document.elementFromPoint(cx, cy);
      return { w: q.width, h: q.height, inBox: q.left >= box.left && q.right <= box.right + 0.5 && q.top >= box.top && q.bottom <= box.bottom + 0.5,
        overlap: ids.filter(i => !document.getElementById(i).hidden && hit(q, r(i))), overlapKids: kids.some(k => hit(q, k)),
        gapBar: bar.top - q.bottom, gapEdge: box.right - q.right, gapToast: q.left - toast.right, toastInBox: toast.left >= box.left && toast.right <= box.right && toast.top >= box.top,
        topTag: top && (top.id || top.tagName), runnerRight: (SpellRun.RUNNER_X + 40) * u + box.left, qLeft: q.left, qTopFromBox: q.top - box.top, ground: 520 * u, u,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, barH: bar.height, boxH: box.height };
    })()`);
    assert.ok(m.w >= 43.5 && m.h >= 43.5, '터치 영역 44px 이상: ' + JSON.stringify(m));
    assert.ok(m.inBox, JSON.stringify(m));
    assert.deepEqual(m.overlap, [], '가리는 요소: ' + JSON.stringify(m));
    assert.equal(m.overlapKids, false);
    assert.ok(m.gapBar >= 4, '막대와 간격 4px 이상: ' + m.gapBar);
    assert.ok(m.gapEdge >= 8, '상자 가장자리와 간격: ' + m.gapEdge);
    assert.ok(m.gapToast >= 4, '안내 줄과 간격: ' + m.gapToast);
    assert.ok(m.toastInBox);
    assert.equal(m.topTag, 'vsQuitBtn', '눌리는 가장 위 요소');
    assert.ok(m.qLeft > m.runnerRight, '러너 쪽 탭 영역과 떨어져 있다: ' + JSON.stringify(m));
    assert.ok(m.overflowX <= 0);
    console.log(`[측정] ${w}x${h}: 나가기 ${Math.round(m.w)}x${Math.round(m.h)}px, 상자 위 ${Math.round(m.qTopFromBox)}px(땅 ${Math.round(m.ground)}px), 막대와 ${Math.round(m.gapBar)}px, 오른쪽 ${Math.round(m.gapEdge)}px, 안내 줄과 ${Math.round(m.gapToast)}px, u=${m.u.toFixed(2)}`);
    await page.close();
  });
}
