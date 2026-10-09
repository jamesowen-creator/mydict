// 작업227-11: 새 관계 5종(사용·일부·종류·일으킴·구별)을 문장으로 보여 주고, 관계 종류 select 를 새 5종 위/옛 6종 아래로 구성한다.
// 옛 6종 표시는 그대로, 모르는 값도 화면이 깨지지 않는다(헤드리스 Chrome, 모의 API). 실행: node --test tests/ui/concept_link_sentence.ui.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');
const { openMap, closeMap } = require('./helpers/map');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

const TERMS = ['TCP', 'IP 주소', '패킷', '네트워크', '지연', '포트', '세포', '버퍼'];   // 버퍼는 연결 없음(연결 추가 테스트용)
const ND = { source: 'ai' };
async function openStudy(extra = []) {
  srv.reset();
  srv.seed({
    topic: '네트워크', items: TERMS.map(term => ({ term })), path: [0],
    links: [
      [0, 1, { ...ND, relation_type: '사용', label: null, detail: 'TCP가 주소로 상대를 찾는다' }],
      [0, 2, { ...ND, relation_type: '일부', label: null, detail: null }],
      [0, 3, { ...ND, relation_type: '종류', label: null, detail: null }],
      [4, 0, { ...ND, relation_type: '일으킴', label: null, detail: '재전송이 늘어난다\n메커니즘: 응답이 늦으면 다시 보낸다' }],
      [0, 5, { ...ND, relation_type: '구별', label: null, detail: null }],
      [0, 6, { ...ND, relation_type: '포함', label: '이어짐', detail: '옛 연결의 이유' }],
      ...extra,
    ],
  });
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=term]')");
  return page;
}
const pairs = page => page.eval("[...document.querySelectorAll('[data-t=link] .lk-pair')].map(e => e.innerText)");
const linkOf = (rel, from) => srv.state.links.find(l => l.relation_type === rel && (from === undefined || l.from_item_id === from));

test('목록: 새 5종은 조사까지 맞춘 문장, 옛 6종은 기존 "A → B · 종류 · 문구" 그대로', { skip: SKIP }, async () => {
  const page = await openStudy();
  const got = await pairs(page);
  for (const s of ['TCP는 IP 주소를 사용한다', 'TCP는 패킷의 일부이다', 'TCP는 네트워크의 한 종류이다', '지연은 TCP를 일으킨다', 'TCP와 포트는 구별해야 한다']) {
    assert.ok(got.includes(s), s + ' / ' + JSON.stringify(got));
  }
  assert.ok(got.includes('TCP → 세포'), '옛 연결은 화살표 표시');
  const oldEntry = '[data-t=link][data-id="' + linkOf('포함').id + '"]';
  assert.equal(await page.text(oldEntry + ' .lk-meta'), '포함 · 이어짐');
  assert.match(await page.text(oldEntry + ' .lk-reason'), /연결한 이유\s*옛 연결의 이유/);
  assert.doesNotMatch(got.join('|'), /TCP → (IP 주소|패킷|네트워크|포트)|지연 → TCP/, '새 5종에는 화살표 표시 없음');
  // 이유(detail): 있으면 표시, 일으킴은 메커니즘 줄까지
  assert.match(await page.text('[data-t=link][data-id="' + linkOf('사용').id + '"] .lk-reason'), /TCP가 주소로 상대를 찾는다/);
  const mech = await page.text('[data-t=link][data-id="' + linkOf('일으킴').id + '"] .lk-reason');
  assert.match(mech, /재전송이 늘어난다/);
  assert.match(mech, /메커니즘: 응답이 늦으면 다시 보낸다/);
  assert.equal(await page.count('[data-t=link][data-id="' + linkOf('일부').id + '"] .lk-reason'), 0, '이유가 없으면 줄 없음');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('현재 개념 설명 줄(place): 새 5종은 문장, 옛 연결은 기존 문구', { skip: SKIP }, async () => {
  const page = await openStudy();
  const place = await page.text('[data-t=place]');
  assert.match(place, /TCP는 IP 주소를 사용한다/);
  assert.match(place, /TCP는 패킷의 일부이다/);
  assert.match(place, /TCP는 네트워크의 한 종류이다/);
  assert.doesNotMatch(place, /\/.*\/.*\/.*\//, '최대 3개');
  await page.close();
  // 옛 6종만 있으면 기존 문구
  srv.reset();
  srv.seed({ items: [{ term: '가' }, { term: '나' }], links: [[0, 1, { relation_type: '대비', label: '반대' }]], path: [0] });
  const p2 = await browser.newPage({ width: 390, height: 844 });
  await p2.goto(srv.url + '/concept_study.html');
  await p2.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await p2.click('[data-t="open-study"]');
  await p2.waitFor("!!document.querySelector('[data-t=place]')");
  assert.equal(await p2.text('[data-t=place]'), '‘나’로 이어짐 (반대 · 대비)');
  await p2.close();
});

test('지도: 문구가 없는 새 연결의 간선에는 종류 이름만, 상세 대화상자에는 문장·이유·메커니즘', { skip: SKIP }, async () => {
  const page = await openStudy();
  await openMap(page);
  await page.click('[data-t=map-full]');   // 경로 밖 간선에도 문구가 보이도록 전체 연결 보기
  await page.waitFor("document.querySelector('[data-t=map-full]').getAttribute('aria-pressed') === 'true'");
  const labels = await page.eval("[...document.querySelectorAll('[data-t=edge] text')].map(t => t.textContent)");
  for (const t of ['사용', '일부', '종류', '일으킴', '구별']) assert.ok(labels.includes(t), t + ' / ' + JSON.stringify(labels));
  assert.ok(!labels.some(t => /사용한다|일부이다/.test(t)), '간선에는 문장을 쓰지 않음');
  const open = id => page.eval(`document.querySelector('[data-t=edge][data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await open(linkOf('일으킴').id);
  await page.waitFor("document.getElementById('edge-dialog').open");
  assert.equal(await page.text('#edge-pair'), '지연은 TCP를 일으킨다');
  assert.equal(await page.text('[data-t=rel-type]'), '일으킴');
  assert.match(await page.text('[data-t=rel-detail]'), /메커니즘: 응답이 늦으면 다시 보낸다/);
  await page.click('#edge-close');
  await open(linkOf('포함').id);
  await page.waitFor("document.getElementById('edge-dialog').open");
  assert.equal(await page.text('#edge-pair'), 'TCP → 세포', '옛 연결 대화상자는 그대로');
  await page.click('#edge-close');
  await closeMap(page);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('연결 추가 select: 새 5종이 위, 옛 6종은 "이전 종류" 묶음 아래, 기본 선택은 사용', { skip: SKIP }, async () => {
  const page = await openStudy();
  await page.click('[data-t="link-open"]');
  const shape = await page.eval(`(() => { const s = document.getElementById('link-type'); return {
    top: [...s.children].map(c => c.tagName === 'OPTGROUP' ? 'G:' + c.label + ':' + [...c.children].map(o => o.value).join(',') : c.value), value: s.value }; })()`);
  assert.deepEqual(shape.top, ['사용', '일부', '종류', '일으킴', '구별', 'G:이전 종류:포함,원인→결과,순서,대비,비슷함,기타 관련']);
  assert.equal(shape.value, '사용');
  await page.eval("(() => { const s = document.getElementById('link-to'); s.value = [...s.options].find(o => o.textContent === '버퍼').value; })()");
  await page.click('[data-t="link-save"]');
  await page.waitFor("document.querySelectorAll('[data-t=link]').length === 7");
  const post = srv.state.log.filter(l => /\/links$/.test(l.url) && l.method === 'POST').pop();
  assert.equal(post.body.relation_type, '사용');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('연결 수정: 옛 연결은 옛 값이 선택된 채로 열리고 그대로 저장 가능, 새 5종으로 바꾸면 문장 미리보기', { skip: SKIP }, async () => {
  const page = await openStudy();
  const old = linkOf('포함');
  await page.click('[data-t=link][data-id="' + old.id + '"] [data-t=link-edit]');
  await page.waitFor("!!document.querySelector('[data-t=link-edit-form]')");
  assert.equal(await page.eval("document.getElementById('le-type').value"), '포함');
  assert.equal(await page.text('[data-t=edit-pair]'), 'TCP → 세포');
  assert.deepEqual(await page.eval("[...document.getElementById('le-type').children].map(c => c.tagName === 'OPTGROUP' ? 'G:' + c.label : c.value)"), ['사용', '일부', '종류', '일으킴', '구별', 'G:이전 종류']);
  // 옛 종류끼리 바꿔 저장
  await page.eval("(() => { const s = document.getElementById('le-type'); s.value = '대비'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  assert.equal(await page.text('[data-t=edit-pair]'), 'TCP → 세포', '옛 종류는 화살표 그대로');
  await page.click('[data-t=link-edit-save]');
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  let patch = srv.state.log.filter(l => /\/api\/concepts\/links\/\d+$/.test(l.url) && l.method === 'PATCH').pop();
  assert.deepEqual(patch.body, { relation_type: '대비' }, '옛 종류로 저장도 가능');
  // 새 5종으로 바꾸면 미리보기가 문장으로
  await page.click('[data-t=link][data-id="' + old.id + '"] [data-t=link-edit]');
  await page.waitFor("!!document.querySelector('[data-t=link-edit-form]')");
  await page.eval("(() => { const s = document.getElementById('le-type'); s.value = '일부'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  assert.equal(await page.text('[data-t=edit-pair]'), 'TCP는 세포의 일부이다');
  await page.click('[data-t=link-swap]');
  assert.equal(await page.text('[data-t=edit-pair]'), '세포는 TCP의 일부이다');
  await page.click('[data-t=link-edit-cancel]');
  // 값을 안 바꾸고 저장하면 PATCH 없이 닫힘
  const before = srv.state.log.filter(l => l.method === 'PATCH').length;
  const nw = linkOf('사용');
  await page.click('[data-t=link][data-id="' + nw.id + '"] [data-t=link-edit]');
  await page.waitFor("!!document.querySelector('[data-t=link-edit-form]')");
  assert.equal(await page.eval("document.getElementById('le-type').value"), '사용');
  await page.click('[data-t=link-edit-save]');
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  assert.equal(srv.state.log.filter(l => l.method === 'PATCH').length, before);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('모르는 relation_type 값: 목록·설명 줄·지도·수정 모두 깨지지 않고 값을 그대로 표시, 수정에서도 값 유지', { skip: SKIP }, async () => {
  const page = await openStudy([[0, 1, { relation_type: '새로운종류', label: '낯선', detail: null }]]);
  // 같은 쌍(0,1)이 두 번 있으나 화면은 목록에 그대로 그린다
  const unk = linkOf('새로운종류');
  const sel = '[data-t=link][data-id="' + unk.id + '"]';
  assert.equal(await page.text(sel + ' .lk-pair'), 'TCP → IP 주소');
  assert.equal(await page.text(sel + ' .lk-meta'), '새로운종류 · 낯선');
  await openMap(page);
  await page.click('[data-t=map-full]');
  await page.waitFor("document.querySelector('[data-t=map-full]').getAttribute('aria-pressed') === 'true'");
  assert.ok((await page.eval("[...document.querySelectorAll('[data-t=edge] text')].map(t => t.textContent)")).includes('낯선'));
  await closeMap(page);
  await page.click(sel + ' [data-t=link-edit]');
  await page.waitFor("!!document.querySelector('[data-t=link-edit-form]')");
  assert.equal(await page.eval("document.getElementById('le-type').value"), '새로운종류', '모르는 값도 선택된 채로 열림');
  await page.click('[data-t=link-edit-save]');
  await page.waitFor("!document.querySelector('[data-t=link-edit-form]')");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('모르는 값이 설명 줄(place)에도 값 그대로 나온다', { skip: SKIP }, async () => {
  srv.reset();
  srv.seed({ items: [{ term: '가' }, { term: '나' }], links: [[0, 1, { relation_type: '새로운종류', label: null }]], path: [0] });
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=place]')");
  assert.equal(await page.text('[data-t=place]'), '‘나’로 이어짐 (새로운종류)');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('다음 제안: 새 5종 값이 와도 값 그대로 표시', { skip: SKIP }, async () => {
  srv.reset();
  srv.seed({ items: [{ term: '가', set: { suggestions: [{ term: '제안 Z', reason: '이유', relation_type: '사용', relation_label: '', load: '보통' }, { term: '제안 W', reason: '이유', relation_type: 7, relation_label: '', load: '보통' }] } }], path: [0] });
  const page = await browser.newPage({ width: 390, height: 844 });
  await page.goto(srv.url + '/concept_study.html');
  await page.waitFor("!document.getElementById('app').hidden && !document.getElementById('study-rows').hidden", 8000);
  await page.click('[data-t="open-study"]');
  await page.waitFor("!!document.querySelector('[data-t=suggest-main]')");
  assert.match(await page.text('[data-t=suggest-main]'), /현재 개념과의 관계\s*사용/);
  assert.match(await page.eval("document.querySelector('[data-t=suggest-alt]').textContent"), /7/);
  assert.deepEqual(page.errors, []);
  await page.close();
});
