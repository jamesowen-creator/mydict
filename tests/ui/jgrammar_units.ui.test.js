// 작업318: 문장 학습 — 영어 "의미 단위 + 전체 흐름"(형식 3) 화면 시험(헤드리스 Chrome 390px). 자체 임시 서버(정적 파일 + 모의 API, AI·DB·운영 서버와 무관).
// 확인: 단위 목록(text·뜻·역할·이유, reason 비면 생략)·전체 흐름 / 긴 문장 가로 스크롤 없음(390·360·320) / units·flow null 처리 /
//       옛 형식 영어 결과(1·2)의 기존 표시(형식 2 구조는 항상 표시, 구조 끄기/켜기 없음) / 일본어·중국어 화면 불변 / HTML 문자열이 요소로 해석되지 않음
// 실행: node --test tests/ui/jgrammar_units.ui.test.js   (Chrome이 없으면 건너뜀)
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
const OLD1 = 'He runs fast.';
const OLD2 = 'Birds fly south.';
const NULLS = 'Cats sleep.';
const NOFLOW = 'Dogs bark loudly.';
const HTMLS = 'I like <b>tea</b> & <img src=x onerror=window.__pwn=1> cake.';
const JA = '私は毎朝コーヒーを飲みます。';
const ZH = '我每天学习汉语。';
const P = { name: '현재완료(계속)', meaning: '과거부터 지금까지 이어지는 상태', form: 'has lived', contrast: '단순 과거와 다름', level: 'B1' };
const node = (kind, role, text, note, children) => ({ kind, role, text, note, ...(children ? { children } : {}) });
const unit = (text, meaning, role, reason) => ({ text, meaning, role, reason });
const compat = { structure: null, points: [], grammar: [] };   // 형식 3 의 호환 키(작업317 코드가 읽어도 깨지지 않게)
const LONGW = LONG.split(' ');
const RESULTS = {
  en: {
    [S1]: { translation: '그녀는 2020년부터 서울에 살고 있다', units: [
      unit('She has lived', '그녀는 살아왔다', '주절. 문장의 중심이 되는 사실', '과거부터 지금까지 이어지는 상태'),
      unit('in Seoul', '서울에서', '장소를 알려 주는 말', ''),
      unit('since 2020.', '2020년부터', '시작 시점을 알려 주는 말', 'since 는 시작 시점을 나타낸다'),
    ], flow: '그녀가 살아왔다 → 서울에서 → 2020년부터', ...compat },
    [LONG]: { translation: '긴 문장', units: [
      unit(LONGW.slice(0, 8).join(' ') + ' ', '아주 긴 설명이 폭을 넘어도 줄바꿈되어야 합니다. '.repeat(2), '긴역할'.repeat(10) + ' ' + 'r'.repeat(30), '긴이유'.repeat(30) + ' ' + 'x'.repeat(80)),
      unit(LONGW.slice(8).join(' '), '나머지', '나머지 부분입니다.', ''),
    ], flow: '긴흐름'.repeat(40) + ' ' + 'f'.repeat(60), ...compat },
    [OLD1]: { translation: '그는 빨리 달린다', grammar: [{ name: '부사의 위치', meaning: '동사 뒤에 온다', form: 'runs fast', contrast: '형용사와 다름', level: 'A2' }] },
    [OLD2]: { translation: '새들이 남쪽으로 난다', grammar: [], points: [P, { ...P, name: 'since 의 쓰임', level: 'B2' }], structure: [
      node('주어 (subject)', '주어', 'Birds', '문장의 주인공입니다.'),
      node('동사구 (verb phrase)', '서술', 'fly south.', '날아가는 방향을 말합니다.', [
        node('동사구 (verb phrase)', '서술', 'fly', '동사입니다.'),
        node('부사 (adverb)', '수식어', 'south.', '방향을 나타냅니다.'),
      ]),
    ] },
    [NULLS]: { translation: '고양이는 잔다', units: null, flow: null, ...compat },
    [NOFLOW]: { translation: '개는 크게 짖는다', units: [unit(NOFLOW, '개가 크게 짖는다', '하나의 주절', '')], flow: null, ...compat },
    [HTMLS]: { translation: '<script>window.__pwn=2</script>', units: [
      unit(HTMLS, '<b>뜻</b>', '<i>역할</i>', '<img src=x onerror=window.__pwn=3>'),
    ], flow: '<img src=x onerror=window.__pwn=4> → 흐름', ...compat },
  },
  ja: { [JA]: { translation: '나는 매일 아침 커피를 마십니다', grammar: [{ name: '〜を', meaning: '목적격 조사', form: '飲みます', contrast: '「が」와 다름', jlpt: 'N5' }],
    ruby: [{ text: '私', reading: 'わたし' }, { text: 'は' }, { text: '毎朝', reading: 'まいあさ' }, { text: 'コーヒー' }, { text: 'を' }, { text: '飲', reading: 'の' }, { text: 'みます。' }] } },
  'zh-Hans': { [ZH]: { translation: '나는 매일 중국어를 공부한다', grammar: [{ name: '시간 부사', meaning: '반복', form: '每天', contrast: '天天', level: '1' }],
    ruby: [{ text: '我', reading: 'wǒ' }, { text: '每天', reading: 'měi tiān' }, { text: '学习', reading: 'xué xí' }, { text: '汉语', reading: 'hàn yǔ' }, { text: '。' }] } },
};
const SAVED = {
  en: [
    { id: 7, sentence: S1, result: RESULTS.en[S1], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-20T00:00:00Z' },
    { id: 8, sentence: OLD1, result: RESULTS.en[OLD1], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-19T00:00:00Z' },
    { id: 9, sentence: OLD2, result: RESULTS.en[OLD2], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-18T00:00:00Z' },
    { id: 10, sentence: NULLS, result: RESULTS.en[NULLS], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-17T00:00:00Z' },
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

async function open({ lang = 'en', width = 390, structureOff = false } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height: 844 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('jgrammar_lang', ${JSON.stringify(lang)}); ${structureOff ? "localStorage.setItem('jgrammar_structure', 'off');" : ''} } catch (e) {}` });
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

test('영어 형식 3: 원문 → 번역 → 의미 단위 → 전체 흐름 순서, 단위마다 text(제목)·뜻·역할·이유(비면 생략), 알아둘 문법·CEFR·구조 끄기/켜기 없음', { skip: SKIP }, async () => {
  const page = await open();
  await analyze(page, S1, RESULTS.en[S1].translation);
  assert.deepEqual(await order(page), ['result-tools', 'source', 'translation', 'picks-title:의미 단위', 'g-item', 'g-item', 'g-item', 'picks-title:전체 흐름', 'g-text', 'disclaimer']);
  assert.equal(await page.text('.source'), S1);
  const items = await page.eval("[...document.querySelectorAll('#result .u-item')].map(a => [...a.children].map(c => c.tagName + '.' + c.className + '|' + c.textContent))");
  assert.deepEqual(items[0], ['H3.g-name|She has lived', 'P.g-meaning|그녀는 살아왔다', 'P.g-label|역할', 'P.g-text|주절. 문장의 중심이 되는 사실', 'P.g-label|이유', 'P.g-text|과거부터 지금까지 이어지는 상태']);
  assert.deepEqual(items[1], ['H3.g-name|in Seoul', 'P.g-meaning|서울에서', 'P.g-label|역할', 'P.g-text|장소를 알려 주는 말'], 'reason 이 비면 이유 줄 없음');
  assert.equal(items[2][4], 'P.g-label|이유');
  assert.equal(await page.eval("document.querySelector('#result .picks-title:last-of-type') && [...document.querySelectorAll('#result .picks-title')].map(e => e.textContent).join()"), '의미 단위,전체 흐름');
  assert.equal(await page.eval("[...document.querySelectorAll('#result > .g-text')].map(e => e.textContent).join()"), RESULTS.en[S1].flow);
  // 기존 문법 항목과 같은 구성: 라벨·제목 스타일 재사용(새 스타일 없음), 구분선으로 나뉨
  const st = await page.eval("(() => { const a = document.querySelector('#result .u-item'), n = a.querySelector('.g-name'), l = a.querySelector('.g-label'); const c = getComputedStyle(a), nn = getComputedStyle(n), ll = getComputedStyle(l); return { bt: c.borderTopWidth, bg: c.backgroundColor, rad: c.borderTopLeftRadius, fs: nn.fontSize, fw: nn.fontWeight, lfs: ll.fontSize }; })()");
  assert.deepEqual(st, { bt: '1px', bg: 'rgba(0, 0, 0, 0)', rad: '0px', fs: '18px', fw: '700', lfs: '12px' });
  const text = await page.eval("document.getElementById('result').textContent");
  assert.ok(!text.includes('알아둘 문법') && !text.includes('문장 구조') && !/CEFR|구조 (끄기|켜기)/.test(text), '옛 요소 없음');
  assert.equal(await page.exists('#result .structure'), false);
  assert.equal(await page.eval("[...document.querySelectorAll('#result .result-tools .btn.text')].map(b => b.textContent).filter(t => !/^(듣기|천천히)$/.test(t)).length"), 0, '구조 끄기/켜기 링크 없음(읽어주기 버튼만)');
  assert.equal(await page.hasHorizontalScroll(), false);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('영어 긴 문장·긴 단어: 390·360·320px 에서 가로 스크롤이 없고 text·meaning·role·reason·flow 가 줄바꿈된다', { skip: SKIP }, async () => {
  for (const w of [390, 360, 320]) {
    const page = await open({ width: w });
    await analyze(page, LONG, '긴 문장');
    const wide = await page.eval("[...document.querySelectorAll('#result *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(e => e.className + ':' + e.tagName)");
    assert.deepEqual(wide, [], w + ': 화면 밖으로 나간 요소');
    assert.equal(await page.hasHorizontalScroll(), false, w);
    const over = await page.eval("[...document.querySelectorAll('#result .u-item *, #result > .g-text')].filter(e => e.scrollWidth > e.clientWidth + 1).length");
    assert.equal(over, 0, w + ': 넘치는 줄 없음');
    assert.equal(await page.count('#result .u-item'), 2);
    await page.close();
  }
});

test('units 가 null 이면 "의미 단위"·"전체 흐름" 없이 번역만, flow 가 null 이면 "전체 흐름" 줄만 없다', { skip: SKIP }, async () => {
  const page = await open();
  await analyze(page, NULLS, RESULTS.en[NULLS].translation);
  assert.deepEqual((await order(page)).filter(x => x !== 'result-tools'), ['source', 'translation', 'disclaimer']);
  assert.ok(!(await page.eval("document.getElementById('result').textContent.includes('의미 단위') || document.getElementById('result').textContent.includes('전체 흐름')")));
  await analyze(page, NOFLOW, RESULTS.en[NOFLOW].translation);
  assert.deepEqual((await order(page)).filter(x => x !== 'result-tools'), ['source', 'translation', 'picks-title:의미 단위', 'g-item', 'disclaimer']);
  assert.ok(!(await page.eval("document.getElementById('result').textContent.includes('전체 흐름')")));
  await page.close();
});

test('옛 형식 영어 결과(형식 1: 문법 항목 목록, 형식 2: 문장 구조 + 알아둘 문법)는 저장 목록에서 열어도 기존 방식으로 표시된다. 형식 2 의 구조는 토글 없이 항상 보이고, 옛 localStorage 값(jgrammar_structure=off)은 영향이 없다. 열기는 AI 를 부르지 않는다', { skip: SKIP }, async () => {
  const page = await open({ structureOff: true });
  const before = state.requests.length;
  await openSaved(page, 1, RESULTS.en[OLD1].translation);   // 형식 1
  assert.deepEqual((await order(page)).filter(x => x !== 'result-tools'), ['source', 'translation', 'g-item', 'disclaimer']);
  assert.deepEqual(await page.eval("[...document.querySelector('#result .g-item').children].map(c => c.textContent)"), ['부사의 위치CEFR A2', '동사 뒤에 온다', '이 문장에서', 'runs fast', '비슷한 표현과의 차이', '형용사와 다름']);
  await openSaved(page, 2, RESULTS.en[OLD2].translation);   // 형식 2
  assert.deepEqual((await order(page)).filter(x => x !== 'result-tools'), ['source', 'translation', 'structure', 'picks-title:알아둘 문법', 'g-item', 'g-item', 'disclaimer']);
  assert.equal(await page.eval("(() => { const e = document.querySelector('#result .structure'); return getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; })()"), true, '구조는 항상 표시(저장된 off 값 무시)');
  assert.equal(await page.eval("document.querySelector('#result .structure .picks-title').textContent"), '문장 구조');
  assert.equal(await page.eval("[...document.querySelectorAll('#result .btn.text')].some(b => /구조 (끄기|켜기)/.test(b.textContent))"), false, '구조 끄기/켜기 링크 없음');
  assert.equal(await page.eval("document.querySelectorAll('#result .s-node').length"), 4);
  assert.equal(state.requests.slice(before).filter(r => /explain|ocr/.test(r.url)).length, 0, '저장 목록 열기는 AI 를 부르지 않는다');
  assert.equal(await page.hasHorizontalScroll(), false);
  // 형식 3 항목도 AI 없이 열린다
  await openSaved(page, 0, RESULTS.en[S1].translation);
  assert.equal(await page.count('#result .u-item'), 3); assert.equal(state.requests.slice(before).filter(r => /explain|ocr/.test(r.url)).length, 0);
  assert.equal(await page.eval("localStorage.getItem('jgrammar_structure')"), 'off', '남은 값은 정리하지 않는다');
  await page.close();
});

test('HTML 문자열은 요소로 해석되지 않고 글자 그대로 표시된다(text·meaning·role·reason·flow·번역)', { skip: SKIP }, async () => {
  const page = await open();
  await analyze(page, HTMLS, RESULTS.en[HTMLS].translation);
  assert.equal(await page.eval('window.__pwn === undefined'), true, '스크립트·이벤트 핸들러 실행 없음');
  assert.equal(await page.eval("document.querySelectorAll('#result b, #result i, #result img, #result script').length"), 0);
  assert.equal(await page.eval("document.querySelector('#result .u-item .g-name').textContent"), HTMLS);
  assert.equal(await page.eval("document.querySelector('#result .u-item .g-meaning').textContent"), '<b>뜻</b>');
  assert.equal(await page.eval("[...document.querySelectorAll('#result .u-item .g-text')].map(e => e.textContent).join('|')"), '<i>역할</i>|<img src=x onerror=window.__pwn=3>');
  assert.equal(await page.eval("document.querySelector('#result > .g-text').textContent"), '<img src=x onerror=window.__pwn=4> → 흐름');
  assert.equal(await page.eval("document.querySelector('#result .translation').textContent"), '<script>window.__pwn=2</script>');
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
});

test('구조 끄기/켜기 코드와 localStorage 키(jgrammar_structure)는 화면 코드에서 제거되었다', { skip: SKIP }, async () => {
  const html = fs.readFileSync(path.join(PUB, 'jgrammar.html'), 'utf8');
  assert.ok(!/STRUCTURE_KEY|jgrammar_structure|no-structure|구조 끄기|구조 켜기/.test(html.replace(/작업318: 구조 끄기\/켜기\(jgrammar_structure\)는 없어졌다[^\n]*/, '')), '구조 토글 코드 없음');
});

test('일본어·중국어 화면은 그대로: 의미 단위·전체 흐름 없음, 문법 항목 목록과 후리가나/병음 토글만', { skip: SKIP }, async () => {
  for (const [lang, sentence, toggleText, level] of [['ja', JA, '후리가나 끄기', 'JLPT N5'], ['zh-Hans', ZH, '병음 끄기', 'HSK 1']]) {
    const page = await open({ lang });
    await analyze(page, sentence, RESULTS[lang][sentence].translation);
    assert.deepEqual(await order(page), ['result-tools', 'source', 'translation', 'g-item', 'disclaimer'], lang);
    assert.equal(await page.eval("[...document.querySelectorAll('#result .result-tools .btn.text')].map(b => b.textContent).filter(t => !/^(듣기|천천히)$/.test(t)).join()"), toggleText, lang);
    assert.equal(await page.eval("document.querySelector('#result .g-level').textContent"), level);
    assert.equal(await page.eval("document.querySelectorAll('#result .structure, #result .s-node, #result .u-item').length"), 0);
    const t = await page.eval("document.getElementById('result').textContent");
    assert.ok(!t.includes('알아둘 문법') && !t.includes('의미 단위') && !t.includes('전체 흐름'));
    assert.equal(await page.hasHorizontalScroll(), false);
    await page.close();
  }
});
