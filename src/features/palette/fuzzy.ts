/**
 * Shared fuzzy subsequence matcher for the palette modals
 * (command palette + quick switcher).
 */

export interface FuzzyMatch {
  /** higher is better */
  score: number;
  /** matched character indices in `text` (for highlighting) */
  indices: number[];
}

function isBoundary(ch: string): boolean {
  return (
    ch === " " ||
    ch === "/" ||
    ch === "-" ||
    ch === "_" ||
    ch === "." ||
    ch === ":" ||
    ch === "("
  );
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

/**
 * Case-insensitive subsequence match with scoring:
 * exact > prefix > word-boundary hits > consecutive runs > scattered chars.
 * Returns null when `query` is not a subsequence of `text`.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, indices: [] };
  if (q.length > t.length) return null;

  if (t === q) return { score: 1000, indices: range(0, q.length) };
  if (t.startsWith(q)) {
    return { score: 800 + q.length * 4 - t.length * 0.5, indices: range(0, q.length) };
  }

  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const at = t.indexOf(q[qi], from);
    if (at === -1) return null;
    let bonus = 1;
    if (at === prev + 1) bonus += 6; // consecutive run
    else if (at === 0 || isBoundary(t[at - 1])) bonus += 4; // word boundary
    score += bonus;
    indices.push(at);
    prev = at;
    from = at + 1;
  }
  // prefer earlier first hit and shorter targets
  score -= indices[0] * 0.5 + t.length * 0.05;
  return { score, indices };
}

/** Split `text` into contiguous segments flagged as hit / non-hit for rendering. */
export function toSegments(
  text: string,
  indices: number[],
): Array<{ text: string; hit: boolean }> {
  if (indices.length === 0) return [{ text, hit: false }];
  const hitSet = new Set(indices);
  const out: Array<{ text: string; hit: boolean }> = [];
  let buf = "";
  let bufHit = hitSet.has(0);
  for (let i = 0; i < text.length; i++) {
    const hit = hitSet.has(i);
    if (hit !== bufHit && buf) {
      out.push({ text: buf, hit: bufHit });
      buf = "";
    }
    bufHit = hit;
    buf += text[i];
  }
  if (buf) out.push({ text: buf, hit: bufHit });
  return out;
}
