'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hwm', {
  getState: () => ipcRenderer.invoke('get-state'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  discover: () => ipcRenderer.invoke('discover'),
  probeIp: (ip) => ipcRenderer.invoke('probe-ip', ip),
  saveDevices: (devices) => ipcRenderer.invoke('save-devices', devices),
  getHistory: (serial, days) => ipcRenderer.invoke('get-history', serial, days),
  pairDevice: (ip) => ipcRenderer.invoke('pair-device', ip),
  probeWithToken: (ip, token) => ipcRenderer.invoke('probe-with-token', ip, token),
  onState: (cb) => ipcRenderer.on('state-update', (_e, snap) => cb(snap)),
  onPairProgress: (cb) => ipcRenderer.on('pair-progress', (_e, p) => cb(p)),
});
