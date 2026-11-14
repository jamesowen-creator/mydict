---
screen: 문장 학습
file: public/jgrammar.html
engines: [AI 문장 해설(Claude Haiku), AI 사진 문장 인식(Claude Haiku), 기기 음성(speechSynthesis)]
apis: [GET /api/me, POST /api/jgrammar/explain, POST /api/jgrammar/ocr, GET /api/jgrammar/saved, DELETE /api/jgrammar/saved/:id]
tables: [users, jgrammar_cache, jgrammar_saved, api_usage]
externals: [Anthropic API(Claude Haiku), Google Fonts]
storage: [localStorage mydict_token, localStorage jgrammar_lang, localStorage jgrammar_furigana, localStorage jgrammar_pinyin, localStorage jgrammar_zh]
last_checked: 1a8e9cd
---

# 문장 학습 (public/jgrammar.html) — 파일명은 jgrammar(일본어 문법), 화면 제목은 "문장 학습"

## 1 기능
- 일본어·영어·중국어(간체·번체) 문장을 넣으면 문법 해설·번역·후리가나(병음) 제공 · 사진에서 문장 인식 · 저장한 문장 목록(언어별 최대 100개) · 읽어주기(듣기·천천히).

## 2 엔진
- AI 문장 해설(Claude Haiku): `POST /api/jgrammar/explain`, lib/jgrammar.js:393 (MODEL claude-haiku-4-5, :12). 같은 문장은 jgrammar_cache에서 꺼내 AI를 다시 부르지 않는다(:324).
- AI 사진 문장 인식(Claude Haiku): `POST /api/jgrammar/ocr`(이미지 바이너리), lib/jgrammar.js:559. 하루 한도는 해설과 합산(:14).
- 기기 음성(speechSynthesis): 읽어주기는 이 엔진만 쓰고 서버로 텍스트를 보내지 않는다(public/jgrammar.html:319 주석, 시험 jgrammar_speech가 확인). 서버 음성은 쓰지 않는다.

## 3 경로
| 동작 | 화면 코드(public/jgrammar.html) | 요청 | 서버 |
|---|---|---|---|
| 로그인 확인 | :187 | GET /api/me | routes/auth.js:101 |
| 분석 | :591 | POST /api/jgrammar/explain | routes/jgrammar.js:64 → lib/jgrammar.js |
| 사진 인식 | :294 | POST /api/jgrammar/ocr?lang= | routes/jgrammar.js:54 → lib/jgrammar.js:559 |
| 저장 목록 | :242 | GET /api/jgrammar/saved?lang= | routes/jgrammar.js:76 |
| 저장 삭제 | :227 | DELETE /api/jgrammar/saved/:id | routes/jgrammar.js:85 |
| 읽어주기 | :426 startSpeech | (요청 없음) 기기 음성 | — |

## 4 DB
- 읽기: users(권한 perm_jgrammar, routes/jgrammar.js:15), jgrammar_cache(같은 문장 결과), jgrammar_saved(저장 목록), api_usage(하루 한도, lib/jgrammar.js:315).
- 쓰기: jgrammar_cache(새 결과 저장, lib/jgrammar.js:348), jgrammar_saved(사용자별 저장 :358, 100개 초과분 삭제 :365), api_usage(해설 'jgrammar'·사진 'jgrammar_ocr' 기록, :401·:570).
- 결과가 쌓이는 곳: 문장 결과는 jgrammar_cache(전 사용자 공용 캐시)와 jgrammar_saved(사용자별).

## 5 연결
- API: 위 표. 외부 서비스: Anthropic(캐시 미스·사진 인식일 때만), Google Fonts.
- 권한: users.perm_jgrammar 가 true인 계정 또는 관리자(routes/jgrammar.js:11-25). 하루 한도 환경변수 JGRAMMAR_DAILY_CAP(lib/jgrammar.js:309).
- 저장값: localStorage `mydict_token`, `jgrammar_lang`(언어, :166), `jgrammar_furigana`·`jgrammar_pinyin`(후리가나·병음 표시, :316), `jgrammar_zh`(마지막 간체/번체, :169). 예전 `jgrammar_structure`는 작업318에서 쓰지 않게 됨(:316 주석). 읽어주기 속도는 코드 상수 SPEAK_RATE(:396)이고 저장값은 없다.
