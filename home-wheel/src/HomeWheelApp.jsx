import { useEffect, useState } from 'react';
import { ThreeDWheelPicker } from './ThreeDWheelPicker.jsx';
import { getToken, clearToken, fetchMe } from './auth.js';

// Array-based so adding a future menu item is just adding an entry here.
// No `icon` field (작업10-a removed the per-item icons - text-only cards now;
// ThreeDWheelPicker's WheelItem no longer renders an icon span at all).
const OPTIONS = [
  { id: 'dictionary', name: '언어 사전', description: 'AI가 풀어주는 뜻과 예문', url: '/english_dictionary.html' },
  { id: 'literature', name: '문학 나침반', description: '시대별 문학 사조 타임라인', url: '/literature_compass.html' },
  { id: 'digest', name: '한입 독서', description: '한 입 크기로 읽는 작품 요약', url: '/digest_reading.html' },
  { id: 'metacong', name: 'MetaCong', description: '한국사·세계사 음성 학습 퀴즈', url: '/metacong/' },
];

export default function HomeWheelApp() {
  const [selected, setSelected] = useState(OPTIONS[0].id);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthChecked(true); return; }
    fetchMe(token)
      .then((me) => setUser(me))
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  const goTo = (id) => {
    const target = OPTIONS.find((o) => o.id === id);
    if (target) window.location.href = target.url;
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <div
      className="h-dvh w-full flex flex-col overflow-hidden px-5 py-6"
      style={{
        '--accent-rgb': '226, 88, 59',
        '--accent': 'rgb(var(--accent-rgb))',
        // 8-c: light theme, matching the rest of the app's --bg/--surface2
        // tones instead of the reference demo's dark background. Card
        // fill/border/text inside ThreeDWheelPicker now read --wheel-card-rgb
        // / --wheel-fg-rgb (see that file's comments) instead of hardcoded
        // white, so the component's own structure never needed touching for
        // this - only these two variables + the outer background.
        '--wheel-card-rgb': '100, 116, 139',
        '--wheel-fg-rgb': '30, 41, 59',
        background:
          'radial-gradient(900px 520px at 50% 8%, rgba(226, 88, 59, .10), transparent 65%), linear-gradient(180deg, #f5f7ff 0%, #eef1fb 100%)',
        fontFamily: "'Sora', 'Noto Sans KR', ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      {/* 작업10-a: wheel re-centered vertically (was pinned near the top with
          pt-2/items-start to compensate for the now-removed 작업8-a header -
          that compensation is gone too, since there's nothing left above it
          to balance against). flex-1 + items-center lets this zone grow to
          fill whatever space is left between the top edge and the fixed-size
          login row below, and centers the wheel within that space - the
          "위/중간/아래 자연스럽게 분배" 작업10-b asked for. */}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-xl">
          <ThreeDWheelPicker options={OPTIONS} value={selected} onChange={setSelected} onCenterTap={goTo} />
        </div>
      </div>

      {/* 8-b: login/logout + admin, in the space below the wheel. Reads the
          same localStorage token + /api/me role check the vanilla pages use
          (see auth.js) - no separate shared module exists yet to import
          instead, since the vanilla pages are plain inline <script>, not
          built with anything a Vite bundle could import from. */}
      <div className="flex flex-col items-center gap-3 pb-2">
        {authChecked && (
          user ? (
            <div className="flex items-center gap-3">
              {user.role === 'admin' && (
                <a
                  href="/admin"
                  className="rounded-full border px-4 py-2 text-xs font-bold transition"
                  style={{ borderColor: 'rgba(226,88,59,.4)', color: 'var(--accent)', background: 'rgba(226,88,59,.08)' }}
                >
                  관리자
                </a>
              )}
              <button
                onClick={handleLogout}
                className="rounded-full border px-4 py-2 text-xs font-bold transition"
                style={{ borderColor: 'rgba(30,41,59,.15)', color: 'rgba(30,41,59,.6)', background: 'rgba(30,41,59,.04)' }}
              >
                로그아웃
              </button>
            </div>
          ) : (
            <a
              href="/auth/google"
              className="rounded-full px-5 py-2.5 text-sm font-bold text-white transition"
              style={{ background: 'var(--accent)', boxShadow: '0 8px 20px -8px rgba(226,88,59,.6)' }}
            >
              Google로 로그인
            </a>
          )
        )}
      </div>
    </div>
  );
}
