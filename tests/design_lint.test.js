// 작업262-1: 디자인 원칙 밖 값이 새로 늘어나지 않게 하는 린트(브라우저 없음, 파일만 읽음).
// public/*.html 과 public/css/**/*.css 의 주석을 뺀 코드에서 항목별 개수를 세고, tests/design_lint_baseline.json(현재 개수)보다 늘면 실패한다.
// 줄어드는 것은 허용한다. 줄었다면 기준선을 갱신한다:  UPDATE_DESIGN_BASELINE=1 node tests/design_lint.test.js
// 기존 위반은 이번에 고치지 않는다(증가 금지만 단정). 허용 값은 docs/design/design-principles.md 의 색·글자·모서리 단계.
// 실행: node --test tests/design_lint.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const BASELINE = path.join(__dirname, 'design_lint_baseline.json');

// 원칙 색(소문자, # 없이). 3자리 fff 는 ffffff 와 같게 본다
const PRINCIPLE_HEX = new Set(['1a1f3c', '4a5070', 'dde2f5', 'f5f7ff', 'ffffff', 'eef1fb', 'e2583b', 'b8442e', 'dc2626', 'b42318', '16a34a', '085041',
  'e67e22', 'c0392b', 'b3261e', '868ca8', '000000']);
const FONT_STEPS = new Set([11, 12, 13, 14, 15, 16, 18, 22, 32, 48]);
const RADIUS_OK = new Set(['0', '0px', '10px', '16px', '50%']);
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{23E9}-\u{23FA}\u{2600}-\u{26FF}\u{2702}-\u{27BF}\u{2B50}\u{2B55}]/gu;   // 그림 이모지(✓ ✕ ○ 같은 텍스트 기호는 제외)

function listFiles() {
  const out = fs.readdirSync(PUB).filter(f => f.endsWith('.html')).map(f => f);
  const walk = dir => { for (const e of fs.readdirSync(path.join(PUB, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.css')) out.push(rel);
  } };
  walk('css');
  return out.sort();
}
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '').replace(/(?<=[;{}\s])\/\/[^\n"'`]*$/gm, '');
}
const norm = h => { h = h.toLowerCase(); return h.length === 3 ? h.split('').map(c => c + c).join('') : h; };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

function measure(code) {
  const r = { hex_direct: 0, hex_direct_nonprinciple: 0, hex_fallback_nonprinciple: 0, var_def_nonprinciple: 0, font_size_out: 0, radius_out: 0, emoji: 0 };
  for (const m of code.matchAll(/(--[\w-]+\s*:\s*)?(var\([^()]*?,\s*)?#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const h = norm(m[3].length === 8 ? m[3].slice(0, 6) : m[3]);
    const ok = PRINCIPLE_HEX.has(h);
    if (m[1]) { if (!ok) r.var_def_nonprinciple++; }
    else if (m[2]) { if (!ok) r.hex_fallback_nonprinciple++; }
    else { r.hex_direct++; if (!ok) r.hex_direct_nonprinciple++; }
  }
  for (const m of code.matchAll(/font-size\s*:\s*([^;}"'`]+)/g)) {
    const mm = /^(\d+(?:\.\d+)?)px(?:\s*!important)?$/.exec(m[1].trim());
    if (mm && !FONT_STEPS.has(parseFloat(mm[1]))) r.font_size_out++;
  }
  for (const m of code.matchAll(/border-radius\s*:\s*([^;}"'`]+)/g)) {
    const v = m[1].replace(/!important/g, '').replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ').replace(/calc\([^()]*\)/g, ' ');
    for (const tok of v.split(/[\s/]+/)) if (tok && !RADIUS_OK.has(tok)) r.radius_out++;
  }
  r.emoji = (code.match(EMOJI) || []).length;
  return r;
}

function measureAll() {
  const perFile = {};
  for (const f of listFiles()) perFile[f] = measure(strip(fs.readFileSync(path.join(PUB, f), 'utf8')));
  const total = {};
  for (const r of Object.values(perFile)) for (const [k, v] of Object.entries(r)) bump(total, k, v);
  return { total, files: perFile };
}

const current = measureAll();

if (process.env.UPDATE_DESIGN_BASELINE) {
  fs.writeFileSync(BASELINE, JSON.stringify({ note: '작업262-1: 원칙 밖 값의 현재 개수. 늘면 테스트 실패, 줄면 UPDATE_DESIGN_BASELINE=1 로 갱신.', ...current }, null, 1) + '\n');
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

const LABELS = {
  hex_direct: '#hex 직접 지정(var 폴백·변수 정의 밖, 원칙 값 포함)',
  hex_direct_nonprinciple: '#hex 직접 지정 중 원칙 값이 아닌 것',
  hex_fallback_nonprinciple: 'var(--x, #hex) 폴백이 원칙 값이 아닌 것',
  var_def_nonprinciple: '원칙 밖 색을 값으로 정의한 변수(--x: #hex)',
  font_size_out: '글자 크기 단계(11·12·13·14·15·16·18·22·32·48) 밖',
  radius_out: '모서리 단계(0·10·16·50%) 밖',
  emoji: '이모지',
};

for (const [key, label] of Object.entries(LABELS)) {
  test(`디자인 린트: ${label} 개수는 기준선(${base.total[key]})보다 늘지 않는다`, t => {
    const worse = Object.entries(current.files).filter(([f, r]) => r[key] > ((base.files[f] || {})[key] || 0))
      .map(([f, r]) => `${f}: ${((base.files[f] || {})[key] || 0)} → ${r[key]}`);
    assert.deepEqual(worse, [], `${label}이(가) 늘었습니다. 원칙 값(var(--color-*)·글자·모서리 단계)을 쓰세요.`);
    assert.ok(current.total[key] <= base.total[key]);
    if (current.total[key] < base.total[key]) t.diagnostic(`${label}: ${base.total[key]} → ${current.total[key]} 로 줄었습니다. UPDATE_DESIGN_BASELINE=1 node tests/design_lint.test.js 로 기준선을 갱신하세요.`);
  });
}

test('디자인 린트: 기준선 파일에 새로 생긴 파일의 위반은 0에서 시작한다(기준선에 없는 파일은 0개 기준)', () => {
  const newFiles = Object.keys(current.files).filter(f => !(f in base.files));
  for (const f of newFiles) for (const [k, v] of Object.entries(current.files[f])) assert.equal(v, 0, `${f} (새 파일) ${k}`);
});
