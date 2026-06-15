/**
 * R73 cssclasses application E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r73-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 73 additions" (㊼ slice).
 *
 * Covers: a note's `cssclasses` / legacy `cssclass` frontmatter is applied as CSS
 * classes to the note view container — preview `.preview-content` and live/source
 * `.editor-cm-host` — across list / space-string / comma-string / inline-list
 * forms, dedupes, ignores absence, and updates live when the buffer changes.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r73", name: "r73", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (path, mode) => app(async ([p, m]) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, m);
  await new Promise((r) => setTimeout(r, 350));
}, [path, mode]);
// className tokens of the active mode's note-view container
const tokens = (testid) => app(([id]) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  return el ? el.className.split(/\s+/).filter(Boolean) : null;
}, [testid]);
const has = (toks, t) => Array.isArray(toks) && toks.includes(t);

const fm = (body, content = "# Note\n\nbody\n") => `---\n${body}\n---\n${content}`;

await create("css/list.md", fm("cssclasses:\n  - alpha\n  - beta"));
await create("css/space.md", fm("cssclasses: gamma delta"));
await create("css/comma.md", fm("cssclasses: epsilon, zeta"));
await create("css/inline.md", fm("cssclasses: [eta, theta]"));
await create("css/legacy.md", fm("cssclass: legacyone"));
await create("css/dup.md", fm("cssclasses: [dd, dd, ee]"));
await create("css/none.md", "# Plain\n\nno frontmatter\n");
await create("css/react.md", fm("cssclasses: before"));
await wait(400);

// ── reading-view (preview) container application ─────────────────────────────
console.log("— preview container —");
await open("css/list.md", "preview");
let t = await tokens("preview");
ok("YAML list → preview has alpha", has(t, "alpha"), JSON.stringify(t));
ok("YAML list → preview has beta", has(t, "beta"));
ok("base classes still present (markdown-preview-view)", has(t, "markdown-preview-view") && has(t, "preview-content"));

await open("css/space.md", "preview");
t = await tokens("preview");
ok("space-string 'gamma delta' → split into gamma", has(t, "gamma"), JSON.stringify(t));
ok("space-string 'gamma delta' → split into delta", has(t, "delta"));

await open("css/comma.md", "preview");
t = await tokens("preview");
ok("comma-string 'epsilon, zeta' → epsilon", has(t, "epsilon"), JSON.stringify(t));
ok("comma-string 'epsilon, zeta' → zeta", has(t, "zeta"));

await open("css/inline.md", "preview");
t = await tokens("preview");
ok("inline list [eta, theta] → eta", has(t, "eta"), JSON.stringify(t));
ok("inline list [eta, theta] → theta", has(t, "theta"));

await open("css/legacy.md", "preview");
t = await tokens("preview");
ok("legacy singular cssclass → legacyone applied", has(t, "legacyone"), JSON.stringify(t));

await open("css/dup.md", "preview");
t = await tokens("preview");
ok("dedupe: 'dd' appears exactly once", t.filter((x) => x === "dd").length === 1, JSON.stringify(t));
ok("dedupe: 'ee' present", has(t, "ee"));

await open("css/none.md", "preview");
t = await tokens("preview");
ok("no cssclasses → container has ONLY base classes (3)", t.length === 3 && has(t, "markdown-preview-view"), JSON.stringify(t));

// ── live/source container application ────────────────────────────────────────
console.log("— live container —");
await open("css/list.md", "live");
t = await tokens("cm-editor");
ok("live: cm-host has alpha", has(t, "alpha"), JSON.stringify(t));
ok("live: cm-host has beta", has(t, "beta"));
ok("live: base markdown-source-view present", has(t, "markdown-source-view") && has(t, "editor-cm-host"));

await open("css/none.md", "live");
t = await tokens("cm-editor");
ok("live: no cssclasses → only base classes (3)", t.length === 3 && has(t, "markdown-source-view"), JSON.stringify(t));

// ── reactivity: editing the buffer updates the container live ────────────────
console.log("— reactive update —");
await open("css/react.md", "preview");
t = await tokens("preview");
ok("react: initial cssclasses=before applied", has(t, "before"), JSON.stringify(t));
await app(([p]) => window.__app.vault.modify(p, "---\ncssclasses: after\n---\n# Note\n\nbody\n"), ["css/react.md"]);
await wait(350);
t = await tokens("preview");
ok("react: external edit → 'after' applied", has(t, "after"), JSON.stringify(t));
ok("react: stale 'before' removed", !has(t, "before"), JSON.stringify(t));

// live-mode container reactivity (review nit 1): the LIVE cm-host must also
// update when the buffer changes — proves docRevision drives the live container,
// not just preview. Uses the external-modify path (same docRevision bump a CM
// keystroke triggers) for determinism.
console.log("— live-mode reactive update —");
await create("css/react2.md", fm("cssclasses: lbefore"));
await wait(150);
await open("css/react2.md", "live");
t = await tokens("cm-editor");
ok("live react: initial cssclasses=lbefore on cm-host", has(t, "lbefore"), JSON.stringify(t));
await app(([p]) => window.__app.vault.modify(p, "---\ncssclasses: lafter\n---\n# Note\n\nbody\n"), ["css/react2.md"]);
await wait(350);
t = await tokens("cm-editor");
ok("live react: edit → 'lafter' on cm-host", has(t, "lafter"), JSON.stringify(t));
ok("live react: stale 'lbefore' removed", !has(t, "lbefore"), JSON.stringify(t));

console.log(`\nR73 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
