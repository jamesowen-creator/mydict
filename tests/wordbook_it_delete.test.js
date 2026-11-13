// 작업411: DELETE /api/wordbook/:id/it — 단어 한 건의 data.it 만 제거(단어·다른 data 보존). 모의 DB·실제 인증 미들웨어. 운영 DB·AI 와 무관.
// 실행: node --test tests/wordbook_it_delete.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');

function createDb() {
  const db = { users: new Map(), rows: new Map(), updates: 0, deletes: 0 };
  db.users.set(7, { is_approved: true, is_blocked: false, can_wordbook: true, role: 'user' });
  db.users.set(8, { is_approved: true, is_blocked: false, can_wordbook: true, role: 'user' });
  db.users.set(5, { is_approved: true, is_blocked: true, can_wordbook: true, role: 'user' });
  db.users.set(6, { is_approved: false, is_blocked: false, can_wordbook: true, role: 'user' });
  db.users.set(4, { is_approved: true, is_blocked: false, can_wordbook: false, role: 'user' });
  db.rows.set(1, { user_id: 7, word: 'cache', data: { word: 'cache', meanings: [{ definition: '캐시' }], it: { is_it: true } } });
  db.rows.set(2, { user_id: 8, word: 'thread', data: { word: 'thread', it: { is_it: true } } });
  db.rows.set(3, { user_id: 7, word: 'x', data: null });
  db.pool = {
    query: async (sql, params = []) => {
      let m;
      if (/^SELECT is_approved, is_blocked, role FROM users/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ is_approved: u.is_approved, is_blocked: u.is_blocked, role: u.role }] : [] }; }
      if ((m = /^SELECT is_blocked, (\w+) FROM users/.exec(sql))) { const u = db.users.get(params[0]); return { rows: u ? [{ is_approved: true, is_blocked: u.is_blocked, [m[1]]: u[m[1]] }] : [] }; }
      if (/^SELECT role FROM users/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ role: u.role }] : [] }; }
      if (/^UPDATE wordbook SET data = data - 'it' WHERE id = \$1 AND user_id = \$2$/.test(sql)) {
        db.updates++;
        const row = db.rows.get(Number(params[0]));
        if (!row || row.user_id !== params[1]) return { rows: [], rowCount: 0 };
        if (row.data) { const { it, ...rest } = row.data; row.data = rest; }   // jsonb `data - 'it'` 와 같은 결과
        return { rows: [], rowCount: 1 };
      }
      if (/^DELETE FROM wordbook/.test(sql)) { db.deletes++; return { rows: [], rowCount: 0 }; }
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 80));
    },
  };
  db.trackUsage = () => {};
  return db;
}
async function setup() { const db = createDb(); const t = await startApp(['routes/wordbook.js'], { db }); return { db, t, del: (id, user = 7) => t.call('DELETE', '/api/wordbook/' + id + '/it', undefined, { user }) }; }

test('본인 행: 200, data.it 만 사라지고 단어와 다른 data 필드는 그대로, 행 삭제는 일어나지 않는다', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const r = await a.del(1); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(a.db.rows.get(1).data, { word: 'cache', meanings: [{ definition: '캐시' }] }); assert.equal(a.db.rows.get(1).word, 'cache'); assert.equal(a.db.deletes, 0);
  assert.equal((await a.del(1)).status, 200, '이미 없어도 본인 행이면 200(멱등)');
  assert.equal((await a.del(3)).status, 200, 'data 가 비어 있어도 오류 없음');
});
test('다른 사용자 행·없는 행은 404, 변경 없음', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.del(2)).status, 404); assert.deepEqual(a.db.rows.get(2).data.it, { is_it: true });
  assert.equal((await a.del(999)).status, 404);
});
test('비로그인 401, 차단·승인 대기·단어장 권한 없음 403 — DB 변경 없음', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.del(1, null)).status, 401);
  for (const u of [5, 6, 4]) assert.equal((await a.del(1, u)).status, 403, 'user ' + u);
  assert.equal(a.db.updates, 0); assert.deepEqual(a.db.rows.get(1).data.it, { is_it: true });
});
test('잘못된 id 는 400', async t => {
  const a = await setup(); t.after(() => a.t.close());
  for (const id of ['abc', '0', '-1', '99999999999']) assert.equal((await a.del(id)).status, 400, id);
  assert.equal(a.db.updates, 0);
});
