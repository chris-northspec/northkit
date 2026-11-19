import type { Metadata } from 'next';
import { MissingFlow } from '@/components/move/missing-flow';
import { OfflineReadyNote } from '@/components/offline/offline-ready-note';
import { firstValues } from '@/lib/list-filters';
import { isUuid } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Report missing' };

/** Report missing (S3-2, CO-4): scan the item, say what happened, confirm. Works offline. */
export default async function MissingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('checkouts.create');
  const { item } = firstValues(await searchParams);
  return (
    <>
      <MissingFlow initialItemId={item && isUuid(item) ? item : undefined} />
      <OfflineReadyNote path="/move/missing" />
    </>
  );
}
