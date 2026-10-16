// 작업292-1: 개념 지도 PDF 저장(개념 지도 전용). 서버·외부 라이브러리 없이 화면에서 만든다.
//   지도 SVG 복제본(계산 스타일 인라인) → 이미지 → 캔버스(제목·날짜 포함) → JPEG → 최소 PDF(A4 한 쪽, 이미지 한 장).
//   JPEG 를 고른 이유: 캔버스 toBlob 이 만든 JPEG 바이트를 DCTDecode 이미지로 그대로 넣을 수 있어 압축기가 필요 없다(PNG 는 Flate+predictor 재인코딩이 필요).
// 클래식 스크립트(window.CmapPdf)이면서 Node 테스트에서는 require 로 순수 부분(방향·배치·파일 이름·PDF 바이트)을 불러올 수 있다.
(function (root) {
  'use strict';
  const A4 = { w: 595, h: 842 }, MARGIN = 36, MAX_SIDE = 2400, MAX_SCALE = 3, MIN_W = 480, MIN_H = 340, NAME_MAX = 40;

  // 지도(그림) 가로/세로 비율이 1보다 크면 가로 용지, 아니면 세로 용지
  const pickOrientation = (w, h) => (w / h > 1 ? 'landscape' : 'portrait');
  const pageSize = o => (o === 'landscape' ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h });
  // 이미지를 여백 안에 비율을 유지해 맞추고 가운데에 둔다(PDF 좌표: 원점은 왼쪽 아래)
  function fitImage(imgW, imgH, pageW, pageH, margin) {
    const m = margin === undefined ? MARGIN : margin;
    const s = Math.min((pageW - 2 * m) / imgW, (pageH - 2 * m) / imgH);
    const w = imgW * s, h = imgH * s;
    return { x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
  }
  const pad2 = n => String(n).padStart(2, '0');
  const dateText = (d, sep) => d.getFullYear() + sep + pad2(d.getMonth() + 1) + sep + pad2(d.getDate());
  // 293-1: 제목은 주제 경로(names = 최상위 → 현재 주제), 하위 주제일 때만 "지도 범위" 줄이 붙는다(지도는 최상위 주제 전체의 것)
  const TITLE_SEP = ' > ';
  const titleOf = names => names.join(TITLE_SEP);
  const scopeOf = names => (names.length > 1 ? '지도 범위: ‘' + names[0] + '’ 전체' : '');
  // 파일 이름: 경로 이름을 '-'로 잇고 공백·금지 문자를 지운다. 길면 뒤쪽을 잘라 앞부분(최상위 주제)을 지킨다
  function safeFileName(names, d) {
    const list = (Array.isArray(names) ? names : [names]).map(x => String(x || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '')).filter(Boolean);
    const t = list.join('-').replace(/^[.-]+/, '').slice(0, NAME_MAX).replace(/[.-]+$/, '');
    return '지도-' + (t ? t + '-' : '') + dateText(d, '') + '.pdf';
  }
  // 제목 배치(순수): 기본 글자 크기에서 시작해 두 줄에 들어갈 때까지 크기를 줄이고(최소 MIN_TITLE_RATIO), 그래도 넘으면 둘째 줄을 말줄임한다. 공백이 있으면 거기서 줄을 바꾼다
  const TITLE_LINES = 2, MIN_TITLE_RATIO = 0.7;
  function wrapLines(measure, text, size, maxW) {
    const lines = [];
    let cur = '';
    for (const ch of text) {
      if (!cur || measure(cur + ch, size) <= maxW) { cur += ch; continue; }
      const sp = cur.lastIndexOf(' ');
      if (sp > 0 && ch !== ' ') { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; } else { lines.push(cur); cur = ch === ' ' ? '' : ch; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function layoutTitle(measure, text, baseSize, maxW) {
    for (let r = 1; r >= MIN_TITLE_RATIO - 1e-9; r -= 0.1) {
      const size = Math.round(baseSize * r), lines = wrapLines(measure, text, size, maxW);
      if (lines.length <= TITLE_LINES) return { size, lines, cut: false };
    }
    const size = Math.round(baseSize * MIN_TITLE_RATIO), lines = wrapLines(measure, text, size, maxW).slice(0, TITLE_LINES);
    let last = lines[TITLE_LINES - 1];
    while (last.length > 1 && measure(last + '…', size) > maxW) last = last.slice(0, -1);
    lines[TITLE_LINES - 1] = last + '…';
    return { size, lines, cut: true };
  }

  // 최소 PDF: 카탈로그 · 페이지 목록 · 페이지 · 내용(이미지 그리기) · 이미지(DCTDecode) · xref · trailer. 문자열은 모두 ASCII 라 글자 수 = 바이트 수
  function buildPdf(o) {
    const enc = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    const f = n => (Math.round(n * 100) / 100).toString();
    const p = o.place;
    const content = `q ${f(p.w)} 0 0 ${f(p.h)} ${f(p.x)} ${f(p.y)} cm /Im0 Do Q`;
    const parts = [], offsets = [];
    let len = 0;
    const push = u => { parts.push(u); len += u.length; };
    const text = s => push(enc(s));
    const obj = (n, body) => { offsets[n] = len; text(n + ' 0 obj\n' + body + '\nendobj\n'); };
    text('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${o.pageW} ${o.pageH}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
    obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[5] = len;
    text(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${o.imgW} /Height ${o.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${o.jpeg.length} >>\nstream\n`);
    push(o.jpeg);
    text('\nendstream\nendobj\n');
    const xref = len;
    let x = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    text(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let at = 0;
    for (const u of parts) { out.set(u, at); at += u.length; }
    return out;
  }

  const api = { A4, MARGIN, pickOrientation, pageSize, fitImage, safeFileName, dateText, buildPdf, MIN_W, MIN_H, titleOf, scopeOf, layoutTitle, TITLE_LINES };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ── 브라우저 전용 ──
  const NS = 'http://www.w3.org/2000/svg';
  const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'paint-order'];
  // 선택·흐림·강조 같은 화면용 상태는 PDF 에 넣지 않는다: 이 클래스를 잠깐 떼고(같은 동작 안에서 되돌림, 화면이 그려지지 않음) 계산 스타일을 읽는다
  const SCREEN_CLASSES = ['sel', 'dim', 'hl', 'preview', 'marked'];

  function cloneForExport(svg, view) {
    const orig = [...svg.querySelectorAll('*')];
    const removed = [];
    for (const el of orig) for (const c of SCREEN_CLASSES) if (el.classList && el.classList.contains(c)) { el.classList.remove(c); removed.push([el, c]); }
    const clone = svg.cloneNode(true);
    const copies = [...clone.querySelectorAll('*')];
    try {
      orig.forEach((el, i) => {
        const cs = getComputedStyle(el), t = copies[i];
        if (!t) return;
        const st = [];
        for (const k of PROPS) { const v = cs.getPropertyValue(k); if (v) st.push(k + ':' + v); }
        t.setAttribute('style', st.join(';'));
      });
    } finally { for (const [el, c] of removed) el.classList.add(c); }
    for (const el of [...clone.querySelectorAll('.m-edge-hit, .m-mark')]) el.remove();
    for (const el of [clone, ...clone.querySelectorAll('*')]) { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label'); el.removeAttribute('data-node'); el.removeAttribute('data-edge'); el.removeAttribute('data-t'); }
    clone.removeAttribute('style'); clone.removeAttribute('class');
    clone.setAttribute('xmlns', NS);
    clone.setAttribute('width', String(view.w)); clone.setAttribute('height', String(view.h));
    clone.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    return clone;
  }
  const loadImage = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('지도 그림을 만들지 못했어요.')); im.src = src; });
  const toJpeg = (cv, q) => new Promise((ok, no) => cv.toBlob(b => (b ? ok(b) : no(new Error('이미지를 만들지 못했어요.'))), 'image/jpeg', q));

  // pts: [{x,y}] 노드 왼쪽 위 좌표(화면과 같은 값), nodeW/nodeH: 노드 크기. 반환: { blob, fileName }
  async function make(o) {
    const pad = 24;
    let x0 = Math.min(...o.pts.map(p => p.x)) - pad, y0 = Math.min(...o.pts.map(p => p.y)) - pad;
    let x1 = Math.max(...o.pts.map(p => p.x + o.nodeW)) + pad, y1 = Math.max(...o.pts.map(p => p.y + o.nodeH)) + pad;
    if (x1 - x0 < MIN_W) { const c = (x0 + x1) / 2; x0 = c - MIN_W / 2; x1 = c + MIN_W / 2; }   // 아주 작은 지도가 용지를 가득 채워 글자가 커지지 않게
    if (y1 - y0 < MIN_H) { const c = (y0 + y1) / 2; y0 = c - MIN_H / 2; y1 = c + MIN_H / 2; }
    const view = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const scale = Math.min(MAX_SCALE, MAX_SIDE / Math.max(view.w, view.h));
    const mw = Math.round(view.w * scale), mh = Math.round(view.h * scale);
    const names = o.names && o.names.length ? o.names : ['지도'], scope = scopeOf(names);
    const baseSize = Math.max(22, Math.round(mw * 0.032)), edge = baseSize;
    // 제목 영역(제목 최대 2줄 + 범위 줄)의 높이만 달라진다: 지도 영역 크기·용지 맞춤 계산은 그대로
    const fam = o.fontFamily || 'sans-serif';
    const probe = document.createElement('canvas').getContext('2d');
    const dateSize = Math.round(baseSize * 0.6), scopeSize = Math.max(14, Math.round(baseSize * 0.55));
    probe.font = `400 ${dateSize}px ${fam}`;
    const dateW = probe.measureText(o.date).width;
    const maxW = mw - edge * 3 - dateW;
    const lay = layoutTitle((t, sz) => { probe.font = `700 ${sz}px ${fam}`; return probe.measureText(t).width; }, titleOf(names), baseSize, maxW);
    const lineH = Math.round(lay.size * 1.35);
    const headH = Math.round(edge * 0.6 + lineH * lay.lines.length + (scope ? scopeSize * 1.5 : 0) + edge * 0.6);
    const W = mw, H = mh + headH;
    api.lastMeta = { title: titleOf(names), scope, lines: lay.lines.slice() };   // 테스트·점검용: 마지막으로 만든 PDF 의 제목 데이터
    const clone = cloneForExport(o.svg, view);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = o.background || 'white';   // 화면 지도 바탕색(토큰)을 계산 스타일로 받는다
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, headH, mw, mh);
    ctx.fillStyle = o.ink || 'black';
    ctx.textBaseline = 'middle';
    const y0t = edge * 0.6;
    ctx.font = `400 ${dateSize}px ${fam}`;
    ctx.textAlign = 'right'; ctx.fillText(o.date, W - edge, y0t + lineH / 2);
    ctx.font = `700 ${lay.size}px ${fam}`;
    ctx.textAlign = 'left';
    lay.lines.forEach((ln, i) => ctx.fillText(ln, edge, y0t + lineH * (i + 0.5)));
    if (scope) { ctx.font = `400 ${scopeSize}px ${fam}`; ctx.fillText(scope, edge, y0t + lineH * lay.lines.length + scopeSize * 0.6); }
    const blob = await toJpeg(cv, 0.92);
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const page = pageSize(pickOrientation(W, H));
    const bytes = buildPdf({ jpeg, imgW: W, imgH: H, pageW: page.w, pageH: page.h, place: fitImage(W, H, page.w, page.h) });
    return { blob: new Blob([bytes], { type: 'application/pdf' }), fileName: safeFileName(names, o.dateObj) };
  }

  // 파일 공유가 되는 환경이면 공유 시트, 아니면 다운로드. 공유 시트를 닫아 취소한 경우(AbortError)는 오류가 아니다. 테스트에서는 api.deliverImpl 을 바꿔 끼운다
  async function deliver(blob, fileName) {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: fileName }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; throw e; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  }
  api.make = make; api.deliver = (b, n) => api.deliverImpl(b, n); api.deliverImpl = deliver;
  root.CmapPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
