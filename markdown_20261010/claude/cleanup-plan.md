# METIS-3 정리 계획 (순수 METIS-3만 남기기)

기준일: 2026-10-10. 상태: **저장소 안 정리 1단계와 Railway 정리 완료. 남은 것은 저장소 문서 동기화, voice_concepts 확인, Voca 키, C:\dev 폴더.** 사용자 의사(2026-10-09): "나중에 순수 metis-3 앱과 관련만 남기고 다 정리하고 싶다. 여러 방향으로 만들다가 지금 많이 복잡하다."

## 원칙
1. 읽기 전용 목록(인벤토리) 먼저. 쓰임이 확정되기 전에는 지우지 않는다.
2. DB·서비스 삭제는 되돌릴 수 없으므로 항목마다 사용자 동의를 받는다. 백업 가능하면 백업 후(현재 요금제는 새 백업 생성 불가, Pro 필요).
3. 사용자는 SQL 직접 입력을 부담스러워한다 → 눈으로 보는 확인(Railway 화면 캡처)이나 Claude Code 읽기 전용 확인을 우선. 운영 DB는 Claude Code가 접근하지 않는다.
4. 앱 코드 제거와 DB·서비스 정리는 따로 한다(코드는 git revert로 되돌릴 수 있음).

## 현재 Railway 상태 (2026-10-10 14:30)
- lucky-truth(production): **metis3-app**(운영 앱)과 **Postgres-dyGe**(운영 DB, 볼륨 postgres-volume-jFDc)만 남음. 캔버스에서 metis3-app → Postgres-dyGe 연결선 확인.
- 운영 DB 근거(화면 확인): Postgres-dyGe의 api_usage 마지막 기록이 2026-10-10 03:11(서버 시간 추정)이고 METIS-3 기능(concept, concept_link) 기록 포함. 단어장 417행.
- 다른 프로젝트: extraordinary-emotion(빈 Postgres, 테이블 0개) — 삭제 여부는 사용자 보고 대기. refreshing-harmony, energetic-laughter는 삭제됨.

## 삭제 이력 (모두 사용자 실행, 항목별 동의)
| 항목 | 근거 | 일시 |
|---|---|---|
| mydict(lucky-truth) | metis3-app과 같은 저장소 중복 배포, 최근 1주 외부 요청 사실상 없음, 사용자 미사용 | 12:10 |
| metis2-app 서비스 | CLI 배포, 마지막 21일 전, 최근 1주 요청 2건(4xx), 사용자 미사용, 코드 공유 없음(231-1) | 12:47 |
| Postgres(옛 DB)와 볼륨 | api_usage 마지막 기록 2026-09-18, 단어장 3행, MetaCong 외부 앱 삭제됨(사용자 진술) | 13:08~13:19 |
| wordly-postgres와 볼륨 | 연결된 서비스 없음, 사용자: 테스트 데이터. 삭제 후 앱 로그인·지도 정상 | 14:02 |
| energetic-laughter 프로젝트(mydict 서비스) | 같은 저장소 세 번째 배포, DATABASE_URL 없음, 최근 1주 요청 0, 사용자 미사용 | 14:11~14:13 |
| refreshing-harmony 프로젝트(빈 Postgres) | 테이블 0개, 백업 없음, 1개월 전 생성 후 변경 없음 | 14:16 |
- 새 백업 없이 삭제함(요금제 제한). 옛 Postgres의 Pre-Security-Patch Backup(122MB)은 DB와 함께 사라졌을 가능성이 있음(추정).

## 로컬·저장소
- 230-1(a900655): word-list 패키지, HANDOVER·PRD·PROJECT-STATUS, 미사용 로고 2개, `.nav-tab-metacong` CSS, `.env.example`의 APP_PASSWORD 제거. `.gitignore`에 prompt.txt, reference/Design.zip, reference/screenshots/ 추가.
- 231-2~4: `C:\dev\metis2-app` 삭제. OCR 관련 28파일은 `C:\dev\metis3-app\reference\metis2-ocr\`에 보관(SHA-256 일치, .gitignore 대상 추가는 232에서 커밋), tmp 480파일은 `C:\dev\metis3-cleanup-228\archive\metis2-tmp.zip`(13.97MB, 무결성 확인)으로 보관. `.env.local`(580B)은 백업 없이 삭제. 원격 GitHub metis2-app 저장소는 그대로(추적 파일 202개 복원 가능).
- 인벤토리: `C:\dev\metis3-cleanup-228\inventory.md`(저장소 밖).

## 남은 일
1. 저장소: 문서 사본 동기화와 `.gitignore` 커밋(232), `.claude/settings.local.json`의 삭제된 mydict 주소 허용 항목 정리.
2. voice_concepts, concept_migrations 코드·테이블: 운영 DB(Postgres-dyGe)에서 쓰이는지 먼저 확인.
3. Console의 Voca 키 용도 확인. jamesowen 키는 앱이 쓰므로 삭제 금지. 키 교체는 새 키 생성 → Railway ANTHROPIC_API_KEY 교체 → 구 키 삭제 순서.
4. 저장소 밖 폴더 `C:\dev\`: metis3-experiment-227, metis3-hub-study, metis3-map-proto, metis3-audit-218, metis3-db-check, metis3-cleanup-228(보관 zip 포함). 실험 결과 보존 가치가 있어 삭제는 사용자 결정. 허브 실험 결과 파일의 키 흔적 검사는 0건이었다.
5. 저장소 안 남은 결정: MetaCong 언급이 남은 공용 파일 주석·테스트(그대로 둠), 미사용 라우트 DELETE /api/tts/cache·GET /auth/logout(유지), tests/legacy 9개 파일(마지막에 재검토).
6. extraordinary-emotion 프로젝트(빈 Postgres) 삭제 여부 확인.

## 알아둘 것
- Railway 변수 이름은 `VOICE_STT_MODE`인데 코드는 `VOICE_STT_MODEL`을 읽음 → 이 변수는 적용되지 않을 가능성이 높음(추정, 값은 열람 안 함). 사용자 결정: 그대로 둠.
- metis3-app 카드가 캔버스에 안 보였던 것은 다른 카드와 겹쳐 있었던 것으로 추정. 캔버스에서 Ctrl+K → reset canvas(그룹 해제·위치 초기화)로 해결.
- Railway에서 삭제는 확인창 뒤 캔버스의 Commit까지 눌러야 확정된다. 서비스를 지워도 볼륨 카드는 따로 남아 별도로 삭제해야 한다.
- 확인한 것은 Railway 화면과 코드 조사 결과이고, DATABASE_URL 등 변수 값은 열람·기록하지 않았다.
