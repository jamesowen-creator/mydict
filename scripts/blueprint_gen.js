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
const BOARD = path.join(DIR, 'board.html');
const BUNDLE = path.join(DIR, '_bundle.md');
const DBDOC = path.join(DIR, 'db.md');
const DBJS = path.join(ROOT, 'lib', 'db.js');

const KEYS = ['screen', 'file', 'engines', 'calls', 'reads', 'writes', 'fallback', 'flows', 'requires', 'navigates', 'externals', 'modules', 'last_checked'];
const LIST_KEYS = ['engines', 'calls', 'reads', 'writes', 'fallback', 'flows', 'requires', 'navigates', 'externals', 'modules'];
const STORE_PREFIX = ['DB', '캐시', '기기'];
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
  return { engines, externals, screens };
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
        if (f.item) { step = { type: f.item.prefix === 'DB' ? 'db' : f.item.prefix === '캐시' ? 'cache' : 'device', label: f.item.name, store: f.item }; res.used[key].add(f.item.raw); }
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
  const unused = (group, list, usedSet) => { for (const it of list) if (!usedSet.has(it)) res.warns.push({ kind: 'headerOnly', group, device: group !== 'calls' && it.startsWith('기기:'), text: group + ' ' + it }); };
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
  const files = [README, LEGEND, DBDOC].concat(fs.readdirSync(SCREENS).filter(f => f.endsWith('.md')).sort(byCode).map(f => path.join(SCREENS, f)));
  const hashes = [...new Set(screens.map(s => s.last_checked))].sort(byCode);
  const out = [];
  out.push('# METIS-3 도면 묶음 (_bundle.md)');
  out.push('');
  out.push('이 파일은 `npm run blueprint:gen` 이 만든다(직접 고치지 않는다). 용도: 이 한 파일을 웹 Claude 에 첨부해 프로젝트 문서로 복사한다.');
  out.push('순서: README → LEGEND → db → screens(파일 이름 순). 기준 커밋(화면 파일의 last_checked): ' + (hashes.join(', ') || '(없음)'));
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
    if (it.startsWith('기기:')) continue;
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
      if (p === '기기') continue;
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
</style>
</head>
<body>
<div class="wrap">
<h1>METIS-3 도면</h1>
<p class="hint">탭 3개: 계층(화면을 묶음별로) · 흐름(동작 하나를 경로·엔진·저장소까지) · 연결(부품을 쓰는 화면). 탭을 바꿔도 고른 화면은 유지됩니다. 항목을 누르면 연결된 항목이 강조되고 나머지는 흐려지며, 같은 항목을 다시 누르면 해제됩니다. 화면을 누르면 동작별 흐름이 오른쪽 상세 상자에 나오고, 동작 카드를 누르면 연결 보기 목록에 순서 번호가 붙습니다. (PC 화면 기준)</p>
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

  /* ── 탭 ── */
  var tabBtns = document.querySelectorAll('.tabs button');
  function show(t) {
    tab = t;
    Array.prototype.forEach.call(tabBtns, function (b) { b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'); });
    document.getElementById('layout').hidden = (t === 'flow');
    document.getElementById('v-tree').hidden = (t !== 'tree');
    document.getElementById('v-conn').hidden = (t !== 'conn');
    document.getElementById('v-flow').hidden = (t !== 'flow');
    document.getElementById('tabnote').textContent = selScreen ? '선택한 화면: ' + byId[selScreen].label : '';
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
})();
</script>
</body>
</html>
`;
}

// ── board.html (화면 하나를 한 장에 그리는 확대·이동 도면판) ─────────────────────
// mapData() 의 화면 노드(label·group·file·flows[동작 → 단계 {n, rel, rl, type, label}])를 그대로 쓴다. map.html 생성 코드는 건드리지 않는다.
function boardData(data) {
  return { screens: data.nodes.filter(n => n.type === 'screen').map(n => ({ label: n.label, group: n.group, file: n.file, flows: (n.flows || []).map(f => ({ name: f.name, steps: f.steps.map(s => ({ n: s.n, rel: s.rel, rl: s.rl, type: s.type, label: s.label })) })) })), groups: data.groups, commit: data.commit };
}
function boardHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>METIS-3 화면 도면판</title>
<style>
:root { --bg:#fafaf9; --card:#ffffff; --text:#1a1a1a; --sub:#555b66; --line:#c9c9c2; --sel:#b8442e; --selbg:#fdf0ec; --rel:#2f7d57; --relbg:#eaf4ee; --c-screen:#2b5d9b; --c-engine:#7a3fa0; --c-store:#9a6b00; --c-external:#555b66; --c-module:#2f7d57; --c-api:#555b66; --c-device:#7a5a3a; --c-need:#b8442e; }
@media (prefers-color-scheme: dark) { :root { --bg:#17181a; --card:#212326; --text:#f1f1ee; --sub:#a9adb5; --line:#43464b; --sel:#ff8c73; --selbg:#3a2520; --rel:#5fc08e; --relbg:#1d3327; --c-screen:#7fb0ee; --c-engine:#c79af0; --c-store:#e0b050; --c-external:#a9adb5; --c-module:#6fcf9b; --c-api:#a9adb5; --c-device:#d3a97a; --c-need:#ff8c73; } }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif; overflow-x: hidden; }
.top { padding: 10px 16px 8px; }
.top h1 { font-size: 18px; margin: 0; display: inline-block; }
.top .use { font-size: 14px; color: var(--sub); margin-left: 12px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 6px; }
.grp { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.grp .gl { font-size: 14px; font-weight: 700; color: var(--sub); }
button { font: inherit; }
.sbtn, .zbtn { min-height: 34px; padding: 3px 12px; border: 1.5px solid var(--c-screen); border-radius: 12px; background: var(--card); color: var(--text); font-size: 15px; cursor: pointer; word-break: keep-all; }
.sbtn[aria-pressed="true"] { border-color: var(--sel); background: var(--selbg); font-weight: 700; }
.zbtn { border-color: var(--line); border-radius: 8px; min-width: 38px; }
.zbtn:hover, .sbtn:hover { background: var(--selbg); }
.zoomv { font-size: 14px; color: var(--sub); min-width: 4.5em; }
.leg { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 6px; font-size: 14px; color: var(--sub); }
.leg .s { --bc: var(--kc, var(--line)); --bg2: var(--card); position: relative; display: inline-block; padding: 1px 12px; border: 1.5px solid var(--bc); background: var(--bg2); color: var(--text); font-size: 14px; line-height: 1.4; }
.leg .s.t-db, .leg .s.t-cache { padding-top: 11px; }
.leg .s.t-engine { padding: 1px 20px; border: 0; background: var(--bc); }
.leg .s.t-engine { isolation: isolate; }
.leg .s.t-engine::before { z-index: -1; }
.status { margin-top: 6px; font-size: 15px; font-weight: 700; min-height: 1.5em; color: var(--sel); }
#vp { position: relative; overflow: hidden; margin: 0 16px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); cursor: grab; touch-action: none; user-select: none; }
#vp.drag { cursor: grabbing; }
#world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
#lines { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.hd { position: absolute; top: 10px; font-size: 14px; font-weight: 700; color: var(--sub); text-align: center; padding-bottom: 4px; border-bottom: 1.5px solid var(--line); }
.col { position: absolute; display: flex; flex-direction: column; gap: 38px; }
.card, .chip { --bc: var(--kc, var(--line)); --bg2: var(--card); position: relative; display: block; width: 100%; text-align: left; margin: 0; padding: 8px 12px; border: 1.5px solid var(--bc); background: var(--bg2); color: var(--text); font: inherit; font-size: 15px; line-height: 1.35; overflow-wrap: break-word; word-break: keep-all; cursor: pointer; z-index: 1; }
.card { --kc: var(--c-screen); border-radius: 12px; }
.card .nm { display: block; font-weight: 700; }
.card small, .chip small { display: block; font-size: 14px; color: var(--sub); }
.t-need { --kc: var(--c-need); border-radius: 999px; border-style: dashed; padding: 6px 18px; }
.t-api { --kc: var(--c-api); border-radius: 4px; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
.t-module { --kc: var(--c-module); border-radius: 0; }
.t-external { --kc: var(--c-external); border-radius: 4px; border-style: dashed; }
.t-device { --kc: var(--c-device); border-radius: 999px; border-style: dotted; padding: 6px 18px; }
.t-screen.chip { --kc: var(--c-screen); border-radius: 12px; }
.t-db, .t-cache { --kc: var(--c-store); border-radius: 14px / 10px; padding-top: 18px; }
.t-db::before, .t-cache::before { content: ""; position: absolute; left: -1.5px; right: -1.5px; top: 0; height: 14px; border: 1.5px solid var(--bc); border-radius: 50%; background: var(--bg2); }
.t-cache::before { border-style: dashed; }
.t-engine { --kc: var(--c-engine); border: 0; background: var(--bc); padding: 8px 28px; clip-path: polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%); }
.t-engine::before { content: ""; position: absolute; inset: 2px; background: var(--bg2); clip-path: polygon(15px 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 15px 100%, 0 50%); }
.chip .in { position: relative; display: flex; align-items: flex-start; gap: 8px; }
.chip .in .tx { min-width: 0; flex: 1; }
.bdgs { display: none; flex: none; gap: 3px; flex-wrap: wrap; max-width: 90px; }
.chip.has-b .bdgs { display: flex; }
.num { display: inline-block; min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px; background: var(--sel); color: #fff; font-size: 14px; font-weight: 700; line-height: 24px; text-align: center; white-space: nowrap; }
.dimmed { opacity: .35; }
.card.on, .chip.on { --bc: var(--sel); --bg2: var(--selbg); }
.chip.rel { --bc: var(--rel); --bg2: var(--relbg); }
.ln { fill: none; stroke: var(--sub); stroke-width: 1.8; opacity: .25; }
.ln.dash { stroke-dasharray: 7 6; }
.ln.on { stroke: var(--sel); stroke-width: 2.6; opacity: 1; }
.ln.off { opacity: .1; }
marker path { fill: var(--sub); }
marker.mo path { fill: var(--sel); }
.empty { position: absolute; left: 20px; top: 60px; color: var(--sub); }
</style>
</head>
<body>
<div class="top">
  <h1>METIS-3 화면 도면판</h1><span class="use">휠: 확대·축소 · 빈 곳을 끌어 이동 · 동작 카드나 부품 칸을 누르면 그 흐름만 진하게(빈 곳을 누르면 해제)</span>
  <div class="bar">
    <span id="sbar" class="bar" style="margin:0"></span>
    <span class="grp"><button class="zbtn" id="zin" type="button" aria-label="확대">＋</button><button class="zbtn" id="zout" type="button" aria-label="축소">－</button><button class="zbtn" id="zfit" type="button">전체 맞춤</button><button class="zbtn" id="z100" type="button">100%</button><span class="zoomv" id="zv"></span></span>
  </div>
  <div class="leg"><span class="s t-screen" style="--kc:var(--c-screen);border-radius:12px">화면</span><span class="s t-engine" style="--kc:var(--c-engine)">엔진</span><span class="s t-db" style="--kc:var(--c-store);border-radius:14px/10px">DB</span><span class="s t-cache" style="--kc:var(--c-store);border-radius:14px/10px">캐시</span><span class="s" style="--kc:var(--c-device);border-radius:999px;border-style:dotted">기기</span><span class="s" style="--kc:var(--c-api);border-radius:4px">API</span><span class="s" style="--kc:var(--c-external);border-radius:4px;border-style:dashed">외부</span><span class="s" style="--kc:var(--c-module)">모듈</span><span class="s" style="--kc:var(--c-need);border-radius:999px;border-style:dashed">필요</span><span>점선 화살표 = ⇢대체(3a→3b) · 번호 ①②③ = 단계 순서</span></div>
  <div class="status" id="status" aria-live="polite"></div>
</div>
<div id="vp"><div id="world"></div></div>
<script id="data" type="application/json">${json}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('data').textContent);
  var screens = D.screens, groups = D.groups, byName = {};
  screens.forEach(function (s) { byName[s.label] = s; });
  var RELW = { call: '호출', read: '읽기', write: '쓰기', move: '이동', need: '필요', fallback: '대체' };
  var COLOF = { need: 1, api: 1, engine: 2, module: 2, db: 3, cache: 3, device: 3, external: 3, screen: 3 };
  var CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  var HEADS = ['화면 · 동작', '경로 (필요 · API)', '엔진 · 모듈', '저장소 · 외부'];
  var CW = [270, 310, 330, 330], GUT = 150, PAD = 24, RM = 80, TOP = 50;
  var colX = [], x0 = PAD; CW.forEach(function (w, c) { colX[c] = x0; x0 += w + GUT; });
  var WORLD_W = colX[3] + CW[3] + RM;
  var vp = document.getElementById('vp'), world = document.getElementById('world'), statusEl = document.getElementById('status'), zv = document.getElementById('zv');
  var k = 1, tx = 0, ty = 0, WORLD_H = 0, MINK = 0.25, MAXK = 3;
  var cur = null, B = null;   // cur: 화면 이름, B: 현재 도면판 구조 { cards, chips, paths, flows }
  var sel = null;             // { t: 'flow', fi } | { t: 'chip', key }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function numLabel(n) { var d = parseInt(n, 10), rest = String(n).replace(/^\\d+/, ''); return (CIRC[d - 1] || String(d)) + rest; }
  function putText(el, text, type) {   // API·파일 경로는 슬래시 뒤에서만, 그 밖의 이름은 여는 괄호 뒤에서만 줄바꿈한다
    var sep = (type === 'api' || type === 'module') ? '/' : '(';
    String(text).split(sep).forEach(function (part, i) { if (i > 0) { el.appendChild(document.createTextNode(sep)); el.appendChild(document.createElement('wbr')); } el.appendChild(document.createTextNode(part)); });
  }
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }

  /* ── 선택 영역 ── */
  var sbar = document.getElementById('sbar'), sbtns = {};
  groups.forEach(function (g) {
    var s = mk('span', 'grp'); s.appendChild(mk('span', 'gl', g.name));
    g.screens.forEach(function (n) { if (!byName[n]) return; var b = mk('button', 'sbtn', n); b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', function () { openScreen(n, true); }); sbtns[n] = b; s.appendChild(b); });
    sbar.appendChild(s);
  });

  /* ── 도면판 구성 ── */
  function chipKey(st) { return st.type + ':' + st.label; }
  function build(name) {
    var sc = byName[name]; world.textContent = '';
    B = { cards: [], chips: {}, order: [], paths: [], flows: sc.flows, segs: [], cols: [] };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('id', 'lines'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z"/></marker><marker id="aho" class="mo" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>';
    world.appendChild(svg);
    HEADS.forEach(function (h, c) { var e = mk('div', 'hd', h); e.style.left = colX[c] + 'px'; e.style.width = CW[c] + 'px'; world.appendChild(e); });
    var cols = [0, 1, 2, 3].map(function (c) { var d = mk('div', 'col'); d.style.left = colX[c] + 'px'; d.style.top = TOP + 'px'; d.style.width = CW[c] + 'px'; world.appendChild(d); return d; });
    B.cols = cols;
    sc.flows.forEach(function (f, fi) {
      var c = mk('button', 'card'); c.type = 'button'; c.dataset.fi = String(fi);
      c.appendChild(mk('span', 'nm', f.name)); c.appendChild(mk('small', '', f.steps.length + '단계'));
      c.addEventListener('click', function (e) { e.stopPropagation(); pick(sel && sel.t === 'flow' && sel.fi === fi ? null : { t: 'flow', fi: fi }); });
      cols[0].appendChild(c); B.cards.push(c);
    });
    // 칸: 같은 대상은 한 번만. 순서는 동작 순서·단계 순서로 처음 나온 위치
    sc.flows.forEach(function (f, fi) {
      f.steps.forEach(function (st) {
        var key = chipKey(st), ch = B.chips[key];
        if (!ch) {
          var el = mk('div', 'chip t-' + st.type); el.tabIndex = 0; el.setAttribute('role', 'button'); el.dataset.key = key;
          var inn = mk('div', 'in'); inn.appendChild(mk('span', 'bdgs')); var tx = mk('div', 'tx'); var lb = mk('span', 'lbl'); putText(lb, st.label, st.type); tx.appendChild(lb);
          var sm = mk('small', 'rl'); tx.appendChild(sm); inn.appendChild(tx); el.appendChild(inn);
          el.addEventListener('click', function (e) { e.stopPropagation(); pick(sel && sel.t === 'chip' && sel.key === key ? null : { t: 'chip', key: key }); });
          cols[COLOF[st.type]].appendChild(el);
          ch = B.chips[key] = { el: el, key: key, type: st.type, label: st.label, col: COLOF[st.type], rels: [], flows: {}, small: sm, bdgs: inn.firstChild };
          B.order.push(key);
        }
        if (ch.rels.indexOf(RELW[st.rel]) < 0) ch.rels.push(RELW[st.rel]);
        ch.flows[fi] = 1;
      });
    });
    B.order.forEach(function (key) { var ch = B.chips[key]; ch.small.textContent = ch.rels.join('·'); });
    // 선: 동작 카드 → 첫 단계 → 다음 단계. 대체 가지(3a→3b)는 점선. 같은 (출발, 도착) 선은 한 줄로 합치고 어느 동작의 몇 번째 단계인지 기록한다
    var emap = {};
    function addEdge(from, to, dashed, fi, n) { var id = from + '>' + to + '>' + (dashed ? 'd' : 's'); var e = emap[id]; if (!e) { e = emap[id] = { id: id, from: from, to: to, dashed: dashed, occ: [] }; B.paths.push(e); } e.occ.push({ fi: fi, n: n }); }
    sc.flows.forEach(function (f, fi) {
      var gs = []; f.steps.forEach(function (st) { var gi = parseInt(st.n, 10) - 1; (gs[gi] = gs[gi] || []).push(st); });
      var prev = 'a:' + fi;
      gs.forEach(function (g) {
        g.forEach(function (st, bi) { if (bi === 0) addEdge(prev, chipKey(st), false, fi, st.n); else addEdge(chipKey(g[bi - 1]), chipKey(st), true, fi, st.n); });
        prev = chipKey(g[g.length - 1]);
      });
    });
    var c0 = cols.map(function (c) { return c; });
    requestAnimationFrame(function () { layoutLines(); });
    layoutLines();
    apply();
  }
  function rectOf(el) {   // 도면판 좌표(배율 1 기준) 안의 위치
    var r = el.getBoundingClientRect(), w = world.getBoundingClientRect();
    return { l: (r.left - w.left) / k, r: (r.right - w.left) / k, t: (r.top - w.top) / k, b: (r.bottom - w.top) / k, cy: ((r.top + r.bottom) / 2 - w.top) / k };
  }
  function layoutLines() {
    if (!B) return;
    var svg = document.getElementById('lines');
    Array.prototype.slice.call(svg.querySelectorAll('path.ln')).forEach(function (p) { p.remove(); });
    var R = {}, colChips = [[], [], [], []];
    B.cards.forEach(function (c, fi) { R['a:' + fi] = rectOf(c); R['a:' + fi].col = 0; colChips[0].push(R['a:' + fi]); });
    B.order.forEach(function (key) { var ch = B.chips[key]; R[key] = rectOf(ch.el); R[key].col = ch.col; colChips[ch.col].push(R[key]); });
    colChips.forEach(function (l) { l.sort(function (a, b) { return a.t - b.t; }); });
    var maxB = 0; Object.keys(R).forEach(function (k2) { maxB = Math.max(maxB, R[k2].b); });
    WORLD_H = maxB + 40;
    world.style.width = WORLD_W + 'px'; world.style.height = WORLD_H + 'px';
    svg.setAttribute('width', WORLD_W); svg.setAttribute('height', WORLD_H);
    function gapY(c, desired) {   // 열 c 안에서 칸과 칸 사이(또는 맨 위·맨 아래) 중 desired 에 가장 가까운 높이
      var l = colChips[c]; if (!l.length) return desired;
      var cand = [l[0].t - 16];
      for (var i = 0; i < l.length - 1; i++) cand.push((l[i].b + l[i + 1].t) / 2);
      cand.push(l[l.length - 1].b + 16);
      var best = cand[0]; cand.forEach(function (y) { if (Math.abs(y - desired) < Math.abs(best - desired)) best = y; });
      return best;
    }
    function gx(c, off) { return colX[c] + CW[c] + GUT / 2 + off; }   // 열 c 오른쪽 틈의 세로 길
    B.segs = [];
    B.paths.forEach(function (e) {
      var A = R[e.from], T = R[e.to]; if (!A || !T) return;
      var off = ((hash(e.id) % 9) - 4) * 9, pts = [], ca = A.col, cb = T.col;
      if (e.from === e.to) {
        pts = [[A.r, A.cy - 9], [A.r + 28, A.cy - 9], [A.r + 28, A.cy + 9], [A.r, A.cy + 9]];
      } else if (cb > ca) {
        pts.push([A.r, A.cy]); var y = A.cy;
        for (var c = ca; c < cb; c++) {
          var lane = gx(c, off), nx = c + 1, yn = (nx === cb) ? T.cy : gapY(nx, T.cy);
          pts.push([lane, y]); pts.push([lane, yn]);
          if (nx === cb) pts.push([T.l, T.cy]); else { pts.push([colX[nx] + CW[nx], yn]); }
          y = yn;
        }
      } else if (cb < ca) {
        pts.push([A.l, A.cy]); var y2 = A.cy;
        for (var c2 = ca; c2 > cb; c2--) {
          var lane2 = gx(c2 - 1, off), nx2 = c2 - 1, yn2 = (nx2 === cb) ? T.cy : gapY(nx2, T.cy);
          pts.push([lane2, y2]); pts.push([lane2, yn2]);
          if (nx2 === cb) pts.push([T.r, T.cy]); else pts.push([colX[nx2], yn2]);
          y2 = yn2;
        }
      } else {
        var ln = gx(ca, off); pts = [[A.r, A.cy], [ln, A.cy], [ln, T.cy], [T.r, T.cy]];
      }
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); p.setAttribute('class', 'ln' + (e.dashed ? ' dash' : '')); p.setAttribute('marker-end', 'url(#ah)');
      svg.appendChild(p); e.el = p;
      for (var i = 1; i < pts.length; i++) B.segs.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], from: e.from, to: e.to, id: e.id });
    });
    B.R = R; apply();
  }

  /* ── 선택 표시 ── */
  function pick(s) { sel = s; apply(); writeHash(); }
  function apply() {
    if (!B) return;
    var fi = sel && sel.t === 'flow' ? sel.fi : -1, key = sel && sel.t === 'chip' ? sel.key : null;
    var flowKeys = {}, flowSteps = null;
    B.order.forEach(function (kk) { var ch = B.chips[kk]; ch.el.classList.remove('on', 'rel', 'dimmed', 'has-b'); ch.bdgs.textContent = ''; });
    B.cards.forEach(function (c) { c.classList.remove('on', 'dimmed'); });
    var touchFlows = {}, relKeys = {};
    if (fi >= 0) {
      var f = B.flows[fi];
      f.steps.forEach(function (st) { var ch = B.chips[chipKey(st)]; flowKeys[ch.key] = 1; ch.el.classList.add('has-b'); ch.bdgs.appendChild(mk('span', 'num', numLabel(st.n))); });
      statusEl.textContent = '선택: ' + f.name + ' — ' + f.steps.length + '단계';
    } else if (key) {
      Object.keys(B.chips[key].flows).forEach(function (x) { touchFlows[x] = 1; });
      statusEl.textContent = '선택: ' + B.chips[key].label + ' — 동작 ' + Object.keys(touchFlows).length + '개가 지나감';
    } else statusEl.textContent = '선택 없음 — 동작 카드나 부품 칸을 누르세요';
    B.cards.forEach(function (c, i) { if (fi >= 0) { c.classList.toggle('on', i === fi); c.classList.toggle('dimmed', i !== fi); } else if (key) { c.classList.toggle('on', !!touchFlows[i]); c.classList.toggle('dimmed', !touchFlows[i]); } });
    B.paths.forEach(function (e) {
      if (!e.el) return;
      var on = false;
      if (fi >= 0) on = e.occ.some(function (o) { return o.fi === fi; });
      else if (key) { on = (e.from === key || e.to === key); if (on) { relKeys[e.from] = 1; relKeys[e.to] = 1; } }
      e.el.classList.toggle('on', on); e.el.classList.toggle('off', (fi >= 0 || !!key) && !on);
      e.el.setAttribute('marker-end', on ? 'url(#aho)' : 'url(#ah)');
      if (on) e.el.parentNode.appendChild(e.el);   // 진한 선을 위로
    });
    B.order.forEach(function (kk) {
      var ch = B.chips[kk];
      if (fi >= 0) { if (flowKeys[kk]) ch.el.classList.add('on'); else ch.el.classList.add('dimmed'); }
      else if (key) { if (kk === key) ch.el.classList.add('on'); else if (relKeys[kk]) ch.el.classList.add('rel'); else ch.el.classList.add('dimmed'); }
    });
    layoutBadges();
  }
  function layoutBadges() { /* 배지는 칸 안에 들어가 칸 높이가 바뀔 수 있어, 바뀌면 선을 다시 그린다 */
    if (!B) return; var h = 0; B.order.forEach(function (kk) { h += B.chips[kk].el.offsetHeight; }); if (B._h !== h) { B._h = h; layoutLines(); }
  }

  /* ── 확대·이동 ── */
  function setT() { world.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + k.toFixed(4) + ')'; zv.textContent = Math.round(k * 100) + '%'; }
  function clamp(v) { return Math.max(MINK, Math.min(MAXK, v)); }
  function zoomAt(mx, my, nk) { nk = clamp(nk); tx = mx - (mx - tx) * nk / k; ty = my - (my - ty) * nk / k; k = nk; setT(); }
  function fit() {
    var w = vp.clientWidth, h = vp.clientHeight, m = 16;
    var fk = clamp(Math.min((w - 2 * m) / WORLD_W, (h - 2 * m) / WORLD_H));
    k = fk; tx = (w - WORLD_W * k) / 2; ty = Math.max(m, (h - WORLD_H * k) / 2); setT();
  }
  function sizeVp() { var r = vp.getBoundingClientRect(); vp.style.height = Math.max(320, window.innerHeight - r.top - 14) + 'px'; }
  vp.addEventListener('wheel', function (e) { e.preventDefault(); var r = vp.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, k * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  document.getElementById('zin').addEventListener('click', function () { zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, k * 1.25); });
  document.getElementById('zout').addEventListener('click', function () { zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, k / 1.25); });
  document.getElementById('zfit').addEventListener('click', fit);
  document.getElementById('z100').addEventListener('click', function () { zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1); });
  var drag = null;
  vp.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || e.target.closest('.chip,.card')) return;
    drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty, moved: false }; vp.classList.add('drag');
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    tx = drag.tx + dx; ty = drag.ty + dy; setT();
  });
  window.addEventListener('mouseup', function () { if (!drag) return; var m = drag.moved; drag = null; vp.classList.remove('drag'); if (!m && sel) pick(null); });
  window.addEventListener('resize', function () { sizeVp(); });

  /* ── 주소(#) ── */
  function writeHash() {
    var h = '#s=' + encodeURIComponent(cur);
    if (sel && sel.t === 'flow') h += '&f=' + encodeURIComponent(B.flows[sel.fi].name);
    else if (sel && sel.t === 'chip') h += '&p=' + encodeURIComponent(sel.key);
    try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { s: p.get('s'), f: p.get('f'), p: p.get('p') };
  }
  function openScreen(name, fromUser, preset) {
    cur = name; sel = null;
    Object.keys(sbtns).forEach(function (n) { sbtns[n].setAttribute('aria-pressed', n === name ? 'true' : 'false'); });
    build(name); sizeVp(); layoutLines(); fit();
    if (preset) {
      if (preset.f) { for (var i = 0; i < B.flows.length; i++) if (B.flows[i].name === preset.f) sel = { t: 'flow', fi: i }; }
      else if (preset.p && B.chips[preset.p]) sel = { t: 'chip', key: preset.p };
      apply();
    }
    writeHash();
  }
  window.addEventListener('hashchange', function () { var h = readHash(); if (h.s && byName[h.s]) openScreen(h.s, false, h); });
  window.__board = {
    open: function (n) { openScreen(n, true); },
    pickFlow: function (i) { pick(i == null ? null : { t: 'flow', fi: i }); },
    pickChip: function (key) { pick(key ? { t: 'chip', key: key } : null); },
    state: function () { return { screen: cur, sel: sel, k: k, tx: tx, ty: ty, worldW: WORLD_W, worldH: WORLD_H, minK: MINK, maxK: MAXK }; },
    data: function () { return B; },
    fit: fit
  };
  var h0 = readHash();
  var first = (h0.s && byName[h0.s]) ? h0.s : screens[0].label;
  document.fonts && document.fonts.ready ? document.fonts.ready.then(function () { openScreen(first, false, h0.s ? h0 : null); }) : openScreen(first, false, h0.s ? h0 : null);
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
  const groups = loadGroups(L, errs);
  const dbItems = loadDbDoc(screens, errs);
  if (errs.length) { console.error('blueprint:gen 검증 오류 ' + errs.length + '건 — 파일을 쓰지 않고 멈춥니다\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
  writeReadme(genSection(screens, pages));
  writeReadme(genDbSection(screens, dbItems), DBDOC);
  fs.writeFileSync(MAP, mapHtml(mapData(screens, pages, groups, dbItems)));
  fs.writeFileSync(BOARD, boardHtml(boardData(mapData(screens, pages, groups, dbItems))));
  const size = writeBundle(screens);
  console.log('blueprint:gen 완료 — 화면 파일 ' + screens.length + '개, 미작성 ' + pages.filter(p => !screens.some(s => s.file === p.file)).length + '개, _bundle.md ' + size + ' bytes');
  const nFlows = screens.reduce((a, s) => a + s._flows.length, 0), nSteps = screens.reduce((a, s) => a + s._flows.reduce((x, f) => x + f.steps.length, 0), 0);
  const flowOnly = WARNS.filter(w => w.kind === 'flowOnly'), headerOnly = WARNS.filter(w => w.kind === 'headerOnly');
  console.log('흐름: 동작 ' + nFlows + '개, 단계 ' + nSteps + '개 (' + screens.map(s => s.screen + ' ' + s._flows.length).join(', ') + ')');
  console.log('경고(오류 아님): 흐름에만 있는 대상 ' + flowOnly.length + '건, 머리말에만 있고 흐름에 안 나오는 대상 ' + headerOnly.length + '건(그중 기기 저장값 ' + headerOnly.filter(w => w.device).length + '건)');
  if (process.argv.includes('--warn')) for (const w of WARNS) console.log(' - [' + (w.kind === 'flowOnly' ? '흐름에만' : '머리말에만') + '] ' + w.screen + ': ' + w.text);
}
main();
