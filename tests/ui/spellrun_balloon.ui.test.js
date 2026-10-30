// 작업361: 풍선 타일 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// 확인: 가로는 풍선 그림·색 배정·올림·둥실 움직임(위상·메뉴로 멈춤)·터지는 효과, 틀린 풍선은 그대로 지나감, 올림·움직임이 판정에 영향 없음(같은 입력 같은 결과), 콤보 칩 숨김, 세로는 그대로
// 실행: node --test tests/ui/spellrun_balloon.ui.test.js   (Chrome이 없으면 건너뜀)
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
const visible = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !e.closest('[hidden]'); })()`;
// 그림 호출을 가로채 캐릭터 그림(칸 288)의 크기·위치와 글자(fillText)를 그릴 때의 투명도를 기록한다
const spyDraw = `(() => { const P = CanvasRenderingContext2D.prototype; window.__sp = { img: [], txt: [] };
  if (!P.__orig) P.__orig = { di: P.drawImage, ft: P.fillText };
  P.drawImage = function () { const a = arguments; if (a.length === 9 && a[3] === 288 && a[4] === 288) window.__sp.img.push({ dx: a[5], dy: a[6], dw: a[7], dh: a[8] }); return P.__orig.di.apply(this, a); };
  P.fillText = function (t) { window.__sp.txt.push({ t: String(t), a: this.globalAlpha }); return P.__orig.ft.apply(this, arguments); };
})()`;

// 풍선 그림(칸 112x161) 호출을 가로채 칸 번호·몸통 가운데의 화면 위치(논리 px)·기울기를 기록한다
const spyBalloon = `(() => { const P = CanvasRenderingContext2D.prototype; window.__bl = [];
  if (!P.__orig) P.__orig = { di: P.drawImage, ft: P.fillText };
  P.drawImage = function () { const a = arguments; if (a.length === 9 && a[3] === 112 && a[4] === 161) { const m = this.getTransform(), S = document.getElementById('cv').width / SpellRun.view.layout().W; window.__bl.push({ cell: a[1] / 112, x: m.e / S, y: m.f / S, ang: Math.atan2(m.b, m.a) * 180 / Math.PI }); } return P.__orig.di.apply(this, a); };
})()`;
const seed = `(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })()`;
const run = async (page, steps) => page.eval(`(() => { for (let i = 0; i < ${steps}; i++) { SpellRun.step(1 / 60); if (SpellRun.G.state !== 'run') break; } })()`);
const BCOL = JSON.stringify(['#ff8fb1', '#6ec1f7', '#ffd25e', '#8fe08a', '#b78cf5', '#ff9f77']);

test('361-2) 가로: 일반 철자 타일은 풍선 그림으로 그려지고, 색은 (후보 번호 + 칸 번호) % 6, 몸통 가운데는 TILE_Y - 22 ± 3(둥실)', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await run(page, 420);
  assert.equal(await page.eval('SpellRun.balloon.ready()'), true);
  await page.eval(spyBalloon);
  await page.eval('SpellRun.draw()');
  const r = await page.eval(`(() => { const G = SpellRun.G, L = SpellRun.view.layout(); const tl = G.tiles.filter(t => !t.kind && SpellRun.balloon.k(t) !== null); return { n: tl.length, recs: window.__bl, tiles: tl.map(t => ({ bi: t.bi, n: t.n, si: t.si, high: !!t.high })), TILE_Y: L.TILE_Y, HIGH_Y: L.HIGH_Y }; })()`);
  assert.ok(r.n >= 3 && r.recs.length === r.n, `풍선 ${r.recs.length} = 타일 ${r.n}`);
  for (const t of r.tiles) assert.equal(t.bi, ((t.n % 8) + t.si) % 6, '색 = (후보 번호 + 칸 번호) % 6');
  const normals = r.recs.filter((_, i) => !r.tiles[i].high);
  assert.ok(normals.length > 0);
  for (const b of normals) assert.ok(Math.abs(b.y - (r.TILE_Y - 22)) <= 3.2, `풍선 가운데 y ${b.y} (TILE_Y ${r.TILE_Y} - 22 ± 3)`);
  for (const [i, b] of r.recs.entries()) if (r.tiles[i].high) assert.ok(Math.abs(b.y - r.HIGH_Y) <= 3.2, `높은 칸 풍선 y ${b.y}`);
  assert.ok(r.recs.every(b => Math.abs(b.ang) <= 4.01), '기울기 ±4도');
  assert.ok(new Set(r.recs.map(b => b.y.toFixed(2))).size > 1, '풍선마다 위상이 달라 높이가 어긋난다');
  noErr(page); await page.close();
});

test('361-3) 둥실 움직임은 게임 시간 기준: 메뉴로 멈춘 동안 흔들림도 멈추고, 닫으면 이어진다', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await run(page, 200);
  await page.eval(spyBalloon);
  const pos = async () => { await page.eval('window.__bl.length = 0; SpellRun.draw()'); return page.eval('window.__bl.map(b => [b.x, b.y, b.ang].join(","))'); };
  await page.click('#srMenuBtn');
  const a = await pos();
  await run(page, 90);
  const b = await pos();
  assert.ok(a.length > 0); assert.deepEqual(b, a, '메뉴가 열린 동안 풍선 위치·기울기가 그대로');
  await page.click('#srMenuCont');
  await run(page, 20);
  assert.notDeepEqual(await pos(), a, '닫으면 다시 움직인다');
  noErr(page); await page.close();
});

test('361-4) 맞는 풍선을 먹으면 사라지고 풍선 색 조각 7개가 퍼진다. 틀린 풍선은 조각 없이 그대로 지나가고 계속 그려진다(체력 -1은 그대로)', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await run(page, 300);
  const okRes = await page.eval(`(() => { const R = SpellRun, G = R.G, C = ${BCOL}; const t = G.tiles.find(x => !x.kind && x.correct && !x.checked && x.state === 'live' && x.wi === G.wi && x.si === G.si); if (!t) return null; t.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; G.parts = []; R.step(0.02); return { state: t.state, parts: G.parts.filter(p => p.color === C[t.bi] && p.max === 0.3).length }; })()`);
  assert.ok(okRes, '맞는 타일이 있다');
  assert.equal(okRes.state, 'taken'); assert.equal(okRes.parts, 7, '풍선 색 조각 7개');
  await page.eval(spyBalloon); await page.eval('SpellRun.draw()');
  assert.equal(await page.eval('window.__bl.length'), await page.eval('SpellRun.G.tiles.filter(t => !t.kind && t.state !== "taken" && SpellRun.balloon.k(t) !== null).length'), '먹은 풍선은 그려지지 않는다');
  await page.eval('(() => { for (let i = 0; i < 24; i++) SpellRun.step(1 / 60); })()');
  assert.equal(await page.eval('SpellRun.G.parts.filter(p => p.max === 0.3).length'), 0, '조각은 약 0.3초 뒤 사라진다');
  const w = await page.eval(`(() => { const R = SpellRun, G = R.G; const t = G.tiles.find(x => !x.kind && !x.correct && !x.checked && x.state === 'live'); if (!t) return null; t.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; window.__w = t; G.parts = []; const hp = G.hp; R.step(0.02); return { hp0: hp, hp: G.hp, state: t.state, pop: G.parts.filter(p => p.max === 0.3).length }; })()`);
  assert.ok(w, '틀린 타일이 있다'); assert.equal(w.hp, w.hp0 - 1); assert.equal(w.state, 'live'); assert.equal(w.pop, 0, '조각 효과 없음');
  await page.eval('(() => { SpellRun.G.jumpT = -1; })()');
  await page.eval(spyBalloon);
  for (let k = 0; k < 4; k++) {
    await page.eval('(() => { SpellRun.step(0.04); })()');
    const st = await page.eval('(() => { const t = window.__w; return { has: SpellRun.G.tiles.includes(t), x: t.x }; })()');
    if (st.x > -100) {
      assert.equal(st.has, true);
      await page.eval('window.__bl.length = 0; SpellRun.draw()');
      assert.equal(await page.eval('window.__bl.length'), await page.eval('SpellRun.G.tiles.filter(t => !t.kind && t.state !== "taken" && SpellRun.balloon.k(t) !== null).length'), '틀린 풍선도 그대로 그려진다');
    }
  }
  noErr(page); await page.close();
});

test('361-8) 올림(TILE_LIFT)과 움직임은 판정·배치·다시 계획하는 규칙에 영향 없음: 같은 난수·같은 입력이면 올림 0 과 22 의 결과(점수·체력·콤보·칸·타일 위치와 상태)가 같다', { skip: SKIP }, async () => {
  const outs = [];
  for (const lift of [0, 22, 22]) {
    const page = await open(844, 390);
    await page.eval(seed);
    await page.eval('SpellRun.G.dist = 0');   // 시작 화면에서 실제 시간으로 흐른 배경 거리를 지운다(실행마다 달라지므로)
    await startRun(page);
    await page.eval(`SpellRun.balloon.setLift(${lift})`);
    await page.eval(`(() => { const R = SpellRun, G = R.G; for (let i = 0; i < 3000; i++) { R.step(1 / 60); if (i % 3 === 0) R.draw(); if (i % 41 === 0) R.jump(); if (G.state !== 'run') break; } })()`);
    outs.push(await page.eval(`(() => { const G = SpellRun.G; return JSON.stringify({ score: G.score, hp: G.hp, combo: G.combo, wi: G.wi, si: G.si, dist: Math.round(G.dist * 1000), state: G.state, tiles: G.tiles.map(t => [Math.round(t.x * 100), t.state, t.text, t.correct, t.bi, t.high || false]) }); })()`));
    noErr(page); await page.close();
  }
  assert.equal(outs[1], outs[0], '올림 0 과 22 의 결과가 같다'); assert.equal(outs[2], outs[1], '같은 입력은 같은 결과');
  const st = JSON.parse(outs[0]); assert.ok(st.dist > 1000000 && st.tiles.length > 0, '실제로 한참 진행됨: ' + st.dist);   // 게임 시간(G.time)은 시작 때 단계 하나 차이가 날 수 있어 비교에서 뺀다(거리·타일 위치는 같다)
});

test('361-5) 콤보 칩은 가로에서 숨김, 세로는 그대로. 세로는 풍선·올림 없음(그림 호출 없음)', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await page.eval("document.getElementById('combo').hidden = false");
  assert.equal(await page.eval(visible('#combo')), false, '가로: 콤보 칩 숨김');
  noErr(page); await page.close();
  const pp = await open(390, 844, '?mode=0');
  await startRun(pp);
  await pp.eval("document.getElementById('combo').hidden = false; document.getElementById('combo').textContent = 'x3'");
  assert.equal(await pp.eval(visible('#combo')), true, '세로: 콤보 칩 그대로');
  await pp.eval(spyBalloon);
  await pp.eval('SpellRun.CONFIG.OBSTACLE_PROB = 0; SpellRun.G.spawnT = 0; SpellRun.step(0.1); SpellRun.draw()');
  assert.equal(await pp.eval('window.__bl.length'), 0, '세로는 풍선 그림 호출 없음');
  assert.equal(await pp.eval('SpellRun.balloon.lift({})'), 0);
  noErr(pp); await pp.close();
});
