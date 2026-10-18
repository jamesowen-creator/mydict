// 작업287-1: 1:n 한 번에 연결 — 지도 시트에서 시작 개념 하나 + 대상 여러 개 + 유형·문구 한 번 → 선 n개. 서버는 실제 routes/concept_map.js + 가짜 DB.
// 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_bulk.ui.test.js"   (Chrome이 없으면 건너뜀)
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
// 개념 a b c d 를 지도에 올리고(좌표 지정) a–b 는 이미 연결, 저장해 둔 뒤 시트까지 연다
async function world(page) {
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (const term of ['a개념', 'b개념', 'c개념', 'd개념']) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  const at = [[130, 20], [20, 150], [250, 150], [130, 280]];
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: at[i][0], y: at[i][1] }); }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids[0], to_concept_id: ids[1], relation_type: '종류', label: '기존' });   // 308-1: 기존 연결은 종류(화살촉 없음) — 일괄로 만드는 일부와 다른 다발이라 라벨·화살촉이 따로 센다
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open && document.querySelectorAll('[data-node]').length === 4", 6000); await sleep(250);
  await page.click('#map-fit');
  return { top, ids, map };
}
const openBulk = async (page, id) => { await tapNode(page, id); await page.waitFor("!document.getElementById('map-bulk-row').hidden", 3000, '일괄 연결 버튼'); await page.click('#map-bulk-btn'); await page.waitFor("document.getElementById('bulk-dlg').open", 3000, '일괄 대화상자'); };
const edgeCount = page => page.eval("document.querySelectorAll('#map-svg .m-edge').length");

test('진입: 노드 하나를 골라 두 번째를 기다리는 동안에만 [여러 개에 한 번에 연결]이 보이고(44px), 선택을 취소하면 사라지며, 읽기 전용 시트에는 없다. 두 노드 탭 연결은 그대로', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  assert.equal(await page.eval("document.getElementById('map-bulk-row').hidden"), true, '아무것도 고르지 않으면 없음');
  await tapNode(page, w.ids[0]);
  await page.waitFor("!document.getElementById('map-bulk-row').hidden", 3000);
  assert.ok(await page.eval("document.getElementById('map-bulk-btn').getBoundingClientRect().height >= 44"));
  assert.equal(await page.text('#map-bulk-btn'), '여러 개에 한 번에 연결');
  assert.match(await page.text('#map-hint'), /a개념.*골랐어요/, '기존 안내 줄 유지');
  await tapNode(page, w.ids[0]);                                                          // 같은 노드를 다시 누르면 취소
  assert.equal(await page.eval("document.getElementById('map-bulk-row').hidden"), true);
  // 기존 흐름: 두 번째 노드를 누르면 연결 대화상자
  await tapNode(page, w.ids[2]); await tapNode(page, w.ids[3]);
  await page.waitFor("document.getElementById('edge-dlg').open", 3000, '단건 연결 대화상자');
  assert.equal(await page.text('#edge-pair'), 'c개념 → d개념');
  await page.click('#edge-cancel');
  // 읽기 전용 시트(해설 탭의 [지도 열기])
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  await tabIn(page, 'narr'); await page.waitFor("!document.getElementById('narr-panel').hidden", 4000);
  await page.click('#narr-open-map'); await page.waitFor("document.getElementById('map-sheet').open && document.getElementById('map-sheet').classList.contains('ro')", 6000);
  await tapNode(page, w.ids[0]);
  assert.equal(await page.eval("document.getElementById('map-bulk-row').offsetParent === null || document.getElementById('map-bulk-row').hidden"), true, '읽기 전용에는 없음');
  noErrors(page);
});

test('대화상자(390px): 시작 개념 고정, 이미 연결된 노드는 비활성 "이미 연결됨", 선택 개수, 유형 select(10개 묶음), 방향 안내, 선택 0개·유형도 문구도 없으면 비활성+안내', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await openBulk(page, w.ids[0]);
  assert.equal(await page.text('#bulk-from'), 'a개념');
  const rows = await page.eval("[...document.querySelectorAll('#bulk-list .pick-row')].map(r => ({ t: r.querySelector('.pick-term').textContent, off: r.querySelector('input').disabled, linked: !!r.querySelector('[data-t=bulk-linked]'), h: r.getBoundingClientRect().height }))");
  assert.deepEqual(rows.map(r => r.t), ['b개념', 'c개념', 'd개념'], '시작 개념은 목록에 없음');
  assert.deepEqual(rows.map(r => [r.off, r.linked]), [[true, true], [false, false], [false, false]], '이미 연결된 b 는 비활성');
  assert.ok(rows.every(r => r.h >= 44), '줄 44px 이상');
  assert.equal(await page.text('#bulk-count'), '0개 선택');
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), true);
  assert.equal(await page.text('#bulk-hint'), '연결할 개념을 하나 이상 골라 주세요');
  assert.equal(await page.eval("document.getElementById('bulk-hint').offsetParent !== null"), true);
  await page.click('#bulk-pick-' + w.ids[2]); await page.click('#bulk-pick-' + w.ids[3]);
  assert.equal(await page.text('#bulk-count'), '2개 선택');
  assert.equal(await page.text('#bulk-ok'), '연결 2개 만들기');
  assert.equal(await page.eval("document.getElementById('bulk-type').value"), '종류', '307-1: 새 연결의 기본 유형은 종류');
  await setSel(page, 'bulk-type', '');
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), true, '유형도 문구도 없음');
  assert.equal(await page.text('#bulk-hint'), '관계 종류를 골라 주세요');   // 308-1: 유형은 필수
  // 유형 select: 서버가 내려준 새로 고를 3종(307-1)
  const opts = await page.eval("[...document.querySelectorAll('#bulk-type option')].map(o => [o.value, o.parentElement.label || ''])");
  assert.deepEqual(opts.map(o => o[0]), ['종류', '일부', '대립']);
  assert.deepEqual([...new Set(opts.map(o => o[1]))], ['방향 있음', '방향 없음']);
  // 방향 안내
  await setSel(page, 'bulk-type', '일부');
  assert.equal(await page.text('#bulk-type-hint'), '앞 개념의 일부가 뒤 개념이에요. 화살촉이 있는 선으로 그려져요.');
  assert.equal(await page.text('#bulk-dir'), '‘a개념’ → 선택한 개념들 방향으로 만들어져요');
  assert.equal(await page.text('#bulk-label-hint'), '비우면 ‘일부’처럼 유형 이름이 표시돼요');
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), false);
  await setSel(page, 'bulk-type', '대립');
  assert.equal(await page.text('#bulk-dir'), '방향 없이 연결돼요');
  await setSel(page, 'bulk-type', '');
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), true);
  await page.type('#bulk-label', '문구만');                                                 // 308-1: 유형은 필수라 문구만으로는 만들 수 없다
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), true, '문구만으로는 비활성');
  await setSel(page, 'bulk-type', '종류');
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), false, '유형을 고르면 활성');
  // 체크 해제 → 0개이면 다시 비활성, [모두 선택]은 이미 연결됨을 건너뜀
  await page.click('#bulk-pick-' + w.ids[2]); await page.click('#bulk-pick-' + w.ids[3]);
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), true);
  await page.click('#bulk-all');
  assert.equal(await page.text('#bulk-count'), '2개 선택', '이미 연결됨(b)은 선택되지 않음');
  assert.equal(await page.eval("document.getElementById('bulk-pick-" + w.ids[1] + "').checked"), false);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('성공: 선 n개가 그려지고(방향 있음은 화살촉), 상태가 "저장 후 변경됨", 결과 안내 "연결 N개를 만들었어요", 선택이 해제되어 버튼이 사라진다. 저장 모델은 선 n개', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  assert.equal(await edgeCount(page), 1);
  assert.ok((await page.text('#map-save-state')).startsWith('저장됨'), '시작 상태는 저장됨');
  await openBulk(page, w.ids[0]);
  await page.click('#bulk-pick-' + w.ids[2]); await page.click('#bulk-pick-' + w.ids[3]);
  await setSel(page, 'bulk-type', '일부');
  await page.click('#bulk-ok');
  await page.waitFor("!document.getElementById('bulk-dlg').open", 6000, '대화상자 닫힘');
  await page.waitFor("document.querySelectorAll('#map-svg .m-edge').length === 3", 4000, '선 3개');
  assert.deepEqual(srv.db.edges.map(e => [e.from_concept_id, e.to_concept_id, e.relation_type, e.label]).slice(1), [[w.ids[0], w.ids[2], '일부', null], [w.ids[0], w.ids[3], '일부', null]]);
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-edge .m-edge-line[marker-end]').length"), 2, '308-1: 일부 2개만 끝 화살촉(기존 종류는 화살촉 없음)');
  // 302-1: 같은 부모(a개념)에서 나가는 같은 종류('일부')·같은 문구(문구가 없어 유형 이름) 연결 2개는 한 줄기로 묶여 라벨이 한 번만 나온다(문구가 없으면 유형 이름 — 묶이지 않았다면 2개)
  assert.equal(await page.eval("[...document.querySelectorAll('#map-svg .m-edge-label')].filter(e => e.textContent === '일부').length"), 1, '문구가 없으면 유형 이름, 다발에는 한 번만');
  // 304-1: 방향 있는 선 3개(기존 종류 1 + 일부 2)는 모두 곡선 한 개(M C)이고, 같은 부모의 같은 종류(일부) 2개는 부모 아래 면에서 6px(STRAND_GAP) 간격으로 나란히 출발한다
  const ds = await page.eval("[...document.querySelectorAll('#map-svg .m-edge-line')].map(p => p.getAttribute('d'))");
  assert.equal(ds.filter(d => /^M[-\d.]+,[-\d.]+ C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+$/.test(d)).length, 3, '곡선 한 개(M C) 3개');
  const sx = ds.slice(1).map(d => Number(d.match(/^M([-\d.]+),/)[1])), sy = ds.slice(1).map(d => Number(d.match(/^M[-\d.]+,([-\d.]+)/)[1]));
  assert.equal(sy[0], sy[1], '두 일부 선은 부모 아래 가장자리의 같은 높이에서 출발'); assert.equal(Math.abs(sx[1] - sx[0]), 6, '6px 간격으로 나란히');
  assert.equal(await page.text('#map-save-state'), '저장 후 변경됨');
  assert.equal(await page.text('#map-note'), '연결 2개를 만들었어요');
  assert.equal(await page.eval("document.getElementById('map-bulk-row').hidden"), true);
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-node.sel').length"), 0);
  assert.equal(await page.eval("window.CmapMap.status().save_status"), 'changed');
  assert.match(await page.text('#map-count'), /연결 3개/);
  noErrors(page);
});

test('방향 없음(대립): 선이 굵은(2.2) 위험 색 실선에 양쪽 화살촉(점선 폐지)으로 그려지고, 문구를 쓰면 모든 선에 같은 문구', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await openBulk(page, w.ids[3]);
  await page.click('#bulk-pick-' + w.ids[1]); await page.click('#bulk-pick-' + w.ids[2]);
  await setSel(page, 'bulk-type', '대립'); await page.type('#bulk-label', '맞섬');
  assert.equal(await page.text('#bulk-dir'), '방향 없이 연결돼요');
  await page.click('#bulk-ok');
  await page.waitFor("document.querySelectorAll('#map-svg .m-edge.m-edge-opp').length === 2", 6000, '대립 선 2개');
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-edge-opp .m-edge-line[marker-end=\"url(#m-arrow-opp)\"][marker-start=\"url(#m-arrow-opp)\"]').length"), 2, '307-1: 양쪽 화살촉(marker-start + marker-end)');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.m-edge-opp .m-edge-line')).strokeWidth + '|' + getComputedStyle(document.querySelector('.m-edge-opp .m-edge-line')).strokeDasharray"), '2.2px|none', '굵게, 점선 폐지');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.m-edge-opp .m-edge-line')).stroke"), 'rgb(220, 38, 38)');
  assert.deepEqual(srv.db.edges.slice(1).map(e => [e.from_concept_id, e.to_concept_id, e.label]), [[w.ids[1], w.ids[3], '맞섬'], [w.ids[2], w.ids[3], '맞섬']], '작은 id 가 앞으로 정규화');
  noErrors(page);
});

test('건너뜀 안내: 그 사이 다른 곳에서 이미 연결된 쌍은 서버가 건너뛰고 "M개는 이미 연결돼 있어 건너뛰었어요"가 결과 안내에 붙는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await openBulk(page, w.ids[0]);
  await page.click('#bulk-pick-' + w.ids[2]); await page.click('#bulk-pick-' + w.ids[3]);
  await setSel(page, 'bulk-type', '종류');
  await seed(page, 'POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.ids[3], to_concept_id: w.ids[0], relation_type: '일부' });   // 화면이 모르는 새 연결(d → a)
  await page.click('#bulk-ok');
  await page.waitFor("!document.getElementById('bulk-dlg').open", 6000);
  assert.equal(await page.text('#map-note'), '연결 1개를 만들었어요. 1개는 이미 연결돼 있어 건너뛰었어요');
  assert.equal(srv.db.edges.length, 3, '기존 1 + 몰래 1 + 새 1');
  noErrors(page);
});

test('실패하면 대화상자 안에 한 줄 오류가 나오고 입력(선택·유형·문구)이 그대로 남으며 다시 시도할 수 있다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await openBulk(page, w.ids[0]);
  await page.click('#bulk-pick-' + w.ids[2]); await page.click('#bulk-pick-' + w.ids[3]);
  await setSel(page, 'bulk-type', '종류'); await page.type('#bulk-label', '전제');
  await page.eval("window.__rf = window.fetch; window.fetch = (u, o) => (/\\/edges\\/bulk$/.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ ok: false, error: '일시적인 오류' }), { status: 500 })) : window.__rf(u, o)); 0");
  await page.click('#bulk-ok');
  await page.waitFor("document.getElementById('bulk-msg').textContent.length > 0", 4000, '오류 안내');
  assert.equal(await page.text('#bulk-msg'), '일시적인 오류');
  assert.equal(await page.eval("document.getElementById('bulk-dlg').open"), true);
  assert.equal(await page.text('#bulk-count'), '2개 선택');
  assert.equal(await page.eval("document.getElementById('bulk-type').value + '|' + document.getElementById('bulk-label').value"), '종류|전제');
  assert.equal(await page.eval("document.getElementById('bulk-ok').disabled"), false, '다시 시도 가능');
  assert.equal(srv.db.edges.length, 1); assert.equal(await edgeCount(page), 1);
  await page.eval('window.fetch = window.__rf; 0');
  await page.click('#bulk-ok');
  await page.waitFor("!document.getElementById('bulk-dlg').open && document.querySelectorAll('#map-svg .m-edge').length === 3", 6000);
  assert.equal(srv.db.edges.length, 3);
  noErrors(page);
});

test('만드는 중에는 버튼이 비활성("만드는 중…")이고 연속 클릭해도 요청은 한 번만 나간다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await openBulk(page, w.ids[0]);
  await page.click('#bulk-pick-' + w.ids[2]); await page.click('#bulk-pick-' + w.ids[3]);
  await setSel(page, 'bulk-type', '일부');
  await page.eval("window.__n = 0; window.__rf = window.fetch; window.fetch = (u, o) => { if (/\\/edges\\/bulk$/.test(String(u))) { window.__n++; return new Promise(r => setTimeout(r, 700)).then(() => window.__rf(u, o)); } return window.__rf(u, o); }; 0");
  await page.eval("(() => { const b = document.getElementById('bulk-ok'); b.click(); b.click(); document.getElementById('bulk-form').requestSubmit(); })()");
  await page.waitFor("document.getElementById('bulk-ok').disabled && document.getElementById('bulk-ok').textContent === '만드는 중…'", 2000, '만드는 중');
  await page.waitFor("!document.getElementById('bulk-dlg').open", 6000);
  assert.equal(await page.eval('window.__n'), 1, '요청 1번');
  assert.equal(srv.db.edges.length, 3);
  noErrors(page);
});

test('320px: 대화상자가 화면 안에 들어오고 가로 스크롤이 없으며, 체크 줄·버튼이 44px 이상이고 [연결 N개 만들기]까지 누를 수 있다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t, 320, 640);
  const w = await world(page);
  await openBulk(page, w.ids[0]);
  const geo = await page.eval("(() => { const d = document.getElementById('bulk-dlg').getBoundingClientRect(); return { l: d.left, r: d.right, b: d.bottom, vw: innerWidth, vh: innerHeight }; })()");
  assert.ok(geo.l >= 0 && geo.r <= geo.vw && geo.b <= geo.vh + 1, JSON.stringify(geo));
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.click('#bulk-pick-' + w.ids[2]); await setSel(page, 'bulk-type', '일부');
  assert.ok(await page.eval("['bulk-ok', 'bulk-cancel', 'bulk-all'].every(id => document.getElementById(id).getBoundingClientRect().height >= 44)"));
  await page.click('#bulk-ok');
  await page.waitFor("!document.getElementById('bulk-dlg').open", 6000);
  assert.equal(srv.db.edges.length, 2);
  noErrors(page);
});
