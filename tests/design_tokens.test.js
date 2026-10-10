// 작업242-1: 공용 디자인 변수(public/css/common/tokens.css)가 docs/design/design-principles.md 의 값대로 있고,
// 기존 변수는 그대로이며, 다른 CSS·html 에서 같은 이름을 다시 정의하지 않는지 파일 내용만 보고 확인한다(브라우저 없음).
// 실행: node --test tests/design_tokens.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');
const tokens = read('css/common/tokens.css');

// :root 안의 `--이름: 값;` 을 모두 모은다(주석 제외). 같은 이름이 여러 번이면 마지막 값이 이긴다
function vars(css) {
  const out = new Map();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}
const defined = vars(tokens);

const EXISTING = {
  '--ctl-min-h': '44px', '--btn-radius': '10px', '--btn-weight': '600', '--input-radius': '10px', '--card-radius': '16px', '--msg-radius': '10px',
  '--gutter': '16px', '--body-font-size': '15px', '--content-max': '680px', '--btn-primary-bg': '#b8442e', '--btn-primary-bg-hover': '#9c3a27', '--btn-primary-bg-active': '#86311f',
};
const NEW = {
  '--color-text': '#1a1f3c', '--color-text-sub': '#4a5070', '--color-line': '#dde2f5', '--color-bg': '#f5f7ff', '--color-surface': '#ffffff', '--color-surface-2': '#eef1fb',
  '--color-accent': '#e2583b', '--color-accent-ink': '#b8442e', '--color-danger': '#dc2626', '--color-ok': '#16a34a', '--color-ok-ink': '#085041',
  '--lang-ko': '#e67e22', '--lang-en': '#e2583b', '--lang-zh': '#c0392b', '--lang-ja': '#b3261e',
  '--font-sans': '"Noto Sans KR", sans-serif', '--font-num': '"Sora", sans-serif',
  '--fs-11': '11px', '--fs-12': '12px', '--fs-13': '13px', '--fs-14': '14px', '--fs-15': '15px', '--fs-16': '16px', '--fs-18': '18px', '--fs-22': '22px', '--fs-32': '32px', '--fs-48': '48px',
  '--sp-0': '0', '--sp-4': '4px', '--sp-8': '8px', '--sp-10': '10px', '--sp-12': '12px', '--sp-16': '16px', '--sp-20': '20px', '--sp-24': '24px',
  '--radius-ctl': '10px', '--radius-round': '50%',
  // 사전의 실제 선언: nav 0 -2px 8px rgba(226,88,59,0.07), .result-card 0 4px 20px rgba(226,88,59,0.08). 포커스 링은 사전에 같은 선언이 없어 원칙 문서의 3px 코랄 25%
  '--shadow-nav': '0 -2px 8px rgba(226, 88, 59, 0.07)', '--shadow-card': '0 4px 20px rgba(226, 88, 59, 0.08)', '--ring-focus': '0 0 0 3px rgba(226, 88, 59, 0.25)',
  '--header-h': '65px', '--bar-h': '56px',
};

test('tokens.css: 새 공용 변수 42개가 원칙 값대로 있다', () => {
  assert.equal(Object.keys(NEW).length, 42);
  for (const [name, value] of Object.entries(NEW)) assert.equal(defined.get(name), value, `${name} 값`);
});

test('tokens.css: 기존 변수 12개의 이름·값이 그대로다', () => {
  assert.equal(Object.keys(EXISTING).length, 12);
  for (const [name, value] of Object.entries(EXISTING)) assert.equal(defined.get(name), value, `${name} 값`);
});

test('tokens.css: 위 54개 말고 다른 변수는 정의하지 않는다(의도하지 않은 추가 방지)', () => {
  const extra = [...defined.keys()].filter(n => !(n in NEW) && !(n in EXISTING));
  assert.deepEqual(extra, []);
});

test('새 변수 이름을 다른 CSS·html 에서 다시 정의하지 않는다(사용만 허용)', () => {
  const files = ['admin.html', 'concept_study.html', 'digest_reading.html', 'english_dictionary.html', 'literature_compass.html', 'science_reading.html', 'voice_study.html',
    'css/common/appHeader.css', 'css/common/screenBar.css'];
  const redefinitions = [];
  for (const f of files) {
    const own = vars(f.endsWith('.html') ? [...read(f).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n') : read(f));
    for (const name of Object.keys(NEW)) if (own.has(name)) redefinitions.push(`${f}: ${name}`);
  }
  assert.deepEqual(redefinitions, []);
});
