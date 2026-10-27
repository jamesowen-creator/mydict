// 작업343: 2인 대결 방 저장소(서버 메모리). 결과는 DB 에 저장하지 않고, 서버가 재시작되면 방이 사라진다(허용).
// 시계는 주입할 수 있다(createStore({ now })). 네트워크·DB 와 무관한 순수 로직이라 시험에서 시간을 직접 움직인다.
// 방 상태: open(방장만 있음, 목록에 보임) → full(참가자 있음) → finished(둘 다 끝남, 결과 있음) / closed(방장이 혼자 끝내거나 나감)
const crypto = require('crypto');

const LIMITS = {
  MAX_ROOMS: 50,            // 서버 전체 방 수(넘으면 방 만들기 503)
  MIN_WORDS: 10,            // start 의 wordCount 하한
  MAX_WORDS: 100000,        // 단어 수 상한(생존 모드는 끝이 없어 넉넉히)
  MAX_HP: 10,
  MAX_SCORE: 100000000,
  MAX_COMBO: 100000,
  MAX_SEC: 86400,
  SIGNAL_TIMEOUT_MS: 30000, // 마지막 신호가 이보다 오래되면 연결 끊김
  SURVIVAL_SLACK_SEC: 2,    // finish 의 생존 시간은 서버가 잰 경과 + 이 값까지만 인정
  TIE_SEC: 1.5,             // 생존 시간 차이가 이 값을 넘으면 긴 쪽이 승리(이내면 점수)
  FINISHED_TTL_MS: 10 * 60 * 1000,
  IDLE_TTL_MS: 5 * 60 * 1000,
  CLOSED_TTL_MS: 60 * 1000,
  RATE_PER_SEC: 10,         // 사용자당 초당 요청 수 상한
};

const fail = (status, error) => ({ status, error });
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const r3 = x => Math.round(x * 1000) / 1000;

function createStore(opts) {
  const o = opts || {};
  let now = o.now || Date.now;
  const maxRooms = o.maxRooms || LIMITS.MAX_ROOMS;
  const rooms = new Map();
  const hits = new Map();   // userId → 최근 요청 시각들(속도 제한)

  function newPlayer(user) {
    return { userId: user.id, name: user.name, started: false, startedAt: 0, lastSignal: now(), score: 0, combo: 0, hp: 0, maxHp: 0, wordNo: 0, wordCount: 0,
      continued: false, finished: false, left: false, disconnected: false, survivalSec: 0, finalScore: 0 };
  }
  const playersOf = room => [room.host, room.guest].filter(Boolean);
  const playerOf = (room, userId) => (room.host.userId === userId ? room.host : room.guest && room.guest.userId === userId ? room.guest : null);
  const active = room => room.status === 'open' || room.status === 'full';
  function activeRoomOf(userId) {
    for (const room of rooms.values()) { const p = playerOf(room, userId); if (p && !p.left && active(room)) return room; }
    return null;
  }
  const touch = (room, p) => { const t = now(); room.lastActivity = t; if (p) p.lastSignal = t; };

  // ── 판정 ──
  function finalizePlayer(p, f) {
    p.finished = true; p.survivalSec = r3(f.survivalSec); p.finalScore = f.score; p.wordCount = f.wordCount; p.continued = !!f.continued;
    p.score = Math.max(p.score, f.score);
    if (f.disconnected) p.disconnected = true;
  }
  function judge(room) {
    const a = room.host, b = room.guest;
    const diff = r3(a.survivalSec - b.survivalSec);
    let winnerId = null, reason = 'draw';
    if (Math.abs(diff) > LIMITS.TIE_SEC + 1e-9) { winnerId = diff > 0 ? a.userId : b.userId; reason = 'survival'; }
    else if (a.finalScore !== b.finalScore) { winnerId = a.finalScore > b.finalScore ? a.userId : b.userId; reason = 'score'; }
    room.result = { winnerId, reason, diffSec: Math.abs(diff) };
  }
  function settle(room) {
    if (room.status === 'finished' || room.status === 'closed') return;
    if (!room.guest) { if (room.host.finished || room.host.left) { room.status = 'closed'; room.closedAt = now(); } return; }
    if (room.host.finished && room.guest.finished) { judge(room); room.status = 'finished'; room.finishedAt = now(); }
  }
  // 마지막 신호가 SIGNAL_TIMEOUT_MS 넘게 없는 달리는 중인 플레이어는 마지막 신호까지의 서버 경과 시간과 마지막 상태로 종료 처리한다
  function checkDisconnects(room) {
    if (!active(room)) return;
    for (const p of playersOf(room)) {
      if (p.started && !p.finished && now() - p.lastSignal > LIMITS.SIGNAL_TIMEOUT_MS) {
        finalizePlayer(p, { survivalSec: Math.max(0, (p.lastSignal - p.startedAt) / 1000), score: p.score, wordCount: p.wordCount, continued: p.continued, disconnected: true });
      }
    }
    settle(room);
  }

  // ── 방 ──
  function sweep() {
    const t = now();
    for (const [id, room] of rooms) {
      checkDisconnects(room);
      if (room.status === 'finished' && t - room.finishedAt > LIMITS.FINISHED_TTL_MS) rooms.delete(id);
      else if (room.status === 'closed' && t - room.closedAt > LIMITS.CLOSED_TTL_MS) rooms.delete(id);
      else if (active(room) && t - room.lastActivity > LIMITS.IDLE_TTL_MS) rooms.delete(id);
    }
    for (const [uid, arr] of hits) { if (!arr.length || t - arr[arr.length - 1] > 1000) hits.delete(uid); }
  }
  function create(user) {
    sweep();
    if (activeRoomOf(user.id)) return { error: fail(409, '이미 만든 방이나 참가 중인 방이 있습니다.') };
    if (rooms.size >= maxRooms) return { error: fail(503, '지금은 방을 더 만들 수 없습니다. 잠시 후 다시 시도해주세요.') };
    const id = crypto.randomBytes(12).toString('hex');
    const t = now();
    const room = { id, createdAt: t, lastActivity: t, status: 'open', host: newPlayer(user), guest: null, result: null, finishedAt: 0, closedAt: 0 };
    rooms.set(id, room);
    return { room };
  }
  function list(userId) {
    sweep();
    const out = [];
    for (const room of rooms.values()) {
      if (room.status !== 'open' || room.guest || room.host.finished) continue;
      out.push({ id: room.id, hostName: room.host.name, elapsedSec: Math.floor((now() - room.createdAt) / 1000), hostRunning: room.host.started && !room.host.finished, mine: room.host.userId === userId });
    }
    return out;
  }
  function get(id, userId) {
    const room = rooms.get(id);
    if (!room) return { error: fail(404, '방을 찾을 수 없습니다.') };
    const p = playerOf(room, userId);
    if (!p) return { error: fail(403, '이 방의 참가자가 아닙니다.') };
    checkDisconnects(room);   // 먼저 이전 신호 기준으로 끊김을 판단하고, 그 뒤 이 조회를 새 신호로 센다(조회도 연결이 살아 있다는 신호)
    if (active(room) && !p.left) touch(room, p);
    return { room, p };
  }
  function join(id, user) {
    const room = rooms.get(id);
    if (!room) return { error: fail(404, '방을 찾을 수 없습니다.') };
    checkDisconnects(room);
    if (room.host.userId === user.id) return { error: fail(400, '자기 방에는 참가할 수 없습니다.') };
    if (room.status !== 'open' || room.guest || room.host.finished) return { error: fail(409, '참가할 수 없는 방입니다.') };
    if (activeRoomOf(user.id)) return { error: fail(409, '이미 만든 방이나 참가 중인 방이 있습니다.') };
    room.guest = newPlayer(user); room.status = 'full'; touch(room, room.host);
    return { room };
  }
  function start(id, userId, wordCount) {
    const g = get(id, userId); if (g.error) return g;   // 접근 확인(404·403)이 입력 검증(400)보다 먼저
    if (!isInt(wordCount, LIMITS.MIN_WORDS, LIMITS.MAX_WORDS)) return { error: fail(400, `wordCount 는 ${LIMITS.MIN_WORDS} 이상 ${LIMITS.MAX_WORDS} 이하의 정수여야 합니다.`) };
    const { room, p } = g;
    if (!active(room) || p.left) return { error: fail(409, '이미 끝났거나 닫힌 방입니다.') };
    if (p.finished) return { error: fail(409, '이미 끝난 판입니다.') };
    if (!p.started) { p.started = true; p.startedAt = now(); p.wordCount = wordCount; }   // 두 번째 호출은 같은 시작 시각을 돌려준다(재시도 안전)
    touch(room, p);
    return { room, p };
  }
  function state(id, userId, s) {
    const g = get(id, userId); if (g.error) return g;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: fail(400, '본문이 올바르지 않습니다.') };
    if (!isInt(s.score, 0, LIMITS.MAX_SCORE) || !isInt(s.combo, 0, LIMITS.MAX_COMBO) || !isInt(s.hp, 0, LIMITS.MAX_HP) || !isInt(s.maxHp, 1, LIMITS.MAX_HP) || !isInt(s.wordNo, 0, LIMITS.MAX_WORDS) || typeof s.continued !== 'boolean') {
      return { error: fail(400, '상태 값이 올바르지 않습니다(score·combo·wordNo 정수 0 이상, hp 0~10, maxHp 1~10, continued 불리언).') };
    }
    if (s.hp > s.maxHp) return { error: fail(400, 'hp 는 maxHp 를 넘을 수 없습니다.') };
    const { room, p } = g;
    if (!active(room) || p.left) return { error: fail(409, '이미 끝났거나 닫힌 방입니다.') };
    if (!p.started) return { error: fail(409, '먼저 start 를 호출해야 합니다.') };
    if (p.finished) return { error: fail(409, '이미 끝난 판입니다.') };
    if (s.score < p.score || s.wordNo < p.wordNo || (p.continued && !s.continued)) return { error: fail(400, 'score·wordNo 는 줄어들 수 없고 continued 는 되돌릴 수 없습니다.') };
    p.score = s.score; p.combo = s.combo; p.hp = s.hp; p.maxHp = s.maxHp; p.wordNo = s.wordNo; p.continued = s.continued;
    touch(room, p);
    return { room, p };
  }
  function finish(id, userId, f) {
    const g = get(id, userId); if (g.error) return g;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { error: fail(400, '본문이 올바르지 않습니다.') };
    if (!isNum(f.survivalSec, 0, LIMITS.MAX_SEC) || !isInt(f.score, 0, LIMITS.MAX_SCORE) || !isInt(f.wordCount, 0, LIMITS.MAX_WORDS) || typeof f.continued !== 'boolean') {
      return { error: fail(400, '종료 값이 올바르지 않습니다(survivalSec 0~86400, score·wordCount 정수 0 이상, continued 불리언).') };
    }
    const { room, p } = g;
    if (p.finished) { touch(room, p); return { room, p }; }   // 같은 호출을 되풀이해도 처음 기록 그대로(멱등)
    if (!active(room) || p.left) return { error: fail(409, '이미 끝났거나 닫힌 방입니다.') };
    if (!p.started) return { error: fail(409, '먼저 start 를 호출해야 합니다.') };
    if (f.score < p.score) return { error: fail(400, '최종 점수가 직전 상태 점수보다 낮을 수 없습니다.') };
    const serverCap = (now() - p.startedAt) / 1000 + LIMITS.SURVIVAL_SLACK_SEC;
    finalizePlayer(p, { survivalSec: Math.min(f.survivalSec, serverCap), score: f.score, wordCount: f.wordCount, continued: f.continued });
    touch(room, p);
    settle(room);
    return { room, p };
  }
  function leave(id, userId) {
    const g = get(id, userId); if (g.error) return g;
    const { room, p } = g;
    if (p.left) return { room, p };
    p.left = true; touch(room, p);
    if (room.status === 'open') { room.status = 'closed'; room.closedAt = now(); return { room, p }; }
    if (room.status === 'full' && !p.finished) {   // 나간 사람은 지금까지의 서버 경과 시간과 마지막 상태로 끝난 것으로 본다(시작 전이면 0)
      finalizePlayer(p, { survivalSec: p.started ? Math.max(0, (now() - p.startedAt) / 1000) : 0, score: p.score, wordCount: p.wordCount, continued: p.continued });
    }
    settle(room);
    return { room, p };
  }

  // ── 보기 ──
  function pub(p) {
    return { name: p.name, hp: p.hp, maxHp: p.maxHp, score: p.score, combo: p.combo, wordNo: p.wordNo, running: p.started && !p.finished, finished: p.finished, continued: p.continued, disconnected: p.disconnected, left: p.left };
  }
  function resultView(room, p, opp) {
    const r = room.result; if (!r) return null;
    const side = q => ({ name: q.name, survivalSec: q.survivalSec, score: q.finalScore, wordCount: q.wordCount, continued: q.continued, disconnected: q.disconnected });
    return { winner: r.winnerId === null ? 'draw' : r.winnerId === p.userId ? 'me' : 'opponent', reason: r.reason, diffSec: r.diffSec, me: side(p), opponent: side(opp) };
  }
  function view(room, userId) {
    const p = playerOf(room, userId), opp = room.host === p ? room.guest : room.host;
    return {
      ok: true,
      room: { id: room.id, status: room.status, isHost: room.host === p, ageSec: Math.floor((now() - room.createdAt) / 1000) },
      me: Object.assign(pub(p), { started: p.started, wordCount: p.wordCount, serverElapsedSec: p.started && !p.finished ? r3((now() - p.startedAt) / 1000) : (p.finished ? p.survivalSec : 0), survivalSec: p.finished ? p.survivalSec : null }),
      opponent: opp ? pub(opp) : null,
      result: opp ? resultView(room, p, opp) : null,
    };
  }
  // ── 요청 수 상한 ──
  function rateLimited(userId) {
    const t = now();
    const arr = (hits.get(userId) || []).filter(x => t - x < 1000);
    arr.push(t); hits.set(userId, arr);
    return arr.length > LIMITS.RATE_PER_SEC;
  }

  return { create, list, get, join, start, state, finish, leave, view, sweep, rateLimited, setClock: fn => { now = fn; }, size: () => rooms.size, _rooms: rooms };
}

module.exports = { createStore, LIMITS };
