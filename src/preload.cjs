const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harnessDesktop', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  acceptPrivacyPolicy: () => ipcRenderer.invoke('privacy:accept'),
  declinePrivacyPolicy: () => ipcRenderer.invoke('privacy:decline'),
  chooseWorkspace: () => ipcRenderer.invoke('app:choose-workspace'),
  restartHarness: () => ipcRenderer.invoke('harness:restart'),
  onHarnessStatus: (callback) => ipcRenderer.on('harness:status', (_event, value) => callback(value)),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  readSkill: (name) => ipcRenderer.invoke('skills:read', name),
  createSkill: (name, description) => ipcRenderer.invoke('skills:create', { name, description }),
  saveSkill: (name, content, acknowledgeWarnings = false) => ipcRenderer.invoke('skills:save', { name, content, acknowledgeWarnings }),
  setSkillEnabled: (name, enabled) => ipcRenderer.invoke('skills:set-enabled', { name, enabled }),
  deleteSkill: (name, confirmed = false) => ipcRenderer.invoke('skills:delete', { name, confirmed }),
  importSkill: () => ipcRenderer.invoke('skills:import'),
  exportSkill: (name) => ipcRenderer.invoke('skills:export', name),
  getApiStatus: () => ipcRenderer.invoke('api:status'),
  saveApiKey: (key) => ipcRenderer.invoke('api:save-key', key),
  clearApiKey: () => ipcRenderer.invoke('api:clear-key'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openLicenses: () => ipcRenderer.invoke('app:open-licenses'),
  windowCommand: (command) => ipcRenderer.invoke('window:command', command),
  getTokenStats: () => ipcRenderer.invoke('tokens:get-stats')
});
