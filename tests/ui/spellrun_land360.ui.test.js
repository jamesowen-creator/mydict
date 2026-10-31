// 작업360: 가로 화면 손질 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// 확인: 캐릭터 1.3배(가로만, 발끝은 땅에 닿음), 타일 75%(폭·그림, 가로만), 흐림·희미 효과 없음(틀린 타일 포함), 상단은 하트·점수만 + [메뉴] 단추,
//       메뉴 항목·멈춤·재개(혼자는 멈추고 대결은 멈추지 않음), 세로는 예전 그대로
// 실행: node --test tests/ui/spellrun_land360.ui.test.js   (Chrome이 없으면 건너뜀)
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

test('360-5) 가로 상단: 하트·점수만 보이고 단어 N/M·속도 배지·소리·닫기·화면 단추는 없고 [메뉴] 단추가 있다. 세로는 예전 그대로', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  assert.equal(await page.eval(visible('#hearts')), true); assert.equal(await page.eval(visible('#score')), true);
  for (const id of ['#progress', '#speedTag', '#snd', '#srClose', '#srView']) assert.equal(await page.eval(visible(id)), false, id + ' 가로에서 숨김');
  assert.equal(await page.eval(visible('#srMenuBtn')), true, '[메뉴]');
  const m = await page.eval(`(() => { const b = document.getElementById('srMenuBtn').getBoundingClientRect(), s = document.getElementById('score').getBoundingClientRect(), bx = document.getElementById('box').getBoundingClientRect(); return { overlapScore: b.left < s.right && s.left < b.right && b.top < s.bottom && s.top < b.bottom, inBox: b.right <= bx.right && b.top >= bx.top }; })()`);
  assert.equal(m.overlapScore, false, '[메뉴]와 점수가 겹치지 않음'); assert.ok(m.inBox);
  noErr(page); await page.close();
  const pp = await open(390, 844, '?mode=0');
  await startRun(pp);
  for (const id of ['#progress', '#speedTag', '#snd', '#srClose', '#srView']) assert.equal(await pp.eval(visible(id)), true, id + ' 세로에서는 그대로');
  assert.equal(await pp.eval(visible('#srMenuBtn')), false, '세로에는 [메뉴] 단추가 없다');
  noErr(pp); await pp.close();
});

test('360-5) 메뉴: 계속하기 / 소리 켜기·끄기 / 세로로 바꾸기 / 닫기, 항목 44px 이상·판 안, 소리 항목이 소리를 바꾼다', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await page.click('#srMenuBtn');
  assert.equal(await page.eval('SpellRun.menu.open()'), true);
  const items = await page.eval(`Array.from(document.querySelectorAll('#srMenu button')).map(b => { const r = b.getBoundingClientRect(), bx = document.getElementById('box').getBoundingClientRect(); return { t: b.textContent, h: r.height, inBox: r.left >= bx.left && r.right <= bx.right && r.top >= bx.top && r.bottom <= bx.bottom }; })`);
  assert.deepEqual(items.map(i => i.t), ['계속하기', '소리 끄기', '배경음 끄기', '세로로 바꾸기', '닫기']);
  assert.ok(items.every(i => i.h >= 43.5 && i.inBox), JSON.stringify(items));
  await page.click('#srMenuSnd');
  assert.equal(await page.eval("document.getElementById('srMenuSnd').textContent"), '소리 켜기');
  assert.equal(await page.eval("document.getElementById('snd').textContent"), '소리 끔', '시작 화면 단추와 같은 상태');
  await page.click('#srMenuSnd');
  assert.equal(await page.eval("document.getElementById('srMenuSnd').textContent"), '소리 끄기');
  await page.click('#srMenuCont');
  assert.equal(await page.eval('SpellRun.menu.open()'), false); assert.equal(await page.eval(visible('#srMenu')), false);
  noErr(page); await page.close();
});

test('360-5) 메뉴 멈춤·재개: 혼자 할 때는 열려 있는 동안 시간·점수·타일이 그대로이고, 닫으면 이어서 움직인다. 점프 입력도 무시. 바깥을 누르면 메뉴만 닫힌다', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await page.eval('(() => { for (let i = 0; i < 90; i++) SpellRun.step(1 / 60); })()');
  const snap = '(() => { const G = SpellRun.G; return { time: G.time, score: G.score, dist: G.dist, hp: G.hp, state: G.state, xs: G.tiles.map(t => t.x).join(","), n: G.tiles.length, speed: G.speed }; })()';
  await page.click('#srMenuBtn');
  const a = await page.eval(snap);
  await page.eval('(() => { for (let i = 0; i < 120; i++) SpellRun.step(1 / 60); SpellRun.jump(); })()');
  const b = await page.eval(snap);
  assert.deepEqual(b, a, '메뉴가 열린 동안 아무것도 움직이지 않는다');
  assert.equal(await page.eval('SpellRun.G.jumpT'), -1, '열려 있는 동안 점프 입력은 무시');
  await page.click('#srMenuCont');
  await page.eval('(() => { for (let i = 0; i < 60; i++) SpellRun.step(1 / 60); })()');
  const c = await page.eval(snap);
  assert.ok(Math.abs(c.time - a.time - 1) < 1e-6, '닫은 뒤 게임 시간은 멈춘 시간을 건너뛰고 1초만 흐른다: ' + (c.time - a.time));
  assert.ok(c.dist > a.dist && c.xs !== a.xs, '닫으면 다시 움직인다');
  await page.click('#srMenuBtn');
  await page.eval("document.getElementById('box').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 200 }))");
  assert.equal(await page.eval('SpellRun.menu.open()'), false); assert.equal(await page.eval('SpellRun.G.jumpT'), -1, '바깥 누름은 점프가 아니다');
  noErr(page); await page.close();
});

test('360-5) 대결에서는 메뉴가 열려 있어도 멈추지 않는다(menuPauses=false), 혼자는 멈춘다', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await page.eval('SpellRun.vs.game.on = true');
  await page.click('#srMenuBtn');
  const t0 = await page.eval('SpellRun.G.time');
  assert.equal(await page.eval('SpellRun.menu.pauses()'), false);
  await page.eval('(() => { for (let i = 0; i < 60; i++) SpellRun.step(1 / 60); })()');
  assert.ok(Math.abs((await page.eval('SpellRun.G.time')) - t0 - 1) < 1e-6, '대결: 1초 흐름');
  await page.eval('SpellRun.vs.game.on = false');
  assert.equal(await page.eval('SpellRun.menu.pauses()'), true, '혼자: 멈춤');
  await page.eval("document.getElementById('srMenuCont').click()");
  noErr(page); await page.close();
});

for (const [mode, label] of [[1, '가로'], [0, '세로']]) {
  test(`360-2) ${label}: 캐릭터 3종 그림 크기와 발끝(가로 1.3배·세로 1배), 러너 위치(판정)는 그대로`, { skip: SKIP }, async () => {
    for (const ch of ['0', '1', '2']) {
      const page = await open(mode ? 844 : 390, mode ? 390 : 844, `?mode=${mode}&char=${ch}`);
      await startRun(page);
      await page.eval(spyDraw);
      await page.eval('SpellRun.G.jumpT = -1; SpellRun.G.land = 0; SpellRun.G.hurt = 0; SpellRun.draw()');
      const r = await page.eval('(() => { const s = window.__sp.img.pop(), L = SpellRun.view.layout(); return { dw: s.dw, foot: s.dy + s.dh - 8 / 288 * s.dh, ground: L.GROUND, rx: SpellRun.RUNNER_X }; })()');
      assert.ok(Math.abs(r.dw - 92 * (mode ? 1.3 : 1)) < 1e-6, `${label} char=${ch} 그림 크기 ${r.dw}`);
      assert.ok(Math.abs(r.foot - r.ground) < 0.01, `${label} char=${ch} 발끝 ${r.foot} = 땅 ${r.ground}`);
      assert.equal(r.rx, mode ? 149 : 72, '러너 위치: 가로는 작업370에서 149(몸 중심 약 16%), 세로는 72 그대로');
      noErr(page); await page.close();
    }
  });
}

test('360-3) 가로 타일: 폭이 75%(일반 43.5, 조각은 줄어든 폭), 세로는 그대로. 판정 상수(점프 높이)는 그대로', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await page.eval('(() => { for (let i = 0; i < 240; i++) SpellRun.step(1 / 60); })()');
  const ws = await page.eval('SpellRun.G.tiles.filter(t => !t.kind).map(t => ({ w: t.w, chunk: t.chunk, len: t.text.length }))');
  assert.ok(ws.length > 0, '타일이 있다');
  for (const t of ws) assert.ok(Math.abs(t.w - (t.chunk ? 20 + t.len * 26 : 58) * 0.75) < 1e-9, JSON.stringify(t));
  assert.equal(await page.eval('SpellRun.CONFIG.GRAB_H + "," + SpellRun.CONFIG.HIGH_GRAB_H'), '22,160');
  noErr(page); await page.close();
  const pp = await open(390, 844, '?mode=0');
  await startRun(pp);
  await pp.eval('SpellRun.CONFIG.OBSTACLE_PROB = 0; SpellRun.G.spawnT = 0; SpellRun.step(0.1)');
  const w2 = await pp.eval('SpellRun.G.tiles.filter(t => !t.kind).map(t => t.w)');
  assert.ok(w2.length > 0 && w2.every(w => w === 58 || (w - 20) % 26 === 0), '세로: ' + w2);
  noErr(pp); await pp.close();
});

test('360-4) 가로: 다음 묶음·다른 칸 타일도 흐리지 않고(모두 선명도 1), 틀린 타일을 먹어도 희미해지거나 사라지지 않는다(체력 -1 규칙은 그대로)', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await page.eval('(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })()');   // 난수 고정: 같은 판이 나오게(가끔 장면이 안 만들어지던 것을 막는다)
  await startRun(page);
  await page.eval('(() => { for (let i = 0; i < 400; i++) { SpellRun.step(1 / 60); const G = SpellRun.G; if (G.state !== "run") break; for (const t of G.tiles) if (!t.kind && t.x <= SpellRun.RUNNER_X) t.checked = true; } })()');
  await page.eval(spyDraw);
  await page.eval('SpellRun.draw()');
  const alphas = await page.eval('(() => { const texts = new Set(SpellRun.G.tiles.filter(t => !t.kind).map(t => t.text)); return window.__sp.txt.filter(x => texts.has(x.t)).map(x => x.a); })()');
  assert.ok(alphas.length >= 3, '타일이 여럿 그려진다: ' + alphas.length);
  assert.ok(alphas.every(a => a === 1), '모든 타일 선명도 1: ' + alphas);
  const before = await page.eval('(() => { const R = SpellRun, G = R.G; const w = G.tiles.find(t => !t.kind && !t.correct && !t.checked && t.state === "live"); if (!w) return null; w.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; window.__w = w; return { hp: G.hp }; })()');
  assert.ok(before, '틀린 타일이 있다');
  await page.eval('SpellRun.step(0.02)');
  const after = await page.eval('(() => { const w = window.__w, G = SpellRun.G; return { hp: G.hp, state: w.state, wrong: !!w.wrong, has: G.tiles.includes(w) }; })()');
  assert.equal(after.hp, before.hp - 1, '체력 -1 규칙 그대로'); assert.equal(after.state, 'live', '사라지는 상태로 바뀌지 않는다'); assert.equal(after.wrong, true); assert.equal(after.has, true);
  for (let k = 0; k < 6; k++) {
    await page.eval('(() => { SpellRun.G.jumpT = -1; SpellRun.step(0.05); })()');
    const st = await page.eval('(() => { const w = window.__w, G = SpellRun.G; return { has: G.tiles.includes(w), state: w.state, x: w.x }; })()');
    if (st.x > -100) { assert.equal(st.has, true, '화면에 있는 동안 사라지지 않는다'); assert.equal(st.state, 'live'); }
  }
  await page.eval(spyDraw);
  await page.eval('SpellRun.draw()');
  const wa = await page.eval('(() => { const w = window.__w, G = SpellRun.G; return G.tiles.includes(w) ? window.__sp.txt.filter(x => x.t === w.text).map(x => x.a) : [1]; })()');
  assert.ok(wa.every(a => a === 1), '틀린 타일을 그릴 때 투명도 1: ' + wa);
  noErr(page); await page.close();
});
