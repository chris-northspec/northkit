// Copied from NorthCore WMS (barcodes.test.ts, QR part). Code 128 labels are not needed yet.
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from '../src/barcodes/qr';

/** Draws a module matrix as RGBA pixels (with a quiet zone) for an independent decoder. */
function rasterise(matrix: boolean[][], scale = 4, quiet = 4) {
  const size = (matrix.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const offset = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
        }
    }),
  );
  return { pixels, size };
}

describe('QR codes', () => {
  it('encodes text that an independent decoder reads back', () => {
    for (const text of [
      'otpauth://totp/NorthKit%3Aa%40b.test?secret=JBSWY3DPEHPK3PXP&issuer=NorthKit',
      'GI-A-01',
      'NTH1/U1-GF-BAY-04',
    ]) {
      const { pixels, size } = rasterise(qrMatrix(text));
      expect(jsQR(pixels, size, size)?.data).toBe(text);
    }
  });

  it('refuses text that is not printable ASCII', () => {
    expect(() => qrMatrix('café')).toThrow(/ASCII/);
  });

  it('draws a self-contained SVG with a quiet zone and no outside references', () => {
    const svg = qrSvg('hello', { title: 'A <test> & "quote"' });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 29 29"/);
    expect(svg).toContain('<title>A &lt;test&gt; &amp; &quot;quote&quot;</title>');
    expect(svg).not.toMatch(/href|https?:\/\/(?!www.w3.org)/);
  });
});
