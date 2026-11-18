// Photo handling without a native image library (sharp is out: LGPL). Copied from
// NorthKeep main (944121d) and extended with WebP. Only Uint8Array and DataView, no Node
// APIs, so it runs on the server and in tests alike.
//   - the type is decided from the bytes, never the file name or the type the browser sent
//   - width and height are read from the header
//   - every metadata block is stripped from the stored file: EXIF (with GPS), XMP, ICC,
//     comments and text chunks. Photos of items never keep where or when they were taken.

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
}

export const IMAGE_EXTENSION: Record<ImageType, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** The image type from its first bytes, or null for anything else (SVG, GIF, executables, PDFs...). */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length > JPEG.length && startsWith(bytes, JPEG)) return 'image/jpeg';
  if (bytes.length > PNG.length && startsWith(bytes, PNG)) return 'image/png';
  if (bytes.length > 20 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

interface Segment {
  marker: number;
  start: number;
  /** Offset just past the segment. */
  end: number;
}

/** JPEG segments up to the start of scan; throws on a malformed file. */
function jpegSegments(bytes: Uint8Array): { segments: Segment[]; scanStart: number } {
  const segments: Segment[] = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Not a well-formed JPEG.');
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) break;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2 || i + 2 + length > bytes.length) throw new Error('Not a well-formed JPEG.');
    const segment = { marker, start: i, end: i + 2 + length };
    segments.push(segment);
    if (marker === 0xda) return { segments, scanStart: segment.end };
    i = segment.end;
  }
  throw new Error('Not a well-formed JPEG.');
}

const IS_SOF = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

interface RiffChunk {
  name: string;
  start: number;
  /** Offset just past the chunk, including its padding byte. */
  end: number;
  size: number;
}

/** The chunks of a WebP (RIFF) file; throws on a malformed one. */
function webpChunks(bytes: Uint8Array): RiffChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(4, true) + 8;
  if (declared > bytes.length) throw new Error('Not a well-formed WebP.');
  const chunks: RiffChunk[] = [];
  let i = 12;
  while (i + 8 <= declared) {
    const size = view.getUint32(i + 4, true);
    const end = i + 8 + size + (size % 2);
    if (end > declared) throw new Error('Not a well-formed WebP.');
    chunks.push({ name: ascii(bytes, i, i + 4), start: i, end, size });
    i = end;
  }
  return chunks;
}

/** Type and size from the header, or null if the bytes aren't a readable JPEG, PNG or WebP. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const type = sniffImage(bytes);
  try {
    if (type === 'image/jpeg') {
      const sof = jpegSegments(bytes).segments.find((s) => IS_SOF(s.marker));
      if (!sof) return null;
      const height = (bytes[sof.start + 5]! << 8) | bytes[sof.start + 6]!;
      const width = (bytes[sof.start + 7]! << 8) | bytes[sof.start + 8]!;
      return width && height ? { type, width, height } : null;
    }
    if (type === 'image/png') {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (ascii(bytes, 12, 16) !== 'IHDR') return null;
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      return width && height ? { type, width, height } : null;
    }
    if (type === 'image/webp') {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const first = webpChunks(bytes)[0];
      if (!first) return null;
      const at = first.start + 8;
      let width = 0;
      let height = 0;
      if (first.name === 'VP8X') {
        width =
          1 +
          (view.getUint8(at + 4) | (view.getUint8(at + 5) << 8) | (view.getUint8(at + 6) << 16));
        height =
          1 +
          (view.getUint8(at + 7) | (view.getUint8(at + 8) << 8) | (view.getUint8(at + 9) << 16));
      } else if (first.name === 'VP8L') {
        const bits = view.getUint32(at + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      } else if (first.name === 'VP8 ') {
        width = view.getUint16(at + 6, true) & 0x3fff;
        height = view.getUint16(at + 8, true) & 0x3fff;
      }
      return width && height ? { type, width, height } : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Removes every metadata block, keeping only what draws the picture. */
export function stripMetadata(bytes: Uint8Array): Uint8Array {
  const type = sniffImage(bytes);
  if (type === 'image/jpeg') {
    const { segments, scanStart } = jpegSegments(bytes);
    // Keep the picture data; drop APP1-APP15 (EXIF, XMP, ICC, maker notes) and comments.
    // APP0 (JFIF) only says how to read the pixels.
    const kept = segments.filter(
      (s) => !(s.marker >= 0xe1 && s.marker <= 0xef) && s.marker !== 0xfe,
    );
    return concat([
      bytes.subarray(0, 2),
      ...kept.map((s) => bytes.subarray(s.start, s.end)),
      bytes.subarray(scanStart),
    ]);
  }
  if (type === 'image/png') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    const DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME', 'iCCP']);
    let i = 8;
    while (i + 12 <= bytes.length) {
      const length = view.getUint32(i);
      const name = ascii(bytes, i + 4, i + 8);
      const end = i + 12 + length;
      if (end > bytes.length) throw new Error('Not a well-formed PNG.');
      if (!DROP.has(name)) parts.push(bytes.subarray(i, end));
      i = end;
      if (name === 'IEND') break;
    }
    return concat(parts);
  }
  if (type === 'image/webp') {
    const DROP = new Set(['EXIF', 'XMP ', 'ICCP']);
    const kept = webpChunks(bytes).filter((c) => !DROP.has(c.name));
    const body = kept.map((c) => {
      const chunk = bytes.slice(c.start, c.end);
      // The extended header says which metadata chunks follow: clear those flags.
      if (c.name === 'VP8X') chunk[8] = chunk[8]! & ~(0x20 | 0x08 | 0x04);
      return chunk;
    });
    const out = concat([bytes.subarray(0, 12), ...body]);
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(4, out.length - 8, true);
    return out;
  }
  throw new Error('Only JPEG, PNG and WebP photos can be stored.');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Largest photo accepted, before and after stripping. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Photos per item. */
export const MAX_PHOTOS_PER_ITEM = 10;
