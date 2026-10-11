// 작업112: 코드 에디터 화면처럼 텍스트가 빽빽하고 복잡한 장면에서는, 한
// 프레임에서 우연히 실제 사전 단어("oil" 등)로 잘못 읽히는 경우가 그대로
// 후보에 오를 수 있다. 스캔은 2초 간격으로 계속 반복되므로(ocrScanner.js의
// setInterval(scan, 2000)), 카메라가 같은 장면을 계속 비추는 동안 같은
// 단어가 연속으로 재인식될 때만 최종 후보로 승인한다.
//
// 작업265: "2프레임 연속"에서 "최근 3번의 스캔 중 2번"으로 완화. 확정까지 최소 스캔 횟수(2회)는
// 그대로이고, 손떨림 등으로 중간에 한 번 빠져도 확정되는 점만 다르다(발견·누락·발견 → 확정).
// 3번 연속 인식에 실패한 단어는 기록을 지워, 카메라를 돌렸다가 돌아왔을 때 옛 기록으로 바로 확정되지 않게 한다.
// 근거(작업112): 스캔 주기가 2초로 느려 횟수를 늘리면 후보가 뜨는 지연이 그만큼 늘어난다.
export const DEFAULT_STABLE_STREAK_THRESHOLD = 2;
export const DEFAULT_STABLE_WINDOW = 3;

// { text, confidence, bbox } 형태의 후보 배열(extractEnglishCandidates.js의
// deriveLiveOcrCandidates 출력)을 스캔마다(빈 결과 포함) 넣어주면, 단어별로 최근 windowSize번의
// 스캔 결과(1=인식, 0=누락)를 기록하고 그 안에서 threshold번 이상 인식된 현재 후보만 돌려준다.
export function createCandidateStabilityTracker(threshold = DEFAULT_STABLE_STREAK_THRESHOLD, windowSize = DEFAULT_STABLE_WINDOW) {
  const history = new Map(); // word(text) -> 최근 스캔 결과 배열(최대 windowSize개, 1=인식 0=누락)

  function filter(words) {
    const current = new Set(words.map((w) => w.text));
    for (const [word, recent] of history) {
      if (current.has(word)) continue;
      recent.push(0);
      if (recent.length > windowSize) recent.shift();
      // windowSize번 연속 누락이면(창 안에 인식이 하나도 없으면) 기록 삭제
      if (recent.length >= windowSize && !recent.includes(1)) history.delete(word);
    }
    for (const word of current) {
      const recent = history.get(word) || [];
      recent.push(1);
      if (recent.length > windowSize) recent.shift();
      history.set(word, recent);
    }
    return words.filter((w) => history.get(w.text).reduce((sum, v) => sum + v, 0) >= threshold);
  }

  function reset() {
    history.clear();
  }

  return { filter, reset };
}
