import { createHash } from 'node:crypto';
import { sql, withScope, type Db, type ItemPhoto } from '@northkit/db';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';
import { uuidv7 } from '../ids';
import { readStored, removeStored, writeStored } from '../files/storage';
import {
  IMAGE_EXTENSION,
  imageInfo,
  MAX_PHOTO_BYTES,
  sniffImage,
  stripMetadata,
} from '../media/images';
import { makeThumbnail } from '../media/thumbnail';

// Item photos (S2-3, IT-2). Up to 10 per item, JPEG, PNG or WebP decided from the bytes,
// 10 MB each, metadata (EXIF and GPS) stripped before anything is stored. Photos are
// served only through getItemPhoto, which asks the database for the row under the
// caller's site scope: another depot's photo is a 404, exactly like one that doesn't
// exist. The worker makes the thumbnails (makePendingThumbnails).

export interface PhotoFile {
  bytes: Buffer;
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  /** True when this is the thumbnail, not the stored photo. */
  thumbnail: boolean;
}

export async function addItemPhoto(
  db: Db,
  actor: ActorContext,
  itemId: string,
  upload: Uint8Array,
): Promise<ItemPhoto> {
  requirePermission(actor, 'items.edit');
  if (upload.length === 0)
    throw new ValidationError('That file is empty.', { photo: 'Choose a photo.' });
  if (upload.length > MAX_PHOTO_BYTES)
    throw new ValidationError('That photo is larger than 10 MB.', {
      photo: 'Use a photo of 10 MB or less.',
    });
  const type = sniffImage(upload);
  if (!type)
    throw new ValidationError('Only JPEG, PNG and WebP photos can be added.', {
      photo: 'Use a JPEG, PNG or WebP photo.',
    });
  let clean: Uint8Array;
  try {
    clean = stripMetadata(upload);
  } catch {
    throw new ValidationError('That photo can’t be read.', {
      photo: 'The file is damaged or isn’t a photo.',
    });
  }
  const info = imageInfo(clean);
  if (!info)
    throw new ValidationError('That photo can’t be read.', {
      photo: 'The file is damaged or isn’t a photo.',
    });
  const id = uuidv7();
  const key = `items/${itemId}/${id}.${IMAGE_EXTENSION[type]}`;
  // Check the item is visible (and so in a depot the actor works at) before writing a file.
  const site = await withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    tx
      .selectFrom('register.items')
      .select(['site_id', 'status'])
      .where('id', '=', itemId)
      .executeTakeFirst(),
  );
  if (!site) throw new NotFoundError('Item not found.');
  if (site.status === 'retired') throw new ValidationError('A retired item can’t be changed.');
  await writeStored(key, clean);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      const { n } = await tx
        .selectFrom('register.item_photos')
        .select(sql<number>`coalesce(max(sort_order), -1) + 1`.as('n'))
        .where('item_id', '=', itemId)
        .executeTakeFirstOrThrow();
      return tx
        .insertInto('register.item_photos')
        .values({
          id,
          site_id: site.site_id,
          item_id: itemId,
          content_type: type,
          byte_size: clean.length,
          width: info.width,
          height: info.height,
          sha256: createHash('sha256').update(clean).digest('hex'),
          storage_key: key,
          sort_order: n,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    await removeStored(key);
    if ((error as { constraint?: string }).constraint === 'item_photos_max')
      throw new ValidationError('An item can have at most 10 photos.', {
        photo: 'This item already has 10 photos.',
      });
    throw error;
  }
}

/** A photo (or its thumbnail) for a signed-in person with access to its depot; NotFound otherwise. */
export async function getItemPhoto(
  db: Db,
  actor: ActorContext,
  photoId: string,
  variant: 'full' | 'thumb' = 'full',
): Promise<PhotoFile> {
  requirePermission(actor, 'items.view');
  const row = await withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    tx.selectFrom('register.item_photos').selectAll().where('id', '=', photoId).executeTakeFirst(),
  );
  if (!row) throw new NotFoundError('Photo not found.');
  try {
    if (variant === 'thumb' && row.thumb_key)
      return { bytes: await readStored(row.thumb_key), type: 'image/jpeg', thumbnail: true };
    return { bytes: await readStored(row.storage_key), type: row.content_type, thumbnail: false };
  } catch {
    throw new NotFoundError('Photo not found.');
  }
}

export async function deleteItemPhoto(db: Db, actor: ActorContext, photoId: string): Promise<void> {
  requirePermission(actor, 'items.edit');
  const row = await withScope(db, scopeOf(actor), async (tx) => {
    const photo = await tx
      .selectFrom('register.item_photos')
      .select(['storage_key', 'thumb_key'])
      .where('id', '=', photoId)
      .executeTakeFirst();
    if (!photo) throw new NotFoundError('Photo not found.');
    await tx.deleteFrom('register.item_photos').where('id', '=', photoId).execute();
    return photo;
  });
  await removeStored(row.storage_key);
  if (row.thumb_key) await removeStored(row.thumb_key);
}

/**
 * The worker's job: makes a thumbnail for photos that have none. A photo it can't decode
 * (a WebP, or a damaged file) is marked failed, so the page shows the stored photo and the
 * worker doesn't try again. Returns how many thumbnails it made.
 */
export async function makePendingThumbnails(db: Db, limit = 25): Promise<number> {
  const { rows } = await sql<{ id: string; storage_key: string }>`
    SELECT id, storage_key FROM register.photos_awaiting_thumbnail(${limit})`.execute(db);
  let made = 0;
  for (const photo of rows) {
    try {
      const thumb = makeThumbnail(await readStored(photo.storage_key));
      const key = photo.storage_key.replace(/\.(jpg|png|webp)$/, '.thumb.jpg');
      await writeStored(key, thumb);
      await sql`SELECT register.record_photo_thumbnail(${photo.id}::uuid, ${key})`.execute(db);
      made += 1;
    } catch {
      await sql`SELECT register.record_photo_thumbnail(${photo.id}::uuid, NULL)`.execute(db);
    }
  }
  return made;
}
