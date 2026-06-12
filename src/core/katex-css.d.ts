/**
 * Typing for the dynamic KaTeX stylesheet import in core/math.ts (R18). The
 * project tsconfig does not include vite/client types; the shared `*.css?raw`
 * declaration lives in src/raw-import.d.ts (moved from features/export in
 * R20). Vite turns this import into an injected stylesheet chunk at runtime.
 */
declare module "katex/dist/katex.min.css" {
  const content: void;
  export default content;
}
