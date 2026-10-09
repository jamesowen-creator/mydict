// 작업223: 태블릿 폭(768/820/1024/1280px)에서 6개 화면(개념 학습·음성 학습·한입 독서·문학 나침반·과학 읽기·언어 사전)이 모두 같은 680px 열의 가운데에 오는지,
// 폰 폭(320/390px)에서 가로 스크롤이 없는지. 기준 화면은 문학 나침반(헤더·내비·본문이 같은 --content-max 열).
// 확인 대상: 공용 헤더(바깥/안쪽 로고), 화면 제목 바(.screen-bar), body·본문 컨테이너, position이 fixed/sticky인 요소 전부(하단 탭바·입력 바·정복 바·플레이어·플로팅 버튼 등), 팝업(dialog).
// 원칙(작업216-3): transition·animation을 끄고(NO_MOTION) 레이아웃이 안정된 뒤(settle) 잰다. 스크롤바 폭 차이로 x가 달라지지 않게 스크롤바를 숨기고 잰다.
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { me, NO_MOTION, settle } = require('./helpers/text_ui');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;   // 사전은 만료·형식 검사를 한다
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'";
const HDR = " && !!document.querySelector('.metis-app-header-logo')";
const MCQ = "[{ type: 'mcq', question: '문제 하나', options: ['가', '나', '다', '라'], answer: '다' }, { type: 'mcq', question: '문제 둘', options: ['A', 'B', 'C', 'D'], answer: 'A' }]";
const READ_QUIZ = `quizState = { questions: ${MCQ}, currentIdx: 0, score: 0, wrong: [], answered: false }; showView('view-quiz'); renderQuestion();`;
const READ_RESULT = "quizState = { questions: [{}, {}], currentIdx: 0, score: 1, wrong: [{ q: 'a', a: 'b' }], answered: false }; showResult()";
const VQ = "quizData = [{ question: '문제?', choices: ['호흡', '증산', '광합성', '발효'], answer_index: 2, explanation: '설명', quote: '근거' }]; quizState = { i: 0, score: 0, answers: [], answered: false, saved: true }; showView('quiz'); $('quiz-result').style.display = 'none'; $('quiz-run').style.display = ''; renderQuizQuestion();";
// 화면별 대표 상태: [이름, 이동 스크립트(없으면 첫 화면), 클릭할 선택자(있으면)]
const SCREENS = {
  concept: { file: '/concept_study.html', ready: "!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", states: [['목록'], ['상세', null, '[data-t="open-study"]'], ['퀴즈', null, '#quiz-open']] },
  voice: { file: '/voice_study.html', ready: "!!document.querySelector('.metis-app-header-logo') && document.getElementById('list-count').textContent === '1건'", states: [['목록'], ['녹음', "showView('record')"], ['상세', "showView('edit')"], ['퀴즈', VQ]] },
  digest: { file: '/digest_reading.html', ready: DB_READY + HDR, states: [['목록'], ['상세', 'showDigest(DB.works[0].id)'], ['퀴즈', READ_QUIZ], ['결과', READ_RESULT]] },
  lit: { file: '/literature_compass.html', ready: DB_READY + HDR, states: [['목록'], ['퀴즈', "quizData = { rounds: [{ type: 'mcq', questions: [{ question: '문제 하나', options: ['가', '나', '다', '라'], answer: '다' }] }], currentRound: 0, currentQ: 0, score: 0, wrong: [], totalQ: 1 }; showView('view-quiz'); renderQuizRound();"], ['결과', "quizData = { rounds: [], currentRound: 0, currentQ: 0, score: 1, totalQ: 2, wrong: [{ q: 'a', a: 'b' }] }; showResult()"]] },
  sci: { file: '/science_reading.html', ready: DB_READY + HDR, states: [['목록'], ['상세', 'showScience(DB.concepts[0].id)'], ['퀴즈', READ_QUIZ], ['결과', READ_RESULT]] },
  dict: { file: '/english_dictionary.html', ready: "!!document.querySelector('.metis-app-header-logo') && !!document.querySelector('nav')", token: true, states: [['홈'], ['플레이어', "document.getElementById('podcast-player').classList.add('show')"]] },
};
// 한 상태에서 잰 값: 헤더(바깥·안쪽 로고), 제목 바, body, 본문 컨테이너, fixed/sticky 요소 전부
const MEASURE = `(() => {
  const vis = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const R = e => { const r = e.getBoundingClientRect(); return { x0: Math.round(r.left * 10) / 10, x1: Math.round(r.right * 10) / 10 }; };
  const nm = e => (e.id ? '#' + e.id : '') + '.' + (typeof e.className === 'string' ? e.className.trim().split(' ').join('.') : '');
  const q = s => [...document.querySelectorAll(s)].find(vis);
  const fixed = [];
  for (const e of document.body.querySelectorAll('*')) { if (!vis(e)) continue; const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && e.getBoundingClientRect().width > 0) fixed.push({ name: nm(e), ...R(e) }); }
  const main = [...document.querySelectorAll('main, .wrap, .content')].filter(vis).map(e => ({ name: nm(e), ...R(e) }));
  return { vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, body: R(document.body),
    header: R(q('.metis-app-header')), logo: R(q('.metis-app-header-logo')), bar: q('.screen-bar') ? R(q('.screen-bar')) : null, fixed, main };
})()`;

async function open(key, width) {
  const sc = SCREENS[key];
  srv.reset(); srv.state.me = me();
  srv.state.voiceNotes = [{ id: 1, title: '첫 자료', summary: '요약', created_at: '2026-01-01T00:00:00Z' }];
  if (key === 'concept') srv.seed({ topic: '측정', items: [{ term: '가' }, { term: '나' }, { term: '다' }] });
  const page = await browser.newPage({ width, height: 900, token: sc.token ? jwt() : 'test-token' });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await page.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.goto(srv.url + sc.file);
  await page.waitFor(sc.ready, 12000);
  await page.eval(NO_MOTION);
  await settle(page);
  return page;
}
async function states(key, width, wanted) {
  const page = await open(key, width), out = {};
  for (const [name, js, click] of SCREENS[key].states) {
    if (wanted && !wanted.includes(name)) continue;
    if (click) { await page.click(click); await sleep(500); } else if (js) { await page.eval(js); await sleep(400); }
    await settle(page);
    out[name] = await page.eval(MEASURE);
  }
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], key + ' ' + width + ': 스크립트 오류');
  await page.close();
  return out;
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
// 고정 요소 중 열의 양 끝에 붙지 않는 것(의도된 예외): 알림창(#toast)은 열 가운데의 작은 알약, OCR 버튼은 열 오른쪽 끝에서 16px 안쪽
const FIXED_EXCEPT = { '#toast': 'center', '#ocr-open': 'right16' };

for (const w of [768, 820, 1024, 1280]) {
  test(`223 태블릿 ${w}px: 6개 화면의 헤더·제목 바·본문·fixed/sticky 요소가 문학 나침반과 같은 680px 열의 가운데(좌우 여백 차이 ≤ 1px)`, { skip: SKIP }, async () => {
    const col0 = (w - 680) / 2, col1 = col0 + 680;
    const ref = (await states('lit', w, ['목록']))['목록'];
    assert.ok(near(ref.header.x0, col0) && near(ref.header.x1, col1), `기준(문학 나침반) 헤더 ${ref.header.x0}~${ref.header.x1}`);
    for (const key of Object.keys(SCREENS)) {
      const all = await states(key, w);
      for (const [st, m] of Object.entries(all)) {
        const L = `${key} ${w}px [${st}]`;
        const centered = (name, r) => assert.ok(near(r.x0, m.vw - r.x1), `${L} ${name}: 왼쪽 여백 ${r.x0} vs 오른쪽 여백 ${m.vw - r.x1}`);
        const sameAsRef = (name, r) => assert.ok(near(r.x0, ref.header.x0) && near(r.x1, ref.header.x1), `${L} ${name}: ${r.x0}~${r.x1} vs 기준 ${ref.header.x0}~${ref.header.x1}`);
        centered('헤더', m.header); sameAsRef('헤더', m.header);
        assert.ok(near(m.logo.x0, m.header.x0 + 16), `${L} 헤더 안쪽 로고는 열 안쪽 16px: ${m.logo.x0} (열 ${m.header.x0})`);
        centered('body', m.body); sameAsRef('body', m.body);
        if (m.bar) { centered('제목 바', m.bar); sameAsRef('제목 바', m.bar); }
        for (const e of m.main) { centered('본문 ' + e.name, e); sameAsRef('본문 ' + e.name, e); }
        assert.ok(m.fixed.length >= 1, L + ': 고정 요소(헤더)가 측정됨');
        for (const f of m.fixed) {
          const ex = FIXED_EXCEPT[f.name.split('.')[0]];
          if (ex === 'center') centered('고정 ' + f.name, f);
          else if (ex === 'right16') assert.ok(near(f.x1, ref.header.x1 - 16), `${L} ${f.name}: 오른쪽 끝 ${f.x1} vs 열 오른쪽 안쪽 ${ref.header.x1 - 16}`);
          else { centered('고정 ' + f.name, f); sameAsRef('고정 ' + f.name, f); }
        }
        assert.ok(m.sw <= m.vw, `${L}: 가로 스크롤 ${m.sw} > ${m.vw}`);
      }
    }
  });
}

test('223 팝업: 개념 학습 지도 시트·상세 대화상자(dialog)가 태블릿 폭에서 화면 가운데에 열림(좌우 여백 차이 ≤ 1px)', { skip: SKIP }, async () => {
  for (const w of [768, 1024, 1280]) {
    const page = await open('concept', w);
    for (const id of ['map-sheet', 'edge-dialog']) {
      await page.eval(`document.getElementById('${id}').showModal()`); await sleep(300);
      const r = await page.eval(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x0: r.left, x1: r.right, vw: document.documentElement.clientWidth }; })()`);
      assert.ok(near(r.x0, r.vw - r.x1), `${w}px ${id}: 왼쪽 ${r.x0} vs 오른쪽 ${r.vw - r.x1}`);
      await page.eval(`document.getElementById('${id}').close()`);
    }
    await page.close();
  }
});

for (const w of [320, 390]) {
  test(`223 폰 ${w}px: 6개 화면(대표 상태)에 가로 스크롤 없음(문서 폭 ≤ ${w}), 헤더·body가 화면 전체 폭`, { skip: SKIP }, async () => {
    for (const key of Object.keys(SCREENS)) {
      for (const [st, m] of Object.entries(await states(key, w))) {
        assert.ok(m.sw <= w, `${key} ${w}px [${st}]: 문서 폭 ${m.sw} > ${w}`);
        assert.ok(near(m.header.x0, 0) && near(m.header.x1, w), `${key} ${w}px [${st}] 헤더 ${m.header.x0}~${m.header.x1}`);
        assert.ok(near(m.body.x0, 0) && near(m.body.x1, w), `${key} ${w}px [${st}] body ${m.body.x0}~${m.body.x1}`);
      }
    }
  });
}
