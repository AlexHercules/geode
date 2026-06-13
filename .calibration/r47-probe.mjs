/**
 * R47 desktop probe — verifies note MERGE against the REAL Tauri build. This is a
 * DATA-SAFETY round: the strongest check is the actual filesystem end-state, so the
 * in-app probe drives __geodeMerge.merge(source, target) (store/vault level → drivable
 * in a backgrounded WKWebView) and the Node runner reads the vault ON DISK to prove:
 *   - the target holds BOTH bodies (append, no loss),
 *   - the source is gone from the vault root but PRESERVED in .trash/ (recoverable),
 *   - a referrer's [[source]] link was rewritten to [[target]] (no dangling link).
 * The merge command + switcher UI are React-effect bound (App-Nap §D) → browser E2E.
 *
 * Run: node .calibration/r47-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 47 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r47-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r47-results.md");
const TRASH = join(VAULT, ".trash");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "MergeTarget.md"), "# Target\nbodyTARGET\n");
writeFileSync(join(VAULT, "MergeSource.md"), "# Source\nbodySOURCE\n");
writeFileSync(join(VAULT, "MergeRef.md"), "see [[MergeSource]] here\n");

const probe = `module.exports = {
  id: "r47-probe", name: "r47-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r47-results.md", body).catch(() =>
        app.vault.modify("r47-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const M = (globalThis).__geodeMerge;
      recFlush("present", !!M);
      M.merge("MergeSource.md", "MergeTarget.md"); // fire-and-forget; verified ON DISK by the runner
      recFlush("started", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r47-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

// poll for the merge's on-disk end-state (source moved to .trash) — the merge is a
// multi-await chain (flush/read/modify/ensureFresh/rewrite/trash); give it room.
const deadline = Date.now() + 18000;
let raw = null;
const sourceGone = () => !existsSync(join(VAULT, "MergeSource.md")) && existsSync(TRASH) && readdirSync(TRASH).some((f) => f.startsWith("MergeSource"));
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) raw = readFileSync(RESULTS, "utf8");
  if (raw && raw.includes("started=") && sourceGone()) break;
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
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

console.log("— in-app probe (real WKWebView) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeMerge present + merge started", data.present === true && data.started === true);

console.log("— ON-DISK merge end-state (the data-safety core) —");
const targetBody = read(join(VAULT, "MergeTarget.md"));
ok("target holds BOTH bodies (append, no loss)", !!targetBody && targetBody.includes("bodyTARGET") && targetBody.includes("bodySOURCE"), J(targetBody));
ok("source REMOVED from vault root", !existsSync(join(VAULT, "MergeSource.md")));
ok("source PRESERVED in .trash (recoverable, not permanent)", existsSync(TRASH) && readdirSync(TRASH).some((f) => f.startsWith("MergeSource")), existsSync(TRASH) ? J(readdirSync(TRASH)) : "no .trash");
const trashedSource = existsSync(TRASH) ? readdirSync(TRASH).find((f) => f.startsWith("MergeSource")) : null;
ok("trashed source content preserved", !!trashedSource && readFileSync(join(TRASH, trashedSource), "utf8").includes("bodySOURCE"));
const refBody = read(join(VAULT, "MergeRef.md"));
ok("referrer link [[MergeSource]] → [[MergeTarget]] (no dangling link)", !!refBody && refBody.includes("[[MergeTarget]]") && !refBody.includes("[[MergeSource]]"), J(refBody));

console.log(`\nR47 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
