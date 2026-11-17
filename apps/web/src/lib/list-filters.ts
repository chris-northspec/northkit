// Building list addresses that keep their other filters (B-3): the dashboard's cards
// open lists with filters in the address, the lists show them as removable chips, and
// changing one filter keeps the rest, including `?site=`.

export type Params = Record<string, string | undefined>;

/** `path?…` with `changes` applied to `params`; undefined or '' removes a key. */
export function hrefWith(path: string, params: Params, changes: Params = {}): string {
  const merged = { ...params, ...changes };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** The first value of each search parameter, as Next.js gives them to a page. */
export function firstValues(search: Record<string, string | string[] | undefined>): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(search))
    out[key] = Array.isArray(value) ? value[0] : value;
  return out;
}

export interface Chip {
  /** What the filter is, e.g. "Priority: Critical". */
  label: string;
  /** The same list without it. */
  removeHref: string;
}
