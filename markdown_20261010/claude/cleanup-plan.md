# METIS-3 정리 계획 (순수 METIS-3만 남기기)

기준일: 2026-10-10 15:30. 상태: **정리 완료. 남은 것은 선택 사항뿐.** 사용자 의사(2026-10-09): "나중에 순수 metis-3 앱과 관련만 남기고 다 정리하고 싶다. 여러 방향으로 만들다가 지금 많이 복잡하다."

## 원칙
1. 읽기 전용 목록(인벤토리) 먼저. 쓰임이 확정되기 전에는 지우지 않는다.
2. DB·서비스·키 삭제는 되돌릴 수 없으므로 항목마다 사용자 동의를 받고 사용자가 직접 실행한다. 백업 가능하면 백업 후(현재 요금제는 새 백업 생성 불가, Pro 필요).
3. 사용자는 SQL 직접 입력을 부담스러워한다 → 눈으로 보는 확인(Railway 화면 캡처)이나 Claude Code 읽기 전용 확인을 우선. 운영 DB는 Claude Code가 접근하지 않는다.
4. 앱 코드 제거와 DB·서비스 정리는 따로 한다(코드는 git revert로 되돌릴 수 있음).

## 현재 Railway 상태 (2026-10-10 14:35, 화면 확인)
- Projects 화면: lucky-truth 1개(production, 2/2 services online), Deleted 3개. **metis3-app**(운영 앱)과 **Postgres-dyGe**(운영 DB, 볼륨 postgres-volume-jFDc)만 있음. 캔버스에서 metis3-app → Postgres-dyGe 연결선 확인.
- 운영 DB 근거: Postgres-dyGe의 api_usage 마지막 기록이 2026-10-10 03:11(서버 시간 추정)이고 METIS-3 기능(concept, concept_link) 기록 포함. 단어장 417행. 테이블 18개.

## Railway 삭제 이력 (모두 사용자 실행, 항목별 동의)
| 항목 | 근거 | 일시 |
|---|---|---|
| mydict(lucky-truth) | metis3-app과 같은 저장소 중복 배포, 최근 1주 외부 요청 사실상 없음, 사용자 미사용 | 12:10 |
| metis2-app 서비스 | CLI 배포, 마지막 21일 전, 최근 1주 요청 2건(4xx), 사용자 미사용, 코드 공유 없음(231-1) | 12:47 |
| Postgres(옛 DB)와 볼륨 | api_usage 마지막 기록 2026-09-18, 단어장 3행, MetaCong 외부 앱 삭제됨(사용자 진술) | 13:08~13:19 |
| wordly-postgres와 볼륨 | 연결된 서비스 없음, 사용자: 테스트 데이터. 삭제 후 앱 로그인·지도 정상 | 14:02 |
| energetic-laughter 프로젝트(mydict 서비스) | 같은 저장소 세 번째 배포, DATABASE_URL 없음, 최근 1주 요청 0, 사용자 미사용 | 14:11~14:13 |
| refreshing-harmony 프로젝트(빈 Postgres) | 테이블 0개, 백업 없음, 1개월 전 생성 후 변경 없음 | 14:16 |
| extraordinary-emotion 프로젝트(빈 Postgres) | 테이블 0개, 139MB Pre-Security-Patch Backup 있었음(내용 미확인, 새 백업 불가) | 14:35 전 |
- 새 백업 없이 삭제함(요금제 제한). 옛 Postgres의 Pre-Security-Patch Backup(122MB)은 DB와 함께 사라졌을 가능성이 있음(추정).

## Anthropic Console 키 (2026-10-10)
- 키 2개였음: jamesowen(2026-06-03 생성, 앱이 사용), Voca.(2026-05-23 생성).
- 사용량 화면(최근 30일, 날짜 UTC): Voca.는 9월 17~22일경에만 사용(Haiku 4.5, 입력 44,403 · 출력 41,923 토큰), 이후 0. jamesowen은 9월 21일경~10월 10일 거의 매일 사용(입력 1,603,167 · 출력 809,890). 10월 8~9일경 하루 약 140만 토큰(지도 실험 시기로 추정).
- **Voca. 키 삭제**(사용자 실행, 14:55경). jamesowen 키는 앱이 쓰므로 삭제 금지. 키 교체는 새 키 생성 → Railway ANTHROPIC_API_KEY 교체 → 구 키 삭제 순서.
- 30일 비용은 약 5~6달러로 추정(Haiku 단가는 기억 기준, 정확한 금액은 Console 비용 화면).

## voice_concepts, concept_migrations (233-1, 화면 확인)
- 코드: 앱 기능에서는 미사용, lib/db.js initDB의 일회성 이전 단계(11, 22~24번째)에서만 사용. 이전 코드는 완료 표시가 있으면 서버 시작마다 SELECT 1~2개만 하고 건너뜀.
- 운영 DB 화면: concept_migrations에 voice_concepts_v1(2026-10-06 21:47), voice_concepts_v2(2026-10-07 22:28) 완료 기록. voice_concepts는 비어 있음. concept_items에는 개념 데이터 있음(3페이지).
- 사용자 결정: **그대로 둠**(이득이 작고 공용 lib/db.js와 테스트 6파일을 건드려야 함). 나중에 정리하려면 코드 제거(B안) → 테이블 삭제 순서, 테이블 삭제는 항목별 동의.

## 로컬·저장소 (모두 반영됨)
- 230-1(a900655): word-list 패키지, HANDOVER·PRD·PROJECT-STATUS, 미사용 로고 2개, `.nav-tab-metacong` CSS, `.env.example`의 APP_PASSWORD 제거. `.gitignore`에 prompt.txt, reference/Design.zip, reference/screenshots/ 추가.
- 231-2~4: `C:\dev\metis2-app` 삭제. OCR 관련 28파일은 `reference\metis2-ocr\`에 보관(SHA-256 일치, .gitignore 추가는 232-3에서 커밋), tmp 480파일은 `C:\dev\metis3-cleanup-228\archive\metis2-tmp.zip`(13.97MB)으로 보관. `.env.local`(580B)은 백업 없이 삭제. 원격 GitHub metis2-app 저장소는 그대로(추적 파일 202개 복원 가능).
- 232-3(92430bb): 문서 사본 4개 동기화, `.gitignore` 반영, `.claude/settings.local.json`에서 삭제된 mydict 도메인 2줄 제거.
- 234-2: `C:\dev\metis3-db-check`(0.01MB), `metis3-map-proto`(5.93MB), `metis3-audit-218`(28.64MB) 삭제. audit-218\data 8파일(643,745B)은 `cleanup-228\archive\audit-218-data\`에 보관(SHA-256 일치). 보관 확정: metis3-experiment-227, metis3-hub-study(둘 다 keys\ 정답표 포함), metis3-cleanup-228. `C:\dev\null`은 삭제 전부터 있던 항목, 그대로 둠.
- 235-2(31c7523): `delete list/` 3파일(PRD.docx, 질문 생성 프롬프트 2개)·`prompt.txt`·`settings.local.json.bak` 삭제. 참조 0건, tests/legacy 제외 596건 통과.
- 235-1 점검: 미사용 패키지, 참조 없는 서버 파일, 참조 없는 public 파일 없음(라이선스 동반 파일 제외).
- 235-3 tests/legacy: 8개 옛 회귀 스크립트를 run_all.test.js가 실행. 모의(mock) DB·가짜 SDK만 사용, 외부 접근 없음, 8/8 통과 10.5초. voice-notes 자료·합치기·퀴즈·이미지 경로의 현재 유일한 검증이라 **유지**.
- 인벤토리: `C:\dev\metis3-cleanup-228\inventory.md`(저장소 밖).

## 남은 선택 사항
1. `C:\dev\null` 항목 삭제 여부(사용자 결정, 크기·내용 미확인).
2. 보관 확정이라 그대로 둠: reference 추적 4개(로고 2, metis-icon-fullbleed.png, 3DWHEEL 사본), reference/screenshots(11.7MB, PC 전용), vibe_coding_deploy_manual.docx, docs/design, scripts/generate_literature_content.js, 공용 라우트 DELETE /api/tts/cache·GET /auth/logout, MetaCong 언급이 남은 주석·테스트.

## 알아둘 것
- Railway 변수 이름은 `VOICE_STT_MODE`인데 코드는 `VOICE_STT_MODEL`을 읽음 → 이 변수는 적용되지 않을 가능성이 높음(추정, 값은 열람 안 함). 사용자 결정: 그대로 둠.
- metis3-app 카드가 캔버스에 안 보였던 것은 다른 카드와 겹쳐 있었던 것으로 추정. 캔버스에서 Ctrl+K → reset canvas로 해결.
- Railway에서 삭제는 확인창 뒤 캔버스의 Commit까지 눌러야 확정된다. 서비스를 지워도 볼륨 카드는 따로 남아 별도로 삭제해야 한다.
- 확인한 것은 Railway·Console 화면과 코드 조사 결과이고, DATABASE_URL 등 변수 값은 열람·기록하지 않았다.
