process.chdir(require('path').resolve(__dirname, '..', '..'));   // 저장소 루트(이 파일 기준)
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const root = require('path').resolve(__dirname, '..', '..').replace(/\\/g, '/') + '/';   // 저장소 루트(이 파일 기준)
process.env.DATABASE_URL = 'x';
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

let authed = true, curUser = 7, failUpdate = false, failStaleList = false;
const notes = []; let nextId = 1;
const log = { connects: 0, releases: 0, rollbacks: 0, commits: 0, sql: [] };
function handle(sql, p) {
  log.sql.push(sql);
  if (/^\s*INSERT INTO voice_notes/.test(sql)) {
    const n = { id: nextId++, user_id: p[0], title: p[1], transcript: p[2], summary: p[3], subject: p[5], subject_detail: p[6], summary_source_hash: p[7], created_at: new Date(), updated_at: new Date() };
    notes.push(n); return { rows: [{ id: n.id, title: n.title, transcript: n.transcript, summary: n.summary, subject: n.subject, subject_detail: n.subject_detail }] };
  }
  if (/SELECT summary, transcript FROM voice_notes WHERE id/.test(sql)) return { rows: notes.filter(n => n.id === p[0] && n.user_id === p[1]).map(n => ({ summary: n.summary, transcript: n.transcript })) };
  if (/^\s*UPDATE voice_notes SET/.test(sql)) {
    if (failUpdate) throw new Error('db down');
    const n = notes.find(x => x.id === p[0] && x.user_id === p[1]); if (!n) return { rows: [] };
    const sets = [...sql.split('RETURNING')[0].matchAll(/(\w+) = \$(\d+)/g)];
    for (const [, k, i] of sets) n[k] = p[Number(i) - 1];
    return { rows: [{ id: n.id, title: n.title, transcript: n.transcript, summary: n.summary, subject: n.subject, subject_detail: n.subject_detail }] };
  }
  if (/SELECT id, title, transcript, summary, summary_source_hash, subject/.test(sql)) return { rows: notes.filter(n => n.id === p[0] && n.user_id === p[1]).map(n => ({ ...n })) };
  if (/FROM voice_notes WHERE user_id = \$1\s+ORDER BY/.test(sql)) {
    const withStale = /summary_stale/.test(sql);
    if (withStale && failStaleList) { const e = new Error('function sha256(bytea) does not exist'); throw e; }
    return { rows: notes.filter(n => n.user_id === p[0]).map(n => {
      const row = { id: n.id, title: n.title, subject: n.subject, subject_detail: n.subject_detail, summary: (n.summary || '').slice(0, 300), created_at: n.created_at };
      if (withStale) row.summary_stale = !!(n.summary && n.summary.trim() && n.summary_source_hash && n.summary_source_hash !== sha(n.transcript || ''));   // 실제 SQL과 같은 판정을 모의
      return row;
    }) };
  }
  if (/FROM api_usage/.test(sql)) return { rows: [{ n: 0 }] };
  return { rows: [] };
}
const stubs = {
  [path.resolve(root, 'lib/db.js')]: {
    pool: {
      query: async (s, p) => handle(s, p),
      connect: async () => { log.connects++; return { query: async (s, p) => { if (/^\s*ROLLBACK/.test(s)) { log.rollbacks++; return {}; } if (/^\s*COMMIT/.test(s)) { log.commits++; return {}; } if (/^\s*BEGIN/.test(s)) return {}; return handle(s, p); }, release() { log.releases++; } }; },
    },
    trackUsage: () => {},
  },
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
  const T1 = '첫 원문입니다', T2 = '첫 원문입니다\n\n이어서 녹음한 내용', S1 = '유형: 개념 설명\n\n■ 주제\n- 요약', S2 = '유형: 개념 설명\n\n■ 주제\n- 다른 요약';
  const get = id => notes.find(n => n.id === id);
  const callList = async () => { const x = await call('GET', '/api/voice-notes'); x.limits = x.body && x.body.limits; x.body = (x.body && x.body.notes) || x.body; return x; };

  // POST
  let r = await call('POST', '/api/voice-notes', { transcript: T1, summary: S1 });
  ok('POST with summary → hash of transcript', r.status === 201 && get(r.body.id).summary_source_hash === sha(T1), r);
  const a = r.body.id;
  r = await call('POST', '/api/voice-notes', { transcript: T1, summary: '' }); ok('POST empty summary → NULL', get(r.body.id).summary_source_hash === null);
  r = await call('POST', '/api/voice-notes', { transcript: T1, summary: '  \n ' }); ok('POST whitespace summary → NULL', get(r.body.id).summary_source_hash === null);
  r = await call('POST', '/api/voice-notes', { transcript: T1 }); ok('POST no summary → NULL', get(r.body.id).summary_source_hash === null);
  ok('POST response format unchanged (no hash leaked)', !('summary_source_hash' in (await call('POST', '/api/voice-notes', { transcript: T1, summary: S1 })).body));

  // PATCH 규칙
  let before = log.connects;
  r = await call('PATCH', `/api/voice-notes/${a}`, { transcript: T2 });
  ok('PATCH transcript only: hash untouched, no transaction', r.status === 200 && get(a).summary_source_hash === sha(T1) && get(a).transcript === T2 && log.connects === before && !log.sql.filter(s => /UPDATE voice_notes/.test(s)).pop().includes('summary_source_hash'));
  before = log.connects;
  r = await call('PATCH', `/api/voice-notes/${a}`, { title: '제목만' });
  ok('PATCH title only: untouched', r.status === 200 && get(a).summary_source_hash === sha(T1) && log.connects === before);
  r = await call('PATCH', `/api/voice-notes/${a}`, { transcript: T2, summary: S1 });
  ok('PATCH same summary + new transcript: hash NOT updated (stays old)', r.status === 200 && get(a).summary_source_hash === sha(T1), get(a).summary_source_hash);
  r = await call('PATCH', `/api/voice-notes/${a}`, { summary: S2 });
  ok('PATCH changed summary (transcript from DB): hash = sha(stored transcript)', r.status === 200 && get(a).summary_source_hash === sha(T2) && log.commits >= 1, get(a).summary_source_hash);
  r = await call('PATCH', `/api/voice-notes/${a}`, { transcript: T1, summary: S1 });
  ok('PATCH changed summary + new transcript: hash = sha(new transcript)', r.status === 200 && get(a).summary_source_hash === sha(T1));
  r = await call('PATCH', `/api/voice-notes/${a}`, { summary: '' });
  ok('PATCH empty summary → NULL', r.status === 200 && get(a).summary_source_hash === null);
  await call('PATCH', `/api/voice-notes/${a}`, { summary: S1 });
  ok('summary restored → hash set again', get(a).summary_source_hash === sha(T1));
  r = await call('PATCH', `/api/voice-notes/${a}`, { summary: '   ' });
  ok('PATCH whitespace summary → NULL', get(a).summary_source_hash === null);
  ok('transactions released and committed', log.connects === log.releases && log.rollbacks === 0, log);
  // 다른 사용자 → 404 + ROLLBACK
  curUser = 8; const rb = log.rollbacks;
  r = await call('PATCH', `/api/voice-notes/${a}`, { summary: S2 }); ok('other user PATCH w/ summary 404 + rollback', r.status === 404 && log.rollbacks === rb + 1 && log.connects === log.releases);
  curUser = 7;
  // DB 오류 → 500 + ROLLBACK + release
  failUpdate = true; const rb2 = log.rollbacks; const sumBefore = get(a).summary, hashBefore = get(a).summary_source_hash;
  r = await call('PATCH', `/api/voice-notes/${a}`, { summary: S2 }); failUpdate = false;
  ok('DB error → 500, rollback, released', r.status === 500 && log.rollbacks === rb2 + 1 && log.connects === log.releases, r);
  ok('failed update left data unchanged', get(a).summary === sumBefore && get(a).summary_source_hash === hashBefore);
  r = await call('PATCH', `/api/voice-notes/${a}`, { summary: 5 }); ok('invalid summary type 400', r.status === 400);
  r = await call('PATCH', '/api/voice-notes/999', { summary: S1 }); ok('missing note PATCH w/ summary 404', r.status === 404);

  // GET 단건 stale 판정
  const mk = (summary, hash, transcript = T1) => { const n = { id: nextId++, user_id: 7, title: 't', transcript, summary, subject: null, subject_detail: null, summary_source_hash: hash, created_at: new Date(), updated_at: new Date() }; notes.push(n); return n.id; };
  const same = mk(S1, sha(T1)), diff = mk(S1, sha('옛 원문')), legacy = mk(S1, null), emptySum = mk('', sha('옛 원문')), blankSum = mk('  ', sha('옛 원문'));
  for (const [name, id, want] of [['hash equals current → false', same, false], ['hash differs → true', diff, true], ['legacy hash NULL → false', legacy, false], ['empty summary → false', emptySum, false], ['blank summary → false', blankSum, false]]) {
    r = await call('GET', `/api/voice-notes/${id}`);
    ok('GET ' + name, r.status === 200 && r.body.summary_stale === want && !('summary_source_hash' in r.body), r.body);
  }
  r = await call('GET', `/api/voice-notes/${diff}`);
  ok('GET existing fields unchanged', ['id', 'title', 'transcript', 'summary', 'subject', 'subject_detail', 'created_at', 'updated_at'].every(k => k in r.body), Object.keys(r.body));
  // 목록
  r = await callList();
  const row = id => r.body.find(x => x.id === id);
  ok('list: stale flags', row(diff).summary_stale === true && row(same).summary_stale === false && row(legacy).summary_stale === false && row(emptySum).summary_stale === false, r.body.map(x => [x.id, x.summary_stale]));
  ok('list: no transcript / hash in rows', r.body.every(x => !('transcript' in x) && !('summary_source_hash' in x)), Object.keys(r.body[0]));
  const listSql = log.sql.filter(s => /ORDER BY created_at DESC/.test(s)).pop();
  ok('list SQL selects no transcript column', /SELECT id, title, subject, subject_detail, LEFT\(summary, 300\) AS summary, char_length\(COALESCE\(transcript, ''\)\) AS chars, created_at,/.test(listSql) && !/SELECT id, title, transcript/.test(listSql) && /sha256\(convert_to\(COALESCE\(transcript/.test(listSql) && /AS summary_stale/.test(listSql));
  ok('list: other users not included', (() => { return r.body.every(x => notes.find(n => n.id === x.id).user_id === 7); })());
  // 해시 SQL 함수가 없는 DB → 목록은 계속 나오고 stale은 false
  failStaleList = true; r = await callList(); failStaleList = false;
  ok('list fallback when hash SQL unavailable', r.status === 200 && r.body.length > 0 && r.body.every(x => x.summary_stale === false && !('transcript' in x)), r.status);
  // 한도·형식 회귀
  r = await call('POST', '/api/voice-notes', { transcript: 'a'.repeat(30001) }); ok('transcript limit 400', r.status === 400);
  r = await call('POST', '/api/voice-notes', { transcript: 'a'.repeat(30000), summary: 'x' }); ok('transcript 30000 allowed', r.status === 201);
  r = await call('POST', '/api/voice-notes', { transcript: 'x', summary: 'a'.repeat(5001) }); ok('summary limit 400', r.status === 400);
  r = await call('POST', '/api/voice-notes', { summary: S1 }); ok('transcript required 400', r.status === 400);
  r = await call('PATCH', `/api/voice-notes/${a}`, { transcript: '  ' }); ok('PATCH empty transcript 400', r.status === 400);
  r = await call('PATCH', `/api/voice-notes/${a}`, {}); ok('PATCH empty body 400', r.status === 400);
  r = await call('POST', '/api/voice-notes', { transcript: 'x', subject: '과학', subject_detail: '문학' }); ok('subject validation still 400', r.status === 400);
  authed = false;
  for (const [m, u] of [['GET', '/api/voice-notes'], ['GET', `/api/voice-notes/${a}`], ['PATCH', `/api/voice-notes/${a}`]]) { r = await call(m, u, m === 'GET' ? undefined : {}); ok('401 ' + m + ' ' + u, r.status === 401); }
  console.log('pass', pass, 'fail', fail);
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
