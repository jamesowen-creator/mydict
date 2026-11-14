---
screen: 관리자
file: public/admin.html
engines: [AI 단어 뜻 변환(Claude Haiku), 저장 음성(Speak Loop)]
calls: [GET /api/me, GET /api/admin/users, PATCH /api/admin/users/:id, GET /api/admin/stats, GET /api/admin/speakloop/audio/status, GET /api/admin/speakloop/audio/list, POST /api/admin/speakloop/audio/preview, POST /api/admin/speakloop/audio/generate, GET /api/speakloop/content, GET /api/speakloop/audio/:clipKey, GET /api/admin/gloss/status, POST /api/admin/gloss/sample, POST /api/admin/gloss/run, POST /api/admin/gloss/restore, GET /api/admin/gloss/backup, DELETE /api/tts/cache/entry]
reads: [DB:users, DB:api_usage, DB:wordbook, DB:speakloop_audio, DB:gloss_backup, 기기:mydict_token, 기기:gl_last_run]
writes: [DB:users, DB:api_usage, DB:wordbook, DB:speakloop_audio, DB:gloss_backup, 캐시:tts_cache, 기기:gl_last_run]
fallback: []
requires: [로그인, 관리자]
navigates: [홈]
externals: [Anthropic API(Claude Haiku), OpenAI TTS(음성 합성), Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js]
last_checked: 034147d
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

## 5 연결
- [API] 위 3절(관리자 전용 라우트는 requireAdmin). [외부] Anthropic(뜻 변환 샘플·적용), OpenAI TTS(Speak Loop 음성 생성·미리듣기), Google Fonts.
- [기기] localStorage `mydict_token`(:374), `gl_last_run`(마지막 변환 실행 번호, 읽기 :933, 쓰기 :793).
- [모듈] public/js/common/authGate.js, appHeader.js(관리자일 때만 헤더에 '관리자' 링크, appHeader.js:110).
- 특이점: 발음 캐시 지우기는 tts_cache(서버 음성)만 지운다. Speak Loop 저장 음성(speakloop_audio)은 이 경로로 지워지지 않는다(별도 저장소).
