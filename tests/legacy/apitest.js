process.chdir(require('path').resolve(__dirname, '..', '..'));   // 저장소 루트(이 파일 기준)
const Module = require('module');
const path = require('path');
const root = require('path').resolve(__dirname, '..', '..').replace(/\\/g, '/') + '/';   // 저장소 루트(이 파일 기준)
process.env.DATABASE_URL = 'x';
let usageCount = 0, authed = true, perm = true;
const queries = [];
let anthropicReply = null, anthropicThrow = false, lastCall = null;
const fakePool = {
  query: async (sql, params) => {
    queries.push({ sql, params });
    if (/FROM api_usage/.test(sql)) return { rows: [{ n: usageCount }] };
    if (/INSERT INTO voice_notes/.test(sql)) return { rows: [{ id: 1, subject: params[5], subject_detail: params[6] }] };
    if (/UPDATE voice_notes/.test(sql)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  },
};
const tracked = [];
const stubs = {
  [path.resolve(root, 'lib/db.js')]: { pool: fakePool, trackUsage: (...a) => tracked.push(a) },
  [path.resolve(root, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { if (!authed) return res.status(401).json({ error: 'no' }); req.user = { id: 7 }; next(); },
    checkPermission: async () => perm,
  },
};
class FakeAnthropic {
  constructor() {}
  get messages() {
    return { create: async (args) => { lastCall = args; if (anthropicThrow) throw Object.assign(new Error('x'), { status: 500 }); return { content: [{ type: 'text', text: anthropicReply }], usage: { input_tokens: 1, output_tokens: 2 } }; } };
  }
}
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@anthropic-ai/sdk') return FakeAnthropic;
  try {
    const resolved = Module._resolveFilename(req, parent);
    if (stubs[resolved]) return stubs[resolved];
  } catch (e) {}
  return origLoad.call(this, req, parent, ...rest);
};
const express = require(root + 'node_modules/express');
const router = require(root + 'routes/voice_study.js');
const app = express();
app.use(express.json());
app.use(router);
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } }

(async () => {
  const srv = app.listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  };
  process.env.ANTHROPIC_API_KEY = 'k';
  const T = '광합성은 식물이 빛 에너지를 이용해 포도당을 만드는 과정이다. 엽록체에서 일어나며 이산화탄소와 물이 필요하다. 산소가 부산물로 나온다. Mitochondria is the powerhouse of the cell.';
  const sum = (b) => call('POST', '/api/voice-notes/summarize', b);
  const reply = (o) => { anthropicReply = typeof o === 'string' ? o : JSON.stringify(o); };

  // 정상
  reply({ type: '원리·절차', subject: '과학', subject_detail: '생물', sections: [
    { title: '절차', items: [{ text: '빛을 흡수한다', quote: '식물이 빛 에너지를 이용해 포도당을 만드는' }] },
    { title: '주제', items: [{ text: '광합성', quote: '광합성은 식물이 빛 에너지' }, { text: '  산소가\n부산물  ', quote: '산소가 부산물로 나온다' }] },
    { title: '만든 칸', items: [{ text: '버려짐', quote: '광합성은 식물이 빛 에너지' }] },
    { title: '외울 것', items: [{ text: '엽록체에서 일어난다', quote: '엽록체에서 일어나며 이산화탄소와 물' }, { text: '근거 없음', quote: '원문에 없는 문장이다' }, { text: '짧은quote', quote: '짧다' }, { text: '', quote: '빈 text 항목은 버림이다' }, { text: 5, quote: 'x' }] },
  ] });
  let r = await sum({ transcript: T });
  ok('normal 200', r.status === 200, r);
  ok('normal render', r.body.summary === '유형: 원리·절차\n\n■ 주제\n- 광합성\n- 산소가 부산물\n\n■ 절차\n- 빛을 흡수한다\n\n■ 외울 것\n- 엽록체에서 일어난다\n- ⚠ 근거 없음\n- ⚠ 짧은quote', r.body.summary);
  ok('unverified 2', r.body.unverified_count === 2, r.body);
  ok('subject', r.body.subject === '과학' && r.body.subject_detail === '생물' && r.body.type === '원리·절차', r.body);
  ok('model params', lastCall.max_tokens === 1800 && lastCall.temperature === 0.2 && lastCall.model === 'claude-haiku-4-5-20251001');
  ok('prompt has types+subjects', lastCall.system.includes('- 시간·사건: 주제, 배경, 전개, 결과·영향, 외울 것') && lastCall.system.includes('- 사회: 지리, 윤리·사상, 정치·법, 경제, 사회·문화') && !lastCall.system.includes('[사용자 지정 유형]'));
  ok('usage tracked', tracked.length === 1 && tracked[0][1] === 'summary');

  // 유형 지정 -> 모델 type 무시
  reply({ type: '개념 설명', subject: '과학', subject_detail: null, sections: [{ title: '근거', items: [{ text: 'a', quote: '광합성은 식물이 빛 에너지' }] }] });
  r = await sum({ transcript: T, type: '주장·논증' });
  ok('specified type', r.status === 200 && r.body.type === '주장·논증' && r.body.summary.startsWith('유형: 주장·논증\n\n■ 근거\n- a'), r.body);
  ok('specified in prompt', lastCall.system.includes('[사용자 지정 유형] 주장·논증'));
  // 목록에 없는 모델 type -> 개념 설명
  reply({ type: '엉뚱', subject: '없는과목', subject_detail: '생물', sections: [{ title: '핵심 개념', items: [{ text: 'a', quote: '광합성은 식물이 빛 에너지' }] }] });
  r = await sum({ transcript: T, type: 'auto' });
  ok('fallback type', r.body.type === '개념 설명' && r.body.subject === null && r.body.subject_detail === null, r.body);
  // detail mismatch
  reply({ type: '개념 설명', subject: '수학', subject_detail: '생물', sections: [{ title: '주제', items: [{ text: 'a', quote: '광합성은 식물이 빛 에너지' }] }] });
  r = await sum({ transcript: T });
  ok('detail mismatch', r.body.subject === '수학' && r.body.subject_detail === null, r.body);
  // 기타 + null
  reply({ type: '개념 설명', subject: '기타', subject_detail: null, sections: [{ title: '주제', items: [{ text: 'a', quote: '광합성은 식물이 빛 에너지' }] }] });
  r = await sum({ transcript: T });
  ok('기타', r.body.subject === '기타' && r.body.subject_detail === null, r.body);
  // 영문 대소문자 구분
  reply({ type: '용어·어학', subject: '영어', subject_detail: '어휘', sections: [{ title: '용어·표현', items: [{ text: 'a', quote: 'mitochondria is the powerhouse' }, { text: 'b', quote: 'Mitochondria is the powerhouse' }] }] });
  r = await sum({ transcript: T });
  ok('case sensitive', r.body.unverified_count === 1 && r.body.summary.includes('- ⚠ a') && r.body.summary.includes('- b'), r.body);
  // 제한: 칸당 6, 전체 20
  const mk = (n, q) => Array.from({ length: n }, (_, i) => ({ text: 'i' + i, quote: '광합성은 식물이 빛 에너지' }));
  reply({ type: '시간·사건', sections: [{ title: '주제', items: mk(10) }, { title: '배경', items: mk(10) }, { title: '전개', items: mk(10) }, { title: '결과·영향', items: mk(10) }, { title: '외울 것', items: mk(10) }] });
  r = await sum({ transcript: T });
  const itemLines = r.body.summary.split('\n').filter(l => l.startsWith('- '));
  const perSec = r.body.summary.split('\n\n').slice(1).map(b => b.split('\n').length - 1);
  ok('limits', itemLines.length === 20 && Math.max(...perSec) === 6, { n: itemLines.length, perSec });
  // 200자 자르기
  reply({ type: '개념 설명', sections: [{ title: '주제', items: [{ text: '가'.repeat(300), quote: '광합성은 식물이 빛 에너지' }] }] });
  r = await sum({ transcript: T });
  ok('truncate 200', r.body.summary.split('\n').find(l => l.startsWith('- ')).length === 202, r.body);
  // 코드펜스
  reply('```json\n' + JSON.stringify({ type: '개념 설명', sections: [{ title: '주제', items: [{ text: 'a', quote: '광합성은 식물이 빛 에너지' }] }] }) + '\n```');
  r = await sum({ transcript: T });
  ok('fence', r.status === 200, r);
  // 0 항목 422
  reply({ type: '개념 설명', sections: [{ title: '엉뚱칸', items: [{ text: 'a', quote: 'q' }] }] });
  r = await sum({ transcript: T });
  ok('422', r.status === 422 && r.body.error === '요약할 내용이 부족합니다.', r);
  reply({ type: '개념 설명' });
  r = await sum({ transcript: T });
  ok('422 no sections', r.status === 422, r);
  // 잘못된 JSON 502
  reply('이건 JSON이 아닙니다');
  r = await sum({ transcript: T });
  ok('502 bad json', r.status === 502, r);
  anthropicThrow = true; r = await sum({ transcript: T }); anthropicThrow = false;
  ok('502 upstream', r.status === 502, r);
  // 400 경로
  r = await sum({ transcript: '  ' }); ok('400 empty', r.status === 400, r);
  r = await sum({}); ok('400 missing', r.status === 400, r);
  r = await sum({ transcript: T, type: '없는유형' }); ok('400 bad type', r.status === 400, r);
  r = await sum({ transcript: T, type: 5 }); ok('400 type number', r.status === 400, r);
  r = await sum({ transcript: T, type: '__proto__' }); ok('400 proto', r.status === 400, r);
  r = await sum({ transcript: 'a'.repeat(30001) }); ok('400 long', r.status === 400, r);
  // 429
  usageCount = 30; r = await sum({ transcript: T }); ok('429', r.status === 429, r); usageCount = 0;
  // 503
  delete process.env.ANTHROPIC_API_KEY; r = await sum({ transcript: T }); ok('503', r.status === 503, r); process.env.ANTHROPIC_API_KEY = 'k';
  // 401 / 403
  authed = false; r = await sum({ transcript: T }); ok('401', r.status === 401, r); authed = true;
  perm = false; r = await sum({ transcript: T }); ok('403', r.status === 403, r); perm = true;

  // 자료 POST/PATCH
  const post = (b) => call('POST', '/api/voice-notes', b);
  const patch = (b) => call('PATCH', '/api/voice-notes/1', b);
  r = await post({ transcript: 'x', subject: '과학', subject_detail: '생물' }); ok('post ok', r.status === 201 && r.body.subject === '과학', r);
  ok('post params', queries.filter(q => /INSERT INTO voice_notes/.test(q.sql)).pop().params.slice(5, 7).join() === '과학,생물');
  r = await post({ transcript: 'x' }); ok('post no subject', r.status === 201 && r.body.subject === null, r);
  r = await post({ transcript: 'x', subject: null, subject_detail: null }); ok('post null', r.status === 201, r);
  r = await post({ transcript: 'x', subject: '기타' }); ok('post 기타', r.status === 201, r);
  r = await post({ transcript: 'x', subject: '과학', subject_detail: '문학' }); ok('post detail mismatch 400', r.status === 400, r);
  r = await post({ transcript: 'x', subject: '없음' }); ok('post bad subject 400', r.status === 400, r);
  r = await post({ transcript: 'x', subject_detail: '생물' }); ok('post detail only 400', r.status === 400, r);
  r = await post({ transcript: 'x', subject: null, subject_detail: '생물' }); ok('post null subj detail 400', r.status === 400, r);
  r = await post({ transcript: 'x', subject: '기타', subject_detail: '생물' }); ok('post 기타 detail 400', r.status === 400, r);
  r = await post({ transcript: 'x', subject: 5 }); ok('post number 400', r.status === 400, r);
  r = await post({ transcript: 'x', subject: '__proto__' }); ok('post proto 400', r.status === 400, r);
  r = await patch({ subject: '수학', subject_detail: '함수' }); ok('patch ok', r.status === 200, r);
  let q = queries.filter(q => /UPDATE voice_notes/.test(q.sql)).pop();
  ok('patch sets', /subject = \$3, subject_detail = \$4/.test(q.sql) && q.params.slice(2).join() === '수학,함수', q);
  r = await patch({ subject: '수학' }); q = queries.filter(q => /UPDATE voice_notes/.test(q.sql)).pop();
  ok('patch subject only clears detail', r.status === 200 && q.params[3] === null, q);
  r = await patch({ subject: null, subject_detail: null }); q = queries.filter(q => /UPDATE voice_notes/.test(q.sql)).pop();
  ok('patch clear', r.status === 200 && q.params[2] === null && q.params[3] === null, q);
  r = await patch({ subject: '수학', subject_detail: '생물' }); ok('patch mismatch 400', r.status === 400, r);
  r = await patch({ subject_detail: '함수' }); ok('patch detail only 400', r.status === 400, r);
  r = await patch({ title: 't' }); q = queries.filter(q => /UPDATE voice_notes/.test(q.sql)).pop();
  ok('patch title only unchanged', r.status === 200 && !/subject/.test(q.sql.split('RETURNING')[0]), q.sql);
  r = await patch({}); ok('patch empty 400', r.status === 400, r);
  // GET 쿼리
  await call('GET', '/api/voice-notes'); q = queries.filter(q => /FROM voice_notes WHERE user_id/.test(q.sql)).pop();
  ok('list query', /subject, subject_detail, LEFT\(summary, 300\)/.test(q.sql), q.sql);
  await call('GET', '/api/voice-notes/1'); q = queries.filter(q => /transcript, summary, subject, subject_detail/.test(q.sql) && /SELECT/.test(q.sql)).pop();
  ok('get query', !!q);

  console.log('pass', pass, 'fail', fail);
  // 최종 시스템 프롬프트 출력(파일로)
  if (process.argv[2]) require('fs').writeFileSync(process.argv[2], (() => { anthropicReply = JSON.stringify({}); return ''; })());   // 복사본: 경로를 줄 때만 쓴다(인자 없이 저장소 루트의 prompt.txt를 덮어쓰지 않게)
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
