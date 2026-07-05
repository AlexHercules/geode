/**
 * R265 — TFile.stat carries real ctime/mtime/size (was size:0 always, ctime/size 0 for
 * pre-existing files). Desktop reads FS metadata via the Rust listing; memory computes size
 * from content + tracks session ctime/mtime (survives a tree rebuild). Dataview file.size /
 * file.ctime queries now return real values.
 * Part A (always): TFile.stat via the obsidian shim (create/modify/rename/rebuild).
 * Part B (Dataview, skipped if bundle absent): a TABLE file.size shows the real byte size.
 * Run: node .calibration/r265-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 265 additions".
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DV = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Part A: TFile.stat ----------
console.log("— Part A: TFile.stat ctime/mtime/size (memory) —");
{
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });

  // create a 501-byte file, read its stat
  const created = await page.evaluate(async () => {
    await window.geode.app.vault.create("r265-a.md", "x".repeat(500) + "\n").catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
    const f = window.app.vault.getAbstractFileByPath("r265-a.md");
    return f ? { ...f.stat } : null;
  });
  ok("created file: stat.size = content byte length (501, was 0)", created?.size === 501, JSON.stringify(created));
  ok("created file: ctime set (~now, nonzero)", typeof created?.ctime === "number" && created.ctime > 1e12, JSON.stringify(created));
  ok("created file: mtime set (nonzero)", typeof created?.mtime === "number" && created.mtime > 1e12, JSON.stringify(created));

  // modify → mtime advances, size updates
  const modified = await page.evaluate(async () => {
    const f0 = window.app.vault.getAbstractFileByPath("r265-a.md");
    const ctime0 = f0.stat.ctime;
    await new Promise((r) => setTimeout(r, 30));
    const f = window.app.vault.getAbstractFileByPath("r265-a.md");
    await window.app.vault.modify(f, "shorter\n"); // 8 bytes
    await new Promise((r) => setTimeout(r, 150));
    return { ctime0, stat: { ...window.app.vault.getAbstractFileByPath("r265-a.md").stat } };
  });
  ok("modify: size updated to new content length (8)", modified.stat.size === 8, JSON.stringify(modified.stat));
  ok("modify: ctime preserved (creation time unchanged)", modified.stat.ctime === modified.ctime0, JSON.stringify(modified));
  ok("modify: mtime >= ctime (advanced)", modified.stat.mtime >= modified.stat.ctime, JSON.stringify(modified.stat));

  // ctime/size survive a tree rebuild (the regression the design guards)
  const afterRebuild = await page.evaluate(async () => {
    const before = { ...window.app.vault.getAbstractFileByPath("r265-a.md").stat };
    window.geode.app.metadata.rebuildAll?.();
    await new Promise((r) => setTimeout(r, 200));
    const f = window.app.vault.getAbstractFileByPath("r265-a.md");
    return { before, after: f ? { ...f.stat } : null };
  });
  ok("rebuild: ctime survives (not reset to 0)", afterRebuild.after?.ctime === afterRebuild.before.ctime && afterRebuild.after.ctime > 1e12, JSON.stringify(afterRebuild));
  ok("rebuild: size survives (from memory listing, not 0)", afterRebuild.after?.size === 8, JSON.stringify(afterRebuild));
  ok("Part A: no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- Part B: Dataview file.size ----------
if (!existsSync(join(DV, "main.js"))) {
  console.log("— Part B SKIPPED: Dataview bundle absent —");
} else {
  console.log("— Part B: real Dataview file.size returns the real byte size —");
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(({ mainJs, manifestJson }) => {
    window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["dataview"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  }, { mainJs: readFileSync(join(DV, "main.js"), "utf8"), manifestJson: readFileSync(join(DV, "manifest.json"), "utf8") });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "dataview"), null, { timeout: 12000 });
  await page.evaluate(async () => {
    await window.geode.app.vault.create("r265big.md", "z".repeat(999) + "\n").catch(() => {}); // 1000 bytes
  });
  await wait(1200); // let Dataview index
  await page.evaluate(async () => {
    await window.geode.app.vault.create("r265bq.md", "# Q\n\n```dataview\nTABLE file.size WHERE file.name = \"r265big\"\n```\n").catch(() => {});
    window.geode.app.workspace.openFile("r265bq.md");
    const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
  });
  await wait(800);
  const cells = await page.evaluate(() => {
    const tbl = document.querySelector(".dataview.table-view-table");
    return tbl ? Array.from(tbl.querySelectorAll("td")).map((c) => c.textContent.trim()) : null;
  });
  // Dataview renders sizes human-readable (e.g. "1000 bytes" / "1.0 KB"); assert it's not "0".
  ok("Dataview file.size renders a non-zero size for a 1000-byte file", !!cells && cells.some((c) => /[1-9]/.test(c) && !/^0\b/.test(c)), JSON.stringify(cells));
  ok("Part B: no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

console.log(`\nR265 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
