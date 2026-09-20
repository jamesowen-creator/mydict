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

  // container 하나를 받아 로그인 상태에 맞는 위젯을 채워넣음 - 공통 헤더를
  // 새로 만드는 페이지뿐 아니라, admin.html처럼 이미 있는 헤더 안에
  // 자리만 내주는 경우에도 재사용 가능하도록 별도 함수로 분리.
  async function renderAuthWidget(container) {
    container.innerHTML = '';
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
    if (!user) {
      // 토큰이 만료/무효화된 경우 - 조용히 정리하고 로그인 버튼으로 대체
      clearToken();
      showLoginLink();
      return;
    }

    if (user.role === 'admin' && window.location.pathname !== '/admin') {
      container.appendChild(el('a', { href: '/admin', class: 'metis-app-header-btn admin' }, '관리자'));
    }
    container.appendChild(el('span', { class: 'metis-app-header-name' }, (user.name || '') + ' 님'));
    const logoutBtn = el('button', { type: 'button', class: 'metis-app-header-btn' }, '로그아웃');
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
    const logo = el('a', { href: '/', class: 'metis-app-header-logo', 'aria-label': 'METIS' });
    logo.appendChild(el('img', { src: '/icons/metis-logo-with-wordmark-v4.png', alt: 'METIS' }));
    const right = el('div', { class: 'metis-app-header-right' });
    header.appendChild(logo);
    header.appendChild(right);
    document.body.insertBefore(header, document.body.firstChild);
    renderAuthWidget(right);
    return header;
  }

  window.MetisAppHeader = { inject, renderAuthWidget, getToken, clearToken, fetchMe };
})();
