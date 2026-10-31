// 작업376: 게임에서 사전으로 나가는 경로의 행선지(소스 확인). 마치기·닫기·뒤로가기 → #game, 단어 부족 안내(게이트)의 "단어장으로" → #wordbook
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../public/js/spellrun/logic.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const game = read('js/spellrun/game.js'), html = read('spelling_run.html');

test('376-1) grabdx 기본 10, 범위 0~40, reset=1 은 저장값을 지워 기본으로', () => {
  assert.equal(L.LAND_GRAB_DX, 10); assert.equal(L.OPTION_RULES.grabdx.def, 10);
  assert.equal(L.OPTION_RULES.grabdx.min, 0); assert.equal(L.OPTION_RULES.grabdx.max, 40);
  assert.equal(L.parseOptions('?grabdx=99').values.grabdx, 40);
  assert.equal(L.layoutFor('land', 800, 400).GRAB_DX, 10); assert.equal(L.layoutFor('port', 360, 640).GRAB_DX, 0);
  assert.equal(L.resolveOptions('', '{"grabdx":25}').values.grabdx, 25, '저장값 우선');
  assert.deepEqual(L.resolveOptions('?reset=1', '{"grabdx":25}').values, {});
});
test('376-2) 닫기(srClose)·메뉴 닫기·뒤로가기 링크는 #game', () => {
  const fn = game.slice(game.indexOf('function srClose()'), game.indexOf('// 캐릭터 선택'));
  assert.ok(fn.includes("'/english_dictionary.html#game'") && !fn.includes('#wordbook'));
  assert.ok(game.includes("$('srMenuClose').addEventListener('click', () => { closeMenu(); srClose(); })"));
  const back = html.match(/<a class="screen-bar-back"[^>]*>/)[0];
  assert.ok(back.includes('href="/english_dictionary.html#game"'), back);
});
test('376-3) 단어 부족·불러오기 실패·선택 없음 게이트의 "단어장으로" 는 #wordbook 그대로', () => {
  const gates = game.match(/showGate\([^\n]*'단어장으로', '[^']+'\)/g) || [];
  assert.equal(gates.length, 3);
  for (const g of gates) assert.ok(g.endsWith("'/english_dictionary.html#wordbook')"), g);
  assert.ok(html.includes('id="gateLink" href="/english_dictionary.html#wordbook"'));
});
test('376-4) 게임 코드의 다른 사전 이동은 없다(location.href 는 srClose 한 곳)', () => {
  assert.equal((game.match(/location\.href\s*=/g) || []).length, 1);
  assert.equal((game.match(/english_dictionary\.html#wordbook/g) || []).length, 3, '게이트 3곳뿐');
});
