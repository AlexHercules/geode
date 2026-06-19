/**
 * R103 desktop probe — verifies the direction-aware local-subgraph (localSubgraph) on the
 * real Tauri / WKWebView build via window.__geodeGraphLocal(edges, anchor, depth, dirs):
 * depth bounds + incoming/outgoing direction toggles over a fixed directed edge set.
 * The depth select + toggle DOM are browser-E2E only (§D). Run:
 * node .calibration/r103-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r103-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r103-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# seed\n");

// directed edges: a→b, b→c, x→a
const probe = `module.exports = {
  id: "r103-probe", name: "r103-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r103-results.md", b).catch(() => app.vault.modify("r103-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeGraphLocal;
      rec("present", typeof F === "function");
      const E = [{source:"a",target:"b"},{source:"b",target:"c"},{source:"x",target:"a"}];
      rec("bothD1", F(E, "a", 1, {outgoing:true, incoming:true}).sort());
      rec("outD1", F(E, "a", 1, {outgoing:true, incoming:false}).sort());
      rec("inD1", F(E, "a", 1, {outgoing:false, incoming:true}).sort());
      rec("outD2", F(E, "a", 2, {outgoing:true, incoming:false}).sort());
      rec("none", F(E, "a", 1, {outgoing:false, incoming:false}).sort());
      rec("deep", F(E, "a", 9, {outgoing:true, incoming:true}).sort());
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r103-probe.js"), probe);
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

console.log("— localSubgraph direction/depth on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("depth 1 both → a,b,x", eq(data.bothD1, ["a", "b", "x"]), JSON.stringify(data.bothD1));
ok("depth 1 outgoing → a,b", eq(data.outD1, ["a", "b"]), JSON.stringify(data.outD1));
ok("depth 1 incoming → a,x", eq(data.inD1, ["a", "x"]), JSON.stringify(data.inD1));
ok("depth 2 outgoing → a,b,c", eq(data.outD2, ["a", "b", "c"]), JSON.stringify(data.outD2));
ok("both off → a only", eq(data.none, ["a"]), JSON.stringify(data.none));
ok("over-deep is bounded → a,b,c,x", eq(data.deep, ["a", "b", "c", "x"]), JSON.stringify(data.deep));

console.log(`\nR103 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
