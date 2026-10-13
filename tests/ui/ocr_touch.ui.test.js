// 작업272-2: OCR 터치 모드. 가짜 카메라(캔버스 captureStream) + 가짜 Tesseract(받은 이미지 크기에 비례한 위치에 단어를 돌려줌 → 박스가 화면 어디에 놓여야 하는지 알 수 있다).
// 실제 카메라·실제 인식 정확도·실제 인식 시간은 대표하지 않는다. 스캔 간격만 2000ms → 150ms. 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/ocr_touch.ui.test.js"   (Chrome이 없으면 건너뜀)
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

// 인식 이미지(크롭) 크기 대비 비율로 단어를 놓는다: journey / harvest 는 표시 대상, zz(신뢰도 20)·a(1글자)는 걸러져야 한다
const WORDS = [
  { text: 'journey', conf: 92, fx0: .15, fy0: .30, fx1: .55, fy1: .35 },
  { text: 'harvest', conf: 88, fx0: .15, fy0: .50, fx1: .55, fy1: .55 },
  { text: 'zz', conf: 20, fx0: .65, fy0: .70, fx1: .85, fy1: .74 },
  { text: 'a', conf: 95, fx0: .65, fy0: .80, fx1: .70, fy1: .84 },
];

const setupScript = ([vw, vh]) => `(() => {
  const si = window.setInterval; window.setInterval = (f, ms, ...a) => si(f, ms === 2000 ? 150 : ms, ...a);
  const cam = document.createElement('canvas'); cam.width = ${vw}; cam.height = ${vh}; const cx = cam.getContext('2d');
  let t = 0; setInterval(() => { t++; cx.fillStyle = t % 2 ? '#fff' : '#fefefe'; cx.fillRect(0, 0, ${vw}, ${vh}); }, 100);
  navigator.mediaDevices.getUserMedia = async () => cam.captureStream(30);
  window.__cfg = { recMin: 40, recMax: 80, loadDelay: 0 };
  window.__log = { rec: 0, created: 0, rej: [], imgs: [] };
  window.addEventListener('unhandledrejection', e => window.__log.rej.push(String(e.reason && (e.reason.message || e.reason))));
  const WORDS = ${JSON.stringify(WORDS)};
  window.Tesseract = { createWorker: async () => {
    window.__log.created++;
    if (window.__cfg.loadDelay) await new Promise(r => setTimeout(r, window.__cfg.loadDelay));
    return {
      recognize: async blob => {
        window.__log.rec++;
        const bmp = await createImageBitmap(blob); const W = bmp.width, H = bmp.height;
        window.__log.imgs.push([W, H]);
        const c = window.__cfg; await new Promise(r => setTimeout(r, c.recMin + Math.random() * (c.recMax - c.recMin)));
        const words = WORDS.map(w => ({ text: w.text, confidence: w.conf, bbox: { x0: w.fx0 * W, y0: w.fy0 * H, x1: w.fx1 * W, y1: w.fy1 * H } }));
        return { data: { text: WORDS.map(w => w.text).join(' '), words } };
      },
      terminate: async () => {},
    };
  } };
  // 검색 요청 모의(선택 뒤 searchWord 가 부름)
  const rf = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const url = String(u);
    if (url.startsWith('/api/ai')) {
      const step2 = String(o && o.body).includes('STEP 2');
      const word = (JSON.parse(o.body).prompt.match(/For the English word or phrase: "([^"]+)"/) || [])[1] || 'x';
      const res = step2 ? { meanings: [{ usage_note: 'u', example: 'e', translation: 't' }], similar: [], collocations: [] }
        : { word, search_query: word, pronunciation: '/x/', short_gloss: '뜻', meanings: [{ pos: 'noun', domain: '일반', definition: '뜻' }], derivatives: [] };
      return Promise.resolve(new Response(JSON.stringify({ result: JSON.stringify(res) }), { status: 200 }));
    }
    if (url.startsWith('/api/wordbook')) return Promise.resolve(new Response('[]', { status: 200 }));
    return rf(u, o);
  };
})()`;

async function openDict(t, { width = 390, height = 844, video = [1080, 1920] } = {}) {
  srv.reset();
  const page = await browser.newPage({ width, height, token: jwt() });
  t.after(() => page.close());
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await page.goto(srv.url + '/english_dictionary.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
  await sleep(300);
  await page.eval("(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()");
  await page.eval(setupScript(video));
  return page;
}
const cfg = (page, c) => page.eval(`Object.assign(window.__cfg, ${JSON.stringify(c)}); 0`);
const log = page => page.eval('JSON.parse(JSON.stringify(window.__log))');
const openPanel = page => page.eval("document.getElementById('ocr-open').click(); 0");
const startAuto = page => page.eval("document.querySelector('[data-ocr-capture]').click(); 0");
const modeBtn = (page, m) => page.click(`[data-ocr-mode="${m}"]`);
const waitReady = page => page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('눌러 선택')", 9000, '터치 모드 준비');
const msg = page => page.text('[data-ocr-touch-msg]');
const boxes = page => page.eval("[...document.querySelectorAll('[data-ocr-overlay] .ocr-box')].map(b => { const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })");
const overlayRect = page => page.eval("(() => { const r = document.querySelector('[data-ocr-overlay]').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()");
// 오버레이 비율(fx, fy) 위치 + (dx, dy)px 를 실제 마우스로 누른다
async function tap(page, fx, fy, dx = 0, dy = 0) {
  const o = await overlayRect(page);
  const x = o.l + o.w * fx + dx, y = o.t + o.h * fy + dy;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const wordCenter = w => [(w.fx0 + w.fx1) / 2, (w.fy0 + w.fy1) / 2];
const errs = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '콘솔 오류 없음');

test('모드 전환: 터치 모드에서 자동 스캔 정지·칩 열·가이드·하단 버튼 숨김, 자동으로 돌아오면 스캔 재개', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await openPanel(page);
  await startAuto(page);
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 9000, '자동 후보 칩');
  assert.equal(await page.eval("document.querySelector('[data-ocr-mode=auto]').getAttribute('aria-pressed')"), 'true');
  const hit = sel => page.eval(`getComputedStyle(document.querySelector('${sel}')).display`);
  assert.notEqual(await hit('.ocr-guide'), 'none');
  await modeBtn(page, 'touch');
  assert.equal(await page.eval("document.querySelector('[data-ocr-mode=touch]').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.eval("document.getElementById('ocr-scanner').dataset.mode"), 'touch');
  await waitReady(page);
  assert.equal(await page.count('.ocr-candidate'), 0, '칩 비움');
  for (const sel of ['.ocr-candidates', '.ocr-guide', '.ocr-controls']) assert.equal(await hit(sel), 'none', sel + ' 숨김');
  const rec1 = (await log(page)).rec;
  await sleep(1000);
  assert.equal((await log(page)).rec, rec1, '자동 스캔 정지(인식 요청이 늘지 않음)');
  assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false, '탭 전까지 영상은 재생 중');
  // 되돌아오기
  await modeBtn(page, 'auto');
  assert.equal(await page.eval("document.getElementById('ocr-scanner').dataset.mode"), 'auto');
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 9000, '자동 모드 칩 복귀');
  assert.notEqual(await hit('.ocr-guide'), 'none');
  assert.equal(await page.eval("document.querySelector('[data-ocr-touch-bar]').hidden"), true);
  assert.ok((await log(page)).rec > rec1, '스캔 재개');
  errs(page);
});

for (const [name, size, video] of [['세로 폰 390×844 / 영상 1080×1920', [390, 844], [1080, 1920]], ['가로 데스크톱 1280×800 / 영상 1920×1080', [1280, 800], [1920, 1080]]]) {
  test(`터치: 스냅샷 인식 → 단어 박스가 화면 위치에 맞게 표시(걸러진 단어 제외), 빈 곳은 "단어를 찾지 못했어요" + 다시 찍기 — ${name}`, { skip: SKIP, timeout: 60000 }, async t => {
    const page = await openDict(t, { width: size[0], height: size[1], video });
    await openPanel(page);
    await modeBtn(page, 'touch');                       // 카메라 시작도 이 선택이 한다
    await waitReady(page);
    await tap(page, 0.85, 0.2);                         // 아무 단어도 없는 곳
    await page.waitFor("document.querySelectorAll('[data-ocr-overlay] .ocr-box').length > 0", 9000, '단어 박스');
    const bs = await boxes(page);
    assert.equal(bs.length, 2, 'journey, harvest 만 표시(신뢰도 20·알파벳 1글자는 제외)');
    const o = await overlayRect(page);
    [WORDS[0], WORDS[1]].forEach((w, i) => {
      const exp = { l: o.l + o.w * w.fx0, t: o.t + o.h * w.fy0, w: o.w * (w.fx1 - w.fx0), h: o.h * (w.fy1 - w.fy0) };
      for (const k of ['l', 't', 'w', 'h']) assert.ok(Math.abs(bs[i][k] - exp[k]) <= 3, `${w.text}.${k}: ${bs[i][k]} vs ${exp[k]}`);
    });
    assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), true, '스냅샷 동안 영상 정지');
    await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('단어를 찾지 못했어요')", 4000);
    assert.equal(await page.eval("document.querySelector('[data-ocr-touch-retake]').hidden"), false);
    assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), false, '패널은 그대로');
    const rec = (await log(page)).rec;
    await tap(page, 0.85, 0.9);                          // 멈춘 장면에서 또 빈 곳: 다시 인식하지 않는다
    await sleep(300);
    assert.equal((await log(page)).rec, rec, '이미 인식한 장면은 다시 인식하지 않음');
    // 다시 찍기: 박스 제거 + 영상 재생
    await page.click('[data-ocr-touch-retake]');
    assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false);
    assert.equal(await page.count('[data-ocr-overlay] .ocr-box'), 0);
    assert.match(await msg(page), /눌러 선택/);
    errs(page);
  });
}

test('터치로 단어 선택 → 패널 닫힘, 검색 탭·입력창에 그 단어, 검색 시작. 박스 밖 가까운 곳(28px 이내)도 선택, 멀면 선택 안 됨', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await page.eval("showPage('wordbook'); 0");
  await openPanel(page);
  await modeBtn(page, 'touch');
  await waitReady(page);
  // 박스(journey) 오른쪽 가장자리에서 60px 떨어진 곳 → 어떤 단어도 아님
  const o = await overlayRect(page);
  const edgeX = (WORDS[0].fx1) - 0;                                    // 비율
  await tap(page, edgeX, (WORDS[0].fy0 + WORDS[0].fy1) / 2, 60, 0);
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('단어를 찾지 못했어요')", 9000);
  assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), false);
  // 같은 장면에서 오른쪽 가장자리 20px 밖(8px 여백 밖, 28px 이내) → journey
  await tap(page, edgeX, (WORDS[0].fy0 + WORDS[0].fy1) / 2, 20, 0);
  await page.waitFor("document.getElementById('ocr-scanner').hidden", 4000, '패널 닫힘');
  await page.waitFor("document.getElementById('search-input').value === 'journey'", 4000);
  await page.waitFor("!!document.querySelector('#search-result .result-word')", 6000, '검색 결과');
  await sleep(400);                                                      // 뒤늦은 popstate 가 지나간 뒤에도 검색 탭
  assert.equal(await page.eval("document.querySelector('.page.active').id"), 'page-search');
  assert.equal(await page.text('#search-result .result-word'), 'journey');
  assert.equal(o.w > 0, true);
  errs(page);
});

test('박스 안을 직접 누르면 그 단어(harvest)로 검색', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await openPanel(page);
  await modeBtn(page, 'touch');
  await waitReady(page);
  const [fx, fy] = wordCenter(WORDS[1]);
  await tap(page, fx, fy);                                               // 첫 터치가 곧 스냅샷 + 선택
  await page.waitFor("document.getElementById('ocr-scanner').hidden", 9000, '패널 닫힘');
  await page.waitFor("document.getElementById('search-input').value === 'harvest'", 4000);
  errs(page);
});

test('카메라·엔진 준비 전 터치는 인식하지 않고 안내만, 준비되면 정상 동작', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await cfg(page, { loadDelay: 1500 });
  await openPanel(page);
  await modeBtn(page, 'touch');
  await tap(page, 0.3, 0.3);
  assert.match(await msg(page), /준비하는 중/);
  assert.equal((await log(page)).rec, 0, '준비 전에는 인식하지 않음');
  assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false);
  await waitReady(page);
  const [fx, fy] = wordCenter(WORDS[0]);
  await tap(page, fx, fy);
  await page.waitFor("document.getElementById('search-input').value === 'journey'", 9000);
  errs(page);
});

test('인식 중 패널을 닫으면 결과를 무시한다(검색으로 넘어가지 않음)', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await openPanel(page);
  await modeBtn(page, 'touch');
  await waitReady(page);
  await cfg(page, { recMin: 1200, recMax: 1200 });
  const [fx, fy] = wordCenter(WORDS[0]);
  await tap(page, fx, fy);
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('인식 중')", 3000);
  await page.eval("document.querySelector('[data-ocr-close]').click(); 0");
  await sleep(2200);                                                     // 인식이 끝났을 시간
  assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), true);
  assert.equal(await page.eval("document.getElementById('search-input').value"), '', '선택·검색이 일어나지 않음');
  assert.equal(await page.count('[data-ocr-overlay] .ocr-box'), 0);
  // 다시 열면 자동 모드로 시작하고 영상이 재생됨
  await cfg(page, { recMin: 40, recMax: 80 });
  await openPanel(page);
  await startAuto(page);
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 9000);
  assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false);
  assert.equal(await page.eval("document.getElementById('ocr-scanner').dataset.mode"), 'auto');
  assert.deepEqual((await log(page)).rej, []);
  errs(page);
});

test('인식 시간 제한(테스트에서는 window.__OCR_TOUCH_TIMEOUT_MS 로 짧게): 중단 안내 + 다시 찍기, 늦게 끝난 결과는 무시', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await page.eval("window.__OCR_TOUCH_TIMEOUT_MS = 600; 0");
  await openPanel(page);
  await modeBtn(page, 'touch');
  await waitReady(page);
  await cfg(page, { recMin: 2500, recMax: 2500 });
  const [fx, fy] = wordCenter(WORDS[0]);
  await tap(page, fx, fy);
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('오래 걸려')", 4000, '시간 제한 안내');
  assert.equal(await page.eval("document.querySelector('[data-ocr-touch-retake]').hidden"), false);
  await sleep(2600);                                                     // 늦게 끝난 인식
  assert.equal(await page.count('[data-ocr-overlay] .ocr-box'), 0, '늦은 결과는 화면에 반영되지 않음');
  assert.equal(await page.eval("document.getElementById('search-input').value"), '');
  assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), false);
  // 다시 찍기 → 빠른 인식 → 선택
  await page.click('[data-ocr-touch-retake]');
  assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false);
  await cfg(page, { recMin: 40, recMax: 80 });
  await tap(page, fx, fy);
  await page.waitFor("document.getElementById('search-input').value === 'journey'", 9000);
  errs(page);
});

test('자동 모드는 영향 없음: 후보 칩 선택 → 검색 탭 이동(기존 흐름), 터치 모드 UI는 숨김 상태', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await openPanel(page);
  await startAuto(page);
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 9000);
  assert.equal(await page.eval("document.querySelector('[data-ocr-touch-bar]').hidden"), true);
  const word = await page.eval("document.querySelector('.ocr-candidate span').textContent");
  await page.eval("document.querySelector('.ocr-candidate').click(); 0");
  await page.waitFor(`document.getElementById('search-input').value === ${JSON.stringify(word)}`, 4000);
  await page.waitFor("document.getElementById('ocr-scanner').hidden", 4000);
  errs(page);
});
