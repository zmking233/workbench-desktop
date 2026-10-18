const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, webContents: electronWebContents } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { listSkills, safeSkillPath, validateSkillContent, SKILL_NAME_RE } = require('./lib/skills.cjs');
const { summarizeTokenUsage, usageFromProjections } = require('./lib/token-stats.cjs');
const { ensureRtkInstructions, inspectRtkRuntime, publicRtkStatus, withPrivateRtkEnvironment } = require('./lib/rtk-runtime.cjs');

const PRODUCT_NAME = '工作台';
const UPSTREAM_VERSION = '0.1.0-rc.6';
const PRIVACY_POLICY_VERSION = '2026-08-16.1';
const ALLOWED_EXTERNAL = new Set([
  'https://platform.deepseek.com/sign_in',
  'https://platform.deepseek.com/top_up',
  'https://platform.deepseek.com/api_keys',
  'https://api-docs.deepseek.com/'
]);

let mainWindow;
let harnessProcess;
let harnessUrl = '';
let harnessStatus = { state: 'privacy-required', message: '请先阅读并同意隐私政策' };
let rtkRuntimeStatus = { available: false, version: '0.45.0', reason: '尚未检查 RTK。' };

function userDataPath(...parts) { return path.join(app.getPath('userData'), ...parts); }
function settingsPath() { return userDataPath('desktop-settings.json'); }
function apiSecretPath() { return userDataPath('api-key.bin'); }
function runtimeLogPath() { return userDataPath('runtime.log'); }
function dshHomePath() { return userDataPath('dsh-home'); }
function defaultWorkspacePath() { return path.join(app.getPath('documents'), '工作台工作区'); }
function installerWorkspacePath() { return app.isPackaged ? path.join(process.resourcesPath, 'workspace-path.txt') : ''; }
function licensesPath() { return app.isPackaged ? path.join(process.resourcesPath, 'licenses') : path.join(app.getAppPath(), 'licenses'); }
function refreshRtkRuntime() {
  rtkRuntimeStatus = inspectRtkRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  });
  ensureRtkInstructions(dshHomePath(), rtkRuntimeStatus);
  return rtkRuntimeStatus;
}

function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function appendRuntimeLog(message) {
  try {
    ensureDir(path.dirname(runtimeLogPath()));
    const text = typeof message === 'string' ? message : message?.stack || String(message);
    fs.appendFileSync(runtimeLogPath(), `[${new Date().toISOString()}] ${text.replace(/\r?\n/g, '\n')}\n`, 'utf8');
  } catch {}
}
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch {
    try {
      const marker = fs.readFileSync(installerWorkspacePath());
      const text = (marker.includes(0) ? marker.toString('utf16le') : marker.toString('utf8')).replace(/^\uFEFF/, '').trim();
      if (text) return { workspace: path.resolve(text) };
    } catch {}
    return { workspace: defaultWorkspacePath() };
  }
}
function writeSettings(settings) {
  ensureDir(path.dirname(settingsPath()));
  fs.writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
function workspacePath() {
  const configured = readSettings().workspace || defaultWorkspacePath();
  ensureDir(configured);
  return path.resolve(configured);
}
function skillsRoot() {
  const root = path.join(workspacePath(), '.agents', 'skills');
  ensureDir(root);
  return root;
}
function privacyStatus() {
  const acceptance = readSettings().privacyAcceptance;
  return {
    accepted: acceptance?.version === PRIVACY_POLICY_VERSION,
    version: PRIVACY_POLICY_VERSION,
    acceptedAt: acceptance?.acceptedAt || null
  };
}
function audit(action, skill, details = {}) {
  ensureDir(userDataPath());
  const record = { timestamp: new Date().toISOString(), action, skill, ...details };
  fs.appendFileSync(userDataPath('skill-audit.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
}
function decryptApiKey() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(apiSecretPath())) return '';
    return safeStorage.decryptString(fs.readFileSync(apiSecretPath()));
  } catch { return ''; }
}
function apiStatus() {
  const key = decryptApiKey();
  return { configured: Boolean(key), suffix: key ? key.slice(-4) : '' };
}
function broadcastHarnessStatus(status) {
  harnessStatus = status;
  appendRuntimeLog(`harness:${status.state} ${status.message}`);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('harness:status', { ...status, url: harnessUrl });
}
function choosePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
function cliPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  return require.resolve('@deepseek-ai/dsh/lib/bin.js');
}
function directoryPickerPatchPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'directory-picker-browse.patch.yml')
    : path.join(app.getAppPath(), 'build', 'directory-picker-browse.patch.yml');
}
async function waitForHarness(url, processRef) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (processRef !== harnessProcess) return false;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok || response.status < 500) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}
async function startHarness() {
  if (!privacyStatus().accepted) {
    broadcastHarnessStatus({ state: 'privacy-required', message: '请先阅读并同意隐私政策' });
    return;
  }
  stopHarness();
  broadcastHarnessStatus({ state: 'starting', message: '正在启动 AI 工作台…' });
  const port = await choosePort();
  harnessUrl = `http://127.0.0.1:${port}`;
  ensureDir(dshHomePath());
  refreshRtkRuntime();
  let env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: dshHomePath(),
    DEEPSEEK_API_KEY: decryptApiKey()
  };
  env = withPrivateRtkEnvironment(env, rtkRuntimeStatus, app.getPath('userData'));
  if (rtkRuntimeStatus.available) {
    ensureDir(path.dirname(env.RTK_DB_PATH));
    appendRuntimeLog(`rtk ${rtkRuntimeStatus.version} ready; telemetry disabled; private PATH enabled`);
  } else appendRuntimeLog(`rtk unavailable: ${rtkRuntimeStatus.reason}`);
  const child = spawn(process.execPath, [
    '--expose-internals', cliPath(), 'web',
    '--patch', directoryPickerPatchPath(),
    '--port', String(port)
  ], {
    cwd: workspacePath(),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  appendRuntimeLog(`spawn ${process.execPath} --expose-internals <dsh> web --port ${port}; cwd=${workspacePath()}`);
  harnessProcess = child;
  child.stdout.on('data', (chunk) => { console.log(`[dsh] ${chunk}`); appendRuntimeLog(`[dsh:stdout] ${String(chunk).trim()}`); });
  child.stderr.on('data', (chunk) => { console.error(`[dsh] ${chunk}`); appendRuntimeLog(`[dsh:stderr] ${String(chunk).trim()}`); });
  child.on('error', (error) => { appendRuntimeLog(error); broadcastHarnessStatus({ state: 'error', message: `启动失败：${error.message}` }); });
  child.on('exit', (code) => {
    appendRuntimeLog(`dsh exit code=${code ?? 'unknown'}`);
    if (harnessProcess === child && !app.isQuitting) broadcastHarnessStatus({ state: 'error', message: `AI 工作台已停止（代码 ${code ?? '未知'}）` });
  });
  const ready = await waitForHarness(harnessUrl, child);
  if (ready && harnessProcess === child) broadcastHarnessStatus({ state: 'ready', message: 'AI 工作台已就绪' });
  else if (harnessProcess === child) broadcastHarnessStatus({ state: 'error', message: 'AI 工作台启动超时，请点击重启。' });
}
function stopHarness() {
  if (!harnessProcess) return;
  const child = harnessProcess;
  harnessProcess = null;
  try { child.kill(); } catch {}
}

async function harnessRpc(method, payload) {
  if (harnessStatus.state !== 'ready' || !harnessUrl.startsWith('http://127.0.0.1:')) {
    throw new Error('AI 工作台尚未就绪。');
  }
  const rpcId = crypto.randomUUID();
  const response = await fetch(`${harnessUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`读取工作台数据失败（HTTP ${response.status}）。`);
  const envelope = await response.json();
  if (envelope?.rpcId !== rpcId) throw new Error('工作台响应校验失败。');
  if (!envelope?.result?.ok) throw new Error(envelope?.result?.error?.message || '工作台拒绝了请求。');
  return envelope.result.value;
}

async function loadTokenStats() {
  const listed = await harnessRpc('session.list', {});
  const items = Array.isArray(listed?.items) ? listed.items : [];
  const rows = [];
  for (const item of items) {
    let projections = item.projections;
    if (!projections?.values?.tokenUsage && !item.blank) {
      try {
        const history = await harnessRpc('session.history', { sessionId: item.sessionId, maxMessages: 1 });
        projections = history?.projections;
      } catch (error) {
        appendRuntimeLog(`token stats skipped session ${item.sessionId}: ${error.message}`);
      }
    }
    rows.push({
      sessionId: item.sessionId,
      title: projections?.values?.title,
      updatedAt: item.updatedAt,
      usage: usageFromProjections(projections)
    });
  }
  return { ...summarizeTokenUsage(rows), measuredAt: Date.now(), source: 'DeepSeek Harness tokenUsage projection' };
}

function attachNavigationGuards(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:')) event.preventDefault();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    title: PRODUCT_NAME,
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#202124',
      height: 36
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => attachNavigationGuards(guest));
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!app.isQuitting && process.platform !== 'darwin') app.quit();
  });
}

function editableWebContents() {
  const focused = electronWebContents.getFocusedWebContents();
  if (focused && !focused.isDestroyed()) return focused;
  return mainWindow?.webContents;
}

function setApplicationZoom(nextFactor) {
  const factor = Math.min(2, Math.max(0.6, nextFactor));
  for (const contents of electronWebContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    try { contents.setZoomFactor(factor); } catch {}
  }
  return factor;
}

async function runWindowCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口当前不可用。');
  const editMethods = {
    undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', 'select-all': 'selectAll'
  };
  if (editMethods[command]) {
    const contents = editableWebContents();
    contents?.[editMethods[command]]?.();
    return { ok: true };
  }
  if (command === 'open-workspace') {
    const error = await shell.openPath(workspacePath());
    if (error) throw new Error(`无法打开工作区：${error}`);
  } else if (command === 'reload') mainWindow.webContents.reload();
  else if (command === 'zoom-in') setApplicationZoom(mainWindow.webContents.getZoomFactor() + 0.1);
  else if (command === 'zoom-out') setApplicationZoom(mainWindow.webContents.getZoomFactor() - 0.1);
  else if (command === 'zoom-reset') setApplicationZoom(1);
  else if (command === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen());
  else if (command === 'minimize') mainWindow.minimize();
  else if (command === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (command === 'close') mainWindow.close();
  else throw new Error('不支持的窗口命令。');
  return { ok: true, maximized: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false };
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => ({
    productName: PRODUCT_NAME,
    appVersion: app.getVersion(),
    upstreamVersion: UPSTREAM_VERSION,
    workspace: workspacePath(),
    harness: { ...harnessStatus, url: harnessUrl },
    rtk: publicRtkStatus(rtkRuntimeStatus),
    api: apiStatus()
    ,privacy: privacyStatus()
  }));
  ipcMain.handle('app:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择工作区', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    writeSettings({ ...readSettings(), workspace: result.filePaths[0] });
    await startHarness();
    return { canceled: false, workspace: workspacePath() };
  });
  ipcMain.handle('harness:restart', async () => { await startHarness(); return { ok: true, url: harnessUrl }; });
  ipcMain.handle('app:open-external', async (_event, url) => {
    if (!ALLOWED_EXTERNAL.has(url)) throw new Error('该网址不在允许列表中。');
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('app:open-licenses', async () => { await shell.openPath(licensesPath()); return { ok: true }; });
  ipcMain.handle('window:command', (_event, command) => runWindowCommand(String(command || '')));
  ipcMain.handle('tokens:get-stats', () => loadTokenStats());

  ipcMain.handle('privacy:accept', async () => {
    const acceptedAt = new Date().toISOString();
    writeSettings({ ...readSettings(), privacyAcceptance: { version: PRIVACY_POLICY_VERSION, acceptedAt } });
    try { await startHarness(); }
    catch (error) { appendRuntimeLog(error); broadcastHarnessStatus({ state: 'error', message: `启动失败：${error.message}` }); }
    return { ok: true, accepted: true, version: PRIVACY_POLICY_VERSION, acceptedAt };
  });
  ipcMain.handle('privacy:decline', () => {
    setImmediate(() => app.quit());
    return { ok: true };
  });

  ipcMain.handle('skills:list', () => listSkills(skillsRoot()));
  ipcMain.handle('skills:read', (_event, name) => {
    const directory = safeSkillPath(skillsRoot(), name);
    const enabled = fs.existsSync(path.join(directory, 'SKILL.md'));
    const file = path.join(directory, enabled ? 'SKILL.md' : 'SKILL.md.disabled');
    if (!fs.existsSync(file)) throw new Error('找不到该 skill。');
    const content = fs.readFileSync(file, 'utf8');
    return { name, enabled, content, validation: validateSkillContent(content, name), builtIn: false };
  });
  ipcMain.handle('skills:create', (_event, { name, description }) => {
    if (!SKILL_NAME_RE.test(name)) throw new Error('名称只能使用小写字母、数字和单连字符。');
    const directory = safeSkillPath(skillsRoot(), name);
    if (fs.existsSync(directory)) throw new Error('同名 skill 已存在。');
    ensureDir(directory);
    const safeDescription = String(description || '').replace(/[\r\n]/g, ' ').trim();
    const content = `---\nname: ${name}\ndescription: ${safeDescription}\n---\n\n# ${name}\n\n## 适用范围\n\n说明本 Skill 何时使用，以及不适用的边界。\n\n## 工作流\n\n1. 核对用户目标、时间点和已有材料。\n2. 缺少关键输入时先提问，不静默假设。\n3. 按步骤执行任务，并清楚区分已知信息、推测和待确认事项。\n4. 涉及可能变化的信息时，先查证可靠来源并标明日期。\n5. 在执行对外发送、删除、覆盖或其他重要操作前请求用户确认。\n\n## 输出\n\n- 结果摘要\n- 已知信息与假设\n- 工作成果\n- 风险、缺口与下一步\n\n## 限制\n\n本 Skill 仅提供工作辅助，重要结果应由用户核验。\n`;
    const validation = validateSkillContent(content, name);
    if (!validation.valid) { fs.rmSync(directory, { recursive: true, force: true }); throw new Error(validation.errors.join('；')); }
    fs.writeFileSync(path.join(directory, 'SKILL.md'), content, 'utf8');
    audit('create', name);
    return { ok: true, name };
  });
  ipcMain.handle('skills:save', (_event, { name, content, acknowledgeWarnings }) => {
    const directory = safeSkillPath(skillsRoot(), name);
    const enabled = fs.existsSync(path.join(directory, 'SKILL.md'));
    const file = path.join(directory, enabled ? 'SKILL.md' : 'SKILL.md.disabled');
    if (!fs.existsSync(file)) throw new Error('找不到该 skill。');
    const validation = validateSkillContent(content, name);
    if (!validation.valid) return { ok: false, errors: validation.errors, warnings: validation.warnings };
    if (validation.warnings.length && !acknowledgeWarnings) return { ok: false, requiresConfirmation: true, warnings: validation.warnings };
    fs.writeFileSync(file, content, 'utf8');
    audit('save', name, { warningCount: validation.warnings.length });
    return { ok: true, validation };
  });
  ipcMain.handle('skills:set-enabled', (_event, { name, enabled }) => {
    const directory = safeSkillPath(skillsRoot(), name);
    const from = path.join(directory, enabled ? 'SKILL.md.disabled' : 'SKILL.md');
    const to = path.join(directory, enabled ? 'SKILL.md' : 'SKILL.md.disabled');
    if (!fs.existsSync(from)) throw new Error(enabled ? '该 skill 已启用或文件缺失。' : '该 skill 已停用或文件缺失。');
    fs.renameSync(from, to);
    audit(enabled ? 'enable' : 'disable', name);
    return { ok: true, enabled };
  });
  ipcMain.handle('skills:delete', async (_event, { name, confirmed }) => {
    if (!confirmed) return { ok: false, requiresConfirmation: true };
    const directory = safeSkillPath(skillsRoot(), name);
    if (!fs.existsSync(directory)) throw new Error('找不到该 skill。');
    await shell.trashItem(directory);
    audit('trash', name);
    return { ok: true, recoverable: true };
  });
  ipcMain.handle('skills:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择包含 SKILL.md 的文件夹', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const source = result.filePaths[0];
    const sourceFile = fs.existsSync(path.join(source, 'SKILL.md')) ? path.join(source, 'SKILL.md') : path.join(source, 'SKILL.md.disabled');
    if (!fs.existsSync(sourceFile)) throw new Error('所选文件夹没有 SKILL.md。');
    const content = fs.readFileSync(sourceFile, 'utf8');
    const validation = validateSkillContent(content);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    if (validation.warnings.length) throw new Error(`安全检查未通过：${validation.warnings.join('；')}。请先人工审查并在编辑器中创建。`);
    const name = validation.metadata.name;
    const target = safeSkillPath(skillsRoot(), name);
    if (fs.existsSync(target)) throw new Error('同名 skill 已存在，请先改名或删除旧版本。');
    fs.cpSync(source, target, { recursive: true, errorOnExist: true });
    audit('import', name, { source });
    return { canceled: false, ok: true, name };
  });
  ipcMain.handle('skills:export', async (_event, name) => {
    const source = safeSkillPath(skillsRoot(), name);
    if (!fs.existsSync(source)) throw new Error('找不到该 skill。');
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择导出位置', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const target = path.join(result.filePaths[0], name);
    if (fs.existsSync(target)) throw new Error('导出位置已有同名文件夹。');
    fs.cpSync(source, target, { recursive: true, errorOnExist: true });
    audit('export', name, { target });
    return { canceled: false, ok: true, target };
  });

  ipcMain.handle('api:status', () => apiStatus());
  ipcMain.handle('api:save-key', async (_event, rawKey) => {
    const key = String(rawKey || '').trim();
    if (!/^sk-[A-Za-z0-9_-]{12,}$/.test(key)) throw new Error('API Key 格式不正确，应以 sk- 开头。');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用，已拒绝明文保存。');
    ensureDir(path.dirname(apiSecretPath()));
    fs.writeFileSync(apiSecretPath(), safeStorage.encryptString(key));
    await startHarness();
    return { ok: true, status: apiStatus() };
  });
  ipcMain.handle('api:clear-key', async () => {
    if (fs.existsSync(apiSecretPath())) fs.unlinkSync(apiSecretPath());
    await startHarness();
    return { ok: true, status: apiStatus() };
  });
}

app.isQuitting = false;
app.whenReady().then(async () => {
  ensureDir(app.getPath('userData'));
  ensureDir(workspacePath());
  refreshRtkRuntime();
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  if (privacyStatus().accepted) {
    try { await startHarness(); }
    catch (error) { appendRuntimeLog(error); broadcastHarnessStatus({ state: 'error', message: `启动失败：${error.message}` }); }
  } else broadcastHarnessStatus({ state: 'privacy-required', message: '请先阅读并同意隐私政策' });
}).catch(appendRuntimeLog);
app.on('before-quit', () => {
  app.isQuitting = true;
  stopHarness();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
