/**
 * R212 — G3 §8 主区视图 host 续片: outgoing-links:open-outgoing-links +
 * outline:open-outline. Opens the outgoing-links / outline panels as MAIN-AREA tabs
 * (new viewTypes, like R211's backlinks). Introduces isFilelessSingletonView so the
 * sanitizeTab reject-gate AND re-derivation are uniform (eliminates R211's miss-risk).
 * Browser :1420.  Run: node .calibration/r212-e2e.mjs
 * Contract: ARCHITECTURE "Round 212 additions".
 *
 * A = registration. B/C = each command opens a main-area tab following lastActiveFile.
 * D = singleton. E = REAL persist→reload→restore for ALL fileless singleton views
 * (graph/backlinks/outgoinglinks/outline) — proves the helper routes both sanitizeTab
 * sites. F = the openSingletonView refactor didn't break graph.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r212", name: "r212", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tabCount = (vt) => app((v) => {
  const flat = [];
  const walk = (n) => { if (n.tabs) flat.push(...n.tabs); (n.children || []).forEach(walk); };
  walk(window.__app.workspace.state.get().root);
  return flat.filter((t) => t.viewType === v).length;
}, vt);
const activeViewType = () => app(() => window.__app.workspace.getActiveTab()?.viewType ?? null);

console.log("A. command registration (no default hotkey)");
const reg = await app(() => ["outgoing-links:open-outgoing-links", "outline:open-outline"].map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey(id) || null };
}));
for (const r of reg) {
  ok(`${r.id} registered, name resolves, no hotkey`, r.present && !!r.name && !r.name.startsWith("cmd.") && r.hotkey === null, JSON.stringify(r));
}

// Hub links to Spoke (outgoing) + has headings (outline)
await app(async () => {
  try { await window.__app.vault.create("Spoke.md", "spoke\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("Hub.md", "see [[Spoke]]\n\n# Heading Alpha\n## Heading Beta\n"); } catch { /* exists */ }
});
await wait(250);
await app(() => window.__app.workspace.openFile("Hub.md")); // lastActiveFile = Hub
await wait(150);

console.log("B. outgoing-links opens a main-area tab following lastActiveFile (shows Spoke)");
await app(() => window.__app.commands.execute("outgoing-links:open-outgoing-links"));
await wait(200);
ok("active tab is 'outgoinglinks'", (await activeViewType()) === "outgoinglinks");
ok("main-area outgoing panel rendered + shows the outgoing link (Spoke)",
  await app(() => { const el = document.querySelector(".main-outgoinglinks-view"); return !!el && el.innerText.includes("Spoke"); }));

console.log("C. outline opens a main-area tab following lastActiveFile (shows headings)");
await app(() => window.__app.commands.execute("outline:open-outline"));
await wait(200);
ok("active tab is 'outline'", (await activeViewType()) === "outline");
ok("main-area outline panel rendered + shows a heading (Heading Alpha)",
  await app(() => { const el = document.querySelector(".main-outline-view"); return !!el && el.innerText.includes("Heading Alpha"); }));

console.log("D. singleton (a second invocation reuses the tab)");
await app(() => window.__app.commands.execute("outgoing-links:open-outgoing-links"));
await app(() => window.__app.commands.execute("outline:open-outline"));
await wait(150);
ok("one outgoinglinks tab", (await tabCount("outgoinglinks")) === 1);
ok("one outline tab", (await tabCount("outline")) === 1);

console.log("E. REAL persist→reload→restore for ALL fileless singleton views (sanitizeTab via helper)");
await app(() => { window.__app.commands.execute("backlink:open-backlinks"); window.__app.workspace.openGraph(); });
await wait(150);
const persisted = await app(() => localStorage.getItem("geode.workspace.v1") || "");
ok("all 4 singleton viewTypes persisted", ["graph", "backlinks", "outgoinglinks", "outline"].every((v) => persisted.includes(`"${v}"`)), persisted.slice(0, 120));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r212b", name: "r212b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await wait(250);
for (const v of ["graph", "backlinks", "outgoinglinks", "outline"]) {
  ok(`after RELOAD: '${v}' tab restored AS its type (not phantom markdown)`, (await tabCount(v)) === 1);
}

console.log("F. openSingletonView refactor didn't break graph/backlinks");
ok("a graph view is still openable + present", (await tabCount("graph")) === 1);

console.log("G. reopen-closed-tab restores a singleton AS its viewType (via isFilelessSingletonView)");
// close the outgoinglinks tab, then Mod+Shift+T-style reopen — must come back as 'outgoinglinks',
// not a phantom markdown tab (R212 routes reopen through the helper, not per-type branches).
await app(() => {
  const flat = [];
  const walk = (n) => { if (n.tabs) flat.push(...n.tabs); (n.children || []).forEach(walk); };
  walk(window.__app.workspace.state.get().root);
  const og = flat.find((t) => t.viewType === "outgoinglinks");
  if (og) window.__app.workspace.closeTab(og.id);
});
await wait(120);
ok("outgoinglinks tab closed", (await tabCount("outgoinglinks")) === 0);
await app(() => window.__app.workspace.reopenClosedTab());
await wait(150);
ok("reopenClosedTab restored it as 'outgoinglinks' (not markdown)", (await tabCount("outgoinglinks")) === 1);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR212: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
