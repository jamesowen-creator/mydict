// 작업121: 3-1단계 - kuromoji.js 형태소 분석 기반으로 전면 재작성.
// 작업118의 "Tesseract가 잘라준 낱글자/짧은 덩어리를 그대로 후보로 쓰는"
// 방식은 실사용 피드백상 정확도 한계가 커서(순수 가나 단어/조사 섞인
// 문장이 낱글자로 쪼개짐), 글자 단위 bbox를 이어붙여 원문을 복원한 뒤
// kuromoji로 실제 단어 단위를 재구성하고, 품사 정보로 조사/조동사 등을
// 걸러낸다(작업120 프로토타입 검증 결과 반영 - "これは日本語の勉強です"
// →これ/は/日本語/の/勉強/です, "コンピューター"→통째로 한 단어로
// 정확히 복원됨을 확인).
//
// 정적 단어 사전(JMDict) 대조는 아직 없음(3-2, 별도 작업) - kuromoji
// 자체가 IPADIC 사전 기반이라 사전에 없는 문자열은 애초에 토큰으로
// 잘 안 나오지만, 무의미한 가나 나열도 그럴듯하게 토큰화해버리는 경우가
// 있어(작업120에서 실측 확인) 노이즈를 완전히 걸러내진 못한다는 한계가
// 있음 - 정적 사전 대조가 여전히 필요한 이유.

const MIN_LIVE_CONFIDENCE = 40;

// 사전 검색에 의미 있는 품사만 후보로 남긴다(명사/동사/형용사). 조사
// (助詞)/조동사(助動詞)/기호(記号) 등은 제외 - 작업118의 하드코딩
// JP_PARTICLES 목록을 대체함(품사 기반이 문법적으로 더 정확하고 견고함).
const CANDIDATE_POS = new Set(['名詞', '動詞', '形容詞']);

// 작업121 실측 결과 추가: "勉強しています" 같은 문장에서 品詞만으로
// 걸러내면 본동사(勉強)뿐 아니라 그 뒤에 붙은 보조동사 용법의 いる/する도
// 動詞로 잡혀 별도 후보로 노출됨(둘 다 문법적으로는 동사이지만 실제로는
// 독립된 검색 대상이 아니라 앞 동사에 붙는 보조 성분). kuromoji는 이걸
// pos_detail_1로 자립(自立)/비자립(非自立)을 구분해주므로, 비자립 동사는
// 제외한다.
function isIndependentUsage(token) {
  return !(token.pos === '動詞' && token.pos_detail_1 === '非自立');
}

// 작업121 실측 결과 추가: 위 필터를 거치고도 "勉強する"(명사+する 복합
// 동사) 패턴에서 "する"가 独立 동사로 태깅되어 그대로 후보에 남음(IPADIC
// 태깅상 "勉強"는 名詞/サ変接続, "する"는 動詞/自立로 서로 별개 토큰이라
// 자립/비자립 구분만으로는 못 거름). 명사+する 복합동사는 매우 흔한
// 패턴(勉強する/電話する/心配する 등)이라, 바로 앞 토큰이 サ変接続
// 명사이고 현재 토큰의 기본형이 "する"면 그 する은 독립된 검색 대상이
// 아니라 앞 명사에 붙는 것으로 보고 제외한다.
function isBareSuruAttachedToNoun(token, prevToken) {
  return token.basic_form === 'する' && prevToken?.pos_detail_1 === 'サ変接続';
}

// kuromoji가 뽑아준 basic_form이 실제로 한자/가나로만 이뤄졌는지 최종
// 방어(이론상 IPADIC에 기호/영숫자 항목이 섞여 있을 가능성에 대비한
// 안전망 - 작업118에서 쓰던 것과 동일한 유니코드 범위)
const JP_CHAR_RE = /^[一-鿿぀-ゟ゠-ヿー]+$/;

// 작업110(영어 274k 단어 목록)과 같은 지연 로딩 + 캐싱 패턴. 사전
// 데이터(IPADIC, gzip 17.8MB)는 일본어 탭을 최초 선택할 때만 받아오고,
// 이후로는 페이지 생명주기 동안 재사용한다.
let tokenizerPromise = null;
export function preloadJapaneseTokenizer() {
  tokenizerPromise ??= new Promise((resolve, reject) => {
    if (!window.kuromoji) { reject(new Error('형태소 분석 엔진을 불러오지 못했습니다.')); return; }
    window.kuromoji
      .builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/' })
      .build((err, tokenizer) => { if (err) reject(err); else resolve(tokenizer); });
  }).catch((error) => {
    console.warn(`[OCR] 일본어 형태소 분석 사전 로딩 실패, 이번 세션은 후보 없이 진행: ${error.message}`);
    tokenizerPromise = null; // 다음 시도(재전환 등)에서 다시 시도할 수 있게 리셋
    return null;
  });
  return tokenizerPromise;
}

// data.words[].symbols[]를 순서대로 이어붙여 (글자, bbox, confidence)
// 배열과 원문 문자열을 복원한다. Tesseract가 data.text에 넣는 단어 사이
// 공백은 실제 일본어 원문에는 없는 합성 값이라, 여기서는 그 공백을
// 걷어내는 대신 애초에 글자 단위 symbols에서 직접 원문을 재구성한다.
function flattenSymbols(words) {
  const chars = [];
  for (const w of (words || [])) {
    for (const s of (w.symbols || [])) {
      chars.push({ char: String(s.text ?? ''), bbox: s.bbox, confidence: Number(s.confidence) });
    }
  }
  return chars;
}

function unionBbox(spanChars) {
  const boxes = spanChars.map((c) => c.bbox).filter(Boolean);
  if (!boxes.length) return undefined;
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

function averageConfidence(spanChars) {
  const values = spanChars.map((c) => c.confidence).filter((v) => Number.isFinite(v));
  if (!values.length) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// tokenizer.tokenize()가 주는 token.word_position(입력 문자열 기준
// 1-based 시작 위치)과 token.surface_form.length로 각 토큰이 원문의
// 몇 번째~몇 번째 글자에 해당하는지 역산해서, 그 구간의 글자별 bbox를
// 합쳐 후보의 화면 위치를 재구성한다. 후보 텍스트 자체는 활용형이 아닌
// 사전 표제형(basic_form)을 써서 검색하기 좋게 한다(예: "食べ"가 아니라
// "食べる") - 화면에 보이는 위치(bbox)는 실제 인식된 활용형 글자 위치
// 그대로 두고, 탭했을 때 검색되는 단어만 사전형으로 바꾸는 것.
export function rankJapaneseCandidates(tokenizer, words) {
  const chars = flattenSymbols(words);
  if (!chars.length) return [];
  const text = chars.map((c) => c.char).join('');
  const tokens = tokenizer.tokenize(text);

  const grouped = new Map();
  tokens.forEach((token, i) => {
    if (!CANDIDATE_POS.has(token.pos) || !isIndependentUsage(token)) return;
    if (isBareSuruAttachedToNoun(token, tokens[i - 1])) return;
    const word = (token.basic_form && token.basic_form !== '*') ? token.basic_form : token.surface_form;
    if (!JP_CHAR_RE.test(word) || word.length > 20) return;
    const start = token.word_position - 1;
    const end = start + token.surface_form.length;
    const span = chars.slice(start, end);
    const confidence = averageConfidence(span);
    if (confidence === undefined) return;
    const current = grouped.get(word) ?? { confidences: [], bbox: unionBbox(span), firstIndex: start };
    current.confidences.push(confidence);
    grouped.set(word, current);
  });

  return [...grouped.entries()]
    .map(([word, data]) => ({
      word,
      confidence: data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length,
      bbox: data.bbox,
      firstIndex: data.firstIndex,
    }))
    .filter((c) => c.confidence >= MIN_LIVE_CONFIDENCE)
    .sort((a, b) => (b.confidence - a.confidence) || (a.firstIndex - b.firstIndex))
    .slice(0, 5);
}

// ocrScanner.js-facing adapter: extractEnglishCandidates.js의
// deriveLiveOcrCandidates와 동일한 입출력 형태({text, confidence, bbox}
// 배열)를 돌려줘서 호출부가 언어에 따라 분기 없이 그대로 쓸 수 있게 한다.
// imageSize는 영어 쪽과 시그니처를 맞추기 위해 받지만 사용하지 않는다.
export async function deriveLiveJapaneseCandidates(data, imageSize) {
  const tokenizer = await preloadJapaneseTokenizer();
  if (!tokenizer) return []; // 사전 로딩 실패 시 이번 프레임은 후보 없음(파이프라인은 안 깨짐)
  const ranked = rankJapaneseCandidates(tokenizer, data?.words || []);
  return ranked.map(({ word, confidence, bbox }) => ({ text: word, confidence, bbox }));
}
