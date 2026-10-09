// 작업216-6: 읽기 3화면(literature_compass, science_reading, digest_reading)의 "표시만 하는 뱃지"는 박스·알약·채움 없는 작은 글자,
// 눌리는 링크(.app-link)는 밑줄 텍스트 링크(터치 44px). 칩·카드·토글·탭·선택지는 그대로.
// 처음부터 ① transition·animation을 끄고 ② 클릭 전에 레이아웃이 안정될 때까지 기다린다(작업216-3의 교훈).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const NO_MOTION = `(() => { const s = document.createElement('style'); s.id = 'test-no-motion'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()`;
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'";
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });

async function open(file, width = 390) {
  srv.reset();
  srv.state.me = me();
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/' + file + '.html');
  await page.waitFor(DB_READY, 10000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}
// 클릭 경합 방지: 글꼴 로드 + 보이는 주요 요소들의 위치가 50ms 간격으로 연속 4번 같을 때까지 기다린다
async function settle(page) {
  await page.waitFor("document.fonts.status === 'loaded'", 5000);
  let last = '', same = 0;
  for (let i = 0; i < 100 && same < 4; i++) {
    const now = await page.eval("[...document.querySelectorAll('.view.active .screen-bar, .view.active .app-link, .view.active button, .view.active .badge, .view.active .subject-chip')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top) + ':' + Math.round(r.left); }).join('|') + '|' + document.documentElement.scrollHeight");
    same = now === last ? same + 1 : 0; last = now;
    await sleep(50);
  }
  assert.ok(same >= 4, '화면 레이아웃이 안정되지 않음');
}
const step = async (page, js) => { await page.eval(js); await sleep(150); await settle(page); };

// 계산된 스타일·대비(글자색 대 실제로 깔린 바탕색)
const MEASURE = sel => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  const num = c => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([R, G, B]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
  let bgEff = 'rgb(255, 255, 255)';
  for (let a = e; a; a = a.parentElement) { const b = getComputedStyle(a).backgroundColor; const n = num(b); if (n.length < 4 || n[3] > 0.99) { if (n.length >= 3) { bgEff = b; break; } } }
  const l1 = lum(num(cs.color)), l2 = lum(num(bgEff));
  return { cls: e.className, text: e.textContent.trim(), w: r.width, h: r.height, bg: cs.backgroundColor, bw: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
    radius: cs.borderTopLeftRadius, pad: cs.padding, color: cs.color, bgEff, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), cursor: cs.cursor,
    size: parseFloat(cs.fontSize), underline: cs.textDecorationLine.includes('underline'), weight: cs.fontWeight, parentCursor: e.parentElement ? getComputedStyle(e.parentElement).cursor : null };
})()`;
function assertPlainText(m, label, { maxSize = 12 } = {}) {
  assert.ok(m, label + ': 요소 없음');
  assert.equal(m.bg, TRANSPARENT, label + ': 배경 투명');
  assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px'], label + ': 테두리 없음');
  assert.equal(m.radius, '0px', label + ': 알약·둥근 모서리 없음');
  assert.equal(m.pad, '0px', label + ': 박스용 padding 없음');
  assert.ok(m.size <= maxSize, `${label}: 글자 ${maxSize}px 이하 (${m.size})`);
  assert.ok(m.ratio >= 4.5, `${label}: 글자 대비 4.5:1 이상 (${m.ratio.toFixed(2)}, ${m.color} on ${m.bgEff})`);
}
const pseudo = (page, sel, which) => page.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}), '${which}').content`);

// 요소가 없으면 어떤 선택자인지 바로 알 수 있게 하는 측정 도우미
const must = async (page, sel) => { const m = await page.eval(MEASURE(sel)); assert.ok(m, '요소 없음: ' + sel); return m; };

// 사조 하나를 골라 설명 화면(작가 칩)과 카드 화면(뱃지·키워드)을 연다
const PICK_MOVEMENT = `(() => { const ms = DB.eras.flatMap(e => e.movements); const m = ms.find(x => x.briefing && x.briefing.representative_authors && x.briefing.representative_authors.length >= 2 && x.works && x.works.some(w => w.keywords && w.keywords.length >= 2)) || ms[0]; return m.id; })()`;

// ───────────────────────── literature_compass ─────────────────────────
test('literature .app-link: 눌리는 링크라 박스·알약 없이 밑줄 텍스트, 터치 44px, 대비 4.5:1, 이동 동작 그대로', { skip: SKIP }, async () => {
  const page = await open('literature_compass');
  const m = await page.eval(MEASURE('.app-link'));
  assert.ok(m, '.app-link 없음');
  assert.equal(m.bg, TRANSPARENT); assert.deepEqual(m.bw, ['0px', '0px', '0px', '0px']); assert.equal(m.radius, '0px');
  assert.ok(m.w >= 43.5 && m.h >= 43.5, `터치 영역 ${m.w}x${m.h}`);
  assert.ok(m.ratio >= 4.5, '대비 ' + m.ratio.toFixed(2)); assert.equal(m.underline, true); assert.equal(m.cursor, 'pointer');
  assert.equal(m.color, 'rgb(184, 68, 46)', '글자색은 기존 토큰 --primary-dark');
  assert.equal(await page.eval("document.querySelector('.app-link').tagName"), 'A');
  assert.equal(await page.eval("document.querySelector('.app-link').getAttribute('href')"), 'digest_reading.html');
  assert.equal(await page.count('.app-link svg'), 1, '아이콘 유지');
  // 키보드 포커스
  let outline = null;
  for (let i = 0; i < 60 && !outline; i++) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    outline = await page.eval("(() => { const e = document.activeElement; if (!e || !e.matches('.app-link')) return null; const cs = getComputedStyle(e); return [cs.outlineStyle, cs.outlineWidth, cs.outlineOffset]; })()");
  }
  assert.deepEqual(outline, ['solid', '2px', '2px'], 'Tab으로 닿으면 2px 윤곽선');
  // 실제 클릭하면 한입 독서로 이동
  await page.click('.app-link');
  await page.waitFor("location.pathname.endsWith('/digest_reading.html')", 8000);
  await done(page);
});

test('literature 표시 전용 뱃지: 사조·학교급(.badge)은 박스·알약 없이 글자색으로만 구분하고 "·"로 나뉘며, 카드 안이라 cursor는 카드에서 이어받음', { skip: SKIP }, async () => {
  const page = await open('literature_compass');
  await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK_MOVEMENT))}); showCards();`);
  const mv = await page.eval(MEASURE('.badge-movement')), lv = await page.eval(MEASURE('.badge-level'));
  assertPlainText(mv, '.badge-movement'); assertPlainText(lv, '.badge-level');
  assert.equal(mv.color, 'rgb(184, 68, 46)', '사조: --primary-dark');
  assert.equal(mv.size, 11, '글자 크기는 기존 11px 그대로');
  assert.ok(['rgb(146, 64, 14)', 'rgb(131, 24, 67)'].includes(lv.color), '학교급: 기존 글자색(#92400E 또는 고등 #831843): ' + lv.color);
  assert.equal(mv.cursor, mv.parentCursor, '뱃지 자체는 눌리지 않고 카드(onclick=flipCard)의 cursor를 이어받음');
  assert.equal(await page.eval("document.getElementById('flip-card').getAttribute('onclick')"), 'flipCard()', '눌리는 것은 카드 전체');
  assert.equal(await pseudo(page, '.card-badges .badge-movement', '::after'), '"·"', '첫 뱃지 뒤 구분점');
  assert.equal(await pseudo(page, '.card-badges .badge-level', '::after'), 'none', '마지막 뱃지 뒤에는 없음');
  // 고등 변형(핑크 계열) 글자색도 대비 통과
  const high = await page.eval(`(() => { const b = document.querySelector('.card-badges'); const s = document.createElement('span'); s.className = 'badge badge-level 고등'; s.textContent = '고등'; s.id = 'probe-high'; b.appendChild(s); return true; })()`);
  assert.ok(high);
  const hi = await page.eval(MEASURE('#probe-high'));
  assertPlainText(hi, '.badge-level.고등'); assert.equal(hi.color, 'rgb(131, 24, 67)');
  await done(page);
});

test('literature 키워드(.card-keyword): 박스 없는 작은 보조색 글자, "·"로 구분, 줄바꿈되어도 가로 넘침 없음', { skip: SKIP }, async () => {
  const page = await open('literature_compass');
  await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK_MOVEMENT))}); showCards();`);
  assert.ok((await page.count('.card-keyword')) >= 2);
  const k = await page.eval(MEASURE('.card-keyword'));
  assertPlainText(k, '.card-keyword');
  assert.equal(k.color, 'rgb(107, 114, 128)', '--text2');
  assert.equal(await pseudo(page, '.card-keyword:first-child', '::after'), '"·"');
  assert.equal(await pseudo(page, '.card-keyword:last-child', '::after'), 'none');
  // 키워드를 많이 넣어 줄바꿈을 강제해도 넘치지 않음
  await page.eval(`(() => { const box = document.querySelector('.card-keywords'); for (let i = 0; i < 12; i++) { const s = document.createElement('span'); s.className = 'card-keyword'; s.textContent = '아주 긴 키워드 ' + i; box.appendChild(s); } })()`);
  assert.equal(await page.eval("(() => { const f = document.getElementById('card-front'); return f.scrollWidth <= f.clientWidth + 1; })()"), true, '카드 앞면 가로 넘침 없음');
  await done(page);
});

test('literature 대표 작가(.author-chip): 박스·배경·모서리 없이 작은 보조색 글자, 앞의 점으로 구분, 줄바꿈 정상', { skip: SKIP }, async () => {
  const page = await open('literature_compass');
  await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK_MOVEMENT))});`);
  assert.ok((await page.count('.author-chip')) >= 2, '대표 작가가 2명 이상인 사조를 골랐음');
  const a = await page.eval(MEASURE('.author-chip'));
  assertPlainText(a, '.author-chip');
  assert.equal(a.color, 'rgb(107, 114, 128)', '--text2'); assert.equal(a.weight, '600');
  assert.equal(await pseudo(page, '.author-chip', '::before'), '""', '앞의 작은 점(구분 표시) 유지');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.author-chip'), '::before').width"), '6px');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.author-chips')).columnGap"), '16px', '이름 사이 간격');
  // 이름을 많이 넣어도 줄바꿈되고 넘치지 않음
  await page.eval(`(() => { const box = document.querySelector('.author-chips'); for (let i = 0; i < 10; i++) { const s = document.createElement('span'); s.className = 'author-chip'; s.textContent = '길이가 있는 작가 이름 ' + i; box.appendChild(s); } })()`);
  assert.equal(await page.hasHorizontalScroll(), false);
  assert.ok(await page.eval("document.querySelector('.author-chips').getBoundingClientRect().height > 40"), '여러 줄로 줄바꿈됨');
  await done(page);
});

// ───────────────────────── science_reading ─────────────────────────
test('science .subject-chip: 알약·채움 없이 분야 색(--field-ink)의 글자, 분야 4종 모두 대비 4.5:1 이상, 눌리지 않음', { skip: SKIP }, async () => {
  const page = await open('science_reading');
  const inks = { '물리': 'rgb(163, 62, 56)', '화학': 'rgb(44, 115, 115)', '생물': 'rgb(53, 112, 72)', '지구과학': 'rgb(66, 84, 160)' };
  for (const field of await page.eval('FIELD_ORDER')) {
    await step(page, `openField(${JSON.stringify(field)})`);
    const m = await page.eval(MEASURE('#subject-chip'));
    assertPlainText(m, `#subject-chip(${field})`);
    assert.equal(m.text, field); assert.equal(m.color, inks[field], field + ': 분야 글자색');
    assert.equal(m.cursor, 'auto', '눌리지 않는 요소라 cursor 기본');
    assert.equal(m.size, 12);
  }
  assert.equal(await page.eval("document.getElementById('subject-chip').closest('button, a, [onclick]')"), null, '눌리는 요소 안에 있지 않음');
  // 알 수 없는 분야는 기본 글자색(#5E6470)
  await page.eval("(() => { const c = document.getElementById('subject-chip'); c.style.setProperty('--field-ink', fieldColor('없는분야').ink); c.textContent = '기타'; })()");
  const fb = await page.eval(MEASURE('#subject-chip'));
  assert.equal(fb.color, 'rgb(94, 100, 112)'); assert.ok(fb.ratio >= 4.5, '기본색 대비 ' + fb.ratio.toFixed(2));
  await done(page);
});

// ───────────────────────── digest_reading ─────────────────────────
// 눌리지 않는데(cursor가 pointer가 아닌) 알약(radius ≥ 20px)이거나 작은 글자 요소가 바탕/테두리를 가진 것을 찾는다
const SCAN_DISPLAY_BOXES = `(() => {
  const out = [];
  for (const e of document.querySelectorAll('.view.active span, .view.active b, .view.active em, .view.active i, .view.active small, .view.active label, .view.active p, .view.active h1, .view.active h2, .view.active h3')) {
    if (!e.getClientRects().length) continue;
    if (e.closest('button, a, [onclick], .mcq-option, .spinner, .msg, .mcq-num, .flip-card')) continue;
    const cs = getComputedStyle(e);
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)', border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    if (parseFloat(cs.borderTopLeftRadius) >= 20 || bg || border) out.push((e.className || e.tagName) + ':' + e.textContent.trim().slice(0, 10));
  }
  return out;
})()`;
test('digest_reading: 표시 전용 뱃지가 없음(변경 없음) — 목록·작품 상세에서 박스·알약·테두리를 가진 눌리지 않는 글자 요소 0개, 정복 토글은 그대로', { skip: SKIP }, async () => {
  const page = await open('digest_reading');
  assert.deepEqual(await page.eval(SCAN_DISPLAY_BOXES), [], '목록');
  await step(page, 'showDigest(DB.works ? DB.works[0].id : DB[0].id)');
  assert.deepEqual(await page.eval(SCAN_DISPLAY_BOXES), [], '작품 상세');
  const c = await page.eval(MEASURE('.conquest-btn'));
  // 작업217-3: 정복 버튼은 박스 없는 글자로 바뀜(옛 기대: radius 10px·weight 600·테두리 2px)
  assert.equal(c.bg, TRANSPARENT); assert.equal(c.bw[0], '0px'); assert.equal(c.radius, '0px'); assert.ok(c.h >= 43.5);
  await done(page);
});

// ───────────────────────── 유지 목록 ─────────────────────────
test('유지(변환 금지): literature의 사조 칩·타임라인 칩·탭, science의 과목 카드·정복 토글, digest의 정복 토글(카드 이동 화살표는 작업217-2에서 박스 제거)', { skip: SKIP }, async () => {
  let page = await open('literature_compass');
  const bar = await must(page, '.tl-bar');
  assert.equal(bar.radius, '8px'); assert.notEqual(bar.bg, TRANSPARENT); assert.equal(bar.cursor, 'pointer');
  for (const sel of ['.genre-tab', '.bottom-nav-tab']) await must(page, sel);
  // .movement-pill을 만드는 renderPills는 현재 홈 화면에서 호출되지 않는다(타임라인 renderTimeline만 씀). CSS가 그대로인지 직접 렌더해서 확인.
  // 같은 컨테이너(#pills-<시대>)를 쓰므로 타임라인 막대 측정을 마친 뒤에 렌더한다
  await page.eval("(() => { const era = DB.eras[0]; if (!document.getElementById('pills-' + era.id)) throw new Error('pills 컨테이너 없음'); renderPills(era, '전체'); })()");
  const pill = await must(page, '.movement-pill');
  assert.equal(pill.radius, '20px', '사조 칩(눌러서 고르는 칩)은 알약 그대로'); assert.notEqual(pill.bg, TRANSPARENT); assert.equal(pill.cursor, 'pointer');
  await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK_MOVEMENT))}); showCards();`);
  const nav = await must(page, '#next-btn');   // 첫 카드에서 #prev-btn은 비활성(cursor not-allowed)이라 다음 버튼으로 확인   // 작업217-2: 옛 기대(원형 박스 50%·배경 있음)를 버림 — 이제 박스 없는 화살표 글자(상세는 reading_text_buttons.ui.test.js)
  assert.equal(nav.cursor, 'pointer');
  await page.close();

  page = await open('science_reading');
  const card = await must(page, '.subject-card');
  // 작업217-4: 과목 카드는 박스·틴트 없는 텍스트 행이 됨(옛 기대: radius 16px·테두리·색 배경). 눌림(cursor pointer)만 그대로
  assert.equal(card.radius, '0px'); assert.equal(card.bg, TRANSPARENT); assert.equal(card.cursor, 'pointer');
  await step(page, 'showScience(DB.concepts[0].id)');
  const cq = await must(page, '.conquest-btn');
  assert.equal(cq.bg, TRANSPARENT); assert.equal(cq.bw[0], '0px'); assert.equal(cq.radius, '0px');   // 작업217-3: 옛 기대(radius 10px·weight 600·테두리 2px)를 박스 없음으로 바꿈
  await page.close();

  page = await open('digest_reading');
  await step(page, 'showDigest(DB.works ? DB.works[0].id : DB[0].id)');
  const cq2 = await must(page, '.conquest-btn');
  assert.equal(cq2.bg, TRANSPARENT); assert.equal(cq2.bw[0], '0px'); assert.equal(cq2.radius, '0px');   // 작업217-3: 같은 이유
  await page.close();
});

// ───────────────────────── 레이아웃 ─────────────────────────
for (const w of [390, 768, 1024]) {
  test(`레이아웃 ${w}px: 변환한 화면(literature 홈·설명·카드, science 과목·캐러셀)에 가로 넘침·스크립트 오류 없음, 뱃지 줄이 두 줄 이내`, { skip: SKIP }, async () => {
    let page = await open('literature_compass', w);
    assert.equal(await page.hasHorizontalScroll(), false, '홈');
    await step(page, `showBriefing(${JSON.stringify(await page.eval(PICK_MOVEMENT))});`);
    assert.equal(await page.hasHorizontalScroll(), false, '설명');
    await step(page, 'showCards();');
    assert.equal(await page.hasHorizontalScroll(), false, '카드');
    const rows = await page.eval(`(() => { const b = document.querySelector('.card-badges'); const t = [...b.children].map(c => Math.round(c.getBoundingClientRect().top)); return new Set(t).size; })()`);
    assert.ok(rows <= 2, '뱃지 줄 수 ' + rows);
    await page.eval('flipCard()');
    await sleep(100);
    assert.equal(await page.hasHorizontalScroll(), false, '카드 뒷면');
    assert.deepEqual(page.errors, []);
    await page.close();

    page = await open('science_reading', w);
    assert.equal(await page.hasHorizontalScroll(), false, '과목 선택');
    await step(page, 'openField(FIELD_ORDER[0])');
    assert.equal(await page.hasHorizontalScroll(), false, '캐러셀');
    const bar = await page.eval(`(() => { const c = document.getElementById('subject-chip').getBoundingClientRect(), s = document.querySelector('.view.active .screen-bar').getBoundingClientRect(); return c.right <= s.right + 0.5 && c.left >= s.left - 0.5; })()`);
    assert.equal(bar, true, '분야 이름이 제목 줄 안에 있음');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}

async function done(page) { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); }

// ───────────────────────── 작업216-8: 누락 보강 + 자동 훑기 ─────────────────────────
test('literature 핵심 키워드(.keyword-tag): 박스·알약 없는 12px 보조색 글자, "·"로 구분(마지막 제외), 390px에서 줄바꿈되어도 넘침 없음', { skip: SKIP }, async () => {
  const page = await open('literature_compass', 390);
  const id = await page.eval(PICK_MOVEMENT);
  await step(page, `showBriefing(${JSON.stringify(id)})`);
  const m = await must(page, '.keyword-tag');
  assertPlainText(m, '.keyword-tag');
  assert.equal(m.weight, '500'); assert.equal(m.cursor, 'auto', '눌리지 않는 요소');
  assert.equal(await page.eval("document.querySelector('.keyword-tag').closest('button, a, [onclick]')"), null, '눌리는 요소 안에 있지 않음');
  const n = await page.count('.keyword-tag');
  assert.ok(n >= 1);
  assert.equal(await pseudo(page, '.keyword-tag:last-child', '::after'), 'none', '마지막 키워드에는 구분자 없음');
  if (n >= 2) assert.equal(await pseudo(page, '.keyword-tag:first-child', '::after'), '"·"');
  // 긴 키워드 12개로 강제 줄바꿈: 가로 넘침 없음, 각 키워드는 컨테이너 안, 구분자는 앞 키워드에 붙어 줄 맨 앞에 오지 않음
  await step(page, `(() => { const box = document.querySelector('.keyword-tags'); box.innerHTML = Array.from({ length: 12 }, (_, i) => '<span class="keyword-tag">긴키워드번호' + i + '입니다</span>').join(''); })()`);
  const geo = await page.eval(`(() => { const box = document.querySelector('.keyword-tags').getBoundingClientRect(); const tags = [...document.querySelectorAll('.keyword-tag')].map(e => e.getBoundingClientRect());
    return { lines: new Set(tags.map(r => Math.round(r.top))).size, inside: tags.every(r => r.left >= box.left - 0.5 && r.right <= box.right + 0.5), docW: document.documentElement.scrollWidth, winW: innerWidth }; })()`);
  assert.ok(geo.lines >= 2, '줄바꿈이 실제로 일어남');
  assert.ok(geo.inside, '키워드가 컨테이너 밖으로 나가지 않음');
  assert.ok(geo.docW <= geo.winW, '문서 가로 넘침 없음');
  await done(page);
});

test('science .source-tier: 알약·채움 없이 11px 보조색 글자, 대비 4.5:1 이상, 눌리지 않음(출처 링크 밖)', { skip: SKIP }, async () => {
  const page = await open('science_reading', 390);
  await step(page, "openField(FIELD_ORDER[0])");
  await step(page, "showScience(DB.concepts.find(c => c.sources && c.sources.length).id)");
  const m = await must(page, '.source-tier');
  assertPlainText(m, '.source-tier', { maxSize: 12 });
  assert.equal(m.size, 11); assert.equal(m.cursor, 'auto');
  assert.equal(await page.eval("document.querySelector('.source-tier').closest('button, a, [onclick]')"), null, '출처 링크(<a>) 안에 들어 있지 않음');
  await done(page);
});

// 자동 훑기: 눌리지 않는 요소 중 radius ≥ 12px 이면서 (배경이 투명이 아니거나 테두리가 있는) 것은 허용 목록 밖에서 0개여야 한다.
// 눌리는 요소(button, a, [onclick], [role=button])와 그 자손은 제외한다(칩·탭·선택지·토글은 유지 대상).
// 허용 목록 = 표시 뱃지가 아닌 "장식·구조" 요소. 새 요소가 이 조건에 걸리면 뱃지 변환 여부를 먼저 따져 보게 하려는 장치다.
const SWEEP_ALLOW = [
  ['.era-card', '시대 구역 카드(컨테이너)'],
  ['.section-box', '사조 설명의 본문 박스(컨테이너)'],
  ['.flip-card, .flip-card-front, .flip-card-back', '작품 카드(컨테이너, 카드 전체가 눌려 뒤집힘)'],
  ['.quiz-card', '퀴즈 카드(컨테이너)'],
  ['.result-score-wrap', '결과 화면의 점수 카드: 이모지·점수·메시지를 담은 테두리·그림자 카드(컨테이너). 칩·알약 형태의 뱃지가 아니라 유지'],
  ['.result-wrong-item', '결과 화면 틀린 문항 행 카드(컨테이너)'],
  ['.science-work-header, .science-section, .digest-work-header, .digest-section', '상세 화면 구역 카드(컨테이너)'],
  ['.carousel-card', '캐러셀 작품 카드(컨테이너)'],
  ['.subject-card', '과목 선택 카드(컨테이너)'],
  ['.spinner', '로딩 스피너'],
  ['.dot, .dot-indicators *', '카드 위치 표시 점(진행 표시)'],
  ['.quiz-progress-bar-wrap, .quiz-progress-bar', '퀴즈 진행 막대(진행 표시)'],
];
const SWEEP = `(() => {
  const allow = ${JSON.stringify(SWEEP_ALLOW.map(a => a[0]).join(','))};
  const out = [];
  for (const e of document.querySelectorAll('.view.active *')) {
    if (!e.getClientRects().length) continue;
    if (e.closest('button, a, [onclick], [role=button]')) continue;
    if (e.matches(allow)) continue;
    const cs = getComputedStyle(e);
    if (parseFloat(cs.borderTopLeftRadius) < 12 && !/%/.test(cs.borderTopLeftRadius)) continue;
    if (cs.borderTopLeftRadius === '0px') continue;
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none';
    const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    if (bg || border) out.push((e.id ? '#' + e.id : '') + '.' + String(e.className).replace(/ /g, '.') + ' <' + e.tagName.toLowerCase() + '> "' + e.textContent.trim().slice(0, 12) + '"');
  }
  return out;
})()`;
const sweep = async (page, label) => assert.deepEqual(await page.eval(SWEEP), [], label + ': 눌리지 않는 요소 중 알약/원/둥근 박스(배경·테두리) 발견');

test('자동 훑기: literature 홈·사조 설명·카드 앞/뒤·결과 화면에 눌리지 않는 알약/채움 박스가 없음(허용 목록 제외)', { skip: SKIP }, async () => {
  const page = await open('literature_compass', 390);
  await sweep(page, '홈');
  const id = await page.eval(PICK_MOVEMENT);
  await step(page, `showBriefing(${JSON.stringify(id)})`); await sweep(page, '사조 설명');
  await step(page, 'showCards()'); await sweep(page, '카드 앞면');
  await step(page, 'flipCard()'); await sweep(page, '카드 뒷면');
  await step(page, "quizData = { rounds: [], currentRound: 0, currentQ: 0, score: 1, totalQ: 4, wrong: [{ q: '문항', a: '정답' }] }; showView('view-result'); showResult()");
  assert.ok(await page.count('.result-score-wrap') === 1, '결과 화면이 그려짐');
  await sweep(page, '결과 화면');
  await done(page);
});

test('자동 훑기: science 과목 선택·캐러셀·개념 상세, digest 목록·작품 상세에 눌리지 않는 알약/채움 박스가 없음(허용 목록 제외)', { skip: SKIP }, async () => {
  let page = await open('science_reading', 390);
  await sweep(page, 'science 과목 선택');
  await step(page, 'openField(FIELD_ORDER[0])'); await sweep(page, 'science 캐러셀');
  await step(page, "showScience(DB.concepts.find(c => c.sources && c.sources.length).id)"); await sweep(page, 'science 개념 상세');
  await done(page);
  page = await open('digest_reading', 390);
  await sweep(page, 'digest 목록');
  await step(page, 'showDigest(DB.works[0].id)'); await sweep(page, 'digest 작품 상세');
  await done(page);
});

test('자동 훑기 자체 검증: 허용 목록 밖의 알약 span을 넣으면 반드시 잡아낸다(훑기가 아무것도 못 잡는 상태가 아님)', { skip: SKIP }, async () => {
  const page = await open('literature_compass', 390);
  await step(page, "(() => { const s = document.createElement('span'); s.className = 'probe-pill'; s.textContent = '프로브'; s.style.cssText = 'display:inline-block;padding:4px 10px;border-radius:20px;background:#fee'; document.querySelector('.view.active').appendChild(s); })()");
  const found = await page.eval(SWEEP);
  assert.equal(found.length, 1); assert.match(found[0], /probe-pill/);
  await step(page, "document.querySelector('.probe-pill').style.cssText = 'display:inline-block;border:1px solid #888;border-radius:50%'");
  assert.equal((await page.eval(SWEEP)).length, 1, '테두리만 있는 원도 잡음');
  await page.close();
});
