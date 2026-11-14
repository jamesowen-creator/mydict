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
