/**
 * R218 desktop probe — verifies on the REAL Tauri/WKWebView build that the
 * reveal-in-system / open-in-default-app IPC path works end to end:
 *   (1) CONFINEMENT — a `..` traversal path is REJECTED by safe_join BEFORE the
 *       opener is ever called (error "illegal path component"), so absolute paths
 *       never leave the shell. Non-invasive: nothing is opened.
 *   (2) SUCCESS — revealing a real in-vault file resolves Ok, empirically
 *       confirming the tauri-plugin-opener Rust API works WITHOUT any capability
 *       entry (the claim the reviewer source-verified). This opens ONE Finder
 *       window — harmless; the binary is killed right after.
 * Drives the real core→invoke→Rust path via window.__geodeReveal (set in main.tsx
 * during bootstrap, BEFORE plugin onload — so it exists here even though App.tsx's
 * command registration has not run yet; command timing is covered by the browser e2e).
 * App-Nap-safe: the two awaits fire in the first seconds after launch; results are
 * written fire-and-forget.
 *
 * Run: node .calibration/r218-probe.mjs   (release binary must be built WITH R218)
 * Contract: docs/ARCHITECTURE.md "Round 218 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r218-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r218-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Probe.md"), "probe target\n");

const probe = `module.exports = {
  id: "r218-probe", name: "r218-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r218-results.md", b).catch(() => app.vault.modify("r218-results.md", b).catch(() => {})); };
    try {
      const root = app.vault.adapter.getVaultPath();
      rec("root_present", typeof root === "string" && root.length > 0);
      rec("probe_present", !!(window.__geodeReveal && typeof window.__geodeReveal.revealInSystem === "function"));
      // (1) confinement: traversal rejected by safe_join before opener — nothing opened
      let confined = false;
      try { await window.__geodeReveal.revealInSystem(root, "../escape.txt"); }
      catch (e) { confined = /illegal path component/.test(String((e && e.message) || e)); }
      rec("traversal_rejected", confined);
      // (2) success: reveal a real in-vault file → resolves Ok (opener Rust API works, no capability)
      let revealOk = false;
      try { await window.__geodeReveal.revealInSystem(root, "Probe.md"); revealOk = true; }
      catch (e) { rec("reveal_err", String((e && e.message) || e)); }
      rec("reveal_ok", revealOk);
      rec("done", true);
    } catch (e) { rec("error", String((e && e.message) || e)); }
  }
};`;
writeFileSync(join(PLUGINS, "r218-probe.js"), probe);

console.log("Launching desktop binary…");
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });
child.unref();

const deadline = Date.now() + 12000;
let body = "";
await new Promise((r) => setTimeout(r, 6000));
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { body = readFileSync(RESULTS, "utf8"); if (body.includes("done=") || body.includes("error=")) break; }
  await new Promise((r) => setTimeout(r, 800));
}
try { process.kill(-child.pid); } catch { /* group gone */ }
try { process.kill(child.pid); } catch { /* gone */ }

const get = (k) => { const m = body.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? JSON.parse(m[1]) : undefined; };
console.log("--- results ---\n" + (body || "(no results file written)"));
console.log("--- assertions ---");
ok("vault root resolved on desktop build", get("root_present") === true);
ok("window.__geodeReveal probe present pre-React", get("probe_present") === true);
ok("`..` traversal REJECTED by safe_join before opener (confinement)", get("traversal_rejected") === true);
ok("revealing a real in-vault file resolves Ok (opener Rust API, no capability)", get("reveal_ok") === true, String(get("reveal_err")));
ok("no probe error", get("error") === undefined, String(get("error")));

console.log(`\nR218 probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
rmSync(VAULT, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
