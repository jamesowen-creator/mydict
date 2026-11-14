---
screen: Speak Loop
file: public/speakloop.html
engines: [저장 음성(Speak Loop)]
calls: [GET /api/me, GET /api/speakloop/content, GET /api/speakloop/audio-index, GET /api/speakloop/audio/:clipKey, GET /api/speakloop/progress, POST /api/speakloop/progress]
reads: [DB:users, DB:speakloop_audio, DB:speakloop_progress, 기기:mydict_token]
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
last_checked: 8753b0a
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

## 5 연결
- [API] 위 3절(전부 requireAuth + requireSpeakloopPerm, routes/speakloop.js:28). [외부] Google Fonts(speakloop.html:9-11).
- [기기] localStorage `mydict_token`(app.js:10). 그 밖의 저장값 없음(speakloop 화면 파일에서 localStorage·sessionStorage 사용은 이 1건만 확인).
- [모듈] public/js/common/authGate.js, appHeader.js. 화면 전용 스크립트: public/js/speakloop/{core,player,rec,app,idiom}.js.
- [미확인] 독백 연습 4개 모드 각각의 서버 호출 차이(app.js 전체는 읽지 않음, 호출은 위 6개 API만 grep으로 확인).
