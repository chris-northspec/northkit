'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useOfflineUser } from '@/components/offline/offline-user';
import { putScans } from '@/lib/offline/store';
import { newId, submit } from '@/lib/offline/submit';

/**
 * Starts a count of a location (S3-5). The start is saved on the phone first and sent like any
 * other change, so a count can begin with no signal; the count screen opens straight away.
 */
export function StartCount({ locationId, name }: { locationId: string; name: string }) {
  const user = useOfflineUser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const begin = async () => {
    setBusy(true);
    setError(null);
    const id = newId();
    const r = await submit(user.id, [
      {
        opId: id,
        kind: 'stocktake_start',
        label: `Start counting ${name}`,
        href: `/stocktake/${id}`,
        group: `stocktake:${id}`,
        payload: { clientId: id, locationId, occurredAt: new Date().toISOString() },
      },
    ]);
    if (r.refused.length) {
      setError(r.refused[0]!.error);
      setBusy(false);
      return;
    }
    await putScans({
      userId: user.id,
      stocktakeId: id,
      items: [],
      locationId,
      startedAt: Date.now(),
    });
    router.push(`/stocktake/count?id=${id}&loc=${locationId}`);
  };
  return (
    <>
      <button
        type="button"
        className="button button-primary"
        disabled={busy}
        onClick={() => void begin()}
      >
        {busy ? 'Starting…' : `Count ${name}`}
      </button>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
