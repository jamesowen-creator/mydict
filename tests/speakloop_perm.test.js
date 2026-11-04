// 작업395: Speak Loop 권한(users.perm_speakloop) — 기본 차단, 오류 시에도 차단(fail-closed), 관리자는 항상 허용. 콘텐츠 API 와 재생 API 모두 같은 규칙.
// 실행: node --test tests/speakloop_perm.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_EMAILS = 'u5@example.com';   // 테스트 토큰의 이메일은 u<id>@example.com
const { startApp } = require('./helpers/app');
const { createSlDb } = require('./helpers/speakloop_db');

const PATHS = ['/api/speakloop/content', '/api/speakloop/audio-index', '/api/speakloop/audio/hang-out.say'];
async function setup(opts) {
  const db = createSlDb(opts);
  const app = await startApp(['routes/speakloop.js'], { db });
  return { db, app };
}

test('권한 없음(false)·사용자 행 없음·차단 계정은 모든 사용자 API 에서 403 이고 음성 테이블을 건드리지 않는다', async t => {
  const { db, app } = await setup();
  t.after(() => app.close());
  for (const user of [3, 77, 9]) for (const p of PATHS) {
    const r = await app.call('GET', p, undefined, { user });
    assert.equal(r.status, 403, user + ' ' + p);
    assert.equal(r.body.ok, false);
  }
  assert.deepEqual(db.queries.filter(q => /speakloop_audio/.test(q)), []);
});

test('권한 있음(true)은 콘텐츠 200, 로그인 없음은 401', async t => {
  const { app } = await setup();
  t.after(() => app.close());
  const r = await app.call('GET', '/api/speakloop/content', undefined, { user: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.idioms.length, 20);
  assert.equal(r.body.monologues.length, 10);
  assert.equal((await app.call('GET', '/api/speakloop/content', undefined, { user: null })).status, 401);
});

test('권한 조회 중 오류가 나면 차단(fail-closed)', async t => {
  const { app } = await setup({ failUsers: true });
  t.after(() => app.close());
  for (const p of PATHS) assert.equal((await app.call('GET', p, undefined, { user: 1 })).status, 403, p);
});

test('DATABASE_URL 이 없으면 차단(fail-closed), 단 ADMIN_EMAILS 관리자는 콘텐츠를 볼 수 있다', async t => {
  const saved = process.env.DATABASE_URL;
  const { app } = await setup();
  t.after(() => { process.env.DATABASE_URL = saved; return app.close(); });
  delete process.env.DATABASE_URL;
  assert.equal((await app.call('GET', '/api/speakloop/content', undefined, { user: 1 })).status, 403);
  assert.equal((await app.call('GET', '/api/speakloop/content', undefined, { user: 5 })).status, 200);
});

test('관리자는 항상 허용: DB role=admin 은 권한 열이 false 여도, ADMIN_EMAILS 이메일은 사용자 행이 없어도 통과', async t => {
  const { app } = await setup();
  t.after(() => app.close());
  assert.equal((await app.call('GET', '/api/speakloop/content', undefined, { user: 4 })).status, 200);
  assert.equal((await app.call('GET', '/api/speakloop/content', undefined, { user: 5 })).status, 200);
});

test('콘텐츠가 불량이면 열지 않는다(500, fail-closed)', async t => {
  const realRead = fs.readFileSync;
  const { app } = await setup();
  t.after(() => { fs.readFileSync = realRead; return app.close(); });
  const contentPath = path.join(__dirname, '..', 'data', 'speakloop', 'content.json');
  fs.readFileSync = function (p, ...rest) { return String(p) === contentPath ? '{"idioms":[],' : realRead.call(this, p, ...rest); };
  const origError = console.error; console.error = () => {};
  try {
    const r = await app.call('GET', '/api/speakloop/content', undefined, { user: 1 });
    assert.equal(r.status, 500);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.idioms, undefined);
  } finally { console.error = origError; }
});

test('컬럼 기본값은 차단이고, 관리자 API·/api/me·관리자 화면이 perm_speakloop 을 다룬다', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.ok(read('lib/db.js').includes('ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_speakloop BOOLEAN NOT NULL DEFAULT false'));
  const admin = read('routes/admin.js'), auth = read('routes/auth.js'), html = read('public/admin.html');
  assert.match(admin, /u\.perm_speakloop/);
  assert.match(admin, /allowed = \[[^\]]*'perm_speakloop'/);
  assert.match(admin, /RETURNING[^`]*perm_speakloop/);
  assert.match(auth, /perm_speakloop: false/);
  assert.match(auth, /SELECT id, email, name, role, is_blocked, perm_versus, perm_speakloop,/);
  assert.match(html, /permToggleStrict\(u, 'perm_speakloop', 'Speak Loop'\)/);
  assert.match(read('server.js'), /require\('\.\/routes\/speakloop'\)/);
});
