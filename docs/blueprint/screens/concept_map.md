---
screen: 개념 지도
file: public/concept_map.html
engines: [AI 개념 지도 처리(Claude Haiku), 기기 PDF 저장(캔버스), 음성 인식(OpenAI STT), 서버 메모리 작업 상태]
calls: [GET /api/me, GET /api/cmap/topics, POST /api/cmap/topics, PATCH /api/cmap/topics/:id, POST /api/cmap/topics/:id/move, DELETE /api/cmap/topics/:id, POST /api/cmap/topics/:id/explain, GET /api/cmap/topics/:id/concepts, POST /api/cmap/topics/:id/concepts, PATCH /api/cmap/concepts/:id, PUT /api/cmap/concepts/:id/mark, POST /api/cmap/concepts/:id/deepen, DELETE /api/cmap/concepts/:id, GET /api/cmap/topics/:rootId/map, POST /api/cmap/maps/:id/nodes, DELETE /api/cmap/maps/:id/nodes/:conceptId, PATCH /api/cmap/maps/:id/nodes/:conceptId, POST /api/cmap/maps/:id/edges, POST /api/cmap/maps/:id/edges/bulk, PATCH /api/cmap/edges/:id, DELETE /api/cmap/edges/:id, POST /api/cmap/maps/:id/save, PUT /api/cmap/maps/:id/positions, GET /api/cmap/maps/:id/narration, POST /api/cmap/maps/:id/narrate, GET /api/cmap/maps/:id/quiz/marked-info, POST /api/cmap/maps/:id/quiz/start, POST /api/cmap/maps/:id/quiz/submit, POST /api/cmap/concepts/:id/answer/voice, POST /api/cmap/concepts/:id/answer/text, GET /api/cmap/answers/recent, GET /api/cmap/maps/:id/answer-targets]
reads: [DB:users, DB:api_usage, DB:cmap_topics, DB:cmap_concepts, DB:cmap_maps, DB:cmap_map_nodes, DB:cmap_edges, DB:cmap_concept_marks, DB:cmap_narrations, DB:cmap_answer_attempts, 기기:mydict_token]
writes: [DB:api_usage, DB:cmap_concepts, DB:cmap_maps, DB:cmap_edges, DB:cmap_topics, DB:cmap_map_nodes, DB:cmap_concept_marks, DB:cmap_narrations, DB:cmap_quiz_attempts, DB:cmap_answer_attempts]
fallback: []
flows: [
  개념 검색 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/topics/:id/explain ; →읽기 cmap_topics ; →읽기 cmap_concepts ; →읽기 api_usage ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage ; →쓰기 cmap_concepts,
  개념 누르면 설명 팝업 | →호출 GET /api/cmap/topics/:rootId/map ; →읽기 cmap_concepts,
  지도 저장 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/save ; →읽기 cmap_maps ; →읽기 cmap_map_nodes ; →읽기 cmap_edges ; →쓰기 cmap_maps,
  PDF 저장 | →호출 기기 PDF 저장(캔버스),
  연결 만들기 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/edges ; →읽기 cmap_maps ; →읽기 cmap_map_nodes ; →읽기 cmap_edges ; →쓰기 cmap_edges,
  주제 만들기·이름 바꾸기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/topics ; →호출 POST /api/cmap/topics ; →호출 PATCH /api/cmap/topics/:id ; →읽기 cmap_concepts ; →읽기 cmap_topics ; →쓰기 cmap_topics,
  주제 이동·삭제 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/topics/:id/move ; →호출 DELETE /api/cmap/topics/:id ; →읽기 cmap_concepts ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_topics ; →쓰기 cmap_maps ; →쓰기 cmap_topics ; →쓰기 cmap_concepts,
  개념 직접 추가·고치기·지우기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/topics/:id/concepts ; →호출 POST /api/cmap/topics/:id/concepts ; →호출 PATCH /api/cmap/concepts/:id ; →호출 DELETE /api/cmap/concepts/:id ; →읽기 cmap_concepts ; →읽기 cmap_topics ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →쓰기 cmap_concepts ; →쓰기 cmap_edges ; →쓰기 cmap_map_nodes ; →쓰기 cmap_maps,
  개념 심화 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/concepts/:id/deepen ; →읽기 api_usage ; →읽기 cmap_concepts ; →읽기 cmap_topics ; →쓰기 api_usage ; →쓰기 cmap_concepts ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku),
  모르는 개념 표시 | →필요 권한:perm_concept_map ; →호출 PUT /api/cmap/concepts/:id/mark ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →쓰기 cmap_concept_marks,
  지도 열기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/topics/:rootId/map ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_topics ; →쓰기 cmap_maps,
  지도에 개념 넣기·빼기·옮기기·배치 최적화 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/nodes ; →호출 DELETE /api/cmap/maps/:id/nodes/:conceptId ; →호출 PATCH /api/cmap/maps/:id/nodes/:conceptId ; →호출 PUT /api/cmap/maps/:id/positions ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_topics ; →쓰기 cmap_map_nodes ; →쓰기 cmap_edges,
  연결 고치기·지우기·한꺼번에 만들기 | →필요 권한:perm_concept_map ; →호출 PATCH /api/cmap/edges/:id ; →호출 DELETE /api/cmap/edges/:id ; →호출 POST /api/cmap/maps/:id/edges/bulk ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →쓰기 cmap_edges,
  지도 해설 보기·만들기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/narration ; →호출 POST /api/cmap/maps/:id/narrate ; →읽기 api_usage ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →읽기 cmap_narrations ; →읽기 cmap_topics ; →쓰기 api_usage ; →쓰기 cmap_narrations ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 서버 메모리 작업 상태 ; →호출 Anthropic API(Claude Haiku),
  연결 퀴즈 풀기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/quiz/marked-info ; →호출 POST /api/cmap/maps/:id/quiz/start ; →호출 POST /api/cmap/maps/:id/quiz/submit ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_edges ; →읽기 cmap_map_nodes ; →읽기 cmap_maps ; →쓰기 cmap_quiz_attempts,
  말로 설명하기(음성) | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/answer-targets ; →호출 POST /api/cmap/concepts/:id/answer/voice ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_maps ; →읽기 cmap_topics ; →읽기 api_usage ; →쓰기 api_usage ; →쓰기 cmap_answer_attempts ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 음성 인식(OpenAI STT) ; →호출 Anthropic API(Claude Haiku) ; →호출 OpenAI STT(음성 인식),
  말로 설명하기(글로 입력) | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/maps/:id/answer-targets ; →호출 POST /api/cmap/concepts/:id/answer/text ; →읽기 cmap_concept_marks ; →읽기 cmap_concepts ; →읽기 cmap_maps ; →읽기 cmap_topics ; →읽기 api_usage ; →쓰기 api_usage ; →쓰기 cmap_answer_attempts ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku),
  오답노트 보기 | →필요 권한:perm_concept_map ; →호출 GET /api/cmap/answers/recent ; →읽기 cmap_answer_attempts ; →읽기 cmap_concepts
]
requires: [로그인, 권한:perm_concept_map]
navigates: [홈]
externals: [Anthropic API(Claude Haiku), Google Fonts, OpenAI STT(음성 인식)]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js]
last_checked: 9319dc0
---

# 개념 지도 (public/concept_map.html)

> **범위(B-006): 코드 기준으로 넓힌 도면이다.** 이 화면이 부르는 `/api/cmap/**` 31개 전부와 사용자가 누르는 동작 18개(처음 5개 + 추가 13개)를 적었다. 이 화면에 "해설 읽어주기"(소리 재생)는 코드에 없다(public/concept_map.html·public/js/cmap/*.js 에 speechSynthesis·/api/tts 호출 0건, 해설은 글로만 보여 준다: public/js/cmap/narrateView.js). `GET /api/cmap/status`(routes/concept_map.js:33)는 화면이 부르지 않는다.

## 1 기능
- 이 도면이 다루는 것: 주제 탭(주제 만들기·이름·이동·삭제, 개념 직접 입력·심화·검색), 지도 만들기 탭(지도 열기·개념 넣고 빼기·연결·저장·PDF·해설·모르는 개념 표시), 퀴즈 탭(연결 퀴즈·말로 설명하기), 오답노트 탭. 아래 3절에 동작 18개.
- 접근: 로그인 + `users.perm_concept_map` 이 명시적으로 true 인 계정만(fail-closed).

## 2 엔진
- [엔진] AI 개념 지도 처리(Claude Haiku): 개념 검색은 `POST /api/cmap/topics/:id/explain` → `AI.callExplainAI`(lib/cmap_ai.js:261)가 Anthropic SDK(:265)로 모델 CMAP_MODEL claude-haiku-4-5-20251001(:11)을 부른다. 심화(routes/concept_map.js:468)·해설(lib/cmap_narrate.js:154)·서술 평가(lib/cmap_answer.js:81)도 같은 모델이지만 이번 도면 범위 밖이다. 하루 한도 AI.countToday(lib/cmap_ai.js:43) 초과는 429(routes/concept_map.js:318).
- [엔진] 기기 PDF 저장(캔버스): 서버 호출 없음. 화면의 지도 SVG를 캔버스에 그려 JPEG(public/js/cmap/mapPdf.js:164)로 만들고 최소 PDF 바이트로 묶어(:167) 파일로 내려받는다. 공유 시트는 쓰지 않는다(451). 대체 경로 없음.
- [엔진] 음성 인식(OpenAI STT): `POST /api/cmap/concepts/:id/answer/voice` 가 녹음을 STT.transcribe 로 글자로 바꾼다(routes/concept_map.js:1001 → lib/cmap_stt.js:45, 사용량 기록 :57). 평가는 AI 개념 지도 처리(lib/cmap_answer.js:82), 해설은 lib/cmap_narrate.js:155.
- [엔진] 서버 메모리 작업 상태: 같은 지도의 해설을 동시에 두 번 만들지 않게 하는 narrating 집합(routes/concept_map.js:857). 서버를 다시 시작하면 사라진다.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- [화면] 개념 지도 →호출 [API] GET /api/me — public/concept_map.html:571 → routes/auth.js:101. →필요 로그인·권한:perm_concept_map(화면은 /api/me 결과의 perm 이 true 일 때만 보여 준다, :565). 모든 /api/cmap 라우트는 guard(routes/concept_map.js:31 = requireAuth + requireCmapPerm :18).
- 개념 검색 →호출 [API] POST /api/cmap/topics/:id/explain — 검색 폼 제출(concept_map.html:1126) → api 호출(:1074) → routes/concept_map.js:296. →읽기 [DB] cmap_topics(loadTopics :92)·cmap_concepts(:304), api_usage(하루 한도 :318), →호출 [엔진] AI 개념 지도 처리 →호출 [외부] Anthropic API →쓰기 [DB] api_usage(trackUsage lib/cmap_ai.js:278)·cmap_concepts(INSERT :347). 같은 이름의 개념이 이미 있으면 AI를 부르지 않고 기존 개념을 돌려준다(:316, 200 existing).
- 개념 누르면 설명 팝업 — 누를 때 서버 호출은 없다. 편집 시트를 열 때 받은 `GET /api/cmap/topics/:rootId/map`(public/js/cmap/mapView.js:297 open → routes/concept_map.js:558) 응답의 concepts[].brief(:582, briefOf :414)를 쓴다. 첫 선택 시 onFirst(mapView.js:310)가 briefId를 정하고 renderBrief(:237)가 이름+설명을 그리며 placeBrief(:162)가 그 노드 아래(없으면 위)에 놓는다. 팝업을 누르면 hideBrief(:236, 리스너 :789)로 팝업만 닫히고 선택은 유지된다. →읽기 [DB] cmap_concepts(treeOfMap :553). 이 GET은 지도가 없으면 cmap_maps를 만든다(:568, →쓰기 cmap_maps이지만 팝업 동작의 일은 아님).
- 지도 저장 →호출 [API] POST /api/cmap/maps/:id/save — 저장 단추(mapView.js:813) → save()(:592, 호출 :596) → routes/concept_map.js:767. →읽기 [DB] cmap_maps(ownMap :541), cmap_map_nodes·cmap_edges(graphOf :529) →쓰기 [DB] cmap_maps(semantic_hash·saved_at, :773).
- PDF 저장 →호출 [엔진] 기기 PDF 저장(캔버스) — 단추(mapView.js:791) → pdfSave(:278) → CmapPdf.make → deliver(mapPdf.js:173: createObjectURL → a[download] 클릭 → 10초 뒤 revoke). 요청 없음, 지도 데이터·저장 상태는 바꾸지 않는다. 끝나면 "PDF를 저장했어요"를 #map-note에 3초 보인다(mapView.js:286).
- 연결 만들기 →호출 [API] POST /api/cmap/maps/:id/edges — 두 노드를 차례로 눌러 연결 대화상자(onPair :429 → openEdgeDialog :435)에서 확인하면 api 호출(:487) → routes/concept_map.js:659. →읽기 [DB] cmap_maps(ownMap), cmap_map_nodes(:670), cmap_edges(:672) →쓰기 [DB] cmap_edges(insertEdge :651, INSERT :653).
- 아래는 B-006 에서 추가한 동작이다. `:N` 은 routes/concept_map.js 의 줄, 그 밖의 파일은 이름을 붙였다. 읽기·쓰기 줄은 api.md 행의 근거와 같다. [확인함]
- **주제 만들기·이름 바꾸기** — 주제 탭의 "주제 추가"·"하위 주제 추가"·"이름 변경". (7단계)
  - →호출 [API] GET /api/cmap/topics — 화면 public/concept_map.html:636 → routes/concept_map.js:111 / →읽기 cmap_topics(:92), cmap_concepts(:96)
  - →호출 [API] POST /api/cmap/topics — 화면 public/concept_map.html:746 → routes/concept_map.js:118 / →읽기 cmap_topics(:92) / →쓰기 cmap_topics(INSERT :131)
  - →호출 [API] PATCH /api/cmap/topics/:id — 화면 public/concept_map.html:784 → routes/concept_map.js:138 / →읽기 cmap_topics(:92) / →쓰기 cmap_topics(UPDATE :149)
- **주제 이동·삭제** — 주제 탭의 "이동"·"삭제"(삭제는 확인 대화상자 뒤). (10단계)
  - →호출 [API] POST /api/cmap/topics/:id/move — 화면 public/concept_map.html:813 → routes/concept_map.js:154 / →읽기 cmap_topics(:92), cmap_concepts·cmap_maps·cmap_map_nodes(usedInMaps :516-522) / →쓰기 cmap_maps(DELETE :179, 최상위를 옮길 때), cmap_topics(UPDATE :182, :187)
  - →호출 [API] DELETE /api/cmap/topics/:id — 화면 public/concept_map.html:855, public/concept_map.html:873 → routes/concept_map.js:193 / →읽기 cmap_topics(:92), cmap_concepts(:206, :229), cmap_maps(:231) / →쓰기 cmap_topics(UPDATE :220, DELETE :223,238,239), cmap_concepts(UPDATE :222, DELETE :237), cmap_maps(DELETE :236)
- **개념 직접 추가·고치기·지우기** — 주제 탭의 "개념 추가"와 개념 카드의 고치기·지우기. (14단계)
  - →호출 [API] GET /api/cmap/topics/:id/concepts — 화면 public/concept_map.html:647 → routes/concept_map.js:353 / →읽기 cmap_topics(ownTopic :287), cmap_concepts(:357)
  - →호출 [API] POST /api/cmap/topics/:id/concepts — 화면 public/concept_map.html:1047 → routes/concept_map.js:361 / →읽기 cmap_topics(ownTopic :287), cmap_concepts(:368) / →쓰기 cmap_concepts(INSERT :373)
  - →호출 [API] PATCH /api/cmap/concepts/:id — 화면 public/concept_map.html:1007, public/concept_map.html:1046 → routes/concept_map.js:381 / →읽기 cmap_concepts(:388, :392) / →쓰기 cmap_concepts(UPDATE :405)
  - →호출 [API] DELETE /api/cmap/concepts/:id — 화면 public/concept_map.html:1140 → routes/concept_map.js:484 / →읽기 cmap_concepts(:488), cmap_maps(:491), cmap_map_nodes(:494), cmap_edges(:496) / →쓰기 cmap_edges(DELETE :497), cmap_map_nodes(DELETE :498), cmap_maps(UPDATE :499), cmap_concepts(DELETE :502; 표시·풀이는 FK CASCADE lib/db.js:506,536)
- **개념 심화** — 개념 카드의 "심화" 단추(AI 가 심화 개념을 하나 더 만든다). (9단계)
  - →호출 [API] POST /api/cmap/concepts/:id/deepen — 화면 public/concept_map.html:940 → routes/concept_map.js:445 / →읽기 cmap_concepts(:448, :472), cmap_topics(:462), api_usage(lib/cmap_ai.js:44) / →쓰기 cmap_concepts(UPDATE :478), api_usage(lib/db.js:729 trackUsage) via lib/cmap_ai.js:278 / AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_ai.js:266
- **모르는 개념 표시** — 지도에서 개념을 눌러 "모르는 개념"으로 표시·해제. (5단계)
  - →호출 [API] PUT /api/cmap/concepts/:id/mark — 화면 public/js/cmap/mapView.js:199, public/js/cmap/mapView.js:953 → routes/concept_map.js:422 / →읽기 cmap_concepts(:427), cmap_concept_marks(:433) / →쓰기 cmap_concept_marks(DELETE :430 / INSERT :435)
- **지도 열기** — 지도 만들기 탭(편집 시트 열기). 지도가 없으면 이때 만들어진다. (9단계)
  - →호출 [API] GET /api/cmap/topics/:rootId/map — 화면 public/js/cmap/mapView.js:297 → routes/concept_map.js:558 / →읽기 cmap_topics(:562), cmap_maps(:566), cmap_map_nodes(:571), cmap_edges(:572), cmap_concept_marks(:576), cmap_concepts(treeOfMap :553) / →쓰기 cmap_maps(INSERT :568 — 지도가 없으면 만든다. GET 인데 쓴다)
- **지도에 개념 넣기·빼기·옮기기·배치 최적화** — 개념 고르기 패널·노드 끌기·"배치 최적화"의 적용·되돌리기. (12단계)
  - →호출 [API] POST /api/cmap/maps/:id/nodes — 화면 public/js/cmap/mapView.js:377 → routes/concept_map.js:589 / →읽기 cmap_maps(ownMap :542), cmap_map_nodes(:598), cmap_concepts(treeOfMap :553), cmap_topics(:549), cmap_edges(statusOf → graphOf :531) / →쓰기 cmap_map_nodes(INSERT :601)
  - →호출 [API] DELETE /api/cmap/maps/:id/nodes/:conceptId — 화면 public/js/cmap/mapView.js:385, public/js/cmap/mapView.js:394 → routes/concept_map.js:607 / →읽기 cmap_maps(ownMap :542), cmap_map_nodes(:613), cmap_edges(:615) / →쓰기 cmap_edges(DELETE :620), cmap_map_nodes(DELETE :621)
  - →호출 [API] PATCH /api/cmap/maps/:id/nodes/:conceptId — 화면 public/js/cmap/mapView.js:877 → routes/concept_map.js:627 / →읽기 cmap_maps(ownMap :542) / →쓰기 cmap_map_nodes(UPDATE :634)
  - →호출 [API] PUT /api/cmap/maps/:id/positions — 화면 public/js/cmap/mapView.js:630 → routes/concept_map.js:780 / →읽기 cmap_maps(ownMap :542) / →쓰기 cmap_map_nodes(UPDATE :801)
- **연결 고치기·지우기·한꺼번에 만들기** — 연결 대화상자의 "방향 바꾸기"·"연결 삭제"와 "여러 개에 한 번에 연결". (8단계)
  - →호출 [API] PATCH /api/cmap/edges/:id — 화면 public/js/cmap/mapView.js:488 → routes/concept_map.js:718 / →읽기 cmap_edges(:731) / →쓰기 cmap_edges(UPDATE :746)
  - →호출 [API] DELETE /api/cmap/edges/:id — 화면 public/js/cmap/mapView.js:471 → routes/concept_map.js:752 / →읽기 cmap_edges(:756) / →쓰기 cmap_edges(DELETE :759)
  - →호출 [API] POST /api/cmap/maps/:id/edges/bulk — 화면 public/js/cmap/mapView.js:552 → routes/concept_map.js:683 / →읽기 cmap_maps(ownMap :542), cmap_map_nodes(:702), cmap_edges(:705) / →쓰기 cmap_edges(INSERT :653)
- **지도 해설 보기·만들기** — 지도 만들기 탭의 해설 화면(저장된 해설 보기, "해설 만들기"). (15단계)
  - →호출 [API] GET /api/cmap/maps/:id/narration — 화면 public/js/cmap/narrateView.js:29 → routes/concept_map.js:829 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(narrationContext :814-817), cmap_narrations(:834), api_usage(:836 → lib/cmap_ai.js:44), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531)
  - →호출 [API] POST /api/cmap/maps/:id/narrate — 화면 public/js/cmap/narrateView.js:43 → routes/concept_map.js:846 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(narrationContext :814-817), api_usage(:854 → lib/cmap_ai.js:44), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531) / →쓰기 cmap_narrations(DELETE :865, INSERT :866), api_usage(lib/db.js:729 trackUsage) via lib/cmap_narrate.js:163 / AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_narrate.js:155
- **연결 퀴즈 풀기** — 퀴즈 탭의 연결 퀴즈(전체 / 모르는 개념만). (10단계)
  - →호출 [API] GET /api/cmap/maps/:id/quiz/marked-info — 화면 public/js/cmap/reviewView.js:26 → routes/concept_map.js:904 / →읽기 cmap_maps(ownMap :542), cmap_concept_marks(:899), cmap_concepts(:910), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531)
  - →호출 [API] POST /api/cmap/maps/:id/quiz/start — 화면 public/js/cmap/reviewView.js:90 → routes/concept_map.js:916 / →읽기 cmap_maps(ownMap :542), cmap_concepts(savedGraph :886), cmap_concept_marks(:899), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531)
  - →호출 [API] POST /api/cmap/maps/:id/quiz/submit — 화면 public/js/cmap/reviewView.js:131 → routes/concept_map.js:937 / →읽기 cmap_maps(ownMap :542), cmap_concepts(:886), cmap_concept_marks(:899), cmap_map_nodes(graphOf :530), cmap_edges(graphOf :531) / →쓰기 cmap_quiz_attempts(INSERT :957)
- **말로 설명하기(음성)** — 퀴즈 탭의 말로 설명하기: 녹음 → 음성 인식 → AI 평가. (14단계)
  - →호출 [API] GET /api/cmap/maps/:id/answer-targets — 화면 public/js/cmap/answerView.js:26, public/js/cmap/answerView.js:79 → routes/concept_map.js:1033 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(treeOfMap :549-553), cmap_concept_marks(:1038)
  - →호출 [API] POST /api/cmap/concepts/:id/answer/voice — 화면 public/js/cmap/answerView.js:113 → routes/concept_map.js:993 / →읽기 cmap_concepts(answerTarget :973), api_usage(:980 → lib/cmap_ai.js:44) / →쓰기 cmap_answer_attempts(INSERT :988), api_usage(lib/db.js:729 trackUsage) via lib/cmap_stt.js:57, lib/cmap_answer.js:90 / 음성 인식(OpenAI STT) / OpenAI STT(음성 인식) — lib/cmap_stt.js:45 ; AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_answer.js:82
- **말로 설명하기(글로 입력)** — 퀴즈 탭의 말로 설명하기를 글로 입력 → AI 평가. (12단계)
  - →호출 [API] GET /api/cmap/maps/:id/answer-targets — 화면 public/js/cmap/answerView.js:26, public/js/cmap/answerView.js:79 → routes/concept_map.js:1033 / →읽기 cmap_maps(ownMap :542), cmap_topics·cmap_concepts(treeOfMap :549-553), cmap_concept_marks(:1038)
  - →호출 [API] POST /api/cmap/concepts/:id/answer/text — 화면 public/js/cmap/answerView.js:125 → routes/concept_map.js:1007 / →읽기 cmap_concepts(:973), api_usage(:980 → lib/cmap_ai.js:44) / →쓰기 cmap_answer_attempts(INSERT :988), api_usage(lib/db.js:729 trackUsage) via lib/cmap_answer.js:90 / AI 개념 지도 처리(Claude Haiku) / Anthropic API(Claude Haiku) — lib/cmap_answer.js:82
- **오답노트 보기** — 오답노트 탭(최근 부족한 설명 목록). (4단계)
  - →호출 [API] GET /api/cmap/answers/recent — 화면 public/js/cmap/answerView.js:26 → routes/concept_map.js:1020 / →읽기 cmap_answer_attempts(:1021), cmap_concepts(:1024)


## 4 DB
- →읽기: [DB] users(권한 확인 routes/concept_map.js:21), api_usage(하루 한도), cmap_topics, cmap_concepts, cmap_maps, cmap_map_nodes, cmap_edges, cmap_concept_marks(지도 조회 :576), cmap_narrations(해설 보기 :834), cmap_answer_attempts(오답노트 :1021).
- →쓰기: [DB] api_usage(AI 설명·해설·평가·음성 인식 사용량), cmap_topics(:131,149,182,223), cmap_concepts(:346,373,405,478,502), cmap_maps(:179,236,499,568,773), cmap_map_nodes(:601,621,634,801), cmap_edges(:497,620,653,746,759), cmap_concept_marks(:430,435), cmap_narrations(:865-866), cmap_quiz_attempts(:957), cmap_answer_attempts(:988).
- 결과가 쌓이는 곳: 개념·설명은 cmap_concepts, 지도 저장 상태는 cmap_maps, 연결은 cmap_edges. DB 없으면 권한 확인에서 403(:19).
- [확인함] cmap_narrations(해설)·cmap_quiz_attempts(퀴즈 점수)·cmap_answer_attempts(말로 설명하기 평가)는 각각 위 동작에서 쓰인다(줄 번호는 위 3절과 api.md).

## 5 연결
- [API] 위 3절. [외부] Anthropic(개념 검색·심화·해설·평가), OpenAI STT(말로 설명하기 음성 인식, lib/cmap_stt.js:45), Google Fonts(concept_map.html:11).
- [기기] localStorage `mydict_token`(concept_map.html:563). PDF 저장은 파일 다운로드이며 기기 저장값을 쓰지 않는다.
- [모듈] public/js/common/authGate.js, appHeader.js. 이 화면 전용 스크립트(public/js/cmap/*.js)는 공용이 아니라서 머리말 modules에 적지 않는다.
- [이동] 개념 지도 →이동 홈(concept_map.html:324 "METIS 홈으로", :1262 location.href = '/').
- [미확인] iOS 설치 앱(홈 화면 웹앱)에서 a[download]로 PDF가 실제로 저장되는지(자동 시험 불가).
