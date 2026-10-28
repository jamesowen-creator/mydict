// 작업348: 대결 서버의 다시 하기(rematch)와 판 번호(round). 모의 DB(users)와 주입한 시계만 쓴다 — 운영 서버·DB·외부 API 와 무관.
// 실행: node --test tests/versus_rematch.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'u9@example.com';
const { startApp } = require('./helpers/app');

const T0 = 1000000;
function createDb() {
  const users = new Map();
  for (const [id, name] of [[1, 'Alice'], [2, 'Bob'], [5, 'Eve'], [20, 'P20'], [21, 'P21'], [30, 'P30'], [31, 'P31'], [32, 'P32'], [33, 'P33']]) users.set(id, { name, role: 'user', is_blocked: false, perm_versus: true });
  return {
    pool: { query: async (sql, params = []) => {
      if (/^SELECT name, role, is_blocked, perm_versus FROM users/.test(sql)) { const u = users.get(params[0]); return { rows: u ? [u] : [] }; }
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 60));
    } },
    trackUsage: () => {},
  };
}
async function setup() {
  const t = await startApp(['routes/versus.js'], { db: createDb() });
  const router = require('../routes/versus.js');
  const clock = { t: T0 };
  router.store.setClock(() => clock.t);
  router.store.rateLimited = () => false;
  const api = (user, method, url, body) => t.call(method, '/api/versus' + url, body, { user });
  const a = { t, clock, store: router.store, post: (u, url, b) => api(u, 'POST', url, b), get: (u, url) => api(u, 'GET', url) };
  a.room = async (host = 1, guest = 2) => {   // 둘 다 시작한 상태
    const id = (await a.post(host, '/rooms')).body.roomId; await a.post(guest, `/rooms/${id}/join`);
    await a.post(host, `/rooms/${id}/start`, { wordCount: 10 }); await a.post(guest, `/rooms/${id}/start`, { wordCount: 10 });
    return id;
  };
  a.fin = (u, id, sec, score, extra) => a.post(u, `/rooms/${id}/finish`, Object.assign({ survivalSec: sec, score, wordCount: 10, continued: false }, extra));
  a.finished = async (host = 1, guest = 2) => {   // 둘 다 끝나 결과가 나온 방(방장 20초·300점, 참가자 8초·100점)
    const id = await a.room(host, guest);
    a.clock.t += 10000;
    await a.post(host, `/rooms/${id}/state`, ST({ score: 300, wordNo: 6 })); await a.post(guest, `/rooms/${id}/state`, ST({ score: 100, wordNo: 3, hp: 0, continued: true }));
    await a.fin(host, id, 10, 300); await a.fin(guest, id, 8, 100, { continued: true, wordCount: 3 });
    return id;
  };
  return a;
}
const ST = o => Object.assign({ score: 0, combo: 0, hp: 5, maxHp: 5, wordNo: 0, continued: false }, o);

test('348-S1. view: 첫 판 round 1, rematch {me, opponent, available} 추가. 기존 필드는 그대로(하위 호환)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = (await a.post(1, '/rooms')).body.roomId;
  const v0 = (await a.get(1, `/rooms/${id}`)).body;
  assert.equal(v0.round, 1); assert.deepEqual(v0.rematch, { me: false, opponent: false, available: false });
  for (const k of ['ok', 'room', 'me', 'opponent', 'result']) assert.ok(k in v0, k);
  assert.deepEqual(Object.keys(v0.room).sort(), ['ageSec', 'id', 'isHost', 'status']);
  const fid = await a.finished(30, 31);
  const v = (await a.get(30, `/rooms/${fid}`)).body;
  assert.equal(v.room.status, 'finished'); assert.equal(v.rematch.available, true);
  assert.deepEqual(Object.keys(v.result).sort(), ['diffSec', 'leftMid', 'me', 'opponent', 'reason', 'winner']);
  assert.deepEqual(v.result.leftMid, { me: false, opponent: false });
});

test('348-S2. 한쪽만 다시 하기: 409 가 아니고 view 에 내 표시/상대 표시, 같은 호출은 멱등, 새 판은 열리지 않는다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.finished();
  const r1 = await a.post(1, `/rooms/${id}/rematch`); assert.equal(r1.status, 200);
  assert.deepEqual(r1.body.rematch, { me: true, opponent: false, available: true }); assert.equal(r1.body.round, 1); assert.equal(r1.body.room.status, 'finished'); assert.ok(r1.body.result);
  const r2 = await a.post(1, `/rooms/${id}/rematch`); assert.equal(r2.status, 200); assert.deepEqual(r2.body.rematch, r1.body.rematch, '멱등'); assert.equal(r2.body.round, 1);
  const other = (await a.get(2, `/rooms/${id}`)).body; assert.deepEqual(other.rematch, { me: false, opponent: true, available: true }, '상대 쪽에서는 반대로 보인다');
});

test('348-S3. 양쪽 모두 다시 하기: 새 판(round +1), 점수·체력·단어 번호·이어하기·시작 시각·종료 정보·결과 초기화, 이름 유지, 상태 full, 표시 초기화', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.finished();
  await a.post(1, `/rooms/${id}/rematch`);
  const r = await a.post(2, `/rooms/${id}/rematch`); assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.round, 2); assert.equal(b.room.status, 'full'); assert.equal(b.result, null); assert.deepEqual(b.rematch, { me: false, opponent: false, available: false });
  assert.equal(b.me.name, 'Bob'); assert.equal(b.opponent.name, 'Alice', '이름 유지');
  assert.deepEqual([b.me.score, b.me.combo, b.me.hp, b.me.maxHp, b.me.wordNo, b.me.wordCount, b.me.started, b.me.finished, b.me.continued, b.me.disconnected, b.me.left, b.me.running, b.me.survivalSec],
    [0, 0, 0, 0, 0, 0, false, false, false, false, false, false, null]);
  assert.deepEqual(b.opponent, { name: 'Alice', hp: 0, maxHp: 0, score: 0, combo: 0, wordNo: 0, running: false, finished: false, continued: false, disconnected: false, left: false });
  const p = a.store._rooms.get(id);
  for (const q of [p.host, p.guest]) assert.deepEqual([q.startedAt, q.survivalSec, q.finalScore, q.rematch], [0, 0, 0, false]);
  assert.equal(p.finishedAt, 0);
  // 새 판은 다시 시작·진행·종료·판정이 된다(규칙은 그대로)
  assert.equal((await a.post(1, `/rooms/${id}/start`, { wordCount: 10, round: 2 })).status, 200); assert.equal((await a.post(2, `/rooms/${id}/start`, { wordCount: 10, round: 2 })).status, 200);
  a.clock.t += 5000;
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 50, wordNo: 2, round: 2 }))).status, 200);
  await a.fin(1, id, 5, 50, { round: 2 }); await a.fin(2, id, 5, 80, { round: 2 });
  const end = (await a.get(1, `/rooms/${id}`)).body; assert.equal(end.room.status, 'finished'); assert.deepEqual([end.result.winner, end.result.reason], ['opponent', 'score']);
  assert.equal(end.round, 2);
  // 세 번째 판도 같은 방에서
  await a.post(1, `/rooms/${id}/rematch`); assert.equal((await a.post(2, `/rooms/${id}/rematch`)).body.round, 3);
});

test('348-S4. 다시 하기 조건: 진행 중(full)·열린 방은 409, 상대가 나갔으면 409, 상대 신호가 끊겼으면 409(한국어 사유), 방 없음 404·비참가자 403', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const run = await a.room();
  const e0 = await a.post(1, `/rooms/${run}/rematch`); assert.equal(e0.status, 409); assert.match(e0.body.error, /아직 판이 끝나지 않았어요/);
  const open = (await a.post(20, '/rooms')).body.roomId; assert.equal((await a.post(20, `/rooms/${open}/rematch`)).status, 409);
  // 상대가 나감
  const left = await a.finished(5, 21); await a.post(21, `/rooms/${left}/leave`);
  const e1 = await a.post(5, `/rooms/${left}/rematch`); assert.equal(e1.status, 409); assert.match(e1.body.error, /나가서 다시 할 수 없어요/);
  const v1 = (await a.get(5, `/rooms/${left}`)).body; assert.equal(v1.rematch.available, false); assert.equal(v1.opponent.left, true);
  // 나간 사람 본인도 다시 하기 불가
  assert.equal((await a.post(21, `/rooms/${left}/rematch`)).status, 409);
  // 상대 신호 끊김: 결과 화면에서 상대가 30초 넘게 조회하지 않았다
  const off = await a.finished(30, 31); a.clock.t += 31000;
  await a.get(30, `/rooms/${off}`);   // 방장만 조회(신호), 참가자는 없음
  const e2 = await a.post(30, `/rooms/${off}/rematch`); assert.equal(e2.status, 409); assert.match(e2.body.error, /연결이 끊겨/);
  assert.equal((await a.get(30, `/rooms/${off}`)).body.rematch.available, false);
  assert.equal((await a.post(1, `/rooms/${'1'.repeat(24)}/rematch`)).status, 404); assert.equal((await a.post(20, `/rooms/${off}/rematch`)).status, 403);
  assert.equal((await a.post(null, `/rooms/${off}/rematch`)).status, 401);
});

test('348-S5. 끊김으로 종료 처리된 사람이 돌아오면(조회·신호) 다시 하기가 가능하다. 끊김 종료의 단어 수는 마지막 상태 기준', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.room();
  a.clock.t += 20000; await a.post(1, `/rooms/${id}/state`, ST({ score: 400, wordNo: 5 })); await a.post(2, `/rooms/${id}/state`, ST({ score: 100, wordNo: 2 }));
  a.clock.t += 31000;   // 방장은 신호가 없다 → 끊김. 참가자는 조회
  const mid = (await a.get(2, `/rooms/${id}`)).body; assert.equal(mid.opponent.disconnected, true);
  await a.fin(2, id, 51, 100, { wordCount: 2 });
  const end = (await a.get(2, `/rooms/${id}`)).body; assert.equal(end.room.status, 'finished'); assert.equal(end.result.opponent.disconnected, true);
  assert.deepEqual([end.result.opponent.score, end.result.opponent.wordCount], [400, 4], '마지막으로 알린 점수와 푼 단어 수(단어 번호 5 → 4개)');
  // 방장이 돌아와 결과를 조회하고 다시 하기를 누른다(참가자도 계속 조회 중)
  a.clock.t += 5000;
  assert.equal((await a.get(1, `/rooms/${id}`)).body.me.disconnected, true, '끊김 표시는 결과에 남는다');
  const r = await a.post(1, `/rooms/${id}/rematch`); assert.equal(r.status, 200); assert.equal(r.body.rematch.me, true);
  const n = await a.post(2, `/rooms/${id}/rematch`); assert.equal(n.body.round, 2); assert.equal(n.body.opponent.disconnected, false, '새 판은 끊김 표시도 초기화');
});

test('348-S6. 이전 판 번호의 늦은 start/state/finish 는 409(code round_mismatch)이고 새 판 기록을 바꾸지 않는다. 형식이 틀린 round 는 400', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.finished();
  await a.post(1, `/rooms/${id}/rematch`); await a.post(2, `/rooms/${id}/rematch`);
  await a.post(1, `/rooms/${id}/start`, { wordCount: 10, round: 2 }); a.clock.t += 1000;
  const before = JSON.stringify((await a.get(1, `/rooms/${id}`)).body.me);
  const s = await a.post(1, `/rooms/${id}/state`, ST({ score: 999, wordNo: 9, round: 1 })); assert.equal(s.status, 409); assert.equal(s.body.code, 'round_mismatch'); assert.match(s.body.error, /이전 판/);
  const f = await a.fin(1, id, 3, 999, { round: 1 }); assert.equal(f.status, 409); assert.equal(f.body.code, 'round_mismatch');
  const st = await a.post(2, `/rooms/${id}/start`, { wordCount: 10, round: 1 }); assert.equal(st.status, 409); assert.equal(st.body.code, 'round_mismatch');
  assert.equal(a.store._rooms.get(id).guest.started, false, '늦은 start 는 새 판을 시작시키지 않는다');
  assert.equal(JSON.stringify((await a.get(1, `/rooms/${id}`)).body.me).replace(/"serverElapsedSec":[0-9.]+/, ''), before.replace(/"serverElapsedSec":[0-9.]+/, ''), '내 기록 그대로');
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 5, wordNo: 1, round: 3 }))).status, 409, '미래 판 번호도 불일치');
  for (const bad of [0, -1, 1.5, '2', true]) assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ round: bad }))).status, 400, 'round=' + JSON.stringify(bad));
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 10, wordNo: 1, round: 2 }))).status, 200, '현재 판 번호는 통과');
  // 이미 끝난 사람의 이전 판 finish 재전송이 멱등으로 새 판 결과를 만들지 않는다
  await a.fin(1, id, 3, 10, { round: 2 }); assert.equal((await a.fin(1, id, 3, 10, { round: 1 })).status, 409);
});

test('348-S7. 하위 호환: round 없는 start/state/finish 는 예전처럼 동작하고, 에러 본문의 code 는 있을 때만 붙는다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.room();   // round 없이 start
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 5, wordNo: 1 }))).status, 200);
  assert.equal((await a.fin(1, id, 1, 5)).status, 200); await a.fin(2, id, 1, 5);
  assert.equal((await a.get(1, `/rooms/${id}`)).body.room.status, 'finished');
  // round 가 null 이어도 없는 것으로 본다
  const id2 = await a.room(5, 21);
  assert.equal((await a.post(5, `/rooms/${id2}/state`, ST({ round: null }))).status, 200);
  // 예전 오류 본문 모양: {error} (code 없음)
  const e = await a.post(5, `/rooms/${id2}/state`, ST({ hp: 11 })); assert.deepEqual(Object.keys(e.body), ['error']);
  assert.deepEqual(Object.keys((await a.post(20, `/rooms/${id2}/join`)).body).sort(), ['code', 'error'], '가득 찬 방 참가 409 는 code 가 덧붙는다');
  assert.equal((await a.post(20, `/rooms/${id2}/join`)).body.code, 'unavailable');
  const mine = (await a.post(20, '/rooms')).body.roomId; const dup = await a.post(20, '/rooms'); assert.equal(dup.status, 409); assert.equal(dup.body.code, 'has_room'); assert.ok(mine);
  // 다시 하기를 모르는 예전 클라이언트가 보는 필드는 그대로
  const v = (await a.get(1, `/rooms/${id}`)).body;
  assert.deepEqual(Object.keys(v.me).sort(), ['combo', 'continued', 'disconnected', 'finished', 'hp', 'left', 'maxHp', 'name', 'running', 'score', 'serverElapsedSec', 'started', 'survivalSec', 'wordCount', 'wordNo']);
});

test('348-S8. 나가기: 판 도중 나가면 result.leftMid 로 표시되고 서버가 기록한 점수·푼 단어 수로 종료. 끝난 뒤 나가면 표시 없음', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.room();
  a.clock.t += 4000; await a.post(2, `/rooms/${id}/state`, ST({ score: 70, wordNo: 4 }));
  await a.post(2, `/rooms/${id}/leave`);
  a.clock.t += 3000; await a.fin(1, id, 7, 20);
  const v = (await a.get(1, `/rooms/${id}`)).body;
  assert.deepEqual(v.result.leftMid, { me: false, opponent: true }); assert.deepEqual([v.result.opponent.score, v.result.opponent.wordCount], [70, 3]); assert.equal(v.opponent.left, true);
  const id2 = await a.finished(5, 21); await a.post(21, `/rooms/${id2}/leave`);
  assert.deepEqual((await a.get(5, `/rooms/${id2}`)).body.result.leftMid, { me: false, opponent: false }, '끝난 뒤 나간 것은 중간에 나간 것이 아니다');
});

test('348-S9. 정리 기준: 새 판이 열리면 finished 10분 기준이 사라지고 새 판의 5분 무신호 기준이 새로 시작된다. 결과 화면 대기 중 조회는 정리 기준을 늘리지 않는다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.finished();
  a.clock.t += 9 * 60000;   // 결과 후 9분. 양쪽이 조회하며 기다렸다
  await a.get(1, `/rooms/${id}`); await a.get(2, `/rooms/${id}`);
  await a.post(1, `/rooms/${id}/rematch`); await a.post(2, `/rooms/${id}/rematch`);
  assert.equal(a.store._rooms.get(id).round, 2);
  a.clock.t += 2 * 60000; a.store.sweep(); assert.equal(a.store._rooms.has(id), true, '첫 판 종료 기준 10분이 지났어도 새 판은 사라지지 않는다(11분 경과, 새 판 2분)');
  a.clock.t += 4 * 60000; a.store.sweep(); assert.equal(a.store._rooms.has(id), false, '새 판 시작 후 6분 무신호면 기존 규칙(5분)대로 정리');
  // 결과 화면에서 기다리기만 하면 10분 뒤에 사라진다(기존 규칙 유지)
  a.clock.t = T0 + 100 * 60000; const id2 = await a.finished(5, 21);
  for (let i = 0; i < 9; i++) { a.clock.t += 60000; await a.get(5, `/rooms/${id2}`); await a.get(21, `/rooms/${id2}`); }
  a.store.sweep(); assert.equal(a.store._rooms.has(id2), true);
  a.clock.t += 2 * 60000; a.store.sweep(); assert.equal(a.store._rooms.has(id2), false, '종료 후 10분 규칙 그대로');
  assert.equal((await a.post(5, `/rooms/${id2}/rematch`)).status, 404, '사라진 방의 다시 하기는 404');
});

test('348-S10. 방 수 상한 50·요청 수 상한은 다시 하기에도 적용된다(새 판이 방을 늘리지 않는다)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.finished();
  await a.post(1, `/rooms/${id}/rematch`); await a.post(2, `/rooms/${id}/rematch`);
  assert.equal(a.store.size(), 1, '새 판은 같은 방');
  assert.equal((await a.post(1, '/rooms')).status, 409, '새 판이 열린 방의 참가자는 방을 또 만들 수 없다');
  const real = require('../lib/versus').createStore({ now: () => a.clock.t });
  const rs = []; for (let i = 0; i < 11; i++) rs.push(real.rateLimited(77));
  assert.deepEqual(rs.slice(9), [false, true], '요청 수 상한 규칙 그대로(초당 10회)');
});
