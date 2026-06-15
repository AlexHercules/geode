/**
 * R83 desktop probe — verifies the tags-chip-click target mechanism on the REAL
 * Tauri / WKWebView build: `workspace.requestSearch("#tag")` synchronously seeds
 * the search-request store and switches the left panel to "search". The chip DOM
 * + keyboard navigation are browser-E2E only (r83-e2e, §D). Run: node .calibration/r83-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r83-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r83-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "n.md"), "---\ntags:\n  - probe\n---\n# n\n");

const probe = `module.exports = {
  id: "r83-probe", name: "r83-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r83-results.md", b).catch(() => app.vault.modify("r83-results.md", b).catch(() => {})); };
    try {
      // call the exact mechanism the tags-chip onClick uses, then read the
      // freshly-set values SYNCHRONOUSLY (before SearchPanel's effect consumes them).
      app.workspace.requestSearch("#probe");
      rec("seeded", app.workspace.searchRequest.get());
      rec("leftPanel", app.workspace.state.get().leftPanel);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r83-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
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

console.log("— requestSearch wiring on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("requestSearch seeds the search store with #probe", data.seeded === "#probe", JSON.stringify(data.seeded));
ok("requestSearch switches the left panel to search", data.leftPanel === "search", JSON.stringify(data.leftPanel));

console.log(`\nR83 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
