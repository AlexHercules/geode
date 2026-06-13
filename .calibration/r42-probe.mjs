/**
 * R42 desktop probe — verifies local `.trash/` recoverable delete against the REAL
 * Tauri build. This is a DATA-SAFETY round: the strongest check is the actual
 * filesystem state, so beyond the in-app probe (vault.trash / listTrash / restore
 * store truth), the Node runner reads `<vault>/.trash/` ON DISK to prove a deleted
 * file is MOVED there (recoverable) and never permanently lost.
 *
 * Run: node .calibration/r42-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 42 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r42-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r42-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# Note one\n");      // trashed, stays in .trash
writeFileSync(join(VAULT, "note2.md"), "# Note two\n");     // trashed then restored

const probe = `module.exports = {
  id: "r42-probe", name: "r42-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r42-results.md", body).catch(() =>
        app.vault.modify("r42-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const v = app.vault;
      const tp = await v.trash("note.md");                 // → .trash/note.md (stays)
      recFlush("trashPath", tp);
      recFlush("goneFromVault", v.fileExists("note.md"));  // false
      recFlush("listTrash", (await v.listTrash()).join(",")); // .trash/note.md
      const tp2 = await v.trash("note2.md");
      await v.restoreFromTrash(tp2, "note2.md");            // trashed then restored
      recFlush("restoredExists", v.fileExists("note2.md")); // true
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r42-probe.js"), probe);
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

console.log("— in-app probe (store truth on real WKWebView) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("vault.trash returns a .trash/ path", typeof data.trashPath === "string" && data.trashPath.startsWith(".trash/"), J(data.trashPath));
ok("trashed file gone from vault (fileExists false)", data.goneFromVault === false, J(data.goneFromVault));
ok("listTrash lists the trashed file", typeof data.listTrash === "string" && data.listTrash.includes("note.md"), J(data.listTrash));
ok("restoreFromTrash brings note2 back (fileExists true)", data.restoredExists === true, J(data.restoredExists));

console.log("— ON-DISK filesystem truth (the data-safety core) —");
ok("DELETED FILE PHYSICALLY MOVED to .trash on disk (recoverable, NOT lost)", existsSync(join(VAULT, ".trash", "note.md")));
ok("original removed from vault root", !existsSync(join(VAULT, "note.md")));
ok("trashed file content preserved on disk", existsSync(join(VAULT, ".trash", "note.md")) && readFileSync(join(VAULT, ".trash", "note.md"), "utf8").includes("Note one"));
ok("restored file is back in vault root", existsSync(join(VAULT, "note2.md")));
ok("restored file no longer in .trash", !existsSync(join(VAULT, ".trash", "note2.md")));

console.log(`\nR42 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
