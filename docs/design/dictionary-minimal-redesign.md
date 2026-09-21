# 사전 화면 미니멀 리디자인 — 디자인 스펙 (2026-09-21 시안 기준)

## 배경
Claude.ai 디자인 캔버스("METIS 사전 앱 디자인")에서 만든 시안을
실제 `public/english_dictionary.html`에 반영하기 위한 참고 문서.

## 컬러 토큰

라이트 모드:
- background: #FFFFFF
- surface (입력창/보조 버튼 배경): #F7F7F8
- text-primary: #1A1A1E
- text-secondary: #6B7280
- border: #E6E6E8
- accent (포인트, 최소한만 사용 — 선택 탭 밑줄, 예문 강조선): #42506A

다크 모드:
- background: #151619
- surface: #1D1E22
- text-primary: #F1F1F2
- text-secondary: #989FA8
- border: #2B2C30
- accent: #A9B7CC

## 타이포그래피
- 폰트: Noto Sans KR (400/500/600/700/800 사용)
- 표제어(단어): 30px, weight 800
- 발음기호: 15px, text-secondary, monospace 계열 폰트
- 뜻풀이 텍스트: 18px, weight 700
- 예문: 15px 기본색 / 번역: 14px text-secondary
- 섹션 라벨(파생어/유의어/Collocation/추가 번역 등): 12px, weight 700,
  letter-spacing 0.06em, uppercase, text-secondary
  ("사전적 의미"라는 라벨 자체는 쓰지 않기로 함 — 뜻풀이 목록이 바로
  나옴)

## 레이아웃 원칙
- 카드 박스, 둥근 뱃지(품사·분류 태그 등) 사용하지 않음 — 텍스트
  계층 + 1px 구분선으로만 구획
- border-radius는 검색창(14px)과 주요 버튼(검색 버튼, 발음 버튼,
  추가 번역 버튼, OCR 스캔 버튼 10~14px, OCR은 원형 유지)에만 적용,
  나머지 요소는 각짐
- 선택 상태(언어 탭)는 색상 단독이 아니라 굵기(700 vs 500) + 2px
  밑줄로 표현
- 예문은 왼쪽 세로선(border-left: 2px solid accent)으로 강조
- 하단 nav의 카운트(단어장/오답노트)는 빨간 배지 대신 라벨 옆 작은
  보조색 숫자로 표시

## 화면 구조 (RealFeatures.dc.html 기준)
1. 헤더: "METIS" 워드마크 + 그 아래 작은 보조색 텍스트로
   "관리자 · {사용자명}", 오른쪽에 텍스트 버튼 "로그아웃"
   (기존의 알약 배지+채워진 버튼 스타일 제거)
2. 검색: 입력창(검색 아이콘 포함) + 오른쪽 별도 "검색" 버튼
3. 언어 탭: 영어/한국어/일본어/중국어 — 국기 이모지 없이 텍스트만
4. 표제어 + 발음기호 + 발음 버튼
5. 뜻풀이 1~N번: 번호 + "품사 · 분류" 보조텍스트 + 뜻(굵게) + 예문/번역
   (세로선 강조), 구분선으로 항목 간 분리
6. 파생어: 단어(굵게) + 품사(보조) + 뜻(보조), 구분선
7. 유의어: 단어(굵게) + 짧은 뜻(보조) + 비교 설명(보조, 여러 줄)
8. Collocation: 구문(굵게) + 뜻(보조) 한 줄
9. 추가 번역: "일본어로 보기" / "중국어로 보기" 버튼 2개
10. OCR 스캔: 화면 우하단 플로팅 원형 버튼 (그레이스케일)
11. 하단 nav: 검색/단어장/퀴즈/복습/오답노트 5개, 가로 스크롤 가능

## 원본 시안 위치
원본은 Claude.ai 디자인 캔버스 "METIS 사전 앱 디자인"에 있으며
(Main.dc.html / Detail.dc.html / RealFeatures.dc.html), James님
계정에서만 열람 가능. 소스 파일 사본은 이 저장소
`docs/design/canvas-source/`에도 보관되어 있음(2026-09-21 기준).
이 문서는 그 결정사항의 텍스트 기록이며, 실제 렌더링 결과와 다를
수 있으므로 적용 시 색상/간격은 이 문서 기준으로, 세부 뉘앙스는
`docs/design/canvas-source/`의 원본 파일이나 캔버스와 비교 확인.
