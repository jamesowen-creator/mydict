# 개념학습 2차 (작업 203~213) 진행 현황

기준일: 2026-10-08. 상태: 203~213 배포 완료(origin/master = 1ef93e75f8d0a3dc9e977a5fc56f8a292939bf2b). 서버가 응답하는 것까지 확인됨. 화면 동작·Railway 로그는 사용자 확인 대기.
이 문서는 claude/concept-study-design.md의 "다음 작업" 중 2차 범위를 이어받는다. 1차(194~196) 내용과 사용자 결정은 그 문서 참조.

## 구현 (배포 완료)
- 203 f64d4984b571708cdadbe6de66943217fda002ef: 상세 화면 "연결" 섹션(목록·삭제·추가). 서버 API는 기존 것(POST /api/concepts/studies/:id/links, DELETE /api/concepts/links/:id, 중복 쌍 409). (연결 상태 배지는 210에서 제거됨)
- 204 6605602f4d48ce7776211ef3ddd92cebfa3e1438: [목록 | 그룹] 전환(기본 그룹), group_label별 접기/펼치기(화면에서만 유지), 그룹별 요약, 상세에서 그룹 바꾸기(PATCH). 그룹 일괄 이름 변경 API는 만들지 않음. 포함 관계 트리 보기는 제외.
- 205 e2350d410a01034b06f51d34969f2eef6f047111: 돌아보기 퀴즈(AI 없음). 새 테이블 concept_quiz_attempts(ON DELETE CASCADE). GET …/studies/:id/review?count=5(최대 10), POST …/review/answer. 정답은 AES-256-GCM 봉인 토큰(유효 2시간, 키는 JWT_SECRET 유도)으로만 서버가 판정, 응답에 정답 없음. 출제: 활성+설명 있는 개념만, 4개 미만이면 안내, 우선순위 헷갈림→새것→이해함(오래된 순), 유형 A(설명→용어)·B(용어→설명) 번갈아. 정오로 이해 상태를 바꾸지 않고 "헷갈림으로 표시할까요?" 버튼만.
- 206 845c590edc9b054a37d682ff7b1e6151d499f53f: 음성 입력. POST /api/concepts/voice/transcribe(권한 perm_concept_study, 하루 CONCEPT_VOICE_DAILY_CAP 기본 20, 별도 한도). 녹음 60초·6MB(voice_study는 600초·12MB), 모델 VOICE_STT_MODEL 공유, 음성 파일 저장 없음. 변환 결과는 입력창에만 채우고 사용자가 직접 추가해야 AI 호출. 비용 이벤트 'concept_stt', 관리자 비용에 같은 단가표로 합산. voice_study 코드는 복제(공유 아님).
- 207-1 d9e0d0d630750f015aafc66e4dd3981bccbae0b0, 207-2 7c117c5053234311b25928c8cef7a4b05dfb10e1, 207-3 f25f672a360a0c804221b1560367f436af7854c2: 주 버튼 배경 --btn-primary-bg #b8442e(흰 글자 5.38:1, 호버 #9c3a27, 눌림 #86311f; 되돌리기는 tokens.css 3줄), 대체값 포함. public/js/common/dialog.js(metisConfirm/metisAlert, <dialog>)로 confirm/alert 15곳 교체. 교체 안 한 곳: voice_study.html leaveConfirmed() 3곳(이탈 확인이 동기 반환값 필요).
- 208 e0e471bf56935db4ff326f48de5fcd73e6dfecc8: public/sw.js CACHE_NAME metis-v5→v6.
- 209-2 040a0c3243911328286808fd6e1bd6ecbc114acd (서버): explore 한 번의 호출 안에서 기존 개념(활성, 최근 60개)과 최대 3개 연결 제안(AI 호출 횟수 불변). 프롬프트에 id·용어·설명 40자만 JSON으로 넣음. 서버 검증: 후보 밖 id, 6종 밖 관계, 이유 없음/300자 초과, 중복 쌍은 그 연결만 건너뜀(개념은 유지). 방향 direction("from_new"/"to_new")을 AI가 정함. concept_links.user_edited BOOLEAN DEFAULT false 추가. PATCH /api/concepts/links/:id(relation_type·label·detail·swap, 수정하면 user_edited=true, source 유지). 현재 개념과의 기존 relation 연결은 이유가 비어도 생성. 입력 토큰 증가 추정 약 350+후보(개념 20개 약 900, 최대 약 2,700), 출력 최대 약 250 증가(추정, 실측 아님).
- 209-3 4185c59528ea476125db5922031b82f909011de7 + 210 56eb2548368c444248db942a876c77b14f770b2c: 연결마다 관계 종류·문구·"연결한 이유" 문장만 표시, "수정" 버튼(종류·문구·이유·방향 바꾸기·삭제). 사용자 결정에 따라 "AI 판단·확인 필요/직접 수정/직접 연결/이유 없음" 표시를 연결 목록·연결선 카드·지도에서 모두 제거(데이터 source·user_edited는 유지). 개념 추가 후 알림은 "N개 연결을 만들었습니다." 개념 설명의 "AI 설명 · 확인 필요"는 유지.
- 209-4 d3f3d8da15088f1a3378616e50d04e35addc7611: 지도 팝업. 인라인 지도를 [지도 보기] 버튼으로 대체, <dialog> 전체 화면 시트(390px)/큰 팝업(768px 이상 약 95%), 닫기 버튼·ESC·브라우저 뒤로 가기, 열릴 때 전체 자동 맞춤(축소 하한 0.05), 확대·축소 버튼·끌기·핀치·휠, 연결선 클릭 영역 28px. 노드는 선택, 연결선은 카드(수정은 상세의 연결 섹션에서). 다음 제안(점선) 노드를 누르면 팝업을 닫고 다음 단계로 이동.
- 211 69934e628a89d618cbc471a70d38fb486e6689ab: initDB를 이름 붙은 22단계(client_encoding, users, users_name_repair, wordbook, tts_cache, api_usage, review_log, voice_notes, voice_quizzes, voice_quiz_attempts, voice_concepts, voice_links, voice_images, concept_user_permission, concept_studies, concept_items, concept_links, concept_links_user_edited, concept_quiz_attempts, concept_migrations_table, concept_migration_v1, concept_migration_v2)로 분리, 단계별 try/catch. 실패한 단계는 로그 후 다음 계속, 마이그레이션은 선행 단계 실패 시 건너뜀. 로그: "[DB] init step failed: <이름>: <메시지>", "[DB] init done: 총 22단계, 실패 0단계". SQL은 한 글자도 안 바꿈: 변경 전후 SQL 72문장이 문장·순서·인자까지 동일함을 테스트로 확인(기준 JSON tests/fixtures/init_sql_baseline.json). /api/* 요청은 initDB 완료(성공·실패 무관)를 최대 15초 기다림(createApiReadyGate), "/"와 정적 파일은 기다리지 않음.
- 212 1ef93e75f8d0a3dc9e977a5fc56f8a292939bf2b: 옛 회귀 8개를 tests/legacy/로 이동(복사, 임시 폴더 원본은 그대로). tests/legacy/run_all.test.js가 각 파일을 자식 프로세스로 실행(8개 통과). 경로 설정 외 예외 수정 2건: apitest.js의 prompt.txt 쓰기를 인자(process.argv[2])가 있을 때만 하도록 차단, body192_2.js의 lib/db.js 모의에 createApiReadyGate 한 줄 추가. pass 수: admin193_2 47, apitest 52, body192_2 10, imagetest 120, linktest 63, merge192 54, quiz193_3 48, stale191 40.
- 213: push 56eb254..1ef93e7, 배포 후 홈과 6개 화면 200, GET /api/concepts/studies 401(500 아님), PATCH /api/concepts/links/1 401.
- 테스트: tests/ 전체 257개 통과(옛 회귀 8개 포함, 실행은 node --test "tests/**/*.test.js"). 이제 지시문에 임시 폴더 경로를 적지 않는다. 임시 폴더 원본은 앞으로 실행하지 않는다.

## 새 테이블·컬럼·환경변수·한도
- 테이블 concept_quiz_attempts(+idx_concept_quiz_attempts_study_id), 컬럼 concept_links.user_edited.
- 환경변수 CONCEPT_VOICE_DAILY_CAP(기본 20, 허용 1~10000). 기존 OPENAI_API_KEY, VOICE_STT_MODEL, VOICE_STT_COST_PER_MIN 공유.
- 한도: 퀴즈 최소 4개·기본 5문제·최대 10, 음성 60초·6MB, 연결 문구 40자·이유 300자, AI 연결 최대 3개/회, 그룹 30자.

## 사고 기록
- prompt.txt(저장소 루트, git 추적 없음): 209-5에서 임시 폴더의 옛 apitest.js를 "그 자리에서" 실행하라는 내 지시 때문에, 이 스크립트가 끝에 prompt.txt를 빈 내용으로 써서 0바이트가 됨(수정 시각 18:23 일치). 원래 내용과 중요도는 확인하지 못했고(Claude Code는 이 세션 초반에 970줄 이상이었다고 보고, 내 이전 기록에는 한때 0바이트로 남아 있던 적이 있다고도 있어 사실 관계가 엇갈림) 복구하지 못함. 사용자에게 Windows 이전 버전 확인을 안내함. 재발 방지: 저장소 복사본은 쓰기 차단, 원본은 실행 금지.

## 미확인 (사용자 확인 필요)
- Railway 로그의 "[DB] init done: 총 22단계, 실패 0단계" 줄과 실패·건너뜀 단계 유무, 실제 Postgres에서 단계별 실행, 배포 직후 /api 대기(모의 테스트로만 확인).
- 로그인 후 개념학습 화면(user_edited 컬럼이 있어야 연결 조회 가능)과 화면 동작.
- 실제 마이크·OpenAI 변환, 실기기 마이크 권한 흐름, 변환 비용 실측(추정은 30초 약 0.3센트, 실측 아님).
- 실제 Haiku 응답이 연결 JSON 형식을 지키는지, 이유의 정확성과 연결의 타당성(모의 테스트로만 확인).
- 실제 터치 기기에서 지도 팝업·핀치·뒤로 가기, iOS Safari의 <dialog>(15.4 이상으로 추정).
- 이미 열려 있던 탭의 옛 화면(새로고침 필요), mydict 서비스 재배포, 한입 독서·과학 캐러셀.

## 남은 일
- voice_concepts 테이블 정리(DROP) 여부: 운영 이전 건수 확인 후 별도 결정.
- 후속 후보: 포함 관계 트리 보기, 오답만 다시 풀기, 학습 진행 표시, 메뉴 이름 확정, 연결선 겹침 개선, 기존 연결에 "AI에게 이유 묻기".
- 보류(사용자 결정 2026-10-08): 수학 학습(내신·입시) — 당분간 진행하지 않음. 논의한 설계안(예제→문제→오답→간격 반복, 코드 계산으로 정답 검증, 수식 렌더링 필요)은 대화에만 있고 문서화하지 않음.
