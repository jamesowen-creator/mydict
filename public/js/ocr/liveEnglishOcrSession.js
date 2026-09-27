let workerPromise;
export async function createLiveEnglishOcrSession() {
  if (!window.Tesseract) throw new Error('OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
  try {
    workerPromise ||= window.Tesseract.createWorker('eng');
    const worker = await workerPromise;
    return { recognize: async blob => { const r = await worker.recognize(blob); return r.data; }, terminate: async () => { const w = await workerPromise; await w.terminate(); workerPromise = null; } };
  } catch (e) {
    workerPromise = null;
    throw new Error('OCR 엔진을 초기화하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
  }
}
