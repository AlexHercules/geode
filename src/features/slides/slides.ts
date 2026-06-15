/**
 * Slides presentation mode (R74) — pure slide-splitting logic, no React.
 *
 * Obsidian core "Slides": a `---` on its own line (surrounded by newlines)
 * separates horizontal slides. We mirror that, with two guards the naive
 * `split("\n---\n")` would get wrong:
 *   1. The frontmatter block's own `---` fences must NOT split — strip the
 *      frontmatter first via the metadata parser's authoritative `.to`.
 *   2. A `---` inside a fenced code block (``` or ~~~) is content, not a
 *      separator — track fences while scanning.
 * v1 splits only on `---` (not the `***`/`___` thematic-break variants).
 */
import { parseFrontmatter } from "@core/metadata";

/** Split a note's text into slide sources. Always returns at least one slide
 *  (a note with no separators is a single-slide deck). */
export function splitSlides(text: string): string[] {
  const fm = parseFrontmatter(text);
  const body = fm ? text.slice(fm.to) : text;

  const slides: string[] = [];
  let current: string[] = [];
  let fence: string | null = null; // the open fence marker ("```" / "~~~"), or null
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      current.push(line);
      continue;
    }
    const open = /^(```|~~~)/.exec(trimmed);
    if (open) {
      fence = open[1];
      current.push(line);
      continue;
    }
    if (trimmed === "---") {
      slides.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  slides.push(current.join("\n"));
  return slides;
}
