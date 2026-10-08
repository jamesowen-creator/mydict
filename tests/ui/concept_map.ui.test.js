// 작업195-3: 개념학습 지도·목록·보류/제외·이해 기록 화면 테스트(헤드리스 Chrome, 모의 API).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { openMap, closeMap } = require('./helpers/map');   // 작업209-4: 지도는 팝업

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

async function openStudy(setup, { width = 390, height = 844 } = {}) {
  srv.reset();
  setup(srv);
  const page = await browser.newPage({ width, height });
  await page.goto(srv.url + '/concept_study.html#s=' + srv.state.studies[0].id);
  await page.waitFor("!document.getElementById('view-study').hidden && !!document.querySelector('[data-t=term], #study-empty:not([hidden])')");
  return page;
}
async function done(page) { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); }
const calls = (re, method) => srv.state.log.filter(l => re.test(l.url) && (!method || l.method === method));

// 다섯 개념: 세포(0) → 광합성(1) → 엽록체(2), 세포 → 미토콘드리아(3), 4는 이전됨(연결 없음). 경로 0,1,2 · 현재 2
const five = s => s.seed({
  topic: '생물 · 세포',
  items: [
    { term: '세포', set: { group_label: null } }, { term: '광합성', set: { group_label: '에너지' } }, { term: '엽록체', set: { group_label: '에너지', review_state: 'understood' } },
    { term: '미토콘드리아', set: { group_label: '에너지', review_state: 'confused' } },
    { term: '옛 개념', set: { origin: '이전됨', group_label: null, review_state: 'new' } },
  ],
  links: [[0, 1, { relation_type: '포함', label: '구성함', detail: '세포는 광합성이 일어나는 장소를 포함한다.' }], [1, 2, { relation_type: '순서', label: '다음 단계', detail: '광합성은 엽록체에서 일어난다.' }], [0, 3, { relation_type: '대비', label: '짝', detail: '미토콘드리아와의 대비.' }]],
  path: [0, 1, 2],
});

const nodeRect = async (page, sel) => page.eval(`(() => { const g = document.querySelector(${JSON.stringify(sel)}); const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform')); return { x: +m[1], y: +m[2] }; })()`);

test('지도 강조: 경로 노드·경로 연결선·다음 제안(점선)만 진하고 나머지는 연함', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  assert.equal(await page.count('[data-t="node"]'), 5);
  const hl = await page.eval("[...document.querySelectorAll('[data-t=node]')].map(n => n.dataset.hl + ':' + n.classList.contains('dim') + ':' + n.classList.contains('sel'))");
  const order = await page.eval("[...document.querySelectorAll('[data-t=node]')].map(n => Number(n.dataset.id))");
  const state = Object.fromEntries(order.map((id, i) => [srv.state.items.find(x => x.id === id).term, hl[i]]));
  assert.deepEqual(state, { '세포': '1:false:false', '광합성': '1:false:false', '엽록체': '1:false:true', '미토콘드리아': '0:true:false', '옛 개념': '0:true:false' });
  // 연결선: 경로 노드끼리만 진하게
  const edges = await page.eval("[...document.querySelectorAll('[data-t=edge]')].map(e => e.dataset.hl + ':' + e.classList.contains('dim') + ':' + !!e.querySelector('text'))");
  assert.equal(edges.filter(e => e.startsWith('1:false:true')).length, 2);
  assert.equal(edges.filter(e => e.startsWith('0:true:false')).length, 1, '경로 밖 연결선은 연하고 문구도 숨김');
  // 다음 한 단계: 기본 제안이 점선 노드와 점선 연결로
  assert.equal(await page.count('[data-t="ghost"]'), 1);
  assert.equal(await page.eval("document.querySelector('[data-t=ghost]').dataset.term"), '엽록체 다음 A');
  assert.equal(await page.count('[data-t="ghost-edge"]'), 1);
  assert.match(await page.text('.map-hint'), /경로와 다음 한 단계만 진하게/);
  await done(page);
});

test('전체 연결 보기 토글: 모든 노드·연결선이 같은 진하기가 되고 문구가 보임, 다시 누르면 복귀', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  assert.equal(await page.eval("document.querySelector('[data-t=map-full]').getAttribute('aria-pressed')"), 'false');
  await page.click('[data-t="map-full"]');
  assert.equal(await page.eval("document.querySelector('[data-t=map-full]').getAttribute('aria-pressed')"), 'true');
  assert.equal(await page.count('.m-node.dim, .m-edge.dim'), 0);
  assert.equal(await page.count('[data-t="edge"] text'), 3, '모든 연결선에 관계 문구');
  assert.match(await page.text('.map-hint'), /모든 연결을 보여 줍니다/);
  await page.click('[data-t="map-full"]');
  assert.ok(await page.count('.m-node.dim') >= 2);
  await done(page);
});

test('노드를 누르면 그 개념이 선택되고 경로가 늘어남(팝업은 열릴 때 전체가 한눈에 맞춰져 모든 노드가 화면 안)', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  const photo = srv.state.items[1], cell = srv.state.items[0];
  // (작업209-4) 이전에는 인라인 지도가 글자 크기 하한 때문에 첫 노드를 화면 밖에 두었지만, 팝업은 하한 없이 전체를 맞춘다
  assert.equal(await page.eval(`(() => { const r = document.querySelector('[data-t=node][data-id="${cell.id}"]').getBoundingClientRect(); const b = document.querySelector('[data-t=map-box]').getBoundingClientRect(); return r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom; })()`), true, '열릴 때 첫 노드도 화면 안');
  await page.click('[data-t="map-full"]');
  await page.click(`[data-t="node"][data-id="${photo.id}"]`);
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '광합성'");
  assert.deepEqual(calls(/studies\/\d+$/, 'PATCH').pop().body, { selected_item_id: photo.id });
  assert.equal(srv.state.studies[0].path.length, 4);
  assert.equal(await page.eval("document.querySelector('.m-node.sel').dataset.id"), String(photo.id));
  assert.equal(await page.count('[data-t="path-item"]'), 4);
  await page.click(`[data-t="node"][data-id="${cell.id}"]`);
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '세포'");
  assert.equal(srv.state.studies[0].path.length, 5);
  await done(page);
});

test('연결선을 누르면 관계 종류·문구·설명 대화상자(AI 연결은 확인 필요 표기)', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  await page.click('[data-t="map-full"]');
  const l = srv.state.links[1];
  await page.click(`[data-t="edge"][data-id="${l.id}"] path.hit`);
  await page.waitFor("document.getElementById('edge-dialog').open");
  const t = await page.text('#edge-body');
  assert.ok(t.includes('광합성 → 엽록체'));
  assert.equal(await page.text('[data-t="rel-type"]'), '순서');
  assert.equal(await page.text('[data-t="rel-label"]'), '다음 단계');
  assert.equal(await page.text('[data-t="rel-detail"]'), '광합성은 엽록체에서 일어난다.');
  assert.match(t, /AI 판단 · 확인 필요/);
  await page.click('#edge-close');
  assert.equal(await page.eval("document.getElementById('edge-dialog').open"), false);
  await done(page);
});

test('확대·축소·화면 맞춤·끌어서 이동', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  const vb = () => page.eval("document.querySelector('[data-t=map-svg]').getAttribute('viewBox').split(' ').map(Number)");
  const v0 = await vb();
  await page.click('[data-t="zoom-in"]');
  const v1 = await vb();
  assert.ok(v1[2] < v0[2] && v1[3] < v0[3], '확대하면 보이는 영역이 줄어듦');
  assert.ok(Math.abs((v1[0] + v1[2] / 2) - (v0[0] + v0[2] / 2)) < 0.01, '중심 유지');
  await page.click('[data-t="zoom-out"]'); await page.click('[data-t="zoom-out"]');
  const v2 = await vb();
  assert.ok(v2[2] > v0[2]);
  await page.drag('[data-t="map-box"]', 60, 40);
  const v3 = await vb();
  assert.ok(v3[0] < v2[0] && v3[1] < v2[1], '오른쪽·아래로 끌면 보기 영역이 왼쪽·위로 이동');
  assert.equal(calls(/studies\/\d+$/, 'PATCH').length, 0, '끌기는 노드 선택으로 처리되지 않음');
  await page.click('[data-t="zoom-fit"]');
  const v4 = await vb();
  assert.ok(Math.abs(v4[0] - v0[0]) < 0.01 && Math.abs(v4[2] - v0[2]) < 0.01, '맞춤은 열릴 때의 보기로 복귀');
  await done(page);
});

test('목록 보기: 그룹 라벨별 묶음(그룹 없음은 마지막), 이해 상태·출처 표시, 선택 이동', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await page.click('#seg-list');
  const groups = await page.eval("[...document.querySelectorAll('[data-t=group]')].map(g => g.dataset.group + '|' + [...g.querySelectorAll('.lrow-term')].map(x => x.innerText).join(','))");
  assert.deepEqual(groups, ['에너지|광합성,엽록체,미토콘드리아', '|세포,옛 개념']);
  assert.match(await page.text('[data-t="group"][data-group=""] .label'), /그룹 없음/);
  const rows = await page.eval("[...document.querySelectorAll('[data-t=list-item]')].map(r => r.innerText.replace(/\\s+/g, ' '))");
  assert.ok(rows.includes('엽록체 이해함 · 직접 시작'));
  assert.ok(rows.includes('미토콘드리아 헷갈림 · 직접 시작'));
  assert.ok(rows.includes('옛 개념 학습 전 · 이전됨'));
  assert.equal(await page.eval("document.querySelector('[data-t=list-item][aria-current=true] .lrow-term').innerText"), '엽록체');
  await page.click('[data-t="list-item"]', { index: 3 });
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '세포'");
  await done(page);
});

test('이전된 개념(연결 없음)은 지도에서 연결 없는 노드로 따로 두고 억지로 잇지 않음', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  await openMap(page);
  await page.click('[data-t="map-full"]');
  assert.match(await page.eval("document.querySelector('.m-label').textContent"), /연결 없는 개념/);
  const legacy = srv.state.items[4];
  assert.equal(await page.count(`[data-t="edge"]`), 3);
  const mine = await page.eval(`(() => { const n = document.querySelector('[data-t=node][data-id="${legacy.id}"]'); return n.getAttribute('aria-label'); })()`);
  assert.equal(mine, '옛 개념');
  const r = await nodeRect(page, `[data-t="node"][data-id="${legacy.id}"]`);
  const maxLinkedY = Math.max(...(await Promise.all(srv.state.items.slice(0, 4).map(i => nodeRect(page, `[data-t="node"][data-id="${i.id}"]`)))).map(p => p.y));
  assert.ok(r.y > maxLinkedY, '연결된 덩어리 아래쪽에 배치');
  await done(page);
});

test('보류·제외 관리: 접힌 목록, [다시 보기]·[AI 설명 받기]·[복원]', { skip: SKIP }, async () => {
  const page = await openStudy(s => {
    five(s);
    s.state.items[3].status = 'held';                                   // 미토콘드리아(설명 있음)
    s.state.items[4].status = 'held'; s.state.items[4].content_source = 'none'; s.state.items[4].definition = null;   // 옛 개념(설명 없음)
    const x = s.state.items; x.push({ ...x[3], id: 900, term: '제외된 개념', status: 'excluded' });
    x[5].study_id = x[0].study_id;
  });
  assert.equal(await page.visible('#sidelined'), true);
  assert.equal(await page.eval("document.querySelector('[data-t=sl-held]').open"), false, '접혀 있음');
  assert.match(await page.text('[data-t="sl-held"] summary'), /나중에 볼 개념\s*2/);
  assert.match(await page.text('[data-t="sl-excluded"] summary'), /제외한 개념\s*1/);
  await openMap(page);
  assert.equal(await page.count('[data-t="node"]'), 3, '보류·제외 개념은 지도에 그리지 않음');
  await closeMap(page);
  await page.click('[data-t="sl-held"] summary');
  assert.equal(await page.count('[data-t="sl-explain"]'), 1, '설명이 없는 개념에만 [AI 설명 받기]');
  // 다시 보기(설명 있음): active 복원 + 선택
  await page.click('[data-t="sl-view"]', { index: 0 });
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '미토콘드리아'");
  assert.equal(srv.state.items[3].status, 'active');
  assert.equal(calls(/explore$/).length, 0, 'AI 호출 없음');
  await openMap(page);
  assert.equal(await page.count('[data-t="node"]'), 4);
  await closeMap(page);
  // 설명 없는 보류 개념: AI 설명 받기 → 복원 + explore
  await page.click('[data-t="sl-explain"]');
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '옛 개념' && !!document.querySelector('[data-t=source]')");
  assert.equal(srv.state.items[4].status, 'active');
  assert.equal(srv.state.items[4].content_source, 'ai');
  assert.deepEqual(calls(/explore$/).pop().body, { text: '옛 개념', via: 'input' });
  // 제외 복원
  assert.equal(await page.eval("document.querySelector('[data-t=sl-held]') === null || document.querySelector('[data-t=sl-held]').open"), true, '열어 둔 목록은 다시 그려도 열려 있음');
  await page.click('[data-t="sl-excluded"] summary');
  await page.click('[data-t="sl-restore"]');
  await page.waitFor("document.querySelector('[data-t=sl-excluded]') === null");
  assert.equal(srv.state.items.find(i => i.id === 900).status, 'active');
  assert.equal(await page.visible('#sidelined'), false, '남은 보류·제외가 없으면 영역 숨김');
  await done(page);
});

test('이해 기록: 진행 막대·선택 경로(A › B › C)와 경로 이동', { skip: SKIP }, async () => {
  const page = await openStudy(five);
  assert.equal(await page.eval("document.getElementById('progress-bar').getAttribute('aria-valuenow')"), '1');
  assert.equal(await page.eval("document.getElementById('progress-bar').getAttribute('aria-valuemax')"), '5');
  assert.equal(await page.eval("document.querySelector('#progress-bar > i').style.width"), '20%');
  assert.match(await page.text('#progress-count'), /1 \/ 5/);
  const path = await page.eval("[...document.querySelectorAll('#path-line > *')].map(e => e.innerText.trim())");
  assert.deepEqual(path, ['세포', '›', '광합성', '›', '엽록체']);
  assert.equal(await page.eval("document.querySelector('[data-t=path-item][aria-current=true]').innerText"), '엽록체');
  await page.click('[data-t="path-item"]', { index: 0 });
  await page.waitFor("document.querySelector('[data-t=term]').innerText === '세포'");
  assert.equal(await page.eval("document.getElementById('path-line').innerText.replace(/\\s+/g, ' ')"), '세포 › 광합성 › 엽록체 › 세포');
  // 이해함 토글이 진행 막대에 반영
  await page.click('[data-t="understood"]');
  await page.waitFor("document.getElementById('progress-bar').getAttribute('aria-valuenow') === '2'");
  await done(page);
});

test('개념 0개·1개: 지도를 억지로 그리지 않고 안내', { skip: SKIP }, async () => {
  let page = await openStudy(s => s.seed({ items: [] }));
  assert.equal(await page.visible('#study-empty'), true);
  assert.equal(await page.visible('#record'), false);
  assert.equal(await page.exists('[data-t="map-svg"]'), false);
  await done(page);
  page = await openStudy(s => s.seed({ items: [{ term: '세포' }] }));
  assert.equal(await page.exists('[data-t="map-svg"]'), false);
  assert.equal(await page.exists('[data-t="map-open"]'), false, '그릴 연결이 없으면 지도 보기 버튼도 없음');
  assert.match(await page.text('[data-t="map-note"]'), /개념이 1개뿐이라 아직 그릴 연결이 없어요/);
  assert.equal(await page.text('#progress-count'), '0 / 1');
  await page.click('#seg-list');
  assert.equal(await page.count('[data-t="list-item"]'), 1);
  await done(page);
});

test('개념 60개: 노드가 서로 겹치지 않고 가로 스크롤·오류 없음(전체 보기 포함)', { skip: SKIP }, async () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ term: '개념' + i, set: { group_label: ['가', '나', '다'][i % 3] } }));
  const links = [];
  for (let i = 1; i < 45; i++) links.push([Math.floor((i - 1) / 3), i]);        // 트리(여러 단계·넓은 단계)
  for (let i = 45; i < 52; i++) links.push([i - 44, 59]);                       // 한 노드에 여러 연결(교차)
  const page = await openStudy(s => s.seed({ items, links, path: [0, 1, 4, 13] }));
  await openMap(page);
  for (const full of [false, true]) {
    if (full) await page.click('[data-t="map-full"]');
    const rects = await page.eval(`[...document.querySelectorAll('[data-t=node],[data-t=ghost]')].map(g => { const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform')); return [+m[1], +m[2]]; })`);
    assert.equal(rects.length, 61, '노드 60 + 다음 제안');
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      if (Math.abs(rects[i][0] - rects[j][0]) < 132 && Math.abs(rects[i][1] - rects[j][1]) < 44) overlaps++;
    }
    assert.equal(overlaps, 0, '겹치는 노드 쌍');
    assert.equal(await page.hasHorizontalScroll(), false);
  }
  await closeMap(page);
  await page.click('#seg-list');
  assert.equal(await page.count('[data-t="list-item"]'), 60);
  assert.equal(await page.count('[data-t="group"]'), 3);
  await done(page);
});

for (const [w, h] of [[390, 844], [768, 1024], [1024, 800]]) {
  test(`레이아웃 ${w}px: 지도·목록·대화상자·보류 영역 가로 스크롤 없음, 지도가 화면 폭 안`, { skip: SKIP }, async () => {
    const page = await openStudy(s => { five(s); s.state.items[3].status = 'held'; }, { width: w, height: h });
    assert.equal(await page.hasHorizontalScroll(), false);
    await openMap(page);
    const box = await page.eval("(() => { const r = document.querySelector('[data-t=map-box]').getBoundingClientRect(); return [r.left, r.right, innerWidth]; })()");
    assert.ok(box[0] >= 0 && box[1] <= box[2], '지도 상자가 화면 안: ' + box);
    await page.click('[data-t="map-full"]');
    await page.click('[data-t="edge"] path.hit');
    await page.waitFor("document.getElementById('edge-dialog').open");
    const dlg = await page.eval("(() => { const r = document.getElementById('edge-dialog').getBoundingClientRect(); return [r.left, r.right, innerWidth]; })()");
    assert.ok(dlg[0] >= 0 && dlg[1] <= dlg[2], '대화상자가 화면 안');
    await page.click('#edge-close');
    const smallSheet = await page.eval(`[...document.querySelectorAll('#map-sheet button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(b => b.getAttribute('data-t') || b.id)`);
    assert.deepEqual(smallSheet, [], '팝업 안 44px 미만 터치 요소');
    await closeMap(page);
    await page.click('#seg-list');
    assert.equal(await page.hasHorizontalScroll(), false);
    await page.click('[data-t="sl-held"] summary');
    const small = await page.eval(`[...document.querySelectorAll('#app button:not([hidden]), #app summary, #edge-close')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map(b => b.getAttribute('data-t') || b.id || b.textContent.trim())`);
    assert.deepEqual(small, [], '44px 미만 터치 요소');
    await done(page);
  });
}
