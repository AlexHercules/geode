/**
 * R211 — G3 §8 partial→done (首片): backlink:open-backlinks (Obsidian "Open
 * backlinks for the current file"). Opens the backlinks panel as a MAIN-AREA tab
 * (viewType "backlinks", a singleton like the graph). Follows lastActiveFile so it
 * shows the last active markdown file's backlinks. Browser :1420.
 * Run: node .calibration/r211-e2e.mjs   Contract: ARCHITECTURE "Round 211 additions".
 *
 * A = registration (no hotkey). B = command opens a main-area backlinks tab that
 * shows the active file's backlinks. C = singleton + serialization-allow + the
 * BacklinksPanel lastActiveFile fallback (panel stays populated when the backlinks
 * tab itself is active).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r211", name: "r211", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const backlinksTabCount = () => app(() => {
  const flat = [];
  const walk = (n) => { if (n.tabs) flat.push(...n.tabs); (n.children || []).forEach(walk); };
  walk(window.__app.workspace.state.get().root);
  return flat.filter((t) => t.viewType === "backlinks").length;
});
const activeViewType = () => app(() => window.__app.workspace.getActiveTab()?.viewType ?? null);

console.log("A. command registration + no default hotkey");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "backlink:open-backlinks");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("backlink:open-backlinks") || null };
});
ok("backlink:open-backlinks registered", reg.present);
ok("name resolves (not raw 'cmd.' key)", !!reg.name && !reg.name.startsWith("cmd."), String(reg.name));
ok("has NO default hotkey", reg.hotkey === null, String(reg.hotkey));

// SourceNote links TargetNote → TargetNote's backlink is SourceNote
await app(async () => {
  try { await window.__app.vault.create("TargetNote.md", "# Target\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("SourceNote.md", "see [[TargetNote]]\n"); } catch { /* exists */ }
});
await wait(250); // metadata index
await app(() => window.__app.workspace.openFile("TargetNote.md")); // lastActiveFile = TargetNote
await wait(150);

console.log("B. command opens a MAIN-AREA backlinks tab showing the active file's backlinks");
await app(() => window.__app.commands.execute("backlink:open-backlinks"));
await wait(200);
ok("active tab is now a 'backlinks' view", (await activeViewType()) === "backlinks");
ok("main-area backlinks panel rendered", await app(() => !!document.querySelector(".main-backlinks-view .backlinks-panel")));
ok("panel follows lastActiveFile (TargetNote) → shows SourceNote as a backlink",
  await app(() => {
    const el = document.querySelector(".main-backlinks-view");
    return !!el && el.innerText.includes("SourceNote") && !el.querySelector('[data-testid="bl-empty"]');
  }));

console.log("C. singleton + lastActiveFile fallback (panel stays populated when the backlinks tab is active)");
await app(() => window.__app.commands.execute("backlink:open-backlinks")); // again
await wait(150);
ok("singleton: only ONE backlinks tab after a second invocation", (await backlinksTabCount()) === 1);
// the backlinks tab is the active tab (getActiveFile() is null) — the panel must
// still show TargetNote's backlinks via the lastActiveFile fallback
ok("backlinks tab active → panel still shows SourceNote (lastActiveFile fallback, not empty)",
  await app(() => {
    const el = document.querySelector(".main-backlinks-view");
    return !!el && el.innerText.includes("SourceNote");
  }));
console.log("D. REAL persist→reload→restore round-trip (sanitizeTab must preserve viewType)");
// not a JSON clone — drive the actual persistence path: confirm it persisted, then
// reload so restore()→sanitizeState→sanitizeTab runs, and confirm the tab comes back
// AS a backlinks view (a missed viewType re-derivation would silently re-type it to a
// phantom empty markdown editor).
ok("backlinks tab persisted to localStorage (geode.workspace.v1)",
  await app(() => (localStorage.getItem("geode.workspace.v1") || "").includes('"backlinks"')));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r211b", name: "r211b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await wait(250);
ok("after RELOAD: exactly one 'backlinks' tab restored (sanitizeTab preserved viewType)", (await backlinksTabCount()) === 1);
ok("after RELOAD: restored tab renders as the main-area backlinks view (NOT a phantom markdown editor)",
  await app(() => !!document.querySelector(".main-backlinks-view")));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR211: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
