// One-off generator for placeholder PWA/app icons (no image deps — hand-rolled PNG encoder).
// Run with: node scripts/generate-icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TOP_COLOR = [15, 23, 42]; // #0f172a
const BOTTOM_COLOR = [124, 58, 237]; // #7c3aed
const BAND_COLOR = [255, 255, 255];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function renderIcon(size, paddingFraction) {
  const data = Buffer.alloc(size * size * 4);
  const pad = size * paddingFraction;
  const barHeight = size * 0.22;
  const barLeft = pad;
  const barRight = size - pad;
  const cy = size / 2;
  const radius = barHeight / 2;
  const straightLeft = barLeft + radius;
  const straightRight = barRight - radius;

  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const bg = [
      lerp(TOP_COLOR[0], BOTTOM_COLOR[0], t),
      lerp(TOP_COLOR[1], BOTTOM_COLOR[1], t),
      lerp(TOP_COLOR[2], BOTTOM_COLOR[2], t)
    ];

    for (let x = 0; x < size; x++) {
      let inBand = false;
      if (x >= straightLeft && x <= straightRight) {
        inBand = Math.abs(y - cy) <= radius;
      } else if (x < straightLeft) {
        const dx = x - straightLeft;
        const dy = y - cy;
        inBand = Math.sqrt(dx * dx + dy * dy) <= radius;
      } else {
        const dx = x - straightRight;
        const dy = y - cy;
        inBand = Math.sqrt(dx * dx + dy * dy) <= radius;
      }

      const color = inBand ? BAND_COLOR : bg;
      const idx = (y * size + x) * 4;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
      data[idx + 3] = 255;
    }
  }

  return data;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function writeIcon(size, paddingFraction, filename) {
  const rgba = renderIcon(size, paddingFraction);
  const png = encodePNG(size, rgba);
  const outPath = path.join(__dirname, '..', 'public', 'icons', filename);
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${size}x${size})`);
}

writeIcon(192, 0.12, 'icon-192.png');
writeIcon(512, 0.12, 'icon-512.png');
writeIcon(512, 0.2, 'icon-512-maskable.png');
writeIcon(180, 0.14, 'apple-touch-icon.png');
writeIcon(32, 0.1, 'favicon-32.png');
