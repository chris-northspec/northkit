import 'server-only';
import { ITEM_STATUSES, STATUS_LABELS, type ItemFilters } from '@northkit/core';
import { hrefWith, type Chip, type Params } from '../list-filters';
import { isUuid } from './load';

// The item list's filters as they travel in the address (so a bookmark or a shared link
// shows the same list), and the removable chips that show them.

export interface ItemParams extends Params {
  q?: string;
  kind?: string;
  depot?: string;
  status?: string;
  own?: string;
  kits?: string;
  page?: string;
}

export function itemFilters(params: ItemParams): ItemFilters {
  const status = ITEM_STATUSES.find((s) => s === params.status);
  const page = Number(params.page);
  return {
    q: params.q?.trim() || undefined,
    kindId: params.kind && isUuid(params.kind) ? params.kind : undefined,
    siteId: params.depot && isUuid(params.depot) ? params.depot : undefined,
    status,
    ownership: params.own === 'owned' || params.own === 'hired_in' ? params.own : undefined,
    kits: params.kits === 'kits' || params.kits === 'in_kit' ? params.kits : undefined,
    page: Number.isInteger(page) && page > 0 ? page : undefined,
  };
}

/** Only the filter keys (no page), for links that start again from page 1. */
export function filterParams(params: ItemParams): Params {
  const { q, kind, depot, status, own, kits } = params;
  return { q, kind, depot, status, own, kits };
}

export function itemChips(
  params: ItemParams,
  names: { kinds: Map<string, string>; depots: Map<string, string> },
): Chip[] {
  const base = filterParams(params);
  const chip = (label: string, key: keyof ReturnType<typeof filterParams>): Chip => ({
    label,
    removeHref: hrefWith('/items', base, { [key]: undefined }),
  });
  const chips: Chip[] = [];
  if (params.q?.trim()) chips.push(chip(`Search: ${params.q.trim()}`, 'q'));
  if (params.kind && names.kinds.has(params.kind))
    chips.push(chip(`Kind: ${names.kinds.get(params.kind)}`, 'kind'));
  if (params.depot && names.depots.has(params.depot))
    chips.push(chip(`Depot: ${names.depots.get(params.depot)}`, 'depot'));
  const status = ITEM_STATUSES.find((s) => s === params.status);
  if (status) chips.push(chip(`Status: ${STATUS_LABELS[status]}`, 'status'));
  if (params.own === 'owned') chips.push(chip('Owned', 'own'));
  if (params.own === 'hired_in') chips.push(chip('Hired in', 'own'));
  if (params.kits === 'kits') chips.push(chip('Kits only', 'kits'));
  if (params.kits === 'in_kit') chips.push(chip('Items in a kit', 'kits'));
  return chips;
}
