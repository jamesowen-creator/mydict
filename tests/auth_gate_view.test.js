// 작업405: 화면 공통 로그인·승인 게이트(public/js/common/authGate.js)의 판단 함수 단위 시험 + 모든 화면에 게이트가 들어갔는지 정적 검사 + 캐시 버전.
// 브라우저 없이 파일과 순수 함수만 본다.  실행: node --test tests/auth_gate_view.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const G = require('../public/js/common/authGate.js');

test('405-1. decide: 토큰 없음 → 홈 이동 (응답과 무관)', () => {
  assert.deepEqual(G.decide(null, undefined), { action: 'home' });
  assert.deepEqual(G.decide('', { status: 200 }), { action: 'home' });
  assert.deepEqual(G.decide(undefined, { status: 403, code: 'blocked' }), { action: 'home' });
});

test('405-2. decide: 200 통과 / 401 토큰 삭제 후 홈', () => {
  assert.deepEqual(G.decide('t', { status: 200 }), { action: 'pass' });
  assert.deepEqual(G.decide('t', { status: 401, code: 'auth_invalid' }), { action: 'clear-home' });
  assert.deepEqual(G.decide('t', { status: 401 }), { action: 'clear-home' });
});

test('405-3. decide: 403 approval_pending → 대기 안내, 403 blocked → 차단 안내', () => {
  assert.deepEqual(G.decide('t', { status: 403, code: 'approval_pending' }), { action: 'pending' });
  assert.deepEqual(G.decide('t', { status: 403, code: 'blocked' }), { action: 'blocked' });
});

test('405-4. decide: 403 기타 code·503·그 밖 상태·연결 오류·결과 없음 → 재시도 안내(fail-closed, 절대 통과하지 않는다)', () => {
  for (const r of [{ status: 403 }, { status: 403, code: 'other' }, { status: 503, code: 'auth_unavailable' }, { status: 500 }, { status: 404 }, { status: 302 }, { error: true }, undefined, null, { status: '200' }]) {
    assert.deepEqual(G.decide('t', r), { action: 'retry' }, JSON.stringify(r));
  }
});

test('405-5. 안내 문구·버튼: 지정된 문구 그대로, 차단에는 [로그아웃]만', () => {
  assert.deepEqual(G.noticeFor('pending'), { title: '승인을 기다리고 있습니다', text: '관리자가 승인하면 사용할 수 있습니다. 승인 후 아래 [다시 확인]을 눌러 주세요.', buttons: ['recheck', 'logout'] });
  assert.deepEqual(G.noticeFor('blocked'), { title: '이용할 수 없는 계정입니다', text: '관리자에게 문의해 주세요.', buttons: ['logout'] });
  assert.deepEqual(G.noticeFor('retry'), { title: '연결할 수 없습니다', text: '잠시 후 다시 시도해 주세요.', buttons: ['retry', 'logout'] });
  assert.equal(G.noticeFor('pass'), null);
  assert.deepEqual(G.BUTTON_LABEL, { recheck: '다시 확인', retry: '다시 시도', logout: '로그아웃' });
});

test('405-6. public/*.html 모든 화면(admin 포함, 홈 제외)이 <head> 안에서 authGate.js 를 가장 먼저 불러온다 — 파일 시스템에서 목록을 읽어 누락 시 실패', () => {
  const files = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
  assert.ok(files.length >= 11 && files.includes('admin.html'), '화면 목록: ' + files.join(','));
  for (const f of files) {
    const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [])[1];
    assert.ok(head, f + ' <head>');
    const scripts = [...head.matchAll(/<script\b[^>]*>/gi)].map(m => m[0]);
    assert.ok(scripts.length > 0 && /src="\/js\/common\/authGate\.js\?v=\d+"/.test(scripts[0]), f + ': head 의 첫 스크립트가 authGate.js 여야 한다 (실제: ' + scripts[0] + ')');
    assert.equal((html.match(/authGate\.js/g) || []).length, 1, f + ': 한 번만');
  }
});

test('405-7. 홈(public/home/index.html)은 게이트를 쓰지 않는다 — 홈이 로그인 화면 역할이라 이동 반복이 생기면 안 된다', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'home', 'index.html'), 'utf8');
  assert.ok(!/authGate/.test(html));
  const src = fs.readFileSync(path.join(PUBLIC, 'js', 'common', 'authGate.js'), 'utf8');
  assert.match(src, /window\.location\.replace\(approval === 'pending' \|\| approval === 'blocked' \? '\/\?approval=' \+ approval : '\/'\)/, '로그인 전 이동 목적지는 홈(/)');
});

test('405-8. 캐시: sw.js CACHE_NAME 과 authGate.js 주소의 ?v= 가 같은 번호', () => {
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  const v = (sw.match(/const CACHE_NAME = 'metis-v(\d+)'/) || [])[1];
  assert.ok(v && Number(v) >= 103, 'CACHE_NAME 번호 ' + v);
  for (const f of fs.readdirSync(PUBLIC).filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    assert.match(html, new RegExp('/js/common/authGate\\.js\\?v=' + v + '"'), f);
  }
});

test('405-9. 게이트 스타일: 토큰 변수만(대체값 포함)·그림자·이모지·허용 밖 radius 없음', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'js', 'common', 'authGate.js'), 'utf8');
  const style = src.slice(src.indexOf('var STYLE = ['), src.indexOf('function addStyle'));
  assert.ok(!/box-shadow|text-shadow/.test(style), '그림자 없음');
  assert.ok(!/\p{Extended_Pictographic}/u.test(src), '이모지 없음');
  for (const m of style.matchAll(/border-radius:([^;}]*)/g)) assert.match(m[1], /^var\(--btn-radius,10px\)$/, 'radius 는 버튼 토큰(10px)만');
  for (const m of style.matchAll(/font-size:([^;}]*)/g)) assert.match(m[1], /^var\(--fs-(14|18),(14|18)px\)$/, '글자 단계 14·18px 만: ' + m[1]);
  assert.match(style, /min-height:var\(--ctl-min-h,44px\)/, '터치 영역 44px');
});
