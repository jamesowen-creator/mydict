// 작업344: /api/me 가 perm_versus 를 내려주고, 관리자 목록·저장 응답에 perm_versus 열이 들어간다. 모의 DB 만 쓴다 — 운영 서버·DB·외부 API 와 무관.
// 실행: node --test tests/versus_entry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_EMAILS = 'boss@example.com';
const { startApp } = require('./helpers/app');

function createDb() {
  const db = { users: new Map(), sqls: [] };
  db.users.set(1, { id: 1, email: 'a@example.com', name: 'A', role: 'user', is_blocked: false, perm_versus: true });
  db.users.set(2, { id: 2, email: 'b@example.com', name: 'B', role: 'user', is_blocked: false, perm_versus: false });
  db.users.set(3, { id: 3, email: 'c@example.com', name: 'C', role: 'admin', is_blocked: false, perm_versus: false });
  db.users.set(4, { id: 4, email: 'd@example.com', name: 'D', role: 'user', is_blocked: false, perm_versus: null });
  db.pool = {
    query: async (sql, params = []) => {
      db.sqls.push(sql);
      if (/^\s*SELECT id, email, name, role, is_blocked, perm_versus,/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ ...u }] : [] }; }
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 60));
    },
  };
  db.trackUsage = () => {};
  return db;
}

test('344-1. /api/me: perm_versus 가 true 면 true, false·null 이면 false, 관리자(DB role)는 열이 false 여도 true', async t => {
  const db = createDb(); const app = await startApp(['routes/auth.js'], { db }); t.after(() => app.close());
  const me = async id => (await app.call('GET', '/api/me', undefined, { user: id }));
  assert.equal((await me(1)).body.perm_versus, true);
  assert.equal((await me(2)).body.perm_versus, false);
  assert.equal((await me(3)).body.perm_versus, true, '관리자는 true');
  assert.equal((await me(4)).body.perm_versus, false, 'null 은 false');
  assert.equal((await app.call('GET', '/api/me', undefined, { user: null })).status, 401);
});

test('344-2. 소스: /api/me SELECT 에 perm_versus 가 있고 기존 열 목록 문구(perm_concept_map, perm_jgrammar FROM)는 그대로다. 관리자 목록·저장 응답에도 열이 있다', () => {
  const root = path.join(__dirname, '..');
  const auth = fs.readFileSync(path.join(root, 'routes', 'auth.js'), 'utf8');
  assert.match(auth, /SELECT id, email, name, role, is_blocked, perm_versus,/);
  assert.match(auth, /perm_voice_study, perm_concept_map, perm_jgrammar\s+FROM users WHERE id = \$1/);
  assert.match(auth, /perm_versus: emailIsAdmin/, 'DB 없이 실행할 때는 관리자 이메일만 true');
  const admin = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
  assert.match(admin, /u\.is_approved, u\.perm_versus,/, '관리자 목록 SELECT');
  assert.match(admin, /RETURNING id, email, name, role, is_blocked, is_approved, perm_versus,/, '저장 응답');
});

test('344-3. 관리자 화면 소스: 대결 열은 별도 토글(기본 꺼짐)이고 언어 사전 5개 묶음에 들어가지 않는다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.match(html, /permToggleStrict\(u, 'perm_versus', '대결'\)/);
  assert.match(html, /<th>대결<\/th>/);
  assert.doesNotMatch(html, /DICTIONARY_PERMS[^;]*perm_versus/);
});
