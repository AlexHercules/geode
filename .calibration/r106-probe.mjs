/**
 * R106 desktop probe — verifies the frontmatter-alias index (metadata.getAliasMap) on the
 * real Tauri / WKWebView build + real fs via window.__geodeAliasMap(): notes with
 * frontmatter `aliases:` map to their alias list; notes without are absent. This is the
 * source the `[[` autocomplete + QuickSwitcher surface (their DOM is browser-E2E only, §D).
 * Run: node .calibration/r106-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r106-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r106-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Tea.md"), "---\naliases:\n  - GreenTea\n  - Matcha\n---\n# Tea\n");
writeFileSync(join(VAULT, "Plain.md"), "# Plain\nno aliases\n");

const probe = `module.exports = {
  id: "r106-probe", name: "r106-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r106-results.md", b).catch(() => app.vault.modify("r106-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeAliasMap;
      rec("present", typeof F === "function");
      await new Promise((r) => setTimeout(r, 400)); // let the index parse frontmatter
      rec("map", F());
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r106-probe.js"), probe);
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
const m = data.map ?? {};

console.log("— getAliasMap on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("Tea.md → [GreenTea, Matcha]", JSON.stringify(m["Tea.md"]) === JSON.stringify(["GreenTea", "Matcha"]), JSON.stringify(m["Tea.md"]));
ok("Plain.md (no aliases) absent from the map", !("Plain.md" in m), JSON.stringify(Object.keys(m)));

console.log(`\nR106 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
