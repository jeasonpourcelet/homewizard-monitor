'use strict';

/**
 * Local storage + day/month aggregation.
 *
 * The local API exposes no history, so on every poll we record each device's
 * cumulative counters (kWh import/export, m³ water/gas, ...). "Today" / "this
 * month" totals are the difference between the current counter and its value at
 * the start of the period.
 *
 * Counters are a generic key->value map, so the same logic serves energy
 * (import/export[/gas]), water (water), and battery (import/export).
 *
 * Files (under Electron's userData dir):
 *   - config.json     : configured devices + settings
 *   - baselines.json  : counter values at the start of the current day/month
 *   - history.json    : consolidated daily deltas (for the charts)
 */

const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.configPath = path.join(dir, 'config.json');
    this.baselinePath = path.join(dir, 'baselines.json');
    this.historyPath = path.join(dir, 'history.json');

    this.config = this._read(this.configPath, { devices: [], pollIntervalMs: 2000 });
    this.baselines = this._read(this.baselinePath, {}); // serial -> {dayKey, dayStart, monthKey, monthStart}
    this.history = this._read(this.historyPath, {}); // serial -> { 'YYYY-MM-DD': {<counter>: delta} }
  }

  _read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  _write(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  saveConfig() {
    this._write(this.configPath, this.config);
  }
  setDevices(devices) {
    this.config.devices = devices;
    this.saveConfig();
  }
  getDevices() {
    return this.config.devices || [];
  }

  /** Updates a single device's IP in the persisted config (DHCP self-heal). */
  updateDeviceIp(serial, ip) {
    let changed = false;
    for (const d of this.config.devices || []) {
      if (d.serial === serial && d.ip !== ip) {
        d.ip = ip;
        changed = true;
      }
    }
    if (changed) this.saveConfig();
    return changed;
  }

  static dayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  static monthKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /** Per-key difference between two counter maps, rounded. */
  static _delta(now, start) {
    const out = {};
    for (const k of Object.keys(now)) out[k] = round3((now[k] ?? 0) - (start[k] ?? 0));
    return out;
  }

  /**
   * Records a poll for a device and returns its day/month totals.
   * `counters` = generic map, e.g. { import, export } or { water } or { import, export, gas }.
   */
  record(serial, counters, now = new Date()) {
    const dKey = Store.dayKey(now);
    const mKey = Store.monthKey(now);
    let b = this.baselines[serial];

    if (!b) {
      b = { dayKey: dKey, dayStart: { ...counters }, monthKey: mKey, monthStart: { ...counters } };
      this.baselines[serial] = b;
    }

    // New day: consolidate yesterday's delta into history, then reset baseline.
    if (b.dayKey !== dKey) {
      if (!this.history[serial]) this.history[serial] = {};
      this.history[serial][b.dayKey] = Store._delta(counters, b.dayStart);
      b.dayKey = dKey;
      b.dayStart = { ...counters };
      this._write(this.historyPath, this.history);
    }
    if (b.monthKey !== mKey) {
      b.monthKey = mKey;
      b.monthStart = { ...counters };
    }

    // Backfill counters that appeared after the baseline was created (e.g. gas
    // showing up later, or a device coming back online with a new metric) so
    // their first delta starts at 0 instead of the whole meter total.
    for (const k of Object.keys(counters)) {
      if (!(k in b.dayStart)) b.dayStart[k] = counters[k];
      if (!(k in b.monthStart)) b.monthStart[k] = counters[k];
    }

    this._write(this.baselinePath, this.baselines);

    return {
      day: Store._delta(counters, b.dayStart),
      month: Store._delta(counters, b.monthStart),
    };
  }

  /** Daily history for the last N days (each entry is a delta counter map). */
  getDailyHistory(serial, days = 30) {
    const out = [];
    const hist = this.history[serial] || {};
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = Store.dayKey(d);
      out.push({ date: key, ...(hist[key] || {}) });
    }
    return out;
  }
}

function round3(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

module.exports = { Store };
