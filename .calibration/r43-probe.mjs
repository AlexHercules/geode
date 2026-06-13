/**
 * R43 desktop probe — verifies the pure daily-note date helpers (window.__geodeDaily)
 * against the REAL Tauri build / WKWebView. Per the App-Nap discipline (data-safety
 * skill §D) and the R36 lesson, command-layer registration lives in React effects that
 * do NOT run in a backgrounded webview — so the calendar pane + nav COMMANDS are covered
 * by the browser E2E; here we drive only the pure, always-on __geodeDaily helpers, which
 * run synchronously in the probe's first milliseconds.
 *
 * Run: node .calibration/r43-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 43 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r43-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r43-results.md");

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
  id: "r43-probe", name: "r43-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r43-results.md", body).catch(() =>
        app.vault.modify("r43-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const D = (globalThis).__geodeDaily;
      recFlush("present", !!D);
      recFlush("stamp", D.stamp(2026, 5, 14));   // 2026-06-14 (month0=5 = June)
      recFlush("path", D.path(2026, 5, 14));     // Daily Notes/2026-06-14.md
      recFlush("parse", D.parse("Daily Notes/2026-06-14.md")); // 2026-06-14
      recFlush("parseBad", D.parse("note.md"));  // null
      recFlush("parseImpossible", D.parse("2026-13-40")); // null
      recFlush("parseParentDecoy", D.parse("2020-01-01-backup/2026-06-14.md")); // 2026-06-14 (basename)
      recFlush("parseFiveDigit", D.parse("12025-06-14.md")); // null (anchored)
      const g = D.gridDims(2026, 5);
      recFlush("gridWeeks", g.weeks);  // 6
      recFlush("gridCols", g.cols);    // 7
      recFlush("gridFirst", g.first);  // sunday on/before 2026-06-01
      recFlush("gridLast", g.last);    // >= 2026-06-30
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r43-probe.js"), probe);
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

console.log("— __geodeDaily pure helpers on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeDaily present", data.present === true);
ok("stamp(2026,5,14) → 2026-06-14", data.stamp === "2026-06-14", J(data.stamp));
ok("path(2026,5,14) → Daily Notes/2026-06-14.md", data.path === "Daily Notes/2026-06-14.md", J(data.path));
ok("parse('Daily Notes/2026-06-14.md') → 2026-06-14", data.parse === "2026-06-14", J(data.parse));
ok("parse('note.md') → null", data.parseBad === null, J(data.parseBad));
ok("parse impossible '2026-13-40' → null", data.parseImpossible === null, J(data.parseImpossible));
ok("parse parent-folder decoy → basename 2026-06-14 (no over-match)", data.parseParentDecoy === "2026-06-14", J(data.parseParentDecoy));
ok("parse 5-digit year '12025-06-14.md' → null (anchored)", data.parseFiveDigit === null, J(data.parseFiveDigit));
ok("gridDims weeks=6", data.gridWeeks === 6, J(data.gridWeeks));
ok("gridDims cols=7", data.gridCols === 7, J(data.gridCols));
ok("grid first cell is a Sunday on/before the 1st", typeof data.gridFirst === "string" && new Date(data.gridFirst + "T00:00").getDay() === 0 && data.gridFirst <= "2026-06-01", J(data.gridFirst));
ok("grid spans the whole month", typeof data.gridLast === "string" && data.gridLast >= "2026-06-30", J(data.gridLast));

console.log(`\nR43 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
