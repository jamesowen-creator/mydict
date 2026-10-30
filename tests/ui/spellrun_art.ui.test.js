// 작업358: 그림(배경·장애물·캐릭터 3종·아이템) 화면 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// 확인: 크기별 배경 층이 채워지고 글자 영역 뒤는 단순한 하늘, 보스 전환(0.5초 겹침), 캐릭터 3종 한 판, 캐릭터 선택 저장·불러오기·char 옵션, 시작 카드 배치,
//       아이템 4종이 그림으로 그려짐, 그림을 못 읽을 때 대체 그림, 장애물 새 시트
// 실행: node --test tests/ui/spellrun_art.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { SCREENS, MEASURE_SCREEN } = require('./helpers/spellrun_screens');
const L = require('../../public/js/spellrun/logic.js');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const en = (id, word, meaning) => ({ id, word, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - id).toISOString(), data: { word, lang: 'en', short_meaning: meaning, meanings: [{ pos: 'noun', definition: meaning + ', 다른 뜻' }] } });
const ROWS = [en(1, 'apple', '사과'), en(2, 'book', '책'), en(3, 'environment', '환경'), en(4, 'water', '물'), en(11, 'happy', '행복한'), en(12, 'window', '창문'), en(13, 'music', '음악'), en(14, 'friend', '친구')];
const IDS = [1, 2, 3, 4, 11, 12, 13, 14];
const SIZES = [['port', 360, 640], ['port', 390, 844], ['land', 844, 390], ['land', 640, 360]];

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

// opts: block(차단할 주소 패턴), reduce(움직임 줄이기), keepChar(저장된 캐릭터를 지우지 않음), waitArt(그림이 다 불러와질 때까지 기다림, 기본 true)
async function open(width, height, query = '', opts = {}) {
  const page = await browser.newPage({ width, height, token: jwt() });
  if (opts.block) { await page.send('Network.enable'); await page.send('Network.setBlockedURLs', { urls: opts.block }); }
  if (opts.reduce) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('spellrun_view'); " + (opts.keepChar ? '' : "localStorage.removeItem('spellrun_char'); ") + "localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.setItem('spellrun_preview', '0'); } catch (e) {}" });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(IDS))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false');
  if (opts.waitArt !== false && !opts.block) await page.waitFor("SpellRun.art.bgOK('dayFar') && SpellRun.art.bgOK('dayMid') && SpellRun.art.bgOK('clouds') && SpellRun.art.bgOK('sky') && SpellRun.art.bgOK('bossFar') && SpellRun.art.bgOK('bossNear') && SpellRun.art.itemArtReady() && SpellRun.art.activeChar() === SpellRun.art.charKey()", 8000);
  return page;
}
const noErr = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const POOL = (word, meaning) => ({ word, meaning, hint: { meaning, subs: [] }, pop: { pron: '', meaning, example: '', ranges: [] } });
const START = `(() => { const R = SpellRun; R.manual = true; R.CONFIG.DJ_ENABLED = false; R.startRound(false, { surv: false, supply: null, pool: [${[['book', '책'], ['apple', '사과'], ['water', '물']].map(([w, m]) => JSON.stringify(POOL(w, m))).join(',')}], regular: 3 }); R.manual = true; })()`;
// 단순 봇: 정답 글자를 먹고 장애물을 넘는다. n 걸음 또는 판 끝까지
const BOT = n => `(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; const T = C.JUMP_TIME; let i = 0, frames = new Set();
  while (i < ${n} && G.state !== 'over') {
    if (G.state === 'run') { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && (x.wi === undefined ? x.correct : (x.correct && x.wi === G.wi && x.si === G.si)) && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0]; if (tg && G.jumpT < 0 && (tg.x - R.RUNNER_X) / G.speed <= T / 2) R.jump(); const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X); if (G.jumpT < 0 && ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= T / 2) R.jump(); }
    R.step(1 / 60); i++; if (i % 6 === 0) { R.draw(); frames.add(G.spriteFrame); }
  }
  R.draw(); return { state: G.state, steps: i, draws: G.spriteDraws, frames: [...frames], done: G.wordsDone }; })()`;
const stepN = (page, n) => page.eval(`(() => { const R = SpellRun; for (let i = 0; i < ${n}; i++) R.step(1 / 60); R.draw(); })()`);

// 캔버스 점 읽기(논리 좌표)
const PIX = `(pts => { const cv = document.getElementById('cv'), cx = cv.getContext('2d'), S = cv.width / SpellRun.view.layout().W; return pts.map(([x, y]) => Array.from(cx.getImageData(Math.round(x * S), Math.round(y * S), 1, 1).data)); })`;

for (const [mode, w, h] of SIZES) {
  test(`358-6) 배경 ${mode === 'land' ? '가로' : '세로'} ${w}x${h}: 층이 땅 위까지 채우고, 글자 영역 뒤는 단순한 하늘이다(낮·보스)`, { skip: SKIP }, async () => {
    const page = await open(w, h, '?mode=' + (mode === 'land' ? 1 : 0));
    await page.eval(START);
    await stepN(page, 60 * 4);
    await page.eval('SpellRun.G.hurt = 0; SpellRun.G.shake = 0; SpellRun.draw()');   // 놓쳐서 생긴 붉은 번쩍임·흔들림을 지우고 본다
    const lay = await page.eval('SpellRun.view.layout()'), W = L.layoutFor(mode, 1, 1).W, CB = mode === 'land' ? 100 : 266;
    // 낮: 땅 바로 위(층 바닥) 여러 곳이 하늘 그라데이션 아래색(234,246,240)이 아니다
    const xs = [10, 60, 120, 180, 240, 300, 350].map(x => x / 360 * W);
    const near = await page.eval(`${PIX}(${JSON.stringify(xs.map(x => [x, lay.GROUND - 6]))})`);
    assert.ok(near.filter(c => Math.abs(c[0] - 234) + Math.abs(c[1] - 246) + Math.abs(c[2] - 240) > 40).length >= 6, '땅 위에 배경 층이 그려졌다: ' + JSON.stringify(near));
    // 글자 영역 뒤: 세로 그라데이션과 거의 같다(구름·언덕이 들어오지 않는다)
    const pts = []; for (let y = 4; y <= CB - 4; y += 12) for (let x = 6; x < W; x += W / 24) pts.push([x, y]);
    const day = await page.eval(`${PIX}(${JSON.stringify(pts)})`);
    const grad = y => { const t = Math.min(1, y / lay.GROUND); return [143 + (234 - 143) * t, 211 + (246 - 211) * t, 244 + (240 - 244) * t]; };
    const bad = day.filter((c, i) => Math.abs(c[0] - grad(pts[i][1])[0]) + Math.abs(c[1] - grad(pts[i][1])[1]) + Math.abs(c[2] - grad(pts[i][1])[2]) > 30).length;
    if (process.env.DUMP_ART) console.log('DAY', bad, JSON.stringify(day.map((c, i) => [pts[i][1], c.slice(0, 3)]).filter((e, i) => i % 24 === 0)));
    assert.ok(bad <= pts.length * 0.01, `낮 하늘 ${pts.length}점 중 어긋난 ${bad}`);
    // 보스: 하늘 그림이 보이고(별 몇 개만 다름), 글자 영역 뒤는 같은 줄의 색과 거의 같다
    await page.eval('SpellRun.G.bossMode = true'); await stepN(page, 40); await page.eval('SpellRun.G.hurt = 0; SpellRun.G.shake = 0; SpellRun.draw()');
    assert.ok((await page.eval('SpellRun.art.blend()')) >= 0.999);
    const boss = await page.eval(`${PIX}(${JSON.stringify(pts)})`);
    const rowMed = {}; pts.forEach((p, i) => { (rowMed[p[1]] = rowMed[p[1]] || []).push(boss[i]); });
    let off = 0; pts.forEach((p, i) => { const col = rowMed[p[1]].map(c => c[0] + c[1] + c[2]).sort((a, b) => a - b), med = col[col.length >> 1], v = boss[i][0] + boss[i][1] + boss[i][2]; if (Math.abs(v - med) > 90) off++; });
    assert.ok(off <= pts.length * 0.02, `보스 하늘에서 줄 색과 크게 다른 점 ${off}/${pts.length}(별)`);
    const bnear = await page.eval(`${PIX}(${JSON.stringify(xs.map(x => [x, lay.GROUND - 6]))})`);
    assert.ok(bnear.filter(c => c[0] < 150 && c[2] > 60 && c[2] < 200).length >= 5, '보스 땅 위는 보랏빛 능선: ' + JSON.stringify(bnear));
    noErr(page); await page.close();
  });
}

test('358-6) 보스 전환: 낮↔보스는 약 0.5초 동안 겹쳐 바뀌고(즉시 아님), 움직임 줄이기에서는 즉시', { skip: SKIP }, async () => {
  let page = await open(390, 844);
  await page.eval(START); await stepN(page, 30);
  assert.equal(await page.eval('SpellRun.art.blend()'), 0);
  await page.eval('SpellRun.G.bossMode = true');
  await page.eval('SpellRun.step(1 / 60)');
  const b1 = await page.eval('SpellRun.art.blend()'); assert.ok(b1 > 0 && b1 < 0.1, '한 걸음 뒤 ' + b1);
  await stepN(page, 14); const bh = await page.eval('SpellRun.art.blend()'); assert.ok(bh > 0.4 && bh < 0.6, '약 0.25초 뒤 절반 ' + bh);
  await stepN(page, 20); assert.equal(await page.eval('SpellRun.art.blend()'), 1);
  assert.equal(await page.eval("document.getElementById('box').classList.contains('bsky')"), true, '보스 하늘이면 위쪽 글자가 흰색');
  await page.eval('SpellRun.G.bossMode = false'); await stepN(page, 15); const bd = await page.eval('SpellRun.art.blend()'); assert.ok(bd > 0.3 && bd < 0.7, '돌아올 때도 겹침 ' + bd);
  noErr(page); await page.close();
  page = await open(390, 844, '', { reduce: true });
  await page.eval(START); await stepN(page, 30);
  await page.eval('SpellRun.G.bossMode = true; SpellRun.step(1 / 60)');
  assert.equal(await page.eval('SpellRun.art.blend()'), 1, '움직임 줄이기: 즉시');
  noErr(page); await page.close();
});

for (const [idx, key] of [[0, 'penguin'], [1, 'girl'], [2, 'boy']]) {
  test(`358-6) 캐릭터 ${key}(char=${idx}): 한 판(봇) 동안 오류 없이 그림으로 그려지고 달리기·점프 동작이 바뀐다`, { skip: SKIP }, async () => {
    for (const [w, h, q] of [[390, 844, '?mode=0&char=' + idx], [844, 390, '?mode=1&char=' + idx]]) {
      const page = await open(w, h, q);
      assert.equal(await page.eval('SpellRun.art.charKey()'), key); assert.equal(await page.eval('SpellRun.art.activeChar()'), key);
      assert.equal(await page.eval('SpellRun.CONFIG.OBSTACLE_PROB = 0.6'), 0.6);
      await page.eval(START);
      const r = await page.eval(BOT(60 * 400));
      assert.ok(r.draws > 50, '캐릭터가 그려졌다: ' + r.draws); assert.ok(r.frames.filter(f => f >= 0 && f <= 3).length >= 2, '달리기 동작이 바뀐다: ' + r.frames); assert.ok(r.frames.some(f => f === 4 || f === 5), '점프 동작이 나온다: ' + r.frames);
      assert.ok(r.done >= 2, '단어를 완성한다: ' + r.done);
      noErr(page); await page.close();
    }
  });
}

test('358-6) 캐릭터 선택: 저장·불러오기, 주소 char 가 이기고 저장·조정값에 들어가지 않는다, 모르는 저장값은 펭귄', { skip: SKIP }, async () => {
  let page = await open(390, 844);
  assert.equal(await page.eval('SpellRun.art.charKey()'), 'penguin', '기본은 펭귄');
  assert.equal(await page.eval("document.querySelector('#charRow [data-char=penguin]').getAttribute('aria-pressed')"), 'true');
  await page.eval("document.querySelector('#charRow [data-char=girl]').click()");
  assert.equal(await page.eval('SpellRun.art.charKey()'), 'girl'); assert.equal(await page.eval("localStorage.getItem('spellrun_char')"), 'girl');
  assert.equal(await page.eval("document.querySelector('#charRow [data-char=girl]').getAttribute('aria-pressed')"), 'true'); assert.equal(await page.eval("document.querySelector('#charRow [data-char=penguin]').getAttribute('aria-pressed')"), 'false');
  assert.equal(await page.eval("localStorage.getItem('spellrun_opts')"), null);
  await page.close();
  page = await open(390, 844, '', { keepChar: true }); await page.eval("localStorage.setItem('spellrun_char', 'girl')"); await page.close();
  page = await open(390, 844, '', { keepChar: true }); assert.equal(await page.eval('SpellRun.art.charKey()'), 'girl', '기억된 선택'); await page.close();
  page = await open(390, 844, '?char=2', { keepChar: true }); assert.equal(await page.eval('SpellRun.art.charKey()'), 'boy', '주소 char=2 가 이긴다');
  assert.equal(await page.eval("localStorage.getItem('spellrun_char')"), 'girl', '주소 옵션은 저장하지 않는다'); assert.equal(await page.eval("document.getElementById('tune').hidden"), true, '조정값 사용 중에 넣지 않는다');
  assert.equal(await page.eval("document.querySelector('#charRow [data-char=boy]').getAttribute('aria-pressed')"), 'true'); await page.close();
  page = await open(390, 844, '?char=0', { keepChar: true }); assert.equal(await page.eval('SpellRun.art.charKey()'), 'penguin'); await page.close();
  page = await open(390, 844, '?char=9', { keepChar: true }); assert.equal(await page.eval('SpellRun.art.charKey()'), 'girl', '범위 밖 주소 값은 무시하고 저장값'); await page.close();
  page = await open(390, 844, '', { keepChar: true }); await page.eval("localStorage.setItem('spellrun_char', 'robot')"); await page.close();
  page = await open(390, 844, '', { keepChar: true }); assert.equal(await page.eval('SpellRun.art.charKey()'), 'penguin', '모르는 저장값은 펭귄'); await page.close();
  // 대결 판도 고른 캐릭터로 달린다: 그리기가 고른 캐릭터를 쓰는지(상대 막대·서버와 무관)
  page = await open(390, 844, '?char=1'); assert.equal(await page.eval('SpellRun.art.activeChar()'), 'girl'); await page.close();
});

for (const [mode, w, h] of SIZES) {
  test(`358-6) 시작 카드 ${mode === 'land' ? '가로' : '세로'} ${w}x${h}: 캐릭터 줄(그림 + 이름, 44px 이상)이 있고 가로는 스크롤 없이 시작 버튼이 보인다`, { skip: SKIP }, async () => {
    const page = await open(w, h, '?mode=' + (mode === 'land' ? 1 : 0));
    const btns = await page.eval(`[...document.querySelectorAll('#charRow button')].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: r.width, h: r.height, img: getComputedStyle(b.querySelector('.chimg')).backgroundImage }; })`);
    assert.deepEqual(btns.map(b => b.t), ['펭귄', '여학생', '남학생']);
    assert.ok(btns.every(b => b.w >= 43.5 && b.h >= 43.5), '터치 44px 이상: ' + JSON.stringify(btns.map(b => [Math.round(b.w), Math.round(b.h)])));
    assert.ok(btns.every(b => /spellrun_(penguin|girl|boy)_sheet\.png/.test(b.img)), '작은 그림');
    const m = await page.eval(MEASURE_SCREEN(['startBtn', 'helpBtn', 'charRow']));
    const sc = await page.eval('[document.documentElement.scrollWidth, window.innerWidth]');
    assert.ok(sc[0] <= sc[1], '가로 스크롤 없음');
    if (mode === 'land') { assert.ok(m.overflow <= 1, `가로 시작 카드 넘침 ${m.overflow}px`); assert.deepEqual(m.hidden, [], '가려진 버튼 ' + m.hidden); }
    else if (h >= 800) assert.deepEqual(m.hidden, [], '세로 큰 화면: 시작 버튼이 스크롤 없이 보인다');
    console.log(`[측정] 시작 카드 ${mode === 'land' ? '가로' : '세로'} ${w}x${h} 넘침 ${m.overflow}px 가려진 ${m.hidden.join(',') || '없음'}`);
    noErr(page); await page.close();
  });
}

test('358-6) 아이템 4종(하트·번개·전구·천사)이 그림으로 그려진다. 그림을 못 읽으면 기존 도형으로 그려지고 오류가 없다', { skip: SKIP }, async () => {
  const SPY = `(() => { window.__ia = []; const o = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function (img) { if (img && img.src && /items_sheet/.test(img.src)) window.__ia.push(arguments[1] / 112); return o.apply(this, arguments); }; window.__fills = 0; const f = CanvasRenderingContext2D.prototype.fill; CanvasRenderingContext2D.prototype.fill = function () { window.__fills++; return f.apply(this, arguments); }; })()`;
  const PLACE = `(() => { const R = SpellRun, G = R.G; G.tiles = ['heart', 'speed', 'hint', 'angel'].map((k, i) => ({ id: -(i + 1), kind: k, x: 150 + i * 60, w: 46, text: '', correct: false, chunk: false, state: 'live', t: 0, age: 1, checked: false, ok: false, color: '' })); R.draw(); })()`;
  let page = await open(390, 844);
  await page.eval(START); await stepN(page, 30);
  await page.eval(SPY); await page.eval(PLACE);
  assert.deepEqual([...new Set(await page.eval('window.__ia'))].sort(), [0, 1, 2, 3], '네 아이템이 시트의 칸 0~3 으로 그려진다');
  noErr(page); await page.close();
  page = await open(390, 844, '', { block: ['*items_sheet*'] });
  assert.equal(await page.eval('SpellRun.art.itemArtReady()'), false);
  await page.eval(START); await stepN(page, 30);
  await page.eval(SPY); await page.eval(PLACE);
  assert.deepEqual(await page.eval('window.__ia'), [], '그림을 못 읽으면 시트를 쓰지 않는다'); assert.ok((await page.eval('window.__fills')) > 4, '기존 도형으로 그린다');
  noErr(page); await page.close();
});

test('358-6) 대체 그림: 고른 캐릭터 시트를 못 읽으면 펭귄, 배경을 못 읽으면 기존 언덕, 모두 못 읽으면 도형 캐릭터 — 오류 없이 한 판이 돈다', { skip: SKIP }, async () => {
  let page = await open(390, 844, '?char=1', { block: ['*spellrun_girl_sheet*'] });
  await page.waitFor("SpellRun.art.charReady('penguin')", 5000);
  assert.equal(await page.eval('SpellRun.art.activeChar()'), 'penguin', '여학생 시트가 없으면 펭귄');
  await page.eval(START); let r = await page.eval(BOT(60 * 300)); assert.ok(r.draws > 20); noErr(page); await page.close();
  page = await open(390, 844, '?char=2', { block: ['*/img/spellrun/*'] });
  assert.equal(await page.eval('SpellRun.art.activeChar()'), null, '모든 캐릭터 시트가 없다'); assert.equal(await page.eval("SpellRun.art.bgOK('dayFar') || SpellRun.art.bgOK('sky') || SpellRun.art.itemArtReady() || SpellRun.art.obstArtReady()"), false);
  await page.eval(START); r = await page.eval(BOT(60 * 300)); assert.ok(r.steps > 600, '한 판이 돈다: ' + r.steps);
  await page.eval('SpellRun.G.bossMode = true'); await stepN(page, 40);   // 보스 대체 그림도 오류 없이
  const px = await page.eval(`${PIX}([[10, 10], [200, 10]])`); assert.ok(px.every(c => c[3] === 255), '하늘이 비지 않는다');
  noErr(page); await page.close();
  page = await open(390, 844, '', { block: ['*/img/spellrun/bg_*', '*clouds_sheet*'] });
  assert.equal(await page.eval("SpellRun.art.bgOK('dayFar')"), false);
  await page.eval(START); await stepN(page, 60 * 3);
  const gnd = (await page.eval('SpellRun.view.layout().GROUND'));
  const hills = await page.eval(`${PIX}([[100, ${gnd - 10}], [250, ${gnd - 10}]])`);
  assert.ok(hills.every(c => c[3] === 255 && c[1] > c[0]), '기존 코드 언덕(연두)이 그려진다: ' + JSON.stringify(hills));
  noErr(page); await page.close();
});

test('358-6) 장애물 새 시트: 이름·크기·바닥선이 상수와 같고(실행 중 알파로 잰 값), 4종이 그려진다', { skip: SKIP }, async () => {
  const page = await open(390, 844);
  await page.waitFor('SpellRun.art.obstArtReady()', 5000);
  const o = await page.eval('SpellRun.obstArt()'); assert.equal(o.ready, true);
  assert.deepEqual(o.objs.map(x => x.name), ['rocks', 'log', 'crate', 'bush']);
  o.objs.forEach((m, i) => { const c = L.OBSTACLE_ART.OBJECTS[i]; assert.ok(Math.abs(m.w - c.w) <= 2 && Math.abs(m.h - c.h) <= 2, `${m.name} 실측 ${m.w}x${m.h} vs 상수 ${c.w}x${c.h}`); assert.ok(Math.abs(m.foot - L.OBSTACLE_ART.FOOT_Y) <= 1, `${m.name} 바닥 ${m.foot}`); });
  noErr(page); await page.close();
});
