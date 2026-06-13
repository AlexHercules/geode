/**
 * R48 desktop probe — verifies the CONFIGURABLE daily-note format/folder against the
 * REAL Tauri build. The settings UI (SettingsModal) + open-today/template command are
 * React-effect bound (App-Nap §D) → browser E2E; here we drive the always-on
 * __geodeDaily store-level setters (setFormat/setFolder) and assert stamp/path/parse
 * follow on a real WKWebView, then reset to defaults.
 *
 * Run: node .calibration/r48-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 48 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r48-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r48-results.md");

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
  id: "r48-probe", name: "r48-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r48-results.md", body).catch(() =>
        app.vault.modify("r48-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const D = (globalThis).__geodeDaily;
      recFlush("present", !!(D && D.setFormat && D.setFolder));
      recFlush("defStamp", D.stamp(2026, 5, 14));        // 2026-06-14
      D.setFormat("DD-MM-YYYY");
      recFlush("fmtStamp", D.stamp(2026, 5, 14));         // 14-06-2026
      recFlush("fmtPath", D.path(2026, 5, 14));           // Daily Notes/14-06-2026.md
      recFlush("fmtParse", D.parse("Daily Notes/14-06-2026.md")); // 14-06-2026
      recFlush("fmtOldNull", D.parse("Daily Notes/2026-06-14.md")); // null (old format no longer matches)
      D.setFolder("Journal");
      recFlush("folderPath", D.path(2026, 5, 14));         // Journal/14-06-2026.md
      D.setFormat("YYYY-MM-DD"); D.setFolder("Daily Notes"); // reset
      recFlush("resetStamp", D.stamp(2026, 5, 14));        // 2026-06-14
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r48-probe.js"), probe);
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

console.log("— configurable __geodeDaily on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeDaily + setFormat/setFolder present", data.present === true);
ok("default format stamp → 2026-06-14", data.defStamp === "2026-06-14", J(data.defStamp));
ok("custom format stamp → 14-06-2026", data.fmtStamp === "14-06-2026", J(data.fmtStamp));
ok("custom format path follows", data.fmtPath === "Daily Notes/14-06-2026.md", J(data.fmtPath));
ok("custom format parse round-trips", data.fmtParse === "14-06-2026", J(data.fmtParse));
ok("old-format name no longer parses under custom format", data.fmtOldNull === null, J(data.fmtOldNull));
ok("custom folder path follows", data.folderPath === "Journal/14-06-2026.md", J(data.folderPath));
ok("reset restores default stamp", data.resetStamp === "2026-06-14", J(data.resetStamp));

console.log(`\nR48 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
