/**
 * R154 "Backlink in document" E2E — browser mode :1420.
 * Run: node .calibration/r154-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 154 additions".
 *
 * Obsidian's "Backlink in document" (default OFF) shows the note's linked mentions at the
 * bottom of the reading view. R154 renders a read-only section below .preview-content,
 * gated by a persisted setting + reading mode. Click a row → opens the source note.
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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.removeItem("geode.backlinksInDocument"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r154", name: "r154", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// target.md gets two backlinks (src-a, src-b); lonely.md gets none.
const FILES = {
  "r154-target.md": "# Target\n\nThe note that gets linked.\n",
  "r154-src-a.md": "# Source A\n\nSee [[r154-target]] for the details.\n",
  "r154-src-b.md": "# Source B\n\nAlso points at [[r154-target]] here.\n",
  "r154-lonely.md": "# Lonely\n\nNothing links to me.\n",
};
for (const [p, c] of Object.entries(FILES)) {
  await app(async ([path, content]) => { try { await window.__app.vault.create(path, content); } catch {} await new Promise((r) => setTimeout(r, 30)); }, [p, c]);
}
await page.waitForFunction(() => (window.__app.metadata.getBacklinks("r154-target.md")?.length ?? 0) >= 2, null, { timeout: 6000 });

// open a file in reading (preview) mode and wait for the rendered view
const openReading = async (path) => {
  await app((p) => {
    window.__app.workspace.openFile(p);
    const tab = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(tab.id, "preview");
  }, path);
  await page.waitForSelector("[data-testid=preview]", { timeout: 4000 });
  await wait(80);
};
const hasSection = () => app(() => !!document.querySelector("[data-testid=embedded-backlinks]"));
// toggle the setting via the Settings UI (mirrors r153)
const toggleSetting = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await new Promise((r) => setTimeout(r, 80));
  await page.waitForSelector("[data-testid=settings-backlinks-indoc-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-backlinks-indoc-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await wait(40);
};

console.log("— default OFF: no section even in reading view —");
await openReading("r154-target.md");
ok("setting defaults OFF (no embedded-backlinks)", (await hasSection()) === false);

console.log("— toggle ON: section appears with linked mentions —");
await toggleSetting();
await wait(120);
ok("section now visible", (await hasSection()) === true);
ok("header shows count = 2", await app(() => document.querySelector("[data-testid=embedded-backlinks] .embedded-backlinks-count")?.textContent?.trim()) === "2");
ok("lists both source notes (basenames, no .md)", await app(() => {
  const titles = [...document.querySelectorAll("[data-testid=embedded-backlinks] .ebl-source-title")].map((e) => e.textContent.trim());
  return titles.includes("r154-src-a") && titles.includes("r154-src-b") && titles.every((t) => !t.endsWith(".md"));
}));
ok("renders a context snippet from the source line", await app(() => {
  const snips = [...document.querySelectorAll("[data-testid=embedded-backlinks] .ebl-snippet")].map((e) => e.textContent);
  return snips.some((s) => s.includes("details")) && snips.some((s) => s.includes("points at"));
}));
ok("source-a has a per-source data-testid", await app(() => !!document.querySelector('[data-testid="ebl-source-r154-src-a.md"]')));

console.log("— click a source title → opens that note —");
await app(() => document.querySelector('[data-testid="ebl-source-r154-src-a.md"] .ebl-source-title')?.click());
await wait(120);
ok("clicking the source title navigates to it", await app(() => window.__app.workspace.getActiveFile()) === "r154-src-a.md");

console.log("— live mode: reading-only section is absent —");
await app(() => {
  window.__app.workspace.openFile("r154-target.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await wait(80);
ok("no section in live mode (reading-only)", (await hasSection()) === false);

console.log("— a note with zero backlinks renders no section —");
await openReading("r154-lonely.md");
ok("note with 0 backlinks → no section (v1: no empty section)", (await hasSection()) === false);

console.log("— toggle OFF again + persistence —");
await openReading("r154-target.md");
ok("section visible again before toggling off", (await hasSection()) === true);
await toggleSetting();
await wait(120);
ok("toggling OFF hides the section", (await hasSection()) === false);
ok("pref persisted to localStorage as 'false'", (await app(() => localStorage.getItem("geode.backlinksInDocument"))) === "false");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR154 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
