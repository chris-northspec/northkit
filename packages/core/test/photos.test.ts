import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActorContext } from '../src/context';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/errors';
import { readStored } from '../src/files/storage';
import { createItem } from '../src/services/items';
import { listKinds } from '../src/services/kinds';
import {
  addItemPhoto,
  deleteItemPhoto,
  getItemPhoto,
  makePendingThumbnails,
} from '../src/services/photos';
import { imageInfo } from '../src/media/images';
import { fixtures, type Fixtures } from './fixtures';
import { GIF, jpegWithExif, pngWithText, SVG, webpWithExif } from './samples';

// S2-3 (acceptance A21): photos. Wrong type refused, oversize refused, EXIF removed from
// what is stored, another depot's photo is a 404, ten at most, thumbnails by the worker.

let f: Fixtures;
let dir: string;
let manager: ActorContext;
let operative: ActorContext;
let atB: ActorContext;
let itemId: string;
let siteA: string;
let kindId: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'northkit-files-'));
  process.env.NORTHKIT_FILES_DIR = dir;
  f = fixtures();
  siteA = await f.site(`PA${f.tag}`);
  const siteB = await f.site(`PB${f.tag}`);
  manager = await f.actor((await f.user({ roles: ['kit_manager'], siteIds: [siteA] })).id);
  operative = await f.actor((await f.user({ roles: ['operative'], siteIds: [siteA] })).id);
  atB = await f.actor((await f.user({ roles: ['kit_manager'], siteIds: [siteB] })).id);
  kindId = (await listKinds(f.db, manager))[0]!.id;
  itemId = (await createItem(f.db, manager, { siteId: siteA, kindId })).id;
});
afterAll(async () => {
  await f.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NORTHKIT_FILES_DIR;
});

describe('uploading', () => {
  it('refuses a GIF, an SVG and a script, whatever they are called', async () => {
    for (const bytes of [
      GIF,
      SVG,
      Buffer.from('<?php system($_GET["c"]); ?>'),
      Buffer.from('MZ\x90\x00'),
    ])
      await expect(addItemPhoto(f.db, manager, itemId, bytes)).rejects.toBeInstanceOf(
        ValidationError,
      );
  });

  it('refuses a photo over 10 MB and an empty file', async () => {
    const big = Buffer.concat([jpegWithExif(), Buffer.alloc(10 * 1024 * 1024)]);
    await expect(addItemPhoto(f.db, manager, itemId, big)).rejects.toMatchObject({
      message: expect.stringMatching(/10 MB/),
    });
    await expect(addItemPhoto(f.db, manager, itemId, Buffer.alloc(0))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses a damaged photo', async () => {
    await expect(
      addItemPhoto(f.db, manager, itemId, jpegWithExif().subarray(0, 40)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores JPEG, PNG and WebP with every metadata block removed', async () => {
    for (const [bytes, marker, type] of [
      [jpegWithExif(), 'SecretCamera', 'image/jpeg'],
      [pngWithText(), 'SecretCamera', 'image/png'],
      [webpWithExif(), 'SecretCamera', 'image/webp'],
    ] as const) {
      const photo = await addItemPhoto(f.db, manager, itemId, bytes);
      expect(photo.content_type).toBe(type);
      const stored = await readStored(photo.storage_key);
      expect(stored.includes(marker), type).toBe(false);
      expect(stored.includes('GPSLatitude') || stored.includes('GPS 51'), type).toBe(false);
      expect(imageInfo(stored)?.type).toBe(type);
      expect(photo.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('allows at most ten per item, and an operative can only look', async () => {
    await expect(addItemPhoto(f.db, operative, itemId, jpegWithExif())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const fresh = (await createItem(f.db, manager, { siteId: siteA, kindId })).id;
    for (let i = 0; i < 10; i++) await addItemPhoto(f.db, manager, fresh, jpegWithExif(8 + i, 8));
    await expect(addItemPhoto(f.db, manager, fresh, jpegWithExif())).rejects.toMatchObject({
      message: expect.stringMatching(/at most 10/),
    });
    // The refused eleventh left no file behind.
    expect(readdirSync(path.join(dir, 'items', fresh))).toHaveLength(10);
  });
});

describe('serving', () => {
  it('serves a photo to a person at the depot, and a depot B person gets the same not-found as for a missing one', async () => {
    const item = (await createItem(f.db, manager, { siteId: siteA, kindId })).id;
    const photo = await addItemPhoto(f.db, manager, item, jpegWithExif());
    const own = await getItemPhoto(f.db, operative, photo.id);
    expect(own.type).toBe('image/jpeg');
    expect(own.bytes.length).toBe(photo.byte_size);
    await expect(getItemPhoto(f.db, atB, photo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getItemPhoto(f.db, manager, '01a2b3c4-d5e6-7f80-9a1b-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(addItemPhoto(f.db, atB, item, jpegWithExif())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteItemPhoto(f.db, atB, photo.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes the row and the file', async () => {
    const item = (await createItem(f.db, manager, { siteId: siteA, kindId })).id;
    const photo = await addItemPhoto(f.db, manager, item, jpegWithExif());
    await deleteItemPhoto(f.db, manager, photo.id);
    await expect(getItemPhoto(f.db, manager, photo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readStored(photo.storage_key)).rejects.toThrow();
  });
});

describe('thumbnails (the worker)', () => {
  it('makes a JPEG thumbnail for a JPEG and a PNG, and marks a WebP as having none', async () => {
    const item = (await createItem(f.db, manager, { siteId: siteA, kindId })).id;
    const jpg = await addItemPhoto(f.db, manager, item, jpegWithExif(800, 500));
    const png = await addItemPhoto(f.db, manager, item, pngWithText(200, 100));
    const webp = await addItemPhoto(f.db, manager, item, webpWithExif());
    expect(await makePendingThumbnails(f.db, 100)).toBeGreaterThanOrEqual(2);
    const thumb = await getItemPhoto(f.db, manager, jpg.id, 'thumb');
    expect(thumb).toMatchObject({ thumbnail: true, type: 'image/jpeg' });
    expect(
      Math.max(imageInfo(thumb.bytes)!.width, imageInfo(thumb.bytes)!.height),
    ).toBeLessThanOrEqual(320);
    expect((await getItemPhoto(f.db, manager, png.id, 'thumb')).thumbnail).toBe(true);
    const fallback = await getItemPhoto(f.db, manager, webp.id, 'thumb');
    expect(fallback).toMatchObject({ thumbnail: false, type: 'image/webp' });
    const { rows } = await f.admin.query<{ thumb_failed: boolean }>(
      'SELECT thumb_failed FROM register.item_photos WHERE id = $1',
      [webp.id],
    );
    expect(rows[0]!.thumb_failed).toBe(true);
    // Nothing is left waiting from this item, so a second run makes none of its.
    const again = await f.admin.query(
      'SELECT 1 FROM register.item_photos WHERE item_id = $1 AND thumb_key IS NULL AND NOT thumb_failed',
      [item],
    );
    expect(again.rowCount).toBe(0);
  });
});
