'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hwm', {
  getState: () => ipcRenderer.invoke('get-state'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  discover: () => ipcRenderer.invoke('discover'),
  probeIp: (ip) => ipcRenderer.invoke('probe-ip', ip),
  saveDevices: (devices) => ipcRenderer.invoke('save-devices', devices),
  getHistory: (serial, days) => ipcRenderer.invoke('get-history', serial, days),
  getAggregated: (serial, granularity, buckets) =>
    ipcRenderer.invoke('get-aggregated', serial, granularity, buckets),
  getLive: (serial) => ipcRenderer.invoke('get-live', serial),
  getTrayMetric: () => ipcRenderer.invoke('get-tray-metric'),
  setTrayMetric: (tm) => ipcRenderer.invoke('set-tray-metric', tm),
  pairDevice: (ip) => ipcRenderer.invoke('pair-device', ip),
  probeWithToken: (ip, token) => ipcRenderer.invoke('probe-with-token', ip, token),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  platform: process.platform,
  widgetActivate: () => ipcRenderer.invoke('widget-activate'),
  onState: (cb) => ipcRenderer.on('state-update', (_e, snap) => cb(snap)),
  onPairProgress: (cb) => ipcRenderer.on('pair-progress', (_e, p) => cb(p)),
  reportError: (msg) => ipcRenderer.send('renderer-error', msg),
});
