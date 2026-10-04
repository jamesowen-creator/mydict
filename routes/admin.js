const express = require('express');
const { pool } = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── Admin endpoints ──────────────────────────────────────────────────────────

router.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.email, u.name, u.role, u.is_blocked, u.is_approved,
        u.can_search, u.can_wordbook, u.can_quiz, u.can_tts, u.can_podcast,
        u.perm_literature_compass, u.perm_digest_reading, u.perm_science_reading, u.perm_voice_study,
        u.created_at,
        COUNT(DISTINCT w.id)::int AS wordbook_count,
        COALESCE(SUM(CASE WHEN a.event_type IN ('search','ai') THEN 1 END)::int, 0) AS search_count,
        COALESCE(SUM(CASE WHEN a.event_type = 'tts' THEN 1 END)::int, 0) AS tts_count
      FROM users u
      LEFT JOIN wordbook w ON w.user_id = u.id
      LEFT JOIN api_usage a ON a.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin users error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (isNaN(targetId)) return res.status(400).json({ error: '잘못된 ID입니다.' });

  const allowed = ['role', 'is_blocked', 'is_approved', 'can_search', 'can_wordbook', 'can_quiz', 'can_tts', 'can_podcast', 'perm_literature_compass', 'perm_digest_reading', 'perm_science_reading', 'perm_voice_study'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: '변경할 항목이 없습니다.' });

  // Prevent self-demotion, self-block, or self-unapproval
  if (targetId === req.user.id) {
    const hasDanger = updates.some(([k, v]) =>
      (k === 'role' && v !== 'admin') || (k === 'is_blocked' && v === true) || (k === 'is_approved' && v === false)
    );
    if (hasDanger) return res.status(400).json({ error: '자기 자신의 권한을 제거하거나 차단/승인취소할 수 없습니다.' });
  }

  try {
    const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = [targetId, ...updates.map(([, v]) => v)];
    const { rows } = await pool.query(
      `UPDATE users SET ${setClauses} WHERE id = $1 RETURNING id, email, name, role, is_blocked, is_approved, can_search, can_wordbook, can_quiz, can_tts, can_podcast, perm_literature_compass, perm_digest_reading, perm_science_reading, perm_voice_study`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin patch error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [users, usage, monthly] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE NOT is_blocked)::int AS active,
          COUNT(*) FILTER (WHERE is_blocked)::int AS blocked,
          COUNT(*) FILTER (WHERE NOT is_approved)::int AS pending,
          COUNT(*) FILTER (WHERE role = 'admin')::int AS admins
        FROM users
      `),
      pool.query(`
        SELECT
          event_type,
          COUNT(*)::int AS count,
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
          COALESCE(SUM(char_count), 0)::bigint AS char_count
        FROM api_usage
        GROUP BY event_type
      `),
      pool.query(`
        SELECT
          event_type,
          COUNT(*)::int AS count,
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
          COALESCE(SUM(char_count), 0)::bigint AS char_count
        FROM api_usage
        WHERE created_at >= date_trunc('month', NOW())
        GROUP BY event_type
      `),
    ]);

    // Cost estimation
    // claude-haiku-4-5: $1.00/MTok input, $5.00/MTok output
    // tts-1-hd: $0.030/1000 chars
    // stt: char_count 칼럼에 오디오 초를 기록. 분당 단가는 환경변수 VOICE_STT_COST_PER_MIN(달러)이 있으면 그 값,
    // 없으면 VOICE_STT_MODEL(기본 gpt-4o-mini-transcribe) 기준 표: whisper-1·gpt-4o-transcribe 0.006, gpt-4o-mini-transcribe 0.003, 그 외 0.006
    function calcCost(rows) {
      let anthropic = 0, openai = 0;
      const sttEnv = parseFloat(process.env.VOICE_STT_COST_PER_MIN);
      const sttTable = { 'whisper-1': 0.006, 'gpt-4o-transcribe': 0.006, 'gpt-4o-mini-transcribe': 0.003 };
      const sttModel = process.env.VOICE_STT_MODEL || 'gpt-4o-mini-transcribe';
      const sttPerMin = Number.isFinite(sttEnv) && sttEnv >= 0 ? sttEnv : (Object.prototype.hasOwnProperty.call(sttTable, sttModel) ? sttTable[sttModel] : 0.006);
      for (const r of rows) {
        if (r.event_type === 'search' || r.event_type === 'ai' || r.event_type === 'summary' || r.event_type === 'quiz' || r.event_type === 'chat' || r.event_type === 'link' || r.event_type === 'image_aux') {
          anthropic += (Number(r.input_tokens) / 1_000_000) * 1.00;
          anthropic += (Number(r.output_tokens) / 1_000_000) * 5.00;
        }
        if (r.event_type === 'image') openai += Number(r.count) * (Number(process.env.VOICE_IMAGE_COST_USD) || 0);   // 장당 단가는 환경변수(미설정이면 0)
        if (r.event_type === 'tts') {
          openai += (Number(r.char_count) / 1000) * 0.030;
        }
        if (r.event_type === 'stt') {
          openai += (Number(r.char_count) / 60) * sttPerMin;
        }
      }
      return { anthropic: +anthropic.toFixed(4), openai: +openai.toFixed(4) };
    }

    res.json({
      users: users.rows[0],
      usage: usage.rows,
      monthly: monthly.rows,
      cost: { total: calcCost(usage.rows), monthly: calcCost(monthly.rows) },
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
