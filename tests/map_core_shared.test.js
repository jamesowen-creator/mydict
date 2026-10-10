// 작업237-2: 지도 순수 함수(배치·정렬·선 곡선)가 public/js/map/mapCore.js 한 곳에만 있고, 개념·음성 학습 화면이 그것을 불러 쓰는지 확인한다.
// 브라우저 없이 파일 내용만 본다. 실행: node --test tests/map_core_shared.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');
const core = read('js/map/mapCore.js');
const pages = { 'concept_study.html': read('concept_study.html'), 'voice_study.html': read('voice_study.html') };
const SCRIPT_TAG = '<script src="/js/map/mapCore.js?v=1"></script>';

test('mapCore.js: 순수 함수와 상수를 전역 클래식 스크립트로 정의(import/export 없음)', () => {
  for (const decl of ['function sortLevels(', 'function layoutMap(', 'function edgeGeom(', 'function clipText(', 'function sv(',
    'const MAPD = ', 'const SVGNS = ', 'let MAP_LAYOUT_SWEEPS = ']) {
    assert.ok(core.includes(decl), '정의 있음: ' + decl);
  }
  assert.doesNotMatch(core, /^\s*(import|export)\s/m, '모듈 문법 사용 안 함');
});

for (const [name, html] of Object.entries(pages)) {
  test(`${name}: mapCore.js 를 불러오고, 본 스크립트보다 먼저 로드한다`, () => {
    assert.equal(html.split(SCRIPT_TAG).length - 1, 1, '스크립트 태그 1개');
    const tagAt = html.indexOf(SCRIPT_TAG);
    const mainAt = html.indexOf('\n<script>\n', tagAt);   // 태그 뒤에 나오는 첫 인라인 본 스크립트
    assert.ok(mainAt > tagAt, '본 스크립트가 태그 뒤에 있음');
    assert.ok(!html.slice(0, tagAt).includes('\n<script>\n'), '본 스크립트가 태그보다 앞에 없음');
  });
}

test('두 화면 안에는 배치·정렬·선 곡선 함수 본문이 다시 정의되어 있지 않다', () => {
  for (const [name, html] of Object.entries(pages)) {
    for (const re of [/^function sortLevels\(/m, /^function layoutMap\(/m, /^function edgeGeom\(/m, /^const MAPD = \{/m, /^let MAP_LAYOUT_SWEEPS\b/m, /^function sv\(/m, /^function clipText\(/m]) {
      assert.doesNotMatch(html, re, `${name} 에 ${re} 가 있음`);
    }
  }
  // 음성 화면의 기존 이름은 공용 함수를 부르는 한 줄 별칭만 남는다
  const v = pages['voice_study.html'];
  for (const [alias, target] of [['vmapSortLevels', 'sortLevels'], ['vmapLayout', 'layoutMap'], ['vmapEdgeGeom', 'edgeGeom'], ['vmapClip', 'clipText'], ['vmapSv', 'sv']]) {
    const m = v.match(new RegExp(`^function ${alias}\\([^)]*\\) \\{ return ${target}\\(`, 'm'));
    assert.ok(m, `${alias} 는 ${target} 을 부르는 한 줄 별칭`);
  }
  assert.match(v, /^const VMAPD = MAPD;/m);
});
