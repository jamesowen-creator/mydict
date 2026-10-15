// 작업283-2: 옛 캐시 JS 가 새 HTML 과 섞여 내비가 죽는 일을 막는 정합 검사.
// public/sw.js 는 JS 를 cache-first 로 서빙하므로, concept_map.html 이 불러오는 개념 지도 JS 주소의 ?v= 값이 sw.js 의 CACHE_NAME(metis-vN) 숫자 N 과 항상 같아야 한다.
// (주소가 바뀌면 옛 서비스 워커의 옛 캐시에 그 주소가 없어 네트워크에서 새 파일을 받는다.) 배포마다 둘을 함께 올린다.
// 실행: node --test tests/concept_map_cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(PUB, 'concept_map.html'), 'utf8');

test('concept_map.html 의 지도 JS ?v= 값 = sw.js CACHE_NAME 버전', () => {
  const m = sw.match(/const CACHE_NAME = 'metis-v(\d+)'/);
  assert.ok(m, 'sw.js CACHE_NAME 형식');
  const scripts = [...html.matchAll(/<script src="(\/js\/(?:cmap|map)\/[^"?]+\.js)(\?v=([^"]*))?"><\/script>/g)];
  assert.ok(scripts.length >= 10, '지도 관련 스크립트가 있다: ' + scripts.length);
  for (const [, src, , v] of scripts) assert.equal(v, m[1], `${src} 의 ?v= 값은 sw.js 버전(${m[1]})과 같아야 한다`);
});

test('concept_map.html 이 불러오는 /js/cmap 스크립트는 모두 실제 파일이고, public/js/cmap 의 파일은 빠짐없이 불러온다', () => {
  const loaded = [...html.matchAll(/<script src="\/js\/cmap\/([^"?]+\.js)/g)].map(x => x[1]).sort();
  const files = fs.readdirSync(path.join(PUB, 'js', 'cmap')).filter(f => f.endsWith('.js')).sort();
  assert.deepEqual(loaded, files);
});
