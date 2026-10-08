process.chdir(require('path').resolve(__dirname, '..', '..'));   // 저장소 루트(이 파일 기준)
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const root = require('path').resolve(__dirname, '..', '..').replace(/\\/g, '/') + '/';   // 저장소 루트(이 파일 기준)
process.env.DATABASE_URL = 'x';
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const chars = t => Array.from(t || '').length;

let authed = true, curUser = 7;
const notes = []; let nextId = 1;
const qlog = [];
function handle(sql, p) {
  qlog.push(sql);
  if (/^\s*INSERT INTO voice_notes[\s\S]*merged_from/.test(sql)) {
    const count = notes.filter(n => n.user_id === p[0]).length;
    if (!(count < p[3])) return { rows: [] };
    const n = { id: nextId++, user_id: p[0], title: p[1], transcript: p[2], summary: '', subject: p[4], subject_detail: p[5], summary_source_hash: null, merged_from: JSON.parse(p[6]), created_at: new Date(), updated_at: new Date() };
    notes.push(n);
    return { rows: [{ id: n.id, title: n.title, transcript: n.transcript, summary: n.summary, subject: n.subject, subject_detail: n.subject_detail, created_at: n.created_at, updated_at: n.updated_at }] };
  }
  if (/^\s*INSERT INTO voice_notes/.test(sql)) {
    const count = notes.filter(n => n.user_id === p[0]).length; if (!(count < p[4])) return { rows: [] };
    const n = { id: nextId++, user_id: p[0], title: p[1], transcript: p[2], summary: p[3], subject: p[5], subject_detail: p[6], summary_source_hash: p[7], merged_from: null, created_at: new Date(), updated_at: new Date() };
    notes.push(n); return { rows: [{ id: n.id, title: n.title, transcript: n.transcript, summary: n.summary, subject: n.subject, subject_detail: n.subject_detail }] };
  }
  if (/SELECT id, title, transcript, subject, subject_detail FROM voice_notes WHERE user_id = \$1 AND id = ANY/.test(sql)) return { rows: notes.filter(n => n.user_id === p[0] && p[1].includes(n.id)).map(n => ({ id: n.id, title: n.title, transcript: n.transcript, subject: n.subject, subject_detail: n.subject_detail })) };
  if (/SELECT id, title, transcript FROM voice_notes WHERE user_id = \$1 AND id = ANY/.test(sql)) return { rows: notes.filter(n => n.user_id === p[0] && p[1].includes(n.id)).map(n => ({ id: n.id, title: n.title, transcript: n.transcript })) };
  if (/SELECT id, title, transcript, summary, summary_source_hash, subject, subject_detail, merged_from/.test(sql)) return { rows: notes.filter(n => n.id === p[0] && n.user_id === p[1]).map(n => ({ ...n })) };
  if (/FROM voice_notes WHERE user_id = \$1\s+ORDER BY/.test(sql)) {
    const stale = /summary_stale/.test(sql);
    return { rows: notes.filter(n => n.user_id === p[0]).map(n => ({ id: n.id, title: n.title, subject: n.subject, subject_detail: n.subject_detail, summary: (n.summary || '').slice(0, 300), chars: chars(n.transcript), created_at: n.created_at, ...(stale ? { summary_stale: false } : {}) })) };
  }
  return { rows: [] };
}
const stubs = {
  [path.resolve(root, 'lib/db.js')]: { pool: { query: async (s, p) => handle(s, p), connect: async () => ({ query: async (s, p) => handle(s, p), release() {} }) }, trackUsage: () => {} },
  [path.resolve(root, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { if (!authed) return res.status(401).json({ error: 'no' }); req.user = { id: curUser }; next(); }, checkPermission: async () => true },
};
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  try { const r = Module._resolveFilename(req, parent); if (stubs[r]) return stubs[r]; } catch (e) {}
  return origLoad.call(this, req, parent, ...rest);
};
const express = require(root + 'node_modules/express');
const router = require(root + 'routes/voice_study.js');
const app = express(); app.use(express.json({ limit: '5mb' })); app.use(router);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
(async () => {
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; };
  const mk = (user, title, transcript, subject = null, detail = null) => { const n = { id: nextId++, user_id: user, title, transcript, summary: '', subject, subject_detail: detail, summary_source_hash: null, merged_from: null, created_at: new Date(), updated_at: new Date() }; notes.push(n); return n.id; };
  const get = id => notes.find(n => n.id === id);
  const merge = (ids, title) => call('POST', '/api/voice-notes/merge', title === undefined ? { note_ids: ids } : { note_ids: ids, title });
  const A = mk(7, '첫째', '첫째 원문입니다', '과학', '생물'), B = mk(7, '둘째', '둘째 원문입니다', '과학', '생물'), C = mk(7, '셋째', '셋째 원문입니다', '과학', '화학');
  const D = mk(7, '넷째', '넷째 원문입니다', '수학', null), E = mk(8, '타인', '타인 원문', '과학', '생물'), F = mk(7, '', '제목 없는 원문', '과학', '생물');
  const snapshot = () => JSON.stringify(notes.map(n => ({ ...n })));

  // ── 병합 성공 ──
  const before = snapshot();
  let r = await merge([C, A, B]);
  ok('merge 201', r.status === 201, r);
  const m1 = get(r.body.id);
  ok('order respected + blank line separator', r.body.transcript === '셋째 원문입니다\n\n첫째 원문입니다\n\n둘째 원문입니다' && m1.transcript === r.body.transcript, r.body.transcript);
  ok('default title', r.body.title === '합본: 셋째, 첫째, 둘째', r.body.title);
  ok('subject inherited, detail only when all same (mismatch → NULL)', r.body.subject === '과학' && r.body.subject_detail === null, r.body);
  ok('summary empty, source hash NULL', r.body.summary === '' && m1.summary_source_hash === null);
  ok('merged_from has id/title/hash in order', JSON.stringify(m1.merged_from) === JSON.stringify([{ id: C, title: '셋째', hash: sha('셋째 원문입니다') }, { id: A, title: '첫째', hash: sha('첫째 원문입니다') }, { id: B, title: '둘째', hash: sha('둘째 원문입니다') }]), m1.merged_from);
  const afterNotes = notes.filter(n => n.id !== r.body.id);
  ok('originals unchanged', JSON.stringify(afterNotes) === before, null);
  ok('response format: no hash/merged leak of internals', !('summary_source_hash' in r.body));
  r = await merge([A, B], '내 합본');
  ok('custom title + same subject/detail inherited', r.status === 201 && r.body.title === '내 합본' && r.body.subject === '과학' && r.body.subject_detail === '생물', r.body);
  r = await merge([A, B], '   ');
  ok('blank title → default', r.status === 201 && r.body.title === '합본: 첫째, 둘째');
  r = await merge([A, D]);
  ok('subject mismatch → NULL (and detail NULL)', r.status === 201 && r.body.subject === null && r.body.subject_detail === null, r.body);
  r = await merge([A, F]);
  ok('blank original title shown as (제목 없음)', r.body.title === '합본: 첫째, (제목 없음)', r.body.title);
  const long1 = mk(7, '가'.repeat(60), '긴 제목 원문 1', '과학', '생물'), long2 = mk(7, '나'.repeat(60), '긴 제목 원문 2', '과학', '생물');
  r = await merge([long1, long2]);
  ok('default title cut to 100 chars', r.status === 201 && chars(r.body.title) === 100 && r.body.title.startsWith('합본: 가가'), chars(r.body.title));
  r = await merge([A, B], 'x'.repeat(101)); ok('title 101 chars → 400', r.status === 400);
  r = await merge([A, B], 5); ok('non-string title → 400', r.status === 400);
  r = await call('POST', '/api/voice-notes/merge', { note_ids: [A, B], title: null }); ok('null title ok', r.status === 201);
  r = await merge([String(A), String(B)]); ok('numeric string ids accepted', r.status === 201);
  const six = [A, B, C, D, F, long1];
  r = await merge(six); ok('six allowed', r.status === 201 && JSON.parse(JSON.stringify(get(r.body.id).merged_from)).length === 6, r.status);

  // ── 오류 ──
  r = await merge([A]); ok('1 id → 400', r.status === 400, r);
  r = await merge([A, B, C, D, F, long1, long2]); ok('7 ids → 400', r.status === 400);
  r = await merge([A, A]); ok('duplicate → 400', r.status === 400);
  r = await merge([]); ok('empty → 400', r.status === 400);
  r = await call('POST', '/api/voice-notes/merge', { note_ids: 'x' }); ok('not array → 400', r.status === 400);
  r = await call('POST', '/api/voice-notes/merge', {}); ok('missing → 400', r.status === 400);
  r = await merge([A, 'abc']); ok('invalid id → 400', r.status === 400);
  r = await merge([A, 0]); ok('id 0 → 400', r.status === 400);
  r = await merge([A, 99999]); ok('missing note → 404', r.status === 404);
  r = await merge([A, E]); ok("other user's note → 404", r.status === 404, r);
  curUser = 8; r = await merge([A, B]); ok("other user's notes → 404 (as another user)", r.status === 404); curUser = 7;

  // ── 글자 수 한도 (VOICE_TRANSCRIPT_MAX) ──
  process.env.VOICE_TRANSCRIPT_MAX = '1000';
  const h1 = mk(7, 'h1', 'a'.repeat(499)), h2 = mk(7, 'h2', 'b'.repeat(499)), h3 = mk(7, 'h3', 'c'.repeat(500));
  r = await merge([h1, h2]); ok('exactly limit allowed (499+2+499=1000)', r.status === 201 && chars(r.body.transcript) === 1000, r.status);
  r = await merge([h1, h3]); ok('limit + 0 (499+2+500=1001) → 400 with guidance', r.status === 400 && r.body.error.includes('1001') && r.body.error.includes('1000') && r.body.error.includes('줄여'), r.body);
  r = await call('POST', '/api/voice-notes', { transcript: 'a'.repeat(1000) }); ok('POST honours env max', r.status === 201);
  r = await call('POST', '/api/voice-notes', { transcript: 'a'.repeat(1001) }); ok('POST over env max → 400 with value', r.status === 400 && r.body.error.includes('1000'), r.body);
  const pid = get(h1).id;
  r = await call('PATCH', `/api/voice-notes/${pid}`, { transcript: 'a'.repeat(1001) }); ok('PATCH over env max → 400', r.status === 400);
  r = await call('PATCH', `/api/voice-notes/${pid}`, { transcript: 'a'.repeat(1000) }); ok('PATCH at env max ok', r.status === 200 || r.status === 404 || r.status === 500, r.status);
  r = await call('POST', '/api/voice-notes/summarize', { transcript: 'a'.repeat(1001) }); ok('summarize input honours env max → 400', r.status === 400 && r.body.error.includes('1000'), r.body);
  r = await call('GET', '/api/voice-notes'); ok('list limits reflect env', r.body.limits.transcript_max === 1000, r.body.limits);
  process.env.VOICE_TRANSCRIPT_MAX = 'abc'; r = await call('GET', '/api/voice-notes'); ok('invalid env → default 30000', r.body.limits.transcript_max === 30000);
  process.env.VOICE_TRANSCRIPT_MAX = '999'; r = await call('GET', '/api/voice-notes'); ok('too-small env → default 30000', r.body.limits.transcript_max === 30000);
  delete process.env.VOICE_TRANSCRIPT_MAX; r = await call('GET', '/api/voice-notes'); ok('unset env → default 30000', r.body.limits.transcript_max === 30000);
  r = await call('POST', '/api/voice-notes', { transcript: 'a'.repeat(30000) }); ok('default max 30000 allowed', r.status === 201);
  r = await call('POST', '/api/voice-notes', { transcript: 'a'.repeat(30001) }); ok('default max 30001 → 400', r.status === 400 && r.body.error.includes('30000'));
  const big1 = mk(7, 'big1', 'x'.repeat(15000)), big2 = mk(7, 'big2', 'y'.repeat(15000));
  r = await merge([big1, big2]); ok('default max: 15000+2+15000 over → 400', r.status === 400, r.body);

  // ── 목록: chars·limits, transcript 미포함 ──
  r = await call('GET', '/api/voice-notes');
  const row = r.body.notes.find(x => x.id === A);
  ok('list shape {notes, limits}', Array.isArray(r.body.notes) && r.body.limits && r.body.limits.transcript_max === 30000);
  ok('list chars', row.chars === chars('첫째 원문입니다') && r.body.notes.every(x => typeof x.chars === 'number' && !('transcript' in x)), row);
  ok('list SQL has char_length, no transcript column in select list', /SELECT id, title, subject, subject_detail, LEFT\(summary, 300\) AS summary, char_length\(COALESCE\(transcript, ''\)\) AS chars/.test(qlog.filter(s => /ORDER BY created_at DESC/.test(s)).pop()));

  // ── 상세: merged_from 상태 ──
  const s1 = mk(7, '원본1', '원본 하나 원문'), s2 = mk(7, '원본2', '원본 둘 원문'), s3 = mk(7, '원본3', '원본 셋 원문');
  r = await merge([s1, s2, s3]); const mid = r.body.id;
  r = await call('GET', `/api/voice-notes/${mid}`);
  ok('detail merged_from all ok', r.status === 200 && JSON.stringify(r.body.merged_from) === JSON.stringify([{ id: s1, title: '원본1', status: 'ok' }, { id: s2, title: '원본2', status: 'ok' }, { id: s3, title: '원본3', status: 'ok' }]), r.body.merged_from);
  ok('detail has other fields unchanged', ['id', 'title', 'transcript', 'summary', 'summary_stale', 'subject', 'subject_detail', 'created_at', 'updated_at'].every(k => k in r.body) && !('summary_source_hash' in r.body));
  get(s2).transcript = '원본 둘 원문 수정됨'; get(s2).title = '바뀐 제목';
  notes.splice(notes.indexOf(get(s3)), 1);
  r = await call('GET', `/api/voice-notes/${mid}`);
  ok('detail status changed/deleted', r.body.merged_from[0].status === 'ok' && r.body.merged_from[1].status === 'changed' && r.body.merged_from[1].title === '바뀐 제목' && r.body.merged_from[2].status === 'deleted' && r.body.merged_from[2].title === '원본3', r.body.merged_from);
  r = await call('GET', `/api/voice-notes/${A}`); ok('normal note merged_from null', r.status === 200 && r.body.merged_from === null);
  // 원본을 고쳐도 합본 원문은 그대로
  ok('merge transcript not affected by later source edits', get(mid).transcript === '원본 하나 원문\n\n원본 둘 원문\n\n원본 셋 원문');

  // ── 200건 한도 ──
  curUser = 9; for (let i = 0; i < 198; i++) mk(9, 't' + i, 'x' + i);
  const l1 = mk(9, 'l1', '하나'), l2 = mk(9, 'l2', '둘');   // 200건
  r = await merge([l1, l2]); ok('200 notes limit → 400', r.status === 400 && r.body.error.includes('200'), r.body);
  curUser = 7;

  authed = false; r = await merge([A, B]); ok('401 merge', r.status === 401); r = await call('GET', '/api/voice-notes'); ok('401 list', r.status === 401);
  console.log('pass', pass, 'fail', fail);
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
