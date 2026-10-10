# 현재 디자인 현황 집계 (작업 238-2)

기준일: 2026-10-10 (origin/master 4a0c49f 이후 57ac3a7). "지금 앱이 실제로 쓰는 디자인 값"을 모아, 사용자가 미세 조정해 원칙을 확정할 때 쓰는 재료다. 앱 코드는 바꾸지 않았다.
표기: [확인함] = 코드·CSS에서 직접 집계, [추정] = 이름·휴리스틱 기반 판단.

## 0. 집계 방법과 한계
- 대상: public/css/common 3개, public/*.html 7개(admin 포함, home 제외)의 `<style>`, style="" 속성, JS 문자열 안의 인라인 스타일(style.cssText, .style.속성, style: '…'), public/js 9개. 홈 휠 번들(public/home), node_modules 제외.
- 규모: CSS 규칙 1,425개, 인라인 스타일 선언 635개, 전체 선언 6,303개 [확인함].
- 값 합산 기준: 같은 색은 hex 소문자 6자리로 통일(rgb·rgba·var(--x) 해석 포함, 투명도는 `/알파`). var()는 같은 파일의 :root, 없으면 tokens.css 순서로 해석.
- 한계 [추정]: (1) 파서가 `@media` 안·`:hover` 규칙·JS 템플릿 안의 CSS 문자열을 모두 완벽히 구분하지는 못한다. (2) 인라인 스타일은 정적 문자열만 잡히고 계산된 값은 제외. (3) 컴포넌트 분류는 클래스 이름 정규식이라 경계 사례가 섞일 수 있다. (4) 이 환경에서는 외부 글꼴이 차단되어 글꼴은 이름 기준으로만 집계. (5) 개수는 "선언 횟수"이지 "화면에 보이는 요소 수"가 아니다.

## 1. 기존 결정 (문서에 이미 정해진 것)
출처: docs/design/design-principles.md, dictionary-minimal-redesign.md, markdown_20261010/claude/ui-unify-plan.md, bottom-nav-plan.md, C:\dev\metis3-cleanup-228\archive\audit-218-data\census_summary.md.
1. 원칙 문서(2026-09, 사전 시안 기준): 미니멀·콘텐츠 중심, 카드 박스·둥근 뱃지·필 금지(구분은 여백과 1px 선), border-radius는 검색창·주요 버튼에만(10~14px) 나머지는 각지게, 선택 상태는 굵기+밑줄 등 신호 2개 이상, 터치 44px 이상, 포인트색 최소(문서 시안은 슬레이트 #42506A), 아이콘은 인라인 SVG만·이모지 금지, 라이트/다크 토큰 쌍 정의.
2. 사용자 결정(2026-10-07~09, ui-unify-plan): 공용 헤더=사전 모양, 개념학습은 사전 스타일로 맞추고 **다크모드 제거**, 전 화면 **코랄 하나(#e2583b)**, 헤더·버튼·입력창·오류 박스 통일, **박스는 기본적으로 없애고 텍스트 중심**(홈 메뉴·관리자 제외), 페이지 배경·기본 글자색은 **화면별 유지**(푸른 계열 #f5f7ff/#1a1f3c: 사전·개념, 따뜻한 회색 계열 #fafaf9/#1a1a1a: 음성·문학·과학·한입).
3. 버튼 규칙(216~217): 주 동작은 코랄 채움 `.btn`, 보조 동작은 박스 없는 밑줄 텍스트 `.btn.text`(44px, 대비 4.5:1 이상), 위험 동작은 확인창을 거칠 때만 `.btn.text.danger`, 표시 뱃지는 박스·알약 제거(작은 보조색 텍스트 11~12px), 눌리는 링크는 밑줄 텍스트. 퀴즈 보기=구분선 행+○(초록)/✕(빨강). 의도적 박스 유지(허용 목록): 녹음 버튼, 말풍선, 뒤집기 카드, 대화상자, 지도 영역, 구조 막대(하단 내비 등), 입력창, admin 전체.
4. 토큰(201, tokens.css): 버튼 44px·반경 10px·굵기 600, 입력창 10px, 카드 16px, 본문 15px, 콘텐츠 최대 폭 680px, 좌우 여백 16px.
5. 하단 내비(224~226): 사전 사양 통일 — 높이 78px, 윗선 1px, 그림자 `0 -2px 8px rgba(226,88,59,.07)`, 탭 라벨 15px/500(≤460px은 13px), 활성은 위쪽 3px 선+#b8442e. 화면별로 탭 구성은 다름.
6. 섹션 제목 기준(220): 12px/700/코랄 + 아래 2px 코랄 선(사전).
7. 원칙 문서와 현재 코드의 어긋남 [확인함]:
   - 다크 모드 쌍 정의 원칙 ↔ 코드에 다크 모드 없음(prefers-color-scheme·data-theme 0건). 결정 2와 일치하지만 원칙 문서는 갱신되지 않음.
   - 포인트색 슬레이트(#42506A) ↔ 실제 코랄(#e2583b, 글자용 #b8442e). 결정 3이 대체.
   - 배경·글자색 후보값(#F7F7F8/#1A1A1E) ↔ 실제 두 계열(위 2번).
   - "radius는 검색창·주요 버튼만" ↔ tokens.css에 --card-radius 16px이 정의되어 있고 사전의 .result-card가 16px+테두리+코랄 그림자(박스 카드)를 유지.
   - 218 감사 때 지적된 사전 .btn 14px/padding 12 20 ↔ 다른 화면 15px/10 20(잔여).

## 2. 코드 집계

### 2-a. CSS 변수 [확인함]
- 이름 64종. 공용 정의는 tokens.css 11개(--body-font-size 15px, --btn-primary-bg #b8442e / hover #9c3a27 / active #86311f, --btn-radius 10px, --btn-weight 600, --card-radius 16px, --content-max 680px, --ctl-min-h 44px, --gutter 16px, --input-radius 10px, --msg-radius 10px)와 appHeader.css의 --metis-coral(#e2583b). 나머지 약 52종은 각 화면의 :root에 따로 정의.
- 같은 역할의 변수 이름이 두 갈래:

| 역할 | 푸른 계열(사전·개념·admin) | 따뜻한 회색 계열(음성·문학·과학·한입) |
|---|---|---|
| 글자 | --text #1a1f3c | --text1 #1a1a1a |
| 보조 글자 | --text2 #4a5070 | --text2 #6b7280 |
| 바탕 | --bg #f5f7ff | --bg #FAFAF9 |
| 면 | --surface #ffffff | --card #FFFFFF |
| 포인트 | --accent #e2583b, --accent-text #b8442e | --primary #e2583b, --primary-dark #b8442e, --primary-light #FDF0EC |
| 선 | --border / --line #dde2f5 | --border rgba(0,0,0,0.08) |
| 오류 | --danger #B42318(개념) · #dc2626(사전·admin) | --error #E24B4A, --error-dark #B42318, --error-light #FCEBEB |
| 성공 | --success #1D9E75(개념)·#16a34a(admin), 글자 --success-dark #085041 | --success #1D9E75, --success-dark #085041, --success-light #E1F5EE |

- 사전 전용 추가: --accent-ja/ko/zh(#b3261e/#e67e22/#c0392b), --accent2 #f54a7a(핑크), --accent3 #16a34a, --correct/--wrong 계열, OCR 전용 --ocr-*(어두운 화면: #0d0d10, #f5f2ed 등). admin 전용: --text3 #9398b5, --warn #d97706, --radius 12px. 지도 전용: --vm-focus·--vm-node-line·--node-line.
- 다크 모드: 없음(0건) [확인함].

### 2-b. 색상 상위 15 (합산, 선언 횟수)
| 색 | 횟수 | 주 용도 | 대표 파일 |
|---|---|---|---|
| #1a1a1a | 133 | 글자(따뜻한 계열) | science_reading, digest_reading |
| #e2583b | 128 | 포인트(선·강조 테두리 65, 글자 21) | english_dictionary, concept_study |
| #6b7280 | 117 | 보조 글자(따뜻한 계열) | voice_study, literature_compass |
| #4a5070 | 112 | 보조 글자(푸른 계열) | english_dictionary, concept_study |
| #ffffff | 103 | 면 바탕 61, 글자 31 | english_dictionary, voice_study |
| #b8442e | 92 | 코랄 글자 62, 채움 19 | literature_compass, voice_study |
| #dde2f5 | 79 | 선(푸른 계열) | english_dictionary, concept_study |
| #1a1f3c | 79 | 글자(푸른 계열) | english_dictionary, concept_study |
| #000000/0.08 | 54 | 선(따뜻한 계열) | voice_study, literature_compass |
| #b42318 | 37 | 오류·위험 글자 | concept_study, literature_compass |
| #085041 | 35 | 성공·정답 글자 | literature_compass, digest_reading |
| #dc2626 | 21 | 사전 오답·admin 위험 | english_dictionary, admin |
| #fdf0ec | 20 | 코랄 옅은 바탕 | digest_reading, literature_compass |
| #eef1fb | 19 | 푸른 계열 옅은 면 | english_dictionary |
| #fafaf9 | 19 | 따뜻한 계열 페이지 바탕 | voice_study, digest_reading |
- 16위 이하 눈에 띄는 것: #9c3a27(코랄 hover, 13), #9398b5(admin 보조 글자, 11), #e24b4a(읽기·음성 오류, 11) [확인함].
- 핵심: 같은 코랄도 #e2583b(선·큰 요소)와 #b8442e(글자, 대비 확보용)로 역할이 갈려 있음. 성공 초록은 #1D9E75 / #16a34a / #085041 세 값이 역할별로 공존.

### 2-c. 글자
- font-family(선언 횟수): sans-serif 105, Noto Sans KR 60, Sora 30, Inter 20, inherit 4, ui-sans-serif 1, system-ui 1. 본문 스택은 푸른 계열 `'Noto Sans KR', sans-serif`(사전·개념·admin) 대 `'Noto Sans KR', 'Inter', sans-serif`(음성·문학·과학·한입). Sora는 사전의 표제·숫자용으로 보임 [추정].
- font-size 상위 12: 13px 105 · 12px 97 · 14px 83 · 15px 58 · 11px 44 · 17px 18 · 20px 17 · 22px 14 · 16px 14 · 42px 9 · 18px 8 · 32px 5. 본문은 15px(tokens --body-font-size), 입력창은 16px(사전·음성) 또는 inherit 15px(개념).
- font-weight: 700 ×186, 600 ×55, 500 ×47, 800 ×30, 400 ×14.
- line-height: 1.6 ×33, 1.5 ×32, 1 ×13, 1.3 ×10, normal ×6, 1.4·1.8·1.7 각 6. 본문 기본은 개념만 body에 1.6 지정.

### 2-d. 간격 (padding·margin·gap)
- 값 상위(횟수): 0 ×262 · 8px ×190 · 10px ×132 · 12px ×126 · 16px ×118 · 4px ×94 · 20px ×81 · 6px ×80 · 14px ×58 · 2px ×49 · 24px ×46 · 18px ×18 · -16px ×15 · 28px ×12.
- 단위 규칙 [추정]: 4px 배수(4·8·12·16·20·24·28)가 주류지만, 4 배수가 아닌 10·6·14·18·2px도 합계 약 340회로 많아 "4/8px 격자"가 엄격히 지켜지지는 않는다. 공용 좌우 여백은 16px(--gutter).

### 2-e. 모양
- border-radius: 0 ×59 · 10px ×34 · 4px ×18 · 50% ×17 · 16px ×12 · 3px ×10 · 20px ×8 · 14px ×5 · 999px ×4 · 8px ×4 · 2px ×4 · 12px ×3. 알약(999px·20px 등)은 사전의 팟캐스트·OCR 버튼 쪽에 집중 [추정, 238-1 측정과 일치].
- box-shadow: 사실상 3종 — 하단 내비 `0 -2px 8px rgba(226,88,59,.07)`(6회), 사전 결과 카드 `0 4px 20px rgba(226,88,59,.08)`, `0 8px 24px rgba(26,31,60,.12)`(대화상자 계열로 보임 [추정]); 그 밖 선택 표시용 inset(코랄 링 2px, 3px 세로선) 등. 읽기·음성 카드는 그림자 없음.
- border 굵기: 1px ×108 · 2px ×39 · 3px ×13 · 1.5px ×7 · 4px ×1 · 2.5px ×1. 1px은 `--border`/`--line`, 2~3px은 포인트색 강조선·활성 표시.

### 2-f. 레이아웃
- 콘텐츠 최대 폭 680px(--content-max, 16곳). 예외: admin 1200px, 공용 헤더 내부 420px, 대화상자 min(420px, 100vw-32px) [확인함].
- 좌우 여백 16px(--gutter, 화면 제목 바·하단 내비·.wrap).
- 높이: 공용 헤더 min-height 65px(padding 8 16, 아래 1px #dde2f5), 화면 제목 바 56px, 하단 내비 78px(+ safe-area 하단 padding max(8px, env(safe-area-inset-bottom))), 탭 터치 높이 44px.
- 안전영역: env(safe-area-inset-bottom) 18회, 위·좌우 0회 [확인함]. 100dvh 10회(100vh 폴백 쌍 포함 2회), 80vh 2회.
- @media 중단점: max-width 460px ×8(하단 내비 라벨 13px 등), min-width 768px ×3(대화상자·지도 팝업), max-width 640px ×2. 태블릿 이상 전용 레이아웃은 거의 없고 콘텐츠를 가운데 680px로 모은다 [추정].

## 3. 컴포넌트별 변형 수 [추정 — 클래스 이름 정규식 + 스타일 조합 기준]
"클래스 수" = 해당 역할로 보이는 서로 다른 클래스 이름, "변형 수" = 그 규칙들 중 (배경·테두리·반경·패딩·글자 크기·그림자) 조합이 서로 다른 것(변수만 쓰는 규칙은 제외).

| 컴포넌트 | 클래스 수 | 스타일 변형 수 | 대표 클래스 |
|---|---|---|---|
| 버튼 | 41 | 34 | btn, quiz-next-btn, ox-btn |
| 카드·박스 | 44 | 27 | map-box, quiz-card, carousel-card |
| 뱃지·태그·칩 | 43 | 16 | label, result-section-label, quiz-round-label |
| 입력창 | 13 | 7 | search-input, field-label, search-input-wrap |
| 모달·시트 | 5 | 6 | vm-sheet, map-sheet, sheet-head |
| 안내·토스트 | 20 | 10 | result-msg, msg, correct-hint |
| 목록 행 | 53 | 23 | related-item, result-wrong-item, conq-row |
| 탭·세그먼트·내비 | 19 | 11 | bottom-nav-tab, bottom-nav, bottom-nav-tabs |
- 버튼 종류 실측(238-1, 초기 화면, 본문 버튼 수: 텍스트/박스/알약/주 동작 채움): 사전 15/12/22/1(대부분 숨김 패널), 문학 7/8/0/1(박스 8=시대 막대 허용), 한입 6/0/0/0, 과학 4/0/0/0, 음성 28/1/1/18, 개념 9/0/0/3, admin 2/2/0/1. 하단 내비와 헤더 버튼은 admin 헤더 2개를 빼고 모두 텍스트형.
- 읽는 법: 같은 역할인데 클래스가 화면마다 따로 있어 "버튼 41개 클래스"는 실제 디자인 종류 41개가 아니라 이름 중복이 많다. 그래도 스타일 조합이 34종이면 통일 여지가 큼 [추정].

## 4. 공용 vs 화면 전용 [확인함]
공용 파일: css/common/tokens.css, appHeader.css, screenBar.css, js/common/appHeader.js, dialog.js.

| 화면 | 전체 줄 | `<style>` 줄 | 자체 규칙 | 자체 선언 | 인라인 선언 | var() 사용 | 그중 공용 변수 | 공용 CSS 링크 |
|---|---|---|---|---|---|---|---|---|
| english_dictionary | 4,195 | 1,484 | 298 | 1,332 | 287 | 307 | 14 (5%) | 2 |
| voice_study | 3,354 | 420 | 243 | 878 | 201 | 195 | 27 (14%) | 3 |
| concept_study | 2,105 | 361 | 247 | 837 | 8 | 163 | 14 (9%) | 3 |
| literature_compass | 1,607 | 557 | 202 | 836 | 41 | 159 | 31 (19%) | 3 |
| science_reading | 1,709 | 451 | 169 | 679 | 34 | 138 | 21 (15%) | 3 |
| digest_reading | 1,518 | 464 | 160 | 652 | 38 | 131 | 21 (16%) | 3 |
| admin | 538 | 175 | 75 | 272 | 26 | 50 | 0 (0%) | 1 |
- 화면 전용 정의가 가장 많은 5개: 사전(1,332), 음성(878), 개념(837), 문학(836), 과학(679).
- 요약: 화면마다 CSS를 약 650~1,330 선언씩 따로 가지고 있고, 공용 변수 사용 비율은 0~19%에 그친다. 공용 CSS는 변수 11개와 헤더·제목 바뿐이고, `.btn`·`.btn.text`·`.bottom-nav`·`.msg` 등은 화면마다 따로 정의되어 있다(.btn.text는 개념·음성 두 화면에 각각).

## 5. 불일치 후보 상위 10 [확인함: 값 / 추정: 영향]
| # | 같은 역할 | 화면별 값 |
|---|---|---|
| 1 | 페이지 바탕·기본 글자색 | 사전·개념 #f5f7ff / #1a1f3c, 음성·문학·과학·한입 #fafaf9 / #1a1a1a, admin #fff / #1a1f3c (사용자 결정으로 두 갈래 유지) |
| 2 | 보조 글자색(--text2) | 사전·개념·admin #4a5070, 음성·문학·과학·한입 #6b7280 |
| 3 | 구분선 색 | 사전·개념·공용 헤더 #dde2f5, 음성·읽기 3화면 rgba(0,0,0,.08) — 같은 화면 안에서 공용 헤더 선(푸른)과 본문 선(검정 8%)이 다를 수 있음 [추정] |
| 4 | 오류·위험 색 | 개념 #B42318, 사전·admin #dc2626, 음성·읽기 #E24B4A(+글자 #B42318) |
| 5 | 변수 이름 체계 | --text/--text1, --surface/--card, --accent/--primary, --line/--border, --danger/--error 등 같은 역할이 두 이름 계열 |
| 6 | 기본 `.btn` 의미·크기 | 사전: 코랄 채움 14px, padding 12 20 / 음성: 코랄 채움 15px, padding 10 20 / 개념: **옅은 파랑 #eef1fb 면**(주 동작은 `.btn.primary`로 따로) |
| 7 | `.btn.text` 색 | 개념 #4a5070, 음성 #6b7280 (모양은 동일: 밑줄·15px·600·44px, 공용 승격 안 됨) |
| 8 | 카드·면 | 사전 결과 카드 radius 16px+1px 테두리+코랄 그림자 / 음성·읽기 카드 radius 0, 테두리·그림자 없음 / tokens.css의 --card-radius 16px은 읽기·음성에서 미사용 |
| 9 | 입력창 | 개념: padding 11 12, min-height 44, 글자 inherit(15px) / 음성: padding 12 14, 16px / 사전: padding 12 40 12 16, 16px (테두리 1px, 반경 10px은 공통) |
| 10 | 섹션 제목 | 코드 확인: 문학 `.section-label` 12px/700/#b8442e+2px 코랄 선, admin `.section-title` 12px/700/#9398b5 대문자, 사전 `.section-title` 18px/700(다른 용도). 218 감사 값(코드로 재확인 안 함): 사전 12px 코랄+2px 선(기준), 개념 12px #4a5070 선 없음, 음성·과학·한입 13px #3a3a40 선 없음 |
- 그 밖: 글꼴 스택에 Inter 포함 여부(4화면 포함, 3화면 미포함), 성공 초록 3종(#1D9E75, #16a34a, #085041), 사전 전용 색(핑크 --accent2 #f54a7a 확인, 보라 그라데이션은 ui-unify-plan 기록 기준), 안내 글자 크기(.msg 13px, .error-msg 14px, .result-msg 16px) [확인함].

## 6. 원칙 확정 때 쓸 수 있는 선택지 (메모, 결정은 사용자)
1. 색: 두 갈래 유지 여부(결정 6) / 공용 변수 이름 한 세트로 통일할지(이름만 통일하면 값은 화면별 유지 가능).
2. 버튼: `.btn`·`.btn.text`·`.btn.text.danger`를 tokens.css로 승격할지(sw 버전 올림과 var() 대체값 필요, ui-unify-plan 후속 후보).
3. 오류·성공 색 값을 화면 간 맞출지(#B42318 / #dc2626 / #E24B4A).
4. 원칙 문서(design-principles.md)를 현재 결정에 맞게 갱신할지(다크 모드·포인트색·배경색 항목).
5. 사전의 박스·알약(단어장 사이드 버튼, 팟캐스트·OCR)을 텍스트형으로 바꿀지(238-1 조사 참고).
