# METIS-3 오케스트레이터 인수인계 (새 채팅 시작용)

기준일: 2026-10-15. 이 채팅의 역할과 작업 규칙, 현재 위치를 적은 문서. 자세한 기록은 각 문서 참고.

## 역할
- James(셀로/LGU+ 기획팀, 비개발자)가 이 채팅을 "오케스트레이터"로 사용. 나는 별도 Claude Code 세션(Windows, C:\dev\metis3-app)에 줄 **작업 지시 블록**을 쓰고, 붙여준 결과 보고를 검토해 다음 단계를 정하고, 프로젝트 문서(claude/*)를 관리한다. 코드를 직접 볼 수 없다.
- 앱: GitHub jamesowen-creator/mydict(branch master), Railway 서비스 metis3-app, https://metis3-app-production.up.railway.app. `git push origin master`로 자동 배포(2026-10-10에 중복이던 mydict 서비스들은 모두 삭제했고 metis3-app만 재배포된다).

## 작업 규칙 (프로젝트 지침 + 합의)
- Claude Code 지시와 결과 보고는 모두 **작업 번호를 붙인 블록**. 지시문은 복사해서 붙일 수 있게 **코드 블록 하나**로 쓴다. 사용자는 스크롤해서 이전 내용을 보지 않으므로 필요한 블록은 다시 보낸다.
- 말투는 존댓말. 문서는 간결·직관, **확인된 사실과 추정을 구분**(hallucination 경계).
- "매번 확인": 수정 전에 합의된 방향을 한 줄로 확인하고, 수정 후에는 합의 대비 달라진 점을 보고(Claude Code 보고의 [어긋남]).
- API 비용이 드는 작업은 **Haiku 먼저 제안**, Opus는 꼭 필요할 때만 물어보고. 비용 승인 없이 API 호출하지 않는다.
- **(2026-10-13~14 추가) 새 지시 블록은 결과 보고가 와서 검토된 뒤에만, 한 번에 하나씩 만든다.** 보충 블록을 여러 개 겹치지 않는다(사용자: "자꾸 꼬여"). 변형 확인은 블록에서 명시한 경우에만. 테스트는 관련 묶음만, 전체는 배치 끝에만(부하성 UI 실패는 해당 파일만 2회까지 재실행). 새 테스트는 t.after로 서버·페이지를 닫는다. 품질 판단은 나중에 사용자가 폰에서 한꺼번에. 모든 UI 작업은 디자인 원칙을 지킨다. 커밋 메시지 끝에 Co-Authored-By와 Claude-Session 두 줄. 자세한 내용은 claude/concept-map-progress-275.md 8절.
- 가벼운 절차: 관련 테스트만, 커밋 1개, 보고 15줄 이내. 첫 실행 실패가 있으면 푸시 보류 → 내용·의도 확인 후 승인(의도된 기대값 변경만 승인).
- 테스트: `node --test "tests/**/*.test.js"`, UI 테스트는 tests/ui/*. tests/legacy는 기본 실행에 포함됨(옛 회귀 8개를 run_all.test.js가 모의 DB·가짜 SDK로 실행, 외부 접근 없음, 약 10초, 유지 결정 235-3). Claude Code 임시폴더의 옛 테스트는 실행 금지.
- 공용 파일 수정 금지(계획된 경우만): public/css/common/*, public/js/common/*, sw.js, home, admin, server.js, routes, lib. 프로세스 종료는 본인 PID만. **운영 DB는 Claude Code가 접근하지 않는다.** DB·서비스 삭제는 백업과 항목별 사용자 동의가 있어야 한다.
- 사용자는 Railway에서 SQL 직접 입력을 부담스러워한다 → 요청하지 않는다. 눈으로 보는 확인 또는 Claude Code 읽기 전용 확인을 우선.
- claude/* 문서는 프로젝트 지식(오케스트레이터가 직접 갱신)과 저장소의 markdown_20261010\claude\ 사본(Claude Code가 갱신)에 둔다. **사용자는 파일을 직접 옮기거나 복사하지 않는다(사용자 결정 2026-10-10).** 문서를 바꿀 때는 지시문 안에 내용(전체 또는 교체할 부분)을 넣어 Claude Code가 폴더에서 직접 만들거나 수정하게 한다. Claude Code는 프로젝트 지식을 읽을 수 없으므로 필요한 내용은 지시문에 담는다. **문서 갱신은 작업 몇 개를 마친 뒤 가끔 한꺼번에 한다(사용자 결정 2026-10-10).** 갱신할 때는 프로젝트 지식과 저장소 사본을 같은 턴에 맞춘다.

## 보안 규칙
- API 키·DB 연결 문자열은 채팅과 Claude Code에 **절대 붙여넣지 않는다.** 실험 키는 사용자가 PowerShell Read-Host(보안 입력)로만 입력(프로세스 환경변수, 종료 시 삭제).
- 비밀이 들어 있을 수 있는 파일(.env 등)을 검토해 달라고 하면 먼저 경고. keys\(정답표) 폴더는 판정 전에는 열지 않는다.
- Railway 변수 값은 열람·기록하지 않는다. **jamesowen API 키는 앱이 쓰므로 삭제 금지.**

## 현재 위치 (2026-10-15)
- origin/master = caa10fd (278-1), 작업 트리 깨끗. sw.js CACHE_NAME metis-v32. DB init 총 35단계. 전체 테스트 974건 통과(6분 3초).
- **개념 지도 구현 완료**(1~5b, UI 개편, 개념학습 의존 제거, 모르는 개념 표시, 표시 개념 퀴즈, **말로 설명하기(주관식·음성 답변·AI 평가) + 최근 부족 목록**) 및 **OCR 터치 선택(272)** 배포. 작업↔커밋 표, 구현 결정, 향후 과제, 확인 대기 목록은 **claude/concept-map-progress-275.md**(6b에 2단계 상세). 설계 배경은 claude/concept-map-redesign.md.
- **사용자 폰 확인은 전부 보류**(2026-10-14): Railway 로그 "[DB] init done: 총 35단계, 실패 0단계", 개념 지도 화면 전체, 275-4·275-5, 278-1(말로 설명하기), OCR 터치 선택. 새 캐시(v32)를 받으려면 앱을 완전히 닫았다가 재실행.
- 합의된 향후 과제(미착수): 리마인딩 확장(목록에서 재출제·간격 반복 등, 필요할 때 검토), 개념 지도 vs 개념학습 비교 후 하나 삭제.
- 2단계 설계 결정(2026-10-14): 질문 문장 없이 개념 이름만 제시, 녹음 원문은 보여 주거나 저장하지 않고 AI가 정리한 요약만 표시·저장, 전사 확인 단계 없음, 한도 전사 20/일·평가 30/일, 리마인딩은 최근 부족 목록만. 개념학습에는 주관식 평가가 원래 없었음(277-1 조사).
- 변경 금지 파일(매 작업 diff 0줄 확인): concept_study.html, routes/concept_study.js, lib/concept_links_b2.js, public/js/map/mapCore.js, voice_study.html. 개념 지도 코드는 개념학습 파일을 불러오지 않는다(275-1, 278-1에서도 유지).
- 이전 위치(2026-10-10, 정리 작업 완료, 음성 지도 이식, 227 지도 품질, 디자인 적용 245~255)의 상세는 claude/cleanup-plan.md, claude/voice-map-214.md, claude/map-quality-227.md, claude/design-principles-238.md 참고. 그때의 사용자 확인 대기(사전 폰 지도, Console 비용)는 미확인으로 남음. Railway에는 lucky-truth의 metis3-app + Postgres-dyGe(운영 DB)만 남음.
- UI 통일·하단 내비 이력은 claude/ui-unify-plan.md, claude/bottom-nav-plan.md. 이식용 원칙은 claude/design-principles-portable.md, 저장소의 확정 원칙은 docs/design/design-principles.md. 관리자 화면·권한 구조는 claude/admin-permissions-243.md. 그 밖: concept-study-design/phase2, voice-study-design, voice-map-214, digest-reading-plan.
- 디자인 문서(design-principles-238.md)는 255까지의 경과이고, 256~278의 디자인 관련 변경(입력 포커스, 섹션 라벨, OCR 밝은 패널, 토큰 44개, design_lint 기준선)은 concept-map-progress-275.md 9절에 기록. 다음 문서 갱신 때 합칠 수 있음.
- 작업 방식 메모: 지시문에서 커밋과 푸시를 한 명령으로 잇지 않는다(245-1 사고). Claude Code PC의 시각 표기가 KST 표기인데 실제로는 UTC 값이라 9시간 이르니 보고 시각은 믿지 말고 필요하면 사용자 시각으로 확인. 결과 보고가 안 오면 transcript를 검색해 도착 여부를 확인하고, 필요하면 읽기 전용 상태 확인 블록을 쓴다(278-1 사례).
