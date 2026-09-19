// Ported from C:\dev\metis2-app\lib\ocr\extractEnglishCandidates.ts (read-only reference,
// not modified). Only the ranking logic + the small wordValidation helpers it depends on
// were pulled in - the rest of that project was not touched.

const stopwords = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had',
  'and', 'or', 'but', 'if', 'then', 'than', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'with', 'by', 'as',
]);
const liveShortWordAllowlist = new Set(['ox']);
const wordInputPattern = /^[a-z]+(?:[ -][a-z]+)*$/i;

function normalizeWord(value) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isSupportedWordInput(word) {
  return word.length >= 1 && word.length <= 50 && wordInputPattern.test(word) && word.split(' ').length <= 2;
}

function normalizeToken(raw) {
  return normalizeWord(raw.replace(/[‐‑‒–—―]/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''));
}

function isCandidateWord(word) {
  if (word.length < 2 || word.length > 30) return false;
  if (!/^[a-z]+(?:-[a-z]+)?$/.test(word)) return false;
  if (word.includes('-') && word.split('-').some((part) => part.length < 2)) return false;
  if (/(.)\1{2,}/.test(word)) return false;
  if (!isSupportedWordInput(word) || stopwords.has(word)) return false;
  return /[aeiou]/.test(word) || (word.length >= 3 && word.slice(1).includes('y'));
}

function isClippedFragment(candidate, candidates) {
  return candidates.some((other) => {
    if (other.word === candidate.word || other.confidence === undefined || candidate.confidence === undefined) return false;
    const lengthDifference = other.word.length - candidate.word.length;
    return lengthDifference >= 1
      && lengthDifference <= 2
      && other.confidence >= candidate.confidence + 20
      && (other.word.startsWith(candidate.word) || other.word.endsWith(candidate.word));
  });
}

function lengthScore(length) {
  if (length === 2) return 8;
  if (length <= 12) return 20;
  if (length <= 20) return 14;
  return 6;
}

function calculateProximityScore(bbox, imageSize) {
  if (!bbox || !imageSize || !Number.isFinite(imageSize.width) || !Number.isFinite(imageSize.height) || imageSize.width <= 0 || imageSize.height <= 0) return undefined;
  if (![bbox.x0, bbox.y0, bbox.x1, bbox.y1].every(Number.isFinite) || bbox.x0 < 0 || bbox.y0 < 0 || bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0 || bbox.x1 > imageSize.width || bbox.y1 > imageSize.height) return undefined;
  const centerX = imageSize.width / 2;
  const centerY = imageSize.height / 2;
  const wordCenterX = (bbox.x0 + bbox.x1) / 2;
  const wordCenterY = (bbox.y0 + bbox.y1) / 2;
  const normalizedDistance = Math.min(1, Math.sqrt(
    ((wordCenterX - centerX) / centerX) ** 2 + ((wordCenterY - centerY) / centerY) ** 2,
  ) / Math.sqrt(2));
  return Math.round((1 - normalizedDistance) * 12);
}

export function rankEnglishCandidates(text, structuredTokens, imageSize) {
  const tokens = structuredTokens?.length
    ? structuredTokens
    : (text || '').split(/\s+/).filter(Boolean).map((token) => ({ text: token }));
  const grouped = new Map();

  tokens.forEach((token, index) => {
    const word = normalizeToken(token.text);
    if (!isCandidateWord(word)) return;
    const current = grouped.get(word) ?? { firstIndex: index, occurrences: 0, confidences: [], proximityScores: [], phrase: false };
    current.occurrences += 1;
    if (typeof token.confidence === 'number' && Number.isFinite(token.confidence)) current.confidences.push(Math.max(0, Math.min(100, token.confidence)));
    const proximityScore = calculateProximityScore(token.bbox, imageSize);
    if (proximityScore !== undefined) current.proximityScores.push(proximityScore);
    grouped.set(word, current);
  });

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const first = normalizeToken(tokens[index].text);
    const second = normalizeToken(tokens[index + 1].text);
    if (!isCandidateWord(first) || !isCandidateWord(second)) continue;
    const phrase = `${first} ${second}`;
    const current = grouped.get(phrase) ?? { firstIndex: index, occurrences: 0, confidences: [], proximityScores: [], phrase: true };
    current.occurrences += 1;
    const confidences = [tokens[index].confidence, tokens[index + 1].confidence].filter((value) => typeof value === 'number' && Number.isFinite(value));
    if (confidences.length) current.confidences.push(confidences.reduce((sum, value) => sum + Math.max(0, Math.min(100, value)), 0) / confidences.length);
    const firstBox = tokens[index].bbox;
    const secondBox = tokens[index + 1].bbox;
    if (firstBox && secondBox) {
      const phraseBox = { x0: Math.min(firstBox.x0, secondBox.x0), y0: Math.min(firstBox.y0, secondBox.y0), x1: Math.max(firstBox.x1, secondBox.x1), y1: Math.max(firstBox.y1, secondBox.y1) };
      const proximityScore = calculateProximityScore(phraseBox, imageSize);
      if (proximityScore !== undefined) current.proximityScores.push(proximityScore);
    }
    grouped.set(phrase, current);
  }

  const candidates = [...grouped.entries()].map(([word, data]) => {
    const confidence = data.confidences.length ? data.confidences.reduce((sum, value) => sum + value, 0) / data.confidences.length : undefined;
    const confidenceScore = confidence === undefined ? 20 : Math.round(confidence * 0.4);
    const repetitionScore = Math.min(20, 10 + (data.occurrences - 1) * 5);
    const proximityScore = data.proximityScores.length ? Math.max(...data.proximityScores) : undefined;
    return {
      word,
      score: Math.min(100, confidenceScore + lengthScore(word.length) + repetitionScore + (word.includes('-') ? 5 : 10) + (proximityScore ?? 0)),
      confidence,
      occurrences: data.occurrences,
      proximityScore,
      phrase: data.phrase,
      firstIndex: data.firstIndex,
    };
  });

  return candidates
    .filter((candidate) => !isClippedFragment(candidate, candidates))
    .sort((left, right) => {
      if (left.proximityScore !== undefined || right.proximityScore !== undefined) {
        if (left.proximityScore === undefined) return 1;
        if (right.proximityScore === undefined) return -1;
        if (left.proximityScore !== right.proximityScore) return right.proximityScore - left.proximityScore;
        if (left.phrase !== right.phrase) return left.phrase ? 1 : -1;
      }
      return right.score - left.score || left.firstIndex - right.firstIndex;
    })
    .map(({ word, score, confidence, occurrences, proximityScore }) => ({ word, score, confidence, occurrences, proximityScore }));
}

export function extractEnglishCandidates(text, structuredTokens, imageSize) {
  return rankEnglishCandidates(text, structuredTokens, imageSize).slice(0, 12).map(({ word }) => word);
}

function filterLiveCandidates(ranked) {
  return ranked
    .filter((candidate) => candidate.confidence !== undefined)
    .filter((candidate) => candidate.word.length > 2 || liveShortWordAllowlist.has(candidate.word) || (candidate.word.length === 2 && (candidate.proximityScore ?? 0) >= 10))
    .slice(0, 5);
}

// Matches metis2-app's extractLiveEnglishCandidates(text, structuredTokens, imageSize)
// signature exactly (word strings only) so its test fixtures can be reused verbatim.
export function extractLiveEnglishCandidates(text, structuredTokens, imageSize) {
  return filterLiveCandidates(rankEnglishCandidates(text, structuredTokens, imageSize)).map(({ word }) => word);
}

// ocrScanner.js-facing adapter: takes the raw Tesseract.js `recognize()` result
// (`data.words`, each with text/confidence/bbox) plus the captured frame's pixel size
// for the center-proximity weighting, and returns {text, confidence, bbox} entries so
// the caller can still render overlay boxes and candidate buttons unchanged.
export function deriveLiveOcrCandidates(data, imageSize) {
  const rawWords = data?.words || [];
  const tokens = rawWords.map((w) => ({ text: String(w.text ?? ''), confidence: Number(w.confidence), bbox: w.bbox }));
  const text = typeof data?.text === 'string' ? data.text : '';
  const ranked = filterLiveCandidates(rankEnglishCandidates(text, tokens, imageSize));
  return ranked.map(({ word, confidence }) => {
    const source = rawWords.find((w) => normalizeToken(String(w.text ?? '')) === word);
    return { text: word, confidence: confidence ?? 0, bbox: source?.bbox };
  });
}
