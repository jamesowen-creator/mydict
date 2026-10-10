# METIS-3 정리 계획 (순수 METIS-3만 남기기)

기준일: 2026-10-09. 상태: **계획만 있음. 삭제·정리 작업은 아직 하지 않음.** 사용자 의사(2026-10-09): "나중에 순수 metis-3 앱과 관련만 남기고 다 정리하고 싶다. 여러 방향으로 만들다가 지금 많이 복잡하다."
지금은 지도 품질 작업(claude/map-quality-227.md)을 먼저 진행 중. 정리는 그 뒤 사용자가 시작을 정할 때 착수.

## 원칙
1. 먼저 읽기 전용 **목록(인벤토리)**을 만든다. 무엇이 어디에 쓰이는지 확정하기 전에는 지우지 않는다.
2. DB·서비스 삭제는 되돌릴 수 없으므로 **백업 후**, 항목마다 사용자 동의를 받는다.
3. 사용자가 직접 SQL을 입력하는 방식은 부담스럽다고 함(2026-10-09). 눈으로 보는 확인이나 Claude Code가 하는 읽기 전용 확인을 우선한다. 운영 DB는 Claude Code가 접근하지 않는다.
4. 앱 코드 제거와 DB·서비스 정리는 따로 한다(코드 제거는 git revert로 되돌릴 수 있음).

## 확인된 사실 (Railway 화면 캡처, 코드 조회)
- Railway 프로젝트 lucky-truth(production)의 서비스: **metis3-app**(운영 앱, 주소 metis3-app-production.up.railway.app), **mydict**(GitHub 저장소 mydict를 같이 바라보는 별도 서비스, `Postgres`에 연결된 것으로 보임), **metis2-app**(`wordly-postgres`에 연결된 것으로 보임), DB 3개: `Postgres`, `Postgres-dyGe`, `wordly-postgres`.
- metis3-app의 DATABASE_URL은 서비스 참조가 아니라 값 직접 입력 형태(값 가려짐). **어느 DB를 쓰는지는 확정 못함.** 추정: `Postgres-dyGe`(MetaCong 테이블 없음, METIS-3 테이블 있음).
- `Postgres-dyGe` 테이블: api_usage, concept_items, concept_links, concept_migrations, concept_quiz_attempts, concept_studies, review_log, tts_cache, users, voice_concepts, voice_image_sets, voice_images, voice_links, voice_notes, voice_quiz_attempts, voice_quizzes, wordbook. (`feedbacks` 없음)
- `Postgres` 테이블: 위와 같은 METIS-3 계열 + feedbacks + **MetaCong 4개(questions, achievement_standards, user_progress, learning_sessions)**. 행 수·최근 날짜는 미확인.
- `wordly-postgres`: Prisma 방식 테이블(Account, DictionaryWord, QuizSession 등). metis2-app용으로 보이며 METIS-3와 무관(추정).
- MetaCong 4개 테이블은 이 저장소의 initDB가 만든 적이 없음(외부 MetaCong 프로젝트가 만든 것으로 추정). 외부 프로젝트가 이 DB를 계속 쓰는지는 미확인.
- MetaCong 앱 코드는 227-13(7c2709c, 8282490)으로 제거 완료. 앱은 그 4개 테이블을 더 이상 읽지도 쓰지도 않음. mydict 서비스도 같은 저장소라 함께 재배포되어 MetaCong 화면이 사라졌음(되살리려면 git revert).
- 운영 DB 안의 외래키·뷰·트리거는 조회하지 않아 **연결 여부 미확인.**
- Console API 키는 2개(jamesowen, Voca). jamesowen 키를 앱과 지도 품질 실험 3회(227-1~6, 227-20~21)가 함께 사용했다(실험 스크립트 안내 문구로 확인, 전용 키 없음). **삭제하면 앱 AI 기능이 멈춘다.** Voca 키의 용도는 미확인.
- Railway metis3-app 변수 목록(값은 확인·기록하지 않음): ANTHROPIC_API_KEY, GOOGLE_*, JWT_SECRET, SESSION_SECRET, ADMIN_EMAILS, CONCEPT_LINK_MODE, DATABASE_URL, OPENAI_API_KEY, VOICE_STT_MODE.

## 정리 후보 (아직 결정 안 됨)
1. MetaCong 테이블 4개(위 `Postgres`): 백업 후 삭제 / 남기기. 판단 근거 필요: 행 수, 최근 날짜, 외부 프로젝트 사용 여부.
2. mydict 서비스: 같은 저장소를 중복 배포 중(푸시할 때마다 둘 다 재배포). 쓰는지 확인 후 중지·삭제 여부.
3. `Postgres`와 `Postgres-dyGe` 중 하나: 데이터가 겹치는지, 어느 쪽이 실제 운영 데이터인지 확인 후 하나로 정리.
4. metis2-app + wordly-postgres: METIS-3와 무관한 별도 앱으로 보임. 삭제 여부는 사용자 판단.
5. 저장소 안: HANDOVER/PRD/PROJECT-STATUS 문서의 MetaCong 언급, 사전 CSS `.nav-tab-metacong`, 주석, voice_concepts 테이블(196 이후 읽기만 유지), 폐기된 테스트·legacy 폴더, 홈의 사용 안 하는 항목.
6. API 키: 교체하려면 새 키 생성 → Railway ANTHROPIC_API_KEY 교체 → 구 키 삭제 순서. Voca 키가 다른 앱용이면 정리 대상 아님(사용자 판단).
7. 저장소 밖 작업 폴더(C:\dev\): metis3-experiment-227, metis3-hub-study, metis3-map-proto, metis3-audit-218, metis3-db-check. 실험 결과 보존 가치가 있어 지도 품질 작업 완료 전에는 지우지 않는다. 허브 실험 결과 파일의 키 흔적 검사는 0건이었다. 삭제는 사용자 결정.

## 제안 순서
1. (읽기 전용) 목록 작성: 서비스별 연결 DB와 도메인, 테이블별 행 수·최근 날짜(눈으로 보는 방식 또는 사용자 승인한 조회), 저장소 기능 목록(화면·라우트·테이블·홈 메뉴), 미사용 후보.
2. 사용자와 항목별 유지/정리 결정.
3. 백업(Railway Backups 또는 내보내기).
4. 코드 정리 → 배포 → 확인 → 서비스·DB 정리 순서로 작은 단위 진행.
