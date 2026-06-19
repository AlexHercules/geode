/**
 * R109 desktop probe — verifies wikilinkBlockTargets (the `[[<note>#^` block-reference
 * completion resolver) on the real Tauri / WKWebView build + real fs via
 * window.__geodeBlockComplete (async): resolves the note, reads it, returns each block's
 * {id, text preview}; `#` without `^` (heading) → null. The CM autocomplete DOM is
 * browser-E2E only (§D). Run: node .calibration/r109-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r109-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r109-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Blk.md"), "# Head\n\nThe quick brown fox ^fox\n\nLazy dog ^dog\n");
writeFileSync(join(VAULT, "Src.md"), "# Src\n");

const probe = `module.exports = {
  id: "r109-probe", name: "r109-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r109-results.md", b).catch(() => app.vault.modify("r109-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeBlockComplete;
      rec("present", typeof F === "function");
      await new Promise((r) => setTimeout(r, 400)); // let the index parse blocks
      rec("noteHat", await F("Blk#^", "Src.md"));
      rec("selfHat", await F("#^", "Blk.md"));
      rec("heading", await F("Blk#", "Src.md"));
      rec("noBlocks", await F("Src#^", "Src.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r109-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
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
const noteHat = data.noteHat ?? [];
const byId = (id) => (noteHat ?? []).find((b) => b.id === id);

console.log("— wikilinkBlockTargets on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("`[[Blk#^` → 2 blocks with id + text preview", Array.isArray(noteHat) && noteHat.length === 2, JSON.stringify(noteHat));
ok("preview strips `^id` marker (fox → 'The quick brown fox')", byId("fox")?.text === "The quick brown fox", JSON.stringify(byId("fox")));
ok("`[[#^` self-link from Blk.md → its own blocks", Array.isArray(data.selfHat) && data.selfHat.length === 2, JSON.stringify(data.selfHat));
ok("`[[Blk#` (heading, no caret) → null", data.heading === null, JSON.stringify(data.heading));
ok("`[[Src#^` (no blocks) → null", data.noBlocks === null, JSON.stringify(data.noBlocks));

console.log(`\nR109 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
