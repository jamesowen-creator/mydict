// 스펠링 런: 옛 캐시 JS 가 새 HTML 과 섞이는 일을 막는 정합 검사 (tests/concept_map_cache.test.js 와 같은 규칙).
// public/sw.js 는 JS 를 cache-first 로 서빙하므로, spelling_run.html 이 불러오는 /js/spellrun/*.js 주소의 ?v= 값이 sw.js 의 CACHE_NAME(metis-vN) 숫자 N 과 항상 같아야 한다.
// 배포마다 둘을 함께 올린다.
// 실행: node --test tests/spellrun_cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(PUB, 'spelling_run.html'), 'utf8');

test('spelling_run.html 의 스펠링 런 JS ?v= 값 = sw.js CACHE_NAME 버전', () => {
  const m = sw.match(/const CACHE_NAME = 'metis-v(\d+)'/);
  assert.ok(m, 'sw.js CACHE_NAME 형식');
  const scripts = [...html.matchAll(/<script src="(\/js\/spellrun\/[^"?]+\.js)(\?v=([^"]*))?"><\/script>/g)];
  assert.equal(scripts.length, 3, '스펠링 런 스크립트 3개(logic, stage_style, game): ' + scripts.length);
  for (const [, src, , v] of scripts) assert.equal(v, m[1], `${src} 의 ?v= 값은 sw.js 버전(${m[1]})과 같아야 한다`);
});

test('spelling_run.html 이 불러오는 /js/spellrun 스크립트는 모두 실제 파일이고, public/js/spellrun 의 파일은 빠짐없이 불러온다(순서: logic → stage_style → game)', () => {
  const loaded = [...html.matchAll(/<script src="\/js\/spellrun\/([^"?]+\.js)/g)].map(x => x[1]);
  assert.deepEqual(loaded, ['logic.js', 'stage_style.js', 'game.js']);
  const files = fs.readdirSync(path.join(PUB, 'js', 'spellrun')).filter(f => f.endsWith('.js')).sort();
  assert.deepEqual([...loaded].sort(), files);
});
