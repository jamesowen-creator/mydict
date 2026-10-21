// 작업N: 홈 휠에 일본어 문법 정식 편입 + 배치 최적화(헤드리스 Chrome, 모의 API).
// 확인: 계정 조합별 항목 목록·순서(일본어 문법은 언어 사전 바로 다음), "(임시)" 링크 없음, 항목 진입, 이웃 카드 겹침 없음·가로 스크롤 없음·320px에서도 카드가 화면 안.
// 실행: node --test tests/ui/home_wheel.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const userToken = () => `${b64({ alg: 'none' })}.${b64({ id: 7, role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const BASE6 = ['언어 사전', '문학 나침반', '한입 독서', '과학', '음성 학습', '작가 노트'];
const WITH_JG = ['언어 사전', '문장 학습', '문학 나침반', '한입 독서', '과학', '음성 학습', '작가 노트'];

async function openHome(me, { token = userToken(), width = 390, height = 844 } = {}) {
  srv.reset();
  if (me) srv.state.me = { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', ...me };
  const page = await browser.newPage({ width, height, token });
  await page.goto(srv.url + '/');
  await page.waitFor("document.querySelectorAll('[role=option]').length >= 6", 8000);
  await sleep(600);   // /api/me 응답 반영(권한자는 휠이 다시 만들어짐)
  return page;
}
const selectedLabel = page => page.eval("(document.querySelector('[role=option][aria-selected=true]') || { getAttribute: () => null }).getAttribute('aria-label')").then(t => (t ? t.split(' — ')[0] : null));
const key = async (page, k, code, vk) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
// 한 칸씩 내리며 한 바퀴 돌아 선택된 항목 이름을 순서대로 모은다(휠은 가까운 7개만 그려서 전체 목록은 이렇게 얻는다)
async function cycle(page) {
  await page.eval("document.querySelector('[role=listbox]').focus()");
  const first = await selectedLabel(page);
  const out = [first];
  for (let i = 0; i < 12; i++) {
    await key(page, 'ArrowDown', 'ArrowDown', 40);
    const prev = out[out.length - 1];
    await page.waitFor(`(() => { const o = document.querySelector('[role=option][aria-selected=true]'); return !!o && o.getAttribute('aria-label').split(' — ')[0] !== ${JSON.stringify(prev)}; })()`, 3000);
    await sleep(350);
    const cur = await selectedLabel(page);
    if (cur === first) break;
    out.push(cur);
  }
  return out;
}

test('홈 휠: 권한 없음·값 없음·false·문자열 "true"·로그인 전은 기본 6개(일본어 문법 없음)', { skip: SKIP }, async () => {
  for (const [name, me, token] of [['로그인 전', null, null], ['값 없음', {}, userToken()], ['false', { perm_jgrammar: false }, userToken()], ['문자열 "true"', { perm_jgrammar: 'true' }, userToken()]]) {
    const page = await openHome(me, { token });
    assert.deepEqual(await cycle(page), BASE6, name);
    await page.close();
  }
});

test('홈 휠: perm_jgrammar=true 는 "일본어 문법"이 언어 사전 바로 다음, 나머지 기존 항목의 순서는 그대로', { skip: SKIP }, async () => {
  const page = await openHome({ perm_jgrammar: true });
  assert.deepEqual(await cycle(page), WITH_JG);
  await page.close();
});

test('홈 휠: 관리자(role=admin)는 perm_jgrammar 값이 없어도 "일본어 문법"이 보인다', { skip: SKIP }, async () => {
  const page = await openHome({ role: 'admin' });
  assert.deepEqual(await cycle(page), WITH_JG);
  await page.close();
});

test('홈 휠: 일본어 문법+개념 지도 권한이면 8개 — 개념 지도는 맨 끝(작가 노트 다음) 그대로', { skip: SKIP }, async () => {
  const page = await openHome({ perm_jgrammar: true, perm_concept_map: true });
  assert.deepEqual(await cycle(page), [...WITH_JG, '개념 지도']);
  await page.close();
  const p2 = await openHome({ perm_concept_map: true });
  assert.deepEqual(await cycle(p2), [...BASE6, '개념 지도'], '개념 지도만: 일본어 문법 없음');
  await p2.close();
});

test('"일본어 문법 (임시)" 링크가 없다: 권한자·관리자 모두 휠 아래에 /jgrammar.html 링크·(임시) 문구 없음', { skip: SKIP }, async () => {
  for (const me of [{ perm_jgrammar: true }, { role: 'admin' }, {}]) {
    const page = await openHome(me);
    assert.equal(await page.count('a[href="/jgrammar.html"]'), 0);
    assert.doesNotMatch(await page.eval('document.body.innerText'), /\(임시\)|임시/);
    await page.close();
  }
});

test('일본어 문법 항목을 가운데로 돌려 누르면 /jgrammar.html 로 이동', { skip: SKIP }, async () => {
  const page = await openHome({ perm_jgrammar: true });
  await page.eval("document.querySelector('[role=listbox]').focus()");
  await key(page, 'ArrowDown', 'ArrowDown', 40);
  await page.waitFor("(document.querySelector('[role=option][aria-selected=true]') || { getAttribute: () => '' }).getAttribute('aria-label').startsWith('문장 학습')", 4000);
  assert.match(await page.eval("document.querySelector('[role=option][aria-selected=true]').getAttribute('aria-label')"), /^문장 학습 — /, '라벨·설명 형식은 다른 항목과 같다');
  await sleep(400);
  await page.click('[role=option][aria-selected=true]');
  await page.waitFor("location.pathname === '/jgrammar.html'", 6000);
  await page.close();
});

// 배치: 계정 조합(6·7·8개) × 화면 폭. 가운데 카드와 이웃 카드가 겹치지 않고, 위·아래 이웃 수가 같고, 카드가 화면 안에 있고, 가로 스크롤이 없다
const GEOMETRY = `(() => {
  const lb = document.querySelector('[role=listbox]').getBoundingClientRect();
  const cy = (lb.top + lb.bottom) / 2;
  const all = [...document.querySelectorAll('[role=option]')].map(o => { const r = o.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, op: parseFloat(getComputedStyle(o).opacity), sel: o.getAttribute('aria-selected') === 'true' }; });
  const strong = all.filter(o => o.op >= 0.3).sort((a, b) => a.top - b.top);
  const overlap = Math.max(0, ...strong.slice(1).map((o, i) => strong[i].bottom - o.top));
  const sel = all.find(o => o.sel);
  return { overlap, above: strong.filter(o => (o.top + o.bottom) / 2 < cy - 5).length, below: strong.filter(o => (o.top + o.bottom) / 2 > cy + 5).length,
    selLeft: sel.left, selRight: sel.right, selH: sel.bottom - sel.top, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, outside: strong.filter(o => (o.top + o.bottom) / 2 < lb.top || (o.top + o.bottom) / 2 > lb.bottom).length };
})()`;
for (const [name, me] of [['기본 6개', {}], ['7개(일본어 문법)', { perm_jgrammar: true }], ['8개(관리자+개념 지도)', { role: 'admin', perm_concept_map: true }]]) {
  for (const [w, h] of [[390, 844], [360, 640], [320, 568], [768, 1024], [1280, 800]]) {
    test(`휠 배치 ${name} ${w}x${h}: 이웃 카드와 겹침 없음, 위·아래 이웃 수 같음, 카드가 화면 안, 가로 스크롤 없음, 카드 높이 44px 이상`, { skip: SKIP }, async () => {
      const page = await openHome(me, { width: w, height: h });
      for (let step = 0; step < 3; step++) {   // 처음 위치와 두 칸 돌린 위치
        const g = await page.eval(GEOMETRY);
        assert.equal(g.overlap, 0, `겹침 ${g.overlap}px`);
        assert.equal(g.above, g.below, `위 ${g.above} / 아래 ${g.below}`);
        assert.equal(g.outside, 0, '선명한 카드가 휠 영역 밖');
        assert.ok(g.selLeft >= 0 && g.selRight <= g.vw, `가운데 카드 ${Math.round(g.selLeft)}~${Math.round(g.selRight)} / 화면 ${g.vw}`);
        assert.ok(g.sw <= g.vw, `가로 스크롤 ${g.sw} > ${g.vw}`);
        assert.ok(g.selH >= 44, '터치 높이 ' + g.selH);
        await page.eval("document.querySelector('[role=listbox]').focus()");
        await key(page, 'ArrowDown', 'ArrowDown', 40); await sleep(700);
      }
      assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
      await page.close();
    });
  }
}
