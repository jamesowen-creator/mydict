// 헤드리스 Chrome을 DevTools 프로토콜(CDP)로 직접 조종하는 작은 도우미(추가 패키지 없음, Node 22+ 내장 WebSocket 사용).
//   const browser = await launchBrowser();           // Chrome이 없으면 null
//   const page = await browser.newPage({ width: 390, height: 844 });
//   await page.goto('http://127.0.0.1:PORT/concept_study.html');
//   await page.click('[data-t="suggest-add"]'); await page.waitFor('!!document.querySelector(".term")');
// 외부 도메인(구글 폰트 등) 요청은 막아 테스트가 네트워크에 기대지 않게 한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Page {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.errors = []; this.dialogs = []; this.autoDialog = { accept: true };
    ws.addEventListener('message', ev => this._onMessage(JSON.parse(ev.data)));
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      return msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      this.errors.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      this.errors.push('console.error: ' + msg.params.args.map(a => a.value || a.description || '').join(' '));
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      this.dialogs.push({ type: msg.params.type, message: msg.params.message });
      this.send('Page.handleJavaScriptDialog', { accept: this.autoDialog.accept }).catch(() => {});
    } else if (msg.method === 'Fetch.requestPaused') {
      const url = msg.params.request.url;
      const local = /^(http:\/\/127\.0\.0\.1|data:|about:|blob:)/.test(url);
      this.send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: msg.params.requestId } : { requestId: msg.params.requestId, errorReason: 'Failed' }).catch(() => {});
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async init({ width, height, token }) {
    await this.send('Page.enable'); await this.send('Runtime.enable');
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    if (token) await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('mydict_token', ${JSON.stringify(token)})}catch(e){}` });
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor("document.readyState === 'complete'", 15000);
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval 오류: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text) + '\n' + expr);
    return r.result.value;
  }
  async waitFor(expr, timeout = 6000, label) {
    const end = Date.now() + timeout; let last;
    while (Date.now() < end) {
      try { last = await this.eval(expr); if (last) return last; } catch (e) { last = e.message; }
      await sleep(40);
    }
    throw new Error('waitFor 시간 초과: ' + (label || expr) + ' (마지막 값 ' + JSON.stringify(last) + ')');
  }
  // 실제 마우스 입력으로 클릭한다(다른 요소에 가려지면 엉뚱한 곳이 눌려 테스트가 실패한다)
  async click(selector, { index = 0 } = {}) {
    const box = await this.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, disabled: !!e.disabled }; })()`);
    if (!box) throw new Error('클릭할 요소 없음: ' + selector);
    if (box.disabled) throw new Error('비활성 요소: ' + selector);
    const hit = await this.eval(`(() => { const t = document.elementFromPoint(${box.x}, ${box.y}); const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; return !!t && (t === e || e.contains(t)); })()`);
    if (!hit) throw new Error('다른 요소에 가려져 클릭할 수 없음: ' + selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  async type(selector, text, { clear = true } = {}) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); ${clear ? 'e.select && e.select();' : ''} })()`);
    if (clear) await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }).then(() => this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }));
    if (text) await this.send('Input.insertText', { text });
  }
  // maxlength를 우회해 값을 직접 넣는다(붙여넣기 등으로 한도를 넘긴 입력 검증용)
  async setValue(selector, value) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  async text(selector) { return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.innerText : null; })()`); }
  async exists(selector) { return this.eval(`!!document.querySelector(${JSON.stringify(selector)})`); }
  async visible(selector) { return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; })()`); }
  async count(selector) { return this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`); }
  async hasHorizontalScroll() { return this.eval('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'); }
  async resize(width, height) { await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 }); await sleep(120); }
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  async close() { try { this.ws.close(); } catch (e) { /* 무시 */ } }
}

class Browser {
  constructor(proc, port, dir) { this.proc = proc; this.port = port; this.dir = dir; }
  async newPage({ width = 390, height = 844, token = 'test-token' } = {}) {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' });
    const target = await res.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    const page = new Page(ws);
    await page.init({ width, height, token });
    page.targetId = target.id;
    return page;
  }
  async close() {
    try { this.proc.kill(); } catch (e) { /* 무시 */ }
    await sleep(200);
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
  }
}

function findChrome() { return CHROME_CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null; }

async function launchBrowser() {
  const exe = findChrome();
  if (!exe) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-ui-'));
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) { proc.kill(); throw new Error('Chrome 디버그 포트를 찾지 못했습니다.'); }
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  return new Browser(proc, port, dir);
}

module.exports = { launchBrowser, findChrome, sleep };
