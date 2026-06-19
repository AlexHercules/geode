/**
 * R99 desktop probe — verifies tags-as-graph-nodes construction (buildTagGraph) on the
 * REAL Tauri / WKWebView build + real fs via window.__geodeGraphTags(): tag nodes
 * (id `tag:<name>`, degree = # using notes) + note→tag edges over the real tag index.
 * The green draw colour + the toggle are browser-E2E only (r99-e2e, §D). Run:
 * node .calibration/r99-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r99-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r99-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "#alpha #beta\n\nbody\n");
writeFileSync(join(VAULT, "other.md"), "#alpha\n\nbody\n");
writeFileSync(join(VAULT, "plain.md"), "no tags\n");

const probe = `module.exports = {
  id: "r99-probe", name: "r99-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r99-results.md", b).catch(() => app.vault.modify("r99-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeGraphTags;
      rec("present", typeof F === "function");
      // give the index a beat to parse inline tags
      await new Promise((r) => setTimeout(r, 400));
      rec("result", F());
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r99-probe.js"), probe);
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
const r = data.result ?? { nodes: [], edges: 0 };
const deg = (id) => r.nodes.find((n) => n.id === id)?.degree;

console.log("— buildTagGraph on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("exactly 2 tag nodes (alpha, beta)", r.nodes.length === 2, JSON.stringify(r.nodes));
ok("tag:alpha degree 2 (note + other)", deg("tag:alpha") === 2, JSON.stringify(r.nodes));
ok("tag:beta degree 1 (only note)", deg("tag:beta") === 1, JSON.stringify(r.nodes));
ok("3 note→tag edges total", r.edges === 3, JSON.stringify(r.edges));
ok("the untagged note contributes no tag", !r.nodes.some((n) => n.id.includes("plain")), JSON.stringify(r.nodes));

console.log(`\nR99 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
