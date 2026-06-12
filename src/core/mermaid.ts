/**
 * core/mermaid.ts — mermaid dynamic loader (R19, katex/math.ts precedent).
 *
 * Mermaid is the only new dependency this round and it is loaded lazily: the
 * main chunk grows by zero bytes and documents without diagrams never pay for
 * it. The first call dynamically imports mermaid (Vite splits it into an
 * async chunk); subsequent calls share the same promise. A load failure
 * clears the cache so a later call can retry.
 *
 * Unlike katex there is no stylesheet import — mermaid inlines styles into
 * each rendered SVG, so the output is self-contained (export included).
 */
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

export function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((mod) => mod.default)
      .catch((err) => {
        mermaidPromise = null;
        throw err;
      });
  }
  return mermaidPromise;
}
