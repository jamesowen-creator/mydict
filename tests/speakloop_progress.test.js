// 작업399: Speak Loop 연습 기록 API — 본인 것만, 독백 id·rating 검증, 권한 fail-closed. 가짜 DB 만 쓴다.
// 실행: node --test tests/speakloop_progress.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp } = require('./helpers/app');
const { createSlDb } = require('./helpers/speakloop_db');

// 기록 테이블 SQL 두 가지만 흉내 낸다(나머지는 공용 가짜 DB 그대로)
function createDb(opts) {
  const db = createSlDb(opts);
  db.progress = new Map();   // "user|item" -> row
  const base = db.pool.query;
  db.pool.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/FROM speakloop_progress WHERE user_id = \$1/.test(s)) {
      db.queries.push(s);
      return { rows: [...db.progress.values()].filter(r => r.user_id === params[0]).map(({ user_id, ...r }) => r) };
    }
    if (/^INSERT INTO speakloop_progress/.test(s)) {
      db.queries.push(s);
      if (db.failProgress) throw new Error('progress down');
      const [user_id, item_id, rating] = params, k = user_id + '|' + item_id, old = db.progress.get(k);
      const row = { user_id, item_id, count: old ? old.count + 1 : 1, last_rating: rating, last_at: new Date().toISOString() };
      db.progress.set(k, row);
      const { user_id: _u, ...out } = row;
      return { rows: [out] };
    }
    return base(sql, params);
  };
  return db;
}
async function setup(opts) {
  const db = createDb(opts);
  const app = await startApp(['routes/speakloop.js'], { db });
  return { db, app };
}
const post = (app, body, user = 1) => app.call('POST', '/api/speakloop/progress', body, { user });

test('비로그인 401, 권한 없음·차단·행 없음 403(기록 테이블을 건드리지 않음)', async t => {
  const { db, app } = await setup();
  t.after(() => app.close());
  assert.equal((await app.call('GET', '/api/speakloop/progress', undefined, { user: null })).status, 401);
  assert.equal((await post(app, { item_id: 'm-delay', rating: 'good' }, null)).status, 401);
  for (const user of [3, 9, 77]) {
    assert.equal((await app.call('GET', '/api/speakloop/progress', undefined, { user })).status, 403, 'GET ' + user);
    assert.equal((await post(app, { item_id: 'm-delay', rating: 'good' }, user)).status, 403, 'POST ' + user);
  }
  assert.deepEqual(db.queries.filter(q => /speakloop_progress/.test(q)), []);
});

test('권한 확인 중 오류가 나면 403(fail-closed), DB 가 없어도 403', async t => {
  const { app } = await setup({ failUsers: true });
  const saved = process.env.DATABASE_URL;
  t.after(() => { process.env.DATABASE_URL = saved; return app.close(); });
  assert.equal((await app.call('GET', '/api/speakloop/progress', undefined, { user: 1 })).status, 403);
  assert.equal((await post(app, { item_id: 'm-delay', rating: 'good' })).status, 403);
  delete process.env.DATABASE_URL;
  assert.equal((await post(app, { item_id: 'm-delay', rating: 'good' })).status, 403);
});

test('모르는 id 404, 잘못된 rating 400 (기록은 생기지 않음)', async t => {
  const { db, app } = await setup();
  t.after(() => app.close());
  for (const id of ['nope', '', 5, null, undefined, 'm-delay.l0', 'hang-out.say']) assert.equal((await post(app, { item_id: id, rating: 'good' })).status, 404, String(id));
  for (const r of ['great', '', 'GOOD', 1, null, undefined, ['good']]) assert.equal((await post(app, { item_id: 'm-delay', rating: r })).status, 400, String(r));
  assert.equal((await app.call('POST', '/api/speakloop/progress', undefined, { user: 1 })).status, 404);
  assert.equal(db.progress.size, 0);
});

test('기록하면 count 가 1씩 오르고 last_rating·last_at 이 바뀐다', async t => {
  const { app } = await setup();
  t.after(() => app.close());
  let r = await post(app, { item_id: 'm-delay', rating: 'hard' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.item.item_id, r.body.item.count, r.body.item.last_rating], ['m-delay', 1, 'hard']);
  r = await post(app, { item_id: 'm-delay', rating: 'good' });
  assert.deepEqual([r.body.item.count, r.body.item.last_rating], [2, 'good']);
  await post(app, { item_id: 'm-tacos', rating: 'some' });
  const list = await app.call('GET', '/api/speakloop/progress', undefined, { user: 1 });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map(i => [i.item_id, i.count, i.last_rating]), [['m-delay', 2, 'good'], ['m-tacos', 1, 'some']]);
  assert.ok(list.body.items.every(i => i.last_at));
});

test('사용자별로 분리: 다른 사용자(관리자 포함)의 기록은 읽거나 바꾸지 않는다', async t => {
  const { app } = await setup();
  t.after(() => app.close());
  await post(app, { item_id: 'm-delay', rating: 'good' }, 1);
  await post(app, { item_id: 'm-delay', rating: 'hard' }, 4);
  await post(app, { item_id: 'm-delay', rating: 'some' }, 4);
  const a = await app.call('GET', '/api/speakloop/progress', undefined, { user: 1 });
  const b = await app.call('GET', '/api/speakloop/progress', undefined, { user: 4 });
  assert.deepEqual(a.body.items.map(i => [i.count, i.last_rating]), [[1, 'good']]);
  assert.deepEqual(b.body.items.map(i => [i.count, i.last_rating]), [[2, 'some']]);
  // 요청 본문의 user_id 는 무시된다
  await app.call('POST', '/api/speakloop/progress', { item_id: 'm-tacos', rating: 'good', user_id: 4 }, { user: 1 });
  const b2 = await app.call('GET', '/api/speakloop/progress', undefined, { user: 4 });
  assert.equal(b2.body.items.length, 1);
});

test('저장 실패는 500, 로그에는 상태 코드만 남고 오류 내용·글은 남지 않는다', async t => {
  const { db, app } = await setup();
  t.after(() => app.close());
  db.failProgress = true;
  const logs = [], orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try { assert.equal((await post(app, { item_id: 'm-delay', rating: 'good' })).status, 500); } finally { console.error = orig; }
  assert.deepEqual(logs, ['speakloop progress save failed: 500']);
});

test('작업401: 이디엄 id 도 기록할 수 있다(some·good·hard), 독백 id 는 기존대로, 모르는 id 404, 권한·본인 행 규칙 유지', async t => {
  const { app } = await setup();
  t.after(() => app.close());
  for (const [id, rating] of [['hang-out', 'some'], ['hang-out', 'hard'], ['touch-base', 'good']]) assert.equal((await post(app, { item_id: id, rating })).status, 200, id + rating);
  assert.equal((await post(app, { item_id: 'm-delay', rating: 'good' })).status, 200, '독백 id 는 그대로');
  for (const id of ['hang-out.say', 'hang-out.ex', 'not-an-idiom']) assert.equal((await post(app, { item_id: id, rating: 'good' })).status, 404, id);
  assert.equal((await post(app, { item_id: 'hang-out', rating: 'great' })).status, 400, 'rating 허용값은 그대로');
  assert.equal((await post(app, { item_id: 'hang-out', rating: 'good' }, 3)).status, 403);
  assert.equal((await post(app, { item_id: 'hang-out', rating: 'good' }, null)).status, 401);
  const mine = await app.call('GET', '/api/speakloop/progress', undefined, { user: 1 });
  assert.deepEqual(mine.body.items.map(i => [i.item_id, i.count, i.last_rating]).sort(), [['hang-out', 2, 'hard'], ['m-delay', 1, 'good'], ['touch-base', 1, 'good']]);
  assert.deepEqual((await app.call('GET', '/api/speakloop/progress', undefined, { user: 4 })).body.items, [], '다른 사용자의 기록은 보이지 않는다');
});
