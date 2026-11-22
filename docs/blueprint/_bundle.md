# METIS-3 도면 묶음 (_bundle.md)

이 파일은 `npm run blueprint:gen` 이 만든다(직접 고치지 않는다). 용도: 이 한 파일을 웹 Claude 에 첨부해 프로젝트 문서로 복사한다.
순서: README → LEGEND → db → api → screens(파일 이름 순). 기준 커밋(화면 파일의 last_checked): 23d581c, 49287a8, 8753b0a, 9319dc0
화면 파일 12개.

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
- 저장소(DB 테이블·서버 캐시)는 [db.md](db.md) 한 장에 모았다(표기는 LEGEND 7절, 읽는·쓰는 화면은 gen 이 만든다).
- 서버 API(라우트)는 [api.md](api.md) 한 장에 모았다(한 줄 = 라우트 하나: 인증·읽기·쓰기·엔진·외부·파일·호출 화면, 표기는 LEGEND 10절). 코드에 라우트가 늘었는데 api.md 에 없으면 gen 이 멈춘다. 줄 단위 근거는 [_draft/api-catalog-draft.md](_draft/api-catalog-draft.md).
- 화면마다 `screens/<이름>.md` 한 장. 맨 위 머리말(`---` 사이)은 기계가 읽는 목록이고, 본문은 5개 절(1 기능 / 2 엔진 / 3 경로 / 4 DB / 5 연결)이다. 경로는 `파일:줄`.
- 아래 "생성 구간"은 머리말에서 `npm run blueprint:gen`이 만든다(손으로 고치지 않는다). 시각 도면은 [map.html](map.html)을 브라우저로 직접 연다(항목을 누르면 연결된 항목이 강조되고 관계 종류별로 나열된다).
- 화면 파일 머리말의 `flows`는 "동작별 흐름"(사용자가 누르는 동작 하나마다 → 호출·읽기·쓰기 순서)이다. map.html에서 화면을 누르고 동작 카드를 누르면 왼쪽 목록에 ①②③ 번호가 붙는다. 문법은 LEGEND 2절.
- 웹 Claude 등 저장소를 못 읽는 곳에 줄 때는 생성된 [_bundle.md](_bundle.md) 한 파일을 쓴다(README → LEGEND → db → api → screens).
- 각 화면 파일의 `last_checked`(마지막 확인 커밋)보다 코드가 많이 바뀌었으면 낡았을 수 있다.

## 화면 목록 (public/ 아래 사용자 접근 화면 12개)
| 화면 | 파일 | 한 줄 설명 | 도면 |
|---|---|---|---|
| 홈 | public/home/index.html | 로그인·메뉴 진입 화면(React 번들 public/home, 소스 home-wheel/) | 작성 |
| 사전 | public/english_dictionary.html | 영·한·일·중 검색, 단어장(#wordbook), 발음, 팟캐스트, 퀴즈·복습, 카메라 글자 인식 | 작성 |
| 스펠링 런 | public/spelling_run.html | 단어장 단어로 하는 철자 게임(혼자·2인 대결) | 작성 |
| 문장 학습 | public/jgrammar.html | 일본어·영어·중국어 문장 해설·사진 인식·저장·읽어주기(파일명 jgrammar) | 작성 |
| 음성 학습 | public/voice_study.html | 음성 노트(녹음 변환·요약·퀴즈·대화·연결 지도·이미지)와 요약 읽어주기 | 작성 |
| 개념 지도 | public/concept_map.html | 개념 지도·복습·서술 답변(/api/cmap…) | 작성 |
| Speak Loop | public/speakloop.html | 영어 말하기 연습(저장 음성, 이디엄 포함; /api/speakloop…) | 작성 |
| 문학 나침반 | public/literature_compass.html | 정적 콘텐츠(literature_db.json) 읽기 | 작성 |
| 한입 독서 | public/digest_reading.html | 정적 콘텐츠(digest_db.json) 읽기 | 작성 |
| 과학 | public/science_reading.html | 정적 콘텐츠(science_db.json) 읽기 | 작성 |
| 작가 노트 | public/artist_notes.html | 정적 콘텐츠(artist_notes_db.json) 읽기 | 작성 |
| 관리자 | public/admin.html | 사용자·권한·사용량, Speak Loop 음성, 단어 뜻 변환, 발음 캐시 지우기 | 작성 |
- 단어장·팟캐스트·IT 용어는 별도 파일이 아니라 사전 화면(english_dictionary.html) 안의 기능이다. 대결은 스펠링 런 안의 기능, 이디엄은 Speak Loop 안의 기능이다.
- 이 표의 "도면" 열은 손으로 관리한다. 정확한 미작성 목록은 아래 생성 구간이 보여 준다.

## 공용 엔진 목록
엔진 이름 고정 목록과 한 줄 설명은 [LEGEND.md](LEGEND.md) 3절에 있다(새 엔진은 거기에 먼저 추가한다).

## 생성 구간 (npm run blueprint:gen 이 만든다. 이 안은 손으로 고치지 않는다)
<!-- gen:start -->
> 이 구간은 `npm run blueprint:gen` 이 화면 파일(docs/blueprint/screens)의 머리말에서 만든다. 손으로 고치지 않는다.
> 모든 화면(12개)의 도면이 작성돼 있다. 미작성 화면은 0개다.

### 엔진별 사용 화면 (→호출)
- **2인 대결 방(서버 메모리)** — 스펠링 런
- **AI 개념 지도 처리(Claude Haiku)** — 개념 지도
- **AI 단어 뜻 변환(Claude Haiku)** — 관리자
- **AI 문장 해설(Claude Haiku)** — 문장 학습
- **AI 사전·단어 질의(Claude Haiku)** — 사전
- **AI 사진 문장 인식(Claude Haiku)** — 문장 학습
- **AI 음성 노트 처리(Claude Haiku)** — 음성 학습
- **간격 반복 복습(SM-2)** — 사전
- **기기 PDF 저장(캔버스)** — 개념 지도
- **기기 글자 인식(Tesseract.js)** — 사전
- **기기 음성(speechSynthesis)** — 문장 학습, 사전, 스펠링 런, 음성 학습
- **서버 메모리 작업 상태** — 개념 지도, 관리자, 음성 학습
- **서버 음성(OpenAI TTS)** — 관리자, 사전, 스펠링 런
- **스펠링 런 게임 엔진(캔버스)** — 스펠링 런
- **음성 인식(OpenAI STT)** — 개념 지도, 음성 학습
- **이미지 생성(OpenAI Images)** — 음성 학습
- **저장 음성(Speak Loop)** — Speak Loop, 관리자

### 대체 경로 (⇢대체: 앞이 실패하면 뒤를 쓴다)
- **서버 음성(OpenAI TTS) ⇢ 기기 음성(speechSynthesis)** — 사전, 스펠링 런

### API별 사용 화면 (→호출)
- **DELETE /api/cmap/concepts/:id** — 개념 지도
- **DELETE /api/cmap/edges/:id** — 개념 지도
- **DELETE /api/cmap/maps/:id/nodes/:conceptId** — 개념 지도
- **DELETE /api/cmap/topics/:id** — 개념 지도
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
- **GET /api/cmap/answers/recent** — 개념 지도
- **GET /api/cmap/maps/:id/answer-targets** — 개념 지도
- **GET /api/cmap/maps/:id/narration** — 개념 지도
- **GET /api/cmap/maps/:id/quiz/marked-info** — 개념 지도
- **GET /api/cmap/topics** — 개념 지도
- **GET /api/cmap/topics/:id/concepts** — 개념 지도
- **GET /api/cmap/topics/:rootId/map** — 개념 지도
- **GET /api/jgrammar/saved** — 문장 학습
- **GET /api/me** — Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서, 홈
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
- **GET /auth/google** — 홈
- **GET /auth/google/callback** — 홈
- **PATCH /api/admin/users/:id** — 관리자
- **PATCH /api/cmap/concepts/:id** — 개념 지도
- **PATCH /api/cmap/edges/:id** — 개념 지도
- **PATCH /api/cmap/maps/:id/nodes/:conceptId** — 개념 지도
- **PATCH /api/cmap/topics/:id** — 개념 지도
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
- **POST /api/cmap/concepts/:id/answer/text** — 개념 지도
- **POST /api/cmap/concepts/:id/answer/voice** — 개념 지도
- **POST /api/cmap/concepts/:id/deepen** — 개념 지도
- **POST /api/cmap/maps/:id/edges** — 개념 지도
- **POST /api/cmap/maps/:id/edges/bulk** — 개념 지도
- **POST /api/cmap/maps/:id/narrate** — 개념 지도
- **POST /api/cmap/maps/:id/nodes** — 개념 지도
- **POST /api/cmap/maps/:id/quiz/start** — 개념 지도
- **POST /api/cmap/maps/:id/quiz/submit** — 개념 지도
- **POST /api/cmap/maps/:id/save** — 개념 지도
- **POST /api/cmap/topics** — 개념 지도
- **POST /api/cmap/topics/:id/concepts** — 개념 지도
- **POST /api/cmap/topics/:id/explain** — 개념 지도
- **POST /api/cmap/topics/:id/move** — 개념 지도
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
- **PUT /api/cmap/concepts/:id/mark** — 개념 지도
- **PUT /api/cmap/maps/:id/positions** — 개념 지도

### 저장소별 사용 화면 ([DB]·[캐시], →읽기 / →쓰기)
- **[DB] api_usage** — 읽기: 개념 지도, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습 / 쓰기: 개념 지도, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **[DB] cmap_answer_attempts** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_concept_marks** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_concepts** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_edges** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_map_nodes** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_maps** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_narrations** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_quiz_attempts** — 읽기: - / 쓰기: 개념 지도
- **[DB] cmap_topics** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] gloss_backup** — 읽기: 관리자 / 쓰기: 관리자
- **[DB] jgrammar_saved** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **[DB] review_log** — 읽기: - / 쓰기: 사전
- **[DB] speakloop_audio** — 읽기: Speak Loop, 관리자 / 쓰기: 관리자
- **[DB] speakloop_progress** — 읽기: Speak Loop / 쓰기: Speak Loop
- **[DB] users** — 읽기: Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서, 홈 / 쓰기: 관리자, 홈
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
- **artist_notes_conquest_** — 읽기: 작가 노트 / 쓰기: 작가 노트
- **artist_notes_field_filter** — 읽기: 작가 노트 / 쓰기: 작가 노트
- **digest_conquest_** — 읽기: 한입 독서 / 쓰기: 한입 독서
- **digest_genre_filter** — 읽기: 한입 독서 / 쓰기: 한입 독서
- **gl_last_run** — 읽기: 관리자 / 쓰기: 관리자
- **jgrammar_furigana** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **jgrammar_lang** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **jgrammar_pinyin** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **jgrammar_zh** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **metis_tts_mode** — 읽기: 사전, 스펠링 런 / 쓰기: 사전, 스펠링 런
- **mydict_token** — 읽기: Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서, 홈 / 쓰기: 사전, 홈
- **mydict_wrong** — 읽기: 사전 / 쓰기: 사전
- **science_conquest_** — 읽기: 과학 / 쓰기: 과학
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

### 파일별 사용 화면 ([파일] LEGEND 9절 고정 목록, →읽기 / →쓰기)
- **artist_notes_db** — 읽기: 작가 노트 / 쓰기: -
- **digest_db** — 읽기: 한입 독서 / 쓰기: -
- **literature_db** — 읽기: 문학 나침반 / 쓰기: -
- **ocr_word_list** — 읽기: 사전 / 쓰기: -
- **science_db** — 읽기: 과학 / 쓰기: -
- **speakloop_content** — 읽기: Speak Loop, 관리자 / 쓰기: -

### 외부 서비스별 사용 화면 ([외부])
- **Anthropic API(Claude Haiku)** — 개념 지도, 관리자, 문장 학습, 사전, 음성 학습
- **Google Fonts** — Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서
- **Google 로그인(OAuth)** — 사전, 스펠링 런, 홈
- **OpenAI Images(이미지 생성)** — 음성 학습
- **OpenAI STT(음성 인식)** — 개념 지도, 음성 학습
- **OpenAI TTS(음성 합성)** — 관리자, 사전, 스펠링 런
- **jsDelivr(tesseract.js)** — 사전

### 모듈별 사용 화면 ([모듈])
- **public/js/common/appHeader.js** — Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서
- **public/js/common/authGate.js** — Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서
- **public/js/common/dialog.js** — 과학, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서
- **public/js/ocr/ocrScanner.js** — 사전

### 미작성 화면 (0개)
(없음)

화면 파일의 마지막 확인 커밋: 23d581c, 49287a8, 8753b0a, 9319dc0
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
| [파일] | 저장소(파일) | DB 가 아닌 데이터 파일. 서버가 읽는 파일(data/ 아래)과 정적으로 내려주는 파일(public/ 아래 JSON·텍스트). 아래 9절 고정 목록의 이름만 쓴다 | `reads`·`writes` 의 `파일:이름` |
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
- **관문 공통 규칙**: authGate.js 를 쓰는 화면은 `GET /api/me` 를 거치며, 이 호출의 users 읽기·갱신(routes/auth.js:127, ADMIN_EMAILS 조건일 때 UPDATE)은 화면 머리말에 적지 않는다. 생성기가 관문 통과 화면(머리말 modules 에 authGate.js 가 있는 화면)에는 자동으로 인정하고 접근 차이 비교에서 제외한다.

=====================================================================
### 파일: docs/blueprint/db.md
=====================================================================

# DB 한 장 (docs/blueprint/db.md)

lib/db.js 의 DB init 에서 확인되는 테이블·서버 캐시마다 한 줄이다. 이름은 화면 머리말의 `DB:이름`·`캐시:이름` 과 같은 모양이며, `npm run blueprint:gen` 이 화면 머리말의 DB:·캐시: 이름이 여기에 있는지, 여기 이름이 lib/db.js 의 CREATE TABLE 에 있는지 대조한다(어긋나면 파일:줄과 함께 오류로 멈춘다).
형식은 [LEGEND.md](LEGEND.md) 7절. 이 표는 구조(담는 것·범위·핵심 열·연결)만 적는다. 실패 시 동작·결정 이유·불변 조건은 적지 않는다. "읽는 화면·쓰는 화면"은 아래 생성 구간이 화면 머리말에서 만든다.

## 항목 (손으로 관리)
| 이름 | 담는 것 | 범위 | 핵심 열 | 다른 테이블과의 연결 | 근거 |
|---|---|---|---|---|---|
| DB:users | 로그인한 사용자 계정과 역할·승인·차단·기능 권한 | 전체 공용 | id, google_id, email, role, is_approved | 없음 | lib/db.js:62 |
| DB:wordbook | 사용자가 저장한 단어·문장과 복습 일정 | 사용자별 | id, user_id, word, lang, data | user_id → users(id) | lib/db.js:158 |
| 캐시:tts_cache | 단어 발음 음성 파일(같은 글자·언어를 다시 만들지 않음) | 서버 캐시 | text_key, lang, audio | 없음 | lib/db.js:188 |
| DB:api_usage | AI·음성 호출 사용량 기록(하루 한도 계산·비용 추정) | 사용자별 | user_id, event_type, model, input_tokens, output_tokens | user_id → users(id) | lib/db.js:200 |
| DB:review_log | 단어 복습 결과 기록 | 사용자별 | user_id, word_id, score, created_at | user_id → users(id) | lib/db.js:214 |
| DB:voice_notes | 음성 노트(제목·받아쓴 글·요약) | 사용자별 | id, user_id, title, transcript, summary | user_id → users(id) | lib/db.js:228 |
| DB:voice_quizzes | 노트에서 만든 퀴즈 문항 | 사용자별 | note_id, user_id, questions, source_hash | note_id → voice_notes(id) | lib/db.js:248 |
| DB:voice_quiz_attempts | 음성 노트 퀴즈 풀이 결과 | 사용자별 | user_id, note_id, score, total, items | user_id → users(id), note_id → voice_notes(id) | lib/db.js:262 |
| DB:voice_concepts | 음성 학습의 개념(용어·설명, 과목>대주제>소주제) | 사용자별 | id, user_id, term, subject, topic | user_id → users(id) | lib/db.js:280 |
| DB:voice_links | 노트 사이의 연결 | 사용자별 | id, user_id, from_note_id, to_note_id, kind | user_id → users(id), from_note_id·to_note_id → voice_notes(id) | lib/db.js:302 |
| DB:voice_image_sets | 노트 요약 이미지 묶음의 상태 | 사용자별 | note_id, user_id, status, pages_total, rating | note_id → voice_notes(id), user_id → users(id) | lib/db.js:338 |
| DB:voice_images | 요약 이미지 쪽별 그림 | 사용자별 | note_id, page_no, status, image, mime | note_id → voice_image_sets(note_id) | lib/db.js:353 |
| DB:cmap_topics | 개념 지도의 주제 트리 | 사용자별 | id, user_id, parent_id, root_id, title | user_id → users(id), parent_id·root_id → cmap_topics(id) | lib/db.js:385 |
| DB:cmap_concepts | 주제에 속한 개념과 설명 | 사용자별 | id, user_id, topic_id, term, explanation | user_id → users(id), topic_id → cmap_topics(id) | lib/db.js:411 |
| DB:cmap_maps | 주제 하나의 지도와 저장 상태 | 사용자별 | id, user_id, root_topic_id, semantic_hash, saved_at | user_id → users(id), root_topic_id → cmap_topics(id) | lib/db.js:440 |
| DB:cmap_map_nodes | 지도에 놓인 개념과 위치 | 사용자별 | map_id, concept_id, x, y | map_id → cmap_maps(id), concept_id → cmap_concepts(id) | lib/db.js:456 |
| DB:cmap_edges | 지도에서 개념끼리의 연결 | 사용자별 | id, map_id, from_concept_id, to_concept_id, relation_type | map_id → cmap_maps(id), (map_id, from·to_concept_id) → cmap_map_nodes | lib/db.js:469 |
| DB:cmap_narrations | 지도 해설 결과(지도당 1건) | 사용자별 | map_id, user_id, source_hash, content, model | map_id → cmap_maps(id), user_id → users(id) | lib/db.js:489 |
| DB:cmap_concept_marks | 사용자가 "모르는 개념"으로 표시한 것 | 사용자별 | user_id, concept_id, marked_at | user_id → users(id), concept_id → cmap_concepts(id) | lib/db.js:504 |
| DB:cmap_quiz_attempts | 지도 연결 퀴즈 풀이 점수 | 사용자별 | user_id, map_id, pair_score, type_score, direction_score | user_id → users(id), map_id → cmap_maps(id) | lib/db.js:516 |
| DB:cmap_answer_attempts | 말로 설명하기 답변과 평가 | 사용자별 | user_id, concept_id, verdict, summary, input_mode | user_id → users(id), concept_id → cmap_concepts(id) | lib/db.js:533 |
| 캐시:jgrammar_cache | 문장 해설 결과(같은 문장을 다시 부르지 않음) | 서버 캐시 | sentence_hash, sentence, result, model, lang | 없음 | lib/db.js:620 |
| DB:jgrammar_saved | 사용자가 저장한 문장 해설 목록 | 사용자별 | id, user_id, sentence_hash, sentence, lang | user_id → users(id) | lib/db.js:640 |
| DB:speakloop_audio | Speak Loop 저장 음성 클립 | 전체 공용 | clip_key, kind, text, model, audio | 없음 | lib/db.js:675 |
| DB:speakloop_progress | Speak Loop 연습 횟수·평가 | 사용자별 | user_id, item_id, count, last_rating, last_at | user_id → users(id) | lib/db.js:692 |
| DB:gloss_backup | 단어 뜻 일괄 변환 전·후 백업 | 전체 공용 | id, run_id, wordbook_id, before, after | 없음(wordbook_id 에 참조 키 없음) | lib/db.js:706 |

> "화면 연결 없음"은 어떤 화면 도면에도 안 나온다는 뜻이다(코드에서 안 쓰인다는 뜻이 아니다). 개념 지도 도면(작업451)은 일부러 좁게 쓴 도면이라 cmap_narrations·cmap_quiz_attempts·cmap_answer_attempts 는 그 도면에 없어 여기서 연결 없음으로 보인다. voice_concepts 는 lib/db.js 밖(routes·lib·public)에서 이름이 grep 으로 나오지 않았다([확인함]).

## 읽는 화면·쓰는 화면 (npm run blueprint:gen 이 만든다. 이 안은 손으로 고치지 않는다)
<!-- gen:start -->
> 화면 파일 12개의 머리말(reads·writes)에서 만든다. 항목 26개, 화면 연결 없음 1개.

- **[DB] api_usage** — 읽기: 개념 지도, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습 / 쓰기: 개념 지도, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **[DB] cmap_answer_attempts** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_concept_marks** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_concepts** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_edges** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_map_nodes** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_maps** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_narrations** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_quiz_attempts** — 읽기: - / 쓰기: 개념 지도
- **[DB] cmap_topics** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] gloss_backup** — 읽기: 관리자 / 쓰기: 관리자
- **[캐시] jgrammar_cache** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **[DB] jgrammar_saved** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **[DB] review_log** — 읽기: - / 쓰기: 사전
- **[DB] speakloop_audio** — 읽기: Speak Loop, 관리자 / 쓰기: 관리자
- **[DB] speakloop_progress** — 읽기: Speak Loop / 쓰기: Speak Loop
- **[캐시] tts_cache** — 읽기: 사전, 스펠링 런 / 쓰기: 관리자, 사전, 스펠링 런
- **[DB] users** — 읽기: Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서, 홈 / 쓰기: 관리자, 홈
- **[DB] voice_concepts** — 화면 연결 없음
- **[DB] voice_image_sets** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_images** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_links** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_notes** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_quiz_attempts** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_quizzes** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] wordbook** — 읽기: 관리자, 사전, 스펠링 런 / 쓰기: 관리자, 사전
<!-- gen:end -->

=====================================================================
### 파일: docs/blueprint/api.md
=====================================================================

# API 한 장 (docs/blueprint/api.md)

서버 라우트(server.js·routes/*.js 의 `router|app . get|post|put|patch|delete`) 한 개가 표 한 줄이다. 형식은 [LEGEND.md](LEGEND.md) 10절. `npm run blueprint:gen` 이 이 표를 코드·db.md·LEGEND·화면 머리말과 대조한다(라우트가 코드에 늘었는데 여기 없으면 생성이 멈춘다). 줄 단위 근거(어느 줄이 어떤 SQL·호출인지)는 조사 초안 [_draft/api-catalog-draft.md](_draft/api-catalog-draft.md) 에 보관한다.

## 공통 사항
- 인증이 `공개` 가 아니면 requireAuth 가 매 요청마다 users 를 읽는다(middleware/auth.js:30). 이 읽기는 행마다 쓰지 않고 gen 이 계산한다. `권한:이름` 은 로그인을 포함하며 users 의 그 열을 한 번 더 읽는다. 행의 읽기·쓰기에 users 가 있으면 그 경로가 users 를 데이터로 읽거나 쓰는 것이다.
- 권한 검사 방식: `권한:can_*`·`권한:perm_voice_study` 는 checkPermission(DB 오류·행 없음이면 허용, fail-open), `권한:perm_jgrammar`·`perm_speakloop`·`perm_versus`·`perm_concept_map` 은 각 라우터의 fail-closed 검사다(관리자 면제 여부 등 상세는 [초안](_draft/api-catalog-draft.md) 의 행별 인증 칸).
- 모든 `/api/**` 는 DB 준비 대기 미들웨어(server.js:68)를 지난다. 정적 파일은 `express.static`(server.js:57)이 보낸다(라우트 아님).
- `호출 화면` 의 `공용` 은 authGate.js·appHeader.js 가 부르는 것이다. gen 이 머리말 modules 에 authGate.js 가 있는 화면으로 펼쳐 계산한다.
- 표 밖 설명은 아래 "행별 비고". 응답 뒤 백그라운드로 도는 작업은 비고에 적었다.

## 기타 (2)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| GET / | 기타 | server.js:49 | 공개 | - | - | - | - | - | - | 확인함 |
| GET /admin | 기타 | server.js:53 | 공개 | - | - | - | - | - | - | 확인함 |

## 인증·계정 (3)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| GET /auth/google | 인증·계정 | routes/auth.js:67 | 공개 | - | - | - | Google 로그인(OAuth) | - | 공용, 홈, 사전, 스펠링 런 | 확인함 |
| GET /auth/google/callback | 인증·계정 | routes/auth.js:75 | 공개 | DB:users | DB:users | - | Google 로그인(OAuth) | - | - | 확인함 |
| GET /api/me | 인증·계정 | routes/auth.js:101 | 로그인 | DB:users | DB:users | - | - | - | 공용, 홈, 사전, 스펠링 런, 문장 학습, 음성 학습, 개념 지도, Speak Loop, 관리자 | 확인함 |

## 관리자 (14)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| GET /api/admin/users | 관리자 | routes/admin.js:9 | 관리자 | DB:api_usage, DB:users, DB:wordbook | - | - | - | - | 관리자 | 확인함 |
| PATCH /api/admin/users/:id | 관리자 | routes/admin.js:33 | 관리자 | DB:users | DB:users | - | - | - | 관리자 | 확인함 |
| GET /api/admin/stats | 관리자 | routes/admin.js:67 | 관리자 | DB:api_usage, DB:users | - | - | - | - | 관리자 | 확인함 |
| GET /api/admin/gloss/status | 관리자 | routes/gloss.js:15 | 관리자 | DB:wordbook | - | - | - | - | 관리자 | 확인함 |
| POST /api/admin/gloss/sample | 관리자 | routes/gloss.js:36 | 관리자 | DB:wordbook | DB:api_usage | AI 단어 뜻 변환(Claude Haiku) | Anthropic API(Claude Haiku) | - | 관리자 | 확인함 |
| POST /api/admin/gloss/run | 관리자 | routes/gloss.js:45 | 관리자 | DB:wordbook | DB:api_usage, DB:gloss_backup, DB:wordbook | AI 단어 뜻 변환(Claude Haiku), 서버 메모리 작업 상태 | Anthropic API(Claude Haiku) | - | 관리자 | 확인함 |
| POST /api/admin/gloss/restore | 관리자 | routes/gloss.js:57 | 관리자 | DB:gloss_backup | DB:wordbook | 서버 메모리 작업 상태 | - | - | 관리자 | 확인함 |
| GET /api/admin/gloss/backup | 관리자 | routes/gloss.js:70 | 관리자 | DB:gloss_backup | - | - | - | - | 관리자 | 확인함 |
| GET /api/admin/speakloop/audio/status | 관리자 | routes/speakloop.js:105 | 관리자 | DB:speakloop_audio | - | - | - | speakloop_content | 관리자 | 확인함 |
| GET /api/admin/speakloop/audio/list | 관리자 | routes/speakloop.js:118 | 관리자 | DB:speakloop_audio | - | - | - | speakloop_content | 관리자 | 확인함 |
| POST /api/admin/speakloop/audio/preview | 관리자 | routes/speakloop.js:132 | 관리자 | - | DB:api_usage | 서버 음성(OpenAI TTS), 저장 음성(Speak Loop), 서버 메모리 작업 상태 | OpenAI TTS(음성 합성) | speakloop_content | 관리자 | 확인함 |
| POST /api/admin/speakloop/audio/generate | 관리자 | routes/speakloop.js:165 | 관리자 | DB:speakloop_audio | DB:api_usage, DB:speakloop_audio | 서버 음성(OpenAI TTS), 저장 음성(Speak Loop), 서버 메모리 작업 상태 | OpenAI TTS(음성 합성) | speakloop_content | 관리자 | 확인함 |
| DELETE /api/tts/cache | 관리자 | routes/tts.js:13 | 관리자 | - | 캐시:tts_cache | - | - | - | - | 확인함 |
| DELETE /api/tts/cache/entry | 관리자 | routes/tts.js:27 | 관리자 | - | 캐시:tts_cache | - | - | - | 관리자 | 확인함 |

## 사전·단어장 (11)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| POST /api/ai | 사전·단어장 | routes/dictionary.js:26 | 권한:can_search | DB:api_usage | DB:api_usage | AI 사전·단어 질의(Claude Haiku) | Anthropic API(Claude Haiku) | - | 사전 | 확인함 |
| GET /api/wordbook | 사전·단어장 | routes/wordbook.js:14 | 권한:can_wordbook | DB:wordbook | - | - | - | - | 사전, 스펠링 런 | 확인함 |
| POST /api/wordbook | 사전·단어장 | routes/wordbook.js:29 | 권한:can_wordbook | - | DB:wordbook | - | - | - | 사전 | 확인함 |
| DELETE /api/wordbook/:id | 사전·단어장 | routes/wordbook.js:51 | 권한:can_wordbook | - | DB:wordbook | - | - | - | 사전 | 확인함 |
| PATCH /api/wordbook/:id/example | 사전·단어장 | routes/wordbook.js:67 | 권한:can_wordbook | - | DB:wordbook | - | - | - | 사전 | 확인함 |
| PATCH /api/wordbook/:id/it | 사전·단어장 | routes/wordbook.js:85 | 권한:can_wordbook | - | DB:wordbook | - | - | - | 사전 | 확인함 |
| DELETE /api/wordbook/:id/it | 사전·단어장 | routes/wordbook.js:107 | 권한:can_wordbook | - | DB:wordbook | - | - | - | 사전 | 확인함 |
| POST /api/review-result | 사전·단어장 | routes/wordbook.js:151 | 로그인 | DB:wordbook | DB:review_log, DB:wordbook | 간격 반복 복습(SM-2) | - | - | 사전 | 확인함 |
| POST /api/quiz-correct | 사전·단어장 | routes/wordbook.js:186 | 로그인 | - | DB:wordbook | - | - | - | 사전 | 확인함 |
| GET /api/review-due | 사전·단어장 | routes/wordbook.js:201 | 로그인 | DB:wordbook | - | 간격 반복 복습(SM-2) | - | - | 사전 | 확인함 |
| POST /api/tts | 사전·단어장 | routes/tts.js:72 | 권한:can_tts | DB:api_usage, 캐시:tts_cache | DB:api_usage, 캐시:tts_cache | 서버 음성(OpenAI TTS) | OpenAI TTS(음성 합성) | - | 사전, 스펠링 런 | 확인함 |

## 문장 학습 (4)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| POST /api/jgrammar/ocr | 문장 학습 | routes/jgrammar.js:54 | 권한:perm_jgrammar | DB:api_usage | DB:api_usage | AI 사진 문장 인식(Claude Haiku) | Anthropic API(Claude Haiku) | - | 문장 학습 | 확인함 |
| POST /api/jgrammar/explain | 문장 학습 | routes/jgrammar.js:64 | 권한:perm_jgrammar | DB:api_usage, 캐시:jgrammar_cache | DB:api_usage, 캐시:jgrammar_cache, DB:jgrammar_saved | AI 문장 해설(Claude Haiku) | Anthropic API(Claude Haiku) | - | 문장 학습 | 확인함 |
| GET /api/jgrammar/saved | 문장 학습 | routes/jgrammar.js:76 | 권한:perm_jgrammar | DB:jgrammar_saved | - | - | - | - | 문장 학습 | 확인함 |
| DELETE /api/jgrammar/saved/:id | 문장 학습 | routes/jgrammar.js:85 | 권한:perm_jgrammar | - | DB:jgrammar_saved | - | - | - | 문장 학습 | 확인함 |

## Speak Loop (5)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| GET /api/speakloop/content | Speak Loop | routes/speakloop.js:34 | 권한:perm_speakloop | - | - | - | - | speakloop_content | Speak Loop, 관리자 | 확인함 |
| GET /api/speakloop/audio-index | Speak Loop | routes/speakloop.js:38 | 권한:perm_speakloop | DB:speakloop_audio | - | 저장 음성(Speak Loop) | - | speakloop_content | Speak Loop | 확인함 |
| GET /api/speakloop/audio/:clipKey | Speak Loop | routes/speakloop.js:54 | 권한:perm_speakloop | DB:speakloop_audio | - | 저장 음성(Speak Loop) | - | speakloop_content | Speak Loop, 관리자 | 확인함 |
| GET /api/speakloop/progress | Speak Loop | routes/speakloop.js:75 | 권한:perm_speakloop | DB:speakloop_progress | - | - | - | - | Speak Loop | 확인함 |
| POST /api/speakloop/progress | Speak Loop | routes/speakloop.js:85 | 권한:perm_speakloop | - | DB:speakloop_progress | - | - | speakloop_content | Speak Loop | 확인함 |

## 스펠링 런 대결 (9)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| POST /api/versus/rooms | 스펠링 런 대결 | routes/versus.js:52 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| GET /api/versus/rooms | 스펠링 런 대결 | routes/versus.js:58 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| POST /api/versus/rooms/:id/join | 스펠링 런 대결 | routes/versus.js:62 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| POST /api/versus/rooms/:id/start | 스펠링 런 대결 | routes/versus.js:67 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| POST /api/versus/rooms/:id/state | 스펠링 런 대결 | routes/versus.js:73 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| POST /api/versus/rooms/:id/finish | 스펠링 런 대결 | routes/versus.js:78 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| GET /api/versus/rooms/:id | 스펠링 런 대결 | routes/versus.js:83 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| POST /api/versus/rooms/:id/rematch | 스펠링 런 대결 | routes/versus.js:88 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |
| POST /api/versus/rooms/:id/leave | 스펠링 런 대결 | routes/versus.js:93 | 권한:perm_versus | - | - | 2인 대결 방(서버 메모리) | - | - | 스펠링 런 | 확인함 |

## 음성 학습 (27)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| GET /api/voice-notes | 음성 학습 | routes/voice_study.js:117 | 권한:perm_voice_study | DB:voice_notes | - | - | - | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/wrong-answers | 음성 학습 | routes/voice_study.js:138 | 권한:perm_voice_study | DB:voice_notes, DB:voice_quiz_attempts | - | - | - | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/quiz-summary | 음성 학습 | routes/voice_study.js:153 | 권한:perm_voice_study | DB:voice_notes, DB:voice_quiz_attempts, DB:voice_quizzes | - | - | - | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/map | 음성 학습 | routes/voice_study.js:200 | 권한:perm_voice_study | DB:voice_links, DB:voice_notes | - | - | - | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/links | 음성 학습 | routes/voice_study.js:238 | 권한:perm_voice_study | DB:voice_links, DB:voice_notes | DB:voice_links | - | - | - | 음성 학습 | 확인함 |
| PATCH /api/voice-notes/links/:id | 음성 학습 | routes/voice_study.js:282 | 권한:perm_voice_study | DB:voice_links | DB:voice_links | - | - | - | 음성 학습 | 확인함 |
| DELETE /api/voice-notes/links/:id | 음성 학습 | routes/voice_study.js:315 | 권한:perm_voice_study | DB:voice_links | DB:voice_links | - | - | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/map/build | 음성 학습 | routes/voice_study.js:374 | 권한:perm_voice_study | DB:api_usage, DB:voice_links, DB:voice_notes | DB:api_usage, DB:voice_links, DB:voice_notes | AI 음성 노트 처리(Claude Haiku), 서버 메모리 작업 상태 | Anthropic API(Claude Haiku) | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/map/build-status | 음성 학습 | routes/voice_study.js:440 | 권한:perm_voice_study | - | - | 서버 메모리 작업 상태 | - | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/:id | 음성 학습 | routes/voice_study.js:449 | 권한:perm_voice_study | DB:voice_notes | - | - | - | - | 음성 학습 | 확인함 |
| POST /api/voice-notes | 음성 학습 | routes/voice_study.js:467 | 권한:perm_voice_study | DB:api_usage, DB:voice_links, DB:voice_notes | DB:api_usage, DB:voice_links, DB:voice_notes | AI 음성 노트 처리(Claude Haiku), 서버 메모리 작업 상태 | Anthropic API(Claude Haiku) | - | 음성 학습 | 확인함 |
| PATCH /api/voice-notes/:id | 음성 학습 | routes/voice_study.js:492 | 권한:perm_voice_study | DB:api_usage, DB:voice_links, DB:voice_notes | DB:api_usage, DB:voice_links, DB:voice_notes | AI 음성 노트 처리(Claude Haiku), 서버 메모리 작업 상태 | Anthropic API(Claude Haiku) | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/merge | 음성 학습 | routes/voice_study.js:541 | 권한:perm_voice_study | DB:voice_notes | DB:voice_notes | - | - | - | 음성 학습 | 확인함 |
| DELETE /api/voice-notes/:id | 음성 학습 | routes/voice_study.js:591 | 권한:perm_voice_study | - | DB:voice_notes | - | - | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/transcribe | 음성 학습 | routes/voice_study.js:652 | 권한:perm_voice_study | DB:api_usage | DB:api_usage | 음성 인식(OpenAI STT) | OpenAI STT(음성 인식) | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/summarize | 음성 학습 | routes/voice_study.js:777 | 권한:perm_voice_study | DB:api_usage | DB:api_usage | AI 음성 노트 처리(Claude Haiku) | Anthropic API(Claude Haiku) | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/:id/quiz | 음성 학습 | routes/voice_study.js:927 | 권한:perm_voice_study | DB:voice_notes, DB:voice_quizzes | - | - | - | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/:id/quiz | 음성 학습 | routes/voice_study.js:946 | 권한:perm_voice_study | DB:api_usage, DB:voice_notes | DB:api_usage, DB:voice_quizzes | AI 음성 노트 처리(Claude Haiku) | Anthropic API(Claude Haiku) | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/:id/chat | 음성 학습 | routes/voice_study.js:1085 | 권한:perm_voice_study | DB:api_usage, DB:voice_notes | DB:api_usage | AI 음성 노트 처리(Claude Haiku) | Anthropic API(Claude Haiku) | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/:id/links | 음성 학습 | routes/voice_study.js:1389 | 권한:perm_voice_study | DB:voice_links, DB:voice_notes | - | - | - | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/:id/links/refresh | 음성 학습 | routes/voice_study.js:1446 | 권한:perm_voice_study | DB:api_usage, DB:voice_links, DB:voice_notes | DB:api_usage, DB:voice_links, DB:voice_notes | AI 음성 노트 처리(Claude Haiku), 서버 메모리 작업 상태 | Anthropic API(Claude Haiku) | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/:id/image | 음성 학습 | routes/voice_study.js:1879 | 권한:perm_voice_study | DB:api_usage, DB:voice_image_sets, DB:voice_notes | DB:api_usage, DB:voice_image_sets, DB:voice_images | AI 음성 노트 처리(Claude Haiku), 이미지 생성(OpenAI Images) | Anthropic API(Claude Haiku), OpenAI Images(이미지 생성) | - | 음성 학습 | 추정 |
| GET /api/voice-notes/:id/image | 음성 학습 | routes/voice_study.js:1929 | 권한:perm_voice_study | DB:api_usage, DB:voice_image_sets, DB:voice_images, DB:voice_notes | DB:voice_image_sets | - | - | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/:id/image/file | 음성 학습 | routes/voice_study.js:1977 | 권한:perm_voice_study | DB:voice_image_sets, DB:voice_images | - | - | - | - | 음성 학습 | 확인함 |
| PATCH /api/voice-notes/:id/image/rating | 음성 학습 | routes/voice_study.js:2005 | 권한:perm_voice_study | - | DB:voice_image_sets | - | - | - | 음성 학습 | 확인함 |
| POST /api/voice-notes/:id/quiz/attempts | 음성 학습 | routes/voice_study.js:2083 | 권한:perm_voice_study | DB:voice_notes, DB:voice_quizzes | DB:voice_quiz_attempts | - | - | - | 음성 학습 | 확인함 |
| GET /api/voice-notes/:id/quiz/attempts | 음성 학습 | routes/voice_study.js:2125 | 권한:perm_voice_study | DB:voice_notes, DB:voice_quiz_attempts | - | - | - | - | 음성 학습 | 확인함 |

## 개념 지도 (32)

| METHOD 경로 | 묶음 | 정의 | 인증 | 읽기 | 쓰기 | 엔진 | 외부 | 파일 | 호출 화면 | 근거 |
|---|---|---|---|---|---|---|---|---|---|---|
| GET /api/cmap/status | 개념 지도 | routes/concept_map.js:33 | 권한:perm_concept_map | - | - | - | - | - | - | 확인함 |
| GET /api/cmap/topics | 개념 지도 | routes/concept_map.js:111 | 권한:perm_concept_map | DB:cmap_concepts, DB:cmap_topics | - | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/topics | 개념 지도 | routes/concept_map.js:118 | 권한:perm_concept_map | DB:cmap_topics | DB:cmap_topics | - | - | - | 개념 지도 | 확인함 |
| PATCH /api/cmap/topics/:id | 개념 지도 | routes/concept_map.js:138 | 권한:perm_concept_map | DB:cmap_topics | DB:cmap_topics | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/topics/:id/move | 개념 지도 | routes/concept_map.js:154 | 권한:perm_concept_map | DB:cmap_concepts, DB:cmap_map_nodes, DB:cmap_maps, DB:cmap_topics | DB:cmap_maps, DB:cmap_topics | - | - | - | 개념 지도 | 확인함 |
| DELETE /api/cmap/topics/:id | 개념 지도 | routes/concept_map.js:193 | 권한:perm_concept_map | DB:cmap_concepts, DB:cmap_maps, DB:cmap_topics | DB:cmap_concepts, DB:cmap_maps, DB:cmap_topics | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/topics/:id/explain | 개념 지도 | routes/concept_map.js:296 | 권한:perm_concept_map | DB:api_usage, DB:cmap_concepts, DB:cmap_topics | DB:api_usage, DB:cmap_concepts | AI 개념 지도 처리(Claude Haiku) | Anthropic API(Claude Haiku) | - | 개념 지도 | 확인함 |
| GET /api/cmap/topics/:id/concepts | 개념 지도 | routes/concept_map.js:353 | 권한:perm_concept_map | DB:cmap_concepts, DB:cmap_topics | - | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/topics/:id/concepts | 개념 지도 | routes/concept_map.js:361 | 권한:perm_concept_map | DB:cmap_concepts, DB:cmap_topics | DB:cmap_concepts | - | - | - | 개념 지도 | 확인함 |
| PATCH /api/cmap/concepts/:id | 개념 지도 | routes/concept_map.js:381 | 권한:perm_concept_map | DB:cmap_concepts | DB:cmap_concepts | - | - | - | 개념 지도 | 확인함 |
| PUT /api/cmap/concepts/:id/mark | 개념 지도 | routes/concept_map.js:422 | 권한:perm_concept_map | DB:cmap_concept_marks, DB:cmap_concepts | DB:cmap_concept_marks | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/concepts/:id/deepen | 개념 지도 | routes/concept_map.js:445 | 권한:perm_concept_map | DB:api_usage, DB:cmap_concepts, DB:cmap_topics | DB:api_usage, DB:cmap_concepts | AI 개념 지도 처리(Claude Haiku) | Anthropic API(Claude Haiku) | - | 개념 지도 | 확인함 |
| DELETE /api/cmap/concepts/:id | 개념 지도 | routes/concept_map.js:484 | 권한:perm_concept_map | DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | - | - | - | 개념 지도 | 확인함 |
| GET /api/cmap/topics/:rootId/map | 개념 지도 | routes/concept_map.js:558 | 권한:perm_concept_map | DB:cmap_concept_marks, DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps, DB:cmap_topics | DB:cmap_maps | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/maps/:id/nodes | 개념 지도 | routes/concept_map.js:589 | 권한:perm_concept_map | DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps, DB:cmap_topics | DB:cmap_map_nodes | - | - | - | 개념 지도 | 확인함 |
| DELETE /api/cmap/maps/:id/nodes/:conceptId | 개념 지도 | routes/concept_map.js:607 | 권한:perm_concept_map | DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | DB:cmap_edges, DB:cmap_map_nodes | - | - | - | 개념 지도 | 확인함 |
| PATCH /api/cmap/maps/:id/nodes/:conceptId | 개념 지도 | routes/concept_map.js:627 | 권한:perm_concept_map | DB:cmap_maps | DB:cmap_map_nodes | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/maps/:id/edges | 개념 지도 | routes/concept_map.js:659 | 권한:perm_concept_map | DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | DB:cmap_edges | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/maps/:id/edges/bulk | 개념 지도 | routes/concept_map.js:683 | 권한:perm_concept_map | DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | DB:cmap_edges | - | - | - | 개념 지도 | 확인함 |
| PATCH /api/cmap/edges/:id | 개념 지도 | routes/concept_map.js:718 | 권한:perm_concept_map | DB:cmap_edges | DB:cmap_edges | - | - | - | 개념 지도 | 확인함 |
| DELETE /api/cmap/edges/:id | 개념 지도 | routes/concept_map.js:752 | 권한:perm_concept_map | DB:cmap_edges | DB:cmap_edges | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/maps/:id/save | 개념 지도 | routes/concept_map.js:767 | 권한:perm_concept_map | DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | DB:cmap_maps | - | - | - | 개념 지도 | 확인함 |
| PUT /api/cmap/maps/:id/positions | 개념 지도 | routes/concept_map.js:780 | 권한:perm_concept_map | DB:cmap_maps | DB:cmap_map_nodes | - | - | - | 개념 지도 | 확인함 |
| GET /api/cmap/maps/:id/narration | 개념 지도 | routes/concept_map.js:829 | 권한:perm_concept_map | DB:api_usage, DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps, DB:cmap_narrations, DB:cmap_topics | - | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/maps/:id/narrate | 개념 지도 | routes/concept_map.js:846 | 권한:perm_concept_map | DB:api_usage, DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps, DB:cmap_topics | DB:api_usage, DB:cmap_narrations | AI 개념 지도 처리(Claude Haiku), 서버 메모리 작업 상태 | Anthropic API(Claude Haiku) | - | 개념 지도 | 확인함 |
| GET /api/cmap/maps/:id/quiz/marked-info | 개념 지도 | routes/concept_map.js:904 | 권한:perm_concept_map | DB:cmap_concept_marks, DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | - | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/maps/:id/quiz/start | 개념 지도 | routes/concept_map.js:916 | 권한:perm_concept_map | DB:cmap_concept_marks, DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | - | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/maps/:id/quiz/submit | 개념 지도 | routes/concept_map.js:937 | 권한:perm_concept_map | DB:cmap_concept_marks, DB:cmap_concepts, DB:cmap_edges, DB:cmap_map_nodes, DB:cmap_maps | DB:cmap_quiz_attempts | - | - | - | 개념 지도 | 확인함 |
| POST /api/cmap/concepts/:id/answer/voice | 개념 지도 | routes/concept_map.js:993 | 권한:perm_concept_map | DB:api_usage, DB:cmap_concepts | DB:api_usage, DB:cmap_answer_attempts | AI 개념 지도 처리(Claude Haiku), 음성 인식(OpenAI STT) | Anthropic API(Claude Haiku), OpenAI STT(음성 인식) | - | 개념 지도 | 확인함 |
| POST /api/cmap/concepts/:id/answer/text | 개념 지도 | routes/concept_map.js:1007 | 권한:perm_concept_map | DB:api_usage, DB:cmap_concepts | DB:api_usage, DB:cmap_answer_attempts | AI 개념 지도 처리(Claude Haiku) | Anthropic API(Claude Haiku) | - | 개념 지도 | 확인함 |
| GET /api/cmap/answers/recent | 개념 지도 | routes/concept_map.js:1020 | 권한:perm_concept_map | DB:cmap_answer_attempts, DB:cmap_concepts | - | - | - | - | 개념 지도 | 확인함 |
| GET /api/cmap/maps/:id/answer-targets | 개념 지도 | routes/concept_map.js:1033 | 권한:perm_concept_map | DB:cmap_concept_marks, DB:cmap_concepts, DB:cmap_maps, DB:cmap_topics | - | - | - | - | 개념 지도 | 확인함 |

## 행별 비고

- GET /: 페이지 경로. 화면 홈을 보낸다
- GET /admin: 페이지 경로. 화면 관리자를 보낸다
- GET /auth/google/callback: JWT 를 만들어 ?token= 으로 돌려보낸다(routes/auth.js:89-94). 차단·미승인이면 토큰 없이 approval 표시(routes/auth.js:83-88) / 외부(Google)가 되돌려 부르는 주소
- POST /api/admin/gloss/sample: 샘플은 wordbook 을 바꾸지 않는다(sample 함수 :199-222 에 UPDATE 없음)
- POST /api/admin/gloss/run: 서버 메모리 잠금 runLocked(lib/gloss_backfill.js:175, 호출 :51)
- POST /api/admin/speakloop/audio/preview: 결과는 DB 에 저장하지 않고 mp3 로 돌려준다(routes/speakloop.js:131 주석, 155-158)
- POST /api/admin/speakloop/audio/generate: 서버 메모리 잠금 TTS.runLocked(routes/speakloop.js:177)
- DELETE /api/tts/cache: 호출하는 화면 없음(관리자 화면은 entry 쪽만 부른다)
- DELETE /api/wordbook/:id: 딸린 복습 기록은 FK ON DELETE CASCADE(lib/db.js:216)로 함께 지워질 것으로 [추정] — FK 정의만 확인
- POST /api/versus/rooms: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- GET /api/versus/rooms: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- POST /api/versus/rooms/:id/join: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- POST /api/versus/rooms/:id/start: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- POST /api/versus/rooms/:id/state: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- POST /api/versus/rooms/:id/finish: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- GET /api/versus/rooms/:id: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- POST /api/versus/rooms/:id/rematch: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- POST /api/versus/rooms/:id/leave: 방 상태는 서버 메모리(lib/versus.js createStore, routes/versus.js:9) — DB 쓰기 없음
- GET /api/voice-notes/wrong-answers: 핸들러 wrongAnswersHandler(:2067)
- POST /api/voice-notes/map/build: dry_run=true 면 AI·쓰기 없이 추정만(:378-381). 진행 상태는 서버 메모리 mapBuilds(:336)
- GET /api/voice-notes/map/build-status: DB 접근 없음, 서버 메모리 mapBuilds 만 읽음(:442-446)
- POST /api/voice-notes: 요약·과목이 있으면 응답 뒤 백그라운드로 연결 분석이 돈다(scheduleLinkAnalysis :1383, VOICE_LINK_AUTO=off 면 안 돈다 :1384) → AI 음성 노트 처리(Claude Haiku) / Anthropic API(Claude Haiku) (:1313)
- PATCH /api/voice-notes/:id: 요약·과목이 있으면 응답 뒤 백그라운드로 연결 분석이 돈다(scheduleLinkAnalysis :1383, VOICE_LINK_AUTO=off 면 안 돈다 :1384) → AI 음성 노트 처리(Claude Haiku) / Anthropic API(Claude Haiku) (:1313)
- POST /api/voice-notes/:id/image: 응답 뒤 백그라운드 파이프라인(scheduleImagePipeline :1926 → runImagePipeline :1789). 파이프라인 내부 줄은 grep 으로 SQL·호출 줄만 확인
- GET /api/cmap/status: 화면에서 부르는 곳 없음
- POST /api/cmap/maps/:id/narrate: 서버 메모리 narrating 잠금(:857)

## 생성 구간 (npm run blueprint:gen 이 만든다. 이 안은 손으로 고치지 않는다)
<!-- gen:start -->
> api.md 의 API 행 107개에서 만든다. 인증이 공개가 아닌 행은 users 를 읽는 것으로 계산한다(공통 규칙).

### 묶음별 API 수
- 인증·계정: 3
- 관리자: 14
- 사전·단어장: 11
- 문장 학습: 4
- Speak Loop: 5
- 스펠링 런 대결: 9
- 음성 학습: 27
- 개념 지도: 32
- 기타: 2

### 인증별 API 수
- 공개: 4
- 관리자: 14
- 권한:can_search: 1
- 권한:can_tts: 1
- 권한:can_wordbook: 6
- 권한:perm_concept_map: 32
- 권한:perm_jgrammar: 4
- 권한:perm_speakloop: 5
- 권한:perm_versus: 9
- 권한:perm_voice_study: 27
- 로그인: 4

### 테이블별 읽는·쓰는 API 수 ([DB]·[캐시]; users 읽기는 인증이 공개가 아닌 모든 API 포함)
- **[DB] api_usage** — 읽는 API 22개 / 쓰는 API 22개
- **[DB] cmap_answer_attempts** — 읽는 API 1개 / 쓰는 API 2개
- **[DB] cmap_concept_marks** — 읽는 API 6개 / 쓰는 API 1개
- **[DB] cmap_concepts** — 읽는 API 21개 / 쓰는 API 6개
- **[DB] cmap_edges** — 읽는 API 14개 / 쓰는 API 6개
- **[DB] cmap_map_nodes** — 읽는 API 13개 / 쓰는 API 5개
- **[DB] cmap_maps** — 읽는 API 17개 / 쓰는 API 5개
- **[DB] cmap_narrations** — 읽는 API 1개 / 쓰는 API 1개
- **[DB] cmap_quiz_attempts** — 읽는 API 0개 / 쓰는 API 1개
- **[DB] cmap_topics** — 읽는 API 14개 / 쓰는 API 4개
- **[DB] gloss_backup** — 읽는 API 2개 / 쓰는 API 1개
- **[캐시] jgrammar_cache** — 읽는 API 1개 / 쓰는 API 1개
- **[DB] jgrammar_saved** — 읽는 API 1개 / 쓰는 API 2개
- **[DB] review_log** — 읽는 API 0개 / 쓰는 API 1개
- **[DB] speakloop_audio** — 읽는 API 5개 / 쓰는 API 1개
- **[DB] speakloop_progress** — 읽는 API 1개 / 쓰는 API 1개
- **[캐시] tts_cache** — 읽는 API 1개 / 쓰는 API 3개
- **[DB] users** — 읽는 API 104개 / 쓰는 API 3개
- **[DB] voice_concepts** — 읽는 API 0개 / 쓰는 API 0개 (접근하는 API 없음)
- **[DB] voice_image_sets** — 읽는 API 3개 / 쓰는 API 3개
- **[DB] voice_images** — 읽는 API 2개 / 쓰는 API 1개
- **[DB] voice_links** — 읽는 API 9개 / 쓰는 API 7개
- **[DB] voice_notes** — 읽는 API 19개 / 쓰는 API 6개
- **[DB] voice_quiz_attempts** — 읽는 API 3개 / 쓰는 API 1개
- **[DB] voice_quizzes** — 읽는 API 3개 / 쓰는 API 1개
- **[DB] wordbook** — 읽는 API 7개 / 쓰는 API 9개

### 호출 화면 없는 API (5개)
- GET / (공개)
- GET /admin (공개)
- GET /auth/google/callback (공개)
- DELETE /api/tts/cache (관리자)
- GET /api/cmap/status (권한:perm_concept_map)
<!-- gen:end -->

=====================================================================
### 파일: docs/blueprint/screens/admin.md
=====================================================================

---
screen: 관리자
file: public/admin.html
engines: [AI 단어 뜻 변환(Claude Haiku), 저장 음성(Speak Loop), 서버 음성(OpenAI TTS), 서버 메모리 작업 상태]
calls: [GET /api/me, GET /api/admin/users, PATCH /api/admin/users/:id, GET /api/admin/stats, GET /api/admin/speakloop/audio/status, GET /api/admin/speakloop/audio/list, POST /api/admin/speakloop/audio/preview, POST /api/admin/speakloop/audio/generate, GET /api/speakloop/content, GET /api/speakloop/audio/:clipKey, GET /api/admin/gloss/status, POST /api/admin/gloss/sample, POST /api/admin/gloss/run, POST /api/admin/gloss/restore, GET /api/admin/gloss/backup, DELETE /api/tts/cache/entry]
reads: [DB:users, DB:api_usage, DB:wordbook, DB:speakloop_audio, DB:gloss_backup, 파일:speakloop_content, 기기:mydict_token, 기기:gl_last_run]
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
last_checked: 9319dc0
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
- [엔진] 서버 음성(OpenAI TTS): Speak Loop 음성 만들기·미리듣기(`POST /api/admin/speakloop/audio/generate·preview`, routes/speakloop.js:165·132 → lib/speakloop_tts.js:66, 기본 모델 gpt-4o-mini-tts). [엔진] 서버 메모리 작업 상태: 단어 뜻 변환 잠금(routes/gloss.js:51 → lib/gloss_backfill.js:175), 음성 생성 잠금(routes/speakloop.js:177)·미리듣기 횟수 제한(lib/speakloop_tts.js:137).

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
- [파일] →읽기: speakloop_content(data/speakloop/content.json). Speak Loop 음성 현황·목록·미리듣기·생성의 클립 목록을 서버가 이 파일에서 만든다(lib/speakloop_content.js:88, routes/speakloop.js:108·123·135·176).

## 5 연결
- [API] 위 3절(관리자 전용 라우트는 requireAdmin). [외부] Anthropic(뜻 변환 샘플·적용), OpenAI TTS(Speak Loop 음성 생성·미리듣기), Google Fonts.
- [기기] localStorage `mydict_token`(:374), `gl_last_run`(마지막 변환 실행 번호, 읽기 :933, 쓰기 :793).
- [모듈] public/js/common/authGate.js, appHeader.js(관리자일 때만 헤더에 '관리자' 링크, appHeader.js:110).
- 특이점: 발음 캐시 지우기는 tts_cache(서버 음성)만 지운다. Speak Loop 저장 음성(speakloop_audio)은 이 경로로 지워지지 않는다(별도 저장소).
- [파일] speakloop_content(data/speakloop/content.json, LEGEND 9절).

=====================================================================
### 파일: docs/blueprint/screens/artist_notes.md
=====================================================================

---
screen: 작가 노트
file: public/artist_notes.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 파일:artist_notes_db, 기기:mydict_token, 기기:artist_notes_field_filter, 기기:artist_notes_conquest_]
writes: [기기:artist_notes_field_filter, 기기:artist_notes_conquest_]
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token ; →읽기 artist_notes_field_filter,
  분야 필터 | →쓰기 artist_notes_field_filter,
  정복 토글 | →쓰기 artist_notes_conquest_,
  정복 탭 | →읽기 artist_notes_conquest_,
  퀴즈 시작 | →읽기 artist_notes_conquest_,
  홈으로 이동 | →이동 홈
]
requires: [로그인]
navigates: [홈]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 23d581c
---

# 작가 노트 (public/artist_notes.html)

## 1 기능
- 음악·미술 작가 목록(분야 범례로 거름, 캐러셀) → 작가 상세(삶·대표작, 정복하기) → 정복 탭(정복한 작가를 분야별로) → 퀴즈(정복한 작가의 문항). 하단 내비는 홈·정복·퀴즈(:434-437). 한입 독서·과학과 코드·데이터·localStorage 를 공유하지 않는다(키 접두사 `artist_notes_`, :17).
- 접근: 로그인(authGate)만이다. 이 화면에는 기능 권한(perm_*) 확인이 없다(html 안에 `perm_`·권한 fetch 없음; DB 열도 없음 — [확인함] grep).
- 정복·분야 필터 기록은 브라우저 localStorage 에만 저장한다.

## 2 엔진
- 없음. 퀴즈 문항은 데이터 파일의 quiz 배열에서 읽어 정복한 작가 것만 골라 쓴다(quizData :1030, buildQuestions :1058, 문항 설명 :416·:1028). 문항이 비어 있으면 "준비 중"(renderQuiz :1067). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인 →호출 [API] GET /api/me — 이 화면의 스크립트는 직접 부르지 않고, 공통 게이트 authGate.js(:6)와 헤더 appHeader.js(:375, fetchMe :27)가 부른다 → routes/auth.js:101 →읽기 [DB] users(middleware/auth.js:30 인증, routes/auth.js:120) →읽기 [기기] mydict_token, artist_notes_field_filter(:448, 초기 분야 필터 읽기). 데이터는 로그인 확인과 별개로 loadDB(:529)가 바로 읽는다(권한 대기 없음).
- 분야 필터 →쓰기 [기기] artist_notes_field_filter — 범례를 누르면 setFieldFilter(:563)가 저장하고 같은 분야를 다시 누르면 지운다(lsSet :450).
- 정복 토글 →쓰기 [기기] artist_notes_conquest_<작가 id>(:470) — 상세의 정복 버튼 toggleConquest(:987) → setConquered(:470). 서버 호출 없음.
- 정복 탭 →읽기 [기기] artist_notes_conquest_ — onTab('conq')(:997) → renderAndShowConq(:1025) → renderConq(:1012, getConqueredArtists :471).
- 퀴즈 시작 →읽기 [기기] artist_notes_conquest_ — 퀴즈 탭 → startQuizFlow(:1072)가 정복 작가를 읽어 문항을 고른다. 정복이 0명이면 안내만 한다(:1076-1079). 점수는 저장하지 않는다.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고(appHeader.js:129). 하단 내비의 "홈" 탭은 이 화면의 작가 목록이다(onTab :997 → showListView :497).

## 4 DB
- →읽기: [DB] users(로그인·승인 확인용 /api/me).
- →쓰기: 없음(DB).
- 기기 저장값: localStorage `mydict_token`(읽기), `artist_notes_field_filter`(:448), `artist_notes_conquest_<id>`(:468-470, 값 'true'/'false'). 읽기·쓰기는 try/catch 로 감싸 저장소를 못 쓰는 환경에서도 멈추지 않는다(lsGet/lsSet :449-450).
- 정적 파일(DB 아님): `GET /artist_notes_db.json`(fetch 'artist_notes_db.json', :531)을 express.static 이 보낸다(server.js:57). 최상위 키 version·last_updated·artists(12명)·quiz(42문항). 파일 저장소 후보: 작가 노트 → public/artist_notes_db.json.
- [파일] →읽기: artist_notes_db(public/artist_notes_db.json, 화면이 fetch 한다 :531). 정적 파일이라 서버 라우트 없이 express.static 이 보낸다(server.js:57).

## 5 연결
- [API] GET /api/me(게이트·헤더 경유). [외부] Google Fonts(:11).
- [모듈] authGate.js(:6), appHeader.js(:375), dialog.js(:377).
- [이동] 작가 노트 →이동 홈.
- [미확인] 작가 상세·캐러셀 표시 규칙(:929 이후)과 문항 선택 세부(pickBalanced :1044).
- [파일] artist_notes_db(public/artist_notes_db.json, LEGEND 9절).

=====================================================================
### 파일: docs/blueprint/screens/concept_map.md
=====================================================================

---
screen: 개념 지도
file: public/concept_map.html
engines: [AI 개념 지도 처리(Claude Haiku), 기기 PDF 저장(캔버스), 음성 인식(OpenAI STT), 서버 메모리 작업 상태]
calls: [GET /api/me, GET /api/cmap/topics, POST /api/cmap/topics, PATCH /api/cmap/topics/:id, POST /api/cmap/topics/:id/move, DELETE /api/cmap/topics/:id, POST /api/cmap/topics/:id/explain, GET /api/cmap/topics/:id/concepts, POST /api/cmap/topics/:id/concepts, PATCH /api/cmap/concepts/:id, PUT /api/cmap/concepts/:id/mark, POST /api/cmap/concepts/:id/deepen, DELETE /api/cmap/concepts/:id, GET /api/cmap/topics/:rootId/map, POST /api/cmap/maps/:id/nodes, DELETE /api/cmap/maps/:id/nodes/:conceptId, PATCH /api/cmap/maps/:id/nodes/:conceptId, POST /api/cmap/maps/:id/edges, POST /api/cmap/maps/:id/edges/bulk, PATCH /api/cmap/edges/:id, DELETE /api/cmap/edges/:id, POST /api/cmap/maps/:id/save, PUT /api/cmap/maps/:id/positions, GET /api/cmap/maps/:id/narration, POST /api/cmap/maps/:id/narrate, GET /api/cmap/maps/:id/quiz/marked-info, POST /api/cmap/maps/:id/quiz/start, POST /api/cmap/maps/:id/quiz/submit, POST /api/cmap/concepts/:id/answer/voice, POST /api/cmap/concepts/:id/answer/text, GET /api/cmap/answers/recent, GET /api/cmap/maps/:id/answer-targets]
reads: [DB:users, DB:api_usage, DB:cmap_topics, DB:cmap_concepts, DB:cmap_maps, DB:cmap_map_nodes, DB:cmap_edges, DB:cmap_concept_marks, DB:cmap_narrations, DB:cmap_answer_attempts, 기기:mydict_token]
writes: [DB:api_usage, DB:cmap_concepts, DB:cmap_maps, DB:cmap_edges, DB:cmap_topics, DB:cmap_map_nodes, DB:cmap_concept_marks, DB:cmap_narrations, DB:cmap_quiz_attempts, DB:cmap_answer_attempts]
fallback: []
flows: [
  개념 검색 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/topics/:id/explain ; →읽기 cmap_topics ; →읽기 cmap_concepts ; →읽기 api_usage ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage ; →쓰기 cmap_concepts,
  개념 누르면 설명 팝업 | →호출 GET /api/cmap/topics/:rootId/map ; →읽기 cmap_concepts,
  지도 저장 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/save ; →읽기 cmap_maps ; →읽기 cmap_map_nodes ; →읽기 cmap_edges ; →쓰기 cmap_maps,
  PDF 저장 | →호출 기기 PDF 저장(캔버스),
  연결 만들기 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/edges ; →읽기 cmap_maps ; →읽기 cmap_map_nodes ; →읽기 cmap_edges ; →쓰기 cmap_edges,
  주제 만들기·이름 바꾸기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/topics ; →호출 POST /api/cmap/topics ; →호출 PATCH /api/cmap/topics/:id ; →읽기 cmap_concepts ; →읽기 cmap_topics ; →쓰기 cmap_topics,
  주제 이동·삭제 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/topics/:id/move ; →호출 DELETE /api/cmap/topics/:id ; →읽기 cmap_concepts ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_topics ; →쓰기 cmap_maps ; →쓰기 cmap_topics ; →쓰기 cmap_concepts,
  개념 직접 추가·고치기·지우기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/topics/:id/concepts ; →호출 POST /api/cmap/topics/:id/concepts ; →호출 PATCH /api/cmap/concepts/:id ; →호출 DELETE /api/cmap/concepts/:id ; →읽기 cmap_concepts ; →읽기 cmap_topics ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →쓰기 cmap_concepts ; →쓰기 cmap_edges ; →쓰기 cmap_map_nodes ; →쓰기 cmap_maps,
  개념 심화 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/concepts/:id/deepen ; →읽기 api_usage ; →읽기 cmap_concepts ; →읽기 cmap_topics ; →쓰기 api_usage ; →쓰기 cmap_concepts ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku),
  모르는 개념 표시 | →필요 권한:perm_concept_map ; →호출 PUT /api/cmap/concepts/:id/mark ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →쓰기 cmap_concept_marks,
  지도 열기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/topics/:rootId/map ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_topics ; →쓰기 cmap_maps,
  지도에 개념 넣기·빼기·옮기기·배치 최적화 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/nodes ; →호출 DELETE /api/cmap/maps/:id/nodes/:conceptId ; →호출 PATCH /api/cmap/maps/:id/nodes/:conceptId ; →호출 PUT /api/cmap/maps/:id/positions ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_topics ; →쓰기 cmap_map_nodes ; →쓰기 cmap_edges,
  연결 고치기·지우기·한꺼번에 만들기 | →필요 권한:perm_concept_map ; →호출 PATCH /api/cmap/edges/:id ; →호출 DELETE /api/cmap/edges/:id ; →호출 POST /api/cmap/maps/:id/edges/bulk ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →쓰기 cmap_edges,
  지도 해설 보기·만들기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/narration ; →호출 POST /api/cmap/maps/:id/narrate ; →읽기 api_usage ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_narrations ; →읽기 cmap_topics ; →쓰기 api_usage ; →쓰기 cmap_narrations ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 서버 메모리 작업 상태 ; →호출 Anthropic API(Claude Haiku),
  연결 퀴즈 풀기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/quiz/marked-info ; →호출 POST /api/cmap/maps/:id/quiz/start ; →호출 POST /api/cmap/maps/:id/quiz/submit ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →쓰기 cmap_quiz_attempts,
  말로 설명하기(음성) | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/answer-targets ; →호출 POST /api/cmap/concepts/:id/answer/voice ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_maps ; →읽기 cmap_topics ; →읽기 api_usage ; →쓰기 api_usage ; →쓰기 cmap_answer_attempts ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 음성 인식(OpenAI STT) ; →호출 Anthropic API(Claude Haiku) ; →호출 OpenAI STT(음성 인식),
  말로 설명하기(글로 입력) | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/answer-targets ; →호출 POST /api/cmap/concepts/:id/answer/text ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_maps ; →읽기 cmap_topics ; →읽기 api_usage ; →쓰기 api_usage ; →쓰기 cmap_answer_attempts ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku),
  오답노트 보기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/answers/recent ; →읽기 cmap_answer_attempts ; →읽기 cmap_concepts
]
requires: [로그인, 권한:perm_concept_map]
navigates: [홈]
externals: [Anthropic API(Claude Haiku), Google Fonts, OpenAI STT(음성 인식)]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js]
last_checked: 9319dc0
---

# 개념 지도 (public/concept_map.html)

> **범위(B-006): 코드 기준으로 넓힌 도면이다.** 이 화면이 부르는 `/api/cmap/**` 31개 전부와 사용자가 누르는 동작 18개(처음 5개 + 추가 13개)를 적었다. 이 화면에 "해설 읽어주기"(소리 재생)는 코드에 없다(public/concept_map.html·public/js/cmap/*.js 에 speechSynthesis·/api/tts 호출 0건, 해설은 글로만 보여 준다: public/js/cmap/narrateView.js). `GET /api/cmap/status`(routes/concept_map.js:33)는 화면이 부르지 않는다.

## 1 기능
- 이 도면이 다루는 것: 주제 탭(주제 만들기·이름·이동·삭제, 개념 직접 입력·심화·검색), 지도 만들기 탭(지도 열기·개념 넣고 빼기·연결·저장·PDF·해설·모르는 개념 표시), 퀴즈 탭(연결 퀴즈·말로 설명하기), 오답노트 탭. 아래 3절에 동작 18개.
- 접근: 로그인 + `users.perm_concept_map` 이 명시적으로 true 인 계정만(fail-closed).

## 2 엔진
- [엔진] AI 개념 지도 처리(Claude Haiku): 개념 검색은 `POST /api/cmap/topics/:id/explain` → `AI.callExplainAI`(lib/cmap_ai.js:261)가 Anthropic SDK(:265)로 모델 CMAP_MODEL claude-haiku-4-5-20251001(:11)을 부른다. 심화(routes/concept_map.js:468)·해설(lib/cmap_narrate.js:154)·서술 평가(lib/cmap_answer.js:81)도 같은 모델이지만 이번 도면 범위 밖이다. 하루 한도 AI.countToday(lib/cmap_ai.js:43) 초과는 429(routes/concept_map.js:318).
- [엔진] 기기 PDF 저장(캔버스): 서버 호출 없음. 화면의 지도 SVG를 캔버스에 그려 JPEG(public/js/cmap/mapPdf.js:164)로 만들고 최소 PDF 바이트로 묶어(:167) 파일로 내려받는다. 공유 시트는 쓰지 않는다(451). 대체 경로 없음.
- [엔진] 음성 인식(OpenAI STT): `POST /api/cmap/concepts/:id/answer/voice` 가 녹음을 STT.transcribe 로 글자로 바꾼다(routes/concept_map.js:1001 → lib/cmap_stt.js:45, 사용량 기록 :57). 평가는 AI 개념 지도 처리(lib/cmap_answer.js:82), 해설은 lib/cmap_narrate.js:155.
- [엔진] 서버 메모리 작업 상태: 같은 지도의 해설을 동시에 두 번 만들지 않게 하는 narrating 집합(routes/concept_map.js:857). 서버를 다시 시작하면 사라진다.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- [화면] 개념 지도 →호출 [API] GET /api/me — public/concept_map.html:571 → routes/auth.js:101. →필요 로그인·권한:perm_concept_map(화면은 /api/me 결과의 perm 이 true 일 때만 보여 준다, :565). 모든 /api/cmap 라우트는 guard(routes/concept_map.js:31 = requireAuth + requireCmapPerm :18).
- 개념 검색 →호출 [API] POST /api/cmap/topics/:id/explain — 검색 폼 제출(concept_map.html:1126) → api 호출(:1074) → routes/concept_map.js:296. →읽기 [DB] cmap_topics(loadTopics :92)·cmap_concepts(:304), api_usage(하루 한도 :318), →호출 [엔진] AI 개념 지도 처리 →호출 [외부] Anthropic API →쓰기 [DB] api_usage(trackUsage lib/cmap_ai.js:278)·cmap_concepts(INSERT :347). 같은 이름의 개념이 이미 있으면 AI를 부르지 않고 기존 개념을 돌려준다(:316, 200 existing).
- 개념 누르면 설명 팝업 — 누를 때 서버 호출은 없다. 편집 시트를 열 때 받은 `GET /api/cmap/topics/:rootId/map`(public/js/cmap/mapView.js:297 open → routes/concept_map.js:558) 응답의 concepts[].brief(:582, briefOf :414)를 쓴다. 첫 선택 시 onFirst(mapView.js:310)가 briefId를 정하고 renderBrief(:237)가 이름+설명을 그리며 placeBrief(:162)가 그 노드 아래(없으면 위)에 놓는다. 팝업을 누르면 hideBrief(:236, 리스너 :789)로 팝업만 닫히고 선택은 유지된다. →읽기 [DB] cmap_concepts(treeOfMap :553). 이 GET은 지도가 없으면 cmap_maps를 만든다(:568, →쓰기 cmap_maps이지만 팝업 동작의 일은 아님).
- 지도 저장 →호출 [API] POST /api/cmap/maps/:id/save — 저장 단추(mapView.js:813) → save()(:592, 호출 :596) → routes/concept_map.js:767. →읽기 [DB] cmap_maps(ownMap :541), cmap_map_nodes·cmap_edges(graphOf :529) →쓰기 [DB] cmap_maps(semantic_hash·saved_at, :773).
- PDF 저장 →호출 [엔진] 기기 PDF 저장(캔버스) — 단추(mapView.js:791) → pdfSave(:278) → CmapPdf.make → deliver(mapPdf.js:173: createObjectURL → a[download] 클릭 → 10초 뒤 revoke). 요청 없음, 지도 데이터·저장 상태는 바꾸지 않는다. 끝나면 "PDF를 저장했어요"를 #map-note에 3초 보인다(mapView.js:286).
- 연결 만들기 →호출 [API] POST /api/cmap/maps/:id/edges — 두 노드를 차례로 눌러 연결 대화상자(onPair :429 → openEdgeDialog :435)에서 확인하면 api 호출(:487) → routes/concept_map.js:659. →읽기 [DB] cmap_maps(ownMap), cmap_map_nodes(:670), cmap_edges(:672) →쓰기 [DB] cmap_edges(insertEdge :651, INSERT :653).
- 아래는 B-006 에서 추가한 동작이다. `:N` 은 routes/concept_map.js 의 줄, 그 밖의 파일은 이름을 붙였다. 읽기·쓰기 줄은 api.md 행의 근거와 같다. [확인함]
- **주제 만들기·이름 바꾸기** — 주제 탭의 "주제 추가"·"하위 주제 추가"·"이름 변경". (7단계)
  - →호출 [API] GET /api/cmap/topics — 화면 public/concept_map.html:636 → routes/concept_map.js:111 / →읽기 cmap_topics(:92), cmap_concepts(:96)
  - →호출 [API] POST /api/cmap/topics — 화면 public/concept_map.html:746 → routes/concept_map.js:118 / →읽기 cmap_topics(:92) / →쓰기 cmap_topics(INSERT :131)
  - →호출 [API] PATCH /api/cmap/topics/:id — 화면 public/concept_map.html:784 → routes/concept_map.js:138 / →읽기 cmap_topics(:92) / →쓰기 cmap_topics(UPDATE :149)
- **주제 이동·삭제** — 주제 탭의 "이동"·"삭제"(삭제는 확인 대화상자 뒤). (10단계)
  - →호출 [API] POST /api/cmap/topics/:id/move — 화면 public/concept_map.html:813 → routes/concept_map.js:154 / →읽기 cmap_topics(:92), cmap_concepts·cmap_maps·cmap_map_nodes(usedInMaps :516-522) / →쓰기 cmap_maps(DELETE :179, 최상위를 옮길 때), cmap_topics(UPDATE :182, :187)
  - →호출 [API] DELETE /api/cmap/topics/:id — 화면 public/concept_map.html:855, public/concept_map.html:873 → routes/concept_map.js:193 / →읽기 cmap_topics(:92), cmap_concepts(:206, :229), cmap_maps(:231) / →쓰기 cmap_topics(UPDATE :220, DELETE :223,238,239), cmap_concepts(UPDATE :222, DELETE :237), cmap_maps(DELETE :236)
- **개념 직접 추가·고치기·지우기** — 주제 탭의 "개념 추가"와 개념 카드의 고치기·지우기. (14단계)
  - →호출 [API] GET /api/cmap/topics/:id/concepts — 화면 public/concept_map.html:647 → routes/concept_map.js:353 / →읽기 cmap_topics(ownTopic :287), cmap_concepts(:357)
  - →호출 [API] POST /api/cmap/topics/:id/concepts — 화면 public/concept_map.html:1047 → routes/concept_map.js:361 / →읽기 cmap_topics(ownTopic :287), cmap_concepts(:368) / →쓰기 cmap_concepts(INSERT :373)
  - →호출 [API] PATCH /api/cmap/concepts/:id — 화면 public/concept_map.html:1007, public/concept_map.html:1046 → routes/concept_map.js:381 / →읽기 cmap_concepts(:388, :392) / →쓰기 cmap_concepts(UPDATE :405)
  - →호출 [API] DELETE /api/cmap/concepts/:id — 화면 public/concept_map.html:1140 → routes/concept_map.js:484 / →읽기 cmap_concepts(:488), cmap_maps(:491), cmap_map_nodes(:494), cmap_edges(:496) / →쓰기 cmap_edges(DELETE :497), cmap_map_nodes(DELETE :498), cmap_maps(UPDATE :499), cmap_concepts(DELETE :502; 표시·풀이는 FK CASCADE lib/db.js:506,536)
- **개념 심화** — 개념 카드의 "심화" 단추(AI 가 심화 개념을 하나 더 만든다). (9단계)
  - →호출 [API] POST /api/cmap/concepts/:id/deepen — 화면 public/concept_map.html:940 → routes/concept_map.js:445 / →읽기 cmap_concepts(:448, :472), cmap_topics(:462), api_usage(lib/cmap_ai.js:44) / →쓰기 cmap_concepts(UPDATE :478), api_usage(lib/db.js:729 trackUsage) via lib/cmap_ai.js:278 / AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_ai.js:266
- **모르는 개념 표시** — 지도에서 개념을 눌러 "모르는 개념"으로 표시·해제. (5단계)
  - →호출 [API] PUT /api/cmap/concepts/:id/mark — 화면 public/js/cmap/mapView.js:199, public/js/cmap/mapView.js:953 → routes/concept_map.js:422 / →읽기 cmap_concepts(:427), cmap_concept_marks(:433) / →쓰기 cmap_concept_marks(DELETE :430 / INSERT :435)
- **지도 열기** — 지도 만들기 탭(편집 시트 열기). 지도가 없으면 이때 만들어진다. (9단계)
  - →호출 [API] GET /api/cmap/topics/:rootId/map — 화면 public/js/cmap/mapView.js:297 → routes/concept_map.js:558 / →읽기 cmap_topics(:562), cmap_maps(:566), cmap_map_nodes(:571), cmap_edges(:572), cmap_concept_marks(:576), cmap_concepts(treeOfMap :553) / →쓰기 cmap_maps(INSERT :568 — 지도가 없으면 만든다. GET 인데 쓴다)
- **지도에 개념 넣기·빼기·옮기기·배치 최적화** — 개념 고르기 패널·노드 끌기·"배치 최적화"의 적용·되돌리기. (12단계)
  - →호출 [API] POST /api/cmap/maps/:id/nodes — 화면 public/js/cmap/mapView.js:377 → routes/concept_map.js:589 / →읽기 cmap_maps(ownMap :542), cmap_map_nodes(:598), cmap_concepts(treeOfMap :553), cmap_topics(:549), cmap_edges(statusOf → graphOf :531) / →쓰기 cmap_map_nodes(INSERT :601)
  - →호출 [API] DELETE /api/cmap/maps/:id/nodes/:conceptId — 화면 public/js/cmap/mapView.js:385, public/js/cmap/mapView.js:394 → routes/concept_map.js:607 / →읽기 cmap_maps(ownMap :542), cmap_map_nodes(:613), cmap_edges(:615) / →쓰기 cmap_edges(DELETE :620), cmap_map_nodes(DELETE :621)
  - →호출 [API] PATCH /api/cmap/maps/:id/nodes/:conceptId — 화면 public/js/cmap/mapView.js:877 → routes/concept_map.js:627 / →읽기 cmap_maps(ownMap :542) / →쓰기 cmap_map_nodes(UPDATE :634)
  - →호출 [API] PUT /api/cmap/maps/:id/positions — 화면 public/js/cmap/mapView.js:630 → routes/concept_map.js:780 / →읽기 cmap_maps(ownMap :542) / →쓰기 cmap_map_nodes(UPDATE :801)
- **연결 고치기·지우기·한꺼번에 만들기** — 연결 대화상자의 "방향 바꾸기"·"연결 삭제"와 "여러 개에 한 번에 연결". (8단계)
  - →호출 [API] PATCH /api/cmap/edges/:id — 화면 public/js/cmap/mapView.js:488 → routes/concept_map.js:718 / →읽기 cmap_edges(:731) / →쓰기 cmap_edges(UPDATE :746)
  - →호출 [API] DELETE /api/cmap/edges/:id — 화면 public/js/cmap/mapView.js:471 → routes/concept_map.js:752 / →읽기 cmap_edges(:756) / →쓰기 cmap_edges(DELETE :759)
  - →호출 [API] POST /api/cmap/maps/:id/edges/bulk — 화면 public/js/cmap/mapView.js:552 → routes/concept_map.js:683 / →읽기 cmap_maps(ownMap :542), cmap_map_nodes(:702), cmap_edges(:705) / →쓰기 cmap_edges(INSERT :653)
- **지도 해설 보기·만들기** — 지도 만들기 탭의 해설 화면(저장된 해설 보기, "해설 만들기"). (15단계)
  - →호출 [API] GET /api/cmap/maps/:id/narration — 화면 public/js/cmap/narrateView.js:29 → routes/concept_map.js:829 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(narrationContext :814-817), cmap_narrations(:834), api_usage(:836 → lib/cmap_ai.js:44), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531)
  - →호출 [API] POST /api/cmap/maps/:id/narrate — 화면 public/js/cmap/narrateView.js:43 → routes/concept_map.js:846 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(narrationContext :814-817), api_usage(:854 → lib/cmap_ai.js:44), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531) / →쓰기 cmap_narrations(DELETE :865, INSERT :866), api_usage(lib/db.js:729 trackUsage) via lib/cmap_narrate.js:163 / AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_narrate.js:155
- **연결 퀴즈 풀기** — 퀴즈 탭의 연결 퀴즈(전체 / 모르는 개념만). (10단계)
  - →호출 [API] GET /api/cmap/maps/:id/quiz/marked-info — 화면 public/js/cmap/reviewView.js:26 → routes/concept_map.js:904 / →읽기 cmap_maps(ownMap :542), cmap_concept_marks(:899), cmap_concepts(:910), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531)
  - →호출 [API] POST /api/cmap/maps/:id/quiz/start — 화면 public/js/cmap/reviewView.js:90 → routes/concept_map.js:916 / →읽기 cmap_maps(ownMap :542), cmap_concepts(savedGraph :886), cmap_concept_marks(:899), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531)
  - →호출 [API] POST /api/cmap/maps/:id/quiz/submit — 화면 public/js/cmap/reviewView.js:131 → routes/concept_map.js:937 / →읽기 cmap_maps(ownMap :542), cmap_concepts(:886), cmap_concept_marks(:899), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531) / →쓰기 cmap_quiz_attempts(INSERT :957)
- **말로 설명하기(음성)** — 퀴즈 탭의 말로 설명하기: 녹음 → 음성 인식 → AI 평가. (14단계)
  - →호출 [API] GET /api/cmap/maps/:id/answer-targets — 화면 public/js/cmap/answerView.js:26, public/js/cmap/answerView.js:79 → routes/concept_map.js:1033 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(treeOfMap :549-553), cmap_concept_marks(:1038)
  - →호출 [API] POST /api/cmap/concepts/:id/answer/voice — 화면 public/js/cmap/answerView.js:113 → routes/concept_map.js:993 / →읽기 cmap_concepts(answerTarget :973), api_usage(:980 → lib/cmap_ai.js:44) / →쓰기 cmap_answer_attempts(INSERT :988), api_usage(lib/db.js:729 trackUsage) via lib/cmap_stt.js:57, lib/cmap_answer.js:90 / 음성 인식(OpenAI STT) / OpenAI STT(음성 인식) — lib/cmap_stt.js:45 ; AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_answer.js:82
- **말로 설명하기(글로 입력)** — 퀴즈 탭의 말로 설명하기를 글로 입력 → AI 평가. (12단계)
  - →호출 [API] GET /api/cmap/maps/:id/answer-targets — 화면 public/js/cmap/answerView.js:26, public/js/cmap/answerView.js:79 → routes/concept_map.js:1033 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(treeOfMap :549-553), cmap_concept_marks(:1038)
  - →호출 [API] POST /api/cmap/concepts/:id/answer/text — 화면 public/js/cmap/answerView.js:125 → routes/concept_map.js:1007 / →읽기 cmap_concepts(:973), api_usage(:980 → lib/cmap_ai.js:44) / →쓰기 cmap_answer_attempts(INSERT :988), api_usage(lib/db.js:729 trackUsage) via lib/cmap_answer.js:90 / AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_answer.js:82
- **오답노트 보기** — 오답노트 탭(최근 부족한 설명 목록). (4단계)
  - →호출 [API] GET /api/cmap/answers/recent — 화면 public/js/cmap/answerView.js:26 → routes/concept_map.js:1020 / →읽기 cmap_answer_attempts(:1021), cmap_concepts(:1024)


## 4 DB
- →읽기: [DB] users(권한 확인 routes/concept_map.js:21), api_usage(하루 한도), cmap_topics, cmap_concepts, cmap_maps, cmap_map_nodes, cmap_edges, cmap_concept_marks(지도 조회 :576), cmap_narrations(해설 보기 :834), cmap_answer_attempts(오답노트 :1021).
- →쓰기: [DB] api_usage(AI 설명·해설·평가·음성 인식 사용량), cmap_topics(:131,149,182,223), cmap_concepts(:346,373,405,478,502), cmap_maps(:179,236,499,568,773), cmap_map_nodes(:601,621,634,801), cmap_edges(:497,620,653,746,759), cmap_concept_marks(:430,435), cmap_narrations(:865-866), cmap_quiz_attempts(:957), cmap_answer_attempts(:988).
- 결과가 쌓이는 곳: 개념·설명은 cmap_concepts, 지도 저장 상태는 cmap_maps, 연결은 cmap_edges. DB 없으면 권한 확인에서 403(:19).
- [확인함] cmap_narrations(해설)·cmap_quiz_attempts(퀴즈 점수)·cmap_answer_attempts(말로 설명하기 평가)는 각각 위 동작에서 쓰인다(줄 번호는 위 3절과 api.md).

## 5 연결
- [API] 위 3절. [외부] Anthropic(개념 검색·심화·해설·평가), OpenAI STT(말로 설명하기 음성 인식, lib/cmap_stt.js:45), Google Fonts(concept_map.html:11).
- [기기] localStorage `mydict_token`(concept_map.html:563). PDF 저장은 파일 다운로드이며 기기 저장값을 쓰지 않는다.
- [모듈] public/js/common/authGate.js, appHeader.js. 이 화면 전용 스크립트(public/js/cmap/*.js)는 공용이 아니라서 머리말 modules에 적지 않는다.
- [이동] 개념 지도 →이동 홈(concept_map.html:324 "METIS 홈으로", :1262 location.href = '/').
- [미확인] iOS 설치 앱(홈 화면 웹앱)에서 a[download]로 PDF가 실제로 저장되는지(자동 시험 불가).

=====================================================================
### 파일: docs/blueprint/screens/dictionary.md
=====================================================================

---
screen: 사전
file: public/english_dictionary.html
engines: [AI 사전·단어 질의(Claude Haiku), 서버 음성(OpenAI TTS), 기기 음성(speechSynthesis), 기기 글자 인식(Tesseract.js), 간격 반복 복습(SM-2)]
calls: [GET /api/me, POST /api/ai, GET /api/wordbook, POST /api/wordbook, DELETE /api/wordbook/:id, PATCH /api/wordbook/:id/example, PATCH /api/wordbook/:id/it, DELETE /api/wordbook/:id/it, POST /api/quiz-correct, GET /api/review-due, POST /api/review-result, POST /api/tts]
reads: [DB:users, DB:wordbook, DB:api_usage, 캐시:tts_cache, 파일:ocr_word_list, 기기:mydict_token, 기기:mydict_wrong, 기기:metis_tts_mode, 기기:spellrun_landing_count]
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
externals: [Anthropic API(Claude Haiku), OpenAI TTS(음성 합성), Google Fonts, jsDelivr(tesseract.js), Google 로그인(OAuth)]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js, public/js/ocr/ocrScanner.js]
last_checked: 9319dc0
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
- [파일] →읽기: ocr_word_list(public/data/ocr-word-list.txt, 카메라 글자 인식이 영어 단어 목록으로 fetch 한다: public/js/ocr/extractEnglishCandidates.js:195). 정적 파일이다(server.js:57).

## 5 연결
- [API] 위 3절. [외부] Anthropic(/api/ai), OpenAI TTS(/api/tts 캐시 미스일 때만), Google Fonts(:23), jsDelivr tesseract.js 5.1.1(:4812).
- [기기] localStorage `mydict_token`(로그인; 쓰기는 주소 ?token= 처리 :1765), `mydict_wrong`(퀴즈 오답, :1942), `metis_tts_mode`(단어 발음 방식, 스펠링 런과 공용; :4271), `spellrun_landing_count`(스펠링 런 한 번에 풀 단어 수 10|20, :3334; 사전 쪽 키 이름이지만 이름에 spellrun이 들어 있다), sessionStorage `spellrun_ids`(스펠링 런에 넘기는 단어 id). 주소 옵션 `?tts=server|device|reset`.
- [모듈] public/js/common/authGate.js(진입 시 /api/me 1회 확인·401이면 홈), appHeader.js(헤더·로그인 위젯), dialog.js, public/js/ocr/ocrScanner.js(카메라 글자 인식 패널).
- [파일] ocr_word_list(public/data/ocr-word-list.txt, LEGEND 9절).
- [외부] Google 로그인(OAuth): 로그아웃 상태의 로그인 링크가 `/auth/google?next=/english_dictionary.html` 로 간다(public/english_dictionary.html:1553 → routes/auth.js:67).

=====================================================================
### 파일: docs/blueprint/screens/digest_reading.md
=====================================================================

---
screen: 한입 독서
file: public/digest_reading.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 파일:digest_db, 기기:mydict_token, 기기:digest_genre_filter, 기기:digest_conquest_]
writes: [기기:digest_genre_filter, 기기:digest_conquest_]
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →필요 권한:perm_digest_reading ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token ; →읽기 digest_genre_filter,
  장르 필터 | →쓰기 digest_genre_filter,
  정복 토글 | →쓰기 digest_conquest_,
  정복 탭 | →읽기 digest_conquest_,
  퀴즈 시작 | →읽기 digest_conquest_,
  홈으로 이동 | →이동 홈
]
requires: [로그인, 권한:perm_digest_reading]
navigates: [홈]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 23d581c
---

# 한입 독서 (public/digest_reading.html)

## 1 기능
- 작품 목록(장르 범례로 거름, 3D 캐러셀) → 작품 상세(요약, 정복하기) → 정복 탭(정복한 작품을 장르별로) → 퀴즈(정복한 작품에서 객관식·O/X를 만든다). 하단 내비는 홈·정복·퀴즈(:553-556).
- 접근: 로그인(authGate) + `users.perm_digest_reading`. 이 화면의 확인은 명시적 false 일 때만 막는다(:667).
- "정복" 기록은 서버가 아니라 브라우저 localStorage 에만 쌓인다(:582-588).

## 2 엔진
- 없음. 퀴즈 문항은 정복한 작품의 데이터로 브라우저가 만든다(buildQuestions :1308). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인·권한:perm_digest_reading →호출 [API] GET /api/me — loadDB(:672)가 checkPermission(:660, fetch :664 → routes/auth.js:101)을 먼저 부른다 →읽기 [DB] users(routes/auth.js:120) →읽기 [기기] mydict_token(:661), digest_genre_filter(:569). 권한 false 면 데이터 파일을 요청하지 않고 안내(:674-678, :499).
- 장르 필터 →쓰기 [기기] digest_genre_filter — 범례의 장르를 누르면 setGenreFilter(:735)가 같은 장르를 다시 누를 때까지 저장하고 해제하면 지운다(:737-738).
- 정복 토글 →쓰기 [기기] digest_conquest_<작품 id>(키 앞부분 `digest_conquest_`, :587) — 상세의 정복 버튼 toggleConquest(:1282) → setConquered(:586). 서버 호출 없음.
- 정복 탭 →읽기 [기기] digest_conquest_ — onTab('conq')(:1131) → renderAndShowConq(:1159) → renderConq(:1147, getConqueredWorks :590 → isConquered :582).
- 퀴즈 시작 →읽기 [기기] digest_conquest_ — 퀴즈 탭 → startQuizFlow(:1290)가 정복 작품을 읽어 문항을 만든다(buildQuestions :1308). 정복이 0개면 안내만 하고 시작하지 않는다(:1292-1295). 점수는 저장하지 않는다.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고(appHeader.js:129)와 권한 없음 안내의 "METIS 홈으로"(:499). 하단 내비의 "홈" 탭은 이 화면의 작품 목록이다(onTab :1131 → showListView :629).

## 4 DB
- →읽기: [DB] users(권한 확인용 /api/me).
- →쓰기: 없음(DB). 기기 저장값은 위 3절.
- 기기 저장값: localStorage `mydict_token`(읽기), `digest_genre_filter`(:568, 읽기·쓰기·삭제), `digest_conquest_<id>`(:582-588, 작품마다 한 키, 값 'true'/'false').
- 정적 파일(DB 아님): `GET /digest_db.json`(fetch 'digest_db.json', :680)을 express.static 이 보낸다(server.js:57). 최상위 키 version·last_updated·authors·works(132개 작품). 파일 저장소 후보: 한입 독서 → public/digest_db.json.
- [파일] →읽기: digest_db(public/digest_db.json, 화면이 fetch 한다 :680). 정적 파일이라 서버 라우트 없이 express.static 이 보낸다(server.js:57).

## 5 연결
- [API] GET /api/me. [외부] Google Fonts(:11).
- [기기] 위 4절. 다른 읽기 화면과 키 접두사가 다르다(digest_·science_·artist_notes_).
- [모듈] authGate.js(:6), appHeader.js(:483), dialog.js(:485).
- [이동] 한입 독서 →이동 홈.
- [미확인] 상세 화면·캐러셀의 표시 규칙(:1177-1260 이후 렌더링)과 퀴즈 문항 구성 세부.
- [파일] digest_db(public/digest_db.json, LEGEND 9절).

=====================================================================
### 파일: docs/blueprint/screens/home.md
=====================================================================

---
screen: 홈
file: public/home/index.html
engines: []
calls: [GET /api/me, GET /auth/google, GET /auth/google/callback]
reads: [DB:users, 기기:mydict_token]
writes: [DB:users, 기기:mydict_token]
fallback: []
flows: [
  로그인 시작 | →호출 GET /auth/google ; →호출 Google 로그인(OAuth) ; →호출 GET /auth/google/callback ; →쓰기 users ; →쓰기 mydict_token,
  메뉴 선택 | →이동 사전,
  승인 대기 표시 | →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token,
  다시 확인 | →호출 GET /api/me ; →읽기 users,
  로그아웃 | →쓰기 mydict_token,
  관리자 링크 | →호출 GET /api/me ; →이동 관리자
]
requires: []
navigates: [사전, 문학 나침반, 한입 독서, 과학, 음성 학습, 작가 노트, 문장 학습, 개념 지도, Speak Loop, 관리자]
externals: [Google 로그인(OAuth)]
modules: []
last_checked: 49287a8
---

# 홈 (public/home/index.html)

## 1 기능
- 휠(3D 선택기)에서 항목을 고르고 가운데 항목을 누르면 그 화면으로 이동한다. 로그인 상태에 따라 항목이 달라진다: 기본 6개(언어 사전·문학 나침반·한입 독서·과학·음성 학습·작가 노트, home-wheel/src/HomeWheelApp.jsx:8) + 권한자에게만 문장 학습(:23, perm_jgrammar 또는 관리자)·개념 지도(:19, perm_concept_map)·Speak Loop(:26, perm_speakloop 또는 관리자). 로그인 전에는 9개를 모두 보인다(buildOptions :30).
- 로그인 전 화면 아래에 "Google로 로그인", 로그인 후에는 "로그아웃"(관리자는 "관리자" 링크 추가)(:212, :195). 이 화면만 공통 게이트(authGate.js)를 쓰지 않는다(public/home/index.html에 없음).
- 승인 대기·차단 안내: 로그인 콜백이 붙인 `?approval=pending|blocked`(:56) 또는 /api/me 의 403 응답(:68)이면 휠 대신 안내 문구를 보인다(:129).
- 접근: 로그인 없이 열 수 있다. 서버가 `/` 에서 이 파일을 보낸다(server.js:49-51).

## 2 엔진
- 없음. 휠 화면은 서버 호출 없이 브라우저에서 돈다(home-wheel/src/ThreeDWheelPicker.jsx). 소리·글자·AI 엔진을 쓰지 않는다.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 로그인 시작 →호출 [API] GET /auth/google — 로그인 버튼(HomeWheelApp.jsx:212) 또는 로그아웃 상태에서 휠 항목을 누를 때(goTo :86 `/auth/google`) → routes/auth.js:67(passport Google 시작, 비밀값은 환경변수 GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET·GOOGLE_CALLBACK_URL 이름만) →호출 [외부] Google 로그인(OAuth) → [API] GET /auth/google/callback(routes/auth.js:75) →쓰기 [DB] users(INSERT … ON CONFLICT (google_id) DO UPDATE, routes/auth.js:39: 첫 로그인이면 행을 만들고 is_approved 는 ADMIN_EMAILS 계정만 true, 재로그인이면 email·name 갱신·관리자 이메일이면 role=admin). 콜백은 차단 계정이면 `?approval=blocked`(:83), 미승인이면 `?approval=pending`(:86), 그 밖에는 JWT(비밀값 변수 이름 JWT_SECRET, 7일)를 `?token=` 으로 붙여 `/` 로 되돌린다(:89-93). 홈이 그 토큰을 localStorage 에 저장한다(→쓰기 [기기] mydict_token, auth.js:15-20).
- 메뉴 선택 →이동 [화면] 사전 외 — 로그인 상태에서 가운데 항목을 누르면 `window.location.href = target.url`(HomeWheelApp.jsx:86). 이동 대상은 휠에 있는 항목 하나다(도면 머리말 navigates 의 10개 중 하나, 위 1절). 흐름은 대표로 사전만 적었다.
- 승인 대기 표시 →호출 [API] GET /api/me — 열 때 토큰이 있으면 fetchMeResult(auth.js:29)가 부른다(HomeWheelApp.jsx:68 checkMe) → routes/auth.js:101 → requireAuth(middleware/auth.js:30 →읽기 [DB] users: is_approved·is_blocked·role). 403 approval_pending/blocked 면 안내를 보이고, 401 이면 토큰을 지운다(:72). 같은 안내가 `?approval=` 로도 보인다(:56).
- 다시 확인 →호출 [API] GET /api/me — 안내 화면의 [다시 확인](승인 대기이고 토큰이 있을 때만, :75 recheck → :68 checkMe).
- 로그아웃 →쓰기 [기기] mydict_token(삭제) — clearToken(auth.js:24)을 handleLogout(HomeWheelApp.jsx:89)이 부른다. 서버 호출 없음.
- 관리자 링크 →이동 [화면] 관리자 — /api/me 응답의 role 이 admin 일 때만 보이는 링크 `/admin`(HomeWheelApp.jsx:195).

## 4 DB
- →읽기: [DB] users — /api/me 와 requireAuth 가 읽는다(routes/auth.js:120, middleware/auth.js:30).
- →쓰기: [DB] users — 이 화면의 동작이 부르는 서버 쓰기는 두 곳이다. (1) 로그인 콜백의 INSERT/UPSERT(routes/auth.js:39), (2) /api/me 의 관리자 자동 승격 UPDATE(routes/auth.js:127: ADMIN_EMAILS 에 있는데 DB role 이 admin 이 아닐 때만 role='admin'). /api/me 는 모든 화면이 부르므로 (2)는 다른 화면에도 적용되나 도면에는 홈에만 적었다.
- 기기 저장값: localStorage `mydict_token` 읽기·쓰기·삭제(home-wheel/src/auth.js:9-26).
- 홈은 정적 JSON 을 읽지 않는다.

## 5 연결
- [API] 위 3절. [외부] Google 로그인(OAuth).
- 빌드와 소스: 화면은 React + Vite 번들이다. 소스는 저장소의 `home-wheel/`(src/HomeWheelApp.jsx 메뉴·로그인·안내, src/auth.js 토큰·/api/me, src/ThreeDWheelPicker.jsx 휠, src/main.jsx, vite.config.js)이고, 빌드 결과가 `public/home/`(index.html + assets/index-CPcsUBip.js·index-CKBOXxqI.css)다(vite.config.js: base '/home/', outDir '../public/home', emptyOutDir). 번들에 소스와 같은 경로 문자열이 들어 있음을 grep 으로 확인했다(/auth/google·/api/me·approval_pending·mydict_token·/concept_map.html·/admin·"승인 대기중"). 번들 안 코드를 줄 단위로 읽지는 않았다.
- [이동] 홈 →이동 사전·문학 나침반·한입 독서·과학·음성 학습·작가 노트(기본 6개, :8-15), 문장 학습·개념 지도·Speak Loop(권한자·로그인 전, :19-26), 관리자(관리자만, :195).
- [미확인] 휠 조작(드래그·관성) 세부(ThreeDWheelPicker.jsx 525줄은 읽지 않음). 번들이 현재 소스에서 빌드된 것인지(해시 비교 불가; tests/home_bundle.test.js 는 번들 주소 문자열만 확인).

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
### 파일: docs/blueprint/screens/literature_compass.md
=====================================================================

---
screen: 문학 나침반
file: public/literature_compass.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 파일:literature_db, 기기:mydict_token]
writes: []
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →필요 권한:perm_literature_compass ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token,
  어휘 사전 이동 | →이동 사전,
  홈으로 이동 | →이동 홈
]
requires: [로그인, 권한:perm_literature_compass]
navigates: [홈, 사전]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 23d581c
---

# 문학 나침반 (public/literature_compass.html)

## 1 기능
- 시대별 문학 사조 타임라인에서 사조를 골라 브리핑 → 카드(뒤집기) → 퀴즈(짝짓기·O/X·객관식)로 학습한다. 장르 탭(전체·시·소설·수필·희곡, :832)으로 목록을 거른다. 하단 내비는 홈·퀴즈·사전(:690-697).
- 접근: 로그인(authGate) + `users.perm_literature_compass`. 이 화면의 권한 확인은 명시적 false 일 때만 막는다(:805, 토큰 없음·응답 오류는 통과) — 공통 게이트가 로그인을 따로 막는다.
- 읽기 전용 화면이다. 학습 결과·퀴즈 점수는 어디에도 저장하지 않는다(localStorage 키는 mydict_token 읽기뿐, 파일 안 localStorage 호출 :799 한 곳).

## 2 엔진
- 없음. 퀴즈 문항은 데이터에서 매번 브라우저가 만든다(buildQuizData :1173). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인(authGate.js, 토큰 없으면 홈으로) →필요 권한:perm_literature_compass →호출 [API] GET /api/me — loadDB(:810)가 checkPermission(:798)을 먼저 부른다(fetch :802 → routes/auth.js:101) →읽기 [DB] users(routes/auth.js:120 의 perm 열, 인증은 middleware/auth.js:30). 권한이 false 면 데이터 파일을 요청하지 않고 "이용 권한이 없습니다" 안내(:812-816, :590)를 보인다. →읽기 [기기] mydict_token(:799). 정적 파일 읽기는 4절.
- 어휘 사전 이동 →이동 [화면] 사전 — 하단 내비 "사전"(:695) 및 홈 화면의 "어휘 사전 →" 링크(:937)는 `/english_dictionary.html` 로 간다. 서버 호출 없음.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고 `/`(appHeader.js:129)와 권한 없음 안내의 "METIS 홈으로"(:594). 하단 내비의 "홈" 탭(:692)은 이 화면 안의 사조 목록(goHome :960)이지 [화면] 홈이 아니다.
- 사조 브리핑·카드·퀴즈 — 화면 안에서만 전환한다(showBriefing :966, showCards :1012, startQuiz :1259, 퀴즈 목록 :779). 서버·저장소 접근이 없어 흐름에 넣지 않았다(의도적 제외).

## 4 DB
- →읽기: [DB] users(권한 확인용 /api/me, perm_literature_compass).
- →쓰기: 없음.
- 정적 파일(DB 아님): `GET /literature_db.json`(fetch 'literature_db.json', :818)을 express.static 이 public/ 에서 보낸다(server.js:57). 최상위 키 version·last_updated·eras. 파일 저장소 후보: 문학 나침반 → public/literature_db.json.
- [파일] →읽기: literature_db(public/literature_db.json, 화면이 fetch 한다 :818). 정적 파일이라 서버 라우트 없이 express.static 이 보낸다(server.js:57).

## 5 연결
- [API] GET /api/me(위 3절). [외부] Google Fonts(:11).
- [모듈] public/js/common/authGate.js(:6), appHeader.js(:578), dialog.js(:580, 퀴즈 중단 확인 metisConfirm).
- [이동] 문학 나침반 →이동 홈·사전.
- [미확인] 카드 뒤집기·퀴즈 채점의 세부 규칙(1173-1560)은 줄 단위로 읽지 않았다.
- [파일] literature_db(public/literature_db.json, LEGEND 9절).

=====================================================================
### 파일: docs/blueprint/screens/science.md
=====================================================================

---
screen: 과학
file: public/science_reading.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 파일:science_db, 기기:mydict_token, 기기:science_conquest_]
writes: [기기:science_conquest_]
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →필요 권한:perm_science_reading ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token,
  정복 토글 | →쓰기 science_conquest_,
  정복 탭 | →읽기 science_conquest_,
  퀴즈 시작 | →읽기 science_conquest_,
  홈으로 이동 | →이동 홈
]
requires: [로그인, 권한:perm_science_reading]
navigates: [홈]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 23d581c
---

# 과학 (public/science_reading.html)

## 1 기능
- 과목 선택(과목별 개념 수, :1093) → 과목별 캐러셀(:1274) → 개념 상세(:1594, 정복하기) → 정복 탭(정복한 개념을 과목별로) → 퀴즈. 하단 내비는 홈·정복·퀴즈(:556-559). 한입 독서를 복제한 독립 파일이며 코드·데이터·저장 키를 공유하지 않는다(:17).
- 접근: 로그인(authGate) + `users.perm_science_reading`. 확인은 명시적 false 일 때만 막는다(:1196). localStorage 접근 자체가 막힌 환경이면 토큰 없음으로 보고 통과한다(:1190).
- 정복 기록은 브라우저 localStorage 에만 저장한다(서버·DB 없음, :593).

## 2 엔진
- 없음. 퀴즈는 정복한 개념의 데이터(title·one_line·key_points)를 고정 문구와 조합해 브라우저가 만든다(:819, "API·비용 없음" 주석 :642). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인·권한:perm_science_reading →호출 [API] GET /api/me — loadDB(:1201)가 checkPermission(:1186, fetch :1193 → routes/auth.js:101)을 먼저 부른다 →읽기 [DB] users(routes/auth.js:120) →읽기 [기기] mydict_token(:1190). 권한 false 면 데이터 파일을 요청하지 않고 안내(:1203-1207, :485).
- 정복 토글 →쓰기 [기기] science_conquest_<개념 id>(키 앞부분 `science_conquest_`, :597) — 상세의 정복 버튼 toggleConquest(:628) → setConquered(:605). 서버 호출 없음.
- 정복 탭 →읽기 [기기] science_conquest_ — onTab('conq')(:836) → goConq(:862) → renderConq(:846, getConqueredConcepts :614 → isConquered :600).
- 퀴즈 시작 →읽기 [기기] science_conquest_ — 퀴즈 탭 onQuizTab(:879) → startQuizFlow(:891)가 정복 개념을 읽어 문항을 만든다(buildQuestions :819). 정복이 0개면 안내만 한다(:893-896). 점수는 저장하지 않는다.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고(appHeader.js:129)와 권한 없음 안내의 "METIS 홈으로"(:485). 하단 내비의 "홈" 탭은 이 화면의 과목 선택이다(onTab :836 → goConceptsTab :1082).

## 4 DB
- →읽기: [DB] users(권한 확인용 /api/me).
- →쓰기: 없음(DB).
- 기기 저장값: localStorage `mydict_token`(읽기), `science_conquest_<id>`(:597-612, 개념마다 한 키, 값 'true'/'false'). 필터 키는 없다(localStorage 호출은 이 두 종류뿐).
- 정적 파일(DB 아님): `GET /science_db.json`(fetch 'science_db.json', :1209)을 express.static 이 보낸다(server.js:57). 최상위 키 version·last_updated·concepts(32개 개념). 파일 저장소 후보: 과학 → public/science_db.json.
- [파일] →읽기: science_db(public/science_db.json, 화면이 fetch 한다 :1209). 정적 파일이라 서버 라우트 없이 express.static 이 보낸다(server.js:57).

## 5 연결
- [API] GET /api/me. [외부] Google Fonts(:11).
- [모듈] authGate.js(:6), appHeader.js(:469), dialog.js(:471).
- [이동] 과학 →이동 홈. 주소 `?field=`·`?tab=conq` 로 같은 화면 안의 보기를 가리키는 history 이동이 있으나(:832, :1091) 다른 화면으로 가지 않는다.
- [미확인] 캐러셀 표시·관련 개념(related) 규칙의 세부(:664-725, :1274 이후).
- [파일] science_db(public/science_db.json, LEGEND 9절).

=====================================================================
### 파일: docs/blueprint/screens/speak_loop.md
=====================================================================

---
screen: Speak Loop
file: public/speakloop.html
engines: [저장 음성(Speak Loop)]
calls: [GET /api/me, GET /api/speakloop/content, GET /api/speakloop/audio-index, GET /api/speakloop/audio/:clipKey, GET /api/speakloop/progress, POST /api/speakloop/progress]
reads: [DB:users, DB:speakloop_audio, DB:speakloop_progress, 파일:speakloop_content, 기기:mydict_token]
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
last_checked: 23d581c
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
- [파일] →읽기: speakloop_content(data/speakloop/content.json). 화면이 직접 여는 파일이 아니라 서버가 읽어 GET /api/speakloop/content 로 내려준다(lib/speakloop_content.js:88). data/ 는 정적 폴더 밖이다.

## 5 연결
- [API] 위 3절(전부 requireAuth + requireSpeakloopPerm, routes/speakloop.js:28). [외부] Google Fonts(speakloop.html:9-11).
- [기기] localStorage `mydict_token`(app.js:10). 그 밖의 저장값 없음(speakloop 화면 파일에서 localStorage·sessionStorage 사용은 이 1건만 확인).
- [모듈] public/js/common/authGate.js, appHeader.js. 화면 전용 스크립트: public/js/speakloop/{core,player,rec,app,idiom}.js.
- [미확인] 독백 연습 4개 모드 각각의 서버 호출 차이(app.js 전체는 읽지 않음, 호출은 위 6개 API만 grep으로 확인).
- [파일] speakloop_content(data/speakloop/content.json, LEGEND 9절).

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
externals: [OpenAI TTS(음성 합성), Google Fonts, Google 로그인(OAuth)]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 9319dc0
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
- [외부] Google 로그인(OAuth): 토큰이 없으면 "로그인하기" 가 `/auth/google?next=/spelling_run.html` 로 간다(public/js/spellrun/game.js:2877 → routes/auth.js:67).

=====================================================================
### 파일: docs/blueprint/screens/voice_study.md
=====================================================================

---
screen: 음성 학습
file: public/voice_study.html
engines: [음성 인식(OpenAI STT), AI 음성 노트 처리(Claude Haiku), 이미지 생성(OpenAI Images), 기기 음성(speechSynthesis), 서버 메모리 작업 상태]
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
last_checked: 9319dc0
---

# 음성 학습 (public/voice_study.html)

## 1 기능
- 음성 노트: 녹음 → 글자 변환 → 요약 만들기 → 저장·수정·삭제·합치기 · 요약 퀴즈(생성·풀이·기록·오답) · 노트와 대화(chat) · 개념 연결(links)과 연결 지도(map, 자동 연결 만들기) · 노트 요약 이미지(생성·평가) · 요약 읽어주기.

## 2 엔진
- [엔진] 음성 인식(OpenAI STT): `POST /api/voice-notes/transcribe`(녹음 파일을 서버가 OpenAI에 보냄). 모델 기본 gpt-4o-mini-transcribe(routes/voice_study.js:671). 하루 20회 제한(:611). 녹음은 브라우저 MediaRecorder(public/voice_study.html:1417, 1435)로 만든다.
- [엔진] AI 음성 노트 처리(Claude Haiku): 요약(:806)·퀴즈(:978)·대화(:1118)·연결(:1313)·이미지 계획 보조(:1717, :1770)가 같은 모델 SUMMARY_MODEL claude-haiku-4-5 (:705).
- [엔진] 이미지 생성(OpenAI Images): `POST /api/voice-notes/:id/image` → OpenAI images/generations (routes/voice_study.js:1666). 모델 기본값은 환경변수 VOICE_IMAGE_MODEL(:1492).
- [엔진] 기기 음성(speechSynthesis): 요약 읽어주기는 이 엔진만 쓴다(public/voice_study.html:2052 주석: 외부 API·비용 없음). 한국어 음성 선택(koVoiceInfo). 서버 음성(OpenAI TTS)은 쓰지 않는다. 대체 경로 없음.
- [엔진] 서버 메모리 작업 상태: 지도 만들기 진행 상태 mapBuilds(routes/voice_study.js:336)와 같은 자료의 연결 분석 중복 방지 linkInFlight(:1173). 서버를 다시 시작하면 사라진다.

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
