/**
 * R34 desktop probe — verifies window.__geodeSearch against the REAL Tauri build
 * (WKWebView has no CDP, so a .geode/plugins probe writes results back to a vault
 * file we read externally). SCOPE: the probe wiring is embedded in the real
 * binary (installSearchProbe ran with the full {open,isOpen,close,replaceAll}
 * api) and booting with the @codemirror/search extension is error-free.
 *
 * NOT covered here: actually driving the panel / replace. A backgrounded
 * WKWebView paints nothing, so React effects never run → no EditorPane / CM view
 * / registered editor:* commands ever mount (verified empirically — .cm-content
 * stays absent even with the window foregrounded via System Events; this is the
 * App Nap reality behind data-safety skill §D, and why no Geode desktop probe
 * drives a live view). The full find/replace flow — open panel, highlight,
 * replace-all, autosave-to-vault — is covered by the browser E2E r34-e2e against
 * a real focused CM view.
 *
 * Run: node .calibration/r34-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 34 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r34-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r34-results.md");

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

// probe plugin: exercises window.__geodeSearch on the real WKWebView runtime.
// Open a note first so the active CM view exists, then drive the search probe.
// App Nap discipline: keep the work in the first few seconds; flush via a fire-
// and-forget create-then-modify chain. "close" is the sentinel last key.
const probe = `module.exports = {
  id: "r34-probe", name: "r34-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r34-results.md", body).catch(() =>
        app.vault.modify("r34-results.md", body).catch(() => {}));
    };
    // flush after EACH record (fire-and-forget) so results survive (App Nap may
    // freeze later timers once the window backgrounds — data-safety skill §D).
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const S = window.__geodeSearch;
      recFlush("present", !!S);
      recFlush("api", S ? Object.keys(S).sort().join(",") : "");
      // A backgrounded WKWebView paints nothing, so React effects never run →
      // no EditorPane / CM view / registered commands ever mount (verified:
      // .cm-content stays absent, editor:* commands stay unregistered, even with
      // the window foregrounded via System Events). The search panel + replace
      // flow therefore CANNOT be driven here — that is covered by the browser
      // E2E (r34-e2e, real focused view). This probe verifies the probe wiring is
      // embedded in the real binary (installSearchProbe ran with the right shape)
      // and that booting with the @codemirror/search extension is error-free.
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r34-probe.js"), probe);
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
ok("__geodeSearch wired into the real binary", data.present === true, J(data.present));
ok("__geodeSearch exposes the full api", data.api === "close,isOpen,open,replaceAll", J(data.api));
console.log("  · note: panel/replace flow is not drivable in a backgrounded WKWebView");
console.log("    (no React effects → no CM view); functional coverage = browser r34-e2e.");

console.log(`\nR34 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
