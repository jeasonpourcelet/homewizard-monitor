'use strict';

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
      ? `🔗 Appairage requis — ouvrez <b>⚙ Réglages</b> et cliquez « Appairer », puis pressez le bouton de l'appareil.`
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
  return cardEnergy(d);
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

function cardBattery(d) {
  const p = fmtPower(d.powerW);
  const soc = d.socPct != null ? Math.round(d.socPct) : null;
  const charging = d.powerW > 0;
  const battDir = d.powerW > 0 ? 'export' : d.powerW < 0 ? 'import' : '';
  return `<div class="card">
    ${cardHead(d, d.cycles != null ? ' · ' + d.cycles + ' cycles' : '')}
    ${soc != null
      ? `<div class="soc"><div class="soc-bar"><div class="soc-fill" style="width:${soc}%"></div></div>
         <span class="soc-val">${soc}%</span></div>` : ''}
    <div class="power ${battDir}">${p.val} <small>${p.unit} ${
      d.powerW === 0 ? 'au repos' : charging ? 'en charge' : 'en décharge'
    }</small></div>
    <div class="totals">
      <div class="col"><div class="k">Chargé auj.</div>
        <div class="v"><span class="down">${num(d.day?.import)}</span> kWh</div></div>
      <div class="col"><div class="k">Fourni auj.</div>
        <div class="v"><span class="up">${num(d.day?.export)}</span> kWh</div></div>
    </div>
  </div>`;
}

function renderCards(snapshot) {
  lastDevices = snapshot.devices || [];
  const c = $('cards');
  if (!lastDevices.length) {
    c.innerHTML = `<div class="card"><p class="muted">Aucun appareil suivi. Cliquez sur ⚙ pour en ajouter.</p></div>`;
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
// Graphique historique
// --------------------------------------------------------------------------
async function refreshChart() {
  if (!chartSerial) return;
  const dev = lastDevices.find((d) => d.serial === chartSerial);
  const kind = dev?.kind || 'energy';
  const hist = await window.hwm.getHistory(chartSerial, 30);
  const labels = hist.map((h) => h.date.slice(5));

  // Datasets depend on the device family.
  let datasets;
  if (kind === 'water') {
    datasets = [{ label: 'Eau (m³)', data: hist.map((h) => h.water ?? 0), backgroundColor: '#38bdf8' }];
  } else {
    datasets = [
      { label: 'Import (kWh)', data: hist.map((h) => h.import ?? 0), backgroundColor: '#f59e0b' },
      { label: 'Export (kWh)', data: hist.map((h) => h.export ?? 0), backgroundColor: '#34d399' },
    ];
    if (hist.some((h) => h.gas != null)) {
      datasets.push({ label: 'Gaz (m³)', data: hist.map((h) => h.gas ?? 0), backgroundColor: '#fb7185' });
    }
  }

  if (!chart) {
    const ctx = $('chart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#8a97a6', boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: '#8a97a6', maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { ticks: { color: '#8a97a6' }, grid: { color: '#2c3744' } },
        },
      },
    });
  } else {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
  }
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
  $('discover-status').textContent = 'Recherche en cours (≈5 s)…';
  $('discovered').innerHTML = '';
  const found = await window.hwm.discover();
  if (!found.length) {
    $('discover-status').textContent =
      "Aucun appareil trouvé. Vérifiez que l'API est activée dans l'app HomeWizard et que vous êtes sur le même Wi-Fi. Vous pouvez aussi ajouter l'IP manuellement.";
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
// Navigation
// --------------------------------------------------------------------------
function showSettings(show) {
  $('view-settings').hidden = !show;
  $('view-dashboard').hidden = show;
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
    if (!$('view-dashboard').hidden) {
      renderCards(s);
      updateHeader(s);
    }
  });

  $('btn-settings').addEventListener('click', () => showSettings(true));
  $('btn-back').addEventListener('click', () => showSettings(false));
  $('btn-discover').addEventListener('click', runDiscover);
  $('btn-add-ip').addEventListener('click', addManualIp);
  $('btn-save').addEventListener('click', async () => {
    await window.hwm.saveDevices(selected);
    showSettings(false);
  });
  $('hist-device').addEventListener('change', (e) => {
    chartSerial = e.target.value;
    refreshChart();
  });

  // Si aucun appareil suivi, ouvrir directement les réglages.
  if (!selected.length) showSettings(true);

  // Rafraîchit le graphique périodiquement (les totaux jour évoluent).
  setInterval(() => { if (!$('view-dashboard').hidden) refreshChart(); }, 30000);
}

init();
