const express = require('express');
const { pool, trackUsage } = require('../lib/db');
const { extractOptionalUser, checkPermission, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── TTS ─────────────────────────────────────────────────────────────────────

// 작업334: 화면이 지금 보내는 lang 값(사전 발음·미리 받기·팟캐스트: en·ko·ja·zh, 스펠링 런: en). 이 밖의 값은 400
const TTS_LANGS = ['en', 'ko', 'ja', 'zh'];

// 작업334: 캐시 삭제는 관리자 전용(비로그인 401, 관리자가 아니면 403). 오류 상세는 응답에 싣지 않고 서버 로그에만 남긴다
router.delete('/api/tts/cache', requireAdmin, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.json({ ok: true, deleted: 0 });
    const { rowCount } = await pool.query('DELETE FROM tts_cache');
    console.log(`TTS cache cleared: ${rowCount} rows deleted`);
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    console.error('TTS cache clear error:', e && e.message);
    if (!res.headersSent) res.status(500).json({ error: '캐시 삭제에 실패했습니다.' });
  }
});

router.post('/api/tts', async (req, res) => {
  // 작업334: 어떤 입력·예외에도 프로세스가 죽지 않게 핸들러 전체를 감싼다(예전에는 text 가 숫자면 text.trim 예외가 처리되지 않은 거부로 서버를 종료시켰다)
  try {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { text, lang = 'en' } = body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (typeof lang !== 'string' || !TTS_LANGS.includes(lang)) return res.status(400).json({ error: 'lang is not supported' });

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

  {
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
  }
  } catch (err) {
    console.error('TTS error:', err && err.message);   // 상세는 서버 로그에만
    if (!res.headersSent) res.status(500).json({ error: 'TTS 생성 실패' });
  }
});

module.exports = router;
