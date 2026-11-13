// 작업414·419: 스펠링 런 미리 보기용 순수 함수 시험(public/js/spellrun/logic.js의 previewInfo·previewStep). 브라우저·AI·네트워크 없음.
// 작업419: 뜻 표시가 "짧은 뜻 줄(shorts)"에서 "품사별 번호 목록(groups)"으로 바뀌었다 — 아래 시험의 기대값을 그에 맞게 갱신했다.
// 실행: node --test tests/spellrun_preview414.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');

const row = (data, extra) => Object.assign({ id: 1, word: 'x', lang: 'en', data }, extra || {});
const info = (data, word, main) => JSON.parse(JSON.stringify(L.previewInfo(row(data), word || 'scrutinize', main === undefined ? L.keywords((data || {}).short_meaning, 40) : main)));

const FEATURE = { short_meaning: '특징, 얼굴 부위, 기획기사', meanings: [
  { pos: 'noun', definition: '특징, 특성', usage_note: '눈에 띄는 부분을 가리킬 때 씁니다.' }, { pos: 'noun', definition: '얼굴 부위, 눈/코/입 등' }, { pos: 'noun', definition: '기획기사, 특집' }, { pos: 'verb', definition: '주요 역할을 하다' }] };

test('feature 형태: 품사별로 묶고 품사 안에서 1부터 번호(줄 = 그 뜻의 대응어를 ", " 로 이음), 품사 이름은 한글', () => {
  const i = info(FEATURE, 'feature');
  assert.deepEqual(i.groups, [{ pos: '명사', lines: ['특징, 특성', '얼굴 부위, 눈/코/입 등', '기획기사, 특집'] }, { pos: '동사', lines: ['주요 역할을 하다'] }]);
});
test('같은 품사의 뜻은 떨어져 있어도 한 블록으로 묶고 기존 순서(중요도순)를 지킨다. 블록은 처음 나온 순서', () => {
  const i = info({ meanings: [{ pos: 'noun', definition: '가' }, { pos: 'verb', definition: '나' }, { pos: 'noun', definition: '다' }, { pos: 'adjective', definition: '라' }] }, 'w', '가');
  assert.deepEqual(i.groups, [{ pos: '명사', lines: ['가', '다'] }, { pos: '동사', lines: ['나'] }, { pos: '형용사', lines: ['라'] }]);
});
test('품사 이름: 영문(대소문자 무관)은 한글로, 이미 한글이거나 모르는 값은 원문 그대로', () => {
  const i = info({ meanings: [{ pos: 'Noun', definition: 'a' }, { pos: 'adverb', definition: 'b' }, { pos: 'preposition', definition: 'c' }, { pos: 'idiom', definition: 'd' }, { pos: '명사', definition: 'e' }, { pos: 'particle', definition: 'f' }] }, 'w', 'a');
  assert.deepEqual(i.groups.map(g => g.pos), ['명사', '부사', '전치사', '관용어', '구'.length ? 'particle' : '']);
  assert.deepEqual(i.groups[0].lines, ['a', 'e'], 'Noun 과 명사는 같은 블록');
});
test('품사 필드가 없으면 품사 줄 없이 번호만(품사를 추정하지 않는다). 일부만 없으면 품사 없는 뜻끼리 따로 묶인다', () => {
  assert.deepEqual(info({ meanings: [{ definition: '가' }, { definition: '나' }] }, 'w', '가').groups, [{ pos: '', lines: ['가', '나'] }]);
  assert.deepEqual(info({ meanings: [{ pos: 'noun', definition: '가' }, { definition: '나' }] }, 'w', '가').groups, [{ pos: '명사', lines: ['가'] }, { pos: '', lines: ['나'] }]);
});
test('줄은 definition 의 유효한 대응어 앞 3개: 4개 이상이면 3개만 보이고 전체 정의는 상세로, 마침표가 있는 항목은 건너뛴다', () => {
  const i = info({ meanings: [{ pos: 'verb', definition: '가, 나, 다, 라, 마' }, { pos: 'verb', definition: '살피다, 검토하다., 조사하다' }] }, 'w', '가');
  assert.deepEqual(i.groups[0].lines, ['가, 나, 다', '살피다, 조사하다']);
  assert.deepEqual(i.detail, [{ def: '가, 나, 다, 라, 마', note: '' }, { def: '살피다, 검토하다., 조사하다', note: '' }]);
  assert.deepEqual(i.keys, ['라', '마'], '목록에 나오지 않은 키워드만 보조로');
});
test('긴 문장형 정의(옛 데이터): 유효한 항목이 없으면 문장을 그대로 한 줄로 쓰고 상세에는 같은 내용을 되풀이하지 않는다', () => {
  const long = '무언가를 매우 자세하고 신중하게 살펴보거나 검토하다. 또한 철저히 조사하다';
  const i = info({ short_meaning: long, meanings: [{ pos: 'verb', definition: long, usage_note: '격식 있는 글에서 씁니다.' }] }, 'scrutinize', long);
  assert.deepEqual(i.groups, [{ pos: '동사', lines: [long] }]);
  assert.deepEqual(i.detail, [{ def: '', note: '격식 있는 글에서 씁니다.' }]); assert.deepEqual(i.keys, []);
});
test('상세 중복 제거: 정의가 목록 줄과 같으면 상세에서 뺀다(usage_note 는 그대로). 정의·노트 모두 없으면 상세 없음', () => {
  const i = info(FEATURE, 'feature');
  assert.deepEqual(i.detail, [{ def: '', note: '눈에 띄는 부분을 가리킬 때 씁니다.' }], '목록과 같은 정의는 상세에 없다');
  assert.deepEqual(i.keys, []);
  assert.deepEqual(info({ meanings: [{ pos: 'noun', definition: '사과' }] }, 'apple', '사과').detail, []);
});
test('짧은 뜻만 있는 옛 단어: 품사 없이 번호 한 줄. 상세는 옛 nuance 가 있으면 그것', () => {
  assert.deepEqual(info({ short_meaning: '사과' }, 'apple', '사과'), { groups: [{ pos: '', lines: ['사과'] }], detail: [], keys: [] });
  assert.deepEqual(info({ short_meaning: '사과', nuance: '둥글고 달콤한 과일을 뜻합니다.' }, 'apple', '사과').detail, [{ def: '', note: '둥글고 달콤한 과일을 뜻합니다.' }]);
});
test('보조 키워드: 정답 단어는 가리고 최대 6개', () => {
  const k = info({ meanings: [{ definition: '대표, a1, a2, a3, a4, scrutinize5, a6, a7, a8' }] }, 'scrutinize', '대표');
  assert.deepEqual(k.groups[0].lines, ['대표, a1, a2']); assert.equal(k.keys.length, 6);
  assert.ok(k.keys.every(x => !/scrutinize/.test(x)), '정답 단어는 가려짐: ' + k.keys); assert.ok(k.keys.some(x => x.includes(L.MASK)));
});
test('형식이 이상한 값에도 예외 없이 동작: meanings 에 null·문자열, 정의가 숫자·비어 있음, 데이터 없음', () => {
  const i = info({ short_meaning: '뜻', meanings: [null, 'x', { definition: 5 }, { pos: 'noun', definition: '다른 뜻', usage_note: 7 }] }, 'w', '뜻');
  assert.deepEqual(i.groups, [{ pos: '명사', lines: ['다른 뜻'] }]);
  for (const d of [null, undefined, 'x', {}, { meanings: [] }]) assert.deepEqual(JSON.parse(JSON.stringify(L.previewInfo(row(d), 'w', ''))), { groups: [], detail: [], keys: [] }, JSON.stringify(d));
  assert.deepEqual(info(null, 'w', '뜻').groups, [{ pos: '', lines: ['뜻'] }]);
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
