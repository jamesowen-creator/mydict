---
screen: 작가 노트
file: public/artist_notes.html
engines: []
calls: [GET /api/me]
reads: [DB:users, 파일:artist_notes_db, 기기:mydict_token, 기기:artist_notes_field_filter, 기기:artist_notes_conquest_]
writes: [기기:artist_notes_field_filter, 기기:artist_notes_conquest_]
fallback: []
flows: [
  화면 열기 | →필요 로그인 ; →호출 GET /api/me ; →읽기 users ; →읽기 mydict_token ; →읽기 artist_notes_field_filter,
  분야 필터 | →쓰기 artist_notes_field_filter,
  정복 토글 | →쓰기 artist_notes_conquest_,
  정복 탭 | →읽기 artist_notes_conquest_,
  퀴즈 시작 | →읽기 artist_notes_conquest_,
  홈으로 이동 | →이동 홈
]
requires: [로그인]
navigates: [홈]
externals: [Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js, public/js/common/dialog.js]
last_checked: 23d581c
---

# 작가 노트 (public/artist_notes.html)

## 1 기능
- 음악·미술 작가 목록(분야 범례로 거름, 캐러셀) → 작가 상세(삶·대표작, 정복하기) → 정복 탭(정복한 작가를 분야별로) → 퀴즈(정복한 작가의 문항). 하단 내비는 홈·정복·퀴즈(:434-437). 한입 독서·과학과 코드·데이터·localStorage 를 공유하지 않는다(키 접두사 `artist_notes_`, :17).
- 접근: 로그인(authGate)만이다. 이 화면에는 기능 권한(perm_*) 확인이 없다(html 안에 `perm_`·권한 fetch 없음; DB 열도 없음 — [확인함] grep).
- 정복·분야 필터 기록은 브라우저 localStorage 에만 저장한다.

## 2 엔진
- 없음. 퀴즈 문항은 데이터 파일의 quiz 배열에서 읽어 정복한 작가 것만 골라 쓴다(quizData :1030, buildQuestions :1058, 문항 설명 :416·:1028). 문항이 비어 있으면 "준비 중"(renderQuiz :1067). 서버·AI 호출 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- 화면 열기 →필요 로그인 →호출 [API] GET /api/me — 이 화면의 스크립트는 직접 부르지 않고, 공통 게이트 authGate.js(:6)와 헤더 appHeader.js(:375, fetchMe :27)가 부른다 → routes/auth.js:101 →읽기 [DB] users(middleware/auth.js:30 인증, routes/auth.js:120) →읽기 [기기] mydict_token, artist_notes_field_filter(:448, 초기 분야 필터 읽기). 데이터는 로그인 확인과 별개로 loadDB(:529)가 바로 읽는다(권한 대기 없음).
- 분야 필터 →쓰기 [기기] artist_notes_field_filter — 범례를 누르면 setFieldFilter(:563)가 저장하고 같은 분야를 다시 누르면 지운다(lsSet :450).
- 정복 토글 →쓰기 [기기] artist_notes_conquest_<작가 id>(:470) — 상세의 정복 버튼 toggleConquest(:987) → setConquered(:470). 서버 호출 없음.
- 정복 탭 →읽기 [기기] artist_notes_conquest_ — onTab('conq')(:997) → renderAndShowConq(:1025) → renderConq(:1012, getConqueredArtists :471).
- 퀴즈 시작 →읽기 [기기] artist_notes_conquest_ — 퀴즈 탭 → startQuizFlow(:1072)가 정복 작가를 읽어 문항을 고른다. 정복이 0명이면 안내만 한다(:1076-1079). 점수는 저장하지 않는다.
- 홈으로 이동 →이동 [화면] 홈 — 상단 공통 헤더의 METIS 로고(appHeader.js:129). 하단 내비의 "홈" 탭은 이 화면의 작가 목록이다(onTab :997 → showListView :497).

## 4 DB
- →읽기: [DB] users(로그인·승인 확인용 /api/me).
- →쓰기: 없음(DB).
- 기기 저장값: localStorage `mydict_token`(읽기), `artist_notes_field_filter`(:448), `artist_notes_conquest_<id>`(:468-470, 값 'true'/'false'). 읽기·쓰기는 try/catch 로 감싸 저장소를 못 쓰는 환경에서도 멈추지 않는다(lsGet/lsSet :449-450).
- 정적 파일(DB 아님): `GET /artist_notes_db.json`(fetch 'artist_notes_db.json', :531)을 express.static 이 보낸다(server.js:57). 최상위 키 version·last_updated·artists(12명)·quiz(42문항). 파일 저장소 후보: 작가 노트 → public/artist_notes_db.json.
- [파일] →읽기: artist_notes_db(public/artist_notes_db.json, 화면이 fetch 한다 :531). 정적 파일이라 서버 라우트 없이 express.static 이 보낸다(server.js:57).

## 5 연결
- [API] GET /api/me(게이트·헤더 경유). [외부] Google Fonts(:11).
- [모듈] authGate.js(:6), appHeader.js(:375), dialog.js(:377).
- [이동] 작가 노트 →이동 홈.
- [미확인] 작가 상세·캐러셀 표시 규칙(:929 이후)과 문항 선택 세부(pickBalanced :1044).
- [파일] artist_notes_db(public/artist_notes_db.json, LEGEND 9절).
