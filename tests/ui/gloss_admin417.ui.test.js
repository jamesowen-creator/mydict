// 작업417: 관리자 화면 "단어 뜻 일괄 변환" — [전체 적용]은 샘플을 본 뒤에만 켜지고, 확인은 화면 안(confirm 대화상자 없음)에서, 진행 표시가 나온다.
// 헤드리스 Chrome, 모의 API(tests/ui/helpers/mock_server.js). 실행: node --test tests/ui/gloss_admin417.ui.test.js   (Chrome이 없으면 건너뜀)
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

test('샘플 전에는 [전체 적용] 비활성 → 샘플 후 활성 → 화면 안 확인(건수·비용·모든 사용자) → 진행 표시', { skip: SKIP }, async () => {
  srv.reset();
  srv.state.me = { id: 7, email: 'u7@example.com', name: '관리자', role: 'admin' };
  srv.state.adminUsers = [{ id: 7, email: 'u7@example.com', name: '관리자', role: 'admin', is_blocked: false, is_approved: true, wordbook_count: 0, search_count: 0, tts_count: 0 }];
  let runCalls = 0;
  srv.state.adminApi = (u, m, body, J) => {
    if (u.endsWith('/status')) return J(200, { ok: true, targets: 120, users: 3, legacy: 4, converted: 10, est_calls: 6, est_cost_usd: 0.0512, cost_estimated: true, model: 'claude-haiku-4-5-20251001' });
    if (u.endsWith('/sample')) return J(200, { ok: true, items: [{ id: 1, word: 'run', before: ['무언가를 하는 것'], after: ['달리다, 뛰다'], short_meaning_after: '달리다', ok: true }, { id: 2, word: 'bad', before: ['설명'], after: [], short_meaning_after: '', ok: false }] });
    if (u.endsWith('/run')) {
      runCalls++;
      return runCalls === 1 ? J(200, { ok: true, run_id: 'gtest1', done: 100, failed: 1, skipped_changed: 2, failed_words: ['bad'], next_cursor: 100, remaining: 17, finished: false })
        : J(200, { ok: true, run_id: 'gtest1', done: 17, failed: 0, skipped_changed: 0, failed_words: [], next_cursor: 120, remaining: 0, finished: true });
    }
    return J(404, { ok: false });
  };
  const page = await browser.newPage({ width: 1280, height: 800, token: adminToken() });
  await page.goto(srv.url + '/admin');
  await page.waitFor("document.getElementById('gl-status') && /대상 120/.test(document.getElementById('gl-status').textContent)", 8000);
  await page.eval("window.__confirms = 0; window.confirm = () => { window.__confirms++; return true; }; true");
  const q = s => page.eval(s);
  assert.equal(await q("document.getElementById('gl-run').disabled"), true, '샘플 전 비활성');
  assert.match(await q("document.getElementById('gl-status').textContent"), /옛 구조\(대상 아님\) 4.*예상 비용 약 \$0\.05\(추정\)/);

  await q("document.getElementById('gl-sample').click(); true");
  await page.waitFor("document.querySelectorAll('#gl-tbody tr').length === 2", 5000);
  assert.equal(await q("document.getElementById('gl-run').disabled"), false, '샘플 후 활성');
  assert.deepEqual(await q("[...document.querySelectorAll('#gl-tbody tr')[0].children].map(td => td.textContent)"), ['run', '무언가를 하는 것', '달리다, 뛰다']);
  assert.equal(await q("document.querySelectorAll('#gl-tbody tr')[1].children[2].textContent"), '(변환 실패)');

  await q("document.getElementById('gl-run').click(); true");   // 첫 번째 누름: 확인 문구만
  await page.waitFor("document.getElementById('gl-confirm').style.display === 'block'", 5000);
  const txt = await q("document.getElementById('gl-confirm').textContent");
  assert.match(txt, /대상 120단어/); assert.match(txt, /약 \$0\.05\(추정\)/); assert.match(txt, /모든 사용자/);
  assert.equal(runCalls, 0, '확인 전에는 적용 호출 없음');
  assert.equal(await q("document.getElementById('gl-run').textContent"), '적용 실행');

  await q("document.getElementById('gl-run').click(); true");   // 두 번째 누름: 실행
  await page.waitFor("/남음 0/.test(document.getElementById('gl-progress').textContent)", 8000);
  assert.equal(await q("document.getElementById('gl-progress').textContent"), '완료 117 · 실패 1 · 건너뜀(그사이 수정) 2 · 남음 0');
  assert.match(await q("document.getElementById('gl-failed').textContent"), /실패한 단어: bad/);
  assert.equal(await q("document.getElementById('gl-runid').value"), 'gtest1');
  assert.equal(await q("window.__confirms"), 0, 'confirm 대화상자를 쓰지 않는다');
  assert.equal(runCalls, 2);
  const runs = srv.state.log.filter(l => l.url === '/api/admin/gloss/run');
  assert.deepEqual(runs.map(l => l.body), [{ cursor: 0 }, { cursor: 100, run_id: 'gtest1' }]);
  await page.close();
});
