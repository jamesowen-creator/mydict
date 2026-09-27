// 작업118: 일본어 OCR 후보 추출 (1단계 MVP)
//
// 작업117 조사 결과, Tesseract의 일본어 인식은 낱글자 단위 신뢰도는 높지만
// (실측 79~97%) 여러 글자를 하나의 "단어"로 묶는 세그멘테이션은 불안정함
// (예: "日本語"가 日/本/語 3글자로 쪼개짐). 영어처럼 공백으로 단어 경계가
// 주어지지 않고, 정적 일본어 단어 목록도 아직 없어(작업117에서 확인 -
// public/data/에 영어 274k 목록만 존재) extractEnglishCandidates.js와
// 같은 "사전 목록 대조" 방식은 적용할 수 없다.
//
// 그래서 이번 MVP는 Tesseract가 뽑아준 토큰을 그대로 후보로 쓰되, 다음
// 두 가지로만 노이즈를 거른다:
//   1) 한자(CJK 통합 한자) + 히라가나 + 가타카나 유니코드 범위 검사 -
//      라틴 문자/숫자/기호/구두점 등은 전부 제외
//   2) 신뢰도 임계값 - 영어(작업102/109, MIN_LIVE_CONFIDENCE=40)와 같은
//      값을 우선 채택. 정상 글자 신뢰도가 대체로 그보다 훨씬 높다는 걸
//      작업117 실측으로도 확인했으므로 안전 마진 성격은 동일함.
// 연속 프레임 안정성 검증(ocrCandidateStability.js)은 ocrScanner.js에서
// 언어 무관 공통 로직으로 이미 적용되므로 여기서는 다루지 않는다.
// (한자 위주 단어는 어느 정도 쓸만하지만, 순수 히라가나/가타카나 단어는
// 낱글자로 쪼개지면 의미가 사라지는 한계가 있음 - 실사용 피드백을 보고
// 형태소 분석기 도입 등 3단계 투자 여부를 결정할 것.)

const MIN_LIVE_CONFIDENCE = 40;

// CJK 통합 한자(4E00-9FFF) + 히라가나(3040-309F) + 가타카나(30A0-30FF,
// 장음 기호 'ー' 포함) 범위만 허용
const JP_CHAR_RE = /^[一-鿿぀-ゟ゠-ヿー]+$/;

// 작업118 실측 결과 반영: 조사/흔한 활용어미는 신뢰도가 높게 나오는
// 경우가 많아(예: "これは日本語の勉強です"에서 は/これ/で가 정작 내용어인
// "勉強"보다 먼저 top-5에 들어가 밀어냄) 영어 stopwords와 같은 취지로
// 제외한다. 정적 사전 목록이 아니라 순수 문법 기능어 목록이라는 점에서
// 이번 MVP의 "정적 단어 사전 검증 없음" 원칙과 배치되지 않는다.
const JP_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'から', 'まで',
  'より', 'ので', 'のに', 'けど', 'です', 'ます', 'した', 'して', 'いる', 'いま',
]);

function normalizeToken(raw) {
  return String(raw ?? '').trim();
}

function isCandidateToken(word) {
  if (!word || word.length === 0 || word.length > 20) return false;
  if (JP_PARTICLES.has(word)) return false;
  // 장음 기호(ー)만 단독으로는 그 자체로 의미가 없는 토큰이라 제외
  // (가타카나 단어가 여러 조각으로 쪼개질 때 실측으로 확인된 케이스)
  if (word === 'ー') return false;
  return JP_CHAR_RE.test(word);
}

export function rankJapaneseCandidates(tokens) {
  // 같은 토큰이 한 프레임 안에 여러 번 나오면 합쳐서 평균 신뢰도로 대표
  const grouped = new Map();
  tokens.forEach((token, index) => {
    const word = normalizeToken(token.text);
    if (!isCandidateToken(word)) return;
    const current = grouped.get(word) ?? { firstIndex: index, confidences: [], bbox: token.bbox };
    if (typeof token.confidence === 'number' && Number.isFinite(token.confidence)) {
      current.confidences.push(Math.max(0, Math.min(100, token.confidence)));
    }
    grouped.set(word, current);
  });

  return [...grouped.entries()]
    .map(([word, data]) => ({
      word,
      confidence: data.confidences.length ? data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length : undefined,
      firstIndex: data.firstIndex,
      bbox: data.bbox,
    }))
    .filter((c) => c.confidence !== undefined && c.confidence >= MIN_LIVE_CONFIDENCE)
    .sort((a, b) => (b.confidence - a.confidence) || (a.firstIndex - b.firstIndex))
    .slice(0, 5);
}

// ocrScanner.js-facing adapter: extractEnglishCandidates.js의
// deriveLiveOcrCandidates와 동일한 입출력 형태 - {text, confidence, bbox}
// 배열을 돌려줘서 호출부(render/overlay/큐)가 언어에 따라 분기 없이 그대로
// 쓸 수 있게 한다. imageSize는 영어 쪽과 시그니처를 맞추기 위해 받지만
// 이번 MVP에서는 중심 근접도 가중치를 적용하지 않아 사용하지 않는다.
export async function deriveLiveJapaneseCandidates(data, imageSize) {
  const rawWords = data?.words || [];
  const tokens = rawWords.map((w) => ({ text: String(w.text ?? ''), confidence: Number(w.confidence), bbox: w.bbox }));
  const ranked = rankJapaneseCandidates(tokens);
  return ranked.map(({ word, confidence, bbox }) => ({ text: word, confidence: confidence ?? 0, bbox }));
}
