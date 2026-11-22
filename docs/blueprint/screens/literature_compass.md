---
screen: 문학 나침반
file: public/literature_compass.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 파일:literature_db, 기기:mydict_token]
writes: []
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →필요 권한:perm_literature_compass ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token,
  어휘 사전 이동 | →이동 사전,
  홈으로 이동 | →이동 홈
]
requires: [로그인, 권한:perm_literature_compass]
navigates: [홈, 사전]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 49287a8
---

# 문학 나침반 (public/literature_compass.html)

## 1 기능
- 시대별 문학 사조 타임라인에서 사조를 골라 브리핑 → 카드(뒤집기) → 퀴즈(짝짓기·O/X·객관식)로 학습한다. 장르 탭(전체·시·소설·수필·희곡, :832)으로 목록을 거른다. 하단 내비는 홈·퀴즈·사전(:690-697).
- 접근: 로그인(authGate) + `users.perm_literature_compass`. 이 화면의 권한 확인은 명시적 false 일 때만 막는다(:805, 토큰 없음·응답 오류는 통과) — 공통 게이트가 로그인을 따로 막는다.
- 읽기 전용 화면이다. 학습 결과·퀴즈 점수는 어디에도 저장하지 않는다(localStorage 키는 mydict_token 읽기뿐, 파일 안 localStorage 호출 :799 한 곳).

## 2 엔진
- 없음. 퀴즈 문항은 데이터에서 매번 브라우저가 만든다(buildQuizData :1173). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인(authGate.js, 토큰 없으면 홈으로) →필요 권한:perm_literature_compass →호출 [API] GET /api/me — loadDB(:810)가 checkPermission(:798)을 먼저 부른다(fetch :802 → routes/auth.js:101) →읽기 [DB] users(routes/auth.js:120 의 perm 열, 인증은 middleware/auth.js:30). 권한이 false 면 데이터 파일을 요청하지 않고 "이용 권한이 없습니다" 안내(:812-816, :590)를 보인다. →읽기 [기기] mydict_token(:799). 정적 파일 읽기는 4절.
- 어휘 사전 이동 →이동 [화면] 사전 — 하단 내비 "사전"(:695) 및 홈 화면의 "어휘 사전 →" 링크(:937)는 `/english_dictionary.html` 로 간다. 서버 호출 없음.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고 `/`(appHeader.js:129)와 권한 없음 안내의 "METIS 홈으로"(:594). 하단 내비의 "홈" 탭(:692)은 이 화면 안의 사조 목록(goHome :960)이지 [화면] 홈이 아니다.
- 사조 브리핑·카드·퀴즈 — 화면 안에서만 전환한다(showBriefing :966, showCards :1012, startQuiz :1259, 퀴즈 목록 :779). 서버·저장소 접근이 없어 흐름에 넣지 않았다(의도적 제외).

## 4 DB
- →읽기: [DB] users(권한 확인용 /api/me, perm_literature_compass).
- →쓰기: 없음.
- 정적 파일(DB 아님): `GET /literature_db.json`(fetch 'literature_db.json', :818)을 express.static 이 public/ 에서 보낸다(server.js:57). 최상위 키 version·last_updated·eras. 파일 저장소 후보: 문학 나침반 → public/literature_db.json.
- [파일] →읽기: literature_db(public/literature_db.json, 화면이 fetch 한다 :818). 정적 파일이라 서버 라우트 없이 express.static 이 보낸다(server.js:57).

## 5 연결
- [API] GET /api/me(위 3절). [외부] Google Fonts(:11).
- [모듈] public/js/common/authGate.js(:6), appHeader.js(:578), dialog.js(:580, 퀴즈 중단 확인 metisConfirm).
- [이동] 문학 나침반 →이동 홈·사전.
- [미확인] 카드 뒤집기·퀴즈 채점의 세부 규칙(1173-1560)은 줄 단위로 읽지 않았다.
- [파일] literature_db(public/literature_db.json, LEGEND 9절).
