// 작업370: 가로 캐릭터 위치(몸 중심 약 16%), 풍선이 터지는 순간(눈에 보이는 접촉), 세로 불변 (헤드리스 Chrome, 자체 임시 서버). 외부 API·운영 서버와 무관
// 실행: node --test tests/ui/spellrun_land370.ui.test.js   (Chrome이 없으면 건너뜀)
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
const en = (id, word, meaning) => ({ id, word, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - id).toISOString(), data: { word, lang: 'en', short_meaning: meaning, meanings: [{ pos: 'noun', definition: meaning + ', 다른 뜻' }] } });
const ROWS = [en(1, 'apple', '사과'), en(2, 'book', '책'), en(3, 'environment', '환경'), en(4, 'water', '물'), en(11, 'happy', '행복한'), en(12, 'window', '창문'), en(13, 'music', '음악'), en(14, 'friend', '친구')];
const IDS = [1, 2, 3, 4, 11, 12, 13, 14];

let srv, base, browser;
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      req.on('data', () => {}); req.on('end', () => {
        if (u === '/api/me') return json(200, { id: 7, email: 'u@x', name: '테스터', role: 'user', can_wordbook: true });
        if (u === '/api/wordbook' && req.method === 'GET') return json(200, ROWS);
        json(503, { ok: false });
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

async function open(width, height, query = '?mode=1') {
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_view'); localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.setItem('spellrun_preview', '0'); } catch (e) {}" });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(IDS))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false');
  await page.eval('window.requestAnimationFrame = () => 0');   // 자동 그리기 반복을 멈춘다: 그림 호출 기록·난수 사용 횟수가 시험이 부른 것만 남게
  await sleep(150);   // 이미 예약된 마지막 프레임이 지나가게
  return page;
}
const noErr = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const startRun = async page => {
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.eval('SpellRun.step(0.5)');
};
const spyBalloon = `(() => { const P = CanvasRenderingContext2D.prototype; window.__bl = [];
  if (!P.__orig) P.__orig = { di: P.drawImage, ft: P.fillText };
  P.drawImage = function () { const a = arguments; if (a.length === 9 && a[3] === 112 && a[4] === 161) { const m = this.getTransform(), S = document.getElementById('cv').width / SpellRun.view.layout().W; window.__bl.push({ cell: a[1] / 112, x: m.e / S, y: m.f / S, ang: Math.atan2(m.b, m.a) * 180 / Math.PI }); } return P.__orig.di.apply(this, a); };
})()`;
const seed = `(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })()`;

// 먹는 순간(타일이 checked 로 바뀌는 프레임)에 그 풍선이 화면에 그려진 x 를 잰다
const crossScene = `(() => { const R = SpellRun, G = R.G, out = [];
  for (let i = 0; i < 3000 && out.length < 4; i++) {
    const before = G.tiles.filter(t => !t.kind && t.state === 'live' && !t.checked).map(t => t);
    R.step(1 / 60); window.__bl.length = 0; R.draw();
    for (const t of before) if (t.checked && !t.rise && t.x <= R.RUNNER_X + 1) { const m = window.__bl.slice().sort((a, b) => Math.abs(a.x - (t.x + R.GRAB_DX)) - Math.abs(b.x - (t.x + R.GRAB_DX)))[0]; out.push({ logicalX: t.x, drawX: m ? m.x : null, speed: G.speed }); }
    if (G.state !== 'run') break;
    if (G.jumpT < 0 && G.tiles.some(t => !t.kind && t.state === 'live' && !t.checked && t.x - R.RUNNER_X < G.speed * 0.2 && t.x > R.RUNNER_X)) R.jump();
  }
  return out; })()`;

test('370-1) 가로: 캐릭터 기준 x 149, 몸 중심 약 16%(여학생·남학생·펭귄), 풍선은 GRAB_DX 10(기본, 작업372) 만큼 오른쪽에 그려지고 그 순간 먹는다. 세로는 72·0', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page); await page.eval(seed); await page.eval(spyBalloon);
  const r = await page.eval('({ rx: SpellRun.RUNNER_X, dx: SpellRun.GRAB_DX, W: SpellRun.view.layout().W, fx: ["girl", "boy", "penguin"].map(k => { const P = SpellRunLogic.CHARS[k]; return RX(P); }) })'.replace('RX(P)', '(SpellRun.RUNNER_X + P.faceDx * 1.3)'));
  assert.equal(r.rx, 149); assert.equal(r.dx, 10); assert.equal(r.W, 800);
  assert.ok(Math.abs(r.fx[0] / r.W - 0.16) < 0.01 && Math.abs(r.fx[1] / r.W - 0.16) < 0.01, `여학생·남학생 몸 중심 ${r.fx.map(x => (x / r.W * 100).toFixed(1) + '%')}`);
  const sc = await page.eval(crossScene);
  assert.ok(sc.length >= 1, '풍선을 먹은 프레임이 있다');
  let drawn = 0;
  for (const c of sc) {
    assert.ok(c.logicalX <= 149 + 0.05 && c.logicalX > 149 - c.speed / 60 - 0.5, `먹는 순간 논리 x ${c.logicalX} 는 149 를 막 지난 값`);
    if (c.drawX !== null && Math.abs(c.drawX - (c.logicalX + 10)) < 1) { drawn++; assert.ok(c.drawX <= 149 + 10 + 0.05 && c.drawX > 149 + 10 - c.speed / 60 - 0.5, `먹는 순간 풍선이 그려진 x ${c.drawX} ≈ 159`); }   // 맞아서 터진 풍선은 그림이 없으니 지나가기만 한 풍선으로 확인
  }
  noErr(page); await page.close();
});

test('370-1) 세로: RUNNER_X 72, GRAB_DX 0, 풍선·AIR_GAP 없음(이전과 같다)', { skip: SKIP }, async () => {
  const page = await open(390, 844, '?mode=0');
  await startRun(page);
  const r = await page.eval('({ rx: SpellRun.RUNNER_X, dx: SpellRun.GRAB_DX, W: SpellRun.view.layout().W, gap: SpellRun.view.layout().AIR_GAP })');
  assert.equal(r.rx, 72); assert.equal(r.dx, 0); assert.equal(r.W, 360); assert.ok(!r.gap);
  noErr(page); await page.close();
});

// ---- 작업372: grabdx 주소 옵션 ----
const popScene = `(() => { const R = SpellRun, G = R.G; let hit = null;
  for (let i = 0; i < 6000 && !hit; i++) {
    R.step(1 / 60);
    const v = G.tiles.filter(t => !t.kind && t.state === 'live' && !t.checked && t.x > R.RUNNER_X + 5 && t.x < 700);
    const w = v.find(t => t.correct && t.wi === G.wi && t.si === G.si);
    if (w && i > 60) { w.x = R.RUNNER_X + 1; G.jumpT = 0.2; G.j2 = -1; const n0 = G.parts.length; R.step(0.01); hit = { n: G.parts.length - n0, xs: G.parts.slice(n0).filter(p => p.max === 0.3).map(p => p.x), dx: R.GRAB_DX, rx: R.RUNNER_X }; }
    if (G.state !== 'run') break;
  }
  return hit; })()`;

for (const [q, want] of [['?mode=1&grabdx=36.75', 36.75], ['?mode=1&grabdx=0', 0], ['?mode=1&grabdx=99', 40], ['?mode=1&grabdx=-3', 0], ['?mode=1&grabdx=abc', 10], ['?mode=1', 10]]) {
  test(`372-2) 가로 ${q}: GRAB_DX ${want}, 판정 순간 풍선이 그려진 x = RUNNER_X + ${want}, 터지는 조각도 같은 기준`, { skip: SKIP }, async () => {
    const page = await open(844, 390, q);
    await startRun(page); await page.eval(seed); await page.eval(spyBalloon);
    const r = await page.eval('({ rx: SpellRun.RUNNER_X, dx: SpellRun.GRAB_DX })');
    assert.equal(r.rx, 149); assert.equal(r.dx, want);
    const sc = await page.eval(crossScene);
    assert.ok(sc.length >= 1);
    // 풍선 몸통은 매듭을 축으로 ±4도 흔들려 그림 호출의 x 가 최대 약 2px 어긋난다
    for (const c of sc) if (c.drawX !== null && Math.abs(c.drawX - (c.logicalX + want)) < 2.5) assert.ok(c.drawX <= 149 + want + 2.5 && c.drawX > 149 + want - c.speed / 60 - 2.5, `먹는 순간 그려진 x ${c.drawX}`);
    noErr(page); await page.close();
    const page2 = await open(844, 390, q);   // 터지는 조각은 새 판에서(앞 장면이 체력을 깎았을 수 있다)
    await startRun(page2); await page2.eval(seed);
    const pop = await page2.eval(popScene);
    assert.ok(pop && pop.n >= 1, '맞는 풍선이 터지며 조각이 생긴다');
    for (const x of pop.xs) assert.ok(Math.abs(x - (149 + want)) < 3, `터지는 조각 x ${x} ≈ ${149 + want}`);
    noErr(page2); await page2.close();
  });
}

test('372-2) 세로: grabdx 를 줘도 GRAB_DX 0, RUNNER_X 72 (옵션은 가로에만 적용)', { skip: SKIP }, async () => {
  const page = await open(390, 844, '?mode=0&grabdx=30');
  await startRun(page);
  const r = await page.eval('({ rx: SpellRun.RUNNER_X, dx: SpellRun.GRAB_DX, saved: localStorage.getItem("spellrun_opts") })');
  assert.equal(r.rx, 72); assert.equal(r.dx, 0);
  assert.ok(/"grabdx":30/.test(r.saved), '옵션은 저장되지만 세로에는 쓰지 않는다');
  noErr(page); await page.close();
});

test('372-2) grabdx 는 spellrun_opts 에 저장되고(주소 없이도 쓰임), reset=1 이면 지워져 기본 10 로 돌아간다. 기본값이 아니면 "조정값 사용 중" 대상(applied)', { skip: SKIP }, async () => {
  const page = await open(844, 390, '?mode=1&grabdx=30');   // 시험 도우미가 문서를 열 때마다 저장값을 지우므로 다시 열지 않고 같은 규칙 함수로 확인한다
  await startRun(page);
  const a = await page.eval('({ dx: SpellRun.GRAB_DX, saved: localStorage.getItem("spellrun_opts"), opt: SpellRunLogic.resolveOptions("", localStorage.getItem("spellrun_opts")), reset: SpellRunLogic.resolveOptions("?reset=1", localStorage.getItem("spellrun_opts")), def: SpellRunLogic.resolveOptions("?grabdx=10", null) })');
  assert.equal(a.dx, 30); assert.ok(/"grabdx":30/.test(a.saved));
  assert.equal(a.opt.values.grabdx, 30, '주소 없이도 저장값'); assert.deepEqual(a.opt.applied, ['grabdx']);
  assert.equal(a.reset.reset, true); assert.deepEqual(a.reset.values, {});
  assert.deepEqual(a.def.applied, [], '기본값이면 조정값 표시 없음');
  noErr(page); await page.close();
});
