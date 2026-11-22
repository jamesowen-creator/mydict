---
screen: 과학
file: public/science_reading.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 기기:mydict_token, 기기:science_conquest_]
writes: [기기:science_conquest_]
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →필요 권한:perm_science_reading ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token,
  정복 토글 | →쓰기 science_conquest_,
  정복 탭 | →읽기 science_conquest_,
  퀴즈 시작 | →읽기 science_conquest_,
  홈으로 이동 | →이동 홈
]
requires: [로그인, 권한:perm_science_reading]
navigates: [홈]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 49287a8
---

# 과학 (public/science_reading.html)

## 1 기능
- 과목 선택(과목별 개념 수, :1093) → 과목별 캐러셀(:1274) → 개념 상세(:1594, 정복하기) → 정복 탭(정복한 개념을 과목별로) → 퀴즈. 하단 내비는 홈·정복·퀴즈(:556-559). 한입 독서를 복제한 독립 파일이며 코드·데이터·저장 키를 공유하지 않는다(:17).
- 접근: 로그인(authGate) + `users.perm_science_reading`. 확인은 명시적 false 일 때만 막는다(:1196). localStorage 접근 자체가 막힌 환경이면 토큰 없음으로 보고 통과한다(:1190).
- 정복 기록은 브라우저 localStorage 에만 저장한다(서버·DB 없음, :593).

## 2 엔진
- 없음. 퀴즈는 정복한 개념의 데이터(title·one_line·key_points)를 고정 문구와 조합해 브라우저가 만든다(:819, "API·비용 없음" 주석 :642). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인·권한:perm_science_reading →호출 [API] GET /api/me — loadDB(:1201)가 checkPermission(:1186, fetch :1193 → routes/auth.js:101)을 먼저 부른다 →읽기 [DB] users(routes/auth.js:120) →읽기 [기기] mydict_token(:1190). 권한 false 면 데이터 파일을 요청하지 않고 안내(:1203-1207, :485).
- 정복 토글 →쓰기 [기기] science_conquest_<개념 id>(키 앞부분 `science_conquest_`, :597) — 상세의 정복 버튼 toggleConquest(:628) → setConquered(:605). 서버 호출 없음.
- 정복 탭 →읽기 [기기] science_conquest_ — onTab('conq')(:836) → goConq(:862) → renderConq(:846, getConqueredConcepts :614 → isConquered :600).
- 퀴즈 시작 →읽기 [기기] science_conquest_ — 퀴즈 탭 onQuizTab(:879) → startQuizFlow(:891)가 정복 개념을 읽어 문항을 만든다(buildQuestions :819). 정복이 0개면 안내만 한다(:893-896). 점수는 저장하지 않는다.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고(appHeader.js:129)와 권한 없음 안내의 "METIS 홈으로"(:485). 하단 내비의 "홈" 탭은 이 화면의 과목 선택이다(onTab :836 → goConceptsTab :1082).

## 4 DB
- →읽기: [DB] users(권한 확인용 /api/me).
- →쓰기: 없음(DB).
- 기기 저장값: localStorage `mydict_token`(읽기), `science_conquest_<id>`(:597-612, 개념마다 한 키, 값 'true'/'false'). 필터 키는 없다(localStorage 호출은 이 두 종류뿐).
- 정적 파일(DB 아님): `GET /science_db.json`(fetch 'science_db.json', :1209)을 express.static 이 보낸다(server.js:57). 최상위 키 version·last_updated·concepts(32개 개념). 파일 저장소 후보: 과학 → public/science_db.json.

## 5 연결
- [API] GET /api/me. [외부] Google Fonts(:11).
- [모듈] authGate.js(:6), appHeader.js(:469), dialog.js(:471).
- [이동] 과학 →이동 홈. 주소 `?field=`·`?tab=conq` 로 같은 화면 안의 보기를 가리키는 history 이동이 있으나(:832, :1091) 다른 화면으로 가지 않는다.
- [미확인] 캐러셀 표시·관련 개념(related) 규칙의 세부(:664-725, :1274 이후).
