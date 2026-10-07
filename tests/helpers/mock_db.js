// 모의 DB: 메모리 테이블에 대해 이 프로젝트가 쓰는 단순한 SQL 형태만 처리한다.
//   INSERT INTO t (cols) VALUES (...) [ON CONFLICT DO NOTHING] [RETURNING ...]
//   SELECT cols|COUNT(*)::int AS n FROM t [WHERE a = $1 AND b = $2] [ORDER BY c DESC, id] [LIMIT n]
//   UPDATE t SET a = $3, updated_at = now() WHERE ... [RETURNING ...]
//   DELETE FROM t WHERE ... [RETURNING ...]
// 고유 인덱스·체크 제약·삭제 연쇄·트랜잭션(BEGIN/ROLLBACK)을 흉내 내고, 그 밖의 SQL은 오류로 알려 준다.
// 사용: const db = createMockDb(); db.pool.query(...) / db.client / db.tables / db.addUser(id)

const TABLE_DEFAULTS = {
  users: () => ({ is_blocked: false, perm_concept_study: true }),
  concept_studies: () => ({ selected_item_id: null, path: [], created_at: new Date(), updated_at: new Date() }),
  concept_items: () => ({
    english: null, group_label: null, definition: null, example: null, simple_text: null, deeper_text: null,
    content_source: 'none', status: 'active', review_state: 'new', origin: null, note: null,
    suggestions: null, feedback: null, legacy_voice_concept_id: null, created_at: new Date(), updated_at: new Date(),
  }),
  concept_links: () => ({ label: null, detail: null, created_at: new Date() }),
  voice_concepts: () => ({}),
  concept_quiz_attempts: () => ({ created_at: new Date() }),
  concept_migrations: () => ({ done_at: new Date() }),
  api_usage: () => ({ created_at: new Date() }),
};
const SERIAL = new Set(['concept_studies', 'concept_items', 'concept_links', 'api_usage', 'voice_concepts', 'concept_quiz_attempts']);
const JSON_COLS = new Set(['suggestions', 'feedback', 'path']);
const UNIQUE = {
  concept_items: [['study_id', 'term_key'], ['legacy_voice_concept_id']],
  concept_migrations: [['name']],
};
const CHECKS = {
  concept_items: {
    content_source: ['none', 'ai', 'user'], status: ['active', 'held', 'excluded'], review_state: ['new', 'understood', 'confused'],
  },
  concept_quiz_attempts: { kind: ['A', 'B'] },
  concept_links: {
    relation_type: ['포함', '원인→결과', '순서', '대비', '비슷함', '기타 관련'], source: ['ai', 'user'],
  },
};
const NOT_NULL = {
  concept_studies: ['user_id', 'topic'],
  concept_items: ['study_id', 'user_id', 'term', 'term_key'],
  concept_links: ['study_id', 'user_id', 'from_item_id', 'to_item_id', 'relation_type', 'source'],
  concept_quiz_attempts: ['user_id', 'study_id', 'item_id', 'kind', 'correct'],
};

function dbError(code, message) { const e = new Error(message); e.code = code; return e; }

function createMockDb() {
  const db = { tables: {}, seq: {}, queries: [], failOn: null, inTx: null };
  for (const t of Object.keys(TABLE_DEFAULTS)) { db.tables[t] = []; db.seq[t] = 1; }

  function resolveParam(tok, params) {
    tok = tok.trim().replace(/::\w+$/, '');
    let m = tok.match(/^\$(\d+)$/);
    if (m) return params[Number(m[1]) - 1];
    if (/^now\(\)$/i.test(tok)) return new Date();
    if (/^NULL$/i.test(tok)) return null;
    m = tok.match(/^'(.*)'$/);
    if (m) return m[1];
    throw new Error('mock_db: 지원하지 않는 값 표현 ' + tok);
  }

  function matcher(where, params) {
    if (!where) return () => true;
    const conds = where.split(' AND ').map(c => {
      const m = c.trim().match(/^(\w+) = (\$\d+|'.*')$/);
      if (!m) throw new Error('mock_db: 지원하지 않는 WHERE ' + c);
      return [m[1], resolveParam(m[2], params)];
    });
    return row => conds.every(([col, v]) => row[col] === v);
  }

  function project(row, cols) {
    if (!cols || cols.trim() === '*') return { ...row };
    const out = {};
    for (const c of cols.split(',').map(s => s.trim())) {
      if (c === '1') out['?column?'] = 1;
      else out[c] = row[c] === undefined ? null : row[c];
    }
    return out;
  }

  function checkRow(table, row, others, selfRow) {
    for (const col of NOT_NULL[table] || []) if (row[col] === null || row[col] === undefined) throw dbError('23502', `null value in column "${col}"`);
    for (const [col, allowed] of Object.entries(CHECKS[table] || {})) {
      if (!allowed.includes(row[col])) throw dbError('23514', `check constraint violated: ${table}.${col}`);
    }
    for (const cols of UNIQUE[table] || []) {
      if (cols.some(c => row[c] === null || row[c] === undefined)) continue;
      if (others.some(o => o !== selfRow && cols.every(c => o[c] === row[c]))) return { unique: cols.join(',') };
    }
    return null;
  }

  function cascadeDelete(table, removed) {
    const ids = new Set(removed.map(r => r.id));
    if (table === 'concept_studies') {
      db.tables.concept_links = db.tables.concept_links.filter(l => !ids.has(l.study_id));
      db.tables.concept_items = db.tables.concept_items.filter(i => !ids.has(i.study_id));
      db.tables.concept_quiz_attempts = db.tables.concept_quiz_attempts.filter(a => !ids.has(a.study_id));
    }
    if (table === 'concept_items') {
      db.tables.concept_links = db.tables.concept_links.filter(l => !ids.has(l.from_item_id) && !ids.has(l.to_item_id));
      db.tables.concept_quiz_attempts = db.tables.concept_quiz_attempts.filter(a => !ids.has(a.item_id));
    }
  }

  function normalizeJson(table, col, v) {
    return JSON_COLS.has(col) && typeof v === 'string' ? JSON.parse(v) : v;
  }

  // 마이그레이션이 쓰는 서브쿼리 SELECT는 형태가 달라 따로 처리
  const SPECIAL = [
    [/^SELECT id, name FROM users WHERE name IS NOT NULL/, () => ({ rows: [], rowCount: 0 })],
    [/^SELECT id, user_id, term, explanation, subject, subject_detail, topic, subtopic, last_rating, created_at FROM voice_concepts WHERE NOT EXISTS/, () => {
      const used = new Set(db.tables.concept_items.map(i => i.legacy_voice_concept_id).filter(x => x !== null));
      const rows = db.tables.voice_concepts.filter(v => !used.has(v.id)).sort((a, b) => a.user_id - b.user_id || a.id - b.id);
      return { rows: rows.map(r => ({ ...r })), rowCount: rows.length };
    }],
    [/^SELECT id, user_id, term, explanation, subject, subject_detail, topic, subtopic, last_rating, created_at FROM voice_concepts WHERE created_at > \$1 AND NOT EXISTS/, (sql, p) => {
      const used = new Set(db.tables.concept_items.map(i => i.legacy_voice_concept_id).filter(x => x !== null));
      const since = new Date(p[0]).getTime();
      const rows = db.tables.voice_concepts.filter(v => !used.has(v.id) && new Date(v.created_at).getTime() > since).sort((a, b) => a.user_id - b.user_id || a.id - b.id);
      return { rows: rows.map(r => ({ ...r })), rowCount: rows.length };
    }],
    [/^SELECT COUNT\(\*\)::int AS n FROM api_usage WHERE user_id = \$1 AND event_type = \$2 AND created_at >=/, (sql, p) => {
      const n = db.tables.api_usage.filter(r => r.user_id === p[0] && r.event_type === p[1]).length;
      return { rows: [{ n }], rowCount: 1 };
    }],
  ];

  async function query(sqlRaw, params = []) {
    const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
    db.queries.push({ sql, params });
    if (db.failOn && db.failOn.test(sql)) throw new Error('mock_db: 주입된 오류');
    if (/^BEGIN$/i.test(sql)) { db.inTx = structuredClone({ tables: db.tables, seq: db.seq }); return { rows: [], rowCount: 0 }; }
    if (/^COMMIT$/i.test(sql)) { db.inTx = null; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK$/i.test(sql)) {
      if (db.inTx) { db.tables = db.inTx.tables; db.seq = db.inTx.seq; db.inTx = null; }
      return { rows: [], rowCount: 0 };
    }
    for (const [re, fn] of SPECIAL) if (re.test(sql)) return fn(sql, params);

    let m = sql.match(/^INSERT INTO (\w+) \(([^)]*)\) VALUES \((.*?)\)(?: (ON CONFLICT DO NOTHING))?(?: RETURNING (.+))?$/);
    if (m) {
      const [, table, colStr, valStr, onConflict, ret] = m;
      if (!db.tables[table]) throw new Error('mock_db: 알 수 없는 테이블 ' + table);
      const cols = colStr.split(',').map(s => s.trim());
      const vals = valStr.split(/,\s*/);
      const row = TABLE_DEFAULTS[table]();
      cols.forEach((c, i) => { row[c] = normalizeJson(table, c, resolveParam(vals[i], params)); });
      if (SERIAL.has(table) && row.id === undefined) row.id = db.seq[table]++;
      else if (SERIAL.has(table) && row.id >= db.seq[table]) db.seq[table] = row.id + 1;
      const bad = checkRow(table, row, db.tables[table], null);
      if (bad) {
        if (onConflict) return { rows: [], rowCount: 0 };
        throw dbError('23505', 'duplicate key value violates unique constraint (' + bad.unique + ')');
      }
      db.tables[table].push(row);
      return { rows: ret ? [project(row, ret)] : [], rowCount: 1 };
    }

    m = sql.match(/^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (.+?))?(?: LIMIT (\d+))?$/);
    if (m) {
      const [, cols, table, where, order, limit] = m;
      if (!db.tables[table]) throw new Error('mock_db: 알 수 없는 테이블 ' + table);
      let rows = db.tables[table].filter(matcher(where, params));
      if (/^COUNT\(\*\)::int AS n$/.test(cols)) return { rows: [{ n: rows.length }], rowCount: 1 };
      const orderCols = (order || 'id').split(',').map(s => s.trim().split(/\s+/));
      rows = rows.slice().sort((a, b) => {
        for (const [c, dir] of orderCols) {
          const av = a[c] instanceof Date ? a[c].getTime() : a[c], bv = b[c] instanceof Date ? b[c].getTime() : b[c];
          if (av === bv) continue;
          return (av < bv ? -1 : 1) * (String(dir).toUpperCase() === 'DESC' ? -1 : 1);
        }
        return 0;
      });
      if (limit) rows = rows.slice(0, Number(limit));
      return { rows: rows.map(r => project(r, cols)), rowCount: rows.length };
    }

    m = sql.match(/^UPDATE (\w+) SET (.+?) WHERE (.+?)(?: RETURNING (.+))?$/);
    if (m) {
      const [, table, setStr, where, ret] = m;
      if (!db.tables[table]) throw new Error('mock_db: 알 수 없는 테이블 ' + table);
      const sets = setStr.split(/,\s*/).map(s => {
        const mm = s.match(/^(\w+) = (.+)$/);
        if (!mm) throw new Error('mock_db: 지원하지 않는 SET ' + s);
        return [mm[1], normalizeJson(table, mm[1], resolveParam(mm[2], params))];
      });
      const hit = db.tables[table].filter(matcher(where, params));
      for (const row of hit) {
        const next = { ...row };
        for (const [c, v] of sets) next[c] = v;
        const bad = checkRow(table, next, db.tables[table], row);
        if (bad) throw dbError('23505', 'duplicate key value violates unique constraint (' + bad.unique + ')');
        Object.assign(row, next);
      }
      return { rows: ret ? hit.map(r => project(r, ret)) : [], rowCount: hit.length };
    }

    m = sql.match(/^DELETE FROM (\w+) WHERE (.+?)(?: RETURNING (.+))?$/);
    if (m) {
      const [, table, where, ret] = m;
      if (!db.tables[table]) throw new Error('mock_db: 알 수 없는 테이블 ' + table);
      const test = matcher(where, params);
      const removed = db.tables[table].filter(test);
      db.tables[table] = db.tables[table].filter(r => !test(r));
      cascadeDelete(table, removed);
      return { rows: ret ? removed.map(r => project(r, ret)) : [], rowCount: removed.length };
    }

    // CREATE/ALTER 같은 스키마 문장은 기록만 하고 통과(initDB 흉내용)
    if (/^(CREATE|ALTER|SET|DROP) /i.test(sql)) return { rows: [], rowCount: 0 };
    throw new Error('mock_db: 지원하지 않는 SQL ' + sql.slice(0, 120));
  }

  db.query = query;
  db.client = { query, release() {} };
  db.pool = { query, connect: async () => db.client };
  db.trackUsage = (userId, eventType, model, inputTokens, outputTokens, charCount) => {
    db.tables.api_usage.push({ id: db.seq.api_usage++, user_id: userId || null, event_type: eventType, model: model || null,
      input_tokens: inputTokens || 0, output_tokens: outputTokens || 0, char_count: charCount || 0, created_at: new Date() });
  };
  db.addUser = (id, extra = {}) => { db.tables.users.push({ id, ...TABLE_DEFAULTS.users(), ...extra }); return id; };
  return db;
}

module.exports = { createMockDb };
