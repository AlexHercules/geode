/**
 * R37 back/forward navigation history E2E — browser mode (Memory vault) vs dev :1420.
 * Run: node .calibration/r37-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 37 additions".
 *
 * Navigation history is a workspace STORE op (per-tab back/forward of viewed
 * files) — fully drivable, no live view needed. Covers:
 *  A. nav within a tab: back/forward + wrap no-op + canTabNavigate*.
 *  B. a new navigation clears the forward stack.
 *  C. command layer (app:navigate-back / app:navigate-forward).
 *  D. a fresh tab (newTab) has empty history.
 *  E. store → UI binding: editor-header nav disabled reflects canTabNavigate* (proves
 *     no extra Store needed — every history change rides a workspace.state change).
 *  F. hotkey grammar (__geodeHotkey.match): Mod+Alt+Arrow both platforms.
 *  G. real keyboard: Mod+Alt+Left/Right step history (CDP delivers; Alt+← is a
 *     browser-reserved combo — R32 precedent it still reaches the page).
 *  H. cleanup hooks: rename-remap / delete-purge / vault-switch clear of history.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r37", name: "r37", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeHotkey, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = ["r37/a.md", "r37/b.md", "r37/c.md", "r37/d.md", "r37/e.md"];
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 25));
}, [p, c]);
for (const f of FILES) await create(f, "# " + f);

const activePath = () => app(() => window.__app.workspace.getActiveFile());
const activeTabId = () => app(() => window.__app.workspace.getActiveTab()?.id ?? null);
const canBack = (id) => app((t) => window.__app.workspace.canTabNavigateBack(t), id);
const canFwd = (id) => app((t) => window.__app.workspace.canTabNavigateForward(t), id);
const activeMode = () => app(() => window.__app.workspace.getActiveTab()?.mode ?? null);

// ONE tab navigating a→b→c (openFile without newTab replaces the active tab's
// content, recording the old location). After this: 1 tab showing c, back=[a,b].
const navSetup = async () => {
  await app(() => { const ws = window.__app.workspace; for (const leaf of ws.getPanes()) for (const t of [...leaf.tabs]) ws.closeTab(t.id); });
  await app(() => { const ws = window.__app.workspace; ws.openFile("r37/a.md"); ws.openFile("r37/b.md"); ws.openFile("r37/c.md"); });
  await wait(50);
};

// ── A. nav within a tab ──────────────────────────────────────────────────────
console.log("A. navigation within a tab (back/forward/wrap/canTabNavigate)");
await navSetup();
const tid = await activeTabId();
ok("setup: single tab showing c", (await activePath()) === "r37/c.md");
ok("canTabNavigateBack=true, canTabNavigateForward=false after a→b→c",
  (await canBack(tid)) === true && (await canFwd(tid)) === false);
await app(() => window.__app.workspace.navigateBack());
ok("back: c → b", (await activePath()) === "r37/b.md");
await app(() => window.__app.workspace.navigateBack());
ok("back: b → a", (await activePath()) === "r37/a.md");
ok("canTabNavigateBack=false at oldest", (await canBack(tid)) === false);
await app(() => window.__app.workspace.navigateBack());
ok("back at oldest → no-op (stays a)", (await activePath()) === "r37/a.md");
await app(() => window.__app.workspace.navigateForward());
ok("forward: a → b", (await activePath()) === "r37/b.md");
await app(() => window.__app.workspace.navigateForward());
ok("forward: b → c", (await activePath()) === "r37/c.md");
ok("canTabNavigateForward=false at newest", (await canFwd(tid)) === false);
await app(() => window.__app.workspace.navigateForward());
ok("forward at newest → no-op (stays c)", (await activePath()) === "r37/c.md");

// ── B. a new navigation clears forward ───────────────────────────────────────
console.log("B. a new navigation clears the forward stack");
await navSetup();              // c, back=[a,b]
await app(() => window.__app.workspace.navigateBack()); // b, fwd=[c]
const tidB = await activeTabId();
ok("mid-history: forward available", (await canFwd(tidB)) === true);
await app(() => window.__app.workspace.openFile("r37/d.md")); // replace b→d, clears forward
ok("after new nav to d: active = d", (await activePath()) === "r37/d.md");
ok("after new nav: forward cleared", (await canFwd(tidB)) === false);
ok("after new nav: back still available", (await canBack(tidB)) === true);
await app(() => window.__app.workspace.navigateBack());
ok("back after new nav → b (the pre-nav location)", (await activePath()) === "r37/b.md");

// ── C. command layer ─────────────────────────────────────────────────────────
console.log("C. command layer (app:navigate-back / app:navigate-forward)");
await navSetup(); // c, back=[a,b]
await app(() => window.__app.commands.execute("app:navigate-back"));
ok("execute app:navigate-back → b", (await activePath()) === "r37/b.md");
await app(() => window.__app.commands.execute("app:navigate-forward"));
ok("execute app:navigate-forward → c", (await activePath()) === "r37/c.md");

// ── D. a fresh tab has empty history ─────────────────────────────────────────
console.log("D. a new tab starts with empty history");
await app(() => window.__app.workspace.openFile("r37/e.md", { newTab: true }));
await wait(40);
const tidE = await activeTabId();
ok("new tab active = e", (await activePath()) === "r37/e.md");
ok("new tab has no back history", (await canBack(tidE)) === false);
ok("new tab has no forward history", (await canFwd(tidE)) === false);

// ── E. store → UI binding (view-header nav reflects canTabNavigate*) ─────
console.log("E. store → UI binding (nav buttons disabled state)");
await navSetup(); // c, back enabled, fwd disabled
await wait(120);
const btns1 = await app(() => [...document.querySelectorAll(".pane.is-active .editor-nav-actions .editor-header-action")].map((b) => b.disabled));
ok("UI: [back enabled, forward disabled] after a→b→c", btns1.length === 2 && btns1[0] === false && btns1[1] === true, JSON.stringify(btns1));
await app(() => window.__app.workspace.navigateBack());
await wait(120);
const btns2 = await app(() => [...document.querySelectorAll(".pane.is-active .editor-nav-actions .editor-header-action")].map((b) => b.disabled));
ok("UI: [back enabled, forward enabled] at mid-history", btns2[0] === false && btns2[1] === false, JSON.stringify(btns2));

// ── F. hotkey grammar (both platforms) ───────────────────────────────────────
console.log("F. hotkey grammar (__geodeHotkey.match Mod+Alt+Arrow)");
const ev = (o) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "", code: "", ...o });
const m = (hotkey, e, isMac) => app(([h, evt, mac]) => window.__geodeHotkey.match(h, evt, mac), [hotkey, e, isMac]);
ok("Mod+Alt+Left → Cmd+Alt+Left fires (mac)", (await m("Mod+Alt+ArrowLeft", ev({ metaKey: true, altKey: true, key: "ArrowLeft" }), true)) === true);
ok("Mod+Alt+Left → Ctrl+Alt+Left fires (win)", (await m("Mod+Alt+ArrowLeft", ev({ ctrlKey: true, altKey: true, key: "ArrowLeft" }), false)) === true);
ok("Mod+Alt+Right → Cmd+Alt+Right fires (mac)", (await m("Mod+Alt+ArrowRight", ev({ metaKey: true, altKey: true, key: "ArrowRight" }), true)) === true);
ok("Mod+Alt+Left does NOT fire without Alt (mac)", (await m("Mod+Alt+ArrowLeft", ev({ metaKey: true, key: "ArrowLeft" }), true)) === false);

// ── G. real keyboard ─────────────────────────────────────────────────────────
console.log("G. real keyboard (Mod+Alt+Arrow — CDP delivers reserved combos)");
await navSetup(); // c, back=[a,b]
await wait(40);
await page.click(".cm-content");
await wait(40);
const mod = process.platform === "darwin" ? "Meta" : "Control";
await page.keyboard.press(`${mod}+Alt+ArrowLeft`);
await wait(80);
ok("real Mod+Alt+Left → back to b", (await activePath()) === "r37/b.md", JSON.stringify(await activePath()));
await page.keyboard.press(`${mod}+Alt+ArrowLeft`);
await wait(80);
ok("real Mod+Alt+Left → back to a", (await activePath()) === "r37/a.md", JSON.stringify(await activePath()));
await page.keyboard.press(`${mod}+Alt+ArrowRight`);
await wait(80);
ok("real Mod+Alt+Right → forward to b", (await activePath()) === "r37/b.md", JSON.stringify(await activePath()));

// ── H. cleanup hooks (rename-remap / delete-purge / vault-switch clear) ──────
console.log("H. history cleanup (rename / delete / vault-switch)");
// rename-remap: a→b in one tab (back=[a]); rename a→arenamed; back → arenamed
await navSetup();
await app(() => window.__app.workspace.navigateBack()); // b (back=[a], fwd=[c])
await app(() => window.__app.workspace.navigateBack()); // a (back=[], fwd=[c,b]) — now at a
// re-navigate to build a clean back=[a]
await app(() => window.__app.workspace.openFile("r37/b.md")); // a→b, back=[a], fwd cleared
await app(() => window.__app.events.emit("file:renamed", { oldPath: "r37/a.md", newPath: "r37/arenamed.md" }));
await app(() => window.__app.workspace.navigateBack());
ok("rename-remap: back lands on the renamed path", (await activePath()) === "r37/arenamed.md", JSON.stringify(await activePath()));

// delete-purge: build back=[x]; delete x; back → no-op (x purged)
await navSetup(); // c, back=[a,b]
await app(() => window.__app.events.emit("file:deleted", { path: "r37/a.md" }));
// back=[a,b] → a purged → back=[b]; first back → b, second back → no-op
await app(() => window.__app.workspace.navigateBack());
ok("delete-purge: back skips deleted a → b", (await activePath()) === "r37/b.md", JSON.stringify(await activePath()));
const tidH = await activeTabId();
ok("delete-purge: deleted 'a' gone from history (only one back step remained)", (await canBack(tidH)) === false);

// vault-switch clear: build history; emit vault:changed load; back → no-op
await navSetup(); // c, back=[a,b]
await app(() => window.__app.events.emit("vault:changed", { reason: "load" }));
const tidV = await activeTabId();
ok("vault-switch (reason 'load') clears nav history", (await canBack(tidV)) === false && (await canFwd(tidV)) === false);
await app(() => window.__app.workspace.navigateBack());
ok("vault-switch: back is a no-op after clear", (await activePath()) === "r37/c.md", JSON.stringify(await activePath()));

// ── I. review-hardening: view-mode restore + forward-stack delete-purge ──────
console.log("I. review-hardening (view-mode restore + forward-stack purge)");
// view-mode restore: view a in source, navigate to b, back → a still source
await app(() => { const ws = window.__app.workspace; for (const leaf of ws.getPanes()) for (const t of [...leaf.tabs]) ws.closeTab(t.id); });
await app(() => {
  const ws = window.__app.workspace;
  ws.openFile("r37/a.md");
  ws.setTabMode(ws.getActiveTab().id, "source"); // view a in source mode
  ws.openFile("r37/b.md");                        // navigate a→b, records {a, source}
});
await wait(40);
await app(() => window.__app.workspace.navigateBack());
ok("nav restores view mode: back to a restores 'source' mode",
  (await activePath()) === "r37/a.md" && (await activeMode()) === "source",
  JSON.stringify([await activePath(), await activeMode()]));

// forward-stack delete-purge: build fwd=[c,b], delete b, forward skips b → c
await app(() => { const ws = window.__app.workspace; for (const leaf of ws.getPanes()) for (const t of [...leaf.tabs]) ws.closeTab(t.id); });
await app(() => { const ws = window.__app.workspace; ws.openFile("r37/a.md"); ws.openFile("r37/b.md"); ws.openFile("r37/c.md"); });
await app(() => { const ws = window.__app.workspace; ws.navigateBack(); ws.navigateBack(); }); // → a, fwd=[c,b]
await app(() => window.__app.events.emit("file:deleted", { path: "r37/b.md" }));
await app(() => window.__app.workspace.navigateForward());
ok("forward-stack delete-purge: forward skips deleted b → c",
  (await activePath()) === "r37/c.md", JSON.stringify(await activePath()));

console.log(`\nR37 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
