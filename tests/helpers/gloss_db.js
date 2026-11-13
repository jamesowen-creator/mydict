// 작업417: 단어 뜻 일괄 변환 시험용 가짜 DB. lib/gloss_backfill.js 의 SQL(B.SQL)을 문장 그대로 알아보고, 같은 뜻으로 메모리 표에서 흉내 낸다.
// users: 4 = DB 관리자, 5 = 이메일 관리자(ADMIN_EMAILS=u5@example.com), 그 밖 = 일반 사용자
const B = require('../../lib/gloss_backfill');

const norm = s => s.replace(/\s+/g, ' ').trim();
const SQLN = Object.fromEntries(Object.entries(B.SQL).map(([k, v]) => [k, norm(v)]));
const eq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}
const clone = v => JSON.parse(JSON.stringify(v));
const hasMeanings = d => !!d && Array.isArray(d.meanings) && d.meanings.length >= 1;
const isTarget = r => r.lang === 'en' && !!r.data && !('gloss_v' in r.data) && hasMeanings(r.data);
const maxDef = r => Math.max(0, ...r.data.meanings.map(m => (m && typeof m.definition === 'string' ? Array.from(m.definition).length : 0)));

function createGlossDb() {
  const db = { rows: [], backup: [], usage: [], queries: [], writes: 0, beforeApply: null, backupSeq: 0 };
  db.addRow = (id, word, data, { user_id = 1, lang = 'en' } = {}) => { db.rows.push({ id, user_id, word, lang, data }); return db.rows[db.rows.length - 1]; };
  db.get = id => db.rows.find(r => r.id === id);
  db.pool = {
    query: async (sql, p = []) => {
      const s = norm(sql);
      db.queries.push(s);
      if (/^SELECT is_approved, is_blocked, role FROM users/.test(s)) return { rows: [{ is_approved: true, is_blocked: false, role: p[0] === 4 ? 'admin' : 'user' }] };
      if (s === SQLN.targets) return { rows: db.rows.filter(r => isTarget(r) && r.id > p[0]).sort((a, b) => a.id - b.id).slice(0, p[1]).map(clone) };
      if (s === SQLN.countTargets) { const t = db.rows.filter(isTarget); return { rows: [{ n: t.length, users: new Set(t.map(r => r.user_id)).size }] }; }
      if (s === SQLN.countRemaining) return { rows: [{ n: db.rows.filter(r => isTarget(r) && r.id > p[0]).length }] };
      if (s === SQLN.countLegacy) return { rows: [{ n: db.rows.filter(r => r.lang === 'en' && !(r.data && 'gloss_v' in r.data) && !hasMeanings(r.data)).length }] };
      if (s === SQLN.countDone) return { rows: [{ n: db.rows.filter(r => r.lang === 'en' && r.data && 'gloss_v' in r.data).length }] };
      if (s === SQLN.sampleLong) return { rows: db.rows.filter(isTarget).sort((a, b) => maxDef(b) - maxDef(a)).slice(0, p[0]).map(clone) };
      if (s === SQLN.sampleRandom) return { rows: db.rows.filter(r => isTarget(r) && !p[1].includes(r.id)).slice(0, p[0]).map(clone) };
      if (s === SQLN.sampleWords) {
        const seen = new Set();
        return { rows: db.rows.filter(r => isTarget(r) && p[0].includes(r.word.toLowerCase())).sort((a, b) => a.id - b.id).filter(r => { const k = r.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map(clone) };
      }
      if (s === SQLN.apply) {
        const row = db.get(p[0]);
        if (db.beforeApply) db.beforeApply(row);   // 읽은 뒤·쓰기 전에 사용자가 고치는 상황을 흉내 낸다
        if (!row || !eq(row.data, JSON.parse(p[1]))) return { rowCount: 0, rows: [] };
        row.data = JSON.parse(p[2]); db.writes++;
        db.backup.push({ id: ++db.backupSeq, run_id: p[3], wordbook_id: p[0], before: JSON.parse(p[1]), after: JSON.parse(p[2]), created_at: new Date() });
        return { rowCount: 1, rows: [] };
      }
      if (s === SQLN.backupRows) return { rows: db.backup.filter(b => b.run_id === p[0] && b.id < p[1]).sort((a, b) => b.id - a.id).slice(0, p[2]).map(clone) };
      if (s === SQLN.backupRowsAll) return { rows: db.backup.filter(b => b.id < p[0]).sort((a, b) => b.id - a.id).slice(0, p[1]).map(clone) };
      if (s === SQLN.restore) {
        const row = db.get(p[0]);
        if (!row || !eq(row.data, JSON.parse(p[1]))) return { rowCount: 0, rows: [] };
        row.data = JSON.parse(p[2]); db.writes++;
        return { rowCount: 1, rows: [] };
      }
      if (s === SQLN.backupDownload) return { rows: db.backup.filter(b => b.run_id === p[0]).map(clone) };
      throw new Error('지원하지 않는 SQL: ' + s.slice(0, 80));
    },
  };
  db.trackUsage = (user_id, event_type, model, input_tokens, output_tokens, char_count) => db.usage.push({ user_id, event_type, model, input_tokens, output_tokens, char_count });
  return db;
}

module.exports = { createGlossDb, clone };
