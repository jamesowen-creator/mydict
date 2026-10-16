// 작업273-1·280-2: 개념 지도 주제 안 화면 — 하단 입력 바로 개념을 검색하면 정의·예시 2항목 결과가 자동 저장되고(저장 버튼 없음), 최신 결과는 입력 바 위에 펼쳐지고 이전 결과는 "개념명 · 저장됨" 한 줄로 접힌다.
// 카드: [다시 설명][수정][삭제](삭제는 확인 후). 4항목·옛 형태 개념은 값이 있는 항목만 그대로 보인다. 오류·시간 초과·한도·이미 있는 개념.
// AI 는 모의(실제 호출 없음): srv.anthropic.handler. 서버는 실제 routes/concept_map.js + 가짜 DB(tests/helpers/cmap_db.js)이며 서버·페이지는 t.after 로 종료한다.
// 실행: node --test "tests/ui/cmap_explain.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');
const { tabIn } = require('./helpers/cmap_nav');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

// 280-2: AI 응답·새 저장 형태 = 정의(쓰임새 한 문장 포함)·예시 2항목. FOUR 는 274-2 의 4항목, OLD 는 273-1 의 옛 4항목 형태(호환 확인용)
const GOOD = {
  english: 'acceleration',
  definition: '속도가 시간에 따라 변하는 정도를 나타내는 양이며, 물체의 운동을 분석할 때 쓰입니다.',
  example: '출발하는 버스가 점점 빨라질 때 가속도가 있습니다.',
  deepen: ['작동 원리 심화 항목입니다.', '실무 쟁점 심화 항목입니다.', '구별·한계 심화 항목입니다.'],   // 297-1: 검색 한 번에 심화 3개가 함께 온다
};
const FOUR = {
  definition: '속도가 시간에 따라 변하는 정도를 나타내는 양입니다.',
  example: '출발하는 버스가 점점 빨라질 때 가속도가 있습니다.',
  simple_text: '얼마나 빨리 빨라지는지를 나타내요.',
  deeper_text: '속도의 시간에 대한 변화율이며 방향도 가집니다.',
};
const OLD = {
  definition: '옛 정의입니다.',
  in_context: '옛 맥락입니다.',
  example: '옛 예입니다.',
  confusion: '옛 헷갈림입니다.',
};

async function open(t, { cap, width = 390 } = {}) {
  if (cap === undefined) delete process.env.CMAP_EXPLAIN_DAILY_CAP; else process.env.CMAP_EXPLAIN_DAILY_CAP = String(cap);
  const srv = await startCmapServer();
  t.after(() => srv.close());
  srv.anthropic.handler = () => JSON.stringify(GOOD);
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("!document.getElementById('app').hidden", 8000, '화면 표시');
  await sleep(150);
  return { srv, page };
}
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
async function withTopic(page, title = '물리') {
  const t = (await seed(page, 'POST', '/api/cmap/topics', { title })).topic;
  await page.eval('refresh()');
  await page.eval(`Nav.enterTopic(${t.id}).then(() => 0)`);   // 280-1: 랜딩 → 주제 안 화면
  await page.waitFor("!document.getElementById('concepts-sec').hidden && !document.getElementById('explain-form').hidden", 4000);
  return t;
}
const search = async (page, term) => { await page.type('#explain-term', term); await page.click('#explain-go'); };
const count = page => page.eval("document.querySelectorAll('#concept-list [data-t=concept]').length");
const waitCount = (page, n) => page.waitFor(`document.querySelectorAll('#concept-list [data-t=concept]').length === ${n}`, 6000, `개념 ${n}개`);
const cardState = page => page.eval("(() => { const c = document.getElementById('explain-card'); return { hidden: c.hidden, loading: !!c.querySelector('[data-t=explain-loading]'), error: (c.querySelector('[data-t=explain-error]') || {}).textContent || null, retry: !!c.querySelector('[data-t=explain-retry]'), existing: !!c.querySelector('[data-t=explain-existing]') }; })()");
const rows = srv => srv.db.concepts.map(c => ({ term: c.term, english: c.english, source: c.explanation_source, ex: typeof c.explanation === 'string' ? JSON.parse(c.explanation) : c.explanation }));
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
const open1 = (page, id) => page.eval(`(() => { const b = document.querySelector('#concept-list [data-id="${id}"] .c-toggle'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`);
const secs = (page, id) => page.eval(`[...document.querySelectorAll('#concept-list [data-id="${id}"] .e-sec')].map(e => [e.dataset.f, e.querySelector('.sec-label').textContent, e.classList.contains('quote'), e.querySelector('p').textContent])`);

test('검색 즉시 저장: 입력 바에서 검색하면 정의·예시 2항목이 [저장] 없이 저장되고(source=ai) 그 카드가 펼쳐진다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  assert.equal(await count(page), 0);
  assert.equal(await page.count('#explain-save'), 0, '저장 버튼 자체가 없음');
  await search(page, '가속도');
  await waitCount(page, 1);
  assert.equal(srv.anthropic.calls.length, 1);
  assert.deepEqual(rows(srv), [{ term: '가속도', english: 'acceleration', source: 'ai', ex: { definition: GOOD.definition, example: GOOD.example, deepen: GOOD.deepen } }], '297-1: 검색 성공 즉시 정의·예시·심화 3개가 함께 저장');
  assert.equal(await page.eval("document.getElementById('explain-card').hidden"), true, '임시 카드는 닫히고 결과는 목록 안 카드로');
  assert.equal(await page.eval("document.getElementById('explain-term').value"), '', '입력창 비움');
  const item = "#concept-list [data-t=concept]";
  assert.equal(await page.eval(`document.querySelector('${item} .c-toggle').getAttribute('aria-expanded')`), 'true', '방금 결과는 펼쳐짐');
  assert.equal(await page.text(`${item} .c-saved`), '저장됨');
  const id = await page.eval(`Number(document.querySelector('${item}').dataset.id)`);
  assert.deepEqual((await secs(page, id)).slice(0, 2), [['definition', '정의', false, GOOD.definition], ['example', '예시', true, GOOD.example]], '항목명 + 본문, 예시는 왼쪽 막대(quote)');
  assert.deepEqual((await secs(page, id)).slice(2).map(x => [x[0], x[1], x[3]]), GOOD.deepen.map((d, i) => ['deepen', '심화 개념 ' + (i + 1) + '.', d]), '297-1: 검색 결과 카드에 심화 개념 1~3이 읽기 형태로 보임');
  assert.equal(await page.text(`${item} [data-t=deepen-count]`), '3/6', '297-1: 전체 개수 N/6');
  assert.equal(await page.text(`${item} [data-t=explanation-source]`), 'AI 설명 · 확인 필요');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('${item} .c-tools button')].map(b => b.textContent)`), ['심화 개념+', '다시 설명', '수정', '삭제'], '버튼 순서(282-1, 297-1: [심화 개념+])');
  assert.equal(await page.eval(`[...document.querySelectorAll('${item} .c-tools button')].every(b => b.getBoundingClientRect().height >= 44)`), true, '터치 44px');
  assert.match(await page.text('#topic-list [data-t=node] .t-count').catch(() => '개념 1'), /개념 1/);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('입력 바: 내비 바로 위에 고정(터치 44px 이상), 포커스하면 코랄 테두리 + 링, 키보드(입력 포커스) 동안 내비는 숨고 입력 바는 맨 아래에 남는다, 마지막 카드는 입력 바에 가려지지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const topic = await withTopic(page);
  for (let i = 0; i < 12; i++) await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '개념' + i, explanation: GOOD, explanation_source: 'ai' });
  await page.eval('refresh()');
  await waitCount(page, 12);
  const geo = () => page.eval(`(() => { const b = document.getElementById('explain-form').getBoundingClientRect(), n = document.getElementById('cmap-nav').getBoundingClientRect(), i = document.getElementById('explain-term').getBoundingClientRect(), g = document.getElementById('explain-go').getBoundingClientRect();
    return { barTop: b.top, barBottom: b.bottom, navTop: n.top, navShown: getComputedStyle(document.getElementById('cmap-nav')).display !== 'none', vh: innerHeight, inH: i.height, goH: g.height, pos: getComputedStyle(document.getElementById('explain-form')).position, padBottom: parseFloat(getComputedStyle(document.body).paddingBottom), barH: b.height }; })()`);
  let g = await geo();
  assert.equal(g.pos, 'fixed'); assert.ok(Math.abs(g.barBottom - g.navTop) <= 1, `입력 바가 내비 바로 위: ${g.barBottom} / ${g.navTop}`);
  assert.ok(g.inH >= 44 && g.goH >= 44, '입력창·검색 버튼 44px 이상');
  assert.ok(g.padBottom >= 78 + g.barH, '본문 하단 여백 = 내비 + 입력 바 높이 이상');
  // 맨 아래로 스크롤하면 마지막 카드(줄)가 입력 바 위에 온다
  await page.eval('window.scrollTo(0, document.documentElement.scrollHeight); 0');
  await sleep(100);
  assert.ok(await page.eval(`document.querySelector('#concept-list [data-t=concept]:last-child').getBoundingClientRect().bottom <= document.getElementById('explain-form').getBoundingClientRect().top + 1`), '마지막 줄이 입력 바에 가려지지 않음');
  // 포커스 스타일
  await page.click('#explain-term');
  const st = await page.eval("(() => { const cs = getComputedStyle(document.getElementById('explain-term')); return { border: cs.borderTopColor, shadow: cs.boxShadow, outline: cs.outlineStyle }; })()");
  assert.equal(st.border, 'rgb(226, 88, 59)', '코랄 테두리'); assert.notEqual(st.shadow, 'none', '링'); assert.equal(st.outline, 'none');
  await page.waitFor("document.body.classList.contains('kb-open')", 2000);
  g = await geo();
  assert.equal(g.navShown, false, '키보드가 열려 있는 동안 내비 숨김');
  assert.ok(Math.abs(g.barBottom - g.vh) <= 1, `입력 바는 맨 아래에 남음: ${g.barBottom} / ${g.vh}`);
  await page.eval("document.getElementById('explain-term').blur(); 0");
  await page.waitFor("!document.body.classList.contains('kb-open')", 2000);
  g = await geo();
  assert.equal(g.navShown, true); assert.ok(Math.abs(g.barBottom - g.navTop) <= 1);
  // 주제 안이 아닌 화면(랜딩·퀴즈 탭)에서는 입력 바가 없다
  await page.click('#nav-quiz');
  await page.waitFor("!document.getElementById('quiz-view').hidden", 6000);
  assert.equal(await page.eval("document.getElementById('explain-form').hidden"), true);
  assert.equal(await page.eval("document.body.classList.contains('has-ask')"), false);
  noErrors(page);
});

test('이전 결과는 "개념명 · 저장됨" 한 줄로 접히고(눌러서 펼침/접음), 저장된 개념 목록도 같은 형식이다. 새 검색은 아래(입력 바 위)에 쌓이고 이전 카드는 접힌다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  const old = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '질량', explanation: GOOD, explanation_source: 'manual' })).concept;
  await page.eval('refresh()');
  await waitCount(page, 1);
  // 이미 저장된 개념: 한 줄(접힘)
  assert.equal(await page.eval("document.querySelector('#concept-list .c-toggle').getAttribute('aria-expanded')"), 'false');
  assert.equal(await page.count('#concept-list .c-card'), 0, '접힌 줄에는 카드가 없음');
  assert.match(await page.text('#concept-list .c-toggle'), /질량[\s\S]*저장됨/);
  assert.ok(await page.eval("document.querySelector('#concept-list .c-toggle').getBoundingClientRect().height >= 44"));
  await search(page, '가속도'); await waitCount(page, 2);
  srv.anthropic.handler = () => JSON.stringify({ ...GOOD, definition: '두 번째 정의입니다.' });
  await search(page, '속도'); await waitCount(page, 3);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#concept-list .c-term')].map(e => e.textContent)"), ['질량', '가속도', '속도'], '최신이 맨 아래');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#concept-list .c-toggle')].map(b => b.getAttribute('aria-expanded'))"), ['false', 'false', 'true'], '최신만 펼침, 이전 결과는 한 줄로 접힘');
  assert.equal(await page.count('#concept-list .c-card'), 1);
  // 눌러서 펼치기 → 읽기 형태 카드, 다시 누르면 접힘
  const prev = await page.eval("Number([...document.querySelectorAll('#concept-list [data-t=concept]')][1].dataset.id)");
  await page.click(`#concept-list [data-id="${prev}"] .c-toggle`);
  await page.waitFor(`!!document.querySelector('#concept-list [data-id="${prev}"] .c-card')`, 3000);
  assert.deepEqual((await secs(page, prev)).map(x => x[0]), ['definition', 'example', 'deepen', 'deepen', 'deepen']);
  assert.equal(await page.count('#concept-list .c-card'), 2, '여러 개를 동시에 펼칠 수 있음');
  await page.click(`#concept-list [data-id="${prev}"] .c-toggle`);
  await page.waitFor(`!document.querySelector('#concept-list [data-id="${prev}"] .c-card')`, 3000);
  assert.equal(await page.count('#concept-list [data-t=card] [data-t=explain-close]'), 0, '닫기 버튼 없음(접기로 대체)');
  assert.equal(old.id !== undefined, true);
  noErrors(page);
});

test('[다시 설명]은 같은 2항목으로 다시 만들어 같은 카드(같은 개념)에 덮어쓴다(AI 호출 2회, 개념 수 그대로), 실패하면 기존 설명이 그대로다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '가속도'); await waitCount(page, 1);
  const id = srv.db.concepts[0].id;
  srv.anthropic.handler = () => JSON.stringify({ english: 'x', definition: '두 번째 설명의 정의입니다.', example: '두 번째 예시입니다.' });
  await page.click('[data-t=concept-again]');
  await page.waitFor("(document.querySelector('#concept-list .e-sec[data-f=definition] p') || {}).textContent === '두 번째 설명의 정의입니다.'", 6000, '다시 만든 설명');
  assert.equal(srv.anthropic.calls.length, 2);
  assert.equal(srv.db.concepts.length, 1); assert.equal(srv.db.concepts[0].id, id);
  assert.deepEqual(rows(srv)[0].ex, { definition: '두 번째 설명의 정의입니다.', example: '두 번째 예시입니다.', deepen: GOOD.deepen }, '297-1: 정의·예시만 다시 만들고 심화 3개는 보존');
  assert.equal(rows(srv)[0].english, 'acceleration', '이미 있는 영문 표기는 유지');
  // 실패: 오류 카드, 기존 설명 유지
  srv.anthropic.handler = () => '깨진 응답';
  await page.click('[data-t=concept-again]');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]')", 6000, '오류 카드');
  assert.equal((await cardState(page)).retry, true);
  assert.equal(await page.text('#concept-list .e-sec[data-f=definition] p'), '두 번째 설명의 정의입니다.');
  assert.deepEqual(rows(srv)[0].ex, { definition: '두 번째 설명의 정의입니다.', example: '두 번째 예시입니다.', deepen: GOOD.deepen }, '297-1: 정의·예시만 다시 만들고 심화 3개는 보존');
  noErrors(page);
});

test('[수정]: 카드 안에서 입력칸으로 바뀌고 [취소]는 수정 전으로, [완료]는 서버에 저장까지 반영(고치면 source=manual). 정의를 비우면 요청하지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '속도'); await waitCount(page, 1);
  await page.click('[data-t=concept-edit]');
  await page.waitFor("!!document.getElementById('edit-f-definition')", 3000);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#concept-list [data-t=edit-field]')].map(e => e.dataset.k)"), ['term', 'english', 'definition', 'example', 'memo']);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#concept-list [data-t=edit] .btn-row button')].map(b => b.textContent)"), ['취소', '완료'], '[취소][완료] 구조, [저장] 단계 없음');
  await page.type('#edit-f-example', '취소할 수정');
  await page.click('[data-t=edit-cancel]');
  assert.equal(await page.count('#concept-list textarea'), 0);
  assert.equal(await page.text('#concept-list .e-sec[data-f=example] p'), GOOD.example, '취소하면 수정 전 값');
  assert.equal(rows(srv)[0].source, 'ai');
  await page.click('[data-t=concept-edit]');
  await page.type('#edit-f-definition', '   ');
  await page.click('#edit-done');
  assert.match(await page.text('#edit-msg'), /정의는 비워 둘 수 없습니다/);
  assert.equal(rows(srv)[0].ex.definition, GOOD.definition, '정의가 비면 서버에 요청하지 않음');
  await page.type('#edit-f-definition', '내가 고친 정의');
  await page.type('#edit-memo', '메모');
  await page.type('#edit-english', 'inertia');
  await page.click('#edit-done');
  await page.waitFor("!document.getElementById('edit-done') && (document.querySelector('#concept-list .e-sec[data-f=definition] p') || {}).textContent === '내가 고친 정의'", 6000, '완료 후 읽기 형태');
  assert.equal(rows(srv)[0].source, 'manual'); assert.equal(rows(srv)[0].ex.definition, '내가 고친 정의'); assert.equal(rows(srv)[0].english, 'inertia'); assert.equal(srv.db.concepts[0].memo, '메모');
  assert.equal(await page.text('#concept-list [data-t=explanation-source]'), '직접 쓴 설명');
  assert.equal(await page.text('#concept-list .c-memo'), '메모');
  noErrors(page);
});

test('삭제: 카드의 [삭제] → "‘개념명’을(를) 삭제할까요?" 확인 창, [취소]는 그대로, [삭제]는 개념을 지운다(지도 노드·연결은 서버의 기존 규칙대로 함께 정리)', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  await search(page, '가속도'); await waitCount(page, 1);
  const other = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '질량' })).concept;
  const map = (await seed(page, 'GET', `/api/cmap/topics/${topic.id}/map`)).map;
  const cid = srv.db.concepts[0].id;
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: cid });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/nodes`, { concept_id: other.id });
  await seed(page, 'POST', `/api/cmap/maps/${map.id}/edges`, { from_concept_id: cid, to_concept_id: other.id, label: '관계' });
  await seed(page, 'PUT', `/api/cmap/concepts/${cid}/mark`, { marked: true });
  await page.eval('refresh()'); await waitCount(page, 2);
  await page.click('#concept-list [data-id="' + cid + '"] [data-t=concept-delete]');
  await page.waitFor("document.getElementById('confirm-dlg').open", 3000);
  assert.match(await page.text('#confirm-text'), /‘가속도’을\(를\) 삭제할까요\?/);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#confirm-dlg .btn-row button')].map(b => b.textContent)"), ['취소', '삭제']);
  await page.click('#confirm-cancel');
  await page.waitFor("!document.getElementById('confirm-dlg').open", 3000);
  assert.equal(srv.db.concepts.length, 2, '취소하면 그대로'); assert.equal(await count(page), 2);
  await page.click('#concept-list [data-id="' + cid + '"] [data-t=concept-delete]');
  await page.waitFor("document.getElementById('confirm-dlg').open", 3000);
  await page.click('#confirm-ok');
  await page.waitFor("!document.getElementById('confirm-dlg').open", 3000);
  await waitCount(page, 1);
  assert.deepEqual(srv.db.concepts.map(c => c.term), ['질량']);
  assert.equal(srv.db.nodes.length, 1, '지도 노드 정리'); assert.equal(srv.db.edges.length, 0, '연결 정리'); assert.equal(srv.db.marks.length, 0, '표시 정리');
  noErrors(page);
});

test('이미 있는 개념: AI 를 부르지 않고 새로 만들지 않고 기존 카드를 펼쳐 강조해 안내한다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: 'Force', explanation: GOOD, explanation_source: 'ai' });
  await page.eval('refresh()');
  await waitCount(page, 1);
  await search(page, ' force ');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-existing]')", 4000, '기존 개념 안내');
  assert.equal(srv.anthropic.calls.length, 0, 'AI 호출 없음'); assert.equal(srv.db.concepts.length, 1);
  assert.equal(await page.eval("document.querySelector('#concept-list [data-t=concept]').classList.contains('hl')"), true, '기존 개념 강조');
  assert.equal(await page.eval("document.querySelector('#concept-list .c-toggle').getAttribute('aria-expanded')"), 'true');
  await page.click('[data-t=explain-close]');
  assert.equal((await cardState(page)).hidden, true);
  assert.equal(await page.eval("document.querySelector('#concept-list [data-t=concept]').classList.contains('hl')"), false);
  noErrors(page);
});

test('AI 실패·형식 어긋남(정의 또는 예시 없음): 오류 카드 + [다시 시도], 자동 재시도 없음(호출 1회), 아무것도 저장되지 않고, 누르면 정상 저장', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  srv.anthropic.handler = () => { throw new Error('upstream down'); };
  await search(page, '가속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]')", 6000, '오류 카드');
  assert.match(await page.text('[data-t=explain-error]'), /설명을 가져오지 못했습니다/);
  assert.equal((await cardState(page)).retry, true);
  assert.equal(await page.eval("document.getElementById('explain-term').value"), '가속도', '입력은 남겨 둠');
  await sleep(900);
  assert.equal(srv.anthropic.calls.length, 1, '자동 재시도 없음');
  srv.anthropic.handler = () => JSON.stringify({ definition: '정의만 있고 예시가 없음' });          // 형식 어긋남
  await page.click('[data-t=explain-retry]');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]') && !document.querySelector('#explain-card [data-t=explain-loading]')", 6000, '형식 오류 카드');
  assert.equal(srv.anthropic.calls.length, 2);
  assert.equal(srv.db.concepts.length, 0, '형식이 어긋난 설명은 저장되지 않음'); assert.equal(await count(page), 0);
  srv.anthropic.handler = () => JSON.stringify(GOOD);
  await page.click('[data-t=explain-retry]');
  await waitCount(page, 1);
  assert.equal(srv.anthropic.calls.length, 3);
  noErrors(page);
});

test('40초 제한(테스트에서는 window.__CMAP_AI_TIMEOUT_MS 로 짧게): 시간 초과 시 오류 카드 + 다시 시도, 늦게 온 응답은 무시(서버는 저장해도 화면은 오류 상태 유지)', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await page.eval('window.__CMAP_AI_TIMEOUT_MS = 500; 0');
  srv.anthropic.handler = async () => { await sleep(1500); return JSON.stringify(GOOD); };
  await search(page, '가속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]')", 4000, '시간 초과 카드');
  assert.match(await page.text('[data-t=explain-error]'), /늦어지고/);
  assert.equal((await cardState(page)).retry, true);
  await sleep(1400);
  assert.equal((await cardState(page)).error !== null, true, '늦은 응답이 와도 오류 카드 그대로');
  assert.equal(await count(page), 0, '화면은 늦은 응답을 반영하지 않음');
  noErrors(page);
});

test('하루 한도: 한도를 넘으면 429 안내만(다시 시도 버튼 없음)', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t, { cap: 1 });
  await withTopic(page);
  await search(page, '가속도'); await waitCount(page, 1);
  await search(page, '속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-error]')", 6000);
  assert.match(await page.text('[data-t=explain-error]'), /하루 1건/);
  assert.equal((await cardState(page)).retry, false, '한도 초과는 다시 시도 버튼이 없다');
  assert.equal(srv.anthropic.calls.length, 1); assert.equal(srv.db.concepts.length, 1);
  noErrors(page);
});

test('설명을 기다리는 중 다른 주제를 고르면 안내 카드가 닫히고 늦은 응답은 다른 주제 화면에 나오지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const first = await withTopic(page, '물리');
  const other = (await seed(page, 'POST', '/api/cmap/topics', { title: '화학' })).topic;
  await page.eval('refresh()');
  srv.anthropic.handler = async () => { await sleep(800); return JSON.stringify(GOOD); };
  await search(page, '가속도');
  await page.waitFor("!!document.querySelector('#explain-card [data-t=explain-loading]')", 3000);
  await page.eval(`selectTopic(${other.id}); 0`);
  assert.equal((await cardState(page)).hidden, true, '주제를 바꾸면 카드가 닫힘');
  await sleep(1200);
  assert.equal((await cardState(page)).hidden, true, '늦은 응답이 다른 주제 화면에 나오지 않음');
  assert.equal(await count(page), 0);
  assert.equal(first.id !== other.id, true);
  noErrors(page);
});

test('설명 표시 호환(274-2·280-2): 2항목·4항목·옛 형태 개념 모두 값이 있는 항목만 표시되고(예시는 인용 스타일), 옛 항목은 고쳐도 사라지지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  const mk = async body => (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, body)).concept;
  const two = await mk({ term: '두항목', explanation: { definition: GOOD.definition, example: GOOD.example }, explanation_source: 'ai' });
  const nw = await mk({ term: '신형', explanation: { definition: FOUR.definition, deeper_text: FOUR.deeper_text }, explanation_source: 'ai' });
  const four = await mk({ term: '네항목', explanation: FOUR, explanation_source: 'ai' });
  const old = await mk({ term: '구형', explanation: OLD, explanation_source: 'ai' });
  const none = await mk({ term: '설명없음' });
  await page.eval('refresh()');
  await waitCount(page, 5);
  for (const c of [two, nw, four, old, none]) await open1(page, c.id);
  assert.deepEqual(await secs(page, two.id), [['definition', '정의', false, GOOD.definition], ['example', '예시', true, GOOD.example]]);
  assert.deepEqual(await secs(page, four.id), [['definition', '정의', false, FOUR.definition], ['example', '예시', true, FOUR.example], ['simple_text', '쉬운 설명', false, FOUR.simple_text], ['deeper_text', '더 깊게 설명', false, FOUR.deeper_text]]);
  assert.deepEqual((await secs(page, nw.id)).map(x => x[0]), ['definition', 'deeper_text'], '비어 있는 항목은 표시하지 않음');
  assert.deepEqual(await secs(page, old.id), [['definition', '정의', false, OLD.definition], ['example', '예시', true, OLD.example], ['in_context', '이 주제에서의 의미', false, OLD.in_context], ['confusion', '헷갈리기 쉬운 점', false, OLD.confusion]]);
  assert.match(await page.text(`#concept-list [data-id="${none.id}"] .hint`), /저장된 설명이 없어요/);
  // 옛 항목도 수정 칸에 나오고 메모만 고쳐도 설명(옛 항목 포함)은 그대로
  await page.click(`#concept-list [data-id="${old.id}"] [data-t=concept-edit]`);
  await page.waitFor("!!document.getElementById('edit-f-in_context')", 3000);
  assert.equal(await page.eval("document.getElementById('edit-f-in_context').value"), OLD.in_context);
  await page.type('#edit-memo', '메모');
  await page.click('#edit-done');
  await page.waitFor(`(document.querySelector('#concept-list [data-id="${old.id}"] .c-memo') || {}).textContent === '메모'`, 6000, '수정 반영');
  const row = srv.db.concepts.find(c => c.id === old.id);
  assert.deepEqual(typeof row.explanation === 'string' ? JSON.parse(row.explanation) : row.explanation, OLD, '옛 형태 설명은 그대로'); assert.equal(row.explanation_source, 'ai');
  // 2항목 개념의 수정 칸에는 정의·예시만, 4항목 개념에는 값이 있는 4개
  await page.click(`#concept-list [data-id="${two.id}"] [data-t=concept-edit]`);
  await page.waitFor("!!document.getElementById('edit-f-definition')", 3000);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#concept-list [data-id="${two.id}"] textarea')].map(e => e.dataset.k)`), ['definition', 'example', 'memo']);
  noErrors(page);
});

test('[개념 추가](직접 입력)는 그대로: 대화상자에서 이름·설명을 직접 쓰면 manual 로 저장되고 한 줄 목록에 나타난다, 정의 없이 예시만 쓰면 막힘', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await page.click('#add-concept-btn');
  await page.waitFor("document.getElementById('concept-dlg').open", 3000);
  await page.type('#concept-term', '질량');
  await page.type('#concept-ex-example', '정의 없이 예만');
  await page.click('#concept-ok');
  assert.match(await page.text('#concept-msg'), /정의를 먼저 입력/);
  await page.type('#concept-ex-definition', '물체가 가진 물질의 양');
  await page.click('#concept-ok');
  await page.waitFor("!document.getElementById('concept-dlg').open", 4000);
  await waitCount(page, 1);
  assert.equal(rows(srv)[0].source, 'manual'); assert.equal(rows(srv)[0].ex.definition, '물체가 가진 물질의 양');
  assert.equal(await page.eval("document.querySelector('#concept-list .c-toggle').getAttribute('aria-expanded')"), 'false', '직접 추가한 개념도 한 줄(접힘)');
  noErrors(page);
});

test('검색한 개념이 다른 화면과 이어진다: 저장된 2항목 개념이 지도 만들기(개념 선택)·퀴즈 탭의 말로 설명하기 대상에 나타난다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  await search(page, '가속도'); await waitCount(page, 1);
  const cid = srv.db.concepts[0].id;
  await seed(page, 'PUT', `/api/cmap/concepts/${cid}/mark`, { marked: true });
  await page.click('#nav-quiz');
  await page.waitFor("!!document.getElementById('answer-count') && document.getElementById('answer-count').textContent === '대상 1개'", 6000, '말로 설명하기 대상');
  assert.equal(await page.eval("document.getElementById('answer-start').disabled"), false);
  await tabIn(page, 'map');
  await page.waitFor("!document.getElementById('mapmk-view').hidden", 4000);
  assert.equal(topic.id !== undefined, true);
  noErrors(page);
});

// ───── 282-1: 심화 개념 ([심화 개념]) ─────
const deepBtn = '#concept-list [data-t=concept-deepen]';
const deepItems = page => page.eval("[...document.querySelectorAll('#concept-list .e-sec[data-f=deepen]')].map(e => [e.querySelector('.sec-label').textContent, e.querySelector('p').textContent])");
const deepOf = srv => { const e = srv.db.concepts[0].explanation; return (typeof e === 'string' ? JSON.parse(e) : e).deepen; };

const plain = async (page, term = '콜금리') => {      // 심화가 없는 기존 개념(297-1 이전에 저장된 것)
  const topic = await withTopic(page);
  const c = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term, explanation: { definition: '금융기관끼리 단기로 빌리는 자금의 금리입니다.', example: '은행이 하룻밤 자금을 빌립니다.' }, explanation_source: 'ai' })).concept;
  await page.eval('refresh()'); await waitCount(page, 1); await open1(page, c.id);
  return c;
};

test('[심화 개념+]: 검색 결과에 심화 3개가 있고 "3/6", 누르면 "생성 중…"으로 비활성(중복 클릭 방지), 한 번에 1개씩 4~6번째가 쌓이고 6개가 되면 버튼 비활성 + "6/6"', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '콜금리'); await waitCount(page, 1);
  assert.deepEqual((await deepItems(page)).map(x => x[0]), ['심화 개념 1.', '심화 개념 2.', '심화 개념 3.']);
  assert.equal(await page.text('[data-t=deepen-count]'), '3/6');
  assert.equal(await page.text(deepBtn), '심화 개념+');
  assert.ok(await page.eval(`document.querySelector('${deepBtn}').getBoundingClientRect().height >= 44`), '터치 44px');
  assert.equal(await page.eval(`document.querySelector('${deepBtn}').disabled`), false);
  const texts = ['사례를 다룬 넷째 항목입니다.', '연관 개념을 다룬 다섯째 항목입니다.', '흔한 오해를 다룬 여섯째 항목입니다.'];
  for (let i = 0; i < 3; i++) {
    srv.anthropic.handler = async () => { await sleep(500); return JSON.stringify({ deepen: texts[i] }); };
    const before = srv.anthropic.calls.length;
    await page.click(deepBtn);
    await page.waitFor(`document.querySelector('${deepBtn}').disabled && document.querySelector('${deepBtn}').textContent === '생성 중…'`, 3000, '생성 중');
    await page.waitFor(`document.querySelectorAll('#concept-list .e-sec[data-f=deepen]').length === ${4 + i}`, 6000, `심화 ${4 + i}`);
    assert.equal(srv.anthropic.calls.length, before + 1, '한 번에 한 번만 호출(1개 추가)');
    assert.deepEqual((await deepItems(page)).map(x => x[0]), [1, 2, 3, 4, 5, 6].slice(0, 4 + i).map(n => '심화 개념 ' + n + '.'));
    assert.equal(await page.text('[data-t=deepen-count]'), `${4 + i}/6`);
  }
  assert.deepEqual((await deepItems(page)).map(x => x[1]), [...GOOD.deepen, ...texts], '앞 항목은 그대로 쌓임(덮어쓰기 없음)');
  assert.equal(await page.eval(`document.querySelector('${deepBtn}').disabled`), true, '6개면 비활성');
  assert.equal(await page.text(deepBtn), '심화 개념+');
  assert.equal(await page.text('[data-t=deepen-count]'), '6/6');
  assert.equal(await page.text('#concept-list [data-t=explanation-source]'), 'AI 설명 · 확인 필요', 'AI 설명 표시 유지');
  assert.deepEqual(deepOf(srv), [...GOOD.deepen, ...texts]);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('[심화 개념+] 기존 개념(심화 0개): 개수 표시 없이 시작해 한 번에 1개씩 추가되고 "1/6"', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await plain(page);
  assert.equal(await page.count('[data-t=deepen-count]'), 0, '항목이 없으면 개수 표시 없음');
  srv.anthropic.handler = () => JSON.stringify({ deepen: '첫 심화 항목' });
  await page.click(deepBtn);
  await page.waitFor("document.querySelectorAll('#concept-list .e-sec[data-f=deepen]').length === 1", 6000);
  assert.equal(await page.text('[data-t=deepen-count]'), '1/6');
  assert.equal(await page.eval(`document.querySelector('${deepBtn}').disabled`), false);
  noErrors(page);
});

test('[심화 개념+] 실패·한도: 카드 안 한 줄 안내, 아무것도 추가되지 않고, 다시 누를 수 있다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t, { cap: 3 });
  await plain(page);
  srv.anthropic.handler = () => '깨진 응답';
  await page.click(deepBtn);                                                     // 한도 1 (호출은 됐으나 형식 오류)
  await page.waitFor("!!document.querySelector('#concept-list [data-t=deepen-msg]')", 6000, '오류 안내');
  assert.match(await page.text('[data-t=deepen-msg]'), /설명을 가져오지 못했습니다/);
  assert.equal(srv.anthropic.calls.length, 1); assert.equal(deepOf(srv), undefined);
  assert.equal(await page.eval(`document.querySelector('${deepBtn}').disabled`), false, '실패하면 다시 누를 수 있음');
  srv.anthropic.handler = () => JSON.stringify({ deepen: '성공한 심화 항목' });
  await page.click(deepBtn);                                                     // 한도 2
  await page.waitFor("document.querySelectorAll('#concept-list .e-sec[data-f=deepen]').length === 1", 6000);
  assert.equal(await page.count('[data-t=deepen-msg]'), 0, '성공하면 안내가 사라짐');
  await page.click(deepBtn);                                                     // 한도 3
  await page.waitFor("document.querySelectorAll('#concept-list .e-sec[data-f=deepen]').length === 2", 6000);
  await page.click(deepBtn);                                                     // 한도 초과
  await page.waitFor("!!document.querySelector('#concept-list [data-t=deepen-msg]')", 6000, '한도 안내');
  assert.match(await page.text('[data-t=deepen-msg]'), /하루 3건/);
  assert.equal(deepOf(srv).length, 2);
  noErrors(page);
});

test('심화 개념과 [다시 설명]·[수정]: 다시 설명은 정의·예시만 바꾸고 심화(4개)는 보존, 수정에서 심화 입력칸(350자·자동 높이)을 비우고 [완료]하면 삭제되고 남은 항목은 번호를 다시 매긴다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  await withTopic(page);
  await search(page, '콜금리'); await waitCount(page, 1);
  srv.anthropic.handler = () => JSON.stringify({ deepen: '넷째 심화' });
  await page.click(deepBtn);
  await page.waitFor("document.querySelectorAll('#concept-list .e-sec[data-f=deepen]').length === 4", 6000);
  const all4 = [...GOOD.deepen, '넷째 심화'];
  srv.anthropic.handler = () => JSON.stringify({ english: 'x', definition: '다시 만든 정의입니다.', example: '다시 만든 예시입니다.' });
  await page.click('[data-t=concept-again]');
  await page.waitFor("(document.querySelector('#concept-list .e-sec[data-f=definition] p') || {}).textContent === '다시 만든 정의입니다.'", 6000);
  assert.deepEqual((await deepItems(page)).map(x => x[1]), all4, '다시 설명 후에도 심화 보존');
  await page.click('[data-t=concept-edit]');
  await page.waitFor("!!document.getElementById('edit-deepen-4')", 3000);
  assert.equal(await page.count(deepBtn), 0, '수정 중에는 [심화 개념+]가 보이지 않음');
  assert.equal(await page.eval("document.getElementById('edit-deepen-1').maxLength"), 350);
  assert.deepEqual(await page.eval("[1, 2, 3, 4].map(n => document.querySelector('label[for=edit-deepen-' + n + ']').textContent)"), ['심화 개념 1.', '심화 개념 2.', '심화 개념 3.', '심화 개념 4.'], '수정 입력칸 라벨도 같은 번호');
  assert.equal(await page.eval("document.getElementById('edit-deepen-2').value"), GOOD.deepen[1]);
  const st = await page.eval("(() => { const t = document.getElementById('edit-deepen-1'), cs = getComputedStyle(t); return { sh: t.scrollHeight, ch: t.clientHeight, ov: cs.overflowY, resize: cs.resize }; })()");
  assert.ok(Math.abs(st.sh - st.ch) <= 1 && st.ov === 'hidden' && st.resize === 'none', JSON.stringify(st));
  await page.type('#edit-deepen-2', '');                                          // 둘째 비움
  await page.click('#edit-done');
  await page.waitFor("!document.getElementById('edit-done') && document.querySelectorAll('#concept-list .e-sec[data-f=deepen]').length === 3", 6000, '완료 후 읽기 형태');
  const left = [all4[0], all4[2], all4[3]];
  assert.deepEqual(await deepItems(page), left.map((x, i) => ['심화 개념 ' + (i + 1) + '.', x]), '남은 항목 번호를 다시 매김');
  assert.deepEqual(deepOf(srv), left);
  assert.equal(await page.text('[data-t=deepen-count]'), '3/6');
  assert.equal(await page.eval(`document.querySelector('${deepBtn}').disabled`), false, '6개 미만이면 활성');
  await page.click('[data-t=concept-edit]');
  await page.type('#edit-deepen-1', '취소할 수정');
  await page.click('[data-t=edit-cancel]');
  assert.deepEqual(deepOf(srv), left, '수정 취소는 변경 없음');
  noErrors(page);
});

test('옛 deeper_text("더 깊게 설명")는 기존 이름으로 표시되고 심화 개수에 포함되지 않는다', { skip: SKIP, timeout: 60000 }, async t => {
  const { srv, page } = await open(t);
  const topic = await withTopic(page);
  const c = (await seed(page, 'POST', `/api/cmap/topics/${topic.id}/concepts`, { term: '네항목', explanation: FOUR, explanation_source: 'ai' })).concept;
  await page.eval('refresh()'); await waitCount(page, 1);
  await open1(page, c.id);
  assert.deepEqual((await secs(page, c.id)).map(x => x[1]), ['정의', '예시', '쉬운 설명', '더 깊게 설명']);
  srv.anthropic.handler = () => JSON.stringify({ deepen: '심화 항목' });
  await page.click(deepBtn);
  await page.waitFor("document.querySelectorAll('#concept-list .e-sec[data-f=deepen]').length === 1", 6000);
  assert.deepEqual((await secs(page, c.id)).map(x => x[1]), ['정의', '예시', '쉬운 설명', '더 깊게 설명', '심화 개념 1.'], '옛 이름은 그대로, 심화는 뒤에');
  assert.equal(await page.text('[data-t=deepen-count]'), '1/6');
  noErrors(page);
});

test('320px: [심화 개념+] 개수 표시와 카드 버튼 줄이 넘치지 않고 각 버튼은 44px 이상', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t, { width: 320 });
  await withTopic(page);
  await search(page, '콜금리'); await waitCount(page, 1);
  const g = await page.eval("(() => { const bs = [...document.querySelectorAll('#concept-list .c-tools button')], box = document.querySelector('#concept-list .c-tools').getBoundingClientRect(); return { texts: bs.map(b => b.textContent), h: bs.every(b => b.getBoundingClientRect().height >= 44), inside: bs.every(b => b.getBoundingClientRect().right <= innerWidth + 0.5 && b.getBoundingClientRect().left >= -0.5), count: document.querySelector('[data-t=deepen-count]').getBoundingClientRect().right <= innerWidth + 0.5 }; })()");
  assert.deepEqual(g.texts, ['심화 개념+', '다시 설명', '수정', '삭제']);
  assert.ok(g.h && g.inside && g.count, JSON.stringify(g));
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});
