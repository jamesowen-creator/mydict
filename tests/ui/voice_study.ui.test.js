// 작업196-2: 음성 학습 화면에서 개념 기능이 빠지고 자료 화면이 그대로 렌더링되는지(헤드리스 Chrome, 모의 API).
// 실행: node --test "tests/ui/*.test.js"   (Chrome이 없으면 건너뜀)
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, findChrome } = require('./helpers/cdp');
const { startMockServer } = require('./helpers/mock_server');

const SKIP = findChrome() ? false : 'Chrome을 찾을 수 없어 건너뜀';
let browser, srv;
test.before(async () => { if (SKIP) return; srv = await startMockServer(); browser = await launchBrowser(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.close(); });

for (const width of [390, 768, 1024]) {
  test(`음성 학습 ${width}px: 개념 토글 없이 자료 목록이 보이고 가로 스크롤·스크립트 오류 없음`, { skip: SKIP }, async () => {
    srv.reset();
    srv.state.me.perm_voice_study = true;
    srv.state.voiceNotes = [{ id: 1, title: '첫 자료', summary: '요약 한 줄', created_at: '2026-01-01T00:00:00Z' }];
    const page = await browser.newPage({ width, height: 844 });
    await page.goto(srv.url + '/voice_study.html');
    await page.waitFor("document.getElementById('list-count').textContent === '1건'", 8000);
    assert.equal(await page.count('.tabs, .tab, #tab-notes, #tab-concepts, #concept-pane, #view-concept, #view-review'), 0, '자료|개념 토글·개념 화면 없음');
    assert.equal(await page.visible('#new-rec-btn'), true, '새로 녹음 버튼 표시');
    assert.equal(await page.visible('#wrong-btn'), true, '오답 노트 버튼 표시');
    assert.match(await page.text('#note-list'), /첫 자료/);
    assert.equal(await page.hasHorizontalScroll(), false, '가로 스크롤 없음');
    assert.equal(srv.state.log.some(l => l.url.startsWith('/api/voice-concepts')), false, '개념 API 호출 없음');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}
