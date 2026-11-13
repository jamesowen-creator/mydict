// 작업421: 단어 뜻 일괄 변환 — 한 요청의 시간 예산(새 배치를 시작하지 않고 부분 결과·남은 수 반환), 실패 종류 집계, 이어서 처리.
// 가짜 DB·가짜 AI(주입한 함수)만 쓴다. 실행: node --test --test-concurrency=3 tests/gloss_421.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'u5@example.com';
const { createGlossDb, clone } = require('./helpers/gloss_db');
const B = require('../lib/gloss_backfill');

const oldData = (word, defs) => ({ word, lang: 'en', meanings: defs.map(d => ({ pos: 'verb', definition: d })), short_meaning: defs[0] });
function setup({ step = 30000, mod } = {}) {
  const db = createGlossDb();
  const clock = { t: 0 };
  const calls = [];
  const callModel = async (uid, inputs) => {
    calls.push(clone(inputs)); clock.t += step;   // AI 호출 1회가 step 밀리초 걸린 것처럼 가짜 시계를 흘린다
    const out = inputs.map(w => ({ id: w.id, meanings: w.meanings.map(() => ({ definition: '새뜻' + w.id })) }));
    return mod ? mod(out, inputs, calls.length) : JSON.stringify(out);
  };
  return { db, calls, clock, deps: { pool: db.pool, trackUsage: db.trackUsage, callModel, now: () => clock.t } };
}

test('시간 예산: 넘으면 새 배치를 시작하지 않고 부분 결과·남은 수를 돌려준다(예산 값 45초)', async () => {
  assert.equal(B.TIME_BUDGET_MS, 45000);
  const { db, calls, deps } = setup({ step: 30000 });
  for (let i = 1; i <= 100; i++) db.addRow(i, 'w' + i, oldData('w' + i, ['가']));
  const r = await B.run(9, {}, deps);
  assert.equal(calls.length, 2, '30초씩 2배치(0→30→60초) 뒤 예산(45초) 초과로 멈춤');
  assert.deepEqual([r.done, r.partial, r.finished, r.remaining, r.next_cursor], [40, true, false, 60, 40]);
  assert.equal(db.backup.length, 40);
});

test('시간 예산: 예산 안에서는 5배치 상한까지, 예산 때문에 멈춘 게 아니면 partial=false', async () => {
  const { db, calls, deps } = setup({ step: 1000 });
  for (let i = 1; i <= 120; i++) db.addRow(i, 'w' + i, oldData('w' + i, ['가']));
  const r = await B.run(9, {}, deps);
  assert.equal(calls.length, 5);
  assert.deepEqual([r.done, r.partial, r.finished, r.remaining], [100, false, false, 20]);
});

test('이어서 처리: 부분 응답의 next_cursor 로 계속하면 끝까지 처리되고, 이미 변환된 단어는 다시 처리·호출되지 않는다', async () => {
  const { db, calls, clock, deps } = setup({ step: 30000 });
  for (let i = 1; i <= 100; i++) db.addRow(i, 'w' + i, oldData('w' + i, ['가']));
  let r = await B.run(9, {}, deps), done = r.done, rounds = 1;
  const rid = r.run_id;
  while (!r.finished && rounds < 10) { clock.t = 0; r = await B.run(9, { cursor: r.next_cursor, runId: rid }, deps); done += r.done; rounds++; }   // 요청마다 새 시간 예산
  assert.equal(done, 100); assert.equal(db.rows.filter(x => x.data.gloss_v === 1).length, 100);
  assert.equal(db.backup.length, 100, '백업은 단어당 한 번');
  const total = calls.length;
  const again = await B.run(9, {}, deps);
  assert.deepEqual([again.done, again.calls, again.finished], [0, 0, true]);
  assert.equal(calls.length, total, '재실행에서 AI 호출 없음');
  const ids = calls.flat().map(w => w.id);
  assert.equal(new Set(ids).size, ids.length, '같은 단어를 두 번 보내지 않는다');
});

test('실패 종류 집계: AI 응답 오류(형식 불량) / 규칙 불통과(20자 초과) / 단어 구조 이상', async () => {
  const { db, deps } = setup({ step: 10, mod: (out, inputs, n) => (n <= 2 ? 'not json at all' : JSON.stringify(out.map(o => o))) });
  // 1·2번 호출(첫 배치의 1차·재시도)은 JSON 이 아님 → 그 배치 단어 전부 ai
  db.addRow(1, 'a', oldData('a', ['가']));
  const r1 = await B.run(9, {}, deps);
  assert.deepEqual([r1.failed, r1.fail_kinds], [1, { ai: 1, rule: 0, structure: 0 }]);
  // 규칙 불통과 + 구조 이상
  const s2 = setup({ step: 10, mod: out => JSON.stringify(out.map(o => ({ ...o, meanings: o.meanings.map(() => ({ definition: '가'.repeat(25) })) }))) });
  s2.db.addRow(1, 'long', oldData('long', ['가']));
  s2.db.addRow(2, 'broken', { word: 'broken', meanings: [{ pos: 'noun', definition: '' }] });
  const r2 = await B.run(9, {}, s2.deps);
  assert.deepEqual([r2.failed, r2.fail_kinds], [2, { ai: 0, rule: 1, structure: 1 }]);
  assert.deepEqual(r2.failed_words.sort(), ['broken', 'long']);
  assert.equal(s2.db.writes, 0);
});
