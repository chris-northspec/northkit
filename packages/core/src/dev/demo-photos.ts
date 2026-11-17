import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

// Placeholder photos for the demo company (S2-6): drawn here in the style of the sign-in
// picture (a tagged item card on a plain ground, in ink, slate and a teal accent), so the
// demo has no stock photos and nothing that looks like a real person, site or product. The
// same tag always gives the same picture. Demo only: customers upload their own photos.

const W = 480;
const H = 320;
type Rgb = [number, number, number];
const PAPER: Rgb = [245, 243, 238];
const CARD: Rgb = [255, 255, 255];
const INK: Rgb = [27, 31, 36];
const SLATE: Rgb = [87, 95, 107];
const EDGE: Rgb = [200, 196, 186];

const KIND_BAND: Record<string, Rgb> = {
  ladder: [14, 116, 144],
  plant: [180, 83, 9],
  power_tool: [59, 91, 219],
  harness: [134, 49, 138],
  other: [21, 122, 85],
};

/** A deterministic UUID-shaped id from a tag, so re-seeding writes the same files. */
export function demoPhotoId(tag: string): string {
  const h = createHash('sha1').update(`northkit-demo-photo:${tag}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function demoPhotoPng(tag: string, kind: string): Buffer {
  const png = new PNG({ width: W, height: H });
  const rect = (x: number, y: number, w: number, h: number, c: Rgb) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const o = (yy * W + xx) * 4;
        png.data[o] = c[0];
        png.data[o + 1] = c[1];
        png.data[o + 2] = c[2];
        png.data[o + 3] = 255;
      }
  };
  rect(0, 0, W, H, PAPER);
  // A shelf line and a card standing on it.
  rect(40, 262, 400, 6, EDGE);
  rect(120, 60, 240, 192, EDGE);
  rect(123, 63, 234, 186, CARD);
  rect(123, 63, 234, 28, KIND_BAND[kind] ?? KIND_BAND.other!);
  // A QR-like block from the tag's hash.
  const bits = createHash('sha256').update(tag).digest();
  const cell = 9;
  for (let r = 0; r < 11; r++)
    for (let c = 0; c < 11; c++) {
      const finder = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
      const on = finder
        ? !(r % 2 === 1 && c % 2 === 1 && r < 3 && c < 3)
        : ((bits[(r * 11 + c) % 32]! >> ((r + c) % 8)) & 1) === 1;
      if (on) rect(146 + c * cell, 108 + r * cell, cell - 1, cell - 1, INK);
    }
  // Lines standing for text.
  rect(262, 112, 78, 8, SLATE);
  rect(262, 132, 56, 8, EDGE);
  rect(262, 152, 70, 8, EDGE);
  rect(262, 196, 78, 14, KIND_BAND[kind] ?? KIND_BAND.other!);
  return PNG.sync.write(png);
}
