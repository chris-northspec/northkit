import type { Metadata } from 'next';
import Link from 'next/link';
import { can, listKinds, listLocations, siteChoices } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { EmptyState } from '@/components/states';
import { db } from '@/lib/server/db';
import { isUuid } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { createItemAction } from '../actions';
import { ItemFields } from '../item-fields';

export const metadata: Metadata = { title: 'Add an item' };

/**
 * Adding an item. The locations offered depend on the depot, so with more than one depot
 * the first step is choosing it (a plain form, no JavaScript needed); with one it is
 * skipped.
 */
export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ depot?: string }>;
}) {
  const session = await requirePermission('items.create');
  const depots = await siteChoices(db(), session.actor);
  const { depot: depotParam } = await searchParams;
  const chosen =
    depots.length === 1
      ? depots[0]
      : depots.find((d) => d.id === depotParam && isUuid(depotParam ?? ''));
  const kinds = (await listKinds(db(), session.actor, { activeOnly: true })).map((k) => ({
    id: k.id,
    name: k.name,
  }));

  if (depots.length === 0)
    return (
      <>
        <h1>Add an item</h1>
        <EmptyState title="You aren’t assigned to any depot yet">
          <p>Ask an administrator to add you to the depots you work at.</p>
        </EmptyState>
      </>
    );

  if (!chosen)
    return (
      <>
        <p className="breadcrumbs">
          <Link href="/items">Items</Link>
        </p>
        <h1>Add an item</h1>
        <form method="get" className="stack">
          <div className="field">
            <label htmlFor="depot">Which depot does it belong to?</label>
            <select id="depot" name="depot" className="input" required>
              <option value="">Choose a depot</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button type="submit" className="button button-primary">
              Continue
            </button>
          </div>
        </form>
      </>
    );

  const locations = can(session.actor, 'locations.view')
    ? await listLocations(db(), session.actor, chosen.id, { all: true })
    : [];
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/items">Items</Link>
      </p>
      <h1>Add an item at {chosen.code}</h1>
      <ActionForm action={createItemAction} submitLabel="Add item" pendingLabel="Adding…">
        <input type="hidden" name="siteId" value={chosen.id} />
        <ItemFields
          kinds={kinds}
          depots={[chosen]}
          locations={locations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
          hideDepot
        />
      </ActionForm>
    </>
  );
}
