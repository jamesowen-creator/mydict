// 화면 테스트용 서버: public/ 정적 파일 + 개념학습 API의 메모리 모의(실제 서버의 규칙을 단순하게 흉내 냄).
//   const srv = await startMockServer();  srv.url  srv.state  srv.reset()  srv.close()
//   srv.seed({ topic, items: [...], links: [...], path: [...] })  → 학습 하나를 미리 만든다
//   srv.state.explorePlan = [ { status: 429, body: {...} }, { aiError: true }, { network: true }, ... ]  // explore 호출마다 앞에서 하나씩 꺼내 씀
//   srv.state.respondPlan / refreshPlan 도 같은 방식
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
    voiceNotes: [],     // 음성 학습 자료 목록(GET /api/voice-notes)
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
    state.log.push({ method: m, url: u, body });
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
    if (u === '/api/voice-notes' && m === 'GET') return J(200, state.voiceNotes);   // 작업196: 음성 학습 목록 화면 테스트용
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
        link = { id: state.nextId++, study_id: s.id, from_item_id: body.from_item_id, to_item_id: it.id, relation_type: plan.relation || '포함', label: plan.label || '이어짐', detail: '관계 설명입니다.', source: 'ai', created_at: iso() };
        state.links.push(link);
      }
      return J(200, { item: publicItem(it, s), link });
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
      const l = { id: state.nextId++, study_id: s.id, from_item_id: body.from_item_id, to_item_id: body.to_item_id, relation_type: body.relation_type || '기타 관련', label: body.label || null, detail: body.detail || null, source: 'user', created_at: iso() };
      state.links.push(l);
      return J(201, l);
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
        state.links.push({ id: state.nextId++, study_id: s.id, from_item_id: made[a].id, to_item_id: made[b].id, relation_type: (rel && rel.relation_type) || '포함', label: (rel && rel.label) || '이어짐', detail: (rel && rel.detail) || '관계 설명', source: 'ai', created_at: iso() });
      }
      if (p) { s.path = p.map(i => made[i].id); s.selected_item_id = s.path[s.path.length - 1]; }
      else if (made.length) { s.selected_item_id = made[0].id; s.path = [made[0].id]; }
      return { study: s, items: made };
    },
    close: () => new Promise(r => server.close(r)),
  };
}

module.exports = { startMockServer };
