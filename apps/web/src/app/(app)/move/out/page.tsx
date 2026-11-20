import type { Metadata } from 'next';
import { CheckOutFlow } from '@/components/move/check-out-flow';
import { OfflineReadyNote } from '@/components/offline/offline-ready-note';
import { firstValues } from '@/lib/list-filters';
import { isUuid } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Check out' };

/** Check out (S3-2): scan one item or several, choose where they are going, confirm. Works offline. */
export default async function CheckOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('checkouts.create');
  const { item } = firstValues(await searchParams);
  return (
    <>
      <CheckOutFlow initialItemId={item && isUuid(item) ? item : undefined} />
      <OfflineReadyNote path="/move/out" />
    </>
  );
}
