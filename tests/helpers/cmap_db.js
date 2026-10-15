// 작업271-1·273-1·273-2: 개념 지도(cmap_topics, cmap_concepts, cmap_maps, cmap_map_nodes, cmap_edges) 전용 가짜 DB. 공용 tests/helpers/mock_db.js 는 수정하지 않고, 그 위에 얹는다
// (users 등 나머지 SQL 은 mock_db 에 맡기고, cmap_* SQL 만 여기서 처리한다).
// 실제 PG 제약을 흉내 낸 것일 뿐이다(한계): UNIQUE(lower)·UNIQUE(쌍, 방향 무관), CHECK, FK(NO ACTION: 문장 끝 / DEFERRED: 트랜잭션 끝 / CASCADE: 연쇄 삭제),
// 트랜잭션(BEGIN 시점 복사본으로 ROLLBACK). SQL 은 routes/concept_map.js 가 쓰는 형태만 처리하고 그 밖의 cmap SQL 은 오류로 알린다.
const { createMockDb } = require('./mock_db');

function dbError(code, message) { const e = new Error(message); e.code = code; return e; }
const lower = s => String(s).toLowerCase();
const len = s => Array.from(String(s)).length;
const REL = ['사용', '일부', '종류', '일으킴', '선행', '조건', '구별', '유사', '대립', '연관'];   // 286-1: DB CHECK 와 같은 10값
const TABLES = ['cmap_topics', 'cmap_concepts', 'cmap_maps', 'cmap_map_nodes', 'cmap_edges', 'cmap_narrations', 'cmap_quiz_attempts', 'cmap_concept_marks', 'cmap_answer_attempts'];

function createCmapDb() {
  const base = createMockDb();
  const db = { base, topics: [], concepts: [], maps: [], nodes: [], edges: [], narrations: [], attempts: [], marks: [], answers: [], seq: { t: 1, c: 1, m: 1, e: 1, n: 1, q: 1, w: 1 }, snap: null, queries: [], failOn: null, tables: base.tables, trackUsage: base.trackUsage, addUser: base.addUser };
  const list = name => ({ cmap_topics: db.topics, cmap_concepts: db.concepts, cmap_maps: db.maps, cmap_map_nodes: db.nodes, cmap_edges: db.edges, cmap_narrations: db.narrations, cmap_quiz_attempts: db.attempts, cmap_concept_marks: db.marks, cmap_answer_attempts: db.answers })[name];
  const setList = (name, arr) => { const k = { cmap_topics: 'topics', cmap_concepts: 'concepts', cmap_maps: 'maps', cmap_map_nodes: 'nodes', cmap_edges: 'edges', cmap_narrations: 'narrations', cmap_quiz_attempts: 'attempts', cmap_concept_marks: 'marks', cmap_answer_attempts: 'answers' }[name]; db[k] = arr; };

  // ── 제약 ──
  function checkTopic(row, self) {
    if (typeof row.title !== 'string' || len(row.title) < 1 || len(row.title) > 80 || row.title.trim() === '') throw dbError('23514', 'cmap_topics title check');
    if ((row.parent_id === null) !== (row.root_id === null)) throw dbError('23514', 'cmap_topics parent/root check');
    const dup = db.topics.find(o => o !== self && o.id !== row.id && (
      row.parent_id === null ? (o.parent_id === null && o.user_id === row.user_id) : o.parent_id === row.parent_id) && lower(o.title) === lower(row.title));
    if (dup) throw dbError('23505', 'duplicate key (cmap_topics title)');
  }
  function checkConcept(row, self) {
    if (typeof row.term !== 'string' || len(row.term) < 1 || len(row.term) > 80 || row.term.trim() === '') throw dbError('23514', 'cmap_concepts term check');
    if (row.english !== null && len(row.english) > 120) throw dbError('23514', 'cmap_concepts english check');
    if (row.memo !== null && len(row.memo) > 2000) throw dbError('23514', 'cmap_concepts memo check');
    if (row.explanation_source !== null && row.explanation_source !== undefined && !['ai', 'manual'].includes(row.explanation_source)) throw dbError('23514', 'cmap_concepts explanation_source check');
    if (db.concepts.some(o => o !== self && o.id !== row.id && o.topic_id === row.topic_id && lower(o.term) === lower(row.term))) throw dbError('23505', 'duplicate key (cmap_concepts term)');
  }
  function checkMap(row) {
    if (typeof row.title !== 'string' || len(row.title) < 1 || len(row.title) > 80 || row.title.trim() === '') throw dbError('23514', 'cmap_maps title check');
  }
  function checkNode(row, self) {
    if (db.nodes.some(o => o !== self && o.map_id === row.map_id && o.concept_id === row.concept_id)) throw dbError('23505', 'duplicate key (cmap_map_nodes pk)');
    if (!db.maps.some(m => m.id === row.map_id)) throw dbError('23503', 'cmap_map_nodes map FK');
    if (!db.concepts.some(c => c.id === row.concept_id)) throw dbError('23503', 'cmap_map_nodes concept FK');
    for (const v of [row.x, row.y]) if (v !== null && v !== undefined && !Number.isFinite(v)) throw dbError('22003', 'cmap_map_nodes real');
  }
  function checkEdge(row, self) {
    // 286-1: 문구는 NULL 허용(값이 있으면 1~40자·공백만 아님), 유형도 문구도 없으면 거부
    if (row.label !== null && row.label !== undefined && (typeof row.label !== 'string' || len(row.label) < 1 || len(row.label) > 40 || row.label.trim() === '')) throw dbError('23514', 'cmap_edges label check');
    if ((row.label === null || row.label === undefined) && (row.relation_type === null || row.relation_type === undefined)) throw dbError('23514', 'cmap_edges has_content check');
    if (row.relation_type !== null && row.relation_type !== undefined && !REL.includes(row.relation_type)) throw dbError('23514', 'cmap_edges relation_type check');
    if (row.from_concept_id === row.to_concept_id) throw dbError('23514', 'cmap_edges from<>to check');
    const others = db.edges.filter(o => o !== self && o.id !== row.id && o.map_id === row.map_id);
    if (others.some(o => o.from_concept_id === row.from_concept_id && o.to_concept_id === row.to_concept_id)) throw dbError('23505', 'duplicate key (cmap_edges map,from,to)');
    if (others.some(o => Math.min(o.from_concept_id, o.to_concept_id) === Math.min(row.from_concept_id, row.to_concept_id) && Math.max(o.from_concept_id, o.to_concept_id) === Math.max(row.from_concept_id, row.to_concept_id))) throw dbError('23505', 'duplicate key (cmap_edges pair)');
    for (const cid of [row.from_concept_id, row.to_concept_id]) if (!db.nodes.some(n => n.map_id === row.map_id && n.concept_id === cid)) throw dbError('23503', 'cmap_edges node FK');
  }
  function checkNarration(row, self) {   // 작업273-4: UNIQUE(map_id), map FK, NOT NULL
    if (db.narrations.some(o => o !== self && o.map_id === row.map_id)) throw dbError('23505', 'duplicate key (cmap_narrations map_id)');
    if (!db.maps.some(m => m.id === row.map_id)) throw dbError('23503', 'cmap_narrations map FK');
    if (!row.source_hash || row.content === null || row.content === undefined || !row.model) throw dbError('23502', 'cmap_narrations not null');
  }
  function checkAttempt(row) {   // 작업273-5: map FK, NOT NULL
    if (!db.maps.some(m => m.id === row.map_id)) throw dbError('23503', 'cmap_quiz_attempts map FK');
    if (!row.source_hash || row.user_id === undefined || row.user_id === null) throw dbError('23502', 'cmap_quiz_attempts not null');
    for (const v of [row.pair_score, row.type_score, row.direction_score]) if (v !== null && v !== undefined && !Number.isFinite(v)) throw dbError('22003', 'cmap_quiz_attempts real');
  }
  function checkMark(row, self) {   // 작업275-4: PK(user_id, concept_id), 개념 FK
    if (db.marks.some(o => o !== self && o.user_id === row.user_id && o.concept_id === row.concept_id)) throw dbError('23505', 'duplicate key (cmap_concept_marks pk)');
    if (!db.concepts.some(c => c.id === row.concept_id)) throw dbError('23503', 'cmap_concept_marks concept FK');
  }
  function checkAnswer(row) {   // 작업278-1: verdict·input_mode CHECK, 개념 FK, NOT NULL
    if (!['충분', '부분적', '부족'].includes(row.verdict)) throw dbError('23514', 'cmap_answer_attempts verdict check');
    if (!['voice', 'text'].includes(row.input_mode)) throw dbError('23514', 'cmap_answer_attempts input_mode check');
    if (!db.concepts.some(c => c.id === row.concept_id)) throw dbError('23503', 'cmap_answer_attempts concept FK');
    if (typeof row.summary !== 'string' || row.user_id === undefined || row.user_id === null) throw dbError('23502', 'cmap_answer_attempts not null');
  }
  const ids = new Set();
  function checkTopicRefs() {   // NO ACTION: 문장 끝에 남은 주제가 사라진 주제를 가리키면 오류
    ids.clear(); db.topics.forEach(t => ids.add(t.id));
    for (const t of db.topics) {
      if (t.parent_id !== null && !ids.has(t.parent_id)) throw dbError('23503', 'cmap_topics parent FK');
      if (t.root_id !== null && !ids.has(t.root_id)) throw dbError('23503', 'cmap_topics root FK');
    }
  }
  function checkDeferredRefs() {   // DEFERRABLE INITIALLY DEFERRED: 트랜잭션 끝(COMMIT)에 검사
    ids.clear(); db.topics.forEach(t => ids.add(t.id));
    for (const c of db.concepts) if (!ids.has(c.topic_id)) throw dbError('23503', 'cmap_concepts topic FK');
    for (const m of db.maps) if (!ids.has(m.root_topic_id)) throw dbError('23503', 'cmap_maps root topic FK');
  }
  // CASCADE: 지도 → 노드·간선, 개념 → 노드, 노드 → 그 노드를 끝으로 하는 간선
  function cascadeAfterDelete(table, removed) {
    if (!removed.length) return;
    if (table === 'cmap_maps') {
      const mids = new Set(removed.map(m => m.id));
      cascadeAfterDelete('cmap_map_nodes', db.nodes.filter(n => mids.has(n.map_id)));
      db.nodes = db.nodes.filter(n => !mids.has(n.map_id));
      db.edges = db.edges.filter(e => !mids.has(e.map_id));
      db.narrations = db.narrations.filter(n => !mids.has(n.map_id));
      db.attempts = db.attempts.filter(n => !mids.has(n.map_id));
    } else if (table === 'cmap_concepts') {
      const cids = new Set(removed.map(c => c.id));
      db.marks = db.marks.filter(m => !cids.has(m.concept_id));
      db.answers = db.answers.filter(a => !cids.has(a.concept_id));
      const gone = db.nodes.filter(n => cids.has(n.concept_id));
      db.nodes = db.nodes.filter(n => !cids.has(n.concept_id));
      cascadeAfterDelete('cmap_map_nodes', gone);
    } else if (table === 'cmap_map_nodes') {
      db.edges = db.edges.filter(e => !removed.some(n => n.map_id === e.map_id && (n.concept_id === e.from_concept_id || n.concept_id === e.to_concept_id)));
    }
  }

  // ── 문장 해석 ──
  function conds(where, params) {
    const tests = where.split(' AND ').map(c => {
      const m = c.trim().match(/^(\w+) = \$(\d+)$/);
      if (!m) throw new Error('cmap_db: 지원하지 않는 WHERE ' + c);
      const v = params[Number(m[2]) - 1];
      return row => row[m[1]] === v;
    });
    return row => tests.every(t => t(row));
  }
  const pick = (row, cols) => { const o = {}; for (const c of cols.split(',').map(s => s.trim())) o[c] = row[c] === undefined ? null : row[c]; return o; };
  const clone = r => ({ ...r });
  const jsonCol = (col, v) => ((col === 'explanation' || col === 'content' || col === 'strengths' || col === 'gaps') && typeof v === 'string' ? JSON.parse(v) : v);   // JSONB: 문자열 파라미터는 객체로 저장
  const checkers = { cmap_topics: checkTopic, cmap_concepts: checkConcept, cmap_maps: checkMap, cmap_map_nodes: checkNode, cmap_edges: checkEdge, cmap_narrations: checkNarration, cmap_quiz_attempts: checkAttempt, cmap_concept_marks: checkMark, cmap_answer_attempts: checkAnswer };
  const newRow = {
    cmap_topics: () => ({ id: db.seq.t++, created_at: new Date(), updated_at: new Date(), sort_order: 0 }),
    cmap_concepts: () => ({ id: db.seq.c++, created_at: new Date(), updated_at: new Date(), sort_order: 0, content_source: 'manual', english: null, memo: null, explanation: null, explanation_source: null, explained_at: null }),
    cmap_maps: () => ({ id: db.seq.m++, created_at: new Date(), updated_at: new Date(), semantic_hash: null, saved_at: null }),
    cmap_map_nodes: () => ({ x: null, y: null }),
    cmap_edges: () => ({ id: db.seq.e++, created_at: new Date(), relation_type: null }),
    cmap_narrations: () => ({ id: db.seq.n++, created_at: new Date() }),
    cmap_quiz_attempts: () => ({ id: db.seq.q++, created_at: new Date() }),
    cmap_concept_marks: () => ({ marked_at: new Date() }),
    cmap_answer_attempts: () => ({ id: db.seq.w++, created_at: new Date(), supplement: '' }),
  };
  const sortBy = (rows, order) => {
    const cols = order.split(',').map(s => s.trim());
    return rows.slice().sort((a, b) => { for (const c of cols) { if (a[c] === b[c]) continue; return a[c] < b[c] ? -1 : 1; } return 0; });
  };
  const tableRe = TABLES.join('|');

  async function query(sqlRaw, params = []) {
    const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
    if (!/cmap_|^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return base.pool.query(sqlRaw, params);
    db.queries.push(sql);
    if (db.failOn && db.failOn.test(sql)) throw new Error('cmap_db: 주입된 오류');
    if (/^BEGIN$/i.test(sql)) { db.snap = JSON.stringify({ t: db.topics, c: db.concepts, m: db.maps, n: db.nodes, e: db.edges, a: db.narrations, q: db.attempts, k: db.marks, w: db.answers, seq: db.seq }); return { rows: [], rowCount: 0 }; }
    if (/^COMMIT$/i.test(sql)) { checkDeferredRefs(); checkTopicRefs(); db.snap = null; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK$/i.test(sql)) {
      if (db.snap) { const s = JSON.parse(db.snap); db.topics = s.t; db.concepts = s.c; db.maps = s.m; db.nodes = s.n; db.edges = s.e; db.narrations = s.a; db.attempts = s.q; db.marks = s.k || []; db.answers = s.w || []; db.seq = s.seq; db.snap = null; }
      return { rows: [], rowCount: 0 };
    }
    let m;
    if ((m = sql.match(/^SELECT topic_id, COUNT\(\*\)::int AS n FROM cmap_concepts WHERE user_id = \$1 GROUP BY topic_id$/))) {
      const by = new Map();
      for (const c of db.concepts) if (c.user_id === params[0]) by.set(c.topic_id, (by.get(c.topic_id) || 0) + 1);
      return { rows: [...by].map(([topic_id, n]) => ({ topic_id, n })), rowCount: by.size };
    }
    if ((m = sql.match(new RegExp(`^SELECT (.+?) FROM (${tableRe}) WHERE (.+?)(?: ORDER BY (.+?))?(?: FOR UPDATE)?$`)))) {
      let rows = list(m[2]).filter(conds(m[3], params));
      if (m[4]) rows = sortBy(rows, m[4]);
      return { rows: rows.map(r => pick(r, m[1])), rowCount: rows.length };
    }
    if ((m = sql.match(new RegExp(`^INSERT INTO (${tableRe}) \\(([^)]*)\\) VALUES \\(([^)]*)\\) RETURNING (.+)$`)))) {
      const cols = m[2].split(',').map(s => s.trim());
      const vals = m[3].split(',').map(s => s.trim());
      const row = newRow[m[1]]();
      cols.forEach((c, i) => { const mm = vals[i].match(/^\$(\d+)$/); if (!mm) throw new Error('cmap_db: 지원하지 않는 VALUES'); row[c] = jsonCol(c, params[Number(mm[1]) - 1]); });
      checkers[m[1]](row, null);
      list(m[1]).push(row);
      return { rows: [pick(row, m[4])], rowCount: 1 };
    }
    if ((m = sql.match(new RegExp(`^UPDATE (${tableRe}) SET (.+?) WHERE (.+?)(?: RETURNING (.+))?$`)))) {
      const sets = m[2].split(/,\s*/).map(s => {
        const mm = s.match(/^(\w+) = (\$(\d+)|now\(\)|NULL)$/);
        if (!mm) throw new Error('cmap_db: 지원하지 않는 SET ' + s);
        return [mm[1], mm[3] ? jsonCol(mm[1], params[Number(mm[3]) - 1]) : mm[2] === 'NULL' ? null : new Date()];
      });
      const hit = list(m[1]).filter(conds(m[3], params));
      for (const row of hit) {
        const next = clone(row);
        for (const [c, v] of sets) next[c] = v;
        checkers[m[1]](next, row);
        Object.assign(row, next);
      }
      if (m[1] === 'cmap_topics') checkTopicRefs();
      return { rows: m[4] ? hit.map(r => pick(r, m[4])) : [], rowCount: hit.length };
    }
    if ((m = sql.match(new RegExp(`^DELETE FROM (${tableRe}) WHERE (.+?)$`)))) {
      const test = conds(m[2], params);
      const rowsOf = list(m[1]);
      const removed = rowsOf.filter(test);
      setList(m[1], rowsOf.filter(r => !test(r)));
      cascadeAfterDelete(m[1], removed);
      if (m[1] === 'cmap_topics') checkTopicRefs();   // 주제는 문장 끝 검사(NO ACTION)
      return { rows: [], rowCount: removed.length };
    }
    throw new Error('cmap_db: 지원하지 않는 SQL ' + sql.slice(0, 140));
  }

  db.query = query;
  db.client = { query, release() {} };
  db.pool = { query, connect: async () => db.client };
  // 테스트 편의
  db.topicBy = (userId, title) => db.topics.find(t => t.user_id === userId && t.title === title);
  db.snapshot = () => JSON.stringify({ t: db.topics, c: db.concepts, m: db.maps, n: db.nodes, e: db.edges, a: db.narrations, q: db.attempts, k: db.marks, w: db.answers });
  return db;
}

module.exports = { createCmapDb };
