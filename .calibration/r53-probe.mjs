/**
 * R53 desktop probe — verifies the Unique note creator's pure name / path-preview
 * generation + config reactivity against the REAL Tauri build via __geodeUnique
 * (deterministic, App-Nap-safe — no async / vault write). The live create flow
 * (unique-note:create → vault.create) is exercised by the browser E2E.
 *
 * Run: node .calibration/r53-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 53 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r53-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r53-results.md");

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
  id: "r53-probe", name: "r53-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r53-results.md", body).catch(() =>
        app.vault.modify("r53-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const U = (globalThis).__geodeUnique;
      // reset (setFolder/setFormat persist to localStorage across runs)
      U.setFolder(""); U.setFormat("YYYYMMDDHHmmss");
      recFlush("present", !!(U && U.name && U.path && U.setFolder));
      recFlush("name", U.name(2026, 5, 14, 9, 8, 7));         // 20260614090807
      recFlush("pathRoot", U.path(2026, 5, 14, 9, 8, 7));     // 20260614090807.md
      U.setFolder("Zettel");
      recFlush("pathFolder", U.path(2026, 5, 14, 9, 8, 7));   // Zettel/20260614090807.md
      U.setFolder("../evil");
      recFlush("pathTraversal", U.path(2026, 5, 14, 9, 8, 7)); // 20260614090807.md (root)
      U.setFolder(""); U.setFormat("YYYYMMDDHHmmss");
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r53-probe.js"), probe);
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

console.log("— __geodeUnique pure name/path generation on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeUnique present", data.present === true);
ok("name → 20260614090807", data.name === "20260614090807", J(data.name));
ok("path (root) → 20260614090807.md", data.pathRoot === "20260614090807.md", J(data.pathRoot));
ok("path (folder) → Zettel/20260614090807.md", data.pathFolder === "Zettel/20260614090807.md", J(data.pathFolder));
ok("traversal folder → root (rejected)", data.pathTraversal === "20260614090807.md", J(data.pathTraversal));

console.log(`\nR53 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
