// 작업227-9: concept_links.relation_type CHECK 를 11값(옛 6종 + 새 5종)으로 넓히는 initDB 단계 'concept_links_relation_types_v2' 시험.
// 실제 PostgreSQL 은 쓰지 않는다(이 환경에 PG 없음 → "실제 PG 미검증"). 가짜 pg 가 기록한 SQL 문장을 검사하고, 제약 조회 응답을 흉내 내 분기(최초 적용·멱등·동시 부팅·실패)를 확인한다.
// 모의 DB 한계: 11값 INSERT 허용·밖의 값 거부는 모의 DB 의 CHECK 모사(tests/helpers/mock_db.js)를 확인하는 것이고, 실제 PG 제약 동작은 위의 SQL 문장 검사로 대신한다.
// 실행: node --test tests/concept_links_check_v2.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { recordInit } = require('./helpers/init_recorder');
const { createMockDb } = require('./helpers/mock_db');
const { startApp } = require('./helpers/app');

const STEP = 'concept_links_relation_types_v2';
const NAME = 'concept_links_relation_type_check_v2';
const OLD6 = ['포함', '원인→결과', '순서', '대비', '비슷함', '기타 관련'];
const NEW5 = ['사용', '일부', '종류', '일으킴', '구별'];
const ALL11 = [...OLD6, ...NEW5];
const SELECT_SQL = "SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'concept_links'::regclass AND c.contype = 'c' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname = 'relation_type') ORDER BY c.conname";
const ADD_SQL = 'ALTER TABLE concept_links ADD CONSTRAINT ' + NAME + ' CHECK (relation_type IN (' + ALL11.map(v => "'" + v + "'").join(', ') + '))';
// pg_get_constraintdef 가 돌려주는 모양
const def = values => 'CHECK ((relation_type = ANY (ARRAY[' + values.map(v => "'" + v + "'::text").join(', ') + '])))';
const isSelect = sql => sql === SELECT_SQL;
const stepSql = r => {
  const i = r.sqls.findIndex(x => /^ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS user_edited/.test(x.sql));
  const j = r.sqls.findIndex(x => /^CREATE TABLE IF NOT EXISTS concept_quiz_attempts/.test(x.sql));
  return r.sqls.slice(i + 1, j).map(x => x.sql);
};
const rowsOf = rows => ({ rows, rowCount: rows.length });

test('최초 적용(제약 목록이 비어 있는 응답): 조회 → BEGIN → LOCK → 조회 → ADD(11값, 정해 둔 이름) → COMMIT, DROP 없음', async () => {
  const r = await recordInit();
  assert.equal(r.error, null);
  assert.deepEqual(r.result.failed, []);
  assert.deepEqual(stepSql(r), [SELECT_SQL, 'BEGIN', 'LOCK TABLE concept_links IN ACCESS EXCLUSIVE MODE', SELECT_SQL, ADD_SQL, 'COMMIT']);
  assert.ok(r.logs.some(l => /concept_links relation_type CHECK: 11값으로 확장/.test(l)));
});

test('SQL 문장 검사: 새 CHECK 는 정확히 11값(옛 6종 + 새 5종), 이름을 직접 붙임, 이름 추정 DROP 없음', async () => {
  const r = await recordInit();
  const add = stepSql(r).find(s => /ADD CONSTRAINT/.test(s));
  const values = (add.match(/'([^']*)'/g) || []).map(x => x.slice(1, -1));
  assert.deepEqual(values, ALL11);
  assert.equal(new Set(values).size, 11);
  assert.match(add, new RegExp('ADD CONSTRAINT ' + NAME + ' CHECK \\(relation_type IN \\('));
  assert.ok(!stepSql(r).some(s => /DROP CONSTRAINT/.test(s)), '제약이 조회되지 않았으면 DROP 하지 않음(이름을 추정하지 않음)');
  const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8');
  assert.ok(!/concept_links_relation_type_check\b(?!_v2)/.test(dbSrc), 'db.js 에 옛 자동 제약 이름이 하드코딩돼 있지 않다');
  // 옛 CREATE TABLE 문장(6종)은 그대로(새 DB 도 6종으로 만든 뒤 이 단계가 넓힌다)
  assert.match(r.sqls.map(x => x.sql).join('\n'), /relation_type TEXT NOT NULL CHECK \(relation_type IN \('포함','원인→결과','순서','대비','비슷함','기타 관련'\)\)/);
});

test('옛 제약이 있으면(조회 응답) 조회된 이름 그대로(따옴표로 감싸) DROP → 새 ADD, 한 트랜잭션(BEGIN … COMMIT)', async () => {
  const old = { conname: 'concept_links_relation_type_check', def: def(OLD6) };
  const r = await recordInit({ respond: sql => (isSelect(sql) ? rowsOf([old]) : undefined) });
  assert.deepEqual(stepSql(r), [SELECT_SQL, 'BEGIN', 'LOCK TABLE concept_links IN ACCESS EXCLUSIVE MODE', SELECT_SQL, 'ALTER TABLE concept_links DROP CONSTRAINT "concept_links_relation_type_check"', ADD_SQL, 'COMMIT']);
});

test('제약 이름이 달라도(예: 다른 이름 2개, 따옴표 포함) 조회된 것을 모두 DROP', async () => {
  const rows = [{ conname: 'weird"name', def: def(OLD6) }, { conname: 'concept_links_x_check', def: def(['포함']) }];
  const r = await recordInit({ respond: sql => (isSelect(sql) ? rowsOf(rows) : undefined) });
  const s = stepSql(r);
  assert.ok(s.includes('ALTER TABLE concept_links DROP CONSTRAINT "weird""name"'));
  assert.ok(s.includes('ALTER TABLE concept_links DROP CONSTRAINT "concept_links_x_check"'));
  assert.ok(s.indexOf(ADD_SQL) > s.indexOf('ALTER TABLE concept_links DROP CONSTRAINT "concept_links_x_check"'), 'DROP 뒤에 ADD');
  assert.equal(s[s.length - 1], 'COMMIT');
});

test('멱등 ①: 이미 새 이름의 11값 제약이면 조회 한 번만 하고 BEGIN·LOCK·ALTER 를 하지 않는다', async () => {
  const done = { conname: NAME, def: def(ALL11) };
  const r = await recordInit({ respond: sql => (isSelect(sql) ? rowsOf([done]) : undefined) });
  assert.deepEqual(stepSql(r), [SELECT_SQL]);
  assert.deepEqual(r.result.failed, []);
});

test('멱등 ②: 값 순서가 달라도 같은 11값이면 이미 적용된 것으로 본다. 10값이거나 12값이면 다시 만든다', async () => {
  const shuffled = { conname: NAME, def: def([...ALL11].reverse()) };
  assert.deepEqual(stepSql(await recordInit({ respond: sql => (isSelect(sql) ? rowsOf([shuffled]) : undefined) })), [SELECT_SQL]);
  for (const values of [ALL11.slice(0, 10), [...ALL11, '기타']]) {
    const s = stepSql(await recordInit({ respond: sql => (isSelect(sql) ? rowsOf([{ conname: NAME, def: def(values) }]) : undefined) }));
    assert.ok(s.includes('ALTER TABLE concept_links DROP CONSTRAINT "' + NAME + '"') && s.includes(ADD_SQL), values.length + '값');
  }
});

test('멱등 ③(두 번 실행): 상태를 기억하는 가짜 DB 로 initDB 를 두 번 돌리면 첫 번째만 제약을 바꾸고 두 번째는 조회만 한다', async () => {
  let constraints = [{ conname: 'concept_links_relation_type_check', def: def(OLD6) }];
  const respond = sql => {
    if (isSelect(sql)) return rowsOf(constraints.map(c => ({ ...c })));
    if (/^ALTER TABLE concept_links DROP CONSTRAINT "(.*)"$/.test(sql)) { const n = sql.match(/"(.*)"$/)[1]; constraints = constraints.filter(c => c.conname !== n); }
    if (sql === ADD_SQL) constraints.push({ conname: NAME, def: def(ALL11) });
  };
  const first = await recordInit({ respond }), second = await recordInit({ respond });
  assert.ok(stepSql(first).includes(ADD_SQL));
  assert.deepEqual(stepSql(second), [SELECT_SQL]);
  assert.deepEqual(constraints.map(c => c.conname), [NAME], '제약은 새 이름 하나만 남음');
});

test('동시 부팅(다른 서버가 먼저 끝낸 경우): 첫 조회는 옛 상태, LOCK 뒤 조회는 이미 11값이면 ALTER 없이 COMMIT', async () => {
  let n = 0;
  const r = await recordInit({ respond: sql => (isSelect(sql) ? rowsOf(++n === 1 ? [{ conname: 'concept_links_relation_type_check', def: def(OLD6) }] : [{ conname: NAME, def: def(ALL11) }]) : undefined) });
  assert.deepEqual(stepSql(r), [SELECT_SQL, 'BEGIN', 'LOCK TABLE concept_links IN ACCESS EXCLUSIVE MODE', SELECT_SQL, 'COMMIT']);
  assert.deepEqual(r.result.failed, []);
});

test('실패 처리: ADD 가 실패해도 initDB 는 던지지 않고 ROLLBACK, 실패 단계로 기록, 이후 단계는 계속 실행(앱은 죽지 않음)', async () => {
  const old = { conname: 'concept_links_relation_type_check', def: def(OLD6) };
  const r = await recordInit({ failOn: /^ALTER TABLE concept_links ADD CONSTRAINT/, respond: sql => (isSelect(sql) ? rowsOf([old]) : undefined) });
  assert.equal(r.error, null, 'initDB 는 예외로 끝나지 않음(server.js 는 로그만 남기고 계속 시작)');
  assert.deepEqual(r.result.failed, [STEP]);
  const s = stepSql(r);
  assert.ok(s.includes('ALTER TABLE concept_links DROP CONSTRAINT "concept_links_relation_type_check"'), 'DROP 은 실행됐지만');
  assert.ok(s.includes('ROLLBACK') && !s.includes('COMMIT'), 'COMMIT 없이 ROLLBACK 되어 옛 제약이 그대로 남는다(DDL 도 트랜잭션)');
  assert.ok(r.sqls.some(x => /^CREATE TABLE IF NOT EXISTS concept_quiz_attempts/.test(x.sql)), '다음 단계 계속 실행');
  assert.ok(r.logs.some(l => /\[DB\] init step failed: concept_links_relation_types_v2/.test(l)));
  assert.deepEqual(r.logs.filter(l => l.startsWith('[DB] init done:')), ['[DB] init done: 총 24단계, 실패 1단계 (실패: concept_links_relation_types_v2)']);
  assert.equal(r.released, true);
});

test('실패 처리: DROP·LOCK·조회가 실패해도 같은 방식(ROLLBACK, 실패 기록, 계속)', async () => {
  const old = { conname: 'concept_links_relation_type_check', def: def(OLD6) };
  for (const failOn of [/^ALTER TABLE concept_links DROP CONSTRAINT/, /^LOCK TABLE concept_links/, /^SELECT c\.conname/]) {
    const r = await recordInit({ failOn, respond: sql => (isSelect(sql) ? rowsOf([old]) : undefined) });
    assert.equal(r.error, null, String(failOn));
    assert.deepEqual(r.result.failed, [STEP], String(failOn));
    assert.ok(!stepSql(r).includes('COMMIT'), String(failOn));
    assert.ok(r.sqls.some(x => /^CREATE TABLE IF NOT EXISTS concept_quiz_attempts/.test(x.sql)), '다음 단계 계속 실행');
  }
});

test('선행 단계(concept_links) 가 실패하면 이 단계는 건너뜀: 제약 조회도 하지 않는다', async () => {
  const r = await recordInit({ failOn: /^CREATE TABLE IF NOT EXISTS concept_links/ });
  assert.deepEqual(r.result.failed, ['concept_links']);
  assert.ok(r.result.skipped.includes(STEP));
  assert.ok(r.logs.includes('[DB] init step skipped: ' + STEP + ': 선행 단계 실패 (concept_links)'));
  assert.ok(!r.sqls.some(x => isSelect(x.sql) || /LOCK TABLE concept_links/.test(x.sql)));
});

test('단계 위치: concept_links_user_edited 바로 뒤, concept_quiz_attempts 앞이고 총 24단계', async () => {
  const r = await recordInit();
  assert.equal(r.result.total, 24);
  const order = r.sqls.map(x => x.sql);
  assert.ok(order.findIndex(s => /ADD COLUMN IF NOT EXISTS user_edited/.test(s)) < order.indexOf(SELECT_SQL));
  assert.ok(order.indexOf(ADD_SQL) < order.findIndex(s => /^CREATE TABLE IF NOT EXISTS concept_quiz_attempts/.test(s)));
});

// ───────────────────────── 모의 DB 의 CHECK 모사(11값) ─────────────────────────
test('모의 DB: 옛 6종과 새 5종 각각 INSERT 가능, 11값 밖은 거부 (모의 DB 한계: 실제 PG 제약이 아니라 모사)', async () => {
  const db = createMockDb();
  db.addUser(7);
  for (const type of ALL11) {
    const r = await db.pool.query('INSERT INTO concept_links (study_id, user_id, from_item_id, to_item_id, relation_type, source) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [1, 7, 1, 2, type, 'user']);
    assert.equal(r.rowCount, 1, type);
  }
  assert.equal(db.tables.concept_links.length, 11);
  for (const bad of ['없음', '', '사용 ', '비슷', 'USE']) {
    await assert.rejects(db.pool.query('INSERT INTO concept_links (study_id, user_id, from_item_id, to_item_id, relation_type, source) VALUES ($1, $2, $3, $4, $5, $6)', [1, 7, 1, 2, bad, 'user']), /check constraint/, JSON.stringify(bad));
  }
  assert.equal(db.tables.concept_links.length, 11);
});

test('SQL 의 11값과 모의 DB 가 받아들이는 값이 같다(db.js 단계와 모의 CHECK 가 어긋나지 않음)', async () => {
  const r = await recordInit();
  const values = (stepSql(r).find(s => /ADD CONSTRAINT/.test(s)).match(/'([^']*)'/g) || []).map(x => x.slice(1, -1));
  const db = createMockDb();
  for (const v of values) await db.pool.query('INSERT INTO concept_links (study_id, user_id, from_item_id, to_item_id, relation_type, source) VALUES ($1, $2, $3, $4, $5, $6)', [1, 7, 1, 2, v, 'ai']);
  assert.equal(db.tables.concept_links.length, values.length);
});

// ───────────────────────── 서버는 아직 새 5종을 거부(배포해도 앱 동작 변화 없음) ─────────────────────────
test('routes: RELATION_TYPES 는 옛 6종 그대로이고, 새 5종은 연결 추가(POST)·수정(PATCH)에서 아직 400', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'concept_study.js'), 'utf8');
  assert.match(src, /const RELATION_TYPES = \['포함', '원인→결과', '순서', '대비', '비슷함', '기타 관련'\];/);
  const db = createMockDb(); db.addUser(7);
  const t = await startApp(['routes/concept_study.js'], { db });
  try {
    const S = '/api/concepts/studies';
    const sid = (await t.call('POST', S, { topic: 'A' })).body.id;
    const a = (await t.call('POST', `${S}/${sid}/items`, { term: '가' })).body, b = (await t.call('POST', `${S}/${sid}/items`, { term: '나' })).body;
    for (const type of NEW5) {
      const r = await t.call('POST', `${S}/${sid}/links`, { from_item_id: a.id, to_item_id: b.id, relation_type: type });
      assert.equal(r.status, 400, 'POST ' + type);
    }
    const ok = await t.call('POST', `${S}/${sid}/links`, { from_item_id: a.id, to_item_id: b.id, relation_type: '포함' });
    assert.equal(ok.status, 201, '옛 값은 그대로 허용');
    for (const type of NEW5) assert.equal((await t.call('PATCH', `/api/concepts/links/${ok.body.id}`, { relation_type: type })).status, 400, 'PATCH ' + type);
    assert.equal((await t.call('PATCH', `/api/concepts/links/${ok.body.id}`, { relation_type: '대비' })).status, 200);
  } finally { await t.close(); }
});
