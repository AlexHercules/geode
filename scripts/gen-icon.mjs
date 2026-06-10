// Generates app-icon.png (1024x1024 RGBA): rounded dark square + purple gem.
// Pure Node (zlib) so no image deps are needed.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const px = new Uint8Array(S * S * 4);

const inRoundedRect = (x, y, r) => {
  const m = 64; // margin
  const x0 = m, y0 = m, x1 = S - m, y1 = S - m;
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x < x1 - r) || (y >= y0 + r && y < y1 - r);
};

// gem: hexagon-ish diamond centered at (512, 512)
const gemPath = [
  [512, 240], [760, 420], [660, 790], [364, 790], [264, 420],
];
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!inRoundedRect(x, y, 180)) {
      px[i + 3] = 0;
      continue;
    }
    // background: deep slate
    let r = 30, g = 30, b = 36, a = 255;
    if (inPoly(x, y, gemPath)) {
      // purple gem with vertical gradient + simple facet shading
      const t = (y - 240) / 550;
      r = Math.round(139 + (108 - 139) * t);
      g = Math.round(124 + (92 - 124) * t);
      b = Math.round(246 + (231 - 246) * t);
      if (x < 512 && y < 512) { r += 25; g += 25; b += 6; }      // top-left facet highlight
      if (x >= 512 && y >= 512) { r -= 18; g -= 18; b -= 10; }   // bottom-right facet shade
    }
    px[i] = Math.min(255, Math.max(0, r));
    px[i + 1] = Math.min(255, Math.max(0, g));
    px[i + 2] = Math.min(255, Math.max(0, b));
    px[i + 3] = a;
  }
}

// ---- PNG encode ----
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(new URL("../app-icon.png", import.meta.url), png);
console.log("app-icon.png written:", png.length, "bytes");
