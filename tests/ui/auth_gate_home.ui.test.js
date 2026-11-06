// 작업405: 홈(/)의 승인 대기·차단 안내(헤드리스 Chrome). 콜백이 붙이는 ?approval=pending|blocked(토큰 없음)와, 토큰이 있는데 /api/me 가 403 인 경우를 본다.
// 안내를 보인 뒤 주소에서 쿼리가 지워지는지, [다시 확인]·[로그아웃] 동작, 버튼 44px 이상, 이모지 없음, 390/1280px 가로 스크롤 없음. 자체 임시 서버 — 운영과 무관.
// 실행: node --test tests/ui/auth_gate_home.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const ME_OK = { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_jgrammar: false };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ id: 7, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

let srv, base, browser;
const state = { me: { status: 200, body: ME_OK }, meCalls: 0 };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u === '/api/me') { state.meCalls++; return json(state.me.status, state.me.body); }
    if (u.startsWith('/api/')) return json(404, { ok: false });
    const f = path.join(PUB, u === '/' ? 'home/index.html' : u);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });
test.beforeEach(() => { state.me = { status: 200, body: ME_OK }; state.meCalls = 0; });

const seed = (page, token) => page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); ${token ? `localStorage.setItem('mydict_token', ${JSON.stringify(token)});` : `localStorage.removeItem('mydict_token');`} } } catch (e) {}` });
async function open(query, { token = null, width = 390 } = {}) {
  const page = await browser.newPage({ width, height: 844, token: null });
  await seed(page, token);
  await page.send('Page.navigate', { url: base + '/' + query });
  return page;
}
const noticeText = page => page.eval(`(() => { const t = document.body.innerText; return t; })()`);

test('405-H1. 홈: ?approval=pending(토큰 없음) → "승인 대기중" 안내, 주소에서 쿼리 삭제, 로그인 버튼·휠 없음', { skip: SKIP }, async () => {
  const page = await open('?approval=pending');
  try {
    await page.waitFor(`document.body.innerText.includes('승인 대기중')`, 8000, '승인 대기 안내');
    assert.match(await noticeText(page), /관리자 승인 후 이용 가능합니다\./);
    assert.equal(await page.eval(`location.search`), '', '쿼리 삭제');
    assert.equal(state.meCalls, 0);
    assert.equal(await page.count('button'), 0);
  } finally { await page.close(); }
});

test('405-H2. 홈: ?approval=blocked(토큰 없음) → "이용할 수 없는 계정입니다 / 관리자에게 문의해 주세요." 안내, 쿼리 삭제', { skip: SKIP }, async () => {
  const page = await open('?approval=blocked');
  try {
    await page.waitFor(`document.body.innerText.includes('이용할 수 없는 계정입니다')`, 8000, '차단 안내');
    assert.match(await noticeText(page), /관리자에게 문의해 주세요\./);
    assert.equal(await page.eval(`location.search`), '');
  } finally { await page.close(); }
});

test('405-H3. 홈: 토큰 + /api/me 403 approval_pending → 대기 안내와 [다시 확인]·[로그아웃](44px 이상), 다시 확인이 승인 응답을 받으면 안내가 사라진다', { skip: SKIP }, async () => {
  state.me = { status: 403, body: { code: 'approval_pending' } };
  const page = await open('', { token: TOKEN });
  try {
    await page.waitFor(`document.body.innerText.includes('승인을 기다리고 있습니다')`, 8000, '대기 안내');
    assert.match(await noticeText(page), /승인 후 아래 \[다시 확인\]을 눌러 주세요\./);
    const btns = await page.eval(`[...document.querySelectorAll('button')].map(b => ({ t: b.textContent.trim(), h: b.getBoundingClientRect().height }))`);
    assert.deepEqual(btns.map(b => b.t), ['다시 확인', '로그아웃']);
    assert.ok(btns.every(b => b.h >= 44), '버튼 높이 ' + JSON.stringify(btns));
    assert.ok(!/\p{Extended_Pictographic}/u.test(await noticeText(page)), '이모지 없음');
    assert.equal(await page.hasHorizontalScroll(), false);
    const calls = state.meCalls;
    state.me = { status: 200, body: ME_OK };
    await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '다시 확인').click()`);
    await page.waitFor(`!document.body.innerText.includes('승인을 기다리고 있습니다')`, 8000, '안내 사라짐');
    assert.equal(state.meCalls, calls + 1, '[다시 확인]이 /api/me 를 한 번 더 부름');
    assert.ok(await page.exists('[role=option]'), '승인되면 휠이 보인다');
  } finally { await page.close(); }
});

test('405-H4. 홈: 토큰 + /api/me 403 blocked → 차단 안내와 [로그아웃]만, 로그아웃은 토큰을 지우고 안내를 닫는다', { skip: SKIP }, async () => {
  state.me = { status: 403, body: { code: 'blocked' } };
  const page = await open('', { token: TOKEN, width: 1280 });
  try {
    await page.waitFor(`document.body.innerText.includes('이용할 수 없는 계정입니다')`, 8000, '차단 안내');
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('button')].map(b => b.textContent.trim())`), ['로그아웃']);
    assert.equal(await page.hasHorizontalScroll(), false);
    await page.eval(`document.querySelector('button').click()`);
    await page.waitFor(`!document.body.innerText.includes('이용할 수 없는 계정입니다')`, 8000, '안내 사라짐');
    assert.equal(await page.eval(`localStorage.getItem('mydict_token')`), null);
  } finally { await page.close(); }
});

test('405-H5. 홈: 토큰 + /api/me 401 → 토큰을 지우고 로그인 버튼(예전처럼)', { skip: SKIP }, async () => {
  state.me = { status: 401, body: { code: 'auth_invalid' } };
  const page = await open('', { token: TOKEN });
  try {
    await page.waitFor(`document.body.innerText.includes('Google로 로그인')`, 8000, '로그인 버튼');
    assert.equal(await page.eval(`localStorage.getItem('mydict_token')`), null);
  } finally { await page.close(); }
});
