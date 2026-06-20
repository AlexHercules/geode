/**
 * R140 desktop probe — bulk delete on the real Tauri / WKWebView binary + real filesystem.
 * Run: node .calibration/r140-probe.mjs
 *
 * The Explorer's bulkDelete/bulkMove React methods are App-Nap-throttled headless (§D) and the UI is
 * browser-E2E (r140-e2e 13/13). What this probe verifies on REAL fs is the data-safety substance the
 * bulk loop relies on: (a) sequentially trashing N files moves each to .trash (bulkDelete = N trashes),
 * and (b) trashing a FOLDER removes its children from disk — which is WHY dedup-to-roots is correct
 * (acting on only the root folder, never its descendants). External-read judgment: the node script
 * inspects the actual vault dir on disk after the plugin finishes.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r140-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r140-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });

const probe = `module.exports = {
  id: "r140-probe", name: "r140-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r140-results.md", b).catch(() => napp.vault.modify("r140-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      for (let i = 0; i < 60 && !napp.vault; i++) { await new Promise((r) => setTimeout(r, 50)); }
      // build the working set
      for (const n of ["m1", "m2", "m3"]) { try { await napp.vault.create(n + ".md", "# " + n + "\\n"); } catch {} }
      try { await napp.vault.createFolder("pf"); } catch {}
      try { await napp.vault.create("pf/c.md", "# c\\n"); } catch {}
      // bulkDelete-style: sequentially trash the selected roots (m1, m2 — m3 untouched; pf folder root)
      for (const p of ["m1.md", "m2.md", "pf"]) { try { await napp.vault.trash(p); } catch (e) { rec("trashErr_" + p, String(e)); } }
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r140-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 30000;
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

// external-read judgment: inspect the real vault dir on disk
const onDisk = (p) => existsSync(join(VAULT, p));

console.log("— bulk trash + folder dedup on the real WKWebView binary + real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("no per-file trash errors (sequential trash of m1/m2/pf clean)", data.trashErr_m1 === undefined && data.trashErr_m2 === undefined && data.trashErr_pf === undefined);
ok("m1.md trashed (gone from vault dir)", !onDisk("m1.md"));
ok("m2.md trashed (gone from vault dir)", !onDisk("m2.md"));
ok("m3.md (unselected) still on disk", onDisk("m3.md"));
ok("m1.md / m2.md recoverable in .trash/", onDisk(".trash/m1.md") && onDisk(".trash/m2.md"));
ok("folder pf gone from disk", !onDisk("pf"));
ok("pf/c.md gone WITH the folder (why dedup-to-roots is correct — root removes descendants)", !onDisk("pf/c.md"));

console.log(`\nR140 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
