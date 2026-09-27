// 작업118: 영어 전용이던 liveEnglishOcrSession.js를 일반화 - 언어별로
// 워커를 새로 만드는 대신, 같은 워커를 유지한 채 worker.reinitialize()로
// 활성 언어만 전환한다(작업117 조사 결과: createWorker(langs)/
// worker.reinitialize() 둘 다 이미 로드된 언어는 재다운로드하지 않음).
let workerPromise;
let currentLang = null;

export async function createLiveOcrSession(lang = 'eng') {
  if (!window.Tesseract) throw new Error('OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
  try {
    workerPromise ||= window.Tesseract.createWorker(lang);
    const worker = await workerPromise;
    currentLang = lang;
    return {
      recognize: async blob => { const r = await worker.recognize(blob); return r.data; },
      // 카메라가 열려있는 동안 언어 탭을 전환할 때 호출 - 워커를 새로
      // 만들지 않고 활성 언어만 바꾼다(최초 사용하는 언어만 다운로드 발생).
      setLanguage: async newLang => {
        if (newLang === currentLang) return;
        await worker.reinitialize(newLang);
        currentLang = newLang;
      },
      terminate: async () => { const w = await workerPromise; await w.terminate(); workerPromise = null; currentLang = null; }
    };
  } catch (e) {
    workerPromise = null;
    currentLang = null;
    throw new Error('OCR 엔진을 초기화하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
  }
}
