// 작업195-2: 개념학습 화면(목록·시작·상세·다음 제안) 헤드리스 Chrome 테스트(모의 API).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀. CHROME_PATH로 위치 지정 가능)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { dialogAnswer } = require('./helpers/dialog');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const WIDTHS = [[390, 844], [768, 1024], [1024, 800]];
let browser, srv;

test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

async function open(opts = {}) {
  srv.reset();
  if (opts.setup) opts.setup(srv);
  const page = await browser.newPage({ width: opts.width || 390, height: opts.height || 844, token: opts.noToken ? null : 'test-token' });
  await page.goto(srv.url + '/concept_study.html' + (opts.hash || ''));
  // 권한 안내가 보이거나, 앱이 열리고 목록(또는 빈 안내·오류 문구)이 그려질 때까지 기다린다
  if (!opts.noWait) await page.waitFor(`!document.getElementById('access-denied').hidden || (!document.getElementById('app').hidden && (!document.getElementById('study-rows').hidden || !document.getElementById('list-empty').hidden || document.getElementById('list-msg').innerText !== '' || !document.getElementById('view-study').hidden))`, 8000);
  return page;
}
const seedBasic = s => s.seed({ topic: '생물 · 세포', items: [{ term: '세포' }, { term: '광합성' }], links: [[0, 1]], path: [0, 1] });
const openStudy = async (opts = {}) => {
  const page = await open({ ...opts, setup: opts.setup || seedBasic });
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  return page;
};
const term = p => p.text('[data-t="term"]');
const lastCall = (path, method) => srv.state.log.filter(l => l.url === path && (!method || l.method === method)).pop();
const calls = (re, method) => srv.state.log.filter(l => re.test(l.url) && (!method || l.method === method));
async function done(page) { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); }

test('권한: perm_concept_study가 false면 안내만 보이고, 비로그인은 로그인 안내', { skip: SKIP }, async () => {
  let page = await open({ setup: s => { s.state.me.perm_concept_study = false; } });
  assert.equal(await page.visible('#access-denied'), true);
  assert.match(await page.text('#access-denied'), /이용 권한이 없습니다/);
  assert.equal(await page.visible('#app'), false);
  assert.equal(calls(/^\/api\/concepts/).length, 0, '권한 없으면 API를 부르지 않음');
  await done(page);
  // /api/me 오류·필드 없음은 통과(다른 화면과 같은 fail-open)
  page = await open({ setup: s => { delete s.state.me.perm_concept_study; } });
  assert.equal(await page.visible('#access-denied'), false);
  await done(page);
  // 비로그인(토큰 없음): 화면은 열리고 목록 호출이 401 → 안내
  page = await open({ noToken: true, setup: s => { s.state.authed = false; } });
  await page.waitFor("document.getElementById('list-msg').innerText.includes('로그인이 필요합니다')");
  await done(page);
});

test('시작 흐름: 입력 검증 → 학습 생성 → explore(start) → 개념 상세', { skip: SKIP }, async () => {
  const page = await open();
  assert.equal(await page.visible('#list-empty'), true);
  await page.click('#start-open');
  assert.equal(await page.visible('#start-form'), true);
  await page.click('#start-submit');
  assert.equal(await page.text('#start-msg'), '분야를 입력해 주세요.');
  await page.type('#start-topic', '생물 · 세포');
  await page.click('#start-submit');
  assert.equal(await page.text('#start-msg'), '첫 개념 또는 짧은 질문을 입력해 주세요.');
  await page.setValue('#start-topic', 'ㄱ'.repeat(81));
  await page.type('#start-first', '광합성');
  await page.click('#start-submit');
  assert.equal(await page.text('#start-msg'), '분야는 80자 이하여야 합니다.');
  await page.setValue('#start-topic', '생물 · 세포');
  await page.setValue('#start-first', 'ㄴ'.repeat(81));
  await page.click('#start-submit');
  assert.equal(await page.text('#start-msg'), '첫 개념 또는 질문은 80자 이하여야 합니다.');
  assert.equal(calls(/^\/api\/concepts/, 'POST').length, 0, '검증 실패 중에는 쓰기 호출 없음');
  await page.setValue('#start-first', '광합성');
  await page.click('#start-submit');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  assert.equal(await term(page), '광합성');
  assert.equal(await page.text('#study-title'), '생물 · 세포');
  assert.deepEqual(lastCall(`/api/concepts/studies/${srv.state.studies[0].id}/explore`).body, { text: '광합성', via: 'start' });
  assert.equal(await page.eval('location.hash'), '#s=' + srv.state.studies[0].id);
  await done(page);
});

test('시작 중 explore가 실패해도 학습은 열리고 입력이 아래 입력창에 남음', { skip: SKIP }, async () => {
  const page = await open({ setup: s => { s.state.explorePlan = [{ status: 429, body: { error: '하루 60건까지 AI 설명을 받을 수 있습니다.' } }]; } });
  await page.click('#start-open');
  await page.type('#start-topic', '물리');
  await page.type('#start-first', '관성');
  await page.click('#start-submit');
  await page.waitFor("document.getElementById('study-msg').innerText.includes('하루 60건까지')");
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '관성');
  assert.equal(srv.state.studies.length, 1);
  await done(page);
});

test('목록 행: 이름·개념 수·이해 수·날짜, 이름 수정(검증 포함), 삭제 확인', { skip: SKIP }, async () => {
  const page = await open({ setup: s => { seedBasic(s); s.state.items[0].review_state = 'understood'; } });
  const row = await page.text('.row');
  assert.match(row, /생물 · 세포/);
  assert.match(row, /개념 2/); assert.match(row, /이해 1/); assert.match(row, /5월 2일/);
  // 수정
  await page.click('[data-t="rename-study"]');
  await page.type('.row-edit input', '');
  await page.click('[data-t="rename-save"]');
  assert.match(await page.text('.row-edit .msg'), /분야 이름을 입력/);
  await page.type('.row-edit input', '세포 생물학');
  await page.click('[data-t="rename-save"]');
  await page.waitFor("document.querySelector('.row-title') && document.querySelector('.row-title').innerText === '세포 생물학'");
  assert.equal(srv.state.studies[0].topic, '세포 생물학');
  // 삭제: 취소하면 남고, 확인하면 삭제
  await page.click('[data-t="delete-study"]');
  assert.match(await dialogAnswer(page, false), /개념 2개가 모두 삭제/);   // 작업207: 기본 confirm 대신 공용 대화상자
  await sleep(150);
  assert.equal(page.dialogs.length, 0, '기본 대화상자는 쓰지 않음');
  assert.equal(srv.state.studies.length, 1);
  await page.click('[data-t="delete-study"]');
  await dialogAnswer(page, true);
  await page.waitFor("document.getElementById('list-empty') && !document.getElementById('list-empty').hidden");
  assert.equal(srv.state.studies.length, 0);
  assert.equal(srv.state.items.length, 0);
  await done(page);
});

test('상세 표시: 이름·영어·그룹·정의·예시·쉬운/깊은 설명, AI 설명·확인 필요, 이어진 개념(위치)', { skip: SKIP }, async () => {
  const page = await openStudy();
  assert.equal(await term(page), '광합성');
  const t = await page.text('#detail');
  for (const s of ['english 광합성', '기본 그룹', '정의', '광합성의 정의입니다.', '예시', '광합성의 예시입니다.', '쉬운 설명', '더 깊게 설명', '광합성을(를) 깊게 보면']) assert.ok(t.includes(s), s);
  assert.equal(await page.text('[data-t="source"]'), 'AI 설명 · 확인 필요');
  assert.match(await page.text('[data-t="place"]'), /‘세포’에서 이어짐 \(이어짐 · 포함\)/);
  await done(page);
});

test('직접 수정: 저장하면 "직접 수정" 표기, 한도 초과·취소 처리', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="edit-open"]');
  assert.equal(await page.visible('#edit-host form'), true);
  await page.setValue('#edit-example', 'x'.repeat(1001));
  await page.click('[data-t="edit-save"]');
  assert.match(await page.text('#edit-host .msg'), /예시은\(는\) 1000자 이하/);
  await page.setValue('#edit-example', '직접 쓴 예시');
  await page.type('#edit-definition', '직접 고친 정의');
  await page.click('[data-t="edit-save"]');
  await page.waitFor("document.querySelector('[data-t=source]') && document.querySelector('[data-t=source]').innerText === '직접 수정'");
  assert.match(await page.text('#detail'), /직접 고친 정의/);
  assert.match(await page.text('#detail'), /직접 쓴 예시/);
  const patch = lastCall('/api/concepts/items/' + srv.state.items[1].id, 'PATCH').body;
  assert.deepEqual(Object.keys(patch).sort(), ['definition', 'example'], '바뀐 필드만 보냄');
  assert.equal(srv.state.items[1].content_source, 'user');
  // 취소
  await page.click('[data-t="edit-open"]');
  await page.click('#edit-host .btn.text');
  assert.equal(await page.exists('#edit-host form'), false);
  await done(page);
});

test('설명이 없는 개념: 안내와 [AI 설명 받기](같은 이름 explore 재호출)', { skip: SKIP }, async () => {
  const page = await openStudy({ setup: s => s.seed({ items: [{ term: '삼투', filled: false }], path: [0] }) });
  assert.match(await page.text('[data-t="no-explain"]'), /아직 설명이 없습니다/);
  assert.equal(await page.exists('[data-t="source"]'), false);
  assert.equal(await page.exists('[data-t="suggest-main"]'), false);
  await page.click('[data-t="get-explain"]');
  await page.waitFor("document.querySelector('[data-t=source]')");
  assert.equal(await page.text('[data-t="source"]'), 'AI 설명 · 확인 필요');
  const c = calls(/explore$/).pop();
  assert.equal(c.body.text, '삼투');
  assert.equal(srv.state.items.length, 1, '새 개념을 만들지 않고 다시 채움');
  await done(page);
});

test('다음 한 단계: 기본 제안 1개(이유·관계·부담) + 접힌 대안 2개', { skip: SKIP }, async () => {
  const page = await openStudy();
  const main = await page.text('[data-t="suggest-main"]');
  for (const s of ['광합성 다음 A', '지금 필요한 이유', '광합성을(를) 이해하는 데 바로 필요합니다.', '현재 개념과의 관계', '구성 요소 · 포함', '예상 학습 부담', '가벼움', '이 개념 추가', '나중에', '제외']) assert.ok(main.includes(s), s);
  assert.equal(await page.count('[data-t="suggest-main"]'), 1);
  assert.equal(await page.eval("document.querySelector('[data-t=alts]').open"), false, '대안은 접혀 있음');
  assert.match(await page.text('[data-t="alts"] summary'), /다른 후보 2개/);
  await page.click('[data-t="alts"] summary');
  assert.equal(await page.visible('[data-t="suggest-alt"]'), true);
  assert.equal(await page.count('[data-t="suggest-alt"]'), 2);
  const alt = await page.text('[data-t="suggest-alt"]');
  assert.ok(alt.includes('광합성 다음 B') && alt.includes('보통') && alt.includes('반대 개념 · 대비'));
  await done(page);
});

test('제안 선택: explore(suggestion, from) → 새 개념이 선택되고 연결·경로 반영', { skip: SKIP }, async () => {
  const page = await openStudy();
  const fromId = srv.state.items[1].id;
  await page.click('[data-t="suggest-main"] [data-t="suggest-add"]');
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '광합성 다음 A'");
  const body = calls(/explore$/).pop().body;
  assert.deepEqual(body, { text: '광합성 다음 A', via: 'suggestion', from_item_id: fromId });
  assert.match(await page.text('[data-t="place"]'), /‘광합성’에서 이어짐/);
  assert.equal(srv.state.links.length, 2);
  assert.equal(srv.state.studies[0].path.length, 3);
  // 새 개념 상세가 화면 안에 보임
  assert.equal(await page.eval("(() => { const r = document.querySelector('[data-t=term]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), true);
  await done(page);
});

test('보류·제외: 개념이 만들어지되 status가 바뀌고 제안에서 사라지며 선택은 유지', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="suggest-main"] [data-t="suggest-hold"]');
  await page.waitFor("document.querySelector('[data-t=suggest-main]').dataset.term === '광합성 다음 B'");
  let held = srv.state.items.find(i => i.term === '광합성 다음 A');
  assert.equal(held.status, 'held'); assert.equal(held.origin, 'AI 제안'); assert.equal(held.content_source, 'none');
  assert.equal(await term(page), '광합성', '선택은 그대로');
  assert.equal(calls(/explore$/).length, 0, 'AI를 부르지 않음');
  await page.click('[data-t="suggest-main"] [data-t="suggest-exclude"]');
  await page.waitFor("document.querySelector('[data-t=suggest-main]').dataset.term === '광합성 다음 C'");
  assert.equal(srv.state.items.find(i => i.term === '광합성 다음 B').status, 'excluded');
  assert.equal(await page.exists('[data-t="alts"]'), false, '대안이 없으면 접기 없음');
  await done(page);
});

test('반응 3종: 더 쉬운 설명·더 깊게는 해당 설명만, 다른 길은 제안만 바꿈', { skip: SKIP }, async () => {
  const page = await openStudy();
  const id = srv.state.items[1].id;
  await page.click('[data-t="react-easier"]');
  await page.waitFor("document.querySelector('[data-f=simple_text] p').innerText === '더 쉬운 설명입니다.'");
  assert.deepEqual(lastCall(`/api/concepts/items/${id}/respond`).body, { kind: 'easier' });
  assert.match(await page.text('[data-f="deeper_text"] p'), /깊게 보면/);
  await page.click('[data-t="react-deeper"]');
  await page.waitFor("document.querySelector('[data-f=deeper_text] p').innerText === '더 깊은 설명입니다.'");
  assert.equal(await page.text('[data-f="simple_text"] p'), '더 쉬운 설명입니다.');
  await page.click('[data-t="react-other"]');
  await page.waitFor("document.querySelector('[data-t=suggest-main]').dataset.term === '다른 길 제안 X'");
  assert.deepEqual(calls(/respond$/).map(c => c.body.kind), ['easier', 'deeper', 'other']);
  assert.equal(await page.exists('[data-t="alts"]'), false);
  await done(page);
});

test('제안이 없으면 안내와 [제안 다시 받기]; 남은 제안이 있다는 서버 응답·실패를 그대로 안내', { skip: SKIP }, async () => {
  const page = await openStudy({ setup: s => { seedBasic(s); s.state.items[1].suggestions = []; } });
  assert.match(await page.text('[data-t="no-suggest"]'), /남은 제안이 없습니다/);
  assert.equal(await page.visible('[data-t="react-easier"]'), true);
  srv.state.refreshPlan = [{ aiError: true }];
  await page.click('[data-t="refresh-suggest"]');
  await page.waitFor("document.getElementById('study-msg').innerText.includes('AI 설명을 받지 못했습니다. 다시 받아 보세요.')");
  await page.click('[data-t="ai-retry"]');
  await page.waitFor("document.querySelector('[data-t=suggest-main]') && document.querySelector('[data-t=suggest-main]').dataset.term === '새로 받은 제안 Y'");
  assert.equal(calls(/suggestions\/refresh$/).length, 2);
  // 화면이 낡은 상태에서 서버가 "남은 제안 있음"(refreshed:false)으로 답하는 경우
  srv.state.items[1].suggestions = [{ term: '아직 남음', reason: '', relation_type: '순서', relation_label: '', load: '보통' }];
  await page.eval("S.items.find(i => i.id === S.selId).suggestions = []; renderStudy()");
  await page.click('[data-t="refresh-suggest"]');
  await page.waitFor("document.getElementById('study-msg').innerText.includes('아직 남은 제안이 있어 새로 받지 않았습니다.')");
  await done(page);
});

test('ai_error: 안내 문구와 [다시 받기]로 같은 이름을 다시 받음(from 유지)', { skip: SKIP }, async () => {
  const page = await openStudy();
  const fromId = srv.state.items[1].id;
  srv.state.explorePlan = [{ aiError: true }];
  await page.type('#ask-input', '엽록체');
  await page.click('#ask-submit');
  await page.waitFor("document.getElementById('study-msg').innerText.includes('AI 설명을 받지 못했습니다. 다시 받아 보세요.')");
  assert.equal(await term(page), '엽록체', '개념은 남아 선택됨');
  assert.match(await page.text('[data-t="no-explain"]'), /아직 설명이 없습니다/);
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '', '개념이 저장되었으므로 입력창은 비움');
  await page.click('[data-t="ai-retry"]');
  await page.waitFor("document.querySelector('[data-t=source]')");
  const [first, retry] = calls(/explore$/).map(c => c.body);
  assert.deepEqual(first, { text: '엽록체', via: 'input', from_item_id: fromId });
  assert.deepEqual(retry, { text: '엽록체', via: 'input', from_item_id: fromId });
  assert.equal(await page.text('#study-msg'), '1개 연결을 만들었습니다.');   // 작업209/210: AI 연결 알림(오류 문구는 사라짐)
  assert.equal(srv.state.items.filter(i => i.term === '엽록체').length, 1);
  assert.equal(srv.state.links.filter(l => l.to_item_id === srv.state.items.find(i => i.term === '엽록체').id).length, 1, '다시 받은 뒤 연결 생성');
  await done(page);
});

test('하단 입력창: 검증, 429 서버 문구 그대로, 네트워크 오류 시 입력 유지, 성공 시 비움', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('#ask-submit');
  assert.equal(await page.text('#ask-msg'), '개념이나 짧은 질문을 입력해 주세요.');
  await page.setValue('#ask-input', 'ㄱ'.repeat(81));
  await page.click('#ask-submit');
  assert.equal(await page.text('#ask-msg'), '80자 이하로 입력해 주세요.');
  assert.equal(calls(/explore$/).length, 0);
  // 429
  srv.state.explorePlan = [{ status: 429, body: { error: '하루 2건까지 AI 설명을 받을 수 있습니다.' } }];
  await page.type('#ask-input', '리보솜');
  await page.click('#ask-submit');
  await page.waitFor("document.getElementById('study-msg').innerText.includes('하루 2건까지 AI 설명을 받을 수 있습니다.')");
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '리보솜');
  // 네트워크 오류
  srv.state.explorePlan = [{ network: true }];
  await page.click('#ask-submit');
  await page.waitFor("document.getElementById('study-msg').innerText.includes('네트워크에 연결할 수 없습니다')");
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '리보솜', '입력 내용 유지');
  assert.equal(srv.state.items.some(i => i.term === '리보솜'), false);
  srv.state.networkDown = false;
  // 중복(409)
  await page.setValue('#ask-input', '세포');
  await page.click('#ask-submit');
  await page.waitFor("document.getElementById('study-msg').innerText.includes('이미 있는 개념입니다.')");
  // 성공
  await page.setValue('#ask-input', '리보솜');
  await page.click('#ask-submit');
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '리보솜'");
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '');
  assert.equal(await page.text('#study-msg'), '1개 연결을 만들었습니다.');   // 작업209/210: 성공하면 오류 문구 대신 연결 알림
  await done(page);
});

test('AI 대기 중: 버튼 비활성과 "설명을 만드는 중…" 표시', { skip: SKIP }, async () => {
  const page = await openStudy({ setup: s => { seedBasic(s); s.state.delayMs = 700; } });
  await page.type('#ask-input', '리보솜');
  await page.click('#ask-submit');
  await page.waitFor("!document.getElementById('study-busy').hidden");
  assert.match(await page.text('#study-busy'), /설명을 만드는 중…/);
  assert.equal(await page.eval("[...document.querySelectorAll('#view-study button')].every(b => b.disabled)"), true);
  assert.equal(await page.eval("document.getElementById('ask-input').value"), '리보솜', '대기 중에도 입력 유지');
  await page.waitFor("document.getElementById('study-busy').hidden && document.querySelector('[data-t=term]').innerText === '리보솜'", 8000);
  assert.equal(await page.eval("[...document.querySelectorAll('#view-study button')].some(b => b.disabled)"), false, '끝나면 다시 활성');
  await done(page);
});

test('이해함 토글·메모 자동 저장·개념 삭제 확인', { skip: SKIP }, async () => {
  const page = await openStudy();
  const it = () => srv.state.items[1];
  assert.equal(await page.eval("document.querySelector('[data-t=understood]').getAttribute('aria-pressed')"), 'false');
  await page.click('[data-t="understood"]');
  await page.waitFor("document.querySelector('[data-t=understood]').getAttribute('aria-pressed') === 'true'");
  assert.equal(it().review_state, 'understood');
  await page.click('[data-t="understood"]');
  await page.waitFor("document.querySelector('[data-t=understood]').getAttribute('aria-pressed') === 'false'");
  assert.equal(it().review_state, 'new');
  // 메모: 입력 멈춘 뒤 한 번만 저장되고 "저장됨"
  const before = calls(/\/api\/concepts\/items\/\d+$/, 'PATCH').length;
  await page.type('#note-input', '메모 내용');
  assert.equal(await page.text('#note-state'), '입력 중…');
  await page.type('#note-input', ' 추가', { clear: false });
  await page.waitFor("document.getElementById('note-state').innerText === '저장됨'", 4000);
  assert.equal(it().note, '메모 내용 추가');
  assert.equal(calls(/\/api\/concepts\/items\/\d+$/, 'PATCH').length - before, 1, '디바운스로 한 번만 저장');
  // 삭제: 취소 → 유지, 확인 → 삭제 후 다른 개념 선택
  await page.click('[data-t="delete-item"]');
  assert.match(await dialogAnswer(page, false), /개념을 삭제할까요/);   // 작업207: 기본 confirm 대신 공용 대화상자
  await sleep(150);
  assert.equal(srv.state.items.length, 2);
  await page.click('[data-t="delete-item"]');
  await dialogAnswer(page, true);
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '세포'");
  assert.equal(srv.state.items.length, 1);
  assert.equal(srv.state.links.length, 0);
  await done(page);
});

test('개념이 없는 학습: 안내만 보이고 입력창으로 시작할 수 있음', { skip: SKIP }, async () => {
  const page = await open({ setup: s => s.seed({ items: [] }) });
  await page.click('[data-t="open-study"]');
  await page.waitFor("!document.getElementById('study-empty').hidden");
  assert.equal(await page.visible('#detail-wrap'), false);
  await page.type('#ask-input', '세포막');
  await page.click('#ask-submit');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  assert.equal(await term(page), '세포막');
  assert.equal(calls(/explore$/).pop().body.from_item_id, undefined);
  await done(page);
});

test('뒤로가기·해시 이동, 지도/목록 전환(기본은 지도)', { skip: SKIP }, async () => {
  const page = await openStudy();
  assert.equal(await page.eval('location.hash.startsWith("#s=")'), true);
  assert.equal(await page.eval("document.getElementById('seg-map').getAttribute('aria-pressed')"), 'true');
  await page.click('#seg-list');
  assert.equal(await page.eval("document.getElementById('seg-list').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.exists('[data-t="list-item"]'), true);
  await page.click('#seg-map');
  // 작업209-4: 지도 화면에는 [지도 보기] 버튼이 있고, 눌러야 지도가 그려진다
  assert.equal(await page.exists('[data-t="map-svg"]'), false);
  await page.click('[data-t="map-open"]');
  await page.waitFor("document.getElementById('map-sheet').open && !!document.querySelector('[data-t=map-svg]')");
  await page.click('#map-close');
  await page.waitFor("!document.getElementById('map-sheet').open");
  await page.click('#back-btn');
  await page.waitFor("!document.getElementById('view-list').hidden");
  assert.equal(await page.count('.row'), 1);
  await done(page);
});

for (const [w, h] of WIDTHS) {
  test(`레이아웃 ${w}px: 목록·학습 화면 가로 스크롤 없음, 하단 입력창이 마지막 내용을 가리지 않음, 터치 영역 44px`, { skip: SKIP }, async () => {
    const page = await open({ width: w, height: h, setup: s => { seedBasic(s); s.state.items[1].note = '긴 메모 '.repeat(30); s.state.items[1].definition = '긴 정의 '.repeat(60); } });
    assert.equal(await page.hasHorizontalScroll(), false, '목록');
    await page.click('[data-t="open-study"]');
    await page.waitFor("!!document.querySelector('[data-t=term]')");
    assert.equal(await page.hasHorizontalScroll(), false, '학습');
    await page.click('[data-t="alts"] summary');
    // 페이지 끝까지 내려도 마지막 버튼이 하단 입력창 위에 있어 눌린다
    await page.click('[data-t="react-other"]').catch(e => { throw e; });
    await page.waitFor("!!document.querySelector('[data-t=suggest-main]')");
    const small = await page.eval(`[...document.querySelectorAll('#app button:not([hidden]), #app summary')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5) && !b.classList.contains('text'); }).map(b => b.getAttribute('data-t') || b.id || b.textContent.trim())`);
    assert.deepEqual(small, [], '44px 미만 터치 요소');
    assert.equal(await page.hasHorizontalScroll(), false);
    await done(page);
  });
}
