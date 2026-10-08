// 작업209-3/210: 연결마다 이유 문장만 표시(상태 배지·라벨 없음, 이유가 없으면 줄 자체가 없음), 연결 수정(PATCH)·방향 바꾸기·삭제,
// 연결선 카드, 개념 추가 직후 "N개 연결을 만들었습니다." 알림(헤드리스 Chrome, 모의 API).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { dialogAnswer } = require('./helpers/dialog');
const { openMap } = require('./helpers/map');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

// 세포와 이어진 연결 4개: AI(이유 있음) / 고친 연결 / 직접 연결 / AI(이유 없음). 저장값(source·user_edited)은 다르지만 화면에는 드러나지 않아야 한다
function seed(s) {
  return s.seed({
    topic: '생물 · 세포',
    items: [{ term: '세포' }, { term: '광합성' }, { term: '엽록체' }, { term: '미토콘드리아' }, { term: '핵' }],
    links: [
      [0, 1, { relation_type: '원인→결과', label: '필요함', detail: '세포 안에서 일어나기 때문입니다.' }],
      [0, 2, { relation_type: '포함', label: '', detail: '내가 고친 이유', source: 'ai', user_edited: true }],
      [0, 3, { relation_type: '비슷함', label: '', detail: '내가 직접 이은 이유', source: 'user' }],
      [0, 4, { relation_type: '기타 관련', label: '', detail: '', source: 'ai' }],
    ],
    path: [0],
  });
}
async function openStudy(width = 390) {
  srv.reset();
  seed(srv);
  const page = await browser.newPage({ width, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  return page;
}
const calls = (re, method) => srv.state.log.filter(l => re.test(l.url) && (!method || l.method === method));
async function rows(page) {
  return page.eval(`[...document.querySelectorAll('[data-t=link]')].map(e => ({
    pair: e.querySelector('.lk-pair').textContent,
    reason: e.querySelector('[data-t=link-reason]') ? e.querySelector('[data-t=link-reason]').textContent : null,
  }))`);
}
const byPair = (list, to) => list.find(r => r.pair.endsWith(to));
// 작업210: 제거된 상태 문구(연결 목록·연결 카드 어디에도 없어야 함)
const BANNED = /AI 판단|확인 필요|직접 연결|직접 수정|이유 없음/;

test('연결 목록: 관계 종류·문구·이유 문장만 보임, 상태 배지·라벨 없음, 이유가 없으면 이유 줄 자체가 없음', { skip: SKIP }, async () => {
  const page = await openStudy();
  const list = await rows(page);
  assert.equal(list.length, 4);
  const ai = byPair(list, '광합성'), edited = byPair(list, '엽록체'), mine = byPair(list, '미토콘드리아'), none = byPair(list, '핵');
  assert.match(ai.reason, /연결한 이유 세포 안에서 일어나기 때문입니다\./);
  assert.match(edited.reason, /내가 고친 이유/);
  assert.match(mine.reason, /내가 직접 이은 이유/);
  assert.equal(none.reason, null, '이유가 없으면 이유 줄이 없음');
  assert.equal(await page.count('[data-t="link-source"]'), 0, '상태 배지 요소 없음');
  assert.equal(await page.eval("document.querySelectorAll('[data-t=link]')[3].children.length"), 1, '이유 없는 연결은 줄 하나(쌍·종류)만');
  const text = await page.text('#linksec');
  assert.doesNotMatch(text, BANNED, '제거된 문구가 화면에 없음');
  assert.match(await page.text('[data-t="link"] .lk-meta'), /원인→결과 · 필요함/, '관계 종류와 문구는 그대로');
  // 저장값은 그대로 유지(화면에서만 숨김)
  assert.deepEqual(srv.state.links.map(l => [l.source, !!l.user_edited]), [['ai', false], ['ai', true], ['user', false], ['ai', false]]);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('수정 폼: 기존 값이 채워지고, 바뀐 것만 PATCH로 보내며 저장하면 새 이유가 보임(배지 없음, user_edited는 저장)', { skip: SKIP }, async () => {
  const page = await openStudy();
  const target = srv.state.links[0];
  await page.click('[data-t="link"][data-id="' + target.id + '"] [data-t="link-edit"]');
  await page.waitFor("!!document.querySelector('[data-t=link-edit-form]')");
  assert.equal(await page.eval("document.querySelector('[data-t=edit-type]').value"), '원인→결과');
  assert.equal(await page.eval("document.querySelector('[data-t=edit-label]').value"), '필요함');
  assert.equal(await page.eval("document.querySelector('[data-t=edit-reason]').value"), '세포 안에서 일어나기 때문입니다.');
  assert.equal(await page.text('[data-t="edit-pair"]'), '세포 → 광합성');
  await page.type('[data-t="edit-reason"]', '새로 쓴 이유');
  await page.click('[data-t="link-edit-save"]');
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  const patch = calls(/\/api\/concepts\/links\/\d+$/, 'PATCH');
  assert.equal(patch.length, 1);
  assert.deepEqual(patch[0].body, { detail: '새로 쓴 이유' }, '바뀐 필드만 전송');
  const list = await rows(page);
  const row = byPair(list, '광합성');
  assert.match(row.reason, /새로 쓴 이유/);
  assert.equal(srv.state.links[0].user_edited, true, '수정 표시는 저장만');
  assert.doesNotMatch(await page.text('#linksec'), BANNED);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('수정 폼: 관계 종류·문구 변경, 이유 비우면 이유 줄이 사라짐, 바뀐 게 없으면 PATCH 없이 닫힘', { skip: SKIP }, async () => {
  const page = await openStudy();
  const target = srv.state.links[0];
  const sel = '[data-t="link"][data-id="' + target.id + '"]';
  await page.click(sel + ' [data-t="link-edit"]');
  await page.click('[data-t="link-edit-save"]');                      // 아무것도 안 바꾸고 저장
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  assert.equal(calls(/\/api\/concepts\/links\/\d+$/, 'PATCH').length, 0);
  assert.equal(srv.state.links[0].user_edited, false, '고치지 않았으면 수정 표시도 그대로');
  await page.click(sel + ' [data-t="link-edit"]');
  await page.eval(`(() => { const s = document.querySelector('[data-t=edit-type]'); s.value = '대비'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.type('[data-t="edit-label"]', '반대');
  await page.type('[data-t="edit-reason"]', '');
  await page.click('[data-t="link-edit-save"]');
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  assert.deepEqual(calls(/\/api\/concepts\/links\/\d+$/, 'PATCH')[0].body, { relation_type: '대비', label: '반대', detail: '' });
  const row = byPair(await rows(page), '광합성');
  assert.equal(row.reason, null, '이유를 비우면 이유 줄 자체가 없음');
  assert.equal(await page.text(sel + ' .lk-meta'), '대비 · 반대');
  await page.close();
});

test('수정 폼: 취소하면 변경 없음, 글자 수 초과·서버 오류는 폼에 표시하고 열려 있음', { skip: SKIP }, async () => {
  const page = await openStudy();
  const target = srv.state.links[0];
  const sel = '[data-t="link"][data-id="' + target.id + '"]';
  await page.click(sel + ' [data-t="link-edit"]');
  await page.eval("(() => { const t = document.querySelector('[data-t=edit-reason]'); t.removeAttribute('maxlength'); t.value = '가'.repeat(301); })()");
  await page.click('[data-t="link-edit-save"]');
  assert.match(await page.text('[data-t="link-edit-form"] .msg'), /300자 이하/);
  assert.equal(calls(/\/api\/concepts\/links\/\d+$/, 'PATCH').length, 0, '클라이언트에서 막음');
  await page.type('[data-t="edit-reason"]', '짧은 이유');
  srv.state.patchLinkPlan = [{ status: 400, body: { error: '서버가 거절한 문구' } }];
  await page.click('[data-t="link-edit-save"]');
  await page.waitFor("document.querySelector('[data-t=link-edit-form] .msg').textContent.length > 0");
  assert.equal(await page.text('[data-t="link-edit-form"] .msg'), '서버가 거절한 문구');
  assert.ok(await page.exists('[data-t="link-edit-form"]'), '오류면 폼 유지');
  await page.click('[data-t="link-edit-cancel"]');
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  assert.equal(srv.state.links[0].detail, '세포 안에서 일어나기 때문입니다.');
  assert.equal(srv.state.links[0].user_edited, false);
  await page.close();
});

test('방향 바꾸기: 미리 보이는 방향이 바뀌고 저장하면 swap으로 전송, 한 번 더 누르면 원래대로', { skip: SKIP }, async () => {
  const page = await openStudy();
  const target = srv.state.links[0];
  const sel = '[data-t="link"][data-id="' + target.id + '"]';
  await page.click(sel + ' [data-t="link-edit"]');
  await page.click('[data-t="link-swap"]');
  assert.equal(await page.text('[data-t="edit-pair"]'), '광합성 → 세포');
  await page.click('[data-t="link-swap"]');
  assert.equal(await page.text('[data-t="edit-pair"]'), '세포 → 광합성');
  await page.click('[data-t="link-swap"]');
  await page.click('[data-t="link-edit-save"]');
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  assert.deepEqual(calls(/\/api\/concepts\/links\/\d+$/, 'PATCH')[0].body, { swap: true });
  const row = (await rows(page)).find(r => r.pair === '광합성 → 세포');
  assert.ok(row, '목록에 바뀐 방향이 보임');
  assert.equal(srv.state.links[0].user_edited, true);
  await page.close();
});

test('수정 폼 안의 삭제: 확인 대화상자(취소하면 그대로, 확인하면 삭제)', { skip: SKIP }, async () => {
  const page = await openStudy();
  const target = srv.state.links[0];
  await page.click('[data-t="link"][data-id="' + target.id + '"] [data-t="link-edit"]');
  await page.click('[data-t="link-edit-delete"]');
  assert.equal(await dialogAnswer(page, false), '이 연결을 삭제할까요?');
  await sleep(250);
  assert.equal(calls(/\/api\/concepts\/links\/\d+$/, 'DELETE').length, 0);
  assert.ok(await page.exists('[data-t="link-edit-form"]'), '취소하면 폼 유지');
  await page.click('[data-t="link-edit-delete"]');
  await dialogAnswer(page, true);
  await page.waitFor("document.querySelectorAll('[data-t=link]').length === 3");
  assert.equal(calls(/\/api\/concepts\/links\/\d+$/, 'DELETE').length, 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('연결선 카드: 관계 종류·문구·이유만 보이고 상태 배지·라벨은 없음, 이유가 없으면 이유 줄이 없음', { skip: SKIP }, async () => {
  const page = await openStudy();
  await openMap(page);
  await page.click('[data-t="map-full"]');
  const cases = [
    [srv.state.links[0], '세포 안에서 일어나기 때문입니다.'],
    [srv.state.links[1], '내가 고친 이유'],
    [srv.state.links[2], '내가 직접 이은 이유'],
    [srv.state.links[3], null],
  ];
  for (const [l, reason] of cases) {
    // 연결 4개가 한 노드에서 뻗어 선끼리 겹치므로 좌표 클릭 대신 그 연결선에 직접 클릭을 보낸다
    await page.eval(`document.querySelector('[data-t="edge"][data-id="${l.id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await page.waitFor("document.getElementById('edge-dialog').open");
    assert.equal(await page.text('[data-t="rel-type"]'), l.relation_type);
    assert.equal(await page.exists('[data-t="rel-source"]'), false, '상태 배지 없음');
    if (reason === null) assert.equal(await page.exists('[data-t="rel-detail"]'), false, '이유가 없으면 이유 줄 없음');
    else assert.equal(await page.text('[data-t="rel-detail"]'), reason);
    assert.doesNotMatch(await page.text('#edge-body'), BANNED);
    await page.click('#edge-close');
    await page.waitFor("!document.getElementById('edge-dialog').open");
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('개념 추가 직후 안내: AI가 만든 연결 개수를 알려 주고, 연결이 없으면 표시하지 않음', { skip: SKIP }, async () => {
  const page = await openStudy();
  srv.state.explorePlan = [{ term: '삼투', extraLinks: ['핵', '엽록체'] }];
  await page.type('#ask-input', '삼투');
  await page.click('#ask-submit');
  await page.waitFor("document.getElementById('study-msg').textContent.includes('연결을 만들었습니다')");
  assert.equal(await page.text('#study-msg'), '3개 연결을 만들었습니다.');   // 현재 개념과의 연결 1 + 기존 개념 2
  assert.match(await page.eval("document.getElementById('study-msg').className"), /\binfo\b/);
  assert.equal(await page.eval("!!document.querySelector('#study-msg [data-t=ai-retry]')"), false);
  await page.close();

  const p2 = await openStudy();
  srv.state.explorePlan = [{ term: '삼투2', aiError: true }];
  await p2.type('#ask-input', '삼투2');
  await p2.click('#ask-submit');
  await p2.waitFor("!!document.querySelector('[data-t=ai-retry]')");
  assert.ok(!(await p2.text('#study-msg')).includes('연결을 만들었습니다'), 'AI 실패면 연결 알림 없음');
  await p2.close();
});

test('개념 추가: 연결이 하나도 안 만들어지면 안내가 없다', { skip: SKIP }, async () => {
  srv.reset();
  srv.seed({ topic: '생물 · 세포', items: [], links: [], path: null });
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!document.getElementById('view-study').hidden");
  assert.equal(await page.text('#study-msg'), '');
  await page.close();
});

for (const w of [390, 768, 1024]) {
  test(`연결 수정 폼 ${w}px: 가로 스크롤 없음, 버튼·입력 44px 이상`, { skip: SKIP }, async () => {
    const page = await openStudy(w);
    await page.click('[data-t="link-edit"]');
    await page.eval("document.getElementById('linksec').scrollIntoView()");
    assert.equal(await page.hasHorizontalScroll(), false);
    const small = await page.eval(`[...document.querySelectorAll('#linksec button, #linksec select, #linksec input')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || (r.width < 43.5 && !b.classList.contains('text'))); }).map(b => b.id || b.dataset.t)`);
    assert.deepEqual(small, [], '44px 미만 요소');
    const rowsSmall = await page.eval("[...document.querySelectorAll('[data-t=link-edit], [data-t=link-delete]')].filter(b => b.getBoundingClientRect().height < 43.5).length");
    assert.equal(rowsSmall, 0);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  test(`연결 목록 ${w}px: 수정·삭제 버튼 44px 이상, 가로 스크롤 없음`, { skip: SKIP }, async () => {
    const page = await openStudy(w);
    await page.eval("document.getElementById('linksec').scrollIntoView()");
    assert.equal(await page.hasHorizontalScroll(), false);
    const small = await page.eval("[...document.querySelectorAll('[data-t=link-edit], [data-t=link-delete]')].filter(b => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).length");
    assert.equal(small, 0);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
