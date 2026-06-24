/**
 * R190 — G3 ui-only→done: app:close-others / app:close-tab-group commands
 * (Obsidian workspace:close-others / workspace:close-tab-group) — browser :1420.
 * Run: node .calibration/r190-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 190 additions".
 *
 * Reuses the vetted closeOtherTabs/closeAllTabs (tab context menu handlers) via the
 * active tab — close-others keeps the active tab + pinned tabs; close-tab-group empties
 * the active group. Tab-lifecycle only (the close path flushes pending saves, R81/R4).
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
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  localStorage.removeItem("geode.workspace.v1");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r190", name: "r190", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);

// tabs of the ACTIVE leaf (the active tab group)
const leafTabs = () => app(() => {
  const s = window.__app.workspace.state.get();
  const find = (n, id) => n.kind === "leaf" ? (n.id === id ? n : null) : n.children.reduce((a, c) => a || find(c, id), null);
  const leaf = find(s.root, s.activePaneId);
  return leaf ? leaf.tabs.map((t) => ({ id: t.id, file: t.filePath, pinned: !!t.pinned, active: t.id === leaf.activeTabId })) : [];
});

const seed = async () => {
  for (const f of ["ra.md", "rb.md", "rc.md"]) {
    await app(async (p) => { try { await window.__app.vault.create(p, "# " + p + "\n"); } catch { /* exists */ } }, f);
  }
};
const openThree = () => app(() => {
  const ws = window.__app.workspace;
  ws.openFile("ra.md");
  ws.openFile("rb.md", { newTab: true });
  ws.openFile("rc.md", { newTab: true }); // rc active
});

const IDS = ["app:close-others", "app:close-tab-group"];
console.log("— both commands registered + names resolve + no default hotkey —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey(id) || null };
}), [IDS]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
  ok(`${r.id} has no default hotkey`, r.hk === null, r.hk);
}

await seed();

console.log("— app:close-others keeps only the active tab —");
await openThree();
await wait(150);
let tabs = await leafTabs();
ok("3 tabs open, rc active", tabs.length === 3 && tabs.find((t) => t.active)?.file === "rc.md", JSON.stringify(tabs));
await exec("app:close-others");
await wait(120);
tabs = await leafTabs();
ok("close-others → only rc remains", tabs.length === 1 && tabs[0].file === "rc.md", JSON.stringify(tabs));

console.log("— app:close-others skips pinned tabs —");
await openThree();
await wait(150);
// pin ra (the first tab), keep rc active
await app(() => {
  const ws = window.__app.workspace;
  const s = ws.state.get();
  const find = (n, id) => n.kind === "leaf" ? (n.id === id ? n : null) : n.children.reduce((a, c) => a || find(c, id), null);
  const leaf = find(s.root, s.activePaneId);
  const ra = leaf.tabs.find((t) => t.filePath === "ra.md");
  ws.toggleTabPin(ra.id);
});
await wait(80);
await exec("app:close-others");
await wait(120);
tabs = await leafTabs();
ok("close-others keeps pinned ra + active rc (rb closed)", tabs.length === 2 && tabs.some((t) => t.file === "ra.md") && tabs.some((t) => t.file === "rc.md") && !tabs.some((t) => t.file === "rb.md"), JSON.stringify(tabs));
// unpin to reset
await app(() => {
  const ws = window.__app.workspace;
  const s = ws.state.get();
  const find = (n, id) => n.kind === "leaf" ? (n.id === id ? n : null) : n.children.reduce((a, c) => a || find(c, id), null);
  const leaf = find(s.root, s.activePaneId);
  const ra = leaf.tabs.find((t) => t.filePath === "ra.md");
  if (ra) ws.toggleTabPin(ra.id);
});

console.log("— app:close-tab-group empties the active group —");
await openThree();
await wait(150);
ok("multi-tab group before close-tab-group", (await leafTabs()).length >= 2, JSON.stringify(await leafTabs()));
await exec("app:close-tab-group");
await wait(120);
tabs = await leafTabs();
ok("close-tab-group → active group has 0 tabs", tabs.length === 0, JSON.stringify(tabs));

console.log("— close-others reopenable via app:reopen-closed-tab (recently-closed preserved) —");
await openThree();
await wait(120);
await exec("app:close-others");
await wait(100);
ok("after close-others, 1 tab", (await leafTabs()).length === 1);
await exec("app:reopen-closed-tab");
await wait(100);
ok("reopen-closed-tab restores a closed tab (recently-closed fed by close path)", (await leafTabs()).length >= 2, JSON.stringify(await leafTabs()));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR190: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
