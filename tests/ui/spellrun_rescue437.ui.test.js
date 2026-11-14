// 작업437: 가로(edge) 구조 아이템(힌트·천사) 생성 — planWord 가 wp.rescueSlot·wp.rescueKind 를 대입한다(354 에서 빠져 가로에서는 한 번도 안 나왔다). 헤드리스 Chrome.
// 자체 임시 서버에 모의 /api/me·/api/wordbook 만 둔다 — 실제 서버·운영 서버와 무관.
// 실행: node --test tests/ui/spellrun_rescue437.ui.test.js   (Chrome이 없으면 건너뜀)
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
const WORDS = ['apple', 'letter', 'committee', 'success', 'balloon', 'coffee', 'address', 'summer', 'cat', 'dog', 'sun', 'book'];
const rows = WORDS.map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));
const SEED = `(() => { let a = 1; window.__seed = s => { a = s >>> 0; }; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;

let srv, base, browser;
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      req.on('data', () => {}); req.on('end', () => {
        if (u === '/api/me') return json(200, { id: 7, role: 'user', can_wordbook: true, perm_versus: false });
        if (u === '/api/wordbook') return json(200, rows);
        json(404, { ok: false });
      });
      return;
    }
    const f = path.join(PUB, u);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });

async function open(query, { width = 800, height = 400, seed = false } = {}) {
  const page = await browser.newPage({ width, height, token: jwt() });
  if (seed) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.removeItem('spellrun_opts'); localStorage.setItem('spellrun_preview', '0'); localStorage.setItem('spellrun_bgm', '0'); localStorage.setItem('spellrun_mode', 'normal'); sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(rows.map(r => r.id)))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false;');
  return page;
}
// 한 판을 봇으로 돌리며 아이템 타일을 모은다. 판 번호를 바꿔 계획 해시 입력을 다양하게 한다. 각 아이템이 처음 보인 순간 가까운 다른 타일과의 거리도 잰다
const ROUNDS = `(N, HP, SEED0) => {
  const R = SpellRun, G = R.G, RX = R.RUNNER_X, out = { items: [], bad: [], minGap: 1e9, planned: 0, plannedBoth: 0, plannedObst: 0, missing: [], extra: [], rounds: 0 };
  for (let r = 0; r < N; r++) {
    window.__seed(SEED0 + r); R.startRound(false); G.roundSeq = 40 + SEED0 + r;
    const seen = new Set(), got = []; let steps = 0, maxWi = 0;
    while (steps++ < 12000 && G.state !== 'over' && G.state !== 'idle') {
      G.hp = HP; G.invuln = 9;
      if (G.state === 'run' && G.plan) {
        const need = G.plan.slots[G.si] && G.plan.slots[G.si].text, tg = G.tiles.filter(t => !t.kind && t.state === 'live' && !t.checked && t.x > RX - 2 && t.correct && t.text === need).sort((a, b) => a.x - b.x)[0];
        if (tg) { const tc = (tg.x - RX) / Math.max(G.speed, 1); if (G.jumpT < 0 && tc <= (tg.high ? 0.47 : 0.231) && tc > 0) R.jump(); if (G.jumpT >= 0.24 && G.j2 < 0 && tg.high && tc < 0.5) R.jump(); }
        const it = G.tiles.filter(t => t.kind && t.state === 'live' && !t.checked && t.x > RX - 2).sort((a, b) => a.x - b.x)[0]; if (it && G.jumpT < 0 && (it.x - RX) / Math.max(G.speed, 1) <= 0.231) R.jump();
      }
      for (const t of G.tiles) if (t.kind && !seen.has(t)) { seen.add(t); const others = G.tiles.filter(o => o !== t && o.x > RX - 5).map(o => Math.abs(o.x - t.x)); const gap = others.length ? Math.min(...others) : 1e9; out.minGap = Math.min(out.minGap, gap); got.push({ kind: t.kind, wi: t.wi, si: t.si }); }
      R.step(1 / 60);
    }
    out.rounds++;
    const wps = G.ec ? G.ec.wps : {}; maxWi = Math.max(0, ...Object.keys(wps).map(Number));
    for (const k of Object.keys(wps)) { const wp = wps[k], wi = Number(k); const mine = got.filter(g => g.wi === wi && (g.kind === 'hint' || g.kind === 'angel'));
      if (wp.rs) { out.planned++; if (wp.obst) out.plannedObst++;
        const placeable = wp.plan.slots.some((sl, k) => k >= wp.rs.slot && !sl.high);
        if (wp.rescueSlot !== wp.rs.slot || wp.rescueKind !== wp.rs.kind) out.missing.push({ wi, why: '대입 값', rs: wp.rs });
        else if (wi < maxWi && placeable && (mine.length < 1 || mine.some(m => m.kind !== wp.rs.kind || m.si < wp.rs.slot))) out.missing.push({ wi, why: '나와야 하는데 없음/종류·칸 불일치', rs: wp.rs, mine });
        else if (!placeable && mine.length) out.missing.push({ wi, why: '높은 칸뿐인데 나옴', rs: wp.rs, mine }); }
      else if (mine.length) out.extra.push({ wi, mine });
      const hearts = got.filter(g => g.wi === wi && g.kind === 'heart'); if (wp.rs && hearts.length) out.plannedBoth++; }
    out.items.push(...got);
  }
  return out; }`;

for (const hp of [5, 2, 1]) {
  test(`437 가로 구조 아이템(체력 ${hp}): 구조 계획이 있는 단어마다 힌트/천사 타일이 계획된 종류·칸 이후에 생기고(전부 높은 칸이면 세로처럼 안 나옴), 계획이 없는 단어에는 없다. 하트·장애물이 있는 단어에는 구조 계획이 없다. 아이템 사이 간격 규칙 유지`, { skip: SKIP, timeout: 120000 }, async () => {
    const page = await open('?mode=1', { seed: true });
    assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), true, '가로(edge)');
    const o = await page.eval(`(${ROUNDS})(8, ${hp}, ${100 + hp})`);
    const kinds = o.items.reduce((m, g) => { m[g.kind] = (m[g.kind] || 0) + 1; return m; }, {});
    assert.ok(o.rounds === 8 && o.planned > 0, '계획된 구조 아이템 단어가 있다: ' + JSON.stringify({ planned: o.planned, kinds }));
    assert.deepEqual(o.missing, [], '계획과 다른 단어: ' + JSON.stringify(o.missing));
    assert.deepEqual(o.extra, [], '계획 없는 단어에 구조 아이템: ' + JSON.stringify(o.extra));
    assert.equal(o.plannedBoth, 0, '하트가 있는 단어에는 구조 아이템 없음'); assert.equal(o.plannedObst, 0, '장애물이 있는 단어에는 구조 아이템 없음');
    assert.ok((kinds.hint || 0) + (kinds.angel || 0) > 0, '힌트·천사가 가로에서 나온다: ' + JSON.stringify(kinds));
    assert.ok(o.minGap >= 66, '아이템과 이웃 타일 중심 거리가 최소 간격(67.5) 이상: ' + o.minGap);
    await page.close();
  });
}

test('437 가로 천사: 먹으면 그 묶음의 화면 밖 오답 풍선만 치워지고(보이는 풍선·정답 풍선은 그대로), 다음 정답을 터트리면 435 의 떠오름과 함께 문제없이 이어진다', { skip: SKIP }, async () => {
  const page = await open('?mode=1&judgedebug=1');
  const p = await page.eval(`(() => { const R = SpellRun, G = R.G; R.startRound(false); G.hp = 99; G.invuln = 9; G.obstacles = []; G.obst = null; G.heartPending = false; G.rescuePending = false; G.speedPending = false; for (let i = 0; i < 600 && G.state !== 'run'; i++) R.step(1 / 60); G.tiles = []; if (G.ec) G.ec.packs = []; return { need: G.plan.slots[G.si].text, wi: G.wi, si: G.si }; })()`);
  await page.eval(`(() => { const R = SpellRun, G = R.G, mk = o => Object.assign({ x: R.RUNNER_X + 200, w: 44, text: 'x', correct: false, chunk: false, high: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '', n: 1, bi: 0, synthetic: true }, o);
    G.tiles.push(mk({ id: -777, kind: 'angel', itemKind: 'angel', x: R.RUNNER_X + 3, w: 46, wi: ${p.wi}, si: ${p.si}, text: '' }), mk({ id: 777, text: 'q', wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 250 }), mk({ id: 777, text: 'w', wi: ${p.wi}, si: ${p.si}, x: 1400 }), mk({ id: 777, text: '${p.need}', correct: true, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 400 })); })()`);
  await page.eval(`(() => { const R = SpellRun, G = R.G, t = G.tiles.find(t => t.kind === 'angel'); for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; R.step(1 / 60); } })()`);
  const a = await page.eval(`SpellRun.G.tiles.filter(t => t.synthetic && !t.kind).map(t => t.text + ':' + (t.correct ? 'ok' : 'x'))`);
  assert.ok(a.includes('q:x'), '보이는 오답 풍선은 그대로(가로): ' + a); assert.ok(!a.includes('w:x'), '화면 밖 오답 풍선은 치워짐: ' + a); assert.ok(a.includes(p.need + ':ok'), '정답 풍선은 그대로');
  assert.equal(await page.eval("SpellRun.G.rescue && SpellRun.G.rescue.kind"), 'angel');
  // 정답을 터트리면 남은 보이는 오답 풍선은 435 규칙대로 떠오르고 구조 효과는 끝난다
  await page.eval(`(() => { const R = SpellRun, G = R.G, t = G.tiles.find(t => t.correct && t.synthetic); t.x = R.RUNNER_X + 3; for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; R.step(1 / 60); } })()`);
  assert.equal(await page.eval("SpellRun.G.si"), p.si + 1, '정답 처리');
  assert.equal(await page.eval("SpellRun.G.tiles.filter(t => t.synthetic && t.text === 'q').every(t => t.rise)"), true, '남은 풍선 떠오름(435)');
  assert.equal(await page.eval('SpellRun.G.rescue'), null, '효과 종료');
  const log = await page.eval('window.__judgeLog.slice(-1)[0]'); assert.equal(log.kind, '정답');
  await page.close();
});

test('437 가로 힌트: 먹으면 현재 칸 정답 글자가 희미하게 보이고(칸의 ghost), 정답을 터트리면 사라진다', { skip: SKIP }, async () => {
  const page = await open('?mode=1');
  const p = await page.eval(`(() => { const R = SpellRun, G = R.G; R.startRound(false); G.hp = 99; G.invuln = 9; G.obstacles = []; G.obst = null; G.heartPending = false; G.rescuePending = false; G.speedPending = false; for (let i = 0; i < 600 && G.state !== 'run'; i++) R.step(1 / 60); G.tiles = []; if (G.ec) G.ec.packs = []; return { need: G.plan.slots[G.si].text, wi: G.wi, si: G.si }; })()`);
  await page.eval(`(() => { const R = SpellRun, G = R.G, mk = o => Object.assign({ x: R.RUNNER_X + 200, w: 44, text: 'x', correct: false, chunk: false, high: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '', n: 1, bi: 0, synthetic: true }, o);
    G.tiles.push(mk({ id: -778, kind: 'hint', itemKind: 'hint', x: R.RUNNER_X + 3, w: 46, wi: ${p.wi}, si: ${p.si}, text: '' }), mk({ id: 778, text: '${p.need}', correct: true, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 300 })); })()`);
  await page.eval(`(() => { const R = SpellRun, G = R.G, t = G.tiles.find(t => t.kind === 'hint'); for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; R.step(1 / 60); } })()`);
  assert.equal(await page.eval("SpellRun.G.rescue && SpellRun.G.rescue.kind"), 'hint');
  assert.equal(await page.eval(`document.querySelectorAll('#word .slot')[${p.si}].querySelectorAll('.cell.ghost').length > 0`), true, '정답 글자가 희미하게');
  await page.eval(`(() => { const R = SpellRun, G = R.G, t = G.tiles.find(t => t.correct && t.synthetic); t.x = R.RUNNER_X + 3; for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; R.step(1 / 60); } })()`);
  assert.equal(await page.eval('SpellRun.G.rescue'), null);
  assert.equal(await page.eval("document.querySelectorAll('#word .cell.ghost').length"), 0, '효과 종료 뒤 희미한 글자 없음');
  await page.close();
});

test('437 세로(classic) 결과는 수정 전과 같다: 같은 시드·같은 봇으로 한 판을 돌린 아이템 타일(종류@단어:칸)·점수·푼 단어 수가 수정 전에 측정한 값과 같다', { skip: SKIP, timeout: 120000 }, async () => {
  const BASE = { '1/2': { items: ['heart@0:0'], score: 2085, words: 2 }, '2/2': { items: [], score: 952, words: 1 }, '3/1': { items: ['hint@0:2', 'heart@1:5'], score: 4130, words: 2 }, '4/2': { items: [], score: 1828, words: 1 }, '5/5': { items: ['heart@2:2'], score: 3401, words: 2 } };
  const RUN = `(seed, HP) => { window.__seed(seed); const R = SpellRun, G = R.G; R.startRound(false); G.roundSeq = 40 + seed; const RX = R.RUNNER_X, seen = new Set(), items = []; let steps = 0;
    while (steps++ < 12000 && G.state !== 'over' && G.state !== 'idle') { G.hp = HP; G.invuln = 9;
      if (G.state === 'run' && G.plan) { const need = G.plan.slots[G.si] && G.plan.slots[G.si].text; const tg = G.tiles.filter(t => !t.kind && t.state === 'live' && !t.checked && t.x > RX - 2 && t.correct && t.text === need).sort((a, b) => a.x - b.x)[0];
        if (tg) { const tc = (tg.x - RX) / Math.max(G.speed, 1); if (G.jumpT < 0 && tc <= 0.231 && tc > 0) R.jump(); if (G.jumpT >= 0.24 && G.j2 < 0 && tg.high && tc < 0.5) R.jump(); }
        const it = G.tiles.filter(t => t.kind && t.state === 'live' && !t.checked && t.x > RX - 2).sort((a, b) => a.x - b.x)[0]; if (it && G.jumpT < 0 && (it.x - RX) / Math.max(G.speed, 1) <= 0.231) R.jump(); }
      for (const t of G.tiles) if (t.kind && !seen.has(t)) { seen.add(t); items.push(t.kind + '@' + G.wi + ':' + G.si); }
      R.step(1 / 60); }
    return { items: items, score: G.score, words: G.wordsDone }; }`;
  const page = await open('', { width: 390, height: 844, seed: true });
  assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), false, '세로(classic)');
  for (const k of Object.keys(BASE)) { const [s, hp] = k.split('/'); assert.deepEqual(await page.eval(`(${RUN})(${s}, ${hp})`), BASE[k], k); }
  await page.close();
});
