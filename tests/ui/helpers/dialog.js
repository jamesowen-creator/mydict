// 작업207-2: 공용 대화상자(public/js/common/dialog.js) 조작 도우미. 기본 confirm()을 CDP로 자동 수락하던 테스트가 이걸 쓴다.
//   const msg = await dialogAnswer(page, true|false)   // 열린 대화상자의 문구를 돌려주고 확인(true)/취소(false)를 누른다
async function dialogAnswer(page, ok) {
  await page.waitFor("!!document.querySelector('dialog.metis-dialog[open]')", 4000);
  const msg = await page.text('dialog.metis-dialog[open] [data-t="dialog-msg"]');
  await page.click('dialog.metis-dialog[open] [data-t="' + (ok ? 'dialog-ok' : 'dialog-cancel') + '"]');
  await page.waitFor("!document.querySelector('dialog.metis-dialog')", 4000);
  return msg;
}
module.exports = { dialogAnswer };
