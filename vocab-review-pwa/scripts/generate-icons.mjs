// PWA用アイコンPNGを依存ライブラリなしで生成するスクリプト
// 使い方: node scripts/generate-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

// ---- PNG エンコード ----
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- 描画 ----
function makeIcon(size, { padding = 0 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const inRounded = (x, y, rx, ry, rw, rh, rad) => {
    if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
    const cx = Math.max(rx + rad, Math.min(x, rx + rw - rad));
    const cy = Math.max(ry + rad, Math.min(y, ry + rh - rad));
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2 || (x >= rx + rad && x < rx + rw - rad) || (y >= ry + rad && y < ry + rh - rad);
  };

  // 背景（インディゴ、角丸）
  const bgRad = padding > 0 ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (padding > 0 || inRounded(x, y, 0, 0, size, size, bgRad)) {
        // 上下グラデーション
        const t = y / size;
        set(x, y, Math.round(67 + t * 20), Math.round(56 + t * 12), Math.round(202 - t * 30));
      }
    }
  }

  // 白いカード
  const cw = size * 0.62;
  const ch = size * 0.46;
  const cx0 = (size - cw) / 2;
  const cy0 = (size - ch) / 2;
  const cardRad = size * 0.06;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x, y, cx0, cy0, cw, ch, cardRad)) {
        set(x, y, 250, 250, 252);
      }
    }
  }

  // カード上部の赤いバー（赤シートのイメージ）
  const barH = ch * 0.28;
  for (let y = Math.round(cy0 + ch * 0.15); y < Math.round(cy0 + ch * 0.15 + barH); y++) {
    for (let x = Math.round(cx0 + cw * 0.12); x < Math.round(cx0 + cw * 0.88); x++) {
      set(x, y, 225, 55, 70);
    }
  }
  // 下のグレー行（隠された答えのイメージ）
  const lineH = Math.max(2, Math.round(ch * 0.09));
  for (const ly of [0.58, 0.76]) {
    for (let y = Math.round(cy0 + ch * ly); y < Math.round(cy0 + ch * ly) + lineH; y++) {
      for (let x = Math.round(cx0 + cw * 0.12); x < Math.round(cx0 + cw * 0.7); x++) {
        set(x, y, 180, 186, 200);
      }
    }
  }
  return encodePng(size, size, px);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-512-maskable.png', 512, { padding: 1 }],
  ['apple-touch-icon.png', 180, { padding: 1 }]
];
for (const [name, size, opts] of targets) {
  fs.writeFileSync(path.join(outDir, name), makeIcon(size, opts));
  console.log('generated', name);
}
