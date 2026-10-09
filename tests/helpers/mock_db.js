// 모의 DB: 메모리 테이블에 대해 이 프로젝트가 쓰는 단순한 SQL 형태만 처리한다.
//   INSERT INTO t (cols) VALUES (...) [ON CONFLICT DO NOTHING] [RETURNING ...]
//   SELECT cols|COUNT(*)::int AS n FROM t [WHERE a = $1 AND b = $2] [ORDER BY c DESC, id] [LIMIT n]
//   WHERE 조건은 AND로만 이으며: a = $1 / a = '문자' / a = true|false / a <> $1 / a IS NOT NULL / btrim(a) <> ''  (작업214-2에서 확장)
//   UPDATE t SET a = $3, updated_at = now() WHERE ... [RETURNING ...]
//   DELETE FROM t WHERE ... [RETURNING ...]
// 고유 인덱스·체크 제약·삭제 연쇄·트랜잭션(BEGIN/ROLLBACK)을 흉내 내고, 그 밖의 SQL은 오류로 알려 준다.
// 사용: const db = createMockDb(); db.pool.query(...) / db.client / db.tables / db.addUser(id)

const TABLE_DEFAULTS = {
  users: () => ({ is_blocked: false, perm_concept_study: true, perm_voice_study: true }),
  // 작업214-2: 음성 학습 자료·연결(자료 연결 지도 테스트용)
  voice_notes: () => ({ title: '', transcript: '', summary: null, subject: null, subject_detail: null, link_hash: null, keywords: null, merged_from: null, created_at: new Date(), updated_at: new Date() }),
  // 작업224-2: 퀴즈 요약 API 테스트용(저장된 퀴즈·시도 기록)
  voice_quizzes: () => ({ created_at: new Date() }),
  voice_quiz_attempts: () => ({ items: [], created_at: new Date() }),
  voice_links: () => ({ kind: 'grounded', relation: null, quote_from: '', quote_to: '', source: 'ai', user_edited: false, hidden: false, created_at: new Date() }),
  concept_studies: () => ({ selected_item_id: null, path: [], created_at: new Date(), updated_at: new Date() }),
  concept_items: () => ({
    english: null, group_label: null, definition: null, example: null, simple_text: null, deeper_text: null,
    content_source: 'none', status: 'active', review_state: 'new', origin: null, note: null,
    suggestions: null, feedback: null, legacy_voice_concept_id: null, created_at: new Date(), updated_at: new Date(),
  }),
  concept_links: () => ({ label: null, detail: null, user_edited: false, created_at: new Date() }),
  voice_concepts: () => ({}),
  concept_quiz_attempts: () => ({ created_at: new Date() }),
  concept_migrations: () => ({ done_at: new Date() }),
  api_usage: () => ({ created_at: new Date() }),
};
const SERIAL = new Set(['concept_studies', 'concept_items', 'concept_links', 'api_usage', 'voice_concepts', 'concept_quiz_attempts', 'voice_notes', 'voice_links', 'voice_quiz_attempts']);
const JSON_COLS = new Set(['suggestions', 'feedback', 'path', 'keywords', 'merged_from']);
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
    // 작업227-9: lib/db.js 의 concept_links_relation_types_v2 와 같은 11값(옛 6종 + 새 5종). 이 모의 DB 의 CHECK 는 실제 PG 제약을 흉내 낸 것일 뿐이다
    relation_type: ['포함', '원인→결과', '순서', '대비', '비슷함', '기타 관련', '사용', '일부', '종류', '일으킴', '구별'], source: ['ai', 'user'],
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
    if (/^true$/i.test(tok)) return true;
    if (/^false$/i.test(tok)) return false;
    m = tok.match(/^'(.*)'$/);
    if (m) return m[1];
    throw new Error('mock_db: 지원하지 않는 값 표현 ' + tok);
  }

  function matcher(where, params) {
    if (!where) return () => true;
    const conds = where.split(' AND ').map(c => {
      c = c.trim();
      let m = c.match(/^(\w+) = (\$\d+|'.*'|true|false)$/i);
      if (m) { const v = resolveParam(m[2], params); return row => row[m[1]] === v; }
      m = c.match(/^(\w+) <> (\$\d+)$/);
      if (m) { const v = resolveParam(m[2], params); return row => row[m[1]] !== v; }
      m = c.match(/^(\w+) IS NOT NULL$/i);
      if (m) return row => row[m[1]] !== null && row[m[1]] !== undefined;
      m = c.match(/^btrim\((\w+)\) <> ''$/);
      if (m) return row => typeof row[m[1]] === 'string' && row[m[1]].replace(/^ +| +$/g, '') !== '';
      throw new Error('mock_db: 지원하지 않는 WHERE ' + c);
    });
    return row => conds.every(test => test(row));
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
    if (table === 'voice_notes') {
      db.tables.voice_links = db.tables.voice_links.filter(l => !ids.has(l.from_note_id) && !ids.has(l.to_note_id));
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
    // POST /api/voice-notes: 건수 확인과 INSERT를 한 문장으로 하는 형태
    [/^INSERT INTO voice_notes \(user_id, title, transcript, summary, subject, subject_detail, summary_source_hash\) SELECT \$1, \$2, \$3, \$4, \$6, \$7, \$8 WHERE \(SELECT COUNT\(\*\) FROM voice_notes WHERE user_id = \$1\) < \$5 RETURNING/, (sql, p) => {
      if (db.tables.voice_notes.filter(n => n.user_id === p[0]).length >= p[4]) return { rows: [], rowCount: 0 };
      const row = { ...TABLE_DEFAULTS.voice_notes(), id: db.seq.voice_notes++, user_id: p[0], title: p[1], transcript: p[2], summary: p[3], subject: p[5], subject_detail: p[6], summary_source_hash: p[7] };
      db.tables.voice_notes.push(row);
      return { rows: [project(row, 'id, title, transcript, summary, subject, subject_detail, created_at, updated_at')], rowCount: 1 };
    }],
    // PATCH /api/voice-notes/:id 의 잠금 조회
    [/^SELECT summary, transcript FROM voice_notes WHERE id = \$1 AND user_id = \$2 FOR UPDATE$/, (sql, p) => {
      const rows = db.tables.voice_notes.filter(n => n.id === p[0] && n.user_id === p[1]).map(n => ({ summary: n.summary, transcript: n.transcript }));
      return { rows, rowCount: rows.length };
    }],
    // GET /api/voice-notes/:id/links 의 JOIN 조회: 자료 id($1)와 이어진 연결과 상대 자료. 숨김·해시 판단은 라우트가 한다
    [/^SELECT l\.id, l\.from_note_id.* FROM voice_links l JOIN voice_notes n ON/, (sql, p) => {
      const [id, uid] = p;
      const rows = [];
      for (const l of db.tables.voice_links.slice().sort((a, b) => b.id - a.id)) {
        if (!(l.from_note_id === id || l.to_note_id === id) || l.user_id !== uid) continue;
        const other = db.tables.voice_notes.find(n => n.id === (l.from_note_id === id ? l.to_note_id : l.from_note_id) && n.user_id === uid);
        if (!other) continue;
        rows.push({ ...l, other_id: other.id, other_title: other.title, other_summary: other.summary });
      }
      return { rows, rowCount: rows.length };
    }],
    // 작업224-2: GET /api/voice-notes/quiz-summary — 자료별 유효 퀴즈 여부(원문 해시 일치)와 시도 집계
    [/^SELECT n\.id, n\.title, n\.subject, n\.created_at, char_length\(regexp_replace\(COALESCE\(n\.transcript, ''\), '\\s', '', 'g'\)\) AS chars_nospace, .* FROM voice_notes n LEFT JOIN voice_quizzes q ON/, (sql, p) => {
      const sha = t => require('crypto').createHash('sha256').update(String(t), 'utf8').digest('hex');
      const rows = db.tables.voice_notes.filter(n => n.user_id === p[0]).sort((a, b) => (new Date(b.created_at) - new Date(a.created_at)) || (b.id - a.id)).map(n => {
        const q = db.tables.voice_quizzes.find(x => x.note_id === n.id && x.user_id === n.user_id);
        return { id: n.id, title: n.title, subject: n.subject, created_at: n.created_at, chars_nospace: Array.from(String(n.transcript || '').replace(/\s+/g, '')).length,
          has_quiz: !!q && q.source_hash === sha(n.transcript || '') };
      });
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT note_id, COUNT\(\*\)::int AS attempts, .* FROM voice_quiz_attempts WHERE user_id = \$1 GROUP BY note_id$/, (sql, p) => {
      const by = new Map();
      for (const a of db.tables.voice_quiz_attempts.filter(x => x.user_id === p[0])) { if (!by.has(a.note_id)) by.set(a.note_id, []); by.get(a.note_id).push(a); }
      const rows = [...by].map(([note_id, list]) => {
        list.sort((a, b) => (new Date(b.created_at) - new Date(a.created_at)) || (b.id - a.id));
        return { note_id, attempts: list.length, last_score: list[0].score, last_total: list[0].total, last_at: list[0].created_at };
      });
      return { rows, rowCount: rows.length };
    }],
    // 작업227-9: initDB 의 CHECK 확장 단계가 제약 목록을 조회한다(모의 DB 에는 제약 카탈로그가 없으니 빈 결과 = 아직 새 제약 없음)
    [/^SELECT c\.conname, pg_get_constraintdef\(c\.oid\) AS def FROM pg_constraint c WHERE c\.conrelid = 'concept_links'::regclass/, () => ({ rows: [], rowCount: 0 })],
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
    if (/^(CREATE|ALTER|SET|DROP|LOCK) /i.test(sql)) return { rows: [], rowCount: 0 };   // 작업227-9: initDB 의 LOCK TABLE 도 통과
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
