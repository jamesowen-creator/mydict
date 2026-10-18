// 작업275-4: 읽기 전용 지도 시트에서 개념 클릭 → 간략 설명 팝업 + "모르는 개념" 표시(사용자별 서버 저장).
// 클릭 표: 표시 없음 → 팝업 + 표시 / 표시됨 + 팝업 열림 → 재클릭·밖 클릭은 팝업만 닫힘 / 표시됨 + 팝업 없음 → 해제 / 팝업 열린 채 다른 개념 → 팝업 닫고 새 개념에 규칙 적용.
// 적용: 해설의 [지도에서 보기]·복습의 [지도 열기] 시트. 미적용: 편집 가능한 시트, 퀴즈 모드. 드래그는 클릭이 아니다. 상태 전이 자체는 tests/cmap_marks.test.js 가 시험한다.
// 서버는 실제 routes/concept_map.js + 가짜 DB, AI 는 모의. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_marks.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { tabIn } = require('./helpers/cmap_nav');

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
async function gotoMap(page, sciId) {
  await page.eval('refresh()'); await page.eval(`selectTopic(${sciId}); 0`);
  await page.waitFor("document.querySelectorAll('#concept-list > *').length >= 4", 6000, '개념 목록');
  await page.click('#nav-map');
  await page.waitFor("!document.getElementById('map-view').hidden && document.querySelectorAll('[data-node]').length === 4", 6000, '지도 화면');
}
const backAndReopen = async (page, sciId) => { await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000); await gotoMap(page, sciId); };
// 힘(정의 있음) · 질량(설명 없음) · 마찰(옛 4항목 형태) · 에너지(정의 140자 초과)
async function world(page) {
  const sci = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const mk = async body => (await seed(page, 'POST', `/api/cmap/topics/${sci.id}/concepts`, body)).concept.id;
  const ids = {
    force: await mk({ term: '힘', explanation: { definition: '물체의 운동 상태를 바꾸는 원인입니다.', example: '공을 찹니다.' }, explanation_source: 'ai' }),
    mass: await mk({ term: '질량' }),
    fric: await mk({ term: '마찰', explanation: { definition: '옛 정의입니다.', in_context: '옛 맥락', example: '옛 예', confusion: '옛 헷갈림' }, explanation_source: 'ai' }),
    long: await mk({ term: '에너지', explanation: { definition: '가'.repeat(200) }, explanation_source: 'manual' }),
  };
  const map = (await seed(page, 'GET', `/api/cmap/topics/${sci.id}/map`)).map;
  const at = { force: [150, 20], mass: [20, 130], fric: [280, 130], long: [150, 240] };
  for (const k of Object.keys(ids)) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: ids[k] }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${ids[k]}`, { x: at[k][0], y: at[k][1] }); }
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: ids.force, to_concept_id: ids.mass, label: '만든다', relation_type: '종류' });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/save`);
  await gotoMap(page, sci.id);
  return { sci, ids, map };
}
const roSheet = async page => {                                    // 복습 탭의 [지도 열기] = 읽기 전용 시트
  await page.click('#nav-wrong'); await page.waitFor("!document.getElementById('wrong-view').hidden && !!document.getElementById('wrong-open-map')", 4000, '복습 탭');
  await page.click('#wrong-open-map'); await page.waitFor("document.getElementById('map-sheet').open && document.getElementById('map-sheet').classList.contains('ro')", 4000, '읽기 전용 시트');
};
const closeSheet = async page => { await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000); };
const marks = page => page.eval('window.CmapMap._marks()');
const popup = page => page.eval("(() => { const p = document.getElementById('map-popup'); return p.hidden ? null : { term: p.querySelector('.p-term').textContent, text: p.querySelector('.p-text').textContent, note: p.querySelector('.p-note').textContent }; })()");
const isMarkedNode = (page, id) => page.eval(`(() => { const g = document.querySelector('[data-node="${id}"]'); return { cls: g.classList.contains('marked'), badge: !!g.querySelector('.m-mark') }; })()`);
const tap = (page, id) => page.click(`[data-node="${id}"] rect`);
const serverMarks = srv => srv.db.marks.map(m => m.concept_id).sort((a, b) => a - b);
const waitServer = (srv, ids, label) => (async () => { const end = Date.now() + 4000; while (Date.now() < end) { if (JSON.stringify(serverMarks(srv)) === JSON.stringify([...ids].sort((a, b) => a - b))) return; await sleep(40); } assert.deepEqual(serverMarks(srv), [...ids].sort((a, b) => a - b), label); })();
// 노드가 없는 지도 위의 한 점(빈 곳)
const emptyPoint = page => page.eval(`(() => { const svg = document.getElementById('map-svg'), r = svg.getBoundingClientRect(); for (let y = r.top + 20; y < r.bottom - 20; y += 20) for (let x = r.left + 20; x < r.right - 20; x += 20) { const e = document.elementFromPoint(x, y); if (e === svg) return { x, y }; } return null; })()`);
async function tapEmpty(page) {
  const p = await emptyPoint(page);
  assert.ok(p, '빈 곳을 찾지 못함');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}

test('클릭 표 ①②③: 첫 클릭 = 팝업 + 표시, 같은 개념 재클릭 = 팝업만 닫힘, 팝업 없이 다시 클릭 = 해제 — 서버에도 반영', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  assert.deepEqual(await marks(page), { marked: [], server: [], popup: null });
  assert.equal(await popup(page), null);
  await tap(page, w.ids.force);
  assert.deepEqual((await marks(page)).marked, [w.ids.force]);
  assert.equal((await marks(page)).popup, w.ids.force);
  assert.deepEqual(await popup(page), { term: '힘', text: '물체의 운동 상태를 바꾸는 원인입니다.', note: '모르는 개념으로 표시했어요.' });
  assert.deepEqual(await isMarkedNode(page, w.ids.force), { cls: true, badge: true });
  await waitServer(srv, [w.ids.force], '표시가 서버에 저장됨');
  assert.equal(srv.anthropic.calls.length, 0, 'AI 호출 없음');
  // 같은 개념 재클릭 → 팝업만 닫힘
  await tap(page, w.ids.force);
  assert.equal(await popup(page), null);
  assert.deepEqual((await marks(page)).marked, [w.ids.force], '표시는 유지');
  assert.deepEqual(await isMarkedNode(page, w.ids.force), { cls: true, badge: true });
  // 팝업 없이 다시 클릭 → 해제
  await tap(page, w.ids.force);
  assert.deepEqual((await marks(page)).marked, []);
  assert.equal(await popup(page), null);
  assert.deepEqual(await isMarkedNode(page, w.ids.force), { cls: false, badge: false });
  await waitServer(srv, [], '해제가 서버에 반영됨');
  // 다시 표시 → 팝업 밖(빈 곳) 클릭 → 팝업만 닫힘, 표시 유지
  await tap(page, w.ids.force);
  assert.ok(await popup(page));
  await tapEmpty(page);
  assert.equal(await popup(page), null, '밖 클릭으로 팝업 닫힘');
  assert.deepEqual((await marks(page)).marked, [w.ids.force], '표시 유지');
  await waitServer(srv, [w.ids.force], '표시 유지(서버)');
});

test('클릭 표 ④: 팝업이 열린 채 다른 개념을 누르면 열린 팝업은 닫히고 새 개념에 규칙 적용(표시 없음 → 새 팝업 + 표시, 이미 표시됨 → 해제)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  await tap(page, w.ids.force);
  await tap(page, w.ids.mass);
  assert.equal((await marks(page)).popup, w.ids.mass);
  assert.deepEqual((await marks(page)).marked, [w.ids.force, w.ids.mass].sort((a, b) => a - b));
  assert.equal((await popup(page)).term, '질량');
  await waitServer(srv, [w.ids.force, w.ids.mass], '두 개념 표시');
  await tap(page, w.ids.force);                       // 팝업(질량)이 열린 채 이미 표시된 힘을 누름 → 팝업 닫힘 + 힘 해제
  assert.equal(await popup(page), null);
  assert.deepEqual((await marks(page)).marked, [w.ids.mass]);
  await waitServer(srv, [w.ids.mass], '힘 해제');
});

test('팝업 내용: 정의 → 옛 4항목은 정의, 설명이 없으면 "설명이 아직 없습니다", 140자 넘으면 줄임표 — 서버 요청 없이 이미 불러온 데이터만 사용', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  const reqs = []; srv.db.queries.length = 0;
  await tap(page, w.ids.mass);
  assert.equal((await popup(page)).text, '설명이 아직 없습니다');
  await tap(page, w.ids.fric);
  assert.equal((await popup(page)).text, '옛 정의입니다.');
  await tap(page, w.ids.long);
  assert.equal((await popup(page)).text, '가'.repeat(140) + '…');
  assert.ok(!srv.db.queries.some(q => /explanation/.test(q)), '팝업이 서버에서 설명을 다시 읽지 않음(표시 저장 요청만 있음)');
  assert.deepEqual(reqs, []);
  // 글자 크기·터치 영역
  const st = await page.eval("(() => { const p = document.getElementById('map-popup'), cs = e => getComputedStyle(e).fontSize; return { h: p.getBoundingClientRect().height, term: cs(p.querySelector('.p-term')), text: cs(p.querySelector('.p-text')), note: cs(p.querySelector('.p-note')) }; })()");
  assert.ok(st.h >= 44); assert.deepEqual([st.term, st.text, st.note], ['16px', '14px', '12px']);
});

test('표시는 새로고침 후에도 유지된다(사용자별 서버 저장)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  await tap(page, w.ids.mass); await tap(page, w.ids.fric);
  await waitServer(srv, [w.ids.mass, w.ids.fric], '서버 저장');
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000);
  await gotoMap(page, w.sci.id);
  await roSheet(page);
  assert.deepEqual((await marks(page)).marked, [w.ids.mass, w.ids.fric].sort((a, b) => a - b));
  assert.deepEqual(await isMarkedNode(page, w.ids.mass), { cls: true, badge: true });
  assert.deepEqual(await isMarkedNode(page, w.ids.force), { cls: false, badge: false });
  assert.equal(await popup(page), null, '열었을 때 팝업은 없음');
});

test('편집 가능한 시트에서는 클릭이 기존 역할(연결용 선택)만 하고 팝업·표시·표시 색이 없다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids.mass}/mark`, { marked: true });          // 서버에 이미 표시된 개념
  await backAndReopen(page, w.sci.id);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open && !document.getElementById('map-sheet').classList.contains('ro')", 4000);
  assert.deepEqual(await isMarkedNode(page, w.ids.mass), { cls: false, badge: false }, '편집 시트에는 표시 색이 없음');
  await tap(page, w.ids.force);
  assert.equal((await page.eval('window.CmapMap._state()')).selected, w.ids.force, '기존 역할: 연결용 선택');
  assert.equal(await popup(page), null);
  assert.deepEqual((await marks(page)).marked, [w.ids.mass], '표시는 바뀌지 않음');
  assert.deepEqual(serverMarks(srv), [w.ids.mass]);
});

test('퀴즈 모드에서는 팝업·표시 변경이 없고 표시 색도 보이지 않는다(정답 노출 방지)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await seed(page, 'PUT', `/api/cmap/concepts/${w.ids.mass}/mark`, { marked: true });
  await backAndReopen(page, w.sci.id);
  await roSheet(page);
  assert.deepEqual(await isMarkedNode(page, w.ids.mass), { cls: true, badge: true }, '읽기 전용 시트에서는 보임');
  await closeSheet(page);
  await page.click('#nav-quiz'); await page.waitFor("!document.getElementById('quiz-view').hidden && !!document.getElementById('quiz-start')", 4000, '퀴즈 탭');
  await page.click('#quiz-start'); await page.waitFor("document.getElementById('map-sheet').open && document.getElementById('map-sheet').classList.contains('quiz-mode')", 6000, '퀴즈 시트');
  assert.equal(await page.eval("document.querySelectorAll('.m-node.marked, .m-mark').length"), 0, '퀴즈에서는 표시 색 없음');
  await tap(page, w.ids.force);
  await tap(page, w.ids.force);                         // 퀴즈의 탭-탭(같은 개념 재탭 = 선택 취소)
  assert.equal(await popup(page), null);
  assert.deepEqual((await marks(page)).marked, [w.ids.mass], '표시 변경 없음');
  assert.deepEqual(serverMarks(srv), [w.ids.mass]);
});

test('드래그는 클릭으로 처리되지 않는다: 읽기 전용 시트에서 노드 위에서 끌면 지도만 이동하고 팝업·표시는 없다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  const r = await page.eval(`(() => { const e = document.querySelector('[data-node="${w.ids.force}"] rect').getBoundingClientRect(); return { x: (e.left + e.right) / 2, y: (e.top + e.bottom) / 2 }; })()`);
  const v0 = await page.eval('window.CmapMap._state().view');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 10 * i, y: r.y + 6 * i, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + 60, y: r.y + 36, button: 'left', clickCount: 1 });
  const v1 = await page.eval('window.CmapMap._state().view');
  assert.ok(Math.abs(v1.tx - v0.tx) > 10, '지도가 이동함(노드를 옮기지 않음)');
  assert.equal(await popup(page), null);
  assert.deepEqual((await marks(page)).marked, []);
  assert.equal(srv.db.marks.length, 0);
  assert.equal(srv.db.nodes.find(n => n.concept_id === w.ids.force).x, 150, '노드 위치는 그대로');
  // 5px(임계값 6px 미만)만 움직이고 떼면 클릭
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + 60, y: r.y + 36, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 63, y: r.y + 38, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + 63, y: r.y + 38, button: 'left', clickCount: 1 });
  assert.equal((await marks(page)).popup, w.ids.force, '작은 움직임은 클릭');
});

test('팝업 위치: 개념 근처에 놓이되 캔버스 안에서 잘리지 않는다(390px·1024px, 구석으로 옮긴 개념 포함)', { skip: SKIP }, async t => {
  for (const [width, height] of [[390, 844], [1024, 768]]) {
    const { page } = await open(t, { width, height });
    const w = await world(page);
    await roSheet(page);
    const inCanvas = async () => page.eval(`(() => { const p = document.getElementById('map-popup').getBoundingClientRect(), c = document.getElementById('map-canvas').getBoundingClientRect(); return p.left >= c.left + 7 && p.right <= c.right - 7 && p.top >= c.top + 7 && p.bottom <= c.bottom - 7; })()`);
    for (const id of Object.values(w.ids)) {
      await tap(page, id);
      assert.equal(await inCanvas(), true, `${width}px 개념 ${id}: 팝업이 캔버스 안`);
      await tap(page, id);                                          // 팝업 닫기
    }
    // 지도를 끌어 개념을 오른쪽 아래 구석으로 보낸 뒤에도 캔버스 안에 있다
    const c = await page.eval("(() => { const r = document.getElementById('map-svg').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()");
    const n = await page.eval(`(() => { const e = document.querySelector('[data-node="${w.ids.long}"] rect').getBoundingClientRect(); return { x: (e.left + e.right) / 2, y: (e.top + e.bottom) / 2 }; })()`);
    const sx = c.l + 20, sy = c.t + c.h / 2;
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + (c.w * 0.55) * i / 8, y: sy + (c.h * 0.3) * i / 8, button: 'left', buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + c.w * 0.55, y: sy + c.h * 0.3, button: 'left', clickCount: 1 });
    const n2 = await page.eval(`(() => { const e = document.querySelector('[data-node="${w.ids.long}"] rect').getBoundingClientRect(); return { x: (e.left + e.right) / 2, y: (e.top + e.bottom) / 2 }; })()`);
    assert.ok(n2.x > n.x, '개념이 오른쪽으로 이동함');
    if (n2.x < c.l + c.w - 4 && n2.y < c.t + c.h - 4) { await tap(page, w.ids.long); assert.equal(await inCanvas(), true, `${width}px 구석의 개념: 팝업이 캔버스 안`); }
  }
});

test('시트를 닫기·ESC·뒤로 가기로 닫으면 팝업도 함께 닫히고, 팝업·표시 상태가 다음에 열 때 꼬이지 않는다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  await tap(page, w.ids.force); assert.ok(await popup(page));
  await page.click('#map-sheet-close'); await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.eval("document.getElementById('map-popup').hidden"), true);
  await page.click('#wrong-open-map'); await page.waitFor("document.getElementById('map-sheet').open", 4000);
  assert.equal(await popup(page), null, '다시 열면 팝업 없음');
  assert.deepEqual((await marks(page)).marked, [w.ids.force], '표시는 유지');
  await tap(page, w.ids.mass); assert.ok(await popup(page));
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.eval("document.getElementById('map-popup').hidden"), true);
  await sleep(200);   // ESC 로 닫힌 직후 기록 되돌리기(history.back)가 끝나기를 기다린다
  await page.click('#wrong-open-map'); await page.waitFor("document.getElementById('map-sheet').open", 4000);
  await tap(page, w.ids.fric); assert.ok(await popup(page));
  await page.eval('history.back(); 0');
  await page.waitFor("!document.getElementById('map-sheet').open", 4000);
  assert.equal(await page.eval("document.getElementById('map-popup').hidden"), true);
  await sleep(200);   // 뒤로 가기로 닫힌 직후 기록 처리가 끝나기를 기다린다
  // 탭 바꾸기도 팝업을 닫는다
  await page.click('#wrong-open-map'); await page.waitFor("document.getElementById('map-sheet').open", 4000);
  await tap(page, w.ids.long); assert.ok(await popup(page));
  await closeSheet(page);
  await tabIn(page, 'narr'); await page.waitFor("document.getElementById('map-view').classList.contains('narr-mode')", 4000);
  assert.equal(await page.eval("document.getElementById('map-popup').hidden"), true);
});

test('서버 저장에 실패하면 표시를 되돌리고 짧은 안내를 보이며 팝업은 닫힌다(재시도 가능)', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  srv.db.failOn = /^INSERT INTO cmap_concept_marks/;
  await tap(page, w.ids.force);
  await page.waitFor("document.getElementById('map-msg').textContent.length > 0", 4000, '실패 안내');
  assert.match(await page.eval("document.getElementById('map-msg').textContent"), /표시를 저장하지 못했어요/);
  assert.deepEqual((await marks(page)).marked, [], '표시가 원래대로');
  assert.deepEqual(await isMarkedNode(page, w.ids.force), { cls: false, badge: false });
  assert.equal(await popup(page), null);
  assert.equal(srv.db.marks.length, 0);
  srv.db.failOn = null;
  await tap(page, w.ids.force);
  await waitServer(srv, [w.ids.force], '다시 누르면 저장됨');
});

test('연타: 같은 개념을 빠르게 여러 번 눌러도 서버는 마지막 화면 상태와 같아진다', { skip: SKIP }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  for (let i = 0; i < 5; i++) await tap(page, w.ids.mass);          // 표시 → 팝업 닫기 → 해제 → 표시 → 팝업 닫기
  const local = (await marks(page)).marked;
  assert.deepEqual(local, [w.ids.mass]);
  await waitServer(srv, local, '서버 = 화면');
  assert.equal(srv.db.marks.length, 1, '중복 행 없음');
});

test('390px: 표시된 개념의 보조 표식(물음표 배지)·테두리가 있고 가로 스크롤이 없으며, 해설 강조와 구분된다', { skip: SKIP }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await roSheet(page);
  await tap(page, w.ids.force); await tapEmpty(page);
  const mk = await page.eval(`(() => { const g = document.querySelector('[data-node="${w.ids.force}"]'), cs = getComputedStyle(g.querySelector('rect')), b = g.querySelector('.m-mark circle'); return { stroke: cs.stroke, sw: cs.strokeWidth, fill: cs.fill, badge: !!b, badgeFill: b ? getComputedStyle(b).fill : null, label: g.getAttribute('aria-label') }; })()`);
  assert.ok(mk.badge && mk.sw === '3px' && /표시됨/.test(mk.label), JSON.stringify(mk));
  // 해설 강조(.hl)와 비교: 강조는 코랄 굵은 테두리(3.5px)이고 배지·면 색이 없다
  await closeSheet(page);
  await tabIn(page, 'narr');
  await page.eval(`window.CmapMap.showOnMap([${w.ids.mass}]); 0`);
  await page.waitFor("document.getElementById('map-sheet').open", 4000);
  const hl = await page.eval(`(() => { const g = document.querySelector('[data-node="${w.ids.mass}"]'), cs = getComputedStyle(g.querySelector('rect')); return { stroke: cs.stroke, sw: cs.strokeWidth, badge: !!g.querySelector('.m-mark') }; })()`);
  assert.equal(hl.badge, false); assert.equal(hl.sw, '3.5px'); assert.notEqual(hl.stroke, mk.stroke, '강조와 표시의 테두리 색이 다름');
  assert.equal(await page.hasHorizontalScroll(), false);
});
