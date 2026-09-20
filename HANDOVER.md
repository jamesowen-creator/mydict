# METIS-3 인수인계서

이 문서는 다른 세션(방)으로 넘어가는 사람이 이 프로젝트의 맥락을 빠르게
파악할 수 있도록 작성됨. 작업 진행 이력은 `PROJECT-STATUS.md`, 향후
과제 목록은 `PRD.md`의 "8. 향후 고려 기능 (백로그)" 섹션 참고.

---

## 1. 프로젝트 개요

METIS는 개인용 학습 플랫폼으로, 하나의 Node/Express 서버가 여러 학습
도구를 서브 앱 형태로 제공한다.

| 경로 | 앱 | 형태 |
|------|----|------|
| `/` | 홈 화면 (3D 휠 피커로 하위 앱 선택) | React/Vite 서브앱(home-wheel) 빌드 결과물 |
| `/english_dictionary.html` | 영어 사전 — 단어 검색, 단어장, 퀴즈, 복습(SRS) | Vanilla HTML/CSS/JS (빌드 없음, 인라인 `<script>`) |
| `/literature_compass.html` | 문학 나침반 — 문학 사조 타임라인 | Vanilla HTML/CSS/JS |
| `/digest_reading.html` | 한입 독서 — 독서 요약 | Vanilla HTML/CSS/JS |
| `/metacong/` | MetaCong — 한국사·세계사 음성 학습 퀴즈 | **이 저장소에 소스 없음** — 외부에서 빌드된 정적 산출물만 존재 |
| `/admin` | 관리자 패널 — 사용자 관리/권한/사용량 통계 | Vanilla HTML/CSS/JS |

**기술 스택**
- Backend: Node.js + Express, PostgreSQL(`pg`), Claude Haiku(`@anthropic-ai/sdk`, 사전 검색·MetaCong 문답), OpenAI TTS
- 인증: Google OAuth(Passport) + JWT(`jsonwebtoken`), 관리자는 `ADMIN_EMAILS` 이메일 목록으로 판별
- Frontend: 대부분 Vanilla HTML/CSS/JS(빌드 과정 없음) + `home-wheel/`(React+Vite, 홈 화면 3D 휠) + MetaCong(외부 React+Vite 빌드 산출물)
- 배포: Railway (NIXPACKS 빌드, `npm start` → `node server.js`)

---

## 2. 배포 정보

- **GitHub:** `jamesowen-creator/mydict` (저장소 이름 자체는 역사적으로 "mydict"이지만 앱 브랜드는 METIS), `master` 브랜치에 push하면 배포됨
- **Railway 프로젝트:** `lucky-truth` / `production` 환경, 서비스명 **`metis3-app`**, DB는 **Postgres-dyGe**
- **배포 URL:** `metis3-app-production.up.railway.app`
- **⚠️ 주의:** 같은 GitHub 저장소를 바라보는 **다른 Railway 서비스(`mydict`, 완전히 별개의 DB/도메인)**가 존재함. 이 저장소에 push하면 두 서비스가 모두 재배포되므로, 어느 서비스의 로그/DB를 보고 있는지 항상 확인할 것 — 혼동하기 쉬움.
- **환경변수 목록** (이름만 — 값은 여기에 절대 적지 않음):
  - `ANTHROPIC_API_KEY`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_CALLBACK_URL`
  - `JWT_SECRET`
  - `SESSION_SECRET`
  - `DATABASE_URL`
  - `OPENAI_API_KEY`
  - `ADMIN_EMAILS`
  - `APP_PASSWORD` — 지시서 목록에는 없었지만 코드에 실제로 존재함(`server.js`의 레거시 `/api/auth` 비밀번호 인증에서 사용, 미설정 시 인증 없이 통과). 아래 "죽은 코드" 항목 참고.
  - `PORT` — Railway가 자동 주입하는 표준 변수, 별도 설정 불필요.
- **로컬 개발 환경 상태 (확인 시점 기준):** 로컬 `.env`에는 `ANTHROPIC_API_KEY`만 설정되어 있고 `DATABASE_URL`/`GOOGLE_CLIENT_ID` 등은 없음 → 로컬에서는 Google 로그인, DB 저장(단어장/승인 등)이 전부 비활성. 세션 내내 이 제약으로 인해 다수의 로컬 테스트가 "500/기능 정상이나 저장 안 됨" 형태로 나타났음(버그 아님).

---

## 3. 아키텍처 요약

- **`server.js`**: 라우터를 mount만 하는 얇은 진입점(162줄, 리팩터링 전 ~1,025줄 — 아래 작업 이력 참고). 레거시 엔드포인트 4개(`/api/files`, `/api/debug`, `/api/auth`, `/api/search`)가 정리 대상에서 명시적으로 제외된 채 그대로 남아있음.
- **`routes/{auth,dictionary,wordbook,tts,admin,metacong}.js`**: 기능별 Express 라우터. 실제 비즈니스 로직은 대부분 여기 있음.
- **`middleware/auth.js`**: `requireAuth`(JWT 검증만, DB 조회 없음), `requireAdmin`(ADMIN_EMAILS 우선 확인 후 DB role 재확인 — JWT payload의 role은 신뢰하지 않음), `checkPermission`(is_blocked 기반, 일부 API에만 적용), `extractOptionalUser`.
- **`lib/db.js`**: pg Pool + `initDB()`(서버 기동 시 실행되는 멱등 마이그레이션, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 방식) + `trackUsage()`.
- **`home-wheel/`**: React+Vite 소스. `npm --prefix home-wheel run build` (또는 `npm run build:home`)로 빌드하면 `public/home/`에 결과물이 생성됨. **이 빌드는 Railway 배포 파이프라인이 자동으로 실행하지 않음** — `package.json`의 `start` 스크립트는 `node server.js`뿐이고 `railway.toml`도 별도 빌드 커맨드가 없음. 즉 `home-wheel/src/*`를 고치면 **로컬에서 직접 빌드해서 `public/home/`의 결과물까지 git에 커밋**해야 배포에 반영됨(이번 세션 내내 이렇게 처리함).
- **`public/metacong/`**: **이 저장소 안에 소스가 없는 외부 빌드 산출물**(`index.html`이 아직 손대지 않은 기본값 `<title>vite-tmp</title>`를 갖고 있는 것이 외부 프로젝트에서 빌드되어 복사돼 들어왔다는 정황 증거). 이 저장소에서 React 코드 자체를 직접 수정하는 것은 불가능함. 필요한 경우, 정적 `index.html`에 `<link>`/`<script>` 태그를 얹는 방식으로 우회 가능 — 공용 헤더(`public/js/common/appHeader.js`, `public/css/common/appHeader.css`, 프레임워크 비의존적인 순수 DOM 스크립트)가 정확히 이 방식으로 들어가 있음. 아래 "알려진 이슈" 참고.
- **공용 모듈**: `public/js/common/appHeader.js` + `public/css/common/appHeader.css` — 사전/문학나침반/한입독서/관리자/MetaCong 5개 화면이 전부 공유하는 상단 헤더(로고 + 로그인 상태별 위젯). `home-wheel/src/auth.js`의 getToken/fetchMe 패턴을 모듈 시스템 없는 plain `<script>` 환경으로 이식한 것.

---

## 4. 알려진 이슈 / 리스크

- **MetaCong 공용 헤더는 정적 파일 패치**: `public/metacong/index.html`은 이 저장소 빌드 과정으로 생성되는 파일이 아니라서, 외부에서 MetaCong이 재빌드되어 그 산출물이 다시 통째로 복사돼 들어오면 헤더 삽입 코드(2줄)가 **아무 보호 장치 없이 조용히 사라짐**. 재동기화가 있었다면 이 부분을 다시 확인/추가해야 함.
- **is_blocked/is_approved 체크 사각지대**: `checkPermission()`(is_blocked 기반)이 `dictionary.js`/`tts.js`/`wordbook.js`/`server.js`의 `/api/search`에만 적용되고, review/dashboard류 엔드포인트에는 적용되지 않음. 실사용 피해는 낮다고 판단해 보류 중.
- **승인 취소는 로그인 시점에만 체크**: 이미 발급된 JWT는 만료(7일) 전까지 유효하며, 매 요청마다 is_approved/is_blocked를 재검증하지 않음. 관리자가 승인을 취소해도 즉시 반영되지 않음.
- **정체불명의 로그인 루프 (미확정, 재현 중단됨)**: 관리자 계정 세션 중 한 번 원인 불명의 로그인 루프가 보고되어 조사했으나(`[auth-debug]`/`[me-debug]` 임시 로그까지 추가해 서버 쪽은 전부 정상으로 확인됨 — is_approved/is_blocked 값, `/api/me` 응답 전부 정상), 클라이언트 측 원인을 좁히던 중 재현 자체가 멈춰서 최종 원인은 미확정 상태로 남음. 관련 조사는 커밋 이력상 "OAuth 로그인 루프"/"is_approved"/"auth-debug" 관련 커밋들(예: `2c8396d`~`d5ce3c4` 구간)에서 확인 가능. 재발 시 이 구간부터 참고할 것. 조사 과정에서 실제로 발견되어 고쳐진 진짜 버그 2건(OAuth 콜백이 로그인 시작 페이지가 아니라 항상 `/`로만 리다이렉트되던 회귀, JWT payload를 `atob()`만으로 디코딩해 한글 이름이 깨지던 문제)은 커밋에 반영되어 있음.

---

## 5. 죽은 코드 / 미정리 항목

식별만 되어 있고 실제 삭제는 되지 않은 것들 (전부 이번 인수인계 시점에
코드로 직접 존재 확인함):

- `server.js`의 `/api/files`, `/api/debug`(환경변수 존재 여부/길이 노출 — 보안상 제거 권장), `/api/auth`(레거시 `APP_PASSWORD` 인증), `/api/search`(구버전 사전 검색 — 지금은 `routes/dictionary.js`의 `/api/ai`가 실제로 쓰임) — `server.js` 55번째 줄 주석에 "작업3 정리 범위에서 명시적으로 제외"라고 남아있음
- `public/english_dictionary.html`의 `#page-home` 대시보드 관련 코드(`initDashboard()` 등) — `showPage('home')`을 호출하는 곳이 코드 전체에 하나도 없어 완전히 도달 불가능한 화면임(현재 랜딩은 `#page-search`)
- `openMetaCong()` 함수 — 정의만 있고 호출부가 전혀 없음(완전히 orphaned). MetaCong 진입은 현재 홈 화면의 3D 휠에서 이루어짐(작업8 이후)
- `.wordbook-tabs` CSS 클래스 — 이 클래스를 쓰는 HTML 요소가 전혀 없음(단어장 좌측 레일 2단 레이아웃으로 개편되기 전의 흔적으로 추정)
- `podcastStart()` 함수 — 정의만 있고 호출부 없음(orphaned). 이름이 비슷한 `podcastStartSelected()`(단어장 선택 퀴즈/재생 흐름에서 실제 사용됨)와 혼동하지 말 것

---

## 6. 향후 과제

`PRD.md`의 "8. 향후 고려 기능 (백로그)" 섹션 참고. 이번 인수인계 직전에
OCR 다국어 지원, OCR 인식 정확도 개선 2개 항목이 추가됨.
