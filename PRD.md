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
| `/` | 홈 화면 | 3D 휠 피커로 하위 앱에 진입 (React+Vite 서브앱 `home-wheel/`을 빌드한 정적 결과물, `public/home/`에서 서빙) |
| `/english_dictionary.html` | 영어 사전 | 단어/상용구 검색, Claude가 뜻·예문·어원 생성. 단어장·복습(SRS)·퀴즈 포함 |
| `/literature_compass.html` | 문학 나침반 | 한국 문학 사조를 연표(타임라인)로 표시 |
| `/digest_reading.html` | 한입 독서 | 독서 요약 콘텐츠 제공 |
| `/metacong/` | MetaCong | 한국사·세계사 성취기준 기반 음성 학습 퀴즈 (Vite+React SPA, `routes/metacong.js` API) |
| `/admin` | 관리자 패널 | 사용자 관리, 권한 설정, 사용량/비용 통계 |

---

## 3. 인증

- **비밀번호 인증(레거시):** `APP_PASSWORD` 설정 시 첫 방문 모달 → 통과 시 `localStorage`에 저장. 미설정 시 인증 없이 통과.
- **Google OAuth (passport-google-oauth20):** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 설정 시에만 활성화(`googleOAuthEnabled`). 로그인 성공 시 JWT 발급, 로그인을 시작한 페이지로 리다이렉트(기본값은 `/?token=`이며 상태 파라미터로 시작 페이지를 기억함). Postgres `users` 테이블에 사용자 저장.
- **신규 가입자 승인제:** 새로 가입하는 계정은 `users.is_approved = false`로 생성되며, 관리자가 관리자 패널에서 승인하기 전까지 로그인 콜백이 JWT를 아예 발급하지 않고 승인 대기 안내로 리다이렉트한다. `ADMIN_EMAILS`에 포함된 이메일은 가입 즉시 자동 승인됨. 기존 가입자는 컬럼 추가 시점에 자동으로 승인 상태로 소급 적용됨. 승인 취소는 로그인 시점에만 체크하며, 이미 발급된 JWT는 재검증하지 않음(`HANDOVER.md` §4 참고).
- **관리자 판별:** `ADMIN_EMAILS` 목록에 포함된 이메일은 로그인 시 `role='admin'`으로 설정.
- **세션:** `express-session` (`SESSION_SECRET`), JWT (`JWT_SECRET`).

> 현재 로컬 `.env`에는 `ANTHROPIC_API_KEY`만 설정되어 있어, Google OAuth와
> DB 연동 기능은 로컬에서 비활성 상태로 동작한다. (작업 4 참고)

---

## 4. 기술 스택

| 구분 | 기술 |
|------|------|
| Backend | Node.js + Express |
| Frontend | Vanilla HTML/CSS/JS (사전·문학·독서·관리자) + Vite/React (홈 화면 `home-wheel/`, 이 저장소 소스 있음 / MetaCong, 이 저장소에 소스 없이 빌드 결과물만 존재) |
| DB | PostgreSQL (`pg`) — 사용자, 단어장, 복습 기록, TTS 캐시 |
| AI | Claude Haiku (`@anthropic-ai/sdk`) — 사전 검색, MetaCong 문답 |
| TTS | OpenAI API (`OPENAI_API_KEY`), Postgres 캐시 |
| 인증 | 비밀번호 + Google OAuth (Passport) + JWT |
| 배포 | Railway |

---

## 5. 주요 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/ai` | 단어 검색 실제 사용 엔드포인트 (Claude 호출 패스스루 — 프롬프트는 프론트엔드 `english_dictionary.html`의 `searchEnglish()` 등에서 구성) |
| POST | ~~`/api/search`~~ | **죽은 코드** — `server.js`에 구버전 검색 로직이 남아있지만 프론트엔드 어디에서도 호출하지 않음. 위 `/api/ai`로 대체됨 |
| POST | `/api/auth` | 비밀번호 인증 (레거시, `APP_PASSWORD` 미설정 시 사실상 무의미) |
| GET | `/auth/google`, `/auth/google/callback`, `/auth/logout` | Google OAuth 플로우 |
| GET | `/api/me` | 로그인 사용자 정보 |
| GET/POST/DELETE | `/api/wordbook` | 단어장 CRUD |
| PATCH | `/api/wordbook/:id/example` | 단어장 항목 예문 수정 |
| GET | `/api/dashboard` | 학습 대시보드 데이터 조회 (백엔드 로직 자체는 살아있으나, 이를 호출하는 프론트엔드 화면 `#page-home`이 현재 도달 불가능한 상태 — `HANDOVER.md` §5 참고) |
| POST | `/api/review-result`, `/api/review/complete`, `/api/quiz-correct` | 복습(SRS) 기록 |
| GET | `/api/review/today`, `/api/review-due` | 복습 대상 조회 |
| POST | `/api/tts` | TTS 생성/캐시 조회 |
| DELETE | `/api/tts/cache` | TTS 캐시 삭제 |
| GET | `/api/admin/users`, `/api/admin/stats` | 관리자 전용 조회 |
| PATCH | `/api/admin/users/:id` | 관리자 전용 — 사용자 권한/역할/차단/승인 상태 수정 |
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
- [ ] OCR 다국어 검색 지원 — 현재 OCR은 영어 전용(작업2 Live OCR
      스캐너). 한국어/한자(중국어)/일본어도 선택해서 인식할 수 있도록
      확장 필요
- [ ] OCR 인식 정확도 개선 — 2026-09-21 조사(세션 내 작업39/41)로
      원인 3가지 확인, 전부 현재는 현행 유지로 결정(아래 참고):
      1. **구(phrase) 후보 미검증**(확정, 코드로 재현됨): 인접한 두
         토큰을 묶어 "word1 word2" 형태 후보를 만들 때 개별 단어는
         각각 word-list 검증을 통과하지만, 합쳐진 조합 자체는 한
         번도 검증되지 않음(`rankEnglishCandidates()`,
         `public/js/ocr/extractEnglishCandidates.js`). 의미 없는
         두 단어 조합이 후보로 노출되는 주 원인으로 추정. → 이번엔
         보류(옵션이었던: 구 후보 기능 제거 / 인접 거리·같은 줄
         조건 추가 / 보류 중 보류 선택).
      2. **word-list 로딩 실패 시 조용한 fallback**(가능성 있음,
         로컬 미재현): `preloadEnglishWordSet()`이 fetch 실패 시
         null을 반환하면 `isCandidateWord()`의 사전 검증이 통째로
         스킵되고 패턴 검사만 남는데, 사용자에게는 아무 표시가 없음.
         모바일 네트워크 등 배포 환경에서 발생 가능성 있으나 이번
         조사에서 직접 재현은 못함. → 이번엔 현행 유지(조용히
         완화된 필터로 계속 동작).
      3. **word-list(Scrabble 사전, 274,136단어) 자체의 품질**(확정):
         "pya"(미얀마 화폐 단위), "als" 등 실존하지만 일반 사용자는
         모르는 단어가 다수 포함되어 있어, 필터를 정상 통과해도
         사용자 눈엔 "의미없는 나열"로 보임. 실사용 스크린샷으로
         확인됨. → 이번엔 274k 리스트 그대로 유지, 더 작고 일반적인
         단어 위주 리스트로 교체는 별도 큰 작업으로 후보 등록.
      조사 상세는 세션 기록 참고(파일로는 남아있지 않음 — 필요시
      재조사 시 이 요약을 출발점으로 삼을 것).
