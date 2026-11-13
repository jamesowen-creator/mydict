// 작업417: 저장된 영어 단어 뜻 일괄 변환(관리자 도구). 가짜 DB·가짜 Anthropic 만 쓰며 실제 호출·운영 DB 접근은 없다.
// 실행: node --test --test-concurrency=3 tests/gloss_backfill417.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.ADMIN_EMAILS = 'u5@example.com';
const { startApp, createAnthropicMock } = require('./helpers/app');
const { createGlossDb, clone } = require('./helpers/gloss_db');
const G = require('../lib/gloss');
const B = require('../lib/gloss_backfill');

// ───── 단계 A: lib/gloss.js ─────
const TABLE_DEFS = ['달리다, 뛰다', '신중하게 검토하다; 정밀 조사하다', '무언가를 살펴보는 것.', '가, 나, 다, 라, 마', '  ', '', 'a,b,c', '한 문장입니다. 다음 문장', '매우매우매우매우매우매우매우매우매우긴대응어항목입니다', '애매한，모호한、불분명한', '뭐?, 좋아', null, 5];
const TABLE_MEANINGS = [
  [{ pos: 'verb', definition: '달리다, 뛰다, 운영하다, 흐르다' }, { pos: 'noun', definition: '운영, 경영' }],
  [{ pos: 'verb', definition: '무언가를 하는 것.' }],
  [{ pos: 'verb', definition: '무언가를 하는 것.' }, { pos: 'noun', definition: '운영, 경영' }, null, 'x', { definition: 3 }],
  [{ pos: 'a', definition: '하나' }, { pos: 'b', definition: '하나' }, { pos: 'c', definition: '둘, 셋' }, { pos: 'd', definition: '넷' }, { pos: 'e', definition: '다섯' }],
  [], null, 'abc',
];

test('A: splitDefinition·validateGloss·deriveShortMeaning 표(규칙 자체)', () => {
  assert.deepEqual(G.splitDefinition('애매한，모호한、불분명한'), ['애매한', '모호한', '불분명한']);
  assert.deepEqual(G.splitDefinition(5), []);
  assert.equal(G.glossItemOk('무언가를 살펴보는 것.'), false);
  assert.equal(G.glossItemOk('가'.repeat(20)), true);
  assert.equal(G.glossItemOk('가'.repeat(21)), false);
  const v = G.validateGloss([{ pos: 'v', definition: '달리다, 뛰다, 운영하다, 흐르다' }, { pos: 'n', definition: '문장이다.' }]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.meanings, [{ pos: 'v', definition: '달리다, 뛰다, 운영하다' }]);   // 뜻당 최대 3개, 무효 뜻 제거
  assert.equal(G.validateGloss([{ definition: '끝.' }]).ok, false);                       // 전부 무효면 실패
  assert.equal(G.deriveShortMeaning([{ definition: '가, 나' }, { definition: '가' }, { definition: '다' }, { definition: '라' }, { definition: '마' }]), '가, 다, 라');   // 첫 항목·중복 제거·최대 3
});

test('A: english_dictionary.html 의 GLOSS-START/END 구간과 같은 입력에서 같은 결과(어긋나면 실패)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'english_dictionary.html'), 'utf8');
  const m = html.match(/\/\/ GLOSS-START\r?\n([\s\S]*?)\/\/ GLOSS-END/);
  assert.ok(m, 'GLOSS 구간을 찾았다');
  const ctx = vm.createContext({});
  vm.runInContext(m[1] + '\nthis.f = { splitDefinition, validateGloss, deriveShortMeaning, glossItemOk };', ctx);
  const H = ctx.f;
  const norm = v => JSON.parse(JSON.stringify(v));
  for (const d of TABLE_DEFS) {
    assert.deepEqual(G.splitDefinition(d), norm(H.splitDefinition(d)), 'split ' + JSON.stringify(d));
    if (typeof d === 'string') assert.equal(G.glossItemOk(d), H.glossItemOk(d), 'itemOk ' + JSON.stringify(d));
  }
  for (const ms of TABLE_MEANINGS) {
    assert.deepEqual(G.validateGloss(ms), norm(H.validateGloss(ms)), 'validate ' + JSON.stringify(ms));
    assert.equal(G.deriveShortMeaning(ms), H.deriveShortMeaning(ms), 'short ' + JSON.stringify(ms));
  }
  assert.equal(G.GLOSS_ITEM_MAX, vm.runInContext('GLOSS_ITEM_MAX', ctx));
  assert.equal(G.GLOSS_PER_MEANING, vm.runInContext('GLOSS_PER_MEANING', ctx));
  assert.equal(G.GLOSS_SHORT_MAX, vm.runInContext('GLOSS_SHORT_MAX', ctx));
});

// ───── 도우미 ─────
const oldData = (word, defs, extra = {}) => ({ word, lang: 'en', pronunciation: '/x/', meanings: defs.map((d, i) => ({ pos: i % 2 ? 'noun' : 'verb', definition: d, domain: '일반' })), short_meaning: defs[0], short_gloss: '옛 짧은 뜻', nuance: '옛 뉘앙스', it: { is_it: false }, ...extra });
// 가짜 모델: 입력 단어마다 "새N" 같은 유효한 definition 을 뜻 개수만큼 돌려준다. mod(entry, inputs)로 일부러 망가뜨릴 수 있다
function fakeModel(mod) {
  const calls = [];
  const callModel = async (uid, inputs) => {
    calls.push(clone(inputs));
    const out = inputs.map(w => ({ id: w.id, meanings: w.meanings.map((m, i) => ({ definition: '새뜻' + w.id + String.fromCharCode(65 + i) + ', 대응' + w.id })) }));
    const res = mod ? mod(out, inputs, calls.length) : out;
    return JSON.stringify(res);
  };
  return { callModel, calls };
}
function setupLib(mod) {
  const db = createGlossDb();
  const ai = fakeModel(mod);
  return { db, ai, deps: { pool: db.pool, trackUsage: db.trackUsage, callModel: ai.callModel } };
}

// ───── 단계 B: 변환 ─────
test('B: 정상 응답 → definition 덮어쓰기·short_meaning·gloss_v=1·short_gloss 제거·pos·뜻 개수·그 밖 필드 보존, 백업 기록', async () => {
  const { db, deps } = setupLib();
  const before = oldData('run', ['달리다', '운영하다']);
  db.addRow(1, 'run', clone(before));
  const r = await B.run(9, {}, deps);
  assert.deepEqual([r.done, r.failed, r.skipped_changed, r.remaining, r.finished, r.calls], [1, 0, 0, 0, true, 1]);
  const d = db.get(1).data;
  assert.equal(d.meanings.length, 2);
  assert.deepEqual(d.meanings.map(m => m.pos), ['verb', 'noun']);
  assert.deepEqual(d.meanings.map(m => m.domain), ['일반', '일반']);
  assert.equal(d.meanings[0].definition, '새뜻1A, 대응1');
  assert.equal(d.short_meaning, '새뜻1A, 새뜻1B');
  assert.equal(d.gloss_v, 1);
  assert.equal('short_gloss' in d, false);
  assert.equal(d.nuance, '옛 뉘앙스'); assert.deepEqual(d.it, { is_it: false }); assert.equal(d.pronunciation, '/x/');
  assert.equal(db.backup.length, 1);
  assert.deepEqual(db.backup[0].before, before);
  assert.deepEqual(db.backup[0].after, d);
  assert.equal(db.backup[0].run_id, r.run_id);
});

test('B: 길이 불일치·id 누락·문장 포함 응답 → 그 단어만 재시도 1회 → 여전히 실패면 건너뜀(표지 없음·쓰기 없음)', async () => {
  const { db, ai, deps } = setupLib((out, inputs, n) => {
    if (n === 1) { out[1].meanings.pop(); out.splice(2, 1); out[2].meanings[0].definition = '문장입니다.'; return out; }   // 단어 2: 뜻 개수 불일치, 단어 3: 누락, 단어 4: 문장
    return out.map(o => (o.id === 4 ? { id: 4, meanings: [{ definition: '여전히 문장.' }] } : o));          // 재시도: 단어 2·3 은 통과, 단어 4 는 계속 실패
  });
  [['a', ['가', '나']], ['b', ['가', '나']], ['c', ['가']], ['d', ['가']]].forEach(([w, defs], i) => db.addRow(i + 1, w, oldData(w, defs)));
  const r = await B.run(9, {}, deps);
  assert.equal(ai.calls.length, 2);
  assert.deepEqual(ai.calls[1].map(w => w.id).sort(), [2, 3, 4], '재시도는 통과 못 한 단어만');
  assert.deepEqual([r.done, r.failed], [3, 1]);
  assert.deepEqual(r.failed_words, ['d']);
  assert.equal('gloss_v' in db.get(4).data, false);
  assert.equal(db.get(4).data.meanings[0].definition, '가');
  assert.equal(db.backup.filter(b => b.wordbook_id === 4).length, 0);
});

test('B: 모델 호출이 예외를 던져도 쓰기 없이 실패로 센다(재시도 1회 포함)', async () => {
  const { db, deps } = setupLib();
  deps.callModel = async () => { throw new Error('down'); };
  db.addRow(1, 'a', oldData('a', ['가']));
  const r = await B.run(9, {}, deps);
  assert.deepEqual([r.done, r.failed], [0, 1]);
  assert.equal(db.writes, 0);
});

test('B: 긴 옛 정의는 그 뜻의 usage_note 가 비었을 때만 옮기고, 있으면 버린다. 짧은 정의는 옮기지 않는다', async () => {
  const { db, deps } = setupLib();
  db.addRow(1, 'a', oldData('a', ['무언가를 천천히 살펴보는 것.', '짧음']));
  const withNote = oldData('b', ['무언가를 천천히 살펴보는 것.']); withNote.meanings[0].usage_note = '이미 있는 설명';
  db.addRow(2, 'b', withNote);
  await B.run(9, {}, deps);
  assert.equal(db.get(1).data.meanings[0].usage_note, '무언가를 천천히 살펴보는 것.');
  assert.equal('usage_note' in db.get(1).data.meanings[1], false);
  assert.equal(db.get(2).data.meanings[0].usage_note, '이미 있는 설명');
});

test('B: 옛 구조(meanings 없음)·이미 gloss_v 있는 행·영어 아닌 행은 대상이 아니고, 옛 구조·변환 건수는 집계된다', async () => {
  const { db, ai, deps } = setupLib();
  db.addRow(1, 'new', oldData('new', ['가']));
  db.addRow(2, 'legacy', { word: 'legacy', definition: '옛 구조' });
  db.addRow(3, 'legacy2', { word: 'legacy2', meanings: [] });
  db.addRow(4, 'done', oldData('done', ['가'], { gloss_v: 1 }));
  db.addRow(5, 'ja', oldData('ja', ['가']), { lang: 'ja' });
  const st = await B.status(deps);
  assert.deepEqual([st.targets, st.legacy, st.converted, st.users], [1, 2, 1, 1]);
  const r = await B.run(9, {}, deps);
  assert.equal(r.done, 1);
  assert.deepEqual(ai.calls[0].map(w => w.id), [1]);
  assert.deepEqual(db.get(2).data, { word: 'legacy', definition: '옛 구조' });
});

test('B: 낙관적 조건 — 읽은 뒤 사용자가 고친 행은 덮어쓰지 않고 건너뜀 건수로 센다(백업도 없음)', async () => {
  const { db, deps } = setupLib();
  db.addRow(1, 'a', oldData('a', ['가']));
  db.addRow(2, 'b', oldData('b', ['가']));
  db.beforeApply = row => { if (row.id === 1) row.data = { ...row.data, nuance: '사용자가 방금 고침' }; };
  const r = await B.run(9, {}, deps);
  assert.deepEqual([r.done, r.skipped_changed, r.failed], [1, 1, 0]);
  assert.equal(db.get(1).data.nuance, '사용자가 방금 고침');
  assert.equal('gloss_v' in db.get(1).data, false);
  assert.deepEqual(db.backup.map(b => b.wordbook_id), [2]);
});

test('B: 이어하기·재실행 멱등 — 두 번째 실행은 대상이 없어 호출·쓰기가 늘지 않는다', async () => {
  const { db, ai, deps } = setupLib();
  for (let i = 1; i <= 3; i++) db.addRow(i, 'w' + i, oldData('w' + i, ['가']));
  await B.run(9, {}, deps);
  const snap = JSON.stringify(db.rows), calls = ai.calls.length, writes = db.writes;
  const r2 = await B.run(9, {}, deps);
  assert.deepEqual([r2.done, r2.failed, r2.calls, r2.remaining, r2.finished], [0, 0, 0, 0, true]);
  assert.equal(ai.calls.length, calls); assert.equal(db.writes, writes); assert.equal(JSON.stringify(db.rows), snap);
});

test('B: 한 요청은 20단어씩 최대 5회(100단어)까지, next_cursor 로 이어서 끝낸다', async () => {
  const { db, ai, deps } = setupLib();
  for (let i = 1; i <= 120; i++) db.addRow(i, 'w' + i, oldData('w' + i, ['가']));
  const r1 = await B.run(9, {}, deps);
  assert.deepEqual([r1.done, r1.remaining, r1.next_cursor, r1.finished, r1.calls], [100, 20, 100, false, 5]);
  assert.ok(ai.calls.every(c => c.length === 20));
  const r2 = await B.run(9, { cursor: r1.next_cursor, runId: r1.run_id }, deps);
  assert.deepEqual([r2.done, r2.remaining, r2.finished, r2.run_id], [20, 0, true, r1.run_id]);
  assert.equal(db.backup.length, 120);
});

test('B: 입력은 id·word·pos·현재 definition 만 담고(개인 정보 없음) 프롬프트에 416 원칙 문구와 덧붙임이 있다', async () => {
  const { db, ai, deps } = setupLib();
  db.addRow(1, 'a', oldData('a', ['가']), { user_id: 77 });
  await B.run(9, {}, deps);
  assert.deepEqual(ai.calls[0], [{ id: 1, word: 'a', meanings: [{ pos: 'verb', definition: '가' }] }]);
  for (const s of ['뜻 표현 원칙: 한국어 뜻은 문장이 아니라', '뜻 개수와 순서를 바꾸지 말 것', 'JSON만']) assert.ok(B.SYSTEM_PROMPT.includes(s), s);
  const eng = fs.readFileSync(path.join(__dirname, '..', 'public', 'english_dictionary.html'), 'utf8');
  assert.ok(eng.includes(B.SYSTEM_PROMPT.split('\n')[1].replace('뜻 표현 원칙:', '- 뜻 표현 원칙:')), '416 원칙 문구와 같다');
});

// ───── status 계산 ─────
test('status: 예상 호출 ceil(N/20), 입력≈호출×300+N×90, 출력≈N×90 토큰, Haiku 단가 1.00/5.00', () => {
  assert.deepEqual(B.estimate(0), { est_calls: 0, est_input_tokens: 0, est_output_tokens: 0, est_cost_usd: 0, cost_estimated: true });
  const e = B.estimate(45);
  assert.deepEqual([e.est_calls, e.est_input_tokens, e.est_output_tokens], [3, 3 * 300 + 45 * 90, 45 * 90]);
  assert.equal(e.est_cost_usd, +((3 * 300 + 45 * 90) / 1e6 * 1 + 45 * 90 / 1e6 * 5).toFixed(4));
  assert.equal(B.estimate(20).est_calls, 1); assert.equal(B.estimate(21).est_calls, 2);
  assert.deepEqual([B.GLOSS_PRICE_IN, B.GLOSS_PRICE_OUT], [1, 5]);
});

// ───── 샘플 ─────
test('sample: DB 쓰기 0·호출 1회·12단어 이하·응답 형식, 긴 정의 단어가 섞인다', async () => {
  const { db, ai, deps } = setupLib();
  for (let i = 1; i <= 30; i++) db.addRow(i, 'w' + i, oldData('w' + i, [i > 24 ? '아주 길게 늘어 쓴 옛 사전식 설명 문장입니다.' : '짧']));
  const snap = JSON.stringify(db.rows);
  const r = await B.sample(9, deps);
  assert.equal(ai.calls.length, 1); assert.equal(r.items.length, 12);
  assert.equal(JSON.stringify(db.rows), snap); assert.equal(db.writes, 0); assert.equal(db.backup.length, 0);
  const it = r.items[0];
  assert.deepEqual(Object.keys(it).sort(), ['after', 'before', 'fail_items', 'id', 'ok', 'reason', 'short_meaning_after', 'word']);
  assert.equal(it.ok, true); assert.ok(Array.isArray(it.before) && Array.isArray(it.after));
  assert.ok(r.items.some(x => x.id > 24), '긴 정의 단어 포함');
  assert.ok(r.items.some(x => x.id <= 24), '무작위 단어 포함');
});

// ───── 되돌리기 ─────
test('restore: 복원 후 원래 data 와 같고, 그 사이 수정된 행은 건너뛴다', async () => {
  const { db, deps } = setupLib();
  const originals = {};
  for (let i = 1; i <= 3; i++) { originals[i] = oldData('w' + i, ['긴 설명 문장입니다.', '둘']); db.addRow(i, 'w' + i, clone(originals[i])); }
  const run = await B.run(9, {}, deps);
  db.get(2).data = { ...db.get(2).data, nuance: '변환 뒤 사용자가 고침' };
  const r = await B.restore({ runId: run.run_id }, deps);
  assert.deepEqual([r.restored, r.skipped, r.finished, r.next_cursor], [2, 1, true, null]);
  assert.deepEqual(db.get(1).data, originals[1]); assert.deepEqual(db.get(3).data, originals[3]);
  assert.equal(db.get(2).data.nuance, '변환 뒤 사용자가 고침'); assert.equal(db.get(2).data.gloss_v, 1);
  const again = await B.restore({ runId: run.run_id }, deps);   // 두 번 돌려도 이미 복원된 행은 건너뜀
  assert.deepEqual([again.restored, again.skipped], [0, 3]);
  const all = await B.restore({}, deps);
  assert.equal(all.restored, 0);
});

// ───── 서버 API: 권한·응답 ─────
async function setupApi(t, mod) {
  const db = createGlossDb();
  const anthropic = createAnthropicMock();
  anthropic.handler = params => JSON.stringify((mod || (x => x))(JSON.parse(params.messages[0].content).map(w => ({ id: w.id, meanings: w.meanings.map((m, i) => ({ definition: '새뜻' + (i + 1) + ', 대응' })) }))));
  const app = await startApp(['routes/gloss.js'], { db, anthropic });
  t.after(() => app.close());
  return { db, anthropic, app, call: (m, p, b, user = 5) => app.call(m, p, b, { user }) };
}

test('권한: 일반 사용자 403, 로그아웃 401, 어떤 API 도 AI 를 부르지 않는다', async t => {
  const { call, anthropic, db } = await setupApi(t);
  db.addRow(1, 'a', oldData('a', ['가']));
  const reqs = [['GET', '/api/admin/gloss/status'], ['POST', '/api/admin/gloss/sample', {}], ['POST', '/api/admin/gloss/run', {}], ['POST', '/api/admin/gloss/restore', { run_id: 'x' }], ['GET', '/api/admin/gloss/backup?run_id=x']];
  for (const [m, p, b] of reqs) {
    assert.equal((await call(m, p, b, 1)).status, 403, 'user ' + p);
    assert.equal((await call(m, p, b, null)).status, 401, 'anon ' + p);
  }
  assert.equal(anthropic.calls.length, 0); assert.equal(db.writes, 0);
  assert.equal((await call('GET', '/api/admin/gloss/status', undefined, 4)).status, 200, 'DB 관리자');
});

test('API: status → sample → run → backup → restore 흐름, 사용량 이벤트 gloss_backfill, 응답에 개인정보 없음', async t => {
  const { call, anthropic, db } = await setupApi(t);
  const orig = oldData('run', ['달리다, 뛰다']);
  db.addRow(1, 'run', clone(orig), { user_id: 42 });
  db.addRow(2, 'old', { word: 'old' });
  const st = await call('GET', '/api/admin/gloss/status');
  assert.equal(st.status, 200);
  assert.deepEqual([st.body.targets, st.body.legacy, st.body.converted, st.body.users, st.body.est_calls], [1, 1, 0, 1, 1]);
  assert.equal(st.body.cost_estimated, true);
  const sm = await call('POST', '/api/admin/gloss/sample', {});
  assert.equal(sm.status, 200); assert.equal(anthropic.calls.length, 1); assert.equal(db.writes, 0);
  assert.deepEqual(sm.body.items[0].before, ['달리다, 뛰다']); assert.deepEqual(sm.body.items[0].after, ['새뜻1, 대응']);
  const run = await call('POST', '/api/admin/gloss/run', { cursor: 0 });
  assert.equal(run.status, 200);
  assert.deepEqual([run.body.done, run.body.failed, run.body.skipped_changed, run.body.remaining], [1, 0, 0, 0]);
  assert.deepEqual(db.usage.map(u => [u.event_type, u.user_id]), [['gloss_backfill', 5], ['gloss_backfill', 5]]);
  const bk = await call('GET', '/api/admin/gloss/backup?run_id=' + run.body.run_id);
  assert.equal(bk.status, 200); assert.equal(bk.body.rows.length, 1); assert.deepEqual(bk.body.rows[0].before, orig);
  for (const body of [st.body, sm.body, run.body, bk.body]) assert.ok(!/@|email|"name"|user_id/i.test(JSON.stringify(body)), '개인정보 키 없음');
  const rs = await call('POST', '/api/admin/gloss/restore', { run_id: run.body.run_id });
  assert.deepEqual([rs.body.restored, rs.body.skipped], [1, 0]);
  assert.deepEqual(db.get(1).data, orig);
});

test('API: 잘못된 입력은 400 이고 쓰기·AI 호출이 없다', async t => {
  const { call, anthropic, db } = await setupApi(t);
  assert.equal((await call('POST', '/api/admin/gloss/run', { cursor: -1 })).status, 400);
  assert.equal((await call('POST', '/api/admin/gloss/run', { cursor: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/admin/gloss/run', { run_id: '../x' })).status, 400);
  assert.equal((await call('POST', '/api/admin/gloss/restore', {})).status, 400);
  assert.equal((await call('POST', '/api/admin/gloss/restore', { run_id: 'a b' })).status, 400);
  assert.equal((await call('GET', '/api/admin/gloss/backup')).status, 400);
  assert.equal(anthropic.calls.length, 0); assert.equal(db.writes, 0);
});

test('비용 목록: routes/admin.js calcCost 가 gloss_backfill 을 Anthropic 비용으로 센다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.ok(/r\.event_type === 'gloss_backfill'/.test(src));
});
