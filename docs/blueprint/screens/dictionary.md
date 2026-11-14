---
screen: 사전
file: public/english_dictionary.html
engines: [AI 사전·단어 질의(Claude Haiku), 서버 음성(OpenAI TTS), 기기 음성(speechSynthesis), 기기 글자 인식(Tesseract.js), 간격 반복 복습(SM-2)]
apis: [GET /api/me, POST /api/ai, GET /api/wordbook, POST /api/wordbook, DELETE /api/wordbook/:id, PATCH /api/wordbook/:id/example, PATCH /api/wordbook/:id/it, DELETE /api/wordbook/:id/it, POST /api/quiz-correct, GET /api/review-due, POST /api/review-result, POST /api/tts]
tables: [users, wordbook, review_log, api_usage, tts_cache]
externals: [Anthropic API(Claude Haiku), OpenAI TTS(tts-1-hd), Google Fonts, jsDelivr(tesseract.js)]
storage: [localStorage mydict_token, localStorage mydict_wrong, localStorage metis_tts_mode, 주소 ?tts=server|device|reset, sessionStorage spellrun_ids]
last_checked: 1a8e9cd
---

# 사전 (public/english_dictionary.html)

## 1 기능
- 검색(영·한·일·중 4개 언어 결과 화면) · 단어장 저장·삭제·목록 · 발음 버튼 · 팟캐스트(단어장 연속 듣기) · 퀴즈·복습 · IT 용어 설명 저장 · 카메라 글자 인식 · 선택 단어로 스펠링 런 시작.

## 2 엔진
- AI 사전·단어 질의(Claude Haiku): 검색 결과·IT 설명·퀴즈 주관식 채점·예문 생성을 모두 `POST /api/ai`(프롬프트 문자열) 하나로 보낸다. 모델 claude-haiku-4-5 (routes/dictionary.js:51).
- 서버 음성(OpenAI TTS): 단어 발음 버튼·미리 받기·팟캐스트(문장 포함)가 `POST /api/tts`. 모델 tts-1-hd (routes/tts.js:125). 단어 발음은 `?tts=device`(저장)일 때 쓰지 않는다.
- 기기 음성(speechSynthesis): 서버 음성을 못 쓸 때(토큰 없음·401·403·429·오류·빈 음성)의 대체, 또는 `?tts=device` 선택 시 단독. public/english_dictionary.html:4331.
- 기기 글자 인식(Tesseract.js): 브라우저 안에서만 동작, 서버 호출 없음(public/js/ocr/liveEnglishOcrSession.js:14, 카메라 public/js/ocr/ocrScanner.js:155).
- 간격 반복 복습(SM-2): 서버가 점수로 다음 복습일 계산(routes/wordbook.js:124).

## 3 경로 (동작 → 요청 → 서버 라우트)
| 동작 | 화면 코드(english_dictionary.html) | 요청 | 서버 |
|---|---|---|---|
| 로그인 확인 | :1822 | GET /api/me | routes/auth.js:101 (users 읽기) |
| 검색 | :2098 doSearch → :1917 callAI | POST /api/ai | routes/dictionary.js:26 |
| 단어장 불러오기 | :1863 | GET /api/wordbook | routes/wordbook.js:14 |
| 저장 | :1875 | POST /api/wordbook | routes/wordbook.js:29 |
| 삭제 | :1887 | DELETE /api/wordbook/:id | routes/wordbook.js:51 |
| 예문 저장 | :4208 | PATCH /api/wordbook/:id/example | routes/wordbook.js:67 |
| IT 설명 저장·삭제 | :3083 / :3550 | PATCH·DELETE /api/wordbook/:id/it | routes/wordbook.js:85 / :107 |
| 퀴즈 정답 기록 | :3819 | POST /api/quiz-correct | routes/wordbook.js:186 |
| 복습 대상 | :3898 | GET /api/review-due | routes/wordbook.js:201 |
| 복습 결과 | :4163 | POST /api/review-result | routes/wordbook.js:151 |
| 발음 버튼 | :4373 playTTS → :4347 fetchTtsAudio (fetch :4352) | POST /api/tts | routes/tts.js:72 |
| 미리 받기 | :4465 prefetchTTS (fetch :4470) | POST /api/tts | routes/tts.js:72 |
| 팟캐스트 | :4607 | POST /api/tts | routes/tts.js:72 |
| 스펠링 런 시작 | :3320 startSpellRunSelected | (요청 없음) sessionStorage spellrun_ids → /spelling_run.html | — |

## 4 DB
- 읽기: users(`/api/me`·권한 can_search·can_wordbook·can_tts), wordbook(단어장·복습 대상), tts_cache(발음 캐시 적중), api_usage(하루 한도 계산: ai·tts).
- 쓰기: wordbook(저장·삭제·예문·IT 설명·복습값), review_log(복습 점수, routes/wordbook.js:176), api_usage(ai·tts 사용 기록, tts는 캐시 미스만, routes/tts.js:150), tts_cache(발음 미스 저장, routes/tts.js:143).
- 결과가 쌓이는 곳: 단어장은 wordbook(사용자별). 검색 결과 자체는 단어장에 저장할 때만 wordbook.data 열에 들어간다. [미확인] 검색 결과의 서버 쪽 별도 캐시는 routes/dictionary.js에서 보이지 않음(없는 것으로 보이나 전체 확인은 안 함).

## 5 연결
- API: 위 3절 표. 외부 서비스: Anthropic(/api/ai), OpenAI(/api/tts 캐시 미스일 때만), Google Fonts(:23), jsDelivr tesseract.js 5.1.1(:4812).
- 저장값·주소 옵션: localStorage `mydict_token`(로그인), `mydict_wrong`(퀴즈 오답), `metis_tts_mode`(단어 발음 방식, 스펠링 런과 공용; :4271), `?tts=server|device|reset`, sessionStorage `spellrun_ids`(스펠링 런에 넘기는 단어 id).
- 공용 부품: public/js/common/authGate.js(진입 시 /api/me 1회 확인·401이면 홈), appHeader.js(헤더·로그인 위젯), dialog.js.
