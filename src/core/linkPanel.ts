/**
 * R82: shared pure logic for the Backlinks & Outgoing Links panes (㊷).
 *
 * Both panels want the same "sort + text-filter a list of link rows by a name
 * projection" behaviour, but features must never import one another (layering
 * rule), so the shared, testable core lives here. Pure — exported for the
 * dual-end probe (`window.__geodeLinkSortFilter`) and reused by both panels.
 *
 * `"default"` preserves the source order (the pre-R82 behaviour: backlinks by
 * source path, outgoing by document order) → zero regression on the default;
 * name-asc / name-desc are opt-in, mirroring R80's "relevance"-default design.
 */
export type LinkSortKey = "default" | "name-asc" | "name-desc";

/**
 * Keep only items whose projected name contains `filter` (case-insensitive,
 * trimmed; empty filter keeps all), then order by `sortKey`. `"default"` leaves
 * the (filtered) items in their original order. Pure, no mutation of `items`.
 */
export function sortAndFilterLinks<T>(
  items: readonly T[],
  getName: (item: T) => string,
  sortKey: LinkSortKey,
  filter: string,
): T[] {
  const needle = filter.trim().toLowerCase();
  const out = needle
    ? items.filter((it) => getName(it).toLowerCase().includes(needle))
    : [...items];
  if (sortKey === "name-asc") out.sort((a, b) => getName(a).localeCompare(getName(b)));
  else if (sortKey === "name-desc") out.sort((a, b) => getName(b).localeCompare(getName(a)));
  return out;
}
