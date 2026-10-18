# METIS-3 오케스트레이터 인수인계 (새 채팅 시작용)

기준일: 2026-10-16. 이 채팅의 역할과 작업 규칙, 현재 위치를 적은 문서. 자세한 기록은 각 문서 참고.

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

## 현재 위치 (2026-10-16)
- origin/master = 4815c63 (295-1), 작업 트리 깨끗. sw.js CACHE_NAME metis-v45. DB init 총 36단계(286-1에서 35→36). 마지막 전체 테스트는 278-1의 974건 통과(6분 3초). 280-1~295-1은 관련 묶음만 실행(295-1 389건).
- **개념 지도 구현 완료**(1~5b, UI 개편, 개념학습 의존 제거, 모르는 개념 표시, 표시 개념 퀴즈, **말로 설명하기(주관식·음성 답변·AI 평가) + 최근 부족 목록**) 및 **OCR 터치 선택(272)** 배포. 작업↔커밋 표, 구현 결정, 향후 과제, 확인 대기 목록은 **claude/concept-map-progress-275.md**(6b에 2단계 상세). 설계 배경은 claude/concept-map-redesign.md.
- **사용자 폰 확인은 전부 보류**(2026-10-14): Railway 로그 "[DB] cmap_edges: 관계 종류 10값, 문구 선택화"와 "[DB] init done: 총 36단계, 실패 0단계", 개념 지도 화면 전체, 275-4·275-5, 278-1(말로 설명하기), 280-1·280-2(내비 4탭·키보드·정의/예시 설명 품질), 282~287(심화 개념 실제 Haiku, 지도 만들기 첫 화면, 저장하고 해설, 툴바 [더보기], 관계 10종·대립 점선·문구 생략, 1:n 연결은 확인 완료), 290~295(선 모양, 편집 시트 간략 설명, PDF 저장의 한글·긴 제목, 배치 최적화에서 8개 층의 글자 크기; 배치 최적화 결과는 확인 완료), OCR 터치 선택. 확인 항목 상세는 claude/concept-map-ui-280.md 12절. 새 캐시(v45)를 받으려면 앱을 완전히 닫았다가 재실행.
- **화면 구조 개편(2026-10-15, 사용자 제안 → 검토·합의 → 280-1·280-2 배포)**: 랜딩(주제 목록) → 주제 추가 → 최하위 주제에 머무는 주제 안 화면(하단 입력 바, 정의/예시 2항목, 자동 저장, 삭제) + 하단 내비 4탭(주제/퀴즈/지도 만들기/오답노트). 상세는 claude/concept-map-ui-280.md. 진행 기록 문서의 4·6·6b·11절은 이전 구조 기록이고 12절이 현재 구조.
- **282~287(2026-10-15~16, 사용자 폰 사용 중 보고 → 조사 → 합의 → 배포)**: 심화 개념(최대 3개, 282-1·283-2), 지도 만들기 첫 화면과 캐시 불일치 방지(283-2), 지도 저장 안내·툴바 정리(285-1), 관계 10종·방향 없음·문구 선택·DB 36단계(286-1), 1:n 일괄 연결(287-1). 상세는 claude/concept-map-ui-280.md 7~12절. 새 DB 단계(36)는 실제 PostgreSQL 적용 로그 미확인.
- **290~295(2026-10-16, 사용자 보고·요청 → 조사/상의 → 배포)**: 선 접속면·겹침 완화(290-1), 편집 시트 간략 설명(291-1·291-2), 지도 PDF 저장과 제목 경로(292-1·293-1), 계층 배치 최적화(294-1·295-1, 방향 있는 연결은 화살표 시작이 위: 사용자 결정). 상세는 claude/concept-map-ui-280.md 13~17절. 미결: 일부·종류 안내 문구·해설이 "앞이 뒤의 일부/종류(앞=하위)"라 배치(앞이 위)와 어긋남.
- 다음 후보: 일부·종류 안내 문구·해설 정리 여부 결정, 읽기 전용 지도 [PDF 저장] 추가, 3차(지도 만들기·퀴즈·오답노트 탭 정리, 폰에서 써 본 뒤 불편한 곳 기준), 오답노트 운영 방식 검토(틀린 연결은 문항별 저장이 없어 새 저장 필요).
- 합의된 향후 과제(미착수): 리마인딩 확장(목록에서 재출제·간격 반복 등, 필요할 때 검토), 개념 지도 vs 개념학습 비교 후 하나 삭제.
- 2단계 설계 결정(2026-10-14): 질문 문장 없이 개념 이름만 제시, 녹음 원문은 보여 주거나 저장하지 않고 AI가 정리한 요약만 표시·저장, 전사 확인 단계 없음, 한도 전사 20/일·평가 30/일, 리마인딩은 최근 부족 목록만. 개념학습에는 주관식 평가가 원래 없었음(277-1 조사).
- 변경 금지 파일(매 작업 diff 0줄 확인): concept_study.html, routes/concept_study.js, lib/concept_links_b2.js, public/js/map/mapCore.js, voice_study.html. 개념 지도 코드는 개념학습 파일을 불러오지 않는다(275-1, 278-1에서도 유지).
- 이전 위치(2026-10-10, 정리 작업 완료, 음성 지도 이식, 227 지도 품질, 디자인 적용 245~255)의 상세는 claude/cleanup-plan.md, claude/voice-map-214.md, claude/map-quality-227.md, claude/design-principles-238.md 참고. 그때의 사용자 확인 대기(사전 폰 지도, Console 비용)는 미확인으로 남음. Railway에는 lucky-truth의 metis3-app + Postgres-dyGe(운영 DB)만 남음.
- UI 통일·하단 내비 이력은 claude/ui-unify-plan.md, claude/bottom-nav-plan.md. 이식용 원칙은 claude/design-principles-portable.md, 저장소의 확정 원칙은 docs/design/design-principles.md. 관리자 화면·권한 구조는 claude/admin-permissions-243.md. 그 밖: concept-study-design/phase2, voice-study-design, voice-map-214, digest-reading-plan.
- 디자인 문서(design-principles-238.md)는 255까지의 경과이고, 256~278의 디자인 관련 변경(입력 포커스, 섹션 라벨, OCR 밝은 패널, 토큰 44개, design_lint 기준선)은 concept-map-progress-275.md 9절에 기록. 다음 문서 갱신 때 합칠 수 있음.
- 작업 방식 메모: 지시문에서 커밋과 푸시를 한 명령으로 잇지 않는다(245-1 사고). Claude Code PC의 시각 표기가 KST 표기인데 실제로는 UTC 값이라 9시간 이르니 보고 시각은 믿지 말고 필요하면 사용자 시각으로 확인. 결과 보고가 안 오면 transcript를 검색해 도착 여부를 확인하고, 필요하면 읽기 전용 상태 확인 블록을 쓴다(278-1 사례). 증상이 불분명한 보고("반응이 없다", "안 된다")는 구분 질문을 먼저 하고, 읽기 전용 진단 블록(283-1, 284-1) 뒤에 수정 블록을 낸다. 배포 때 sw 버전과 지도 HTML의 JS ?v= 값을 함께 올린다(정합 테스트 있음). 지시문에 "커밋과 푸시는 별도 명령"이라고만 쓰면 Claude Code가 대기하는 것으로 읽을 수 있으니(291-1), "테스트 통과 후 바로 실행, 서로 이어 쓰지 말고 별도 명령"이라고 쓴다.

## 작가 노트 (작업 130~135, 기준일 2026-10-18)
음악·미술 작가의 삶과 대표작을 가볍게 읽는 새 메뉴(/artist_notes.html). 한입 독서·과학과 코드·데이터·localStorage를 공유하지 않는 복제 독립 구조. 아래 값은 코드·JSON·검증 스크립트에서 확인한 것([확인함]).

### 작업 이력 (커밋 해시는 git log 기준)
- 130: 한입 독서 UI 구조 조사, 작가 노트는 복제 독립 방식(과학 메뉴와 같은 방식)으로 결정. 해시 미확인. 참고: git의 "(작업130)" 커밋 d030dcf는 한입 독서 "수필" 장르 신설(2026-10-01)로 이 조사와 다른 작업이다.
- 131-1 (c52c1fc): 작가 노트 메뉴·화면·데이터 구조 구현(샘플 2명: 베토벤·고흐), 홈 메뉴 추가.
- 132 (a40bd43): 하단 내비(홈/정복/퀴즈), 정복하기, 작품 소개 그룹(대표작 + 그 밖의 작품), 연결 작가 구조 도입. 퀴즈 탭은 "준비 중".
- 133 (b76841b): 작가 4명(모네·김환기·모차르트·쇼팽) 추가, 총 6명(음악 3, 미술 3).
- 134 (1d17e6f): 표시 이름(통용명 + 풀네임), 문단 나눔, 연결 작가를 같은 사조 기준으로 재정비하고 링크로 전환.
- 135 (e984e80): 모네 연결에서 마네 삭제(모네의 연결은 르누아르 1명), tablet_layout 테스트 제목 "6개 화면"→"7개 화면". 문서 반영(이 절, 별도 커밋).

### 새로 생긴·바뀐 파일
- public/artist_notes.html, public/artist_notes_db.json, scripts/validate_artist_notes.js
- package.json: `"validate:artist_notes": "node scripts/validate_artist_notes.js"` 1줄
- 홈 메뉴: home-wheel/src/HomeWheelApp.jsx의 OPTIONS에 `artist_notes`("작가 노트") 1줄 → 기본 7개(개념 지도 권한 사용자는 추가 1개). 홈을 고치면 `npm run build:home` 뒤 public/home 산출물(index.html, 해시 붙은 js)을 함께 커밋해야 한다(131-1에서 그렇게 함).
- 테스트: tests/design_tokens.test.js(파일 목록에 artist_notes.html), tests/ui/tablet_layout.ui.test.js(SCREENS에 artist: 목록·상세·정복·퀴즈 상태), tests/ui/reading_bottom_nav.ui.test.js(FILES에 art, 구조 테스트 라벨 목록, 사양 비교 루프).

### 데이터 구조 (public/artist_notes_db.json, version 0.4)
- 최상위: version, last_updated, artists[]. 현재 6명: artist_001 베토벤, 002 고흐, 003 모네, 004 김환기, 005 모차르트, 006 쇼팽.
- 작가 필드: id, name(통용명), full_name(풀네임, 같아도 됨), name_original, field(음악|미술), birth_year, death_year, nationality, one_line, who, life, movement{name, tags[], text}, featured_works[{title, year, description, interpretation}], other_works[{title, year, note(선택)}], reputation{contemporary, posthumous}, summary, connected_artists[{name, reason, id}], checked, sources[].
- 문단 구분은 본문 문자열 안의 빈 줄("\n\n")이며 화면이 문단마다 따로 그린다.
- 수록·검증 규칙(scripts/validate_artist_notes.js가 검사하는 것):
  - 고인만 수록(death_year 정수, birth_year보다 큼, alive 등 필드 금지). 원문·미디어 필드 금지(full_text, lyrics, lyric, text_original, original_text, score, image, images, audio). 내용은 패러프레이즈만.
  - featured_works 2~3개. other_works는 배열이면 되고 개수 제한은 없음(작성 권장은 3~5개). note는 40자 이하.
  - 카드 본문 400자 이하: who, life, movement.text, 대표작 1건(description+interpretation), reputation(당대+후대 합산), summary. 문단 구분 줄바꿈은 글자 수에 넣지 않음.
  - name·full_name 필수, movement.tags는 비어 있지 않은 문자열 배열.
  - connected_artists 0~3명, reason 40자 이하, id는 null 또는 수록 작가 id.
  - checked·sources는 비어 있으면 "미검증"으로 허용하고 값이 있을 때만 형식(날짜, http(s) URL) 검사. 실행 결과에 미검증 작가 수를 출력.
- **checked·sources는 "출처를 단 날짜와 URL"이며, 내용 검증을 마쳤다는 뜻이 아니다.** 내용 검증은 아직 하지 않았다.
- 연결 작가 규칙: 같은 예술 사조(movement.tags가 하나 이상 겹침)일 때만 연결하고 시대·교류·헌정·가족 등 다른 배경으로는 잇지 않는다. 0명이면 "연결 작가" 카드를 숨긴다. 수록 작가끼리는 양방향으로 맞춘다(검증: id가 있는 연결은 태그 겹침이 없으면 오류, 양방향이 아니면 경고만). 수록 외 작가는 웹 검색으로 같은 사조임을 확인한 경우에만 쓰고 id는 null. 현재 김환기는 태그가 "한국 추상미술"이라 연결 0명(카드 숨김).

### 화면과 동작 (public/artist_notes.html)
- 하단 내비 홈(캐러셀·범례) / 정복 / 퀴즈 3탭. 퀴즈는 "준비 중" 빈 상태이며 문제는 QUIZ_BANK 배열을 채워 확장한다.
- localStorage 키: `artist_notes_conquest_<작가 id>`, `artist_notes_field_filter`. 한입 독서의 전역 함수에 의존하지 않는다.
- 표시 이름: 목록 카드·상세 헤더·정복 탭 행은 통용명 + 풀네임(작은 글씨, 같으면 생략), 상단 바·연결 작가는 통용명만.
- 연결 작가 링크는 수록 작가(id 있음)만 눌러서 이동하고 history에 한 칸씩 쌓는다. 뒤로 가기는 직전 작가로 돌아가며(이때 ‹ 라벨 "이전 작가로"), 이동해도 정복 상태와 필터 상태가 유지된다.
- 권한: artist_notes.html에 perm_* 검사 코드가 없고 홈 OPTIONS 기본 배열에 있어 모든 사용자에게 열려 있다. [미확인: 서버 쪽 접근 제한 여부는 확인하지 않음]

### 삭제할 때 영향 범위
- 새 파일 3개(artist_notes.html, artist_notes_db.json, validate_artist_notes.js) 삭제, package.json의 validate:artist_notes 1줄 삭제, HomeWheelApp.jsx OPTIONS 1줄 삭제 후 홈 재빌드(public/home 산출물 커밋), 테스트 3곳의 목록 항목 제거(design_tokens 파일 목록, tablet_layout SCREENS와 제목 "7개 화면"→"6개 화면", reading_bottom_nav FILES·라벨·루프). 한입 독서·과학에는 영향 없음.

### design_lint 규칙 (tests/design_lint.test.js, 이 화면을 만들며 확인한 것)
- tests/design_lint_baseline.json에 없는 새 HTML 파일은 모든 항목이 0에서 시작해야 한다.
- #hex 직접 지정은 원칙 색이어도 hex_direct로 세어져 실패한다. 새 파일이 var(--color-*)와 단계 안 글자 크기(11·12·13·14·15·16·18·22·32·48)·모서리(0·10·16·50%)만 쓰면 통과한다.
- 이모지 정규식 범위(U+2702~27BF)에 ✓(U+2713)가 들어가 이모지로 센다(코드 주석은 ✓ 같은 텍스트 기호는 제외라고 적혀 있어 불일치). 그래서 작가 노트는 "정복함" 글자만 쓴다.

### 미정·후속 (결정이 아니라 "미정")
- 내용 검증은 일괄로 아직 하지 않음. 우선 볼 대상: 근거를 확인하지 못했다고 보고된 문장들, 한국어 고유명사 표기, 출처가 엇갈린 연도·출생 정보, 연결 작가 중 수록 외 작가의 사조 출처(일부가 여행 정보 사이트·요약 검색 결과). 모네의 sources에는 마네 확인용으로 넣은 URL(britannica.com/print/article/361791)이 남아 있음.
- 퀴즈 문제 작성은 내용 검증 뒤.
- 출처 규칙(비위키 출처 필수 여부 등)은 나중에 정함.
- 문단 균형(베토벤 "삶과 시대" 2줄+5줄 등)은 내용 검증 때 정리.
- 홈 휠 7항목 배치는 부자연스러워 개념학습/개념지도 중 하나를 삭제한 뒤 최적화.
- 미술 장르색(초록)이 디자인 원칙의 "정답 초록"과 의미가 겹침. 정복 표시의 ✓ 허용 여부, 정복 후 글자색 토큰 차이(--coral-ink가 없어 --primary-dark 사용)는 디자인 원칙 문서 정리 때 결정.
- 연결 작가 중 수록 외 작가는 작가가 추가될 때 id를 채워 링크로 전환.
