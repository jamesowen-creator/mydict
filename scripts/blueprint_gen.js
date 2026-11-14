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
.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; }
@media (min-width: 720px) {
  .layout { grid-template-columns: minmax(0, 65fr) minmax(0, 35fr); gap: 24px; align-items: start; }
  #detail { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow: auto; }
}
.col h2 { font-size: 14px; margin: 0 0 8px; color: var(--sub); font-weight: 700; }
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
@media (max-width: 719px) { #detail { max-height: 1000px; overflow: auto; } }   /* 좁은 화면: 목록 아래에 놓이는 패널도 1000px 을 넘지 않고 패널 안에서 스크롤 */
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
.flow-card .num { display: inline-block; min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px; background: var(--sel); color: #fff; font-size: 14px; font-weight: 700; line-height: 24px; text-align: center; white-space: nowrap; }
.flow-card .sample { margin: 0; padding: 2px 10px; font-size: 14px; }
.flow-card .sample.t-db, .flow-card .sample.t-cache { padding-top: 14px; min-width: 0; }
.flow-card .sample.t-engine { padding: 2px 20px; min-width: 0; }
.flow-card .sample small { display: inline; margin-right: 6px; font-size: 14px; color: var(--sub); line-height: 1.2; }
details.conn { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
details.conn summary { cursor: pointer; font-size: 14px; font-weight: 700; color: var(--sub); min-height: 32px; }
.conn-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; margin-top: 8px; }
.conn-grid .rel-row { margin: 4px 0; }
@media (max-width: 420px) { .conn-grid { grid-template-columns: minmax(0, 1fr); } }
.foot { margin-top: 12px; font-size: 14px; color: var(--sub); }
</style>
</head>
<body>
<div class="wrap">
<h1>METIS-3 도면</h1>
<p class="hint">항목을 누르면 연결된 항목이 강조되고 나머지는 흐려집니다. 같은 항목을 다시 누르면 해제됩니다. 화면을 누르면 동작별 흐름이 상세 상자(넓은 화면은 오른쪽, 좁은 화면은 목록 아래)에 나오고, 동작 카드를 누르면 왼쪽 목록에 순서 번호가 붙습니다.</p>
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
    var l = document.createElement('span'); l.className = 'lbl'; putText(l, n.label, n.type); b.appendChild(l);
    b.addEventListener('click', function () { select(selected === n.id ? null : n.id); });
    n.el = b; cols[c].appendChild(b);
  });
  var EMPTY_MSG = '항목을 누르면 연결이 여기에 표시됩니다.';
  var selected = null, flowOn = null, grid = document.getElementById('grid'), detail = document.getElementById('detail');
  var CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  function numLabel(n) { var d = parseInt(n, 10), rest = String(n).replace(/^\\d+/, ''); return (CIRC[d - 1] || String(d)) + rest; }
  function out(id, rel) { return edges.filter(function (e) { return e[0] === id && e[2] === rel; }).map(function (e) { return e[1]; }); }
  function inn(id, rel) { return edges.filter(function (e) { return e[1] === id && e[2] === rel; }).map(function (e) { return e[0]; }); }
  function nameOf(id) { return byId[id].label; }
  function typed(ids, t) { return ids.filter(function (i) { return t.indexOf(byId[i].type) >= 0; }); }
  function putText(el, text, type) {   // 경로(모듈·API)는 단어 중간이 아니라 슬래시 뒤에서만 줄바꿈한다
    if (type !== 'module' && type !== 'api') { el.appendChild(document.createTextNode(text)); return; }
    String(text).split('/').forEach(function (part, i) { if (i > 0) { el.appendChild(document.createTextNode('/')); el.appendChild(document.createElement('wbr')); } el.appendChild(document.createTextNode(part)); });
  }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function row(parent, kind, items) {
    if (!items || !items.length) return;
    var d = mk('div', 'rel-row'); d.appendChild(mk('span', 'rk', kind));
    var ul = mk('ul'); items.forEach(function (x) { ul.appendChild(mk('li', '', x)); }); d.appendChild(ul);
    parent.appendChild(d);
  }
  function clearMarks() {
    nodes.forEach(function (n) { n.el.classList.remove('sel', 'rel', 'flow'); n.el.setAttribute('aria-pressed', 'false'); var b = n.el.querySelector('.badge'); if (b) b.remove(); var lb = n.el.querySelector('.lbl'); if (lb) lb.style.paddingLeft = ''; });
  }
  function markRelated(id) { edges.forEach(function (e) { if (e[0] === id) byId[e[1]].el.classList.add('rel'); if (e[1] === id) byId[e[0]].el.classList.add('rel'); }); }
  function stepChip(st) {
    var s = mk('span', 'sample t-' + st.type); var l = mk('span', 'lbl'); l.appendChild(mk('small', '', st.rl)); putText(l, st.label, st.type); s.appendChild(l); return s;
  }
  function flowCard(screenId, f) {
    var card = mk('button', 'flow-card'); card.type = 'button'; card.setAttribute('aria-pressed', 'false'); card.dataset.flow = f.name;
    card.appendChild(mk('span', 'fname', f.name));
    var steps = mk('span', 'steps');   // 한 단계 = 한 줄: [번호 배지] [관계+대상 칩]. 줄 사이 화살표는 없다(번호가 순서). ⇢대체 는 같은 번호의 a 줄 바로 아래에 들여써서 "실패하면" 을 단다
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
    flowOn = name;
    detail.querySelectorAll('.flow-card').forEach(function (c) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
    clearMarks();
    var sn = byId[screenId]; sn.el.classList.add('sel'); sn.el.setAttribute('aria-pressed', 'true');
    if (!name) { markRelated(screenId); return; }
    card.classList.add('on'); card.setAttribute('aria-pressed', 'true');
    var f = sn.flows.filter(function (x) { return x.name === name; })[0], marks = {};
    f.steps.forEach(function (st) { if (st.node) { (marks[st.node] = marks[st.node] || []).push(numLabel(st.n)); } });
    Object.keys(marks).forEach(function (id) {
      var el = byId[id].el; el.classList.add('flow');
      var b = mk('span', 'badge', marks[id].join('')); el.insertBefore(b, el.firstChild);
      var lb = el.querySelector('.lbl'); lb.style.paddingLeft = (b.offsetWidth + (el.classList.contains('t-engine') ? 28 : 22)) + 'px';   // 번호가 여러 개여도 글자와 겹치지 않게
    });
  }
  function merged(a, b) {   // 읽기·쓰기 양쪽에 있는 항목은 한 그룹에 한 번만
    var both = a.filter(function (x) { return b.indexOf(x) >= 0; });
    return { both: both, onlyA: a.filter(function (x) { return both.indexOf(x) < 0; }), onlyB: b.filter(function (x) { return both.indexOf(x) < 0; }) };
  }
  function select(id) {
    selected = id; flowOn = null;
    clearMarks(); detail.textContent = '';
    if (!id) { grid.classList.remove('dim'); detail.textContent = EMPTY_MSG; return; }
    var n = byId[id]; grid.classList.add('dim');
    n.el.classList.add('sel'); n.el.setAttribute('aria-pressed', 'true');
    markRelated(id);
    detail.appendChild(mk('div', 'head', n.label + (n.file ? '  (' + n.file + ')' : '')));
    if (n.type === 'todo') { detail.appendChild(mk('div', '', '이 화면은 도면이 아직 없습니다(연결 정보 없음). →이동해 오는 화면: ' + (inn(id, 'move').map(nameOf).join(', ') || '(없음)'))); return; }
    if (n.type === 'screen') {
      if (n.flows && n.flows.length) {
        detail.appendChild(mk('div', 'sec', '동작별 흐름 (' + n.flows.length + '개) — 동작을 누르면 왼쪽 목록에 순서 번호가 붙습니다'));
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
    } else if (n.type === 'engine') {
      row(detail, '→호출하는 화면', inn(id, 'call').map(nameOf));
      row(detail, '⇢대체(이 엔진이 실패하면)', out(id, 'fallback').map(nameOf)); row(detail, '⇢대체(이 엔진으로 대신함)', inn(id, 'fallback').map(nameOf));
    } else if (n.type === 'db' || n.type === 'cache') {
      var rs = merged(inn(id, 'read').map(nameOf), inn(id, 'write').map(nameOf));
      row(detail, '→읽기·쓰기하는 화면', rs.both); row(detail, '→읽는 화면', rs.onlyA); row(detail, '→쓰는 화면', rs.onlyB);
    } else row(detail, '→호출하는 화면', inn(id, 'call').map(nameOf));
    detail.appendChild(mk('div', 'foot', '도면이 있는 화면만 표시됩니다(미작성 화면은 코드로 확인).'));
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
  const nFlows = screens.reduce((a, s) => a + s._flows.length, 0), nSteps = screens.reduce((a, s) => a + s._flows.reduce((x, f) => x + f.steps.length, 0), 0);
  const flowOnly = WARNS.filter(w => w.kind === 'flowOnly'), headerOnly = WARNS.filter(w => w.kind === 'headerOnly');
  console.log('흐름: 동작 ' + nFlows + '개, 단계 ' + nSteps + '개 (' + screens.map(s => s.screen + ' ' + s._flows.length).join(', ') + ')');
  console.log('경고(오류 아님): 흐름에만 있는 대상 ' + flowOnly.length + '건, 머리말에만 있고 흐름에 안 나오는 대상 ' + headerOnly.length + '건(그중 기기 저장값 ' + headerOnly.filter(w => w.device).length + '건)');
  if (process.argv.includes('--warn')) for (const w of WARNS) console.log(' - [' + (w.kind === 'flowOnly' ? '흐름에만' : '머리말에만') + '] ' + w.screen + ': ' + w.text);
}
main();
