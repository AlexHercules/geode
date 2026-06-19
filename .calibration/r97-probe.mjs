/**
 * R97 desktop probe — verifies the "Move to…" candidate-folder enumeration on the REAL
 * Tauri / WKWebView build + real fs via window.__geodeMoveFolders(fromPath): the valid
 * target folders (all folders minus self/descendants/current-parent). The picker DOM +
 * the actual move (vetted moveNode/renameWithLinkUpdate, R28-probed) are browser-E2E
 * only (r97-e2e, §D). Run: node .calibration/r97-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r97-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r97-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(join(VAULT, "Dest", "Inner"), { recursive: true });
mkdirSync(join(VAULT, "Other"), { recursive: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "top.md"), "x\n");
writeFileSync(join(VAULT, "Dest", "already.md"), "x\n");

const probe = `module.exports = {
  id: "r97-probe", name: "r97-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r97-results.md", b).catch(() => app.vault.modify("r97-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeMoveFolders;
      rec("present", typeof F === "function");
      rec("topTargets", F("top.md"));          // a root file → all folders
      rec("innerTargets", F("Dest/already.md")); // current parent (Dest) excluded
      rec("folderTargets", F("Dest"));          // moving Dest → excludes Dest + Dest/Inner
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r97-probe.js"), probe);
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
const has = (arr, v) => Array.isArray(arr) && arr.includes(v);

console.log("— move-target enumeration on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("root file → targets include Dest, Other, Dest/Inner", has(data.topTargets, "Dest") && has(data.topTargets, "Other") && has(data.topTargets, "Dest/Inner"), JSON.stringify(data.topTargets));
ok("current parent (Dest) excluded for Dest/already.md", !has(data.innerTargets, "Dest"), JSON.stringify(data.innerTargets));
ok("moving Dest excludes itself + descendant Dest/Inner", !has(data.folderTargets, "Dest") && !has(data.folderTargets, "Dest/Inner"), JSON.stringify(data.folderTargets));
ok("moving Dest still offers a sibling (Other)", has(data.folderTargets, "Other"), JSON.stringify(data.folderTargets));

console.log(`\nR97 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
