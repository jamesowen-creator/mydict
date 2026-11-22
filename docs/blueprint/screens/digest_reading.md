---
screen: 한입 독서
file: public/digest_reading.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 파일:digest_db, 기기:mydict_token, 기기:digest_genre_filter, 기기:digest_conquest_]
writes: [기기:digest_genre_filter, 기기:digest_conquest_]
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →필요 권한:perm_digest_reading ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token ; →읽기 digest_genre_filter,
  장르 필터 | →쓰기 digest_genre_filter,
  정복 토글 | →쓰기 digest_conquest_,
  정복 탭 | →읽기 digest_conquest_,
  퀴즈 시작 | →읽기 digest_conquest_,
  홈으로 이동 | →이동 홈
]
requires: [로그인, 권한:perm_digest_reading]
navigates: [홈]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 49287a8
---

# 한입 독서 (public/digest_reading.html)

## 1 기능
- 작품 목록(장르 범례로 거름, 3D 캐러셀) → 작품 상세(요약, 정복하기) → 정복 탭(정복한 작품을 장르별로) → 퀴즈(정복한 작품에서 객관식·O/X를 만든다). 하단 내비는 홈·정복·퀴즈(:553-556).
- 접근: 로그인(authGate) + `users.perm_digest_reading`. 이 화면의 확인은 명시적 false 일 때만 막는다(:667).
- "정복" 기록은 서버가 아니라 브라우저 localStorage 에만 쌓인다(:582-588).

## 2 엔진
- 없음. 퀴즈 문항은 정복한 작품의 데이터로 브라우저가 만든다(buildQuestions :1308). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인·권한:perm_digest_reading →호출 [API] GET /api/me — loadDB(:672)가 checkPermission(:660, fetch :664 → routes/auth.js:101)을 먼저 부른다 →읽기 [DB] users(routes/auth.js:120) →읽기 [기기] mydict_token(:661), digest_genre_filter(:569). 권한 false 면 데이터 파일을 요청하지 않고 안내(:674-678, :499).
- 장르 필터 →쓰기 [기기] digest_genre_filter — 범례의 장르를 누르면 setGenreFilter(:735)가 같은 장르를 다시 누를 때까지 저장하고 해제하면 지운다(:737-738).
- 정복 토글 →쓰기 [기기] digest_conquest_<작품 id>(키 앞부분 `digest_conquest_`, :587) — 상세의 정복 버튼 toggleConquest(:1282) → setConquered(:586). 서버 호출 없음.
- 정복 탭 →읽기 [기기] digest_conquest_ — onTab('conq')(:1131) → renderAndShowConq(:1159) → renderConq(:1147, getConqueredWorks :590 → isConquered :582).
- 퀴즈 시작 →읽기 [기기] digest_conquest_ — 퀴즈 탭 → startQuizFlow(:1290)가 정복 작품을 읽어 문항을 만든다(buildQuestions :1308). 정복이 0개면 안내만 하고 시작하지 않는다(:1292-1295). 점수는 저장하지 않는다.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고(appHeader.js:129)와 권한 없음 안내의 "METIS 홈으로"(:499). 하단 내비의 "홈" 탭은 이 화면의 작품 목록이다(onTab :1131 → showListView :629).

## 4 DB
- →읽기: [DB] users(권한 확인용 /api/me).
- →쓰기: 없음(DB). 기기 저장값은 위 3절.
- 기기 저장값: localStorage `mydict_token`(읽기), `digest_genre_filter`(:568, 읽기·쓰기·삭제), `digest_conquest_<id>`(:582-588, 작품마다 한 키, 값 'true'/'false').
- 정적 파일(DB 아님): `GET /digest_db.json`(fetch 'digest_db.json', :680)을 express.static 이 보낸다(server.js:57). 최상위 키 version·last_updated·authors·works(132개 작품). 파일 저장소 후보: 한입 독서 → public/digest_db.json.
- [파일] →읽기: digest_db(public/digest_db.json, 화면이 fetch 한다 :680). 정적 파일이라 서버 라우트 없이 express.static 이 보낸다(server.js:57).

## 5 연결
- [API] GET /api/me. [외부] Google Fonts(:11).
- [기기] 위 4절. 다른 읽기 화면과 키 접두사가 다르다(digest_·science_·artist_notes_).
- [모듈] authGate.js(:6), appHeader.js(:483), dialog.js(:485).
- [이동] 한입 독서 →이동 홈.
- [미확인] 상세 화면·캐러셀의 표시 규칙(:1177-1260 이후 렌더링)과 퀴즈 문항 구성 세부.
- [파일] digest_db(public/digest_db.json, LEGEND 9절).
