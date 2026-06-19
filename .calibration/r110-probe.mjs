/**
 * R110 desktop probe — verifies the pure localEdges neighbor-links filter on the real Tauri /
 * WKWebView build via window.__geodeLocalEdges(edges, keptIds, anchor, neighborLinks):
 * neighbor ON → all kept edges; neighbor OFF → only anchor-incident edges (between-neighbour
 * edges dropped); anchor null → no filter. The toggle DOM is browser-E2E only (§D). Run:
 * node .calibration/r110-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r110-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r110-results.md");

let passed = 0, failed = 0;
const fails = [];
const key = (es) => (es ?? []).map((e) => `${e.source}>${e.target}`).sort();
const eq = (a, b) => JSON.stringify(key(a)) === JSON.stringify(key(b));
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# seed\n");

const probe = `module.exports = {
  id: "r110-probe", name: "r110-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r110-results.md", b).catch(() => app.vault.modify("r110-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeLocalEdges;
      rec("present", typeof F === "function");
      const E = [{source:"A",target:"B"},{source:"A",target:"C"},{source:"B",target:"C"}];
      const K = ["A","B","C"];
      rec("on", F(E, K, "A", true));
      rec("off", F(E, K, "A", false));
      rec("globalOff", F(E, K, null, false));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r110-probe.js"), probe);
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
const ALL = [{ source: "A", target: "B" }, { source: "A", target: "C" }, { source: "B", target: "C" }];
const INCIDENT = [{ source: "A", target: "B" }, { source: "A", target: "C" }];

console.log("— localEdges neighbor-links filter on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("neighbor ON → all 3 edges", eq(data.on, ALL), JSON.stringify(data.on));
ok("neighbor OFF → only the 2 anchor-incident edges (B>C dropped)", eq(data.off, INCIDENT), JSON.stringify(data.off));
ok("anchor null (global) + OFF → no filter (all edges)", eq(data.globalOff, ALL), JSON.stringify(data.globalOff));

console.log(`\nR110 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
