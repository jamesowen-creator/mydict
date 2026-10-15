// 작업280-1: 개념 지도 화면 구조(랜딩 → 주제 안 → 하단 내비 4탭)에 맞춘 테스트 도우미.
//   await enterTopic(page, id)        // 랜딩의 주제 항목을 눌러 들어가는 것과 같다(Nav.enterTopic: 선택 + pushState + 주제 안 화면)
//   await gotoTab(page, 'map')        // 하단 내비 탭 누르기: 'topic' | 'quiz' | 'map' | 'wrong'
//   await openMapTab(page, rootId)    // 주제 선택 → [지도 만들기] 탭(지도 데이터가 읽혀 노드가 그려질 때까지 기다리지는 않음)
//   await tabIn(page, 'map'|'narr')   // 지도 만들기 화면의 [만들기]/[해설]
//   await backToTopic(page, id)       // 다른 탭에서 주제 안 화면으로 돌아오기(지도는 닫힘) — 예전 [뒤로] + 주제 선택
const VIEW_EL = { topic: 'landing-view', quiz: 'quiz-view', map: 'mapmk-view', wrong: 'wrong-view' };

async function enterTopic(page, id) {
  await page.eval(`Nav.enterTopic(${id}).then(() => 0)`);
  await page.waitFor("!document.getElementById('topic-view').hidden", 4000, '주제 안 화면');
}
async function gotoTab(page, tab) {
  await page.click('#nav-' + tab);
  await page.waitFor(`!document.getElementById('${VIEW_EL[tab]}').hidden && !document.getElementById('app').hidden`, 6000, tab + ' 탭 화면');
}
async function openMapTab(page, id) {
  if (id !== undefined) await page.eval(`selectTopic(${id}); 0`);
  await gotoTab(page, 'map');
  await page.waitFor("!document.getElementById('map-view').hidden", 6000, '지도 화면');
}
// 주제 안 화면으로 돌아온다. 내비의 [주제] 탭은 랜딩으로 가므로, 선택한 주제를 다시 눌러 들어간다
async function backToTopic(page, id) {
  await gotoTab(page, 'topic');
  await enterTopic(page, id);
}

// [지도 만들기] 화면의 [만들기]/[해설] 구분을 누른다(지도 만들기 화면이 아니면 먼저 내비의 [지도 만들기] 탭을 누름)
async function tabIn(page, which) {
  if (await page.eval("document.getElementById('mapmk-view').hidden")) {
    await page.click('#nav-map');
    await page.waitFor("!document.getElementById('mapmk-view').hidden", 6000, '지도 만들기 화면');
  }
  await page.click('#tab-' + which);
}

// 285-1: 시트 툴바 [더보기] 목록 안의 항목(배치 최적화·되돌리기·확대·축소)을 누른다 — 목록이 닫혀 있으면 [더보기]를 먼저 누른다
async function clickMore(page, sel) {
  if (await page.eval("document.getElementById('map-more').hidden")) await page.click('#map-more-toggle');
  await page.waitFor("!document.getElementById('map-more').hidden", 3000, '더보기 목록');
  await page.click(sel);
}

module.exports = { enterTopic, gotoTab, openMapTab, backToTopic, tabIn, clickMore };
