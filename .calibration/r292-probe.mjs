/**
 * R292 desktop probe - verifies on the REAL Tauri/WKWebView build that the
 * reveal-in-system / open-in-default-app IPC path works for a FOLDER (directory)
 * path. R218's probe locked the FILE path + `..` confinement; R292 adds folders to
 * the menu, so the new risk is "does safe_join + opener handle a directory path?"
 *   (1) CONFINEMENT regression - `..` traversal still REJECTED before opener.
 *   (2) FOLDER reveal - revealInSystem(root, "subfolder") resolves Ok (opens one
 *       Finder window selecting the folder - harmless; binary killed right after).
 *   (3) FOLDER open - openInDefaultApp(root, "subfolder") resolves Ok (opens the
 *       folder in Finder).
 * Resolving these also empirically proves isTauri() is true on desktop (the Rust
 * IPC is reachable), so the isTauri-gated folder menu items DO render on desktop
 * (browser e2e only proves they're HIDDEN in browser). Drives the real
 * core->invoke->Rust path via window.__geodeReveal (set in main.tsx bootstrap,
 * BEFORE plugin onload). App-Nap-safe: awaits fire in the first seconds; results
 * written fire-and-forget.
 *
 * Run: node .calibration/r292-probe.mjs   (release binary must be built WITH R292)
 * Contract: docs/ARCHITECTURE.md "Round 292 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r292-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r292-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
// pre-seed a real folder (with a file inside) so reveal/open have a target that exists
mkdirSync(join(VAULT, "subfolder"));
writeFileSync(join(VAULT, "subfolder", "inner.md"), "# inner\n");
writeFileSync(join(VAULT, "Probe.md"), "probe target\n");

const probe = `module.exports = {
  id: "r292-probe", name: "r292-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r292-results.md", b).catch(() => app.vault.modify("r292-results.md", b).catch(() => {})); };
    try {
      const root = app.vault.adapter.getVaultPath();
      rec("root_present", typeof root === "string" && root.length > 0);
      rec("probe_present", !!(window.__geodeReveal && typeof window.__geodeReveal.revealInSystem === "function"
        && typeof window.__geodeReveal.openInDefaultApp === "function"));
      // (1) confinement regression: traversal rejected by safe_join before opener - nothing opened
      let confined = false;
      try { await window.__geodeReveal.revealInSystem(root, "../escape.txt"); }
      catch (e) { confined = /illegal path component/.test(String((e && e.message) || e)); }
      rec("traversal_rejected", confined);
      // (2) FOLDER reveal: revealInSystem on a directory path resolves Ok (R292 new risk)
      let revealFolderOk = false;
      try { await window.__geodeReveal.revealInSystem(root, "subfolder"); revealFolderOk = true; }
      catch (e) { rec("reveal_folder_err", String((e && e.message) || e)); }
      rec("reveal_folder_ok", revealFolderOk);
      // (3) FOLDER open: openInDefaultApp on a directory path resolves Ok (R292 new risk)
      let openFolderOk = false;
      try { await window.__geodeReveal.openInDefaultApp(root, "subfolder"); openFolderOk = true; }
      catch (e) { rec("open_folder_err", String((e && e.message) || e)); }
      rec("open_folder_ok", openFolderOk);
      rec("done", true);
    } catch (e) { rec("error", String((e && e.message) || e)); }
  }
};`;
writeFileSync(join(PLUGINS, "r292-probe.js"), probe);

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
ok("FOLDER reveal resolves Ok (opener handles a directory path - R292)", get("reveal_folder_ok") === true, String(get("reveal_folder_err")));
ok("FOLDER open resolves Ok (opener handles a directory path - R292)", get("open_folder_ok") === true, String(get("open_folder_err")));
ok("no probe error", get("error") === undefined, String(get("error")));

console.log(`\nR292 probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
rmSync(VAULT, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
