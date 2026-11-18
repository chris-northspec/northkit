import { describe, expect, it } from 'vitest';
import { imageInfo, sniffImage, stripMetadata } from '../src/media/images';
import { makeThumbnail, NoThumbnailError } from '../src/media/thumbnail';
import { GIF, jpegWithExif, pngWithText, SVG, webpWithExif } from './samples';

// S2-3: the type is decided by content, metadata is stripped, thumbnails are made without
// a native library. Acceptance A21 (photos): wrong type refused, EXIF removed.

describe('image type by content', () => {
  it('accepts JPEG, PNG and WebP and refuses everything else, whatever it is called', () => {
    expect(sniffImage(jpegWithExif())).toBe('image/jpeg');
    expect(sniffImage(pngWithText())).toBe('image/png');
    expect(sniffImage(webpWithExif())).toBe('image/webp');
    expect(sniffImage(GIF)).toBeNull();
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.4 not an image'))).toBeNull();
    expect(sniffImage(Buffer.from('MZ\x90\x00 an executable'))).toBeNull();
  });

  it('reads the size from the header', () => {
    expect(imageInfo(jpegWithExif(64, 48))).toEqual({ type: 'image/jpeg', width: 64, height: 48 });
    expect(imageInfo(pngWithText(40, 30))).toEqual({ type: 'image/png', width: 40, height: 30 });
    expect(imageInfo(webpWithExif())).toEqual({ type: 'image/webp', width: 100, height: 80 });
  });
});

describe('metadata is stripped', () => {
  it('removes EXIF and GPS from a JPEG and keeps a picture that still decodes', () => {
    const original = jpegWithExif();
    expect(original.includes('GPSLatitude')).toBe(true);
    const clean = Buffer.from(stripMetadata(original));
    expect(clean.includes('GPSLatitude')).toBe(false);
    expect(clean.includes('SecretCamera')).toBe(false);
    expect(clean.includes('Exif')).toBe(false);
    expect(imageInfo(clean)).toEqual({ type: 'image/jpeg', width: 64, height: 48 });
    expect(makeThumbnail(clean).length).toBeGreaterThan(100);
  });

  it('removes text chunks from a PNG', () => {
    const original = pngWithText();
    expect(original.includes('SecretCamera')).toBe(true);
    const clean = Buffer.from(stripMetadata(original));
    expect(clean.includes('SecretCamera')).toBe(false);
    expect(clean.includes('tEXt')).toBe(false);
    expect(imageInfo(clean)).toEqual({ type: 'image/png', width: 40, height: 30 });
  });

  it('removes the EXIF chunk from a WebP, clears its flag and fixes the size', () => {
    const original = webpWithExif();
    expect(original.includes('SecretCamera')).toBe(true);
    const clean = Buffer.from(stripMetadata(original));
    expect(clean.includes('SecretCamera')).toBe(false);
    expect(clean.includes('EXIF')).toBe(false);
    expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
    expect(clean[20]! & 0x08).toBe(0);
    expect(imageInfo(clean)).toEqual({ type: 'image/webp', width: 100, height: 80 });
  });

  it('refuses a truncated file rather than storing it', () => {
    expect(() => stripMetadata(jpegWithExif().subarray(0, 30))).toThrow();
  });
});

describe('thumbnails', () => {
  it('scales a JPEG down to at most 320 pixels on its longest side', () => {
    const big = jpegWithExif(1000, 600);
    const thumb = Buffer.from(makeThumbnail(big));
    const info = imageInfo(thumb)!;
    expect(info.type).toBe('image/jpeg');
    expect(Math.max(info.width, info.height)).toBe(320);
    expect(info.height).toBeLessThan(info.width);
  });

  it('makes one from a PNG, and none for a WebP', () => {
    expect(imageInfo(makeThumbnail(pngWithText(100, 100)))?.type).toBe('image/jpeg');
    expect(() => makeThumbnail(webpWithExif())).toThrow(NoThumbnailError);
  });
});
