---
screen: 스펠링 런
file: public/spelling_run.html
engines: [스펠링 런 게임 엔진(캔버스), 서버 음성(OpenAI TTS), 기기 음성(speechSynthesis), 2인 대결 방(서버 메모리)]
apis: [GET /api/me, GET /api/wordbook, POST /api/tts, POST /api/versus/rooms, GET /api/versus/rooms, GET /api/versus/rooms/:id, POST /api/versus/rooms/:id/join, POST /api/versus/rooms/:id/start, POST /api/versus/rooms/:id/state, POST /api/versus/rooms/:id/finish, POST /api/versus/rooms/:id/rematch, POST /api/versus/rooms/:id/leave]
tables: [users, wordbook, api_usage, tts_cache]
externals: [OpenAI TTS(tts-1-hd), Google Fonts]
storage: [localStorage mydict_token, localStorage spellrun_opts, localStorage spellrun_mode, localStorage spellrun_preview, localStorage spellrun_view, localStorage spellrun_bgm, localStorage spellrun_char, localStorage spellrun_best, localStorage metis_tts_mode, sessionStorage spellrun_ids, 주소 ?tts=server|device|reset, 주소 점검 옵션 ttsdebug·judgedebug]
last_checked: 1a8e9cd
---

# 스펠링 런 (public/spelling_run.html) — 내부 게임 로직은 쓰지 않고 공용 엔진·API·DB 연결만

## 1 기능
- 사전 단어장에서 고른 영어 단어로 하는 철자 게임(혼자 · 2인 대결) · 시작 전 단어 미리 보기 · 단어 발음 · 결과 화면.

## 2 엔진
- 스펠링 런 게임 엔진(캔버스): public/js/spellrun/logic.js(순수 로직) + game.js(그리기·입력·소리). 이 화면 전용, 서버 호출 없음.
- 서버 음성(OpenAI TTS): 게임·미리 보기·결과 칩의 단어 발음. `POST /api/tts`(lang en). 판 시작 때 단어를 미리 받는다(game.js:567 prefetchRound).
- 기기 음성(speechSynthesis): 서버 음성 실패·`?tts=device`(저장) 때의 대체/단독(game.js:412 speakBuiltin).
- 2인 대결 방(서버 메모리): 방은 서버 메모리에만 있고 DB에 저장하지 않는다(routes/versus.js, lib/versus.js). perm_versus 권한 필요.

## 3 경로
| 동작 | 화면 코드(public/js/spellrun/game.js) | 요청 | 서버 |
|---|---|---|---|
| 시작 확인 | :2876 boot (fetch :2881) | GET /api/me | routes/auth.js:101 |
| 선택 단어 읽기 | :2893 (id 목록은 :2096 readIds ← sessionStorage spellrun_ids) | GET /api/wordbook | routes/wordbook.js:14 |
| 단어 출제 | :2080 pickWords | (요청 없음, 받은 행에서 영어 단어만 고름) | — |
| 단어 발음 | :537 pronounce → :492 getServerAudio (fetch :498) | POST /api/tts | routes/tts.js:72 |
| 발음 미리 받기 | :567 prefetchRound | POST /api/tts | routes/tts.js:72 |
| 대결 | :2315 vsApi (fetch :2317) | /api/versus/rooms… | routes/versus.js:52 (rooms 만들기)~:93 (leave) |

## 4 DB
- 읽기: users(/api/me·권한 can_wordbook·perm_versus), wordbook(선택 단어), tts_cache(발음 캐시 적중), api_usage(발음 한도).
- 쓰기: 이 화면은 wordbook에 쓰지 않는다(game.js에 wordbook 쓰기 요청 없음, 확인함). 발음 미스일 때만 서버가 tts_cache·api_usage에 기록(routes/tts.js:143,150). 점수는 서버가 아니라 이 기기 localStorage에 쌓인다(`spellrun_best`, game.js:240). 대결 방 상태는 서버 메모리(DB 아님).

## 5 연결
- API: 위 표. 외부 서비스: OpenAI(/api/tts 캐시 미스일 때만), Google Fonts.
- 저장값·주소 옵션: localStorage `mydict_token`, `spellrun_opts`(조정값, public/js/spellrun/logic.js:205), `spellrun_mode`(기본/생존), `spellrun_preview`(미리 보기), `spellrun_view`(세로/가로), `spellrun_bgm`, `spellrun_char`(캐릭터), `spellrun_best`(최고 점수), `metis_tts_mode`(단어 발음 방식, 사전과 공용; game.js 상단 `?tts=` 처리), sessionStorage `spellrun_ids`(사전이 넘긴 단어 id). 점검 주소 옵션 ttsdebug·judgedebug(logic.js:174).
- 진입: 사전의 단어장에서 단어를 고르면 /spelling_run.html로 이동(public/english_dictionary.html:3320).
