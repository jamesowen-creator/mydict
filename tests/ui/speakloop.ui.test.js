// 작업399: Speak Loop 독백 연습 화면 시험(헤드리스 Chrome). 자체 임시 서버(정적 파일 + 모의 API) + 가짜 오디오 — OpenAI·DB·운영 서버와 무관.
// 확인: 390/1280px 가로 스크롤 없음·독백 10개·버튼 44px·모서리 허용 집합·알약/이모지 없음·음성 없음 표시와 재생 안 함·쌓아가기 순서와 중지·가리기·자가 평가 기록·권한 없음 안내
// 실행: node --test tests/ui/speakloop.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome, sleep } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const CONTENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'speakloop', 'content.json'), 'utf8'));
const ALL_KEYS = [];
for (const m of CONTENT.monologues) m.lines.forEach((l, i) => { ALL_KEYS.push(m.id + '.l' + i); l.chunks.forEach((c, j) => ALL_KEYS.push(m.id + '.l' + i + '.c' + j)); });
const MISSING = 'm-delay.l0.c1';   // 음성이 아직 없는 구

let srv, base, browser;
const state = { me: null, contentStatus: 200, progress: [], posts: [], audioRequests: [], progressFail: false, noIndex: false };
function resetState() {
  Object.assign(state, { me: { id: 1, role: 'user', perm_speakloop: true }, contentStatus: 200, progress: [], posts: [], audioRequests: [], progressFail: false, noIndex: false });
}
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
        if (u === '/api/me') return json(200, state.me);
        if (u === '/api/speakloop/content') return state.contentStatus === 200 ? json(200, CONTENT) : json(state.contentStatus, { ok: false });
        if (u === '/api/speakloop/audio-index') {
          if (state.noIndex) return json(500, { ok: false });
          const index = {}; ALL_KEYS.forEach(k => { if (k !== MISSING) index[k] = 'h-' + k; });
          return json(200, { ok: true, index });
        }
        if (u.startsWith('/api/speakloop/audio/')) { state.audioRequests.push(decodeURIComponent(u.slice('/api/speakloop/audio/'.length))); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end('MP3'); }
        if (u === '/api/speakloop/progress' && req.method === 'GET') return state.progressFail ? json(500, { ok: false }) : json(200, { ok: true, items: state.progress });
        if (u === '/api/speakloop/progress' && req.method === 'POST') {
          const b = JSON.parse(body || '{}'); state.posts.push(b);
          if (state.progressFail) return json(500, { ok: false });
          const old = state.progress.find(p => p.item_id === b.item_id);
          const item = { item_id: b.item_id, count: (old ? old.count : 0) + 1, last_rating: b.rating, last_at: new Date().toISOString() };
          state.progress = state.progress.filter(p => p.item_id !== b.item_id).concat([item]);
          return json(200, { ok: true, item });
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
test.beforeEach(resetState);

// 가짜 오디오: 재생 요청 키·속도를 기록하고, 클립 길이만큼(문장 0.10초, 구 0.05초) 지난 뒤 ended 를 낸다. 소리는 나지 않는다
const FAKE_AUDIO = `(() => {
  window.__plays = [];
  const of = window.fetch.bind(window);
  window.fetch = async (u, o) => {
    const r = await of(u, o);
    const m = /\\/api\\/speakloop\\/audio\\/(.+)$/.exec(String(u));
    if (!m) return r;
    const blob = await r.blob(); blob.__key = decodeURIComponent(m[1]);
    return { ok: r.ok, status: r.status, blob: async () => blob };
  };
  URL.createObjectURL = b => 'fake:' + b.__key;
  URL.revokeObjectURL = () => {};
  window.Audio = class {
    constructor(src) { this.L = {}; this.playbackRate = 1; if (src) this.src = src; }
    set src(v) { this._src = v; setTimeout(() => this.emit('loadedmetadata'), 0); }
    get src() { return this._src; }
    get duration() { return /\\.c\\d+$/.test(this._src || '') ? 0.05 : 0.1; }
    addEventListener(n, f) { (this.L[n] = this.L[n] || []).push(f); }
    emit(n) { (this.L[n] || []).forEach(f => f()); }
    play() { window.__plays.push({ key: this._src.slice(5), rate: this.playbackRate }); this.t = setTimeout(() => this.emit('ended'), this.duration * 1000); return Promise.resolve(); }
    pause() { clearTimeout(this.t); }
  };
})();`;

async function open({ width = 390 } = {}) {
  const page = await browser.newPage({ width, height: 844 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_AUDIO });
  await page.goto(base + '/speakloop.html');
  return page;
}
async function ready(page) { await page.waitFor("!document.getElementById('main').hidden && document.querySelectorAll('.item').length > 0", 8000); }
async function enter(page, title) {
  await page.eval(`[...document.querySelectorAll('.item')].find(b => b.textContent.includes(${JSON.stringify(title)})).click()`);
  await page.waitFor("!!document.querySelector('.mono-title')", 5000);
}
const clickText = (page, label) => page.eval(`(() => { const b = [...document.querySelectorAll('#view button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
const plays = page => page.eval('window.__plays.map(p => p.key)');

test('목록: 독백 10개, 카테고리 필터, 연습 기록(없으면 "아직 안 함"), 탭 2개(이디엄 세션은 비활성·준비 중)', { skip: SKIP }, async () => {
  state.progress = [{ item_id: 'm-delay', count: 2, last_rating: 'some', last_at: '2026-11-01T00:00:00Z' }];
  const page = await open();
  await ready(page);
  assert.equal(await page.count('.item'), 10);
  const metas = await page.eval("[...document.querySelectorAll('.item')].map(b => b.querySelector('.item-meta').textContent)");
  assert.equal(metas[0], '연습 2회 · 최근 몇 군데 막힘');
  assert.equal(metas.filter(t => t === '아직 안 함').length, 9);
  const tops = await page.eval("[...document.querySelectorAll('.top-tabs .tab')].map(b => [b.textContent, b.getAttribute('aria-pressed'), b.disabled])");
  assert.deepEqual(tops, [['독백 연습', 'true', false], ['이디엄 세션', 'false', true]]);
  assert.match(await page.text('.top-tabs'), /준비 중/);
  const cats = CONTENT.monologues.reduce((o, m) => (o[m.cat] = (o[m.cat] || 0) + 1, o), {});
  await clickText(page, '비즈니스');
  assert.equal(await page.count('.item'), cats['비즈니스']);
  await clickText(page, '일상');
  assert.equal(await page.count('.item'), cats['일상']);
  await clickText(page, '전체');
  assert.equal(await page.count('.item'), 10);
  await page.close();
});

const AUDIT = `(() => {
  const bad = [];
  document.querySelectorAll('button, a.btn, a.screen-bar-back, .item').forEach(b => { const r = b.getBoundingClientRect(); if (r.width === 0) return; if (r.height < 43.5) bad.push('높이 ' + r.height + ' ' + (b.textContent || b.className).slice(0, 20)); });
  const radii = new Set();
  document.querySelectorAll('.content *').forEach(n =>   /* 공용 헤더·화면 제목 줄(8px)은 이 화면 소관이 아니라 제외 */ { const c = getComputedStyle(n); [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomLeftRadius, c.borderBottomRightRadius].forEach(v => radii.add(v)); });
  const emoji = /[\\u{1F000}-\\u{1FAFF}\\u{23E9}-\\u{23FA}\\u{2600}-\\u{26FF}\\u{2702}-\\u{27BF}\\u{2B50}\\u{2B55}]/u.test(document.body.innerText);
  return { bad, radii: [...radii], emoji, scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
})()`;
const ALLOWED_RADII = new Set(['0px', '10px', '16px', '50%']);

test('390px·1280px: 가로 스크롤 없음, 버튼 높이 ≥44, 모서리 0/10/16/50% 뿐(알약 없음), 이모지 없음 — 목록과 4개 모드', { skip: SKIP }, async () => {
  for (const width of [390, 1280]) {
    const page = await open({ width });
    await ready(page);
    const check = async label => {
      const a = await page.eval(AUDIT);
      assert.deepEqual(a.bad, [], width + ' ' + label + ' 버튼 높이');
      assert.deepEqual(a.radii.filter(r => !ALLOWED_RADII.has(r)), [], width + ' ' + label + ' 모서리');
      assert.equal(a.emoji, false, width + ' ' + label + ' 이모지');
      assert.equal(a.scroll, false, width + ' ' + label + ' 가로 스크롤');
    };
    await check('목록');
    await enter(page, '프로젝트가 미뤄진 이유');
    for (const mode of ['듣고 이해', '문장 훈련', '외우기', '통째로 말하기']) {
      await clickText(page, mode);
      await check(mode);
    }
    await clickText(page, '외우기'); await clickText(page, '한국어만'); await check('외우기-가림');
    await page.close();
  }
});

test('음성 없는 구는 "음성 없음" 글자만 보이고 재생을 시도하지 않는다(다른 구는 재생됨)', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  const row = "document.querySelector('.chunk[data-key=\"" + MISSING + "\"]')";
  assert.equal(await page.eval(row + ".querySelector('button')"), null, '버튼 없음');
  assert.equal(await page.eval(row + ".querySelector('.noaudio').textContent"), '음성 없음');
  await page.waitFor("window.__plays !== undefined", 2000);
  assert.ok(!(await page.eval('window.__plays')).length, '자동 재생 없음');
  await page.eval("document.querySelector('.chunk[data-key=\"m-delay.l0.c0\"] button').click()");
  await page.waitFor("window.__plays.length === 1", 3000);
  assert.deepEqual(await plays(page), ['m-delay.l0.c0']);
  await sleep(300);
  assert.ok(!state.audioRequests.includes(MISSING), '없는 키는 요청도 하지 않음');
  // 이 구가 든 문장은 쌓아가기를 쓸 수 없다고 알린다
  await clickText(page, '문장 훈련');
  assert.match(await page.text('.toolbar'), /쌓아가기: 음성 없음/);
  await page.close();
});

test('표시 규칙: 표현 구는 굵기 600·포인트색, 억양 화살표 ↘ ↗(쉼표는 없음), 속도 선택(느리게 0.8)', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  const s = await page.eval(`(() => {
    const row = k => document.querySelector('.chunk[data-key="' + k + '"]');
    const css = e => { const c = getComputedStyle(e); return [c.fontWeight, c.color]; };
    const body = getComputedStyle(document.body).color;
    return { k: css(row('m-delay.l0.c1').querySelector('.en')), plain: css(row('m-delay.l0.c0').querySelector('.en')), body,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent-ink').trim(),
      arrows: ['m-delay.l0.c0', 'm-delay.l0.c1', 'm-delay.l0.c2'].map(k => (row(k).querySelector('.arrow') || { textContent: '' }).textContent) };
  })()`);
  assert.equal(s.k[0], '600');
  assert.equal(s.k[1], 'rgb(184, 68, 46)', '--color-accent-ink');
  assert.equal(s.plain[0], '400');
  assert.equal(s.plain[1], s.body);
  assert.deepEqual(s.arrows, ['', '', '↘']);
  const pressed = () => page.eval("[...document.querySelectorAll('[aria-label=\"재생 속도\"] .tab')].map(b => b.getAttribute('aria-pressed') + ':' + getComputedStyle(b).fontWeight + ':' + getComputedStyle(b).borderBottomWidth)");
  assert.deepEqual(await pressed(), ['false:500:2px', 'true:700:2px'], '선택은 굵기 700 + 아래 선, 기본은 원래 속도');
  await clickText(page, '느리게');
  assert.deepEqual(await pressed(), ['true:700:2px', 'false:500:2px']);
  await page.eval("document.querySelector('.chunk[data-key=\"m-delay.l1.c0\"] button').click()");
  await page.waitFor("window.__plays.length === 1", 3000);
  assert.equal(await page.eval('window.__plays[0].rate'), 0.8);
  await page.close();
});

test('문장 훈련: 쌓아가기가 구1, 구1+2, … 순서로 재생되고 마지막에 문장 전체 1회, 쉬는 시간에는 안내 글이 나온다', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '문장 훈련');
  await clickText(page, '2');   // 2번 문장(구 4개, 모두 음성 있음)
  assert.match(await page.text('.note'), /발음 표기·강세는 참고용입니다\(검수 전\)/);
  assert.equal(await page.count('.phrase'), 4, '작업400: 구별 소리 표기 블록');
  assert.equal(await page.count('.stress') + await page.count('.idiom'), 0, '작업400: 옛 강세 글자·연음 목록은 없다');
  await clickText(page, '쌓아가기');
  await page.waitFor("window.__plays.length >= 11", 10000);
  const p = (await plays(page)).map(k => k.replace('m-delay.l1', ''));
  assert.deepEqual(p, ['.c0', '.c0', '.c1', '.c0', '.c1', '.c2', '.c0', '.c1', '.c2', '.c3', '']);
  await page.waitFor("document.getElementById('stop').hidden", 3000);
  await page.close();
});

test('쌓아가기 중 [중지]를 누르면 즉시 멈추고 이어서 재생되지 않는다. 문장 3회 반복도 같다', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '문장 훈련');
  await clickText(page, '2');
  await clickText(page, '쌓아가기');
  await page.waitFor("window.__plays.length >= 2 && !document.getElementById('stop').hidden", 5000);
  assert.ok(await page.visible('#stop'));
  await page.click('#stop');
  const n = (await plays(page)).length;
  await sleep(900);
  assert.equal((await plays(page)).length, n, '중지 뒤 재생 없음');
  assert.equal(await page.eval("document.getElementById('stop').hidden"), true);
  await page.eval('window.__plays.length = 0');
  await clickText(page, '문장 전체 3회 반복 쉐도잉');
  await page.waitFor("window.__plays.length === 3", 8000);
  assert.deepEqual(await plays(page), ['m-delay.l1', 'm-delay.l1', 'm-delay.l1']);
  // 새 재생을 누르면 이전 진행은 취소된다
  await clickText(page, '쌓아가기');
  await page.waitFor("window.__plays.length >= 4", 5000);
  await page.eval("document.querySelector('.chunk[data-key=\"m-delay.l1.c3\"] button').click()");
  await sleep(100);
  const after = (await plays(page)).length;
  await sleep(700);
  const tail = (await plays(page)).slice(after);
  assert.ok(tail.every(k => k === 'm-delay.l1.c3') || tail.length === 0, '새 재생 뒤 쌓아가기가 이어지지 않음: ' + tail.join(','));
  await page.close();
});

test('외우기: 단계별 가림(첫 글자+밑줄), 탭하면 공개되고 그 구가 재생되며, 전체 가리기 다시로 되돌린다', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '외우기');
  assert.equal(await page.count('.masked'), 0, '전체 보기');
  await clickText(page, '표현 구 가림');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.masked')].map(b => b.textContent)"),
    ['t__ l_____ g__ p_____ b___', 'T__ t____ i_,', 'l___ i_ t__ g___.', 'R_____ t___ r______ i_ o__,', 'F___ h___ o_,', 'H______,'], '표현 구(k)만 첫 글자+밑줄, 단어당 밑줄 최대 6개');
  await clickText(page, '1·3·5구 가림');
  assert.equal(await page.count('.masked'), 2 + 2 + 2 + 2 + 2, '줄마다 1·3(·5)번째 구');
  await clickText(page, '첫 구만 보임');
  assert.equal(await page.count('.masked'), 2 + 3 + 3 + 2 + 3, '첫 구를 뺀 나머지');
  await clickText(page, '한국어만');
  assert.equal(await page.count('.masked'), 18);
  await page.eval("document.querySelector('.masked').click()");
  await page.waitFor("window.__plays.length === 1", 3000);
  assert.equal(await page.count('.masked'), 17, '탭한 구는 공개');
  await clickText(page, '전체 가리기 다시');
  assert.equal(await page.count('.masked'), 18);
  await page.close();
});

test('통째로 말하기: 5문장을 모두 끝내야 자가 평가가 나오고, 한 번 누르면 기록·비활성(연타해도 1회), 결과 글 표시', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '통째로 말하기');
  await clickText(page, '먼저 말하기');
  assert.equal(await page.count('.rating'), 0);
  await clickText(page, '힌트');
  assert.equal((await page.text('.hint')).replace(/\s+/g, ' '), 'S');
  await clickText(page, '힌트');
  assert.equal((await page.text('.hint')).replace(/\s+/g, ' '), 'S / t l g p b');
  await clickText(page, '확인');
  await page.waitFor("window.__plays.length === 1", 3000);
  for (let i = 0; i < 4; i++) { assert.equal(await page.count('.rating'), 0); await clickText(page, '다음 문장'); }
  assert.equal(await page.count('.rating'), 0, '4문장까지 끝낸 상태');
  await clickText(page, '마지막 문장 마침');
  await page.waitFor("document.querySelectorAll('.rating').length === 1", 3000);
  assert.equal(await page.count('.rating .btn'), 3);
  await page.eval("(() => { const b = document.querySelector('.rating [data-rating=some]'); b.click(); b.click(); })()");
  await page.waitFor("/기록했습니다\\. 연습 1회/.test(document.querySelector('.rating').textContent)", 4000);
  assert.deepEqual(state.posts, [{ item_id: 'm-delay', rating: 'some' }]);
  assert.equal(await page.eval("[...document.querySelectorAll('.rating .btn')].every(b => b.disabled)"), true);
  // 목록으로 돌아가면 연습 횟수가 바로 반영된다
  await clickText(page, '목록으로');
  assert.equal(await page.eval("document.querySelector('.item-meta').textContent"), '연습 1회 · 최근 몇 군데 막힘');
  await page.close();
});

test('평가 전에 나가면 기록하지 않는다. 저장이 실패해도 안내하고 다시 누를 수 있다', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '통째로 말하기');
  for (let i = 0; i < 3; i++) await clickText(page, '다음 문장');
  await clickText(page, '목록으로');
  assert.equal(state.posts.length, 0);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '통째로 말하기');
  state.progressFail = true;
  for (let i = 0; i < 4; i++) await clickText(page, '다음 문장');
  await clickText(page, '마지막 문장 마침');
  await page.waitFor("document.querySelectorAll('.rating').length === 1", 3000);
  await page.click('.rating [data-rating=good]');
  await page.waitFor("/기록하지 못했습니다/.test(document.querySelector('.rating').textContent)", 4000);
  assert.equal(await page.eval("[...document.querySelectorAll('.rating .btn')].every(b => !b.disabled)"), true, '실패하면 다시 누를 수 있다');
  state.progressFail = false;
  await page.click('.rating [data-rating=good]');
  await page.waitFor("/기록했습니다\\. 연습 1회/.test(document.querySelector('.rating').textContent)", 4000);
  assert.equal(state.posts.length, 2);
  await page.close();
});

test('권한 없음(perm false·403): 안내 글자와 홈 버튼만 보이고 콘텐츠를 요청하지 않는다. 로그인 없음도 같다', { skip: SKIP }, async () => {
  state.me = { id: 1, role: 'user', perm_speakloop: false };
  let page = await open();
  await page.waitFor("!document.getElementById('denied').hidden", 5000);
  assert.equal(await page.text('#denied .msg'), '접근 권한이 없습니다. 관리자에게 문의하세요.');
  assert.equal(await page.eval("document.querySelector('#denied a').getAttribute('href')"), '/');
  assert.equal(await page.eval("document.getElementById('main').hidden"), true);
  await page.close();
  state.me = { id: 1, role: 'user', perm_speakloop: true }; state.contentStatus = 403;   // 서버가 거절하면 같은 안내
  page = await open();
  await page.waitFor("!document.getElementById('denied').hidden", 5000);
  await page.close();
  state.me = { id: 1, role: 'admin' }; state.contentStatus = 200;
  page = await open();
  await ready(page);   // 관리자는 권한 열 없이도 열린다
  await page.close();
});

test('오류 알림: 콘텐츠 실패·음성 목록 실패·기록 목록 실패를 글자로 알린다', { skip: SKIP }, async () => {
  state.contentStatus = 500;
  let page = await open();
  await page.waitFor("/콘텐츠를 불러오지 못했습니다/.test(document.body.innerText)", 5000);
  await page.close();
  state.contentStatus = 200; state.noIndex = true; state.progressFail = true;
  page = await open();
  await ready(page);
  const t = await page.text('#status');
  assert.match(t, /음성 목록을 불러오지 못했습니다/);
  assert.match(t, /연습 기록을 불러오지 못했습니다/);
  assert.equal(await page.count('.item'), 10);
  await enter(page, '프로젝트가 미뤄진 이유');
  assert.ok((await page.count('.noaudio')) >= 20, '음성 없음 표시');
  assert.equal(await page.count('.chunk button'), 0);
  await page.close();
});

test('작업400 소리 표기 블록: 구 수만큼 줄, "/"는 구 수-1개, 강세 점, 억양 화살표, 범례·참고 문구', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '문장 훈련');
  await clickText(page, '2');   // 구 4개: The thing is, / the client changed / a few requirements / late in the game.
  const l = CONTENT.monologues[0].lines[1];
  assert.equal(await page.count('.sound .phrase'), 4);
  assert.equal(await page.count('.sound .slash'), 3);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.sound .pron')].map(n => n.textContent)"), l.chunks.map(c => c.p));
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.sound .en-line')].map(n => n.textContent)"), l.chunks.map(c => c.en));
  assert.equal(await page.eval("document.querySelector('.sound .arrow.end').textContent"), '↘');
  const d = await page.eval(`(() => { const dot = document.querySelector('.sound .dot'), s = getComputedStyle(dot), seg = getComputedStyle(dot.parentElement);
    return { w: dot.getBoundingClientRect().width, h: dot.getBoundingClientRect().height, radius: s.borderTopLeftRadius, bg: s.backgroundColor, weight: seg.fontWeight, color: seg.color, n: document.querySelectorAll('.sound .dot').length }; })()`);
  assert.deepEqual([d.w, d.h, d.radius, d.bg, d.weight, d.color], [6, 6, '50%', 'rgb(226, 88, 59)', '600', 'rgb(184, 68, 46)']);
  assert.equal(d.n, 7, '이 문장의 강세 음절 수: THING 1 + CLIent·CHANGED 2 + FEW·reQUIREments 2 + LATE·GAME 2');
  const legend = await page.text('.legend');
  for (const t of ['점 = 강세 음절', '/ = 끊어 읽기', '- = 음절', '‿ = 이어서 소리 남', '( ) = 거의 안 들림']) assert.ok(legend.includes(t), t);
  assert.match(await page.text('.note'), /발음 표기·강세는 참고용입니다\(검수 전\)/);
  await page.eval("document.querySelectorAll('.sound .phrase')[2].click()");
  await page.waitFor("window.__plays.length === 1", 3000);
  assert.deepEqual(await plays(page), ['m-delay.l1.c2']);
  assert.equal(await page.eval("(() => { const c = getComputedStyle(document.querySelectorAll('.sound .phrase')[2].querySelector('.en-line')); return c.fontWeight + ':' + c.textDecorationLine; })()"), '700:underline', '재생 중인 구: 굵기+밑줄');
  await page.close();
});

test('작업400: 음성 없는 구는 소리 표기 블록에서도 버튼 없이 "음성 없음", 나머지 구는 버튼', { skip: SKIP }, async () => {
  const page = await open();
  await ready(page);
  await enter(page, '프로젝트가 미뤄진 이유');
  await clickText(page, '문장 훈련');
  assert.equal(await page.count('.sound button.phrase'), 2);
  assert.equal(await page.eval("document.querySelector('.sound .phrase.off .noaudio').textContent"), '음성 없음');
  assert.equal(await page.eval("document.querySelectorAll('.sound .phrase')[1].tagName"), 'SPAN');
  await page.close();
});

test('작업400: 390px·1280px 소리 표기 블록 — 가로 스크롤 없음, 구 버튼 ≥44px, 허용 모서리만, 이모지 없음 (독백 10개 × 문장 5개)', { skip: SKIP }, async () => {
  for (const width of [390, 1280]) {
    const page = await open({ width });
    await ready(page);
    for (const { title } of CONTENT.monologues) {
      await enter(page, title);
      await clickText(page, '문장 훈련');
      for (let n = 1; n <= 5; n++) {
        await clickText(page, String(n));
        const a = await page.eval(AUDIT);
        const h = await page.eval("[...document.querySelectorAll('.sound button.phrase')].map(b => b.getBoundingClientRect().height)");
        assert.ok(h.every(x => x >= 43.5), width + ' 구 버튼 높이 ' + h);
        assert.deepEqual(a.bad, [], width + ' 버튼 높이');
        assert.deepEqual(a.radii.filter(r => !ALLOWED_RADII.has(r)), [], width + ' 모서리');
        assert.equal(a.emoji, false); assert.equal(a.scroll, false, width + ' 가로 스크롤 ' + title + n);
      }
      await clickText(page, '목록으로');
    }
    await page.close();
  }
});
