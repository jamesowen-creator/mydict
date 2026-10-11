// 작업261-2: OCR 패널은 밝은 배경(토큰 색)이고, 영상 위 요소 중 원형 버튼·오류 문구는 흰 면 α≥.92(후보 칩은 263에서 이전 반투명 검정으로 복원) + 진한 글자로 어느 영상 위에서도 읽힌다.
// 카메라 없이 측정한다: 패널의 hidden 을 풀고 후보 칩·인식 박스·오류 문구를 직접 넣는다(JS 동작은 건드리지 않음). 영상 위 실제 가독성은 이 테스트로 알 수 없다.
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
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const alpha = c => { const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(c); return m ? parseFloat(m[1]) : 1; };

for (const w of [390, 1280]) {
  test(`OCR 패널 ${w}px: 밝은 배경·진한 글자, 영상 위 요소는 흰 면 α≥.92, 후보 칩 13px, 종료 버튼 44px, 열기 버튼 진한 코랄`, { skip: SKIP }, async () => {
    srv.reset();
    const page = await browser.newPage({ width: w, height: 844, token: jwt() });
    await page.goto(srv.url + '/english_dictionary.html');
    await page.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
    await sleep(300);
    const m = await page.eval(`(() => {
      const ns = document.createElement('style'); ns.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(ns);
      document.getElementById('ocr-scanner').hidden = false;
      const list = document.querySelector('[data-ocr-candidates]');
      ['serendipity', 'ephemeral', 'extraordinarily'].forEach((t, i) => { const b = document.createElement('button'); b.className = 'ocr-candidate' + (i === 1 ? ' selected' : ''); b.innerHTML = '<span>' + t + '</span>'; list.appendChild(b); });
      const torch = document.querySelector('[data-ocr-torch]'); torch.hidden = false;
      document.querySelector('[data-ocr-overlay]').innerHTML = '<span class="ocr-box" style="left:40px;top:260px;width:120px;height:34px"></span>';
      document.querySelector('[data-ocr-error]').textContent = '카메라를 사용할 수 없습니다.';
      const g = (sel, props) => { const e = document.querySelector(sel); const c = getComputedStyle(e); const r = e.getBoundingClientRect(); const o = { w: Math.round(r.width), h: Math.round(r.height) }; for (const p of props) o[p] = c[p]; return o; };
      const P = ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'borderTopColor', 'borderTopWidth', 'borderRadius', 'boxShadow', 'filter'];
      const out = { panel: g('.ocr-scanner', P), preview: g('.ocr-preview', P), close: g('.ocr-close-btn', P), torch: g('.ocr-torch-btn', P),
        cand: g('.ocr-candidate:not(.selected)', P), sel: g('.ocr-candidate.selected', P), circle: g('.ocr-circle-btn', P), error: g('.ocr-error', P),
        corner: g('.ocr-corner', P), laser: g('.ocr-laser', P), box: g('.ocr-box', P), open: g('#ocr-open', P),
        spans: [...document.querySelectorAll('.ocr-candidate span')].map(s => s.scrollWidth <= s.clientWidth), candH: [...document.querySelectorAll('.ocr-candidate')].map(e => Math.round(e.getBoundingClientRect().height)) };
      torch.classList.add('active'); out.torchActive = g('.ocr-torch-btn', P);
      return out;
    })()`);
    assert.equal(m.panel.backgroundColor, 'rgb(245, 247, 255)', '패널 배경 --color-bg');
    assert.equal(m.panel.color, 'rgb(26, 31, 60)', '패널 글자 --color-text');
    assert.equal(m.preview.backgroundColor, 'rgb(238, 241, 251)', '영상 자리 배경 --color-surface-2');
    assert.ok(m.close.h >= 44, '종료 버튼 높이 ' + m.close.h);
    assert.equal(m.close.color, 'rgb(26, 31, 60)');
    assert.equal(m.torch.color, 'rgb(74, 80, 112)', '조명 기본은 보조색');
    assert.equal(m.torchActive.color, 'rgb(184, 68, 46)', '조명 켜짐은 accent-ink'); assert.equal(m.torchActive.fontWeight, '700', '켜짐은 굵게(색 단독 금지)'); assert.notEqual(m.torch.fontWeight, '700');
    for (const k of ['circle', 'error']) assert.ok(alpha(m[k].backgroundColor) >= 0.92, `${k} 배경 알파 ${m[k].backgroundColor}`);
    // 작업263: 후보 칩은 너무 밝다는 의견으로 261-2 이전 색(반투명 검정 면+흰 글자)으로 되돌림. 크기·모서리·폭·높이는 그대로
    assert.equal(m.cand.backgroundColor, 'rgba(0, 0, 0, 0.15)', '후보 칩 배경'); assert.equal(m.cand.color, 'rgba(255, 255, 255, 0.8)', '후보 칩 글자');
    assert.equal(m.cand.borderTopColor, 'rgba(255, 255, 255, 0.2)', '후보 칩 테두리'); assert.equal(m.cand.fontSize, '13px', '후보 칩 글자 크기');
    assert.equal(m.cand.borderRadius, '10px');
    assert.equal(m.sel.boxShadow, 'rgba(255, 255, 255, 0.65) 0px 0px 0px 1px inset', '선택된 칩 안쪽 흰 선'); assert.equal(m.sel.fontWeight, '700', '선택된 칩 굵게(색 단독 금지)'); assert.equal(m.cand.fontWeight, '500');
    assert.ok(m.spans.every(Boolean), '후보 칩 글자가 잘리지 않음'); assert.ok(m.candH.every(h => h === 44), '후보 칩은 한 줄(높이 44) ' + m.candH);
    assert.equal(m.circle.w, 56); assert.equal(m.circle.borderRadius, '50%'); assert.equal(m.circle.color, 'rgb(184, 68, 46)'); assert.equal(m.circle.boxShadow, 'none', '글로우 없음');
    assert.equal(m.error.color, 'rgb(180, 35, 24)', '오류 글자 danger-ink');
    assert.equal(m.corner.borderTopWidth, '3px'); assert.match(m.corner.filter, /drop-shadow/);
    assert.match(m.laser.filter, /drop-shadow/);
    assert.equal(m.box.borderTopWidth, '2px'); assert.equal(m.box.borderTopColor, 'rgb(226, 88, 59)'); assert.equal(alpha(m.box.backgroundColor), 0, '인식 박스는 면 없음');
    assert.equal(m.open.backgroundColor, 'rgb(184, 68, 46)', '열기 버튼 배경 accent-ink'); assert.equal(m.open.borderRadius, '999px', '열기 버튼 모서리는 그대로');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
