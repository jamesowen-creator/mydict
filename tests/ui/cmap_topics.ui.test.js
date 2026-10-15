// 작업271-2: 개념 지도 화면(주제 목록·개념). 280-1: 랜딩(주제 목록, 최신순) → 주제 안 화면 구조에 맞춰 고침. 실제 routes/concept_map.js + 가짜 DB(tests/helpers/cmap_db.js)에 연결한 헤드리스 Chrome 테스트.
// 서버는 단언이 실패해도 닫히도록 t.after 로 등록한다. 실행: node --test "tests/ui/cmap_topics.ui.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startCmapServer } = require('./helpers/cmap_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser;
test.before(async () => { if (SKIP) return; browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); });

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
// 화면의 api() 로 데이터를 미리 만든다(화면 코드의 전역 함수를 그대로 부름)
const seed = (page, method, url, body) => page.eval(`(async () => { const r = await api(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(body)}); return r.body; })()`);
const reload = page => page.eval('refresh()');
const titles = page => page.eval("[...document.querySelectorAll('#topic-list [data-t=node] .t-title')].map(e => e.textContent)");   // 랜딩 목록(최신순, 항목은 경로 표시)
const dlgOpen = (page, id) => page.eval(`document.getElementById('${id}').open`);
const waitOpen = (page, id) => page.waitFor(`document.getElementById('${id}').open`, 4000, id + ' 열림');
const waitClosed = (page, id) => page.waitFor(`!document.getElementById('${id}').open`, 4000, id + ' 닫힘');
// 랜딩에서 주제(끝 이름이 title 인 것)를 눌러 주제 안 화면으로 들어간다(주제 안 화면에 있으면 먼저 [주제] 탭으로 랜딩에 간다)
const pickNode = async (page, title) => {
  if (await page.eval("document.getElementById('landing-view').hidden")) { await page.click('#nav-topic'); await page.waitFor("!document.getElementById('landing-view').hidden", 4000, '랜딩'); }
  const ok = await page.eval(`(() => { const b = [...document.querySelectorAll('#topic-list [data-t=node]')].find(e => e.querySelector('.t-title').textContent.split(' › ').pop() === ${JSON.stringify(title)}); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
  if (ok) await page.waitFor("!document.getElementById('topic-view').hidden", 4000, '주제 안 화면');
  return ok;
};
const selected = page => page.eval("(() => { const b = document.querySelector('#topic-list [data-t=node][aria-current=true] .t-title'); return b ? b.textContent : null; })()");
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);

test('주제 추가: 빈 상태 안내 → 대화상자로 추가 → 완료하면 그 주제 안으로 들어감, 빈 이름·중복 이름은 대화상자 안에 오류, 390px 가로 스크롤 없음', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  assert.equal(await page.eval("!document.getElementById('tree-empty').hidden"), true, '빈 상태 안내');
  assert.match(await page.text('#tree-empty'), /아직 주제가 없습니다/);
  assert.equal(await page.eval("document.getElementById('topic-view').hidden"), true, '랜딩에서는 주제 안 화면이 보이지 않음');
  await page.click('#add-root-btn');
  await waitOpen(page, 'add-dlg');
  await page.click('#add-done');                                          // 빈 이름
  assert.match(await page.text('#add-msg'), /입력해 주세요/);
  await page.type('#add-input', '과학');
  await page.click('#add-done');
  await waitClosed(page, 'add-dlg');
  await page.waitFor("!document.getElementById('topic-view').hidden", 4000, '완료하면 주제 안으로');
  assert.deepEqual(await titles(page), ['과학']);
  assert.equal(await selected(page), '과학', '새 주제가 선택됨');
  assert.equal(await page.text('#path-line'), '과학', '주제 경로 한 줄');
  assert.equal(await page.eval("document.getElementById('topic-actions').hidden"), false);
  assert.equal(await page.eval("document.getElementById('concepts-sec').hidden"), false);
  assert.equal(await page.eval("document.getElementById('tree-empty').hidden"), true);
  // 랜딩으로 돌아가 같은 이름(대소문자 무시) 추가 → 서버 409 문구가 대화상자 안에 나오고 닫히지 않음
  await page.click('#nav-topic');
  await page.waitFor("!document.getElementById('landing-view').hidden", 4000);
  await page.click('#add-root-btn');
  await waitOpen(page, 'add-dlg');
  await page.type('#add-input', '과학');
  await page.click('#add-done');
  await page.waitFor("document.getElementById('add-msg').textContent.length > 0", 4000);
  assert.match(await page.text('#add-msg'), /이미 있습니다/);
  assert.equal(await dlgOpen(page, 'add-dlg'), true, '오류 시 대화상자 유지');
  await page.click('#add-cancel');
  await waitClosed(page, 'add-dlg');
  assert.deepEqual(await titles(page), ['과학']);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('하위 주제 추가(주제 안 화면), 5단계에서는 하위 추가 버튼이 꺼짐', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const a = (await seed(page, 'POST', '/api/cmap/topics', { title: 'A' })).topic;
  await reload(page);
  await pickNode(page, 'A');
  await page.click('#act-add-child');
  await waitOpen(page, 'name-dlg');
  assert.match(await page.text('#name-label'), /‘A’ 아래에 만들 주제 이름/);
  await page.type('#name-input', 'A1');
  await page.click('#name-ok');
  await waitClosed(page, 'name-dlg');
  await page.waitFor("document.querySelectorAll('#topic-list [data-t=node]').length === 2", 4000);
  assert.deepEqual(await titles(page), ['A › A1', 'A'], '최신순(나중에 만든 주제가 위), 항목은 경로로 표시');
  assert.equal(await selected(page), 'A › A1');
  assert.equal(await page.text('#path-line'), 'A › A1');
  // 5단계까지 만든 뒤: 가장 깊은 주제를 고르면 하위 추가 버튼이 꺼진다
  let parent = (await seed(page, 'POST', '/api/cmap/topics', { title: 'A1-1', parent_id: (await page.eval("byId(S.selectedId).id")) })).topic;
  for (const name of ['A1-2', 'A1-3']) parent = (await seed(page, 'POST', '/api/cmap/topics', { title: name, parent_id: parent.id })).topic;
  assert.equal(parent.depth, 5);
  await reload(page);
  await pickNode(page, 'A1-3');
  assert.equal(await page.eval("document.getElementById('act-add-child').disabled"), true, '5단계에서는 하위 추가 불가');
  await pickNode(page, 'A1-2');
  assert.equal(await page.eval("document.getElementById('act-add-child').disabled"), false);
  noErrors(page);
});

test('이름 변경: 현재 이름이 채워져 있고 저장하면 트리에 반영, 같은 위치 중복 이름은 오류 문구를 보이고 열어 둠', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  await seed(page, 'POST', '/api/cmap/topics', { title: '물리' });
  await seed(page, 'POST', '/api/cmap/topics', { title: '화학' });
  await reload(page);
  await pickNode(page, '화학');
  await page.click('#act-rename');
  await waitOpen(page, 'name-dlg');
  assert.equal(await page.eval("document.getElementById('name-input').value"), '화학');
  await page.type('#name-input', '물리');                      // 이미 있는 이름
  await page.click('#name-ok');
  await page.waitFor("document.getElementById('name-msg').textContent.length > 0", 4000);
  assert.match(await page.text('#name-msg'), /이미 있습니다/);
  assert.equal(await dlgOpen(page, 'name-dlg'), true);
  await page.type('#name-input', '화학 일반');
  await page.click('#name-ok');
  await waitClosed(page, 'name-dlg');
  await page.waitFor("[...document.querySelectorAll('#topic-list [data-t=node] .t-title')].some(e => e.textContent === '화학 일반')", 4000);
  assert.deepEqual((await titles(page)).sort(), ['물리', '화학 일반']);
  assert.equal(await selected(page), '화학 일반');
  noErrors(page);
});

test('이동: 자기 자신·하위는 목록에 없고, 다른 주제 아래/최상위로 옮기면 트리가 바뀜', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  const a = (await seed(page, 'POST', '/api/cmap/topics', { title: 'A' })).topic;
  await seed(page, 'POST', '/api/cmap/topics', { title: 'A1', parent_id: a.id });
  await seed(page, 'POST', '/api/cmap/topics', { title: 'B' });
  await reload(page);
  await pickNode(page, 'A');
  await page.click('#act-move');
  await waitOpen(page, 'move-dlg');
  const opts = await page.eval("[...document.querySelectorAll('#move-select option')].map(o => o.textContent)");
  assert.deepEqual(opts, ['최상위', 'B'], '자기 자신(A)과 하위(A › A1)는 고를 수 없음');
  await page.click('#move-cancel');
  await waitClosed(page, 'move-dlg');
  await pickNode(page, 'A1');
  await page.click('#act-move');
  await waitOpen(page, 'move-dlg');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#move-select option')].map(o => o.textContent)"), ['최상위', 'A', 'B']);
  assert.equal(await page.eval("document.getElementById('move-select').value"), String(a.id), '현재 부모가 선택돼 있음');
  await page.eval(`(() => { const s = document.getElementById('move-select'); s.value = [...s.options].find(o => o.textContent === 'B').value; })()`);
  await page.click('#move-ok');
  await waitClosed(page, 'move-dlg');
  await page.waitFor("(() => { const x = byId(S.selectedId); return x && byId(x.parent_id) && byId(x.parent_id).title === 'B'; })()", 4000, 'A1 이 B 아래로');
  assert.deepEqual(await titles(page), ['B', 'B › A1', 'A']);
  // 최상위로
  await page.click('#act-move');
  await waitOpen(page, 'move-dlg');
  await page.eval("document.getElementById('move-select').value = ''");
  await page.click('#move-ok');
  await waitClosed(page, 'move-dlg');
  await page.waitFor("byId(S.selectedId) && byId(S.selectedId).parent_id === null", 4000, '최상위로');
  assert.equal(await page.eval("byId(S.selectedId).depth"), 1);
  noErrors(page);
});

test('삭제 확인창: 최상위는 서버가 알려 준 하위 주제·개념 수를 보여 주고 취소하면 그대로, 확인하면 전부 삭제', { skip: SKIP, timeout: 60000 }, async t => {
  const { page, srv } = await open(t);
  const a = (await seed(page, 'POST', '/api/cmap/topics', { title: 'A' })).topic;
  const a1 = (await seed(page, 'POST', '/api/cmap/topics', { title: 'A1', parent_id: a.id })).topic;
  await seed(page, 'POST', `/api/cmap/topics/${a.id}/concepts`, { term: 'x' });
  await seed(page, 'POST', `/api/cmap/topics/${a1.id}/concepts`, { term: 'y' });
  await seed(page, 'POST', `/api/cmap/topics/${a1.id}/concepts`, { term: 'z' });
  await seed(page, 'POST', '/api/cmap/topics', { title: '다른' });
  await reload(page);
  await pickNode(page, 'A');
  await page.click('#act-delete');
  await waitOpen(page, 'confirm-dlg');
  assert.match(await page.text('#confirm-heading'), /최상위 주제 삭제/);
  assert.match(await page.text('#confirm-text'), /하위 주제 1개, 개념 3개/);
  assert.match(await page.text('#confirm-text'), /되돌릴 수 없습니다/);
  await page.click('#confirm-cancel');
  await waitClosed(page, 'confirm-dlg');
  assert.equal(srv.db.topics.length, 3, '취소하면 아무것도 지워지지 않음');
  await page.click('#act-delete');
  await waitOpen(page, 'confirm-dlg');
  await page.click('#confirm-ok');
  await waitClosed(page, 'confirm-dlg');
  await page.waitFor("[...document.querySelectorAll('#topic-list [data-t=node] .t-title')].every(e => e.textContent !== 'A') && !document.getElementById('landing-view').hidden", 4000, '삭제 뒤 랜딩');
  assert.deepEqual(await titles(page), ['다른']);
  assert.equal(srv.db.topics.length, 1); assert.equal(srv.db.concepts.length, 0);
  noErrors(page);
});

test('삭제 확인창: 하위 주제는 부모로 옮겨지는 범위를 안내, 이름이 겹치면 서버 문구를 보이고 열어 둔 채 아무것도 바뀌지 않음', { skip: SKIP, timeout: 60000 }, async t => {
  const { page, srv } = await open(t);
  const a = (await seed(page, 'POST', '/api/cmap/topics', { title: 'A' })).topic;
  const b = (await seed(page, 'POST', '/api/cmap/topics', { title: 'B', parent_id: a.id })).topic;
  const c = (await seed(page, 'POST', '/api/cmap/topics', { title: '공통', parent_id: b.id })).topic;
  await seed(page, 'POST', `/api/cmap/topics/${b.id}/concepts`, { term: 'k1' });
  await seed(page, 'POST', `/api/cmap/topics/${b.id}/concepts`, { term: 'k2' });
  await seed(page, 'POST', '/api/cmap/topics', { title: '공통', parent_id: a.id });
  await reload(page);
  await pickNode(page, 'B');
  await page.click('#act-delete');
  await waitOpen(page, 'confirm-dlg');
  assert.match(await page.text('#confirm-heading'), /하위 주제 삭제/);
  assert.match(await page.text('#confirm-text'), /하위 주제 1개와 이 주제의 개념 2개는 상위 주제 ‘A’/);
  const before = srv.db.snapshot();
  await page.click('#confirm-ok');                                                   // 이름 겹침 → 409
  await page.waitFor("document.getElementById('confirm-msg').textContent.length > 0", 4000);
  assert.match(await page.text('#confirm-msg'), /겹치는 이름/);
  assert.match(await page.text('#confirm-msg'), /'공통'/);
  assert.equal(await dlgOpen(page, 'confirm-dlg'), true);
  assert.equal(srv.db.snapshot(), before, '아무것도 바뀌지 않음(자동 개명 없음)');
  await page.click('#confirm-cancel');
  await waitClosed(page, 'confirm-dlg');
  // 겹치는 이름을 고친 뒤에는 삭제되고 선택이 부모로 옮겨짐
  await seed(page, 'PATCH', `/api/cmap/topics/${c.id}`, { title: '공통 이론' });
  await reload(page);
  await pickNode(page, 'B');
  await page.click('#act-delete');
  await waitOpen(page, 'confirm-dlg');
  await page.click('#confirm-ok');
  await waitClosed(page, 'confirm-dlg');
  await page.waitFor("[...document.querySelectorAll('#topic-list [data-t=node] .t-title')].every(e => e.textContent.split(' › ').pop() !== 'B')", 4000);
  assert.equal(await selected(page), 'A', '삭제 뒤 부모가 선택됨');
  assert.equal(await page.eval("byId(S.selectedId).concept_count"), 2, '개념 2개가 부모로 옮겨짐');
  noErrors(page);
});

test('개념 입력: 추가(이름·영문·메모) → 목록 표시·주제 옆 개수, 중복은 대화상자 안에 오류, 수정, 삭제 확인', { skip: SKIP, timeout: 60000 }, async t => {
  const { page } = await open(t);
  await seed(page, 'POST', '/api/cmap/topics', { title: '물리' });
  await reload(page);
  await pickNode(page, '물리');
  await page.waitFor("!document.getElementById('concepts-empty').hidden", 4000, '개념 없음 안내(목록 조회가 끝난 뒤)');
  await page.click('#add-concept-btn');
  await waitOpen(page, 'concept-dlg');
  await page.click('#concept-ok');
  assert.match(await page.text('#concept-msg'), /개념 이름을 입력해 주세요/);
  await page.type('#concept-term', '힘');
  await page.type('#concept-english', 'force');
  await page.type('#concept-memo', '질량 × 가속도');
  await page.click('#concept-ok');
  await waitClosed(page, 'concept-dlg');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 1", 4000);
  assert.equal(await page.count('#concept-list .c-card'), 0, '280-2: 추가한 개념은 한 줄(접힘)으로 시작');
  await page.click('#concept-list .c-toggle');
  await page.waitFor("!!document.querySelector('#concept-list .c-card')", 3000);
  assert.equal(await page.text('#concept-list .c-term'), '힘');
  assert.equal(await page.text('#concept-list .c-en'), 'force');
  assert.equal(await page.text('#concept-list .c-memo'), '질량 × 가속도');
  assert.equal(await page.eval("document.getElementById('concepts-empty').hidden"), true);
  assert.match(await page.text('#topic-list [data-t=node] .t-count'), /개념 1/, '주제 옆 개수가 갱신됨');
  // 중복(대소문자 무시)
  await page.click('#add-concept-btn');
  await waitOpen(page, 'concept-dlg');
  await page.type('#concept-term', '힘');
  await page.click('#concept-ok');
  await page.waitFor("document.getElementById('concept-msg').textContent.length > 0", 4000);
  assert.match(await page.text('#concept-msg'), /이미 있습니다/);
  assert.equal(await dlgOpen(page, 'concept-dlg'), true);
  await page.click('#concept-cancel');
  await waitClosed(page, 'concept-dlg');
  // 수정: 값이 채워져 있고 메모를 지우면 목록에서 사라짐
  await page.click('[data-t=concept-edit]');                              // 280-2: 수정은 카드 안에서(입력칸으로 바뀜), [완료]가 서버 저장까지
  await page.waitFor("!!document.getElementById('edit-term')", 3000);
  assert.equal(await page.eval("document.getElementById('edit-term').value"), '힘');
  assert.equal(await page.eval("document.getElementById('edit-english').value"), 'force');
  await page.type('#edit-term', '힘(F)');
  await page.type('#edit-memo', '');
  await page.click('#edit-done');
  await page.waitFor("!document.getElementById('edit-done') && document.querySelector('#concept-list .c-term').textContent === '힘(F)'", 4000);
  assert.equal(await page.eval("!document.querySelector('#concept-list .c-memo')"), true, '지운 메모는 표시되지 않음');
  // 삭제 확인
  await page.click('[data-t=concept-delete]');
  await waitOpen(page, 'confirm-dlg');
  assert.match(await page.text('#confirm-text'), /‘힘\(F\)’을\(를\) 삭제할까요\?/);
  await page.click('#confirm-cancel');
  await waitClosed(page, 'confirm-dlg');
  assert.equal(await page.count('#concept-list [data-t=concept]'), 1, '취소하면 그대로');
  await page.click('[data-t=concept-delete]');
  await waitOpen(page, 'confirm-dlg');
  await page.click('#confirm-ok');
  await waitClosed(page, 'confirm-dlg');
  await page.waitFor("document.querySelectorAll('#concept-list [data-t=concept]').length === 0", 4000);
  assert.equal(await page.eval("document.getElementById('concepts-empty').hidden"), false);
  assert.equal(await page.hasHorizontalScroll(), false);
  noErrors(page);
});

test('권한 없는 계정은 접근 거부, API 호출도 하지 않음(fail-closed 유지)', { skip: SKIP, timeout: 30000 }, async t => {
  const srv = await startCmapServer({ perm: false });
  t.after(() => srv.close());
  const page = await browser.newPage({ width: 390, height: 844, token: srv.token() });
  t.after(() => page.close());
  await page.goto(srv.url + '/concept_map.html');
  await page.waitFor("document.getElementById('loading').hidden", 6000);
  assert.equal(await page.eval("!document.getElementById('access-denied').hidden"), true);
  assert.equal(await page.eval("document.getElementById('app').hidden"), true);
  assert.equal(srv.db.queries.filter(q => /cmap_/.test(q)).length, 0, '데이터 조회가 일어나지 않음');
});
