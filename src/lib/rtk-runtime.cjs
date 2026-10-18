const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RTK_VERSION = '0.45.0';
const RTK_BINARY_SHA256 = '888ecfcc7ca6ceaf9170cf95027d196d6010c7d1a1892b3662b4bb61f18a3618';
const MANAGED_START = '<!-- harness-managed-rtk:start -->';
const MANAGED_END = '<!-- harness-managed-rtk:end -->';

function rtkBinaryPath({ isPackaged, resourcesPath, appPath }) {
  return isPackaged
    ? path.join(resourcesPath, 'rtk', 'rtk.exe')
    : path.join(appPath, 'vendor', 'rtk', 'rtk.exe');
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function inspectRtkRuntime(options) {
  const binaryPath = rtkBinaryPath(options);
  if (!fs.existsSync(binaryPath)) {
    return { available: false, version: RTK_VERSION, reason: '未找到内置 RTK 运行文件。' };
  }
  try {
    const digest = sha256File(binaryPath);
    if (digest !== RTK_BINARY_SHA256) {
      return { available: false, version: RTK_VERSION, reason: 'RTK 完整性校验失败。', sha256: digest };
    }
    return {
      available: true,
      version: RTK_VERSION,
      binaryPath,
      sha256: digest,
      telemetryDisabled: true,
      privateRuntime: true
    };
  } catch (error) {
    return { available: false, version: RTK_VERSION, reason: `无法校验 RTK：${error.message}` };
  }
}

function withPrivateRtkEnvironment(baseEnv, runtime, userDataPath) {
  const env = { ...baseEnv };
  if (!runtime?.available) return env;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
  const inheritedPath = String(env[pathKey] || '');
  env[pathKey] = `${path.dirname(runtime.binaryPath)}${path.delimiter}${inheritedPath}`;
  env.RTK_TELEMETRY_DISABLED = '1';
  env.RTK_DB_PATH = path.join(userDataPath, 'rtk', 'history.db');
  env.RTK_TEE = '0';
  return env;
}

function managedInstructions(version = RTK_VERSION) {
  return `${MANAGED_START}
# 内置命令输出优化

本桌面应用私有内置 RTK ${version}，命令 \`rtk\` 已加入当前 AI 工作台的 PATH。它只用于压缩冗长的外部命令输出，不是法律工作 Skill。

- 对 RTK 明确支持的外部工具使用前缀，例如：\`rtk git status\`、\`rtk npm test\`、\`rtk npx tsc --noEmit\`、\`rtk rg -n "关键词" .\`。
- 不要给 PowerShell cmdlet、别名、语言结构或内置命令加 \`rtk\` 前缀；\`Get-ChildItem\`、\`Get-Content\`、\`Select-String\`、\`Test-Path\`、\`Copy-Item\` 等应直接运行。
- 不确定兼容性时先运行 \`rtk --help\`，或直接使用原命令。
- 如果过滤结果缺少排错细节或 RTK 执行失败，立即直接重跑原始外部命令。
- 不要运行 \`rtk init\`、\`rtk telemetry enable\`，也不要修改用户的全局 RTK 配置。本应用已在进程环境中强制关闭 RTK 遥测。
${MANAGED_END}`;
}

function updateManagedInstructions(existing, enabled, version = RTK_VERSION) {
  const start = MANAGED_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const end = MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutManaged = String(existing || '')
    .replace(new RegExp(`(?:\\r?\\n)*${start}[\\s\\S]*?${end}(?:\\r?\\n)*`, 'g'), '\n')
    .trim();
  if (!enabled) return withoutManaged ? `${withoutManaged}\n` : '';
  return `${withoutManaged ? `${withoutManaged}\n\n` : ''}${managedInstructions(version)}\n`;
}

function ensureRtkInstructions(dshHome, runtime) {
  fs.mkdirSync(dshHome, { recursive: true });
  const target = path.join(dshHome, 'AGENTS.md');
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const next = updateManagedInstructions(existing, Boolean(runtime?.available), runtime?.version || RTK_VERSION);
  if (next !== existing) fs.writeFileSync(target, next, 'utf8');
  return target;
}

function publicRtkStatus(runtime) {
  return {
    available: Boolean(runtime?.available),
    version: runtime?.version || RTK_VERSION,
    telemetryDisabled: Boolean(runtime?.available && runtime?.telemetryDisabled),
    privateRuntime: Boolean(runtime?.available && runtime?.privateRuntime),
    reason: runtime?.available ? '' : runtime?.reason || 'RTK 当前不可用。'
  };
}

module.exports = {
  MANAGED_END,
  MANAGED_START,
  RTK_BINARY_SHA256,
  RTK_VERSION,
  ensureRtkInstructions,
  inspectRtkRuntime,
  managedInstructions,
  publicRtkStatus,
  rtkBinaryPath,
  sha256File,
  updateManagedInstructions,
  withPrivateRtkEnvironment
};
