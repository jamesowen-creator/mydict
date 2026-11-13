// 작업408: PATCH /api/wordbook/:id/it — 단어 한 건의 data.it 만 병합 저장. 모의 DB·실제 인증 미들웨어. 운영 DB·AI 와 무관.
// 확인: 본인 행만 / 다른 사용자 행 404 / 비로그인 401 / 차단·승인 대기·단어장 권한 없음 거부 / 다른 data 필드 보존 / 크기·형식 제한
// 실행: node --test tests/wordbook_it.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');

function createDb() {
  const db = { users: new Map(), rows: new Map(), updates: 0 };
  db.users.set(7, { is_approved: true, is_blocked: false, can_wordbook: true, role: 'user' });
  db.users.set(8, { is_approved: true, is_blocked: false, can_wordbook: true, role: 'user' });
  db.users.set(5, { is_approved: true, is_blocked: true, can_wordbook: true, role: 'user' });
  db.users.set(6, { is_approved: false, is_blocked: false, can_wordbook: true, role: 'user' });
  db.users.set(4, { is_approved: true, is_blocked: false, can_wordbook: false, role: 'user' });
  db.rows.set(1, { user_id: 7, data: { word: 'cache', lang: 'en', meanings: [{ definition: '캐시' }], nuance: '보존' } });
  db.rows.set(2, { user_id: 8, data: { word: 'thread', lang: 'en' } });
  db.rows.set(3, { user_id: 7, data: null });
  db.pool = {
    query: async (sql, params = []) => {
      let m;
      if (/^SELECT is_approved, is_blocked, role FROM users/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ is_approved: u.is_approved, is_blocked: u.is_blocked, role: u.role }] : [] }; }
      if ((m = /^SELECT is_blocked, (\w+) FROM users/.exec(sql))) { const u = db.users.get(params[0]); return { rows: u ? [{ is_approved: true, is_blocked: u.is_blocked, [m[1]]: u[m[1]] }] : [] }; }
      if (/^SELECT role FROM users/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ role: u.role }] : [] }; }
      if (/^UPDATE wordbook SET data = COALESCE\(data, '\{\}'::jsonb\) \|\| jsonb_build_object\('it', \$1::jsonb\) WHERE id = \$2 AND user_id = \$3$/.test(sql)) {
        db.updates++;
        const row = db.rows.get(Number(params[1]));
        if (!row || row.user_id !== params[2]) return { rows: [], rowCount: 0 };
        row.data = { ...(row.data || {}), it: JSON.parse(params[0]) };   // jsonb 병합과 같은 결과: 'it' 키만 덮어쓴다
        return { rows: [], rowCount: 1 };
      }
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 80));
    },
  };
  db.trackUsage = () => {};
  return db;
}
async function setup() { const db = createDb(); const t = await startApp(['routes/wordbook.js'], { db }); return { db, t, patch: (id, body, user = 7) => t.call('PATCH', '/api/wordbook/' + id + '/it', body, { user }) }; }
const IT = { is_it: true, one_line: '자주 쓰는 것을 가까이 두는 것', situations: ['a', 'b'], origin: { text: '숨겨 둔다는 뜻', sure: true }, compare: null, example: { en: 'x', ko: 'y' } };

test('본인 행: 200, data.it 만 들어가고 다른 필드(word·meanings·nuance)는 그대로', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const r = await a.patch(1, { it: IT }); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(a.db.rows.get(1).data, { word: 'cache', lang: 'en', meanings: [{ definition: '캐시' }], nuance: '보존', it: IT });
  const again = { ...IT, one_line: '바뀐 설명' };
  assert.equal((await a.patch(1, { it: again })).status, 200); assert.equal(a.db.rows.get(1).data.it.one_line, '바뀐 설명'); assert.equal(a.db.rows.get(1).data.word, 'cache');
});

test('data 가 비어 있던 행도 it 만 생긴다. is_it=false 도 저장', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.patch(3, { it: { is_it: false } })).status, 200); assert.deepEqual(a.db.rows.get(3).data, { it: { is_it: false } });
});

test('다른 사용자 행은 404(변경 없음), 없는 행도 404', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const before = JSON.stringify(a.db.rows.get(2));
  assert.equal((await a.patch(2, { it: IT })).status, 404); assert.equal(JSON.stringify(a.db.rows.get(2)), before);
  assert.equal((await a.patch(999, { it: IT })).status, 404);
});

test('비로그인 401, 차단 403, 승인 대기 403, 단어장 권한 없음 403 — DB 변경 없음', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.patch(1, { it: IT }, null)).status, 401);
  for (const u of [5, 6, 4]) assert.equal((await a.patch(1, { it: IT }, u)).status, 403, 'user ' + u);
  assert.equal(a.db.updates, 0); assert.equal(a.db.rows.get(1).data.it, undefined);
});

test('입력 제한: it 없음·배열·문자열·is_it 가 불리언 아님·4000바이트 초과·잘못된 id 는 400, 변경 없음', async t => {
  const a = await setup(); t.after(() => a.t.close());
  for (const bad of [undefined, null, [], 'x', 5, { is_it: 'yes' }, {}, { is_it: true, pad: 'x'.repeat(4001) }, { is_it: true, pad: '가'.repeat(1400) }]) {
    assert.equal((await a.patch(1, { it: bad })).status, 400, String(JSON.stringify(bad)).slice(0, 40));
  }
  assert.equal((await a.patch(1, undefined)).status, 400);
  for (const id of ['abc', '0', '-1', '99999999999']) assert.equal((await a.patch(id, { it: IT })).status, 400, id);
  assert.equal(a.db.updates, 0);
});
