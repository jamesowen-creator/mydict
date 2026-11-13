// 작업421: 관리자 화면 "단어 뜻 일괄 변환" 보완 — 실패 뒤 잠김 해소·남은 수 재조회·[이어서 적용], 부분 완료 응답 이어 요청·[중단], 원인별 문구, 샘플 게이트 면제.
// 헤드리스 Chrome, 모의 API(tests/ui/helpers/mock_server.js). 실제 서버·AI·DB 없음. 실행: node --test tests/ui/gloss_admin421.ui.test.js   (Chrome이 없으면 건너뜀)
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
const STATUS = (over = {}) => ({ ok: true, targets: 40, users: 2, legacy: 0, converted: 0, est_calls: 2, est_cost_usd: 0.0123, cost_estimated: true, model: 'm', ...over });
const SAMPLE = { ok: true, items: [{ id: 1, word: 'run', before: ['가'], after: ['달리다'], short_meaning_after: '달리다', ok: true, reason: '', fail_items: [] }] };

async function openAdmin(api, { sample = true } = {}) {
  srv.reset();
  srv.state.me = { id: 7, email: 'u7@example.com', name: '관리자', role: 'admin' };
  srv.state.adminUsers = [{ id: 7, email: 'u7@example.com', name: '관리자', role: 'admin', is_blocked: false, is_approved: true, wordbook_count: 0, search_count: 0, tts_count: 0 }];
  srv.state.adminApi = api;
  const page = await browser.newPage({ width: 1280, height: 1800, token: adminToken() });
  await page.goto(srv.url + '/admin');
  await page.waitFor("document.getElementById('gl-status') && /대상|현황을 불러오지/.test(document.getElementById('gl-status').textContent)", 8000);
  if (sample) { await page.eval("document.getElementById('gl-sample').click(); true"); await page.waitFor("document.querySelectorAll('#gl-tbody tr').length === 1", 5000); }
  return page;
}
const q = (page, s) => page.eval(s);
const logs = u => srv.state.log.filter(l => l.url === '/api/admin/gloss/' + u);
const runBtn = "document.getElementById('gl-run')";
// [전체 적용] → 확인 문구 → [적용 실행]
async function startRun(page) {
  await q(page, runBtn + '.click(); true');
  await page.waitFor("document.getElementById('gl-confirm').style.display === 'block'", 5000);
  await q(page, runBtn + '.click(); true');
}

test('(a) 요청이 네트워크로 끊겨도 [전체 적용]이 잠기지 않고, 남은 수를 서버에서 다시 읽어 보여 주며, [이어서 적용]으로 이어 간다', { skip: SKIP }, async () => {
  let statusN = 0, runN = 0;
  const page = await openAdmin((u, m, body, J) => {
    if (u.endsWith('/status')) { statusN++; return J(200, STATUS({ targets: statusN >= 3 ? 25 : 40 })); }
    if (u.endsWith('/sample')) return J(200, SAMPLE);
    if (u.endsWith('/run')) { runN++; return J(200, { ok: true, run_id: 'g421', done: 25, failed: 0, skipped_changed: 0, failed_words: [], fail_kinds: { ai: 0, rule: 0, structure: 0 }, next_cursor: 99, remaining: 0, finished: true, partial: false }); }
    return J(404, { ok: false });
  });
  // 첫 [적용 실행] 요청만 네트워크 오류로 만든다(서버는 받지 못함)
  await q(page, "(() => { const f = window.fetch; let n = 0; window.fetch = function (u, o) { if (String(u).endsWith('/api/admin/gloss/run') && n++ === 0) return Promise.reject(new TypeError('Failed to fetch')); return f.apply(this, arguments); }; })(); true");
  const before = statusN;
  await startRun(page);
  await page.waitFor("/남은 \\d+단어/.test(document.getElementById('gl-msg').textContent)", 10000);
  const msg = await q(page, "document.getElementById('gl-msg').textContent");
  assert.match(msg, /네트워크 끊김/); assert.match(msg, /남은 25단어/, '남은 수를 서버에서 다시 읽음(첫 읽기 40 → 25)');
  assert.ok(statusN > before, '현황을 다시 조회했다');
  assert.equal(await q(page, runBtn + '.disabled'), false, '실패 뒤에도 잠기지 않음');
  assert.equal(await q(page, runBtn + '.textContent'), '이어서 적용');
  assert.equal(runN, 0, '실패한 요청은 서버에 닿지 않았다');
  await startRun(page);   // [이어서 적용] → 확인 → 실행
  await page.waitFor("/끝났습니다/.test(document.getElementById('gl-msg').textContent)", 8000);
  assert.equal(runN, 1);
  assert.equal(await q(page, runBtn + '.textContent'), '전체 적용', '끝나면 라벨이 원래대로');
  await page.close();
});

test('(a) 요청 실패 직후 현황 조회마저 실패해도(서버가 바쁜 중) 버튼이 잠기지 않는다', { skip: SKIP }, async () => {
  let failStatus = false;
  const page = await openAdmin((u, m, body, J) => {
    if (u.endsWith('/status')) return failStatus ? J(500, { ok: false, error: 'busy' }) : J(200, STATUS());
    if (u.endsWith('/sample')) return J(200, SAMPLE);
    if (u.endsWith('/run')) return J(504, { ok: false });
    return J(404, { ok: false });
  });
  await q(page, runBtn + '.click(); true');
  await page.waitFor("document.getElementById('gl-confirm').style.display === 'block'", 5000);
  failStatus = true;
  await q(page, runBtn + '.click(); true');
  await page.waitFor("/남은 수를 읽지 못했습니다/.test(document.getElementById('gl-msg').textContent)", 15000);
  assert.match(await q(page, "document.getElementById('gl-msg').textContent"), /서버 시간 초과/);
  assert.equal(await q(page, runBtn + '.disabled'), false, '현황을 못 읽어도 잠기지 않음');
  assert.equal(await q(page, runBtn + '.textContent'), '이어서 적용');
  await page.close();
});

test('(b) 부분 완료 응답을 받으면 남은 수가 0이 될 때까지 이어서 요청하고, 진행 수를 보여 준다', { skip: SKIP }, async () => {
  const seq = [
    { done: 40, failed: 1, skipped_changed: 0, failed_words: ['bad'], fail_kinds: { ai: 0, rule: 1, structure: 0 }, next_cursor: 40, remaining: 60, finished: false, partial: true },
    { done: 40, failed: 0, skipped_changed: 1, failed_words: [], fail_kinds: { ai: 0, rule: 0, structure: 0 }, next_cursor: 80, remaining: 20, finished: false, partial: true },
    { done: 20, failed: 0, skipped_changed: 0, failed_words: [], fail_kinds: { ai: 0, rule: 0, structure: 0 }, next_cursor: 100, remaining: 0, finished: true, partial: false },
  ];
  let i = 0;
  const page = await openAdmin((u, m, body, J) => {
    if (u.endsWith('/status')) return J(200, STATUS({ targets: 100 }));
    if (u.endsWith('/sample')) return J(200, SAMPLE);
    if (u.endsWith('/run')) return J(200, { ok: true, run_id: 'g421b', calls: 3, ...seq[i++] });
    return J(404, { ok: false });
  });
  await startRun(page);
  await page.waitFor("/끝났습니다/.test(document.getElementById('gl-msg').textContent)", 10000);
  assert.equal(await q(page, "document.getElementById('gl-progress').textContent"), '완료 100 · 실패 1 · 건너뜀(그사이 수정) 1 · 남음 0');
  assert.deepEqual(logs('run').map(l => l.body), [{ cursor: 0 }, { cursor: 40, run_id: 'g421b' }, { cursor: 80, run_id: 'g421b' }]);
  await page.close();
});

test('(b) 부분 완료 진행 중 [중단]을 누르면 그 응답까지 처리하고 멈추며 [이어서 적용]이 된다', { skip: SKIP }, async () => {
  let n = 0;
  const page = await openAdmin((u, m, body, J) => {
    if (u.endsWith('/status')) return J(200, STATUS({ targets: 100 }));
    if (u.endsWith('/sample')) return J(200, SAMPLE);
    if (u.endsWith('/run')) { n++; return setTimeout(() => J(200, { ok: true, run_id: 'g421c', done: 40, failed: 0, skipped_changed: 0, failed_words: [], fail_kinds: { ai: 0, rule: 0, structure: 0 }, next_cursor: 40 * n, remaining: 100 - 40 * n, finished: false, partial: true }), 400); }
    return J(404, { ok: false });
  });
  await startRun(page);
  await page.waitFor("document.getElementById('gl-stop').style.display === 'inline-flex'", 5000);
  assert.equal(await q(page, "document.getElementById('gl-stop').textContent"), '중단');
  await page.click('#gl-stop');
  await page.waitFor("/중단했습니다/.test(document.getElementById('gl-msg').textContent)", 8000);
  assert.equal(n, 1, '중단 뒤에는 더 요청하지 않는다');
  assert.match(await q(page, "document.getElementById('gl-progress').textContent"), /완료 40 .* 남음 60/);
  assert.equal(await q(page, runBtn + '.textContent'), '이어서 적용');
  assert.equal(await q(page, runBtn + '.disabled'), false);
  await page.close();
});

test('(c) 원인별 문구: 서버 시간 초과(504) / AI 응답 오류(503) / 서버 오류(500) / 이미 실행 중(409), 실패 종류별 단어 수와 실패 단어 이름', { skip: SKIP }, async () => {
  let mode = 504;
  const page = await openAdmin((u, m, body, J) => {
    if (u.endsWith('/status')) return J(200, STATUS());
    if (u.endsWith('/sample')) return J(200, SAMPLE);
    if (u.endsWith('/run')) return typeof mode === 'number' ? J(mode, { ok: false, error: mode === 503 ? 'AI를 사용할 수 없습니다.' : mode === 409 ? '이미 실행 중입니다. 끝난 뒤 다시 시도해 주세요.' : '변환에 실패했습니다.' })
      : J(200, { ok: true, run_id: 'g421d', done: 10, failed: 6, skipped_changed: 0, failed_words: ['a1', 'b2', 'c3'], fail_kinds: { ai: 3, rule: 2, structure: 1 }, next_cursor: 20, remaining: 0, finished: true, partial: false });
    return J(404, { ok: false });
  });
  const expectations = [[504, /서버 시간 초과/], [503, /AI 응답 오류.*AI를 사용할 수 없습니다/], [500, /서버 오류: 변환에 실패했습니다/], [409, /이미 실행 중입니다/]];
  for (const [code, re] of expectations) {
    mode = code;
    await startRun(page);
    await page.waitFor(`document.getElementById('gl-msg').textContent.length > 0 && !document.getElementById('gl-msg').textContent.includes('다시 읽는 중') && ${JSON.stringify(re.source)} && new RegExp(${JSON.stringify(re.source)}).test(document.getElementById('gl-msg').textContent)`, 12000);
    assert.equal(await q(page, runBtn + '.disabled'), false, code + ' 뒤에도 잠기지 않음');
  }
  mode = 'ok';
  await startRun(page);
  await page.waitFor("/끝났습니다/.test(document.getElementById('gl-msg').textContent)", 8000);
  const f = await q(page, "document.getElementById('gl-failed').textContent");
  assert.match(f, /AI 응답 오류 3단어 · 규칙 불통과 2단어 · 단어 구조 이상으로 건너뜀 1단어/);
  assert.match(f, /실패한 단어: a1, b2, c3/);
  await page.close();
});

test('(d) 샘플 게이트: 변환된 단어가 0개면 샘플을 봐야 켜지고, 1개 이상이면 샘플 없이도 켜진다', { skip: SKIP }, async () => {
  const mk = converted => (u, m, body, J) => (u.endsWith('/status') ? J(200, STATUS({ converted })) : u.endsWith('/sample') ? J(200, SAMPLE) : J(404, { ok: false }));
  let page = await openAdmin(mk(0), { sample: false });
  assert.equal(await q(page, runBtn + '.disabled'), true, '변환 0개: 샘플 전 비활성');
  await q(page, "document.getElementById('gl-sample').click(); true");
  await page.waitFor("document.querySelectorAll('#gl-tbody tr').length === 1", 5000);
  assert.equal(await q(page, runBtn + '.disabled'), false, '샘플 후 활성');
  await page.close();
  page = await openAdmin(mk(7), { sample: false });
  assert.equal(await q(page, runBtn + '.disabled'), false, '변환 1개 이상: 샘플 없이 활성');
  assert.equal(await q(page, "document.querySelectorAll('#gl-tbody tr').length"), 0, '샘플은 보지 않았다');
  await page.close();
});
