// 작업216-2: 음성 학습 보조 버튼은 박스 없는 텍스트 버튼(.btn.text), 표시 뱃지(.link-badge)는 박스·테두리·알약 없는 작은 텍스트.
// 유지 목록(오답 노트·선택·다시 녹음·이어서 녹음·자료로 돌아가기, 주요 채움 버튼, 칩·카드·select)은 그대로임을 확인한다.
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

const NODES = [{ id: 1, title: '광합성' }, { id: 2, title: '엽록체' }, { id: 3, title: '세포 호흡' }, { id: 4, title: '혼자 있는 자료', has_summary: false }];
const LINKS = [
  { id: 11, from_note_id: 1, to_note_id: 2, kind: 'grounded', relation: '엽록체에서 광합성이 일어난다', quote_from: '엽록체에서 일어난다 열 글자', quote_to: '광합성의 장소는 엽록체 열 글자', source: 'ai' },
  { id: 12, from_note_id: 1, to_note_id: 3, kind: 'background', relation: '에너지 대사로 이어진다', source: 'ai' },
  { id: 13, from_note_id: 2, to_note_id: 3, kind: 'manual', relation: '내가 이은 이유', source: 'user' },
];
async function open({ width = 390, stale = false } = {}) {
  srv.reset();
  srv.state.me.perm_voice_study = true;
  srv.seedVoiceMap({ nodes: NODES, links: LINKS, built_at: '2026-01-02T03:04:00Z' });
  if (stale) srv.state.voiceNotes[0].summary_stale = true;
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/voice_study.html');
  await page.waitFor("document.getElementById('list-count').textContent === '4건'", 8000);
  await page.eval(NO_MOTION);
  return page;
}
const clickEdge = (page, id) => page.eval(`document.querySelector('[data-t=vm-edge][data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const clickNode = (page, id) => page.eval(`document.querySelector('[data-t=vm-node][data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
async function openMap(page) {
  await page.click('#vm-open-btn');
  await page.waitFor("document.getElementById('vm-subject').open");
  await page.click('.vm-subject-btn[data-subject="과학"]');
  await page.waitFor("document.getElementById('vm-sheet').open && !!document.querySelector('[data-t=vm-svg]')", 6000);
}
async function openDetail(page, id) {
  await page.eval(`openDetail(${id})`);
  await page.waitFor(`currentView === 'edit' && editNoteId === ${id}`, 5000);
  // 상세를 연 뒤에도 연결·퀴즈·그림 조회 응답과 글꼴 적용으로 레이아웃이 한동안 움직인다. 좌표를 재고 마우스를 누르는 사이에 버튼이 움직이면
  // 클릭이 빗나가므로(작업216-3에서 간헐 실패), 조회가 끝나고 주요 버튼들의 위치가 연속 4번(50ms 간격) 같을 때까지 기다린다
  await page.waitFor("document.getElementById('link-status').style.display === 'none' && document.fonts.status === 'loaded'", 5000);
  let last = '', same = 0;
  for (let i = 0; i < 100 && same < 4; i++) {
    const now = await page.eval("['edit-delete', 'edit-save', 'edit-cancel', 'sum-make'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return Math.round(r.top * 10) + ':' + Math.round(r.left * 10); }).join('|') + '|' + document.documentElement.scrollHeight");
    same = now === last ? same + 1 : 0; last = now;
    await sleep(50);
  }
  assert.ok(same >= 4, '상세 화면 레이아웃이 안정되지 않음');
}

// 페이지 안에서 요소 하나의 모양·터치 영역·글자 대비를 잰다(숨겨진 조상은 잠깐 보이게 한 뒤 되돌린다)
const MEASURE = sel => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const shown = [];
  for (let a = e; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).display === 'none') { shown.push([a, a.style.display]); a.style.display = a === e ? 'inline-flex' : 'block'; }
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  const num = c => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([R, G, B]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
  let bgEff = 'rgb(255, 255, 255)';
  for (let a = e; a; a = a.parentElement) { const b = getComputedStyle(a).backgroundColor; const n = num(b); if (n.length < 4 || n[3] > 0.99) { if (n.length >= 3) { bgEff = b; break; } } }
  const l1 = lum(num(cs.color)), l2 = lum(num(bgEff));
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const out = { cls: e.className, w: r.width, h: r.height, bg: cs.backgroundColor, bw: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], radius: cs.borderTopLeftRadius,
    color: cs.color, bgEff, ratio, underline: cs.textDecorationLine.includes('underline'), cursor: cs.cursor, weight: cs.fontWeight, pad: cs.padding };
  for (const [a, d] of shown) a.style.display = d;
  return out;
})()`;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
// 채움 주요 버튼의 바탕: 기본 --btn-primary-bg, 마우스가 위에 있으면 --btn-primary-bg-hover. 둘 다 "주요 채움"이다.
const PRIMARY_FILL = 'rgb(184, 68, 46)', PRIMARY_FILL_HOVER = 'rgb(156, 58, 39)';
const isPrimaryFill = bg => bg === PRIMARY_FILL || bg === PRIMARY_FILL_HOVER;
// 위험 텍스트 버튼의 글자색: 기본 --primary-dark, 호버·눌림은 --btn-primary-bg-hover(더 진함). 둘 다 4.5:1 이상
const isDangerText = c => c === 'rgb(184, 68, 46)' || c === 'rgb(156, 58, 39)';
// 테스트 쪽에서만 모든 transition·animation을 끈다. 앱의 .btn은 transition: all 0.15s라서 호버·포커스 직후에 색·윤곽선을 읽으면
// 기본값과 목표값 사이의 중간 값이 읽혀 전체 실행처럼 부하가 있을 때만 흔들렸다(작업216-3).
const NO_MOTION = `(() => { const s = document.createElement('style'); s.id = 'test-no-motion'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()`;
function assertTextButton(m, label) {
  assert.ok(m, label + ': 요소 없음');
  assert.match(m.cls, /\btext\b/, label + ': .text 클래스');
  assert.doesNotMatch(m.cls, /secondary/, label + ': .secondary 아님');
  assert.equal(m.bg, TRANSPARENT, label + ': 배경 투명');
  assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px'], label + ': 테두리 없음');
  assert.ok(m.h >= 43.5 && m.w >= 43.5, `${label}: 터치 영역 44px 이상 (${m.w}x${m.h})`);
  assert.ok(m.ratio >= 4.5, `${label}: 글자 대비 4.5:1 이상 (${m.ratio.toFixed(2)})`);
  assert.equal(m.underline, true, label + ': 밑줄');
  assert.equal(m.cursor, 'pointer');
}

// 변환된 마크업 버튼과 그 버튼이 있는 화면(null = 팝업·대화상자라 별도 테스트에서 연다)
const MARKUP = [
  ['vm-open-btn', 'list'], ['rec-pause', 'record'], ['undo-append', 'edit'], ['over-copy', 'edit'], ['over-close', 'edit'], ['after-list', 'edit'], ['tts-pause', 'edit'], ['tts-stop', 'edit'],
  ['link-map-open', 'edit'], ['link-refresh', 'edit'], ['edit-cancel', 'edit'], ['merge-cancel', 'merge'], ['chat-reset', 'chat'],
];

test('변환된 마크업 보조 버튼 13개: 배경 투명·테두리 0·터치 44px·글자 대비 4.5:1·밑줄', { skip: SKIP }, async () => {
  const page = await open();
  assert.equal(await page.eval("getComputedStyle(document.getElementById('vm-open-btn')).transitionDuration"), '0s', '테스트용 전환 비활성화가 적용됨');
  await openDetail(page, 2);
  for (const [id, view] of MARKUP) {
    await page.eval(`showView(${JSON.stringify(view)})`);
    assertTextButton(await page.eval(MEASURE('#' + id)), '#' + id);
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('위험 텍스트 버튼(#edit-delete): 박스 없이 진한 글자(5.38:1), 항상 확인창을 거친 뒤에만 삭제 요청', { skip: SKIP }, async () => {
  const page = await open();
  await openDetail(page, 2);
  const m = await page.eval(MEASURE('#edit-delete'));
  assertTextButton(m, '#edit-delete');
  assert.match(m.cls, /\bdanger\b/);
  assert.ok(isDangerText(m.color), '위험 글자색은 기존 토큰 --primary-dark(또는 호버 시 더 진한 --btn-primary-bg-hover): ' + m.color);
  assert.ok(m.ratio >= 5, '위험 글자 대비 ' + m.ratio);
  assert.equal(await page.count('.btn.danger:not(.text)'), 0, '확인창 없이 실행되는 박스형 위험 버튼 없음');
  await page.click('#edit-delete');
  assert.match(await dialogAnswer(page, false), /이 자료를 삭제할까요/);
  assert.equal(srv.state.log.filter(l => l.method === 'DELETE').length, 0, '취소하면 삭제 요청 없음');
  await page.click('#edit-delete');
  await dialogAnswer(page, true);
  for (let i = 0; i < 100 && !srv.state.log.some(l => l.method === 'DELETE'); i++) await sleep(30);
  assert.deepEqual(srv.state.log.filter(l => l.method === 'DELETE').map(l => l.url), ['/api/voice-notes/2'], '확인한 뒤에만 삭제 요청');
  await page.close();
});

test('지도 팝업·과목 선택의 보조 버튼과 JS 생성 버튼(이유 수정·방향 바꾸기·닫기·취소·연결 추가)이 텍스트 버튼이고 삭제는 확인창을 거침', { skip: SKIP }, async () => {
  const page = await open();
  await page.click('#vm-open-btn');
  await page.waitFor("document.getElementById('vm-subject').open");
  assertTextButton(await page.eval(MEASURE('#vm-subject-cancel')), '#vm-subject-cancel');
  await page.click('.vm-subject-btn[data-subject="과학"]');
  await page.waitFor("!!document.querySelector('[data-t=vm-svg]')", 6000);
  for (const id of ['vm-close', 'vm-zoom-in', 'vm-zoom-out', 'vm-zoom-fit']) assertTextButton(await page.eval(MEASURE('#' + id)), '#' + id);
  const build = await page.eval(MEASURE('#vm-build'));
  assert.notEqual(build.bg, TRANSPARENT, '[지도 그리기]는 주요 동작이라 채움 유지'); assert.ok(isPrimaryFill(build.bg), '[지도 그리기] 채움: ' + build.bg);
  await clickEdge(page, 11);
  for (const dt of ['vm-edit-reason', 'vm-swap', 'vm-card-close']) assertTextButton(await page.eval(MEASURE(`[data-t=${dt}]`)), dt);
  const del = await page.eval(MEASURE('[data-t=vm-delete]'));
  assertTextButton(del, 'vm-delete'); assert.match(del.cls, /danger/); assert.ok(isDangerText(del.color), '연결 삭제 글자색: ' + del.color);
  assert.equal(await page.count('#vm-sheet .btn.danger:not(.text)'), 0);
  await page.click('[data-t=vm-delete]');
  assert.match(await dialogAnswer(page, false), /지도에서 숨깁니다/);
  assert.equal(srv.state.log.filter(l => l.method === 'DELETE').length, 0, '확인창에서 취소하면 삭제 호출 없음');
  await page.click('[data-t=vm-edit-reason]');
  assertTextButton(await page.eval(MEASURE('[data-t=vm-reason-cancel]')), 'vm-reason-cancel');
  { const bg = (await page.eval(MEASURE('[data-t=vm-reason-save]'))).bg; assert.ok(isPrimaryFill(bg), '[저장]은 주요 동작 채움 유지(기본 또는 호버 색): ' + bg); }
  await page.click('[data-t=vm-reason-cancel]');
  await clickNode(page, 4);
  assertTextButton(await page.eval(MEASURE('[data-t=vm-add-link]')), 'vm-add-link');
  { const bg = (await page.eval(MEASURE('[data-t=vm-open-note]'))).bg; assert.ok(isPrimaryFill(bg), '[이 자료 열기]는 채움 유지: ' + bg); }
  await page.click('[data-t=vm-add-link]');
  assertTextButton(await page.eval(MEASURE('[data-t=vm-add-cancel]')), 'vm-add-cancel');
  { const bg = (await page.eval(MEASURE('[data-t=vm-add-submit]'))).bg; assert.ok(isPrimaryFill(bg), '[연결]은 채움 유지: ' + bg); }
  assert.equal(await page.hasHorizontalScroll(), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('유지 목록은 박스 그대로: 오답 노트·선택·다시 녹음·이어서 녹음·자료로 돌아가기, 주요 채움 버튼, 칩·select·카드 행', { skip: SKIP }, async () => {
  const page = await open();
  await openDetail(page, 2);
  const keepBoxed = [['wrong-btn', 'list'], ['sel-toggle', 'list'], ['rec-redo', 'record'], ['append-rec', 'edit'], ['quiz-back', 'quiz']];
  for (const [id, view] of keepBoxed) {
    await page.eval(`showView(${JSON.stringify(view)})`);
    const m = await page.eval(MEASURE('#' + id));
    assert.match(m.cls, /secondary/, id + ': secondary 유지');
    assert.doesNotMatch(m.cls, /\btext\b/, id + ': 변환되지 않음');
    assert.notEqual(m.bg, TRANSPARENT, id + ': 배경 유지'); assert.equal(m.bw[0], '1px', id + ': 테두리 유지(CSS 1.5px는 배율 1에서 1px로 내림)'); assert.equal(m.radius, '10px', id + ': 반경 유지');
  }
  const filled = [['new-rec-btn', 'list'], ['rec-convert', 'record'], ['sum-make', 'edit'], ['edit-save', 'edit'], ['merge-go', 'merge'], ['quiz-play', 'edit'], ['chat-send', 'chat']];
  for (const [id, view] of filled) {
    await page.eval(`showView(${JSON.stringify(view)})`);
    const m = await page.eval(MEASURE('#' + id));
    assert.equal(m.bg, PRIMARY_FILL, id + ': 주요 채움 버튼 유지(이 테스트는 마우스를 쓰지 않아 기본색)'); assert.equal(m.radius, '10px'); assert.equal(m.weight, '600');
  }
  // 칩·select·카드 행은 변환 대상이 아니다
  await page.eval("showView('edit')");
  const others = await page.eval(`(() => {
    const host = document.querySelector('#view-edit'); const out = {};
    const chip = document.createElement('button'); chip.className = 'kw-chip'; chip.textContent = '키워드'; host.appendChild(chip);
    const c = getComputedStyle(chip); out.chip = { radius: c.borderTopLeftRadius, bw: c.borderTopWidth };
    chip.remove();
    const sel = getComputedStyle(document.getElementById('tts-rate')); out.select = { bw: sel.borderTopWidth, radius: sel.borderTopLeftRadius };
    showView('list');
    const card = getComputedStyle(document.querySelector('.note-item')); out.card = { bw: card.borderTopWidth, radius: card.borderTopLeftRadius };
    return out;
  })()`);
  assert.deepEqual(others.chip, { radius: '999px', bw: '1px' });
  assert.equal(others.select.bw, '1px'); assert.equal(others.select.radius, '10px');
  assert.deepEqual(others.card, { bw: '1px', radius: '16px' });
  await page.close();
});

test('표시 뱃지(.link-badge): 배경 투명·테두리 0·알약 아님·cursor 기본, 글자 대비 4.5:1(흰 배경/페이지 배경 모두)', { skip: SKIP }, async () => {
  const page = await open({ stale: true });
  // 실제 요소: 목록의 "요약 갱신 필요", 지도 카드의 kind 배지
  const stale = await page.eval(MEASURE('.note-item .link-badge'));
  assert.ok(stale, '요약 갱신 필요 뱃지');
  await openMap(page);
  await clickEdge(page, 11);
  const kind = await page.eval(MEASURE('[data-t=vm-kind]'));
  assert.equal(await page.text('[data-t=vm-kind]'), '✔ 근거 확인', '기호와 글자는 그대로');
  await clickEdge(page, 12);
  assert.equal(await page.text('[data-t=vm-kind]'), '◇ 배경지식');
  const kind2 = await page.eval(MEASURE('[data-t=vm-kind]'));
  // 변형 3종을 흰 배경(--card)과 페이지 배경(--bg) 위에 각각 올려 대비를 잰다
  const variants = await page.eval(`(() => {
    const res = [];
    for (const cls of ['link-badge', 'link-badge bg', 'link-badge err']) for (const bgc of ['#FFFFFF', '#FAFAF9']) {
      const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;padding:6px;background:' + bgc; const b = document.createElement('span'); b.className = cls; b.textContent = '뱃지'; wrap.appendChild(b); document.body.appendChild(wrap);
      const cs = getComputedStyle(b);
      const num = c => (c.match(/[\\d.]+/g) || []).map(Number);
      const lum = ([R, G, B]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
      const l1 = lum(num(cs.color)), l2 = lum(num(getComputedStyle(wrap).backgroundColor));
      res.push({ cls, bgc, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), bg: cs.backgroundColor, bw: cs.borderTopWidth, radius: cs.borderTopLeftRadius, pad: cs.padding, cursor: cs.cursor, size: cs.fontSize });
      wrap.remove();
    }
    return res;
  })()`);
  for (const m of [stale, kind, kind2]) {
    assert.equal(m.bg, TRANSPARENT); assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px']); assert.equal(m.radius, '0px'); assert.equal(m.cursor, 'default'); assert.ok(m.ratio >= 4.5, '실제 뱃지 대비 ' + m.ratio);
  }
  assert.equal(variants.length, 6);
  for (const v of variants) {
    assert.equal(v.bg, TRANSPARENT, v.cls); assert.equal(v.bw, '0px'); assert.equal(v.radius, '0px', v.cls + ': 알약 아님'); assert.equal(v.pad, '0px'); assert.equal(v.cursor, 'default'); assert.equal(v.size, '12px');
    assert.ok(v.ratio >= 4.5, `${v.cls} on ${v.bgc}: ${v.ratio.toFixed(2)}`);
  }
  await page.close();
});

test('390px 레이아웃: 텍스트 버튼이 나란한 줄(지도 도구줄·카드 버튼줄·편집 화면)에서 터치 영역이 겹치지 않고 줄바꿈이 두 줄 이내, 가로 스크롤 없음', { skip: SKIP }, async () => {
  const page = await open();
  await openMap(page);
  await clickEdge(page, 11);
  const overlaps = js => page.eval(`(() => {
    const out = [];
    for (const c of document.querySelectorAll(${JSON.stringify(js)})) {
      if (c.getClientRects().length === 0) continue;
      const kids = [...c.querySelectorAll(':scope > .btn')].filter(b => b.getClientRects().length);
      const rows = new Set(kids.map(b => Math.round(b.getBoundingClientRect().top)));
      let overlap = 0;
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0.5 && h > 0.5) overlap++;
      }
      out.push({ sel: c.className || c.id, n: kids.length, rows: rows.size, overlap, overflow: c.scrollWidth > c.clientWidth + 1 });
    }
    return out;
  })()`);
  const sheetRows = await overlaps('.vm-tools, .vm-actions');
  assert.ok(sheetRows.length >= 2);
  for (const r of sheetRows) { assert.equal(r.overlap, 0, '겹침 ' + JSON.stringify(r)); assert.ok(r.rows <= 2, '두 줄 이내 ' + JSON.stringify(r)); assert.equal(r.overflow, false); }
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.click('#vm-close');
  await page.waitFor("!document.getElementById('vm-sheet').open");
  await openDetail(page, 2);
  await page.eval(`(() => { for (const id of ['tts-pause', 'tts-stop', 'undo-append', 'after-list']) { const e = document.getElementById(id); e.style.display = ''; for (let a = e.parentElement; a && a.id !== 'view-edit'; a = a.parentElement) if (getComputedStyle(a).display === 'none') a.style.display = 'block'; } })()`);
  const editRows = await overlaps('.btn-row, .tts-row, #append-row');
  for (const r of editRows) { assert.equal(r.overlap, 0, '겹침 ' + JSON.stringify(r)); assert.ok(r.rows <= 2, '두 줄 이내 ' + JSON.stringify(r)); assert.equal(r.overflow, false); }
  assert.equal(await page.hasHorizontalScroll(), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('키보드 포커스: Tab으로 텍스트 버튼에 닿으면 2px 윤곽선이 보이고, 마우스를 올려도 배경이 코랄 채움으로 바뀌지 않음', { skip: SKIP }, async () => {
  const page = await open();
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    hit = await page.eval(`(() => { const e = document.activeElement; if (!e || !e.matches('.btn.text')) return null; return { id: e.id }; })()`);
    if (hit) { await sleep(100); hit = await page.eval(`(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { id: e.id, style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset }; })()`); }   // 전환은 NO_MOTION으로 꺼져 있어 포커스 직후 값이 곧 최종 값
  }
  assert.ok(hit, 'Tab으로 텍스트 버튼에 닿음');
  assert.equal(hit.style, 'solid'); assert.equal(hit.width, '2px'); assert.equal(hit.color, 'rgb(26, 26, 26)'); assert.equal(hit.offset, '2px');
  // 호버
  const pos = await page.eval("(() => { const b = document.getElementById('vm-open-btn'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
  await sleep(100);
  const hov = await page.eval("(() => { const cs = getComputedStyle(document.getElementById('vm-open-btn')); return { bg: cs.backgroundColor, color: cs.color, hover: document.getElementById('vm-open-btn').matches(':hover') }; })()");
  assert.equal(hov.hover, true);
  assert.equal(hov.bg, TRANSPARENT, '호버해도 배경 투명');
  assert.equal(hov.color, 'rgb(26, 26, 26)', '호버하면 글자만 진해짐');
  await page.close();
});
