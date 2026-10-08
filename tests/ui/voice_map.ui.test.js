// 작업214-4: 음성 학습 "자료 연결 지도"(과목별 팝업) 화면 테스트 — 열기·닫기, 자동 맞춤, 확대/축소/핀치/드래그, 연결선 카드, 이유 수정·방향·삭제·연결 추가,
// 지도 그리기(견적 → 확인창 → 진행 → 완료), 오류 안내, 폴링 중단, 상세 화면 연동. 헤드리스 Chrome, 모의 API(tests/ui/helpers/mock_server.js).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { dialogAnswer } = require('./helpers/dialog');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const DEFAULT_NODES = [
  { id: 1, title: '광합성' }, { id: 2, title: '엽록체' }, { id: 3, title: '세포 호흡' }, { id: 4, title: '혼자 있는 자료', has_summary: false },
];
const DEFAULT_LINKS = [
  { id: 11, from_note_id: 1, to_note_id: 2, kind: 'grounded', relation: '엽록체에서 광합성이 일어난다', quote_from: '엽록체에서 일어난다 열 글자', quote_to: '광합성의 장소는 엽록체 열 글자', source: 'ai' },
  { id: 12, from_note_id: 1, to_note_id: 3, kind: 'background', relation: '에너지 대사로 이어진다', source: 'ai' },
  { id: 13, from_note_id: 2, to_note_id: 3, kind: 'manual', relation: '내가 이은 이유', source: 'user' },
];
async function open({ width = 390, height = 844, nodes = DEFAULT_NODES, links = DEFAULT_LINKS, built_at = '2026-01-02T03:04:00Z', setup } = {}) {
  srv.reset();
  srv.state.me.perm_voice_study = true;
  srv.seedVoiceMap({ nodes, links, built_at });
  if (setup) setup(srv);
  const page = await browser.newPage({ width, height });
  await page.goto(srv.url + '/voice_study.html');
  await page.waitFor(`document.getElementById('list-count').textContent === '${nodes.length}건'`, 8000);
  return page;
}
async function openMap(page, subject = '과학') {
  await page.click('#vm-open-btn');
  await page.waitFor("document.getElementById('vm-subject').open");
  await page.click(`.vm-subject-btn[data-subject="${subject}"]`);
  await page.waitFor("document.getElementById('vm-sheet').open && (!!document.querySelector('[data-t=vm-svg]') || document.getElementById('vm-empty').textContent.length > 0)", 6000);
}
const sheetOpen = page => page.eval("document.getElementById('vm-sheet').open");
const log = (url, method) => srv.state.log.filter(l => l.url === url && (!method || l.method === method));
const MAP = '/api/voice-notes/map', BUILD = '/api/voice-notes/map/build', STATUS = '/api/voice-notes/map/build-status';
const buildCalls = () => log(BUILD, 'POST');
const clickEdge = (page, id) => page.eval(`document.querySelector('[data-t=vm-edge][data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const clickNode = (page, id) => page.eval(`document.querySelector('[data-t=vm-node][data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
// 확인창이 뜰 때까지(견적 응답을 기다린 뒤) 기다렸다가 [확인]을 누른다
async function okConfirm(page) {
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')", 4000);
  await page.click('dialog.metis-dialog[open] [data-t="dialog-ok"]');
}
const vb = page => page.eval("document.querySelector('[data-t=vm-svg]').getAttribute('viewBox').split(' ').map(Number)");
const scaleOf = page => page.eval("(() => { const v = document.querySelector('[data-t=vm-svg]').getAttribute('viewBox').split(' ').map(Number); return document.getElementById('vm-box').clientWidth / v[2]; })()");
const allInside = page => page.eval(`(() => { const b = document.getElementById('vm-box').getBoundingClientRect(); return [...document.querySelectorAll('[data-t=vm-node]')].every(n => { const r = n.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }); })()`);
const pressEsc = async page => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
};
async function openDetail(page, id) {
  await page.eval(`openDetail(${id})`);
  await page.waitFor(`currentView === 'edit' && editNoteId === ${id}`, 5000);
  await page.waitFor("document.querySelectorAll('#link-list .link-card').length > 0 || document.getElementById('link-note').style.display !== 'none'", 5000);
}
const big = n => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: i + 1, title: '자료 ' + (i + 1) })),
  links: Array.from({ length: Math.floor(n * 0.75) }, (_, i) => ({ id: 1000 + i, from_note_id: Math.floor((i + 1) / 3) + 1, to_note_id: i + 2, kind: 'background', relation: '관련 ' + (i + 2) })),
});
const done = async page => { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); };

// ───────────────────────── 진입·열기·닫기 ─────────────────────────
test('목록의 [지도 보기]: 버튼 44px, 과목 선택에는 자료가 있는 과목만, 선택만으로는 API 호출 없음', { skip: SKIP }, async () => {
  const page = await open({ nodes: [...DEFAULT_NODES, { id: 90, title: '국어 자료', subject: '국어' }] });
  assert.ok(await page.eval("document.getElementById('vm-open-btn').getBoundingClientRect().height >= 43.5"));
  assert.equal(await page.text('#vm-open-btn'), '지도 보기');
  await page.click('#vm-open-btn');
  await page.waitFor("document.getElementById('vm-subject').open");
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.vm-subject-btn')].map(b => b.textContent)"), ['국어 · 1건', '과학 · 4건']);
  assert.ok(await page.eval("[...document.querySelectorAll('.vm-subject-btn')].every(b => b.getBoundingClientRect().height >= 43.5)"));
  assert.equal(srv.state.log.filter(l => l.url.startsWith('/api/voice-notes/map')).length, 0, '과목 선택까지는 지도 API 호출 없음');
  await page.click('#vm-subject-cancel');
  await page.waitFor("!document.getElementById('vm-subject').open");
  await done(page);
});

test('과목이 지정된 자료가 없으면 지도 대신 안내 문구', { skip: SKIP }, async () => {
  const page = await open({ nodes: [{ id: 1, title: '과목 없는 자료', subject: null }], links: [] });
  await page.eval("listRows.forEach(r => { r.subject = null; })");
  await page.click('#vm-open-btn');
  assert.match(await page.text('#list-msg'), /과목이 지정된 자료가 없어/);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.eval("document.getElementById('vm-subject').open"), false);
  await done(page);
});

test('지도를 여는 것만으로는 AI 경로를 부르지 않는다: GET map 1회, build(dry_run 포함)·build-status 0회', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  assert.equal(log(MAP, 'GET').length, 1);
  assert.equal(srv.state.log.find(l => l.url === MAP).search, '?subject=%EA%B3%BC%ED%95%99');
  assert.equal(buildCalls().length, 0, 'build 호출 없음(dry_run 포함)');
  assert.equal(log(STATUS).length, 0);
  assert.equal(await page.count('[data-t=vm-node]'), 4);
  assert.equal(await page.count('[data-t=vm-edge]'), 3);
  assert.equal(await page.count('.vm-node.iso'), 1, '연결 없는 자료는 옅게');
  assert.match(await page.text('#vm-built'), /마지막 지도 그리기/);
  assert.equal(await page.text('#vm-title'), '자료 연결 지도 · 과학');
  assert.equal(await allInside(page), true, '열릴 때 전체가 화면에 맞춰짐');
  await done(page);
});

test('팝업 크기: 390px은 화면 전체, 1024px은 가로·세로 90% 이상 가운데 큰 팝업', { skip: SKIP }, async () => {
  for (const [w, h, bigPopup] of [[390, 844, false], [768, 1024, true], [1024, 800, true]]) {
    const page = await open({ width: w, height: h });
    await openMap(page);
    const r = await page.eval("(() => { const b = document.getElementById('vm-sheet').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, iw: innerWidth, ih: innerHeight, radius: getComputedStyle(document.getElementById('vm-sheet')).borderRadius }; })()");
    if (!bigPopup) assert.ok(Math.abs(r.w - r.iw) < 1 && Math.abs(r.h - r.ih) < 1 && r.l < 1 && r.t < 1, '390px 화면 전체 ' + JSON.stringify(r));
    else {
      assert.ok(r.w / r.iw >= 0.9 && r.w < r.iw && r.h / r.ih >= 0.9 && r.h < r.ih, w + 'px 약 95%: ' + JSON.stringify(r));
      assert.ok(Math.abs((r.l + r.w / 2) - r.iw / 2) < 2 && Math.abs((r.t + r.h / 2) - r.ih / 2) < 2, '가운데');
      assert.equal(r.radius, '16px');
    }
    assert.equal(await allInside(page), true, w + 'px 자동 맞춤');
    assert.equal(await page.eval("document.getElementById('vm-sheet').scrollWidth <= document.getElementById('vm-sheet').clientWidth + 1"), true);
    assert.equal(await page.eval("getComputedStyle(document.documentElement).overflow"), 'hidden', '배경 스크롤 잠금');
    await done(page);
  }
});

test('닫기: 닫기 버튼 / ESC / 뒤로가기(목록에서) — 화면 유지, 기록 정리, 잠금 해제', { skip: SKIP }, async () => {
  const page = await open();
  for (const how of ['button', 'esc', 'back']) {
    await openMap(page);
    assert.equal(await page.eval('history.state && history.state.vmapSheet'), true, '열면 기록 한 칸');
    if (how === 'button') await page.click('#vm-close');
    else if (how === 'esc') await pressEsc(page);
    else await page.eval('history.back()');
    await page.waitFor("!document.getElementById('vm-sheet').open");
    await sleep(80);
    assert.equal(await page.eval('currentView'), 'list', how);
    assert.notEqual(await page.eval('history.state && history.state.vmapSheet'), true, how + ': 지도 표식 기록이 남지 않음');
    assert.equal(await page.eval("getComputedStyle(document.documentElement).overflow"), 'visible', how + ': 스크롤 잠금 해제');
    assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'vm-open-btn', how + ': 포커스가 [지도 보기]로');
    assert.equal(await page.count('[data-t=vm-svg]'), 0, how + ': 닫으면 비움');
  }
  assert.equal(await page.eval('document.querySelectorAll("dialog.metis-dialog").length'), 0);
  await done(page);
});

test('상세 화면에서 연 지도를 뒤로가기로 닫으면 지도만 닫히고 상세 유지, 확인창 없음(저장 안 한 내용이 있어도)', { skip: SKIP }, async () => {
  const page = await open();
  await openDetail(page, 2);
  await page.eval("editDirty = true");
  await page.click('#link-map-open');
  await page.waitFor("document.getElementById('vm-sheet').open && !!document.querySelector('[data-t=vm-svg]')");
  await page.eval('history.back()');
  await page.waitFor("!document.getElementById('vm-sheet').open");
  await sleep(100);
  assert.equal(await page.eval('currentView'), 'edit');
  assert.equal(await page.eval('editNoteId'), 2);
  assert.equal(await page.eval('document.querySelectorAll("dialog.metis-dialog").length'), 0, '확인창 없음');
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'link-map-open');
  // 이어서 상세 화면의 뒤로가기도 정상(지도 기록이 남아 있지 않음)
  await page.eval("editDirty = false");
  await page.click('#back-btn');
  await page.waitFor("currentView === 'list'", 4000);
  await done(page);
});

// ───────────────────────── 확대·축소·이동·핀치 ─────────────────────────
test('확대·축소 버튼, 화면 맞춤, 끌어서 이동, 마우스 휠', { skip: SKIP }, async () => {
  const page = await open({ width: 1024, height: 800 });
  await openMap(page);
  const v0 = await vb(page), s0 = await scaleOf(page);
  await page.click('#vm-zoom-in');
  assert.ok(Math.abs((await scaleOf(page)) / s0 - 1.25) < 0.01, '확대 1.25배');
  assert.ok(Math.abs((await vb(page))[0] + (await vb(page))[2] / 2 - (v0[0] + v0[2] / 2)) < 0.01, '중심 유지');
  await page.click('#vm-zoom-out'); await page.click('#vm-zoom-out');
  assert.ok((await scaleOf(page)) < s0);
  await page.click('#vm-zoom-fit');
  const v1 = await vb(page);
  assert.ok(v1.every((n, i) => Math.abs(n - v0[i]) < 0.01), '화면 맞춤은 열릴 때의 보기로');
  await page.drag('#vm-box', 60, 40);
  const v2 = await vb(page);
  assert.ok(v2[0] < v1[0] && v2[1] < v1[1], '끌면 반대로 이동');
  assert.equal(srv.state.log.filter(l => l.method !== 'GET').length, 0, '끌기는 선택이나 쓰기로 처리되지 않음');
  const r = await page.eval("(() => { const b = document.getElementById('vm-box').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
  const before = await scaleOf(page);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: -120 });
  await sleep(100);
  assert.ok((await scaleOf(page)) > before, '휠로 확대');
  await done(page);
});

test('핀치(두 손가락): 벌리면 확대·오므리면 축소, 가운데 지점이 제자리, 선택으로 처리되지 않음', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  const out = await page.eval(`(() => {
    const svg = document.querySelector('[data-t=vm-svg]');
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fire = (type, id, x, y) => svg.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
    const vbOf = () => svg.getAttribute('viewBox').split(' ').map(Number);
    const worldAt = (v, x, y) => [v[0] + (x - r.left) / (r.width / v[2]), v[1] + (y - r.top) / (r.height / v[3])];
    const before = vbOf(), w0 = worldAt(before, cx, cy);
    fire('pointerdown', 1, cx - 40, cy); fire('pointerdown', 2, cx + 40, cy);
    for (let i = 1; i <= 5; i++) { fire('pointermove', 1, cx - 40 - i * 10, cy); fire('pointermove', 2, cx + 40 + i * 10, cy); }
    const zoomed = vbOf(), w1 = worldAt(zoomed, cx, cy);
    fire('pointerup', 1, cx - 90, cy); fire('pointerup', 2, cx + 90, cy);
    fire('pointerdown', 1, cx - 100, cy); fire('pointerdown', 2, cx + 100, cy);
    for (let i = 1; i <= 5; i++) { fire('pointermove', 1, cx - 100 + i * 16, cy); fire('pointermove', 2, cx + 100 - i * 16, cy); }
    const pinchedIn = vbOf();
    fire('pointerup', 1, cx - 20, cy); fire('pointerup', 2, cx + 20, cy);
    return { before, zoomed, pinchedIn, w0, w1 };
  })()`);
  assert.ok(out.zoomed[2] < out.before[2] * 0.7, '벌리면 확대');
  assert.ok(Math.abs(out.w0[0] - out.w1[0]) < 0.5 && Math.abs(out.w0[1] - out.w1[1]) < 0.5, '두 손가락 가운데 아래 지점 제자리');
  assert.ok(out.pinchedIn[2] > out.zoomed[2] * 1.3, '오므리면 축소');
  assert.equal(await page.eval("document.getElementById('vm-card').hidden"), true, '핀치는 선택으로 처리되지 않음');
  await done(page);
});

test('노드 200개: 전부 화면에 맞춰지고(연결선 글자는 숨김), 줌 하한 0.05·상한 3에서 멈춤', { skip: SKIP }, async () => {
  const d = big(200);
  const page = await open({ nodes: d.nodes, links: d.links });
  await openMap(page);
  assert.equal(await page.count('[data-t=vm-node]'), 200);
  assert.equal(await allInside(page), true);
  const sc = await scaleOf(page);
  assert.ok(sc >= 0.05 && sc < 0.75, '하한 없이 줄어듦: ' + sc);
  assert.equal(await page.eval("document.querySelector('[data-t=vm-svg]').classList.contains('vm-small')"), true, '많이 줄이면 연결선 글자 숨김');
  for (let i = 0; i < 45; i++) await page.click('#vm-zoom-out');
  assert.ok(Math.abs((await scaleOf(page)) - 0.05) < 0.002, '축소 한계 0.05');
  for (let i = 0; i < 45; i++) await page.click('#vm-zoom-in');
  assert.ok(Math.abs((await scaleOf(page)) - 3) < 0.01, '확대 한계 3');
  await page.click('#vm-zoom-fit');
  assert.equal(await allInside(page), true, '화면 맞춤으로 복귀');
  await done(page);
});

// ───────────────────────── 연결선·카드 ─────────────────────────
test('연결선 클릭 영역: 눈에 안 보이는 28px 고정이고 선에서 9px 떨어진 곳을 실제로 눌러도 카드가 열림', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  for (let i = 0; i < 3; i++) await page.click('#vm-zoom-out');
  const info = await page.eval(`(() => { const p = document.querySelector('[data-t=vm-edge] path.hit'); const cs = getComputedStyle(p); return { w: cs.strokeWidth, stroke: cs.stroke, ve: cs.vectorEffect, line: getComputedStyle(document.querySelector('[data-t=vm-edge] path.line')).strokeWidth }; })()`);
  assert.equal(info.w, '28px'); assert.equal(info.ve, 'non-scaling-stroke'); assert.match(info.stroke, /rgba\(0, 0, 0, 0\)|transparent/); assert.equal(info.line, '1.5px');
  const pt = await page.eval(`(() => {
    const all = document.querySelectorAll('[data-t=vm-edge]'); const e = all[all.length - 1];
    const p = e.querySelector('path.hit'); const m = p.getPointAtLength(p.getTotalLength() / 2); const ctm = p.getScreenCTM();
    const x = ctm.a * m.x + ctm.e, y = ctm.d * m.y + ctm.f - 9;
    return { x, y, id: e.dataset.id, hit: document.elementFromPoint(x, y) === p };
  })()`);
  assert.equal(pt.hit, true);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await page.waitFor("!document.getElementById('vm-card').hidden");
  assert.equal(await page.eval("document.querySelector('[data-t=vm-edge].sel').dataset.id"), pt.id);
  await page.close();
});

test('연결선 카드: 이유·구절·kind 배지, manual은 배지 없음, 지도 SVG에는 ✔/◇/AI 문구 없음, 버튼 44px', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  const svgText = await page.eval("document.querySelector('[data-t=vm-svg]').textContent");
  assert.doesNotMatch(svgText, /✔|◇|AI|확인 필요|근거 확인|배경지식/, '지도 위 문구');
  assert.match(svgText, /엽록체에서 광합성/, '이유 문장은 선 위에 표시');
  await clickEdge(page, 11);
  assert.equal(await page.text('[data-t=vm-kind]'), '✔ 근거 확인');
  assert.match(await page.text('[data-t=vm-reason]'), /엽록체에서 광합성이 일어난다/);
  assert.equal(await page.text('[data-t=vm-edge-title]'), '광합성 → 엽록체');
  assert.equal(await page.text('[data-t=vm-quote-from]'), '광합성: “엽록체에서 일어난다 열 글자”');
  assert.equal(await page.text('[data-t=vm-quote-to]'), '엽록체: “광합성의 장소는 엽록체 열 글자”');
  assert.ok(await page.eval("[...document.querySelectorAll('#vm-card button')].every(b => b.getBoundingClientRect().height >= 43.5)"), '카드 버튼 44px');
  await clickEdge(page, 12);
  assert.equal(await page.text('[data-t=vm-kind]'), '◇ 배경지식');
  assert.equal(await page.count('.link-quote'), 0);
  await clickEdge(page, 13);
  assert.equal(await page.count('[data-t=vm-kind]'), 0, 'manual은 배지 없음');
  assert.equal(await page.text('[data-t=vm-reason]'), '내가 이은 이유');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#vm-card .vm-actions button')].map(b => b.textContent)"), ['이유 수정', '방향 바꾸기', '삭제', '닫기']);
  await page.click('[data-t=vm-card-close]');
  assert.equal(await page.eval("document.getElementById('vm-card').hidden"), true);
  await done(page);
});

test('이유 수정: 기존 값과 글자 수(80자) 표시, 바뀐 값을 PATCH로 저장, 81자는 막고, 취소하면 그대로', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  await clickEdge(page, 13);
  await page.click('[data-t=vm-edit-reason]');
  assert.equal(await page.eval("document.getElementById('vm-reason-input').value"), '내가 이은 이유');
  assert.equal(await page.eval("document.getElementById('vm-reason-input').maxLength"), 80);
  assert.match(await page.text('[data-t=vm-reason-counter]'), /^8 \/ 80$/);
  await page.type('#vm-reason-input', '새 이유');
  assert.equal(await page.text('[data-t=vm-reason-counter]'), '4 / 80');
  await page.click('[data-t=vm-reason-save]');
  await page.waitFor("document.querySelector('[data-t=vm-reason]') && document.querySelector('[data-t=vm-reason]').textContent === '새 이유'");
  const patch = log('/api/voice-notes/links/13', 'PATCH');
  assert.deepEqual(patch.map(l => l.body), [{ relation: '새 이유' }]);
  assert.equal(srv.state.voiceMap.links.find(l => l.id === 13).user_edited, true);
  // 81자(maxlength 우회)는 서버에 보내지 않음
  await page.click('[data-t=vm-edit-reason]');
  await page.eval("(() => { const i = document.getElementById('vm-reason-input'); i.removeAttribute('maxlength'); i.value = '가'.repeat(81); i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await page.click('[data-t=vm-reason-save]');
  assert.match(await page.text('[data-t=vm-card-msg]'), /80자 이하/);
  assert.equal(log('/api/voice-notes/links/13', 'PATCH').length, 1);
  await page.click('[data-t=vm-reason-cancel]');
  assert.equal(await page.text('[data-t=vm-reason]'), '새 이유');
  // 같은 값이면 호출 없이 닫힘
  await page.click('[data-t=vm-edit-reason]');
  await page.click('[data-t=vm-reason-save]');
  assert.equal(log('/api/voice-notes/links/13', 'PATCH').length, 1);
  await done(page);
});

test('방향 바꾸기: PATCH {swap:true}, 카드 제목의 방향이 바뀌고 지도가 다시 그려짐', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  await clickEdge(page, 11);
  await page.click('[data-t=vm-swap]');
  await page.waitFor("document.querySelector('[data-t=vm-edge-title]').textContent === '엽록체 → 광합성'");
  assert.deepEqual(log('/api/voice-notes/links/11', 'PATCH').map(l => l.body), [{ swap: true }]);
  assert.equal(await page.count('[data-t=vm-edge]'), 3);
  await done(page);
});

test('삭제: metisConfirm(AI 연결은 "지도에서 숨깁니다", 직접 만든 연결은 "삭제합니다"), 취소하면 호출 없음', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  await clickEdge(page, 13);
  await page.click('[data-t=vm-delete]');
  const userMsg = await dialogAnswer(page, false);
  assert.match(userMsg, /삭제합니다/); assert.doesNotMatch(userMsg, /숨깁니다/);
  assert.equal(log('/api/voice-notes/links/13', 'DELETE').length, 0, '취소하면 호출 없음');
  await page.click('[data-t=vm-delete]');
  await dialogAnswer(page, true);
  await page.waitFor("document.querySelectorAll('[data-t=vm-edge]').length === 2");
  assert.equal(log('/api/voice-notes/links/13', 'DELETE').length, 1);
  assert.equal(await page.eval("document.getElementById('vm-card').hidden"), true, '삭제 후 카드 닫힘');
  await clickEdge(page, 11);
  await page.click('[data-t=vm-delete]');
  const aiMsg = await dialogAnswer(page, true);
  assert.match(aiMsg, /지도에서 숨깁니다/); assert.doesNotMatch(aiMsg, /삭제합니다/);
  await page.waitFor("document.querySelectorAll('[data-t=vm-edge]').length === 1");
  assert.equal(await page.eval('document.querySelectorAll("dialog.metis-dialog").length'), 0);
  await done(page);
});

test('노드 카드·연결 추가: 검색으로 고르고 이유(80자)를 적어 POST, 지도에 반영, 중복이면 "이미 연결되어 있습니다."', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  await clickNode(page, 4);
  assert.equal(await page.text('[data-t=vm-node-title]'), '혼자 있는 자료');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#vm-card .vm-actions button')].map(b => b.textContent)"), ['이 자료 열기', '다른 자료와 연결 추가', '닫기']);
  await page.click('[data-t=vm-add-link]');
  assert.equal(await page.count('[data-t=vm-add-item]'), 3, '자기 자신 제외 3개');
  await page.type('#vm-add-search', '엽록');
  assert.equal(await page.count('[data-t=vm-add-item]'), 1);
  await page.type('#vm-add-search', '없는이름');
  assert.match(await page.text('.vm-pick-empty'), /검색 결과가 없습니다/);
  await page.type('#vm-add-search', '엽록');
  await page.click('[data-t=vm-add-item]');
  assert.equal(await page.eval("document.querySelector('[data-t=vm-add-item]').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.eval("document.getElementById('vm-add-reason').maxLength"), 80);
  await page.type('#vm-add-reason', '직접 추가한 이유');
  assert.equal(await page.text('[data-t=vm-add-counter]'), '9 / 80');
  await page.click('[data-t=vm-add-submit]');
  await page.waitFor("document.querySelectorAll('[data-t=vm-edge]').length === 4");
  assert.deepEqual(log('/api/voice-notes/links', 'POST').map(l => l.body), [{ from_note_id: 4, to_note_id: 2, relation: '직접 추가한 이유' }]);
  assert.equal(await page.text('[data-t=vm-reason]'), '직접 추가한 이유', '새 연결 카드가 열림');
  assert.equal(await page.count('.vm-node.iso'), 0, '이제 연결 없는 자료 없음');
  // 중복
  await clickNode(page, 2);
  await page.click('[data-t=vm-add-link]');
  await page.click('[data-t=vm-add-item][data-id="4"]');
  await page.click('[data-t=vm-add-submit]');
  await page.waitFor("document.querySelector('[data-t=vm-card-msg]').textContent.length > 0");
  assert.equal(await page.text('[data-t=vm-card-msg]'), '이미 연결되어 있습니다.');
  assert.equal(await page.count('[data-t=vm-edge]'), 4);
  // 연결할 자료를 고르지 않으면 안내
  await page.click('[data-t=vm-add-cancel]');
  await page.click('[data-t=vm-add-link]');
  await page.click('[data-t=vm-add-submit]');
  assert.match(await page.text('[data-t=vm-card-msg]'), /연결할 자료를 선택/);
  await done(page);
});

// ───────────────────────── 지도 그리기 ─────────────────────────
test('지도 그리기: 견적(dry_run) → 확인창 내용 → 확정 → 진행 표시 → 완료 후 지도 갱신, 확정 전에는 실행 호출 없음', { skip: SKIP }, async () => {
  const page = await open({ setup: s => {
    Object.assign(s.state.voiceBuild.dry, { targets: 5, est_calls: 3, carry_over: 2, daily_link_remaining: 27 });
    s.state.voiceBuild.statusSeq = [{ status: 'running', done: 1, total: 3, links_added: 1 }, { status: 'done', done: 3, total: 3, links_added: 4, errors: 0, carry_over: 2, stopped_reason: null }];
  } });
  await openMap(page);
  assert.equal(await page.eval("document.getElementById('vm-build').disabled"), false);
  await page.click('#vm-build');
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
  const confirmText = await page.text('dialog.metis-dialog[open] [data-t="dialog-msg"]');
  assert.match(confirmText, /분석할 자료 3개/); assert.match(confirmText, /호출 횟수 3회/); assert.match(confirmText, /오늘 남은 분석 건수 27건/);
  assert.match(confirmText, /이번에 못 하는 자료 2개는 다음 실행에서 이어서 처리됩니다/); assert.match(confirmText, /추정입니다/);
  assert.equal(await page.text('dialog.metis-dialog[open] [data-t="dialog-ok"]'), '지도 그리기');
  assert.deepEqual(buildCalls().map(l => l.body), [{ subject: '과학', dry_run: true }], '확인 전에는 견적만');
  await okConfirm(page);
  await page.waitFor("document.getElementById('vm-progress').style.display !== 'none'", 3000);
  assert.match(await page.text('#vm-progress-text'), /분석 중/);
  assert.equal(await page.eval("document.getElementById('vm-build').disabled"), true, '진행 중 버튼 비활성');
  srv.state.voiceMap.links.push({ id: 500, from_note_id: 4, to_note_id: 1, kind: 'background', relation: '새로 만든 연결', quote_from: '', quote_to: '', source: 'ai', user_edited: false });
  await page.waitFor("/1\\/3 분석 중/.test(document.getElementById('vm-progress-text').textContent)", 6000);
  await page.waitFor("document.getElementById('vm-progress').style.display === 'none' && /연결을 만들었습니다/.test(document.getElementById('vm-msg').textContent)", 9000);
  const msg = await page.text('#vm-msg');
  assert.match(msg, /4개 연결을 만들었습니다/); assert.match(msg, /남은 2개는 다시 지도를 그릴 때 이어서 처리됩니다/);
  assert.equal(await page.count('[data-t=vm-edge]'), 4, '완료 후 지도를 새로 불러와 그림');
  assert.equal(log(MAP, 'GET').length, 2, '열 때 1회 + 완료 후 1회');
  assert.deepEqual(buildCalls().map(l => l.body), [{ subject: '과학', dry_run: true }, { subject: '과학' }]);
  assert.equal(log(STATUS).length, 2);
  assert.equal(await page.eval("document.getElementById('vm-build').disabled"), false, '끝나면 다시 활성');
  await done(page);
});

test('지도 그리기: 요약 있는 자료가 3개 미만이면 비활성+문구, targets 0이면 안내만(실행 호출 없음), 오늘 한도 소진이면 확인창 없이 안내', { skip: SKIP }, async () => {
  let page = await open({ nodes: [{ id: 1, title: '가' }, { id: 2, title: '나' }, { id: 3, title: '다', has_summary: false }], links: [] });
  await openMap(page);
  assert.equal(await page.eval("document.getElementById('vm-build').disabled"), true);
  assert.match(await page.text('#vm-build-hint'), /요약이 있는 자료가 3개 이상 필요합니다/);
  assert.equal(buildCalls().length, 0);
  await page.close();

  page = await open({ setup: s => { Object.assign(s.state.voiceBuild.dry, { targets: 0, est_calls: 0 }); } });
  await openMap(page);
  await page.click('#vm-build');
  await page.waitFor("document.getElementById('vm-msg').textContent.length > 0");
  assert.match(await page.text('#vm-msg'), /새로 분석할 자료가 없습니다/);
  assert.equal(await page.eval('document.querySelectorAll("dialog.metis-dialog").length'), 0, '확인창 없음');
  assert.deepEqual(buildCalls().map(l => l.body), [{ subject: '과학', dry_run: true }], 'dry_run만, 실행 호출 없음');
  await page.close();

  page = await open({ setup: s => { Object.assign(s.state.voiceBuild.dry, { targets: 3, est_calls: 0, daily_link_remaining: 0 }); } });
  await openMap(page);
  await page.click('#vm-build');
  await page.waitFor("document.getElementById('vm-msg').textContent.length > 0");
  assert.match(await page.text('#vm-msg'), /오늘 분석할 수 있는 횟수를 모두 사용/);
  assert.equal(buildCalls().length, 1);
  await done(page);
});

test('지도 그리기 오류 안내: 409(진행 중), 429(서버 문구), 503, 400 — 실행 POST가 거절된 경우', { skip: SKIP }, async () => {
  const cases = [
    [409, '', /이미 그리는 중/], [429, '하루 5번까지 지도를 그릴 수 있습니다.', /하루 5번까지 지도를 그릴 수 있습니다/],
    [503, '', /AI를 지금 사용할 수 없습니다/], [400, '요약이 있는 자료가 3개 이상 필요합니다.', /3개 이상 필요/],
  ];
  for (const [status, msg, re] of cases) {
    const page = await open({ setup: s => { s.state.voiceBuild.error = { status, msg }; s.state.voiceBuild.statusSeq = [{ status: 'running', done: 0, total: 3, links_added: 0 }]; } });
    await openMap(page);
    await page.click('#vm-build');
    await okConfirm(page);
    await page.waitFor(`${re}.test(document.getElementById('vm-msg').textContent)`, 4000);
    assert.equal(buildCalls().length, 2, status + ': dry_run + 실행 1회');
    if (status === 409) assert.match(await page.text('#vm-progress-text'), /진행 상황을 확인하는 중/, '409면 진행 상황을 이어서 보여 줌');
    else assert.equal(await page.eval("document.getElementById('vm-build').disabled"), false, status + ': 버튼 다시 활성');
    await page.click('#vm-close');
    await page.close();
  }
});

test('견적(dry_run) 단계의 오류(503)는 확인창 없이 안내하고 실행 호출을 하지 않음', { skip: SKIP }, async () => {
  const page = await open({ setup: s => { s.state.voiceBuild.dryError = { status: 503, msg: '' }; } });
  await openMap(page);
  await page.click('#vm-build');
  await page.waitFor("document.getElementById('vm-msg').textContent.length > 0");
  assert.match(await page.text('#vm-msg'), /AI를 지금 사용할 수 없습니다/);
  assert.equal(await page.eval('document.querySelectorAll("dialog.metis-dialog").length'), 0);
  assert.equal(buildCalls().length, 1);
  assert.equal(await page.eval("document.getElementById('vm-build').disabled"), false);
  await done(page);
});

test('진행 상태가 idle로 돌아오면(서버 재시작 등) 폴링을 멈추고 지도를 새로 불러옴', { skip: SKIP }, async () => {
  const page = await open({ setup: s => { s.state.voiceBuild.statusSeq = []; } });   // 조회하면 idle
  await openMap(page);
  await page.click('#vm-build');
  await okConfirm(page);
  await page.waitFor("/진행 상태를 확인할 수 없어/.test(document.getElementById('vm-msg').textContent)", 6000);
  assert.equal(await page.eval("document.getElementById('vm-progress').style.display"), 'none');
  assert.equal(log(MAP, 'GET').length, 2, '지도를 새로 불러옴');
  const n = log(STATUS).length;
  await sleep(3200);
  assert.equal(log(STATUS).length, n, '폴링 멈춤');
  assert.equal(await page.eval("document.getElementById('vm-build').disabled"), false);
  await done(page);
});

test('팝업을 닫으면 진행 상태 폴링을 멈춘다(타이머 누수 없음)', { skip: SKIP }, async () => {
  const page = await open({ setup: s => { s.state.voiceBuild.statusSeq = [{ status: 'running', done: 1, total: 3, links_added: 0 }]; } });
  await openMap(page);
  await page.click('#vm-build');
  await okConfirm(page);
  await page.waitFor("document.getElementById('vm-progress').style.display !== 'none'", 3000);
  await page.waitFor("/1\\/3 분석 중/.test(document.getElementById('vm-progress-text').textContent)", 6000);
  const n = log(STATUS).length;
  assert.ok(n >= 1);
  await page.click('#vm-close');
  await page.waitFor("!document.getElementById('vm-sheet').open");
  await sleep(3200);
  assert.equal(log(STATUS).length, n, '닫은 뒤 추가 조회 없음');
  assert.equal(await page.eval('vmap.buildTimer'), null);
  // 다시 열어도 이전 실행의 진행 표시나 폴링이 되살아나지 않음
  await openMap(page);
  assert.equal(await page.eval("document.getElementById('vm-progress').style.display"), 'none');
  await sleep(2800);
  assert.equal(log(STATUS).length, n);
  await done(page);
});

// ───────────────────────── 안내·상세 연동 ─────────────────────────
test('연결이 하나도 없는 과목: 안내 문구(노드는 그대로 그려 직접 연결 가능), 자료가 없는 과목 문구', { skip: SKIP }, async () => {
  const page = await open({ links: [] });
  await openMap(page);
  assert.equal(await page.text('#vm-empty'), '아직 연결이 없습니다. [지도 그리기]를 누르거나, 노드에서 직접 연결을 추가하세요.');
  assert.equal(await page.count('[data-t=vm-node]'), 4);
  assert.equal(await page.count('.vm-node.iso'), 4);
  assert.equal(await page.eval("document.getElementById('vm-empty').hidden"), false);
  await clickNode(page, 1);
  assert.equal(await page.count('[data-t=vm-add-link]'), 1);
  await done(page);
});

test('상세 연결 카드: manual 연결은 ◇ 배지·"사실 확인 필요" 없이, AI 연결은 기존대로 표시', { skip: SKIP }, async () => {
  const page = await open();
  await openDetail(page, 2);   // 11(근거 확인) · 13(manual)
  const cards = await page.eval(`[...document.querySelectorAll('#link-list .link-card')].map(c => ({ badge: c.querySelector('.link-badge') ? c.querySelector('.link-badge').textContent : null, text: c.textContent, quotes: c.querySelectorAll('.link-quote').length }))`);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].badge, '✔ 근거 확인'); assert.equal(cards[0].quotes, 2);
  assert.equal(cards[1].badge, null, 'manual은 배지 없음');
  assert.match(cards[1].text, /내가 이은 이유/); assert.doesNotMatch(cards[1].text, /사실 확인 필요|배경지식/);
  await openDetail(page, 1);   // 11(근거 확인) · 12(배경지식)
  const bg = await page.eval(`[...document.querySelectorAll('#link-list .link-card')].map(c => (c.querySelector('.link-badge') || {}).textContent + '|' + /사실 확인 필요/.test(c.textContent))`);
  assert.deepEqual(bg, ['✔ 근거 확인|false', '◇ 배경지식 연결|true']);
  await done(page);
});

test('상세의 [이 자료 중심으로 보기]: 같은 과목 지도를 열고 그 노드를 선택해 가운데에 둠, 과목이 없으면 안내', { skip: SKIP }, async () => {
  const page = await open();
  await openDetail(page, 2);
  assert.equal(await page.text('#link-map-open'), '이 자료 중심으로 보기');
  assert.ok(await page.eval("document.getElementById('link-map-open').getBoundingClientRect().height >= 43.5"));
  await page.click('#link-map-open');
  await page.waitFor("document.getElementById('vm-sheet').open && !!document.querySelector('[data-t=vm-svg]')");
  assert.equal(await page.text('#vm-title'), '자료 연결 지도 · 과학');
  assert.equal(await page.eval(`(() => { const n = document.querySelector('[data-t=vm-node][data-id="2"]'); const b = document.getElementById('vm-box').getBoundingClientRect(); const r = n.getBoundingClientRect(); return n.classList.contains('sel') && Math.abs((r.left + r.right) / 2 - (b.left + b.right) / 2) < 25 && Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2) < 25; })()`), true, '선택 + 가운데');
  assert.equal(await page.text('[data-t=vm-node-title]'), '엽록체', '그 자료의 카드가 열려 있음');
  assert.ok((await scaleOf(page)) >= 0.99, '읽을 수 있는 크기');
  await page.click('#vm-close');
  await page.waitFor("!document.getElementById('vm-sheet').open");
  await page.eval("document.getElementById('edit-subject').value = ''");
  await page.click('#link-map-open');
  assert.match(await page.text('#link-msg'), /과목을 지정하고 저장하면/);
  assert.equal(await sheetOpen(page), false);
  await done(page);
});

test('노드의 [이 자료 열기]: 목록에서 연 지도는 상세로 이동 후 뒤로가기 한 번에 목록, 상세에서 연 지도는 저장 안 한 내용이 있으면 metisConfirm', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  await clickNode(page, 2);
  await page.click('[data-t=vm-open-note]');
  await page.waitFor("!document.getElementById('vm-sheet').open && currentView === 'edit' && editNoteId === 2", 4000);
  await page.eval('history.back()');
  await page.waitFor("currentView === 'list'", 4000);
  await sleep(100);
  assert.equal(await page.eval('currentView'), 'list', '뒤로가기 한 번에 목록');
  assert.equal(await page.eval('document.querySelectorAll("dialog.metis-dialog").length'), 0);

  await openDetail(page, 1);
  await page.eval("editDirty = true");
  await page.click('#link-map-open');
  await page.waitFor("document.getElementById('vm-sheet').open && !!document.querySelector('[data-t=vm-svg]')");
  await clickNode(page, 3);
  await page.click('[data-t=vm-open-note]');
  assert.match(await dialogAnswer(page, false), /저장하지 않은 내용이 있습니다/);
  assert.equal(await sheetOpen(page), true, '취소하면 지도 유지');
  assert.equal(await page.eval('editNoteId'), 1);
  await page.click('[data-t=vm-open-note]');
  await dialogAnswer(page, true);
  await page.waitFor("!document.getElementById('vm-sheet').open && editNoteId === 3", 4000);
  assert.equal(await page.eval('currentView'), 'edit');
  // 같은 자료를 고르면 지도만 닫힘
  await page.click('#link-map-open');
  await page.waitFor("document.getElementById('vm-sheet').open && !!document.querySelector('[data-t=vm-svg]')");
  await clickNode(page, 3);
  await page.click('[data-t=vm-open-note]');
  await page.waitFor("!document.getElementById('vm-sheet').open");
  assert.equal(await page.eval('editNoteId'), 3);
  await done(page);
});

// ───────────────────────── 회귀 방지·레이아웃 ─────────────────────────
test('회귀 방지: 팝업 마크업은 앱 본문 뒤에 있고, 문서의 첫 .btn은 팝업 안의 버튼이 아니다(screen_bar_b가 첫 .btn의 색을 본다)', { skip: SKIP }, async () => {
  const page = await open();
  const info = await page.eval(`(() => {
    const first = document.querySelector('.btn'), app = document.getElementById('app');
    return { id: first.id, inDialog: !!first.closest('dialog'),
      sheetAfterApp: !!(app.compareDocumentPosition(document.getElementById('vm-sheet')) & Node.DOCUMENT_POSITION_FOLLOWING),
      subjectAfterApp: !!(app.compareDocumentPosition(document.getElementById('vm-subject')) & Node.DOCUMENT_POSITION_FOLLOWING),
      color: getComputedStyle(first).backgroundColor };
  })()`);
  assert.equal(info.inDialog, false); assert.equal(info.id, 'new-rec-btn');
  assert.equal(info.sheetAfterApp, true); assert.equal(info.subjectAfterApp, true);
  assert.equal(info.color, 'rgb(184, 68, 46)', '주 버튼은 진한 코랄');
  await done(page);
});

for (const w of [390, 768, 1024]) {
  test(`레이아웃 ${w}px: 지도·카드·과목 선택의 버튼 44px 이상, 가로 스크롤 없음, 스크립트 오류 없음`, { skip: SKIP }, async () => {
    const page = await open({ width: w, height: 844 });
    assert.equal(await page.hasHorizontalScroll(), false, '목록');
    await page.click('#vm-open-btn');
    await page.waitFor("document.getElementById('vm-subject').open");
    assert.equal(await page.eval("[...document.querySelectorAll('#vm-subject button')].filter(b => b.getBoundingClientRect().height < 43.5).length"), 0, '과목 선택 버튼');
    await page.click('.vm-subject-btn');
    await page.waitFor("document.getElementById('vm-sheet').open && !!document.querySelector('[data-t=vm-svg]')");
    await clickEdge(page, 11);
    const small = await page.eval(`[...document.querySelectorAll('#vm-sheet button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(b => b.getAttribute('data-t') || b.id)`);
    assert.deepEqual(small, [], '44px 미만 요소');
    await clickNode(page, 4);
    await page.click('[data-t=vm-add-link]');
    const small2 = await page.eval(`[...document.querySelectorAll('#vm-sheet button, #vm-sheet input')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height < 43.5; }).map(b => b.getAttribute('data-t') || b.id)`);
    assert.deepEqual(small2, [], '연결 추가 패널의 44px 미만 요소');
    assert.equal(await page.hasHorizontalScroll(), false, '지도');
    assert.equal(await page.eval("document.getElementById('vm-sheet').scrollWidth <= document.getElementById('vm-sheet').clientWidth + 1"), true);
    await done(page);
  });
}
