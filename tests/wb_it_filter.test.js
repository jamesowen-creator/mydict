// 작업411: 단어장 "IT" 구분 필터(isItRow·wbTabRows·wbKey) 순수 함수 시험. english_dictionary.html 의 IT-VALIDATE·WB-TAB 구간을 꺼내 vm 에서 실행한다(AI·네트워크 없음).
// 실행: node --test tests/wb_it_filter.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'english_dictionary.html'), 'utf8').replace(/\r\n/g, '\n');
const seg = n => new RegExp('// ' + n + '-START\\n([\\s\\S]*?)// ' + n + '-END').exec(html)[1];
const ctx = { wordbook: [] };
vm.createContext(ctx);
vm.runInContext(seg('IT-VALIDATE') + '\n' + seg('WB-TAB'), ctx);
const GOOD = { is_it: true, one_line: '한 줄', situations: ['a', 'b'], origin: { text: 't', sure: true }, compare: null };
const NOT = { is_it: false };
const names = (tab, list) => JSON.parse(JSON.stringify(ctx.wbTabRows(tab, list))).map(w => w.word + '|' + (w.lang || 'en'));

const ROWS = [
  { word: 'cache', lang: 'en', it: GOOD }, { word: 'thread', lang: 'en', it: NOT }, { word: 'apple', lang: 'en' },
  { word: '스레드', lang: 'ko', it: GOOD }, { word: '사과', lang: 'ko' }, { word: 'lock', lang: 'en', it: GOOD }, { word: 'lock', lang: 'ko', it: GOOD },
  { word: 'キャッシュ', lang: 'ja', it: GOOD }, { word: '缓存', lang: 'zh', it: GOOD }, { word: 'old', it: GOOD },
  { word: 'broken', lang: 'en', it: { is_it: true } }, { word: 'str', lang: 'en', it: 'x' },
];

test('IT 구분: is_it===true 인 영어·한국어 행만(is_it=false·it 없음·검증 실패·일본어·중국어 제외)', () => {
  assert.deepEqual(names('it', ROWS), ['cache|en', '스레드|ko', 'lock|en', 'lock|ko', 'old|en']);
});
test('같은 단어가 영어·한국어 행에 모두 있어도 둘 다 나오고 선택 키가 다르다', () => {
  const lock = ROWS.filter(w => w.word === 'lock');
  assert.deepEqual(lock.map(w => ctx.wbKey(w)), ['lock|en', 'lock|ko']);
  assert.equal(names('it', ROWS).filter(n => n.startsWith('lock')).length, 2);
});
test('일반 구분은 기존과 같다: lang 없으면 en, 각 구분은 자기 언어만, IT 단어도 영어·한국어 구분에 그대로 남는다', () => {
  assert.deepEqual(names('en', ROWS), ['cache|en', 'thread|en', 'apple|en', 'lock|en', 'old|en', 'broken|en', 'str|en']);
  assert.deepEqual(names('ko', ROWS), ['스레드|ko', '사과|ko', 'lock|ko']);
  assert.deepEqual(names('ja', ROWS), ['キャッシュ|ja']); assert.deepEqual(names('zh', ROWS), ['缓存|zh']);
});
test('기본 목록은 전역 wordbook, 빈 목록은 빈 배열', () => {
  ctx.wordbook = ROWS; assert.equal(ctx.wbTabRows('it').length, 5); ctx.wordbook = []; assert.deepEqual(names('it'), []);
});
