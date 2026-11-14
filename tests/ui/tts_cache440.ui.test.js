// 작업440: 관리자 화면 "발음 캐시 지우기" — 입력칸·버튼 표시, 화면 안 확인(두 번 눌러 실행), 성공 "N건 삭제됨", 실패 이유, 변형 체크 전송.
// 헤드리스 Chrome, 모의 API(tests/ui/helpers/mock_server.js). 실행: node --test tests/ui/tts_cache440.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const adminToken = () => `${b64({ alg: 'none' })}.${b64({ id: 7, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

async function open(handler) {
  srv.reset();
  srv.state.me = { id: 7, email: 'u7@example.com', name: '관리자', role: 'admin' };
  srv.state.adminUsers = [{ id: 7, email: 'u7@example.com', name: '관리자', role: 'admin', is_blocked: false, is_approved: true, wordbook_count: 0, search_count: 0, tts_count: 0 }];
  srv.state.adminApi = (u, m, body, J) => handler(u, m, body, J);
  const page = await browser.newPage({ width: 390, height: 1800, token: adminToken() });
  await page.goto(srv.url + '/admin');
  await page.waitFor("document.getElementById('tc-del')", 8000);
  return page;
}

test('입력칸·[삭제]·변형 체크(기본 켜짐) 표시, 첫 누름은 확인 문구만(요청 없음), 두 번째 누름에 DELETE 전송, "N건 삭제됨"', { skip: SKIP }, async () => {
  const page = await open((u, m, body, J) => J(200, { ok: true, deleted: 2 }));
  const q = s => page.eval(s);
  assert.equal(await q("document.getElementById('tc-variants').checked"), true);
  assert.ok(await q("document.getElementById('tc-word').getBoundingClientRect().height >= 44"), '입력칸 44px');
  assert.equal(await q("document.getElementById('tc-del').textContent"), '삭제');
  await q("document.getElementById('tc-word').value = ' snobbish '; document.getElementById('tc-del').click(); true");
  await page.waitFor("document.getElementById('tc-confirm').style.display === 'block'", 5000);
  assert.match(await q("document.getElementById('tc-confirm').textContent"), /"snobbish"\(대소문자 변형 포함\)/);
  assert.equal(srv.state.log.filter(l => l.url === '/api/tts/cache/entry').length, 0, '확인 전에는 요청 없음');
  await q("document.getElementById('tc-del').click(); true");
  await page.waitFor("/건 삭제됨/.test(document.getElementById('tc-msg').textContent)", 5000);
  assert.equal(await q("document.getElementById('tc-msg').textContent"), '2건 삭제됨');
  const calls = srv.state.log.filter(l => l.url === '/api/tts/cache/entry');
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'DELETE');
  assert.deepEqual(calls[0].body, { text: 'snobbish', lang: 'en', variants: true });
  await page.close();
});

test('변형 체크를 끄면 variants:false, 취소하면 요청 없음, 서버 오류 이유가 문구로 보인다', { skip: SKIP }, async () => {
  const page = await open((u, m, body, J) => J(403, { error: '관리자 권한이 필요합니다.' }));
  const q = s => page.eval(s);
  await q("document.getElementById('tc-word').value = 'Foo'; document.getElementById('tc-del').click(); true");
  await page.waitFor("document.getElementById('tc-confirm').style.display === 'block'", 5000);
  await q("document.getElementById('tc-cancel').click(); true");
  assert.equal(await q("document.getElementById('tc-confirm').style.display"), 'none');
  assert.equal(srv.state.log.filter(l => l.url === '/api/tts/cache/entry').length, 0, '취소하면 요청 없음');
  await q("document.getElementById('tc-variants').click(); document.getElementById('tc-del').click(); true");
  await q("document.getElementById('tc-del').click(); true");
  await page.waitFor("/권한/.test(document.getElementById('tc-msg').textContent)", 5000);
  assert.equal(await q("document.getElementById('tc-msg').textContent"), '관리자 권한이 필요합니다.');
  assert.equal(srv.state.log.filter(l => l.url === '/api/tts/cache/entry')[0].body.variants, false);
  await page.close();
});

test('빈 입력이면 요청 없이 안내 문구', { skip: SKIP }, async () => {
  const page = await open((u, m, body, J) => J(200, { ok: true, deleted: 0 }));
  await page.eval("document.getElementById('tc-del').click(); true");
  assert.equal(await page.eval("document.getElementById('tc-msg').textContent"), '지울 단어를 입력하세요.');
  assert.equal(srv.state.log.filter(l => l.url === '/api/tts/cache/entry').length, 0);
  await page.close();
});
