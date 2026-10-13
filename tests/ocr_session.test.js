// 작업272-1: liveEnglishOcrSession.js — Worker 종료 경합 제거(순서 보장·오류 삼킴·중복 종료·세션 분리). 브라우저 없음.
// 이 파일은 브라우저용 ESM 이라 파일 내용을 data: URL 로 불러온다(테스트마다 새 모듈 인스턴스: 주석을 달리해 캐시를 피함).
// 실행: node --test tests/ocr_session.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ocr', 'liveEnglishOcrSession.js'), 'utf8');
let n = 0;
const fresh = () => import('data:text/javascript;base64,' + Buffer.from(SRC + `\n// instance ${n++}\n`).toString('base64'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 가짜 Tesseract: createWorker/terminate 의 시작·끝 순서를 log 에 남기고, 동시에 살아 있는 Worker 수의 최댓값을 센다
function fakeTesseract({ termDelay = 30, termFail = false, createFail = false, createDelay = 5 } = {}) {
  const log = []; let created = 0, alive = 0, maxAlive = 0;
  const T = {
    log, get created() { return created; }, get maxAlive() { return maxAlive; }, get alive() { return alive; },
    createWorker: async () => {
      const id = ++created;
      log.push('create' + id);
      await sleep(createDelay);
      if (createFail) throw new Error('boom');
      alive++; maxAlive = Math.max(maxAlive, alive);
      return {
        id,
        recognize: async () => ({ data: { words: [], text: 'w' + id } }),
        terminate: async () => {
          log.push('term-start' + id);
          await sleep(termDelay);
          if (termFail) { log.push('term-fail' + id); throw new Error('terminate failed'); }
          alive--; log.push('term-end' + id);
        },
      };
    },
  };
  return T;
}
const withWindow = T => { globalThis.window = { Tesseract: T }; };

test('새 세션 생성은 직전 terminate 가 끝난 뒤에만 한다(종료 직후 다시 열기)', async () => {
  const T = fakeTesseract({ termDelay: 40 }); withWindow(T);
  const { createLiveEnglishOcrSession } = await fresh();
  const s1 = await createLiveEnglishOcrSession();
  const closing = s1.terminate();                       // await 하지 않음(앱의 stopCamera 와 같음)
  const s2 = await createLiveEnglishOcrSession();       // 곧바로 다시 연다
  await closing;
  assert.deepEqual(T.log, ['create1', 'term-start1', 'term-end1', 'create2'], '종료가 끝난 뒤에 새 Worker 생성');
  assert.equal(T.maxAlive, 1, '동시에 살아 있는 Worker 는 1개');
  assert.equal((await s2.recognize(new Blob(['x']))).text, 'w2', '새 세션은 새 Worker 로 인식');
});

test('terminate 오류는 전파되지 않고, 다음 세션은 정상 생성된다', async () => {
  const T = fakeTesseract({ termFail: true }); withWindow(T);
  const { createLiveEnglishOcrSession } = await fresh();
  const s1 = await createLiveEnglishOcrSession();
  await assert.doesNotReject(s1.terminate());
  const s2 = await createLiveEnglishOcrSession();
  assert.equal(T.created, 2);
  await assert.doesNotReject(s2.terminate());
});

test('terminate 를 여러 번 불러도 Worker 종료는 한 번, 종료된 세션의 recognize 는 거부된다', async () => {
  const T = fakeTesseract(); withWindow(T);
  const { createLiveEnglishOcrSession } = await fresh();
  const s = await createLiveEnglishOcrSession();
  await Promise.all([s.terminate(), s.terminate(), s.terminate()]);
  assert.equal(T.log.filter(l => l.startsWith('term-start')).length, 1);
  await assert.rejects(s.recognize(new Blob(['x'])), /종료/);
});

test('세션 생성 실패 후에는 다음 호출이 새로 시도한다(실패한 Worker 를 붙잡지 않음)', async () => {
  const T = fakeTesseract({ createFail: true }); withWindow(T);
  const { createLiveEnglishOcrSession } = await fresh();
  await assert.rejects(createLiveEnglishOcrSession(), /초기화하지 못했습니다/);
  await assert.rejects(createLiveEnglishOcrSession(), /초기화하지 못했습니다/);
  assert.equal(T.created, 2, '두 번째 호출이 이전 실패 Promise 를 재사용하지 않고 새로 시도');
  globalThis.window = {};   // Tesseract 스크립트를 못 불러온 경우
  const { createLiveEnglishOcrSession: c2 } = await fresh();
  await assert.rejects(c2(), /불러오지 못했습니다/);
});

test('종료 직후 다시 열기 50회: 항상 새 Worker, 동시에 살아 있는 Worker 최대 1개, 종료 오류 없음', async () => {
  const T = fakeTesseract({ termDelay: 8, createDelay: 2 }); withWindow(T);
  const { createLiveEnglishOcrSession } = await fresh();
  let s = await createLiveEnglishOcrSession();
  for (let i = 0; i < 50; i++) {
    void s.terminate();                                  // 종료하고 기다리지 않은 채 바로 다시 연다
    s = await createLiveEnglishOcrSession();
    assert.equal((await s.recognize(new Blob(['x']))).text, 'w' + T.created, `#${i}: 살아 있는 새 Worker 로 인식`);
  }
  await s.terminate();
  assert.equal(T.created, 51); assert.equal(T.maxAlive, 1); assert.equal(T.alive, 0);
  const order = T.log.filter(l => /^(create|term-end)/.test(l));
  for (let i = 2; i < order.length; i += 2) {
    assert.match(order[i], /^create/); assert.match(order[i - 1], /^term-end/, '새 생성 직전에 이전 Worker 의 종료가 끝나 있음: ' + order.slice(i - 1, i + 1));
  }
});
