// 작업401: speakloop.html 의 JS 주소 ?v= 값 = sw.js CACHE_NAME 버전 (tests/concept_map_cache.test.js·spellrun_cache.test.js 와 같은 규칙).
// sw.js 는 JS 를 cache-first 로 서빙하므로 둘을 배포마다 함께 올려야 옛 캐시 JS 가 새 HTML 과 섞이지 않는다.
// 실행: node --test tests/speakloop_cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(PUB, 'speakloop.html'), 'utf8');

test('speakloop.html 의 /js/speakloop JS ?v= 값 = sw.js CACHE_NAME 버전', () => {
  const m = sw.match(/const CACHE_NAME = 'metis-v(\d+)'/);
  assert.ok(m, 'sw.js CACHE_NAME 형식');
  const scripts = [...html.matchAll(/<script src="(\/js\/speakloop\/[^"?]+\.js)(\?v=([^"]*))?"><\/script>/g)];
  assert.ok(scripts.length >= 5, '스크립트가 있다: ' + scripts.length);
  for (const [, src, , v] of scripts) assert.equal(v, m[1], `${src} 의 ?v= 값은 sw.js 버전(${m[1]})과 같아야 한다`);
});

test('speakloop.html 이 불러오는 /js/speakloop 스크립트는 모두 실제 파일이고, 폴더의 파일은 빠짐없이 불러온다(순서: core → player → rec → app → idiom)', () => {
  const loaded = [...html.matchAll(/<script src="\/js\/speakloop\/([^"?]+\.js)/g)].map(x => x[1]);
  assert.deepEqual(loaded, ['core.js', 'player.js', 'rec.js', 'app.js', 'idiom.js']);
  const files = fs.readdirSync(path.join(PUB, 'js', 'speakloop')).filter(f => f.endsWith('.js')).sort();
  assert.deepEqual([...loaded].sort(), files);
});
