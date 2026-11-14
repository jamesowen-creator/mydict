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
