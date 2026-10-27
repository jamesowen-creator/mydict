const express = require('express');
const { pool, trackUsage } = require('../lib/db');
const { requireAuth, checkPermission, requireAdmin, ADMIN_EMAILS } = require('../middleware/auth');

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

// 작업337: 하루 사용량 제한. 서버가 OpenAI 를 실제로 부르는 경우(캐시 미스)만 센다. 환경변수가 없거나 범위 밖이면 기본값(30000자·150회)
const envCap = (name, def, min, max) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
const dailyCharsCap = () => envCap('TTS_DAILY_CHARS_CAP', 30000, 1, 10000000);
const dailyCallsCap = () => envCap('TTS_DAILY_CALLS_CAP', 150, 1, 100000);
// 오늘(Asia/Seoul 0시 이후) 본인의 tts 호출 횟수와 글자 수(다른 한도와 같은 SQL 방식)
async function todayUsage(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(char_count), 0)::int AS chars FROM api_usage
     WHERE user_id = $1 AND event_type = 'tts'
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`,
    [userId]
  );
  return { n: rows[0].n, chars: rows[0].chars };
}
// 관리자(ADMIN_EMAILS 이메일 또는 DB role)는 can_tts 검사에서 제외. DB 오류면 관리자로 보지 않고 일반 검사로 넘어간다
async function isAdminUser(user) {
  if (ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return true;
  if (!process.env.DATABASE_URL) return user.role === 'admin';
  try { const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [user.id]); return rows[0]?.role === 'admin'; } catch (e) { return false; }
}

router.post('/api/tts', requireAuth, async (req, res) => {
  // 작업334: 어떤 입력·예외에도 프로세스가 죽지 않게 핸들러 전체를 감싼다(예전에는 text 가 숫자면 text.trim 예외가 처리되지 않은 거부로 서버를 종료시켰다)
  try {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { text, lang = 'en' } = body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (typeof lang !== 'string' || !TTS_LANGS.includes(lang)) return res.status(400).json({ error: 'lang is not supported' });

  const user = req.user;   // 작업337: requireAuth 가 토큰을 확인했다(캐시 적중에도 로그인 필요)
  if (!(await isAdminUser(user))) {
    const allowed = await checkPermission(user.id, 'can_tts');   // DB 오류면 checkPermission 이 허용으로 처리한다(기존 패턴 그대로)
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

  // 작업337: 캐시 미스 — OpenAI 를 부르기 전에 오늘 사용량을 확인한다. 확인 중 DB 오류면 서버 음성을 쓰지 않도록 503 으로 닫는다(화면은 기기 음성으로 대체)
  if (process.env.DATABASE_URL) {
    let used;
    try { used = await todayUsage(user.id); } catch (e) { console.error('TTS usage check error:', e && e.message); return res.status(503).json({ error: '서버 발음을 지금은 쓸 수 없습니다.' }); }
    if (used.n >= dailyCallsCap() || used.chars + textKey.length > dailyCharsCap()) {
      return res.status(429).json({ error: '오늘 서버 발음 사용량을 모두 썼어요. 내일 다시 쓸 수 있고, 지금은 기기 음성으로 들려드려요.' });
    }
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

    trackUsage(user.id, 'tts', 'tts-1-hd', 0, 0, textKey.length);

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
