/**
 * R50 desktop probe — verifies the readable-line-length CSS-variable toggle against
 * the REAL Tauri build (documentElement style → DOM level, drivable in a backgrounded
 * WKWebView). The settings UI / editor spellcheck contentDOM / zoom commands are
 * React-effect bound (App-Nap §D) → browser E2E.
 *
 * Run: node .calibration/r50-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 50 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r50-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r50-results.md");

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
  id: "r50-probe", name: "r50-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r50-results.md", body).catch(() =>
        app.vault.modify("r50-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const A = (globalThis).__geodeAppearance;
      recFlush("present", !!(A && A.setReadable && A.setSpellcheck));
      recFlush("defaultVar", A.readableVar());        // (default)
      A.setReadable(false);
      recFlush("offVar", A.readableVar());             // none
      A.setReadable(true);
      recFlush("onVar", A.readableVar());              // (default)
      A.setSpellcheck(true); A.setSpellcheck(false);   // store-level, must not throw
      recFlush("spellcheckOk", true);
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r50-probe.js"), probe);
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

console.log("— __geodeAppearance on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeAppearance present", data.present === true);
ok("default readable var → (default) [CSS 700px fallback]", data.defaultVar === "(default)", J(data.defaultVar));
ok("setReadable(false) → --readable-line-width: none", data.offVar === "none", J(data.offVar));
ok("setReadable(true) → back to (default)", data.onVar === "(default)", J(data.onVar));
ok("setSpellcheck toggles without error", data.spellcheckOk === true);

console.log(`\nR50 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
