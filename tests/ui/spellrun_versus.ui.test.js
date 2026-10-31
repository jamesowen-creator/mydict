// 작업344: 스펠링 런 대결 입구(권한에 따른 버튼, 방 목록·만들기·참가·대기·준비, 오류 처리, 폴링 중지, 나가기·닫기 leave).
// 헤드리스 Chrome 360×640. 자체 임시 서버에 모의 /api/me·/api/wordbook·/api/versus/rooms 만 둔다 — 실제 서버와 운영 서버에는 요청하지 않는다.
// 실행: node --test tests/ui/spellrun_versus.ui.test.js   (Chrome이 없으면 건너뜀)
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

const WORDS = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'garden', 'planet', 'river', 'cloud', 'bridge'];
const mkRows = n => WORDS.slice(0, n).map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));
const ROOM_ID = 'a'.repeat(24), OTHER_ID = 'b'.repeat(24);
const roomView = (status, opp) => ({ ok: true, room: { id: ROOM_ID, status, isHost: true, ageSec: 3 }, me: { name: '테스터' }, opponent: opp ? { name: opp, left: false } : null, result: null });

let srv, base, browser;
const state = {};
function resetState() {
  Object.assign(state, {
    me: { id: 7, role: 'user', can_wordbook: true, perm_versus: true }, rows: mkRows(12), requests: [],
    list: { status: 200, body: { ok: true, rooms: [] } },
    create: { status: 200, body: { ok: true, roomId: ROOM_ID } },
    join: { status: 200, body: roomView('full', '방장') },
    room: { status: 200, body: roomView('open', null) },
    leave: { status: 200, body: { ok: true } },
  });
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
        state.requests.push({ method: req.method, url: u, auth: req.headers.authorization || null, body: Buffer.concat(chunks).toString('utf8') });
        if (u === '/api/me') return json(200, state.me);
        if (u === '/api/wordbook' && req.method === 'GET') return json(200, state.rows);
        if (u === '/api/tts') return json(503, { error: 'mock' });
        const reply = r => json(r.status, r.body);
        if (u === '/api/versus/rooms') return req.method === 'GET' ? reply(state.list) : reply(state.create);
        let m;
        if ((m = u.match(/^\/api\/versus\/rooms\/([0-9a-f]{24})(\/join|\/leave)?$/))) {
          if (m[2] === '/join') return reply(state.join);
          if (m[2] === '/leave') return reply(state.leave);
          return reply(state.room);
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

// 게임 페이지를 연다(단어 id 는 sessionStorage 로). 조회 간격은 시험이 짧게 바꿔 쓴다.
async function openGame({ width = 360, height = 640 } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); } catch (e) {}" });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(state.rows.map(r => r.id)))}); } catch (e) {}` });
  // 작업379: 이 페이지가 보낸 대결 조회(GET)의 시각을 페이지 안에서 기록한다(요청은 바꾸지 않는다). Page.close() 는 탭을 닫지 않고 연결만 끊으므로 앞선 시험의 탭이 같은 모의 서버에 계속 조회를 보낸다 — 서버가 받은 요청 수로는 이 페이지의 조회와 구분할 수 없다.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__sentGets = []; const of = window.fetch; window.fetch = function (u, o) { if (/versus/.test(String(u)) && (!o || !o.method || o.method === 'GET')) window.__sentGets.push(performance.now()); return of.apply(this, arguments); };" });
  await page.goto(base + '/spelling_run.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled || document.getElementById('gateMsg').textContent !== '불러오는 중...'", 8000);
  return page;
}
const fast = page => page.eval('(() => { const t = SpellRun.vs.T; t.list = 60; t.room = 60; t.backoff = 250; })()');
const openVs = async page => { await page.eval("document.querySelector('#modeRow button[data-mode=\"versus\"]').click()"); await page.waitFor("!document.getElementById('vs').hidden"); };
const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const waitFor = (page, cond, ms = 4000) => page.waitFor(cond, ms);
const visible = (page, id) => page.eval(`!document.getElementById(${JSON.stringify(id)}).hidden`);
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);

test('권한이 없으면 모드 버튼에 "대결" 이 없고, 있으면 기본·생존 옆에 생긴다(관리자는 role 로도). 기본/생존의 저장 키는 그대로', { skip: SKIP }, async () => {
  resetState(); state.me = { id: 7, role: 'user', can_wordbook: true, perm_versus: false };
  let page = await openGame();
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#modeRow button')].map(b => b.dataset.mode)"), ['normal', 'survival']);
  await page.close();

  resetState();
  page = await openGame();
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#modeRow button')].map(b => b.dataset.mode)"), ['normal', 'survival', 'versus']);
  assert.equal(await page.eval("document.querySelector('#modeRow button[data-mode=\"versus\"]').hasAttribute('aria-pressed')"), false, '대결은 모드가 아니라 입구 버튼');
  await click(page, '#modeRow button[data-mode="survival"]');
  assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), 'survival');
  await openVs(page);
  assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), 'survival', '대결을 눌러도 저장값은 그대로(저장하지 않음)');
  await page.close();

  resetState(); state.me = { id: 7, role: 'admin', can_wordbook: true };
  page = await openGame();
  assert.equal(await page.eval("!!document.querySelector('#modeRow button[data-mode=\"versus\"]')"), true, '관리자는 열 값이 없어도 보임');
  await page.close();
});

test('방 목록: 빈 목록 안내, 방 행(방장 이름·경과 시간·달리는 중 여부·참가), 토큰 전송, 360×640 에서 핵심 버튼이 화면 안에 보이고 카드가 스크롤되지 않는다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "!document.getElementById('vsEmpty').hidden");
  assert.match(await text(page, '#vsEmpty'), /방을 만들어/);
  assert.equal(await page.eval("document.getElementById('start').hidden"), true, '대결 화면이 열리면 시작 카드는 숨김');
  state.list = { status: 200, body: { ok: true, rooms: [
    { id: ROOM_ID, hostName: '민수', elapsedSec: 75, hostRunning: false, mine: false },
    { id: OTHER_ID, hostName: '지은', elapsedSec: 9, hostRunning: true, mine: false },
    { id: 'c'.repeat(24), hostName: '하나', elapsedSec: 3, hostRunning: false, mine: false },
  ] } };
  await waitFor(page, "document.querySelectorAll('#vsList li').length === 3");
  const rows = await page.eval("[...document.querySelectorAll('#vsList li')].map(li => ({ t: li.innerText.replace(/\\s+/g, ' '), dis: li.querySelector('button').disabled, label: li.querySelector('button').textContent }))");
  assert.match(rows[0].t, /민수/); assert.match(rows[0].t, /1:15/); assert.match(rows[0].t, /대기 중/); assert.equal(rows[0].label, '참가'); assert.equal(rows[0].dis, false);
  assert.match(rows[1].t, /지은/); assert.match(rows[1].t, /달리는 중/); assert.equal(rows[1].dis, false, '작업347: 방장이 달리는 중이어도 참가할 수 있다(합의)');
  assert.equal(await visible(page, 'vsEmpty'), false);
  assert.ok(calls('GET', /^\/api\/versus\/rooms$/).every(r => /^Bearer /.test(r.auth || '')), '목록 요청에 토큰');
  // 360×640: 상단 버튼과 닫기가 상자 안에 보이고 카드는 스크롤되지 않는다
  const g = await page.eval(`(() => {
    const box = document.getElementById('box').getBoundingClientRect(), card = document.querySelector('#vs .card');
    const inBox = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5; };
    const h = id => document.getElementById(id).getBoundingClientRect().height;
    return { create: inBox('vsCreate'), close: inBox('vsClose'), refresh: inBox('vsRefresh'), scroll: card.scrollHeight - card.clientHeight, hCreate: h('vsCreate'), hClose: h('vsClose'), hJoin: document.querySelector('#vsList button').getBoundingClientRect().height, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`);
  assert.ok(g.create && g.close && g.refresh, JSON.stringify(g));
  assert.ok(g.scroll <= 1, '카드 스크롤 없음: ' + JSON.stringify(g));
  assert.ok(g.hCreate >= 44 && g.hClose >= 44 && g.hJoin >= 44, '터치하기 쉬운 크기: ' + JSON.stringify(g));
  assert.ok(g.docX <= 0, '가로 스크롤 없음');
  console.log('[측정] 360×640 대결 목록: ' + JSON.stringify(g));
  // 키보드 포커스: 방 만들기에 포커스가 있고, 닫으면 대결 버튼으로 돌아간다
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'vsCreate');
  await click(page, '#vsClose');
  assert.equal(await page.eval("document.activeElement && document.activeElement.dataset.mode"), 'versus');
  assert.equal(await visible(page, 'start'), true);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('방 만들기 → 상대를 기다리는 화면(방장 이름) → 상대가 참가하면 두 사람 이름의 준비 화면(시작 단추 없음). 나가기는 POST leave', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame(); await fast(page);
  await openVs(page);
  await click(page, '#vsCreate');
  await waitFor(page, "!document.getElementById('vsRoomView').hidden");
  await waitFor(page, "document.getElementById('vsPlayers').textContent.includes('테스터')");
  assert.match(await text(page, '#vsRoomText'), /상대를 기다리는 중/);
  assert.equal(await text(page, '#vsLeave'), '취소');
  assert.equal(await text(page, '#vsGo'), '먼저 달리기', '작업347: 혼자일 때는 먼저 달리기');
  assert.equal(calls('POST', /^\/api\/versus\/rooms$/).length, 1);
  assert.ok(calls('GET', new RegExp('^/api/versus/rooms/' + ROOM_ID + '$')).length >= 1, '방 상태를 조회함');
  state.room = { status: 200, body: roomView('full', '민수') };
  await waitFor(page, "document.getElementById('vsPlayers').textContent.includes('민수')");
  const ready = await page.eval("({ items: [...document.querySelectorAll('#vsPlayers li')].map(l => l.innerText.replace(/\\s+/g, ' ')), go: document.getElementById('vsGo').textContent, leave: document.getElementById('vsLeave').textContent, btns: [...document.querySelectorAll('#vsRoomView button')].map(b => b.textContent) })");
  assert.match(ready.items[0], /테스터/); assert.match(ready.items[1], /민수/);
  assert.equal(ready.go, '시작'); assert.equal(await page.eval("!document.getElementById('vsSoon')"), true, '작업347: 시작 기능은 곧 추가돼요 안내는 제거');
  assert.deepEqual(ready.btns, ['시작', '나가기'], '준비 화면: 시작과 나가기');
  await click(page, '#vsLeave');
  await waitFor(page, "!document.getElementById('vsListView').hidden");
  assert.equal(calls('POST', new RegExp('^/api/versus/rooms/' + ROOM_ID + '/leave$')).length, 1);
  assert.equal(await page.eval('SpellRun.vs.state.roomId'), null);
  await page.close();
});

test('목록에서 참가 → 준비 화면. 목록의 "내 방" 은 들어가기로 대기 화면에 돌아간다', { skip: SKIP }, async () => {
  resetState();
  state.list = { status: 200, body: { ok: true, rooms: [{ id: OTHER_ID, hostName: '민수', elapsedSec: 5, hostRunning: false, mine: false }] } };
  state.join = { status: 200, body: { ok: true, room: { id: OTHER_ID, status: 'full', isHost: false }, me: { name: '테스터' }, opponent: { name: '민수', left: false }, result: null } };
  state.room = { status: 200, body: state.join.body };
  let page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "document.querySelectorAll('#vsList li').length === 1");
  await click(page, '#vsList button');
  await waitFor(page, "!document.getElementById('vsRoomView').hidden && document.getElementById('vsPlayers').textContent.includes('민수')");
  assert.equal(calls('POST', new RegExp('^/api/versus/rooms/' + OTHER_ID + '/join$')).length, 1);
  assert.equal(await text(page, '#vsLeave'), '나가기');
  await page.close();

  resetState();
  state.list = { status: 200, body: { ok: true, rooms: [{ id: ROOM_ID, hostName: '테스터', elapsedSec: 5, hostRunning: false, mine: true }] } };
  page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "document.querySelectorAll('#vsList li').length === 1");
  assert.equal(await text(page, '#vsList button'), '들어가기');
  await click(page, '#vsList button');
  await waitFor(page, "!document.getElementById('vsRoomView').hidden");
  assert.equal(calls('POST', /\/join$/).length, 0, '내 방은 참가 요청을 보내지 않음');
  await page.close();
});

test('단어가 10개 미만이면 방 만들기·참가를 안내와 함께 막고 서버에 요청하지 않는다', { skip: SKIP }, async () => {
  resetState(); state.rows = mkRows(8);
  state.list = { status: 200, body: { ok: true, rooms: [{ id: OTHER_ID, hostName: '민수', elapsedSec: 5, hostRunning: false, mine: false }] } };
  const page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "document.querySelectorAll('#vsList li').length === 1");
  await click(page, '#vsCreate');
  assert.match(await text(page, '#vsMsg'), /10개 이상.*지금 8개/);
  await click(page, '#vsList button');
  for (let i = 0; i < 20; i++) await sleep(50);   // 방이 없으면 leave 가 가지 않음을 충분히 기다려 확인
  assert.equal(calls('POST', /./).length, 0, 'POST 요청 없음');
  assert.equal(await visible(page, 'vsListView'), true);
  await page.close();
});

test('오류 코드별 처리: 401 안내·조회 멈춤, 403 메뉴 숨김과 안내, 404/409 목록 복귀와 안내, 429·503 안내 후 쉬었다 재시도', { skip: SKIP }, async () => {
  // 401(목록 조회)
  resetState(); state.list = { status: 401, body: { error: '로그인이 필요합니다.' } };
  let page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "document.getElementById('vsMsg').textContent.includes('로그인')");
  const n401 = calls('GET', /^\/api\/versus\/rooms$/).length; await sleep(300);
  assert.equal(calls('GET', /^\/api\/versus\/rooms$/).length, n401, '401 뒤에는 조회를 멈춤');
  await page.close();

  // 403(대결 권한 없음)
  resetState(); state.list = { status: 403, body: { error: '대결 사용 권한이 없습니다.' } };
  page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "!document.getElementById('vsDeniedView').hidden");
  assert.match(await text(page, '#vsMsg'), /권한이 없어요/);
  assert.equal(await page.eval("!!document.querySelector('#modeRow button[data-mode=\"versus\"]')"), false, '대결 버튼이 사라짐');
  await click(page, '#vsDeniedClose');
  assert.equal(await visible(page, 'start'), true);
  await page.close();

  // 404(방이 사라짐): 대기 중 조회가 404 → 목록으로 돌아가고 안내
  resetState();
  page = await openGame(); await fast(page);
  await openVs(page); await click(page, '#vsCreate');
  await waitFor(page, "!document.getElementById('vsRoomView').hidden");
  state.room = { status: 404, body: { error: '방을 찾을 수 없습니다.' } };
  await waitFor(page, "!document.getElementById('vsListView').hidden");
  assert.match(await text(page, '#vsMsg'), /방이 사라져 결과를 겨루지 못했어요/);   // 작업348: 방 화면의 404 도 방 소실 문구
  assert.equal(await page.eval('SpellRun.vs.state.roomId'), null);
  await page.close();

  // 409(참가 실패): 목록 유지하고 안내
  resetState();
  state.list = { status: 200, body: { ok: true, rooms: [{ id: OTHER_ID, hostName: '민수', elapsedSec: 5, hostRunning: false, mine: false }] } };
  state.join = { status: 409, body: { error: '이미 가득 찬 방입니다.' } };
  page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "document.querySelectorAll('#vsList li').length === 1");
  await click(page, '#vsList button');
  await waitFor(page, "document.getElementById('vsMsg').textContent.includes('이미 끝났거나 가득 찬 방이에요.')");
  assert.equal(await visible(page, 'vsListView'), true);
  await page.close();

  // 429: 안내 후 backoff(250ms) 동안 조회를 쉰다
  resetState(); state.list = { status: 429, body: { error: '요청이 너무 많습니다.' } };
  page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "document.getElementById('vsMsg').textContent.includes('요청이 많아요')");
  const t0 = Date.now(), n429 = calls('GET', /^\/api\/versus\/rooms$/).length;
  state.list = { status: 200, body: { ok: true, rooms: [] } };
  await waitFor(page, "document.getElementById('vsMsg').textContent === ''", 3000);
  assert.ok(Date.now() - t0 >= 150, '바로 다시 부르지 않고 쉼: ' + (Date.now() - t0) + 'ms');
  assert.ok(calls('GET', /^\/api\/versus\/rooms$/).length >= n429 + 1, '쉰 뒤 다시 조회해 성공하면 안내가 지워짐');
  await page.close();

  // 503: 안내, 같은 안내는 연달아 다시 쓰지 않는다(#vsMsg 변경 횟수 1)
  resetState(); state.list = { status: 503, body: { error: '서버 오류' } };
  page = await openGame(); await fast(page);
  await page.eval("window.__mut = 0; new MutationObserver(l => { window.__mut += l.length; }).observe(document.getElementById('vsMsg'), { childList: true, characterData: true, subtree: true })");
  await openVs(page);
  await waitFor(page, "document.getElementById('vsMsg').textContent.includes('나중에 다시')");
  const n503 = calls('GET', /^\/api\/versus\/rooms$/).length;
  await sleep(900);
  assert.ok(calls('GET', /^\/api\/versus\/rooms$/).length > n503, '503 뒤에도 쉬었다가 다시 조회');
  assert.equal(await page.eval('window.__mut'), 1, '같은 종류의 안내를 다시 쓰지 않음(변경 1회)');
  await page.close();
});

test('탭이 숨겨지면 조회를 멈추고, 다시 보이면 이어 간다. 수동 새로 고침은 한 번 더 부른다', { skip: SKIP }, async () => {
  resetState();
  const page = await openGame(); await fast(page);
  await openVs(page);
  await waitFor(page, "SpellRun.vs.state.polls >= 2");
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(150);   // 진행 중이던 응답이 끝나기를 기다린 뒤
  const n = calls('GET', /^\/api\/versus\/rooms$/).length; await sleep(500);
  assert.equal(calls('GET', /^\/api\/versus\/rooms$/).length, n, '숨겨진 동안 조회 없음');
  await page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
  
  await sleep(300);
  assert.ok(calls('GET', /^\/api\/versus\/rooms$/).length > n, '다시 보이면 조회 재개');
  const m = calls('GET', /^\/api\/versus\/rooms$/).length;
  await click(page, '#vsRefresh'); await sleep(40);
  assert.ok(calls('GET', /^\/api\/versus\/rooms$/).length >= m + 1, '새로 고침 버튼');
  await page.close();
});

test('닫기: 내 방이 있으면 leave 를 부르고 시작 화면으로 돌아간다(leave 가 실패해도 앱은 계속 동작). 방이 없으면 leave 없음', { skip: SKIP }, async () => {
  resetState();
  let page = await openGame(); await fast(page);
  await openVs(page); await click(page, '#vsClose');
  await sleep(100);
  assert.equal(calls('POST', /leave/).length, 0, '방이 없으면 leave 없음');
  await page.close();

  resetState(); state.leave = { status: 500, body: { error: 'boom' } };
  page = await openGame(); await fast(page);
  await openVs(page); await click(page, '#vsCreate');
  await waitFor(page, "!document.getElementById('vsRoomView').hidden");
  await page.eval('window.__closedAt = performance.now()');   // 작업379: 닫기를 누르는 시각(바로 이어서 Escape 키가 닫기를 실행한다)
  await page.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.getElementById('vs').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(page, "document.getElementById('vs').hidden");
  for (let i = 0; i < 60 && !calls("POST", /leave$/).length; i++) await sleep(50);   // leave 요청이 서버에 닿을 때까지 기다린다(부하가 큰 실행에서도 안정)
  assert.equal(calls('POST', new RegExp('^/api/versus/rooms/' + ROOM_ID + '/leave$')).length, 1, '닫을 때 leave 호출');
  assert.equal(await visible(page, 'start'), true);
  // 작업379: 닫은 뒤에 "이 페이지가" 보낸 조회가 없는지를 본다(보낸 시각 기준). 서버 도착 수로 세던 예전 방식(고정 대기 200+300ms 뒤 집계)은 앞선 시험의 탭이 보낸 조회가 섞여 파일 전체 실행에서 자주 실패했다(작업378).
  // 조회 간격이 60ms 이므로 닫은 뒤 300ms 동안 지켜보면 폴링이 남아 있을 경우 5번 안팎 보낼 시간이다.
  await sleep(300);
  const sentAfterClose = await page.eval('window.__sentGets.filter(t => t > window.__closedAt).length');
  assert.equal(sentAfterClose, 0, '닫은 뒤에는 이 페이지가 조회를 보내지 않는다');
  // 닫은 뒤에도 게임 시작 버튼이 살아 있다
  assert.equal(await page.eval("document.getElementById('startBtn').disabled"), false);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});
