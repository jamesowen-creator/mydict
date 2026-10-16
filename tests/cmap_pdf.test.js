// 작업292-1: mapPdf.js 순수 부분(방향·배치·파일 이름·PDF 바이트 구조). 실행: node --test tests/cmap_pdf.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/js/cmap/mapPdf.js');

test('방향: 가로로 넓으면 가로, 세로로 길면 세로, 정사각형은 세로', () => {
  assert.equal(P.pickOrientation(800, 400), 'landscape');
  assert.equal(P.pickOrientation(400, 800), 'portrait');
  assert.equal(P.pickOrientation(500, 500), 'portrait');
  assert.deepEqual(P.pageSize('landscape'), { w: 842, h: 595 });
  assert.deepEqual(P.pageSize('portrait'), { w: 595, h: 842 });
});

test('배치: 여백 36pt 안에 비율 유지, 가운데', () => {
  const p = P.fitImage(1000, 500, 842, 595);
  assert.ok(Math.abs(p.w / p.h - 2) < 1e-9);
  assert.ok(p.x >= 36 - 1e-9 && p.y >= 36 - 1e-9 && p.x + p.w <= 842 - 36 + 1e-9 && p.y + p.h <= 595 - 36 + 1e-9);
  assert.ok(Math.abs(p.x - (842 - p.w) / 2) < 1e-9);
  const q = P.fitImage(300, 900, 595, 842);   // 세로로 긴 그림: 높이가 한계
  assert.ok(Math.abs(q.h - (842 - 72)) < 1e-9);
  const small = P.fitImage(100, 50, 595, 842);   // 작은 그림은 키워서 맞춘다(한 쪽)
  assert.ok(small.w > 100);
});

test('파일 이름: 금지 문자 제거, 길이 제한, 빈 이름', () => {
  const d = new Date(2026, 9, 16);
  assert.equal(P.safeFileName('과학', d), '지도-과학-20261016.pdf');
  assert.equal(P.safeFileName('a\\b/c:d*e?f"g<h>i|j', d), '지도-abcdefghij-20261016.pdf');
  assert.equal(P.safeFileName('', d), '지도-20261016.pdf');
  assert.equal(P.safeFileName('  /:*  ', d), '지도-20261016.pdf');
  assert.equal(P.safeFileName(undefined, d), '지도-20261016.pdf');
  assert.ok(P.safeFileName('가'.repeat(200), d).length <= '지도-'.length + 40 + '-20261016.pdf'.length);
  assert.equal(P.dateText(d, '-'), '2026-10-16');
});

for (const [name, w, h, ow, oh] of [['가로', 842, 595, 'landscape', 0], ['세로', 595, 842, 'portrait', 0]]) {
  test(`PDF 바이트 구조(${name} A4): 헤더·MediaBox·이미지 XObject·xref 위치·EOF`, () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const page = P.pageSize(ow);
    const bytes = P.buildPdf({ jpeg, imgW: 40, imgH: 20, pageW: page.w, pageH: page.h, place: P.fitImage(40, 20, page.w, page.h) });
    const s = Buffer.from(bytes).toString('latin1');
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.includes(`/MediaBox [0 0 ${w} ${h}]`));
    assert.match(s, /\/Subtype \/Image \/Width 40 \/Height 20 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 7/);
    assert.ok(s.trimEnd().endsWith('%%EOF'));
    const sx = Number(/startxref\n(\d+)\n/.exec(s)[1]);
    assert.equal(s.slice(sx, sx + 4), 'xref', 'startxref 가 xref 표를 가리킴');
    const rows = s.slice(sx).split('\n').slice(2, 8);
    assert.equal(rows.length, 6);
    for (let i = 1; i <= 5; i++) {
      const off = Number(rows[i].slice(0, 10));
      assert.ok(s.slice(off).startsWith(i + ' 0 obj'), `객체 ${i} 위치 정합`);
    }
    const im = s.indexOf('stream\n', s.indexOf('/DCTDecode')) + 7;
    assert.deepEqual([...bytes.slice(im, im + 7)], [...jpeg], '이미지 바이트가 그대로 들어감');
    assert.match(s, /q [\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm \/Im0 Do Q/);
  });
}

// ── 293-1: 제목(주제 경로)·범위 줄·파일 이름·긴 제목 ──
test('제목 문자열: 최상위만 / 2단계 / 5단계, 범위 줄 유무', () => {
  assert.equal(P.titleOf(['자본시장']), '자본시장');
  assert.equal(P.scopeOf(['자본시장']), '', '최상위만이면 범위 줄 없음');
  assert.equal(P.titleOf(['자본시장', '증권 시장']), '자본시장 > 증권 시장');
  assert.equal(P.scopeOf(['자본시장', '증권 시장']), '지도 범위: ‘자본시장’ 전체');
  const five = ['가', '나', '다', '라', '마'];
  assert.equal(P.titleOf(five), '가 > 나 > 다 > 라 > 마');
  assert.equal(P.scopeOf(five), '지도 범위: ‘가’ 전체');
});

test('파일 이름(경로): 이름을 -로 연결, 공백·금지 문자 제거, 40자 제한은 앞부분 유지', () => {
  const d = new Date(2026, 9, 16);
  assert.equal(P.safeFileName(['자본시장', '증권 시장'], d), '지도-자본시장-증권시장-20261016.pdf');
  assert.equal(P.safeFileName(['자본/시장', 'a:b*c'], d), '지도-자본시장-abc-20261016.pdf');
  assert.equal(P.safeFileName(['자본시장'], d), '지도-자본시장-20261016.pdf');
  assert.equal(P.safeFileName(['/', ' '], d), '지도-20261016.pdf');
  const long = P.safeFileName(['가'.repeat(30), '나'.repeat(30)], d);
  assert.equal(long, '지도-' + '가'.repeat(30) + '-' + '나'.repeat(9) + '-20261016.pdf', '앞부분을 지키고 뒤를 자름');
  const body = long.slice('지도-'.length, -'-20261016.pdf'.length);
  assert.ok(body.length <= 40);
});

// 글자 하나 = 크기의 1배 폭(한글처럼), 공백도 같은 폭인 가짜 측정
const meas = (t, size) => [...t].length * size;
test('긴 제목: 최대 2줄, 한 줄이면 그대로, 넘치면 글자 크기를 줄이고(최소 0.7배) 그래도 넘으면 말줄임, 폭 초과 없음', () => {
  const one = P.layoutTitle(meas, '자본시장 > 증권 시장', 20, 400);
  assert.deepEqual(one.lines, ['자본시장 > 증권 시장']); assert.equal(one.size, 20); assert.equal(one.cut, false);
  const names = ['자본시장', '증권 시장', '주식 시장', '유통 시장', '공시 제도'];
  const five = P.layoutTitle(meas, P.titleOf(names), 20, 300);
  assert.ok(five.lines.length <= 2);
  for (const ln of five.lines) assert.ok(meas(ln, five.size) <= 300, ln);
  assert.equal(five.lines.join(' ').replace(/\s+/g, ' ').trim(), P.titleOf(names), '잘림 없이 줄바꿈만');
  const huge = P.layoutTitle(meas, '가'.repeat(200), 20, 300);
  assert.equal(huge.cut, true); assert.equal(huge.lines.length, 2); assert.ok(huge.lines[1].endsWith('…'));
  assert.ok(huge.size >= 14);
  for (const ln of huge.lines) assert.ok(meas(ln, huge.size) <= 300);
});
