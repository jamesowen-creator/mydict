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
| [파일] | 저장소(파일) | DB 가 아닌 데이터 파일. 서버가 읽는 파일(data/ 아래)과 정적으로 내려주는 파일(public/ 아래 JSON·텍스트). 아래 9절 고정 목록의 이름만 쓴다. service.html 에서는 접힌 모서리 사각으로 그린다 | `reads`·`writes` 의 `파일:이름` |
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
| 음성 인식(OpenAI STT) | `POST /api/voice-notes/transcribe`(음성 학습)와 `POST /api/cmap/concepts/:id/answer/voice`(개념 지도 말로 설명하기). 녹음 → 글자(같은 OpenAI STT, 모델 VOICE_STT_MODEL) |
| 이미지 생성(OpenAI Images) | `/api/voice-notes/:id/image`. 노트 요약 이미지 |
| 서버 음성(OpenAI TTS) | 두 곳에서 OpenAI TTS 를 부른다. (1) `POST /api/tts`: 모델 tts-1-hd, tts_cache 캐시, 캐시 미스만 하루 한도 계산. (2) 관리자 Speak Loop 음성 만들기(`/api/admin/speakloop/audio/preview·generate`): 기본 모델 gpt-4o-mini-tts(환경변수·미리듣기에서 tts-1·tts-1-hd 도 선택 가능), 결과는 speakloop_audio 에 저장(preview 는 저장 안 함) |
| 저장 음성(Speak Loop) | 관리자가 만들어 speakloop_audio에 저장해 둔 음성만 재생(사용자 경로는 OpenAI 호출 없음) |
| 기기 음성(speechSynthesis) | 브라우저·폰 내장 음성. 서버 호출 없음 |
| 기기 글자 인식(Tesseract.js) | 브라우저 안 OCR(jsDelivr에서 받음). 서버 호출 없음 |
| 간격 반복 복습(SM-2) | `/api/review-*`. 복습일 계산 |
| 2인 대결 방(서버 메모리) | `/api/versus/rooms…`. DB 없이 서버 메모리(인스턴스 1개 전제) |
| 서버 메모리 작업 상태 | 중복 실행 방지·횟수 제한용 서버 메모리 상태(인스턴스 1개 전제, 재시작하면 사라짐). 단어 뜻 변환 잠금(gloss_backfill runLocked), Speak Loop 음성 생성 잠금·미리듣기 횟수 제한(speakloop_tts), 음성 학습 지도 만들기 상태(mapBuilds)·연결 분석 중복 방지(linkInFlight), 개념 지도 해설 중복 방지(narrating). 방 정보를 담는 "2인 대결 방(서버 메모리)" 와 별개 이름 |
| 스펠링 런 게임 엔진(캔버스) | logic.js·game.js. 스펠링 런 전용 |
| AI 개념 지도 처리(Claude Haiku) | `/api/cmap/*`. 개념 설명·심화(explain·deepen)·지도 해설(narrate)·말로 설명하기 평가(answer). 같은 모델 CMAP_MODEL |
| 기기 PDF 저장(캔버스) | 브라우저 안에서 지도 그림 → JPEG → 최소 PDF → 파일 다운로드(public/js/cmap/mapPdf.js). 서버 호출 없음 |

**이름 추가 절차**: 새 엔진이 필요하면 이 표에 먼저 한 줄(이름·설명) 추가한다. 화면 파일에서 표에 없는 엔진 이름을 쓰면 `blueprint:gen`이 멈춘다. 이름을 바꾸면 모든 화면 파일에서 같이 바꾼다.

## 4 외부 서비스 이름 고정 목록
Anthropic API(Claude Haiku) / OpenAI TTS(음성 합성) / OpenAI STT(음성 인식) / OpenAI Images(이미지 생성) / Google Fonts / jsDelivr(tesseract.js) / Google 로그인(OAuth)
(추가 절차는 엔진과 같다: 여기에 먼저 추가.)

## 5 화면 이름 고정 목록 (12개)
홈 / 사전 / 스펠링 런 / 문장 학습 / 음성 학습 / 개념 지도 / Speak Loop / 문학 나침반 / 한입 독서 / 과학 / 작가 노트 / 관리자
(`screen`·`navigates` 값은 이 이름만. README 화면 목록과 같다.)

## 6 근거 상태
- [확인함] 코드를 직접 읽거나 grep으로 확인했다.
- [추정] 이름·주석으로 판단했고 실행 경로는 확인하지 않았다.
- [미확인] 확인하지 못했다(화면 파일 본문에서 이유를 적는다).

## 7 db.md 형식 (저장소 한 장)
- 파일: docs/blueprint/db.md. lib/db.js 의 CREATE TABLE 마다(서버 캐시 포함) 표 한 줄. 이름 칸은 머리말과 같은 `DB:이름` 또는 `캐시:이름`.
- 칸: 이름 / 담는 것(한 줄) / 범위(사용자별·전체 공용·서버 캐시) / 핵심 열(5개 이내) / 다른 테이블과의 연결(코드에 참조 키가 있을 때만) / 근거(lib/db.js:줄, CREATE TABLE 줄).
- "읽는 화면·쓰는 화면"은 손으로 쓰지 않는다. gen 이 화면 머리말의 reads·writes 에서 만들어 db.md 맨 아래 생성 구간에 넣는다. 어떤 화면 머리말에도 없는 항목은 "화면 연결 없음"으로 표시한다(지우지 않는다).
- 대조: 화면 머리말의 `DB:`·`캐시:` 이름이 db.md 에 없거나, db.md 의 이름이 lib/db.js 에 없거나, lib/db.js 의 테이블이 db.md 에 없으면 gen 이 파일:줄과 함께 오류로 멈춘다. 근거 줄 번호는 손으로 맞춘다(gen 이 확인하지 않는다).

## 8 화면 묶음 (map.html 계층 보기)
- 한 줄에 `묶음 이름: 화면, 화면, …`. 묶음 순서는 아래 순서(계층 보기의 왼쪽부터). 화면 이름은 5절의 12개와 정확히 같아야 한다.
- gen 이 검증한다(오류는 이 파일의 줄 번호와 함께 멈춘다): 어느 묶음에도 없는 화면 / 두 묶음에 중복된 화면 / 5절에 없는 이름.
입구: 홈
학습: 사전, 스펠링 런, 문장 학습, 음성 학습, Speak Loop, 개념 지도
읽기: 문학 나침반, 한입 독서, 과학, 작가 노트
관리: 관리자

## 9 파일 이름 고정 목록 (저장소 종류 [파일], 머리말 `파일:이름`)
이 목록에 없는 이름은 머리말 reads·writes 에 쓸 수 없다(gen 이 멈춘다). 경로는 저장소 루트 기준이며 존재하는 파일이어야 한다. 쓰는 곳은 서버·화면 코드에는 없고(읽기 전용), 개발용 스크립트만 있으면 적었다.
| 이름 | 경로 | 읽는 곳 | 쓰는 곳 |
|---|---|---|---|
| literature_db | public/literature_db.json | 문학 나침반(public/literature_compass.html:818 fetch) | 개발 스크립트 scripts/generate_literature_content.js:340 |
| digest_db | public/digest_db.json | 한입 독서(public/digest_reading.html:680 fetch) | 개발 스크립트 scripts/generate_literature_content.js:341, scripts/validate_digest.js:133 |
| science_db | public/science_db.json | 과학(public/science_reading.html:1209 fetch) | 없음 |
| artist_notes_db | public/artist_notes_db.json | 작가 노트(public/artist_notes.html:531 fetch) | 없음 |
| ocr_word_list | public/data/ocr-word-list.txt | 사전의 카메라 글자 인식(public/js/ocr/extractEnglishCandidates.js:195 fetch) | 없음 |
| speakloop_content | data/speakloop/content.json | 서버(lib/speakloop_content.js:88 readFileSync) → Speak Loop·관리자 API | 없음 |
- public/ 아래 파일은 `express.static`(server.js:57)이 로그인 없이 URL 로 보낸다. 화면의 권한 확인은 데이터를 받기 전 화면 코드가 할 뿐이다. data/ 아래 파일은 정적 폴더 밖이라 URL 로 열리지 않고 API 를 거친다.
- 새 데이터 파일이 생기면 이 표에 먼저 한 줄 추가한다(엔진·외부 이름 추가 절차와 같다).

## 10 api.md 형식 (API 한 장)
- 파일: docs/blueprint/api.md. 서버 라우트(server.js·routes/*.js 의 `router|app . get|post|put|patch|delete`)마다 표 한 줄. 줄 모양(`|` 로 나눈 11칸): `METHOD 경로 | 묶음 | 정의 파일:줄 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거`.
- 묶음: 인증·계정 / 관리자 / 사전·단어장 / 문장 학습 / Speak Loop / 스펠링 런 대결 / 음성 학습 / 개념 지도 / 기타.
- 인증: `공개` / `로그인` / `관리자` / `권한:이름`(권한:can_tts 처럼 users 의 열 이름. 로그인을 포함한다).
- 읽기·쓰기: `DB:이름`·`캐시:이름`(db.md 에 있는 이름)을 쉼표로. 없으면 `-`. 인증이 공개가 아니면 requireAuth 가 users 를 읽는다(middleware/auth.js:30). 이 읽기는 행에 적지 않고 gen 이 공통 규칙으로 계산한다.
- 엔진·외부: 이 파일 3·4절 이름 그대로. 파일: 9절 이름. 없으면 `-`.
- 호출 화면: 5절 화면 이름을 쉼표로. `공용` 은 authGate.js·appHeader.js 가 부르는 것이며 gen 이 화면 머리말 modules 에 authGate.js 가 있는 화면으로 펼쳐 계산한다. 없으면 `-`.
- 근거: 확인함 / 추정 / 미확인(6절).
- gen 이 검증한다(위반은 api.md 파일:줄과 함께 오류로 멈춘다): 이름이 db.md·LEGEND 에 없음 / METHOD 경로 중복 / 칸 수 불일치 / 인증 값이 허용 목록 밖 / 정의 줄이 없거나 그 줄 ±3줄에 경로가 없음 / **코드에 있는 라우트가 api.md 에 없음** / api.md 에 있는데 코드에 없음. 오류가 아닌 경고: 화면이 부르는데 api.md 에 없는 경로, 화면 머리말과 api.md 로 계산한 화면별 접근의 차이, 어떤 API 도 접근하지 않는 db.md 항목(`npm run blueprint:gen -- --warn`).
