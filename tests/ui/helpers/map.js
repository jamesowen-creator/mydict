// 작업209-4: 지도는 [지도 보기] 버튼으로 여는 전체 화면 팝업(#map-sheet) 안에 그려진다.
//   await openMap(page)    // 버튼을 눌러 팝업을 열고 지도가 그려질 때까지 기다림
//   await closeMap(page)   // 닫기 버튼으로 닫음
async function openMap(page) {
  await page.click('[data-t="map-open"]');
  await page.waitFor("document.getElementById('map-sheet').open && !!document.querySelector('[data-t=map-svg]')", 4000);
}
async function closeMap(page) {
  await page.click('#map-close');
  await page.waitFor("!document.getElementById('map-sheet').open", 4000);
}
module.exports = { openMap, closeMap };
