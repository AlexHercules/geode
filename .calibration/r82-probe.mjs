/**
 * R82 desktop probe — verifies sortAndFilterLinks on the REAL Tauri / WKWebView
 * build via window.__geodeLinkSortFilter (synchronous, App-Nap-safe). The panel
 * toolbars' DOM is browser-E2E only (r82-e2e). Run: node .calibration/r82-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r82-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r82-results.md");

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
  id: "r82-probe", name: "r82-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r82-results.md", b).catch(() => app.vault.modify("r82-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeLinkSortFilter;
      rec("present", typeof F === "function");
      const rows = [{ name: "Charlie" }, { name: "alpha" }, { name: "Bravo" }];
      rec("default", F(rows, "default", ""));
      rec("asc", F(rows, "name-asc", ""));
      rec("desc", F(rows, "name-desc", ""));
      rec("filter", F(rows, "default", "RaV"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r82-probe.js"), probe);
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

console.log("— sortAndFilterLinks on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeLinkSortFilter present", data.present === true);
ok("default → original order", eq(data.default, ["Charlie", "alpha", "Bravo"]), JSON.stringify(data.default));
ok("name-asc → locale A→Z", eq(data.asc, ["alpha", "Bravo", "Charlie"]), JSON.stringify(data.asc));
ok("name-desc → locale Z→A", eq(data.desc, ["Charlie", "Bravo", "alpha"]), JSON.stringify(data.desc));
ok("filter case-insensitive substring", eq(data.filter, ["Bravo"]), JSON.stringify(data.filter));

console.log(`\nR82 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
