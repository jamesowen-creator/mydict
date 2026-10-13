// 작업272-1: Worker 종료 경합 제거.
// - workerPromise: 지금 쓰는 Worker(생성 중 포함). 세션이 끝나면(terminate) 즉시 null 로 비워, 다음 세션은 반드시 새 Worker 를 만든다.
// - pendingTerminate: 직전 terminate 가 끝나는 시점. 새 세션 생성(createWorker)은 이것이 끝난 뒤에만 한다
//   (예전에는 terminate 가 await 뒤에 workerPromise 를 비워서, 그 사이 다시 연 세션이 죽어 가는 Worker 를 받아 인식이 영원히 끝나지 않았다).
// - terminate 는 오류를 삼키고(호출부는 await 하지 않아도 됨) 여러 번 불러도 한 번만 실행한다.
let workerPromise = null;
let pendingTerminate = Promise.resolve();

export async function createLiveEnglishOcrSession() {
  if (!window.Tesseract) throw new Error('OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
  await pendingTerminate;
  let mine = null;
  try {
    if (!workerPromise) workerPromise = window.Tesseract.createWorker('eng');
    mine = workerPromise;
    const worker = await mine;
    let ended = false;
    return {
      recognize: async blob => {
        if (ended) throw new Error('OCR 세션이 이미 종료되었습니다.');
        const r = await worker.recognize(blob);
        return r.data;
      },
      terminate: () => {
        if (ended) return pendingTerminate;
        ended = true;
        if (workerPromise === mine) workerPromise = null;
        const p = pendingTerminate
          .then(() => mine)
          .then(w => w.terminate())
          .catch(() => { /* 종료 오류는 무시: 다음 세션은 새 Worker 를 만든다 */ });
        pendingTerminate = p;
        return p;
      },
    };
  } catch (e) {
    if (mine && workerPromise === mine) workerPromise = null;
    throw new Error('OCR 엔진을 초기화하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
  }
}
