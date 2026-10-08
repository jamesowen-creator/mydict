// 작업217: "박스 없는 텍스트 UI" 테스트들이 같이 쓰는 도우미(헤드리스 Chrome).
// 원칙(작업216-3의 교훈): ① 테스트 쪽에서 transition·animation을 끄고(NO_MOTION) ② 클릭 전에 레이아웃이 안정될 때까지(settle) 기다린다.
const assert = require('node:assert/strict');
const { sleep } = require('./cdp');

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const WHITE = 'rgb(255, 255, 255)';
// 상태 글자색: --success-dark, --error-dark(= 프로젝트의 위험색 #B42318), --text2, --primary-dark
const GREEN = 'rgb(8, 80, 65)', RED = 'rgb(180, 35, 24)', TEXT2 = 'rgb(107, 114, 128)', CORAL_DARK = 'rgb(184, 68, 46)';
const NO_MOTION = `(() => { const s = document.createElement('style'); s.id = 'test-no-motion'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); })()`;
const DB_READY = "typeof DB !== 'undefined' && !!DB && getComputedStyle(document.getElementById('loading')).display === 'none'";
const me = () => ({ id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_voice_study: true, perm_concept_study: true,
  perm_literature_compass: true, perm_digest_reading: true, perm_science_reading: true });

// 글꼴 로드 + 보이는 버튼·행 위치가 50ms 간격으로 연속 4번 같을 때까지 기다린다
async function settle(page) {
  await page.waitFor("document.fonts.status === 'loaded'", 5000);
  let last = '', same = 0;
  for (let i = 0; i < 100 && same < 4; i++) {
    const now = await page.eval("[...document.querySelectorAll('button, a, .match-item, .mcq-option, .ox-btn, .note-item')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top) + ':' + Math.round(r.left); }).join('|') + '|' + document.documentElement.scrollHeight");
    same = now === last ? same + 1 : 0; last = now;
    await sleep(50);
  }
  assert.ok(same >= 4, '화면 레이아웃이 안정되지 않음');
}
const step = async (page, js) => { await page.eval(js); await sleep(150); await settle(page); };

// 요소 하나(또는 의사 요소)의 모양·글자 대비를 잰다. 실제 바탕색은 조상에서 찾는다.
const MEASURE = (sel, pseudo = null, idx = 0) => `(() => {
  const e = document.querySelectorAll(${JSON.stringify(sel)})[${idx}];
  if (!e) return null;
  const cs = getComputedStyle(e), r = e.getBoundingClientRect(), ps = ${pseudo ? `getComputedStyle(e, ${JSON.stringify(pseudo)})` : 'null'};
  const num = c => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([R, G, B]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
  let bgEff = 'rgb(255, 255, 255)';
  for (let a = e; a; a = a.parentElement) { const b = getComputedStyle(a).backgroundColor; const n = num(b); if (n.length < 4 || n[3] > 0.99) { if (n.length >= 3) { bgEff = b; break; } } }
  const ratio = c => { const l1 = lum(num(c)), l2 = lum(num(bgEff)); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  return { text: e.textContent.trim(), cls: e.className, w: r.width, h: r.height, left: r.left, top: r.top, bg: cs.backgroundColor, bgImage: cs.backgroundImage, shadow: cs.boxShadow,
    bw: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], radius: cs.borderTopLeftRadius, color: cs.color, bgEff, ratio: ratio(cs.color),
    underline: cs.textDecorationLine.includes('underline'), weight: cs.fontWeight, size: parseFloat(cs.fontSize), cursor: cs.cursor, pad: cs.padding,
    mark: ps ? ps.content : null, markColor: ps ? ps.color : null, markRatio: ps ? ratio(ps.color) : null, markWeight: ps ? ps.fontWeight : null };
})()`;

// 박스가 없는지: 배경 투명·그라데이션/그림자/둥근 모서리 없음·위/좌/우 테두리 없음(아래 구분선은 bottomLine일 때 허용)
function assertNoBox(m, label, { bottomLine = false } = {}) {
  assert.ok(m, label + ': 요소 없음');
  assert.equal(m.bg, TRANSPARENT, label + ': 배경 투명'); assert.equal(m.bgImage, 'none', label + ': 그라데이션 없음');
  assert.equal(m.shadow, 'none', label + ': 그림자 없음'); assert.equal(m.radius, '0px', label + ': 둥근 모서리 없음');
  assert.deepEqual([m.bw[0], m.bw[1], m.bw[3]], ['0px', '0px', '0px'], label + ': 위·좌·우 테두리 없음');
  if (!bottomLine) assert.equal(m.bw[2], '0px', label + ': 아래 테두리도 없음');
}
// 평면 흰 면(컨테이너): 테두리·둥근 모서리·그림자·그라데이션 없이 흰 배경만 (아래 구분선은 허용)
function assertFlatPanel(m, label, { bottomLine = false } = {}) {
  assert.ok(m, label + ': 요소 없음');
  assert.equal(m.bgImage, 'none', label + ': 그라데이션 없음'); assert.equal(m.shadow, 'none', label + ': 그림자 없음'); assert.equal(m.radius, '0px', label + ': 둥근 모서리 없음');
  assert.deepEqual([m.bw[0], m.bw[1], m.bw[3]], ['0px', '0px', '0px'], label + ': 위·좌·우 테두리 없음');
  if (!bottomLine) assert.equal(m.bw[2], '0px', label + ': 아래 테두리도 없음');
  assert.ok(m.bg === WHITE || m.bg === TRANSPARENT, label + ': 배경은 흰색(또는 투명): ' + m.bg);
}
const done = async page => { assert.deepEqual(page.errors, [], '스크립트 오류 없음'); assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음'); await page.close(); };

module.exports = { TRANSPARENT, WHITE, GREEN, RED, TEXT2, CORAL_DARK, NO_MOTION, DB_READY, me, settle, step, MEASURE, assertNoBox, assertFlatPanel, done };
