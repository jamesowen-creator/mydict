// 작업430: 가로(edge) 풍선 출제 — 앞 묶음의 오답이 다음 칸의 정답 글자(조각이면 조각 전체와 첫 글자)와 같지 않다. 순수 로직 시험(브라우저 없음).
// 실행: node --test tests/spellrun_cand430.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/spellrun/logic.js');
const { CONFIG, planSlots, makeCandidates, nextSlotAvoid, bossConfig } = L;

const mul = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const WORDS = ['apple', 'letter', 'nation', 'station', 'action', 'success', 'mention', 'attention', 'question', 'committee'];

test('430 nextSlotAvoid: 한 글자 칸은 그 글자, 조각은 조각 전체와 첫 글자, 다음 칸이 없으면 빈 목록', () => {
  assert.deepEqual(nextSlotAvoid({ text: 'p' }), ['p']);
  assert.deepEqual(nextSlotAvoid({ text: 'tion', chunk: true }), ['tion', 't']);
  assert.deepEqual(nextSlotAvoid(undefined), []);
  assert.deepEqual(nextSlotAvoid(null), []);
  assert.deepEqual(nextSlotAvoid({ text: '' }), []);
});

for (const [name, cfg] of [['기본(후보 3)', CONFIG], ['보스(후보 4)', bossConfig(CONFIG)]]) {
  test(`430 가로 출제 ${name}: 어느 묶음의 오답도 다음 칸 정답 글자(조각이면 첫 글자 포함)와 같지 않고, 정답은 칸마다 1개, 후보 수 유지`, () => {
    let checked = 0;
    for (const w of WORDS) {
      for (let seed = 1; seed <= 300; seed++) {
        const r = mul(seed), pl = planSlots(w, r, cfg);
        pl.slots.forEach((sl, k) => {
          const next = pl.slots[k + 1], avoid = nextSlotAvoid(next);
          const c = makeCandidates(sl.text, w, r, cfg, avoid);
          assert.equal(c.length, cfg.CANDIDATES, `${w} #${seed} 칸${k} 후보 수`);
          assert.equal(c.filter(x => x.correct).length, 1, '정답 1개');
          assert.equal(c.find(x => x.correct).text, sl.text);
          assert.equal(new Set(c.map(x => x.text)).size, c.length, '고유');
          assert.ok(c.every(x => x.text.length === sl.text.length), '같은 길이');
          if (next) for (const x of c.filter(y => !y.correct)) {
            assert.notEqual(x.text, next.text, `${w} #${seed} 칸${k}: 오답이 다음 칸 정답 ${next.text} 와 같음`);
            if (next.text.length > 1) assert.notEqual(x.text, next.text[0], `${w} #${seed} 칸${k}: 오답이 다음 조각 ${next.text} 의 첫 글자`);
          }
          checked++;
        });
      }
    }
    assert.ok(checked > 3000);
  });
}

test('430 avoid 를 안 넘기거나 빈 목록이면 지금과 완전히 같다(세로·기존 호출은 그대로)', () => {
  for (const w of WORDS) {
    for (let seed = 1; seed <= 200; seed++) {
      const mk = av => { const r = mul(seed), pl = planSlots(w, r, CONFIG); return pl.slots.map(sl => makeCandidates(sl.text, w, r, CONFIG, av).map(c => c.text + (c.correct ? '*' : '')).join(',')); };
      assert.deepEqual(mk(undefined), mk([]), `${w} #${seed}`);
      assert.deepEqual(mk(undefined), mk(null));
    }
  }
});

test('430 한 글자 칸은 제외해도 난수 호출 순서가 같아 정답 위치가 그대로다(제외 글자만 다른 글자로 바뀐다)', () => {
  let diffTexts = 0;
  for (const w of WORDS) {
    for (let seed = 1; seed <= 300; seed++) {
      const r1 = mul(seed), r2 = mul(seed), p1 = planSlots(w, r1, CONFIG), p2 = planSlots(w, r2, CONFIG);
      p1.slots.forEach((sl, k) => {
        if (sl.chunk) { makeCandidates(sl.text, w, r1, CONFIG); makeCandidates(sl.text, w, r2, CONFIG, nextSlotAvoid(p2.slots[k + 1])); return; }
        const a = makeCandidates(sl.text, w, r1, CONFIG), b = makeCandidates(sl.text, w, r2, CONFIG, nextSlotAvoid(p2.slots[k + 1]));
        assert.equal(a.findIndex(x => x.correct), b.findIndex(x => x.correct), `${w} #${seed} 칸${k}: 정답 위치`);
        if (a.map(x => x.text).join() !== b.map(x => x.text).join()) diffTexts++;
      });
    }
  }
  assert.ok(diffTexts > 0, '제외가 실제로 작동하는 경우가 있다');
});

test('430 제외 글자가 많아도 후보가 모자라지 않는다(한 글자·조각 모두)', () => {
  const heavy = ['a', 'e', 'o', 'p', 'q', 'l', 'i'];
  for (let seed = 1; seed <= 100; seed++) {
    const c = makeCandidates('a', 'apple', mul(seed), bossConfig(CONFIG), heavy);
    assert.equal(c.length, 4); assert.ok(c.filter(x => !x.correct).every(x => !heavy.includes(x.text)));
    const k = makeCandidates('tion', 'station', mul(seed), CONFIG, ['tion', 't', 'tian']);
    assert.equal(k.length, 3); assert.ok(k.filter(x => !x.correct).every(x => x.text !== 'tian' && x.text !== 'tion'));
  }
});

test('430 429 의 재현 예: 앞 묶음 오답 때문에 같은 글자를 먼저 터트리는 첫 실패가 가로 스트림 모델에서 0이 된다', () => {
  for (const [w, cfg] of [['apple', bossConfig(CONFIG)], ['letter', CONFIG], ['nation', CONFIG], ['station', CONFIG], ['mention', CONFIG], ['attention', CONFIG], ['question', CONFIG], ['success', CONFIG], ['action', CONFIG]]) {
    for (let seed = 1; seed <= 1500; seed++) {
      const r = mul(seed), pl = planSlots(w, r, cfg);
      const packs = pl.slots.map((sl, k) => makeCandidates(sl.text, w, r, cfg, nextSlotAvoid(pl.slots[k + 1])));
      const seq = []; packs.forEach((p, k) => p.forEach(c => seq.push({ k, t: c.text, ok: c.correct })));
      let ptr = 0;
      for (let k = 0; k < pl.slots.length; k++) {
        const i = seq.findIndex((x, ix) => ix >= ptr && x.t === pl.slots[k].text);
        assert.ok(i >= 0 && seq[i].k === k && seq[i].ok, `${w} #${seed} 칸${k}(${pl.slots[k].text}): 같은 글자 첫 풍선이 앞 묶음 오답`);
        ptr = i + 1;
      }
    }
  }
});
