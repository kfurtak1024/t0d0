/**
 * Generates the app icons from scratch — no design tool, no binary blobs
 * checked in without provenance. Run `npm run icons` after changing the mark.
 *
 * The mark is the app's own object: a ring, three quarters filled, on the
 * brand ground. PNGs are encoded by hand because the alternative is a
 * dependency for four files that change once a year.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BG = [0xeb, 0xef, 0xf6];
const TRACK = [0xdf, 0xe5, 0xef];
const FILL = [0x3b, 0x6f, 0xd6];
const SUPERSAMPLE = 4;

/** Colour of one point in the mark, or null for the background. */
function sample(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.3;
  const width = size * 0.105;

  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.hypot(dx, dy);
  if (Math.abs(distance - radius) > width / 2) return null;

  // Angle from twelve o'clock, clockwise. Three quarters are filled.
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) angle += Math.PI * 2;
  return angle <= Math.PI * 1.5 ? FILL : TRACK;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SUPERSAMPLE;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const colour = sample(x + (sx + 0.5) * step, y + (sy + 0.5) * step, size) ?? BG;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          n++;
        }
      }
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const pixels = render(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="19.2" fill="none" stroke="#DFE5EF" stroke-width="6.7"/>
  <circle cx="32" cy="32" r="19.2" fill="none" stroke="#3B6FD6" stroke-width="6.7"
    stroke-linecap="butt" stroke-dasharray="90.5 120.6" transform="rotate(-90 32 32)"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "favicon.svg"), svg);
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(join(OUT, name), png(size));
  console.warn(`wrote public/${name}`);
}
console.warn("wrote public/favicon.svg");
