// 작업349: 대결 통합 시험(2/2) — 실제 시간이 걸리는 것: 끊김(30초), 요청량(60초), 앱 전환 흉내(숨김·pagehide).
// 실제 server.js(자식 프로세스) + 브라우저 2개(서로 다른 프로필). 운영 서버·DB·외부 API 는 쓰지 않는다. 설명은 helpers/harness.js 머리말.
// 앱 전환은 브라우저에서 document.hidden·visibilitychange·pagehide 를 흉내 낸 것이다. 실제 폰의 동작과 다를 수 있다(추정).
// 실행: node --test tests/e2e/versus_slow.e2e.js
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { SKIP, click, text, shown, roomIdOf, roundOf, createRoom, joinFromList, holdAlive, endRun, hideTab, showTab, resultShown, finTitle, closePlayer, startGame, sleep, api } = H;
const { LIMITS } = require('../../lib/versus');

const KNOWN = {};
const opts = (name, extra) => Object.assign({ skip: SKIP || KNOWN[name] || false, timeout: 240000 }, extra);

let env;
test.before(async () => { if (!SKIP) env = await H.setup(); });
test.after(async () => { if (env) await env.close(); });
async function twoPlayers(o = {}) {
  await env.srv.restart();
  const A = await H.openPlayer(env.bA, 'A', env.srv, o.A || {}), B = await H.openPlayer(env.bB, 'B', env.srv, o.B || {});
  return { A, B, done: async () => { await closePlayer(env.bA, A); await closePlayer(env.bB, B); } };
}
const sendState = (page, score, wi) => page.eval(`(() => { const G = SpellRun.G; G.score = ${score}; G.wi = ${wi}; G.hp = 4; SpellRun.vs.renderHearts(); })()`);

test('349-4 끊김: B 화면을 30초 넘게 숨기면 서버가 B 를 끊김으로 종료, A 막대에 "연결 끊김", B 복귀 시 "연결이 끊겨 종료됐어요"와 마지막 점수·푼 단어 수, 결과에도 끊김 표시', opts('disc-b'), async () => {
  const { A, B, done } = await twoPlayers();
  const id = await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
  await B.eval('SpellRun.manual = true');
  const wi = await B.eval('Math.min(2, SpellRun.G.words.length - 1)');
  await sendState(B, 400, wi);
  await A.waitFor("document.getElementById('vsBarStats').textContent.includes('점수 400')", 6000);
  await hideTab(B);   // 이 시점부터 B 는 신호를 보내지 않는다
  const t0 = Date.now();
  await A.waitFor("document.getElementById('vsBarName').textContent.includes('연결 끊김')", 45000);
  const sec = (Date.now() - t0) / 1000;
  console.log('[측정] B 가 숨겨진 뒤 A 막대에 "연결 끊김"이 뜨기까지 ' + sec.toFixed(1) + '초 (서버 기준 ' + LIMITS.SIGNAL_TIMEOUT_MS / 1000 + '초 + A 의 신호 주기)');
  assert.ok(sec >= 28 && sec <= 40, '30초 안팎: ' + sec);
  const v = (await api(env.srv, 'A', 'GET', '/rooms/' + id)).data;
  assert.deepEqual([v.opponent.disconnected, v.opponent.finished, v.opponent.score], [true, true, 400]);
  // B 복귀
  await showTab(B);
  await B.waitFor("!document.getElementById('vsFinView').hidden", 8000);
  assert.equal(await B.eval('SpellRun.G.state'), 'over');
  assert.match(await text(B, '#vsFinNote'), /연결이 끊겨 종료됐어요/);
  const list = await B.eval("document.getElementById('vsFinList').innerText");
  assert.match(list, /점수 400/); assert.match(list, new RegExp('푼 단어 ' + wi + '개')); assert.match(list, /연결 끊김/);
  assert.equal(B.reqs.filter(r => r.path.endsWith('/finish')).length, 0, '서버가 이미 끝낸 판이라 finish 를 보내지 않는다');
  // A 가 끝나면 결과(끊김 표시)와 다시 하기 안내
  await endRun(A, 900);
  await Promise.all([resultShown(A), resultShown(B)]);
  assert.equal(await finTitle(A), '승리'); assert.equal(await finTitle(B), '패배');
  assert.match(await text(B, '#vsFinNote'), /연결이 끊겨 종료됐어요/);
  assert.match(await A.eval("document.getElementById('vsFinList').innerText"), /연결 끊김/);
  await A.waitFor("!document.getElementById('vsFinRematch').hidden", 5000); await B.waitFor("!document.getElementById('vsFinRematch').hidden", 5000);
  await done();
});

test('349-4 늦은 신호(화면 동기화): A 가 숨겨진 동안 새 판이 열리면, A 가 돌아와 이전 판 번호로 보낸 신호가 409 로 막히고 A 화면이 새 판 준비 화면으로 맞춰진다', opts('disc-sync'), async () => {
  const { A, B, done } = await twoPlayers();
  const id = await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
  await hideTab(A);   // A 는 신호를 멈춘다
  await endRun(B, 50);
  await B.waitFor("!document.getElementById('vsFinView').hidden", 5000);
  await B.waitFor("document.getElementById('vsFinList').innerText.includes('연결 끊김')", 45000);   // 서버가 A 를 끊김으로 종료 처리 → 결과가 나온다
  await resultShown(B);
  assert.equal(await finTitle(B), '승리');
  // A 가 신호를 멈춘 지 30초가 넘었으니 이대로는 다시 하기가 막혀 있다(상대 연결 끊김). A 사람이 다른 기기에서 방을 조회한 것처럼 서버에 직접 신호를 준다
  assert.match(await text(B, '#vsFinRematchNote'), /연결이 끊겨/);
  await api(env.srv, 'A', 'GET', '/rooms/' + id);
  await B.waitFor("!document.getElementById('vsFinRematch').hidden", 5000);
  await click(B, '#vsFinRematch');
  // A 의 화면은 아직 1판 달리기에 있다. A 사람의 다시 하기는 서버에 직접 보낸다(실제로는 다른 기기에서 돌아온 경우에 해당)
  const rm = await api(env.srv, 'A', 'POST', `/rooms/${id}/rematch`, {});
  assert.equal(rm.status, 200, JSON.stringify(rm.data));
  for (let i = 0; i < 40 && (await api(env.srv, 'A', 'GET', '/rooms/' + id)).data.round !== 2; i++) await sleep(100);   // B 의 요청이 닿으면 새 판이 열린다
  assert.equal((await api(env.srv, 'A', 'GET', '/rooms/' + id)).data.round, 2);
  assert.equal(await A.eval('SpellRun.vs.game.round'), 1); assert.equal(await A.eval("SpellRun.G.state !== 'over'"), true);
  await showTab(A);
  await A.waitFor("SpellRun.vs.state.round === 2 && !document.getElementById('vsRoomView').hidden", 8000);
  assert.equal(await A.eval("SpellRun.G.state"), 'over', '이전 판 게임은 멈춤');
  assert.equal(await shown(A, '#vsBar'), false);
  const late = A.reqs.filter(r => r.path.endsWith('/state') && r.status === 409);
  assert.ok(late.length >= 1, 'A 의 이전 판 신호가 409 를 받았다');
  await B.waitFor("SpellRun.vs.state.round === 2 && !document.getElementById('vsRoomView').hidden", 8000);
  await done();
});

test('349-5 요청량: 두 사람이 60초 달리는 동안 계정별 초당 요청 수와 경로별 횟수, 429 여부', opts('load'), async () => {
  const { A, B, done } = await twoPlayers();
  await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
  const from = Date.now();
  await sleep(60000);
  const to = Date.now();
  const out = {};
  const lines = [];
  for (const p of [A, B]) {
    const rs = p.reqs.filter(r => r.t >= from && r.t < to);
    const perSec = new Map(); for (const r of rs) { const k = Math.floor((r.t - from) / 1000); perSec.set(k, (perSec.get(k) || 0) + 1); }
    let max = 0; for (const v of perSec.values()) max = Math.max(max, v);
    // 어느 1초 구간(슬라이딩)에서든 최대 요청 수(서버 상한은 시계 기준 1초 창)
    let slide = 0; for (let i = 0; i < rs.length; i++) { let n = 0; for (let j = i; j < rs.length && rs[j].t - rs[i].t < 1000; j++) n++; slide = Math.max(slide, n); }
    const byPath = {}; for (const r of rs) { const k = r.method + ' ' + r.path.replace('/api/versus/rooms', ''); byPath[k] = (byPath[k] || 0) + 1; }
    const r429 = rs.filter(r => r.status === 429).length, nonOk = rs.filter(r => r.status !== 200).length;
    out[p.who] = { total: rs.length, avg: rs.length / ((to - from) / 1000), max, slide, byPath, r429, nonOk };
    lines.push(`[측정] 계정 ${p.who}: 60초 ${rs.length}건, 평균 초당 ${(rs.length / ((to - from) / 1000)).toFixed(2)}, 초 단위 최대 ${max}, 1초 창 최대 ${slide}, 429 ${r429}건, 200 아님 ${nonOk}건, 경로 ${JSON.stringify(byPath)}`);
  }
  lines.push(`[측정] 서버 상한: 사용자당 초당 ${LIMITS.RATE_PER_SEC}회(lib/versus.js LIMITS.RATE_PER_SEC)`);
  console.log(lines.join('\n'));
  for (const w of ['A', 'B']) { assert.equal(out[w].r429, 0, w + ' 429 없음'); assert.ok(out[w].slide <= LIMITS.RATE_PER_SEC, w + ' 1초 창 최대가 상한 이내: ' + out[w].slide); }
  await done();
});

test('349-6 앱 전환 흉내: 달리는 중 화면 숨김 → 10초 뒤 복귀. leave 가 나가지 않고, 복귀 즉시 신호를 보내며, 방에 남아 있다(흉내 결과, 추정)', opts('switch'), async () => {
  const { A, B, done } = await twoPlayers();
  const id = await createRoom(A); await joinFromList(B);
  await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
  await sleep(1500);
  await hideTab(A);
  const n0 = A.reqs.filter(r => r.path.endsWith('/state')).length;
  await sleep(10000);
  assert.equal(A.reqs.filter(r => r.path.endsWith('/state')).length, n0, '숨겨진 동안 신호 없음');
  assert.equal(A.reqs.filter(r => r.path.endsWith('/leave')).length, 0, '숨김만으로는 leave 없음');
  const t = Date.now(); await showTab(A);
  for (let i = 0; i < 40 && A.reqs.filter(r => r.path.endsWith('/state') && r.t >= t).length < 1; i++) await sleep(50);
  const first = A.reqs.filter(r => r.path.endsWith('/state') && r.t >= t)[0];
  assert.ok(first && first.t - t < 1000, '복귀 즉시 신호: ' + (first && first.t - t) + 'ms');
  const v = (await api(env.srv, 'A', 'GET', '/rooms/' + id)).data;
  assert.deepEqual([v.me.left, v.me.disconnected, v.me.finished], [false, false, false], '10초 숨김은 끊김(30초)이 아니다');
  assert.equal(await A.eval("SpellRun.G.state !== 'over'"), true);
  await done();
});

// pagehide: persisted=false 는 페이지가 닫히는 것, persisted=true 는 뒤로 가기 캐시(bfcache)로 들어가 되돌아올 수 있는 것.
for (const persisted of [false, true]) {
  test(`349-6 pagehide(persisted=${persisted}) 흉내: ` + (persisted ? '캐시에 들어갔다 돌아올 수 있으므로 방을 나가지 않고, 돌아와서도 방에 남아 있어야 한다(기대)' : '닫히는 것이므로 leave 가 나간다'), opts('pagehide-' + persisted), async () => {
    const { A, B, done } = await twoPlayers();
    const id = await createRoom(A); await joinFromList(B);
    await startGame(A); await startGame(B); await holdAlive(A); await holdAlive(B);
    await sleep(1200);
    await A.eval(`window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: ${persisted} }))`);
    await sleep(800);
    const leaves = A.reqs.filter(r => r.path.endsWith('/leave')).length;
    const v = (await api(env.srv, 'A', 'GET', '/rooms/' + id)).data;
    console.log(`[흉내 결과] pagehide persisted=${persisted}: leave 요청 ${leaves}건, 서버에서 A 의 left=${v.me.left}`);
    if (persisted) {
      const t = Date.now();
      await A.eval("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))");
      for (let i = 0; i < 30 && !A.reqs.some(r => r.path.endsWith('/state') && r.t >= t); i++) await sleep(50);
      const first = A.reqs.find(r => r.path.endsWith('/state') && r.t >= t);
      assert.ok(first && first.t - t < 1000, '돌아온 뒤 1초 안에 상태 신호: ' + (first && first.t - t));
      assert.equal(await A.eval("SpellRun.G.state !== 'over'"), true, '게임 계속');
      await sleep(1000);
      const v2 = (await api(env.srv, 'A', 'GET', '/rooms/' + id)).data;
      assert.equal(v2.me.left, false, '돌아온 뒤에도 방에 남아 있어야 한다');
      assert.equal(leaves, 0);
    } else {
      assert.equal(leaves, 1); assert.equal(v.me.left, true);
    }
    await done();
  });
}
