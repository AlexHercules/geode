/**
 * Typing for the dynamic KaTeX stylesheet import in core/math.ts (R18). The
 * project tsconfig does not include vite/client types; following the
 * features/export/raw-import.d.ts precedent the declaration lives next to its
 * single consumer instead of a global declaration file. Vite turns this
 * import into an injected stylesheet chunk at runtime.
 */
declare module "katex/dist/katex.min.css" {
  const content: void;
  export default content;
}
