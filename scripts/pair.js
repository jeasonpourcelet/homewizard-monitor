'use strict';
// Boucle d'appairage v2 : POST /api/user pendant 90 s.
// Pressez le bouton de l'appareil pendant que ça tourne.
// Usage: node scripts/pair.js <ip> [nom]
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ip = process.argv[2];
const name = process.argv[3] || 'local/homewizard-monitor';
if (!ip) {
  console.error('Usage: node scripts/pair.js <ip>');
  process.exit(2);
}
const agent = new https.Agent({ rejectUnauthorized: false });
const tag = ip.replace(/\./g, '_');
const logFile = path.join(os.tmpdir(), 'hwm-pair-' + tag + '.log');
const tokenFile = path.join(os.tmpdir(), 'hwm-pair-' + tag + '.token');

function log(m) {
  const line = new Date().toISOString() + ' ' + m;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch {}
}

function post() {
  return new Promise((res) => {
    const body = JSON.stringify({ name });
    const req = https.request(
      { host: ip, port: 443, path: '/api/user', method: 'POST', agent, timeout: 5000,
        headers: { 'Content-Type': 'application/json', 'X-Api-Version': '2', 'Content-Length': Buffer.byteLength(body) } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch {}
        res({ status: r.statusCode, json: j });
      }); }
    );
    req.on('timeout', () => { req.destroy(); res({ status: 'timeout' }); });
    req.on('error', (e) => res({ status: 'err:' + e.message }));
    req.write(body); req.end();
  });
}

(async () => {
  try { fs.writeFileSync(logFile, ''); fs.rmSync(tokenFile, { force: true }); } catch {}
  log('=== Appairage ' + ip + ' : PRESSEZ LE BOUTON maintenant (fenêtre 90 s) ===');
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const r = await post();
    if (r.status === 200 && r.json && r.json.token) {
      log('SUCCESS token=' + r.json.token);
      fs.writeFileSync(tokenFile, r.json.token);
      process.exit(0);
    }
    const left = Math.round((90000 - (Date.now() - start)) / 1000);
    log('attente bouton… (' + r.status + (r.json && r.json.error ? ' ' + r.json.error : '') + ') — ' + left + 's restantes');
    await new Promise((r) => setTimeout(r, 1500));
  }
  log('TIMEOUT — bouton non détecté dans les 90 s.');
  process.exit(1);
})();
