# DB 한 장 (docs/blueprint/db.md)

lib/db.js 의 DB init 에서 확인되는 테이블·서버 캐시마다 한 줄이다. 이름은 화면 머리말의 `DB:이름`·`캐시:이름` 과 같은 모양이며, `npm run blueprint:gen` 이 화면 머리말의 DB:·캐시: 이름이 여기에 있는지, 여기 이름이 lib/db.js 의 CREATE TABLE 에 있는지 대조한다(어긋나면 파일:줄과 함께 오류로 멈춘다).
형식은 [LEGEND.md](LEGEND.md) 7절. 이 표는 구조(담는 것·범위·핵심 열·연결)만 적는다. 실패 시 동작·결정 이유·불변 조건은 적지 않는다. "읽는 화면·쓰는 화면"은 아래 생성 구간이 화면 머리말에서 만든다.

## 항목 (손으로 관리)
| 이름 | 담는 것 | 범위 | 핵심 열 | 다른 테이블과의 연결 | 근거 |
|---|---|---|---|---|---|
| DB:users | 로그인한 사용자 계정과 역할·승인·차단·기능 권한 | 전체 공용 | id, google_id, email, role, is_approved | 없음 | lib/db.js:62 |
| DB:wordbook | 사용자가 저장한 단어·문장과 복습 일정 | 사용자별 | id, user_id, word, lang, data | user_id → users(id) | lib/db.js:158 |
| 캐시:tts_cache | 단어 발음 음성 파일(같은 글자·언어를 다시 만들지 않음) | 서버 캐시 | text_key, lang, audio | 없음 | lib/db.js:188 |
| DB:api_usage | AI·음성 호출 사용량 기록(하루 한도 계산·비용 추정) | 사용자별 | user_id, event_type, model, input_tokens, output_tokens | user_id → users(id) | lib/db.js:200 |
| DB:review_log | 단어 복습 결과 기록 | 사용자별 | user_id, word_id, score, created_at | user_id → users(id) | lib/db.js:214 |
| DB:voice_notes | 음성 노트(제목·받아쓴 글·요약) | 사용자별 | id, user_id, title, transcript, summary | user_id → users(id) | lib/db.js:228 |
| DB:voice_quizzes | 노트에서 만든 퀴즈 문항 | 사용자별 | note_id, user_id, questions, source_hash | note_id → voice_notes(id) | lib/db.js:248 |
| DB:voice_quiz_attempts | 음성 노트 퀴즈 풀이 결과 | 사용자별 | user_id, note_id, score, total, items | user_id → users(id), note_id → voice_notes(id) | lib/db.js:262 |
| DB:voice_concepts | 음성 학습의 개념(용어·설명, 과목>대주제>소주제) | 사용자별 | id, user_id, term, subject, topic | user_id → users(id) | lib/db.js:280 |
| DB:voice_links | 노트 사이의 연결 | 사용자별 | id, user_id, from_note_id, to_note_id, kind | user_id → users(id), from_note_id·to_note_id → voice_notes(id) | lib/db.js:302 |
| DB:voice_image_sets | 노트 요약 이미지 묶음의 상태 | 사용자별 | note_id, user_id, status, pages_total, rating | note_id → voice_notes(id), user_id → users(id) | lib/db.js:338 |
| DB:voice_images | 요약 이미지 쪽별 그림 | 사용자별 | note_id, page_no, status, image, mime | note_id → voice_image_sets(note_id) | lib/db.js:353 |
| DB:cmap_topics | 개념 지도의 주제 트리 | 사용자별 | id, user_id, parent_id, root_id, title | user_id → users(id), parent_id·root_id → cmap_topics(id) | lib/db.js:385 |
| DB:cmap_concepts | 주제에 속한 개념과 설명 | 사용자별 | id, user_id, topic_id, term, explanation | user_id → users(id), topic_id → cmap_topics(id) | lib/db.js:411 |
| DB:cmap_maps | 주제 하나의 지도와 저장 상태 | 사용자별 | id, user_id, root_topic_id, semantic_hash, saved_at | user_id → users(id), root_topic_id → cmap_topics(id) | lib/db.js:440 |
| DB:cmap_map_nodes | 지도에 놓인 개념과 위치 | 사용자별 | map_id, concept_id, x, y | map_id → cmap_maps(id), concept_id → cmap_concepts(id) | lib/db.js:456 |
| DB:cmap_edges | 지도에서 개념끼리의 연결 | 사용자별 | id, map_id, from_concept_id, to_concept_id, relation_type | map_id → cmap_maps(id), (map_id, from·to_concept_id) → cmap_map_nodes | lib/db.js:469 |
| DB:cmap_narrations | 지도 해설 결과(지도당 1건) | 사용자별 | map_id, user_id, source_hash, content, model | map_id → cmap_maps(id), user_id → users(id) | lib/db.js:489 |
| DB:cmap_concept_marks | 사용자가 "모르는 개념"으로 표시한 것 | 사용자별 | user_id, concept_id, marked_at | user_id → users(id), concept_id → cmap_concepts(id) | lib/db.js:504 |
| DB:cmap_quiz_attempts | 지도 연결 퀴즈 풀이 점수 | 사용자별 | user_id, map_id, pair_score, type_score, direction_score | user_id → users(id), map_id → cmap_maps(id) | lib/db.js:516 |
| DB:cmap_answer_attempts | 말로 설명하기 답변과 평가 | 사용자별 | user_id, concept_id, verdict, summary, input_mode | user_id → users(id), concept_id → cmap_concepts(id) | lib/db.js:533 |
| 캐시:jgrammar_cache | 문장 해설 결과(같은 문장을 다시 부르지 않음) | 서버 캐시 | sentence_hash, sentence, result, model, lang | 없음 | lib/db.js:620 |
| DB:jgrammar_saved | 사용자가 저장한 문장 해설 목록 | 사용자별 | id, user_id, sentence_hash, sentence, lang | user_id → users(id) | lib/db.js:640 |
| DB:speakloop_audio | Speak Loop 저장 음성 클립 | 전체 공용 | clip_key, kind, text, model, audio | 없음 | lib/db.js:675 |
| DB:speakloop_progress | Speak Loop 연습 횟수·평가 | 사용자별 | user_id, item_id, count, last_rating, last_at | user_id → users(id) | lib/db.js:692 |
| DB:gloss_backup | 단어 뜻 일괄 변환 전·후 백업 | 전체 공용 | id, run_id, wordbook_id, before, after | 없음(wordbook_id 에 참조 키 없음) | lib/db.js:706 |

> "화면 연결 없음"은 어떤 화면 도면에도 안 나온다는 뜻이다(코드에서 안 쓰인다는 뜻이 아니다). 개념 지도 도면(작업451)은 일부러 좁게 쓴 도면이라 cmap_narrations·cmap_quiz_attempts·cmap_answer_attempts 는 그 도면에 없어 여기서 연결 없음으로 보인다. voice_concepts 는 lib/db.js 밖(routes·lib·public)에서 이름이 grep 으로 나오지 않았다([확인함]).

## 읽는 화면·쓰는 화면 (npm run blueprint:gen 이 만든다. 이 안은 손으로 고치지 않는다)
<!-- gen:start -->
> 화면 파일 12개의 머리말(reads·writes)에서 만든다. 항목 26개, 화면 연결 없음 4개.

- **[DB] api_usage** — 읽기: 개념 지도, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습 / 쓰기: 개념 지도, 관리자, 문장 학습, 사전, 스펠링 런, 음성 학습
- **[DB] cmap_answer_attempts** — 화면 연결 없음
- **[DB] cmap_concept_marks** — 읽기: 개념 지도 / 쓰기: -
- **[DB] cmap_concepts** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_edges** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_map_nodes** — 읽기: 개념 지도 / 쓰기: -
- **[DB] cmap_maps** — 읽기: 개념 지도 / 쓰기: 개념 지도
- **[DB] cmap_narrations** — 화면 연결 없음
- **[DB] cmap_quiz_attempts** — 화면 연결 없음
- **[DB] cmap_topics** — 읽기: 개념 지도 / 쓰기: -
- **[DB] gloss_backup** — 읽기: 관리자 / 쓰기: 관리자
- **[캐시] jgrammar_cache** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **[DB] jgrammar_saved** — 읽기: 문장 학습 / 쓰기: 문장 학습
- **[DB] review_log** — 읽기: - / 쓰기: 사전
- **[DB] speakloop_audio** — 읽기: Speak Loop, 관리자 / 쓰기: 관리자
- **[DB] speakloop_progress** — 읽기: Speak Loop / 쓰기: Speak Loop
- **[캐시] tts_cache** — 읽기: 사전, 스펠링 런 / 쓰기: 관리자, 사전, 스펠링 런
- **[DB] users** — 읽기: Speak Loop, 개념 지도, 과학, 관리자, 문장 학습, 문학 나침반, 사전, 스펠링 런, 음성 학습, 작가 노트, 한입 독서, 홈 / 쓰기: 관리자, 홈
- **[DB] voice_concepts** — 화면 연결 없음
- **[DB] voice_image_sets** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_images** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_links** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_notes** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_quiz_attempts** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] voice_quizzes** — 읽기: 음성 학습 / 쓰기: 음성 학습
- **[DB] wordbook** — 읽기: 관리자, 사전, 스펠링 런 / 쓰기: 관리자, 사전
<!-- gen:end -->
