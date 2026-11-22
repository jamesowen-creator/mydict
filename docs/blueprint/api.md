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
