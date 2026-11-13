// 작업416: 영어 뜻 표현 원칙 검증(splitDefinition·validateGloss·deriveShortMeaning·applyGloss) 순수 함수 시험. english_dictionary.html 의 GLOSS 구간을 꺼내 vm 에서 실행한다(AI·네트워크 없음).
// 실행: node --test tests/dictionary_gloss416.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'english_dictionary.html'), 'utf8').replace(/\r\n/g, '\n');
const seg = /\/\/ GLOSS-START\n([\s\S]*?)\/\/ GLOSS-END/.exec(html)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(seg, ctx);
const J = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));   // vm 객체 → 일반 객체
const split = t => J(ctx.splitDefinition(t));
const val = m => J(ctx.validateGloss(J(m)));
const derive = m => ctx.deriveShortMeaning(J(m));

test('splitDefinition: 쉼표·세미콜론(, ; ， 、)으로 나누고 공백·빈 항목 제거, 문자열이 아니면 빈 배열', () => {
  assert.deepEqual(split('심한, 극심한'), ['심한', '극심한']);
  assert.deepEqual(split('  달리다 ;뛰다，달음질하다、질주하다 '), ['달리다', '뛰다', '달음질하다', '질주하다']);
  assert.deepEqual(split('a,, b ,'), ['a', 'b']);
  assert.deepEqual(split(''), []); assert.deepEqual(split(null), []); assert.deepEqual(split(5), []); assert.deepEqual(split(undefined), []);
});
test('validateGloss: "신중하게 검토하다"(마침표 없는 ~하다 형태)와 짧은 구는 유효, 대응어는 뜻마다 최대 3개, definition 은 ", " 로 정리', () => {
  const r = val([{ pos: 'verb', definition: '신중하게 검토하다 ; 정밀 조사하다，세밀히 살피다、더 있는 말' }]);
  assert.equal(r.ok, true); assert.equal(r.meanings.length, 1);
  assert.equal(r.meanings[0].definition, '신중하게 검토하다, 정밀 조사하다, 세밀히 살피다'); assert.equal(r.meanings[0].pos, 'verb', '다른 필드는 그대로');
});
test('validateGloss: 일부 뜻만 유효하면 유효한 뜻만 남기고, 항목 일부가 문장이면 그 항목만 버린다', () => {
  const r = val([{ definition: '무언가를 살펴보는 것입니다. 매우 자세히' }, { definition: '살피다, 검토하다., 조사하다' }, { definition: '' }, null, 'x']);
  assert.equal(r.ok, true); assert.deepEqual(r.meanings.map(m => m.definition), ['살피다, 조사하다']);
});
test('validateGloss: 전부 무효면 ok=false(문장·마침표·물음표·느낌표·20자 초과·빈 값·배열 아님)', () => {
  for (const bad of ['끝에 마침표가 있다.', '정말?', '대단해!', '。', '가'.repeat(21), '   ', '', undefined, null, 5]) assert.equal(val([{ definition: bad }]).ok, false, JSON.stringify(bad));
  for (const bad of [null, undefined, 'x', {}, 5]) assert.deepEqual(val(bad), { ok: false, meanings: [] });
  assert.equal(val([]).ok, false);
});
test('validateGloss: 20자는 통과, 21자는 탈락(항목 단위). 글자 수 기준이 아니라 여유 상한', () => {
  assert.equal(val([{ definition: '가'.repeat(20) }]).ok, true);
  assert.deepEqual(val([{ definition: '가'.repeat(21) + ', 짧은말' }]).meanings.map(m => m.definition), ['짧은말']);
});
test('deriveShortMeaning: 뜻마다 첫 항목을 모아 ", " 로 합침(최대 3개, 중복 제거, 무효·빈 뜻 제외)', () => {
  assert.equal(derive([{ definition: '달리다, 뛰다' }, { definition: '운영하다, 경영하다' }, { definition: '흐르다' }, { definition: '넷째' }]), '달리다, 운영하다, 흐르다');
  assert.equal(derive([{ definition: '심한, 극심한' }]), '심한');
  assert.equal(derive([{ definition: '달리다' }, { definition: '달리다, 뛰다' }, { definition: '흐르다' }]), '달리다, 흐르다', '중복 제거');
  assert.equal(derive([{ definition: '' }, null, { definition: '신중하게 검토하다' }]), '신중하게 검토하다');
  assert.equal(derive([]), ''); assert.equal(derive(undefined), '');
});
test('applyGloss: 통과하면 definition·short_meaning 갱신, gloss_v=1, short_gloss 삭제. 통과 못하면 원본 유지·short_meaning=첫 뜻 definition·gloss_v 없음·short_gloss 삭제', () => {
  const a = { short_gloss: '옛값', meanings: [{ definition: '달리다, 뛰다' }, { definition: '운영하다' }] };
  assert.equal(ctx.applyGloss(a), true);
  assert.deepEqual(J(a), { meanings: [{ definition: '달리다, 뛰다' }, { definition: '운영하다' }], short_meaning: '달리다, 운영하다', gloss_v: 1 });
  const b = { short_gloss: '옛값', meanings: [{ definition: '무언가를 매우 자세히 살피는 것.' }, { definition: '또 다른 문장입니다.' }] };
  assert.equal(ctx.applyGloss(b), false);
  assert.deepEqual(J(b), { meanings: [{ definition: '무언가를 매우 자세히 살피는 것.' }, { definition: '또 다른 문장입니다.' }], short_meaning: '무언가를 매우 자세히 살피는 것.' });
  assert.equal(b.gloss_v, undefined); assert.equal(b.short_gloss, undefined);
  const c = { meanings: 'x' }; assert.equal(ctx.applyGloss(c), false); assert.equal(c.short_meaning, '');
  const d = {}; assert.equal(ctx.applyGloss(d), false); assert.equal(d.short_meaning, '');
});
