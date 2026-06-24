'use strict';

// Surface renderer errors to the main process diagnostic log.
window.addEventListener('error', (e) =>
  window.hwm?.reportError?.((e.error && e.error.stack) || e.message)
);
window.addEventListener('unhandledrejection', (e) =>
  window.hwm?.reportError?.('rejection: ' + ((e.reason && e.reason.stack) || e.reason))
);

const $ = (id) => document.getElementById(id);
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
      ? `🔗 Appairage requis — onglet <b>Appareils</b> → « Appairer », puis bouton de l'appareil.`
      : `Hors ligne — ${d.errorMsg || 'injoignable'}`;
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
  return w === 0 ? 'au repos' : w > 0 ? 'en charge' : 'en décharge';
}

function cardEnergy(d) {
  const p = fmtPower(d.powerW);
  const imp = d.powerW > 0;
  const cls = imp ? 'c-import' : d.powerW < 0 ? 'c-export' : '';
  const label = imp ? 'consommation' : d.powerW < 0 ? 'injection / production' : 'équilibre';
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
    <p class="card-msg muted small">Index du compteur gaz (mise à jour ~horaire — pas de mesure instantanée).</p>
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
        <div class="dname">${d.label}${d.cycles != null ? ` <span class="muted">· ${d.cycles} cycles</span>` : ''}</div></div>
      <div class="card-right">${right}</div>
    </div>
    <div class="spark">${sparklineSVG(d.spark, COL.battery)}</div>
  </div>`;
}

function cardBatteries(d) {
  const p = fmtPower(Math.abs(d.powerW ?? 0));
  const modes = { zero: 'Zéro injection', standby: 'Veille', to_full: 'Charge complète', predictive: 'Intelligent' };
  return `<div class="card">
    <div class="card-top">
      <div class="card-main"><div class="value">${valHtml(p.val, p.unit + ' · ' + powerStateLabel(d.powerW), 'c-battery')}</div>
        <div class="dname">${d.label}${d.batteryCount ? ` <span class="muted">· ${d.batteryCount} module(s)</span>` : ''}</div></div>
      <div class="card-right"><span class="tag ok">${modes[d.mode] || d.mode || '—'}</span></div>
    </div>
    <div class="spark">${sparklineSVG(d.spark, COL.battery)}</div>
  </div>`;
}

function renderCards(snapshot) {
  lastDevices = snapshot.devices || [];
  const c = $('cards');
  if (!lastDevices.length) {
    c.innerHTML = `<div class="card"><p class="muted">Aucun appareil suivi. Ouvrez l'onglet <b>Appareils</b> pour en ajouter.</p></div>`;
    return;
  }
  c.innerHTML = lastDevices.map(renderCard).join('');

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
    const t = new Date(snapshot.updatedAt).toLocaleTimeString('fr-FR');
    $('updated').textContent = 'Mis à jour à ' + t;
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
  const unit = kind === 'battery' ? 'Charge / puissance' : kind === 'water' ? 'Débit (L/min)' : 'Puissance (W)';
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
    el.innerHTML = `<p class="muted small">Aucun appareil. Découvrez le réseau ou ajoutez une IP.</p>`;
    return;
  }
  el.innerHTML = selected
    .map((d, i) => {
      const needPair = d.needsToken && !d.token;
      const pairUi = d.needsToken
        ? `<div class="pair">
             ${needPair
               ? `<button class="secondary pair-btn" data-i="${i}">🔗 Appairer</button>`
               : `<span class="tag-ok">🔑 token OK</span>`}
             <span class="muted small" id="pair-status-${i}"></span>
           </div>`
        : '';
      return `<div class="dev-wrap">
        <div class="dev">
          <span style="font-size:18px">${roleIcon(d.role)}</span>
          <div class="meta"><div class="name">${d.label}</div>
            <div class="sub">${d.ip} · ${d.productType || ''} · ${d.serial || ''}</div></div>
          <button class="rm" data-i="${i}" title="Retirer">✕</button>
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
  status.textContent = '👉 Pressez le bouton de la batterie maintenant (30 s)…';
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
    status.textContent = `✅ Appairé : ${info.label} (${info.productType})`;
  } else {
    status.textContent = '✅ Appairé !';
  }
  renderSelected();
}

async function runDiscover() {
  const btn = $('btn-discover');
  btn.disabled = true;
  $('discover-status').textContent = 'Scan du réseau en cours (jusqu\'à ~30 s)…';
  $('discovered').innerHTML = '';
  const found = await window.hwm.discover().finally(() => (btn.disabled = false));
  if (!found.length) {
    $('discover-status').textContent =
      "Aucun appareil trouvé. Vérifiez que l'API locale est activée dans l'app HomeWizard et que le PC est sur le même réseau. Vous pouvez aussi ajouter l'IP manuellement.";
    return;
  }
  $('discover-status').textContent = `${found.length} appareil(s) trouvé(s).`;
  $('discovered').innerHTML = found
    .map((d, i) => {
      const ok = !d.error;
      return `<div class="dev">
        <input type="checkbox" data-i="${i}" ${ok ? '' : 'disabled'} />
        <span style="font-size:18px">${roleIcon(d.role)}</span>
        <div class="meta"><div class="name">${d.label || d.mdnsName || 'Appareil'}</div>
          <div class="sub">${d.ip} · ${ok ? d.productType : 'erreur: ' + d.error}</div></div>
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
  $('manual-status').textContent = 'Test de ' + ip + '…';
  const info = await window.hwm.probeIp(ip);
  if (info.error) {
    $('manual-status').textContent = 'Échec : ' + info.error;
    return;
  }
  addDevice(info);
  $('manual-status').textContent = 'Ajouté : ' + info.label;
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
    el.innerHTML = `<p class="muted">Aucun appareil suivi.</p>`;
    return;
  }
  el.innerHTML = lastDevices
    .map((d) => {
      const head = `<div class="panel-head"><h2>${roleIcon(d.role)} ${d.label}</h2>
        <span class="badge">${d.productType || ''} · ${d.ip}</span></div>`;
      if (!d.online || !d.raw) {
        return `<div class="panel">${head}<p class="muted small">${
          d.needsPairing ? '🔗 Appairage requis pour lire les données.' : 'Hors ligne — ' + (d.errorMsg || 'injoignable')
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
  const cfg = await window.hwm.getConfig();
  selected = (cfg.devices || []).map((d) => ({ ...d }));
  renderSelected();

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
  status.textContent = 'Activation…';
  let r;
  try {
    r = await window.hwm.widgetActivate();
  } catch {
    r = { ok: false };
  }
  btn.disabled = false;
  if (r.ok) {
    status.classList.add('update-ok');
    status.textContent =
      '✅ Widget enregistré. Ajoute-le : clic droit sur le bureau → Modifier les widgets → « Home Wizard ».';
  } else if (r.reason === 'not-installed') {
    status.textContent =
      "⚠️ Widget pas encore installé : il se construit depuis les sources (dossier widget-mac/, voir le README).";
  } else {
    status.textContent = '⚠️ Activation impossible (' + (r.reason || 'erreur') + ').';
  }
}

// --------------------------------------------------------------------------
// Réglage du widget barre des tâches
// --------------------------------------------------------------------------
async function populateTraySettings() {
  const devSel = $('tray-device');
  devSel.innerHTML = selected.map((d) => `<option value="${d.serial}">${d.label}</option>`).join('');
  const tm = await window.hwm.getTrayMetric();
  if (tm && tm.serial) devSel.value = tm.serial;
  $('tray-type').value = (tm && tm.type) || 'off';
}

async function saveTraySettings() {
  const tm = { serial: $('tray-device').value, type: $('tray-type').value };
  await window.hwm.setTrayMetric(tm);
  $('tray-status').textContent = ' ✅ Indicateur appliqué';
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
  status.textContent = 'Vérification…';
  let r;
  try {
    r = await window.hwm.checkUpdates();
  } catch {
    r = { status: 'error' };
  }
  btn.disabled = false;

  if (r.status === 'update') {
    status.innerHTML =
      `🔆 Version ${r.latest} disponible (vous avez ${r.current}). ` +
      `<a href="#" id="dl-update" class="link">Télécharger</a>`;
    const dl = $('dl-update');
    if (dl)
      dl.addEventListener('click', (e) => {
        e.preventDefault();
        window.hwm.openExternal(r.url);
      });
  } else if (r.status === 'uptodate') {
    status.classList.add('update-ok');
    status.textContent = `✅ Vous êtes à jour (v${r.current})`;
  } else if (r.status === 'none') {
    status.textContent = `Aucune version publiée (actuelle : v${r.current})`;
  } else {
    status.textContent = '⚠️ Échec de la vérification (réseau ?)';
  }
}

init();
