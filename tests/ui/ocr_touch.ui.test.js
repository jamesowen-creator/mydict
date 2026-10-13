// 작업272-2·272-3: OCR 터치 모드(스냅샷 인식·박스·터치 판정)와 선택 목록(담기·편집·검색 시작·재진입 유지).
// 가짜 카메라(캔버스 captureStream) + 가짜 Tesseract(받은 이미지 크기에 비례한 위치에 단어를 돌려줌 → 박스가 화면 어디에 놓여야 하는지 알 수 있다).
// 실제 카메라·실제 인식 정확도·실제 인식 시간은 대표하지 않는다. 스캔 간격만 2000ms → 150ms. 서버·페이지는 t.after 로 종료한다.
// 272-3 에서 "터치하면 바로 검색"이 "터치하면 목록에 담기 → [검색 시작]"으로 바뀌어, 272-2 의 선택 테스트도 이 흐름에 맞게 갱신했다(의도된 변경).
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

// 인식 이미지(크롭) 크기 대비 비율로 단어를 놓는다: 앞 4개는 표시 대상, zz(신뢰도 20)·a(1글자)는 걸러져야 한다
const WORDS = [
  { text: 'journey', conf: 92, fx0: .15, fy0: .30, fx1: .55, fy1: .35 },
  { text: 'harvest', conf: 88, fx0: .15, fy0: .42, fx1: .55, fy1: .47 },
  { text: 'meadow', conf: 90, fx0: .15, fy0: .54, fx1: .55, fy1: .59 },
  { text: 'orchard', conf: 85, fx0: .15, fy0: .66, fx1: .55, fy1: .71 },
  { text: 'zz', conf: 20, fx0: .65, fy0: .76, fx1: .85, fy1: .80 },
  { text: 'a', conf: 95, fx0: .65, fy0: .84, fx1: .70, fy1: .88 },
];
const SHOWN = WORDS.slice(0, 4);

const setupScript = ([vw, vh]) => `(() => {
  const si = window.setInterval; window.setInterval = (f, ms, ...a) => si(f, ms === 2000 ? 150 : ms, ...a);
  const cam = document.createElement('canvas'); cam.width = ${vw}; cam.height = ${vh}; const cx = cam.getContext('2d');
  let t = 0; setInterval(() => { t++; cx.fillStyle = t % 2 ? '#fff' : '#fefefe'; cx.fillRect(0, 0, ${vw}, ${vh}); }, 100);
  navigator.mediaDevices.getUserMedia = async () => cam.captureStream(30);
  window.__cfg = { recMin: 40, recMax: 80, loadDelay: 0, grid: false };
  window.__log = { rec: 0, created: 0, rej: [] };
  window.addEventListener('unhandledrejection', e => window.__log.rej.push(String(e.reason && (e.reason.message || e.reason))));
  const WORDS = ${JSON.stringify(WORDS)};
  // grid: 24개 단어를 4열 × 6행으로(상한 20 확인용). 글자만으로 된 서로 다른 단어
  const gridWords = () => Array.from({ length: 24 }, (_, i) => ({ text: 'tok' + String.fromCharCode(97 + Math.floor(i / 4)) + String.fromCharCode(97 + (i % 4)) + 'x', conf: 90,
    fx0: 0.03 + (i % 4) * 0.24, fy0: 0.12 + Math.floor(i / 4) * 0.06, fx1: 0.03 + (i % 4) * 0.24 + 0.2, fy1: 0.12 + Math.floor(i / 4) * 0.06 + 0.03 }));
  window.Tesseract = { createWorker: async () => {
    window.__log.created++;
    if (window.__cfg.loadDelay) await new Promise(r => setTimeout(r, window.__cfg.loadDelay));
    return {
      recognize: async blob => {
        window.__log.rec++;
        const bmp = await createImageBitmap(blob); const W = bmp.width, H = bmp.height;
        const c = window.__cfg; await new Promise(r => setTimeout(r, c.recMin + Math.random() * (c.recMax - c.recMin)));
        const list = c.grid ? gridWords() : WORDS;
        const words = list.map(w => ({ text: w.text, confidence: w.conf, bbox: { x0: w.fx0 * W, y0: w.fy0 * H, x1: w.fx1 * W, y1: w.fy1 * H } }));
        return { data: { text: list.map(w => w.text).join(' '), words } };
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
const waitReady = page => page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('눌러 담으세요')", 9000, '터치 모드 준비');
const msg = page => page.text('[data-ocr-touch-msg]');
const boxes = page => page.eval("[...document.querySelectorAll('[data-ocr-overlay] .ocr-box')].map(b => { const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, picked: b.classList.contains('picked') }; })");
const overlayRect = page => page.eval("(() => { const r = document.querySelector('[data-ocr-overlay]').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()");
const picks = page => page.eval("[...document.querySelectorAll('[data-ocr-picks] li')].map(li => li.dataset.word)");
// 오버레이 비율(fx, fy) 위치 + (dx, dy)px 를 실제 마우스로 누른다
async function tap(page, fx, fy, dx = 0, dy = 0) {
  const o = await overlayRect(page);
  const x = o.l + o.w * fx + dx, y = o.t + o.h * fy + dy;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const center = w => [(w.fx0 + w.fx1) / 2, (w.fy0 + w.fy1) / 2];
const tapWord = (page, w) => tap(page, ...center(w));
// 첫 터치는 스냅샷 인식이 끝나야 담기므로(인식 중 터치는 무시) 목록에 반영될 때까지 기다린 뒤, 같은 장면의 나머지 단어를 이어서 담는다
async function pickWords(page, words) {
  await tapWord(page, words[0]);
  await page.waitFor("document.querySelectorAll('[data-ocr-picks] li').length >= 1", 9000, '첫 단어 담김');
  for (const w of words.slice(1)) { await tapWord(page, w); await sleep(40); }
}
const waitPicks = (page, expected) => page.waitFor(`JSON.stringify([...document.querySelectorAll('[data-ocr-picks] li')].map(li => li.dataset.word)) === ${JSON.stringify(JSON.stringify(expected))}`, 6000, '목록 ' + expected.join(','));
const errs = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '콘솔 오류 없음');
const enterTouch = async page => { await openPanel(page); await modeBtn(page, 'touch'); await waitReady(page); };

test('모드 전환: 터치 모드에서 자동 스캔 정지·칩 열·가이드·하단 버튼 숨김·시트 표시, 자동으로 돌아오면 스캔 재개·시트 숨김', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await openPanel(page);
  await startAuto(page);
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 9000, '자동 후보 칩');
  assert.equal(await page.eval("document.querySelector('[data-ocr-mode=auto]').getAttribute('aria-pressed')"), 'true');
  const disp = sel => page.eval(`getComputedStyle(document.querySelector('${sel}')).display`);
  assert.notEqual(await disp('.ocr-guide'), 'none');
  assert.equal(await disp('[data-ocr-sheet]'), 'none', '자동 모드에서는 시트가 없다');
  await modeBtn(page, 'touch');
  assert.equal(await page.eval("document.querySelector('[data-ocr-mode=touch]').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.eval("document.getElementById('ocr-scanner').dataset.mode"), 'touch');
  await waitReady(page);
  assert.equal(await page.count('.ocr-candidate'), 0, '칩 비움');
  for (const sel of ['.ocr-candidates', '.ocr-guide', '.ocr-controls']) assert.equal(await disp(sel), 'none', sel + ' 숨김');
  assert.equal(await disp('[data-ocr-sheet]'), 'flex', '시트 표시');
  const rec1 = (await log(page)).rec;
  await sleep(1000);
  assert.equal((await log(page)).rec, rec1, '자동 스캔 정지(인식 요청이 늘지 않음)');
  assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false, '탭 전까지 영상은 재생 중');
  await modeBtn(page, 'auto');
  assert.equal(await page.eval("document.getElementById('ocr-scanner').dataset.mode"), 'auto');
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 9000, '자동 모드 칩 복귀');
  assert.notEqual(await disp('.ocr-guide'), 'none');
  assert.equal(await disp('[data-ocr-sheet]'), 'none');
  assert.ok((await log(page)).rec > rec1, '스캔 재개');
  errs(page);
});

for (const [name, size, video] of [['세로 폰 390×844 / 영상 1080×1920', [390, 844], [1080, 1920]], ['가로 데스크톱 1280×800 / 영상 1920×1080', [1280, 800], [1920, 1080]]]) {
  test(`터치: 스냅샷 인식 → 단어 박스가 화면 위치에 맞게 표시(걸러진 단어 제외), 빈 곳은 "단어를 찾지 못했어요" + 다시 찍기 — ${name}`, { skip: SKIP, timeout: 60000 }, async t => {
    const page = await openDict(t, { width: size[0], height: size[1], video });
    await enterTouch(page);
    await tap(page, 0.85, 0.2);                         // 아무 단어도 없는 곳
    await page.waitFor("document.querySelectorAll('[data-ocr-overlay] .ocr-box').length > 0", 9000, '단어 박스');
    const bs = await boxes(page);
    assert.equal(bs.length, SHOWN.length, '신뢰도 20·알파벳 1글자는 제외하고 4개 표시');
    const o = await overlayRect(page);
    SHOWN.forEach((w, i) => {
      const exp = { l: o.l + o.w * w.fx0, t: o.t + o.h * w.fy0, w: o.w * (w.fx1 - w.fx0), h: o.h * (w.fy1 - w.fy0) };
      for (const k of ['l', 't', 'w', 'h']) assert.ok(Math.abs(bs[i][k] - exp[k]) <= 3, `${w.text}.${k}: ${bs[i][k]} vs ${exp[k]}`);
    });
    assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), true, '스냅샷 동안 영상 정지');
    await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('단어를 찾지 못했어요')", 4000);
    assert.equal(await page.eval("document.querySelector('[data-ocr-touch-retake]').hidden"), false);
    assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), false, '패널은 그대로');
    assert.deepEqual(await picks(page), [], '아무것도 담기지 않음');
    const rec = (await log(page)).rec;
    await tap(page, 0.85, 0.9);                          // 멈춘 장면에서 또 빈 곳: 다시 인식하지 않는다
    await sleep(300);
    assert.equal((await log(page)).rec, rec, '이미 인식한 장면은 다시 인식하지 않음');
    await page.click('[data-ocr-touch-retake]');         // 다시 찍기: 박스 제거 + 영상 재생
    assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false);
    assert.equal(await page.count('[data-ocr-overlay] .ocr-box'), 0);
    assert.match(await msg(page), /눌러 담으세요/);
    errs(page);
  });
}

test('담기: 터치한 단어는 바로 검색하지 않고 목록에 담긴다(같은 장면에서 이어서 담기, 담긴 박스 강조, 중복 안내, 박스 밖 28px 이내 선택)', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await enterTouch(page);
  await tapWord(page, SHOWN[0]);                         // 첫 터치가 스냅샷 + 담기
  await waitPicks(page, ['journey']);
  assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), false, '패널은 그대로(검색하지 않음)');
  assert.equal(await page.eval("document.getElementById('search-input').value"), '');
  assert.match(await msg(page), /‘journey’ 담았어요/);
  assert.equal((await boxes(page)).filter(b => b.picked).length, 1, '담긴 박스만 강조');
  const rec = (await log(page)).rec;
  await tapWord(page, SHOWN[1]);                         // 같은 장면: 다시 인식하지 않고 담는다
  await waitPicks(page, ['journey', 'harvest']);
  assert.equal((await log(page)).rec, rec, '이어서 담을 때 다시 인식하지 않음');
  await tapWord(page, SHOWN[0]);                         // 중복
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('이미 담겨')", 3000);
  assert.deepEqual(await picks(page), ['journey', 'harvest']);
  // 박스 밖: 오른쪽 가장자리에서 60px → 없음, 20px → meadow(28px 이내)
  const [, my] = center(SHOWN[2]);
  await tap(page, SHOWN[2].fx1, my, 60, 0);
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('단어를 찾지 못했어요')", 3000);
  assert.deepEqual(await picks(page), ['journey', 'harvest']);
  await tap(page, SHOWN[2].fx1, my, 20, 0);
  await waitPicks(page, ['journey', 'harvest', 'meadow']);
  assert.equal((await boxes(page)).filter(b => b.picked).length, 3);
  assert.equal(await page.text('[data-ocr-pick-count]'), '3 / 20');
  errs(page);
});

test('목록 편집: 위/아래 이동(경계 버튼 비활성)·삭제, 버튼 44px 이상, 담긴 박스 강조도 따라간다', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await enterTouch(page);
  await pickWords(page, SHOWN.slice(0, 3));
  await waitPicks(page, ['journey', 'harvest', 'meadow']);
  assert.equal(await page.eval("document.querySelector('[data-ocr-picks] li:first-child .ocr-pick-btn.up').disabled"), true, '맨 위는 위로 불가');
  assert.equal(await page.eval("document.querySelector('[data-ocr-picks] li:last-child .ocr-pick-btn.down').disabled"), true, '맨 아래는 아래로 불가');
  const sizes = await page.eval("[...document.querySelectorAll('[data-ocr-picks] li:nth-child(2) .ocr-pick-btn')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; })");
  assert.equal(sizes.length, 3);
  for (const [w, h] of sizes) assert.ok(w >= 44 && h >= 44, `버튼 44px 이상: ${w}x${h}`);
  await page.click('[data-ocr-picks] li:nth-child(2) .ocr-pick-btn.up');
  await waitPicks(page, ['harvest', 'journey', 'meadow']);
  await page.click('[data-ocr-picks] li:nth-child(2) .ocr-pick-btn.down');
  await waitPicks(page, ['harvest', 'meadow', 'journey']);
  await page.click('[data-ocr-picks] li:nth-child(3) .ocr-pick-btn.del');       // journey 삭제
  await waitPicks(page, ['harvest', 'meadow']);
  assert.equal((await boxes(page)).filter(b => b.picked).length, 2, '삭제하면 그 박스의 강조가 풀림');
  await tapWord(page, SHOWN[0]);                                                 // 지운 단어는 다시 담을 수 있다
  await waitPicks(page, ['harvest', 'meadow', 'journey']);
  errs(page);
});

test('최대 20개: 21번째는 담기지 않고 안내, 시트는 패널 높이의 40% 이하이며 목록이 스크롤된다', { skip: SKIP, timeout: 90000 }, async t => {
  const page = await openDict(t);
  await cfg(page, { grid: true });
  await enterTouch(page);
  const words = Array.from({ length: 24 }, (_, i) => ({ fx0: 0.03 + (i % 4) * 0.24, fy0: 0.12 + Math.floor(i / 4) * 0.06, fx1: 0.03 + (i % 4) * 0.24 + 0.2, fy1: 0.12 + Math.floor(i / 4) * 0.06 + 0.03 }));
  await pickWords(page, words.slice(0, 20));
  await page.waitFor("document.querySelectorAll('[data-ocr-picks] li').length === 20", 9000, '20개');
  assert.equal(await page.text('[data-ocr-pick-count]'), '20 / 20');
  await tapWord(page, words[20]);
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('20개까지')", 3000, '상한 안내');
  assert.equal((await picks(page)).length, 20, '21번째는 담기지 않음');
  const m = await page.eval(`(() => { const p = document.getElementById('ocr-scanner').getBoundingClientRect(), s = document.querySelector('[data-ocr-sheet]').getBoundingClientRect(), l = document.querySelector('[data-ocr-picks]');
    return { sheet: s.height, panel: p.height, scroll: l.scrollHeight, client: l.clientHeight, bottom: s.bottom, panelBottom: p.bottom }; })()`);
  assert.ok(m.sheet <= m.panel * 0.4 + 1, `시트 높이 ${m.sheet} <= 패널의 40% (${m.panel * 0.4})`);
  assert.ok(m.scroll > m.client, `목록은 시트 안에서 스크롤: ${m.scroll} > ${m.client}`);
  assert.ok(Math.abs(m.bottom - m.panelBottom) <= 1, '시트는 패널 아래에 붙음');
  assert.equal(await page.hasHorizontalScroll(), false);
  errs(page);
});

test('[검색 시작]: 첫 단어를 검색하고 n/N·[다음]으로 순서대로, 목록은 비워지지 않음. 목록 1개면 n/N 숨김', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await page.eval("showPage('wordbook'); 0");
  await enterTouch(page);
  assert.equal(await page.eval("document.querySelector('[data-ocr-pick-go]').disabled"), true, '빈 목록에서는 검색 시작 불가');
  assert.equal(await page.eval("document.querySelector('[data-ocr-picks-empty]').hidden"), false, '빈 상태 안내');
  await pickWords(page, [SHOWN[1], SHOWN[0], SHOWN[2]]);
  await waitPicks(page, ['harvest', 'journey', 'meadow']);
  assert.equal(await page.eval("document.querySelector('[data-ocr-picks-empty]').hidden"), true);
  await page.click('[data-ocr-pick-go]');
  await page.waitFor("document.getElementById('ocr-scanner').hidden", 4000, '패널 닫힘');
  await page.waitFor("!!document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'harvest'", 8000, '첫 단어 결과');
  await sleep(400);
  assert.equal(await page.eval("document.querySelector('.page.active').id"), 'page-search', '다른 탭에서 열었어도 검색 탭');
  assert.equal(await page.text('#ocr-nav-counter'), '1 / 3');
  await page.click('#ocr-nav-next');
  await page.waitFor("document.getElementById('search-input').value === 'journey' && document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === 'journey'", 8000);
  assert.equal(await page.text('#ocr-nav-counter'), '2 / 3');
  await page.click('#ocr-nav-next');
  await page.waitFor("document.getElementById('search-input').value === 'meadow'", 8000);
  assert.equal(await page.eval("document.getElementById('ocr-nav-next').disabled"), true, '마지막에서는 다음 불가');
  // OCR 을 다시 열어도 목록은 그대로, 검색 결과의 n/N 은 지금처럼 초기화
  await openPanel(page);
  assert.equal(await page.eval("document.getElementById('ocr-nav').hidden"), true, 'n/N 큐는 초기화');
  await modeBtn(page, 'touch');
  await waitReady(page);
  assert.deepEqual(await picks(page), ['harvest', 'journey', 'meadow'], '검색을 시작해도, 다시 열어도 목록 유지');
  // 단어 하나만 남기고 검색 → n/N 숨김
  await page.click('[data-ocr-picks] li:nth-child(1) .ocr-pick-btn.del');
  await page.click('[data-ocr-picks] li:nth-child(1) .ocr-pick-btn.del');
  await waitPicks(page, ['meadow']);
  await page.click('[data-ocr-pick-go]');
  await page.waitFor("document.getElementById('search-input').value === 'meadow'", 6000);
  await page.waitFor("document.getElementById('ocr-scanner').hidden", 4000);
  assert.equal(await page.eval("document.getElementById('ocr-nav').hidden"), true, '목록이 1개면 n/N 은 숨겨짐');
  errs(page);
});

test('시트는 history 를 쓰지 않는다: 담기·편집 중 history 길이 불변, 뒤로가기는 패널 전체 닫기이고 목록은 유지', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await openPanel(page);
  const len0 = await page.eval('history.length');
  await modeBtn(page, 'touch');
  await waitReady(page);
  await pickWords(page, [SHOWN[0], SHOWN[1]]);
  await waitPicks(page, ['journey', 'harvest']);
  await page.click('[data-ocr-picks] li:nth-child(2) .ocr-pick-btn.up');
  await waitPicks(page, ['harvest', 'journey']);
  assert.equal(await page.eval('history.length'), len0, '시트 조작은 history 를 늘리지 않음');
  await page.eval('history.back(); 0');
  await page.waitFor("document.getElementById('ocr-scanner').hidden", 4000, '뒤로가기로 패널 닫힘');
  await openPanel(page);
  await modeBtn(page, 'touch');
  await waitReady(page);
  assert.deepEqual(await picks(page), ['harvest', 'journey'], '닫았다 열어도 목록 유지');
  errs(page);
});

test('카메라·엔진 준비 전 터치는 인식하지 않고 안내만, 준비되면 담기', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await cfg(page, { loadDelay: 1500 });
  await openPanel(page);
  await modeBtn(page, 'touch');
  await tap(page, 0.3, 0.3);
  assert.match(await msg(page), /준비하는 중/);
  assert.equal((await log(page)).rec, 0, '준비 전에는 인식하지 않음');
  assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false);
  await waitReady(page);
  await tapWord(page, SHOWN[0]);
  await waitPicks(page, ['journey']);
  errs(page);
});

test('인식 중 패널을 닫으면 결과를 무시한다(담기지 않음), 다시 열면 자동 모드로 시작하고 영상 재생', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await enterTouch(page);
  await cfg(page, { recMin: 1200, recMax: 1200 });
  await tapWord(page, SHOWN[0]);
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('인식 중')", 3000);
  await page.eval("document.querySelector('[data-ocr-close]').click(); 0");
  await sleep(2200);                                                     // 인식이 끝났을 시간
  assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), true);
  assert.equal(await page.eval("document.getElementById('search-input').value"), '', '검색이 일어나지 않음');
  assert.equal(await page.count('[data-ocr-overlay] .ocr-box'), 0);
  assert.deepEqual(await picks(page), [], '결과가 목록에 담기지 않음');
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
  await enterTouch(page);
  await cfg(page, { recMin: 2500, recMax: 2500 });
  await tapWord(page, SHOWN[0]);
  await page.waitFor("document.querySelector('[data-ocr-touch-msg]').textContent.includes('오래 걸려')", 4000, '시간 제한 안내');
  assert.equal(await page.eval("document.querySelector('[data-ocr-touch-retake]').hidden"), false);
  await sleep(2600);                                                     // 늦게 끝난 인식
  assert.equal(await page.count('[data-ocr-overlay] .ocr-box'), 0, '늦은 결과는 화면에 반영되지 않음');
  assert.deepEqual(await picks(page), []);
  assert.equal(await page.eval("document.getElementById('ocr-scanner').hidden"), false);
  await page.click('[data-ocr-touch-retake]');
  assert.equal(await page.eval("document.querySelector('[data-ocr-video]').paused"), false);
  await cfg(page, { recMin: 40, recMax: 80 });
  await tapWord(page, SHOWN[0]);
  await waitPicks(page, ['journey']);
  errs(page);
});

test('자동 모드는 영향 없음: 후보 칩 선택 → 검색 탭 이동(기존 흐름), 터치 UI·시트는 숨김 상태, 자동 모드 칩 선택은 목록에 담지 않음', { skip: SKIP, timeout: 60000 }, async t => {
  const page = await openDict(t);
  await openPanel(page);
  await startAuto(page);
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 9000);
  assert.equal(await page.eval("document.querySelector('[data-ocr-touch-bar]').hidden"), true);
  assert.equal(await page.eval("getComputedStyle(document.querySelector('[data-ocr-sheet]')).display"), 'none');
  const word = await page.eval("document.querySelector('.ocr-candidate span').textContent");
  await page.eval("document.querySelector('.ocr-candidate').click(); 0");
  await page.waitFor(`document.getElementById('search-input').value === ${JSON.stringify(word)}`, 4000);
  await page.waitFor("document.getElementById('ocr-scanner').hidden", 4000);
  assert.deepEqual(await picks(page), [], '자동 모드 선택은 목록과 무관');
  errs(page);
});
