// 작업435: 가로(edge) — 칸의 정답을 터트리면 그 칸 묶음의 남은 풍선을 떠오르게 하고 판정에서 뺀다. 헤드리스 Chrome.
// 자체 임시 서버에 모의 /api/me·/api/wordbook 만 둔다 — 실제 서버·운영 서버와 무관.
// 실행: node --test tests/ui/spellrun_rise435.ui.test.js   (Chrome이 없으면 건너뜀)
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
const SEED = `(() => { let a = 1; window.__seed = s => { a = s >>> 0; }; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;
const WORDS = ['apple', 'letter', 'garden', 'planet', 'river', 'cloud', 'bridge', 'window'];
const rows = WORDS.map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));

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

async function open(query, { width = 800, height = 400, reduce = false, seed = false } = {}) {
  const page = await browser.newPage({ width, height, token: jwt() });
  if (seed) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
  if (reduce) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.removeItem('spellrun_opts'); localStorage.setItem('spellrun_preview', '0'); localStorage.setItem('spellrun_bgm', '0'); localStorage.setItem('spellrun_mode', 'normal'); sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(rows.map(r => r.id)))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false;');
  return page;
}
// 시작하고 판 상태를 정리한다(풍선·장애물·아이템 계획 제거). 'run' 이 될 때까지 진행
const PREP = `(() => { const R = SpellRun, G = R.G; R.startRound(false); G.hp = 99; G.invuln = 9; G.obstacles = []; G.obst = null; G.heartPending = false; G.rescuePending = false; G.speedPending = false; G.tiles = []; if (G.ec) G.ec.packs = [];
  for (let i = 0; i < 600 && G.state !== 'run'; i++) R.step(1 / 60); G.tiles = []; if (G.ec) G.ec.packs = []; G.hp = 99;
  return { need: G.plan.slots[G.si].text, n: G.plan.slots.length, wi: G.wi, si: G.si, rx: R.RUNNER_X, state: G.state }; })()`;
const MK = `const R = SpellRun, G = R.G, mk = (o) => Object.assign({ id: 98000 + G.tiles.length, x: R.RUNNER_X + 200, w: 44, text: 'x', correct: false, chunk: false, high: false, state: 'live', t: 0, age: 0, checked: false, ok: false, color: '', n: 1, bi: 0, synthetic: true }, o);`;
const snap = page => page.eval(`(() => { const G = SpellRun.G; return { score: G.score, hp: G.hp, combo: G.combo, mist: G.mist.slice(), si: G.si, wi: G.wi, speedBase: Math.round(G.speedBase * 100) / 100, floats: G.floats.map(f => f.text).join('|') }; })()`);
const tiles = page => page.eval(`SpellRun.G.tiles.filter(t => t.synthetic).map(t => ({ id: t.sid, text: t.text, checked: t.checked, rise: !!t.rise, state: t.state, kind: t.kind || '' }))`);
// 정답 풍선 하나를 러너에 닿게 해 공중에서 터트린다
const POP = (tile) => `(() => { ${MK} const t = mk(${JSON.stringify(tile)}); t.x = R.RUNNER_X + 3; G.tiles.push(t); for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; G.j2 = -1; R.step(1 / 60); } return t.checked; })()`;

test('435 정답을 터트리면 그 칸 소속의 남은 풍선(오답 후보)이 모두 떠오르고 판정에서 빠진다. 정답 풍선은 터진다', { skip: SKIP }, async () => {
  const page = await open('?mode=1');
  const p = await page.eval(PREP);
  assert.equal(p.state, 'run');
  await page.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'a', text: 'q', correct: false, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 120 }), mk({ sid: 'b', text: 'w', correct: false, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 240 }), mk({ sid: 'n', text: 'z', correct: false, wi: ${p.wi}, si: ${p.si + 1}, x: R.RUNNER_X + 360 })); G.tiles.forEach(t => { if (t.sid) t.sid = t.sid; }); })()`);
  assert.equal(await page.eval(POP({ sid: 'hit', text: p.need, correct: true, wi: p.wi, si: p.si })), true);
  const after = await page.eval(`SpellRun.G.tiles.filter(t => t.synthetic).map(t => ({ text: t.text, si: t.si, correct: t.correct, checked: t.checked, rise: !!t.rise, state: t.state }))`);
  const byText = Object.fromEntries(after.map(t => [t.text, t]));
  assert.equal(byText[p.need].state, 'taken', '정답 풍선은 터진다');
  assert.equal(byText.q.rise, true, '남은 오답 풍선이 떠오른다'); assert.equal(byText.q.checked, true, '판정 제외');
  assert.equal(byText.w.rise, true); assert.equal(byText.w.checked, true);
  assert.equal(byText.z.rise, false, '다음 칸 묶음 풍선은 영향 없음'); assert.equal(byText.z.checked, false);
  // 떠오른 풍선은 러너를 지나가도 판정되지 않는다(오답·체력 변화 없음)
  const s0 = await snap(page);
  await page.eval(`(() => { const R = SpellRun, G = R.G; for (const t of G.tiles) if (t.synthetic && t.text === 'q') t.x = R.RUNNER_X + 2; for (let i = 0; i < 5; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; R.step(1 / 60); } })()`);
  const s1 = await snap(page);
  assert.equal(s1.hp, s0.hp, '떠오른 풍선은 오답이 되지 않는다'); assert.deepEqual(s1.mist, s0.mist);
  await page.close();
});

test('435 점수·콤보·체력·속도 규칙은 정답 처리에서 그대로다(같은 값 비교: 기존 정답 처리와 같은 계산)', { skip: SKIP }, async () => {
  const page = await open('?mode=1', { seed: true });
  await page.eval('window.__seed(5)'); const p = await page.eval(PREP);
  const s0 = await snap(page);
  await page.eval(`SpellRun.G.combo = 2`);
  assert.equal(await page.eval(POP({ sid: 'hit', text: p.need, correct: true, wi: p.wi, si: p.si })), true);
  const s1 = await snap(page);
  assert.equal(s1.si, p.si + 1); assert.equal(s1.combo, 3); assert.equal(s1.hp, s0.hp); assert.deepEqual(s1.mist, s0.mist);
  assert.ok(s1.score > s0.score, '점수 증가'); assert.ok(s1.speedBase > s0.speedBase, '속도 누적 증가');
  // 같은 입력을 풍선이 없는 묶음에서 한 것과 값이 같다(남은 풍선 유무가 점수·콤보에 영향 없음)
  const page2 = await open('?mode=1', { seed: true });
  await page2.eval('window.__seed(5)'); const q = await page2.eval(PREP);
  await page2.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'a', text: 'q', correct: false, wi: ${q.wi}, si: ${q.si}, x: R.RUNNER_X + 120 }), mk({ sid: 'b', text: 'w', correct: false, wi: ${q.wi}, si: ${q.si}, x: R.RUNNER_X + 240 })); G.combo = 2; })()`);
  await page2.eval(POP({ sid: 'hit', text: q.need, correct: true, wi: q.wi, si: q.si }));
  const t1 = await snap(page2);
  assert.equal(t1.score, s1.score, '남은 풍선이 있어도 점수가 같다'); assert.equal(t1.combo, s1.combo); assert.equal(t1.speedBase, s1.speedBase);
  await page.close(); await page2.close();
});

test('435 같은 글자 연속 칸(p,p): 방금 푼 칸의 풍선만 떠오르고 다음 칸 묶음의 같은 글자 정답·오답 풍선은 그대로(판정 대상)', { skip: SKIP }, async () => {
  const page = await open('?mode=1');
  const p = await page.eval(PREP);
  await page.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'cur', text: 'p', correct: false, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 150 }), mk({ sid: 'nextOk', text: 'p', correct: true, wi: ${p.wi}, si: ${p.si + 1}, x: R.RUNNER_X + 300 }), mk({ sid: 'nextBad', text: 'q', correct: false, wi: ${p.wi}, si: ${p.si + 1}, x: R.RUNNER_X + 380 })); })()`);
  await page.eval(POP({ text: p.need, correct: true, wi: p.wi, si: p.si }));
  const a = await page.eval(`SpellRun.G.tiles.filter(t => t.synthetic).map(t => [t.text + (t.correct ? '✓' : ''), t.si, t.checked, !!t.rise].join(':'))`);
  assert.ok(a.includes('p:' + p.si + ':true:true'), '푼 칸의 풍선은 떠오름: ' + a);
  assert.ok(a.includes('p✓:' + (p.si + 1) + ':false:false'), '다음 칸 정답 풍선은 그대로: ' + a);
  assert.ok(a.includes('q:' + (p.si + 1) + ':false:false'), '다음 칸 오답 풍선도 그대로: ' + a);
  await page.close();
});

test('435 단어의 마지막 칸을 풀어도 다음 단어(wi+1) 소속 풍선은 영향 없고, 같은 단어 마지막 칸 풍선만 떠오른다. 이전 단어 소속·다른 단어 풍선은 건드리지 않는다', { skip: SKIP }, async () => {
  const page = await open('?mode=1');
  const p = await page.eval(PREP);
  await page.eval(`(() => { const G = SpellRun.G; G.si = ${p.n - 1}; G.plan.slots.forEach(s => { s.filled = true; }); })()`);
  const cur = await page.eval('SpellRun.G.plan.slots[SpellRun.G.si].text');
  await page.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'last', text: 'q', correct: false, wi: ${p.wi}, si: ${p.n - 1}, x: R.RUNNER_X + 120 }), mk({ sid: 'next', text: 'z', correct: false, wi: ${p.wi + 1}, si: 0, x: R.RUNNER_X + 400 }), mk({ sid: 'old', text: 'y', correct: false, wi: ${p.wi - 1}, si: ${p.n - 1}, x: R.RUNNER_X + 80 })); })()`);
  await page.eval(POP({ text: cur, correct: true, wi: p.wi, si: p.n - 1 }));
  const a = Object.fromEntries((await page.eval(`SpellRun.G.tiles.filter(t => t.synthetic).map(t => [t.text, [t.checked, !!t.rise, t.state]])`)));
  assert.deepEqual(a.q.slice(0, 2), [true, true], '같은 단어 마지막 칸 풍선은 떠오름');
  assert.deepEqual(a.z.slice(0, 2), [false, false], '다음 단어 첫 묶음은 영향 없음');
  assert.deepEqual(a.y.slice(0, 2), [false, false], '이전 단어 소속 풍선은 이번 변경 대상이 아님');
  await page.close();
});

test('435 아이템(하트·번개·힌트·천사)은 떠오르지 않고 위치·획득이 그대로다. 같은 칸 소속이어도 t.kind 풍선이 아닌 아이템은 대상이 아니다', { skip: SKIP }, async () => {
  const page = await open('?mode=1');
  const p = await page.eval(PREP);
  await page.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'item', kind: 'heart', itemKind: 'heart', text: '', correct: false, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 100, w: 46 }), mk({ sid: 'bal', text: 'q', correct: false, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 250 })); })()`);
  const x0 = await page.eval("SpellRun.G.tiles.find(t => t.kind === 'heart').x");
  await page.eval(POP({ text: p.need, correct: true, wi: p.wi, si: p.si }));
  const it = await page.eval("(() => { const t = SpellRun.G.tiles.find(t => t.kind === 'heart'); return { rise: !!t.rise, checked: t.checked, state: t.state, moved: x0 - t.x }; })()".replace('x0', String(x0)));
  assert.equal(it.rise, false); assert.equal(it.checked, false); assert.equal(it.state, 'live');
  assert.ok(Math.abs(it.moved) < 40, '아이템은 다른 타일과 같이 흐를 뿐 위치가 바뀌지 않는다(' + it.moved + ')');
  assert.equal(await page.eval("SpellRun.G.tiles.find(t => t.text === 'q').rise ? true : false"), true, '같은 묶음 풍선은 떠오름');
  // 아이템은 공중에서 닿으면 획득된다(기존 규칙)
  const hp0 = await page.eval('SpellRun.G.hp = 3; SpellRun.G.hp');
  await page.eval(`(() => { const R = SpellRun, G = R.G, t = G.tiles.find(t => t.kind === 'heart'); t.x = R.RUNNER_X + 2; for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; R.step(1 / 60); } })()`);
  assert.equal(await page.eval('SpellRun.G.hp'), hp0 + 1, '하트 획득은 그대로');
  await page.close();
});

test('435 오답·놓침 경로는 그대로: 오답을 터트려도 남은 풍선이 떠오르지 않고(기존 riseUseless 규칙만), 정답을 놓쳐도 같은 칸 묶음이 한꺼번에 떠오르지 않는다', { skip: SKIP }, async () => {
  const page = await open('?mode=1');
  const p = await page.eval(PREP);
  await page.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'rest', text: 'w', correct: false, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 300 })); })()`);
  await page.eval(POP({ text: p.need === 'q' ? 'e' : 'q', correct: false, wi: p.wi, si: p.si }));   // 오답 풍선을 터트림
  let a = await page.eval("SpellRun.G.tiles.find(t => t.text === 'w').rise ? true : false");
  assert.equal(a, false, '오답을 터트려도 같은 칸 묶음의 오답 풍선은 그대로');
  assert.equal(await page.eval('SpellRun.G.si'), p.si, '칸은 그대로');
  assert.equal(await page.eval('SpellRun.G.mist[SpellRun.G.wi]'), 1, '실수 기록');
  await page.eval(`(() => { const G = SpellRun.G; G.hp = 99; })()`);
  await page.eval(`(() => { ${MK} const t = mk({ sid: 'okground', text: '${p.need}', correct: true, wi: ${p.wi}, si: ${p.si} }); t.x = R.RUNNER_X + 3; G.tiles.push(t); for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = -1; R.step(1 / 60); } })()`);   // 땅에서 놓침
  assert.equal(await page.eval('SpellRun.G.si'), p.si, '놓쳐도 칸은 그대로');
  assert.equal(await page.eval('SpellRun.G.mist[SpellRun.G.wi]'), 2);
  await page.close();
});

test('435 세로(classic)는 변하지 않는다: 정답을 터트린 뒤의 묶음 처리는 기존대로(떠오름 없음)', { skip: SKIP }, async () => {
  const page = await open('', { width: 360, height: 640 });
  const p = await page.eval(PREP);
  assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), false);
  await page.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'rest', text: 'w', correct: false, x: R.RUNNER_X + 150 })); })()`);
  await page.eval(POP({ text: p.need, correct: true }));
  assert.equal(await page.eval("SpellRun.G.tiles.filter(t => t.synthetic && t.text === 'w').every(t => !t.rise)"), true, '세로는 떠오름 처리를 하지 않는다');
  await page.close();
});

test('435 움직임 줄이기(reduce)에서도 같은 규칙으로 떠오른다(기존 떠오름 처리 그대로), 새 소리 표지(riseSnd)는 정답 처리가 켜지 않는다', { skip: SKIP }, async () => {
  const page = await open('?mode=1', { reduce: true });
  const p = await page.eval(PREP);
  await page.eval(`(() => { ${MK} G.tiles.push(mk({ sid: 'a', text: 'q', correct: false, wi: ${p.wi}, si: ${p.si}, x: R.RUNNER_X + 150 })); G.riseSnd = false; })()`);
  await page.eval(POP({ text: p.need, correct: true, wi: p.wi, si: p.si }));
  assert.equal(await page.eval("SpellRun.G.tiles.find(t => t.text === 'q').rise ? true : false"), true);
  assert.equal(await page.eval('SpellRun.G.riseSnd'), false, '정답 처리는 올라가는 소리 표지를 켜지 않는다(새 효과음 없음)');
  await page.close();
});

test('435 judgedebug 분류에 "이전 칸 소속 풍선"(같은 단어, 풍선 칸이 지금 칸보다 앞)이 있다', { skip: SKIP }, async () => {
  const page = await open('?mode=1&judgedebug=1');
  const p = await page.eval(PREP);
  await page.eval('SpellRun.G.si = 1; SpellRun.G.hp = 99');
  await page.eval(`(() => { ${MK} const t = mk({ text: 'q', correct: false, wi: ${p.wi}, si: 0 }); t.x = R.RUNNER_X + 3; G.tiles.push(t); for (let i = 0; i < 4 && !t.checked; i++) { G.jumpT = R.CONFIG.JUMP_TIME * 0.5; R.step(1 / 60); } })()`);
  const last = await page.eval('window.__judgeLog.slice(-1)[0]');
  assert.equal(last.kind, '오답!'); assert.equal(last.cls, '이전 칸 소속 풍선');
  await page.close();
});
