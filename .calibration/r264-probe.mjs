/**
 * R264 Step-0 probe — what reportGap()s do the REAL loaded marquee plugins (Templater + Dataview)
 * actually hit? Each missing/degraded compat API warns once via console.warn "[obsidian-compat] ...
 * is not implemented". Loading both + exercising basic ops surfaces the non-speculative gap list →
 * the highest-value R264 target (a gap a real loaded plugin needs).
 * Run: node .calibration/r264-probe.mjs   (dev server up + templater/ + dataview/ bundles)
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const TP = join(__dir, "templater");
const DV = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(join(TP, "main.js")) || !existsSync(join(DV, "main.js"))) { console.log("need templater/ + dataview/ bundles"); process.exit(2); }

const plugins = [
  { dir: "templater-obsidian", manifestJson: readFileSync(join(TP, "manifest.json"), "utf8"), mainJs: readFileSync(join(TP, "main.js"), "utf8"), stylesCss: null, dataJson: null },
  { dir: "dataview", manifestJson: readFileSync(join(DV, "manifest.json"), "utf8"), mainJs: readFileSync(join(DV, "main.js"), "utf8"), stylesCss: null, dataJson: null },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const gaps = [];
const errors = [];
page.on("console", (m) => {
  const t = m.text();
  if (/\[obsidian-compat\].*(not implemented|degraded|is a stub)/i.test(t)) gaps.push(t.replace(/^\[obsidian-compat\]\s*/, ""));
  if (m.type() === "error") errors.push(t);
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.addInitScript(({ plugins }) => {
  window.__geodeObsidianPlugins = plugins;
  window.__geodeObsidianConfig = { "community-plugins.json": '["templater-obsidian","dataview"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { plugins });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => {
  const r = window.geode?.app?.obsidianLoadReport?.get?.() ?? [];
  return r.some((x) => x.id === "templater-obsidian") && r.some((x) => x.id === "dataview");
}, null, { timeout: 14000 });

// exercise basic ops to surface runtime gaps
await page.evaluate(async () => {
  const v = window.geode.app.vault;
  const mk = async (p, c) => { try { await v.create(p, c); } catch {} };
  await mk("r264-note.md", "---\nrating: 5\n---\n# Hi\n\n- [ ] task\n\nbody\n");
  await mk("r264-tpl.md", 'Year <% tp.date.now("YYYY") %>\n');
  await mk("r264-q.md", "# Q\n\n```dataview\nTABLE rating\n```\n");
  // open + preview the dataview query
  window.geode.app.workspace.openFile("r264-q.md");
  let t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
  await new Promise((r) => setTimeout(r, 700));
  // run a templater expansion
  window.geode.app.workspace.openFile("r264-tpl.md");
  t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "source");
  await new Promise((r) => setTimeout(r, 300));
  try { window.app.commands.executeCommandById("templater-obsidian:replace-in-file-templater"); } catch {}
});
await wait(1200);

const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).map((r) => ({ id: r.id, status: r.status })));
console.log("load report:", JSON.stringify(report));
console.log("\n=== GAPS hit by Templater + Dataview (real loaded plugins) ===");
const uniq = [...new Set(gaps)].sort();
if (uniq.length === 0) console.log("  (none — no reportGap warnings captured)");
for (const g of uniq) console.log("  • " + g);
console.log("\nuncaught errors:", errors.length, errors.slice(0, 3).join(" || "));
await browser.close();
