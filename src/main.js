'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const hw = require('./homewizard');
const { Store } = require('./store');

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
  updateTrayTooltip(snapshot);
  if (win && !win.isDestroyed()) win.webContents.send('state-update', snapshot);
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
    width: 460,
    height: 680,
    show: false,
    resizable: true,
    title: 'HomeWizard Monitor',
    icon: ICON_PATH,
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
ipcMain.handle('get-state', () => lastSnapshot);
ipcMain.handle('get-config', () => store.config);
ipcMain.handle('discover', async () => {
  return hw.discoverAndProbe(5000);
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
