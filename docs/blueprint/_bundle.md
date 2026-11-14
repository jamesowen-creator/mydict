# METIS-3 도면 묶음 (_bundle.md)

이 파일은 `npm run blueprint:gen` 이 만든다(직접 고치지 않는다). 용도: 이 한 파일을 웹 Claude 에 첨부해 프로젝트 문서로 복사한다.
순서: README → LEGEND → screens(파일 이름 순). 기준 커밋(화면 파일의 last_checked): 8753b0a
화면 파일 6개.

=====================================================================
### 파일: docs/blueprint/README.md
=====================================================================

# METIS-3 도면 (docs/blueprint)

## 목적
- 화면 → 기능 → 엔진 → 경로 → DB → 연결(API·외부 서비스)을 코드에서 확인한 사실만 적는다. 추정은 [추정]·[미확인]으로 표시한다.
- 공용 부품(엔진·API·저장소)을 바꿀 때 "이 부품을 쓰는 화면"을 바로 찾게 한다(아래 생성 구간).
- 실패 시 동작·결정 이유·불변 조건은 이 도면에 넣지 않는다(기본 구조와 관계만).

## 읽는 법
- 표기 어휘(요소 7종·관계 6종·엔진 이름 고정 목록·근거 상태)는 [LEGEND.md](LEGEND.md)에 고정돼 있다. 화면 파일 머리말은 그 표준 키만 쓰고, 표준 밖의 키·이름이 있으면 `npm run blueprint:gen`이 오류로 멈춘다.
- 화면마다 `screens/<이름>.md` 한 장. 맨 위 머리말(`---` 사이)은 기계가 읽는 목록이고, 본문은 5개 절(1 기능 / 2 엔진 / 3 경로 / 4 DB / 5 연결)이다. 경로는 `파일:줄`.
- 아래 "생성 구간"은 머리말에서 `npm run blueprint:gen`이 만든다(손으로 고치지 않는다). 시각 도면은 [map.html](map.html)을 브라우저로 직접 연다(항목을 누르면 연결된 항목이 강조되고 관계 종류별로 나열된다).
- 화면 파일 머리말의 `flows`는 "동작별 흐름"(사용자가 누르는 동작 하나마다 → 호출·읽기·쓰기 순서)이다. map.html에서 화면을 누르고 동작 카드를 누르면 왼쪽 목록에 ①②③ 번호가 붙는다. 문법은 LEGEND 2절.
- 웹 Claude 등 저장소를 못 읽는 곳에 줄 때는 생성된 [_bundle.md](_bundle.md) 한 파일을 쓴다(README → LEGEND → screens).
- 각 화면 파일의 `last_checked`(마지막 확인 커밋)보다 코드가 많이 바뀌었으면 낡았을 수 있다.

## 화면 목록 (public/ 아래 사용자 접근 화면 12개)
| 화면 | 파일 | 한 줄 설명 | 도면 |
|---|---|---|---|
| 홈 | public/home/index.html | 로그인·메뉴 진입 화면(빌드된 번들 public/home/assets). 상세 [미확인] | 미작성 |
| 사전 | public/english_dictionary.html | 영·한·일·중 검색, 단어장(#wordbook), 발음, 팟캐스트, 퀴즈·복습, 카메라 글자 인식 | 작성 |
| 스펠링 런 | public/spelling_run.html | 단어장 단어로 하는 철자 게임(혼자·2인 대결) | 작성 |
| 문장 학습 | public/jgrammar.html | 일본어·영어·중국어 문장 해설·사진 인식·저장·읽어주기(파일명 jgrammar) | 작성 |
| 음성 학습 | public/voice_study.html | 음성 노트(녹음 변환·요약·퀴즈·대화·연결 지도·이미지)와 요약 읽어주기 | 작성 |
| 개념 지도 | public/concept_map.html | 개념 지도·복습·서술 답변(/api/cmap…) | 미작성 |
| Speak Loop | public/speakloop.html | 영어 말하기 연습(저장 음성, 이디엄 포함; /api/speakloop…) | 작성 |
| 문학 나침반 | public/literature_compass.html | 정적 콘텐츠(literature_db.json) 읽기 | 미작성 |
| 한입 독서 | public/digest_reading.html | 정적 콘텐츠(digest_db.json) 읽기 | 미작성 |
| 과학 | public/science_reading.html | 정적 콘텐츠(science_db.json) 읽기 | 미작성 |
| 작가 노트 | public/artist_notes.html | 정적 콘텐츠(artist_notes_db.json) 읽기 | 미작성 |
| 관리자 | public/admin.html | 사용자·권한·사용량, Speak Loop 음성, 단어 뜻 변환, 발음 캐시 지우기 | 작성 |
- 단어장·팟캐스트·IT 용어는 별도 파일이 아니라 사전 화면(english_dictionary.html) 안의 기능이다. 대결은 스펠링 런 안의 기능, 이디엄은 Speak Loop 안의 기능이다.
- 이 표의 "도면" 열은 손으로 관리한다. 정확한 미작성 목록은 아래 생성 구간이 보여 준다.

## 공용 엔진 목록
엔진 이름 고정 목록과 한 줄 설명은 [LEGEND.md](LEGEND.md) 3절에 있다(새 엔진은 거기에 먼저 추가한다).

## 생성 구간 (npm run blueprint:gen 이 만든다. 이 안은 손으로 고치지 않는다)
<!-- gen:start -->
> 이 구간은 `npm run blueprint:gen` 이 화면 파일(docs/blueprint/screens)의 머리말에서 만든다. 손으로 고치지 않는다.
> **도면이 작성된 화면(6개)만 반영한다.** 미작성 화면이 같은 엔진·API·저장소를 쓰는지는 이 목록에 나오지 않으므로 코드로 직접 확인한다.

### 엔진별 사용 화면 (→호출)
- **2인 대결 방(서버 메모리)** — 스펠링 런
- **AI 단어 뜻 변환(Claude Haiku)** — 관리자
- **AI 문장 해설(Claude Haiku)** — 문장 학습
- **AI 사전·단어 질의(Claude Haiku)** — 사전
- **AI 사진 문장 인식(Claude Haiku)** — 문장 학습
- **AI 음성 노트 처리(Claude Haiku)** — 음성 학습
- **간격 반복 복습(SM-2)** — 사전
- **기기 글자 인식(Tesseract.js)** — 사전
- **기기 음성(speechSynthesis)** — 문장 학습, 사전, 스펠링 런, 음성 학습
- **서버 음성(OpenAI TTS)** — 사전, 스펠링 런
- **스펠링 런 게임 엔진(캔버스)** — 스펠링 런
- **음성 인식(OpenAI STT)** — 음성 학습
- **이미지 생성(OpenAI Images)** — 음성 학습
- **저장 음성(Speak Loop)** — Speak Loop, 관리자

### 대체 경로 (⇢대체: 앞이 실패하면 뒤를 쓴다)
- **서버 음성(OpenAI TTS) ⇢ 기기 음성(speechSynthesis)** — 사전, 스펠링 런

### API별 사용 화면 (→호출)
- **DELETE /api/jgrammar/saved/:id** — 문장 학습
- **DELETE /api/tts/cache/entry** — 관리자
- **DELETE /api/voice-notes/:id** — 음성 학습
- **DELETE /api/voice-notes/links/:id** — 음성 학습
- **DELETE /api/wordbook/:id** — 사전
- **DELETE /api/wordbook/:id/it** — 사전
- **GET /api/admin/gloss/backup** — 관리자
- **GET /api/admin/gloss/status** — 관리자
- **GET /api/admin/speakloop/audio/list** — 관리자
- **GET /api/admin/speakloop/audio/status** — 관리자
- **GET /api/admin/stats** — 관리자
- **GET /api/admin/users** — 관리자
- **GET /api/jgrammar/saved** — 문장 학습
- **GET /api/me** — Speak Loop, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **GET /api/review-due** — 사전
- **GET /api/speakloop/audio-index** — Speak Loop
- **GET /api/speakloop/audio/:clipKey** — Speak Loop, 관리자
- **GET /api/speakloop/content** — Speak Loop, 관리자
- **GET /api/speakloop/progress** — Speak Loop
- **GET /api/versus/rooms** — 스펠링 런
- **GET /api/versus/rooms/:id** — 스펠링 런
- **GET /api/voice-notes** — 음성 학습
- **GET /api/voice-notes/:id** — 음성 학습
- **GET /api/voice-notes/:id/image** — 음성 학습
- **GET /api/voice-notes/:id/image/file** — 음성 학습
- **GET /api/voice-notes/:id/links** — 음성 학습
- **GET /api/voice-notes/:id/quiz** — 음성 학습
- **GET /api/voice-notes/:id/quiz/attempts** — 음성 학습
- **GET /api/voice-notes/map** — 음성 학습
- **GET /api/voice-notes/map/build-status** — 음성 학습
- **GET /api/voice-notes/quiz-summary** — 음성 학습
- **GET /api/voice-notes/wrong-answers** — 음성 학습
- **GET /api/wordbook** — 사전, 스펠링 런
- **PATCH /api/admin/users/:id** — 관리자
- **PATCH /api/voice-notes/:id** — 음성 학습
- **PATCH /api/voice-notes/:id/image/rating** — 음성 학습
- **PATCH /api/voice-notes/links/:id** — 음성 학습
- **PATCH /api/wordbook/:id/example** — 사전
- **PATCH /api/wordbook/:id/it** — 사전
- **POST /api/admin/gloss/restore** — 관리자
- **POST /api/admin/gloss/run** — 관리자
- **POST /api/admin/gloss/sample** — 관리자
- **POST /api/admin/speakloop/audio/generate** — 관리자
- **POST /api/admin/speakloop/audio/preview** — 관리자
- **POST /api/ai** — 사전
- **POST /api/jgrammar/explain** — 문장 학습
- **POST /api/jgrammar/ocr** — 문장 학습
- **POST /api/quiz-correct** — 사전
- **POST /api/review-result** — 사전
- **POST /api/speakloop/progress** — Speak Loop
- **POST /api/tts** — 사전, 스펠링 런
- **POST /api/versus/rooms** — 스펠링 런
- **POST /api/versus/rooms/:id/finish** — 스펠링 런
- **POST /api/versus/rooms/:id/join** — 스펠링 런
- **POST /api/versus/rooms/:id/leave** — 스펠링 런
- **POST /api/versus/rooms/:id/rematch** — 스펠링 런
- **POST /api/versus/rooms/:id/start** — 스펠링 런
- **POST /api/versus/rooms/:id/state** — 스펠링 런
- **POST /api/voice-notes** — 음성 학습
- **POST /api/voice-notes/:id/chat** — 음성 학습
- **POST /api/voice-notes/:id/image** — 음성 학습
- **POST /api/voice-notes/:id/links/refresh** — 음성 학습
- **POST /api/voice-notes/:id/quiz** — 음성 학습
- **POST /api/voice-notes/:id/quiz/attempts** — 음성 학습
- **POST /api/voice-notes/links** — 음성 학습
- **POST /api/voice-notes/map/build** — 음성 학습
- **POST /api/voice-notes/merge** — 음성 학습
- **POST /api/voice-notes/summarize** — 음성 학습
- **POST /api/voice-notes/transcribe** — 음성 학습
- **POST /api/wordbook** — 사전

### 저장소별 사용 화면 ([DB]·[캐시], →읽기 / →쓰기)
- **[DB] api_usage** — 읽기: 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습 / 쓰기: 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **[DB] gloss_backup** — 읽기: 관리자 / 쓰기: 관리자
- **[DB] jgrammar_saved** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **[DB] review_log** — 읽기: - / 쓰기: 사전
- **[DB] speakloop_audio** — 읽기: Speak Loop, 관리자 / 쓰기: 관리자
- **[DB] speakloop_progress** — 읽기: Speak Loop / 쓰기: Speak Loop
- **[DB] users** — 읽기: Speak Loop, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습 / 쓰기: 관리자
- **[DB] voice_image_sets** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_images** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_links** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_notes** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_quiz_attempts** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_quizzes** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] wordbook** — 읽기: 관리자, 사전, 스펠링 런 / 쓰기: 관리자, 사전
- **[캐시] jgrammar_cache** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **[캐시] tts_cache** — 읽기: 사전, 스펠링 런 / 쓰기: 관리자, 사전, 스펠링 런

### 기기 저장값별 사용 화면 ([기기] localStorage·sessionStorage 키, 두 화면 이상이 쓰는 키는 공유 키)
- **gl_last_run** — 읽기: 관리자 / 쓰기: 관리자
- **jgrammar_furigana** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **jgrammar_lang** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **jgrammar_pinyin** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **jgrammar_zh** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **metis_tts_mode** — 읽기: 사전, 스펠링 런 / 쓰기: 사전, 스펠링 런
- **mydict_token** — 읽기: Speak Loop, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습 / 쓰기: 사전
- **mydict_wrong** — 읽기: 사전 / 쓰기: 사전
- **spellrun_best** — 읽기: 스펠링 런 / 쓰기: 스펠링 런
- **spellrun_bgm** — 읽기: 스펠링 런 / 쓰기: 스펠링 런
- **spellrun_char** — 읽기: 스펠링 런 / 쓰기: 스펠링 런
- **spellrun_ids** — 읽기: 스펠링 런 / 쓰기: 사전
- **spellrun_landing_count** — 읽기: 사전 / 쓰기: 사전
- **spellrun_mode** — 읽기: 스펠링 런 / 쓰기: 스펠링 런
- **spellrun_opts** — 읽기: 스펠링 런 / 쓰기: 스펠링 런
- **spellrun_preview** — 읽기: 스펠링 런 / 쓰기: 스펠링 런
- **spellrun_view** — 읽기: 스펠링 런 / 쓰기: 스펠링 런
- **voice_tts_rate** — 읽기: 음성 학습 / 쓰기: 음성 학습

### 외부 서비스별 사용 화면 ([외부])
- **Anthropic API(Claude Haiku)** — 관리자, 문장 학습, 사전, 음성 학습
- **Google Fonts** — Speak Loop, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **OpenAI Images(이미지 생성)** — 음성 학습
- **OpenAI STT(음성 인식)** — 음성 학습
- **OpenAI TTS(음성 합성)** — 관리자, 사전, 스펠링 런
- **jsDelivr(tesseract.js)** — 사전

### 모듈별 사용 화면 ([모듈])
- **public/js/common/appHeader.js** — Speak Loop, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **public/js/common/authGate.js** — Speak Loop, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **public/js/common/dialog.js** — 문장 학습, 사전, 스펠링 런, 음성 학습
- **public/js/ocr/ocrScanner.js** — 사전

### 미작성 화면 (6개)
홈(public/home/index.html), 개념 지도(public/concept_map.html), 문학 나침반(public/literature_compass.html), 한입 독서(public/digest_reading.html), 과학(public/science_reading.html), 작가 노트(public/artist_notes.html)

화면 파일의 마지막 확인 커밋: 8753b0a
<!-- gen:end -->

## 작업 블록 규칙
1. 화면·엔진·API·저장소를 바꾸는 작업은 해당 화면 파일의 머리말과 5개 절을 갱신하고(`last_checked`도 현재 커밋으로), `npm run blueprint:gen`을 실행해 README·map.html·_bundle.md를 함께 커밋한다.
2. 공용 엔진·API·저장소를 바꾸는 작업은 위 생성 구간의 역방향 목록을 코드(grep)로 다시 확인해 영향 화면을 작업 보고에 적는다(목록의 "미작성 화면"은 목록에 없어도 쓸 수 있으니 코드로 직접 확인).

=====================================================================
### 파일: docs/blueprint/LEGEND.md
=====================================================================

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

=====================================================================
### 파일: docs/blueprint/screens/admin.md
=====================================================================

---
screen: 관리자
file: public/admin.html
engines: [AI 단어 뜻 변환(Claude Haiku), 저장 음성(Speak Loop)]
calls: [GET /api/me, GET /api/admin/users, PATCH /api/admin/users/:id, GET /api/admin/stats, GET /api/admin/speakloop/audio/status, GET /api/admin/speakloop/audio/list, POST /api/admin/speakloop/audio/preview, POST /api/admin/speakloop/audio/generate, GET /api/speakloop/content, GET /api/speakloop/audio/:clipKey, GET /api/admin/gloss/status, POST /api/admin/gloss/sample, POST /api/admin/gloss/run, POST /api/admin/gloss/restore, GET /api/admin/gloss/backup, DELETE /api/tts/cache/entry]
reads: [DB:users, DB:api_usage, DB:wordbook, DB:speakloop_audio, DB:gloss_backup, 기기:mydict_token, 기기:gl_last_run]
writes: [DB:users, DB:api_usage, DB:wordbook, DB:speakloop_audio, DB:gloss_backup, 캐시:tts_cache, 기기:gl_last_run]
fallback: []
flows: [
  발음 캐시 지우기 | →필요 관리자 ; →호출 DELETE /api/tts/cache/entry ; →쓰기 tts_cache,
  사용자 권한 변경 | →필요 관리자 ; →호출 PATCH /api/admin/users/:id ; →쓰기 users,
  Speak Loop 음성 만들기 | →필요 관리자 ; →호출 POST /api/admin/speakloop/audio/generate ; →호출 저장 음성(Speak Loop) ; →호출 OpenAI TTS(음성 합성) ; →쓰기 speakloop_audio ; →쓰기 api_usage,
  뜻 변환 샘플 보기 | →필요 관리자 ; →호출 POST /api/admin/gloss/sample ; →읽기 wordbook ; →호출 AI 단어 뜻 변환(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage,
  뜻 변환 전체 적용 | →필요 관리자 ; →호출 POST /api/admin/gloss/run ; →읽기 wordbook ; →호출 AI 단어 뜻 변환(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 wordbook ; →쓰기 gloss_backup ; →쓰기 api_usage,
  뜻 변환 되돌리기 | →필요 관리자 ; →호출 POST /api/admin/gloss/restore ; →읽기 gloss_backup ; →쓰기 wordbook
]
requires: [로그인, 관리자]
navigates: [홈]
externals: [Anthropic API(Claude Haiku), OpenAI TTS(음성 합성), Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js]
last_checked: 8753b0a
---

# 관리자 (public/admin.html)

## 1 기능
- 구역 5개(제목은 admin.html의 section-title): API 비용 추정(:215) · Speak Loop 음성(:226) · 단어 뜻 일괄 변환(:278) · 발음 캐시 지우기(:316) · 사용자 관리(:337).
- 사용자 관리: 사용자 목록·역할·차단·승인·기능 권한 변경. 비용 추정: 이벤트별 사용량 집계.
- Speak Loop 음성: 콘텐츠 클립의 음성을 OpenAI로 만들어 저장·미리듣기·목록 확인.
- 단어 뜻 일괄 변환: 저장된 영어 단어의 뜻을 AI로 새 구조로 바꾸고(샘플 → 적용), 백업으로 되돌린다.
- 발음 캐시 지우기: 서버 음성(사전·스펠링 런)의 단어 하나의 캐시만 지운다(작업440).

## 2 엔진
- [엔진] AI 단어 뜻 변환(Claude Haiku): `/api/admin/gloss/*`, lib/gloss_backfill.js:77 (GLOSS_MODEL claude-haiku-4-5, :10). 관리자 전용, 샘플 1회마다 호출 비용 발생.
- [엔진] 저장 음성(Speak Loop): 생성은 관리자만. `POST /api/admin/speakloop/audio/generate`가 OpenAI로 만든 mp3를 speakloop_audio에 저장(lib/speakloop_tts.js:159). 기본 모델 gpt-4o-mini-tts(:13). 미리듣기(preview)는 저장하지 않고 OpenAI를 부른다(routes/speakloop.js:132).
- 서버 음성(OpenAI TTS) 엔진 자체는 이 화면이 부르지 않는다. 이 화면은 그 캐시(tts_cache)를 지우기만 한다.

## 3 경로 (화면 →호출 API → 서버 라우트)
- [화면] 관리자 →호출 [API] GET /api/me — public/admin.html:410·:979 → routes/auth.js:101. →필요 로그인·관리자
- 사용자·통계 →호출 [API] GET /api/admin/users·/api/admin/stats — :590-591 loadData → routes/admin.js:9, :67. →읽기 [DB] users·api_usage
- 사용자 권한 변경 →호출 [API] PATCH /api/admin/users/:id — :559 → routes/admin.js:33 (UPDATE :56). →쓰기 [DB] users
- Speak Loop 음성 현황·목록 →호출 [API] GET /api/admin/speakloop/audio/status·list — :610, :698 → routes/speakloop.js:105, :118. →읽기 [DB] speakloop_audio
- 음성 생성 →호출 [API] POST /api/admin/speakloop/audio/generate — :637, :770 → routes/speakloop.js:165 → lib/speakloop_tts.js:148. →호출 [엔진] 저장 음성(Speak Loop) →쓰기 [DB] speakloop_audio·api_usage(:166)
- 음성 미리듣기 →호출 [API] POST /api/admin/speakloop/audio/preview — :747 → routes/speakloop.js:132. →쓰기 [DB] api_usage(:155)
- 콘텐츠·클립 재생 →호출 [API] GET /api/speakloop/content·/api/speakloop/audio/:clipKey — :685, :733 → routes/speakloop.js:34, :54. →읽기 [DB] speakloop_audio
- 단어 뜻 변환 →호출 [API] GET status·POST sample·POST run·POST restore·GET backup /api/admin/gloss/* — :798, :812, :869, :902, :917 → routes/gloss.js:15, :36, :45, :57, :70. →호출 [엔진] AI 단어 뜻 변환(Claude Haiku). →읽기·쓰기 [DB] wordbook, →쓰기 [DB] gloss_backup(lib/gloss_backfill.js:41 apply, :44 restore)·api_usage(:82)
- 발음 캐시 지우기 →호출 [API] DELETE /api/tts/cache/entry — :954 → routes/tts.js:27. →쓰기 [캐시] tts_cache(DELETE). 전체 삭제 DELETE /api/tts/cache(routes/tts.js:13)는 이 화면에서 부르지 않는다.

## 4 DB
- →읽기: [DB] users(사용자 목록), [DB] api_usage(비용 추정 집계, routes/admin.js:86·96), [DB] wordbook(변환 대상 현황), [DB] gloss_backup(백업·되돌리기), [DB] speakloop_audio(음성 현황·재생).
- →쓰기: [DB] users(권한), [DB] wordbook(뜻 변환 적용·되돌리기), [DB] gloss_backup(변환 전후 백업), [DB] speakloop_audio(음성 저장), [DB] api_usage(음성·뜻 변환 사용 기록), [캐시] tts_cache(단어 하나 삭제).
- 결과가 쌓이는 곳: 변환된 뜻은 wordbook(모든 사용자), 백업은 gloss_backup, 음성은 speakloop_audio.

## 5 연결
- [API] 위 3절(관리자 전용 라우트는 requireAdmin). [외부] Anthropic(뜻 변환 샘플·적용), OpenAI TTS(Speak Loop 음성 생성·미리듣기), Google Fonts.
- [기기] localStorage `mydict_token`(:374), `gl_last_run`(마지막 변환 실행 번호, 읽기 :933, 쓰기 :793).
- [모듈] public/js/common/authGate.js, appHeader.js(관리자일 때만 헤더에 '관리자' 링크, appHeader.js:110).
- 특이점: 발음 캐시 지우기는 tts_cache(서버 음성)만 지운다. Speak Loop 저장 음성(speakloop_audio)은 이 경로로 지워지지 않는다(별도 저장소).

=====================================================================
### 파일: docs/blueprint/screens/dictionary.md
=====================================================================

---
screen: 사전
file: public/english_dictionary.html
engines: [AI 사전·단어 질의(Claude Haiku), 서버 음성(OpenAI TTS), 기기 음성(speechSynthesis), 기기 글자 인식(Tesseract.js), 간격 반복 복습(SM-2)]
calls: [GET /api/me, POST /api/ai, GET /api/wordbook, POST /api/wordbook, DELETE /api/wordbook/:id, PATCH /api/wordbook/:id/example, PATCH /api/wordbook/:id/it, DELETE /api/wordbook/:id/it, POST /api/quiz-correct, GET /api/review-due, POST /api/review-result, POST /api/tts]
reads: [DB:users, DB:wordbook, DB:api_usage, 캐시:tts_cache, 기기:mydict_token, 기기:mydict_wrong, 기기:metis_tts_mode, 기기:spellrun_landing_count]
writes: [DB:wordbook, DB:review_log, DB:api_usage, 캐시:tts_cache, 기기:mydict_token, 기기:mydict_wrong, 기기:metis_tts_mode, 기기:spellrun_landing_count, 기기:spellrun_ids]
fallback: [서버 음성(OpenAI TTS) ⇢ 기기 음성(speechSynthesis)]
flows: [
  검색 | →필요 로그인 ; →호출 POST /api/ai ; →필요 권한:can_search ; →읽기 api_usage ; →호출 AI 사전·단어 질의(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage,
  단어장에 저장 | →필요 로그인 ; →호출 POST /api/wordbook ; →필요 권한:can_wordbook ; →쓰기 wordbook,
  단어 발음 버튼 | →필요 로그인 ; →호출 POST /api/tts ; →호출 서버 음성(OpenAI TTS) ; ⇢대체 기기 음성(speechSynthesis) ; →필요 권한:can_tts ; →읽기 tts_cache ; →읽기 api_usage ; →호출 OpenAI TTS(음성 합성) ; →쓰기 tts_cache ; →쓰기 api_usage,
  팟캐스트 듣기 | →필요 로그인 ; →호출 POST /api/tts ; →호출 서버 음성(OpenAI TTS),
  복습 하기 | →호출 GET /api/review-due ; →읽기 wordbook ; →호출 POST /api/review-result ; →호출 간격 반복 복습(SM-2) ; →쓰기 wordbook ; →쓰기 review_log,
  스펠링 런 시작 | →쓰기 기기:spellrun_ids ; →이동 스펠링 런
]
requires: [로그인, 권한:can_search, 권한:can_wordbook, 권한:can_tts]
navigates: [스펠링 런, 홈]
externals: [Anthropic API(Claude Haiku), OpenAI TTS(음성 합성), Google Fonts, jsDelivr(tesseract.js)]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js, public/js/ocr/ocrScanner.js]
last_checked: 8753b0a
---

# 사전 (public/english_dictionary.html)

## 1 기능
- 검색(영·한·일·중 4개 언어 결과 화면) · 단어장 저장·삭제·목록 · 발음 버튼 · 팟캐스트(단어장 연속 듣기) · 퀴즈·복습 · IT 용어 설명 저장 · 카메라 글자 인식 · 선택 단어로 스펠링 런 시작.

## 2 엔진
- [엔진] AI 사전·단어 질의(Claude Haiku): 검색 결과·IT 설명·퀴즈 주관식 채점·예문 생성을 모두 `POST /api/ai`(프롬프트 문자열) 하나로 보낸다. 모델 claude-haiku-4-5 (routes/dictionary.js:51).
- [엔진] 서버 음성(OpenAI TTS): 단어 발음 버튼·미리 받기·팟캐스트(문장 포함)가 `POST /api/tts`. 모델 tts-1-hd (routes/tts.js:125). 단어 발음은 `?tts=device`(저장)일 때 쓰지 않는다.
- [엔진] 기기 음성(speechSynthesis): 서버 음성을 못 쓸 때(토큰 없음·401·403·429·오류·빈 음성)의 대체, 또는 `?tts=device` 선택 시 단독 (public/english_dictionary.html:4331).
- [엔진] 기기 글자 인식(Tesseract.js): 브라우저 안에서만 동작, 서버 호출 없음 (public/js/ocr/liveEnglishOcrSession.js:14, 카메라 public/js/ocr/ocrScanner.js:155).
- [엔진] 간격 반복 복습(SM-2): 서버가 점수로 다음 복습일 계산 (routes/wordbook.js:124).

## 3 경로 (화면 →호출 API → 서버 라우트)
- [화면] 사전 →호출 [API] GET /api/me — english_dictionary.html:1822 → routes/auth.js:101. →읽기 [DB] users
- 검색 →호출 [API] POST /api/ai — :2098 doSearch → :1917 callAI → routes/dictionary.js:26. →읽기 [DB] api_usage(하루 한도), →쓰기 [DB] api_usage. →필요 권한:can_search
- 단어장 불러오기 →호출 [API] GET /api/wordbook — :1863 → routes/wordbook.js:14. →읽기 [DB] wordbook
- 저장 →호출 [API] POST /api/wordbook — :1875 → routes/wordbook.js:29. →쓰기 [DB] wordbook
- 삭제 →호출 [API] DELETE /api/wordbook/:id — :1887 → routes/wordbook.js:51. →쓰기 [DB] wordbook
- 예문 저장 →호출 [API] PATCH /api/wordbook/:id/example — :4208 → routes/wordbook.js:67. →쓰기 [DB] wordbook
- IT 설명 저장·삭제 →호출 [API] PATCH·DELETE /api/wordbook/:id/it — :3083 / :3550 → routes/wordbook.js:85 / :107. →쓰기 [DB] wordbook
- 퀴즈 정답 기록 →호출 [API] POST /api/quiz-correct — :3819 → routes/wordbook.js:186. →쓰기 [DB] wordbook
- 복습 대상 →호출 [API] GET /api/review-due — :3898 → routes/wordbook.js:201. →읽기 [DB] wordbook
- 복습 결과 →호출 [API] POST /api/review-result — :4163 → routes/wordbook.js:151. →쓰기 [DB] wordbook·review_log(routes/wordbook.js:176)
- 발음 버튼 →호출 [API] POST /api/tts — :4373 playTTS → :4347 fetchTtsAudio (fetch :4352) → routes/tts.js:72. →읽기 [캐시] tts_cache, 캐시 미스일 때 →쓰기 [캐시] tts_cache(routes/tts.js:143)·[DB] api_usage(:150). ⇢대체 [엔진] 기기 음성(speechSynthesis)
- 미리 받기 →호출 [API] POST /api/tts — :4465 prefetchTTS (fetch :4470) → routes/tts.js:72
- 팟캐스트 →호출 [API] POST /api/tts — :4607 → routes/tts.js:72 (문장·예문 포함, 항상 서버 음성)
- 스펠링 런 시작 →이동 [화면] 스펠링 런 — :3320 startSpellRunSelected, →쓰기 [기기] spellrun_ids(sessionStorage, :3326)

## 4 DB
- →읽기: [DB] users(`/api/me`·권한 can_search·can_wordbook·can_tts), [DB] wordbook(단어장·복습 대상), [DB] api_usage(하루 한도 계산: ai·tts), [캐시] tts_cache(발음 캐시 적중).
- →쓰기: [DB] wordbook(저장·삭제·예문·IT 설명·복습값), [DB] review_log(복습 점수), [DB] api_usage(ai·tts 사용 기록, tts는 캐시 미스만, routes/tts.js:150), [캐시] tts_cache(발음 미스 저장).
- 결과가 쌓이는 곳: 단어장은 wordbook(사용자별). 검색 결과 자체는 단어장에 저장할 때만 wordbook.data 열에 들어간다. [미확인] 검색 결과의 서버 쪽 별도 캐시는 routes/dictionary.js에서 보이지 않음(없는 것으로 보이나 전체 확인은 안 함).

## 5 연결
- [API] 위 3절. [외부] Anthropic(/api/ai), OpenAI TTS(/api/tts 캐시 미스일 때만), Google Fonts(:23), jsDelivr tesseract.js 5.1.1(:4812).
- [기기] localStorage `mydict_token`(로그인; 쓰기는 주소 ?token= 처리 :1765), `mydict_wrong`(퀴즈 오답, :1942), `metis_tts_mode`(단어 발음 방식, 스펠링 런과 공용; :4271), `spellrun_landing_count`(스펠링 런 한 번에 풀 단어 수 10|20, :3334; 사전 쪽 키 이름이지만 이름에 spellrun이 들어 있다), sessionStorage `spellrun_ids`(스펠링 런에 넘기는 단어 id). 주소 옵션 `?tts=server|device|reset`.
- [모듈] public/js/common/authGate.js(진입 시 /api/me 1회 확인·401이면 홈), appHeader.js(헤더·로그인 위젯), dialog.js, public/js/ocr/ocrScanner.js(카메라 글자 인식 패널).

=====================================================================
### 파일: docs/blueprint/screens/jgrammar.md
=====================================================================

---
screen: 문장 학습
file: public/jgrammar.html
engines: [AI 문장 해설(Claude Haiku), AI 사진 문장 인식(Claude Haiku), 기기 음성(speechSynthesis)]
calls: [GET /api/me, POST /api/jgrammar/explain, POST /api/jgrammar/ocr, GET /api/jgrammar/saved, DELETE /api/jgrammar/saved/:id]
reads: [DB:users, 캐시:jgrammar_cache, DB:jgrammar_saved, DB:api_usage, 기기:mydict_token, 기기:jgrammar_lang, 기기:jgrammar_furigana, 기기:jgrammar_pinyin, 기기:jgrammar_zh]
writes: [캐시:jgrammar_cache, DB:jgrammar_saved, DB:api_usage, 기기:jgrammar_lang, 기기:jgrammar_furigana, 기기:jgrammar_pinyin, 기기:jgrammar_zh]
fallback: []
flows: [
  문장 분석 | →필요 로그인 ; →호출 POST /api/jgrammar/explain ; →필요 권한:perm_jgrammar ; →읽기 jgrammar_cache ; →읽기 api_usage ; →호출 AI 문장 해설(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage ; →쓰기 jgrammar_cache ; →쓰기 jgrammar_saved,
  사진에서 문장 인식 | →필요 로그인 ; →호출 POST /api/jgrammar/ocr ; →필요 권한:perm_jgrammar ; →읽기 api_usage ; →호출 AI 사진 문장 인식(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage,
  저장 목록 보기 | →호출 GET /api/jgrammar/saved ; →필요 권한:perm_jgrammar ; →읽기 jgrammar_saved,
  저장 문장 삭제 | →호출 DELETE /api/jgrammar/saved/:id ; →필요 권한:perm_jgrammar ; →쓰기 jgrammar_saved,
  읽어주기(듣기·천천히) | →호출 기기 음성(speechSynthesis),
  언어 바꾸기 | →쓰기 기기:jgrammar_lang
]
requires: [로그인, 권한:perm_jgrammar]
navigates: [홈]
externals: [Anthropic API(Claude Haiku), Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 8753b0a
---

# 문장 학습 (public/jgrammar.html) — 파일명은 jgrammar(일본어 문법), 화면 제목은 "문장 학습"

## 1 기능
- 일본어·영어·중국어(간체·번체) 문장을 넣으면 문법 해설·번역·후리가나(병음) 제공 · 사진에서 문장 인식 · 저장한 문장 목록(언어별 최대 100개) · 읽어주기(듣기·천천히).

## 2 엔진
- [엔진] AI 문장 해설(Claude Haiku): `POST /api/jgrammar/explain`, lib/jgrammar.js:393 (MODEL claude-haiku-4-5, :12). 같은 문장은 [캐시] jgrammar_cache에서 꺼내 AI를 다시 부르지 않는다(:324).
- [엔진] AI 사진 문장 인식(Claude Haiku): `POST /api/jgrammar/ocr`(이미지 바이너리), lib/jgrammar.js:559. 하루 한도는 해설과 합산(:14).
- [엔진] 기기 음성(speechSynthesis): 읽어주기는 이 엔진만 쓰고 서버로 텍스트를 보내지 않는다(public/jgrammar.html:319 주석, 시험 jgrammar_speech가 확인). 서버 음성은 쓰지 않는다. 대체 경로 없음(`fallback: []`).

## 3 경로 (화면 →호출 API → 서버 라우트)
- [화면] 문장 학습 →호출 [API] GET /api/me — public/jgrammar.html:187 → routes/auth.js:101. →필요 로그인
- 분석 →호출 [API] POST /api/jgrammar/explain — :591 → routes/jgrammar.js:64 → lib/jgrammar.js. →필요 권한:perm_jgrammar. →읽기 [캐시] jgrammar_cache, 미스일 때 →호출 [엔진] AI 문장 해설 →쓰기 [캐시] jgrammar_cache·[DB] jgrammar_saved·[DB] api_usage
- 사진 인식 →호출 [API] POST /api/jgrammar/ocr?lang= — :294 → routes/jgrammar.js:54 → lib/jgrammar.js:559
- 저장 목록 →호출 [API] GET /api/jgrammar/saved?lang= — :242 → routes/jgrammar.js:76. →읽기 [DB] jgrammar_saved
- 저장 삭제 →호출 [API] DELETE /api/jgrammar/saved/:id — :227 → routes/jgrammar.js:85. →쓰기 [DB] jgrammar_saved
- 읽어주기: 요청 없음, →호출 [엔진] 기기 음성(speechSynthesis) — :426 startSpeech

## 4 DB
- →읽기: [DB] users(권한 perm_jgrammar, routes/jgrammar.js:15), [캐시] jgrammar_cache(같은 문장 결과), [DB] jgrammar_saved(저장 목록), [DB] api_usage(하루 한도, lib/jgrammar.js:315).
- →쓰기: [캐시] jgrammar_cache(새 결과 저장, lib/jgrammar.js:348), [DB] jgrammar_saved(사용자별 저장 :358, 100개 초과분 삭제 :365), [DB] api_usage(해설 'jgrammar'·사진 'jgrammar_ocr' 기록, :401·:570).
- 결과가 쌓이는 곳: 문장 결과는 jgrammar_cache(전 사용자 공용 캐시)와 jgrammar_saved(사용자별).

## 5 연결
- [API] 위 3절. [외부] Anthropic(캐시 미스·사진 인식일 때만), Google Fonts.
- →필요: users.perm_jgrammar 가 true인 계정 또는 관리자(routes/jgrammar.js:11-25). 하루 한도 환경변수 JGRAMMAR_DAILY_CAP(lib/jgrammar.js:309).
- [기기] localStorage `mydict_token`, `jgrammar_lang`(언어, :166), `jgrammar_furigana`·`jgrammar_pinyin`(후리가나·병음 표시, :316), `jgrammar_zh`(마지막 간체/번체, :169). 예전 `jgrammar_structure`는 작업318에서 쓰지 않게 됨(:316 주석). 읽어주기 속도는 코드 상수 SPEAK_RATE(:396)이고 저장값은 없다.
- [모듈] public/js/common/authGate.js, appHeader.js, dialog.js.

=====================================================================
### 파일: docs/blueprint/screens/speak_loop.md
=====================================================================

---
screen: Speak Loop
file: public/speakloop.html
engines: [저장 음성(Speak Loop)]
calls: [GET /api/me, GET /api/speakloop/content, GET /api/speakloop/audio-index, GET /api/speakloop/audio/:clipKey, GET /api/speakloop/progress, POST /api/speakloop/progress]
reads: [DB:users, DB:speakloop_audio, DB:speakloop_progress, 기기:mydict_token]
writes: [DB:speakloop_progress]
fallback: []
flows: [
  화면 열기 | →읽기 기기:mydict_token ; →필요 로그인 ; →호출 GET /api/me ; →읽기 users ; →필요 권한:perm_speakloop ; →호출 GET /api/speakloop/content ; →호출 GET /api/speakloop/audio-index ; →읽기 speakloop_audio ; →호출 GET /api/speakloop/progress ; →읽기 speakloop_progress,
  음성 듣기 | →필요 권한:perm_speakloop ; →호출 GET /api/speakloop/audio/:clipKey ; →호출 저장 음성(Speak Loop) ; →읽기 speakloop_audio,
  평가 기록(독백·이디엄) | →필요 권한:perm_speakloop ; →호출 POST /api/speakloop/progress ; →쓰기 speakloop_progress
]
requires: [로그인, 권한:perm_speakloop]
navigates: [홈]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js]
last_checked: 8753b0a
---

# Speak Loop (public/speakloop.html) — 영어 말하기 연습(독백 + 이디엄)

## 1 기능
- 독백 연습(목록·상세, 모드 4개: 듣고 이해·문장 훈련·외우기·통째로 말하기; public/js/speakloop/app.js:6) · 이디엄 세션(받아쓰기→소리·뉘앙스→예문 쉐도잉, 복습·신규·인출, 표현 목록; public/js/speakloop/idiom.js) · 진행 기록(항목별 횟수·마지막 평가) · 내 소리 녹음(원음과 번갈아 듣기).
- 이디엄은 별도 화면이 아니라 이 화면 안의 기능이다.

## 2 엔진
- [엔진] 저장 음성(Speak Loop): 관리자가 만들어 speakloop_audio에 저장해 둔 음성만 재생한다. 사용자 경로는 OpenAI를 부르지 않는다(routes/speakloop.js:2 주석). 재생기 public/js/speakloop/player.js: audio-index에 없는 키는 재생하지 않고 브라우저 음성 합성으로 대체하지 않는다(player.js:1 주석) — 그래서 기기 음성은 이 화면에서 쓰지 않는다(speechSynthesis 호출 0건, grep 확인). 대체 경로 없음(`fallback: []`).
- 녹음(rec.js:1)은 이 기기 메모리(Blob URL)에만 있고 서버로 보내지 않는다. 마이크는 브라우저 기능이며 엔진으로 치지 않는다.

## 3 경로 (화면 →호출 API → 서버 라우트)
- [화면] Speak Loop →호출 [API] GET /api/me — public/js/speakloop/app.js:368 boot → routes/auth.js:101. →필요 로그인·권한:perm_speakloop(me.perm_speakloop 또는 관리자, app.js:371)
- 콘텐츠 →호출 [API] GET /api/speakloop/content — app.js:374 → routes/speakloop.js:34. 콘텐츠는 서버 파일 data/speakloop/content.json(lib/speakloop_content.js:8). DB 아님.
- 음성 목록 →호출 [API] GET /api/speakloop/audio-index — public/js/speakloop/player.js:19 → routes/speakloop.js:38. →읽기 [DB] speakloop_audio(clip_key·content_hash만)
- 음성 재생 →호출 [API] GET /api/speakloop/audio/:clipKey — player.js:49 → routes/speakloop.js:54. →읽기 [DB] speakloop_audio. 클립은 Blob URL로 메모리 보관(동시 4개)
- 진행 읽기 →호출 [API] GET /api/speakloop/progress — app.js:376 → routes/speakloop.js:75. →읽기 [DB] speakloop_progress
- 진행 기록 →호출 [API] POST /api/speakloop/progress — app.js:305, idiom.js:39 → routes/speakloop.js:85 (INSERT ... ON CONFLICT :94). →쓰기 [DB] speakloop_progress

## 4 DB
- →읽기: [DB] users(권한 perm_speakloop, routes/speakloop.js:18), [DB] speakloop_audio(음성 목록·재생), [DB] speakloop_progress(진행).
- →쓰기: [DB] speakloop_progress(사용자별 항목 횟수·마지막 평가). 이 화면은 speakloop_audio에 쓰지 않는다(쓰기는 관리자 화면, screens/admin.md 참고).
- 결과가 쌓이는 곳: 진행은 speakloop_progress. 내 소리 녹음은 저장되지 않는다.

## 5 연결
- [API] 위 3절(전부 requireAuth + requireSpeakloopPerm, routes/speakloop.js:28). [외부] Google Fonts(speakloop.html:9-11).
- [기기] localStorage `mydict_token`(app.js:10). 그 밖의 저장값 없음(speakloop 화면 파일에서 localStorage·sessionStorage 사용은 이 1건만 확인).
- [모듈] public/js/common/authGate.js, appHeader.js. 화면 전용 스크립트: public/js/speakloop/{core,player,rec,app,idiom}.js.
- [미확인] 독백 연습 4개 모드 각각의 서버 호출 차이(app.js 전체는 읽지 않음, 호출은 위 6개 API만 grep으로 확인).

=====================================================================
### 파일: docs/blueprint/screens/spelling_run.md
=====================================================================

---
screen: 스펠링 런
file: public/spelling_run.html
engines: [스펠링 런 게임 엔진(캔버스), 서버 음성(OpenAI TTS), 기기 음성(speechSynthesis), 2인 대결 방(서버 메모리)]
calls: [GET /api/me, GET /api/wordbook, POST /api/tts, POST /api/versus/rooms, GET /api/versus/rooms, GET /api/versus/rooms/:id, POST /api/versus/rooms/:id/join, POST /api/versus/rooms/:id/start, POST /api/versus/rooms/:id/state, POST /api/versus/rooms/:id/finish, POST /api/versus/rooms/:id/rematch, POST /api/versus/rooms/:id/leave]
reads: [DB:users, DB:wordbook, DB:api_usage, 캐시:tts_cache, 기기:mydict_token, 기기:spellrun_opts, 기기:spellrun_mode, 기기:spellrun_preview, 기기:spellrun_view, 기기:spellrun_bgm, 기기:spellrun_char, 기기:spellrun_best, 기기:metis_tts_mode, 기기:spellrun_ids]
writes: [DB:api_usage, 캐시:tts_cache, 기기:spellrun_opts, 기기:spellrun_mode, 기기:spellrun_preview, 기기:spellrun_view, 기기:spellrun_bgm, 기기:spellrun_char, 기기:spellrun_best, 기기:metis_tts_mode]
fallback: [서버 음성(OpenAI TTS) ⇢ 기기 음성(speechSynthesis)]
flows: [
  화면 열기(단어 불러오기) | →필요 로그인 ; →호출 GET /api/me ; →읽기 users ; →필요 권한:can_wordbook ; →읽기 기기:spellrun_ids ; →호출 GET /api/wordbook ; →읽기 wordbook,
  시작 버튼(발음 미리 받기) | →호출 POST /api/tts ; →호출 서버 음성(OpenAI TTS) ; →읽기 tts_cache,
  단어 발음(게임·미리 보기·결과 칩) | →호출 POST /api/tts ; →호출 서버 음성(OpenAI TTS) ; ⇢대체 기기 음성(speechSynthesis) ; →읽기 tts_cache ; →읽기 api_usage ; →호출 OpenAI TTS(음성 합성) ; →쓰기 tts_cache ; →쓰기 api_usage,
  대결 방 만들기 | →필요 권한:perm_versus ; →호출 POST /api/versus/rooms ; →호출 2인 대결 방(서버 메모리),
  대결 방 참가 | →필요 권한:perm_versus ; →호출 POST /api/versus/rooms/:id/join ; →호출 2인 대결 방(서버 메모리),
  게임 끝(최고 점수 기록) | →쓰기 기기:spellrun_best
]
requires: [로그인, 권한:can_wordbook, 권한:perm_versus]
navigates: [사전, 홈]
externals: [OpenAI TTS(음성 합성), Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 8753b0a
---

# 스펠링 런 (public/spelling_run.html) — 내부 게임 로직은 쓰지 않고 공용 엔진·API·DB 연결만

## 1 기능
- 사전 단어장에서 고른 영어 단어로 하는 철자 게임(혼자 · 2인 대결) · 시작 전 단어 미리 보기 · 단어 발음 · 결과 화면.

## 2 엔진
- [엔진] 스펠링 런 게임 엔진(캔버스): public/js/spellrun/logic.js(순수 로직) + game.js(그리기·입력·소리). 이 화면 전용, 서버 호출 없음.
- [엔진] 서버 음성(OpenAI TTS): 게임·미리 보기·결과 칩의 단어 발음. `POST /api/tts`(lang en). 판 시작 때 단어를 미리 받는다(game.js:567 prefetchRound).
- [엔진] 기기 음성(speechSynthesis): 서버 음성 실패·`?tts=device`(저장) 때의 대체/단독 (game.js:412 speakBuiltin).
- [엔진] 2인 대결 방(서버 메모리): 방은 서버 메모리에만 있고 DB에 저장하지 않는다(routes/versus.js, lib/versus.js). perm_versus 권한 필요.

## 3 경로 (화면 →호출 API → 서버 라우트)
- [화면] 스펠링 런 →호출 [API] GET /api/me — public/js/spellrun/game.js:2876 boot (fetch :2881) → routes/auth.js:101. →읽기 [DB] users. →필요 로그인
- 선택 단어 읽기 →호출 [API] GET /api/wordbook — :2893 (id 목록은 :2096 readIds ← →읽기 [기기] spellrun_ids) → routes/wordbook.js:14. →읽기 [DB] wordbook. →필요 권한:can_wordbook
- 단어 출제: 요청 없음. 받은 행에서 영어 단어만 고른다 — :2080 pickWords
- 단어 발음 →호출 [API] POST /api/tts — :537 pronounce → :492 getServerAudio (fetch :498) → routes/tts.js:72. ⇢대체 [엔진] 기기 음성(speechSynthesis)
- 발음 미리 받기 →호출 [API] POST /api/tts — :567 prefetchRound → routes/tts.js:72
- 대결 →호출 [API] /api/versus/rooms… — :2315 vsApi (fetch :2317) → routes/versus.js:52 (rooms 만들기)~:93 (leave). →필요 권한:perm_versus
- 이동: 사전의 단어장 링크 →이동 [화면] 사전(game.js showGate 의 '단어장으로')

## 4 DB
- →읽기: [DB] users(/api/me·권한 can_wordbook·perm_versus), [DB] wordbook(선택 단어), [캐시] tts_cache(발음 캐시 적중), [DB] api_usage(발음 한도).
- →쓰기: 이 화면은 [DB] wordbook에 쓰지 않는다(game.js에 wordbook 쓰기 요청 없음, 확인함). 발음 미스일 때만 서버가 [캐시] tts_cache·[DB] api_usage에 기록(routes/tts.js:143,150). 점수는 서버가 아니라 이 기기에 쌓인다(→쓰기 [기기] spellrun_best, game.js:240). 대결 방 상태는 서버 메모리(DB 아님).

## 5 연결
- [API] 위 3절. [외부] OpenAI TTS(/api/tts 캐시 미스일 때만), Google Fonts.
- [기기] localStorage `mydict_token`, `spellrun_opts`(조정값, public/js/spellrun/logic.js:205), `spellrun_mode`(기본/생존), `spellrun_preview`(미리 보기), `spellrun_view`(세로/가로), `spellrun_bgm`, `spellrun_char`(캐릭터), `spellrun_best`(최고 점수), `metis_tts_mode`(단어 발음 방식, 사전과 공용; game.js `?tts=` 처리), sessionStorage `spellrun_ids`(사전이 넘긴 단어 id, 읽기만). 점검 주소 옵션 ttsdebug·judgedebug(logic.js:174).
- 진입: 사전의 단어장에서 단어를 고르면 /spelling_run.html로 이동(public/english_dictionary.html:3320).
- [모듈] public/js/common/authGate.js, appHeader.js, dialog.js.

=====================================================================
### 파일: docs/blueprint/screens/voice_study.md
=====================================================================

---
screen: 음성 학습
file: public/voice_study.html
engines: [음성 인식(OpenAI STT), AI 음성 노트 처리(Claude Haiku), 이미지 생성(OpenAI Images), 기기 음성(speechSynthesis)]
calls: [GET /api/me, GET /api/voice-notes, POST /api/voice-notes, GET /api/voice-notes/:id, PATCH /api/voice-notes/:id, DELETE /api/voice-notes/:id, POST /api/voice-notes/merge, POST /api/voice-notes/transcribe, POST /api/voice-notes/summarize, GET /api/voice-notes/wrong-answers, GET /api/voice-notes/quiz-summary, GET /api/voice-notes/:id/quiz, POST /api/voice-notes/:id/quiz, GET /api/voice-notes/:id/quiz/attempts, POST /api/voice-notes/:id/quiz/attempts, POST /api/voice-notes/:id/chat, GET /api/voice-notes/:id/links, POST /api/voice-notes/:id/links/refresh, GET /api/voice-notes/:id/image, POST /api/voice-notes/:id/image, GET /api/voice-notes/:id/image/file, PATCH /api/voice-notes/:id/image/rating, GET /api/voice-notes/map, POST /api/voice-notes/links, PATCH /api/voice-notes/links/:id, DELETE /api/voice-notes/links/:id, POST /api/voice-notes/map/build, GET /api/voice-notes/map/build-status]
reads: [DB:users, DB:api_usage, DB:voice_notes, DB:voice_quizzes, DB:voice_quiz_attempts, DB:voice_links, DB:voice_image_sets, DB:voice_images, 기기:mydict_token, 기기:voice_tts_rate]
writes: [DB:voice_notes, DB:voice_quizzes, DB:voice_quiz_attempts, DB:voice_links, DB:voice_image_sets, DB:voice_images, DB:api_usage, 기기:voice_tts_rate]
fallback: []
flows: [
  녹음 → 글자 변환 | →필요 로그인 ; →호출 POST /api/voice-notes/transcribe ; →필요 권한:perm_voice_study ; →읽기 api_usage ; →호출 음성 인식(OpenAI STT) ; →호출 OpenAI STT(음성 인식) ; →쓰기 api_usage,
  요약 만들기 | →호출 POST /api/voice-notes/summarize ; →필요 권한:perm_voice_study ; →읽기 api_usage ; →호출 AI 음성 노트 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage,
  노트 저장 | →호출 POST /api/voice-notes ; →필요 권한:perm_voice_study ; →쓰기 voice_notes,
  퀴즈 만들기 | →호출 POST /api/voice-notes/:id/quiz ; →필요 권한:perm_voice_study ; →읽기 voice_notes ; →읽기 api_usage ; →호출 AI 음성 노트 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage ; →쓰기 voice_quizzes,
  이미지 만들기 | →호출 POST /api/voice-notes/:id/image ; →필요 권한:perm_voice_study ; →쓰기 voice_image_sets ; →읽기 voice_notes ; →읽기 api_usage ; →호출 AI 음성 노트 처리(Claude Haiku) ; →쓰기 voice_images ; →호출 이미지 생성(OpenAI Images) ; →호출 OpenAI Images(이미지 생성) ; →쓰기 api_usage,
  요약 읽어주기 | →호출 기기 음성(speechSynthesis) ; →쓰기 기기:voice_tts_rate
]
requires: [로그인, 권한:perm_voice_study]
navigates: [홈]
externals: [Anthropic API(Claude Haiku), OpenAI STT(음성 인식), OpenAI Images(이미지 생성), Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 8753b0a
---

# 음성 학습 (public/voice_study.html)

## 1 기능
- 음성 노트: 녹음 → 글자 변환 → 요약 만들기 → 저장·수정·삭제·합치기 · 요약 퀴즈(생성·풀이·기록·오답) · 노트와 대화(chat) · 개념 연결(links)과 연결 지도(map, 자동 연결 만들기) · 노트 요약 이미지(생성·평가) · 요약 읽어주기.

## 2 엔진
- [엔진] 음성 인식(OpenAI STT): `POST /api/voice-notes/transcribe`(녹음 파일을 서버가 OpenAI에 보냄). 모델 기본 gpt-4o-mini-transcribe(routes/voice_study.js:671). 하루 20회 제한(:611). 녹음은 브라우저 MediaRecorder(public/voice_study.html:1417, 1435)로 만든다.
- [엔진] AI 음성 노트 처리(Claude Haiku): 요약(:806)·퀴즈(:978)·대화(:1118)·연결(:1313)·이미지 계획 보조(:1717, :1770)가 같은 모델 SUMMARY_MODEL claude-haiku-4-5 (:705).
- [엔진] 이미지 생성(OpenAI Images): `POST /api/voice-notes/:id/image` → OpenAI images/generations (routes/voice_study.js:1666). 모델 기본값은 환경변수 VOICE_IMAGE_MODEL(:1492).
- [엔진] 기기 음성(speechSynthesis): 요약 읽어주기는 이 엔진만 쓴다(public/voice_study.html:2052 주석: 외부 API·비용 없음). 한국어 음성 선택(koVoiceInfo). 서버 음성(OpenAI TTS)은 쓰지 않는다. 대체 경로 없음.

## 3 경로 (화면 →호출 API → 서버 라우트, 주요 동작)
- [화면] 음성 학습 →호출 [API] GET /api/me — voice_study.html:786 → routes/auth.js:101. →필요 로그인·권한:perm_voice_study(routes/voice_study.js:20, 모든 voice-notes 라우트는 guard :31)
- 노트 목록·보기·저장·수정·삭제 →호출 [API] GET·POST·PATCH·DELETE /api/voice-notes… — :1028, :2750-2764 → routes/voice_study.js:117, :467, :492, :591. →읽기·쓰기 [DB] voice_notes
- 합치기 →호출 [API] POST /api/voice-notes/merge — :1337 → routes/voice_study.js:541. →쓰기 [DB] voice_notes(:577)
- 녹음 변환 →호출 [API] POST /api/voice-notes/transcribe — :1560 → routes/voice_study.js:652. →읽기 [DB] api_usage(하루 20회, routes/voice_study.js:659), →호출 [엔진] 음성 인식(OpenAI STT) →쓰기 [DB] api_usage(:693 'stt')
- 요약 →호출 [API] POST /api/voice-notes/summarize — :1714 → routes/voice_study.js:777. →읽기 [DB] api_usage(하루 30회, routes/voice_study.js:791), →호출 [엔진] AI 음성 노트 처리 →쓰기 [DB] api_usage(:818)
- 퀴즈 →호출 [API] GET·POST /api/voice-notes/:id/quiz — :2245, :2287 → routes/voice_study.js:927, :946. →읽기 [DB] voice_notes(원문, loadOwnTranscript :952)·api_usage(하루 10회, :963), →쓰기 [DB] voice_quizzes(:1009)
- 퀴즈 기록 →호출 [API] POST·GET /api/voice-notes/:id/quiz/attempts — :2396, :2412 → routes/voice_study.js:2083, :2125. →쓰기 [DB] voice_quiz_attempts(:2109)
- 오답·요약 →호출 [API] GET /api/voice-notes/wrong-answers·quiz-summary — :1121, :1224 → routes/voice_study.js:138, :153. →읽기 [DB] voice_quiz_attempts
- 대화 →호출 [API] POST /api/voice-notes/:id/chat — :2522 → routes/voice_study.js:1085. →호출 [엔진] AI 음성 노트 처리
- 개념 연결 →호출 [API] GET /api/voice-notes/:id/links·POST …/links/refresh — :1764, :1851 → routes/voice_study.js:1389, :1446. →읽기·쓰기 [DB] voice_links, voice_notes(keywords :1352)
- 연결 지도 →호출 [API] GET /api/voice-notes/map·POST·PATCH·DELETE /api/voice-notes/links·POST map/build·GET map/build-status — :2910, :3213-3241, :3266-3310 → routes/voice_study.js:200, :238, :282, :315, :374, :440. →쓰기 [DB] voice_links·api_usage(:426)
- 이미지 →호출 [API] GET·POST /api/voice-notes/:id/image, GET …/image/file, PATCH …/image/rating — :1899, :2026, :1991, :2043 → routes/voice_study.js:1929, :1879, :1977, :2005. →호출 [엔진] 이미지 생성(OpenAI Images) →쓰기 [DB] voice_image_sets(:1910)·voice_images(:1823)·api_usage(:1702)
- 요약 읽어주기: 요청 없음, →호출 [엔진] 기기 음성(speechSynthesis) — :2052-2219

## 4 DB
- →읽기: [DB] users(권한), [DB] api_usage(하루 한도: 연결 만들기 :390, 변환 20회 :611, 집계 함수 countToday :622), [DB] voice_notes, voice_quizzes, voice_quiz_attempts, voice_links, voice_image_sets, voice_images.
- →쓰기: 같은 voice_* 6개 테이블 + [DB] api_usage(stt·summary·quiz·chat·link·image 이벤트).
- 결과가 쌓이는 곳: 노트·요약은 voice_notes, 퀴즈는 voice_quizzes·voice_quiz_attempts, 연결은 voice_links, 이미지는 voice_image_sets·voice_images. DB 없으면 503(requireDB, routes/voice_study.js:26).
- 특이점: 테이블 voice_concepts는 lib/db.js에 있으나 routes/voice_study.js에서 사용하지 않는다(grep 0건). [미확인] 다른 코드에서의 사용.

## 5 연결
- [API] 위 3절. [외부] Anthropic(요약·퀴즈·대화·연결), OpenAI STT(녹음 변환), OpenAI Images(이미지 생성), Google Fonts.
- [기기] localStorage `mydict_token`(:772, :783), `voice_tts_rate`(읽어주기 속도, 읽기 :2223 쓰기 :2212).
- [모듈] public/js/common/authGate.js, appHeader.js, dialog.js.
- [미확인] chat·연결·이미지의 하루 한도 값(STT 20 :611, 요약 30 :704, 퀴즈 10 :849 는 확인함), 이미지 모델 실제 기본값 동작.
