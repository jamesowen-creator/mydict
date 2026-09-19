let workerPromise;
export async function createLiveEnglishOcrSession() {
  if (!window.Tesseract) throw new Error('OCR 엔진을 불러오지 못했습니다.');
  workerPromise ||= window.Tesseract.createWorker('eng');
  const worker = await workerPromise;
  return { recognize: async blob => { const r = await worker.recognize(blob); return r.data; }, terminate: async () => { const w = await workerPromise; await w.terminate(); workerPromise = null; } };
}
