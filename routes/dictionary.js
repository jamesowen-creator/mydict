const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { pool, trackUsage } = require('../lib/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 작업338: /api/ai 는 로그인 필수 + 권한(can_search) + 하루 사용량 제한. 한도는 사용자당 하루 호출 수(이벤트 'ai'),
// 환경변수 AI_DAILY_CAP 으로 덮어쓰고 없거나 범위 밖이면 200. 관리자에게도 적용한다. 날짜 경계는 다른 한도와 같은 Asia/Seoul 0시.
const AI_PROMPT_MAX = 20000;   // 글자 수. 사전 상세 프롬프트(수 KB)보다 넉넉하게
function aiDailyCap() {
  const n = parseInt(process.env.AI_DAILY_CAP, 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 200;
}
async function countTodayAi(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM api_usage
     WHERE user_id = $1 AND event_type = 'ai'
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`,
    [userId]
  );
  return rows[0].n;
}

router.post('/api/ai', requireAuth, async (req, res) => {
  // 어떤 입력·예외에도 요청이 멈추지 않게 핸들러 전체를 감싼다(예전에는 prompt 가 숫자면 prompt.trim 예외가 try 밖에서 나 요청이 끝나지 않았다)
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const prompt = body.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: '프롬프트를 입력해주세요.' });
    }
    if (Array.from(prompt).length > AI_PROMPT_MAX) {
      return res.status(400).json({ error: '프롬프트가 너무 깁니다.' });
    }

    const user = req.user;
    const allowed = await checkPermission(user.id, 'can_search');
    if (!allowed) return res.status(403).json({ error: '검색 권한이 없습니다.' });

    if (process.env.DATABASE_URL) {
      let used;
      try { used = await countTodayAi(user.id); } catch (e) { console.error('AI usage check error:', e && e.message); return res.status(503).json({ error: 'AI 기능을 지금은 쓸 수 없습니다. 잠시 후 다시 시도해주세요.' }); }
      if (used >= aiDailyCap()) {
        return res.status(429).json({ error: `하루 ${aiDailyCap()}번까지 AI 검색을 쓸 수 있어요. 내일 다시 이용해주세요.` });
      }
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt.trim() }],
    });
    if (!message.content?.length) {
      return res.status(500).json({ error: '응답이 없습니다.' });
    }
    const text = message.content[0].type === 'text' ? (message.content[0].text ?? '') : '';
    trackUsage(user.id, 'ai', 'claude-haiku-4-5', message.usage?.input_tokens, message.usage?.output_tokens, 0);
    res.json({ result: text });
  } catch (err) {
    console.error('API error:', err && err.message);
    if (!res.headersSent) res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
