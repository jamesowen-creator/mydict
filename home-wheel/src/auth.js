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

export async function fetchMe(token) {
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}
