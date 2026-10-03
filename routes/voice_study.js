const express = require('express');
const { pool, trackUsage } = require('../lib/db');
const { requireAuth, checkPermission } = require('../middleware/auth');

const router = express.Router();

// 작업179: 음성 학습 자료(변환 글·요약본) CRUD. 오디오는 저장하지 않는다.
const LIMITS = { title: 100, transcript: 20000, summary: 5000 };
const MAX_NOTES_PER_USER = 200;
const MAX_PG_INT = 2147483647;

async function requireVoicePerm(req, res, next) {
  const allowed = await checkPermission(req.user.id, 'perm_voice_study');
  if (!allowed) return res.status(403).json({ error: '음성 학습 권한이 없습니다.' });
  next();
}

function requireDB(req, res, next) {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: '데이터베이스를 사용할 수 없습니다.' });
  next();
}

const guard = [requireAuth, requireVoicePerm, requireDB];

// 글자 수는 코드포인트 기준(이모지 등을 2글자로 세지 않음)
function charLen(s) { return Array.from(s).length; }

// body에서 title/transcript/summary 중 들어온 것만 검증해 반환. 오류면 { error }
function readFields(body, { requireTranscript }) {
  const out = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const f of ['title', 'transcript', 'summary']) {
    if (src[f] === undefined) continue;
    if (typeof src[f] !== 'string') return { error: `${f}은(는) 문자열이어야 합니다.` };
    if (charLen(src[f]) > LIMITS[f]) return { error: `${f}은(는) ${LIMITS[f]}자 이하여야 합니다.` };
    out[f] = src[f];
  }
  if (requireTranscript && !(out.transcript && out.transcript.trim())) {
    return { error: 'transcript가 필요합니다.' };
  }
  return { fields: out };
}

// 숫자가 아니거나 정수 범위를 벗어난 id는 없는 id와 같이 404로 처리
function parseId(raw) {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PG_INT ? n : null;
}

const NOT_FOUND = { error: '자료를 찾을 수 없습니다.' };
const SERVER_ERROR = { error: '서버 오류가 발생했습니다.' };

router.get('/api/voice-notes', guard, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, LEFT(summary, 100) AS summary, created_at
       FROM voice_notes WHERE user_id = $1
       ORDER BY created_at DESC, id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('voice-notes list error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.get('/api/voice-notes/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(NOT_FOUND);
  try {
    const { rows } = await pool.query(
      `SELECT id, title, transcript, summary, created_at, updated_at
       FROM voice_notes WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json(NOT_FOUND);
    res.json(rows[0]);
  } catch (err) {
    console.error('voice-notes get error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.post('/api/voice-notes', guard, async (req, res) => {
  const parsed = readFields(req.body, { requireTranscript: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { title = '', transcript, summary = '' } = parsed.fields;
  try {
    // 건수 확인과 INSERT를 한 문장으로 처리
    const { rows } = await pool.query(
      `INSERT INTO voice_notes (user_id, title, transcript, summary)
       SELECT $1, $2, $3, $4
       WHERE (SELECT COUNT(*) FROM voice_notes WHERE user_id = $1) < $5
       RETURNING id, title, transcript, summary, created_at, updated_at`,
      [req.user.id, title, transcript, summary, MAX_NOTES_PER_USER]
    );
    if (!rows.length) {
      return res.status(400).json({ error: `자료는 최대 ${MAX_NOTES_PER_USER}건까지 저장할 수 있습니다.` });
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('voice-notes create error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.patch('/api/voice-notes/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(NOT_FOUND);
  const parsed = readFields(req.body, { requireTranscript: false });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const entries = Object.entries(parsed.fields);
  if (!entries.length) return res.status(400).json({ error: '변경할 항목이 없습니다.' });
  if ('transcript' in parsed.fields && !parsed.fields.transcript.trim()) {
    return res.status(400).json({ error: 'transcript는 비울 수 없습니다.' });
  }
  try {
    // 컬럼명은 위 readFields가 통과시킨 고정 이름 3개뿐이고, 값은 모두 바인딩한다
    const sets = entries.map(([k], i) => `${k} = $${i + 3}`);
    const { rows } = await pool.query(
      `UPDATE voice_notes SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, transcript, summary, created_at, updated_at`,
      [id, req.user.id, ...entries.map(([, v]) => v)]
    );
    if (!rows.length) return res.status(404).json(NOT_FOUND);
    res.json(rows[0]);
  } catch (err) {
    console.error('voice-notes update error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

router.delete('/api/voice-notes/:id', guard, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json(NOT_FOUND);
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM voice_notes WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json(NOT_FOUND);
    res.json({ ok: true });
  } catch (err) {
    console.error('voice-notes delete error:', err.message);
    res.status(500).json(SERVER_ERROR);
  }
});

// ─── 작업180: 음성 → 글 변환(STT) ─────────────────────────────────────────────
// 음성은 메모리(req.body Buffer)에서만 다루고 OpenAI로 보낸 뒤 버린다.
// 디스크·DB·로그에는 남기지 않는다(로그에는 상태코드만).
const STT_MAX_BYTES = '12mb';
const STT_DAILY_LIMIT = 20;
const STT_TIMEOUT_MS = 150000;
const STT_MAX_SECONDS = 600;
const STT_TYPES = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

function audioBaseType(req) {
  return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

function requireAudioType(req, res, next) {
  if (!STT_TYPES[audioBaseType(req)]) {
    return res.status(415).json({ error: '지원하지 않는 오디오 형식입니다.' });
  }
  next();
}

// 12MB 초과(PayloadTooLargeError 등)를 JSON 응답으로 바꿔 준다
function audioBody(req, res, next) {
  express.raw({ type: 'audio/*', limit: STT_MAX_BYTES })(req, res, err => {
    if (!err) return next();
    const status = err.status === 413 ? 413 : 400;
    res.status(status).json({ error: status === 413 ? '녹음 파일이 너무 큽니다.' : '요청을 읽을 수 없습니다.' });
  });
}

router.post('/api/voice-notes/transcribe', guard, requireAudioType, audioBody, async (req, res) => {
  const audio = req.body;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    return res.status(400).json({ error: '녹음 데이터가 비어 있습니다.' });
  }

  // 오늘(Asia/Seoul 0시 이후) 본인의 stt 건수. api_usage.created_at은 TIMESTAMP(DB 세션 시간대 기준)
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM api_usage
       WHERE user_id = $1 AND event_type = 'stt'
         AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`,
      [req.user.id]
    );
    if (rows[0].n >= STT_DAILY_LIMIT) {
      return res.status(429).json({ error: `하루 ${STT_DAILY_LIMIT}건까지 변환할 수 있습니다.` });
    }
  } catch (err) {
    console.error('voice-notes stt limit check error:', err.message);
    return res.status(500).json(SERVER_ERROR);
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: '음성 변환 기능을 사용할 수 없습니다.' });
  }

  const model = process.env.VOICE_STT_MODEL || 'gpt-4o-mini-transcribe';
  const type = audioBaseType(req);
  const secondsRaw = parseFloat(req.headers['x-audio-seconds']);
  const seconds = Number.isFinite(secondsRaw) ? Math.min(STT_MAX_SECONDS, Math.max(0, Math.round(secondsRaw))) : 0;

  try {
    const form = new FormData();
    form.append('file', new Blob([audio], { type }), 'audio.' + STT_TYPES[type]);
    form.append('model', model);
    form.append('language', 'ko');
    const openaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
    if (!openaiRes.ok) {
      console.error('voice-notes stt upstream status:', openaiRes.status);
      return res.status(502).json({ error: '음성 변환에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }
    const data = await openaiRes.json();
    const text = typeof data.text === 'string' ? data.text : '';
    trackUsage(req.user.id, 'stt', model, 0, 0, seconds);
    res.json({ text });
  } catch (err) {
    // 오류 이름(TimeoutError 등)만 남기고 메시지·본문은 남기지 않는다
    console.error('voice-notes stt error:', err.name);
    res.status(502).json({ error: '음성 변환에 실패했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

module.exports = router;
