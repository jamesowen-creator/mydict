// 작업299-1: 지도 선·화살촉·라벨 절제 값 — 선 굵기 1.2, 화살촉 marker 7(방향 있음만), 라벨 둘레 5px + 둥근 이음. 편집 시트·읽기 전용 시트·퀴즈 모드·PDF 가 같은 값을 쓴다.
// 서버는 실제 routes/concept_map.js + 가짜 DB. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_edge_style.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);

async function world(t) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (const term of ['a개념', 'b개념', 'c개념']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  const at = [[130, 20], [20, 200], [250, 200]];
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: at[i][0], y: at[i][1] }); }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[1], relation_type: '일부', label: '방향 있음' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[1], to_concept_id: ids[2], relation_type: '대립', label: '반대' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[2], relation_type: '종류', label: '닮음' });
  await page.eval('refresh()'); await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000); await sleep(250);
  await page.click('#map-fit');
  return { page, ids, top, map };
}
// 화면의 선·화살촉·라벨 스타일 값(계산 스타일). 대립(점선)·방향 없음(유사) 포함
const readStyle = page => page.eval(`(() => {
  const lines = [...document.querySelectorAll('#map-svg .m-edge')].map(g => { const l = g.querySelector('.m-edge-line'), cs = getComputedStyle(l), t = g.querySelector('.m-edge-label'), ts = getComputedStyle(t);
    return { opp: g.classList.contains('m-edge-opp'), w: cs.strokeWidth, dash: cs.strokeDasharray, color: cs.stroke, marker: l.getAttribute('marker-end'), mstart: l.getAttribute('marker-start'), label: t.textContent, lw: ts.strokeWidth, join: ts.strokeLinejoin, po: ts.paintOrder, fs: ts.fontSize, lstroke: ts.stroke, lfill: ts.fill }; });
  const m = document.querySelector('#map-svg marker#m-arrow');
  const hit = document.querySelector('#map-svg .m-edge-hit');
  return { lines, marker: m ? { w: m.getAttribute('markerWidth'), h: m.getAttribute('markerHeight') } : null, hit: hit ? getComputedStyle(hit).strokeWidth : null,
    surface: getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim(), sub: getComputedStyle(document.documentElement).getPropertyValue('--color-text-sub').trim() };
})()`);
function check(st, { labels = true } = {}) {
  assert.ok(st.lines.length >= 1);
  for (const l of st.lines) {
    // 307-1: 일반 선은 1.2, 대립은 굵게 2.2 + 점선 폐지(실선)
    if (l.opp) { assert.equal(l.w, '2.2px', '대립 선 굵기 2.2'); assert.equal(l.dash, 'none', '대립 점선 폐지'); }
    else assert.equal(l.w, '1.2px', '선 굵기 1.2');
    if (labels && l.label) {
      assert.equal(l.lw, '5px', '라벨 둘레 5px'); assert.equal(l.join, 'round', '둥근 이음'); assert.match(l.po, /^stroke/, 'paint-order: stroke');
      assert.equal(l.fs, '12px');
    }
  }
  assert.deepEqual(st.marker, { w: '7', h: '7' }, '화살촉 7');
}

test('편집 시트: 선 1.2(대립만 2.2 실선)·일반 화살촉 7(옛 방향 있음 유형만)·대립 양쪽 화살촉·라벨 둘레 5px 둥근 이음, 클릭 영역 28px 유지', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await world(t);
  const st = await readStyle(page);
  assert.equal(st.lines.length, 3);
  check(st);
  assert.deepEqual(st.lines.map(l => [l.label, !!l.marker]).sort(), [['닮음', false], ['반대', true], ['방향 있음', true]], '옛 방향 있음 유형은 끝 화살촉, 옛 유사는 없음, 대립은 끝+시작(307-1)');
  assert.deepEqual(st.lines.map(l => [l.label, l.mstart]).sort(), [['닮음', null], ['반대', 'url(#m-arrow-opp)'], ['방향 있음', null]], '시작 화살촉은 대립만');
  assert.equal(st.hit, '28px', '클릭 영역은 그대로');
  assert.ok(st.lines.find(l => l.opp).color !== st.lines.find(l => !l.opp).color, '대립은 다른 색(기존 규칙)');
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('읽기 전용 시트(해설·복습 모드)와 퀴즈 모드도 같은 값을 쓴다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page, ids } = await world(t);
  await page.eval("window.CmapMap.setMode('narr'); 0");
  await page.waitFor("document.querySelectorAll('#map-svg .m-edge').length === 3", 4000, '읽기 전용 지도');
  check(await readStyle(page));
  await page.eval("window.CmapMap.setMode('map'); 0");
  await page.eval(`window.CmapMap.quizBegin([{ id: ${ids[0]}, term: 'a개념' }, { id: ${ids[1]}, term: 'b개념' }, { id: ${ids[2]}, term: 'c개념' }]); window.CmapMap.setMode('quiz'); window.CmapMap.quizSetAnswers([{ from: ${ids[0]}, to: ${ids[1]}, type: '일부' }, { from: ${ids[1]}, to: ${ids[2]}, type: '대립' }, { from: ${ids[0]}, to: ${ids[2]}, type: '종류' }]); 0`);
  await page.waitFor("document.querySelectorAll('#map-svg .m-edge').length === 3 && !!document.querySelector('#map-svg [data-answer]')", 4000, '퀴즈 지도');
  const q = await readStyle(page);
  check(q);
  assert.deepEqual(q.lines.map(l => !!l.marker).sort(), [false, true, true], '퀴즈에서도 같은 규칙(대립 포함 끝 화살촉)');
  assert.equal(q.lines.filter(l => l.mstart === 'url(#m-arrow-opp)').length, 1, '퀴즈에서도 대립만 시작 화살촉');
  await page.eval("window.CmapMap.quizEnd(); window.CmapMap.setMode('map'); 0");
  noErrors(page);
});

test('PDF: 만든 SVG 에 같은 선 굵기·화살촉 크기·라벨 둘레(5px, 둥근 이음, paint-order)가 인라인으로 들어간다', { skip: SKIP, timeout: 90000 }, async t => {
  const { page } = await world(t);
  await page.eval(`(() => { window.__svg = ''; window.CmapPdf.deliverImpl = async () => 'stub'; const o = XMLSerializer.prototype.serializeToString; XMLSerializer.prototype.serializeToString = function (n) { const s = o.call(this, n); if (n && n.querySelector && n.querySelector('.m-edge-line')) window.__svg = s; return s; }; })()`);
  await page.eval("document.getElementById('map-pdf').click()");
  await page.waitFor("window.__svg.length > 0", 20000, 'PDF 용 SVG');
  await page.waitFor("!document.getElementById('map-pdf').disabled", 20000);
  const svg = await page.eval('window.__svg');
  const doc = await page.eval(`(() => { const d = new DOMParser().parseFromString(window.__svg, 'image/svg+xml'); const get = el => el.getAttribute('style') || '';
    return { lines: [...d.querySelectorAll('.m-edge-line')].map(get), labels: [...d.querySelectorAll('.m-edge-label')].map(get), mk: d.querySelector('marker') && [d.querySelector('marker').getAttribute('markerWidth'), d.querySelector('marker').getAttribute('markerHeight')], hit: d.querySelectorAll('.m-edge-hit').length }; })()`);
  assert.ok(svg.includes('<svg'));
  assert.equal(doc.lines.length, 3);
  assert.equal(doc.lines.filter(s => /stroke-width:\s*2\.2(px)?(;|$)/.test(s)).length, 1, '대립 선만 2.2');
  assert.equal(doc.lines.filter(s => /stroke-width:\s*1\.2(px)?(;|$)/.test(s)).length, 2, '나머지는 1.2');
  for (const s of doc.lines) assert.match(s, /stroke-dasharray:\s*none/, '307-1: 점선 없음(PDF 에도 실선)');
  assert.ok(svg.includes('marker-start="url(#m-arrow-opp)"') && svg.includes('id="m-arrow-opp"'), '307-1: 대립의 marker-start 와 대립 화살촉 정의가 PDF 용 SVG 에 들어감');
  for (const s of doc.labels) { assert.match(s, /stroke-width:\s*5(px)?(;|$)/); assert.match(s, /stroke-linejoin:\s*round/); assert.match(s, /paint-order:\s*stroke/); }
  assert.deepEqual(doc.mk, ['7', '7']);
  assert.equal(doc.hit, 0, '클릭 영역은 PDF 에 없음(기존)');
  noErrors(page);
});
