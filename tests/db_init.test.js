// 작업211: initDB 단계별 오류 처리 + /api 준비 대기. 실행: node --test "tests/**/*.test.js"
//  - 실행된 SQL 문장 목록(순서 포함)이 변경 전(기준: tests/fixtures/init_sql_baseline.json)과 같은지
//  - 중간 단계가 실패해도 이후 단계가 실행되고, 실패 단계 이름과 요약 로그가 맞는지
//  - 선행 단계가 실패하면 마이그레이션을 건너뛰는지
//  - /api 요청만 initDB 완료(최대 15초)를 기다리고, 정적 파일·"/"는 즉시 응답하는지
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { recordInit } = require('./helpers/init_recorder');
const baseline = require('./fixtures/init_sql_baseline.json');
const baseline211 = require('./fixtures/init_sql_baseline_211.json');   // 작업211 시점의 기준(72문장)

const STEPS = ['client_encoding', 'users', 'users_name_repair', 'wordbook', 'tts_cache', 'api_usage', 'review_log', 'voice_notes', 'voice_quizzes',
  'voice_quiz_attempts', 'voice_concepts', 'voice_links', 'voice_links_user_edit', 'voice_images', 'concept_user_permission', 'concept_studies', 'concept_items', 'concept_links',
  'concept_links_user_edited', 'concept_links_relation_types_v2', 'concept_quiz_attempts', 'concept_migrations_table', 'concept_migration_v1', 'concept_migration_v2'];
const summaryOf = r => r.logs.filter(l => l.startsWith('[DB] init done:'));
const failedLogs = r => r.logs.filter(l => l.startsWith('[DB] init step failed:'));
const sqlText = r => r.sqls.map(x => x.sql);

// 작업227-9: concept_links_relation_types_v2 단계가 실행하는 문장(user_edited ALTER 뒤, concept_quiz_attempts CREATE 앞)을 따로 떼어 낸다.
// 그 밖의 문장은 변경 전 기준(baseline)과 완전히 같아야 한다.
function splitRelStep(sqls) {
  const i = sqls.findIndex(x => /^ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS user_edited/.test(x.sql));
  const j = sqls.findIndex(x => /^CREATE TABLE IF NOT EXISTS concept_quiz_attempts/.test(x.sql));
  assert.ok(i >= 0 && j > i, '단계 위치');
  return { step: sqls.slice(i + 1, j), rest: sqls.slice(0, i + 1).concat(sqls.slice(j)) };
}

for (const scenario of ['fresh', 'v1done']) {
  test(`실행 SQL 목록 비교(${scenario}): 변경 후 initDB가 실행한 문장·순서·인자가 변경 전 기준과 완전히 같다`, async () => {
    const r = await recordInit({ scenario });
    assert.equal(r.error, null);
    const { step, rest } = splitRelStep(r.sqls);   // 작업227-9: 새 CHECK 단계의 문장은 따로 비교(아래 새 테스트와 concept_links_check_v2.test.js)
    assert.equal(step.length, 6, '새 CHECK 단계 문장 수(조회, BEGIN, LOCK, 조회, ADD, COMMIT)');
    assert.equal(baseline[scenario].length, 75, '기준 문장 수(211의 72 + 작업214-2의 voice_links 컬럼 3)');
    assert.equal(rest.length, baseline[scenario].length, '문장 수');
    for (let i = 0; i < rest.length; i++) {
      assert.deepEqual(rest[i], baseline[scenario][i], `${i + 1}번째 문장 차이`);
    }
  });
}

for (const scenario of ['fresh', 'v1done']) {
  test(`SQL 목록(${scenario}): 작업214-2가 추가한 voice_links 컬럼 3문장을 빼면 작업211 기준(72문장)과 완전히 같다 — 기존 SQL은 그대로`, async () => {
    const r0 = await recordInit({ scenario });
    const r = { ...r0, sqls: splitRelStep(r0.sqls).rest };   // 작업227-9: 새 CHECK 단계 문장은 제외하고 비교
    const added = r.sqls.filter(x => /^ALTER TABLE voice_links ADD COLUMN IF NOT EXISTS (source TEXT NOT NULL DEFAULT 'ai'|user_edited BOOLEAN NOT NULL DEFAULT false|hidden BOOLEAN NOT NULL DEFAULT false)$/.test(x.sql));
    assert.equal(added.length, 3);
    assert.deepEqual(r.sqls.filter(x => !added.includes(x)), baseline211[scenario]);
    // 새 문장은 voice_links 단계 바로 뒤(voice_images 앞)에 있다
    const iLast = r.sqls.findIndex(x => /idx_voice_links_to/.test(x.sql));
    assert.ok(r.sqls.findIndex(x => x === added[0]) > iLast);
    assert.ok(r.sqls.findIndex(x => x === added[2]) < r.sqls.findIndex(x => /^CREATE TABLE IF NOT EXISTS voice_image_sets/.test(x.sql)));
  });
}

test('정상: 24단계 모두 성공, 요약 로그 "실패 0단계", 반환값, client 반환', async () => {
  const r = await recordInit();
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 24단계, 실패 0단계']);
  assert.deepEqual(r.result, { total: 24, failed: [], skipped: [] });
  assert.equal(failedLogs(r).length, 0);
  assert.equal(r.released, true);
  assert.equal(STEPS.length, 24);
});

test('중간 단계(voice_notes)가 실패해도 이후 단계가 계속 실행되고, 실패 이름과 요약이 로그에 남음', async () => {
  const r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS voice_notes/ });
  assert.equal(r.error, null, '예외로 끝나지 않음(서버는 계속 시작)');
  assert.deepEqual(r.result.failed, ['voice_notes']);
  const fl = failedLogs(r);
  assert.equal(fl.length, 1);
  assert.match(fl[0], /^\[DB\] init step failed: voice_notes: 주입된 오류/);
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 24단계, 실패 1단계 (실패: voice_notes)']);
  const sqls = sqlText(r);
  assert.ok(sqls.some(s => /^ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS user_edited/.test(s)), '뒤쪽 user_edited ALTER도 실행됨');
  assert.ok(sqls.some(s => /^CREATE TABLE IF NOT EXISTS concept_quiz_attempts/.test(s)));
  assert.ok(!sqls.some(s => /^CREATE INDEX IF NOT EXISTS idx_voice_notes_user_id/.test(s)), '실패한 단계의 나머지 문장은 실행하지 않음');
  assert.ok(sqls.some(s => /^SELECT 1 FROM concept_migrations/.test(s)), '마이그레이션은 선행 단계(voice_concepts 등)가 성공이라 실행됨');
  assert.equal(r.released, true);
});

test('이름 복구 단계의 조회가 실패해도 다음 단계(wordbook 이후)를 계속 실행', async () => {
  const r = await recordInit({ failOn: /^SELECT id, name FROM users WHERE name IS NOT NULL ORDER BY id$/ });
  assert.deepEqual(r.result.failed, ['users_name_repair']);
  assert.ok(sqlText(r).some(s => /^CREATE TABLE IF NOT EXISTS wordbook/.test(s)));
});

test('여러 단계 실패: 요약에 실패 이름이 순서대로 나열됨', async () => {
  const r = await recordInit({ failOn: /^(CREATE TABLE IF NOT EXISTS tts_cache|CREATE TABLE IF NOT EXISTS concept_quiz_attempts)/ });
  assert.deepEqual(r.result.failed, ['tts_cache', 'concept_quiz_attempts']);
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 24단계, 실패 2단계 (실패: tts_cache, concept_quiz_attempts)']);
  assert.equal(failedLogs(r).length, 2);
  assert.ok(sqlText(r).some(s => /^CREATE TABLE IF NOT EXISTS concept_migrations/.test(s)));
});

test('user_edited ALTER가 있는 단계는 앞쪽 단계(users)가 실패해도 실행된다', async () => {
  const r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS users/ });
  assert.deepEqual(r.result.failed.slice(0, 1), ['users']);
  assert.ok(sqlText(r).some(s => /^ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS user_edited BOOLEAN NOT NULL DEFAULT false/.test(s)));
});

test('선행 DDL 단계가 실패하면 마이그레이션 v1·v2는 건너뛰고 이유를 로그에 남김', async () => {
  const r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS concept_items/ });
  assert.deepEqual(r.result.failed, ['concept_items']);
  assert.deepEqual(r.result.skipped, ['concept_migration_v1', 'concept_migration_v2']);
  const skips = r.logs.filter(l => l.startsWith('[DB] init step skipped:'));
  assert.deepEqual(skips, [
    '[DB] init step skipped: concept_migration_v1: 선행 단계 실패 (concept_items)',
    '[DB] init step skipped: concept_migration_v2: 선행 단계 실패 (concept_items)',
  ]);
  const sqls = sqlText(r);
  assert.equal(sqls.filter(x => x === 'BEGIN').length, 1, '마이그레이션 트랜잭션은 시작하지 않음(BEGIN 1번은 작업227-9 의 CHECK 확장 단계)');
  assert.ok(!sqls.some(x => /^INSERT INTO concept_migrations/.test(x)), '마이그레이션 완료 표시도 남기지 않음');
  assert.ok(!sqls.some(s => /FROM voice_concepts/.test(s)), '원본 voice_concepts를 읽지 않음');
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 24단계, 실패 1단계 (실패: concept_items), 건너뜀 2단계 (건너뜀: concept_migration_v1, concept_migration_v2)']);
});

test('선행 단계 중 하나(voice_concepts, concept_migrations_table)만 실패해도 마이그레이션 건너뜀', async () => {
  for (const [re, name] of [[/^CREATE TABLE IF NOT EXISTS voice_concepts/, 'voice_concepts'], [/^CREATE TABLE IF NOT EXISTS concept_migrations/, 'concept_migrations_table'], [/^CREATE TABLE IF NOT EXISTS concept_studies/, 'concept_studies']]) {
    const r = await recordInit({ failOn: re });
    assert.deepEqual(r.result.failed, [name]);
    assert.deepEqual(r.result.skipped, ['concept_migration_v1', 'concept_migration_v2'], name);
  }
  // 선행과 무관한 단계(tts_cache) 실패는 마이그레이션에 영향 없음
  const ok = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS tts_cache/ });
  assert.deepEqual(ok.result.skipped, []);
});

test('마이그레이션 자체가 실패하면 ROLLBACK 후 실패 단계로 기록하고 서버 시작에는 영향 없음', async () => {
  const r = await recordInit({ failOn: /^SELECT 1 FROM concept_migrations WHERE name = \$1$/ });
  assert.equal(r.error, null);
  assert.deepEqual(r.result.failed, ['concept_migration_v1', 'concept_migration_v2']);
  assert.ok(sqlText(r).includes('ROLLBACK'));
  assert.ok(r.logs.some(l => /concept migration failed/.test(l)), '기존 오류 로그도 유지');
  assert.equal(summaryOf(r).length, 1);
});

test('DB 연결 자체가 안 되면 initDB는 예외를 던짐(server.js의 .catch가 로그)', async () => {
  const r = await recordInit({ connectError: 'connection refused' });
  assert.equal(r.error, 'connection refused');
  assert.equal(r.sqls.length, 0);
});

test('server.js: initDB 완료 Promise를 만들고 /api만 기다리는 미들웨어를 정적 파일 뒤·라우터 앞에 둔다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /dbReady = initDB\(\)\.catch\(/);
  const gate = src.indexOf("app.use('/api', createApiReadyGate(dbReady))");
  assert.ok(gate > 0);
  assert.ok(gate > src.indexOf('express.static'), '정적 파일은 기다리지 않음');
  assert.ok(gate < src.indexOf("app.use(require('./routes/auth'))"), '라우터보다 먼저');
  assert.ok(src.indexOf("app.get('/', ") < gate, '"/"(헬스체크)도 기다리지 않음');
});

// ── /api 준비 대기 ──
function loadGateFactory() {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (request, parent, ...rest) { if (request === 'pg') return { Pool: class { } }; return orig.call(this, request, parent, ...rest); };
  const dbPath = require.resolve('../lib/db.js');
  delete require.cache[dbPath];
  try { return require(dbPath).createApiReadyGate; } finally { Module._load = orig; delete require.cache[dbPath]; }
}
const createApiReadyGate = loadGateFactory();

async function gateServer(ready, timeoutMs) {
  const app = express();
  app.get('/', (req, res) => res.send('ok'));                       // 헬스체크
  app.use(express.static(path.join(__dirname, '..', 'public')));    // 정적 파일
  app.use('/api', createApiReadyGate(ready, timeoutMs));
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = async p => { const t0 = Date.now(); const res = await fetch(base + p); await res.text(); return { status: res.status, ms: Date.now() - t0 }; };
  return { get, close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) };
}

test('/api 대기: initDB가 끝날 때까지 /api 요청은 기다리고, "/"와 정적 파일은 즉시 응답', async () => {
  let release;
  const ready = new Promise(r => { release = r; });
  const s = await gateServer(ready, 15000);
  const pending = s.get('/api/ping');
  const fast = await Promise.all([s.get('/'), s.get('/sw.js')]);
  assert.deepEqual(fast.map(f => f.status), [200, 200]);
  assert.ok(fast.every(f => f.ms < 500), '즉시 응답: ' + JSON.stringify(fast));
  const raced = await Promise.race([pending.then(() => 'done'), new Promise(r => setTimeout(() => r('waiting'), 300))]);
  assert.equal(raced, 'waiting', 'initDB가 끝나기 전에는 /api가 응답하지 않음');
  release();
  const r = await pending;
  assert.equal(r.status, 200);
  assert.ok(r.ms >= 280, '지연된 만큼 기다렸다가 처리: ' + r.ms);
  const after = await s.get('/api/ping');
  assert.ok(after.ms < 300, '끝난 뒤에는 바로 처리');
  await s.close();
});

test('/api 대기: 시간 초과(여기서는 300ms)가 지나면 기다리지 않고 그대로 처리', async () => {
  const s = await gateServer(new Promise(() => { }), 300);
  const r = await s.get('/api/ping');
  assert.equal(r.status, 200);
  assert.ok(r.ms >= 250 && r.ms < 1500, '시간 초과 후 처리: ' + r.ms);
  await s.close();
});

test('/api 대기: initDB가 실패(거부)해도 처리하고, Promise가 없으면 기다리지 않음', async () => {
  let rej;
  const failing = new Promise((_, r) => { rej = r; });
  const s = await gateServer(failing, 15000);
  const p = s.get('/api/ping');
  setTimeout(() => rej(new Error('db down')), 100);
  const r = await p;
  assert.equal(r.status, 200);
  assert.ok(r.ms < 2000);
  await s.close();
  const none = await gateServer(null, 15000);
  const n = await none.get('/api/ping');
  assert.equal(n.status, 200);
  assert.ok(n.ms < 300);
  await none.close();
});

test('/api 대기: 기본 대기 시간은 15초', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8');
  assert.match(src, /function createApiReadyGate\(ready, timeoutMs = 15000\)/);
});
