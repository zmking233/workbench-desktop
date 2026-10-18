const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let appState;
let selectedSkill = null;
let toastTimer;
let currentPage = 'workbench';
let privacyReviewOnly = false;

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 3200);
}
function messageOf(error) { return error?.message || String(error); }
function closeAppMenus() {
  $$('.app-menu').forEach((menu) => {
    menu.classList.remove('open');
    menu.querySelector('.app-menu-trigger').setAttribute('aria-expanded', 'false');
    menu.querySelector('.app-menu-dropdown').classList.add('hidden');
  });
}
function openAppMenu(menu) {
  const wasOpen = menu.classList.contains('open');
  closeAppMenus();
  if (wasOpen) return;
  menu.classList.add('open');
  menu.querySelector('.app-menu-trigger').setAttribute('aria-expanded', 'true');
  menu.querySelector('.app-menu-dropdown').classList.remove('hidden');
}
async function chooseWorkspaceFromUi() {
  try {
    const result = await window.harnessDesktop.chooseWorkspace();
    if (!result.canceled) { $('#workspace-label').textContent = result.workspace; appState.workspace = result.workspace; toast('工作区已切换。'); }
  } catch (error) { toast(messageOf(error), true); }
}
async function restartHarnessFromUi() {
  try { await window.harnessDesktop.restartHarness(); }
  catch (error) { toast(messageOf(error), true); }
}
function showPage(page) {
  currentPage = page;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  $$('.page').forEach((item) => item.classList.toggle('active', item.id === `page-${page}`));
  if (page === 'skills') loadSkills();
  if (page === 'api') refreshApiStatus();
  if (page === 'tokens') refreshTokenStats();
}
function applyHarnessStatus(status) {
  const badge = $('#runtime-status');
  badge.className = `runtime-status ${status.state}`;
  badge.querySelector('span').textContent = status.message;
  const placeholder = $('#harness-placeholder');
  const view = $('#harness-view');
  if (status.state === 'ready' && status.url) {
    if (view.src !== status.url) view.src = status.url;
    view.classList.add('ready');
    placeholder.style.display = 'none';
  } else {
    view.classList.remove('ready');
    placeholder.style.display = 'grid';
    placeholder.querySelector('h2').textContent = status.state === 'error' ? '工作台暂时不可用' : '正在准备本地工作台';
    placeholder.querySelector('p').textContent = status.message;
  }
}
function openPrivacyPolicy(reviewOnly = false) {
  privacyReviewOnly = reviewOnly;
  $('#privacy-consent').checked = false;
  $('#accept-privacy').disabled = true;
  $('#privacy-consent-row').classList.toggle('hidden', reviewOnly);
  $('#privacy-first-run-actions').classList.toggle('hidden', reviewOnly);
  $('#close-privacy-policy').classList.toggle('hidden', !reviewOnly);
  $('#privacy-modal').classList.remove('hidden');
  setTimeout(() => $('#privacy-content')?.focus(), 0);
}
function closePrivacyPolicy() {
  if (!privacyReviewOnly) return;
  $('#privacy-modal').classList.add('hidden');
}
function renderValidation(validation) {
  const box = $('#skill-validation');
  const items = [...(validation?.errors || []), ...(validation?.warnings || [])];
  if (!items.length) { box.classList.add('hidden'); return; }
  box.textContent = items.join('；');
  box.className = `validation-box${validation.errors?.length ? ' error' : ''}`;
}
async function loadSkills(reselect = selectedSkill?.name) {
  try {
    const skills = await window.harnessDesktop.listSkills();
    $('#skill-count').textContent = skills.length;
    const list = $('#skills-list');
    list.replaceChildren();
    for (const skill of skills) {
      const button = document.createElement('button');
      button.className = `skill-row${reselect === skill.name ? ' active' : ''}`;
      const name = document.createElement('strong');
      name.textContent = skill.name;
      const description = document.createElement('p');
      description.textContent = skill.description;
      const tag = document.createElement('span');
      tag.className = `tag${skill.enabled ? '' : ' off'}`;
    tag.textContent = skill.enabled ? '已启用' : '已停用';
      button.append(name, description, tag);
      button.addEventListener('click', () => openSkill(skill.name));
      list.append(button);
    }
    if (!skills.length) { $('#skill-empty').classList.remove('hidden'); $('#skill-editor').classList.add('hidden'); }
  } catch (error) { toast(messageOf(error), true); }
}
async function openSkill(name) {
  try {
    selectedSkill = await window.harnessDesktop.readSkill(name);
    $('#skill-empty').classList.add('hidden');
    $('#skill-editor').classList.remove('hidden');
    $('#skill-name').textContent = selectedSkill.name;
    $('#skill-kind').textContent = '自定义 Skill';
    $('#skill-content').value = selectedSkill.content;
    $('#skill-enabled').checked = selectedSkill.enabled;
    renderValidation(selectedSkill.validation);
    await loadSkills(name);
  } catch (error) { toast(messageOf(error), true); }
}
async function saveSkill(acknowledgeWarnings = false) {
  if (!selectedSkill) return;
  try {
    const result = await window.harnessDesktop.saveSkill(selectedSkill.name, $('#skill-content').value, acknowledgeWarnings);
    if (result.requiresConfirmation) {
      const accepted = window.confirm(`安全检查提示：\n\n${result.warnings.join('\n')}\n\n你已人工审查并仍要保存吗？`);
      if (accepted) return saveSkill(true);
      return;
    }
    if (!result.ok) { renderValidation(result); toast(result.errors.join('；'), true); return; }
    selectedSkill = await window.harnessDesktop.readSkill(selectedSkill.name);
    renderValidation(selectedSkill.validation);
    await loadSkills(selectedSkill.name);
    toast('Skill 已保存。新会话将使用最新内容。');
  } catch (error) { toast(messageOf(error), true); }
}
async function refreshApiStatus() {
  const status = await window.harnessDesktop.getApiStatus();
  $('#api-status-text').textContent = status.configured ? `已安全保存（末四位 ${status.suffix}）` : '尚未配置 API Key';
  $('#clear-api-key').style.display = status.configured ? 'block' : 'none';
}

const tokenNumber = new Intl.NumberFormat('zh-CN');
function formatTokens(value) { return tokenNumber.format(Number(value) || 0); }
async function refreshTokenStats() {
  const button = $('#refresh-token-stats');
  button.disabled = true;
  button.textContent = '读取中…';
  try {
    const stats = await window.harnessDesktop.getTokenStats();
    $('#token-total').textContent = formatTokens(stats.totals.totalTokens);
    $('#token-input').textContent = formatTokens(stats.totals.inputTokens);
    $('#token-output').textContent = formatTokens(stats.totals.outputTokens);
    $('#token-cache-read').textContent = formatTokens(stats.totals.cacheReadTokens);
    $('#token-session-count').textContent = `${stats.sessionCount} 个会话`;
    $('#token-updated').textContent = `更新于 ${new Date(stats.measuredAt).toLocaleString('zh-CN')}`;
    const list = $('#token-session-list');
    list.replaceChildren();
    if (!stats.sessions.length) {
      const empty = document.createElement('div');
      empty.className = 'token-empty';
      empty.textContent = '暂无可统计的用量记录。完成一次模型调用后再刷新。';
      list.append(empty);
    }
    for (const row of stats.sessions) {
      const item = document.createElement('div');
      item.className = 'token-table-row';
      const title = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = row.title;
      const small = document.createElement('small');
      small.textContent = row.updatedAt ? new Date(row.updatedAt).toLocaleString('zh-CN') : row.sessionId.slice(0, 8);
      title.append(strong, small);
      item.append(title);
      for (const value of [row.inputTokens, row.cacheReadTokens, row.outputTokens, row.totalTokens]) {
        const cell = document.createElement('span');
        cell.textContent = formatTokens(value);
        item.append(cell);
      }
      list.append(item);
    }
  } catch (error) {
    toast(messageOf(error), true);
    $('#token-updated').textContent = '读取失败，请确认 AI 工作台已经就绪。';
  } finally {
    button.disabled = false;
    button.textContent = '刷新统计';
  }
}

$$('.nav-item').forEach((item) => item.addEventListener('click', () => showPage(item.dataset.page)));
$('#choose-workspace').addEventListener('click', chooseWorkspaceFromUi);
$('#restart-harness').addEventListener('click', restartHarnessFromUi);
$('#refresh-token-stats').addEventListener('click', refreshTokenStats);
$('#new-skill').addEventListener('click', async () => {
  const name = window.prompt('输入英文标识（小写字母、数字和连字符），例如：contract-summary');
  if (!name) return;
  const description = window.prompt('用一句话说明何时使用这个 Skill（至少 12 个字符）：');
  if (!description) return;
  try { await window.harnessDesktop.createSkill(name.trim(), description.trim()); await loadSkills(name.trim()); await openSkill(name.trim()); toast('Skill 已创建。'); }
  catch (error) { toast(messageOf(error), true); }
});
$('#import-skill').addEventListener('click', async () => { try { const result = await window.harnessDesktop.importSkill(); if (!result.canceled) { await loadSkills(result.name); toast('Skill 已导入。'); } } catch (error) { toast(messageOf(error), true); } });
$('#save-skill').addEventListener('click', () => saveSkill(false));
$('#skill-enabled').addEventListener('change', async (event) => {
  if (!selectedSkill) return;
  try { await window.harnessDesktop.setSkillEnabled(selectedSkill.name, event.target.checked); await openSkill(selectedSkill.name); toast(event.target.checked ? 'Skill 已启用。' : 'Skill 已停用。'); }
  catch (error) { event.target.checked = !event.target.checked; toast(messageOf(error), true); }
});
$('#delete-skill').addEventListener('click', async () => {
  if (!selectedSkill || !window.confirm(`把 ${selectedSkill.name} 移到 Windows 回收站吗？`)) return;
  try { await window.harnessDesktop.deleteSkill(selectedSkill.name, true); selectedSkill = null; $('#skill-editor').classList.add('hidden'); $('#skill-empty').classList.remove('hidden'); await loadSkills(); toast('Skill 已移到回收站，可在 Windows 回收站恢复。'); }
  catch (error) { toast(messageOf(error), true); }
});
$('#export-skill').addEventListener('click', async () => { if (!selectedSkill) return; try { const result = await window.harnessDesktop.exportSkill(selectedSkill.name); if (!result.canceled) toast(`已导出到 ${result.target}`); } catch (error) { toast(messageOf(error), true); } });
$$('[data-link]').forEach((button) => button.addEventListener('click', () => window.harnessDesktop.openExternal(button.dataset.link)));
$('#save-api-key').addEventListener('click', async () => {
  const input = $('#api-key');
  try { await window.harnessDesktop.saveApiKey(input.value); input.value = ''; await refreshApiStatus(); toast('API Key 已加密保存，工作台正在重启。'); }
  catch (error) { toast(messageOf(error), true); }
});
$('#clear-api-key').addEventListener('click', async () => { if (!window.confirm('清除本机保存的 API Key 吗？')) return; try { await window.harnessDesktop.clearApiKey(); await refreshApiStatus(); toast('API Key 已清除。'); } catch (error) { toast(messageOf(error), true); } });
$('#open-licenses').addEventListener('click', () => window.harnessDesktop.openLicenses());
$('#show-privacy-policy').addEventListener('click', () => openPrivacyPolicy(true));
$('#close-privacy-policy').addEventListener('click', closePrivacyPolicy);
$('#privacy-consent').addEventListener('change', (event) => { $('#accept-privacy').disabled = !event.target.checked; });
$('#accept-privacy').addEventListener('click', async () => {
  if (!$('#privacy-consent').checked) return;
  const button = $('#accept-privacy');
  button.disabled = true;
  button.textContent = '正在启动…';
  try {
    const result = await window.harnessDesktop.acceptPrivacyPolicy();
    appState.privacy = result;
    $('#privacy-modal').classList.add('hidden');
    toast('隐私政策已确认。');
  } catch (error) {
    toast(messageOf(error), true);
    button.disabled = false;
  } finally { button.textContent = '同意并继续'; }
});
$('#decline-privacy').addEventListener('click', () => window.harnessDesktop.declinePrivacyPolicy());

$$('.app-menu-trigger').forEach((trigger) => trigger.addEventListener('click', (event) => {
  event.stopPropagation();
  openAppMenu(trigger.closest('.app-menu'));
}));
$$('.app-menu-dropdown button').forEach((button) => {
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', async () => {
    closeAppMenus();
    try {
      if (button.dataset.menuPage) showPage(button.dataset.menuPage);
      else if (button.dataset.menuAction === 'choose-workspace') await chooseWorkspaceFromUi();
      else if (button.dataset.menuAction === 'restart-harness') await restartHarnessFromUi();
      else if (button.dataset.windowCommand) await window.harnessDesktop.windowCommand(button.dataset.windowCommand);
    } catch (error) { toast(messageOf(error), true); }
  });
});
document.addEventListener('click', closeAppMenus);
document.addEventListener('keydown', async (event) => {
  if (event.key === 'Escape') { closeAppMenus(); return; }
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && !event.shiftKey && ['1', '2'].includes(event.key)) {
    event.preventDefault();
    showPage({ '1': 'workbench', '2': 'tokens' }[event.key]);
  } else if (ctrl && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    if (event.shiftKey) await window.harnessDesktop.windowCommand('open-workspace');
    else await chooseWorkspaceFromUi();
  } else if (ctrl && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    await window.harnessDesktop.windowCommand('reload');
  } else if (ctrl && ['+', '=', '-', '0'].includes(event.key)) {
    event.preventDefault();
    await window.harnessDesktop.windowCommand(event.key === '-' ? 'zoom-out' : event.key === '0' ? 'zoom-reset' : 'zoom-in');
  } else if (event.key === 'F11') {
    event.preventDefault();
    await window.harnessDesktop.windowCommand('fullscreen');
  }
});

window.harnessDesktop.onHarnessStatus(applyHarnessStatus);
(async () => {
  try {
    appState = await window.harnessDesktop.getState();
    $('#workspace-label').textContent = appState.workspace;
    $('#version-label').textContent = `桌面版 ${appState.appVersion} · DeepSeek Harness ${appState.upstreamVersion}`;
    $('#rtk-version-label').textContent = appState.rtk?.available
      ? `内置 RTK ${appState.rtk.version} · 应用私有运行 · 遥测已关闭`
      : `RTK ${appState.rtk?.version || ''} 当前不可用：${appState.rtk?.reason || '未通过运行检查'}`;
    applyHarnessStatus(appState.harness);
    if (!appState.privacy?.accepted) openPrivacyPolicy(false);
  } catch (error) { toast(messageOf(error), true); }
})();
