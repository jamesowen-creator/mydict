// 작업265-1: OCR 후보 규칙 — (A) 하이픈 복합어 허용, (B) 연속 확인 "최근 3번의 스캔 중 2번".
// public/js/ocr/*.js 는 브라우저용 ESM 이라 파일 내용을 data: URL 로 불러와 그대로 테스트한다(브라우저·카메라 없음).
// 실행: node --test tests/ocr_candidates.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const load = rel => import('data:text/javascript;base64,' + fs.readFileSync(path.join(PUB, rel)).toString('base64'));
const WORDS = new Set(fs.readFileSync(path.join(PUB, 'data', 'ocr-word-list.txt'), 'utf8').split('\n').map(w => w.trim()).filter(Boolean));
const SIZE = { width: 1498, height: 302 };
const tok = (text, confidence = 90) => ({ text, confidence, bbox: { x0: 700, y0: 120, x1: 800, y1: 180 } });
const live = async (tokens, wordSet = WORDS) => (await load('js/ocr/extractEnglishCandidates.js')).extractLiveEnglishCandidates('', tokens, SIZE, wordSet);

test('A. 하이픈 복합어: 양쪽 부분이 3글자 이상이고 사전 목록에 있으면 후보가 된다', async () => {
  assert.equal(WORDS.has('well-known'), false, '사전 목록에는 하이픈 항목이 없다');
  for (const w of ['well-known', 'long-term', 'self-made', 'high-quality']) assert.deepEqual(await live([tok(w)]), [w], w);
});

test('A. 하이픈 복합어 제외: 하이픈 2개(state-of-the-art), 조각 3글자 미만(e-mail), 사전에 없는 조각(xqzv-lamp)', async () => {
  for (const w of ['state-of-the-art', 'e-mail', 'xqzv-lamp', 'ab-cdef']) assert.deepEqual(await live([tok(w)]), [], w);
});

test('A. 맨 앞·맨 뒤 하이픈은 하이픈 단어가 되지 않는다(기존 규칙: 가장자리 기호를 떼고 일반 단어로 읽음)', async () => {
  for (const w of ['-word', 'word-']) { const r = await live([tok(w)]); assert.ok(!r.some(x => x.includes('-')), w + ' → ' + r); assert.deepEqual(r, ['word']); }
});

test('A. 하이픈 단어도 신뢰도 ≥40·불용어·반복 조건은 그대로 적용', async () => {
  assert.deepEqual(await live([tok('well-known', 30)]), [], '신뢰도 30은 탈락');
  assert.deepEqual(await live([tok('wellll-known', 90)]), [], '같은 글자 3연속은 탈락');
});

test('A. 일반 단어 동작은 그대로(사전에 있으면 통과, 없으면 탈락), 사전 없음(오프라인)에서는 기존 패턴 규칙', async () => {
  assert.deepEqual(await live([tok('journey')]), ['journey']);
  assert.deepEqual(await live([tok('xqzvlamp')]), []);
  assert.deepEqual(await live([tok('well-known')], null), ['well-known'], '사전 없음: 패턴만');
  assert.deepEqual(await live([tok('e-mail')], null), [], '사전 없음: 1글자 조각은 기존처럼 제외');
});

test('A. 하이픈 단어가 점수·정렬에서 불리하지 않다: 중앙에 같은 거리면 일반 단어와 함께 목록에 오른다', async () => {
  const r = await live([tok('well-known'), tok('journey')]);
  assert.deepEqual([...r].sort(), ['journey', 'well-known']);
});

// ── B. 연속 확인 ──
const W = t => ({ text: t, confidence: 90 });
async function run(frames, opts) {
  const { createCandidateStabilityTracker } = await load('js/ocr/ocrCandidateStability.js');
  const tr = opts ? createCandidateStabilityTracker(...opts) : createCandidateStabilityTracker();
  return frames.map(f => tr.filter(f.map(W)).map(w => w.text));
}

test('B-1. 2회 연속 인식 → 두 번째 스캔에서 확정(기존 동작 유지)', async () => {
  assert.deepEqual(await run([['cat'], ['cat']]), [[], ['cat']]);
});

test('B-2. 발견·누락·발견 → 세 번째에서 확정(신규)', async () => {
  assert.deepEqual(await run([['cat'], [], ['cat']]), [[], [], ['cat']]);
});

test('B-3. 발견·누락·누락·누락·발견 → 확정 아님(3번 연속 누락으로 기록 삭제)', async () => {
  assert.deepEqual(await run([['cat'], [], [], [], ['cat']]), [[], [], [], [], []]);
  assert.deepEqual(await run([['cat'], [], [], ['cat']]), [[], [], [], []], '발견·누락·누락·발견: 3번 창에 1번뿐');
});

test('B-4. 한 번씩만 나타나는 서로 다른 단어, 3스캔 간격으로 나타나는 단어는 확정되지 않는다', async () => {
  assert.deepEqual(await run([['a1a'], ['b2b'], ['c3c'], ['d4d'], ['e5e']]), [[], [], [], [], []]);
  assert.deepEqual(await run([['cat'], [], [], ['cat'], [], [], ['cat']]), Array(7).fill([]));
});

test('B-5. 번갈아 나타나는 두 단어는 각자 "3번 중 2번"을 채우는 세 번째·네 번째 스캔에서 확정(설계된 동작)', async () => {
  assert.deepEqual(await run([['cat'], ['dog'], ['cat'], ['dog']]), [[], [], ['cat'], ['dog']]);
});

test('B-6. 확정된 단어는 보이는 동안 계속 확정, 사라지면 목록에서 빠지고 3번 누락 뒤 다시 처음부터', async () => {
  assert.deepEqual(await run([['cat'], ['cat'], ['cat'], [], [], [], ['cat'], ['cat']]), [[], ['cat'], ['cat'], [], [], [], [], ['cat']]);
});

test('B-7. reset()은 기록을 모두 지운다, 옵션(threshold·window)으로 기존 규칙(2연속)도 만들 수 있다', async () => {
  const { createCandidateStabilityTracker } = await load('js/ocr/ocrCandidateStability.js');
  const tr = createCandidateStabilityTracker(); tr.filter([W('cat')]); tr.reset();
  assert.deepEqual(tr.filter([W('cat')]), [], 'reset 뒤 첫 인식은 확정 아님');
  assert.deepEqual(await run([['cat'], [], ['cat']], [2, 2]), [[], [], []], '창 2: 발견·누락·발견은 확정 아님');
});
