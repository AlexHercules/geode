/**
 * renderMath / finishRenderMath / loadMathJax — Obsidian math-render API backed
 * by Geode's bundled KaTeX (core/math.ts loadKatex). renderMath returns the
 * element synchronously (with the source as a readable fallback) and queues an
 * async KaTeX render into it; finishRenderMath awaits the queue (mirrors
 * Obsidian's MathJax sync-return + async-finish contract).
 */
import { loadKatex } from "@core/math";

const pending: Promise<void>[] = [];

export function renderMath(source: string, display: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = display ? "math math-block" : "math math-inline";
  el.textContent = source; // readable fallback until typeset / if katex fails to load
  pending.push(
    loadKatex()
      .then((katex) => {
        el.textContent = "";
        katex.render(source, el, {
          displayMode: display,
          throwOnError: false,
          output: "html",
          maxSize: 100, // R18 rule-bomb defense
        });
        el.classList.add("is-loaded");
      })
      .catch((err) => {
        console.warn("[obsidian-compat] renderMath failed", err);
        el.textContent = source; // restore source — never throw
      }),
  );
  return el;
}

export function finishRenderMath(): Promise<void> {
  return Promise.all(pending.splice(0)).then(() => undefined);
}

export function loadMathJax(): Promise<void> {
  return loadKatex().then(() => undefined);
}
