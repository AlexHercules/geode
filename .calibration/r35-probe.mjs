/**
 * R35 desktop probe — verifies window.__geodeBrackets against the REAL Tauri build
 * (WKWebView has no CDP, so a .geode/plugins probe writes results back to a vault
 * file we read externally).
 *
 * UNLIKE R34's search probe, R35's probe surface is a PURE function
 * (core/bracketWrap.markdownWrapInput) — so the desktop binary CAN exercise the
 * actual wrap decisions (no live CM view needed). What is NOT drivable here is the
 * closeBrackets() auto-close/type-over flow: a backgrounded WKWebView paints
 * nothing → React effects never run → no EditorPane / CM view ever mounts (the App
 * Nap reality behind data-safety skill §D; same as R34). Those live-view behaviors
 * are covered by the browser E2E (r35-e2e, real focused view). This probe asserts:
 * the probe wiring is embedded in the real binary, the pure wrap decision is
 * correct on the real runtime, and booting with closeBrackets() is error-free.
 *
 * Run: node .calibration/r35-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 35 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r35-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r35-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) {
  console.error(`release binary not found: ${BIN}`);
  process.exit(2);
}

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# Note\n");

// probe plugin: drives the PURE window.__geodeBrackets.wrap decision on the real
// WKWebView runtime. App Nap discipline (§D): flush after EACH record, fire-and-
// forget; keep work in the first few seconds; "done" is the sentinel last key.
const probe = `module.exports = {
  id: "r35-probe", name: "r35-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r35-results.md", body).catch(() =>
        app.vault.modify("r35-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const B = window.__geodeBrackets;
      recFlush("present", !!B);
      recFlush("api", B ? Object.keys(B).sort().join(",") : "");
      if (B) {
        const w = B.wrap("foo", 0, 3, "*");
        recFlush("wrapInsert", w && w.changes.insert);                 // "*foo*"
        recFlush("wrapSel", w && (w.selection.anchor + "," + w.selection.head)); // "1,4"
        recFlush("wrapTick", (B.wrap("foo", 0, 3, "\`") || {}).changes && B.wrap("foo", 0, 3, "\`").changes.insert); // "\`foo\`"
        recFlush("wrapEmpty", B.wrap("foo", 1, 1, "*"));               // null
        recFlush("wrapNonMarker", B.wrap("foo", 0, 3, "x"));           // null
        recFlush("wrapBracket", B.wrap("foo", 0, 3, "("));             // null (closeBrackets owns it)
      }
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r35-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    raw = readFileSync(RESULTS, "utf8");
    if (raw.includes("done=")) break;
  }
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

console.log("— desktop probe assertions (real WKWebView runtime) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeBrackets wired into the real binary", data.present === true, J(data.present));
ok("__geodeBrackets exposes the wrap api", data.api === "wrap", J(data.api));
ok("pure wrap decision on real runtime: *foo*", data.wrapInsert === "*foo*", J(data.wrapInsert));
ok("pure wrap selection covers inner (1,4 → additive)", data.wrapSel === "1,4", J(data.wrapSel));
ok("pure wrap backtick: `foo`", data.wrapTick === "`foo`", J(data.wrapTick));
ok("empty selection → null", data.wrapEmpty === null, J(data.wrapEmpty));
ok("non-marker char → null", data.wrapNonMarker === null, J(data.wrapNonMarker));
ok("bracket char → null (closeBrackets owns it)", data.wrapBracket === null, J(data.wrapBracket));
console.log("  · note: closeBrackets auto-close/type-over is not drivable in a backgrounded");
console.log("    WKWebView (no React effects → no CM view); covered by browser r35-e2e.");

console.log(`\nR35 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
