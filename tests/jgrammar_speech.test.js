// 일본어 문법 해설 읽어주기(듣기): 순수 함수(읽을 텍스트 만들기·일본어 음성 고르기·조각 나누기)와 소스 규칙. 브라우저 없이 public/jgrammar.html 의
// "<speech-pure>" 구간을 그대로 꺼내 Node 에서 실행한다(화면 동작은 tests/ui/jgrammar_speech.ui.test.js).
// 실행: node --test tests/jgrammar_speech.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'jgrammar.html'), 'utf8').replace(/\r\n/g, '\n');
const m = html.match(/\/\/ <speech-pure>[^\n]*\n([\s\S]*?)\n\s*\/\/ <\/speech-pure>/);
assert.ok(m, 'speech-pure 구간이 있다');
const F = new Function(m[1] + '\nreturn { usableRuby, speechText, normLang, pickJapaneseVoice, splitForSpeech };')();

const SENTENCE = '私は毎朝コーヒーを飲みます。';
const RUBY = [{ text: '私', reading: 'わたし' }, { text: 'は' }, { text: '毎朝', reading: 'まいあさ' }, { text: 'コーヒー' }, { text: 'を' }, { text: '飲', reading: 'の' }, { text: 'みます。' }];

test('읽을 텍스트: ruby 가 유효하면 reading 이 있는 조각은 reading 으로, 없는 조각은 text 로 이어 붙인다', () => {
  assert.equal(F.speechText({ ruby: RUBY }, SENTENCE), 'わたしはまいあさコーヒーをのみます。');
  assert.equal(F.speechText({ ruby: [{ text: '東京', reading: 'とうきょう' }, { text: '駅', reading: '' }] }, '東京駅'), 'とうきょう駅', '빈 reading 은 text 그대로');
  assert.equal(F.speechText({ ruby: [{ text: 'ねこ' }] }, 'ねこ'), 'ねこ', '읽기가 하나도 없으면 원문과 같다');
});

test('읽을 텍스트: ruby 가 없음·null·빈 배열·어긋남·형식 오류이면 원문 그대로', () => {
  for (const r of [{}, { ruby: null }, { ruby: [] }, { ruby: 'x' },
    { ruby: RUBY.slice(1) },                                   // 이어 붙인 값이 입력과 다름
    { ruby: [{ text: '私は毎朝コーヒーを飲みます' }] },         // 일부만
    { ruby: [{ text: 5 }] }, { ruby: [{ text: '' }] }, { ruby: [null] }, { ruby: Array(101).fill({ text: 'あ' }) }, null, undefined]) {
    assert.equal(F.speechText(r, SENTENCE), SENTENCE, JSON.stringify(r));
  }
});

test('읽을 텍스트: 한자 없는 문장은 원문 그대로(ruby 가 [] 인 결과)', () => {
  assert.equal(F.speechText({ ruby: [] }, 'ねこがすき。'), 'ねこがすき。');
  assert.equal(F.speechText({ translation: 'x', grammar: [] }, 'ネコ'), 'ネコ');
});

test('읽을 텍스트: 화면에 후리가나를 보여 줄 수 있는 상태(usableRuby 통과)와 같은 기준 — 후리가나 켜기/끄기 상태를 입력으로 받지 않는다', () => {
  assert.equal(F.usableRuby(RUBY, SENTENCE), RUBY);
  assert.equal(F.usableRuby(RUBY, SENTENCE + 'x'), null);
  assert.equal(F.speechText.length, 2, '인자는 (결과, 원문) 둘뿐');
});

test('일본어 음성 고르기: ja-JP 우선, 그다음 ja 로 시작하는 것, 없으면 null (ja_JP 표기·대소문자 허용)', () => {
  const en = { name: 'Samantha', lang: 'en-US' }, ja = { name: 'Kyoko', lang: 'ja-JP' }, jaOther = { name: 'X', lang: 'ja' }, android = { name: 'A', lang: 'ja_JP' };
  assert.equal(F.pickJapaneseVoice([en, jaOther, ja]), ja);
  assert.equal(F.pickJapaneseVoice([en, jaOther]), jaOther);
  assert.equal(F.pickJapaneseVoice([en, android]), android);
  assert.equal(F.pickJapaneseVoice([{ name: 'a', lang: 'JA-jp' }]).name, 'a');
  assert.equal(F.pickJapaneseVoice([en, { name: 'zh', lang: 'zh-CN' }, { name: 'ko', lang: 'ko-KR' }]), null);
  assert.equal(F.pickJapaneseVoice([]), null);
  assert.equal(F.pickJapaneseVoice(null), null);
  assert.equal(F.pickJapaneseVoice([null, { lang: undefined }]), null);
});

test('조각 나누기: 문장 부호(。！？)에서 나누고, 이어 붙이면 원래 텍스트와 같다. 닫는 괄호는 앞 문장에 붙는다', () => {
  const t = '今日は雨です。明日は晴れますか？はい！「行きます。」';
  const parts = F.splitForSpeech(t, 80);
  assert.deepEqual(parts, ['今日は雨です。', '明日は晴れますか？', 'はい！', '「行きます。」']);
  assert.equal(parts.join(''), t);
  assert.deepEqual(F.splitForSpeech('', 80), []);
  assert.deepEqual(F.splitForSpeech('  \n ', 80), []);
});

test('조각 나누기: 한 문장이 max 를 넘으면 쉼표에서, 쉼표가 없으면 max 글자에서 자른다(코드 포인트 기준, 서로게이트 쌍을 가르지 않음)', () => {
  const long = '私は昨日、友達と図書館へ行って、難しい本を借りてから、静かな公園で長い時間読みました。';
  const parts = F.splitForSpeech(long, 20);
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(Array.from(p).length <= 20, p);
  assert.equal(parts.join(''), long);
  const noComma = 'あ'.repeat(45);
  assert.deepEqual(F.splitForSpeech(noComma, 20).map(p => p.length), [20, 20, 5]);
  const astral = '𠮷'.repeat(25);
  const ap = F.splitForSpeech(astral, 10);
  assert.deepEqual(ap.map(p => Array.from(p).length), [10, 10, 5]);
  assert.equal(ap.join(''), astral);
  // 200자(입력 상한)도 모두 80자 이하 조각이 된다
  const max = ('私は学校へ行きます' + 'が、').repeat(12).slice(0, 200);
  for (const p of F.splitForSpeech(max, 80)) assert.ok(Array.from(p).length <= 80);
});

test('소스 규칙: speechSynthesis 만 쓰고(외부 음성 API·서버 호출 없음), 읽기는 사용자 탭(링크 클릭)에서만 시작하며, innerHTML 을 쓰지 않는다', () => {
  const code = html.split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n').replace(/<!--[\s\S]*?-->/g, '');   // 주석 제외
  assert.ok(!/innerHTML/.test(code), 'innerHTML 없음');
  assert.ok(!/\/api\/tts|openai/i.test(code), '외부 음성 API·서버 TTS 주소 없음');
  assert.ok(!/outerHTML|insertAdjacentHTML|document\.write/.test(code));
  // 읽기 시작 함수는 링크 클릭 처리(onSpeakClick)에서만 부른다 → 자동 재생 없음
  const calls = [...html.matchAll(/startSpeech\(/g)].length;
  assert.equal(calls, 2, '정의 1 + onSpeakClick 안의 호출 1');
  assert.match(html, /function onSpeakClick\(mode\) \{[\s\S]*?startSpeech\(mode, speakCtx\.text\);/);
  assert.match(html, /addEventListener\('click', function \(\) \{ onSpeakClick\(m\); \}\)/);
  // 속도·언어
  assert.match(html, /SPEAK_RATE = \{ normal: 1\.0, slow: 0\.7 \}/);
  assert.match(html, /u\.lang = voice \? voice\.lang : LANG_UI\[lang\]\.speech/);   // 작업313: 음성이 없을 때의 기본 lang 이 언어 설정(ja: 'ja-JP', en: 'en-US')에서 온다
  assert.match(html, /ja: \{[^\n]*speech: 'ja-JP'/);
  assert.match(html, /en: \{[^\n]*speech: 'en-US'/);
  // 읽는 텍스트는 fetch 본문으로 보내지 않는다: 이 파일의 fetch 호출은 기존 7개 주소뿐
  const urls = [...html.matchAll(/fetch\('([^']+)'/g)].map(x => x[1]);
  assert.deepEqual([...new Set(urls)].sort(), ['/api/jgrammar/explain', '/api/jgrammar/ocr', '/api/jgrammar/saved', '/api/jgrammar/saved/', '/api/me'].sort());
});

test('소스 규칙: 정지 조건 — 결과를 다시 그릴 때(새 분석·저장 항목 열기)·입력 채우기·분석/사진 인식 시작·페이지 이탈에서 stopSpeech 를 부른다', () => {
  assert.match(html, /function render\(r, sentence\) \{\n    stopSpeech\(\);/);
  assert.match(html, /function fillInput\(text\) \{ stopSpeech\(\);/);
  assert.match(html, /var sentence = input\.value\.trim\(\);\n    stopSpeech\(\);/);
  assert.match(html, /if \(!file\) return;\n    stopSpeech\(\);/);
  assert.match(html, /addEventListener\('pagehide', stopSpeech\)/);
  assert.match(html, /addEventListener\('beforeunload', stopSpeech\)/);
});

// ───── 작업313: 영어 읽어주기(순수 함수) ─────
const G = new Function(m[1] + '\nreturn { pickVoice, splitForSpeech, speechText };')();

test('영어 음성 고르기: en-US 우선, 없으면 en 으로 시작하는 것, 없으면 null. 일본어 고르기는 그대로', () => {
  const us = { name: 'Sam', lang: 'en-US' }, gb = { name: 'Dan', lang: 'en-GB' }, ja = { name: 'Kyoko', lang: 'ja-JP' }, under = { name: 'A', lang: 'en_US' };
  assert.equal(G.pickVoice([gb, ja, us], 'en'), us);
  assert.equal(G.pickVoice([ja, gb], 'en'), gb);
  assert.equal(G.pickVoice([ja, under], 'en'), under, 'en_US 표기도 허용');
  assert.equal(G.pickVoice([ja, { name: 'zh', lang: 'zh-CN' }], 'en'), null);
  assert.equal(G.pickVoice([], 'en'), null); assert.equal(G.pickVoice(null, 'en'), null);
  assert.equal(G.pickVoice([us, gb, ja], 'ja'), ja);
  assert.equal(G.pickVoice([us, gb], 'ja'), null);
});

test('영어 조각 나누기: . ! ? 뒤 공백/끝에서 나누고 숫자 안의 마침표·약어 안은 나누지 않으며, 이어 붙이면 원문과 같다. max 를 넘으면 쉼표, 없으면 단어 사이에서 자른다', () => {
  const t = 'Pi is about 3.14. Is it true? Yes! He said "Go." Then left.';
  const parts = G.splitForSpeech(t, 80, 'en');
  assert.deepEqual(parts, ['Pi is about 3.14.', 'Is it true?', 'Yes!', 'He said "Go."', 'Then left.']);
  assert.equal(parts.join(' '), t);
  assert.deepEqual(G.splitForSpeech('', 80, 'en'), []);
  const long = 'This is a rather long sentence that keeps going without any comma at all until it must be cut somewhere reasonable';
  const cut = G.splitForSpeech(long, 40, 'en');
  assert.ok(cut.length >= 3);
  for (const p of cut) { assert.ok(Array.from(p).length <= 40, p); assert.ok(!/^\s|\s$/.test(p)); }
  assert.equal(cut.join(' '), long, '단어 중간에서 자르지 않는다');
  const comma = 'First part of the sentence, second part of the sentence, third part of the sentence here';
  assert.ok(G.splitForSpeech(comma, 40, 'en').every(p => Array.from(p).length <= 40));
  // 일본어 경로(기본값·'ja')는 예전과 같다
  assert.deepEqual(G.splitForSpeech('今日は雨です。明日は晴れますか？', 80), ['今日は雨です。', '明日は晴れますか？']);
  assert.deepEqual(G.splitForSpeech('今日は雨です。明日は晴れますか？', 80, 'ja'), ['今日は雨です。', '明日は晴れますか？']);
  assert.deepEqual(G.splitForSpeech('Hi. Yes! Ok', 80), ['Hi. Yes!', 'Ok'], '일본어 경로는 예전처럼 ASCII 마침표에서 나누지 않고 ! ? 에서만 나눈다(변경 없음)');
});

// ───── 작업314: 중국어 읽어주기(순수 함수) ─────
test('중국어 음성 고르기: 간체 zh-CN·번체 zh-TW 우선, 없으면 그 밖의 zh, 광둥어(yue·zh-HK·이름 Cantonese)는 제외, 없으면 null. ja·en 은 그대로', () => {
  const cn = { name: 'Ting', lang: 'zh-CN' }, tw = { name: 'Mei', lang: 'zh-TW' }, hk = { name: 'Sinji', lang: 'zh-HK' }, yue = { name: 'Y', lang: 'yue-HK' }, zyue = { name: 'Z', lang: 'zh-yue' }, hant = { name: 'H', lang: 'zh-Hant-HK' };
  const named = { name: 'Cantonese (HK)', lang: 'zh-CN' }, ja = { name: 'Kyoko', lang: 'ja-JP' }, en = { name: 'Sam', lang: 'en-US' }, under = { name: 'U', lang: 'zh_CN' };
  assert.equal(G.pickVoice([hk, tw, cn, ja], 'zh-Hans'), cn);
  assert.equal(G.pickVoice([hk, cn, tw, ja], 'zh-Hant'), tw);
  assert.equal(G.pickVoice([hk, tw, ja], 'zh-Hans'), tw, '간체에 zh-CN 이 없으면 다른 zh');
  assert.equal(G.pickVoice([hk, cn, ja], 'zh-Hant'), cn, '번체에 zh-TW 가 없으면 다른 zh');
  assert.equal(G.pickVoice([under, ja], 'zh-Hans'), under, 'zh_CN 표기도 허용');
  for (const code of ['zh-Hans', 'zh-Hant']) {
    assert.equal(G.pickVoice([hk, yue, zyue, hant, named, ja, en], code), null, '광둥어만 있으면 null: ' + code);
    assert.equal(G.pickVoice([ja, en], code), null);
    assert.equal(G.pickVoice([], code), null); assert.equal(G.pickVoice(null, code), null); assert.equal(G.pickVoice([null, { lang: undefined }], code), null);
  }
  assert.equal(G.pickVoice([cn, tw, en, ja], 'ja'), ja); assert.equal(G.pickVoice([cn, tw, en, ja], 'en'), en);
  assert.equal(G.pickVoice([cn, tw, ja], 'en'), null);
});

test('중국어 조각 나누기: 。！？ 에서 나누고, 길면 ，；：、 에서 자른다(80자 이하·이어 붙이면 원문과 같음). 일본어 규칙은 그대로', () => {
  const t = '今天天气很好。你去哪儿？我去学校！';
  assert.deepEqual(G.splitForSpeech(t, 80, 'zh-Hans'), ['今天天气很好。', '你去哪儿？', '我去学校！']);
  assert.deepEqual(G.splitForSpeech(t, 80, 'zh-Hant'), ['今天天气很好。', '你去哪儿？', '我去学校！']);
  const long = ('我昨天去了图书馆' + '；').repeat(4) + ('他说：这本书很有意思' + '，').repeat(5) + '我们都同意。';
  for (const code of ['zh-Hans', 'zh-Hant']) {
    const parts = G.splitForSpeech(long, 25, code);
    assert.ok(parts.length >= 4);
    for (const p of parts) assert.ok(Array.from(p).length <= 25, p);
    assert.equal(parts.join(''), long);
    assert.ok(parts.slice(0, -1).every(p => /[。！？，；：]$/.test(p)), '문장부호에서 나뉨: ' + JSON.stringify(parts));
  }
  // 콜론·세미콜론이 있어도 일본어 경로는 그 문장부호를 기준으로 삼지 않는다(예전 그대로: 、,， 만)
  const ja = 'あ'.repeat(10) + '；' + 'い'.repeat(10) + '、' + 'う'.repeat(10);
  assert.deepEqual(G.splitForSpeech(ja, 15).map(x => x.length), [15, 7, 10], '일본어: ； 는 기준이 아니라 15자에서 자르고, 이어서 、 에서 자름');
  assert.deepEqual(G.splitForSpeech(ja, 15, 'ja').map(x => x.length), [15, 7, 10]);
});

test('소스 규칙(작업314): 중국어 읽을 텍스트는 원문 그대로(speechText 는 후리가나(ja)에서만), zh 설정 한 줄에 lang(zh-CN·zh-TW), 병음 토글 키는 후리가나와 따로', () => {
  assert.match(html, /'zh-Hans': \{[^\n]*speech: 'zh-CN'/);
  assert.match(html, /'zh-Hant': \{[^\n]*speech: 'zh-TW'/);
  assert.match(html, /text: rk === 'furigana' \? speechText\(r, sentence\) : sentence/);
  assert.match(html, /FURIGANA_KEY = 'jgrammar_furigana', PINYIN_KEY = 'jgrammar_pinyin'/);
  assert.equal(G.speechText({ ruby: [{ text: '学习', reading: 'xué xí' }] }, '学习'), 'xué xí', '함수 자체는 ja 용 치환(중국어에서는 화면이 호출하지 않는다)');
});
