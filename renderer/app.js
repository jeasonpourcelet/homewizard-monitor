'use strict';

// Surface renderer errors to the main process diagnostic log.
window.addEventListener('error', (e) =>
  window.hwm?.reportError?.((e.error && e.error.stack) || e.message)
);
window.addEventListener('unhandledrejection', (e) =>
  window.hwm?.reportError?.('rejection: ' + ((e.reason && e.reason.stack) || e.reason))
);

const $ = (id) => document.getElementById(id);

// i18n — strings + current locale come from preload (window.hwm).
function t(key, vars) {
  const dict = (window.hwm && window.hwm.i18n) || {};
  let s = dict[key] != null ? dict[key] : key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function applyStatic() {
  const loc = (window.hwm && window.hwm.locale) || 'en';
  document.documentElement.lang = loc;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n'));
  });
  const g = $('guide');
  if (g && window.GUIDES) g.innerHTML = window.GUIDES[loc] || window.GUIDES.en;
}

let chart = null;
let lastDevices = [];      // dernier snapshot live
let selected = [];         // appareils suivis (config en cours d'édition)
let chartSerial = null;

// --------------------------------------------------------------------------
// Formatage
// --------------------------------------------------------------------------
function fmtPower(w) {
  if (w == null) return { val: '—', unit: '' };
  const a = Math.abs(w);
  return a >= 1000
    ? { val: (w / 1000).toFixed(2), unit: 'kW' }
    : { val: Math.round(w).toString(), unit: 'W' };
}
function roleIcon(role) {
  return {
    solar: '☀️',
    battery: '🔋',
    water: '💧',
    socket: '🔌',
    grid: '⚡',
    energy: '⚡',
    gas: '🔥',
    display: '🖥️',
  }[role] || '⚡';
}

// Couleurs de marque (alignées sur le CSS).
const COL = {
  import: '#ff6b5e',
  export: '#3ddc84',
  battery: '#34d399',
  water: '#38bdf8',
  gas: '#f59e42',
  solar: '#f5c518',
  neutral: '#8595a3',
};

// --------------------------------------------------------------------------
// Dashboard live
// --------------------------------------------------------------------------
function num(v, dp = 2) {
  return (v ?? 0).toFixed(dp);
}

// Mini-graphe en aire (sparkline) à partir des valeurs live.
function sparklineSVG(values, color, { baseline0 = true } = {}) {
  if (!values || values.length < 2) {
    return `<div class="spark-empty">en attente de mesures…</div>`;
  }
  const w = 320, h = 120, pad = 6;
  let min = Math.min(...values), max = Math.max(...values);
  if (baseline0) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) max = min + 1;
  const range = max - min;
  const X = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const Y = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const pts = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const line = 'M' + pts.join(' L');
  const area = `${line} L${X(values.length - 1).toFixed(1)},${h - pad} L${X(0).toFixed(1)},${h - pad} Z`;
  const gid = 'sg' + color.replace('#', '');
  return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0.03"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

// En-tête de carte façon HomeWizard : grande valeur + nom + info à droite.
function cardTop(valueHtml, name, rightHtml = '') {
  return `<div class="card-top">
    <div class="card-main">
      <div class="value">${valueHtml}</div>
      <div class="dname">${name}</div>
    </div>
    <div class="card-right">${rightHtml}</div>
  </div>`;
}

function valHtml(val, unit, cls = '') {
  return `<span class="num ${cls}">${val}</span> <span class="unit">${unit}</span>`;
}

function renderCard(d) {
  if (!d.online) {
    const msg = d.needsPairing
      ? t('pairing_required_card')
      : `${t('offline')} — ${d.errorMsg || t('unreachable')}`;
    return `<div class="card off">
      <div class="card-top">
        <div class="card-main"><div class="dname"><span class="dot off"></span> ${d.label}</div></div>
        <div class="card-right"><span class="ic">${roleIcon(d.role)}</span></div>
      </div>
      <p class="card-msg muted small">${msg}</p>
    </div>`;
  }
  if (d.kind === 'gas') return cardGas(d);
  if (d.kind === 'water') return cardWater(d);
  if (d.kind === 'battery') return cardBattery(d);
  if (d.kind === 'batteries') return cardBatteries(d);
  return cardEnergy(d);
}

function powerStateLabel(w) {
  return w === 0 ? t('state_idle') : w > 0 ? t('state_charging') : t('state_discharging');
}

function cardEnergy(d) {
  const p = fmtPower(d.powerW);
  const imp = d.powerW > 0;
  const cls = imp ? 'c-import' : d.powerW < 0 ? 'c-export' : '';
  const label = imp ? t('label_consumption') : d.powerW < 0 ? t('label_injection') : t('label_balance');
  const color = imp ? COL.import : d.powerW < 0 ? COL.export : COL.neutral;
  const right = d.switchState != null
    ? `<span class="tag ${d.switchState ? 'ok' : 'warn'}">${d.switchState ? '⏻ on' : '○ off'}</span>`
    : `<span class="ic">${roleIcon(d.role)}</span>`;
  return `<div class="card">
    <div class="card-top">
      <div class="card-main"><div class="value">${valHtml(p.val, p.unit, cls)}</div>
        <div class="dname">${d.label} <span class="muted">· ${label}</span></div></div>
      <div class="card-right">${right}</div>
    </div>
    <div class="spark">${sparklineSVG(d.spark, color)}</div>
  </div>`;
}

function cardWater(d) {
  const flow = d.flowLpm != null ? d.flowLpm : 0;
  return `<div class="card">
    <div class="card-top">
      <div class="card-main"><div class="value">${valHtml(flow, 'L/min', 'c-water')}</div>
        <div class="dname">${d.label} <span class="muted">· ${num(d.waterM3)} m³</span></div></div>
      <div class="card-right"><span class="ic">💧</span></div>
    </div>
    <div class="spark">${sparklineSVG(d.spark, COL.water)}</div>
  </div>`;
}

function cardGas(d) {
  return `<div class="card">
    <div class="card-top">
      <div class="card-main"><div class="value">${valHtml(num(d.gasM3, 2), 'm³', 'c-gas')}</div>
        <div class="dname">${d.label}</div></div>
      <div class="card-right"><span class="ic">🔥</span></div>
    </div>
    <p class="card-msg muted small">${t('gas_note')}</p>
  </div>`;
}

function cardBattery(d) {
  const p = fmtPower(Math.abs(d.powerW ?? 0));
  const soc = d.socPct != null ? Math.round(d.socPct) : null;
  const right = soc != null
    ? `<span class="soc-badge">${soc}%</span>`
    : `<span class="ic">🔋</span>`;
  return `<div class="card">
    <div class="card-top">
      <div class="card-main"><div class="value">${valHtml(p.val, p.unit + ' · ' + powerStateLabel(d.powerW), 'c-battery')}</div>
        <div class="dname">${d.label}${d.cycles != null ? ` <span class="muted">· ${d.cycles} ${t('cycles')}</span>` : ''}</div></div>
      <div class="card-right">${right}</div>
    </div>
    <div class="spark">${sparklineSVG(d.spark, COL.battery)}</div>
  </div>`;
}

function cardBatteries(d) {
  const p = fmtPower(Math.abs(d.powerW ?? 0));
  const modes = { zero: t('mode_zero'), standby: t('mode_standby'), to_full: t('mode_to_full'), predictive: t('mode_predictive') };
  return `<div class="card">
    <div class="card-top">
      <div class="card-main"><div class="value">${valHtml(p.val, p.unit + ' · ' + powerStateLabel(d.powerW), 'c-battery')}</div>
        <div class="dname">${d.label}${d.batteryCount ? ` <span class="muted">· ${d.batteryCount} ${t('modules')}</span>` : ''}</div></div>
      <div class="card-right"><span class="tag ok">${modes[d.mode] || d.mode || '—'}</span></div>
    </div>
    <div class="spark">${sparklineSVG(d.spark, COL.battery)}</div>
  </div>`;
}

// --------------------------------------------------------------------------
// Vue « maison » agrégée : conso nette du foyer = réseau − solaire − batterie.
// Conventions (W) : réseau + = import / − = export ; solaire − = production ;
// batterie + = charge / − = décharge. → charge maison = grid − solar − battery.
// --------------------------------------------------------------------------
function computeHome(devices) {
  let grid = 0, solar = 0, battery = 0;
  let hasGrid = false, hasSolar = false, hasBattery = false;
  for (const d of devices) {
    if (!d.online || d.powerW == null) continue;
    if (d.role === 'grid') { grid += d.powerW; hasGrid = true; }
    else if (d.role === 'solar' || d.role === 'energy') { solar += d.powerW; hasSolar = true; }
    else if (d.kind === 'battery' || d.kind === 'batteries') { battery += d.powerW; hasBattery = true; }
  }
  if (!hasGrid) return null; // the P1/grid meter is required for a meaningful net
  return { load: grid - solar - battery, grid, solar, battery, hasGrid, hasSolar, hasBattery };
}

// Sparkline of the home load, combining each device's recent live values.
function homeSpark(devices) {
  const grid = devices.find((d) => d.role === 'grid');
  const solars = devices.filter((d) => d.role === 'solar' || d.role === 'energy');
  const bats = devices.filter((d) => d.kind === 'battery' || d.kind === 'batteries');
  if (!grid || !grid.spark || grid.spark.length < 2) return [];
  const series = [grid, ...solars, ...bats].filter((d) => d.spark && d.spark.length);
  const n = Math.min(...series.map((d) => d.spark.length));
  const at = (d, i) => d.spark[d.spark.length - n + i];
  const out = [];
  for (let i = 0; i < n; i++) {
    let v = at(grid, i);
    for (const s of solars) if (s.spark && s.spark.length >= n) v -= at(s, i);
    for (const b of bats) if (b.spark && b.spark.length >= n) v -= at(b, i);
    out.push(v);
  }
  return out;
}

function renderHomeCard(devices) {
  const h = computeHome(devices);
  if (!h) return '';
  const p = fmtPower(Math.abs(h.load));
  const importing = h.load >= 0;
  const cls = importing ? 'c-import' : 'c-export';
  const label = importing ? t('home_consumption') : t('home_export');
  const color = importing ? COL.import : COL.export;
  const part = (icon, name, w, signed) => {
    const f = fmtPower(signed ? w : Math.abs(w));
    const val = (signed && w > 0 ? '+' : '') + f.val + (f.unit ? ' ' + f.unit : '');
    return `<span class="hb">${icon} ${name} <b>${val}</b></span>`;
  };
  const bits = [];
  if (h.hasGrid) bits.push(part('⚡', t('home_grid'), h.grid, true));
  if (h.hasSolar) bits.push(part('☀️', t('home_solar'), -h.solar, false));
  if (h.hasBattery) bits.push(part('🔋', t('home_battery'), h.battery, true));
  return `<div class="card home">
    <div class="card-top">
      <div class="card-main">
        <div class="value">${valHtml(p.val, p.unit, cls)}</div>
        <div class="dname">🏠 ${t('home_title')} <span class="muted">· ${label}</span></div>
        <div class="home-breakdown">${bits.join('')}</div>
      </div>
    </div>
    <div class="spark">${sparklineSVG(homeSpark(devices), color)}</div>
  </div>`;
}

function renderCards(snapshot) {
  lastDevices = snapshot.devices || [];
  const c = $('cards');
  if (!lastDevices.length) {
    c.innerHTML = `<div class="card"><p class="muted">${t('no_devices_overview')}</p></div>`;
    return;
  }
  c.innerHTML = renderHomeCard(lastDevices) + lastDevices.map(renderCard).join('');

  // Met à jour le sélecteur d'historique.
  const sel = $('hist-device');
  const opts = lastDevices.map((d) => `<option value="${d.serial}">${d.label}</option>`).join('');
  if (sel.innerHTML !== opts) {
    sel.innerHTML = opts;
    if (!chartSerial && lastDevices[0]) chartSerial = lastDevices[0].serial;
    sel.value = chartSerial;
    refreshChart();
  }
}

function updateHeader(snapshot) {
  if (snapshot.updatedAt) {
    const loc = (window.hwm && window.hwm.locale) || 'en';
    const time = new Date(snapshot.updatedAt).toLocaleTimeString(loc);
    $('updated').textContent = t('updated_at', { t: time });
  }
}

// --------------------------------------------------------------------------
// Graphique « en direct » : courbe instantanée de l'appareil sélectionné.
// --------------------------------------------------------------------------
async function refreshChart() {
  if (!chartSerial) return;
  const dev = lastDevices.find((d) => d.serial === chartSerial);
  const kind = dev?.kind || 'energy';
  const buf = await window.hwm.getLive(chartSerial);
  const labels = buf.map((p) => {
    const t = new Date(p.t);
    return String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
  });
  const unit = kind === 'battery' ? t('chart_battery') : kind === 'water' ? t('chart_water') : t('chart_power');
  const color = kind === 'battery' || kind === 'batteries' ? COL.battery : kind === 'water' ? COL.water : COL.import;

  if (!chart) {
    chart = new Chart($('chart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8595a3', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
          y: { ticks: { color: '#8595a3' }, grid: { color: '#25323d' } },
        },
      },
    });
  }
  chart.data.labels = labels;
  chart.data.datasets = [{
    label: unit, data: buf.map((p) => p.v),
    borderColor: color, backgroundColor: color + '33',
    fill: true, pointRadius: 0, tension: 0.25, borderWidth: 2,
  }];
  chart.update();
}

// --------------------------------------------------------------------------
// Réglages / appareils
// --------------------------------------------------------------------------
function renderSelected() {
  const el = $('selected-list');
  if (!selected.length) {
    el.innerHTML = `<p class="muted small">${t('no_devices_list')}</p>`;
    return;
  }
  el.innerHTML = selected
    .map((d, i) => {
      const needPair = d.needsToken && !d.token;
      const pairUi = d.needsToken
        ? `<div class="pair">
             ${needPair
               ? `<button class="secondary pair-btn" data-i="${i}">${t('pair')}</button>`
               : `<span class="tag-ok">${t('token_ok')}</span>`}
             <span class="muted small" id="pair-status-${i}"></span>
           </div>`
        : '';
      return `<div class="dev-wrap">
        <div class="dev">
          <span style="font-size:18px">${roleIcon(d.role)}</span>
          <div class="meta">
            <input class="dev-label-input" data-i="${i}" value="${escAttr(d.label || '')}" title="${t('rename_hint')}" />
            <div class="sub">${d.ip} · ${d.productType || ''} · ${d.serial || ''}</div></div>
          <button class="rm" data-i="${i}" title="${t('remove')}">✕</button>
        </div>
        ${pairUi}
      </div>`;
    })
    .join('');
  el.querySelectorAll('.rm').forEach((b) =>
    b.addEventListener('click', () => {
      selected.splice(Number(b.dataset.i), 1);
      renderSelected();
    })
  );
  el.querySelectorAll('.pair-btn').forEach((b) =>
    b.addEventListener('click', () => pairFlow(Number(b.dataset.i)))
  );
  // Inline rename — updates the in-memory label; persisted on Save (no re-render
  // here so the field keeps focus while typing).
  el.querySelectorAll('.dev-label-input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const i = Number(inp.dataset.i);
      if (selected[i]) selected[i].label = inp.value;
    })
  );
}

function addDevice(dev) {
  if (!dev || dev.error) return;
  if (selected.some((d) => d.serial === dev.serial || d.ip === dev.ip)) return;
  selected.push({
    serial: dev.serial,
    ip: dev.ip,
    label: dev.label,
    role: dev.role,
    kind: dev.kind,
    productType: dev.productType,
    apiVersion: dev.apiVersion,
    needsToken: !!dev.needsToken,
    token: dev.token || null,
  });
  renderSelected();
}

async function pairFlow(index) {
  const dev = selected[index];
  if (!dev) return;
  const status = document.getElementById('pair-status-' + index);
  status.textContent = t('press_button');
  const res = await window.hwm.pairDevice(dev.ip);
  if (res.error) {
    status.textContent = '❌ ' + res.error;
    return;
  }
  dev.token = res.token;
  // Identify the device now that we have a token (reveals product type / serial).
  const info = await window.hwm.probeWithToken(dev.ip, res.token);
  if (info && !info.error) {
    dev.serial = info.serial || dev.serial;
    dev.productType = info.productType || dev.productType;
    dev.role = info.role || dev.role;
    dev.kind = info.kind || dev.kind;
    dev.label = info.label || dev.label;
    status.textContent = t('paired_as', { label: info.label, type: info.productType });
  } else {
    status.textContent = t('paired_ok');
  }
  renderSelected();
}

async function runDiscover() {
  const btn = $('btn-discover');
  btn.disabled = true;
  $('discover-status').textContent = t('scanning');
  $('discovered').innerHTML = '';
  const found = await window.hwm.discover().finally(() => (btn.disabled = false));
  if (!found.length) {
    $('discover-status').textContent = t('none_found');
    return;
  }
  $('discover-status').textContent = t('n_found', { n: found.length });
  $('discovered').innerHTML = found
    .map((d, i) => {
      const ok = !d.error;
      return `<div class="dev">
        <input type="checkbox" data-i="${i}" ${ok ? '' : 'disabled'} />
        <span style="font-size:18px">${roleIcon(d.role)}</span>
        <div class="meta"><div class="name">${d.label || d.mdnsName || t('device')}</div>
          <div class="sub">${d.ip} · ${ok ? d.productType : t('err') + ': ' + d.error}</div></div>
      </div>`;
    })
    .join('');
  $('discovered')
    .querySelectorAll('input[type=checkbox]')
    .forEach((cb) =>
      cb.addEventListener('change', () => {
        if (cb.checked) addDevice(found[Number(cb.dataset.i)]);
      })
    );
}

async function addManualIp() {
  const ip = $('manual-ip').value.trim();
  if (!ip) return;
  $('manual-status').textContent = t('testing', { ip });
  const info = await window.hwm.probeIp(ip);
  if (info.error) {
    $('manual-status').textContent = t('failed', { err: info.error });
    return;
  }
  addDevice(info);
  $('manual-status').textContent = t('added', { label: info.label });
  $('manual-ip').value = '';
}

// --------------------------------------------------------------------------
// Navigation par onglets
// --------------------------------------------------------------------------
let currentView = 'overview';

function switchView(name) {
  currentView = name;
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name)
  );
  ['overview', 'charts', 'raw', 'devices', 'guide'].forEach((v) => {
    $('view-' + v).hidden = v !== name;
  });
  if (name === 'charts') refreshChart();
  if (name === 'raw') renderRaw();
  if (name === 'devices') populateTraySettings();
}

// --------------------------------------------------------------------------
// Onglet « Données » : tous les champs bruts renvoyés par chaque appareil.
// --------------------------------------------------------------------------
function fmtRawVal(v) {
  if (v === null) return '<span class="muted">null</span>';
  if (typeof v === 'object') return `<code>${JSON.stringify(v)}</code>`;
  return String(v);
}

function renderRaw() {
  const el = $('raw-content');
  if (!lastDevices.length) {
    el.innerHTML = `<p class="muted">${t('no_devices_short')}</p>`;
    return;
  }
  el.innerHTML = lastDevices
    .map((d) => {
      const head = `<div class="panel-head"><h2>${roleIcon(d.role)} ${d.label}</h2>
        <span class="badge">${d.productType || ''} · ${d.ip}</span></div>`;
      if (!d.online || !d.raw) {
        return `<div class="panel">${head}<p class="muted small">${
          d.needsPairing ? t('pairing_required_raw') : t('offline') + ' — ' + (d.errorMsg || t('unreachable'))
        }</p></div>`;
      }
      const rows = Object.entries(d.raw)
        .map(([k, v]) => `<tr><td class="rk">${k}</td><td class="rv">${fmtRawVal(v)}</td></tr>`)
        .join('');
      return `<div class="panel">${head}<table class="raw-table">${rows}</table></div>`;
    })
    .join('');
}

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
async function init() {
  applyStatic(); // localise static text + inject the guide

  // Language selector.
  const ls = $('lang-select');
  if (ls) {
    ls.value = (window.hwm && window.hwm.locale) || 'en';
    ls.addEventListener('change', () => window.hwm.setLocale(ls.value));
  }

  const cfg = await window.hwm.getConfig();
  selected = (cfg.devices || []).map((d) => ({ ...d }));
  renderSelected();

  // Refresh-interval selector (applies immediately).
  const pi = $('poll-interval');
  if (pi) {
    pi.value = String(cfg.pollIntervalMs || 2000);
    pi.addEventListener('change', () => window.hwm.setPollInterval(Number(pi.value)));
  }

  const snap = await window.hwm.getState();
  renderCards(snap);
  updateHeader(snap);

  window.hwm.onState((s) => {
    renderCards(s);
    updateHeader(s);
    if (currentView === 'charts') refreshChart(); // courbe en direct
    if (currentView === 'raw') renderRaw();
  });

  // Onglets latéraux.
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => switchView(b.dataset.view))
  );

  $('btn-discover').addEventListener('click', runDiscover);
  $('btn-add-ip').addEventListener('click', addManualIp);
  $('btn-save').addEventListener('click', async () => {
    await window.hwm.saveDevices(selected);
    switchView('overview');
  });
  $('hist-device').addEventListener('change', (e) => {
    chartSerial = e.target.value;
    refreshChart();
  });

  // Widget barre des tâches.
  $('btn-tray-save').addEventListener('click', saveTraySettings);

  // Vérification des mises à jour.
  $('btn-update').addEventListener('click', checkForUpdates);

  // Widget de bureau macOS : section visible uniquement sur Mac.
  if (window.hwm.platform === 'darwin') {
    const wp = $('widget-mac-panel');
    if (wp) wp.hidden = false;
    const wb = $('btn-widget-activate');
    if (wb) wb.addEventListener('click', activateWidget);
  }

  // Premier lancement (aucun appareil) : ouvrir le Guide de démarrage.
  if (!selected.length) switchView('guide');
}

// --------------------------------------------------------------------------
// Widget de bureau macOS
// --------------------------------------------------------------------------
async function activateWidget() {
  const btn = $('btn-widget-activate');
  const status = $('widget-activate-status');
  btn.disabled = true;
  status.classList.remove('update-ok');
  status.textContent = t('widget_activating');
  let r;
  try {
    r = await window.hwm.widgetActivate();
  } catch {
    r = { ok: false };
  }
  btn.disabled = false;
  if (r.ok) {
    status.classList.add('update-ok');
    status.textContent = t('widget_registered');
  } else if (r.reason === 'not-installed') {
    status.textContent = t('widget_not_installed');
  } else {
    status.textContent = t('widget_activate_failed', { err: r.reason || t('err') });
  }
}

// --------------------------------------------------------------------------
// Réglage du widget barre des tâches
// --------------------------------------------------------------------------
// Indicateurs pertinents selon le type d'appareil (regroupements corrects).
function trayTypeOptionsFor(serial) {
  const d = lastDevices.find((x) => x.serial === serial) ||
            selected.find((x) => x.serial === serial) || {};
  const opts = [['off', t('opt_logo')]];
  if (d.kind === 'battery' || d.kind === 'batteries') {
    opts.push(['soc', t('opt_soc')], ['power', t('opt_power')]);
  } else if (d.kind === 'water') {
    opts.push(['flow', t('opt_flow')]);
  } else if (d.kind === 'gas') {
    // Gas: hourly index, no instant value → logo only.
  } else {
    opts.push(['power', t('opt_power')]); // P1, kWh, socket, etc.
  }
  return opts;
}

function refreshTrayTypeOptions(keepValue) {
  const sel = $('tray-type');
  const opts = trayTypeOptionsFor($('tray-device').value);
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = opts.some(([v]) => v === keepValue) ? keepValue : 'off';
}

async function populateTraySettings() {
  const devSel = $('tray-device');
  devSel.innerHTML = selected.map((d) => `<option value="${d.serial}">${d.label}</option>`).join('');
  const tm = await window.hwm.getTrayMetric();
  if (tm && tm.serial) devSel.value = tm.serial;
  refreshTrayTypeOptions(tm && tm.type);
  devSel.onchange = () => refreshTrayTypeOptions();
}

async function saveTraySettings() {
  const tm = { serial: $('tray-device').value, type: $('tray-type').value };
  await window.hwm.setTrayMetric(tm);
  $('tray-status').textContent = t('indicator_applied');
  setTimeout(() => ($('tray-status').textContent = ''), 2500);
}

// --------------------------------------------------------------------------
// Vérification des mises à jour (compare à la dernière GitHub Release)
// --------------------------------------------------------------------------
async function checkForUpdates() {
  const btn = $('btn-update');
  const status = $('update-status');
  btn.disabled = true;
  status.classList.remove('update-ok');
  status.textContent = t('checking');
  let r;
  try {
    r = await window.hwm.checkUpdates();
  } catch {
    r = { status: 'error' };
  }
  btn.disabled = false;

  if (r.status === 'update') {
    status.innerHTML = t('update_available', { latest: r.latest, current: r.current });
    const dl = $('dl-update');
    if (dl)
      dl.addEventListener('click', (e) => {
        e.preventDefault();
        window.hwm.openExternal(r.url);
      });
  } else if (r.status === 'uptodate') {
    status.classList.add('update-ok');
    status.textContent = t('up_to_date', { current: r.current });
  } else if (r.status === 'none') {
    status.textContent = t('no_release', { current: r.current });
  } else {
    status.textContent = t('update_failed');
  }
}

init();
