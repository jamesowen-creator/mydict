// 작업346: 스펠링 런 시작 화면 정리(핵심 요약 + "게임 방법" 화면). 헤드리스 Chrome.
// 자체 임시 서버에 모의 /api/me·/api/wordbook 만 둔다 — 실제 서버·운영 서버와 무관.
// 실행: node --test tests/ui/spellrun_start.ui.test.js   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser, findChrome } = require('./helpers/cdp');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'none' })}.${b64({ id: 7, name: '테스터', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const WORDS = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'garden', 'planet', 'river', 'cloud', 'bridge'];
const mkRows = n => WORDS.slice(0, n).map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));

// 작업346 이전 시작 화면에 있던 안내 문장(그대로 옮겨졌는지 확인한다). cond: 옵션에 따라 나오는 줄
const RULES = {
  basic: '뜻에 맞는 철자를 채워 단어를 완성합니다. 탭(스페이스바)으로 점프하고, 정답 글자가 지나갈 때 공중에 있으면 먹습니다.',
  speed: '맞힐수록 빨라지고 5콤보부터는 최고 속도입니다. 빠를수록 점수가 높고, 틀리면 속도가 줄어듭니다.',
  mint: '오답을 먹거나 정답을 놓치면 체력이 1 줄고, 같은 칸에 새 글자가 나옵니다.',
  mintCont: '오답을 먹거나 놓치면 체력이 1 줄고 새 글자가 나와요. 체력이 0이 되면 한 번 이어서 할 수 있어요.',
  gold: '금색 테두리 조각은 한 음절(2~4글자)을 통째로 먹는 칸이라 점수가 높습니다.',
  heart: '3단어마다 하트가 하나 나옵니다. 점프해서 먹으면 체력이 1 회복됩니다.',
  dj: '높이 떠 있는 칸(위쪽 삼각형 표시)은 공중에서 한 번 더 탭하는 2단 점프로만 먹을 수 있고, 먹으면 가산점입니다.',
  boss: '단어를 모두 끝내면 보스 단어가 나오고, 끝까지 먹으면 발음이 한 번 더 천천히 나옵니다.',
  rescue: '힌트나 천사가 가끔 와요. 체력이 적으면 더 자주 와요.',
  lightning: '번개를 먹으면 잠시 빨라지고 점수가 올라요. 하트는 체력이 가득이면 점수로 바뀌어요.',
  obst: '길에 놓인 장애물과 구덩이는 점프로 넘으세요. 걸리면 체력이 1 줄고 속도가 느려집니다(콤보와 점수는 그대로).',
  surv: '생존 모드: 체력이 0이 될 때까지 단어가 계속 나오고, 5단어마다 보스예요. 하트는 갈수록 드물어지고 장애물은 점점 많아져요.',
};

let srv, base, browser;
const state = { rows: [], vs: false };
test.before(async () => {
  if (SKIP) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u === '/api/me') return json(200, { id: 7, role: 'user', can_wordbook: true, perm_versus: state.vs });
    if (u === '/api/wordbook') return json(200, state.rows);
    if (u.startsWith('/api/')) return json(503, { error: 'mock' });
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

async function openGame({ query = '', width = 360, height = 640, rows = 12, vs = false, storage = '' } = {}) {
  state.rows = mkRows(rows); state.vs = vs;
  const page = await browser.newPage({ width, height, token: jwt() });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.removeItem('spellrun_opts'); localStorage.removeItem('spellrun_mode'); localStorage.removeItem('spellrun_preview'); ${storage} } sessionStorage.setItem('spellrun_ids', ${JSON.stringify(JSON.stringify(state.rows.map(r => r.id)))}); } catch (e) {}` });
  await page.goto(base + '/spelling_run.html' + query);
  await page.waitFor("!document.getElementById('app').hidden && !!document.getElementById('modeRow')", 8000);
  return page;
}
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`);
const helpText = page => page.eval("document.getElementById('help').innerText.replace(/\\s+/g, ' ')");
const norm = s => s.replace(/\s+/g, ' ');

test('시작 화면 구성과 순서: 제목 → 모드 줄 → 한 줄 설명 → 핵심 3줄 → 게임 방법·미리 보기 → 시작. 규칙 상세·소리 단추는 시작 카드에 없다', { skip: SKIP }, async () => {
  const page = await openGame({ vs: true });
  const order = await page.eval(`(() => {
    const ids = ['#start .title', '#modeRow', '#modeDesc', '#coreList', '#optRow', '#startBtn'].map(s => document.querySelector(s));
    const inOrder = ids.every((e, i) => !i || (ids[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    return { inOrder, inCard: ids.every(e => document.querySelector('#start .card').contains(e)),
      opt: [...document.querySelectorAll('#optRow button')].map(b => b.id || b.dataset.mode), modes: [...document.querySelectorAll('#modeRow button')].map(b => b.dataset.mode),
      core: [...document.querySelectorAll('#coreList li')].map(l => l.textContent.trim()),
      inStart: ['startInfo', 'startExcluded', 'sndStart', 'ttsTest', 'ttsStatus', 'speechNote', 'djRule'].filter(id => document.querySelector('#start').contains(document.getElementById(id))),
      startRules: document.querySelectorAll('#start .rules li').length, helpRules: document.querySelectorAll('#help .rules li').length, kids: [...document.querySelector('#start .card').children].map(e => e.id || e.tagName.toLowerCase() + '.' + e.className) };
  })()`);
  assert.ok(order.inOrder && order.inCard, JSON.stringify(order));
  assert.deepEqual(order.modes, ['normal', 'survival', 'versus']);
  assert.deepEqual(order.opt, ['helpBtn', 'preview']);
  assert.deepEqual(order.core, ['탭(스페이스바)으로 점프해서 정답 글자를 먹으면 단어가 완성돼요.', '맞힐수록 빨라지고, 틀리거나 놓치면 체력이 줄어요.', '체력이 0이 되면 한 번 이어서 할 수 있어요.']);
  assert.deepEqual(order.inStart, [], '상세 줄·소리 단추는 게임 방법 안에 있다');
  assert.equal(order.startRules, 0);
  assert.equal(order.helpRules, 10, '상세 규칙 줄 10개(기본 7 + 번개 + 힌트·천사 + 장애물. 생존 줄은 생존일 때만 더해진다)');
  console.log('[구성] 시작 카드 자식: ' + order.kids.join(' | '));
  await page.close();
});

test('폭 320·360·390 × 높이 568·640·740·844: 시작 버튼이 카드 안 스크롤 없이 처음부터 완전히 보이고 화면 아래로 잘리지 않는다(기본·생존·대결 권한 있음)', { skip: SKIP }, async () => {
  const table = [];
  for (const h of [568, 640, 740, 844]) for (const w of [320, 360, 390]) {
    for (const surv of [false, true]) {
      const page = await openGame({ width: w, height: h, vs: true, query: surv ? '?survival=1' : '' });
      const m = await page.eval(`(() => {
        const card = document.querySelector('#start .card'), b = document.getElementById('startBtn'), r = b.getBoundingClientRect(), cr = card.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const row = document.getElementById('modeRow'), rr = row.getBoundingClientRect();
        return { content: card.scrollHeight, shown: card.clientHeight, scroll: card.scrollHeight - card.clientHeight, inCard: r.top >= cr.top && r.bottom <= cr.bottom, inVp: r.bottom <= innerHeight && r.top >= 0, hit: hit === b || b.contains(hit),
          rowOk: row.scrollWidth <= row.clientWidth && rr.left >= cr.left - 0.5 && rr.right <= cr.right + 0.5, touch: r.height, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })()`);
      table.push(`${w}x${h}${surv ? ' 생존' : ''}: 내용 ${m.content} / 보이는 ${m.shown} / 시작 버튼 높이 ${Math.round(m.touch)}`);
      assert.ok(m.scroll <= 0, `${w}x${h} 카드 스크롤 없음: ` + JSON.stringify(m));
      assert.ok(m.inCard && m.inVp && m.hit, `${w}x${h} 시작 버튼 완전히 보임: ` + JSON.stringify(m));
      assert.ok(m.rowOk && m.docX <= 0, `${w}x${h} 모드 줄·페이지 가로 넘침 없음: ` + JSON.stringify(m));
      assert.ok(m.touch >= 44, '시작 버튼 터치 크기(--ctl-min-h 44px): ' + m.touch);
      await page.close();
    }
  }
  console.log('[측정] 정리 후\n' + table.join('\n'));
});

test('게임 방법: 열면 포커스가 안으로 가고 aria-expanded=true, 시작 카드는 가려지며, 닫기·Esc 로 닫으면 "게임 방법" 버튼으로 포커스가 돌아오고 모드·미리 보기 설정은 그대로다', { skip: SKIP }, async () => {
  const page = await openGame({ query: '?survival=1', storage: "localStorage.setItem('spellrun_preview', '0');" });
  const snap = () => page.eval(`({ surv: document.querySelector('#modeRow [data-mode=survival]').getAttribute('aria-pressed'), norm: document.querySelector('#modeRow [data-mode=normal]').getAttribute('aria-pressed'), pv: document.querySelector('#optRow [data-mode=preview]').getAttribute('aria-pressed'), pvText: document.querySelector('#optRow [data-mode=preview]').textContent, desc: document.getElementById('modeDesc').textContent, store: [localStorage.getItem('spellrun_mode'), localStorage.getItem('spellrun_preview')] })`);
  const before = await snap();
  assert.equal(before.surv, 'true'); assert.equal(before.pv, 'false');
  assert.equal(await page.eval("document.getElementById('helpBtn').getAttribute('aria-expanded')"), 'false');
  assert.equal(await page.eval("document.getElementById('help').hidden"), true);
  await page.click('#helpBtn');
  assert.equal(await page.eval("document.getElementById('help').hidden"), false);
  assert.equal(await page.eval("document.getElementById('helpBtn').getAttribute('aria-expanded')"), 'true');
  assert.equal(await page.eval("document.getElementById('start').hidden"), true, '열려 있는 동안 시작 카드는 가려짐');
  assert.equal(await page.eval("document.getElementById('help').contains(document.activeElement)"), true, '포커스가 안으로');
  assert.equal(await page.eval("document.getElementById('help').getAttribute('role')"), 'dialog');
  await page.click('#helpClose');
  assert.equal(await page.eval("document.getElementById('help').hidden"), true);
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'helpBtn', '닫으면 게임 방법 버튼으로 포커스');
  assert.equal(await page.eval("document.getElementById('helpBtn').getAttribute('aria-expanded')"), 'false');
  assert.equal(await page.eval("document.getElementById('start').hidden"), false);
  await page.eval("document.getElementById('helpBtn').click()");
  await page.eval("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.equal(await page.eval("document.getElementById('help').hidden"), true, 'Esc 로 닫힘');
  assert.equal(await page.eval("document.activeElement && document.activeElement.id"), 'helpBtn');
  assert.deepEqual(await snap(), before, '열고 닫아도 모드·미리 보기·저장값은 그대로');
  // 닫은 뒤 시작 버튼이 누를 수 있다
  assert.equal(await page.eval("(() => { const b = document.getElementById('startBtn'), r = b.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === b || b.contains(h); })()"), true);
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('게임 방법 안에는 이전 안내 문장이 빠짐없이 있고(묶음 제목 아래), 안에서 스크롤할 수 있다. 시작 버튼은 상세 화면 밖(시작 화면)에 있다', { skip: SKIP }, async () => {
  const page = await openGame({ height: 568 });
  await page.click('#helpBtn');
  const t = norm(await helpText(page));
  for (const k of ['basic', 'speed', 'mintCont', 'gold', 'heart', 'dj', 'boss', 'rescue', 'lightning', 'obst']) assert.ok(t.includes(RULES[k]), '빠진 문장: ' + k);
  assert.ok(!t.includes(RULES.mint), '이어하기가 켜져 있으면 체력 줄은 이어하기 문구로(작업341 그대로)');
  assert.ok(!t.includes(RULES.surv), '기본 모드에는 생존 줄 없음');
  const heads = await page.eval("[...document.querySelectorAll('#help .rhead')].filter(h => !h.hidden).map(h => h.textContent)");
  assert.deepEqual(heads, ['기본 조작', '점수와 속도', '체력과 하트', '장애물', '아이템', '보스와 발음', '소리']);
  const groups = await page.eval("[...document.querySelectorAll('#help .rhead')].map(h => [h.textContent, h.nextElementSibling && h.nextElementSibling.querySelectorAll ? [...h.nextElementSibling.querySelectorAll('li')].filter(l => !l.hidden).length : -1])");
  assert.ok(groups.slice(0, 6).every(([, n]) => n >= 1), '각 묶음에 줄이 있다: ' + JSON.stringify(groups));
  const sc = await page.eval("(() => { const b = document.getElementById('helpBody'); const bx = document.getElementById('help').getBoundingClientRect(); const c = document.querySelector('#help .card').getBoundingClientRect(); return { scrollable: b.scrollHeight > b.clientHeight, canScroll: getComputedStyle(b).overflowY, closeInView: document.getElementById('helpClose').getBoundingClientRect().bottom <= c.bottom }; })()");
  assert.equal(sc.scrollable, true, '568 높이에서는 안에서 스크롤');
  assert.equal(sc.closeInView, true, '닫기는 스크롤하지 않아도 보임');
  assert.equal(await page.eval("(() => { const b = document.getElementById('helpBody'); b.scrollTop = b.scrollHeight; return b.scrollTop > 0; })()"), true);
  assert.equal(await page.eval("document.getElementById('help').contains(document.getElementById('startBtn'))"), false);
  await page.close();
});

test('조건부 줄: 해당 옵션이 꺼져 있으면 줄과 묶음 제목이 없고, 이어하기 꺼짐이면 핵심 3줄·체력 줄이 뜻에 맞는 문구가 된다. 생존 줄은 생존일 때만', { skip: SKIP }, async () => {
  let page = await openGame({ query: '?speeditem=0&rescue=0&obs=0&continue=0&dj=0' });
  await page.eval("document.getElementById('helpBtn').click()");
  let t = norm(await helpText(page));
  for (const k of ['rescue', 'lightning', 'obst', 'dj', 'mintCont']) assert.ok(!t.includes(RULES[k]), '꺼진 옵션인데 줄이 있음: ' + k);
  assert.ok(t.includes(RULES.mint), 'continue=0 은 원래 체력 문구');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#help .rhead')].filter(h => !h.hidden).map(h => h.textContent)"), ['기본 조작', '점수와 속도', '체력과 하트', '보스와 발음', '소리'], '빈 묶음은 제목째 숨김');
  assert.equal(await text(page, '#coreCont'), '체력이 0이 되면 게임이 끝나요.');
  assert.equal(await page.eval("document.getElementById('tune').hidden"), false, '기본값과 다르면 조정값 사용 중 표시');
  await page.close();

  page = await openGame({ query: '?survival=1' });
  await page.eval("document.getElementById('helpBtn').click()");
  t = norm(await helpText(page));
  assert.ok(t.includes(RULES.surv), '생존 모드 줄');
  assert.ok(t.includes(RULES.rescue) && t.includes(RULES.lightning) && t.includes(RULES.obst));
  await page.close();
});

test('모드 한 줄 설명은 선택에 따라 바뀌고, 대결은 설명을 두지 않는다. 생존에 단어가 모자라면 시작 버튼이 막히고 안내가 시작 화면에 보인다. 모드·미리 보기·조정값 표시는 그대로 동작', { skip: SKIP }, async () => {
  let page = await openGame({ vs: true, query: '?intro=0' });
  assert.equal(await text(page, '#modeDesc'), '이번 판 단어 최대 10개를 달려요.');
  await click(page, '#modeRow [data-mode=survival]');
  assert.equal(await text(page, '#modeDesc'), '끝없이 이어져요. 얼마나 오래 버티는지 겨뤄요.');
  assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), 'survival');
  await click(page, '#modeRow [data-mode=versus]');
  await page.waitFor("!document.getElementById('vs').hidden", 3000).catch(() => {});
  assert.equal(await text(page, '#modeDesc'), '끝없이 이어져요. 얼마나 오래 버티는지 겨뤄요.', '대결을 눌러도 설명·저장 모드는 바뀌지 않음');
  assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), 'survival');
  await click(page, '#modeRow [data-mode=normal]');
  assert.equal(await text(page, '#modeDesc'), '이번 판 단어 최대 10개를 달려요.');
  assert.equal(await page.eval("localStorage.getItem('spellrun_mode')"), 'normal');
  await click(page, '#optRow [data-mode=preview]');
  assert.equal(await page.eval("localStorage.getItem('spellrun_preview')"), '0');
  assert.equal(await page.eval("document.getElementById('tune').hidden"), false, 'intro=0 은 조정값 사용 중');
  assert.equal(await page.eval("document.querySelector('#optRow [data-mode=preview]').textContent"), '미리 보기 끔');
  await page.close();

  page = await openGame({ rows: 4, query: '?survival=1' });   // 단어 4개: 생존 최소 5개 미만
  assert.equal(await page.eval("document.getElementById('startBtn').disabled"), true);
  assert.match(await page.eval("document.getElementById('survNote').textContent"), /5개 이상/);
  assert.equal(await page.eval("document.getElementById('start').contains(document.getElementById('survNote'))"), true, '막힌 이유는 시작 화면에 보인다');
  assert.equal(await page.eval("(() => { const c = document.querySelector('#start .card'); return c.scrollHeight <= c.clientHeight; })()"), true);
  await page.close();
});
