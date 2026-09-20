const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { trackUsage } = require('../lib/db');
const { extractOptionalUser, checkPermission } = require('../middleware/auth');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/api/ai', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '프롬프트를 입력해주세요.' });
  }

  const user = extractOptionalUser(req);
  if (user) {
    const allowed = await checkPermission(user.id, 'can_search');
    if (!allowed) return res.status(403).json({ error: '검색 권한이 없습니다.' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt.trim() }],
    });
    if (!message.content?.length) {
      return res.status(500).json({ error: '응답이 없습니다.' });
    }
    const text = message.content[0].type === 'text' ? (message.content[0].text ?? '') : '';
    trackUsage(user?.id, 'ai', 'claude-haiku-4-5', message.usage?.input_tokens, message.usage?.output_tokens, 0);
    res.json({ result: text });
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
