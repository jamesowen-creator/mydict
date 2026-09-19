# PRD — METIS (A Lens for the Wisdom)

## 1. 제품 개요

개인용 학습 플랫폼. 하나의 Node/Express 서버가 여러 학습 도구(사전, 문학
타임라인, 독서 요약, 한국사 퀴즈, 관리자 패널)를 서브 앱 형태로 제공한다.

- **배포 환경:** Railway (Node.js, NIXPACKS 빌드)
- **PWA:** manifest.json 등록 (이름: METIS)

---

## 2. 하위 앱 구성

| 경로 | 앱 | 설명 |
|------|----|------|
| `/` | 영어 사전 (english_dictionary.html) | 단어/상용구 검색, Claude가 뜻·예문·어원 생성. 단어장·복습(SRS)·퀴즈 포함 |
| `/literature_compass.html` | 문학 나침반 | 한국 문학 사조를 연표(타임라인)로 표시 |
| `/digest_reading.html` | 한입 독서 | 독서 요약 콘텐츠 제공 |
| `/metacong/` | MetaCong | 한국사·세계사 성취기준 기반 음성 학습 퀴즈 (Vite+React SPA, `routes/metacong.js` API) |
| `/admin` | 관리자 패널 | 사용자 관리, 권한 설정, 사용량/비용 통계 |

---

## 3. 인증

- **비밀번호 인증(레거시):** `APP_PASSWORD` 설정 시 첫 방문 모달 → 통과 시 `localStorage`에 저장. 미설정 시 인증 없이 통과.
- **Google OAuth (passport-google-oauth20):** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 설정 시에만 활성화(`googleOAuthEnabled`). 로그인 성공 시 JWT 발급(`/?token=`), Postgres `users` 테이블에 사용자 저장.
- **관리자 판별:** `ADMIN_EMAILS` 목록에 포함된 이메일은 로그인 시 `role='admin'`으로 설정.
- **세션:** `express-session` (`SESSION_SECRET`), JWT (`JWT_SECRET`).

> 현재 로컬 `.env`에는 `ANTHROPIC_API_KEY`만 설정되어 있어, Google OAuth와
> DB 연동 기능은 로컬에서 비활성 상태로 동작한다. (작업 4 참고)

---

## 4. 기술 스택

| 구분 | 기술 |
|------|------|
| Backend | Node.js + Express |
| Frontend | Vanilla HTML/CSS/JS (사전·문학·독서·관리자) + Vite/React (MetaCong) |
| DB | PostgreSQL (`pg`) — 사용자, 단어장, 복습 기록, TTS 캐시 |
| AI | Claude Haiku (`@anthropic-ai/sdk`) — 사전 검색, MetaCong 문답 |
| TTS | OpenAI API (`OPENAI_API_KEY`), Postgres 캐시 |
| 인증 | 비밀번호 + Google OAuth (Passport) + JWT |
| 배포 | Railway |

---

## 5. 주요 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/search` | 단어 검색 (Claude) |
| POST | `/api/auth` | 비밀번호 인증 |
| GET | `/auth/google`, `/auth/google/callback`, `/auth/logout` | Google OAuth 플로우 |
| GET | `/api/me` | 로그인 사용자 정보 |
| GET/POST/DELETE | `/api/wordbook` | 단어장 CRUD |
| GET | `/api/dashboard` | 학습 대시보드 |
| POST | `/api/review-result`, `/api/review/complete`, `/api/quiz-correct` | 복습(SRS) 기록 |
| GET | `/api/review/today`, `/api/review-due` | 복습 대상 조회 |
| POST | `/api/tts` | TTS 생성/캐시 조회 |
| GET | `/api/admin/users`, `/api/admin/stats` | 관리자 전용 |
| POST | `/metacong/chat` | MetaCong 문답 (질문 생성/채점) |
| GET | `/metacong/standards`, POST `/metacong/progress`, `/metacong/sessions` | MetaCong 진도/세션 |
| GET | `/api/debug` | 환경변수 진단 (보안상 운영 제거 권장) |

---

## 6. 환경변수

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API 키 |
| `DATABASE_URL` | 단어장/복습/OAuth 사용 시 | Postgres 연결 문자열 |
| `APP_PASSWORD` | 선택 | 레거시 비밀번호 인증 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google 로그인 사용 시 | OAuth 클라이언트 정보 |
| `GOOGLE_CALLBACK_URL` | 선택 | 기본값 `/auth/google/callback` |
| `JWT_SECRET` | 권장 | 미설정 시 하드코딩 기본값 사용(운영 비권장) |
| `SESSION_SECRET` | 권장 | 미설정 시 하드코딩 기본값 사용(운영 비권장) |
| `ADMIN_EMAILS` | 선택 | 콤마 구분 관리자 이메일 목록 |
| `OPENAI_API_KEY` | TTS 사용 시 | OpenAI TTS 호출 |
| `PORT` | 자동 | Railway가 자동 주입 |

---

## 7. 알려진 이슈

| 이슈 | 상태 |
|------|------|
| `/api/debug`가 환경변수 존재 여부·길이 노출 | 운영 안정화 후 제거 권장 |
| `JWT_SECRET`/`SESSION_SECRET` 미설정 시 하드코딩 기본값 사용 | 운영 환경에서는 반드시 별도 설정 필요 |
| 로컬 `.env`에 `GOOGLE_CLIENT_ID`/`DATABASE_URL` 없음 | Google 로그인·단어장 등 DB 기능 로컬 비활성 |

---

## 8. 향후 고려 기능 (백로그)

- [ ] `/api/debug` 엔드포인트 제거 또는 관리자 인증 필수화
- [ ] 발음 듣기(TTS) 전체 앱 확대 적용
- [ ] 모바일 UI 최적화
- [ ] METIS 하위 앱 간 공통 네비게이션/홈 화면 정리
