/**
 * R261 — js-yaml-backed obsidian parseYaml/stringifyYaml + the Dataview load-and-render proof.
 * Part A (committed code): a real plugin reads obsidian.parseYaml/stringifyYaml on nested YAML
 * and round-trips — proves the js-yaml@^4 wrappers (the single authorized new runtime dep).
 * Part B (marquee 商业主轴 proof): the genuine, unmodified Dataview 0.5.70 (MIT) loads through the
 * real loader AND a ```dataview LIST query RENDERS the vault's notes — proving the compat layer
 * carries a heavyweight real plugin end to end. The fixes that unblocked it (Workspace.updateOptions
 * + the legacy CodeMirror-5 no-op stub) are committed; Dataview's 2.4M bundle is NOT committed
 * (too large) — fetch it to .calibration/dataview/ to run Part B (else it's skipped).
 *   curl -L -o .calibration/dataview/main.js https://github.com/blacksmithgu/obsidian-dataview/releases/download/0.5.70/main.js
 *   curl -L -o .calibration/dataview/manifest.json https://github.com/blacksmithgu/obsidian-dataview/releases/download/0.5.70/manifest.json
 * Run: node .calibration/r261-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 261 additions".
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DV_DIR = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Part A: parseYaml / stringifyYaml ----------
console.log("— Part A: obsidian.parseYaml / stringifyYaml (js-yaml-backed) —");
{
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => {
    const mainJs = [
      "const obs = require('obsidian');",
      "module.exports = class extends obs.Plugin {",
      "  onload() {",
      "    const out = {};",
      "    try {",
      "      const parsed = obs.parseYaml('a: 1\\nb:\\n  - x\\n  - y\\nc:\\n  d: hello\\ne: true');",
      "      out.scalar = parsed.a === 1;",
      "      out.list = Array.isArray(parsed.b) && parsed.b.length === 2 && parsed.b[0] === 'x';",
      "      out.nestedMap = parsed.c && parsed.c.d === 'hello';",
      "      out.bool = parsed.e === true;",
      "      const str = obs.stringifyYaml({ k: 'v', n: [1, 2] });",
      "      out.stringify = typeof str === 'string' && str.indexOf('k: v') !== -1 && str.indexOf('- 1') !== -1;",
      "      const rt = obs.parseYaml(obs.stringifyYaml({ x: { y: [true, 'z'] }, m: 5 }));",
      "      out.roundtrip = rt.x.y[0] === true && rt.x.y[1] === 'z' && rt.m === 5;",
      "      out.ok = true;",
      "    } catch (e) { out.ok = false; out.error = String(e); }",
      "    let el = document.querySelector('[data-testid=\"r261-yaml\"]');",
      "    if (!el) { el = document.createElement('div'); el.setAttribute('data-testid','r261-yaml'); document.body.appendChild(el); }",
      "    el.textContent = JSON.stringify(out);",
      "    window.__r261yaml = true;",
      "  }",
      "  onunload() {}",
      "};",
    ].join("\n");
    window.__geodeObsidianPlugins = [{ dir: "r261-yaml", manifestJson: JSON.stringify({ id: "r261-yaml", name: "R261 YAML", version: "1.0.0", minAppVersion: "0.0.1" }), mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["r261-yaml"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__r261yaml === true, null, { timeout: 8000 });
  const y = await page.evaluate(() => { const el = document.querySelector('[data-testid="r261-yaml"]'); try { return JSON.parse(el.textContent); } catch { return null; } });
  ok("parseYaml: scalar (a: 1 → 1)", y?.scalar === true, JSON.stringify(y));
  ok("parseYaml: block list (b → [x,y])", y?.list === true);
  ok("parseYaml: nested map (c.d → hello)", y?.nestedMap === true);
  ok("parseYaml: boolean (e → true)", y?.bool === true);
  ok("stringifyYaml: object → YAML text", y?.stringify === true);
  ok("parse∘stringify round-trip preserves nested structure", y?.roundtrip === true);
  ok("Part A: no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await page.close();
}

// ---------- Part B: Dataview loads + a LIST query renders ----------
if (!existsSync(join(DV_DIR, "main.js"))) {
  console.log("— Part B SKIPPED: Dataview bundle not at .calibration/dataview/ (see header to fetch) —");
} else {
  console.log("— Part B: real Dataview 0.5.70 loads + a ```dataview LIST query renders —");
  const mainJs = readFileSync(join(DV_DIR, "main.js"), "utf8");
  const manifestJson = readFileSync(join(DV_DIR, "manifest.json"), "utf8");
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(({ mainJs, manifestJson }) => {
    window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["dataview"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  }, { mainJs, manifestJson });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "dataview"), null, { timeout: 12000 });

  const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "dataview") ?? null);
  ok("Dataview onload completed — status=enabled (updateOptions + CM5 stub unblocked it)", report?.status === "enabled", JSON.stringify(report));
  ok("Dataview exposed its API (window.DataviewAPI set in onload)", (await page.evaluate(() => typeof window.DataviewAPI)) === "object");

  // render a ```dataview LIST in reading view
  await page.evaluate(async () => {
    try { await window.geode.app.vault.create("r261-q.md", "# Query\n\n```dataview\nLIST\n```\n"); } catch { /* exists */ }
    try { await window.geode.app.vault.create("r261-item.md", "content\n"); } catch { /* exists */ }
    window.geode.app.workspace.openFile("r261-q.md");
    const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "preview");
  });
  await page.waitForFunction(() => !!document.querySelector(".dataview.list-view-ul, .dataview-error, .block-language-dataview"), null, { timeout: 8000 }).catch(() => {});
  await wait(400);
  const render = await page.evaluate(() => {
    const dv = document.querySelector(".dataview.list-view-ul");
    return {
      rendered: !!dv,
      dvClass: dv ? dv.className : null,
      itemCount: dv ? dv.querySelectorAll("li").length : 0,
      stillRawCodeBlock: !!document.querySelector(".markdown-preview-view pre code.language-dataview, .markdown-reading-view pre code.language-dataview"),
    };
  });
  ok("```dataview LIST query RENDERED (.dataview.list-view-ul replaced the code block)", render.rendered === true, JSON.stringify(render));
  ok("the rendered list has real results (>0 <li> over the metadataCache index)", render.itemCount > 0, JSON.stringify(render));
  ok("the raw ```dataview code block was consumed (not shown verbatim)", render.stillRawCodeBlock === false);
  ok("Part B: no uncaught page errors (real Dataview ran clean)", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

console.log(`\nR261 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
