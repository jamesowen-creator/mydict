// 화면 테스트용 서버: public/ 정적 파일 + 개념학습 API의 메모리 모의(실제 서버의 규칙을 단순하게 흉내 냄).
//   const srv = await startMockServer();  srv.url  srv.state  srv.reset()  srv.close()
//   srv.seed({ topic, items: [...], links: [...], path: [...] })  → 학습 하나를 미리 만든다
//   srv.state.explorePlan = [ { status: 429, body: {...} }, { aiError: true }, { network: true }, ... ]  // explore 호출마다 앞에서 하나씩 꺼내 씀
//   srv.state.respondPlan / refreshPlan 도 같은 방식
//   srv.seedVoiceMap({ nodes: [{ id, title, subject, has_summary }], links: [...], built_at }) → 음성 학습 자료 연결 지도(작업214-4). 자료 목록·상세도 같은 노드로 채운다
//   srv.state.voiceBuild = { dry: {...dry_run 응답}, dryError: { status, msg }, error: { status, msg }(실행 POST의 오류), statusSeq: [{status,done,total,...}](조회마다 하나씩, 마지막은 반복) }
//   explorePlan 항목의 extraLinks: ['용어', ...] → 새 개념과 그 기존 개념 사이에 AI 연결을 더 만든다(작업209, 응답의 links)
//   seed의 links: [[from, to, { relation_type, label, detail, source, user_edited }]]  (detail: '' 이면 이유 없음)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '..', '..', '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const key = t => String(t).replace(/\s+/g, '').toLowerCase();

function freshState() {
  return {
    me: { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_concept_study: true },
    authed: true,
    studies: [], items: [], links: [], nextId: 1,
    explorePlan: [], respondPlan: [], refreshPlan: [],
    log: [],            // { method, url, body }
    voicePlan: [],      // 음성 변환 응답 계획 [{ status, body }]. 비어 있으면 { text: '광합성' }
    voiceCalls: [],     // 음성 변환 호출 기록 { type, seconds, bytes }
    quizAnswers: [],    // 돌아보기 퀴즈 답안 기록(POST .../review/answer)
    voiceMap: { nodes: [], links: [], built_at: null, nextId: 100 },   // 음성 학습 자료 연결 지도(작업214-4)
    voiceBuild: { dry: { total_notes: 0, eligible_notes: 3, targets: 3, est_calls: 3, max_per_run: 50, carry_over: 0, daily_link_remaining: 27, est_input_chars: 12000, est_cost_note: '추정입니다. 상한 값은 약 $0.012이며 실제 비용은 이보다 적을 수 있습니다.' }, dryError: null, error: null, statusSeq: [], statusIdx: 0, willProcess: 3 },
    voiceQuizSummary: [], voiceWrong: [], voiceQuizzes: {},   // 작업224-2: 퀴즈 탭(GET quiz-summary·wrong-answers)과 자료별 저장 퀴즈(id → 문제 배열)
    voiceNotes: [],     // 음성 학습 자료 목록(GET /api/voice-notes). 상세(GET /api/voice-notes/:id)도 같은 배열에서 찾는다(작업215-2)
    adminUsers: [],     // 관리자 화면 테스트용 사용자 목록(GET/PATCH /api/admin/users)
    networkDown: false, // true면 explore 요청의 연결을 끊음
    delayMs: 0,         // 모든 concepts API 응답 지연(대기 표시 확인용)
  };
}

function suggestionsFor(term) {
  return [
    { term: term + ' 다음 A', reason: term + '을(를) 이해하는 데 바로 필요합니다.', relation_type: '포함', relation_label: '구성 요소', load: '가벼움' },
    { term: term + ' 다음 B', reason: '대안 B입니다.', relation_type: '대비', relation_label: '반대 개념', load: '보통' },
    { term: term + ' 다음 C', reason: '대안 C입니다.', relation_type: '순서', relation_label: '이어서', load: '무거움' },
  ];
}

async function startMockServer() {
  let state = freshState();
  const iso = () => new Date().toISOString();
  const studyOf = id => state.studies.find(s => s.id === id);
  const itemOf = id => state.items.find(i => i.id === id);

  function newItem(studyId, term, origin) {
    const it = {
      id: state.nextId++, study_id: studyId, term, english: null, group_label: null, definition: null, example: null, simple_text: null, deeper_text: null,
      content_source: 'none', status: 'active', review_state: 'new', origin, note: null, suggestions: null, feedback: [], legacy_voice_concept_id: null,
      created_at: iso(), updated_at: iso(),
    };
    state.items.push(it);
    return it;
  }
  function fill(it, term) {
    Object.assign(it, {
      term, english: 'english ' + term, group_label: '기본 그룹', definition: term + '의 정의입니다.', example: term + '의 예시입니다.',
      simple_text: term + '을(를) 쉽게 말하면 이렇습니다.', deeper_text: term + '을(를) 깊게 보면 이렇습니다.', content_source: 'ai', suggestions: suggestionsFor(term),
    });
  }
  function publicItem(it, study) {
    const keys = new Set(state.items.filter(i => i.study_id === study.id).map(i => key(i.term)));
    return { ...it, suggestions: (it.suggestions || []).filter(s => !keys.has(key(s.term))) };
  }
  function linkExists(a, b) { return state.links.some(l => (l.from_item_id === a && l.to_item_id === b) || (l.from_item_id === b && l.to_item_id === a)); }
  function select(study, itemId) {
    study.selected_item_id = itemId;
    if (study.path[study.path.length - 1] !== itemId) study.path.push(itemId);
    study.path = study.path.slice(-12);
    study.updated_at = iso();
  }

  async function handleApi(req, res, url, body) {
    const u = url.pathname, m = req.method;
    let mm;
    state.log.push({ method: m, url: u, body, search: url.search });
    const J = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (u === '/api/admin/users' && m === 'GET') return J(200, state.adminUsers);
    if (u === '/api/admin/stats') return J(200, { users: { total: state.adminUsers.length, active: state.adminUsers.length, blocked: 0, pending: 0, admins: 1 }, usage: [], monthly: [], cost: { total: { anthropic: 0, openai: 0 }, monthly: { anthropic: 0, openai: 0 } } });
    if ((mm = u.match(/^\/api\/admin\/users\/(\d+)$/)) && m === 'PATCH') {
      const user = state.adminUsers.find(x => x.id === Number(mm[1]));
      if (!user) return J(404, { error: '사용자를 찾을 수 없습니다.' });
      Object.assign(user, body);
      return J(200, user);
    }
    if (u === '/api/me') return state.authed ? J(200, state.me) : J(401, { error: 'no' });
    if (!state.authed) return J(401, { error: '로그인이 필요합니다.' });
    if (u === '/api/voice-notes/quiz-summary' && m === 'GET') return J(200, state.voiceQuizSummary);   // 작업224-2
    if (u === '/api/voice-notes/wrong-answers' && m === 'GET') return J(200, state.voiceWrong);
    if (u === '/api/voice-notes' && m === 'GET') return J(200, state.voiceNotes);   // 작업196: 음성 학습 목록 화면 테스트용
    // 작업214-4: 음성 학습 자료 연결 지도(routes/voice_study.js 214-2의 응답 형태를 따른다)
    if (u.startsWith('/api/voice-notes/map') || u === '/api/voice-notes/links' || u.startsWith('/api/voice-notes/links/')) {
      const vm = state.voiceMap, vb = state.voiceBuild;
      const SUBJ = ['국어', '영어', '수학', '과학', '사회', '역사', '기타'];
      const linkOut = l => ({ id: l.id, from_note_id: l.from_note_id, to_note_id: l.to_note_id, kind: l.kind, relation: l.relation || '', quote_from: l.quote_from || '', quote_to: l.quote_to || '', source: l.source, user_edited: !!l.user_edited });
      if (u === '/api/voice-notes/map' && m === 'GET') {
        const subject = url.searchParams.get('subject');
        if (!SUBJ.includes(subject)) return J(400, { error: '과목이 올바르지 않습니다.' });
        const nodes = vm.nodes.filter(n => n.subject === subject);
        const ids = new Set(nodes.map(n => n.id));
        return J(200, { nodes: nodes.map(n => ({ id: n.id, title: n.title || '', subject: n.subject, has_summary: !!n.has_summary })), links: vm.links.filter(l => ids.has(l.from_note_id) && ids.has(l.to_note_id)).map(linkOut), built_at: vm.built_at });
      }
      if (u === '/api/voice-notes/links' && m === 'POST') {
        const a = vm.nodes.find(n => n.id === body.from_note_id), b = vm.nodes.find(n => n.id === body.to_note_id);
        if (typeof body.from_note_id !== 'number' || typeof body.to_note_id !== 'number' || body.from_note_id === body.to_note_id) return J(400, { error: 'from_note_id와 to_note_id가 필요합니다.' });
        if (!a || !b) return J(404, { error: '자료를 찾을 수 없습니다.' });
        if (typeof body.relation === 'string' && Array.from(body.relation).length > 80) return J(400, { error: '관계 설명은 80자 이하여야 합니다.' });
        if (vm.links.some(l => (l.from_note_id === a.id && l.to_note_id === b.id) || (l.from_note_id === b.id && l.to_note_id === a.id))) return J(409, { error: '이미 연결되어 있습니다.' });
        const l = { id: vm.nextId++, from_note_id: a.id, to_note_id: b.id, kind: 'manual', relation: (body.relation || '').trim(), quote_from: '', quote_to: '', source: 'user', user_edited: false };
        vm.links.push(l);
        return J(201, linkOut(l));
      }
      if ((mm = u.match(/^\/api\/voice-notes\/links\/(\d+)$/)) && (m === 'PATCH' || m === 'DELETE')) {
        const l = vm.links.find(x => x.id === Number(mm[1]));
        if (!l) return J(404, { error: '연결을 찾을 수 없습니다.' });
        if (m === 'DELETE') { vm.links = vm.links.filter(x => x !== l); return J(200, l.source === 'user' ? { ok: true, deleted: true } : { ok: true, hidden: true }); }
        if (body.relation !== undefined && Array.from(String(body.relation)).length > 80) return J(400, { error: '관계 설명은 80자 이하여야 합니다.' });
        if (body.relation === undefined && body.swap !== true) return J(400, { error: '바꿀 내용이 없습니다.' });
        if (body.relation !== undefined) l.relation = String(body.relation).trim();
        if (body.swap === true) { const t = l.from_note_id; l.from_note_id = l.to_note_id; l.to_note_id = t; }
        l.user_edited = true;
        return J(200, linkOut(l));
      }
      if (u === '/api/voice-notes/map/build' && m === 'POST') {
        if (!SUBJ.includes(body.subject)) return J(400, { error: '과목이 올바르지 않습니다.' });
        if (body.dry_run === true) {
          if (vb.dryError) return J(vb.dryError.status, { error: vb.dryError.msg || '오류' });
          return J(200, { dry_run: true, subject: body.subject, ...vb.dry });
        }
        if (vb.error) return J(vb.error.status, { error: vb.error.msg || '오류' });
        vb.statusIdx = 0;
        return J(202, { ok: true, started: true, targets: vb.dry.targets, will_process: vb.willProcess, max_per_run: vb.dry.max_per_run, carry_over: vb.dry.carry_over });
      }
      if (u === '/api/voice-notes/map/build-status' && m === 'GET') {
        if (!SUBJ.includes(url.searchParams.get('subject'))) return J(400, { error: '과목이 올바르지 않습니다.' });
        if (!vb.statusSeq.length) return J(200, { status: 'idle', done: 0, total: 0, links_added: 0, built_at: null });
        const item = vb.statusSeq[Math.min(vb.statusIdx, vb.statusSeq.length - 1)];
        vb.statusIdx++;
        return J(200, item);
      }
    }
    // 작업215-2: 자료 상세(GET /api/voice-notes/:id)와 상세 화면이 함께 부르는 연결·퀴즈·그림 조회. 필드는 routes/voice_study.js의 상세 응답과 같다
    const vn = u.match(/^\/api\/voice-notes\/(\d+)(?:\/(links|quiz|image))?$/);
    if (vn && m === 'GET') {
      const note = state.voiceNotes.find(n => n.id === Number(vn[1]));
      if (!note) return J(404, { error: '자료를 찾을 수 없습니다.' });
      if (vn[2] === 'links') {
        const id = note.id, vm = state.voiceMap;
        const rows = vm.links.filter(l => l.from_note_id === id || l.to_note_id === id).map(l => {
          const otherId = l.from_note_id === id ? l.to_note_id : l.from_note_id, other = vm.nodes.find(n => n.id === otherId) || {};
          return { note_id: otherId, title: other.title || '', kind: l.kind, relation: l.relation || '', quote_self: (l.from_note_id === id ? l.quote_from : l.quote_to) || '', quote_other: (l.from_note_id === id ? l.quote_to : l.quote_from) || '' };
        });
        return J(200, { status: rows.length ? 'ready' : 'none', links: rows, keywords: [] });
      }
      if (vn[2] === 'quiz') { const qz = state.voiceQuizzes[note.id]; return qz ? J(200, { questions: qz }) : J(404, { error: '없음' }); }   // 작업224-2: 저장된 퀴즈가 있는 자료
      if (vn[2]) return J(404, { error: '없음' });   // 그림은 아직 없는 자료
      return J(200, {
        id: note.id, title: note.title || '', transcript: note.transcript || '', summary: note.summary || '', subject: note.subject || null,
        subject_detail: note.subject_detail || null, created_at: note.created_at || '2026-01-01T00:00:00Z', updated_at: note.updated_at || note.created_at || '2026-01-01T00:00:00Z',
        summary_stale: false, merged_from: null,
      });
    }
    if (state.delayMs && u.startsWith('/api/concepts')) await new Promise(r => setTimeout(r, state.delayMs));
    if (u === '/api/concepts/studies' && m === 'GET') {
      return J(200, state.studies.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(({ path: p, ...s }) => {
        const items = state.items.filter(i => i.study_id === s.id);
        return { ...s, item_count: items.length, understood_count: items.filter(i => i.review_state === 'understood').length };
      }));
    }
    if (u === '/api/concepts/studies' && m === 'POST') {
      const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
      if (!topic) return J(400, { error: '분야 이름을 입력해 주세요.' });
      if (state.studies.length >= 20) return J(400, { error: '분야는 최대 20개까지 만들 수 있습니다.' });
      const s = { id: state.nextId++, topic, selected_item_id: null, path: [], created_at: iso(), updated_at: iso() };
      state.studies.push(s);
      return J(201, { ...s, item_count: 0, understood_count: 0 });
    }
    if ((mm = u.match(/^\/api\/concepts\/studies\/(\d+)$/))) {
      const s = studyOf(Number(mm[1]));
      if (!s) return J(404, { error: '학습을 찾을 수 없습니다.' });
      if (m === 'GET') {
        const items = state.items.filter(i => i.study_id === s.id);
        const ids = new Set(items.map(i => i.id));
        return J(200, { study: { ...s, path: s.path.filter(n => ids.has(n)) }, items: items.map(i => publicItem(i, s)), links: state.links.filter(l => l.study_id === s.id) });
      }
      if (m === 'PATCH') {
        if (body.topic !== undefined) s.topic = String(body.topic).trim();
        if (body.selected_item_id !== undefined) {
          if (body.selected_item_id === null) s.selected_item_id = null;
          else { const it = itemOf(body.selected_item_id); if (!it || it.study_id !== s.id) return J(404, { error: '개념을 찾을 수 없습니다.' }); select(s, it.id); }
        }
        s.updated_at = iso();
        return J(200, { ...s });
      }
      if (m === 'DELETE') {
        state.items = state.items.filter(i => i.study_id !== s.id); state.links = state.links.filter(l => l.study_id !== s.id);
        state.studies = state.studies.filter(x => x !== s);
        return J(200, { ok: true });
      }
    }
    if ((mm = u.match(/^\/api\/concepts\/studies\/(\d+)\/items$/)) && m === 'POST') {
      const s = studyOf(Number(mm[1]));
      if (!s) return J(404, { error: '학습을 찾을 수 없습니다.' });
      const term = typeof body.term === 'string' ? body.term.trim() : '';
      if (!term) return J(400, { error: '개념 이름을 입력해 주세요.' });
      if (state.items.filter(i => i.study_id === s.id).length >= 60) return J(400, { error: '한 분야에는 개념을 최대 60개까지 담을 수 있습니다.' });
      if (state.items.some(i => i.study_id === s.id && key(i.term) === key(term))) return J(409, { error: '이미 있는 개념입니다.' });
      return J(201, newItem(s.id, term, body.origin || '직접 입력'));
    }
    if ((mm = u.match(/^\/api\/concepts\/studies\/(\d+)\/explore$/)) && m === 'POST') {
      const s = studyOf(Number(mm[1]));
      if (!s) return J(404, { error: '학습을 찾을 수 없습니다.' });
      const plan = state.explorePlan.shift() || {};
      if (plan.network) state.networkDown = true;      // 브라우저의 자동 재시도에도 계속 끊기도록 test가 networkDown=false로 풀 때까지 유지
      if (state.networkDown) return req.socket.destroy();
      if (plan.status && plan.status !== 200) return J(plan.status, plan.body || { error: '오류' });
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return J(400, { error: '입력을 입력해 주세요.' });
      let it = state.items.find(i => i.study_id === s.id && key(i.term) === key(text));
      if (it && it.content_source !== 'none') return J(409, { error: '이미 있는 개념입니다.' });
      if (!it) {
        if (state.items.filter(i => i.study_id === s.id).length >= 60) return J(400, { error: '한 분야에는 개념을 최대 60개까지 담을 수 있습니다.' });
        it = newItem(s.id, text, { start: '직접 시작', suggestion: 'AI 제안', input: '직접 입력' }[body.via] || '직접 입력');
      }
      select(s, it.id);
      if (plan.aiError) return J(200, { item: publicItem(it, s), link: null, ai_error: '설명을 가져오지 못했습니다.' });
      fill(it, plan.term || it.term);
      let link = null;
      if (body.from_item_id && body.from_item_id !== it.id && itemOf(body.from_item_id) && !linkExists(body.from_item_id, it.id)) {
        link = { id: state.nextId++, study_id: s.id, from_item_id: body.from_item_id, to_item_id: it.id, relation_type: plan.relation || '포함', label: plan.label || '이어짐', detail: '관계 설명입니다.', source: 'ai', user_edited: false, created_at: iso() };
        state.links.push(link);
      }
      const links = [];
      for (const term of plan.extraLinks || []) {
        const other = state.items.find(i => i.study_id === s.id && key(i.term) === key(term));
        if (!other || other.id === it.id || linkExists(other.id, it.id)) continue;
        const l = { id: state.nextId++, study_id: s.id, from_item_id: it.id, to_item_id: other.id, relation_type: '비슷함', label: '닮음', detail: term + '과(와) 닮은 점이 있습니다.', source: 'ai', user_edited: false, created_at: iso() };
        state.links.push(l); links.push(l);
      }
      return J(200, { item: publicItem(it, s), link, links });
    }
    if ((mm = u.match(/^\/api\/concepts\/items\/(\d+)$/))) {
      const it = itemOf(Number(mm[1]));
      if (!it) return J(404, { error: '개념을 찾을 수 없습니다.' });
      if (m === 'PATCH') {
        for (const f of ['term', 'group_label', 'status', 'review_state', 'note']) if (body[f] !== undefined) it[f] = body[f];
        for (const f of ['definition', 'example', 'simple_text', 'deeper_text']) if (body[f] !== undefined) { it[f] = body[f] === '' ? null : body[f]; it.content_source = 'user'; }
        it.updated_at = iso();
        return J(200, { ...it });
      }
      if (m === 'DELETE') {
        state.items = state.items.filter(i => i !== it); state.links = state.links.filter(l => l.from_item_id !== it.id && l.to_item_id !== it.id);
        const s = studyOf(it.study_id); if (s && s.selected_item_id === it.id) s.selected_item_id = null;
        return J(200, { ok: true });
      }
    }
    if ((mm = u.match(/^\/api\/concepts\/items\/(\d+)\/respond$/)) && m === 'POST') {
      const it = itemOf(Number(mm[1]));
      if (!it) return J(404, { error: '개념을 찾을 수 없습니다.' });
      const plan = state.respondPlan.shift() || {};
      if (plan.status && plan.status !== 200) return J(plan.status, plan.body || { error: '오류' });
      const s = studyOf(it.study_id);
      it.feedback = [...(it.feedback || []), { kind: body.kind, at: iso() }].slice(-5);
      if (plan.aiError) return J(200, { item: publicItem(it, s), ai_error: '실패' });
      if (body.kind === 'easier') it.simple_text = '더 쉬운 설명입니다.';
      if (body.kind === 'deeper') it.deeper_text = '더 깊은 설명입니다.';
      if (body.kind === 'other') it.suggestions = [{ term: '다른 길 제안 X', reason: '다른 방향입니다.', relation_type: '비슷함', relation_label: '곁가지', load: '보통' }];
      return J(200, { item: publicItem(it, s) });
    }
    if ((mm = u.match(/^\/api\/concepts\/items\/(\d+)\/suggestions\/refresh$/)) && m === 'POST') {
      const it = itemOf(Number(mm[1]));
      if (!it) return J(404, { error: '개념을 찾을 수 없습니다.' });
      const s = studyOf(it.study_id);
      const plan = state.refreshPlan.shift() || {};
      if (plan.status && plan.status !== 200) return J(plan.status, plan.body || { error: '오류' });
      if (publicItem(it, s).suggestions.length) return J(200, { item: publicItem(it, s), refreshed: false });
      if (plan.aiError) return J(200, { item: publicItem(it, s), refreshed: false, ai_error: '실패' });
      it.suggestions = [{ term: '새로 받은 제안 Y', reason: '새 제안입니다.', relation_type: '순서', relation_label: '다음', load: '가벼움' }];
      return J(200, { item: publicItem(it, s), refreshed: true });
    }
    if ((mm = u.match(/^\/api\/concepts\/studies\/(\d+)\/links$/)) && m === 'POST') {
      const s = studyOf(Number(mm[1]));
      if (!s) return J(404, { error: '학습을 찾을 수 없습니다.' });
      if (linkExists(body.from_item_id, body.to_item_id)) return J(409, { error: '이미 연결되어 있습니다.' });
      const l = { id: state.nextId++, study_id: s.id, from_item_id: body.from_item_id, to_item_id: body.to_item_id, relation_type: body.relation_type || '기타 관련', label: body.label || null, detail: body.detail || null, source: 'user', user_edited: false, created_at: iso() };
      state.links.push(l);
      return J(201, l);
    }
    if ((mm = u.match(/^\/api\/concepts\/links\/(\d+)$/)) && m === 'PATCH') {
      const l = state.links.find(x => x.id === Number(mm[1]));
      if (!l) return J(404, { error: '연결을 찾을 수 없습니다.' });
      if (state.patchLinkPlan && state.patchLinkPlan.length) { const pl = state.patchLinkPlan.shift(); if (pl.status) return J(pl.status, pl.body || { error: '오류' }); }
      if (body.relation_type !== undefined) l.relation_type = body.relation_type;
      if (body.label !== undefined) l.label = String(body.label).trim() || null;
      if (body.detail !== undefined) l.detail = String(body.detail).trim() || null;
      if (body.swap === true) { const f = l.from_item_id; l.from_item_id = l.to_item_id; l.to_item_id = f; }
      l.user_edited = true;
      return J(200, l);
    }
    if ((mm = u.match(/^\/api\/concepts\/links\/(\d+)$/)) && m === 'DELETE') {
      const l = state.links.find(x => x.id === Number(mm[1]));
      if (!l) return J(404, { error: '연결을 찾을 수 없습니다.' });
      state.links = state.links.filter(x => x !== l);
      return J(200, { ok: true });
    }
    // 작업206: 개념학습 음성 입력(변환 모의 - 실제 OpenAI 호출 없음)
    if (u === '/api/concepts/voice/transcribe' && m === 'POST') {
      state.voiceCalls.push({ type: req.headers['content-type'], seconds: req.headers['x-audio-seconds'], bytes: Number(req.headers['content-length'] || 0) });
      const plan = state.voicePlan.shift() || { status: 200, body: { text: '광합성' } };
      return J(plan.status, plan.body);
    }
    // 작업205: 돌아보기 퀴즈. 서버와 같은 규칙(활성·설명 있음, 4개 미만이면 안내, 헷갈림→새것→이해함)을 간단히 흉내 낸다.
    // 정답 위치는 문제 번호로 돌려 가며 정하고, 정답 정보는 토큰 안에만 둔다(응답 본문에는 없음).
    if ((mm = u.match(/^\/api\/concepts\/studies\/(\d+)\/review$/)) && m === 'GET') {
      const s = studyOf(Number(mm[1]));
      if (!s) return J(404, { error: '학습을 찾을 수 없습니다.' });
      const rank = { confused: 0, new: 1, understood: 2 };
      const pool = state.items.filter(i => i.study_id === s.id && i.status === 'active' && i.definition && i.definition.trim())
        .sort((a, b) => (rank[a.review_state] - rank[b.review_state]) || a.id - b.id);
      if (pool.length < 4) return J(200, { questions: [], eligible: pool.length, min: 4, message: '퀴즈를 만들려면 설명이 있는 개념이 4개 이상 필요합니다.' });
      const count = Math.min(Number(url.searchParams.get('count')) || 5, 10, pool.length);
      const questions = pool.slice(0, count).map((target, qi) => {
        const kind = qi % 2 === 0 ? 'A' : 'B';
        const others = pool.filter(x => x.id !== target.id).slice(qi % (pool.length - 1)).concat(pool.filter(x => x.id !== target.id)).slice(0, 3);
        const opts = others.slice(); opts.splice(qi % 4, 0, target);
        const text = it => (kind === 'A' ? it.term : it.definition);
        return { kind, prompt: kind === 'A' ? target.definition : target.term, options: opts.map(text), ai_source: target.content_source === 'ai',
          token: Buffer.from(JSON.stringify({ i: target.id, o: opts.map(o => o.id), s: s.id })).toString('base64url') };
      });
      return J(200, { questions, eligible: pool.length, min: 4 });
    }
    if ((mm = u.match(/^\/api\/concepts\/studies\/(\d+)\/review\/answer$/)) && m === 'POST') {
      let t = null;
      try { t = JSON.parse(Buffer.from(String(body.token), 'base64url').toString('utf8')); } catch (e) { /* 잘못된 토큰 */ }
      if (!t || t.s !== Number(mm[1]) || !Number.isInteger(body.choice) || body.choice < 0 || body.choice > 3) return J(400, { error: '문제가 올바르지 않거나 만료되었습니다. 퀴즈를 다시 시작해 주세요.' });
      const it = itemOf(t.i);
      if (!it) return J(404, { error: '개념을 찾을 수 없습니다.' });
      const correct = t.o[body.choice] === t.i;
      state.quizAnswers.push({ item_id: it.id, correct });
      return J(200, { correct, correct_index: t.o.indexOf(t.i), item: { id: it.id, term: it.term, definition: it.definition, example: it.example, content_source: it.content_source, review_state: it.review_state } });
    }
    return J(404, { error: 'mock: 알 수 없는 경로 ' + m + ' ' + u });
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) {
        let body = {};
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch (e) { /* 빈 본문 */ }
        try { await handleApi(req, res, url, body); } catch (e) { res.writeHead(500); res.end(String(e && e.message)); }
        return;
      }
      const rel = url.pathname === '/' ? '/home/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;   // 서버의 '/'·'/admin' 라우트와 같게
      const file = path.join(PUBLIC, decodeURIComponent(rel));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  return {
    url: base,
    get state() { return state; },
    reset() { state = freshState(); },
    // 음성 학습 지도 시드: 지도 노드와 연결을 넣고, 같은 노드로 자료 목록·상세도 채운다
    seedVoiceMap({ nodes = [], links = [], built_at = null } = {}) {
      state.voiceMap = { nodes: nodes.map(n => ({ subject: '과학', has_summary: true, ...n })), links: links.map(l => ({ kind: 'background', relation: '', quote_from: '', quote_to: '', source: 'ai', user_edited: false, ...l })), built_at, nextId: 1000 };
      state.voiceNotes = state.voiceMap.nodes.map(n => ({ id: n.id, title: n.title, summary: n.has_summary ? '요약' : '', transcript: '원문', subject: n.subject, created_at: '2026-01-01T00:00:00Z' }));
    },
    seed({ topic = '생물 · 세포', items = [], links = [], path: p = null }) {
      const s = { id: state.nextId++, topic, selected_item_id: null, path: [], created_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-02T00:00:00.000Z' };
      state.studies.push(s);
      const made = items.map(spec => {
        const it = newItem(s.id, spec.term, spec.origin || '직접 시작');
        if (spec.filled !== false) fill(it, spec.term);
        Object.assign(it, spec.set || {});
        return it;
      });
      for (const [a, b, rel] of links) {
        state.links.push({ id: state.nextId++, study_id: s.id, from_item_id: made[a].id, to_item_id: made[b].id, relation_type: (rel && rel.relation_type) || '포함', label: (rel && rel.label) || '이어짐', detail: rel && 'detail' in rel ? rel.detail : '관계 설명', source: (rel && rel.source) || 'ai', user_edited: !!(rel && rel.user_edited), created_at: iso() });
      }
      if (p) { s.path = p.map(i => made[i].id); s.selected_item_id = s.path[s.path.length - 1]; }
      else if (made.length) { s.selected_item_id = made[0].id; s.path = [made[0].id]; }
      return { study: s, items: made };
    },
    close: () => new Promise(r => server.close(r)),
  };
}

module.exports = { startMockServer };
