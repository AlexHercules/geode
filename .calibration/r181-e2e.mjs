/**
 * R181 — G3: per-view "Show X" sidebar-panel commands — browser :1420.
 * Run: node .calibration/r181-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 181 additions" (G3).
 *
 * Geode has the panels (explorer/search left; backlinks/outline/tags/allproperties
 * right) but only show-footnotes / show-outgoing-links had commands. R181 adds the
 * remaining per-view "Show X" commands (real handlers reusing setLeft/RightPanel,
 * which also open the sidebar) — advancing the command total with NO empty rows.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r181", name: "r181", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LEFT = [
  { id: "app:show-file-explorer", panel: "explorer" },
  { id: "app:show-search", panel: "search" },
];
const RIGHT = [
  { id: "app:show-backlinks", panel: "backlinks" },
  { id: "app:show-outline", panel: "outline" },
  { id: "app:show-tags", panel: "tags" },
  { id: "app:show-all-properties", panel: "allproperties" },
];

console.log("— all 6 commands registered with real (non-key) names —");
const registry = await app(() => {
  const list = window.__app.commands.list();
  return list.filter((c) => c.id.startsWith("app:show-")).map((c) => ({ id: c.id, name: c.name() }));
});
for (const { id } of [...LEFT, ...RIGHT]) {
  const entry = registry.find((c) => c.id === id);
  ok(`${id} registered`, !!entry);
  ok(`${id} name resolves (not raw key)`, !!entry && entry.name !== "" && !entry.name.startsWith("cmd."), entry?.name);
}

console.log("— right-panel commands switch panel + open right sidebar —");
for (const { id, panel } of RIGHT) {
  // start from a different panel + closed sidebar so both effects are observable
  await app(() => window.__app.workspace.setRightPanel("footnotes")); // known panel, opens sidebar
  await app(() => window.__app.workspace.toggleRightSidebar());        // → closed
  await wait(30);
  await app(([cid]) => window.__app.commands.execute(cid), [id]);
  await wait(60);
  const st = await app(() => window.__app.workspace.state.get());
  ok(`${id} → rightPanel="${panel}"`, st.rightPanel === panel, st.rightPanel);
  ok(`${id} → right sidebar opened`, st.rightSidebarOpen === true);
}

console.log("— left-panel commands switch panel + open left sidebar —");
for (const { id, panel } of LEFT) {
  await app(() => window.__app.workspace.setLeftPanel("bookmarks")); // known panel, opens sidebar
  await app(() => window.__app.workspace.toggleLeftSidebar());        // → closed
  await wait(30);
  await app(([cid]) => window.__app.commands.execute(cid), [id]);
  await wait(60);
  const st = await app(() => window.__app.workspace.state.get());
  ok(`${id} → leftPanel="${panel}"`, st.leftPanel === panel, st.leftPanel);
  ok(`${id} → left sidebar opened`, st.leftSidebarOpen === true);
}

console.log("— commands are always available (no active-file gating) —");
ok("show-outline has no available() gate (always runnable)", await app(() => {
  const cmd = window.__app.commands.list().find((c) => c.id === "app:show-outline");
  return cmd != null && (cmd.available === undefined || cmd.available() === true);
}));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR181: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
