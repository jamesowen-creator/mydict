// 작업216-4: 개념 학습 보조 버튼은 박스 없는 텍스트 버튼(.btn.text). 주요 채움(.btn.primary), 마이크, 토글(aria-pressed), 반응 3종, 돌아보기 퀴즈 진입은 그대로.
// 이 파일의 원칙(작업216-3의 교훈): ① 테스트 쪽에서 transition·animation을 끄고 ② 클릭 전에 레이아웃이 안정될 때까지 기다린다.
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

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const PRIMARY_FILL = 'rgb(184, 68, 46)', PRIMARY_FILL_HOVER = 'rgb(156, 58, 39)';
const isPrimaryFill = bg => bg === PRIMARY_FILL || bg === PRIMARY_FILL_HOVER;
const NO_MOTION = `(() => { const s = document.createElement('style'); s.id = 'test-no-motion'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()`;

// 이 화면은 호버·눌림에 채움 규칙이 없지만, 기본 3개 이상으로 모든 상태(제안·링크·퀴즈)를 볼 수 있게 한다
const ITEMS = [{ term: '세포', set: { review_state: 'new' } }, { term: '광합성', set: { review_state: 'new' } }, { term: '엽록체', set: { review_state: 'new' } },
  { term: '미토콘드리아', set: { review_state: 'new' } }, { term: '핵', set: { review_state: 'new' } }];
async function openStudy({ items = ITEMS, links = [[0, 1], [1, 2]], width = 390 } = {}) {
  srv.reset();
  srv.seed({ topic: '생물 · 세포', items, links, path: [0, 1] });
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.eval(NO_MOTION);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  await settle(page);
  return page;
}
// 클릭 경합 방지(작업216-3): 글꼴·조회 응답이 끝나고, 주요 버튼들의 위치가 50ms 간격으로 연속 4번 같을 때까지 기다린다
async function settle(page) {
  await page.waitFor("document.fonts.status === 'loaded'", 5000);
  let last = '', same = 0;
  for (let i = 0; i < 100 && same < 4; i++) {
    const now = await page.eval("[...document.querySelectorAll('#app .btn, #app .iconbtn, #app [data-t=term]')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top) + ':' + Math.round(r.left); }).join('|') + '|' + document.documentElement.scrollHeight");
    same = now === last ? same + 1 : 0; last = now;
    await sleep(50);
  }
  assert.ok(same >= 4, '화면 레이아웃이 안정되지 않음');
}

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
  const out = { cls: e.className, w: r.width, h: r.height, bg: cs.backgroundColor, bw: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], radius: cs.borderTopLeftRadius,
    color: cs.color, bgEff, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), underline: cs.textDecorationLine.includes('underline'), cursor: cs.cursor, weight: cs.fontWeight };
  for (const [a, d] of shown) a.style.display = d;
  return out;
})()`;
function assertTextButton(m, label) {
  assert.ok(m, label + ': 요소 없음');
  assert.match(m.cls, /\btext\b/, label + ': .text 클래스');
  assert.equal(m.bg, TRANSPARENT, label + ': 배경 투명');
  assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px'], label + ': 테두리 없음');
  assert.ok(m.h >= 43.5 && m.w >= 43.5, `${label}: 터치 영역 44px 이상 (${m.w}x${m.h})`);
  assert.ok(m.ratio >= 4.5, `${label}: 글자 대비 4.5:1 이상 (${m.ratio.toFixed(2)})`);
  assert.equal(m.underline, true, label + ': 밑줄');
  assert.equal(m.cursor, 'pointer');
}
const clickEdge = (page, id) => page.eval(`document.querySelector('[data-t=edge][data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const termFromDef = d => d.replace('의 정의입니다.', '');

// ───────────────────────── 변환된 버튼 ─────────────────────────
test('개념 상세·제안·연결의 변환 버튼: 배경 투명·테두리 0·터치 44px·대비 4.5:1·밑줄 (edit-open, group-edit, link-open, link-swap, suggest-hold/exclude)', { skip: SKIP }, async () => {
  const page = await openStudy();
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#app .btn')).transitionDuration"), '0s', '테스트용 전환 비활성화가 적용됨');
  for (const dt of ['edit-open', 'group-edit', 'link-open']) assertTextButton(await page.eval(MEASURE(`[data-t=${dt}]`)), dt);
  // 제안의 다른 후보(접힌 details 안): 나중에·제외
  await page.click('[data-t="alts"] summary');
  await settle(page);
  for (const dt of ['suggest-hold', 'suggest-exclude']) assertTextButton(await page.eval(MEASURE(`[data-t=${dt}]`)), dt);
  // 연결 수정 폼의 방향 바꾸기
  await page.click('[data-t="link-edit"]');
  await page.waitFor("!!document.querySelector('[data-t=link-swap]')");
  assertTextButton(await page.eval(MEASURE('[data-t=link-swap]')), 'link-swap');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('제안이 비어 있을 때의 [제안 다시 받기](refresh-suggest)도 텍스트 버튼', { skip: SKIP }, async () => {
  const page = await openStudy({ items: [{ term: '세포', set: { suggestions: [] } }, { term: '광합성', set: { suggestions: [] } }, { term: '엽록체', set: { suggestions: [] } }] });
  await page.waitFor("!!document.querySelector('[data-t=refresh-suggest]')", 4000);
  assertTextButton(await page.eval(MEASURE('[data-t=refresh-suggest]')), 'refresh-suggest');
  await page.close();
});

test('돌아보기 퀴즈의 변환 버튼(quiz-exit, quiz-skip, quiz-confuse)과 [돌아보기 퀴즈] 진입(작업217-2부터)이 텍스트 버튼', { skip: SKIP }, async () => {
  const page = await openStudy();
  const open = await page.eval(MEASURE('#quiz-open'));
  assertTextButton(open, 'quiz-open');   // 작업217-2: 옛 기대(박스 유지)를 새 기준으로 바꿈
  await page.click('#quiz-open');
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  await settle(page);
  assertTextButton(await page.eval(MEASURE('[data-t=quiz-exit]')), 'quiz-exit');
  // [다음 문제로](quiz-skip)는 채점 요청이 실패한 상태에서만 나타난다: 그 상태를 그대로 렌더해서 확인
  await page.eval("S.quiz.error = '채점하지 못했습니다.'; renderQuiz();");
  await page.waitFor("!!document.querySelector('[data-t=quiz-skip]')");
  assertTextButton(await page.eval(MEASURE('[data-t=quiz-skip]')), 'quiz-skip');
  await page.eval("S.quiz.error = null; renderQuiz();");
  await page.waitFor("!document.querySelector('[data-t=quiz-skip]') && !!document.querySelector('[data-t=quiz-question]')");
  // 틀린 답을 고르면 [헷갈림으로 표시]가 나타난다(모의 서버의 문제 형식: 정답 보기를 찾아 다른 보기를 누름)
  const q = await page.eval(`(() => { const q = document.querySelector('[data-t=quiz-question]'); return { kind: q.dataset.kind, prompt: document.querySelector('[data-t=quiz-prompt]').textContent, options: [...document.querySelectorAll('[data-t=quiz-opt]')].map(b => b.lastElementChild.textContent.trim()) }; })()`);
  const right = q.options.indexOf(q.kind === 'A' ? termFromDef(q.prompt) : q.prompt + '의 정의입니다.');
  await page.click(`[data-t="quiz-opt"][data-i="${(right + 1) % 4}"]`);
  await page.waitFor("!!document.querySelector('[data-t=quiz-confuse]')", 4000);
  assertTextButton(await page.eval(MEASURE('[data-t=quiz-confuse]')), 'quiz-confuse');
  // 눈에 띄는 주요 동작(다음 문제)은 채움 유지
  const primary = await page.eval(MEASURE('#app .btn.primary:not([hidden])'));
  assert.ok(isPrimaryFill(primary.bg), '퀴즈의 주요 버튼 채움 유지: ' + primary.bg);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('지도 팝업: map-close·확대·축소·화면 맞춤과 연결 카드의 edge-close가 텍스트 버튼, [전체 연결 보기]는 토글 유지', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="map-open"]');
  await page.waitFor("document.getElementById('map-sheet').open && !!document.querySelector('[data-t=map-svg]')", 6000);
  await settle(page);
  assertTextButton(await page.eval(MEASURE('#map-close')), 'map-close');
  for (const dt of ['zoom-in', 'zoom-out', 'zoom-fit']) assertTextButton(await page.eval(MEASURE(`[data-t=${dt}]`)), dt);
  const full = await page.eval(MEASURE('[data-t=map-full]'));
  assert.doesNotMatch(full.cls, /\btext\b/, '전체 연결 보기는 aria-pressed 토글이라 변환하지 않음');
  assert.equal(await page.eval("document.querySelector('[data-t=map-full]').hasAttribute('aria-pressed')"), true);
  await clickEdge(page, srv.state.links[0].id);
  await page.waitFor("document.getElementById('edge-dialog').open");
  assertTextButton(await page.eval(MEASURE('#edge-close')), 'edge-close');
  await page.click('#edge-close');
  await page.waitFor("!document.getElementById('edge-dialog').open");
  // 확대·축소·맞춤 동작은 그대로
  const vb = () => page.eval("document.querySelector('[data-t=map-svg]').getAttribute('viewBox').split(' ').map(Number)");
  const v0 = await vb();
  await page.click('[data-t="zoom-in"]');
  assert.ok((await vb())[2] < v0[2], '확대하면 보이는 영역이 줄어듦');
  await page.click('[data-t="zoom-fit"]');
  assert.ok((await vb()).every((n, i) => Math.abs(n - v0[i]) < 0.01), '화면 맞춤으로 복귀');
  await page.eval('history.back()');
  await page.waitFor("!document.getElementById('map-sheet').open");
  assert.deepEqual(page.errors, []);
  await page.close();
});

// ───────────────────────── 이미 있던 텍스트·위험 버튼 ─────────────────────────
test('원래부터 .btn.text였던 버튼(시작 취소·수정류·연결 삭제·개념 삭제)도 같은 기준: 가로·세로 44px, 대비 4.5:1', { skip: SKIP }, async () => {
  const page = await openStudy();
  const found = await page.eval("[...document.querySelectorAll('#app .btn.text')].map(b => b.getAttribute('data-t') || b.id)");
  assert.ok(found.length >= 3, '상세 화면의 기존 텍스트 버튼: ' + found.join(','));
  for (const dt of ['link-edit', 'link-delete', 'delete-item']) {
    const m = await page.eval(MEASURE(`[data-t=${dt}]`));
    assertTextButton(m, dt);
  }
  for (const dt of ['link-delete', 'delete-item']) {
    const m = await page.eval(MEASURE(`[data-t=${dt}]`));
    assert.match(m.cls, /danger/); assert.equal(m.color, 'rgb(220, 38, 38)', dt + ': 위험 글자색 --danger'); assert.ok(m.ratio >= 4.5, dt + ' 대비 ' + m.ratio);
  }
  await page.close();
});

test('시작 폼의 [취소](#start-cancel, 원래 텍스트 버튼)도 같은 기준', { skip: SKIP }, async () => {
  srv.reset();
  srv.seed({ topic: '생물 · 세포', items: ITEMS.slice(0, 2), links: [[0, 1]], path: [0, 1] });
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.eval(NO_MOTION);
  await page.click('#start-open');
  await page.waitFor("!document.getElementById('start-form').hidden", 4000);
  await settle(page);
  assertTextButton(await page.eval(MEASURE('#start-cancel')), '#start-cancel');
  await page.close();
});

test('위험 텍스트 버튼은 모두 확인창을 거친 뒤에만 실행(개념 삭제·연결 삭제·수정 폼의 삭제), 박스형 위험 버튼은 없음', { skip: SKIP }, async () => {
  const page = await openStudy();
  assert.equal(await page.count('.btn.danger:not(.text)'), 0);
  const deletes = () => srv.state.log.filter(l => l.method === 'DELETE').map(l => l.url);
  // 연결 삭제(목록)
  await page.click('[data-t="link-delete"]');
  assert.match(await dialogAnswer(page, false), /이 연결을 삭제할까요/);
  assert.equal(deletes().length, 0, '취소하면 호출 없음');
  // 연결 수정 폼 안의 삭제
  await page.click('[data-t="link-edit"]');
  await page.waitFor("!!document.querySelector('[data-t=link-edit-delete]')");
  await page.click('[data-t="link-edit-delete"]');
  assert.match(await dialogAnswer(page, false), /이 연결을 삭제할까요/);
  assert.equal(deletes().length, 0);
  await page.click('[data-t="link-edit-cancel"]');
  // 개념 삭제
  await page.click('[data-t="delete-item"]');
  assert.match(await dialogAnswer(page, false), /개념을 삭제할까요/);
  assert.equal(deletes().length, 0);
  await page.click('[data-t="delete-item"]');
  await dialogAnswer(page, true);
  for (let i = 0; i < 100 && !deletes().length; i++) await sleep(30);
  assert.ok(deletes().some(u => /\/api\/concepts\/items\/\d+$/.test(u)), '확인한 뒤에만 삭제 요청: ' + deletes().join(','));
  await page.close();
});

// ───────────────────────── 유지 목록 ─────────────────────────
test('유지: 주요 채움(.btn.primary), 토글(이해함·목록 전환·전체 연결 보기), 세그먼트, 아이콘 버튼은 변환되지 않음(마이크·반응 3종·돌아보기 퀴즈는 작업217-2에서 박스 제거)', { skip: SKIP }, async () => {
  const page = await openStudy();
  for (const sel of ['#ask-submit']) {
    const m = await page.eval(MEASURE(sel));
    assert.ok(isPrimaryFill(m.bg), sel + ' 채움: ' + m.bg); assert.equal(m.radius, '10px'); assert.equal(m.weight, '600'); assert.match(m.cls, /primary/);
  }
  // 작업217-2: 옛 기대(마이크·반응 3종 박스 유지)를 새 기준으로 바꿈 — 반응 3종은 텍스트 버튼, 마이크는 박스 없는 아이콘 버튼
  for (const dt of ['react-easier', 'react-deeper', 'react-other']) assertTextButton(await page.eval(MEASURE(`[data-t=${dt}]`)), dt);
  { const m = await page.eval(MEASURE('#ask-mic')); assert.match(m.cls, /mic/); assert.equal(m.bg, TRANSPARENT); assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px']); }
  const toggle = await page.eval(MEASURE('[data-t=understood]'));
  assert.match(toggle.cls, /toggle/); assert.equal(toggle.bw[0], '0px', '작업217-3: 이해함 토글은 박스(테두리) 없음 — 옛 기대(1px 유지)를 새 기준으로 바꿈'); assert.equal(toggle.bg, TRANSPARENT);
  for (const id of ['seg-map', 'seg-list']) {
    const m = await page.eval(MEASURE('#' + id));
    assert.equal(m.bg, TRANSPARENT); assert.doesNotMatch(m.cls, /\btext\b/, id + ': 탭/세그먼트는 기존 방식(밑줄 선)');
  }
  assert.equal(await page.eval("document.querySelectorAll('.iconbtn').length > 0 && [...document.querySelectorAll('.iconbtn')].every(b => !b.classList.contains('text'))"), true);
  await page.click('#seg-list');
  await settle(page);
  for (const dt of ['list-mode-flat', 'list-mode-group']) {
    const m = await page.eval(MEASURE(`[data-t=${dt}]`));
    assert.doesNotMatch(m.cls, /\btext\b/, dt + ': aria-pressed 토글은 변환하지 않음');
    assert.equal(await page.eval(`document.querySelector('[data-t=${dt}]').hasAttribute('aria-pressed')`), true);
  }
  await page.close();
});

test('표시 전용 요소: .source("AI 설명 · 확인 필요")는 박스·테두리·알약 없는 텍스트, 이 화면에는 박스·알약 모양의 표시 뱃지가 따로 없음', { skip: SKIP }, async () => {
  const page = await openStudy();
  const src = await page.eval(MEASURE('[data-t=source]'));
  assert.equal(src.bg, TRANSPARENT); assert.deepEqual(src.bw, ['0px', '0px', '0px', '0px']); assert.equal(src.radius, '0px'); assert.equal(src.cursor, 'auto');
  // 눌리지 않는 요소(cursor pointer가 아닌) 중 배경이 있거나 알약(radius ≥ 20px)인 것이 안내 상자(.msg)·진행 막대·카드 말고 없는지
  const boxed = await page.eval(`[...document.querySelectorAll('#app span, #app b, #app em, #app .label, #app .counter')].filter(e => { const cs = getComputedStyle(e); return e.getClientRects().length && getComputedStyle(e).cursor !== 'pointer' && (parseFloat(cs.borderTopLeftRadius) >= 20 || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && !e.closest('.bar, .spinner, .msg'))); }).map(e => e.className || e.tagName)`);
  assert.deepEqual(boxed, [], '박스·알약으로 그려진 표시 전용 요소');
  await page.close();
});

// ───────────────────────── 레이아웃·키보드·호버 ─────────────────────────
const OVERLAPS = `(() => {
  const out = [], seen = new Set();
  for (const b of document.querySelectorAll('.btn, .iconbtn')) {
    const c = b.parentElement;
    if (!c || seen.has(c) || c.getClientRects().length === 0) continue;
    seen.add(c);
    const kids = [...c.children].filter(k => k.matches('.btn, .iconbtn') && k.getClientRects().length);
    if (kids.length < 2) continue;
    const rows = new Set(kids.map(k => Math.round(k.getBoundingClientRect().top)));
    let overlap = 0;
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), d = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, d.right) - Math.max(a.left, d.left), h = Math.min(a.bottom, d.bottom) - Math.max(a.top, d.top);
      if (w > 0.5 && h > 0.5) overlap++;
    }
    out.push({ sel: (c.id ? '#' + c.id : '') + '.' + c.className, n: kids.length, rows: rows.size, overlap, overflow: c.scrollWidth > c.clientWidth + 1 });
  }
  return out;
})()`;
test('390px 레이아웃: 텍스트 버튼이 나란한 줄(상세·제안·연결·퀴즈·지도 도구줄·연결 카드)에서 영역이 겹치지 않고 두 줄 이내, 가로 넘침 없음', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="alts"] summary');
  await page.click('[data-t="link-edit"]');
  await page.waitFor("!!document.querySelector('[data-t=link-swap]')");
  await settle(page);
  const check = async label => {
    const rows = await page.eval(OVERLAPS);
    assert.ok(rows.length >= 1, label + ': 나란한 버튼 줄을 찾지 못함');
    for (const r of rows) {
      assert.equal(r.overlap, 0, `${label} 겹침 ${JSON.stringify(r)}`);
      // .qz-opts는 보기 4개를 세로로 쌓는 선택지 목록이라 줄 수 규칙에서 제외(겹침·넘침은 그대로 검사)
      if (!/qz-opts/.test(r.sel)) assert.ok(r.rows <= 2, `${label} 두 줄 이내 ${JSON.stringify(r)}`);
      assert.equal(r.overflow, false, `${label} 넘침 ${JSON.stringify(r)}`);
    }
    assert.equal(await page.hasHorizontalScroll(), false, label + ': 가로 스크롤');
    return rows.length;
  };
  const nDetail = await check('상세');
  assert.ok(nDetail >= 3);
  await page.click('[data-t="map-open"]');
  await page.waitFor("document.getElementById('map-sheet').open && !!document.querySelector('[data-t=map-svg]')", 6000);
  await settle(page);
  await check('지도 도구줄');
  await clickEdge(page, srv.state.links[0].id);
  await page.waitFor("document.getElementById('edge-dialog').open");
  await check('연결 카드');
  await page.click('#edge-close');
  await page.eval('history.back()');
  await page.waitFor("!document.getElementById('map-sheet').open");
  await page.click('#quiz-open');
  await page.waitFor("!!document.querySelector('[data-t=quiz-question]')");
  await settle(page);
  await check('퀴즈');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('키보드 포커스·호버: Tab으로 텍스트 버튼에 닿으면 2px 윤곽선(전역 :focus-visible), 마우스를 올려도 바탕이 채워지지 않고 글자만 진해짐', { skip: SKIP }, async () => {
  const page = await openStudy();
  let hit = null;
  for (let i = 0; i < 60 && !hit; i++) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    hit = await page.eval(`(() => { const e = document.activeElement; if (!e || !e.matches('.btn.text')) return null; const cs = getComputedStyle(e); return { id: e.getAttribute('data-t') || e.id, style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset }; })()`);
  }
  assert.ok(hit, 'Tab으로 텍스트 버튼에 닿음');
  assert.equal(hit.style, 'solid'); assert.equal(hit.width, '2px'); assert.equal(hit.color, 'rgb(26, 31, 60)'); assert.equal(hit.offset, '2px');
  const pos = await page.eval("(() => { const b = document.querySelector('[data-t=edit-open]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await settle(page);
  const pos2 = await page.eval("(() => { const r = document.querySelector('[data-t=edit-open]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos2.x, y: pos2.y });
  await sleep(100);
  const hov = await page.eval("(() => { const b = document.querySelector('[data-t=edit-open]'); const cs = getComputedStyle(b); return { hover: b.matches(':hover'), bg: cs.backgroundColor, color: cs.color }; })()");
  assert.equal(hov.hover, true);
  assert.equal(hov.bg, TRANSPARENT, '호버해도 바탕 투명');
  assert.equal(hov.color, 'rgb(26, 31, 60)', '호버하면 글자만 --text로 진해짐');
  void pos;
  await page.close();
});

// ───────────────────────── 작업217-2: 기본 .btn → .text, 마이크 상태 전환 ─────────────────────────
test('217-2 (a)(b)(c) 반응 3종·돌아보기 퀴즈는 박스 없는 텍스트 버튼(44px, 대비 4.5:1), 주요 채움 버튼과 aria-pressed 토글(목록 전환·전체 연결 보기)은 그대로', { skip: SKIP }, async () => {
  const page = await openStudy();
  for (const sel of ['#quiz-open', '[data-t=react-easier]', '[data-t=react-deeper]', '[data-t=react-other]']) assertTextButton(await page.eval(MEASURE(sel)), sel);
  assert.ok(isPrimaryFill((await page.eval(MEASURE('#ask-submit'))).bg), '주요 채움 유지');
  await page.click('#seg-list');
  await settle(page);
  for (const dt of ['list-mode-flat', 'list-mode-group']) assert.equal(await page.eval(`document.querySelector('[data-t=${dt}]').hasAttribute('aria-pressed')`), true, dt + ': aria-pressed 유지');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('217-2 (a)(b)(c)(e) .btn.mic: 꺼짐·켜짐 모두 배경·테두리 없는 44×44px 아이콘, 켜짐(aria-pressed=true)=--danger 굵게+밑줄 선, 대비 4.5:1, 상태 전환과 aria 속성 유지', { skip: SKIP }, async () => {
  const page = await openStudy();
  for (const id of ['ask-mic', 'start-first-mic']) {
    const off = await page.eval(MEASURE('#' + id));
    assert.equal(off.bg, TRANSPARENT, id + ': 배경 투명'); assert.deepEqual(off.bw, ['0px', '0px', '0px', '0px'], id + ': 테두리 없음');
    if (id === 'ask-mic') assert.ok(off.h >= 43.5 && off.w >= 43.5, `${id}: 44×44px 이상 (${off.w}x${off.h})`);   // start-first-mic은 시작 폼이 닫혀 있어 크기를 잴 수 없다(같은 .btn.mic CSS)
    assert.ok(off.ratio >= 4.5, id + ': 대비 ' + off.ratio.toFixed(2));
    assert.equal(await page.eval(`document.getElementById('${id}').getAttribute('aria-pressed')`), 'false');
    assert.equal(off.underline, false); assert.equal(await page.eval(`getComputedStyle(document.getElementById('${id}'), '::after').content`), 'none');
  }
  // 켜짐: 앱의 micPaint가 aria-pressed·아이콘·aria-label을 바꾼다(실제 녹음 흐름은 concept_voice.ui가 확인)
  await page.eval("micPaint(MIC_TARGETS[1], true)");
  const on = await page.eval(MEASURE('#ask-mic'));
  assert.equal(await page.eval("document.getElementById('ask-mic').getAttribute('aria-pressed')"), 'true', 'aria-pressed 유지');
  assert.equal(await page.eval("document.getElementById('ask-mic').getAttribute('aria-label')"), '녹음 끝내기');
  assert.equal(on.bg, TRANSPARENT); assert.deepEqual(on.bw, ['0px', '0px', '0px', '0px']);
  assert.ok(on.h >= 43.5 && on.w >= 43.5); assert.ok(on.ratio >= 4.5, '켜짐 대비 ' + on.ratio.toFixed(2));
  assert.equal(on.color, 'rgb(220, 38, 38)', '--danger'); assert.equal(on.weight, '800'); assert.equal(on.underline, true);
  const bar = await page.eval(`(() => { const c = getComputedStyle(document.getElementById('ask-mic'), '::after'); return { content: c.content, h: c.height, bg: c.backgroundColor, bw: c.borderTopWidth }; })()`);
  assert.deepEqual(bar, { content: '""', h: '2px', bg: 'rgb(220, 38, 38)', bw: '0px' }, '아이콘 아래 2px 밑줄 선(테두리 아님)');
  // 다른 마이크는 영향 없음, 다시 꺼지면 원래대로
  assert.equal(await page.eval("document.getElementById('start-first-mic').getAttribute('aria-pressed')"), 'false');
  await page.eval("micPaint(MIC_TARGETS[1], false)");
  const back = await page.eval(MEASURE('#ask-mic'));
  assert.equal(back.underline, false); assert.notEqual(back.color, 'rgb(220, 38, 38)');
  assert.equal(await page.eval("document.getElementById('ask-mic').getAttribute('aria-pressed')"), 'false');
  assert.deepEqual(page.errors, []);
  await page.close();
});
