const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');
const {
  RTK_BINARY_SHA256,
  RTK_VERSION,
  ensureRtkInstructions,
  inspectRtkRuntime,
  updateManagedInstructions,
  withPrivateRtkEnvironment
} = require('../src/lib/rtk-runtime.cjs');

const tempRoots = [];
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function makeTemp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-rtk-test-'));
  tempRoots.push(root);
  return root;
}

test('bundled RTK has the pinned version and checksum', () => {
  const appPath = path.resolve(__dirname, '..');
  const runtime = inspectRtkRuntime({ isPackaged: false, appPath, resourcesPath: '' });
  assert.equal(runtime.available, true);
  assert.equal(runtime.version, RTK_VERSION);
  assert.equal(runtime.sha256, RTK_BINARY_SHA256);
  const result = spawnSync(runtime.binaryPath, ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`rtk ${RTK_VERSION.replaceAll('.', '\\.')}`));
});

test('private RTK environment does not replace the system PATH or enable telemetry', () => {
  const userData = makeTemp();
  const runtime = { available: true, binaryPath: 'C:\\Harness\\resources\\rtk\\rtk.exe' };
  const env = withPrivateRtkEnvironment({ Path: 'C:\\Windows\\System32' }, runtime, userData);
  assert.equal(env.Path, `C:\\Harness\\resources\\rtk${path.delimiter}C:\\Windows\\System32`);
  assert.equal(env.RTK_TELEMETRY_DISABLED, '1');
  assert.equal(env.RTK_TEE, '0');
  assert.equal(env.RTK_DB_PATH, path.join(userData, 'rtk', 'history.db'));
});

test('managed RTK instructions preserve unrelated Harness instructions', () => {
  const original = '# 用户设置\n\n请保留这一段。\n';
  const first = updateManagedInstructions(original, true);
  const second = updateManagedInstructions(first, true);
  assert.equal(first, second);
  assert.match(first, /请保留这一段/);
  assert.match(first, /RTK 0\.45\.0/);
  const removed = updateManagedInstructions(first, false);
  assert.equal(removed, original);
});

test('instruction file is created inside the private DSH home', () => {
  const dshHome = makeTemp();
  const target = ensureRtkInstructions(dshHome, { available: true, version: RTK_VERSION });
  assert.equal(target, path.join(dshHome, 'AGENTS.md'));
  assert.match(fs.readFileSync(target, 'utf8'), /不要运行 `rtk init`/);
});
