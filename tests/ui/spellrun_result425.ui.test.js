// 작업425: 스펠링 런 결과 화면(기본 모드) 별·점수 올라가는 연출·신기록. 헤드리스 Chrome.
// 자체 임시 서버에 모의 /api/me·/api/wordbook 만 둔다 — 실제 서버·운영 서버와 무관.
// 실행: node --test tests/ui/spellrun_result425.ui.test.js   (Chrome이 없으면 건너뜀)
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
const EN = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'garden', 'planet', 'river', 'cloud', 'bridge'];
const MEAN = ['사과', '책', '물, 수분', '행복한, 기쁜', '창문, 창구', '음악, 곡조', '친구, 동료', '정원, 뜰', '행성, 지구', '강, 하천', '구름, 먹구름', '다리, 교량'];
const rows = EN.map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: MEAN[i] } }));

let srv, base, browser;
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      if (u === '/api/me') return json(200, { id: 7, role: 'user', can_wordbook: true, perm_versus: false });
      if (u === '/api/wordbook') return json(200, rows);
      return json(404, { ok: false });
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

// 게임 페이지를 연다. best 가 있으면 localStorage spellrun_best 로 미리 넣는다(없으면 비운다). surv 면 생존 모드, reduce 면 움직임 줄이기
async function openGame({ width = 390, height = 844, query = '', best = null, surv = false, reduce = false, breakStorage = false } = {}) {
  const page = await browser.newPage({ width, height, token: jwt() });
  if (reduce) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__i')) { sessionStorage.setItem('__i', '1'); localStorage.removeItem('spellrun_best'); localStorage.setItem('spellrun_preview', '0'); localStorage.setItem('spellrun_mode', ${JSON.stringify(surv ? 'survival' : 'normal')}); ${best !== null ? `localStorage.setItem('spellrun_best', ${JSON.stringify(typeof best === 'string' ? best : JSON.stringify(best))});` : ''} } sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(rows.map(r => r.id)))}); } catch (e) {}
    ${breakStorage ? `const si = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'spellrun_best') throw new Error('quota'); return si.call(this, k, v); };` : ''}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('startBtn').disabled", 8000);
  await page.eval('SpellRun.manual = true');
  return page;
}
// 판을 곧바로 끝낸다: total 단어 중 done 개를 풀었고 그중 first 개는 한 번에 완성, 점수 score. review 면 복습 판처럼
async function endRound(page, { total = 10, done = 10, first = 10, score = 1840, review = false } = {}) {
  await page.eval(`SpellRun.startRound(${review})`);
  await page.eval(`(() => { const G = SpellRun.G, EN = ${JSON.stringify(EN)}, T = ${total}, D = ${done}, F = ${first};
    if (!G.survival) { G.words = Array.from({ length: T }, (_, i) => ({ word: EN[i % EN.length] + (i >= EN.length ? i : ''), meaning: '뜻' + i })); G.mist = G.words.map((x, i) => (i < D && i >= F ? 1 : 0)); }
    else { G.words = Array.from({ length: D + 1 }, (_, i) => ({ word: EN[i % EN.length], meaning: '뜻' + i })); G.mist = G.words.map((x, i) => (i < D && i >= F ? 1 : 0)); }
    G.review = ${review}; G.wordsDone = D; G.wi = D; G.score = ${score}; G.maxCombo = 4; G.state = 'ending'; G.endT = 0; SpellRun.step(0.1); })()`);
}
const view = page => page.eval(`(() => { const $ = id => document.getElementById(id); return { shown: !$('result').hidden, stars: $('resStars').hidden ? -1 : document.querySelectorAll('#resStars .star.on').length, starCount: document.querySelectorAll('#resStars .star').length, aria: $('resStars').getAttribute('aria-label'),
  bestRowHidden: $('resBestRow').hidden, best: $('resBest').textContent, newShown: !$('resNew').hidden, newText: $('resNew').textContent, score: $('resScore').textContent, go: document.querySelectorAll('#resStars .star.go').length, store: localStorage.getItem('spellrun_best') }; })()`);
const wait = ms => new Promise(r => setTimeout(r, ms));

test('425 별: 모두 한 번에 80%↑ 3개, 모두 완성 2개, 절반 이상 1개, 절반 미만 0개이고 별은 3칸 SVG(이모지 없음), 낭독용 문구가 있다', { skip: SKIP }, async () => {
  for (const [args, want] of [[{ total: 10, done: 10, first: 8 }, 3], [{ total: 10, done: 10, first: 7 }, 2], [{ total: 10, done: 5, first: 5 }, 1], [{ total: 10, done: 4, first: 4 }, 0]]) {
    const page = await openGame({ reduce: true });
    await endRound(page, args);
    const v = await view(page);
    assert.equal(v.shown, true); assert.equal(v.starCount, 3); assert.equal(v.stars, want, JSON.stringify(args)); assert.equal(v.aria, '별 3개 중 ' + want + '개');
    assert.equal(await page.eval("document.querySelectorAll('#resStars svg').length === 3 && !/[\\u2600-\\u27BF\\u{1F300}-\\u{1FAFF}]/u.test(document.getElementById('resStars').textContent)"), true, '이모지·글자 없이 SVG 만');
    await page.close();
  }
});

test('425 신기록: 첫 기록은 저장만(표시 없음), 다음 판 더 높으면 "신기록!"+이전 기록, 낮거나 같으면 "최고 기록"만, 기록은 키별로 저장된다', { skip: SKIP }, async () => {
  let page = await openGame({ reduce: true });
  await endRound(page, { score: 1000 });
  let v = await view(page);
  assert.equal(v.bestRowHidden, true, '첫 기록은 표시 없음'); assert.equal(v.newShown, false); assert.deepEqual(JSON.parse(v.store), { 'basic|p|10': 1000 }, '저장은 된다');
  await page.close();
  page = await openGame({ reduce: true, best: { 'basic|p|10': 1000 } });
  await endRound(page, { score: 1500 });
  v = await view(page);
  assert.equal(v.newShown, true); assert.equal(v.newText, '신기록!'); assert.equal(v.bestRowHidden, false); assert.equal(v.best, '이전 기록 1,000점'); assert.equal(JSON.parse(v.store)['basic|p|10'], 1500);
  await page.close();
  page = await openGame({ reduce: true, best: { 'basic|p|10': 2000 } });
  await endRound(page, { score: 1500 });
  v = await view(page);
  assert.equal(v.newShown, false); assert.equal(v.best, '최고 기록 2,000점'); assert.equal(JSON.parse(v.store)['basic|p|10'], 2000, '낮은 점수는 기록을 낮추지 않는다');
  await page.close();
  page = await openGame({ reduce: true, best: { 'basic|p|10': 2000 } });
  await endRound(page, { total: 7, done: 7, first: 7, score: 100 });
  v = await view(page);
  assert.equal(v.bestRowHidden, true, '단어 수가 다르면 다른 기록(비교 안 함)'); assert.deepEqual(JSON.parse(v.store), { 'basic|p|10': 2000, 'basic|p|7': 100 });
  await page.close();
  page = await openGame({ reduce: true, best: { 'basic|p|10': 2000 }, width: 800, height: 400, query: '?mode=1' });
  await endRound(page, { score: 100 });
  v = await view(page);
  assert.equal(v.bestRowHidden, true, '가로 기록은 세로 기록과 별개'); assert.ok(JSON.parse(v.store)['basic|l|10'] === 100);
  await page.close();
});

test('425 복습 판: 별만 보이고 신기록·최고 기록은 표시도 저장도 하지 않는다', { skip: SKIP }, async () => {
  const page = await openGame({ reduce: true, best: { 'basic|p|10': 500 } });
  await endRound(page, { total: 10, done: 10, first: 10, score: 9000, review: true });
  const v = await view(page);
  assert.equal(v.stars, 3); assert.equal(v.bestRowHidden, true); assert.equal(v.newShown, false); assert.deepEqual(JSON.parse(v.store), { 'basic|p|10': 500 }, '기록 그대로');
  await page.close();
});

test('425 생존 결과: 별·최고 기록·신기록 요소가 보이지 않고 기록을 저장하지 않는다. 기존 id 는 그대로', { skip: SKIP }, async () => {
  const page = await openGame({ surv: true });
  await endRound(page, { done: 8, first: 5, score: 3000 });
  const v = await view(page);
  assert.equal(v.shown, true); assert.equal(v.stars, -1, '별 숨김'); assert.equal(v.bestRowHidden, true); assert.equal(v.newShown, false); assert.equal(v.store, null, '생존은 저장 없음');
  assert.equal(await page.eval("['resTitle','resScore','resDone','resCombo','resChips','revBtn','againBtn','resTime'].every(id => !!document.getElementById(id))"), true);
  assert.equal(await page.eval("document.getElementById('resScore').textContent"), '3,000', '생존 점수는 연출 없이 바로');
  await page.close();
});

test('425 연출: 점수가 0에서 올라가 최종 값에 닿고 별이 하나씩 커진다. 카드를 누르면 즉시 끝나고 버튼은 연출 중에도 눌린다', { skip: SKIP }, async () => {
  let page = await openGame();
  await endRound(page, { score: 1840 });
  const t0 = await page.eval(`(() => ({ score: document.getElementById('resScore').textContent, go: document.querySelectorAll('#resStars .star.go').length, delays: [...document.querySelectorAll('#resStars .star.go')].map(e => getComputedStyle(e).animationDelay) }))()`);
  assert.ok(t0.score === '0' || Number(t0.score.replace(/,/g, '')) < 1840, '연출 시작: 아직 최종 값이 아니다 ' + t0.score);
  assert.equal(t0.go, 3, '별 3개에 연출'); assert.deepEqual(t0.delays, ['0s', '0.25s', '0.5s'], '0.25초 간격');
  await wait(1300);
  const t1 = await view(page);
  assert.equal(t1.score, '1,840', '약 0.8초 뒤 최종 값'); assert.equal(t1.go, 0, '연출 끝나면 클래스 제거');
  await page.close();
  page = await openGame();
  await endRound(page, { score: 1840 });
  await page.eval("document.querySelector('#result .card').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
  const t2 = await view(page);
  assert.equal(t2.score, '1,840', '카드를 누르면 즉시 최종 값'); assert.equal(t2.go, 0);
  await page.close();
  page = await openGame();
  await endRound(page, { score: 1840 });
  assert.equal(await page.eval("(() => { let n = 0; document.getElementById('againBtn').addEventListener('click', () => { n++; }, { once: true }); document.getElementById('againBtn').click(); return n; })()"), 1, '연출 중에도 버튼 클릭이 먹는다');
  await page.close();
});

test('425 움직임 줄이기: 연출 없이 처음부터 최종 상태(점수·별)', { skip: SKIP }, async () => {
  const page = await openGame({ reduce: true });
  await endRound(page, { score: 1840 });
  const v = await view(page);
  assert.equal(v.score, '1,840'); assert.equal(v.go, 0); assert.equal(v.stars, 3);
  await page.close();
});

test('425 저장소가 막혀도(읽기·쓰기 예외, 깨진 값) 결과 화면은 정상 표시된다', { skip: SKIP }, async () => {
  let page = await openGame({ reduce: true, breakStorage: true, best: { 'basic|p|10': 100 } });
  await endRound(page, { score: 500 });
  let v = await view(page);
  assert.equal(v.shown, true); assert.equal(v.stars, 3); assert.equal(v.score, '500'); assert.equal(v.newShown, true, '읽기는 되고 쓰기만 실패: 표시는 정상');
  await page.close();
  page = await openGame({ reduce: true, best: '{깨진 json' });
  await endRound(page, { score: 700 });
  v = await view(page);
  assert.equal(v.shown, true); assert.equal(v.bestRowHidden, true, '깨진 값은 무시하고 첫 기록처럼'); assert.deepEqual(JSON.parse(v.store), { 'basic|p|10': 700 });
  await page.close();
});

test('425 글자 크기: 점수가 이 화면에서 가장 큰 글자(제목 이상)이고 99,999 도 카드 폭 안에 한 줄로 들어간다', { skip: SKIP }, async () => {
  for (const [w, h, q] of [[360, 640, ''], [390, 844, ''], [800, 400, '?mode=1'], [640, 360, '?mode=1'], [844, 390, '?mode=1']]) {
    const page = await openGame({ width: w, height: h, query: q, reduce: true, best: { [`basic|${q ? 'l' : 'p'}|10`]: 1000 } });
    await endRound(page, { score: 99999 });
    const m = await page.eval(`(() => { const $ = id => document.getElementById(id), fs = e => parseFloat(getComputedStyle(e).fontSize), sc = $('resScore'), card = document.querySelector('#result .card').getBoundingClientRect(), r = sc.getBoundingClientRect();
      const others = [...document.querySelectorAll('#result .card *')].filter(e => e !== sc && e.id !== 'resTitle' && e.getClientRects().length && !e.closest('svg') && e.tagName !== 'svg').map(fs);
      return { score: fs(sc), title: fs($('resTitle')), maxOther: Math.max(...others), fits: sc.scrollWidth <= sc.clientWidth + 1, inCard: r.left >= card.left && r.right <= card.right, oneLine: r.height < fs(sc) * 1.6, text: sc.textContent }; })()`);
    const tag = `${w}x${h} ${JSON.stringify(m)}`;
    assert.equal(m.text, '99,999'); assert.ok(m.fits && m.inCard && m.oneLine, '카드 폭 안에 한 줄: ' + tag);
    assert.ok(m.score >= m.title && m.score > m.maxOther, '점수가 가장 큰 글자: ' + tag);
    assert.ok(m.score >= 36, '이전 20px 보다 크게: ' + tag);
    await page.close();
  }
});

test('425 배치: 3단어·10단어(신기록 줄 포함)가 세로 360x640·390x844와 가로 800x400·640x360·844x390 모두 스크롤 없이 들어가고 [새 판 시작]이 카드 안에 있다', { skip: SKIP }, async () => {
  for (const [w, h, q] of [[360, 640, ''], [390, 844, ''], [800, 400, '?mode=1'], [640, 360, '?mode=1'], [844, 390, '?mode=1']]) {
    for (const total of [3, 10]) {
      const page = await openGame({ width: w, height: h, query: q, reduce: true, best: { [`basic|${q ? 'l' : 'p'}|${total}`]: 100 } });
      await endRound(page, { total, done: total, first: total, score: 1840 });
      const m = await page.eval(`(() => { const card = document.querySelector('#result .card'), b = document.getElementById('againBtn').getBoundingClientRect(), c = card.getBoundingClientRect(), box = document.querySelector('.sr-box').getBoundingClientRect(), tt = document.getElementById('resStars').getBoundingClientRect(), s = document.getElementById('resScore').getBoundingClientRect(), best = document.getElementById('resBestRow').getBoundingClientRect(), st = document.querySelector('#result .stats').getBoundingClientRect();
        return { scroll: card.scrollHeight > card.clientHeight, inBox: b.bottom <= box.bottom && c.bottom <= box.bottom + 1 && c.top >= box.top - 1, btnIn: b.bottom <= c.bottom + 1, btnH: b.height, order: tt.bottom <= s.top + 1 && s.bottom <= best.top + 1 && best.bottom <= st.top + 1, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
      assert.equal(m.scroll, false, `${w}x${h} ${total}단어 스크롤 없음 ` + JSON.stringify(m)); assert.ok(m.inBox && m.btnIn, `${w}x${h} ${total} 단추가 카드 안`); assert.ok(m.order, `${w}x${h} 별→점수→기록→통계 순서·겹침 없음`);
      assert.ok(m.btnH >= 44, '단추 44px 이상'); assert.ok(m.docX <= 0);
      await page.close();
    }
  }
});
