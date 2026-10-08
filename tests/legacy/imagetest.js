process.chdir(require('path').resolve(__dirname, '..', '..'));   // 저장소 루트(이 파일 기준)
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const root = require('path').resolve(__dirname, '..', '..').replace(/\\/g, '/') + '/';   // 저장소 루트(이 파일 기준)
process.env.DATABASE_URL = 'x';
process.env.ANTHROPIC_API_KEY = 'ak';
process.env.OPENAI_API_KEY = 'ok';
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

let authed = true, curUser = 7;
const notes = new Map();      // id -> {id,user_id,summary}
const sets = new Map();       // note_id -> set
const images = new Map();     // `${note}:${page}` -> row
const tracked = [];
const usageBase = {};         // event -> preset count
const planQueue = [], planCalls = [], visionCalls = [];
let visionMode = 'pass';
const openaiCalls = []; let openaiHandler = null;
let sqlLog = [];

const usageCount = (u, ev) => tracked.filter(t => t[0] === u && t[1] === ev).length + (usageBase[ev] || 0);
function nowMs() { return Date.now(); }

function handle(sql, p) {
  sqlLog.push(sql);
  if (/FROM api_usage/.test(sql)) return { rows: [{ n: usageCount(p[0], p[1]) }] };
  if (/^\s*SELECT summary FROM voice_notes/.test(sql)) { const n = notes.get(p[0]); return { rows: n && n.user_id === p[1] ? [{ summary: n.summary }] : [] }; }
  if (/^\s*DELETE FROM voice_image_sets WHERE note_id = \$1 AND user_id/.test(sql)) {
    const s = sets.get(p[0]); if (s && s.user_id === p[1]) { sets.delete(p[0]); for (const k of [...images.keys()]) if (k.startsWith(p[0] + ':')) images.delete(k); } return { rows: [] };
  }
  if (/^\s*INSERT INTO voice_image_sets/.test(sql)) { sets.set(p[0], { note_id: p[0], user_id: p[1], status: 'planning', summary_hash: p[2], pages_total: null, truncated: null, error: null, rating: null, updated: nowMs() }); return { rows: [] }; }
  if (/DELETE FROM voice_image_sets WHERE user_id = \$1 AND note_id NOT IN/.test(sql)) {
    const mine = [...sets.values()].filter(s => s.user_id === p[0]).sort((a, b) => b.updated - a.updated || b.note_id - a.note_id);
    for (const s of mine.slice(20)) { sets.delete(s.note_id); for (const k of [...images.keys()]) if (k.startsWith(s.note_id + ':')) images.delete(k); }
    return { rows: [] };
  }
  if (/SELECT status, \(updated_at > now\(\)/.test(sql)) { const s = sets.get(p[0]); return { rows: s && s.user_id === p[1] ? [{ status: s.status, fresh: nowMs() - s.updated < 15 * 60000 }] : [] }; }
  if (/timed_out/.test(sql)) { const s = sets.get(p[0]); return { rows: s && s.user_id === p[1] ? [{ ...s, timed_out: nowMs() - s.updated > 15 * 60000 }] : [] }; }
  if (/UPDATE voice_image_sets SET status = 'generating'/.test(sql)) { const s = sets.get(p[0]); s.status = 'generating'; s.pages_total = p[1]; s.truncated = p[2]; s.updated = nowMs(); return { rows: [] }; }
  if (/UPDATE voice_image_sets SET updated_at = now\(\) WHERE/.test(sql)) { sets.get(p[0]).updated = nowMs(); return { rows: [] }; }
  if (/UPDATE voice_image_sets SET status = \$2, error = \$3/.test(sql)) { const s = sets.get(p[0]); s.status = p[1]; s.error = p[2]; s.updated = nowMs(); return { rows: [] }; }
  if (/UPDATE voice_image_sets SET status = 'failed', error = \$2/.test(sql)) { const s = sets.get(p[0]); if (s) { s.status = 'failed'; s.error = p[1]; s.updated = nowMs(); } return { rows: [] }; }
  if (/UPDATE voice_image_sets SET rating/.test(sql)) { const s = sets.get(p[0]); if (s && s.user_id === p[1] && s.status === 'ready') { s.rating = p[2]; return { rowCount: 1, rows: [] }; } return { rowCount: 0, rows: [] }; }
  if (/^\s*INSERT INTO voice_images/.test(sql)) { images.set(p[0] + ':' + p[1], { note_id: p[0], page_no: p[1], status: 'pending', title: p[2], cells: JSON.parse(p[3]), image: null, mime: null, check_result: null, attempts: 0, error: null }); return { rows: [] }; }
  if (/UPDATE voice_images SET status = 'ready'/.test(sql)) { Object.assign(images.get(p[0] + ':' + p[1]), { status: 'ready', image: p[2], mime: p[3], check_result: p[4], attempts: p[5], error: p[6] }); return { rows: [] }; }
  if (/UPDATE voice_images SET status = 'failed'/.test(sql)) { Object.assign(images.get(p[0] + ':' + p[1]), { status: 'failed', attempts: p[2], error: p[3] }); return { rows: [] }; }
  if (/SELECT page_no, title, status, check_result, error FROM voice_images/.test(sql)) return { rows: [...images.values()].filter(i => i.note_id === p[0]).sort((a, b) => a.page_no - b.page_no) };
  if (/SELECT i\.image, i\.mime/.test(sql)) {
    const s = sets.get(p[0]); const i = images.get(p[0] + ':' + p[2]);
    return { rows: s && s.user_id === p[1] && i && i.status === 'ready' ? [{ image: i.image, mime: i.mime }] : [] };
  }
  return { rows: [] };
}
const stubs = {
  [path.resolve(root, 'lib/db.js')]: { pool: { query: async (s, p) => handle(s, p) }, trackUsage: (...a) => tracked.push(a) },
  [path.resolve(root, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { if (!authed) return res.status(401).json({ error: 'no' }); req.user = { id: curUser }; next(); },
    checkPermission: async () => true,
  },
};
class FakeAnthropic {
  get messages() {
    return { create: async (args) => {
      if (args.system.includes('연상 그림 카드로 나누는')) {
        planCalls.push(args);
        const r = planQueue.shift();
        if (r === undefined) throw new Error('no plan queued');
        if (r instanceof Error) throw r;
        return { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r) }], usage: { input_tokens: 10, output_tokens: 20 } };
      }
      visionCalls.push(args);
      if (visionMode === 'api-error') throw new Error('vision down');
      const promptText = globalThis.__lastPrompt || '';
      const texts = [];
      for (const line of promptText.split('\n')) {
        if (/^\[장 제목\]|^\[장 표시\]/.test(line)) { const m = line.match(/"([^"]+)"/); if (m) texts.push(m[1]); }
        else if (/^칸 번호/.test(line)) { for (const m of line.matchAll(/"([^"]+)"/g)) texts.push(m[1]); }
        else if (/^ {2}· /.test(line) && !/강조 단어/.test(line)) { for (const m of line.matchAll(/"([^"]+)"/g)) texts.push(m[1]); }
      }
      let out;
      if (visionMode === 'pass') out = { texts };
      else if (visionMode === 'extra') out = { texts: [...texts, '엉뚱한 여분 글자가 아주 많이 들어간 문장입니다 정말로 많이'] };
      else if (visionMode === 'missing') out = { texts: texts.slice(0, -1) };
      else if (visionMode === 'bad-json') out = '이건 JSON이 아님';
      else if (visionMode === 'bad-shape') out = { texts: 'x' };
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }], usage: { input_tokens: 5, output_tokens: 6 } };
    } };
  }
}
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@anthropic-ai/sdk') return FakeAnthropic;
  try { const r = Module._resolveFilename(req, parent); if (stubs[r]) return stubs[r]; } catch (e) {}
  return origLoad.call(this, req, parent, ...rest);
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.openai.com/')) {
    const body = JSON.parse(opts.body);
    openaiCalls.push({ url, body, auth: opts.headers.Authorization });
    globalThis.__lastPrompt = body.prompt;
    return openaiHandler(body);
  }
  return realFetch(url, opts);
};
const okImage = (n = 1200) => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.alloc(n, 7).toString('base64') }] }) });
const errImage = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

const express = require(root + 'node_modules/express');
const router = require(root + 'routes/voice_study.js');
const app = express(); app.use(express.json()); app.use(router);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SUMMARY = '유형: 시간·사건\n\n■ 주제\n- 조선 건국과 한양 천도\n\n■ 배경\n- 1392년 이성계가 조선을 세웠다\n- ⚠ 외계인이 건국을 도왔다는 근거 없는 항목\n\n■ 전개\n- 1394년 한양으로 수도를 옮겼다\n- 경복궁을 지었다\n- 성균관을 세웠다\n\n■ 결과·영향\n- 유교 중심 국가가 되었다\n- 도성을 쌓았다\n\n■ 외울 것\n- 1392년 조선 건국\n- 1394년 한양 천도';
const cell = (title, icon, text, extra = {}) => ({ title, icon, lines: [{ tag: extra.tag || '', text }], emphasis: extra.emphasis || [] });
const goodCells = () => [
  cell('건국', '왕관', '1392년 이성계가 조선을 세웠다', { tag: '배경', emphasis: ['1392년'] }),
  cell('천도', '지도', '1394년 한양으로 수도를 옮겼다'),
  cell('궁궐', '궁전', '경복궁을 지었다'),
  cell('학문', '책', '성균관을 세웠다'),
];
const page = (title, cells, flow = false) => ({ title, flow, cells });
const resetState = () => {
  sets.clear(); images.clear(); tracked.length = 0; planQueue.length = 0; planCalls.length = 0; visionCalls.length = 0; openaiCalls.length = 0;
  for (const k of Object.keys(usageBase)) delete usageBase[k];
  visionMode = 'pass'; openaiHandler = async () => okImage(); sqlLog = [];
  process.env.VOICE_IMAGE_ENABLED = 'true';
  for (const k of ['VOICE_IMAGE_MAX_BYTES', 'VOICE_IMAGE_MODEL', 'VOICE_IMAGE_QUALITY', 'VOICE_IMAGE_FORMAT', 'VOICE_IMAGE_COMPRESSION', 'VOICE_IMAGE_DAILY_CAP', 'VOICE_IMAGE_MAX_PAGES']) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = 'ak'; process.env.OPENAI_API_KEY = 'ok'; curUser = 7; authed = true;
  notes.set(1, { id: 1, user_id: 7, summary: SUMMARY });
};

(async () => {
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (method, url, body) => {
    const r = await realFetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get('content-type') || '';
    let j = null; if (ct.includes('json')) { try { j = await r.json(); } catch (e) {} } else { j = Buffer.from(await r.arrayBuffer()); }
    return { status: r.status, body: j, headers: r.headers };
  };
  const waitDone = async (id = 1) => { for (let i = 0; i < 60; i++) { const r = await call('GET', `/api/voice-notes/${id}/image`); if (r.body && r.body.status !== 'planning' && r.body.status !== 'generating') return r.body; await sleep(50); } return null; };
  const post = (id = 1) => call('POST', `/api/voice-notes/${id}/image`);

  // ── 1. 가드 ──
  resetState();
  process.env.VOICE_IMAGE_ENABLED = 'false';
  let r = await post(); ok('off 503', r.status === 503, r);
  delete process.env.VOICE_IMAGE_ENABLED; r = await post(); ok('unset 503', r.status === 503);
  r = await call('GET', '/api/voice-notes/1/image'); ok('GET when off still answers', r.status === 200 && r.body.enabled === false && r.body.status === 'none', r.body);
  resetState();
  delete process.env.OPENAI_API_KEY; r = await post(); ok('no openai key 503', r.status === 503); process.env.OPENAI_API_KEY = 'ok';
  delete process.env.ANTHROPIC_API_KEY; r = await post(); ok('no anthropic key 503', r.status === 503); process.env.ANTHROPIC_API_KEY = 'ak';
  r = await post(99); ok('missing note 404', r.status === 404);
  r = await post('abc'); ok('bad id 404', r.status === 404);
  notes.set(2, { id: 2, user_id: 7, summary: '  ' }); r = await post(2); ok('no summary 400', r.status === 400, r);
  notes.set(3, { id: 3, user_id: 8, summary: SUMMARY }); r = await post(3); ok('other user 404', r.status === 404);
  usageBase.image = 4; r = await post(); ok('remaining 0 → 429', r.status === 429, r); usageBase.image = 0;
  process.env.VOICE_IMAGE_DAILY_CAP = '2'; usageBase.image = 2; r = await post(); ok('cap env respected 429', r.status === 429); usageBase.image = 0; delete process.env.VOICE_IMAGE_DAILY_CAP;
  // 진행 중 409 (DB 행 기준)
  sets.set(1, { note_id: 1, user_id: 7, status: 'generating', summary_hash: 'x', updated: nowMs() });
  r = await post(); ok('in progress (db) 409', r.status === 409, r);
  sets.get(1).updated = nowMs() - 20 * 60000; sets.get(1).status = 'planning';
  planQueue.push({ pages: [page('건국과 천도', goodCells())] });
  r = await post(); ok('stale in-progress row allows restart', r.status === 202, r); await waitDone();

  // ── 2. 정상 흐름: 줄 검증·장 제거·번호 연속·대조 ──
  resetState();
  const p1 = [
    cell('건국', '왕관', '1392년 이성계가 조선을 세웠다', { tag: '배경', emphasis: ['1392년', '없는단어'] }),
    cell('거짓수', '별', '1500년 수도를 옮겼다'),                              // 없는 숫자 → 줄 탈락 → 칸 탈락
    cell('천도', '지도', '1394년 한양으로 수도를 옮겼다'),
    cell('거짓말', '달', '외계인이 건국을 도왔다'),                            // 낱말 '외계인이'는 ⚠ 항목에서만(요약 부분 문자열이긴 함) → ⚠ 유래로 탈락
    cell('궁궐', '궁전', '경복궁을 지었다'),
    cell('학문', '책', '성균관을 세웠다'),
    cell('일곱째', '해', '도성을 쌓았다'),                                      // 6칸 초과분은 버림(앞 4칸 유효 + 도성 = 5번째)
  ];
  const p2 = [cell('a', '1', '도성을 쌓았다'), cell('b', '2', '유교 중심 국가가 되었다')];   // 2칸 → 장 제거
  const p3 = [cell('결과', '탑', '유교 중심 국가가 되었다'), cell('도성', '성벽', '도성을 쌓았다'), cell('수치', '시계', '1392년 조선 건국', { emphasis: ['조선'] })];
  planQueue.push({ pages: [page('건국과 천도', p1, true), page('두 칸', p2), page('결과', p3)] });
  r = await post(); ok('202 immediately', r.status === 202 && r.body.ok === true, r);
  let g = await call('GET', '/api/voice-notes/1/image'); ok('planning visible right after 202', ['planning', 'generating', 'ready'].includes(g.body.status));
  const done = await waitDone();
  ok('ready', done && done.status === 'ready', done);
  ok('2 pages (<3 cells page dropped)', done.pages_total === 2 && done.pages.length === 2 && done.truncated === false, done);
  ok('page titles', done.pages[0].title === '건국과 천도' && done.pages[1].title === '결과', done.pages);
  ok('checks pass', done.pages.every(p => p.status === 'ready' && p.check === 'pass'), done.pages);
  const stored1 = images.get('1:1').cells, stored2 = images.get('1:2').cells;
  ok('page1 cells: bad number/⚠-derived cells removed, extras cut; unverifiable cell titles blanked', stored1.cells.map(c => c.title).join() === '건국,천도,,,' && stored1.cells.length === 5, stored1.cells.map(c => c.title));
  ok('numbering continuous', stored1.cells.map(c => c.no).join() === '1,2,3,4,5' && stored2.cells.map(c => c.no).join() === '6,7,8', [stored1.cells.map(c => c.no), stored2.cells.map(c => c.no)]);
  ok('emphasis only words in text', JSON.stringify(stored1.cells[0].emphasis) === JSON.stringify(['1392년']), stored1.cells[0].emphasis);
  ok('usage tracked', tracked.filter(t => t[1] === 'image').length === 2 && tracked.filter(t => t[1] === 'image_aux').length === 3, tracked.map(t => t[1]));
  ok('openai request shape', openaiCalls[0].body.model === 'gpt-image-2.5-flare' && openaiCalls[0].body.quality === 'medium' && openaiCalls[0].body.output_format === 'jpeg' && openaiCalls[0].body.output_compression === 85 && openaiCalls[0].body.n === 1 && !('response_format' in openaiCalls[0].body), openaiCalls[0].body);
  ok('size by cell count (5 cells → 1536x1024, 3 cells → 1024x1024)', openaiCalls[0].body.size === '1536x1024' && openaiCalls[1].body.size === '1024x1024', openaiCalls.map(c => c.body.size));
  ok('flow arrows only for flow page', openaiCalls[0].body.prompt.includes('화살표(→)') && !openaiCalls[1].body.prompt.includes('화살표(→)') && openaiCalls[1].body.prompt.includes('화살표를 그리지 않는다'));
  ok('n/N shown when 2+ pages', openaiCalls[0].body.prompt.includes('"1/2"') && openaiCalls[1].body.prompt.includes('"2/2"'));
  ok('prompt has numbered cells + same style', openaiCalls[1].body.prompt.includes('칸 번호 "6"') && openaiCalls[0].body.prompt.includes('흰 배경에 둥근 모서리') && openaiCalls[1].body.prompt.includes('흰 배경에 둥근 모서리'));
  ok('plan call params', planCalls[0].model === 'claude-haiku-4-5-20251001' && planCalls[0].temperature === 0.2 && planCalls[0].max_tokens === 2500 && planCalls[0].system.includes('1~3장'));
  ok('vision gets image block', visionCalls[0].messages[0].content[0].type === 'image' && visionCalls[0].messages[0].content[0].source.media_type === 'image/jpeg');
  // 파일
  let f = await call('GET', '/api/voice-notes/1/image/file?page=1');
  ok('file 200 + headers', f.status === 200 && f.headers.get('content-type') === 'image/jpeg' && f.headers.get('content-length') === '1200' && f.headers.get('x-content-type-options') === 'nosniff' && f.headers.get('cache-control') === 'private, no-cache' && f.body.length === 1200, [f.status, [...f.headers.entries()]]);
  f = await call('GET', '/api/voice-notes/1/image/file'); ok('default page=1', f.status === 200);
  for (const bad of ['0', 'abc', '-1', '100', '1.5', '1e1']) { f = await call('GET', `/api/voice-notes/1/image/file?page=${bad}`); ok('page invalid 400 ' + bad, f.status === 400, f.status); }
  f = await call('GET', '/api/voice-notes/1/image/file?page=3'); ok('page missing 404', f.status === 404);
  curUser = 8; f = await call('GET', '/api/voice-notes/1/image/file?page=1'); ok('file other user 404', f.status === 404);
  g = await call('GET', '/api/voice-notes/1/image'); ok('GET other user 404 (note not theirs)', g.status === 404);
  r = await call('PATCH', '/api/voice-notes/1/image/rating', { rating: 1 }); ok('rating other user 404', r.status === 404);
  r = await post(1); ok('POST other user 404', r.status === 404); curUser = 7;
  // 평점
  r = await call('PATCH', '/api/voice-notes/1/image/rating', { rating: 1 }); ok('rating 1', r.status === 200 && sets.get(1).rating === 1, r);
  r = await call('PATCH', '/api/voice-notes/1/image/rating', { rating: -1 }); ok('rating -1', r.status === 200 && sets.get(1).rating === -1);
  for (const bad of [0, 2, '1', null, undefined]) { r = await call('PATCH', '/api/voice-notes/1/image/rating', { rating: bad }); ok('rating invalid 400 ' + bad, r.status === 400, r.status); }
  g = await call('GET', '/api/voice-notes/1/image'); ok('GET shape', g.body.rating === -1 && g.body.stale === false && g.body.cap === 4 && g.body.remaining === 2 && g.body.enabled === true && g.body.error === null, g.body);
  // stale
  notes.get(1).summary = SUMMARY + '\n- 추가'; g = await call('GET', '/api/voice-notes/1/image'); ok('stale after summary change', g.body.stale === true && g.body.status === 'ready');
  notes.get(1).summary = SUMMARY;
  // 재생성 → 기존 세트 교체, 평점 초기화
  planQueue.push({ pages: [page('건국과 천도', goodCells())] });
  r = await post(); ok('regenerate 202', r.status === 202, r); const d2 = await waitDone();
  ok('replaced set', d2.status === 'ready' && d2.pages_total === 1 && d2.rating === null && !images.has('1:2'), d2);
  ok('single page: no n/N', !openaiCalls[openaiCalls.length - 1].body.prompt.includes('/1"'));
  // 노트 없는 요약 → none
  notes.get(1).summary = ''; g = await call('GET', '/api/voice-notes/1/image'); ok('none when summary empty', g.body.status === 'none'); notes.get(1).summary = SUMMARY;

  // ── 3. 장 수 상한 / 남은 호출 수 ──
  resetState();
  const mkPage = (t, i) => page(t, goodCells().map((c, k) => ({ ...c, icon: c.icon + i + k })));
  planQueue.push({ pages: [mkPage('하나', 1), mkPage('둘', 2), mkPage('셋', 3), mkPage('넷', 4)] });
  r = await post(); let d = await waitDone();
  ok('truncated at maxPages=3', d.pages_total === 3 && d.truncated === true && d.status === 'ready', d);
  ok('cell numbers across pages 1..12', [1, 2, 3].every(n => images.get('1:' + n).cells.cells.length === 4) && images.get('1:3').cells.cells[3].no === 12);
  resetState(); usageBase.image = 2;   // cap 4 - 2 = 2 남음
  planQueue.push({ pages: [mkPage('하나', 1), mkPage('둘', 2), mkPage('셋', 3)] });
  r = await post(); d = await waitDone();
  ok('maxPages shrinks to remaining', planCalls[0].system.includes('1~2장') && d.pages_total === 2 && d.truncated === true && openaiCalls.length === 2, { sys: planCalls[0].system.slice(120, 160), d });
  resetState(); process.env.VOICE_IMAGE_MAX_PAGES = '1';
  planQueue.push({ pages: [mkPage('하나', 1), mkPage('둘', 2)] });
  r = await post(); d = await waitDone(); ok('MAX_PAGES env', d.pages_total === 1 && d.truncated === true && planCalls[0].system.includes('1~1장'), d);

  // ── 4. 계획 오류 ──
  resetState(); planQueue.push('이건 JSON이 아님');
  r = await post(); d = await waitDone(); ok('plan JSON error → failed', d.status === 'failed' && d.error === '그림 계획을 만들지 못했습니다.' && openaiCalls.length === 0, d);
  resetState(); planQueue.push(new Error('boom'));
  r = await post(); d = await waitDone(); ok('plan API error → failed', d.status === 'failed' && d.error === '그림 계획을 만들지 못했습니다.', d);
  resetState(); planQueue.push({ pages: [page('빈 장', [cell('가', '별', '1500년 수도를 옮겼다'), cell('나', '달', '엉뚱한낱말들이다'), cell('다', '해', '2000년이다')])] });
  r = await post(); d = await waitDone(); ok('all lines dropped → failed 422-equivalent', d.status === 'failed' && d.error === '요약할 내용이 부족합니다.' && d.pages.length === 0 && openaiCalls.length === 0, d);
  resetState(); planQueue.push({ nope: 1 });
  r = await post(); d = await waitDone(); ok('no pages key → failed', d.status === 'failed' && d.error === '요약할 내용이 부족합니다.', d);
  // ⚠ 항목 제외(요약에 그대로 쓴 ⚠ 문장)
  resetState();
  planQueue.push({ pages: [page('시험', [cell('가', '별', '외계인이 건국을 도왔다는 근거 없는 항목'), cell('나', '달', '경복궁을 지었다'), cell('다', '해', '성균관을 세웠다'), cell('라', '산', '도성을 쌓았다')])] });
  r = await post(); d = await waitDone(); ok('⚠ item excluded', d.status === 'ready' && images.get('1:1').cells.cells.length === 3 && !JSON.stringify(images.get('1:1').cells).includes('외계인'), images.get('1:1') && images.get('1:1').cells.cells.map(c => c.lines[0].text));
  // 칸 번호가 연속인지(제거 후)
  ok('numbers renumbered after removal', images.get('1:1').cells.cells.map(c => c.no).join() === '1,2,3');
  // icon 중복 → 계획 1회 재요청
  resetState();
  const dupCells = goodCells().map((c, i) => ({ ...c, icon: i < 2 ? '별' : c.icon }));
  planQueue.push({ pages: [page('조선', dupCells)] }, { pages: [page('한양', goodCells())] });
  r = await post(); d = await waitDone();
  ok('icon dup → plan re-requested once, second used', planCalls.length === 2 && planCalls[1].messages[0].content.includes('중복된 icon') && d.pages[0].title === '한양', { n: planCalls.length, d });
  resetState();
  planQueue.push({ pages: [page('조선', dupCells)] }, { pages: [page('경복궁', dupCells)] }, { pages: [page('성균관', goodCells())] });
  r = await post(); d = await waitDone(); ok('only one re-request even if still dup', planCalls.length === 2 && d.status === 'ready' && d.pages[0].title === '경복궁', { n: planCalls.length, d });
  resetState();
  planQueue.push({ pages: [page('조선', dupCells)] }, '깨진 JSON');
  r = await post(); d = await waitDone(); ok('re-request failure keeps first plan', planCalls.length === 2 && d.status === 'ready' && d.pages[0].title === '조선', d);

  // ── 5. 글자 대조 ──
  resetState(); planQueue.push({ pages: [page('건국', goodCells())] }); visionMode = 'extra';
  r = await post(); d = await waitDone();
  const EXTRA_LEN = Array.from('엉뚱한여분글자가아주많이들어간문장입니다정말로많이').length;
  ok('fail reason recorded as counts only (extra)', images.get('1:1').error === '누락 0, 여분 ' + EXTRA_LEN && d.pages[0].error === '누락 0, 여분 ' + EXTRA_LEN, { e: images.get('1:1').error });
  ok('extra chars → fail, regenerated once, stored as fail', d.status === 'ready' && d.pages[0].check === 'fail' && images.get('1:1').attempts === 2 && openaiCalls.length === 2 && visionCalls.length === 2 && tracked.filter(t => t[1] === 'image').length === 2, { d, a: images.get('1:1').attempts });
  resetState(); planQueue.push({ pages: [page('건국', goodCells())] }); visionMode = 'missing';
  r = await post(); d = await waitDone(); ok('missing text → fail', d.pages[0].check === 'fail' && openaiCalls.length === 2, d);
  ok('fail reason (missing 1)', images.get('1:1').error === '누락 1, 여분 0' && /^누락 \d+, 여분 \d+$/.test(d.pages[0].error) && !/건국|경복궁|성균관/.test(d.pages[0].error), d.pages[0]);
  resetState(); planQueue.push({ pages: [page('건국', goodCells())] }); visionMode = 'bad-json';
  r = await post(); d = await waitDone(); ok('vision parse failure → unavailable, no regen', d.pages[0].check === 'unavailable' && openaiCalls.length === 1 && d.status === 'ready', d);
  resetState(); planQueue.push({ pages: [page('건국', goodCells())] }); visionMode = 'bad-shape';
  r = await post(); d = await waitDone(); ok('vision bad shape → unavailable', d.pages[0].check === 'unavailable');
  resetState(); planQueue.push({ pages: [page('건국', goodCells())] }); visionMode = 'api-error';
  r = await post(); d = await waitDone(); ok('vision API error → unavailable', d.pages[0].check === 'unavailable' && d.status === 'ready');
  // 대조 실패 후 재생성이 통과하면 두 번째 이미지 사용
  resetState(); planQueue.push({ pages: [page('건국', goodCells())] }); visionMode = 'missing';
  let n = 0; const origModeSetter = () => {};
  openaiHandler = async () => { n++; if (n === 2) visionMode = 'pass'; return okImage(n === 1 ? 1000 : 1500); };
  r = await post(); d = await waitDone();
  ok('regeneration passes → second image kept, no fail reason', d.pages[0].check === 'pass' && d.pages[0].error === null && images.get('1:1').image.length === 1500 && images.get('1:1').attempts === 2, { d, len: images.get('1:1').image.length });
  // 한도 내에서만 재시도: 남은 호출 1 → 재생성 없음
  resetState(); usageBase.image = 3; planQueue.push({ pages: [page('건국', goodCells())] }); visionMode = 'extra';
  r = await post(); d = await waitDone(); ok('no retry when cap exhausted', openaiCalls.length === 1 && d.pages[0].check === 'fail' && images.get('1:1').attempts === 1 && d.status === 'ready', { n: openaiCalls.length, d });
  // 2장: 첫 장 재시도로 한도 소진 → 둘째 장은 한도로 실패
  resetState(); usageBase.image = 1; process.env.VOICE_IMAGE_DAILY_CAP = '4';
  planQueue.push({ pages: [mkPage('하나', 1), mkPage('둘', 2), mkPage('셋', 3)] }); visionMode = 'extra';
  r = await post(); d = await waitDone();
  ok('retries stay within cap; later pages fail on cap', openaiCalls.length === 3 && d.pages_total === 3 && d.pages[0].status === 'ready' && d.pages[1].status === 'ready' && d.pages[2].status === 'failed' && d.status === 'ready' && /한도/.test(images.get('1:3').error), { n: openaiCalls.length, p: d.pages, e: images.get('1:3').error });

  // ── 6. 이미지 API 오류·용량·형식 ──
  resetState(); planQueue.push({ pages: [mkPage('하나', 1), mkPage('둘', 2)] });
  let k = 0; openaiHandler = async () => { k++; return k === 2 ? errImage(500, { code: 'server_error' }) : okImage(); };
  r = await post(); d = await waitDone();
  ok('one page fails, others continue; set ready', d.status === 'ready' && d.pages[0].status === 'ready' && d.pages[1].status === 'failed' && /500/.test(images.get('1:2').error), { d, e: images.get('1:2').error });
  ok('failed page file 404', (await call('GET', '/api/voice-notes/1/image/file?page=2')).status === 404);
  resetState(); planQueue.push({ pages: [mkPage('하나', 1)] }); openaiHandler = async () => errImage(500, { code: 'x' });
  r = await post(); d = await waitDone(); ok('all pages fail → set failed', d.status === 'failed' && d.error === '모든 장의 이미지 생성에 실패했습니다.' && tracked.filter(t => t[1] === 'image').length === 0, d);
  resetState(); planQueue.push({ pages: [mkPage('하나', 1)] }); openaiHandler = async () => okImage(4 * 1024 * 1024 + 1);
  r = await post(); d = await waitDone(); ok('default limit 4MB: over → failed, not stored', d.status === 'failed' && d.pages[0].status === 'failed' && images.get('1:1').image === null && /4MB/.test(images.get('1:1').error), d);
  resetState(); planQueue.push({ pages: [mkPage('하나', 1)] }); openaiHandler = async () => okImage(4 * 1024 * 1024);
  r = await post(); d = await waitDone(); ok('default limit 4MB: exactly allowed', d.status === 'ready' && images.get('1:1').image.length === 4 * 1024 * 1024);
  resetState(); process.env.VOICE_IMAGE_MAX_BYTES = '5000'; planQueue.push({ pages: [mkPage('하나', 1)] }); openaiHandler = async () => okImage(5000);
  r = await post(); d = await waitDone(); ok('env limit: exactly 5000 allowed', d.status === 'ready');
  resetState(); process.env.VOICE_IMAGE_MAX_BYTES = '5000'; planQueue.push({ pages: [mkPage('하나', 1)] }); openaiHandler = async () => okImage(5001);
  r = await post(); d = await waitDone(); ok('env limit: 5001 failed', d.status === 'failed' && images.get('1:1').image === null, d);
  resetState(); process.env.VOICE_IMAGE_MAX_BYTES = 'abc'; planQueue.push({ pages: [mkPage('하나', 1)] }); openaiHandler = async () => okImage(4 * 1024 * 1024);
  r = await post(); d = await waitDone(); ok('invalid env limit → default 4MB', d.status === 'ready'); delete process.env.VOICE_IMAGE_MAX_BYTES;
  resetState(); planQueue.push({ pages: [mkPage('하나', 1)] });
  openaiHandler = async (body) => body.output_format === 'jpeg' ? errImage(400, { code: 'unsupported', param: 'output_compression', message: 'not supported' }) : okImage();
  r = await post(); d = await waitDone();
  ok('format rejected → png fallback once', d.status === 'ready' && openaiCalls.length === 2 && openaiCalls[1].body.output_format === 'png' && !('output_compression' in openaiCalls[1].body) && images.get('1:1').mime === 'image/png' && tracked.filter(t => t[1] === 'image').length === 1, { calls: openaiCalls.map(c => c.body.output_format), mime: images.get('1:1').mime });
  resetState(); planQueue.push({ pages: [mkPage('하나', 1)] });
  openaiHandler = async () => errImage(400, { code: 'invalid_value', param: 'quality', message: 'bad quality' });
  r = await post(); d = await waitDone();
  ok('other 400 → no retry, error recorded', d.status === 'failed' && openaiCalls.length === 1 && /400 invalid_value quality/.test(images.get('1:1').error), { n: openaiCalls.length, e: images.get('1:1').error });
  resetState(); process.env.VOICE_IMAGE_FORMAT = 'png'; planQueue.push({ pages: [mkPage('하나', 1)] });
  r = await post(); d = await waitDone(); ok('png format has no compression param', openaiCalls[0].body.output_format === 'png' && !('output_compression' in openaiCalls[0].body) && images.get('1:1').mime === 'image/png');
  resetState(); process.env.VOICE_IMAGE_FORMAT = 'webp'; process.env.VOICE_IMAGE_COMPRESSION = '70'; process.env.VOICE_IMAGE_MODEL = 'm-x'; process.env.VOICE_IMAGE_QUALITY = 'high'; planQueue.push({ pages: [mkPage('하나', 1)] });
  r = await post(); d = await waitDone(); ok('env overrides', openaiCalls[0].body.output_format === 'webp' && openaiCalls[0].body.output_compression === 70 && openaiCalls[0].body.model === 'm-x' && openaiCalls[0].body.quality === 'high');
  resetState(); process.env.VOICE_IMAGE_FORMAT = 'bmp'; process.env.VOICE_IMAGE_COMPRESSION = '999'; planQueue.push({ pages: [mkPage('하나', 1)] });
  r = await post(); d = await waitDone(); ok('invalid env falls back to defaults', openaiCalls[0].body.output_format === 'jpeg' && openaiCalls[0].body.output_compression === 85);

  // ── 7. 동시 실행 / 409 ──
  resetState(); planQueue.push({ pages: [mkPage('하나', 1)] }); openaiHandler = async () => { await sleep(300); return okImage(); };
  r = await post(); const r2 = await post(); ok('in-flight 409 (memory)', r.status === 202 && r2.status === 409, [r.status, r2.status]);
  d = await waitDone(); ok('finished after slow image', d.status === 'ready');
  r = await post(); ok('can start again after finish', r.status === 202); planQueue.push({ pages: [mkPage('하나', 1)] }); await sleep(50); await waitDone();

  // ── 8. pending 15분 초과 / 20세트 보관 ──
  resetState(); sets.set(1, { note_id: 1, user_id: 7, status: 'generating', summary_hash: sha(SUMMARY), pages_total: 2, truncated: false, error: null, rating: null, updated: nowMs() - 16 * 60000 });
  g = await call('GET', '/api/voice-notes/1/image'); ok('over 15min → failed', g.body.status === 'failed' && g.body.error && sets.get(1).status === 'failed', g.body);
  resetState(); sets.set(1, { note_id: 1, user_id: 7, status: 'planning', summary_hash: sha(SUMMARY), pages_total: null, truncated: null, error: null, rating: null, updated: nowMs() - 14 * 60000 });
  g = await call('GET', '/api/voice-notes/1/image'); ok('under 15min stays planning', g.body.status === 'planning');
  resetState();
  for (let i = 1; i <= 20; i++) { notes.set(100 + i, { id: 100 + i, user_id: 7, summary: 's' }); sets.set(100 + i, { note_id: 100 + i, user_id: 7, status: 'ready', summary_hash: 'h', updated: nowMs() - (1000 - i) * 1000 }); images.set((100 + i) + ':1', { note_id: 100 + i, page_no: 1 }); }
  sets.set(500, { note_id: 500, user_id: 8, status: 'ready', summary_hash: 'h', updated: 1 });   // 다른 사용자 세트는 건드리지 않음
  planQueue.push({ pages: [mkPage('하나', 1)] });
  r = await post(); await waitDone();
  const mine = [...sets.values()].filter(s => s.user_id === 7);
  ok('20 sets kept, oldest removed', mine.length === 20 && !sets.has(101) && sets.has(1) && sets.has(120) && !images.has('101:1') && sets.has(500), { n: mine.length, has101: sets.has(101) });

  // ── 8-2. 프롬프트 ↔ 대조 목록 일관성 (작업189-2) ──
  const src = fs.readFileSync(root + 'routes/voice_study.js', 'utf8');
  const fnSrc = src.match(/function expectedImageTexts[\s\S]*?\n}\n/)[0];
  const expectedImageTexts = new Function(fnSrc + '\nreturn expectedImageTexts;')();
  const quotedIn = prompt => { const q = []; for (const line of prompt.split('\n')) for (const m of line.matchAll(/"([^"]+)"/g)) q.push({ text: m[1], emphasis: /강조 단어/.test(line) }); return q; };
  // 프롬프트에 큰따옴표로 들어간 모든 문구는 대조 목록에 있어야 하고(강조 단어는 어느 문구의 일부여야 함), 대조 목록의 모든 문구는 프롬프트에 있어야 한다
  const consistency = (prompt, expected) => {
    const set = new Set(expected), quotes = quotedIn(prompt);
    const stray = quotes.filter(q => q.emphasis ? !expected.some(e => e.includes(q.text)) : !set.has(q.text)).map(q => q.text);
    const plain = new Set(quotes.filter(q => !q.emphasis).map(q => q.text));
    const absent = expected.filter(e => !plain.has(e));
    return { stray, absent };
  };
  resetState();
  const tagged = [
    { title: '건국', icon: '왕관', lines: [{ tag: '배경', text: '1392년 이성계가 조선을 세웠다' }, { tag: '', text: '1394년 한양으로 수도를 옮겼다' }], emphasis: ['1392년'] },
    { title: '', icon: '지도', lines: [{ tag: '결과', text: '유교 중심 국가가 되었다' }], emphasis: [] },
    { title: '궁궐', icon: '궁전', lines: [{ tag: '', text: '경복궁을 지었다' }], emphasis: ['경복궁'] },
    { title: '도성', icon: '성벽', lines: [{ tag: '축성', text: '도성을 쌓았다' }, { tag: '', text: '성균관을 세웠다' }, { tag: '', text: '1392년 조선 건국' }], emphasis: [] },
  ];
  planQueue.push({ pages: [page('건국과 천도', tagged, true), page('결과', goodCells().map((c, i) => ({ ...c, icon: c.icon + 'x' + i })))] });
  r = await post(); d = await waitDone();
  ok('consistency run produced 2 pages', d.status === 'ready' && d.pages_total === 2 && openaiCalls.length === 2, d);
  for (let i = 0; i < d.pages_total; i++) {
    const pg = images.get('1:' + (i + 1)).cells;
    const expected = expectedImageTexts(pg, i + 1, d.pages_total);
    const c = consistency(openaiCalls[i].body.prompt, expected);
    ok('prompt quotes == expected list (page ' + (i + 1) + ')', c.stray.length === 0 && c.absent.length === 0, c);
    ok('expected includes titles, numbers, tags, lines (page ' + (i + 1) + ')', pg.cells.every(cc => (!cc.title || expected.includes(cc.title)) && expected.includes(String(cc.no)) && cc.lines.every(l => expected.includes(l.text) && (!l.tag || expected.includes(l.tag)))) && expected.includes(pg.title) && expected.includes((i + 1) + '/2'));
  }
  ok('empty cell title omitted from prompt and expected', !/칸 번호 "2" - 제목/.test(openaiCalls[0].body.prompt) && /칸 번호 "2" - 아이콘/.test(openaiCalls[0].body.prompt) && !expectedImageTexts(images.get('1:1').cells, 1, 2).includes(''));
  // 목록이 프롬프트와 어긋나면 검사가 실패해야 한다(칸 제목을 뺀 가짜 목록, 태그를 뺀 가짜 목록)
  const pg1 = images.get('1:1').cells;
  const drift1 = expectedImageTexts(pg1, 1, 2).filter(e => !pg1.cells.some(c => c.title === e));
  const drift2 = expectedImageTexts(pg1, 1, 2).filter(e => e !== '배경');
  ok('drift detection: missing cell titles caught', consistency(openaiCalls[0].body.prompt, drift1).stray.length > 0);
  ok('drift detection: missing tag caught', consistency(openaiCalls[0].body.prompt, drift2).stray.includes('배경'));
  ok('drift detection: extra expected entry caught', consistency(openaiCalls[0].body.prompt, [...expectedImageTexts(pg1, 1, 2), '프롬프트에없음']).absent.includes('프롬프트에없음'));
  // 대조에 칸 제목이 쓰이는지: 이미지에서 칸 제목만 빠지면 fail
  resetState(); planQueue.push({ pages: [page('건국', goodCells())] });
  let calls = 0; const origMode = visionMode;
  visionMode = 'pass';
  openaiHandler = async (body) => { calls++; globalThis.__lastPrompt = body.prompt.replace(/ - 제목: "[^"]+"/g, ''); return okImage(); };   // 비전에는 칸 제목이 안 보이는 이미지
  r = await post(); d = await waitDone();
  ok('cell title missing from image → fail with counts', d.pages[0].check === 'fail' && /^누락 [1-9]\d*, 여분 \d+$/.test(d.pages[0].error), d.pages[0]);

  // ── 8-3. 제목 검증 · 영문 낱말 검증 (작업189-2) ──
  resetState();
  const wc = (title, icon, text, tag = '') => ({ title, icon, lines: [{ tag, text }], emphasis: [] });
  planQueue.push({ pages: [
    page('수도 건국', [wc('건국', '왕관', '1392년 이성계가 조선을 세웠다'), wc('1500년', '지도', '1394년 한양으로 수도를 옮겼다'), wc('우주선', '별', '경복궁을 지었다'), wc('도성', '성벽', '도성을 쌓았다')]),
    page('우주 이야기', [wc('조선', 'a1', '경복궁을 지었다'), wc('한양', 'a2', '성균관을 세웠다'), wc('결과', 'a3', '유교 중심 국가가 되었다')]),
  ] });
  r = await post(); d = await waitDone();
  const t1 = images.get('1:1').cells, t2 = images.get('1:2').cells;
  ok('page title with unknown word → 핵심 정리 (2nd page)', d.pages.length === 2 && d.pages[0].title === '수도 건국' && d.pages[1].title === '핵심 정리', d.pages.map(p => p.title));
  ok('cell title with unknown number/word blanked', t1.cells.map(c => c.title).join('|') === '건국|||도성', t1.cells.map(c => c.title));
  ok('fallback title appears in prompt and expected', openaiCalls[1].body.prompt.includes('"핵심 정리"') && expectedImageTexts(t2, 2, 2).includes('핵심 정리'));
  ok('blank title cell line omitted in prompt', !/칸 번호 "2" - 제목/.test(openaiCalls[0].body.prompt));
  // 영문 낱말(대소문자 무시)
  resetState();
  notes.set(1, { id: 1, user_id: 7, summary: '유형: 개념 설명\n\n■ 주제\n- DNA replication은 반보존적이다\n- 효소 Helicase가 가닥을 푼다\n- 효소 Primase가 시작점을 만든다\n- Okazaki 조각이 생긴다' });
  const eng = [
    wc('DNA', '나선', 'dna REPLICATION은 반보존적이다'),                 // 대소문자가 달라도 통과
    wc('RNA', '실', 'RNA는 필요하다'),                                    // 요약에 없는 영문 낱말 → 줄 탈락 → 칸 탈락
    wc('효소', '가위', '효소 Helicase가 가닥을 푼다', 'helicase'),
    wc('시작', '깃발', '효소 Primase가 시작점을 만든다'),
    wc('조각', '퍼즐', 'Okazaki 조각이 생긴다'),
    wc('RNA', '불', '효소 Ligase가 연결한다'),                            // 영문 'Ligase' 없음 → 칸 탈락
  ];
  planQueue.push({ pages: [page('DNA', eng)] });
  r = await post(); d = await waitDone();
  const e1 = images.get('1:1').cells;
  ok('english words validated case-insensitively', d.status === 'ready' && e1.cells.length === 4 && e1.cells[0].lines[0].text === 'dna REPLICATION은 반보존적이다' && !JSON.stringify(e1).includes('Ligase') && !JSON.stringify(e1).includes('RNA'), e1.cells.map(c => c.lines.map(l => l.text)));
  ok('english page/cell titles pass when in summary', e1.title === 'DNA' && e1.cells[0].title === 'DNA');
  notes.set(1, { id: 1, user_id: 7, summary: SUMMARY });

  // ── 9. 401 회귀 ──
  resetState(); authed = false;
  for (const [m, u, b] of [['POST', '/api/voice-notes/1/image'], ['GET', '/api/voice-notes/1/image'], ['GET', '/api/voice-notes/1/image/file?page=1'], ['PATCH', '/api/voice-notes/1/image/rating', { rating: 1 }], ['POST', '/api/voice-notes/summarize', { transcript: 'x' }], ['GET', '/api/voice-notes/1/links']]) {
    r = await call(m, u, b); ok('401 ' + m + ' ' + u, r.status === 401, r.status);
  }
  authed = true;

  console.log('pass', pass, 'fail', fail);
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
