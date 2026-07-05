/**
 * R263 Step-0 probe — does dataviewjs JS execution actually work once enableDataviewJs is
 * honored? R262 showed the per-plugin injected dataJson field isn't wired to loadData() in the
 * browser; but __geodeObsidianConfig DOES seed the config store readConfig reads. So seed
 * plugins/dataview/data.json with {enableDataviewJs:true} (faithful: real desktop users bring
 * this) and see if dv.list / dv.table / dv.pages render — or whether enabling reveals more 崩.
 * Run: node .calibration/r263-probe.mjs   (dev server up + Dataview bundle at .calibration/dataview/)
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DV_DIR = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(join(DV_DIR, "main.js"))) { console.log("Dataview bundle missing — abort."); process.exit(2); }

const mainJs = readFileSync(join(DV_DIR, "main.js"), "utf8");
const manifestJson = readFileSync(join(DV_DIR, "manifest.json"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

await page.addInitScript(({ mainJs, manifestJson }) => {
  window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = {
    "community-plugins.json": '["dataview"]',
    // seed the config store that loadData()→readConfig reads (faithful desktop data.json)
    "plugins/dataview/data.json": JSON.stringify({ enableDataviewJs: true, enableInlineDataviewJs: true, enableInlineDataviewJsQueries: true }),
  };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { mainJs, manifestJson });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "dataview"), null, { timeout: 12000 });
const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "dataview"));
console.log("Dataview load:", JSON.stringify(report));
const settings = await page.evaluate(() => {
  const p = window.app?.plugins?.plugins?.dataview ?? window.geode?.app?.plugins?.plugins?.dataview;
  return p?.settings ? { enableDataviewJs: p.settings.enableDataviewJs, enableInlineDataviewJs: p.settings.enableInlineDataviewJs } : "no-settings(" + typeof p + ")";
});
console.log("Dataview settings now:", JSON.stringify(settings));

await page.evaluate(async () => {
  const v = window.geode.app.vault;
  const mk = async (p, c) => { try { await v.create(p, c); } catch {} };
  await mk("r263-a.md", "---\nrating: 5\n---\nalpha\n");
  await mk("r263-b.md", "---\nrating: 3\n---\nbeta\n");
});
await wait(1200);

async function render(fname, lang, body) {
  const errBefore = pageErrors.length;
  await page.evaluate(async ({ fname, lang, body }) => {
    const v = window.geode.app.vault;
    try { await v.create(fname, "# Q\n\n```" + lang + "\n" + body + "\n```\n"); } catch {}
    window.geode.app.workspace.openFile(fname);
    const t = window.geode.app.workspace.getActiveTab();
    if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
  }, { fname, lang, body });
  await wait(1000);
  const dom = await page.evaluate(() => {
    const err = document.querySelector(".dataview-error, .dataview-error-box");
    const list = document.querySelector(".dataview.list-view-ul");
    const table = document.querySelector(".dataview.table-view-table");
    const host = document.querySelector(".block-language-dataviewjs, .block-language-dataview");
    return {
      err: !!err, errText: err ? err.textContent.slice(0, 180) : null,
      list: !!list, listItems: list ? list.querySelectorAll("li").length : 0,
      table: !!table, tableRows: table ? table.querySelectorAll("tr").length : 0,
      hostHtml: host ? host.outerHTML.slice(0, 200).replace(/\n/g, " ") : null,
    };
  });
  return { ...dom, newErrs: pageErrors.slice(errBefore).slice(0, 2) };
}

console.log("\n=== dataviewjs execution (enableDataviewJs honored?) ===");
const a = await render("r263-js1.md", "dataviewjs", "dv.list([1, 2, 3])");
console.log("dv.list([1,2,3]):", a.err ? "ERROR → " + a.errText : (a.list ? `renders ${a.listItems} items` : "nothing"), a.newErrs.join(" || "));
const b = await render("r263-js2.md", "dataviewjs", 'dv.table(["File", "rating"], dv.pages(\'"r263-a" OR "r263-b"\').map(p => [p.file.name, p.rating]))');
console.log("dv.table(dv.pages...):", b.err ? "ERROR → " + b.errText : (b.table ? `renders rows=${b.tableRows}` : "nothing"), b.newErrs.join(" || "));
if (b.hostHtml) console.log("  html:", b.hostHtml);
const c = await render("r263-js3.md", "dataviewjs", 'for (let p of dv.pages()) { dv.paragraph(p.file.name) }');
console.log("dv loop+paragraph:", c.err ? "ERROR → " + c.errText : (c.hostHtml ? "renders" : "nothing"), c.newErrs.join(" || "));

console.log("\nTotal pageErrors:", pageErrors.length, pageErrors.slice(0, 3).join(" || "));
await browser.close();
