/**
 * R138 Explorer multi-select E2E — browser mode :1420.
 * Run: node .calibration/r138-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 138 additions".
 *
 * Cmd/Ctrl-click toggles a file in/out of the selection; Shift-click selects the contiguous range
 * from the anchor; a plain click collapses to one; Escape clears. Right-click inside the selection
 * keeps it (for a future files-menu), outside collapses. Pure UI selection state — no file writes.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r138", name: "r138", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

// create four root files with a sortable prefix so render order is m-a, m-b, m-c, m-d
await page.evaluate(async () => {
  for (const n of ["m-a", "m-b", "m-c", "m-d"]) { try { await window.__app.vault.create(n + ".md", "# " + n + "\n"); } catch { /* exists */ } }
});
const row = (p) => `[data-testid="explorer-item"][data-path="${p}.md"]`;
await page.waitForSelector(row("m-a"), { timeout: 5000 });
await page.waitForSelector(row("m-d"), { timeout: 5000 });

const selectedPaths = () => page.evaluate(() =>
  Array.from(document.querySelectorAll(".explorer-item.is-selected")).map((e) => e.getAttribute("data-path")).sort());
const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log("— Cmd/Ctrl-click toggles individual files into the selection —");
await page.click(row("m-a"), { modifiers: ["ControlOrMeta"] });
await page.click(row("m-c"), { modifiers: ["ControlOrMeta"] });
let sel = await selectedPaths();
ok("Cmd-click m-a + m-c → both selected", sameSet(sel, ["m-a.md", "m-c.md"]), JSON.stringify(sel));

console.log("— Cmd-click an already-selected file toggles it OFF —");
await page.click(row("m-a"), { modifiers: ["ControlOrMeta"] });
sel = await selectedPaths();
ok("Cmd-click m-a again → only m-c remains", sameSet(sel, ["m-c.md"]), JSON.stringify(sel));

console.log("— Shift-click selects the contiguous range from the anchor —");
await page.click(row("m-c")); // plain click → selection {m-c}, anchor m-c
await page.click(row("m-d"), { modifiers: ["Shift"] }); // range m-c..m-d
sel = await selectedPaths();
ok("plain-click m-c then Shift-click m-d → range m-c..m-d (replaces, not adds)", sameSet(sel, ["m-c.md", "m-d.md"]), JSON.stringify(sel));
await page.click(row("m-a"), { modifiers: ["ControlOrMeta"] }); // re-anchor to m-a
await page.click(row("m-c"), { modifiers: ["Shift"] }); // range a..c
sel = await selectedPaths();
ok("re-anchor m-a then Shift-click m-c → range m-a..m-c (three rows)", sameSet(sel, ["m-a.md", "m-b.md", "m-c.md"]), JSON.stringify(sel));

console.log("— a plain click collapses the multi-selection to one —");
await page.click(row("m-b"));
sel = await selectedPaths();
ok("plain click m-b → selection collapses to just m-b", sameSet(sel, ["m-b.md"]), JSON.stringify(sel));

console.log("— Escape clears the selection —");
await page.locator(".explorer-tree").press("Escape"); // reset any carried selection from above
await page.click(row("m-a"), { modifiers: ["ControlOrMeta"] });
await page.click(row("m-d"), { modifiers: ["ControlOrMeta"] });
ok("two selected before Escape", (await selectedPaths()).length === 2, JSON.stringify(await selectedPaths()));
await page.locator(".explorer-tree").press("Escape");
sel = await selectedPaths();
ok("Escape → selection cleared (none selected)", sel.length === 0, JSON.stringify(sel));

console.log("— right-click INSIDE the selection keeps it; OUTSIDE collapses to that node —");
await page.click(row("m-a"), { modifiers: ["ControlOrMeta"] });
await page.click(row("m-b"), { modifiers: ["ControlOrMeta"] });
await page.click(row("m-a"), { button: "right" }); // inside the {m-a,m-b} selection → keep
sel = await selectedPaths();
ok("right-click m-a (inside selection) keeps the multi-selection", sameSet(sel, ["m-a.md", "m-b.md"]), JSON.stringify(sel));
await page.keyboard.press("Escape"); // close the context menu
await page.click(row("m-c"), { button: "right" }); // outside the selection → collapse to m-c
sel = await selectedPaths();
ok("right-click m-c (outside selection) collapses to just m-c", sameSet(sel, ["m-c.md"]), JSON.stringify(sel));
await page.keyboard.press("Escape");

console.log("— Cmd-click does NOT open the file (modifier suppresses activate) —");
const activeBefore = await page.evaluate(() => window.__app.workspace.getActiveTab()?.filePath ?? null);
await page.click(row("m-d"), { modifiers: ["ControlOrMeta"] });
const activeAfter = await page.evaluate(() => window.__app.workspace.getActiveTab()?.filePath ?? null);
ok("Cmd-click did not change the active (open) file", activeBefore === activeAfter, `${activeBefore} -> ${activeAfter}`);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR138 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
