/**
 * R80 desktop probe — verifies sortResults on the REAL Tauri / WKWebView build
 * via window.__geodeSearchSort (synchronous, App-Nap-safe). The toolbar DOM is
 * browser-E2E only (r80-e2e). Run: node .calibration/r80-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r80-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r80-results.md");

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
  id: "r80-probe", name: "r80-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r80-results.md", b).catch(() => app.vault.modify("r80-results.md", b).catch(() => {})); };
    try {
      const S = (globalThis).__geodeSearchSort;
      rec("present", typeof S === "function");
      const items = [
        { basename: "ant", nameMatch: false, total: 1 },
        { basename: "bee", nameMatch: false, total: 3 },
        { basename: "cat", nameMatch: true, total: 2 },
      ];
      rec("name_asc", S(items, "name-asc"));
      rec("name_desc", S(items, "name-desc"));
      rec("count_desc", S(items, "count-desc"));
      rec("count_asc", S(items, "count-asc"));
      rec("relevance", S(items, "relevance"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r80-probe.js"), probe);
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

console.log("— sortResults on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeSearchSort present", data.present === true);
ok("name-asc → ant,bee,cat", eq(data.name_asc, ["ant", "bee", "cat"]), JSON.stringify(data.name_asc));
ok("name-desc → cat,bee,ant", eq(data.name_desc, ["cat", "bee", "ant"]), JSON.stringify(data.name_desc));
ok("count-desc → bee,cat,ant", eq(data.count_desc, ["bee", "cat", "ant"]), JSON.stringify(data.count_desc));
ok("count-asc → ant,cat,bee", eq(data.count_asc, ["ant", "cat", "bee"]), JSON.stringify(data.count_asc));
ok("relevance (cat nameMatch first) → cat,bee,ant", eq(data.relevance, ["cat", "bee", "ant"]), JSON.stringify(data.relevance));

console.log(`\nR80 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
