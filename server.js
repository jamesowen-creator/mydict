require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an English dictionary assistant. When given an English word or phrase, provide a clear and structured dictionary entry in Korean-friendly format.

Respond in the following JSON format:
{
  "word": "the word or phrase",
  "pronunciation": "IPA pronunciation",
  "partOfSpeech": "noun/verb/adjective/etc.",
  "definitions": [
    {
      "meaning": "definition in Korean",
      "example": "Example sentence in English",
      "exampleTranslation": "Korean translation of the example"
    }
  ],
  "synonyms": ["synonym1", "synonym2"],
  "antonyms": ["antonym1", "antonym2"],
  "origin": "Brief etymology in Korean (optional)"
}

Always respond with valid JSON only, no additional text. Provide 2-4 definitions when applicable. If the input is not a valid English word or phrase, return {"error": "유효하지 않은 단어입니다"}.`;

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (!process.env.APP_PASSWORD) {
    return res.json({ ok: true });
  }
  res.json({ ok: password === process.env.APP_PASSWORD });
});

app.post('/api/search', async (req, res) => {
  const { query } = req.body;

  if (!query || !query.trim()) {
    return res.status(400).json({ error: '검색어를 입력해주세요.' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: query.trim() }],
      system: SYSTEM_PROMPT,
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const result = JSON.parse(text);
    res.json(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: '응답 파싱 오류가 발생했습니다.' });
    } else {
      console.error('API error:', err.message);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  }
});

app.post('/api/ai', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '프롬프트를 입력해주세요.' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt.trim() }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    res.json({ text });
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`사전 서버 실행 중: http://localhost:${PORT}`);
});
