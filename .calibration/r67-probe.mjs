/**
 * R67 desktop probe — verifies the file-vs-folder decision the drag-into-editor
 * drop relies on, against the REAL Tauri filesystem adapter (which could classify
 * folders differently than the browser MemoryVaultAdapter). On a real vault:
 * vault.fileExists is true for files (.md + attachments) and false for folders —
 * so a dragged folder inserts nothing. The drop event + snippet insertion is a
 * view behavior the backgrounded webview can't drive (App Nap) → browser E2E
 * covers it on the identical CM editor.
 *
 * Run: node .calibration/r67-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 67 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r67-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r67-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(join(VAULT, "Folder1"), { recursive: true }); // a real folder on disk
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "NoteA.md"), "# Note A\n");
writeFileSync(join(VAULT, "pic.png"), "fake-png");

const probe = `module.exports = {
  id: "r67-probe", name: "r67-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r67-results.md", b).catch(() => app.vault.modify("r67-results.md", b).catch(() => {})); };
    try {
      let tries = 0;
      const tick = () => {
        tries++;
        const note = app.vault.fileExists("NoteA.md");
        rec("note", note);
        rec("png", app.vault.fileExists("pic.png"));
        rec("folder", app.vault.fileExists("Folder1"));
        if (note || tries >= 6) { rec("done", true); return; }
        setTimeout(tick, 400);
      };
      tick();
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r67-probe.js"), probe);
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

console.log("— file-vs-folder decision on the REAL Tauri fs (drop folder-skip relies on it) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("fileExists(NoteA.md) === true (note → [[link]])", data.note === true, J(data.note));
ok("fileExists(pic.png) === true (attachment → ![[embed]])", data.png === true, J(data.png));
ok("fileExists(Folder1) === false (folder → no insert)", data.folder === false, J(data.folder));

console.log(`\nR67 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
