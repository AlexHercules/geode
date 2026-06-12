/**
 * core/math.ts — KaTeX dynamic loader (R18 one-time decision).
 *
 * KaTeX is the only new dependency this round and it is loaded lazily: the
 * main chunk grows by zero bytes and documents without math never pay for it.
 * The first call dynamically imports katex plus its stylesheet (Vite splits
 * both into an async chunk and injects the CSS); subsequent calls share the
 * same promise. A load failure clears the cache so a later call can retry.
 *
 * Export/print render with output:"mathml" and do not need this CSS — the
 * stylesheet injection only matters for in-app ("html" output) rendering,
 * and loading it once in the app context is harmless for exports.
 */
let katexPromise: Promise<typeof import("katex").default> | null = null;

export function loadKatex(): Promise<typeof import("katex").default> {
  if (!katexPromise) {
    katexPromise = Promise.all([import("katex"), import("katex/dist/katex.min.css")])
      .then(([mod]) => mod.default)
      .catch((err) => {
        katexPromise = null;
        throw err;
      });
  }
  return katexPromise;
}
