'use strict';

/**
 * Renders a small value (e.g. a battery percentage) onto a 32x32 PNG so it can
 * be used as a Windows tray icon — like a battery widget in the taskbar.
 * No native dependencies: a 3x5 bitmap font + a minimal PNG encoder.
 */

const zlib = require('node:zlib');

// 3x5 bitmap font (rows top→bottom, '1' = lit pixel).
const FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '%': ['101', '001', '010', '100', '101'],
  '.': ['000', '000', '000', '000', '010'],
  'k': ['100', '101', '110', '101', '101'],
  'W': ['101', '101', '101', '111', '101'],
  '-': ['000', '000', '111', '000', '000'],
  ' ': ['000', '000', '000', '000', '000'],
};

const SIZE = 32;

/** Builds the lit-pixel grid for a string (3-wide glyphs, 1px gaps). */
function buildGrid(text) {
  const glyphs = [...text].map((c) => FONT[c] || FONT[' ']);
  const gridH = 5;
  const gridW = glyphs.length * 3 + (glyphs.length - 1); // 1px gap between glyphs
  const grid = Array.from({ length: gridH }, () => new Array(gridW).fill(0));
  let x = 0;
  for (const g of glyphs) {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1') grid[r][x + c] = 1;
    x += 4; // 3 glyph + 1 gap
  }
  return { grid, gridW, gridH };
}

/**
 * Renders `text` to a 32x32 RGBA PNG Buffer.
 * fg = digit color [r,g,b], outline = dark edge color for contrast.
 * template = macOS template image: pixels are pure black (only alpha matters,
 *   macOS recolors them to fit the menu bar) and the contrast outline is dropped.
 */
// `size` = output canvas (square, for a system-like rounded highlight).
// `fill` = fraction of the canvas the text occupies (smaller = lighter glyph).
function renderValueIcon(text, { fg = [255, 255, 255], outline = [10, 14, 20], template = false, size = SIZE, fill = 0.86 } = {}) {
  if (template) fg = [0, 0, 0];
  const S = size;
  const { grid, gridW, gridH } = buildGrid(text || '');
  const usable = Math.max(1, Math.round(S * fill));
  const scale = Math.max(1, Math.min(Math.floor(usable / gridW), Math.floor(usable / gridH)));
  const drawW = gridW * scale;
  const drawH = gridH * scale;
  const offX = Math.floor((S - drawW) / 2);
  const offY = Math.floor((S - drawH) / 2);

  // 1 = foreground pixel, 2 = outline pixel
  const px = Array.from({ length: S }, () => new Array(S).fill(0));
  const setFg = (x, y) => {
    if (x >= 0 && x < S && y >= 0 && y < S) px[y][x] = 1;
  };
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!grid[gy][gx]) continue;
      for (let sy = 0; sy < scale; sy++)
        for (let sx = 0; sx < scale; sx++) setFg(offX + gx * scale + sx, offY + gy * scale + sy);
    }
  }
  // Outline: any empty pixel touching a foreground pixel. Skipped for template
  // images (a contrast halo makes no sense when macOS recolors the glyph).
  if (!template)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (px[y][x] !== 0) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < S && ny >= 0 && ny < S && px[ny][nx] === 1) {
            near = true;
            break;
          }
        }
      if (near) px[y][x] = 2;
    }
  }

  // Compose RGBA raw scanlines (filter byte 0 per row).
  const raw = Buffer.alloc(S * (1 + S * 4));
  for (let y = 0; y < S; y++) {
    const line = y * (1 + S * 4);
    raw[line] = 0;
    for (let x = 0; x < S; x++) {
      let color = [0, 0, 0, 0];
      if (px[y][x] === 1) color = [fg[0], fg[1], fg[2], 255];
      else if (px[y][x] === 2) color = [outline[0], outline[1], outline[2], 255];
      const o = line + 1 + x * 4;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
      raw[o + 3] = color[3];
    }
  }
  return encodePng(raw, S, S);
}

// Lightning-bolt outline (Feather "zap"), normalized to a 0..1 box.
const BOLT = [
  [0.5417, 0.0833],
  [0.125, 0.5833],
  [0.5, 0.5833],
  [0.4583, 0.9167],
  [0.875, 0.4167],
  [0.5, 0.4167],
];

function boltContains(x, y) {
  let inside = false;
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i];
    const [xj, yj] = BOLT[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Renders an anti-aliased lightning bolt to a `size`x`size` RGBA PNG Buffer.
 * color = [r,g,b] (default black, for a macOS template image where macOS
 *   recolors it). Edges are smoothed by SSx SS supersampling — no native deps.
 */
function renderBoltIcon(size = 44, { color = [0, 0, 0] } = {}) {
  const SS = 4;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const line = y * (1 + size * 4);
    raw[line] = 0;
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          if (boltContains(nx, ny)) hits++;
        }
      const o = line + 1 + x * 4;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
      raw[o + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  }
  return encodePng(raw, size, size);
}

// --- minimal PNG encoder ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(raw, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { renderValueIcon, renderBoltIcon };
