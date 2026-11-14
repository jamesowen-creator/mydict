// 작업433: 스펠링 런 점검 옵션 judgedebug — 오답·놓침이 난 이유를 한 줄로 보여 준다(꺼져 있으면 DOM·표시·동작이 같다). 헤드리스 Chrome.
// 자체 임시 서버에 모의 /api/me·/api/wordbook 만 둔다 — 실제 서버·운영 서버와 무관.
// 실행: node --test tests/ui/spellrun_judgedebug433.ui.test.js   (Chrome이 없으면 건너뜀)
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
const WORDS = ['apple', 'letter', 'garden', 'planet', 'river', 'cloud', 'bridge', 'window'];
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

async function open(query, { width = 800, height = 400, seed = false, keepStorage = false } = {}) {
  const page = await browser.newPage({ width, height, token: jwt() });
  if (seed) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__i') && ${!keepStorage}) { sessionStorage.setItem('__i', '1'); localStorage.removeItem('spellrun_opts'); } localStorage.setItem('spellrun_preview', '0'); localStorage.setItem('spellrun_bgm', '0'); localStorage.setItem('spellrun_mode', 'normal'); sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(rows.map(r => r.id)))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false;');
  return page;
}
// 시작하고 화면 안의 모든 풍선·아이템을 치운 뒤 지금 칸 정보를 돌려준다(가로 edge 에서 강제 구성)
const PREP = `(() => { const R = SpellRun, G = R.G; R.startRound(false); G.hp = 99; G.invuln = 9; G.tiles = []; G.obstacles = []; G.obst = null; G.heartPending = false; G.rescuePending = false; G.speedPending = false; if (G.ec) G.ec.packs = []; return { need: G.plan.slots[G.si].text, n: G.plan.slots.length, wi: G.wi, si: G.si, rx: R.RUNNER_X }; })()`;
// 합성 풍선 하나를 러너 바로 앞에 두고(필요하면 공중 상태로) 한 걸음씩 진행해 판정되게 한다
const TILE = (o) => `(() => { const R = SpellRun, G = R.G; G.tiles = G.tiles.filter(t => t.synthetic); const t = Object.assign({ id: 99000 + G.tiles.length, x: R.RUNNER_X + 3, w: 44, text: 'x', correct: false, chunk: false, high: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '', n: 0, bi: 0, synthetic: true }, ${JSON.stringify(o.tile)}); G.tiles.push(t); G.jumpT = ${o.air ? 'R.CONFIG.JUMP_TIME * 0.5' : '-1'}; G.j2 = -1; for (let i = 0; i < 4 && !t.checked; i++) { R.step(1 / 60); G.jumpT = ${o.air ? 'R.CONFIG.JUMP_TIME * 0.5' : '-1'}; } return t.checked; })()`;
const LAST = page => page.eval('(window.__judgeLog || []).slice(-1)[0] || null');
const LINES = page => page.eval("[...document.querySelectorAll('#judgeLog > div')].map(e => e.textContent)");

test('433 꺼짐(기본·judgedebug=0): 표시 요소가 DOM 에 없고 __judgeLog 도 쌓이지 않으며, 오답·놓침이 나도 아무것도 생기지 않는다', { skip: SKIP }, async () => {
  for (const q of ['?mode=1', '?mode=1&judgedebug=0']) {
    const page = await open(q);
    const p = await page.eval(PREP);
    assert.equal(await page.eval('SpellRun.judge.on'), false);
    assert.equal(await page.eval(TILE({ tile: { text: p.need === 'z' ? 'y' : 'z', correct: false, wi: p.wi, si: p.si }, air: true })), true);
    assert.equal(await page.eval(TILE({ tile: { text: p.need, correct: true, wi: p.wi, si: p.si }, air: false })), true);
    assert.equal(await page.eval("!!document.getElementById('judgeLog') || !!document.querySelector('.judgelog')"), false, '표시 요소 없음');
    assert.equal(await page.eval('typeof window.__judgeLog'), 'undefined', '기록 없음');
    assert.equal(await page.eval('document.getElementById("tune").hidden'), true, '기본값과 같으면 조정값 표시 없음');
    await page.close();
  }
});

test('433 옵션: judgedebug=1 은 조정값 사용 중 표시·localStorage 저장, 다음에 옵션 없이 열어도 유지, judgedebug=0 이나 reset=1 로 끄고, 범위 밖 값은 무시', { skip: SKIP }, async () => {
  let page = await open('?mode=1&judgedebug=1');
  assert.equal(await page.eval('SpellRun.judge.on'), true);
  assert.equal(await page.eval('document.getElementById("tune").hidden'), false, '조정값 사용 중 표시');
  assert.match(await page.eval('document.getElementById("tune").title'), /judgedebug/);
  assert.equal(await page.eval("JSON.parse(localStorage.getItem('spellrun_opts')).judgedebug"), 1, '저장');
  await page.goto(base + '/spelling_run.html?mode=1');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  assert.equal(await page.eval('SpellRun.judge.on'), true, '옵션 없이 다시 열어도 유지');
  await page.goto(base + '/spelling_run.html?mode=1&judgedebug=0');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  assert.equal(await page.eval('SpellRun.judge.on'), false, 'judgedebug=0 이 저장값보다 우선'); assert.equal(await page.eval('document.getElementById("tune").hidden'), true, '기본값과 같으면 표시 없음');
  await page.goto(base + '/spelling_run.html?mode=1&judgedebug=1');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.goto(base + '/spelling_run.html?mode=1&reset=1');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  assert.equal(await page.eval('SpellRun.judge.on'), false, 'reset=1 로 초기화'); assert.equal(await page.eval("localStorage.getItem('spellrun_opts')"), null);
  await page.goto(base + '/spelling_run.html?mode=1&judgedebug=2');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  assert.equal(await page.eval('SpellRun.judge.on'), false, '범위 밖(2)은 무시');
  await page.close();
});

test('433 켜짐: 분류 — 오답 풍선(같은 글자)·오답 풍선(다른 글자)·정답 풍선이지만 다른 칸 소속·이전 단어 소속·정답 풍선 놓침. 줄에 필요한 글자·칸·콤보·속도·단어 전환 후 초', { skip: SKIP }, async () => {
  const page = await open('?mode=1&judgedebug=1');
  const p = await page.eval(PREP);
  const other = p.need === 'q' ? 'w' : 'q';
  const cases = [
    ['오답 풍선(필요한 글자와 같은 글자)', { text: p.need, correct: false, wi: p.wi, si: p.si }, true, '오답!'],
    ['오답 풍선(다른 글자)', { text: other, correct: false, wi: p.wi, si: p.si }, true, '오답!'],
    ['정답 풍선이지만 다른 칸 소속', { text: p.need, correct: true, wi: p.wi, si: p.si + 1 }, true, '오답!'],
    ['이전 단어 소속 풍선', { text: p.need, correct: false, wi: p.wi - 1, si: 3 }, true, '오답!'],
    ['정답 풍선 놓침', { text: p.need, correct: true, wi: p.wi, si: p.si }, false, '놓침'],
  ];
  for (const [cls, tile, air, kind] of cases) {
    await page.eval('SpellRun.G.combo = 3; SpellRun.G.hp = 99');
    assert.equal(await page.eval(TILE({ tile, air })), true, cls);
    const last = await LAST(page);
    assert.equal(last.cls, cls); assert.equal(last.kind, kind); assert.equal(last.need, p.need); assert.equal(last.combo, 3); assert.equal(last.curSi, p.si); assert.equal(last.slots, p.n);
    assert.equal(last.text, tile.text); assert.equal(last.correct, !!tile.correct);
    const lines = await LINES(page), line = lines[lines.length - 1];
    assert.ok(line.startsWith(kind + ' ' + tile.text) && line.includes(cls) && line.includes('필요 ' + p.need) && line.includes(`칸 ${p.si + 1}/${p.n}`) && line.includes('콤보 3') && /속도 \d+/.test(line) && /단어 전환 후 [\d.]+s$/.test(line), '줄 내용: ' + line);
    if (tile.si !== p.si || tile.wi !== p.wi) assert.ok(line.includes('풍선 소속 단어' + (tile.wi + 1) + '·칸' + (tile.si + 1)), '소속 표시: ' + line);
  }
  // 높은 칸 표시와 정답(hit)은 기록만, 화면 줄은 없다
  await page.eval('SpellRun.G.tiles = []');
  const before = (await LINES(page)).length;
  await page.eval(TILE({ tile: { text: p.need, correct: true, wi: p.wi, si: p.si, high: false }, air: true }));
  const l2 = await LAST(page);
  assert.equal(l2.kind, '정답'); assert.equal((await LINES(page)).length, Math.min(2, before), '정답은 화면 줄을 만들지 않는다');
  assert.ok((await page.eval('window.__judgeLog.length')) <= 20);
  await page.close();
});

test('433 줄은 최대 2줄이고 지정 시간(기본 약 6초) 뒤 사라진다. 글자 11px 이상, pointer-events 없음(클릭을 가로채지 않음), 위치는 오른쪽 아래', { skip: SKIP, timeout: 30000 }, async () => {
  for (const [w, h] of [[800, 400], [360, 640]]) {
    const page = await open('?mode=1&judgedebug=1', { width: w, height: h });
    assert.equal(await page.eval('SpellRun.judge.JD.ttl'), 6000, '기본 6초');
    await page.eval('SpellRun.judge.JD.ttl = 700');
    const p = await page.eval(PREP);
    for (let i = 0; i < 3; i++) { await page.eval('SpellRun.G.hp = 99'); await page.eval(TILE({ tile: { text: 'q', correct: false, wi: p.wi, si: p.si }, air: true })); }
    assert.equal((await LINES(page)).length, 2, '최대 2줄');
    const g = await page.eval(`(() => { const e = document.getElementById('judgeLog'), cs = getComputedStyle(e), r = e.getBoundingClientRect(), box = document.querySelector('.sr-box').getBoundingClientRect(), line = e.firstElementChild; return { pe: cs.pointerEvents, fs: parseFloat(getComputedStyle(line).fontSize), right: Math.round(box.right - r.right), bottom: Math.round(box.bottom - r.bottom), leftHalf: r.left >= box.left + box.width * 0.25, top: r.top > box.top + box.height * 0.5, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== e && !e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; })()`);
    assert.equal(g.pe, 'none'); assert.ok(g.fs >= 10.95, '글자 11px 이상 ' + g.fs); assert.ok(g.hit, '클릭이 줄을 통과해 아래 요소로 간다'); assert.ok(g.right >= 0 && g.bottom >= 0 && g.top, `오른쪽 아래 ${JSON.stringify(g)}`);
    await new Promise(r => setTimeout(r, 1100));
    assert.equal((await LINES(page)).length, 0, '시간이 지나면 사라진다');
    await page.close();
  }
});

test('433 켜져도 동작은 같다: 같은 시드·같은 입력으로 한 판을 돌린 점수·체력·콤보·실수 기록·풍선 수·게임 시간이 judgedebug 0/1 에서 같다', { skip: SKIP, timeout: 60000 }, async () => {
  const RUN = `(() => { window.__seed(4242); const R = SpellRun, G = R.G; R.startRound(false); const t0 = G.time; let steps = 0; const dt = 1 / 60;
    while (steps++ < 2400 && G.state !== 'over') { if (steps % 97 === 0 || steps % 131 === 0) R.jump(); G.invuln = 9; R.step(dt); }
    return JSON.stringify({ score: G.score, hp: G.hp, combo: G.combo, maxCombo: G.maxCombo, mist: G.mist.slice(), wi: G.wi, si: G.si, tiles: G.tiles.length, time: Math.round((G.time - t0) * 1000), speed: Math.round(G.speed * 100) }); })()`;
  const out = [];
  for (const q of ['?mode=1', '?mode=1&judgedebug=1', '?judgedebug=0', '?judgedebug=1']) {
    const page = await open(q, { seed: true, width: q.includes('mode=1') ? 800 : 390, height: q.includes('mode=1') ? 400 : 844 });
    out.push(await page.eval(RUN));
    await page.close();
  }
  assert.equal(out[0], out[1], '가로: 꺼짐과 켜짐이 같다'); assert.equal(out[2], out[3], '세로: 꺼짐과 켜짐이 같다');
  assert.ok(JSON.parse(out[0]).mist.some(x => x > 0) || JSON.parse(out[0]).score > 0, '판이 실제로 진행됨(오답·점수)');
});

test('433 세로(classic)에서도 켜지면 동작한다: 오답 풍선(다른 글자)과 놓침 줄이 나온다(풍선 소속 정보 없음)', { skip: SKIP }, async () => {
  const page = await open('?judgedebug=1', { width: 360, height: 640 });
  const p = await page.eval(PREP);
  assert.equal(await page.eval('SpellRun.judge.on'), true);
  assert.equal(await page.eval(TILE({ tile: { text: p.need === 'q' ? 'w' : 'q', correct: false }, air: true })), true);
  let last = await LAST(page); assert.equal(last.cls, '오답 풍선(다른 글자)'); assert.equal(last.mode, 'classic');
  await page.eval('SpellRun.G.hp = 99');
  assert.equal(await page.eval(TILE({ tile: { text: p.need, correct: true }, air: false })), true);
  last = await LAST(page); assert.equal(last.cls, '정답 풍선 놓침');
  const lines = await LINES(page); assert.ok(lines.length >= 1 && !lines[lines.length - 1].includes('풍선 소속'), lines.join('|'));
  await page.close();
});
