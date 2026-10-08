// 작업211: lib/db.js를 가짜 pg로 불러 initDB가 실행하는 SQL을 순서대로 기록한다(공백 정규화).
//   const { recordInit, SCENARIOS } = require('./helpers/init_recorder');
//   const r = await recordInit({ scenario: 'fresh', failOn: /CREATE TABLE IF NOT EXISTS voice_notes/ });
//   r.sqls  → [{ sql, params }]   r.logs → ['[DB] ...']   r.result → initDB() 반환값   r.error → 던져진 오류 메시지
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(ROOT, 'lib', 'db.js');
const norm = s => String(s).replace(/\s+/g, ' ').trim();

// 시나리오별 가짜 응답. 기본은 빈 결과(rows 0). users 조회만 이름 1개를 돌려 이름 복구 코드를 지나가게 한다
const SCENARIOS = {
  fresh: () => ({ rows: [], rowCount: 0 }),
  // v1 이전은 끝났고 v2는 아직인 상태: v2 경로(원본 조회·이전·완료 표시)를 지나간다
  v1done: (sql, params) => {
    if (/^SELECT 1 FROM concept_migrations WHERE name = \$1$/.test(sql)) return params[0] === 'voice_concepts_v1' ? { rows: [{ '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/^SELECT done_at FROM concept_migrations WHERE name = \$1$/.test(sql)) return { rows: [{ done_at: new Date('2026-01-01T00:00:00Z') }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
};

async function recordInit({ scenario = 'fresh', failOn = null, delayMs = 0, connectError = null, dbPath = DB_PATH } = {}) {
  const sqls = [], logs = [];
  const respond = SCENARIOS[scenario];
  const client = {
    released: false,
    async query(sqlRaw, params = []) {
      const sql = norm(sqlRaw);
      sqls.push({ sql, params: JSON.parse(JSON.stringify(params)) });
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (failOn && failOn.test(sql)) throw new Error('주입된 오류: ' + sql.slice(0, 40));
      if (/^SELECT id, name FROM users WHERE name IS NOT NULL ORDER BY id$/.test(sql)) return { rows: [{ id: 1, name: '테스트' }], rowCount: 1 };
      return respond(sql, params);
    },
    release() { this.released = true; },
  };
  class Pool { constructor() { this.query = client.query.bind(client); } async connect() { if (connectError) throw new Error(connectError); return client; } }

  const origLoad = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (request === 'pg') return { Pool };
    return origLoad.call(this, request, parent, ...rest);
  };
  const origLog = console.log, origErr = console.error;
  console.log = (...a) => { logs.push(a.join(' ')); };
  console.error = (...a) => { logs.push(a.join(' ')); };
  let result, error = null;
  try {
    delete require.cache[dbPath];
    const db = require(dbPath);
    try { result = await db.initDB(); } catch (e) { error = e.message; }
  } finally {
    console.log = origLog; console.error = origErr; Module._load = origLoad;
    delete require.cache[dbPath];
  }
  return { sqls, logs, result, error, released: client.released };
}

module.exports = { recordInit, SCENARIOS };
