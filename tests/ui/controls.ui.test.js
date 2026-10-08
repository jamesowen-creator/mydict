// 작업201: 6개 화면의 반복 요소(주요 버튼·입력창)가 공용 토큰(tokens.css)을 쓰는지(헤드리스 Chrome, 모의 API, 390px).
// 버튼: 높이 44px 이상·반경 10px·글자 굵기 600, 입력창: 반경 10px, 가로 스크롤 없음. 실행: node --test "tests/ui/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;   // 사전은 만료·형식 검사를 한다
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });
const WORK0 = 'DB.works ? DB.works[0].id : DB[0].id';
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'";

// pre: 처음 화면에서, go: 화면 이동 스크립트, post: 이동 뒤 화면에서 확인할 주요 버튼·입력창
const SCREENS = [
  { name: 'english_dictionary', pre: { buttons: ['#search-btn'], inputs: ['#search-input'] }, noErrorCheck: true },
  { name: 'literature_compass', ready: DB_READY, go: 'showBriefing(DB.eras[0].movements[0].id)', post: { buttons: ['.briefing-cta'] } },
  { name: 'digest_reading', ready: DB_READY, go: `showDigest(${WORK0})`, post: { buttons: [] } },   // 작업217-3: 정복 버튼은 박스 없는 글자 버튼이 되어 '주요 버튼(반경 10px·굵기 600)' 검사에서 뺌(높이 44px는 text_choices.ui가 확인)
  { name: 'science_reading', ready: DB_READY, go: 'showScience(DB.concepts[0].id)', post: { buttons: [] } },   // 작업217-3: 정복 버튼은 박스 없는 글자 버튼이 되어 '주요 버튼(반경 10px·굵기 600)' 검사에서 뺌(높이 44px는 text_choices.ui가 확인)
  { name: 'voice_study', ready: "document.getElementById('list-count').textContent === '0건'", setup: s => { s.state.voiceNotes = []; },
    pre: { buttons: ['#new-rec-btn'] }, go: "openEditNew('연습 문장입니다.')", post: { buttons: ['#sum-make'], inputs: ['#edit-title', '#edit-text'] } },
  { name: 'concept_study', ready: "!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", seed: true,
    pre: { buttons: ['#start-open'] }, click: '#start-open', post: { inputs: ['#start-topic'] } },
];

for (const sc of SCREENS) {
  test(`반복 요소 390px ${sc.name}: 주요 버튼 44px 이상·반경·굵기, 입력창 반경 일치, 가로 스크롤 없음`, { skip: SKIP }, async () => {
    srv.reset();
    srv.state.me = me();
    if (sc.setup) sc.setup(srv);
    if (sc.seed) srv.seed({ topic: '생물 · 세포', items: [{ term: '세포' }, { term: '광합성' }], links: [[0, 1]], path: [0, 1] });
    const page = await browser.newPage({ width: 390, height: 844, token: sc.name === 'english_dictionary' ? jwt() : 'test-token' });
    await page.goto(srv.url + '/' + sc.name + '.html');
    if (sc.ready) await page.waitFor(sc.ready, 10000); else await sleep(1200);
    const measure = async (selectors, kind) => {
      for (const sel of selectors) {
        const m = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { h: r.height, w: r.width, radius: c.borderRadius, weight: c.fontWeight }; })()`);
        assert.ok(m, sc.name + ': 요소 없음 ' + sel);
        if (kind === 'button') {
          assert.ok(m.h >= 43.5, `${sc.name} ${sel}: 높이 44px 이상 (${m.h})`);
          assert.equal(m.radius, '10px', `${sc.name} ${sel}: 버튼 반경`);
          assert.equal(m.weight, '600', `${sc.name} ${sel}: 버튼 굵기`);
        } else {
          assert.equal(m.radius, '10px', `${sc.name} ${sel}: 입력창 반경`);
        }
      }
    };
    const run = async g => { await measure((g && g.buttons) || [], 'button'); await measure((g && g.inputs) || [], 'input'); };
    await run(sc.pre);
    if (sc.go) { await page.eval(sc.go); await sleep(500); }
    if (sc.click) { await page.click(sc.click); await sleep(300); }
    await run(sc.post);
    assert.equal(await page.hasHorizontalScroll(), false, sc.name + ': 가로 스크롤 없음');
    if (!sc.noErrorCheck) assert.deepEqual(page.errors, [], sc.name + ': 스크립트 오류');
    await page.close();
  });
}
