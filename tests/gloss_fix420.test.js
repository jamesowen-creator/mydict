// 작업420: 417 변환 실패 보완 — 고유명사·설명형 풀이 프롬프트 규칙, 재시도에 실패 이유 전달, 샘플 단어 지정·실패 이유 표시.
// 가짜 DB·가짜 Anthropic 만 쓴다(실제 호출 없음). 실행: node --test --test-concurrency=3 tests/gloss_fix420.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp, createAnthropicMock } = require('./helpers/app');
const { createGlossDb, clone } = require('./helpers/gloss_db');
const B = require('../lib/gloss_backfill');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'english_dictionary.html'), 'utf8');
const oldData = (word, defs) => ({ word, lang: 'en', meanings: defs.map((d, i) => ({ pos: i % 2 ? 'noun' : 'verb', definition: d })), short_meaning: defs[0] });
const LONG = '그리스 신화에서 지혜와 신중함을 맡은 여신의 이름으로 쓰이는 말';   // 20자 초과
const longOf = n => '가'.repeat(n);

// ───── 프롬프트 ─────
test('프롬프트: 변환 프롬프트와 1차 프롬프트에 고유명사 규칙·설명형 풀이 금지가 있고, 기존 416 문구는 그대로', () => {
  assert.match(B.NAME_RULE, /고유명사·브랜드·전문용어·신화·인물·지명은 '무엇인지'를 20자 이내의 짧은 명사구/);
  assert.match(B.NAME_RULE, /Metis → 그리스 신화의 지혜의 여신, 캐나다의 혼혈 원주민 집단 \/ wordmark → 글자로만 만든 로고/);
  assert.match(B.NO_DESCRIBE_RULE, /'~하는', '~인', '~것'으로 끝나는 설명형 풀이는 쓰지 말고 대응 단어로/);
  for (const r of [B.NAME_RULE, B.NO_DESCRIBE_RULE]) {
    assert.ok(B.SYSTEM_PROMPT.includes(r), '변환 프롬프트');
    assert.ok(html.includes(r), '1차 프롬프트(english_dictionary.html)');
  }
  const i416 = html.indexOf('- 뜻 표현 원칙: 한국어 뜻은 문장이 아니라');
  assert.ok(i416 > 0 && html.indexOf(B.NAME_RULE) > i416, '416 원칙 문구 뒤에 추가');
  assert.ok(B.SYSTEM_PROMPT.indexOf('뜻 표현 원칙: 한국어 뜻은') < B.SYSTEM_PROMPT.indexOf(B.NAME_RULE));
  for (const s of ['뜻 개수와 순서를 바꾸지 말 것', 'JSON만']) assert.ok(B.SYSTEM_PROMPT.includes(s), s);
});

// ───── 재시도 ─────
function setupLib(handler) {
  const db = createGlossDb();
  const calls = [];
  const callModel = async (uid, inputs, deps, opts) => { calls.push({ inputs: clone(inputs), opts }); return JSON.stringify(handler(inputs, calls.length)); };
  return { db, calls, deps: { pool: db.pool, trackUsage: db.trackUsage, callModel } };
}
const answer = (inputs, defFor) => inputs.map(w => ({ id: w.id, meanings: w.meanings.map((m, i) => ({ definition: defFor(w, i) })) }));

test('재시도: 1차에 20자 초과 → 재시도 입력에 실패 이유가 붙고, 짧은 응답이면 적용(gloss_v=1)', async () => {
  const { db, calls, deps } = setupLib((inputs, n) => answer(inputs, (w, i) => (n === 1 && w.word === 'metis' ? LONG : '새뜻' + w.id + i)));
  db.addRow(1, 'run', oldData('run', ['가']));
  db.addRow(2, 'metis', oldData('metis', ['긴 설명문입니다.']));
  const r = await B.run(9, {}, deps);
  assert.equal(calls.length, 2, '호출 수: 1차 1회 + 재시도 1회');
  assert.equal(calls[0].opts, undefined);
  assert.equal('previous_failure' in calls[0].inputs[0], false, '1차 입력은 그대로');
  assert.deepEqual(calls[1].inputs.map(w => w.id), [2], '재시도는 실패한 단어만');
  assert.deepEqual(calls[1].opts, { retry: true });
  const pf = calls[1].inputs[0].previous_failure;
  assert.equal(pf.reason, '20자 초과');
  assert.deepEqual(pf.items, [{ meaning: 1, text: LONG, reason: '20자 초과' }]);
  assert.deepEqual([r.done, r.failed], [2, 0]);
  assert.equal(db.get(2).data.gloss_v, 1);
  assert.match(B.RETRY_NOTE, /더 짧은 명사구로 다시 쓸 것/);
});

test('재시도: 재시도도 실패하면 건너뜀·쓰기 없음, 호출은 2회를 넘지 않는다. 뜻 개수 불일치·문장 부호 이유도 전달', async () => {
  const { db, calls, deps } = setupLib((inputs, n) => (n === 1
    ? answer(inputs, () => '끝났다.').map(o => (o.id === 2 ? { id: 2, meanings: [] } : o))
    : answer(inputs, () => LONG)));
  db.addRow(1, 'a', oldData('a', ['가']));
  db.addRow(2, 'b', oldData('b', ['가']));
  const r = await B.run(9, {}, deps);
  assert.equal(calls.length, 2);
  const pf = Object.fromEntries(calls[1].inputs.map(w => [w.id, w.previous_failure]));
  assert.equal(pf[1].reason, '문장 부호 포함'); assert.equal(pf[2].reason, '뜻 개수 불일치');
  assert.deepEqual([r.done, r.failed, r.failed_words], [0, 2, ['a', 'b']]);
  assert.equal(db.writes, 0); assert.equal('gloss_v' in db.get(1).data, false);
});

// ───── 샘플: 단어 지정·실패 이유 ─────
test('샘플 words: 지정 단어만(대소문자 무시)·대상 아님은 "대상 없음"·6개 이상은 5개까지·DB 쓰기 0', async () => {
  const { db, calls, deps } = setupLib(inputs => answer(inputs, (w, i) => '새뜻' + w.id));
  db.addRow(1, 'Metis', oldData('Metis', ['가']));
  db.addRow(2, 'other', oldData('other', ['가']));
  db.addRow(3, 'done', { ...oldData('done', ['가']), gloss_v: 1 });
  db.addRow(4, 'legacy', { word: 'legacy' });
  const snap = JSON.stringify(db.rows);
  const r = await B.sample(9, deps, { words: ['metis', 'done', 'legacy', 'nothing'] });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].inputs.map(w => w.id), [1], '지정한 대상 단어만 변환');
  assert.deepEqual(r.items.map(i => [i.word, i.ok, i.reason]), [['Metis', true, ''], ['done', false, '대상 없음'], ['legacy', false, '대상 없음'], ['nothing', false, '대상 없음']]);
  assert.equal(JSON.stringify(db.rows), snap); assert.equal(db.writes, 0);
  const six = await B.sample(9, deps, { words: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.deepEqual(six.items.map(i => i.word), ['a', 'b', 'c', 'd', 'e']);
});

test('샘플 실패 이유: 라벨·실패 항목 최대 3개·원문 60자까지(…)·개인정보 없음', async () => {
  const { db, deps } = setupLib(inputs => answer(inputs, () => [longOf(70), '문장입니다.', longOf(21), '넷째.'].join(', ')));
  db.addRow(1, 'metis', oldData('metis', ['설명']), { user_id: 4242 });
  const r = await B.sample(9, deps, { words: ['metis'] });
  const it = r.items[0];
  assert.deepEqual([it.ok, it.reason, it.after], [false, '20자 초과', []]);
  assert.equal(it.fail_items.length, 3);
  assert.deepEqual(it.fail_items[0], { meaning: 1, text: longOf(60) + '…', reason: '20자 초과' });
  assert.deepEqual(it.fail_items.map(f => f.reason), ['20자 초과', '문장 부호 포함', '20자 초과']);
  assert.ok(!/4242|user_id|email/i.test(JSON.stringify(r)), '개인정보 없음');
  // 해석 실패
  const bad = await B.sample(9, { ...deps, callModel: async () => 'not json' }, { words: ['metis'] });
  assert.deepEqual([bad.items[0].reason, bad.items[0].fail_items], ['응답 해석 실패', []]);
});

// ───── API ─────
async function setupApi(t, handler) {
  const db = createGlossDb();
  const anthropic = createAnthropicMock();
  anthropic.handler = handler;
  const app = await startApp(['routes/gloss.js'], { db, anthropic });
  t.after(() => app.close());
  return { db, anthropic, call: (m, p, b, user = 5) => app.call(m, p, b, { user }) };
}
const echo = n => params => JSON.stringify(JSON.parse(params.messages[0].content).map(w => ({ id: w.id, meanings: w.meanings.map(() => ({ definition: n })) })));

test('API: sample words 대소문자 무시·쉼표 문자열 허용·잘못된 형식 400·관리자 아님 403·로그아웃 401', async t => {
  const { call, db, anthropic } = await setupApi(t, echo('새뜻'));
  db.addRow(1, 'Metis', oldData('Metis', ['가']));
  db.addRow(2, 'wordmark', oldData('wordmark', ['가']));
  const r = await call('POST', '/api/admin/gloss/sample', { words: ['METIS'] });
  assert.equal(r.status, 200); assert.deepEqual(r.body.items.map(i => [i.word, i.ok]), [['Metis', true]]);
  const r2 = await call('POST', '/api/admin/gloss/sample', { words: 'metis, Wordmark ,' });
  assert.deepEqual(r2.body.items.map(i => i.word), ['Metis', 'wordmark']);
  assert.equal(anthropic.calls.length, 2); assert.equal(db.writes, 0);
  for (const bad of [{ words: 5 }, { words: [1] }, { words: [longOf(61)] }, { words: { a: 1 } }]) assert.equal((await call('POST', '/api/admin/gloss/sample', bad)).status, 400, JSON.stringify(bad));
  assert.equal((await call('POST', '/api/admin/gloss/sample', { words: ['metis'] }, 1)).status, 403);
  assert.equal((await call('POST', '/api/admin/gloss/sample', { words: ['metis'] }, null)).status, 401);
  assert.equal(anthropic.calls.length, 2, '거절된 요청은 AI 를 부르지 않는다');
});

test('API: 실제 호출 경로의 재시도 호출은 system 에 재시도 안내가 붙고, 1차에는 붙지 않는다', async t => {
  let n = 0;
  const { call, db, anthropic } = await setupApi(t, params => { n++; return echo(n === 1 ? LONG : '새뜻')(params); });
  db.addRow(1, 'metis', oldData('metis', ['가']));
  const r = await call('POST', '/api/admin/gloss/sample', { words: ['metis'] });
  assert.equal(r.body.items[0].ok, true);
  assert.equal(anthropic.calls.length, 2);
  assert.ok(!anthropic.calls[0].system.includes(B.RETRY_NOTE)); assert.ok(anthropic.calls[1].system.includes(B.RETRY_NOTE));
  assert.ok(anthropic.calls[0].system.includes(B.NAME_RULE) && anthropic.calls[1].system.includes(B.NAME_RULE));
  assert.equal(JSON.parse(anthropic.calls[1].messages[0].content)[0].previous_failure.reason, '20자 초과');
});
