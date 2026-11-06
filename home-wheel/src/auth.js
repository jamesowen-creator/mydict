// Mirrors english_dictionary.html's inline auth logic (getToken/setToken/
// clearToken, the ?token= capture in initAuth(), and the /api/me role check
// used for the "관리자" link) so this separate React bundle stays consistent
// with the vanilla pages' login state without a server-side session check.
// There's no extracted shared module to import from - the vanilla pages are
// one big inline <script>, not built with anything, so there's nothing to
// literally import into a Vite/React bundle. This re-implements the same
// small logic (~20 lines) rather than duplicating it at any larger scale.
const TOKEN_KEY = 'mydict_token';

export function getToken() {
  // A completed Google OAuth login redirects back to '/?token=...', which is
  // now this app's own URL - capture it exactly like initAuth() does, or a
  // fresh login would never actually get saved.
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// 작업405: /api/me 의 상태를 그대로 돌려준다 — 승인 대기(403 approval_pending)·차단(403 blocked)·토큰 무효(401)를 홈이 구분하려고.
export async function fetchMeResult(token) {
  try {
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    let body = null;
    try { body = await res.json(); } catch { /* 본문 없음 */ }
    return { status: res.status, code: body && body.code, body };
  } catch {
    return { status: 0, code: null, body: null };
  }
}

export async function fetchMe(token) {
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}
