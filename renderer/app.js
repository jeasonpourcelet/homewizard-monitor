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
let chartRange = 'day';    // live | day | week | month | year

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

// --------------------------------------------------------------------------
// Dashboard live
// --------------------------------------------------------------------------
function num(v, dp = 2) {
  return (v ?? 0).toFixed(dp);
}

function cardHead(d, badgeExtra = '') {
  return `<div class="card-head">
      <span class="card-title"><span class="dot"></span>${roleIcon(d.role)} ${d.label}</span>
      <span class="badge">${d.ip}${badgeExtra}</span>
    </div>`;
}

function renderCard(d) {
  if (!d.online) {
    const msg = d.needsPairing
      ? `🔗 Appairage requis — onglet <b>Appareils</b> → « Appairer », puis pressez le bouton de l'appareil.`
      : `Hors ligne — ${d.errorMsg || 'injoignable'}`;
    return `<div class="card">
      <div class="card-head">
        <span class="card-title"><span class="dot off"></span>${roleIcon(d.role)} ${d.label}</span>
        <span class="badge">${d.ip}</span>
      </div>
      <p class="muted small">${msg}</p>
    </div>`;
  }
  if (d.kind === 'gas') return cardGas(d);
  if (d.kind === 'water') return cardWater(d);
  if (d.kind === 'battery') return cardBattery(d);
  if (d.kind === 'batteries') return cardBatteries(d);
  return cardEnergy(d);
}

function cardBatteries(d) {
  const p = fmtPower(d.powerW);
  const charging = d.powerW > 0;
  const modes = { zero: 'Zéro injection', standby: 'Veille', to_full: 'Charge complète', predictive: 'Intelligent' };
  return `<div class="card">
    ${cardHead(d, d.batteryCount ? ' · ' + d.batteryCount + ' module(s)' : '')}
    <div class="power ${charging ? 'export' : d.powerW < 0 ? 'import' : ''}">${p.val}
      <small>${p.unit} ${d.powerW === 0 ? 'au repos' : charging ? 'en charge' : 'en décharge'}</small></div>
    <div class="totals">
      <div class="col"><div class="k">Mode</div><div class="v">${modes[d.mode] || d.mode || '—'}</div></div>
      <div class="col"><div class="k">Niveau (%)</div><div class="v muted">via app HomeWizard</div></div>
    </div>
  </div>`;
}

function cardGas(d) {
  return `<div class="card">
    ${cardHead(d)}
    <div class="power">${num(d.gasM3, 3)} <small>m³ total</small></div>
    <div class="totals">
      <div class="col"><div class="k">Aujourd'hui</div><div class="v">${num(d.day?.gas, 3)} m³</div></div>
      <div class="col"><div class="k">Ce mois</div><div class="v">${num(d.month?.gas, 2)} m³</div></div>
    </div>
  </div>`;
}

function cardEnergy(d) {
  const p = fmtPower(d.powerW);
  const dir = d.powerW > 0 ? 'import' : d.powerW < 0 ? 'export' : '';
  const dirLabel = d.powerW > 0 ? 'consommation' : d.powerW < 0 ? 'injection/production' : 'équilibre';
  const sw = d.switchState != null
    ? `<span class="tag-ok">${d.switchState ? '⏻ allumée' : '○ éteinte'}</span>` : '';
  // Hide the inline gas line if the user tracks gas as its own dedicated card.
  const hasGasCard = lastDevices.some((x) => x.kind === 'gas');
  const gas = d.gasM3 != null && !hasGasCard
    ? `<div class="subline">🔥 Gaz : ${num(d.gasM3, 2)} m³
         <span class="muted">· auj. ${num(d.day?.gas, 2)} m³ · mois ${num(d.month?.gas, 1)} m³</span></div>` : '';
  return `<div class="card">
    ${cardHead(d)}
    <div class="power ${dir}">${p.val} <small>${p.unit} ${dirLabel}</small> ${sw}</div>
    <div class="totals">
      <div class="col"><div class="k">Aujourd'hui</div>
        <div class="v"><span class="up">↑${num(d.day?.import)}</span>
        &nbsp;<span class="down">↓${num(d.day?.export)}</span> kWh</div></div>
      <div class="col"><div class="k">Ce mois</div>
        <div class="v"><span class="up">↑${num(d.month?.import, 1)}</span>
        &nbsp;<span class="down">↓${num(d.month?.export, 1)}</span> kWh</div></div>
    </div>
    ${gas}
  </div>`;
}

function cardWater(d) {
  const flow = d.flowLpm != null ? `${d.flowLpm} <small>L/min</small>` : '— <small>L/min</small>';
  return `<div class="card">
    ${cardHead(d)}
    <div class="power">${flow}</div>
    <div class="totals">
      <div class="col"><div class="k">Total</div><div class="v">${num(d.waterM3)} m³</div></div>
      <div class="col"><div class="k">Aujourd'hui</div><div class="v">${num(d.day?.water, 3)} m³</div></div>
      <div class="col"><div class="k">Ce mois</div><div class="v">${num(d.month?.water)} m³</div></div>
    </div>
  </div>`;
}

function gaugeSVG(pct, color) {
  const r = 40, c = 2 * Math.PI * r;
  const off = c * (1 - (pct ?? 0) / 100);
  return `<div class="gauge">
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="var(--line)" stroke-width="9"/>
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="${color}" stroke-width="9"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <div class="gauge-val">${pct != null ? pct + '%' : '—'}</div>
  </div>`;
}

function cardBattery(d) {
  const p = fmtPower(d.powerW);
  const soc = d.socPct != null ? Math.round(d.socPct) : null;
  const charging = d.powerW > 0;
  const stateLabel = d.powerW === 0 ? 'au repos' : charging ? 'en charge' : 'en décharge';
  const color = soc == null ? 'var(--muted)' : soc <= 20 ? 'var(--import)' : 'var(--battery)';
  return `<div class="card gauge-card">
    ${gaugeSVG(soc, color)}
    <div class="gauge-info">
      <div class="card-title" style="margin-bottom:8px"><span class="dot"></span>🔋 ${d.label}</div>
      <div class="power ${charging ? 'export' : d.powerW < 0 ? 'import' : ''}">${p.val}
        <small>${p.unit} ${stateLabel}</small></div>
      <div class="totals">
        <div class="col"><div class="k">Chargé auj.</div>
          <div class="v"><span class="down">${num(d.day?.import)}</span> kWh</div></div>
        <div class="col"><div class="k">Fourni auj.</div>
          <div class="v"><span class="up">${num(d.day?.export)}</span> kWh</div></div>
      </div>
      ${d.cycles != null ? `<div class="badge" style="margin-top:8px">${d.cycles} cycles</div>` : ''}
    </div>
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
// Graphique historique — vues : live / jour / semaine / mois / année
// --------------------------------------------------------------------------
let chartType = null; // 'bar' | 'line' (recrée le chart si le type change)

function setChart(type, labels, datasets) {
  if (chart && chartType !== type) {
    chart.destroy();
    chart = null;
  }
  chartType = type;
  if (!chart) {
    const ctx = $('chart').getContext('2d');
    chart = new Chart(ctx, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { labels: { color: '#8595a3', boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: '#8595a3', maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { ticks: { color: '#8595a3' }, grid: { color: '#25323d' } },
        },
      },
    });
  } else {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
  }
}

function barDatasets(kind, rows) {
  if (kind === 'water')
    return [{ label: 'Eau (m³)', data: rows.map((h) => h.water ?? 0), backgroundColor: '#38bdf8' }];
  if (kind === 'gas')
    return [{ label: 'Gaz (m³)', data: rows.map((h) => h.gas ?? 0), backgroundColor: '#fb7185' }];
  const ds = [
    { label: 'Import (kWh)', data: rows.map((h) => h.import ?? 0), backgroundColor: '#f59e0b' },
    { label: 'Export (kWh)', data: rows.map((h) => h.export ?? 0), backgroundColor: '#34d399' },
  ];
  if (rows.some((h) => h.gas != null))
    ds.push({ label: 'Gaz (m³)', data: rows.map((h) => h.gas ?? 0), backgroundColor: '#fb7185' });
  return ds;
}

async function refreshChart() {
  if (!chartSerial) return;
  const dev = lastDevices.find((d) => d.serial === chartSerial);
  const kind = dev?.kind || 'energy';

  if (chartRange === 'live') {
    const buf = await window.hwm.getLive(chartSerial);
    const labels = buf.map((p) => {
      const t = new Date(p.t);
      return String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    });
    const unit = kind === 'battery' ? 'Charge (%)' : kind === 'water' ? 'Débit (L/min)' : 'Puissance (W)';
    const color = kind === 'battery' ? '#34d399' : kind === 'water' ? '#38bdf8' : '#f59e0b';
    setChart('line', labels, [
      { label: unit, data: buf.map((p) => p.v), borderColor: color, backgroundColor: color,
        fill: false, pointRadius: 0, tension: 0.25, borderWidth: 2 },
    ]);
    return;
  }

  let rows;
  if (chartRange === 'day') rows = await window.hwm.getHistory(chartSerial, 30);
  else if (chartRange === 'week') rows = await window.hwm.getAggregated(chartSerial, 'week', 12);
  else if (chartRange === 'month') rows = await window.hwm.getAggregated(chartSerial, 'month', 12);
  else rows = await window.hwm.getAggregated(chartSerial, 'year', 5);

  const labels = rows.map((h) => (chartRange === 'day' ? h.date.slice(5) : h.date));
  setChart('bar', labels, barDatasets(kind, rows));
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
  ['overview', 'charts', 'devices'].forEach((v) => {
    $('view-' + v).hidden = v !== name;
  });
  if (name === 'charts') refreshChart();
  if (name === 'devices') populateTraySettings();
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
    if (currentView === 'charts' && chartRange === 'live') refreshChart();
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

  // Sélecteur de vue temporelle (Instantané / Jour / Semaine / Mois / Année).
  $('ranges').querySelectorAll('.seg').forEach((b) =>
    b.addEventListener('click', () => {
      chartRange = b.dataset.range;
      $('ranges').querySelectorAll('.seg').forEach((x) => x.classList.toggle('active', x === b));
      refreshChart();
    })
  );

  // Widget barre des tâches.
  $('btn-tray-save').addEventListener('click', saveTraySettings);

  // Si aucun appareil suivi, ouvrir directement l'onglet Appareils.
  if (!selected.length) switchView('devices');

  // Rafraîchit le graphique périodiquement (les totaux évoluent).
  setInterval(() => { if (currentView === 'charts') refreshChart(); }, 30000);
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

init();
