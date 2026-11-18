import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can, getItem, listKinds, listLocations, siteChoices } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { updateItemAction } from '../../actions';
import { ItemFields } from '../../item-fields';

export const metadata: Metadata = { title: 'Edit item' };

export default async function EditItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const session = await requirePermission('items.edit');
  const itemId = routeId((await params).itemId);
  const detail = await orNotFound(getItem(db(), session.actor, itemId));
  const { item } = detail;
  if (item.status === 'retired') redirect(`/items/${item.id}`);
  const [kinds, depots] = await Promise.all([
    listKinds(db(), session.actor, { activeOnly: true }),
    siteChoices(db(), session.actor),
  ]);
  // The item's own kind stays choosable even if it has since been deactivated.
  const kindOptions = kinds.some((k) => k.id === item.kind_id)
    ? kinds
    : [...kinds, { id: item.kind_id, name: `${detail.kindName} (deactivated)` }];
  const locations = can(session.actor, 'locations.view')
    ? await listLocations(db(), session.actor, item.site_id, { all: true })
    : [];
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/items">Items</Link> ›{' '}
        <Link href={`/items/${item.id}`}>{item.asset_number}</Link>
      </p>
      <h1>Edit {item.asset_number}</h1>
      <ActionForm
        action={updateItemAction.bind(null, item.id, item.row_version)}
        submitLabel="Save changes"
      >
        <ItemFields
          item={item}
          kinds={kindOptions}
          depots={depots}
          locations={locations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
          fixedDepot
        />
      </ActionForm>
    </>
  );
}
