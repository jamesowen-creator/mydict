---
screen: 홈
file: public/home/index.html
engines: []
calls: [GET /api/me, GET /auth/google, GET /auth/google/callback]
reads: [DB:users, 기기:mydict_token]
writes: [DB:users, 기기:mydict_token]
fallback: []
flows: [
  로그인 시작 | →호출 GET /auth/google ; →호출 Google 로그인(OAuth) ; →호출 GET /auth/google/callback ; →쓰기 users ; →쓰기 mydict_token,
  메뉴 선택 | →이동 사전,
  승인 대기 표시 | →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token,
  다시 확인 | →호출 GET /api/me ; →읽기 users,
  로그아웃 | →쓰기 mydict_token,
  관리자 링크 | →호출 GET /api/me ; →이동 관리자
]
requires: []
navigates: [사전, 문학 나침반, 한입 독서, 과학, 음성 학습, 작가 노트, 문장 학습, 개념 지도, Speak Loop, 관리자]
externals: [Google 로그인(OAuth)]
modules: []
last_checked: 49287a8
---

# 홈 (public/home/index.html)

## 1 기능
- 휠(3D 선택기)에서 항목을 고르고 가운데 항목을 누르면 그 화면으로 이동한다. 로그인 상태에 따라 항목이 달라진다: 기본 6개(언어 사전·문학 나침반·한입 독서·과학·음성 학습·작가 노트, home-wheel/src/HomeWheelApp.jsx:9) + 권한자에게만 문장 학습(:24, perm_jgrammar 또는 관리자)·개념 지도(:20, perm_concept_map)·Speak Loop(:27, perm_speakloop 또는 관리자). 로그인 전에는 9개를 모두 보인다(buildOptions :34).
- 로그인 전 화면 아래에 "Google로 로그인", 로그인 후에는 "로그아웃"(관리자는 "관리자" 링크 추가)(:219, :202). 이 화면만 공통 게이트(authGate.js)를 쓰지 않는다(public/home/index.html에 없음).
- 승인 대기·차단 안내: 로그인 콜백이 붙인 `?approval=pending|blocked`(:61) 또는 /api/me 의 403 응답(:73)이면 휠 대신 안내 문구를 보인다(:136).
- 접근: 로그인 없이 열 수 있다. 서버가 `/` 에서 이 파일을 보낸다(server.js:49-51).

## 2 엔진
- 없음. 휠 화면은 서버 호출 없이 브라우저에서 돈다(home-wheel/src/ThreeDWheelPicker.jsx). 소리·글자·AI 엔진을 쓰지 않는다.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 로그인 시작 →호출 [API] GET /auth/google — 로그인 버튼(HomeWheelApp.jsx:219) 또는 로그아웃 상태에서 휠 항목을 누를 때(goTo :93 `/auth/google`) → routes/auth.js:67(passport Google 시작, 비밀값은 환경변수 GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET·GOOGLE_CALLBACK_URL 이름만) →호출 [외부] Google 로그인(OAuth) → [API] GET /auth/google/callback(routes/auth.js:75) →쓰기 [DB] users(INSERT … ON CONFLICT (google_id) DO UPDATE, routes/auth.js:39: 첫 로그인이면 행을 만들고 is_approved 는 ADMIN_EMAILS 계정만 true, 재로그인이면 email·name 갱신·관리자 이메일이면 role=admin). 콜백은 차단 계정이면 `?approval=blocked`(:83), 미승인이면 `?approval=pending`(:86), 그 밖에는 JWT(비밀값 변수 이름 JWT_SECRET, 7일)를 `?token=` 으로 붙여 `/` 로 되돌린다(:89-93). 홈이 그 토큰을 localStorage 에 저장한다(→쓰기 [기기] mydict_token, auth.js:15-20).
- 메뉴 선택 →이동 [화면] 사전 외 — 로그인 상태에서 가운데 항목을 누르면 `window.location.href = target.url`(HomeWheelApp.jsx:93). 이동 대상은 휠에 있는 항목 하나다(도면 머리말 navigates 의 10개 중 하나, 위 1절). 흐름은 대표로 사전만 적었다.
- 승인 대기 표시 →호출 [API] GET /api/me — 열 때 토큰이 있으면 fetchMeResult(auth.js:29)가 부른다(HomeWheelApp.jsx:73 checkMe) → routes/auth.js:101 → requireAuth(middleware/auth.js:30 →읽기 [DB] users: is_approved·is_blocked·role). 403 approval_pending/blocked 면 안내를 보이고, 401 이면 토큰을 지운다(:77). 같은 안내가 `?approval=` 로도 보인다(:61).
- 다시 확인 →호출 [API] GET /api/me — 안내 화면의 [다시 확인](승인 대기이고 토큰이 있을 때만, :80 recheck → :73 checkMe).
- 로그아웃 →쓰기 [기기] mydict_token(삭제) — clearToken(auth.js:24)을 handleLogout(HomeWheelApp.jsx:96)이 부른다. 서버 호출 없음.
- 관리자 링크 →이동 [화면] 관리자 — /api/me 응답의 role 이 admin 일 때만 보이는 링크 `/admin`(HomeWheelApp.jsx:202).

## 4 DB
- →읽기: [DB] users — /api/me 와 requireAuth 가 읽는다(routes/auth.js:120, middleware/auth.js:30).
- →쓰기: [DB] users — 이 화면의 동작이 부르는 서버 쓰기는 두 곳이다. (1) 로그인 콜백의 INSERT/UPSERT(routes/auth.js:39), (2) /api/me 의 관리자 자동 승격 UPDATE(routes/auth.js:127: ADMIN_EMAILS 에 있는데 DB role 이 admin 이 아닐 때만 role='admin'). /api/me 는 모든 화면이 부르므로 (2)는 다른 화면에도 적용되나 도면에는 홈에만 적었다.
- 기기 저장값: localStorage `mydict_token` 읽기·쓰기·삭제(home-wheel/src/auth.js:9-26).
- 홈은 정적 JSON 을 읽지 않는다.

## 5 연결
- [API] 위 3절. [외부] Google 로그인(OAuth).
- 빌드와 소스: 화면은 React + Vite 번들이다. 소스는 저장소의 `home-wheel/`(src/HomeWheelApp.jsx 메뉴·로그인·안내, src/auth.js 토큰·/api/me, src/ThreeDWheelPicker.jsx 휠, src/main.jsx, vite.config.js)이고, 빌드 결과가 `public/home/`(index.html + assets/index-CPcsUBip.js·index-CKBOXxqI.css)다(vite.config.js: base '/home/', outDir '../public/home', emptyOutDir). 번들에 소스와 같은 경로 문자열이 들어 있음을 grep 으로 확인했다(/auth/google·/api/me·approval_pending·mydict_token·/concept_map.html·/admin·"승인 대기중"). 번들 안 코드를 줄 단위로 읽지는 않았다.
- [이동] 홈 →이동 사전·문학 나침반·한입 독서·과학·음성 학습·작가 노트(기본 6개, :8-15), 문장 학습·개념 지도·Speak Loop(권한자·로그인 전, :19-26), 관리자(관리자만, :195).
- [미확인] 휠 조작(드래그·관성) 세부(ThreeDWheelPicker.jsx 525줄은 읽지 않음). 번들이 현재 소스에서 빌드된 것인지(해시 비교 불가; tests/home_bundle.test.js 는 번들 주소 문자열만 확인).
