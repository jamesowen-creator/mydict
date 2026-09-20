const express = require('express');
const { pool, trackUsage } = require('../lib/db');
const { extractOptionalUser, checkPermission } = require('../middleware/auth');

const router = express.Router();

// ─── TTS ─────────────────────────────────────────────────────────────────────

router.delete('/api/tts/cache', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ ok: true, deleted: 0 });
  try {
    const { rowCount } = await pool.query('DELETE FROM tts_cache');
    console.log(`TTS cache cleared: ${rowCount} rows deleted`);
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/tts', async (req, res) => {
  const { text, lang = 'en' } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

  const user = extractOptionalUser(req);
  if (user) {
    const allowed = await checkPermission(user.id, 'can_tts');
    if (!allowed) return res.status(403).json({ error: 'TTS 권한이 없습니다.' });
  }

  const textKey = text.trim().slice(0, 500);

  if (process.env.DATABASE_URL) {
    try {
      const { rows } = await pool.query(
        'SELECT audio FROM tts_cache WHERE text_key = $1 AND lang = $2',
        [textKey, lang]
      );
      if (rows.length > 0) {
        res.set('Content-Type', 'audio/mpeg');
        res.set('X-TTS-Cache', 'HIT');
        return res.send(rows[0].audio);
      }
    } catch (e) {
      console.error('TTS cache read error:', e.message);
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'TTS 기능을 사용할 수 없습니다.' });
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: textKey,
        voice: lang === 'en' ? 'onyx' : 'nova',
        response_format: 'mp3',
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(errText);
    }

    const audioBuffer = Buffer.from(await openaiRes.arrayBuffer());

    if (process.env.DATABASE_URL) {
      pool.query(
        `INSERT INTO tts_cache (text_key, lang, audio)
         VALUES ($1, $2, $3)
         ON CONFLICT (text_key, lang) DO NOTHING`,
        [textKey, lang, audioBuffer]
      ).catch(e => console.error('TTS cache write error:', e.message));
    }

    trackUsage(user?.id, 'tts', 'tts-1-hd', 0, 0, textKey.length);

    res.set('Content-Type', 'audio/mpeg');
    res.set('X-TTS-Cache', 'MISS');
    res.send(audioBuffer);
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: 'TTS 생성 실패' });
  }
});

module.exports = router;
