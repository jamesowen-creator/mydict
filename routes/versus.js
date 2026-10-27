// 작업343: 2인 대결 서버. 방은 서버 메모리(lib/versus.js)에 있고 결과는 저장하지 않는다. 서버 인스턴스가 하나일 때만 동작한다.
// 모든 경로: requireAuth → 요청 수 상한(429) → 권한(관리자 또는 perm_versus, 아니면 403; DB 오류도 403) → 입력 검증(400).
const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth, ADMIN_EMAILS } = require('../middleware/auth');
const { createStore } = require('../lib/versus');

const router = express.Router();
const store = createStore();
router.store = store;   // 시험에서 시계를 주입하고 방을 들여다보기 위한 손잡이

const DENIED = { error: '대결 사용 권한이 없습니다.' };
const ID_RE = /^[0-9a-f]{24}$/;

function displayName(raw) {   // 이메일은 노출하지 않는다. 비어 있거나 이메일처럼 보이면 기본 이름
  const s = typeof raw === 'string' ? raw.normalize('NFC').trim().slice(0, 20) : '';
  return s && !s.includes('@') ? s : '플레이어';
}
async function requireVersusPerm(req, res, next) {
  const emailIsAdmin = ADMIN_EMAILS.includes((req.user.email || '').toLowerCase());
  if (!process.env.DATABASE_URL) {
    if (!emailIsAdmin) return res.status(403).json(DENIED);   // DB 없이는 확인할 수 없으므로 닫는다(관리자 이메일만 통과)
    req.versusName = displayName(req.user.name); return next();
  }
  try {
    const { rows } = await pool.query('SELECT name, role, is_blocked, perm_versus FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (!u || u.is_blocked) return res.status(403).json(DENIED);
    if (!(emailIsAdmin || u.role === 'admin' || u.perm_versus === true)) return res.status(403).json(DENIED);
    req.versusName = displayName(u.name || req.user.name);
    next();
  } catch (err) {
    console.error('versus permission error:', err && err.message);   // 확인하지 못하면 닫는다
    res.status(403).json(DENIED);
  }
}
function throttle(req, res, next) {
  if (store.rateLimited(req.user.id)) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  next();
}
const guard = [requireAuth, throttle, requireVersusPerm];
const bodyOf = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null);
const send = (res, r, okFn) => (r.error ? res.status(r.error.status).json({ error: r.error.error }) : res.json(okFn(r)));
function validId(req, res, next) {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: '방 번호가 올바르지 않습니다.' });
  next();
}
// 비동기 핸들러가 예외로 끝나 요청이 멈추지 않게 감싼다
const safe = fn => (req, res) => { try { fn(req, res); } catch (err) { console.error('versus error:', err && err.message); if (!res.headersSent) res.status(500).json({ error: '서버 오류가 발생했습니다.' }); } };

router.post('/api/versus/rooms', guard, safe((req, res) => {
  const r = store.create({ id: req.user.id, name: req.versusName });
  if (r.error) return res.status(r.error.status).json({ error: r.error.error });
  res.json({ ok: true, roomId: r.room.id });
}));

router.get('/api/versus/rooms', guard, safe((req, res) => {
  res.json({ ok: true, rooms: store.list(req.user.id) });
}));

router.post('/api/versus/rooms/:id/join', guard, validId, safe((req, res) => {
  const r = store.join(req.params.id, { id: req.user.id, name: req.versusName });
  send(res, r, x => store.view(x.room, req.user.id));
}));

router.post('/api/versus/rooms/:id/start', guard, validId, safe((req, res) => {
  const b = bodyOf(req); if (!b) return res.status(400).json({ error: '본문이 올바르지 않습니다.' });
  const r = store.start(req.params.id, req.user.id, b.wordCount);
  send(res, r, x => store.view(x.room, req.user.id));
}));

router.post('/api/versus/rooms/:id/state', guard, validId, safe((req, res) => {
  const r = store.state(req.params.id, req.user.id, bodyOf(req));
  send(res, r, x => store.view(x.room, req.user.id));
}));

router.post('/api/versus/rooms/:id/finish', guard, validId, safe((req, res) => {
  const r = store.finish(req.params.id, req.user.id, bodyOf(req));
  send(res, r, x => store.view(x.room, req.user.id));
}));

router.get('/api/versus/rooms/:id', guard, validId, safe((req, res) => {
  const r = store.get(req.params.id, req.user.id);
  send(res, r, x => store.view(x.room, req.user.id));
}));

router.post('/api/versus/rooms/:id/leave', guard, validId, safe((req, res) => {
  const r = store.leave(req.params.id, req.user.id);
  send(res, r, x => store.view(x.room, req.user.id));
}));

// 만료된 방 정리(10초마다). 타이머는 unref 라 프로세스 종료를 막지 않는다
const timer = setInterval(() => store.sweep(), 10000);
if (timer.unref) timer.unref();

module.exports = router;
