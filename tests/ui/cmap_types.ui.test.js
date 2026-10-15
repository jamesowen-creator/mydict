// 작업286-1: 관계 유형 10개(방향 있음 6 + 방향 없음 4) · 연결 문구 선택화의 화면 — 연결 대화상자, 유형 select(서버 목록), 선 그리기(화살촉·대립 점선), 퀴즈 결과 ↔.
// 서버는 실제 routes/concept_map.js + 가짜 DB, AI 는 모의. 서버·페이지는 t.after 로 종료한다. 실행: node --test "tests/ui/cmap_types.ui.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

const DIRECTED = ['사용', '일부', '종류', '일으킴', '선행', '조건'];
const SYMMETRIC = ['구별', '유사', '대립', '연관'];

async function open(t, width = 390, height = 844) {
  const srv = await startCmapServer();
  t.after(() => srv.close());
  const page = await browser.newPage({ width, height, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
// 개념 n개를 만들어 모두 지도에 올리고(좌표 지정) 지도 만들기 탭 → 시트까지 연다
async function world(page, n = 3, { open = true } = {}) {
  const top = (await seed(page, 'POST', '/api/cmap/topics', { title: '과학' })).topic;
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await seed(page, 'POST', `/api/cmap/topics/${top.id}/concepts`, { term: '개념' + i })).concept.id);
  const map = (await seed(page, 'GET', `/api/cmap/topics/${top.id}/map`)).map;
  for (const [i, id] of ids.entries()) { await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: id }); await seed(page, 'PATCH', `/api/cmap/maps/${map.id}/nodes/${id}`, { x: 20 + (i % 3) * 140, y: 30 + Math.floor(i / 3) * 110 }); }
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${top.id}).then(() => 0)`);
  return { top, ids, map };
}
const openSheet = async page => {
  await page.click('#nav-map'); await page.waitFor("!!document.getElementById('start-list')", 6000);
  await page.click('#map-open'); await page.waitFor("document.getElementById('map-sheet').open", 6000); await sleep(250);
};
const tapNode = (page, id) => page.click(`[data-node="${id}"] rect`);
const setType = (page, sel, v) => page.eval(`(() => { const s = document.getElementById(${JSON.stringify(sel)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`);

test('연결 대화상자: 문구는 선택(필수 표시 없음), 안내가 유형에 따라 동적으로 바뀌고, 유형도 문구도 없으면 저장이 막히며, 유형만 골라도 저장되어 선 위에 유형 이름이 표시된다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const w = await world(page);
  await openSheet(page);
  await tapNode(page, w.ids[0]); await tapNode(page, w.ids[1]);
  await page.waitFor("document.getElementById('edge-dlg').open", 4000);
  assert.match(await page.text('label[for=edge-label]'), /관계 문구 \(선택, 40자 이내\)/); assert.doesNotMatch(await page.text('label[for=edge-label]'), /필수/);
  assert.equal(await page.text('#edge-label-hint'), '비우면 유형 이름이 표시돼요. 유형을 고르거나 문구를 입력해 주세요');
  await page.click('#edge-ok');                                                         // 유형도 문구도 없음
  assert.match(await page.text('#edge-msg'), /유형을 고르거나 문구를 입력해 주세요/);
  assert.equal(srv.db.edges.length, 0);
  await setType(page, 'edge-type', '선행');
  assert.equal(await page.text('#edge-label-hint'), '비우면 ‘선행’처럼 유형 이름이 표시돼요');
  assert.equal(await page.text('#edge-type-hint'), 'A 다음에 B가 와요 (순서·단계)');
  await page.click('#edge-ok');                                                         // 문구 없이 유형만
  await page.waitFor("!document.getElementById('edge-dlg').open", 4000);
  assert.deepEqual(srv.db.edges.map(e => [e.relation_type, e.label]), [['선행', null]], 'DB 에는 문구 NULL');
  assert.equal(await page.eval("document.querySelector('.m-edge-label').textContent"), '선행', '선 위에는 유형 이름');
  // 문구만(유형 없음)도 저장, 연결 고치기에서 문구를 지우면 유형 이름이 다시 표시
  await tapNode(page, w.ids[1]); await tapNode(page, w.ids[2]);
  await page.waitFor("document.getElementById('edge-dlg').open", 4000);
  await page.type('#edge-label', '그냥 문구'); await page.click('#edge-ok');
  await page.waitFor("!document.getElementById('edge-dlg').open", 4000);
  assert.deepEqual(srv.db.edges.map(e => [e.relation_type, e.label]), [['선행', null], [null, '그냥 문구']]);
  noErrors(page);
});

test('유형 select: 서버 목록 10개로 채워지고(방향 있음 6 / 방향 없음 4 묶음, 방향 없음에는 "(방향 없음)"), 연결 대화상자와 퀴즈 대화상자가 같은 목록이다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  await world(page);
  await openSheet(page);
  for (const id of ['edge-type', 'quiz-type']) {
    const opts = await page.eval(`[...document.querySelectorAll('#${id} option')].map(o => [o.value, o.textContent, o.parentElement.label || ''])`);
    assert.deepEqual(opts.map(o => o[0]), ['', ...DIRECTED, ...SYMMETRIC], id);
    assert.deepEqual(opts.filter(o => o[2] === '방향 있음').map(o => o[0]), DIRECTED); assert.deepEqual(opts.filter(o => o[2] === '방향 없음').map(o => o[0]), SYMMETRIC);
    for (const o of opts.filter(o => SYMMETRIC.includes(o[0]))) assert.ok(o[1].includes('방향 없음'), o[1]);
    assert.equal(opts[0][1], '선택 안 함');
  }
  noErrors(page);
});

test('방향 없음 유형을 고르면 [방향 바꾸기]가 비활성이고 ↔ 로 표시되며, 방향 있음 유형이면 다시 활성(→). 새 유형 5개의 안내 문구', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  await openSheet(page);
  await tapNode(page, w.ids[0]); await tapNode(page, w.ids[1]);
  await page.waitFor("document.getElementById('edge-dlg').open", 4000);
  const HINT = { 선행: 'A 다음에 B가 와요 (순서·단계)', 조건: 'A가 B의 전제·조건이에요', 유사: 'A와 B는 비슷해요 (방향 없음)', 대립: 'A와 B는 반대되거나 맞서요 (방향 없음)', 연관: 'A와 B는 관련 있어요 (방향 없음)' };
  for (const type of [...DIRECTED, ...SYMMETRIC]) {
    await setType(page, 'edge-type', type);
    const sym = SYMMETRIC.includes(type);
    assert.equal(await page.eval("document.getElementById('edge-flip').disabled"), sym, type + ' 방향 바꾸기');
    assert.match(await page.text('#edge-pair'), sym ? /↔/ : /→/, type);
    if (HINT[type]) assert.equal(await page.text('#edge-type-hint'), HINT[type], type);
  }
  assert.match(await page.text('#edge-type-hint'), /헷갈리기|연관|관련/);
  noErrors(page);
});

test('그리기: 방향 없음 4개는 화살촉이 없고 방향 있음 6개는 화살촉이 있으며, 대립만 위험 색 + 점선(나머지는 기본 선 색·실선), 문구가 없으면 선 위에 유형 이름', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page, 5);
  const kinds = [...DIRECTED, ...SYMMETRIC];
  let k = 0;
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { await seed(page, 'POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: w.ids[j], to_concept_id: w.ids[i], relation_type: kinds[k++] }); }   // 큰 id → 작은 id 로 누름(문구 없음)
  await page.eval('refresh()');
  await openSheet(page);
  await page.click('#map-fit');
  const rows = await page.eval(`[...document.querySelectorAll('#map-svg .m-edge')].map(g => { const l = g.querySelector('.m-edge-line'), cs = getComputedStyle(l); return { label: g.querySelector('.m-edge-label').textContent, marker: l.getAttribute('marker-end'), stroke: cs.stroke, dash: cs.strokeDasharray, opp: g.classList.contains('m-edge-opp'), aria: g.getAttribute('aria-label') }; })`);
  assert.equal(rows.length, 10);
  const DANGER = 'rgb(220, 38, 38)', BASE = 'rgb(74, 80, 112)';
  for (const r of rows) {
    const sym = SYMMETRIC.includes(r.label);
    assert.equal(r.marker === null, sym, `${r.label}: 방향 없음이면 화살촉 없음 (${r.marker})`);
    if (r.label === '대립') { assert.equal(r.stroke, DANGER); assert.notEqual(r.dash, 'none', '대립은 점선'); assert.ok(r.opp); }
    else { assert.equal(r.stroke, BASE, r.label); assert.equal(r.dash, 'none', r.label + ' 실선'); assert.ok(!r.opp); }
    assert.ok(r.aria.includes(r.label), '스크린리더 라벨에 표시용 문구');
    assert.ok(r.aria.includes(sym ? '와 ' : ' → '), r.aria);
  }
  assert.deepEqual(rows.map(r => r.label).sort(), [...kinds].sort());
  noErrors(page);
});

test('퀴즈: 유형 select 가 10개이고, 방향 없음 연결은 반대 방향으로 이어도 맞고 결과 화면은 ↔ 로 표시한다(방향 있음은 →, 문구 없는 연결은 유형 이름이 한 번만)', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const w = await world(page);
  const [a, b, c] = w.ids;
  await seed(page, 'POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: a, to_concept_id: b, relation_type: '선행' });
  await seed(page, 'POST', `/api/cmap/maps/${w.map.id}/edges`, { from_concept_id: b, to_concept_id: c, relation_type: '대립' });
  await seed(page, 'POST', `/api/cmap/maps/${w.map.id}/save`);
  await page.eval('refresh()');
  await page.click('#nav-quiz').catch(() => {});
  await page.eval("Nav.goTab('quiz'); 0");
  await page.waitFor("!!document.getElementById('quiz-start')", 6000, '퀴즈 탭');
  await page.click('#quiz-start');
  await page.waitFor("document.getElementById('map-view').classList.contains('quiz-mode') && document.querySelectorAll('[data-node]').length === 3", 6000, '퀴즈 화면');
  const pairTap = async (x, y, type) => {
    await page.click(`[data-node="${x}"] rect`); await page.click(`[data-node="${y}"] rect`);
    await page.waitFor("document.getElementById('quiz-dlg').open", 3000);
    assert.equal(await page.eval("document.querySelectorAll('#quiz-type option').length"), 11, '선택 안 함 + 10개');
    await setType(page, 'quiz-type', type);
    await page.click('#quiz-add'); await page.waitFor("!document.getElementById('quiz-dlg').open", 3000);
  };
  await pairTap(a, b, '선행');
  await pairTap(c, b, '대립');                                                          // 큰 id → 작은 id (저장은 b→c 로 정규화돼 있음)
  assert.match(await page.text('#quiz-answers li:nth-child(2)'), /↔|대립/);
  assert.equal(await page.eval("document.querySelectorAll('#map-svg .m-edge.m-edge-opp').length"), 1, '퀴즈 화면의 대립 선도 위험 색 점선');
  await page.click('#quiz-submit');
  await page.waitFor("!!document.getElementById('quiz-result')", 6000, '결과');
  assert.equal(await page.text('#res-direction b'), '1/1 (100%)', '방향 분모는 방향 있음 1개뿐');
  assert.equal(await page.text('#res-type b'), '2/2 (100%)');
  const correct = await page.eval("[...document.querySelectorAll('#res-correct li')].map(li => li.textContent)");
  assert.equal(correct.length, 2);
  assert.ok(correct.some(x => /개념1 ↔ 개념2 · 대립$/.test(x)), correct.join(' / '));   // 정규화된 방향 없음: 작은 id 가 앞, ↔
  assert.ok(correct.some(x => /개념0 → 개념1 · 선행$/.test(x)), correct.join(' / '));
  assert.match(await page.text('#quiz-panel'), /방향 없음 유형\(구별·유사·대립·연관\)/);
  noErrors(page);
});
