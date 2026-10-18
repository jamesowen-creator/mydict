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
  'concept_links_user_edited', 'concept_links_relation_types_v2', 'concept_quiz_attempts', 'concept_migrations_table', 'concept_migration_v1', 'concept_migration_v2',
  'cmap_user_permission', 'cmap_topics', 'cmap_concepts', 'cmap_concept_explanation',
  'cmap_maps', 'cmap_map_nodes', 'cmap_edges', 'cmap_narrations', 'cmap_quiz_attempts', 'cmap_concept_marks', 'cmap_answer_attempts', 'cmap_edges_types_v2', 'cmap_edges_types_v3'];   // 작업270-1·271-1·273-1·273-2·273-4·273-5·275-4·278-1: 마지막 열한 단계가 개념 지도용으로 추가됨
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

// 작업270-1: 개념 지도 단계(cmap_user_permission, cmap_topics, cmap_concepts)의 문장은 맨 끝에 더해졌다. 그 문장들만 따로 떼어 내고 나머지는 기존 기준과 같음을 단언한다(의도된 변경).
const CMAP_SQL = /perm_concept_map|cmap_topics|idx_cmap_topics_|cmap_concepts|idx_cmap_concepts_|cmap_maps|idx_cmap_maps_|cmap_map_nodes|cmap_edges|idx_cmap_edges_|cmap_narrations|cmap_quiz_attempts|idx_cmap_quiz_attempts_|cmap_concept_marks|cmap_answer_attempts|idx_cmap_answer_attempts_/;
// 작업286-1: cmap_edges_types_v2 단계(pg_constraint 조회 … COMMIT)는 맨 끝에 있다. 그 문장들을 먼저 떼어 낸다(새 테스트가 따로 확인).
// 308-1: 37번 단계(cmap_edges_types_v3)의 문장은 v2 뒤 맨 끝에 있다. 상태 조회(information_schema) 문장에서 시작해, 잠금 안에서 변환했으면 COMMIT 까지, 이미 적용됐으면 조회 두 문장까지
const V3_STATE = /^SELECT \(SELECT is_nullable FROM information_schema\.columns/;
function splitV3Step(sqls) {
  const i = sqls.findIndex(x => V3_STATE.test(x.sql));
  if (i < 0) return { v3Step: [], without: sqls };
  let end = i + 2;                                              // 조회 2문장(상태, 제약 목록)
  if (sqls[i + 2] && sqls[i + 2].sql === 'BEGIN') { let j = i + 2; while (j < sqls.length && sqls[j].sql !== 'COMMIT') j++; end = j + 1; }
  return { v3Step: sqls.slice(i, end), without: sqls.slice(0, i).concat(sqls.slice(end)) };
}
function splitEdgeTypesStep(sqlsAll) {
  const sqls = splitV3Step(sqlsAll).without;
  const i = sqls.findIndex(x => /^SELECT c\.conname, pg_get_constraintdef\(c\.oid\) AS def FROM pg_constraint c WHERE c\.conrelid = 'cmap_edges'::regclass/.test(x.sql));
  if (i < 0) return { edgeStep: [], without: sqls };
  let end = i + 1;                                              // BEGIN 이 없었던(이미 적용된) 경우에는 조회 한 문장뿐
  if (sqls[i + 1] && sqls[i + 1].sql === 'BEGIN') { let j = i + 1; while (j < sqls.length && sqls[j].sql !== 'COMMIT') j++; end = j + 1; }
  return { edgeStep: sqls.slice(i, end), without: sqls.slice(0, i).concat(sqls.slice(end)) };
}
function withoutCmap(sqlsAll) {
  const sqls = splitEdgeTypesStep(sqlsAll).without;
  const cmap = sqls.filter(x => CMAP_SQL.test(x.sql));
  const rest = sqls.filter(x => !CMAP_SQL.test(x.sql));
  assert.equal(cmap.length, 23, '개념 지도 문장 수(users 열 1 + cmap_topics 1+4 + cmap_concepts 1+2 + 설명 열 3 + cmap_maps 1+1 + cmap_map_nodes 1 + cmap_edges 1+1 + cmap_narrations 1 + cmap_quiz_attempts 1+1 + cmap_concept_marks 1 + cmap_answer_attempts 1+1)');
  assert.equal(sqls.indexOf(cmap[0]), rest.length, '개념 지도 문장은 모두 맨 끝에 연속으로 있다');
  return { cmap, rest };
}

for (const scenario of ['fresh', 'v1done']) {
  test(`실행 SQL 목록 비교(${scenario}): 변경 후 initDB가 실행한 문장·순서·인자가 변경 전 기준과 완전히 같다`, async () => {
    const r = await recordInit({ scenario });
    assert.equal(r.error, null);
    const { step, rest } = splitRelStep(withoutCmap(r.sqls).rest);   // 작업227-9: 새 CHECK 단계의 문장은 따로 비교(아래 새 테스트와 concept_links_check_v2.test.js)
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
    const r = { ...r0, sqls: splitRelStep(withoutCmap(r0.sqls).rest).rest };   // 작업227-9: 새 CHECK 단계 문장은 제외하고 비교
    const added = r.sqls.filter(x => /^ALTER TABLE voice_links ADD COLUMN IF NOT EXISTS (source TEXT NOT NULL DEFAULT 'ai'|user_edited BOOLEAN NOT NULL DEFAULT false|hidden BOOLEAN NOT NULL DEFAULT false)$/.test(x.sql));
    assert.equal(added.length, 3);
    assert.deepEqual(r.sqls.filter(x => !added.includes(x)), baseline211[scenario]);
    // 새 문장은 voice_links 단계 바로 뒤(voice_images 앞)에 있다
    const iLast = r.sqls.findIndex(x => /idx_voice_links_to/.test(x.sql));
    assert.ok(r.sqls.findIndex(x => x === added[0]) > iLast);
    assert.ok(r.sqls.findIndex(x => x === added[2]) < r.sqls.findIndex(x => /^CREATE TABLE IF NOT EXISTS voice_image_sets/.test(x.sql)));
  });
}

test('정상: 37단계 모두 성공, 요약 로그 "실패 0단계", 반환값, client 반환', async () => {
  const r = await recordInit();
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 0단계']);
  assert.deepEqual(r.result, { total: 37, failed: [], skipped: [] });
  assert.equal(failedLogs(r).length, 0);
  assert.equal(r.released, true);
  assert.equal(STEPS.length, 37);
});

test('중간 단계(voice_notes)가 실패해도 이후 단계가 계속 실행되고, 실패 이름과 요약이 로그에 남음', async () => {
  const r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS voice_notes/ });
  assert.equal(r.error, null, '예외로 끝나지 않음(서버는 계속 시작)');
  assert.deepEqual(r.result.failed, ['voice_notes']);
  const fl = failedLogs(r);
  assert.equal(fl.length, 1);
  assert.match(fl[0], /^\[DB\] init step failed: voice_notes: 주입된 오류/);
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 1단계 (실패: voice_notes)']);
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
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 2단계 (실패: tts_cache, concept_quiz_attempts)']);
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
  assert.equal(sqls.filter(x => x === 'BEGIN').length, 3, '마이그레이션 트랜잭션은 시작하지 않음(BEGIN 3번은 작업227-9 의 CHECK 확장 단계, 작업286-1 의 cmap_edges 유형 확장 단계, 작업308-1 의 37번 단계)');
  assert.ok(!sqls.some(x => /^INSERT INTO concept_migrations/.test(x)), '마이그레이션 완료 표시도 남기지 않음');
  assert.ok(!sqls.some(s => /FROM voice_concepts/.test(s)), '원본 voice_concepts를 읽지 않음');
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 1단계 (실패: concept_items), 건너뜀 2단계 (건너뜀: concept_migration_v1, concept_migration_v2)']);
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

test('/api 대기: initDB가 끝날 때까지 /api 요청은 기다리고, "/"와 정적 파일은 즉시 응답', async t => {
  let release;
  const ready = new Promise(r => { release = r; });
  const s = await gateServer(ready, 15000);
  t.after(() => s.close());   // 작업273-1b: 단언이 실패해도 서버를 닫는다(안 닫으면 테스트 프로세스가 끝나지 않음)
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
});

test('/api 대기: 시간 초과(여기서는 300ms)가 지나면 기다리지 않고 그대로 처리', async t => {
  const s = await gateServer(new Promise(() => { }), 300);
  t.after(() => s.close());   // 작업273-1b
  const r = await s.get('/api/ping');
  assert.equal(r.status, 200);
  assert.ok(r.ms >= 250 && r.ms < 1500, '시간 초과 후 처리: ' + r.ms);
});

test('/api 대기: initDB가 실패(거부)해도 처리하고, Promise가 없으면 기다리지 않음', async t => {
  let rej;
  const failing = new Promise((_, r) => { rej = r; });
  const s = await gateServer(failing, 15000);
  t.after(() => s.close());   // 작업273-1b: 단언이 실패해도 서버를 닫는다
  const p = s.get('/api/ping');
  setTimeout(() => rej(new Error('db down')), 100);
  const r = await p;
  assert.equal(r.status, 200);
  assert.ok(r.ms < 2000);
  // 작업273-1b: 예전에는 "Promise 가 없으면 n.ms < 300(절대 시간)"이라 느린 환경에서 실패했다. 같은 요청을 initDB 가 일부러 3초 걸리는 서버(대조군)에도 보내
  // "기다리지 않는 쪽의 응답 시간 < 대조군 시간의 절반"으로 비교한다(대조군은 실제로 그만큼 기다렸다는 것도 함께 확인).
  const none = await gateServer(null, 15000);
  t.after(() => none.close());
  const slow = await gateServer(new Promise(r => setTimeout(r, 3000)), 15000);
  t.after(() => slow.close());
  const [n, w] = await Promise.all([none.get('/api/ping'), slow.get('/api/ping')]);
  assert.equal(n.status, 200); assert.equal(w.status, 200);
  assert.ok(w.ms >= 2500, '대조군은 initDB 가 끝날 때까지 기다림: ' + w.ms);
  assert.ok(n.ms < w.ms / 2, 'Promise 가 없으면 기다리지 않음(대조군 ' + w.ms + 'ms 의 절반 이내): ' + n.ms);
});

test('/api 대기: 기본 대기 시간은 15초', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8');
  assert.match(src, /function createApiReadyGate\(ready, timeoutMs = 15000\)/);
});

// ───────────────────────── 작업270-1: 개념 지도 단계 ─────────────────────────
test('개념 지도: users 열(기본값 false, NOT NULL)과 cmap_topics 테이블·제약·인덱스, 맨 끝에 위치', async () => {
  const r = await recordInit();
  const { cmap } = withoutCmap(r.sqls);
  const text = cmap.map(x => x.sql);
  assert.equal(text[0], 'ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_concept_map BOOLEAN NOT NULL DEFAULT false');
  const create = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_topics/.test(s));
  assert.ok(create, '테이블 생성 문장');
  assert.match(create, /user_id\s+INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(create, /parent_id\s+INTEGER REFERENCES cmap_topics\(id\),/, '부모 FK 는 ON DELETE 를 지정하지 않음(NO ACTION)');
  assert.match(create, /root_id\s+INTEGER REFERENCES cmap_topics\(id\),/);
  const selfRefs = [...create.matchAll(/REFERENCES cmap_topics\(id\)(\s+ON DELETE \w+)?/g)];
  assert.equal(selfRefs.length, 2, '자기 참조 FK 두 개(parent_id, root_id)');
  assert.ok(selfRefs.every(m => !m[1]), '자기 참조 FK 두 개 모두 ON DELETE 없음(NO ACTION)');
  assert.match(create, /title\s+TEXT NOT NULL CHECK \(char_length\(title\) BETWEEN 1 AND 80 AND btrim\(title\) <> ''\)/);
  assert.match(create, /sort_order\s+INTEGER NOT NULL DEFAULT 0/);
  assert.match(create, /CHECK \(\(parent_id IS NULL\) = \(root_id IS NULL\)\)/);
  for (const re of [/idx_cmap_topics_user_root ON cmap_topics\(user_id, root_id\)$/, /idx_cmap_topics_parent ON cmap_topics\(parent_id\)$/,
    /^CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_topics_root_title ON cmap_topics\(user_id, lower\(title\)\) WHERE parent_id IS NULL$/,
    /^CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_topics_child_title ON cmap_topics\(parent_id, lower\(title\)\) WHERE parent_id IS NOT NULL$/]) {
    assert.ok(text.some(s => re.test(s)), '인덱스: ' + re);
  }
  for (const s of text) assert.doesNotMatch(s, /^(DROP|DELETE|TRUNCATE)/i, '파괴적 문장 없음');
  assert.ok(text.filter(s => /^ALTER TABLE/.test(s)).every(s => /^ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_concept_map|^ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS (explanation|explanation_source|explained_at) /.test(s)), '기존 테이블 변경은 users 열 추가 1개뿐(개념 지도 테이블의 열 추가는 273-1 설명 열 3개)');
});

test('개념 지도: cmap_topics 단계가 실패해도 다른 단계는 영향 없음, users 가 실패하면 건너뜀', async () => {
  let r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_topics/ });
  assert.deepEqual(r.result.failed, ['cmap_topics']);
  r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS users/ });
  assert.ok(r.result.failed.includes('users'));
  assert.ok(r.result.skipped.includes('cmap_topics'));
  assert.ok(!sqlText(r).some(s => /^CREATE TABLE IF NOT EXISTS cmap_topics/.test(s)));
});

test('개념 지도(271-1): cmap_concepts 테이블·제약·인덱스, root_id 없음, 선행 단계 실패 시 건너뜀', async () => {
  const r = await recordInit();
  const text = withoutCmap(r.sqls).cmap.map(x => x.sql);
  const create = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_concepts/.test(s));
  assert.ok(create);
  assert.match(create, /user_id\s+INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(create, /topic_id\s+INTEGER NOT NULL REFERENCES cmap_topics\(id\) DEFERRABLE INITIALLY DEFERRED,/, 'ON DELETE 동작 없음(NO ACTION), 검사는 트랜잭션 끝으로');
  assert.doesNotMatch(create, /topic_id[^,]*ON DELETE/);
  assert.match(create, /term\s+TEXT NOT NULL CHECK \(char_length\(term\) BETWEEN 1 AND 80 AND btrim\(term\) <> ''\)/);
  assert.match(create, /english\s+TEXT CHECK \(english IS NULL OR char_length\(english\) <= 120\)/);
  assert.match(create, /memo\s+TEXT CHECK \(memo IS NULL OR char_length\(memo\) <= 2000\)/);
  assert.match(create, /content_source\s+TEXT NOT NULL DEFAULT 'manual'/);
  assert.match(create, /sort_order\s+INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(create, /root_id/, 'cmap_concepts 에는 root_id 를 두지 않는다');
  assert.ok(text.some(s => /^CREATE INDEX IF NOT EXISTS idx_cmap_concepts_user_topic ON cmap_concepts\(user_id, topic_id\)$/.test(s)));
  assert.ok(text.some(s => /^CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_concepts_topic_term ON cmap_concepts\(topic_id, lower\(term\)\)$/.test(s)));
  assert.ok(text.indexOf(create) > text.findIndex(s => /^CREATE TABLE IF NOT EXISTS cmap_topics/.test(s)), 'cmap_topics 뒤에 만든다');
  const r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_topics/ });
  assert.deepEqual(r2.result.failed, ['cmap_topics']);
  assert.ok(r2.result.skipped.includes('cmap_concepts'));
});

test('개념 지도(273-1): cmap_concepts 에 설명 열 3개만 추가(기존 열 변경 없음), 출처 CHECK, 선행 단계 실패 시 건너뜀', async () => {
  const r = await recordInit();
  const text = withoutCmap(r.sqls).cmap.map(x => x.sql);
  const alters = text.filter(s => /^ALTER TABLE cmap_concepts/.test(s));
  assert.deepEqual(alters, [
    'ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS explanation JSONB',
    "ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS explanation_source TEXT CHECK (explanation_source IN ('ai', 'manual'))",
    'ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS explained_at TIMESTAMPTZ',
  ]);
  assert.ok(text.indexOf(alters[0]) > text.findIndex(s => /^CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_concepts_topic_term/.test(s)), 'cmap_concepts 생성 뒤에 추가');
  for (const s of alters) assert.doesNotMatch(s, /DROP|ALTER COLUMN|NOT NULL/, '기존 열을 바꾸지 않고 NULL 허용 열만 추가');
  const r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_concepts/ });
  assert.deepEqual(r2.result.failed, ['cmap_concepts']);
  assert.ok(r2.result.skipped.includes('cmap_concept_explanation'));
});

test('개념 지도(273-2): cmap_maps·cmap_map_nodes·cmap_edges 의 제약(5종 CHECK·문구 필수·쌍 유일·복합 FK)과 순서, 선행 단계 실패 시 건너뜀', async () => {
  const r = await recordInit();
  const text = withoutCmap(r.sqls).cmap.map(x => x.sql);
  const at = re => text.findIndex(s => re.test(s));
  const maps = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_maps/.test(s));
  const nodes = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_map_nodes/.test(s));
  const edges = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_edges/.test(s));
  assert.ok(maps && nodes && edges);
  assert.ok(at(/^CREATE TABLE IF NOT EXISTS cmap_maps/) < at(/^CREATE TABLE IF NOT EXISTS cmap_map_nodes/) && at(/^CREATE TABLE IF NOT EXISTS cmap_map_nodes/) < at(/^CREATE TABLE IF NOT EXISTS cmap_edges/), '지도 → 노드 → 간선 순서');
  assert.ok(at(/^CREATE TABLE IF NOT EXISTS cmap_maps/) > at(/ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS explained_at/), '설명 열 단계 뒤');
  // 지도
  assert.match(maps, /user_id\s+INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(maps, /root_topic_id\s+INTEGER NOT NULL REFERENCES cmap_topics\(id\) DEFERRABLE INITIALLY DEFERRED/);
  assert.match(maps, /title\s+TEXT NOT NULL CHECK \(char_length\(title\) BETWEEN 1 AND 80 AND btrim\(title\) <> ''\)/);
  assert.match(maps, /semantic_hash\s+TEXT,/); assert.match(maps, /saved_at\s+TIMESTAMPTZ,/);
  assert.ok(text.some(s => /^CREATE INDEX IF NOT EXISTS idx_cmap_maps_user_root ON cmap_maps\(user_id, root_topic_id\)$/.test(s)));
  // 노드
  assert.match(nodes, /map_id\s+INTEGER NOT NULL REFERENCES cmap_maps\(id\) ON DELETE CASCADE/);
  assert.match(nodes, /concept_id\s+INTEGER NOT NULL REFERENCES cmap_concepts\(id\) ON DELETE CASCADE/);
  assert.match(nodes, /x\s+REAL,/); assert.match(nodes, /y\s+REAL,/); assert.match(nodes, /PRIMARY KEY \(map_id, concept_id\)/);
  // 간선: 관계 종류 5종 CHECK 는 개념 지도 상수(lib/cmap_map.js RELATION_TYPES)·고정 5개 값과 같은 코드명
  // 286-1: CREATE TABLE 문장은 처음 만들 때의 5종 그대로 두고(옛 DB 호환), 10종·문구 선택화는 맨 끝의 cmap_edges_types_v2 단계가 바꾼다(아래 테스트)
  const PREDICATES = ['사용', '일부', '종류', '일으킴', '구별'];
  // 308-1: 서버 상수는 3종이 되었다. 여기서는 처음 만들 때의 CREATE TABLE 문장이 기존 5개 값 그대로인지만 본다(옛 DB 호환, 아래 v2·v3 단계가 바꿈)
  assert.ok(edges.includes("relation_type TEXT CHECK (relation_type IS NULL OR relation_type IN (" + PREDICATES.map(p => "'" + p + "'").join(', ') + "))"), '5종 CHECK = PREDICATES: ' + edges.slice(edges.indexOf('relation_type'), edges.indexOf('relation_type') + 140));
  assert.match(edges, /label\s+TEXT NOT NULL CHECK \(char_length\(label\) BETWEEN 1 AND 40 AND btrim\(label\) <> ''\)/);
  assert.match(edges, /CHECK \(from_concept_id <> to_concept_id\)/);
  assert.match(edges, /UNIQUE \(map_id, from_concept_id, to_concept_id\)/);
  assert.match(edges, /FOREIGN KEY \(map_id, from_concept_id\) REFERENCES cmap_map_nodes\(map_id, concept_id\) ON DELETE CASCADE/);
  assert.match(edges, /FOREIGN KEY \(map_id, to_concept_id\) REFERENCES cmap_map_nodes\(map_id, concept_id\) ON DELETE CASCADE/);
  assert.ok(text.some(s => /^CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_edges_pair ON cmap_edges\(map_id, LEAST\(from_concept_id, to_concept_id\), GREATEST\(from_concept_id, to_concept_id\)\)$/.test(s)), '반대 방향의 같은 쌍도 거부');
  for (const s of [maps, nodes, edges]) assert.doesNotMatch(s, /DROP|TRUNCATE/);
  // 선행 단계 실패
  let r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_maps/ });
  assert.deepEqual(r2.result.failed, ['cmap_maps']); assert.ok(r2.result.skipped.includes('cmap_map_nodes') && r2.result.skipped.includes('cmap_edges'));
  r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_map_nodes/ });
  assert.deepEqual(r2.result.failed, ['cmap_map_nodes']); assert.ok(r2.result.skipped.includes('cmap_edges'));
});

test('개념 지도(273-4): cmap_narrations 는 지도당 1개(UNIQUE)·지도 삭제 시 함께 삭제(CASCADE)·마지막 단계이며, 선행 단계 실패 시 건너뜀', async () => {
  const r = await recordInit();
  const text = withoutCmap(r.sqls).cmap.map(x => x.sql);
  const at = re => text.findIndex(s => re.test(s));
  const nar = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_narrations/.test(s));
  assert.ok(nar);
  assert.ok(at(/^CREATE TABLE IF NOT EXISTS cmap_narrations/) > at(/^CREATE TABLE IF NOT EXISTS cmap_edges/), '간선 단계 뒤(맨 끝)');
  assert.match(nar, /map_id\s+INTEGER NOT NULL UNIQUE REFERENCES cmap_maps\(id\) ON DELETE CASCADE/);
  assert.match(nar, /user_id\s+INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(nar, /source_hash\s+TEXT NOT NULL/); assert.match(nar, /content\s+JSONB NOT NULL/); assert.match(nar, /model\s+TEXT NOT NULL/);
  assert.doesNotMatch(nar, /DROP|TRUNCATE/);
  const r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_maps/ });
  assert.deepEqual(r2.result.failed, ['cmap_maps']); assert.ok(r2.result.skipped.includes('cmap_narrations'));
});

test('개념 지도(273-5): cmap_quiz_attempts 는 지도 삭제 시 함께 삭제(CASCADE)·점수 3종·마지막 단계이며, 선행 단계 실패 시 건너뜀', async () => {
  const r = await recordInit();
  const text = withoutCmap(r.sqls).cmap.map(x => x.sql);
  const at = re => text.findIndex(s => re.test(s));
  const q = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_quiz_attempts/.test(s));
  assert.ok(q);
  assert.ok(at(/^CREATE TABLE IF NOT EXISTS cmap_quiz_attempts/) > at(/^CREATE TABLE IF NOT EXISTS cmap_narrations/), '해설 단계 뒤(맨 끝)');
  assert.match(q, /map_id\s+INTEGER NOT NULL REFERENCES cmap_maps\(id\) ON DELETE CASCADE/);
  assert.match(q, /user_id\s+INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(q, /source_hash\s+TEXT NOT NULL/);
  for (const c of ['pair_score', 'type_score', 'direction_score']) assert.match(q, new RegExp(c + '\\s+REAL,'));
  assert.doesNotMatch(q, /DROP|TRUNCATE/);
  assert.ok(text.some(s => /^CREATE INDEX IF NOT EXISTS idx_cmap_quiz_attempts_map ON cmap_quiz_attempts\(map_id, created_at\)$/.test(s)));
  const r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_maps/ });
  assert.ok(r2.result.skipped.includes('cmap_quiz_attempts'));
});

test('개념 지도(278-1): cmap_answer_attempts 는 요약·판정·피드백만 저장(원문 열 없음)·개념/사용자 삭제 시 CASCADE·판정과 입력 방식 CHECK·마지막 단계이며, 선행 단계 실패 시 건너뜀', async () => {
  const r = await recordInit();
  const text = withoutCmap(r.sqls).cmap.map(x => x.sql);
  const at = re => text.findIndex(s => re.test(s));
  const t = text.find(s => /^CREATE TABLE IF NOT EXISTS cmap_answer_attempts/.test(s));
  assert.ok(t);
  assert.ok(at(/^CREATE TABLE IF NOT EXISTS cmap_answer_attempts/) > at(/^CREATE TABLE IF NOT EXISTS cmap_quiz_attempts/), '맨 끝');
  assert.match(t, /user_id\s+INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(t, /concept_id\s+INTEGER NOT NULL REFERENCES cmap_concepts\(id\) ON DELETE CASCADE/);
  assert.match(t, /verdict\s+TEXT NOT NULL CHECK \(verdict IN \('충분', '부분적', '부족'\)\)/);
  assert.match(t, /input_mode\s+TEXT NOT NULL CHECK \(input_mode IN \('voice', 'text'\)\)/);
  for (const c of ['summary', 'strengths', 'gaps', 'supplement']) assert.match(t, new RegExp(c + '\\s'));
  assert.doesNotMatch(t, /transcript|raw_text|answer_text|audio|input_text|original/i, '전사·입력 원문·오디오 열 없음');
  assert.doesNotMatch(t, /DROP|TRUNCATE/);
  assert.ok(text.some(s => /^CREATE INDEX IF NOT EXISTS idx_cmap_answer_attempts_user_created ON cmap_answer_attempts\(user_id, created_at DESC\)$/.test(s)));
  const r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_concepts/ });
  assert.ok(r2.result.skipped.includes('cmap_answer_attempts'));
});

// ───── 작업286-1: cmap_edges_types_v2 단계(관계 유형 10개 + 문구 선택화) ─────
const TYPES10 = ['사용', '일부', '종류', '일으킴', '선행', '조건', '구별', '유사', '대립', '연관'];
const upToDateRows = () => [
  { conname: 'cmap_edges_relation_type_check_v2', def: 'CHECK (((relation_type IS NULL) OR (relation_type = ANY (ARRAY[' + TYPES10.map(t => "'" + t + "'::text").join(', ') + ']))))' },
  { conname: 'cmap_edges_label_check_v2', def: "CHECK (((label IS NULL) OR ((char_length(label) >= 1) AND (char_length(label) <= 40) AND (btrim(label) <> ''::text))))" },
  { conname: 'cmap_edges_has_content_check_v2', def: 'CHECK (((label IS NOT NULL) OR (relation_type IS NOT NULL)))' },
];
const isFound = sql => /^SELECT c\.conname, pg_get_constraintdef\(c\.oid\) AS def FROM pg_constraint c WHERE c\.conrelid = 'cmap_edges'::regclass AND c\.contype = 'c'/.test(sql);
const edgeStepOf = r => splitEdgeTypesStep(r.sqls).edgeStep.map(x => x.sql);

test('286-1 단계 36(cmap_edges_types_v2): 새 DB — 컬럼 기준 제약 조회 → BEGIN → LOCK → 재조회 → label NOT NULL 해제 → 새 CHECK 3개 ADD → COMMIT, 맨 끝 단계이며 총 36', async () => {
  const r = await recordInit();
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 0단계']);
  const st = edgeStepOf(r);
  assert.equal(st.length, 9);
  assert.ok(isFound(st[0]) && /a\.attname IN \('relation_type', 'label'\)/.test(st[0]) && /a\.attnum = ANY \(c\.conkey\)/.test(st[0]), '제약 이름을 가정하지 않고 컬럼 기준으로 찾음');
  assert.equal(st[1], 'BEGIN'); assert.equal(st[2], 'LOCK TABLE cmap_edges IN ACCESS EXCLUSIVE MODE'); assert.ok(isFound(st[3]), '잠금 뒤 다시 조회');
  assert.equal(st[4], 'ALTER TABLE cmap_edges ALTER COLUMN label DROP NOT NULL');
  assert.equal(st[5], 'ALTER TABLE cmap_edges ADD CONSTRAINT cmap_edges_relation_type_check_v2 CHECK (relation_type IS NULL OR relation_type IN (' + TYPES10.map(t => "'" + t + "'").join(', ') + '))');
  assert.equal(st[6], "ALTER TABLE cmap_edges ADD CONSTRAINT cmap_edges_label_check_v2 CHECK (label IS NULL OR (char_length(label) BETWEEN 1 AND 40 AND btrim(label) <> ''))");
  assert.equal(st[7], 'ALTER TABLE cmap_edges ADD CONSTRAINT cmap_edges_has_content_check_v2 CHECK (label IS NOT NULL OR relation_type IS NOT NULL)');
  assert.equal(st[8], 'COMMIT');
  for (const x of st) assert.doesNotMatch(x, /UPDATE|DELETE|TRUNCATE|DROP TABLE/, '기존 행을 건드리지 않음');
  assert.equal(r.sqls[r.sqls.length - 1].sql, 'COMMIT', '맨 끝 단계');
});

test('286-1 단계 36: 옛 제약(이름을 모름)이 있으면 조회된 이름 그대로 모두 DROP 한 뒤 ADD — 이름을 가정하지 않음', async () => {
  const old = [
    { conname: 'cmap_edges_relation_type_check', def: "CHECK (((relation_type IS NULL) OR (relation_type = ANY (ARRAY['사용'::text, '일부'::text, '종류'::text, '일으킴'::text, '구별'::text]))))" },
    { conname: 'weird "name"', def: 'CHECK (((char_length(label) >= 1)))' },
  ];
  const r = await recordInit({ respond: sql => (isFound(sql) ? { rows: old, rowCount: old.length } : undefined) });
  const st = edgeStepOf(r);
  const drops = st.filter(x => /DROP CONSTRAINT/.test(x));
  assert.deepEqual(drops, ['ALTER TABLE cmap_edges DROP CONSTRAINT "cmap_edges_relation_type_check"', 'ALTER TABLE cmap_edges DROP CONSTRAINT "weird ""name"""'], '인용 부호까지 안전하게');
  assert.ok(st.indexOf(drops[1]) < st.findIndex(x => /ADD CONSTRAINT cmap_edges_relation_type_check_v2/.test(x)), 'DROP 이 ADD 보다 먼저');
  assert.equal(st[st.length - 1], 'COMMIT');
});

test('286-1 단계 36: 이미 새 제약 3개(유형 10값)가 있으면 조회 한 번만 하고 아무것도 바꾸지 않는다(멱등, 잠금·트랜잭션 없음)', async () => {
  const r = await recordInit({ respond: sql => (isFound(sql) ? { rows: upToDateRows(), rowCount: 3 } : undefined) });
  const st = edgeStepOf(r);
  assert.equal(st.length, 1); assert.ok(isFound(st[0]));
  assert.ok(!splitV3Step(r.sqls).without.some(x => /LOCK TABLE cmap_edges/.test(x.sql)), 'v2 구간에는 잠금 없음(37번 단계의 잠금은 따로)');
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 0단계']);
  const stale = upToDateRows(); stale[0] = { conname: stale[0].conname, def: "CHECK (relation_type IN ('사용', '구별'))" };   // 이름만 같고 값이 다르면 적용 대상
  const r2 = await recordInit({ respond: sql => (isFound(sql) ? { rows: stale, rowCount: 3 } : undefined) });
  assert.ok(edgeStepOf(r2).some(x => /LOCK TABLE cmap_edges/.test(x)));
});

test('286-1 단계 36: 잠금을 기다리는 사이 다른 서버가 먼저 적용했으면 잠금 안의 재조회에서 알아보고 바꾸지 않은 채 COMMIT', async () => {
  let n = 0;
  const r = await recordInit({ respond: sql => (isFound(sql) ? (++n === 1 ? { rows: [], rowCount: 0 } : { rows: upToDateRows(), rowCount: 3 }) : undefined) });
  assert.deepEqual(edgeStepOf(r).map(x => (isFound(x) ? 'SELECT' : x)), ['SELECT', 'BEGIN', 'LOCK TABLE cmap_edges IN ACCESS EXCLUSIVE MODE', 'SELECT', 'COMMIT']);
});

test('286-1 단계 36 실패: 이 단계만 실패로 기록(ROLLBACK), 다른 모든 단계는 영향 없음·서버 시작 계속, cmap_edges 가 실패하면 건너뜀', async () => {
  const r = await recordInit({ failOn: /^ALTER TABLE cmap_edges ADD CONSTRAINT cmap_edges_label_check_v2/ });
  assert.deepEqual(r.result.failed, ['cmap_edges_types_v2']);
  assert.equal(r.result.total, 37); assert.deepEqual(r.result.skipped, ['cmap_edges_types_v3'], '선행 단계(v2)가 실패하면 37번 단계는 건너뜀');
  assert.ok(r.sqls.some(x => x.sql === 'ROLLBACK'), '실패하면 ROLLBACK');
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 1단계 (실패: cmap_edges_types_v2), 건너뜀 1단계 (건너뜀: cmap_edges_types_v3)']);
  assert.equal(failedLogs(r).length, 1);
  assert.equal(r.error, null, 'initDB 는 던지지 않음 → 서버 시작과 /api 대기에 영향 없음');
  const r2 = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS cmap_edges/ });
  assert.deepEqual(r2.result.failed, ['cmap_edges']); assert.ok(r2.result.skipped.includes('cmap_edges_types_v2'));
  assert.ok(!r2.sqls.some(x => /cmap_edges_relation_type_check_v2/.test(x.sql)));
});

// ───── 작업308-1: cmap_edges_types_v3 단계(37번, 관계 유형 3종 통일) ─────
const CM = require('../lib/cmap_map');
const DBM = require('../lib/db');
const T3 = ['종류', '일부', '대립'];
const LEGACY7 = ['사용', '일으킴', '선행', '조건', '구별', '유사', '연관'];
const isFound3 = sql => /^SELECT c\.conname, pg_get_constraintdef\(c\.oid\) AS def FROM pg_constraint c WHERE c\.conrelid = 'cmap_edges'::regclass AND c\.contype = 'c' AND EXISTS \(SELECT 1 FROM pg_attribute a WHERE a\.attrelid = c\.conrelid AND a\.attnum = ANY \(c\.conkey\) AND a\.attname = 'relation_type'\)$/.test(sql);
const v3Of = r => splitV3Step(r.sqls).v3Step.map(x => x.sql);
const typeCheck3 = { conname: 'cmap_edges_relation_type_check_v3', def: "CHECK ((relation_type = ANY (ARRAY['종류'::text, '일부'::text, '대립'::text])))" };
const contentCheck = { conname: 'cmap_edges_has_content_check_v2', def: 'CHECK (((label IS NOT NULL) OR (relation_type IS NOT NULL)))' };
const v2TypeCheck = upToDateRows()[0];
const doneState = { rows: [{ nullable: 'NO', has_legacy: true, pending: '0' }], rowCount: 1 };
const label = (sql, kind) => ({
  col: /^ALTER TABLE cmap_edges ADD COLUMN IF NOT EXISTS legacy_type TEXT$/, keep7: /^UPDATE cmap_edges SET legacy_type = relation_type WHERE legacy_type IS NULL AND relation_type IN \(/,
  keepNone: /^UPDATE cmap_edges SET legacy_type = '없음' WHERE legacy_type IS NULL AND relation_type IS NULL$/, to7: /^UPDATE cmap_edges SET relation_type = '종류' WHERE relation_type IN \(/,
  toPart: /^UPDATE cmap_edges SET relation_type = '일부' WHERE relation_type IS NULL AND btrim\(label\) = '일부'$/, toOpp: /^UPDATE cmap_edges SET relation_type = '대립' WHERE relation_type IS NULL AND btrim\(label\) = '대립'$/,
  toKindNull: /^UPDATE cmap_edges SET relation_type = '종류' WHERE relation_type IS NULL$/, swap: /^UPDATE cmap_edges SET from_concept_id = to_concept_id, to_concept_id = from_concept_id WHERE relation_type = '대립' AND legacy_type = '없음' AND from_concept_id > to_concept_id$/,
  addCheck: /^ALTER TABLE cmap_edges ADD CONSTRAINT cmap_edges_relation_type_check_v3 CHECK \(relation_type IN \('종류', '일부', '대립'\)\)$/, notNull: /^ALTER TABLE cmap_edges ALTER COLUMN relation_type SET NOT NULL$/,
}[kind].test(sql));

test('308-1 단계 37(cmap_edges_types_v3): 새 DB — 조회 2 → BEGIN → LOCK → 재조회 2 → legacy_type 추가 → 보관 → 변환 → 정규화 → CHECK 교체 → NOT NULL → COMMIT, 총 37단계', async () => {
  const r = await recordInit();
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 0단계']);
  const st = v3Of(r);
  assert.ok(V3_STATE.test(st[0]) && isFound3(st[1]), '잠금 전 상태 조회(컬럼·NOT NULL·3종 밖 행 수) + 유형 제약 조회');
  assert.equal(st[2], 'BEGIN'); assert.equal(st[3], 'LOCK TABLE cmap_edges IN ACCESS EXCLUSIVE MODE'); assert.ok(V3_STATE.test(st[4]) && isFound3(st[5]), '잠금 뒤 다시 조회');
  const body = st.slice(6, -1);
  const order = ['col', 'keep7', 'keepNone', 'to7', 'toPart', 'toOpp', 'toKindNull', 'swap', 'addCheck', 'notNull'];
  assert.equal(body.length, order.length, JSON.stringify(body));
  order.forEach((k, i) => assert.ok(label(body[i], k), `${i + 1}번째: ${k} — ${body[i]}`));
  assert.equal(st[st.length - 1], 'COMMIT');
  for (const x of st) assert.doesNotMatch(x, /DELETE|TRUNCATE|DROP TABLE|DROP COLUMN/, 'DB 삭제 없음(컬럼 추가와 값 수정, 유형 CHECK 교체만)');
  assert.equal(r.sqls[r.sqls.length - 1].sql, 'COMMIT', '맨 끝 단계');
  assert.deepEqual(T3, CM.RELATION_TYPES, 'DB 3값 = 서버 상수'); assert.ok(body[8].includes(T3.map(x => "'" + x + "'").join(', ')));
  assert.ok(!r.sqls.some(x => /relation_type_check_v3/.test(x.sql) && /\bhash\b|semantic/.test(x.sql)), '해시와 무관');
});

test('308-1 단계 37: 옛 유형 CHECK(이름을 모름)는 조회된 이름 그대로 DROP 하되 문구·내용 CHECK 는 건드리지 않고, DROP 이 ADD 보다 먼저다', async () => {
  const weird = { conname: 'weird "name"', def: "CHECK (((relation_type IS NULL) OR (relation_type = ANY (ARRAY['사용'::text, '구별'::text]))))" };
  const r = await recordInit({ respond: sql => (isFound3(sql) ? { rows: [v2TypeCheck, weird, contentCheck], rowCount: 3 } : undefined) });
  const st = v3Of(r);
  const drops = st.filter(x => /DROP CONSTRAINT/.test(x));
  assert.deepEqual(drops, ['ALTER TABLE cmap_edges DROP CONSTRAINT "cmap_edges_relation_type_check_v2"', 'ALTER TABLE cmap_edges DROP CONSTRAINT "weird ""name"""'], '유형 값을 제한하는 CHECK 만, 인용 부호까지 안전하게');
  assert.ok(!st.some(x => /has_content_check_v2/.test(x)), '내용 CHECK 는 그대로');
  assert.ok(st.indexOf(drops[1]) < st.findIndex(x => label(x, 'addCheck')), 'DROP 이 ADD 보다 먼저');
  assert.equal(st[st.length - 1], 'COMMIT');
});

test('308-1 단계 37: 이미 적용됨(3값 CHECK + legacy_type + NOT NULL + 3종 밖 행 0개)이면 조회 두 번만 하고 아무것도 바꾸지 않는다(멱등, 잠금·트랜잭션 없음)', async () => {
  const r = await recordInit({ respond: sql => (V3_STATE.test(sql) ? doneState : isFound3(sql) ? { rows: [typeCheck3, contentCheck], rowCount: 2 } : undefined) });
  const st = v3Of(r);
  assert.equal(st.length, 2); assert.ok(V3_STATE.test(st[0]) && isFound3(st[1]));
  assert.ok(!splitEdgeTypesStep(r.sqls).without.some(x => /ADD COLUMN IF NOT EXISTS legacy_type|SET relation_type|relation_type_check_v3 CHECK/.test(x.sql)));
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 0단계']);
  assert.ok(!r.logs.some(l => /관계 유형 3종 통일/.test(l)), '변환이 없으면 로그도 없다');
  // 한 가지라도 아니면 적용 대상: 3종 밖 행이 남음 / legacy_type 컬럼 없음 / NOT NULL 아님 / 제약 값이 다름 / 제약 이름이 다름
  const variants = [
    { st: { ...doneState.rows[0], pending: '3' } }, { st: { ...doneState.rows[0], has_legacy: false } }, { st: { ...doneState.rows[0], nullable: 'YES' } },
    { rows: [{ ...typeCheck3, def: "CHECK (relation_type IN ('종류', '일부'))" }, contentCheck] }, { rows: [{ ...typeCheck3, conname: 'other_check' }, contentCheck] }, { rows: [v2TypeCheck, contentCheck] },
  ];
  for (const v of variants) {
    const r2 = await recordInit({ respond: sql => (V3_STATE.test(sql) ? { rows: [v.st || doneState.rows[0]], rowCount: 1 } : isFound3(sql) ? { rows: v.rows || [typeCheck3, contentCheck], rowCount: 2 } : undefined) });
    assert.ok(v3Of(r2).some(x => /LOCK TABLE cmap_edges/.test(x)), JSON.stringify(v));
  }
});

test('308-1 단계 37: v3 가 적용된 DB 에서 서버를 다시 시작해도 v2 단계는 3값 CHECK(v3 이름)를 "이미 적용됨"으로 보고 제약을 되돌리지 않는다', async () => {
  const label2 = { conname: 'cmap_edges_label_check_v2', def: "CHECK (((label IS NULL) OR ((char_length(label) >= 1) AND (char_length(label) <= 40) AND (btrim(label) <> ''::text))))" };
  const rows = [typeCheck3, label2, contentCheck];
  const r = await recordInit({ respond: sql => (isFound(sql) && !isFound3(sql) ? { rows, rowCount: 3 } : V3_STATE.test(sql) ? doneState : isFound3(sql) ? { rows: [typeCheck3, contentCheck], rowCount: 2 } : undefined) });
  assert.equal(edgeStepOf(r).length, 1, 'v2: 조회 한 번뿐');
  assert.ok(!r.sqls.some(x => /DROP CONSTRAINT/.test(x.sql)), '어떤 제약도 DROP 하지 않는다(재시작해도 제자리)');
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 0단계']);
});

test('308-1 단계 37: 잠금을 기다리는 사이 다른 서버가 먼저 적용했으면 잠금 안의 재조회에서 알아보고 바꾸지 않은 채 COMMIT', async () => {
  let n = 0;
  const r = await recordInit({ respond: sql => { if (V3_STATE.test(sql)) return ++n === 1 ? { rows: [{ nullable: 'YES', has_legacy: false, pending: '5' }], rowCount: 1 } : doneState; if (isFound3(sql)) return n >= 2 ? { rows: [typeCheck3, contentCheck], rowCount: 2 } : { rows: [v2TypeCheck, contentCheck], rowCount: 2 }; return undefined; } });
  assert.deepEqual(v3Of(r).map(x => (V3_STATE.test(x) ? 'STATE' : isFound3(x) ? 'FOUND' : x)), ['STATE', 'FOUND', 'BEGIN', 'LOCK TABLE cmap_edges IN ACCESS EXCLUSIVE MODE', 'STATE', 'FOUND', 'COMMIT']);
});

test('308-1 단계 37 실패: 이 단계만 실패로 기록(ROLLBACK), 다른 단계는 영향 없음·서버 시작 계속, 선행 단계(v2)가 실패하면 건너뜀', async () => {
  const r = await recordInit({ failOn: /^UPDATE cmap_edges SET relation_type = '대립' WHERE relation_type IS NULL/ });
  assert.deepEqual(r.result.failed, ['cmap_edges_types_v3']); assert.equal(r.result.total, 37); assert.deepEqual(r.result.skipped, []);
  assert.ok(r.sqls.some(x => x.sql === 'ROLLBACK'), '실패하면 ROLLBACK');
  assert.ok(!r.sqls.some(x => /ADD CONSTRAINT cmap_edges_relation_type_check_v3/.test(x.sql)), '실패 뒤 문장은 실행하지 않음(제약 교체 없음)');
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 37단계, 실패 1단계 (실패: cmap_edges_types_v3)']);
  assert.equal(failedLogs(r).length, 1); assert.equal(r.error, null, 'initDB 는 던지지 않음');
  const r2 = await recordInit({ failOn: /^ALTER TABLE cmap_edges ADD CONSTRAINT cmap_edges_label_check_v2/ });
  assert.deepEqual(r2.result.failed, ['cmap_edges_types_v2']); assert.deepEqual(r2.result.skipped, ['cmap_edges_types_v3']);
  assert.ok(!r2.sqls.some(x => V3_STATE.test(x.sql)), 'v3 는 시작도 하지 않는다');
});

test('308-1 단계 37 로그: 변환이 있으면 건수만 한 줄(종류로·일부·대립·원래 유형 없음), 연결 내용·문구·개념 이름은 없다. 변환이 없으면 로그 없음', async () => {
  const counts = [[/^UPDATE cmap_edges SET relation_type = '종류' WHERE relation_type IN \(/, 3], [/^UPDATE cmap_edges SET relation_type = '일부' WHERE relation_type IS NULL/, 1], [/^UPDATE cmap_edges SET relation_type = '대립' WHERE relation_type IS NULL/, 2], [/^UPDATE cmap_edges SET relation_type = '종류' WHERE relation_type IS NULL$/, 4]];
  const r = await recordInit({ respond: sql => { const c = counts.find(x => x[0].test(sql)); return c ? { rows: [], rowCount: c[1] } : undefined; } });
  const lines = r.logs.filter(l => /관계 유형 3종 통일/.test(l));
  assert.deepEqual(lines, ['[DB] cmap_edges: 관계 유형 3종 통일, 변환 10건(종류로 7건, 일부 1건, 대립 2건, 원래 유형 없음 7건)']);
  assert.match(lines[0], /^\[DB\] cmap_edges: 관계 유형 3종 통일, 변환 \d+건\(종류로 \d+건, 일부 \d+건, 대립 \d+건, 원래 유형 없음 \d+건\)$/, '건수만: 이 형식 밖의 내용(연결 내용·문구·개념 이름)이 없다');
  assert.ok(!(await recordInit()).logs.some(l => /관계 유형 3종 통일/.test(l)), '변환 0건이면 로그 없음');
});

// SQL 문장을 순서대로 JS 로 모의 실행한다(37번 단계의 UPDATE 7개): 실제 PostgreSQL 이 아니라 문장의 의미를 규칙 함수와 맞춰 보는 것
function simulateV3(rows, stmts) {
  const btrim = s => (typeof s === 'string' ? s.replace(/^ +| +$/g, '') : s);
  const list = sql => [...sql.matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const sql of stmts) {
    let m;
    if (label(sql, 'keep7')) { const L = list(sql.split('relation_type IN')[1]); rows.forEach(r => { if (r.legacy_type === null && L.includes(r.relation_type)) r.legacy_type = r.relation_type; }); }
    else if (label(sql, 'keepNone')) rows.forEach(r => { if (r.legacy_type === null && r.relation_type === null) r.legacy_type = '없음'; });
    else if (label(sql, 'to7')) { const L = list(sql.split('relation_type IN')[1]); rows.forEach(r => { if (L.includes(r.relation_type)) r.relation_type = '종류'; }); }
    else if (label(sql, 'toPart')) rows.forEach(r => { if (r.relation_type === null && btrim(r.label) === '일부') r.relation_type = '일부'; });
    else if (label(sql, 'toOpp')) rows.forEach(r => { if (r.relation_type === null && btrim(r.label) === '대립') r.relation_type = '대립'; });
    else if (label(sql, 'toKindNull')) rows.forEach(r => { if (r.relation_type === null) r.relation_type = '종류'; });
    else if (label(sql, 'swap')) rows.forEach(r => { if (r.relation_type === '대립' && r.legacy_type === '없음' && r.from > r.to) [r.from, r.to] = [r.to, r.from]; });
    else if ((m = /^UPDATE/.exec(sql))) throw new Error('모의 실행이 모르는 UPDATE: ' + sql);
  }
  return rows;
}

test('308-1 단계 37: SQL 의 문구→유형 규칙은 순수 JS 규칙(convertLegacyEdgeType)과 모든 조합에서 같고, from/to 정규화는 NULL → 대립으로 바뀐 행에만 적용된다', async () => {
  const r = await recordInit();
  const stmts = v3Of(r).filter(x => /^UPDATE/.test(x));
  assert.equal(stmts.length, 7);
  const labels = ['일부', '대립', '종류', '  일부', '대립  ', ' 일부 ', '일부분', '일 부', '마찰이 열을 일으킴', '\t일부', 'A', '', null];
  const types = [null, ...LEGACY7, '종류', '일부', '대립'];
  const rows = []; let id = 1;
  for (const type of types) for (const lb of labels) {
    if (type === null && (lb === null || lb === '')) continue;                                // 유형도 문구도 없는 행은 DB 제약상 없다
    rows.push({ id: id++, relation_type: type, label: lb, legacy_type: null, from: 9, to: 2, orig: { type, label: lb } });   // 큰 id → 작은 id 로 저장돼 있다고 가정
  }
  simulateV3(rows, stmts);
  for (const row of rows) {
    const want = CM.convertLegacyEdgeType(row.orig.type, row.orig.label);
    assert.equal(row.relation_type, want.type, JSON.stringify(row.orig));
    assert.equal(row.legacy_type, want.legacy, '원래 유형 보관: ' + JSON.stringify(row.orig));
    assert.equal(row.label, row.orig.label, '문구는 바꾸지 않는다');
    const swapped = row.orig.type === null && want.type === '대립';
    assert.deepEqual([row.from, row.to], swapped ? [2, 9] : [9, 2], 'from/to 정규화는 NULL → 대립 행에만: ' + JSON.stringify(row.orig));
  }
  assert.ok(rows.every(x => T3.includes(x.relation_type)), '모든 행이 3종');
  // 두 번째 실행(멱등): 이미 3종이면 아무것도 바뀌지 않는다
  const snap = JSON.stringify(rows); simulateV3(rows, stmts); assert.equal(JSON.stringify(rows), snap, '문장을 다시 실행해도 같은 결과');
});

test('308-1 롤백 SQL(자동 실행 안 함): NOT NULL 해제 → v3 CHECK 삭제 → 원래 유형 복원 → 10값 CHECK 복구 순서이고, 변환한 행을 원래 유형으로 되돌린다(사용자가 직접 고친 행은 그대로)', () => {
  const RB = DBM.CMAP_EDGES_TYPES_V3_ROLLBACK_SQL;
  assert.equal(RB.length, 4);
  assert.equal(RB[0], 'ALTER TABLE cmap_edges ALTER COLUMN relation_type DROP NOT NULL');
  assert.equal(RB[1], 'ALTER TABLE cmap_edges DROP CONSTRAINT IF EXISTS cmap_edges_relation_type_check_v3');
  assert.match(RB[2], /^UPDATE cmap_edges SET relation_type = CASE WHEN legacy_type = '없음' THEN NULL ELSE legacy_type END WHERE legacy_type IS NOT NULL$/);
  assert.match(RB[3], /^ALTER TABLE cmap_edges ADD CONSTRAINT cmap_edges_relation_type_check_v2 CHECK \(relation_type IS NULL OR relation_type IN \(/);
  assert.deepEqual([...RB[3].matchAll(/'([^']+)'/g)].map(m => m[1]), TYPES10, '복구하는 CHECK 는 옛 10값');
  assert.ok(RB.every(x => !/;/.test(x) && !/DELETE|TRUNCATE|DROP TABLE/.test(x)), '문장 하나씩(세미콜론 없음), 삭제 없음');
  // 모의 실행: 변환 → 롤백(원래 유형으로 복원)
  const rows = [{ relation_type: '유사', label: 'x' }, { relation_type: null, label: '대립' }, { relation_type: '일부', label: 'y' }, { relation_type: '사용', label: 'z' }].map(x => ({ ...x, legacy_type: null, from: 5, to: 1 }));
  const orig = rows.map(x => x.relation_type);
  rows.forEach(r => { const c = CM.convertLegacyEdgeType(r.relation_type, r.label); r.relation_type = c.type; r.legacy_type = c.legacy; });
  rows[3].relation_type = '일부'; rows[3].legacy_type = null;                                      // 사용자가 직접 고친 행(원래 유형 비움)
  rows.forEach(r => { if (r.legacy_type !== null) r.relation_type = r.legacy_type === '없음' ? null : r.legacy_type; });
  assert.deepEqual(rows.map(x => x.relation_type), [orig[0], orig[1], orig[2], '일부'], '변환한 행은 원래 유형으로, 직접 고친 행은 그대로');
});
