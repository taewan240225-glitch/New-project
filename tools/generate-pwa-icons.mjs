import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const sizes = [192, 512];
const outputs = ["icons", "public/icons"];

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function mix(from, to, ratio) {
  return Math.round(from + (to - from) * ratio);
}

function paintPixel(buffer, size, x, y, color) {
  const offset = (y * size + x) * 4;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
  buffer[offset + 3] = color[3];
}

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function inCircle(x, y, cx, cy, radius) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const primary = [49, 93, 168];
  const secondary = [43, 151, 124];
  const soft = [236, 246, 244, 255];
  const white = [255, 255, 255, 255];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ratio = (x + y) / (size * 2);
      paintPixel(pixels, size, x, y, [
        mix(primary[0], secondary[0], ratio),
        mix(primary[1], secondary[1], ratio),
        mix(primary[2], secondary[2], ratio),
        255
      ]);
    }
  }

  const pad = size * 0.18;
  const left = pad;
  const right = size - pad;
  const top = size * 0.31;
  const bottom = size * 0.71;
  const radius = size * 0.08;
  const stripeTop = top + size * 0.08;
  const stripeBottom = stripeTop + size * 0.055;
  const coinX = size * 0.68;
  const coinY = size * 0.51;
  const coinRadius = size * 0.105;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inRoundedRect(x, y, left, top, right, bottom, radius)) {
        paintPixel(pixels, size, x, y, white);
      }
      if (y >= stripeTop && y <= stripeBottom && x >= left + radius && x <= right - radius) {
        paintPixel(pixels, size, x, y, soft);
      }
      if (inCircle(x, y, coinX, coinY, coinRadius)) {
        paintPixel(pixels, size, x, y, [255, 255, 255, 255]);
      }
      if (inCircle(x, y, coinX, coinY, coinRadius * 0.68)) {
        paintPixel(pixels, size, x, y, [49, 93, 168, 255]);
      }
      if (
        x >= coinX - coinRadius * 0.28 &&
        x <= coinX + coinRadius * 0.28 &&
        y >= coinY - coinRadius * 0.48 &&
        y <= coinY + coinRadius * 0.48
      ) {
        paintPixel(pixels, size, x, y, white);
      }
      if (
        y >= coinY - coinRadius * 0.05 &&
        y <= coinY + coinRadius * 0.05 &&
        x >= coinX - coinRadius * 0.45 &&
        x <= coinX + coinRadius * 0.45
      ) {
        paintPixel(pixels, size, x, y, white);
      }
    }
  }

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

for (const output of outputs) {
  await mkdir(output, { recursive: true });
}

for (const size of sizes) {
  const icon = makeIcon(size);
  await Promise.all(outputs.map((output) => writeFile(`${output}/icon-${size}.png`, icon)));
}
