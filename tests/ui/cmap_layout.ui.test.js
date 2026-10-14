// 작업274-2: 개념 지도 화면 레이아웃 — 섹션 내부 스크롤 없음(페이지 전체가 스크롤), 섹션 박스 없음(테두리·배경·그림자·둥근 모서리로 감싼 카드 없음), 터치 대상 44px 이상, 가로 스크롤 없음,
// 지도 캔버스는 높이 고정 + 캔버스 위 제스처(휠 확대)와 페이지 스크롤이 서로 침범하지 않음. 예외: <dialog> 내부 스크롤, 지도 SVG 캔버스, 입력창(textarea)의 자체 스크롤.
// 서버는 실제 routes/concept_map.js + 가짜 DB, AI 는 모의. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_layout.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const EXPL = { english: 'inertia', definition: '물체가 원래 운동 상태를 유지하려는 성질입니다.', example: '버스가 갑자기 서면 몸이 앞으로 쏠립니다.', simple_text: '가만히 있던 것은 계속 가만히 있으려 합니다.', deeper_text: '관성의 크기는 질량으로 나타냅니다.' };
// 과학(물리): 개념 N개(길게 만들어 목록이 화면보다 길어지게), 앞 4개를 지도에 넣고 연결 2개, 저장
async function world(page, srv, { n = 30 } = {}) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, { term: '개념' + i, english: 'concept' + i, memo: '메모 ' + i })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  const at = [[150, 20], [20, 130], [280, 130], [150, 240]];
  for (let i = 0; i < 4; i++) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: ids[i] }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${ids[i]}`, { x: at[i][0], y: at[i][1] }); }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[1], label: '만든다', relation_type: '일으킴' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[2], to_concept_id: ids[0], label: '클수록', relation_type: '사용' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  srv.anthropic.handler = p => /개념 지도를 읽고/.test(p.system || '')
    ? JSON.stringify({ summary: '요약입니다.', story: [{ text: '개념0 과 개념1 과 개념2 이야기입니다. 개념3 은 따로입니다.', concept_ids: ids.slice(0, 4) }], mnemonic: ['기억'], suggestions: [{ term: '운동량', reason: '이유', near_concept_id: ids[0] }] })
    : JSON.stringify(EXPL);
  await page.eval('refresh()'); await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor(`document.querySelectorAll('#concept-list > *').length >= ${n}`, 8000, '개념 목록');
  return { sci, ids, map };
}
// 섹션 내부 스크롤·고정 max-height·박스 감사. 예외: dialog 안, 지도 SVG, 입력 요소(textarea 등)
const AUDIT = `(() => {
  const scroll = [], maxh = [], boxes = [];
  const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && e.className.baseVal === undefined ? '.' + String(e.className).trim().split(/\\s+/).join('.') : '');
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest('dialog') || e.closest('svg') || ['TEXTAREA', 'INPUT', 'SELECT', 'SCRIPT', 'STYLE'].includes(e.tagName)) continue;
    const cs = getComputedStyle(e);
    if (['auto', 'scroll'].includes(cs.overflowY) || ['auto', 'scroll'].includes(cs.overflowX)) scroll.push(name(e));
    if (cs.maxHeight !== 'none') maxh.push(name(e) + ' ' + cs.maxHeight);
  }
  const sel = ['.map-pick', '.explain-card', '.narr-para', '.narr-sug', '.narr-stale', '.narr-error', '.quiz-answers li', '.quiz-score', '.c-item:not(.hl)', '#concepts-sec', '#topics-sec', '#narr-panel', '#review-panel', '#quiz-panel'];
  for (const s of sel) for (const e of document.querySelectorAll(s)) {
    if (e.offsetParent === null) continue;
    const cs = getComputedStyle(e);
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map(k => parseFloat(cs['border' + k + 'Width']) > 0 && cs['border' + k + 'Style'] !== 'none');
    const enclosed = bw.every(Boolean);
    const rounded = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].some(k => parseFloat(cs['border' + k + 'Radius']) > 0);
    const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    const shadow = cs.boxShadow !== 'none';
    if (enclosed || rounded || filled || shadow) boxes.push(s + ' ' + JSON.stringify({ enclosed, rounded, filled, shadow }));
  }
  return { scroll, maxh, boxes };
})()`;
const audit = async (page, label) => {
  const r = await page.eval(AUDIT);
  assert.deepEqual(r.scroll, [], label + ': 섹션 내부 스크롤 없음');
  assert.deepEqual(r.maxh, [], label + ': 고정 max-height 없음');
  assert.deepEqual(r.boxes, [], label + ': 섹션 박스 없음');
  assert.equal(await page.hasHorizontalScroll(), false, label + ': 가로 스크롤 없음');
};
const minHeight = (page, sel) => page.eval(`(() => { const l = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect().height); return l.length ? Math.min(...l) : null; })()`);
const longPage = async page => { const r = await page.eval('({ h: document.documentElement.scrollHeight, w: window.innerHeight })'); assert.ok(r.h > r.w * 1.3, `페이지가 화면보다 충분히 긺: ${r.h} / ${r.w}`); };
const pageScrolls = async page => { await page.eval('window.scrollTo(0, 0); 0'); await page.eval('window.scrollTo(0, 99999); 0'); return page.eval('window.scrollY'); };

test('주제 화면: 주제 트리·개념 목록·설명 카드가 내부 스크롤·박스 없이 페이지 전체로 스크롤되고 목록 줄은 44px 이상', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  await world(page, srv);
  await page.eval("document.getElementById('explain-term').value = '관성'; document.getElementById('explain-form').requestSubmit(); 0");
  await page.waitFor("!document.getElementById('explain-card').hidden && !!document.querySelector('#explain-card textarea')", 6000, '설명 카드');
  await audit(page, '주제 화면');
  await longPage(page);
  assert.ok(await pageScrolls(page) > 500, '페이지 전체가 스크롤됨');
  for (const sel of ['.t-row', '.c-tools .btn', '#explain-go', '#add-concept-btn']) assert.ok(await minHeight(page, sel) >= 44, sel);
  // 설명 카드 안에서도 스크롤 영역이 없다(카드가 내용만큼 늘어남)
  const card = await page.eval("(() => { const c = document.getElementById('explain-card'); return { sh: c.scrollHeight, ch: c.clientHeight }; })()");
  assert.equal(card.sh, card.ch);
});

test('지도 탭: 페이지에는 [지도 열기]와 한 줄 상태만 있고 캔버스는 시트 안에 있다. 개념 선택 목록은 시트 안(대화상자 예외)에서만 스크롤된다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page, srv);
  await page.click('#act-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000, '지도 화면');
  assert.equal(await page.eval("document.getElementById('map-canvas').offsetParent === null"), true, '페이지에는 지도 캔버스가 없음');
  assert.match(await page.eval("document.getElementById('map-meta').textContent"), /^개념 4개 · 연결 2개 · 저장됨$/);
  await audit(page, '지도 탭(페이지)');
  assert.ok(await minHeight(page, '#map-open') >= 44); assert.ok(await minHeight(page, '.map-tab') >= 44);
  await page.click('#map-open');
  await page.waitFor("document.getElementById('map-sheet').open", 4000, '지도 시트');
  await page.click('#map-pick-toggle');
  await page.waitFor(`document.querySelectorAll('#map-pick-list .pick-row').length === ${w.ids.length}`, 4000, '선택 목록');
  const box = await page.eval("(() => { const d = document.getElementById('map-sheet'), p = document.getElementById('map-pick-panel'), c = document.getElementById('map-canvas'); return { inDialog: d.contains(p), ov: getComputedStyle(p).overflowY, ph: p.getBoundingClientRect().height, dh: d.getBoundingClientRect().height, sh: p.scrollHeight, ch: p.clientHeight, canvasH: c.getBoundingClientRect().height }; })()");
  assert.equal(box.inDialog, true); assert.equal(box.ov, 'auto', '시트(대화상자) 안이라 선택 목록은 안에서 스크롤');
  assert.ok(box.sh > box.ch && box.ph <= box.dh * 0.46, JSON.stringify(box));
  assert.ok(box.canvasH >= 160, '선택 목록을 열어도 지도가 남아 있음');
  assert.ok(await minHeight(page, '#map-pick-list .pick-row') >= 44);
  assert.equal(await page.hasHorizontalScroll(), false);
});

test('캔버스 제스처와 페이지 스크롤: 시트가 열려 있는 동안 배경 페이지는 스크롤되지 않고, 캔버스 위 휠은 확대만 한다(캔버스에서 시작한 스크롤이 페이지를 막던 한계는 시트로 해결)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  await world(page, srv);
  await page.click('#act-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000);
  await page.eval("document.body.style.minHeight = '3000px'; window.scrollTo(0, 300); 0");
  const y0 = await page.eval('window.scrollY');
  assert.ok(y0 > 0);
  await page.eval("document.getElementById('map-open').click(); 0");   // 마우스 클릭은 버튼을 화면 가운데로 스크롤하므로 스크롤 위치를 그대로 두고 연다
  await page.waitFor("document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.eval("getComputedStyle(document.documentElement).overflow"), 'hidden', '시트가 열려 있으면 배경 스크롤 잠금');
  const c = await page.eval("(() => { const r = document.getElementById('map-svg').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  const yOpen = await page.eval('window.scrollY');
  const scale0 = (await page.eval('window.CmapMap._state()')).view.scale;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -120 });
  assert.ok((await page.eval('window.CmapMap._state()')).view.scale > scale0, '캔버스 위 휠 = 확대');
  assert.equal(await page.eval('window.scrollY'), yOpen, '배경 페이지는 움직이지 않음');
  assert.equal(await page.eval("getComputedStyle(document.getElementById('map-svg')).touchAction"), 'none', '캔버스는 제스처 전용');
  await page.click('#map-sheet-close');
  await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.eval('window.scrollY'), y0, '닫으면 원래 스크롤 위치로 돌아옴');
  assert.notEqual(await page.eval("getComputedStyle(document.documentElement).overflow"), 'hidden', '닫으면 페이지 스크롤 가능');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 500, deltaX: 0, deltaY: 200 });
  await sleep(200);
  assert.ok(await page.eval('window.scrollY') > y0, '시트 밖(페이지)에서는 휠로 스크롤됨');
});

test('해설·복습·퀴즈 결과 화면: 내부 스크롤·박스 없음, 줄 높이 44px 이상, 페이지 전체 스크롤', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  await world(page, srv, { n: 6 });
  await page.click('#act-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000);
  // 해설
  await page.click('#tab-narr'); await page.waitFor("!!document.getElementById('narr-make')", 4000);
  await page.click('#narr-make'); await page.waitFor("!!document.getElementById('narr-summary')", 6000);
  await audit(page, '해설 탭');
  assert.ok(await minHeight(page, '.narr-para') >= 44); assert.ok(await minHeight(page, '.narr-sug [data-act]') >= 44);
  await page.click('[data-para="0"] [data-act=show-map]');
  await page.waitFor("document.getElementById('map-sheet').open", 4000);
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  await audit(page, '해설 탭(단락 선택)');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.narr-para.sel')).borderLeftWidth"), '3px', '선택은 왼쪽 막대로 표시');
  // 복습
  await page.click('#tab-review'); await page.waitFor("!!document.getElementById('quiz-start')", 4000);
  await page.waitFor("!!document.getElementById('review-summary')", 4000);
  await audit(page, '복습 탭');
  assert.ok(await minHeight(page, '#review-panel .narr-para') >= 44);
  // 퀴즈: 답 목록 + 결과
  await page.click('#quiz-start'); await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode')", 6000);
  const nodes = await page.eval("[...document.querySelectorAll('[data-node]')].map(e => Number(e.dataset.node))");
  await page.click(`[data-node="${nodes[0]}"] rect`); await page.click(`[data-node="${nodes[1]}"] rect`);
  await page.waitFor("document.getElementById('quiz-dlg').open", 3000); await page.click('#quiz-add');
  await page.waitFor("!document.getElementById('quiz-dlg').open && document.querySelectorAll('#quiz-answers li').length === 1", 3000);
  await audit(page, '퀴즈 입력');
  assert.ok(await minHeight(page, '#quiz-answers li') >= 44);
  await page.click('#quiz-submit'); await page.waitFor("!!document.getElementById('quiz-result')", 6000);
  await audit(page, '퀴즈 결과');
  assert.equal(await page.eval("(() => { const r = [...document.querySelectorAll('.quiz-score')].map(e => e.getBoundingClientRect()); return r.length === 3 && r.every(x => x.top === r[0].top && x.right <= window.innerWidth); })()"), true);
});

test('대화상자는 내용이 화면보다 길면 안에서 스크롤된다(예외 유지)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  await world(page, srv, { n: 2 });
  await page.click('#add-concept-btn');
  await page.waitFor("document.getElementById('concept-dlg').open", 3000, '개념 대화상자');
  await page.eval("document.getElementById('concept-dlg').style.maxHeight = '300px'; 0");
  const r = await page.eval("(() => { const d = document.getElementById('concept-dlg'); return { ov: getComputedStyle(d).overflowY, sh: d.scrollHeight, ch: d.clientHeight }; })()");
  assert.equal(r.ov, 'auto'); assert.ok(r.sh > r.ch, '내용이 더 길어 안에서 스크롤');
});
