/**
 * R47 note MERGE E2E — browser mode vs dev :1420.
 * Run: node .calibration/r47-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 47 additions".
 *
 *  A. core (window.__geodeMerge.merge): append into target, rewrite [[source]]→[[target]],
 *     trash source; self-merge / missing = no-op.
 *  B. UI: editor:merge-file opens switcher in merge mode → pick target → merge;
 *     mergeTargetMode is consume-once (next switcher open behaves normally).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r47", name: "r47", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeMerge, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => app((x) => window.__app.vault.read(x).catch(() => null), p);
const exists = (p) => app((x) => window.__app.vault.fileExists(x), p);

// ── A. core merge ────────────────────────────────────────────────────────────
console.log("A. core merge (window.__geodeMerge.merge)");
await app(() => {
  window.__app.vault.create("MergeTarget.md", "# Target\nbodyTARGET\n").catch(() => {});
  window.__app.vault.create("MergeSource.md", "# Source\nbodySOURCE\n").catch(() => {});
  window.__app.vault.create("MergeRef.md", "see [[MergeSource]] here\n").catch(() => {});
});
await wait(200);
await app(() => window.__geodeMerge.merge("MergeSource.md", "MergeTarget.md"));
await wait(400);
const tgt = await read("MergeTarget.md");
ok("merge appends source body into target (no loss)", !!tgt && tgt.includes("bodyTARGET") && tgt.includes("bodySOURCE"), JSON.stringify(tgt));
ok("merge trashes the source (gone from vault)", !(await exists("MergeSource.md")));
const ref = await read("MergeRef.md");
ok("merge rewrites referrer [[MergeSource]] → [[MergeTarget]]", !!ref && ref.includes("[[MergeTarget]]") && !ref.includes("[[MergeSource]]"), JSON.stringify(ref));

// self-merge / missing = no-op
await app(() => window.__app.vault.create("Solo.md", "# Solo\n").catch(() => {}));
await wait(80);
await app(() => window.__geodeMerge.merge("Solo.md", "Solo.md"));
await wait(150);
ok("self-merge is a no-op (file untouched)", await exists("Solo.md"));
await app(() => window.__geodeMerge.merge("DoesNotExist.md", "Solo.md"));
await wait(150);
ok("merge with a missing source is a no-op", await exists("Solo.md"));

// ── B. UI flow (command → switcher merge mode → pick target) ──────────────────
console.log("B. UI flow (editor:merge-file → switcher → pick target)");
await app(() => {
  window.__app.vault.create("UiSource.md", "# UiSource\nuiSRC\n").catch(() => {});
  window.__app.vault.create("UiTarget.md", "# UiTarget\nuiTGT\n").catch(() => {});
});
await wait(150);
await app(() => window.__app.workspace.openFile("UiSource.md"));
await wait(120);
await app(() => window.__app.commands.execute("editor:merge-file"));
await wait(150);
ok("merge command opens the switcher", (await app(() => window.__app.workspace.state.get().modal)) === "switcher");
await page.fill("[data-testid=switcher-input]", "UiTarget");
await wait(250);
await page.locator("[data-testid=switcher-input]").press("Enter");
await wait(450);
ok("UI merge trashes the source", !(await exists("UiSource.md")));
const uiTgt = await read("UiTarget.md");
ok("UI merge appends into target", !!uiTgt && uiTgt.includes("uiTGT") && uiTgt.includes("uiSRC"), JSON.stringify(uiTgt));

// consume-once: a fresh switcher open behaves normally (no merge)
await app(() => window.__app.vault.create("AfterMerge.md", "# AfterMerge\n").catch(() => {}));
await wait(80);
await app(() => window.__app.workspace.openModal("switcher"));
await wait(120);
await page.fill("[data-testid=switcher-input]", "AfterMerge");
await wait(200);
await page.locator("[data-testid=switcher-input]").press("Enter");
await wait(200);
ok("mergeTargetMode is consume-once (normal switcher just opens, no merge)", (await app(() => window.__app.workspace.getActiveFile())) === "AfterMerge.md" && (await exists("UiTarget.md")) && (await exists("AfterMerge.md")));

// F3 (review, DATA SAFETY): merge captures the source's LIVE buffer (unsaved edits), not stale disk
console.log("C. review fixes (buffer read / leak guard)");
await app(() => { window.__app.vault.create("DirtySrc.md", "DISK content\n").catch(() => {}); window.__app.vault.create("DirtyTgt.md", "# Tgt\ntgtbody\n").catch(() => {}); });
await wait(150);
await app(() => window.__app.workspace.openFile("DirtySrc.md"));
await wait(150);
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ changes: { from: v.state.doc.length, insert: "\nUNSAVED_EDIT" } }); });
await wait(80);
await app(() => window.__geodeMerge.merge("DirtySrc.md", "DirtyTgt.md"));
await wait(450);
const dirtyMerged = await read("DirtyTgt.md");
ok("merge captures the source's UNSAVED buffer edits (no data loss)", !!dirtyMerged && dirtyMerged.includes("UNSAVED_EDIT"), JSON.stringify(dirtyMerged));

// F4 (review): merge-file is a no-op when the switcher is already open → no mergeTargetMode leak
await app(() => { window.__app.vault.create("LeakSrc.md", "# leaksrc\n").catch(() => {}); window.__app.vault.create("LeakVictim.md", "# victim\n").catch(() => {}); });
await wait(120);
await app(() => window.__app.workspace.openFile("LeakSrc.md"));
await wait(120);
await app(() => window.__app.workspace.openModal("switcher"));
await wait(120);
await app(() => window.__app.commands.execute("editor:merge-file")); // guarded no-op (switcher already open)
await wait(100);
await app(() => window.__app.workspace.closeModal());
await wait(100);
await app(() => window.__app.workspace.openModal("switcher")); // fresh open — must be normal mode
await wait(120);
await page.fill("[data-testid=switcher-input]", "LeakVictim");
await wait(180);
await page.locator("[data-testid=switcher-input]").press("Enter");
await wait(300);
ok("merge-file no-op while switcher open → no leak (LeakSrc not merged-away)", (await exists("LeakSrc.md")) && (await exists("LeakVictim.md")));

console.log(`\nR47 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
