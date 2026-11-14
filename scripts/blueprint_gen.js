#!/usr/bin/env node
// 작업447: 도면 생성. docs/blueprint/screens/*.md 의 머리말(--- 사이 "키: 값")을 읽어
//   (a) docs/blueprint/README.md 의 <!-- gen:start --> ~ <!-- gen:end --> 구간(엔진·API·테이블·외부 서비스별 사용 화면)과
//   (b) docs/blueprint/map.html(시각 도면, 외부 주소 없는 한 파일)
// 을 만든다. 같은 입력이면 같은 출력(정렬 고정, 시각 정보 없음). Node 만 쓴다. 실행: npm run blueprint:gen
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'blueprint');
const SCREENS = path.join(DIR, 'screens');
const README = path.join(DIR, 'README.md');
const MAP = path.join(DIR, 'map.html');
const LIST_KEYS = ['engines', 'apis', 'tables', 'externals', 'storage'];

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// "[a, b(c, d), e]" → ['a', 'b(c, d)', 'e'] (괄호 안의 쉼표는 나누지 않는다)
function splitList(inner) {
  const out = []; let depth = 0, cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function parseFront(text, name) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) throw new Error(name + ': 머리말(--- 사이)이 없습니다');
  const o = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(name + ': 머리말 줄 형식 오류: ' + line);
    const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim();
    if (LIST_KEYS.includes(k)) {
      if (!(v.startsWith('[') && v.endsWith(']'))) throw new Error(name + ': ' + k + ' 는 [..] 목록이어야 합니다');
      o[k] = splitList(v.slice(1, -1));
    } else o[k] = v;
  }
  for (const k of ['screen', 'file', 'last_checked']) if (!o[k]) throw new Error(name + ': 머리말에 ' + k + ' 가 없습니다');
  for (const k of LIST_KEYS) o[k] = o[k] || [];
  return o;
}

function loadScreens() {
  if (!fs.existsSync(SCREENS)) return [];
  return fs.readdirSync(SCREENS).filter(f => f.endsWith('.md')).sort(byCode).map(f => {
    const o = parseFront(fs.readFileSync(path.join(SCREENS, f), 'utf8'), 'screens/' + f);
    o.id = f.replace(/\.md$/, '');
    return o;
  });
}

// public 의 사용자 접근 화면(html) 전체. 머리말의 file 에 없는 것이 "미작성 화면"
function publicPages() {
  const pub = path.join(ROOT, 'public');
  const files = fs.readdirSync(pub).filter(f => f.endsWith('.html')).map(f => 'public/' + f);
  if (fs.existsSync(path.join(pub, 'home', 'index.html'))) files.push('public/home/index.html');
  return files.sort(byCode).map(file => {
    const t = fs.readFileSync(path.join(ROOT, file), 'utf8').match(/<title>([^<]*)<\/title>/);
    return { file, title: t ? t[1].trim() : file };
  });
}

function usageMap(screens, key) {
  const m = new Map();
  for (const s of screens) for (const it of s[key]) { if (!m.has(it)) m.set(it, []); m.get(it).push(s.screen); }
  return [...m.entries()].sort((a, b) => byCode(a[0], b[0])).map(([k, v]) => [k, v.sort(byCode)]);
}

function genSection(screens, pages) {
  const written = new Set(screens.map(s => s.file));
  const todo = pages.filter(p => !written.has(p.file));
  const L = [];
  L.push('> 이 구간은 `npm run blueprint:gen` 이 화면 파일(docs/blueprint/screens)의 머리말에서 만든다. 손으로 고치지 않는다.');
  L.push('> **도면이 작성된 화면(' + screens.length + '개)만 반영한다.** 미작성 화면이 같은 엔진·API·테이블을 쓰는지는 이 목록에 나오지 않으므로 코드로 직접 확인한다.');
  L.push('');
  const sect = (title, key) => {
    L.push('### ' + title);
    const rows = usageMap(screens, key);
    if (!rows.length) L.push('- (없음)');
    for (const [k, v] of rows) L.push('- **' + k + '** — ' + v.join(', '));
    L.push('');
  };
  sect('엔진별 사용 화면', 'engines');
  sect('API별 사용 화면', 'apis');
  sect('테이블별 사용 화면', 'tables');
  sect('외부 서비스별 사용 화면', 'externals');
  L.push('### 미작성 화면 (' + todo.length + '개)');
  L.push(todo.length ? todo.map(p => p.title + '(' + p.file + ')').join(', ') : '(없음)');
  L.push('');
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  L.push('화면 파일의 마지막 확인 커밋: ' + (hashes.length ? hashes.join(', ') : '(없음)'));
  return L.join('\n');
}

function writeReadme(section) {
  const text = fs.readFileSync(README, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const S = '<!-- gen:start -->', E = '<!-- gen:end -->';
  const a = text.indexOf(S), b = text.indexOf(E);
  if (a < 0 || b < 0 || b < a) throw new Error('README.md 에 gen:start / gen:end 표시가 없습니다');
  const next = text.slice(0, a + S.length) + eol + section.split('\n').join(eol) + eol + text.slice(b);
  if (next !== text) fs.writeFileSync(README, next);
}

// ── map.html ────────────────────────────────────────────────────────────────
function mapData(screens, pages) {
  const written = new Set(screens.map(s => s.file));
  const nodes = [];   // { id, col: 'screen'|'engine'|'store', label, kind, todo, apis, storage, file }
  const links = [];   // [idA, idB]
  const add = (id, col, label, extra) => { if (!nodes.some(n => n.id === id)) nodes.push(Object.assign({ id, col, label }, extra || {})); };
  for (const s of screens) add('s:' + s.screen, 'screen', s.screen, { file: s.file, apis: s.apis, storage: s.storage, todo: false });
  for (const p of pages) if (!written.has(p.file)) add('s:' + p.title + '|' + p.file, 'screen', p.title, { file: p.file, apis: [], storage: [], todo: true });
  for (const s of screens) {
    for (const e of s.engines) { add('e:' + e, 'engine', e); links.push(['s:' + s.screen, 'e:' + e]); }
    for (const t of s.tables) { add('t:' + t, 'store', t, { kind: 'DB 테이블' }); links.push(['s:' + s.screen, 't:' + t]); }
    for (const x of s.externals) { add('x:' + x, 'store', x, { kind: '외부 서비스' }); links.push(['s:' + s.screen, 'x:' + x]); }
  }
  const order = { screen: 0, engine: 1, store: 2 };
  nodes.sort((a, b) => order[a.col] - order[b.col] || (a.todo === b.todo ? 0 : a.todo ? 1 : -1) || (a.kind === b.kind ? 0 : byCode(a.kind || '', b.kind || '')) || byCode(a.label, b.label));
  links.sort((a, b) => byCode(a.join('>'), b.join('>')));
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  return { nodes, links, commit: hashes.join(', ') };
}

function mapHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>METIS-3 도면</title>
<style>
:root { --bg:#fafaf9; --card:#ffffff; --text:#1a1a1a; --sub:#555b66; --line:#d9d9d4; --accent:#b8442e; --accent-bg:#fdf0ec; --rel-bg:#eaf4ee; --rel-line:#2f7d57; }
@media (prefers-color-scheme: dark) { :root { --bg:#17181a; --card:#212326; --text:#f1f1ee; --sub:#a9adb5; --line:#3a3d42; --accent:#ff8c73; --accent-bg:#3a2520; --rel-bg:#1d3327; --rel-line:#5fc08e; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; }
.hint { font-size: 14px; color: var(--sub); margin: 0 0 12px; }
.grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 720px) { .grid { grid-template-columns: repeat(3, 1fr); } }
.col h2 { font-size: 14px; margin: 0 0 8px; color: var(--sub); font-weight: 700; }
.col .group { font-size: 14px; color: var(--sub); margin: 12px 0 4px; }
.item { display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 10px 12px; min-height: 44px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); font: inherit; font-size: 16px; cursor: pointer; overflow-wrap: anywhere; }
.item small { display: block; font-size: 14px; color: var(--sub); }
.item.todo { border-style: dashed; color: var(--sub); background: transparent; }
.item.sel { border-color: var(--accent); background: var(--accent-bg); box-shadow: 0 0 0 2px var(--accent) inset; }
.item.rel { border-color: var(--rel-line); background: var(--rel-bg); }
.dim .item:not(.sel):not(.rel) { opacity: .35; }
#detail { margin-top: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font-size: 15px; overflow-wrap: anywhere; }
#detail b { display: block; margin-bottom: 4px; }
#detail ul { margin: 4px 0 8px; padding-left: 20px; }
.foot { margin-top: 12px; font-size: 14px; color: var(--sub); }
</style>
</head>
<body>
<h1>METIS-3 도면</h1>
<p class="hint">항목을 누르면 연결된 항목이 강조되고 나머지는 흐려집니다. 같은 항목을 다시 누르면 해제됩니다. 점선·회색 = 도면 미작성 화면.</p>
<div class="grid" id="grid">
  <div class="col" id="col-screen"><h2>화면</h2></div>
  <div class="col" id="col-engine"><h2>엔진</h2></div>
  <div class="col" id="col-store"><h2>DB · 외부 서비스</h2></div>
</div>
<div id="detail" aria-live="polite">항목을 눌러 보세요.</div>
<p class="foot">이 파일은 <code>npm run blueprint:gen</code> 이 docs/blueprint/screens 의 머리말에서 만든다(직접 고치지 않는다). 화면 파일 마지막 확인 커밋: <span id="commit"></span></p>
<script id="data" type="application/json">${json}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var nodes = data.nodes, byId = {};
  nodes.forEach(function (n) { byId[n.id] = n; n.rel = []; });
  data.links.forEach(function (l) { byId[l[0]].rel.push(l[1]); byId[l[1]].rel.push(l[0]); });
  document.getElementById('commit').textContent = data.commit || '(없음)';
  var cols = { screen: document.getElementById('col-screen'), engine: document.getElementById('col-engine'), store: document.getElementById('col-store') };
  var lastKind = '';
  nodes.forEach(function (n) {
    if (n.col === 'store' && n.kind !== lastKind) { lastKind = n.kind; var g = document.createElement('div'); g.className = 'group'; g.textContent = n.kind; cols.store.appendChild(g); }
    var b = document.createElement('button'); b.type = 'button'; b.className = 'item' + (n.todo ? ' todo' : ''); b.setAttribute('aria-pressed', 'false'); b.dataset.id = n.id;
    b.textContent = n.label;
    if (n.todo) { var s = document.createElement('small'); s.textContent = '도면 미작성'; b.appendChild(s); }
    b.addEventListener('click', function () { select(selected === n.id ? null : n.id); });
    n.el = b; cols[n.col].appendChild(b);
  });
  var selected = null, grid = document.getElementById('grid'), detail = document.getElementById('detail');
  function list(title, arr) {
    if (!arr || !arr.length) return;
    var b = document.createElement('b'); b.textContent = title; detail.appendChild(b);
    var ul = document.createElement('ul'); arr.forEach(function (x) { var li = document.createElement('li'); li.textContent = x; ul.appendChild(li); }); detail.appendChild(ul);
  }
  function select(id) {
    selected = id;
    nodes.forEach(function (n) { n.el.classList.remove('sel', 'rel'); n.el.setAttribute('aria-pressed', 'false'); });
    detail.textContent = '';
    if (!id) { grid.classList.remove('dim'); detail.textContent = '항목을 눌러 보세요.'; return; }
    var n = byId[id]; grid.classList.add('dim');
    n.el.classList.add('sel'); n.el.setAttribute('aria-pressed', 'true');
    n.rel.forEach(function (r) { byId[r].el.classList.add('rel'); });
    var t = document.createElement('b'); t.textContent = n.label + (n.file ? '  (' + n.file + ')' : '') + (n.kind ? '  — ' + n.kind : ''); detail.appendChild(t);
    if (n.todo) { var p = document.createElement('div'); p.textContent = '이 화면은 도면이 아직 없습니다(연결 정보 없음).'; detail.appendChild(p); return; }
    var names = function (col) { return n.rel.filter(function (r) { return byId[r].col === col; }).map(function (r) { return byId[r].label; }); };
    if (n.col === 'screen') { list('엔진', names('engine')); list('DB·외부 서비스', names('store')); list('API', n.apis); list('저장값·주소 옵션', n.storage); }
    else list('이 항목을 쓰는 화면(도면이 있는 화면만)', names('screen'));
  }
})();
</script>
</body>
</html>
`;
}

function main() {
  const screens = loadScreens(), pages = publicPages();
  writeReadme(genSection(screens, pages));
  fs.writeFileSync(MAP, mapHtml(mapData(screens, pages)));
  console.log('blueprint:gen 완료 — 화면 파일 ' + screens.length + '개, 미작성 ' + pages.filter(p => !screens.some(s => s.file === p.file)).length + '개');
}
main();
