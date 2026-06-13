/**
 * R39 pinned tabs E2E — browser mode (Memory vault) vs dev :1420.
 * Run: node .calibration/r39-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 39 additions".
 *
 * A pinned tab is never replaced by openFile — links/navigation open a NEW tab.
 * Pure store op, fully drivable. Covers:
 *  A. toggleTabPin + openFile-respects-pin (pinned active tab → new tab, not replace).
 *  B. recordNavigation skips a pinned tab (no phantom history on it).
 *  C. unpinned active tab still replaces (regression of normal openFile).
 *  D. UI: .tab.is-pinned + .tab-pin icon; double-click toggles pin.
 *  E. command app:toggle-pin toggles the active tab.
 *  F. pin persists across reload (sanitizeTab round-trip).
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
const grabApp = () => page.evaluate(() => window.geode.registerPlugin({ id: "r39", name: "r39", onload(app) { window.__app = app; } }));
await grabApp();
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = ["r39/a.md", "r39/b.md", "r39/c.md", "r39/d.md"];
for (const f of FILES) {
  await app(async (p) => { try { await window.__app.vault.create(p, "# " + p); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 25)); }, f);
}

const tabs = () => app(() => window.__app.workspace.getActivePane().tabs.map((t) => ({ path: t.filePath, pinned: !!t.pinned, id: t.id })));
const activeFile = () => app(() => window.__app.workspace.getActiveFile());
const resetOpenA = async () => {
  await app(() => { const ws = window.__app.workspace; for (const leaf of ws.getPanes()) for (const t of [...leaf.tabs]) ws.closeTab(t.id); ws.openFile("r39/a.md"); });
  await wait(50);
};

// ── A. toggleTabPin + openFile respects pin ──────────────────────────────────
console.log("A. toggleTabPin + openFile-respects-pin");
await resetOpenA();
const aId = await app(() => window.__app.workspace.getActiveTab().id);
await app((id) => window.__app.workspace.toggleTabPin(id), aId);
let t = await tabs();
ok("toggleTabPin marks the tab pinned", t.length === 1 && t[0].pinned === true, JSON.stringify(t));
await app(() => window.__app.workspace.openFile("r39/b.md"));
await wait(40);
t = await tabs();
ok("openFile with pinned active tab → NEW tab (not replace)", t.length === 2, JSON.stringify(t));
ok("pinned tab keeps its file (a.md, still pinned)", t.find((x) => x.id === aId)?.path === "r39/a.md" && t.find((x) => x.id === aId)?.pinned === true, JSON.stringify(t));
ok("active is the new tab (b.md)", (await activeFile()) === "r39/b.md");

// ── B. recordNavigation skips pinned tab (no phantom history) ────────────────
console.log("B. recordNavigation skips pinned tab");
ok("pinned tab has NO back history (no phantom record)",
  (await app((id) => window.__app.workspace.canTabNavigateBack(id), aId)) === false);

// ── C. unpinned active tab still replaces (normal openFile regression) ───────
console.log("C. unpinned active tab still replaces");
await app((id) => { const ws = window.__app.workspace; ws.toggleTabPin(id); ws.setActiveTab(id); }, aId); // unpin A + activate
await app(() => window.__app.workspace.openFile("r39/c.md")); // A unpinned + active → replace
await wait(40);
t = await tabs();
ok("unpinned active tab replaced (tab count unchanged = 2)", t.length === 2, JSON.stringify(t));
ok("active tab now shows c.md (replaced)", (await activeFile()) === "r39/c.md");
ok("the once-pinned tab is no longer pinned", t.every((x) => x.pinned === false) || t.find((x) => x.id === aId)?.pinned === false, JSON.stringify(t));

// ── D. UI: .is-pinned + .tab-pin; double-click toggles ───────────────────────
console.log("D. UI pin indicator + double-click toggle");
await resetOpenA();
await wait(80);
// dispatch a real bubbling `dblclick` DOM event (what a user double-click
// produces). Playwright's synthetic page.dblclick is swallowed by the tab's
// `draggable=true` handling — a harness artifact; real users + this dispatched
// event both fire React's onDoubleClick. Verified: handler IS wired.
const dblclickTab = () => app(() => document.querySelector(".pane.is-active .tab-bar .tab").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
ok("fresh tab not pinned (no .is-pinned)", (await app(() => document.querySelectorAll(".pane.is-active .tab-bar .tab.is-pinned").length)) === 0);
await dblclickTab();
await wait(100);
ok("double-click pins the tab (.is-pinned + .tab-pin icon)",
  (await app(() => document.querySelectorAll(".pane.is-active .tab-bar .tab.is-pinned").length)) === 1 &&
  (await app(() => document.querySelectorAll(".pane.is-active .tab-bar .tab .tab-pin").length)) === 1);
await dblclickTab();
await wait(100);
ok("double-click again unpins", (await app(() => document.querySelectorAll(".pane.is-active .tab-bar .tab.is-pinned").length)) === 0);

// ── E. command app:toggle-pin ────────────────────────────────────────────────
console.log("E. command app:toggle-pin");
await resetOpenA();
await app(() => window.__app.commands.execute("app:toggle-pin"));
ok("app:toggle-pin pins the active tab", (await tabs())[0].pinned === true);
await app(() => window.__app.commands.execute("app:toggle-pin"));
ok("app:toggle-pin again unpins", (await tabs())[0].pinned === false);

// ── F. split copy not pinned + reopen restores pin (R39 review hardening) ───
console.log("F. split copy unpinned + reopen restores pin");
await resetOpenA();
await app(() => { const ws = window.__app.workspace; ws.toggleTabPin(ws.getActiveTab().id); }); // pin a.md
await app(() => window.__app.workspace.splitActivePane("row"));
await wait(60);
const splitPins = await app(() => window.__app.workspace.getPanes().map((l) => l.tabs.map((t) => !!t.pinned)));
ok("split: source pane keeps pinned, new pane copy is NOT pinned",
  splitPins.length === 2 && splitPins[0][0] === true && splitPins[1][0] === false, JSON.stringify(splitPins));

await resetOpenA();
await app(() => { const ws = window.__app.workspace; ws.toggleTabPin(ws.getActiveTab().id); ws.closeTab(ws.getActiveTab().id); }); // pin then close a.md
await wait(40);
const reopenedPinned = await app(() => {
  const ok = window.__app.workspace.reopenClosedTab();
  const t = window.__app.workspace.getActiveTab();
  return ok && t ? !!t.pinned : null;
});
ok("reopen closed tab restores its pinned state", reopenedPinned === true, JSON.stringify(reopenedPinned));

// ── G. pin persists across reload (sanitizeTab round-trip) ──────────────────
// Use a SEED file (survives the MemoryVault re-seed on reload; a created r39/*.md
// would vanish + closeMissingFileTabs would drop its tab — not a pin-persistence
// failure but a memory-adapter artifact).
console.log("G. pin persists across reload (seed file)");
await app(() => { const ws = window.__app.workspace; for (const l of ws.getPanes()) for (const t of [...l.tabs]) ws.closeTab(t.id); ws.openFile("Welcome.md"); });
await wait(60);
await app(() => window.__app.commands.execute("app:toggle-pin")); // pin Welcome.md
await wait(60);
const persistedPinned = await app(() => {
  const raw = JSON.parse(localStorage.getItem("geode.workspace.v1"));
  const flat = [];
  const walk = (n) => { if (n.kind === "leaf") flat.push(...n.tabs); else n.children.forEach(walk); };
  walk(raw.root);
  return flat.some((t) => t.filePath === "Welcome.md" && t.pinned === true);
});
ok("pinned flag written to persisted workspace state", persistedPinned === true);
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await grabApp();
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
const afterReload = await app(() => {
  const t = window.__app.workspace.getActivePane().tabs.find((x) => x.filePath === "Welcome.md");
  return t ? !!t.pinned : null;
});
ok("pin survives reload (sanitizeTab restores pinned)", afterReload === true, JSON.stringify(afterReload));

console.log(`\nR39 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
