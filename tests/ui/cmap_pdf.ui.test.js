// 작업292-1: 지도 PDF 저장 버튼. 서버는 실제 routes/concept_map.js + 가짜 DB.
// 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_pdf.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { tabIn } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t, width = 390, height = 844) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width, height, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const tapNode = (page, id) => page.click(`[data-node="${id}"] rect`);
const setSel = (page, sel, v) => page.eval(`(() => { const s = document.getElementById(${JSON.stringify(sel)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`);

async function world(page, withEdge = true) {
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학/물리: 1?' })).topic;
  const ids = [];
  for (const term of ['a개념', 'b개념', 'c개념']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  {
    const at = [[130, 20], [20, 150], [250, 150]];
    for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: at[i][0], y: at[i][1] }); }
    if (withEdge) await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[1], relation_type: '사용', label: '기존' });
    await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  }
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000); await sleep(250);
  return { top, ids, map };
}
const stub = (page, delay) => page.eval(`(() => { window.__calls = []; window.CmapPdf.deliverImpl = async (blob, name) => { const b = new Uint8Array(await blob.arrayBuffer()); window.__calls.push({ size: blob.size, type: blob.type, name, head: String.fromCharCode(...b.slice(0, 5)), tail: String.fromCharCode(...b.slice(-6)) }); await new Promise(r => setTimeout(r, ${delay})); return 'stub'; }; })()`);

for (const [w, h] of [[390, 844], [320, 640]]) {
  test(`PDF 저장 버튼(${w}px): 툴바 4개 미겹침·44px·가로 스크롤 없음, 클릭 시 PDF 생성·내보내기, 중복 클릭 1회, 저장 상태 불변`, { skip: SKIP, timeout: 90000 }, async t => {
    const { page } = await open(t, w, h);
    await world(page);
    await page.waitFor("document.querySelectorAll('[data-node]').length === 3", 6000);
    const lay = await page.eval("(() => { const r = [...document.querySelectorAll('#map-sheet .tool-row .tool')].filter(b => b.offsetParent !== null).map(b => { const q = b.getBoundingClientRect(); return { id: b.id, l: q.left, r: q.right, h: q.height }; }); return { r, sw: document.getElementById('map-sheet').scrollWidth, cw: document.getElementById('map-sheet').clientWidth, row: document.querySelector('#map-sheet .tool-row').scrollWidth, rowc: document.querySelector('#map-sheet .tool-row').clientWidth, lh: [...document.querySelectorAll('#map-sheet .tool-row .tool span')].map(s => s.getBoundingClientRect().height) }; })()");
    assert.equal(lay.r.length, 4, '버튼 4개');
    for (let i = 1; i < lay.r.length; i++) assert.ok(lay.r[i].l >= lay.r[i - 1].r - 0.5, '겹치지 않음');
    assert.ok(lay.r.every(b => b.h >= 44), '높이 44px 이상');
    assert.ok(lay.row <= lay.rowc && lay.sw <= lay.cw, '가로 스크롤 없음');
    assert.ok(lay.lh.every(x => x < 20), '라벨 한 줄');
    assert.equal(await page.text('#map-pdf-label'), 'PDF 저장');
    const saveBefore = await page.eval('JSON.stringify([document.getElementById("map-save-state").textContent, document.getElementById("map-meta") && document.getElementById("map-meta").textContent])');
    await stub(page, 400);
    await page.eval("(() => { const b = document.getElementById('map-pdf'); b.click(); b.click(); })()");   // 같은 순간의 중복 클릭
    assert.equal(await page.eval("document.getElementById('map-pdf').disabled"), true, '만드는 중 비활성');
    assert.equal(await page.text('#map-pdf-label'), '만드는 중…');
    await page.waitFor("window.__calls.length >= 1 && !document.getElementById('map-pdf').disabled", 15000, 'PDF 생성');
    await sleep(300);
    const calls = await page.eval('window.__calls');
    assert.equal(calls.length, 1, '중복 클릭은 한 번만');
    assert.equal(calls[0].type, 'application/pdf');
    assert.ok(calls[0].size > 2000, 'PDF 크기 ' + calls[0].size);
    assert.equal(calls[0].head, '%PDF-');
    assert.match(calls[0].tail, /%%EOF/);
    assert.match(calls[0].name, /^지도-과학물리1-\d{8}\.pdf$/);
    assert.equal(await page.text('#map-pdf-label'), 'PDF 저장');
    assert.equal(await page.eval('JSON.stringify([document.getElementById("map-save-state").textContent, document.getElementById("map-meta") && document.getElementById("map-meta").textContent])'), saveBefore, '지도 저장 상태 불변');
    assert.equal(await page.text('#map-msg'), '', '오류 없음');
    // 실패하면 시트 안에 한 줄 오류
    await page.eval("window.CmapPdf.deliverImpl = async () => { throw new Error('x'); }");
    await page.click('#map-pdf');
    await page.waitFor("document.getElementById('map-msg').textContent.length > 0", 8000, '오류 한 줄');
    // 공유 시트 취소는 오류가 아니다
    await page.eval("window.CmapPdf.deliverImpl = async () => 'cancelled'");
    await page.eval("document.getElementById('map-msg').textContent = ''");
    await page.click('#map-pdf'); await sleep(1500);
    assert.equal(await page.text('#map-msg'), '');
    noErrors(page);
  });
}

test('빈 지도: 버튼 비활성', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  await world(page, false);   // 선이 없어야 확인 대화상자 없이 노드를 뺄 수 있다
  assert.equal(await page.eval("document.getElementById('map-pdf').disabled"), false, '노드가 있으면 활성');
  await page.eval('window.CmapMap.applySelection([]).then(() => 0)');
  await page.waitFor("document.querySelectorAll('[data-node]').length === 0", 5000, '노드 0개');
  assert.equal(await page.eval("document.getElementById('map-pdf').disabled"), true);
  assert.ok((await page.eval("document.getElementById('map-pdf').title")).length > 0);
  noErrors(page);
});

test('다운로드 경로: 공유를 쓸 수 없으면 <a download> 로 내려받는다(파일 이름 확인)', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  await world(page);
  const r = await page.eval(`(async () => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); const got = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { got.push(this.download); }; try { const st = await window.CmapPdf.deliverImpl(new Blob(['x'], { type: 'application/pdf' }), '지도-테스트-20261016.pdf'); return { st, got }; } finally { HTMLAnchorElement.prototype.click = orig; } })()`);
  assert.deepEqual(r, { st: 'downloaded', got: ['지도-테스트-20261016.pdf'] });
  noErrors(page);
});

// 293-1: 하위 주제에서 저장하면 제목에 경로·범위 줄, 최상위 주제에서는 범위 줄 없음
async function nested(page, enterChild) {
  const root = (await seed(page, 'POST', '/api/cmap/topics', { title: '자본시장' })).topic;
  const mid = (await seed(page, 'POST', '/api/cmap/topics', { title: '증권 시장', parent_id: root.id })).topic;
  const leaf = (await seed(page, 'POST', '/api/cmap/topics', { title: '주식', parent_id: mid.id })).topic;
  const ids = [];
  for (const term of ['a개념', 'b개념']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${leaf.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${root.id}/map`)).map;
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: 20 + i * 200, y: 40 }); }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  await page.eval('refresh()');
  const cur = { root, mid, leaf }[enterChild];
  await page.eval(`Nav.enterTopic(${cur.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open && document.querySelectorAll('[data-node]').length === 2", 6000); await sleep(250);
}
for (const [w, h] of [[390, 844], [320, 640]]) {
  for (const [lvl, title, scope, file] of [['leaf', '자본시장 > 증권 시장 > 주식', '지도 범위: ‘자본시장’ 전체', /^지도-자본시장-증권시장-주식-\d{8}\.pdf$/], ['mid', '자본시장 > 증권 시장', '지도 범위: ‘자본시장’ 전체', /^지도-자본시장-증권시장-\d{8}\.pdf$/], ['root', '자본시장', '', /^지도-자본시장-\d{8}\.pdf$/]]) {
    test(`PDF 제목 경로(${w}px, ${lvl}): 제목 데이터와 범위 줄, 파일 이름`, { skip: SKIP, timeout: 90000 }, async t => {
      const { page } = await open(t, w, h);
      await nested(page, lvl);
      await stub(page, 0);
      await page.eval("document.getElementById('map-pdf').click()");
      await page.waitFor('window.__calls.length === 1', 15000, 'PDF 생성');
      const meta = await page.eval('window.CmapPdf.lastMeta');
      assert.equal(meta.title, title);
      assert.equal(meta.scope, scope);
      assert.ok(meta.lines.length >= 1 && meta.lines.length <= 2);
      assert.match((await page.eval('window.__calls'))[0].name, file);
      assert.equal(await page.text('#map-msg'), '');
      noErrors(page);
    });
  }
}
