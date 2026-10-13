// 작업272-1: OCR Worker 종료 경합·시작 취소 안정화. 가짜 카메라(캔버스 captureStream) + 가짜 Tesseract Worker(종료에 시간이 걸리고, 종료된 Worker 는 인식이 끝나지 않거나 거부됨)
// 실제 카메라·실제 tesseract.js 의 종료 동작은 대표하지 않는다(가짜 모델은 267-1 조사에서 쓴 것과 같은 가정). 스캔 간격만 2000ms → 150ms.
// 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/ocr_worker.ui.test.js"   (Chrome이 없으면 건너뜀)
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

const SETUP = `(() => {
  const si = window.setInterval; window.setInterval = (f, ms, ...a) => si(f, ms === 2000 ? 150 : ms, ...a);
  const cam = document.createElement('canvas'); cam.width = 1080; cam.height = 1920; const cx = cam.getContext('2d');
  let t = 0; setInterval(() => { t++; cx.fillStyle = t % 2 ? '#fff' : '#fefefe'; cx.fillRect(0, 0, 1080, 1920); }, 100);
  window.__log = { created: 0, terminated: 0, alive: 0, maxAlive: 0, rec: 0, gum: 0, rej: [], open: 0 };
  const gum = async () => { window.__log.gum++; return cam.captureStream(30); };
  navigator.mediaDevices.getUserMedia = gum;
  window.__cfg = { recMin: 30, recMax: 120, termDelay: 120, termFail: false, loadDelay: 0, words: ['journey', 'harvest'], rejectOnTerminate: false };
  window.addEventListener('unhandledrejection', e => window.__log.rej.push(String(e.reason && (e.reason.message || e.reason))));
  window.Tesseract = { createWorker: async () => {
    const c = window.__cfg, L = window.__log;
    L.created++;
    if (c.loadDelay) await new Promise(r => setTimeout(r, c.loadDelay));
    L.alive++; L.maxAlive = Math.max(L.maxAlive, L.alive);
    const w = { dead: false, pending: new Set() };
    w.recognize = () => new Promise((res, rej) => {
      L.rec++;
      if (w.dead) return;   // 종료된 Worker 의 인식은 끝나지 않음(267-1 가정)
      const d = c.recMin + Math.random() * (c.recMax - c.recMin);
      const entry = { rej };
      w.pending.add(entry);
      setTimeout(() => { if (!w.pending.has(entry)) return; w.pending.delete(entry); res({ data: { text: c.words.join(' '), words: c.words.map((x, i) => ({ text: x, confidence: 92, bbox: { x0: 10, y0: 10 + i * 40, x1: 200, y1: 40 + i * 40 } })) } }); }, d);
    });
    w.terminate = async () => {
      await new Promise(r => setTimeout(r, window.__cfg.termDelay));
      if (window.__cfg.termFail) throw new Error('terminate failed');
      w.dead = true; L.terminated++; L.alive--;
      if (window.__cfg.rejectOnTerminate) for (const p of w.pending) p.rej(new Error('worker terminated'));
      w.pending.clear();
    };
    return w;
  } };
})()`;

async function openDict(t) {
  srv.reset();
  const page = await browser.newPage({ width: 390, height: 844, token: jwt() });
  t.after(() => page.close());
  await page.goto(srv.url + '/english_dictionary.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
  await sleep(300);
  await page.eval("(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()");
  await page.eval(SETUP);
  return page;
}
const cfg = (page, c) => page.eval(`Object.assign(window.__cfg, ${JSON.stringify(c)}); 0`);
const startOcr = page => page.eval(`document.getElementById('ocr-open').click(); document.querySelector('[data-ocr-capture]').click(); 0`);
const chips = page => page.count('.ocr-candidate');
const waitChip = (page, ms = 8000) => page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", ms, '후보 칩');
const log = page => page.eval('JSON.parse(JSON.stringify(window.__log))');
const clean = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '콘솔 오류 없음');

test('칩 선택 직후 OCR 다시 열기 50회: 매번 후보 칩이 다시 뜨고, 동시에 살아 있는 Worker 1개 이하, 미처리 거부 없음', { skip: SKIP, timeout: 300000 }, async t => {
  const page = await openDict(t);
  const misses = [];
  for (let i = 0; i < 50; i++) {
    await startOcr(page);
    try { await waitChip(page, 8000); } catch (e) { misses.push('첫 열기 #' + i); break; }
    await page.eval("document.querySelector('.ocr-candidate').click(); 0");       // 칩 선택 → 패널 닫기 → terminate(기다리지 않음)
    await sleep(Math.random() * 60);
    await startOcr(page);                                                         // 곧바로 다시 열기
    try { await waitChip(page, 8000); } catch (e) { misses.push('다시 열기 #' + i); }
    await page.eval("window.__closeOcrPanel({ viaBack: true }); 0");              // 정리(다음 반복 준비)
    await sleep(150);
  }
  assert.deepEqual(misses, [], '칩 누락 0');
  const L = await log(page);
  assert.ok(L.created >= 100, 'Worker 를 매번 새로 만듦: ' + L.created);
  assert.ok(L.maxAlive <= 1, '동시에 살아 있는 Worker ' + L.maxAlive);
  assert.deepEqual(L.rej, [], '미처리 거부 없음');
  clean(page);
});

test('엔진 준비 중 종료: 세션은 만들어진 뒤 바로 정리되고 스캔이 시작되지 않으며, 이후 다시 시작하면 정상', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await cfg(page, { loadDelay: 1200 });
  await startOcr(page);
  await sleep(300);
  await page.eval("document.querySelector('[data-ocr-close]').click(); 0");        // 종료(엔진은 아직 준비 중)
  await sleep(2600);                                                               // 준비가 끝나고 정리될 시간
  let L = await log(page);
  assert.equal(L.rec, 0, '종료 뒤에는 인식을 한 번도 시작하지 않음');
  assert.equal(L.terminated, L.created, '준비되던 Worker 도 정리됨');
  assert.equal(L.alive, 0);
  assert.equal(await chips(page), 0);
  const recAt = L.rec; await sleep(800);
  assert.equal((await log(page)).rec, recAt, '좀비 스캔 없음');
  await cfg(page, { loadDelay: 0 });
  await startOcr(page);                                                            // 다시 시작은 정상
  await waitChip(page, 8000);
  assert.deepEqual((await log(page)).rej, []);
  clean(page);
});

test('시작 중 [시작]을 다시 눌러도 카메라를 한 번만 연다', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await cfg(page, { loadDelay: 800 });
  await startOcr(page);
  await page.eval("document.querySelector('[data-ocr-capture]').click(); document.querySelector('[data-ocr-capture]').click(); 0");
  await sleep(1500);
  assert.equal((await log(page)).gum, 1, 'getUserMedia 1회');
  await cfg(page, { loadDelay: 0 });
  await waitChip(page, 8000);
  clean(page);
});

test('인식 도중 종료·재시작: 옛 인식의 오류가 화면에 나오지 않고, 재시작한 세션이 정상 동작', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await cfg(page, { recMin: 700, recMax: 700, rejectOnTerminate: true, termDelay: 20 });
  await startOcr(page);
  await page.waitFor('window.__log.rec >= 1', 6000, '첫 인식이 진행 중');
  await page.eval("document.querySelector('[data-ocr-close]').click(); 0");        // 인식 도중 종료 → 옛 인식은 거부로 끝남
  await sleep(100);
  await cfg(page, { recMin: 30, recMax: 120, rejectOnTerminate: false });
  await startOcr(page);                                                            // 곧바로 다시 시작
  await sleep(1200);
  assert.equal(await page.text('[data-ocr-error]'), '', '옛 인식의 오류 문구가 보이지 않음');
  await waitChip(page, 8000);
  assert.equal(await page.text('[data-ocr-error]'), '');
  assert.deepEqual((await log(page)).rej, [], '미처리 거부 없음');
  clean(page);
});

test('Worker 종료가 실패해도 오류가 전파되지 않고 다음 열기가 정상', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await cfg(page, { termFail: true, termDelay: 30 });
  for (let i = 0; i < 3; i++) {
    await startOcr(page);
    await waitChip(page, 8000);
    await page.eval("document.querySelector('.ocr-candidate').click(); 0");
    await sleep(200);
  }
  assert.deepEqual((await log(page)).rej, [], '종료 오류가 미처리 거부로 새지 않음');
  clean(page);
});
