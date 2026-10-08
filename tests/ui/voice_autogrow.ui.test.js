// 작업215-2: 음성 학습 원문(#edit-text)·요약(#edit-summary)·추가하지 못한 변환 결과(#over-text) 칸이 내용 길이만큼 늘어나는지(안쪽 스크롤 없음).
// 대화 입력(#chat-input)은 그대로. 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
// 검증 못 하는 화면: 퀴즈 풀이·오답 노트·합치기 미리보기는 모의 API가 없어 렌더 검증을 하지 않았다(이번 작업은 textarea에 한정).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const lines = (n, prefix = '줄') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1} 광합성 엽록체 요약 문장입니다.`).join('\n');
const wrapped = n => Array.from({ length: n }, (_, i) => `문단 ${i + 1} ` + '길게 이어지는 한 줄짜리 문장이 화면 폭에 따라 여러 줄로 줄바꿈됩니다 '.repeat(5)).join('\n');

async function open(width = 390, notes) {
  srv.reset();
  srv.state.me.perm_voice_study = true;
  srv.state.voiceNotes = notes || [
    { id: 1, title: '긴 자료', transcript: lines(90, '원문'), summary: lines(90, '요약'), subject: '과학', created_at: '2026-01-01T00:00:00Z' },
    { id: 2, title: '짧은 자료', transcript: '짧은 원문', summary: '짧은 요약', subject: '과학', created_at: '2026-01-02T00:00:00Z' },
  ];
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/voice_study.html');
  await page.waitFor("document.getElementById('list-count').textContent.length > 0", 8000);
  return page;
}
async function detail(page, id) {
  await page.eval(`openDetail(${id})`);
  await page.waitFor(`document.getElementById('view-edit').classList.contains('active') && document.getElementById('edit-title').value !== undefined && editNoteId === ${id}`, 5000);
  await sleep(60);
}
const metrics = (page, id) => page.eval(`(() => { const e = document.getElementById('${id}'); const cs = getComputedStyle(e); return { client: e.clientHeight, scroll: e.scrollHeight, offset: e.offsetHeight, overflowY: cs.overflowY, resize: cs.resize, inlineHeight: e.style.height, minHeight: cs.minHeight }; })()`);
const docHeight = page => page.eval('document.documentElement.scrollHeight');
const noInner = m => m.scroll - m.client <= 2;

test('390px: 90줄 요약·원문을 열면 안쪽 스크롤이 없고(scrollHeight-clientHeight ≤ 2) 문서 전체가 그만큼 길어짐, 스크롤바·크기 손잡이 없음', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 2);
  const shortDoc = await docHeight(page);
  const shortSum = await metrics(page, 'edit-summary'), shortTxt = await metrics(page, 'edit-text');
  await detail(page, 1);
  const sum = await metrics(page, 'edit-summary'), txt = await metrics(page, 'edit-text');
  assert.ok(noInner(sum), '요약: ' + JSON.stringify(sum));
  assert.ok(noInner(txt), '원문: ' + JSON.stringify(txt));
  assert.ok(sum.offset > shortSum.offset + 1000 && txt.offset > shortTxt.offset + 1000, '칸이 내용만큼 커짐: ' + [sum.offset, txt.offset]);
  const longDoc = await docHeight(page);
  assert.ok(longDoc > shortDoc + 2000, `문서 전체 높이가 늘어남: ${shortDoc} → ${longDoc}`);
  for (const m of [sum, txt]) { assert.equal(m.overflowY, 'hidden'); assert.equal(m.resize, 'none'); }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('내용이 짧으면 min-height(원문 280px, 요약 150px) 아래로 내려가지 않음', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 2);
  assert.equal((await metrics(page, 'edit-text')).offset, 280);
  assert.equal((await metrics(page, 'edit-summary')).offset, 150);
  await detail(page, 1);
  await detail(page, 2);   // 긴 자료 다음에 짧은 자료를 열면 다시 줄어듦
  assert.equal((await metrics(page, 'edit-text')).offset, 280);
  assert.equal((await metrics(page, 'edit-summary')).offset, 150);
  await page.close();
});

test('입력 이벤트: 줄을 늘리면 칸이 따라 늘고 지우면 줄어들되 min-height 아래로는 안 내려감', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 2);
  const sel = '#edit-summary';
  const h0 = (await metrics(page, 'edit-summary')).offset;
  await page.type(sel, lines(40));
  await sleep(60);
  const m40 = await metrics(page, 'edit-summary');
  assert.ok(noInner(m40), JSON.stringify(m40));
  assert.ok(m40.offset > h0 + 600, `늘어남 ${h0} → ${m40.offset}`);
  await page.type(sel, lines(20));
  await sleep(60);
  const m20 = await metrics(page, 'edit-summary');
  assert.ok(noInner(m20) && m20.offset < m40.offset && m20.offset > h0, `줄어듦 ${m40.offset} → ${m20.offset}`);
  await page.type(sel, '');
  await sleep(60);
  assert.equal((await metrics(page, 'edit-summary')).offset, 150, '비우면 min-height까지');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('숨겨져 있다가 보이는 칸: 화면 전환 직후 높이가 0이 아니고 안쪽 스크롤이 없음(처음 열 때·목록에 다녀온 뒤)', { skip: SKIP }, async () => {
  const page = await open(390);
  assert.equal(await page.eval("document.getElementById('edit-summary').getClientRects().length"), 0, '처음엔 숨겨져 있음');
  await detail(page, 1);
  let m = await metrics(page, 'edit-summary');
  assert.ok(m.offset > 1000 && noInner(m), JSON.stringify(m));
  await page.eval("showView('list')");
  assert.equal(await page.eval("document.getElementById('edit-summary').getClientRects().length"), 0);
  await page.eval("showView('edit')");
  m = await metrics(page, 'edit-summary');
  assert.ok(m.offset > 1000 && noInner(m), '다시 보이면 맞춰짐: ' + JSON.stringify(m));
  assert.equal(await page.eval('window.scrollY'), 0, '화면 전환 시 맨 위로 이동하는 기존 동작 유지');
  await page.close();
});

test('화면 전환은 이전 스크롤 위치와 상관없이 맨 위로(기존 동작) — 긴 자료를 아래까지 읽다가 다른 자료를 열어도', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 1);
  await page.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
  assert.ok(await page.eval('window.scrollY') > 1000);
  await detail(page, 2);
  assert.equal(await page.eval('window.scrollY'), 0);
  await page.close();
});

test('추가하지 못한 변환 결과(#over-text, 읽기 전용)도 내용만큼 늘어남', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 2);
  await page.eval(`(() => { document.getElementById('over-text').value = ${JSON.stringify(lines(90, '변환'))}; document.getElementById('over-box').style.display = ''; autoGrow(document.getElementById('over-text')); })()`);
  const m = await metrics(page, 'over-text');
  assert.ok(noInner(m) && m.offset > 1000, JSON.stringify(m));
  assert.equal(m.overflowY, 'hidden'); assert.equal(m.resize, 'none');
  await page.eval("document.getElementById('over-close').click()");
  assert.equal(await page.eval("document.getElementById('over-box').style.display"), 'none');
  await page.eval("document.getElementById('over-box').style.display = ''");   // 다시 보이게 해서 확인
  assert.equal((await metrics(page, 'over-text')).offset, 150, '닫을 때 비워지고 min-height로 돌아가 있음');
  await page.close();
});

test('한글 조합(IME) 중에는 높이를 건드리지 않고, 조합이 끝나면 맞춤', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 2);
  const out = await page.eval(`(() => {
    const t = document.getElementById('edit-text');
    t.focus();
    const before = t.style.height;
    t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    t.value = ${JSON.stringify(lines(60))};
    t.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    const during = t.style.height;
    t.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '가' }));
    const after = t.style.height;
    return { before, during, after, client: t.clientHeight, scroll: t.scrollHeight };
  })()`);
  assert.equal(out.during, out.before, '조합 중에는 높이 그대로');
  assert.notEqual(out.after, out.before, '조합이 끝나면 맞춤');
  assert.ok(out.scroll - out.client <= 2, JSON.stringify(out));
  await page.close();
});

test('창 폭이 바뀌면(회전 등) 줄바꿈이 달라져도 안쪽 스크롤 없이 다시 맞춤', { skip: SKIP }, async () => {
  const notes = [{ id: 1, title: '줄바꿈 많은 자료', transcript: wrapped(30), summary: wrapped(30), subject: '과학', created_at: '2026-01-01T00:00:00Z' }];
  const page = await open(390, notes);
  await detail(page, 1);
  const narrow = await metrics(page, 'edit-summary');
  assert.ok(noInner(narrow));
  await page.resize(1024, 844);
  await sleep(250);
  const wide = await metrics(page, 'edit-summary');
  assert.ok(noInner(wide), JSON.stringify(wide));
  assert.ok(wide.offset < narrow.offset, `넓어지면 줄어듦 ${narrow.offset} → ${wide.offset}`);
  await page.resize(390, 844);
  await sleep(250);
  const back = await metrics(page, 'edit-summary');
  assert.ok(noInner(back) && Math.abs(back.offset - narrow.offset) <= 2, JSON.stringify([narrow.offset, back.offset]));
  await page.close();
});

test('입력 중 화면이 튀지 않음: 끝에서 줄을 계속 추가해도 스크롤 위치가 되돌아가지 않고 커서 줄이 보이는 영역 안에 있음', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 1);
  await page.eval(`(() => { const t = document.getElementById('edit-summary'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); t.scrollIntoView({ block: 'end' }); })()`);
  await sleep(80);
  let prevY = await page.eval('window.scrollY');
  for (let i = 0; i < 25; i++) {
    await page.send('Input.insertText', { text: '\n추가한 줄 ' + (i + 1) });
    await sleep(25);
    const y = await page.eval('window.scrollY');
    assert.ok(y >= prevY - 1, `스크롤이 위로 튐: ${prevY} → ${y} (줄 ${i + 1})`);
    prevY = y;
  }
  await sleep(80);
  const st = await page.eval(`(() => { const t = document.getElementById('edit-summary'); const r = t.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, inner: t.scrollHeight - t.clientHeight, y: scrollY }; })()`);
  assert.ok(st.inner <= 2, '안쪽 스크롤 없음 ' + JSON.stringify(st));
  assert.ok(st.bottom <= st.vh + 40, `커서가 있는 마지막 줄이 화면 안: ${JSON.stringify(st)}`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('대화 입력(#chat-input)은 그대로: 안쪽 스크롤·크기 조절 유지, 높이 자동 조절 없음, 입력줄은 하단 고정(sticky)', { skip: SKIP }, async () => {
  const page = await open(390);
  await detail(page, 2);
  await page.eval("showView('chat')");
  const out = await page.eval(`(() => {
    const t = document.getElementById('chat-input'), bar = document.querySelector('.chat-input-bar');
    const base = t.offsetHeight;
    t.value = ${JSON.stringify(lines(60))};
    t.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const cs = getComputedStyle(t), bs = getComputedStyle(bar);
    return { before: base, overflowY: cs.overflowY, resize: cs.resize, inlineHeight: t.style.height, offset: t.offsetHeight, minHeight: cs.minHeight, hasClass: t.classList.contains('auto-grow'), position: bs.position, bottom: bs.bottom };
  })()`);
  assert.equal(out.overflowY, 'auto'); assert.equal(out.resize, 'vertical');
  assert.equal(out.inlineHeight, '', '높이를 건드리지 않음');
  assert.equal(out.hasClass, false);
  assert.equal(out.offset, out.before, '내용이 길어져도 칸 높이가 그대로(안쪽 스크롤로 처리)');
  assert.equal(out.minHeight, '72px');
  assert.deepEqual([out.position, out.bottom], ['sticky', '0px']);
  await page.close();
});

test('가로 스크롤 없음(390/768/1024), 긴 자료 상세에서도 스크립트 오류 없음', { skip: SKIP }, async () => {
  for (const w of [390, 768, 1024]) {
    const page = await open(w);
    await detail(page, 1);
    assert.equal(await page.hasHorizontalScroll(), false, w + 'px');
    assert.ok(noInner(await metrics(page, 'edit-text')) && noInner(await metrics(page, 'edit-summary')), w + 'px');
    assert.deepEqual(page.errors, [], w + 'px');
    await page.close();
  }
});

test('코드 점검: 원문·요약·변환 결과 칸에 값을 넣는 모든 지점이 autoGrow를 부르거나(바로 아래), 화면 전환(showView)이 맞춰 주는 열기 함수 안에 있음', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'voice_study.html'), 'utf8').split('\n');
  const assign = /\$\('(edit-text|edit-summary|over-text)'\)\.value\s*=[^=]/;
  const viaShowView = new Set(['openEditNew', 'openDetail']);
  const found = [];
  src.forEach((line, i) => {
    if (!assign.test(line)) return;
    let fn = '';
    for (let j = i; j >= 0; j--) { const m = src[j].match(/^(?:async )?function (\w+)/); if (m) { fn = m[1]; break; } }
    const next = src.slice(i, i + 6).join('\n');
    found.push({ line: i + 1, fn, ok: /autoGrow\(/.test(next) || viaShowView.has(fn) || /\.addEventListener\('click'/.test(line) && /autoGrow\(/.test(line) });
  });
  assert.ok(found.length >= 9, '값을 넣는 지점을 찾음: ' + found.length);
  assert.deepEqual(found.filter(f => !f.ok), [], '맞춤 호출이 없는 지점');
  const showView = src.join('\n').match(/function showView\(name\) \{[\s\S]*?\n\}/)[0];
  assert.match(showView, /autoGrowAll\(\);[\s\S]*window\.scrollTo\(0, 0\)/, 'showView: 맞춘 뒤 맨 위로 이동');
});
