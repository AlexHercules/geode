/**
 * R49 desktop probe — verifies file-recovery snapshots against the REAL Tauri build.
 * Data-safety round: the strongest check is the actual on-disk store, so the in-app
 * probe drives __geodeSnapshots.record/list/restore (store/vault level → drivable in a
 * backgrounded WKWebView) and the Node runner reads <vault>/.obsidian/snapshots/ AND
 * the restored note ON DISK to prove: a snapshot is persisted; a restore writes the
 * old content back AND first snapshots the current content (never loses what's there).
 * The recovery MODAL + command are React-effect bound (App-Nap §D) → browser E2E.
 *
 * Run: node .calibration/r49-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 49 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r49-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r49-results.md");
const NOTE = join(VAULT, "snapnote.md");
const SNAP_JSON = join(VAULT, ".obsidian/snapshots/snapnote.md.json");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(NOTE, "CURRENT content\n");

const probe = `module.exports = {
  id: "r49-probe", name: "r49-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r49-results.md", body).catch(() =>
        app.vault.modify("r49-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const S = (globalThis).__geodeSnapshots;
      recFlush("present", !!(S && S.record && S.restore));
      S.record("snapnote.md", "OLD v1", 1000);     // queued snapshot
      const list1 = await S.list("snapnote.md");    // queued read (after record)
      recFlush("listAfterRecord", list1.length);    // 1
      const restored = await S.restore("snapnote.md", 1000, 5000); // snapshot current + write OLD v1
      recFlush("restored", restored);               // true
      const list2 = await S.list("snapnote.md");
      recFlush("listAfterRestore", list2.length);   // 2 (OLD v1 + CURRENT content)
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r49-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 18000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=")) break; }
  await new Promise((r) => setTimeout(r, 300));
}
// give the restore's vault.modify a moment to land on disk after done=
const fd = Date.now() + 3000;
while (Date.now() < fd && (!existsSync(NOTE) || !readFileSync(NOTE, "utf8").includes("OLD v1"))) await new Promise((r) => setTimeout(r, 200));
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
ok("__geodeSnapshots present", data.present === true);
ok("list after one record → 1", data.listAfterRecord === 1, J(data.listAfterRecord));
ok("restore returns true", data.restored === true, J(data.restored));
ok("list after restore → 2 (current was snapshotted)", data.listAfterRestore === 2, J(data.listAfterRestore));

console.log("— ON-DISK snapshot store + restored note (the data-safety core) —");
ok("snapshot JSON written under .obsidian/snapshots/", existsSync(SNAP_JSON));
let parsed = null;
try { parsed = existsSync(SNAP_JSON) ? JSON.parse(readFileSync(SNAP_JSON, "utf8")) : null; } catch { /* malformed */ }
ok("snapshot JSON holds the snapshots array", !!(parsed && Array.isArray(parsed.snapshots) && parsed.snapshots.length === 2), parsed ? J(parsed.snapshots?.length) : "none");
const note = existsSync(NOTE) ? readFileSync(NOTE, "utf8") : null;
ok("restore wrote the OLD content back to the note", note === "OLD v1", J(note));
ok("the PRE-RESTORE current content was snapshotted (never lost)", !!(parsed && parsed.snapshots?.some((s) => s.content.includes("CURRENT content"))), parsed ? J(parsed.snapshots) : "none");

console.log(`\nR49 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
