const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const T = require('../lib/cmap_topics');
const AI = require('../lib/cmap_ai');

const router = express.Router();

// 작업270-1: 새 메뉴 "개념 지도"(옛 개념학습과 별도).
// 옛 checkPermission 은 "명시적 false 일 때만 거부(fail-open)"라서 쓰지 않는다. 개발 중인 기능이므로
// users.perm_concept_map 이 명시적으로 true 인 계정만 통과시킨다(fail-closed): DB 없음·조회 실패·행 없음·차단 계정은 모두 거부.
async function requireCmapPerm(req, res, next) {
  if (!process.env.DATABASE_URL) return res.status(403).json({ ok: false, error: '개념 지도 권한이 없습니다.' });
  try {
    const { rows } = await pool.query('SELECT is_blocked, perm_concept_map FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (!u || u.is_blocked || u.perm_concept_map !== true) return res.status(403).json({ ok: false, error: '개념 지도 권한이 없습니다.' });
    next();
  } catch (err) {
    console.error('cmap permission error:', err.message);
    res.status(403).json({ ok: false, error: '개념 지도 권한을 확인하지 못했습니다.' });
  }
}

const guard = [requireAuth, requireCmapPerm];

router.get('/api/cmap/status', guard, (req, res) => {
  res.json({ ok: true, perm: true, stage: 1 });
});

// ─── 작업271-1: 주제 트리와 개념(직접 입력). AI 호출 없음 ─────────────────────────────────────
// 규칙은 서버에서 강제한다: 깊이 최대 5(최상위=1), 같은 부모 아래 이름 중복 금지(대소문자 무시, 최상위끼리도),
// 이동 시 순환 금지·가지 전체의 깊이 검사·root_id 갱신, 삭제 정책(하위 = 아래 항목을 부모로 올린 뒤 삭제 / 최상위 = confirm=1 필요).
// 변경 라우트는 트랜잭션 안에서 사용자의 주제 행을 FOR UPDATE 로 잠가, 동시 요청이 검사를 피해 가지 못하게 한다.
const MAX_PG_INT = 2147483647;
const TOPIC_COLS = 'id, parent_id, root_id, title, sort_order, created_at, updated_at';
const CONCEPT_COLS = 'id, topic_id, term, english, memo, content_source, sort_order, explanation, explanation_source, explained_at, created_at, updated_at';
const SERVER_ERROR = '서버 오류가 발생했습니다.';

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
const bad = (message, extra) => new HttpError(400, message, extra);
const notFound = message => new HttpError(404, message);
const conflict = (message, extra) => new HttpError(409, message, extra);

function parseId(raw) {
  if (!/^\d{1,10}$/.test(String(raw))) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PG_INT ? n : null;
}
const bodyOf = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// 라우트 본문을 감싼다: 반환값 = { status?, body }. HttpError 는 {ok:false,error,...}, DB 중복 제약(23505)은 409
function handle(fn) {
  return async (req, res) => {
    try {
      const out = await fn(req);
      res.status(out.status || 200).json({ ok: true, ...out.body });
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ ok: false, error: err.message, ...err.extra });
      if (err && err.code === '23505') return res.status(409).json({ ok: false, error: '같은 이름이 이미 있습니다.' });
      console.error('cmap error:', err && err.message);
      res.status(500).json({ ok: false, error: SERVER_ERROR });
    }
  };
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* 무시 */ }
    throw err;
  } finally {
    client.release();
  }
}

async function loadTopics(db, userId, { lock = false } = {}) {
  const { rows } = await db.query(`SELECT ${TOPIC_COLS} FROM cmap_topics WHERE user_id = $1 ORDER BY sort_order, id${lock ? ' FOR UPDATE' : ''}`, [userId]);
  return rows;
}
async function conceptCounts(db, userId) {
  const { rows } = await db.query('SELECT topic_id, COUNT(*)::int AS n FROM cmap_concepts WHERE user_id = $1 GROUP BY topic_id', [userId]);
  return new Map(rows.map(r => [r.topic_id, r.n]));
}

function readParentId(body, { required }) {
  if (!has(body, 'parent_id')) {
    if (required) throw bad('parent_id가 필요합니다. 최상위로 옮기려면 null을 보내세요.');
    return null;
  }
  const v = body.parent_id;
  if (v === null) return null;
  if (typeof v !== 'number' || parseId(String(v)) === null) throw bad('parent_id가 올바르지 않습니다.');
  return v;
}

router.get('/api/cmap/topics', guard, handle(async req => {
  const topics = await loadTopics(pool, req.user.id);
  const idx = T.buildIndex(topics);
  const counts = await conceptCounts(pool, req.user.id);
  return { body: { max_depth: T.MAX_DEPTH, topics: topics.map(t => ({ ...t, depth: T.depthOf(idx, t.id), concept_count: counts.get(t.id) || 0 })) } };
}));

router.post('/api/cmap/topics', guard, handle(async req => {
  const body = bodyOf(req);
  const title = T.readName(body.title, T.TITLE_MAX, '주제 이름');
  if (title.error) throw bad(title.error);
  const parentId = readParentId(body, { required: false });
  return withTx(async c => {
    const idx = T.buildIndex(await loadTopics(c, req.user.id, { lock: true }));
    if (parentId !== null) {
      if (!idx.byId.has(parentId)) throw notFound('상위 주제를 찾을 수 없습니다.');
      if (T.depthOf(idx, parentId) + 1 > T.MAX_DEPTH) throw bad(`주제는 최대 ${T.MAX_DEPTH}단계까지 만들 수 있습니다.`);
    }
    const dup = T.findSibling(idx, parentId, title.value, null);
    if (dup) throw conflict(`같은 위치에 '${dup.title}' 주제가 이미 있습니다.`);
    const { rows } = await c.query(
      `INSERT INTO cmap_topics (user_id, parent_id, root_id, title, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING ${TOPIC_COLS}`,
      [req.user.id, parentId, T.rootIdForParent(idx, parentId), title.value, T.nextSortOrder(idx, parentId)]);
    return { status: 201, body: { topic: { ...rows[0], depth: parentId === null ? 1 : T.depthOf(idx, parentId) + 1, concept_count: 0 } } };
  });
}));

router.patch('/api/cmap/topics/:id', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('주제를 찾을 수 없습니다.');
  const title = T.readName(bodyOf(req).title, T.TITLE_MAX, '주제 이름');
  if (title.error) throw bad(title.error);
  return withTx(async c => {
    const idx = T.buildIndex(await loadTopics(c, req.user.id, { lock: true }));
    const topic = idx.byId.get(id);
    if (!topic) throw notFound('주제를 찾을 수 없습니다.');
    const dup = T.findSibling(idx, topic.parent_id, title.value, id);
    if (dup) throw conflict(`같은 위치에 '${dup.title}' 주제가 이미 있습니다.`);
    const { rows } = await c.query(`UPDATE cmap_topics SET title = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING ${TOPIC_COLS}`, [title.value, id, req.user.id]);
    return { body: { topic: { ...rows[0], depth: T.depthOf(idx, id) } } };
  });
}));

router.post('/api/cmap/topics/:id/move', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('주제를 찾을 수 없습니다.');
  const newParentId = readParentId(bodyOf(req), { required: true });
  return withTx(async c => {
    const idx = T.buildIndex(await loadTopics(c, req.user.id, { lock: true }));
    const topic = idx.byId.get(id);
    if (!topic) throw notFound('주제를 찾을 수 없습니다.');
    const curParent = topic.parent_id === undefined ? null : topic.parent_id;
    if (curParent === newParentId) return { body: { topic: { ...topic, depth: T.depthOf(idx, id) }, moved: false } };
    if (newParentId !== null) {
      if (!idx.byId.has(newParentId)) throw notFound('옮길 위치의 주제를 찾을 수 없습니다.');
      if (T.isSelfOrDescendant(idx, id, newParentId)) throw bad('자기 자신이나 자기 하위 주제 아래로는 옮길 수 없습니다.');
      // 이동하는 가지의 가장 깊은 하위까지 포함해 검사한다
      if (T.depthOf(idx, newParentId) + T.subtreeHeight(idx, id) > T.MAX_DEPTH) throw bad(`옮기면 주제가 ${T.MAX_DEPTH}단계를 넘어서 옮길 수 없습니다.`);
    }
    const dup = T.findSibling(idx, newParentId, topic.title, id);
    if (dup) throw conflict(`옮길 위치에 '${dup.title}' 주제가 이미 있습니다.`);
    const newRoot = T.rootIdForParent(idx, newParentId);
    const { rows } = await c.query(
      `UPDATE cmap_topics SET parent_id = $1, root_id = $2, sort_order = $3, updated_at = now() WHERE id = $4 AND user_id = $5 RETURNING ${TOPIC_COLS}`,
      [newParentId, newRoot, T.nextSortOrder(idx, newParentId), id, req.user.id]);
    // 가지 전체의 root_id 갱신: 최상위가 되면 이 주제가 루트, 아니면 새 부모의 루트
    const descRoot = newParentId === null ? id : newRoot;
    for (const d of T.descendants(idx, id)) {
      await c.query('UPDATE cmap_topics SET root_id = $1, updated_at = now() WHERE id = $2 AND user_id = $3', [descRoot, d.id, req.user.id]);
    }
    return { body: { topic: rows[0], moved: true } };
  });
}));

router.delete('/api/cmap/topics/:id', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('주제를 찾을 수 없습니다.');
  const confirm = req.query.confirm === '1';
  return withTx(async c => {
    const idx = T.buildIndex(await loadTopics(c, req.user.id, { lock: true }));
    const topic = idx.byId.get(id);
    if (!topic) throw notFound('주제를 찾을 수 없습니다.');

    if (topic.parent_id !== null && topic.parent_id !== undefined) {
      // 하위 주제: 아래 하위 주제와 개념을 부모로 올린 뒤 삭제. 이름이 겹치면 막고 자동 개명은 하지 않는다
      const parent = idx.byId.get(topic.parent_id);
      const children = idx.children.get(id) || [];
      const all = (await c.query('SELECT id, topic_id, term FROM cmap_concepts WHERE user_id = $1', [req.user.id])).rows;
      const mine = all.filter(x => x.topic_id === id);
      const parentTerms = new Set(all.filter(x => x.topic_id === parent.id).map(x => T.nameKey(x.term)));
      const topicClash = children.filter(ch => T.findSibling(idx, parent.id, ch.title, id)).map(ch => ch.title);
      const conceptClash = mine.filter(x => parentTerms.has(T.nameKey(x.term))).map(x => x.term);
      if (topicClash.length || conceptClash.length) {
        const parts = [];
        if (topicClash.length) parts.push('하위 주제 ' + topicClash.map(n => `'${n}'`).join(', '));
        if (conceptClash.length) parts.push('개념 ' + conceptClash.map(n => `'${n}'`).join(', '));
        throw conflict(`상위 주제 '${parent.title}'에 같은 이름이 있어 삭제할 수 없습니다. 겹치는 이름: ${parts.join(' / ')}. 이름을 바꾼 뒤 다시 시도해 주세요.`,
          { conflicts: { topics: topicClash, concepts: conceptClash } });
      }
      let order = T.nextSortOrder(idx, parent.id);
      for (const ch of children) {
        await c.query('UPDATE cmap_topics SET parent_id = $1, sort_order = $2, updated_at = now() WHERE id = $3 AND user_id = $4', [parent.id, order++, ch.id, req.user.id]);
      }
      await c.query('UPDATE cmap_concepts SET topic_id = $1, updated_at = now() WHERE topic_id = $2 AND user_id = $3', [parent.id, id, req.user.id]);
      await c.query('DELETE FROM cmap_topics WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      return { body: { deleted: id, parent_id: parent.id, moved: { topics: children.length, concepts: mine.length } } };
    }

    // 최상위 주제: 아래 전부 삭제 — confirm=1 이 있어야 한다
    const sub = T.descendants(idx, id);
    const counts = await conceptCounts(c, req.user.id);
    const conceptTotal = [id, ...sub.map(t => t.id)].reduce((n, tid) => n + (counts.get(tid) || 0), 0);
    if (!confirm) {
      throw conflict('최상위 주제를 삭제하면 아래 항목이 모두 삭제됩니다. 삭제하려면 확인이 필요합니다.',
        { needs_confirm: true, counts: { topics: sub.length, concepts: conceptTotal } });
    }
    for (const tid of [id, ...sub.map(t => t.id)]) await c.query('DELETE FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2', [tid, req.user.id]);
    await c.query('DELETE FROM cmap_topics WHERE root_id = $1 AND user_id = $2', [id, req.user.id]);
    await c.query('DELETE FROM cmap_topics WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    return { body: { deleted: id, deleted_counts: { topics: sub.length, concepts: conceptTotal } } };
  });
}));

// ─── 개념 ──────────────────────────────────────────────────────────────────────

function readConceptFields(body, { partial }) {
  const out = {};
  if (!partial || has(body, 'term')) {
    const t = T.readName(body.term, T.TERM_MAX, '개념 이름');
    if (t.error) throw bad(t.error);
    out.term = t.value;
  }
  if (has(body, 'english')) {
    const e = T.readOptional(body.english, T.ENGLISH_MAX, '영문 표기');
    if (e.error) throw bad(e.error);
    out.english = e.value;
  }
  if (has(body, 'memo')) {
    const m = T.readOptional(body.memo, T.MEMO_MAX, '메모', { multiline: true });
    if (m.error) throw bad(m.error);
    out.memo = m.value;
  }
  return out;
}

// 작업273-1: 개념 저장 요청의 설명(explanation, explanation_source). 서버가 형태·길이를 다시 검증한다.
//  - 키가 없으면 {} (변경 없음), explanation: null 이면 설명 지우기, 객체면 검증 후 값
//  - 생성(POST)에서는 explanation_source('ai' | 'manual')가 필요하다. 수정(PATCH)에서는 클라이언트가 보낸 출처를 믿지 않는다(아래 PATCH 참고)
function readExplanationFields(body, { requireSource }) {
  const hasExp = has(body, 'explanation') && body.explanation !== undefined;
  const src = body.explanation_source;
  if (!hasExp) {
    if (src !== undefined && src !== null) throw bad('explanation 없이는 explanation_source 를 쓸 수 없습니다.');
    return {};
  }
  if (body.explanation === null) {
    if (src !== undefined && src !== null) throw bad('설명을 지우는 요청에는 explanation_source 를 쓸 수 없습니다.');
    return { explanation: null, explanation_source: null };
  }
  const e = AI.readExplanation(body.explanation);
  if (e.error) throw bad(e.error);
  if (requireSource && src !== 'ai' && src !== 'manual') throw bad("explanation_source 는 'ai' 또는 'manual' 이어야 합니다.");
  return { explanation: e.value, explanation_source: requireSource ? src : undefined };
}

async function ownTopic(db, topicId, userId, { lock = false } = {}) {
  const { rows } = await db.query(`SELECT id, title FROM cmap_topics WHERE id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`, [topicId, userId]);
  if (!rows.length) throw notFound('주제를 찾을 수 없습니다.');
  return rows[0];
}

// 작업273-1: 개념 검색 → AI 백과사전 설명(저장하지 않음). 클라이언트는 term 만 보내고, 주제 맥락(최상위 주제명·하위 주제 경로)은 서버가 DB 에서 읽는다.
// 같은 주제에 같은 이름의 개념이 이미 있으면 AI 를 부르지 않고 기존 개념을 돌려준다. 하루 한도(CMAP_EXPLAIN_DAILY_CAP) 초과는 429.
// AI 실패·검증 실패는 502 {ok:false, ai_error:true}(화면이 오류 카드 + 다시 시도를 보여 줌, 자동 재시도 없음)
router.post('/api/cmap/topics/:id/explain', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('주제를 찾을 수 없습니다.');
  const term = T.readName(bodyOf(req).term, T.TERM_MAX, '개념 이름');
  if (term.error) throw bad(term.error);
  const topics = await loadTopics(pool, req.user.id);
  const idx = T.buildIndex(topics);
  const topic = idx.byId.get(id);
  if (!topic) throw notFound('주제를 찾을 수 없습니다.');
  const { rows: existing } = await pool.query(`SELECT ${CONCEPT_COLS} FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2 ORDER BY sort_order, id`, [id, req.user.id]);
  const dup = existing.find(x => T.nameKey(x.term) === T.nameKey(term.value));
  if (dup) return { body: { existing: true, concept: dup } };
  if (await AI.countToday(req.user.id, AI.EXPLAIN_EVENT) >= AI.explainDailyCap()) {
    throw new HttpError(429, `하루 ${AI.explainDailyCap()}건까지 AI 설명을 받을 수 있습니다.`);
  }
  const path = [];
  for (let cur = topic; cur; cur = cur.parent_id === null || cur.parent_id === undefined ? null : idx.byId.get(cur.parent_id)) path.unshift(cur.title);
  const input = AI.buildExplainInput({ path, term: term.value, siblings: existing.map(x => x.term) });
  const ai = await AI.callExplainAI(req.user.id, input);
  const v = ai.parsed === undefined ? null : AI.validateAiExplanation(ai.parsed);
  if (!v) throw new HttpError(502, ai.aiError || AI.AI_ERROR_TEXT, { ai_error: true });
  return { body: { existing: false, term: term.value, english: v.english, explanation: v.explanation, explanation_source: 'ai' } };
}));

router.get('/api/cmap/topics/:id/concepts', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('주제를 찾을 수 없습니다.');
  const topic = await ownTopic(pool, id, req.user.id);
  const { rows } = await pool.query(`SELECT ${CONCEPT_COLS} FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2 ORDER BY sort_order, id`, [id, req.user.id]);
  return { body: { topic, concepts: rows } };
}));

router.post('/api/cmap/topics/:id/concepts', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('주제를 찾을 수 없습니다.');
  const f = readConceptFields(bodyOf(req), { partial: false });
  const ex = readExplanationFields(bodyOf(req), { requireSource: true });
  return withTx(async c => {
    await ownTopic(c, id, req.user.id, { lock: true });
    const { rows: existing } = await c.query('SELECT id, term, sort_order FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2', [id, req.user.id]);
    const key = T.nameKey(f.term);
    const dup = existing.find(x => T.nameKey(x.term) === key);
    if (dup) throw conflict(`이 주제에 '${dup.term}' 개념이 이미 있습니다.`);
    const order = existing.reduce((m, x) => Math.max(m, Number(x.sort_order) || 0), 0) + 1;
    const { rows } = await c.query(
      `INSERT INTO cmap_concepts (user_id, topic_id, term, english, memo, sort_order, explanation, explanation_source, explained_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${CONCEPT_COLS}`,
      [req.user.id, id, f.term, f.english === undefined ? null : f.english, f.memo === undefined ? null : f.memo, order,
        ex.explanation ? JSON.stringify(ex.explanation) : null, ex.explanation ? ex.explanation_source : null, ex.explanation ? new Date() : null]);
    return { status: 201, body: { concept: rows[0] } };
  });
}));

router.patch('/api/cmap/concepts/:id', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('개념을 찾을 수 없습니다.');
  const f = readConceptFields(bodyOf(req), { partial: true });
  const ex = readExplanationFields(bodyOf(req), { requireSource: false });
  if (!Object.keys(f).length && !Object.keys(ex).length) throw bad('변경할 항목이 없습니다.');
  return withTx(async c => {
    const { rows: cur } = await c.query(`SELECT ${CONCEPT_COLS} FROM cmap_concepts WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, req.user.id]);
    if (!cur.length) throw notFound('개념을 찾을 수 없습니다.');
    const row = cur[0];
    if (f.term !== undefined && T.nameKey(f.term) !== T.nameKey(row.term)) {
      const { rows: sibs } = await c.query('SELECT id, term FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2', [row.topic_id, req.user.id]);
      const dup = sibs.find(x => x.id !== id && T.nameKey(x.term) === T.nameKey(f.term));
      if (dup) throw conflict(`이 주제에 '${dup.term}' 개념이 이미 있습니다.`);
    }
    const next = { term: f.term !== undefined ? f.term : row.term, english: f.english !== undefined ? f.english : row.english, memo: f.memo !== undefined ? f.memo : row.memo };
    // 설명: 내용이 저장된 것과 같으면 출처·시각을 그대로 두고, 다르면 사람이 고친 것이므로 출처는 항상 'manual'(클라이언트가 'ai' 라고 해도 믿지 않음). null 이면 지움
    let expl = row.explanation, explSrc = row.explanation_source, explAt = row.explained_at;
    if (ex.explanation === null) { expl = null; explSrc = null; explAt = null; }
    else if (ex.explanation) {
      const stored = row.explanation && typeof row.explanation === 'string' ? JSON.parse(row.explanation) : row.explanation;
      const same = stored && AI.EXPLAIN_FIELDS.every(k => (stored[k] || '') === ex.explanation[k]);
      if (!same) { expl = ex.explanation; explSrc = 'manual'; explAt = new Date(); }
    }
    const { rows } = await c.query(
      `UPDATE cmap_concepts SET term = $1, english = $2, memo = $3, explanation = $4, explanation_source = $5, explained_at = $6, updated_at = now() WHERE id = $7 AND user_id = $8 RETURNING ${CONCEPT_COLS}`,
      [next.term, next.english, next.memo, expl === null || expl === undefined ? null : JSON.stringify(expl), explSrc || null, explAt || null, id, req.user.id]);
    return { body: { concept: rows[0] } };
  });
}));

router.delete('/api/cmap/concepts/:id', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('개념을 찾을 수 없습니다.');
  const { rowCount } = await pool.query('DELETE FROM cmap_concepts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!rowCount) throw notFound('개념을 찾을 수 없습니다.');
  return { body: { deleted: id } };
}));

module.exports = router;
