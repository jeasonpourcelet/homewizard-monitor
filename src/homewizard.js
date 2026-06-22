'use strict';

/**
 * Client for the HomeWizard Energy LOCAL API.
 * Official docs: https://api-documentation.homewizard.com/
 *
 * Two API versions coexist:
 *  - v1 (HTTP, no auth): P1 meter, Energy Socket, kWh meters, Watermeter.
 *      GET http://<ip>/api            -> device identity
 *      GET http://<ip>/api/v1/data    -> measurements
 *      GET http://<ip>/api/v1/state   -> socket on/off state (Energy Socket)
 *  - v2 (HTTPS, Bearer token): Plug-In Battery, recent P1 meters.
 *      POST https://<ip>/api/user        -> pairing (button press) -> token
 *      GET  https://<ip>/api/measurement -> measurements (incl. state_of_charge_pct)
 *      GET  https://<ip>/api/batteries   -> battery group state / control
 *
 * The local API has NO history, so day/month totals are computed by our storage
 * layer from the cumulative counters reported by each device.
 *
 * v2 TLS: devices present a self-signed certificate whose CN is
 * `appliance/{product_type}/{serial}` (does not match the IP), so host
 * verification is disabled (local network, personal use).
 */

const http = require('node:http');
const https = require('node:https');
const { Bonjour } = require('bonjour-service');

const insecureAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

/**
 * Known HomeWizard product types.
 *  - label: human readable name
 *  - role:  fine-grained role (grid / solar / socket / energy / water / battery)
 *  - kind:  measurement family used by the UI and storage (energy / water / battery)
 */
const PRODUCT_TYPES = {
  'HWE-P1': { label: 'P1 Meter', role: 'grid', kind: 'energy' },
  'HWE-SKT': { label: 'Energy Socket', role: 'socket', kind: 'energy' },
  'HWE-KWH1': { label: 'kWh Meter (1-phase)', role: 'energy', kind: 'energy' },
  'HWE-KWH3': { label: 'kWh Meter (3-phase)', role: 'energy', kind: 'energy' },
  'HWE-WTR': { label: 'Watermeter', role: 'water', kind: 'water' },
  'HWE-BAT': { label: 'Plug-In Battery', role: 'battery', kind: 'battery' },
  'HWE-DSP': { label: 'Energy Display', role: 'display', kind: 'none' },
  'SDM230-wifi': { label: 'kWh Meter (1-phase)', role: 'energy', kind: 'energy' },
  'SDM630-wifi': { label: 'kWh Meter (3-phase)', role: 'energy', kind: 'energy' },
};

function describeProduct(productType) {
  return PRODUCT_TYPES[productType] || { label: productType || 'Device', role: 'other', kind: 'energy' };
}

function num(v, fallback = null) {
  return typeof v === 'number' ? v : fallback;
}

// ---------------------------------------------------------------------------
// Low-level request helper (http or https, optional Bearer token)
// ---------------------------------------------------------------------------
function requestJson(url, { method = 'GET', token = null, body = null, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const lib = isHttps ? https : http;
    const headers = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (isHttps) headers['X-Api-Version'] = '2';
    let payload = null;
    if (body != null) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const opts = { method, headers, timeout: timeoutMs };
    if (isHttps) opts.agent = insecureAgent;

    const req = lib.request(url, opts, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try {
          json = buf ? JSON.parse(buf) : {};
        } catch {
          /* non-JSON */
        }
        resolve({ status: res.statusCode, json, raw: buf });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout on ${url}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getJsonOrThrow(url, opts) {
  const r = await requestJson(url, opts);
  if (r.status < 200 || r.status >= 300) {
    const err = (r.json && r.json.error) || `HTTP ${r.status}`;
    throw new Error(`${typeof err === 'object' ? JSON.stringify(err) : err} (${url})`);
  }
  return r.json;
}

// ---------------------------------------------------------------------------
// Identification — /api is unauthenticated on both v1 (http) and v2 (https)
// ---------------------------------------------------------------------------
async function probe(ip) {
  let info = null;
  try {
    info = await getJsonOrThrow(`http://${ip}/api`, { timeoutMs: 2500 });
  } catch {
    info = await getJsonOrThrow(`https://${ip}/api`, { timeoutMs: 2500 });
  }
  const desc = describeProduct(info.product_type);
  return {
    ip,
    serial: info.serial,
    productType: info.product_type,
    productName: info.product_name,
    firmware: info.firmware_version,
    apiVersion: info.api_version, // "v1" | "v2"
    label: desc.label,
    role: desc.role,
    kind: desc.kind,
    needsToken: desc.kind === 'battery' || info.api_version === 'v2',
  };
}

/**
 * Identifies a v2 device using its token (GET /api requires auth on v2).
 * Used right after pairing to learn the real product type / serial / role.
 */
async function probeWithToken(ip, token) {
  const info = await getJsonOrThrow(`https://${ip}/api`, { token, timeoutMs: 3000 });
  const desc = describeProduct(info.product_type);
  return {
    ip,
    serial: info.serial,
    productType: info.product_type,
    productName: info.product_name,
    firmware: info.firmware_version,
    apiVersion: info.api_version,
    label: desc.label,
    role: desc.role,
    kind: desc.kind,
    needsToken: true,
  };
}

// ---------------------------------------------------------------------------
// Measurements (normalized across every device type)
// ---------------------------------------------------------------------------
async function readDataV1(ip) {
  return getJsonOrThrow(`http://${ip}/api/v1/data`);
}
async function readStateV1(ip) {
  return getJsonOrThrow(`http://${ip}/api/v1/state`);
}
async function readMeasurementV2(ip, token) {
  return getJsonOrThrow(`https://${ip}/api/measurement`, { token });
}
async function readBatteries(ip, token) {
  return getJsonOrThrow(`https://${ip}/api/batteries`, { token });
}

/**
 * Reads a device and returns a normalized snapshot:
 *   { kind, powerW, importKwh, exportKwh, socPct, cycles, waterM3, flowLpm,
 *     gasM3, switchState, counters, raw }
 * `counters` is the cumulative set passed to storage for day/month deltas.
 */
async function readDevice(dev) {
  const kind = dev.kind || describeProduct(dev.productType).kind;

  // --- Battery (v2 / HTTPS) ---
  if (kind === 'battery' || dev.needsToken || dev.apiVersion === 'v2') {
    if (!dev.token) throw new Error('missing token (pairing required)');
    const m = await readMeasurementV2(dev.ip, dev.token);
    const importKwh = num(m.energy_import_kwh, 0);
    const exportKwh = num(m.energy_export_kwh, 0);
    return {
      kind: 'battery',
      powerW: num(m.power_w),
      importKwh,
      exportKwh,
      socPct: num(m.state_of_charge_pct),
      cycles: num(m.cycles),
      counters: { import: importKwh, export: exportKwh },
      raw: m,
    };
  }

  const d = await readDataV1(dev.ip);

  // --- Gas (virtual device derived from a P1 meter's gas index) ---
  if (kind === 'gas') {
    const gasM3 = num(d.total_gas_m3, 0);
    return { kind: 'gas', gasM3, counters: { gas: gasM3 }, raw: d };
  }

  // --- Watermeter ---
  if (kind === 'water') {
    const waterM3 = num(d.total_liter_m3, 0);
    return {
      kind: 'water',
      waterM3,
      flowLpm: num(d.active_liter_lpm),
      counters: { water: waterM3 },
      raw: d,
    };
  }

  // --- Energy family (P1 / socket / kWh meter) ---
  const importKwh = num(d.total_power_import_kwh ?? d.total_power_import_t1_kwh, 0);
  const exportKwh = num(d.total_power_export_kwh ?? d.total_power_export_t1_kwh, 0);
  const gasM3 = num(d.total_gas_m3);
  const counters = { import: importKwh, export: exportKwh };
  if (gasM3 != null) counters.gas = gasM3;

  const out = {
    kind: 'energy',
    powerW: num(d.active_power_w),
    importKwh,
    exportKwh,
    gasM3,
    counters,
    raw: d,
  };

  // Energy Socket: fetch on/off state (best effort).
  if (dev.role === 'socket') {
    try {
      const s = await readStateV1(dev.ip);
      out.switchState = !!s.power_on;
    } catch {
      /* state endpoint optional */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// v2 pairing (user/token creation)
// ---------------------------------------------------------------------------
async function tryCreateUser(ip, name = 'local/homewizard-monitor') {
  const r = await requestJson(`https://${ip}/api/user`, { method: 'POST', body: { name }, timeoutMs: 4000 });
  if (r.status === 200 && r.json && r.json.token) return { token: r.json.token };
  if (r.status === 403) return { pending: true }; // button not pressed yet
  throw new Error((r.json && r.json.error) || `HTTP ${r.status}`);
}

async function pairDevice(ip, { timeoutMs = 30000, onTick = () => {} } = {}) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    onTick(++attempt);
    try {
      const res = await tryCreateUser(ip);
      if (res.token) return res.token;
    } catch {
      /* transient, retry */
    }
    await sleep(1500);
  }
  throw new Error('Timed out: button not detected. Press the device button and retry.');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
/** mDNS discovery of `_hwenergy._tcp` services. */
function discover(durationMs = 5000) {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const found = new Map();
    const browser = bonjour.find({ type: 'hwenergy' }, (service) => {
      const ip = (service.addresses || []).find((a) => a.includes('.'));
      if (ip) found.set(ip, { ip, name: service.name });
    });
    setTimeout(() => {
      try {
        browser.stop();
        bonjour.destroy();
      } catch {}
      resolve([...found.values()]);
    }, durationMs);
  });
}

async function discoverAndProbe(durationMs = 5000) {
  const services = await discover(durationMs);
  const results = [];
  for (const svc of services) {
    try {
      results.push({ ...(await probe(svc.ip)), mdnsName: svc.name });
    } catch (e) {
      results.push({ ip: svc.ip, mdnsName: svc.name, error: e.message });
    }
  }
  return results;
}

/**
 * Subnet scan that probes every host of the /24 around `hintIp` and returns the
 * IP whose device serial matches `serial`. Used to self-heal when DHCP changes
 * a device IP (works without mDNS). Gentle batches to survive lossy Wi-Fi.
 */
/**
 * Scans a whole /24 (http v1 + https v2) and returns every identified
 * HomeWizard device. Works where mDNS fails (e.g. behind a second router) and
 * catches devices that don't answer ICMP / only listen on HTTPS (battery).
 * `base` is the first three octets, e.g. "192.168.1".
 */
async function scanSubnet(base, { concurrency = 16, timeoutMs = 1500 } = {}) {
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(`${base}.${i}`);
  const found = [];
  for (let i = 0; i < ips.length; i += concurrency) {
    const batch = ips.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (ip) => {
        for (const scheme of ['http', 'https']) {
          try {
            const r = await requestJson(`${scheme}://${ip}/api`, { timeoutMs });
            if (r.json && r.json.product_type) {
              const desc = describeProduct(r.json.product_type);
              return {
                ip,
                serial: r.json.serial,
                productType: r.json.product_type,
                productName: r.json.product_name,
                firmware: r.json.firmware_version,
                apiVersion: r.json.api_version,
                label: desc.label,
                role: desc.role,
                kind: desc.kind,
                needsToken: desc.kind === 'battery' || r.json.api_version === 'v2',
              };
            }
          } catch {}
        }
        return null;
      })
    );
    for (const r of results) if (r) found.push(r);
  }
  return found;
}

async function findBySerial(serial, hintIp, { concurrency = 12, timeoutMs = 1500 } = {}) {
  const base = hintIp.split('.').slice(0, 3).join('.');
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(`${base}.${i}`);
  for (let i = 0; i < ips.length; i += concurrency) {
    const batch = ips.slice(i, i + concurrency);
    const hits = await Promise.all(
      batch.map(async (ip) => {
        try {
          const r = await requestJson(`http://${ip}/api`, { timeoutMs });
          if (r.json && r.json.serial === serial) return ip;
        } catch {}
        try {
          const r = await requestJson(`https://${ip}/api`, { timeoutMs });
          if (r.json && r.json.serial === serial) return ip;
        } catch {}
        return null;
      })
    );
    const found = hits.find(Boolean);
    if (found) return found;
  }
  return null;
}

module.exports = {
  PRODUCT_TYPES,
  describeProduct,
  probe,
  probeWithToken,
  readDevice,
  readDataV1,
  readMeasurementV2,
  readBatteries,
  tryCreateUser,
  pairDevice,
  discover,
  discoverAndProbe,
  scanSubnet,
  findBySerial,
};
