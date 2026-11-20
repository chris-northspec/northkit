import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { imageInfo, sniffImage } from './images';

// Thumbnails for the item page (S2-3), made by the worker. No native library: JPEG (jpeg-js,
// BSD) and PNG (pngjs, MIT) are decoded in JavaScript, and WebP through webp-wasm (MIT; the
// libwebp WebAssembly from Squoosh, Apache-2.0), in the worker only (K22, Chris 19 Nov 2026).
// Each is scaled down by averaging and written as a small JPEG.

export const THUMBNAIL_EDGE = 320;
/** Largest picture decoded for a thumbnail, in pixels, so a crafted file can't use all the memory. */
export const MAX_DECODE_PIXELS = 40_000_000;

export class NoThumbnailError extends Error {}

/**
 * A JPEG thumbnail no larger than THUMBNAIL_EDGE on its longest side, from a JPEG or PNG.
 * Synchronous, for the demo seed; the worker uses makeAnyThumbnail, which also takes WebP.
 */
export function makeThumbnail(bytes: Uint8Array): Uint8Array {
  const type = sniffImage(bytes);
  let width: number;
  let height: number;
  let data: Uint8Array;
  if (type === 'image/jpeg') {
    const image = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 512,
      maxResolutionInMP: MAX_DECODE_PIXELS / 1_000_000,
    });
    ({ width, height, data } = image);
  } else if (type === 'image/png') {
    const image = PNG.sync.read(Buffer.from(bytes));
    if (image.width * image.height > MAX_DECODE_PIXELS) throw new NoThumbnailError('Too large.');
    ({ width, height, data } = image);
  } else {
    throw new NoThumbnailError('No thumbnail for this type.');
  }
  return scaleToJpeg(width, height, data);
}

/**
 * The worker's thumbnail: JPEG, PNG or WebP. A WebP is decoded by libwebp (WebAssembly),
 * loaded on first use; its size is checked from the header before any pixel is decoded.
 */
export async function makeAnyThumbnail(bytes: Uint8Array): Promise<Uint8Array> {
  if (sniffImage(bytes) !== 'image/webp') return makeThumbnail(bytes);
  const info = imageInfo(bytes);
  if (!info) throw new NoThumbnailError('Not a readable WebP.');
  if (info.width * info.height > MAX_DECODE_PIXELS) throw new NoThumbnailError('Too large.');
  // A CommonJS module whose functions use `this`: call them on the module object itself.
  const webp = (await import('webp-wasm')).default;
  // The decoder reads the whole underlying ArrayBuffer, so it gets its own copy starting at
  // byte 0 (a Buffer from Node's pool has an offset), and it says null, not an error, when
  // the bytes aren't a WebP it can read.
  let image: { width: number; height: number; data: Uint8ClampedArray } | null;
  try {
    image = await webp.decode(new Uint8Array(bytes).buffer as ArrayBuffer);
  } catch {
    image = null;
  }
  if (!image) throw new NoThumbnailError('The WebP could not be decoded.');
  return scaleToJpeg(image.width, image.height, image.data);
}

/** Box average into a JPEG no larger than THUMBNAIL_EDGE on its longest side, over white. */
function scaleToJpeg(
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
): Uint8Array {
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(w * h * 4);
  // Box average: each output pixel is the mean of the source pixels it covers, over white.
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          const a = data[i + 3]! / 255;
          r += data[i]! * a + 255 * (1 - a);
          g += data[i + 1]! * a + 255 * (1 - a);
          b += data[i + 2]! * a + 255 * (1 - a);
          n += 1;
        }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return new Uint8Array(jpeg.encode({ data: out, width: w, height: h }, 80).data);
}
