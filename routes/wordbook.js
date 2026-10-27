const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

const router = express.Router();

// 작업338: 예상 밖 타입(숫자·객체·배열 등)을 DB 오류(500)가 아니라 400 으로 돌려준다. 정상 화면이 보내는 값(문자열 단어, 객체 data, 숫자 id)은 그대로 통과한다.
const bodyOf = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const isStr = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isId = v => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 2147483647) || (typeof v === 'string' && /^\d{1,10}$/.test(v) && Number(v) >= 1 && Number(v) <= 2147483647);

// ─── Wordbook endpoints ───────────────────────────────────────────────────────

router.get('/api/wordbook', requireAuth, async (req, res) => {
  const allowed = await checkPermission(req.user.id, 'can_wordbook');
  if (!allowed) return res.status(403).json({ error: '단어장 권한이 없습니다.' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM wordbook WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/api/wordbook', requireAuth, async (req, res) => {
  const allowed = await checkPermission(req.user.id, 'can_wordbook');
  if (!allowed) return res.status(403).json({ error: '단어장 권한이 없습니다.' });
  const { word, lang = 'en', data, source = 'manual' } = bodyOf(req);
  if (!word || !isStr(word, 500)) return res.status(400).json({ error: '단어를 입력해주세요.' });
  if (!isStr(lang, 20) || !isStr(source, 40)) return res.status(400).json({ error: '언어 또는 출처가 올바르지 않습니다.' });
  if (data !== undefined && data !== null && typeof data !== 'object') return res.status(400).json({ error: '단어 데이터가 올바르지 않습니다.' });
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];
    const { rows } = await pool.query(
      'INSERT INTO wordbook (user_id, word, lang, data, next_review_date, source) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.id, word, lang, data ? JSON.stringify(data) : null, tomorrowDate, source]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.delete('/api/wordbook/:id', requireAuth, async (req, res) => {
  const allowed = await checkPermission(req.user.id, 'can_wordbook');
  if (!allowed) return res.status(403).json({ error: '단어장 권한이 없습니다.' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM wordbook WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.patch('/api/wordbook/:id/example', requireAuth, async (req, res) => {
  const { example_sentence } = bodyOf(req);
  if (!isStr(example_sentence, 2000)) return res.status(400).json({ error: 'example_sentence가 필요합니다.' });
  try {
    const { rowCount } = await pool.query(
      'UPDATE wordbook SET example_sentence = $1 WHERE id = $2 AND user_id = $3',
      [example_sentence, req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[example patch] DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ─── SM-2 Spaced Repetition ───────────────────────────────────────────────────

function applySM2({ score, repetitions, ease_factor, interval_days }) {
  let rep = repetitions;
  let ef  = ease_factor;
  let iv  = interval_days;

  if (score === 0) {
    rep = 0;
    iv  = 1;
    ef  = Math.max(1.3, ef - 0.2);
  } else if (score === 1) {
    iv  = 3;
    ef  = Math.max(1.3, ef - 0.15);
    // repetitions 유지
  } else if (score === 3) {
    rep += 1;
    ef   = Math.min(4.0, ef + 0.1);
    if      (rep === 1) iv = 1;
    else if (rep === 2) iv = 6;
    else                iv = Math.round(iv * ef);
  }

  const next_review = new Date(Date.now() + iv * 24 * 60 * 60 * 1000);
  return { repetitions: rep, ease_factor: ef, interval_days: iv, next_review };
}

router.post('/api/review-result', requireAuth, async (req, res) => {
  const { word_id, score } = bodyOf(req);
  if (!isId(word_id) || ![0, 1, 3].includes(score)) {
    return res.status(400).json({ error: 'word_id와 score(0·1·3)가 필요합니다.' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT repetitions, ease_factor, interval_days FROM wordbook WHERE id = $1 AND user_id = $2',
      [word_id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });

    const result = applySM2({ score, ...rows[0] });
    const updated = await pool.query(
      `UPDATE wordbook
         SET next_review   = $1,
             interval_days = $2,
             ease_factor   = $3,
             repetitions   = $4,
             last_reviewed = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING next_review, interval_days, repetitions`,
      [result.next_review, result.interval_days, result.ease_factor, result.repetitions, word_id, req.user.id]
    );
    await pool.query(
      'INSERT INTO review_log (user_id, word_id, score) VALUES ($1, $2, $3)',
      [req.user.id, word_id, score]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[review-result] DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/api/quiz-correct', requireAuth, async (req, res) => {
  const { word_id } = bodyOf(req);
  if (!isId(word_id)) return res.status(400).json({ error: 'word_id가 필요합니다.' });
  try {
    await pool.query(
      'UPDATE wordbook SET correct_count = COALESCE(correct_count, 0) + 1 WHERE id = $1 AND user_id = $2',
      [word_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[quiz-correct] DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/api/review-due', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM wordbook
        WHERE user_id      = $1
          AND last_reviewed IS NOT NULL
          AND next_review  <= NOW()
        ORDER BY next_review ASC
        LIMIT 20`,
      [req.user.id]
    );
    res.json({ due_count: rows.length, words: rows });
  } catch (err) {
    console.error('[review-due] DB error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
