/**
 * R251 (A1) hotkeys-page command source prefix E2E — browser mode :1420.
 * Run: node .calibration/r251-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 251 additions".
 *
 * Obsidian's hotkeys page is a FLAT list where plugin commands show "Source: name"
 * (e.g. "Bookmarks: ...") and core app/editor commands have no prefix. R251 derives the source
 * from the command id prefix. Asserts: plugin commands get the prefix, core commands don't, the
 * filter matches the source label, and the list stays flat (NO group-section headers — not grouped).
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r251", name: "r251", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-hotkeys"]');
await page.waitForSelector('[data-testid="settings-hotkeys-filter"]', { timeout: 3000 });
await wait(80);

const ids = await app(() => window.__app.commands.list().map((c) => c.id));
const bookmarkId = ids.find((id) => id.startsWith("bookmarks:"));
const graphId = ids.find((id) => id.startsWith("graph:"));
const editorId = ids.find((id) => id.startsWith("editor:"));
// a core app: command with a clean name (app:show-backlinks has "Backlinks:" baked into its OWN
// registered name — not a derived prefix — so it'd confuse the no-prefix assertion).
const appId = ids.find((id) => id === "app:new-note") ?? ids.find((id) => id.startsWith("app:") && id !== "app:show-backlinks");
const rowName = (id) => app((i) => document.querySelector(`[data-testid="hotkey-row-${i}"] .hotkey-name`)?.textContent ?? null, id);
const SOURCE_PREFIXES = ["Bookmarks: ", "Graph view: ", "Daily notes: ", "Backlinks: ", "Unique note creator: ", "Slides: ", "Random note: ", "Outline: ", "Outgoing links: "];

console.log("— plugin commands show a 'Source: ' prefix —");
ok("a bookmarks: command exists", !!bookmarkId, JSON.stringify({ bookmarkId }));
const bn = await rowName(bookmarkId);
ok("bookmarks command name starts with 'Bookmarks: '", bn?.startsWith("Bookmarks: "), bn);
if (graphId) {
  const gn = await rowName(graphId);
  ok("graph command name starts with 'Graph view: '", gn?.startsWith("Graph view: "), gn);
}

console.log("— idempotent: commands that BAKE the source into their own name show ONE prefix, not two —");
// backlink:/outline:/outgoing-links: commands have "Backlinks:/Outline:/Outgoing links:" baked into
// their registered name (R211/R212/R219) AND their id prefix is in CMD_SOURCE_KEYS → must not double.
const BAKED = ["backlink:open-backlinks", "backlink:toggle-backlinks-in-document", "outline:open-outline", "outgoing-links:open-outgoing-links"];
const doublePrefix = /^(.+?): \1: /;
for (const id of BAKED) {
  if (!ids.includes(id)) { ok(`${id} present`, false, "command id missing"); continue; }
  const nm = await rowName(id);
  ok(`${id}: source label appears exactly once (no "X: X: " double)`, !!nm && !doublePrefix.test(nm), nm);
}

console.log("— core app/editor commands have NO source prefix (faithful: core is unprefixed) —");
const en = await rowName(editorId);
ok("core editor command name has no source prefix", !!en && !SOURCE_PREFIXES.some((p) => en.startsWith(p)), en);
const an = await rowName(appId);
ok("core app command name has no source prefix", !!an && !SOURCE_PREFIXES.some((p) => an.startsWith(p)), an);

console.log("— the filter matches the source label (search 'Bookmarks') —");
await page.fill('[data-testid="settings-hotkeys-filter"]', "Bookmarks");
await wait(100);
const filtered = await app(([bm, ed]) => ({
  bm: !!document.querySelector(`[data-testid="hotkey-row-${bm}"]`),
  ed: !!document.querySelector(`[data-testid="hotkey-row-${ed}"]`),
}), [bookmarkId, editorId]);
ok("filtering 'Bookmarks' keeps bookmarks commands", filtered.bm, JSON.stringify(filtered));
ok("filtering 'Bookmarks' drops the core editor command", !filtered.ed, JSON.stringify(filtered));
await page.fill('[data-testid="settings-hotkeys-filter"]', "");
await wait(80);

console.log("— the list stays FLAT (NO group-section headers — not a phantom grouping) —");
const flat = await app(() => ({
  subheaders: document.querySelectorAll(".hotkey-list .settings-subheader").length,
  rows: document.querySelectorAll(".hotkey-list .hotkey-row").length,
  nonRowChildren: [...document.querySelector(".hotkey-list").children].filter((c) => !c.classList.contains("hotkey-row")).length,
}));
ok("no .settings-subheader inside the hotkey list", flat.subheaders === 0, JSON.stringify(flat));
ok("the hotkey list contains only hotkey-row children (flat)", flat.nonRowChildren === 0 && flat.rows > 0, JSON.stringify(flat));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR251 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
