// 작업354: 타일 흐름(스트림) 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// ① 세로(classic) 동일성: 같은 난수 시드와 같은 봇으로 한 판을 돌린 타일·장애물·상태 기록의 해시가 바꾸기 전(작업352 코드)에 떠 둔 기준(tests/fixtures/spellrun_classic_trace.json)과 같다
//    (기본·틀림·이어하기·생존·복습). 기준을 새로 뜨려면 RECORD_CLASSIC=1 로 실행한다(바꾸기 전 코드에서만).
// ② edge(stream=edge, 세로 화면): 한 판을 봇이 돌리는 동안 화면 안에서 생성된 타일·장애물 0건, 보이는 타일 소멸 0건, 틀린 뒤 맞는 글자가 결국 들어온다.
// 실행: node --test tests/ui/spellrun_stream.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { launchBrowser, findChrome } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const FIX = path.join(__dirname, '..', 'fixtures', 'spellrun_classic_trace.json');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const en = (id, word, meaning) => ({ id, word, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - id).toISOString(), data: { word, lang: 'en', short_meaning: meaning } });
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
        json(503, { ok: false });   // 발음은 내장 음성 대체(화면 시험과 무관)
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

async function openGame(query = '') {
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.setItem('spellrun_preview', '0'); } catch (e) {}" });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(IDS))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  return page;
}

// 기록기: 시드 난수 + 결정적 봇으로 판을 돌리고 새로 생긴 타일·장애물·상태 변화를 기록한다.
// policy: 'perfect'(정답 글자와 하트를 먹고 장애물을 넘음) | 'errors'(묶음 번호 4의 배수에서는 오답 타일을 먹고, 7의 배수에서는 정답을 놓침)
const TRACE = `(async (o) => {
  let s = o.seed >>> 0;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = window.SpellRun, G = R.G, C = R.CONFIG; R.manual = true; C.CONT_ENABLED = !!o.cont;
  if (o.mode) document.querySelector('#modeRow [data-mode=' + o.mode + ']').click();
  G.state = 'idle'; R.startRound(!!o.review); R.manual = true;
  const ev = [], seen = new Set(), seenO = new Set(); let force = null, skip = null; const tried = new Set(); let steps = 0, T = C.JUMP_TIME, lastState = '', lastHp = G.hp, bad = 0, wrongPick = new Map();
  const f = x => +x.toFixed(4);
  const view = o.view || 360;
  const res = { insideSpawn: 0, vanished: 0, maxLive: 0, fails: 0 };
  const prevVis = new Map();
  while (steps < o.max && G.state !== 'over') {
    if (G.state === 'choice') document.getElementById('contBtn').click();
    if (G.state === 'run') {
      const live = G.tiles.filter(x => x.state === 'live' && !x.checked && x.x > R.RUNNER_X);
      const pn = G.packId;
      let tg;
      const isGood = x => x.kind === 'heart' || x.kind === 'speed' || x.kind === 'hint' || x.kind === 'angel' || (x.wi === undefined ? x.correct : (x.correct && x.wi === G.wi && x.si === G.si));
      const kn = G.wi * 10 + G.si;
      if (o.policy === 'errors2' && G.si < G.plan.slots.length && !tried.has(kn)) {   // edge 용: 칸마다 한 번, 3·7로 나눈 칸 번호에서 오답을 먹거나 정답을 놓친다(묶음 번호는 미리 줄에 넣은 수라 현재 칸과 다르다)
        if (kn % 4 === 3) { tried.add(kn); const w = live.filter(x => !x.kind && !isGood(x)).sort((a, b) => a.x - b.x)[0]; if (w) force = w; }
        else if (kn % 7 === 5) { tried.add(kn); skip = live.filter(isGood).sort((a, b) => a.x - b.x)[0] || null; }
      }
      if (force && (force.checked || force.state !== 'live')) force = null;
      if (o.policy === 'errors2' && force) tg = force;
      else if (o.policy === 'errors2') tg = live.filter(x => isGood(x) && x !== skip).sort((a, b) => a.x - b.x)[0];
      else if (o.policy === 'errors' && G.packId % 4 === 0) tg = live.filter(x => !x.kind && !isGood(x)).sort((a, b) => a.x - b.x)[0];
      else if (o.policy === 'errors' && G.packId % 7 === 0) tg = null;
      else tg = live.filter(isGood).sort((a, b) => a.x - b.x)[0];
      if (tg) {
        const tta = (tg.x - R.RUNNER_X) / G.speed;
        if (tg.high) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); }
        else if (G.jumpT < 0 && tta <= T / 2) R.jump();
      }
      if (G.jumpT < 0) { const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X); if (ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= T / 2) R.jump(); }
    }
    const hp0 = G.hp;
    R.step(1 / 60); steps++;
    if (G.state !== lastState) { ev.push(['S', steps, G.state, G.wi, G.si]); lastState = G.state; }
    if (G.hp !== lastHp) { ev.push(['H', steps, G.hp, G.score]); (res.dbg = res.dbg || []).push({ step: steps, hp: G.hp, obstHits: G.obstHits, key: [G.wi, G.si], jumpT: +G.jumpT.toFixed(3), spd: Math.round(G.speed), near: G.tiles.filter(t => t.x < 330).map(t => [t.text || t.kind, t.correct ? 1 : 0, t.wi, t.si, Math.round(t.x), t.state]), bad: G.tiles.filter(t => (t.state === 'taken' && !t.ok) || (t.state === 'fade' && t.t < 0.05 && t.correct)).map(t => [t.text, t.correct, t.wi, t.si, Math.round(t.x)]) }); lastHp = G.hp; }
    for (const t of G.tiles) if (!seen.has(t)) {
      seen.add(t);
      ev.push(['T', steps, t.kind || 'L', f(t.x), t.w, t.text, t.correct ? 1 : 0, t.high ? 1 : 0, t.id]);
      if (t.x - t.w / 2 < view - (G.speed / 60 + 0.001)) res.insideSpawn++;   // 판 시작 때 만들어진 타일은 한 걸음(최대 약 6px) 움직인 뒤에 처음 관찰된다
    }
    for (const ob of G.obstacles) if (!seenO.has(ob)) { seenO.add(ob); ev.push(['O', steps, ob.kind, f(ob.x), ob.w]); if (ob.x < view - (G.speed / 60 + 0.001)) res.insideSpawn++; }
    // 보이는 타일 소멸: 이전 프레임에 화면 안(왼쪽 끝이 view 안, 오른쪽 끝이 러너 오른쪽)에 있던 살아 있는 타일이 사라지는지(러너를 지나 왼쪽으로 나가는 것은 제외)
    const now = new Set(G.tiles);
    for (const [t, was] of prevVis) if (!now.has(t) && was.x > R.RUNNER_X + 2 && was.state === 'live' && !was.checked) res.vanished++;
    prevVis.clear(); for (const t of G.tiles) if (t.x - t.w / 2 < view && t.x > R.RUNNER_X + 2) prevVis.set(t, { x: t.x, state: t.state, checked: t.checked });
    if (G.hp < hp0 && !(G.state === 'choice')) res.fails++;
    if (steps % 400 === 0) await new Promise(r => setTimeout(r, 0));
  }
  ev.push(['E', steps, G.state, G.wordsDone, G.hp, G.score, G.maxCombo]);
  return { ev, steps, res, over: G.state === 'over', wordsDone: G.wordsDone };
})`;

const SCENARIOS = [
  { name: 'normal-perfect', seed: 11, policy: 'perfect', max: 60 * 300 },
  { name: 'normal-errors', seed: 12, policy: 'errors', max: 60 * 300 },
  { name: 'normal-continue', seed: 14, policy: 'errors', cont: true, max: 60 * 300 },
  { name: 'survival-perfect', seed: 13, policy: 'perfect', mode: 'survival', max: 60 * 150 },
  { name: 'survival-errors', seed: 16, policy: 'errors', mode: 'survival', max: 60 * 150 },
];
const hash = ev => crypto.createHash('sha256').update(JSON.stringify(ev)).digest('hex');

for (const sc of SCENARIOS) {
  test('354-3) 세로(classic) 동일성: ' + sc.name, { skip: SKIP }, async () => {
    const page = await openGame();
    const r = await page.eval(`${TRACE}(${JSON.stringify(sc)})`);
    assert.ok(r.ev.length > 40, '기록이 충분하다: ' + r.ev.length);
    const got = { sha: hash(r.ev), n: r.ev.length, steps: r.steps, head: r.ev.slice(0, 30) };
    if (process.env.RECORD_CLASSIC) {
      const all = fs.existsSync(FIX) ? JSON.parse(fs.readFileSync(FIX, 'utf8')) : {};
      all[sc.name] = got; fs.writeFileSync(FIX, JSON.stringify(all, null, 1));
    } else {
      const base0 = JSON.parse(fs.readFileSync(FIX, 'utf8'))[sc.name];
      assert.ok(base0, '기준이 있다');
      const firstDiff = base0.head.findIndex((e, i) => JSON.stringify(e) !== JSON.stringify(got.head[i]));
      assert.equal(got.n, base0.n, '기록 수 ' + got.n + ' vs 기준 ' + base0.n + (firstDiff >= 0 ? ' / 처음 다른 곳 ' + firstDiff + ': ' + JSON.stringify(got.head[firstDiff]) + ' vs ' + JSON.stringify(base0.head[firstDiff]) : ''));
      assert.equal(got.sha, base0.sha, '타일 생성 시점·x·글자·장애물·아이템·상태 기록이 기준과 같다');
    }
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  });
}

// ───────── ② edge ─────────
// 봇은 정답 글자는 "지금 풀 칸" 기준으로 고른다(TRACE 의 isGood). 오답 먹기는 칸 번호와 무관하게 정답이 아닌 글자 타일을 고른다.
const EDGE_SCENARIOS = [
  { name: 'edge-perfect', seed: 21, policy: 'perfect', max: 60 * 300, view: 360, over: true },
  { name: 'edge-errors', seed: 22, policy: 'errors2', max: 60 * 300, view: 360 },
  { name: 'edge-survival', seed: 23, policy: 'perfect', mode: 'survival', max: 60 * 150, view: 360 },
  { name: 'edge-wide-perfect', seed: 24, policy: 'perfect', max: 60 * 300, view: 800, over: true },
  { name: 'edge-wide-errors', seed: 25, policy: 'errors2', max: 60 * 300, view: 800 },
];
for (const sc of EDGE_SCENARIOS) {
  test('354-3) edge: ' + sc.name + ' (화면 안 생성 0건, 보이는 타일 소멸 0건)', { skip: SKIP }, async () => {
    const page = await openGame('?stream=edge');
    assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), true, 'stream=edge 로 켜진다');
    if (sc.view !== 360) await page.eval(`SpellRun.edge.setViewW(${sc.view})`);
    const r = await page.eval(`${TRACE}(${JSON.stringify(sc)})`);
    if (process.env.DUMP_EDGE) console.log(sc.name, JSON.stringify(r.res), r.wordsDone, r.steps);
    assert.equal(r.res.insideSpawn, 0, '화면 안에서 생긴 타일·장애물 0건');
    assert.equal(r.res.vanished, 0, '보이는 타일이 사라진 것 0건');
    assert.ok(r.wordsDone >= (sc.mode === 'survival' ? 8 : 2), '판이 진행된다: 완성 ' + r.wordsDone);
    if (sc.over) assert.equal(r.over, true, '한 판이 끝까지 간다');
    if (sc.policy === 'errors2') assert.ok(r.res.fails >= 2, '틀림이 실제로 일어났다: ' + r.res.fails);
    assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
    await page.close();
  });
}

test('354-3) edge: 이어하기는 줄을 비우고 새로 시작한다(첫 묶음은 화면 밖에서)', { skip: SKIP }, async () => {
  const page = await openGame('?stream=edge');
  const r = await page.eval(`${TRACE}({ seed: 26, policy: 'errors2', cont: true, max: 60 * 300, view: 360 })`);
  assert.equal(r.res.insideSpawn, 0);
  assert.ok(r.ev.some(e => e[0] === 'S' && e[2] === 'choice'), '이어하기 선택 화면이 열렸다');
  await page.close();
});

test('354-3) 주소 옵션 stream=edge: 조정값 사용 중에 나오고, 기본은 classic', { skip: SKIP }, async () => {
  let page = await openGame('?stream=edge');
  assert.equal(await page.eval("document.getElementById('tune').hidden"), false);
  assert.match(await page.eval("document.getElementById('tune').title"), /stream/);
  await page.close();
  page = await openGame('');
  assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), false);
  assert.equal(await page.eval("document.getElementById('tune').hidden"), true);
  await page.close();
});
