// 작업260-1: 입력창 포커스 표시는 화면과 상관없이 하나: 테두리 코랄(--color-accent), 링(--ring-focus), 윤곽선 없음. 평상시 테두리는 그대로(#dde2f5).
// 입력창이 화면 안에서 숨겨져 있을 수 있어, 화면 CSS가 적용되는 같은 문서에 임시 요소를 만들어 포커스를 준다(사전 검색창은 실제 요소).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const ACCENT = 'rgb(226, 88, 59)', LINE = 'rgb(221, 226, 245)', RING = 'rgba(226, 88, 59, 0.25) 0px 0px 0px 3px';
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'admin', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });

// [화면 파일, 입력 요소 종류들]. sel 은 실제 요소 선택자, 없으면 tag/cls 로 임시 요소를 만든다
const CASES = [
  ['english_dictionary', [{ sel: '#search-input' }, { tag: 'input', cls: 'metacog-fill-input', type: 'text' }, { tag: 'textarea', cls: 'metacog-subj-textarea' }], true],
  ['voice_study', [{ tag: 'input', type: 'text' }, { tag: 'textarea' }, { tag: 'select', cls: 'sel' }, { tag: 'select', wrap: 'tts-rate' }]],
  ['admin', [{ tag: 'select', cls: 'role-select' }]],
];

for (const [file, specs, dict] of CASES) {
  test(`${file}: 입력창 포커스 = 코랄 테두리 + 링 + 윤곽선 없음, 평상시 테두리는 #dde2f5 그대로`, { skip: SKIP }, async () => {
    srv.reset(); srv.state.me = me();
    const page = await browser.newPage({ width: 390, height: 844, token: dict ? jwt() : 'test-token' });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.goto(srv.url + '/' + file + '.html');
    await sleep(1200);
    const rows = await page.eval(`(() => {
      const ns = document.createElement('style'); ns.textContent = '*{transition:none!important}'; document.head.appendChild(ns);
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:0;top:0;width:300px;z-index:99999;background:#fff'; document.body.appendChild(box);
      return ${JSON.stringify(specs)}.map(sp => {
        let e;
        if (sp.sel) e = document.querySelector(sp.sel);
        else { e = document.createElement(sp.tag); if (sp.type) e.type = sp.type; if (sp.cls) e.className = sp.cls;
          if (sp.wrap) { const w = document.createElement('div'); w.className = sp.wrap; w.appendChild(e); box.appendChild(w); } else box.appendChild(e); }
        const g = () => { const c = getComputedStyle(e); return { bc: c.borderTopColor, bs: c.boxShadow, os: c.outlineStyle }; };
        const rest = g(); e.focus(); const foc = g(); const fv = e.matches(':focus-visible'); e.blur();
        return { name: sp.sel || (sp.tag + (sp.cls ? '.' + sp.cls : '') + (sp.wrap ? '(.' + sp.wrap + ')' : '')), rest, foc, fv };
      });
    })()`);
    for (const r of rows) {
      assert.equal(r.rest.bc, LINE, r.name + ': 평상시 테두리 색');
      assert.equal(r.foc.bc, ACCENT, r.name + ': 포커스 테두리 = --color-accent');
      assert.equal(r.foc.bs, RING, r.name + ': 포커스 링 = --ring-focus');
      assert.equal(r.foc.os, 'none', r.name + ': 윤곽선 없음(링으로 표시)');
      assert.equal(r.fv, true, r.name + ': 포커스가 :focus-visible 로 잡히는 요소');
    }
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
