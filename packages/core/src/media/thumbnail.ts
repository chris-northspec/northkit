import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sniffImage } from './images';

// Thumbnails for the item page (S2-3), made by the worker. Pure JavaScript (jpeg-js BSD,
// pngjs MIT): no native library. JPEG and PNG are decoded, scaled down by averaging and
// written as a small JPEG. WebP has no decoder here (a WebP decoder would be a new
// dependency), so a WebP gets no thumbnail and the page shows the stored photo scaled by
// the browser (K22).

export const THUMBNAIL_EDGE = 320;
/** Largest picture decoded for a thumbnail, in pixels, so a crafted file can't use all the memory. */
export const MAX_DECODE_PIXELS = 40_000_000;

export class NoThumbnailError extends Error {}

/** A JPEG thumbnail no larger than THUMBNAIL_EDGE on its longest side. */
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
