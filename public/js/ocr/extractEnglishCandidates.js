export function extractLiveEnglishCandidates(data) {
  const words = (data.words || []).map(w => ({ text: String(w.text || '').replace(/[^A-Za-z'-]/g, '').toLowerCase(), confidence: Number(w.confidence || 0), bbox: w.bbox })).filter(w => /^[a-z][a-z'-]{1,29}$/.test(w.text) && w.confidence >= 35);
  const seen = new Set();
  return words.filter(w => !seen.has(w.text) && seen.add(w.text)).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
