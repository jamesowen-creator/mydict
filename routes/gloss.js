// 작업417: 저장된 영어 단어 뜻 일괄 변환 — 관리자 전용 API(현황·샘플·적용·되돌리기·백업).
// 응답에는 사용자 이메일·이름을 넣지 않는다(단어 철자와 숫자 id 만).
'use strict';
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const B = require('../lib/gloss_backfill');

const router = express.Router();
const needDb = (req, res, next) => process.env.DATABASE_URL ? next() : res.status(503).json({ ok: false, error: '데이터베이스를 사용할 수 없습니다.' });
const needAi = (req, res, next) => process.env.ANTHROPIC_API_KEY ? next() : res.status(503).json({ ok: false, error: 'AI를 사용할 수 없습니다.' });
const bodyOf = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const RUN_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BUSY = { ok: false, error: '이미 실행 중입니다. 끝난 뒤 다시 시도해 주세요.' };

router.get('/api/admin/gloss/status', requireAdmin, needDb, async (req, res) => {
  try { res.json({ ok: true, ...(await B.status(B.defaultDeps())) }); }
  catch (err) { console.error('gloss status error:', err && err.message); res.status(500).json({ ok: false, error: '현황을 불러오지 못했습니다.' }); }
});

// words: 문자열 배열(또는 쉼표로 구분한 문자열). 소문자로 바꾸고 중복을 없애 최대 5개. 형식이 틀리면 null
function parseWords(v) {
  if (v === undefined || v === null) return [];
  const a = typeof v === 'string' ? v.split(',') : v;
  if (!Array.isArray(a) || a.length > 100) return null;
  const out = [];
  for (const x of a) {
    if (typeof x !== 'string') return null;
    const t = x.trim().toLowerCase();
    if (!t) continue;
    if (Array.from(t).length > 60) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, B.SAMPLE_WORDS_MAX);
}

router.post('/api/admin/gloss/sample', requireAdmin, needDb, needAi, async (req, res) => {
  const words = parseWords(bodyOf(req).words);
  if (words === null) return res.status(400).json({ ok: false, error: 'words 는 철자 문자열의 목록이어야 합니다.' });
  try {
    const r = await B.sample(req.user.id, B.defaultDeps(), { words });
    res.json({ ok: true, items: r.items });
  } catch (err) { console.error('gloss sample error:', err && err.message); res.status(500).json({ ok: false, error: '샘플을 만들지 못했습니다.' }); }
});

router.post('/api/admin/gloss/run', requireAdmin, needDb, needAi, async (req, res) => {
  const body = bodyOf(req);
  if (body.cursor !== undefined && !(Number.isInteger(body.cursor) && body.cursor >= 0)) return res.status(400).json({ ok: false, error: 'cursor 는 0 이상의 정수여야 합니다.' });
  if (body.run_id !== undefined && !(typeof body.run_id === 'string' && RUN_ID.test(body.run_id))) return res.status(400).json({ ok: false, error: 'run_id 가 올바르지 않습니다.' });
  try {
    const deps = B.defaultDeps();
    const r = await B.runLocked(() => B.run(req.user.id, { cursor: body.cursor || 0, runId: body.run_id }, deps));
    if (r.busy) return res.status(409).json(BUSY);
    res.json({ ok: true, ...r.value });
  } catch (err) { console.error('gloss run error:', err && err.message); res.status(500).json({ ok: false, error: '변환에 실패했습니다.' }); }
});

router.post('/api/admin/gloss/restore', requireAdmin, needDb, async (req, res) => {
  const body = bodyOf(req);
  if (body.run_id !== undefined && !(typeof body.run_id === 'string' && RUN_ID.test(body.run_id))) return res.status(400).json({ ok: false, error: 'run_id 가 올바르지 않습니다.' });
  if (body.run_id === undefined && body.all !== true) return res.status(400).json({ ok: false, error: 'run_id 또는 all:true 가 필요합니다.' });
  if (body.cursor !== undefined && !(Number.isInteger(body.cursor) && body.cursor > 0)) return res.status(400).json({ ok: false, error: 'cursor 가 올바르지 않습니다.' });
  try {
    const deps = B.defaultDeps();
    const r = await B.runLocked(() => B.restore({ runId: body.run_id, cursor: body.cursor }, deps));
    if (r.busy) return res.status(409).json(BUSY);
    res.json({ ok: true, ...r.value });
  } catch (err) { console.error('gloss restore error:', err && err.message); res.status(500).json({ ok: false, error: '되돌리지 못했습니다.' }); }
});

router.get('/api/admin/gloss/backup', requireAdmin, needDb, async (req, res) => {
  const runId = req.query.run_id;
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return res.status(400).json({ ok: false, error: 'run_id 가 올바르지 않습니다.' });
  try { res.json({ ok: true, run_id: runId, rows: await B.backup(runId, B.defaultDeps()) }); }
  catch (err) { console.error('gloss backup error:', err && err.message); res.status(500).json({ ok: false, error: '백업을 불러오지 못했습니다.' }); }
});

module.exports = router;
