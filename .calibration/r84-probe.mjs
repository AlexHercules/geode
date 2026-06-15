/**
 * R84 desktop probe — verifies applyGraphFilters + parseGraphPrefs filters on the
 * REAL Tauri / WKWebView build via window.__geodeGraphFilter / __geodeGraphPrefs
 * (synchronous, App-Nap-safe). The settings-panel DOM + canvas are browser-E2E
 * only (r84-e2e, §D). Run: node .calibration/r84-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r84-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r84-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "n.md"), "# n\n");

const probe = `module.exports = {
  id: "r84-probe", name: "r84-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r84-results.md", b).catch(() => app.vault.modify("r84-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeGraphFilter, P = (globalThis).__geodeGraphPrefs;
      rec("present", typeof F === "function" && typeof P === "function");
      const nodes = [{id:"a",resolved:true},{id:"b",resolved:true},{id:"c",resolved:true},{id:"unresolved:G",resolved:false}];
      const edges = [{source:"a",target:"b"},{source:"a",target:"unresolved:G"}];
      rec("all", F(nodes, edges, { orphans: true, existingOnly: false }));
      rec("existing", F(nodes, edges, { orphans: true, existingOnly: true }));
      rec("noOrphans", F(nodes, edges, { orphans: false, existingOnly: false }));
      rec("both", F(nodes, edges, { orphans: false, existingOnly: true }));
      const old = P('{"mode":"local"}');
      rec("compatOrphans", old.filters.orphans);
      rec("compatExisting", old.filters.existingOnly);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r84-probe.js"), probe);
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
const eq = (v, exp) => JSON.stringify(v) === JSON.stringify(exp);

console.log("— applyGraphFilters + parseGraphPrefs on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hooks present", data.present === true);
ok("default keeps all 4", eq(data.all, ["a", "b", "c", "unresolved:G"]), JSON.stringify(data.all));
ok("existingOnly drops unresolved", eq(data.existing, ["a", "b", "c"]), JSON.stringify(data.existing));
ok("orphans off drops degree-0 c", eq(data.noOrphans, ["a", "b", "unresolved:G"]), JSON.stringify(data.noOrphans));
ok("both → a,b", eq(data.both, ["a", "b"]), JSON.stringify(data.both));
ok("old blob → orphans default true", data.compatOrphans === true, JSON.stringify(data.compatOrphans));
ok("old blob → existingOnly default false", data.compatExisting === false, JSON.stringify(data.compatExisting));

console.log(`\nR84 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
