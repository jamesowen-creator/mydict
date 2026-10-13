// 작업270-1: 개념 지도 서버 틀. /api/cmap/status 권한(fail-closed)과 관리자 권한 열, /api/me 응답.
// 실행: node --test tests/concept_map.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMockDb } = require('./helpers/mock_db');

process.env.ADMIN_EMAILS = 'u7@example.com';
const { startApp } = require('./helpers/app');

test('/api/cmap/status: 미로그인 401, 권한 없음(false·값 없음·차단·사용자 없음) 403, 권한 true 200', async ctx => {
  const db = createMockDb();
  db.addUser(1, { perm_concept_map: true });
  db.addUser(2, { perm_concept_map: false });
  db.addUser(3);                                          // 열 값이 없는 행(마이그레이션 직후 모사): 열려서는 안 된다
  db.addUser(4, { perm_concept_map: true, is_blocked: true });
  const t = await startApp(['routes/concept_map.js'], { db });
  ctx.after(() => t.close());   // 작업271-3: 단언이 실패해도 서버를 닫는다
  assert.equal((await t.call('GET', '/api/cmap/status', undefined, { user: null })).status, 401);
  let r = await t.call('GET', '/api/cmap/status', undefined, { user: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, perm: true, stage: 1 });
  for (const id of [2, 3, 4, 99]) assert.equal((await t.call('GET', '/api/cmap/status', undefined, { user: id })).status, 403, '사용자 ' + id);
});

test('/api/cmap/status: 권한 조회가 실패하면 닫힘(403, 500 아님)', async ctx => {
  const db = createMockDb();
  db.addUser(1, { perm_concept_map: true });
  const base = db.pool.query;
  db.pool.query = async (sql, p) => { if (/perm_concept_map/.test(sql)) throw new Error('db down'); return base(sql, p); };
  const t = await startApp(['routes/concept_map.js'], { db });
  ctx.after(() => t.close());   // 작업271-3: 단언이 실패해도 서버를 닫는다
  assert.equal((await t.call('GET', '/api/cmap/status', undefined, { user: 1 })).status, 403);
});

test('관리자: perm_concept_map 조회·변경, 옛 perm_concept_study 와 독립, 일반 사용자는 403', async ctx => {
  const db = createMockDb();
  db.addUser(7); db.addUser(8, { perm_concept_map: false, perm_concept_study: true });
  const seen = [];
  const base = db.pool.query;
  db.pool.query = async (sql, p) => { if (/FROM users u/.test(sql)) { seen.push(sql); return { rows: [] }; } return base(sql, p); };
  const t = await startApp(['routes/admin.js'], { db });
  ctx.after(() => t.close());   // 작업271-3: 단언이 실패해도 서버를 닫는다
  assert.equal((await t.call('GET', '/api/admin/users', undefined, { user: 7 })).status, 200);
  assert.match(seen[0], /u\.perm_concept_map/);
  assert.match(seen[0], /u\.perm_concept_study/, '옛 열 조회는 그대로');
  let r = await t.call('PATCH', '/api/admin/users/8', { perm_concept_map: true }, { user: 7 });
  assert.equal(r.status, 200);
  assert.equal(r.body.perm_concept_map, true);
  assert.equal(db.tables.users.find(u => u.id === 8).perm_concept_map, true);
  assert.equal(db.tables.users.find(u => u.id === 8).perm_concept_study, true, '옛 권한은 바뀌지 않음');
  r = await t.call('PATCH', '/api/admin/users/8', { perm_concept_map: false }, { user: 7 });
  assert.equal(r.body.perm_concept_map, false);
  assert.equal((await t.call('PATCH', '/api/admin/users/8', { perm_concept_map: true }, { user: 8 })).status, 403, '일반 사용자는 못 바꿈');
});

test('소스 확인: server.js 라우터 등록, /api/me 와 신규 가입 INSERT, admin.html 토글', () => {
  const root = path.join(__dirname, '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const server = read('server.js');
  assert.ok(server.indexOf("require('./routes/concept_study')") < server.indexOf("require('./routes/concept_map')"), '개념 지도 라우터는 기존 라우터 뒤에 한 줄');
  const auth = read('routes/auth.js');
  assert.match(auth, /perm_voice_study, perm_concept_study, perm_concept_map\s+FROM users WHERE id = \$1/, '/api/me SELECT 에 열 포함');
  assert.match(auth, /perm_concept_map: false/, 'DB 없는 응답은 닫힘');
  const insert = auth.slice(auth.indexOf('INSERT INTO users'), auth.indexOf('RETURNING *'));
  assert.doesNotMatch(insert, /perm_/, '신규 가입 INSERT 는 권한 열을 쓰지 않으므로 DB 기본값(false)이 적용됨');
  const admin = read('public/admin.html');
  assert.match(admin, /<th>개념 지도<\/th>/);
  assert.match(admin, /permToggleStrict\(u, 'perm_concept_map', '개념 지도'\)/);
  assert.match(admin, /function permToggleStrict[\s\S]*?u\[field\] === true/, '값이 없거나 false 면 꺼짐');
});
