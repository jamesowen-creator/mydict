// 작업N: 홈 빌드본(public/home)이 index.html 과 맞는지 — 브라우저 없이 파일만 본다. (작업CL-1 에서 삭제된 concept_home_admin.ui.test.js 안의 같은 점검을 다시 만든 것)
//  - index.html 이 가리키는 번들(.js·.css)이 모두 있고, assets 폴더에는 그 파일들만 있다(쓰지 않는 옛 번들이 남지 않음)
//  - 번들에 일본어 문법 정식 항목은 있고, "(임시)" 링크·삭제된 개념학습 주소는 없다
//  - 줄바꿈(CRLF/LF)은 확인하지 않는다: 기존 index.html 은 두 가지가 섞여 있고 임의로 바꾸지 않는다(보고서에 현황만 적음)
// 실행: node --test tests/home_bundle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = path.join(__dirname, '..', 'public', 'home');
const html = fs.readFileSync(path.join(home, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="\/home\/assets\/([^"]+)"/g)].map(m => m[1]);
const js = () => fs.readFileSync(path.join(home, 'assets', refs.find(f => f.endsWith('.js'))), 'utf8');

test('index.html 이 가리키는 번들(.js 1개·.css 1개)이 모두 있고 assets 에는 그 파일들만 있다', () => {
  assert.equal(refs.filter(f => f.endsWith('.js')).length, 1);
  assert.equal(refs.filter(f => f.endsWith('.css')).length, 1);
  for (const f of refs) assert.ok(fs.existsSync(path.join(home, 'assets', f)), '번들 파일 존재: ' + f);
  assert.deepEqual(fs.readdirSync(path.join(home, 'assets')).sort(), refs.slice().sort(), '쓰지 않는 옛 번들이 남아 있지 않음');
});

test('번들: 일본어 문법 정식 항목(라벨·주소)은 있고, "(임시)" 링크 문구와 삭제된 개념학습 주소는 없다', () => {
  const code = js();
  assert.ok(code.includes('/jgrammar.html') && code.includes('일본어 문법'));
  assert.ok(!code.includes('일본어 문법 (임시)') && !code.includes('(임시)'));
  assert.ok(!code.includes('/concept_study.html') && !code.includes('개념학습'));
  for (const url of ['/english_dictionary.html', '/literature_compass.html', '/digest_reading.html', '/science_reading.html', '/voice_study.html', '/artist_notes.html', '/concept_map.html']) assert.ok(code.includes(url), '기존 진입 주소 유지: ' + url);
});

test('홈 소스: 일본어 문법은 언어 사전 바로 다음에 끼우고(기존 항목 순서 그대로), 권한 판정은 perm_jgrammar===true 또는 role===admin', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'home-wheel', 'src', 'HomeWheelApp.jsx'), 'utf8');
  assert.match(src, /user\.perm_jgrammar === true \|\| user\.role === 'admin'/);
  assert.match(src, /list\.splice\(list\.findIndex\(\(o\) => o\.id === 'dictionary'\) \+ 1, 0, JGRAMMAR_OPTION\)/);
  assert.match(src, /id: 'jgrammar', name: '일본어 문법'[^}]*url: '\/jgrammar\.html'/);
  assert.ok(!/\(임시\)/.test(src.replace(/\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}/g, '')), '코드(주석 제외)에 (임시) 문구 없음');
  const ids = [...src.matchAll(/\{ id: '(\w+)', name:/g)].map(m => m[1]);
  assert.deepEqual(ids.slice(0, 6), ['dictionary', 'literature', 'digest', 'science', 'voice', 'artist_notes'], '기존 6개의 순서');
});
