/**
 * R262 Step-0 probe — find which Dataview query types / APIs render vs crash in Geode TODAY.
 * R261 proved LIST renders. This maps the deep-use surface: TABLE / TASK / dataviewjs / inline
 * field parsing / inline `= expr` queries — so R262 can pick the highest-value 崩哪补哪 slice.
 * Needs dev server (:1420) + Dataview bundle at .calibration/dataview/ (see r261-e2e header).
 * Run: node .calibration/r262-probe.mjs
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DV_DIR = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(DV_DIR, "main.js"))) {
  console.log("Dataview bundle missing at .calibration/dataview/ — cannot probe.");
  process.exit(2);
}
const mainJs = readFileSync(join(DV_DIR, "main.js"), "utf8");
const manifestJson = readFileSync(join(DV_DIR, "manifest.json"), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

await page.addInitScript(({ mainJs, manifestJson }) => {
  window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = { "community-plugins.json": '["dataview"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { mainJs, manifestJson });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "dataview"), null, { timeout: 12000 });
const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "dataview") ?? null);
console.log("Dataview load:", JSON.stringify(report));

// seed data notes (frontmatter + inline fields + tasks)
await page.evaluate(async () => {
  const v = window.geode.app.vault;
  const mk = async (p, c) => { try { await v.create(p, c); } catch { /* exists */ } };
  await mk("r262-book-a.md", "---\ntitle: Alpha\nrating: 5\nauthor: Ann\n---\n\nbody alpha\n\nkey:: inlineA\n- [ ] task one A\n- [x] done A\n");
  await mk("r262-book-b.md", "---\ntitle: Beta\nrating: 3\nauthor: Bob\n---\n\nbody beta\n\nkey:: inlineB\n- [ ] task one B\n");
});

const QUERIES = [
  { name: "LIST", lang: "dataview", body: "LIST" },
  { name: "TABLE", lang: "dataview", body: 'TABLE rating, author FROM "r262-book-a" OR "r262-book-b"' },
  { name: "TASK", lang: "dataview", body: "TASK" },
  { name: "TABLE-where-inline", lang: "dataview", body: "TABLE key WHERE key" },
  { name: "dataviewjs", lang: "dataviewjs", body: "dv.list([1,2,3])" },
  { name: "dataviewjs-pages", lang: "dataviewjs", body: 'dv.table(["F","rating"], dv.pages().map(p => [p.file.name, p.rating]))' },
];

const results = [];
for (let i = 0; i < QUERIES.length; i++) {
  const q = QUERIES[i];
  const fname = `r262-q${i}.md`;
  const errBefore = pageErrors.length;
  await page.evaluate(async ({ fname, lang, body }) => {
    const v = window.geode.app.vault;
    try { await v.create(fname, "# Q\n\n```" + lang + "\n" + body + "\n```\n"); } catch { /* exists */ }
    window.geode.app.workspace.openFile(fname);
    const t = window.geode.app.workspace.getActiveTab();
    if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
  }, { fname, lang: q.lang, body: q.body });
  await wait(900);
  const dom = await page.evaluate(() => {
    const host = document.querySelector(".block-language-dataview, .block-language-dataviewjs");
    const err = document.querySelector(".dataview-error, .dataview.dataview-error-box, .dataview-error-box");
    const table = document.querySelector(".dataview.table-view-table");
    const list = document.querySelector(".dataview.list-view-ul");
    const taskl = document.querySelector(".dataview .contains-task-list, .dataview.task-view-ul, ul.contains-task-list");
    return {
      hostFound: !!host,
      hostHtml: host ? host.outerHTML.slice(0, 240) : null,
      hasError: !!err,
      errText: err ? err.textContent.slice(0, 160) : null,
      table: !!table, list: !!list, tasks: !!taskl,
      tableRows: table ? table.querySelectorAll("tr").length : 0,
      listItems: list ? list.querySelectorAll("li").length : 0,
    };
  });
  const newErrs = pageErrors.slice(errBefore);
  results.push({ q: q.name, ...dom, newErrs: newErrs.slice(0, 3) });
  console.log(`\n[${q.name}] (${q.lang})`);
  console.log("  host:", dom.hostFound, "| table:", dom.table, "rows", dom.tableRows, "| list:", dom.list, "items", dom.listItems, "| tasks:", dom.tasks);
  console.log("  error:", dom.hasError, dom.errText ? "→ " + dom.errText : "");
  if (newErrs.length) console.log("  pageErrors:", newErrs.slice(0, 2).join(" || "));
  if (dom.hostHtml) console.log("  html:", dom.hostHtml.replace(/\n/g, " "));
}

// inline query `= this.file.name`
await page.evaluate(async () => {
  const v = window.geode.app.vault;
  try { await v.create("r262-inline.md", "# Inline\n\nName is `= this.file.name` end.\n"); } catch {}
  window.geode.app.workspace.openFile("r262-inline.md");
  const t = window.geode.app.workspace.getActiveTab();
  if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
});
await wait(700);
const inlineDom = await page.evaluate(() => {
  const span = document.querySelector(".dataview-inline-query, span.dataview.dataview-inline-query, .dataview-result-inline");
  const stillCode = !!document.querySelector(".markdown-preview-view code, .markdown-reading-view code");
  return { inlineRendered: !!span, inlineText: span ? span.textContent : null, stillCode };
});
console.log("\n[inline `= this.file.name`]");
console.log("  rendered:", inlineDom.inlineRendered, "text:", inlineDom.inlineText, "| stillRawCode:", inlineDom.stillCode);

console.log("\n=== SUMMARY ===");
for (const r of results) {
  const verdict = r.hasError ? "ERROR" : (r.table || r.list || r.tasks || r.hostFound) ? "renders" : "NOTHING";
  console.log(`  ${r.q.padEnd(20)} ${verdict}${r.hasError ? " :: " + (r.errText || "") : ""}`);
}
console.log(`  inline-query          ${inlineDom.inlineRendered ? "renders" : "NOTHING/raw"}`);
console.log("\nTotal pageErrors:", pageErrors.length);
await browser.close();
