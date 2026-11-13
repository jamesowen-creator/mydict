// 작업416: 영어 검색 뜻 표현 원칙(프롬프트·검증·저장). 자체 임시 서버(정적 파일 + 가짜 /api/me·/api/wordbook·/api/ai). 실제 AI·DB·운영 서버와 무관.
// 확인: 규칙에 맞는 응답 → gloss_v=1·short_meaning=대표 합침·definition ", "·short_gloss 없음·호출 2회 / 문장 섞인 응답 → 유효 항목만, 전부 문장이면 원본 저장·gloss_v 없음 /
//       결과 화면 구조 그대로 / 단어장 로드 시 /api/ai 0회 / localStorage 예외에도 검색 진행 / 프롬프트 핵심 문구 / 한국어 검색 불변
// 실행: node --test tests/ui/dictionary_gloss416.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

let srv, base, browser;
const state = { ai: [], posts: [], plan: [], rows: [] };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), u = url.pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.startsWith('/api/')) {
      const chunks = []; req.on('data', d => chunks.push(d));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        if (u === '/api/me') return json(200, { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', can_search: true, can_wordbook: true, can_quiz: true, can_tts: true, can_podcast: true });
        if (u === '/api/wordbook' && req.method === 'GET') return json(200, state.rows);
        if (u === '/api/wordbook' && req.method === 'POST') { state.posts.push(body); return json(200, { id: 100 + state.posts.length, word: body.word, lang: body.lang }); }
        if (u === '/api/ai') { state.ai.push(body && body.prompt); const p = state.plan.shift(); return p ? json(200, { result: typeof p === 'string' ? p : JSON.stringify(p) }) : json(500, { error: '모의 응답 없음' }); }
        if (u === '/api/tts') return json(503, { error: '모의' });
        json(200, req.method === 'GET' ? [] : {});
      });
      return;
    }
    const f = path.join(PUB, u);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await launchBrowser();
});
test.after(async () => { if (browser) await browser.close(); if (srv) await new Promise(r => srv.close(r)); });

const quick = (meanings, extra) => Object.assign({ word: 'scrutinize', search_query: 'scrutinize', pronunciation: '/ˈskruːtənaɪz/', meanings, derivatives: [] }, extra || {});
const detail = n => ({ meanings: Array.from({ length: n }, (_, i) => ({ usage_note: '쓰임 설명 ' + i, example: 'Example ' + i + '.', translation: '예문 ' + i })), similar: [], collocations: [] });

async function open({ rows = [], storageBlocked = false } = {}) {
  state.ai.length = 0; state.posts.length = 0; state.plan.length = 0; state.rows = rows;
  const page = await browser.newPage({ width: 390, height: 900, token: 'x' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('mydict_token', ${JSON.stringify(TOKEN)}); } catch (e) {}` });
  await page.goto(base + '/english_dictionary.html');
  await page.waitFor("typeof applyGloss === 'function' && typeof wordbook !== 'undefined' && !!document.querySelector('.metis-app-header-logo')", 12000);
  await sleep(400);   // 단어장 로드(백필이 있던 시절에는 여기서 /api/ai 호출이 나갔다)
  if (storageBlocked) await page.eval("Storage.prototype.setItem = function () { throw new Error('막힘'); }");
  return page;
}
const search = async (page, q, wantPost = true) => {
  await page.eval(`document.getElementById('search-input').value = ${JSON.stringify(q)}; doSearch();`);
  if (wantPost) await page.waitFor(`document.querySelector('#search-result .result-word') && document.querySelector('#search-result .result-word').textContent === ${JSON.stringify(q)}`, 8000);
  const end = Date.now() + 6000; while (wantPost && state.posts.length < 1 && Date.now() < end) await sleep(40);
  await sleep(150);
};
const noErrors = page => assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);

test('A 규칙에 맞는 응답: definition ", " 정리(뜻마다 최대 3개)·short_meaning=뜻별 대표 합침·gloss_v=1·short_gloss 없음, AI 호출은 1차+2차 2회, 화면 구조 그대로', { skip: SKIP }, async () => {
  const page = await open();
  state.plan.push(quick([{ pos: 'verb', domain: '일반', definition: '신중하게 검토하다; 정밀 조사하다, 세밀히 살피다, 더 있는 말' }, { pos: 'verb', domain: '일반', definition: '꼼꼼히 보다' }], { short_gloss: '검토하다' }), detail(2));
  await search(page, 'scrutinize');
  assert.equal(state.ai.length, 2, '호출 수 변동 없음(1차+2차)');
  assert.equal(state.posts.length, 1);
  const d = state.posts[0].data;
  assert.equal(d.gloss_v, 1); assert.equal(d.short_gloss, undefined, 'short_gloss 는 저장하지 않는다');
  assert.equal(d.short_meaning, '신중하게 검토하다, 꼼꼼히 보다');
  assert.deepEqual(d.meanings.map(m => m.definition), ['신중하게 검토하다, 정밀 조사하다, 세밀히 살피다', '꼼꼼히 보다']);
  assert.equal(d.meanings[0].usage_note, '쓰임 설명 0', '2차의 usage_note 는 그대로 합쳐진다');
  // 결과 화면: 뜻 영역이 definition 을 그대로 표시하고 기존 구조·클래스가 같다
  const dom = await page.eval(`(() => ({ cores: [...document.querySelectorAll('#search-result .meaning-set .meaning-core')].map(e => e.textContent), sets: document.querySelectorAll('#search-result .meaning-set').length, headers: document.querySelectorAll('#search-result .meaning-set .meaning-header .meaning-num').length, pos: document.querySelectorAll('#search-result .meaning-set .result-pos-tag').length, nuance: [...document.querySelectorAll('#search-result .meaning-nuance')].map(e => e.textContent), title: [...document.querySelectorAll('#search-result .result-section-title')].map(e => e.textContent), card: !!document.querySelector('#search-result .result-card') }))()`);
  assert.deepEqual(dom.cores, ['신중하게 검토하다, 정밀 조사하다, 세밀히 살피다', '꼼꼼히 보다']);
  assert.deepEqual([dom.sets, dom.headers, dom.pos, dom.card], [2, 2, 2, true]);
  assert.deepEqual(dom.nuance, ['쓰임 설명 0', '쓰임 설명 1']); assert.ok(dom.title.includes('사전적 의미'));
  // 2차 프롬프트는 정리된 정의를 그대로 이어받는다
  assert.match(state.ai[1], /1\. \[verb\] 신중하게 검토하다, 정밀 조사하다, 세밀히 살피다/);
  noErrors(page); await page.close();
});

test('B 문장이 섞인 응답: 문장 항목·문장뿐인 뜻은 버리고 유효한 것만 저장, 2차 프롬프트도 남은 뜻만', { skip: SKIP }, async () => {
  const page = await open();
  state.plan.push(quick([{ pos: 'verb', definition: '무언가를 매우 자세히 살펴보는 것입니다. 신중하게' }, { pos: 'verb', definition: '살피다, 검토하다., 조사하다' }]), detail(1));
  await search(page, 'scrutinize');
  const d = state.posts[0].data;
  assert.deepEqual(d.meanings.map(m => m.definition), ['살피다, 조사하다']); assert.equal(d.short_meaning, '살피다'); assert.equal(d.gloss_v, 1);
  assert.match(state.ai[1], /1\. \[verb\] 살피다, 조사하다/); assert.doesNotMatch(state.ai[1], /2\. \[/);
  assert.equal(state.ai.length, 2);
  noErrors(page); await page.close();
});

test('B 전부 문장인 응답: 원본 그대로 저장, short_meaning=첫 뜻 definition, gloss_v 없음, 검색은 실패하지 않고 호출은 2회', { skip: SKIP }, async () => {
  const page = await open();
  const raw = [{ pos: 'verb', domain: '일반', definition: '무언가를 매우 자세하고 신중하게 살펴보거나 검토하다.' }, { pos: 'verb', domain: '일반', definition: '철저히 조사하는 행위입니다.' }];
  state.plan.push(quick(raw, { short_gloss: '옛 값' }), detail(2));
  await search(page, 'scrutinize');
  const d = state.posts[0].data;
  assert.equal(d.gloss_v, undefined); assert.equal(d.short_gloss, undefined);
  assert.deepEqual(d.meanings.map(m => m.definition), raw.map(m => m.definition), '원본 그대로');
  assert.equal(d.short_meaning, raw[0].definition);
  assert.equal(state.ai.length, 2, '재시도 없음');
  assert.ok(await page.eval("document.querySelectorAll('#search-result .meaning-set').length") === 2, '결과는 그대로 그려진다');
  noErrors(page); await page.close();
});

test('C 단어장 로드: 짧은 뜻이 없는 옛 단어가 있어도 /api/ai 호출 0회(백필 없음), short_meaning 은 건드리지 않는다', { skip: SKIP }, async () => {
  const old = { id: 5, word: 'oldword', lang: 'en', created_at: new Date().toISOString(), source: 'manual', data: { word: 'oldword', lang: 'en', nuance: '옛 구조의 긴 설명입니다.', meanings: [{ pos: 'noun', definition: '정도가 매우 심하거나 극단적인 상태를 이르는 말' }] } };
  const page = await open({ rows: [old] });
  await sleep(1200);
  assert.equal(state.ai.length, 0, '로드 중 AI 호출 없음');
  assert.equal(await page.eval("typeof backfillShortMeanings"), 'undefined');
  assert.equal(await page.eval("wordbook[0].short_meaning"), undefined, '메모리 값도 채우지 않는다');
  noErrors(page); await page.close();
});

test('D localStorage 가 막혀 예외를 던져도 검색은 끝까지 진행되고 결과가 그려지며 저장도 된다', { skip: SKIP }, async () => {
  const page = await open({ storageBlocked: true });
  state.plan.push(quick([{ pos: 'noun', definition: '사과, 사과나무' }]), detail(1));
  await search(page, 'scrutinize');
  assert.equal(state.posts.length, 1);
  assert.ok(await page.eval("!!document.querySelector('#search-result .result-card .meaning-core')"));
  await page.eval("save()");   // 직접 불러도 예외가 밖으로 나오지 않는다
  noErrors(page); await page.close();
});

test('E 프롬프트: 원칙 핵심 문구가 들어 있고 short_gloss 요구·옛 예외 문구는 없다. 2차 프롬프트 구조는 그대로', { skip: SKIP }, async () => {
  const page = await open();
  state.plan.push(quick([{ pos: 'noun', definition: '사과' }]), detail(1));
  await search(page, 'scrutinize');
  const p1 = state.ai[0], p2 = state.ai[1];
  for (const phrase of ['뜻 표현 원칙: 한국어 뜻은 문장이 아니라', "'~하는 것', '무언가를 ~' 같은 사전식 문장체, 마침표, 설명 덧붙이기를 쓰지 않는다", 'meanings[].definition에는 그 뜻의 대응어를 2~3개 쉼표로 나열한다', '쓰임·뉘앙스·상황 설명은 2차 usage_note가 맡으므로 definition에 넣지 않는다', 'scrutinize → 신중하게 검토하다, 정밀 조사하다', 'ambiguous → 애매한, 모호한', 'run → (뜻1) 달리다, 뛰다 (뜻2) 운영하다, 경영하다 (뜻3) 흐르다']) assert.ok(p1.includes(phrase), '원칙 문구: ' + phrase);
  assert.ok(!p1.includes('short_gloss'), 'short_gloss 요구 없음');
  for (const old of ['단어 하나로 어색하면', '지나치게 줄이지는 말고', '2~4개를 쉼표로 나열', '2~3단어 짧은 구 형태']) assert.ok(!p1.includes(old), '옛 예외 문구 없음: ' + old);
  assert.match(p1, /meanings: 2-4 entries, ordered by REAL-WORLD USAGE FREQUENCY/, '뜻 개수·빈도순 규칙 유지');
  assert.match(p1, /"derivatives"/); assert.match(p1, /"domain": "일반"/);
  assert.match(p2, /STEP 2 of 2/); assert.match(p2, /"usage_note"/); assert.match(p2, /"collocations"/);
  await page.close();
});

test('F 변경 없음: 한국어 검색은 같은 프롬프트·저장(short_meaning = nuance 앞 20자, gloss_v 없음)이고 사전 결과 화면이 그려진다', { skip: SKIP }, async () => {
  const page = await open();
  const ko = { word: '사과', headline: '과일', etymology: '', tone: '', derivatives: [], nuance: '둥글고 달콤한 과일을 뜻하는 말로 일상에서 가장 흔히 쓰입니다.', pos: ['noun'], entries: [{ english: 'apple', pos: ['noun'], pronunciation: '/ˈæpəl/', meaning: '과일', example: 'I ate an apple.', translation: '사과를 먹었다.' }] };
  state.plan.push(ko);
  await page.eval("document.getElementById('search-input').value = '사과'; doSearch();");
  const end = Date.now() + 6000; while (state.posts.length < 1 && Date.now() < end) await sleep(40);
  assert.equal(state.ai.length, 1, '한국어 검색은 1회 호출');
  assert.match(state.ai[0], /Korean-English dictionary assistant/);
  const d = state.posts[0].data;
  assert.equal(d.short_meaning, ko.nuance.slice(0, 20)); assert.equal(d.gloss_v, undefined); assert.equal(d.lang, 'ko');
  noErrors(page); await page.close();
});
