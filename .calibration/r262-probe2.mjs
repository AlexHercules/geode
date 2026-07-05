/**
 * R262 Step-0 probe #2 — disambiguate the two candidate gaps:
 *  (A) Is dataviewjs "free" once the injected data.json enables it (faithful Dataview setting),
 *      or does JS execution need host work?
 *  (B) Does frontmatter stringification actually break TYPED queries (numeric WHERE/SORT)?
 *      `rating: 5` → "5" string would make `WHERE rating > 3` / `SORT rating DESC` misbehave.
 * Run: node .calibration/r262-probe2.mjs
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DV_DIR = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mainJs = readFileSync(join(DV_DIR, "main.js"), "utf8");
const manifestJson = readFileSync(join(DV_DIR, "manifest.json"), "utf8");
// inject data.json enabling JS queries (faithful: user toggles this in Dataview settings)
const dataJson = JSON.stringify({ enableDataviewJs: true, enableInlineDataviewJs: true, enableInlineDataviewJsQueries: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

await page.addInitScript(({ mainJs, manifestJson, dataJson }) => {
  window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson }];
  window.__geodeObsidianConfig = { "community-plugins.json": '["dataview"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { mainJs, manifestJson, dataJson });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "dataview"), null, { timeout: 12000 });
const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "dataview"));
console.log("Dataview load:", JSON.stringify(report));
// did the data.json arrive in the plugin settings?
const dvSettings = await page.evaluate(() => {
  const p = window.geode?.app?.plugins?.plugins?.dataview ?? window.app?.plugins?.plugins?.dataview;
  return p?.settings ? { enableDataviewJs: p.settings.enableDataviewJs, enableInlineDataviewJs: p.settings.enableInlineDataviewJs } : "no-settings";
});
console.log("Dataview settings (from data.json):", JSON.stringify(dvSettings));

await page.evaluate(async () => {
  const v = window.geode.app.vault;
  const mk = async (p, c) => { try { await v.create(p, c); } catch {} };
  await mk("r262-book-a.md", "---\ntitle: Alpha\nrating: 5\nauthor: Ann\n---\n\nbody alpha\n");
  await mk("r262-book-b.md", "---\ntitle: Beta\nrating: 3\nauthor: Bob\n---\n\nbody beta\n");
  await mk("r262-book-c.md", "---\ntitle: Gamma\nrating: 1\nauthor: Cy\n---\n\nbody gamma\n");
});

async function renderQuery(fname, lang, body) {
  const errBefore = pageErrors.length;
  await page.evaluate(async ({ fname, lang, body }) => {
    const v = window.geode.app.vault;
    try { await v.create(fname, "# Q\n\n```" + lang + "\n" + body + "\n```\n"); } catch {}
    window.geode.app.workspace.openFile(fname);
    const t = window.geode.app.workspace.getActiveTab();
    if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
  }, { fname, lang, body });
  await wait(900);
  const dom = await page.evaluate(() => {
    const err = document.querySelector(".dataview-error, .dataview-error-box");
    const table = document.querySelector(".dataview.table-view-table");
    const list = document.querySelector(".dataview.list-view-ul");
    // collect TABLE body rows' first two cells to inspect filter/sort
    let rows = [];
    if (table) {
      rows = Array.from(table.querySelectorAll("tbody tr, tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td,th")).map((c) => c.textContent.trim()).join(" | ")
      );
    }
    return {
      hasError: !!err, errText: err ? err.textContent.slice(0, 160) : null,
      table: !!table, list: !!list,
      listItems: list ? list.querySelectorAll("li").length : 0,
      rows,
    };
  });
  return { ...dom, newErrs: pageErrors.slice(errBefore).slice(0, 2) };
}

console.log("\n=== (A) dataviewjs with enableDataviewJs:true ===");
const js1 = await renderQuery("r262-js1.md", "dataviewjs", "dv.list([1,2,3])");
console.log("dv.list([1,2,3]):", js1.hasError ? "ERROR → " + js1.errText : (js1.list ? `renders ${js1.listItems} items` : "nothing"), js1.newErrs.join(" || "));
const js2 = await renderQuery("r262-js2.md", "dataviewjs", 'dv.table(["File","rating"], dv.pages(\'"r262-book-a" OR "r262-book-b" OR "r262-book-c"\').map(p => [p.file.name, p.rating]))');
console.log("dv.table(dv.pages...):", js2.hasError ? "ERROR → " + js2.errText : (js2.table ? `renders rows=${js2.rows.length}` : "nothing"), js2.newErrs.join(" || "));
console.log("  rows:", JSON.stringify(js2.rows));

console.log("\n=== (B) typed numeric WHERE / SORT (stringification test) ===");
const w = await renderQuery("r262-where.md", "dataview", 'TABLE rating FROM "r262-book-a" OR "r262-book-b" OR "r262-book-c" WHERE rating > 3');
console.log("WHERE rating > 3 (expect only Alpha=5):", w.hasError ? "ERROR" : `rows=${JSON.stringify(w.rows)}`);
const s = await renderQuery("r262-sort.md", "dataview", 'TABLE rating FROM "r262-book-a" OR "r262-book-b" OR "r262-book-c" SORT rating DESC');
console.log("SORT rating DESC (expect 5,3,1):", s.hasError ? "ERROR" : `rows=${JSON.stringify(s.rows)}`);

console.log("\nTotal pageErrors:", pageErrors.length, pageErrors.slice(0, 3).join(" || "));
await browser.close();
