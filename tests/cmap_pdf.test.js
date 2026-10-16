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
