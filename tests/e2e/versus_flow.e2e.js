// 작업349: 대결 통합 시험(1/2) — 기본 흐름, 시작 시점 차이, 서버 재시작, 동시 다시 하기, 늦은 신호, 결과 전송 실패, 게임 중 나가기.
// 실제 server.js(자식 프로세스) + 브라우저 2개(서로 다른 프로필). 운영 서버·DB·외부 API 는 쓰지 않는다. 설명은 helpers/harness.js 머리말.
// 실행: node --test tests/e2e/versus_flow.e2e.js   (기본 전체 시험 glob "tests/**/*.test.js" 에는 들어가지 않는다)
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { SKIP, click, text, shown, running, roomIdOf, roundOf, createRoom, joinFromList, holdAlive, endRun, resultShown, finTitle, closePlayer, surv, startGame, sleep, api } = H;

// 발견한 버그로 실패하는 시나리오는 단언을 그대로 두고 여기서 skip 한다(사유: "350에서 수정: 버그 번호"). 비어 있으면 모두 실행.
const KNOWN = {};
const opts = (name, extra) => Object.assign({ skip: SKIP || KNOWN[name] || false, timeout: 180000 }, extra);

let env;
test.before(async () => { if (!SKIP) env = await H.setup(); });
test.after(async () => { if (env) await env.close(); });
// 시험마다 서버를 새로 띄워 방·요청 수 기록을 비운다. 사람 A, B 를 새 탭으로 연다.
async function twoPlayers(o = {}) {
  await env.srv.restart();
  const A = await H.openPlayer(env.bA, 'A', env.srv, o.A || {}), B = await H.openPlayer(env.bB, 'B', env.srv, o.B || {});
  const done = async () => { await closePlayer(env.bA, A); await closePlayer(env.bB, B); };
  return { A, B, done };
}
// 각자의 생존 시간이 같은 지점(secs 초)에 닿았을 때 끝낸다(한 사람이 먼저 시작해 있던 시간 차이가 판정에 섞이지 않게)
const endAt = async (page, secs, score) => { await page.waitFor('SpellRun.G.time - SpellRun.G.startTime > ' + secs, 15000); await endRun(page, score); };
const bothResult = async (A, B) => { await Promise.all([resultShown(A), resultShown(B)]); return { a: await finTitle(A), b: await finTitle(B), wa: await text(A, '#vsFinWhy'), wb: await text(B, '#vsFinWhy') }; };
const OPP = { 승리: '패배', 패배: '승리', 무승부: '무승부' };
const noErrors = (...ps) => ps.forEach(p => assert.deepEqual(p.errors.filter(e => !/Failed to load resource/.test(e)), [], p.who + ' 콘솔 오류'));

test('349-2 기본 흐름: 방 만들기 → 목록 → 참가 → 시작(A 미리 보기 끔, B 켬) → 상대 막대 → 생존 시간 승부 → 다시 하기 → 새 판(점수 승부) → 다시 하기 → 새 판(무승부) → A 나가기 → B 에 막힘 사유', opts('flow'), async () => {
  const { A, B, done } = await twoPlayers({ B: { preview: true } });
  const id = await createRoom(A);
  // B 의 목록에 A 의 방이 보인다
  await H.enterVersus(B);
  await B.waitFor("document.querySelectorAll('#vsList li').length === 1", 8000);
  assert.match(await B.eval("document.querySelector('#vsList li').innerText"), /에이/);
  assert.equal(await B.eval("document.querySelector('#vsList button').textContent"), '참가');
  await click(B, '#vsList button[data-room]');
  await B.waitFor("!document.getElementById('vsRoomView').hidden && document.getElementById('vsGo').textContent === '시작'", 8000);
  await A.waitFor("document.getElementById('vsGo').textContent === '시작'", 8000);   // A 화면도 두 사람 준비로 바뀐다
  assert.match(await text(A, '#vsPlayers'), /비/); assert.match(await text(B, '#vsPlayers'), /에이/);
  assert.equal(await roundOf(A), 1); assert.equal(await roundOf(B), 1);
  // 각자 시작: A 는 미리 보기 없이, B 는 미리 보기를 거친다
  await startGame(A);
  assert.equal(await B.eval("document.getElementById('pv').hidden"), true);
  await startGame(B);
  assert.equal(env.srv.log.join('').includes('Error'), false, '서버 로그에 오류 없음');
  // 상대 막대가 서로 갱신된다(이름·체력·점수·콤보·단어 번호)
  for (const [me, other] of [[A, B], [B, A]]) {
    // 게임 진행을 잠깐 멈추고(manual) 점수·콤보·체력·단어 번호를 정해 신호가 가게 한다. 단어 번호는 이미 공급된 단어 안에서만 올린다(없는 단어를 가리키면 게임이 깨진다)
    const wi = await me.eval('Math.min(2, SpellRun.G.words.length - 1)');
    await me.eval("SpellRun.manual = true; (() => { const G = SpellRun.G; G.score = 1200; G.combo = 4; G.wi = " + wi + "; G.hp = 3; SpellRun.vs.renderHearts(); })()");
    await other.waitFor("document.getElementById('vsBarStats').textContent === '체력 3/5 · 점수 1,200 · 콤보 4 · 단어 " + (wi + 1) + "'", 5000);
    assert.equal(await text(other, '#vsBarName'), me.who === 'A' ? '에이' : '비');
    await me.eval("SpellRun.G.hp = SpellRun.CONFIG.HP; SpellRun.manual = false");   // 단어 번호·점수는 서버가 줄어드는 값을 거부하므로 되돌리지 않는다
  }
  await holdAlive(A); await holdAlive(B);
  // 1판: 생존 시간 차이로 승부(A 가 먼저 쓰러지고 B 는 3초 이상 더 산다)
  await A.waitFor('SpellRun.G.time - SpellRun.G.startTime > 3', 8000);
  await endRun(A, 1300);   // 직전 상태 점수(1200)보다 낮은 최종 점수는 서버가 거부한다
  await A.waitFor("!document.getElementById('vsFinView').hidden", 5000);
  await B.waitFor('SpellRun.G.time - SpellRun.G.startTime > ' + ((await surv(A)) + 3), 15000);
  await endRun(B, 1250);
  let r = await bothResult(A, B);
  assert.equal(r.a, '패배'); assert.equal(r.b, '승리'); assert.equal(r.wa, r.wb); assert.match(r.wa, /생존 시간이 .*초 더 길어서/);
  assert.match(await A.eval("document.getElementById('vsFinList').innerText"), /에이[\s\S]*비/); noErrors(A, B);
  // 양쪽 다시 하기 → 새 판(round 2) 준비 화면
  await A.waitFor("!document.getElementById('vsFinRematch').hidden"); await B.waitFor("!document.getElementById('vsFinRematch').hidden");
  await click(A, '#vsFinRematch');
  await B.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('상대가 다시 하기를 원해요')", 6000);
  await click(B, '#vsFinRematch');
  await Promise.all([A, B].map(p => p.waitFor("!document.getElementById('vsRoomView').hidden && SpellRun.vs.state.round === 2 && document.getElementById('vsGo').textContent === '시작'", 8000)));
  assert.equal(await A.eval("document.getElementById('vsFinView').hidden"), true);
  // 2판: 시간 차이 1.5초 이내라 점수로 승부(A 가 이긴다)
  await startGame(A); await startGame(B);
  await holdAlive(A); await holdAlive(B);
  await Promise.all([endAt(A, 2, 500), endAt(B, 2, 300)]);
  r = await bothResult(A, B);
  assert.equal(r.a, '승리'); assert.equal(r.b, '패배'); assert.equal(r.wa, r.wb); assert.match(r.wa, /1\.5초 이내로 비슷해서 점수로/);
  // 3판: 무승부(시간 차 1.5초 이내, 점수 같음)
  await A.waitFor("!document.getElementById('vsFinRematch').hidden"); await B.waitFor("!document.getElementById('vsFinRematch').hidden");
  await click(B, '#vsFinRematch'); await click(A, '#vsFinRematch');
  await Promise.all([A, B].map(p => p.waitFor("SpellRun.vs.state.round === 3 && !document.getElementById('vsRoomView').hidden && document.getElementById('vsGo').textContent === '시작'", 8000)));
  await startGame(A); await startGame(B);
  await holdAlive(A); await holdAlive(B);
  await Promise.all([endAt(A, 2, 0), endAt(B, 2, 0)]);
  r = await bothResult(A, B);
  assert.equal(r.a, '무승부'); assert.equal(r.b, '무승부'); assert.equal(r.wa, '생존 시간과 점수가 모두 같아요.'); assert.equal(r.wb, r.wa);
  // A 가 결과 화면에서 방 목록으로 → B 는 다시 하기가 막히고 이유가 나온다
  await click(A, '#vsFinRooms');
  await A.waitFor("!document.getElementById('vsListView').hidden");
  await B.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('나가서 다시 할 수 없어요')", 6000);
  assert.equal(await shown(B, '#vsFinRematch'), false);
  assert.equal((await api(env.srv, 'B', 'GET', '/rooms/' + id)).data.round, 3);
  noErrors(A, B);
  assert.deepEqual(env.srv.unexpectedSql(), []);
  await done();
});

test('349-2 미리 보기 켠 쪽과 켠 쪽이 만나도 같은 흐름(둘 다 미리 보기 켬)', opts('preview-both'), async () => {
  const { A, B, done } = await twoPlayers({ A: { preview: true }, B: { preview: true } });
  await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B);
  await holdAlive(A); await holdAlive(B); await sleep(1200);
  await Promise.all([endRun(A, 10), endRun(B, 20)]);
  const r = await bothResult(A, B);
  assert.equal(OPP[r.a], r.b); assert.equal(r.wa, r.wb);
  noErrors(A, B);
  await done();
});

test('349-2 방장이 게임 중 나가면(나가기 확인) B 는 "상대가 중간에 나갔어요"와 서버 판정 결과를 본다', opts('quit-mid'), async () => {
  const { A, B, done } = await twoPlayers();
  await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
  await sleep(1500);
  await click(A, '#vsQuitBtn');
  assert.equal(await shown(A, '#vsQuit'), true);
  await B.waitFor("document.getElementById('vsBarName').textContent === '에이'");
  await click(A, '#vsQuitGo');
  await A.waitFor("!document.getElementById('vsListView').hidden", 5000);
  await B.waitFor("document.getElementById('vsBarName').textContent.includes('나감')", 5000);
  await sleep(1800); await endRun(B, 30);
  await resultShown(B);
  assert.match(await text(B, '#vsFinNote'), /상대가 중간에 나갔어요/);
  assert.equal(await finTitle(B), '승리', '먼저 나간 쪽의 생존 시간이 더 짧다');
  assert.match(await text(B, '#vsFinRematchNote'), /나가서 다시 할 수 없어요/);
  await done();
});

test('349-3 A 가 먼저 달리는 중에 B 가 참가해 시작: A 에게 입장 안내는 한 번만, 막대가 B 를 보여 준다', opts('late-join'), async () => {
  const { A, B, done } = await twoPlayers();
  await createRoom(A);
  await startGame(A); await holdAlive(A);
  await A.eval("window.__toasts = 0; (() => { const t = document.getElementById('vsToast'); new MutationObserver(() => { if (!t.hidden && t.textContent === '상대가 들어왔어요') window.__toasts++; }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true }); })()");
  await H.enterVersus(B);
  await B.waitFor("document.querySelectorAll('#vsList li').length === 1", 8000);
  assert.match(await B.eval("document.querySelector('#vsList li').innerText"), /달리는 중/, '목록에 달리는 중 표시');
  await click(B, '#vsList button[data-room]');
  await B.waitFor("!document.getElementById('vsRoomView').hidden && document.getElementById('vsRoomText').textContent.includes('이미 달리는 중')", 8000);
  await startGame(B); await holdAlive(B);
  await A.waitFor("document.getElementById('vsBarName').textContent.includes('비')", 6000);
  assert.equal(await text(A, '#vsToast'), '상대가 들어왔어요');
  await sleep(5000);
  assert.equal(await A.eval('window.__toasts'), 1, '입장 안내는 한 번만');
  assert.equal(await shown(A, '#vsToast'), false);
  await B.waitFor("document.getElementById('vsBarName').textContent === '에이'", 5000);
  await done();
});

test('349-3 A 가 혼자 끝낸 뒤에는 B 가 참가할 수 없다(목록에서 사라지고, 오래된 목록의 참가는 409 안내 후 새로 고침)', opts('host-finished'), async () => {
  const { A, B, done } = await twoPlayers();
  await createRoom(A);
  await H.enterVersus(B);
  await B.waitFor("document.querySelectorAll('#vsList li').length === 1", 8000);   // B 는 이 목록을 들고 있다
  await startGame(A); await holdAlive(A); await sleep(1200);
  await endRun(A, 10);
  await A.waitFor("!document.getElementById('vsFinView').hidden", 5000);
  await A.waitFor("document.getElementById('vsFinTitle').textContent.includes('상대 없이 끝났어요')", 8000);
  const before = B.reqs.filter(r => r.method === 'GET' && r.path === '/api/versus/rooms').length;
  await B.eval("document.querySelector('#vsList button[data-room]') && document.querySelector('#vsList button[data-room]').click()");   // 목록 갱신 전에 눌렀다면
  await B.waitFor("document.getElementById('vsMsg').textContent === '이미 끝났거나 가득 찬 방이에요.' || document.querySelectorAll('#vsList li').length === 0", 8000);
  await B.waitFor("document.querySelectorAll('#vsList li').length === 0", 8000);
  assert.equal((await api(env.srv, 'B', 'POST', '/rooms/' + await roomIdOf(A) + '/join', {})).status, 409);
  assert.ok(B.reqs.filter(r => r.method === 'GET' && r.path === '/api/versus/rooms').length >= before);
  await done();
});

test('349-4 서버 재시작(게임 중): 게임은 끝까지 달리고 안내는 한 번, 끝나면 "겨루지 못했어요"와 내 기록·방 목록으로', opts('restart-run'), async () => {
  const { A, B, done } = await twoPlayers();
  await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
  await sleep(1200);
  await env.srv.restart();   // 방이 모두 사라진다
  for (const p of [A, B]) {
    await p.waitFor('SpellRun.vs.game.roomGone === true', 8000);
    assert.equal(await text(p, '#vsToast'), '방 연결이 끊겨 기록은 남지 않아요');
    assert.ok(['run', 'intro'].includes(await p.eval('SpellRun.G.state')), '게임은 계속');
  }
  const n = A.reqs.filter(r => r.path.endsWith('/state')).length; await sleep(2500);
  const m = A.reqs.filter(r => r.path.endsWith('/state')).length;
  assert.ok(m - n <= 1, '방이 없으니 신호를 멈춘다: ' + (m - n));
  await sleep(1500);
  await endRun(A, 70);
  await A.waitFor("document.getElementById('vsFinTitle').textContent === '방이 사라져 결과를 겨루지 못했어요.'", 6000);
  assert.match(await A.eval("document.getElementById('vsFinList').innerText"), /점수 70/);
  assert.equal(A.reqs.filter(r => r.path.endsWith('/finish')).length, 0, '사라진 방에는 finish 를 보내지 않는다');
  await click(A, '#vsFinRooms');
  await A.waitFor("!document.getElementById('vsListView').hidden", 5000);
  await done();
});

test('349-4 서버 재시작(결과 대기 중·방 화면·결과 화면): 같은 문구와 목록 복귀', opts('restart-wait'), async () => {
  let t = await twoPlayers();
  await createRoom(t.A); await joinFromList(t.B);
  await startGame(t.A); await startGame(t.B); await holdAlive(t.A);
  await endRun(t.A, 10);   // A 는 끝나 상대를 기다린다, B 는 아직 달린다
  await t.A.waitFor("!document.getElementById('vsFinView').hidden", 5000);
  await sleep(1500);
  await env.srv.restart();
  await t.A.waitFor("document.getElementById('vsFinTitle').textContent === '방이 사라져 결과를 겨루지 못했어요.'", 8000);
  assert.equal(await shown(t.A, '#vsFinRooms'), true);
  await t.done();

  t = await twoPlayers();   // 방 화면(대기)
  await createRoom(t.A);
  await env.srv.restart();
  await t.A.waitFor("document.getElementById('vsMsg').textContent === '방이 사라져 결과를 겨루지 못했어요.'", 8000);
  assert.equal(await shown(t.A, '#vsListView'), true);
  await t.done();

  t = await twoPlayers();   // 결과가 이미 나온 뒤
  await createRoom(t.A); await joinFromList(t.B);
  await startGame(t.A); await startGame(t.B);
  await sleep(1000);
  await Promise.all([endRun(t.A, 1), endRun(t.B, 2)]);
  await bothResult(t.A, t.B);
  await env.srv.restart();
  await t.A.waitFor("document.getElementById('vsFinRematchNote').textContent.includes('방이 사라져')", 8000);
  assert.equal(await shown(t.A, '#vsFinRematch'), false);
  assert.match(await finTitle(t.A), /승리|패배|무승부/, '나온 결과는 그대로');
  await t.done();
});

test('349-4 다시 하기 동시 누름: 같은 순간 눌러도 새 판은 한 번만 열린다(round 2)', opts('rematch-race'), async () => {
  const { A, B, done } = await twoPlayers();
  const id = await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B);
  await sleep(800);
  await Promise.all([endRun(A, 5), endRun(B, 6)]);
  await bothResult(A, B);
  await A.waitFor("!document.getElementById('vsFinRematch').hidden"); await B.waitFor("!document.getElementById('vsFinRematch').hidden");
  // 두 브라우저에서 같은 순간에 요청이 나가도록, 클릭 시각을 맞춘다
  const at = Date.now() + 400;
  await Promise.all([A, B].map(p => p.eval(`new Promise(r => setTimeout(() => { document.getElementById('vsFinRematch').click(); r(Date.now()); }, ${at} - Date.now()))`)));
  await Promise.all([A, B].map(p => p.waitFor("SpellRun.vs.state.round === 2 && !document.getElementById('vsRoomView').hidden", 8000)));
  await sleep(2500);
  const v = await api(env.srv, 'A', 'GET', '/rooms/' + id);
  assert.equal(v.data.round, 2, '새 판은 한 번만'); assert.equal(v.data.result, null);
  const posts = [A, B].map(p => p.reqs.filter(r => r.path.endsWith('/rematch') && r.method === 'POST'));
  assert.equal(posts[0].length + posts[1].length, 2, '다시 하기 요청은 각자 한 번');
  console.log('[측정] 다시 하기 요청 시각 차이(ms): ' + Math.abs(posts[0][0].t - posts[1][0].t));
  await done();
});

test('349-4 늦은 신호: 새 판이 열린 뒤 이전 판 번호의 state·finish·start 는 409 이고 새 판 기록을 건드리지 않는다', opts('late-signal'), async () => {
  const { A, B, done } = await twoPlayers();
  const id = await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B);
  await sleep(800);
  await Promise.all([endRun(A, 5), endRun(B, 6)]);
  await bothResult(A, B);
  await A.waitFor("!document.getElementById('vsFinRematch').hidden"); await B.waitFor("!document.getElementById('vsFinRematch').hidden");
  await click(A, '#vsFinRematch'); await click(B, '#vsFinRematch');
  await Promise.all([A, B].map(p => p.waitFor("SpellRun.vs.state.round === 2 && !document.getElementById('vsRoomView').hidden", 8000)));
  const body = { score: 999, combo: 0, hp: 5, maxHp: 5, wordNo: 9, continued: false, round: 1 };
  let r = await api(env.srv, 'A', 'POST', `/rooms/${id}/state`, body);
  assert.equal(r.status, 409); assert.equal(r.data.code, 'round_mismatch');
  r = await api(env.srv, 'A', 'POST', `/rooms/${id}/finish`, { survivalSec: 3, score: 999, wordCount: 3, continued: false, round: 1 });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'round_mismatch');
  r = await api(env.srv, 'B', 'POST', `/rooms/${id}/start`, { wordCount: 12, round: 1 });
  assert.equal(r.status, 409);
  const v = (await api(env.srv, 'A', 'GET', '/rooms/' + id)).data;
  assert.deepEqual([v.round, v.me.started, v.me.score, v.me.finished, v.opponent.running, v.result], [2, false, 0, false, false, null], '새 판 기록 그대로');
  // 화면은 최신 판의 준비 화면에 머문다
  assert.equal(await roundOf(A), 2); assert.equal(await shown(A, '#vsRoomView'), true);
  await done();
});

test('349-4 결과 전송 실패: finish 를 막으면 다시 보내기·그냥 나가기가 나오고, 막힘을 풀고 다시 보내면 결과로 이어진다', opts('finish-fail'), async () => {
  const { A, B, done } = await twoPlayers();
  const id = await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A);
  await A.eval("(() => { const f = window.fetch; window.__block = true; window.fetch = function (u, o) { if (window.__block && /\\/finish$/.test(String(u))) return Promise.reject(new TypeError('blocked')); return f.apply(this, arguments); }; })()");
  await sleep(800);
  await endRun(A, 40);
  await A.waitFor("document.getElementById('vsFinNote').textContent.includes('보내지 못했어요')", 8000);
  assert.deepEqual(await A.eval("[...document.querySelectorAll('#vsFinView button:not([hidden])')].map(b => b.textContent)"), ['다시 보내기', '그냥 나가기', '대결 화면 닫기']);
  assert.equal((await api(env.srv, 'A', 'GET', '/rooms/' + id)).data.me.finished, false, '서버에는 아직 기록 없음');
  await A.eval('window.__block = false');
  await click(A, '#vsFinRetry');
  await A.waitFor("document.getElementById('vsFinRetry').hidden", 6000);
  assert.equal((await api(env.srv, 'A', 'GET', '/rooms/' + id)).data.me.finished, true);
  await endRun(B, 80);
  await Promise.all([resultShown(A), resultShown(B)]);
  assert.equal(OPP[await finTitle(A)], await finTitle(B));
  await done();
});

test('349-4 게임 중 나가기: 확인창이 열린 동안 게임 시간이 멈추고(신호는 계속), Esc 는 계속 달리기, 확인하면 leave 후 목록. 상대에게는 나감으로 보인다', opts('quit-dialog'), async () => {
  const { A, B, done } = await twoPlayers();
  const id = await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
  await sleep(1000);
  await click(A, '#vsQuitBtn');
  assert.equal(await A.eval('document.activeElement.id'), 'vsQuitStay');
  const t0 = await surv(A), s0 = A.reqs.filter(r => r.path.endsWith('/state')).length;
  await sleep(2500);
  const t1 = await surv(A);
  assert.ok(Math.abs(t1 - t0) < 0.03, '확인창 동안 시간 정지: ' + (t1 - t0));
  assert.ok(A.reqs.filter(r => r.path.endsWith('/state')).length > s0, '상태 신호는 계속');
  assert.equal((await api(env.srv, 'A', 'GET', '/rooms/' + id)).data.me.disconnected, false);
  await A.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
  assert.equal(await shown(A, '#vsQuit'), false);
  await sleep(600);
  assert.ok((await surv(A)) - t1 > 0.4, '재개');
  await click(A, '#vsQuitBtn'); await click(A, '#vsQuitGo');
  await A.waitFor("!document.getElementById('vsListView').hidden", 5000);
  assert.equal(A.reqs.filter(r => r.path.endsWith('/leave')).length, 1);
  const v = (await api(env.srv, 'B', 'GET', '/rooms/' + id)).data;
  assert.deepEqual([v.opponent.left, v.opponent.finished], [true, true]);
  await B.waitFor("document.getElementById('vsBarName').textContent.includes('나감')", 5000);
  await done();
});
