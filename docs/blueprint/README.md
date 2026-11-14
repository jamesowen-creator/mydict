# METIS-3 도면 (docs/blueprint)

## 목적
- 화면 → 기능 → 엔진 → 경로 → DB → 연결(API·외부 서비스)을 코드에서 확인한 사실만 적는다. 추정은 [미확인]으로 표시한다.
- 공용 부품(엔진·API·테이블)을 바꿀 때 "이 부품을 쓰는 화면"을 바로 찾게 한다(아래 생성 구간).
- 실패 시 동작·결정 이유·불변 조건은 이 도면에 넣지 않는다(기본 구조와 관계만).

## 읽는 법
- 화면마다 `screens/<이름>.md` 한 장. 맨 위 머리말(`---` 사이)은 기계가 읽는 목록이고, 본문은 5개 절(1 기능 / 2 엔진 / 3 경로 / 4 DB / 5 연결)이다. 경로는 `파일:줄`.
- 아래 "생성 구간"은 머리말에서 `npm run blueprint:gen`이 만든다(손으로 고치지 않는다). 시각 도면은 `map.html`을 브라우저로 직접 연다(항목을 누르면 연결된 항목이 강조된다).
- 각 화면 파일의 `last_checked`(마지막 확인 커밋)보다 코드가 많이 바뀌었으면 낡았을 수 있다.

## 화면 목록 (public/ 아래 사용자 접근 화면 12개)
| 화면 | 파일 | 한 줄 설명 | 도면 |
|---|---|---|---|
| 홈 | public/home/index.html | 로그인·메뉴 진입 화면(빌드된 번들 public/home/assets). 상세 [미확인] | 미작성 |
| 사전 | public/english_dictionary.html | 영·한·일·중 검색, 단어장(#wordbook), 발음, 팟캐스트, 퀴즈·복습, 카메라 글자 인식 | 작성 |
| 스펠링 런 | public/spelling_run.html | 단어장 단어로 하는 철자 게임(혼자·2인 대결) | 작성 |
| 문장 학습 | public/jgrammar.html | 일본어·영어·중국어 문장 해설·사진 인식·저장·읽어주기(파일명 jgrammar) | 작성 |
| 음성 학습 | public/voice_study.html | 음성 노트·퀴즈·개념 연결(/api/voice-notes…) | 미작성 |
| 개념 지도 | public/concept_map.html | 개념 지도·복습·서술 답변(/api/cmap…) | 미작성 |
| Speak Loop | public/speakloop.html | 영어 말하기 연습(저장 음성, 이디엄 포함; /api/speakloop…) | 미작성 |
| 문학 나침반 | public/literature_compass.html | 정적 콘텐츠(literature_db.json) 읽기 | 미작성 |
| 한입 독서 | public/digest_reading.html | 정적 콘텐츠(digest_db.json) 읽기 | 미작성 |
| 과학 | public/science_reading.html | 정적 콘텐츠(science_db.json) 읽기 | 미작성 |
| 작가 노트 | public/artist_notes.html | 정적 콘텐츠(artist_notes_db.json) 읽기 | 미작성 |
| 관리자 | public/admin.html | 사용자·권한·사용량, Speak Loop 음성, 단어 뜻 변환, 발음 캐시 지우기 | 미작성 |
- 단어장·팟캐스트·IT 용어는 별도 파일이 아니라 사전 화면(english_dictionary.html) 안의 기능이다. 대결은 스펠링 런 안의 기능이다.

## 공용 엔진 목록 (이름은 모든 화면 파일에서 같은 철자로 쓴다)
| 엔진 | 한 줄 설명 |
|---|---|
| AI 사전·단어 질의(Claude Haiku) | `POST /api/ai`. 사전의 검색·IT 설명·퀴즈 채점·예문 생성 |
| AI 문장 해설(Claude Haiku) | `POST /api/jgrammar/explain`. 문장 해설(문장 캐시 jgrammar_cache) |
| AI 사진 문장 인식(Claude Haiku) | `POST /api/jgrammar/ocr`. 사진 속 문장 인식 |
| 서버 음성(OpenAI TTS) | `POST /api/tts`(tts-1-hd, tts_cache 캐시, 캐시 미스만 하루 한도 계산) |
| 기기 음성(speechSynthesis) | 브라우저·폰 내장 음성. 서버 호출 없음 |
| 기기 글자 인식(Tesseract.js) | 브라우저 안 OCR(jsDelivr에서 받음). 서버 호출 없음 |
| 간격 반복 복습(SM-2) | `/api/review-*`. 복습일 계산 |
| 2인 대결 방(서버 메모리) | `/api/versus/rooms…`. DB 없이 서버 메모리(인스턴스 1개 전제) |
| 스펠링 런 게임 엔진(캔버스) | logic.js·game.js. 스펠링 런 전용 |

## 생성 구간 (npm run blueprint:gen 이 만든다. 이 안은 손으로 고치지 않는다)
<!-- gen:start -->
> 이 구간은 `npm run blueprint:gen` 이 화면 파일(docs/blueprint/screens)의 머리말에서 만든다. 손으로 고치지 않는다.
> **도면이 작성된 화면(3개)만 반영한다.** 미작성 화면이 같은 엔진·API·테이블을 쓰는지는 이 목록에 나오지 않으므로 코드로 직접 확인한다.

### 엔진별 사용 화면
- **2인 대결 방(서버 메모리)** — 스펠링 런
- **AI 문장 해설(Claude Haiku)** — 문장 학습
- **AI 사전·단어 질의(Claude Haiku)** — 사전
- **AI 사진 문장 인식(Claude Haiku)** — 문장 학습
- **간격 반복 복습(SM-2)** — 사전
- **기기 글자 인식(Tesseract.js)** — 사전
- **기기 음성(speechSynthesis)** — 문장 학습, 사전, 스펠링 런
- **서버 음성(OpenAI TTS)** — 사전, 스펠링 런
- **스펠링 런 게임 엔진(캔버스)** — 스펠링 런

### API별 사용 화면
- **DELETE /api/jgrammar/saved/:id** — 문장 학습
- **DELETE /api/wordbook/:id** — 사전
- **DELETE /api/wordbook/:id/it** — 사전
- **GET /api/jgrammar/saved** — 문장 학습
- **GET /api/me** — 문장 학습, 사전, 스펠링 런
- **GET /api/review-due** — 사전
- **GET /api/versus/rooms** — 스펠링 런
- **GET /api/versus/rooms/:id** — 스펠링 런
- **GET /api/wordbook** — 사전, 스펠링 런
- **PATCH /api/wordbook/:id/example** — 사전
- **PATCH /api/wordbook/:id/it** — 사전
- **POST /api/ai** — 사전
- **POST /api/jgrammar/explain** — 문장 학습
- **POST /api/jgrammar/ocr** — 문장 학습
- **POST /api/quiz-correct** — 사전
- **POST /api/review-result** — 사전
- **POST /api/tts** — 사전, 스펠링 런
- **POST /api/versus/rooms** — 스펠링 런
- **POST /api/versus/rooms/:id/finish** — 스펠링 런
- **POST /api/versus/rooms/:id/join** — 스펠링 런
- **POST /api/versus/rooms/:id/leave** — 스펠링 런
- **POST /api/versus/rooms/:id/rematch** — 스펠링 런
- **POST /api/versus/rooms/:id/start** — 스펠링 런
- **POST /api/versus/rooms/:id/state** — 스펠링 런
- **POST /api/wordbook** — 사전

### 테이블별 사용 화면
- **api_usage** — 문장 학습, 사전, 스펠링 런
- **jgrammar_cache** — 문장 학습
- **jgrammar_saved** — 문장 학습
- **review_log** — 사전
- **tts_cache** — 사전, 스펠링 런
- **users** — 문장 학습, 사전, 스펠링 런
- **wordbook** — 사전, 스펠링 런

### 외부 서비스별 사용 화면
- **Anthropic API(Claude Haiku)** — 문장 학습, 사전
- **Google Fonts** — 문장 학습, 사전, 스펠링 런
- **OpenAI TTS(tts-1-hd)** — 사전, 스펠링 런
- **jsDelivr(tesseract.js)** — 사전

### 미작성 화면 (9개)
METIS Admin(public/admin.html), 작가 노트(public/artist_notes.html), 개념 지도 - METIS(public/concept_map.html), 한입 독서(public/digest_reading.html), METIS(public/home/index.html), 문학 나침반(public/literature_compass.html), 과학 - METIS(public/science_reading.html), Speak Loop(public/speakloop.html), 음성 학습 - METIS(public/voice_study.html)

화면 파일의 마지막 확인 커밋: 1a8e9cd
<!-- gen:end -->

## 작업 블록 규칙
1. 화면·엔진·API·테이블을 바꾸는 작업은 해당 화면 파일의 머리말과 5개 절을 갱신하고(`last_checked`도 현재 커밋으로), `npm run blueprint:gen`을 실행해 README·map.html을 함께 커밋한다.
2. 공용 엔진·API·테이블을 바꾸는 작업은 위 생성 구간의 역방향 목록을 코드(grep)로 다시 확인해 영향 화면을 작업 보고에 적는다(목록의 "미작성 화면"은 목록에 없어도 쓸 수 있으니 코드로 직접 확인).
