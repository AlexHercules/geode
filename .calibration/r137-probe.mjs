/**
 * R137 desktop probe — compat WorkspaceLeaf.setViewState mode switch on the real Tauri / WKWebView
 * binary. Run: node .calibration/r137-probe.mjs
 *
 * setViewState → setTabMode is a synchronous Store mutation (the same path Ctrl+E uses), so reading
 * the resulting tab mode is §D-safe (the mode-switch React re-render is App-Nap-throttled, but the
 * Store value is not). The probe (a .geode plugin gets the core handle `napp`) reaches the compat App
 * via window.app, drives activeLeaf.setViewState, and asserts napp.workspace.getActiveTab().mode
 * flipped. If window.app isn't present it falls back to "compat workspace loaded" (covered by E2E 11/11).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r137-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r137-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "n.md"), "# N\n\nbody\n");

const probe = `module.exports = {
  id: "r137-probe", name: "r137-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r137-results.md", b).catch(() => napp.vault.modify("r137-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(napp.workspace && window.app && window.app.workspace && window.app.workspace.activeLeaf);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("n.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      napp.workspace.openFile("n.md");
      const tab = napp.workspace.getActiveTab();
      if (tab) napp.workspace.setTabMode(tab.id, "live");
      rec("baseLive", napp.workspace.getActiveTab() && napp.workspace.getActiveTab().mode);
      await window.app.workspace.activeLeaf.setViewState({ type: "markdown", state: { mode: "preview" } });
      rec("afterPreview", napp.workspace.getActiveTab() && napp.workspace.getActiveTab().mode);
      await window.app.workspace.activeLeaf.setViewState({ type: "markdown", state: { mode: "source", source: false } });
      rec("afterLive", napp.workspace.getActiveTab() && napp.workspace.getActiveTab().mode);
      await window.app.workspace.activeLeaf.setViewState({ type: "markdown", state: { mode: "source" } });
      rec("afterSource", napp.workspace.getActiveTab() && napp.workspace.getActiveTab().mode);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r137-probe.js"), probe);
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

console.log("— compat WorkspaceLeaf.setViewState mode switch on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App + workspace.activeLeaf present (compat workspace.ts loads cleanly)", data.present === true);
if (data.present) {
  ok("setViewState mode:'preview' → tab.mode = preview", data.afterPreview === "preview", JSON.stringify(data.afterPreview));
  ok("setViewState mode:'source' source:false → tab.mode = live", data.afterLive === "live", JSON.stringify(data.afterLive));
  ok("setViewState mode:'source' → tab.mode = source", data.afterSource === "source", JSON.stringify(data.afterSource));
} else {
  console.log("  · window.app not present in this headless config → mode-switch covered by browser E2E 11/11");
}

console.log(`\nR137 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
