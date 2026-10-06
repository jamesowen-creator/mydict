const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

const router = express.Router();

// 작업194: 개념학습 서버. 분야(study) 하나에 개념(item)과 개념 사이 연결(link)을 담는다.
const MAX_STUDIES_PER_USER = 20;
const MAX_ITEMS_PER_STUDY = 60;
const MAX_PG_INT = 2147483647;

const LIMITS = { topic: 80, term: 80, group_label: 30, note: 2000, origin: 30, label: 40, detail: 300 };
// 사용자가 직접 고치는 본문 필드의 상한(AI가 채우는 값은 194-2에서 더 짧게 제한)
const TEXT_LIMITS = { definition: 2000, example: 1000, simple_text: 1000, deeper_text: 1000 };
const TEXT_FIELDS = Object.keys(TEXT_LIMITS);
const STATUSES = ['active', 'held', 'excluded'];
const REVIEW_STATES = ['new', 'understood', 'confused'];
const RELATION_TYPES = ['포함', '원인→결과', '순서', '대비', '비슷함', '기타 관련'];

const STUDY_COLUMNS = 'id, topic, selected_item_id, created_at, updated_at';
const ITEM_COLUMNS = 'id, study_id, term, english, group_label, definition, example, simple_text, deeper_text, content_source, status, review_state, origin, note, suggestions, feedback, legacy_voice_concept_id, created_at, updated_at';
const LINK_COLUMNS = 'id, study_id, from_item_id, to_item_id, relation_type, label, detail, source, created_at';

async function requireConceptPerm(req, res, next) {
  const allowed = await checkPermission(req.user.id, 'perm_concept_study');
  if (!allowed) return res.status(403).json({ error: '개념학습 권한이 없습니다.' });
  next();
}

function requireDB(req, res, next) {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: '데이터베이스를 사용할 수 없습니다.' });
  next();
}

const guard = [requireAuth, requireConceptPerm, requireDB];

const SERVER_ERROR = { error: '서버 오류가 발생했습니다.' };
const STUDY_NOT_FOUND = { error: '학습을 찾을 수 없습니다.' };
const ITEM_NOT_FOUND = { error: '개념을 찾을 수 없습니다.' };
const LINK_NOT_FOUND = { error: '연결을 찾을 수 없습니다.' };

// 글자 수는 코드포인트 기준
function charLen(s) { return Array.from(s).length; }

function parseId(raw) {
  if (!/^\d{1,10}$/.test(String(raw))) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PG_INT ? n : null;
}

// 공백 제거·소문자(학습 안 중복 판정용)
function termKey(term) { return String(term).replace(/\s+/g, '').toLowerCase(); }

// 필수 문자열: 앞뒤 공백 제거, 1자 이상 max자 이하. 오류면 { error }
function readRequiredText(v, max, label) {
  if (typeof v !== 'string') return { error: `${label}이(가) 올바르지 않습니다.` };
  const t = v.trim();
  if (!t) return { error: `${label}을(를) 입력해 주세요.` };
  if (charLen(t) > max) return { error: `${label}은(는) ${max}자 이하여야 합니다.` };
  return { value: t };
}

// 선택 문자열: null/빈 문자열은 null
function readOptionalText(v, max, label, { trim = true } = {}) {
  if (v === null || v === undefined) return { value: null };
  if (typeof v !== 'string') return { error: `${label}이(가) 올바르지 않습니다.` };
  const t = trim ? v.trim() : v;
  if (!t.trim()) return { value: null };
  if (charLen(t) > max) return { error: `${label}은(는) ${max}자 이하여야 합니다.` };
  return { value: t };
}

// 제안 목록에서 이미 학습 안에 있는 개념(활성·보류·제외 모두)과 같은 용어를 뺀다(공백·대소문자 무시)
function filterSuggestions(suggestions, keySet) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter(s => s && typeof s.term === 'string' && !keySet.has(termKey(s.term)));
}

async function loadStudy(id, userId) {
  const { rows } = await pool.query(`SELECT ${STUDY_COLUMNS} FROM concept_studies WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] || null;
}

async function loadItem(id, userId) {
  const { rows } = await pool.query(`SELECT ${ITEM_COLUMNS}, user_id FROM concept_items WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] || null;
}

async function touchStudy(studyId) {
  await pool.query('UPDATE concept_studies SET updated_at = now() WHERE id = $1', [studyId]);
}

function isUniqueViolation(err) { return !!err && err.code === '23505'; }

// ─── 학습(분야) ──────────────────────────────────────────────────────────────

router.get('/api/concepts/studies', guard, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${STUDY_COLUMNS} FROM concept_studies WHERE user_id = $1 ORDER BY updated_at DESC, id DESC`, [req.user.id]);
    const counts = new Map();
    const items = await pool.query('SELECT study_id FROM concept_items WHERE user_id = $1', [req.user.id]);
    for (const it of items.rows) counts.set(it.study_id, (counts.get(it.study_id) || 0) + 1);
    res.json(rows.map(r => ({ ...r, item_count: counts.get(r.id) || 0 })));
  } catch (err) {
    console.error('concepts studies list error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.post('/api/concepts/studies', guard, async (req, res) => {
  const topic = readRequiredText(req.body && req.body.topic, LIMITS.topic, '분야 이름');
  if (topic.error) return res.status(400).json({ error: topic.error });
  try {
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM concept_studies WHERE user_id = $1', [req.user.id]);
    if (count.rows[0].n >= MAX_STUDIES_PER_USER) {
      return res.status(400).json({ error: `분야는 최대 ${MAX_STUDIES_PER_USER}개까지 만들 수 있습니다.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO concept_studies (user_id, topic) VALUES ($1, $2) RETURNING ${STUDY_COLUMNS}`, [req.user.id, topic.value]);
    res.status(201).json({ ...rows[0], item_count: 0 });
  } catch (err) {
    console.error('concepts study create error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.get('/api/concepts/studies/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(STUDY_NOT_FOUND);
  try {
    const study = await loadStudy(id, req.user.id);
    if (!study) return res.status(404).json(STUDY_NOT_FOUND);
    const items = (await pool.query(
      `SELECT ${ITEM_COLUMNS} FROM concept_items WHERE study_id = $1 AND user_id = $2 ORDER BY id`, [id, req.user.id])).rows;
    const links = (await pool.query(
      `SELECT ${LINK_COLUMNS} FROM concept_links WHERE study_id = $1 AND user_id = $2 ORDER BY id`, [id, req.user.id])).rows;
    const keys = new Set(items.map(i => termKey(i.term)));
    res.json({
      study,
      items: items.map(i => ({ ...i, suggestions: filterSuggestions(i.suggestions, keys) })),
      links,
    });
  } catch (err) {
    console.error('concepts study get error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.patch('/api/concepts/studies/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(STUDY_NOT_FOUND);
  const src = req.body && typeof req.body === 'object' ? req.body : {};
  const sets = [], params = [id, req.user.id];
  if (src.topic !== undefined) {
    const topic = readRequiredText(src.topic, LIMITS.topic, '분야 이름');
    if (topic.error) return res.status(400).json({ error: topic.error });
    params.push(topic.value); sets.push(`topic = $${params.length}`);
  }
  if (src.selected_item_id !== undefined && src.selected_item_id !== null && parseId(String(src.selected_item_id)) === null) {
    return res.status(400).json({ error: 'selected_item_id가 올바르지 않습니다.' });
  }
  if (!sets.length && src.selected_item_id === undefined) return res.status(400).json({ error: '변경할 항목이 없습니다.' });
  try {
    const study = await loadStudy(id, req.user.id);
    if (!study) return res.status(404).json(STUDY_NOT_FOUND);
    if (src.selected_item_id !== undefined) {
      if (src.selected_item_id !== null) {
        const item = await loadItem(Number(src.selected_item_id), req.user.id);
        if (!item || item.study_id !== id) return res.status(404).json(ITEM_NOT_FOUND);
      }
      params.push(src.selected_item_id === null ? null : Number(src.selected_item_id));
      sets.push(`selected_item_id = $${params.length}`);
    }
    const { rows } = await pool.query(
      `UPDATE concept_studies SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING ${STUDY_COLUMNS}`, params);
    if (!rows.length) return res.status(404).json(STUDY_NOT_FOUND);
    res.json(rows[0]);
  } catch (err) {
    console.error('concepts study patch error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.delete('/api/concepts/studies/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(STUDY_NOT_FOUND);
  try {
    const { rowCount } = await pool.query('DELETE FROM concept_studies WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rowCount) return res.status(404).json(STUDY_NOT_FOUND);
    res.json({ ok: true });
  } catch (err) {
    console.error('concepts study delete error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

// ─── 개념 ────────────────────────────────────────────────────────────────────

// 학습 안에 개념을 저장한다. 한도·중복 검사 포함. 성공이면 { item }, 실패면 { status, error }
async function insertItem(studyId, userId, { term, origin }) {
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM concept_items WHERE study_id = $1', [studyId]);
  if (count.rows[0].n >= MAX_ITEMS_PER_STUDY) {
    return { status: 400, error: `한 분야에는 개념을 최대 ${MAX_ITEMS_PER_STUDY}개까지 담을 수 있습니다.` };
  }
  const key = termKey(term);
  const dup = await pool.query('SELECT id FROM concept_items WHERE study_id = $1 AND term_key = $2', [studyId, key]);
  if (dup.rows.length) return { status: 409, error: '이미 있는 개념입니다.' };
  try {
    const { rows } = await pool.query(
      `INSERT INTO concept_items (study_id, user_id, term, term_key, origin) VALUES ($1, $2, $3, $4, $5) RETURNING ${ITEM_COLUMNS}`,
      [studyId, userId, term, key, origin]
    );
    await touchStudy(studyId);
    return { item: rows[0] };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 409, error: '이미 있는 개념입니다.' };
    throw err;
  }
}

router.post('/api/concepts/studies/:id/items', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(STUDY_NOT_FOUND);
  const src = req.body && typeof req.body === 'object' ? req.body : {};
  const term = readRequiredText(src.term, LIMITS.term, '개념 이름');
  if (term.error) return res.status(400).json({ error: term.error });
  const origin = readOptionalText(src.origin, LIMITS.origin, '출처');
  if (origin.error) return res.status(400).json({ error: origin.error });
  try {
    const study = await loadStudy(id, req.user.id);
    if (!study) return res.status(404).json(STUDY_NOT_FOUND);
    const r = await insertItem(id, req.user.id, { term: term.value, origin: origin.value || '직접 입력' });
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.status(201).json(r.item);
  } catch (err) {
    console.error('concepts item create error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.patch('/api/concepts/items/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(ITEM_NOT_FOUND);
  const src = req.body && typeof req.body === 'object' ? req.body : {};
  const out = {};
  if (src.term !== undefined) {
    const t = readRequiredText(src.term, LIMITS.term, '개념 이름');
    if (t.error) return res.status(400).json({ error: t.error });
    out.term = t.value; out.term_key = termKey(t.value);
  }
  if (src.group_label !== undefined) {
    const g = readOptionalText(src.group_label, LIMITS.group_label, '그룹');
    if (g.error) return res.status(400).json({ error: g.error });
    out.group_label = g.value;
  }
  let textEdited = false;
  for (const f of TEXT_FIELDS) {
    if (src[f] === undefined) continue;
    const v = readOptionalText(src[f], TEXT_LIMITS[f], f, { trim: false });
    if (v.error) return res.status(400).json({ error: v.error });
    out[f] = v.value; textEdited = true;
  }
  if (textEdited) out.content_source = 'user';
  if (src.status !== undefined) {
    if (!STATUSES.includes(src.status)) return res.status(400).json({ error: 'status가 올바르지 않습니다.' });
    out.status = src.status;
  }
  if (src.review_state !== undefined) {
    if (!REVIEW_STATES.includes(src.review_state)) return res.status(400).json({ error: 'review_state가 올바르지 않습니다.' });
    out.review_state = src.review_state;
  }
  if (src.note !== undefined) {
    const n = readOptionalText(src.note, LIMITS.note, '메모', { trim: false });
    if (n.error) return res.status(400).json({ error: n.error });
    out.note = n.value;
  }
  if (!Object.keys(out).length) return res.status(400).json({ error: '변경할 항목이 없습니다.' });
  try {
    const cur = await loadItem(id, req.user.id);
    if (!cur) return res.status(404).json(ITEM_NOT_FOUND);
    if (out.term_key !== undefined && out.term_key !== termKey(cur.term)) {
      const dup = await pool.query('SELECT id FROM concept_items WHERE study_id = $1 AND term_key = $2', [cur.study_id, out.term_key]);
      if (dup.rows.some(r => r.id !== id)) return res.status(409).json({ error: '이미 있는 개념입니다.' });
    }
    const keys = Object.keys(out);
    const params = [id, req.user.id, ...keys.map(k => out[k])];
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    let rows;
    try {
      ({ rows } = await pool.query(
        `UPDATE concept_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING ${ITEM_COLUMNS}`, params));
    } catch (err) {
      if (isUniqueViolation(err)) return res.status(409).json({ error: '이미 있는 개념입니다.' });
      throw err;
    }
    if (!rows.length) return res.status(404).json(ITEM_NOT_FOUND);
    await touchStudy(cur.study_id);
    res.json(rows[0]);
  } catch (err) {
    console.error('concepts item patch error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.delete('/api/concepts/items/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(ITEM_NOT_FOUND);
  try {
    const { rows } = await pool.query('DELETE FROM concept_items WHERE id = $1 AND user_id = $2 RETURNING study_id', [id, req.user.id]);
    if (!rows.length) return res.status(404).json(ITEM_NOT_FOUND);
    // 선택돼 있던 개념이 지워지면 선택을 비운다(연결은 DB가 함께 지움)
    await pool.query('UPDATE concept_studies SET selected_item_id = NULL WHERE id = $1 AND selected_item_id = $2', [rows[0].study_id, id]);
    await touchStudy(rows[0].study_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('concepts item delete error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

// ─── 연결 ────────────────────────────────────────────────────────────────────

// 두 개념 사이에 방향과 상관없이 연결이 이미 있는지
async function linkExists(studyId, a, b) {
  const { rows } = await pool.query('SELECT from_item_id, to_item_id FROM concept_links WHERE study_id = $1', [studyId]);
  return rows.some(r => (r.from_item_id === a && r.to_item_id === b) || (r.from_item_id === b && r.to_item_id === a));
}

async function insertLink(studyId, userId, { from, to, relation_type, label, detail, source }) {
  const { rows } = await pool.query(
    `INSERT INTO concept_links (study_id, user_id, from_item_id, to_item_id, relation_type, label, detail, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${LINK_COLUMNS}`,
    [studyId, userId, from, to, relation_type, label, detail, source]
  );
  return rows[0];
}

router.post('/api/concepts/studies/:id/links', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(STUDY_NOT_FOUND);
  const src = req.body && typeof req.body === 'object' ? req.body : {};
  const from = parseId(String(src.from_item_id)), to = parseId(String(src.to_item_id));
  if (typeof src.from_item_id === 'string' || typeof src.to_item_id === 'string' || from === null || to === null) {
    return res.status(400).json({ error: 'from_item_id와 to_item_id가 필요합니다.' });
  }
  if (from === to) return res.status(400).json({ error: '같은 개념끼리는 연결할 수 없습니다.' });
  const relationType = src.relation_type === undefined ? '기타 관련' : src.relation_type;
  if (!RELATION_TYPES.includes(relationType)) return res.status(400).json({ error: 'relation_type이 올바르지 않습니다.' });
  const label = readOptionalText(src.label, LIMITS.label, '연결 이름');
  if (label.error) return res.status(400).json({ error: label.error });
  const detail = readOptionalText(src.detail, LIMITS.detail, '연결 설명');
  if (detail.error) return res.status(400).json({ error: detail.error });
  try {
    const study = await loadStudy(id, req.user.id);
    if (!study) return res.status(404).json(STUDY_NOT_FOUND);
    const [a, b] = await Promise.all([loadItem(from, req.user.id), loadItem(to, req.user.id)]);
    if (!a || !b || a.study_id !== id || b.study_id !== id) return res.status(404).json(ITEM_NOT_FOUND);
    if (await linkExists(id, from, to)) return res.status(409).json({ error: '이미 연결되어 있습니다.' });
    const link = await insertLink(id, req.user.id, { from, to, relation_type: relationType, label: label.value, detail: detail.value, source: 'user' });
    await touchStudy(id);
    res.status(201).json(link);
  } catch (err) {
    console.error('concepts link create error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.delete('/api/concepts/links/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(LINK_NOT_FOUND);
  try {
    const { rowCount } = await pool.query('DELETE FROM concept_links WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rowCount) return res.status(404).json(LINK_NOT_FOUND);
    res.json({ ok: true });
  } catch (err) {
    console.error('concepts link delete error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

module.exports = router;
