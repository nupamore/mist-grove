// Captures VP1..VP6 from dev.html using real hardware WebGPU in headless Chrome via CDP (zero external deps)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const capDir = path.join(here, '.captures');
fs.mkdirSync(capDir, { recursive: true });

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) throw new Error('Chrome/Edge executable not found');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const rel = urlPath === '/' ? 'dev.html' : urlPath.replace(/^\/+/, '');
  const fp = path.join(here, rel);
  if (!fp.startsWith(here) || !fs.existsSync(fp)) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(fp);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

let chrome = null;
let tmpDir = null;
let ws = null;

try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/dev.html`;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-cdp-'));
  const args = [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--window-size=1920,1080',
    '--remote-debugging-port=0',
    `--user-data-dir=${tmpDir}`,
    'about:blank',
  ];

  chrome = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools WS URL:\n' + stderr)), 15000);
    const onData = (chunk) => {
      stderr += chunk.toString('utf8');
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    };
    chrome.stderr.on('data', onData);
    chrome.stdout.on('data', onData);
    chrome.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early (${code}):\n${stderr}`)); });
  });

  // Get page target WebSocket URL
  const u = new URL(wsUrl.trim());
  const httpBase = `http://${u.host}`;
  const targets = await (await fetch(`${httpBase}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error('No page target found in Chrome');

  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let nextId = 1;
  const pending = new Map();
  const errors = [];
  const logs = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const txt = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (!logs.includes(`[${msg.params.type}] ${txt}`)) {
        logs.push(`[${msg.params.type}] ${txt}`);
        console.log(`[chrome:${msg.params.type}]`, txt);
      }
      if (msg.params.type === 'error' && !errors.includes(txt)) errors.push(txt);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const ex = msg.params.exceptionDetails;
      const txt = ex.exception?.description || ex.text || 'Uncaught exception';
      errors.push(txt);
      console.error('[chrome:exception]', txt);
    }
  };

  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJS = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: baseUrl });

  // Wait for WebGPU world build & ready flag
  const t0 = Date.now();
  let ready = false, lastMsg = '';
  while (Date.now() - t0 < 30000) {
    const state = await evalJS(`(() => ({ ready: !!window.__MG?.ready, cls: document.body.className, msg: document.getElementById('s')?.textContent }))()`);
    if (state?.msg && state.msg !== lastMsg) { lastMsg = state.msg; console.log(`[stage ${(Date.now() - t0)}ms]`, state.cls, lastMsg); }
    if (state?.cls?.includes('e')) throw new Error(`Page failed to start: ${state.msg}\nErrors: ${errors.join('\n')}`);
    if (state?.ready) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error(`Timed out waiting for __MG.ready (last state=${lastMsg}, errors=${errors.join(' | ')})`);

  // Dismiss menu + corner button + CSS blur transition for crisp fullscreen renders
  await evalJS(`(() => { const c = document.getElementById('c'); c.style.transition = 'none'; document.body.className = 'g'; document.getElementById('o').style.display = 'none'; window.__MG.setTime(4.2); })()`);

  const adapterInfo = await evalJS(`window.__MG.adapterInfo`);
  console.log('Adapter:', JSON.stringify(adapterInfo));

  // Warm up ~25 frames so GPU timestamps accumulate
  const fStart = await evalJS(`window.__MG.frameId`);
  while ((await evalJS(`window.__MG.frameId`)) < fStart + 25) {
    await new Promise((r) => setTimeout(r, 40));
  }

  // Capture VP1..VP6
  for (let i = 0; i < 6; i++) {
    const poseInfo = await evalJS(`window.__MG.setPose(${i})`);
    const f0 = await evalJS(`window.__MG.frameId`);
    while ((await evalJS(`window.__MG.frameId`)) < f0 + 5) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(capDir, `vp${i + 1}.png`);
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log(`Captured vp${i + 1}.png`, JSON.stringify(poseInfo));
  }

  const stats = await evalJS(`window.__MG.getStats()`);
  console.log('Stats:', JSON.stringify(stats, null, 2));
  if (logs.length) console.log('Console logs:\n' + logs.join('\n'));
  if (errors.length) {
    console.error('Errors detected:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  if (ws) try { ws.close(); } catch {}
  if (chrome) try { chrome.kill('SIGKILL'); } catch {}
  server.close();
  if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
