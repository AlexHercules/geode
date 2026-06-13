/**
 * R45 Workspaces (saved layouts) E2E — browser mode vs dev :1420.
 * Run: node .calibration/r45-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 45 additions".
 *
 *  save current layout → appears in list → load restores the open-file set →
 *  delete removes it → fault-tolerant load prunes a since-deleted file's tab.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r45", name: "r45", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeWorkspaces, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const list = () => app(() => window.__geodeWorkspaces.list());
const openPaths = () => app(() => {
  const walk = (n) => n.kind === "leaf" ? n.tabs : n.children.flatMap(walk);
  return walk(window.__app.workspace.state.get().root)
    .filter((t) => t.viewType === "markdown" && t.filePath)
    .map((t) => t.filePath).sort();
});
const openModal = async () => { await app(() => window.__app.workspace.openModal("workspaces")); await page.waitForSelector("[data-testid=workspaces-modal]", { timeout: 4000 }); await wait(60); };

// seed files + build a layout (two open tabs)
await app(() => { ["WsA.md", "WsB.md", "WsC.md"].forEach((p, i) => window.__app.vault.create(p, "# " + p + "\n").catch(() => {})); });
await wait(80);
await app(() => window.__app.workspace.openFile("WsA.md"));
await wait(50);
await app(() => window.__app.workspace.openFile("WsB.md", { newTab: true }));
await wait(80);
const savedSet = await openPaths();

// ── save ─────────────────────────────────────────────────────────────────────
console.log("save current layout");
await openModal();
await page.fill("[data-testid=workspaces-name-input]", "My Layout");
await app(() => document.querySelector("[data-testid=workspaces-save]")?.click());
await wait(180);
ok("save adds the workspace to the list", (await list()).includes("My Layout"), JSON.stringify(await list()));
ok("saved workspace renders as a modal item", (await app(() => document.querySelectorAll("[data-testid=workspaces-item]").length)) >= 1);

// ── load restores the open-file set ───────────────────────────────────────────
console.log("load restores layout");
await app(() => window.__app.workspace.closeModal());
await wait(40);
await app(() => window.__app.workspace.openFile("WsC.md")); // change the layout
await wait(80);
ok("layout changed before load (WsC now open)", (await openPaths()).includes("WsC.md"));
await openModal();
await app(() => document.querySelector("[data-testid=workspaces-item][data-name='My Layout'] [data-testid=workspaces-load]")?.click()
  ?? document.querySelector("[data-testid=workspaces-load]")?.click());
await wait(200);
const restored = await openPaths();
ok("load restores the saved open-file set", JSON.stringify(restored) === JSON.stringify(savedSet), JSON.stringify([savedSet, restored]));
ok("load closed the modal", (await app(() => window.__app.workspace.state.get().modal)) === null);
// F4 (review): emitActiveFile re-seeds the active file for the restored layout
const activeAfter = await app(() => window.__app.workspace.getActiveFile());
ok("load re-seeds the active file (derived state refreshed)", !!activeAfter && savedSet.includes(activeAfter), JSON.stringify(activeAfter));

// F5 (review): appearance (theme) is global — load must NOT restore a saved theme
console.log("appearance stays global (theme not stored/restored)");
await app(() => window.__app.workspace.setTheme("dark"));
await wait(40);
await openModal();
await page.fill("[data-testid=workspaces-name-input]", "ThemeWs");
await app(() => document.querySelector("[data-testid=workspaces-save]")?.click());
await wait(180);
await app(() => window.__app.workspace.closeModal());
await app(() => window.__app.workspace.setTheme("light")); // change theme AFTER saving
await wait(40);
await openModal();
await app(() => document.querySelector("[data-testid=workspaces-item][data-name='ThemeWs'] [data-testid=workspaces-load]")?.click());
await wait(200);
ok("load preserves the CURRENT theme (saved theme not restored)", (await app(() => window.__app.workspace.state.get().theme)) === "light", await app(() => window.__app.workspace.state.get().theme));
await app(() => window.__app.workspace.closeModal());

// ── fault-tolerant load (a referenced file deleted since save) ─────────────────
console.log("fault-tolerant load (deleted file pruned)");
await openModal();
await page.fill("[data-testid=workspaces-name-input]", "Fault");
await app(() => document.querySelector("[data-testid=workspaces-save]")?.click());
await wait(180);
await app(() => window.__app.workspace.closeModal());
await wait(40);
// delete one referenced file on disk, then load the saved layout
await app(() => window.__app.vault.remove("WsB.md").catch(() => window.__app.vault.trash?.("WsB.md")?.catch(() => {})));
await wait(120);
await openModal();
await app(() => document.querySelector("[data-testid=workspaces-item][data-name='Fault'] [data-testid=workspaces-load]")?.click());
await wait(200);
const afterFault = await openPaths();
ok("fault-tolerant load does not crash + prunes the deleted file", !afterFault.includes("WsB.md") && (await app(() => !!window.__app)), JSON.stringify(afterFault));

// ── delete ─────────────────────────────────────────────────────────────────
console.log("delete workspace");
await openModal();
const before = (await list()).length;
await app(() => document.querySelector("[data-testid=workspaces-item][data-name='My Layout'] [data-testid=workspaces-delete]")?.click());
await wait(180);
ok("delete removes the workspace from the list", !(await list()).includes("My Layout"));
ok("delete shrinks the list by one", (await list()).length === before - 1, `${before}→${(await list()).length}`);

console.log(`\nR45 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
