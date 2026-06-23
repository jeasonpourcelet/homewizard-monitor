'use strict';
// Génère assets/tray.png (32x32) : un éclair jaune avec contour sombre,
// visible aussi bien sur une barre des tâches claire que sombre.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const S = 16; // grille logique, agrandie x2 -> 32px
// '#' = éclair, '.' = transparent
const ROWS = [
  '................',
  '................',
  '.........###....',
  '........###.....',
  '.......###......',
  '......####......',
  '.....######.....',
  '....######......',
  '.......###......',
  '......###.......',
  '.....###........',
  '....###.........',
  '...###..........',
  '..###...........',
  '................',
  '................',
];

const bolt = [255, 205, 20, 255]; // jaune
const edge = [30, 35, 45, 255]; // contour sombre

function isBolt(x, y) {
  if (y < 0 || y >= S || x < 0 || x >= S) return false;
  return ROWS[y][x] === '#';
}
function isEdge(x, y) {
  if (isBolt(x, y)) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (isBolt(x + dx, y + dy)) return true;
  return false;
}

// Fond optionnel (pour l'icône d'application 256px) : carré arrondi teal.
function buildRaw(scale, withBg) {
  const W = S * scale;
  const H = S * scale;
  const raw = Buffer.alloc(H * (1 + W * 4));
  const radius = withBg ? W * 0.22 : 0;
  const inRoundedRect = (x, y) => {
    const r = radius;
    const cx = Math.min(Math.max(x, r), W - 1 - r);
    const cy = Math.min(Math.max(y, r), H - 1 - r);
    return Math.hypot(x - cx, y - cy) <= r + 0.5;
  };
  for (let y = 0; y < H; y++) {
    const lineStart = y * (1 + W * 4);
    raw[lineStart] = 0;
    for (let x = 0; x < W; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      let px = [0, 0, 0, 0];
      if (withBg && inRoundedRect(x, y)) px = [17, 33, 39, 255]; // fond sombre
      if (isBolt(sx, sy)) px = bolt;
      else if (isEdge(sx, sy)) px = withBg ? bolt.map((v, i) => (i < 3 ? Math.round(v * 0.6) : 255)) : edge;
      const o = lineStart + 1 + x * 4;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = px[3];
    }
  }
  return { raw, W, H };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}

function encodePng({ raw, W, H }) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

// Icône du tray : 32px, fond transparent + contour pour contraste.
const tray = encodePng(buildRaw(2, false));
fs.writeFileSync(path.join(outDir, 'tray.png'), tray);
console.log('assets/tray.png généré (32x32, ' + tray.length + ' octets)');

// Icône d'application : 1024px, fond arrondi (electron-builder exige >=512px pour macOS).
const appIcon = encodePng(buildRaw(64, true));
fs.writeFileSync(path.join(outDir, 'icon.png'), appIcon);
console.log('assets/icon.png généré (1024x1024, ' + appIcon.length + ' octets)');
