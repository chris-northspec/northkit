import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OfflineReadyNote } from '@/components/offline/offline-ready-note';
import { StocktakeCount } from '@/components/move/stocktake-count';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Counting' };

/** The counting screen (S3-5). One cached page serves every count: the count is named in the address. */
export default async function CountPage() {
  await requirePermission('checkouts.create');
  return (
    <>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <StocktakeCount />
      </Suspense>
      <OfflineReadyNote path="/stocktake/count" />
    </>
  );
}
