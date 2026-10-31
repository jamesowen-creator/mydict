// 작업365: 소리(효과음·배경음악) 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// 확인: OfflineAudioContext 로 효과음·두 곡 렌더(최대치 0.9 미만·무음 아님·NaN 없음), 소리 끔·배경음 끔·메뉴 일시정지·화면 숨김, 올라가는 소리 한 번, 켜기·끄기 저장,
//       판정·점수·타일 불변, 콘솔 오류·경고 없음, 프레임 시간
// 실행: node --test tests/ui/spellrun_sound365.ui.test.js   (Chrome이 없으면 건너뜀)
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
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__warns = []; (function () { var w = console.warn; console.warn = function () { window.__warns.push(Array.prototype.join.call(arguments, ' ')); return w.apply(console, arguments); }; })();" });   // 콘솔 경고도 모은다
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

const seed = `(() => { window.__rs = 12345; Math.random = () => { window.__rs = (window.__rs * 1664525 + 1013904223) >>> 0; return window.__rs / 4294967296; }; })()`;
const run = async (page, steps) => page.eval(`(() => { for (let i = 0; i < ${steps}; i++) { SpellRun.step(1 / 60); if (SpellRun.G.state !== 'run') break; } })()`);
const SFX = ['jump', 'jump2', 'land', 'pop', 'rise', 'bad', 'speed', 'hint', 'angel', 'heart', 'hit', 'over', 'boss', 'word', 'tick', 'win', 'fail'];
// 같은 코드(buildSoundGraph·playVoices·sfxPlan·songEvents)를 OfflineAudioContext 에 렌더해 최대치·무음·NaN 을 잰다
const renderCode = `(async () => { const L = window.SpellRunLogic, S = L.SOUND, out = {};
  const render = async (secs, build) => { const oc = new OfflineAudioContext(1, Math.ceil(44100 * secs), 44100), g = L.buildSoundGraph(oc), noise = L.makeNoiseBuffer(oc); build(oc, g, noise); const buf = await oc.startRendering(); const d = buf.getChannelData(0); let pk = 0, nan = 0, sq = 0; for (let i = 0; i < d.length; i++) { const v = d[i]; if (Number.isNaN(v) || !Number.isFinite(v)) nan++; else { if (Math.abs(v) > pk) pk = Math.abs(v); sq += v * v; } } return { peak: pk, nan, rms: Math.sqrt(sq / d.length) }; };
  for (const n of ${JSON.stringify(SFX)}) { const bus = (n === 'win' || n === 'fail') ? 'music' : 'sfx'; out[n] = await render(3.5, (oc, g, noise) => L.playVoices(oc, g[bus], L.sfxPlan(n, 10), 0.05, { noise })); }
  for (const [song, secs] of [['day', ['A', 'B']], ['boss', ['A']]]) {
    out['song_' + song] = await render(9, (oc, g, noise) => { const sg = L.SONGS[song]; let t = 0.05, pos = 0; const gn = oc.createGain(); gn.connect(g.music); const per = sg.bars * 8; const ss = L.slotSec(sg.bpm, 1);
      const by = {}; for (const s of secs) { by[s] = {}; for (const e of L.songEvents(song, s)) (by[s][e.slot] = by[s][e.slot] || []).push(e); }
      while (t < 8.6) { const sec = secs[Math.floor(pos / per) % secs.length]; for (const e of (by[sec][pos % per] || [])) L.playVoices(oc, gn, L.eventVoices(e, ss), t, { noise }); t += ss; pos++; } });
  }
  return out; })()`;

test('365-6) OfflineAudioContext 로 효과음 17종과 두 곡의 앞부분(약 8초)을 렌더: 최대치 0.9 미만, 무음 아님, NaN 없음', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  const out = await page.eval(renderCode);
  const rows = [];
  for (const [k, v] of Object.entries(out)) {
    rows.push(`${k}: peak ${v.peak.toFixed(3)} rms ${v.rms.toFixed(4)}`);
    assert.equal(v.nan, 0, k + ' NaN'); assert.ok(v.peak < 0.9, `${k} 최대치 ${v.peak}`); assert.ok(v.peak > 0.005 && v.rms > 0.0005, `${k} 무음이 아님(최대치 ${v.peak}, rms ${v.rms})`);
  }
  console.log('RENDER', rows.join(' | '));
  const sfxPeak = Math.max(...SFX.filter(n => n !== 'win' && n !== 'fail').map(n => out[n].peak)), musicPeak = Math.max(out.song_day.peak, out.song_boss.peak);
  console.log('PEAKS sfx(max)', sfxPeak.toFixed(3), 'music(max)', musicPeak.toFixed(3), 'ratio', (musicPeak / sfxPeak).toFixed(2));
  assert.ok(musicPeak < sfxPeak, '음악은 효과음보다 작다');
  noErr(page); await page.close();
});

test('365-1·4) 하나의 AudioContext·버스 구성, 소리 끔이면 예약되는 소리 0, 배경음 끔이면 음악만 없고 효과음은 나온다, 노드 24개 이하', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await page.click('#srMenuBtn'); await page.click('#srMenuCont');   // 사용자 누름: 소리를 깨운다
  const st = await page.eval('(() => { const a = SpellRun.sound.wake(); return { state: a && a.state, has: !!SpellRun.sound.SND.g, sameCtx: SpellRun.sound.SND.ac === a }; })()');
  assert.ok(st.has && st.sameCtx, '하나의 컨텍스트와 그래프');
  await page.waitFor("SpellRun.sound.SND.ac.state === 'running'", 3000).catch(() => {});
  const running = await page.eval("SpellRun.sound.SND.ac.state === 'running'");
  // 소리 끔: 예약되는 소리 0
  await page.eval('SpellRun.sound.SND.on = false');
  const c0 = await page.eval('SpellRun.sound.created()'), m0 = await page.eval('SpellRun.sound.MUS.count');
  await run(page, 120); await page.eval('SpellRun.jump(); SpellRun.step(0.1)'); await sleep(200);
  assert.equal(await page.eval('SpellRun.sound.created()'), c0, '소리 끔: 효과음 예약 0'); assert.equal(await page.eval('SpellRun.sound.MUS.count'), m0, '소리 끔: 음악 예약 0');
  assert.equal(await page.eval('SpellRun.sound.wanted()'), null);
  await page.eval('SpellRun.sound.SND.on = true');
  if (running) {
    await sleep(400);
    assert.ok((await page.eval('SpellRun.sound.MUS.count')) > m0, '소리 켬: 음악이 예약된다');
    // 배경음 끔: 음악만 없다
    await page.eval('SpellRun.sound.setBgm(false)');
    await sleep(100);
    const m1 = await page.eval('SpellRun.sound.MUS.count'), c1 = await page.eval('SpellRun.sound.created()');
    await page.eval('SpellRun.jump(); SpellRun.step(0.1)'); await sleep(300);
    assert.equal(await page.eval('SpellRun.sound.MUS.count'), m1, '배경음 끔: 음악 예약 0'); assert.ok((await page.eval('SpellRun.sound.created()')) > c1, '배경음 끔: 효과음은 나온다');
    assert.equal(await page.eval('SpellRun.sound.wanted()'), null);
    await page.eval('SpellRun.sound.setBgm(true)');
  }
  // 동시에 울리는 노드는 24개 이하
  const cap = await page.eval(`(() => { const L = window.SpellRunLogic, a = SpellRun.sound.wake(); if (!a || a.state !== 'running') return null; let cnt = 0; const env = { canStart: () => SpellRun.sound.SND.nodes < 24, onStart: () => { SpellRun.sound.SND.nodes++; cnt++; }, onEnd: () => { SpellRun.sound.SND.nodes--; } }; for (let k = 0; k < 10; k++) L.playVoices(a, SpellRun.sound.SND.g.sfx, L.sfxPlan('win'), a.currentTime + 0.01, Object.assign({ noise: SpellRun.sound.SND.noise }, env)); return { started: cnt, nodes: SpellRun.sound.SND.nodes }; })()`);
  if (cap) assert.ok(cap.nodes <= 24 && cap.started <= 24 + 12, '노드 상한: ' + JSON.stringify(cap));
  console.log('AUDIO', JSON.stringify({ running, cap }));
  noErr(page); await page.close();
});

test('365-3) 메뉴 일시정지: 혼자 할 때는 열면 음악이 멈추고(예약 0) 닫으면 이어서, 대결(menuPauses=false)에서는 멈추지 않는다. 화면이 숨겨지면 멈추고 돌아오면 이어서(0.5초 중복 방지)', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await startRun(page);
  await page.click('#srMenuBtn'); await page.click('#srMenuCont');
  const ok = await page.eval("SpellRun.sound.wake() && SpellRun.sound.SND.ac.state === 'running'").catch(() => false);
  if (!ok) { await page.waitFor("SpellRun.sound.SND.ac.state === 'running'", 3000).catch(() => {}); }
  if (!(await page.eval("SpellRun.sound.SND.ac.state === 'running'"))) { console.log('AUDIO 컨텍스트가 running 이 아니라 일시정지 시험의 예약 확인은 건너뜀'); noErr(page); await page.close(); return; }
  await sleep(300);
  const hold = async () => page.eval('JSON.stringify(SpellRun.sound.MUS.hold)');
  assert.equal(await hold(), '{"menu":false,"hidden":false}');
  const m0 = await page.eval('SpellRun.sound.MUS.count'); assert.ok(m0 > 0, '음악이 예약되고 있다');
  await page.click('#srMenuBtn'); await sleep(150);
  assert.equal(await hold(), '{"menu":true,"hidden":false}');
  const pos0 = await page.eval('SpellRun.sound.MUS.cur && SpellRun.sound.MUS.cur.pos'), m1 = await page.eval('SpellRun.sound.MUS.count'); await sleep(400);
  assert.equal(await page.eval('SpellRun.sound.MUS.count'), m1, '메뉴가 열린 동안 음악 예약 0'); assert.equal(await page.eval('SpellRun.sound.MUS.cur.pos'), pos0, '같은 위치에서 멈춘다');
  await page.click('#srMenuCont'); await sleep(400);
  assert.equal(await hold(), '{"menu":false,"hidden":false}'); assert.ok((await page.eval('SpellRun.sound.MUS.count')) > m1, '닫으면 이어서 예약');
  // 대결: 메뉴를 열어도 멈추지 않는다
  await page.eval('SpellRun.vs.game.on = true');
  await page.click('#srMenuBtn'); await sleep(100);
  assert.equal(await hold(), '{"menu":false,"hidden":false}', '대결: 멈추지 않음'); const m2 = await page.eval('SpellRun.sound.MUS.count'); await sleep(400);
  assert.ok((await page.eval('SpellRun.sound.MUS.count')) > m2, '대결: 음악 계속');
  await page.eval("document.getElementById('srMenuCont').click(); SpellRun.vs.game.on = false");
  // 화면 숨김·복귀
  await page.eval(`(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hid }); window.__hid = true; document.dispatchEvent(new Event('visibilitychange')); })()`);
  await sleep(100); assert.equal(await hold(), '{"menu":false,"hidden":true}'); const m3 = await page.eval('SpellRun.sound.MUS.count'); await sleep(300);
  assert.equal(await page.eval('SpellRun.sound.MUS.count'), m3, '숨겨진 동안 음악 예약 0');
  await page.eval(`(() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); })()`);
  await sleep(300); assert.equal(await hold(), '{"menu":false,"hidden":false}', '돌아오면 이어서(pageshow 가 0.5초 안에 또 와도 한 번)'); assert.ok((await page.eval('SpellRun.sound.MUS.count')) > m3);
  noErr(page); await page.close();
});

test('365-2) 올라가는 소리는 풍선이 몇 개 올라가도 한 번, 오답은 "뿌잉" 한 번, 터짐은 콤보 음계. 효과음 호출은 판정과 같은 자리(점프·착지·번개·종·하프·쿵·게임 오버·보스·팡파르)', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await page.eval(seed);
  await startRun(page);
  await page.eval('SpellRun.sound.SND.log = []');
  const scene = await page.eval(`(() => { let s = 5; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const R = SpellRun, G = R.G; const kind = (t, cur) => !t.correct ? 'C' : (t.wi === cur.wi && t.si === cur.si) ? 'A' : 'B';
    for (let i = 0; i < 6000; i++) { R.step(1 / 60); if (G.state !== 'run') break; const cur = { wi: G.wi, si: G.si }, v = G.tiles.filter(t => !t.kind && t.state === 'live' && !t.checked && t.x > 100 && t.x < 790), w = v.find(t => !t.correct && t.wi === cur.wi && t.si === cur.si);
      if (i > 120 && i % 60 === 0 && w && v.some(t => kind(t, cur) === 'B')) { window.__log0 = SpellRun.sound.SND.log.length; w.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; R.step(0.01); G.jumpT = -1; return { rising: G.tiles.filter(t => t.rise).length, log: SpellRun.sound.SND.log.slice(window.__log0) }; } }
    return null; })()`);
  assert.ok(scene && scene.rising >= 2, '풍선이 둘 이상 올라간다: ' + JSON.stringify(scene));
  assert.equal(scene.log.filter(n => n === 'rise').length, 1, '올라가는 소리는 한 번'); assert.equal(scene.log.filter(n => n === 'bad').length, 1, '오답 소리 한 번');
  // 맞는 풍선 → pop(콤보), 점프 → jump, 착지 → land
  const log2 = await page.eval(`(() => { const R = SpellRun, G = R.G; SpellRun.sound.SND.log.length = 0; G.combo = 3; const t = G.tiles.find(x => !x.kind && x.correct && !x.checked && x.state === 'live' && x.wi === G.wi && x.si === G.si); if (t) { t.x = R.RUNNER_X + 1; G.jumpT = 0.3; G.j2 = -1; R.step(0.01); G.jumpT = -1; } return { had: !!t, log: SpellRun.sound.SND.log.slice() }; })()`);
  if (log2.had) assert.ok(log2.log.includes('pop'), '맞는 풍선 터짐 소리: ' + log2.log);
  const log3 = await page.eval(`(() => { const R = SpellRun, G = R.G; G.state = 'run'; G.jumpT = -1; G.j2 = -1; SpellRun.sound.SND.log.length = 0; R.jump(); for (let i = 0; i < 60; i++) R.step(1 / 60); return SpellRun.sound.SND.log.slice(); })()`);
  assert.ok(log3.includes('jump') && log3.includes('land'), '점프·착지 소리: ' + log3);
  noErr(page); await page.close();
});

test('365-4) [배경음] 켜기·끄기: 효과음과 따로 있고(가로 메뉴 항목, 세로 소리 버튼 옆), 마지막 선택을 localStorage spellrun_bgm 에 저장해 다시 열어도 유지, 기본 켜짐', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  assert.equal(await page.eval('SpellRun.sound.bgm()'), true, '기본 켜짐');
  await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000);
  await page.click('#srMenuBtn');
  assert.equal(await page.eval("document.getElementById('srMenuBgm').textContent"), '배경음 끄기');
  await page.click('#srMenuBgm');
  assert.equal(await page.eval("document.getElementById('srMenuBgm').textContent"), '배경음 켜기'); assert.equal(await page.eval("document.getElementById('srMenuSnd').textContent"), '소리 끄기', '효과음 버튼은 그대로');
  assert.equal(await page.eval("localStorage.getItem('spellrun_bgm')"), '0'); assert.equal(await page.eval('SpellRun.sound.bgm()'), false);
  await page.eval("localStorage.removeItem('spellrun_bgm')");   // 다음 시험이 기본값(켜짐)에서 시작하게
  noErr(page); await page.close();
  const p2 = await open(390, 844, '?mode=0');
  assert.equal(await p2.eval('SpellRun.sound.bgm()'), true, '새 브라우저(저장 없음)는 기본 켜짐');
  await p2.eval("localStorage.setItem('spellrun_bgm', '0')");
  await p2.goto(base + '/spelling_run.html?mode=0');
  await p2.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  assert.equal(await p2.eval('SpellRun.sound.bgm()'), false, '다시 열어도 유지'); assert.equal(await p2.eval("document.getElementById('bgmStart').textContent"), '배경음 끔');
  await p2.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false');
  await p2.click('#startBtn'); await p2.waitFor("SpellRun.G.state === 'run'", 4000);
  assert.equal(await p2.eval("getComputedStyle(document.getElementById('bgm')).display !== 'none'"), true, '세로 HUD 소리 버튼 옆에 [배경음]');
  assert.equal(await p2.eval("document.getElementById('snd').nextElementSibling.id"), 'bgm');
  await p2.click('#bgm'); assert.equal(await p2.eval("localStorage.getItem('spellrun_bgm')"), '1'); assert.equal(await p2.eval("document.getElementById('bgm').textContent"), '배경음 켬');
  await p2.eval("localStorage.removeItem('spellrun_bgm')");
  noErr(p2); await p2.close();
});

test('365-5) 소리는 판정·점수·체력·타일 위치에 영향 없음(소리 끄고 켠 결과 동일), 봇이 소리를 켠 채 한 판을 돌 때 콘솔 오류·경고 없음', { skip: SKIP }, async () => {
  const outs = [], warns = [];
  for (const on of [false, true, true]) {
    const page = await open(844, 390);
    await page.eval(seed); await page.eval('SpellRun.G.dist = 0');
    await startRun(page);
    await page.eval(`SpellRun.sound.SND.on = ${on}`);
    await page.eval(`(() => { const R = SpellRun, G = R.G; for (let i = 0; i < 3000; i++) { R.step(1 / 60); if (i % 3 === 0) { const keep = window.__rs; R.draw(); window.__rs = keep; } if (i % 41 === 0) R.jump(); if (i % 25 === 0) R.sound.tick(); if (G.state !== 'run') break; } })()`);
    outs.push(await page.eval(`(() => { const G = SpellRun.G; return JSON.stringify({ score: G.score, hp: G.hp, combo: G.combo, wi: G.wi, si: G.si, dist: Math.round(G.dist * 1000), state: G.state, tiles: G.tiles.map(t => [Math.round(t.x * 100), t.state, t.text, t.correct, t.bi, t.high || false]) }); })()`));
    warns.push(...(await page.eval('window.__warns')));
    noErr(page); await page.close();
  }
  assert.equal(outs[1], outs[0], '소리 끔 = 켬'); assert.equal(outs[2], outs[1], '같은 입력은 같은 결과'); assert.deepEqual(warns, [], '콘솔 경고 없음');
  assert.ok(JSON.parse(outs[0]).dist > 1000000, '실제로 한참 진행됨');
});

test('365-6) 스케줄러·효과음이 한 프레임에 주는 영향(헤드리스, 추정): 소리 끔과 켬의 draw·step·musicTick 시간 비교(참고용)', { skip: SKIP }, async () => {
  const page = await open(844, 390);
  await page.eval(seed); await startRun(page);
  await page.click('#srMenuBtn'); await page.click('#srMenuCont');
  await page.waitFor("SpellRun.sound.SND.ac.state === 'running'", 3000).catch(() => {});
  const r = await page.eval(`(() => { const R = SpellRun, res = {}; const time = (fn, n) => { for (let i = 0; i < 20; i++) fn(); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };
    for (const on of [false, true, false, true]) { R.sound.SND.on = on; const k = on ? 'on' : 'off'; const v = time(() => { R.step(1 / 60); R.draw(); }, 300); res[k] = (res[k] || 0) + v / 2; }
    R.sound.SND.on = true; res.tick = time(() => R.sound.tick(), 400); return res; })()`);
  console.log('SOUND_FRAME_MS', JSON.stringify(r));
  assert.ok(r.on < 10 && r.tick < 2, JSON.stringify(r));
  noErr(page); await page.close();
});
