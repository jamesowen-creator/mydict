// 작업207-1: 코랄 주 버튼의 흰 글자 대비(WCAG 4.5:1 이상). 6개 화면의 실제 주 버튼 계산값과 호버·눌림 변수를 코드로 계산해 확인한다.
// 비활성 상태는 WCAG 대비 기준 대상이 아니므로(투명도로 흐리게) 값만 기록한다. 실행: node --test "tests/ui/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgb = css => { const m = String(css).match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : null; };
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.trim().slice(i, i + 2), 16));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

// 화면별 주 버튼(없는 요소도 계산값은 읽을 수 있다: display:none 이어도 색은 계산된다)
const SCREENS = [
  { name: 'english_dictionary', sel: ['#search-btn'] },
  { name: 'literature_compass', sel: ['.briefing-cta', '.quiz-start-btn', '.quiz-next-btn', '.result-btn-primary'] },
  { name: 'digest_reading', sel: ['.quiz-next-btn', '.result-btn-primary'] },
  { name: 'science_reading', sel: ['.quiz-next-btn', '.result-btn-primary'] },
  { name: 'voice_study', sel: ['#new-rec-btn'] },
  { name: 'concept_study', sel: ['#start-open'] },
];

for (const sc of SCREENS) {
  test(`주 버튼 대비 ${sc.name}: 흰 글자 4.5:1 이상, 호버·눌림도 더 어둡고 4.5:1 이상`, { skip: SKIP }, async () => {
    srv.reset();
    srv.state.me = { id: 7, email: 'u@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true, perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true };
    srv.state.voiceNotes = [];
    if (sc.name === 'concept_study') srv.seed({ topic: 'x', items: [{ term: '가' }] });
    const page = await browser.newPage({ width: 390, height: 844, token: sc.name === 'english_dictionary' ? jwt() : 'test-token' });
    await page.goto(srv.url + '/' + sc.name + '.html');
    await new Promise(r => setTimeout(r, 1200));
    if (sc.name === 'concept_study') await page.waitFor("!document.getElementById('study-rows').hidden", 8000);
    const vars = await page.eval("(() => { const c = getComputedStyle(document.documentElement); return ['--btn-primary-bg', '--btn-primary-bg-hover', '--btn-primary-bg-active'].map(k => c.getPropertyValue(k).trim()); })()");
    const [base, hov, act] = vars.map(hexRgb);
    const white = [255, 255, 255];
    assert.ok(ratio(white, base) >= 4.5, `기본 ${vars[0]} ${ratio(white, base).toFixed(2)}`);
    assert.ok(ratio(white, hov) >= 4.5 && lum(hov) < lum(base), `호버 ${vars[1]} ${ratio(white, hov).toFixed(2)}`);
    assert.ok(ratio(white, act) >= 4.5 && lum(act) < lum(hov), `눌림 ${vars[2]} ${ratio(white, act).toFixed(2)}`);
    for (const sel of sc.sel) {
      const c = await page.eval(`(() => { let e = document.querySelector(${JSON.stringify(sel)}); if (!e && ${JSON.stringify(sel)}.startsWith('.')) { e = document.createElement('button'); e.className = ${JSON.stringify(sel)}.slice(1); document.body.append(e); }   /* 화면이 나중에 그리는 버튼은 같은 클래스의 버튼을 만들어 CSS 규칙이 닿는지 본다 */
        if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, fg: s.color, opacity: s.opacity }; })()`);
      assert.ok(c, sc.name + ' 요소 없음 ' + sel);
      const r = ratio(rgb(c.fg), rgb(c.bg));
      assert.ok(r >= 4.5, `${sc.name} ${sel}: 글자 ${c.fg} / 바탕 ${c.bg} = ${r.toFixed(2)}:1`);
      assert.deepEqual(rgb(c.bg), base, `${sel} 바탕이 --btn-primary-bg를 씀`);
    }
    await page.close();
  });
}

test('로고·테두리·강조색 #e2583b은 그대로(주 버튼 바탕만 바뀜)', { skip: SKIP }, async () => {
  srv.reset();
  const page = await browser.newPage({ width: 390, height: 844, token: 'test-token' });
  await page.goto(srv.url + '/literature_compass.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo')", 8000);
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.metis-app-header-logo')).color"), 'rgb(226, 88, 59)');
  assert.equal(await page.eval("getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase()"), '#e2583b');
  await page.close();
});
