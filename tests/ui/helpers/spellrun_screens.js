// 작업356: 스펠링 런의 카드·대결 화면을 하나씩 띄워 넘침과 주 버튼 위치를 재는 도우미(시험과 현황 확인이 함께 쓴다). 서버·외부 API 없이 화면 요소만 바꾼다.
// 각 화면: { name, setup(JS 문자열), card(카드 선택자), buttons(주 버튼 id 목록) }
const SCREENS = [
  { name: '시작', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'start'; });`, buttons: ['startBtn', 'helpBtn'], primary: ['startBtn'] },
  { name: '결과', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'result'; });`, buttons: ['revBtn', 'againBtn'], primary: ['againBtn'], needsResult: true },
  { name: '게임방법', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'help'; });`, buttons: ['helpClose'], primary: ['helpClose'] },
  { name: '미리보기-진행', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'pv'; }); pvTitle.textContent = '단어 미리 보기'; pvProg.textContent = '단어 3 / 8 · 자동으로 넘어가요'; pvWord.textContent = 'environment'; pvMean.textContent = '환경, 주변 상황'; pvNote.textContent = '소리가 나지 않으면 기기 음량을 확인하세요'; pvCtl.hidden = false; pvStart.hidden = true;`, buttons: ['pvArea', 'pvPause', 'pvSkip', 'pvBack'], primary: ['pvBack'] },
  { name: '미리보기-끝', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'pv'; }); pvTitle.textContent = '단어 미리 보기'; pvProg.textContent = '단어 8 / 8'; pvWord.textContent = 'environment'; pvMean.textContent = '환경, 주변 상황'; pvNote.textContent = '준비되면 시작을 누르세요'; pvCtl.hidden = true; pvStart.hidden = false;`, buttons: ['pvArea', 'pvStart', 'pvBack'], primary: ['pvStart'] },
  { name: '이어하기', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'cont'; });`, buttons: ['contBtn', 'endBtn'], primary: ['contBtn'] },
  { name: '대결-목록', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'vs'; }); document.querySelectorAll('#vs .vsview').forEach(e => { e.hidden = e.id !== 'vsListView'; }); vsMsg.textContent = ''; vsList.innerHTML = [1, 2, 3, 4].map(i => '<li><span class="vn">방 주인 ' + i + '</span><span class="vm">1 / 2 · 단어 10개</span><button class="toggle vsbtn" type="button">참가</button></li>').join('');`, buttons: ['vsCreate', 'vsRefresh', 'vsClose'], primary: ['vsCreate'] },
  { name: '대결-대기', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'vs'; }); document.querySelectorAll('#vs .vsview').forEach(e => { e.hidden = e.id !== 'vsRoomView'; }); vsMsg.textContent = '방을 만들었어요'; vsRoomText.textContent = '두 사람이 모였어요. 시작하면 같은 단어로 겨뤄요.'; vsPlayers.innerHTML = '<li><span class="vn">나</span><span class="vm">준비</span></li><li><span class="vn">상대 이름</span><span class="vm">준비</span></li>'; vsGo.textContent = '시작';`, buttons: ['vsGo', 'vsLeave'], primary: ['vsGo'] },
  { name: '대결-결과', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'vs'; }); document.querySelectorAll('#vs .vsview').forEach(e => { e.hidden = e.id !== 'vsFinView'; }); vsMsg.textContent = ''; vsFinTitle.textContent = '무승부예요'; vsFinWhy.textContent = '생존 시간이 같아서 점수로 가렸어요'; vsFinList.innerHTML = '<li><b>나</b><span class="vm">1:12 · 점수 5,432 · 단어 8</span></li><li><b>상대 이름</b><span class="vm">1:12 · 점수 4,310 · 단어 7</span></li>'; vsFinNote.textContent = '결과는 저장되지 않아요'; vsFinRematchNote.textContent = '상대가 다시 하기를 원해요'; vsFinRematch.hidden = false; vsFinRetry.hidden = true;`, buttons: ['vsFinRematch', 'vsFinRooms', 'vsFinClose'], primary: ['vsFinRematch'] },
  { name: '대결-나가기확인', setup: `document.querySelectorAll('.sr-box .screen').forEach(e => { e.hidden = e.id !== 'vsQuit'; });`, buttons: ['vsQuitStay', 'vsQuitGo'], primary: ['vsQuitStay'] },
];

// 화면을 띄운 뒤 측정: 카드 넘침(px), 주 버튼이 카드 안에 온전히 보이는가, 버튼끼리·카드 밖 겹침
const MEASURE_SCREEN = names => `(() => {
  const out = [];
  const box = document.getElementById('box').getBoundingClientRect(), u = parseFloat(document.getElementById('box').style.getPropertyValue('--u'));
  const sc = ${JSON.stringify(names)};
  const vis = (e, card) => { const r = e.getBoundingClientRect(), c = card.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5; };
  const card = document.querySelector('.sr-box .screen:not([hidden]) .card');
  if (!card) return null;
  card.scrollTop = 0; card.querySelectorAll('.helpbody,.vlist').forEach(e => { e.scrollTop = 0; });
  const cr = card.getBoundingClientRect(), sr = card.parentNode.getBoundingClientRect();
  const btns = sc.map(id => document.getElementById(id)).filter(e => e && !e.hidden && e.getClientRects().length);
  const rects = btns.map(e => { const r = e.getBoundingClientRect(); return { id: e.id, l: r.left, t: r.top, r: r.right, b: r.bottom, th: Math.max(r.height, parseFloat(getComputedStyle(e, '::before').height) || 0) }; });   // 작업382: 보이는 높이가 작아도 ::before 로 넓힌 터치 영역(44px)을 센다
  let overlap = 0; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) overlap++; }
  return { overflow: Math.round(card.scrollHeight - card.clientHeight), cardH: Math.round(cr.height), screenH: Math.round(sr.height), hidden: btns.filter(e => !vis(e, card)).map(e => e.id), inBox: cr.left >= box.left - 0.5 && cr.right <= box.right + 0.5 && cr.top >= box.top - 0.5 && cr.bottom <= box.bottom + 0.5, overlap: overlap, minBtn: Math.min(...rects.map(r => Math.min(r.r - r.l, r.th))), u: u };
})()`;
module.exports = { SCREENS, MEASURE_SCREEN };
