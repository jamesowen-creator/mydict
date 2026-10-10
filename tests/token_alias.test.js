// 작업245-1: 화면 :root의 var(--토큰, 폴백) 폴백 값이 tokens.css의 실제 값과 같은지 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(pub, 'css/common/tokens.css'), 'utf8');
const norm = v => { v = v.trim().toLowerCase(); const m = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/); return m ? '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : v; };
const tokens = {};
for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[m[1]] = norm(m[2]);

for (const f of fs.readdirSync(pub).filter(n => n.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(pub, f), 'utf8');
  const refs = [...html.matchAll(/--[\w-]+:\s*var\((--[\w-]+),\s*([^)]+)\)/g)];
  if (!refs.length) continue;
  test(`${f}: var() 폴백이 tokens.css 값과 같음`, () => {
    assert.match(html, /\/css\/common\/tokens\.css/, 'tokens.css 링크');
    for (const [, name, fb] of refs) {
      assert.ok(tokens[name], `${name}이 tokens.css에 없음`);
      assert.equal(norm(fb), tokens[name], `${f} ${name} 폴백`);
    }
  });
}
