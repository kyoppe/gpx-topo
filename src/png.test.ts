// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { decodePng, unfilter } from './png';

function crc32(bytes: Uint8Array) {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Filters each row with `filters[y % filters.length]` the way a PNG encoder does. */
function filterRows(data: Uint8Array, width: number, height: number, channels: number, filters: number[]) {
  const stride = width * channels;
  const out = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const f = filters[y % filters.length];
    out[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? data[y * stride + x - channels] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predict = [0, a, b, (a + b) >> 1, paeth][f];
      out[y * (stride + 1) + 1 + x] = (data[y * stride + x] - predict) & 255;
    }
  }
  return out;
}

async function png(width: number, height: number, colour: number, idat: Uint8Array<ArrayBuffer>, opts: { depth?: number; interlace?: number; split?: boolean } = {}) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = opts.depth ?? 8;
  ihdr[9] = colour;
  ihdr[12] = opts.interlace ?? 0;
  const z = await deflate(idat);
  const cut = opts.split ? z.length >> 1 : z.length;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z.subarray(0, cut)),
    ...(opts.split ? [chunk('IDAT', z.subarray(cut))] : []),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Every byte value, in no particular order, as a DEM tile's height bytes would be. */
function noise(n: number) {
  const out = new Uint8Array(n);
  let s = 12345;
  for (let i = 0; i < n; i += 1) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

describe('decodePng', () => {
  it('reads RGB pixels exactly through every row filter, across split IDAT chunks', async () => {
    const [w, h] = [7, 10];
    const pixels = noise(w * h * 3);
    const decoded = await decodePng(await png(w, h, 2, filterRows(pixels, w, h, 3, [0, 1, 2, 3, 4]), { split: true }));
    expect(decoded).toMatchObject({ width: w, height: h, channels: 3 });
    expect(Array.from(decoded!.data)).toEqual(Array.from(pixels));
  });

  it('reads RGBA pixels exactly', async () => {
    const [w, h] = [5, 6];
    const pixels = noise(w * h * 4);
    const decoded = await decodePng(await png(w, h, 6, filterRows(pixels, w, h, 4, [4, 3, 2, 1, 0])));
    expect(decoded).toMatchObject({ width: w, height: h, channels: 4 });
    expect(Array.from(decoded!.data)).toEqual(Array.from(pixels));
  });

  it('leaves layouts it does not read to the caller', async () => {
    const rows = filterRows(noise(4 * 4 * 3), 4, 4, 3, [0]);
    expect(await decodePng(await png(4, 4, 3, rows))).toBeNull();
    expect(await decodePng(await png(4, 4, 2, rows, { depth: 16 }))).toBeNull();
    expect(await decodePng(await png(4, 4, 2, rows, { interlace: 1 }))).toBeNull();
    expect(await decodePng(new TextEncoder().encode('<!doctype html>'))).toBeNull();
  });

  it('rejects unknown filters and short data', () => {
    const rows = filterRows(noise(2 * 2 * 3), 2, 2, 3, [0]);
    rows[0] = 9;
    expect(unfilter(rows, 2, 2, 3)).toBeNull();
    expect(unfilter(rows.subarray(0, 5), 2, 2, 3)).toBeNull();
  });
});
