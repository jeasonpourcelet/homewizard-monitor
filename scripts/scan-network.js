'use strict';
// Scans a /24 for HomeWizard devices (http v1 + https v2).
// Usage: node scripts/scan-network.js 192.168.1
const hw = require('../src/homewizard');

const base = process.argv[2];
if (!base || !/^\d+\.\d+\.\d+$/.test(base)) {
  console.error('Usage: node scripts/scan-network.js <first-three-octets>  e.g. 192.168.1');
  process.exit(1);
}

(async () => {
  console.log(`Scanning ${base}.1-254 (http + https)...`);
  const devices = await hw.scanSubnet(base);
  if (!devices.length) {
    console.log('No HomeWizard devices found.');
    return;
  }
  console.log(`Found ${devices.length} device(s):`);
  for (const d of devices) {
    console.log(
      `  ${d.ip.padEnd(15)} ${String(d.productType).padEnd(8)} ${d.label} ` +
        `(serial=${d.serial}, api=${d.apiVersion}${d.needsToken ? ', needs token' : ''})`
    );
  }
})().catch((e) => console.error('ERROR', e.message));
