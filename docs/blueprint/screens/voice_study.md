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
