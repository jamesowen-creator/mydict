process.chdir(require('path').resolve(__dirname, '..', '..'));   // 저장소 루트(이 파일 기준)
const Module = require('module');
const path = require('path');
const root = require('path').resolve(__dirname, '..', '..').replace(/\\/g, '/') + '/';   // 저장소 루트(이 파일 기준)
const rows = [
  { event_type: 'stt', count: 3, input_tokens: 0, output_tokens: 0, char_count: 600 },          // 오디오 600초 = 10분
  { event_type: 'tts', count: 2, input_tokens: 0, output_tokens: 0, char_count: 1000 },
  ...['summary', 'quiz', 'chat', 'link', 'image_aux', 'search', 'ai'].map(e => ({ event_type: e, count: 1, input_tokens: 1000000, output_tokens: 1000000, char_count: 0 })),
  { event_type: 'image', count: 3, input_tokens: 0, output_tokens: 0, char_count: 0 },
  { event_type: 'unknown_event', count: 9, input_tokens: 5000000, output_tokens: 5000000, char_count: 99999 },
];
const stubs = {
  [path.resolve(root, 'lib/db.js')]: { pool: { query: async sql => (/COUNT\(\*\)::int AS total/.test(sql) ? { rows: [{ total: 1, active: 1, blocked: 0, pending: 0, admins: 1 }] } : { rows }) } },
  [path.resolve(root, 'middleware/auth.js')]: { requireAdmin: (req, res, next) => next() },
};
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) { try { const r = Module._resolveFilename(req, parent); if (stubs[r]) return stubs[r]; } catch (e) {} return origLoad.call(this, req, parent, ...rest); };
const express = require(root + 'node_modules/express');
const app = express(); app.use(require(root + 'routes/admin.js'));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
(async () => {
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const stats = async () => (await (await fetch(base + '/api/admin/stats')).json());
  const reset = () => { for (const k of ['VOICE_STT_MODEL', 'VOICE_STT_COST_PER_MIN', 'VOICE_IMAGE_COST_USD']) delete process.env[k]; };
  const TTS = 0.03;                 // 1000자 × $0.030
  const ANTHROPIC = 7 * (1 + 5);    // 7개 이벤트 × (입력 1MTok $1 + 출력 1MTok $5)
  const check = async (name, env, perMin, imageCost = 0) => {
    reset(); Object.assign(process.env, env);
    const s = await stats();
    const wantOpenai = +(TTS + 10 * perMin + 3 * imageCost).toFixed(4);
    ok(name + ' (total openai)', near(s.cost.total.openai, wantOpenai), { got: s.cost.total.openai, want: wantOpenai });
    ok(name + ' (monthly openai)', near(s.cost.monthly.openai, wantOpenai));
    ok(name + ' (anthropic unchanged)', near(s.cost.total.anthropic, ANTHROPIC), s.cost.total.anthropic);
  };
  await check('default model (gpt-4o-mini-transcribe) 0.003/min', {}, 0.003);
  await check('VOICE_STT_MODEL=gpt-4o-mini-transcribe', { VOICE_STT_MODEL: 'gpt-4o-mini-transcribe' }, 0.003);
  await check('VOICE_STT_MODEL=whisper-1 0.006/min', { VOICE_STT_MODEL: 'whisper-1' }, 0.006);
  await check('VOICE_STT_MODEL=gpt-4o-transcribe 0.006/min', { VOICE_STT_MODEL: 'gpt-4o-transcribe' }, 0.006);
  await check('unknown model → 0.006/min', { VOICE_STT_MODEL: 'some-future-model' }, 0.006);
  await check('prototype-ish model name → 0.006/min', { VOICE_STT_MODEL: '__proto__' }, 0.006);
  await check('prototype-ish model name (constructor) → 0.006/min', { VOICE_STT_MODEL: 'constructor' }, 0.006);
  await check('env per-minute overrides model table', { VOICE_STT_MODEL: 'whisper-1', VOICE_STT_COST_PER_MIN: '0.02' }, 0.02);
  await check('env per-minute overrides default model', { VOICE_STT_COST_PER_MIN: '0.01' }, 0.01);
  await check('env per-minute 0 is honoured', { VOICE_STT_COST_PER_MIN: '0' }, 0);
  await check('env per-minute invalid (abc) → table', { VOICE_STT_MODEL: 'whisper-1', VOICE_STT_COST_PER_MIN: 'abc' }, 0.006);
  await check('env per-minute negative → table', { VOICE_STT_MODEL: 'whisper-1', VOICE_STT_COST_PER_MIN: '-1' }, 0.006);
  await check('env per-minute empty → table', { VOICE_STT_COST_PER_MIN: '' }, 0.003);
  // 기존 이벤트 회귀: image는 장당 단가 환경변수, 나머지는 그대로
  await check('image cost env still applied', { VOICE_IMAGE_COST_USD: '0.04' }, 0.003, 0.04);
  await check('image cost unset → 0', {}, 0.003, 0);
  reset();
  const s = await stats();
  ok('users block unchanged', s.users.total === 1 && s.users.admins === 1 && Array.isArray(s.usage) && Array.isArray(s.monthly));
  ok('unknown event contributes nothing', near(s.cost.total.anthropic, ANTHROPIC));
  console.log('pass', pass, 'fail', fail);
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
