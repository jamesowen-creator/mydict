// MetaCong 학습 모듈 API — MetaCong 프로젝트(api/chat.ts, src/lib/db.ts, src/lib/spaced-rep.ts)의
// 로직을 METIS Express 서버로 이식한 라우터. CORS/JSON 파싱은 server.js에서 이미 전역 적용됨.
//
// 원본: metagong/api/chat.ts, metagong/src/lib/db.ts, metagong/src/lib/spaced-rep.ts
// 프롬프트 원본: metagong/src/prompts/*.md (이 폴더의 ../prompts/*.md 는 그 사본)

const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

// MetaCong 전용 커넥션 풀 — server.js의 기존 pool과 분리해 서로 건드리지 않는다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const LOCAL_USER_ID = 'local'; // Phase 2에서 JWT 사용자 ID로 교체 예정

// ─── 간격 반복 계산 (spaced-rep.ts 이식) ──────────────────────────────────────

const INTERVAL_DAYS = [1, 3, 7, 21, 60];
const STAGE_PROGRESS = [0, 20, 40, 60, 80, 100];

function getNextReviewDate(stage) {
  const index = Math.min(stage, INTERVAL_DAYS.length - 1);
  const days = INTERVAL_DAYS[index];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function calcProgress(stage) {
  const index = Math.min(stage, STAGE_PROGRESS.length - 1);
  return STAGE_PROGRESS[index];
}

/** DB의 DATE 컬럼(UTC 자정 Date 객체 또는 문자열)을 'YYYY-MM-DD' 문자열로 변환한다. */
function toDateString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── AI 프롬프트 (chat.ts 이식) ────────────────────────────────────────────────

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const PROMPT_FILES = {
  question: 'question.md',
  feedback: 'feedback.md',
  summary: 'summary.md',
  overview: 'overview.md',
};

function loadPrompt(type) {
  const filePath = path.join(PROMPTS_DIR, PROMPT_FILES[type]);
  return fs.readFileSync(filePath, 'utf-8');
}

function buildUserMessage(body) {
  const header = [
    '[성취기준 정보]',
    `과목: ${body.subject}`,
    `영역: ${body.domain}`,
    `성취기준 코드: ${body.standard_code}`,
    `성취기준 내용: ${body.achievement_standard}`,
  ].join('\n');

  switch (body.type) {
    case 'feedback':
      return `${header}\n\n[학생 답변]\n${body.user_answer}`;
    case 'summary':
      return `${header}\n\n[학습 세션 대화 내용]\n${body.session_history}`;
    case 'overview':
      return `${header}\n\n[교과서 내용]\n${
        (body.textbook_content && body.textbook_content.trim()) ||
        '(제공되지 않음 - 성취기준을 바탕으로 개요를 생성해주세요)'
      }`;
    case 'question':
    default:
      return header;
  }
}

function isValidChatBody(body) {
  const validTypes = ['question', 'feedback', 'summary', 'overview'];
  if (!body.type || !validTypes.includes(body.type)) return false;
  if (!body.standard_code || !body.achievement_standard || !body.domain || !body.subject) {
    return false;
  }
  if (body.type === 'feedback' && !body.user_answer) return false;
  if (body.type === 'summary' && !body.session_history) return false;
  return true;
}

/** Claude 응답에서 순수 JSON 블록만 추출한다 (설명 문구가 섞여 나오는 경우 대비) */
function extractJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

// ─── POST /api/metacong/chat ──────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다.' });
  }

  const body = req.body || {};
  if (!isValidChatBody(body)) {
    return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  }

  let systemPrompt;
  try {
    systemPrompt = loadPrompt(body.type);
  } catch {
    return res.status(500).json({ error: '프롬프트 파일을 읽을 수 없습니다.' });
  }

  const client = new Anthropic({ apiKey });

  let rawText;
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: buildUserMessage(body) }],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    if (!textBlock) {
      throw new Error('텍스트 응답을 받지 못했습니다.');
    }
    rawText = textBlock.text;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'AI 요청이 몰려 잠시 후 다시 시도해주세요.' });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return res.status(502).json({ error: 'AI 서버에 연결할 수 없습니다. 네트워크 오류입니다.' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `AI 호출 오류: ${err.message}` });
    }
    console.error('MetaCong chat error:', err);
    return res.status(500).json({ error: '알 수 없는 오류가 발생했습니다.' });
  }

  if (body.type === 'question' || body.type === 'overview') {
    return res.status(200).json({ result: rawText.trim() });
  }

  if (body.type === 'feedback') {
    let parsed;
    try {
      parsed = JSON.parse(extractJson(rawText));
    } catch {
      return res.status(502).json({ error: 'AI 응답을 파싱하지 못했습니다.' });
    }
    return res.status(200).json({
      result: parsed.verbal_feedback,
      score: parsed.score,
      good_points: parsed.good_points,
      weak_points: parsed.weak_points,
      summary: parsed.summary,
      verbal_feedback: parsed.verbal_feedback,
    });
  }

  // summary — 프롬프트가 최종 JSON 스키마를 강제하므로 검증만 하고 그대로 result에 담아 돌려준다.
  const jsonText = extractJson(rawText);
  try {
    JSON.parse(jsonText);
  } catch {
    return res.status(502).json({ error: 'AI 응답을 파싱하지 못했습니다.' });
  }
  return res.status(200).json({ result: jsonText });
});

// ─── GET /api/metacong/standards ──────────────────────────────────────────────

router.get('/standards', async (req, res) => {
  const subjectParam = req.query.subject;
  const subject = Array.isArray(subjectParam) ? subjectParam[0] : subjectParam;

  try {
    const { rows } = await pool.query(
      `SELECT
         a.code,
         a.subject,
         a.domain,
         a.sequence,
         a.achievement_standard,
         COALESCE(p.progress_percent, 0) AS progress_percent,
         COALESCE(p.interval_stage, 0) AS interval_stage,
         p.next_review_date
       FROM achievement_standards a
       LEFT JOIN user_progress p
         ON p.standard_code = a.code AND p.user_id = $1
       WHERE $2::text IS NULL OR a.subject = $2
       ORDER BY a.subject, a.code`,
      [LOCAL_USER_ID, subject || null]
    );

    const standards = rows.map((row) => ({
      code: row.code,
      subject: row.subject,
      domain: row.domain,
      sequence: row.sequence,
      achievement_standard: row.achievement_standard,
      progress_percent: row.progress_percent,
      interval_stage: row.interval_stage,
      next_review_date: toDateString(row.next_review_date),
    }));

    res.status(200).json({ standards });
  } catch (err) {
    console.error('MetaCong standards 조회 실패:', err);
    res.status(500).json({ error: '성취기준 조회에 실패했습니다.' });
  }
});

// ─── POST /api/metacong/progress ──────────────────────────────────────────────

router.post('/progress', async (req, res) => {
  const body = req.body || {};
  if (typeof body.standard_code !== 'string' || typeof body.stage !== 'number') {
    return res
      .status(400)
      .json({ error: '요청 형식이 올바르지 않습니다. standard_code, stage가 필요합니다.' });
  }

  const userId = body.user_id || LOCAL_USER_ID;
  const progressPercent = calcProgress(body.stage);
  const nextReviewDate = getNextReviewDate(body.stage);

  try {
    await pool.query(
      `INSERT INTO user_progress (user_id, standard_code, progress_percent, interval_stage, next_review_date, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, standard_code)
       DO UPDATE SET
         progress_percent = EXCLUDED.progress_percent,
         interval_stage = EXCLUDED.interval_stage,
         next_review_date = EXCLUDED.next_review_date,
         updated_at = NOW()`,
      [userId, body.standard_code, progressPercent, body.stage, nextReviewDate]
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('MetaCong progress 저장 실패:', err);
    res.status(500).json({ error: '진도 저장에 실패했습니다.' });
  }
});

// ─── POST /api/metacong/sessions ──────────────────────────────────────────────

router.post('/sessions', async (req, res) => {
  const body = req.body || {};
  const valid =
    typeof body.standard_code === 'string' &&
    typeof body.started_at === 'string' &&
    typeof body.ended_at === 'string' &&
    typeof body.summary === 'string' &&
    typeof body.score === 'number' &&
    typeof body.known === 'boolean';

  if (!valid) {
    return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  }

  try {
    await pool.query(
      `INSERT INTO learning_sessions (user_id, standard_code, started_at, ended_at, summary, score, known)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        body.user_id || LOCAL_USER_ID,
        body.standard_code,
        body.started_at,
        body.ended_at,
        body.summary,
        body.score,
        body.known,
      ]
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('MetaCong sessions 저장 실패:', err);
    res.status(500).json({ error: '학습 세션 저장에 실패했습니다.' });
  }
});

module.exports = router;
