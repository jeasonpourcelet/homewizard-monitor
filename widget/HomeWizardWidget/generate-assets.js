'use strict';
// Génère les PNG requis par le MSIX (logos + icône + screenshot), teal HomeWizard.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
// Solid RGBA PNG of size w x h.
function solidPng(w, h, rgb) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const line = y * (1 + w * 4);
    raw[line] = 0;
    for (let x = 0; x < w; x++) {
      const o = line + 1 + x * 4;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255;
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const teal = [30, 201, 168];
const dark = [20, 29, 37];
const base = __dirname;
const out = [
  ['Assets/Square44x44Logo.png', 44, 44, teal],
  ['Assets/Square44x44Logo.targetsize-24_altform-unplated.png', 24, 24, teal],
  ['Assets/Square150x150Logo.png', 150, 150, teal],
  ['Assets/StoreLogo.png', 50, 50, teal],
  ['Assets/SplashScreen.png', 620, 300, dark],
  ['ProviderAssets/Icon.png', 48, 48, teal],
  ['ProviderAssets/Screenshot.png', 300, 200, dark],
];
for (const [rel, w, h, rgb] of out) {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, solidPng(w, h, rgb));
  console.log('écrit ' + rel + ' (' + w + 'x' + h + ')');
}
