'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const hw = require('./homewizard');
const { Store } = require('./store');
const { renderValueIcon } = require('./tray-icon');

const isMac = process.platform === 'darwin';

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
// macOS menu-bar glyph: the brand logo (bolt + "+") as a black template image,
// which macOS recolors (white on a dark menu bar, black on a light one).
const TRAY_MAC_PATH = path.join(__dirname, '..', 'assets', 'tray-mac.png');

// ---------------------------------------------------------------------------
// Boucle de relevé
// ---------------------------------------------------------------------------
async function pollOnce() {
  const devices = store.getDevices();
  const snapshot = { devices: [], updatedAt: new Date().toISOString(), error: null };

  // Relevés en parallèle : un cycle dure le temps du plus lent, pas la somme.
  snapshot.devices = await Promise.all(
    devices.map(async (dev) => {
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
          mode: m.mode,
          batteryCount: m.batteryCount,
          day: totals.day,
          month: totals.month,
          raw: m.raw, // réponse API brute, pour l'onglet « Données »
        });
      } catch (e) {
        entry.errorMsg = e.message;
        if (/token/i.test(e.message)) entry.needsPairing = true;
      }
      return entry;
    })
  );

  lastSnapshot = snapshot;
  try {
    recordLive(snapshot);
  } catch (e) {
    diag('recordLive error: ' + e.message);
  }
  // Attache la courbe live (valeurs récentes) à chaque appareil pour les sparklines.
  for (const d of snapshot.devices) d.spark = (liveBuffers[d.serial] || []).map((p) => p.v);
  if (win && !win.isDestroyed()) win.webContents.send('state-update', snapshot);
  try {
    updateTrayTooltip(snapshot);
    updateTrayIcon(snapshot);
    writeLatest(snapshot);
  } catch (e) {
    diag('tray update error: ' + e.message);
  }
}

// Exporte les valeurs courantes pour un consommateur externe (widget Windows, etc.).
function writeLatest(snapshot) {
  const out = {
    updatedAt: snapshot.updatedAt,
    devices: snapshot.devices.map((d) => ({
      serial: d.serial, label: d.label, kind: d.kind, role: d.role, online: !!d.online,
      powerW: d.powerW ?? null, socPct: d.socPct ?? null, mode: d.mode ?? null,
      waterM3: d.waterM3 ?? null, flowLpm: d.flowLpm ?? null, gasM3: d.gasM3 ?? null,
    })),
  };
  const tmp = path.join(app.getPath('userData'), 'latest.json.tmp');
  const dst = path.join(app.getPath('userData'), 'latest.json');
  const payload = JSON.stringify(out);
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, dst);

  // macOS: also mirror into the WidgetKit widget extension's sandbox container,
  // which a sandboxed widget can read without an app group / dev certificate.
  if (isMac) {
    try {
      const wdir = path.join(
        app.getPath('home'), 'Library', 'Containers',
        'io.github.homewizard-monitor.widget.ext', 'Data'
      );
      if (fs.existsSync(wdir)) {
        const wtmp = path.join(wdir, 'latest.json.tmp');
        fs.writeFileSync(wtmp, payload);
        fs.renameSync(wtmp, path.join(wdir, 'latest.json'));
      }
    } catch {
      /* widget not installed yet — ignore */
    }
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
  // Ne pas scanner si TOUT est hors ligne : c'est le réseau qui est coupé, pas
  // une IP qui a changé — inutile d'inonder un Wi-Fi déjà saturé. On ne cherche
  // une IP déplacée que si au moins un autre appareil répond (réseau OK).
  const anyOnline = (lastSnapshot.devices || []).some((d) => d.online);
  if (!anyOnline) return;

  const st = (healState[dev.serial] ||= { lastAttempt: 0, scanning: false });
  const now = Date.now();
  if (st.scanning || now - st.lastAttempt < 300000) return; // max 1 scan / 5 min / appareil
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
// The default tray glyph. On macOS we use a monochrome template bolt (the system
// recolors it to fit the menu bar, light or dark); elsewhere the bundled PNG.
function baseTrayNativeImage() {
  if (baseTrayImage) return baseTrayImage;
  if (isMac) {
    baseTrayImage = nativeImage.createFromPath(TRAY_MAC_PATH);
    baseTrayImage.setTemplateImage(true);
  } else {
    baseTrayImage = nativeImage.createFromPath(ICON_PATH);
  }
  return baseTrayImage;
}
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
    tray.setImage(baseTrayNativeImage());
    return;
  }
  const d = snapshot.devices.find((x) => x.serial === tm.serial && x.online);
  const text = d ? trayValueText(d, tm.type) : '--';
  const fg = tm.type === 'soc' ? [52, 211, 153] : tm.type === 'flow' ? [56, 189, 248] : [245, 158, 11];
  try {
    const img = nativeImage.createFromBuffer(
      renderValueIcon(text, isMac ? { template: true, scale: 3, padX: 3, padY: 8 } : { fg })
    );
    if (isMac) img.setTemplateImage(true);
    tray.setImage(img);
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
      label: isMac ? 'Ouvrir au démarrage' : 'Démarrer avec Windows',
      type: 'checkbox',
      checked: isAutoLaunch(),
      click: (item) => setAutoLaunch(item.checked),
    },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  tray = new Tray(baseTrayNativeImage());
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
// Vérification des mises à jour (compare la version locale à la dernière
// GitHub Release). L'app n'étant pas signée, on ne fait que notifier + ouvrir
// la page de téléchargement — pas d'auto-install.
// ---------------------------------------------------------------------------
const pkg = require('../package.json');

// Déduit "owner/repo" depuis package.json (repository.url) — pas d'URL en dur.
function repoSlug() {
  const url = (pkg.repository && pkg.repository.url) || '';
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)/i);
  return m ? m[1] : null;
}

// Compare deux versions semver "x.y.z". Renvoie true si `a` > `b`.
function isNewerVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function fetchLatestRelease(slug) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'api.github.com',
        path: `/repos/${slug}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'homewizard-monitor',
          Accept: 'application/vnd.github+json',
        },
        timeout: 8000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 404) return resolve(null); // aucune release publiée
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          try {
            const j = JSON.parse(body);
            resolve({ tag: j.tag_name || '', url: j.html_url || `https://github.com/${slug}/releases` });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

ipcMain.handle('check-updates', async () => {
  const current = app.getVersion();
  const slug = repoSlug();
  if (!slug) return { status: 'error', current, error: 'repository introuvable' };
  try {
    const rel = await fetchLatestRelease(slug);
    if (!rel || !rel.tag) return { status: 'none', current };
    const latest = rel.tag.replace(/^v/i, '');
    return {
      status: isNewerVersion(latest, current) ? 'update' : 'uptodate',
      current,
      latest,
      url: rel.url,
    };
  } catch (e) {
    diag('check-updates error: ' + e.message);
    return { status: 'error', current, error: e.message };
  }
});

// Ouvre une URL externe dans le navigateur (https uniquement, par sécurité).
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
});

// macOS : (ré)active le widget de bureau en lançant son app hôte (agent invisible),
// ce qui (ré)enregistre l'extension et rafraîchit les tuiles.
ipcMain.handle('widget-activate', async () => {
  if (!isMac) return { ok: false, reason: 'macos-only' };
  const appPath = '/Applications/HomeWizardWidget.app';
  if (!fs.existsSync(appPath)) return { ok: false, reason: 'not-installed' };
  const err = await shell.openPath(appPath);
  return err ? { ok: false, reason: err } : { ok: true };
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

  // Custom URL scheme so the macOS widget (and links) can open the dashboard.
  app.setAsDefaultProtocolClient('homewizardmonitor');
  app.on('open-url', (e) => {
    e.preventDefault();
    showWindow();
  });

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
