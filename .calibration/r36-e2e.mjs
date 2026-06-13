/**
 * R36 tab keyboard shortcuts E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r36-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 36 additions".
 *
 * Covers (tab switching is a workspace STORE op — fully drivable, no live view):
 *  A. workspace store ops (cycleActiveTab / activateTabAt / activateLastTab) —
 *     pure deterministic truth via __app.workspace + getActiveFile().
 *  B. command layer (app.commands.execute "app:next-tab" / "app:go-to-tab-N" /
 *     "app:go-to-last-tab" / "app:new-tab" additive).
 *  C. reopen closed tab (LIFO) + view-mode restore (data-restore correctness).
 *  D. store → UI binding (.tab.is-active reflects the active tab).
 *  E. hotkey grammar (__geodeHotkey.match, both platforms): Ctrl+Tab literal vs
 *     Cmd+Tab no-fire, Mod+1..9 / Mod+T / Mod+Shift+T.
 *  F. real keyboard in the live app (CDP delivers reserved combos — R32 precedent).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r36", name: "r36", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeHotkey, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = ["r36/a.md", "r36/b.md", "r36/c.md", "r36/d.md"];
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);

const activePath = () => app(() => window.__app.workspace.getActiveFile());
const activeTabPaths = () => app(() => window.__app.workspace.getActivePane().tabs.map((t) => t.filePath));
const activeTabCount = () => app(() => window.__app.workspace.getActivePane().tabs.length);
const activeMode = () => app(() => window.__app.workspace.getActiveTab()?.mode ?? null);

// deterministic base: close every tab in every pane → single empty leaf, then
// open a,b,c,d in the active pane (active = d, the last opened).
const resetTabs = async () => {
  await app(() => {
    const ws = window.__app.workspace;
    for (const leaf of ws.getPanes()) for (const tab of [...leaf.tabs]) ws.closeTab(tab.id);
  });
  await app((files) => {
    const ws = window.__app.workspace;
    ws.openFile(files[0]);
    for (let i = 1; i < files.length; i++) ws.openFile(files[i], { newTab: true });
  }, FILES);
  await wait(50);
};

for (const f of FILES) await create(f, "# " + f);

// ── A. workspace store ops ───────────────────────────────────────────────────
console.log("A. workspace store ops (pure, deterministic)");
await resetTabs();
ok("setup: active pane = [a,b,c,d]", JSON.stringify(await activeTabPaths()) === JSON.stringify(FILES), JSON.stringify(await activeTabPaths()));
ok("setup: active tab = d (last opened)", (await activePath()) === "r36/d.md");

await app(() => window.__app.workspace.activateTabAt(0));
ok("activateTabAt(0) → a", (await activePath()) === "r36/a.md");
await app(() => window.__app.workspace.activateTabAt(2));
ok("activateTabAt(2) → c", (await activePath()) === "r36/c.md");
await app(() => window.__app.workspace.activateTabAt(99));
ok("activateTabAt(99) out-of-range → no-op (stays c)", (await activePath()) === "r36/c.md");
await app(() => window.__app.workspace.activateLastTab());
ok("activateLastTab() → d", (await activePath()) === "r36/d.md");

await app(() => window.__app.workspace.activateTabAt(0));
await app(() => window.__app.workspace.cycleActiveTab(1));
ok("cycle(+1) a → b", (await activePath()) === "r36/b.md");
await app(() => window.__app.workspace.cycleActiveTab(-1));
ok("cycle(-1) b → a", (await activePath()) === "r36/a.md");
await app(() => window.__app.workspace.cycleActiveTab(-1));
ok("cycle(-1) a wraps → d", (await activePath()) === "r36/d.md");
await app(() => window.__app.workspace.cycleActiveTab(1));
ok("cycle(+1) d wraps → a", (await activePath()) === "r36/a.md");

// ── B. command layer ─────────────────────────────────────────────────────────
console.log("B. command layer (app.commands.execute)");
await app(() => window.__app.workspace.activateTabAt(0)); // a
await app(() => window.__app.commands.execute("app:next-tab"));
ok("execute app:next-tab → b", (await activePath()) === "r36/b.md");
await app(() => window.__app.commands.execute("app:previous-tab"));
ok("execute app:previous-tab → a", (await activePath()) === "r36/a.md");
await app(() => window.__app.commands.execute("app:go-to-tab-3"));
ok("execute app:go-to-tab-3 → c (index 2)", (await activePath()) === "r36/c.md");
await app(() => window.__app.commands.execute("app:go-to-last-tab"));
ok("execute app:go-to-last-tab → d", (await activePath()) === "r36/d.md");

const beforeNew = await activeTabCount();
await app(() => window.__app.commands.execute("app:new-tab"));
await wait(90);
ok("execute app:new-tab adds a tab (additive)", (await activeTabCount()) === beforeNew + 1, `${beforeNew}→${await activeTabCount()}`);
ok("app:new-tab active file is a fresh Untitled note", /Untitled/.test((await activePath()) ?? ""), JSON.stringify(await activePath()));

// ── C. reopen closed tab (LIFO + view-mode restore) ─────────────────────────
console.log("C. reopen closed tab (LIFO + view-mode restore)");
await resetTabs();
await app(() => {
  const ws = window.__app.workspace;
  ws.activateTabAt(2);                 // c
  const t = ws.getActiveTab();
  ws.setTabMode(t.id, "source");       // give c a non-default mode
  ws.closeTab(t.id);
});
await wait(40);
ok("after closing c, active pane has 3 tabs", (await activeTabCount()) === 3);
ok("c removed from active pane", !(await activeTabPaths()).includes("r36/c.md"));

const reopened = await app(() => window.__app.workspace.reopenClosedTab());
await wait(60);
ok("reopenClosedTab() returns true", reopened === true);
ok("c reopened (active file = r36/c.md)", (await activePath()) === "r36/c.md");
ok("c reopened in source mode (mode restored)", (await activeMode()) === "source");
ok("active pane back to 4 tabs", (await activeTabCount()) === 4);

// via command id
await app(() => { const ws = window.__app.workspace; ws.closeTab(ws.getActiveTab().id); });
await wait(40);
const reopenCmd = await app(() => window.__app.commands.execute("app:reopen-closed-tab"));
await wait(60);
ok("app:reopen-closed-tab command reopens c", reopenCmd === true && (await activePath()) === "r36/c.md");

// reopen with an empty stack → false (no throw)
await app(() => { while (window.__app.workspace.reopenClosedTab()) { /* drain */ } });
ok("reopen with empty stack → false", (await app(() => window.__app.workspace.reopenClosedTab())) === false);

// ── D. store → UI binding ────────────────────────────────────────────────────
console.log("D. store → UI binding (.tab.is-active reflects the store)");
await resetTabs();
await app(() => window.__app.workspace.activateTabAt(1)); // b
await wait(140); // let React re-render the tab bar
const activeTitle = await app(() => {
  const el = document.querySelector(".tab-bar .tab.is-active .tab-title");
  return el ? el.textContent : null;
});
ok("active tab-bar reflects b (title 'b')", activeTitle === "b", JSON.stringify(activeTitle));

// ── E. hotkey grammar (pure, both platforms) ─────────────────────────────────
console.log("E. hotkey grammar (__geodeHotkey.match, both platforms)");
const ev = (o) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "", code: "", ...o });
const m = (hotkey, e, isMac) => app(([h, evt, mac]) => window.__geodeHotkey.match(h, evt, mac), [hotkey, e, isMac]);

ok("Ctrl+Tab fires on physical Ctrl+Tab (mac)", (await m("Ctrl+Tab", ev({ ctrlKey: true, key: "Tab" }), true)) === true);
ok("Ctrl+Tab does NOT fire on Cmd+Tab (mac app switcher)", (await m("Ctrl+Tab", ev({ metaKey: true, key: "Tab" }), true)) === false);
ok("Ctrl+Tab fires on Ctrl+Tab (win)", (await m("Ctrl+Tab", ev({ ctrlKey: true, key: "Tab" }), false)) === true);
ok("Ctrl+Shift+Tab fires (mac)", (await m("Ctrl+Shift+Tab", ev({ ctrlKey: true, shiftKey: true, key: "Tab" }), true)) === true);
ok("Mod+1 → Cmd+1 fires (mac)", (await m("Mod+1", ev({ metaKey: true, key: "1" }), true)) === true);
ok("Mod+1 → Ctrl+1 fires (win)", (await m("Mod+1", ev({ ctrlKey: true, key: "1" }), false)) === true);
ok("Mod+1 does NOT fire on Ctrl+1 (mac)", (await m("Mod+1", ev({ ctrlKey: true, key: "1" }), true)) === false);
ok("Mod+9 → Cmd+9 fires (mac)", (await m("Mod+9", ev({ metaKey: true, key: "9" }), true)) === true);
ok("Mod+T → Cmd+T fires (mac)", (await m("Mod+T", ev({ metaKey: true, key: "t" }), true)) === true);
ok("Mod+Shift+T → Cmd+Shift+T fires (mac)", (await m("Mod+Shift+T", ev({ metaKey: true, shiftKey: true, key: "t" }), true)) === true);

// ── F. real keyboard in the live app ─────────────────────────────────────────
console.log("F. real keyboard (CDP delivers reserved combos — R32 precedent)");
await resetTabs();
await app(() => window.__app.workspace.activateTabAt(0)); // a
await wait(60);
await page.click(".cm-content"); // focus editor → R33 Prec.highest interceptor + window listener both in play
await wait(40);
await page.keyboard.press("Control+Tab");
await wait(80);
ok("real Ctrl+Tab → next tab (b)", (await activePath()) === "r36/b.md", JSON.stringify(await activePath()));
await page.keyboard.press("Control+Shift+Tab");
await wait(80);
ok("real Ctrl+Shift+Tab → prev tab (a)", (await activePath()) === "r36/a.md", JSON.stringify(await activePath()));
const mod = process.platform === "darwin" ? "Meta" : "Control";
await page.keyboard.press(`${mod}+3`);
await wait(80);
ok("real Mod+3 → tab 3 (c)", (await activePath()) === "r36/c.md", JSON.stringify(await activePath()));
await page.keyboard.press(`${mod}+9`);
await wait(80);
ok("real Mod+9 → last tab (d)", (await activePath()) === "r36/d.md", JSON.stringify(await activePath()));

// Mod+T / Mod+Shift+T are the combos the task flagged as "browser/system may
// swallow" — assert real-key end-to-end, not just grammar (R35 lesson: harden).
await page.click(".cm-content");
const beforeT = await activeTabCount();
await page.keyboard.press(`${mod}+t`);
await wait(140);
ok("real Mod+T → new Untitled tab (additive)",
  (await activeTabCount()) === beforeT + 1 && /Untitled/.test((await activePath()) ?? ""),
  `${beforeT}→${await activeTabCount()} ${JSON.stringify(await activePath())}`);
const justCreated = await activePath();
await app(() => { const ws = window.__app.workspace; ws.closeTab(ws.getActiveTab().id); });
await wait(60);
await page.click(".cm-content");
await page.keyboard.press(`${mod}+Shift+t`);
await wait(140);
ok("real Mod+Shift+T → reopens the just-closed tab", (await activePath()) === justCreated,
  `want ${justCreated} got ${JSON.stringify(await activePath())}`);

// ── G. reopen-stack reactive purge/remap (R36 review hardening) ──────────────
console.log("G. reopen-stack reactive purge/remap (vault-switch / delete / rename / folder-prefix / graph)");
await create("sub/inner.md", "# inner");
await create("subextra.md", "# subextra");

// vault switch (reason "load") clears the stack so Mod+Shift+T can't open a
// same-named file in a different vault (R36 fix) — also our deterministic reset.
await resetTabs();
await app(() => window.__app.events.emit("vault:changed", { reason: "load" }));
ok("vault-switch (reason 'load') clears the reopen stack (R36 fix)",
  (await app(() => window.__app.workspace.reopenClosedTab())) === false);

// delete-purge: a deleted file is dropped from the reopen stack
await resetTabs();
await app(() => window.__app.events.emit("vault:changed", { reason: "load" }));
await app(() => { const ws = window.__app.workspace; ws.activateTabAt(1); ws.closeTab(ws.getActiveTab().id); }); // push b
await app(() => window.__app.events.emit("file:deleted", { path: "r36/b.md" }));
ok("delete-purge: deleted file dropped from reopen stack",
  (await app(() => window.__app.workspace.reopenClosedTab())) === false);

// rename-remap: a renamed closed file reopens at its NEW path
await app(() => window.__app.events.emit("vault:changed", { reason: "load" }));
await app(() => { const ws = window.__app.workspace; ws.openFile("r36/c.md", { newTab: true }); ws.closeTab(ws.getActiveTab().id); }); // push c
await app(() => window.__app.events.emit("file:renamed", { oldPath: "r36/c.md", newPath: "r36/crenamed.md" }));
const rr = await app(() => window.__app.workspace.reopenClosedTab());
ok("rename-remap: reopen opens the renamed path", rr === true && (await activePath()) === "r36/crenamed.md", JSON.stringify(await activePath()));

// folder-prefix: deleting folder "sub" purges "sub/inner.md" but NOT "subextra.md"
await app(() => window.__app.events.emit("vault:changed", { reason: "load" }));
await app(() => {
  const ws = window.__app.workspace;
  ws.openFile("sub/inner.md", { newTab: true }); ws.closeTab(ws.getActiveTab().id);  // push sub/inner.md
  ws.openFile("subextra.md", { newTab: true }); ws.closeTab(ws.getActiveTab().id);   // push subextra.md
});
await app(() => window.__app.events.emit("file:deleted", { path: "sub" }));
const fp1 = await app(() => window.__app.workspace.reopenClosedTab());
ok("folder-prefix: 'sub' delete keeps 'subextra.md' (no false-prefix purge)",
  fp1 === true && (await activePath()) === "subextra.md", JSON.stringify(await activePath()));
ok("folder-prefix: 'sub/inner.md' WAS purged by 'sub' folder delete",
  (await app(() => window.__app.workspace.reopenClosedTab())) === false);

// missing-purge keeps graph entries (filePath null) — closeMissingFileTabs filter
await app(() => window.__app.events.emit("vault:changed", { reason: "load" }));
await app(() => {
  const ws = window.__app.workspace;
  ws.openGraph(); ws.closeTab(ws.getActiveTab().id);                                  // push graph (filePath null)
  ws.openFile("r36/d.md", { newTab: true }); ws.closeTab(ws.getActiveTab().id);       // push d.md
});
await app(() => window.__app.workspace.closeMissingFileTabs(() => false));            // everything "missing"
const g1 = await app(() => window.__app.workspace.reopenClosedTab());
ok("missing-purge drops markdown but keeps graph entry (reopens graph)",
  g1 === true && (await app(() => window.__app.workspace.getActiveTab()?.viewType)) === "graph",
  JSON.stringify(await app(() => window.__app.workspace.getActiveTab()?.viewType)));

console.log(`\nR36 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
