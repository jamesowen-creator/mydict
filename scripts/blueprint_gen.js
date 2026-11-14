#!/usr/bin/env node
// 작업447·448: 도면 생성·검증. docs/blueprint/screens/*.md 의 머리말(--- 사이 "키: 값")을 LEGEND.md 표준과 대조하고(표준 밖이면 오류로 멈춤),
//   (a) README.md 의 <!-- gen:start --> ~ <!-- gen:end --> 구간(엔진·API·저장소·기기 저장값·외부·모듈별 사용 화면, 대체 경로, 미작성 화면)
//   (b) map.html(시각 도면, 외부 주소 없는 한 파일)
//   (c) _bundle.md(README → LEGEND → screens 를 한 파일로 묶음, 웹 Claude 에 첨부하는 용도)
// 을 만든다. 같은 입력이면 같은 출력(정렬 고정, 시각 정보 없음, 기준 커밋 = 화면 파일의 last_checked). Node 만 쓴다. 실행: npm run blueprint:gen
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'blueprint');
const SCREENS = path.join(DIR, 'screens');
const README = path.join(DIR, 'README.md');
const LEGEND = path.join(DIR, 'LEGEND.md');
const MAP = path.join(DIR, 'map.html');
const BUNDLE = path.join(DIR, '_bundle.md');

const KEYS = ['screen', 'file', 'engines', 'calls', 'reads', 'writes', 'fallback', 'requires', 'navigates', 'externals', 'modules', 'last_checked'];
const LIST_KEYS = ['engines', 'calls', 'reads', 'writes', 'fallback', 'requires', 'navigates', 'externals', 'modules'];
const STORE_PREFIX = ['DB', '캐시', '기기'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lf = t => t.replace(/\r\n/g, '\n');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

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

// ── LEGEND 표준 읽기 ────────────────────────────────────────────────────────
function loadLegend() {
  const text = lf(fs.readFileSync(LEGEND, 'utf8'));
  const sect = n => { const m = text.match(new RegExp('^## ' + n + ' [^\\n]*\\n([\\s\\S]*?)(?=\\n## \\d|(?![\\s\\S]))', 'm')); if (!m) throw new Error('LEGEND.md 에 "## ' + n + '" 절이 없습니다'); return m[1]; };
  const engines = sect(3).split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| 엔진 ') && !/^\|[-| ]+\|$/.test(l)).map(l => l.split('|')[1].trim()).filter(Boolean);
  const line = (s, re) => { const l = s.split('\n').find(x => re.test(x)); if (!l) throw new Error('LEGEND.md 목록 줄을 찾지 못했습니다: ' + re); return l.split(' / ').map(x => x.trim()).filter(Boolean); };
  const externals = line(sect(4), /^Anthropic API/);
  const screens = line(sect(5), /^홈 \//);
  if (!engines.length || !externals.length || !screens.length) throw new Error('LEGEND.md 의 엔진·외부·화면 목록이 비었습니다');
  return { engines, externals, screens };
}

// ── 화면 파일 머리말 읽기·검증 ──────────────────────────────────────────────
function parseFront(text, name, errs) {
  const src = lf(text);
  const m = src.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) { errs.push(name + ':1: 머리말(--- 사이)이 없습니다'); return null; }
  const o = {}, lineOf = {};
  m[1].split('\n').forEach((line, idx) => {
    const ln = idx + 2;
    if (!line.trim()) return;
    const i = line.indexOf(':');
    if (i < 0) { errs.push(name + ':' + ln + ': 머리말 줄 형식 오류(키: 값): ' + line); return; }
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (!KEYS.includes(k)) { errs.push(name + ':' + ln + ': 표준에 없는 키 "' + k + '" (표준 키: ' + KEYS.join(', ') + ')'); return; }
    if (k in o) { errs.push(name + ':' + ln + ': 키 "' + k + '" 가 두 번 나옵니다'); return; }
    lineOf[k] = ln;
    if (LIST_KEYS.includes(k)) {
      if (!(v.startsWith('[') && v.endsWith(']'))) { errs.push(name + ':' + ln + ': ' + k + ' 는 [..] 목록이어야 합니다'); o[k] = []; return; }
      o[k] = splitList(v.slice(1, -1));
    } else o[k] = v;
  });
  for (const k of KEYS) if (!(k in o)) errs.push(name + ':1: 머리말에 키 "' + k + '" 가 없습니다(목록이면 [] 로 적는다)');
  o._line = lineOf;
  return o;
}

function validate(o, name, L, errs) {
  const at = (k, msg) => errs.push(name + ':' + ((o._line && o._line[k]) || 1) + ': ' + msg);
  if (o.screen && !L.screens.includes(o.screen)) at('screen', 'screen "' + o.screen + '" 은 LEGEND 5절 화면 이름이 아닙니다');
  if (o.file && !fs.existsSync(path.join(ROOT, o.file))) at('file', 'file "' + o.file + '" 이 존재하지 않습니다');
  else if (o.file && SCREEN_FILES[o.screen] && SCREEN_FILES[o.screen] !== o.file) at('file', 'file "' + o.file + '" 이 화면 "' + o.screen + '" 의 대표 html(' + SCREEN_FILES[o.screen] + ')과 다릅니다')
  if (o.last_checked && !/^[0-9a-f]{7,40}$/.test(o.last_checked)) at('last_checked', 'last_checked 는 커밋 해시(7~40자리 16진수)여야 합니다: ' + o.last_checked);
  for (const e of o.engines || []) if (!L.engines.includes(e)) at('engines', '엔진 이름 "' + e + '" 이 LEGEND 3절 목록에 없습니다(목록에 먼저 추가)');
  for (const x of o.externals || []) if (!L.externals.includes(x)) at('externals', '외부 서비스 이름 "' + x + '" 이 LEGEND 4절 목록에 없습니다');
  for (const c of o.calls || []) { const m = c.match(/^([A-Z]+) (\/\S*)$/); if (!m || !METHODS.includes(m[1])) at('calls', '알 수 없는 호출 표기 "' + c + '" (형식: METHOD /경로, METHOD ∈ ' + METHODS.join('·') + ')'); }
  for (const k of ['reads', 'writes']) for (const s of o[k] || []) {
    const i = s.indexOf(':'), p = i < 0 ? '' : s.slice(0, i), n = i < 0 ? '' : s.slice(i + 1).trim();
    if (!STORE_PREFIX.includes(p) || !/^[A-Za-z0-9_.-]+$/.test(n)) at(k, '알 수 없는 저장소 표기 "' + s + '" (형식: DB:이름 · 캐시:이름 · 기기:키)');
  }
  for (const f of o.fallback || []) {
    const parts = f.split(' ⇢ ');
    if (parts.length !== 2 || !parts.every(p => L.engines.includes(p.trim()))) at('fallback', '알 수 없는 대체 표기 "' + f + '" (형식: "엔진A ⇢ 엔진B", 둘 다 LEGEND 엔진 이름)');
  }
  for (const r of o.requires || []) if (!(r === '로그인' || r === '관리자' || /^권한:[A-Za-z0-9_]+$/.test(r))) at('requires', '알 수 없는 필요 표기 "' + r + '" (로그인 · 관리자 · 권한:이름)');
  for (const n of o.navigates || []) if (!L.screens.includes(n)) at('navigates', '이동 대상 "' + n + '" 은 LEGEND 5절 화면 이름이 아닙니다');
  for (const mod of o.modules || []) if (!fs.existsSync(path.join(ROOT, mod))) at('modules', '모듈 경로 "' + mod + '" 이 존재하지 않습니다');
}

function loadScreens(L, errs) {
  if (!fs.existsSync(SCREENS)) return [];
  const out = [];
  for (const f of fs.readdirSync(SCREENS).filter(x => x.endsWith('.md')).sort(byCode)) {
    const name = 'docs/blueprint/screens/' + f;
    const o = parseFront(fs.readFileSync(path.join(SCREENS, f), 'utf8'), name, errs);
    if (!o) continue;
    validate(o, name, L, errs);
    o.id = f.replace(/\.md$/, ''); o.path = name;
    for (const k of LIST_KEYS) o[k] = o[k] || [];
    out.push(o);
  }
  const seen = new Map();
  for (const s of out) { if (seen.has(s.screen)) errs.push(s.path + ':' + (s._line.screen || 1) + ': 화면 이름 "' + s.screen + '" 이 ' + seen.get(s.screen) + ' 와 중복됩니다'); else seen.set(s.screen, s.path); }
  return out;
}

// 화면 이름(LEGEND 5절) → 대표 html. public 의 html 이 여기에 없으면(새 화면) 오류로 알린다. 화면 파일의 file 이 이 값과 같아야 한다
const SCREEN_FILES = {
  '홈': 'public/home/index.html', '사전': 'public/english_dictionary.html', '스펠링 런': 'public/spelling_run.html', '문장 학습': 'public/jgrammar.html',
  '음성 학습': 'public/voice_study.html', '개념 지도': 'public/concept_map.html', 'Speak Loop': 'public/speakloop.html', '문학 나침반': 'public/literature_compass.html',
  '한입 독서': 'public/digest_reading.html', '과학': 'public/science_reading.html', '작가 노트': 'public/artist_notes.html', '관리자': 'public/admin.html',
};
function publicPages(L, errs) {
  for (const n of L.screens) if (!SCREEN_FILES[n]) errs.push('scripts/blueprint_gen.js: LEGEND 화면 이름 "' + n + '" 의 파일이 SCREEN_FILES 에 없습니다');
  for (const n of Object.keys(SCREEN_FILES)) if (!L.screens.includes(n)) errs.push('scripts/blueprint_gen.js: SCREEN_FILES 의 "' + n + '" 이 LEGEND 5절 화면 이름에 없습니다');
  const pub = path.join(ROOT, 'public');
  const files = fs.readdirSync(pub).filter(f => f.endsWith('.html')).map(f => 'public/' + f);
  if (fs.existsSync(path.join(pub, 'home', 'index.html'))) files.push('public/home/index.html');
  const known = new Set(Object.values(SCREEN_FILES));
  for (const f of files) if (!known.has(f)) errs.push(f + ': public 의 새 화면입니다. LEGEND 5절 화면 이름과 SCREEN_FILES 에 추가하세요');
  return L.screens.map(name => ({ file: SCREEN_FILES[name], title: name }));
}

// ── README 생성 구간 ────────────────────────────────────────────────────────
function usage(screens, pick) {   // pick(s) → 항목 배열 → Map(항목 → 화면 이름 배열), 항목 정렬
  const m = new Map();
  for (const s of screens) for (const it of pick(s)) { if (!m.has(it)) m.set(it, new Set()); m.get(it).add(s.screen); }
  return [...m.entries()].sort((a, b) => byCode(a[0], b[0])).map(([k, v]) => [k, [...v].sort(byCode)]);
}
const storeName = x => x.slice(x.indexOf(':') + 1);

function genSection(screens, pages) {
  const written = new Set(screens.map(s => s.file));
  const todo = pages.filter(p => !written.has(p.file));
  const L = [];
  L.push('> 이 구간은 `npm run blueprint:gen` 이 화면 파일(docs/blueprint/screens)의 머리말에서 만든다. 손으로 고치지 않는다.');
  L.push('> **도면이 작성된 화면(' + screens.length + '개)만 반영한다.** 미작성 화면이 같은 엔진·API·저장소를 쓰는지는 이 목록에 나오지 않으므로 코드로 직접 확인한다.');
  L.push('');
  const list = (title, rows, fmt) => { L.push('### ' + title); if (!rows.length) L.push('- (없음)'); for (const r of rows) L.push('- ' + fmt(r)); L.push(''); };
  list('엔진별 사용 화면 (→호출)', usage(screens, s => s.engines), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  list('대체 경로 (⇢대체: 앞이 실패하면 뒤를 쓴다)', usage(screens, s => s.fallback), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  list('API별 사용 화면 (→호출)', usage(screens, s => s.calls), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  const stores = new Map();   // "DB:x" / "캐시:x" → { r:Set, w:Set }
  for (const s of screens) for (const [k, key] of [['reads', 'r'], ['writes', 'w']]) for (const it of s[k]) {
    if (it.startsWith('기기:')) continue;
    if (!stores.has(it)) stores.set(it, { r: new Set(), w: new Set() });
    stores.get(it)[key].add(s.screen);
  }
  list('저장소별 사용 화면 ([DB]·[캐시], →읽기 / →쓰기)', [...stores.entries()].sort((a, b) => byCode(a[0], b[0])), ([k, v]) => '**[' + k.split(':')[0] + '] ' + storeName(k) + '** — 읽기: ' + ([...v.r].sort(byCode).join(', ') || '-') + ' / 쓰기: ' + ([...v.w].sort(byCode).join(', ') || '-'));
  const dev = new Map();
  for (const s of screens) for (const [k, key] of [['reads', 'r'], ['writes', 'w']]) for (const it of s[k]) {
    if (!it.startsWith('기기:')) continue;
    if (!dev.has(it)) dev.set(it, { r: new Set(), w: new Set() });
    dev.get(it)[key].add(s.screen);
  }
  list('기기 저장값별 사용 화면 ([기기] localStorage·sessionStorage 키, 두 화면 이상이 쓰는 키는 공유 키)', [...dev.entries()].sort((a, b) => byCode(a[0], b[0])), ([k, v]) => '**' + storeName(k) + '** — 읽기: ' + ([...v.r].sort(byCode).join(', ') || '-') + ' / 쓰기: ' + ([...v.w].sort(byCode).join(', ') || '-'));
  list('외부 서비스별 사용 화면 ([외부])', usage(screens, s => s.externals), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  list('모듈별 사용 화면 ([모듈])', usage(screens, s => s.modules), ([k, v]) => '**' + k + '** — ' + v.join(', '));
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

// ── _bundle.md ──────────────────────────────────────────────────────────────
function writeBundle(screens) {
  const files = [README, LEGEND].concat(fs.readdirSync(SCREENS).filter(f => f.endsWith('.md')).sort(byCode).map(f => path.join(SCREENS, f)));
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  const out = [];
  out.push('# METIS-3 도면 묶음 (_bundle.md)');
  out.push('');
  out.push('이 파일은 `npm run blueprint:gen` 이 만든다(직접 고치지 않는다). 용도: 이 한 파일을 웹 Claude 에 첨부해 프로젝트 문서로 복사한다.');
  out.push('순서: README → LEGEND → screens(파일 이름 순). 기준 커밋(화면 파일의 last_checked): ' + (hashes.join(', ') || '(없음)'));
  out.push('화면 파일 ' + screens.length + '개.');
  for (const f of files) {
    out.push('');
    out.push('=====================================================================');
    out.push('### 파일: ' + rel(f));
    out.push('=====================================================================');
    out.push('');
    out.push(lf(fs.readFileSync(f, 'utf8')).replace(/\s+$/, ''));
  }
  out.push('');
  const text = out.join('\n');
  if (!fs.existsSync(BUNDLE) || fs.readFileSync(BUNDLE, 'utf8') !== text) fs.writeFileSync(BUNDLE, text);
  return Buffer.byteLength(text, 'utf8');
}

// ── map.html ────────────────────────────────────────────────────────────────
function mapData(screens, pages) {
  const written = new Set(screens.map(s => s.file));
  const nodes = [], edges = [];
  const has = id => nodes.some(n => n.id === id);
  const add = (id, type, label, extra) => { if (!has(id)) nodes.push(Object.assign({ id, type, label }, extra || {})); };
  const edge = (a, b, relKind) => { if (!edges.some(e => e[0] === a && e[1] === b && e[2] === relKind)) edges.push([a, b, relKind]); };
  for (const s of screens) add('s:' + s.screen, 'screen', s.screen, {
    file: s.file, calls: s.calls, requires: s.requires, fallback: s.fallback,
    devReads: s.reads.filter(x => x.startsWith('기기:')).map(storeName), devWrites: s.writes.filter(x => x.startsWith('기기:')).map(storeName),
  });
  for (const p of pages) if (!written.has(p.file)) add('s:todo:' + p.file, 'todo', p.title, { file: p.file });
  for (const s of screens) {
    const me = 's:' + s.screen;
    for (const e of s.engines) { add('e:' + e, 'engine', e); edge(me, 'e:' + e, 'call'); }
    for (const x of s.externals) { add('x:' + x, 'external', x); edge(me, 'x:' + x, 'call'); }
    for (const m of s.modules) { add('m:' + m, 'module', m); edge(me, 'm:' + m, 'call'); }
    for (const [k, relKind] of [['reads', 'read'], ['writes', 'write']]) for (const it of s[k]) {
      const [p, n] = [it.slice(0, it.indexOf(':')), storeName(it)];
      if (p === '기기') continue;
      add((p === 'DB' ? 'd:' : 'c:') + n, p === 'DB' ? 'db' : 'cache', n);
      edge(me, (p === 'DB' ? 'd:' : 'c:') + n, relKind);
    }
    for (const t of s.navigates) { const tgt = nodes.find(n => n.type === 'screen' && n.label === t); if (tgt) edge(me, tgt.id, 'move'); else { const todo = pages.find(p => p.title === t); if (todo) edge(me, 's:todo:' + todo.file, 'move'); } }
    for (const f of s.fallback) { const [a, b] = f.split(' ⇢ ').map(x => x.trim()); add('e:' + a, 'engine', a); add('e:' + b, 'engine', b); edge('e:' + a, 'e:' + b, 'fallback'); }
  }
  // 화면 이름으로 이동 대상 연결(LEGEND 화면 이름과 미작성 화면 제목이 달라도 연결되도록, 홈은 public/home/index.html)
  const order = { screen: 0, todo: 1, engine: 2, module: 3, db: 4, cache: 5, external: 6 };
  nodes.sort((a, b) => order[a.type] - order[b.type] || byCode(a.label, b.label));
  edges.sort((a, b) => byCode(a.join('>'), b.join('>')));
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  return { nodes, edges, commit: hashes.join(', ') };
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
:root { --bg:#fafaf9; --card:#ffffff; --text:#1a1a1a; --sub:#555b66; --line:#c9c9c2; --sel:#b8442e; --selbg:#fdf0ec; --rel:#2f7d57; --relbg:#eaf4ee; --c-screen:#2b5d9b; --c-engine:#7a3fa0; --c-store:#9a6b00; --c-external:#555b66; --c-module:#2f7d57; }
@media (prefers-color-scheme: dark) { :root { --bg:#17181a; --card:#212326; --text:#f1f1ee; --sub:#a9adb5; --line:#43464b; --sel:#ff8c73; --selbg:#3a2520; --rel:#5fc08e; --relbg:#1d3327; --c-screen:#7fb0ee; --c-engine:#c79af0; --c-store:#e0b050; --c-external:#a9adb5; --c-module:#6fcf9b; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px 0; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; }
.hint { font-size: 14px; color: var(--sub); margin: 0 0 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 16px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font-size: 14px; }
.legend .lg { display: inline-flex; align-items: center; gap: 8px; }
.legend .rels { flex-basis: 100%; color: var(--sub); }
.wrap { max-width: 1280px; margin: 0 auto; padding: 0 16px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; }
@media (min-width: 720px) {
  .layout { grid-template-columns: minmax(0, 65fr) minmax(0, 35fr); gap: 24px; align-items: start; }
  #detail { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow: auto; }
}
.col h2 { font-size: 14px; margin: 0 0 8px; color: var(--sub); font-weight: 700; }
.col .group { font-size: 14px; color: var(--sub); margin: 12px 0 4px; }
.item, .sample { --bc: var(--kc, var(--line)); --bg2: var(--card); position: relative; display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 10px 14px; min-height: 44px; border: 1.5px solid var(--bc); background: var(--bg2); color: var(--text); font: inherit; font-size: 16px; overflow-wrap: anywhere; }
.item { cursor: pointer; }
.item small { display: block; font-size: 14px; color: var(--sub); }
.t-screen { --kc: var(--c-screen); border-radius: 12px; }
.t-todo { --kc: var(--line); border-radius: 12px; border-style: dashed; color: var(--sub); background: transparent; --bg2: transparent; }
.t-external { --kc: var(--c-external); border-radius: 4px; border-style: dashed; }
.t-module { --kc: var(--c-module); border-radius: 0; }
.t-db, .t-cache { --kc: var(--c-store); border-radius: 14px / 10px; padding-top: 16px; width: fit-content; min-width: 150px; max-width: 100%; }
.t-db::before, .t-cache::before { content: ""; position: absolute; left: -1.5px; right: -1.5px; top: 0; height: 14px; border: 1.5px solid var(--bc); border-radius: 50%; background: var(--bg2); }
.t-cache::before { border-style: dashed; }
.t-engine { --kc: var(--c-engine); border: 0; background: var(--bc); padding: 10px 30px; width: fit-content; min-width: 170px; max-width: 100%; clip-path: polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%); }
.t-engine::before { content: ""; position: absolute; inset: 2px; background: var(--bg2); clip-path: polygon(15px 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 15px 100%, 0 50%); }
.item > .lbl, .sample > .lbl { position: relative; }
.sample { display: inline-block; width: auto; margin: 0; padding: 4px 14px; min-height: 0; font-size: 14px; }
.sample.t-db, .sample.t-cache { padding-top: 14px; }
.sample.t-engine { padding: 4px 22px; }
.item.sel { --bc: var(--sel); --bg2: var(--selbg); }
.item.rel { --bc: var(--rel); --bg2: var(--relbg); }
.dim .item:not(.sel):not(.rel) { opacity: .62; }   /* 강조 해제 항목: 글자 대비 약 4.5:1 이상 유지(라이트·다크), 강조(sel·rel)는 테두리·배경으로 구분 */
#detail { padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font-size: 15px; overflow-wrap: anywhere; }
#detail .head { font-weight: 700; margin-bottom: 6px; }
#detail .rel-row { margin: 6px 0; }
#detail .rk { display: inline-block; min-width: 4.5em; font-weight: 700; color: var(--sel); }
#detail ul { margin: 2px 0 0; padding-left: 20px; }
.foot { margin-top: 12px; font-size: 14px; color: var(--sub); }
</style>
</head>
<body>
<div class="wrap">
<h1>METIS-3 도면</h1>
<p class="hint">항목을 누르면 연결된 항목이 강조되고 나머지는 흐려집니다. 같은 항목을 다시 누르면 해제됩니다. 기기 저장값·API는 상세 상자(넓은 화면은 오른쪽, 좁은 화면은 목록 아래)에 나옵니다.</p>
<div class="legend" aria-label="범례">
  <span class="lg"><span class="sample t-screen"><span class="lbl">화면</span></span></span>
  <span class="lg"><span class="sample t-engine"><span class="lbl">엔진</span></span></span>
  <span class="lg"><span class="sample t-db"><span class="lbl">DB</span></span></span>
  <span class="lg"><span class="sample t-cache"><span class="lbl">캐시</span></span></span>
  <span class="lg"><span class="sample t-external"><span class="lbl">외부</span></span></span>
  <span class="lg"><span class="sample t-module"><span class="lbl">모듈</span></span></span>
  <span class="lg"><span class="sample t-todo"><span class="lbl">미작성</span></span></span>
  <span class="rels">관계: →호출 · →읽기 · →쓰기 · →이동(화면→화면) · ⇢대체(앞이 실패하면 뒤) · →필요(로그인·권한). 모양: 화면=둥근 사각, 엔진=육각형, DB=원통, 캐시=점선 윗면 원통, 외부=점선 사각, 모듈=직각 사각, 미작성=회색 점선.</span>
</div>
<div class="layout">
  <div class="lists" id="grid">
    <div class="col" id="col-1"><h2>화면</h2></div>
    <div class="col" id="col-2"><h2>엔진 · 모듈</h2></div>
    <div class="col" id="col-3"><h2>저장소 · 외부</h2></div>
  </div>
  <aside id="detail" aria-live="polite">항목을 누르면 연결이 여기에 표시됩니다.</aside>
</div>
<p class="foot">이 파일은 <code>npm run blueprint:gen</code> 이 docs/blueprint/screens 의 머리말에서 만든다(직접 고치지 않는다). 화면 파일 마지막 확인 커밋: <span id="commit"></span></p>
</div>
<script id="data" type="application/json">${json}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var nodes = data.nodes, byId = {}, edges = data.edges;
  nodes.forEach(function (n) { byId[n.id] = n; });
  document.getElementById('commit').textContent = data.commit || '(없음)';
  var colOf = { screen: 1, todo: 1, engine: 2, module: 2, db: 3, cache: 3, external: 3 };
  var groupName = { screen: '', todo: '도면 미작성 화면', engine: '엔진', module: '모듈', db: 'DB 테이블', cache: '서버 캐시', external: '외부 서비스' };
  var cols = { 1: document.getElementById('col-1'), 2: document.getElementById('col-2'), 3: document.getElementById('col-3') };
  var lastGroup = {};
  nodes.forEach(function (n) {
    var c = colOf[n.type];
    if (groupName[n.type] && lastGroup[c] !== n.type) { var g = document.createElement('div'); g.className = 'group'; g.textContent = groupName[n.type]; cols[c].appendChild(g); }
    lastGroup[c] = n.type;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'item t-' + n.type; b.setAttribute('aria-pressed', 'false'); b.dataset.id = n.id;
    var l = document.createElement('span'); l.className = 'lbl'; l.textContent = n.label; b.appendChild(l);
    b.addEventListener('click', function () { select(selected === n.id ? null : n.id); });
    n.el = b; cols[c].appendChild(b);
  });
  var EMPTY_MSG = '항목을 누르면 연결이 여기에 표시됩니다.';
  var selected = null, grid = document.getElementById('grid'), detail = document.getElementById('detail');
  function nameOf(id) { return byId[id].label; }
  function row(kind, items) {
    if (!items || !items.length) return;
    var d = document.createElement('div'); d.className = 'rel-row';
    var k = document.createElement('span'); k.className = 'rk'; k.textContent = kind; d.appendChild(k);
    var ul = document.createElement('ul'); items.forEach(function (x) { var li = document.createElement('li'); li.textContent = x; ul.appendChild(li); }); d.appendChild(ul);
    detail.appendChild(d);
  }
  function out(id, rel) { return edges.filter(function (e) { return e[0] === id && e[2] === rel; }).map(function (e) { return e[1]; }); }
  function inn(id, rel) { return edges.filter(function (e) { return e[1] === id && e[2] === rel; }).map(function (e) { return e[0]; }); }
  function typed(ids, t) { return ids.filter(function (i) { return t.indexOf(byId[i].type) >= 0; }).map(nameOf); }
  function select(id) {
    selected = id;
    nodes.forEach(function (n) { n.el.classList.remove('sel', 'rel'); n.el.setAttribute('aria-pressed', 'false'); });
    detail.textContent = '';
    if (!id) { grid.classList.remove('dim'); detail.textContent = EMPTY_MSG; return; }
    var n = byId[id]; grid.classList.add('dim');
    n.el.classList.add('sel'); n.el.setAttribute('aria-pressed', 'true');
    edges.forEach(function (e) { if (e[0] === id) byId[e[1]].el.classList.add('rel'); if (e[1] === id) byId[e[0]].el.classList.add('rel'); });
    var h = document.createElement('div'); h.className = 'head'; h.textContent = n.label + (n.file ? '  (' + n.file + ')' : ''); detail.appendChild(h);
    if (n.type === 'todo') { var p = document.createElement('div'); p.textContent = '이 화면은 도면이 아직 없습니다(연결 정보 없음). →이동해 오는 화면: ' + (inn(id, 'move').map(nameOf).join(', ') || '(없음)'); detail.appendChild(p); return; }
    if (n.type === 'screen') {
      row('→필요', n.requires); row('→호출 API', n.calls);
      row('→호출 엔진', typed(out(id, 'call'), ['engine'])); row('→호출 외부', typed(out(id, 'call'), ['external'])); row('→호출 모듈', typed(out(id, 'call'), ['module']));
      row('→읽기 저장소', typed(out(id, 'read'), ['db', 'cache'])); row('→쓰기 저장소', typed(out(id, 'write'), ['db', 'cache']));
      row('→읽기 기기', n.devReads); row('→쓰기 기기', n.devWrites);
      row('⇢대체', n.fallback); row('→이동', out(id, 'move').map(nameOf));
    } else if (n.type === 'engine') {
      row('→호출하는 화면', inn(id, 'call').map(nameOf));
      row('⇢대체(이 엔진이 실패하면)', out(id, 'fallback').map(nameOf)); row('⇢대체(이 엔진으로 대신함)', inn(id, 'fallback').map(nameOf));
    } else if (n.type === 'db' || n.type === 'cache') {
      row('→읽는 화면', inn(id, 'read').map(nameOf)); row('→쓰는 화면', inn(id, 'write').map(nameOf));
    } else row('→호출하는 화면', inn(id, 'call').map(nameOf));
    var note = document.createElement('div'); note.className = 'foot'; note.textContent = '도면이 있는 화면만 표시됩니다(미작성 화면은 코드로 확인).'; detail.appendChild(note);
  }
})();
</script>
</body>
</html>
`;
}

function main() {
  const errs = [];
  const L = loadLegend();
  const screens = loadScreens(L, errs);
  if (errs.length) { console.error('blueprint:gen 검증 오류 ' + errs.length + '건 — 파일을 쓰지 않고 멈춥니다\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
  const pages = publicPages(L, errs);
  if (errs.length) { console.error('blueprint:gen 검증 오류 ' + errs.length + '건 — 파일을 쓰지 않고 멈춥니다\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
  writeReadme(genSection(screens, pages));
  fs.writeFileSync(MAP, mapHtml(mapData(screens, pages)));
  const size = writeBundle(screens);
  console.log('blueprint:gen 완료 — 화면 파일 ' + screens.length + '개, 미작성 ' + pages.filter(p => !screens.some(s => s.file === p.file)).length + '개, _bundle.md ' + size + ' bytes');
}
main();
