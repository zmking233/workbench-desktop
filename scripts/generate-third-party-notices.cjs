const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const modulesRoot = path.join(projectRoot, 'node_modules');
const outputFile = path.join(projectRoot, 'licenses', 'THIRD-PARTY-NOTICES.txt');
const licenseNames = /^(?:licen[sc]e|copying|notice)(?:\.[^.]+)?$/i;
const packages = new Map();

function visitNodeModules(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join(root, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) visitPackage(path.join(root, entry.name, scoped.name));
      }
    } else visitPackage(path.join(root, entry.name));
  }
}
function visitPackage(directory) {
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.name || !manifest.version) return;
    const key = `${manifest.name}@${manifest.version}`;
    if (!packages.has(key)) {
      const licenseFiles = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && licenseNames.test(entry.name))
        .map((entry) => path.join(directory, entry.name));
      const text = licenseFiles.map((file) => {
        const value = fs.readFileSync(file, 'utf8');
        return value.length <= 200000 ? value.trim() : '[许可证文件过大，随应用原文件提供]';
      }).join('\n\n');
      packages.set(key, {
        name: manifest.name,
        version: manifest.version,
        license: typeof manifest.license === 'string' ? manifest.license : JSON.stringify(manifest.license || '未声明'),
        repository: typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url || '',
        text
      });
    }
    visitNodeModules(path.join(directory, 'node_modules'));
  } catch (error) {
    console.warn(`跳过无法读取的依赖：${directory} (${error.message})`);
  }
}

visitNodeModules(modulesRoot);
const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const generatedAt = new Date().toISOString();
let output = `THIRD-PARTY SOFTWARE NOTICES\nGenerated: ${generatedAt}\nPackages: ${rows.length}\n\n`;
for (const item of rows) {
  output += `${'='.repeat(78)}\n${item.name}@${item.version}\nDeclared license: ${item.license}\n`;
  if (item.repository) output += `Repository: ${item.repository}\n`;
  output += `\n${item.text || '[包内未发现独立许可证文件；请按 package.json 声明复核。]'}\n\n`;
}
const rtkManifestPath = path.join(projectRoot, 'vendor', 'rtk', 'manifest.json');
if (fs.existsSync(rtkManifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(rtkManifestPath, 'utf8'));
  const license = fs.readFileSync(path.join(projectRoot, 'vendor', 'rtk', 'LICENSE'), 'utf8').trim();
  const disclaimer = fs.readFileSync(path.join(projectRoot, 'vendor', 'rtk', 'DISCLAIMER.md'), 'utf8').trim();
  output += `${'='.repeat(78)}\n${manifest.name}@${manifest.version}\nDeclared license: ${manifest.license}\n`;
  output += `Source: ${manifest.source}\nArchive SHA-256: ${manifest.archiveSha256}\nBinary SHA-256: ${manifest.binarySha256}\n\n`;
  output += `${license}\n\n${disclaimer}\n\n`;
}
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, output, 'utf8');
const digest = crypto.createHash('sha256').update(output).digest('hex');
console.log(`已生成 ${path.relative(projectRoot, outputFile)}（${rows.length} 个依赖，SHA-256 ${digest}）`);
