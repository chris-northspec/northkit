import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

// Small real images for the photo tests, made here so nothing binary is committed.

/** A solid-colour JPEG with an APP1 "Exif" segment that carries a GPS-like marker string. */
export function jpegWithExif(width = 64, height = 48): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([200, 80, 40, 255], i * 4);
  const plain = Buffer.from(jpeg.encode({ data, width, height }, 85).data);
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0'),
    Buffer.from('II*\0GPSLatitude=51.5074;GPSLongitude=-0.1278;Make=SecretCamera'),
  ]);
  const segment = Buffer.alloc(4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(exif.length + 2, 2);
  // APP1 goes straight after the SOI marker.
  return Buffer.concat([plain.subarray(0, 2), segment, exif, plain.subarray(2)]);
}

/** A PNG with a tEXt chunk saying where it was taken. */
export function pngWithText(width = 40, height = 30): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set([20, 120, 200, 255], i * 4);
  const plain = PNG.sync.write(png);
  const text = Buffer.from('Comment\0GPS 51.5074,-0.1278 SecretCamera');
  const chunk = Buffer.alloc(12 + text.length);
  chunk.writeUInt32BE(text.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  text.copy(chunk, 8);
  // The CRC isn't checked by our stripper or by jsqr-style readers; zero is fine for a test file.
  const ihdrEnd = 8 + 12 + 13;
  return Buffer.concat([plain.subarray(0, ihdrEnd), chunk, plain.subarray(ihdrEnd)]);
}

/** A synthetic WebP: a VP8X header (EXIF flag set, 100 x 80), an EXIF chunk and a payload chunk. */
export function webpWithExif(): Buffer {
  const chunk = (name: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(name, 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08; // EXIF present
  vp8x.writeUIntLE(99, 4, 3);
  vp8x.writeUIntLE(79, 7, 3);
  const parts = [
    chunk('VP8X', vp8x),
    chunk('EXIF', Buffer.from('Exif\0\0GPSLatitude=51.5074;Make=SecretCamera')),
    chunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0, 0, 0, 0])),
  ];
  const body = Buffer.concat([Buffer.from('WEBP'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** GIF header bytes: not an accepted type, however it is named. */
export const GIF = Buffer.from(
  'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;',
  'latin1',
);

/** An SVG that tries to run a script. */
export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
