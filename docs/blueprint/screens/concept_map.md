---
screen: 개념 지도
file: public/concept_map.html
engines: [AI 개념 지도 처리(Claude Haiku), 기기 PDF 저장(캔버스)]
calls: [GET /api/me, POST /api/cmap/topics/:id/explain, GET /api/cmap/topics/:rootId/map, POST /api/cmap/maps/:id/save, POST /api/cmap/maps/:id/edges]
reads: [DB:users, DB:api_usage, DB:cmap_topics, DB:cmap_concepts, DB:cmap_maps, DB:cmap_map_nodes, DB:cmap_edges, DB:cmap_concept_marks, 기기:mydict_token]
writes: [DB:api_usage, DB:cmap_concepts, DB:cmap_maps, DB:cmap_edges]
fallback: []
flows: [
  개념 검색 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/topics/:id/explain ; →읽기 cmap_topics ; →읽기 cmap_concepts ; →읽기 api_usage ; →호출 AI 개념 지도 처리(Claude Haiku) ; →호출 Anthropic API(Claude Haiku) ; →쓰기 api_usage ; →쓰기 cmap_concepts,
  개념 누르면 설명 팝업 | →호출 GET /api/cmap/topics/:rootId/map ; →읽기 cmap_concepts,
  지도 저장 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/save ; →읽기 cmap_maps ; →읽기 cmap_map_nodes ; →읽기 cmap_edges ; →쓰기 cmap_maps,
  PDF 저장 | →호출 기기 PDF 저장(캔버스),
  연결 만들기 | →필요 권한:perm_concept_map ; →호출 POST /api/cmap/maps/:id/edges ; →읽기 cmap_maps ; →읽기 cmap_map_nodes ; →읽기 cmap_edges ; →쓰기 cmap_edges
]
requires: [로그인, 권한:perm_concept_map]
navigates: [홈]
externals: [Anthropic API(Claude Haiku), Google Fonts]
modules: [public/js/common/authGate.js, public/js/common/appHeader.js]
last_checked: bf7715c
---

# 개념 지도 (public/concept_map.html)

> **범위(작업451): 일부러 좁게 쓴 도면이다.** 개념 지도는 기능이 매우 많아(주제 트리 관리·개념 직접 입력·심화·일괄 연결·배치 최적화·해설·연결 퀴즈·말로 설명하기 답변(음성 인식)·복습 등) 이번에는 사용자가 누르는 동작 5개(개념 검색, 설명 팝업, 지도 저장, PDF 저장, 연결 만들기)와 그 동작에 필요한 연결만 적었다. 머리말에 없는 API·저장소·외부(예: `/api/cmap/maps/:id/narrate`, `…/quiz/*`, `…/answer/*`, OpenAI STT, 테이블 cmap_narrations·cmap_quiz_attempts·cmap_answer_attempts·cmap_topics의 변경)가 이 화면에 없다는 뜻이 아니다. 나머지는 [미확인]이며 후속 작업에서 채운다.

## 1 기능
- 이 도면이 다루는 것: 개념 검색(AI 설명을 받아 바로 저장) · 지도 편집 시트에서 개념을 누르면 그 옆에 뜨는 설명 팝업 · 지도 저장 · 지도 PDF 저장 · 두 개념을 이어 연결 만들기.
- 접근: 로그인 + `users.perm_concept_map` 이 명시적으로 true 인 계정만(fail-closed).

## 2 엔진
- [엔진] AI 개념 지도 처리(Claude Haiku): 개념 검색은 `POST /api/cmap/topics/:id/explain` → `AI.callExplainAI`(lib/cmap_ai.js:261)가 Anthropic SDK(:265)로 모델 CMAP_MODEL claude-haiku-4-5-20251001(:11)을 부른다. 심화(routes/concept_map.js:468)·해설(lib/cmap_narrate.js:154)·서술 평가(lib/cmap_answer.js:81)도 같은 모델이지만 이번 도면 범위 밖이다. 하루 한도 AI.countToday(lib/cmap_ai.js:43) 초과는 429(routes/concept_map.js:318).
- [엔진] 기기 PDF 저장(캔버스): 서버 호출 없음. 화면의 지도 SVG를 캔버스에 그려 JPEG(public/js/cmap/mapPdf.js:164)로 만들고 최소 PDF 바이트로 묶어(:167) 파일로 내려받는다. 공유 시트는 쓰지 않는다(451). 대체 경로 없음.

## 3 경로 (동작 → 화면 코드 → 서버 라우트)
- [화면] 개념 지도 →호출 [API] GET /api/me — public/concept_map.html:571 → routes/auth.js:101. →필요 로그인·권한:perm_concept_map(화면은 /api/me 결과의 perm 이 true 일 때만 보여 준다, :565). 모든 /api/cmap 라우트는 guard(routes/concept_map.js:31 = requireAuth + requireCmapPerm :18).
- 개념 검색 →호출 [API] POST /api/cmap/topics/:id/explain — 검색 폼 제출(concept_map.html:1126) → api 호출(:1074) → routes/concept_map.js:296. →읽기 [DB] cmap_topics(loadTopics :92)·cmap_concepts(:304), api_usage(하루 한도 :318), →호출 [엔진] AI 개념 지도 처리 →호출 [외부] Anthropic API →쓰기 [DB] api_usage(trackUsage lib/cmap_ai.js:278)·cmap_concepts(INSERT :347). 같은 이름의 개념이 이미 있으면 AI를 부르지 않고 기존 개념을 돌려준다(:316, 200 existing).
- 개념 누르면 설명 팝업 — 누를 때 서버 호출은 없다. 편집 시트를 열 때 받은 `GET /api/cmap/topics/:rootId/map`(public/js/cmap/mapView.js:297 open → routes/concept_map.js:558) 응답의 concepts[].brief(:582, briefOf :414)를 쓴다. 첫 선택 시 onFirst(mapView.js:310)가 briefId를 정하고 renderBrief(:237)가 이름+설명을 그리며 placeBrief(:162)가 그 노드 아래(없으면 위)에 놓는다. 팝업을 누르면 hideBrief(:236, 리스너 :789)로 팝업만 닫히고 선택은 유지된다. →읽기 [DB] cmap_concepts(treeOfMap :553). 이 GET은 지도가 없으면 cmap_maps를 만든다(:568, →쓰기 cmap_maps이지만 팝업 동작의 일은 아님).
- 지도 저장 →호출 [API] POST /api/cmap/maps/:id/save — 저장 단추(mapView.js:813) → save()(:592, 호출 :596) → routes/concept_map.js:767. →읽기 [DB] cmap_maps(ownMap :541), cmap_map_nodes·cmap_edges(graphOf :529) →쓰기 [DB] cmap_maps(semantic_hash·saved_at, :773).
- PDF 저장 →호출 [엔진] 기기 PDF 저장(캔버스) — 단추(mapView.js:791) → pdfSave(:278) → CmapPdf.make → deliver(mapPdf.js:173: createObjectURL → a[download] 클릭 → 10초 뒤 revoke). 요청 없음, 지도 데이터·저장 상태는 바꾸지 않는다. 끝나면 "PDF를 저장했어요"를 #map-note에 3초 보인다(mapView.js:286).
- 연결 만들기 →호출 [API] POST /api/cmap/maps/:id/edges — 두 노드를 차례로 눌러 연결 대화상자(onPair :429 → openEdgeDialog :435)에서 확인하면 api 호출(:487) → routes/concept_map.js:659. →읽기 [DB] cmap_maps(ownMap), cmap_map_nodes(:670), cmap_edges(:672) →쓰기 [DB] cmap_edges(insertEdge :651, INSERT :653).

## 4 DB
- →읽기: [DB] users(권한 확인 routes/concept_map.js:18), api_usage(하루 한도), cmap_topics, cmap_concepts, cmap_maps, cmap_map_nodes, cmap_edges, cmap_concept_marks(지도 조회 :576, 모르는 개념 표시).
- →쓰기: [DB] api_usage(AI 설명 사용량), cmap_concepts(AI 설명으로 개념 저장), cmap_maps(저장 시 해시·시각, 지도 조회 시 최초 생성), cmap_edges(연결 만들기).
- 결과가 쌓이는 곳: 개념·설명은 cmap_concepts, 지도 저장 상태는 cmap_maps, 연결은 cmap_edges. DB 없으면 권한 확인에서 403(:19).
- [미확인] 이번 범위 밖 테이블(cmap_narrations, cmap_quiz_attempts, cmap_answer_attempts)이 이 화면의 어떤 동작에서 쓰이는지는 코드로 줄 단위 확인하지 않았다(grep으로 라우트 파일에 존재만 확인).

## 5 연결
- [API] 위 3절. [외부] Anthropic(개념 검색), Google Fonts(concept_map.html:11).
- [기기] localStorage `mydict_token`(concept_map.html:563). PDF 저장은 파일 다운로드이며 기기 저장값을 쓰지 않는다.
- [모듈] public/js/common/authGate.js, appHeader.js. 이 화면 전용 스크립트(public/js/cmap/*.js)는 공용이 아니라서 머리말 modules에 적지 않는다.
- [이동] 개념 지도 →이동 홈(concept_map.html:324 "METIS 홈으로", :1262 location.href = '/').
- [미확인] iOS 설치 앱(홈 화면 웹앱)에서 a[download]로 PDF가 실제로 저장되는지(자동 시험 불가). 이번 범위 밖 기능 전부.
