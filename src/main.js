'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const hw = require('./homewizard');
const { Store } = require('./store');
const { renderValueIcon } = require('./tray-icon');

// Journal de diagnostic (le stderr d'Electron n'est pas toujours capturé).
const DIAG = path.join(require('node:os').tmpdir(), 'hwm-diag.log');
function diag(msg) {
  try {
    fs.appendFileSync(DIAG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => diag('UNCAUGHT: ' + (e && e.stack || e)));
process.on('unhandledRejection', (e) => diag('UNHANDLED REJECTION: ' + (e && e.stack || e)));
diag('--- démarrage main.js ---');

let tray = null;
let win = null;
let store = null;
let pollTimer = null;
let lastSnapshot = { devices: [], updatedAt: null, error: null };

const ICON_PATH = path.join(__dirname, '..', 'assets', 'tray.png');

// ---------------------------------------------------------------------------
// Boucle de relevé
// ---------------------------------------------------------------------------
async function pollOnce() {
  const devices = store.getDevices();
  const snapshot = { devices: [], updatedAt: new Date().toISOString(), error: null };

  for (const dev of devices) {
    const entry = {
      serial: dev.serial,
      ip: dev.ip,
      label: dev.label,
      role: dev.role,
      kind: dev.kind || hw.describeProduct(dev.productType).kind,
      productType: dev.productType,
      online: false,
    };
    try {
      const m = await readDeviceWithHealing(dev, entry);
      const totals = store.record(dev.serial, m.counters);
      Object.assign(entry, {
        online: true,
        kind: m.kind,
        powerW: m.powerW,
        importKwh: m.importKwh,
        exportKwh: m.exportKwh,
        socPct: m.socPct,
        cycles: m.cycles,
        waterM3: m.waterM3,
        flowLpm: m.flowLpm,
        gasM3: m.gasM3,
        switchState: m.switchState,
        day: totals.day,
        month: totals.month,
      });
    } catch (e) {
      entry.errorMsg = e.message;
      if (/token/i.test(e.message)) entry.needsPairing = true;
    }
    snapshot.devices.push(entry);
  }

  lastSnapshot = snapshot;
  if (win && !win.isDestroyed()) win.webContents.send('state-update', snapshot);
  try {
    recordLive(snapshot);
    updateTrayTooltip(snapshot);
    updateTrayIcon(snapshot);
  } catch (e) {
    diag('tray/live update error: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Live samples (in-memory ring buffer for the "instant" chart view)
// ---------------------------------------------------------------------------
const liveBuffers = {}; // serial -> [{ t, v }]
const LIVE_MAX = 180; // ~6 min at 2s

function recordLive(snapshot) {
  const t = Date.now();
  for (const d of snapshot.devices) {
    if (!d.online) continue;
    const v = d.kind === 'battery' && d.socPct != null ? d.socPct
      : d.kind === 'water' ? d.flowLpm
      : d.powerW;
    if (v == null) continue;
    const buf = (liveBuffers[d.serial] ||= []);
    buf.push({ t, v });
    if (buf.length > LIVE_MAX) buf.shift();
  }
}

function startPolling() {
  stopPolling();
  const interval = store.config.pollIntervalMs || 2000;
  const loop = async () => {
    try {
      await pollOnce();
    } catch (e) {
      lastSnapshot.error = e.message;
    }
    pollTimer = setTimeout(loop, interval);
  };
  loop();
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

// ---------------------------------------------------------------------------
// DHCP self-healing : if a device becomes unreachable, scan its /24 by serial
// in the background and update its IP. Throttled to once per minute per device.
// ---------------------------------------------------------------------------
const healState = {}; // serial -> { lastAttempt, scanning }

function maybeHeal(dev) {
  const st = (healState[dev.serial] ||= { lastAttempt: 0, scanning: false });
  const now = Date.now();
  if (st.scanning || now - st.lastAttempt < 60000) return;
  st.scanning = true;
  st.lastAttempt = now;
  diag(`rediscovery: ${dev.serial} unreachable at ${dev.ip}, scanning /24 by serial...`);
  hw.findBySerial(dev.serial, dev.ip)
    .then((newIp) => {
      if (newIp && newIp !== dev.ip) {
        diag(`rediscovery: ${dev.serial} moved ${dev.ip} -> ${newIp}`);
        store.updateDeviceIp(dev.serial, newIp);
        dev.ip = newIp; // dev is the live config object; next poll uses the new IP
      }
    })
    .catch((e) => diag('rediscovery error: ' + e.message))
    .finally(() => {
      st.scanning = false;
    });
}

async function readDeviceWithHealing(dev) {
  try {
    return await hw.readDevice(dev);
  } catch (e) {
    if (!/token/i.test(e.message)) maybeHeal(dev); // don't scan for pairing errors
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function fmtW(w) {
  if (w == null) return '—';
  const a = Math.abs(w);
  return a >= 1000 ? (w / 1000).toFixed(2) + ' kW' : Math.round(w) + ' W';
}

function updateTrayTooltip(snapshot) {
  if (!tray) return;
  const parts = [];
  for (const d of snapshot.devices) {
    if (!d.online) {
      parts.push(`${d.label}: hors ligne`);
      continue;
    }
    if (d.kind === 'water') {
      const flow = d.flowLpm != null ? ` (${d.flowLpm} L/min)` : '';
      parts.push(`💧 ${d.label}: ${(d.waterM3 ?? 0).toFixed(2)} m³${flow}`);
    } else if (d.kind === 'battery') {
      const soc = d.socPct != null ? ` (${Math.round(d.socPct)}%)` : '';
      parts.push(`🔋 ${d.label}: ${fmtW(d.powerW)}${soc}`);
    } else {
      const icon = d.role === 'solar' ? '☀' : d.role === 'socket' ? '🔌' : '⚡';
      parts.push(`${icon} ${d.label}: ${fmtW(d.powerW)}`);
    }
  }
  const tip = parts.length ? parts.join('\n') : 'HomeWizard — aucun appareil configuré';
  tray.setToolTip('HomeWizard Monitor\n' + tip);
}

// Dynamic tray icon : renders a chosen value (e.g. battery %) onto the icon.
let baseTrayImage = null;
function trayValueText(d, type) {
  if (type === 'soc') return d.socPct != null ? String(Math.round(d.socPct)) : '--';
  if (type === 'power') {
    if (d.powerW == null) return '--';
    return Math.abs(d.powerW) >= 1000 ? (d.powerW / 1000).toFixed(1) : String(Math.round(d.powerW));
  }
  if (type === 'flow') return d.flowLpm != null ? String(d.flowLpm) : '--';
  return null;
}

function updateTrayIcon(snapshot) {
  if (!tray) return;
  const tm = store.config.trayMetric;
  if (!tm || tm.type === 'off' || !tm.serial) {
    if (!baseTrayImage) baseTrayImage = nativeImage.createFromPath(ICON_PATH);
    tray.setImage(baseTrayImage);
    return;
  }
  const d = snapshot.devices.find((x) => x.serial === tm.serial && x.online);
  const text = d ? trayValueText(d, tm.type) : '--';
  const fg = tm.type === 'soc' ? [52, 211, 153] : tm.type === 'flow' ? [56, 189, 248] : [245, 158, 11];
  try {
    tray.setImage(nativeImage.createFromBuffer(renderValueIcon(text, { fg })));
  } catch (e) {
    diag('tray icon error: ' + e.message);
  }
}

function isAutoLaunch() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, args: [] });
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Ouvrir le dashboard', click: showWindow },
    { label: 'Actualiser maintenant', click: () => pollOnce() },
    { type: 'separator' },
    {
      label: 'Démarrer avec Windows',
      type: 'checkbox',
      checked: isAutoLaunch(),
      click: (item) => setAutoLaunch(item.checked),
    },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(img);
  tray.setToolTip('HomeWizard Monitor');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
}

// ---------------------------------------------------------------------------
// Fenêtre dashboard
// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 880,
    minHeight: 560,
    show: false,
    resizable: true,
    title: 'HomeWizard Monitor',
    icon: ICON_PATH,
    backgroundColor: '#0c1116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Fermer = cacher dans le tray (ne pas quitter).
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
  win.webContents.send('state-update', lastSnapshot);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('renderer-error', (_e, msg) => diag('RENDERER: ' + msg));
ipcMain.handle('get-state', () => lastSnapshot);
ipcMain.handle('get-config', () => store.config);
function localSubnetBases() {
  const bases = new Set();
  const ifs = require('node:os').networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) {
        bases.add(a.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  return [...bases];
}

ipcMain.handle('discover', async () => {
  // mDNS first (instant where it works), then a subnet scan of every local
  // network — the scan also catches devices behind routers that block mDNS
  // and v2 devices (battery) that only answer over HTTPS.
  const viaMdns = await hw.discoverAndProbe(4000).catch(() => []);
  let viaScan = [];
  for (const base of localSubnetBases()) {
    viaScan = viaScan.concat(await hw.scanSubnet(base, { concurrency: 40, timeoutMs: 900 }).catch(() => []));
  }
  const map = new Map();
  for (const d of [...viaScan, ...viaMdns]) {
    if (!d || d.error) continue;
    map.set(d.serial || d.ip, d); // identified (with serial) wins over scan stub
  }
  return [...map.values()];
});
ipcMain.handle('probe-ip', async (_e, ip) => {
  try {
    return await hw.probe(ip);
  } catch (e) {
    return { ip, error: e.message };
  }
});
ipcMain.handle('save-devices', async (_e, devices) => {
  store.setDevices(devices);
  await pollOnce();
  return store.getDevices();
});
ipcMain.handle('probe-with-token', async (_e, ip, token) => {
  try {
    return await hw.probeWithToken(ip, token);
  } catch (e) {
    return { ip, error: e.message };
  }
});
ipcMain.handle('pair-device', async (event, ip) => {
  try {
    const token = await hw.pairDevice(ip, {
      timeoutMs: 30000,
      onTick: (n) => event.sender.send('pair-progress', { ip, attempt: n }),
    });
    return { token };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('get-history', (_e, serial, days) => store.getDailyHistory(serial, days || 30));
ipcMain.handle('get-aggregated', (_e, serial, granularity, buckets) =>
  store.getAggregatedHistory(serial, granularity, buckets)
);
ipcMain.handle('get-live', (_e, serial) => liveBuffers[serial] || []);
ipcMain.handle('get-tray-metric', () => store.config.trayMetric || { type: 'off', serial: null });
ipcMain.handle('set-tray-metric', (_e, tm) => {
  store.config.trayMetric = tm;
  store.saveConfig();
  updateTrayIcon(lastSnapshot);
  return store.config.trayMetric;
});

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------
const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  diag('single-instance lock NON obtenu -> quit');
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    diag('whenReady: userData=' + app.getPath('userData'));
    store = new Store(path.join(app.getPath('userData'), 'data'));
    diag('store OK, devices=' + store.getDevices().length);
    createTray();
    diag('tray OK');
    createWindow();
    diag('window OK');
    startPolling();
    diag('polling démarré');

    // En l'absence d'appareils configurés, on ouvre le dashboard pour la config.
    if (store.getDevices().length === 0) showWindow();
  }).catch((e) => diag('whenReady ERROR: ' + (e && e.stack || e)));

  app.on('window-all-closed', (e) => {
    // Ne pas quitter : l'app vit dans le tray.
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    stopPolling();
  });
}
