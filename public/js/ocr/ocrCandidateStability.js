// 작업112: 코드 에디터 화면처럼 텍스트가 빽빽하고 복잡한 장면에서는, 한
// 프레임에서 우연히 실제 사전 단어("oil" 등)로 잘못 읽히는 경우가 그대로
// 후보에 오를 수 있다. 스캔은 2초 간격으로 계속 반복되므로(ocrScanner.js의
// setInterval(scan, 2000)), 카메라가 같은 장면을 계속 비추는 동안 같은
// 단어가 연속으로 재인식될 때만 최종 후보로 승인한다.
//
// STABLE_STREAK_THRESHOLD = 2인 근거: 스캔 주기가 이미 2초로 느린 편이라
// N을 늘릴수록 최초 인식 후 후보가 화면에 뜨기까지의 체감 지연이 스캔
// 주기만큼(N=2 -> 약 2초, N=3 -> 약 4초) 늘어난다. 1회성 오독은 정의상
// 바로 다음 프레임에 똑같은 문자열로 재현될 확률이 낮은 반면(오독은
// 그 순간의 노이즈에 좌우됨), 카메라가 실제로 그 단어를 계속 비추고
// 있다면 거의 매 프레임 동일하게 재인식된다. 그래서 N=2만으로도 1회성
// 오독 대부분을 걸러내면서 지연은 스캔 주기 1회분(약 2초)으로 최소화할
// 수 있다고 판단해 이 값을 기본값으로 뒀다.
export const DEFAULT_STABLE_STREAK_THRESHOLD = 2;

// { text, confidence, bbox } 형태의 후보 배열(extractEnglishCandidates.js의
// deriveLiveOcrCandidates 출력)을 프레임마다 넣어주면, 연속 등장 스트릭을
// 추적하고 threshold 이상 연속 등장한 후보만 걸러서 돌려준다.
export function createCandidateStabilityTracker(threshold = DEFAULT_STABLE_STREAK_THRESHOLD) {
  const streaks = new Map(); // word(text) -> 연속으로 인식된 프레임 수

  function filter(words) {
    const current = new Set(words.map((w) => w.text));
    // 카메라 이동/화면 전환 등으로 이번 프레임에 안 보이는 단어는 스트릭을
    // 점진적으로 깎지 않고 즉시 리셋 - "화면이 바뀌면 이전 기록은 리셋"
    for (const word of streaks.keys()) {
      if (!current.has(word)) streaks.delete(word);
    }
    for (const w of words) {
      streaks.set(w.text, (streaks.get(w.text) || 0) + 1);
    }
    return words.filter((w) => streaks.get(w.text) >= threshold);
  }

  function reset() {
    streaks.clear();
  }

  return { filter, reset };
}
