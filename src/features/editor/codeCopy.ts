/**
 * R95 (㊶ 续续): code-block copy button — Obsidian's reading-view feature (hover a
 * fenced code block → a "Copy" button in the top-right copies the code). Implemented
 * as a post-render hydration pass (mirrors hydrateEmbeds): markdown.ts output is
 * UNCHANGED (r26-bytes 0), the button is injected into the already-rendered DOM.
 * Reading view only in v1 — live-preview code blocks (CM decorations) are deferred.
 */
import { t as tr } from "@core/i18n";

/**
 * Add a hover "Copy" button to every rendered code fence (`pre > code`) under `root`.
 * Idempotent: a `pre` that already has a button is skipped (each preview re-render
 * replaces innerHTML, so this re-runs on fresh DOM). Copies `code.textContent` with the
 * single trailing newline (markdown-it artefact) trimmed.
 *
 * EXCLUDES mermaid / query placeholders: those render as `div.geode-mermaid` /
 * `div.geode-query` whose source fallback IS a real `<pre class="geode-*-source"><code>`,
 * present synchronously until the async mermaid/query hydration swaps it in (and
 * permanently if that render fails) — a copy button there would copy the diagram source.
 */
export function hydrateCodeCopy(root: HTMLElement): void {
  const pres = root.querySelectorAll<HTMLElement>("pre");
  for (const pre of pres) {
    const code = pre.querySelector("code");
    if (!code) continue;
    if (pre.closest(".geode-mermaid, .geode-query")) continue;
    if (pre.querySelector(".code-copy-button")) continue;
    const label = tr("editor.copyCode");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy-button";
    btn.textContent = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = (code.textContent ?? "").replace(/\n$/, "");
      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.textContent = tr("editor.copied");
          btn.classList.add("is-copied");
          window.setTimeout(() => {
            btn.textContent = label;
            btn.classList.remove("is-copied");
          }, 1500);
        })
        .catch(() => {
          /* clipboard unavailable (insecure context) — no feedback */
        });
    });
    pre.appendChild(btn);
  }
}
