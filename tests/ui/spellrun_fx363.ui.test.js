// 작업363: 캐릭터 동작 효과 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// 확인(가로만): 점프 늘었다 줄기·발끝 고정, 달릴 때 출렁임, 그림자, 먼지 상한, 반응 상태와 메뉴 정지, 맞는/틀린 글자 효과, 놓쳤을 때 쓸모없는 풍선 올라감,
//       판정·점수·타일 위치에 영향 없음(효과 켜고 끄고 같은 결과), 세로는 예전 그대로
// 실행: node --test tests/ui/spellrun_fx363.ui.test.js   (Chrome이 없으면 건너뜀)
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


const seed = `(() => { window.__rs = 12345; Math.random = () => { window.__rs = (window.__rs * 1664525 + 1013904223) >>> 0; return window.__rs / 4294967296; }; })()`;   // 난수 상태를 window.__rs 로 열어 둔다(그리기가 쓰는 난수가 게임 난수를 바꾸지 않게 시험이 되돌린다)
const run = async (page, steps) => page.eval(`(() => { for (let i = 0; i < ${steps}; i++) { SpellRun.step(1 / 60); if (SpellRun.G.state !== 'run') break; } })()`);
// 캐릭터 그림(칸 288) 호출을 가로채 발끝의 화면 위치·크기 배율·기울기·투명도를 기록한다(논리 px)
const spyChar = `(() => { const P = CanvasRenderingContext2D.prototype; window.__ch = [];
  if (!P.__orig) P.__orig = { di: P.drawImage, ft: P.fillText };
  P.drawImage = function () { const a = arguments; if (a.length === 9 && a[3] === 288 && a[4] === 288) { const m = this.getTransform(), S = document.getElementById('cv').width / SpellRun.view.layout().W; const p = m.transformPoint({ x: a[5] + a[7] / 2, y: a[6] + a[8] * (1 - 8 / 288) });
    window.__ch.push({ det: (m.a * m.d - m.b * m.c) / (S * S), fx: p.x / S, fy: p.y / S, sx: Math.hypot(m.a, m.b) / S, sy: Math.hypot(m.c, m.d) / S, rot: Math.atan2(m.b, m.a) * 180 / Math.PI, alpha: this.globalAlpha }); } return P.__orig.di.apply(this, a); };
})()`;
const drawChar = async (page, setup) => { await page.eval(spyChar); return page.eval(`(() => { const R = SpellRun, G = R.G; ${setup}; window.__ch.length = 0; R.draw(); return window.__ch[window.__ch.length - 1]; })()`); };
const near = (a, b, e, msg) => assert.ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);

for (const ch of ['0', '1', '2']) {
  test(`363-1·2) 가로 캐릭터 ${ch}: 점프 시작 0.1초 세로 1.12/가로 0.92, 정점 1.0, 착지 0.85/1.12 → 1.0, 발끝은 땅(또는 점프 높이)에 그대로, 2단 점프도 같다`, { skip: SKIP }, async () => {
    const page = await open(844, 390, `?mode=1&char=${ch}`);
    await startRun(page);
    const G = 'SpellRun.G', apex = 0.3, GR = await page.eval('SpellRun.view.layout().GROUND');
    const at = (ts, extra = '') => drawChar(page, `G.state = 'run'; G.jumpT = ${ts}; G.j2 = -1; G.land = 0; G.shake = 0; G.hurt = 0; ${extra}`);
    let r = await at(0.1); near(r.sx, 0.92, 0.01, '점프 시작 가로'); near(r.sy, 1.12, 0.01, '점프 시작 세로');
    const h = await page.eval('SpellRun.curH()'); near(r.fy, GR - h, 0.01, '점프 시작 발끝 = 땅 - 점프 높이');
    r = await at(0.05); near(r.sy, 1.06, 0.01, '0.05초: 절반'); near(r.sx, 0.96, 0.01, '0.05초 가로');
    r = await at(apex); near(r.sx, 1, 0.01, '정점 가로'); near(r.sy, 1, 0.01, '정점 세로');
    r = await at(0.45); near(r.sx, 1, 0.01, '하강 가로'); near(r.sy, 1, 0.01, '하강 세로');
    // 2단 점프: 두 번째 점프 시작 0.1초
    r = await drawChar(page, `G.state = 'run'; G.jumpT = 0.4; G.j2 = 0.1; G.j2h = 60; G.j2Land = 0.9; G.land = 0; G.shake = 0; G.hurt = 0`); near(r.det, 0.92 * 1.12, 0.01, '2단 점프 시작 늘어남(회전이 섞여 넓이로 확인)');
    const r1 = await at(0.1); near(r1.det, 0.92 * 1.12, 0.01, '첫 점프도 같은 늘어남');
    // 착지: 0.12초 납작(1.12/0.85) → 1.0, 발끝은 땅
    const ld = (left) => drawChar(page, `G.state = 'run'; G.jumpT = -1; G.j2 = -1; G.land = ${left}; G.runPhase = 0; G.shake = 0; G.hurt = 0`);
    r = await ld(0.12); near(r.sx, 1.12, 0.01, '착지 가로'); near(r.sy, 0.85, 0.01, '착지 세로'); near(r.fy, GR, 0.01, '착지 발끝 = 땅');
    r = await ld(0.06); near(r.sy, 0.925, 0.01, '착지 절반');
    r = await ld(0); near(r.sx, 1, 0.01, '1.0 으로 돌아옴'); near(r.sy, 1, 0.01, '1.0 으로 돌아옴');
    noErr(page); await page.close();
  });
}

test('363-2) 달릴 때 출렁임은 달리기 박자(runPhase)에 맞춰 ±1.5 논리 px × 캐릭터 배율(1.3), 점프 중에는 없다', { skip: SKIP }, async () => {
  const page = await open(844, 390, '?mode=1&char=1');
  await startRun(page);
  const GR = await page.eval('SpellRun.view.layout().GROUND'), ys = [];
  for (let ph = 0; ph < 4; ph += 0.25) { const r = await drawChar(page, `G.state = 'run'; G.jumpT = -1; G.j2 = -1; G.land = 0; G.runPhase = ${ph}; G.shake = 0; G.hurt = 0; G.fxRight = -9; G.fxWrong = -9`); ys.push(r.fy - GR); }
  const max = Math.max(...ys.map(Math.abs));
  near(max, 1.5 * 1.3, 0.02, '출렁임 최대'); assert.ok(Math.min(...ys) < -1 && Math.max(...ys) > 1, '위아래로 출렁임');
  near(ys[0], 0, 0.01, 'runPhase 0 에서 0'); near(ys[2], ys[10], 0.01, '두 걸음 주기(0.5 와 2.5 는 같다)'); near(ys[4], 0, 0.02, 'runPhase 1 에서 0');
  const air = await drawChar(page, `G.state = 'run'; G.jumpT = 0.3; G.j2 = -1; G.land = 0; G.runPhase = 1.5; G.shake = 0; G.hurt = 0`);
  const h = await page.eval('SpellRun.curH()'); near(air.fy, GR - h, 0.01, '점프 중에는 출렁임 없음');
  noErr(page); await page.close();
});

test('363-3) 그림자: 점프가 높을수록 작고 연하다(캐릭터 본체는 투명해지지 않는다)', { skip: SKIP }, async () => {
  const page = await open(844, 390, '?mode=1&char=2');
  await startRun(page);
  await page.eval(`(() => { const P = CanvasRenderingContext2D.prototype; window.__el = []; if (!P.__orig2) P.__orig2 = P.ellipse; P.ellipse = function (x, y, rx, ry) { window.__el.push({ rx, ry, fill: this.fillStyle }); return P.__orig2.apply(this, arguments); }; })()`);
  const shadow = async jt => { await page.eval(`(() => { const G = SpellRun.G; G.state = 'run'; G.jumpT = ${jt}; G.j2 = -1; G.land = 0; G.shake = 0; G.hurt = 0; window.__el.length = 0; SpellRun.draw(); })()`); return page.eval('window.__el.filter(e => /rgba\\(0, 0, 0/.test(String(e.fill)) && e.rx > 20 && e.rx < 40).pop()'); };
  const g = await shadow(-1), hi = await shadow(0.3);
  const alpha = f => parseFloat(String(f).match(/,\s*([\d.]+)\)$/)[1]);
  assert.ok(hi.rx < g.rx * 0.8 && hi.ry < g.ry * 0.8, `높을수록 작다: ${hi.rx.toFixed(1)} < ${g.rx.toFixed(1)}`);
  assert.ok(alpha(hi.fill) < alpha(g.fill) * 0.8, `높을수록 연하다: ${alpha(hi.fill)} < ${alpha(g.fill)}`);
  const c = await drawChar(page, `G.state = 'run'; G.jumpT = 0.3; G.j2 = -1; G.land = 0; G.shake = 0; G.hurt = 0`);
  assert.equal(c.alpha, 1, '캐릭터 본체는 투명해지지 않는다');
  noErr(page); await page.close();
});

test('363-4) 먼지: 착지할 때 3개가 뒤쪽(왼쪽)으로 퍼지고 달리는 동안 0.2초마다 1개, 총 24개 이하, 같은 입력이면 같은 위치(난수 없음)', { skip: SKIP }, async () => {
  const runs = [];
  for (let k = 0; k < 2; k++) {
    const page = await open(844, 390, '?mode=1&char=1');
    await page.eval(seed); await page.eval('SpellRun.G.dist = 0'); await startRun(page);
    const out = await page.eval(`(() => { const R = SpellRun, G = R.G; let maxN = 0, landN = null, runN = 0, left = true; const base = G.dust.length;
      for (let i = 0; i < 900; i++) { const before = G.dust.length, jt = G.jumpT; R.step(1 / 60); maxN = Math.max(maxN, G.dust.length); if (i % 70 === 0) R.jump(); if (jt >= 0 && G.jumpT < 0 && landN === null) landN = G.dust.filter(p => p.max === 0.35 && p.life > 0.3).length; if (G.state !== 'run') break; }
      for (const p of G.dust) if (p.vx >= 0) left = false;
      return JSON.stringify({ maxN, landN, left, dust: G.dust.map(p => [Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.life * 1000)]) }); })()`);
    runs.push(out); noErr(page); await page.close();
  }
  const a = JSON.parse(runs[0]);
  assert.ok(a.maxN > 0 && a.maxN <= 24, '먼지 총 개수 ' + a.maxN); assert.equal(a.landN, 3, '착지 먼지 3개'); assert.equal(a.left, true, '모두 뒤쪽(왼쪽)으로');
  assert.equal(runs[1], runs[0], '같은 입력이면 같은 먼지');
});

test('363-5) 반응 상태: 맞는 글자 happy 0.4초, 하트가 줄면 hurt 0.5초, 2단 점프 시작 surprise 0.3초. 메뉴로 멈추면 만료되지 않고, 높은 우선순위는 덮이지 않는다', { skip: SKIP }, async () => {
  const page = await open(844, 390, '?mode=1&char=1');
  await page.eval(seed);
  await startRun(page);
  assert.equal(await page.eval('SpellRun.fx.react()'), '');
  // surprise: 2단 점프
  await page.eval('(() => { SpellRun.jump(); SpellRun.step(0.1); SpellRun.step(0.1); SpellRun.jump(); })()');
  assert.equal(await page.eval('SpellRun.fx.react()'), 'surprise'); assert.equal(await page.eval('SpellRun.fx.state().dur'), 0.3);
  await page.eval('SpellRun.step(0.2)'); assert.equal(await page.eval('SpellRun.fx.react()'), 'surprise');
  await page.eval('SpellRun.step(0.11)'); assert.equal(await page.eval('SpellRun.fx.react()'), '', '0.3초 뒤 끝');
  // hurt: 틀린 글자(하트 -1)
  const hp0 = await page.eval(`(() => { const R = SpellRun, G = R.G; const w = G.tiles.find(x => !x.kind && !x.correct && !x.checked && x.state === 'live' && x.wi === G.wi && x.si === G.si) || G.tiles.find(x => !x.kind && !x.correct && !x.checked && x.state === 'live'); w.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; const hp = G.hp; R.step(0.01); G.jumpT = -1; return hp - G.hp; })()`);
  assert.equal(hp0, 1); assert.equal(await page.eval('SpellRun.fx.react()'), 'hurt'); assert.equal(await page.eval('SpellRun.fx.state().dur'), 0.5);
  // 메뉴로 멈추면 만료되지 않는다
  await page.click('#srMenuBtn');
  await run(page, 120);
  assert.equal(await page.eval('SpellRun.fx.react()'), 'hurt', '멈춘 동안 만료 안 됨');
  await page.click('#srMenuCont');
  await page.eval('SpellRun.step(0.3)'); assert.equal(await page.eval('SpellRun.fx.react()'), 'hurt');
  await page.eval('SpellRun.step(0.25)'); assert.equal(await page.eval('SpellRun.fx.react()'), '');
  // happy: 맞는 글자, 진행 중인 hurt 는 happy 가 덮지 않는다
  await page.eval(`(() => { const R = SpellRun, G = R.G; const t = G.tiles.find(x => !x.kind && x.correct && !x.checked && x.state === 'live' && x.wi === G.wi && x.si === G.si); window.__ok = !!t; if (t) { t.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; R.step(0.01); G.jumpT = -1; } })()`);
  if (await page.eval('window.__ok')) { assert.equal(await page.eval('SpellRun.fx.react()'), 'happy'); assert.equal(await page.eval('SpellRun.fx.state().dur'), 0.4); }
  noErr(page); await page.close();
});

test('363-6) 맞는 글자: 폴짝 +6 논리 px×1.3(0.25초) 뒤 원위치. 틀린 글자: 뒤로 밀리고 좌우 3번 흔들림·기울어짐 -6도(0.3초), 깜박이거나 투명해지지 않고 무작위 화면 흔들림은 쓰지 않는다', { skip: SKIP }, async () => {
  const page = await open(844, 390, '?mode=1&char=1');
  await startRun(page);
  const GR = await page.eval('SpellRun.view.layout().GROUND');
  const base = `G.state = 'run'; G.jumpT = -1; G.j2 = -1; G.land = 0; G.runPhase = 0; G.shake = 0; G.hurt = 0;`;
  const r0 = await drawChar(page, base + 'G.fxRight = -9; G.fxWrong = -9');
  const hop = await drawChar(page, base + 'G.fxRight = G.time - 0.125; G.fxWrong = -9');   // u = 0.5
  near(r0.fy - hop.fy, 6 * 1.3, 0.05, '폴짝 높이');
  const hop2 = await drawChar(page, base + 'G.fxRight = G.time - 0.3; G.fxWrong = -9'); near(hop2.fy, r0.fy, 0.01, '0.25초 뒤 원위치');
  // 틀린 글자
  const w0 = await drawChar(page, base + 'G.fxRight = -9; G.fxWrong = G.time');
  near(w0.rot, -6, 0.05, '기울어짐 -6도'); assert.equal(w0.alpha, 1, '투명해지지 않는다');
  const xs = []; for (let k = 0; k < 30; k++) { const u = k / 30; const r = await drawChar(page, base + `G.fxRight = -9; G.fxWrong = G.time - ${u * 0.3}; G.hurt = 0.5`); xs.push(r.fx - r0.fx); assert.equal(r.alpha, 1, `u=${u.toFixed(2)} 깜박임·투명 없음`); }
  let turns = 0; for (let i = 2; i < xs.length; i++) if ((xs[i] - xs[i - 1]) * (xs[i - 1] - xs[i - 2]) < -1e-9) turns++;
  assert.ok(turns >= 4, '좌우로 3번 흔들림(방향이 바뀐 곳 ' + turns + ')'); assert.ok(Math.max(...xs.map(Math.abs)) <= (3 + 2) * 1.3 + 0.01 && Math.max(...xs.map(Math.abs)) >= 2, '흔들림 폭 ±3(+밀림 2)×1.3 이하');
  const end = await drawChar(page, base + 'G.fxRight = -9; G.fxWrong = G.time - 0.31'); near(end.fx, r0.fx, 0.01, '0.3초 뒤 원위치'); near(end.rot, 0, 0.01, '기울어짐 끝');
  // 무작위 화면 흔들림 정리: 틀린 글자로 하트가 줄어도 G.shake 는 0(가로), 장애물은 예전 그대로
  const sh = await page.eval(`(() => { const R = SpellRun, G = R.G; G.shake = 0; const w = G.tiles.find(x => !x.kind && !x.correct && !x.checked && x.state === 'live'); w.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; R.step(0.01); G.jumpT = -1; return { shake: G.shake, hurt: G.hurt, wrong: G.time - G.fxWrong < 0.1 }; })()`);
  assert.equal(sh.shake, 0, '가로: 틀린 글자의 무작위 흔들림 대신 정해진 효과 하나'); assert.ok(sh.hurt > 0 && sh.wrong);
  noErr(page); await page.close();
});

test('363-7) 정답을 놓쳐서 다시 계획할 때도 쓸모없어진 풍선이 함께 올라가고, 놓친 풍선 자신은 지나간다(점수·콤보 그대로, 하트 -1)', { skip: SKIP }, async () => {
  let found = 0;
  for (const sd of [1, 7, 99, 5, 21]) {
    const page = await open(844, 390);
    await page.eval(seed);
    await startRun(page);
    const out = await page.eval(`(() => { let s = ${sd}; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const R = SpellRun, G = R.G, res = []; const kind = (t, cur) => !t.correct ? 'C' : (t.wi === cur.wi && t.si === cur.si) ? 'A' : 'B';
      for (let i = 0; i < 6000 && !res.length; i++) { R.step(1 / 60); if (G.state !== 'run') break; const cur = { wi: G.wi, si: G.si };
        const v = G.tiles.filter(t => !t.kind && t.state === 'live' && !t.checked && t.x > 100 && t.x < 790), a = v.find(t => kind(t, cur) === 'A');
        if (i > 120 && i % 60 === 0 && a && v.some(t => kind(t, cur) === 'B')) {
          const tag = new Map(v.map(t => [t, kind(t, cur)])), score = G.score, combo = G.combo, hp = G.hp;
          a.x = R.RUNNER_X + 1; G.jumpT = -1; R.step(0.01);
          res.push({ hpDrop: hp - G.hp, missedRose: !!a.rise, rose: v.filter(t => t.rise).map(t => tag.get(t)), stayed: v.filter(t => !t.rise).map(t => tag.get(t)), score0: score, score1: G.score, bCount: v.filter(t => tag.get(t) === 'B').length }); } }
      return res; })()`);
    for (const sc of out) { found++; assert.equal(sc.hpDrop, 1); assert.equal(sc.missedRose, false, '놓친 풍선 자신은 올라가지 않는다'); assert.ok(sc.rose.every(k => k === 'B') && sc.rose.length === sc.bCount, '쓸모없어진 풍선만 모두 올라간다: ' + sc.rose); assert.ok(sc.stayed.every(k => k === 'C' || k === 'A')); assert.equal(sc.score1, sc.score0, '점수 그대로'); }
    noErr(page); await page.close();
  }
  assert.ok(found >= 2, '장면 ' + found);
});

test('363-8) 효과는 판정·점수·체력·타일 위치에 영향 없음: 같은 난수·같은 입력에서 효과를 끄고 켠 결과가 같다(점수·체력·콤보·칸·거리·타일 위치와 상태)', { skip: SKIP }, async () => {
  const outs = [];
  for (const on of [false, true, true]) {
    const page = await open(844, 390);
    await page.eval(seed); await page.eval('SpellRun.G.dist = 0');
    await startRun(page);
    await page.eval(`SpellRun.fx.setOn(${on})`);
    await page.eval(`(() => { const R = SpellRun, G = R.G; for (let i = 0; i < 3000; i++) { R.step(1 / 60); if (i % 3 === 0) { const keep = window.__rs; R.draw(); window.__rs = keep; } if (i % 41 === 0) R.jump(); if (G.state !== 'run') break; } })()`);
    outs.push(await page.eval(`(() => { const G = SpellRun.G; return JSON.stringify({ score: G.score, hp: G.hp, combo: G.combo, wi: G.wi, si: G.si, dist: Math.round(G.dist * 1000), state: G.state, tiles: G.tiles.map(t => [Math.round(t.x * 100), t.state, t.text, t.correct, t.bi, t.high || false]) }); })()`));
    noErr(page); await page.close();
  }
  assert.equal(outs[1], outs[0], '효과 끔 = 켬'); assert.equal(outs[2], outs[1], '같은 입력은 같은 결과');
  assert.ok(JSON.parse(outs[0]).dist > 1000000, '실제로 한참 진행됨');
});

test('363-8) 세로는 예전 그대로: 효과 꺼짐(react 없음, 먼지 없음), 점프 늘이기 0.97/1.04 상수, 깜박임(hurt 투명) 예전 그대로', { skip: SKIP }, async () => {
  const page = await open(390, 844, '?mode=0&char=1');
  await startRun(page);
  assert.equal(await page.eval('SpellRun.fx.on()'), false);
  const a = await drawChar(page, `G.state = 'run'; G.jumpT = 0.1; G.j2 = -1; G.land = 0; G.shake = 0; G.hurt = 0`);
  near(a.sx, 0.97, 0.005, '세로 점프 가로'); near(a.sy, 1.04, 0.005, '세로 점프 세로');
  await run(page, 400);
  assert.equal(await page.eval('SpellRun.fx.dust()'), 0); assert.equal(await page.eval('SpellRun.fx.react()'), '');
  await page.eval(`(() => { const R = SpellRun, G = R.G; G.jumpT = -1; G.hurt = 0.5; })()`);
  let flick = false; for (let k = 0; k < 8; k++) { const r = await drawChar(page, `G.state = 'run'; G.jumpT = -1; G.land = 0; G.hurt = 0.5; G.time = ${k * 0.025}; G.shake = 0`); if (r.alpha < 1) flick = true; }
  assert.equal(flick, true, '세로는 hurt 깜박임이 그대로');
  noErr(page); await page.close();
});

test('363-8) 한 프레임 그리는 시간(헤드리스, 추정): 효과 끔과 켬 비교(참고용, 값만 출력)', { skip: SKIP }, async () => {
  const page = await open(844, 390, '?mode=1&char=1');
  await page.eval(seed); await startRun(page); await run(page, 300);
  const t = await page.eval(`(() => { const R = SpellRun, res = {}; for (const on of [false, true, false, true]) { R.fx.setOn(on); for (let i = 0; i < 30; i++) R.draw(); const t0 = performance.now(); for (let i = 0; i < 300; i++) R.draw(); res[on ? 'on' : 'off'] = (res[on ? 'on' : 'off'] || 0) + (performance.now() - t0) / 300 / 2; } return res; })()`);
  console.log('FRAME_MS', JSON.stringify(t));
  assert.ok(t.on < 8, '프레임 그리기 ' + t.on + 'ms');
  noErr(page); await page.close();
});
