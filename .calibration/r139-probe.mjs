/**
 * R139 desktop probe — compat files-menu data path on the real Tauri / WKWebView binary.
 * Run: node .calibration/r139-probe.mjs
 *
 * The Explorer menu UI is browser-E2E (r139-e2e 14/14); what IS §D-safe is the SYNCHRONOUS data
 * path: collectFilesMenu fires the 'files-menu' event + returns the plugin's items. The probe (a
 * .geode plugin reaches the compat App via window.app) registers a files-menu handler, calls
 * collectFilesMenu([m-a, m-b]), and asserts the handler got the TFile[] + the item came back.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r139-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r139-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};
const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });

const probe = `module.exports = {
  id: "r139-probe", name: "r139-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r139-results.md", b).catch(() => napp.vault.modify("r139-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(napp.vault && window.app && window.app.workspace && window.app._geode && window.app._geode.plugins);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("nonexistent.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      try { await napp.vault.create("m-a.md", "# a\\n"); } catch {}
      try { await napp.vault.create("m-b.md", "# b\\n"); } catch {}
      window.__fm = null;
      window.app.workspace.on("files-menu", (menu, files, source) => {
        window.__fm = { src: source, paths: files.map((f) => f.path) };
        menu.addItem((i) => i.setTitle("Bulk").setIcon("tag").onClick(() => {}));
      });
      const items = window.app._geode.plugins.collectFilesMenu({ paths: ["m-a.md", "m-b.md"], source: "file-explorer-context-menu" });
      rec("titles", items.map((i) => i.title));
      rec("fmPaths", window.__fm && window.__fm.paths);
      rec("fmSrc", window.__fm && window.__fm.src);
      const emptyRes = window.app._geode.plugins.collectFilesMenu({ paths: ["ghost.md"], source: "x" });
      rec("emptyLen", emptyRes.length);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r139-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 30000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=true")) break; }
  await new Promise((r) => setTimeout(r, 300));
}
try { process.kill(-child.pid); } catch { /* gone */ }
if (raw === null) { console.error("no result file produced — probe did not run"); process.exit(1); }

const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}

console.log("— compat files-menu data path on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App + plugins.collectFilesMenu present (files-menu bridge loads cleanly)", data.present === true);
ok("collectFilesMenu fires the event + returns the plugin item [Bulk]", eq(data.titles, ["Bulk"]), JSON.stringify(data.titles));
ok("the on('files-menu') handler received the TFile[] paths [m-a, m-b]", eq(data.fmPaths, ["m-a.md", "m-b.md"]), JSON.stringify(data.fmPaths));
ok("the handler received source = 'file-explorer-context-menu'", data.fmSrc === "file-explorer-context-menu", JSON.stringify(data.fmSrc));
ok("unresolvable paths → [] (no throw)", data.emptyLen === 0, JSON.stringify(data.emptyLen));

console.log(`\nR139 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
