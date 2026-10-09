// 작업224-2: GET /api/voice-notes/quiz-summary — 퀴즈 탭용 읽기 전용 요약(자료별 유효 퀴즈 여부·시도 횟수·최근 점수).
// 실행: node --test "tests/**/*.test.js"   (Anthropic·DB는 모의)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createMockDb } = require('./helpers/mock_db');
const { startApp, createAnthropicMock } = require('./helpers/app');

const sha = t => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const LONG = '광합성은 엽록체에서 빛에너지를 이용해 포도당을 만드는 과정이다. '.repeat(6);   // 공백을 빼도 150자 이상
const U = '/api/voice-notes/quiz-summary';

async function setup() {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const anthropic = createAnthropicMock();
  const t = await startApp(['routes/voice_study.js'], { db, anthropic });
  return { db, anthropic, call: t.call, close: t.close };
}
function addNote(db, { user = 7, title, transcript = LONG, subject = '과학', created_at } = {}) {
  const id = db.seq.voice_notes++;
  const row = { id, user_id: user, title: title === undefined ? '자료' + id : title, transcript, summary: '요약', subject, subject_detail: null, link_hash: null, keywords: null,
    merged_from: null, summary_source_hash: null, created_at: created_at || new Date(Date.now() + id), updated_at: new Date() };
  db.tables.voice_notes.push(row);
  return row;
}
const addQuiz = (db, n, hashOf = n.transcript) => db.tables.voice_quizzes.push({ note_id: n.id, user_id: n.user_id, questions: [{ question: 'q' }], source_hash: sha(hashOf), created_at: new Date() });
let attemptSeq = 0;
const addAttempt = (db, n, score, total, at) => db.tables.voice_quiz_attempts.push({ id: db.seq.voice_quiz_attempts++, user_id: n.user_id, note_id: n.id, quiz_hash: 'h', score, total, items: [], created_at: at || new Date(Date.now() + (++attemptSeq) * 1000) });

test('quiz-summary: 응답 형식 — 자료별 note_id·title·subject·has_quiz·attempts·last_score·last_total·last_at, 최신 자료 먼저', async () => {
  const { db, call, close } = await setup();
  const a = addNote(db, { title: '첫 자료' }), b = addNote(db, { title: '둘째 자료', subject: '국어' });
  addQuiz(db, b); addAttempt(db, b, 4, 10); addAttempt(db, b, 7, 10);
  const r = await call('GET', U);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map(x => x.note_id), [b.id, a.id], '최신 자료 먼저');
  assert.deepEqual(Object.keys(r.body[0]).sort(), ['attempts', 'has_quiz', 'last_at', 'last_score', 'last_total', 'note_id', 'subject', 'title']);
  assert.equal(r.body[0].title, '둘째 자료'); assert.equal(r.body[0].subject, '국어');
  assert.equal(r.body[0].has_quiz, true); assert.equal(r.body[0].attempts, 2);
  assert.equal(r.body[0].last_score, 7); assert.equal(r.body[0].last_total, 10); assert.ok(r.body[0].last_at, '최근 시도 시각');
  await close();
});

test('quiz-summary: 시도 없는 자료는 attempts 0·점수 null, 퀴즈 없는 자료는 has_quiz false', async () => {
  const { db, call, close } = await setup();
  const n = addNote(db);
  const r = await call('GET', U);
  assert.deepEqual(r.body, [{ note_id: n.id, title: n.title, subject: '과학', has_quiz: false, attempts: 0, last_score: null, last_total: null, last_at: null }]);
  await close();
});

test('quiz-summary: 원문이 바뀐 자료(저장된 퀴즈의 원문 해시와 다름)는 has_quiz false, 시도 기록은 그대로', async () => {
  const { db, call, close } = await setup();
  const n = addNote(db);
  addQuiz(db, n); addAttempt(db, n, 3, 5);
  assert.equal((await call('GET', U)).body[0].has_quiz, true);
  n.transcript = LONG + ' 원문을 고쳐 썼다.';
  const r = await call('GET', U);
  assert.equal(r.body[0].has_quiz, false, '원문이 바뀌면 퀴즈 없음으로 본다(GET /:id/quiz 의 404 규칙과 같음)');
  assert.equal(r.body[0].attempts, 1);
  await close();
});

test('quiz-summary: 퀴즈를 만들 수 없는 짧은 자료(공백 제외 150자 미만)는 목록에서 제외', async () => {
  const { db, call, close } = await setup();
  addNote(db, { transcript: '짧은 원문입니다' });
  addNote(db, { transcript: ('가 ').repeat(100) });   // 공백 포함 200자지만 공백을 빼면 100자
  const ok = addNote(db, { transcript: '가'.repeat(150) });
  const r = await call('GET', U);
  assert.deepEqual(r.body.map(x => x.note_id), [ok.id]);
  await close();
});

test('quiz-summary: 다른 사용자의 자료·퀴즈·시도는 섞이지 않음', async () => {
  const { db, call, close } = await setup();
  const mine = addNote(db), theirs = addNote(db, { user: 8, title: '남의 자료' });
  addQuiz(db, theirs); addAttempt(db, theirs, 9, 10);
  const r = await call('GET', U);
  assert.deepEqual(r.body.map(x => x.note_id), [mine.id]);
  assert.equal(r.body[0].has_quiz, false); assert.equal(r.body[0].attempts, 0);
  const r8 = await call('GET', U, undefined, { user: 8 });
  assert.deepEqual(r8.body.map(x => x.note_id), [theirs.id]);
  assert.equal(r8.body[0].attempts, 1);
  await close();
});

test('quiz-summary: 토큰 없으면 401, 음성 학습 권한이 없으면 403, ":id" 로 잡히지 않음', async () => {
  const { db, call, close } = await setup();
  addNote(db);
  assert.equal((await call('GET', U, undefined, { user: null })).status, 401);
  db.tables.users.find(u => u.id === 8).perm_voice_study = false;
  assert.equal((await call('GET', U, undefined, { user: 8 })).status, 403);
  assert.equal((await call('GET', U)).status, 200, '/api/voice-notes/:id 처리기로 넘어가 404가 되지 않음');
  await close();
});

test('quiz-summary: 읽기 전용 — AI 호출 0, 사용량 기록·쓰기 없음, 조회 SQL(SELECT)만 실행', async () => {
  const { db, anthropic, call, close } = await setup();
  const n = addNote(db); addQuiz(db, n); addAttempt(db, n, 1, 2);
  const before = JSON.stringify([db.tables.voice_notes, db.tables.voice_quizzes, db.tables.voice_quiz_attempts, db.tables.api_usage]);
  db.queries.length = 0;
  await call('GET', U);
  assert.equal(anthropic.calls.length, 0, 'AI 호출 없음');
  assert.equal(JSON.stringify([db.tables.voice_notes, db.tables.voice_quizzes, db.tables.voice_quiz_attempts, db.tables.api_usage]), before, '데이터 변경 없음');
  const sqls = db.queries.map(q => q.sql).filter(s => !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s));
  assert.ok(sqls.length >= 1 && sqls.every(s => /^SELECT /.test(s)), '모든 SQL이 SELECT: ' + sqls.map(s => s.slice(0, 30)).join(' | '));
  await close();
});

test('quiz-summary: 500 응답 — DB 오류는 일반 오류로만 알림(내부 메시지 숨김)', async () => {
  const { db, call, close } = await setup();
  addNote(db);
  db.failOn = /FROM voice_quiz_attempts/;
  const r = await call('GET', U);
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.body).includes('mock_db'));
  await close();
});
