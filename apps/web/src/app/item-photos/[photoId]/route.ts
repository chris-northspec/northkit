import { getItemPhoto, NotFoundError } from '@northkit/core';
import { db } from '@/lib/server/db';
import { imageResponse } from '@/lib/server/api';
import { isUuid } from '@/lib/server/load';
import { currentSession } from '@/lib/server/session';

/**
 * An item photo, only for a signed-in person with access to its depot (S2-3). A photo that
 * isn't there, isn't theirs to see, or whose address isn't a photo id is the same 404.
 * ?v=thumb asks for the thumbnail (the stored photo if the worker has none).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ photoId: string }> },
): Promise<Response> {
  const { photoId } = await params;
  const session = await currentSession();
  if (
    !session ||
    session.user.mustChangePassword ||
    session.user.mfaSetupRequired ||
    !isUuid(photoId)
  )
    return new Response('Not found', { status: 404 });
  const variant = new URL(request.url).searchParams.get('v') === 'thumb' ? 'thumb' : 'full';
  try {
    const photo = await getItemPhoto(db(), session.actor, photoId, variant);
    return imageResponse({ type: photo.type, bytes: photo.bytes });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response('Not found', { status: 404 });
    throw error;
  }
}
