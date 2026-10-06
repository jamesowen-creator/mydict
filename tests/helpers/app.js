// 라우트 테스트용 도우미: lib/db와 @anthropic-ai/sdk만 모의로 바꾸고, 인증·권한 미들웨어는 실제 코드를 쓴다.
//   const { createMockDb } = require('./mock_db');
//   const t = await startApp(['routes/concept_study.js'], { db, anthropic });
//   const r = await t.call('GET', '/api/concepts/studies', undefined, { user: 7 });  // user: null → 토큰 없음(401)
const Module = require('module');
const path = require('path');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '..', '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'mock://db';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

let current = { db: null, anthropic: null };
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '@anthropic-ai/sdk' && current.anthropic) return current.anthropic.module;
  if (current.db) {
    try {
      const resolved = Module._resolveFilename(request, parent);
      if (resolved === path.join(ROOT, 'lib', 'db.js')) {
        return { pool: current.db.pool, trackUsage: current.db.trackUsage, initDB: async () => {}, migrateVoiceConcepts: async () => ({}) };
      }
    } catch (e) { /* 모듈 해석 실패는 원래 로더에 맡김 */ }
  }
  return origLoad.call(this, request, parent, ...rest);
};

// 모의 Anthropic 클라이언트. handler(params)가 문자열(모델 응답 본문)·{ text, usage }를 돌려주거나 오류를 던진다.
function createAnthropicMock() {
  const mock = { calls: [], handler: null };
  mock.module = class Anthropic {
    constructor() {
      this.messages = {
        create: async params => {
          mock.calls.push(params);
          if (!mock.handler) throw new Error('mock anthropic: handler 없음');
          const r = await mock.handler(params, mock.calls.length);
          const out = typeof r === 'string' ? { text: r } : r;
          return { content: [{ type: 'text', text: out.text }], usage: out.usage || { input_tokens: 100, output_tokens: 50 } };
        },
      };
    }
  };
  return mock;
}

function dropCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(ROOT) && !k.includes('node_modules')) delete require.cache[k];
  }
}

async function startApp(routeFiles, { db, anthropic } = {}) {
  const express = require('express');
  current = { db, anthropic: anthropic || null };
  dropCache();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  for (const f of routeFiles) app.use(require(path.join(ROOT, f)));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const secret = process.env.JWT_SECRET || 'mydict-jwt-secret';
  async function call(method, url, body, { user = 7 } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (user !== null) headers.Authorization = 'Bearer ' + jwt.sign({ id: user, email: 'u' + user + '@example.com' }, secret);
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { status: r.status, body: json };
  }
  return { call, base, close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { ROOT, startApp, createAnthropicMock };
