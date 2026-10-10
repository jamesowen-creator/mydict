# METIS-3 오케스트레이터 인수인계 (새 채팅 시작용)

기준일: 2026-10-10. 이 채팅의 역할과 작업 규칙, 현재 위치를 적은 문서. 자세한 기록은 각 문서 참고.

## 역할
- James(셀로/LGU+ 기획팀, 비개발자)가 이 채팅을 "오케스트레이터"로 사용. 나는 별도 Claude Code 세션(Windows, C:\dev\metis3-app)에 줄 **작업 지시 블록**을 쓰고, 붙여준 결과 보고를 검토해 다음 단계를 정하고, 프로젝트 문서(claude/*)를 관리한다. 코드를 직접 볼 수 없다.
- 앱: GitHub jamesowen-creator/mydict(branch master), Railway 서비스 metis3-app, https://metis3-app-production.up.railway.app. `git push origin master`로 자동 배포(같은 저장소를 보는 mydict 서비스도 같이 재배포).

## 작업 규칙 (프로젝트 지침 + 합의)
- Claude Code 지시와 결과 보고는 모두 **작업 번호를 붙인 블록**. 지시문은 복사해서 붙일 수 있게 **코드 블록 하나**로 쓴다. 사용자는 스크롤해서 이전 내용을 보지 않으므로 필요한 블록은 다시 보낸다.
- 말투는 존댓말. 문서는 간결·직관, **확인된 사실과 추정을 구분**(hallucination 경계).
- "매번 확인": 수정 전에 합의된 방향을 한 줄로 확인하고, 수정 후에는 합의 대비 달라진 점을 보고(Claude Code 보고의 [어긋남]).
- API 비용이 드는 작업은 **Haiku 먼저 제안**, Opus는 꼭 필요할 때만 물어보고. 비용 승인 없이 API 호출하지 않는다.
- 가벼운 절차: 관련 테스트만, 커밋 1개, 보고 15줄 이내. 첫 실행 실패가 있으면 푸시 보류 → 내용·의도 확인 후 승인(의도된 기대값 변경만 승인).
- 테스트: `node --test "tests/**/*.test.js"`, UI 테스트는 tests/ui/*. tests/legacy와 Claude Code 임시폴더의 옛 테스트는 실행 금지.
- 공용 파일 수정 금지(계획된 경우만): public/css/common/*, public/js/common/*, sw.js, home, admin, server.js, routes, lib. 프로세스 종료는 본인 PID만. **운영 DB는 Claude Code가 접근하지 않는다.** DB·서비스 삭제는 백업과 항목별 사용자 동의가 있어야 한다.
- claude/* 문서는 저장소의 markdown_20261010 폴더와 프로젝트 지식에 같은 내용을 둔다. 문서 갱신은 Claude Code가 저장소 파일을 수정하고, 사용자가 프로젝트 지식 쪽에 같은 내용을 반영한다.
- 사용자는 Railway에서 SQL 직접 입력을 부담스러워한다 → 요청하지 않는다. 눈으로 보는 확인 또는 Claude Code 읽기 전용 확인을 우선.

## 보안 규칙
- API 키·DB 연결 문자열은 채팅과 Claude Code에 **절대 붙여넣지 않는다.** 실험 키는 사용자가 PowerShell Read-Host(보안 입력)로만 입력(프로세스 환경변수, 종료 시 삭제).
- 비밀이 들어 있을 수 있는 파일(.env 등)을 검토해 달라고 하면 먼저 경고. keys\(정답표) 폴더는 판정 전에는 열지 않는다.
- Railway 변수 값은 열람·기록하지 않는다. **jamesowen API 키는 앱이 쓰므로 삭제 금지.**

## 현재 위치 (2026-10-10)
- origin/master = 24c13a4 (227-25). 227 지도 품질 작업은 B2 연결 생성, 가독성, 인사이트 패널, 허브 규칙(B3), 나누기 제안(4a)까지 배포 완료. 상세는 **claude/map-quality-227.md**.
- 사용자 확인 대기: 폰에서 지도(이웃 보기, 글자 크기, 연결 카드, "지도에서 읽기" 패널), 개념 추가 시 연결 품질, 연결 6개 이상 개념에서 나누기 제안, Console 비용(추정 개념당 약 1센트), Console 입력 토큰으로 227-25 효과 확인.
- 다음 후보: 정리 작업(claude/cleanup-plan.md), 음성 지도 이식. 사용자가 "다음" 또는 요청할 때 시작.
- 정리 계획(순수 METIS-3만 남기기)은 지도 품질 작업 뒤: 목록 → 항목별 결정 → 백업 → 작은 단위 진행. 상세는 **claude/cleanup-plan.md**.
- UI 통일·하단 내비 이력은 claude/ui-unify-plan.md, claude/bottom-nav-plan.md. 그 밖: concept-study-design/phase2, voice-study-design, voice-map-214, digest-reading-plan.
