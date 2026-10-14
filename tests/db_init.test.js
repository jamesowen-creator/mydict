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
  'cmap_maps', 'cmap_map_nodes', 'cmap_edges', 'cmap_narrations', 'cmap_quiz_attempts', 'cmap_concept_marks'];   // 작업270-1·271-1·273-1·273-2·273-4·273-5·275-4: 마지막 열 단계가 개념 지도용으로 추가됨
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
const CMAP_SQL = /perm_concept_map|cmap_topics|idx_cmap_topics_|cmap_concepts|idx_cmap_concepts_|cmap_maps|idx_cmap_maps_|cmap_map_nodes|cmap_edges|idx_cmap_edges_|cmap_narrations|cmap_quiz_attempts|idx_cmap_quiz_attempts_|cmap_concept_marks/;
function withoutCmap(sqls) {
  const cmap = sqls.filter(x => CMAP_SQL.test(x.sql));
  const rest = sqls.filter(x => !CMAP_SQL.test(x.sql));
  assert.equal(cmap.length, 21, '개념 지도 문장 수(users 열 1 + cmap_topics 1+4 + cmap_concepts 1+2 + 설명 열 3 + cmap_maps 1+1 + cmap_map_nodes 1 + cmap_edges 1+1 + cmap_narrations 1 + cmap_quiz_attempts 1+1 + cmap_concept_marks 1)');
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

test('정상: 34단계 모두 성공, 요약 로그 "실패 0단계", 반환값, client 반환', async () => {
  const r = await recordInit();
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 34단계, 실패 0단계']);
  assert.deepEqual(r.result, { total: 34, failed: [], skipped: [] });
  assert.equal(failedLogs(r).length, 0);
  assert.equal(r.released, true);
  assert.equal(STEPS.length, 34);
});

test('중간 단계(voice_notes)가 실패해도 이후 단계가 계속 실행되고, 실패 이름과 요약이 로그에 남음', async () => {
  const r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS voice_notes/ });
  assert.equal(r.error, null, '예외로 끝나지 않음(서버는 계속 시작)');
  assert.deepEqual(r.result.failed, ['voice_notes']);
  const fl = failedLogs(r);
  assert.equal(fl.length, 1);
  assert.match(fl[0], /^\[DB\] init step failed: voice_notes: 주입된 오류/);
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 34단계, 실패 1단계 (실패: voice_notes)']);
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
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 34단계, 실패 2단계 (실패: tts_cache, concept_quiz_attempts)']);
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
  assert.deepEqual(summaryOf(r), ['[DB] init done: 총 34단계, 실패 1단계 (실패: concept_items), 건너뜀 2단계 (건너뜀: concept_migration_v1, concept_migration_v2)']);
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
  const PREDICATES = require('../lib/cmap_map').RELATION_TYPES;
  assert.deepEqual(PREDICATES, ['사용', '일부', '종류', '일으킴', '구별'], '고정 5개 값');
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
