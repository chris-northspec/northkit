import type { Metadata } from 'next';
import { CheckInFlow } from '@/components/move/check-in-flow';
import { OfflineReadyNote } from '@/components/offline/offline-ready-note';
import { firstValues } from '@/lib/list-filters';
import { isUuid } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Check in' };

/** Check in (S3-2): scan the item, choose where it goes back to, add a condition note. Works offline. */
export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('checkouts.create');
  const { item } = firstValues(await searchParams);
  return (
    <>
      <CheckInFlow initialItemId={item && isUuid(item) ? item : undefined} />
      <OfflineReadyNote path="/move/in" />
    </>
  );
}
