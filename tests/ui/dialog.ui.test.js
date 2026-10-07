// 작업207-2: 공용 대화상자(dialog.js) - 열림·확인·취소·ESC·바깥 눌림·포커스·위험 표시·대기열·알림, 390/768/1024px 가로 스크롤 없음,
// dialog.js를 못 불렀을 때의 기본 대화상자 대체 코드(6개 화면 모두 같은 코드). 실행: node --test "tests/ui/*.test.js"
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

async function open(width = 390) {
  srv.reset();
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("typeof window.metisConfirm === 'function' && typeof window.metisAlert === 'function'", 8000);
  await page.eval('window.__res = []');
  return page;
}
const isOpen = page => page.eval("!!document.querySelector('dialog.metis-dialog[open]')");
const pressEsc = page => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  .then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));

test('확인: 열리고 문구가 보이며 기본 포커스는 확인, 누르면 true로 닫힘', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("void metisConfirm('저장하지 않은 내용이 있습니다. 나갈까요?').then(v => window.__res.push(v))");
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
  assert.equal(await page.text('[data-t="dialog-msg"]'), '저장하지 않은 내용이 있습니다. 나갈까요?');
  assert.equal(await page.eval("document.activeElement.dataset.t"), 'dialog-ok', '기본 포커스');
  assert.equal(await page.eval("document.querySelector('[data-t=dialog-ok]').classList.contains('primary')"), true);
  assert.equal(page.dialogs.length, 0, '기본 confirm 아님');
  await page.click('[data-t="dialog-ok"]');
  await page.waitFor('window.__res.length === 1');
  assert.deepEqual(await page.eval('window.__res'), [true]);
  assert.equal(await isOpen(page), false);
  assert.equal(await page.exists('dialog.metis-dialog'), false, '닫으면 DOM에서 제거');
  await page.close();
});

test('취소·ESC·바깥 눌림은 false', { skip: SKIP }, async () => {
  const page = await open();
  for (const how of ['cancel', 'esc', 'backdrop']) {
    await page.eval("void metisConfirm('계속할까요?').then(v => window.__res.push(v))");
    await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
    if (how === 'cancel') await page.click('[data-t="dialog-cancel"]');
    else if (how === 'esc') await pressEsc(page);
    else await page.eval("document.querySelector('dialog.metis-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }))");   // 배경(대화상자 바깥) 눌림
    await page.waitFor(`window.__res.length === ${['cancel', 'esc', 'backdrop'].indexOf(how) + 1}`, 4000);
  }
  assert.deepEqual(await page.eval('window.__res'), [false, false, false]);
  assert.equal(await isOpen(page), false);
  await page.close();
});

test('위험한 확인: 삭제 버튼은 빨간 위험 스타일이고 포커스는 취소에 먼저 둠', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("void metisConfirm('삭제할까요?', { danger: true, okText: '삭제' }).then(v => window.__res.push(v))");
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
  assert.equal(await page.eval("document.activeElement.dataset.t"), 'dialog-cancel');
  assert.equal(await page.eval("document.querySelector('[data-t=dialog-ok]').classList.contains('danger')"), true);
  assert.equal(await page.text('[data-t="dialog-ok"]'), '삭제');
  await page.click('[data-t="dialog-ok"]');
  await page.waitFor('window.__res.length === 1');
  assert.deepEqual(await page.eval('window.__res'), [true]);
  await page.close();
});

test('알림: 확인 버튼 하나, 닫히면 resolve(undefined)', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("void metisAlert('먼저 작품을 읽어보세요!').then(v => window.__res.push(String(v)))");
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
  assert.equal(await page.count('dialog.metis-dialog button'), 1);
  assert.equal(await page.exists('[data-t="dialog-cancel"]'), false);
  await pressEsc(page);
  await page.waitFor('window.__res.length === 1');
  assert.deepEqual(await page.eval('window.__res'), ['undefined']);
  await page.close();
});

test('포커스 복귀: 닫으면 열기 전에 있던 요소로 돌아감, 열려 있는 동안 배경 버튼은 눌리지 않음', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("(() => { const b = document.createElement('button'); b.id = 'probe'; b.textContent = 'probe'; b.style.cssText = 'position:fixed;left:8px;top:200px;z-index:1'; b.onclick = () => window.__res.push('probe-clicked'); document.body.append(b); b.focus(); })()");
  await page.eval("void metisConfirm('확인?').then(v => window.__res.push(v))");
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
  assert.equal(await page.eval("document.querySelector('dialog.metis-dialog').matches(':modal')"), true, '모달(배경 비활성)');
  await page.click('[data-t="dialog-cancel"]');
  await page.waitFor('window.__res.length === 1');
  assert.equal(await page.eval("document.activeElement.id"), 'probe');
  await page.close();
});

test('대기열: 동시에 여러 개를 열면 하나씩 차례로 보임', { skip: SKIP }, async () => {
  const page = await open();
  await page.eval("void metisConfirm('첫째').then(v => window.__res.push('1:' + v)); metisConfirm('둘째').then(v => window.__res.push('2:' + v)); void 0;");
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
  assert.equal(await page.count('dialog.metis-dialog'), 1);
  assert.equal(await page.text('[data-t="dialog-msg"]'), '첫째');
  await page.click('[data-t="dialog-ok"]');
  await page.waitFor("!!document.querySelector('[data-t=dialog-msg]') && document.querySelector('[data-t=dialog-msg]').textContent === '둘째'", 4000);
  await page.click('[data-t="dialog-cancel"]');
  await page.waitFor('window.__res.length === 2');
  assert.deepEqual(await page.eval('window.__res'), ['1:true', '2:false']);
  await page.close();
});

for (const w of [390, 768, 1024]) {
  test(`대화상자 ${w}px: 화면 안에 들어오고 가로 스크롤 없음, 버튼 44px 이상, 반경 16px`, { skip: SKIP }, async () => {
    const page = await open(w);
    await page.eval("void metisConfirm('아주 긴 문구입니다. '.repeat(30), { danger: true }).then(v => window.__res.push(v))");
    await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')");
    const g = await page.eval("(() => { const d = document.querySelector('dialog.metis-dialog').getBoundingClientRect(); return { l: d.left, r: d.right, t: d.top, b: d.bottom, w: innerWidth, h: innerHeight, radius: getComputedStyle(document.querySelector('dialog.metis-dialog')).borderRadius }; })()");
    assert.ok(g.l >= 0 && g.r <= g.w && g.t >= 0 && g.b <= g.h, '화면 안 ' + JSON.stringify(g));
    assert.equal(g.radius, '16px');
    assert.equal(await page.hasHorizontalScroll(), false);
    const small = await page.eval("[...document.querySelectorAll('dialog.metis-dialog button')].filter(b => b.getBoundingClientRect().height < 43.5).length");
    assert.equal(small, 0);
    await page.click('[data-t="dialog-cancel"]');
    await page.close();
  });
}

test('dialog.js를 불러오지 못했을 때: 6개 화면 모두 같은 대체 코드가 기본 confirm/alert로 같은 이름의 함수를 만듦', { skip: SKIP }, async () => {
  const pub = path.resolve(__dirname, '..', '..', 'public');
  for (const f of ['english_dictionary', 'literature_compass', 'digest_reading', 'science_reading', 'voice_study', 'concept_study']) {
    const html = fs.readFileSync(path.join(pub, f + '.html'), 'utf8');
    assert.ok(html.includes('<script src="/js/common/dialog.js"></script>'), f + ': dialog.js 로드');
    const m = html.match(/<script>(if \(!window\.metisConfirm\)[^\n]*)<\/script>/);
    assert.ok(m, f + ': 대체 코드');
    const calls = [];
    const win = {};
    new Function('window', 'confirm', 'alert', 'Promise', m[1])(win, msg => { calls.push(['confirm', msg]); return true; }, msg => { calls.push(['alert', msg]); }, Promise);
    assert.equal(await win.metisConfirm('삭제할까요?'), true, f);
    assert.equal(await win.metisAlert('알림'), undefined, f);
    assert.deepEqual(calls, [['confirm', '삭제할까요?'], ['alert', '알림']], f);
  }
});

test('교체 범위: 남은 기본 confirm()/alert()는 음성 학습의 동기 반환값이 필요한 이탈 확인 3곳뿐', { skip: SKIP }, async () => {
  const pub = path.resolve(__dirname, '..', '..', 'public');
  const left = [];
  for (const f of ['english_dictionary', 'literature_compass', 'digest_reading', 'science_reading', 'voice_study', 'concept_study']) {
    fs.readFileSync(path.join(pub, f + '.html'), 'utf8').split('\n').forEach((line, i) => {
      if (/(^|[^\w.])(confirm|alert)\(/.test(line) && !/window\.metis(Confirm|Alert) = function/.test(line)) left.push(f + ':' + (i + 1));
    });
  }
  assert.equal(left.length, 3, '남은 곳: ' + left.join(', '));
  assert.ok(left.every(x => x.startsWith('voice_study:')));
});
