/**
 * R50 Appearance (readable line length / spellcheck / zoom) E2E — browser vs :1420.
 * Run: node .calibration/r50-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 50 additions".
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r50", name: "r50", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeAppearance, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cmMaxWidth = () => app(() => { const c = document.querySelector(".cm-content"); return c ? getComputedStyle(c).maxWidth : null; });

// open a note so a .cm-content exists
await app(() => window.__app.vault.create("R50.md", "# hi\nteh quik brown fox\n").catch(() => {}));
await wait(100);
await app(() => window.__app.workspace.openFile("R50.md"));
await wait(180);

// ── A. readable line length ──────────────────────────────────────────────────
console.log("A. readable line length");
ok("default: --readable-line-width unset (CSS 46em fallback)", (await app(() => window.__geodeAppearance.readableVar())) === "(default)");
ok("editor content is width-capped by default", (await cmMaxWidth()) !== null && (await cmMaxWidth()) !== "none", JSON.stringify(await cmMaxWidth()));
await app(() => window.__geodeAppearance.setReadable(false));
await wait(100);
ok("readable OFF → --readable-line-width: none", (await app(() => window.__geodeAppearance.readableVar())) === "none");
ok("editor content is full-width when readable OFF", (await cmMaxWidth()) === "none", JSON.stringify(await cmMaxWidth()));
await app(() => window.__geodeAppearance.setReadable(true));
await wait(100);
ok("readable back ON re-caps the content", (await app(() => window.__geodeAppearance.readableVar())) === "(default)" && (await cmMaxWidth()) !== "none");
// review fix: the reading-view properties panel follows the same var
await app(() => window.__app.vault.create("PropsR50.md", "---\ntag: x\n---\nbody\n").catch(() => {}));
await wait(80);
await app(() => window.__app.workspace.openFile("PropsR50.md"));
await wait(150);
await app(() => { const tb = window.__app.workspace.getActiveTab(); if (tb) window.__app.workspace.setTabMode(tb.id, "preview"); });
await wait(280);
await app(() => window.__geodeAppearance.setReadable(false));
await wait(150);
const ppWidth = await app(() => { const p = document.querySelector(".editor-preview > .properties-panel"); return p ? getComputedStyle(p).maxWidth : null; });
ok("reading-view properties panel follows readable-line (none when OFF)", ppWidth === "none", JSON.stringify(ppWidth));
await app(() => window.__geodeAppearance.setReadable(true));
await wait(80);
// restore a LIVE editor (R50.md) so the later spellcheck section has a .cm-content
await app(() => window.__app.workspace.openFile("R50.md"));
await wait(60);
await app(() => { const tb = window.__app.workspace.getActiveTab(); if (tb) window.__app.workspace.setTabMode(tb.id, "live"); });
await wait(200);

// ── B. spellcheck (contentDOM) ───────────────────────────────────────────────
console.log("B. editor spellcheck");
ok("spellcheck off by default (contentDOM)", (await app(() => document.querySelector(".cm-content")?.getAttribute("spellcheck"))) === "false");
await app(() => window.__geodeAppearance.setSpellcheck(true));
await wait(150);
ok("setSpellcheck(true) → contentDOM spellcheck=true", (await app(() => document.querySelector(".cm-content")?.getAttribute("spellcheck"))) === "true", JSON.stringify(await app(() => document.querySelector(".cm-content")?.getAttribute("spellcheck"))));
await app(() => window.__geodeAppearance.setSpellcheck(false));
await wait(150);
ok("setSpellcheck(false) → contentDOM spellcheck=false", (await app(() => document.querySelector(".cm-content")?.getAttribute("spellcheck"))) === "false");

// ── C. app zoom commands ─────────────────────────────────────────────────────
console.log("C. app zoom commands");
await app(() => window.__app.workspace.setFontSize(16));
await wait(60);
await app(() => window.__app.commands.execute("app:zoom-in"));
await wait(60);
ok("zoom-in increases fontSize (16→17)", (await app(() => window.__app.workspace.state.get().fontSize)) === 17);
await app(() => window.__app.commands.execute("app:zoom-out"));
await app(() => window.__app.commands.execute("app:zoom-out"));
await wait(60);
ok("zoom-out decreases fontSize (17→15)", (await app(() => window.__app.workspace.state.get().fontSize)) === 15);
await app(() => window.__app.commands.execute("app:zoom-reset"));
await wait(60);
ok("zoom-reset → 16 + --editor-font-size var", (await app(() => window.__app.workspace.state.get().fontSize)) === 16 && (await app(() => document.documentElement.style.getPropertyValue("--editor-font-size"))) === "16px");

// ── D. settings UI toggles ───────────────────────────────────────────────────
console.log("D. settings UI toggles");
await app(() => window.__app.workspace.openModal("settings"));
await page.waitForSelector("[data-testid=settings-readable-toggle]", { timeout: 4000 });
await wait(80);
await app(() => document.querySelector("[data-testid=settings-readable-toggle]")?.click());
await wait(120);
ok("settings readable toggle flips the setting (→ none)", (await app(() => window.__geodeAppearance.readableVar())) === "none");
await app(() => document.querySelector("[data-testid=settings-readable-toggle]")?.click());
await wait(120);
ok("settings readable toggle flips back (→ default)", (await app(() => window.__geodeAppearance.readableVar())) === "(default)");
await app(() => document.querySelector("[data-testid=settings-spellcheck-toggle]")?.click());
await wait(120);
await app(() => window.__app.workspace.closeModal());
await wait(120);
ok("settings spellcheck toggle enables spellcheck on the editor", (await app(() => document.querySelector(".cm-content")?.getAttribute("spellcheck"))) === "true");
// reset
await app(() => window.__geodeAppearance.setSpellcheck(false));

console.log(`\nR50 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
