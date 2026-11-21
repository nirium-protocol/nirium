import { deflateSync, crc32 } from 'node:zlib';

/**
 * Generates a small PNG "doorstep photo" so the demo runs without real
 * pictures. In a courier app this is the camera image.
 */
export function samplePhoto(seed: number, w = 96, h = 64): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let x = seed * 2654435761 >>> 0;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let i = 0; i < w; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      const o = y * (w * 3 + 1) + 1 + i * 3;
      const door = i > w / 3 && i < (2 * w) / 3 && y > h / 4;
      raw[o] = door ? 120 + (seed * 40) % 100 : 40 + ((x >>> 24) & 31);
      raw[o + 1] = door ? 60 : 90 + ((x >>> 16) & 31);
      raw[o + 2] = door ? 30 : 140 + ((x >>> 8) & 31);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
