// 작업267-2: (A) OCR 칩 선택 → 어느 탭에서 열었든 검색 탭 표시·검색 시작, 뒤늦은 popstate가 이전 탭으로 되돌리지 않음
//            (B) AI 호출 시간 제한 → 시간 초과 시 스피너 제거·버튼 복구·다시 시도, 2차 시간 초과는 1차 결과 유지, 늦은 응답은 무시
// 가짜 카메라(캔버스 captureStream) + 가짜 Tesseract + 가짜 /api/ai 를 페이지 안에 주입한다. 스캔 간격만 2000ms → 150ms 로 줄인다.
// 실제 카메라·실제 Tesseract·실제 모바일 브라우저의 뒤로가기 제스처는 대표하지 않는다.
// 실행: node --test "tests/ui/ocr_select_search_tab.ui.test.js"   (Chrome이 없으면 건너뜀)
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
  navigator.mediaDevices.getUserMedia = async () => cam.captureStream(30);
  window.__cfg = { words: ['journey', 'harvest'], ai: 'ok', step2: 'same', aiDelay: 0 };
  window.__log = { ai: 0, posts: 0 };
  window.Tesseract = { createWorker: async () => ({
    recognize: () => new Promise(res => { const c = window.__cfg; setTimeout(() => res({ data: { text: c.words.join(' '), words: c.words.map((x, i) => ({ text: x, confidence: 92, bbox: { x0: 10, y0: 10 + i * 40, x1: 200, y1: 40 + i * 40 } })) } }), 30 + Math.random() * 70); }),
    terminate: async () => {}
  }) };
  const rf = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const url = String(u);
    if (url.startsWith('/api/ai')) {
      const c = window.__cfg; window.__log.ai++;
      const step2 = String(o && o.body).includes('STEP 2');
      const mode = step2 && c.step2 !== 'same' ? c.step2 : c.ai;
      return new Promise((resolve, reject) => {
        const sig = o && o.signal;
        if (sig) sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        if (mode === 'hang') return;
        setTimeout(() => {
          if (mode === 'err502') return resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
          const word = (JSON.parse(o.body).prompt.match(/For the English word or phrase: "([^"]+)"/) || [])[1] || 'x';
          const res = step2
            ? { meanings: [{ usage_note: 'u', example: 'e', translation: 't' }], similar: [], collocations: [] }
            : { word, search_query: word, pronunciation: '/x/', short_gloss: '뜻', meanings: [{ pos: 'noun', domain: '일반', definition: '뜻' }], derivatives: [] };
          resolve(new Response(JSON.stringify({ result: JSON.stringify(res) }), { status: 200 }));
        }, c.aiDelay || 0);
      });
    }
    if (url.startsWith('/api/wordbook')) {
      if (o && o.method === 'POST') { window.__log.posts++; return Promise.resolve(new Response(JSON.stringify({ id: window.__log.posts }), { status: 200 })); }
      return Promise.resolve(new Response('[]', { status: 200 }));
    }
    return rf(u, o);
  };
})()`;

async function openDict(width = 390, height = 844) {
  srv.reset();
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.goto(srv.url + '/english_dictionary.html');
  await page.waitFor("!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", 12000);
  await sleep(300);
  await page.eval("(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()");
  await page.eval(SETUP);
  return page;
}
const state = page => page.eval(`(() => {
  const rs = document.getElementById('search-result');
  return { page: (document.querySelector('.page.active') || {}).id, input: document.getElementById('search-input').value, panelHidden: document.getElementById('ocr-scanner').hidden,
    spinner: !!rs.querySelector('.spinner'), skel: !!rs.querySelector('.skel-block'), btnDisabled: document.getElementById('search-btn').disabled,
    resultWord: (rs.querySelector('.result-word') || {}).textContent || null, retry: !!document.getElementById('search-retry-btn'), detailRetry: !!document.getElementById('detail-retry-btn'),
    nav: !document.getElementById('ocr-nav').hidden ? document.getElementById('ocr-nav-counter').textContent : null, text: rs.innerText.slice(0, 80) };
})()`);
const selectChip = async page => {
  await page.eval(`document.getElementById('ocr-open').click(); document.querySelector('[data-ocr-capture]').click()`);
  await page.waitFor("document.querySelectorAll('.ocr-candidate').length > 0", 8000, '칩');
  return page.eval(`(() => { const b = document.querySelector('.ocr-candidate'); const w = b.querySelector('span').textContent; b.click(); return w; })()`);
};

for (const origin of ['search', 'wordbook', 'quiz']) {
  test(`칩 선택 → 검색 탭 표시·검색 시작, 뒤늦은 popstate 후에도 유지 — ${origin} 탭에서 연 경우 20회`, { skip: SKIP, timeout: 120000 }, async () => {
    const page = await openDict();
    for (let i = 0; i < 20; i++) {
      await page.eval(`window.__cfg.ai = 'ok'; showPage('${origin}'); document.getElementById('search-input').value = ''; document.getElementById('search-result').innerHTML = ''`);
      await sleep(100);
      const word = await selectChip(page);
      await page.waitFor(`!!document.querySelector('#search-result .result-word')`, 4000, `결과 렌더(${origin} #${i})`);
      await sleep(400);   // history.back()의 popstate가 도착하고도 남는 시간
      const s = await state(page);
      assert.equal(s.page, 'page-search', `${origin} #${i}: 검색 탭이 보임`);
      assert.equal(s.input, word, `${origin} #${i}: 입력창에 단어`);
      assert.equal(s.panelHidden, true);
      assert.equal(s.resultWord, word, `${origin} #${i}: 결과 렌더`);
      assert.equal(s.nav, '1 / 2', `${origin} #${i}: 순차 탐색 큐 유지`);
      await page.eval(`showPage('${origin}')`);
    }
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}

test('칩 선택 후 뒤로가기 → 열기 전 탭으로 (단어장 출발) / 검색 출발은 추가 기록 없음', { skip: SKIP, timeout: 60000 }, async () => {
  const page = await openDict();
  await page.eval(`showPage('wordbook')`); await sleep(100);
  await selectChip(page);
  await page.waitFor(`!!document.querySelector('#search-result .result-word')`, 4000);
  await sleep(400);
  await page.eval(`history.back()`); await sleep(400);
  assert.equal((await state(page)).page, 'page-wordbook', '단어장에서 연 경우 뒤로가기는 단어장');
  // 단어장 → (탭 전환으로 검색 탭 기록) → 검색 탭에서 OCR 선택 → 뒤로가기는 일반 탭 이동처럼 바로 앞 기록(단어장)
  await page.eval(`showPage('search')`); await sleep(100);
  await selectChip(page);
  await page.waitFor(`!!document.querySelector('#search-result .result-word')`, 4000);
  await sleep(400);
  await page.eval(`history.back()`); await sleep(500);
  assert.equal((await state(page)).page, 'page-wordbook', '검색 탭에서 연 경우 기존과 같이 추가 기록 없음 → 뒤로가기는 앞 기록');
  await page.close();
});

test('칩 없이 닫는 경로(종료 버튼·뒤로가기)는 기존 그대로: 탭이 바뀌지 않음', { skip: SKIP, timeout: 60000 }, async () => {
  const page = await openDict();
  await page.eval(`showPage('wordbook')`); await sleep(100);
  await page.eval(`document.getElementById('ocr-open').click()`); await sleep(200);
  await page.eval(`document.querySelector('[data-ocr-close]').click()`); await sleep(500);
  let s = await state(page);
  assert.equal(s.page, 'page-wordbook', '종료 버튼 후 단어장 그대로'); assert.equal(s.panelHidden, true);
  await page.eval(`document.getElementById('ocr-open').click()`); await sleep(200);
  await page.eval(`history.back()`); await sleep(500);
  s = await state(page);
  assert.equal(s.page, 'page-wordbook', '뒤로가기로 닫은 뒤 단어장 그대로'); assert.equal(s.panelHidden, true);
  assert.equal(await page.eval('!!window.__ocrSelectPending'), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('AI 무응답: 시간 초과 → 스피너 없음·버튼 활성·다시 시도 표시, 자동 재시도 없음, 누르면 정상 결과', { skip: SKIP, timeout: 60000 }, async () => {
  const page = await openDict();
  await page.eval(`window.__AI_TIMEOUT_MS = 1500; window.__cfg.ai = 'hang'; document.getElementById('search-input').value = 'journey'; doSearch(); 0`);
  await sleep(150);
  let s = await state(page);
  assert.equal(s.spinner, true, '대기 중에는 스피너'); assert.equal(s.btnDisabled, true);
  await page.waitFor(`!!document.getElementById('search-retry-btn')`, 3000, '다시 시도 버튼');
  s = await state(page);
  assert.equal(s.spinner, false); assert.equal(s.btnDisabled, false); assert.match(s.text, /응답이 늦어지고 있습니다/);
  await sleep(1500);
  assert.equal(await page.eval('window.__log.ai'), 1, '자동 재시도 없음');
  await page.eval(`window.__cfg.ai = 'ok'`);
  await page.click('#search-retry-btn');
  await page.waitFor(`!!document.querySelector('#search-result .result-word')`, 4000);
  s = await state(page);
  assert.equal(s.resultWord, 'journey'); assert.equal(s.btnDisabled, false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('2차 호출 시간 초과: 1차 결과 유지·2차 영역에만 안내, 저장은 재시도 성공 뒤 1번', { skip: SKIP, timeout: 60000 }, async () => {
  const page = await openDict();
  await page.eval(`window.__AI_TIMEOUT_MS = 600; window.__cfg.step2 = 'hang'; document.getElementById('search-input').value = 'journey'; doSearch(); 0`);
  await page.waitFor(`!!document.getElementById('detail-retry-btn')`, 4000, '2차 재시도 버튼');
  let s = await state(page);
  assert.equal(s.resultWord, 'journey', '1차 결과 유지'); assert.equal(s.skel, false, '스켈레톤 없음'); assert.equal(s.btnDisabled, false);
  assert.equal(await page.eval('window.__log.posts'), 0, '반쪽 결과는 저장하지 않음');
  assert.equal(await page.eval(`document.querySelector('#search-result').innerText.includes('추가 정보를 불러오지 못했습니다')`), true);
  await sleep(1200);
  assert.equal(await page.eval('window.__log.ai'), 2, '자동 재시도 없음');
  await page.eval(`window.__cfg.step2 = 'same'; window.__cfg.ai = 'ok'`);
  await page.click('#detail-retry-btn');
  await page.waitFor(`!document.getElementById('detail-retry-btn') && !document.querySelector('#search-result .skel-block') && window.__log.posts === 1`, 4000, '재시도 성공·저장 1회');
  await sleep(400);
  assert.equal(await page.eval('window.__log.posts'), 1, '중복 저장 없음');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('시간 초과 뒤 늦게 오는 응답은 화면·저장에 반영되지 않음 / 제한 안의 지연 응답·502는 기존 동작', { skip: SKIP, timeout: 60000 }, async () => {
  const page = await openDict();
  // 늦은 응답: abort 된 요청은 거부되므로 이후 화면은 시간 초과 카드 그대로
  await page.eval(`window.__AI_TIMEOUT_MS = 400; window.__cfg.aiDelay = 1200; document.getElementById('search-input').value = 'journey'; doSearch(); 0`);
  await page.waitFor(`!!document.getElementById('search-retry-btn')`, 3000);
  await sleep(1800);
  let s = await state(page);
  assert.equal(s.retry, true); assert.equal(s.resultWord, null); assert.equal(await page.eval('window.__log.posts'), 0);
  // 제한 안의 지연: 정상 표시
  await page.eval(`window.__AI_TIMEOUT_MS = 5000; window.__cfg.aiDelay = 800; document.getElementById('search-input').value = 'harvest'; doSearch(); 0`);
  await page.waitFor(`!!document.querySelector('#search-result .result-word') && window.__log.posts === 1`, 6000);
  assert.equal((await state(page)).resultWord, 'harvest');
  // 502 HTML: 오류 카드(다시 시도 버튼 없음)
  await page.eval(`window.__cfg.aiDelay = 0; window.__cfg.ai = 'err502'; document.getElementById('search-input').value = 'meadow'; doSearch(); 0`);
  await page.waitFor(`document.querySelector('#search-result').innerText.includes('오류가 발생했습니다')`, 3000);
  s = await state(page);
  assert.equal(s.retry, false); assert.equal(s.btnDisabled, false); assert.equal(s.spinner, false);
  await page.close();
});
