// 작업206: 관리자 비용 집계에 개념학습 음성 입력(concept_stt)이 voice_study STT와 같은 단가표로 더해지는지.
// DB·인증은 모의(lib/db.js, middleware/auth.js 대체). 다른 이벤트의 계산은 그대로여야 한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const root = path.resolve(__dirname, '..') + path.sep;
let rows = [];
const stubs = {
  [path.resolve(root, 'lib/db.js')]: { pool: { query: async sql => (/COUNT\(\*\)::int AS total/.test(sql) ? { rows: [{ total: 1, active: 1, blocked: 0, pending: 0, admins: 1 }] } : { rows }) } },
  [path.resolve(root, 'middleware/auth.js')]: { requireAdmin: (req, res, next) => next() },
};
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  try { const r = Module._resolveFilename(req, parent); if (stubs[r]) return stubs[r]; } catch (e) { /* 모의 대상 아님 */ }
  return origLoad.call(this, req, parent, ...rest);
};
const express = require('express');
const app = express();
app.use(require('../routes/admin.js'));
let server, base;
test.before(async () => { server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); base = 'http://127.0.0.1:' + server.address().port; });
test.after(async () => { Module._load = origLoad; await new Promise(r => server.close(r)); });

const ENV = ['VOICE_STT_MODEL', 'VOICE_STT_COST_PER_MIN'];
const near = (a, b) => Math.abs(a - b) < 1e-9;
async function cost(env) {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, env || {});
  try { return (await (await fetch(base + '/api/admin/stats')).json()).cost; } finally { for (const k of ENV) delete process.env[k]; }
}

test('concept_stt는 오디오 초 × 분당 단가(기본 gpt-4o-mini-transcribe 0.003)로 OpenAI 비용에 더해짐', async () => {
  rows = [{ event_type: 'concept_stt', count: 3, input_tokens: 0, output_tokens: 0, char_count: 600 }];   // 600초 = 10분
  const c = await cost();
  assert.ok(near(c.total.openai, 0.03), String(c.total.openai));
  assert.ok(near(c.monthly.openai, 0.03));
  assert.equal(c.total.anthropic, 0);
});

test('voice_study stt와 합산되고, 모델 표·환경변수 단가를 똑같이 따름', async () => {
  rows = [
    { event_type: 'stt', count: 1, input_tokens: 0, output_tokens: 0, char_count: 600 },
    { event_type: 'concept_stt', count: 2, input_tokens: 0, output_tokens: 0, char_count: 300 },
  ];   // 합 900초 = 15분
  assert.ok(near((await cost()).total.openai, 15 * 0.003));
  assert.ok(near((await cost({ VOICE_STT_MODEL: 'whisper-1' })).total.openai, 15 * 0.006));
  assert.ok(near((await cost({ VOICE_STT_COST_PER_MIN: '0.02' })).total.openai, 15 * 0.02));
  assert.ok(near((await cost({ VOICE_STT_COST_PER_MIN: '0' })).total.openai, 0));
});

test('다른 이벤트 계산은 그대로: 모르는 이벤트는 비용 없음, concept(Haiku)는 토큰 단가', async () => {
  rows = [
    { event_type: 'concept', count: 1, input_tokens: 1000000, output_tokens: 1000000, char_count: 0 },
    { event_type: 'tts', count: 1, input_tokens: 0, output_tokens: 0, char_count: 1000 },
    { event_type: 'concept_stt_unknown', count: 9, input_tokens: 5000000, output_tokens: 5000000, char_count: 99999 },
  ];
  const c = await cost();
  assert.ok(near(c.total.anthropic, 6), String(c.total.anthropic));
  assert.ok(near(c.total.openai, 0.03), String(c.total.openai));
});
