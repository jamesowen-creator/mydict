// 작업343: 2인 대결 서버(routes/versus.js, lib/versus.js) 시험. 모의 DB(users)와 주입한 시계만 쓴다 — 운영 서버·DB·외부 API 와 무관.
// 실행: node --test tests/versus.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_EMAILS = 'u9@example.com';
const { startApp } = require('./helpers/app');

const T0 = 1000000;
function createDb() {
  const db = { users: new Map(), failPerm: false, queries: 0, patches: [] };
  const mk = (name, extra) => Object.assign({ name, role: 'user', is_blocked: false, perm_versus: true }, extra);
  db.users.set(1, mk('Alice')); db.users.set(2, mk('Bob')); db.users.set(3, mk('Carol', { perm_versus: false })); db.users.set(4, mk('Dana', { role: 'admin', perm_versus: false }));
  db.users.set(5, mk('Eve')); db.users.set(6, mk('Fay', { is_blocked: true })); db.users.set(9, mk('Root', { perm_versus: false })); db.users.set(7, mk('alice@example.com'));
  for (let i = 20; i < 90; i++) db.users.set(i, mk('P' + i));
  db.pool = {
    query: async (sql, params = []) => {
      db.queries++;
      if (/^SELECT name, role, is_blocked, perm_versus FROM users/.test(sql)) { if (db.failPerm) throw new Error('perm boom'); const u = db.users.get(params[0]); return { rows: u ? [u] : [] }; }
      if (/^UPDATE users SET/.test(sql)) { db.patches.push(sql); return { rows: [{ id: params[0] }] }; }
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 60));
    },
  };
  db.trackUsage = () => {};
  return db;
}
async function setup() {
  const db = createDb();
  const t = await startApp(['routes/versus.js'], { db });
  const router = require('../routes/versus.js');   // startApp 이 방금 불러온 같은 모듈
  const clock = { t: T0 };
  router.store.setClock(() => clock.t);
  const api = (user, method, url, body) => t.call(method, '/api/versus' + url, body, { user });
  const realRate = router.store.rateLimited; router.store.rateLimited = () => false;   // 대부분의 시험은 같은 순간에 많이 부르므로 속도 제한은 343-10 에서만 켠다
  const a = { db, t, clock, store: router.store, realRate, api, post: (u, url, b) => api(u, 'POST', url, b), get: (u, url) => api(u, 'GET', url) };
  a.room = async (host = 1, guest = 2, { start = true } = {}) => {   // 방장이 만들고 참가자가 참가하고 둘 다 시작한 상태(시각 T0)
    const r = await a.post(host, '/rooms'); const id = r.body.roomId; await a.post(guest, `/rooms/${id}/join`);
    if (start) { await a.post(host, `/rooms/${id}/start`, { wordCount: 10 }); await a.post(guest, `/rooms/${id}/start`, { wordCount: 10 }); }
    return id;
  };
  a.fin = (u, id, sec, score, extra) => a.post(u, `/rooms/${id}/finish`, Object.assign({ survivalSec: sec, score, wordCount: 10, continued: false }, extra));
  return a;
}
const ST = (o) => Object.assign({ score: 0, combo: 0, hp: 5, maxHp: 5, wordNo: 0, continued: false }, o);

test('343-1. 권한: 비로그인 401, perm_versus 없음 403, 차단 403, 관리자(DB role·ADMIN_EMAILS)는 통과, 권한 확인 DB 오류는 닫힘(403)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.get(null, '/rooms')).status, 401);
  assert.equal((await a.get(3, '/rooms')).status, 403); assert.equal((await a.post(3, '/rooms')).status, 403); assert.equal((await a.get(6, '/rooms')).status, 403);
  assert.equal((await a.get(1, '/rooms')).status, 200); assert.equal((await a.get(4, '/rooms')).status, 200, 'DB role admin');
  assert.equal((await a.get(9, '/rooms')).status, 200, 'ADMIN_EMAILS 관리자(perm_versus false)');
  assert.equal((await a.get(777, '/rooms')).status, 403, '없는 사용자');
  a.db.failPerm = true; const e = await a.get(1, '/rooms'); assert.equal(e.status, 403); assert.ok(!JSON.stringify(e.body).includes('boom'));
  assert.equal(a.store.size(), 0, '권한이 없으면 방이 만들어지지 않는다');
});

test('343-2. 방 흐름: 만들기 → 목록(표시 이름·경과·달리는 중·mine) → 참가 → 가득 참(목록에서 사라짐), 이미 방이 있으면 409, 자기 방 참가 400, 가득 찬 방 참가 409, 이메일 노출 없음', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const c = await a.post(1, '/rooms'); assert.equal(c.status, 200); assert.match(c.body.roomId, /^[0-9a-f]{24}$/);
  assert.equal((await a.post(1, '/rooms')).status, 409, '이미 방이 있음');
  a.clock.t += 5000;
  const l = await a.get(2, '/rooms'); assert.deepEqual(l.body.rooms, [{ id: c.body.roomId, hostName: 'Alice', elapsedSec: 5, hostRunning: false, mine: false }]);
  assert.equal((await a.get(1, '/rooms')).body.rooms[0].mine, true, '자기 방은 mine 표시');
  assert.equal((await a.post(1, `/rooms/${c.body.roomId}/join`)).status, 400, '자기 방 참가 금지');
  const j = await a.post(2, `/rooms/${c.body.roomId}/join`); assert.equal(j.status, 200); assert.equal(j.body.room.status, 'full'); assert.equal(j.body.opponent.name, 'Alice');
  assert.deepEqual((await a.get(5, '/rooms')).body.rooms, [], '가득 찬 방은 목록에서 사라짐');
  assert.equal((await a.post(5, `/rooms/${c.body.roomId}/join`)).status, 409, '가득 참');
  assert.equal((await a.post(2, '/rooms')).status, 409, '참가 중인 사람도 방을 또 만들 수 없음');
  assert.equal((await a.post(5, `/rooms/${'0'.repeat(24)}/join`)).status, 404); assert.equal((await a.post(5, '/rooms/xyz/join')).status, 400);
  const mail = await a.post(7, '/rooms'); assert.equal((await a.get(5, '/rooms')).body.rooms[0].hostName, '플레이어', '이메일 모양의 이름은 쓰지 않는다'); assert.ok(mail.body.roomId);
});

test('343-3. 동시 참가 경쟁에서 한 명만 성공한다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = (await a.post(1, '/rooms')).body.roomId;
  const rs = await Promise.all([a.post(2, `/rooms/${id}/join`), a.post(5, `/rooms/${id}/join`), a.post(20, `/rooms/${id}/join`)]);
  assert.equal(rs.filter(r => r.status === 200).length, 1); assert.equal(rs.filter(r => r.status === 409).length, 2);
});

test('343-4. 방장이 게임 중이어도 참가 가능, 방장이 끝낸 뒤에는 참가 불가(방은 닫힘)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = (await a.post(1, '/rooms')).body.roomId;
  assert.equal((await a.post(1, `/rooms/${id}/start`, { wordCount: 10 })).status, 200);
  assert.equal((await a.get(2, '/rooms')).body.rooms[0].hostRunning, true);
  assert.equal((await a.post(2, `/rooms/${id}/join`)).status, 200, '방장이 달리는 중에도 참가');
  const id2 = (await a.post(5, '/rooms')).body.roomId;
  await a.post(5, `/rooms/${id2}/start`, { wordCount: 10 }); a.clock.t += 20000;
  const f = await a.fin(5, id2, 20, 100); assert.equal(f.status, 200); assert.equal(f.body.room.status, 'closed', '혼자 끝나면 방을 닫는다');
  assert.deepEqual((await a.get(20, '/rooms')).body.rooms.map(r => r.id), [], '끝난 방은 목록에 없음'); assert.equal((await a.post(20, `/rooms/${id2}/join`)).status, 409);
  assert.equal((await a.post(5, '/rooms')).status, 200, '닫힌 방의 방장은 새 방을 만들 수 있다');
});

test('343-5. 시작·상태 전송 검증: wordCount 10 미만 400, 범위 밖·타입 오류 400, 감소 불가(score·wordNo·continued), 시작 전·끝난 뒤 409, 비참가자 403·없는 방 404', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.room(1, 2, { start: false });
  for (const wc of [9, 0, -1, 10.5, '10', null, undefined, 100001]) assert.equal((await a.post(1, `/rooms/${id}/start`, { wordCount: wc })).status, 400, String(wc));
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST())).status, 409, '시작 전');
  const s = await a.post(1, `/rooms/${id}/start`, { wordCount: 12 }); assert.equal(s.status, 200); assert.equal(s.body.me.started, true); assert.equal(s.body.me.wordCount, 12);
  a.clock.t += 3000; assert.equal((await a.post(1, `/rooms/${id}/start`, { wordCount: 99 })).body.me.wordCount, 12, '두 번째 start 는 같은 기록(재시도 안전)');
  for (const bad of [ST({ hp: 11 }), ST({ hp: -1 }), ST({ maxHp: 0 }), ST({ maxHp: 11 }), ST({ hp: 6, maxHp: 5 }), ST({ score: -1 }), ST({ score: 1.5 }), ST({ combo: -1 }), ST({ wordNo: -1 }), ST({ score: '5' }), ST({ continued: 'no' }), ST({ hp: null }), {}, [], 'x']) {
    assert.equal((await a.post(1, `/rooms/${id}/state`, bad)).status, 400, JSON.stringify(bad));
  }
  const ok = await a.post(1, `/rooms/${id}/state`, ST({ score: 500, combo: 3, hp: 4, wordNo: 2 })); assert.equal(ok.status, 200); assert.equal(ok.body.me.score, 500);
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 400, wordNo: 2 }))).status, 400, 'score 감소 불가');
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 500, wordNo: 1 }))).status, 400, 'wordNo 감소 불가');
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 600, wordNo: 3, continued: true }))).status, 200);
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 700, wordNo: 3, continued: false }))).status, 400, 'continued 되돌리기 불가');
  assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 600, wordNo: 3, hp: 0, continued: true }))).status, 200, '같은 값 재전송 허용(체력은 줄 수 있다)');
  assert.equal((await a.post(5, `/rooms/${id}/state`, ST())).status, 403, '비참가자'); assert.equal((await a.get(5, `/rooms/${id}`)).status, 403); assert.equal((await a.post(5, `/rooms/${id}/finish`, {})).status, 403); assert.equal((await a.post(5, `/rooms/${id}/leave`)).status, 403);
  assert.equal((await a.post(1, `/rooms/${'1'.repeat(24)}/state`, ST())).status, 404);
  // 상대의 공개 상태(이메일·내부 값 없음)
  const o = await a.get(2, `/rooms/${id}`); assert.deepEqual(o.body.opponent, { name: 'Alice', hp: 0, maxHp: 5, score: 600, combo: 0, wordNo: 3, running: true, finished: false, continued: true, disconnected: false, left: false });
  a.clock.t += 9000; await a.fin(1, id, 12, 600, { continued: true }); assert.equal((await a.post(1, `/rooms/${id}/state`, ST({ score: 900, wordNo: 9, continued: true }))).status, 409, '끝난 뒤 상태 전송 409');
});

test('343-6. finish: 서버가 잰 경과 + 2초까지만 인정(초과분은 깎음), 같은 호출 반복은 같은 결과(멱등, 처음 기록 유지), 점수·타입 검증, 시작 전 409', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.room(1, 2);
  assert.equal((await a.post(1, `/rooms/${id}/finish`, { survivalSec: -1, score: 0, wordCount: 1, continued: false })).status, 400);
  for (const bad of [{ survivalSec: '5', score: 0, wordCount: 1, continued: false }, { survivalSec: 5, score: 1.5, wordCount: 1, continued: false }, { survivalSec: 5, score: 0, wordCount: -1, continued: false }, { survivalSec: 5, score: 0, wordCount: 1 }, { survivalSec: 99999, score: 0, wordCount: 1, continued: false }, {}, []]) assert.equal((await a.post(1, `/rooms/${id}/finish`, bad)).status, 400, JSON.stringify(bad));
  await a.post(1, `/rooms/${id}/state`, ST({ score: 300, wordNo: 4 }));
  assert.equal((await a.fin(1, id, 5, 100)).status, 400, '최종 점수가 직전 상태보다 낮음');
  a.clock.t += 10000;
  const f = await a.fin(1, id, 600, 300); assert.equal(f.status, 200); assert.equal(f.body.me.survivalSec, 12, '10초 경과 + 2초 허용 = 12 로 깎임');
  const again = await a.fin(1, id, 1, 999, { continued: true }); assert.equal(again.status, 200); assert.equal(again.body.me.survivalSec, 12, '두 번째 호출은 처음 기록 그대로'); assert.equal(again.body.me.score, 300); assert.equal(again.body.me.continued, false);
  const id2 = await a.room(5, 20, { start: false }); assert.equal((await a.fin(5, id2, 5, 0)).status, 409, '시작 전 finish 불가');
  const id3 = await a.room(21, 22); a.clock.t += 4000;
  assert.equal((await a.fin(21, id3, 4.5, 10)).body.me.survivalSec, 4.5, '서버 경과 이내면 그대로');
});

test('343-7. 판정: 시간 차 1.5초 초과면 긴 쪽(survival), 1.5초 이내면 점수(score), 1.5초 경계는 점수, 점수까지 같으면 무승부, 이어하기 사용 표시, 사람마다 me/opponent 기준', async t => {
  const a = await setup(); t.after(() => a.t.close());
  async function play(h, g) {   // [생존초, 점수, 옵션]
    a.clock.t = T0; const id = await a.room(1, 2); for (let i = 0; i < 5; i++) { a.clock.t += 20000; await a.post(1, `/rooms/${id}/state`, ST()); await a.post(2, `/rooms/${id}/state`, ST()); }   // 100초 동안 20초마다 신호(끊김 아님)
    await a.fin(1, id, h[0], h[1], h[2]); const mid = await a.get(2, `/rooms/${id}`); assert.equal(mid.body.result, null, '한쪽만 끝나면 결과 없음');
    await a.fin(2, id, g[0], g[1], g[2]);
    const vh = await a.get(1, `/rooms/${id}`), vg = await a.get(2, `/rooms/${id}`);
    await a.post(1, `/rooms/${id}/leave`); await a.post(2, `/rooms/${id}/leave`);
    return { h: vh.body, g: vg.body };
  }
  let r = await play([60, 100], [50, 9000]); assert.equal(r.h.room.status, 'finished'); assert.deepEqual([r.h.result.winner, r.h.result.reason, r.g.result.winner], ['me', 'survival', 'opponent'], '10초 차이는 생존 시간');
  r = await play([60, 100], [58.4, 5000]); assert.deepEqual([r.h.result.winner, r.h.result.reason], ['me', 'survival'], '1.6초 차이는 긴 쪽');
  r = await play([60, 100], [58.5, 5000]); assert.deepEqual([r.h.result.winner, r.h.result.reason, r.g.result.winner], ['opponent', 'score', 'me'], '정확히 1.5초 차이는 점수로(이내)');
  r = await play([60, 100], [61, 5000]); assert.deepEqual([r.h.result.winner, r.h.result.reason], ['opponent', 'score'], '1초 차이는 점수');
  r = await play([60, 700], [60.5, 700]); assert.deepEqual([r.h.result.winner, r.h.result.reason, r.g.result.winner], ['draw', 'draw', 'draw'], '점수까지 같으면 무승부');
  r = await play([60, 700, { continued: true, wordCount: 14 }], [30, 100, { wordCount: 6 }]);
  assert.equal(r.h.result.me.continued, true); assert.equal(r.h.result.opponent.continued, false); assert.equal(r.g.result.opponent.continued, true);
  assert.deepEqual([r.h.result.me.survivalSec, r.h.result.me.score, r.h.result.me.wordCount, r.h.result.opponent.wordCount, r.h.result.diffSec], [60, 700, 14, 6, 30]);
  assert.deepEqual(Object.keys(r.h.result.me).sort(), ['continued', 'disconnected', 'name', 'score', 'survivalSec', 'wordCount']);
});

test('343-8. 끊김: 달리는 중 30초 넘게 신호가 없으면 마지막 신호까지의 서버 경과와 마지막 상태로 종료 처리(상대 조회로도 판정), 30초 이내는 유지, 신호(상태·조회)가 있으면 끊김 아님', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = await a.room(1, 2);
  a.clock.t += 20000; await a.post(1, `/rooms/${id}/state`, ST({ score: 400, wordNo: 5 })); await a.post(2, `/rooms/${id}/state`, ST({ score: 100 }));
  a.clock.t += 29000; let v = await a.get(2, `/rooms/${id}`); assert.equal(v.body.opponent.running, true, '29초는 끊김 아님');
  a.clock.t += 2000;   // 방장 마지막 신호 이후 31초(상대는 조회로 신호를 줬음)
  v = await a.get(2, `/rooms/${id}`); assert.equal(v.body.opponent.finished, true); assert.equal(v.body.opponent.disconnected, true); assert.equal(v.body.opponent.running, false);
  assert.equal(v.body.result, null, '나머지 한 명이 아직 달리는 중');
  await a.fin(2, id, 51, 100); const end = await a.get(2, `/rooms/${id}`);
  assert.equal(end.body.result.opponent.survivalSec, 20, '방장: 시작 후 마지막 신호(20초)까지'); assert.equal(end.body.result.opponent.score, 400, '마지막으로 알린 점수'); assert.equal(end.body.result.opponent.disconnected, true);
  assert.deepEqual([end.body.result.winner, end.body.result.reason], ['me', 'survival']);
  const id2 = await a.room(5, 20); a.clock.t += 40000; a.store.sweep();   // 둘 다 신호가 없으면 둘 다 끊김 처리돼 판정
  assert.equal((await a.get(5, `/rooms/${id2}`)).body.room.status, 'finished'); assert.equal((await a.get(5, `/rooms/${id2}`)).body.result.reason, 'draw');
});

test('343-9. 나가기: 열린 방에서 방장이 나가면 닫힘, 가득 찬 방에서 나가면 그 사람은 끝난 것으로 보고(참가자는 불리), 나간 사람은 새 방을 만들 수 있다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const id = (await a.post(1, '/rooms')).body.roomId; const l = await a.post(1, `/rooms/${id}/leave`); assert.equal(l.body.room.status, 'closed'); assert.deepEqual((await a.get(2, '/rooms')).body.rooms, []);
  const id2 = await a.room(1, 2); a.clock.t += 10000;
  const g = await a.post(2, `/rooms/${id2}/leave`); assert.equal(g.status, 200); assert.equal(g.body.me.left, true); assert.equal((await a.post(2, '/rooms')).status, 200, '나간 사람은 새 방 가능');
  a.clock.t += 5000; await a.fin(1, id2, 15, 50); const v = await a.get(1, `/rooms/${id2}`);
  assert.equal(v.body.room.status, 'finished'); assert.deepEqual([v.body.result.winner, v.body.result.reason], ['me', 'survival']); assert.equal(v.body.result.opponent.survivalSec, 10);
  assert.equal((await a.post(2, `/rooms/${id2}/leave`)).status, 200, '두 번 나가기는 같은 결과');
});

test('343-10. 정리 타이머: 종료된 방은 10분 뒤, 신호 없는 열린 방은 5분 뒤, 닫힌 방은 1분 뒤에 사라진다. 방 50개 상한 503. 사용자당 초당 10회 상한 429', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const idOpen = (await a.post(1, '/rooms')).body.roomId; const idDone = await a.room(2, 5); a.clock.t += 5000; await a.fin(2, idDone, 5, 1); await a.fin(5, idDone, 5, 1);
  const idClosed = (await a.post(20, '/rooms')).body.roomId; await a.post(20, `/rooms/${idClosed}/leave`);
  assert.equal(a.store.size(), 3);
  a.clock.t += 61000; a.store.sweep(); assert.equal(a.store._rooms.has(idClosed), false, '닫힌 방 1분');
  a.clock.t += 5 * 60000 - 61000 + 1000; a.store.sweep(); assert.equal(a.store._rooms.has(idOpen), false, '열린 방 5분 무신호'); assert.equal(a.store._rooms.has(idDone), true, '종료된 방은 아직');
  a.clock.t += 10 * 60000; a.store.sweep(); assert.equal(a.store.size(), 0, '종료된 방 10분');
  // 방 50개 상한
  for (let i = 0; i < 50; i++) { a.clock.t += 2000; assert.equal((await a.post(20 + i, '/rooms')).status, 200, 'room ' + i); }
  a.clock.t += 2000; const over = await a.post(70, '/rooms'); assert.equal(over.status, 503); assert.equal(a.store.size(), 50);
  a.store.rateLimited = a.realRate;
  // 요청 수 상한: 같은 순간 10회까지, 11번째는 429, 1초 뒤 다시 허용. 다른 사용자는 영향 없음
  a.clock.t += 5000; const res = []; for (let i = 0; i < 11; i++) res.push((await a.get(2, '/rooms')).status);
  assert.deepEqual(res, [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429]); assert.equal((await a.get(5, '/rooms')).status, 200, '다른 사용자는 별개');
  a.clock.t += 1001; assert.equal((await a.get(2, '/rooms')).status, 200);
});

test('343-11. 관리자 수정 API 가 perm_versus 를 불리언으로 받는다(문자열·숫자는 400). initDB 에 perm_versus 단계가 있고 서버가 라우트를 등록한다', async t => {
  const db = createDb(); const ad = await startApp(['routes/admin.js'], { db }); t.after(() => ad.close());
  assert.equal((await ad.call('PATCH', '/api/admin/users/2', { perm_versus: true }, { user: 9 })).status, 200); assert.equal(db.patches.length, 1); assert.match(db.patches[0], /perm_versus = \$2/);
  assert.equal((await ad.call('PATCH', '/api/admin/users/2', { perm_versus: 'yes' }, { user: 9 })).status, 400); assert.equal((await ad.call('PATCH', '/api/admin/users/2', { perm_versus: 1 }, { user: 9 })).status, 400);
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'lib', 'db.js'), 'utf8'), /ADD COLUMN IF NOT EXISTS perm_versus BOOLEAN NOT NULL DEFAULT false/);
  assert.match(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), /require\('\.\/routes\/versus'\)/);
});
