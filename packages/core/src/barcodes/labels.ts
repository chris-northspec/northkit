import PDFDocument from 'pdfkit';
import { itemLabelUrl, signItemCode } from './item-codes';
import { qrMatrix } from './qr';

// Printable QR labels as PDF (S2-4, LB-1). Every label carries the QR code, the asset
// number and the kind; the organisation's name is optional. No personal data, and nothing
// about the item beyond that: a scan with no login shows no more.
//
// Layouts. Sizes follow two label stocks that are common in UK offices and are sold by
// many makers (sizes given so you can check your own stock; a maker's name here means
// "same size as", not an endorsement):
//   a4-21   21 labels per A4 sheet (3 across, 7 down), each 63.5 x 38.1 mm
//   a4-65   65 labels per A4 sheet (5 across, 13 down), each 38.1 x 21.2 mm
//   single  one 100 x 50 mm label per page, for a label printer
// Print at 100% (no "fit to page") or the labels drift off their stickers.

const MM = 72 / 25.4;

export interface LabelLayout {
  id: 'a4-21' | 'a4-65' | 'single';
  name: string;
  pageWidth: number;
  pageHeight: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  left: number;
  top: number;
  pitchX: number;
  pitchY: number;
}

const mm = (n: number) => n * MM;

export const LABEL_LAYOUTS: Record<LabelLayout['id'], LabelLayout> = {
  'a4-21': {
    id: 'a4-21',
    name: 'A4 sheet, 21 labels (63.5 × 38.1 mm)',
    pageWidth: mm(210),
    pageHeight: mm(297),
    cols: 3,
    rows: 7,
    width: mm(63.5),
    height: mm(38.1),
    left: mm(7.2),
    top: mm(15.1),
    pitchX: mm(66.04),
    pitchY: mm(38.1),
  },
  'a4-65': {
    id: 'a4-65',
    name: 'A4 sheet, 65 labels (38.1 × 21.2 mm)',
    pageWidth: mm(210),
    pageHeight: mm(297),
    cols: 5,
    rows: 13,
    width: mm(38.1),
    height: mm(21.2),
    left: mm(4.7),
    top: mm(10.7),
    pitchX: mm(40.64),
    pitchY: mm(21.2),
  },
  single: {
    id: 'single',
    name: 'Single label, 100 × 50 mm',
    pageWidth: mm(100),
    pageHeight: mm(50),
    cols: 1,
    rows: 1,
    width: mm(100),
    height: mm(50),
    left: 0,
    top: 0,
    pitchX: mm(100),
    pitchY: mm(50),
  },
};

export function isLabelLayout(id: string): id is LabelLayout['id'] {
  return id in LABEL_LAYOUTS;
}

export interface LabelItem {
  id: string;
  assetNumber: string;
  kindName: string;
  labelVersion: number;
}

export interface LabelOptions {
  layout: LabelLayout['id'];
  /** Printed small on each label; leave out for none. */
  companyName?: string | null;
  /** Skip this many labels on the first sheet (a part-used sheet). */
  skip?: number;
  /** Where the QR codes point (NORTHKIT_PUBLIC_URL, or the request's address). */
  baseUrl?: string;
}

/** PDFKit's built-in fonts are Latin-1: anything else would print as a wrong letter. */
const latin = (text: string) => text.replace(/[^\x20-\x7e00a0-ÿ]/g, '?');

function drawLabel(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  layout: LabelLayout,
  item: LabelItem,
  options: LabelOptions,
): void {
  const pad = layout.id === 'a4-65' ? mm(1.5) : mm(3);
  const qrSize = Math.min(layout.height - pad * 2, layout.width * 0.48);
  const url = itemLabelUrl(signItemCode(item.id, item.labelVersion), options.baseUrl);
  const matrix = qrMatrix(url, 'M');
  const quiet = 2; // modules of white around the code, inside the label
  const cell = qrSize / (matrix.length + quiet * 2);
  const qx = x + pad;
  const qy = y + (layout.height - qrSize) / 2;
  doc.save();
  doc.rect(qx, qy, qrSize, qrSize).fill('#ffffff');
  doc.fillColor('#000000');
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark)
        doc.rect(qx + (c + quiet) * cell, qy + (r + quiet) * cell, cell + 0.02, cell + 0.02).fill();
    }),
  );
  const tx = qx + qrSize + pad;
  const tw = x + layout.width - tx - pad;
  const big = layout.id === 'a4-65' ? 7 : layout.id === 'single' ? 20 : 12;
  const small = layout.id === 'a4-65' ? 5.5 : layout.id === 'single' ? 11 : 8;
  let ty = y + (layout.height - (big + small * (options.companyName ? 2.4 : 1.3))) / 2;
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(big)
    .text(latin(item.assetNumber), tx, ty, {
      width: tw,
      lineBreak: false,
      ellipsis: true,
    });
  ty += big * 1.25;
  doc
    .font('Helvetica')
    .fontSize(small)
    .text(latin(item.kindName), tx, ty, { width: tw, lineBreak: false, ellipsis: true });
  if (options.companyName) {
    ty += small * 1.3;
    doc
      .fillColor('#444444')
      .fontSize(small * 0.9)
      .text(latin(options.companyName), tx, ty, { width: tw, lineBreak: false, ellipsis: true });
  }
  doc.restore();
}

/** The PDF for a list of items. Throws RangeError for an unknown layout. */
export async function renderLabels(
  items: readonly LabelItem[],
  options: LabelOptions,
): Promise<Buffer> {
  const layout = LABEL_LAYOUTS[options.layout];
  if (!layout) throw new RangeError('Unknown label layout.');
  const doc = new PDFDocument({
    size: [layout.pageWidth, layout.pageHeight],
    margin: 0,
    autoFirstPage: false,
    info: { Title: 'NorthKit labels', Producer: 'NorthKit' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const perPage = layout.cols * layout.rows;
  const skip = Math.min(Math.max(options.skip ?? 0, 0), perPage - 1);
  doc.addPage();
  items.forEach((item, index) => {
    const slot = index + skip;
    if (slot > 0 && slot % perPage === 0) doc.addPage();
    const n = slot % perPage;
    drawLabel(
      doc,
      layout.left + (n % layout.cols) * layout.pitchX,
      layout.top + Math.floor(n / layout.cols) * layout.pitchY,
      layout,
      item,
      options,
    );
  });
  if (items.length === 0) doc.font('Helvetica').fontSize(12).text('No items selected.', 40, 40);
  doc.end();
  return done;
}
