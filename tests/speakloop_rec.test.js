// 작업402: 녹음 모듈(public/js/speakloop/rec.js) — 가짜 MediaRecorder·getUserMedia·타이머만 쓴다. 녹음은 기기 메모리(Blob URL)에만 있고 어디로도 보내지 않는다.
// 실행: node --test tests/speakloop_rec.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'speakloop', 'rec.js'), 'utf8');

// 가짜 브라우저 환경. 시간과 타이머는 직접 돌린다
function env({ supported = ['audio/webm;codecs=opus', 'audio/mp4'], deny = null, noRecorder = false, insecure = false } = {}) {
  const log = { gum: 0, stops: 0, mimes: [], opts: [], created: [], revoked: [], net: [], storage: [], listeners: {} };
  let now = 0, id = 0;
  const timers = new Map();
  const ctx = {
    console, Date: { now: () => now }, isSecureContext: !insecure,
    navigator: { mediaDevices: { getUserMedia: async () => { log.gum++; if (deny) throw Object.assign(new Error('x'), { name: deny }); return { getTracks: () => [{ stop: () => log.stops++ }] }; } }, sendBeacon: () => log.net.push('beacon') },
    URL: { createObjectURL: b => { const u = 'blob:' + (++id); log.created.push([u, b.type, b.size]); return u; }, revokeObjectURL: u => log.revoked.push(u) },
    Blob: class { constructor(parts, o) { this.type = (o && o.type) || ''; this.size = parts.length; } },
    fetch: () => log.net.push('fetch'), XMLHttpRequest: class { send() { log.net.push('xhr'); } },
    localStorage: { setItem: k => log.storage.push(k) }, indexedDB: { open: () => log.storage.push('idb') },
    setInterval: (f, ms) => { const t = ++id; timers.set(t, { f, ms, next: now + ms, every: true }); return t; },
    setTimeout: (f, ms) => { const t = ++id; timers.set(t, { f, ms, next: now + ms, every: false }); return t; },
    clearInterval: t => timers.delete(t), clearTimeout: t => timers.delete(t),
    addEventListener: (n, f) => { (log.listeners[n] = log.listeners[n] || []).push(f); },
  };
  if (!noRecorder) {
    ctx.MediaRecorder = class {
      static isTypeSupported(m) { log.mimes.push(m); return supported.includes(m); }
      constructor(stream, opt) { log.opts.push(opt || null); this.mimeType = (opt && opt.mimeType) || 'audio/webm'; }
      start() { this.started = true; }
      stop() { this.ondataavailable && this.ondataavailable({ data: { size: 5 } }); this.onstop && this.onstop(); }
    };
  }
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const advance = ms => {   // 시계를 ms 만큼 돌리며 만기된 타이머를 순서대로 실행
    const end = now + ms;
    for (;;) {
      let pick = null;
      for (const [t, v] of timers) if (v.next <= end && (!pick || v.next < pick[1].next)) pick = [t, v];
      if (!pick) break;
      now = pick[1].next;
      if (pick[1].every) pick[1].next += pick[1].ms; else timers.delete(pick[0]);
      pick[1].f();
    }
    now = end;
  };
  return { R: ctx.SLRec, log, advance };
}

test('권한은 처음 [녹음]을 누를 때만 요청한다(불러오기만 해서는 요청 없음). 형식은 webm/opus → mp4 → 브라우저 기본 순', async () => {
  let e = env();
  assert.equal(e.log.gum, 0);
  assert.equal(await e.R.start('m-a.l0'), true);
  assert.equal(e.log.gum, 1);
  assert.deepEqual(e.log.mimes, ['audio/webm;codecs=opus']);
  assert.equal(JSON.stringify(e.log.opts), '[{"mimeType":"audio/webm;codecs=opus"}]');
  e = env({ supported: ['audio/mp4'] });
  await e.R.start('k');
  assert.deepEqual(e.log.mimes, ['audio/webm;codecs=opus', 'audio/mp4']);
  assert.equal(JSON.stringify(e.log.opts), '[{"mimeType":"audio/mp4"}]');
  e = env({ supported: [] });
  await e.R.start('k');
  assert.equal(JSON.stringify(e.log.opts), '[null]', '지원 형식이 없으면 브라우저 기본');
});

test('정지하면 키별 Blob URL 로 보관하고 트랙을 모두 끈다. 같은 키로 다시 녹음하면 이전 URL 을 revoke 하고 교체, 다른 키는 따로 보관', async () => {
  const { R, log } = env();
  await R.start('m-a.l0'); R.stop();
  assert.equal(log.stops, 1, '트랙 stop');
  const first = R.get('m-a.l0');
  assert.match(first, /^blob:/);
  assert.equal(R.recording(), null);
  await R.start('m-a.l1'); R.stop();
  assert.notEqual(R.get('m-a.l1'), first);
  assert.deepEqual(log.revoked, [], '다른 키는 지우지 않는다');
  await R.start('m-a.l0'); R.stop();
  assert.deepEqual(log.revoked, [first], '같은 키 재녹음: 이전 URL 해제');
  assert.notEqual(R.get('m-a.l0'), first);
  assert.equal(log.stops, 3);
});

test('최대 30초에서 자동 정지하고 그때까지의 녹음은 보관한다. 녹음 중에는 경과 초가 알려진다', async () => {
  const { R, log, advance } = env();
  const ticks = [];
  R.subscribe(ev => { if (ev.type === 'tick') ticks.push(ev.sec); });
  await R.start('k');
  advance(2000);
  assert.ok(ticks.length >= 7 && ticks[ticks.length - 1] >= 1.9);
  assert.equal(R.recording(), 'k');
  advance(27000);
  assert.equal(R.recording(), 'k', '29초에는 아직 녹음 중');
  advance(1100);
  assert.equal(R.recording(), null, '30초 자동 정지');
  assert.ok(R.get('k'));
  assert.equal(log.stops, 1);
  assert.equal(R.MAX_SEC, 30);
});

test('녹음 중에 다시 [녹음]을 눌러도 두 번 시작되지 않고, 권한 창이 떠 있는 중 정지하면 곧바로 닫는다', async () => {
  const e = env();
  const p = e.R.start('k');
  const second = e.R.start('k2');              // 권한 창이 떠 있는 동안의 중복 시작
  e.R.stop();                                  // starting 상태에서 정지 요청
  assert.equal(await second, false);
  await p;
  assert.equal(e.R.recording(), null);
  assert.equal(e.log.stops, 1, '얻은 스트림은 바로 끈다');
  assert.equal(e.R.get('k'), null);
});

test('지원 안 됨(MediaRecorder 없음·비보안 출처)·권한 거부·장치 없음이면 안내 글자(이벤트)를 보내고 녹음하지 않는다', async () => {
  for (const o of [{ noRecorder: true }, { insecure: true }, { deny: 'NotAllowedError' }, { deny: 'NotFoundError' }]) {
    const { R, log } = env(o);
    const errs = [];
    R.subscribe(ev => { if (ev.type === 'error') errs.push(ev.text); });
    assert.equal(await R.start('k'), false, JSON.stringify(o));
    assert.deepEqual(errs, ['마이크를 사용할 수 없습니다. 브라우저 설정에서 마이크 권한을 확인하세요.']);
    assert.equal(R.recording(), null);
    assert.equal(R.get('k'), null);
    assert.equal(log.stops, 0);
  }
});

test('pagehide 에 전체 URL 을 revoke 한다', async () => {
  const { R, log } = env();
  await R.start('a'); R.stop(); await R.start('b'); R.stop();
  const urls = [R.get('a'), R.get('b')];
  assert.equal(log.listeners.pagehide.length, 1);
  log.listeners.pagehide[0]();
  assert.deepEqual(log.revoked.sort(), urls.sort());
  assert.equal(R.get('a'), null);
});

test('전송·저장 없음: 녹음 전체 흐름에서 fetch·XHR·sendBeacon·localStorage·IndexedDB 를 쓰지 않는다 (코드에도 없다)', async () => {
  const { R, log, advance } = env();
  await R.start('a'); advance(1000); R.stop(); await R.start('a'); advance(31000); R.releaseAll();
  assert.deepEqual(log.net, []);
  assert.deepEqual(log.storage, []);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\/\/ .*$/, '')).join('\n');
  for (const w of ['fetch', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage', 'indexedDB', 'FormData', 'WebSocket']) assert.ok(!code.includes(w), w);
});
