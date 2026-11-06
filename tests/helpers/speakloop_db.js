// 작업395: Speak Loop 시험용 가짜 DB·가짜 OpenAI(fetch). 이 기능이 쓰는 SQL 몇 가지만 흉내 낸다.
// users: 1 = 권한 있음, 3 = 권한 없음, 4 = DB 관리자, 5 = 이메일 관리자(행 없음, ADMIN_EMAILS=u5@example.com), 9 = 권한 있지만 차단. 그 밖은 행 없음.
function createSlDb({ failUsers = false } = {}) {
  const db = { queries: [], audio: new Map(), usage: [], failUsers,
    users: new Map([[1, { role: 'user', is_approved: true, is_blocked: false, perm_speakloop: true }], [3, { role: 'user', is_approved: true, is_blocked: false, perm_speakloop: false }],
      [4, { role: 'admin', is_approved: true, is_blocked: false, perm_speakloop: false }], [9, { role: 'user', is_approved: true, is_blocked: true, perm_speakloop: true }]]) };
  db.pool = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      db.queries.push(s);
      if (/FROM users/.test(s)) {
        if (db.failUsers) throw new Error('users down');
        return db.users.has(params[0]) ? { rows: [db.users.get(params[0])] } : { rows: [] };
      }
      if (s === 'SELECT clip_key, kind, content_hash, bytes FROM speakloop_audio') return { rows: [...db.audio.entries()].map(([clip_key, r]) => ({ clip_key, kind: r.kind, content_hash: r.content_hash, bytes: r.bytes })) };
      if (s === 'SELECT clip_key, content_hash FROM speakloop_audio') return { rows: [...db.audio.entries()].map(([clip_key, r]) => ({ clip_key, content_hash: r.content_hash })) };
      if (/^SELECT content_hash FROM speakloop_audio WHERE clip_key = \$1/.test(s)) return db.audio.has(params[0]) ? { rows: [{ content_hash: db.audio.get(params[0]).content_hash }] } : { rows: [] };
      if (/^SELECT audio FROM speakloop_audio WHERE clip_key = \$1/.test(s)) return db.audio.has(params[0]) ? { rows: [{ audio: db.audio.get(params[0]).audio }] } : { rows: [] };
      if (/^INSERT INTO speakloop_audio/.test(s)) {
        const [clip_key, kind, text, content_hash, model, voice, audio, bytes] = params;
        db.audio.set(clip_key, { kind, text, content_hash, model, voice, audio, bytes });
        return { rows: [] };
      }
      throw new Error('지원하지 않는 SQL: ' + s);
    },
  };
  db.trackUsage = (user_id, event_type, model, input_tokens, output_tokens, char_count) => db.usage.push({ user_id, event_type, model, input_tokens, output_tokens, char_count });
  return db;
}

// OpenAI 음성 API 주소(api.openai.com)로 가는 호출만 handler 로 돌리고, 시험 서버로 가는 호출은 진짜 fetch 로 보낸다.
// handler(body, n, opts) 는 Response 를 돌려주거나(또는 Promise) 예외를 던진다.
function installOpenAiFetch(handler) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.openai.com/')) {
      const body = JSON.parse(opts.body);
      calls.push({ url: String(url), headers: opts.headers, body });
      return handler(body, calls.length, opts);
    }
    return real(url, opts);
  };
  return { calls, restore: () => { global.fetch = real; } };
}
const mp3 = n => new Response(Buffer.from('MP3-' + n), { status: 200 });
const fail = status => new Response('err', { status });

module.exports = { createSlDb, installOpenAiFetch, mp3, fail };
