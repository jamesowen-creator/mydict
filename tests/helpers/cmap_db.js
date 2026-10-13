// 작업271-1: 개념 지도(cmap_topics, cmap_concepts) 전용 가짜 DB. 공용 tests/helpers/mock_db.js 는 수정하지 않고, 그 위에 얹는다
// (users 등 나머지 SQL 은 mock_db 에 맡기고, cmap_* SQL 만 여기서 처리한다).
// 실제 PG 제약을 흉내 낸 것일 뿐이다(한계): UNIQUE(lower), CHECK(제목 길이·parent/root 짝), FK(NO ACTION: 문장 끝 / DEFERRED: 트랜잭션 끝),
// 트랜잭션(BEGIN 시점 복사본으로 ROLLBACK). SQL 은 routes/concept_map.js 가 쓰는 형태만 처리하고 그 밖의 cmap SQL 은 오류로 알린다.
const { createMockDb } = require('./mock_db');

function dbError(code, message) { const e = new Error(message); e.code = code; return e; }
const lower = s => String(s).toLowerCase();
const len = s => Array.from(String(s)).length;

function createCmapDb() {
  const base = createMockDb();
  const db = { base, topics: [], concepts: [], seq: { t: 1, c: 1 }, snap: null, queries: [], failOn: null, tables: base.tables, trackUsage: base.trackUsage, addUser: base.addUser };

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
    if (db.concepts.some(o => o !== self && o.id !== row.id && o.topic_id === row.topic_id && lower(o.term) === lower(row.term))) throw dbError('23505', 'duplicate key (cmap_concepts term)');
  }
  const ids = new Set();
  function checkTopicRefs() {   // NO ACTION: 문장 끝에 남은 주제가 사라진 주제를 가리키면 오류
    ids.clear(); db.topics.forEach(t => ids.add(t.id));
    for (const t of db.topics) {
      if (t.parent_id !== null && !ids.has(t.parent_id)) throw dbError('23503', 'cmap_topics parent FK');
      if (t.root_id !== null && !ids.has(t.root_id)) throw dbError('23503', 'cmap_topics root FK');
    }
  }
  function checkConceptRefs() {   // DEFERRABLE INITIALLY DEFERRED: 트랜잭션 끝(COMMIT)에 검사
    ids.clear(); db.topics.forEach(t => ids.add(t.id));
    for (const c of db.concepts) if (!ids.has(c.topic_id)) throw dbError('23503', 'cmap_concepts topic FK');
  }

  // ── 문장 해석 ──
  const tableOf = name => (name === 'cmap_topics' ? db.topics : db.concepts);
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

  async function query(sqlRaw, params = []) {
    const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
    if (!/cmap_|^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return base.pool.query(sqlRaw, params);
    db.queries.push(sql);
    if (db.failOn && db.failOn.test(sql)) throw new Error('cmap_db: 주입된 오류');
    if (/^BEGIN$/i.test(sql)) { db.snap = JSON.stringify({ t: db.topics, c: db.concepts, seq: db.seq }); return { rows: [], rowCount: 0 }; }
    if (/^COMMIT$/i.test(sql)) { checkConceptRefs(); checkTopicRefs(); db.snap = null; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK$/i.test(sql)) {
      if (db.snap) { const s = JSON.parse(db.snap); db.topics = s.t; db.concepts = s.c; db.seq = s.seq; db.snap = null; }
      return { rows: [], rowCount: 0 };
    }
    let m;
    if ((m = sql.match(/^SELECT topic_id, COUNT\(\*\)::int AS n FROM cmap_concepts WHERE user_id = \$1 GROUP BY topic_id$/))) {
      const by = new Map();
      for (const c of db.concepts) if (c.user_id === params[0]) by.set(c.topic_id, (by.get(c.topic_id) || 0) + 1);
      return { rows: [...by].map(([topic_id, n]) => ({ topic_id, n })), rowCount: by.size };
    }
    if ((m = sql.match(/^SELECT (.+?) FROM (cmap_topics|cmap_concepts) WHERE (.+?)(?: ORDER BY (.+?))?(?: FOR UPDATE)?$/))) {
      let rows = tableOf(m[2]).filter(conds(m[3], params));
      if (m[4]) { if (m[4] !== 'sort_order, id') throw new Error('cmap_db: 지원하지 않는 ORDER BY ' + m[4]); rows = rows.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id); }
      return { rows: rows.map(r => pick(r, m[1])), rowCount: rows.length };
    }
    if ((m = sql.match(/^INSERT INTO (cmap_topics|cmap_concepts) \(([^)]*)\) VALUES \(([^)]*)\) RETURNING (.+)$/))) {
      const cols = m[1] === undefined ? [] : m[2].split(',').map(s => s.trim());
      const vals = m[3].split(',').map(s => s.trim());
      const row = m[1] === 'cmap_topics'
        ? { id: db.seq.t++, created_at: new Date(), updated_at: new Date(), sort_order: 0 }
        : { id: db.seq.c++, created_at: new Date(), updated_at: new Date(), sort_order: 0, content_source: 'manual', english: null, memo: null };
      cols.forEach((c, i) => { const mm = vals[i].match(/^\$(\d+)$/); if (!mm) throw new Error('cmap_db: 지원하지 않는 VALUES'); row[c] = params[Number(mm[1]) - 1]; });
      if (m[1] === 'cmap_topics') { checkTopic(row, null); db.topics.push(row); } else { checkConcept(row, null); db.concepts.push(row); }
      return { rows: [pick(row, m[4])], rowCount: 1 };
    }
    if ((m = sql.match(/^UPDATE (cmap_topics|cmap_concepts) SET (.+?) WHERE (.+?)(?: RETURNING (.+))?$/))) {
      const sets = m[2].split(/,\s*/).map(s => {
        const mm = s.match(/^(\w+) = (\$(\d+)|now\(\))$/);
        if (!mm) throw new Error('cmap_db: 지원하지 않는 SET ' + s);
        return [mm[1], mm[3] ? params[Number(mm[3]) - 1] : new Date()];
      });
      const hit = tableOf(m[1]).filter(conds(m[3], params));
      for (const row of hit) {
        const next = clone(row);
        for (const [c, v] of sets) next[c] = v;
        if (m[1] === 'cmap_topics') checkTopic(next, row); else checkConcept(next, row);
        Object.assign(row, next);
      }
      if (m[1] === 'cmap_topics') checkTopicRefs();
      return { rows: m[4] ? hit.map(r => pick(r, m[4])) : [], rowCount: hit.length };
    }
    if ((m = sql.match(/^DELETE FROM (cmap_topics|cmap_concepts) WHERE (.+?)$/))) {
      const test = conds(m[2], params);
      const list = tableOf(m[1]);
      const removed = list.filter(test);
      const keep = list.filter(r => !test(r));
      if (m[1] === 'cmap_topics') { db.topics = keep; checkTopicRefs(); } else db.concepts = keep;   // 주제는 문장 끝 검사(NO ACTION)
      return { rows: [], rowCount: removed.length };
    }
    throw new Error('cmap_db: 지원하지 않는 SQL ' + sql.slice(0, 140));
  }

  db.query = query;
  db.client = { query, release() {} };
  db.pool = { query, connect: async () => db.client };
  // 테스트 편의
  db.topicBy = (userId, title) => db.topics.find(t => t.user_id === userId && t.title === title);
  db.snapshot = () => JSON.stringify({ t: db.topics, c: db.concepts });
  return db;
}

module.exports = { createCmapDb };
