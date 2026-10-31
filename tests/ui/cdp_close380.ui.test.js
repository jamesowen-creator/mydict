// 작업380: UI 시험 도우미 page.close() 가 탭을 실제로 닫는지(헤드리스 Chrome). 페이지 5개를 만들고 닫으면 남은 탭 수가 처음으로 돌아오고, close() 를 두 번 불러도 오류가 없다.
// 실행: node --test tests/ui/cdp_close380.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (!SKIP) browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

const tabs = async () => (await (await fetch(`http://127.0.0.1:${browser.port}/json/list`)).json()).filter(t => t.type === 'page').length;

test('380-1) 페이지 5개를 만들어 닫으면 남은 탭 수가 처음 값으로 돌아온다', { skip: SKIP }, async () => {
  const base = await tabs();
  const pages = [];
  for (let i = 0; i < 5; i++) pages.push(await browser.newPage({ width: 360, height: 640 }));
  assert.equal(await tabs(), base + 5, '열었을 때 5개 늘어난다');
  for (const p of pages) await p.close();
  assert.equal(await tabs(), base, '닫으면 처음 값');
});

test('380-2) close() 를 두 번 불러도, 이미 사라진 탭이어도 오류가 없다', { skip: SKIP }, async () => {
  const base = await tabs();
  const p = await browser.newPage({ width: 360, height: 640 });
  await p.close(); await p.close();
  assert.equal(await tabs(), base);
  const q = await browser.newPage({ width: 360, height: 640 });
  await fetch(`http://127.0.0.1:${browser.port}/json/close/${q.targetId}`);   // 바깥에서 먼저 닫힌 탭
  await q.close();
  assert.equal(await tabs(), base);
});
