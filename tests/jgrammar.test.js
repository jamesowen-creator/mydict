// 작업JG-1: 일본어 문법 해설 — 입력 검증 · 캐시 조회/저장 · AI 응답(JSON) 검증 · 재시도 · 권한. AI(@anthropic-ai/sdk)는 모의이며 실제 호출은 하지 않는다(응답 품질 판단은 이번 범위 밖).
// 가짜 DB 는 이 기능이 쓰는 SQL 네 가지(users 차단 조회 / jgrammar_cache 조회·저장 / api_usage 오늘 건수)만 흉내 낸다.
// 실행: node --test tests/jgrammar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.JGRAMMAR_DAILY_CAP;
process.env.ADMIN_EMAILS = 'u5@example.com';   // 작업JG-2: 이메일로 관리자가 되는 계정(테스트 토큰의 이메일은 u<id>@example.com)
const { startApp, createAnthropicMock } = require('./helpers/app');
const J = require('../lib/jgrammar');   // 순수 함수만 쓴다(모듈 로드 시 실제 DB 연결은 만들어지지 않음)

const GOOD = {
  ok: true,
  translation: '私は毎日学校に行きます。 → 나는 매일 학교에 갑니다.',
  grammar: [
    { name: '助詞「に」(방향·도착점)', meaning: '이동의 도착점을 나타냅니다.', form: '学校に行きます', contrast: '「へ」는 방향에 초점이 있고 「に」는 도착점에 초점이 있습니다.', jlpt: 'N5' },
    { name: '〜ます형', meaning: '정중한 말투의 현재·미래 표현입니다.', form: '行きます', contrast: '보통체 「行く」보다 정중합니다.', jlpt: null },
  ],
};

// users: 기본으로 1·2번은 권한 있음, 3번은 권한 없음(false), 4번은 DB 관리자(권한 열 false), 9번은 권한 있지만 차단. 그 밖의 id 는 행 없음
function createJgDb({ blocked = [], failCacheRead = false, failUsers = false } = {}) {
  const db = { cache: new Map(), usage: [], queries: [], failUsers,
    users: new Map([[1, { role: 'user', is_blocked: false, perm_jgrammar: true }], [2, { role: 'user', is_blocked: false, perm_jgrammar: true }],
      [3, { role: 'user', is_blocked: false, perm_jgrammar: false }], [4, { role: 'admin', is_blocked: false, perm_jgrammar: false }],
      [9, { role: 'user', is_blocked: true, perm_jgrammar: true }]]) };
  for (const id of blocked) db.users.set(id, { role: 'user', is_blocked: true, perm_jgrammar: true });
  db.pool = {
    query: async (sql, params = []) => {
      db.queries.push(sql.replace(/\s+/g, ' ').trim());
      if (/FROM users/.test(sql)) {
        if (db.failUsers) throw new Error('users down');
        return db.users.has(params[0]) ? { rows: [db.users.get(params[0])] } : { rows: [] };
      }
      if (/FROM jgrammar_cache/.test(sql)) {
        if (failCacheRead) throw new Error('cache read down');
        return db.cache.has(params[0]) ? { rows: [{ result: db.cache.get(params[0]).result }] } : { rows: [] };
      }
      if (/INSERT INTO jgrammar_cache/.test(sql)) {
        if (!db.cache.has(params[0])) db.cache.set(params[0], { sentence: params[1], result: JSON.parse(params[2]), model: params[3] });
        return { rows: [] };
      }
      if (/FROM api_usage/.test(sql)) return { rows: [{ n: db.usage.filter(u => u.user_id === params[0] && params[1].includes(u.event_type)).length }] };
      throw new Error('지원하지 않는 SQL: ' + sql);
    },
  };
  db.trackUsage = (user_id, event_type, model, input_tokens, output_tokens) => db.usage.push({ user_id, event_type, model, input_tokens, output_tokens });
  return db;
}

async function setup(opts) {
  const db = createJgDb(opts);
  const anthropic = createAnthropicMock();
  anthropic.handler = () => JSON.stringify(GOOD);
  const t = await startApp(['routes/jgrammar.js'], { db, anthropic });
  const post = (sentence, user = 1) => t.call('POST', '/api/jgrammar/explain', { sentence }, { user });
  return { db, anthropic, t, post };
}

// ───── 입력 검증(순수 함수) ─────
test('입력 검증: 앞뒤 공백은 제거하고, 비어 있으면 거부', () => {
  assert.deepEqual(J.validateSentence('  学校に行く \n'), { sentence: '学校に行く' });
  for (const v of ['', '   ', '\n\t', null, undefined, 123, {}]) assert.equal(J.validateSentence(v).error, J.MSG.empty);
});

test('입력 검증: 200자는 통과, 201자는 거부(글자 수는 코드 포인트 기준)', () => {
  assert.ok(J.validateSentence('あ'.repeat(200)).sentence);
  assert.equal(J.validateSentence('あ'.repeat(201)).error, J.MSG.tooLong);
  assert.ok(J.validateSentence('𠮷'.repeat(200)).sentence, '서로게이트 쌍 한자도 1글자');
  assert.equal(J.validateSentence(' ' + 'あ'.repeat(200) + ' ').sentence.length, 200, '공백은 세지 않음');
});

test('입력 검증: 히라가나·가타카나·한자가 하나도 없으면 거부, 하나라도 있으면 통과', () => {
  for (const v of ['Hello world', '안녕하세요', '12345 !?', '。、！？']) assert.equal(J.validateSentence(v).error, J.MSG.noJapanese, v);
  for (const v of ['hello あ', 'abc カ', 'abc 学', 'ー'.length ? 'テスト' : '']) assert.ok(J.validateSentence(v).sentence, v);
});

test('정규화·해시: 앞뒤 공백만 달라도 같은 키, 내용이 다르면 다른 키', () => {
  assert.equal(J.hashSentence(J.normalizeSentence(' 猫が好き ')), J.hashSentence(J.normalizeSentence('猫が好き')));
  assert.notEqual(J.hashSentence('猫が好き'), J.hashSentence('犬が好き'));
  assert.match(J.hashSentence('猫'), /^[0-9a-f]{64}$/);
});

// ───── AI 응답 JSON 검증(순수 함수) ─────
test('응답 검증: 올바른 형식은 통과하고 값은 다듬어(trim) 반환, jlpt null 허용', () => {
  const v = J.validateAiResult(GOOD);
  assert.equal(v.result.translation, GOOD.translation);
  assert.equal(v.result.grammar.length, 2);
  assert.equal(v.result.grammar[0].jlpt, 'N5');
  assert.equal(v.result.grammar[1].jlpt, null);
});

test('응답 검증: 형식이 틀리면 invalid(번역 없음·항목 0개·9개·필드 누락·빈 문자열·너무 긺·jlpt 값 오류·배열 아님)', () => {
  const g = GOOD.grammar[0];
  const bad = [
    null, [], 'text', { ok: true }, { ...GOOD, ok: undefined },
    { ...GOOD, translation: '' }, { ...GOOD, translation: 5 }, { ...GOOD, translation: 'あ'.repeat(201) },
    { ...GOOD, grammar: [] }, { ...GOOD, grammar: 'x' }, { ...GOOD, grammar: Array(9).fill(g) }, { ...GOOD, grammar: [null] },
    { ...GOOD, grammar: [{ ...g, name: '' }] }, { ...GOOD, grammar: [{ ...g, meaning: undefined }] }, { ...GOOD, grammar: [{ ...g, form: '   ' }] },
    { ...GOOD, grammar: [{ ...g, contrast: 'あ'.repeat(301) }] },
    { ...GOOD, grammar: [{ ...g, jlpt: 'N6' }] }, { ...GOOD, grammar: [{ ...g, jlpt: 3 }] }, { ...GOOD, grammar: [{ ...g, jlpt: undefined }] }, { ...GOOD, grammar: [{ ...g, jlpt: '' }] },
  ];
  for (const b of bad) assert.deepEqual(J.validateAiResult(b), { invalid: true }, JSON.stringify(b));
});

test('응답 검증: ok:false 는 거절(사유 그대로, 비었거나 너무 길면 기본 문구)', () => {
  assert.deepEqual(J.validateAiResult({ ok: false, reason: '일본어 문장이 아닙니다.' }), { rejected: '일본어 문장이 아닙니다.' });
  assert.deepEqual(J.validateAiResult({ ok: false }), { rejected: J.MSG.notSentence });
  assert.deepEqual(J.validateAiResult({ ok: false, reason: 'あ'.repeat(101) }), { rejected: J.MSG.notSentence });
});

test('JSON 파싱: 코드 블록은 벗기고, 깨진 JSON·객체가 아닌 값은 예외', () => {
  assert.deepEqual(J.parseModelJson('```json\n{"ok":false}\n```'), { ok: false });
  assert.deepEqual(J.parseModelJson(' {"ok":false} '), { ok: false });
  for (const v of ['', 'not json', '[1]', '"x"', 'null', '{"ok":']) assert.throws(() => J.parseModelJson(v), v);
});

// ───── 라우트: 인증·권한·입력 ─────
test('로그인 없으면 401, 차단된 계정은 403, 권한 있는 계정은 통과', async t => {
  const { post, anthropic, t: app } = await setup();
  t.after(() => app.close());
  assert.equal((await post('猫が好き', null)).status, 401);
  assert.equal((await post('猫が好き', 9)).status, 403);
  assert.equal(anthropic.calls.length, 0);
  assert.equal((await post('猫が好き', 1)).status, 200);
});

test('입력 오류(빈 값·201자·일본어 없음)는 400 이고 AI 를 부르지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  for (const s of ['', '   ', 'あ'.repeat(201), 'English only', '한국어만']) {
    const r = await post(s);
    assert.equal(r.status, 400, s);
    assert.equal(r.body.ok, false);
  }
  assert.equal((await app.call('POST', '/api/jgrammar/explain', {}, { user: 1 })).status, 400, 'sentence 없음');
  assert.equal(anthropic.calls.length, 0);
  assert.equal(db.cache.size, 0);
});

// ───── 라우트: 정상·캐시 ─────
test('정상: 번역과 문법 항목을 돌려주고 저장하며, 입력은 JSON 데이터로 보내고 모델은 Haiku 로 고정', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  const r = await post('  私は毎日学校に行きます。 ');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true); assert.equal(r.body.cached, false);
  assert.equal(r.body.result.translation, GOOD.translation);
  assert.equal(r.body.result.grammar.length, 2);
  assert.equal(anthropic.calls.length, 1);
  assert.equal(anthropic.calls[0].model, 'claude-haiku-4-5-20251001');
  const content = anthropic.calls[0].messages[0].content;
  assert.deepEqual(JSON.parse(content.slice(content.indexOf('\n') + 1)), { '문장': '私は毎日学校に行きます。' }, '공백을 뺀 문장이 JSON 데이터로 들어감');
  assert.equal(db.cache.size, 1);
  assert.equal([...db.cache.values()][0].sentence, '私は毎日学校に行きます。');
  assert.equal(db.usage.length, 1);
  assert.equal(db.usage[0].event_type, 'jgrammar');
});

test('캐시: 같은 문장(앞뒤 공백만 다름)·다른 사용자는 AI 를 다시 부르지 않고 저장본을 돌려준다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  await post('猫が好き');
  const again = await post('  猫が好き\n', 2);
  assert.equal(again.status, 200);
  assert.equal(again.body.cached, true);
  assert.deepEqual(again.body.result.grammar, J.validateAiResult(GOOD).result.grammar);
  assert.equal(anthropic.calls.length, 1, 'AI 는 한 번만');
  assert.equal(db.usage.length, 1);
  await post('犬が好き');
  assert.equal(anthropic.calls.length, 2, '다른 문장은 새로 호출');
  assert.equal(db.cache.size, 2);
});

test('캐시: 저장본이 깨져 있으면(검증 실패) 없는 것으로 보고 다시 만들어 저장한다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  db.cache.set(J.hashSentence('猫が好き'), { sentence: '猫が好き', result: { translation: '', grammar: [] }, model: 'x' });
  const r = await post('猫が好き');
  assert.equal(r.status, 200); assert.equal(r.body.cached, false);
  assert.equal(anthropic.calls.length, 1);
});

test('캐시 읽기가 실패해도 AI 로 계속 처리한다', async t => {
  const { post, anthropic, t: app } = await setup({ failCacheRead: true });
  t.after(() => app.close());
  assert.equal((await post('猫が好き')).status, 200);
  assert.equal(anthropic.calls.length, 1);
});

// ───── 라우트: 형식 오류·재시도·실패 ─────
test('형식 오류 후 재시도에서 성공하면 정상 응답(AI 2회 호출, 저장 1건)', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = (p, n) => (n === 1 ? '이건 JSON 이 아닙니다' : JSON.stringify(GOOD));
  const r = await post('猫が好き');
  assert.equal(r.status, 200); assert.equal(r.body.cached, false);
  assert.equal(anthropic.calls.length, 2);
  assert.equal(db.cache.size, 1);
  assert.equal(db.usage.length, 2, '호출이 끝난 두 번 모두 사용량 기록');
});

test('형식 오류가 두 번 이어지면 재시도는 1회만 하고 실패 안내, 저장하지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = (p, n) => (n === 1 ? '{"ok":true,"translation":"x","grammar":[]}' : '{깨진');
  const r = await post('猫が好き');
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { ok: false, error: J.MSG.aiFail });
  assert.equal(anthropic.calls.length, J.MAX_ATTEMPTS);
  assert.equal(anthropic.calls.length, 2);
  assert.equal(db.cache.size, 0);
});

test('API 오류는 다시 부르지 않고 실패 안내, 저장하지 않는다. 실패 뒤 같은 문장을 다시 보내면 새로 시도한다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = () => { throw new Error('down'); };
  const r = await post('猫が好き');
  assert.equal(r.status, 502); assert.equal(r.body.error, J.MSG.aiFail);
  assert.equal(anthropic.calls.length, 1);
  assert.equal(db.cache.size, 0);
  anthropic.handler = () => JSON.stringify(GOOD);
  assert.equal((await post('猫が好き')).status, 200);
});

test('AI 가 일본어 문장이 아니라고 응답하면(ok:false) 그 사유만 돌려주고 저장하지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = () => JSON.stringify({ ok: false, reason: '문장이 성립하지 않습니다.' });
  const r = await post('漢字漢字');
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { ok: false, rejected: true, error: '문장이 성립하지 않습니다.' });
  assert.equal(anthropic.calls.length, 1, '거절은 형식 오류가 아니므로 재시도 없음');
  assert.equal(db.cache.size, 0);
});

test('코드 블록으로 감싼 JSON 응답도 받는다', async t => {
  const { post, anthropic, t: app } = await setup();
  t.after(() => app.close());
  anthropic.handler = () => '```json\n' + JSON.stringify(GOOD) + '\n```';
  assert.equal((await post('猫が好き')).status, 200);
});

// ───── 하루 한도 ─────
test('하루 한도: AI 호출 건수만 세어 한도에 닿으면 429, 캐시 적중은 한도와 무관하게 응답', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '2';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const { post, anthropic, t: app } = await setup();
  t.after(() => app.close());
  assert.equal((await post('猫が好き')).status, 200);
  assert.equal((await post('犬が好き')).status, 200);
  const over = await post('鳥が好き');
  assert.equal(over.status, 429); assert.equal(over.body.error, J.MSG.cap);
  assert.equal(anthropic.calls.length, 2);
  assert.equal((await post('猫が好き')).body.cached, true, '저장된 문장은 한도 뒤에도 열림');
  assert.equal((await post('猫が好き', 2)).status, 200, '다른 사용자는 자기 한도');
});

// ───── 작업JG-2: 사용자별 권한(perm_jgrammar) ─────
test('권한 없음(false)·사용자 행 없음은 403 이고, 캐시 조회·AI 호출·한도 계산·사용량 기록이 모두 일어나지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup();
  t.after(() => app.close());
  db.cache.set(J.hashSentence('猫が好き'), { sentence: '猫が好き', result: { translation: '고양이를 좋아한다', grammar: GOOD.grammar }, model: 'x' });   // 저장본이 있어도 열리지 않아야 한다
  for (const user of [3, 77]) {
    const r = await post('猫が好き', user);
    assert.equal(r.status, 403, 'user ' + user);
    assert.equal(r.body.ok, false);
  }
  assert.equal(anthropic.calls.length, 0);
  assert.equal(db.usage.length, 0);
  assert.deepEqual(db.queries.filter(q => /jgrammar_cache|api_usage/.test(q)), [], '캐시·사용량 테이블을 건드리지 않음');
  assert.equal((await post('猫が好き', 1)).body.cached, true, '권한이 있으면 같은 저장본이 열림');
});

test('권한 조회 중 오류가 나면 차단(fail-closed) — 캐시·AI 도 일어나지 않는다', async t => {
  const { post, anthropic, db, t: app } = await setup({ failUsers: true });
  t.after(() => app.close());
  const r = await post('猫が好き', 1);
  assert.equal(r.status, 403);
  assert.equal(anthropic.calls.length, 0);
  assert.deepEqual(db.queries.filter(q => /jgrammar_cache|api_usage/.test(q)), []);
});

test('DATABASE_URL 이 없으면 차단(fail-closed), 단 ADMIN_EMAILS 관리자는 허용', async t => {
  const saved = process.env.DATABASE_URL;
  const { post, anthropic, t: app } = await setup();
  t.after(() => { process.env.DATABASE_URL = saved; return app.close(); });
  delete process.env.DATABASE_URL;
  assert.equal((await post('猫が好き', 1)).status, 403);
  assert.equal(anthropic.calls.length, 0);
});

test('관리자는 항상 허용: DB 의 role=admin 은 권한 열이 false 여도, ADMIN_EMAILS 이메일은 사용자 행이 없어도 통과', async t => {
  const { post, anthropic, t: app } = await setup();
  t.after(() => app.close());
  assert.equal((await post('猫が好き', 4)).status, 200, 'DB 관리자(perm false)');
  assert.equal((await post('犬が好き', 5)).status, 200, '이메일 관리자(행 없음)');
  assert.equal(anthropic.calls.length, 2);
});

test('차단된 계정은 권한 열이 true 여도 403 (관리자가 아닌 경우)', async t => {
  const { post, t: app } = await setup();
  t.after(() => app.close());
  assert.equal((await post('猫が好き', 9)).status, 403);
});

test('입력 오류 응답보다 권한 검사가 먼저다: 권한 없는 계정은 빈 입력에도 400 이 아니라 403', async t => {
  const { post, t: app } = await setup();
  t.after(() => app.close());
  assert.equal((await post('', 3)).status, 403);
});

test('컬럼 기본값은 차단: users.perm_jgrammar 는 BOOLEAN NOT NULL DEFAULT false 이고 여러 번 실행해도 안전한 IF NOT EXISTS 문장이다', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'db.js'), 'utf8');
  assert.ok(src.includes('ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_jgrammar BOOLEAN NOT NULL DEFAULT false'));
});

test('관리자 API·/api/me 가 perm_jgrammar 를 다룬다(목록·저장 허용 목록·내 정보 조회)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  assert.match(admin, /u\.perm_jgrammar/);
  assert.match(admin, /allowed = \[[^\]]*'perm_jgrammar'/);
  assert.match(admin, /RETURNING[^`]*perm_jgrammar/);
  assert.match(auth, /perm_concept_map, perm_jgrammar\s/);
  assert.match(auth, /perm_jgrammar: false/);
});

// ───── 작업JG-3: 사진 인식(POST /api/jgrammar/ocr) ─────
const jwt = require('jsonwebtoken');
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('fake-jpeg-body')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('fake-png-body')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
const GIF = Buffer.from('GIF89a-fake-body');
const OCR_GOOD = { sentences: ['私は毎日学校に行きます。', '猫が好きです。'] };

async function ocrSetup(opts) {
  const base = await setup(opts);
  const secret = process.env.JWT_SECRET || 'mydict-jwt-secret';
  base.sendImage = async (body, type = 'image/jpeg', user = 1) => {
    const headers = { 'Content-Type': type };
    if (user !== null) headers.Authorization = 'Bearer ' + jwt.sign({ id: user, email: 'u' + user + '@example.com' }, secret);
    const r = await fetch(base.t.base + '/api/jgrammar/ocr', { method: 'POST', headers, body });
    let json = null; try { json = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { status: r.status, body: json };
  };
  // 경로(ocr/explain)에 따라 다른 응답: 이미지가 들어 있는 호출은 인식, 아니면 문법 분석
  base.anthropic.handler = params => (Array.isArray(params.messages[0].content) ? JSON.stringify(OCR_GOOD) : JSON.stringify(GOOD));
  return base;
}

test('OCR 권한: 로그인 없으면 401, 권한 없음·행 없음·차단은 403 이고 이미지 처리·AI·한도 계산·사용량 기록이 모두 일어나지 않는다', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  assert.equal((await a.sendImage(JPEG, 'image/jpeg', null)).status, 401);
  for (const user of [3, 77, 9]) assert.equal((await a.sendImage(JPEG, 'image/jpeg', user)).status, 403, 'user ' + user);
  assert.equal((await a.sendImage('text', 'text/plain', 3)).status, 403, '권한 없으면 형식 오류보다 403 이 먼저');
  assert.equal((await a.sendImage(Buffer.concat([JPEG, Buffer.alloc(J.OCR_MAX_BYTES)]), 'image/jpeg', 3)).status, 403, '권한 없으면 용량 검사(본문 읽기)보다 403 이 먼저');
  assert.equal(a.anthropic.calls.length, 0);
  assert.equal(a.db.usage.length, 0);
  assert.deepEqual(a.db.queries.filter(q => /api_usage|jgrammar_cache/.test(q)), []);
  const f = await ocrSetup({ failUsers: true });
  t.after(() => f.t.close());
  assert.equal((await f.sendImage(JPEG)).status, 403, '권한 조회 오류는 차단');
  assert.equal(f.anthropic.calls.length, 0);
});

test('OCR 관리자(DB role·이메일)는 항상 허용', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  assert.equal((await a.sendImage(JPEG, 'image/jpeg', 4)).status, 200);
  assert.equal((await a.sendImage(JPEG, 'image/jpeg', 5)).status, 200);
});

test('OCR 정상: 문장 배열을 돌려주고, 이미지를 base64 로 Haiku 에 보내며, 이벤트 jgrammar_ocr 로 기록하고, 결과·이미지를 저장하지 않는다', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  const r = await a.sendImage(PNG, 'image/png');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, sentences: OCR_GOOD.sentences });
  assert.equal(a.anthropic.calls.length, 1);
  const call = a.anthropic.calls[0];
  assert.equal(call.model, 'claude-haiku-4-5-20251001');
  const img = call.messages[0].content.find(c => c.type === 'image');
  assert.equal(img.source.media_type, 'image/png');
  assert.equal(img.source.data, PNG.toString('base64'));
  assert.deepEqual(a.db.usage.map(u => u.event_type), ['jgrammar_ocr']);
  assert.equal(a.db.cache.size, 0, '문법 캐시에도 인식 결과 없음');
  const b64 = PNG.toString('base64');
  for (const q of a.db.queries) assert.ok(!q.includes(b64), '쿼리에 이미지 없음');
  assert.ok(!JSON.stringify(a.db.usage).includes(b64));
  assert.ok(!JSON.stringify([...a.db.cache.values()]).includes(b64));
});

test('OCR 같은 이미지를 다시 보내면 다시 호출한다(인식 결과는 캐시하지 않음)', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  await a.sendImage(JPEG); await a.sendImage(JPEG);
  assert.equal(a.anthropic.calls.length, 2);
  assert.equal(a.db.queries.filter(q => /jgrammar_cache/.test(q)).length, 0);
});

test('OCR 이미지 검증: 형식 아님 415, 빈 본문·서명 불일치 400, 5MB 초과 413 — 모두 AI 호출 없음', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  for (const type of ['text/plain', 'application/pdf', 'image/svg+xml', 'image/heic']) assert.equal((await a.sendImage('x', type)).status, 415, type);
  assert.equal((await a.sendImage(Buffer.alloc(0))).status, 400, '빈 본문');
  assert.equal((await a.sendImage(Buffer.from('not an image'), 'image/jpeg')).status, 400, 'jpeg 라고 했지만 서명이 다름');
  assert.equal((await a.sendImage(PNG, 'image/jpeg')).status, 400, '서명이 선언 형식과 다름');
  const r = await a.sendImage(Buffer.concat([JPEG, Buffer.alloc(J.OCR_MAX_BYTES)]));
  assert.equal(r.status, 413); assert.equal(r.body.error, J.MSG.imageTooLarge);
  assert.equal(a.anthropic.calls.length, 0);
  assert.equal(a.db.usage.length, 0);
  for (const [buf, type] of [[JPEG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp'], [GIF, 'image/gif']]) assert.equal((await a.sendImage(buf, type)).status, 200, type);
});

test('OCR 상한 값: 정확히 5MB 는 통과(순수 검증), 1바이트 넘으면 거부', () => {
  assert.equal(J.OCR_MAX_BYTES, 5 * 1024 * 1024);
  const at = Buffer.concat([JPEG, Buffer.alloc(J.OCR_MAX_BYTES - JPEG.length)]);
  assert.equal(J.validateImage(at, 'image/jpeg'), null);
  assert.equal(J.validateImage(Buffer.concat([at, Buffer.alloc(1)]), 'image/jpeg').status, 413);
});

test('OCR 빈 배열은 정상 응답(문장 없음), 일본어 글자가 없는 항목·빈 문자열은 빼고 공백은 다듬는다', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  a.anthropic.handler = () => '{"sentences":[]}';
  assert.deepEqual((await a.sendImage(JPEG)).body, { ok: true, sentences: [] });
  a.anthropic.handler = () => JSON.stringify({ sentences: ['  猫が好き  ', '', 'Hello', '12345', 'ネコ'] });
  assert.deepEqual((await a.sendImage(JPEG)).body.sentences, ['猫が好き', 'ネコ']);
  assert.equal(a.anthropic.calls.length, 2, '빈 배열은 형식 오류가 아니므로 재시도 없음');
});

test('OCR 응답 검증: sentences 가 배열이 아님·문자열 아닌 항목·31개 초과는 invalid', () => {
  for (const b of [null, [], 'x', {}, { sentences: 'x' }, { sentences: [1] }, { sentences: [null] }, { sentences: Array(31).fill('猫') }]) assert.deepEqual(J.validateOcrResult(b), { invalid: true }, JSON.stringify(b));
  assert.equal(J.validateOcrResult({ sentences: Array(30).fill('猫') }).sentences.length, 30);
});

test('OCR 형식 오류 후 재시도 성공(2회 호출, 사용량 2건), 두 번 모두 틀리면 실패 안내(재시도 1회만)', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  a.anthropic.handler = (p, n) => (n === 1 ? '깨진 응답' : JSON.stringify(OCR_GOOD));
  assert.equal((await a.sendImage(JPEG)).status, 200);
  assert.equal(a.anthropic.calls.length, 2);
  assert.equal(a.db.usage.length, 2);
  a.anthropic.calls.length = 0;
  a.anthropic.handler = (p, n) => (n === 1 ? '{"sentences":"x"}' : '{깨진');
  const bad = await a.sendImage(JPEG);
  assert.equal(bad.status, 502); assert.deepEqual(bad.body, { ok: false, error: J.MSG.ocrFail });
  assert.equal(a.anthropic.calls.length, 2);
});

test('OCR API 오류는 재시도 없이 실패 안내', async t => {
  const a = await ocrSetup();
  t.after(() => a.t.close());
  a.anthropic.handler = () => { throw new Error('down'); };
  const r = await a.sendImage(JPEG);
  assert.equal(r.status, 502);
  assert.equal(a.anthropic.calls.length, 1);
});

test('하루 한도 합산: 인식 1회=1건, 문법 분석 1회=1건이며 합이 한도면 인식도 분석도 거부(분석 캐시 적중은 예외)', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '3';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const a = await ocrSetup();
  t.after(() => a.t.close());
  assert.equal((await a.sendImage(JPEG)).status, 200);               // 1건
  assert.equal((await a.post('猫が好き')).status, 200);               // 2건
  assert.equal((await a.sendImage(JPEG)).status, 200);               // 3건
  const ocr4 = await a.sendImage(JPEG);
  assert.equal(ocr4.status, 429); assert.equal(ocr4.body.error, J.MSG.cap);
  assert.equal((await a.post('犬が好き')).status, 429, '분석도 거부');
  assert.equal((await a.post('猫が好き')).body.cached, true, '저장된 분석은 한도 뒤에도 열림');
  assert.equal(a.anthropic.calls.length, 3);
  assert.equal((await a.sendImage(JPEG, 'image/jpeg', 2)).status, 200, '다른 사용자는 자기 한도');
});

test('인식 먼저 한도에 닿으면 분석 429 (분석 건수만 세던 JG-1 동작은 분석만 쓸 때 그대로)', async t => {
  process.env.JGRAMMAR_DAILY_CAP = '2';
  t.after(() => { delete process.env.JGRAMMAR_DAILY_CAP; });
  const a = await ocrSetup();
  t.after(() => a.t.close());
  await a.sendImage(JPEG); await a.sendImage(JPEG);
  assert.equal((await a.post('猫が好き')).status, 429);
});
