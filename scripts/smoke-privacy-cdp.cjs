const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2] || 9334);
const screenshotPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const base = `http://127.0.0.1:${port}`;

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((item) => item.type === 'page' && /\/src\/renderer\/index\.html$/.test(item.url));
        if (target) return target;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('desktop renderer target missing');
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
  const app = connect(await waitForTarget());
  const state = await app.evaluate(`window.harnessDesktop.getState()`);
  assert.equal(state.productName, '工作台');
  assert.equal(state.privacy.accepted, false);
  assert.equal(state.harness.state, 'privacy-required');

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const visible = await app.evaluate(`!document.querySelector('#privacy-modal').classList.contains('hidden')`);
    if (visible) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const shell = await app.evaluate(`({
    title: document.title,
    brand: document.querySelector('.brand')?.textContent.trim(),
    nav: [...document.querySelectorAll('.nav-item')].map((item) => item.dataset.page),
    privacyVisible: !document.querySelector('#privacy-modal').classList.contains('hidden'),
    disclaimer: document.querySelector('.ai-disclaimer')?.textContent.trim(),
    logoCount: document.querySelectorAll('.window-app-icon, .brand-mark, .about-logo').length
  })`);
  assert.deepEqual(shell, {
    title: '工作台',
    brand: '工作台',
    nav: ['workbench', 'tokens', 'skills', 'api', 'about'],
    privacyVisible: true,
    disclaimer: 'AI 生成，仅供辅助参考',
    logoCount: 0
  });

  const skills = await app.evaluate(`window.harnessDesktop.listSkills()`);
  assert.deepEqual(skills, []);

  if (screenshotPath) {
    const screenshot = await app.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  }
  let afterAccept = null;
  if (process.argv[4] === 'full') {
    const acceptance = await app.evaluate(`window.harnessDesktop.acceptPrivacyPolicy()`);
    assert.equal(acceptance.accepted, true);
    afterAccept = await app.evaluate(`window.harnessDesktop.getState()`);
    assert.equal(afterAccept.privacy.accepted, true);
    assert.equal(afterAccept.harness.state, 'ready');
    assert.equal(afterAccept.rtk.available, true);
    assert.equal(afterAccept.rtk.telemetryDisabled, true);
  }
  app.close();
  console.log(JSON.stringify({
    ok: true,
    state: { productName: state.productName, privacy: state.privacy, harness: state.harness },
    shell,
    skills,
    afterAccept: afterAccept ? { privacy: afterAccept.privacy, harness: afterAccept.harness, rtk: afterAccept.rtk } : null
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
