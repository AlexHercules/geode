# compat-fixtures — vendored real Obsidian community plugins (committed regression assets)

These are **unmodified, vendored real Obsidian community plugins**, committed as
fixtures for Geode's Obsidian-compatibility regression suite (`.calibration/rNNN-e2e.mjs`).
Unlike the gitignored `compat-vault/` (the manual desktop-probe suite) and the
hand-written synthetic fixture (`src/compat/obsidian/fixture.ts`), these let the
automated browser harness load and drive a *real, published* plugin bundle through
the real `compat/obsidian/loader.ts` path — proving "real plugin migration" with
byte-level assertions, not just "trust me, it loads."

They are **not** shipped — nothing in `src/` imports them; the e2e reads the files
at test time and injects them via `window.__geodeObsidianPlugins`.

## obsidian-sort-and-permute-lines (R258)

- Source: <https://github.com/Vinzent03/obsidian-sort-and-permute-lines>
- Vendored release: **0.7.0** (`main.js` + `manifest.json`, verbatim release artifacts)
- License: **MIT** (© Vinzent03) — vendoring + redistribution permitted with attribution.
- Why this plugin: small, MIT, zero runtime dependencies (only `require('obsidian')`;
  tslib is inlined by the bundler), and exercises the core migration surface —
  `addCommand` (×11), the full `Editor` API (`getValue`/`setValue`/`replaceRange`/
  `getCursor`/`getLine`/`lastLine`), `metadataCache.getFileCache()` and
  `workspace.getActiveViewOfType(MarkdownView)`. It rewrites the whole document via
  the Editor shim, so it is also a data-safety (底线①) proof that *plugin* edits flow
  through the same autosave/flush path as native edits.
- Driven by: `.calibration/r258-e2e.mjs`.
