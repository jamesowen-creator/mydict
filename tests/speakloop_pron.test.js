// 작업400: 소리 표기(구마다 p 필드) — 콘텐츠 검증, p 를 뺀 값·클립·content_hash 불변, 강세 점 계산 함수.
// 실행: node --test tests/speakloop_pron.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../lib/speakloop_content');
const T = require('../lib/speakloop_tts');
const Core = require('../public/js/speakloop/core.js');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'speakloop', 'content.json'), 'utf8');
const allChunks = c => [].concat(c.idioms.flatMap(i => i.example.chunks), c.monologues.flatMap(m => m.lines.flatMap(l => l.chunks)));

test('모든 chunk(228개)에 비어 있지 않은 p 가 있고, 콘텐츠 검증을 통과한다', () => {
  const c = JSON.parse(raw);
  assert.equal(C.validate(c).ok, true);
  const chunks = allChunks(c);
  assert.equal(chunks.length, 228);
  assert.ok(chunks.every(ch => typeof ch.p === 'string' && ch.p.trim() !== ''));
});

test('검증: p 가 없거나 비어 있으면 거절한다', () => {
  for (const bad of [undefined, '', '   ', 5]) {
    const c = JSON.parse(raw);
    if (bad === undefined) delete c.monologues[0].lines[0].chunks[0].p; else c.monologues[0].lines[0].chunks[0].p = bad;
    const r = C.validate(c);
    assert.equal(r.ok, false, String(bad));
    assert.ok(r.errors.some(e => /\.c0: p 가 비어 있음/.test(e)), String(bad));
  }
  const c = JSON.parse(raw);
  delete c.idioms[0].example.chunks[1].p;
  assert.equal(C.validate(c).ok, false);
});

test('p 를 지운 콘텐츠는 400 이전 파일과 1글자도 다르지 않다(직전 커밋 content.json 의 SHA-256)', () => {
  const stripped = JSON.stringify(JSON.parse(raw), (k, v) => (k === 'p' ? undefined : v));
  assert.equal(sha(stripped), '32a6cbafb4b7417b72b0c89e4188198620503b04c3f320b232c17e5bfa7141a7');
});

test('클립 318개·글자 합계 8,323·클립별 content_hash 가 400 이전과 같다(저장된 음성이 그대로 유효)', () => {
  const clips = C.listClips();
  assert.equal(clips.length, 318);
  assert.equal(clips.reduce((a, c) => a + c.text.length, 0), 8323);
  const st = T.settings();
  assert.equal(sha(clips.map(x => x.key + '=' + T.contentHash(x, st)).join('\n')), 'f62e5609bffd8804ba8892877eb3f1b1c5abe6c06ae94146f3142234a33edfe7');
});

const dots = (en, st) => Core.stressWords(en, st).map(w => w.ranges.map(r => w.text.slice(r[0], r[1])));
test('강세 점: aBOUT → "bout", deLAY → "lay", the LAUNCH → "launch"', () => {
  assert.deepEqual(Core.stressWords('about', 'aBOUT'), [{ text: 'about', ranges: [[1, 5]] }]);
  assert.deepEqual(Core.stressWords('delay', 'deLAY'), [{ text: 'delay', ranges: [[2, 5]] }]);
  assert.deepEqual(dots('the launch', 'the LAUNCH'), [[], ['launch']]);
  assert.deepEqual(dots('about two weeks.', 'aBOUT two WEEKS'), [['bout'], [], ['weeks']], '문장부호는 범위에 넣지 않는다');
});
test('강세 점: 철자가 다르면 그 단어 전체', () => {
  assert.deepEqual(Core.stressWords('table', 'TAYbul'), [{ text: 'table', ranges: [[0, 5]] }]);
  assert.deepEqual(dots('pushed back', 'pusht BAK'), [[], ['back']]);
});
test('강세 점: 모두 소문자면 없음, 대문자 한 글자 "I"(와 I\'m·We 같은 첫머리 대문자)는 강세가 아님', () => {
  assert.deepEqual(dots('the client changed', 'the client changed'), [[], [], []]);
  assert.deepEqual(dots('I', 'I'), [[]]);
  assert.deepEqual(dots("I'm sure", "I'm SURE"), [[], ['sure']]);
  assert.deepEqual(dots('We think', 'We THINK'), [[], ['think']]);
});
test('강세 점: gonna/wanna 토큰은 영어 두 단어("going to"·"want to")에 대응해 뒤 단어가 밀리지 않는다', () => {
  assert.deepEqual(dots("I'm going to make it", "I'm gonna MAKE it"), [[], [], [], ['make'], []]);
  assert.deepEqual(dots('I just want to', 'I just WANna'), [[], [], ['wan'], []]);
});
test('강세 점: 토큰이 모자라면 남은 단어는 강세 없음. 모든 구에서 단어 수만큼 결과가 나오고 범위가 글자 안에 있다', () => {
  assert.deepEqual(dots('a b c', 'A B'), [[], [], []]);
  for (const ch of allChunks(JSON.parse(raw))) {
    const w = Core.stressWords(ch.en, ch.st);
    assert.equal(w.map(x => x.text).join(' '), ch.en);
    w.forEach(x => x.ranges.forEach(r => assert.ok(r[0] >= 0 && r[1] <= x.text.length && r[0] < r[1], ch.en)));
  }
});
