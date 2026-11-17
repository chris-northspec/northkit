import qrcode from 'qrcode-generator';

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/**
 * The module matrix of a QR code (true = dark), smallest version that fits. Made
 * here on the server with qrcode-generator (MIT); nothing is sent anywhere. Text is
 * encoded as bytes, so it must be ASCII (otpauth URIs and location codes are).
 */
export function qrMatrix(text: string, level: QrErrorCorrection = 'M'): boolean[][] {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('QR text must be printable ASCII.');
  const code = qrcode(0, level);
  code.addData(text, 'Byte');
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.isDark(row, col)),
  );
}

/**
 * A QR code as a self-contained SVG: one path, dark on white, with the four-module
 * quiet zone the standard asks for. Scales to any size the page gives it.
 */
export function qrSvg(text: string, options: { title?: string; level?: QrErrorCorrection } = {}) {
  const matrix = qrMatrix(text, options.level ?? 'M');
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  let path = '';
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    });
  });
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `shape-rendering="crispEdges" role="img">${title}` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}

function escapeXml(text: string): string {
  return text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}
