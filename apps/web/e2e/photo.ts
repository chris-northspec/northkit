import jpeg from 'jpeg-js';

/** A small solid JPEG for the upload tests, made here so no image file is committed. */
export function jpegPhoto(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([60 + (i % width), 110, 160, 255], i * 4);
  return Buffer.from(jpeg.encode({ data, width, height }, 80).data);
}
