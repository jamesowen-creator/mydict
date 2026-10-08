// 작업214-2: 음성 학습 자료 연결 지도 — 조회·편집 API, 사용자 연결 보호 규칙, 지도 그리기(build), VOICE_LINK_AUTO.
// 실행: node --test "tests/**/*.test.js"   (Anthropic·DB는 모의)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createMockDb } = require('./helpers/mock_db');
const { startApp, createAnthropicMock } = require('./helpers/app');

const sha = t => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setup() {
  const db = createMockDb();
  db.addUser(7); db.addUser(8);
  const anthropic = createAnthropicMock();
  const t = await startApp(['routes/voice_study.js'], { db, anthropic });
  return { db, anthropic, call: t.call, close: t.close };
}
let envSaved = {};
function setEnv(name, value) {
  if (!(name in envSaved)) envSaved[name] = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}
function restoreEnv() { for (const [k, v] of Object.entries(envSaved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } envSaved = {}; }

// 자료 추가. 같은 과목의 자료끼리 요약 단어가 많이 겹치게 만들어 연결 후보로 뽑히게 한다
let seq = 0;
function addNote(db, { user = 7, subject = '과학', title, summary, transcript, link_hash = null } = {}) {
  const id = db.seq.voice_notes++;
  const n = ++seq;
  const row = {
    id, user_id: user, title: title === undefined ? '자료' + id : title,
    transcript: transcript === undefined ? '원문 광합성 엽록체 포도당 빛에너지 ' + n : transcript,
    summary: summary === undefined ? '광합성 엽록체 포도당 빛에너지 요약 ' + n : summary,
    subject, subject_detail: null, link_hash, keywords: null, merged_from: null, summary_source_hash: null, created_at: new Date(), updated_at: new Date(),
  };
  db.tables.voice_notes.push(row);
  return row;
}
function addLink(db, a, b, extra = {}) {
  const row = {
    id: db.seq.voice_links++, user_id: a.user_id, from_note_id: a.id, to_note_id: b.id,
    from_hash: sha(a.summary), to_hash: sha(b.summary), kind: 'background', relation: '관련', quote_from: '', quote_to: '',
    source: 'ai', user_edited: false, hidden: false, created_at: new Date(), ...extra,
  };
  db.tables.voice_links.push(row);
  return row;
}
// 후보로 들어온 자료 전부에 연결을 제안하는 모의 모델(프롬프트의 "[후보 n] id=…"를 읽는다)
function proposeAll(anthropic, { relation = '두 자료는 광합성 과정으로 이어집니다' } = {}) {
  anthropic.handler = params => {
    const ids = [...params.messages[0].content.matchAll(/\[후보 \d+\] id=(\d+)/g)].map(m => Number(m[1]));
    return JSON.stringify({ links: ids.map(id => ({ target_id: id, kind: 'background', relation, quote_self: '', quote_target: '' })), keywords: [] });
  };
}
const linkRows = db => db.tables.voice_links.map(l => ({ ...l }));
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(15); }
  throw new Error('waitFor 시간 초과');
}
const M = '/api/voice-notes/map';

test.afterEach(() => restoreEnv());

// ───────────────────────── 조회 ─────────────────────────
test('GET map: 과목 필수·7개 과목 외 400, 401, 403, 노드는 그 과목 자료 전체(연결 없는 자료 포함)이고 본인 것만', async () => {
  const { db, anthropic, call, close } = await setup();
  const a = addNote(db), b = addNote(db), lonely = addNote(db, { summary: '' });
  addNote(db, { subject: '국어' }); addNote(db, { user: 8 });
  addLink(db, a, b);
  assert.equal((await call('GET', M)).status, 400);
  assert.equal((await call('GET', M + '?subject=' + encodeURIComponent('없는과목'))).status, 400);
  assert.equal((await call('GET', M + '?subject=' + encodeURIComponent('과학'), undefined, { user: null })).status, 401);
  db.tables.users.find(u => u.id === 8).perm_voice_study = false;
  assert.equal((await call('GET', M + '?subject=' + encodeURIComponent('과학'), undefined, { user: 8 })).status, 403);
  const r = await call('GET', M + '?subject=' + encodeURIComponent('과학'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.nodes.map(n => n.id), [a.id, b.id, lonely.id], '연결 없는 자료도 노드로 나옴, 다른 과목·다른 사용자 자료 없음');
  assert.deepEqual(r.body.nodes.map(n => n.has_summary), [true, true, false]);
  assert.deepEqual(Object.keys(r.body.nodes[0]).sort(), ['has_summary', 'id', 'subject', 'title']);
  assert.equal(r.body.links.length, 1);
  assert.deepEqual(Object.keys(r.body.links[0]).sort(), ['from_note_id', 'id', 'kind', 'quote_from', 'quote_to', 'relation', 'source', 'to_note_id', 'user_edited']);
  assert.ok(r.body.built_at, '보이는 AI 연결이 있으면 built_at');
  assert.equal(anthropic.calls.length, 0, '조회는 AI를 부르지 않음');
  await close();
});

test('GET map: 다른 사용자의 연결은 안 보이고, 숨긴 연결 제외, 노드는 최대 200개', async () => {
  const { db, call, close } = await setup();
  const a = addNote(db), b = addNote(db), c = addNote(db);
  const mine = addLink(db, a, b);
  addLink(db, a, c, { hidden: true });
  const other8a = addNote(db, { user: 8 }), other8b = addNote(db, { user: 8 });
  addLink(db, other8a, other8b);
  const r = await call('GET', M + '?subject=' + encodeURIComponent('과학'));
  assert.deepEqual(r.body.links.map(l => l.id), [mine.id]);
  for (let i = 0; i < 200; i++) addNote(db, { summary: '요약 ' + i });
  const big = await call('GET', M + '?subject=' + encodeURIComponent('과학'));
  assert.equal(big.body.nodes.length, 200);
  await close();
});

test('요약 해시가 안 맞으면 AI 연결은 숨고 사용자 연결(source=user 또는 user_edited)은 항상 보임 — 지도와 자료 연결 목록 모두', async () => {
  const { db, call, close } = await setup();
  const a = addNote(db), b = addNote(db), c = addNote(db), d = addNote(db);
  const ai = addLink(db, a, b), mine = addLink(db, a, c, { source: 'user', kind: 'manual' }), edited = addLink(db, a, d, { user_edited: true });
  // a의 요약이 바뀌었다 → 저장 당시 해시와 달라짐
  a.summary = '광합성 엽록체 포도당 빛에너지 요약을 새로 고침';
  let r = await call('GET', M + '?subject=' + encodeURIComponent('과학'));
  assert.deepEqual(r.body.links.map(l => l.id).sort(), [mine.id, edited.id].sort(), 'AI 연결은 숨고 사용자 연결은 보임');
  r = await call('GET', `/api/voice-notes/${a.id}/links`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.links.map(l => l.note_id).sort(), [c.id, d.id].sort());
  const mineOut = r.body.links.find(l => l.note_id === c.id);
  assert.deepEqual([mineOut.id, mineOut.source, mineOut.user_edited], [mine.id, 'user', false]);
  assert.equal(r.body.status, 'pending', '분석 상태 표시는 기존 규칙 그대로');
  assert.ok(!r.body.links.some(l => l.note_id === b.id));
  // 숨긴 연결은 어느 경우에도 안 보임
  edited.hidden = true; mine.hidden = true;
  r = await call('GET', `/api/voice-notes/${a.id}/links`);
  assert.deepEqual(r.body.links, []);
  await close();
});

test('GET /:id/links: 요약이 없는 자료에도 사용자 연결은 보이고(status none), AI 연결은 안 보임', async () => {
  const { db, call, close } = await setup();
  const a = addNote(db, { summary: '' }), b = addNote(db), c = addNote(db);
  addLink(db, a, b, { from_hash: sha(''), to_hash: sha(b.summary) });
  const mine = addLink(db, a, c, { source: 'user', kind: 'manual' });
  const r = await call('GET', `/api/voice-notes/${a.id}/links`);
  assert.equal(r.body.status, 'none');
  assert.deepEqual(r.body.links.map(l => l.id), [mine.id]);
  await close();
});

// ───────────────────────── 편집 ─────────────────────────
test('POST links: 소유권 404, 같은 자료 400, 다른 과목 400, 관계 80자 초과 400, 정상 201(kind=manual, source=user)', async () => {
  const { db, anthropic, call, close } = await setup();
  const a = addNote(db), b = addNote(db), other = addNote(db, { subject: '국어' }), theirs = addNote(db, { user: 8 });
  const url = '/api/voice-notes/links';
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: b.id }, { user: null })).status, 401);
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: a.id })).status, 400);
  assert.equal((await call('POST', url, { from_note_id: 'a', to_note_id: b.id })).status, 400);
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: theirs.id })).status, 404, '남의 자료');
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: 99999 })).status, 404);
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: other.id })).status, 400, '다른 과목');
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: b.id, relation: '가'.repeat(81) })).status, 400);
  assert.equal(db.tables.voice_links.length, 0);
  const r = await call('POST', url, { from_note_id: a.id, to_note_id: b.id, relation: '  내가   직접 이은 이유  ' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.from_note_id, r.body.to_note_id, r.body.kind, r.body.relation, r.body.source, r.body.user_edited, r.body.quote_from, r.body.quote_to],
    [a.id, b.id, 'manual', '내가 직접 이은 이유', 'user', false, '', '']);
  assert.ok(!('hidden' in r.body), '응답에 내부 값 노출 없음');
  const ok80 = await call('POST', url, { from_note_id: b.id, to_note_id: addNote(db).id, relation: '가'.repeat(80) });
  assert.equal(ok80.status, 201, '80자는 통과');
  assert.equal(anthropic.calls.length, 0, 'AI 호출 없음');
  await close();
});

test('POST links: 같은 쌍은 방향과 무관하게 409, 숨긴(지운) AI 연결이나 요약이 바뀌어 안 보이던 옛 연결은 되살려 사용자 연결로', async () => {
  const { db, call, close } = await setup();
  const a = addNote(db), b = addNote(db), c = addNote(db), d = addNote(db);
  const url = '/api/voice-notes/links';
  addLink(db, a, b);                                    // 보이는 AI 연결
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: b.id })).status, 409);
  assert.equal((await call('POST', url, { from_note_id: b.id, to_note_id: a.id })).status, 409, '반대 방향도 같은 쌍');
  const hid = addLink(db, a, c, { hidden: true, relation: 'AI가 만든 옛 문구', quote_from: 'x' });
  const r = await call('POST', url, { from_note_id: c.id, to_note_id: a.id, relation: '다시 이음' });
  assert.equal(r.status, 201);
  assert.equal(r.body.id, hid.id, '새 행을 만들지 않고 되살림');
  assert.deepEqual([r.body.source, r.body.user_edited, r.body.kind, r.body.relation, r.body.from_note_id, r.body.quote_from], ['user', true, 'manual', '다시 이음', c.id, '']);
  assert.equal(db.tables.voice_links.find(l => l.id === hid.id).hidden, false);
  assert.equal(db.tables.voice_links.length, 2);
  // 요약이 바뀌어 지도에서 사라진 옛 AI 연결이 있어도 직접 이을 수 있다(409가 아님)
  const stale = addLink(db, a, d);
  d.summary = '완전히 새로 쓴 요약';
  const r2 = await call('POST', url, { from_note_id: a.id, to_note_id: d.id });
  assert.equal(r2.status, 201);
  assert.equal(r2.body.id, stale.id);
  assert.equal((await call('POST', url, { from_note_id: a.id, to_note_id: d.id })).status, 409, '이제는 보이는 연결이라 중복');
  await close();
});

test('PATCH links: 관계 설명 수정·방향 바꾸기, user_edited=true, source 유지, 80자 초과 400, 내용 없음 400', async () => {
  const { db, call, close } = await setup();
  const a = addNote(db), b = addNote(db);
  const l = addLink(db, a, b, { kind: 'grounded', quote_from: '앞 구절 열 글자 이상', quote_to: '뒤 구절 열 글자 이상' });
  const url = `/api/voice-notes/links/${l.id}`;
  assert.equal((await call('PATCH', url, {})).status, 400);
  assert.equal((await call('PATCH', url, { swap: false })).status, 400);
  assert.equal((await call('PATCH', url, { swap: 'yes' })).status, 400);
  assert.equal((await call('PATCH', url, { relation: '가'.repeat(81) })).status, 400);
  assert.equal((await call('PATCH', url, { relation: 5 })).status, 400);
  assert.equal(db.tables.voice_links[0].user_edited, false, '실패하면 바뀌지 않음');
  let r = await call('PATCH', url, { relation: '내가 고친 문구' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.relation, r.body.source, r.body.user_edited, r.body.from_note_id, r.body.to_note_id, r.body.kind], ['내가 고친 문구', 'ai', true, a.id, b.id, 'grounded']);
  r = await call('PATCH', url, { swap: true });
  assert.deepEqual([r.body.from_note_id, r.body.to_note_id, r.body.relation], [b.id, a.id, '내가 고친 문구']);
  r = await call('PATCH', url, { swap: true, relation: '가'.repeat(80) });
  assert.deepEqual([r.body.from_note_id, r.body.to_note_id], [a.id, b.id]);
  assert.equal(db.tables.voice_links.length, 1, '행 수 불변(쌍 중복 없음)');
  await close();
});

test('PATCH·DELETE links: 남의 연결·없는 연결·숨긴 연결은 404, 401', async () => {
  const { db, call, close } = await setup();
  const a = addNote(db), b = addNote(db), x = addNote(db, { user: 8 }), y = addNote(db, { user: 8 });
  const mine = addLink(db, a, b), theirs = addLink(db, x, y), gone = addLink(db, b, a, { hidden: true });
  for (const [method, body] of [['PATCH', { relation: 'x' }], ['DELETE', undefined]]) {
    assert.equal((await call(method, `/api/voice-notes/links/${theirs.id}`, body)).status, 404, method + ' 남의 연결');
    assert.equal((await call(method, '/api/voice-notes/links/999999', body)).status, 404);
    assert.equal((await call(method, '/api/voice-notes/links/abc', body)).status, 404);
    assert.equal((await call(method, `/api/voice-notes/links/${gone.id}`, body)).status, 404, method + ' 숨긴 연결');
    assert.equal((await call(method, `/api/voice-notes/links/${mine.id}`, body, { user: null })).status, 401);
  }
  assert.deepEqual(db.tables.voice_links.map(l => [l.id, l.hidden, l.user_edited]), [[mine.id, false, false], [theirs.id, false, false], [gone.id, true, false]]);
  await close();
});

test('DELETE links: 사용자 연결은 실제 삭제, AI 연결은 hidden=true(행은 남음), 지도에서 사라짐', async () => {
  const { db, anthropic, call, close } = await setup();
  const a = addNote(db), b = addNote(db), c = addNote(db);
  const ai = addLink(db, a, b), mine = addLink(db, a, c, { source: 'user', kind: 'manual' });
  let r = await call('DELETE', `/api/voice-notes/links/${mine.id}`);
  assert.deepEqual(r.body, { ok: true, deleted: true });
  assert.ok(!db.tables.voice_links.some(l => l.id === mine.id));
  r = await call('DELETE', `/api/voice-notes/links/${ai.id}`);
  assert.deepEqual(r.body, { ok: true, hidden: true });
  assert.equal(db.tables.voice_links.find(l => l.id === ai.id).hidden, true);
  assert.deepEqual((await call('GET', M + '?subject=' + encodeURIComponent('과학'))).body.links, []);
  assert.equal((await call('DELETE', `/api/voice-notes/links/${ai.id}`)).status, 404, '이미 지운 연결');
  assert.equal(anthropic.calls.length, 0);
  await close();
});

// ───────────────────────── 재분석 규칙 ─────────────────────────
test('재분석: 사용자 연결·고친 연결·숨긴 연결은 그대로 두고(방향이 달라도) 같은 쌍은 새로 만들지 않으며, 순수 AI 연결만 지움', async () => {
  const { db, anthropic, call, close } = await setup();
  const a = addNote(db, { summary: '광합성 엽록체 포도당 빛에너지 요약 핵심 단어 많이 겹침 가나다' });
  const mk = n => addNote(db, { summary: '광합성 엽록체 포도당 빛에너지 요약 핵심 단어 많이 겹침 가나다 ' + n });
  const b = mk('b'), c = mk('c'), d = mk('d'), e = addNote(db, { summary: '광합성 엽록체 요약 적게 겹침' });
  const userRev = addLink(db, b, a, { source: 'user', kind: 'manual', relation: '내가 이음' });     // b→a (반대 방향)
  const edited = addLink(db, a, c, { user_edited: true, relation: '내가 고침' });
  const hidden = addLink(db, d, a, { hidden: true, relation: '지움' });
  const plain = addLink(db, a, e, { relation: '그냥 AI' });                                          // 이번 분석의 후보가 아니라 지워질 연결
  const before = linkRows(db).filter(l => l.id !== plain.id);
  proposeAll(anthropic);
  assert.equal((await call('POST', `/api/voice-notes/${a.id}/links/refresh`)).status, 202);
  await waitFor(() => db.tables.voice_notes.find(n => n.id === a.id).link_hash === sha(a.summary));
  assert.equal(anthropic.calls.length, 1);
  assert.deepEqual(linkRows(db), before, '보호 대상 행은 한 글자도 안 바뀌고, 같은 쌍의 새 연결도 없으며, 후보가 아닌 순수 AI 연결은 지워짐');
  assert.ok(!db.tables.voice_links.some(l => l.id === plain.id));
  assert.equal(userRev.relation, '내가 이음');
  void edited; void hidden;
  await close();
});

test('재분석: 새 쌍은 source=ai로 추가되고, 요약이 바뀌어 안 보이던 옛 AI 연결은 같은 쌍을 막지 않음', async () => {
  const { db, anthropic, call, close } = await setup();
  const a = addNote(db, { summary: '광합성 엽록체 포도당 빛에너지 요약 핵심 단어 많이 겹침 가나다' });
  const x = addNote(db, { summary: '광합성 엽록체 포도당 빛에너지 요약 핵심 단어 많이 겹침 가나다 x' });
  const y = addNote(db, { summary: '광합성 엽록체 포도당 빛에너지 요약 핵심 단어 많이 겹침 가나다 y' });
  const stale = addLink(db, x, a, { from_hash: 'old', to_hash: 'old' });   // x→a, 요약이 바뀌기 전 것(지금은 안 보임)
  proposeAll(anthropic);
  assert.equal((await call('POST', `/api/voice-notes/${a.id}/links/refresh`)).status, 202);
  await waitFor(() => db.tables.voice_notes.find(n => n.id === a.id).link_hash === sha(a.summary));
  const fresh = db.tables.voice_links.filter(l => l.id !== stale.id);
  assert.deepEqual(fresh.map(l => [l.from_note_id, l.to_note_id, l.source, l.user_edited, l.hidden]).sort(), [[a.id, x.id, 'ai', false, false], [a.id, y.id, 'ai', false, false]].sort());
  assert.equal(db.tables.voice_links.find(l => l.id === stale.id).from_hash, 'old', '옛 행은 건드리지 않음');
  await close();
});

// ───────────────────────── VOICE_LINK_AUTO ─────────────────────────
test('VOICE_LINK_AUTO: 기본(값 없음·off 아님)은 저장·수정 때 자동 분석을 예약하고, off면 예약하지 않으며 수동 재생성은 동작', async () => {
  for (const mode of [undefined, 'on', 'off']) {
    setEnv('VOICE_LINK_AUTO', mode);
    const { db, anthropic, call, close } = await setup();
    proposeAll(anthropic);
    const created = await call('POST', '/api/voice-notes', { title: 't', transcript: '원문 광합성 엽록체', summary: '광합성 엽록체 요약', subject: '과학' });
    assert.equal(created.status, 201, String(mode));
    await sleep(150);
    const autoCalls = anthropic.calls.length;
    const patched = await call('PATCH', `/api/voice-notes/${created.body.id}`, { summary: '광합성 엽록체 요약을 고침' });
    assert.equal(patched.status, 200);
    await sleep(150);
    if (mode === 'off') {
      assert.equal(autoCalls, 0, '저장해도 자동 분석 없음');
      assert.equal(anthropic.calls.length, 0, '수정해도 자동 분석 없음');
      assert.equal(db.tables.api_usage.filter(u => u.event_type === 'link').length, 0);
      const r = await call('POST', `/api/voice-notes/${created.body.id}/links/refresh`);
      assert.equal(r.status, 202, '수동 재생성은 동작');
      await waitFor(() => anthropic.calls.length === 1);
    } else {
      assert.ok(autoCalls >= 1, '저장하면 자동 분석: ' + mode);
      assert.ok(anthropic.calls.length >= 2, '수정해도 자동 분석: ' + mode);
    }
    await close();
  }
});

// ───────────────────────── 지도 그리기 ─────────────────────────
function seedSubject(db, n, { subject = '과학', user = 7 } = {}) {
  return Array.from({ length: n }, (_, i) => addNote(db, { user, subject, summary: '광합성 엽록체 포도당 빛에너지 요약 핵심 단어 겹침 ' + i + ' ' + seq }));
}
const BUILD = '/api/voice-notes/map/build';
const STATUS = s => '/api/voice-notes/map/build-status?subject=' + encodeURIComponent(s);
const SUBJ = '과학';

test('build: 과목 오류 400, dry_run 값 오류 400, 401, 키 없으면 503(dry_run은 키 없이도 가능), 요약 있는 자료 3개 미만이면 400', async () => {
  const { db, anthropic, call, close } = await setup();
  seedSubject(db, 2); addNote(db, { summary: '' }); addNote(db, { summary: '   ' });
  assert.equal((await call('POST', BUILD, { subject: '없는과목' })).status, 400);
  assert.equal((await call('POST', BUILD, {})).status, 400);
  assert.equal((await call('POST', BUILD, { subject: SUBJ, dry_run: 'yes' })).status, 400);
  assert.equal((await call('POST', BUILD, { subject: SUBJ }, { user: null })).status, 401);
  const r = await call('POST', BUILD, { subject: SUBJ });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /3개 이상/);
  setEnv('ANTHROPIC_API_KEY', undefined);
  assert.equal((await call('POST', BUILD, { subject: SUBJ })).status, 503);
  const dry = await call('POST', BUILD, { subject: SUBJ, dry_run: true });
  assert.equal(dry.status, 200, '견적은 키 없이도');
  assert.equal(dry.body.eligible_notes, 2); assert.equal(dry.body.total_notes, 4);
  assert.equal(anthropic.calls.length, 0);
  assert.equal((await call('GET', STATUS('없는과목'))).status, 400);
  await close();
});

test('build dry_run: AI 호출 0회, 대상·호출 수·견적 문구(추정 명시)를 돌려주고 사용량·진행 상태·연결을 바꾸지 않음', async () => {
  const { db, anthropic, call, close } = await setup();
  const notes = seedSubject(db, 5);
  notes[0].link_hash = sha(notes[0].summary);           // 이미 분석된 자료는 대상이 아님
  const usageBefore = db.tables.api_usage.length;
  const r = await call('POST', BUILD, { subject: SUBJ, dry_run: true });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.total_notes, r.body.eligible_notes, r.body.targets, r.body.est_calls, r.body.carry_over, r.body.max_per_run], [5, 5, 4, 4, 0, 50]);
  assert.ok(r.body.est_input_chars > 0);
  assert.match(r.body.est_cost_note, /추정/);
  assert.match(r.body.est_cost_note, /\$/);
  assert.equal(anthropic.calls.length, 0);
  assert.equal(db.tables.api_usage.length, usageBefore, '사용량 기록 없음');
  assert.equal(db.tables.voice_links.length, 0);
  assert.equal((await call('GET', STATUS(SUBJ))).body.status, 'idle');
  await close();
});

test('build: 202 후 순서대로 기존 분석을 돌려 연결을 만들고(link 이벤트 기록), 끝나면 상태가 done, 같은 해시 자료는 건너뜀', async () => {
  const { db, anthropic, call, close } = await setup();
  const notes = seedSubject(db, 4);
  notes[3].link_hash = sha(notes[3].summary);           // 건너뛸 자료
  proposeAll(anthropic);
  const r = await call('POST', BUILD, { subject: SUBJ });
  assert.equal(r.status, 202);
  assert.deepEqual([r.body.started, r.body.targets, r.body.will_process, r.body.carry_over], [true, 3, 3, 0]);
  await waitFor(async () => (await call('GET', STATUS(SUBJ))).body.status === 'done');
  const st = (await call('GET', STATUS(SUBJ))).body;
  assert.deepEqual([st.status, st.done, st.total], ['done', 3, 3]);
  assert.ok(st.links_added >= 1 && st.built_at);
  assert.equal(anthropic.calls.length, 3, '대상 자료마다 기존 분석 1회');
  assert.ok(anthropic.calls.every(c => c.model === 'claude-haiku-4-5-20251001'));
  assert.ok(anthropic.calls.every(c => typeof c.system === 'string' && c.system.startsWith('당신은 학습 자료 연결 도우미입니다')), '기존 분석 프롬프트 그대로');
  assert.equal(db.tables.api_usage.filter(u => u.event_type === 'link').length, 3, '비용 이벤트 link(기존 분석과 같음)');
  assert.equal(db.tables.api_usage.filter(u => u.event_type === 'link_build').length, 1, '시작 표시 link_build 1건');
  assert.ok(notes.slice(0, 3).every(n => db.tables.voice_notes.find(x => x.id === n.id).link_hash === sha(n.summary)));
  assert.ok(db.tables.voice_links.every(l => l.source === 'ai'));
  const map = await call('GET', M + '?subject=' + encodeURIComponent(SUBJ));
  assert.ok(map.body.links.length >= 1 && map.body.built_at);
  // 다시 그리면 새로 분석할 자료가 없어 AI를 부르지 않고 일일 상한도 쓰지 않음
  const again = await call('POST', BUILD, { subject: SUBJ });
  assert.equal(again.status, 200);
  assert.deepEqual([again.body.started, again.body.targets], [false, 0]);
  assert.equal(anthropic.calls.length, 3);
  assert.equal(db.tables.api_usage.filter(u => u.event_type === 'link_build').length, 1);
  await close();
});

test('build: 보호 규칙 — 사용자·고친·숨긴 연결을 건드리지 않고 같은 쌍은 새로 만들지 않음', async () => {
  const { db, anthropic, call, close } = await setup();
  const [a, b, c, d] = seedSubject(db, 4);
  const u = addLink(db, a, b, { source: 'user', kind: 'manual', relation: '내가 이음' });
  const e = addLink(db, c, a, { user_edited: true, relation: '내가 고침' });
  const h = addLink(db, d, b, { hidden: true });
  const protectedBefore = [u, e, h].map(l => ({ ...l }));
  proposeAll(anthropic);
  assert.equal((await call('POST', BUILD, { subject: SUBJ })).status, 202);
  await waitFor(async () => (await call('GET', STATUS(SUBJ))).body.status === 'done');
  assert.deepEqual(db.tables.voice_links.filter(l => [u.id, e.id, h.id].includes(l.id)), protectedBefore);
  const pairs = db.tables.voice_links.map(l => [Math.min(l.from_note_id, l.to_note_id), Math.max(l.from_note_id, l.to_note_id)].join('-'));
  assert.equal(new Set(pairs).size, pairs.length, '같은 쌍(양방향)이 두 번 생기지 않음');
  await close();
});

test('build: 진행 중이면 409(같은 과목), 다른 과목은 별개', async () => {
  const { db, anthropic, call, close } = await setup();
  seedSubject(db, 3);
  let release;
  const gate = new Promise(r => { release = r; });
  anthropic.handler = async () => { await gate; return JSON.stringify({ links: [], keywords: [] }); };
  assert.equal((await call('POST', BUILD, { subject: SUBJ })).status, 202);
  await waitFor(() => anthropic.calls.length === 1);
  assert.equal((await call('GET', STATUS(SUBJ))).body.status, 'running');
  const second = await call('POST', BUILD, { subject: SUBJ });
  assert.equal(second.status, 409);
  assert.equal(db.tables.api_usage.filter(u => u.event_type === 'link_build').length, 1, '409는 일일 상한을 쓰지 않음');
  release();
  await waitFor(async () => (await call('GET', STATUS(SUBJ))).body.status === 'done');
  await close();
});

test('build: 하루 빌드 상한(기본 5, VOICE_MAP_BUILD_DAILY_CAP) 초과는 429', async () => {
  setEnv('VOICE_MAP_BUILD_DAILY_CAP', '2');
  const { db, anthropic, call, close } = await setup();
  const notes = seedSubject(db, 3);
  anthropic.handler = () => JSON.stringify({ links: [], keywords: [] });
  for (let i = 0; i < 2; i++) {
    notes.forEach(n => { n.link_hash = null; });        // 매번 대상이 되게
    assert.equal((await call('POST', BUILD, { subject: SUBJ })).status, 202, '빌드 ' + (i + 1));
    await waitFor(async () => (await call('GET', STATUS(SUBJ))).body.status === 'done');
  }
  notes.forEach(n => { n.link_hash = null; });
  const r = await call('POST', BUILD, { subject: SUBJ });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /하루 2번/);
  // 다른 사용자는 영향 없음
  const other = seedSubject(db, 3, { user: 8 });
  assert.equal(other.length, 3);
  assert.equal((await call('POST', BUILD, { subject: SUBJ }, { user: 8 })).status, 202);
  await close();
});

test('build: 한 번에 처리 상한(VOICE_MAP_BUILD_MAX)을 넘는 자료는 이월 표시, 다음 실행에서 이어서 처리', async () => {
  setEnv('VOICE_MAP_BUILD_MAX', '2');
  const { db, anthropic, call, close } = await setup();
  seedSubject(db, 5);
  anthropic.handler = () => JSON.stringify({ links: [], keywords: [] });
  const dry = await call('POST', BUILD, { subject: SUBJ, dry_run: true });
  assert.deepEqual([dry.body.targets, dry.body.est_calls, dry.body.carry_over, dry.body.max_per_run], [5, 2, 3, 2]);
  const r = await call('POST', BUILD, { subject: SUBJ });
  assert.equal(r.status, 202);
  assert.deepEqual([r.body.targets, r.body.will_process, r.body.carry_over], [5, 2, 3]);
  assert.match(r.body.message, /나머지 3개/);
  await waitFor(async () => (await call('GET', STATUS(SUBJ))).body.status === 'done');
  const st = (await call('GET', STATUS(SUBJ))).body;
  assert.deepEqual([st.done, st.total, st.carry_over], [2, 2, 3]);
  assert.equal(anthropic.calls.length, 2);
  const next = await call('POST', BUILD, { subject: SUBJ });
  assert.deepEqual([next.body.targets, next.body.will_process, next.body.carry_over], [3, 2, 1], '이어서 처리');
  await close();
});

test('build: 기존 하루 분석 한도(link 30건)와 같은 이벤트를 쓰므로 한도가 차면 429(상한은 소모하지 않음), 견적에도 남은 횟수 표시', async () => {
  const { db, anthropic, call, close } = await setup();
  seedSubject(db, 3);
  for (let i = 0; i < 30; i++) db.trackUsage(7, 'link', 'claude-haiku-4-5-20251001', 10, 10, 0);
  const dry = await call('POST', BUILD, { subject: SUBJ, dry_run: true });
  assert.deepEqual([dry.body.daily_link_remaining, dry.body.est_calls, dry.body.carry_over], [0, 0, 3]);
  const r = await call('POST', BUILD, { subject: SUBJ });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /30건/);
  assert.equal(db.tables.api_usage.filter(u => u.event_type === 'link_build').length, 0);
  assert.equal(anthropic.calls.length, 0);
  await close();
});

test('build: 분석이 오류로 끝나도 상태는 마무리되고(errors 기록) 서버는 계속 동작', async () => {
  const { db, anthropic, call, close } = await setup();
  seedSubject(db, 3);
  anthropic.handler = () => { throw new Error('boom'); };
  assert.equal((await call('POST', BUILD, { subject: SUBJ })).status, 202);
  await waitFor(async () => ['done', 'error'].includes((await call('GET', STATUS(SUBJ))).body.status));
  const st = (await call('GET', STATUS(SUBJ))).body;
  assert.equal(st.status, 'error');
  assert.equal(st.errors, 3);
  assert.equal(db.tables.voice_links.length, 0);
  await close();
});

test('조회·편집 API 전체가 Anthropic을 한 번도 부르지 않음(지도를 열 때마다 AI 호출하는 경로 없음)', async () => {
  const { db, anthropic, call, close } = await setup();
  const [a, b, c] = seedSubject(db, 3);
  const l = addLink(db, a, b);
  await call('GET', M + '?subject=' + encodeURIComponent(SUBJ));
  await call('GET', `/api/voice-notes/${a.id}/links`);
  await call('GET', STATUS(SUBJ));
  const created = await call('POST', '/api/voice-notes/links', { from_note_id: a.id, to_note_id: c.id, relation: 'x' });
  await call('PATCH', `/api/voice-notes/links/${created.body.id}`, { swap: true });
  await call('DELETE', `/api/voice-notes/links/${l.id}`);
  await call('POST', BUILD, { subject: SUBJ, dry_run: true });
  assert.equal(anthropic.calls.length, 0);
  await close();
});
