import { useState } from 'react';
import { ThreeDWheelPicker } from './ThreeDWheelPicker.jsx';

// Array-based so adding a future menu item is just adding an entry here.
const OPTIONS = [
  { id: 'dictionary', name: '언어 사전', description: 'AI가 풀어주는 뜻과 예문', icon: '📖', url: '/english_dictionary.html' },
  { id: 'literature', name: '문학 나침반', description: '시대별 문학 사조 타임라인', icon: '🧭', url: '/literature_compass.html' },
  { id: 'digest', name: '한입 독서', description: '한 입 크기로 읽는 작품 요약', icon: '📚', url: '/digest_reading.html' },
  { id: 'metacong', name: 'MetaCong', description: '한국사·세계사 음성 학습 퀴즈', icon: '🧠', url: '/metacong/' },
];

export default function HomeWheelApp() {
  const [selected, setSelected] = useState(OPTIONS[0].id);

  const goTo = (id) => {
    const target = OPTIONS.find((o) => o.id === id);
    if (target) window.location.href = target.url;
  };

  return (
    <div
      className="h-dvh w-full flex flex-col items-center justify-center overflow-hidden px-5"
      style={{
        '--accent-rgb': '226, 88, 59',
        '--accent': 'rgb(var(--accent-rgb))',
        background:
          'radial-gradient(900px 520px at 50% 8%, rgba(226, 88, 59, .14), transparent 65%), linear-gradient(180deg, #0d0d10 0%, #07080a 100%)',
        fontFamily: "'Sora', 'Noto Sans KR', ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">무엇을 시작할까요?</h1>
        <p className="mt-2 text-sm text-white/40">돌려서 고르고, 한 번 더 탭하면 이동해요</p>
      </header>

      <div className="w-full max-w-xl">
        <ThreeDWheelPicker options={OPTIONS} value={selected} onChange={setSelected} onCenterTap={goTo} />
      </div>
    </div>
  );
}
