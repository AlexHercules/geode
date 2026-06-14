/**
 * R54 desktop probe — verifies Setext + ATX heading fold-range geometry against the
 * REAL Tauri build via __geodeFoldRange (pure markdownFoldRange on a throwaway
 * EditorState — deterministic, App-Nap-safe, no live view). The live fold gutter /
 * editor:toggle-fold path is a view behavior exercised by the browser E2E.
 *
 * Run: node .calibration/r54-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 54 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r54-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r54-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# Seed\n");

// DOC = "H1\n==\n\npara1\n\nH2\n--\n\npara2\n# A\nend\n"  (\\n inside the embedded plugin)
const probe = `module.exports = {
  id: "r54-probe", name: "r54-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r54-results.md", body).catch(() =>
        app.vault.modify("r54-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const F = (globalThis).__geodeFoldRange;
      const DOC = "H1\\n==\\n\\npara1\\n\\nH2\\n--\\n\\npara2\\n# A\\nend\\n";
      recFlush("present", !!(F && F.range));
      recFlush("setextH1", F.range(DOC, 1));   // {2,26}
      recFlush("setextH2", F.range(DOC, 6));   // {16,26}
      recFlush("atxH1", F.range(DOC, 10));     // {30,35}
      recFlush("paraNull", F.range(DOC, 4));   // null
      recFlush("underlineNull", F.range(DOC, 2)); // null
      recFlush("multiline", F.range("lineA\\nlineB\\n===\\n", 1)); // {5,16}
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r54-probe.js"), probe);
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("— __geodeFoldRange ATX+Setext geometry on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeFoldRange present", data.present === true);
ok("Setext H1 → {2,26}", eq(data.setextH1, { from: 2, to: 26 }), J(data.setextH1));
ok("Setext H2 → {16,26}", eq(data.setextH2, { from: 16, to: 26 }), J(data.setextH2));
ok("ATX H1 → {30,35}", eq(data.atxH1, { from: 30, to: 35 }), J(data.atxH1));
ok("paragraph line → null", data.paraNull === null, J(data.paraNull));
ok("underline line → null", data.underlineNull === null, J(data.underlineNull));
ok("multi-line Setext → {5,16}", eq(data.multiline, { from: 5, to: 16 }), J(data.multiline));

console.log(`\nR54 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
