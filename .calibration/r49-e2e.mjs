/**
 * R49 file recovery snapshots E2E — browser mode vs dev :1420.
 * Run: node .calibration/r49-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 49 additions".
 *
 *  A. core (window.__geodeSnapshots): record / list / restore (snapshots current first).
 *  B. save hook: a file:modified (save) auto-records a snapshot.
 *  C. UI: editor:file-recovery opens the modal → lists snapshots → restore writes back.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r49", name: "r49", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeSnapshots, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => app((x) => window.__app.vault.read(x).catch(() => null), p);

// ── A. core ──────────────────────────────────────────────────────────────────
console.log("A. core (window.__geodeSnapshots)");
await app(() => window.__app.vault.create("Snap.md", "CURRENT\n").catch(() => {}));
await wait(120);
await app(() => window.__geodeSnapshots.record("Snap.md", "OLD content", 1000));
await wait(150);
const list1 = await app(() => window.__geodeSnapshots.list("Snap.md"));
ok("record creates a snapshot", Array.isArray(list1) && list1.length === 1 && list1[0].content === "OLD content", JSON.stringify(list1));
const restored = await app(() => window.__geodeSnapshots.restore("Snap.md", 1000, 5000));
ok("restore returns true", restored === true);
await wait(180);
ok("restore writes the old content to the note", (await read("Snap.md")) === "OLD content", JSON.stringify(await read("Snap.md")));
const list2 = await app(() => window.__geodeSnapshots.list("Snap.md"));
// the pre-restore "CURRENT" must be captured (never lost). (The restore's own
// write also gets snapshotted by the save-hook here because the test uses an
// artificial ts that escapes the 60s throttle; in real usage Date.now() throttles it.)
ok("restore snapshotted the pre-restore current (never lost)", list2.some((s) => s.content.includes("CURRENT")), JSON.stringify(list2.map((s) => s.content)));

// ── B. save hook ─────────────────────────────────────────────────────────────
console.log("B. save hook (file:modified auto-records)");
await app(() => window.__app.vault.create("Hook.md", "v0\n").catch(() => {}));
await wait(120);
await app(() => window.__app.vault.modify("Hook.md", "v1 edited\n"));
await wait(350);
const hookList = await app(() => window.__geodeSnapshots.list("Hook.md"));
ok("a save (file:modified) auto-records a snapshot", hookList.length >= 1 && hookList.some((s) => s.content.includes("v1 edited")), JSON.stringify(hookList));

// F1 (review, DATA SAFETY): the WRITE path refuses to overwrite a malformed file
const corruptKey = "snapshots/" + encodeURIComponent("Corrupt.md") + ".json";
await app(() => window.__app.vault.create("Corrupt.md", "c\n").catch(() => {}));
await wait(80);
await app(() => window.__geodeSnapshots.record("Corrupt.md", "v1", 1000));
await wait(120);
await app(([k]) => window.__app.vault.adapter.writeConfig(k, "{ broken json"), [corruptKey]);
await wait(80);
await app(() => window.__geodeSnapshots.record("Corrupt.md", "v2", 2000)); // force=true → hits strict parse
await wait(180);
ok("record refuses to overwrite a malformed snapshot file (history preserved)", (await app(([k]) => window.__app.vault.adapter.readConfig(k), [corruptKey])) === "{ broken json", JSON.stringify(await app(([k]) => window.__app.vault.adapter.readConfig(k), [corruptKey])));

// F7 (review, DATA SAFETY): restore FLUSHES the dirty editor → unsaved edits are snapshotted, restore sticks
await app(() => window.__app.vault.create("DirtyR.md", "disk content\n").catch(() => {}));
await wait(80);
await app(() => window.__geodeSnapshots.record("DirtyR.md", "OLD version", 1000));
await wait(120);
await app(() => window.__app.workspace.openFile("DirtyR.md"));
await wait(150);
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ changes: { from: v.state.doc.length, insert: "\nUNSAVED_EDIT" } }); });
await wait(80);
await app(() => window.__geodeSnapshots.restore("DirtyR.md", 1000, 9000));
await wait(350);
ok("restore wrote the old version (over the dirty buffer)", (await read("DirtyR.md")) === "OLD version", JSON.stringify(await read("DirtyR.md")));
const dirtyList = await app(() => window.__geodeSnapshots.list("DirtyR.md"));
ok("restore flushed + snapshotted the UNSAVED buffer edits (no loss)", dirtyList.some((s) => s.content.includes("UNSAVED_EDIT")), JSON.stringify(dirtyList.map((s) => s.content)));

// ── C. UI (recovery modal) ───────────────────────────────────────────────────
console.log("C. UI (editor:file-recovery modal)");
await app(() => window.__app.vault.create("UiSnap.md", "ui current\n").catch(() => {}));
await wait(120);
await app(() => { window.__geodeSnapshots.record("UiSnap.md", "ui v1", 1000); });
await wait(120);
await app(() => { window.__geodeSnapshots.record("UiSnap.md", "ui v2", 2000); });
await wait(180);
await app(() => window.__app.workspace.openFile("UiSnap.md"));
await wait(150);
await app(() => window.__app.commands.execute("editor:file-recovery"));
await page.waitForSelector("[data-testid=recovery-modal]", { timeout: 4000 });
await wait(200);
ok("recovery modal opens for the active file", (await app(() => window.__app.workspace.state.get().modal)) === "recovery");
ok("recovery modal lists the snapshots", (await app(() => document.querySelectorAll("[data-testid=recovery-item]").length)) >= 2, String(await app(() => document.querySelectorAll("[data-testid=recovery-item]").length)));
// select the oldest (ui v1) — separate ticks so React commits sel before restore
const selected = await app(() => {
  const v1 = [...document.querySelectorAll("[data-testid=recovery-item]")].find((el) => el.getAttribute("data-ts") === "1000");
  if (!v1) return false;
  v1.click();
  return true;
});
ok("selected the v1 snapshot row", selected);
await wait(150);
await app(() => {
  const v1 = [...document.querySelectorAll("[data-testid=recovery-item]")].find((el) => el.getAttribute("data-ts") === "1000");
  const btn = (v1 && v1.querySelector("[data-testid=recovery-restore]")) || document.querySelector("[data-testid=recovery-restore]");
  btn?.click();
});
await wait(300);
ok("restore from the modal writes the snapshot content back", (await read("UiSnap.md")) === "ui v1", JSON.stringify(await read("UiSnap.md")));

console.log(`\nR49 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
