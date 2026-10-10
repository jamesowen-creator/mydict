# 관리자 화면과 권한 구조 (243)

기준일: 2026-10-10. 상태: 243-2(e77ed8d) 배포. 사용자가 관리자 화면에서 헤더 위치, 사전 토글 저장, 폰 헤더 모양을 확인하고 "완료"로 보고(세부 값은 받지 못함).

## 변경 (public/admin.html만, 서버·DB 변경 0)
- 상단 "사용자 현황" 삭제(HTML·CSS·JS). 비용 섹션이 같은 /api/admin/stats 응답을 써서 그 요청은 유지. 응답의 users·usage·monthly 필드는 화면에서 안 쓰지만 legacy/admin193_2가 단언해서 서버는 그대로.
- 헤더·본문 폭: tokens.css 링크 추가, body에 max-width var(--content-max)(680px)·margin 0 auto, 헤더 높이 65px·좌우 16px, main의 1200px 제한 삭제. 폭 1280에서 헤더·본문 680px, 좌우 여백 300px씩. 폭 390에서 헤더 내용이 두 줄로 줄바꿈되어 높이 95px(다른 화면은 65px, 조정하지 않음). 표는 .table-wrap 안에서 가로 스크롤하고 저장 열은 고정.
- 사용자 관리 열: 사용자, 역할, 승인, 차단, 언어 사전, 문학 나침반, 한입 독서, 과학, 음성 학습, 개념학습(랜딩페이지 과목 순서·이름), 사용 횟수 열들(유지), 저장.
- 언어 사전 토글은 can_search·can_wordbook·can_quiz·can_tts·can_podcast 5개를 묶음: 모두 켜짐=켜짐, 모두 꺼짐=꺼짐, 섞임=혼합(aria-checked="mixed"). 혼합에서 누르면 5개 모두 켜짐. 저장 시 사전은 PATCH에 5개 키를 함께 보내고, 나머지 5과목은 변경한 컬럼 하나씩 보냄.
- 테스트: concept_home_admin.ui 열 라벨 3줄 수정, 새 tests/ui/admin_permissions.ui.test.js 7건, 전체 619건 통과.

## 권한 구조 (243-1 코드 조사, 줄 번호는 조사 시점)
| 과목(랜딩 순서) | 컬럼 | 서버 검사 | 화면 검사 |
|---|---|---|---|
| 언어 사전 | can_search, can_wordbook, can_quiz, can_tts, can_podcast | can_search(dictionary.js:17), can_tts(tts.js:26), can_wordbook(wordbook.js GET/POST/DELETE) | 없음 |
| 문학 나침반 | perm_literature_compass | 없음 | 클라이언트만(literature 807행) |
| 한입 독서 | perm_digest_reading | 없음 | 클라이언트만(digest 669행) |
| 과학 | perm_science_reading | 없음 | 클라이언트만(science 1186~1198행) |
| 음성 학습 | perm_voice_study | voice_study.js:21(전체) | 화면도 |
| 개념학습 | perm_concept_study | concept_study.js:32(전체) | 화면도 |
- can_quiz, can_podcast는 서버·화면 어디에서도 검사하지 않고 저장만 됨.
- checkPermission(middleware/auth.js:55): 차단되면 false, 조회 오류·행 없음은 통과(fail-open).
- 기본값: users 권한 컬럼은 BOOLEAN 기본 true(개념은 NOT NULL 기본 true), is_approved 기본 true(신규 가입 INSERT가 명시), role 기본 user. PATCH /api/admin/users/:id는 허용 컬럼 목록의 키만 받아 한 번에 UPDATE, 변경이 없으면 400, 자기 자신의 role 강등·차단·승인 취소는 400.
- 랜딩 과목 소스: home-wheel/src/HomeWheelApp.jsx 8~15행(언어 사전, 문학 나침반, 한입 독서, 과학, 음성 학습, 개념학습).

## 알려진 한계·후보
- 문학·한입·과학은 서버가 권한을 검사하지 않아, 권한을 꺼도 API를 직접 호출하면 쓸 수 있음. 퀴즈·팟캐스트 플래그는 아무것도 막지 않음. 현재 사용자 3명이라 급하지 않지만 사용자를 늘리기 전에 서버 검사 추가가 후보(공용 routes·middleware 수정, 위험 중간).
- 안 B(DB·서버까지 과목 단위 권한, perm_dictionary 컬럼과 initDB 이전)는 위험이 높아 보류. 안 A(화면만 변경)를 채택.
- 폰 폭에서 admin 헤더가 두 줄(95px). 필요하면 "← 앱으로 돌아가기"를 줄이는 작은 수정으로 맞출 수 있음.

## 후속 정리 (254-1 a5e7d8f, 255-1 566a216)
- 보조 글자 --text3 #9398b5를 text-sub #4a5070으로(대비 2.84→7.86), #denied 제목 20→18px, 인라인 "(나)" 10→11px, 토스트 배경을 --color-text 변수로.
- 죽은 변수 --radius(12px, 사용 0곳) 삭제. .pending-badge 글자를 본문색으로 바꾸고 경고 주황(--warn #d97706)은 ::before 점에만 남김(주황 글자는 흰 바탕 3.19라 기준 미달이었음).
- 그대로 둔 것: 8px 점 글리프, --warn 의미 색, 간격. 폰 폭 헤더 두 줄(95px)은 그대로.
- 디자인 적용 전체 경과는 claude/design-principles-238.md.
