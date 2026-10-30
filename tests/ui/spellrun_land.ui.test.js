// 작업356: 가로 화면 다듬기 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API). 외부 API·운영 서버와 무관.
// 확인: 가로 4가지 크기에서 시작·결과·게임 방법·미리 보기·이어하기·대결 화면의 주 버튼이 스크롤 없이 보임(겹침 없음, 판 안, 터치 44px),
//       달리는 중 뜻·글자 칸이 한 줄(HUD와 겹침 없음, 글자 영역 100 이하), 팝업·배너·큰 뜻 연출 위치, 글자 크기 측정표(세로 390x844 비교)
// 실행: node --test tests/ui/spellrun_land.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { SCREENS, MEASURE_SCREEN } = require('./helpers/spellrun_screens');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const en = (id, word, meaning) => ({ id, word, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - id).toISOString(), data: { word, lang: 'en', short_meaning: meaning, meanings: [{ pos: 'noun', definition: meaning + ', 다른 뜻' }] } });
const ROWS = [en(1, 'apple', '사과'), en(2, 'book', '책'), en(3, 'environment', '환경'), en(4, 'water', '물'), en(11, 'happy', '행복한'), en(12, 'window', '창문'), en(13, 'music', '음악'), en(14, 'friend', '친구')];
const IDS = [1, 2, 3, 4, 11, 12, 13, 14];
const LAND = [[640, 360], [844, 390], [915, 412], [932, 430]];

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
const hit = (a, b) => a && b && a.l < b.r - 0.01 && b.l < a.r - 0.01 && a.t < b.b - 0.01 && b.t < a.b - 0.01;

for (const [w, h] of LAND) {
  test(`356-3) 가로 ${w}x${h}: 시작·결과·게임 방법·미리 보기·이어하기·대결 화면의 주 버튼이 스크롤 없이 보이고 겹치지 않으며 판 안, 터치 44px 이상`, { skip: SKIP }, async () => {
    const page = await open(w, h);
    // 결과 화면을 만들 한 판(점프하지 않고 끝낸다)
    await page.click('#startBtn'); await page.waitFor("SpellRun.G.state === 'run'", 4000);
    await page.eval(`(() => { const R = SpellRun, G = R.G; let n = 0; while (G.state !== 'over' && n < 60 * 600) { R.step(1 / 60); n++; } R.draw(); })()`);
    for (const s of SCREENS) {
      await page.eval(s.setup);
      const m = await page.eval(MEASURE_SCREEN(s.buttons));
      assert.ok(m, s.name + ' 카드가 있다');
      assert.ok(m.overflow <= 1, `${w}x${h} ${s.name}: 카드 넘침 ${m.overflow}px (스크롤 없이 들어와야 한다)`);
      assert.deepEqual(m.hidden, [], `${w}x${h} ${s.name}: 가려진 버튼 ${m.hidden}`);
      assert.ok(m.inBox, `${w}x${h} ${s.name}: 판 안`);
      assert.equal(m.overlap, 0, `${w}x${h} ${s.name}: 버튼끼리 겹침`);
      assert.ok(m.minBtn >= 43.5, `${w}x${h} ${s.name}: 버튼 최소 ${m.minBtn}px >= 44`);
      // 카드가 위쪽 단추([닫기]·[세로로])와 겹치지 않는다
      const ov = await page.eval(`(() => { const c = document.querySelector('.sr-box .screen:not([hidden]) .card').getBoundingClientRect(), t = document.getElementById('srCtl').getBoundingClientRect(); return c.top < t.bottom - 0.5 && t.top < c.bottom && c.left < t.right && t.left < c.right; })()`);
      assert.equal(ov, false, `${w}x${h} ${s.name}: 위쪽 단추와 겹침`);
    }
    // 게임 방법·방 목록처럼 내용이 많은 곳은 영역 안 스크롤만 허용한다(카드 자체는 넘치지 않는다)
    noErr(page); await page.close();
  });
}

// 달리는 중 측정. 새 단어 연출이 끝난 뒤(9초)의 위치. 판 풀(pool)을 직접 넘겨 단어와 뜻을 정한다.
const POOL = (word, meaning, subs) => ({ word, meaning, hint: { meaning, subs: subs || [] }, pop: { pron: '', meaning, example: '', ranges: [] } });
const LONG_MEAN = '매우 비범하고 특별하여 평범한 수준을 크게 뛰어넘는다는 뜻의 형용사';
const START = pool => `(() => { const R = SpellRun; R.manual = true; R.startRound(false, { surv: false, supply: null, pool: ${JSON.stringify(pool)}, regular: ${pool.length} }); R.manual = true; })()`;
const RUNMEASURE = `(() => {
  const R = SpellRun, bx = document.getElementById('box'), b = bx.getBoundingClientRect(), u = parseFloat(bx.style.getPropertyValue('--u'));
  const rc = id => { const e = typeof id === 'string' ? document.getElementById(id) : id; if (!e || e.hidden || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: (r.left - b.left) / u, t: (r.top - b.top) / u, r: (r.right - b.left) / u, b: (r.bottom - b.top) / u }; };
  const cell = document.querySelector('#word .cell:not(.fixed)'), mean = document.getElementById('meaning'), lay = R.view.layout();
  const lines = Math.round(mean.getBoundingClientRect().height / (parseFloat(getComputedStyle(mean).lineHeight) || 1));
  return { u, lay, hearts: rc('hearts'), score: rc(document.querySelector('.scorebox')), progress: rc('progress'), speed: rc('speedTag'), snd: rc('snd'), ctl: rc('srCtl'), hint: rc('hintbox'), meaning: rc('meaning'), sub: rc('sub'), word: rc('word'),
    meanPx: parseFloat(getComputedStyle(mean).fontSize), meanLines: lines, cellPx: cell ? cell.getBoundingClientRect().width : 0, tilePx: 58 * u };
})()`;
const stepN = (page, n) => page.eval(`(() => { const R = SpellRun; for (let i = 0; i < ${n}; i++) R.step(1 / 60); R.draw(); })()`);

for (const [w, h] of LAND) {
  test(`356-3) 가로 ${w}x${h} 달리는 중: 뜻(왼쪽)과 글자 칸(오른쪽)이 한 줄, 글자 영역 아래 끝 100 이하(높은 칸 윗변 위), HUD·위쪽 단추와 겹침 없음`, { skip: SKIP }, async () => {
    const page = await open(w, h);
    for (const [word, mean, subs] of [['book', '책', ['다른 뜻']], ['environment', LONG_MEAN, ['주변', '환경', '자연환경']]]) {
      await page.eval(START([POOL(word, mean, subs), POOL('apple', '사과'), POOL('water', '물')]));
      await stepN(page, 60 * 9);
      const m = await page.eval(RUNMEASURE);
      const items = { hearts: m.hearts, progress: m.progress, speed: m.speed, score: m.score, snd: m.snd, ctl: m.ctl, hint: m.hint, word: m.word };
      const names = Object.keys(items).filter(k => items[k]);
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert.ok(!hit(items[names[i]], items[names[j]]), `${word}: ${names[i]} 와 ${names[j]} 가 겹친다 ${JSON.stringify(items[names[i]])} ${JSON.stringify(items[names[j]])}`);
      assert.ok(m.meaning.t < m.word.b && m.word.t < m.meaning.b, `${word}: 뜻과 글자 칸이 같은 줄(세로 범위가 겹친다) 뜻 ${m.meaning.t.toFixed(0)}~${m.meaning.b.toFixed(0)} 글자 ${m.word.t.toFixed(0)}~${m.word.b.toFixed(0)}`);
      assert.ok(m.hint.r <= m.word.l + 0.5, `${word}: 뜻이 왼쪽, 글자 칸이 오른쪽`);
      const bottom = Math.max(m.hint.b, m.word.b), highTop = m.lay.HIGH_Y - 29;
      assert.ok(bottom <= 100.5, `${word}: 글자 영역 아래 끝 ${bottom.toFixed(1)} <= 100`);
      assert.ok(bottom + 5 <= highTop, `${word}: 높은 칸 타일 윗변 ${highTop} 보다 위`);
      assert.ok(m.hint.l >= 0 && m.word.r <= 800 && m.hint.t >= 0, '판 안');
      console.log(['[측정]', `가로 ${w}x${h}`, word === 'book' ? '짧은 단어' : '긴 단어', `배율 ${m.u.toFixed(2)}`, `뜻 ${m.meanPx.toFixed(1)}px(${m.meanLines}줄)`, `글자 칸 ${m.cellPx.toFixed(1)}px`].join(' | '));
      if (word === 'book' && w === 844) { assert.ok(m.meanPx >= 24, `844x390 짧은 뜻 ${m.meanPx.toFixed(1)}px >= 24`); assert.ok(m.cellPx >= 34, `844x390 글자 칸 ${m.cellPx.toFixed(1)}px >= 34`); }
      assert.ok(m.meanPx >= 12 * m.u - 0.5 && m.cellPx > 0);
    }
    noErr(page); await page.close();
  });
}

test('356-3) 세로 390x844 글자 크기(비교용 측정)', { skip: SKIP }, async () => {
  const page = await open(390, 844, '?mode=0');
  for (const [word, mean, subs] of [['book', '책', ['다른 뜻']], ['environment', LONG_MEAN, ['주변', '환경', '자연환경']]]) {
    await page.eval(START([POOL(word, mean, subs), POOL('apple', '사과'), POOL('water', '물')]));
    await stepN(page, 60 * 9);
    const m = await page.eval(RUNMEASURE);
    console.log(['[측정]', '세로 390x844', word === 'book' ? '짧은 단어' : '긴 단어', `배율 ${m.u.toFixed(2)}`, `뜻 ${m.meanPx.toFixed(1)}px(${m.meanLines}줄)`, `글자 칸 ${m.cellPx.toFixed(1)}px`].join(' | '));
  }
  noErr(page); await page.close();
});

for (const [w, h] of LAND) {
  test(`356-3) 가로 ${w}x${h}: 완성 단어 카드·보스 배너·큰 뜻 연출이 펭귄과 일반 타일 줄을 가리지 않는 경기장 가운데 위쪽에 있다`, { skip: SKIP }, async () => {
    const page = await open(w, h);
    const laneTop = 248 - 29;   // 일반 타일 줄 윗변
    await page.eval('SpellRun.CONFIG.DJ_ENABLED = false; SpellRun.CONFIG.OBST_ENABLED = false');   // 단순 봇이 한 판을 끝낼 수 있게(높은 칸·장애물 없음). 판을 시작하기 전에 꺼야 칸 계획에 반영된다
    await page.eval(START([POOL('book', '책', ['다른 뜻']), POOL('apple', '사과'), POOL('water', '물')]));
    // 큰 뜻 연출(hold): 뜻 묶음이 판 가운데 위쪽, 높은 칸 윗변 위
    await stepN(page, 30);
    let m = await page.eval(RUNMEASURE);
    const cx = (m.hint.l + m.hint.r) / 2, cy = (m.hint.t + m.hint.b) / 2;
    assert.ok(Math.abs(cx - 400) <= 3, `큰 뜻이 가운데(x ${cx.toFixed(1)})`); assert.ok(cy <= 112 - 5 && m.hint.t >= 0, `큰 뜻이 위쪽(y ${cy.toFixed(1)}), 높은 칸 윗변 112 위`);
    // 완성 단어 카드: 정답을 먹어 단어를 끝낸다
    const done = await page.eval(`(async () => { const R = SpellRun, G = R.G, C = R.CONFIG; const T = C.JUMP_TIME; let n = 0;
      while (G.state !== 'pop' && n < 60 * 200) { if (G.state === 'run') { const tg = G.tiles.filter(x => x.state === 'live' && !x.checked && x.correct && x.wi === G.wi && x.si === G.si && x.x > R.RUNNER_X).sort((a, b) => a.x - b.x)[0]; if (tg && G.jumpT < 0 && (tg.x - R.RUNNER_X) / G.speed <= T / 2) R.jump(); if (G.jumpT < 0) { const ob = G.obstacles.find(x => !x.hit && x.x + x.w / 2 > R.RUNNER_X); if (ob && (ob.x + ob.w / 2 - R.RUNNER_X) / G.speed <= T / 2) R.jump(); } } R.step(1 / 60); n++; }
      return G.state; })()`);
    assert.equal(done, 'pop', '단어를 끝내 팝업까지 간다(상태 ' + done + ')');
    await sleep(700);   // 등장 애니메이션이 끝날 때까지(실시간)
    const pop = await page.eval(`(() => { const bx = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')); const r = document.getElementById('pop').getBoundingClientRect(); return { l: (r.left - bx.left) / u, t: (r.top - bx.top) / u, r: (r.right - bx.left) / u, b: (r.bottom - bx.top) / u, hidden: document.getElementById('pop').hidden }; })()`);
    assert.equal(pop.hidden, false);
    assert.ok(pop.t >= 100 && pop.b <= laneTop - 4, `팝업 ${pop.t.toFixed(0)}~${pop.b.toFixed(0)} 가 글자 영역(100) 아래, 일반 타일 줄(${laneTop}) 위`);
    assert.ok(pop.l >= 118 && pop.r <= 800, `팝업 가로 ${pop.l.toFixed(0)}~${pop.r.toFixed(0)}: 펭귄(x 72 ± 46)을 가리지 않는다`);
    // 보스 배너
    const ban = await page.eval(`(() => { const e = document.getElementById('bossBanner'); e.hidden = false; const bx = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u')); document.getElementById('bossSub').textContent = '긴 단어에 도전! 체력 +1'; const r = e.getBoundingClientRect(); e.hidden = true; return { t: (r.top - bx.top) / u, b: (r.bottom - bx.top) / u }; })()`);
    assert.ok(ban.t >= 100 && ban.b <= laneTop - 4, `보스 배너 ${ban.t.toFixed(0)}~${ban.b.toFixed(0)}: 글자 영역 아래, 일반 타일 줄 위`);
    noErr(page); await page.close();
  });
}
