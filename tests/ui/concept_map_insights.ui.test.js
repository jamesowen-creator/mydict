// 작업227-18: 지도 인사이트 패널(클라이언트 전용) — 문장 5종의 생성·생략 조건, 접힘이 기본, 문장을 누르면 초점 강조·다시 누르면 해제, 상태 변경 후 갱신, 특수문자.
// (헤드리스 Chrome, 모의 API. 실행: node --test tests/ui/concept_map_insights.ui.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { openMap, closeMap } = require('./helpers/map');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const L = (a, b) => [a, b, { relation_type: '사용', label: null, detail: '이유' }];
// items: [term, group, state]
async function open(items, links, { width = 390, height = 844, path = [0], mapOpen = true } = {}) {
  srv.reset();
  srv.seed({ topic: '인사이트', items: items.map(([term, g, st]) => ({ term, set: { group_label: g === undefined ? null : g, review_state: st || 'new', suggestions: [] } })), links: links.map(([a, b]) => L(a, b)), path });
  const page = await browser.newPage({ width, height });
  await page.goto(srv.url + '/concept_study.html#s=' + srv.state.studies[0].id);
  await page.waitFor("!document.getElementById('view-study').hidden && !!document.querySelector('[data-t=term]')");
  if (mapOpen) await openMap(page);
  return page;
}
const calc = page => page.eval("computeInsights().map(i => i.key + '|' + i.text + '|' + i.ids.length)");
const idOf = term => srv.state.items.find(i => i.term === term).id;
const expand = async page => { if ((await page.eval("document.querySelector('[data-t=ins-toggle]').getAttribute('aria-expanded')")) !== 'true') await page.click('[data-t=ins-toggle]'); await page.waitFor("!!document.querySelector('[data-t=ins-list]')"); };
const rows = page => page.eval("[...document.querySelectorAll('[data-t=ins-row]')].map(r => r.dataset.key + '|' + r.firstChild.textContent)");

// 기본 데이터: 허브(네트워크 4개), 다리(3그룹), 전송 그룹 3/3 헷갈림, 고립 1개, 이해 3/8
const A = {
  items: [['네트워크', '기본', 'understood'], ['프로토콜', '기본', 'understood'], ['패킷', '전송', 'confused'], ['TCP', '전송', 'confused'], ['UDP', '전송', 'confused'], ['IP 주소', '주소', 'new'], ['라우터', '주소', 'understood'], ['홀로', '기타', 'new']],
  links: [[0, 1], [0, 2], [0, 3], [0, 5], [2, 3], [3, 4], [5, 6]],
};

test('패널은 접힌 채로 열리고(제목 "지도에서 읽기", 터치 44px), 펼치면 해당되는 문장 5개가 목록으로 나옴', { skip: SKIP }, async () => {
  const page = await open(A.items, A.links);
  assert.match(await page.text('[data-t=ins-toggle]'), /^지도에서 읽기\s*펼치기$/);
  assert.equal(await page.eval("document.querySelector('[data-t=ins-toggle]').getAttribute('aria-expanded')"), 'false');
  assert.equal(await page.count('[data-t=ins-list]'), 0, '접힌 상태에는 문장 없음');
  assert.ok((await page.eval("document.querySelector('[data-t=ins-toggle]').getBoundingClientRect().height")) >= 43.5, '터치 44px');
  await page.click('[data-t=ins-toggle]');
  await page.waitFor("!!document.querySelector('[data-t=ins-list]')");
  assert.deepEqual(await rows(page), [
    'hub|‘네트워크’는 연결이 4개로 가장 많아요.',
    'iso|아직 연결이 없는 개념: ‘홀로’.',
    'bridge|‘네트워크’는 ‘기본’·‘전송’·‘주소’ 그룹을 이어 줘요.',
    'conf|‘전송’ 그룹에 헷갈림이 몰려 있어요(3/3).',
    'und|전체 8개 중 3개를 이해했어요(38%).',
  ]);
  await page.click('[data-t=ins-toggle]');
  assert.equal(await page.count('[data-t=ins-list]'), 0, '다시 누르면 접힘');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('허브: 가장 많은 연결, 동점이면 id 가 작은 개념, 최대 연결이 2개 이하면 문장 없음', { skip: SKIP }, async () => {
  let page = await open([['가'], ['나'], ['다'], ['라'], ['마']], [[0, 1], [0, 2], [3, 1], [3, 2], [3, 4], [0, 4]]);   // 가·라 모두 3개 → 가(id 작음)
  assert.ok((await calc(page)).includes('hub|‘가’는 연결이 3개로 가장 많아요.|1'));
  await page.close();
  page = await open([['가'], ['나'], ['다'], ['라']], [[0, 1], [1, 2], [2, 3]]);   // 최대 2개
  assert.ok(!(await calc(page)).some(x => x.startsWith('hub|')), '최대 연결 2개 이하면 생략');
  await page.close();
});

test('고립: 1~3개는 이름 나열, 4개 이상은 개수와 앞 두 개, 없으면 문장 없음', { skip: SKIP }, async () => {
  let page = await open([['가'], ['나'], ['다'], ['고1'], ['고2']], [[0, 1], [1, 2]]);
  assert.ok((await calc(page)).includes('iso|아직 연결이 없는 개념: ‘고1’, ‘고2’.|2'));
  await page.close();
  page = await open([['가'], ['나'], ['다'], ['고1'], ['고2'], ['고3'], ['고4']], [[0, 1], [1, 2]]);
  assert.ok((await calc(page)).includes('iso|아직 연결이 없는 개념이 4개 있어요(‘고1’, ‘고2’ 외).|4'));
  await page.close();
  page = await open([['가'], ['나'], ['다']], [[0, 1], [1, 2]]);
  assert.ok(!(await calc(page)).some(x => x.startsWith('iso|')));
  await page.close();
});

test('다리: 이웃의 그룹이 2개 이상인 개념 중 가장 큰 것, 그룹 없음·그룹 1개뿐이면 문장 없음', { skip: SKIP }, async () => {
  let page = await open([['가', 'A'], ['나', 'B'], ['다', 'C'], ['라', 'A'], ['마', 'B']], [[0, 1], [0, 2], [3, 1], [3, 4]]);   // 가: B·C / 라: B 만 → 가
  assert.ok((await calc(page)).includes('bridge|‘가’는 ‘B’·‘C’ 그룹을 이어 줘요.|1'));
  await page.close();
  page = await open([['가'], ['나'], ['다'], ['라']], [[0, 1], [0, 2], [0, 3]]);   // 그룹 없음
  assert.ok(!(await calc(page)).some(x => x.startsWith('bridge|')), '그룹이 없으면 생략');
  await page.close();
  page = await open([['가', 'A'], ['나', 'A'], ['다', 'A'], ['라', null]], [[0, 1], [0, 2], [0, 3]]);   // 그룹 1개뿐(없음은 세지 않음)
  assert.ok(!(await calc(page)).some(x => x.startsWith('bridge|')), '그룹이 하나뿐이면 생략');
  await page.close();
});

test('헷갈림: 개념 3개 이상이고 헷갈림 50% 이상인 그룹 중 가장 높은 것 1개, 해당 없으면 문장 없음(그룹 없는 개념은 제외)', { skip: SKIP }, async () => {
  let page = await open([['가', 'A', 'confused'], ['나', 'A', 'confused'], ['다', 'A', 'new'], ['라', 'B', 'confused'], ['마', 'B', 'confused'], ['바', 'B', 'confused'], ['사', null, 'confused']], [[0, 1], [3, 4]]);
  assert.ok((await calc(page)).includes('conf|‘B’ 그룹에 헷갈림이 몰려 있어요(3/3).|3'), 'B(3/3)가 A(2/3)보다 높음');
  await page.close();
  page = await open([['가', 'A', 'confused'], ['나', 'A', 'confused'], ['다', 'A', 'new'], ['라', 'A', 'new'], ['마', 'B', 'confused'], ['바', 'B', 'confused']], [[0, 1]]);   // A 2/4 = 50% → 해당, B 는 2개뿐이라 제외
  assert.ok((await calc(page)).includes('conf|‘A’ 그룹에 헷갈림이 몰려 있어요(2/4).|4'));
  await page.close();
  page = await open([['가', 'A', 'confused'], ['나', 'A', 'new'], ['다', 'A', 'new'], ['라', 'B', 'confused'], ['마', 'B', 'confused']], [[0, 1]]);   // A 1/3, B 는 2개뿐
  assert.ok(!(await calc(page)).some(x => x.startsWith('conf|')), '해당 없으면 생략(몰려 있지 않다는 문장은 쓰지 않음)');
  await page.close();
});

test('이해 비율: 반올림 정수 %, 개념이 3개 미만이면 패널 자체가 없음', { skip: SKIP }, async () => {
  let page = await open([['가', null, 'understood'], ['나', null, 'understood'], ['다', null, 'new']], [[0, 1]]);
  assert.ok((await calc(page)).includes('und|전체 3개 중 2개를 이해했어요(67%).|2'));
  assert.equal(await page.count('[data-t=insights]'), 1);
  await page.close();
  page = await open([['가', null, 'understood'], ['나', null, 'new']], [[0, 1]]);
  assert.deepEqual(await calc(page), []);
  assert.equal(await page.count('[data-t=insights]'), 0, '개념 2개: 패널 숨김');
  await page.close();
  page = await open([['가'], ['나'], ['다']], [[0, 1], [1, 2]]);
  await expand(page);
  assert.ok((await rows(page)).includes('und|전체 3개 중 0개를 이해했어요(0%).'));
  assert.equal(await page.eval("document.querySelector('[data-t=ins-row][data-key=und]').tagName"), 'DIV', '대상이 없는 문장은 누르는 버튼이 아님');
  await page.close();
});

test('문장을 누르면 해당 개념이 초점으로 강조되고 어떤 문장이 강조 중인지 보이며, 다시 누르면 해제', { skip: SKIP }, async () => {
  const page = await open(A.items, A.links, { path: [7] });   // 선택 = 홀로
  await expand(page);
  const bright = () => page.eval("[...document.querySelectorAll('[data-t=node]')].filter(n => !n.classList.contains('dim')).map(n => Number(n.dataset.id)).sort((a, b) => a - b)");
  const strongEdges = () => page.eval("document.querySelectorAll('[data-t=edge][data-hl=\"1\"]').length");
  assert.deepEqual(await bright(), [idOf('홀로')], '처음: 선택한 개념(이웃 없음)만');
  // 헷갈림 그룹: 전송 그룹 3개가 초점, 그 사이 연결(패킷-TCP, TCP-UDP)이 진함
  await page.click('[data-t=ins-row][data-key=conf]');
  await page.waitFor("document.querySelector('[data-t=ins-row][data-key=conf]').getAttribute('aria-pressed') === 'true'");
  assert.deepEqual(await bright(), [idOf('패킷'), idOf('TCP'), idOf('UDP')].sort((a, b) => a - b));
  assert.equal(await strongEdges(), 2);
  assert.match(await page.text('[data-t=ins-row][data-key=conf]'), /지도에서 강조 중/);
  assert.equal(await page.count('[data-t=ins-row][aria-pressed=true]'), 1);
  // 다른 문장으로 바꾸면 이전 강조는 풀림. 허브 = 한 개념 + 그 이웃
  await page.click('[data-t=ins-row][data-key=hub]');
  await page.waitFor("document.querySelector('[data-t=ins-row][data-key=hub]').getAttribute('aria-pressed') === 'true'");
  assert.deepEqual(await bright(), [idOf('네트워크'), idOf('프로토콜'), idOf('패킷'), idOf('TCP'), idOf('IP 주소')].sort((a, b) => a - b));
  assert.equal(await strongEdges(), 4);
  assert.equal(await page.count('[data-t=ins-row][aria-pressed=true]'), 1);
  // 고립: 연결 없는 개념 전부
  await page.click('[data-t=ins-row][data-key=iso]');
  await page.waitFor("document.querySelector('[data-t=ins-row][data-key=iso]').getAttribute('aria-pressed') === 'true'");
  assert.deepEqual(await bright(), [idOf('홀로')]);
  // 다시 누르면 해제 → 선택 개념 기준으로 복귀
  await page.click('[data-t=ins-row][data-key=iso]');
  await page.waitFor("document.querySelector('[data-t=ins-row][data-key=iso]').getAttribute('aria-pressed') === 'false'");
  assert.equal(await page.count('[data-t=ins-row][aria-pressed=true]'), 0);
  assert.deepEqual(await bright(), [idOf('홀로')]);
  // 문장 누르기는 선택·경로를 바꾸지 않음
  assert.equal(srv.state.log.filter(l => l.method === 'PATCH').length, 0);
  // 지도에서 개념을 직접 누르면 강조는 풀리고 그 개념이 선택됨
  await page.click('[data-t=ins-row][data-key=conf]');
  await page.waitFor("document.querySelector('[data-t=ins-row][data-key=conf]').getAttribute('aria-pressed') === 'true'");
  await page.eval(`document.querySelector('[data-t=node][data-id="${idOf('UDP')}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await page.waitFor("document.querySelector('[data-t=term]').innerText === 'UDP'");
  assert.equal(await page.count('[data-t=ins-row][aria-pressed=true]'), 0, '직접 고르면 강조 해제');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('개념 상태를 바꾸면 문장이 갱신: 닫았다 다시 열 때, 그리고 열려 있을 때 즉시', { skip: SKIP }, async () => {
  const page = await open(A.items, A.links, { mapOpen: false, path: [7] });
  await openMap(page); await expand(page);
  assert.ok((await rows(page)).includes('und|전체 8개 중 3개를 이해했어요(38%).'));
  await closeMap(page);
  await page.click('[data-t=understood]');   // 선택한 개념(홀로)을 이해함으로
  await page.waitFor("document.querySelector('[data-t=understood]').getAttribute('aria-pressed') === 'true'");
  await openMap(page); await expand(page);
  assert.ok((await rows(page)).includes('und|전체 8개 중 4개를 이해했어요(50%).'), '다시 열면 갱신');
  // 열려 있는 동안 상태가 바뀌면 즉시
  await page.eval('toggleUnderstood(selItem())');
  await page.waitFor("[...document.querySelectorAll('[data-t=ins-row]')].some(r => r.firstChild.textContent === '전체 8개 중 3개를 이해했어요(38%).')");
  assert.equal(await page.eval("document.querySelector('[data-t=ins-toggle]').getAttribute('aria-expanded')"), 'true', '펼친 상태 유지');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('강조 중인 문장의 대상이 바뀌어 사라지면 강조가 풀림(오류 없음)', { skip: SKIP }, async () => {
  const page = await open(A.items, A.links);
  await expand(page);
  await page.click('[data-t=ins-row][data-key=conf]');
  await page.waitFor("document.querySelector('[data-t=ins-row][data-key=conf]').getAttribute('aria-pressed') === 'true'");
  await page.eval(`(() => { const it = S.items.find(i => i.term === 'TCP'); it.review_state = 'understood'; renderMapSheetBody(); })()`);   // 전송 그룹 2/3 → 아직 50% 이상이라 문장은 남음
  assert.ok((await rows(page)).some(r => r.startsWith('conf|')));
  await page.eval(`(() => { for (const t of ['패킷', 'UDP']) S.items.find(i => i.term === t).review_state = 'understood'; renderMapSheetBody(); })()`);   // 0/3 → 문장 사라짐
  assert.ok(!(await rows(page)).some(r => r.startsWith('conf|')));
  assert.equal(await page.count('[data-t=ins-row][aria-pressed=true]'), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('이름에 따옴표·꺾쇠·& 가 있어도 글자 그대로 보이고 HTML 이 주입되지 않음', { skip: SKIP }, async () => {
  const bad = '<b>"A"&</b>';
  const page = await open([[bad, 'G<1>', 'confused'], ['나', 'G<1>', 'confused'], ['다', 'G<1>', 'confused'], ['라', "H'2", 'new'], ['홀로<i>', null, 'new']], [[0, 1], [0, 2], [0, 3]]);
  await expand(page);
  const r = await rows(page);
  assert.ok(r.includes('hub|‘' + bad + '’는 연결이 3개로 가장 많아요.'), r.join(' / '));
  assert.ok(r.includes('bridge|‘' + bad + '’는 ‘G<1>’·‘H\'2’ 그룹을 이어 줘요.'));
  assert.ok(r.includes('iso|아직 연결이 없는 개념: ‘홀로<i>’.'));
  assert.equal(await page.count('[data-t=ins-list] b, [data-t=ins-list] i'), 0, '목록 안에 주입된 태그 없음');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('390px 에서 패널을 펼쳐도 지도 영역이 남고(최대 높이 제한 + 스크롤), 768px 에서도 가로 스크롤 없음', { skip: SKIP }, async () => {
  for (const [w, h] of [[390, 844], [768, 1024]]) {
    const page = await open(A.items, A.links, { width: w, height: h });
    await expand(page);
    const m = await page.eval(`(() => { const r = e => document.querySelector(e).getBoundingClientRect(); return { box: r('[data-t=map-box]').height, list: r('[data-t=ins-list]').height, sheet: r('#map-sheet').height, scrollW: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; })()`);
    assert.ok(m.list <= Math.max(220, m.sheet * 0.3) + 1, '패널 목록 높이 제한 ' + JSON.stringify(m));
    assert.ok(m.box >= 160 && m.box >= m.sheet * 0.3, '지도 영역이 남음 ' + JSON.stringify(m));
    assert.ok(m.scrollW <= m.cw + 1, '가로 스크롤 없음');
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});
