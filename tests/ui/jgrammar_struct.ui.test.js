// 작업317: 문장 학습 — 영어 "문장 구조 + 알아둘 문법" 화면 시험(헤드리스 Chrome 390px). 자체 임시 서버(정적 파일 + 모의 API, AI·DB·운영 서버와 무관).
// 확인: 구조 들여쓰기 목록(깊이 1~3)·가로 스크롤 없음 / 구조 끄기·켜기와 기억(localStorage 차단 포함) / structure null 이면 링크 숨김 / points 비면 섹션 숨김 /
//       옛 형식 영어 결과의 기존 표시 / 일본어·중국어 화면 불변 / HTML 문자열이 요소로 해석되지 않음
// 실행: node --test tests/ui/jgrammar_struct.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const S1 = 'She has lived in Seoul since 2020.';
const LONG = 'Supercalifragilistic people who have been living in the northern part of the city since the early two thousand twenties.';
const OLD = 'He runs fast.';
const NULLS = 'Cats sleep.';
const NOPOINTS = 'Dogs bark loudly.';
const HTMLS = 'I like <b>tea</b> & <img src=x onerror=window.__pwn=1> cake.';
const JA = '私は毎朝コーヒーを飲みます。';
const ZH = '我每天学习汉语。';
const P = { name: '현재완료(계속)', meaning: '과거부터 지금까지 이어지는 상태', form: 'has lived', contrast: '단순 과거와 다름', level: 'B1' };
const node = (kind, role, text, note, children) => ({ kind, role, text, note, ...(children ? { children } : {}) });
const RESULTS = {
  en: {
    [S1]: { translation: '그녀는 2020년부터 서울에 살고 있다', grammar: [], points: [P, { ...P, name: 'since 의 쓰임', level: 'B2' }], structure: [
      node('주어 (subject)', '주어', 'She', '문장의 주인공입니다.'),
      node('동사구 (verb phrase)', '서술', 'has lived in Seoul since 2020.', '현재완료로 지금까지 이어지는 상태를 말합니다.', [
        node('동사구 (verb phrase)', '서술', 'has lived', '현재완료 동사입니다.'),
        node('전치사구 (prepositional phrase)', '수식어', 'in Seoul', '장소를 나타냅니다.', [
          node('명사구 (noun phrase)', '', 'Seoul', '전치사의 목적어입니다.'),
        ]),
        node('전치사구 (prepositional phrase)', '수식어', 'since 2020', '시작 시점을 나타냅니다.'),
      ]),
    ] },
    [LONG]: { translation: '긴 문장', grammar: [], points: [P], structure: [
      node('명사구 (noun phrase)', '주어', LONG.slice(0, 90), '아주 긴 단어와 설명이 폭을 넘어도 줄바꿈되어야 합니다. '.repeat(2), [
        node('관계절 (relative clause)', '수식어', LONG.slice(0, 70), '긴단어'.repeat(30) + ' ' + 'x'.repeat(80), [node('형용사구 (adjective phrase)', '', LONG.slice(0, 40), '깊이 3 노드입니다. '.repeat(3))]),
      ]),
      node('나머지', '', LONG.slice(90), '나머지 부분입니다.'),
    ] },
    [OLD]: { translation: '그는 빨리 달린다', grammar: [{ name: '부사의 위치', meaning: '동사 뒤에 온다', form: 'runs fast', contrast: '형용사와 다름', level: 'A2' }] },
    [NULLS]: { translation: '고양이는 잔다', grammar: [], points: [], structure: null },
    [NOPOINTS]: { translation: '개는 크게 짖는다', grammar: [], points: [], structure: [node('주절 (main clause)', '', NOPOINTS, '단순한 문장입니다.')] },
    [HTMLS]: { translation: '<script>window.__pwn=2</script>', grammar: [], points: [{ ...P, name: '<img src=x onerror=window.__pwn=3>', level: 'C1' }], structure: [
      node('<b>절</b>', '<i>역할</i>', HTMLS, '<img src=x onerror=window.__pwn=4>'),
    ] },
  },
  ja: { [JA]: { translation: '나는 매일 아침 커피를 마십니다', grammar: [{ name: '〜を', meaning: '목적격 조사', form: '飲みます', contrast: '「が」와 다름', jlpt: 'N5' }],
    ruby: [{ text: '私', reading: 'わたし' }, { text: 'は' }, { text: '毎朝', reading: 'まいあさ' }, { text: 'コーヒー' }, { text: 'を' }, { text: '飲', reading: 'の' }, { text: 'みます。' }] } },
  'zh-Hans': { [ZH]: { translation: '나는 매일 중국어를 공부한다', grammar: [{ name: '시간 부사', meaning: '반복', form: '每天', contrast: '天天', level: '1' }],
    ruby: [{ text: '我', reading: 'wǒ' }, { text: '每天', reading: 'měi tiān' }, { text: '学习', reading: 'xué xí' }, { text: '汉语', reading: 'hàn yǔ' }, { text: '。' }] } },
};
const SAVED = {
  en: [
    { id: 7, sentence: S1, result: RESULTS.en[S1], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-20T00:00:00Z' },
    { id: 8, sentence: OLD, result: RESULTS.en[OLD], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-19T00:00:00Z' },
    { id: 9, sentence: NULLS, result: RESULTS.en[NULLS], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-18T00:00:00Z' },
  ],
  ja: [], 'zh-Hans': [],
};

let srv, base, browser;
const state = { requests: [] };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        state.requests.push({ method: req.method, url: u, query: url.search, body });
        if (u === '/api/me') return json(200, { id: 1, email: 'u@x', name: '테스터', role: 'user', perm_jgrammar: true });
        if (u === '/api/jgrammar/saved' && req.method === 'GET') return json(200, { ok: true, items: SAVED[url.searchParams.get('lang') || 'ja'] || [] });
        if (u === '/api/jgrammar/explain') {
          const b = JSON.parse(body || '{}');
          const r = (RESULTS[b.lang] || {})[b.sentence];
          return r ? json(200, { ok: true, cached: false, result: r }) : json(422, { ok: false, error: '모의 서버: 준비되지 않은 문장' });
        }
        json(404, { ok: false });
      });
      return;
    }
    const f = path.join(PUB, u);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });

async function open({ lang = 'en', breakStructureStorage = false } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width: 390, height: 844 });
  if (breakStructureStorage) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) { if (k === 'jgrammar_structure') throw new Error('blocked'); return g.call(this, k); };
      Storage.prototype.setItem = function (k, v) { if (k === 'jgrammar_structure') throw new Error('blocked'); return s.call(this, k, v); }; })();` });
  }
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('jgrammar_lang', ${JSON.stringify(lang)}); } catch (e) {}` });
  await page.goto(base + '/jgrammar.html');
  await page.waitFor("!document.getElementById('main').hidden", 8000);
  await page.waitFor("document.querySelectorAll('.saved-item').length > 0 || document.querySelector('.saved-empty')", 5000);
  return page;
}
async function analyze(page, sentence, translation) {
  await page.setValue('#sentence', sentence);
  await page.click('#go');
  await page.waitFor(`!document.getElementById('result').hidden && !!document.querySelector('#result .translation') && document.querySelector('#result .translation').textContent === ${JSON.stringify(translation)}`, 5000);
}
const openSaved = async (page, idx, translation) => {
  await page.click('.saved-item .pick', { index: idx });
  await page.waitFor(`!document.getElementById('result').hidden && document.querySelector('#result .translation').textContent === ${JSON.stringify(translation)}`, 5000);
};
const order = page => page.eval("[...document.getElementById('result').children].map(e => e.className.split(' ')[0] + (e.tagName === 'H2' ? ':' + e.textContent : ''))");
const toggle = page => page.eval("(() => { const b = [...document.querySelectorAll('#result .result-tools .btn.text')].find(x => /^구조 (끄기|켜기)$/.test(x.textContent)); return b ? b.textContent : null; })()");
const structVisible = page => page.eval("(() => { const e = document.querySelector('#result .structure'); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; })()");

test('영어 새 형식: 원문 → 번역 → 문장 구조 → 알아둘 문법 순서, 문법 항목 목록 없음, 구조는 박스 없는 들여쓰기 목록(깊이 1~3)', { skip: SKIP }, async () => {
  const page = await open();
  await analyze(page, S1, RESULTS.en[S1].translation);
  assert.deepEqual(await order(page), ['result-tools', 'source', 'translation', 'structure', 'picks-title:알아둘 문법', 'g-item', 'g-item', 'disclaimer']);
  assert.equal(await page.text('.source'), S1);
  // 구조 노드: 한 줄 "kind · role", text, note 순서
  const first = await page.eval("(() => { const n = document.querySelector('#result .structure > div > .s-node'); return [...n.children].filter(c => c.tagName === 'P').map(c => c.className + '|' + c.textContent); })()");
  assert.deepEqual(first, ['s-head|주어 (subject) · 주어', 's-text|She', 's-note|문장의 주인공입니다.']);
  assert.equal(await page.eval("document.querySelector('#result .structure .picks-title').textContent"), '문장 구조');
  assert.equal(await page.eval("[...document.querySelectorAll('#result .s-head')].map(e => e.textContent).filter(t => /^명사구/.test(t))[0]"), '명사구 (noun phrase)', 'role 이 비면 kind 만');
  // 깊이 1~3 의 왼쪽 위치가 단계마다 커진다
  const xs = await page.eval(`(() => { const t = [...document.querySelectorAll('#result .s-text')]; const x = s => t.find(e => e.textContent === s).getBoundingClientRect().left; return [x('She'), x('has lived'), x('Seoul')]; })()`);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], '깊이마다 들여쓴다: ' + xs);
  assert.equal(await page.eval("document.querySelectorAll('#result .s-children').length"), 2, '자식 묶음: 동사구 안, 전치사구 안');
  // 박스 없음: 노드에는 배경·테두리 상자가 없고 자식 묶음의 왼쪽 선만 있다
  const box = await page.eval(`(() => { const n = document.querySelector('#result .s-node'); const c = getComputedStyle(n); const k = getComputedStyle(document.querySelector('#result .s-children')); return { bg: c.backgroundColor, bw: c.borderTopWidth + c.borderLeftWidth, rad: c.borderTopLeftRadius, kl: k.borderLeftWidth, kt: k.borderTopWidth, kr: k.borderTopLeftRadius }; })()`);
  assert.deepEqual(box, { bg: 'rgba(0, 0, 0, 0)', bw: '0px0px', rad: '0px', kl: '1px', kt: '0px', kr: '0px' });
  // 알아둘 문법: 이름 + CEFR, 의미, 이 문장에서, 비슷한 표현과의 차이
  const g = await page.eval("[...document.querySelectorAll('#result .g-item:not(.structure)')].map(a => [...a.children].map(c => c.textContent.replace(/\\s+/g, ' ')))");
  assert.deepEqual(g[0], ['현재완료(계속)CEFR B1', '과거부터 지금까지 이어지는 상태', '이 문장에서', 'has lived', '비슷한 표현과의 차이', '단순 과거와 다름']);
  assert.equal(g.length, 2);
  assert.equal(await page.count('#result .g-item'), 3, '구조 1 + 알아둘 문법 2 (옛 문법 항목 목록 없음)');
  assert.equal(await page.hasHorizontalScroll(), false);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('영어 긴 문장·긴 단어: 390px 에서 가로 스크롤이 없고 text·note 가 줄바꿈된다(깊이 3 포함)', { skip: SKIP }, async () => {
  const page = await open();
  await analyze(page, LONG, '긴 문장');
  const wide = await page.eval("[...document.querySelectorAll('#result *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(e => e.className + ':' + e.tagName)");
  assert.deepEqual(wide, [], '화면 밖으로 나간 요소');
  assert.equal(await page.hasHorizontalScroll(), false);
  const over = await page.eval(`(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('#result .s-head, #result .s-text, #result .s-note')].filter(e => e.getBoundingClientRect().right > w + 1 || e.scrollWidth > e.clientWidth + 1).length; })()`);
  assert.equal(over, 0, '넘치는 줄 없음');
  assert.equal(await page.eval("document.querySelectorAll('#result .s-children').length"), 2);
  const deep = await page.eval("(() => { const e = [...document.querySelectorAll('#result .s-note')].find(x => x.textContent.startsWith('깊이 3')); const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, w: document.documentElement.clientWidth }; })()");
  assert.ok(deep.right <= deep.w && deep.right - deep.left > 120, '깊이 3 도 읽을 폭이 남는다: ' + JSON.stringify(deep));
  await page.close();
});

test('구조 끄기/켜기: 기본 켜짐, 끄면 문장 구조만 숨고(원문·번역·알아둘 문법 그대로) 새로 열어도 기억, 후리가나·병음 토글과 키가 다르다', { skip: SKIP }, async () => {
  let page = await open();
  await analyze(page, S1, RESULTS.en[S1].translation);
  assert.equal(await toggle(page), '구조 끄기'); assert.equal(await structVisible(page), true);
  assert.equal(await page.eval("document.querySelector('#result .furi-toggle').className"), 'btn text furi-toggle', '기존 텍스트 링크(.btn.text) 스타일');
  assert.equal(await page.eval("document.querySelector('#result .furi-toggle').getAttribute('aria-pressed')"), 'true');
  await page.click('#result .furi-toggle');
  assert.equal(await toggle(page), '구조 켜기'); assert.equal(await structVisible(page), false);
  assert.equal(await page.eval("localStorage.getItem('jgrammar_structure')"), 'off');
  assert.equal(await page.eval("localStorage.getItem('jgrammar_furigana') + '|' + localStorage.getItem('jgrammar_pinyin')"), 'null|null', '다른 토글 키는 건드리지 않는다');
  assert.equal(await page.text('.source'), S1); assert.equal(await page.text('.translation'), RESULTS.en[S1].translation);
  assert.equal(await page.count('#result .g-item:not(.structure)'), 2, '알아둘 문법은 그대로');
  assert.equal(await page.eval("[...document.querySelectorAll('#result .picks-title')].filter(e => e.offsetHeight > 0).map(e => e.textContent).join()"), '알아둘 문법');
  await page.close();
  page = await open();   // 같은 브라우저(저장소 유지)
  await openSaved(page, 0, RESULTS.en[S1].translation);
  assert.equal(await toggle(page), '구조 켜기', '기억한 꺼짐'); assert.equal(await structVisible(page), false);
  await page.click('#result .furi-toggle');
  assert.equal(await toggle(page), '구조 끄기'); assert.equal(await structVisible(page), true);
  assert.equal(await page.eval("localStorage.getItem('jgrammar_structure')"), 'on');
  await page.close();
});

test('구조 끄기/켜기: localStorage 읽기·쓰기가 막혀 있어도 예외 없이 동작(기본 켜짐, 클릭하면 이번 화면에서만 바뀜)', { skip: SKIP }, async () => {
  const page = await open({ breakStructureStorage: true });
  await analyze(page, S1, RESULTS.en[S1].translation);
  assert.equal(await toggle(page), '구조 끄기'); assert.equal(await structVisible(page), true);
  await page.click('#result .furi-toggle');
  assert.equal(await toggle(page), '구조 켜기'); assert.equal(await structVisible(page), false);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), [], '예외 없음');
  await page.close();
});

test('structure 가 null 이면 구조 섹션도 "구조 끄기" 링크도 없고, 알아둘 문법이 비면 소제목 포함 섹션이 없다', { skip: SKIP }, async () => {
  const page = await open();
  await analyze(page, NULLS, RESULTS.en[NULLS].translation);
  assert.equal(await toggle(page), null); assert.equal(await page.exists('#result .structure'), false);
  assert.equal(await page.exists('#result .furi-toggle'), false);
  assert.deepEqual((await order(page)).filter(x => x !== 'result-tools'), ['source', 'translation', 'disclaimer'], 'points 도 비어 소제목 없음');
  await analyze(page, NOPOINTS, RESULTS.en[NOPOINTS].translation);
  assert.equal(await toggle(page), '구조 끄기'); assert.equal(await page.exists('#result .structure'), true);
  assert.deepEqual(await order(page), ['result-tools', 'source', 'translation', 'structure', 'disclaimer']);
  assert.ok(!(await page.eval("document.getElementById('result').textContent.includes('알아둘 문법')")));
  await page.close();
});

test('옛 형식 영어 결과(structure 키 없음, 저장 목록에서 열기)는 기존 방식(문법 항목 목록)으로 표시되고 구조 링크가 없다', { skip: SKIP }, async () => {
  const page = await open();
  const before = state.requests.length;
  await openSaved(page, 1, RESULTS.en[OLD].translation);
  assert.deepEqual((await order(page)).filter(x => x !== 'result-tools'), ['source', 'translation', 'g-item', 'disclaimer']);
  assert.equal(await page.exists('#result .furi-toggle'), false);
  assert.equal(await toggle(page), null);
  const g = await page.eval("[...document.querySelector('#result .g-item').children].map(c => c.textContent)");
  assert.deepEqual(g, ['부사의 위치CEFR A2', '동사 뒤에 온다', '이 문장에서', 'runs fast', '비슷한 표현과의 차이', '형용사와 다름']);
  assert.ok(!(await page.exists('#result .structure')));
  assert.equal(state.requests.slice(before).filter(r => /explain|ocr/.test(r.url)).length, 0, '저장 목록 열기는 AI 를 부르지 않는다');
  // 새 형식 항목도 AI 호출 없이 열림
  await openSaved(page, 0, RESULTS.en[S1].translation);
  assert.equal(await page.exists('#result .structure'), true);
  assert.equal(state.requests.slice(before).filter(r => /explain|ocr/.test(r.url)).length, 0);
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
});

test('HTML 문자열은 요소로 해석되지 않고 글자 그대로 표시된다(kind·role·text·note·번역·points)', { skip: SKIP }, async () => {
  const page = await open();
  await analyze(page, HTMLS, RESULTS.en[HTMLS].translation);
  assert.equal(await page.eval('window.__pwn === undefined'), true, '스크립트·이벤트 핸들러 실행 없음');
  assert.equal(await page.eval("document.querySelectorAll('#result b, #result i, #result img, #result script').length"), 0);
  assert.equal(await page.eval("document.querySelector('#result .s-head').textContent"), '<b>절</b> · <i>역할</i>');
  assert.equal(await page.eval("document.querySelector('#result .s-text').textContent"), HTMLS);
  assert.equal(await page.eval("document.querySelector('#result .s-note').textContent"), '<img src=x onerror=window.__pwn=4>');
  assert.equal(await page.eval("document.querySelector('#result .g-name').textContent"), '<img src=x onerror=window.__pwn=3>');
  assert.equal(await page.eval("document.querySelector('#result .translation').textContent"), '<script>window.__pwn=2</script>');
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
});

test('일본어·중국어 화면은 그대로: 구조·알아둘 문법·구조 링크 없음, 문법 항목 목록과 후리가나/병음 토글만', { skip: SKIP }, async () => {
  for (const [lang, sentence, toggleText, level] of [['ja', JA, '후리가나 끄기', 'JLPT N5'], ['zh-Hans', ZH, '병음 끄기', 'HSK 1']]) {
    const page = await open({ lang });
    await analyze(page, sentence, RESULTS[lang][sentence].translation);
    assert.deepEqual(await order(page), ['result-tools', 'source', 'translation', 'g-item', 'disclaimer'], lang);
    assert.equal(await page.eval("[...document.querySelectorAll('#result .result-tools .btn.text')].map(b => b.textContent).filter(t => !/^(듣기|천천히)$/.test(t)).join()"), toggleText, lang);
    assert.equal(await page.eval("document.querySelector('#result .g-level').textContent"), level);
    assert.equal(await page.eval("document.querySelectorAll('#result .structure, #result .s-node').length"), 0);
    assert.ok(!(await page.eval("document.getElementById('result').textContent.includes('알아둘 문법')")));
    assert.equal(await page.hasHorizontalScroll(), false);
    await page.close();
  }
});
