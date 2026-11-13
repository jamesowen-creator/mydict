// 작업414: 스펠링 런 미리 보기용 순수 함수 시험(public/js/spellrun/logic.js의 previewInfo·previewStep). 브라우저·AI·네트워크 없음.
// 실행: node --test tests/spellrun_preview414.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');

const row = (data, extra) => Object.assign({ id: 1, word: 'x', lang: 'en', data }, extra || {});
const info = (data, word, main) => JSON.parse(JSON.stringify(L.previewInfo(row(data), word || 'scrutinize', main === undefined ? L.keywords((data || {}).short_meaning, 40) : main)));

test('짧은 뜻 있음: 대표 뜻이 첫 줄, 같은 뜻을 되풀이하지 않는다', () => {
  const i = info({ short_meaning: '신중하게 검토하다', meanings: [{ pos: 'verb', definition: '신중하게 검토하다' }] });
  assert.deepEqual(i.shorts, ['신중하게 검토하다']); assert.deepEqual(i.detail, []); assert.deepEqual(i.keys, []);
});
test('짧은 뜻이 여러 개: 둘째 이후 뜻은 새 키워드만 줄로 추가하고(최대 4줄), 이미 나온 키워드는 건너뛴다', () => {
  const i = info({ short_meaning: '심한', meanings: [{ definition: '심한, 극심한' }, { definition: '엄한, 가혹한' }, { definition: '심한, 엄한' }, { definition: '소박한' }, { definition: '꾸밈없는' }, { definition: '여섯째' }] });
  assert.deepEqual(i.shorts, ['심한', '엄한, 가혹한', '소박한', '꾸밈없는'], '첫 줄은 대표 뜻, 셋째 뜻은 전부 중복이라 줄 없음, 최대 4줄');
});
test('짧은 뜻이 없고 meanings 만 있으면 첫 뜻이 대표 뜻으로 넘어온다(meaningOf 규칙) — 같은 정의는 줄로 되풀이하지 않는다', () => {
  const i = info({ meanings: [{ definition: '심한, 극심한' }, { definition: '엄한' }] }, 'severe', L.keywords('심한, 극심한', 40));
  assert.deepEqual(i.shorts, ['심한, 극심한', '엄한']);
});
test('긴 문장 정의만 있는 단어: 쉼표가 없으면 문장이 그대로 대표 뜻으로 남는다(잘라 내지 않음). 쉼표 나열이 길면 항목 단위로만 줄인다', () => {
  const long = '무언가를 매우 자세하고 신중하게 살펴보거나 검토하다';
  const i = info({ meanings: [{ definition: long }] }, 'scrutinize', L.keywords(long, 40));
  assert.deepEqual(i.shorts, [long]);
  const items = ['가나다라', '마바사아', '자차카타', '파하갸냐', '랴려료류', '먀며묘뮤', '뱌벼뵤뷰', '샤셔쇼슈', '야여요유'], list = items.join(', ');
  const first = info({ meanings: [{ definition: list }] }, 'w', L.keywords(list, 40)).shorts[0];
  assert.ok(Array.from(first).length <= 40 && first.split(', ').every(x => items.includes(x)) && first.split(', ').length < items.length, '항목 단위로만 줄임: ' + first);
});
test('상세: 정의 전체는 짧은 뜻과 다를 때만, usage_note(없으면 nuance)는 있으면 항상, 보조 키워드는 위에 나오지 않은 것만(정답 단어는 가림, 최대 6개)', () => {
  const i = info({ short_meaning: '신중하게 검토하다', meanings: [{ definition: '신중하게 검토하다', usage_note: '글에서 자주 쓰는 격식 있는 표현입니다.' }, { definition: '엄한, scrutinize 하는' }, { definition: '가', nuance: '옛 구조 설명' }] });
  assert.deepEqual(i.shorts, ['신중하게 검토하다', '엄한, scrutinize 하는', '가']);
  assert.deepEqual(i.detail, [{ def: '', note: '글에서 자주 쓰는 격식 있는 표현입니다.' }, { def: '', note: '옛 구조 설명' }], '첫 뜻은 대표 뜻과 같아 정의 없음, 줄로 보인 뜻도 정의 중복 없음, nuance 는 usage_note 대체');
  assert.deepEqual(i.keys, []);
  const k = info({ short_meaning: '대표', meanings: [{ definition: '대표, a1, a2, a3, a4, scrutinize5, a6, a7, a8' }] });
  assert.equal(k.keys.length, 6); assert.ok(k.keys.every(x => !/scrutinize/.test(x))); assert.ok(k.keys.includes('＿＿5') || k.keys.some(x => x.includes(L.MASK)), '정답 단어는 가려짐: ' + k.keys);
});
test('상세: 정의가 짧은 뜻과 다르면(길면) 정의 전체가 상세에 들어간다. 첫 뜻이 대표 뜻과 다른 표현이어도 같다', () => {
  const i = info({ short_meaning: '심한', meanings: [{ definition: '심한, 극심한', usage_note: '정도가 매우 높을 때' }] });
  assert.deepEqual(i.detail, [{ def: '심한, 극심한', note: '정도가 매우 높을 때' }]);
});
test('상세가 하나도 없으면 비어 있다(펼치기 표시 숨김): 정의·노트·옛 nuance 모두 없음 / 값 없는 구조', () => {
  for (const d of [{ short_meaning: '뜻' }, { short_meaning: '뜻', meanings: [] }, { short_meaning: '뜻', meanings: [{ definition: '뜻' }] }, null, undefined, 'x', {}]) {
    const i = info(d, 'w', '뜻'); assert.deepEqual(i.detail, [], JSON.stringify(d)); assert.deepEqual(i.keys, []);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(L.previewInfo(null, 'w', ''))), { shorts: [], detail: [], keys: [] });
});
test('옛 구조(meanings 없음)에 최상위 nuance 만 있으면 그것이 상세', () => {
  assert.deepEqual(info({ short_meaning: '사과', nuance: '둥글고 달콤한 과일을 뜻합니다.' }, 'apple', '사과').detail, [{ def: '', note: '둥글고 달콤한 과일을 뜻합니다.' }]);
});
test('형식이 이상한 값(meanings 에 null·문자열, 정의가 숫자)에도 예외 없이 동작', () => {
  const i = info({ short_meaning: '뜻', meanings: [null, 'x', { definition: 5 }, { definition: '다른 뜻', usage_note: 7 }] }, 'w', '뜻');
  assert.deepEqual(i.shorts, ['뜻', '다른 뜻']);
});
test('이전·다음 인덱스: 첫 단어에서 이전은 그대로, 마지막 단어에서 다음은 시작, 한 단어면 다음이 곧 시작', () => {
  assert.deepEqual(L.previewStep(0, 10, 1), { idx: 1, start: false });
  assert.deepEqual(L.previewStep(5, 10, -1), { idx: 4, start: false });
  assert.deepEqual(L.previewStep(0, 10, -1), { idx: 0, start: false }, '첫 단어 이전은 제자리');
  assert.deepEqual(L.previewStep(9, 10, 1), { idx: 9, start: true }, '마지막 다음은 게임 시작');
  assert.deepEqual(L.previewStep(8, 10, 1), { idx: 9, start: false });
  assert.deepEqual(L.previewStep(0, 1, 1), { idx: 0, start: true });
  assert.deepEqual(L.previewStep(0, 0, 1), { idx: 0, start: true });
  assert.deepEqual(L.previewStep(99, 10, -1), { idx: 9, start: false }, '범위를 넘어도 안전');
});
