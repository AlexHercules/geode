/**
 * R157 "Unlinked mentions in document" E2E — browser mode :1420.
 * Run: node .calibration/r157-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 157 additions".
 *
 * R154 rendered only LINKED mentions at the bottom of the reading view. R157 adds the
 * "Unlinked mentions" section below it — plain-text occurrences of the note's title/aliases
 * that aren't links — via an eager async vault scan reusing core/unlinkedMentions.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r157", name: "r157", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// "Mercury" is the target; one note LINKS it ([[Mercury]]), one MENTIONS it as plain text,
// one does neither. The linked note must NOT appear in unlinked (its mention is masked).
const FILES = {
  "Mercury.md": "# Mercury\n\nThe planet note.\n",
  "r157-linked.md": "# Linked\n\nSee [[Mercury]] for details.\n",
  "r157-unlinked.md": "# Plain\n\nMercury is the first planet from the sun.\n",
  "r157-none.md": "# Nothing\n\nNo relevant content here.\n",
};
for (const [p, c] of Object.entries(FILES)) {
  await app(async ([path, content]) => { try { await window.__app.vault.create(path, content); } catch {} await new Promise((r) => setTimeout(r, 30)); }, [p, c]);
}
await page.waitForFunction(() => (window.__app.metadata.getBacklinks("Mercury.md")?.length ?? 0) >= 1, null, { timeout: 6000 });

const openReading = async (path) => {
  await app((p) => {
    window.__app.workspace.openFile(p);
    const tab = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(tab.id, "preview");
  }, path);
  await page.waitForSelector("[data-testid=preview]", { timeout: 4000 });
};
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
const textOf = (sel) => app((s) => document.querySelector(s)?.textContent ?? null, sel);
const has = (sel) => app((s) => !!document.querySelector(s), sel);

console.log("— setting ON: reading view shows linked AND unlinked mentions —");
await toggleSetting();
await openReading("Mercury.md");
await page.waitForSelector("[data-testid=embedded-backlinks]", { timeout: 4000 });
await page.waitForSelector("[data-testid=embedded-unlinked]", { timeout: 4000 }); // async scan completes

ok("linked-mentions section present", await has("[data-testid=embedded-backlinks]"));
ok("linked section lists the linking note (r157-linked)", await has('[data-testid="ebl-source-r157-linked.md"]'));
ok("unlinked-mentions section present", await has("[data-testid=embedded-unlinked]"));
ok("unlinked header count = 1", (await textOf("[data-testid=embedded-unlinked] .embedded-backlinks-count"))?.trim() === "1");
ok("unlinked section lists the plain-text note (r157-unlinked)", await has('[data-testid="eul-source-r157-unlinked.md"]'));
ok("unlinked snippet shows the mention line", await app(() => {
  const snips = [...document.querySelectorAll("[data-testid=embedded-unlinked] .ebl-snippet")].map((e) => e.textContent);
  return snips.some((s) => s.includes("first planet"));
}));
ok("the LINKED note is NOT in unlinked (its [[Mercury]] is masked)", await app(() => !document.querySelector('[data-testid="eul-source-r157-linked.md"]')));
ok("the no-mention note appears in neither section", await app(() =>
  !document.querySelector('[data-testid="ebl-source-r157-none.md"]') && !document.querySelector('[data-testid="eul-source-r157-none.md"]')));

console.log("— click an unlinked mention → opens that source note —");
await app(() => document.querySelector('[data-testid="eul-source-r157-unlinked.md"] .ebl-source-title')?.click());
await wait(120);
ok("clicking the unlinked source navigates to it", (await app(() => window.__app.workspace.getActiveFile())) === "r157-unlinked.md");

console.log("— a note nobody mentions shows no unlinked section —");
await openReading("r157-none.md");
await wait(250); // let any scan settle
ok("note with no inbound mentions → no unlinked section", (await has("[data-testid=embedded-unlinked]")) === false);
ok("note with no backlinks → no linked section either (whole block absent)", (await has("[data-testid=embedded-backlinks]")) === false);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR157 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
