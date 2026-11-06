// 작업405: 404 이후 requireAuth 가 앞에서 막아 HTTP 로는 도달할 수 없게 된 기능 권한 검사(requireSpeakloopPerm · requireJgrammarPerm)를
// req/res/DB 모의로 직접 호출해 fail-closed 분기를 시험한다: DB 없음·조회 오류·차단·권한 false·값 없음·행 없음은 403, 관리자(이메일·DB role)와 권한 true 는 통과.
// requireCmapPerm 은 routes/concept_map.js 가 내보내지 않고(이번 작업의 수정 허용 범위 밖) 이 시험에 포함하지 않는다.
// 실행: node --test tests/auth_gate_perm.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.ADMIN_EMAILS = 'boss@example.com';
const { startApp, ROOT } = require('./helpers/app');

function createDb() {
  const db = { queries: [], fail: false, rows: new Map() };
  db.pool = {
    query: async (sql, params = []) => {
      db.queries.push(sql.replace(/\s+/g, ' ').trim());
      if (db.fail) throw new Error('users down');
      return { rows: db.rows.has(params[0]) ? [db.rows.get(params[0])] : [] };
    },
  };
  db.trackUsage = () => {};
  return db;
}

const CASES = [
  { name: 'requireSpeakloopPerm', file: 'routes/speakloop.js', col: 'perm_speakloop' },
  { name: 'requireJgrammarPerm', file: 'routes/jgrammar.js', col: 'perm_jgrammar' },
];

async function call(fn, user) {
  let code = null, body = null, nextCalled = false;
  const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
  await fn({ user }, res, () => { nextCalled = true; });
  return { code, body, nextCalled };
}

for (const c of CASES) {
  test(`405-D. ${c.name}: DB 없음·조회 오류·차단·권한 false·값 없음·행 없음은 403(fail-closed), 관리자·권한 true 는 통과`, async t => {
    const db = createDb();
    const app = await startApp([c.file], { db });
    const savedUrl = process.env.DATABASE_URL;
    const origError = console.error; console.error = () => {};
    t.after(() => { console.error = origError; process.env.DATABASE_URL = savedUrl; return app.close(); });
    const fn = require(path.join(ROOT, c.file))[c.name];
    assert.equal(typeof fn, 'function', c.name + ' 이 내보내져 있다');
    const row = (extra) => Object.assign({ role: 'user', is_blocked: false, [c.col]: true }, extra);
    db.rows.set(1, row());                                  // 권한 true
    db.rows.set(2, row({ [c.col]: false }));                // 권한 false
    db.rows.set(3, row({ is_blocked: true }));              // 차단(권한 true)
    db.rows.set(4, row({ role: 'admin', [c.col]: false })); // DB 관리자(권한 false)
    db.rows.set(5, row({ [c.col]: null }));                 // 값 없음(마이그레이션 직후)
    db.rows.set(6, row({ [c.col]: 'true' }));               // true 가 아닌 값
    db.rows.set(7, row({ role: 'admin', is_blocked: true, [c.col]: false }));   // 차단된 DB 관리자: role 이 먼저라 통과(현재 동작을 그대로 고정)
    const U = (id, email) => ({ id, email: email || `u${id}@example.com` });

    // 통과
    for (const [label, user] of [['권한 true', U(1)], ['DB 관리자(권한 false)', U(4)], ['이메일 관리자(users 행 없음)', U(99, 'Boss@Example.com')]]) {
      const r = await call(fn, user); assert.equal(r.nextCalled, true, label); assert.equal(r.code, null, label);
    }
    // 거부 403
    for (const [label, user] of [['권한 false', U(2)], ['차단', U(3)], ['값 없음(null)', U(5)], ['true 가 아닌 값', U(6)], ['행 없음', U(98)]]) {
      const r = await call(fn, user); assert.equal(r.nextCalled, false, label); assert.equal(r.code, 403, label); assert.equal(r.body.ok, false, label);
    }
    // 조회 오류 → 403
    const before = db.queries.length;
    db.fail = true;
    const e = await call(fn, U(1)); assert.equal(e.nextCalled, false); assert.equal(e.code, 403); assert.equal(e.body.ok, false);
    assert.equal(db.queries.length, before + 1, '조회가 실제로 실행되어 오류를 냈다');
    assert.ok(!JSON.stringify(e.body).includes('users down'), '오류 내용은 응답에 없다');
    // 이메일 관리자는 DB 를 보지 않으므로 DB 오류에도 통과
    const ea = await call(fn, U(99, 'boss@example.com')); assert.equal(ea.nextCalled, true);
    assert.equal(db.queries.length, before + 1, '이메일 관리자는 DB 조회 없음');
    db.fail = false;
    // DB 없음 → 403(이메일 관리자는 통과)
    delete process.env.DATABASE_URL;
    const n = db.queries.length;
    const nd = await call(fn, U(1)); assert.equal(nd.nextCalled, false); assert.equal(nd.code, 403); assert.equal(nd.body.ok, false);
    assert.equal((await call(fn, U(4))).code, 403, 'DB 없으면 DB 관리자도 확인할 수 없어 거부');
    assert.equal((await call(fn, U(99, 'boss@example.com'))).nextCalled, true, '이메일 관리자는 DB 없이도 통과');
    assert.equal(db.queries.length, n, 'DB 없음일 때 조회하지 않는다');
  });
}
