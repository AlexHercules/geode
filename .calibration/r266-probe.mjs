/**
 * R266 Step-0 deep probe — exercise DEEPER Dataview/Templater features to surface higher-value
 * crashes/gaps than the basic R264 probe. Dataview: TASK, GROUP BY, dataviewjs (enabled via
 * data.json), inline `= expr` in reading view. Templater: tp.file.creation_date (uses TFile.stat,
 * fixed R265), tp.frontmatter, tp.file.tags. Captures [obsidian-compat] gaps + uncaught errors +
 * rendered/error state per feature.
 * Run: node .calibration/r266-probe.mjs   (dev up + templater/ + dataview/ bundles)
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const TP = join(__dir, "templater"), DV = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(join(DV, "main.js")) || !existsSync(join(TP, "main.js"))) { console.log("need bundles"); process.exit(2); }

const browser = await chromium.launch();
const page = await browser.newPage();
const gaps = [], errors = [];
page.on("console", (m) => { const t = m.text(); if (/\[obsidian-compat\].*(not implemented|degraded|stub)/i.test(t)) gaps.push(t.replace(/^.*\[obsidian-compat\]\s*/, "")); if (m.type() === "error") errors.push(t.slice(0, 100)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));

await page.addInitScript(({ tp, dv, tpm, dvm }) => {
  window.__geodeObsidianPlugins = [
    { dir: "dataview", manifestJson: dvm, mainJs: dv, stylesCss: null, dataJson: null },
    { dir: "templater-obsidian", manifestJson: tpm, mainJs: tp, stylesCss: null, dataJson: null },
  ];
  window.__geodeObsidianConfig = {
    "community-plugins.json": '["dataview","templater-obsidian"]',
    "plugins/dataview/data.json": JSON.stringify({ enableDataviewJs: true, enableInlineDataviewJs: true }),
  };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { tp: readFileSync(join(TP, "main.js"), "utf8"), dv: readFileSync(join(DV, "main.js"), "utf8"), tpm: readFileSync(join(TP, "manifest.json"), "utf8"), dvm: readFileSync(join(DV, "manifest.json"), "utf8") });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => { const r = window.geode?.app?.obsidianLoadReport?.get?.() ?? []; return r.some((x) => x.id === "dataview") && r.some((x) => x.id === "templater-obsidian"); }, null, { timeout: 14000 });

await page.evaluate(async () => {
  const v = window.geode.app.vault;
  const mk = async (p, c) => { try { await v.create(p, c); } catch {} };
  await mk("data1.md", "---\nstatus: done\nrating: 5\n---\n# Note 1\n\n- [ ] task A\n- [x] task B done\n\n#tagx body\n");
  await mk("data2.md", "---\nstatus: todo\nrating: 2\n---\n# Note 2\n\n- [ ] task C\n");
});
await wait(1300); // index

async function render(fname, content, mode = "preview") {
  const errBefore = errors.length;
  await page.evaluate(async ({ fname, content, mode }) => {
    const v = window.geode.app.vault;
    try { await v.create(fname, content); } catch {}
    window.geode.app.workspace.openFile(fname);
    const t = window.geode.app.workspace.getActiveTab();
    if (t) window.geode.app.workspace.setTabMode(t.id, mode);
  }, { fname, content, mode });
  await wait(900);
  const dom = await page.evaluate(() => {
    const err = document.querySelector(".dataview-error, .dataview-error-box");
    const dvAny = document.querySelector(".dataview");
    return { err: !!err, errText: err ? err.textContent.slice(0, 120) : null, rendered: !!dvAny, dvClass: dvAny ? dvAny.className.slice(0, 50) : null };
  });
  return { ...dom, newErrs: errors.slice(errBefore).slice(0, 2) };
}

const cases = [
  ["q-task.md", "# Q\n\n```dataview\nTASK\n```\n", "preview", "Dataview TASK"],
  ["q-group.md", '# Q\n\n```dataview\nTABLE rows.rating FROM "data1" OR "data2" GROUP BY status\n```\n', "preview", "Dataview GROUP BY"],
  ["q-djs.md", "# Q\n\n```dataviewjs\ndv.list(dv.pages().map(p => p.file.name))\n```\n", "preview", "dataviewjs dv.list(pages)"],
  ["q-inline.md", "Name: `= this.file.name` and link `= this.file.link`\n", "preview", "Dataview inline (reading view)"],
  ["q-tpl.md", "Created <% tp.file.creation_date() %> tags <% tp.file.tags %>\n", "source", "Templater tp.file.creation_date/tags"],
];
console.log("\n=== deep feature probe ===");
for (const [f, c, mode, label] of cases) {
  const r = await render(f, c, mode);
  console.log(`[${label}] ${r.err ? "ERROR → " + r.errText : r.rendered ? "rendered (" + r.dvClass + ")" : "no-dataview-el"}${r.newErrs.length ? " | errs: " + r.newErrs.join(" || ") : ""}`);
}
// Templater expansion check (run replace command on q-tpl)
const tpl = await page.evaluate(async () => {
  window.geode.app.workspace.openFile("q-tpl.md");
  const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "source");
  await new Promise((r) => setTimeout(r, 300));
  try { window.app.commands.executeCommandById("templater-obsidian:replace-in-file-templater"); } catch {}
  await new Promise((r) => setTimeout(r, 700));
  return window.geode.app.vault.read("q-tpl.md").catch(() => "<err>");
});
console.log("\ntp.file.creation_date expansion:", JSON.stringify(tpl));

console.log("\n=== GAPS ===");
[...new Set(gaps)].forEach((g) => console.log("  • " + g));
console.log("\nuncaught errors:", errors.length, errors.slice(0, 4).join(" || "));
await browser.close();
