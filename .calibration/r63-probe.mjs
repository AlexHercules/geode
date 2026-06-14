/**
 * R63 desktop probe — verifies the multi-cursor STATE foundation on the REAL
 * Tauri/WKWebView build via __geodeMultiSel (deterministic, App-Nap-safe — pure
 * EditorState, no live view / async). With EditorState.allowMultipleSelections a
 * 2-range selection is held (count=2); without it CM collapses to the main range
 * (count=1). The view rendering (drawSelection drawing every caret) is a DOM
 * behavior exercised by the browser E2E on the identical CM editor.
 *
 * Run: node .calibration/r63-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 63 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r63-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r63-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# Seed\n");

const probe = `module.exports = {
  id: "r63-probe", name: "r63-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r63-results.md", b).catch(() => app.vault.modify("r63-results.md", b).catch(() => {})); };
    try {
      const M = (globalThis).__geodeMultiSel;
      rec("present", typeof M?.held === "function");
      rec("withFacet", M.held(true));
      rec("withoutFacet", M.held(false));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r63-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=")) break; }
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
const J = (v) => JSON.stringify(v);

console.log("— multi-cursor state foundation on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeMultiSel present", data.present === true);
ok("allowMultipleSelections holds a 2-range selection (count=2)", data.withFacet === 2, J(data.withFacet));
ok("without the facet CM collapses to 1 range (control)", data.withoutFacet === 1, J(data.withoutFacet));

console.log(`\nR63 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
