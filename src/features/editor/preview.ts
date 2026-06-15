/**
 * Reading-view renderer — the markdown-it pipeline itself moved to
 * core/markdown.ts in R6 (the compat MarkdownRenderer shares it); this module
 * keeps the feature-facing surface (renderPreview + task toggling).
 */
import { renderMarkdownToHtml, type RenderMarkdownOptions } from "@core/markdown";

export function renderPreview(
  source: string,
  resolve: (target: string) => string | null,
  opts?: RenderMarkdownOptions,
): string {
  return renderMarkdownToHtml(source, resolve, opts);
}

/** Toggle the checkbox marker on a given 0-based line. Returns null if not a task
 *  line. R76: the marker is any single non-`]` char (`[^\]]`, the converged
 *  task definition) so clicking a custom-state checkbox (`[/]`/`[>]`…) toggles it
 *  too; flip mirrors format.ts toggleTaskStatus — done (`x`/`X`) → empty, anything
 *  else → done (standard `[ ]`↔`[x]` behaviour is unchanged). */
export function toggleTaskOnLine(source: string, line: number): string | null {
  const lines = source.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const replaced = lines[line].replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\])/,
    (_m, pre: string, mark: string, post: string) =>
      pre + (mark === "x" || mark === "X" ? " " : "x") + post,
  );
  if (replaced === lines[line]) return null;
  lines[line] = replaced;
  return lines.join("\n");
}
