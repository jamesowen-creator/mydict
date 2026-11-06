// 작업313: 문장 학습 시험용 가짜 DB (tests/jgrammar.test.js 의 가짜 DB 와 같은 SQL 범위 + lang 열). 실제 PostgreSQL 이 아니다.
// users: 1·2·6 번은 권한 있음, 3 번은 권한 없음, 4 번은 DB 관리자, 9 번은 권한 있지만 차단. 그 밖의 id 는 행 없음
// 작업404-T: failAuth = requireAuth 조회 자체가 실패. authQueries / permQueries 는 인증 조회·기능 권한 조회 횟수(시험이 검사 코드 실행을 단언하는 데 쓴다).
function createJgDb({ failAuth = false } = {}) {
  const db = { failAuth, authQueries: 0, permQueries: 0, cache: new Map(), usage: [], queries: [], saved: new Map(), clock: 0, nextId: 1,
    users: new Map([[1, { role: 'user', is_approved: true, is_blocked: false, perm_jgrammar: true }], [2, { role: 'user', is_approved: true, is_blocked: false, perm_jgrammar: true }],
      [6, { role: 'user', is_approved: true, is_blocked: false, perm_jgrammar: true }], [3, { role: 'user', is_approved: true, is_blocked: false, perm_jgrammar: false }],
      [4, { role: 'admin', is_approved: true, is_blocked: false, perm_jgrammar: false }], [9, { role: 'user', is_approved: true, is_blocked: true, perm_jgrammar: true }]]) };
  db.pool = {
    query: async (sql, params = []) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      db.queries.push(q);
      if (/^SELECT is_approved, is_blocked, role FROM users/.test(q)) {   // 작업404-T: requireAuth 조회 — 어떤 id 든 승인된 일반 사용자(role 만 users 표를 따름). 기능 권한 검사 조회와 구분한다
        db.authQueries++;
        if (db.failAuth) throw new Error('auth lookup down');
        const u = db.users.get(params[0]);
        return { rows: [{ is_approved: true, is_blocked: false, role: (u && u.role) || 'user' }] };
      }
      if (/FROM users/.test(q)) { db.permQueries++; }
      if (/FROM users/.test(q)) return db.users.has(params[0]) ? { rows: [db.users.get(params[0])] } : { rows: [] };
      if (/FROM jgrammar_cache/.test(q)) return db.cache.has(params[0]) ? { rows: [{ result: db.cache.get(params[0]).result }] } : { rows: [] };
      if (/^INSERT INTO jgrammar_cache/.test(q)) {
        if (!db.cache.has(params[0])) db.cache.set(params[0], { sentence: params[1], result: JSON.parse(params[2]), model: params[3], lang: params[4] });
        return { rows: [] };
      }
      if (/^UPDATE jgrammar_cache SET result = \$2, model = \$3 WHERE sentence_hash = \$1/.test(q)) {
        if (db.cache.has(params[0])) Object.assign(db.cache.get(params[0]), { result: JSON.parse(params[1]), model: params[2] });
        return { rows: [] };
      }
      if (/jgrammar_saved/.test(q)) {
        const mine = (uid, lang) => [...db.saved.values()].filter(r => r.user_id === uid && r.lang === lang).sort((a, b) => b.last_used_at - a.last_used_at || b.id - a.id);
        if (/^INSERT INTO jgrammar_saved \(user_id, sentence_hash, sentence, result, lang\)/.test(q)) {
          const [user_id, sentence_hash, sentence, result, lang] = params;
          const key = user_id + ':' + sentence_hash;   // UNIQUE (user_id, sentence_hash) — lang 은 유일 제약에 없다
          if (db.saved.has(key)) {
            const row = db.saved.get(key), next = JSON.parse(result);
            row.last_used_at = ++db.clock;
            const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);   // 작업318: ruby(ja·zh)뿐 아니라 units(en) 키로도 옛 형식을 새 결과로 갱신(서버 SQL 과 같은 조건)
            if ((!has(row.result, 'ruby') && has(next, 'ruby')) || (!has(row.result, 'units') && has(next, 'units'))) row.result = next;
          } else { const t = ++db.clock; db.saved.set(key, { id: db.nextId++, user_id, sentence_hash, sentence, result: JSON.parse(result), lang, created_at: t, last_used_at: t }); }
          return { rows: [] };
        }
        if (/^DELETE FROM jgrammar_saved WHERE user_id = \$1 AND lang = \$2 AND id IN/.test(q)) {
          const m = q.match(/OFFSET (\d+)/);
          for (const r of mine(params[0], params[1]).slice(Number(m[1]))) db.saved.delete(r.user_id + ':' + r.sentence_hash);
          return { rows: [] };
        }
        if (/^DELETE FROM jgrammar_saved WHERE id = \$1 AND user_id = \$2/.test(q)) {
          const hit = [...db.saved.entries()].find(([, r]) => r.id === params[0] && r.user_id === params[1]);
          if (!hit) return { rows: [] };
          db.saved.delete(hit[0]); return { rows: [{ id: params[0] }] };
        }
        if (/^SELECT id, sentence, result, created_at, last_used_at FROM jgrammar_saved WHERE user_id = \$1 AND lang = \$2/.test(q)) {
          const m = q.match(/LIMIT (\d+)/);
          return { rows: mine(params[0], params[1]).slice(0, Number(m[1])).map(r => ({ id: r.id, sentence: r.sentence, result: r.result, created_at: r.created_at, last_used_at: r.last_used_at })) };
        }
        throw new Error('지원하지 않는 SQL: ' + q);
      }
      if (/FROM api_usage/.test(q)) return { rows: [{ n: db.usage.filter(u => u.user_id === params[0] && params[1].includes(u.event_type)).length }] };
      throw new Error('지원하지 않는 SQL: ' + q);
    },
  };
  db.trackUsage = (user_id, event_type, model, input_tokens, output_tokens) => db.usage.push({ user_id, event_type, model, input_tokens, output_tokens });
  return db;
}
module.exports = { createJgDb };
