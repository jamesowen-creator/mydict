// 작업13: 모든 vanilla 페이지(사전/문학나침반/한입독서/관리자)가 공유하는
// 상단 헤더 - 로고 + 로그인 상태별 우측 위젯. home-wheel/src/auth.js의
// getToken/fetchMe 패턴을 모듈 시스템이 없는 plain <script> 페이지에서도
// 쓸 수 있게 그대로 이식한 것 (React 번들과 별개로 동작).
(function () {
  const TOKEN_KEY = 'mydict_token';

  function getToken() {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      localStorage.setItem(TOKEN_KEY, urlToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    return localStorage.getItem(TOKEN_KEY);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  async function fetchMe(token) {
    try {
      const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    });
    if (text != null) e.textContent = text;
    return e;
  }

  // 작업74: 승인 대기 계정은 OAuth 콜백에서 JWT 대신 ?approval=pending을
  // 달고 로그인을 시작한 페이지로 되돌아옴(routes/auth.js). 예전엔 사전/홈만
  // 이걸 각자 처리해서 문학나침반/한입독서/MetaCong/관리자에선 아무 설명 없이
  // 로그인 버튼만 다시 보였음. 안내는 반드시 body 직속에 붙임 - 헤더의
  // .metis-app-header-right 안에 넣으면 사전 페이지 작업27의
  // MutationObserver(첫 childList 변화만 보고 disconnect)가 엉뚱한 시점에
  // 발동해 헤더 재배치가 깨짐.
  function consumeApprovalPending() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('approval') !== 'pending') return;
    window.history.replaceState({}, document.title, window.location.pathname);
    if (document.querySelector('.metis-approval-notice')) return;
    const notice = el('div', { class: 'metis-approval-notice', role: 'status' });
    const body = el('div', { class: 'metis-approval-notice-body' });
    body.appendChild(el('div', { class: 'metis-approval-notice-title' }, '승인 대기중'));
    body.appendChild(el('div', { class: 'metis-approval-notice-text' },
      '관리자 승인 후 이용 가능합니다. 승인이 완료되면 다시 로그인해 주세요.'));
    const close = el('button', { type: 'button', class: 'metis-approval-notice-close', 'aria-label': '닫기' }, '×');
    close.onclick = () => notice.remove();
    notice.appendChild(body);
    notice.appendChild(close);
    document.body.appendChild(notice);
  }

  // container 하나를 받아 로그인 상태에 맞는 위젯을 채워넣음 - 공통 헤더를
  // 새로 만드는 페이지뿐 아니라, admin.html처럼 이미 있는 헤더 안에
  // 자리만 내주는 경우에도 재사용 가능하도록 별도 함수로 분리.
  // 작업198: 공용 헤더(.metis-app-header 안의 container)는 사전 모양으로 그린다 - 관리자 링크·
  // "이름 님"은 로고 아래 작은 글씨(.metis-app-header-subtext), 로그아웃은 우측 텍스트 버튼.
  // admin.html처럼 헤더 밖 container는 예전 모양(이름 + 필 버튼)을 그대로 쓴다.
  // 매 호출마다 container와 subtext를 비우고 다시 채우므로 몇 번 불려도 DOM이 한 번 그린 것과 같고,
  // 비동기 응답이 겹치면 마지막 호출만 그린다.
  async function renderAuthWidget(container) {
    consumeApprovalPending();
    const header = container.closest ? container.closest('.metis-app-header') : null;
    const sub = header ? header.querySelector('.metis-app-header-subtext') : null;
    const seq = (container._metisRenderSeq = (container._metisRenderSeq || 0) + 1);
    container.innerHTML = '';
    if (sub) sub.innerHTML = '';
    const token = getToken();
    const next = encodeURIComponent(window.location.pathname);

    function showLoginLink() {
      container.appendChild(
        el('a', { href: '/auth/google?next=' + next, class: 'metis-app-header-btn primary' }, 'Google로 로그인')
      );
    }

    if (!token) {
      showLoginLink();
      return;
    }

    const user = await fetchMe(token);
    if (seq !== container._metisRenderSeq) return;   // 더 새로운 호출이 있으면 그쪽이 그린다
    if (!user) {
      // 토큰이 만료/무효화된 경우 - 조용히 정리하고 로그인 버튼으로 대체
      clearToken();
      showLoginLink();
      return;
    }

    const textHost = sub || container;   // 사전 모양이면 로고 아래, 아니면 우측 위젯 안
    if (user.role === 'admin' && window.location.pathname !== '/admin') {
      textHost.appendChild(el('a', { href: '/admin', class: 'metis-app-header-btn admin' }, '관리자'));
      if (sub) sub.appendChild(document.createTextNode(' · '));
    }
    textHost.appendChild(el('span', { class: 'metis-app-header-name' }, (user.name || '') + ' 님'));
    const logoutBtn = el('button', { type: 'button', class: 'metis-app-header-btn' + (sub ? ' logout' : '') }, '로그아웃');
    logoutBtn.onclick = () => {
      clearToken();
      window.location.reload();
    };
    container.appendChild(logoutBtn);
  }

  // 새 헤더 바 자체를 body 맨 앞에 삽입 - 문학나침반/한입독서처럼 화면별
  // 컨텍스트 타이틀바가 이미 있는 페이지에서도 그 위에 쌓이는 형태로 동작
  // (뒤로가기/진행률 등 기존 기능을 대체하지 않음).
  function inject() {
    const header = el('header', { class: 'metis-app-header' });
    // 작업13-b: 아이콘+워드마크 이미지 대신 "METIS" 텍스트(코랄 볼드)만 사용
    const logo = el('a', { href: '/', class: 'metis-app-header-logo', 'aria-label': 'METIS' }, 'METIS');
    const right = el('div', { class: 'metis-app-header-right' });
    // 작업198: 사전의 헤더 모양이 기본 - 로고 아래에 관리자 링크·이름을 작게 둔다(로그인 전에는 비어 있음)
    const left = el('div', { class: 'metis-app-header-left' });
    left.appendChild(logo);
    left.appendChild(el('div', { class: 'metis-app-header-subtext' }));
    header.appendChild(left);
    header.appendChild(right);
    document.body.insertBefore(header, document.body.firstChild);
    renderAuthWidget(right);
    return header;
  }

  window.MetisAppHeader = { inject, renderAuthWidget, getToken, clearToken, fetchMe };
})();
