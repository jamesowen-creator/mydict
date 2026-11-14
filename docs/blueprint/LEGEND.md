# 도면 표기 표준 (LEGEND)

도면(screens/*.md, README, map.html)은 아래 고정 어휘만 쓴다. `npm run blueprint:gen`이 화면 파일 머리말을 이 표준과 대조해 표준 밖의 키·이름·표기가 있으면 오류로 멈춘다.
이모지는 쓰지 않는다(앱 규칙과 같게). 요소 종류는 모양과 색으로 구분한다(map.html 범례 참고).

## 1 요소 종류 (7)
| 글머리 | 요소 | 무엇인가 | 머리말에 적는 곳 |
|---|---|---|---|
| [화면] | 화면 | 사용자가 여는 html 화면 | `screen`, `navigates` |
| [엔진] | 엔진 | 소리·글자·AI 등 결과를 만들어 내는 공용 기능(아래 3절 고정 목록) | `engines` |
| [API] | API | 서버 경로 `METHOD /경로` | `calls` |
| [DB] | 저장소(DB 테이블) | PostgreSQL 테이블 | `reads`·`writes` 의 `DB:이름` |
| [캐시] | 저장소(서버 캐시) | 같은 결과를 다시 만들지 않으려고 서버가 저장하는 테이블 | `reads`·`writes` 의 `캐시:이름` |
| [기기] | 저장소(기기 저장값) | 브라우저 localStorage·sessionStorage 키 | `reads`·`writes` 의 `기기:키` |
| [외부] | 외부 | 앱 밖의 서비스(아래 4절 고정 목록) | `externals` |
| [모듈] | 모듈 | 여러 화면이 같이 쓰는 파일(저장소 안 경로, 존재하는 파일이어야 함) | `modules` |
| [미작성] | 미작성 | 도면이 아직 없는 화면(README 화면 목록·map.html 점선) | (화면 파일 없음) |

## 2 관계 종류 (6) — 방향은 항상 주체 → 대상
| 표기 | 뜻 | 머리말 키 |
|---|---|---|
| →호출 | 화면이 API·엔진·외부·모듈을 쓴다 | `calls`, `engines`, `externals`, `modules` |
| →읽기 | 화면(의 API)이 저장소에서 읽는다 | `reads` |
| →쓰기 | 화면(의 API)이 저장소에 쓴다(지우기 포함) | `writes` |
| →이동 | 화면 → 화면 | `navigates` |
| ⇢대체 | 앞이 실패하면 쓰는 경로(`A ⇢ B`, 둘 다 엔진 이름) | `fallback` |
| →필요 | 로그인·권한이 있어야 쓸 수 있다 | `requires` (`로그인` / `권한:이름` / `관리자`) |

머리말 값의 모양: 목록은 `[항목, 항목]`(항목 안의 괄호 속 쉼표는 나누지 않음). `fallback` 항목은 `엔진A ⇢ 엔진B`. 항목이 없으면 `[]`.

**동작별 흐름 `flows`**(작업449): 사용자가 누르는 동작 하나(버튼·메뉴)마다 한 항목, 화면당 3~6개. 여러 줄 목록으로 쓴다(`flows: [` 다음 줄부터 한 줄에 동작 하나, 마지막 줄은 `]`).
- 항목 모양: `동작 이름 | 관계 대상 ; 관계 대상 ; …` (단계는 ` ; `로 나눈다, 단계 1개 이상, 동작 이름은 화면 안에서 중복 금지).
- 관계는 위 6종만. 대상은 API(`METHOD /경로`), 엔진 이름(LEGEND 3절), 저장소(`DB:이름`·`캐시:이름`·`기기:키`, 화면 안에서 이름이 하나뿐이면 접두어 생략 가능), 외부·모듈 이름, 화면 이름, 필요(`로그인`·`관리자`·`권한:이름`) 중 하나이고 **같은 화면 머리말의 calls·reads·writes·externals·modules·navigates·requires에 있어야 한다**(엔진은 LEGEND 목록에 있으면 된다).
- `→읽기` 대상은 reads에, `→쓰기` 대상은 writes에 있어야 한다. `⇢대체 엔진B`는 바로 앞 단계가 `→호출 엔진A`이고 머리말 fallback에 `엔진A ⇢ 엔진B`가 있어야 하며, 앞 단계와 같은 번호의 가지(a·b)로 표시된다.
- 검증: 위반은 파일:줄과 함께 오류로 멈춘다. 오류가 아닌 경고로 두 가지를 센다: 흐름에만 있는 대상(엔진이 머리말 engines에 없음), 머리말에만 있고 어떤 흐름에도 안 나오는 대상(공용 모듈·/api/me·기기 저장값처럼 흐름이 없는 연결은 정상적으로 남는다). `npm run blueprint:gen -- --warn`으로 목록을 본다.
그 밖의 머리말 키: `flows`(위), `screen`(5절 화면 이름), `file`(존재하는 html 경로), `last_checked`(마지막 확인 커밋).

## 3 엔진 이름 고정 목록 (이 이름만 쓴다)
| 엔진 | 한 줄 설명 |
|---|---|
| AI 사전·단어 질의(Claude Haiku) | `POST /api/ai`. 사전의 검색·IT 설명·퀴즈 채점·예문 생성 |
| AI 문장 해설(Claude Haiku) | `POST /api/jgrammar/explain`. 문장 해설(문장 캐시 jgrammar_cache) |
| AI 사진 문장 인식(Claude Haiku) | `POST /api/jgrammar/ocr`. 사진 속 문장 인식 |
| AI 단어 뜻 변환(Claude Haiku) | `/api/admin/gloss/*`. 저장된 영어 단어 뜻 일괄 변환(관리자) |
| AI 음성 노트 처리(Claude Haiku) | `/api/voice-notes/*`. 요약·퀴즈·대화·개념 연결·이미지 계획 |
| 음성 인식(OpenAI STT) | `POST /api/voice-notes/transcribe`. 녹음 → 글자 |
| 이미지 생성(OpenAI Images) | `/api/voice-notes/:id/image`. 노트 요약 이미지 |
| 서버 음성(OpenAI TTS) | `POST /api/tts`(tts-1-hd, tts_cache 캐시, 캐시 미스만 하루 한도 계산) |
| 저장 음성(Speak Loop) | 관리자가 만들어 speakloop_audio에 저장해 둔 음성만 재생(사용자 경로는 OpenAI 호출 없음) |
| 기기 음성(speechSynthesis) | 브라우저·폰 내장 음성. 서버 호출 없음 |
| 기기 글자 인식(Tesseract.js) | 브라우저 안 OCR(jsDelivr에서 받음). 서버 호출 없음 |
| 간격 반복 복습(SM-2) | `/api/review-*`. 복습일 계산 |
| 2인 대결 방(서버 메모리) | `/api/versus/rooms…`. DB 없이 서버 메모리(인스턴스 1개 전제) |
| 스펠링 런 게임 엔진(캔버스) | logic.js·game.js. 스펠링 런 전용 |

**이름 추가 절차**: 새 엔진이 필요하면 이 표에 먼저 한 줄(이름·설명) 추가한다. 화면 파일에서 표에 없는 엔진 이름을 쓰면 `blueprint:gen`이 멈춘다. 이름을 바꾸면 모든 화면 파일에서 같이 바꾼다.

## 4 외부 서비스 이름 고정 목록
Anthropic API(Claude Haiku) / OpenAI TTS(음성 합성) / OpenAI STT(음성 인식) / OpenAI Images(이미지 생성) / Google Fonts / jsDelivr(tesseract.js)
(추가 절차는 엔진과 같다: 여기에 먼저 추가.)

## 5 화면 이름 고정 목록 (12개)
홈 / 사전 / 스펠링 런 / 문장 학습 / 음성 학습 / 개념 지도 / Speak Loop / 문학 나침반 / 한입 독서 / 과학 / 작가 노트 / 관리자
(`screen`·`navigates` 값은 이 이름만. README 화면 목록과 같다.)

## 6 근거 상태
- [확인함] 코드를 직접 읽거나 grep으로 확인했다.
- [추정] 이름·주석으로 판단했고 실행 경로는 확인하지 않았다.
- [미확인] 확인하지 못했다(화면 파일 본문에서 이유를 적는다).
