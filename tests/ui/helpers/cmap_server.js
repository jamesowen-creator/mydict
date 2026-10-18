// 작업271-2: 개념 지도 화면 테스트용 서버. public/ 정적 파일 + /api/me(모의) + /api/cmap/* 는 실제 routes/concept_map.js 로 전달한다.
// 라우트의 DB 는 tests/helpers/cmap_db.js (가짜 DB: 실제 PG 제약을 흉내 낸 것이며 운영 DB 가 아니다).
// 공용 tests/ui/helpers/mock_server.js 는 수정하지 않는다.
//   const srv = await startCmapServer();  srv.url  srv.db  srv.state.me  srv.token()  srv.close()
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createCmapDb, LEGACY_ONLY_TYPES } = require('../../helpers/cmap_db');
const CM = require('../../../lib/cmap_map');
const { startApp, createAnthropicMock } = require('../../helpers/app');

const PUBLIC = path.resolve(__dirname, '..', '..', '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function startCmapServer({ perm = true } = {}) {
  const db = createCmapDb();
  db.addUser(7, { perm_concept_map: perm });
  const anthropic = createAnthropicMock();   // 작업273-1: AI 는 모의(실제 호출 없음). srv.anthropic.handler 로 응답을 정한다
  anthropic.handler = () => { throw new Error('mock anthropic: handler 없음'); };
  const app = await startApp(['routes/concept_map.js'], { db, anthropic });
  const state = { me: { id: 7, email: 'u7@example.com', name: '테스터', role: 'user', perm_concept_map: perm } };
  const secret = process.env.JWT_SECRET || 'mydict-jwt-secret';

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(state.me)); return; }
      if (url.pathname.startsWith('/api/cmap/')) {
        try {
          const body = Buffer.concat(chunks);
          // 307-1: 옛 7종은 서버가 새 연결로는 받지 않는다. 화면 테스트가 "이미 저장된 옛 유형 연결"을 시드할 수 있도록, 옛 유형으로 연결을 만드는 POST 만 가짜 DB 에 직접 넣는다(실제 화면의 선택지에는 옛 유형이 없어 사용자 조작과 섞이지 않는다)
          const em = req.method === 'POST' && /^\/api\/cmap\/maps\/(\d+)\/edges$/.exec(url.pathname);
          if (em && body.length) {
            let j = null; try { j = JSON.parse(body.toString('utf8')); } catch (e) { j = null; }
            if (j && typeof j.relation_type === 'string' && LEGACY_ONLY_TYPES.includes(j.relation_type)) {
              const mapId = Number(em[1]);
              const dir = CM.normalizeDirection(j.from_concept_id, j.to_concept_id, j.relation_type);
              const label = typeof j.label === 'string' && j.label.trim() !== '' ? j.label.trim() : null;
              if (db.edges.some(e => e.map_id === mapId && ((e.from_concept_id === dir.from && e.to_concept_id === dir.to) || (e.from_concept_id === dir.to && e.to_concept_id === dir.from)))) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '이미 이어진 두 개념입니다.' })); return; }
              const row = { id: db.seq.e++, map_id: mapId, from_concept_id: dir.from, to_concept_id: dir.to, relation_type: j.relation_type, label, created_at: new Date() };
              db.edges.push(row);
              res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, edge: CM.withDisplay(row) })); return;
            }
          }
          const headers = {};
          if (req.headers.authorization) headers.Authorization = req.headers.authorization;
          if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
          if (req.headers['x-audio-seconds']) headers['X-Audio-Seconds'] = req.headers['x-audio-seconds'];   // 278-1: 음성 답변의 녹음 길이
          const r = await fetch(app.base + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) || !body.length ? undefined : body });
          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) { res.writeHead(502); res.end(String(e && e.message)); }
        return;
      }
      if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"mock: 없는 경로"}'); return; }
      const rel = url.pathname === '/' ? '/home/index.html' : url.pathname;
      const file = path.join(PUBLIC, decodeURIComponent(rel));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  return {
    url: 'http://127.0.0.1:' + server.address().port,
    db, state, anthropic,
    token: (id = 7) => jwt.sign({ id, email: 'u' + id + '@example.com' }, secret),
    close: async () => { await new Promise(r => server.close(r)); await app.close(); },
  };
}

module.exports = { startCmapServer };
