const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const installerScript = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
const directoryPickerPatch = fs.readFileSync(path.join(root, 'build', 'directory-picker-browse.patch.yml'), 'utf8');

test('uses the neutral product name and does not package preinstalled skills', () => {
  assert.equal(packageJson.build.productName, '工作台');
  assert.equal(packageJson.build.nsis.shortcutName, '工作台');
  assert.equal(packageJson.build.extraResources.some((entry) => entry.to === 'legal-skills'), false);
  assert.equal(packageJson.build.win.icon, undefined);
});

test('contains first-run privacy acceptance and the AI output notice', () => {
  assert.match(html, /id="privacy-modal"/);
  assert.match(html, /id="privacy-consent"/);
  assert.match(html, /AI 生成，仅供辅助参考/);
  assert.match(html, /本产品并非 DeepSeek 官方产品/);
});

test('does not render a product logo in the desktop shell', () => {
  assert.doesNotMatch(html, /class="(?:window-app-icon|brand-mark|about-logo)"/);
});

test('does not expose the removed controlled browser feature', () => {
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
  assert.doesNotMatch(html, /controlled-browser|受控浏览器/);
  assert.doesNotMatch(preload, /controlled-browser|getControlledBrowser/);
});

test('does not expose case management', () => {
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
  assert.doesNotMatch(html, /page-cases|案件管理|case-modal|harness law/);
  assert.doesNotMatch(preload, /cases:|listCases|createCase|enterCase/);
});

test('uses an assisted Chinese installer with directory and desktop shortcut choices', () => {
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, false);
  assert.deepEqual(packageJson.build.nsis.installerLanguages, ['zh_CN']);
  assert.equal(packageJson.build.nsis.language, '2052');
  assert.match(installerScript, /customPageAfterChangeDir/);
  assert.match(installerScript, /覆盖安装时也可以更换程序目录/);
  assert.match(installerScript, /选择安装目录/);
  assert.match(installerScript, /选择工作目录/);
  assert.match(installerScript, /workspace-path\.txt/);
  assert.match(installerScript, /创建桌面快捷方式/);
  assert.match(installerScript, /Delete "\$newDesktopLink"/);
});

test('uses the in-app workspace browser in the desktop distribution', () => {
  assert.match(directoryPickerPatch, /dsh-host-directory-picker-browse/);
  assert.match(directoryPickerPatch, /dsh-client-ui-directory-picker-browse/);
  assert.equal(packageJson.build.extraResources.some((entry) => entry.to === 'directory-picker-browse.patch.yml'), true);
});
