process.chdir(require('path').resolve(__dirname, '..', '..'));   // 저장소 루트(이 파일 기준)
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const root = require('path').resolve(__dirname, '..', '..').replace(/\\/g, '/') + '/';   // 저장소 루트(이 파일 기준)
process.env.DATABASE_URL = 'x';
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

let authed = true, curUser = 7, clock = Date.parse('2026-03-01T00:00:00Z');
const notes = new Map(), quizzes = new Map(), attempts = [];
let nextAttempt = 1;
function handle(sql, p) {
  if (/SELECT transcript FROM voice_notes WHERE id/.test(sql)) { const n = notes.get(p[0]); return { rows: n && n.user_id === p[1] ? [{ transcript: n.transcript }] : [] }; }
  if (/SELECT questions, source_hash FROM voice_quizzes WHERE note_id/.test(sql)) { const q = quizzes.get(p[0]); return { rows: q && q.user_id === p[1] ? [{ questions: q.questions, source_hash: q.source_hash }] : [] }; }
  if (/^\s*INSERT INTO voice_quiz_attempts/.test(sql)) {
    clock += 1000;
    const a = { id: nextAttempt++, user_id: p[0], note_id: p[1], quiz_hash: p[2], score: p[3], total: p[4], items: JSON.parse(p[5]), created_at: new Date(clock) };
    attempts.push(a); return { rows: [{ id: a.id, created_at: a.created_at }] };
  }
  if (/DELETE FROM voice_quiz_attempts WHERE user_id = \$1 AND note_id = \$2 AND id NOT IN/.test(sql)) {
    const keep = Number(sql.match(/LIMIT (\d+)/)[1]);
    const mine = attempts.filter(a => a.user_id === p[0] && a.note_id === p[1]).sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, keep).map(a => a.id);
    for (let i = attempts.length - 1; i >= 0; i--) { const a = attempts[i]; if (a.user_id === p[0] && a.note_id === p[1] && !mine.includes(a.id)) attempts.splice(i, 1); }
    return { rows: [] };
  }
  if (/SELECT id, score, total, created_at FROM voice_quiz_attempts WHERE note_id/.test(sql)) {
    const lim = Number(sql.match(/LIMIT (\d+)/)[1]);
    return { rows: attempts.filter(a => a.note_id === p[0] && a.user_id === p[1]).sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, lim).map(a => ({ id: a.id, score: a.score, total: a.total, created_at: a.created_at })) };
  }
  if (/FROM voice_quiz_attempts a JOIN voice_notes n/.test(sql)) {
    const lim = Number(sql.match(/LIMIT (\d+)/)[1]);
    return { rows: attempts.filter(a => a.user_id === p[0] && notes.has(a.note_id)).sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, lim).map(a => ({ id: a.id, note_id: a.note_id, items: a.items, created_at: a.created_at, title: notes.get(a.note_id).title, subject: notes.get(a.note_id).subject })) };
  }
  if (/SELECT id, title, subject, subject_detail, LEFT\(summary/.test(sql)) return { rows: [] };
  return { rows: [] };
}
const stubs = {
  [path.resolve(root, 'lib/db.js')]: { pool: { query: async (s, p) => handle(s, p) }, trackUsage: () => {} },
  [path.resolve(root, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { if (!authed) return res.status(401).json({ error: 'no' }); req.user = { id: curUser }; next(); }, checkPermission: async () => true },
};
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) { try { const r = Module._resolveFilename(req, parent); if (stubs[r]) return stubs[r]; } catch (e) {} return origLoad.call(this, req, parent, ...rest); };
const express = require(root + 'node_modules/express');
const router = require(root + 'routes/voice_study.js');
const app = express(); app.use(express.json({ limit: '5mb' })); app.use(router);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
const mkQ = (question, choices, answer_index, quote) => ({ question, choices, answer_index, quote, explanation: '설명' });
const QS = () => [
  mkQ('광합성이 일어나는 곳은?', ['미토콘드리아', '엽록체', '핵', '리보솜'], 1, '엽록체에서 일어난다 라고 합니다'),
  mkQ('광합성의 부산물은?', ['산소', '질소', '수소', '헬륨'], 0, '산소가 부산물로 나온다 라고 합니다'),
  mkQ('광합성에 필요한 기체는?', ['산소', '이산화탄소', '질소', '메탄'], 1, '이산화탄소가 필요하다 라고 합니다'),
];
(async () => {
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; };
  const T1 = '광합성 원문 하나', T2 = '광합성 원문 둘';
  notes.set(1, { id: 1, user_id: 7, title: '광합성', subject: '과학', transcript: T1 });
  notes.set(2, { id: 2, user_id: 7, title: '낡은 퀴즈', subject: null, transcript: T2 + ' 수정됨' });
  notes.set(3, { id: 3, user_id: 7, title: '퀴즈 없음', subject: null, transcript: '원문' });
  notes.set(4, { id: 4, user_id: 8, title: '타인', subject: '과학', transcript: '타인 원문' });
  notes.set(5, { id: 5, user_id: 7, title: '다른 자료', subject: '과학', transcript: '다른 자료 원문' });
  quizzes.set(1, { user_id: 7, questions: QS(), source_hash: sha(T1) });
  quizzes.set(2, { user_id: 7, questions: QS(), source_hash: sha(T2) });            // 원문이 바뀌어 낡음
  quizzes.set(4, { user_id: 8, questions: QS(), source_hash: sha('타인 원문') });
  quizzes.set(5, { user_id: 7, questions: QS(), source_hash: sha('다른 자료 원문') });
  const post = (id, answers, extra) => call('POST', `/api/voice-notes/${id}/quiz/attempts`, { answers, ...(extra || {}) });

  // ── 서버 채점 ──
  let r = await post(1, [{ q: 0, chosen: 1, correct: false, score: 0 }, { q: 1, chosen: 2, correct: true }, { q: 2, chosen: 1, correct: false }], { score: 99, total: 99, correct: true });
  ok('201 + server-side score ignores client correct/score', r.status === 201 && r.body.score === 2 && r.body.total === 3, r);
  ok('items graded by server', JSON.stringify(r.body.items.map(i => [i.q, i.chosen, i.correct])) === JSON.stringify([[0, 1, true], [1, 2, false], [2, 1, true]]), r.body.items);
  ok('item snapshot (question, choices, answer_index, quote)', r.body.items[1].question === '광합성의 부산물은?' && r.body.items[1].answer_index === 0 && r.body.items[1].choices.length === 4 && r.body.items[1].quote.startsWith('산소가'), r.body.items[1]);
  const stored = attempts[attempts.length - 1];
  ok('stored row: hash of quiz, score, snapshot', stored.quiz_hash === sha(JSON.stringify(QS())) && stored.score === 2 && stored.total === 3 && stored.items.length === 3 && stored.user_id === 7 && stored.note_id === 1, stored);
  r = await post(1, [{ q: 0, chosen: 1 }, { q: 1, chosen: 0 }, { q: 2, chosen: 1 }]); ok('all correct → 3/3', r.body.score === 3);
  r = await post(1, [{ q: 0, chosen: 0 }]); ok('missing questions count as unanswered/wrong', r.status === 201 && r.body.score === 0 && r.body.items[1].chosen === null && r.body.items[1].correct === false, r.body.items);
  r = await post(1, [{ q: 0, chosen: null }, { q: 1, chosen: null }, { q: 2, chosen: null }]); ok('null chosen = wrong', r.status === 201 && r.body.score === 0);
  for (const [name, answers] of [['not array', 'x'], ['empty', []], ['q out of range', [{ q: 3, chosen: 0 }]], ['q negative', [{ q: -1, chosen: 0 }]], ['duplicate q', [{ q: 0, chosen: 0 }, { q: 0, chosen: 1 }]],
    ['chosen 4', [{ q: 0, chosen: 4 }]], ['chosen -1', [{ q: 0, chosen: -1 }]], ['chosen string', [{ q: 0, chosen: '1' }]], ['q string', [{ q: '0', chosen: 1 }]], ['non-object entry', [5]], ['too many', [{ q: 0, chosen: 0 }, { q: 1, chosen: 0 }, { q: 2, chosen: 0 }, { q: 0, chosen: 0 }]], ['chosen missing', [{ q: 0 }]]]) {
    r = await post(1, answers); ok('400 ' + name, r.status === 400, r);
  }
  r = await call('POST', '/api/voice-notes/1/quiz/attempts', {}); ok('400 no answers', r.status === 400);
  const before = attempts.length;
  r = await post(2, [{ q: 0, chosen: 1 }]); ok('409 stale quiz (transcript changed)', r.status === 409, r);
  r = await post(3, [{ q: 0, chosen: 1 }]); ok('409 no quiz', r.status === 409);
  ok('nothing stored on 409/400', attempts.length === before);
  r = await post(4, [{ q: 0, chosen: 1 }]); ok("404 other user's note", r.status === 404);
  r = await post(99, [{ q: 0, chosen: 1 }]); ok('404 missing', r.status === 404);
  r = await call('POST', '/api/voice-notes/abc/quiz/attempts', { answers: [{ q: 0, chosen: 1 }] }); ok('404 bad id', r.status === 404);

  // ── 50개 보관 ──
  attempts.length = 0; nextAttempt = 1;
  for (let i = 0; i < 3; i++) await post(5, [{ q: 0, chosen: 1 }]);          // 다른 자료는 건드리지 않는다
  for (let i = 0; i < 55; i++) await post(1, [{ q: 0, chosen: i % 4 }]);
  const mine = attempts.filter(a => a.note_id === 1), other = attempts.filter(a => a.note_id === 5);
  ok('keeps newest 50 per note', mine.length === 50 && Math.min(...mine.map(a => a.id)) === 3 + 6 && other.length === 3, { n: mine.length, min: Math.min(...mine.map(a => a.id)), other: other.length });
  r = await call('GET', '/api/voice-notes/1/quiz/attempts');
  ok('list: newest first, shape without items, max 50', r.status === 200 && r.body.length === 50 && r.body[0].id > r.body[1].id && Object.keys(r.body[0]).sort().join() === 'created_at,id,score,total', Object.keys(r.body[0]));
  curUser = 8; r = await call('GET', '/api/voice-notes/1/quiz/attempts'); ok("list: other user's note 404", r.status === 404);
  r = await call('GET', '/api/voice-notes/4/quiz/attempts'); ok('list: own note (user 8) ok & empty', r.status === 200 && r.body.length === 0); curUser = 7;
  r = await call('GET', '/api/voice-notes/99/quiz/attempts'); ok('list: missing 404', r.status === 404);

  // ── 오답 노트: 해결 판정 ──
  attempts.length = 0; nextAttempt = 1; clock += 100000;
  await post(1, [{ q: 0, chosen: 0 }, { q: 1, chosen: 0 }, { q: 2, chosen: 0 }]);            // A: q0 오답, q1 정답, q2 오답
  let w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('route order: wrong-answers is not captured by :id', Array.isArray(w), w);
  ok('after A: q0 and q2 unresolved (newest first, same attempt → stable)', w.length === 2 && w.every(x => x.note_id === 1) && w.map(x => x.question).sort().join() === ['광합성에 필요한 기체는?', '광합성이 일어나는 곳은?'].sort().join(), w.map(x => x.question));
  const wq0 = w.find(x => x.question === '광합성이 일어나는 곳은?');
  ok('item fields', wq0.title === '광합성' && wq0.subject === '과학' && wq0.choices[wq0.answer_index] === '엽록체' && wq0.chosen === 0 && wq0.quote.startsWith('엽록체에서') && !!wq0.created_at && Object.keys(wq0).sort().join() === 'answer_index,choices,chosen,created_at,note_id,question,quote,subject,title', Object.keys(wq0));
  await post(1, [{ q: 0, chosen: 1 }, { q: 1, chosen: 0 }, { q: 2, chosen: 0 }]);            // B: q0 정답(해결), q2 또 오답
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('after B: q0 resolved, q2 still unresolved', w.length === 1 && w[0].question === '광합성에 필요한 기체는?', w.map(x => x.question));
  await post(1, [{ q: 0, chosen: 1 }, { q: 1, chosen: 3 }, { q: 2, chosen: 1 }]);            // C: q1 오답(다시 열림), q2 정답(해결)
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('after C: q2 resolved, q1 newly wrong', w.length === 1 && w[0].question === '광합성의 부산물은?' && w[0].chosen === 3 && w[0].choices[w[0].answer_index] === '산소', w);
  await post(1, [{ q: 0, chosen: 1 }]);                                                       // D: q1·q2 미응답 → 오답
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('unanswered questions are unresolved wrong answers (chosen null)', w.length === 2 && w.every(x => x.chosen === null), w.map(x => [x.question, x.chosen]));
  // 퀴즈를 다시 만들어 보기 순서·정답 위치가 바뀌어도 같은 문제로 보고 해결 처리
  const reshuffled = QS(); reshuffled[1] = mkQ('광합성의 부산물은?', ['질소', '헬륨', '산소', '수소'], 2, '산소가 부산물로 나온다 라고 합니다'); reshuffled[2] = mkQ('광합성에 필요한 기체는?', ['메탄', '이산화탄소', '산소', '질소'], 1, '이산화탄소가 필요하다 라고 합니다');
  quizzes.set(1, { user_id: 7, questions: reshuffled, source_hash: sha(T1) });
  await post(1, [{ q: 0, chosen: 1 }, { q: 1, chosen: 2 }, { q: 2, chosen: 1 }]);
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('same question+answer text resolves even if choice order changed', w.length === 0, w.map(x => x.question));
  // 다른 자료·다른 사용자의 오답은 섞이지 않는다
  await post(5, [{ q: 0, chosen: 0 }]);
  curUser = 8; await call('POST', '/api/voice-notes/4/quiz/attempts', { answers: [{ q: 1, chosen: 3 }] }); curUser = 7;
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('per note: same question text in another note stays separate; other user excluded', w.length === 3 && w.every(x => x.note_id === 5 && x.title === '다른 자료'), w.map(x => [x.note_id, x.title]));
  await post(1, [{ q: 0, chosen: 0 }]);
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('newest first across notes', w.length >= 2 && new Date(w[0].created_at) >= new Date(w[1].created_at) && w[0].note_id === 1, w.map(x => [x.note_id, x.created_at]));
  curUser = 8; w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok("other user's own wrong list", w.length === 3 && w.every(x => x.note_id === 4 && x.title === '타인'), w); curUser = 7;
  // 최대 200개
  attempts.length = 0;
  attempts.push({ id: 1, user_id: 7, note_id: 1, items: Array.from({ length: 250 }, (_, i) => ({ q: i, question: '문제 ' + i, choices: ['가', '나', '다', '라'], answer_index: 0, chosen: 1, correct: false, quote: '' })), created_at: new Date(clock + 5000) });
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body;
  ok('capped at 200 items', w.length === 200, w.length);
  attempts.length = 0;
  w = await call('GET', '/api/voice-notes/wrong-answers'); ok('empty → []', w.status === 200 && Array.isArray(w.body) && w.body.length === 0);
  r = await call('GET', '/api/voice-notes/abc'); ok('/:id still 404 for non-numeric', r.status === 404);
  // 삭제된 자료의 기록은 목록에 나오지 않음
  attempts.push({ id: 2, user_id: 7, note_id: 77, items: [{ q: 0, question: 'x', choices: ['a', 'b', 'c', 'd'], answer_index: 0, chosen: 1, correct: false }], created_at: new Date() });
  w = (await call('GET', '/api/voice-notes/wrong-answers')).body; ok('attempts of deleted notes excluded', w.length === 0);

  authed = false;
  for (const [m, u, b] of [['POST', '/api/voice-notes/1/quiz/attempts', { answers: [{ q: 0, chosen: 1 }] }], ['GET', '/api/voice-notes/1/quiz/attempts'], ['GET', '/api/voice-notes/wrong-answers']]) { r = await call(m, u, b); ok('401 ' + m + ' ' + u, r.status === 401); }
  console.log('pass', pass, 'fail', fail);
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
