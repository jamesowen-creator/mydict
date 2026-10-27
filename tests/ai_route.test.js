// 작업338: POST /api/ai 로그인 필수 + 권한(can_search) + 하루 사용량 제한(AI_DAILY_CAP, 기본 200) + 입력 검증, 단어장·관리자 경로의 입력 검증(500 → 400).
// 모의 DB(users·api_usage·wordbook)와 모의 Anthropic 만 쓴다. 운영 서버·운영 DB·실제 AI 와 무관.
// 실행: node --test tests/ai_route.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_EMAILS = 'u9@example.com';
const { startApp, createAnthropicMock } = require('./helpers/app');

function createDb() {
  const db = { users: new Map(), usage: [], queries: [], failUsageCheck: false, wordbookInserts: [], userUpdates: [] };
  db.users.set(7, { is_blocked: false, can_search: true, can_wordbook: true, role: 'user' });
  db.users.set(8, { is_blocked: false, can_search: false, can_wordbook: true, role: 'user' });
  db.users.set(5, { is_blocked: true, can_search: true, can_wordbook: true, role: 'user' });
  db.users.set(9, { is_blocked: false, can_search: true, can_wordbook: true, role: 'admin' });
  db.pool = {
    query: async (sql, params = []) => {
      db.queries.push(sql);
      let m;
      if ((m = /^SELECT is_blocked, (\w+) FROM users/.exec(sql))) { const u = db.users.get(params[0]); return { rows: u ? [{ is_blocked: u.is_blocked, [m[1]]: u[m[1]] }] : [] }; }
      if (/^SELECT role FROM users/.test(sql)) { const u = db.users.get(params[0]); return { rows: u ? [{ role: u.role }] : [] }; }
      if (/FROM api_usage/.test(sql)) { if (db.failUsageCheck) throw new Error('usage check boom'); return { rows: [{ n: db.usage.filter(u => u.userId === params[0] && u.eventType === 'ai').length }] }; }
      if (/^INSERT INTO wordbook/.test(sql)) { db.wordbookInserts.push(params); return { rows: [{ id: 1, word: params[1] }] }; }
      if (/^UPDATE users SET/.test(sql)) { db.userUpdates.push(params); return { rows: [{ id: params[0] }] }; }
      if (/^SELECT repetitions/.test(sql)) return { rows: [{ repetitions: 0, ease_factor: 2.5, interval_days: 1 }] };
      if (/^UPDATE wordbook/.test(sql)) return { rows: [{ next_review: new Date(), interval_days: 1, repetitions: 1 }], rowCount: 1 };
      if (/^INSERT INTO review_log/.test(sql)) return { rows: [] };
      throw new Error('모의 DB 가 모르는 SQL: ' + sql.slice(0, 60));
    },
  };
  db.trackUsage = (userId, eventType, model, i, o, chars) => { db.usage.push({ userId, eventType, model }); };
  return db;
}

async function setup(routes) {
  const db = createDb(), anthropic = createAnthropicMock();
  anthropic.handler = () => 'AI 응답';
  const t = await startApp(routes, { db, anthropic });
  return { db, anthropic, t, post: (url, body, user = 7) => t.call('POST', url, body, { user }), patch: (url, body, user = 9) => t.call('PATCH', url, body, { user }) };
}
const AI = '/api/ai';

test('338-1. /api/ai 로그인 필수: 토큰 없음 401, 잘못된 토큰 401, 입력 검증보다 먼저, AI 를 부르지 않는다', async t => {
  const a = await setup(['routes/dictionary.js']); t.after(() => a.t.close());
  const none = await a.post(AI, { prompt: 'hello' }, null); assert.equal(none.status, 401); assert.deepEqual(none.body, { error: '로그인이 필요합니다.' });
  const bad = await fetch(a.t.base + AI, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' }, body: JSON.stringify({ prompt: 'hello' }) });
  assert.equal(bad.status, 401);
  assert.equal((await a.post(AI, { prompt: 5 }, null)).status, 401, '토큰이 없으면 잘못된 입력도 401');
  assert.equal(a.anthropic.calls.length, 0);
});

test('338-2. /api/ai 정상 요청은 그대로: 200 { result }, 모델·프롬프트 전달, 사용량 기록(이벤트 ai, 사용자 id)', async t => {
  const a = await setup(['routes/dictionary.js']); t.after(() => a.t.close());
  const r = await a.post(AI, { prompt: '  hello  ' }); assert.equal(r.status, 200); assert.deepEqual(r.body, { result: 'AI 응답' });
  assert.equal(a.anthropic.calls.length, 1); assert.equal(a.anthropic.calls[0].model, 'claude-haiku-4-5-20251001'); assert.equal(a.anthropic.calls[0].messages[0].content, 'hello');
  assert.deepEqual(a.db.usage, [{ userId: 7, eventType: 'ai', model: 'claude-haiku-4-5' }]);
  assert.equal((await a.post(AI, { prompt: 'x'.repeat(20000) })).status, 200, '20000자까지 허용');
});

test('338-3. /api/ai 입력 검증: 숫자·객체·배열·null·빈 값·공백·본문 없음·너무 긴 값은 400(예외 없이), AI 를 부르지 않고 서버는 계속 산다', async t => {
  const a = await setup(['routes/dictionary.js']); t.after(() => a.t.close());
  for (const bad of [5, 0, null, {}, [], ['a'], true, '', '   ', '\n\t']) {
    const r = await a.post(AI, { prompt: bad }); assert.equal(r.status, 400, JSON.stringify(bad)); assert.deepEqual(r.body, { error: '프롬프트를 입력해주세요.' });
  }
  assert.equal((await a.post(AI, {})).status, 400); assert.equal((await a.post(AI, undefined)).status, 400); assert.equal((await a.post(AI, [1, 2])).status, 400); assert.equal((await a.post(AI, 'text')).status, 400);
  const long = await a.post(AI, { prompt: 'x'.repeat(20001) }); assert.equal(long.status, 400); assert.deepEqual(long.body, { error: '프롬프트가 너무 깁니다.' });
  assert.equal(a.anthropic.calls.length, 0);
  assert.equal((await a.post(AI, { prompt: 'still alive' })).status, 200);
});

test('338-4. /api/ai 권한: can_search false 403, 차단 403, 관리자도 can_search 를 따른다(기존 동작)', async t => {
  const a = await setup(['routes/dictionary.js']); t.after(() => a.t.close());
  const no = await a.post(AI, { prompt: 'x' }, 8); assert.equal(no.status, 403); assert.deepEqual(no.body, { error: '검색 권한이 없습니다.' });
  assert.equal((await a.post(AI, { prompt: 'x' }, 5)).status, 403); assert.equal((await a.post(AI, { prompt: 'x' }, 9)).status, 200);
  assert.equal(a.anthropic.calls.length, 1);
});

test('338-5. /api/ai 하루 한도: 기본 200 — 200번째까지 통과하고 201번째 429(한국어), 사용자별, 관리자에게도 적용. 환경변수 AI_DAILY_CAP 으로 덮어쓰고 잘못된 값은 기본값', async t => {
  const a = await setup(['routes/dictionary.js']); t.after(() => { a.t.close(); delete process.env.AI_DAILY_CAP; });
  delete process.env.AI_DAILY_CAP;
  for (let i = 0; i < 199; i++) a.db.usage.push({ userId: 7, eventType: 'ai' });
  assert.equal((await a.post(AI, { prompt: 'x' })).status, 200, '200번째');
  const over = await a.post(AI, { prompt: 'x' }); assert.equal(over.status, 429); assert.match(over.body.error, /하루 200번/); assert.equal(a.anthropic.calls.length, 1, '초과하면 AI 를 부르지 않는다');
  assert.equal((await a.post(AI, { prompt: 'x' }, 9)).status, 200, '사용량은 사용자별');
  for (let i = 0; i < 200; i++) a.db.usage.push({ userId: 9, eventType: 'ai' });
  assert.equal((await a.post(AI, { prompt: 'x' }, 9)).status, 429, '관리자에게도 적용');
  a.db.usage.push({ userId: 7, eventType: 'search' });   // 다른 이벤트는 세지 않는다
  process.env.AI_DAILY_CAP = '300'; assert.equal((await a.post(AI, { prompt: 'x' })).status, 200, '300 으로 덮어씀');
  process.env.AI_DAILY_CAP = '2'; assert.equal((await a.post(AI, { prompt: 'x' })).status, 429, '2 로 덮어씀');
  process.env.AI_DAILY_CAP = 'abc'; assert.equal((await a.post(AI, { prompt: 'x' })).status, 429, '잘못된 값은 기본값 200 (사용량 201)');
  process.env.AI_DAILY_CAP = '0'; assert.equal((await a.post(AI, { prompt: 'x' })).status, 429, '0 은 범위 밖 → 기본값');
});

test('338-6. /api/ai 한도 확인 중 DB 오류면 503(AI 를 부르지 않는다). AI 오류는 일반 문구 500 이고 오류 상세가 응답에 없다', async t => {
  const a = await setup(['routes/dictionary.js']); t.after(() => a.t.close());
  const origErr = console.error; console.error = () => {};
  try {
    a.db.failUsageCheck = true; const r = await a.post(AI, { prompt: 'x' }); assert.equal(r.status, 503); assert.ok(!JSON.stringify(r.body).includes('boom')); assert.equal(a.anthropic.calls.length, 0);
    a.db.failUsageCheck = false; a.anthropic.handler = () => { throw new Error('upstream secret detail'); };
    const e = await a.post(AI, { prompt: 'x' }); assert.equal(e.status, 500); assert.deepEqual(e.body, { error: '서버 오류가 발생했습니다.' });
  } finally { console.error = origErr; }
});

test('338-7. 단어장 입력 검증: 숫자·객체·배열 등 예상 밖 타입은 500 이 아니라 400, 정상 요청은 그대로', async t => {
  const a = await setup(['routes/wordbook.js']); t.after(() => a.t.close());
  const W = '/api/wordbook';
  for (const body of [{ word: 5 }, { word: {} }, { word: ['a'] }, { word: '' }, { word: 'x'.repeat(501) }, { word: 'ok', lang: {} }, { word: 'ok', lang: 5 }, { word: 'ok', source: [] }, { word: 'ok', data: 'str' }, { word: 'ok', data: 5 }, undefined, [1]]) {
    const r = await a.post(W, body); assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(a.db.wordbookInserts.length, 0, '잘못된 입력은 DB 에 닿지 않는다');
  const ok = await a.post(W, { word: 'apple', lang: 'en', data: { word: 'apple' }, source: 'manual' }); assert.equal(ok.status, 200); assert.equal(a.db.wordbookInserts.length, 1);
  assert.equal((await a.post(W, { word: 'plain' })).status, 200, 'lang·data·source 생략 가능');
  for (const body of [{ example_sentence: 5 }, { example_sentence: {} }, { example_sentence: '' }, { example_sentence: 'x'.repeat(2001) }]) assert.equal((await a.patch(W + '/3/example', body, 7)).status, 400, JSON.stringify(body));
  for (const body of [{ word_id: {}, score: 3 }, { word_id: [1], score: 3 }, { word_id: 'abc', score: 3 }, { word_id: 0, score: 3 }, { word_id: 1.5, score: 3 }, { word_id: 1, score: '3' }, { word_id: 1, score: 2 }, {}]) assert.equal((await a.post('/api/review-result', body)).status, 400, JSON.stringify(body));
  assert.equal((await a.post('/api/review-result', { word_id: 4, score: 3 })).status, 200); assert.equal((await a.post('/api/review-result', { word_id: '4', score: 1 })).status, 200);
  for (const body of [{ word_id: {} }, { word_id: [] }, { word_id: 'x' }, {}]) assert.equal((await a.post('/api/quiz-correct', body)).status, 400, JSON.stringify(body));
});

test('338-8. 관리자 사용자 수정 입력 검증: 본문이 배열·문자열이거나 값 타입이 틀리면 400, 정상 값은 통과', async t => {
  const a = await setup(['routes/admin.js']); t.after(() => a.t.close());
  const P = '/api/admin/users/7';
  for (const body of [[1], 'text', undefined, { role: 'owner' }, { role: {} }, { role: true }, { can_tts: 'yes' }, { can_tts: 1 }, { is_blocked: null }, { perm_voice_study: {} }]) assert.equal((await a.patch(P, body)).status, 400, JSON.stringify(body));
  assert.equal(a.db.userUpdates.length, 0);
  assert.equal((await a.patch(P, { role: 'user', can_tts: false, perm_concept_map: true })).status, 200); assert.equal(a.db.userUpdates.length, 1);
});

test('338-9. 정적 확인: 클라이언트는 /api/ai 호출 세 곳 모두 토큰(authHeaders)을 보낸다', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'english_dictionary.html'), 'utf8');
  const calls = html.split("fetch('/api/ai'").slice(1);
  assert.equal(calls.length, 3); for (const c of calls) assert.ok(/authHeaders\(\)/.test(c.slice(0, 250)), c.slice(0, 120));
});
