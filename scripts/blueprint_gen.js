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
const DBDOC = path.join(DIR, 'db.md');
const APIDOC = path.join(DIR, 'api.md');
const DBJS = path.join(ROOT, 'lib', 'db.js');

const KEYS = ['screen', 'file', 'engines', 'calls', 'reads', 'writes', 'fallback', 'flows', 'requires', 'navigates', 'externals', 'modules', 'last_checked'];
const LIST_KEYS = ['engines', 'calls', 'reads', 'writes', 'fallback', 'flows', 'requires', 'navigates', 'externals', 'modules'];
const STORE_PREFIX = ['DB', '캐시', '기기', '파일'];   // 작업B-004: 파일 = LEGEND 9절 고정 목록의 데이터 파일(DB 가 아님)
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const WARNS = [];   // 흐름 경고(오류 아님): flowOnly(흐름에만 있는 대상) · headerOnly(머리말에만 있고 어떤 흐름에도 안 나오는 대상)
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
  const files = new Map();   // 작업B-004: 9절 "| 이름 | 경로 | …" 표 → 이름 → { path, line }
  const all = text.split('\n'); const h9 = all.findIndex(l => /^## 9 /.test(l));
  if (h9 < 0) throw new Error('LEGEND.md 에 "## 9" 절(파일 이름 고정 목록)이 없습니다');
  for (let i = h9 + 1; i < all.length && !/^## \d/.test(all[i]); i++) { const m = all[i].match(/^\| ([a-z][a-z0-9_]*) \| ([^|]+?) \|/); if (m) files.set(m[1], { path: m[2].trim(), line: i + 1 }); }
  if (!files.size) throw new Error('LEGEND.md 9절의 파일 이름 목록이 비었습니다');
  return { engines, externals, screens, files };
}

// ── 화면 파일 머리말 읽기·검증 ──────────────────────────────────────────────
function parseFront(text, name, errs) {
  const src = lf(text);
  const m = src.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) { errs.push(name + ':1: 머리말(--- 사이)이 없습니다'); return null; }
  const o = {}, lineOf = {}, items = {};
  const lines = m[1].split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx], ln = idx + 2;
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) { errs.push(name + ':' + ln + ': 머리말 줄 형식 오류(키: 값): ' + line); continue; }
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (!KEYS.includes(k)) { errs.push(name + ':' + ln + ': 표준에 없는 키 "' + k + '" (표준 키: ' + KEYS.join(', ') + ')'); continue; }
    if (k in o) { errs.push(name + ':' + ln + ': 키 "' + k + '" 가 두 번 나옵니다'); continue; }
    lineOf[k] = ln;
    if (!LIST_KEYS.includes(k)) { o[k] = v; continue; }
    if (v === '[') {   // 여러 줄 목록: 다음 줄부터 "]" 만 있는 줄까지, 한 줄이 항목 하나(줄 끝 쉼표는 뗀다)
      const arr = []; items[k] = [];
      let closed = false;
      for (idx++; idx < lines.length; idx++) {
        const t = lines[idx].trim();
        if (t === ']') { closed = true; break; }
        if (!t) continue;
        const text1 = t.replace(/,$/, '').trim();
        arr.push(text1); items[k].push({ text: text1, line: idx + 2 });
      }
      if (!closed) errs.push(name + ':' + ln + ': ' + k + ' 목록이 "]" 로 닫히지 않았습니다');
      o[k] = arr;
    } else if (v.startsWith('[') && v.endsWith(']')) {
      const arr = splitList(v.slice(1, -1));
      o[k] = arr; items[k] = arr.map(text1 => ({ text: text1, line: ln }));
    } else { errs.push(name + ':' + ln + ': ' + k + ' 는 [..] 목록이어야 합니다'); o[k] = []; }
  }
  for (const k of KEYS) if (!(k in o)) errs.push(name + ':1: 머리말에 키 "' + k + '" 가 없습니다(목록이면 [] 로 적는다)');
  o._line = lineOf; o._items = items;
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
    if (!STORE_PREFIX.includes(p) || !/^[A-Za-z0-9_.-]+$/.test(n)) at(k, '알 수 없는 저장소 표기 "' + s + '" (형식: DB:이름 · 캐시:이름 · 기기:키 · 파일:이름)');
    else if (p === '파일') {   // 작업B-004: LEGEND 9절 목록의 이름이어야 하고 경로가 존재해야 한다
      const fe = L.files.get(n);
      if (!fe) at(k, '파일 이름 "' + n + '" 이 LEGEND 9절 파일 목록에 없습니다(목록에 먼저 추가)');
      else if (!fs.existsSync(path.join(ROOT, fe.path))) at(k, '파일 "' + n + '" 의 경로 "' + fe.path + '" 가 존재하지 않습니다(LEGEND.md:' + fe.line + ')');
    }
  }
  for (const f of o.fallback || []) {
    const parts = f.split(' ⇢ ');
    if (parts.length !== 2 || !parts.every(p => L.engines.includes(p.trim()))) at('fallback', '알 수 없는 대체 표기 "' + f + '" (형식: "엔진A ⇢ 엔진B", 둘 다 LEGEND 엔진 이름)');
  }
  for (const r of o.requires || []) if (!(r === '로그인' || r === '관리자' || /^권한:[A-Za-z0-9_]+$/.test(r))) at('requires', '알 수 없는 필요 표기 "' + r + '" (로그인 · 관리자 · 권한:이름)');
  for (const n of o.navigates || []) if (!L.screens.includes(n)) at('navigates', '이동 대상 "' + n + '" 은 LEGEND 5절 화면 이름이 아닙니다');
  for (const mod of o.modules || []) if (!fs.existsSync(path.join(ROOT, mod))) at('modules', '모듈 경로 "' + mod + '" 이 존재하지 않습니다');
}

// ── 동작별 흐름(flows) 분석·검증 ────────────────────────────────────────────
// 한 항목 = "동작 이름 | 관계 대상 ; 관계 대상 ; …". 관계는 6종뿐. ⇢대체 는 앞 단계(엔진 →호출)가 실패하면 쓰는 경로로 같은 번호의 가지가 된다.
const REL = { '→호출': 'call', '→읽기': 'read', '→쓰기': 'write', '→이동': 'move', '⇢대체': 'fallback', '→필요': 'need' };
const REL_RE = /^(→호출|→읽기|→쓰기|→이동|⇢대체|→필요) (.+)$/;
const storeParts = it => { const i = it.indexOf(':'); return { raw: it, prefix: it.slice(0, i), name: it.slice(i + 1) }; };
function findStore(list, target) {
  const items = list.map(storeParts);
  const exact = items.filter(s => s.raw === target);
  if (exact.length) return { item: exact[0] };
  const byName = items.filter(s => s.name === target);
  if (byName.length === 1) return { item: byName[0] };
  return byName.length > 1 ? { ambiguous: true } : {};
}

function analyzeFlows(o, L) {
  const res = { flows: [], errs: [], warns: [], used: { calls: new Set(), engines: new Set(), externals: new Set(), modules: new Set(), reads: new Set(), writes: new Set(), navigates: new Set() } };
  const err = (line, msg) => res.errs.push({ line, msg });
  const seen = new Set();
  for (const { text, line } of (o._items && o._items.flows) || []) {
    const bar = text.indexOf(' | ');
    if (bar < 0) { err(line, '동작 형식 오류: "동작이름 | 관계 대상 ; 관계 대상" 이어야 합니다: ' + text.slice(0, 40)); continue; }
    const name = text.slice(0, bar).trim();
    if (!name) { err(line, '동작 이름이 비었습니다'); continue; }
    if (seen.has(name)) { err(line, '동작 이름 "' + name + '" 이 중복됩니다'); continue; }
    seen.add(name);
    const stepTexts = text.slice(bar + 3).split(' ; ').map(x => x.trim()).filter(Boolean);
    if (!stepTexts.length) { err(line, '동작 "' + name + '" 에 단계가 없습니다(1개 이상)'); continue; }
    const groups = [];   // 번호 하나 = 한 그룹(⇢대체 는 앞 그룹에 가지로 들어간다)
    let ok = true;
    for (const st of stepTexts) {
      const m = st.match(REL_RE);
      if (!m) { err(line, '동작 "' + name + '": 알 수 없는 관계 표기 "' + st + '" (→호출 · →읽기 · →쓰기 · →이동 · ⇢대체 · →필요)'); ok = false; continue; }
      const rel = REL[m[1]], target = m[2].trim();
      let step = null;
      if (rel === 'call') {
        if (o.calls.includes(target)) { step = { type: 'api', label: target }; res.used.calls.add(target); }
        else if (L.engines.includes(target)) {
          step = { type: 'engine', label: target }; res.used.engines.add(target);
          if (!o.engines.includes(target)) res.warns.push({ kind: 'flowOnly', text: '엔진 "' + target + '" (머리말 engines 에 없음)', line });
        } else if (o.externals.includes(target)) { step = { type: 'external', label: target }; res.used.externals.add(target); }
        else if (o.modules.includes(target)) { step = { type: 'module', label: target }; res.used.modules.add(target); }
        else err(line, '동작 "' + name + '": →호출 대상 "' + target + '" 이 머리말 calls·externals·modules 와 LEGEND 엔진 목록 어디에도 없습니다');
      } else if (rel === 'read' || rel === 'write') {
        const key = rel === 'read' ? 'reads' : 'writes';
        const f = findStore(o[key], target);
        if (f.item) { step = { type: f.item.prefix === 'DB' ? 'db' : f.item.prefix === '캐시' ? 'cache' : f.item.prefix === '파일' ? 'file' : 'device', label: f.item.name, store: f.item }; res.used[key].add(f.item.raw); }
        else err(line, '동작 "' + name + '": ' + m[1] + ' 대상 "' + target + '" ' + (f.ambiguous ? '이 모호합니다(접두어 DB:·캐시:·기기: 를 붙이세요)' : '이 머리말 ' + key + ' 에 없습니다'));
      } else if (rel === 'move') {
        if (o.navigates.includes(target)) { step = { type: 'screen', label: target }; res.used.navigates.add(target); }
        else err(line, '동작 "' + name + '": →이동 대상 "' + target + '" 이 머리말 navigates 에 없습니다');
      } else if (rel === 'need') {
        if (o.requires.includes(target)) step = { type: 'need', label: target };
        else err(line, '동작 "' + name + '": →필요 대상 "' + target + '" 이 머리말 requires 에 없습니다');
      } else if (rel === 'fallback') {
        const prev = groups.length ? groups[groups.length - 1][groups[groups.length - 1].length - 1] : null;
        if (!L.engines.includes(target)) err(line, '동작 "' + name + '": ⇢대체 대상 "' + target + '" 이 LEGEND 엔진 목록에 없습니다');
        else if (!prev || prev.type !== 'engine') err(line, '동작 "' + name + '": ⇢대체 는 바로 앞 단계가 엔진 →호출 이어야 합니다');
        else if (!o.fallback.includes(prev.label + ' ⇢ ' + target)) err(line, '동작 "' + name + '": "' + prev.label + ' ⇢ ' + target + '" 이 머리말 fallback 에 없습니다');
        else { step = { type: 'engine', label: target }; res.used.engines.add(target); if (!o.engines.includes(target)) res.warns.push({ kind: 'flowOnly', text: '엔진 "' + target + '" (머리말 engines 에 없음)', line }); }
      }
      if (!step) { ok = false; continue; }
      step.rel = rel; step.rl = m[1];
      if (rel === 'fallback') groups[groups.length - 1].push(step); else groups.push([step]);
    }
    if (!ok) continue;
    const flow = { name, steps: [] };
    groups.forEach((g, gi) => g.forEach((st, bi) => { st.n = String(gi + 1) + (g.length > 1 ? 'abcdefgh'[bi] : ''); flow.steps.push(st); }));
    res.flows.push(flow);
  }
  // 머리말에만 있고 어떤 흐름에도 나오지 않는 항목(경고)
  const unused = (group, list, usedSet) => { for (const it of list) if (!usedSet.has(it) && !it.startsWith('파일:')) res.warns.push({ kind: 'headerOnly', group, device: group !== 'calls' && it.startsWith('기기:'), text: group + ' ' + it }); };
  if ((o._items && o._items.flows && o._items.flows.length) || res.flows.length) {
    unused('calls', o.calls, res.used.calls); unused('engines', o.engines, res.used.engines); unused('externals', o.externals, res.used.externals);
    unused('modules', o.modules, res.used.modules); unused('reads', o.reads, res.used.reads); unused('writes', o.writes, res.used.writes); unused('navigates', o.navigates, res.used.navigates);
  }
  return res;
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
    const fl = analyzeFlows(o, L);
    fl.errs.forEach(e => errs.push(name + ':' + e.line + ': ' + e.msg));
    o._flows = fl.flows;
    fl.warns.forEach(w => WARNS.push({ screen: o.screen, path: name, kind: w.kind, group: w.group, device: !!w.device || /^(reads|writes) 기기:/.test(w.text), text: w.text, line: w.line }));
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
  L.push(todo.length
    ? '> **도면이 작성된 화면(' + screens.length + '개)만 반영한다.** 미작성 화면이 같은 엔진·API·저장소를 쓰는지는 이 목록에 나오지 않으므로 코드로 직접 확인한다.'
    : '> 모든 화면(' + screens.length + '개)의 도면이 작성돼 있다. 미작성 화면은 0개다.');
  L.push('');
  const list = (title, rows, fmt) => { L.push('### ' + title); if (!rows.length) L.push('- (없음)'); for (const r of rows) L.push('- ' + fmt(r)); L.push(''); };
  list('엔진별 사용 화면 (→호출)', usage(screens, s => s.engines), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  list('대체 경로 (⇢대체: 앞이 실패하면 뒤를 쓴다)', usage(screens, s => s.fallback), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  list('API별 사용 화면 (→호출)', usage(screens, s => s.calls), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  const stores = new Map();   // "DB:x" / "캐시:x" → { r:Set, w:Set }
  for (const s of screens) for (const [k, key] of [['reads', 'r'], ['writes', 'w']]) for (const it of s[k]) {
    if (it.startsWith('기기:') || it.startsWith('파일:')) continue;
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
  const fl = new Map();
  for (const s of screens) for (const [k, key] of [['reads', 'r'], ['writes', 'w']]) for (const it of s[k]) {
    if (!it.startsWith('파일:')) continue;
    if (!fl.has(it)) fl.set(it, { r: new Set(), w: new Set() });
    fl.get(it)[key].add(s.screen);
  }
  list('파일별 사용 화면 ([파일] LEGEND 9절 고정 목록, →읽기 / →쓰기)', [...fl.entries()].sort((a, b) => byCode(a[0], b[0])), ([k, v]) => '**' + storeName(k) + '** — 읽기: ' + ([...v.r].sort(byCode).join(', ') || '-') + ' / 쓰기: ' + ([...v.w].sort(byCode).join(', ') || '-'));
  list('외부 서비스별 사용 화면 ([외부])', usage(screens, s => s.externals), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  list('모듈별 사용 화면 ([모듈])', usage(screens, s => s.modules), ([k, v]) => '**' + k + '** — ' + v.join(', '));
  L.push('### 미작성 화면 (' + todo.length + '개)');
  L.push(todo.length ? todo.map(p => p.title + '(' + p.file + ')').join(', ') : '(없음)');
  L.push('');
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  L.push('화면 파일의 마지막 확인 커밋: ' + (hashes.length ? hashes.join(', ') : '(없음)'));
  return L.join('\n');
}

function writeReadme(section, file) {
  file = file || README;
  const text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const S = '<!-- gen:start -->', E = '<!-- gen:end -->';
  const a = text.indexOf(S), b = text.indexOf(E);
  if (a < 0 || b < 0 || b < a) throw new Error(rel(file) + ' 에 gen:start / gen:end 표시가 없습니다');
  const next = text.slice(0, a + S.length) + eol + section.split('\n').join(eol) + eol + text.slice(b);
  if (next !== text) fs.writeFileSync(file, next);
}

// ── _bundle.md ──────────────────────────────────────────────────────────────
function writeBundle(screens) {
  const files = [README, LEGEND, DBDOC, APIDOC].concat(fs.readdirSync(SCREENS).filter(f => f.endsWith('.md')).sort(byCode).map(f => path.join(SCREENS, f)));
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  const out = [];
  out.push('# METIS-3 도면 묶음 (_bundle.md)');
  out.push('');
  out.push('이 파일은 `npm run blueprint:gen` 이 만든다(직접 고치지 않는다). 용도: 이 한 파일을 웹 Claude 에 첨부해 프로젝트 문서로 복사한다.');
  out.push('순서: README → LEGEND → db → api → screens(파일 이름 순). 기준 커밋(화면 파일의 last_checked): ' + (hashes.join(', ') || '(없음)'));
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

// ── LEGEND 8절 화면 묶음 ──────────────────────────────────────────────────
// "묶음 이름: 화면, 화면" 줄을 읽는다. 12개 화면이 각각 정확히 한 묶음에 있어야 하며, 어긋나면 LEGEND.md 줄 번호와 함께 오류.
function loadGroups(L, errs) {
  const lines = lf(fs.readFileSync(LEGEND, 'utf8')).split('\n');
  const head = lines.findIndex(l => /^## 8 /.test(l));
  if (head < 0) { errs.push('docs/blueprint/LEGEND.md:1: "## 8 화면 묶음" 절이 없습니다'); return []; }
  const groups = [], seen = new Map();
  for (let i = head + 1; i < lines.length && !/^## \d/.test(lines[i]); i++) {
    const m = lines[i].match(/^([^\s:]+): (.+)$/);
    if (!m) continue;
    const at = 'docs/blueprint/LEGEND.md:' + (i + 1) + ': ';
    const names = m[2].split(',').map(s => s.trim()).filter(Boolean);
    groups.push({ name: m[1], screens: names });
    for (const n of names) {
      if (!L.screens.includes(n)) errs.push(at + '묶음 "' + m[1] + '" 의 "' + n + '" 은 LEGEND 5절 화면 이름이 아닙니다');
      else if (seen.has(n)) errs.push(at + '화면 "' + n + '" 이 묶음 "' + seen.get(n).g + '"(' + seen.get(n).line + '줄)와 "' + m[1] + '" 에 중복됩니다');
      else seen.set(n, { g: m[1], line: i + 1 });
    }
  }
  for (const n of L.screens) if (!seen.has(n)) errs.push('docs/blueprint/LEGEND.md:' + (head + 1) + ': 화면 "' + n + '" 이 어느 묶음에도 없습니다');
  return groups;
}

// ── db.md 대조·생성 구간 ───────────────────────────────────────────────
// db.md 의 항목 줄("| DB:이름 |" 또는 "| 캐시:이름 |")과 lib/db.js 의 CREATE TABLE 을 서로 대조하고, 화면 머리말의 DB:·캐시: 이름이 db.md 에 있는지 본다. 어긋나면 파일:줄과 함께 오류.
function loadDbDoc(screens, errs) {
  const items = new Map();   // 'DB:users' → { line, kind, name }
  lf(fs.readFileSync(DBDOC, 'utf8')).split('\n').forEach((ln, i) => {
    const m = ln.match(/^\| (DB|캐시):([A-Za-z0-9_]+) \|/);
    if (!m) return;
    const key = m[1] + ':' + m[2];
    if (items.has(key)) errs.push('docs/blueprint/db.md:' + (i + 1) + ': 항목 "' + key + '" 이 ' + items.get(key).line + '줄과 중복됩니다');
    else items.set(key, { line: i + 1, kind: m[1], name: m[2] });
  });
  const tables = new Map();   // 이름 → lib/db.js 줄
  lf(fs.readFileSync(DBJS, 'utf8')).split('\n').forEach((ln, i) => { const m = ln.match(/CREATE TABLE IF NOT EXISTS ([A-Za-z0-9_]+)/); if (m && !tables.has(m[1])) tables.set(m[1], i + 1); });
  const docNames = new Set([...items.values()].map(v => v.name));
  for (const [k, v] of items) if (!tables.has(v.name)) errs.push('docs/blueprint/db.md:' + v.line + ': 항목 "' + k + '" 이 lib/db.js 의 CREATE TABLE 에 없습니다');
  for (const [n, line] of tables) if (!docNames.has(n)) errs.push('lib/db.js:' + line + ': 테이블 "' + n + '" 이 docs/blueprint/db.md 에 없습니다');
  for (const s of screens) for (const k of ['reads', 'writes']) for (const it of s[k]) {
    if (it.startsWith('기기:') || it.startsWith('파일:')) continue;
    if (!items.has(it)) errs.push(s.path + ':' + ((s._line && s._line[k]) || 1) + ': ' + k + ' "' + it + '" 이 docs/blueprint/db.md 에 없습니다(이름과 DB·캐시 구분을 확인)');
  }
  return items;
}
function genDbSection(screens, items) {
  const rows = [], none = [];
  for (const [k, v] of [...items.entries()].sort((a, b) => byCode(a[1].name, b[1].name))) {
    const r = screens.filter(s => s.reads.includes(k)).map(s => s.screen).sort(byCode), w = screens.filter(s => s.writes.includes(k)).map(s => s.screen).sort(byCode);
    if (!r.length && !w.length) none.push(v.name);
    rows.push('- **[' + v.kind + '] ' + v.name + '** — ' + (r.length || w.length ? '읽기: ' + (r.join(', ') || '-') + ' / 쓰기: ' + (w.join(', ') || '-') : '화면 연결 없음'));
  }
  return ['> 화면 파일 ' + screens.length + '개의 머리말(reads·writes)에서 만든다. 항목 ' + items.size + '개, 화면 연결 없음 ' + none.length + '개.', ''].concat(rows).join('\n');
}

// ── map.html ────────────────────────────────────────────────────────────────
function mapData(screens, pages, groups, dbItems) {
  const written = new Set(screens.map(s => s.file));
  const nodes = [], edges = [];
  const has = id => nodes.some(n => n.id === id);
  const add = (id, type, label, extra) => { if (!has(id)) nodes.push(Object.assign({ id, type, label }, extra || {})); };
  const edge = (a, b, relKind) => { if (!edges.some(e => e[0] === a && e[1] === b && e[2] === relKind)) edges.push([a, b, relKind]); };
  for (const s of screens) add('s:' + s.screen, 'screen', s.screen, {
    file: s.file, calls: s.calls, requires: s.requires, fallback: s.fallback, group: (groups.find(g => g.screens.includes(s.screen)) || {}).name || '',
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
      if (p === '기기' || p === '파일') continue;   // 작업B-004: 파일 저장소는 이 보기에 그리지 않는다(이후 작업)
      add((p === 'DB' ? 'd:' : 'c:') + n, p === 'DB' ? 'db' : 'cache', n);
      edge(me, (p === 'DB' ? 'd:' : 'c:') + n, relKind);
    }
    for (const t of s.navigates) { const tgt = nodes.find(n => n.type === 'screen' && n.label === t); if (tgt) edge(me, tgt.id, 'move'); else { const todo = pages.find(p => p.title === t); if (todo) edge(me, 's:todo:' + todo.file, 'move'); } }
    for (const f of s.fallback) { const [a, b] = f.split(' ⇢ ').map(x => x.trim()); add('e:' + a, 'engine', a); add('e:' + b, 'engine', b); edge('e:' + a, 'e:' + b, 'fallback'); }
  }
  for (const [, v] of dbItems) { const id = (v.kind === 'DB' ? 'd:' : 'c:') + v.name; if (!has(id)) add(id, v.kind === 'DB' ? 'db' : 'cache', v.name, { unlinked: true }); }   // db.md 에는 있으나 어느 화면과도 연결되지 않은 저장소
  // 동작별 흐름: 각 단계를 목록의 항목(node)과 연결한다. 목록에 항목이 없는 단계(API·기기 저장값·필요)는 node 없이 칩으로만 보인다
  const nodeFor = (st) => {
    if (st.type === 'engine') return 'e:' + st.label;
    if (st.type === 'external') return 'x:' + st.label;
    if (st.type === 'module') return 'm:' + st.label;
    if (st.type === 'db') return 'd:' + st.label;
    if (st.type === 'cache') return 'c:' + st.label;
    if (st.type === 'screen') { const tgt = nodes.find(n => (n.type === 'screen' || n.type === 'todo') && n.label === st.label); return tgt ? tgt.id : null; }
    return null;
  };
  for (const s of screens) {
    const sn = nodes.find(n => n.id === 's:' + s.screen);
    sn.flows = (s._flows || []).map(f => ({ name: f.name, steps: f.steps.map(st => ({ n: st.n, rel: st.rel, rl: st.rl, type: st.type, label: st.label, node: (nodeFor(st) && has(nodeFor(st))) ? nodeFor(st) : null })) }));
  }
  const order = { screen: 0, todo: 1, engine: 2, module: 3, db: 4, cache: 5, external: 6 };
  nodes.sort((a, b) => order[a.type] - order[b.type] || byCode(a.label, b.label));
  edges.sort((a, b) => byCode(a.join('>'), b.join('>')));
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  return { nodes, edges, commit: hashes.join(', '), groups };
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
:root { --bg:#fafaf9; --card:#ffffff; --text:#1a1a1a; --sub:#555b66; --line:#c9c9c2; --sel:#b8442e; --selbg:#fdf0ec; --rel:#2f7d57; --relbg:#eaf4ee; --c-screen:#2b5d9b; --c-engine:#7a3fa0; --c-store:#9a6b00; --c-external:#555b66; --c-module:#2f7d57; --c-api:#555b66; --c-device:#7a5a3a; --c-need:#b8442e; }
@media (prefers-color-scheme: dark) { :root { --bg:#17181a; --card:#212326; --text:#f1f1ee; --sub:#a9adb5; --line:#43464b; --sel:#ff8c73; --selbg:#3a2520; --rel:#5fc08e; --relbg:#1d3327; --c-screen:#7fb0ee; --c-engine:#c79af0; --c-store:#e0b050; --c-external:#a9adb5; --c-module:#6fcf9b; --c-api:#a9adb5; --c-device:#d3a97a; --c-need:#ff8c73; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px 0; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; }
.hint { font-size: 14px; color: var(--sub); margin: 0 0 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 16px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font-size: 14px; }
.legend .lg { display: inline-flex; align-items: center; gap: 8px; }
.legend .rels { flex-basis: 100%; color: var(--sub); }
.wrap { max-width: 1280px; margin: 0 auto; padding: 0 16px; }
.tabs { display: flex; gap: 4px; margin: 0 0 16px; border-bottom: 1px solid var(--line); }
.tabs button { min-height: 44px; padding: 8px 22px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: var(--sub); font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
.tabs button[aria-selected="true"] { color: var(--sel); border-bottom-color: var(--sel); }
.tabs .sp { flex: 1; align-self: center; font-size: 14px; color: var(--sub); text-align: right; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; }
@media (min-width: 720px) {
  .layout { grid-template-columns: minmax(0, 65fr) minmax(0, 35fr); gap: 24px; align-items: start; }
  #detail { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow: auto; }
}
[hidden] { display: none !important; }
.col h2, .sec-title { font-size: 14px; margin: 0 0 8px; color: var(--sub); font-weight: 700; }
.col .group { font-size: 14px; color: var(--sub); margin: 12px 0 4px; }
.item, .sample { --bc: var(--kc, var(--line)); --bg2: var(--card); position: relative; display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 10px 14px; min-height: 44px; border: 1.5px solid var(--bc); background: var(--bg2); color: var(--text); font: inherit; font-size: 16px; overflow-wrap: break-word; word-break: keep-all; }
.item { cursor: pointer; }
.item small { display: block; font-size: 14px; color: var(--sub); }
.t-screen { --kc: var(--c-screen); border-radius: 12px; }
.t-todo { --kc: var(--line); border-radius: 12px; border-style: dashed; color: var(--sub); background: transparent; --bg2: transparent; }
.t-external { --kc: var(--c-external); border-radius: 4px; border-style: dashed; }
.t-module { --kc: var(--c-module); border-radius: 0; }
.t-api { --kc: var(--c-api); border-radius: 4px; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
.t-device { --kc: var(--c-device); border-radius: 999px; border-style: dotted; }
.t-need { --kc: var(--c-need); border-radius: 999px; border-style: dashed; }
.t-db, .t-cache { --kc: var(--c-store); border-radius: 14px / 10px; padding-top: 16px; width: fit-content; min-width: 150px; max-width: 100%; }
.t-db::before, .t-cache::before { content: ""; position: absolute; left: -1.5px; right: -1.5px; top: 0; height: 14px; border: 1.5px solid var(--bc); border-radius: 50%; background: var(--bg2); }
.t-cache::before { border-style: dashed; }
.t-engine { --kc: var(--c-engine); border: 0; background: var(--bc); padding: 10px 26px; width: fit-content; min-width: min(200px, 100%); max-width: 100%; clip-path: polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%); }
.t-engine::before { content: ""; position: absolute; inset: 2px; background: var(--bg2); clip-path: polygon(15px 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 15px 100%, 0 50%); }
.item > .lbl, .sample > .lbl { position: relative; }
.sample { display: inline-block; width: auto; margin: 0; padding: 4px 14px; min-height: 0; font-size: 14px; }
.sample.t-db, .sample.t-cache { padding-top: 14px; }
.sample.t-engine { padding: 4px 22px; }
.item.sel { --bc: var(--sel); --bg2: var(--selbg); }
.item.rel, .item.flow { --bc: var(--rel); --bg2: var(--relbg); }
.dim .item:not(.sel):not(.rel):not(.flow) { opacity: .62; }   /* 강조 해제 항목: 글자 대비 약 4.5:1 이상 유지(라이트·다크), 강조(sel·rel·flow)는 테두리·배경으로 구분 */
.badge { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); z-index: 2; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px; background: var(--sel); color: #fff; font-size: 14px; font-weight: 700; line-height: 24px; text-align: center; white-space: nowrap; }
.item.flow > .lbl { display: block; padding-left: 34px; }
.item.flow.t-engine > .lbl { padding-left: 24px; }
.item.flow .badge { left: 14px; }
.item.t-engine.flow .badge { left: 20px; }
#detail { padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font-size: 15px; overflow-wrap: break-word; word-break: keep-all; }
@media (max-width: 719px) { #detail { max-height: 1000px; overflow: auto; } }
#detail .head { font-weight: 700; margin-bottom: 6px; }
#detail .sec { font-size: 14px; font-weight: 700; color: var(--sub); margin: 12px 0 6px; }
#detail .rel-row { margin: 6px 0; }
#detail .rk { display: inline-block; min-width: 4.5em; font-weight: 700; color: var(--sel); }
#detail ul { margin: 2px 0 0; padding-left: 20px; }
.flow-card { display: block; width: 100%; text-align: left; margin: 0 0 10px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); font: inherit; font-size: 15px; cursor: pointer; }
.flow-card.on { border-color: var(--sel); background: var(--selbg); box-shadow: 0 0 0 1px var(--sel) inset; }
.flow-card .fname { display: block; font-weight: 700; margin-bottom: 8px; }
.flow-card .steps { display: block; }
.flow-card .srow { display: flex; align-items: flex-start; gap: 8px; margin: 6px 0; }
.flow-card .srow.branch { margin-left: 32px; }
.flow-card .srow .num { flex: none; margin-top: 2px; }
.flow-card .srow .sample { flex: 0 1 auto; min-width: 0; max-width: 100%; }
.flow-card .fail { flex: none; margin-top: 3px; font-size: 14px; font-weight: 700; color: var(--sel); }
.num { display: inline-block; min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px; background: var(--sel); color: #fff; font-size: 14px; font-weight: 700; line-height: 24px; text-align: center; white-space: nowrap; }
.flow-card .sample { margin: 0; padding: 2px 10px; font-size: 14px; }
.flow-card .sample.t-db, .flow-card .sample.t-cache { padding-top: 14px; min-width: 0; }
.flow-card .sample.t-engine { padding: 2px 20px; min-width: 0; }
.flow-card .sample small, .fchip small { display: inline; margin-right: 6px; font-size: 14px; color: var(--sub); line-height: 1.2; }
details.conn { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
details.conn summary { cursor: pointer; font-size: 14px; font-weight: 700; color: var(--sub); min-height: 32px; }
.conn-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; margin-top: 8px; }
.conn-grid .rel-row { margin: 4px 0; }
.foot { margin-top: 12px; font-size: 14px; color: var(--sub); }
/* ── 계층 보기 ── */
.tree { display: flex; flex-direction: column; align-items: center; }
.root { padding: 8px 40px; border: 2px solid var(--c-screen); border-radius: 12px; background: var(--card); font-size: 18px; font-weight: 700; color: var(--c-screen); }
.stem { width: 0; height: 20px; border-left: 1.5px solid var(--line); }
.groups { display: flex; gap: 14px; width: 100%; align-items: stretch; }
.grp { position: relative; flex: 1 1 0; min-width: 170px; padding: 10px; border: 1.5px solid var(--line); border-radius: 12px; background: var(--card); }
.grp.g-wide6 { flex-grow: 6; } .grp.g-wide4 { flex-grow: 4; } .grp.g-wide1 { flex-grow: 1.4; }
.grp::before { content: ""; position: absolute; top: -21px; left: 50%; height: 20px; border-left: 1.5px solid var(--line); }
.grp::after { content: ""; position: absolute; top: -21px; left: -8px; right: -8px; border-top: 1.5px solid var(--line); }
.grp:first-child::after { left: 50%; } .grp:last-child::after { right: 50%; }
.grp h3 { margin: 0 0 8px; font-size: 16px; }
.grp h3 small { font-size: 14px; font-weight: 400; color: var(--sub); margin-left: 6px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.cards .item { margin: 0; padding: 8px 10px; }
.cards .item .nm { display: block; font-weight: 700; font-size: 15px; }
.cards .item small { font-size: 14px; }
/* ── 흐름 보기 ── */
.fsel { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px; margin: 0 0 16px; }
.fsel > div { padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.fsel .glabel { font-size: 14px; font-weight: 700; color: var(--sub); margin: 8px 0 4px; }
.fsel .glabel:first-child { margin-top: 0; }
.fsel .row { display: flex; flex-wrap: wrap; gap: 6px; }
.fsel .row .item { width: auto; margin: 0; min-height: 36px; padding: 4px 12px; font-size: 15px; }
.fsel .acts .item { display: flex; align-items: center; gap: 8px; width: 100%; margin: 0 0 6px; min-height: 40px; padding: 6px 12px; }
.fsel .acts .item small { display: inline; }
.fig { position: relative; padding: 8px 0 16px; }
.fgrid { display: grid; grid-template-columns: 240px minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1.15fr); column-gap: 32px; row-gap: 44px; align-items: start; }
.fhead { font-size: 14px; font-weight: 700; color: var(--sub); text-align: center; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
.fstart { margin: 0; align-self: start; }
.fstart .nm { display: block; font-weight: 700; font-size: 17px; }
.fstart .act { display: block; margin-top: 6px; font-size: 15px; }
.fcell { display: flex; gap: 44px; justify-content: center; min-width: 0; }
.fcell.stack { flex-direction: column; align-items: center; }
.fchip { display: flex; align-items: flex-start; gap: 8px; width: fit-content; max-width: 100%; margin: 0; padding: 6px 12px; font-size: 15px; min-width: 0; }
.fchip.t-db, .fchip.t-cache { padding-top: 16px; min-width: 0; }
.fchip.t-engine { padding: 6px 24px; min-width: 0; }
.fchip .num { flex: none; position: relative; margin-top: 1px; }
.fchip .lbl { min-width: 0; }
.farrows { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.farrows path { fill: none; stroke: var(--sub); stroke-width: 1.6; }
.farrows path.dash { stroke-dasharray: 6 5; stroke: var(--sel); }
.farrows marker path { fill: var(--sub); stroke: none; }
.farrows marker.mdash path { fill: var(--sel); }
.fempty { padding: 24px; color: var(--sub); }
/* ── 연결 보기 ── */
.shared { display: flex; flex-wrap: wrap; gap: 0; margin: 0 0 16px; }
.shared .item { display: inline-block; width: auto; margin: 0 8px 8px 0; min-height: 36px; padding: 6px 12px; font-size: 15px; }
.shared .item.t-engine { padding: 6px 26px; }
.shared .item.t-db, .shared .item.t-cache { padding-top: 18px; min-width: 0; }
.shared .item b { color: var(--sel); margin-left: 6px; }
.usage { display: flex; gap: 12px; margin: 0 0 16px; align-items: stretch; }
.usage .grp { padding: 8px; }
.usage .grp::before, .usage .grp::after { display: none; }
.usage .grp.g-wide6 { flex-grow: 6; } .usage .grp.g-wide4 { flex-grow: 4; } .usage .grp.g-wide1 { flex-grow: 1.4; }
.usage .cards { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.usage .item small { display: block; }
.usage .tag { color: var(--rel); font-weight: 700; }
.nolink-note { margin: 0 0 8px; font-size: 14px; color: var(--sub); }
/* ── 서비스 탭 (글자 15px 이상, 선 없음) ── */
#v-svc { font-size: 15px; }
#v-svc .svsec { margin: 0 0 24px; }
#v-svc .svh { font-size: 16px; margin: 0 0 10px; color: var(--sub); }
#v-svc .trow { display: flex; align-items: flex-start; gap: 12px; margin: 0 0 8px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
#v-svc .trow > .num { flex: none; margin-top: 3px; }
#v-svc .tbody { flex: 1 1 0; min-width: 0; }
#v-svc .tchips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 22px; }
#v-svc .tgrp { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; }
#v-svc .rchip { flex: none; font-size: 15px; font-weight: 700; color: var(--sel); white-space: nowrap; }
#v-svc .tmeta { margin-top: 4px; font-size: 15px; color: var(--sub); }
#v-svc .ev { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 15px; color: var(--sub); }
#v-svc .au { color: var(--sub); }
#v-svc .nb { white-space: nowrap; }
#v-svc .mth { font-weight: 700; }
#v-svc .sample { display: inline-block; font-size: 15px; padding: 4px 14px; max-width: 100%; }
#v-svc .sample.t-db, #v-svc .sample.t-cache { padding-top: 16px; }
#v-svc .sample.t-engine { padding: 4px 24px; }
#v-svc .sample small, #v-svc .item small { display: inline; font-size: 15px; color: var(--sub); margin-right: 6px; }
#v-svc .sample small.tg { margin: 0 0 0 8px; color: var(--sel); font-weight: 700; }
#v-svc .t-file { --kc: var(--c-module); border: 0; background: var(--bc); border-radius: 0; clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%); position: relative; padding: 5px 20px 5px 14px; }
#v-svc .t-file::before { content: ""; position: absolute; inset: 2px; background: var(--bg2); clip-path: polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%); }
#v-svc .t-file > .lbl { position: relative; }
#v-svc .svnote { margin: 8px 0 0; font-size: 15px; color: var(--sub); }
#v-svc .svtoggle { display: flex; gap: 8px; margin: 0 0 12px; }
#v-svc .svtoggle .item { width: auto; margin: 0; padding: 6px 18px; font-size: 15px; font-weight: 700; }
#v-svc .svpick { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin: 0 0 12px; }
#v-svc .pgrp { padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
#v-svc .pgrp .glabel { font-size: 15px; font-weight: 700; color: var(--sub); margin: 0 0 8px; }
#v-svc .pgrp .row { display: flex; flex-wrap: wrap; gap: 8px; }
#v-svc .pgrp .row .item { display: inline-block; width: auto; margin: 0; min-height: 40px; padding: 6px 14px; font-size: 15px; }
#v-svc .item .nm { display: block; font-weight: 700; }
#v-svc .item.t-db, #v-svc .item.t-cache { padding-top: 18px; min-width: 0; }
#v-svc .item.t-engine { padding: 6px 28px; }
#v-svc .svpanel { margin: 12px 0 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
#v-svc .svph { font-size: 17px; margin: 0 0 4px; }
#v-svc .stage { margin: 14px 0 0; }
#v-svc .sth { display: flex; align-items: center; gap: 10px; font-weight: 700; }
#v-svc .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 8px 0 0; }
#v-svc .gcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; margin: 8px 0 0; align-items: start; }
#v-svc .gcard { border: 1.5px solid var(--c-screen); border-radius: 8px; background: var(--card); padding: 0; }
#v-svc .gcard.open { border-color: var(--sel); background: var(--selbg); }
#v-svc .gcard .gbtn { display: block; width: 100%; margin: 0; border: 0; background: transparent; border-radius: 8px; padding: 8px 12px; text-align: left; font-size: 15px; }
#v-svc .gcard .gname { display: block; font-weight: 700; }
#v-svc .apilist { list-style: none; margin: 0; padding: 4px 12px 8px; border-top: 1px solid var(--line); }
#v-svc .apilist[hidden] { display: none; }
#v-svc .apirow { margin: 8px 0 0; }
#v-svc .svfoot { margin-top: 8px; font-size: 15px; }
#v-svc .num { font-size: 15px; }
#v-svc .sbtn small { margin: 0 0 0 8px; }
#v-svc .apirow .ah, #v-svc .apirow .tmeta { display: block; }
#v-svc .cbtn { width: auto; margin: 0; min-height: 40px; padding: 6px 14px; }
</style>
</head>
<body>
<div class="wrap">
<h1>METIS-3 도면</h1>
<p class="hint">탭 4개: 계층(화면을 묶음별로) · 흐름(동작 하나를 경로·엔진·저장소까지) · 연결(부품을 쓰는 화면) · 서비스(로그인 줄기와 기능 → API 묶음 → 저장소 목록). 탭을 바꿔도 고른 화면은 유지됩니다. 항목을 누르면 연결된 항목이 강조되고 나머지는 흐려지며, 같은 항목을 다시 누르면 해제됩니다. 화면을 누르면 동작별 흐름이 오른쪽 상세 상자에 나오고, 동작 카드를 누르면 연결 보기 목록에 순서 번호가 붙습니다. (PC 화면 기준)</p>
<div class="legend" aria-label="범례">
  <span class="lg"><span class="sample t-screen"><span class="lbl">화면</span></span></span>
  <span class="lg"><span class="sample t-engine"><span class="lbl">엔진</span></span></span>
  <span class="lg"><span class="sample t-db"><span class="lbl">DB</span></span></span>
  <span class="lg"><span class="sample t-cache"><span class="lbl">캐시</span></span></span>
  <span class="lg"><span class="sample t-device"><span class="lbl">기기</span></span></span>
  <span class="lg"><span class="sample t-api"><span class="lbl">API</span></span></span>
  <span class="lg"><span class="sample t-external"><span class="lbl">외부</span></span></span>
  <span class="lg"><span class="sample t-module"><span class="lbl">모듈</span></span></span>
  <span class="lg"><span class="sample t-need"><span class="lbl">필요</span></span></span>
  <span class="lg"><span class="sample t-todo"><span class="lbl">미작성</span></span></span>
  <span class="rels">관계: →호출 · →읽기 · →쓰기 · →이동(화면→화면) · ⇢대체(앞이 실패하면 뒤, 같은 번호의 a·b 가지) · →필요(로그인·권한). 모양: 화면=둥근 사각, 엔진=육각형, DB=원통, 캐시=점선 윗면 원통, 기기=점선 알약, API=가는 사각, 외부=점선 사각, 모듈=직각 사각, 필요=파선 알약, 미작성=회색 점선. 동작 카드·번호 배지는 ①②③ 순서입니다.</span>
</div>
<div class="tabs" role="tablist" aria-label="보기 선택">
  <button type="button" role="tab" data-tab="tree" aria-selected="true">계층</button>
  <button type="button" role="tab" data-tab="flow" aria-selected="false">흐름</button>
  <button type="button" role="tab" data-tab="conn" aria-selected="false">연결</button>
  <button type="button" role="tab" data-tab="svc" aria-selected="false">서비스</button>
  <span class="sp" id="tabnote"></span>
</div>
<div class="layout" id="layout">
  <div class="main" id="main">
    <section id="v-tree" aria-label="계층 보기">
      <div class="tree"><div class="root">METIS-3</div><div class="stem"></div><div class="groups" id="groups"></div></div>
    </section>
    <section id="v-conn" aria-label="연결 보기" hidden>
      <div class="sec-title" id="shared-title">여러 화면이 같이 쓰는 부품 (사용 화면 2개 이상, 개수 순)</div>
      <div class="shared" id="shared"></div>
      <div class="sec-title">쓰는 화면 (묶음별) — 부품을 고르면 쓰는 화면이 강조되고 호출·읽기·쓰기가 적힙니다</div>
      <div class="usage" id="usage"></div>
      <div class="lists" id="grid">
        <div class="col" id="col-2"><h2>엔진 · 모듈</h2></div>
        <div class="col" id="col-3"><h2>저장소 · 외부</h2></div>
      </div>
    </section>
  </div>
  <aside id="detail" aria-live="polite">항목을 누르면 연결이 여기에 표시됩니다.</aside>
</div>
<section id="v-flow" aria-label="흐름 보기" hidden>
  <div class="fsel"><div id="fscreens"></div><div class="acts" id="factions"></div></div>
  <div class="fig" id="fig"></div>
</section>
<section id="v-svc" aria-label="서비스 보기" hidden></section>
<p class="foot">이 파일은 <code>npm run blueprint:gen</code> 이 docs/blueprint/screens 의 머리말에서 만든다(직접 고치지 않는다). 화면 파일 마지막 확인 커밋: <span id="commit"></span></p>
</div>
<script id="data" type="application/json">${json}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var nodes = data.nodes, byId = {}, edges = data.edges, groups = data.groups || [];
  nodes.forEach(function (n) { byId[n.id] = n; });
  document.getElementById('commit').textContent = data.commit || '(없음)';
  var PART = { engine: 1, module: 1, db: 1, cache: 1, external: 1 };
  var CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  var RELWORD = { call: '호출', read: '읽기', write: '쓰기' };
  function numLabel(n) { var d = parseInt(n, 10), rest = String(n).replace(/^\\d+/, ''); return (CIRC[d - 1] || String(d)) + rest; }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function putText(el, text, type) {   // 경로(모듈·API)는 단어 중간이 아니라 슬래시 뒤에서만 줄바꿈한다
    if (type !== 'module' && type !== 'api') {   // 그 밖의 이름은 여는 괄호 뒤에서만 줄바꿈할 수 있게 한다(영문 단어가 중간에서 쪼개지지 않게)
      String(text).split('(').forEach(function (part, i) { if (i > 0) { el.appendChild(document.createTextNode('(')); el.appendChild(document.createElement('wbr')); } el.appendChild(document.createTextNode(part)); });
      return;
    }
    String(text).split('/').forEach(function (part, i) { if (i > 0) { el.appendChild(document.createTextNode('/')); el.appendChild(document.createElement('wbr')); } el.appendChild(document.createTextNode(part)); });
  }
  function out(id, rel) { return edges.filter(function (e) { return e[0] === id && e[2] === rel; }).map(function (e) { return e[1]; }); }
  function inn(id, rel) { return edges.filter(function (e) { return e[1] === id && e[2] === rel; }).map(function (e) { return e[0]; }); }
  function nameOf(id) { return byId[id].label; }
  function typed(ids, t) { return ids.filter(function (i) { return t.indexOf(byId[i].type) >= 0; }); }
  function usersOf(id) { var m = {}; edges.forEach(function (e) { if (e[1] === id && RELWORD[e[2]] && byId[e[0]].type === 'screen') { (m[e[0]] = m[e[0]] || {})[e[2]] = 1; } }); return m; }
  function relText(r) { var k = ['call', 'read', 'write'].filter(function (x) { return r[x]; }); if (r.read && r.write) return '읽기·쓰기'; return k.map(function (x) { return RELWORD[x]; }).join('·'); }
  var screens = [];
  groups.forEach(function (g) { g.screens.forEach(function (s) { var n = byId['s:' + s]; if (n) screens.push(n); }); });
  nodes.filter(function (n) { return n.type === 'todo'; }).forEach(function (n) { screens.push(n); });
  function storeCount(sid) { var set = {}; ['read', 'write'].forEach(function (r) { out(sid, r).forEach(function (t) { if (byId[t].type === 'db' || byId[t].type === 'cache') set[t] = 1; }); }); return Object.keys(set).length; }
  function groupClass(g) { var c = g.screens.length; return c >= 6 ? 'g-wide6' : c >= 4 ? 'g-wide4' : 'g-wide1'; }

  /* ── 상태 ── */
  var selected = null, selScreen = null, flowOn = null, flowPick = null, tab = 'tree';
  var main = document.getElementById('main'), detail = document.getElementById('detail');
  var EMPTY_MSG = '항목을 누르면 연결이 여기에 표시됩니다.';
  function els(n) { return [n.el, n.card].filter(Boolean); }

  /* ── 계층 보기 ── */
  var gbox = document.getElementById('groups');
  groups.forEach(function (g) {
    var box = mk('div', 'grp ' + groupClass(g)); var h = mk('h3', '', g.name); h.appendChild(mk('small', '', g.screens.length + '개 화면')); box.appendChild(h);
    var cards = mk('div', 'cards');
    g.screens.forEach(function (s) {
      var n = byId['s:' + s]; if (!n) return;
      var b = mk('button', 'item t-screen'); b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.dataset.id = n.id;
      b.appendChild(mk('span', 'nm', n.label));
      b.appendChild(mk('small', '', '동작 ' + (n.flows ? n.flows.length : 0) + ' · DB·캐시 ' + storeCount(n.id)));
      b.addEventListener('click', function () { select(selected === n.id ? null : n.id); });
      n.card = b; cards.appendChild(b);
    });
    box.appendChild(cards); gbox.appendChild(box);
  });

  /* ── 연결 보기: 공유 부품, 묶음별 사용 화면, 부품 목록 ── */
  var parts = nodes.filter(function (n) { return PART[n.type]; });
  var shared = document.getElementById('shared'), sharedBtn = {};
  parts.forEach(function (n) { n.users = Object.keys(usersOf(n.id)); });
  parts.filter(function (n) { return n.users.length >= 2; }).sort(function (a, b) { return b.users.length - a.users.length || (a.label < b.label ? -1 : 1); }).forEach(function (n) {
    var b = mk('button', 'item t-' + n.type); b.type = 'button'; b.setAttribute('aria-pressed', 'false');
    var l = mk('span', 'lbl'); putText(l, n.label, n.type); l.appendChild(mk('b', '', '×' + n.users.length)); b.appendChild(l);
    b.addEventListener('click', function () { select(selected === n.id ? null : n.id); });
    sharedBtn[n.id] = b; shared.appendChild(b);
  });
  var usage = document.getElementById('usage');
  groups.forEach(function (g) {
    var box = mk('div', 'grp ' + groupClass(g)); box.appendChild(mk('h3', '', g.name));
    var cards = mk('div', 'cards');
    g.screens.forEach(function (s) {
      var n = byId['s:' + s]; if (!n) return;
      var b = mk('button', 'item t-screen'); b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.dataset.id = n.id;
      var l = mk('span', 'lbl'); l.appendChild(document.createTextNode(n.label)); l.appendChild(mk('small', 'utag', '')); b.appendChild(l);
      b.addEventListener('click', function () { select(selected === n.id ? null : n.id); });
      n.el = b; cards.appendChild(b);
    });
    box.appendChild(cards); usage.appendChild(box);
  });
  var cols = { 2: document.getElementById('col-2'), 3: document.getElementById('col-3') };
  var lastGroup = {};
  var BUCKET = [['engine', 2, '엔진'], ['module', 2, '모듈'], ['db', 3, 'DB 테이블'], ['cache', 3, '서버 캐시'], ['external', 3, '외부 서비스']];
  function partItem(n) {
    var b = mk('button', 'item t-' + n.type); b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.dataset.id = n.id;
    var l = mk('span', 'lbl'); putText(l, n.label, n.type); b.appendChild(l);
    b.addEventListener('click', function () { select(selected === n.id ? null : n.id); });
    n.el = b; return b;
  }
  BUCKET.forEach(function (bk) {
    var list = parts.filter(function (n) { return n.type === bk[0] && !n.unlinked; });
    if (!list.length) return;
    cols[bk[1]].appendChild(mk('div', 'group', bk[2]));
    list.forEach(function (n) { cols[bk[1]].appendChild(partItem(n)); });
  });
  var unl = parts.filter(function (n) { return n.unlinked; });
  if (unl.length) {
    cols[3].appendChild(mk('div', 'group', '연결 없음 (db.md 에는 있으나 어느 화면 도면과도 연결되지 않음)'));
    unl.forEach(function (n) { var b = partItem(n); b.appendChild(mk('small', '', (n.type === 'cache' ? '캐시' : 'DB') + ' · 연결 없음')); cols[3].appendChild(b); });
  }

  /* ── 선택·강조 ── */
  function clearMarks() {
    nodes.forEach(function (n) { els(n).forEach(function (e) { e.classList.remove('sel', 'rel', 'flow'); e.setAttribute('aria-pressed', 'false'); }); if (n.el) { var b = n.el.querySelector('.badge'); if (b) b.remove(); var lb = n.el.querySelector('.lbl'); if (lb) lb.style.paddingLeft = ''; } });
    Object.keys(sharedBtn).forEach(function (k) { sharedBtn[k].classList.remove('sel'); sharedBtn[k].setAttribute('aria-pressed', 'false'); });
    nodes.forEach(function (n) { if (n.type === 'screen' && n.el) { var u = n.el.querySelector('.utag'); if (u) u.textContent = ''; } });
  }
  function addCls(n, c) { els(n).forEach(function (e) { e.classList.add(c); if (c === 'sel') e.setAttribute('aria-pressed', 'true'); }); }
  function markRelated(id) { edges.forEach(function (e) { if (e[0] === id) addCls(byId[e[1]], 'rel'); if (e[1] === id) addCls(byId[e[0]], 'rel'); }); }
  function row(parent, kind, items) {
    if (!items || !items.length) return;
    var d = mk('div', 'rel-row'); d.appendChild(mk('span', 'rk', kind));
    var ul = mk('ul'); items.forEach(function (x) { ul.appendChild(mk('li', '', x)); }); d.appendChild(ul);
    parent.appendChild(d);
  }
  function merged(a, b) {
    var both = a.filter(function (x) { return b.indexOf(x) >= 0; });
    return { both: both, onlyA: a.filter(function (x) { return both.indexOf(x) < 0; }), onlyB: b.filter(function (x) { return both.indexOf(x) < 0; }) };
  }
  function stepChip(st) {
    var s = mk('span', 'sample t-' + st.type); var l = mk('span', 'lbl'); l.appendChild(mk('small', '', st.rl)); putText(l, st.label, st.type); s.appendChild(l); return s;
  }
  function flowCard(screenId, f) {
    var card = mk('button', 'flow-card'); card.type = 'button'; card.setAttribute('aria-pressed', 'false'); card.dataset.flow = f.name;
    card.appendChild(mk('span', 'fname', f.name));
    var steps = mk('span', 'steps');
    f.steps.forEach(function (st) {
      var r = mk('span', 'srow' + (st.rel === 'fallback' ? ' branch' : ''));
      r.appendChild(mk('span', 'num', numLabel(st.n)));
      if (st.rel === 'fallback') r.appendChild(mk('span', 'fail', '실패하면'));
      r.appendChild(stepChip(st));
      steps.appendChild(r);
    });
    card.appendChild(steps);
    card.addEventListener('click', function () { selectFlow(screenId, flowOn === f.name ? null : f.name, card); });
    return card;
  }
  function selectFlow(screenId, name, card) {
    flowOn = name; flowPick = name;
    detail.querySelectorAll('.flow-card').forEach(function (c) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
    clearMarks();
    var sn = byId[screenId]; addCls(sn, 'sel');
    if (!name) { markRelated(screenId); return; }
    if (card) { card.classList.add('on'); card.setAttribute('aria-pressed', 'true'); }
    var f = sn.flows.filter(function (x) { return x.name === name; })[0], marks = {};
    f.steps.forEach(function (st) { if (st.node) { (marks[st.node] = marks[st.node] || []).push(numLabel(st.n)); } });
    Object.keys(marks).forEach(function (id) {
      var n = byId[id]; if (!n.el) return;
      var el = n.el; el.classList.add('flow');
      var b = mk('span', 'badge', marks[id].join('')); el.insertBefore(b, el.firstChild);
      var lb = el.querySelector('.lbl'); lb.style.paddingLeft = (b.offsetWidth + (el.classList.contains('t-engine') ? 28 : 22)) + 'px';
    });
  }
  function usersByGroup(id) {
    var u = usersOf(id), res = [];
    groups.forEach(function (g) { var l = g.screens.filter(function (s) { return u['s:' + s]; }); if (l.length) res.push({ g: g.name, list: l.map(function (s) { return { name: s, rel: u['s:' + s] }; }) }); });
    return res;
  }
  function select(id) {
    selected = id; flowOn = null; flowPick = null;
    clearMarks(); detail.textContent = '';
    main.classList.toggle('dim', !!id);
    if (!id) { selScreen = null; detail.textContent = EMPTY_MSG; return; }
    var n = byId[id];
    if (n.type === 'screen' || n.type === 'todo') selScreen = id;
    addCls(n, 'sel');
    if (sharedBtn[id]) { sharedBtn[id].classList.add('sel'); sharedBtn[id].setAttribute('aria-pressed', 'true'); }
    markRelated(id);
    detail.appendChild(mk('div', 'head', n.label + (n.file ? '  (' + n.file + ')' : '')));
    if (n.type === 'todo') { detail.appendChild(mk('div', '', '이 화면은 도면이 아직 없습니다(연결 정보 없음). →이동해 오는 화면: ' + (inn(id, 'move').map(nameOf).join(', ') || '(없음)'))); return; }
    if (n.type === 'screen') {
      if (n.group) detail.appendChild(mk('div', '', '묶음: ' + n.group));
      if (n.flows && n.flows.length) {
        detail.appendChild(mk('div', 'sec', '동작별 흐름 (' + n.flows.length + '개) — 동작을 누르면 연결 보기 목록에 순서 번호가 붙습니다'));
        n.flows.forEach(function (f) { detail.appendChild(flowCard(id, f)); });
      } else detail.appendChild(mk('div', 'sec', '이 화면에는 동작별 흐름이 아직 없습니다.'));
      var det = mk('details', 'conn'); det.appendChild(mk('summary', '', '종류별 연결 목록 (펼치기)'));
      var g = mk('div', 'conn-grid');
      row(g, '→필요', n.requires); row(g, '→호출 API', n.calls);
      row(g, '→호출 엔진', typed(out(id, 'call'), ['engine']).map(nameOf)); row(g, '→호출 외부', typed(out(id, 'call'), ['external']).map(nameOf)); row(g, '→호출 모듈', typed(out(id, 'call'), ['module']).map(nameOf));
      var st = merged(typed(out(id, 'read'), ['db', 'cache']).map(nameOf), typed(out(id, 'write'), ['db', 'cache']).map(nameOf));
      row(g, '→읽기·쓰기 저장소', st.both); row(g, '→읽기 저장소', st.onlyA); row(g, '→쓰기 저장소', st.onlyB);
      var dv = merged(n.devReads, n.devWrites);
      row(g, '→읽기·쓰기 기기', dv.both); row(g, '→읽기 기기', dv.onlyA); row(g, '→쓰기 기기', dv.onlyB);
      row(g, '⇢대체', n.fallback); row(g, '→이동', out(id, 'move').map(nameOf));
      det.appendChild(g); detail.appendChild(det);
    } else {
      var ug = usersByGroup(id), total = 0; ug.forEach(function (x) { total += x.list.length; });
      if (n.unlinked) detail.appendChild(mk('div', '', '어느 화면 도면과도 연결되지 않은 ' + (n.type === 'cache' ? '캐시' : 'DB') + '입니다(db.md 에는 있음).'));
      else detail.appendChild(mk('div', '', '쓰는 화면 ' + total + '개'));
      ug.forEach(function (x) {
        detail.appendChild(mk('div', 'sec', x.g + ' (' + x.list.length + ')'));
        var ul = mk('ul'); x.list.forEach(function (s) { ul.appendChild(mk('li', '', s.name + ' — ' + relText(s.rel))); }); detail.appendChild(ul);
        x.list.forEach(function (s) { var sn = byId['s:' + s.name]; if (sn && sn.el) { var u = sn.el.querySelector('.utag'); if (u) { u.textContent = relText(s.rel); u.classList.add('tag'); } } });
      });
      if (n.type === 'engine') { row(detail, '⇢대체(이 엔진이 실패하면)', out(id, 'fallback').map(nameOf)); row(detail, '⇢대체(이 엔진으로 대신함)', inn(id, 'fallback').map(nameOf)); }
    }
    detail.appendChild(mk('div', 'foot', '도면이 있는 화면만 표시됩니다(미작성 화면은 코드로 확인).'));
  }
  function applyFlow() {   // 탭을 옮긴 뒤에도 고른 동작을 상세 카드·번호 배지에 되살린다
    if (!selScreen || !flowPick) return;
    var cards = detail.querySelectorAll('.flow-card'), hit = null;
    for (var i = 0; i < cards.length; i++) if (cards[i].dataset.flow === flowPick) hit = cards[i];
    if (hit) selectFlow(selScreen, flowPick, hit);
  }

  /* ── 흐름 보기 ── */
  var fscreens = document.getElementById('fscreens'), factions = document.getElementById('factions'), fig = document.getElementById('fig');
  var COLOF = { need: 1, api: 1, engine: 2, module: 2, db: 3, cache: 3, device: 3, external: 3, screen: 3 };
  var HEADS = ['화면 · 동작', '경로 (필요 · API)', '엔진 · 모듈', '저장소 · 외부'];
  window.__segs = []; window.__chips = [];
  function fpick() { var sn = byId[selScreen]; if (!sn || !sn.flows || !sn.flows.length) return null; var f = sn.flows.filter(function (x) { return x.name === flowPick; })[0]; return f || sn.flows[0]; }
  function renderFlowTab() {
    if (!selScreen) selScreen = screens[0].id;
    fscreens.textContent = ''; factions.textContent = '';
    groups.forEach(function (g) {
      fscreens.appendChild(mk('div', 'glabel', g.name));
      var r = mk('div', 'row');
      g.screens.forEach(function (s) {
        var n = byId['s:' + s]; if (!n) return;
        var b = mk('button', 'item t-screen' + (n.id === selScreen ? ' sel' : '')); b.type = 'button'; b.textContent = n.label; b.setAttribute('aria-pressed', n.id === selScreen ? 'true' : 'false');
        b.addEventListener('click', function () { if (selScreen !== n.id) { selScreen = n.id; flowPick = null; selected = null; renderFlowTab(); } });
        r.appendChild(b);
      });
      fscreens.appendChild(r);
    });
    var sn = byId[selScreen], cur = fpick();
    factions.appendChild(mk('div', 'glabel', sn.label + ' 의 동작 (' + (sn.flows ? sn.flows.length : 0) + '개)'));
    (sn.flows || []).forEach(function (f, i) {
      var b = mk('button', 'item' + (cur && f.name === cur.name ? ' sel' : '')); b.type = 'button'; b.setAttribute('aria-pressed', cur && f.name === cur.name ? 'true' : 'false');
      b.appendChild(mk('span', 'num', String(i + 1))); b.appendChild(document.createTextNode(f.name)); b.appendChild(mk('small', '', f.steps.length + '단계'));
      b.addEventListener('click', function () { flowPick = f.name; renderFlowTab(); });
      factions.appendChild(b);
    });
    drawFlow(sn, cur);
  }
  function drawFlow(sn, f) {
    fig.textContent = ''; window.__segs = []; window.__chips = [];
    if (!f) { fig.appendChild(mk('div', 'fempty', '이 화면에는 동작별 흐름이 없습니다.')); return; }
    var grid = mk('div', 'fgrid');
    HEADS.forEach(function (h, i) { var e = mk('div', 'fhead', h); e.style.gridColumn = String(i + 1); e.style.gridRow = '1'; grid.appendChild(e); });
    var gs = []; f.steps.forEach(function (st) { var gi = parseInt(st.n, 10) - 1; (gs[gi] = gs[gi] || []).push(st); });
    var start = mk('div', 'item t-screen fstart'); start.style.gridColumn = '1'; start.style.gridRow = '2 / span ' + gs.length;
    start.appendChild(mk('span', 'nm', sn.label)); start.appendChild(mk('small', '', (sn.group || '') + ' 묶음')); start.appendChild(mk('span', 'act', f.name)); grid.appendChild(start);
    var chipsByGroup = [];
    gs.forEach(function (g, gi) {
      var cell = mk('div', 'fcell' + (g.length > 1 ? ' stack' : '')); cell.style.gridColumn = String(COLOF[g[0].type] + 1); cell.style.gridRow = String(gi + 2);
      chipsByGroup[gi] = g.map(function (st) {
        var c = mk('div', 'sample t-' + st.type + ' fchip'); c.appendChild(mk('span', 'num', numLabel(st.n)));
        var l = mk('span', 'lbl'); l.appendChild(mk('small', '', st.rl)); putText(l, st.label, st.type); c.appendChild(l);
        cell.appendChild(c); return c;
      });
      grid.appendChild(cell);
    });
    fig.appendChild(grid);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'farrows'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z"/></marker><marker id="ahd" class="mdash" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>';
    fig.appendChild(svg);
    fig._draw = function () {
      Array.prototype.slice.call(svg.querySelectorAll('path.ln')).forEach(function (p) { p.remove(); });
      var o = fig.getBoundingClientRect(); window.__segs = []; window.__chips = [];
      function R(el) { var r = el.getBoundingClientRect(); return { l: r.left - o.left, r: r.right - o.left, t: r.top - o.top, b: r.bottom - o.top, cx: (r.left + r.right) / 2 - o.left, cy: (r.top + r.bottom) / 2 - o.top }; }
      function add(d, dash, segs, tag) { var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('class', 'ln' + (dash ? ' dash' : '')); p.setAttribute('d', d); p.setAttribute('marker-end', dash ? 'url(#ahd)' : 'url(#ah)'); svg.appendChild(p); segs.forEach(function (s) { s.tag = tag; window.__segs.push(s); }); }
      svg.setAttribute('width', o.width); svg.setAttribute('height', o.height);
      var rs = R(start); window.__chips.push({ name: 'start', r: rs });
      chipsByGroup.forEach(function (cs, gi) { cs.forEach(function (c, bi) { window.__chips.push({ name: gi + ':' + bi, r: R(c) }); }); });
      var r0 = R(chipsByGroup[0][0]);
      var y0 = r0.cy; add('M' + rs.r + ',' + y0 + ' H' + (r0.l - 2), false, [{ x1: rs.r, y1: y0, x2: r0.l, y2: y0, from: 'start', to: '0:0' }], 'start');
      function elbow(a, b, aName, bName, dash, tag) {   // a 아래 → 두 칩 사이 틈의 가운데 → b 위. 선은 칩 사이 틈에만 놓여 글자를 지나지 않는다
        var ym = (a.b + b.t) / 2;
        add('M' + a.cx + ',' + a.b + ' V' + ym + ' H' + b.cx + ' V' + (b.t - 2), dash, [
          { x1: a.cx, y1: a.b, x2: a.cx, y2: ym, from: aName, to: bName }, { x1: a.cx, y1: ym, x2: b.cx, y2: ym, from: aName, to: bName }, { x1: b.cx, y1: ym, x2: b.cx, y2: b.t, from: aName, to: bName }], tag);
      }
      for (var gi = 0; gi < chipsByGroup.length; gi++) {
        var cs = chipsByGroup[gi];
        for (var k = 1; k < cs.length; k++) elbow(R(cs[k - 1]), R(cs[k]), gi + ':' + (k - 1), gi + ':' + k, true, 'fallback');   // ⇢대체: 같은 번호의 a→b, 점선
        if (gi > 0) { var pc = chipsByGroup[gi - 1]; elbow(R(pc[pc.length - 1]), R(cs[0]), (gi - 1) + ':' + (pc.length - 1), gi + ':0', false, 'step'); }   // 대체 가지가 있으면 마지막(b)에서 다음 단계로
      }
    };
    requestAnimationFrame(function () { fig._draw(); });
  }
  window.addEventListener('resize', function () { if (tab === 'flow' && fig._draw) fig._draw(); });

  /* ── 서비스 탭: 로그인 줄기 + 기능 → API 묶음 → 저장소 목록 (선 없음, 번호 단계와 목록) ── */
  var SV = data.svc, svView = 'func', svFunc = null, svStore = null, svOpen = {}, svRoot = document.getElementById('v-svc');
  var SVKIND = { user: 't-device', login: 't-need', api: 't-api', ext: 't-external', db: 't-db', gate: 't-need' };
  var TYPE_CLS = { engine: 't-engine', external: 't-external', db: 't-db', cache: 't-cache', file: 't-file' };
  function svPath(el, text, type) { if (type === 'api') { var sp = text.indexOf(' '); var m = mk('span', 'nb mth', text.slice(0, sp)); el.appendChild(m); el.appendChild(document.createTextNode(' ')); putPathNb(el, text.slice(sp + 1)); } else putNameNb(el, text); }
  function nbs(text) { var s = mk('span', 'nb'); s.textContent = text; return s; }
  function putPathNb(el, path) { String(path).split('/').forEach(function (p, i) { if (i === 0) return; if (i > 1) el.appendChild(document.createElement('wbr')); el.appendChild(nbs('/' + p)); }); }
  function putNameNb(el, text) { String(text).split('(').forEach(function (p, i) { if (i > 0) { el.appendChild(document.createElement('wbr')); el.appendChild(nbs('(' + p)); } else el.appendChild(nbs(p)); }); }
  function svChip(cls, label, type, small, tag) {
    var c = mk('span', 'sample ' + cls); var l = mk('span', 'lbl');
    if (small) l.appendChild(mk('small', 'nb', small));
    svPath(l, label, type); if (tag) l.appendChild(mk('small', 'tg nb', tag)); c.appendChild(l); return c;
  }
  function svRel(text) { return mk('span', 'rchip nb', '→ ' + text); }
  function svEv(list) { var s = mk('span', 'ev'); list.forEach(function (x, i) { if (i) s.appendChild(document.createTextNode(' · ')); var p = x.lastIndexOf('/'); var e = mk('span', 'nb'); e.textContent = x; s.appendChild(e); }); return s; }
  function svWriteHash() {
    var h = '#t=svc'; if (svView === 'func' && svFunc) h += '&f=' + encodeURIComponent(svFunc); else if (svView === 'store' && svStore) h += '&s=' + encodeURIComponent(svStore);
    try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
  }
  function svApi(i) { return SV.apis[i]; }
  function svTrunk() {
    var box = mk('div', 'svsec'); box.appendChild(mk('h2', 'svh', '로그인 줄기 — 사용자가 로그인해서 화면에 들어오기까지(순서대로)'));
    SV.trunk.forEach(function (st) {
      var r = mk('div', 'trow'); r.dataset.n = String(st.n); r.appendChild(mk('span', 'num', numLabel(String(st.n))));
      var body = mk('div', 'tbody');
      var chips = mk('div', 'tchips');
      st.items.forEach(function (it) { var g = mk('span', 'tgrp'); g.appendChild(svRel(it.rel)); g.appendChild(svChip(SVKIND[it.kind], it.label, it.kind === 'api' ? 'api' : 'name', it.sub || '', it.tag || '')); chips.appendChild(g); });
      body.appendChild(chips);
      var meta = mk('div', 'tmeta'); meta.appendChild(mk('span', 'tnote', st.note + ' — ')); meta.appendChild(svEv(st.ev)); body.appendChild(meta);
      r.appendChild(body); box.appendChild(r);
    });
    var g = SV.gate; box.appendChild(mk('p', 'svnote', '⑥ 로그인 관문: 거치는 기능 ' + g.screens + '개 · API 묶음 ' + g.groups + '(인증·계정) · API ' + g.apis + '개(GET /api/me) · 저장소 ' + g.stores + '개(users). 홈은 관문 앞(로그인 없이 열림).'));
    return box;
  }
  function svApiList(idxs, tagFn) {
    var ul = mk('ul', 'apilist');
    idxs.forEach(function (x) {
      var i = typeof x === 'number' ? x : x.i, a = svApi(i), li = mk('li', 'apirow');
      var head = mk('span', 'ah'); head.appendChild(svChip('t-api', a.key, 'api', '', typeof x === 'number' ? '' : x.rel)); li.appendChild(head);
      var m = mk('span', 'tmeta'); m.appendChild(mk('span', 'au nb', '인증 ' + a.auth)); m.appendChild(document.createTextNode(' · ')); m.appendChild(svEv([a.def])); li.appendChild(m);
      ul.appendChild(li);
    });
    return ul;
  }
  function svGroupCard(key, name, head, idxs) {
    var card = mk('div', 'gcard' + (svOpen[key] ? ' open' : '')); card.dataset.key = key;
    var b = mk('button', 'item gbtn'); b.type = 'button'; b.setAttribute('aria-expanded', svOpen[key] ? 'true' : 'false');
    var l = mk('span', 'lbl'); l.appendChild(mk('span', 'gname', name)); l.appendChild(mk('small', 'nb', head)); b.appendChild(l);
    var list = svApiList(idxs); list.hidden = !svOpen[key];
    b.addEventListener('click', function () { svOpen[key] = !svOpen[key]; card.classList.toggle('open', !!svOpen[key]); b.setAttribute('aria-expanded', svOpen[key] ? 'true' : 'false'); list.hidden = !svOpen[key]; });
    card.appendChild(b); card.appendChild(list); return card;
  }
  function svStage(n, title) { var s = mk('div', 'stage'); var h = mk('div', 'sth'); h.appendChild(mk('span', 'num', numLabel(String(n)))); h.appendChild(mk('span', 'stt', title)); s.appendChild(h); return s; }
  function svFuncPanel(name) {
    var s = SV.screens.filter(function (x) { return x.name === name; })[0], p = mk('div', 'svpanel'); p.id = 'svpanel';
    p.appendChild(mk('h3', 'svph', s.name + ' — ' + s.group + ' 묶음 · ' + s.file));
    var s1 = svStage(1, s.gated ? '관문 통과' : '로그인 없이 열림 (관문 앞)'), c1 = mk('div', 'chips');
    if (s.gated) { c1.appendChild(svChip('t-need', '로그인 관문', 'name', '통과')); s.requires.forEach(function (q) { c1.appendChild(svChip('t-need', q, 'name', '조건')); }); }
    else { c1.appendChild(svChip('t-todo', '로그인 없이 열림', 'name', '홈은 관문 앞')); c1.appendChild(mk('span', 'tmeta', '로그인은 이 화면에서 시작한다(위 로그인 줄기 ①②)')); }
    s1.appendChild(c1); p.appendChild(s1);
    if (s.name === '홈') {
      var sh = svStage(2, '이동 가능한 화면 ' + s.navigates.length + '개'), ch = mk('div', 'chips'); s.navigates.forEach(function (n) { ch.appendChild(svChip('t-screen', n, 'name')); }); sh.appendChild(ch); p.appendChild(sh);
      p.appendChild(mk('p', 'svnote', '홈은 API 묶음을 직접 부르지 않는다(로그인 시작만 줄기 ③).')); return p;
    }
    if (s.gateOnly) {
      var s2 = svStage(2, '관문(/api/me)만 거침 + 정적 파일 읽기'), c2 = mk('div', 'chips');
      s.fread.forEach(function (f) { c2.appendChild(svChip('t-file', f, 'name', '읽기', '정적 파일')); });
      s2.appendChild(c2); s2.appendChild(mk('p', 'svnote', 'API 묶음을 직접 부르지 않는다. 데이터는 화면이 정적 파일을 직접 읽는다(화면 머리말에서 가져온 연결, api.md 에는 없음).')); p.appendChild(s2); return p;
    }
    var nApi = s.apiGroups.reduce(function (a, g) { return a + g.apis.length; }, 0);
    var s2b = svStage(2, '부르는 API 묶음 ' + s.apiGroups.length + '개 · API ' + nApi + '개 (묶음을 누르면 개별 API)'), gl = mk('div', 'gcards');
    s.apiGroups.forEach(function (g) { gl.appendChild(svGroupCard('f:' + g.group, g.group, '이 기능이 부르는 API ' + g.apis.length + '개 (묶음 전체 ' + g.total + '개)', g.apis)); });
    s2b.appendChild(gl); p.appendChild(s2b);
    var s3 = svStage(3, '닿는 엔진·외부·저장소 ' + s.targets.length + '개'), c3 = mk('div', 'chips');
    s.targets.forEach(function (t) { c3.appendChild(svChip(TYPE_CLS[t.type], t.name, 'name', t.rel, t.src === 'header' ? '화면 머리말' : '')); });
    s3.appendChild(c3); p.appendChild(s3);
    return p;
  }
  function svStorePanel(id) {
    var t = SV.targets.filter(function (x) { return x.id === id; })[0], p = mk('div', 'svpanel'); p.id = 'svpanel';
    p.appendChild(mk('h3', 'svph', t.name));
    var kind = { engine: '엔진', external: '외부', db: 'DB 테이블', cache: '서버 캐시', file: '파일' }[t.type];
    var sum = t.type === 'engine' || t.type === 'external' ? '쓰는 API ' + t.apiN + '개 (호출)' : '읽는 API ' + t.readN + '개 · 쓰는 API ' + t.writeN + '개';
    p.appendChild(mk('p', 'svnote', kind + (t.desc ? ' — ' + t.desc : '') + ' · ' + sum + ' · API 묶음 ' + t.groups.length + '개 · 이어지는 기능 ' + t.callers.length + '개'));
    var s1 = svStage(1, 'API 묶음 ' + t.groups.length + '개 (묶음을 누르면 개별 API, 태그는 이 대상에 닿는 방식)'), gl = mk('div', 'gcards');
    t.groups.forEach(function (g) { gl.appendChild(svGroupCard('s:' + t.id + ':' + g.group, g.group, '이 대상에 닿는 API ' + g.apis.length + '개', g.apis)); });
    if (!t.groups.length) gl.appendChild(mk('p', 'svnote', '묶음 3열에 이 대상에 닿는 API 가 없다.'));
    s1.appendChild(gl);
    if (t.trunk.length) s1.appendChild(mk('p', 'svnote', '로그인 줄기에서: ' + t.trunk.join(', ') + ' (인증·계정 묶음은 줄기에만 둔다)'));
    p.appendChild(s1);
    var s2 = svStage(2, '이 API 를 부르는 기능 ' + t.callers.length + '개'), c2 = mk('div', 'chips');
    t.callers.forEach(function (n) { var b = mk('button', 'item t-screen cbtn'); b.type = 'button'; b.textContent = n; b.addEventListener('click', function () { svView = 'func'; svFunc = n; svStore = null; renderSvc(); }); c2.appendChild(b); });
    if (!t.callers.length && !t.freadScreens.length) c2.appendChild(mk('span', 'tmeta', '(없음)'));
    s2.appendChild(c2);
    if (t.freadScreens.length) { var c3 = mk('div', 'chips'); t.freadScreens.forEach(function (n) { c3.appendChild(svChip('t-screen', n, 'name', '직접 읽음', '화면 머리말')); }); s2.appendChild(mk('p', 'svnote', '화면이 정적 파일을 직접 읽는다(화면 머리말에서 가져온 연결, api.md 에는 없음):')); s2.appendChild(c3); }
    p.appendChild(s2);
    return p;
  }
  function renderSvc() {
    svRoot.textContent = '';
    svRoot.appendChild(svTrunk());
    var sec = mk('div', 'svsec'); sec.appendChild(mk('h2', 'svh', '기능에서 따라가기 / 저장소·엔진·외부에서 거꾸로 보기'));
    var tg = mk('div', 'svtoggle'); [['func', '기능에서'], ['store', '저장소·엔진·외부에서']].forEach(function (v) {
      var b = mk('button', 'item vbtn' + (svView === v[0] ? ' sel' : ''), v[1]); b.type = 'button'; b.dataset.view = v[0]; b.setAttribute('aria-pressed', svView === v[0] ? 'true' : 'false');
      b.addEventListener('click', function () { svView = v[0]; renderSvc(); }); tg.appendChild(b);
    });
    sec.appendChild(tg);
    var pick = mk('div', 'svpick');
    if (svView === 'func') {
      SV.groups.forEach(function (g) {
        var box = mk('div', 'pgrp'); box.appendChild(mk('div', 'glabel', g.name));
        var row = mk('div', 'row'); g.screens.forEach(function (n) {
          var s = SV.screens.filter(function (x) { return x.name === n; })[0]; if (!s) return;
          var b = mk('button', 'item t-screen fbtn' + (svFunc === n ? ' sel' : '')); b.type = 'button'; b.dataset.name = n; b.setAttribute('aria-pressed', svFunc === n ? 'true' : 'false');
          b.appendChild(mk('span', 'nm', n)); b.appendChild(mk('small', 'nb', s.gated ? (s.gateOnly ? '관문만 거침' : 'API 묶음 ' + s.apiGroups.length + '개') : '관문 앞'));
          b.addEventListener('click', function () { svFunc = svFunc === n ? null : n; svOpen = {}; renderSvc(); }); row.appendChild(b);
        });
        box.appendChild(row); pick.appendChild(box);
      });
    } else {
      [['engine', '엔진'], ['external', '외부'], ['db', 'DB'], ['cache', '캐시'], ['file', '파일']].forEach(function (bk) {
        var list = SV.targets.filter(function (t) { return t.type === bk[0]; }); if (!list.length) return;
        var box = mk('div', 'pgrp'); box.appendChild(mk('div', 'glabel', bk[1] + ' (' + list.length + ')'));
        var row = mk('div', 'row'); list.forEach(function (t) {
          var b = mk('button', 'item ' + TYPE_CLS[t.type] + ' sbtn' + (svStore === t.name ? ' sel' : '')); b.type = 'button'; b.dataset.name = t.name; b.setAttribute('aria-pressed', svStore === t.name ? 'true' : 'false');
          var l = mk('span', 'lbl'); putNameNb(l, t.name); l.appendChild(mk('small', 'nb', 'API ' + t.apiN + '개' + (t.freadScreens.length ? ' · 화면 ' + t.freadScreens.length : ''))); b.appendChild(l);
          b.addEventListener('click', function () { svStore = svStore === t.name ? null : t.name; svOpen = {}; renderSvc(); }); row.appendChild(b);
        });
        box.appendChild(row); pick.appendChild(box);
      });
    }
    sec.appendChild(pick);
    var panel = svView === 'func' ? (svFunc ? svFuncPanel(svFunc) : null) : (svStore ? svStorePanel(SV.targets.filter(function (t) { return t.name === svStore; })[0].id) : null);
    sec.appendChild(panel || mk('p', 'svnote', svView === 'func' ? '기능을 고르면 관문 통과 → 부르는 API 묶음 → 엔진·외부·저장소 순서로 나옵니다.' : '저장소·엔진·외부를 고르면 그것을 쓰는 API 묶음과 기능이 나옵니다.'));
    svRoot.appendChild(sec);
    var ft = mk('p', 'foot svfoot'); ft.appendChild(document.createTextNode('데이터 출처: docs/blueprint/api.md(API ' + (SV.stat.apis + 3) + '행) · db.md · LEGEND · 화면 머리말(modules·requires·정적 파일 읽기), 기준 커밋 ' + SV.commit + '. 규칙: requireAuth 가 매 요청마다 하는 users 읽기(api.md 공통 규칙)는 목록에 넣지 않았다. 정적 파일 읽기 ' + SV.freadN + '건은 화면 머리말에서 가져왔고 api.md 에는 없다. 화면 머리말과 api.md 의 접근 차이 경고가 ' + SV.warnN + '건 있다(B-006 에서 정리 예정).'));
    svRoot.appendChild(ft);
    if (tab === 'svc') svWriteHash();
  }
  function svReadHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, '')); if (p.get('t') !== 'svc') return false;
    var f = p.get('f'), s = p.get('s');
    if (f && SV.screens.some(function (x) { return x.name === f; })) { svView = 'func'; svFunc = f; svStore = null; }
    else if (s && SV.targets.some(function (x) { return x.name === s; })) { svView = 'store'; svStore = s; svFunc = null; }
    return true;
  }
  window.__svcTab = { render: function () { renderSvc(); }, func: function (n) { svView = 'func'; svFunc = n; svStore = null; svOpen = {}; renderSvc(); }, store: function (n) { svView = 'store'; svStore = n; svFunc = null; svOpen = {}; renderSvc(); }, data: SV };

  /* ── 탭 ── */
  var tabBtns = document.querySelectorAll('.tabs button');
  function show(t) {
    tab = t;
    Array.prototype.forEach.call(tabBtns, function (b) { b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'); });
    document.getElementById('layout').hidden = (t === 'flow' || t === 'svc');
    document.getElementById('v-tree').hidden = (t !== 'tree');
    document.getElementById('v-conn').hidden = (t !== 'conn');
    document.getElementById('v-flow').hidden = (t !== 'flow');
    document.getElementById('v-svc').hidden = (t !== 'svc');
    document.getElementById('tabnote').textContent = selScreen ? '선택한 화면: ' + byId[selScreen].label : '';
    if (t !== 'svc' && location.hash.indexOf('t=svc') >= 0) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 주소 기억 실패는 무시 */ } }
    if (t === 'svc') { document.getElementById('tabnote').textContent = ''; renderSvc(); return; }
    if (t === 'flow') { renderFlowTab(); return; }
    if (t === 'tree' && selScreen && selected !== selScreen) { var keep = flowPick; select(selScreen); flowPick = keep; applyFlow(); }
    else if (t === 'tree' && !selScreen && selected) select(null);
    else if (t === 'conn' && selScreen && !selected) { var k2 = flowPick; select(selScreen); flowPick = k2; applyFlow(); }
  }
  Array.prototype.forEach.call(tabBtns, function (b) { b.addEventListener('click', function () { show(b.dataset.tab); }); });
  var oldSelect = select;
  select = function (id) { oldSelect(id); document.getElementById('tabnote').textContent = selScreen ? '선택한 화면: ' + byId[selScreen].label : ''; };
  window.__map = { show: show, select: function (id) { select(id); }, selectFlow: function (name) { var c = detail.querySelector('.flow-card[data-flow="' + name + '"]'); if (c) c.click(); }, state: function () { return { tab: tab, selected: selected, selScreen: selScreen, flowPick: flowPick }; }, redraw: function () { if (fig._draw) fig._draw(); } };
  detail.textContent = EMPTY_MSG;
  if (svReadHash()) show('svc');
  window.addEventListener('hashchange', function () { if (svReadHash()) show('svc'); });
})();
</script>
</body>
</html>
`;
}

// ── api.md 대조·생성 구간 (작업B-004) ────────────────────────────────────────
// api.md 의 줄("| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |")을 LEGEND·db.md·코드와 대조한다.
// 오류(생성 중단): 이름·값 표준 밖, 중복, 칸 수, 정의 줄, 코드에 있는 라우트가 api.md 에 없음, api.md 에 있는데 코드에 없음.
// 경고(--warn): 화면이 부르는데 api.md 에 없는 경로, 화면 머리말과 api.md 로 계산한 화면별 접근의 차이, 접근하는 API 가 없는 db.md 항목.
const API_GROUPS = ['인증·계정', '관리자', '사전·단어장', '문장 학습', 'Speak Loop', '스펠링 런 대결', '음성 학습', '개념 지도', '기타'];
const API_BASIS = ['확인함', '추정', '미확인'];
const API_ROW = /^\| ([A-Z]+) (\/\S*) \|/;
const API_WARNS = [];   // { kind: 'noRoute' | 'screenDiff' | 'noApi', text, ... }
const apiKey = (m, p) => m + ' ' + p;

// 코드의 라우트: server.js 와 routes/*.js 의 router|app . get|post|put|patch|delete('경로'
function codeRoutes() {
  const out = new Map();
  const files = ['server.js'].concat(fs.readdirSync(path.join(ROOT, 'routes')).filter(f => f.endsWith('.js')).sort(byCode).map(f => 'routes/' + f));
  const re = /\b(?:router|app)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/;
  for (const f of files) {
    lf(fs.readFileSync(path.join(ROOT, f), 'utf8')).split('\n').forEach((ln, i) => {
      const m = ln.match(re);
      if (!m) return;
      const k = apiKey(m[1].toUpperCase(), m[3]);
      if (!out.has(k)) out.set(k, { file: f, line: i + 1 });
    });
  }
  return out;
}

function loadApi(L, dbItems, screens, errs) {
  const lines = lf(fs.readFileSync(APIDOC, 'utf8')).split('\n');
  const rows = [], byKey = new Map(), noteKeys = [];
  const at = (i, msg) => errs.push('docs/blueprint/api.md:' + (i + 1) + ': ' + msg);
  const fileCache = new Map();
  const fileLines = f => { if (!fileCache.has(f)) fileCache.set(f, fs.existsSync(path.join(ROOT, f)) ? lf(fs.readFileSync(path.join(ROOT, f), 'utf8')).split('\n') : null); return fileCache.get(f); };
  const list = v => (v === '-' ? [] : splitList(v));
  lines.forEach((ln, i) => {
    const nm = ln.match(/^- ([A-Z]+ \/\S*): /);
    if (nm) { noteKeys.push({ key: nm[1], i }); return; }
    const m = ln.match(API_ROW);
    if (!m) return;
    if (!METHODS.includes(m[1])) { at(i, '알 수 없는 METHOD "' + m[1] + '" (허용: ' + METHODS.join('·') + ')'); return; }
    const cells = ln.replace(/^\| /, '').replace(/ \|\s*$/, '').split(' | ').map(x => x.trim());
    const key = apiKey(m[1], m[2]);
    if (cells.length !== 11) { at(i, '칸 수 오류: ' + key + ' 은 11칸이어야 하는데 ' + cells.length + '칸입니다'); return; }
    const [, group, def, auth, rd, wr, eng, ext, fil, scr, basis] = cells;
    if (byKey.has(key)) { at(i, 'API "' + key + '" 가 ' + (byKey.get(key).i + 1) + '줄과 중복됩니다'); return; }
    const row = { key, method: m[1], path: m[2], group, def, auth, reads: list(rd), writes: list(wr), engines: list(eng), externals: list(ext), files: list(fil), screens: list(scr), basis, i };
    byKey.set(key, row); rows.push(row);
    if (!API_GROUPS.includes(group)) at(i, key + ': 묶음 "' + group + '" 은 표준 밖입니다(허용: ' + API_GROUPS.join(', ') + ')');
    if (!(auth === '공개' || auth === '로그인' || auth === '관리자' || /^권한:[A-Za-z0-9_]+$/.test(auth))) at(i, key + ': 인증 "' + auth + '" 이 허용 목록(공개·로그인·관리자·권한:이름)에 없습니다');
    for (const [label, arr] of [['읽기', row.reads], ['쓰기', row.writes]]) for (const it of arr) if (!dbItems.has(it)) at(i, key + ': ' + label + ' "' + it + '" 이 docs/blueprint/db.md 에 없습니다(DB:이름 · 캐시:이름)');
    for (const e of row.engines) if (!L.engines.includes(e)) at(i, key + ': 엔진 "' + e + '" 이 LEGEND 3절 목록에 없습니다');
    for (const x of row.externals) if (!L.externals.includes(x)) at(i, key + ': 외부 "' + x + '" 이 LEGEND 4절 목록에 없습니다');
    for (const f of row.files) if (!L.files.has(f)) at(i, key + ': 파일 "' + f + '" 이 LEGEND 9절 파일 목록에 없습니다');
    for (const s of row.screens) if (s !== '공용' && !L.screens.includes(s)) at(i, key + ': 호출 화면 "' + s + '" 은 LEGEND 5절 화면 이름이 아닙니다(공용 가능)');
    if (!API_BASIS.includes(basis)) at(i, key + ': 근거 "' + basis + '" 은 확인함·추정·미확인 중 하나여야 합니다');
    const dm = def.match(/^(\S+\.js):(\d+)$/);
    if (!dm) at(i, key + ': 정의 "' + def + '" 형식 오류(파일:줄)');
    else {
      const fl = fileLines(dm[1]), n = +dm[2];
      if (!fl) at(i, key + ': 정의 파일 "' + dm[1] + '" 이 없습니다');
      else if (n < 1 || n > fl.length) at(i, key + ': 정의 줄 ' + dm[1] + ':' + n + ' 이 파일 길이(' + fl.length + '줄)를 넘습니다');
      else if (!fl.slice(Math.max(0, n - 4), n + 3).join('\n').includes(row.path)) at(i, key + ': 정의 ' + dm[1] + ':' + n + ' 의 앞뒤 3줄에 경로 "' + row.path + '" 가 없습니다');
    }
  });
  for (const n of noteKeys) if (!byKey.has(n.key)) at(n.i, '행별 비고의 "' + n.key + '" 에 해당하는 API 행이 없습니다');
  if (!rows.length) errs.push('docs/blueprint/api.md:1: API 행이 하나도 없습니다');
  const code = codeRoutes();
  for (const [k, v] of code) if (!byKey.has(k)) errs.push(v.file + ':' + v.line + ': 코드의 라우트 "' + k + '" 가 docs/blueprint/api.md 에 없습니다(api.md 에 한 줄을 추가하세요)');
  for (const r of rows) if (!code.has(r.key)) at(r.i, 'API "' + r.key + '" 가 코드(server.js·routes/*.js)에 없습니다(지워졌거나 이름이 바뀌었는지 확인)');
  return { rows, byKey };
}

// 화면 하나가 부르는 API 행들. 공용 = 머리말 modules 에 authGate.js 가 있는 화면. 호출 화면이 없어도 화면 머리말 calls 에 있으면 그 화면에 붙인다
function apiByScreen(api, screens) {
  const gated = new Set(screens.filter(s => s.modules.some(m => /(^|\/)authGate\.js$/.test(m))).map(s => s.screen));
  const map = new Map(screens.map(s => [s.screen, { rows: new Set(), viaCommonOnly: new Set() }]));
  for (const s of screens) {
    const e = map.get(s.screen);
    for (const r of api.rows) {
      const direct = r.screens.includes(s.screen) || s.calls.includes(r.key);
      const common = r.screens.includes('공용') && gated.has(s.screen);
      if (direct || common) { e.rows.add(r); if (!direct) e.viaCommonOnly.add(r); }
    }
  }
  return map;
}
const apiReadsUsers = r => r.auth !== '공개' || r.reads.includes('DB:users');

function apiWarnings(api, screens, dbItems) {
  // (1) 화면(public·home-wheel/src)이 부르는 /api/·/auth/ 문자열 중 api.md 에 없는 경로
  const paths = api.rows.map(r => r.path);
  const res = paths.map(p => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+') + '$'));
  const walk = (d, o) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, o); } else if (/\.(js|jsx|html)$/.test(e.name) && e.name !== 'sw.js') o.push(p); } return o; };
  const srcs = [].concat(walk(path.join(ROOT, 'public'), []), fs.existsSync(path.join(ROOT, 'home-wheel', 'src')) ? walk(path.join(ROOT, 'home-wheel', 'src'), []) : []);
  let literals = 0;
  for (const f of srcs.sort(byCode)) lf(fs.readFileSync(f, 'utf8')).split('\n').forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    for (const m of ln.matchAll(/(\/(?:api|auth)\/[A-Za-z0-9_\-\/]*)/g)) {
      const lit = m[1].replace(/\/$/, ''); literals++;
      const ok = paths.includes(lit) || res.some(re => re.test(lit)) || paths.some(p => p.startsWith(lit + '/'));
      if (!ok) API_WARNS.push({ kind: 'noRoute', text: rel(f) + ':' + (i + 1) + ' "' + lit + '" 이 api.md 에 없습니다' });
    }
  });
  // (2) 화면 머리말과 api.md 로 계산한 화면별 접근
  const by = apiByScreen(api, screens);
  const engAny = new Set(), extAny = new Set(), fileAny = new Set();
  for (const r of api.rows) { r.engines.forEach(x => engAny.add(x)); r.externals.forEach(x => extAny.add(x)); r.files.forEach(x => fileAny.add('파일:' + x)); }
  const diffs = [];   // { screen, group, item, side }
  for (const s of screens) {
    const e = by.get(s.screen);
    const rows = [...e.rows];
    const d = { reads: new Set(), writes: new Set(), engines: new Set(), externals: new Set() };
    for (const r of rows) {
      if (apiReadsUsers(r)) d.reads.add('DB:users');
      r.reads.forEach(x => d.reads.add(x)); r.writes.forEach(x => d.writes.add(x)); r.files.forEach(x => d.reads.add('파일:' + x));
      if (!e.viaCommonOnly.has(r)) { r.engines.forEach(x => d.engines.add(x)); r.externals.forEach(x => d.externals.add(x)); }
    }
    const cmp = (group, derived, header, scope) => {
      for (const x of derived) if (!header.includes(x)) diffs.push({ screen: s.screen, group, item: x, side: 'api' });
      for (const x of header) if (scope(x) && !derived.has(x)) diffs.push({ screen: s.screen, group, item: x, side: 'header' });
    };
    const store = x => !x.startsWith('기기:') && (!x.startsWith('파일:') || fileAny.has(x));
    cmp('reads', d.reads, s.reads.filter(store), x => true);
    cmp('writes', d.writes, s.writes.filter(store), x => true);
    cmp('engines', d.engines, s.engines, x => engAny.has(x));
    cmp('externals', d.externals, s.externals, x => extAny.has(x));
  }
  diffs.sort((a, b) => byCode(a.group + a.item + a.side + a.screen, b.group + b.item + b.side + b.screen));
  for (const x of diffs) API_WARNS.push({ kind: 'screenDiff', group: x.group, item: x.item, side: x.side, screen: x.screen });
  // (3) 접근하는 API 가 없는 db.md 항목
  const touched = new Set();
  for (const r of api.rows) { r.reads.forEach(x => touched.add(x)); r.writes.forEach(x => touched.add(x)); if (apiReadsUsers(r)) touched.add('DB:users'); }
  for (const k of [...dbItems.keys()].sort(byCode)) if (!touched.has(k)) API_WARNS.push({ kind: 'noApi', text: k + ' (db.md:' + dbItems.get(k).line + ') 를 읽거나 쓰는 API 가 api.md 에 없습니다' });
  return { literals, diffs };
}

function genApiSection(api, dbItems) {
  const rows = api.rows;
  const L = [];
  const cnt = (arr, fn) => { const m = new Map(); for (const x of arr) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
  L.push('> api.md 의 API 행 ' + rows.length + '개에서 만든다. 인증이 공개가 아닌 행은 users 를 읽는 것으로 계산한다(공통 규칙).');
  L.push('');
  L.push('### 묶음별 API 수');
  const g = cnt(rows, r => r.group);
  for (const n of API_GROUPS) L.push('- ' + n + ': ' + (g.get(n) || 0));
  L.push('');
  L.push('### 인증별 API 수');
  const a = cnt(rows, r => r.auth);
  for (const [k, v] of [...a.entries()].sort((x, y) => byCode(x[0], y[0]))) L.push('- ' + k + ': ' + v);
  L.push('');
  L.push('### 테이블별 읽는·쓰는 API 수 ([DB]·[캐시]; users 읽기는 인증이 공개가 아닌 모든 API 포함)');
  for (const [k, v] of [...dbItems.entries()].sort((x, y) => byCode(x[1].name, y[1].name))) {
    const r = rows.filter(x => x.reads.includes(k) || (k === 'DB:users' && apiReadsUsers(x))).length, w = rows.filter(x => x.writes.includes(k)).length;
    L.push('- **[' + v.kind + '] ' + v.name + '** — 읽는 API ' + r + '개 / 쓰는 API ' + w + '개' + (r || w ? '' : ' (접근하는 API 없음)'));
  }
  L.push('');
  const none = rows.filter(r => !r.screens.length);
  L.push('### 호출 화면 없는 API (' + none.length + '개)');
  if (!none.length) L.push('- (없음)');
  for (const r of none) L.push('- ' + r.key + ' (' + r.auth + ')');
  return L.join('\n');
}

// ── map.html "서비스" 탭 데이터 (작업B-005c) ─────────────────────────────────────
// 로그인 줄기(번호 단계 6개)와 기능 → API 묶음 → 엔진·외부·저장소 목록, 그리고 거꾸로 보기(저장소·엔진·외부 → API 묶음·API → 기능).
// 출처는 api.md(파싱 결과), db.md, LEGEND, 화면 머리말 requires·modules·navigates·reads(정적 파일). 선은 그리지 않는다.
// 인증·계정 묶음 3행은 줄기에만 둔다. requireAuth 의 users 읽기(api.md 공통 규칙)는 목록에 넣지 않는다.
const SVC_TRUNK_KEYS = ['GET /auth/google', 'GET /auth/google/callback', 'GET /api/me'];
const SVC_GOOGLE = 'Google 로그인(OAuth)';
const SVC_EVIDENCE = [   // [파일:줄, 그 줄에 있어야 하는 문자열]
  ['home-wheel/src/HomeWheelApp.jsx:86', '/auth/google'], ['home-wheel/src/HomeWheelApp.jsx:212', '/auth/google'], ['routes/auth.js:67', '/auth/google'], ['routes/auth.js:28', 'GoogleStrategy'],
  ['routes/auth.js:72', 'authenticate'], ['routes/auth.js:75', '/auth/google/callback'], ['routes/auth.js:38', 'pool.query'], ['public/js/common/authGate.js:154', '/api/me'],
  ['routes/auth.js:101', '/api/me'], ['middleware/auth.js:30', 'users'],
];
function serviceTabData(L, screens, groups, dbItems, api, warnN) {
  const errs = [];
  const authRows = api.rows.filter(r => r.group === '인증·계정');
  if (authRows.map(r => r.key).join(' | ') !== SVC_TRUNK_KEYS.join(' | ')) errs.push('api.md 인증·계정 행이 줄기 순서(' + SVC_TRUNK_KEYS.join(', ') + ')와 다릅니다: ' + authRows.map(r => r.key).join(', '));
  const rowOf = k => api.rows.find(r => r.key === k);
  const rAuth = rowOf(SVC_TRUNK_KEYS[0]), rCb = rowOf(SVC_TRUNK_KEYS[1]), rMe = rowOf(SVC_TRUNK_KEYS[2]);
  if (!rAuth || !rCb || !rMe) return { errs: errs.concat(['줄기 API 행이 api.md 에 없습니다']) };
  if (!rAuth.externals.includes(SVC_GOOGLE) || !rCb.externals.includes(SVC_GOOGLE)) errs.push('줄기 ③⑤ 행의 외부가 ' + SVC_GOOGLE + ' 이어야 합니다');
  for (const r of [rCb, rMe]) if (!r.reads.includes('DB:users') || !r.writes.includes('DB:users')) errs.push('줄기 ⑤⑥ 행(' + r.key + ')이 users 읽기·쓰기를 가져야 합니다');
  for (const [loc, needle] of SVC_EVIDENCE) {   // 줄기 근거(파일:줄)가 실제 코드와 맞는지
    const [f, n] = [loc.slice(0, loc.lastIndexOf(':')), +loc.slice(loc.lastIndexOf(':') + 1)];
    const p = path.join(ROOT, f);
    const ls = fs.existsSync(p) ? lf(fs.readFileSync(p, 'utf8')).split('\n') : null;
    if (!ls || !(ls[n - 1] || '').includes(needle)) errs.push('줄기 근거 ' + loc + ' 에 "' + needle + '" 가 없습니다');
  }
  const gated = new Set(screens.filter(s => s.modules.some(m => /(^|\/)authGate\.js$/.test(m))).map(s => s.screen));
  // 관문에 연결되는 API: "공용" 행 중 GET /api/me 하나뿐이어야 한다(GET /auth/google 는 로그인 쪽이다). 공용 행은 인증·계정 묶음 안에만 있어야 한다
  const commonRows = api.rows.filter(r => r.screens.includes('공용'));
  commonRows.forEach(r => { if (r.group !== '인증·계정') errs.push('공용 행 ' + r.key + ' 가 인증·계정 묶음 밖에 있습니다'); });
  const gateApis = [rMe];
  if (gateApis.some(r => authRows.slice(0, 2).includes(r))) errs.push('잘못된 연결: 로그인 관문 → ' + SVC_TRUNK_KEYS[0] + ' / callback');
  const NOUN = { engine: '엔진', external: '외부', db: 'DB', cache: '캐시', file: '파일' };
  const apis = api.rows.map((r, i) => ({ i, key: r.key, group: r.group, def: r.def, auth: r.auth, reads: r.reads, writes: r.writes, engines: r.engines, externals: r.externals, files: r.files, screens: r.screens, basis: r.basis, trunk: authRows.includes(r) }));
  const tid = (kind, name) => kind + ':' + name;
  const tlabel = t => t.slice(t.indexOf(':') + 1);
  const dbKind = t => (dbItems.get(t) || { kind: 'DB' }).kind === 'DB' ? 'db' : 'cache';
  // API 마다 닿는 대상(종류별): [{ id, type, name, rel }] rel = 호출 | 읽기 | 쓰기 | 읽기·쓰기
  const touch = a => {
    const m = new Map(), put = (id, type, name, r) => { const o = m.get(id) || { id, type, name, r: {} }; o.r[r] = 1; m.set(id, o); };
    a.engines.forEach(e => put(tid('e', e), 'engine', e, '호출')); a.externals.forEach(x => put(tid('x', x), 'external', x, '호출'));
    a.reads.forEach(t => put(tid(dbKind(t) === 'db' ? 'd' : 'c', tlabel(t)), dbKind(t), tlabel(t), '읽기')); a.writes.forEach(t => put(tid(dbKind(t) === 'db' ? 'd' : 'c', tlabel(t)), dbKind(t), tlabel(t), '쓰기'));
    a.files.forEach(f => put(tid('f', f), 'file', f, '읽기'));
    return [...m.values()].map(o => ({ id: o.id, type: o.type, name: o.name, rel: o.r['읽기'] && o.r['쓰기'] ? '읽기·쓰기' : Object.keys(o.r)[0] }));
  };
  apis.forEach(a => { a.touch = touch(a); });
  // 기능
  const sorted = screens.slice().sort((a, b) => L.screens.indexOf(a.screen) - L.screens.indexOf(b.screen));
  const apiFilesAny = new Set(); api.rows.forEach(r => r.files.forEach(f => apiFilesAny.add(f)));
  const scrOut = sorted.map(s => {
    const g = (groups.find(x => x.screens.includes(s.screen)) || {}).name || '';
    const common = r => r.screens.includes('공용');
    // 이 기능이 직접 부르는 API(관문의 공용 /api/me·/auth/google 는 제외 = 인증·계정 묶음은 줄기에만 둔다)
    const called = apis.filter(a => !a.trunk && a.screens.includes(s.screen));
    const byGroup = new Map(); called.forEach(a => { if (!byGroup.has(a.group)) byGroup.set(a.group, []); byGroup.get(a.group).push(a.i); });
    const tm = new Map();
    called.forEach(a => a.touch.forEach(t => { const o = tm.get(t.id) || { id: t.id, type: t.type, name: t.name, r: {}, src: 'api' }; o.r[t.rel] = 1; if (t.rel === '읽기·쓰기') { o.r['읽기'] = 1; o.r['쓰기'] = 1; } tm.set(t.id, o); }));
    const fread = s.reads.filter(x => x.startsWith('파일:') && !apiFilesAny.has(x.slice(3))).map(x => x.slice(3));
    fread.forEach(n => tm.set('f:' + n, { id: 'f:' + n, type: 'file', name: n, r: { 읽기: 1 }, src: 'header' }));
    const targets = [...tm.values()].map(o => ({ id: o.id, type: o.type, name: o.name, rel: o.r['읽기'] && o.r['쓰기'] ? '읽기·쓰기' : Object.keys(o.r)[0], src: o.src })).sort((a, b) => (['engine', 'external', 'db', 'cache', 'file'].indexOf(a.type) - ['engine', 'external', 'db', 'cache', 'file'].indexOf(b.type)) || byCode(a.name, b.name));
    return { name: s.screen, group: g, file: s.file, gated: gated.has(s.screen), requires: s.requires, navigates: s.navigates, gateOnly: gated.has(s.screen) && !called.length,
      apiGroups: [...byGroup.entries()].map(([gn, idx]) => ({ group: gn, total: gcountOf(gn), apis: idx })), targets, fread };
  });
  function gcountOf(gn) { return api.rows.filter(r => r.group === gn).length; }
  // 거꾸로 보기: 엔진·외부·DB·캐시·파일마다 그것을 쓰는 API(묶음별)와 그 API 를 부르는 기능
  const targetList = [];
  const order = ['engine', 'external', 'db', 'cache', 'file'];
  for (const e of L.engines) targetList.push({ id: 'e:' + e, type: 'engine', name: e });
  for (const x of L.externals) targetList.push({ id: 'x:' + x, type: 'external', name: x });
  for (const [k, v] of [...dbItems.entries()].sort((a, b) => byCode(a[1].name, b[1].name))) targetList.push({ id: (v.kind === 'DB' ? 'd:' : 'c:') + v.name, type: v.kind === 'DB' ? 'db' : 'cache', name: v.name });
  for (const [n] of [...L.files.entries()].sort((a, b) => byCode(a[0], b[0]))) targetList.push({ id: 'f:' + n, type: 'file', name: n });
  const lgd = lf(fs.readFileSync(LEGEND, 'utf8')).split('\n'), engDesc = {};
  lgd.forEach(l => { const m = l.match(/^\| ([^|]+?) \| (.+) \|$/); if (m && L.engines.includes(m[1])) engDesc[m[1]] = m[2]; });
  const dbd = {}; lf(fs.readFileSync(DBDOC, 'utf8')).split('\n').forEach(l => { const m = l.match(/^\| (DB|캐시):([A-Za-z0-9_]+) \| ([^|]+?) \| ([^|]+?) \|/); if (m) dbd[m[2]] = m[3] + ' (' + m[4] + ')'; });
  const callersOf = idxs => { const set = new Set(); idxs.forEach(i => apis[i].screens.forEach(s => { if (s !== '공용') set.add(s); })); return [...set].sort((a, b) => L.screens.indexOf(a) - L.screens.indexOf(b)); };
  targetList.forEach(t => {
    const hits = apis.filter(a => a.touch.some(x => x.id === t.id));
    const byG = new Map(); hits.filter(a => !a.trunk).forEach(a => { if (!byG.has(a.group)) byG.set(a.group, []); byG.get(a.group).push({ i: a.i, rel: a.touch.find(x => x.id === t.id).rel }); });
    t.groups = [...byG.entries()].map(([gn, list]) => ({ group: gn, apis: list }));
    t.trunk = hits.filter(a => a.trunk).map(a => a.key);   // 줄기 안 API(콜백·관문): 목록에는 줄기로만 표시
    const flat = hits.filter(a => !a.trunk);
    t.readN = hits.filter(a => a.touch.find(x => x.id === t.id).rel.includes('읽기')).length;
    t.writeN = hits.filter(a => a.touch.find(x => x.id === t.id).rel.includes('쓰기')).length;
    t.callN = hits.filter(a => a.touch.find(x => x.id === t.id).rel === '호출').length;
    t.apiN = flat.length;
    t.callers = callersOf(flat.map(a => a.i));
    t.freadScreens = scrOut.filter(s => s.fread.includes(t.name) && t.type === 'file').map(s => s.name);
    t.desc = t.type === 'engine' ? (engDesc[t.name] || '') : (dbd[t.name] || '');
  });
  // ── 검사: 묶음 단위 개수를 api.md 에서 따로 센 값과 대조 ──
  const tIds = new Set(targetList.map(t => t.id));
  scrOut.forEach(s => {
    const rows = api.rows.filter(r => r.group !== '인증·계정' && r.screens.includes(s.name));
    const groupsSeen = new Set(rows.map(r => r.group)), stores = new Set(), ee = new Set();
    rows.forEach(r => { r.reads.concat(r.writes).forEach(t => stores.add(t)); r.files.forEach(f => stores.add('파일:' + f)); r.engines.forEach(e => ee.add(e)); r.externals.forEach(x => ee.add(x)); });
    s.fread.forEach(f => stores.add('파일:' + f));
    const mine = s.targets.filter(t => t.type === 'db' || t.type === 'cache' || t.type === 'file').length, mineEE = s.targets.filter(t => t.type === 'engine' || t.type === 'external').length;
    if (s.apiGroups.length !== groupsSeen.size || s.apiGroups.reduce((a, g) => a + g.apis.length, 0) !== rows.length || mine !== stores.size || mineEE !== ee.size)
      errs.push('기능 "' + s.name + '" 의 묶음·API·대상 개수가 api.md 에서 따로 센 값과 다릅니다');
    s.targets.forEach(t => { if (!tIds.has(t.id)) errs.push('기능 "' + s.name + '" 의 대상 ' + t.id + ' 가 LEGEND·db.md 에 없습니다'); });
  });
  targetList.forEach(t => {
    const rows = api.rows.filter(r => r.group !== '인증·계정' && (r.engines.includes(t.name) && t.type === 'engine' || r.externals.includes(t.name) && t.type === 'external' || r.reads.concat(r.writes).some(x => x === (t.type === 'db' ? 'DB:' : '캐시:') + t.name) && (t.type === 'db' || t.type === 'cache') || r.files.includes(t.name) && t.type === 'file'));
    if (t.apiN !== rows.length || t.groups.length !== new Set(rows.map(r => r.group)).size) errs.push('대상 "' + t.name + '" 의 API·묶음 개수가 api.md 에서 따로 센 값과 다릅니다');
  });
  const trunk = [
    { n: 1, items: [{ rel: '시작', kind: 'user', label: '사용자' }], ev: ['home-wheel/src/HomeWheelApp.jsx:86'], note: '홈에서 로그인 전 메뉴를 누르면 로그인으로 보낸다' },
    { n: 2, items: [{ rel: '누름', kind: 'login', label: '로그인(Google OAuth)' }], ev: ['home-wheel/src/HomeWheelApp.jsx:212'], note: '"Google로 로그인" 링크(홈). 사전·스펠링 런에도 같은 로그인 링크가 있다' },
    { n: 3, items: [{ rel: '호출', kind: 'api', label: rAuth.key }, { rel: '나감', kind: 'ext', label: SVC_GOOGLE }], ev: ['routes/auth.js:67', 'routes/auth.js:72'], note: '인증 ' + rAuth.auth },
    { n: 4, items: [{ rel: '인증', kind: 'ext', label: SVC_GOOGLE }], ev: ['routes/auth.js:28'], note: 'Google 이 사용자를 확인하고 콜백 주소로 되돌려 보낸다' },
    { n: 5, items: [{ rel: '돌아옴', kind: 'api', label: rCb.key }, { rel: '저장', kind: 'db', label: 'users', tag: '읽기·쓰기' }], ev: ['routes/auth.js:75', 'routes/auth.js:38'], note: '사용자 행을 만들거나 갱신하고 JWT 를 돌려준다. 차단·미승인이면 토큰 없이 안내만' },
    { n: 6, items: [{ rel: '확인', kind: 'gate', label: '로그인 관문' }, { rel: '읽기·쓰기', kind: 'db', label: 'users', tag: '읽기·쓰기' }], ev: ['public/js/common/authGate.js:154', 'routes/auth.js:101', 'middleware/auth.js:30'], note: 'authGate.js 가 화면을 열 때 ' + rMe.key + ' 를 부른다. 관문을 거치는 기능 ' + gated.size + '개(홈 제외). 서버는 인증이 공개가 아닌 모든 요청마다 users 를 읽는다' },
  ];
  const gateSummary = { screens: gated.size, groups: 1, apis: gateApis.length, stores: new Set(gateApis.flatMap(r => r.reads.concat(r.writes))).size };
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  const freadN = scrOut.reduce((a, s) => a + s.fread.length, 0);
  const stat = { trunk: trunk.length, screens: scrOut.length, groups: API_GROUPS.length - 1, apis: apis.filter(a => !a.trunk).length, targets: targetList.length, freadN, gate: gateSummary, gateOnly: scrOut.filter(s => s.gateOnly).map(s => s.name), screenGroupPairs: scrOut.reduce((a, s) => a + s.apiGroups.length, 0), targetGroupPairs: targetList.reduce((a, t) => a + t.groups.length, 0) };
  return { errs, trunk, gate: gateSummary, screens: scrOut, groups: groups.map(g => ({ name: g.name, screens: g.screens })), apis: apis.map(a => ({ i: a.i, key: a.key, group: a.group, def: a.def, auth: a.auth, trunk: a.trunk })), targets: targetList, commit: hashes.join(', '), warnN, freadN, stat };
}

function main() {
  const errs = [];
  const L = loadLegend();
  const screens = loadScreens(L, errs);
  if (errs.length) { console.error('blueprint:gen 검증 오류 ' + errs.length + '건 — 파일을 쓰지 않고 멈춥니다\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
  const pages = publicPages(L, errs);
  if (errs.length) { console.error('blueprint:gen 검증 오류 ' + errs.length + '건 — 파일을 쓰지 않고 멈춥니다\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
  const groups = loadGroups(L, errs);
  const dbItems = loadDbDoc(screens, errs);
  const api = loadApi(L, dbItems, screens, errs);
  if (errs.length) { console.error('blueprint:gen 검증 오류 ' + errs.length + '건 — 파일을 쓰지 않고 멈춥니다\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
  writeReadme(genSection(screens, pages));
  writeReadme(genDbSection(screens, dbItems), DBDOC);
  writeReadme(genApiSection(api, dbItems), APIDOC);
  const aw = apiWarnings(api, screens, dbItems);
  const stab = serviceTabData(L, screens, groups, dbItems, api, API_WARNS.filter(w => w.kind === 'screenDiff').length);
  if (stab.errs && stab.errs.length) { console.error('blueprint:gen 서비스 탭 데이터 오류:' + String.fromCharCode(10) + stab.errs.map(e => ' - ' + e).join(String.fromCharCode(10))); process.exit(1); }
  const tabStat = stab.stat; delete stab.errs;
  fs.writeFileSync(MAP, mapHtml(Object.assign(mapData(screens, pages, groups, dbItems), { svc: stab })));
  const size = writeBundle(screens);
  console.log('blueprint:gen 완료 — 화면 파일 ' + screens.length + '개, 미작성 ' + pages.filter(p => !screens.some(s => s.file === p.file)).length + '개, _bundle.md ' + size + ' bytes');
  const nFlows = screens.reduce((a, s) => a + s._flows.length, 0), nSteps = screens.reduce((a, s) => a + s._flows.reduce((x, f) => x + f.steps.length, 0), 0);
  const flowOnly = WARNS.filter(w => w.kind === 'flowOnly'), headerOnly = WARNS.filter(w => w.kind === 'headerOnly');
  console.log('흐름: 동작 ' + nFlows + '개, 단계 ' + nSteps + '개 (' + screens.map(s => s.screen + ' ' + s._flows.length).join(', ') + ')');
  console.log('경고(오류 아님): 흐름에만 있는 대상 ' + flowOnly.length + '건, 머리말에만 있고 흐름에 안 나오는 대상 ' + headerOnly.length + '건(그중 기기 저장값 ' + headerOnly.filter(w => w.device).length + '건)');
  console.log('서비스 탭 데이터: 줄기 ' + tabStat.trunk + '단계, 기능 ' + tabStat.screens + '개, API 묶음 ' + tabStat.groups + '개(인증·계정은 줄기에만), API ' + tabStat.apis + '개, 거꾸로 보기 대상 ' + tabStat.targets + '개(엔진 ' + L.engines.length + ', 외부 ' + L.externals.length + ', DB·캐시 ' + dbItems.size + ', 파일 ' + L.files.size + '); 기능→묶음 ' + tabStat.screenGroupPairs + '쌍, 대상→묶음 ' + tabStat.targetGroupPairs + '쌍, 정적 파일 읽기 ' + tabStat.freadN + '건; 관문 통과 기능 ' + tabStat.gate.screens + '개, 관문만 거치는 기능 ' + tabStat.gateOnly.join('·'));
  const apiN = k => API_WARNS.filter(w => w.kind === k).length;
  console.log('api.md: API ' + api.rows.length + '개. 경고(오류 아님): 화면이 부르는데 api.md 에 없는 경로 ' + apiN('noRoute') + '건(검사한 문자열 ' + aw.literals + '개), 화면 머리말과 api.md 의 접근 차이 ' + apiN('screenDiff') + '건, 접근하는 API 가 없는 db.md 항목 ' + apiN('noApi') + '건');
  if (process.argv.includes('--warn')) for (const w of WARNS) console.log(' - [' + (w.kind === 'flowOnly' ? '흐름에만' : '머리말에만') + '] ' + w.screen + ': ' + w.text);
  if (process.argv.includes('--warn')) for (const w of API_WARNS) console.log(' - [api.md 경고: ' + (w.kind === 'noRoute' ? '화면에만 있는 경로' : w.kind === 'noApi' ? '접근하는 API 없음' : w.side === 'api' ? 'api.md 에만 있음' : '머리말에만 있음') + '] ' + (w.kind === 'screenDiff' ? w.screen + ': ' + w.group + ' ' + w.item : w.text));
}
main();
