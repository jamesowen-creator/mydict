# METIS-3 오케스트레이터 인수인계 (새 채팅 시작용)

기준일: 2026-10-10. 이 채팅의 역할과 작업 규칙, 현재 위치를 적은 문서. 자세한 기록은 각 문서 참고.

## 역할
- James(셀로/LGU+ 기획팀, 비개발자)가 이 채팅을 "오케스트레이터"로 사용. 나는 별도 Claude Code 세션(Windows, C:\dev\metis3-app)에 줄 **작업 지시 블록**을 쓰고, 붙여준 결과 보고를 검토해 다음 단계를 정하고, 프로젝트 문서(claude/*)를 관리한다. 코드를 직접 볼 수 없다.
- 앱: GitHub jamesowen-creator/mydict(branch master), Railway 서비스 metis3-app, https://metis3-app-production.up.railway.app. `git push origin master`로 자동 배포(2026-10-10에 중복이던 mydict 서비스들은 모두 삭제했고 metis3-app만 재배포된다).

## 작업 규칙 (프로젝트 지침 + 합의)
- Claude Code 지시와 결과 보고는 모두 **작업 번호를 붙인 블록**. 지시문은 복사해서 붙일 수 있게 **코드 블록 하나**로 쓴다. 사용자는 스크롤해서 이전 내용을 보지 않으므로 필요한 블록은 다시 보낸다.
- 말투는 존댓말. 문서는 간결·직관, **확인된 사실과 추정을 구분**(hallucination 경계).
- "매번 확인": 수정 전에 합의된 방향을 한 줄로 확인하고, 수정 후에는 합의 대비 달라진 점을 보고(Claude Code 보고의 [어긋남]).
- API 비용이 드는 작업은 **Haiku 먼저 제안**, Opus는 꼭 필요할 때만 물어보고. 비용 승인 없이 API 호출하지 않는다.
- 가벼운 절차: 관련 테스트만, 커밋 1개, 보고 15줄 이내. 첫 실행 실패가 있으면 푸시 보류 → 내용·의도 확인 후 승인(의도된 기대값 변경만 승인).
- 테스트: `node --test "tests/**/*.test.js"`, UI 테스트는 tests/ui/*. tests/legacy는 기본 실행에 포함됨(옛 회귀 8개를 run_all.test.js가 모의 DB·가짜 SDK로 실행, 외부 접근 없음, 약 10초, 유지 결정 235-3). Claude Code 임시폴더의 옛 테스트는 실행 금지.
- 공용 파일 수정 금지(계획된 경우만): public/css/common/*, public/js/common/*, sw.js, home, admin, server.js, routes, lib. 프로세스 종료는 본인 PID만. **운영 DB는 Claude Code가 접근하지 않는다.** DB·서비스 삭제는 백업과 항목별 사용자 동의가 있어야 한다.
- 사용자는 Railway에서 SQL 직접 입력을 부담스러워한다 → 요청하지 않는다. 눈으로 보는 확인 또는 Claude Code 읽기 전용 확인을 우선.
- claude/* 문서는 프로젝트 지식(오케스트레이터가 직접 갱신)과 저장소의 markdown_20261010\claude\ 사본(Claude Code가 갱신)에 둔다. **사용자는 파일을 직접 옮기거나 복사하지 않는다(사용자 결정 2026-10-10).** 문서를 바꿀 때는 지시문 안에 내용(전체 또는 교체할 부분)을 넣어 Claude Code가 폴더에서 직접 만들거나 수정하게 한다. Claude Code는 프로젝트 지식을 읽을 수 없으므로 필요한 내용은 지시문에 담는다. **문서 갱신은 작업 몇 개를 마친 뒤 가끔 한꺼번에 한다(사용자 결정 2026-10-10).** 갱신할 때는 프로젝트 지식과 저장소 사본을 같은 턴에 맞춘다.

## 보안 규칙
- API 키·DB 연결 문자열은 채팅과 Claude Code에 **절대 붙여넣지 않는다.** 실험 키는 사용자가 PowerShell Read-Host(보안 입력)로만 입력(프로세스 환경변수, 종료 시 삭제).
- 비밀이 들어 있을 수 있는 파일(.env 등)을 검토해 달라고 하면 먼저 경고. keys\(정답표) 폴더는 판정 전에는 열지 않는다.
- Railway 변수 값은 열람·기록하지 않는다. **jamesowen API 키는 앱이 쓰므로 삭제 금지.**

## 현재 위치 (2026-10-10)
- origin/master = 31c7523 (235-2 불필요 파일 삭제, 문서·설정만 변경). 그 앞 92430bb(232-3 문서 사본 동기화), a900655(230-1). 마지막 앱 코드 커밋 7dda05d (229-2~4 음성 지도 가독성 이식, voice_study.html만 변경). 227 마지막 코드 커밋 24c13a4 (227-25). 227 지도 품질 작업은 B2 연결 생성, 가독성, 인사이트 패널, 허브 규칙(B3), 나누기 제안(4a)까지 배포 완료. 상세는 **claude/map-quality-227.md**.
- 사용자 확인 대기: 폰에서 지도(이웃 보기, 글자 크기, 연결 카드, "지도에서 읽기" 패널), 개념 추가 시 연결 품질, 연결 6개 이상 개념에서 나누기 제안, Console 비용(추정 개념당 약 1센트), Console 입력 토큰으로 227-25 효과 확인.
- 사용자 결정(2026-10-10): 실사용 확인(폰 지도, Console 비용)은 건너뛰고 음성 지도 이식을 먼저 마친 뒤 정리 작업으로 진행. 위 확인 항목은 미확인으로 남음. 음성 지도 이식 기록은 claude/voice-map-214.md의 229 절.
- 저장소 markdown_20261010\claude\ 사본은 236-1에서 cleanup-plan, orchestrator-handover를 Project 문서와 맞춤(map-quality-227, voice-map-214는 232-3 이후 변경 없음). 이후 문서 변경은 지시문에 내용을 담아 Claude Code가 직접 수정.
- 정리 작업(2026-10-10): **완료.** Railway에는 lucky-truth의 metis3-app + Postgres-dyGe(운영 DB)만 남음. Console의 Voca. 키 삭제(jamesowen 키는 앱 사용). C:\dev 실험 폴더 3개 삭제, 3개 보관. 저장소 안 불필요 파일 삭제(235-2). voice_concepts·concept_migrations 코드·테이블, tests/legacy는 유지 결정. 남은 선택 사항: C:\dev\null 삭제 여부. 상세는 **claude/cleanup-plan.md**.
- UI 통일·하단 내비 이력은 claude/ui-unify-plan.md, claude/bottom-nav-plan.md. 그 밖: concept-study-design/phase2, voice-study-design, voice-map-214, digest-reading-plan.
