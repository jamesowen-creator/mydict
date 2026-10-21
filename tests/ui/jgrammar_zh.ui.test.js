// 작업314: 문장 학습 — 중국어(간체·번체) 화면 시험(헤드리스 Chrome 390px). 자체 임시 서버(정적 파일 + 모의 API, AI·DB·운영 서버와 무관). speechSynthesis 는 페이지 안에서 가짜로 대체한다.
// 확인: 언어 선택 3개와 간체/번체 줄·기억·마지막 간체/번체 복원 / 언어 변경 시 초기화와 읽기 정지 / 병음 표시·토글 / 긴 문장 겹침·가로 스크롤 없음 /
//       읽어주기 lang(zh-CN·zh-TW)·원문 한자·광둥어 제외·음성 없음 안내 / 입력 검증 / 저장 목록 전환 / 사진 입력 lang / 일본어 후리가나 토글은 그대로
// 실행: node --test tests/ui/jgrammar_zh.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const GRAMMAR = [
  { name: '동사 술어', meaning: '동사 뒤에 목적어가 옵니다.', form: '学习汉语', contrast: '"学汉语"와 비슷합니다.', level: '3' },
  { name: '시간 부사', meaning: '반복되는 시간', form: '每天', contrast: '"天天"과 같습니다.', level: null },
];
const S = '我每天学习汉语。';
const S_RUBY = [{ text: '我', reading: 'wǒ' }, { text: '每天', reading: 'měi tiān' }, { text: '学习', reading: 'xué xí' }, { text: '汉语', reading: 'hàn yǔ' }, { text: '。' }];
const T = '我每天學習漢語。';
const T_RUBY = [{ text: '我', reading: 'wǒ' }, { text: '每天', reading: 'měi tiān' }, { text: '學習', reading: 'xué xí' }, { text: '漢語', reading: 'hàn yǔ' }, { text: '。' }];
const N = '我爱你';   // ruby null
const M = '我爱学习';   // ruby 가 입력과 어긋남
const JA_S = '猫が好き';
// 긴 문장(병음이 넓은 음절 위주): 단어 2자 × 60 + 문장부호(약 130자), 80자를 훨씬 넘어 읽기 조각이 나뉜다
const WIDE = ['装', '双', '窗', '状', '创', '长', '床', '闯'];
const LONG_PIECES = [];
for (let i = 0; i < 60; i++) { const w = WIDE[i % 8] + WIDE[(i + 3) % 8]; LONG_PIECES.push({ text: w, reading: 'zhuāng chuāng' }); if (i % 5 === 4) LONG_PIECES.push({ text: '，' }); }
LONG_PIECES.push({ text: '。' });
const LONG = LONG_PIECES.map(p => p.text).join('');
const R = (translation, ruby) => ({ translation, grammar: GRAMMAR, ruby });
const RESULTS = {
  'zh-Hans': { [S]: R('나는 매일 중국어를 공부한다', S_RUBY), [T]: R('번체를 간체 화면에서', T_RUBY), [N]: R('나는 너를 사랑해', null), [M]: R('나는 공부를 좋아한다', S_RUBY), [LONG]: R('긴 문장', LONG_PIECES) },
  'zh-Hant': { [T]: R('나는 매일 중국어를 공부한다(번체)', T_RUBY), [S]: R('간체를 번체 화면에서', S_RUBY) },
  ja: { [JA_S]: R('고양이를 좋아한다', [{ text: '猫', reading: 'ねこ' }, { text: 'が好き' }]) },
};
const SAVED = {
  'zh-Hans': [{ id: 1, sentence: S, result: RESULTS['zh-Hans'][S], created_at: '2026-10-01T00:00:00Z', last_used_at: '2026-10-19T00:00:00Z' }],
  'zh-Hant': [{ id: 5, sentence: T, result: RESULTS['zh-Hant'][T], created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-20T00:00:00Z' }, { id: 6, sentence: '你好', result: R('안녕', null), created_at: '2026-10-02T00:00:00Z', last_used_at: '2026-10-18T00:00:00Z' }],
  ja: [], en: [],
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
        if (u === '/api/jgrammar/ocr') return json(200, { ok: true, sentences: url.searchParams.get('lang') === 'zh-Hant' ? ['你好嗎？', '我愛你。'] : ['你好吗？', '我爱你。'] });
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

const MOCK = (voices) => `(() => {
  const S = window.__speech = { spoken: [], cancels: 0, voices: ${JSON.stringify(voices)}, current: null, listeners: {} };
  S.finish = () => { const u = S.current; S.current = null; if (u && u.onend) u.onend({}); };
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => S.voices.slice(),
    speak: u => { S.spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice ? u.voice.name : null }); S.current = u; },
    cancel: () => { S.cancels++; const u = S.current; S.current = null; if (u && u.onerror) u.onerror({ error: 'canceled' }); },
    addEventListener: (n, f) => { (S.listeners[n] = S.listeners[n] || []).push(f); },
    removeEventListener: () => {},
  } });
})();`;
const V = { cn: { name: 'Tingting', lang: 'zh-CN' }, tw: { name: 'Meijia', lang: 'zh-TW' }, hk: { name: 'Sinji', lang: 'zh-HK' }, yue: { name: 'Cantonese', lang: 'yue-HK' }, yueZh: { name: 'X', lang: 'zh-yue' }, ja: { name: 'Kyoko', lang: 'ja-JP' }, en: { name: 'Samantha', lang: 'en-US' } };

async function open({ stored, voices = [V.cn, V.tw, V.ja, V.en], breakStorage = false, width = 390, clear = false } = {}) {
  state.requests.length = 0;
  const page = await browser.newPage({ width, height: 844 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK(voices) });
  if (breakStorage) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const K = ['jgrammar_lang', 'jgrammar_zh', 'jgrammar_pinyin', 'jgrammar_furigana']; const g = Storage.prototype.getItem, s = Storage.prototype.setItem; Storage.prototype.getItem = function (k) { if (K.includes(k)) throw new Error('blocked'); return g.call(this, k); }; Storage.prototype.setItem = function (k, v) { if (K.includes(k)) throw new Error('blocked'); return s.call(this, k, v); }; })();` });
  }
  if (clear) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { ['jgrammar_lang', 'jgrammar_zh', 'jgrammar_pinyin', 'jgrammar_furigana'].forEach(k => localStorage.removeItem(k)); } catch (e) {}` });
  if (stored) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('jgrammar_lang', ${JSON.stringify(stored)}); } catch (e) {}` });
  await page.goto(base + '/jgrammar.html');
  await page.waitFor("!document.getElementById('main').hidden", 8000);
  await page.waitFor("!!document.querySelector('.saved-item') || !!document.querySelector('.saved-empty')", 5000);
  return page;
}
const pressed = page => page.eval("[...document.querySelectorAll('.lang-switch [data-lang], .lang-switch [data-lang-group]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.lang || b.dataset.langGroup)");
const zhRow = page => page.eval("(() => { const r = document.getElementById('zh-switch'); return { hidden: r.hidden, shown: r.getBoundingClientRect().height > 0, text: r.textContent.replace(/\\s+/g, '') }; })()");
const stored = (page, k) => page.eval(`localStorage.getItem(${JSON.stringify(k)})`);
async function analyze(page, sentence, lang) {
  const tr = RESULTS[lang][sentence].translation;
  await page.setValue('#sentence', sentence);
  await page.click('#go');
  await page.waitFor(`!document.getElementById('result').hidden && !!document.querySelector('#result .translation') && document.querySelector('#result .translation').textContent === ${JSON.stringify(tr)}`, 5000);
}
const savedTexts = page => page.eval("[...document.querySelectorAll('.saved-item .pick')].map(b => b.firstChild.textContent)");
const spoken = page => page.eval('window.__speech.spoken');
const cancels = page => page.eval('window.__speech.cancels');
const aiRequests = () => state.requests.filter(r => /explain|ocr/.test(r.url));

test('언어 선택: "일본어 · 영어 · 중국어" 세 링크, 중국어를 고르면 아래 줄에 "간체 · 번체"(기본 간체), 일본어·영어를 고르면 줄이 사라진다', { skip: SKIP }, async () => {
  const page = await open({ clear: true });
  assert.match(await page.eval("document.querySelector('.lang-switch').textContent.replace(/\\s+/g, '')"), /^일본어·영어·중국어$/);
  assert.deepEqual(await zhRow(page), { hidden: true, shown: false, text: '간체·번체' });
  assert.deepEqual(await pressed(page), ['ja']);
  await page.click('.lang-switch [data-lang-group=zh]');
  assert.deepEqual(await pressed(page), ['zh', 'zh-Hans'], '처음 중국어는 간체');
  assert.deepEqual(await zhRow(page), { hidden: false, shown: true, text: '간체·번체' });
  assert.equal(await stored(page, 'jgrammar_lang'), 'zh-Hans');
  const ui = await page.eval("({ lang: document.getElementById('sentence').lang, max: document.getElementById('sentence').maxLength, ph: document.getElementById('sentence').placeholder, count: document.getElementById('count').textContent, aria: document.getElementById('sentence').getAttribute('aria-label'), lead: document.getElementById('lead').textContent })");
  assert.deepEqual(ui, { lang: 'zh-Hans', max: 200, ph: '例：我每天去学校。', count: '0 / 200', aria: '중국어 간체 문장', lead: '중국어(간체) 문장을 입력하면 그 문장을 이해하는 데 필요한 문법을 골라 설명해 드립니다.' });
  await page.click('#zh-switch [data-lang=zh-Hant]');
  assert.deepEqual(await pressed(page), ['zh', 'zh-Hant']);
  assert.equal(await page.eval("document.getElementById('sentence').placeholder"), '例：我每天去學校。');
  assert.equal(await page.eval("document.getElementById('sentence').lang"), 'zh-Hant');
  await page.click('.lang-switch [data-lang=ja]');
  assert.deepEqual(await zhRow(page), { hidden: true, shown: false, text: '간체·번체' });
  assert.deepEqual(await pressed(page), ['ja']);
  await page.click('.lang-switch [data-lang-group=zh]');
  assert.deepEqual(await pressed(page), ['zh', 'zh-Hant'], '중국어를 다시 고르면 마지막에 쓴 번체');
  await page.click('.lang-switch [data-lang=en]');
  assert.equal((await zhRow(page)).hidden, true);
  // 박스 없이 .btn.text, 선택된 항목만 진하게, 터치 영역
  const st = await page.eval(`(() => [...document.querySelectorAll('.lang-switch .btn.text')].map(x => { const c = getComputedStyle(x), r = x.getBoundingClientRect(); return { cls: x.className, bd: c.borderTopWidth, bg: c.backgroundColor, w: c.fontWeight, h: r.height, wd: r.width, vis: r.height > 0 }; }))()`);
  for (const b of st.filter(x => x.vis)) { assert.equal(b.cls, 'btn text'); assert.equal(b.bd, '0px'); assert.equal(b.bg, 'rgba(0, 0, 0, 0)'); assert.ok(b.h >= 44 && b.wd >= 44); }
  assert.equal(await page.hasHorizontalScroll(), false);
  await page.close();
});

test('선택 기억: 중국어 코드와 마지막 간체/번체를 기억(새로 열어도 복원), 저장소가 막혀 있어도 동작', { skip: SKIP }, async () => {
  let page = await open({ clear: true });
  await page.click('.lang-switch [data-lang-group=zh]');
  await page.click('#zh-switch [data-lang=zh-Hant]');
  await page.close();
  page = await open();
  assert.deepEqual(await pressed(page), ['zh', 'zh-Hant'], '새로 열어도 번체');
  assert.equal((await zhRow(page)).shown, true);
  assert.ok(state.requests.some(r => r.url === '/api/jgrammar/saved' && r.query === '?lang=zh-Hant'));
  assert.deepEqual(await savedTexts(page), [T, '你好']);
  await page.click('.lang-switch [data-lang=ja]');
  await page.close();
  page = await open();
  assert.deepEqual(await pressed(page), ['ja']);
  await page.click('.lang-switch [data-lang-group=zh]');
  assert.deepEqual(await pressed(page), ['zh', 'zh-Hant'], '일본어로 나갔다 와도 마지막 번체');
  await page.eval("localStorage.setItem('jgrammar_lang', 'zh')");   // 알 수 없는 저장값은 일본어
  await page.close();
  page = await open();
  assert.deepEqual(await pressed(page), ['ja']);
  await page.eval("localStorage.removeItem('jgrammar_lang'); localStorage.removeItem('jgrammar_zh')");
  await page.close();
  page = await open({ breakStorage: true });
  assert.deepEqual(await pressed(page), ['ja']);
  await page.click('.lang-switch [data-lang-group=zh]');
  assert.deepEqual(await pressed(page), ['zh', 'zh-Hans']);
  await page.click('#zh-switch [data-lang=zh-Hant]');
  assert.deepEqual(await pressed(page), ['zh', 'zh-Hant']);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('간체↔번체·언어를 바꾸면 입력창·결과·메시지를 비우고 읽는 중이면 정지하며 저장 목록을 그 언어 것으로 다시 불러온다', { skip: SKIP }, async () => {
  const page = await open({ stored: 'zh-Hans' });
  await analyze(page, S, 'zh-Hans');
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  const c0 = await cancels(page);
  for (let i = 0; i < 50 && state.requests.filter(r => r.url === '/api/jgrammar/saved').length < 2; i++) await sleep(100);
  await sleep(150);
  await page.eval("document.getElementById('msg').textContent = '이전 메시지'");
  state.requests.length = 0;
  await page.click('#zh-switch [data-lang=zh-Hant]');
  assert.ok((await cancels(page)) > c0, '읽기 정지');
  assert.equal(await page.eval("document.getElementById('result').hidden"), true);
  assert.equal(await page.eval("document.getElementById('result').textContent"), '');
  assert.equal(await page.eval("document.getElementById('sentence').value"), '');
  assert.equal(await page.eval("document.getElementById('msg').textContent"), '');
  await page.waitFor("document.querySelector('.saved-item .pick') && document.querySelector('.saved-item .pick').firstChild.textContent === " + JSON.stringify(T), 4000);
  assert.deepEqual(state.requests.map(r => r.url + r.query), ['/api/jgrammar/saved?lang=zh-Hant'], '목록만 다시 불러오고 AI 는 부르지 않는다');
  await page.click('#zh-switch [data-lang=zh-Hans]');
  await page.waitFor("document.querySelector('.saved-item .pick').firstChild.textContent === " + JSON.stringify(S), 4000);
  assert.deepEqual(await savedTexts(page), [S]);
  await page.close();
});

test('중국어 결과: 원문 한자 위에 병음(<ruby><rt>), lang 을 서버로 전달, HSK 표기(null 생략), 안내문, 병음 끄기/켜기(기억)', { skip: SKIP }, async () => {
  const page = await open({ stored: 'zh-Hans' });
  state.requests.length = 0;
  await analyze(page, S, 'zh-Hans');
  assert.deepEqual(JSON.parse(state.requests.find(r => r.url === '/api/jgrammar/explain').body), { sentence: S, lang: 'zh-Hans' });
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#result .source ruby')].map(r => r.firstChild.textContent + ':' + r.querySelector('rt').textContent)"), ['我:wǒ', '每天:měi tiān', '学习:xué xí', '汉语:hàn yǔ']);
  assert.equal(await page.eval("document.querySelector('#result .source').textContent.replace(/wǒ|měi tiān|xué xí|hàn yǔ/g, '')"), S, '병음을 빼면 원문 그대로');
  assert.equal(await page.eval("document.querySelector('#result .source').lang"), 'zh-Hans');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#result .g-head')].map(h => h.textContent)"), ['동사 술어HSK 3', '시간 부사'], 'HSK 표기, null 은 생략');
  assert.equal(await page.text('#result .disclaimer'), 'AI가 생성한 설명과 병음이라 틀릴 수 있습니다');
  assert.equal(await page.text('#result .furi-toggle'), '병음 끄기');
  await page.click('#result .furi-toggle');
  assert.equal(await page.text('#result .furi-toggle'), '병음 켜기');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#result .source rt')).display"), 'none');
  assert.equal(await stored(page, 'jgrammar_pinyin'), 'off'); assert.equal(await stored(page, 'jgrammar_furigana'), null, '후리가나 기억과 따로');
  await analyze(page, T, 'zh-Hans');   // 간체 화면에 번체 입력: 막지 않고 그대로 보낸다
  assert.equal(JSON.parse(state.requests.filter(r => r.url === '/api/jgrammar/explain').pop().body).sentence, T, '변환 없이 전송');
  assert.equal(await page.text('#result .furi-toggle'), '병음 켜기', '꺼 둔 선택이 유지된다');
  await page.click('#result .furi-toggle');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#result .source rt')).display"), 'ruby-text');
  assert.equal(await stored(page, 'jgrammar_pinyin'), 'on');
  await page.close();
});

test('병음이 없거나 어긋나면 원문만 표시하고 토글 링크를 숨긴다. 일본어의 "후리가나 끄기/켜기"는 그대로', { skip: SKIP }, async () => {
  let page = await open({ stored: 'zh-Hans' });
  await analyze(page, N, 'zh-Hans');
  assert.equal(await page.count('#result rt'), 0); assert.equal(await page.count('#result .furi-toggle'), 0);
  assert.equal(await page.eval("document.querySelector('#result .source').textContent"), N);
  await analyze(page, M, 'zh-Hans');   // 조각을 이어 붙이면 입력과 다름
  assert.equal(await page.count('#result rt'), 0); assert.equal(await page.count('#result .furi-toggle'), 0);
  assert.equal(await page.eval("document.querySelector('#result .source').textContent"), M);
  await page.close();
  page = await open({ stored: 'ja', clear: false });
  await analyze(page, JA_S, 'ja');
  assert.equal(await page.text('#result .furi-toggle'), '후리가나 끄기');
  await page.click('#result .furi-toggle');
  assert.equal(await page.text('#result .furi-toggle'), '후리가나 켜기');
  assert.equal(await stored(page, 'jgrammar_furigana'), 'off');
  await page.eval("localStorage.removeItem('jgrammar_furigana')");
  await page.close();
});

test('병음이 긴 문장(390px): 인접한 한자 병음끼리 겹치지 않고, 화면 밖으로 나가지 않으며, 가로 스크롤이 없다. 후리가나 줄 높이도 정상', { skip: SKIP }, async () => {
  const page = await open({ stored: 'zh-Hans', clear: false });
  await page.eval("localStorage.removeItem('jgrammar_pinyin')");
  await analyze(page, LONG, 'zh-Hans');
  const g = await page.eval(`(() => {
    const rs = [...document.querySelectorAll('#result .source ruby')].map(r => r.getBoundingClientRect());
    const vw = document.documentElement.clientWidth, src = document.querySelector('#result .source').getBoundingClientRect();
    let overlaps = 0, outside = 0, lines = new Set();
    rs.forEach((r, i) => { lines.add(Math.round(r.top)); if (r.right > vw + 0.5 || r.left < -0.5) outside++; const n = rs[i + 1]; if (n && Math.abs(n.top - r.top) < 4 && n.left < r.right - 0.5) overlaps++; });
    const rts = [...document.querySelectorAll('#result .source rt')].map(r => r.getBoundingClientRect());
    let rtOver = 0; rts.forEach((r, i) => { const n = rts[i + 1]; if (n && Math.abs(n.top - r.top) < 4 && n.left < r.right - 0.5) rtOver++; });
    return { count: rs.length, overlaps, rtOver, outside, lines: lines.size, srcRight: src.right, vw, srcH: src.height, det: rs.slice(0, 10).map(r => [r.left, r.right, r.top].map(Math.round).join(',')).join(' | ') };
  })()`);
  assert.equal(g.count, 60);
  assert.equal(g.overlaps, 0, '한자 묶음끼리 겹침 없음 ' + g.det); assert.equal(g.rtOver, 0, '병음끼리 겹침 없음'); assert.equal(g.outside, 0, '화면 밖으로 나가지 않음');
  assert.ok(g.lines >= 2, '여러 줄로 줄바꿈: ' + g.lines);
  assert.ok(g.srcRight <= g.vw + 0.5);
  assert.equal(await page.hasHorizontalScroll(), false);
  assert.equal(await page.eval("document.getElementById('result').scrollWidth <= document.getElementById('result').clientWidth + 1"), true);
  await page.close();
});

test('읽어주기: 간체 zh-CN·번체 zh-TW 음성을 우선, 원문 한자를 그대로(병음 아님) 읽고, 속도 1.0/0.7, 광둥어 음성은 제외', { skip: SKIP }, async () => {
  let page = await open({ stored: 'zh-Hans', voices: [V.hk, V.yue, V.tw, V.cn, V.ja] });
  await analyze(page, S, 'zh-Hans');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#result .speak-area [data-speak]')].map(b => b.textContent)"), ['듣기', '천천히']);
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual((await spoken(page))[0], { text: S, lang: 'zh-CN', rate: 1, voice: 'Tingting' });
  assert.ok(!/wǒ|xué/.test((await spoken(page))[0].text), '병음을 음성에 넘기지 않는다');
  await page.click('#result [data-speak=slow]');
  await page.waitFor('window.__speech.spoken.length === 2', 3000);
  assert.deepEqual([(await spoken(page))[1].rate, (await spoken(page))[1].text], [0.7, S]);
  await page.close();
  page = await open({ stored: 'zh-Hant', voices: [V.hk, V.cn, V.tw, V.ja] });
  await analyze(page, T, 'zh-Hant');
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual((await spoken(page))[0], { text: T, lang: 'zh-TW', rate: 1, voice: 'Meijia' });
  await page.close();
  page = await open({ stored: 'zh-Hans', voices: [V.hk, V.tw, V.ja] });   // zh-CN 이 없으면 그 밖의 zh(zh-TW), 광둥어(zh-HK)는 제외
  await analyze(page, S, 'zh-Hans');
  await page.click('#result [data-speak=normal]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual([(await spoken(page))[0].voice, (await spoken(page))[0].lang], ['Meijia', 'zh-TW']);
  await page.close();
  page = await open({ stored: 'zh-Hant', voices: [V.hk, V.cn, V.ja] });
  await analyze(page, T, 'zh-Hant');
  await page.click('#result [data-speak=slow]');
  await page.waitFor('window.__speech.spoken.length === 1', 3000);
  assert.deepEqual([(await spoken(page))[0].voice, (await spoken(page))[0].lang], ['Tingting', 'zh-CN'], '번체에 zh-TW 가 없으면 다른 zh');
  await page.close();
});

test('음성이 광둥어뿐이거나 중국어가 없으면 링크 대신 "이 기기에서는 중국어 음성을 지원하지 않습니다"', { skip: SKIP }, async () => {
  for (const voices of [[V.hk, V.yue, V.yueZh, V.ja, V.en], [V.ja, V.en]]) {
    const page = await open({ stored: 'zh-Hant', voices });
    await analyze(page, T, 'zh-Hant');
    assert.equal(await page.count('#result [data-speak]'), 0);
    assert.equal(await page.text('#result .speak-note'), '이 기기에서는 중국어 음성을 지원하지 않습니다');
    assert.equal((await spoken(page)).length, 0);
    await page.close();
  }
});

test('긴 중국어 문장은 。！？ 과 ，；： 기준으로 나뉘어 읽히고, 이어 붙이면 원문과 같다(조각마다 80자 이하)', { skip: SKIP }, async () => {
  const page = await open({ stored: 'zh-Hans' });
  await analyze(page, LONG, 'zh-Hans');
  await page.click('#result [data-speak=normal]');
  for (let i = 0; i < 30; i++) { await sleep(60); await page.eval('window.__speech.finish()'); if ((await spoken(page)).length >= 2 && (await spoken(page)).map(x => x.text).join('') === LONG) break; }
  const parts = (await spoken(page)).map(x => x.text);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.ok(Array.from(p).length <= 80, p);
  assert.equal(parts.join(''), LONG);
  assert.ok(parts.slice(0, -1).every(p => /[。！？，；：]$/.test(p)), '문장부호에서 나뉨');
  await page.close();
});

test('입력 검증(중국어): 한자 없음·가나 포함은 서버를 부르지 않고 언어 이름이 든 안내, 간체/번체 글자체는 검사하지 않는다', { skip: SKIP }, async () => {
  const page = await open({ stored: 'zh-Hans' });
  state.requests.length = 0;
  for (const bad of ['Hello world', '안녕하세요', '12345', 'こんにちは', '私は学生です', '学校へ行く']) {
    await page.setValue('#sentence', bad); await page.click('#go');
    assert.equal(await page.text('#msg'), '선택한 언어(중국어 간체)의 문장이 아닙니다. 중국어 문장(한자)을 입력해 주세요.', bad);
  }
  await page.setValue('#sentence', '  '); await page.click('#go');
  assert.equal(await page.text('#msg'), '중국어 문장을 입력해 주세요.');
  await page.eval("document.getElementById('sentence').value = '学'.repeat(201)"); await page.click('#go');
  assert.equal(await page.text('#msg'), '문장은 200자까지 입력할 수 있습니다.');
  assert.deepEqual(aiRequests(), []);
  await page.click('#zh-switch [data-lang=zh-Hant]');
  await page.setValue('#sentence', 'こんにちは'); await page.click('#go');
  assert.equal(await page.text('#msg'), '선택한 언어(중국어 번체)의 문장이 아닙니다. 중국어 문장(한자)을 입력해 주세요.');
  assert.deepEqual(aiRequests(), []);
  await analyze(page, S, 'zh-Hant');   // 번체 화면에 간체 입력도 통과
  assert.deepEqual(JSON.parse(aiRequests()[0].body), { sentence: S, lang: 'zh-Hant' });
  await page.close();
});

test('저장 목록: 간체·번체 각각 표시, 항목을 열면 AI·서버 호출 없이 저장된 결과(병음·HSK)를 보여 준다', { skip: SKIP }, async () => {
  const page = await open({ stored: 'zh-Hant' });
  assert.deepEqual(await savedTexts(page), [T, '你好']);
  state.requests.length = 0;
  await page.click('.saved-item .pick');
  await page.waitFor(`document.querySelector('#result .translation') && document.querySelector('#result .translation').textContent === ${JSON.stringify(RESULTS['zh-Hant'][T].translation)}`, 3000);
  assert.deepEqual(aiRequests(), []);
  assert.equal(await page.eval("document.getElementById('sentence').value"), T);
  assert.equal(await page.count('#result .source rt'), 4); assert.equal(await page.text('#result .g-level'), 'HSK 3');
  await page.click('.saved-item:nth-of-type(2) .pick');
  await page.waitFor("document.querySelector('#result .translation').textContent === '안녕'", 3000);
  assert.equal(await page.count('#result .furi-toggle'), 0, 'ruby null 이면 토글 없음');
  assert.deepEqual(aiRequests(), []);
  await page.close();
});

test('사진 입력: 선택한 언어 코드(zh-Hans/zh-Hant)를 서버로 보낸다. 인식 후 입력창에 채우고 바로 분석하지 않는다', { skip: SKIP }, async () => {
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const shoot = `(() => { const b = Uint8Array.from(atob('${PNG_1X1}'), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([b], 'a.png', { type: 'image/png' })); const f = document.getElementById('file-gallery'); f.files = dt.files; f.dispatchEvent(new Event('change')); })()`;
  const page = await open({ stored: 'zh-Hans' });
  for (const [code, first] of [['zh-Hans', '你好吗？'], ['zh-Hant', '你好嗎？']]) {
    if (code === 'zh-Hant') await page.click('#zh-switch [data-lang=zh-Hant]');
    state.requests.length = 0;
    await page.eval(shoot);
    await page.waitFor("document.querySelectorAll('#picks .pick').length === 2", 6000);
    assert.equal(state.requests.find(r => r.url === '/api/jgrammar/ocr').query, '?lang=' + code);
    await page.click('#picks .pick');
    assert.equal(await page.eval("document.getElementById('sentence').value"), first);
    assert.equal(state.requests.filter(r => r.url === '/api/jgrammar/explain').length, 0);
  }
  await page.close();
});

test('소스 규칙: innerHTML 없음, 병음은 textContent 로만(HTML 문자열 원문도 글자 그대로)', { skip: SKIP }, async () => {
  const html = fs.readFileSync(path.join(PUB, 'jgrammar.html'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html.replace(/\/\/[^\n]*/g, '')));
  const evil = '我<img src=x onerror=window.__x=1>';
  RESULTS['zh-Hans'][evil] = R('x', [{ text: '我', reading: 'wǒ' }, { text: '<img src=x onerror=window.__x=1>' }]);
  const page = await open({ stored: 'zh-Hans' });
  await page.setValue('#sentence', evil); await page.click('#go');
  await page.waitFor("!document.getElementById('result').hidden", 5000);
  assert.equal(await page.count('#result img'), 0); assert.equal(await page.eval('window.__x'), undefined);
  assert.equal(await page.eval("document.querySelector('#result .source').textContent.replace('wǒ', '')"), evil);
  delete RESULTS['zh-Hans'][evil];
  await page.close();
});
