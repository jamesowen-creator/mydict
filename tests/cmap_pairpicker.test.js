// 작업273-2: public/js/cmap/pairPicker.js(노드 A 탭 → B 탭 상태 기계, 273-5 퀴즈와 공유)와 mapGeometry.js(임시 격자·화면 맞춤)의 순수 계산. 브라우저 없음.
// 실행: node --test tests/cmap_pairpicker.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../public/js/cmap/pairPicker.js');
const G = require('../public/js/cmap/mapGeometry.js');

// mapCore.js 는 클래식 스크립트(전역 선언)라 vm 에서 실행해 MAPD 만 읽는다(공용 코드는 읽기만)
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'map', 'mapCore.js'), 'utf8') + '\nthis.MAPD = MAPD;', ctx);
const MAPD = ctx.MAPD;

test('짝 고르기: A 탭 → B 탭이면 onPair(A, B), 같은 노드를 다시 누르면 취소, 완성 뒤에는 처음 상태', () => {
  const log = [];
  const p = P.create({ onFirst: id => log.push(['first', id]), onPair: (a, b) => log.push(['pair', a, b]), onCancel: id => log.push(['cancel', id]) });
  assert.equal(p.first, null);
  assert.deepEqual(p.tap(1), { state: 'first', id: 1 }); assert.equal(p.first, 1);
  assert.deepEqual(p.tap(2), { state: 'pair', from: 1, to: 2 }); assert.equal(p.first, null);
  assert.deepEqual(p.tap(3), { state: 'first', id: 3 });
  assert.deepEqual(p.tap(3), { state: 'cancel', id: 3 }); assert.equal(p.first, null);
  p.tap(5); assert.equal(p.reset(), true); assert.equal(p.reset(), false, '선택 중이 아니면 reset 은 아무것도 안 함');
  assert.deepEqual(p.tap(null), { state: 'ignored' }); assert.deepEqual(p.tap(undefined), { state: 'ignored' });
  assert.deepEqual(log, [['first', 1], ['pair', 1, 2], ['first', 3], ['cancel', 3], ['first', 5], ['cancel', 5]]);
});

test('짝 고르기: 핸들러가 없어도 동작하고, 방향은 누른 순서(A → B)', () => {
  const p = P.create();
  p.tap(7);
  assert.deepEqual(p.tap(4), { state: 'pair', from: 7, to: 4 });
  assert.equal(P.create({}).tap(1).state, 'first');
});

test('mapGeometry: 노드 크기는 mapCore.js 의 MAPD 와 같다', () => {
  assert.equal(G.NODE_W, MAPD.W); assert.equal(G.NODE_H, MAPD.H); assert.equal(G.COLW, MAPD.COLW); assert.equal(G.ROWH, MAPD.ROWH);
});

test('임시 격자: 배치된 노드가 없으면 원점에서 3열, 있으면 그 아래에서 시작하며 서로 겹치지 않는다', () => {
  const g = G.tempGrid([10, 11, 12, 13], []);
  assert.deepEqual([...g.values()], [{ x: 0, y: 0 }, { x: 192, y: 0 }, { x: 384, y: 0 }, { x: 0, y: 64 }]);
  const below = G.tempGrid([1, 2], [{ x: 50, y: 100 }, { x: 0, y: 300 }]);
  assert.equal(below.get(1).y, 300 + G.NODE_H + 48);
  const many = [...G.tempGrid(Array.from({ length: 10 }, (_, i) => i), []).values()];
  for (let i = 0; i < many.length; i++) for (let j = i + 1; j < many.length; j++) {
    const a = many[i], b = many[j];
    assert.ok(Math.abs(a.x - b.x) >= G.NODE_W || Math.abs(a.y - b.y) >= G.NODE_H, `임시 격자 겹침 ${i},${j}`);
  }
  assert.equal(G.tempGrid([1, 2, 3, 4], [], { cols: 2 }).get(3).x, 0);
});

test('화면 맞춤: 모든 노드가 화면 안에 들어오고 배율은 1 이하·허용 범위, 노드가 없으면 기본값', () => {
  for (const [cw, ch] of [[390, 600], [1280, 700], [320, 400]]) {
    const pts = [{ x: -500, y: -200 }, { x: 900, y: 400 }, { x: 100, y: 700 }];
    const v = G.fitView(pts, cw, ch);
    assert.ok(v.scale <= 1 && v.scale >= G.SCALE_MIN);
    for (const p of pts) {
      const sx = (p.x - v.tx) * v.scale, sy = (p.y - v.ty) * v.scale, ex = (p.x + G.NODE_W - v.tx) * v.scale, ey = (p.y + G.NODE_H - v.ty) * v.scale;
      if (v.scale > G.SCALE_MIN) assert.ok(sx >= -1 && sy >= -1 && ex <= cw + 1 && ey <= ch + 1, `노드가 화면 안: ${cw}x${ch} ${JSON.stringify(p)}`);
    }
  }
  assert.deepEqual(G.fitView([], 390, 600), { scale: 1, tx: 0, ty: 0 });
  assert.deepEqual(G.fitView([{ x: 0, y: 0 }], 0, 0), { scale: 1, tx: 0, ty: 0 });
  assert.equal(G.fitView([{ x: 0, y: 0 }], 390, 600).scale, 1, '노드 하나는 확대하지 않음');
  assert.equal(G.clampScale(100), G.SCALE_MAX); assert.equal(G.clampScale(0.01), G.SCALE_MIN);
});
