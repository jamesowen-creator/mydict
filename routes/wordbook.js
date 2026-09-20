const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

const router = express.Router();

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
  const { word, lang = 'en', data } = req.body;
  if (!word) return res.status(400).json({ error: '단어를 입력해주세요.' });
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];
    const { rows } = await pool.query(
      'INSERT INTO wordbook (user_id, word, lang, data, next_review_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, word, lang, data ? JSON.stringify(data) : null, tomorrowDate]
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

router.get('/api/dashboard', requireAuth, async (req, res) => {
  const uid = req.user.id;

  function levelOf(m) {
    if (m >= 900) return { current: 10, next_at: null };
    if (m >= 800) return { current: 9,  next_at: 900 };
    if (m >= 700) return { current: 8,  next_at: 800 };
    if (m >= 600) return { current: 7,  next_at: 700 };
    if (m >= 500) return { current: 6,  next_at: 600 };
    if (m >= 400) return { current: 5,  next_at: 500 };
    if (m >= 300) return { current: 4,  next_at: 400 };
    if (m >= 200) return { current: 3,  next_at: 300 };
    if (m >= 100) return { current: 2,  next_at: 200 };
    return              { current: 1,   next_at: 100 };
  }

  try {
    const [wStats, langRows, accRow, dateRows] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int                                                    AS total_words,
          COUNT(*) FILTER (WHERE correct_count >= 3)::int                  AS mastered,
          COUNT(*) FILTER (WHERE next_review <= NOW()
                           AND last_reviewed IS NOT NULL)::int             AS today_due
        FROM wordbook WHERE user_id = $1`, [uid]),

      pool.query(`
        SELECT UPPER(lang) AS lang,
               COUNT(*)::int                                    AS total,
               COUNT(*) FILTER (WHERE correct_count >= 3)::int  AS mastered
        FROM wordbook WHERE user_id = $1 GROUP BY lang`, [uid]),

      pool.query(`
        SELECT COUNT(*) FILTER (WHERE score = 3)::int AS sure,
               COUNT(*) FILTER (WHERE score = 1)::int AS vague,
               COUNT(*) FILTER (WHERE score = 0)::int AS missed
        FROM review_log WHERE user_id = $1`, [uid]),

      pool.query(`
        SELECT DISTINCT created_at::date AS d
        FROM review_log WHERE user_id = $1
        ORDER BY d DESC`, [uid]),
    ]);

    // Streak: consecutive days from today
    let streak = 0;
    if (dateRows.rows.length) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let expected = new Date(today);
      for (const { d } of dateRows.rows) {
        const rd = new Date(d); rd.setHours(0, 0, 0, 0);
        if (rd.getTime() === expected.getTime()) {
          streak++;
          expected.setDate(expected.getDate() - 1);
        } else break;
      }
    }

    const mastered = wStats.rows[0].mastered;
    const LANGS = ['EN', 'KO', 'JA', 'ZH'];
    const langMap = Object.fromEntries(langRows.rows.map(r => [r.lang, r]));
    const by_language = LANGS.map(l => ({
      lang: l,
      total:    langMap[l]?.total    || 0,
      mastered: langMap[l]?.mastered || 0,
    }));

    res.json({
      today_due:   wStats.rows[0].today_due,
      total_words: wStats.rows[0].total_words,
      mastered,
      streak,
      accuracy: { sure: accRow.rows[0].sure, vague: accRow.rows[0].vague, missed: accRow.rows[0].missed },
      by_language,
      level: levelOf(mastered),
    });
  } catch (err) {
    console.error('[dashboard] error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.patch('/api/wordbook/:id/example', requireAuth, async (req, res) => {
  const { example_sentence } = req.body;
  if (!example_sentence) return res.status(400).json({ error: 'example_sentence가 필요합니다.' });
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
  const { word_id, score } = req.body;
  if (word_id == null || ![0, 1, 3].includes(score)) {
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

// ─── Daily Quest (Spaced Repetition) ─────────────────────────────────────────

const REVIEW_INTERVALS = [1, 3, 7, 14, 30]; // days, indexed by review_count before increment

router.get('/api/review/today', requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    const today = new Date().toISOString().split('T')[0];
    const { rows } = await pool.query(`
      SELECT id, word, lang, data, review_count, correct_count, next_review_date
      FROM wordbook
      WHERE user_id = $1
        AND next_review_date IS NOT NULL
        AND next_review_date <= $2
        AND correct_count < 3
      ORDER BY next_review_date ASC, review_count ASC
    `, [uid, today]);

    const byRound = {};
    rows.forEach(r => {
      const round = (r.review_count || 0) + 1;
      byRound[round] = (byRound[round] || 0) + 1;
    });

    res.json({ total: rows.length, words: rows, by_round: byRound });
  } catch (err) {
    console.error('[review/today]', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/api/review/complete', requireAuth, async (req, res) => {
  const { word_id, correct } = req.body;
  if (word_id == null) return res.status(400).json({ error: 'word_id가 필요합니다.' });
  try {
    const { rows } = await pool.query(
      'SELECT review_count, correct_count FROM wordbook WHERE id = $1 AND user_id = $2',
      [word_id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });

    const { review_count, correct_count } = rows[0];
    const intervalDays = REVIEW_INTERVALS[Math.min(review_count, REVIEW_INTERVALS.length - 1)];
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + intervalDays);
    const nextDateStr = nextDate.toISOString().split('T')[0];
    const newCorrect = correct ? correct_count + 1 : correct_count;

    await pool.query(
      `UPDATE wordbook
         SET review_count = review_count + 1,
             correct_count = $1,
             next_review_date = $2
       WHERE id = $3 AND user_id = $4`,
      [newCorrect, nextDateStr, word_id, req.user.id]
    );
    await pool.query(
      'INSERT INTO review_log (user_id, word_id, score) VALUES ($1, $2, $3)',
      [req.user.id, word_id, correct ? 3 : 0]
    );
    res.json({ ok: true, next_review_date: nextDateStr });
  } catch (err) {
    console.error('[review/complete]', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/api/quiz-correct', requireAuth, async (req, res) => {
  const { word_id } = req.body;
  if (!word_id) return res.status(400).json({ error: 'word_id가 필요합니다.' });
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
