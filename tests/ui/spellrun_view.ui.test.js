// 작업355: 꽉 찬 게임 화면(세로·가로) 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// 확인: 크기별 배치(헤더·화면 바 숨김, 판이 화면을 채움, 스크롤 없음, HUD·뜻·글자 칸·높은 칸·대결 막대 겹침 없음), 세로 640 동일성, 모드 선택·저장·주소 옵션,
//       가로=edge·세로=classic, 가로 선택+세로 화면 안내 띠(게임 계속), [세로로 하기]·[닫기]·진행 중 모드 전환 보류, 전체 화면 요청(사용자 탭 안에서만, 없거나 거부돼도 오류 없음)
// 실행: node --test tests/ui/spellrun_view.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const L = require('../../public/js/spellrun/logic.js');

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

// opts.init: 문서가 만들어지기 전에 실행할 스크립트(전체 화면 가짜 함수 등), opts.store: 저장 초기화 건너뛰기
async function open(width, height, query = '', opts = {}) {
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { " + (opts.keepView ? '' : "localStorage.removeItem('spellrun_view'); ") + "localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.setItem('spellrun_preview', '0'); } catch (e) {}" });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(IDS))}); } catch (e) {}` });
  if (opts.init) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: opts.init });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  return page;
}
const noErr = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const run = async page => { await page.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false'); await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000); };   // 수동 진행을 먼저 켜서 시작 직후 실시간 걸음이 끼지 않게 한다

// 세로 3 + 가로 4 크기(실제 화면 CSS px)
const SIZES = [['port', 360, 640], ['port', 390, 844], ['port', 412, 915], ['land', 640, 360], ['land', 844, 390], ['land', 915, 412], ['land', 932, 430]];

const MEASURE = `(() => {
  const R = window.SpellRun, bx = document.getElementById('box'), b = bx.getBoundingClientRect(), u = parseFloat(bx.style.getPropertyValue('--u'));
  const rc = id => { const e = typeof id === 'string' ? document.getElementById(id) : id; if (!e || e.hidden || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: (r.left - b.left) / u, t: (r.top - b.top) / u, r: (r.right - b.left) / u, b: (r.bottom - b.top) / u, w: r.width / u, h: r.height / u }; };
  const lay = R.view.layout(), doc = document.documentElement;
  const cell = document.querySelector('#word .cell:not(.fixed)'), mean = document.getElementById('meaning');
  return { u, lay, box: { l: b.left, t: b.top, r: b.right, b: b.bottom }, vw: window.innerWidth, vh: window.innerHeight, scrollW: doc.scrollWidth, scrollH: doc.scrollHeight, bodyPos: getComputedStyle(document.body).position,
    header: getComputedStyle(document.querySelector('.metis-app-header')).display, bar: getComputedStyle(document.querySelector('.screen-bar')).display,
    items: { hearts: rc('hearts'), score: rc(document.querySelector('.scorebox')), progress: rc('progress'), speed: rc('speedTag'), snd: rc('snd'), ctl: rc('srCtl'), ctlClose: rc('srClose'), ctlView: rc('srView'), meaning: rc('meaning'), sub: rc('sub'), word: rc('word') },
    meanPx: parseFloat(getComputedStyle(mean).fontSize), cellPx: cell ? cell.getBoundingClientRect().width : 0, tilePx: 58 * u, hudBottom: Math.max(...[...document.querySelectorAll('#hud .row')].map(e => rc(e)).filter(Boolean).map(r => r.b)) };
})()`;
const hit = (a, b) => a && b && a.l < b.r - 0.01 && b.l < a.r - 0.01 && a.t < b.b - 0.01 && b.t < a.b - 0.01;

for (const [mode, w, h] of SIZES) {
  test(`355-3) 배치 ${mode === 'land' ? '가로' : '세로'} ${w}x${h}: 판이 화면을 채우고, 헤더·화면 바 숨김, 스크롤 없음, HUD·뜻·글자 칸·단추가 겹치지 않고 높은 칸 타일 윗변보다 위`, { skip: SKIP }, async () => {
    const page = await open(w, h, '?mode=' + (mode === 'land' ? 1 : 0));
    // 시작 화면에서도 채움·숨김·스크롤 없음
    let m = await page.eval(MEASURE);
    assert.equal(m.header, 'none'); assert.equal(m.bar, 'none'); assert.equal(m.bodyPos, 'fixed');
    assert.ok(m.scrollW <= m.vw && m.scrollH <= m.vh, `스크롤 없음 ${m.scrollW}x${m.scrollH} <= ${m.vw}x${m.vh}`);
    await run(page);
    await page.eval(`(() => { const R = SpellRun; for (let i = 0; i < 60 * 9; i++) R.step(1 / 60); R.draw(); })()`);   // 새 단어 연출이 끝날 때까지
    m = await page.eval(MEASURE);
    const exp = L.layoutFor(mode, m.vw, m.vh);
    assert.equal(m.lay.W, exp.W); assert.equal(m.lay.H, exp.H); assert.equal(m.lay.GROUND, exp.GROUND);
    if (mode === 'port') { assert.equal(m.lay.W, 360); assert.ok(m.lay.H >= 640); }
    else { assert.equal(m.lay.W, 800); assert.equal(m.lay.H, 400); }
    assert.ok(m.box.l >= -0.5 && m.box.t >= -0.5 && m.box.r <= m.vw + 0.5 && m.box.b <= m.vh + 0.5, '판이 화면 안');
    assert.ok((m.box.r - m.box.l) >= m.vw - 3 || (m.box.b - m.box.t) >= m.vh - 3, '화면의 폭 또는 높이를 채운다(상한 1.5 배율이 아니면)');
    const it = m.items, all = ['hearts', 'score', 'progress', 'speed', 'snd', 'ctl', 'meaning', 'sub', 'word'];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!hit(it[all[i]], it[all[j]]), `${all[i]} 와 ${all[j]} 가 겹친다: ${JSON.stringify(it[all[i]])} ${JSON.stringify(it[all[j]])}`);
    const highTop = m.lay.HIGH_Y - 29;
    assert.ok(it.word.b <= highTop - 5, `글자 칸 줄 아래 끝 ${it.word.b.toFixed(1)} <= 높은 칸 타일 윗변 ${highTop} - 5`);
    if (mode === 'land') assert.ok(it.word.b <= 100.5, `가로 글자 영역 높이 100 이하: ${it.word.b.toFixed(1)}`);
    if (mode === 'port') assert.ok(it.ctlClose.h * m.u >= 20 && it.ctlView.w > 0);
    else assert.ok(it.progress === null && it.speed === null && it.snd === null && it.ctl === null, '작업360: 가로 상단은 하트·점수만(나머지는 [메뉴] 단추로)');
    // 터치 영역: 시각 크기는 작아도 44px 이상(::before)
    const tap = await page.eval(`(() => { const e = document.getElementById('${mode === 'land' ? 'srMenuBtn' : 'srClose'}'), r = e.getBoundingClientRect(), p = getComputedStyle(e, '::before'); return { h: parseFloat(p.height), w: r.width, hh: r.height }; })()`);
    assert.ok(tap.h >= 44 - 0.5, '터치 영역 높이 ' + tap.h);
    // 대결 막대·나가기(아래): 서로 겹치지 않고 판 안, 나가기는 44px 이상
    await page.eval(`(() => { const bar = document.getElementById('vsBar'); bar.hidden = false; document.getElementById('vsBarName').textContent = '상대 이름'; document.getElementById('vsBarStats').textContent = '체력 5/5 · 점수 1,234 · 콤보 3 · 단어 2'; document.getElementById('vsQuitBtn').hidden = false; document.getElementById('vsToast').hidden = false; document.getElementById('vsToast').textContent = '안내 문구'; })()`);
    const v = await page.eval(`(() => { const bx = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')); const rc = id => { const r = document.getElementById(id).getBoundingClientRect(); return { l: (r.left - bx.left) / u, t: (r.top - bx.top) / u, r: (r.right - bx.left) / u, b: (r.bottom - bx.top) / u, pw: r.width, ph: r.height }; }; return { bar: rc('vsBar'), quit: rc('vsQuitBtn'), toast: rc('vsToast'), H: SpellRun.view.layout().H, W: SpellRun.view.layout().W, ground: SpellRun.view.layout().GROUND }; })()`);
    assert.ok(!hit(v.bar, v.quit) && !hit(v.toast, v.quit) && !hit(v.toast, v.bar), '대결 막대·나가기·안내가 서로 겹치지 않는다: ' + JSON.stringify(v));
    for (const k of ['bar', 'quit', 'toast']) assert.ok(v[k].l >= 0 && v[k].r <= v.W + 0.5 && v[k].b <= v.H + 0.5 && v[k].t >= 0, k + ' 판 안');
    assert.ok(v.quit.pw >= 43.5 && v.quit.ph >= 43.5, `나가기 터치 ${v.quit.pw}x${v.quit.ph} >= 44`);
    assert.ok(!hit(v.quit, it.ctl) && !hit(v.bar, it.word) && !hit(v.quit, it.word) && !hit(v.toast, it.word), '막대·나가기가 위쪽 단추·글자 칸과 겹치지 않는다');
    const rows = ['[측정]', `${mode === 'land' ? '가로' : '세로'} ${w}x${h}`, `논리 ${m.lay.W}x${m.lay.H}`, `배율 ${(m.u).toFixed(2)}`, `뜻 ${m.meanPx.toFixed(1)}px`, `글자 칸 ${m.cellPx.toFixed(1)}px`, `타일 높이 ${m.tilePx.toFixed(1)}px`];
    console.log(rows.join(' | '));
    noErr(page); await page.close();
  });
}

test('355-3) 세로 높이 640(360x640): 땅·타일·높은 칸 위치가 이전과 같다(520·412·305, 높이 640)', { skip: SKIP }, async () => {
  const page = await open(360, 640);
  await run(page);
  const l = await page.eval('SpellRun.view.layout()');
  assert.deepEqual(l, { W: 360, H: 640, GROUND: 520, TILE_Y: 412, HIGH_Y: 305 });
  assert.equal(await page.eval('SpellRun.view.scale()'), 1);
  noErr(page); await page.close();
});

test('355-3) 세로 높이를 늘려도(360x780, 412x915) 땅 기준 상대 위치는 같고 늘어난 높이는 하늘 2/3·아래 띠 1/3', { skip: SKIP }, async () => {
  for (const [w, h] of [[360, 780], [412, 915]]) {
    const page = await open(w, h);
    await run(page);
    const l = await page.eval('SpellRun.view.layout()');
    const e = l.H - 640, es = Math.round(e * 2 / 3);
    assert.ok(e > 0);
    assert.equal(l.GROUND, 520 + es); assert.equal(l.GROUND - l.TILE_Y, 520 - 412); assert.equal(l.GROUND - l.HIGH_Y, 520 - 305);
    assert.equal(l.H - l.GROUND, 120 + (e - es), '땅 아래 띠 = 120 + 늘어난 높이의 1/3');
    noErr(page); await page.close();
  }
});

test('355-3) 모드: 기본은 세로(classic), 선택은 저장·불러오기, 주소 mode 가 이기고 저장·조정값에 들어가지 않는다, 가로=edge, 직접 준 stream 이 우선', { skip: SKIP }, async () => {
  let page = await open(390, 844);
  assert.equal(await page.eval('SpellRun.view.mode()'), 'port'); assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), false);
  assert.equal(await page.eval("document.querySelector('#viewRow [data-view=port]').getAttribute('aria-pressed')"), 'true');
  await page.eval("document.querySelector('#viewRow [data-view=land]').click()");   // 시작 화면에서 바로 적용
  assert.equal(await page.eval('SpellRun.view.mode()'), 'land'); assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), true, '가로는 edge');
  assert.deepEqual(await page.eval('SpellRun.view.layout()').then(l => [l.W, l.H]), [800, 400], '곧바로 판 크기를 다시 계산');
  assert.equal(await page.eval("localStorage.getItem('spellrun_view')"), 'land'); assert.equal(await page.eval("localStorage.getItem('spellrun_opts')"), null);
  assert.equal(await page.eval("document.getElementById('srView').textContent"), '세로로');
  await page.close();
  // 기억: 저장값 land → 다시 열어도 가로. 주소 mode=0 이 이긴다(저장값은 그대로). mode=1 은 조정값이 아니다
  page = await open(915, 412, '', { keepView: true }); await page.eval("localStorage.setItem('spellrun_view', 'land')"); await page.close();
  page = await open(915, 412, '', { keepView: true }); assert.equal(await page.eval('SpellRun.view.mode()'), 'land', '기억된 선택'); await page.close();
  page = await open(915, 412, '?mode=0', { keepView: true }); assert.equal(await page.eval('SpellRun.view.mode()'), 'port', '주소 mode=0 이 우선');
  assert.equal(await page.eval("localStorage.getItem('spellrun_view')"), 'land', '주소 옵션은 저장하지 않는다'); assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), false); await page.close();
  page = await open(390, 844, '?mode=1'); assert.equal(await page.eval('SpellRun.view.mode()'), 'land');
  assert.equal(await page.eval("document.getElementById('tune').hidden"), true, 'mode 는 조정값 사용 중에 넣지 않는다'); assert.equal(await page.eval("localStorage.getItem('spellrun_opts')"), null); await page.close();
  // stream 직접 값이 우선(시험용): 가로 + stream=0 → classic, 세로 + stream=edge → edge
  page = await open(915, 412, '?mode=1&stream=0'); assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), false); await page.close();
  page = await open(390, 844, '?mode=0&stream=edge'); assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), true); await page.close();
});

test('355-3) 가로 한 판: edge 로 오른쪽 화면 밖에서 흘러 들어오고(화면 안 생성 0건) 판이 끝까지 간다', { skip: SKIP }, async () => {
  const page = await open(915, 412, '?mode=1');
  await run(page);
  const r = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; let inside = 0, steps = 0; const seen = new Set(); const W = R.view.layout().W; const T = C.JUMP_TIME;
    while (steps < 60 * 300 && G.state !== 'over') {
      if (G.state === 'run') {
        const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.kind === 'heart' ? true : (x.correct && x.wi === G.wi && x.si === G.si)) && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0];
        if (tg) { const tta = (tg.x - R.RUNNER_X) / G.speed; if (tg.high) { if (G.jumpT < 0 && tta <= T) R.jump(); else if (G.jumpT >= 0 && G.j2 < 0 && tta <= T / 2) R.jump(); } else if (G.jumpT < 0 && tta <= T / 2) R.jump(); }
        if (G.jumpT < 0) { const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X); if (ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= T / 2) R.jump(); }
      }
      R.step(1 / 60); steps++;
      for (const t of G.tiles) if (!seen.has(t)) { seen.add(t); if (t.x - t.w / 2 < W - (G.speed / 60 + 0.001)) { inside++; (window.__in = window.__in || []).push(['t', steps, Math.round(t.x), t.w, t.kind || t.text, Math.round(G.speed)]); } }
      for (const o of G.obstacles) if (!seen.has(o)) { seen.add(o); if (o.x < W - (G.speed / 60 + 0.001)) { inside++; (window.__in = window.__in || []).push(['o', steps, Math.round(o.x), o.w]); } }
      if (steps % 400 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { inside, over: G.state === 'over', done: G.wordsDone, hp: G.hp, W }; })()`);
  assert.equal(r.W, 800); if (r.inside) console.log('INSIDE', JSON.stringify(await page.eval('window.__in'))); assert.equal(r.inside, 0, '화면 안에서 생긴 타일·장애물 0건'); assert.equal(r.over, true); assert.ok(r.done >= 5, '완성 ' + r.done);
  noErr(page); await page.close();
});

test('355-3) 가로를 골랐는데 폰이 세로: 안내 띠가 뜨고 게임은 계속되며, [세로로 하기]가 세로로 바꾼다. 가로가 되면 띠가 사라진다', { skip: SKIP }, async () => {
  const page = await open(390, 844, '?mode=1');
  assert.equal(await page.eval("document.getElementById('rotBand').hidden"), false, '가로 선택 + 세로 화면: 안내 띠');
  assert.match(await page.eval("document.getElementById('rotBand').textContent"), /폰을 가로로 돌려 주세요\(폰의 자동 회전이 켜져 있어야 해요\)/);
  await run(page);
  const t0 = await page.eval('SpellRun.G.time');
  await page.eval(`(() => { for (let i = 0; i < 120; i++) SpellRun.step(1 / 60); })()`);
  assert.ok((await page.eval('SpellRun.G.time')) > t0 + 1.9, '게임은 멈추지 않는다'); assert.equal(await page.eval('SpellRun.G.state'), 'run');
  const band = await page.eval("(() => { const r = document.getElementById('rotBand').getBoundingClientRect(), b = document.getElementById('rotBtn').getBoundingClientRect(); return { top: r.top, h: r.height, bh: b.height, bw: b.width }; })()");
  assert.ok(band.top <= 1 && band.bh >= 43.5 && band.bw >= 43.5, '맨 위 작은 띠, 단추 44px 이상: ' + JSON.stringify(band));
  await page.resize(915, 412);   // 폰을 가로로 돌림
  await page.waitFor("document.getElementById('rotBand').hidden === true", 3000);
  assert.equal(await page.eval('SpellRun.view.layout().W'), 800);
  await page.resize(390, 844);
  await page.waitFor("document.getElementById('rotBand').hidden === false", 3000);
  // 달리는 중 [세로로 하기]: 보류하고 안내, 판이 끝나면 적용
  await page.click('#rotBtn');
  assert.equal(await page.eval('SpellRun.view.pending()'), 'port'); assert.equal(await page.eval('SpellRun.view.mode()'), 'land', '달리는 중에는 판 크기·흐름을 바꾸지 않는다');
  assert.equal(await page.eval("document.getElementById('srToast').hidden"), false); assert.match(await page.eval("document.getElementById('srToast').textContent"), /판이 끝나면 세로로 바뀌어요/);
  assert.equal(await page.eval("localStorage.getItem('spellrun_view')"), 'port', '선택은 곧바로 기억');
  await page.eval(`(() => { const G = SpellRun.G; G.hp = 1; })()`);
  await page.eval(`(async () => { const R = SpellRun, G = R.G; let n = 0; while (G.state !== 'over' && n < 60 * 400) { R.step(1 / 60); n++; if (n % 500 === 0) await new Promise(r => setTimeout(r, 0)); } })()`);
  await page.waitFor("SpellRun.view.mode() === 'port'", 3000);
  assert.equal(await page.eval('SpellRun.view.pending()'), null); assert.equal(await page.eval("document.getElementById('rotBand').hidden"), true);
  assert.equal(await page.eval('SpellRun.CONFIG.STREAM_EDGE'), false);
  noErr(page); await page.close();
  // 세로를 골랐는데 폰이 가로: 띠 없이 세로 판을 가운데에 두고 양옆은 배경
  const p2 = await open(915, 412, '?mode=0');
  assert.equal(await p2.eval("document.getElementById('rotBand').hidden"), true);
  const g = await p2.eval("(() => { const b = document.getElementById('box').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, vw: window.innerWidth, stageW: s.width, bg: getComputedStyle(document.getElementById('stage')).backgroundColor }; })()");
  assert.ok(Math.abs(g.l - (g.vw - g.r)) <= 1.5 && g.w < g.vw, '세로 판이 가운데: ' + JSON.stringify(g)); assert.ok(g.stageW >= g.vw - 0.5, '배경이 화면 끝까지');
  noErr(p2); await p2.close();
});

test('355-3) 달리는 중 [가로로]는 판이 끝난 뒤 적용되고 안내가 뜬다. 시작 화면에서는 곧바로 적용된다', { skip: SKIP }, async () => {
  const page = await open(915, 412);
  await page.click('#srView');   // 시작 화면: 곧바로
  assert.equal(await page.eval('SpellRun.view.mode()'), 'land');
  await page.eval("SpellRun.view.set('port')");   // 작업360: 가로에서는 [세로로]가 [메뉴] 안에 있다(메뉴 시험은 spellrun_land360)
  assert.equal(await page.eval('SpellRun.view.mode()'), 'port');
  await run(page);
  await page.click('#srView');
  assert.equal(await page.eval('SpellRun.view.mode()'), 'port', '달리는 중이라 보류'); assert.equal(await page.eval('SpellRun.view.pending()'), 'land');
  assert.match(await page.eval("document.getElementById('srToast').textContent"), /판이 끝나면 가로로 바뀌어요/);
  assert.equal(await page.eval("document.getElementById('srView').textContent"), '세로로', '보류된 선택이 단추에 반영');
  await page.click('#srView');   // 다시 누르면 보류 취소
  assert.equal(await page.eval('SpellRun.view.pending()'), null);
  noErr(page); await page.close();
});

test('355-3) [닫기]: 게임 랜딩으로 돌아간다(작업376). 대결 중이면 기존 나가기 확인 대화상자를 먼저 연다', { skip: SKIP }, async () => {
  let page = await open(390, 844);
  await page.click('#srClose');
  await page.waitFor("location.pathname === '/english_dictionary.html'", 8000);
  await page.close();
  page = await open(390, 844);
  await run(page);
  await page.eval(`(() => { const V = SpellRun.vs.game; V.on = true; V.running = true; V.ended = false; })()`);
  await page.click('#srClose');
  assert.equal(await page.eval("document.getElementById('vsQuit').hidden"), false, '대결 중에는 나가기 확인');
  assert.equal(await page.eval("location.pathname"), '/spelling_run.html', '바로 나가지 않는다');
  await page.eval(`(() => { const V = SpellRun.vs.game; V.running = false; V.on = false; })()`);
  await page.close();
});

// ───────── 전체 화면 요청 ─────────
const FS_SPY = mode => `(() => { window.__fs = []; const de = Element.prototype;   // 문서가 만들어지기 전이라 documentElement 가 없다: 프로토타입에 건다
  ${mode === 'none' ? 'de.requestFullscreen = undefined;' : mode === 'throw' ? "de.requestFullscreen = function (o) { window.__fs.push(o); throw new Error('지원 안 함'); };" : mode === 'reject' ? "de.requestFullscreen = function (o) { window.__fs.push(o); return Promise.reject(new Error('거부')); };" : "de.requestFullscreen = function (o) { window.__fs.push(o); return Promise.resolve(); };"} })();`;
for (const mode of ['reject', 'throw', 'none', 'ok']) {
  test(`355-3) 전체 화면 요청(${mode}): 사용자 탭 안에서만 불리고, ${mode === 'ok' ? '성공' : '없거나 거부돼도'} 오류 없이 게임이 진행된다`, { skip: SKIP }, async () => {
    const page = await open(915, 412, '?mode=1', { init: FS_SPY(mode) });
    assert.deepEqual(await page.eval('window.__fs'), [], '불러오기·모드 옵션만으로는 요청하지 않는다');
    await page.eval("SpellRun.view.set('port'); SpellRun.view.set('land')");
    assert.deepEqual(await page.eval('window.__fs'), [], '스크립트 호출(탭 아님)로는 요청하지 않는다');
    await page.click('#viewRow [data-view=port]');   // [세로] 선택 버튼(탭)
    const afterView = await page.eval('window.__fs.length');
    await page.click('#srView');
    await page.click('#startBtn');
    await page.waitFor("SpellRun.G.state === 'run'", 4000);
    const fs = await page.eval('window.__fs');
    if (mode === 'none') assert.deepEqual(fs, []); else { assert.ok(afterView >= 1 && fs.length >= 3, '모드 버튼·시작 탭에서 요청: ' + fs.length); for (const o of fs) assert.deepEqual(o, { navigationUI: 'hide' }); }
    await page.eval('SpellRun.manual = true; for (let i = 0; i < 120; i++) SpellRun.step(1 / 60)');
    assert.equal(await page.eval('SpellRun.G.state'), 'run', '게임은 계속된다');
    noErr(page); await page.close();
  });
}
