// 작업266-1: OCR 인식 영역 = 눈에 보이는 가이드. 가짜 카메라(캔버스 captureStream, 영상 9:16·16:9)로
// (1) 실제 captureLiveFrame 이 가이드 안 위·가운데·아래 단어는 잘라 가고 가이드 바로 위·아래 밖 단어는 안 가져가는지,
// (2) 스캐너를 끝까지 돌려(Tesseract 만 가짜로 대체) 인식 박스가 가이드 사각형과 겹치는지 본다. 실제 인식 정확도·카메라 영상 품질은 대표하지 않는다.
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
const VIDEOS = { 세로형: [1080, 1920], 가로형: [1920, 1080] };

async function openDict(width, height, mobile) {
  srv.reset();
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await page.goto(srv.url + '/english_dictionary.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
  await sleep(300);
  await page.eval("(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()");
  return page;
}

for (const [vn, [vw, vh]] of Object.entries(VIDEOS)) {
  test(`가이드 안 단어는 인식 영역에 포함, 가이드 바로 위·아래 밖 단어는 제외 — 390×844, 영상 ${vn}`, { skip: SKIP }, async () => {
    const page = await openDict(390, 844, true);
    const r = await page.eval(`(async () => {
      const VW = ${vw}, VH = ${vh};
      document.getElementById('ocr-scanner').hidden = false;
      const video = document.querySelector('[data-ocr-video]'), preview = document.querySelector('.ocr-preview'), guideEl = document.querySelector('[data-ocr-guide]');
      const cam = document.createElement('canvas'); cam.width = VW; cam.height = VH; const cx = cam.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, VW, VH);
      video.srcObject = cam.captureStream(30); video.muted = true; await video.play(); await new Promise(r => setTimeout(r, 300));
      const pr = preview.getBoundingClientRect(), gr = guideEl.getBoundingClientRect();
      const s = Math.max(pr.width / VW, pr.height / VH), ox = (pr.width - VW * s) / 2, oy = (pr.height - VH * s) / 2;
      const toFrame = (sx, sy) => [(sx - pr.left - ox) / s, (sy - pr.top - oy) / s];
      const cap = await import('/js/ocr/liveFrameCapture.js'), geo = await import('/js/ocr/liveOverlayGeometry.js');
      const guide = { left: .11, top: .38, width: .78, height: .28 };
      const spots = { top: [gr.top + 2, gr.top + 26], middle: [gr.top + gr.height / 2 - 12, gr.top + gr.height / 2 + 12], bottom: [gr.bottom - 26, gr.bottom - 2], above: [gr.top - 30, gr.top - 6], below: [gr.bottom + 6, gr.bottom + 30] };
      const out = {}; const canvas = document.createElement('canvas');
      for (const [name, [y0, y1]] of Object.entries(spots)) {
        const [fx0, fy0] = toFrame(gr.left + gr.width * .2, y0), [fx1, fy1] = toFrame(gr.right - gr.width * .2, y1);
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, VW, VH); cx.fillStyle = '#000'; cx.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
        await new Promise(r => { video.requestVideoFrameCallback(() => r()); setTimeout(r, 500); }); await new Promise(r => setTimeout(r, 150));
        await cap.captureLiveFrame(video, canvas, guide, geo.computeGuideCrop(video, guideEl));
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++;
        out[name] = Math.round(100 * dark / Math.max(1, (fx1 - fx0) * (fy1 - fy0)));
      }
      out.canvasW = canvas.width; return out;
    })()`);
    for (const k of ['top', 'middle', 'bottom']) assert.ok(r[k] >= 95, `가이드 안(${k}) 단어가 인식 영역에 거의 전부 포함 ${r[k]}%`);
    for (const k of ['above', 'below']) assert.ok(r[k] <= 5, `가이드 밖(${k}) 단어는 인식 영역에 없음 ${r[k]}%`);
    assert.ok(r.canvasW <= 1498, '인식 이미지 폭 상한');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}

for (const [w, h, mobile] of [[390, 844, true], [1280, 800, false]]) {
  test(`스캐너 전체 흐름(Tesseract만 가짜): 인식 박스가 눈에 보이는 가이드와 같은 위치 — ${w}×${h}`, { skip: SKIP }, async () => {
    const page = await openDict(w, h, mobile);
    await page.eval(`(() => {
      const cam = document.createElement('canvas'); cam.width = 1080; cam.height = 1920; const cx = cam.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 1080, 1920);
      let t = 0; setInterval(() => { t++; cx.fillStyle = t % 2 ? '#fff' : '#fefefe'; cx.fillRect(0, 0, 1080, 1920); }, 100);   // 정지한 캔버스는 프레임을 만들지 않아 영상이 시작되지 않음
      navigator.mediaDevices.getUserMedia = async () => cam.captureStream(30);
      // 가짜 Tesseract: 받은 이미지 전체를 감싸는 한 단어를 돌려줌 -> 박스는 크롭 영역(= 가이드)과 같아야 함
      window.Tesseract = { createWorker: async () => ({ recognize: async blob => { const b = await createImageBitmap(blob); return { data: { text: 'journey', words: [{ text: 'journey', confidence: 90, bbox: { x0: 0, y0: 0, x1: b.width, y1: b.height } }] } }; }, terminate: async () => {} }) };
    })()`);
    await page.click('#ocr-open');
    await page.waitFor("!document.getElementById('ocr-scanner').hidden", 3000);
    await page.click('[data-ocr-capture]');
    await page.waitFor("!!document.querySelector('.ocr-box')", 9000, '인식 박스가 나타남(연속 확인 2회 필요)');
    const m = await page.eval(`(() => { const b = document.querySelector('.ocr-box').getBoundingClientRect(), g = document.querySelector('[data-ocr-guide]').getBoundingClientRect(); return { b: [b.left, b.top, b.width, b.height], g: [g.left, g.top, g.width, g.height] }; })()`);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(m.b[i] - m.g[i]) <= 4, `박스와 가이드 ${['left', 'top', 'width', 'height'][i]} 차이 ${m.b[i]} vs ${m.g[i]}`);
    assert.deepEqual(page.errors.filter(e => !/tesseract|Failed to load resource|ERR_FAILED/i.test(e)), []);
    await page.close();
  });
}
