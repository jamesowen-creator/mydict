// 작업273-2: 개념 지도 화면의 "지도" 보기 — 지도에 쓸 개념 선택, 노드 드래그 이동 저장, 빈 곳 드래그(화면 이동)·핀치 확대, 노드 A 탭 → B 탭 연결, 연결 수정·삭제, 노드 빼기 확인, 390px 레이아웃.
// 실제 routes/concept_map.js + 가짜 DB(tests/helpers/cmap_db.js)에 연결한 헤드리스 Chrome 테스트. 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_map.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(t, { width = 390, height = 844 } = {}) {
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
// 과학(물리) 트리에 개념 a b c (과학), d (물리), 지도를 열어 둔다
async function world(page, { openMap = true } = {}) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const phys = (await seed(page, 'POST', '/api/cmap/topics', { title: '물리', parent_id: sci.id })).topic;
  const c = {};
  for (const [k, topic] of [['a', sci], ['b', sci], ['c', sci], ['d', phys]]) c[k] = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: k + '개념' })).concept;
  await page.eval('refresh()');
  await page.eval(`selectTopic(${sci.id}); 0`);
  await page.waitFor("!document.getElementById('concepts-sec').hidden", 4000);
  if (openMap) { await page.waitFor("document.querySelectorAll('#concept-list > *').length >= 3", 6000, '개념 목록 표시(레이아웃 안정)'); await hittable(page, '#nav-map'); await page.click('#nav-map'); await page.waitFor("!document.getElementById('map-view').hidden", 6000, '지도 화면'); await openSheet(page); }
  return { sci, phys, c };
}
const state = page => page.eval('window.CmapMap._state()');
// 274-4: 지도는 시트(<dialog>) 안에 있다. 지도 조작 전에 [지도 열기]로 시트를 열고, 주제 화면으로 가기 전에 닫는다
// 283-2: [만들기] 첫 화면의 주 버튼(#map-open)은 개념을 2개 이상 고르기 전에는 비활성이므로, 빈 지도에서 시트를 바로 열 때는 CmapMap.openSheet() 를 쓴다
const openSheet = async page => { await page.eval("(() => { const b = document.getElementById('map-open'); if (b && !b.disabled) b.click(); else window.CmapMap.openSheet(); })()"); await page.waitFor("document.getElementById('map-sheet').open", 4000, '지도 시트'); };
const closeSheet = async page => { await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000, '지도 시트 닫힘'); };
// 조건이 참이 될 때까지 기다린다(테스트 프로세스 쪽 값, 예: 가짜 DB). 274-1: 드래그 저장 요청·응답이 끝나기를 기다리는 데 쓴다
async function until(fn, ms, label) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(40); }
  throw new Error('until 시간 초과: ' + label + ' (마지막 값 ' + JSON.stringify(last) + ')');
}
// 클릭 대상이 실제로 눌릴 수 있을 때까지(다른 요소에 가려지지 않을 때까지) 기다린다
const hittable = (page, sel) => page.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return false; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === e || e.contains(t)); })()`, 6000, sel + ' 클릭 가능');
const pickAll = async (page, ids) => {
  await page.click('#map-pick-toggle');
  for (const id of ids) { await page.click(`#pick-${id}`); await page.waitFor(`document.querySelector('[data-node="${id}"]') !== null`, 4000, '노드 ' + id); }
};
const nodeRect = (page, id) => page.eval(`(() => { const r = document.querySelector('[data-node="${id}"] rect').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
async function dragNode(page, id, dx, dy) {
  const r = await nodeRect(page, id);
  const x = r.l + r.w / 2, y = r.t + r.h / 2;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * i / 6, y: y + dy * i / 6, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
}
const tapNode = (page, id) => page.click(`[data-node="${id}"] rect`);
// 캔버스 오른쪽 아래 구석(노드가 없는 곳)을 실제 마우스로 가볍게 누른다
async function tapEmpty(page) {
  const p = await page.eval("(() => { const r = document.getElementById('map-svg').getBoundingClientRect(); return { x: r.left + r.width - 30, y: r.top + r.height - 90 }; })()");
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}
// 연결선의 가운데 점을 실제 마우스로 누른다(곡선이라 박스 중심이 아니라 경로 위의 점을 쓴다)
async function tapEdge(page, id) {
  const p = await page.eval(`(() => { const svg = document.getElementById('map-svg'), path = document.querySelector('[data-edge="${id}"] .m-edge-hit'); const pt = path.getPointAtLength(path.getTotalLength() / 2);
    const sp = svg.createSVGPoint(); sp.x = pt.x; sp.y = pt.y; const m = sp.matrixTransform(path.getScreenCTM()); return { x: m.x, y: m.y }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}
const waitOpen = (page, id) => page.waitFor(`document.getElementById('${id}').open`, 4000, id + ' 열림');
const waitClosed = (page, id) => page.waitFor(`!document.getElementById('${id}').open`, 4000, id + ' 닫힘');
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const edgesDb = srv => srv.db.edges.map(e => ({ from: e.from_concept_id, to: e.to_concept_id, label: e.label, type: e.relation_type }));

test('지도 열기·개념 선택: 최상위 주제의 지도가 열리고, 트리 안 개념을 체크하면 노드가 생기고(미배치는 점선 임시 위치) 체크를 풀면 바로 빠진다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { c } = await world(page);
  assert.equal(await page.text('#map-sheet-title'), '지도 · 과학', '시트 제목에 지도 이름');
  assert.match(await page.text('#map-scope'), /‘과학’ 주제 전체의 지도/);
  assert.equal(await page.eval("document.getElementById('landing-view').hidden && document.getElementById('topic-view').hidden"), true, '주제 쪽 화면은 숨김');
  assert.match(await page.text('#map-hint'), /개념 선택/);
  assert.equal(srv.db.maps.length, 1);
  await page.click('#map-pick-toggle');
  assert.equal(await page.eval("document.getElementById('map-pick-panel').hidden"), false);
  const rows = await page.eval("[...document.querySelectorAll('#map-pick-list .pick-topic, #map-pick-list .pick-term')].map(e => e.textContent)");
  assert.deepEqual(rows, ['과학', 'a개념', 'b개념', 'c개념', '과학 › 물리', 'd개념'], '주제 경로별로 묶여 보임(하위 주제 포함)');
  await page.click(`#pick-${c.a.id}`); await page.click(`#pick-${c.d.id}`);
  await page.waitFor("document.querySelectorAll('#map-svg [data-t=node]').length === 2", 4000);
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-node.temp').length"), 2, '배치 전에는 임시 격자 위치(점선)');
  assert.match(await page.text('#map-count'), /지도에 2개/);
  assert.deepEqual(srv.db.nodes.map(n => [n.concept_id, n.x, n.y]).sort(), [[c.a.id, null, null], [c.d.id, null, null]].sort(), '서버에는 좌표 없이 저장');
  const r1 = await nodeRect(page, c.a.id), r2 = await nodeRect(page, c.d.id);
  assert.ok(Math.abs(r1.l - r2.l) >= r1.w - 1 || Math.abs(r1.t - r2.t) >= r1.h - 1, '임시 위치가 겹치지 않음');
  await page.click(`#pick-${c.d.id}`);                                         // 연결이 없으니 확인 없이 빠짐
  await page.waitFor("document.querySelectorAll('#map-svg [data-t=node]').length === 1", 4000);
  assert.equal(srv.db.nodes.length, 1);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('노드 드래그: 끝나면 위치가 저장되고(임시 → 배치), 다시 열어도 그 자리, 저장 실패하면 원래 자리로 돌아오고 안내', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { c } = await world(page);
  await pickAll(page, [c.a.id, c.b.id]);
  await page.click('#map-pick-toggle');                                        // 패널 접기
  const before = await nodeRect(page, c.a.id);
  const scale = (await state(page)).view.scale;
  await dragNode(page, c.a.id, 60, 40);
  await page.waitFor(`document.querySelector('[data-node="${c.a.id}"]') && !document.querySelector('[data-node="${c.a.id}"]').classList.contains('temp')`, 4000, '배치됨');
  const after = await nodeRect(page, c.a.id);
  assert.ok(Math.abs(after.l - before.l - 60) <= 1.5 && Math.abs(after.t - before.t - 40) <= 1.5, `화면에서 (60, 40)만큼 이동: ${after.l - before.l}, ${after.t - before.t}`);
  // 드래그 중에는 이미 '배치됨'으로 보이므로, 저장 요청이 끝나 서버 값이 생기고 화면에 응답이 반영될 때까지 기다린 뒤 비교한다(단언 내용은 그대로)
  await until(async () => { const n = srv.db.nodes.find(x => x.concept_id === c.a.id), v = (await state(page)).nodes.find(x => x.id === c.a.id); return n && n.x !== null && v && Math.abs(n.x - v.x) < 0.2 && Math.abs(n.y - v.y) < 0.2; }, 6000, '드래그 저장 응답 반영');
  const stored = srv.db.nodes.find(n => n.concept_id === c.a.id);
  const st = (await state(page)).nodes.find(n => n.id === c.a.id);
  assert.ok(Math.abs(stored.x - st.x) < 0.2 && Math.abs(stored.y - st.y) < 0.2, '서버 저장값 = 화면 값');
  assert.ok(srv.db.nodes.find(n => n.concept_id === c.b.id).x === null, '건드리지 않은 노드는 미배치 그대로');
  assert.ok(scale > 0);
  // 다시 열어도 같은 자리
  await closeSheet(page);
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.click('#nav-map'); await page.waitFor("!document.getElementById('map-view').hidden", 6000);
  await openSheet(page);
  await page.waitFor(`document.querySelector('[data-node="${c.a.id}"]') !== null`, 4000);
  const st2 = (await state(page)).nodes.find(n => n.id === c.a.id);
  assert.ok(Math.abs(st2.x - st.x) < 0.2 && Math.abs(st2.y - st.y) < 0.2, '다시 열어도 저장된 위치');
  // 저장 실패 → 되돌림
  srv.db.failOn = /^UPDATE cmap_map_nodes/;
  const b0 = await nodeRect(page, c.b.id);
  await dragNode(page, c.b.id, -30, 30);
  await page.waitFor("document.getElementById('map-msg').textContent.length > 0", 4000, '실패 안내');
  const b1 = await nodeRect(page, c.b.id);
  assert.ok(Math.abs(b1.l - b0.l) <= 1.5 && Math.abs(b1.t - b0.t) <= 1.5, '원래 자리로 돌아옴');
  assert.equal(await page.eval(`document.querySelector('[data-node="${c.b.id}"]').classList.contains('temp')`), true, '여전히 미배치');
  srv.db.failOn = null;
  noErrors(page);
});

test('빈 곳 드래그는 화면 이동(아무것도 저장하지 않음), 휠 확대, [전체 보기]로 맞춤', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { c } = await world(page);
  await pickAll(page, [c.a.id]);
  await page.click('#map-pick-toggle');
  const snap = srv.db.snapshot();
  const before = await nodeRect(page, c.a.id);
  const box = await page.eval("(() => { const r = document.getElementById('map-svg').getBoundingClientRect(); return { x: r.left + r.width - 40, y: r.top + r.height - 40 }; })()");
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 15 * i, y: box.y - 10 * i, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x - 90, y: box.y - 60, button: 'left', clickCount: 1 });
  const after = await nodeRect(page, c.a.id);
  assert.ok(Math.abs(after.l - before.l + 90) <= 1.5 && Math.abs(after.t - before.t + 60) <= 1.5, `노드가 화면과 함께 (-90, -60) 이동: ${after.l - before.l}, ${after.t - before.t}`);
  assert.equal(srv.db.snapshot(), snap, '화면 이동은 저장하지 않음');
  const s0 = (await state(page)).view.scale;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x - 100, y: box.y - 100, deltaX: 0, deltaY: -120 });
  assert.ok((await state(page)).view.scale > s0, '휠로 확대');
  await page.click('#map-fit');
  const r = await nodeRect(page, c.a.id), sv = await page.eval("(() => { const r = document.getElementById('map-svg').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()");
  assert.ok(r.l >= sv.l && r.t >= sv.t && r.l + r.w <= sv.l + sv.w && r.t + r.h <= sv.t + sv.h, '전체 보기 뒤 노드가 캔버스 안');
  noErrors(page);
});

test('두 손가락 핀치: 확대·축소되고, 노드를 끄는 중에 두 번째 손가락이 닿으면 이동을 취소하고 저장하지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const { c } = await world(page);
  await pickAll(page, [c.a.id, c.b.id]);
  await page.click('#map-pick-toggle');
  const snap = srv.db.snapshot();
  const touch = (type, pts) => page.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id === undefined ? i + 1 : p.id })) });
  const sv = await page.eval("(() => { const r = document.getElementById('map-svg').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height - 60 }; })()");
  // 빈 곳에서 핀치 벌리기
  const s0 = (await state(page)).view.scale;
  await touch('touchStart', [{ x: sv.x - 20, y: sv.y }, { x: sv.x + 20, y: sv.y }]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: sv.x - 20 - 12 * i, y: sv.y }, { x: sv.x + 20 + 12 * i, y: sv.y }]);
  await touch('touchEnd', []);
  const s1 = (await state(page)).view.scale;
  assert.ok(s1 > s0 * 1.5, `핀치로 확대: ${s0} → ${s1}`);
  assert.equal(srv.db.snapshot(), snap, '핀치는 저장하지 않음');
  // 노드 드래그 중 두 번째 손가락
  await page.click('#map-fit');
  const r = await nodeRect(page, c.a.id), cx = r.l + r.w / 2, cy = r.t + r.h / 2;
  await touch('touchStart', [{ x: cx, y: cy }]);
  for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: cx + 12 * i, y: cy + 8 * i }]);
  const mid = await nodeRect(page, c.a.id);
  assert.ok(mid.l - r.l > 20, '손가락 하나로 노드가 움직이는 중');
  await touch('touchStart', [{ x: cx + 48, y: cy + 32, id: 1 }, { x: sv.x, y: sv.y, id: 2 }]);
  await touch('touchEnd', []);
  await sleep(300);
  const end = await nodeRect(page, c.a.id);
  assert.ok(Math.abs(end.l - r.l) <= 2 && Math.abs(end.t - r.t) <= 2, '두 번째 손가락이 닿으면 이동이 취소돼 원래 자리');
  assert.equal(srv.db.snapshot(), snap, '취소된 드래그는 저장하지 않음');
  noErrors(page);
});

test('탭-탭 연결: 노드 A 탭(선택 표시) → 노드 B 탭 → 대화상자(A → B), 문구 선택(유형·문구 중 하나는 필요)·종류 선택·일으킴 안내, 저장하면 연결이 생긴다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { c } = await world(page);
  await pickAll(page, [c.a.id, c.b.id, c.c.id]);
  await page.click('#map-pick-toggle');
  await tapNode(page, c.a.id);
  assert.equal(await page.eval(`document.querySelector('[data-node="${c.a.id}"]').classList.contains('sel')`), true, '선택 표시');
  assert.match(await page.text('#map-hint'), /a개념.*골랐어요/);
  await tapNode(page, c.a.id);                                                  // 같은 노드를 다시 누르면 취소
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-node.sel').length"), 0);
  await tapNode(page, c.a.id);
  await tapEmpty(page);                                                         // 빈 곳을 가볍게 누르면 선택 취소
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-node.sel').length"), 0);
  await tapNode(page, c.a.id);
  await tapNode(page, c.b.id);
  await waitOpen(page, 'edge-dlg');
  assert.equal(await page.text('#edge-pair'), 'a개념 → b개념', '앞 개념 → 뒤 개념(누른 순서)');
  assert.equal(await page.text('#edge-heading'), '연결 만들기');
  assert.equal(await page.eval("document.getElementById('edge-type').value"), '종류', '307-1: 새 연결의 기본 유형은 종류');
  await page.eval("(() => { const s = document.getElementById('edge-type'); s.value = ''; s.dispatchEvent(new Event('change')); })()");
  await page.click('#edge-ok');                                                 // 유형도 문구도 없이 저장(286-1: 문구는 선택이지만 둘 다 없으면 막힘)
  assert.match(await page.text('#edge-msg'), /유형을 고르거나 문구를 입력해 주세요/);
  await page.type('#edge-label', '때문에');
  await page.eval("(() => { const s = document.getElementById('edge-type'); s.value = '일부'; s.dispatchEvent(new Event('change')); })()");
  assert.match(await page.text('#edge-type-hint'), /일부가 뒤 개념/);
  await page.click('#edge-flip');
  assert.equal(await page.text('#edge-pair'), 'b개념 → a개념', '방향 바꾸기');
  await page.click('#edge-flip');
  await page.click('#edge-ok');
  await waitClosed(page, 'edge-dlg');
  await page.waitFor("document.querySelectorAll('#map-svg [data-t=edge]').length === 1", 4000);
  assert.deepEqual(edgesDb(srv), [{ from: c.a.id, to: c.b.id, label: '때문에', type: '일부' }]);
  assert.match(await page.text('#map-count'), /연결 1개/);
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-node.sel').length"), 0, '연결 뒤 선택 해제');
  // 같은 쌍을 다시 이으려 하면 기존 연결 수정으로 안내
  await tapNode(page, c.b.id); await tapNode(page, c.a.id);
  await waitOpen(page, 'edge-dlg');
  assert.equal(await page.text('#edge-heading'), '연결 고치기');
  assert.match(await page.text('#map-msg'), /이미 이어진/);
  assert.equal(await page.eval("document.getElementById('edge-label').value"), '때문에');
  await page.click('#edge-cancel');
  noErrors(page);
});

test('방향 바꾸기 저장, 대립(방향 없음: ↔, 바꾸기 비활성, id 작은 쪽이 from), 종류 없이 문구만도 가능', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { c } = await world(page);
  await pickAll(page, [c.a.id, c.b.id, c.c.id]);
  await page.click('#map-pick-toggle');
  // 방향 바꿔서 저장: b → a
  await tapNode(page, c.a.id); await tapNode(page, c.b.id); await waitOpen(page, 'edge-dlg');
  await page.eval("(() => { const s = document.getElementById('edge-type'); s.value = ''; s.dispatchEvent(new Event('change')); })()");                                                    // 307-1: 기본이 종류라 "종류 없이 문구만"은 선택 안 함으로 바꾼다
  await page.type('#edge-label', '쓴다');
  await page.click('#edge-flip');
  await page.click('#edge-ok'); await waitClosed(page, 'edge-dlg');
  // 대립: c 와 a 사이(c 를 먼저 눌러도 작은 id 가 from)
  await tapNode(page, c.c.id); await tapNode(page, c.a.id); await waitOpen(page, 'edge-dlg');
  await page.type('#edge-label', '헷갈림');
  await page.eval("(() => { const s = document.getElementById('edge-type'); s.value = '대립'; s.dispatchEvent(new Event('change')); })()");
  assert.equal(await page.text('#edge-pair'), 'c개념 ↔ a개념');
  assert.equal(await page.eval("document.getElementById('edge-flip').disabled"), true, '대립은 방향 바꾸기 불가');
  await page.click('#edge-ok'); await waitClosed(page, 'edge-dlg');
  await page.waitFor("document.querySelectorAll('#map-svg [data-t=edge]').length === 2", 4000);
  const e = edgesDb(srv);
  assert.deepEqual(e[0], { from: c.b.id, to: c.a.id, label: '쓴다', type: null });
  assert.deepEqual(e[1], { from: Math.min(c.a.id, c.c.id), to: Math.max(c.a.id, c.c.id), label: '헷갈림', type: '대립' });
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-edge-line[marker-end]').length"), 2, '유형 없는 연결의 끝 화살촉 + 대립의 끝 화살촉(307-1)');
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-edge-line[marker-start]').length"), 1, '시작 화살촉은 대립(쌍방향)만');
  noErrors(page);
});

test('연결 수정·삭제: 연결선을 누르면 값이 채워진 대화상자, 문구·종류·방향을 고쳐 저장, 삭제는 확인 뒤', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { c } = await world(page);
  await pickAll(page, [c.a.id, c.b.id]);
  await page.click('#map-pick-toggle');
  await tapNode(page, c.a.id); await tapNode(page, c.b.id); await waitOpen(page, 'edge-dlg');
  await page.type('#edge-label', '처음 문구'); await page.click('#edge-ok'); await waitClosed(page, 'edge-dlg');
  const id = srv.db.edges[0].id;
  await tapEdge(page, id);
  await waitOpen(page, 'edge-dlg');
  assert.equal(await page.text('#edge-heading'), '연결 고치기');
  assert.equal(await page.eval("document.getElementById('edge-label').value"), '처음 문구');
  assert.equal(await page.eval("document.getElementById('edge-delete').hidden"), false);
  await page.type('#edge-label', '고친 문구');
  await page.eval("(() => { const s = document.getElementById('edge-type'); s.value = '종류'; s.dispatchEvent(new Event('change')); })()");
  await page.click('#edge-flip');
  await page.click('#edge-ok'); await waitClosed(page, 'edge-dlg');
  assert.deepEqual(edgesDb(srv), [{ from: c.b.id, to: c.a.id, label: '고친 문구', type: '종류' }]);
  // 삭제: 취소하면 그대로, 확인하면 삭제
  await tapEdge(page, id); await waitOpen(page, 'edge-dlg');
  await page.click('#edge-delete');
  await waitOpen(page, 'confirm-dlg');
  assert.match(await page.text('#confirm-text'), /고친 문구/);
  await page.click('#confirm-cancel'); await waitClosed(page, 'confirm-dlg');
  assert.equal(srv.db.edges.length, 1);
  await tapEdge(page, id); await waitOpen(page, 'edge-dlg');
  await page.click('#edge-delete'); await waitOpen(page, 'confirm-dlg');
  await page.click('#confirm-ok'); await waitClosed(page, 'confirm-dlg');
  await page.waitFor("document.querySelectorAll('#map-svg [data-t=edge]').length === 0", 4000);
  assert.equal(srv.db.edges.length, 0); assert.equal(srv.db.nodes.length, 2, '노드는 그대로');
  noErrors(page);
});

test('지도에서 빼기: 연결이 있으면 개수를 알리는 확인창(취소하면 그대로, 확인하면 노드·연결 삭제)', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { c } = await world(page);
  await pickAll(page, [c.a.id, c.b.id, c.c.id]);
  for (const [x, y, label] of [[c.a.id, c.b.id, '하나'], [c.c.id, c.a.id, '둘']]) {
    await page.click('#map-pick-toggle');
    await tapNode(page, x); await tapNode(page, y); await waitOpen(page, 'edge-dlg');
    await page.type('#edge-label', label); await page.click('#edge-ok'); await waitClosed(page, 'edge-dlg');
    await page.click('#map-pick-toggle');
  }
  assert.equal(srv.db.edges.length, 2);
  if (await page.eval("document.getElementById('map-pick-panel').hidden")) await page.click('#map-pick-toggle');   // 선택 패널을 열어 둔다
  await page.click(`#pick-${c.a.id}`);
  await waitOpen(page, 'confirm-dlg');
  assert.match(await page.text('#confirm-text'), /연결 2개도 함께 지워집니다/);
  await page.click('#confirm-cancel'); await waitClosed(page, 'confirm-dlg');
  assert.equal(await page.eval(`document.getElementById('pick-${c.a.id}').checked`), true, '취소하면 체크가 그대로');
  assert.equal(srv.db.nodes.length, 3);
  await page.click(`#pick-${c.a.id}`); await waitOpen(page, 'confirm-dlg');
  await page.click('#confirm-ok'); await waitClosed(page, 'confirm-dlg');
  await page.waitFor(`document.querySelector('[data-node="${c.a.id}"]') === null`, 4000);
  assert.equal(srv.db.nodes.length, 2); assert.equal(srv.db.edges.length, 0);
  assert.equal(await page.eval(`document.getElementById('pick-${c.a.id}').checked`), false);
  assert.match(await page.text('#map-count'), /지도에 2개 · 연결 0개/);
  noErrors(page);
});

test('주제·개념 화면과의 연결: 지도에 쓰이는 가지의 이동 거부 안내, 최상위 삭제 확인창에 지도 수, 개념 삭제 확인 문구', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const { sci, phys, c } = await world(page);
  const other = (await seed(page, 'POST', '/api/cmap/topics', { title: '수학' })).topic;
  await pickAll(page, [c.d.id]);
  await closeSheet(page);
  await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${phys.id}).then(() => 0)`);
  await page.click('#act-move'); await waitOpen(page, 'move-dlg');
  await page.eval(`(() => { const s = document.getElementById('move-select'); s.value = '${other.id}'; })()`);
  await page.click('#move-ok');
  await page.waitFor("document.getElementById('move-msg').textContent.length > 0", 4000);
  assert.match(await page.text('#move-msg'), /지도에서 쓰이고 있어/);
  assert.equal(await page.eval("document.getElementById('move-dlg').open"), true);
  await page.click('#move-cancel');
  await page.eval(`selectTopic(${sci.id}); 0`);
  await page.click('#act-delete'); await waitOpen(page, 'confirm-dlg');
  assert.match(await page.text('#confirm-text'), /하위 주제 1개, 개념 4개, 지도 1개/);
  await page.click('#confirm-cancel'); await waitClosed(page, 'confirm-dlg');
  assert.equal(srv.db.maps.length, 1);
  noErrors(page);
});

test('390px 레이아웃: 지도 화면에 가로 스크롤이 없고 캔버스·대화상자가 화면 안에 들어온다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t, { width: 390, height: 844 });
  const { c } = await world(page);
  await pickAll(page, [c.a.id, c.b.id, c.c.id, c.d.id]);
  await page.click('#map-pick-toggle');
  await tapNode(page, c.a.id); await tapNode(page, c.b.id); await waitOpen(page, 'edge-dlg');
  const m = await page.eval(`(() => { const d = document.getElementById('edge-dlg').getBoundingClientRect(), s = document.getElementById('map-svg').getBoundingClientRect(); return { dl: d.left, dr: d.right, vw: innerWidth, sw: s.width, sh: s.height }; })()`);
  assert.ok(m.dl >= 0 && m.dr <= m.vw, '대화상자가 화면 안');
  assert.ok(m.sw > 300 && m.sh >= 320, `캔버스 크기 ${m.sw}x${m.sh}`);
  assert.equal(await page.hasHorizontalScroll(), false);
  assert.ok(srv.db.maps.length === 1);
  await page.click('#edge-cancel');
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});
