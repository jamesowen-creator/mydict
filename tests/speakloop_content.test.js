// 작업395: Speak Loop 콘텐츠(data/speakloop/content.json) 검증 · 음성 클립 키 · 불량 데이터 거부.
// 실행: node --test tests/speakloop_content.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const C = require('../lib/speakloop_content');
const raw = () => JSON.parse(fs.readFileSync(C.CONTENT_PATH, 'utf8'));

test('실제 콘텐츠: 검증 통과, 이디엄 20 · 독백 10(각 5문장)', () => {
  const content = raw();
  assert.deepEqual(C.validate(content), { ok: true, errors: [] });
  assert.equal(content.idioms.length, 20);
  assert.equal(content.monologues.length, 10);
  for (const m of content.monologues) assert.equal(m.lines.length, 5, m.id);
});

test('클립 330개 = 이디엄 20 + 문장 70 + 구 240, 키는 모두 고유, 글자 합계 8,479', () => {
  const clips = C.listClips();
  assert.equal(clips.length, 330);
  assert.equal(new Set(clips.map(c => c.key)).size, 330);
  const by = k => clips.filter(c => c.kind === k).length;
  assert.deepEqual([by('idiom'), by('sentence'), by('chunk')], [20, 70, 240]);
  assert.equal(clips.reduce((a, c) => a + c.text.length, 0), 8479);
  for (const c of clips) assert.ok(c.text.trim() && C.KINDS.includes(c.kind), c.key);
});

test('키 규칙: <id>.say / <id>.ex / <id>.ex.c<i> / <독백id>.l<i> / <독백id>.l<i>.c<j>', () => {
  const byKey = new Map(C.listClips().map(c => [c.key, c]));
  assert.deepEqual(byKey.get('hang-out.say'), { key: 'hang-out.say', kind: 'idiom', text: 'hang out' });
  assert.deepEqual(byKey.get('hang-out.ex'), { key: 'hang-out.ex', kind: 'sentence', text: 'We used to hang out every weekend.' });
  assert.deepEqual(byKey.get('hang-out.ex.c1'), { key: 'hang-out.ex.c1', kind: 'chunk', text: 'hang out' });
  assert.equal(byKey.get('m-delay.l0').kind, 'sentence');
  assert.equal(byKey.get('m-delay.l0').text, 'Long story short, the launch got pushed back two weeks.');
  assert.deepEqual(byKey.get('m-delay.l0.c1'), { key: 'm-delay.l0.c1', kind: 'chunk', text: 'the launch' });
  assert.ok(C.hasClipKey('m-move.l4.c2') && !C.hasClipKey('hang-out.ex.c9') && !C.hasClipKey('../x') && !C.hasClipKey(''));
});

test('불량 데이터 거부: 구를 이어 붙인 글이 문장과 다름 / 구 개수 범위 밖 / 빈 필드 / id 중복·마침표', () => {
  const bad = fn => { const c = raw(); fn(c); const v = C.validate(c); assert.equal(v.ok, false); return v.errors.join('\n'); };
  assert.match(bad(c => { c.idioms[0].example.chunks[0].en = 'We used'; }), /이어 붙인 글이 문장과 다름/);
  assert.match(bad(c => { c.monologues[0].lines[0].en += ' '; }), /이어 붙인 글이 문장과 다름/);
  assert.match(bad(c => { c.idioms[0].example.chunks = [c.idioms[0].example.chunks[0]]; }), /구는 2~5개/);
  assert.match(bad(c => { const l = c.monologues[0].lines[0]; l.chunks = [...l.chunks, ...l.chunks]; }), /구는 2~5개/);
  assert.match(bad(c => { c.idioms[1].example.chunks[1].ko = ''; }), /ko 가 비어 있음/);
  assert.match(bad(c => { c.idioms[1].example.chunks[1].st = '  '; }), /st 가 비어 있음/);
  assert.match(bad(c => { c.idioms[1].example.chunks[1].en = ''; }), /이어 붙인 글이 문장과 다름|en 가 비어/);
  assert.match(bad(c => { c.idioms[1].id = c.idioms[0].id; }), /id 중복/);
  assert.match(bad(c => { c.monologues[0].id = c.idioms[0].id; }), /id 중복/);
  assert.match(bad(c => { c.idioms[0].id = 'a.b'; }), /마침표/);
  assert.match(bad(c => { c.idioms[0].say = ''; }), /say 가 비어 있음/);
  assert.equal(C.validate(null).ok, false);
  assert.equal(C.validate({ idioms: {}, monologues: [] }).ok, false);
});
