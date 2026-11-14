// 작업431: 스펠링 런 결과 화면 정리 — 한 줄 행 목록·그룹 제목·버튼 항상 보임·카드 스크롤 없음. 실제 데이터형(뜻이 긴 단어 포함) 자료. 헤드리스 Chrome.
// 자체 임시 서버에 모의 /api/me·/api/wordbook·/api/tts 만 둔다 — 실제 서버·OpenAI·운영 DB 와 무관.
// 실행: node --test tests/ui/spellrun_result431.ui.test.js   (Chrome이 없으면 건너뜀)
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
const WAV = (() => { const n = 800, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })();
// 실제 데이터형: 뜻이 한 줄을 넘는 단어 포함
const W = [['wordmark', '글자로만 만드는 로고, 컴퓨터 메모리의 참조 지점'], ['eligibility', '자격, 법적 요건 충족, 참여 자격'], ['envision', '마음속에 그리다, 앞으로 일어날 것으로 생각하다'], ['apple', '사과'], ['environment', '환경, 주변, 둘러싼 조건'], ['happy', '행복한, 기쁜'], ['bridge', '다리, 교량'], ['scrutinize', '신중하게 검토하다, 자세히 살피다'], ['garden', '정원, 뜰'], ['accomplishment', '성취, 업적, 완수한 일'],
  ['planet', '행성, 지구'], ['castle', '성, 요새'], ['dragon', '용, 사나운 사람'], ['forest', '숲, 삼림'], ['island', '섬, 고립된 곳'], ['jungle', '정글, 밀림']];
const rows = W.map((w, i) => ({ id: i + 1, word: w[0], lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w[0], lang: 'en', short_meaning: w[1] } }));
const SIZES = [[360, 640, ''], [390, 844, ''], [320, 568, ''], [800, 400, '?mode=1'], [640, 360, '?mode=1'], [844, 390, '?mode=1']];

let srv, base, browser, tts = [];
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const ch = []; req.on('data', d => ch.push(d));
      req.on('end', () => {
        if (u === '/api/me') return json(200, { id: 7, role: 'user', can_wordbook: true, perm_versus: false });
        if (u === '/api/wordbook') return json(200, rows);
        if (u === '/api/tts') { try { tts.push(JSON.parse(Buffer.concat(ch).toString()).text); } catch (e) { /* 무시 */ } res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(WAV); }
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

async function openGame({ width = 390, height = 844, query = '', best = null, surv = false } = {}) {
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', '1'); localStorage.removeItem('spellrun_best'); localStorage.setItem('spellrun_preview', '0'); localStorage.setItem('spellrun_bgm', '0'); localStorage.setItem('spellrun_mode', ${JSON.stringify(surv ? 'survival' : 'normal')}); ${best !== null ? `localStorage.setItem('spellrun_best', ${JSON.stringify(JSON.stringify(best))});` : ''} } sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(rows.map(r => r.id)))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.eval('SpellRun.manual = true; SpellRun.CONFIG.CONT_ENABLED = false;');
  return page;
}
// total 단어, done 개를 풀었고 slips 인덱스는 실수 후 완성(done 번째 단어는 미완성), bosses 인덱스는 보스
async function endRound(page, { total = 10, done = 9, slips = [1, 4], bosses = [4, 9], score = 1840 } = {}) {
  await page.eval('SpellRun.startRound(false)');
  await page.eval(`(() => { const G = SpellRun.G, W = ${JSON.stringify(W)}, T = ${total}, D = ${done}, S = ${JSON.stringify(slips)}, B = ${JSON.stringify(bosses)};
    G.words = Array.from({ length: T }, (_, i) => Object.assign({ word: W[i % W.length][0], meaning: W[i % W.length][1] }, B.includes(i) ? { boss: true } : {}));
    G.mist = G.words.map((x, i) => (S.includes(i) ? 1 : 0)); G.wordsDone = D; G.wi = D; G.score = ${score}; G.maxCombo = 7; G.time = 72; G.startTime = 0; G.state = 'ending'; G.endT = 0; SpellRun.step(0.1); })()`);
}
const M = page => page.eval(`(() => { const $ = id => document.getElementById(id), card = document.querySelector('#result .card'), cr = card.getBoundingClientRect(), box = document.querySelector('.sr-box').getBoundingClientRect(), list = $('resChips'), lr = list.getBoundingClientRect(), rows = [...list.querySelectorAll('.chip')];
  const inside = e => { const r = e.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.left >= cr.left - 1 && r.right <= cr.right + 1; };
  return { cardScroll: card.scrollHeight > card.clientHeight + 1, listScroll: list.scrollHeight > list.clientHeight + 1, rows: rows.length, rowMin: Math.min(...rows.map(e => e.getBoundingClientRect().height)), fontMin: Math.min(...[...card.querySelectorAll('*')].filter(e => e.getClientRects().length && !e.closest('svg') && e.tagName !== 'svg' && e.textContent.trim() && e.children.length === 0).map(e => parseFloat(getComputedStyle(e).fontSize))),
    revIn: inside($('revBtn')), againIn: inside($('againBtn')), revH: $('revBtn').getBoundingClientRect().height, againH: $('againBtn').getBoundingClientRect().height, rowsCut: rows.filter(e => { const r = e.getBoundingClientRect(); return r.top < lr.top - 1 || r.bottom > lr.bottom + 1; }).length,
    groups: [...list.querySelectorAll('.rgrp')].map(e => e.firstChild.textContent), legend: !!document.querySelector('#result .legend'), docX: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);

for (const [w, h, q] of SIZES) {
  test(`431 ${w}x${h}: 10단어 긴 뜻 혼합·모두 틀림·3단어·생존 — 카드 스크롤 없음, 버튼 2개가 카드·화면 안에 완전히 보임(44px 이상), 행 32px 이상, 글자 11px 이상, 범례 없음`, { skip: SKIP, timeout: 60000 }, async () => {
    const land = !!q, v = land ? 'l' : 'p';
    const cases = [['혼합10', {}, { total: 10, done: 9, slips: [1, 4], bosses: [4, 9] }], ['모두틀림10', {}, { total: 10, done: 9, slips: [0, 1, 2, 3, 4, 5, 6, 7, 8], bosses: [4, 9] }], ['3단어', { best: { [`basic|${v}|3`]: 500 } }, { total: 3, done: 3, slips: [], bosses: [] }], ['생존', { surv: true }, { total: 16, done: 15, slips: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], bosses: [] }]];
    for (const [name, open, args] of cases) {
      const page = await openGame(Object.assign({ width: w, height: h, query: q }, open));
      await endRound(page, args);
      const m = await M(page);
      const tag = `${w}x${h} ${name} ` + JSON.stringify(m);
      assert.equal(m.cardScroll, false, '카드 전체 스크롤 없음: ' + tag);
      assert.ok(m.revIn && m.againIn, '버튼 2개가 카드·화면 안: ' + tag);
      assert.ok(m.revH >= 43.5 && m.againH >= 43.5, '버튼 높이 44px 이상: ' + tag);
      assert.ok(m.rowMin >= 31.5, '행 높이 32px 이상: ' + tag);
      assert.ok(m.fontMin >= 10.95, '글자 11px 이상: ' + tag);
      assert.equal(m.legend, false, '범례 없음'); assert.ok(m.docX <= 0, '가로 스크롤 없음');
      if (!m.listScroll) assert.equal(m.rowsCut, 0, '목록이 스크롤이 아니면 잘린 행 없음: ' + tag);
      // 한 화면에 다 들어가야 하는 경우: 세로 360·390 의 모든 자료, 3단어는 모든 크기
      if ((!land && w >= 360) || name === '3단어') assert.equal(m.listScroll, false, '목록 스크롤 없음(한 화면에 다 들어감): ' + tag);
      await page.close();
    }
  });
}

test('431 그룹 제목: 틀린 단어 N(실수 후·미완성) 위, 잘한 단어 N 아래, 도전 안 함 N 맨 아래. 해당 단어가 있을 때만. 다시 도전 개수는 틀린 단어 수', { skip: SKIP }, async () => {
  let page = await openGame();
  await endRound(page, { total: 10, done: 9, slips: [1, 4] });
  let m = await M(page);
  assert.deepEqual(m.groups, ['틀린 단어 3', '잘한 단어 7']); assert.equal(m.rows, 10);
  assert.equal(await page.eval("document.getElementById('revBtn').textContent"), '틀린 단어만 다시 도전 (3)');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#resChips .chip')].slice(0, 3).map(e => e.className.replace(' boss', ''))"), ['chip slip', 'chip slip', 'chip fail'], '틀린 단어(실수 후 → 미완성) 먼저');
  await page.close();
  page = await openGame();
  await endRound(page, { total: 10, done: 5, slips: [1], bosses: [4, 9] });
  m = await M(page);
  assert.deepEqual(m.groups, ['틀린 단어 2', '잘한 단어 4', '도전 안 함 4'], '실수 후 1 + 미완성 1 / 한 번에 4 / 도전 안 함 4');
  assert.equal(await page.eval("document.getElementById('revBtn').textContent"), '틀린 단어만 다시 도전 (2)', '도전 안 함은 다시 도전 개수에 들어가지 않는다');
  await page.close();
  page = await openGame({ best: { 'basic|p|3': 100 } });
  await endRound(page, { total: 3, done: 3, slips: [], bosses: [] });
  m = await M(page);
  assert.deepEqual(m.groups, ['잘한 단어 3'], '틀린 단어 제목은 없다');
  assert.equal(await page.eval("document.getElementById('revBtn').disabled"), true, '틀린 단어가 없으면 다시 도전은 꺼짐(기존 동작)');
  assert.equal(await page.eval("document.getElementById('revBtn').textContent"), '틀린 단어 없음');
  await page.close();
});

test('431 모든 단어의 뜻이 DOM 에 있고(한 줄에 안 들어가면 …), 보스 표식은 단어 옆, 상태 색 점, 모서리 10px 이하·테두리 얇음', { skip: SKIP }, async () => {
  const page = await openGame({ width: 360, height: 640 });
  await endRound(page, { total: 10, done: 9, slips: [1, 4], bosses: [4, 9] });
  const d = await page.eval(`(() => [...document.querySelectorAll('#resChips .chip')].map(e => { const i = e.querySelector('i'), cs = getComputedStyle(e), dot = getComputedStyle(e, '::before'); return { word: e.dataset.word, mean: i.textContent, trunc: i.scrollWidth > i.clientWidth + 1, ell: getComputedStyle(i).textOverflow, boss: !!e.querySelector('em'), bossText: e.querySelector('em') ? e.querySelector('em').textContent : '', radius: cs.borderTopLeftRadius, bw: cs.borderTopWidth + '/' + cs.borderBottomWidth, dot: dot.backgroundColor, dotR: dot.borderRadius }; }))()`);
  const want = Object.fromEntries(W);
  assert.equal(d.length, 10);
  for (const r of d) { assert.equal(r.mean, want[r.word], '뜻 전체가 DOM 에 있다: ' + r.word); assert.equal(r.ell, 'ellipsis'); assert.ok(parseFloat(r.radius) <= 10, '모서리 10px 이하'); assert.ok(r.bw.split('/').every(x => parseFloat(x) <= 2), '테두리 얇음: ' + r.bw); assert.equal(r.dotR, '50%'); }
  assert.ok(d.some(r => r.trunc), '뜻이 긴 단어는 …로 줄어든다');
  assert.deepEqual(d.filter(r => r.boss).map(r => r.word).sort(), ['accomplishment', 'environment'], '보스 표식');
  assert.ok(d.every(r => !r.boss || r.bossText === 'BOSS'));
  const colors = new Set(d.map(r => r.dot)); assert.ok(colors.size >= 3, '상태별 점 색(한 번에·실수 후·미완성): ' + [...colors]);
  await page.close();
});

test('431 행 탭: 발음 재생(서버 발음 요청)과 함께 그 행만 뜻이 두 줄까지 펼쳐지고, 다시 탭하거나 다른 행을 탭하면 접힌다. 목록 밖 버튼 위치는 그대로', { skip: SKIP, timeout: 30000 }, async () => {
  tts.length = 0;
  const page = await openGame({ width: 360, height: 640 });
  await endRound(page, { total: 10, done: 10, slips: [], bosses: [] });
  const meas = () => page.eval(`(() => { const rows = [...document.querySelectorAll('#resChips .chip')], by = w => rows.find(e => e.dataset.word === w), a = by('wordmark').querySelector('i'), b = by('envision').querySelector('i'); const r = document.getElementById('againBtn').getBoundingClientRect(); return { openA: by('wordmark').classList.contains('open'), openB: by('envision').classList.contains('open'), hA: Math.round(a.getBoundingClientRect().height), hB: Math.round(b.getBoundingClientRect().height), n: document.querySelectorAll('#resChips .chip.open').length, btnTop: Math.round(r.top) }; })()`);
  const base0 = await meas();
  assert.equal(base0.n, 0);
  await page.eval("document.querySelector('#resChips .chip[data-word=wordmark]').click()");
  await new Promise(r => setTimeout(r, 400));
  const a = await meas();
  assert.equal(a.openA, true); assert.equal(a.n, 1, '펼친 행은 하나'); assert.ok(a.hA > base0.hA * 1.5, `뜻이 두 줄로 펼쳐짐 ${base0.hA} → ${a.hA}`); assert.equal(a.btnTop, base0.btnTop, '버튼 위치 고정');
  assert.ok(tts.includes('wordmark'), '탭하면 서버 발음 요청: ' + tts);
  await page.eval("document.querySelector('#resChips .chip[data-word=envision]').click()");
  const b = await meas();
  assert.equal(b.openA, false, '다른 행을 탭하면 앞 행이 접힌다'); assert.equal(b.openB, true); assert.equal(b.n, 1);
  await page.eval("document.querySelector('#resChips .chip[data-word=envision]').click()");
  const c = await meas();
  assert.equal(c.n, 0, '다시 탭하면 접힌다'); assert.equal(c.hB, base0.hB);
  await page.close();
});

test('431 425 요소 유지: 별 3칸·점수·최고 기록·신기록·완성한 단어·최고 콤보와 기존 id, 점수가 가장 큰 글자', { skip: SKIP }, async () => {
  const page = await openGame({ width: 360, height: 640, best: { 'basic|p|10': 1000 } });
  await endRound(page, { total: 10, done: 9, slips: [1, 4], bosses: [4, 9] });
  const v = await page.eval(`(() => { const $ = id => document.getElementById(id), fs = e => parseFloat(getComputedStyle(e).fontSize); return { ids: ['resTitle', 'resScore', 'resDone', 'resCombo', 'resChips', 'revBtn', 'againBtn', 'resStars', 'resBest', 'resNew', 'resBestRow'].every(id => !!$(id)), stars: $('resStars').querySelectorAll('.star').length, on: $('resStars').querySelectorAll('.star.on').length, hidden: $('resStars').hidden, score: $('resScore').textContent, best: $('resBest').textContent, isNew: !$('resNew').hidden, done: $('resDone').textContent, combo: $('resCombo').textContent, title: $('resTitle').textContent, sFs: fs($('resScore')), tFs: fs($('resTitle')), maxOther: Math.max(...[...document.querySelectorAll('#result .card *')].filter(e => e.id !== 'resScore' && e.id !== 'resTitle' && e.getClientRects().length && !e.closest('svg') && e.tagName !== 'svg' && e.children.length === 0 && e.textContent.trim()).map(fs)) }; })()`);
  assert.equal(v.ids, true); assert.equal(v.stars, 3); assert.equal(v.hidden, false); assert.equal(v.on, 1, '9/10 완성 = 별 1개'); assert.equal(v.score, '1,840'); assert.equal(v.isNew, true); assert.equal(v.best, '이전 기록 1,000점'); assert.equal(v.done, '9 / 10'); assert.equal(v.combo, '7'); assert.equal(v.title, '게임 오버');
  assert.ok(v.sFs > v.tFs && v.sFs > v.maxOther, '점수가 가장 큰 글자: ' + JSON.stringify(v));
  await page.close();
});

test('431 생존 결과: 같은 행 목록·그룹 제목(틀린 단어 N), "틀린 단어 N개 중 최근 8개" 안내, 생존 시간·이어하기 줄 유지, 별·최고 기록 없음', { skip: SKIP }, async () => {
  const page = await openGame({ width: 390, height: 844, surv: true });
  await endRound(page, { total: 16, done: 15, slips: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], bosses: [] });
  const v = await page.eval(`(() => { const $ = id => document.getElementById(id); return { note: $('resMissNote') && $('resMissNote').textContent, time: $('resTime') && $('resTime').textContent, rows: document.querySelectorAll('#resChips .chip').length, groups: [...document.querySelectorAll('#resChips .rgrp')].map(e => e.firstChild.textContent), stars: $('resStars').hidden, bestRow: $('resBestRow').hidden, cls: [...document.querySelectorAll('#resChips .chip')].every(e => /slip|fail/.test(e.className)), noteAbove: !!($('resMissNote').compareDocumentPosition($('resChips')) & Node.DOCUMENT_POSITION_FOLLOWING) }; })()`);
  assert.equal(v.rows, 8); assert.deepEqual(v.groups, ['틀린 단어 8']); assert.equal(v.note, '틀린 단어 14개 중 최근 8개'); assert.match(v.time, /^\d+:\d\d생존 시간$/);
  assert.equal(v.stars, true); assert.equal(v.bestRow, true); assert.equal(v.cls, true); assert.equal(v.noteAbove, true, '안내는 목록 위');
  await page.close();
});
