const fs = require('node:fs');
const path = require('node:path');

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_BYTES = 512 * 1024;

function parseFrontmatter(content) {
  if (typeof content !== 'string' || !content.startsWith('---')) return null;
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/);
  if (!match) return null;
  const frontmatter = match[1];
  const readField = (field) => {
    const fieldMatch = frontmatter.match(new RegExp(`^${field}:\\s*["']?([^\\r\\n"']+)["']?\\s*$`, 'mi'));
    return fieldMatch ? fieldMatch[1].trim() : '';
  };
  return { name: readField('name'), description: readField('description') };
}

function validateSkillContent(content, expectedName) {
  const errors = [];
  const warnings = [];
  const bytes = Buffer.byteLength(content || '', 'utf8');
  if (!content || typeof content !== 'string') errors.push('SKILL.md 不能为空。');
  if (bytes > MAX_SKILL_BYTES) errors.push('SKILL.md 超过 512 KB 限制。');

  const metadata = parseFrontmatter(content || '');
  if (!metadata) {
    errors.push('缺少有效的 YAML frontmatter（文件必须以 --- 开始和结束）。');
  } else {
    if (!SKILL_NAME_RE.test(metadata.name)) errors.push('name 只能使用小写字母、数字和单连字符。');
    if (expectedName && metadata.name !== expectedName) errors.push(`frontmatter name 必须与目录名 ${expectedName} 一致。`);
    if (!metadata.description || metadata.description.length < 12) errors.push('description 至少需要 12 个字符并说明何时使用。');
  }

  const checks = [
    { re: /(?:忽略|无视|forget|ignore)\s*(?:此前|之前|previous|prior).{0,20}(?:指令|instructions?)/i, message: '检测到覆盖既有指令的表述。' },
    { re: /(?:(?:api[_ -]?key|password|token|密码|密钥).{0,40}(?:粘贴|发送|上传|paste|send|upload)|(?:粘贴|发送|上传|paste|send|upload).{0,40}(?:api[_ -]?key|password|token|密码|密钥))/i, message: '检测到索取或传输凭据的表述。' },
    { re: /(?:curl|wget|Invoke-WebRequest).{0,160}(?:\||;|&&|iex|Invoke-Expression|bash|sh\b)/i, message: '检测到下载并执行代码的高风险命令。' },
    { re: /<(?:!--)[\s\S]*?(?:ignore|忽略|system prompt|系统提示)[\s\S]*?-->/i, message: '检测到隐藏在 HTML 注释中的指令。' },
    { re: /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/u, message: '检测到不可见或双向控制字符。' },
    { re: /(?:~|%USERPROFILE%|C:\\Users\\[^\\]+)\\?\.(?:ssh|aws|config\\gh)/i, message: '检测到读取敏感凭据目录的指令。' }
  ];
  for (const check of checks) if (check.re.test(content || '')) warnings.push(check.message);

  const urls = [...new Set((content || '').match(/https?:\/\/[^\s)>"']+/gi) || [])];
  const untrustedUrls = urls.filter((url) => !/^https:\/\/(?:api-docs|platform)\.deepseek\.com(?:\/|$)/i.test(url));
  if (untrustedUrls.length) warnings.push(`包含外部网址：${untrustedUrls.slice(0, 3).join('、')}`);

  return { valid: errors.length === 0, errors, warnings, metadata, bytes };
}

function safeSkillPath(root, name) {
  if (!SKILL_NAME_RE.test(name)) throw new Error('无效的 skill 名称。');
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, name);
  if (path.dirname(candidate) !== resolvedRoot) throw new Error('skill 路径超出允许目录。');
  return candidate;
}

function listSkills(root, builtInNames = new Set()) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SKILL_NAME_RE.test(entry.name))
    .map((entry) => {
      const directory = safeSkillPath(root, entry.name);
      const enabledPath = path.join(directory, 'SKILL.md');
      const disabledPath = path.join(directory, 'SKILL.md.disabled');
      const enabled = fs.existsSync(enabledPath);
      const filePath = enabled ? enabledPath : disabledPath;
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
      const validation = validateSkillContent(content, entry.name);
      return {
        name: entry.name,
        description: validation.metadata?.description || '缺少说明',
        enabled,
        builtIn: builtInNames.has(entry.name),
        warnings: validation.warnings.length,
        errors: validation.errors.length
      };
    })
    .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name));
}

module.exports = {
  SKILL_NAME_RE,
  MAX_SKILL_BYTES,
  listSkills,
  parseFrontmatter,
  safeSkillPath,
  validateSkillContent
};
