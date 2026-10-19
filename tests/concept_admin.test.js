// 작업194: concept 이벤트 비용을 Haiku 단가로 합산하는지(과거 사용 기록 집계용으로 유지). 작업CL-1: 개념학습 삭제로 관리자 API 의 perm_concept_study 조회·변경은 없어졌다. 실행: node --test "tests/**/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockDb } = require('./helpers/mock_db');

process.env.ADMIN_EMAILS = 'u7@example.com';
const { startApp } = require('./helpers/app');

test('작업CL-1: 개념학습 권한(perm_concept_study)은 관리자 API 의 조회·변경 대상이 아니다 — 목록 SQL 에 없고 PATCH 로 보내도 400, 값은 그대로(열은 DB 에 남아 있음)', async ctx => {
  const db = createMockDb();
  db.addUser(7); db.addUser(8, { perm_concept_study: true });
  const seen = [];
  const baseQuery = db.pool.query;
  db.pool.query = async (sql, p) => {
    if (/FROM users u/.test(sql)) { seen.push(sql); return { rows: [] }; }
    return baseQuery(sql, p);
  };
  const t = await startApp(['routes/admin.js'], { db });
  ctx.after(() => t.close());
  assert.equal((await t.call('GET', '/api/admin/users', undefined, { user: 7 })).status, 200);
  assert.doesNotMatch(seen[0], /perm_concept_study/);
  assert.match(seen[0], /u\.perm_voice_study/, '다른 권한 열 조회는 그대로');
  const r = await t.call('PATCH', '/api/admin/users/8', { perm_concept_study: false }, { user: 7 });
  assert.equal(r.status, 400, '허용 항목이 아니라 변경할 항목이 없음');
  assert.equal(db.tables.users.find(u => u.id === 8).perm_concept_study, true, '값은 바뀌지 않음');
  const ok = await t.call('PATCH', '/api/admin/users/8', { perm_voice_study: false }, { user: 7 });
  assert.equal(ok.status, 200); assert.ok(!('perm_concept_study' in ok.body), '응답에도 없음');
});

test("관리자 비용: 'concept' 이벤트는 Haiku 토큰 단가(입력 $1·출력 $5 / MTok)로 합산", async ctx => {
  const db = createMockDb();
  db.addUser(7);
  const rows = [{ event_type: 'concept', count: 4, input_tokens: 2000000, output_tokens: 1000000, char_count: 0 }];
  db.pool.query = async sql => (/COUNT\(\*\)::int AS total/.test(sql) ? { rows: [{ total: 1, active: 1, blocked: 0, pending: 0, admins: 1 }] } : { rows });
  const t = await startApp(['routes/admin.js'], { db });
  ctx.after(() => t.close());   // 작업271-3: 단언이 실패해도 서버를 닫는다
  const r = await t.call('GET', '/api/admin/stats', undefined, { user: 7 });
  assert.equal(r.status, 200);
  assert.equal(r.body.cost.total.anthropic, 7);   // 2×$1 + 1×$5
  assert.equal(r.body.cost.total.openai, 0);
});
