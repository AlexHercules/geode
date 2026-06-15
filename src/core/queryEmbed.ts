/**
 * Query embed (R75, ㊲) — single source of truth for ```query blocks. Runs the
 * search engine (core/search.ts) over the vault and renders a grouped, clickable
 * result list. Consumed by BOTH the reading-view hydrate pass (core/embeds.ts)
 * and the live-preview block widget (features/editor/liveQuery.ts) — same data,
 * same DOM, so they never drift.
 *
 * v1 renders file groups + counts; result rows are `a.internal-link[data-target]`
 * so the caller's existing click delegation navigates (no HydrateContext change).
 * Per-line match snippets are deferred (deriveLineHits is still SearchPanel-local).
 */
import { t } from "./i18n";
import { evaluateSearch, parseSearchQuery, type SearchInput } from "./search";
import type { MetadataIndex } from "./metadata";
import type { Vault } from "./vault";

export interface QueryFileHit {
  path: string;
  basename: string;
  /** number of content + name matches in this file */
  count: number;
}
export interface QueryBlockResult {
  /** present when the query string failed to parse */
  error?: string;
  /** number of matched files */
  total: number;
  files: QueryFileHit[];
}
export interface QueryBlockContext {
  vault: Vault;
  metadata: MetadataIndex;
}

/** Execute a ```query block body against the whole vault. Async (reads files),
 *  pure data — no DOM. Drives the desktop probe. */
export async function runQueryBlock(raw: string, ctx: QueryBlockContext): Promise<QueryBlockResult> {
  const parsed = parseSearchQuery(raw);
  if (parsed.error) return { error: parsed.error.detail ?? parsed.error.code, total: 0, files: [] };
  if (!parsed.expr) return { total: 0, files: [] }; // empty query → empty result
  const expr = parsed.expr;

  const hits: QueryFileHit[] = [];
  for (const f of ctx.vault.getMarkdownFiles()) {
    let content: string;
    try {
      content = await ctx.vault.read(f.path);
    } catch {
      continue;
    }
    const meta = ctx.metadata.getMetadata(f.path);
    const input: SearchInput = {
      path: f.path,
      fileName: f.path.split("/").pop() ?? f.path,
      basename: f.basename,
      content,
      tags: meta?.tags.map((tag) => tag.tag) ?? [], // index stores tags without '#'
      frontmatter: meta?.frontmatter?.fields,
    };
    const outcome = evaluateSearch(expr, input);
    if (!outcome.matched) continue;
    const nameMatch = outcome.nameRanges.length > 0;
    hits.push({ path: f.path, basename: f.basename, count: outcome.ranges.length + (nameMatch ? 1 : 0) });
  }
  hits.sort((a, b) => a.path.localeCompare(b.path));
  return { total: hits.length, files: hits };
}

/** Render a result into the placeholder `el` (clears it). DOM only — text goes
 *  through textContent so file paths / queries can't break out. */
export function renderQueryResult(el: HTMLElement, result: QueryBlockResult): void {
  el.replaceChildren();
  el.classList.add("geode-query-hydrated");

  if (result.error !== undefined) {
    const err = document.createElement("div");
    err.className = "geode-query-error";
    err.textContent = `${t("query.error")}: ${result.error}`;
    el.appendChild(err);
    return;
  }

  const count = document.createElement("div");
  count.className = "geode-query-count";
  count.textContent = result.total === 0 ? t("query.empty") : t("query.results", { count: result.total });
  el.appendChild(count);

  if (result.total === 0) return;

  const list = document.createElement("div");
  list.className = "geode-query-results";
  list.setAttribute("data-testid", "query-results");
  for (const hit of result.files) {
    const row = document.createElement("div");
    row.className = "geode-query-file";
    const link = document.createElement("a");
    link.className = "internal-link";
    link.setAttribute("data-target", hit.path);
    link.textContent = hit.basename;
    row.appendChild(link);
    const c = document.createElement("span");
    c.className = "geode-query-filecount";
    c.textContent = String(hit.count);
    row.appendChild(c);
    list.appendChild(row);
  }
  el.appendChild(list);
}
