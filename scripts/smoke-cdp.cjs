const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2] || 9333);
const base = `http://127.0.0.1:${port}`;

async function targets() {
  const response = await fetch(`${base}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return response.json();
}

function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return {
    async command(method, params = {}) {
      await ready;
      const id = ++nextId;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    async evaluate(expression) {
      const response = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result.value;
    },
    close() { socket.close(); }
  };
}

(async () => {
  const appTarget = (await targets()).find((target) => target.type === 'page' && /\/src\/renderer\/index\.html$/.test(target.url));
  assert.ok(appTarget, 'desktop renderer target missing');
  const app = connect(appTarget);

  console.log('smoke: renderer bridge');
  const shell = await app.evaluate(`({
    nav: [...document.querySelectorAll('.nav-item')].map((item) => item.dataset.page),
    node: typeof require,
    bridge: typeof window.harnessDesktop
  })`);
  assert.deepEqual(shell.nav.slice(0, 3), ['workbench', 'tokens', 'skills']);
  assert.equal(shell.node, 'undefined');
  assert.equal(shell.bridge, 'object');
  assert.equal(await app.evaluate(`Boolean(document.querySelector('#page-browser'))`), false);
  assert.equal(await app.evaluate(`typeof window.harnessDesktop.browserNavigate`), 'undefined');

  console.log('smoke: RTK state');
  const appState = await app.evaluate(`window.harnessDesktop.getState()`);
  assert.equal(appState.rtk.available, true);
  assert.equal(appState.rtk.version, '0.45.0');
  assert.equal(appState.rtk.telemetryDisabled, true);
  assert.equal(appState.rtk.privateRuntime, true);

  console.log('smoke: token stats');
  const stats = await app.evaluate(`window.harnessDesktop.getTokenStats()`);
  assert.equal(typeof stats.totals.totalTokens, 'number');
  assert.ok(Array.isArray(stats.sessions));

  await app.evaluate(`showPage('workbench'); [...document.querySelectorAll('.app-menu-trigger')].find((item) => item.textContent === '视图').click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const screenshotPath = process.argv[3];
  if (screenshotPath) {
    const screenshot = await app.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.resolve(screenshotPath), Buffer.from(screenshot.data, 'base64'));
  }

  app.close();
  console.log(JSON.stringify({ ok: true, stats, rtk: appState.rtk }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
