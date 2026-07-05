/**
 * R268 — a 4th real plugin (Tasks 8.2.2) loads + renders task queries in Geode (商业主轴 breadth:
 * a task-query engine + status commands — a new surface). Fix: `app.metadataTypeManager` shim —
 * Tasks reads getAllProperties() then setType(name,type) to register its OWN 22 TQ_* query-widget
 * property types (21 "checkbox" toggles + 1 "text"; NOT date properties — corrected per review),
 * backed by Geode's R22 property-type registry (.obsidian/types.json): getAllProperties projects it,
 * setType routes to the vetted `assign` write. Without it Tasks logged "Cannot read properties of
 * undefined (reading 'getAllProperties')" (caught, non-fatal). Part A tests the REAL during-load
 * registration path (a plugin's onload setType must PERSIST — R268 moves propertyTypes.init before
 * plugins so regVault is set first). Tasks (gitignored, fetch to .calibration/tasks/):
 *   curl -sL -o .calibration/tasks/main.js https://github.com/obsidian-tasks-group/obsidian-tasks/releases/latest/download/main.js
 *   curl -sL -o .calibration/tasks/manifest.json https://github.com/obsidian-tasks-group/obsidian-tasks/releases/latest/download/manifest.json
 * Run: node .calibration/r268-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 268 additions".
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const T = join(__dir, "tasks");
const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Part A: metadataTypeManager + the DURING-load registration path ----------
console.log("— Part A: a plugin's ONLOAD setType PERSISTS (init-before-plugins fix) —");
{
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => {
    // probe calls setType in ONLOAD — the REAL path Tasks uses. Pre-R268-fix this was dropped
    // (regVault null during plugin load, then init wiped regMap). R268 awaits init before plugins.
    const mainJs = [
      "const obs = require('obsidian');",
      "module.exports = class extends obs.Plugin {",
      "  onload() {",
      "    const mtm = this.app.metadataTypeManager; const out = {};",
      "    try {",
      "      out.hasGetAll = typeof mtm.getAllProperties === 'function';",
      "      out.before = mtm.getAllProperties();",            // getAllProperties readable in onload
      "      mtm.setType('TQ_show_tree', 'checkbox');",        // Tasks-like query-widget props
      "      mtm.setType('TQ_extra_instructions', 'text');",
      "      out.ok = true;",
      "    } catch (e) { out.err = String(e); }",
      "    window.__r268 = out; window.__r268ready = true;",
      "  }",
      "  onunload() {}",
      "};",
    ].join("\n");
    window.__geodeObsidianPlugins = [{ dir: "r268-probe", manifestJson: JSON.stringify({ id: "r268-probe", name: "R268 Probe", version: "1.0.0", minAppVersion: "0.0.1" }), mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["r268-probe"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__r268ready === true, null, { timeout: 8000 });
  await wait(700); // let the onload assigns (serialized after the pre-plugin init) + any reload-init settle
  const r = await page.evaluate(() => window.__r268);
  const after = await page.evaluate(() => window.app.metadataTypeManager.getAllProperties());
  ok("metadataTypeManager.getAllProperties is a function (readable in onload)", r?.hasGetAll === true, JSON.stringify(r));
  ok("onload setType did not throw (routes to vetted property-type assign)", r?.ok === true && !r?.err, JSON.stringify(r));
  // keys are lowercased (Obsidian-faithful); the ONLOAD-time assign must PERSIST past boot
  ok("ONLOAD setType('TQ_show_tree','checkbox') PERSISTED (R268 init-before-plugins fix)", after?.tq_show_tree?.type === "checkbox", JSON.stringify(after));
  ok("ONLOAD setType('TQ_extra_instructions','text') persisted", after?.tq_extra_instructions?.type === "text", JSON.stringify(after));
  ok("Part A: no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- Part B: real Tasks loads + query renders ----------
if (!existsSync(join(T, "main.js"))) {
  console.log("— Part B SKIPPED: Tasks bundle absent —");
} else {
  console.log("— Part B: real Tasks 8.2.2 loads + renders a ```tasks query —");
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.addInitScript(({ m, j }) => {
    window.__geodeObsidianPlugins = [{ dir: "obsidian-tasks-plugin", manifestJson: j, mainJs: m, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["obsidian-tasks-plugin"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  }, { m: readFileSync(join(T, "main.js"), "utf8"), j: readFileSync(join(T, "manifest.json"), "utf8") });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "obsidian-tasks-plugin"), null, { timeout: 13000 });
  const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "obsidian-tasks-plugin"));
  ok("Tasks 8.2.2 onload completed — status=enabled", report?.status === "enabled", JSON.stringify(report));
  const cmds = await page.evaluate(() => (window.app.commands.listCommands?.() ?? []).map((c) => c.id).filter((id) => /tasks-plugin/.test(id)));
  ok("Tasks registered its commands (toggle-done, edit-task, …)", cmds.includes("obsidian-tasks-plugin:toggle-done"), JSON.stringify(cmds.slice(0, 4)));

  const out = await page.evaluate(async () => {
    const v = window.geode.app.vault;
    const mk = async (p, c) => { try { await v.create(p, c); } catch {} };
    await mk("r268t1.md", "# N1\n\n- [ ] buy milk 📅 2026-07-01\n- [x] done thing\n");
    await mk("r268t2.md", "# N2\n\n- [ ] write report\n");
    await new Promise((r) => setTimeout(r, 1200));
    await mk("r268tq.md", "# Q\n\n```tasks\nnot done\n```\n");
    window.geode.app.workspace.openFile("r268tq.md");
    const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
    await new Promise((r) => setTimeout(r, 1200));
    const block = document.querySelector(".plugin-tasks-query-result, .block-language-tasks, ul.contains-task-list");
    return { rendered: !!block, items: block ? block.querySelectorAll("li").length : 0 };
  });
  ok("```tasks query RENDERED (.plugin-tasks-query-result)", out.rendered === true, JSON.stringify(out));
  ok("the query matched the open tasks (>0 <li>)", out.items > 0, JSON.stringify(out));
  ok("0 errors (metadataTypeManager fix — was 1 'getAllProperties' crash)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

console.log(`\nR268 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
