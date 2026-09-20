import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* ------------------------------------------------------------------ *
 * 데모 데이터 (컴포넌트와 분리)
 * ------------------------------------------------------------------ */
const OPTIONS = [
  { id: "react", name: "React", description: "UI library", icon: "⚛" },
  { id: "next", name: "Next.js", description: "React framework", icon: "▲" },
  { id: "vue", name: "Vue.js", description: "Progressive framework", icon: "🟩" },
  { id: "vite", name: "Vite", description: "Blazing fast build tool", icon: "⚡" },
  { id: "angular", name: "Angular", description: "Web platform", icon: "🅰" },
  { id: "svelte", name: "Svelte", description: "Compiled UI framework", icon: "🔥" },
  { id: "astro", name: "Astro", description: "Content-first framework", icon: "🚀" },
  { id: "solid", name: "SolidJS", description: "Fine-grained reactivity", icon: "🧩" },
];

/* ------------------------------------------------------------------ *
 * 유틸
 * ------------------------------------------------------------------ */
const mod = (n, m) => ((n % m) + m) % m;

// offset 기준으로 가장 가까운 상대 위치(-n/2 ~ n/2) → infinite loop의 핵심
const relativePos = (index, offset, n) => mod(index - offset + n / 2, n) - n / 2;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

// 뷰포트 폭 → desktop / tablet / mobile
function useBreakpoint() {
  const [bp, setBp] = useState("desktop");
  useLayoutEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setBp(w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop");
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return bp;
}

const METRICS = {
  desktop: { radius: 260, step: 20, cardW: 380, cardH: 92, viewportH: 420, drag: 62, showDesc: true },
  tablet: { radius: 210, step: 21, cardW: 320, cardH: 84, viewportH: 360, drag: 56, showDesc: true },
  mobile: { radius: 165, step: 23, cardW: 280, cardH: 74, viewportH: 300, drag: 48, showDesc: false },
};

/* ------------------------------------------------------------------ *
 * WheelItem — 원통 위의 카드 1장
 * ------------------------------------------------------------------ */
function WheelItem({ option, rel, metrics, reduced, onSelect, isSelected }) {
  const abs = Math.abs(rel);
  const focus = Math.max(0, 1 - abs); // 중앙 1 → 이웃 0
  const depth = reduced ? 0.35 : 1;

  const scale = 1 - clamp(abs, 0, 3) * 0.085;
  const opacity = clamp(1 - abs * 0.3, 0.06, 1);
  const blur = reduced ? 0 : clamp(abs * 1.25 - 0.15, 0, 4.5);
  const angle = -rel * metrics.step * depth;
  const z = metrics.radius * depth;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-label={`${option.name} — ${option.description}`}
      onClick={onSelect}
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: metrics.cardW,
        height: metrics.cardH,
        marginTop: -metrics.cardH / 2,
        marginLeft: -metrics.cardW / 2,
        transform: `rotateX(${angle}deg) translateZ(${z}px) scale(${scale})`,
        transformStyle: "preserve-3d",
        opacity,
        zIndex: Math.round(100 - abs * 10),
        cursor: isSelected ? "grab" : "pointer",
        willChange: "transform, opacity",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 22px",
          borderRadius: 20,
          filter: blur ? `blur(${blur}px)` : "none",
          background: `linear-gradient(145deg, rgba(var(--wheel-card-rgb, 255,255,255),${0.035 + focus * 0.045}), rgba(var(--wheel-card-rgb, 255,255,255),0.012))`,
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: `1px solid rgba(${focus > 0.5 ? "var(--accent-rgb)" : "var(--wheel-card-rgb, 255,255,255)"}, ${0.08 + focus * 0.42})`,
          boxShadow:
            focus > 0.35
              ? `0 18px 45px -18px rgba(0,0,0,.85), 0 0 ${18 + focus * 22}px -6px rgba(var(--accent-rgb), ${focus * 0.35})`
              : "0 12px 30px -20px rgba(0,0,0,.7)",
          transition: "background 180ms linear, border-color 180ms linear",
        }}
      >
        <span
          style={{
            fontSize: focus > 0.5 ? 26 : 20,
            lineHeight: 1,
            filter: `saturate(${0.4 + focus * 0.6})`,
            transition: "font-size 160ms ease-out",
          }}
        >
          {option.icon}
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: focus > 0.5 ? 20 : 17,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: `rgba(var(--wheel-fg-rgb, 255,255,255),${0.55 + focus * 0.45})`,
              transition: "font-size 160ms ease-out, color 160ms linear",
              whiteSpace: "nowrap",
            }}
          >
            {option.name}
          </span>
          {metrics.showDesc && (
            <span
              style={{
                display: "block",
                marginTop: 2,
                fontSize: 12.5,
                color: `rgba(var(--wheel-fg-rgb, 255,255,255),${0.18 + focus * 0.32})`,
                whiteSpace: "nowrap",
              }}
            >
              {option.description}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ThreeDWheelPicker — 재사용 가능한 컴포넌트
 * props: options, value, onChange
 * ------------------------------------------------------------------ */
// onCenterTap (optional): METIS home-wheel addition, not in the original demo.
// Tapping the already-centered card previously did nothing (see the
// `Math.abs(rel) < 0.5` guard below, which is intentionally left as-is - it
// still tells a drag from a tap and still ignores non-center taps the same
// way). This just gives the parent a hook to observe that specific case
// instead of leaving the tap unnoticed; the wheel's own behavior is
// unchanged either way, and callers that don't pass it see no difference.
export function ThreeDWheelPicker({ options, value, onChange, onCenterTap }) {
  const n = options.length;
  const bp = useBreakpoint();
  const metrics = METRICS[bp];
  const reduced = usePrefersReducedMotion();

  const onCenterTapRef = useRef(onCenterTap);
  onCenterTapRef.current = onCenterTap;

  const initialIndex = Math.max(0, options.findIndex((o) => o.id === value));

  const [offset, setOffset] = useState(initialIndex); // 렌더용 (연속값)
  const offsetRef = useRef(initialIndex);
  const targetRef = useRef(initialIndex);
  const velRef = useRef(0);
  const rafRef = useRef(null);
  const draggingRef = useRef(false);
  const wheelAccRef = useRef(0);
  const viewportRef = useRef(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /* ---------- 애니메이션 루프 (스프링 + 스냅) ---------- */
  const tick = useCallback(() => {
    rafRef.current = null;
    if (draggingRef.current) return;

    const stiffness = reduced ? 0.32 : 0.14;
    const damping = reduced ? 0.6 : 0.78;

    const d = targetRef.current - offsetRef.current;
    velRef.current = (velRef.current + d * stiffness) * damping;
    offsetRef.current += velRef.current;

    if (Math.abs(d) < 0.0008 && Math.abs(velRef.current) < 0.0008) {
      offsetRef.current = targetRef.current;
      velRef.current = 0;
      setOffset(offsetRef.current);
      return;
    }
    setOffset(offsetRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [reduced]);

  const kick = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  /* ---------- 선택값 변경 통지 ---------- */
  const selectedIndex = mod(Math.round(offset), n);
  const lastNotified = useRef(initialIndex);
  useEffect(() => {
    if (selectedIndex !== lastNotified.current) {
      lastNotified.current = selectedIndex;
      onChangeRef.current?.(optionsRef.current[selectedIndex].id);
    }
  }, [selectedIndex, n]);

  /* ---------- 외부 value 변경(예: Reset) 반영 ---------- */
  useEffect(() => {
    const idx = options.findIndex((o) => o.id === value);
    if (idx < 0) return;
    if (mod(Math.round(targetRef.current), n) === idx) return;
    // 현재 위치에서 가장 가까운 등가 인덱스로 이동 (무한 루프 유지)
    targetRef.current = Math.round(targetRef.current) + relativePos(idx, targetRef.current, n);
    lastNotified.current = idx;
    kick();
  }, [value, options, n, kick]);

  const goBy = useCallback(
    (delta) => {
      targetRef.current = Math.round(targetRef.current) + delta;
      kick();
    },
    [kick]
  );

  /* ---------- Mouse Wheel (threshold + 감속) ---------- */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      wheelAccRef.current += e.deltaY;
      const T = 45;
      if (Math.abs(wheelAccRef.current) >= T) {
        goBy(Math.sign(wheelAccRef.current)); // 1회 이벤트 = 최대 1칸
        wheelAccRef.current = 0;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [goBy]);

  /* ---------- Drag / Touch Swipe ---------- */
  const pointer = useRef({ lastY: 0, moved: 0 });

  const onPointerDown = (e) => {
    if (e.button != null && e.button > 0) return;
    // No setPointerCapture here (the original demo had one): capturing the
    // pointer to the viewport makes Chromium retarget the compatibility
    // click event AT the viewport instead of the WheelItem underneath once
    // the pointer is released, so it never bubbles through a card's onClick
    // at all. That silently broke both clicking a neighboring card to spin
    // to it and this METIS build's "tap the centered card to confirm"
    // addition - reproduced directly against a real rendered page (not a
    // test-tool artifact), and releasing capture on pointerup instead of
    // never acquiring it did not reliably fix the same-tick click's target.
    // The pointer rarely leaves the viewport during a normal drag here, so
    // skipping capture has no observed effect on drag tracking.
    draggingRef.current = true;
    velRef.current = 0;
    pointer.current = { lastY: e.clientY, moved: 0 };
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    const dy = e.clientY - pointer.current.lastY;
    pointer.current.lastY = e.clientY;
    pointer.current.moved += Math.abs(dy);

    const delta = -dy / metrics.drag; // 아래로 끌면 이전 항목
    offsetRef.current += delta;
    velRef.current = velRef.current * 0.6 + delta * 0.4; // 속도 추정(평활화)
    setOffset(offsetRef.current);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // 관성: 남은 속도만큼 더 굴린 뒤 가장 가까운 항목에 스냅
    const fling = reduced ? 0 : clamp(velRef.current * 9, -4, 4);
    targetRef.current = Math.round(offsetRef.current + fling);
    kick();
  };

  /* ---------- Keyboard ---------- */
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      goBy(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      goBy(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      targetRef.current = Math.round(targetRef.current) + relativePos(0, targetRef.current, n);
      kick();
    }
  };

  const visible = useMemo(() => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const rel = relativePos(i, offset, n);
      if (Math.abs(rel) <= 3.2) out.push({ i, rel });
    }
    return out;
  }, [offset, n]);

  return (
    <div className="w-full flex flex-col items-center">
      {/* WheelViewport */}
      <div
        ref={viewportRef}
        role="listbox"
        aria-label="라이브러리 선택 휠"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative w-full outline-none select-none"
        style={{
          height: metrics.viewportH,
          perspective: reduced ? 2400 : 1100,
          perspectiveOrigin: "50% 50%",
          touchAction: "none",
          WebkitTapHighlightColor: "transparent",
          maskImage:
            "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)",
        }}
      >
        {/* 중앙 선택 영역 가이드 */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{
            width: metrics.cardW + 34,
            height: metrics.cardH + 14,
            transform: "translate(-50%, -50%)",
            borderTop: "1px solid rgba(var(--accent-rgb), .22)",
            borderBottom: "1px solid rgba(var(--accent-rgb), .22)",
            background:
              "linear-gradient(90deg, transparent, rgba(var(--accent-rgb), .05), transparent)",
          }}
        />

        {/* WheelTrack */}
        <div
          className="absolute inset-0"
          style={{ transformStyle: "preserve-3d", transform: "translateZ(0)" }}
        >
          {visible.map(({ i, rel }) => (
            <WheelItem
              key={options[i].id}
              option={options[i]}
              rel={rel}
              metrics={metrics}
              reduced={reduced}
              isSelected={i === selectedIndex}
              onSelect={() => {
                if (pointer.current.moved > 6) return; // 드래그와 클릭 구분
                if (Math.abs(rel) < 0.5) {
                  onCenterTapRef.current?.(options[i].id);
                  return;
                }
                goBy(Math.round(rel));
                viewportRef.current?.focus();
              }}
            />
          ))}
        </div>
      </div>

      {/* NavigationControls */}
      <div className="mt-1 flex items-center gap-3">
        <button
          onClick={() => goBy(-1)}
          aria-label="이전 항목"
          className="h-9 w-9 rounded-full border transition wheel-nav-btn"
        >
          ↑
        </button>
        <span className="text-[11px] tracking-[0.18em] uppercase wheel-nav-hint">
          Scroll · Drag · Swipe
        </span>
        <button
          onClick={() => goBy(1)}
          aria-label="다음 항목"
          className="h-9 w-9 rounded-full border transition wheel-nav-btn"
        >
          ↓
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 데모 페이지
 * ------------------------------------------------------------------ */
export default function App() {
  const DEFAULT_ID = "vite";
  const [selected, setSelected] = useState(DEFAULT_ID);
  const [confirmed, setConfirmed] = useState(null);

  const current = OPTIONS.find((o) => o.id === selected) ?? OPTIONS[0];

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-5 py-10"
      style={{
        "--accent-rgb": "80, 160, 255",
        "--accent": "rgb(var(--accent-rgb))",
        background:
          "radial-gradient(900px 520px at 50% 8%, rgba(var(--accent-rgb), .10), transparent 65%), linear-gradient(180deg, #07080c 0%, #04050a 100%)",
        fontFamily:
          "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <header className="text-center mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-white">
          Select Your Library
        </h1>
        <p className="mt-2 text-sm text-white/40">Rotate the wheel to choose</p>
      </header>

      <div className="w-full max-w-xl">
        <ThreeDWheelPicker options={OPTIONS} value={selected} onChange={setSelected} />
      </div>

      {/* SelectedItem 요약 */}
      <div className="mt-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/30">Current</p>
        <p className="mt-1 text-white/85 text-base">
          <span className="mr-2">{current.icon}</span>
          {current.name}
          <span className="text-white/35"> · {current.description}</span>
        </p>
      </div>

      {/* SelectionButton + Reset */}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={() => setConfirmed(current.name)}
          className="rounded-xl px-6 py-3 text-sm font-medium text-white transition active:scale-[.98]"
          style={{
            background:
              "linear-gradient(140deg, rgba(var(--accent-rgb), .95), rgba(var(--accent-rgb), .62))",
            boxShadow: "0 12px 30px -12px rgba(var(--accent-rgb), .7)",
          }}
        >
          Select {current.name}
        </button>
        <button
          onClick={() => {
            setSelected(DEFAULT_ID);
            setConfirmed(null);
          }}
          className="rounded-xl px-5 py-3 text-sm text-white/55 border border-white/10 bg-white/[.04] hover:text-white hover:border-white/25 transition"
        >
          Reset
        </button>
      </div>

      <p className="mt-4 h-5 text-sm text-white/45">
        {confirmed ? `${confirmed} 선택됨` : ""}
      </p>
    </div>
  );
}
