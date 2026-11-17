import { inflateSync } from 'node:zlib';
import jsQR from 'jsqr';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { signItemCode, verifyItemCode } from '../src/barcodes/item-codes';
import { LABEL_LAYOUTS, renderLabels, type LabelItem } from '../src/barcodes/labels';

// S2-4: signed QR labels. A21/A22: the token is opaque and a forged one resolves to
// nothing; the QR decodes from the generated PDF itself.

const ITEM = '01a2b3c4-d5e6-7f80-9a1b-2c3d4e5f6071';

describe('label codes', () => {
  it('round-trips an item and a version', () => {
    const code = signItemCode(ITEM, 3);
    expect(code).toHaveLength(62);
    expect(verifyItemCode(code)).toEqual({ itemId: ITEM, version: 3 });
  });

  it('is stable for the same item and version, and changes with the version', () => {
    expect(signItemCode(ITEM, 1)).toBe(signItemCode(ITEM, 1));
    expect(signItemCode(ITEM, 1)).not.toBe(signItemCode(ITEM, 2));
  });

  it('never carries the item id in plain, hex or base64 form', () => {
    const code = signItemCode(ITEM, 1);
    const raw = Buffer.from(ITEM.replace(/-/g, ''), 'hex');
    expect(code.includes(ITEM)).toBe(false);
    expect(code.includes(ITEM.replace(/-/g, ''))).toBe(false);
    expect(code.includes(raw.toString('base64url').slice(0, 12))).toBe(false);
    expect(Buffer.from(code, 'base64url').includes(raw)).toBe(false);
  });

  it('rejects a changed, shortened or invented code the same way', () => {
    const code = signItemCode(ITEM, 1);
    const flipped = code.slice(0, 30) + (code[30] === 'A' ? 'B' : 'A') + code.slice(31);
    for (const bad of [
      flipped,
      code.slice(1),
      `${code}A`,
      '',
      'x'.repeat(62),
      '../../etc/passwd',
      ITEM,
    ])
      expect(verifyItemCode(bad), bad).toBeNull();
  });
});

const ITEMS: LabelItem[] = Array.from({ length: 70 }, (_, i) => ({
  id: `01a2b3c4-d5e6-7f80-9a1b-${String(i).padStart(12, '0')}`,
  assetNumber: `TEST-${String(i + 1).padStart(6, '0')}`,
  kindName: 'Ladder',
  labelVersion: 1,
}));

async function pdfPages(bytes: Buffer): Promise<{ pages: number; text: string[] }> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const text: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    text.push(
      content.items
        .map((i) => ('str' in i ? i.str : ''))
        .join('')
        .replace(/\s+/g, ''),
    );
  }
  const pages = doc.numPages;
  await task.destroy();
  return { pages, text };
}

/** The filled rectangles that make up one label's QR, read from the PDF's own drawing commands. */
function qrRects(pdf: Buffer, region: { x0: number; x1: number; y0: number; y1: number }) {
  const raw = pdf.toString('latin1');
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const r of content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)) {
      const [x, y, w, h] = [r[1], r[2], r[3], r[4]].map(Number) as [number, number, number, number];
      if (x >= region.x0 && x < region.x1 && y >= region.y0 && y < region.y1)
        rects.push({ x, y, w, h });
    }
  }
  return rects;
}

function decode(rects: { x: number; y: number; w: number; h: number }[]): string | undefined {
  // The white background is the biggest rectangle; the dark modules are the small ones.
  const modules = rects.filter((r) => r.w < 3 && r.h < 3);
  const cell = Math.min(...modules.map((m) => m.w)) - 0.02;
  const minX = Math.min(...modules.map((m) => m.x));
  const minY = Math.min(...modules.map((m) => m.y));
  const cols = Math.round((Math.max(...modules.map((m) => m.x)) - minX) / cell) + 1;
  const rows = Math.round((Math.max(...modules.map((m) => m.y)) - minY) / cell) + 1;
  const size = Math.max(cols, rows) + 8;
  const scale = 4;
  const px = size * scale;
  const pixels = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const m of modules) {
    const cx = Math.round((m.x - minX) / cell) + 4;
    const cy = Math.round((m.y - minY) / cell) + 4;
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const o = ((cy * scale + dy) * px + cx * scale + dx) * 4;
        pixels[o] = pixels[o + 1] = pixels[o + 2] = 0;
      }
  }
  return jsQR(pixels, px, px)?.data;
}

describe('label PDFs', () => {
  it('prints 21 to an A4 sheet and starts a new page after that, with the asset number on each', async () => {
    const pdf = await renderLabels(ITEMS.slice(0, 25), {
      layout: 'a4-21',
      baseUrl: 'https://kit.example.test',
    });
    const { pages, text } = await pdfPages(pdf);
    expect(pages).toBe(2);
    expect(text[0]).toContain('TEST-000001');
    expect(text[0]).toContain('TEST-000021');
    expect(text[0]).not.toContain('TEST-000022');
    expect(text[1]).toContain('TEST-000022');
    expect(text[0]).toContain('Ladder');
  });

  it('prints 65 to an A4 sheet', async () => {
    const pdf = await renderLabels(ITEMS, { layout: 'a4-65', baseUrl: 'https://kit.example.test' });
    const { pages, text } = await pdfPages(pdf);
    expect(pages).toBe(2);
    expect(text[0]).toContain('TEST-000065');
    expect(text[1]).toContain('TEST-000066');
  });

  it('prints one 100 x 50 mm page per label, and can skip used slots on a part-used sheet', async () => {
    const single = await pdfPages(await renderLabels(ITEMS.slice(0, 3), { layout: 'single' }));
    expect(single.pages).toBe(3);
    const skipped = await pdfPages(
      await renderLabels(ITEMS.slice(0, 2), { layout: 'a4-21', skip: 20 }),
    );
    expect(skipped.pages).toBe(2);
    expect(skipped.text[0]).toContain('TEST-000001');
    expect(skipped.text[1]).toContain('TEST-000002');
  });

  it('shows the organisation name only when asked', async () => {
    const on = await pdfPages(
      await renderLabels(ITEMS.slice(0, 1), {
        layout: 'a4-21',
        companyName: 'Fernbrook Contracting',
      }),
    );
    const off = await pdfPages(await renderLabels(ITEMS.slice(0, 1), { layout: 'a4-21' }));
    expect(on.text[0]).toContain('Fernbrook');
    expect(off.text[0]).not.toContain('Fernbrook');
  });

  for (const id of ['a4-21', 'a4-65', 'single'] as const) {
    it(`the QR on a ${id} label decodes from the PDF to the signed address`, async () => {
      const layout = LABEL_LAYOUTS[id];
      const pdf = await renderLabels(ITEMS.slice(0, 1), {
        layout: id,
        baseUrl: 'https://kit.example.test',
      });
      // PDFKit's page origin is the top left once its initial flip is applied: the first label is the top left cell.
      const rects = qrRects(pdf, {
        x0: layout.left,
        x1: layout.left + layout.width,
        y0: layout.top,
        y1: layout.top + layout.height,
      });
      const url = decode(rects);
      expect(url).toBe(`https://kit.example.test/i/${signItemCode(ITEMS[0]!.id, 1)}`);
      expect(verifyItemCode(url!.split('/i/')[1]!)).toEqual({ itemId: ITEMS[0]!.id, version: 1 });
    });
  }

  it('refuses an unknown layout', async () => {
    await expect(renderLabels(ITEMS, { layout: 'a3' as never })).rejects.toThrow(RangeError);
  });
});
