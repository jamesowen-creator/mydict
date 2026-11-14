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
