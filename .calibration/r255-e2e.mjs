/**
 * R255 Stacked tabs E2E — browser mode :1420. Contract: docs/ARCHITECTURE.md "Round 254 additions".
 * Run: node .calibration/r255-e2e.mjs   (dev server must be up)
 *
 * Obsidian "Stack tabs": a tab group (PaneLeaf) renders ALL its tabs simultaneously as a
 * horizontal cascade (vs only the active tab). Geode gates it on PaneLeaf.stacked (additive,
 * persisted via sanitizeNode) + workspace.toggleStacked + command workspace:toggle-stacked-tabs.
 * KEY data-safety assertions (底线①): with N editors mounted at once, (a) EACH tab's edit
 * autosaves to disk independently (autosave is per-DocumentHandle, the split precedent), and
 * (b) toggling stacked does NOT lose an in-flight edit. Also: stacked persists across reload
 * (the serialized-field parity in sanitizeNode), and focus doesn't fight (autoFocus gate).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r255", name: "r255", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => app((x) => window.__app.vault.read(x), p);
const activeLeaf = () => app(() => {
  const w = window.__app.workspace;
  const s = w.state.get();
  const find = (n) => n.kind === "leaf" ? (n.id === s.activePaneId ? n : null) : n.children.map(find).find(Boolean);
  const leaf = find(s.root) ?? null;
  return leaf ? { id: leaf.id, tabIds: leaf.tabs.map((t) => t.id), stacked: leaf.stacked === true, activeTabId: leaf.activeTabId } : null;
});

// setup: two markdown notes in ONE tab group (active leaf)
await app(async () => {
  await window.__app.vault.create("stackA.md", "AAA original\n").catch(() => {});
  await window.__app.vault.create("stackB.md", "BBB original\n").catch(() => {});
  window.__app.workspace.openFile("stackA.md", { newTab: true });
  window.__app.workspace.openFile("stackB.md", { newTab: true });
});
await page.waitForFunction(() => {
  const w = window.__app.workspace; const s = w.state.get();
  const find = (n) => n.kind === "leaf" ? (n.id === s.activePaneId ? n : null) : n.children.map(find).find(Boolean);
  const leaf = find(s.root);
  return leaf && leaf.tabs.length >= 2;
}, null, { timeout: 5000 });
await wait(200);

let leaf = await activeLeaf();
const [idA, idB] = leaf.tabIds;

console.log("— two markdown tabs in one group; default is NOT stacked (single mount) —");
ok("two tabs in one leaf", leaf.tabIds.length === 2, JSON.stringify(leaf));
ok("default leaf.stacked is false", leaf.stacked === false);
ok("default: no stacked container", !(await app(() => !!document.querySelector(".main-content.is-stacked"))));
ok("default: only one editor mounted", (await app(() => document.querySelectorAll(".main-content .cm-editor").length)) === 1);

console.log("— toggle stacked via command: all tabs render as columns simultaneously —");
await app(() => window.__app.commands.execute("workspace:toggle-stacked-tabs"));
await wait(250);
ok("leaf.stacked now true", (await activeLeaf())?.stacked === true);
ok("main-content.is-stacked present", await app(() => !!document.querySelector(".main-content.is-stacked")));
ok("both tabs mounted as columns", (await app(() => document.querySelectorAll(".stacked-column").length)) === 2);
ok("BOTH editors mounted at once (multi-mount)", (await app(() => document.querySelectorAll(".stacked-column .cm-editor").length)) === 2);
ok("exactly one column is-active (focus state coherent)", (await app(() => document.querySelectorAll(".stacked-column.is-active").length)) === 1);

console.log("— review-fix: activating a column via its HEADER focuses that column's editor —");
await page.click(`[data-testid="stacked-column-header-${idA}"]`); // header, not body
await wait(150);
ok("header-activation focuses the column's editor (not the button)", await app((id) => {
  const col = document.querySelector(`[data-testid="stacked-column-${id}"]`);
  return !!col && col.contains(document.activeElement) && document.activeElement?.classList.contains("cm-content");
}, idA));
await page.keyboard.type("Hh");
await wait(700);
ok("keystrokes after header-activation land in that tab (A), not another column", (await read("stackA.md"))?.includes("Hh"), await read("stackA.md"));

console.log("— 底线①: edit EACH tab; each autosaves to disk independently —");
// edit tab A: click its editor body (activates + focuses), type at end
await page.click(`[data-testid="stacked-column-${idA}"] .cm-content`);
await wait(80);
await page.keyboard.press("End");
await page.keyboard.type("Xa");
await wait(120);
// edit tab B
await page.click(`[data-testid="stacked-column-${idB}"] .cm-content`);
await wait(80);
await page.keyboard.press("End");
await page.keyboard.type("Yb");
await wait(700); // autosave debounce flush for both handles
const ra = await read("stackA.md");
const rb = await read("stackB.md");
ok("tab A edit autosaved (original preserved + new text)", ra?.includes("AAA original") && ra?.includes("Xa"), ra);
ok("tab B edit autosaved (original preserved + new text)", rb?.includes("BBB original") && rb?.includes("Yb"), rb);

console.log("— non-active tab's pending edit flushes on unstack-unmount (release()→flush, R16) —");
// Edit A (debounce pending), switch active to B WITHOUT waiting for A's flush so A is a
// non-active-but-still-mounted stacked column, then unstack → A's EditorPane unmounts →
// release() must flush A's pending edit before dropping the handle. This is the genuinely
// new data-safety scenario stacked mode introduces (unstack drops non-active views).
await page.click(`[data-testid="stacked-column-${idA}"] .cm-content`);
await wait(80);
await page.keyboard.press("End");
await page.keyboard.type("Pp");
await app((i) => window.__app.workspace.setActiveTab(i), idB); // B active; A still mounted (stacked)
await wait(30); // intentionally < debounce: A's save is still pending
await app(() => window.__app.commands.execute("workspace:toggle-stacked-tabs")); // unstack → A unmounts
await wait(700); // release()→flush() settles
ok("non-active tab's pending edit flushed on unstack-unmount (no loss)", (await read("stackA.md"))?.includes("Pp"), await read("stackA.md"));
await app(() => window.__app.commands.execute("workspace:toggle-stacked-tabs")); // re-stack for following tests
await wait(250);

console.log("— toggle stacked OFF mid-edit does not lose the edit (no reload; files live) —");
leaf = await activeLeaf(); // B is active (last clicked)
await page.click(`[data-testid="stacked-column-${leaf.activeTabId}"] .cm-content`);
await wait(80);
await page.keyboard.press("End");
await page.keyboard.type("Zc");
await wait(60);
await app(() => window.__app.commands.execute("workspace:toggle-stacked-tabs")); // unstack mid-edit
await wait(700);
ok("unstacked → single mount", !(await app(() => !!document.querySelector(".main-content.is-stacked"))));
ok("unstacked → one editor", (await app(() => document.querySelectorAll(".main-content .cm-editor").length)) === 1);
const activePath = leaf.activeTabId === idA ? "stackA.md" : "stackB.md";
ok("edit made just before unstack was NOT lost", (await read(activePath))?.includes("Zc"), await read(activePath));

console.log("— stacked persists across reload (sanitizeNode field parity = serialized-field round-trip) —");
// re-stack, let workspace persist, reload, and confirm the flag survived. (MemoryVault
// files are ephemeral across reload, so this asserts the persisted STATE round-trip only —
// the field-parity bug this guards against would drop leaf.stacked to undefined on reload.)
await app(() => window.__app.commands.execute("workspace:toggle-stacked-tabs")); // back to stacked
await wait(250);
ok("re-stacked before reload", (await activeLeaf())?.stacked === true);
await wait(200); // let workspace persist settle
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r255b", name: "r255b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await wait(300);
ok("leaf.stacked === true survived reload (round-trip)", (await activeLeaf())?.stacked === true);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR255 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
