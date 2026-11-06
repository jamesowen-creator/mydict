// 작업404: requireAuth/requireAdmin/api/me 가 매 요청 DB에서 승인·차단을 확인하는지, 로그인 콜백이 차단 사용자에게 토큰을 주지 않는지.
// 모의 DB(users)만 쓴다. 운영 서버·운영 DB와 무관.  실행: node --test tests/auth_gate.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.ADMIN_EMAILS = 'boss@example.com';
const { startApp, ROOT } = require('./helpers/app');

function createDb() {
  const db = { users: new Map(), fail: false, authQueries: 0 };
  const mk = (extra) => Object.assign({ is_approved: true, is_blocked: false, role: 'user' }, extra);
  db.users.set(1, mk());                                        // 일반·승인
  db.users.set(2, mk({ is_approved: false }));                  // 미승인
  db.users.set(3, mk({ is_blocked: true }));                    // 승인돼 있지만 차단
  db.users.set(4, mk({ role: 'admin' }));                       // DB 관리자
  db.users.set(5, mk({ role: 'admin', is_approved: false }));   // 미승인 관리자
  db.users.set(6, mk({ is_approved: false }));                  // 이메일 관리자(boss@example.com), 미승인
  db.pool = {
    query: async (sql, params = []) => {
      if (/^SELECT is_approved, is_blocked, role FROM users/.test(sql)) {
        db.authQueries++;
        if (db.fail) throw new Error('db down');
        const u = db.users.get(params[0]);
        return { rows: u ? [{ is_approved: u.is_approved, is_blocked: u.is_blocked, role: u.role }] : [] };
      }
      if (/^\s*SELECT id, email, name, role, is_blocked/.test(sql)) {
        const u = db.users.get(params[0]);
        return { rows: u ? [{ id: params[0], email: 'x', name: 'x', ...u }] : [] };
      }
      if (/^UPDATE users SET role/.test(sql)) return { rows: [] };
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: 0, active: 0, blocked: 0, pending: 0 }] };
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 60));
    },
  };
  db.trackUsage = () => {};
  return db;
}
const secret = () => process.env.JWT_SECRET || 'mydict-jwt-secret';
async function setup() {
  const db = createDb();
  const t = await startApp(['routes/auth.js', 'routes/admin.js'], { db });
  const as = (id, email) => async (url) => {
    const token = jwt.sign({ id, email: email || 'u' + id + '@example.com' }, secret());
    const r = await fetch(t.base + url, { headers: { Authorization: 'Bearer ' + token } });
    let body = null;
    try { body = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { status: r.status, body };
  };
  return { db, t, as };
}
const ME = '/api/me', ADM = '/api/admin/stats';

test('404-1. 승인된 일반 사용자는 통과, 미승인 403 approval_pending, 차단 403 blocked(승인돼 있어도)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.as(1)(ME)).status, 200);
  const p = await a.as(2)(ME); assert.equal(p.status, 403); assert.equal(p.body.code, 'approval_pending');
  const b = await a.as(3)(ME); assert.equal(b.status, 403); assert.equal(b.body.code, 'blocked');
});

test('404-2. 관리자(DB role·ADMIN_EMAILS)는 미승인이어도 통과, 차단이면 관리자도 403', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.as(5)(ME)).status, 200, 'DB 관리자 미승인');
  assert.equal((await a.as(6, 'boss@example.com')(ME)).status, 200, '이메일 관리자 미승인');
  a.db.users.get(4).is_blocked = true;
  const r = await a.as(4)(ME); assert.equal(r.status, 403); assert.equal(r.body.code, 'blocked');
});

test('404-3. 행 없음 401 auth_invalid, DB 오류 503 auth_unavailable(통과 안 됨), 토큰 없음·서명 오류는 기존 401', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const none = await a.as(99)(ME); assert.equal(none.status, 401); assert.equal(none.body.code, 'auth_invalid');
  a.db.fail = true;
  const down = await a.as(1)(ME); assert.equal(down.status, 503); assert.equal(down.body.code, 'auth_unavailable');
  a.db.fail = false;
  const before = a.db.authQueries;
  assert.equal((await fetch(a.t.base + ME)).status, 401);
  assert.equal((await fetch(a.t.base + ME, { headers: { Authorization: 'Bearer nope' } })).status, 401);
  const wrongSig = jwt.sign({ id: 1, email: 'u1@example.com' }, 'other-secret');
  assert.equal((await fetch(a.t.base + ME, { headers: { Authorization: 'Bearer ' + wrongSig } })).status, 401);
  assert.equal(a.db.authQueries, before, '토큰이 없거나 서명이 틀리면 DB를 조회하지 않는다');
});

test('404-4. 승인 취소·차단은 같은 토큰에 즉시 반영된다(캐시 없음, 요청마다 DB 1회)', async t => {
  const a = await setup(); t.after(() => a.t.close());
  const me = a.as(1);
  const before = a.db.authQueries;
  assert.equal((await me(ME)).status, 200);
  a.db.users.get(1).is_approved = false;
  const r = await me(ME); assert.equal(r.status, 403); assert.equal(r.body.code, 'approval_pending');
  a.db.users.get(1).is_approved = true; assert.equal((await me(ME)).status, 200);
  a.db.users.get(1).is_blocked = true; assert.equal((await me(ME)).body.code, 'blocked');
  assert.equal(a.db.authQueries - before, 4);
});

test('404-5. requireAdmin: 관리자 통과, 일반·미승인·차단 비관리자 403', async t => {
  const a = await setup(); t.after(() => a.t.close());
  assert.equal((await a.as(4)(ADM)).status, 200);
  assert.equal((await a.as(6, 'boss@example.com')(ADM)).status, 200);
  assert.equal((await a.as(1)(ADM)).status, 403, '승인된 일반 사용자');
  const p = await a.as(2)(ADM); assert.equal(p.status, 403); assert.equal(p.body.code, 'approval_pending');
  const b = await a.as(3)(ADM); assert.equal(b.status, 403); assert.equal(b.body.code, 'blocked');
  assert.equal((await a.as(99)(ADM)).status, 401);
});

test('404-6. 로그인 콜백: 차단은 토큰 없이 approval=blocked, 미승인은 approval=pending, 승인은 토큰, 관리자 이메일 자동 승인 INSERT 유지', async t => {
  const app = await startApp(['routes/auth.js'], { db: createDb() });
  t.after(() => app.close());
  const router = require(path.join(ROOT, 'routes', 'auth.js'));
  const layer = router.stack.find(l => l.route && l.route.path === '/auth/google/callback');
  const final = layer.route.stack[layer.route.stack.length - 1].handle;
  const run = (user, state = '/x') => { let url = null; final({ user, query: { state } }, { redirect: u => { url = u; } }); return url; };
  const base = { id: 1, email: 'a@example.com', name: 'A', role: 'user' };
  assert.equal(run({ ...base, is_approved: true, is_blocked: true }), '/x?approval=blocked');
  assert.equal(run({ ...base, is_approved: false, is_blocked: true }), '/x?approval=blocked', '차단이 미승인보다 먼저');
  assert.equal(run({ ...base, role: 'admin', is_approved: true, is_blocked: true }), '/x?approval=blocked', '관리자 이메일이 차단돼 있어도 같다');
  assert.equal(run({ ...base, is_approved: false, is_blocked: false }), '/x?approval=pending');
  assert.match(run({ ...base, is_approved: true, is_blocked: false }), /^\/x\?token=/);
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');
  assert.match(src, /VALUES \(\$1, \$2, \$3, COALESCE\(\$4, 'user'\), \$5\)/, '관리자 이메일 자동 승인 INSERT 유지');
  assert.match(src, /\[profile\.id, email, displayName, role, isAdminEmail\]/);
});

test('404-7. 헬스체크 GET / 와 정적 파일은 인증 밖: "/" 핸들러·static 이 라우터보다 앞에 있고 server.js 는 인증 미들웨어를 쓰지 않는다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.doesNotMatch(src, /requireAuth|requireAdmin/);
  const iRoot = src.indexOf("app.get('/'"), iStatic = src.indexOf('express.static'), iRouter = src.indexOf("require('./routes/auth')");
  assert.ok(iRoot > 0 && iRoot < iRouter && iStatic < iRouter);
  assert.match(fs.readFileSync(path.join(ROOT, 'railway.toml'), 'utf8'), /healthcheckPath = "\/"/);
  const auth = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');
  assert.match(auth, /router\.get\('\/auth\/google',\s*\(req/, '/auth/google 은 requireAuth 없음');
});
