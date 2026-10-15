const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const T = require('../lib/cmap_topics');
const AI = require('../lib/cmap_ai');
const M = require('../lib/cmap_map');
const H = require('../lib/cmap_hash');
const N = require('../lib/cmap_narrate');
const Q = require('../lib/cmap_quiz');
const STT = require('../lib/cmap_stt');
const ANS = require('../lib/cmap_answer');

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
    // 작업273-2: 지도에 쓰이는 개념이 들어 있는 가지는 다른 최상위 주제로 옮길 수 없다(지도의 뿌리 밖으로 나가는 개념이 생기므로)
    const oldRoot = topic.root_id === null || topic.root_id === undefined ? topic.id : topic.root_id;
    if (oldRoot !== (newParentId === null ? id : newRoot)) {
      const used = await usedInMaps(c, req.user.id, [id, ...T.descendants(idx, id).map(d => d.id)]);
      if (used > 0) throw conflict(`이 가지의 개념 ${used}개가 지도에서 쓰이고 있어 다른 최상위 주제로 옮길 수 없습니다. 지도에서 먼저 빼 주세요.`, { in_maps: used });
      // 뿌리가 더 이상 최상위가 아니게 되는 주제의 (비어 있는) 지도는 지운다
      if (topic.parent_id === null || topic.parent_id === undefined) await c.query('DELETE FROM cmap_maps WHERE root_topic_id = $1 AND user_id = $2', [id, req.user.id]);
    }
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
    const mapCount = (await c.query('SELECT id, root_topic_id FROM cmap_maps WHERE user_id = $1', [req.user.id])).rows.filter(m => m.root_topic_id === id).length;   // 작업273-2
    if (!confirm) {
      throw conflict('최상위 주제를 삭제하면 아래 항목이 모두 삭제됩니다. 삭제하려면 확인이 필요합니다.',
        { needs_confirm: true, counts: { topics: sub.length, concepts: conceptTotal, maps: mapCount } });
    }
    await c.query('DELETE FROM cmap_maps WHERE root_topic_id = $1 AND user_id = $2', [id, req.user.id]);   // 지도(노드·간선 포함)를 먼저 지운다
    for (const tid of [id, ...sub.map(t => t.id)]) await c.query('DELETE FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2', [tid, req.user.id]);
    await c.query('DELETE FROM cmap_topics WHERE root_id = $1 AND user_id = $2', [id, req.user.id]);
    await c.query('DELETE FROM cmap_topics WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    return { body: { deleted: id, deleted_counts: { topics: sub.length, concepts: conceptTotal, maps: mapCount } } };
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

// 작업273-1: 개념 검색 → AI 백과사전 설명. 280-2: 설명(정의·예시 2항목)을 만들면 바로 저장한다(별도 저장 단계 없음).
// 클라이언트는 term(과 다시 설명이면 concept_id)만 보내고, 주제 맥락(최상위 주제명·하위 주제 경로)은 서버가 DB 에서 읽는다.
// 같은 주제에 같은 이름의 개념이 이미 있으면 AI 를 부르지 않고 기존 개념을 돌려준다(200 existing). 하루 한도(CMAP_EXPLAIN_DAILY_CAP) 초과는 429.
// concept_id 가 있으면 그 개념의 설명을 다시 만들어 덮어쓴다(출처 ai, 이름·메모·지도·표시는 그대로). AI 실패·검증 실패는 502 {ok:false, ai_error:true}이고 아무것도 저장하지 않는다(자동 재시도 없음)
router.post('/api/cmap/topics/:id/explain', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('주제를 찾을 수 없습니다.');
  const body = bodyOf(req);
  const topics = await loadTopics(pool, req.user.id);
  const idx = T.buildIndex(topics);
  const topic = idx.byId.get(id);
  if (!topic) throw notFound('주제를 찾을 수 없습니다.');
  const { rows: existing } = await pool.query(`SELECT ${CONCEPT_COLS} FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2 ORDER BY sort_order, id`, [id, req.user.id]);
  let target = null, termValue;
  if (has(body, 'concept_id') && body.concept_id !== undefined && body.concept_id !== null) {
    const cid = parseId(String(body.concept_id));
    target = cid === null ? null : existing.find(x => x.id === cid) || null;
    if (!target) throw notFound('개념을 찾을 수 없습니다.');
    termValue = target.term;
  } else {
    const term = T.readName(body.term, T.TERM_MAX, '개념 이름');
    if (term.error) throw bad(term.error);
    termValue = term.value;
    const dup = existing.find(x => T.nameKey(x.term) === T.nameKey(termValue));
    if (dup) return { body: { existing: true, concept: dup } };
  }
  if (await AI.countToday(req.user.id, AI.EXPLAIN_EVENT) >= AI.explainDailyCap()) {
    throw new HttpError(429, `하루 ${AI.explainDailyCap()}건까지 AI 설명을 받을 수 있습니다.`);
  }
  const path = [];
  for (let cur = topic; cur; cur = cur.parent_id === null || cur.parent_id === undefined ? null : idx.byId.get(cur.parent_id)) path.unshift(cur.title);
  const input = AI.buildExplainInput({ path, term: termValue, siblings: existing.filter(x => !target || x.id !== target.id).map(x => x.term) });
  const ai = await AI.callExplainAI(req.user.id, input);
  const v = ai.parsed === undefined ? null : AI.validateAiExplanation(ai.parsed);
  if (!v) { if (ai.parsed !== undefined) { const f = AI.explainFailReason(ai.parsed) || { reason: 'bad_shape' }; AI.logAiFail('explain', f.reason, f.chars, f.field); } throw new HttpError(502, ai.aiError || AI.AI_ERROR_TEXT, { ai_error: true }); }
  const explJson = JSON.stringify(v.explanation);
  return withTx(async c => {
    await ownTopic(c, id, req.user.id, { lock: true });
    if (target) {
      const { rows: cur } = await c.query(`SELECT ${CONCEPT_COLS} FROM cmap_concepts WHERE id = $1 AND user_id = $2 FOR UPDATE`, [target.id, req.user.id]);
      if (!cur.length) throw notFound('개념을 찾을 수 없습니다.');
      const english = cur[0].english || v.english || null;
      const kept = AI.deepenOf(cur[0].explanation);          // 282-1: [다시 설명]은 정의·예시만 다시 만들고 심화 항목은 보존한다
      const nextExpl = kept.length ? Object.assign({}, v.explanation, { deepen: kept }) : v.explanation;
      const { rows } = await c.query(
        `UPDATE cmap_concepts SET english = $1, explanation = $2, explanation_source = $3, explained_at = $4, updated_at = now() WHERE id = $5 AND user_id = $6 RETURNING ${CONCEPT_COLS}`,
        [english, JSON.stringify(nextExpl), 'ai', new Date(), target.id, req.user.id]);
      return { body: { existing: false, regenerated: true, concept: rows[0] } };
    }
    const { rows: now } = await c.query('SELECT id, term, sort_order FROM cmap_concepts WHERE topic_id = $1 AND user_id = $2', [id, req.user.id]);
    const dup = now.find(x => T.nameKey(x.term) === T.nameKey(termValue));
    if (dup) throw conflict(`이 주제에 '${dup.term}' 개념이 이미 있습니다.`);
    const order = now.reduce((m, x) => Math.max(m, Number(x.sort_order) || 0), 0) + 1;
    const { rows } = await c.query(
      `INSERT INTO cmap_concepts (user_id, topic_id, term, english, memo, sort_order, explanation, explanation_source, explained_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${CONCEPT_COLS}`,
      [req.user.id, id, termValue, v.english || null, null, order, explJson, 'ai', new Date()]);
    return { status: 201, body: { existing: false, concept: rows[0] } };
  });
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
      const same = stored && AI.ALL_FIELDS.every(k => (typeof stored[k] === 'string' ? stored[k].trim() : '') === (ex.explanation[k] || '')) && JSON.stringify(AI.deepenOf(stored)) === JSON.stringify(ex.explanation.deepen || []);
      if (!same) { expl = ex.explanation; explSrc = 'manual'; explAt = new Date(); }
    }
    const { rows } = await c.query(
      `UPDATE cmap_concepts SET term = $1, english = $2, memo = $3, explanation = $4, explanation_source = $5, explained_at = $6, updated_at = now() WHERE id = $7 AND user_id = $8 RETURNING ${CONCEPT_COLS}`,
      [next.term, next.english, next.memo, expl === null || expl === undefined ? null : JSON.stringify(expl), explSrc || null, explAt || null, id, req.user.id]);
    return { body: { concept: rows[0] } };
  });
}));

// 작업275-4: 팝업용 한 줄 설명. 저장된 설명(새 4항목·옛 4항목 형태 모두)의 정의, 없으면 읽을 수 있는 첫 항목, 설명이 없으면 null. 길면 140자에서 자른다
const BRIEF_MAX = 140;
function briefOf(explanation) {
  const first = AI.explanationEntries(explanation)[0];
  if (!first) return null;
  const chars = Array.from(first[1].replace(/\s+/g, ' '));
  return chars.length > BRIEF_MAX ? chars.slice(0, BRIEF_MAX).join('') + '…' : chars.join('');
}

// "모르는 개념" 표시 설정·해제(개념 id 단위, 멱등). 본인 개념만. 표시는 사용자별이며 지도와 무관하다
router.put('/api/cmap/concepts/:id/mark', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('개념을 찾을 수 없습니다.');
  const body = bodyOf(req);
  if (typeof body.marked !== 'boolean') throw bad('marked 는 true 또는 false 여야 합니다.');
  const { rows: own } = await pool.query('SELECT id FROM cmap_concepts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!own.length) throw notFound('개념을 찾을 수 없습니다.');
  if (!body.marked) {
    await pool.query('DELETE FROM cmap_concept_marks WHERE user_id = $1 AND concept_id = $2', [req.user.id, id]);
    return { body: { concept_id: id, marked: false } };
  }
  const { rows: have } = await pool.query('SELECT concept_id FROM cmap_concept_marks WHERE user_id = $1 AND concept_id = $2', [req.user.id, id]);
  if (!have.length) {
    try { await pool.query('INSERT INTO cmap_concept_marks (user_id, concept_id) VALUES ($1, $2) RETURNING concept_id', [req.user.id, id]); }
    catch (err) { if (!(err && err.code === '23505')) throw err; }      // 동시에 같은 표시가 먼저 들어간 경우도 성공(멱등)
  }
  return { body: { concept_id: id, marked: true } };
}));

// 작업282-1: 심화 개념 추가. 누를 때마다 설명 JSON 의 deepen 배열 끝에 항목 하나를 더한다(덮어쓰기 없음, 최대 3개, 항목당 350자 이하).
// 이미 3개면 AI 호출 전 409, 같은 개념의 생성이 진행 중이면 409(서버에서도 중복 방지), 하루 한도는 설명 생성(cmap_explain)과 합산해 초과 시 AI 호출 전 429,
// AI 실패·검증 실패는 502 {ai_error:true}(내부 재시도 없음, 아무것도 추가하지 않음). 저장 직전에 잠금을 잡고 개수를 다시 확인한다.
const deepenBusy = new Set();
router.post('/api/cmap/concepts/:id/deepen', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('개념을 찾을 수 없습니다.');
  const { rows: cur } = await pool.query(`SELECT ${CONCEPT_COLS} FROM cmap_concepts WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
  if (!cur.length) throw notFound('개념을 찾을 수 없습니다.');
  const row = cur[0];
  const expl = typeof row.explanation === 'string' ? (() => { try { return JSON.parse(row.explanation); } catch (e) { return null; } })() : row.explanation;
  if (!expl || typeof expl.definition !== 'string' || !expl.definition.trim()) throw bad('정의가 있는 개념에서만 심화 개념을 만들 수 있습니다.');
  const have = AI.deepenOf(expl);
  if (have.length >= AI.DEEPEN_MAX) throw conflict(`심화 개념은 ${AI.DEEPEN_MAX}개까지 만들 수 있습니다.`);
  const key = req.user.id + ':' + id;
  if (deepenBusy.has(key)) throw conflict('이 개념의 심화 설명을 만드는 중입니다. 잠시 기다려 주세요.');
  deepenBusy.add(key);
  try {
    if (await AI.countToday(req.user.id, AI.EXPLAIN_EVENT) >= AI.explainDailyCap()) {
      throw new HttpError(429, `하루 ${AI.explainDailyCap()}건까지 AI 설명을 받을 수 있습니다.`);
    }
    const topics = await loadTopics(pool, req.user.id);
    const idx = T.buildIndex(topics);
    const path = [];
    for (let t = idx.byId.get(row.topic_id); t; t = t.parent_id === null || t.parent_id === undefined ? null : idx.byId.get(t.parent_id)) path.unshift(t.title);
    if (!path.length) throw notFound('개념을 찾을 수 없습니다.');
    const input = AI.buildDeepenInput({ path, term: row.term, definition: expl.definition, example: expl.example, deepen: have });
    const ai = await AI.callExplainAI(req.user.id, input, AI.deepenSystemPrompt(have.length), 700);
    const v = ai.parsed === undefined ? null : AI.validateDeepen(ai.parsed);
    if (!v) { if (ai.parsed !== undefined) { const f = AI.deepenFailReason(ai.parsed) || { reason: 'bad_shape' }; AI.logAiFail('deepen', f.reason, f.chars, f.field); } throw new HttpError(502, ai.aiError || AI.AI_ERROR_TEXT, { ai_error: true }); }
    return await withTx(async c => {
      const { rows: now } = await c.query(`SELECT ${CONCEPT_COLS} FROM cmap_concepts WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, req.user.id]);
      if (!now.length) throw notFound('개념을 찾을 수 없습니다.');
      const stored = typeof now[0].explanation === 'string' ? JSON.parse(now[0].explanation) : now[0].explanation;
      const list = AI.deepenOf(stored);
      if (list.length >= AI.DEEPEN_MAX) throw conflict(`심화 개념은 ${AI.DEEPEN_MAX}개까지 만들 수 있습니다.`);
      const next = Object.assign({}, stored, { deepen: list.concat(v.text) });
      const { rows } = await c.query(`UPDATE cmap_concepts SET explanation = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING ${CONCEPT_COLS}`, [JSON.stringify(next), id, req.user.id]);
      return { body: { concept: rows[0] } };
    });
  } finally { deepenBusy.delete(key); }
}));

router.delete('/api/cmap/concepts/:id', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('개념을 찾을 수 없습니다.');
  return withTx(async c => {
    const { rows: own } = await c.query('SELECT id FROM cmap_concepts WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, req.user.id]);
    if (!own.length) throw notFound('개념을 찾을 수 없습니다.');
    // 작업273-2: 지도에서 쓰이는 개념이면 그 노드와 연결된 간선을 함께 지우고, 그 지도의 저장 표시(semantic_hash)를 NULL 로 되돌린다
    const { rows: maps } = await c.query('SELECT id FROM cmap_maps WHERE user_id = $1', [req.user.id]);
    let removedNodes = 0, removedEdges = 0;
    for (const m of maps) {
      const { rows: nodes } = await c.query('SELECT concept_id FROM cmap_map_nodes WHERE map_id = $1', [m.id]);
      if (!nodes.some(n => n.concept_id === id)) continue;
      const { rows: edges } = await c.query('SELECT id, from_concept_id, to_concept_id FROM cmap_edges WHERE map_id = $1', [m.id]);
      for (const e of edges) if (e.from_concept_id === id || e.to_concept_id === id) { await c.query('DELETE FROM cmap_edges WHERE id = $1', [e.id]); removedEdges++; }
      await c.query('DELETE FROM cmap_map_nodes WHERE map_id = $1 AND concept_id = $2', [m.id, id]);
      await c.query('UPDATE cmap_maps SET semantic_hash = NULL, updated_at = now() WHERE id = $1 AND user_id = $2', [m.id, req.user.id]);
      removedNodes++;
    }
    await c.query('DELETE FROM cmap_concepts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    return { body: { deleted: id, removed_from_maps: removedNodes, removed_edges: removedEdges } };
  });
}));

// ─── 작업273-2: 지도(노드 선택·배치·간선) ───────────────────────────────────────────────
// 규칙은 서버가 강제한다: 노드는 그 지도의 최상위 주제 트리에 속한 개념만, 간선의 양 끝은 그 지도의 노드여야 하며 같은 쌍은 방향과 상관없이 한 번만,
// 문구 필수(≤40자)·종류 선택(5종)·'구별'은 방향 없음(id 작은 쪽이 from), 좌표는 유한한 숫자 범위. 모든 간선·노드는 사용자가 직접 만든다(AI 제안 없음).
const MAP_COLS = 'id, root_topic_id, title, semantic_hash, saved_at, created_at, updated_at';
const EDGE_COLS = 'id, map_id, from_concept_id, to_concept_id, relation_type, label, created_at';

// 지도에 쓰이는 노드 중 topicIds 에 속한 개념의 수(사용자의 모든 지도 합계)
async function usedInMaps(db, userId, topicIds) {
  const set = new Set(topicIds);
  const { rows: cs } = await db.query('SELECT id, topic_id FROM cmap_concepts WHERE user_id = $1', [userId]);
  const ids = new Set(cs.filter(x => set.has(x.topic_id)).map(x => x.id));
  if (!ids.size) return 0;
  const { rows: maps } = await db.query('SELECT id FROM cmap_maps WHERE user_id = $1', [userId]);
  let n = 0;
  for (const m of maps) {
    const { rows } = await db.query('SELECT concept_id FROM cmap_map_nodes WHERE map_id = $1', [m.id]);
    n += rows.filter(r => ids.has(r.concept_id)).length;
  }
  return n;
}

// 작업273-3: 지도의 현재 의미(노드·간선)와 의미 해시. 해시 계산은 lib/cmap_hash.js 한 곳에서만 한다
async function graphOf(db, mapId) {
  const { rows: nodes } = await db.query('SELECT map_id, concept_id, x, y FROM cmap_map_nodes WHERE map_id = $1 ORDER BY concept_id', [mapId]);
  const { rows: edges } = await db.query(`SELECT ${EDGE_COLS} FROM cmap_edges WHERE map_id = $1 ORDER BY id`, [mapId]);
  return { nodes, edges, nodeIds: nodes.map(n => n.concept_id), hash: H.computeSemanticHash(nodes.map(n => n.concept_id), edges) };
}
// 저장 상태: 'unsaved'(저장 안 됨) | 'saved' | 'changed'(저장 후 변경됨)
async function statusOf(db, mapId, userId) {
  const { rows } = await db.query(`SELECT ${MAP_COLS} FROM cmap_maps WHERE id = $1 AND user_id = $2`, [mapId, userId]);
  const g = await graphOf(db, mapId);
  return { current_hash: g.hash, save_status: H.saveStatus(rows[0], g.hash) };
}

async function ownMap(db, mapId, userId, { lock = false } = {}) {
  const { rows } = await db.query(`SELECT ${MAP_COLS} FROM cmap_maps WHERE id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`, [mapId, userId]);
  if (!rows.length) throw notFound('지도를 찾을 수 없습니다.');
  return rows[0];
}

// 지도의 뿌리 주제 트리에 속한 개념(id, topic_id, term, english)과 트리의 주제들
async function treeOfMap(db, userId, rootTopicId) {
  const idx = T.buildIndex(await loadTopics(db, userId));
  const root = idx.byId.get(rootTopicId);
  const topics = root ? [root, ...T.descendants(idx, rootTopicId)] : [];
  const set = new Set(topics.map(t => t.id));
  const { rows } = await db.query('SELECT id, topic_id, term, english, explanation FROM cmap_concepts WHERE user_id = $1 ORDER BY sort_order, id', [userId]);
  return { topics, concepts: rows.filter(x => set.has(x.topic_id)) };
}

// 지도 조회(없으면 만든다): :rootId 는 최상위 주제. 노드·간선·트리 안의 개념과 주제를 함께 돌려준다
router.get('/api/cmap/topics/:rootId/map', guard, handle(async req => {
  const rootId = parseId(req.params.rootId);
  if (rootId === null) throw notFound('주제를 찾을 수 없습니다.');
  return withTx(async c => {
    const idx = T.buildIndex(await loadTopics(c, req.user.id, { lock: true }));
    const root = idx.byId.get(rootId);
    if (!root) throw notFound('주제를 찾을 수 없습니다.');
    if (root.parent_id !== null && root.parent_id !== undefined) throw bad('지도는 최상위 주제 단위로 만듭니다.');
    let { rows: maps } = await c.query(`SELECT ${MAP_COLS} FROM cmap_maps WHERE root_topic_id = $1 AND user_id = $2 ORDER BY id`, [rootId, req.user.id]);
    if (!maps.length) {
      maps = (await c.query(`INSERT INTO cmap_maps (user_id, root_topic_id, title) VALUES ($1, $2, $3) RETURNING ${MAP_COLS}`, [req.user.id, rootId, root.title])).rows;
    }
    const map = maps[0];
    const { rows: nodes } = await c.query('SELECT map_id, concept_id, x, y FROM cmap_map_nodes WHERE map_id = $1 ORDER BY concept_id', [map.id]);
    const { rows: edges } = await c.query(`SELECT ${EDGE_COLS} FROM cmap_edges WHERE map_id = $1 ORDER BY id`, [map.id]);
    const tree = await treeOfMap(c, req.user.id, rootId);
    const currentHash = H.computeSemanticHash(nodes.map(n => n.concept_id), edges);
    // 작업275-4: 팝업용 한 줄 설명(brief = 저장된 설명의 정의, 없으면 읽을 수 있는 첫 항목)과 이 사용자의 "모르는 개념" 표시. 설명 전체는 보내지 않는다
    const { rows: markRows } = await c.query('SELECT concept_id FROM cmap_concept_marks WHERE user_id = $1', [req.user.id]);
    const inTree = new Set(tree.concepts.map(x => x.id));
    return { body: {
      current_hash: currentHash, save_status: H.saveStatus(map, currentHash),
      map, nodes: nodes.map(n => ({ concept_id: n.concept_id, x: n.x, y: n.y })), edges,
      marked_concept_ids: markRows.map(r => r.concept_id).filter(id => inTree.has(id)).sort((a, b) => a - b),
      concepts: tree.concepts.map(x => ({ id: x.id, topic_id: x.topic_id, term: x.term, english: x.english, brief: briefOf(x.explanation) })), topics: tree.topics.map(t => ({ id: t.id, parent_id: t.parent_id, title: t.title, sort_order: t.sort_order })),
      relation_types: M.RELATION_TYPES,
    } };
  });
}));

// 노드 추가(지도에 쓸 개념 선택). 이미 있으면 그대로 돌려줌
router.post('/api/cmap/maps/:id/nodes', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const cid = typeof bodyOf(req).concept_id === 'number' ? parseId(String(bodyOf(req).concept_id)) : null;
  if (cid === null) throw bad('concept_id가 올바르지 않습니다.');
  return withTx(async c => {
    const map = await ownMap(c, id, req.user.id, { lock: true });
    const tree = await treeOfMap(c, req.user.id, map.root_topic_id);
    if (!tree.concepts.some(x => x.id === cid)) throw bad('이 지도의 주제 안에 있는 개념만 지도에 쓸 수 있습니다.');
    const { rows: ex } = await c.query('SELECT map_id, concept_id, x, y FROM cmap_map_nodes WHERE map_id = $1', [id]);
    const have = ex.find(n => n.concept_id === cid);
    if (have) return { body: { node: { concept_id: have.concept_id, x: have.x, y: have.y }, existing: true, status: await statusOf(c, id, req.user.id) } };
    const { rows } = await c.query('INSERT INTO cmap_map_nodes (map_id, concept_id) VALUES ($1, $2) RETURNING map_id, concept_id, x, y', [id, cid]);
    return { status: 201, body: { node: { concept_id: rows[0].concept_id, x: rows[0].x, y: rows[0].y }, existing: false, status: await statusOf(c, id, req.user.id) } };
  });
}));

// 노드 빼기. 연결된 간선이 있으면 confirm=1 이 있어야 하고(없으면 409 + 간선 수) 간선도 함께 지운다
router.delete('/api/cmap/maps/:id/nodes/:conceptId', guard, handle(async req => {
  const id = parseId(req.params.id), cid = parseId(req.params.conceptId);
  if (id === null || cid === null) throw notFound('노드를 찾을 수 없습니다.');
  const confirm = req.query.confirm === '1';
  return withTx(async c => {
    await ownMap(c, id, req.user.id, { lock: true });
    const { rows: nodes } = await c.query('SELECT map_id, concept_id FROM cmap_map_nodes WHERE map_id = $1', [id]);
    if (!nodes.some(n => n.concept_id === cid)) throw notFound('지도에 없는 개념입니다.');
    const { rows: edges } = await c.query('SELECT id, from_concept_id, to_concept_id FROM cmap_edges WHERE map_id = $1', [id]);
    const touching = edges.filter(e => e.from_concept_id === cid || e.to_concept_id === cid);
    if (touching.length && !confirm) {
      throw conflict(`이 개념을 지도에서 빼면 연결 ${touching.length}개도 함께 지워집니다. 확인이 필요합니다.`, { needs_confirm: true, counts: { edges: touching.length } });
    }
    for (const e of touching) await c.query('DELETE FROM cmap_edges WHERE id = $1', [e.id]);
    await c.query('DELETE FROM cmap_map_nodes WHERE map_id = $1 AND concept_id = $2', [id, cid]);
    return { body: { removed: cid, removed_edges: touching.length, status: await statusOf(c, id, req.user.id) } };
  });
}));

// 노드 위치 저장(드래그가 끝났을 때)
router.patch('/api/cmap/maps/:id/nodes/:conceptId', guard, handle(async req => {
  const id = parseId(req.params.id), cid = parseId(req.params.conceptId);
  if (id === null || cid === null) throw notFound('노드를 찾을 수 없습니다.');
  const pos = M.readPosition(bodyOf(req).x, bodyOf(req).y);
  if (pos.error) throw bad(pos.error);
  return withTx(async c => {
    await ownMap(c, id, req.user.id, { lock: true });
    const { rows } = await c.query('UPDATE cmap_map_nodes SET x = $1, y = $2 WHERE map_id = $3 AND concept_id = $4 RETURNING map_id, concept_id, x, y', [pos.value.x, pos.value.y, id, cid]);
    if (!rows.length) throw notFound('지도에 없는 개념입니다.');
    return { body: { node: { concept_id: rows[0].concept_id, x: rows[0].x, y: rows[0].y } } };
  });
}));

// 간선 만들기(사용자가 두 노드를 이어 줌)
router.post('/api/cmap/maps/:id/edges', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const body = bodyOf(req);
  const a = typeof body.from_concept_id === 'number' ? parseId(String(body.from_concept_id)) : null;
  const b = typeof body.to_concept_id === 'number' ? parseId(String(body.to_concept_id)) : null;
  if (a === null || b === null) throw bad('연결할 두 개념의 id가 올바르지 않습니다.');
  if (a === b) throw bad('같은 개념끼리는 연결할 수 없습니다.');
  const label = M.readLabel(body.label);
  if (label.error) throw bad(label.error);
  const type = M.readRelationType(body.relation_type);
  if (type.error) throw bad(type.error);
  return withTx(async c => {
    await ownMap(c, id, req.user.id, { lock: true });
    const { rows: nodes } = await c.query('SELECT map_id, concept_id FROM cmap_map_nodes WHERE map_id = $1', [id]);
    if (!nodes.some(n => n.concept_id === a) || !nodes.some(n => n.concept_id === b)) throw bad('연결하는 두 개념이 모두 지도에 있어야 합니다.');
    const { rows: edges } = await c.query('SELECT id, from_concept_id, to_concept_id FROM cmap_edges WHERE map_id = $1', [id]);
    if (M.pairExists(edges, a, b, null)) throw conflict('이미 연결돼 있는 두 개념입니다. 기존 연결을 고쳐 주세요.');
    const dir = M.normalizeDirection(a, b, type.value === undefined ? null : type.value);
    const { rows } = await c.query(`INSERT INTO cmap_edges (map_id, from_concept_id, to_concept_id, relation_type, label) VALUES ($1, $2, $3, $4, $5) RETURNING ${EDGE_COLS}`,
      [id, dir.from, dir.to, type.value === undefined ? null : type.value, label.value]);
    return { status: 201, body: { edge: rows[0], status: await statusOf(c, id, req.user.id) } };
  });
}));

// 간선 수정: 문구·종류·방향 바꾸기(reverse: true). '구별'(대칭)은 방향이 없다
router.patch('/api/cmap/edges/:id', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('연결을 찾을 수 없습니다.');
  const body = bodyOf(req);
  let label;
  if (has(body, 'label')) { const l = M.readLabel(body.label); if (l.error) throw bad(l.error); label = l.value; }
  const type = has(body, 'relation_type') ? M.readRelationType(body.relation_type) : { value: undefined };
  if (type.error) throw bad(type.error);
  const reverse = body.reverse === true;
  if (has(body, 'reverse') && typeof body.reverse !== 'boolean') throw bad('reverse는 true/false여야 합니다.');
  if (label === undefined && type.value === undefined && !reverse) throw bad('변경할 항목이 없습니다.');
  return withTx(async c => {
    const { rows: found } = await c.query(`SELECT ${EDGE_COLS} FROM cmap_edges WHERE id = $1`, [id]);
    if (!found.length) throw notFound('연결을 찾을 수 없습니다.');
    const cur = found[0];
    await ownMap(c, cur.map_id, req.user.id, { lock: true });
    const nextType = type.value === undefined ? cur.relation_type : type.value;
    let from = cur.from_concept_id, to = cur.to_concept_id;
    if (reverse) {
      if (nextType === M.SYMMETRIC_TYPE) throw bad(`'${M.SYMMETRIC_TYPE}'은 방향이 없어 바꿀 수 없습니다.`);
      [from, to] = [to, from];
    }
    const dir = M.normalizeDirection(from, to, nextType);
    const { rows } = await c.query(`UPDATE cmap_edges SET from_concept_id = $1, to_concept_id = $2, relation_type = $3, label = $4 WHERE id = $5 RETURNING ${EDGE_COLS}`,
      [dir.from, dir.to, nextType === undefined ? null : nextType, label === undefined ? cur.label : label, id]);
    return { body: { edge: rows[0], status: await statusOf(c, cur.map_id, req.user.id) } };
  });
}));

router.delete('/api/cmap/edges/:id', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('연결을 찾을 수 없습니다.');
  return withTx(async c => {
    const { rows: found } = await c.query('SELECT id, map_id FROM cmap_edges WHERE id = $1', [id]);
    if (!found.length) throw notFound('연결을 찾을 수 없습니다.');
    await ownMap(c, found[0].map_id, req.user.id, { lock: true });
    await c.query('DELETE FROM cmap_edges WHERE id = $1', [id]);
    return { body: { deleted: id, status: await statusOf(c, found[0].map_id, req.user.id) } };
  });
}));

// ─── 작업273-3: 지도 저장 + 위치 일괄 저장(배치 최적화) ────────────────────────────────────────
// [저장]: 서버가 DB 상태로 의미 해시를 계산해 semantic_hash 와 saved_at 을 기록한다(클라이언트가 보낸 값은 쓰지 않는다).
// 현재 해시가 저장된 해시와 다르면 화면이 "저장 후 변경됨"을 보여 준다.
router.post('/api/cmap/maps/:id/save', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  return withTx(async c => {
    await ownMap(c, id, req.user.id, { lock: true });
    const g = await graphOf(c, id);
    const { rows } = await c.query(`UPDATE cmap_maps SET semantic_hash = $1, saved_at = now(), updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING ${MAP_COLS}`, [g.hash, id, req.user.id]);
    return { body: { map: rows[0], status: { current_hash: g.hash, save_status: H.saveStatus(rows[0], g.hash) } } };
  });
}));

// 위치 일괄 저장: 노드 집합이 DB 와 정확히 같을 때만 허용하고(없는 개념·빠진 노드·중복 거부), base_hash 가 있으면 현재 의미 해시와 같아야 하며(그 사이 지도가 바뀌었으면 거부),
// 적용 전후의 의미 해시를 서버가 다시 계산해 달라지면 전체를 취소한다(개념 수·간선 수·종류·방향·문구 불변 검증). 전부 한 트랜잭션.
router.put('/api/cmap/maps/:id/positions', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const body = bodyOf(req);
  if (!Array.isArray(body.positions) || body.positions.length > 500) throw bad('positions 는 500개 이하의 배열이어야 합니다.');
  if (has(body, 'base_hash') && typeof body.base_hash !== 'string') throw bad('base_hash 형식이 올바르지 않습니다.');
  const items = [], seen = new Set();
  for (const p of body.positions) {
    if (!p || typeof p !== 'object' || typeof p.concept_id !== 'number' || parseId(String(p.concept_id)) === null) throw bad('positions 항목의 concept_id 가 올바르지 않습니다.');
    if (seen.has(p.concept_id)) throw bad('같은 개념의 위치가 두 번 들어 있습니다.');
    seen.add(p.concept_id);
    const pos = M.readPosition(p.x, p.y);
    if (pos.error) throw bad(pos.error);
    items.push({ concept_id: p.concept_id, x: pos.value.x, y: pos.value.y });
  }
  return withTx(async c => {
    await ownMap(c, id, req.user.id, { lock: true });
    const before = await graphOf(c, id);
    if (body.base_hash !== undefined && body.base_hash !== before.hash) throw conflict('지도가 그 사이에 바뀌었습니다. 다시 불러온 뒤에 배치를 최적화해 주세요.', { stale: true });
    const have = new Set(before.nodeIds);
    if (items.length !== have.size || items.some(p => !have.has(p.concept_id))) throw bad('지도의 노드와 보낸 위치의 개념이 달라 저장할 수 없습니다.');
    for (const p of items) await c.query('UPDATE cmap_map_nodes SET x = $1, y = $2 WHERE map_id = $3 AND concept_id = $4', [p.x, p.y, id, p.concept_id]);
    const after = await graphOf(c, id);
    if (after.hash !== before.hash) throw conflict('위치를 바꾸는 중 지도의 의미(노드·연결)가 달라져 취소했습니다.', { semantic_changed: true });
    const status = await statusOf(c, id, req.user.id);
    return { body: { positions: after.nodes.map(n => ({ concept_id: n.concept_id, x: n.x, y: n.y })), status } };
  });
}));

// ─── 작업273-4: AI 해설 ─────────────────────────────────────────────────────────────────────
// 클라이언트는 지도 id 만 보낸다. 서버가 DB 에서 지도(개념·설명·연결)와 같은 주제 트리의 저장된 개념 목록을 읽어 입력을 만든다.
// 저장된 지도(saved_at 있음, 현재 해시 = semantic_hash)에서만 만들 수 있다. 지도당 최신 해설 1개를 cmap_narrations 에 둔다.
async function narrationContext(db, userId, map) {
  const g = await graphOf(db, map.id);
  const idx = T.buildIndex(await loadTopics(db, userId));
  const root = idx.byId.get(map.root_topic_id);
  const topicSet = new Set(root ? [root.id, ...T.descendants(idx, root.id).map(t => t.id)] : []);
  const { rows: all } = await db.query('SELECT id, topic_id, term, english, explanation FROM cmap_concepts WHERE user_id = $1 ORDER BY sort_order, id', [userId]);
  const inTree = all.filter(c => topicSet.has(c.topic_id));
  const nodeSet = new Set(g.nodeIds);
  const concepts = inTree.filter(c => nodeSet.has(c.id));
  const saved = inTree.filter(c => !nodeSet.has(c.id)).map(c => ({ id: c.id, topic_id: c.topic_id, term: c.term }));
  return { hash: g.hash, concepts, saved, edges: g.edges, rootTitle: root ? root.title : map.title, otherTerms: saved.map(c => c.term) };
}
const NARRATION_COLS = 'id, map_id, source_hash, content, model, created_at';
const jsonOf = v => (typeof v === 'string' ? JSON.parse(v) : v);
const narrating = new Set();   // 같은 지도의 해설을 동시에 두 번 만들지 않도록(사용자·지도 단위)
const conceptList = ctx => ctx.concepts.map(c => ({ id: c.id, term: c.term, english: c.english || null }));

router.get('/api/cmap/maps/:id/narration', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const map = await ownMap(pool, id, req.user.id);
  const ctx = await narrationContext(pool, req.user.id, map);
  const { rows } = await pool.query(`SELECT ${NARRATION_COLS} FROM cmap_narrations WHERE map_id = $1 AND user_id = $2`, [id, req.user.id]);
  const row = rows[0] || null;
  const used = await AI.countToday(req.user.id, N.NARRATE_EVENT);
  return { body: {
    narration: row ? { id: row.id, content: N.annotateSuggestions(jsonOf(row.content), ctx.concepts, ctx.saved), model: row.model, created_at: row.created_at, source_hash: row.source_hash } : null,
    stale: row ? row.source_hash !== ctx.hash : false,
    current_hash: ctx.hash, save_status: H.saveStatus(map, ctx.hash),
    concepts: conceptList(ctx),
    daily: { used, cap: N.narrateDailyCap() },
  } };
}));

router.post('/api/cmap/maps/:id/narrate', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const map = await ownMap(pool, id, req.user.id);
  const ctx = await narrationContext(pool, req.user.id, map);
  if (H.saveStatus(map, ctx.hash) !== 'saved') throw conflict('저장된 지도에서만 해설을 만들 수 있습니다. 지도를 먼저 [저장]해 주세요.', { needs_save: true });
  if (!ctx.concepts.length) throw bad('지도에 개념이 없습니다.');
  const cap = N.narrateDailyCap();
  if (await AI.countToday(req.user.id, N.NARRATE_EVENT) >= cap) throw new HttpError(429, `하루 ${cap}건까지 AI 해설을 만들 수 있습니다.`);
  const key = req.user.id + ':' + id;
  if (narrating.has(key)) throw conflict('이 지도의 해설을 이미 만드는 중입니다.', { in_progress: true });
  narrating.add(key);
  let out;
  try { out = await N.generateNarration(req.user.id, ctx); } finally { narrating.delete(key); }
  if (out.error) throw new HttpError(502, out.error, { ai_error: true });
  return withTx(async c => {
    const cur = await ownMap(c, id, req.user.id, { lock: true });
    const now = await graphOf(c, id);
    if (now.hash !== ctx.hash || H.saveStatus(cur, now.hash) !== 'saved') throw conflict('해설을 만드는 동안 지도가 바뀌어 저장하지 않았습니다. 지도를 확인한 뒤 다시 만들어 주세요.', { changed: true });
    await c.query('DELETE FROM cmap_narrations WHERE map_id = $1', [id]);
    const { rows } = await c.query(
      `INSERT INTO cmap_narrations (map_id, user_id, source_hash, content, model) VALUES ($1, $2, $3, $4, $5) RETURNING ${NARRATION_COLS}`,
      [id, req.user.id, ctx.hash, JSON.stringify(out.content), AI.CMAP_MODEL]);
    const row = rows[0];
    return { status: 201, body: {
      narration: { id: row.id, content: jsonOf(row.content), model: row.model, created_at: row.created_at, source_hash: row.source_hash },
      stale: false, current_hash: ctx.hash, save_status: 'saved', concepts: conceptList(ctx),
      daily: { used: await AI.countToday(req.user.id, N.NARRATE_EVENT), cap },
    } };
  });
}));

// ─── 작업273-5: 연결 퀴즈(AI 없음) ──────────────────────────────────────────────────────────
// 시작: 저장된 지도의 노드 목록(id·용어·영문)과 시작 시점의 의미 해시만 돌려준다(정답 간선은 보내지 않는다).
// 제출: 저장된 지도의 현재 해시가 시작 때의 해시와 다르면(그 사이 지도가 바뀜) 채점하지 않고 409. 채점은 서버가 저장된 지도의 간선으로 한다.
async function savedGraph(db, userId, mapId, { lock = false, expectHash = null } = {}) {
  const map = await ownMap(db, mapId, userId, { lock });
  const g = await graphOf(db, mapId);
  if (expectHash !== null && g.hash !== expectHash) throw conflict('퀴즈를 푸는 동안 지도가 바뀌어 채점하지 않았습니다. 퀴즈를 다시 시작해 주세요.', { stale: true });
  if (H.saveStatus(map, g.hash) !== 'saved') throw conflict('저장된 지도에서만 퀴즈를 풀 수 있습니다. 지도를 먼저 [저장]해 주세요.', { needs_save: true });
  const { rows } = await db.query('SELECT id, term, english FROM cmap_concepts WHERE user_id = $1 ORDER BY sort_order, id', [userId]);
  const have = new Set(g.nodeIds);
  return { map, g, concepts: rows.filter(c => have.has(c.id)) };
}

// 작업275-5: 출제 범위. mode 'all' = 지도 전체(기존), 'marked' = 이 사용자가 표시한 개념과 이어진 연결만. 표시는 항상 서버가 DB 에서 읽는다(클라이언트가 보낸 목록은 쓰지 않음).
const QUIZ_MODES = ['all', 'marked'];
function quizMode(body) {
  if (body.mode === undefined) return 'all';
  if (!QUIZ_MODES.includes(body.mode)) throw bad("mode 는 'all' 또는 'marked' 여야 합니다.");
  return body.mode;
}
async function markedScope(db, userId, g) {
  const { rows } = await db.query('SELECT concept_id FROM cmap_concept_marks WHERE user_id = $1', [userId]);
  return Q.scopeFor(g.edges, g.nodeIds, rows.map(r => r.concept_id));
}

// 표시한 개념 퀴즈를 시작하기 전에 보여 줄 정보(표시 개수·연결 없는 개념·출제 연결 수). 저장 여부와 상관없이 현재 지도 기준이다
router.get('/api/cmap/maps/:id/quiz/marked-info', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  await ownMap(pool, id, req.user.id);
  const g = await graphOf(pool, id);
  const sc = await markedScope(pool, req.user.id, g);
  const { rows } = await pool.query('SELECT id, term FROM cmap_concepts WHERE user_id = $1', [req.user.id]);
  const term = new Map(rows.map(c => [c.id, c.term]));
  const named = ids => ids.map(cid => ({ id: cid, term: term.get(cid) }));
  return { body: { marked: named(sc.marked), isolated: named(sc.isolated), scope_edges: sc.edges.length, ready: sc.edges.length >= 2 } };
}));

router.post('/api/cmap/maps/:id/quiz/start', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const mode = quizMode(bodyOf(req));
  const { g, concepts } = await savedGraph(pool, req.user.id, id);
  if (mode === 'all') {
    if (!g.edges.length) throw bad('연결이 있는 지도에서만 퀴즈를 풀 수 있습니다.');
    return { body: { source_hash: g.hash, nodes: concepts.map(c => ({ id: c.id, term: c.term, english: c.english || null })) } };
  }
  const sc = await markedScope(pool, req.user.id, g);
  const term = new Map(concepts.map(c => [c.id, c.term]));
  const named = ids => ids.map(cid => ({ id: cid, term: term.get(cid) }));
  if (!sc.marked.length) throw bad('표시한 개념이 없습니다. 지도에서 모르는 개념을 눌러 표시해 보세요.', { no_marks: true });
  if (sc.edges.length < 2) throw bad('표시한 개념에 이어진 연결이 부족해 퀴즈를 만들 수 없습니다(연결 2개 이상 필요).', { too_few: true, scope_edges: sc.edges.length, isolated: named(sc.isolated) });
  const show = new Set(sc.nodeIds);
  return { body: {
    mode: 'marked', source_hash: g.hash, scope_key: sc.key, isolated: named(sc.isolated),
    nodes: concepts.filter(c => show.has(c.id)).map(c => ({ id: c.id, term: c.term, english: c.english || null, marked: sc.markedSet.has(c.id) })),
  } };
}));

router.post('/api/cmap/maps/:id/quiz/submit', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const body = bodyOf(req);
  const mode = quizMode(body);
  if (typeof body.source_hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.source_hash)) throw bad('source_hash 가 올바르지 않습니다.');
  return withTx(async c => {
    const { g, concepts } = await savedGraph(c, req.user.id, id, { lock: true, expectHash: body.source_hash });
    let nodeIds = g.nodeIds, edges = g.edges, sc = null;
    if (mode === 'marked') {
      sc = await markedScope(c, req.user.id, g);
      if (typeof body.scope_key !== 'string' || body.scope_key !== sc.key) throw conflict('퀴즈를 푸는 동안 표시한 개념이 바뀌어 채점하지 않았습니다. 퀴즈를 다시 시작해 주세요.', { stale: true, scope_changed: true });
      nodeIds = sc.nodeIds; edges = sc.edges;
    }
    const ans = Q.readAnswers(body.answers, nodeIds);
    if (ans.error) throw bad(ans.error);
    const r = Q.grade(edges, ans.value);
    const term = new Map(concepts.map(x => [x.id, x.term]));
    const named = e => ({ ...e, from_term: term.get(e.from_concept_id), to_term: term.get(e.to_concept_id) });
    const { rows } = await c.query(
      'INSERT INTO cmap_quiz_attempts (user_id, map_id, source_hash, pair_score, type_score, direction_score) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at',
      [req.user.id, id, g.hash, r.scores.pair.ratio, r.scores.type.ratio, r.scores.direction.ratio]);
    const out = {
      attempt_id: rows[0].id, source_hash: g.hash, scores: r.scores,
      correct: r.correct.map(named), missed: r.missed.map(named), extras: r.extras.map(named),
      wrong: r.wrong.map(w => ({ expected: named(w.expected), answer: named(w.answer), problems: w.problems })),
    };
    if (mode === 'marked') { out.mode = 'marked'; out.mastered = Q.masteredOf(sc.edges, r.correct, sc.marked.filter(m => !sc.isolated.includes(m))).map(cid => ({ id: cid, term: term.get(cid) })); }
    return { status: 201, body: out };
  });
}));

// ─── 작업278-1: 말로 설명하기(주관식) — 음성(또는 직접 입력) 답변을 저장된 설명과 비교해 AI(Haiku)가 평가 ─────────────────
// 개념 이름만 제시하고 사용자가 설명한다. 오디오·전사(입력) 원문은 저장하지도 응답에 담지도 로그에 남기지도 않는다. AI 가 정리한 요약·판정·피드백만 응답하고 cmap_answer_attempts 에 저장한다.
// 한도: 전사 CMAP_STT_DAILY_CAP(기본 20, 이벤트 cmap_stt), 평가 CMAP_ANSWER_DAILY_CAP(기본 30, 이벤트 cmap_answer). 한도 확인은 외부 호출 전에 한다.
async function answerTarget(db, userId, conceptId) {
  const { rows } = await db.query('SELECT id, term, explanation FROM cmap_concepts WHERE id = $1 AND user_id = $2', [conceptId, userId]);
  if (!rows.length) throw notFound('개념을 찾을 수 없습니다.');
  const entries = AI.explanationEntries(rows[0].explanation);
  if (!entries.length) throw bad('이 개념에는 저장된 설명이 없어 평가할 수 없습니다. 먼저 설명을 저장해 주세요.', { no_explanation: true });
  return { id: rows[0].id, term: rows[0].term, entries };
}
async function checkAnswerCap(userId, event, cap, text) {
  if (await AI.countToday(userId, event) >= cap) throw new HttpError(429, `하루 ${cap}회까지 ${text}`);
}
// 평가 + 저장. answer 는 모델로만 가고 이 함수의 반환값·DB 에는 들어가지 않는다
async function evaluateAndSave(userId, target, answer, mode) {
  const ev = await ANS.evaluateAnswer(userId, ANS.buildAnswerInput({ term: target.term, entries: target.entries, answer }));
  if (ev.aiError) throw new HttpError(ev.status || 502, ev.aiError, { ai_error: true });
  const v = ev.value;
  const { rows } = await pool.query(
    'INSERT INTO cmap_answer_attempts (user_id, concept_id, verdict, summary, strengths, gaps, supplement, input_mode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at',
    [userId, target.id, v.verdict, v.summary, JSON.stringify(v.strengths), JSON.stringify(v.gaps), v.supplement, mode]);
  return { status: 201, body: { id: rows[0].id, concept_id: target.id, term: target.term, verdict: v.verdict, summary: v.summary, strengths: v.strengths, gaps: v.gaps, supplement: v.supplement, input_mode: mode, created_at: rows[0].created_at } };
}

router.post('/api/cmap/concepts/:id/answer/voice', guard, STT.requireAudioType, STT.audioBody, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('개념을 찾을 수 없습니다.');
  const audio = req.body;
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw bad('녹음 데이터가 비어 있습니다.');
  const target = await answerTarget(pool, req.user.id, id);
  await checkAnswerCap(req.user.id, STT.STT_EVENT, STT.sttDailyCap(), '음성으로 설명할 수 있습니다.');
  await checkAnswerCap(req.user.id, ANS.ANSWER_EVENT, ANS.answerDailyCap(), 'AI 평가를 받을 수 있습니다.');
  const tr = await STT.transcribe(req.user.id, audio, STT.audioBaseType(req), req.headers['x-audio-seconds']);
  if (tr.error) throw new HttpError(tr.status, tr.error);
  if (!tr.text) throw new HttpError(422, '음성이 인식되지 않았어요. 조용한 곳에서 다시 말해 주세요.', { no_speech: true });   // 평가 호출 없음(전사 사용량은 기록됨)
  return evaluateAndSave(req.user.id, target, tr.text, 'voice');
}));

router.post('/api/cmap/concepts/:id/answer/text', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('개념을 찾을 수 없습니다.');
  const text = bodyOf(req).text;
  if (typeof text !== 'string' || !text.trim()) throw bad('설명을 입력해 주세요.');
  if (T.charLen(text.trim()) > ANS.ANSWER_MAX_CHARS) throw bad(`설명은 ${ANS.ANSWER_MAX_CHARS}자 이하여야 합니다.`);
  const target = await answerTarget(pool, req.user.id, id);
  await checkAnswerCap(req.user.id, ANS.ANSWER_EVENT, ANS.answerDailyCap(), 'AI 평가를 받을 수 있습니다.');
  return evaluateAndSave(req.user.id, target, text.trim(), 'text');
}));

// 최근 부족 목록: 개념별 최신 시도가 '부분적'·'부족'인 것만, 최근 순 최대 20개(이후 시도가 '충분'이면 빠진다). 다시 출제하는 기능은 없다
const RECENT_MAX = 20;
router.get('/api/cmap/answers/recent', guard, handle(async req => {
  const { rows } = await pool.query('SELECT id, concept_id, verdict, gaps, supplement, created_at FROM cmap_answer_attempts WHERE user_id = $1 ORDER BY id', [req.user.id]);
  const latest = new Map();
  for (const r of rows) latest.set(r.concept_id, r);                       // id 오름차순이므로 마지막이 최신 시도
  const { rows: cs } = await pool.query('SELECT id, term FROM cmap_concepts WHERE user_id = $1', [req.user.id]);
  const term = new Map(cs.map(c => [c.id, c.term]));
  const items = [...latest.values()].filter(r => r.verdict !== '충분' && term.has(r.concept_id))
    .sort((a, b) => b.id - a.id).slice(0, RECENT_MAX)
    .map(r => ({ concept_id: r.concept_id, term: term.get(r.concept_id), verdict: r.verdict, gaps: typeof r.gaps === 'string' ? JSON.parse(r.gaps) : (r.gaps || []), supplement: r.supplement, created_at: r.created_at }));
  return { body: { items } };
}));

// 말로 설명하기 대상: 이 지도의 주제 트리 안 개념 중 사용자가 표시한 개념 가운데 저장된 설명이 있는 것(서버가 DB 의 표시로 계산)
router.get('/api/cmap/maps/:id/answer-targets', guard, handle(async req => {
  const id = parseId(req.params.id);
  if (id === null) throw notFound('지도를 찾을 수 없습니다.');
  const map = await ownMap(pool, id, req.user.id);
  const tree = await treeOfMap(pool, req.user.id, map.root_topic_id);
  const { rows } = await pool.query('SELECT concept_id FROM cmap_concept_marks WHERE user_id = $1', [req.user.id]);
  const marked = new Set(rows.map(r => r.concept_id));
  const markedInTree = tree.concepts.filter(c => marked.has(c.id));
  const targets = markedInTree.filter(c => AI.explanationEntries(c.explanation).length > 0).map(c => ({ id: c.id, term: c.term }));
  return { body: { targets, marked_count: markedInTree.length, without_explanation: markedInTree.length - targets.length } };
}));

module.exports = router;
