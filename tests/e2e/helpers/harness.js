// 작업349: 대결 통합 시험 도우미. 실제 server.js(routes·lib/versus.js·화면 그대로)를 자식 프로세스로 띄우고, 서로 다른 브라우저 2개(저장소·쿠키 분리)로 두 사람을 연다.
// - 로그인: 시험용 JWT_SECRET 으로 계정 2개의 토큰을 직접 만든다(Google 로그인 없음).
// - 권한: DATABASE_URL 이 없으면 서버는 ADMIN_EMAILS 의 이메일만 대결을 허용한다(실제 코드 경로). 두 계정의 이메일을 거기 넣는다.
// - DB: 없다. pg_stub.js 가 단어장 조회에만 답한다.
// - 외부 API 키는 비운다. 자식 프로세스는 .env 를 읽지 않도록 빈 임시 폴더를 작업 폴더로 쓴다(dotenv 는 작업 폴더의 .env 만 본다).
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const { launchBrowser, findChrome, sleep } = require('../../ui/helpers/cdp');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SECRET = 'e2e-test-secret';
const USERS = {
  A: { id: 101, email: 'a@e2e.test', name: '에이' },
  B: { id: 102, email: 'b@e2e.test', name: '비' },
};
const token = who => jwt.sign(USERS[who], SECRET, { expiresIn: '2h' });
const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

function createServerHandle() {
  const h = { port: 0, proc: null, log: [], base: '' };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-e2e-cwd-'));   // 빈 폴더: .env 가 없다
  h.start = async () => {
    if (!h.port) h.port = await freePort();
    h.base = 'http://127.0.0.1:' + h.port;
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), PORT: String(h.port), JWT_SECRET: SECRET, SESSION_SECRET: 'e2e', NODE_ENV: 'test',
      ADMIN_EMAILS: USERS.A.email + ',' + USERS.B.email, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' };
    h.proc = spawn(process.execPath, ['-r', path.join(__dirname, 'pg_stub.js'), path.join(ROOT, 'server.js')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    h.proc.stdout.on('data', d => h.log.push(String(d))); h.proc.stderr.on('data', d => h.log.push(String(d)));
    h.exited = new Promise(r => h.proc.once('exit', r));
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(h.base + '/'); if (r.status === 200) return; } catch (e) { /* 아직 */ }
      await sleep(100);
    }
    throw new Error('서버가 뜨지 않았습니다: ' + h.log.join(''));
  };
  h.stop = async () => { if (!h.proc) return; try { h.proc.kill(); } catch (e) { /* 무시 */ } await h.exited; h.proc = null; };
  h.restart = async () => { await h.stop(); await h.start(); };   // 방(서버 메모리)이 모두 사라진다
  h.unexpectedSql = () => h.log.join('').split('\n').filter(l => l.includes('[pg_stub] 예상 밖 SQL'));
  h.clean = () => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) { /* 무시 */ } };
  return h;
}

// 서버에 직접 HTTP 요청(시험이 한 사람처럼 행동할 때)
async function api(srv, who, method, p, body) {
  const r = await fetch(srv.base + '/api/versus' + p, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(who) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch (e) { /* 본문 없음 */ }
  return { status: r.status, data };
}

// 페이지의 /api/versus 요청을 CDP 네트워크 이벤트로 기록한다(시각·경로·상태)
function trackRequests(page) {
  const log = [];
  page.ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (r.url.includes('/api/versus')) log.push({ t: Date.now(), method: r.method, path: new URL(r.url).pathname.replace(/[0-9a-f]{24}/, ':id'), reqId: m.params.requestId });
    } else if (m.method === 'Network.responseReceived') {
      const e = log.find(x => x.reqId === m.params.requestId); if (e) e.status = m.params.response.status;
    } else if (m.method === 'Network.loadingFailed') {
      const e = log.find(x => x.reqId === m.params.requestId); if (e && e.status === undefined) e.status = 0;
    }
  });
  page.send('Network.enable').catch(() => {});
  return log;
}

async function openPlayer(browser, who, srv, { preview = false, width = 360, height = 640 } = {}) {
  const page = await browser.newPage({ width, height, token: token(who) });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.setItem('spellrun_preview', '${preview ? 1 : 0}'); } sessionStorage.setItem('spellrun_ids', JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12])); } catch (e) {}` });
  page.who = who;
  page.reqs = trackRequests(page);
  await page.goto(srv.base + '/spelling_run.html');
  await page.waitFor("!document.getElementById('app').hidden && !!document.getElementById('modeRow')", 10000);
  if (preview) await page.eval('Object.assign(SpellRun.preview.T, { maxMs: 600, gapMs: 30, silentMs: 60 })');
  return page;
}

// 화면 조작/조회 도우미
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`);
const shown = (page, sel) => page.eval(`!document.querySelector(${JSON.stringify(sel)}).hidden`);
const running = page => page.waitFor("SpellRun.G.state === 'run' || SpellRun.G.state === 'intro'", 8000);
const roomIdOf = page => page.eval('SpellRun.vs.state.roomId');
const roundOf = page => page.eval('SpellRun.vs.state.round');
async function enterVersus(page) {
  await click(page, '#modeRow [data-mode=versus]');
  await page.waitFor("!document.getElementById('vs').hidden && !document.getElementById('vsListView').hidden", 5000);
}
async function createRoom(page) {
  await enterVersus(page);
  await click(page, '#vsCreate');
  await page.waitFor("!document.getElementById('vsRoomView').hidden && !!SpellRun.vs.state.roomId", 5000);
  return roomIdOf(page);
}
async function joinFromList(page) {
  await enterVersus(page);
  await page.waitFor("document.querySelectorAll('#vsList li').length >= 1", 8000);
  await click(page, '#vsList button[data-room]');
  await page.waitFor("!document.getElementById('vsRoomView').hidden && document.getElementById('vsGo').textContent === '시작'", 8000);
}
// 시험이 게임 진행을 통제한다: 체력이 줄어 저절로 끝나지 않게 붙들고, 끝낼 때는 점수를 정해 쓰러뜨린다(기존 시험 훅)
const holdAlive = page => page.eval("window.__ka = setInterval(() => { const G = SpellRun.G; if (G.state === 'run' || G.state === 'pop' || G.state === 'intro') G.hp = SpellRun.CONFIG.HP; }, 30)");
const endRun = (page, score) => page.eval(`(() => { clearInterval(window.__ka); const G = SpellRun.G; G.score = ${score}; G.contUsed = true; G.hp = 0; G.state = 'ending'; G.endT = 0.02; })()`);
const hideTab = page => page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
const showTab = page => page.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
const resultShown = (page, ms = 12000) => page.waitFor("['승리', '패배', '무승부'].includes(document.getElementById('vsFinTitle').textContent)", ms);
// 탭을 실제로 닫는다(page.close 는 연결만 끊는다). 열려 있는 옛 탭이 계속 조회·신호를 보내 다음 시험을 흐리지 않게
async function closePlayer(browser, page) { try { page.ws.close(); } catch (e) { /* 무시 */ } try { await fetch(`http://127.0.0.1:${browser.port}/json/close/${page.targetId}`); } catch (e) { /* 무시 */ } }
const surv = page => page.eval('SpellRun.G.time - SpellRun.G.startTime');
// 방 화면의 시작 단추 → (미리 보기가 켜져 있으면 미리 보기 끝의 시작) → 달리기
async function startGame(page) {
  await click(page, '#vsGo');
  if (await page.eval('SpellRun.preview.isOn()')) { await page.waitFor("!document.getElementById('pvStart').hidden", 15000); await click(page, '#pvStart'); }
  await running(page);
}
const finTitle = page => text(page, '#vsFinTitle');

async function setup() {
  const srv = createServerHandle();
  await srv.start();
  const bA = await launchBrowser(), bB = await launchBrowser();   // 브라우저 2개 = 프로필(localStorage·쿠키) 분리
  return { srv, bA, bB, close: async () => { await bA.close(); await bB.close(); await srv.stop(); srv.clean(); } };
}

module.exports = { SKIP, USERS, token, createServerHandle, api, trackRequests, openPlayer, click, text, shown, running, roomIdOf, roundOf, enterVersus, createRoom, joinFromList, holdAlive, endRun, hideTab, showTab, resultShown, finTitle, setup, closePlayer, surv, startGame, sleep };
