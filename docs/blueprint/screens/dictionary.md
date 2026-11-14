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
