/**
 * R66 desktop probe — verifies the backlink-count status item's DATA PATH on the
 * REAL Tauri/WKWebView build with real .md files: open NoteA, read
 * app.metadata.getBacklinks("NoteA.md") and confirm the linked-mention total the
 * status bar displays. (The selected-words path needs a live editor selection the
 * backgrounded webview can't drive — App Nap — so it's covered by the browser E2E
 * on the identical word-count plugin.)
 *
 * Run: node .calibration/r66-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 66 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r66-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r66-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "NoteA.md"), "# Note A\n\nbody.\n");
writeFileSync(join(VAULT, "Source.md"), "see [[NoteA]] and again [[NoteA]].\n");
writeFileSync(join(VAULT, "Lonely.md"), "# Lonely\n");

const probe = `module.exports = {
  id: "r66-probe", name: "r66-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r66-results.md", b).catch(() => app.vault.modify("r66-results.md", b).catch(() => {})); };
    const count = (p) => (app.metadata.getBacklinks(p) || []).reduce((n, b) => n + b.contexts.length, 0);
    try {
      let tries = 0;
      const tick = () => {
        tries++;
        const a = count("NoteA.md");
        rec("noteA", a);
        rec("lonely", count("Lonely.md"));
        if (a >= 2 || tries >= 6) { rec("done", true); return; }
        setTimeout(tick, 400);
      };
      tick();
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r66-probe.js"), probe);
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

console.log("— backlink-count data path on real fs / WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("NoteA has 2 linked mentions (two [[NoteA]] in Source)", data.noteA === 2, J(data.noteA));
ok("Lonely has 0 backlinks", data.lonely === 0, J(data.lonely));

console.log(`\nR66 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
