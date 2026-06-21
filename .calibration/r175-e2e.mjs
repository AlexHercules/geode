/**
 * R175 compat Workspace navigation (openLinkText #subpath reveal · getMostRecentLeaf ·
 * setActiveLeaf) E2E — browser mode :1420.
 * Run: node .calibration/r175-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 175 additions" (Tier 8 D15 · Workspace navigation).
 *
 * The fixture (?obsfixture=1) onload exposes window.__compatWorkspace = this.app.workspace —
 * the COMPAT App's obsidian-shaped workspace (the surface under test). The geode-NATIVE app
 * (window.__app, via window.geode.registerPlugin) builds the test notes and lets us subscribe
 * to the core workspace.revealTarget Store (the SAME core Store that compat openLinkText's
 * requestReveal sets — both shims drive one underlying core Workspace).
 *
 * Under test (all on window.__compatWorkspace):
 *   - openLinkText(linktext, sourcePath, newLeaf?, openViewState?): Promise<void>
 *       → opens the linktext target; a "#heading"/"#^block" subpath scrolls there
 *         (parseLinktext → openFile → resolveSubpath → core requestReveal → revealTarget Store).
 *   - getMostRecentLeaf(root?): WorkspaceLeaf | null  → the active-pane facade leaf.
 *   - setActiveLeaf(leaf, params?): void  → sidebar leaf → reveal, else recorded no-op (must not throw).
 *
 * Reveal assertion strategy (probe time-discipline: assert the Store, not scroll/flash DOM):
 *   subscribe to window.__app.workspace.revealTarget BEFORE openLinkText and capture every
 *   non-null set into window.__r175Reveals — race-free vs. the one-shot Store that EditorPane
 *   consumes (resets to null) asynchronously after the set.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// 1) boot WITH the fixture (?obsfixture=1) so its onload runs and exposes __compatWorkspace
await page.goto(BASE_URL + "?obsfixture=1");
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(
  () => !!window.geode && !!window.app && !!window.__compatWorkspace,
  null,
  { timeout: 15000 },
);

const app = (fn, arg) => page.evaluate(fn, arg);

// acquire the GEODE-NATIVE app (vault.create / openFile / getActiveFile + the core
// workspace.revealTarget Store live here). Mirrors r172-e2e.
await app(() => window.geode.registerPlugin({ id: "r175", name: "r175", onload(a) { window.__app = a; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

// 2) a target note with TWO headings (the second is the #subpath reveal target)
await app(async () => {
  try { await window.__app.vault.create("D15Target.md", "# Intro\n\nalpha\n\n## Section Two\n\nbeta\n"); } catch { /* exists */ }
  // settle the metadata index so resolveSubpath can find the heading
  await new Promise((r) => setTimeout(r, 150));
});

console.log("— getMostRecentLeaf returns the active-pane facade leaf —");
// open the note via the native app first so there IS a recent/active leaf
await app(() => window.__app.workspace.openFile("D15Target.md"));
await sleep(100);
const recent = await app(() => {
  const leaf = window.__compatWorkspace.getMostRecentLeaf();
  return { isNull: leaf === null, type: typeof leaf, hasView: !!(leaf && "view" in leaf) };
});
ok("getMostRecentLeaf() is non-null", recent.isNull === false, JSON.stringify(recent));
ok("getMostRecentLeaf() returns an object (a WorkspaceLeaf facade)", recent.type === "object", recent.type);

console.log("— openLinkText (no subpath) opens the target note —");
await app(async () => { await window.__compatWorkspace.openLinkText("D15Target", ""); });
await sleep(150);
ok(
  "openLinkText('D15Target','') made D15Target.md the active file",
  (await app(() => window.__app.workspace.getActiveFile())) === "D15Target.md",
);

console.log("— openLinkText (#heading subpath) opens the note AND requests a reveal —");
// install the capture BEFORE the call: every non-null revealTarget set is recorded
// (race-free against EditorPane consuming the one-shot Store back to null).
await app(() => {
  window.__r175Reveals = [];
  if (window.__r175RevealUnsub) window.__r175RevealUnsub();
  const store = window.__app.workspace.revealTarget;
  window.__r175RevealUnsub = store.subscribe(() => {
    const v = store.get();
    if (v) window.__r175Reveals.push(v);
  });
});
// open a DIFFERENT file first so the subpath openLinkText is an honest navigation
await app(() => window.__app.workspace.openFile("Welcome.md"));
await sleep(120);
let threw = false;
await app(async () => {
  try { await window.__compatWorkspace.openLinkText("D15Target#Section Two", ""); }
  catch (e) { window.__r175Threw = String(e); }
});
threw = await app(() => window.__r175Threw ?? null);
await sleep(200);
ok("openLinkText with a #subpath did not throw", threw === null, String(threw));
ok(
  "openLinkText('D15Target#Section Two','') made D15Target.md the active file",
  (await app(() => window.__app.workspace.getActiveFile())) === "D15Target.md",
);
const reveals = await app(() => window.__r175Reveals ?? []);
const targetReveal = reveals.find((r) => r && r.path === "D15Target.md");
ok(
  "a reveal was requested on the core revealTarget Store (captured a non-null set)",
  reveals.length > 0,
  JSON.stringify(reveals),
);
ok(
  "the reveal targets D15Target.md (path matches the opened note)",
  !!targetReveal,
  JSON.stringify(reveals),
);
ok(
  "the reveal span points at the 'Section Two' heading (numeric from > 0, to >= from)",
  !!targetReveal &&
    typeof targetReveal.from === "number" && typeof targetReveal.to === "number" &&
    targetReveal.from > 0 && targetReveal.to >= targetReveal.from,
  JSON.stringify(targetReveal),
);

console.log("— setActiveLeaf(leaf) does not throw —");
const setActiveThrew = await app(() => {
  try {
    const leaf = window.__compatWorkspace.getMostRecentLeaf();
    window.__compatWorkspace.setActiveLeaf(leaf);
    return null;
  } catch (e) { return String(e); }
});
ok("setActiveLeaf(getMostRecentLeaf()) does not throw", setActiveThrew === null, String(setActiveThrew));

console.log("— no page errors throughout —");
// tidy: drop the Store subscription we installed
await app(() => { if (window.__r175RevealUnsub) window.__r175RevealUnsub(); });
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR175 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
