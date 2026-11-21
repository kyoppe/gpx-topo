/** Pixels of an 8-bit, non-interlaced RGB or RGBA PNG, row by row with no padding. */
export type PngPixels = { width: number; height: number; channels: 3 | 4; data: Uint8Array };

/**
 * Reads the pixels straight from the PNG bytes. Canvas read-backs are not exact: browsers with fingerprint
 * protection (Brave Shields) add noise to them, and a DEM tile keeps its metres in the RGB bytes, where one
 * step of red is 655 m. Returns null for layouts it does not read (palette, grey, 16-bit, interlaced).
 */
export async function decodePng(bytes: Uint8Array): Promise<PngPixels | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 | null = null;
  const idat: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = bytes[at + 16];
      const colour = bytes[at + 17];
      const interlace = bytes[at + 20];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) return null;
      channels = colour === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      idat.push(bytes.slice(at + 8, at + 8 + length));
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (!channels || !width || !height || idat.length === 0) return null;
  const stream = new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  return unfilter(inflated, width, height, channels);
}

/** Undoes the per-row PNG filters (none, sub, up, average, Paeth) of inflated image data. */
export function unfilter(src: Uint8Array, width: number, height: number, channels: 3 | 4): PngPixels | null {
  const stride = width * channels;
  if (src.length < (stride + 1) * height) return null;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = src[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? data[row + x - channels] : 0;
      const b = y > 0 ? data[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? data[row - stride + x - channels] : 0;
      let predict: number;
      if (filter === 0) predict = 0;
      else if (filter === 1) predict = a;
      else if (filter === 2) predict = b;
      else if (filter === 3) predict = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else return null;
      data[row + x] = (src[from + x] + predict) & 255;
    }
  }
  return { width, height, channels, data };
}
