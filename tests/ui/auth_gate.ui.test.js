// 작업405: 화면 공통 로그인·승인 게이트 화면 시험(헤드리스 Chrome). 구조가 서로 다른 세 화면(speakloop · jgrammar · english_dictionary)에서
// 토큰 없음 / 200 / 401 / 403 approval_pending / 403 blocked / 403 기타·503·연결 오류에 대해 본문 노출, 안내 문구, [다시 확인]·[다시 시도]·[로그아웃],
// 버튼 높이 44px 이상, 이모지 없음, 허용 radius, 390/1280px 가로 스크롤 없음을 본다. 자체 임시 서버(정적 파일 + 모의 /api/me) — 운영 서버·DB 와 무관.
// 실행: node --test tests/ui/auth_gate.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
// 사전 화면은 토큰이 JWT 모양이 아니거나 만료면 스스로 지우므로(원래 동작), 시험 토큰도 만료 시각이 있는 JWT 모양으로 만든다
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const ME_OK = { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', is_blocked: false, can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true, perm_speakloop: true, perm_jgrammar: true };

// 본문이 "있음"을 확인하는 화면별 표지(게이트가 숨기는 대상)
const PAGES = [
  { name: 'speakloop', url: '/speakloop.html', body: '.screen-bar' },
  { name: 'jgrammar', url: '/jgrammar.html', body: '.screen-bar' },
  { name: 'english_dictionary', url: '/english_dictionary.html', body: 'main, .search-input, input' },
];

// 같은 Chrome 프로필의 localStorage 는 시험끼리 이어지므로, 첫 문서에서 토큰을 정확히 원하는 상태(넣기/지우기)로 만든다
const seed = (page, token) => page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); ${token ? `localStorage.setItem('mydict_token', ${JSON.stringify(token)});` : `localStorage.removeItem('mydict_token');`} } } catch (e) {}` });
let srv, base, browser;
const state = { me: null, meCalls: 0, meByTab: {}, homeHits: 0, hang: false };   // 작업418: meByTab = 탭(주소의 ?tab=) 별 /api/me 호출 수. 앞 시험의 탭이 늦게 보내는 요청이 다음 시험의 수에 섞이지 않게 한다
let tabSeq = 0;
function resetState() { Object.assign(state, { me: { status: 200, body: ME_OK }, meCalls: 0, meByTab: {}, homeHits: 0, hang: false }); }

test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u === '/api/me') {
      state.meCalls++;
      try { const t = new URL(req.headers.referer || 'http://x/').searchParams.get('tab'); if (t) state.meByTab[t] = (state.meByTab[t] || 0) + 1; } catch (e) { /* Referer 없음 */ }
      if (state.me.destroy) return req.socket.destroy();
      if (state.me.raw !== undefined) { res.writeHead(state.me.status, { 'Content-Type': 'text/html' }); return res.end(state.me.raw); }
      return json(state.me.status, state.me.body);
    }
    if (u.startsWith('/api/')) return json(404, { ok: false });
    let f = path.join(PUB, u === '/' ? 'home/index.html' : u);
    if (u === '/') state.homeHits++;
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });
test.beforeEach(resetState);

async function open(p, { token = TOKEN, width = 390 } = {}) {
  // 하니스의 token 옵션은 새 문서마다 토큰을 다시 넣어, 게이트가 지운 토큰이 홈에서 되살아난다 → 첫 문서에서만 넣는다(sessionStorage 표지)
  const page = await browser.newPage({ width, height: 844, token: null });
  await seed(page, token);
  page.tab = 't' + (++tabSeq);   // 이 탭만의 표지. 화면이 스스로 다시 불러와도 주소의 쿼리는 유지된다
  await page.send('Page.navigate', { url: base + p.url + (p.url.includes('?') ? '&' : '?') + 'tab=' + page.tab });
  return page;
}
const meOf = page => state.meByTab[page.tab] || 0;
// 이 탭의 /api/me 호출 수가 잠시 변하지 않을 때까지 기다린다(사전 화면은 게이트와 별개로 스스로도 /api/me 를 부르는데, 그 요청이 늦게 도착해 기준 수에 섞이는 것을 막는다). 고정 시간이 아니라 "수가 연속 5번 같음"이 조건
async function meSettled(page) {
  let last = -1, same = 0;
  for (let i = 0; i < 100 && same < 5; i++) { const n = meOf(page); same = n === last ? same + 1 : 0; last = n; await sleep(60); }
  return last;
}
const gateShown = page => page.exists('.metis-gate h1');
const bodyVisible = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && e.getBoundingClientRect().height > 0; })()`);
const bodyShowing = (page, sel) => page.eval(`(() => !document.documentElement.classList.contains('metis-gate-pending') && !document.querySelector('.metis-gate') && !!document.querySelector(${JSON.stringify(sel)}))()`);
const gateText = page => page.eval(`(() => ({ title: document.querySelector('.metis-gate h1').textContent, text: document.querySelector('.metis-gate p').textContent, buttons: [...document.querySelectorAll('.metis-gate button')].map(b => b.textContent) }))()`);

for (const p of PAGES) {
  test(`405-U1. ${p.name}: 토큰 없음 → 본문을 보이지 않고 홈(/)으로 이동`, { skip: SKIP }, async () => {
    const page = await open(p, { token: null });
    try {
      await page.waitFor(`location.pathname === '/'`, 8000, '홈으로 이동');
      assert.equal(meOf(page), 0, '토큰이 없으면 /api/me 를 부르지 않는다');
      assert.ok(state.homeHits >= 1);
    } finally { await page.close(); }
  });

  test(`405-U2. ${p.name}: 200 → 본문이 열리고 /api/me 는 화면당 1번만(게이트 결과 재사용)`, { skip: SKIP }, async () => {
    const page = await open(p);
    try {
      await page.waitFor(`document.readyState === 'complete' && !document.documentElement.classList.contains('metis-gate-pending')`, 8000, '게이트 통과');
      assert.ok(await bodyVisible(page, p.body.split(',')[0].trim()) || await page.exists(p.body.split(',')[0].trim()), '본문 표시');
      assert.equal(await page.exists('.metis-gate'), false);
      assert.equal(meOf(page), 1, '/api/me 호출 수');
    } finally { await page.close(); }
  });

  test(`405-U3. ${p.name}: 401 → 토큰 삭제 후 홈(/)`, { skip: SKIP }, async () => {
    state.me = { status: 401, body: { error: 'x', code: 'auth_invalid' } };
    const page = await open(p);
    try {
      await page.waitFor(`location.pathname === '/'`, 8000, '홈으로 이동');
      assert.equal(await page.eval(`localStorage.getItem('mydict_token')`), null, '토큰 삭제');
    } finally { await page.close(); }
  });

  test(`405-U4. ${p.name}: 403 approval_pending → 대기 안내(본문 숨김), [다시 확인]이 /api/me 를 다시 부르고 승인되면 본문이 열림, [로그아웃]은 토큰 삭제`, { skip: SKIP }, async () => {
    state.me = { status: 403, body: { error: 'x', code: 'approval_pending' } };
    const page = await open(p);
    try {
      await page.waitFor(`!!document.querySelector('.metis-gate h1')`, 8000, '안내 화면');
      assert.deepEqual(await gateText(page), { title: '승인을 기다리고 있습니다', text: '관리자가 승인하면 사용할 수 있습니다. 승인 후 아래 [다시 확인]을 눌러 주세요.', buttons: ['다시 확인', '로그아웃'] });
      assert.equal(await page.eval(`document.activeElement && document.activeElement.textContent`), '다시 확인', '포커스는 첫 버튼');
      assert.equal(await bodyShowing(page, p.body.split(',')[0].trim()), false, '본문 숨김');
      assert.equal(await page.eval(`document.querySelector('.metis-gate').getBoundingClientRect().height >= innerHeight - 1`), true, '화면 전체를 덮음');
      // 아직 승인 전: 다시 확인 → 같은 안내가 남는다
      const calls = await meSettled(page);
      await page.click('.metis-gate button[data-gate="recheck"]');
      await page.waitFor(`document.querySelector('.metis-gate button[data-gate="recheck"]') && !document.querySelector('.metis-gate button[data-gate="recheck"]').disabled`, 8000, '재확인 끝');
      assert.equal(meOf(page), calls + 1, '[다시 확인]이 /api/me 를 한 번 더 부름');
      assert.ok(await gateShown(page));
      // 승인됨: 다시 확인 → 화면이 다시 불러와져 본문이 열린다
      state.me = { status: 200, body: ME_OK };
      await page.click('.metis-gate button[data-gate="recheck"]');
      await page.waitFor(`document.readyState === 'complete' && !document.documentElement.classList.contains('metis-gate-pending') && !document.querySelector('.metis-gate')`, 10000, '승인 후 본문');
      assert.ok(await page.exists(p.body.split(',')[0].trim()));
    } finally { await page.close(); }
  });

  test(`405-U5. ${p.name}: 403 blocked → 차단 안내([로그아웃]만), 로그아웃은 토큰을 지우고 홈으로`, { skip: SKIP }, async () => {
    state.me = { status: 403, body: { error: 'x', code: 'blocked' } };
    const page = await open(p);
    try {
      await page.waitFor(`!!document.querySelector('.metis-gate h1')`, 8000, '안내 화면');
      assert.deepEqual(await gateText(page), { title: '이용할 수 없는 계정입니다', text: '관리자에게 문의해 주세요.', buttons: ['로그아웃'] });
      assert.equal(await bodyShowing(page, p.body.split(',')[0].trim()), false);
      await page.click('.metis-gate button[data-gate="logout"]');
      await page.waitFor(`location.pathname === '/'`, 8000, '홈으로 이동');
      assert.equal(await page.eval(`localStorage.getItem('mydict_token')`), null);
    } finally { await page.close(); }
  });

  for (const [label, me] of [['403 기타 code', { status: 403, body: { code: 'something_else' } }], ['503 auth_unavailable', { status: 503, body: { code: 'auth_unavailable' } }], ['연결 끊김', { status: 200, destroy: true }], ['해석할 수 없는 응답(HTML 200)', { status: 200, raw: '<html>x</html>' }]]) {
    test(`405-U6. ${p.name}: ${label} → "연결할 수 없습니다"(본문 열지 않음, fail-closed), [다시 시도]로 복구`, { skip: SKIP }, async () => {
      state.me = me;
      const page = await open(p);
      try {
        await page.waitFor(`!!document.querySelector('.metis-gate h1')`, 8000, '안내 화면');
        assert.deepEqual(await gateText(page), { title: '연결할 수 없습니다', text: '잠시 후 다시 시도해 주세요.', buttons: ['다시 시도', '로그아웃'] });
        assert.equal(await bodyShowing(page, p.body.split(',')[0].trim()), false);
        state.me = { status: 200, body: ME_OK };
        await page.click('.metis-gate button[data-gate="retry"]');
        await page.waitFor(`document.readyState === 'complete' && !document.documentElement.classList.contains('metis-gate-pending') && !document.querySelector('.metis-gate')`, 10000, '복구 후 본문');
      } finally { await page.close(); }
    });
  }

  test(`405-U7. ${p.name}: 안내 화면 모양 — 버튼 높이 44px 이상·이모지 없음·허용 radius·가운데 정렬·폭 680px 안, 390/1280px 가로 스크롤 없음`, { skip: SKIP }, async () => {
    state.me = { status: 403, body: { code: 'approval_pending' } };
    for (const width of [390, 1280]) {
      const page = await open(p, { width });
      try {
        await page.waitFor(`!!document.querySelector('.metis-gate h1')`, 8000, '안내 화면');
        const info = await page.eval(`(() => {
          const g = document.querySelector('.metis-gate'), main = g.querySelector('main'), r = main.getBoundingClientRect();
          const btns = [...g.querySelectorAll('button')].map(b => ({ h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, radius: getComputedStyle(b).borderRadius, tag: b.tagName }));
          const sizes = [...g.querySelectorAll('h1,p,button')].map(e => getComputedStyle(e).fontSize);
          return { btns, sizes, align: getComputedStyle(g.querySelector('p')).textAlign, mainW: r.width, shadow: [...g.querySelectorAll('*')].some(e => getComputedStyle(e).boxShadow !== 'none'), text: g.textContent,
            role: !!g.querySelector('[role="alertdialog"]'), tags: main.tagName };
        })()`);
        for (const b of info.btns) { assert.equal(b.tag, 'BUTTON'); assert.ok(b.h >= 44, '버튼 높이 ' + b.h); assert.ok(['10px', '0px'].includes(b.radius), 'radius ' + b.radius); }
        assert.ok(info.sizes.every(s => ['18px', '14px'].includes(s)), '글자 크기 ' + info.sizes.join(','));
        assert.equal(info.align, 'center');
        assert.ok(info.mainW <= 680 + 1, '폭 ' + info.mainW);
        assert.equal(info.shadow, false);
        assert.equal(info.role, false);
        assert.ok(!/\p{Extended_Pictographic}/u.test(info.text), '이모지 없음');
        assert.equal(await page.hasHorizontalScroll(), false, width + 'px 가로 스크롤');
      } finally { await page.close(); }
    }
  });
}

test('405-U8. 로그인 콜백 직후(?token=)는 게이트가 토큰을 저장하고 주소에서 지운 뒤 통과 — 다른 쿼리는 보존', { skip: SKIP }, async () => {
  const page = await browser.newPage({ width: 390, height: 844, token: null });
  await seed(page, null);
  try {
    await page.send('Page.navigate', { url: base + '/jgrammar.html?token=abc.def.ghi&x=1' });
    await page.waitFor(`document.readyState === 'complete' && !document.documentElement.classList.contains('metis-gate-pending')`, 8000, '통과');
    assert.equal(await page.eval(`localStorage.getItem('mydict_token')`), 'abc.def.ghi');
    assert.equal(await page.eval(`location.search`), '?x=1');
  } finally { await page.close(); }
});

test('405-U9. 토큰 없이 ?approval=pending|blocked 로 되돌아온 화면은 홈에서 같은 안내를 보이도록 쿼리를 넘긴다', { skip: SKIP }, async () => {
  for (const a of ['pending', 'blocked']) {
    const page = await browser.newPage({ width: 390, height: 844, token: null });
    await seed(page, null);
    try {
      await page.send('Page.navigate', { url: base + '/speakloop.html?approval=' + a });
      await page.waitFor(`location.pathname === '/'`, 8000, '홈으로 이동');
      assert.ok(state.homeHits >= 1);
    } finally { await page.close(); }
  }
});
