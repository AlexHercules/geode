/**
 * R123 desktop probe — verifies the compat MarkdownView.setViewData SURFACE loads on the real Tauri /
 * WKWebView binary + the makeActiveMarkdownView null-guard. The full setViewData write semantics need
 * a focused/mounted editor, which a headless WKWebView won't provide (App-Nap throttles the React
 * mount → getActiveView stays null, R115/R116/R117); those are covered by the browser E2E (7/7) over
 * the platform-identical code. Run: node .calibration/r123-probe.mjs   (needs the release binary)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r123-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r123-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "sv.md"), "# seed\n");

const probe = `module.exports = {
  id: "r123-probe", name: "r123-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r123-results.md", b).catch(() => napp.vault.modify("r123-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.workspace);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("sv.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      // no active editor yet → the active MarkdownView is null (makeActiveMarkdownView null-guard,
      // platform-independent); setViewData write semantics are browser-E2E only (§D)
      rec("nullWhenNoEditor", window.app.workspace.activeLeaf.view === null);
      // if an editor happens to be active, confirm setViewData is wired
      const mv = window.app.workspace.activeLeaf.view;
      rec("setViewDataWired", mv ? typeof mv.setViewData === "function" : "no-editor");
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r123-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 25000;
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

console.log("— compat MarkdownView.setViewData surface on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App.workspace present", data.present === true);
ok("no active editor → active MarkdownView is null (makeActiveMarkdownView null-guard)", data.nullWhenNoEditor === true);
if (data.setViewDataWired === "no-editor") {
  console.log("  · no editor mounted headless (App-Nap, R115/§D) — setViewData write semantics covered by browser E2E 7/7");
} else {
  ok("setViewData is wired on a mounted MarkdownView", data.setViewDataWired === true);
}

console.log(`\nR123 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
