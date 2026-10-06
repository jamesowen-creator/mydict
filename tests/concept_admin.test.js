// 작업194: 관리자 화면용 API가 perm_concept_study를 조회·변경하고, concept 이벤트 비용을 Haiku 단가로 합산하는지. 실행: node --test "tests/**/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockDb } = require('./helpers/mock_db');

process.env.ADMIN_EMAILS = 'u7@example.com';
const { startApp } = require('./helpers/app');

test('관리자: perm_concept_study 조회·변경(다른 perm과 같은 방식), 일반 사용자는 403', async () => {
  const db = createMockDb();
  db.addUser(7); db.addUser(8, { perm_concept_study: true });
  const seen = [];
  const baseQuery = db.pool.query;
  db.pool.query = async (sql, p) => {
    if (/FROM users u/.test(sql)) { seen.push(sql); return { rows: [] }; }
    return baseQuery(sql, p);
  };
  const t = await startApp(['routes/admin.js'], { db });
  assert.equal((await t.call('GET', '/api/admin/users', undefined, { user: 7 })).status, 200);
  assert.match(seen[0], /u\.perm_concept_study/);
  let r = await t.call('PATCH', '/api/admin/users/8', { perm_concept_study: false }, { user: 7 });
  assert.equal(r.status, 200);
  assert.equal(r.body.perm_concept_study, false);
  assert.equal(db.tables.users.find(u => u.id === 8).perm_concept_study, false);
  r = await t.call('PATCH', '/api/admin/users/8', { perm_concept_study: true }, { user: 7 });
  assert.equal(r.body.perm_concept_study, true);
  await t.close();
});
