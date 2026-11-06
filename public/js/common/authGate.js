// 작업405: 모든 화면(홈 제외) 공통 로그인·승인 게이트. 각 html 의 <head> 에서 가장 먼저 불러온다.
//  - 확인이 끝날 때까지 본문을 숨긴다(html.metis-gate-pending 클래스, 끝나면 반드시 해제).
//  - 토큰(localStorage mydict_token)이 없으면 홈(/)으로 이동(홈이 로그인 버튼을 보이는 화면이다).
//  - 토큰이 있으면 GET /api/me 1회로 판단한다: 200 통과 / 401 토큰 삭제 후 홈 / 403 approval_pending·blocked 안내 / 그 밖(403 기타·503·연결 오류·해석 실패)은 재시도 안내(fail-closed).
//  - 판단은 순수 함수 decide() 로 분리되어 있다(node 에서 require 해 시험한다).
//  - 같은 화면의 다른 스크립트가 /api/me 를 부르면 이 결과를 재사용한다(fetch 를 감싸 5초 안의 같은 토큰 요청에 200 사본을 돌려줌) — 요청 수를 늘리지 않는다.
(function () {
  'use strict';

  var TOKEN_KEY = 'mydict_token';
  var REUSE_MS = 5000;

  // 상태별 안내 문구(작업405 지정). 버튼 id: recheck(다시 확인) / retry(다시 시도) / logout(로그아웃)
  var NOTICES = {
    pending: { title: '승인을 기다리고 있습니다', text: '관리자가 승인하면 사용할 수 있습니다. 승인 후 아래 [다시 확인]을 눌러 주세요.', buttons: ['recheck', 'logout'] },
    blocked: { title: '이용할 수 없는 계정입니다', text: '관리자에게 문의해 주세요.', buttons: ['logout'] },
    retry: { title: '연결할 수 없습니다', text: '잠시 후 다시 시도해 주세요.', buttons: ['retry', 'logout'] },
  };
  var BUTTON_LABEL = { recheck: '다시 확인', retry: '다시 시도', logout: '로그아웃' };

  // (토큰, /api/me 결과) → 동작. result: { status, code } 또는 { error: true } / 없음.
  //   home: 홈으로 이동 / clear-home: 토큰 삭제 후 홈 / pass: 본문 표시 / pending·blocked·retry: 안내 화면
  function decide(token, result) {
    if (!token) return { action: 'home' };
    if (!result || result.error || typeof result.status !== 'number') return { action: 'retry' };
    if (result.status === 200) return { action: 'pass' };
    if (result.status === 401) return { action: 'clear-home' };
    if (result.status === 403 && result.code === 'approval_pending') return { action: 'pending' };
    if (result.status === 403 && result.code === 'blocked') return { action: 'blocked' };
    return { action: 'retry' };
  }

  function noticeFor(action) { return NOTICES[action] || null; }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { decide: decide, noticeFor: noticeFor, NOTICES: NOTICES, BUTTON_LABEL: BUTTON_LABEL, TOKEN_KEY: TOKEN_KEY };
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ───── 브라우저 쪽 ─────
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var root = document.documentElement;

  function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 저장소 사용 불가 */ } }

  // 로그인 콜백이 돌려준 ?token=... 을 저장하고 주소에서 지운다(appHeader.js 와 같은 규칙, 다른 쿼리는 보존). 게이트가 먼저 실행되므로 여기서 받아야 한다.
  function captureUrlToken() {
    try {
      var p = new URLSearchParams(window.location.search);
      var t = p.get('token');
      if (!t) return;
      try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* 저장소 사용 불가 */ }
      p.delete('token');
      var rest = p.toString();
      window.history.replaceState({}, document.title, window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
    } catch (e) { /* 주소 처리 실패는 무시 */ }
  }

  function goHome() {
    // 콜백이 ?approval=pending|blocked 를 붙여 이 화면으로 되돌렸다면 홈에서 같은 안내를 보이도록 넘긴다
    var approval = null;
    try { approval = new URLSearchParams(window.location.search).get('approval'); } catch (e) { /* 무시 */ }
    window.location.replace(approval === 'pending' || approval === 'blocked' ? '/?approval=' + approval : '/');
  }

  var STYLE = [
    'html.metis-gate-pending body > *:not(.metis-gate){visibility:hidden!important}',
    '.metis-gate{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;overflow:auto;',
    'padding:var(--sp-16,16px);background:var(--color-bg,#f5f7ff);color:var(--color-text,#1a1f3c);font-family:var(--font-sans,"Noto Sans KR",sans-serif);text-align:center}',
    '.metis-gate-inner{width:100%;max-width:var(--content-max,680px);display:flex;flex-direction:column;align-items:center;gap:var(--sp-12,12px)}',
    '.metis-gate h1{margin:0;font-size:var(--fs-18,18px);font-weight:700;line-height:1.4}',
    '.metis-gate p{margin:0;font-size:var(--fs-14,14px);line-height:1.6;color:var(--color-text-sub,#4a5070)}',
    '.metis-gate-actions{display:flex;flex-direction:column;align-items:center;gap:var(--sp-8,8px);margin-top:var(--sp-8,8px)}',
    '.metis-gate .btn{box-sizing:border-box;min-width:44px;min-height:var(--ctl-min-h,44px);padding:0 var(--sp-20,20px);border:0;border-radius:var(--btn-radius,10px);',
    'background:var(--btn-primary-bg,#b8442e);color:var(--color-surface,#fff);font:inherit;font-size:var(--fs-14,14px);font-weight:var(--btn-weight,600);cursor:pointer}',
    '.metis-gate .btn.text{background:transparent;color:var(--color-text-sub,#4a5070)}',
    '.metis-gate .btn:disabled{opacity:.6;cursor:default}',
    '.metis-gate .btn:focus-visible{outline:2px solid var(--color-accent-ink,#b8442e);outline-offset:2px}',
  ].join('');

  function addStyle() {
    if (document.getElementById('metis-gate-style')) return;
    var st = document.createElement('style');
    st.id = 'metis-gate-style';
    st.textContent = STYLE;
    (document.head || root).appendChild(st);
  }

  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var overlay = null;
  function removeOverlay() { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; }

  function showChecking() {
    whenBody(function () {
      if (!root.classList.contains('metis-gate-pending') || overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'metis-gate';
      var inner = document.createElement('div');
      inner.className = 'metis-gate-inner';
      var p = document.createElement('p');
      p.textContent = '확인 중…';
      inner.appendChild(p);
      overlay.appendChild(inner);
      document.body.appendChild(overlay);
    });
  }

  function release() {
    removeOverlay();
    root.classList.remove('metis-gate-pending');
  }

  function logout() { clearToken(); window.location.replace('/'); }

  // 안내 화면: main 영역의 텍스트 + 실제 button. 포커스는 첫 버튼. 닫을 수 없다.
  function showNotice(action) {
    var n = noticeFor(action);
    whenBody(function () {
      removeOverlay();
      overlay = document.createElement('div');
      overlay.className = 'metis-gate';
      var main = document.createElement('main');
      main.className = 'metis-gate-inner';
      var h = document.createElement('h1'); h.textContent = n.title;
      var p = document.createElement('p'); p.textContent = n.text;
      var actions = document.createElement('div'); actions.className = 'metis-gate-actions';
      main.appendChild(h); main.appendChild(p); main.appendChild(actions);
      var first = null;
      n.buttons.forEach(function (id) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = id === 'logout' ? 'btn text' : 'btn';
        b.setAttribute('data-gate', id);
        b.textContent = BUTTON_LABEL[id];
        if (id === 'logout') b.onclick = logout;
        else b.onclick = function () { recheck(b); };
        actions.appendChild(b);
        if (!first) first = b;
      });
      overlay.appendChild(main);
      document.body.appendChild(overlay);
      if (first) first.focus();
    });
  }

  // /api/me 1회 조회. 네트워크 오류·해석 실패도 결과로 돌려준다(예외 없음).
  function queryMe(token) {
    if (!realFetch) return Promise.resolve({ error: true });
    return realFetch('/api/me', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then(function (res) {
      return res.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = undefined; }
        if (res.status === 200 && (!body || typeof body !== 'object')) return { error: true };   // 200 인데 해석할 수 없으면 확인하지 못한 것으로 본다(fail-closed)
        return { status: res.status, code: body && body.code, body: body };
      });
    }).catch(function () { return { error: true }; });
  }

  // [다시 확인]·[다시 시도]: 같은 판단을 다시 한다. 통과하면 화면을 처음부터 다시 불러온다(차단된 동안 화면 스크립트가 받은 응답이 남지 않게).
  function recheck(btn) {
    var token = readToken();
    if (!token) { goHome(); return; }
    btn.disabled = true;
    queryMe(token).then(function (r) {
      var d = decide(token, r);
      if (d.action === 'pass') { window.location.reload(); return; }
      if (d.action === 'clear-home') { clearToken(); goHome(); return; }
      if (d.action === 'home') { goHome(); return; }
      showNotice(d.action);
    });
  }

  // 같은 화면이 /api/me 를 또 부르면 게이트의 200 결과를 재사용한다(5초 안, 같은 토큰). 그 밖의 요청은 그대로 통과.
  var shared = null;   // { token, body, at }
  if (realFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        if (path === '/api/me' && method === 'GET' && gatePromise) {
          var auth = init && init.headers ? (init.headers.Authorization || init.headers.authorization || (typeof init.headers.get === 'function' ? init.headers.get('Authorization') : '')) : '';
          return gatePromise.then(function () {
            if (shared && auth === 'Bearer ' + shared.token && Date.now() - shared.at < REUSE_MS) {
              return new Response(JSON.stringify(shared.body), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return realFetch(input, init);
          });
        }
      } catch (e) { /* 재사용 실패 시 그냥 요청 */ }
      return realFetch(input, init);
    };
  }

  // ───── 시작 ─────
  var gatePromise = null;
  captureUrlToken();
  var token = readToken();
  addStyle();
  root.classList.add('metis-gate-pending');

  window.MetisAuthGate = { decide: decide, ready: null };

  if (!token) {
    goHome();   // 이동하는 동안 본문은 숨겨 둔 채로 둔다
  } else {
    var slow = setTimeout(showChecking, 500);
    gatePromise = queryMe(token).then(function (r) {
      clearTimeout(slow);
      var d = decide(token, r);
      if (d.action === 'pass') { shared = { token: token, body: r.body, at: Date.now() }; release(); }
      else if (d.action === 'clear-home') { clearToken(); goHome(); }
      else if (d.action === 'home') goHome();
      else showNotice(d.action);
      return r;
    });
    window.MetisAuthGate.ready = gatePromise;
  }
})();
